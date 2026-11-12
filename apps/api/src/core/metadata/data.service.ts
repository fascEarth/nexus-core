import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Record as DbRecord } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus.service';
import { currentUser } from '../context/request-context';
import { MetadataService } from './metadata.service';
import { validateRecord } from './validation';
import { WorkflowService } from '../workflow/workflow.service';

export interface ListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}

/**
 * Generic CRUD for every metadata-defined entity.
 * Each write = permission check + validation + audit + outbox event, in one transaction.
 */
@Injectable()
export class DataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly metadata: MetadataService,
    private readonly workflow: WorkflowService,
  ) {}

  async list(entity: string, q: ListQuery) {
    const user = currentUser();
    const grants = this.access.assert(user, entity, 'read');
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));

    const where: Prisma.RecordWhereInput = {
      entity, deletedAt: null,
      ...(this.access.scopeWhere(user, grants) as Prisma.RecordWhereInput),
      ...(q.status ? { status: q.status } : {}),
    };

    return this.prisma.tx(async (tx) => {
      let ids: string[] | undefined;
      if (q.search) {
        const term = `%${q.search.replace(/[%_]/g, '\\$&')}%`;
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM record WHERE entity = ${entity} AND "deletedAt" IS NULL
          AND (data::text ILIKE ${term} OR number ILIKE ${term}) LIMIT 1000`;
        ids = rows.map((r) => r.id);
      }
      const finalWhere = ids ? { AND: [where, { id: { in: ids } }] } : where;
      const [total, rows] = await Promise.all([
        tx.record.count({ where: finalWhere }),
        tx.record.findMany({ where: finalWhere, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      const items = rows.filter((r) => this.access.allowsRecord(user, grants, r)).map((r) => this.present(r));
      return { items, total, page, pageSize };
    });
  }

  async get(entity: string, id: string) {
    const user = currentUser();
    const record = await this.prisma.tx((tx) => this.find(tx, entity, id));
    this.access.assertRecord(user, entity, 'read', record);
    return this.present(record);
  }

  async create(entity: string, input: Record<string, unknown>) {
    const user = currentUser();
    this.access.assert(user, entity, 'create');
    this.access.assertWritable(user, entity, input);

    return this.prisma.tx(async (tx) => {
      const def = await this.metadata.get(entity, tx);
      const data = validateRecord(def, input);
      const number = def.numbering ? await this.nextNumber(tx, entity, def.numbering) : null;

      let record = await tx.record.create({
        data: {
          tenantId: user.tenantId, entity, number, data: data as Prisma.InputJsonValue,
          ownerId: user.userId, orgUnitId: user.orgUnitIds[0] ?? null,
          createdBy: user.userId, updatedBy: user.userId,
        },
      });

      if (def.workflowKey) {
        const state = await this.workflow.start(tx, def.workflowKey, entity, record.id);
        record = await tx.record.update({ where: { id: record.id }, data: { status: state } });
      }

      await this.audit.record(tx, { action: 'create', entity, entityId: record.id, after: data });
      await this.events.emit(tx, {
        type: `record.${entity}.created`,
        entity: { name: entity, id: record.id },
        data: { before: null, after: { ...data, id: record.id, number: record.number, status: record.status, ownerId: record.ownerId } },
      });
      return this.present(record);
    });
  }

  async update(entity: string, id: string, input: Record<string, unknown>, expectedVersion?: number) {
    const user = currentUser();
    this.access.assertWritable(user, entity, input);

    return this.prisma.tx(async (tx) => {
      const existing = await this.find(tx, entity, id);
      this.access.assertRecord(user, entity, 'update', existing);
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw new ConflictException({ message: 'Record was changed by someone else', current: this.present(existing) });
      }

      const def = await this.metadata.get(entity, tx);
      const patch = validateRecord(def, input, true);
      const before = existing.data as Record<string, unknown>;
      const after = { ...before, ...patch };

      // Version check in WHERE: concurrent writers can't both win.
      const { count } = await tx.record.updateMany({
        where: { id, version: existing.version },
        data: { data: after as Prisma.InputJsonValue, version: { increment: 1 }, updatedBy: user.userId },
      });
      if (!count) throw new ConflictException('Record was changed by someone else');
      const record = await this.find(tx, entity, id);

      await this.audit.record(tx, { action: 'update', entity, entityId: id, before, after });
      await this.events.emit(tx, {
        type: `record.${entity}.updated`,
        entity: { name: entity, id },
        data: { before: { ...before, status: existing.status }, after: { ...after, id, number: record.number, status: record.status, ownerId: record.ownerId }, changed: Object.keys(patch) },
      });
      return this.present(record);
    });
  }

  async remove(entity: string, id: string) {
    const user = currentUser();
    return this.prisma.tx(async (tx) => {
      const existing = await this.find(tx, entity, id);
      this.access.assertRecord(user, entity, 'delete', existing);
      await tx.record.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.userId } });
      await this.audit.record(tx, { action: 'delete', entity, entityId: id, before: existing.data });
      await this.events.emit(tx, { type: `record.${entity}.deleted`, entity: { name: entity, id }, data: { before: existing.data, after: null } });
      return { deleted: true };
    });
  }

  async history(entity: string, id: string) {
    const user = currentUser();
    return this.prisma.tx(async (tx) => {
      const existing = await this.find(tx, entity, id);
      this.access.assertRecord(user, entity, 'read', existing);
      const logs = await tx.auditLog.findMany({ where: { entity, entityId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
      return logs.map((l) => ({ ...l, id: l.id.toString() }));
    });
  }

  private async find(tx: Tx, entity: string, id: string) {
    const record = await tx.record.findFirst({ where: { id, entity, deletedAt: null } });
    if (!record) throw new NotFoundException();
    return record;
  }

  /** `LV-{YYYY}-{####}` → LV-2026-0042. Row lock in sequence table keeps it gap-safe under concurrency. */
  private async nextNumber(tx: Tx, entity: string, pattern: string) {
    const user = currentUser();
    const seq = await tx.sequence.upsert({
      where: { tenantId_key: { tenantId: user.tenantId, key: entity } },
      create: { tenantId: user.tenantId, key: entity, value: 1 },
      update: { value: { increment: 1 } },
    });
    const now = new Date();
    return pattern
      .replace('{YYYY}', String(now.getFullYear()))
      .replace('{MM}', String(now.getMonth() + 1).padStart(2, '0'))
      .replace(/\{(#+)\}/, (_, h: string) => String(seq.value).padStart(h.length, '0'));
  }

  private present(r: DbRecord) {
    const user = currentUser();
    return {
      id: r.id, number: r.number, status: r.status, version: r.version, ownerId: r.ownerId,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
      data: this.access.mask(user, r.entity, r.data as Record<string, unknown>),
    };
  }
}
