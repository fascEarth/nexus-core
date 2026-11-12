import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { createRedis, EVENT_STREAM } from './redis.provider';

const BATCH = 100;
const INTERVAL_MS = 300;

/**
 * Moves committed outbox rows to Redis Streams.
 * `FOR UPDATE SKIP LOCKED` lets several API instances run the relay safely.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private redis?: Redis;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (process.env.EVENT_WORKERS === 'false') return;
    this.redis = createRedis('outbox');
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.redis?.quit().catch(() => undefined);
  }

  async tick() {
    if (this.running || !this.redis) return;
    this.running = true;
    try {
      await this.prisma.system.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string; payload: unknown }[]>`
          SELECT id, payload FROM outbox_event
          WHERE "publishedAt" IS NULL AND attempts < 10
          ORDER BY "createdAt"
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED`;
        if (!rows.length) return;

        const pipeline = this.redis!.pipeline();
        for (const row of rows) pipeline.xadd(EVENT_STREAM, 'MAXLEN', '~', '1000000', '*', 'e', JSON.stringify(row.payload));
        const results = await pipeline.exec();

        const ok = rows.filter((_, i) => !results?.[i]?.[0]).map((r) => r.id);
        const failed = rows.filter((_, i) => results?.[i]?.[0]).map((r) => r.id);
        if (ok.length) await tx.outboxEvent.updateMany({ where: { id: { in: ok } }, data: { publishedAt: new Date() } });
        if (failed.length) {
          await tx.outboxEvent.updateMany({ where: { id: { in: failed } }, data: { attempts: { increment: 1 }, lastError: 'XADD failed' } });
        }
      });
    } catch (err) {
      this.logger.error(`Relay tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
