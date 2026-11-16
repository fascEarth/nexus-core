/** Runtime config. Override by defining `window.__NEXUS__ = { apiUrl, wsUrl }` in index.html for deployments. */
declare global {
  interface Window {
    __NEXUS__?: { apiUrl?: string; wsUrl?: string; tenant?: string };
  }
}

const runtime = typeof window !== 'undefined' ? window.__NEXUS__ ?? {} : {};
/** Served from a real domain (behind Caddy): API and sockets live on the same origin. */
const sameOrigin = typeof location !== 'undefined' && !['localhost', '127.0.0.1'].includes(location.hostname);

export const config = {
  apiUrl: runtime.apiUrl ?? (sameOrigin ? `${location.origin}/api/v1` : 'http://localhost:3000/api/v1'),
  wsUrl: runtime.wsUrl ?? (sameOrigin ? location.origin : 'http://localhost:3000'),
  /** Workspace used before sign-in (public catalogue, sign-up). */
  tenant: runtime.tenant ?? 'nexeats',
};
