import { AccessService } from './access.service';
import type { AppUser } from './access.types';

const svc = new AccessService({} as never);

const user = (permissions: AppUser['permissions'], extra: Partial<AppUser> = {}): AppUser => ({
  userId: 'u1', tenantId: 't1', tenantUserId: 'tu1', email: 'a@b.c', name: 'A',
  roles: [], permissions, fieldMask: {}, orgUnitIds: ['ou1'], teamUserIds: ['u2'], ...extra,
});

describe('AccessService', () => {
  it('matches wildcards', () => {
    const u = user([{ key: '*:read', scope: 'all' }]);
    expect(svc.can(u, 'leave', 'read')).toBe(true);
    expect(svc.can(u, 'leave', 'delete')).toBe(false);
  });

  it('builds scope filters', () => {
    const u = user([{ key: 'leave:read', scope: 'team' }]);
    expect(svc.scopeWhere(u, svc.grants(u, 'leave', 'read'))).toEqual({ OR: [{ ownerId: { in: ['u1', 'u2'] } }] });
    const admin = user([{ key: '*:*', scope: 'all' }]);
    expect(svc.scopeWhere(admin, svc.grants(admin, 'leave', 'read'))).toEqual({});
  });

  it('applies ABAC conditions on a record', () => {
    const u = user([{ key: 'expense:approve', scope: 'all', condition: { fact: 'record.amount', operator: 'lessThan', value: 50000 } }]);
    const grants = svc.grants(u, 'expense', 'approve');
    expect(svc.allowsRecord(u, grants, { ownerId: 'x', data: { amount: 10000 } })).toBe(true);
    expect(svc.allowsRecord(u, grants, { ownerId: 'x', data: { amount: 90000 } })).toBe(false);
  });

  it('masks hidden fields and blocks read-only writes', () => {
    const u = user([], { fieldMask: { employee: { salary: 'hidden', code: 'read' } } });
    expect(svc.mask(u, 'employee', { name: 'R', salary: 9 })).toEqual({ name: 'R' });
    expect(() => svc.assertWritable(u, 'employee', { code: 'X' })).toThrow();
  });
});
