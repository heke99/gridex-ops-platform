-- GRIDEX-AUD-003 derived bootstrap: restore the historical RBAC permission lookup helpers.
-- Source: supabase/migrations/20260523_db3_tenant_isolation_rbac_enforcement.sql
-- The source migration is immutable and checksum-pinned in scripts/migration-history-manifest.json.
-- Keep this artifact limited to the two helper signatures required by later canonical evidence/access code.

create or replace function public.gridex_get_user_permissions(p_user_id uuid)
returns text[]
language sql
security definer
set search_path = public
as $$
  with role_based as (
    select distinct coalesce(p.key, p.name) as permission_name
    from public.user_roles ur
    join public.roles r
      on lower(coalesce(r.key, r.name, '')) = lower(coalesce(ur.role, ''))
    join public.role_permissions rp
      on rp.role_id = r.id
    join public.permissions p
      on p.id = rp.permission_id
    where ur.user_id = p_user_id
      and coalesce(ur.is_active, true) = true
      and coalesce(p.key, p.name) is not null
  ),
  direct_permissions as (
    select distinct coalesce(p.key, p.name) as permission_name
    from public.user_permissions up
    join public.permissions p
      on p.id = up.permission_id
    where up.user_id = p_user_id
      and coalesce(p.key, p.name) is not null
  ),
  explicit_platform_admin_fallback as (
    select 'admin.access'::text as permission_name
    where exists (
      select 1
      from public.admin_users au
      where au.user_id = p_user_id
        and coalesce(au.is_active, true) = true
        and lower(coalesce(au.role, '')) in ('super_admin','superadmin','platform_admin')
    )
  )
  select coalesce(array_agg(distinct permission_name order by permission_name), '{}'::text[])
  from (
    select permission_name from role_based
    union
    select permission_name from direct_permissions
    union
    select permission_name from explicit_platform_admin_fallback
  ) q
  where permission_name is not null;
$$;

create or replace function public.gridex_has_permission(p_user_id uuid, p_permission text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_permission is not null
    and p_permission = any(public.gridex_get_user_permissions(p_user_id));
$$;

revoke execute on function public.gridex_get_user_permissions(uuid) from anon;
revoke execute on function public.gridex_has_permission(uuid, text) from anon;
grant execute on function public.gridex_get_user_permissions(uuid) to authenticated;
grant execute on function public.gridex_has_permission(uuid, text) to authenticated;
