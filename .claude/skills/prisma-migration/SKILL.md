---
name: prisma-migration
description: Safely change the database schema - add a table/column/index, with RLS and zero-downtime steps. Use for any schema.prisma edit.
---
# Schema change checklist

1. Edit `apps/api/prisma/schema.prisma`. New tenant table → `tenantId String` + `@@index([tenantId, …])` + `@@map("snake_name")`.
2. Add the table to `tenant_tables` in `prisma/rls.sql`.
3. `cd apps/api && npx prisma format && npx prisma migrate dev --name <change>`
4. `npm run db:rls -w apps/api`
5. Renames/drops: expand → backfill → switch code → contract, over two releases.
6. `npx tsc --noEmit && npx jest`.
7. Add a cross-tenant isolation test for the new table.
