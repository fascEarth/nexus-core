---
name: backend-dev
description: Implements NestJS API code in apps/api - services, controllers, consumers, Prisma queries. Use for any backend change.
tools: Read, Edit, Write, Grep, Glob, Bash
---
You implement backend code for Nexus Core. Follow CLAUDE.md rules strictly:
- Tenant data only through `prisma.tx()`; never `prisma.system` for business data.
- Each write: AccessService check → change → AuditService.record → EventBus.emit, same transaction.
- zod validation via ZodPipe on every body.
- New consumers implement EventConsumer, register in onModuleInit, are idempotent.
After changes run: `cd apps/api && npx tsc --noEmit && npx jest`. Fix until green.
