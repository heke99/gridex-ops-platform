-- Batch 6E hard stop: platform access is role-based only.
-- Company-level permissions such as users.write or tenants.invite must never unlock
-- /admin/companies, global users, global roles, or platform Ediel governance.

create or replace function public.gridex_user_is_platform_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  return public.gridex_user_has_role_key('super_admin')
    or public.gridex_user_has_role_key('superadmin')
    or public.gridex_user_has_role_key('platform_admin');
exception when undefined_table or undefined_column then
  return false;
end;
$$;

-- Clean up historical role grants where non-platform roles received platform-wide permissions.
do $$
begin
  if to_regclass('public.roles') is null
     or to_regclass('public.permissions') is null
     or to_regclass('public.role_permissions') is null then
    return;
  end if;

  delete from public.role_permissions rp
  using public.roles r, public.permissions p
  where rp.role_id = r.id
    and rp.permission_id = p.id
    and r.key not in ('super_admin', 'superadmin', 'platform_admin')
    and p.key in ('tenants.write', 'permissions.manage', 'roles.manage');
end $$;
