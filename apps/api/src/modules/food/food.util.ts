import type { Record as DbRecord } from '@prisma/client';

export const ACTIVE_ORDER = ['placed', 'accepted', 'ready', 'picked_up'];
export const ACTIVE_DELIVERY = ['assigned', 'picked_up'];

/** A record with its JSON data lifted to the top level (data keys never shadow system keys). */
export type Row = {
  id: string;
  number: string | null;
  status: string | null;
  ownerId: string;
  orgUnitId: string | null;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
};

export function flat(r: DbRecord): Row {
  return { ...(r.data as object), id: r.id, number: r.number, status: r.status, ownerId: r.ownerId, orgUnitId: r.orgUnitId, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

export function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371, dLat = ((bLat - aLat) * Math.PI) / 180, dLng = ((bLng - aLng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || d);
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function deliveryFee(distanceKm: number) {
  return distanceKm < 3 ? 25 : 25 + Math.round((distanceKm - 3) * 8);
}

/** Realistic minutes shown to people (the demo itself runs about 10× faster). */
export function etaMinutes(prepMinutes: number, distanceKm: number) {
  return Math.round(prepMinutes + 4 + distanceKm * 3.2 + 5);
}

export function dayKey(d: Date) {
  const x = new Date(d.getTime() + 330 * 60_000); // IST buckets
  return x.toISOString().slice(0, 10);
}

export function istHour(d: Date) {
  return new Date(d.getTime() + 330 * 60_000).getUTCHours();
}
