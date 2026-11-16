import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService, Tx } from '../../core/prisma/prisma.service';
import { AccessService } from '../../core/access/access.service';
import { DataService } from '../../core/metadata/data.service';
import { WorkflowService } from '../../core/workflow/workflow.service';
import { AuthService } from '../../core/auth/auth.service';
import { currentContext, currentTenantId, currentUser, runInContext } from '../../core/context/request-context';
import type { AppUser } from '../../core/access/access.types';
import { ACTIVE_DELIVERY, ACTIVE_ORDER, Row, dayKey, deliveryFee, etaMinutes, flat, istHour, km, num, round1 } from './food.util';

export interface CartInput {
  restaurantId: string;
  items: { id: string; qty: number }[];
  coupon?: string;
  lat?: number;
  lng?: number;
}

export interface PlaceOrderInput extends CartInput {
  address: string;
  lat: number;
  lng: number;
  paymentMethod: 'upi' | 'card' | 'cod';
  notes?: string;
}

const DAY = 86_400_000;

/**
 * NexEats: the food-delivery app built on Nexus Core. Everything it stores is a
 * metadata record (restaurant, menu_item, order, delivery, rider_profile, coupon);
 * order and delivery lifecycles are workflows; side effects are event consumers.
 * This service only adds what generic CRUD can't: pricing, read models and
 * role-specific views. Every write goes through DataService / WorkflowService, so
 * permissions, audit and events apply exactly as for any other module.
 */
@Injectable()
export class FoodService {
  private systemUsers = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly data: DataService,
    private readonly workflow: WorkflowService,
    private readonly auth: AuthService,
  ) {}

  // ── helpers ────────────────────────────────────────────────────────
  rows(tx: Tx, entity: string, where: Prisma.RecordWhereInput = {}, take = 5000) {
    return tx.record.findMany({ where: { entity, deletedAt: null, ...where }, orderBy: { createdAt: 'desc' }, take }).then((r) => r.map(flat));
  }

  async one(tx: Tx, entity: string, id: string) {
    const r = await tx.record.findFirst({ where: { id, entity, deletedAt: null } });
    if (!r) throw new NotFoundException(`${entity} not found`);
    return { raw: r, row: flat(r) };
  }

  /** Runs `fn` as the tenant's automation user (role `system`), keeping the event causation chain. */
  async asSystem<T>(fn: () => Promise<T>, tenantId = currentTenantId()): Promise<T> {
    let userId = this.systemUsers.get(tenantId);
    if (!userId) {
      const link = await this.prisma.tx((tx) => tx.userRole.findFirst({ where: { role: { key: 'system' } }, include: { tenantUser: true } }), tenantId);
      if (!link) throw new Error('No automation user (role "system") in this tenant');
      userId = link.tenantUser.userId;
      this.systemUsers.set(tenantId, userId);
    }
    const user = await this.access.loadUser(tenantId, userId);
    const ctx = (() => { try { return currentContext(); } catch { return undefined; } })();
    return runInContext({ ...(ctx ?? {}), tenantId, user, actor: { type: 'system', id: 'food-autopilot' } }, fn);
  }

  private isAdmin(user: AppUser) {
    return this.access.grants(user, 'order', 'read').some((g) => g.scope === 'all');
  }

  private publicRestaurant(r: Row): Row & { etaMinutes: number } {
    const { ownerId: _o, orgUnitId: _u, ...rest } = r;
    return { ...rest, etaMinutes: etaMinutes(num(r.prepMinutes, 15), 3) } as Row & { etaMinutes: number };
  }

  // ── catalogue (public) ─────────────────────────────────────────────
  async restaurants() {
    return this.prisma.tx(async (tx) => {
      const restaurants = await this.rows(tx, 'restaurant');
      const items = await this.rows(tx, 'menu_item');
      return restaurants
        .map((r) => {
          const menu = items.filter((m) => m.restaurantId === r.id);
          return { ...this.publicRestaurant(r), dishes: menu.filter((m) => m.bestseller).slice(0, 3).map((m) => m.name), minPrice: Math.min(...menu.map((m) => num(m.price))) };
        })
        .sort((a, b) => Number((b as Row).isOpen) - Number((a as Row).isOpen) || num((b as Row).rating) - num((a as Row).rating));
    });
  }

  async restaurant(id: string) {
    return this.prisma.tx(async (tx) => {
      const { row } = await this.one(tx, 'restaurant', id);
      const menu = await tx.record.findMany({ where: { entity: 'menu_item', deletedAt: null, data: { path: ['restaurantId'], equals: id } }, orderBy: { createdAt: 'asc' } });
      return { restaurant: this.publicRestaurant(row), menu: menu.map(flat).map(({ ownerId: _o, orgUnitId: _u, ...m }) => m) };
    });
  }

  async search(q: string) {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return { restaurants: [], dishes: [] };
    return this.prisma.tx(async (tx) => {
      const restaurants = await this.rows(tx, 'restaurant');
      const items = await this.rows(tx, 'menu_item');
      const byId = new Map(restaurants.map((r) => [r.id, r]));
      return {
        restaurants: restaurants.filter((r) => `${r.name} ${r.cuisines} ${r.area}`.toLowerCase().includes(term)).map((r) => this.publicRestaurant(r)),
        dishes: items
          .filter((m) => `${m.name} ${m.category}`.toLowerCase().includes(term))
          .slice(0, 40)
          .map((m) => ({ id: m.id, name: m.name, price: m.price, veg: m.veg, emoji: m.emoji, available: m.available, restaurantId: m.restaurantId, restaurantName: byId.get(String(m.restaurantId))?.name, isOpen: byId.get(String(m.restaurantId))?.isOpen })),
      };
    });
  }

  async offers() {
    return this.prisma.tx(async (tx) => (await this.rows(tx, 'coupon')).filter((c) => c.active).map(({ ownerId: _o, orgUnitId: _u, ...c }) => c));
  }

  /** Server-side pricing. The client never sends prices. */
  async quote(input: CartInput, tx?: Tx): Promise<{
    restaurant: Row; lines: { id: string; name: string; price: number; qty: number; veg: boolean }[];
    itemTotal: number; deliveryFee: number; platformFee: number; taxes: number; discount: number; coupon: string | null; couponError?: string;
    total: number; distanceKm: number; etaMinutes: number;
  }> {
    if (!tx) return this.prisma.tx((t) => this.quote(input, t));
    const { row: restaurant } = await this.one(tx, 'restaurant', input.restaurantId);
    const ids = [...new Set(input.items.map((i) => i.id))];
    const items = (await tx.record.findMany({ where: { entity: 'menu_item', id: { in: ids }, deletedAt: null } })).map(flat);
    const lines = input.items.map((line) => {
      const m = items.find((x) => x.id === line.id);
      if (!m || m.restaurantId !== restaurant.id) throw new BadRequestException('An item in your cart is not on this menu');
      if (m.available === false) throw new BadRequestException(`${m.name} is sold out right now`);
      return { id: m.id, name: String(m.name), price: num(m.price), qty: line.qty, veg: !!m.veg };
    });
    const itemTotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const distanceKm = input.lat !== undefined && input.lng !== undefined ? round1(km(num(restaurant.lat), num(restaurant.lng), input.lat, input.lng)) : 3;
    const fee = deliveryFee(distanceKm);
    const taxes = Math.round(itemTotal * 0.05);
    let discount = 0, coupon: string | null = null, couponError: string | undefined;
    if (input.coupon?.trim()) {
      const code = input.coupon.trim().toUpperCase();
      const c = (await this.rows(tx, 'coupon')).find((x) => String(x.code).toUpperCase() === code && x.active);
      if (!c) couponError = 'This coupon is not valid';
      else if (itemTotal < num(c.minOrder)) couponError = `Add ₹${num(c.minOrder) - itemTotal} more to use ${code}`;
      else {
        coupon = code;
        discount = c.kind === 'percent' ? Math.min(num(c.maxDiscount), Math.round((itemTotal * num(c.value)) / 100)) : c.kind === 'flat' ? num(c.value) : Math.min(fee, num(c.maxDiscount, fee));
      }
    }
    const platformFee = 5;
    return {
      restaurant, lines, itemTotal, deliveryFee: fee, platformFee, taxes, discount, coupon, couponError,
      total: Math.max(0, itemTotal + fee + platformFee + taxes - discount), distanceKm, etaMinutes: etaMinutes(num(restaurant.prepMinutes, 15), distanceKm),
    };
  }

  // ── customer ───────────────────────────────────────────────────────
  async signup(input: { name: string; email: string; password: string }, meta: { ip?: string; userAgent?: string }) {
    const tenantId = currentTenantId();
    const email = input.email.toLowerCase();
    const tenant = await this.prisma.system.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (!tenant.modules.includes('food')) throw new BadRequestException('This workspace has no food module');
    const existing = await this.prisma.system.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered. Please sign in.');
    const user = await this.prisma.system.user.create({ data: { email, name: input.name, passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }) } });
    await this.prisma.tx(async (tx) => {
      const role = await tx.role.findFirstOrThrow({ where: { key: 'customer' } });
      const tu = await tx.tenantUser.create({ data: { tenantId, userId: user.id } });
      await tx.userRole.create({ data: { tenantId, tenantUserId: tu.id, roleId: role.id } });
    });
    return this.auth.issue(user.id, tenant, meta);
  }

  async placeOrder(input: PlaceOrderInput) {
    const user = currentUser();
    const q = await this.quote(input);
    if (q.restaurant.isOpen === false) throw new BadRequestException(`${q.restaurant.name} is closed right now`);
    if (q.couponError) throw new BadRequestException(q.couponError);
    if (!q.lines.length) throw new BadRequestException('Your cart is empty');
    const paid = input.paymentMethod !== 'cod';
    const created = await this.data.create('order', {
      customerName: user.name, restaurantName: q.restaurant.name, total: q.total, paymentMethod: input.paymentMethod,
      paymentStatus: paid ? 'paid' : 'cod_pending', paymentRef: paid ? `DEMO-${randomBytes(4).toString('hex').toUpperCase()}` : null,
      itemCount: q.lines.reduce((s, l) => s + l.qty, 0), restaurantId: q.restaurant.id, items: q.lines,
      itemTotal: q.itemTotal, deliveryFee: q.deliveryFee, platformFee: q.platformFee, taxes: q.taxes, discount: q.discount, coupon: q.coupon,
      address: input.address, dropLat: input.lat, dropLng: input.lng, distanceKm: q.distanceKm, etaMinutes: q.etaMinutes,
      notes: input.notes?.trim() || null, prepSeconds: 30 + Math.round(Math.random() * 25),
    }, { orgUnitId: q.restaurant.orgUnitId });
    return { id: created.id, number: created.number, status: created.status, total: q.total };
  }

  async myOrders() {
    const user = currentUser();
    this.access.assert(user, 'order', 'read');
    return this.prisma.tx(async (tx) => {
      const orders = await this.rows(tx, 'order', { ownerId: user.userId }, 60);
      const restaurants = new Map((await this.rows(tx, 'restaurant')).map((r) => [r.id, r]));
      return orders.map((o) => ({ ...o, restaurantEmoji: restaurants.get(String(o.restaurantId))?.emoji, restaurantTheme: restaurants.get(String(o.restaurantId))?.theme }));
    });
  }

  /** Everything the tracking screen needs; visible to the customer, the restaurant, the assigned rider and ops. */
  async track(orderId: string) {
    const user = currentUser();
    return this.prisma.tx(async (tx) => {
      const { raw, row: order } = await this.one(tx, 'order', orderId);
      const delivery = order.deliveryId ? (await tx.record.findFirst({ where: { id: String(order.deliveryId), entity: 'delivery' } })) : null;
      const allowed = this.access.allowsRecord(user, this.access.grants(user, 'order', 'read'), raw) || delivery?.ownerId === user.userId;
      if (!allowed) throw new ForbiddenException('You cannot view this order');
      const { row: restaurant } = await this.one(tx, 'restaurant', String(order.restaurantId));
      const instance = await tx.workflowInstance.findFirst({ where: { entity: 'order', recordId: orderId } });
      const history = instance ? await tx.workflowHistory.findMany({ where: { instanceId: instance.id }, orderBy: { createdAt: 'asc' } }) : [];
      const rider = delivery ? (await tx.record.findFirst({ where: { entity: 'rider_profile', ownerId: delivery.ownerId } })) : null;
      return {
        order,
        restaurant: { id: restaurant.id, name: restaurant.name, area: restaurant.area, lat: restaurant.lat, lng: restaurant.lng, emoji: restaurant.emoji, theme: restaurant.theme, phone: restaurant.phone },
        delivery: delivery ? flat(delivery) : null,
        rider: rider ? { name: (rider.data as Row).name, vehicle: (rider.data as Row).vehicle, rating: (rider.data as Row).rating, phone: (rider.data as Row).phone } : null,
        timeline: [{ state: 'placed', at: raw.createdAt }, ...history.map((h) => ({ state: h.toState, at: h.createdAt, comment: h.comment }))],
        serverTime: Date.now(),
      };
    });
  }

  async cancel(orderId: string, reason: string) {
    const user = currentUser();
    const order = await this.prisma.tx((tx) => this.one(tx, 'order', orderId));
    if (order.raw.ownerId !== user.userId && !this.isAdmin(user)) throw new ForbiddenException();
    await this.workflow.transition('order', orderId, 'cancel', reason || 'Cancelled by customer');
    return { ok: true };
  }

  async rate(orderId: string, input: { foodRating: number; riderRating?: number; review?: string }) {
    const user = currentUser();
    const { row } = await this.prisma.tx((tx) => this.one(tx, 'order', orderId));
    if (row.ownerId !== user.userId) throw new ForbiddenException();
    if (row.status !== 'delivered') throw new BadRequestException('You can rate after delivery');
    if (row.foodRating) throw new ConflictException('Already rated');
    await this.asSystem(async () => {
      await this.data.update('order', orderId, { foodRating: input.foodRating, riderRating: input.riderRating ?? null, review: input.review?.trim() || null });
      const { row: r } = await this.prisma.tx((tx) => this.one(tx, 'restaurant', String(row.restaurantId)));
      const count = num(r.ratingCount);
      await this.data.update('restaurant', r.id, { rating: round1((num(r.rating) * count + input.foodRating) / (count + 1)), ratingCount: count + 1 });
    });
    return { ok: true };
  }

  // ── restaurant partner ─────────────────────────────────────────────
  private async myRestaurant(tx: Tx, user: AppUser, restaurantId?: string) {
    const restaurants = await this.rows(tx, 'restaurant');
    const r = this.isAdmin(user)
      ? restaurants.find((x) => x.id === restaurantId) ?? restaurants.find((x) => x.orgUnitId && user.orgUnitIds.includes(x.orgUnitId)) ?? restaurants[restaurants.length - 1]
      : restaurants.find((x) => x.orgUnitId && user.orgUnitIds.includes(x.orgUnitId));
    if (!r) throw new ForbiddenException('No restaurant is linked to your account');
    return r;
  }

  async partnerBoard(restaurantId?: string) {
    const user = currentUser();
    return this.prisma.tx(async (tx) => {
      const restaurant = await this.myRestaurant(tx, user, restaurantId);
      const since = new Date(Date.now() - DAY);
      const orders = await this.rows(tx, 'order', { orgUnitId: restaurant.orgUnitId, OR: [{ status: { in: ACTIVE_ORDER } }, { createdAt: { gte: since } }] }, 300);
      const today = dayKey(new Date());
      const todays = orders.filter((o) => dayKey(o.createdAt) === today);
      const delivered = todays.filter((o) => o.status === 'delivered');
      return {
        restaurant,
        active: orders.filter((o) => ACTIVE_ORDER.includes(String(o.status))).sort((a, b) => +a.createdAt - +b.createdAt),
        recent: orders.filter((o) => !ACTIVE_ORDER.includes(String(o.status))).slice(0, 25),
        today: {
          orders: todays.length, delivered: delivered.length,
          sales: delivered.reduce((s, o) => s + num(o.itemTotal), 0),
          declined: todays.filter((o) => o.status === 'rejected').length,
        },
        restaurants: this.isAdmin(user) ? (await this.rows(tx, 'restaurant')).map((r) => ({ id: r.id, name: r.name })) : undefined,
        serverTime: Date.now(),
      };
    });
  }

  async partnerAction(orderId: string, action: 'accept' | 'reject' | 'ready', comment?: string) {
    const user = currentUser();
    await this.prisma.tx(async (tx) => {
      const { raw } = await this.one(tx, 'order', orderId);
      if (!this.isAdmin(user) && !(raw.orgUnitId && user.orgUnitIds.includes(raw.orgUnitId))) throw new ForbiddenException('Not your restaurant’s order');
    });
    return this.workflow.transition('order', orderId, action, comment);
  }

  async partnerMenu(restaurantId?: string) {
    const user = currentUser();
    return this.prisma.tx(async (tx) => {
      const restaurant = await this.myRestaurant(tx, user, restaurantId);
      const menu = await tx.record.findMany({ where: { entity: 'menu_item', deletedAt: null, data: { path: ['restaurantId'], equals: restaurant.id } }, orderBy: { createdAt: 'asc' } });
      return { restaurant, menu: menu.map(flat) };
    });
  }

  async addMenuItem(input: { restaurantId?: string; name: string; price: number; category: string; veg: boolean; emoji?: string; description?: string }) {
    const user = currentUser();
    const restaurant = await this.prisma.tx((tx) => this.myRestaurant(tx, user, input.restaurantId));
    return this.data.create('menu_item', {
      name: input.name, price: input.price, category: input.category, veg: input.veg, emoji: input.emoji || '🍽️', description: input.description ?? '',
      available: true, bestseller: false, restaurantId: restaurant.id, restaurantName: restaurant.name,
    }, { orgUnitId: restaurant.orgUnitId, ownerId: restaurant.ownerId });
  }

  async partnerInsights(restaurantId?: string) {
    const user = currentUser();
    return this.prisma.tx(async (tx) => {
      const restaurant = await this.myRestaurant(tx, user, restaurantId);
      const orders = await this.rows(tx, 'order', { orgUnitId: restaurant.orgUnitId, createdAt: { gte: new Date(Date.now() - 14 * DAY) } });
      const days = Array.from({ length: 14 }, (_, i) => dayKey(new Date(Date.now() - (13 - i) * DAY)));
      const delivered = orders.filter((o) => o.status === 'delivered');
      const dishes = new Map<string, { name: string; qty: number; revenue: number }>();
      for (const o of delivered) for (const l of (o.items as { name: string; qty: number; price: number }[]) ?? []) {
        const d = dishes.get(l.name) ?? { name: l.name, qty: 0, revenue: 0 };
        d.qty += l.qty; d.revenue += l.qty * l.price; dishes.set(l.name, d);
      }
      const rated = delivered.filter((o) => o.foodRating);
      return {
        restaurant,
        days,
        orders: days.map((d) => orders.filter((o) => dayKey(o.createdAt) === d).length),
        sales: days.map((d) => delivered.filter((o) => dayKey(o.createdAt) === d).reduce((s, o) => s + num(o.itemTotal), 0)),
        hours: Array.from({ length: 24 }, (_, h) => orders.filter((o) => istHour(o.createdAt) === h).length),
        topDishes: [...dishes.values()].sort((a, b) => b.qty - a.qty).slice(0, 8),
        ratings: [5, 4, 3, 2, 1].map((s) => ({ stars: s, count: rated.filter((o) => Math.round(num(o.foodRating)) === s).length })),
        reviews: rated.filter((o) => o.review).slice(0, 8).map((o) => ({ number: o.number, customer: o.customerName, rating: o.foodRating, review: o.review, at: o.createdAt })),
        totals: {
          orders: orders.length, delivered: delivered.length, sales: delivered.reduce((s, o) => s + num(o.itemTotal), 0),
          avgOrder: delivered.length ? Math.round(delivered.reduce((s, o) => s + num(o.itemTotal), 0) / delivered.length) : 0,
          declineRate: orders.length ? round1((orders.filter((o) => o.status === 'rejected').length / orders.length) * 100) : 0,
        },
      };
    });
  }

  // ── delivery partner ───────────────────────────────────────────────
  async riderHome() {
    const user = currentUser();
    return this.prisma.tx(async (tx) => {
      const profileRaw = await tx.record.findFirst({ where: { entity: 'rider_profile', ownerId: user.userId, deletedAt: null } });
      if (!profileRaw) throw new ForbiddenException('No rider profile on this account');
      const deliveries = await this.rows(tx, 'delivery', { ownerId: user.userId, createdAt: { gte: new Date(Date.now() - 7 * DAY) } }, 400);
      const active = deliveries.find((d) => ACTIVE_DELIVERY.includes(String(d.status))) ?? null;
      let order: Row | null = null;
      if (active) {
        const o = await tx.record.findFirst({ where: { id: String(active.orderId), entity: 'order' } });
        if (o) {
          const r = flat(o);
          order = { ...r, ownerId: '', items: r.items, notes: r.notes } as Row;
        }
      }
      const done = deliveries.filter((d) => d.status === 'delivered');
      const today = dayKey(new Date());
      const days = Array.from({ length: 7 }, (_, i) => dayKey(new Date(Date.now() - (6 - i) * DAY)));
      const todays = done.filter((d) => dayKey(new Date(String(d.deliveredAt ?? d.updatedAt))) === today);
      return {
        profile: flat(profileRaw), active, order,
        today: { trips: todays.length, earnings: todays.reduce((s, d) => s + num(d.payout), 0), km: round1(todays.reduce((s, d) => s + num(d.distanceKm), 0)) },
        week: { days, earnings: days.map((d) => done.filter((x) => dayKey(new Date(String(x.deliveredAt ?? x.updatedAt))) === d).reduce((s, x) => s + num(x.payout), 0)), trips: done.length },
        trips: done.slice(0, 15),
        serverTime: Date.now(),
      };
    });
  }

  async riderOnline(online: boolean) {
    const user = currentUser();
    const profile = await this.prisma.tx((tx) => tx.record.findFirst({ where: { entity: 'rider_profile', ownerId: user.userId, deletedAt: null } }));
    if (!profile) throw new ForbiddenException('No rider profile on this account');
    return this.data.update('rider_profile', profile.id, { online });
  }

  async riderAction(deliveryId: string, action: 'pick_up' | 'deliver') {
    const user = currentUser();
    await this.prisma.tx(async (tx) => {
      const { raw, row } = await this.one(tx, 'delivery', deliveryId);
      if (raw.ownerId !== user.userId && !this.isAdmin(user)) throw new ForbiddenException('Not your trip');
      if (action === 'pick_up') {
        const order = await tx.record.findFirst({ where: { id: String(row.orderId), entity: 'order' } });
        if (order?.status !== 'ready') throw new BadRequestException('The restaurant has not marked the food ready yet');
      }
    });
    return this.workflow.transition('delivery', deliveryId, action);
  }

  // ── admin / ops ────────────────────────────────────────────────────
  private assertOps() {
    const user = currentUser();
    if (!this.isAdmin(user)) throw new ForbiddenException('Operations access required');
  }

  async live() {
    this.assertOps();
    return this.prisma.tx(async (tx) => {
      const since = new Date(Date.now() - DAY);
      const orders = await this.rows(tx, 'order', { OR: [{ status: { in: ACTIVE_ORDER } }, { createdAt: { gte: since } }] }, 1000);
      const deliveries = await this.rows(tx, 'delivery', { status: { in: ACTIVE_DELIVERY } });
      const riders = await this.rows(tx, 'rider_profile');
      const restaurants = await this.rows(tx, 'restaurant');
      const today = dayKey(new Date());
      const todays = orders.filter((o) => dayKey(o.createdAt) === today);
      const delivered = todays.filter((o) => o.status === 'delivered');
      const busy = new Set(deliveries.map((d) => d.ownerId));
      return {
        active: orders.filter((o) => ACTIVE_ORDER.includes(String(o.status))),
        deliveries,
        riders: riders.map((r) => ({ ...r, busy: busy.has(r.ownerId) })),
        restaurants: restaurants.map((r) => ({ id: r.id, name: r.name, lat: r.lat, lng: r.lng, isOpen: r.isOpen, emoji: r.emoji, area: r.area })),
        counters: {
          activeOrders: orders.filter((o) => ACTIVE_ORDER.includes(String(o.status))).length,
          ridersOnline: riders.filter((r) => r.online).length, ridersBusy: busy.size,
          ordersToday: todays.length, gmvToday: delivered.reduce((s, o) => s + num(o.total), 0),
          cancelledToday: todays.filter((o) => o.status === 'cancelled' || o.status === 'rejected').length,
          openRestaurants: restaurants.filter((r) => r.isOpen).length, restaurants: restaurants.length,
        },
        recent: orders.slice(0, 30),
        serverTime: Date.now(),
      };
    });
  }

  async insights(daysBack = 30) {
    this.assertOps();
    return this.prisma.tx(async (tx) => {
      const orders = await this.rows(tx, 'order', { createdAt: { gte: new Date(Date.now() - daysBack * DAY) } }, 20000);
      const days = Array.from({ length: daysBack }, (_, i) => dayKey(new Date(Date.now() - (daysBack - 1 - i) * DAY)));
      const delivered = orders.filter((o) => o.status === 'delivered');
      const byDay = (d: string) => delivered.filter((o) => dayKey(o.createdAt) === d);
      const perRestaurant = new Map<string, { name: string; orders: number; gmv: number; ratingSum: number; rated: number; declined: number }>();
      for (const o of orders) {
        const key = String(o.restaurantName);
        const r = perRestaurant.get(key) ?? { name: key, orders: 0, gmv: 0, ratingSum: 0, rated: 0, declined: 0 };
        r.orders++;
        if (o.status === 'delivered') r.gmv += num(o.total);
        if (o.status === 'rejected') r.declined++;
        if (o.foodRating) { r.ratingSum += num(o.foodRating); r.rated++; }
        perRestaurant.set(key, r);
      }
      const dishes = new Map<string, { name: string; restaurant: string; qty: number }>();
      for (const o of delivered) for (const l of (o.items as { name: string; qty: number }[]) ?? []) {
        const key = `${l.name}|${o.restaurantName}`;
        const d = dishes.get(key) ?? { name: l.name, restaurant: String(o.restaurantName), qty: 0 };
        d.qty += l.qty; dishes.set(key, d);
      }
      const customers = new Map<string, number>();
      for (const o of orders) customers.set(o.ownerId, (customers.get(o.ownerId) ?? 0) + 1);
      const gmv = delivered.reduce((s, o) => s + num(o.total), 0);
      const withMinutes = delivered.filter((o) => num(o.deliveryMinutes) > 0);
      return {
        days,
        orders: days.map((d) => orders.filter((o) => dayKey(o.createdAt) === d).length),
        gmv: days.map((d) => byDay(d).reduce((s, o) => s + num(o.total), 0)),
        deliveryMinutes: days.map((d) => { const x = byDay(d).filter((o) => num(o.deliveryMinutes) > 0); return x.length ? Math.round(x.reduce((s, o) => s + num(o.deliveryMinutes), 0) / x.length) : 0; }),
        hours: Array.from({ length: 24 }, (_, h) => orders.filter((o) => istHour(o.createdAt) === h).length),
        status: ['delivered', 'cancelled', 'rejected', ...ACTIVE_ORDER].map((s) => ({ status: s, count: orders.filter((o) => o.status === s).length })).filter((s) => s.count),
        payments: ['upi', 'card', 'cod'].map((m) => ({ method: m, count: orders.filter((o) => o.paymentMethod === m).length })),
        coupons: [...new Set(orders.map((o) => o.coupon).filter(Boolean))].map((c) => ({ code: String(c), uses: orders.filter((o) => o.coupon === c).length, discount: orders.filter((o) => o.coupon === c).reduce((s, o) => s + num(o.discount), 0) })),
        restaurants: [...perRestaurant.values()].map((r) => ({ name: r.name, orders: r.orders, gmv: r.gmv, rating: r.rated ? round1(r.ratingSum / r.rated) : null, declineRate: round1((r.declined / r.orders) * 100) })).sort((a, b) => b.gmv - a.gmv),
        dishes: [...dishes.values()].sort((a, b) => b.qty - a.qty).slice(0, 10),
        totals: {
          orders: orders.length, delivered: delivered.length, gmv, aov: delivered.length ? Math.round(gmv / delivered.length) : 0,
          avgDeliveryMinutes: withMinutes.length ? Math.round(withMinutes.reduce((s, o) => s + num(o.deliveryMinutes), 0) / withMinutes.length) : 0,
          cancelRate: orders.length ? round1((orders.filter((o) => o.status === 'cancelled' || o.status === 'rejected').length / orders.length) * 100) : 0,
          customers: customers.size, repeatCustomers: [...customers.values()].filter((n) => n > 1).length,
          discounts: orders.reduce((s, o) => s + num(o.discount), 0),
        },
      };
    });
  }
}
