import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { hostname } from 'node:os';
import type { DomainEvent } from '@nexus/shared-types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runInContext } from '../context/request-context';
import type { EventConsumer } from './event-consumer';
import { createRedis, EVENT_STREAM } from './redis.provider';

const MAX_ATTEMPTS = 3;

/** Holds all consumers; modules register in onModuleInit. */
@Injectable()
export class ConsumerRegistry {
  readonly consumers: EventConsumer[] = [];
  register(consumer: EventConsumer) {
    if (this.consumers.some((c) => c.consumerName === consumer.consumerName)) {
      throw new Error(`Duplicate consumer ${consumer.consumerName}`);
    }
    this.consumers.push(consumer);
  }
}

/**
 * One loop per consumer: XREADGROUP → dedupe → handle inside a context
 * (tenant, correlation, causation, depth+1) → mark processed → XACK.
 * After MAX_ATTEMPTS failures the event goes to dead_letter (replayable).
 */
@Injectable()
export class ConsumerRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ConsumerRunner.name);
  private connections: Redis[] = [];
  private stopped = false;
  private readonly instance = `${hostname()}-${process.pid}`;

  constructor(private readonly registry: ConsumerRegistry, private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    if (process.env.EVENT_WORKERS === 'false') return;
    for (const consumer of this.registry.consumers) void this.loop(consumer);
    this.logger.log(`Started ${this.registry.consumers.length} event consumers`);
  }

  async onModuleDestroy() {
    this.stopped = true;
    await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
  }

  private async loop(consumer: EventConsumer) {
    const redis = createRedis(consumer.consumerName);
    this.connections.push(redis);
    const group = consumer.consumerName;
    try {
      await redis.xgroup('CREATE', EVENT_STREAM, group, '$', 'MKSTREAM');
    } catch (err) {
      if (!String(err).includes('BUSYGROUP')) throw err;
    }

    while (!this.stopped) {
      try {
        const res = (await redis.xreadgroup(
          'GROUP', group, this.instance, 'COUNT', 50, 'BLOCK', 2000, 'STREAMS', EVENT_STREAM, '>',
        )) as [string, [string, string[]][]][] | null;
        if (!res) continue;
        for (const [, messages] of res) {
          for (const [messageId, fields] of messages) {
            const event = JSON.parse(fields[1]) as DomainEvent;
            await this.process(consumer, event);
            await redis.xack(EVENT_STREAM, group, messageId);
          }
        }
      } catch (err) {
        if (this.stopped) return;
        this.logger.error(`${group} loop error: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  /** Public so the dead-letter replay endpoint can reuse it. */
  async process(consumer: EventConsumer, event: DomainEvent) {
    if (!consumer.handles(event.type)) return;
    const name = consumer.consumerName;

    const done = await this.prisma.tx(
      (tx) => tx.processedEvent.findUnique({ where: { consumer_eventId: { consumer: name, eventId: event.id } } }),
      event.tenantId,
    );
    if (done) return;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await runInContext(
          {
            tenantId: event.tenantId,
            correlationId: event.correlationId,
            causationId: event.id,
            depth: (event.depth ?? 0) + 1,
            actor: { type: 'system', id: name },
          },
          () => consumer.handle(event),
        );
        await this.prisma.tx(
          (tx) => tx.processedEvent.create({ data: { consumer: name, eventId: event.id, tenantId: event.tenantId } }),
          event.tenantId,
        );
        return;
      } catch (err) {
        this.logger.warn(`${name} failed on ${event.type} (${attempt}/${MAX_ATTEMPTS}): ${(err as Error).message}`);
        if (attempt === MAX_ATTEMPTS) {
          await this.prisma.tx(
            (tx) => tx.deadLetter.create({
              data: { tenantId: event.tenantId, consumer: name, eventId: event.id, payload: event as unknown as Prisma.InputJsonValue, error: String((err as Error).message).slice(0, 2000) },
            }),
            event.tenantId,
          );
        } else {
          await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
        }
      }
    }
  }
}
