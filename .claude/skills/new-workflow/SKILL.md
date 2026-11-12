---
name: new-workflow
description: Define an approval workflow / state machine for an entity (multi-level, conditional routing, escalation). Use for any "needs approval" requirement.
---
# Define a workflow

Workflows are JSON, versioned; running records keep the version they started on.
```json
{
  "initial": "draft",
  "states": {
    "draft": { "label": "Draft" },
    "submitted": { "label": "Manager review", "task": { "assignee": "manager", "dueHours": 24 } },
    "finance": { "label": "Finance review", "task": { "role": "finance", "dueHours": 48 } },
    "approved": { "label": "Approved", "final": true },
    "rejected": { "label": "Rejected", "final": true }
  },
  "transitions": [
    { "name": "submit", "from": "draft", "to": "submitted", "by": { "owner": true } },
    { "name": "approve", "from": "submitted", "to": "approved", "by": { "assignee": true },
      "condition": { "fact": "record.amount", "operator": "lessThan", "value": 50000 } },
    { "name": "to_finance", "from": "submitted", "to": "finance", "by": { "assignee": true },
      "condition": { "fact": "record.amount", "operator": "greaterThanInclusive", "value": 50000 } },
    { "name": "reject", "from": ["submitted", "finance"], "to": "rejected", "by": { "assignee": true }, "requireComment": true }
  ]
}
```
Save: `PUT /api/v1/workflow/definitions/<key>` with `{ "entity": "expense", "definition": {…} }` (needs `workflow:admin`).
Every transition emits `workflow.<key>.<transition>` + `record.<entity>.updated` → rules, realtime and other modules react.
