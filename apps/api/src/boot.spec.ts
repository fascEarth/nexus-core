/**
 * Boot smoke test: the whole Nest app must construct (DI, decorators, module wiring)
 * and expose its routes. No database, Redis or engine needed.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';

jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  class PrismaClient {
    $connect() { return Promise.resolve(); }
    $disconnect() { return Promise.resolve(); }
  }
  return { ...actual, PrismaClient };
});

process.env.DATABASE_URL ??= 'postgresql://boot:test@127.0.0.1:1/boot';
process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET ??= 'b'.repeat(40);
process.env.EVENT_WORKERS = 'false';

describe('API boot', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const { AppModule } = await import('./app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.listen(0);
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it.each(['/insights/overview', '/audit', '/admin/users', '/admin/roles', '/events/recent', '/events/stats', '/workflow/inbox'])(
    'GET %s is registered and requires sign-in',
    async (path) => {
      const r = await fetch(`${base}${path}`);
      expect([401, 403]).toContain(r.status);
    },
  );
});
