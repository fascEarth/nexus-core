-- Row-Level Security for Nexus Core.
-- Run after `prisma migrate deploy` (npm run db:rls).
-- The app connects as `nexus_app` (no BYPASSRLS). Each transaction sets
--   SET LOCAL app.tenant_id = '<tenantId>'
-- so a forgotten WHERE can never leak another tenant's rows.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_app') THEN
    CREATE ROLE nexus_app LOGIN PASSWORD 'nexus_app';
  END IF;
END$$;

GRANT USAGE ON SCHEMA public TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexus_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexus_app;

CREATE OR REPLACE FUNCTION current_tenant() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT current_setting('app.tenant_id', true) $$;

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'tenant_user','org_unit','user_org_unit','role','role_permission','user_role',
    'field_permission','delegation','entity_def','field_def','record','sequence',
    'workflow_def','workflow_instance','workflow_task','workflow_history',
    'rule','rule_run','audit_log','notification','dead_letter','processed_event'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_tenant()) WITH CHECK ("tenantId" = current_tenant())',
      t
    );
  END LOOP;
END$$;

-- Audit log is append-only for the app role.
REVOKE UPDATE, DELETE ON audit_log FROM nexus_app;
