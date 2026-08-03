-- Align portfolio superadmin authorization with the platform's canonical role key.
begin;

create or replace function public.gridex_portfolio_actor_is_superadmin(
  p_actor_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select p_actor_user_id is not null
  and (coalesce(auth.role(), '') = 'service_role' or p_actor_user_id = auth.uid())
  and (
    exists (
      select 1
      from public.admin_users au
      where au.user_id = p_actor_user_id
        and coalesce(au.is_active, true)
        and lower(coalesce(au.role, '')) in ('super_admin', 'platform_superadmin')
    )
    or exists (
      select 1
      from public.user_roles ur
      left join public.roles r on r.id = ur.role_id
      where ur.user_id = p_actor_user_id
        and coalesce(ur.status, 'active') = 'active'
        and coalesce(ur.is_active, true)
        and lower(coalesce(ur.role, r.key, r.name, '')) in ('super_admin', 'platform_superadmin')
    )
  )
$$;

revoke execute on function public.gridex_portfolio_actor_is_superadmin(uuid)
  from public, anon;
grant execute on function public.gridex_portfolio_actor_is_superadmin(uuid)
  to authenticated, service_role;

commit;
