/**
 * In-browser simulation of the Nexus Core API for public demos.
 * Data lives in this visitor's localStorage only. Tabs talk over BroadcastChannel,
 * so two tabs signed in as different users show live sync, approvals and
 * notifications exactly like the real event bus.
 */
import { HttpErrorResponse, HttpEvent, HttpRequest, HttpResponse } from '@angular/common/http';
import { delay, Observable, of, throwError } from 'rxjs';
import type { CompiledPermission, EntityDefinition, FieldDefinition, LivePatch } from '@nexus/shared-types';
import { Condition, evaluate, renderDeep } from './conditions';

// ───────── types ─────────
interface DemoUser {
  id: string; email: string; password: string; name: string; roles: string[];
  permissions: CompiledPermission[]; managerId?: string;
  fieldMask: Record<string, Record<string, 'hidden' | 'read' | 'write'>>;
}
interface Rec {
  id: string; entity: string; number: string | null; status: string | null; version: number; ownerId: string;
  createdAt: string; updatedAt: string; data: Record<string, unknown>;
}
interface WfState { label: string; final?: boolean; task?: { assignee?: 'manager' | 'owner'; role?: string; dueHours?: number } }
interface WfTransition { name: string; label?: string; from: string | string[]; to: string; by?: { owner?: boolean; roles?: string[]; assignee?: boolean }; condition?: Condition; requireComment?: boolean }
interface WfDef { initial: string; states: Record<string, WfState>; transitions: WfTransition[] }
interface Instance {
  key: string; entity: string; recordId: string; state: string;
  tasks: { id: string; state: string; assigneeId: string | null; roleKey: string | null; status: 'open' | 'done'; createdAt: string; dueAt: string | null }[];
  history: { fromState: string; toState: string; transition: string; actorId: string; comment?: string; createdAt: string }[];
}
interface Note { id: string; userId: string; title: string; body?: string; link?: string; readAt?: string; createdAt: string }
interface Rule { id: string; name: string; eventType: string; condition: Condition | Record<string, never>; actions: Record<string, unknown>[]; active: boolean }
interface Audit { entity: string; entityId: string; action: string; actorType: string; actorId: string; before?: unknown; after?: unknown; createdAt: string }
interface OutboxRow { id: string; type: string; createdAt: string; actorId: string; entity?: { name: string; id: string }; correlationId: string }
interface Db {
  outbox?: OutboxRow[]; status?: Record<string, 'active' | 'suspended'>; lastLogin?: Record<string, string>;
  v: number; users: DemoUser[]; entities: (EntityDefinition & { fields: FieldDefinition[] })[]; workflows: Record<string, WfDef>;
  records: Rec[]; instances: Instance[]; notifications: Note[]; rules: Rule[]; audit: Audit[]; seq: Record<string, number>;
}
export interface DemoEvent { id: string; type: string; entity?: { name: string; id: string }; data: Record<string, unknown>; notifyUserIds?: string[]; notification?: { title: string; body?: string; link?: string } }

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const KEY = 'nexus.demo.db.v1';
const TENANT = { id: 't-demo', slug: 'acme', name: 'Acme Corp' };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const now = () => new Date().toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

// ───────── seed ─────────
function seed(): Db {
  const leavePerms = (scopeRead: 'own' | 'team'): CompiledPermission[] => [
    { key: 'leave:read', scope: scopeRead }, { key: 'leave:create', scope: 'own' }, { key: 'leave:update', scope: 'own' },
    { key: 'expense:read', scope: scopeRead }, { key: 'expense:create', scope: 'own' }, { key: 'expense:update', scope: 'own' },
  ];
  const users: DemoUser[] = [
    { id: 'u-admin', email: 'admin@acme.test', password: 'Admin@12345', name: 'Asha Admin', roles: ['admin'], permissions: [{ key: '*:*', scope: 'all' }], fieldMask: {} },
    { id: 'u-mgr', email: 'manager@acme.test', password: 'Manager@12345', name: 'Murali Manager', roles: ['manager'],
      permissions: [...leavePerms('team'), { key: 'leave:approve', scope: 'team' }, { key: 'expense:approve', scope: 'team' }, { key: 'rules:read', scope: 'all' }], fieldMask: {} },
    { id: 'u-emp', email: 'employee@acme.test', password: 'Employee@12345', name: 'Elan Employee', roles: ['employee'], managerId: 'u-mgr',
      permissions: leavePerms('own'), fieldMask: { leave: { approverNote: 'read' }, expense: { financeNote: 'hidden' } } },
    { id: 'u-priya', email: 'priya@acme.test', password: 'Priya@12345', name: 'Priya Sharma', roles: ['employee'], managerId: 'u-mgr',
      permissions: leavePerms('own'), fieldMask: { leave: { approverNote: 'read' }, expense: { financeNote: 'hidden' } } },
  ];
  for (const [id, name] of [['u-karthik', 'Karthik Nair'], ['u-zara', 'Zara Khan'], ['u-vikram', 'Vikram Das']]) {
    users.push({ id, email: `${name.split(' ')[0].toLowerCase()}@acme.test`, password: 'Employee@12345', name, roles: ['employee'], managerId: 'u-mgr',
      permissions: leavePerms('own'), fieldMask: { leave: { approverNote: 'read' }, expense: { financeNote: 'hidden' } } });
  }
  const entities: Db['entities'] = [
    { name: 'leave', label: 'Leave request', pluralLabel: 'Leave requests', numbering: 'LV-{YYYY}-{####}', workflowKey: 'leave-approval', fields: [
      { name: 'leaveType', label: 'Leave type', type: 'select', required: true, options: ['Casual', 'Sick', 'Earned', 'Unpaid'] },
      { name: 'fromDate', label: 'From', type: 'date', required: true },
      { name: 'toDate', label: 'To', type: 'date', required: true },
      { name: 'days', label: 'Days', type: 'number', required: true },
      { name: 'reason', label: 'Reason', type: 'textarea' },
      { name: 'approverNote', label: 'Approver note', type: 'textarea' },
    ] },
    { name: 'expense', label: 'Expense claim', pluralLabel: 'Expense claims', numbering: 'EXP-{YYYY}-{####}', workflowKey: 'expense-approval', fields: [
      { name: 'category', label: 'Category', type: 'select', required: true, options: ['Travel', 'Meals', 'Equipment', 'Software', 'Other'] },
      { name: 'amount', label: 'Amount (₹)', type: 'money', required: true },
      { name: 'spentOn', label: 'Date', type: 'date', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'financeNote', label: 'Finance note', type: 'textarea' },
    ] },
  ];
  const workflows: Db['workflows'] = {
    'leave-approval': {
      initial: 'draft',
      states: {
        draft: { label: 'Draft' }, submitted: { label: 'Manager review', task: { assignee: 'manager', dueHours: 24 } },
        hr_review: { label: 'HR review', task: { role: 'admin', dueHours: 48 } }, approved: { label: 'Approved', final: true }, rejected: { label: 'Rejected', final: true },
      },
      transitions: [
        { name: 'submit', label: 'Submit', from: 'draft', to: 'submitted', by: { owner: true } },
        { name: 'approve', label: 'Approve', from: 'submitted', to: 'approved', by: { assignee: true }, condition: { fact: 'record.days', operator: 'lessThanInclusive', value: 5 } },
        { name: 'escalate', label: 'Approve → HR', from: 'submitted', to: 'hr_review', by: { assignee: true }, condition: { fact: 'record.days', operator: 'greaterThan', value: 5 } },
        { name: 'hr_approve', label: 'HR approve', from: 'hr_review', to: 'approved', by: { roles: ['admin'] } },
        { name: 'reject', label: 'Reject', from: ['submitted', 'hr_review'], to: 'rejected', by: { assignee: true, roles: ['admin'] }, requireComment: true },
        { name: 'send_back', label: 'Send back', from: 'submitted', to: 'draft', by: { assignee: true }, requireComment: true },
      ],
    },
    'expense-approval': {
      initial: 'draft',
      states: {
        draft: { label: 'Draft' }, submitted: { label: 'Manager review', task: { assignee: 'manager', dueHours: 24 } },
        finance: { label: 'Finance review', task: { role: 'admin', dueHours: 48 } }, approved: { label: 'Approved', final: true }, rejected: { label: 'Rejected', final: true },
      },
      transitions: [
        { name: 'submit', label: 'Submit', from: 'draft', to: 'submitted', by: { owner: true } },
        { name: 'approve', label: 'Approve', from: 'submitted', to: 'approved', by: { assignee: true }, condition: { fact: 'record.amount', operator: 'lessThanInclusive', value: 10000 } },
        { name: 'to_finance', label: 'Approve → Finance', from: 'submitted', to: 'finance', by: { assignee: true }, condition: { fact: 'record.amount', operator: 'greaterThan', value: 10000 } },
        { name: 'finance_approve', label: 'Finance approve', from: 'finance', to: 'approved', by: { roles: ['admin'] } },
        { name: 'reject', label: 'Reject', from: ['submitted', 'finance'], to: 'rejected', by: { assignee: true, roles: ['admin'] }, requireComment: true },
      ],
    },
  };
  const db: Db = { v: 1, users, entities, workflows, records: [], instances: [], notifications: [], rules: [], audit: [], seq: {} };
  const y = new Date().getFullYear();
  const add = (entity: string, owner: string, number: string, data: Record<string, unknown>, state: string, ago: number, history: Instance['history'] = []) => {
    const r: Rec = { id: uid(), entity, number, status: state, version: 1, ownerId: owner, createdAt: daysAgo(ago), updatedAt: daysAgo(ago), data };
    db.records.push(r);
    const inst: Instance = { key: `${entity}-approval`, entity, recordId: r.id, state, tasks: [], history };
    const spec = workflows[inst.key].states[state];
    if (spec.task) inst.tasks.push({ id: uid(), state, assigneeId: spec.task.assignee === 'manager' ? 'u-mgr' : null, roleKey: spec.task.role ?? null, status: 'open', createdAt: daysAgo(ago), dueAt: null });
    db.instances.push(inst);
  };
  add('leave', 'u-priya', `LV-${y}-0001`, { leaveType: 'Casual', fromDate: daysAgo(-3).slice(0, 10), toDate: daysAgo(-4).slice(0, 10), days: 2, reason: 'Family function' }, 'approved', 6,
    [{ fromState: 'draft', toState: 'submitted', transition: 'submit', actorId: 'u-priya', createdAt: daysAgo(6) }, { fromState: 'submitted', toState: 'approved', transition: 'approve', actorId: 'u-mgr', createdAt: daysAgo(5) }]);
  add('leave', 'u-emp', `LV-${y}-0002`, { leaveType: 'Sick', fromDate: daysAgo(-1).slice(0, 10), toDate: daysAgo(-1).slice(0, 10), days: 1, reason: 'Fever' }, 'submitted', 1,
    [{ fromState: 'draft', toState: 'submitted', transition: 'submit', actorId: 'u-emp', createdAt: daysAgo(1) }]);
  add('leave', 'u-emp', `LV-${y}-0003`, { leaveType: 'Earned', fromDate: daysAgo(-20).slice(0, 10), toDate: daysAgo(-26).slice(0, 10), days: 7, reason: 'Trip to Kodaikanal' }, 'draft', 0);
  add('expense', 'u-priya', `EXP-${y}-0001`, { category: 'Travel', amount: 4500, spentOn: daysAgo(3).slice(0, 10), description: 'Client visit, Coimbatore' }, 'submitted', 2,
    [{ fromState: 'draft', toState: 'submitted', transition: 'submit', actorId: 'u-priya', createdAt: daysAgo(2) }]);
  add('expense', 'u-emp', `EXP-${y}-0002`, { category: 'Equipment', amount: 18500, spentOn: daysAgo(8).slice(0, 10), description: 'Monitor for remote work' }, 'draft', 1);
  db.seq = { leave: 3, expense: 2 };
  history(db, add);
  db.rules = [
    { id: 'r1', name: 'Long leave alert', eventType: 'record.leave.created', active: true,
      condition: { all: [{ fact: 'after.days', operator: 'greaterThan', value: 5 }] },
      actions: [{ action: 'notify', to: ['role:admin'], title: 'Long leave requested: {{after.number}}', body: '{{after.days}} days ({{after.leaveType}})', link: '/app/leave/{{after.id}}' }] },
    { id: 'r2', name: 'Big expense submitted', eventType: 'workflow.expense-approval.submit', active: true,
      condition: { all: [{ fact: 'after.amount', operator: 'greaterThan', value: 10000 }] },
      actions: [{ action: 'notify', to: ['role:admin'], title: 'Expense over ₹10,000: {{after.number}}', body: '₹{{after.amount}} · {{after.category}}', link: '/app/expense/{{after.id}}' }] },
  ];
  db.notifications.push({ id: uid(), userId: 'u-mgr', title: 'Approval needed: Manager review', body: `LV-${y}-0002 from Elan Employee`, link: `/app/leave/${db.records[1].id}`, createdAt: daysAgo(1) });
  return db;
}

/** ~6 weeks of fictional history so the dashboard, audit log and event monitor have data. */
function history(db: Db, add: (entity: string, owner: string, number: string, data: Record<string, unknown>, state: string, ago: number, history?: Instance['history']) => void) {
  let s = 20261115;
  const rand = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const y = new Date().getFullYear();
  const staff = ['u-emp', 'u-priya', 'u-karthik', 'u-zara', 'u-vikram'];
  const outbox: OutboxRow[] = (db.outbox = []);
  const log = (type: string, at: string, actorId: string, entity: { name: string; id: string }, corr: string) => outbox.push({ id: uid(), type, createdAt: at, actorId, entity, correlationId: corr });
  for (let back = 42; back >= 0; back--) {
    const n = back === 0 ? 3 : rand() < 0.3 ? 0 : 1 + Math.floor(rand() * 2);
    for (let k = 0; k < n; k++) {
      const owner = pick(staff);
      const leave = rand() < 0.5;
      const entity = leave ? 'leave' : 'expense';
      const number = leave ? `LV-${y}-${String(++db.seq['leave']).padStart(4, '0')}` : `EXP-${y}-${String(++db.seq['expense']).padStart(4, '0')}`;
      const final = rand() < 0.75 ? 'approved' : 'rejected';
      // Spread today's items over the last hours; never in the future.
      const base = back === 0 ? Date.now() - (6 + k * 5) * 3_600_000 : Date.now() - back * 86_400_000;
      const at = (h: number) => new Date(Math.min(base + (back === 0 ? h / 5 : h) * 3_600_000, Date.now() - (3 - k) * 600_000)).toISOString();
      const hist: Instance['history'] = [
        { fromState: 'draft', toState: 'submitted', transition: 'submit', actorId: owner, createdAt: at(1) },
        { fromState: 'submitted', toState: final, transition: final === 'approved' ? 'approve' : 'reject', actorId: 'u-mgr', comment: final === 'rejected' ? 'Please pick other dates' : undefined, createdAt: at(20) },
      ];
      const data = leave
        ? { leaveType: pick(['Casual', 'Sick', 'Earned']), fromDate: at(72).slice(0, 10), toDate: at(96).slice(0, 10), days: 1 + Math.floor(rand() * 4), reason: pick(['Family function', 'Fever', 'Vacation', 'Personal work']) }
        : { category: pick(['Travel', 'Meals', 'Software', 'Equipment']), amount: Math.round((500 + rand() * 9000) / 10) * 10, spentOn: at(-24).slice(0, 10), description: pick(['Client visit', 'Team lunch', 'Licence renewal', 'Keyboard']) };
      add(entity, owner, number, data, final, back, hist);
      const rec = db.records[db.records.length - 1];
      rec.createdAt = at(0); rec.updatedAt = at(20);
      const ref = { name: entity, id: rec.id };
      db.audit.push({ entity, entityId: rec.id, action: 'create', actorType: 'user', actorId: owner, after: data, createdAt: at(0) });
      db.audit.push({ entity, entityId: rec.id, action: 'workflow.submit', actorType: 'user', actorId: owner, before: { status: 'draft' }, after: { status: 'submitted' }, createdAt: at(1) });
      db.audit.push({ entity, entityId: rec.id, action: `workflow.${hist[1].transition}`, actorType: 'user', actorId: 'u-mgr', before: { status: 'submitted' }, after: { status: final }, createdAt: at(20) });
      const c1 = uid(), c2 = uid(), c3 = uid();
      log(`record.${entity}.created`, at(0), owner, ref, c1);
      log(`workflow.${entity}-approval.submit`, at(1), owner, ref, c2); log(`record.${entity}.updated`, at(1), owner, ref, c2);
      log(`workflow.${entity}-approval.${hist[1].transition}`, at(20), 'u-mgr', ref, c3); log(`record.${entity}.updated`, at(20), 'u-mgr', ref, c3); log('notification.created', at(20), 'u-mgr', ref, c3);
    }
  }
  // Move the seeded "current" records to the end so they show as the newest.
  db.records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  db.audit.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  outbox.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ───────── storage + channel ─────────
function load(): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const db = JSON.parse(raw) as Db;
      if (db.outbox) return db; // created before the monitor existed → reseed below
    }
  } catch { /* fresh */ }
  const db = seed();
  save(db);
  return db;
}
function save(db: Db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* quota: demo keeps working in memory */ }
}
export function resetDemo() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('nexus-demo') : null;
const listeners = new Set<(e: DemoEvent) => void>();
channel?.addEventListener('message', (m) => listeners.forEach((l) => l(m.data as DemoEvent)));
export function listen(fn: (e: DemoEvent) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function publish(events: DemoEvent[]) {
  // Deliver after the HTTP response so the UI sees the same order as with a real server.
  setTimeout(() => events.forEach((e) => { listeners.forEach((l) => l(e)); channel?.postMessage(e); }), 150);
}

// ───────── access ─────────
const grants = (u: DemoUser, resource: string, action: string) =>
  u.permissions.filter((p) => { const [r, a] = p.key.split(':'); return (r === '*' || r === resource) && (a === '*' || a === action); });
const team = (db: Db, u: DemoUser) => db.users.filter((x) => x.managerId === u.id).map((x) => x.id);
function allows(db: Db, u: DemoUser, g: CompiledPermission[], ownerId: string, data: unknown) {
  return g.some((p) => {
    const inScope = p.scope === 'all' || (p.scope === 'own' && ownerId === u.id) || (p.scope === 'team' && (ownerId === u.id || team(db, u).includes(ownerId)));
    return inScope && evaluate(p.condition as Condition | undefined, { record: data, user: u });
  });
}
function assert(db: Db, u: DemoUser, resource: string, action: string, rec?: { ownerId: string; data: unknown }) {
  const g = grants(u, resource, action);
  if (!g.length || (rec && !allows(db, u, g, rec.ownerId, rec.data))) throw new ApiError(403, `You don't have permission to ${action} this ${resource}`);
}
const mask = (u: DemoUser, entity: string, data: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(data).filter(([f]) => u.fieldMask[entity]?.[f] !== 'hidden'));
const can = (u: DemoUser, r: string, a: string) => grants(u, r, a).length > 0;

/** What a given (tab) user should receive for an event: used by the demo EventHub. */
export function deliverTo(userId: string, e: DemoEvent): { patch?: LivePatch; notify?: boolean } {
  const db = load();
  const u = db.users.find((x) => x.id === userId);
  if (!u) return {};
  const out: { patch?: LivePatch; notify?: boolean } = {};
  if (e.notifyUserIds?.includes(userId)) out.notify = true;
  if (e.type.startsWith('record.') && e.entity) {
    const after = e.data['after'] as Record<string, unknown> | null;
    const g = grants(u, e.entity.name, 'read');
    if (g.length && (!after || allows(db, u, g, String(after['ownerId']), after))) {
      out.patch = { entity: e.entity.name, id: e.entity.id, version: 0, eventType: e.type, op: e.type.endsWith('deleted') ? 'delete' : 'upsert', data: after ? mask(u, e.entity.name, after) : undefined };
    }
  }
  return out;
}

// ───────── helpers ─────────
function userFrom(db: Db, auth: string | null): DemoUser {
  const id = auth?.replace(/^Bearer\s+demo\./, '');
  const u = db.users.find((x) => x.id === id);
  if (!u) throw new ApiError(401, 'Session expired');
  if (db.status?.[u.id] === 'suspended') throw new ApiError(403, 'Your access to this workspace is suspended');
  return u;
}
const present = (u: DemoUser, r: Rec) => ({ id: r.id, number: r.number, status: r.status, version: r.version, ownerId: r.ownerId, createdAt: r.createdAt, updatedAt: r.updatedAt, data: mask(u, r.entity, r.data) });
const entityDef = (db: Db, name: string) => {
  const d = db.entities.find((e) => e.name === name);
  if (!d) throw new ApiError(404, `Unknown entity "${name}"`);
  return d;
};
function validate(def: EntityDefinition, input: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const f of def.fields) {
    const has = f.name in input;
    if (!has && partial) continue;
    let v = input[f.name];
    if (v === undefined || v === null || v === '') {
      if (f.required) errors.push(`${f.label} is required`);
      continue;
    }
    if (f.type === 'number' || f.type === 'money') {
      v = Number(v);
      if (!Number.isFinite(v)) errors.push(`${f.label}: must be a number`);
    }
    if (f.type === 'select' && f.options && !f.options.includes(String(v))) errors.push(`${f.label}: invalid option`);
    out[f.name] = v;
  }
  if (errors.length) throw new ApiError(400, errors.join(' · '));
  return out;
}
const flat = (r: Rec) => ({ ...r.data, id: r.id, number: r.number, status: r.status, ownerId: r.ownerId });
const userName = (db: Db, id: string) => db.users.find((u) => u.id === id)?.name ?? id;

function notify(db: Db, userIds: string[], n: { title: string; body?: string; link?: string }, events: DemoEvent[]) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  for (const userId of ids) db.notifications.unshift({ id: uid(), userId, ...n, createdAt: now() });
  events.push({ id: uid(), type: 'notification.created', data: {}, notifyUserIds: ids, notification: n });
}
const recipients = (db: Db, to: string[], ownerId?: string) =>
  to.flatMap((t) => (t.startsWith('role:') ? db.users.filter((u) => u.roles.includes(t.slice(5))).map((u) => u.id) : t === 'owner' ? [ownerId ?? ''] : [t.replace(/^user:/, '')]));

function emit(db: Db, actor: DemoUser, type: string, entity: { name: string; id: string } | undefined, data: Record<string, unknown>, events: DemoEvent[]) {
  const e: DemoEvent = { id: uid(), type, entity, data };
  events.push(e);
  const box = (db.outbox ??= []);
  box.push({ id: e.id, type, createdAt: now(), actorId: actor.id, entity, correlationId: events[0]?.id ?? e.id });
  if (box.length > 600) box.splice(0, box.length - 600);
  // Rules engine: When → If → Then
  const facts = { event: e, data, before: data['before'] ?? null, after: data['after'] ?? data['record'] ?? null, entity, actor: { type: 'user', id: actor.id } };
  for (const rule of db.rules.filter((r) => r.active && (r.eventType === type || r.eventType === '*'))) {
    if (!evaluate(rule.condition as Condition, facts)) continue;
    for (const raw of rule.actions) {
      const a = renderDeep(raw, facts) as { action: string; to?: string[]; title?: string; body?: string; link?: string };
      if (a.action === 'notify' && a.to && a.title) {
        notify(db, recipients(db, a.to, (facts.after as { ownerId?: string } | null)?.ownerId), { title: a.title, body: a.body, link: a.link }, events);
      }
    }
  }
}

function openTask(db: Db, inst: Instance, rec: Rec, events: DemoEvent[]) {
  const spec = db.workflows[inst.key].states[inst.state];
  if (!spec.task) return;
  const owner = db.users.find((u) => u.id === rec.ownerId);
  const assigneeId = spec.task.assignee === 'manager' ? owner?.managerId ?? null : spec.task.assignee === 'owner' ? rec.ownerId : null;
  const roleKey = spec.task.role ?? (assigneeId ? null : 'admin');
  inst.tasks.push({ id: uid(), state: inst.state, assigneeId, roleKey, status: 'open', createdAt: now(), dueAt: spec.task.dueHours ? new Date(Date.now() + spec.task.dueHours * 3_600_000).toISOString() : null });
  const ids = assigneeId ? [assigneeId] : recipients(db, [`role:${roleKey}`]);
  notify(db, ids, { title: `Approval needed: ${spec.label}`, body: `${rec.number} from ${userName(db, rec.ownerId)}`, link: `/app/${rec.entity}/${rec.id}` }, events);
}

function mayFire(db: Db, u: DemoUser, t: WfTransition, rec: Rec, inst: Instance) {
  if (!evaluate(t.condition, { record: rec.data, user: u })) return false;
  if (!t.by) return can(u, rec.entity, 'update') && allows(db, u, grants(u, rec.entity, 'update'), rec.ownerId, rec.data);
  if (t.by.owner && rec.ownerId === u.id) return true;
  if (t.by.roles?.some((r) => u.roles.includes(r))) return true;
  const open = inst.tasks.filter((x) => x.status === 'open');
  if (t.by.assignee && open.some((x) => x.assigneeId === u.id || (x.roleKey && u.roles.includes(x.roleKey)))) return true;
  return can(u, rec.entity, 'approve') && allows(db, u, grants(u, rec.entity, 'approve'), rec.ownerId, rec.data);
}
const fromMatches = (t: WfTransition, s: string) => (Array.isArray(t.from) ? t.from.includes(s) : t.from === s);

// ───────── router ─────────
function route(db: Db, method: string, path: string, body: Record<string, unknown>, q: URLSearchParams, auth: string | null, events: DemoEvent[]): unknown {
  const seg = path.split('/').filter(Boolean);

  if (path === '/auth/login' && method === 'POST') {
    const u = db.users.find((x) => x.email === String(body['email']).toLowerCase() && x.password === body['password']);
    if (!u || String(body['tenant']).toLowerCase() !== 'acme') throw new ApiError(401, 'Invalid workspace, email or password');
    if (db.status?.[u.id] === 'suspended') throw new ApiError(403, 'Your access to this workspace is suspended');
    (db.lastLogin ??= {})[u.id] = now();
    return { accessToken: `demo.${u.id}`, refreshToken: `demo.${u.id}.r`, tenant: TENANT };
  }
  if (path === '/auth/refresh') {
    const id = String(body['refreshToken']).replace(/^demo\./, '').replace(/\.r$/, '');
    if (!db.users.some((u) => u.id === id)) throw new ApiError(401, 'Session expired');
    return { accessToken: `demo.${id}`, refreshToken: `demo.${id}.r`, tenant: TENANT };
  }
  if (path === '/auth/logout') return {};

  const u = userFrom(db, auth);

  if (path === '/auth/me') return { userId: u.id, tenantId: TENANT.id, email: u.email, name: u.name, roles: u.roles, permissions: u.permissions, fieldMask: u.fieldMask };

  // metadata
  if (seg[0] === 'meta' && seg[1] === 'entities') {
    const shape = (d: Db['entities'][number]) => ({ ...d, fields: d.fields.filter((f) => u.fieldMask[d.name]?.[f.name] !== 'hidden').map((f) => (u.fieldMask[d.name]?.[f.name] === 'read' ? { ...f, readOnly: true } : f)) });
    if (seg[2]) return shape(entityDef(db, seg[2]));
    return db.entities.filter((d) => can(u, d.name, 'read')).map(shape);
  }

  // generic data API
  if (seg[0] === 'data') {
    const entity = seg[1];
    const def = entityDef(db, entity);
    if (method === 'GET' && !seg[2]) {
      const g = grants(u, entity, 'read');
      if (!g.length) throw new ApiError(403, `Missing permission ${entity}:read`);
      const term = (q.get('search') ?? '').toLowerCase();
      const rows = db.records
        .filter((r) => r.entity === entity && allows(db, u, g, r.ownerId, r.data))
        .filter((r) => !term || JSON.stringify(r.data).toLowerCase().includes(term) || (r.number ?? '').toLowerCase().includes(term))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const size = Number(q.get('pageSize')) || 25;
      return { items: rows.slice(0, size).map((r) => present(u, r)), total: rows.length, page: 1, pageSize: size };
    }
    if (method === 'POST' && !seg[2]) {
      assert(db, u, entity, 'create');
      const blocked = Object.keys(body['data'] as object).filter((f) => ['read', 'hidden'].includes(u.fieldMask[entity]?.[f] ?? ''));
      if (blocked.length) throw new ApiError(403, `Read-only fields: ${blocked.join(', ')}`);
      const data = validate(def, body['data'] as Record<string, unknown>, false);
      db.seq[entity] = (db.seq[entity] ?? 0) + 1;
      const number = def.numbering?.replace('{YYYY}', String(new Date().getFullYear())).replace(/\{(#+)\}/, (_, h: string) => String(db.seq[entity]).padStart(h.length, '0')) ?? null;
      const rec: Rec = { id: uid(), entity, number, status: null, version: 1, ownerId: u.id, createdAt: now(), updatedAt: now(), data };
      db.records.push(rec);
      if (def.workflowKey) {
        const wf = db.workflows[def.workflowKey];
        db.instances.push({ key: def.workflowKey, entity, recordId: rec.id, state: wf.initial, tasks: [], history: [] });
        rec.status = wf.initial;
      }
      db.audit.push({ entity, entityId: rec.id, action: 'create', actorType: 'user', actorId: u.id, after: data, createdAt: now() });
      emit(db, u, `record.${entity}.created`, { name: entity, id: rec.id }, { before: null, after: flat(rec) }, events);
      return present(u, rec);
    }
    const rec = db.records.find((r) => r.id === seg[2] && r.entity === entity);
    if (!rec) throw new ApiError(404, 'Not found');
    if (method === 'GET' && seg[3] === 'history') {
      assert(db, u, entity, 'read', rec);
      return db.audit.filter((a) => a.entityId === rec.id).reverse();
    }
    if (method === 'GET') {
      assert(db, u, entity, 'read', rec);
      return present(u, rec);
    }
    if (method === 'PATCH') {
      assert(db, u, entity, 'update', rec);
      if (body['version'] !== undefined && body['version'] !== rec.version) throw new ApiError(409, 'This record was changed by someone else. Load the latest version.');
      const input = body['data'] as Record<string, unknown>;
      const changed = Object.keys(input).filter((k) => JSON.stringify(input[k]) !== JSON.stringify(rec.data[k]));
      const blocked = changed.filter((f) => ['read', 'hidden'].includes(u.fieldMask[entity]?.[f] ?? ''));
      if (blocked.length) throw new ApiError(403, `Read-only fields: ${blocked.join(', ')}`);
      const patch = validate(def, Object.fromEntries(changed.map((k) => [k, input[k]])), true);
      const before = { ...flat(rec) };
      rec.data = { ...rec.data, ...patch };
      rec.version++;
      rec.updatedAt = now();
      db.audit.push({ entity, entityId: rec.id, action: 'update', actorType: 'user', actorId: u.id, before, after: rec.data, createdAt: now() });
      emit(db, u, `record.${entity}.updated`, { name: entity, id: rec.id }, { before, after: flat(rec), changed }, events);
      return present(u, rec);
    }
  }

  // workflow
  if (seg[0] === 'workflow') {
    if (seg[1] === 'inbox') {
      return db.instances.flatMap((inst) =>
        inst.tasks.filter((t) => t.status === 'open' && (t.assigneeId === u.id || (t.roleKey && u.roles.includes(t.roleKey)))).map((t) => {
          const r = db.records.find((x) => x.id === inst.recordId)!;
          return { taskId: t.id, entity: inst.entity, recordId: inst.recordId, number: r.number, state: t.state, dueAt: t.dueAt, createdAt: t.createdAt, data: mask(u, inst.entity, r.data) };
        }),
      );
    }
    const [entity, id] = [seg[1], seg[2]];
    const inst = db.instances.find((i) => i.entity === entity && i.recordId === id);
    const rec = db.records.find((r) => r.id === id);
    if (!inst || !rec) throw new ApiError(404, 'No workflow on this record');
    const spec = db.workflows[inst.key];
    if (method === 'GET') {
      assert(db, u, entity, 'read', rec);
      return {
        state: inst.state, stateLabel: spec.states[inst.state]?.label, final: !!spec.states[inst.state]?.final,
        transitions: spec.transitions.filter((t) => fromMatches(t, inst.state) && mayFire(db, u, t, rec, inst)).map((t) => ({ name: t.name, label: t.label ?? t.name, to: t.to, requireComment: !!t.requireComment })),
        history: inst.history.map((h) => ({ ...h, actorId: userName(db, h.actorId) })),
      };
    }
    if (method === 'POST' && seg[3] === 'transition') {
      const t = spec.transitions.find((x) => x.name === body['transition'] && fromMatches(x, inst.state));
      if (!t) throw new ApiError(400, 'This action is not available any more');
      if (!mayFire(db, u, t, rec, inst)) throw new ApiError(403, 'You cannot perform this action');
      const comment = String(body['comment'] ?? '').trim();
      if (t.requireComment && !comment) throw new ApiError(400, 'A comment is required');
      const from = inst.state;
      const before = flat(rec);
      inst.state = t.to;
      rec.status = t.to;
      rec.version++;
      rec.updatedAt = now();
      inst.tasks.filter((x) => x.status === 'open').forEach((x) => (x.status = 'done'));
      inst.history.push({ fromState: from, toState: t.to, transition: t.name, actorId: u.id, comment: comment || undefined, createdAt: now() });
      openTask(db, inst, rec, events);
      if (rec.ownerId !== u.id) notify(db, [rec.ownerId], { title: `${rec.number} is now ${spec.states[t.to].label}`, body: comment || `by ${u.name}`, link: `/app/${entity}/${rec.id}` }, events);
      db.audit.push({ entity, entityId: rec.id, action: `workflow.${t.name}`, actorType: 'user', actorId: u.id, before: { status: from }, after: { status: t.to, comment }, createdAt: now() });
      emit(db, u, `workflow.${inst.key}.${t.name}`, { name: entity, id: rec.id }, { from, to: t.to, after: flat(rec), record: flat(rec) }, events);
      emit(db, u, `record.${entity}.updated`, { name: entity, id: rec.id }, { before, after: flat(rec), changed: ['status'] }, events);
      return { state: t.to };
    }
  }

  // notifications
  if (seg[0] === 'notifications') {
    if (method === 'GET') return db.notifications.filter((n) => n.userId === u.id).slice(0, 50);
    const n = db.notifications.find((x) => x.id === seg[1] && x.userId === u.id);
    if (n) n.readAt = now();
    return { ok: true };
  }

  // rules
  if (seg[0] === 'rules') {
    if (seg[1] === 'test') {
      assert(db, u, 'rules', 'read');
      const rule = body['rule'] as Rule;
      const ev = body['event'] as { data?: Record<string, unknown> };
      const data = ev.data ?? {};
      const facts = { event: ev, data, before: data['before'] ?? null, after: data['after'] ?? null };
      const matched = evaluate(rule.condition as Condition, facts);
      return { matched, actions: matched ? rule.actions.map((a) => renderDeep(a, facts)) : [] };
    }
    if (method === 'GET') {
      assert(db, u, 'rules', 'read');
      return db.rules;
    }
    assert(db, u, 'rules', method === 'POST' ? 'create' : 'update');
    const r = body as unknown as Rule;
    if (!r.name || !r.eventType || !Array.isArray(r.actions)) throw new ApiError(400, 'name, eventType and actions are required');
    if (method === 'POST') {
      const created = { ...r, id: uid(), active: r.active ?? true };
      db.rules.unshift(created);
      return created;
    }
    const i = db.rules.findIndex((x) => x.id === seg[1]);
    if (i < 0) throw new ApiError(404, 'Rule not found');
    db.rules[i] = { ...r, id: seg[1], active: r.active ?? true };
    return db.rules[i];
  }

  if (seg[0] === 'insights' && seg[1] === 'overview') return overview(db, u);

  if (seg[0] === 'audit') {
    const all = (grants(u, 'audit', 'read')).some((g) => g.scope === 'all');
    if (!grants(u, 'audit', 'read').length) throw new ApiError(403, 'Missing permission audit:read');
    const e = q.get('entity'), id = q.get('entityId'), act = (q.get('action') ?? '').toLowerCase(), page = Math.max(1, Number(q.get('page')) || 1);
    const rows = [...db.audit].reverse().filter((r) => (all || r.actorId === u.id) && (!e || r.entity === e) && (!id || r.entityId === id) && (!act || r.action.toLowerCase().includes(act)));
    return {
      total: rows.length, page, pageSize: 30, entities: [...new Set(db.audit.map((r) => r.entity))].sort(),
      items: rows.slice((page - 1) * 30, page * 30).map((r, i) => ({ ...r, id: String(rows.length - (page - 1) * 30 - i), actor: userName(db, r.actorId), subject: r.entity === 'user' ? userName(db, r.entityId) : null, changes: diffs(r.before, r.after) })),
    };
  }

  if (seg[0] === 'admin') {
    const roles = roleCatalog(db);
    if (seg[1] === 'roles') {
      if (!grants(u, 'roles', 'read').some((g) => g.scope === 'all')) throw new ApiError(403, 'Missing permission roles:read');
      return roles.map((r) => ({ ...r, members: db.users.filter((x) => x.roles.includes(r.key)).length }));
    }
    if (!grants(u, 'users', seg[3] ? 'update' : 'read').some((g) => g.scope === 'all')) throw new ApiError(403, `Missing permission users:${seg[3] ? 'update' : 'read'}`);
    if (seg[1] === 'users' && !seg[2]) {
      return db.users.map((x) => ({
        id: x.id, userId: x.id, name: x.name, email: x.email, status: db.status?.[x.id] ?? 'active', lastLoginAt: db.lastLogin?.[x.id] ?? null, createdAt: daysAgo(60),
        manager: x.managerId ? userName(db, x.managerId) : null, roles: x.roles.map((k) => ({ id: k, key: k, name: roles.find((r) => r.key === k)?.name ?? k })), orgUnits: ['Acme Corp'],
      }));
    }
    const target = db.users.find((x) => x.id === seg[2]);
    if (!target) throw new ApiError(404, 'Not found');
    if (seg[3] === 'roles') {
      const keys = (body['roleIds'] as string[]) ?? [];
      if (target.id === u.id && target.roles.includes('admin') && !keys.includes('admin')) throw new ApiError(403, 'You cannot remove your own admin role');
      const before = [...target.roles];
      target.roles = keys.filter((k) => roles.some((r) => r.key === k));
      target.permissions = roles.filter((r) => target.roles.includes(r.key)).flatMap((r) => r.permissions.map((p) => ({ key: p.permission as CompiledPermission['key'], scope: p.scope as CompiledPermission['scope'] })));
      db.audit.push({ entity: 'user', entityId: target.id, action: 'user.roles_changed', actorType: 'user', actorId: u.id, before: { roles: before }, after: { roles: target.roles }, createdAt: now() });
      emit(db, u, 'core.user.roles_changed', { name: 'user', id: target.id }, { before, after: target.roles }, events);
      return { ok: true, roles: target.roles };
    }
    if (seg[3] === 'status') {
      if (target.id === u.id) throw new ApiError(403, 'You cannot change your own status');
      const status = body['status'] === 'suspended' ? 'suspended' : 'active';
      const prev = db.status?.[target.id] ?? 'active';
      (db.status ??= {})[target.id] = status;
      db.audit.push({ entity: 'user', entityId: target.id, action: `user.${status}`, actorType: 'user', actorId: u.id, before: { status: prev }, after: { status }, createdAt: now() });
      emit(db, u, `core.user.${status}`, { name: 'user', id: target.id }, { status }, events);
      return { ok: true, status };
    }
  }

  if (seg[0] === 'events') {
    if (!grants(u, 'events', 'admin').length) throw new ApiError(403, 'Missing permission events:admin');
    const box = db.outbox ?? [];
    if (seg[1] === 'recent') {
      const t = q.get('type') ?? '';
      return [...box].reverse().filter((e) => !t || e.type.startsWith(t)).slice(0, 100).map((e) => ({
        id: e.id, type: e.type, createdAt: e.createdAt, publishedAt: new Date(new Date(e.createdAt).getTime() + 40 + (e.id.charCodeAt(0) % 60)).toISOString(), attempts: 0, lastError: null,
        actor: { type: 'user', id: e.actorId }, entity: e.entity ?? null, correlationId: e.correlationId, causationId: null, depth: 0,
      }));
    }
    if (seg[1] === 'stats') return { pending: 0, lastHour: box.filter((e) => Date.now() - new Date(e.createdAt).getTime() < 3_600_000).length, failing: 0, deadLetters: 0, consumers: ['rules', 'realtime'] };
    if (seg[1] === 'dead-letters') return [];
  }

  throw new ApiError(404, `No demo route for ${method} ${path}`);
}

function roleCatalog(db: Db) {
  const names: Record<string, string> = { admin: 'Administrator', manager: 'Manager', employee: 'Employee', finance: 'Finance' };
  const out: { id: string; key: string; name: string; description: null; system: boolean; permissions: { permission: string; scope: string; conditional: boolean }[]; fields: { entity: string; field: string; mode: string }[] }[] = [];
  const seed: Record<string, CompiledPermission[]> = {
    admin: [{ key: '*:*', scope: 'all' }],
    manager: db.users.find((x) => x.id === 'u-mgr')?.permissions ?? [],
    employee: db.users.find((x) => x.id === 'u-priya')?.permissions ?? [],
  };
  for (const key of Object.keys(seed)) {
    const fieldsUser = db.users.find((x) => x.roles.includes(key) && Object.keys(x.fieldMask).length);
    out.push({
      id: key, key, name: names[key] ?? key, description: null, system: true,
      permissions: seed[key].map((p) => ({ permission: p.key, scope: p.scope, conditional: !!p.condition })),
      fields: key === 'employee' && fieldsUser ? Object.entries(fieldsUser.fieldMask).flatMap(([entity, f]) => Object.entries(f).map(([field, mode]) => ({ entity, field, mode }))) : [],
    });
  }
  return out;
}

function diffs(before: unknown, after: unknown) {
  const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((f) => JSON.stringify(b[f]) !== JSON.stringify(a[f])).map((f) => ({ field: f, from: b[f] ?? null, to: a[f] ?? null })).slice(0, 20);
}

function overview(db: Db, u: DemoUser) {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const days = Array.from({ length: 14 }, (_, i) => day(new Date(Date.now() - (13 - i) * 86_400_000)));
  const all = (resource: string, action = 'read') => grants(u, resource, action).some((g) => g.scope === 'all');
  const entities = db.entities.filter((e) => can(u, e.name, 'read')).map((e) => {
    const g = grants(u, e.name, 'read');
    const mine = db.records.filter((r) => r.entity === e.name && allows(db, u, g, r.ownerId, r.data));
    const byStatus = new Map<string, number>();
    mine.forEach((r) => byStatus.set(r.status ?? 'none', (byStatus.get(r.status ?? 'none') ?? 0) + 1));
    return { name: e.name, label: e.pluralLabel, total: mine.length, byStatus: [...byStatus].map(([status, count]) => ({ status, count })), daily: days.map((d) => mine.filter((r) => r.createdAt.slice(0, 10) === d).length) };
  });
  const open = db.instances.flatMap((i) => i.tasks.filter((t) => t.status === 'open' && (t.assigneeId === u.id || (t.roleKey && u.roles.includes(t.roleKey)))));
  const platform = all('insights');
  const box = db.outbox ?? [];
  const hours = Array.from({ length: 24 }, (_, i) => { const h = new Date(); h.setMinutes(0, 0, 0); return new Date(h.getTime() - (23 - i) * 3_600_000); });
  const last24 = box.filter((e) => new Date(e.createdAt) >= hours[0]);
  const byType = new Map<string, number>();
  last24.forEach((e) => byType.set(e.type, (byType.get(e.type) ?? 0) + 1));
  const states = new Map<string, number>();
  db.instances.forEach((i) => states.set(i.state, (states.get(i.state) ?? 0) + 1));
  const recentAudit = [...db.audit].reverse().filter((a) => all('audit') || a.actorId === u.id).slice(0, 8);
  return {
    days, entities, tasks: { open: open.length, overdue: open.filter((t) => t.dueAt && new Date(t.dueAt) < new Date()).length },
    events: platform ? { hourly: hours.map((h) => ({ hour: h.toISOString(), count: last24.filter((e) => new Date(e.createdAt) >= h && new Date(e.createdAt).getTime() < h.getTime() + 3_600_000).length })), byType: [...byType].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count).slice(0, 8), pending: 0, deadLetters: 0, total24h: last24.length } : null,
    workflow: platform ? [...states].map(([state, count]) => ({ state, count })) : null,
    rules: platform ? { runs24h: last24.filter((e) => e.type.endsWith('.created')).length, matched24h: last24.filter((e) => e.type === 'notification.created').length, errors24h: 0 } : null,
    users: platform ? { active: db.users.filter((x) => (db.status?.[x.id] ?? 'active') === 'active').length, total: db.users.length } : null,
    activity: recentAudit.map((a, i) => ({ id: String(i), action: a.action, entity: a.entity, entityId: a.entityId, number: a.entity === 'user' ? userName(db, a.entityId) : db.records.find((r) => r.id === a.entityId)?.number ?? null, actor: userName(db, a.actorId), actorType: a.actorType, createdAt: a.createdAt })),
  };
}

export function handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
  const url = new URL(req.urlWithParams, location.origin);
  const path = url.pathname.replace(/^.*\/api\/v1/, '');
  const db = load();
  const events: DemoEvent[] = [];
  try {
    const result = route(db, req.method, path, (req.body ?? {}) as Record<string, unknown>, url.searchParams, req.headers.get('Authorization'), events);
    save(db);
    publish(events);
    return of(new HttpResponse({ status: 200, body: JSON.parse(JSON.stringify(result ?? {})), url: req.url })).pipe(delay(120));
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(500, (e as Error).message);
    return throwError(() => new HttpErrorResponse({ status: err.status, error: { message: err.message }, url: req.url }));
  }
}
