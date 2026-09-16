-- Staged source candidate; not a selected migration or schema acceptance.
-- BL-001 explicitly grants authenticated SELECT/INSERT/UPDATE/DELETE on these
-- operational tables. Native legacy default ALL grants leave four unrelated
-- privileges behind; TRUNCATE is not restricted by row-level security.
-- Preserve the authored DML grants, all policies, service_role and table data.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog, public;

do $operational_privileges$
declare relation_name text;
begin
  foreach relation_name in array array[
    'batch4c_security_checks', 'customer_duplicate_resolution_events',
    'customer_lifecycle_decisions', 'customer_merge_events',
    'customer_readiness_snapshots', 'document_ai_extractions'
  ] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='public' and c.relname=relation_name and c.relkind='r') then
      raise exception using errcode='55000', message='OPERATIONAL_PRIVILEGE_RELATION_REQUIRED';
    end if;
    execute format('revoke truncate, references, trigger, maintain on table public.%I from authenticated', relation_name);
  end loop;
end $operational_privileges$;
commit;
