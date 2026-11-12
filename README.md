# Nexus Core

**A multi-tenant, event-driven application platform by [Fascinora](https://github.com/fascEarth).**
Build HRMS, WMS, CRM or clinic apps by *configuring* them on Nexus Core instead of coding each from scratch.

- **Multi-tenant** with PostgreSQL Row-Level Security. A forgotten `WHERE` can't leak another tenant's data.
- **RBAC + ABAC permissions**: role, action, record scope (own/team/org unit/all), field masks, and conditions like "approve only under ₹50,000".
- **Metadata engine**: entities, fields and forms are data. The Angular shell renders menus, grids and forms for any entity.
- **Event bus**: a transactional outbox feeds Redis Streams. Modules never call each other; they react to events.
- **Real-time sync**: every committed change is pushed to open screens, filtered by permission.
- **Workflow and approvals**: multi-level, conditional routing, SLAs, send-back, delegation, and one inbox across modules.
- **No-code rules**: "When event → If condition → Then actions" (notify, update or create records, emit, webhook), with dry-run.
- **Audit trail**: before/after for every change, by user, rule, workflow or AI.
- **Claude Code kit** included: `CLAUDE.md`, 7 agents, 5 skills, hooks, MCP config.

```
Clients (Angular, PWA, AI bar, API) → Gateway (REST + WebSocket, tenant/auth/RBAC guards)
  → Core engines (metadata, access, workflow, rules, AI) → Event bus (outbox → Redis Streams)
  → Subscribers (modules, realtime, notifications, audit, search) → PostgreSQL + RLS · Redis · S3 · pgvector
```

## Quick start

Prerequisites: Node 20+, Docker.

```bash
npm install
npm run infra:up                       # Postgres (pgvector), Redis, MinIO, Mailpit
cp .env.example apps/api/.env
npm run db:migrate                     # creates tables (name the first migration "init")
npm run db:rls -w apps/api             # app role + RLS policies
npm run db:seed                        # demo tenant "acme"
npm run dev:api                        # http://localhost:3000/api/v1
npm run dev:web                        # http://localhost:4200
```

Log in with workspace **acme** using any of these:

| User | Password | Role |
|---|---|---|
| admin@acme.test | Admin@12345 | Administrator |
| manager@acme.test | Manager@12345 | Manager |
| employee@acme.test | Employee@12345 | Employee (reports to manager) |

**Try the "pages talk to each other" demo:**

1. Open two browsers: employee in one, manager in the other.
2. The employee creates a 7-day leave request and clicks **Submit**.
3. The manager's inbox badge and toast update live, the admin gets a "Long leave" notification from a rule, and the home dashboard counters move.
4. The manager clicks **Approve → HR** (because it's more than 5 days). The admin sees it in their inbox.

## Project layout

```
apps/api            NestJS API + event workers
  src/core/context    request/tenant context (AsyncLocalStorage)
  src/core/access     RBAC + ABAC engine, auth guard, @Can()
  src/core/auth       signup, login, refresh rotation with reuse detection
  src/core/events     EventBus (outbox), OutboxRelay, ConsumerRunner, dead letters
  src/core/metadata   entity definitions + generic /data/:entity API
  src/core/workflow   state machines, approval tasks, inbox
  src/core/rules      no-code automation engine
  src/core/realtime   Socket.IO gateway, permission-filtered live patches
  prisma/             schema, rls.sql, seed
apps/web            Angular 20 shell: dynamic list/form, inbox, rules, live notifications
libs/shared-types   event, permission and metadata contracts shared FE/BE
.claude/            Claude Code agents, skills, hooks, commands
docs/BLUEPRINT.md   architecture and roadmap
```

## API surface (v1)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me` |
| Metadata | `GET/POST /meta/entities`, `POST /meta/entities/:name/fields` |
| Data | `GET/POST /data/:entity`, `GET/PATCH/DELETE /data/:entity/:id`, `GET /data/:entity/:id/history` |
| Workflow | `GET /workflow/inbox`, `GET /workflow/:entity/:id`, `POST /workflow/:entity/:id/transition`, `PUT /workflow/definitions/:key` |
| Rules | `GET/POST /rules`, `PUT/DELETE /rules/:id`, `GET /rules/:id/runs`, `POST /rules/test` |
| Events | `GET /events/catalog`, `GET /events/dead-letters`, `POST /events/dead-letters/:id/replay` |
| Notifications | `GET /notifications`, `POST /notifications/:id/read` |
| Health | `GET /health` |

The tenant is sent as the `X-Tenant: <slug>` header or as a subdomain of `ROOT_DOMAIN`. It must match the JWT.

## Building with Claude Code

```
/new-module Expense claims with manager + finance approval over ₹50,000
/review
```

See `CLAUDE.md` for the rules every change must follow.

## Status and roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 Foundation | Tenancy + RLS, auth, RBAC/ABAC, audit | ✅ in this repo |
| 2 Engine | Outbox + event bus, metadata, dynamic UI, realtime | ✅ core in this repo |
| 3 Automation | Workflow, approval inbox, rules, notifications | ✅ core · scheduler/SLA escalation jobs next |
| 4 Intelligence | AI tool registry from metadata, command bar, copilot | ⏳ next |
| 5 Pilot | HRMS on Nexus Core, admin consoles, security testing | ⏳ |

Next up: SLA escalation scheduler (BullMQ), email/WhatsApp channels, file storage, OpenTelemetry, a visual workflow designer, and AI agent tools generated from metadata.

## Security notes

- The app connects as `nexus_app` (no BYPASSRLS). Every transaction sets `app.tenant_id`.
- Passwords are hashed with argon2id. Access tokens last 15 minutes. Refresh tokens rotate, and reuse revokes the session.
- Rate limiting is on globally, with stricter limits on login and signup. Helmet headers and strict CORS are on.
- Webhooks are https-only, with an SSRF guard that blocks private IP ranges.
- `audit_log` is append-only for the app role.

© Fascinora. All rights reserved.
