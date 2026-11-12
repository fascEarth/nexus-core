import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { Can } from '../access/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { WorkflowService } from './workflow.service';
import type { WorkflowDefinition } from './workflow.types';

const TransitionDto = z.object({ transition: z.string().min(1), comment: z.string().max(2000).optional() });
const DefinitionDto = z.object({
  entity: z.string().min(1),
  definition: z.object({
    initial: z.string(),
    states: z.record(z.object({ label: z.string(), final: z.boolean().optional(), task: z.object({ assignee: z.enum(['manager', 'owner']).optional(), role: z.string().optional(), dueHours: z.number().optional() }).optional() })),
    transitions: z.array(z.object({
      name: z.string(), label: z.string().optional(), from: z.union([z.string(), z.array(z.string())]), to: z.string(),
      by: z.object({ owner: z.boolean().optional(), roles: z.array(z.string()).optional(), assignee: z.boolean().optional() }).optional(),
      condition: z.unknown().optional(), requireComment: z.boolean().optional(),
    })),
  }),
});

@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @Get('inbox')
  inbox() {
    return this.workflow.inbox();
  }

  @Get(':entity/:id')
  describe(@Param('entity') entity: string, @Param('id') id: string) {
    return this.workflow.describe(entity, id);
  }

  @Post(':entity/:id/transition')
  transition(@Param('entity') entity: string, @Param('id') id: string, @Body(new ZodPipe(TransitionDto)) body: z.infer<typeof TransitionDto>) {
    return this.workflow.transition(entity, id, body.transition, body.comment);
  }

  @Can('workflow', 'admin')
  @Put('definitions/:key')
  save(@Param('key') key: string, @Body(new ZodPipe(DefinitionDto)) body: z.infer<typeof DefinitionDto>) {
    return this.workflow.saveDefinition(key, body.entity, body.definition as WorkflowDefinition);
  }
}
