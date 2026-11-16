import { dayKey, deliveryFee, etaMinutes, flat, km } from './food.util';

describe('food utils', () => {
  it('measures distance in km', () => {
    expect(km(11.0168, 76.9558, 11.0168, 76.9558)).toBe(0);
    expect(km(11.0176, 76.9674, 11.0291, 77.0106)).toBeGreaterThan(4);
    expect(km(11.0176, 76.9674, 11.0291, 77.0106)).toBeLessThan(5.5);
  });

  it('prices delivery by distance', () => {
    expect(deliveryFee(1.2)).toBe(25);
    expect(deliveryFee(5)).toBe(41);
  });

  it('estimates realistic ETA minutes', () => {
    expect(etaMinutes(15, 3)).toBe(34);
  });

  it('buckets days in India time', () => {
    expect(dayKey(new Date('2026-11-16T19:00:00Z'))).toBe('2026-11-17');
  });

  it('never lets JSON data shadow system fields', () => {
    const row = flat({ id: 'r1', number: 'NE-1', status: 'placed', ownerId: 'u1', orgUnitId: null, data: { id: 'hack', status: 'delivered', total: 10 } } as never);
    expect(row.id).toBe('r1');
    expect(row.status).toBe('placed');
    expect(row.total).toBe(10);
  });
});
