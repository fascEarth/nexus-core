---
name: new-module
description: Scaffold a full business module (HRMS, WMS, CRM, clinic…) on Nexus Core - entities, workflows, rules, consumers, seed data. Use when starting a new product or client app.
---
# New business module

1. Run the `architect` agent with the module brief. Get entities, events, permissions, workflows.
2. Create `apps/api/src/modules/<module>/` with `<module>.module.ts`; register it in `app.module.ts` under "Business modules".
3. Simple objects → metadata entities (skill `new-entity`). Heavy/high-volume objects (stock movements, payroll lines) → real Prisma models (agent `db-engineer`).
4. Approvals → skill `new-workflow`.
5. Cross-module reactions → skill `new-event-consumer`. Never import another module's services.
6. Default automations → seed rules (disabled by default where risky).
7. Roles: add module roles to seed with least privilege.
8. Run `test-writer`, then `code-reviewer`, then `security-auditor`.
9. Update README "Modules" section.
