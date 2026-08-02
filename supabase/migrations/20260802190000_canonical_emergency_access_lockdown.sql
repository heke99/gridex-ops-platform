-- Emergency access lockdown for the canonical production-hardening programme.
--
-- This migration is intentionally limited to the verified P0 exposure found
-- after 20260802180000. It changes no business data and preserves service-role
-- runtime access while closing the anonymous/authenticated Data API surface.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- New objects created by the migration owner must be private until an explicit
-- grant and matching RLS policy are reviewed. Existing grants are handled
-- separately below and are not changed by ALTER DEFAULT PRIVILEGES.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;

-- Supabase owns some platform-created objects as supabase_admin. The project
-- postgres role is not a member of that managed role in every hosted project.
-- Apply the same least-privilege defaults only where the platform authorizes it;
-- the postflight reports a remaining managed-role default ACL as NOT VERIFIED.
do $block$
begin
  begin
    execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from public, anon, authenticated';
    execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from public, anon, authenticated';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from public, anon, authenticated';
  exception
    when insufficient_privilege then
      raise notice 'supabase_admin default privileges require a managed-role/platform operation';
  end;
end
$block$;

-- These readiness projections are internal runtime inputs. Every active caller
-- in this repository uses the service-role client and supplies company_id.
alter view public.billing_export_readiness_v
  set (security_invoker = true);
alter view public.contract_publication_readiness_v
  set (security_invoker = true);
alter view public.gridex_tenant_contract_readiness_v
  set (security_invoker = true);
alter view public.gridex_tenant_email_dispatch_readiness_v
  set (security_invoker = true);

revoke all on table
  public.billing_export_readiness_v,
  public.contract_publication_readiness_v,
  public.gridex_tenant_contract_readiness_v,
  public.gridex_tenant_email_dispatch_readiness_v
from public, anon, authenticated;

grant select on table
  public.billing_export_readiness_v,
  public.contract_publication_readiness_v,
  public.gridex_tenant_contract_readiness_v,
  public.gridex_tenant_email_dispatch_readiness_v
to service_role;

-- Remove Data API execution from verified internal/mutating definer routines.
-- Direct service-role access is retained only as a compatibility boundary; the
-- functions themselves remain responsible for their domain invariants.
revoke execute on function public.canonical_seed_company_capabilities(uuid)
  from public, anon, authenticated;
revoke execute on function public.gridex_publish_contract_publication_version(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.gridex_refresh_billing_export_run(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.gridex_upsert_company_legal_profile_defaults(uuid)
  from public, anon, authenticated;

grant execute on function public.canonical_seed_company_capabilities(uuid)
  to service_role;
grant execute on function public.gridex_publish_contract_publication_version(uuid, uuid)
  to service_role;
grant execute on function public.gridex_refresh_billing_export_run(uuid, uuid)
  to service_role;
grant execute on function public.gridex_upsert_company_legal_profile_defaults(uuid)
  to service_role;

-- Migration manifests and preflight evidence are internal operational state,
-- never tenant-facing Data API tables.
alter table public.canonical_migration_manifest enable row level security;
alter table public.canonical_migration_manifest force row level security;
alter table public.canonical_hardening_preflight_results enable row level security;
alter table public.canonical_hardening_preflight_results force row level security;

drop policy if exists canonical_migration_manifest_service_role_all
  on public.canonical_migration_manifest;
create policy canonical_migration_manifest_service_role_all
on public.canonical_migration_manifest
for all to service_role
using (true)
with check (true);

drop policy if exists canonical_hardening_preflight_results_service_role_all
  on public.canonical_hardening_preflight_results;
create policy canonical_hardening_preflight_results_service_role_all
on public.canonical_hardening_preflight_results
for all to service_role
using (true)
with check (true);

revoke all on table
  public.canonical_migration_manifest,
  public.canonical_hardening_preflight_results
from public, anon, authenticated, service_role;

grant select, insert, update on table
  public.canonical_migration_manifest,
  public.canonical_hardening_preflight_results
to service_role;

-- One global helper is used by thousands of existing policies. Repairing the
-- function once preserves those policies while making global scope explicit.
create or replace function public.gridex_user_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  select auth.uid() is not null
    and exists (
      select 1
      from auth.users u
      join public.user_profiles up on up.id = u.id
      where u.id = auth.uid()
        and u.deleted_at is null
        and (u.banned_until is null or u.banned_until <= now())
        and u.email_confirmed_at is not null
        and up.user_status = 'active'
    )
    and (
      exists (
        select 1
        from public.admin_users au
        where au.user_id = auth.uid()
          and coalesce(au.is_active, true)
          and public.gridex_normalize_platform_role(au.role)
            in ('super_admin', 'platform_admin')
      )
      or exists (
        select 1
        from public.user_roles ur
        left join public.roles r on r.id = ur.role_id
        where ur.user_id = auth.uid()
          and ur.company_id is null
          and coalesce(ur.is_active, true)
          and coalesce(ur.status, 'active') = 'active'
          and public.gridex_normalize_platform_role(
            coalesce(ur.role, r.key, r.name)
          ) in ('super_admin', 'platform_admin')
      )
    )
$function$;

revoke execute on function public.gridex_user_is_platform_admin()
  from public, anon;
grant execute on function public.gridex_user_is_platform_admin()
  to authenticated, service_role;

-- Cross-table role normalization cannot be expressed as a CHECK constraint.
-- A trigger prevents future tenant-bound rows from carrying a global role.
create or replace function public.canonical_guard_global_platform_role_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_role text;
begin
  select public.gridex_normalize_platform_role(
           coalesce(new.role, r.key, r.name)
         )
    into v_role
  from public.roles r
  where r.id = new.role_id;

  if v_role is null then
    v_role := public.gridex_normalize_platform_role(new.role);
  end if;

  if new.company_id is not null
     and v_role in ('super_admin', 'platform_admin') then
    raise exception using
      errcode = '23514',
      message = 'tenant_bound_global_platform_role_forbidden';
  end if;

  return new;
end
$function$;

drop trigger if exists user_roles_global_platform_scope_guard
  on public.user_roles;
create trigger user_roles_global_platform_scope_guard
before insert or update of company_id, role, role_id
on public.user_roles
for each row execute function public.canonical_guard_global_platform_role_scope();

revoke execute on function public.canonical_guard_global_platform_role_scope()
  from public, anon, authenticated, service_role;

-- Transactional postconditions. Managed supabase_admin defaults are verified
-- separately because hosted projects may not allow the project role to alter
-- another managed role's default ACL.
do $verify$
declare
  v_name text;
begin
  foreach v_name in array array[
    'billing_export_readiness_v',
    'contract_publication_readiness_v',
    'gridex_tenant_contract_readiness_v',
    'gridex_tenant_email_dispatch_readiness_v'
  ] loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_name
        and 'security_invoker=true' = any(coalesce(c.reloptions, array[]::text[]))
    ) then
      raise exception 'view_not_security_invoker:%', v_name;
    end if;
    if has_table_privilege('anon', format('public.%I', v_name), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', v_name), 'SELECT') then
      raise exception 'internal_view_still_exposed:%', v_name;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.canonical_seed_company_capabilities(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.canonical_seed_company_capabilities(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.gridex_publish_contract_publication_version(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.gridex_publish_contract_publication_version(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.gridex_refresh_billing_export_run(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.gridex_refresh_billing_export_run(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.gridex_upsert_company_legal_profile_defaults(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.gridex_upsert_company_legal_profile_defaults(uuid)', 'EXECUTE') then
    raise exception 'internal_mutating_function_still_exposed';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'canonical_migration_manifest',
        'canonical_hardening_preflight_results'
      )
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  ) then
    raise exception 'canonical_internal_table_rls_not_forced';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in (
        'canonical_migration_manifest',
        'canonical_hardening_preflight_results'
      )
      and grantee in ('anon', 'authenticated')
  ) then
    raise exception 'canonical_internal_table_still_exposed';
  end if;

  if exists (
    select 1
    from public.user_roles ur
    left join public.roles r on r.id = ur.role_id
    where ur.company_id is not null
      and public.gridex_normalize_platform_role(
        coalesce(ur.role, r.key, r.name)
      ) in ('super_admin', 'platform_admin')
      and coalesce(ur.is_active, true)
      and coalesce(ur.status, 'active') = 'active'
  ) then
    raise exception 'active_tenant_bound_global_platform_role_exists';
  end if;

  if pg_get_functiondef('public.gridex_user_is_platform_admin()'::regprocedure)
       not ilike '%ur.company_id is null%' then
    raise exception 'legacy_platform_admin_helper_is_not_global_scope_safe';
  end if;
end
$verify$;

comment on function public.gridex_user_is_platform_admin()
is 'Global platform-admin helper. user_roles grants are global only when company_id IS NULL and the Auth/profile identity is functioning.';

comment on function public.canonical_guard_global_platform_role_scope()
is 'Trigger-only invariant preventing tenant-bound super_admin/platform_admin rows.';

commit;
