import { Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { currentTenantId } from '../context/request-context';
import type { DomainEvent } from '@nexus/shared-types';
import { Can } from '../access/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { ConsumerRegistry, ConsumerRunner } from './consumer-runner.service';

@Controller('events')
export class EventsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConsumerRegistry,
    private readonly runner: ConsumerRunner,
  ) {}

  /** Every event type the platform knows: used by the rules builder and AI agent. */
  @Get('catalog')
  catalog() {
    return this.prisma.system.eventType.findMany({ orderBy: { type: 'asc' } });
  }

  /** Latest events for the live monitor: type, timing and delivery state (no payload data). */
  @Can('events', 'admin')
  @Get('recent')
  async recent(@Query('type') type?: string) {
    const tenantId = currentTenantId();
    const rows = await this.prisma.system.outboxEvent.findMany({
      where: { tenantId, ...(type ? { type: { startsWith: type } } : {}) },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    return rows.map((r) => {
      const p = r.payload as unknown as DomainEvent;
      return {
        id: r.id, type: r.type, createdAt: r.createdAt, publishedAt: r.publishedAt, attempts: r.attempts, lastError: r.lastError,
        actor: p?.actor ?? null, entity: p?.entity ?? null, correlationId: p?.correlationId ?? null, causationId: p?.causationId ?? null, depth: p?.depth ?? 0,
      };
    });
  }

  /** Delivery health: outbox backlog, dead letters and registered consumers. */
  @Can('events', 'admin')
  @Get('stats')
  async stats() {
    const tenantId = currentTenantId();
    const since = new Date(Date.now() - 3_600_000);
    const [pending, lastHour, failing, deadLetters] = await Promise.all([
      this.prisma.system.outboxEvent.count({ where: { tenantId, publishedAt: null } }),
      this.prisma.system.outboxEvent.count({ where: { tenantId, createdAt: { gte: since } } }),
      this.prisma.system.outboxEvent.count({ where: { tenantId, publishedAt: null, attempts: { gt: 0 } } }),
      this.prisma.tx((tx) => tx.deadLetter.count({ where: { replayed: false } })),
    ]);
    return { pending, lastHour, failing, deadLetters, consumers: this.registry.consumers.map((c) => c.consumerName) };
  }

  @Can('events', 'admin')
  @Get('dead-letters')
  deadLetters() {
    return this.prisma.tx((tx) => tx.deadLetter.findMany({ where: { replayed: false }, orderBy: { createdAt: 'desc' }, take: 200 }));
  }

  @Can('events', 'admin')
  @Post('dead-letters/:id/replay')
  async replay(@Param('id') id: string) {
    const dl = await this.prisma.tx((tx) => tx.deadLetter.findUnique({ where: { id } }));
    if (!dl) throw new NotFoundException();
    const consumer = this.registry.consumers.find((c) => c.consumerName === dl.consumer);
    if (!consumer) throw new NotFoundException(`Consumer ${dl.consumer} not registered`);
    await this.runner.process(consumer, dl.payload as unknown as DomainEvent);
    await this.prisma.tx((tx) => tx.deadLetter.update({ where: { id }, data: { replayed: true } }));
    return { replayed: true };
  }
}
