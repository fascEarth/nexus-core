import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { DomainEvent } from '@nexus/shared-types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AccessService } from '../../core/access/access.service';
import { DataService } from '../../core/metadata/data.service';
import { WorkflowService } from '../../core/workflow/workflow.service';
import { ConsumerRegistry } from '../../core/events/consumer-runner.service';
import type { EventConsumer } from '../../core/events/event-consumer';
import { runInContext } from '../../core/context/request-context';
import { FoodService } from './food.service';
import { ACTIVE_DELIVERY, ACTIVE_ORDER, clamp, km, num } from './food.util';

type WorkflowEventData = { from: string; to: string; comment?: string; record: Record<string, unknown> & { id: string } };

/**
 * Event-driven side of NexEats. Modules talk only through events:
 *  - order accepted          → dispatch: assign the nearest free rider (creates a `delivery` record)
 *  - delivery picked up      → order moves to "out for delivery"
 *  - delivery delivered      → order delivered, COD collected, rider position updated
 *  - order cancelled/declined→ refund prepaid orders, cancel the trip
 */
@Injectable()
export class FoodDispatchConsumer implements EventConsumer, OnModuleInit {
  readonly consumerName = 'food-dispatch';
  private readonly logger = new Logger('FoodDispatch');
  private inFlight = new Set<string>();

  constructor(
    private readonly registry: ConsumerRegistry,
    private readonly prisma: PrismaService,
    private readonly data: DataService,
    private readonly workflow: WorkflowService,
    private readonly food: FoodService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  handles(type: string) {
    return type.startsWith('workflow.order-lifecycle.') || type.startsWith('workflow.delivery-lifecycle.');
  }

  async handle(event: DomainEvent) {
    const d = event.data as WorkflowEventData;
    const id = event.entity?.id ?? d.record?.id;
    if (!id) return;
    await this.food.asSystem(async () => {
      switch (event.type) {
        case 'workflow.order-lifecycle.accept':
          return this.dispatch(id);
        case 'workflow.order-lifecycle.cancel':
        case 'workflow.order-lifecycle.reject':
          return this.closeOrder(id, d.comment);
        case 'workflow.delivery-lifecycle.pick_up':
          return this.pickedUp(id);
        case 'workflow.delivery-lifecycle.deliver':
          return this.delivered(id);
      }
    }, event.tenantId);
  }

  /** Assign the best free rider. Safe to call repeatedly (idempotent per order). */
  async dispatch(orderId: string) {
    if (this.inFlight.has(orderId)) return;
    this.inFlight.add(orderId);
    try {
      const { order, riders, busy, restaurant } = await this.prisma.tx(async (tx) => {
        const o = await this.food.one(tx, 'order', orderId);
        const active = await this.food.rows(tx, 'delivery', { status: { in: ACTIVE_DELIVERY } });
        return {
          order: o.row,
          riders: await this.food.rows(tx, 'rider_profile'),
          busy: new Set(active.map((x) => x.ownerId)),
          restaurant: (await this.food.one(tx, 'restaurant', String(o.row.restaurantId))).row,
        };
      });
      if (order.deliveryId || !['accepted', 'ready'].includes(String(order.status))) return;
      const free = riders.filter((r) => r.online && !busy.has(r.ownerId));
      if (!free.length) return; // the autopilot retries on its next tick
      const rLat = num(restaurant.lat), rLng = num(restaurant.lng);
      // Demo nicety: a real (non-simulated) rider who is online gets trips first.
      const rider = free.find((r) => !r.bot) ?? free.sort((a, b) => km(num(a.lat), num(a.lng), rLat, rLng) - km(num(b.lat), num(b.lng), rLat, rLng))[0];
      const approachKm = km(num(rider.lat), num(rider.lng), rLat, rLng);
      const dist = num(order.distanceKm, 3);
      const delivery = await this.data.create('delivery', {
        orderNumber: order.number, riderName: rider.name, restaurantName: restaurant.name, customerName: order.customerName,
        payout: Math.round(30 + dist * 7), distanceKm: dist, orderId: order.id, address: order.address,
        startLat: rider.lat, startLng: rider.lng, pickupLat: rLat, pickupLng: rLng, dropLat: order.dropLat, dropLng: order.dropLng,
        approachSeconds: Math.round(clamp(20 + approachKm * 9, 20, 60)), travelSeconds: Math.round(clamp(35 + dist * 14, 40, 120)),
        assignedAt: new Date().toISOString(),
      }, { ownerId: rider.ownerId, orgUnitId: order.orgUnitId });
      await this.data.update('order', order.id, {
        deliveryId: delivery.id, riderId: rider.ownerId, riderName: rider.name, riderPhone: rider.phone ?? null, riderVehicle: rider.vehicle ?? null,
      });
    } finally {
      this.inFlight.delete(orderId);
    }
  }

  private async closeOrder(orderId: string, reason?: string) {
    const { row } = await this.prisma.tx((tx) => this.food.one(tx, 'order', orderId));
    await this.data.update('order', orderId, {
      paymentStatus: row.paymentStatus === 'paid' ? 'refunded' : row.paymentStatus,
      cancelReason: reason ?? row.cancelReason ?? null,
    });
    if (row.deliveryId) await this.workflow.transition('delivery', String(row.deliveryId), 'cancel', 'Order closed').catch(() => undefined);
  }

  private async pickedUp(deliveryId: string) {
    const { row } = await this.prisma.tx((tx) => this.food.one(tx, 'delivery', deliveryId));
    await this.data.update('delivery', deliveryId, { pickedUpAt: new Date().toISOString() });
    await this.workflow.transition('order', String(row.orderId), 'pick_up').catch((e) => this.logger.debug(`pick_up ${row.orderNumber}: ${e}`));
  }

  private async delivered(deliveryId: string) {
    const { row } = await this.prisma.tx((tx) => this.food.one(tx, 'delivery', deliveryId));
    const now = new Date();
    await this.data.update('delivery', deliveryId, { deliveredAt: now.toISOString() });
    const { row: order } = await this.prisma.tx((tx) => this.food.one(tx, 'order', String(row.orderId)));
    await this.workflow.transition('order', order.id, 'deliver').catch((e) => this.logger.debug(`deliver ${order.number}: ${e}`));
    await this.data.update('order', order.id, {
      deliveredAt: now.toISOString(),
      // The demo runs ~10× faster than life; record the realistic duration the customer was promised.
      deliveryMinutes: Math.round(num(order.etaMinutes, 30) * (0.8 + Math.random() * 0.35)),
      paymentStatus: order.paymentStatus === 'cod_pending' ? 'cod_collected' : order.paymentStatus,
    });
    const profile = await this.prisma.tx((tx) => tx.record.findFirst({ where: { entity: 'rider_profile', ownerId: row.ownerId } }));
    if (profile) await this.data.update('rider_profile', profile.id, { lat: order.dropLat, lng: order.dropLng });
  }
}

/**
 * Demo autopilot: keeps the marketplace moving when nobody is clicking.
 * Simulated restaurants accept and cook, simulated riders ride, simulated
 * customers place orders. Every step is a normal workflow transition by the
 * tenant's automation user, so it is permission-checked, audited and evented.
 * Real demo users always get a head start before the autopilot steps in.
 */
@Injectable()
export class FoodAutopilot implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('FoodAutopilot');
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastBotOrder = new Map<string, number>();

  static readonly ACCEPT_AFTER_MS = 25_000;
  static readonly HUMAN_GRACE_MS = 120_000;
  static readonly MAX_BOT_ACTIVE = 4;
  static readonly BOT_ORDER_EVERY_MS = 55_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly data: DataService,
    private readonly workflow: WorkflowService,
    private readonly food: FoodService,
    private readonly dispatcher: FoodDispatchConsumer,
  ) {}

  onApplicationBootstrap() {
    if (process.env.EVENT_WORKERS === 'false' || process.env.FOOD_AUTOPILOT === 'false') return;
    this.timer = setInterval(() => void this.tick(), 4_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const tenants = await this.prisma.system.tenant.findMany({ where: { active: true, modules: { has: 'food' } }, select: { id: true } });
      for (const t of tenants) {
        await runInContext({ tenantId: t.id }, () => this.food.asSystem(() => this.step(t.id), t.id)).catch((e) => this.logger.warn(`tick ${t.id}: ${e}`));
      }
    } finally {
      this.running = false;
    }
  }

  private async step(tenantId: string) {
    const now = Date.now();
    const { orders, deliveries, riders } = await this.prisma.tx(async (tx) => ({
      orders: await this.food.rows(tx, 'order', { status: { in: ACTIVE_ORDER } }),
      deliveries: await this.food.rows(tx, 'delivery', { status: { in: ACTIVE_DELIVERY } }),
      riders: await this.food.rows(tx, 'rider_profile'),
    }));
    const human = new Set(riders.filter((r) => !r.bot).map((r) => r.ownerId));
    const fire = (entity: string, id: string, name: string, comment?: string) =>
      this.workflow.transition(entity, id, name, comment).catch((e) => this.logger.debug(`${entity} ${id} ${name}: ${e}`));

    for (const o of orders) {
      const idle = now - +o.updatedAt;
      if (o.status === 'placed' && idle > FoodAutopilot.ACCEPT_AFTER_MS) await fire('order', o.id, 'accept');
      else if (o.status === 'accepted' && idle > num(o.prepSeconds, 40) * 1000) await fire('order', o.id, 'ready');
      if ((o.status === 'accepted' || o.status === 'ready') && !o.deliveryId && idle > 6_000) await this.dispatcher.dispatch(o.id);
    }

    const byId = new Map(orders.map((o) => [o.id, o]));
    for (const d of deliveries) {
      const grace = human.has(d.ownerId) ? FoodAutopilot.HUMAN_GRACE_MS : 0;
      const order = byId.get(String(d.orderId));
      if (d.status === 'assigned') {
        const since = now - new Date(String(d.assignedAt ?? d.createdAt)).getTime();
        if (order?.status === 'ready' && since > num(d.approachSeconds, 30) * 1000 + grace && now - +order.updatedAt > 5_000) await fire('delivery', d.id, 'pick_up');
      } else if (d.status === 'picked_up') {
        const since = now - new Date(String(d.pickedUpAt ?? d.updatedAt)).getTime();
        if (since > num(d.travelSeconds, 60) * 1000 + grace) await fire('delivery', d.id, 'deliver');
      }
    }

    // Simulated riders drift back online so dispatch never starves.
    for (const r of riders.filter((x) => x.bot && !x.online && Math.random() < 0.05)) {
      await this.asWrite(() => this.data.update('rider_profile', r.id, { online: true }));
    }

    const botActive = orders.filter((o) => o.status !== 'picked_up').length;
    if (botActive < FoodAutopilot.MAX_BOT_ACTIVE && now - (this.lastBotOrder.get(tenantId) ?? 0) > FoodAutopilot.BOT_ORDER_EVERY_MS) {
      this.lastBotOrder.set(tenantId, now);
      await this.botOrder(tenantId).catch((e) => this.logger.debug(`bot order: ${e}`));
    }
  }

  private asWrite<T>(fn: () => Promise<T>) {
    return fn().catch((e) => this.logger.debug(String(e)));
  }

  /** A simulated customer orders 1–3 dishes from an open restaurant. */
  private async botOrder(tenantId: string) {
    const { diners, restaurants, items } = await this.prisma.tx(async (tx) => ({
      diners: await tx.tenantUser.findMany({ where: { user: { email: { startsWith: 'diner' } } }, select: { userId: true } }),
      restaurants: (await this.food.rows(tx, 'restaurant')).filter((r) => r.isOpen),
      items: await this.food.rows(tx, 'menu_item'),
    }));
    if (!diners.length || !restaurants.length) return;
    const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    const r = pick(restaurants);
    const menu = items.filter((m) => m.restaurantId === r.id && m.available !== false);
    if (!menu.length) return;
    const lines = [...new Set(Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => pick(menu).id))].map((id) => ({ id, qty: Math.random() < 0.25 ? 2 : 1 }));
    const angle = Math.random() * Math.PI * 2, dist = 0.008 + Math.random() * 0.03;
    const lat = Math.round((num(r.lat) + Math.sin(angle) * dist) * 1e5) / 1e5, lng = Math.round((num(r.lng) + Math.cos(angle) * dist) * 1e5) / 1e5;
    const user = await this.access.loadUser(tenantId, pick(diners).userId);
    await runInContext({ tenantId, user, actor: { type: 'user', id: user.userId } }, () =>
      this.food.placeOrder({
        restaurantId: r.id, items: lines, lat, lng, address: `${10 + Math.floor(Math.random() * 150)}, ${pick(['Main Road', '2nd Street', 'Lake View Road', 'Temple Street'])}, near ${r.area}, Coimbatore`,
        paymentMethod: pick(['upi', 'upi', 'card', 'cod']),
      }),
    );
  }
}

