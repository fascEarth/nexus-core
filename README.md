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
- **Audit trail**: before/after for every change, by user, rule, workflow or AI, with an activity log viewer and field-level diffs.
- **Live dashboard**: per-module KPIs and 14-day trends, approvals pipeline, event throughput, automation stats and an activity feed, all scoped to what each user may see.
- **Admin consoles**: people & access (assign roles, suspend members, permission matrix with scopes), event monitor (delivery, correlation chains, dead-letter replay) and a Ctrl/⌘+K command palette across pages and records.
- **Reference app: NexEats**, a full food-delivery business (customer, restaurant-partner, rider and admin apps) built entirely on the platform. See below.
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
npm run db:seed                        # demo tenant "nexeats" (food delivery)
npm run dev:api                        # http://localhost:3000/api/v1
npm run dev:web                        # http://localhost:4200
```

Open http://localhost:4200 and pick a role on the sign-in screen. Every demo account uses the password **Demo@12345** (workspace `nexeats`):

| User | App | What you can do |
|---|---|---|
| customer@nexeats.test | Customer app (`/`) | Browse 10 restaurants, filter and search dishes, cart, coupons, simulated UPI/card/COD payment, live tracking on a map, cancel, rate |
| partner@nexeats.test | Restaurant app (`/partner`) | Live order board (accept, decline with reason, mark ready), menu and stock, open/closed, sales and review insights |
| rider@nexeats.test | Delivery app (`/rider`) | Go online, get trips, pickup → drop on a map, earnings |
| admin@nexeats.test | Admin console (`/app`) | Live operations map, business insights, and every platform screen: entities, rules, people, audit, events |

Customers can also sign up themselves.

## NexEats: a food-delivery business on Nexus Core

Nothing in NexEats bypasses the platform. It is a reference for building any business app on Nexus:

| Food-delivery concept | Nexus building block |
|---|---|
| Restaurants, menu items, orders, deliveries, riders, coupons | Metadata **entities** (generic data API, forms and grids in the admin console) |
| Order lifecycle: placed → preparing → ready → out for delivery → delivered / cancelled / declined | **Workflow** `order-lifecycle` (who may fire each step is data) |
| Rider trip: assigned → picked up → delivered | **Workflow** `delivery-lifecycle` |
| Each restaurant sees only its own orders and menu | **Org units** + `org_unit` permission scope, enforced with RLS per tenant |
| Customers see only their orders, riders only their trips | `own` scope |
| Rider dispatch, order sync, refunds on cancel, cash collection | **Event consumers** (`food-dispatch`) reacting to workflow events |
| "Big order", "low rating", "restaurant declined" alerts | No-code **rules**, editable in the admin console |
| Live order board, tracking, ops map | **Realtime** events over Socket.IO |
| Every accept, pickup, price change | **Audit log** with before/after |

`apps/api/src/modules/food` holds the module: pricing (server-side, the client never sends prices), role views (`/food/...`) and the event-driven automation. A demo **autopilot** keeps the marketplace alive when nobody is clicking: simulated customers order, kitchens accept and cook, riders ride. Real users always get a head start (about 25 s for restaurants, 2 min for the human rider) before it steps in. Disable it with `FOOD_AUTOPILOT=false`.

Free and simulated by design: maps are OpenStreetMap tiles via Leaflet, routes come from the public OSRM demo server (with an offline fallback), payments are a mock gateway, and the demo clock runs about 10× faster than real life.

**Try it with three tabs:** customer, restaurant partner and rider side by side. Place an order, accept it in the partner board, mark it ready, pick it up as the rider and watch the customer's map and status update live.

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
  src/modules/food    NexEats module: pricing, role views, dispatch + autopilot consumers
  prisma/             schema, rls.sql, seed (food-data.ts: demo catalogue)
apps/web            Angular 20: platform admin shell (dynamic list/form, rules, live notifications)
  src/app/food        NexEats customer, partner, rider and ops apps (Leaflet maps)
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
| Events | `GET /events/catalog`, `GET /events/recent`, `GET /events/stats`, `GET /events/dead-letters`, `POST /events/dead-letters/:id/replay` |
| Insights | `GET /insights/overview` (dashboard, permission-scoped), `GET /audit?entity&entityId&action&page` |
| Admin | `GET /admin/users`, `GET /admin/roles`, `PUT /admin/users/:id/roles`, `PUT /admin/users/:id/status` |
| Notifications | `GET /notifications`, `POST /notifications/:id/read` |
| Food (NexEats) | Public: `GET /food/restaurants`, `/food/restaurants/:id`, `/food/search`, `/food/offers`, `POST /food/quote`, `/food/signup`. Customer: `POST /food/orders`, `GET /food/orders/mine`, `/food/orders/:id/track`, `POST /food/orders/:id/cancel`, `/rate`. Partner: `GET /food/partner/board`, `/menu`, `/insights`, `POST /food/partner/orders/:id/:action`, `PUT /food/partner/menu/:id`, `/restaurant/:id`. Rider: `GET /food/rider/home`, `PUT /food/rider/online`, `POST /food/rider/deliveries/:id/:action`. Ops: `GET /food/admin/live`, `/food/admin/insights` |
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
| 5 Pilot | NexEats food delivery (4 apps), admin consoles, dashboard, event monitor | ✅ live demo · security testing next |

Next up: SLA escalation scheduler (BullMQ), email/WhatsApp channels, file storage, OpenTelemetry, a visual workflow designer, and AI agent tools generated from metadata.

## Security notes

- The app connects as `nexus_app` (no BYPASSRLS). Every transaction sets `app.tenant_id`.
- Passwords are hashed with argon2id. Access tokens last 15 minutes. Refresh tokens rotate, and reuse revokes the session.
- Rate limiting is on globally, with stricter limits on login and signup. Helmet headers and strict CORS are on.
- Webhooks are https-only, with an SSRF guard that blocks private IP ranges.
- `audit_log` is append-only for the app role.

© Fascinora. All rights reserved.
