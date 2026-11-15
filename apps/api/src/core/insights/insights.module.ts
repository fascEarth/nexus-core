import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus.service';
import { Can } from '../access/decorators';
import { currentUser } from '../context/request-context';
import { ZodPipe } from '../common/zod.pipe';

const DAY = 86_400_000;

/** Tenant-wide read (scope "all"), not just own records: required for platform-level views. */
export function canReadAll(access: AccessService, user: ReturnType<typeof currentUser>, resource: string): boolean {
  return access.grants(user, resource, 'read').some((g) => g.scope === 'all');
}

/** Hourly buckets for the last `hours` hours, oldest first (UTC hour starts). */
export function hourBuckets(now: Date, hours: number): Date[] {
  const end = new Date(now);
  end.setUTCMinutes(0, 0, 0);
  return Array.from({ length: hours }, (_, i) => new Date(end.getTime() - (hours - 1 - i) * 3_600_000));
}

/** Daily buckets (UTC dates, YYYY-MM-DD) for the last `days` days, oldest first. */
export function dayBuckets(now: Date, days: number): string[] {
  return Array.from({ length: days }, (_, i) => new Date(now.getTime() - (days - 1 - i) * DAY).toISOString().slice(0, 10));
}

/** Resolve actor ids like "user_1" or "user_1 for user_2" to display names. */
export function actorLabel(actorId: string, names: Map<string, string>): string {
  const [who, , behalf] = actorId.split(' ');
  const n = names.get(who) ?? (who === 'system' ? 'System' : who);
  return behalf ? `${n} (for ${names.get(behalf) ?? behalf})` : n;
}

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  /** Home dashboard. Everything is scoped to what the signed-in user may read. */
  async overview() {
    const user = currentUser();
    const now = new Date();
    const platform = canReadAll(this.access, user, 'insights');
    const canAudit = canReadAll(this.access, user, 'audit');

    return this.prisma.tx(async (tx) => {
      const entities = await tx.entityDef.findMany({ where: { published: true }, orderBy: { label: 'asc' } });
      const readable = entities.filter((e) => this.access.can(user, e.name, 'read'));
      const days = dayBuckets(now, 14);
      const since = new Date(`${days[0]}T00:00:00.000Z`);

      const perEntity = await Promise.all(readable.map(async (e) => {
        const grants = this.access.grants(user, e.name, 'read');
        const where: Prisma.RecordWhereInput = { entity: e.name, deletedAt: null, ...(this.access.scopeWhere(user, grants) as Prisma.RecordWhereInput) };
        const [total, byStatus, recent] = await Promise.all([
          tx.record.count({ where }),
          tx.record.groupBy({ by: ['status'], where, _count: true }),
          tx.record.findMany({ where: { ...where, createdAt: { gte: since } }, select: { createdAt: true } }),
        ]);
        const daily = days.map((d) => recent.filter((r) => r.createdAt.toISOString().slice(0, 10) === d).length);
        return { name: e.name, label: e.pluralLabel, total, byStatus: byStatus.map((s) => ({ status: s.status ?? 'none', count: s._count })), daily };
      }));

      const myTasks = await tx.workflowTask.count({ where: { status: 'open', OR: [{ assigneeId: user.userId }, { roleKey: { in: user.roles } }] } });
      const overdue = await tx.workflowTask.count({ where: { status: 'open', dueAt: { lt: now }, OR: [{ assigneeId: user.userId }, { roleKey: { in: user.roles } }] } });

      let events: { hourly: { hour: string; count: number }[]; byType: { type: string; count: number }[]; pending: number; deadLetters: number; total24h: number } | null = null;
      let workflow: { state: string; count: number }[] | null = null;
      let rules: { runs24h: number; matched24h: number; errors24h: number } | null = null;
      let users: { active: number; total: number } | null = null;
      if (platform) {
        const buckets = hourBuckets(now, 24);
        const ev = await tx.outboxEvent.findMany({ where: { tenantId: user.tenantId, createdAt: { gte: buckets[0] } }, select: { type: true, createdAt: true, publishedAt: true } });
        const byType = new Map<string, number>();
        for (const e of ev) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
        events = {
          hourly: buckets.map((b) => ({ hour: b.toISOString(), count: ev.filter((e) => e.createdAt >= b && e.createdAt.getTime() < b.getTime() + 3_600_000).length })),
          byType: [...byType].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count).slice(0, 8),
          pending: await tx.outboxEvent.count({ where: { tenantId: user.tenantId, publishedAt: null } }),
          deadLetters: await tx.deadLetter.count({ where: { replayed: false } }),
          total24h: ev.length,
        };
        workflow = (await tx.workflowInstance.groupBy({ by: ['state'], _count: true })).map((g) => ({ state: g.state, count: g._count }));
        const runs = await tx.ruleRun.findMany({ where: { createdAt: { gte: new Date(now.getTime() - DAY) } }, select: { matched: true, error: true } });
        rules = { runs24h: runs.length, matched24h: runs.filter((r) => r.matched).length, errors24h: runs.filter((r) => r.error).length };
        const members = await tx.tenantUser.groupBy({ by: ['status'], _count: true });
        users = { active: members.find((m) => m.status === 'active')?._count ?? 0, total: members.reduce((s, m) => s + m._count, 0) };
      }

      // Activity: everyone's for auditors, otherwise only the user's own actions.
      const activityRows = await tx.auditLog.findMany({
        where: canAudit ? {} : { actorId: { startsWith: user.userId } },
        orderBy: { createdAt: 'desc' }, take: 8,
        select: { id: true, actorId: true, actorType: true, action: true, entity: true, entityId: true, createdAt: true },
      });
      const names = await this.names(tx, [...activityRows.map((a) => a.actorId), ...activityRows.filter((a) => a.entity === 'user').map((a) => a.entityId)]);
      const numbers = new Map((await tx.record.findMany({ where: { id: { in: activityRows.map((a) => a.entityId) } }, select: { id: true, number: true } })).map((r) => [r.id, r.number]));

      return {
        days,
        entities: perEntity,
        tasks: { open: myTasks, overdue },
        events, workflow, rules, users,
        activity: activityRows.map((a) => ({
          id: a.id.toString(), action: a.action, entity: a.entity, entityId: a.entityId,
          number: a.entity === 'user' ? names.get(a.entityId) ?? null : numbers.get(a.entityId) ?? null,
          actor: actorLabel(a.actorId, names), actorType: a.actorType, createdAt: a.createdAt,
        })),
      };
    });
  }

  async names(tx: Prisma.TransactionClient, actorIds: string[]) {
    const ids = [...new Set(actorIds.flatMap((a) => a.split(' ').filter((p) => p && p !== 'for')))];
    const members = await tx.tenantUser.findMany({ where: { userId: { in: ids } }, include: { user: { select: { id: true, name: true } } } });
    return new Map(members.map((m) => [m.user.id, m.user.name]));
  }
}

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService, private readonly insights: InsightsService, private readonly access: AccessService) {}

  async list(q: z.infer<typeof AuditQuery>) {
    const user = currentUser();
    // Without tenant-wide audit access, users only see their own actions.
    if (!canReadAll(this.access, user, 'audit')) q = { ...q, actorId: user.userId };
    const pageSize = 30;
    const page = q.page ?? 1;
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorId: { startsWith: q.actorId } } : {}),
      ...(q.action ? { action: { contains: q.action, mode: 'insensitive' } } : {}),
    };
    return this.prisma.tx(async (tx) => {
      const [total, rows] = await Promise.all([
        tx.auditLog.count({ where }),
        tx.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      const names = await this.insights.names(tx, [...rows.map((r) => r.actorId), ...rows.filter((r) => r.entity === 'user').map((r) => r.entityId)]);
      const entities = (await tx.auditLog.groupBy({ by: ['entity'], _count: true })).map((g) => g.entity).sort();
      return {
        total, page, pageSize, entities,
        items: rows.map((r) => ({ ...r, id: r.id.toString(), actor: actorLabel(r.actorId, names), subject: r.entity === 'user' ? names.get(r.entityId) ?? null : null, changes: diff(r.before, r.after) })),
      };
    });
  }
}

/** Field-level differences between two JSON snapshots (top level only). */
export function diff(before: unknown, after: unknown): { field: string; from: unknown; to: unknown }[] {
  const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((f) => !['updatedAt', 'version', 'updatedBy'].includes(f));
  return fields.filter((f) => JSON.stringify(b[f]) !== JSON.stringify(a[f])).map((f) => ({ field: f, from: b[f] ?? null, to: a[f] ?? null })).slice(0, 20);
}

/** Tenant user & role administration. Every change: permission, audit, event, cache invalidation. */
@Injectable()
export class UsersAdminService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService, private readonly events: EventBus) {}

  async users() {
    if (!canReadAll(this.access, currentUser(), 'users')) throw new ForbiddenException('Missing permission users:read (all)');
    return this.prisma.tx(async (tx) => {
      const members = await tx.tenantUser.findMany({
        include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } }, roles: { include: { role: { select: { id: true, key: true, name: true } } } }, orgUnits: { include: { orgUnit: { select: { name: true } } } } },
        orderBy: { createdAt: 'asc' },
      });
      const managers = new Map(members.map((m) => [m.id, m.user.name]));
      return members.map((m) => ({
        id: m.id, userId: m.user.id, name: m.user.name, email: m.user.email, status: m.status, lastLoginAt: m.user.lastLoginAt, createdAt: m.createdAt,
        manager: m.managerId ? managers.get(m.managerId) ?? null : null,
        roles: m.roles.map((r) => r.role), orgUnits: m.orgUnits.map((o) => o.orgUnit.name),
      }));
    });
  }

  async roles() {
    if (!canReadAll(this.access, currentUser(), 'roles')) throw new ForbiddenException('Missing permission roles:read (all)');
    return this.prisma.tx(async (tx) => {
      const roles = await tx.role.findMany({ include: { permissions: true, fieldPermission: true, _count: { select: { users: true } } }, orderBy: { name: 'asc' } });
      return roles.map((r) => ({
        id: r.id, key: r.key, name: r.name, description: r.description, system: r.system, members: r._count.users,
        permissions: r.permissions.map((p) => ({ permission: p.permission, scope: p.scope, conditional: !!p.condition })),
        fields: r.fieldPermission.map((f) => ({ entity: f.entity, field: f.field, mode: f.mode })),
      }));
    });
  }

  async setRoles(tenantUserId: string, roleIds: string[]) {
    const me = currentUser();
    if (!this.access.grants(me, 'users', 'update').some((g) => g.scope === 'all')) throw new ForbiddenException('Missing permission users:update (all)');
    return this.prisma.tx(async (tx) => {
      const member = await tx.tenantUser.findUnique({ where: { id: tenantUserId }, include: { roles: { include: { role: true } } } });
      if (!member) throw new NotFoundException();
      const roles = await tx.role.findMany({ where: { id: { in: roleIds } } });
      if (roles.length !== new Set(roleIds).size) throw new BadRequestException('Unknown role');
      const before = member.roles.map((r) => r.role.key).sort();
      const after = roles.map((r) => r.key).sort();
      if (member.userId === me.userId && before.includes('admin') && !after.includes('admin')) throw new ForbiddenException('You cannot remove your own admin role');
      await tx.userRole.deleteMany({ where: { tenantUserId } });
      if (roles.length) await tx.userRole.createMany({ data: roles.map((r) => ({ tenantId: me.tenantId, tenantUserId, roleId: r.id })) });
      await this.audit.record(tx, { action: 'user.roles_changed', entity: 'user', entityId: member.userId, before: { roles: before }, after: { roles: after } });
      await this.events.emit(tx, { type: 'core.user.roles_changed', entity: { name: 'user', id: member.userId }, data: { before, after } });
      this.access.invalidate(me.tenantId);
      return { ok: true, roles: after };
    });
  }

  async setStatus(tenantUserId: string, status: 'active' | 'suspended') {
    const me = currentUser();
    if (!this.access.grants(me, 'users', 'update').some((g) => g.scope === 'all')) throw new ForbiddenException('Missing permission users:update (all)');
    return this.prisma.tx(async (tx) => {
      const member = await tx.tenantUser.findUnique({ where: { id: tenantUserId } });
      if (!member) throw new NotFoundException();
      if (member.userId === me.userId) throw new ForbiddenException('You cannot change your own status');
      await tx.tenantUser.update({ where: { id: tenantUserId }, data: { status } });
      if (status === 'suspended') await tx.session.updateMany({ where: { userId: member.userId, tenantId: me.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, { action: `user.${status}`, entity: 'user', entityId: member.userId, before: { status: member.status }, after: { status } });
      await this.events.emit(tx, { type: `core.user.${status}`, entity: { name: 'user', id: member.userId }, data: { status } });
      this.access.invalidate(me.tenantId);
      return { ok: true, status };
    });
  }
}

const AuditQuery = z.object({
  entity: z.string().max(60).optional(),
  entityId: z.string().max(60).optional(),
  actorId: z.string().max(60).optional(),
  action: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});
const RolesDto = z.object({ roleIds: z.array(z.string().max(40)).max(50) });
const StatusDto = z.object({ status: z.enum(['active', 'suspended']) });

@Controller()
export class InsightsController {
  constructor(private readonly insights: InsightsService, private readonly auditQ: AuditQueryService, private readonly admin: UsersAdminService) {}

  @Get('insights/overview')
  overview() {
    return this.insights.overview();
  }

  @Can('audit', 'read')
  @Get('audit')
  audit(@Query(new ZodPipe(AuditQuery)) q: z.infer<typeof AuditQuery>) {
    return this.auditQ.list(q);
  }

  @Can('users', 'read')
  @Get('admin/users')
  users() {
    return this.admin.users();
  }

  @Can('roles', 'read')
  @Get('admin/roles')
  roles() {
    return this.admin.roles();
  }

  @Can('users', 'update')
  @Put('admin/users/:id/roles')
  setRoles(@Param('id') id: string, @Body(new ZodPipe(RolesDto)) body: z.infer<typeof RolesDto>) {
    return this.admin.setRoles(id, body.roleIds);
  }

  @Can('users', 'update')
  @Put('admin/users/:id/status')
  setStatus(@Param('id') id: string, @Body(new ZodPipe(StatusDto)) body: z.infer<typeof StatusDto>) {
    return this.admin.setStatus(id, body.status);
  }
}

@Module({ controllers: [InsightsController], providers: [InsightsService, AuditQueryService, UsersAdminService] })
export class InsightsModule {}
