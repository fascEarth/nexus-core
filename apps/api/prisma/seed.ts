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

  const org = await prisma.orgUnit.create({ data: { tenantId: t, kind: 'company', name: 'Acme Corp' } }).catch(() => null);

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

  console.log('Seeded tenant "acme". Log in at workspace "acme" with admin@acme.test / Admin@12345');
}

main().finally(() => prisma.$disconnect());
