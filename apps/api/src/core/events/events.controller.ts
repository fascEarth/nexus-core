import { Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
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
