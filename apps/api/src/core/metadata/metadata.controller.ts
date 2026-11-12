import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { EntityDefinition, FieldDefinition } from '@nexus/shared-types';
import { Can } from '../access/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { DataService, ListQuery } from './data.service';
import { MetadataService } from './metadata.service';

const name = z.string().regex(/^[a-z][a-zA-Z0-9_]{1,40}$/, 'camelCase or snake_case, starts with a letter');
const FieldDto = z.object({
  name, label: z.string().min(1).max(80),
  type: z.enum(['text', 'textarea', 'number', 'money', 'date', 'datetime', 'boolean', 'select', 'multiselect', 'lookup', 'email', 'phone', 'file', 'json']),
  required: z.boolean().optional(), options: z.array(z.string()).optional(), lookupEntity: z.string().optional(),
  defaultValue: z.unknown().optional(), pii: z.boolean().optional(), order: z.number().int().optional(),
});
const EntityDto = z.object({
  name, label: z.string().min(1).max(80), pluralLabel: z.string().min(1).max(80),
  icon: z.string().optional(), numbering: z.string().max(40).optional(), workflowKey: z.string().optional(),
  fields: z.array(FieldDto).min(1).max(200),
});
const RecordBody = z.object({ data: z.record(z.unknown()), version: z.number().int().optional() });

@Controller('meta')
export class MetadataController {
  constructor(private readonly metadata: MetadataService) {}

  @Get('entities')
  list() {
    return this.metadata.list();
  }

  @Get('entities/:name')
  get(@Param('name') entityName: string) {
    return this.metadata.get(entityName);
  }

  @Can('metadata', 'create')
  @Post('entities')
  create(@Body(new ZodPipe(EntityDto)) body: EntityDefinition) {
    return this.metadata.create(body);
  }

  @Can('metadata', 'update')
  @Post('entities/:name/fields')
  addField(@Param('name') entityName: string, @Body(new ZodPipe(FieldDto)) body: FieldDefinition) {
    return this.metadata.addField(entityName, body);
  }
}

/** Generic data API: /data/:entity — works for every entity defined in metadata. */
@Controller('data/:entity')
export class DataController {
  constructor(private readonly data: DataService) {}

  @Get()
  list(@Param('entity') entity: string, @Query() q: ListQuery) {
    return this.data.list(entity, q);
  }

  @Get(':id')
  get(@Param('entity') entity: string, @Param('id') id: string) {
    return this.data.get(entity, id);
  }

  @Get(':id/history')
  history(@Param('entity') entity: string, @Param('id') id: string) {
    return this.data.history(entity, id);
  }

  @Post()
  create(@Param('entity') entity: string, @Body(new ZodPipe(RecordBody)) body: z.infer<typeof RecordBody>) {
    return this.data.create(entity, body.data);
  }

  @Patch(':id')
  update(@Param('entity') entity: string, @Param('id') id: string, @Body(new ZodPipe(RecordBody)) body: z.infer<typeof RecordBody>) {
    return this.data.update(entity, id, body.data, body.version);
  }

  @Delete(':id')
  remove(@Param('entity') entity: string, @Param('id') id: string) {
    return this.data.remove(entity, id);
  }
}
