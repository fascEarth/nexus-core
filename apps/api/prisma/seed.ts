/**
 * Demo tenant "nexeats": a full food-delivery business built on Nexus Core.
 * Restaurants, menus, orders, deliveries, riders and coupons are metadata
 * entities; order and delivery lifecycles are workflows; automations are rules
 * and event consumers. Run: npm run db:seed (uses the owner connection).
 *
 * Every demo login uses the password Demo@12345:
 *   customer@nexeats.test  (customer app)      partner@nexeats.test (restaurant partner app)
 *   rider@nexeats.test     (delivery partner)  admin@nexeats.test   (admin console)
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import { COUPONS, DELIVERY_WORKFLOW, DINERS, ENTITIES, LOCALITIES, ORDER_WORKFLOW, RESTAURANTS, RIDERS } from './food-data';

const prisma = new PrismaClient();
const PASSWORD = 'Demo@12345';

let seed = 20261116;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const id = () => crypto.randomUUID();

export function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371, dLat = ((bLat - aLat) * Math.PI) / 180, dLng = ((bLng - aLng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'nexeats' }, update: { modules: ['food'] },
    create: { slug: 'nexeats', name: 'NexEats', modules: ['food'], settings: { city: 'Coimbatore', currency: 'INR' } },
  });
  const t = tenant.id;
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  const role = async (key: string, name: string, perms: { permission: string; scope: string }[]) => {
    const existing = await prisma.role.findUnique({ where: { tenantId_key: { tenantId: t, key } } });
    if (existing) return existing;
    return prisma.role.create({ data: { tenantId: t, key, name, system: true, permissions: { create: perms.map((p) => ({ tenantId: t, ...p })) } } });
  };
  const roles = {
    admin: await role('admin', 'Administrator', [{ permission: '*:*', scope: 'all' }]),
    system: await role('system', 'Automation (autopilot)', [{ permission: '*:*', scope: 'all' }]),
    ops: await role('ops', 'Operations support', [
      { permission: 'order:read', scope: 'all' }, { permission: 'delivery:read', scope: 'all' }, { permission: 'restaurant:read', scope: 'all' },
      { permission: 'rider_profile:read', scope: 'all' }, { permission: 'menu_item:read', scope: 'all' }, { permission: 'coupon:read', scope: 'all' },
    ]),
    restaurant: await role('restaurant', 'Restaurant partner', [
      { permission: 'restaurant:read', scope: 'org_unit' }, { permission: 'restaurant:update', scope: 'org_unit' },
      { permission: 'menu_item:read', scope: 'org_unit' }, { permission: 'menu_item:create', scope: 'org_unit' }, { permission: 'menu_item:update', scope: 'org_unit' },
      { permission: 'order:read', scope: 'org_unit' }, { permission: 'order:update', scope: 'org_unit' }, { permission: 'delivery:read', scope: 'org_unit' },
    ]),
    rider: await role('rider', 'Delivery partner', [
      { permission: 'rider_profile:read', scope: 'own' }, { permission: 'rider_profile:update', scope: 'own' },
      { permission: 'delivery:read', scope: 'own' }, { permission: 'delivery:update', scope: 'own' },
    ]),
    customer: await role('customer', 'Customer', [{ permission: 'order:read', scope: 'own' }, { permission: 'order:create', scope: 'own' }]),
  };

  const company = (await prisma.orgUnit.findFirst({ where: { tenantId: t, kind: 'company' } }))
    ?? (await prisma.orgUnit.create({ data: { tenantId: t, kind: 'company', name: 'NexEats' } }));

  const member = async (email: string, name: string, roleId: string, orgUnitId?: string) => {
    const u = await prisma.user.upsert({ where: { email }, update: {}, create: { email, name, passwordHash: hash } });
    const tu = await prisma.tenantUser.upsert({ where: { tenantId_userId: { tenantId: t, userId: u.id } }, update: {}, create: { tenantId: t, userId: u.id } });
    await prisma.userRole.upsert({ where: { tenantUserId_roleId: { tenantUserId: tu.id, roleId } }, update: {}, create: { tenantId: t, tenantUserId: tu.id, roleId } });
    if (orgUnitId) await prisma.userOrgUnit.create({ data: { tenantId: t, tenantUserId: tu.id, orgUnitId } }).catch(() => undefined);
    return { userId: u.id, name, email };
  };

  const admin = await member('admin@nexeats.test', 'Asha (NexEats Admin)', roles.admin.id, company.id);
  const bot = await member('autopilot@nexeats.test', 'NexEats Autopilot', roles.system.id, company.id);
  await member('ops@nexeats.test', 'Oviya (Ops support)', roles.ops.id, company.id);

  // ── Metadata: entities and workflows ────────────────────────────────
  for (const e of ENTITIES) {
    if (await prisma.entityDef.findUnique({ where: { tenantId_name: { tenantId: t, name: e.name } } })) continue;
    await prisma.entityDef.create({
      data: {
        tenantId: t, name: e.name, label: e.label, pluralLabel: e.pluralLabel, icon: e.icon, numbering: e.numbering, workflowKey: e.workflowKey,
        fields: { create: e.fields.map((fd, i) => ({ tenantId: t, name: fd.name, label: fd.label, type: fd.type, required: !!fd.required, options: fd.options, lookupEntity: fd.lookupEntity, order: i + 1 })) },
      },
    });
  }
  for (const [key, entity, definition] of [['order-lifecycle', 'order', ORDER_WORKFLOW], ['delivery-lifecycle', 'delivery', DELIVERY_WORKFLOW]] as const) {
    await prisma.workflowDef.upsert({
      where: { tenantId_key_version: { tenantId: t, key, version: 1 } }, update: {},
      create: { tenantId: t, key, entity, version: 1, definition: definition as object },
    });
  }

  // ── Rules (no-code automations) ────────────────────────────────────
  const rules = [
    { name: 'Big order alert', eventType: 'record.order.created', condition: { all: [{ fact: 'after.total', operator: 'greaterThan', value: 1200 }] },
      actions: [{ action: 'notify', to: ['role:admin'], title: 'Big order {{after.number}}: ₹{{after.total}}', body: '{{after.customerName}} · {{after.restaurantName}}', link: '/app/order/{{after.id}}' }] },
    { name: 'Low rating follow-up', eventType: 'record.order.updated', condition: { all: [{ fact: 'after.foodRating', operator: 'exists' }, { fact: 'after.foodRating', operator: 'changed' }, { fact: 'after.foodRating', operator: 'lessThanInclusive', value: 2 }] },
      actions: [{ action: 'notify', to: ['role:admin', 'role:ops'], title: 'Low rating on {{after.number}}', body: '{{after.restaurantName}}: {{after.review}}', link: '/app/order/{{after.id}}' }] },
    { name: 'Declined order alert', eventType: 'workflow.order-lifecycle.reject', condition: {},
      actions: [{ action: 'notify', to: ['role:ops'], title: 'Restaurant declined {{record.number}}', body: '{{comment}}', link: '/app/order/{{record.id}}' }] },
  ];
  for (const r of rules) {
    if (!(await prisma.rule.findFirst({ where: { tenantId: t, name: r.name } }))) await prisma.rule.create({ data: { tenantId: t, ...r } });
  }

  const eventTypes = [
    ['record.order.created', 'food', 'A customer placed an order'],
    ['record.order.updated', 'food', 'An order changed (status, rider, rating)'],
    ['workflow.order-lifecycle.accept', 'food', 'Restaurant accepted an order'],
    ['workflow.order-lifecycle.reject', 'food', 'Restaurant declined an order'],
    ['workflow.order-lifecycle.cancel', 'food', 'Customer cancelled an order'],
    ['workflow.order-lifecycle.ready', 'food', 'Food is ready for pickup'],
    ['workflow.order-lifecycle.pick_up', 'food', 'Order is out for delivery'],
    ['workflow.order-lifecycle.deliver', 'food', 'Order delivered'],
    ['record.delivery.created', 'food', 'A rider was assigned'],
    ['workflow.delivery-lifecycle.pick_up', 'food', 'Rider picked up the food'],
    ['workflow.delivery-lifecycle.deliver', 'food', 'Rider completed the drop'],
    ['record.menu_item.updated', 'food', 'Menu item changed (price, availability)'],
    ['record.restaurant.updated', 'food', 'Restaurant changed (open/closed)'],
    ['record.rider_profile.updated', 'food', 'Rider went online/offline'],
    ['metadata.published', 'core', 'Metadata changed'],
    ['notification.created', 'core', 'Notification sent'],
    ['platform.tenant.created', 'platform', 'New workspace'],
  ];
  for (const [type, module, description] of eventTypes) {
    await prisma.eventType.upsert({ where: { type }, update: {}, create: { type, module, description } });
  }

  if (await prisma.record.count({ where: { tenantId: t } })) {
    console.log('NexEats already seeded');
    return;
  }

  // ── Catalogue ──────────────────────────────────────────────────────
  const restaurants: { id: string; seed: (typeof RESTAURANTS)[number]; ownerId: string; orgUnitId: string; menu: { id: string; name: string; price: number; veg: boolean }[] }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const records: Record<string, any>[] = [];
  const rec = (entity: string, data: object, ownerId: string, orgUnitId: string | null, extra: { number?: string; status?: string; createdAt?: Date; version?: number } = {}) => {
    const rid = id();
    records.push({ id: rid, tenantId: t, entity, data, ownerId, orgUnitId, createdBy: ownerId, updatedBy: ownerId, ...extra, updatedAt: extra.createdAt });
    return rid;
  };

  for (const r of RESTAURANTS) {
    const org = await prisma.orgUnit.create({ data: { tenantId: t, kind: 'restaurant', name: r.name, parentId: company.id } });
    const owner = await member(r.owner[0], r.owner[1], roles.restaurant.id, org.id);
    const rid = rec('restaurant', {
      name: r.name, area: r.area, cuisines: r.cuisines, rating: r.rating, isOpen: r.isOpen, costForTwo: r.costForTwo, prepMinutes: r.prepMinutes,
      veg: r.veg, offer: r.offer, ratingCount: 200 + Math.floor(rand() * 4000), emoji: r.emoji, theme: r.theme, lat: r.lat, lng: r.lng, phone: '0422 4' + String(100000 + Math.floor(rand() * 899999)).slice(0, 6),
    }, owner.userId, org.id);
    const menu = r.menu.map(([name, price, category, veg, bestseller, emoji, description]) => ({
      id: rec('menu_item', { name, restaurantName: r.name, category, price, available: true, veg, bestseller, restaurantId: rid, emoji, description }, owner.userId, org.id),
      name, price, veg,
    }));
    restaurants.push({ id: rid, seed: r, ownerId: owner.userId, orgUnitId: org.id, menu });
  }
  for (const c of COUPONS) rec('coupon', c, admin.userId, company.id);

  const riders: { userId: string; name: string; vehicle: string; phone: string; profileId: string }[] = [];
  for (const [i, [email, name, vehicle, phone]] of RIDERS.entries()) {
    const u = await member(email, name, roles.rider.id);
    const [, lat, lng] = LOCALITIES[i % LOCALITIES.length];
    const profileId = rec('rider_profile', { name, vehicle, online: i > 0, rating: Math.round((4.3 + rand() * 0.6) * 10) / 10, zone: LOCALITIES[i % LOCALITIES.length][0], phone, bot: i > 0, lat, lng }, u.userId, null);
    riders.push({ userId: u.userId, name, vehicle, phone, profileId });
  }

  const customer = await member('customer@nexeats.test', 'Priya Sundar', roles.customer.id);
  const diners = [customer];
  for (const [i, name] of DINERS.entries()) diners.push(await member(`diner${i + 1}@nexeats.test`, name, roles.customer.id));

  // ── 30 days of order history ───────────────────────────────────────
  const DAY = 86_400_000, MIN = 60_000;
  const now = Date.now();
  const instances: object[] = [], history: object[] = [];
  let orderSeq = 0, deliverySeq = 0;
  const hourWeights = [0, 0, 0, 0, 0, 0, 0, 1, 3, 3, 2, 2, 7, 9, 6, 3, 2, 3, 4, 6, 9, 8, 5, 2];
  const pickHour = () => { const total = hourWeights.reduce((a, b) => a + b); let x = rand() * total; for (let h = 0; h < 24; h++) { x -= hourWeights[h]; if (x <= 0) return h; } return 20; };

  const flow = (entity: string, key: string, recordId: string, path: [string, string, string, number][], createdAt: Date) => {
    const inst = id();
    const final = path.length ? path[path.length - 1][1] : (key === 'order-lifecycle' ? 'placed' : 'assigned');
    instances.push({ id: inst, tenantId: t, workflowKey: key, version: 1, entity, recordId, state: final, createdAt, updatedAt: path.length ? new Date(path[path.length - 1][3]) : createdAt });
    let from = key === 'order-lifecycle' ? 'placed' : 'assigned';
    for (const [transition, to, actorId, at] of path) {
      history.push({ id: id(), tenantId: t, instanceId: inst, fromState: from, toState: to, transition, actorId, createdAt: new Date(at) });
      from = to;
    }
  };

  for (let back = 30; back >= 1; back--) {
    const weekend = new Date(now - back * DAY + 330 * MIN).getUTCDay() % 6 === 0;
    const perDay = Math.round((24 + rand() * 14) * (weekend ? 1.35 : 1) * (1 + (30 - back) / 60));
    for (let k = 0; k < perDay; k++) {
      // Hours are India time (UTC+5:30) whatever the server's time zone.
      const ist = new Date(now - back * DAY + 330 * MIN);
      const placedAt = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), pickHour(), Math.floor(rand() * 60), Math.floor(rand() * 60)) - 330 * MIN;
      const r = pick(restaurants.filter((x) => x.seed.key !== 'chm' || rand() < 0.6));
      const who = pick(diners);
      const near = LOCALITIES.filter(([, la, ln]) => km(r.seed.lat, r.seed.lng, la, ln) < 5.5);
      const [loc, lat0, lng0] = pick(near.length ? near : LOCALITIES);
      const dropLat = lat0 + (rand() - 0.5) * 0.01, dropLng = lng0 + (rand() - 0.5) * 0.01;
      const lines = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(r.menu));
      const items = [...new Map(lines.map((m) => [m.id, { id: m.id, name: m.name, price: m.price, veg: m.veg, qty: 1 + (rand() < 0.25 ? 1 : 0) }])).values()];
      const itemTotal = items.reduce((s, x) => s + x.price * x.qty, 0);
      const dist = Math.round(km(r.seed.lat, r.seed.lng, dropLat, dropLng) * 10) / 10;
      const deliveryFee = dist < 3 ? 25 : 25 + Math.round((dist - 3) * 8);
      const coupon = rand() < 0.3 ? pick(COUPONS.filter((c) => itemTotal >= c.minOrder)) : undefined;
      const discount = !coupon ? 0 : coupon.kind === 'percent' ? Math.min(coupon.maxDiscount, Math.round((itemTotal * coupon.value) / 100)) : coupon.kind === 'flat' ? coupon.value : deliveryFee;
      const taxes = Math.round(itemTotal * 0.05);
      const total = Math.max(0, itemTotal + deliveryFee + 5 + taxes - discount);
      const paymentMethod = pick(['upi', 'upi', 'upi', 'card', 'cod']);
      const outcome = rand();
      const status = outcome < 0.04 ? 'cancelled' : outcome < 0.07 ? 'rejected' : 'delivered';
      const rider = pick(riders);
      const prepM = r.seed.prepMinutes + Math.round(rand() * 5);
      const travelM = Math.round(3 + dist * 3 + rand() * 5);
      const acceptedAt = placedAt + (0.5 + rand() * 2) * MIN, readyAt = acceptedAt + prepM * MIN, pickedAt = readyAt + (1 + rand() * 3) * MIN, deliveredAt = pickedAt + travelM * MIN;
      const number = `NE-${String(++orderSeq).padStart(5, '0')}`;
      const rated = status === 'delivered' && rand() < 0.55;
      const foodRating = rated ? (rand() < 0.08 ? 2 : rand() < 0.3 ? 4 : 5) : null;
      const data: Record<string, unknown> = {
        customerName: who.name, restaurantName: r.seed.name, total, paymentMethod,
        paymentStatus: status === 'delivered' ? (paymentMethod === 'cod' ? 'cod_collected' : 'paid') : paymentMethod === 'cod' ? 'cod_pending' : 'refunded',
        itemCount: items.reduce((s, x) => s + x.qty, 0), restaurantId: r.id, items, itemTotal, deliveryFee, platformFee: 5, taxes, discount, coupon: coupon?.code ?? null,
        paymentRef: paymentMethod === 'cod' ? null : `DEMO-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        address: `${10 + Math.floor(rand() * 180)}, ${pick(['1st Street', 'Main Road', 'Cross Cut Road', 'Nehru Street', 'Bharathi Park Road'])}, ${loc}, Coimbatore`,
        dropLat, dropLng, distanceKm: dist, etaMinutes: prepM + travelM + 5, notes: null,
      };
      if (status === 'delivered') Object.assign(data, {
        riderName: rider.name, riderId: rider.userId, riderPhone: rider.phone, riderVehicle: rider.vehicle,
        deliveredAt: new Date(deliveredAt).toISOString(), deliveryMinutes: Math.round((deliveredAt - placedAt) / MIN),
        foodRating, riderRating: rated ? (rand() < 0.15 ? 4 : 5) : null,
        review: rated ? pick(['Hot and tasty!', 'Quick delivery, thanks', 'Packaging was great', 'Loved it', 'Portion could be bigger', 'Arrived on time', foodRating === 2 ? 'Food was cold' : 'Will order again']) : null,
      });
      if (status !== 'delivered') data.cancelReason = status === 'cancelled' ? 'Ordered by mistake' : 'Item out of stock';
      const createdAt = new Date(placedAt);
      const orderId = rec('order', data, who.userId, r.orgUnitId, { number, status, createdAt, version: status === 'delivered' ? 5 : 2 });
      records[records.length - 1].updatedAt = new Date(status === 'delivered' ? deliveredAt : acceptedAt);

      if (status === 'delivered') {
        const dnum = `DL-${String(++deliverySeq).padStart(5, '0')}`;
        const did = rec('delivery', {
          orderNumber: number, riderName: rider.name, restaurantName: r.seed.name, customerName: who.name, payout: Math.round(30 + dist * 7), distanceKm: dist,
          orderId, address: data.address, startLat: r.seed.lat + 0.01, startLng: r.seed.lng - 0.01, pickupLat: r.seed.lat, pickupLng: r.seed.lng, dropLat, dropLng,
          approachSeconds: 40, travelSeconds: 90, assignedAt: new Date(acceptedAt).toISOString(), pickedUpAt: new Date(pickedAt).toISOString(), deliveredAt: new Date(deliveredAt).toISOString(),
        }, rider.userId, r.orgUnitId, { number: dnum, status: 'delivered', createdAt: new Date(acceptedAt), version: 3 });
        records[records.length - 1].updatedAt = new Date(deliveredAt);
        data.deliveryId = did;
        flow('order', 'order-lifecycle', orderId, [['accept', 'accepted', r.ownerId, acceptedAt], ['ready', 'ready', r.ownerId, readyAt], ['pick_up', 'picked_up', bot.userId, pickedAt], ['deliver', 'delivered', bot.userId, deliveredAt]], createdAt);
        flow('delivery', 'delivery-lifecycle', did, [['pick_up', 'picked_up', rider.userId, pickedAt], ['deliver', 'delivered', rider.userId, deliveredAt]], new Date(acceptedAt));
      } else if (status === 'cancelled') {
        flow('order', 'order-lifecycle', orderId, [['cancel', 'cancelled', who.userId, placedAt + MIN]], createdAt);
      } else {
        flow('order', 'order-lifecycle', orderId, [['reject', 'rejected', r.ownerId, placedAt + 2 * MIN]], createdAt);
      }
    }
  }

  for (let i = 0; i < records.length; i += 500) await prisma.record.createMany({ data: records.slice(i, i + 500) as never });
  for (let i = 0; i < instances.length; i += 500) await prisma.workflowInstance.createMany({ data: instances.slice(i, i + 500) as never });
  for (let i = 0; i < history.length; i += 1000) await prisma.workflowHistory.createMany({ data: history.slice(i, i + 1000) as never });
  for (const [key, value] of [['order', orderSeq], ['delivery', deliverySeq]] as const) {
    await prisma.sequence.upsert({ where: { tenantId_key: { tenantId: t, key } }, update: { value }, create: { tenantId: t, key, value } });
  }
  await prisma.notification.createMany({
    data: [
      { tenantId: t, userId: admin.userId, title: 'Welcome to NexEats ops', body: 'Live orders, riders and restaurants run on Nexus workflows, rules and events.', link: '/app/ops' },
      { tenantId: t, userId: customer.userId, title: 'WELCOME50 is waiting', body: '50% off up to ₹100 on your next order', link: '/' },
    ],
  });
  console.log(`Seeded NexEats: ${restaurants.length} restaurants, ${riders.length} riders, ${diners.length} customers, ${orderSeq} past orders`);
}

main().finally(() => prisma.$disconnect());
