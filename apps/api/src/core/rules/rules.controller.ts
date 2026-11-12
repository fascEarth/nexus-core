import { Body, Controller, Delete, Get, Module, Param, Post, Put } from '@nestjs/common';
import type { DomainEvent } from '@nexus/shared-types';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Can } from '../access/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { currentUser } from '../context/request-context';
import { RuleDefinition, RulesService } from './rules.service';

const RuleDto = z.object({
  name: z.string().min(2).max(120),
  eventType: z.string().min(1).max(120),
  condition: z.record(z.unknown()).default({}),
  actions: z.array(z.record(z.unknown()).and(z.object({ action: z.enum(['notify', 'record.update', 'record.create', 'emit', 'webhook']) }))).min(1).max(20),
  active: z.boolean().optional(),
});
const TestDto = z.object({ rule: RuleDto, event: z.record(z.unknown()) });

@Controller('rules')
export class RulesController {
  constructor(private readonly prisma: PrismaService, private readonly rules: RulesService) {}

  @Can('rules', 'read')
  @Get()
  list() {
    return this.prisma.tx((tx) => tx.rule.findMany({ orderBy: { createdAt: 'desc' } }));
  }

  @Can('rules', 'read')
  @Get(':id/runs')
  runs(@Param('id') id: string) {
    return this.prisma.tx((tx) => tx.ruleRun.findMany({ where: { ruleId: id }, orderBy: { createdAt: 'desc' }, take: 100 }));
  }

  @Can('rules', 'create')
  @Post()
  async create(@Body(new ZodPipe(RuleDto)) body: z.infer<typeof RuleDto>) {
    const user = currentUser();
    this.rules.validate(body as unknown as RuleDefinition);
    const rule = await this.prisma.tx((tx) => tx.rule.create({
      data: { tenantId: user.tenantId, name: body.name, eventType: body.eventType, condition: body.condition as Prisma.InputJsonValue, actions: body.actions as Prisma.InputJsonValue, active: body.active ?? true },
    }));
    this.rules.invalidate(user.tenantId);
    return rule;
  }

  @Can('rules', 'update')
  @Put(':id')
  async update(@Param('id') id: string, @Body(new ZodPipe(RuleDto)) body: z.infer<typeof RuleDto>) {
    const user = currentUser();
    this.rules.validate(body as unknown as RuleDefinition);
    const rule = await this.prisma.tx((tx) => tx.rule.update({
      where: { id }, data: { name: body.name, eventType: body.eventType, condition: body.condition as Prisma.InputJsonValue, actions: body.actions as Prisma.InputJsonValue, active: body.active ?? true },
    }));
    this.rules.invalidate(user.tenantId);
    return rule;
  }

  @Can('rules', 'delete')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const user = currentUser();
    await this.prisma.tx((tx) => tx.rule.delete({ where: { id } }));
    this.rules.invalidate(user.tenantId);
    return { deleted: true };
  }

  /** Try a rule against a sample event before saving it. */
  @Can('rules', 'read')
  @Post('test')
  test(@Body(new ZodPipe(TestDto)) body: z.infer<typeof TestDto>) {
    return this.rules.test(body.rule as unknown as RuleDefinition, body.event as unknown as DomainEvent);
  }
}

@Module({ controllers: [RulesController], providers: [RulesService] })
export class RulesModule {}
