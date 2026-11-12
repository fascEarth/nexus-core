import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../prisma/prisma.service';
import { currentContext } from '../context/request-context';

/** Append-only change log. Call inside the same transaction as the change. */
@Injectable()
export class AuditService {
  async record(tx: Tx, input: { action: string; entity: string; entityId: string; before?: unknown; after?: unknown }) {
    const ctx = currentContext();
    await tx.auditLog.create({
      data: {
        tenantId: ctx.tenantId!,
        actorType: ctx.actor.type,
        actorId: ctx.actor.onBehalfOf ? `${ctx.actor.id} for ${ctx.actor.onBehalfOf}` : ctx.actor.id,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: ctx.ip,
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
