-- Staged candidate, not a selected migration or schema acceptance.
-- These seven retained tenant tables have an excess authenticated TRUNCATE
-- grant. TRUNCATE bypasses row-level security; retain every other privilege,
-- policy and row. The owned PG17 fixture qualifies only this bounded delta.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog, public;

do $tenant_truncate$
declare
  target_names constant text[] := array[
    'billing_disputes', 'billing_partner_customers', 'company_go_live_reviews',
    'customer_import_batches', 'customer_import_rows', 'grid_owner_access_agreements',
    'production_route_wizard_runs'
  ];
  target_name text;
  target_oid oid;
begin
  -- Fixed names in sorted order, no caller-supplied list, no discovery of extra
  -- targets. Lock ONLY each ordinary table before validating its retained shape.
  foreach target_name in array target_names loop
    select c.oid into target_oid
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = target_name and c.relkind = 'r'
      and c.relrowsecurity and not c.relforcerowsecurity;
    if target_oid is null then
      raise exception using errcode = '55000', message = 'TENANT_TRUNCATE_RELATION_SHAPE_REQUIRED';
    end if;
    execute format('lock table only public.%I in access exclusive mode', target_name);
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.oid = target_oid and n.nspname = 'public' and c.relname = target_name
        and c.relkind = 'r' and c.relrowsecurity and not c.relforcerowsecurity
    ) then
      raise exception using errcode = '55000', message = 'TENANT_TRUNCATE_RELATION_SHAPE_REQUIRED';
    end if;
  end loop;

  foreach target_name in array target_names loop
    execute format('revoke truncate on table public.%I from authenticated', target_name);
    -- A PUBLIC/inherited grant or owner authority must not produce a false
    -- success. Reject and roll back; do not revoke anyone else's privileges.
    if has_table_privilege('authenticated', format('public.%I', target_name), 'TRUNCATE') then
      raise exception using errcode = '55000', message = 'TENANT_TRUNCATE_AUTHORITY_REMAINS';
    end if;
  end loop;
end
$tenant_truncate$;
commit;
