-- Batch 4F: RBAC/database lint hardening.
-- Fixes Supabase security lints without changing approved Ediel message generation behavior.

-- 1) Supabase flags SECURITY DEFINER views because they bypass caller RLS semantics.
-- These report views are metadata/readiness helpers and should execute as the querying user.
do $$
declare
  target_view text;
begin
  foreach target_view in array array[
    'gridex_batch4c_role_action_security_v',
    'gridex_sensitive_action_audit_coverage_v',
    'gridex_batch3_role_action_security_v',
    'gridex_customer_intake_security_report_v'
  ] loop
    if to_regclass('public.' || target_view) is not null then
      execute format('alter view public.%I set (security_invoker = true)', target_view);
    end if;
  end loop;
end $$;


-- 2) Ensure platform RBAC helper functions exist before RLS policies reference them.
-- Some live databases were created before Batch 6E and may not yet have these helpers.
create or replace function public.gridex_user_has_role_key(p_role_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  has_status boolean := false;
  has_is_active boolean := false;
  sql text;
  result boolean := false;
begin
  if p_role_key is null or auth.uid() is null then
    return false;
  end if;

  if to_regclass('public.user_roles') is null or to_regclass('public.roles') is null then
    return false;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_roles'
      and column_name = 'status'
  ) into has_status;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_roles'
      and column_name = 'is_active'
  ) into has_is_active;

  sql := 'select exists (' ||
         'select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id ' ||
         'where ur.user_id = $1 and r.key = $2';

  if has_status then
    sql := sql || ' and coalesce(ur.status, ''active'') = ''active''';
  elsif has_is_active then
    sql := sql || ' and coalesce(ur.is_active, true) = true';
  end if;

  sql := sql || ')';

  execute sql into result using auth.uid(), p_role_key;
  return coalesce(result, false);
exception when undefined_table or undefined_column then
  return false;
end;
$$;

create or replace function public.gridex_user_is_platform_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  -- Keep platform access hard role-based. Company-level permissions must not unlock
  -- platform-wide data or settings.
  return public.gridex_user_has_role_key('super_admin')
    or public.gridex_user_has_role_key('superadmin')
    or public.gridex_user_has_role_key('platform_admin');
exception when undefined_table or undefined_column then
  return false;
end;
$$;

revoke execute on function public.gridex_user_has_role_key(text) from anon;
grant execute on function public.gridex_user_has_role_key(text) to authenticated;
revoke execute on function public.gridex_user_is_platform_admin() from anon;
grant execute on function public.gridex_user_is_platform_admin() to authenticated;

-- 3) Enable RLS on public tables reported by Supabase lints.
-- gridex_spot_admin_basis is an admin/pricing basis table: platform-only by default.
do $$
begin
  if to_regclass('public.gridex_spot_admin_basis') is not null then
    alter table public.gridex_spot_admin_basis enable row level security;
    alter table public.gridex_spot_admin_basis force row level security;

    drop policy if exists gridex_spot_admin_basis_platform_select on public.gridex_spot_admin_basis;
    drop policy if exists gridex_spot_admin_basis_platform_write on public.gridex_spot_admin_basis;

    create policy gridex_spot_admin_basis_platform_select
      on public.gridex_spot_admin_basis
      for select
      using (public.gridex_user_is_platform_admin());

    create policy gridex_spot_admin_basis_platform_write
      on public.gridex_spot_admin_basis
      for all
      using (public.gridex_user_is_platform_admin())
      with check (public.gridex_user_is_platform_admin());
  end if;
end $$;

-- external_provider_catalog is shared catalogue data. Signed-in users may read it; platform admins manage it.
do $$
begin
  if to_regclass('public.external_provider_catalog') is not null then
    alter table public.external_provider_catalog enable row level security;
    alter table public.external_provider_catalog force row level security;

    drop policy if exists external_provider_catalog_authenticated_select on public.external_provider_catalog;
    drop policy if exists external_provider_catalog_platform_write on public.external_provider_catalog;

    create policy external_provider_catalog_authenticated_select
      on public.external_provider_catalog
      for select
      using (auth.role() = 'authenticated' or public.gridex_user_is_platform_admin());

    create policy external_provider_catalog_platform_write
      on public.external_provider_catalog
      for all
      using (public.gridex_user_is_platform_admin())
      with check (public.gridex_user_is_platform_admin());
  end if;
end $$;

-- 4) Lock mutable search_path on functions reported by Supabase lints.
-- Dynamic ALTER keeps this idempotent even when some functions only exist in older/live DBs.
do $$
declare
  fn record;
  target_names text[] := array[
    'set_updated_at_timestamp',
    'enforce_full_area_pricing',
    'gridex_touch_updated',
    'set_current_timestamp_updated_at',
    'gridex_sync_pricing_version_flags',
    'gridex_is_legacy_admin',
    'gridex_set_updated_at',
    'gridex_touch_created_by',
    'enforce_single_published_version',
    'activate_pricing_version',
    'generate_agreement_reference',
    'gridex_can_publish',
    'gridex_rate_limit_check_and_inc',
    'assign_default_role',
    'sync_user_profiles_identity',
    'calculate_gridex_quote',
    'calculate_previous_month_quote'
  ];
begin
  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(target_names)
  loop
    execute format('alter function %I.%I(%s) set search_path = public, auth, extensions', fn.nspname, fn.proname, fn.args);
  end loop;
end $$;

-- 5) Remove unauthenticated/public RPC execution on SECURITY DEFINER functions.
-- Functions that are server-only or trigger-only are also revoked from authenticated users.
-- RBAC read helpers used by server-rendered pages keep authenticated execute, but anon/public are removed.
do $$
declare
  fn record;
  revoke_from_all text[] := array[
    'activate_pricing_version',
    'admin_list_auth_users',
    'assign_default_role',
    'calculate_gridex_quote',
    'calculate_previous_month_quote',
    'gridex_can',
    'gridex_customer_queue_sync_job',
    'gridex_has_permission',
    'gridex_is_legacy_admin',
    'gridex_log_customer_login',
    'gridex_rate_limit_check_and_inc',
    'gridex_spot_publish_active_basis',
    'gridex_spot_rollback_last_publish',
    'gridex_sync_portal_from_agreement',
    'handle_new_user'
  ];
  revoke_anon_only text[] := array[
    'gridex_get_user_permissions',
    'gridex_get_user_roles'
  ];
begin
  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname = any(revoke_from_all) or p.proname = any(revoke_anon_only))
  loop
    execute format('revoke execute on function %I.%I(%s) from public', fn.nspname, fn.proname, fn.args);
    execute format('revoke execute on function %I.%I(%s) from anon', fn.nspname, fn.proname, fn.args);

    if fn.proname = any(revoke_from_all) then
      execute format('revoke execute on function %I.%I(%s) from authenticated', fn.nspname, fn.proname, fn.args);
    else
      execute format('grant execute on function %I.%I(%s) to authenticated', fn.nspname, fn.proname, fn.args);
    end if;
  end loop;
end $$;

-- 6) Keep newer RBAC helper functions explicit and non-mutable where they exist.
do $$
declare
  fn record;
  helper_names text[] := array[
    'gridex_user_has_role_key',
    'gridex_user_is_platform_admin',
    'gridex_company_is_writable',
    'gridex_user_company_ids',
    'gridex_can_read_company',
    'gridex_user_can_manage_company',
    'gridex_can_write_company'
  ];
begin
  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(helper_names)
  loop
    execute format('alter function %I.%I(%s) set search_path = public, auth', fn.nspname, fn.proname, fn.args);
    execute format('revoke execute on function %I.%I(%s) from anon', fn.nspname, fn.proname, fn.args);
    execute format('grant execute on function %I.%I(%s) to authenticated', fn.nspname, fn.proname, fn.args);
  end loop;
end $$;
