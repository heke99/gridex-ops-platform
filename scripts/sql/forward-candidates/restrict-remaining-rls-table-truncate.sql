-- Staged candidate, not a selected migration or schema acceptance.
-- These 22 retained RLS tables have an excess authenticated TRUNCATE
-- grant. TRUNCATE bypasses row-level security; retain every other privilege,
-- policy and row. The owned PG17 fixture qualifies only this bounded delta.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog, public;

do $remaining_rls_truncate$
declare
  target_names constant text[] := array[
    'customer_case_events',
    'customer_lifecycle_events',
    'customer_sync_events',
    'data_quality_findings',
    'ediel_agt_readiness',
    'ediel_test_customers',
    'ediel_test_expected_acks',
    'ediel_test_expected_values',
    'ediel_test_facilities',
    'ediel_test_field_values',
    'ediel_test_metering_points',
    'ediel_test_run_locks',
    'ediel_unlinked_test_messages',
    'gridex_archived_customer_registry_rows',
    'page_performance_budgets',
    'platform_session_revocations',
    'status_transition_rules',
    'tenant_email_domains',
    'tenant_email_sender_profiles',
    'tenant_governance_events',
    'white_label_platform_memberships',
    'white_label_platforms'
  ];
  target_name text;
  target_oid oid;
begin
  -- Fixed names in sorted order, no caller-supplied list, no discovery of extra
  -- targets. Reject owner-role membership (including SET-only access); owners
  -- can regrant their own ordinary privileges. Then lock ONLY each table.
  foreach target_name in array target_names loop
    select c.oid into target_oid
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = target_name and c.relkind = 'r'
      and c.relrowsecurity and not c.relforcerowsecurity
      and not pg_has_role('authenticated', c.relowner, 'MEMBER');
    if target_oid is null then
      raise exception using errcode = '55000', message = 'REMAINING_RLS_TRUNCATE_RELATION_SHAPE_REQUIRED';
    end if;
    execute format('lock table only public.%I in access exclusive mode', target_name);
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.oid = target_oid and n.nspname = 'public' and c.relname = target_name
        and c.relkind = 'r' and c.relrowsecurity and not c.relforcerowsecurity
        and not pg_has_role('authenticated', c.relowner, 'MEMBER')
    ) then
      raise exception using errcode = '55000', message = 'REMAINING_RLS_TRUNCATE_RELATION_SHAPE_REQUIRED';
    end if;
  end loop;

  foreach target_name in array target_names loop
    execute format('revoke truncate on table public.%I from authenticated', target_name);
    -- A PUBLIC/inherited grant or owner authority must not produce a false
    -- success. Reject and roll back; do not revoke anyone else's privileges.
    if has_table_privilege('authenticated', format('public.%I', target_name), 'TRUNCATE') then
      raise exception using errcode = '55000', message = 'REMAINING_RLS_TRUNCATE_AUTHORITY_REMAINS';
    end if;
  end loop;
end
$remaining_rls_truncate$;
commit;
