import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityDefinition, FieldDefinition } from '@nexus/shared-types';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { EventBus } from '../events/event-bus.service';
import { AuditService } from '../audit/audit.service';
import { currentUser } from '../context/request-context';
import { AccessService } from '../access/access.service';

@Injectable()
export class MetadataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  /** Entity definitions visible to the current user, hidden fields removed. */
  async list(): Promise<EntityDefinition[]> {
    const user = currentUser();
    const defs = await this.prisma.tx((tx) =>
      tx.entityDef.findMany({ where: { published: true }, include: { fields: { orderBy: { order: 'asc' } } }, orderBy: { label: 'asc' } }),
    );
    return defs
      .filter((d) => this.access.can(user, d.name, 'read'))
      .map((d) => this.toDefinition(d, user.fieldMask[d.name]));
  }

  async get(name: string, tx?: Tx): Promise<EntityDefinition> {
    const run = (t: Tx) => t.entityDef.findFirst({ where: { name }, include: { fields: { orderBy: { order: 'asc' } } } });
    const def = tx ? await run(tx) : await this.prisma.tx(run);
    if (!def) throw new NotFoundException(`Unknown entity "${name}"`);
    return this.toDefinition(def);
  }

  async create(input: EntityDefinition) {
    const user = currentUser();
    return this.prisma.tx(async (tx) => {
      if (await tx.entityDef.findFirst({ where: { name: input.name } })) throw new ConflictException('Entity exists');
      const def = await tx.entityDef.create({
        data: {
          tenantId: user.tenantId, name: input.name, label: input.label, pluralLabel: input.pluralLabel,
          icon: input.icon, numbering: input.numbering, workflowKey: input.workflowKey,
          fields: { create: input.fields.map((f, i) => this.fieldData(user.tenantId, f, i)) },
        },
      });
      await this.audit.record(tx, { action: 'metadata.entity.create', entity: 'entity_def', entityId: def.id, after: input });
      await this.events.emit(tx, { type: 'metadata.published', data: { entity: input.name } });
      return def;
    });
  }

  async addField(entityName: string, field: FieldDefinition) {
    const user = currentUser();
    return this.prisma.tx(async (tx) => {
      const def = await tx.entityDef.findFirst({ where: { name: entityName }, include: { fields: true } });
      if (!def) throw new NotFoundException();
      const created = await tx.fieldDef.create({ data: { ...this.fieldData(user.tenantId, field, def.fields.length), entityId: def.id } });
      await tx.entityDef.update({ where: { id: def.id }, data: { version: { increment: 1 } } });
      await this.audit.record(tx, { action: 'metadata.field.create', entity: 'field_def', entityId: created.id, after: field });
      await this.events.emit(tx, { type: 'metadata.published', data: { entity: entityName } });
      return created;
    });
  }

  private fieldData(tenantId: string, f: FieldDefinition, order: number) {
    return {
      tenantId, name: f.name, label: f.label, type: f.type, required: !!f.required,
      options: (f.options ?? undefined) as Prisma.InputJsonValue | undefined,
      lookupEntity: f.lookupEntity, defaultValue: (f.defaultValue ?? undefined) as Prisma.InputJsonValue | undefined,
      pii: !!f.pii, order: f.order ?? order,
    };
  }

  private toDefinition(
    d: Prisma.EntityDefGetPayload<{ include: { fields: true } }>,
    mask?: Record<string, 'hidden' | 'read' | 'write'>,
  ): EntityDefinition {
    return {
      name: d.name, label: d.label, pluralLabel: d.pluralLabel, icon: d.icon ?? undefined,
      numbering: d.numbering ?? undefined, workflowKey: d.workflowKey ?? undefined,
      fields: d.fields
        .filter((f) => mask?.[f.name] !== 'hidden')
        .map((f) => ({
          name: f.name, label: f.label, type: f.type as FieldDefinition['type'], required: f.required,
          options: (f.options as string[] | null) ?? undefined, lookupEntity: f.lookupEntity ?? undefined,
          defaultValue: f.defaultValue ?? undefined, pii: f.pii, order: f.order,
          ...(mask?.[f.name] === 'read' ? { readOnly: true } : {}),
        })),
    };
  }
}
