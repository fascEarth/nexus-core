import { actorLabel, dayBuckets, diff, hourBuckets } from './insights.module';

describe('insights helpers', () => {
  it('builds 24 hourly buckets ending at the current hour', () => {
    const b = hourBuckets(new Date('2026-11-15T10:42:00Z'), 24);
    expect(b).toHaveLength(24);
    expect(b[23].toISOString()).toBe('2026-11-15T10:00:00.000Z');
    expect(b[0].toISOString()).toBe('2026-11-14T11:00:00.000Z');
  });

  it('builds daily buckets oldest first', () => {
    expect(dayBuckets(new Date('2026-11-15T10:00:00Z'), 3)).toEqual(['2026-11-13', '2026-11-14', '2026-11-15']);
  });

  it('labels actors, including delegation', () => {
    const names = new Map([['u1', 'Asha'], ['u2', 'Murali']]);
    expect(actorLabel('u1', names)).toBe('Asha');
    expect(actorLabel('u1 for u2', names)).toBe('Asha (for Murali)');
    expect(actorLabel('system', names)).toBe('System');
    expect(actorLabel('ghost', names)).toBe('ghost');
  });

  it('diffs top-level fields and ignores bookkeeping', () => {
    expect(diff({ status: 'draft', days: 2, version: 1 }, { status: 'submitted', days: 2, version: 2 })).toEqual([{ field: 'status', from: 'draft', to: 'submitted' }]);
    expect(diff(null, { a: 1 })).toEqual([{ field: 'a', from: null, to: 1 }]);
    expect(diff({ a: [1, 2] }, { a: [1, 2] })).toEqual([]);
  });
});
