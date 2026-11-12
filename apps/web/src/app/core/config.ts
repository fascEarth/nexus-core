/** Runtime config. Override by defining `window.__NEXUS__ = { apiUrl, wsUrl }` in index.html for deployments. */
declare global {
  interface Window {
    __NEXUS__?: { apiUrl?: string; wsUrl?: string };
  }
}

const runtime = typeof window !== 'undefined' ? window.__NEXUS__ ?? {} : {};

export const config = {
  apiUrl: runtime.apiUrl ?? 'http://localhost:3000/api/v1',
  wsUrl: runtime.wsUrl ?? 'http://localhost:3000',
};
