-- RPC surface and permission scope corrections.
--
-- Follow-up pass after the 2026-09-02 remediation, prompted by running Supabase's
-- security advisor for the first time. Three findings, two of them introduced or
-- worsened by the remediation itself.
--
-- F-16  SECURITY DEFINER helpers were reachable as REST RPC by client roles.
-- F-17  The predicate behind the customer-document storage policies checked
--       membership in one company but the permission in any company.
-- F-18  The F-2 fix over-tightened and denied tenant users their shared masterdata.
--
-- Forward-only.

begin;

-- ---------------------------------------------------------------------------
-- F-18 first, because F-16 and F-17 build on the corrected semantics.
--
-- F-2 narrowed gridex_has_permission to platform roles only. That closed the
-- "a company role grants everywhere" hole, but also denied ordinary tenant users
-- access to platform-shared masterdata -- grid owners, price areas, electricity
-- suppliers -- whose policies grant on that predicate alone. Verified before this
-- migration: an owner of Nibela AB evaluated false for reading grid_owners, which
-- would have emptied those pickers in the application.
--
-- The mistake was treating one predicate as if it answered one question. It
-- answers two:
--
--   * shared masterdata has no tenant, so the right question is "does this user
--     hold the permission anywhere they are an active member";
--   * tenant data must ask "does this user hold it IN THIS COMPANY".
--
-- gridex_has_permission regains the first semantic, keeping the hygiene F-2 added:
-- role status, role activity and membership are checked, so a role set to
-- removed_from_company grants nothing. What it must never be again is the sole
-- grant on a tenant table; the restrictive tenant_lifecycle guards bind the
-- company there, and the invariant gate asserts those guards exist.
-- ---------------------------------------------------------------------------

create or replace function public.gridex_get_user_permissions(p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
  with role_based as (
    select distinct coalesce(p.key, p.name) as permission_name
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and coalesce(r.is_active, true)
    join public.role_permissions rp on rp.role_id = r.id and coalesce(rp.effect, 'allow') = 'allow'
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = p_user_id
      and coalesce(ur.is_active, true)
      and coalesce(ur.status, 'active') = 'active'
      and (
        (
          ur.company_id is null
          and public.gridex_normalize_platform_role(coalesce(r.key, r.name))
            in ('super_admin', 'platform_admin')
        )
        or exists (
          select 1 from public.company_memberships m
          where m.user_id = p_user_id
            and m.company_id = ur.company_id
            and m.status = 'active'
            and coalesce(m.is_active, true)
        )
      )
      and coalesce(p.key, p.name) is not null
  ),
  direct_permissions as (
    select distinct coalesce(p.key, p.name) as permission_name
    from public.user_permissions up
    join public.permissions p on p.id = up.permission_id
    where up.user_id = p_user_id and coalesce(p.key, p.name) is not null
  ),
  explicit_platform_admin_fallback as (
    select 'admin.access'::text as permission_name
    where exists (
      select 1 from public.admin_users au
      where au.user_id = p_user_id
        and coalesce(au.is_active, true)
        and public.gridex_normalize_platform_role(au.role) in ('super_admin', 'platform_admin')
    )
  )
  select coalesce(array_agg(distinct permission_name order by permission_name), '{}'::text[])
  from (
    select permission_name from role_based
    union select permission_name from direct_permissions
    union select permission_name from explicit_platform_admin_fallback
  ) q
  where permission_name is not null;
$function$;

comment on function public.gridex_get_user_permissions(uuid) is
  'F-18: permissions the user holds anywhere they are an active member. For platform-shared data only. Tenant decisions must use gridex_get_user_permissions_in_company / gridex_has_permission_in_company.';

-- ---------------------------------------------------------------------------
-- F-17: gridex_actor_has_company_permission backs every storage policy on
-- customer documents, including powers of attorney and signed agreements. It
-- required membership in the target company but then evaluated the permission
-- with the company-blind resolver, so a user who was finance in company A and
-- viewer in company B satisfied "masterdata.read for company B" using A's
-- permission. Resolve the permission in the company being asked about.
-- ---------------------------------------------------------------------------

create or replace function public.gridex_actor_has_company_permission(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p_actor_user_id is not null and p_company_id is not null
  and exists(
    select 1 from auth.users u
    where u.id = p_actor_user_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
  )
  and (
    exists(
      select 1 from public.admin_users au
      where au.user_id = p_actor_user_id
        and coalesce(au.is_active, true)
        and lower(coalesce(au.role, '')) in ('super_admin', 'superadmin', 'platform_superadmin')
    )
    or exists(
      select 1
      from public.user_roles ur left join public.roles r on r.id = ur.role_id
      where ur.user_id = p_actor_user_id and ur.company_id is null
        and coalesce(ur.status, 'active') = 'active' and coalesce(ur.is_active, true)
        and lower(coalesce(ur.role, r.key, r.name, '')) in ('super_admin', 'superadmin', 'platform_superadmin')
    )
    or (
      exists(
        select 1 from public.company_memberships cm
        join public.companies c on c.id = cm.company_id
        where cm.user_id = p_actor_user_id and cm.company_id = p_company_id
          and coalesce(cm.status, 'active') = 'active' and coalesce(cm.is_active, true)
          and coalesce(c.is_active, true)
          and coalesce(c.status, 'active') not in ('archived', 'suspended', 'pending_deletion', 'deleted')
      )
      and p_permission = any(
        public.gridex_get_user_permissions_in_company(p_actor_user_id, p_company_id)
      )
    )
  )
$function$;

comment on function public.gridex_actor_has_company_permission(uuid, uuid, text) is
  'F-17: resolves the permission in the company being asked about. Backs the storage policies on customer documents.';

-- ---------------------------------------------------------------------------
-- F-16: close the RPC surface.
--
-- Supabase's advisor flagged 28 SECURITY DEFINER functions executable by
-- authenticated and 7 by anon. Most derive everything from auth.uid() and are
-- safe. The permission resolvers are not: they take an arbitrary user id and
-- return that user's permission set, so any authenticated caller -- and for the
-- company-scoped one, any anonymous caller -- could read another user's
-- permissions straight off /rest/v1/rpc. The company-scoped resolver was
-- introduced by this remediation.
--
-- No policy calls the resolvers directly; all 47 go through gridex_has_permission.
-- Making that wrapper SECURITY DEFINER lets it keep calling the revoked resolvers
-- as its owner, so policy evaluation is unaffected while the RPC surface closes.
-- ---------------------------------------------------------------------------

create or replace function public.gridex_has_permission(p_user_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
  select p_user_id is not null
    and p_permission is not null
    and p_permission = any(public.gridex_get_user_permissions(p_user_id));
$function$;

comment on function public.gridex_has_permission(uuid, text) is
  'F-18: true if the user holds the permission in any active membership or via a platform role. Never sufficient on its own for a tenant table -- pair it with a company predicate or a restrictive tenant guard.';

revoke execute on function public.gridex_get_user_permissions(uuid) from anon, authenticated, public;
revoke execute on function public.gridex_get_user_permissions_in_company(uuid, uuid) from anon, authenticated, public;

revoke execute on function public.gridex_has_permission_in_company(uuid, text) from anon, public;
grant execute on function public.gridex_has_permission_in_company(uuid, text) to authenticated;

revoke execute on function public.gridex_has_permission(uuid, text) from anon, public;
grant execute on function public.gridex_has_permission(uuid, text) to authenticated;

revoke execute on function public.gridex_actor_has_company_permission(uuid, uuid, text) from anon, public;
grant execute on function public.gridex_actor_has_company_permission(uuid, uuid, text) to authenticated;

-- trigger-only functions are never called directly
revoke execute on function public.gridex_assert_role_scope_is_consistent() from anon, authenticated, public;
revoke execute on function public.gridex_bind_inbound_ediel_rule_pack_evidence() from anon, authenticated, public;
revoke execute on function public.gridex_guard_metering_value_source_tenant_v1() from anon, authenticated, public;

-- superseded by gridex_assert_role_scope_is_consistent during the same
-- remediation and left behind; it is attached to no trigger
drop function if exists public.gridex_assert_platform_role_is_global();

-- advisor: role mutable search_path
alter function public.gridex_grid_owner_name_key(text) set search_path = 'public', 'pg_temp';

commit;
