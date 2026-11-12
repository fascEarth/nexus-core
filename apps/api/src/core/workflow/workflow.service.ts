import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { WorkflowInstance, WorkflowTask } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus.service';
import { NotificationService } from '../notify/notification.service';
import { currentUser } from '../context/request-context';
import { evaluate } from '../common/conditions';
import type { AppUser } from '../access/access.types';
import type { WorkflowDefinition, WorkflowTransition } from './workflow.types';

@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly notify: NotificationService,
  ) {}

  /** Called by DataService on create when the entity has a workflowKey. Returns the initial state. */
  async start(tx: Tx, key: string, entity: string, recordId: string): Promise<string> {
    const def = await this.latest(tx, key);
    const spec = def.definition as unknown as WorkflowDefinition;
    const instance = await tx.workflowInstance.create({
      data: { tenantId: def.tenantId, workflowKey: key, version: def.version, entity, recordId, state: spec.initial },
    });
    await this.openTask(tx, instance, spec, spec.initial);
    return spec.initial;
  }

  /** State, the transitions this user can fire, and the history. */
  async describe(entity: string, recordId: string) {
    const user = currentUser();
    return this.prisma.tx(async (tx) => {
      const { instance, spec, record, openTasks } = await this.load(tx, entity, recordId);
      this.access.assertRecord(user, entity, 'read', record);
      const transitions = spec.transitions
        .filter((t) => this.fromMatches(t, instance.state))
        .filter((t) => this.mayFire(user, t, record, openTasks, entity))
        .map((t) => ({ name: t.name, label: t.label ?? t.name, to: t.to, requireComment: !!t.requireComment }));
      const history = await tx.workflowHistory.findMany({ where: { instanceId: instance.id }, orderBy: { createdAt: 'asc' } });
      return { state: instance.state, stateLabel: spec.states[instance.state]?.label, final: !!spec.states[instance.state]?.final, transitions, history, openTasks };
    });
  }

  async transition(entity: string, recordId: string, name: string, comment?: string) {
    const user = currentUser();
    return this.prisma.tx(async (tx) => {
      const { instance, spec, record, openTasks } = await this.load(tx, entity, recordId);
      const t = spec.transitions.find((x) => x.name === name && this.fromMatches(x, instance.state));
      if (!t) throw new BadRequestException(`Transition "${name}" not available from "${instance.state}"`);
      if (!this.mayFire(user, t, record, openTasks, entity)) throw new ForbiddenException('You cannot perform this action');
      if (t.requireComment && !comment?.trim()) throw new BadRequestException('A comment is required');

      const from = instance.state;
      await tx.workflowInstance.update({ where: { id: instance.id }, data: { state: t.to } });
      await tx.record.update({ where: { id: recordId }, data: { status: t.to, version: { increment: 1 }, updatedBy: user.userId } });
      await tx.workflowTask.updateMany({
        where: { instanceId: instance.id, status: 'open' },
        data: { status: 'done', completedAt: new Date(), completedBy: user.userId },
      });
      await tx.workflowHistory.create({
        data: { tenantId: user.tenantId, instanceId: instance.id, fromState: from, toState: t.to, transition: t.name, actorId: user.userId, comment },
      });
      await this.openTask(tx, { ...instance, state: t.to }, spec, t.to);

      if (record.ownerId !== user.userId) {
        await this.notify.create(tx, [record.ownerId], {
          title: `${record.number ?? entity} is now ${spec.states[t.to]?.label ?? t.to}`,
          body: comment, link: `/app/${entity}/${recordId}`,
        });
      }

      const data = record.data as Record<string, unknown>;
      await this.audit.record(tx, { action: `workflow.${t.name}`, entity, entityId: recordId, before: { status: from }, after: { status: t.to, comment } });
      await this.events.emit(tx, {
        type: `workflow.${instance.workflowKey}.${t.name}`,
        entity: { name: entity, id: recordId },
        data: { from, to: t.to, comment, record: { ...data, id: recordId, number: record.number, ownerId: record.ownerId } },
      });
      await this.events.emit(tx, {
        type: `record.${entity}.updated`,
        entity: { name: entity, id: recordId },
        data: { before: { ...data, status: from }, after: { ...data, id: recordId, number: record.number, status: t.to, ownerId: record.ownerId }, changed: ['status'] },
      });
      return { state: t.to };
    });
  }

  /** Unified approval inbox across all modules. */
  async inbox() {
    const user = currentUser();
    return this.prisma.tx(async (tx) => {
      const now = new Date();
      const delegators = await tx.delegation.findMany({
        where: { toUserId: user.userId, startsAt: { lte: now }, endsAt: { gte: now } }, select: { fromUserId: true },
      });
      const tasks = await tx.workflowTask.findMany({
        where: {
          status: 'open',
          OR: [
            { assigneeId: { in: [user.userId, ...delegators.map((d) => d.fromUserId)] } },
            { roleKey: { in: user.roles } },
          ],
        },
        include: { instance: true },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      const records = await tx.record.findMany({ where: { id: { in: tasks.map((t) => t.instance.recordId) } } });
      const byId = new Map(records.map((r) => [r.id, r]));
      return tasks.map((t) => {
        const r = byId.get(t.instance.recordId);
        return {
          taskId: t.id, entity: t.instance.entity, recordId: t.instance.recordId, number: r?.number, state: t.state,
          dueAt: t.dueAt, createdAt: t.createdAt, data: r ? this.access.mask(user, t.instance.entity, r.data as Record<string, unknown>) : {},
        };
      });
    });
  }

  async saveDefinition(key: string, entity: string, definition: WorkflowDefinition) {
    const user = currentUser();
    this.validate(definition);
    return this.prisma.tx(async (tx) => {
      const last = await tx.workflowDef.findFirst({ where: { key }, orderBy: { version: 'desc' } });
      if (last) await tx.workflowDef.updateMany({ where: { key }, data: { active: false } });
      // New version; in-flight instances keep the version they started with.
      return tx.workflowDef.create({
        data: { tenantId: user.tenantId, key, entity, version: (last?.version ?? 0) + 1, definition: definition as never, active: true },
      });
    });
  }

  validate(def: WorkflowDefinition) {
    if (!def.states[def.initial]) throw new BadRequestException('initial state missing');
    for (const t of def.transitions) {
      const froms = Array.isArray(t.from) ? t.from : [t.from];
      for (const s of [...froms, t.to]) if (!def.states[s]) throw new BadRequestException(`Unknown state "${s}" in ${t.name}`);
    }
  }

  private async latest(tx: Tx, key: string) {
    const def = await tx.workflowDef.findFirst({ where: { key, active: true }, orderBy: { version: 'desc' } });
    if (!def) throw new NotFoundException(`Workflow "${key}" not found`);
    return def;
  }

  private async load(tx: Tx, entity: string, recordId: string) {
    const instance = await tx.workflowInstance.findFirst({ where: { entity, recordId } });
    if (!instance) throw new NotFoundException('No workflow on this record');
    const def = await tx.workflowDef.findFirst({ where: { key: instance.workflowKey, version: instance.version } });
    if (!def) throw new NotFoundException('Workflow version missing');
    const record = await tx.record.findFirst({ where: { id: recordId, deletedAt: null } });
    if (!record) throw new NotFoundException();
    const openTasks = await tx.workflowTask.findMany({ where: { instanceId: instance.id, status: 'open' } });
    return { instance, spec: def.definition as unknown as WorkflowDefinition, record, openTasks };
  }

  private fromMatches(t: WorkflowTransition, state: string) {
    return Array.isArray(t.from) ? t.from.includes(state) : t.from === state;
  }

  private mayFire(user: AppUser, t: WorkflowTransition, record: { ownerId: string; orgUnitId: string | null; data: unknown }, openTasks: WorkflowTask[], entity: string) {
    if (!evaluate(t.condition, { record: record.data, user })) return false;
    if (!t.by) {
      const grants = this.access.grants(user, entity, 'update');
      return this.access.allowsRecord(user, grants, record);
    }
    if (t.by.owner && record.ownerId === user.userId) return true;
    if (t.by.roles?.some((r) => user.roles.includes(r))) return true;
    if (t.by.assignee && openTasks.some((task) => task.assigneeId === user.userId || (task.roleKey && user.roles.includes(task.roleKey)))) return true;
    // Admins with entity:approve may act on any approval.
    return this.access.can(user, entity, 'approve') && this.access.allowsRecord(user, this.access.grants(user, entity, 'approve'), record);
  }

  private async openTask(tx: Tx, instance: WorkflowInstance, spec: WorkflowDefinition, state: string) {
    const taskSpec = spec.states[state]?.task;
    if (!taskSpec) return;
    let assigneeId: string | null = null;
    if (taskSpec.assignee === 'manager' || taskSpec.assignee === 'owner') {
      const record = await tx.record.findUniqueOrThrow({ where: { id: instance.recordId } });
      if (taskSpec.assignee === 'owner') assigneeId = record.ownerId;
      else {
        const owner = await tx.tenantUser.findFirst({ where: { userId: record.ownerId } });
        const manager = owner?.managerId ? await tx.tenantUser.findUnique({ where: { id: owner.managerId } }) : null;
        assigneeId = manager?.userId ?? null;
      }
    }
    const roleKey = taskSpec.role ?? (assigneeId ? null : 'admin');
    await tx.workflowTask.create({
      data: {
        tenantId: instance.tenantId, instanceId: instance.id, state, assigneeId, roleKey,
        dueAt: taskSpec.dueHours ? new Date(Date.now() + taskSpec.dueHours * 3_600_000) : null,
      },
    });
    const recipients = assigneeId ? [assigneeId] : await this.notify.resolveRecipients(tx, [`role:${roleKey}`]);
    await this.notify.create(tx, recipients, { title: `Approval needed: ${spec.states[state].label}`, link: `/app/${instance.entity}/${instance.recordId}` });
  }
}
