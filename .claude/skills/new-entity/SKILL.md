---
name: new-entity
description: Add a new metadata-driven entity (screen + API) to a tenant without writing code - e.g. "add an Expense entity with amount, category, receipt". Use when the user wants a new business object.
---
# Add a metadata entity

1. Decide fields: name (camelCase), label, type (text|textarea|number|money|date|datetime|boolean|select|multiselect|lookup|email|phone|file|json), required, options.
2. Pick a numbering pattern if records need human ids, e.g. `EXP-{YYYY}-{####}`.
3. If it needs approvals, create the workflow first (see `new-workflow` skill) and set `workflowKey`.
4. Create it via API (admin token):
   ```http
   POST /api/v1/meta/entities
   { "name": "expense", "label": "Expense", "pluralLabel": "Expenses", "numbering": "EXP-{YYYY}-{####}",
     "workflowKey": "expense-approval",
     "fields": [ { "name": "amount", "label": "Amount", "type": "money", "required": true } ] }
   ```
   For a seeded/demo tenant, add it to `apps/api/prisma/seed.ts` instead.
5. Add role permissions (`expense:read` scope own/team/all, `expense:create`, `expense:approve`) in seed or via roles API.
6. Add event types `record.expense.created|updated|deleted` to the seed event catalog.
7. The Angular shell picks it up automatically (menu, list, form). Verify in the browser.
