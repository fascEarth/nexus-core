export type LatLng = [number, number];

const cache = new Map<string, Promise<LatLng[]>>();

export function distanceKm(a: LatLng, b: LatLng) {
  const R = 6371, dLat = ((b[0] - a[0]) * Math.PI) / 180, dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** A plausible street-like path (two bends) used when no routing service answers. */
export function syntheticRoute(a: LatLng, b: LatLng): LatLng[] {
  const mid1: LatLng = [a[0] + (b[0] - a[0]) * 0.35, a[1] + (b[1] - a[1]) * 0.05];
  const mid2: LatLng = [a[0] + (b[0] - a[0]) * 0.45, a[1] + (b[1] - a[1]) * 0.75];
  return [a, mid1, mid2, b];
}

/**
 * Road route from the public OSRM demo server (free, no key), cached per leg.
 * Falls back to a synthetic path after 3 s or on any error, so tracking always works.
 */
export function roadRoute(a: LatLng, b: LatLng): Promise<LatLng[]> {
  const key = [a, b].map((p) => p.map((x) => x.toFixed(4)).join(',')).join(';');
  const hit = cache.get(key);
  if (hit) return hit;
  const url = `https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  const p = fetch(url, { signal: ctrl.signal })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((j: { routes?: { geometry: { coordinates: [number, number][] } }[] }) => {
      const coords = j.routes?.[0]?.geometry.coordinates;
      if (!coords?.length) throw new Error('no route');
      return [a, ...coords.map(([lng, lat]) => [lat, lng] as LatLng), b];
    })
    .catch(() => syntheticRoute(a, b))
    .finally(() => clearTimeout(timer));
  cache.set(key, p);
  return p;
}

/** Point at fraction `t` (0..1) of the path length. */
export function along(path: LatLng[], t: number): LatLng {
  if (path.length < 2) return path[0];
  const segs = path.slice(1).map((p, i) => distanceKm(path[i], p));
  const total = segs.reduce((s, x) => s + x, 0) || 1;
  let goal = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < segs.length; i++) {
    if (goal <= segs[i] || i === segs.length - 1) {
      const f = segs[i] ? Math.min(1, goal / segs[i]) : 1;
      return [path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f];
    }
    goal -= segs[i];
  }
  return path[path.length - 1];
}
