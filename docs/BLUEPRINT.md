# Nexus Core — Blueprint (summary)

Full living document: https://claude.ai/artifact/38HVWARVquakxBZN5uiCUt

## Principles
1. Everything is an event: modules react, never call each other.
2. Everything is metadata: entities, fields, forms, views, permissions, workflows are rows.
3. Tenant-first: every row, event, cache key and socket room carries the tenant.
4. Permission-aware everywhere: UI, API, sockets, rules and the AI agent share one policy engine.
5. Observable and reversible: audited before/after, logged rule runs, replayable dead letters.
6. AI as a first-class user: acts through the same APIs and permissions as a human.
7. Plugin modules: a business app = metadata + event handlers dropped into the core.

## Event envelope
`{ id, type, version, tenantId, actor, entity, data, correlationId, causationId, depth, occurredAt }`
Loop guard: `depth >= 8` events are dropped and logged.

## Reliability
Transactional outbox → relay (`FOR UPDATE SKIP LOCKED`) → Redis Streams → one consumer group per subscriber → idempotency table → 3 retries → dead letter + replay.

## Permission model
| Level | Example |
|---|---|
| Module/action | `leave:approve` |
| Record scope | own / team / org_unit / all |
| Field | salary hidden for managers |
| Condition (ABAC) | `record.amount < 50000` |

## Roadmap (with Claude Code agents, ~8 weeks)
1. Foundation · 2. Engine · 3. Automation · 4. Intelligence (AI tools from metadata, command bar, copilot, NL rules) · 5. Pilot (HRMS rebuilt on the platform)

## Phase 4 design notes (AI agent)
- Tool registry generated from metadata: `search_records`, `get_record`, `create_record`, `update_record`, `transition_workflow`, `run_report`, `list_events`, `create_rule`.
- Runs under the asking user's AppUser: same `AccessService` checks.
- Writes require confirmation; actor = `{ type: 'ai', onBehalfOf: userId }` in audit and events.
- pgvector embeddings per tenant for semantic search; PII masking before model calls.
