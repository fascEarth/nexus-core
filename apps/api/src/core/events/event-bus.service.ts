import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomainEvent, MAX_CAUSATION_DEPTH } from '@nexus/shared-types';
import { Prisma } from '@prisma/client';
import type { Tx } from '../prisma/prisma.service';
import { currentContext } from '../context/request-context';

export interface EmitInput<T = Record<string, unknown>> {
  type: string;
  data: T;
  entity?: { name: string; id: string };
  version?: number;
}

/**
 * Writes events to the transactional outbox in the SAME transaction as the
 * data change. OutboxRelay publishes them to Redis Streams afterwards.
 * Modules never call each other: they emit and subscribe.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);

  async emit<T extends object>(tx: Tx, input: EmitInput<T>): Promise<DomainEvent<T> | null> {
    const ctx = currentContext();
    if (!ctx.tenantId) throw new Error('Cannot emit without tenant');

    const depth = ctx.depth ?? 0;
    if (depth >= MAX_CAUSATION_DEPTH) {
      this.logger.warn(`Loop guard: dropped ${input.type} at depth ${depth} (correlation ${ctx.correlationId})`);
      return null;
    }

    const event: DomainEvent<T> = {
      id: randomUUID(),
      type: input.type,
      version: input.version ?? 1,
      tenantId: ctx.tenantId,
      actor: ctx.actor,
      entity: input.entity,
      data: input.data,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      depth,
      occurredAt: new Date().toISOString(),
    };

    await tx.outboxEvent.create({
      data: { id: event.id, tenantId: event.tenantId, type: event.type, payload: event as unknown as Prisma.InputJsonValue },
    });
    return event;
  }
}
