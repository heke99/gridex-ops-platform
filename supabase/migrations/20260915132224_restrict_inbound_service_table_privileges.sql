-- Staged candidate; not a selected migration or schema acceptance.
-- 20260904120000 classifies these exact parser tables as service-role only,
-- but assumes no client grants remain. Native default ALL survives that source.
-- Remove only authenticated table privileges. Preserve every other principal,
-- policy, column privilege, object and row; fail if inherited/column reach remains.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog, public;

do $inbound_service_privileges$
declare
  relation_name text;
  relation_oid oid;
begin
  foreach relation_name in array array[
    'inbound_ediel_match_attempts',
    'inbound_ediel_parse_results',
    'inbound_email_attachments'
  ] loop
    select c.oid into relation_oid
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=relation_name
      and c.relkind='r' and c.relrowsecurity;
    if relation_oid is null then
      raise exception using errcode='55000', message='INBOUND_SERVICE_RELATION_REQUIRED';
    end if;
    -- Table REVOKE also revokes matching column ACLs: refuse that unreviewed shape.
    if exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) acl
              where a.attrelid=relation_oid and acl.grantee='authenticated'::regrole) then
      raise exception using errcode='55000', message='INBOUND_COLUMN_PRIVILEGE_UNREVIEWED';
    end if;
    execute format('revoke all privileges on table public.%I from authenticated', relation_name);
    if has_table_privilege('authenticated', relation_oid,
                          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       or has_any_column_privilege('authenticated', relation_oid, 'SELECT,INSERT,UPDATE,REFERENCES') then
      raise exception using errcode='55000', message='INBOUND_CLIENT_PRIVILEGE_REMAINS';
    end if;
  end loop;
end $inbound_service_privileges$;
commit;
