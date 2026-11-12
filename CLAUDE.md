# Nexus Core — instructions for Claude Code

Multi-tenant, event-driven application platform. Business apps (HRMS, WMS, CRM…) are built ON it as metadata + event handlers.

## Stack
- `apps/api` — NestJS 11, Prisma 6, PostgreSQL 16 (RLS), Redis Streams, Socket.IO
- `apps/web` — Angular 20 standalone components, Signals, new control flow (`@if`, `@for`)
- `libs/shared-types` — contracts shared FE/BE (events, permissions, metadata). Change here first.

## Commands
- `npm run infra:up` — Postgres, Redis, MinIO, Mailpit (Docker)
- `npm run db:migrate` then `npm run db:rls -w apps/api` then `npm run db:seed`
- `npm run dev:api` / `npm run dev:web`
- `npm test` — API unit tests (jest). `npm run build` — everything.

## Non-negotiable rules
1. **Tenant data only via `prisma.tx(...)`.** It sets `app.tenant_id` so RLS applies. `prisma.system` is ONLY for tenant lookup, login, outbox relay.
2. **Every new tenant table**: add `tenantId`, add it to the list in `prisma/rls.sql`, index starting with `tenantId`.
3. **Modules never import each other.** Communicate through `EventBus.emit(tx, …)` inside the same transaction as the write, and consume with an `EventConsumer` registered in `ConsumerRegistry`.
4. **Every write** = permission check (`AccessService.assert/assertRecord`) + `AuditService.record` + event, in one transaction.
5. Event names: `<module>.<entity>.<verb>` past tense (`hrms.leave.approved`). Generic records emit `record.<entity>.created|updated|deleted`.
6. Consumers must be idempotent; never call external APIs inside a DB transaction except via the rules `webhook` action.
7. Validate all input with zod (`ZodPipe`). Never trust client-sent `tenantId`, `ownerId`, `status`.
8. Angular: standalone components, `inject()`, signals; no NgModules; use `EventHub` for live updates and `*nxCan` for permission-based UI.
9. No secrets in code. New env vars go in `.env.example`.

## Where things live
- Request/tenant context: `apps/api/src/core/context/request-context.ts`
- Permissions: `core/access/` · Events: `core/events/` · Workflow: `core/workflow/` · Rules: `core/rules/`
- Metadata + generic data API: `core/metadata/` · Realtime: `core/realtime/`
- Blueprint: `docs/BLUEPRINT.md`

## Definition of done
Typecheck passes (`npx tsc --noEmit` in apps/api), tests pass, `ng build` passes, new events added to the seed catalog, README updated if behaviour changed.
