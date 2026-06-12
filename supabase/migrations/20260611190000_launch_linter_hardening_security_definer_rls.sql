-- Launch linter hardening: SECURITY DEFINER views/functions, search_path, RLS policy gaps.
-- Corrected version: does NOT redefine existing public function return types.
-- It only uses ALTER VIEW, ALTER FUNCTION, REVOKE/GRANT and safe RLS policies.
-- If an earlier version of this migration failed, the failed transaction was rolled back;
-- replace that file with this version and run again.

create schema if not exists extensions;

-- Move pg_trgm out of public where Supabase linter flags it. If the platform blocks
-- the move, do not block the rest of the hardening.
do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm'
      and n.nspname = 'public'
  ) then
    alter extension pg_trgm set schema extensions;
  end if;
exception when others then
  raise notice 'pg_trgm extension move skipped: %', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- Base RBAC/self-read policies needed before converting public helper RPCs to
-- SECURITY INVOKER. These policies avoid recursion by using direct auth.uid()
-- checks instead of calling Gridex helper functions.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.admin_users') is not null then
    alter table public.admin_users enable row level security;
    drop policy if exists gridex_linter_admin_users_self_read on public.admin_users;
    create policy gridex_linter_admin_users_self_read
      on public.admin_users
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;

  if to_regclass('public.user_roles') is not null then
    alter table public.user_roles enable row level security;
    drop policy if exists gridex_linter_user_roles_self_read on public.user_roles;
    create policy gridex_linter_user_roles_self_read
      on public.user_roles
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;

  if to_regclass('public.company_memberships') is not null then
    alter table public.company_memberships enable row level security;
    drop policy if exists gridex_linter_company_memberships_self_read on public.company_memberships;
    create policy gridex_linter_company_memberships_self_read
      on public.company_memberships
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;

  if to_regclass('public.roles') is not null then
    alter table public.roles enable row level security;
    drop policy if exists gridex_linter_roles_authenticated_read on public.roles;
    create policy gridex_linter_roles_authenticated_read
      on public.roles
      for select
      to authenticated
      using (true);
  end if;

  if to_regclass('public.permissions') is not null then
    alter table public.permissions enable row level security;
    drop policy if exists gridex_linter_permissions_authenticated_read on public.permissions;
    create policy gridex_linter_permissions_authenticated_read
      on public.permissions
      for select
      to authenticated
      using (true);
  end if;

  if to_regclass('public.role_permissions') is not null then
    alter table public.role_permissions enable row level security;
    drop policy if exists gridex_linter_role_permissions_authenticated_read on public.role_permissions;
    create policy gridex_linter_role_permissions_authenticated_read
      on public.role_permissions
      for select
      to authenticated
      using (true);
  end if;

  if to_regclass('public.user_permissions') is not null then
    alter table public.user_permissions enable row level security;
    drop policy if exists gridex_linter_user_permissions_self_read on public.user_permissions;
    create policy gridex_linter_user_permissions_self_read
      on public.user_permissions
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;

  if to_regclass('public.user_permission_overrides') is not null then
    alter table public.user_permission_overrides enable row level security;
    drop policy if exists gridex_linter_user_permission_overrides_self_read on public.user_permission_overrides;
    create policy gridex_linter_user_permission_overrides_self_read
      on public.user_permission_overrides
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- SECURITY DEFINER views: make every public view run as invoker and remove anon
-- reads. This targets all old debug/readiness views in the Supabase lint export.
-- -----------------------------------------------------------------------------
do $$
declare
  v record;
begin
  for v in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
  loop
    begin
      execute format('alter view public.%I set (security_invoker = true)', v.relname);
      execute format('revoke all on public.%I from public, anon', v.relname);
    exception when others then
      raise notice 'view hardening skipped for public.%: %', v.relname, sqlerrm;
    end;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Function search_path: every public function gets a fixed search_path. This does
-- not change function signatures or return types.
-- -----------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    begin
      execute format(
        'alter function %I.%I(%s) set search_path = public, auth, extensions',
        fn.nspname, fn.proname, fn.args
      );
    exception when others then
      raise notice 'search_path hardening skipped for %.%(%) : %', fn.nspname, fn.proname, fn.args, sqlerrm;
    end;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- App/RLS helper RPCs: convert from SECURITY DEFINER to SECURITY INVOKER without
-- redefining their return types. This removes the Supabase linter warning while
-- preserving the existing function signatures. No CREATE OR REPLACE is used here.
-- -----------------------------------------------------------------------------
do $$
declare
  fn record;
  helper_names text[] := array[
    'admin_customer_ids_by_latest_contract',
    'admin_customer_latest_contract_counts',
    'gridex_auth_has_any_role',
    'gridex_auth_has_role',
    'gridex_can',
    'gridex_can_read_company',
    'gridex_can_write_company',
    'gridex_company_is_writable',
    'gridex_company_status_is_writable',
    'gridex_get_user_permission_overrides',
    'gridex_get_user_permissions',
    'gridex_get_user_roles',
    'gridex_has_effective_permission',
    'gridex_has_permission',
    'gridex_is_current_session_allowed',
    'gridex_user_can_manage_company',
    'gridex_user_company_ids',
    'gridex_user_has_role_key',
    'gridex_user_is_platform_admin',
    'gridex_user_is_super_admin'
  ];
begin
  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(helper_names)
  loop
    begin
      execute format('alter function %I.%I(%s) security invoker', fn.nspname, fn.proname, fn.args);
      execute format('revoke all on function %I.%I(%s) from public, anon', fn.nspname, fn.proname, fn.args);
      execute format('grant execute on function %I.%I(%s) to authenticated, service_role', fn.nspname, fn.proname, fn.args);
    exception when others then
      raise notice 'helper hardening skipped for %.%(%) : %', fn.nspname, fn.proname, fn.args, sqlerrm;
    end;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Remove direct external RPC execution from remaining public SECURITY DEFINER
-- functions. These are admin/backfill/import/trigger/server helpers and should
-- not be callable from anon/auth REST RPC.
-- -----------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
  loop
    begin
      execute format('revoke all on function %I.%I(%s) from public, anon, authenticated', fn.nspname, fn.proname, fn.args);
      execute format('grant execute on function %I.%I(%s) to service_role', fn.nspname, fn.proname, fn.args);
    exception when others then
      raise notice 'execute revoke skipped for %.%(%) : %', fn.nspname, fn.proname, fn.args, sqlerrm;
    end;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- RLS enabled but no policies: add minimal, safe policies. This removes lint
-- findings without opening tables to anon. Company-scoped tables use direct
-- membership checks. User-scoped tables use auth.uid(). Technical/masterdata
-- tables become platform-admin-only using direct admin_users/user_roles checks.
-- -----------------------------------------------------------------------------
do $$
declare
  t record;
  has_company_id boolean;
  has_user_id boolean;
  platform_expr text := 'exists (select 1 from public.admin_users au where au.user_id = auth.uid() and coalesce(au.is_active, true) = true and lower(coalesce(au.role, '''')) in (''super_admin'',''superadmin'',''platform_admin'')) or exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and coalesce(ur.is_active, true) = true and lower(coalesce(ur.role, ur.role_key, '''')) in (''super_admin'',''superadmin'',''platform_admin''))';
  tenant_read_expr text := 'exists (select 1 from public.company_memberships cm where cm.company_id = company_id and cm.user_id = auth.uid() and coalesce(cm.status, ''active'') = ''active'' and coalesce(cm.is_active, true) = true)';
  tenant_write_expr text := 'exists (select 1 from public.company_memberships cm where cm.company_id = company_id and cm.user_id = auth.uid() and coalesce(cm.status, ''active'') = ''active'' and coalesce(cm.is_active, true) = true and lower(coalesce(cm.membership_role::text, cm.role_key, cm.role, '''')) in (''owner'',''company_admin'',''admin'',''operations_manager'',''customer_service_manager''))';
begin
  for t in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and c.relrowsecurity = true
      and not exists (select 1 from pg_policy pol where pol.polrelid = c.oid)
  loop
    select exists (
      select 1 from information_schema.columns
      where table_schema = t.schema_name and table_name = t.table_name and column_name = 'company_id'
    ) into has_company_id;

    select exists (
      select 1 from information_schema.columns
      where table_schema = t.schema_name and table_name = t.table_name and column_name = 'user_id'
    ) into has_user_id;

    begin
      if has_company_id then
        execute format('create policy %I on %I.%I for select to authenticated using ((%s) or (%s))', 'gridex_linter_tenant_select', t.schema_name, t.table_name, platform_expr, tenant_read_expr);
        execute format('create policy %I on %I.%I for insert to authenticated with check ((%s) or (%s))', 'gridex_linter_tenant_insert', t.schema_name, t.table_name, platform_expr, tenant_write_expr);
        execute format('create policy %I on %I.%I for update to authenticated using ((%s) or (%s)) with check ((%s) or (%s))', 'gridex_linter_tenant_update', t.schema_name, t.table_name, platform_expr, tenant_read_expr, platform_expr, tenant_write_expr);
        execute format('create policy %I on %I.%I for delete to authenticated using (%s)', 'gridex_linter_platform_delete', t.schema_name, t.table_name, platform_expr);
      elsif has_user_id then
        execute format('create policy %I on %I.%I for select to authenticated using (user_id = auth.uid() or (%s))', 'gridex_linter_self_or_platform_select', t.schema_name, t.table_name, platform_expr);
        execute format('create policy %I on %I.%I for all to authenticated using (%s) with check (%s)', 'gridex_linter_platform_write', t.schema_name, t.table_name, platform_expr, platform_expr);
      else
        execute format('create policy %I on %I.%I for all to authenticated using (%s) with check (%s)', 'gridex_linter_platform_only', t.schema_name, t.table_name, platform_expr, platform_expr);
      end if;
    exception when duplicate_object then
      null;
    when others then
      raise notice 'RLS policy hardening skipped for %.%: %', t.schema_name, t.table_name, sqlerrm;
    end;
  end loop;
end $$;

-- Keep anon completely out of public tables/views/functions after the policy pass.
do $$
declare
  r record;
begin
  for r in select schemaname, tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke all on table %I.%I from public, anon', r.schemaname, r.tablename);
  end loop;
end $$;

-- Audit marker for operations visibility.
do $$
begin
  if to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs (action, metadata, created_at)
    values (
      'launch_linter_hardening_applied',
      jsonb_build_object(
        'migration', '20260611190000_launch_linter_hardening_security_definer_rls',
        'scope', jsonb_build_array('security_definer_views','function_search_path','rpc_execute_revokes','rls_policy_gaps','pg_trgm_schema'),
        'return_type_safe', true
      ),
      now()
    );
  end if;
exception when others then
  null;
end $$;
