import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { currentTenantId } from '../context/request-context';

export type Tx = Prisma.TransactionClient;

/**
 * Two clients:
 *  - `system`: owner connection. Only for cross-tenant platform work
 *    (tenant lookup, login, outbox relay). Never for tenant business data.
 *  - `app`: restricted role `nexus_app`; RLS enforced. All tenant data goes
 *    through `tx()`, which sets `app.tenant_id` for the transaction.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly system: PrismaClient;
  readonly app: PrismaClient;

  constructor() {
    this.system = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    const appUrl = process.env.APP_DATABASE_URL;
    if (!appUrl) {
      this.logger.warn('APP_DATABASE_URL not set: using owner connection, RLS is NOT enforced. Dev only.');
    }
    this.app = appUrl ? new PrismaClient({ datasourceUrl: appUrl }) : this.system;
  }

  /** Run tenant-scoped work in one transaction with RLS tenant set. */
  async tx<T>(fn: (tx: Tx) => Promise<T>, tenantId: string = currentTenantId()): Promise<T> {
    return this.app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  async onModuleDestroy() {
    await this.system.$disconnect();
    if (this.app !== this.system) await this.app.$disconnect();
  }
}
