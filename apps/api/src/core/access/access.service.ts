import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CompiledPermission, FieldMask, PermissionScope } from '@nexus/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { Condition, evaluate } from '../common/conditions';
import type { AppUser } from './access.types';

interface ScopedRecord {
  ownerId: string;
  orgUnitId?: string | null;
  data?: unknown;
}

const CACHE_TTL_MS = 60_000;

/**
 * One policy engine for API, sockets, rules and the AI agent.
 * Permission key: `<resource>:<action>`; `*` is a wildcard on either side.
 */
@Injectable()
export class AccessService {
  private cache = new Map<string, { user: AppUser; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  invalidate(tenantId?: string) {
    if (!tenantId) return this.cache.clear();
    for (const key of this.cache.keys()) if (key.startsWith(`${tenantId}:`)) this.cache.delete(key);
  }

  async loadUser(tenantId: string, userId: string): Promise<AppUser> {
    const key = `${tenantId}:${userId}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.user;

    const user = await this.prisma.tx(async (tx) => {
      const membership = await tx.tenantUser.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        include: {
          user: true,
          orgUnits: true,
          roles: { include: { role: { include: { permissions: true, fieldPermission: true } } } },
        },
      });
      if (!membership || membership.status !== 'active') throw new ForbiddenException('Not a member of this tenant');

      const reports = await tx.tenantUser.findMany({ where: { managerId: membership.id }, select: { userId: true } });

      const permissions: CompiledPermission[] = [];
      const fieldMask: FieldMask = {};
      const rank = { hidden: 0, read: 1, write: 2 } as const;

      for (const ur of membership.roles) {
        for (const p of ur.role.permissions) {
          permissions.push({ key: p.permission as CompiledPermission['key'], scope: p.scope as PermissionScope, condition: p.condition ?? undefined });
        }
        // Most permissive field mode across roles wins.
        for (const fp of ur.role.fieldPermission) {
          const mode = fp.mode as keyof typeof rank;
          const current = fieldMask[fp.entity]?.[fp.field];
          if (!current || rank[mode] > rank[current]) {
            fieldMask[fp.entity] = { ...(fieldMask[fp.entity] ?? {}), [fp.field]: mode };
          }
        }
      }

      const appUser: AppUser = {
        userId,
        tenantId,
        tenantUserId: membership.id,
        email: membership.user.email,
        name: membership.user.name,
        roles: membership.roles.map((r) => r.role.key),
        permissions,
        fieldMask,
        orgUnitIds: membership.orgUnits.map((o) => o.orgUnitId),
        teamUserIds: reports.map((r) => r.userId),
      };
      return appUser;
    }, tenantId);

    this.cache.set(key, { user, at: Date.now() });
    return user;
  }

  /** Permissions granting `resource:action` (empty = denied). */
  grants(user: AppUser, resource: string, action: string): CompiledPermission[] {
    return user.permissions.filter((p) => {
      const [r, a] = p.key.split(':');
      return (r === '*' || r === resource) && (a === '*' || a === action);
    });
  }

  can(user: AppUser, resource: string, action: string): boolean {
    return this.grants(user, resource, action).length > 0;
  }

  assert(user: AppUser, resource: string, action: string): CompiledPermission[] {
    const grants = this.grants(user, resource, action);
    if (!grants.length) throw new ForbiddenException(`Missing permission ${resource}:${action}`);
    return grants;
  }

  /** Prisma `where` fragment restricting records to the user's scope. */
  scopeWhere(user: AppUser, grants: CompiledPermission[]): Record<string, unknown> {
    if (grants.some((g) => g.scope === 'all')) return {};
    const or: Record<string, unknown>[] = [];
    if (grants.some((g) => g.scope === 'own')) or.push({ ownerId: user.userId });
    if (grants.some((g) => g.scope === 'team')) or.push({ ownerId: { in: [user.userId, ...user.teamUserIds] } });
    if (grants.some((g) => g.scope === 'org_unit') && user.orgUnitIds.length) or.push({ orgUnitId: { in: user.orgUnitIds } });
    return or.length ? { OR: or } : { id: '__none__' };
  }

  /** Check a single record against scope + ABAC condition. */
  allowsRecord(user: AppUser, grants: CompiledPermission[], record: ScopedRecord): boolean {
    return grants.some((g) => {
      const inScope =
        g.scope === 'all' ||
        (g.scope === 'own' && record.ownerId === user.userId) ||
        (g.scope === 'team' && (record.ownerId === user.userId || user.teamUserIds.includes(record.ownerId))) ||
        (g.scope === 'org_unit' && !!record.orgUnitId && user.orgUnitIds.includes(record.orgUnitId));
      if (!inScope) return false;
      return evaluate(g.condition as Condition | undefined, { record: record.data ?? {}, user });
    });
  }

  assertRecord(user: AppUser, resource: string, action: string, record: ScopedRecord) {
    const grants = this.assert(user, resource, action);
    if (!this.allowsRecord(user, grants, record)) throw new ForbiddenException(`Not allowed to ${action} this ${resource}`);
  }

  /** Remove hidden fields from record data. */
  mask(user: AppUser, entity: string, data: Record<string, unknown>): Record<string, unknown> {
    const rules = user.fieldMask[entity];
    if (!rules) return data;
    return Object.fromEntries(Object.entries(data).filter(([field]) => rules[field] !== 'hidden'));
  }

  /** Throw if the patch touches fields the user may not write. */
  assertWritable(user: AppUser, entity: string, patch: Record<string, unknown>) {
    const rules = user.fieldMask[entity];
    if (!rules) return;
    const blocked = Object.keys(patch).filter((f) => rules[f] === 'hidden' || rules[f] === 'read');
    if (blocked.length) throw new ForbiddenException(`Read-only fields: ${blocked.join(', ')}`);
  }
}
