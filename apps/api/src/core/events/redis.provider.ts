import Redis from 'ioredis';

export const EVENT_STREAM = 'nexus:events';

/** New connection per caller: blocking XREADGROUP must not share a socket. */
export function createRedis(name: string): Redis {
  return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    connectionName: `nexus:${name}`,
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
}
