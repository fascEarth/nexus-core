/**
 * Demo tenant "acme" with roles, users, a Leave entity, an approval workflow
 * and an example rule. Run: npm run db:seed (uses the owner connection).
 *
 *   admin@acme.test     / Admin@12345   (admin)
 *   manager@acme.test   / Manager@12345 (manager)
 *   employee@acme.test  / Employee@12345 (employee, reports to manager)
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';

const prisma = new PrismaClient();

async function user(email: string, name: string, password: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
  });
}

async function main() {
  const tenant = await prisma.tenant.upsert({ where: { slug: 'acme' }, update: {}, create: { slug: 'acme', name: 'Acme Corp', modules: ['hrms'] } });
  const t = tenant.id;

  const role = async (key: string, name: string, perms: { permission: string; scope: string; condition?: object }[]) => {
    const existing = await prisma.role.findUnique({ where: { tenantId_key: { tenantId: t, key } } });
    if (existing) return existing;
    return prisma.role.create({ data: { tenantId: t, key, name, system: true, permissions: { create: perms.map((p) => ({ tenantId: t, ...p })) } } });
  };

  const admin = await role('admin', 'Administrator', [{ permission: '*:*', scope: 'all' }]);
  const manager = await role('manager', 'Manager', [
    { permission: 'leave:read', scope: 'team' },
    { permission: 'leave:create', scope: 'own' },
    { permission: 'leave:update', scope: 'own' },
    { permission: 'leave:approve', scope: 'team' },
    { permission: 'rules:read', scope: 'all' },
  ]);
  const employee = await role('employee', 'Employee', [
    { permission: 'leave:read', scope: 'own' },
    { permission: 'leave:create', scope: 'own' },
    { permission: 'leave:update', scope: 'own' },
  ]);

  const org = (await prisma.orgUnit.findFirst({ where: { tenantId: t, kind: 'company' } })) ?? (await prisma.orgUnit.create({ data: { tenantId: t, kind: 'company', name: 'Acme Corp' } }));

  const member = async (email: string, name: string, password: string, roleId: string, managerId?: string) => {
    const u = await user(email, name, password);
    const tu = await prisma.tenantUser.upsert({
      where: { tenantId_userId: { tenantId: t, userId: u.id } },
      update: { managerId },
      create: { tenantId: t, userId: u.id, managerId },
    });
    await prisma.userRole.upsert({ where: { tenantUserId_roleId: { tenantUserId: tu.id, roleId } }, update: {}, create: { tenantId: t, tenantUserId: tu.id, roleId } });
    if (org) await prisma.userOrgUnit.create({ data: { tenantId: t, tenantUserId: tu.id, orgUnitId: org.id } }).catch(() => undefined);
    return tu;
  };

  await member('admin@acme.test', 'Asha Admin', 'Admin@12345', admin.id);
  const mgr = await member('manager@acme.test', 'Murali Manager', 'Manager@12345', manager.id);
  await member('employee@acme.test', 'Elan Employee', 'Employee@12345', employee.id, mgr.id);

  // Field-level permission example: employees can't change the computed `days`.
  await prisma.fieldPermission.upsert({
    where: { roleId_entity_field: { roleId: employee.id, entity: 'leave', field: 'approverNote' } },
    update: {}, create: { tenantId: t, roleId: employee.id, entity: 'leave', field: 'approverNote', mode: 'read' },
  });

  if (!(await prisma.entityDef.findUnique({ where: { tenantId_name: { tenantId: t, name: 'leave' } } }))) {
    await prisma.entityDef.create({
      data: {
        tenantId: t, name: 'leave', label: 'Leave request', pluralLabel: 'Leave requests', icon: 'event_busy',
        numbering: 'LV-{YYYY}-{####}', workflowKey: 'leave-approval',
        fields: { create: [
          { tenantId: t, name: 'leaveType', label: 'Leave type', type: 'select', required: true, options: ['Casual', 'Sick', 'Earned', 'Unpaid'], order: 1 },
          { tenantId: t, name: 'fromDate', label: 'From', type: 'date', required: true, order: 2 },
          { tenantId: t, name: 'toDate', label: 'To', type: 'date', required: true, order: 3 },
          { tenantId: t, name: 'days', label: 'Days', type: 'number', required: true, order: 4 },
          { tenantId: t, name: 'reason', label: 'Reason', type: 'textarea', order: 5 },
          { tenantId: t, name: 'approverNote', label: 'Approver note', type: 'textarea', order: 6 },
        ] },
      },
    });
  }

  await prisma.workflowDef.upsert({
    where: { tenantId_key_version: { tenantId: t, key: 'leave-approval', version: 1 } },
    update: {},
    create: {
      tenantId: t, key: 'leave-approval', entity: 'leave', version: 1,
      definition: {
        initial: 'draft',
        states: {
          draft: { label: 'Draft' },
          submitted: { label: 'Manager review', task: { assignee: 'manager', dueHours: 24 } },
          hr_review: { label: 'HR review', task: { role: 'admin', dueHours: 48 } },
          approved: { label: 'Approved', final: true },
          rejected: { label: 'Rejected', final: true },
        },
        transitions: [
          { name: 'submit', label: 'Submit', from: 'draft', to: 'submitted', by: { owner: true } },
          { name: 'approve', label: 'Approve', from: 'submitted', to: 'approved', by: { assignee: true },
            condition: { fact: 'record.days', operator: 'lessThanInclusive', value: 5 } },
          { name: 'escalate', label: 'Approve → HR', from: 'submitted', to: 'hr_review', by: { assignee: true },
            condition: { fact: 'record.days', operator: 'greaterThan', value: 5 } },
          { name: 'hr_approve', label: 'HR approve', from: 'hr_review', to: 'approved', by: { roles: ['admin'] } },
          { name: 'reject', label: 'Reject', from: ['submitted', 'hr_review'], to: 'rejected', by: { assignee: true, roles: ['admin'] }, requireComment: true },
          { name: 'send_back', label: 'Send back', from: 'submitted', to: 'draft', by: { assignee: true }, requireComment: true },
        ],
      },
    },
  });

  if (!(await prisma.rule.findFirst({ where: { tenantId: t, name: 'Long leave alert' } }))) {
    await prisma.rule.create({
      data: {
        tenantId: t, name: 'Long leave alert', eventType: 'record.leave.created',
        condition: { all: [{ fact: 'after.days', operator: 'greaterThan', value: 5 }] },
        actions: [{ action: 'notify', to: ['role:admin'], title: 'Long leave requested: {{after.number}}', body: '{{after.days}} days ({{after.leaveType}})', link: '/app/leave/{{after.id}}' }],
      },
    });
  }

  const eventTypes = [
    ['record.leave.created', 'hrms', 'A leave request was created'],
    ['record.leave.updated', 'hrms', 'A leave request changed (incl. status)'],
    ['workflow.leave-approval.approve', 'hrms', 'Leave approved by manager'],
    ['workflow.leave-approval.reject', 'hrms', 'Leave rejected'],
    ['metadata.published', 'core', 'Metadata changed'],
    ['notification.created', 'core', 'Notification sent'],
    ['platform.tenant.created', 'platform', 'New workspace'],
  ];
  for (const [type, module, description] of eventTypes) {
    await prisma.eventType.upsert({ where: { type }, update: {}, create: { type, module, description } });
  }

  await seedExpenses(t, role, member, mgr.id);
  await seedHistory(t);
  console.log('Seeded tenant "acme". Log in at workspace "acme" with admin@acme.test / Admin@12345');
}

type RoleFn = (key: string, name: string, perms: { permission: string; scope: string; condition?: object }[]) => Promise<{ id: string }>;
type MemberFn = (email: string, name: string, password: string, roleId: string, managerId?: string) => Promise<{ id: string }>;

/** Second module: expense claims with a two-level approval (manager, then finance above 10,000). */
async function seedExpenses(t: string, role: RoleFn, member: MemberFn, managerTuId: string) {
  const finance = await role('finance', 'Finance', [
    { permission: 'expense:read', scope: 'all' },
    { permission: 'expense:approve', scope: 'all' },
    { permission: 'leave:read', scope: 'all' },
  ]);
  const add = async (key: string, perms: { permission: string; scope: string }[]) => {
    const r = await prisma.role.findUnique({ where: { tenantId_key: { tenantId: t, key } } });
    if (!r) return;
    for (const p of perms) {
      if (!(await prisma.rolePermission.findFirst({ where: { roleId: r.id, permission: p.permission } }))) {
        await prisma.rolePermission.create({ data: { tenantId: t, roleId: r.id, ...p } });
      }
    }
  };
  await add('employee', [{ permission: 'expense:read', scope: 'own' }, { permission: 'expense:create', scope: 'own' }, { permission: 'expense:update', scope: 'own' }]);
  await add('manager', [{ permission: 'expense:read', scope: 'team' }, { permission: 'expense:create', scope: 'own' }, { permission: 'expense:approve', scope: 'team' }]);

  const employee = await prisma.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId: t, key: 'employee' } } });
  await member('finance@acme.test', 'Farah Finance', 'Finance@12345', finance.id);
  const team: [string, string][] = [
    ['divya.iyer@acme.test', 'Divya Iyer'], ['karthik.nair@acme.test', 'Karthik Nair'], ['sneha.reddy@acme.test', 'Sneha Reddy'],
    ['rahul.menon@acme.test', 'Rahul Menon'], ['zara.khan@acme.test', 'Zara Khan'], ['vikram.das@acme.test', 'Vikram Das'],
  ];
  const mgr = await prisma.tenantUser.findUniqueOrThrow({ where: { id: managerTuId } });
  for (const [email, name] of team) await member(email, name, 'Employee@12345', employee.id, mgr.id);

  if (!(await prisma.entityDef.findUnique({ where: { tenantId_name: { tenantId: t, name: 'expense' } } }))) {
    await prisma.entityDef.create({
      data: {
        tenantId: t, name: 'expense', label: 'Expense claim', pluralLabel: 'Expense claims', icon: 'receipt_long',
        numbering: 'EX-{YYYY}-{####}', workflowKey: 'expense-approval',
        fields: { create: [
          { tenantId: t, name: 'category', label: 'Category', type: 'select', required: true, options: ['Travel', 'Meals', 'Software', 'Equipment', 'Training'], order: 1 },
          { tenantId: t, name: 'amount', label: 'Amount (₹)', type: 'number', required: true, order: 2 },
          { tenantId: t, name: 'spentOn', label: 'Spent on', type: 'date', required: true, order: 3 },
          { tenantId: t, name: 'merchant', label: 'Merchant', type: 'text', required: true, order: 4 },
          { tenantId: t, name: 'description', label: 'Description', type: 'textarea', order: 5 },
        ] },
      },
    });
  }
  await prisma.workflowDef.upsert({
    where: { tenantId_key_version: { tenantId: t, key: 'expense-approval', version: 1 } },
    update: {},
    create: {
      tenantId: t, key: 'expense-approval', entity: 'expense', version: 1,
      definition: {
        initial: 'draft',
        states: {
          draft: { label: 'Draft' },
          submitted: { label: 'Manager review', task: { assignee: 'manager', dueHours: 24 } },
          finance_review: { label: 'Finance review', task: { role: 'finance', dueHours: 48 } },
          approved: { label: 'Approved' },
          paid: { label: 'Paid', final: true },
          rejected: { label: 'Rejected', final: true },
        },
        transitions: [
          { name: 'submit', label: 'Submit', from: 'draft', to: 'submitted', by: { owner: true } },
          { name: 'approve', label: 'Approve', from: 'submitted', to: 'approved', by: { assignee: true }, condition: { fact: 'record.amount', operator: 'lessThanInclusive', value: 10000 } },
          { name: 'escalate', label: 'Approve → Finance', from: 'submitted', to: 'finance_review', by: { assignee: true }, condition: { fact: 'record.amount', operator: 'greaterThan', value: 10000 } },
          { name: 'finance_approve', label: 'Finance approve', from: 'finance_review', to: 'approved', by: { roles: ['finance', 'admin'] } },
          { name: 'mark_paid', label: 'Mark paid', from: 'approved', to: 'paid', by: { roles: ['finance', 'admin'] } },
          { name: 'reject', label: 'Reject', from: ['submitted', 'finance_review'], to: 'rejected', by: { assignee: true, roles: ['finance', 'admin'] }, requireComment: true },
          { name: 'send_back', label: 'Send back', from: 'submitted', to: 'draft', by: { assignee: true }, requireComment: true },
        ],
      },
    },
  });
  if (!(await prisma.rule.findFirst({ where: { tenantId: t, name: 'Large expense alert' } }))) {
    await prisma.rule.create({
      data: {
        tenantId: t, name: 'Large expense alert', eventType: 'record.expense.created',
        condition: { all: [{ fact: 'after.amount', operator: 'greaterThan', value: 25000 }] },
        actions: [{ action: 'notify', to: ['role:finance'], title: 'Large expense: {{after.number}}', body: '₹{{after.amount}} at {{after.merchant}}', link: '/app/expense/{{after.id}}' }],
      },
    });
  }
  for (const [type, module, description] of [
    ['record.expense.created', 'finance', 'An expense claim was created'],
    ['record.expense.updated', 'finance', 'An expense claim changed (incl. status)'],
    ['workflow.expense-approval.approve', 'finance', 'Expense approved by manager'],
    ['workflow.expense-approval.mark_paid', 'finance', 'Expense reimbursed'],
    ['core.user.roles_changed', 'core', "A user's roles changed"],
  ]) await prisma.eventType.upsert({ where: { type }, update: {}, create: { type, module, description } });
}

/** ~10 weeks of fictional leave and expense activity with workflow, audit and event trails. */
async function seedHistory(t: string) {
  if (await prisma.record.count({ where: { tenantId: t } })) return;
  let seed = 20261115;
  const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const DAY = 86_400_000;
  const now = Date.now();

  const members = await prisma.tenantUser.findMany({ where: { tenantId: t }, include: { user: true, roles: { include: { role: true } } } });
  const byEmail = (e: string) => members.find((m) => m.user.email === e)!;
  const admin = byEmail('admin@acme.test'), manager = byEmail('manager@acme.test'), finance = members.find((m) => m.user.email === 'finance@acme.test');
  const staff = members.filter((m) => m.managerId === manager.id);
  const org = await prisma.orgUnit.findFirst({ where: { tenantId: t, kind: 'company' } });
  const seq: Record<string, number> = { leave: 0, expense: 0 };
  const year = new Date().getFullYear();

  const events: { id: string; type: string; at: Date; actor: string; entity?: { name: string; id: string } }[] = [];
  const evt = (type: string, at: Date, actor: string, entity?: { name: string; id: string }) => events.push({ id: crypto.randomUUID(), type, at, actor, entity });

  async function make(entity: 'leave' | 'expense', owner: (typeof members)[number], at: Date, data: Record<string, unknown>, path: string[]) {
    const number = entity === 'leave' ? `LV-${year}-${String(++seq.leave).padStart(4, '0')}` : `EX-${year}-${String(++seq.expense).padStart(4, '0')}`;
    const state = path[path.length - 1];
    const rec = await prisma.record.create({
      data: { tenantId: t, entity, number, data: data as object, status: state, ownerId: owner.userId, orgUnitId: org?.id, createdBy: owner.userId, updatedBy: owner.userId, createdAt: at, version: path.length },
    });
    await prisma.auditLog.create({ data: { tenantId: t, actorType: 'user', actorId: owner.userId, action: 'create', entity, entityId: rec.id, after: data as object, createdAt: at } });
    evt(`record.${entity}.created`, at, owner.userId, { name: entity, id: rec.id });
    const inst = await prisma.workflowInstance.create({ data: { tenantId: t, workflowKey: `${entity}-approval`, version: 1, entity, recordId: rec.id, state, createdAt: at } });
    let when = at.getTime();
    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1], to = path[i];
      when += (2 + rand() * 30) * 3_600_000;
      if (when > now) when = now - rand() * 3_600_000;
      const transition = to === 'submitted' ? 'submit' : to === 'hr_review' || to === 'finance_review' ? 'escalate' : to === 'rejected' ? 'reject' : to === 'paid' ? 'mark_paid'
        : from === 'finance_review' ? 'finance_approve' : from === 'hr_review' ? 'hr_approve' : 'approve';
      const actor = transition === 'submit' ? owner : ['finance_approve', 'mark_paid'].includes(transition) ? (finance ?? admin) : transition === 'hr_approve' ? admin : manager;
      const at2 = new Date(when);
      await prisma.workflowHistory.create({ data: { tenantId: t, instanceId: inst.id, fromState: from, toState: to, transition, actorId: actor.userId, comment: transition === 'reject' ? 'Please attach the receipt / pick other dates' : null, createdAt: at2 } });
      await prisma.auditLog.create({ data: { tenantId: t, actorType: 'user', actorId: actor.userId, action: `workflow.${transition}`, entity, entityId: rec.id, before: { status: from }, after: { status: to }, createdAt: at2 } });
      evt(`workflow.${entity}-approval.${transition}`, at2, actor.userId, { name: entity, id: rec.id });
      evt(`record.${entity}.updated`, at2, actor.userId, { name: entity, id: rec.id });
    }
    const task = state === 'submitted' ? { assigneeId: manager.userId } : state === 'hr_review' ? { roleKey: 'admin' } : state === 'finance_review' ? { roleKey: 'finance' } : null;
    if (task) await prisma.workflowTask.create({ data: { tenantId: t, instanceId: inst.id, state, ...task, dueAt: new Date(when + 24 * 3_600_000), createdAt: new Date(when) } });
    return rec;
  }

  const leavePaths = [['draft', 'submitted', 'approved'], ['draft', 'submitted', 'approved'], ['draft', 'submitted', 'approved'], ['draft', 'submitted', 'hr_review', 'approved'], ['draft', 'submitted', 'rejected']];
  const expensePaths = [['draft', 'submitted', 'approved', 'paid'], ['draft', 'submitted', 'approved', 'paid'], ['draft', 'submitted', 'approved'], ['draft', 'submitted', 'finance_review', 'approved', 'paid'], ['draft', 'submitted', 'rejected']];
  const merchants: Record<string, string[]> = { Travel: ['IndiGo', 'Uber', 'IRCTC', 'Taj Hotels'], Meals: ['Saravana Bhavan', 'Swiggy', 'Starbucks'], Software: ['GitHub', 'Figma', 'JetBrains'], Equipment: ['Croma', 'Amazon'], Training: ['Coursera', 'Udemy'] };
  const amounts: Record<string, [number, number]> = { Travel: [1200, 32000], Meals: [300, 4500], Software: [800, 18000], Equipment: [2500, 85000], Training: [1500, 25000] };

  for (let back = 70; back >= 0; back--) {
    const perDay = back === 0 ? 4 : rand() < 0.25 ? 0 : 1 + Math.floor(rand() * 3);
    for (let k = 0; k < perDay; k++) {
      const owner = pick(staff.length ? staff : [manager]);
      const at = new Date(now - back * DAY - (back === 0 ? rand() * 20 : 9 + rand() * 9) * 3_600_000);
      const recent = back <= 2;
      if (rand() < 0.5) {
        const from = new Date(at.getTime() + (3 + Math.floor(rand() * 20)) * DAY);
        const days = rand() < 0.2 ? 6 + Math.floor(rand() * 5) : 1 + Math.floor(rand() * 4);
        const to = new Date(from.getTime() + (days - 1) * DAY);
        const path = recent ? (days > 5 && rand() < 0.5 ? ['draft', 'submitted', 'hr_review'] : ['draft', 'submitted']) : pick(leavePaths);
        await make('leave', owner, at, { leaveType: pick(['Casual', 'Sick', 'Earned', 'Earned', 'Casual']), fromDate: from.toISOString().slice(0, 10), toDate: to.toISOString().slice(0, 10), days, reason: pick(['Family function', 'Fever', 'Vacation', 'Personal work', 'Wedding']) }, path);
      } else {
        const category = pick(Object.keys(merchants));
        const [lo, hi] = amounts[category];
        const amount = Math.round((lo + rand() * (hi - lo)) / 10) * 10;
        const path = recent ? (amount > 10000 && rand() < 0.6 ? ['draft', 'submitted', 'finance_review'] : ['draft', 'submitted']) : pick(expensePaths).filter((s) => amount > 10000 || s !== 'finance_review');
        await make('expense', owner, at, { category, amount, spentOn: new Date(at.getTime() - 2 * DAY).toISOString().slice(0, 10), merchant: pick(merchants[category]), description: `${category} expense` }, path);
      }
    }
  }
  for (const [key, value] of Object.entries(seq)) {
    await prisma.sequence.upsert({ where: { tenantId_key: { tenantId: t, key } }, update: { value }, create: { tenantId: t, key, value } });
  }

  // Outbox history (already delivered) so the event monitor and charts have data.
  for (const e of events) {
    await prisma.outboxEvent.create({
      data: {
        id: e.id, tenantId: t, type: e.type, createdAt: e.at, publishedAt: new Date(e.at.getTime() + 300),
        payload: { id: e.id, type: e.type, version: 1, tenantId: t, actor: { type: 'user', id: e.actor }, entity: e.entity, data: {}, correlationId: e.id, depth: 0, occurredAt: e.at.toISOString() },
      },
    });
  }
  const rules = await prisma.rule.findMany({ where: { tenantId: t } });
  for (const e of events.filter((x) => x.type.endsWith('.created'))) {
    const rule = rules.find((r) => r.eventType === e.type);
    if (rule) await prisma.ruleRun.create({ data: { tenantId: t, ruleId: rule.id, eventId: e.id, matched: rand() < 0.2, createdAt: new Date(e.at.getTime() + 800) } });
  }
  await prisma.notification.createMany({
    data: [
      { tenantId: t, userId: manager.userId, title: 'Approvals waiting', body: 'Leave and expense requests from your team need review', link: '/app/inbox' },
      { tenantId: t, userId: admin.userId, title: 'Long leave requested', body: 'A request over 5 days is waiting for HR review', link: '/app/inbox' },
      ...(finance ? [{ tenantId: t, userId: finance.userId, title: 'Large expense submitted', body: 'An expense over ₹10,000 needs finance review', link: '/app/inbox' }] : []),
    ],
  });
  console.log(`Seeded history: ${seq.leave} leave requests, ${seq.expense} expense claims, ${events.length} events`);
}

main().finally(() => prisma.$disconnect());
