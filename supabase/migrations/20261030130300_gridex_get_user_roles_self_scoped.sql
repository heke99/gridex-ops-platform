-- Findings 20261029-3f1a8ab1/claude-track5/005 and /007.
--
-- 005: public.gridex_get_user_roles(uuid) is called by proxy.ts (every
-- /admin/platform/* request), lib/rbac/getUserPermissions.ts, app/dashboard/
-- page.tsx, lib/tenant/scope.ts and lib/auth/postLoginDestination.ts, but it is
-- only defined by legacy-foundation migrations (20260525_*, 20260526_*) that
-- the canonical schema does not carry. On that schema every such call fails
-- with PGRST202 and the platform admin area answers 503.
--
-- 007: those legacy definitions were SECURITY DEFINER, took any p_user_id and
-- were granted to anon, so any caller could read any user's roles. Whatever
-- exists in a given database, it is replaced here.
--
-- The function answers only for the caller's own user id, or for service_role
-- (server-side owners that check their own authorisation). Any other request
-- returns no rows. proxy.ts and app/dashboard pass the session's own user id;
-- lib/rbac/getUserPermissions.ts can be called for a viewed user (admin user
-- page), where the role fallback now returns no rows instead of another user's
-- roles. The service-role callers are unchanged. The result shape matches what
-- all callers already parse (role_key/key/code/name rows).
--
-- proxy.ts admits /admin/platform when a returned role is platform_admin or
-- super_admin. A platform role is therefore returned only when
-- canonical_actor_is_platform_admin() agrees (active admin_users grant or global
-- user_roles row, active profile); company-scoped rows and free-text membership
-- roles never yield one. Inactive roles are excluded.
--
-- The legacy debug view gridex_debug_batch2_rbac_v depends on the legacy
-- function and exposes membership data with owner rights; no code reads it.
-- It is dropped so the replacement also applies on legacy databases.

drop view if exists public.gridex_debug_batch2_rbac_v;
drop function if exists public.gridex_get_user_roles(uuid);

create function public.gridex_get_user_roles(p_user_id uuid)
returns table(role_key text, key text, code text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select p_user_id as user_id
    where p_user_id is not null
      and (
        p_user_id = auth.uid()
        or coalesce(auth.role(), '') = 'service_role'
      )
  ),
  roles as (
    select coalesce(nullif(r.key, ''), nullif(ur.role, ''), nullif(r.name, '')) as role_key,
           coalesce(nullif(r.name, ''), nullif(r.key, ''), nullif(ur.role, '')) as role_name
    from public.user_roles ur
    join allowed a on a.user_id = ur.user_id
    left join public.roles r on r.id = ur.role_id
    where coalesce(ur.is_active, true)
      and coalesce(ur.status, 'active') = 'active'
      and (r.id is null or coalesce(r.is_active, true))
    union
    select coalesce(nullif(cm.role_key, ''), nullif(cm.membership_role::text, ''), nullif(cm.role, '')),
           coalesce(nullif(cm.role_key, ''), nullif(cm.membership_role::text, ''), nullif(cm.role, ''))
    from public.company_memberships cm
    join allowed a on a.user_id = cm.user_id
    where coalesce(cm.is_active, true)
      and coalesce(cm.status, 'active') = 'active'
    union
    select public.gridex_normalize_platform_role(nullif(au.role, '')),
           public.gridex_normalize_platform_role(nullif(au.role, ''))
    from public.admin_users au
    join allowed a on a.user_id = au.user_id
    where coalesce(au.is_active, true)
  )
  select role_key, role_key, role_key, coalesce(role_name, role_key)
  from roles
  where role_key is not null
    and (
      public.gridex_normalize_platform_role(role_key) not in ('super_admin', 'platform_admin')
      or public.canonical_actor_is_platform_admin(p_user_id)
    );
$$;

revoke all on function public.gridex_get_user_roles(uuid) from public, anon;
grant execute on function public.gridex_get_user_roles(uuid) to authenticated, service_role;

comment on function public.gridex_get_user_roles(uuid) is
  'Roles of the calling user (or any user for service_role). Other requests return no rows. T5/005, T5/007.';
