-- Company-scoped permission engine.
--
-- F-1: canonical_authenticated_tenant_context recomputed roles and permissions as
--      a union across every company the user belonged to, overwriting the correct
--      result from canonical_authenticated_tenant_context_v1_scoped whenever it was
--      called without a selected company -- which the application always was. A
--      user who was finance in company A and viewer in company B passed
--      billing.write while operating in B.
--
-- F-2: gridex_get_user_permissions never referenced user_roles.company_id and
--      checked only is_active, not status. gridex_has_permission() was therefore a
--      tenant-unbound global boolean, and a role set to removed_from_company kept
--      its rights.
--
-- F-7: a role with company_id IS NULL was treated as platform-wide regardless of
--      which role it was, so a company_admin assigned without a company granted its
--      permissions in every tenant. Nothing in the schema prevented either that or
--      a company-scoped super_admin.
--
-- Forward-only.

begin;

-- ---------------------------------------------------------------------------
-- F-1: one resolution path. No union branch.
-- ---------------------------------------------------------------------------

create or replace function public.canonical_authenticated_tenant_context(
  p_selected_company_id uuid default null::uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
begin
  -- The scoped implementation filters roles and permissions by
  -- user_role.company_id = selected company. Permissions never span companies.
  return public.canonical_authenticated_tenant_context_v1_scoped(p_selected_company_id);
end
$function$;

comment on function public.canonical_authenticated_tenant_context(uuid) is
  'F-1: delegates to the company-scoped resolver. Permissions are never unioned across companies.';

-- ---------------------------------------------------------------------------
-- F-7 repair: bind company roles that lost their company.
--
-- Step 1 drops redundant global company roles for users who already hold an
-- active company-scoped role. Verified against the live catalogue before writing:
-- owner and company_admin resolve to identical permission sets, so no access is
-- lost. Step 2 binds anything left where the intended company is unambiguous.
-- ---------------------------------------------------------------------------

delete from public.user_roles ur
where ur.company_id is null
  and exists (
    select 1 from public.roles r
    where r.id = ur.role_id
      and public.gridex_normalize_platform_role(coalesce(r.key, r.name))
        not in ('super_admin', 'platform_admin')
  )
  and exists (
    select 1 from public.user_roles scoped
    where scoped.user_id = ur.user_id
      and scoped.company_id is not null
      and coalesce(scoped.is_active, true)
      and coalesce(scoped.status, 'active') = 'active'
  );

update public.user_roles ur
set company_id = m.company_id,
    updated_at = now()
from (
  select cm.user_id,
         min(cm.company_id::text)::uuid as company_id,
         count(*) as membership_count
  from public.company_memberships cm
  where cm.status = 'active' and coalesce(cm.is_active, true)
  group by cm.user_id
) m
where ur.user_id = m.user_id
  and m.membership_count = 1
  and ur.company_id is null
  and exists (
    select 1 from public.roles r
    where r.id = ur.role_id
      and public.gridex_normalize_platform_role(coalesce(r.key, r.name))
        not in ('super_admin', 'platform_admin')
  );

-- ---------------------------------------------------------------------------
-- F-2: the legacy single-argument resolver keeps its signature so existing
-- policies and callers still resolve, but "global" now means "platform role".
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
      and ur.company_id is null
      and public.gridex_normalize_platform_role(coalesce(r.key, r.name))
        in ('super_admin', 'platform_admin')
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
  'F-2: company-independent permissions only. For tenant decisions use gridex_get_user_permissions_in_company or gridex_has_permission_in_company.';

-- Company-scoped resolution. Deliberately a distinct name rather than an overload:
-- adding a defaulted second parameter would make every single-argument call
-- ambiguous and break the policies that use gridex_has_permission.
create or replace function public.gridex_get_user_permissions_in_company(
  p_user_id uuid,
  p_company_id uuid
)
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
        -- platform roles apply everywhere; company roles only in their own company,
        -- and only while the membership backing them is active
        (
          ur.company_id is null
          and public.gridex_normalize_platform_role(coalesce(r.key, r.name))
            in ('super_admin', 'platform_admin')
        )
        or (
          p_company_id is not null
          and ur.company_id = p_company_id
          and exists (
            select 1 from public.company_memberships m
            where m.user_id = p_user_id
              and m.company_id = ur.company_id
              and m.status = 'active'
              and coalesce(m.is_active, true)
          )
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

comment on function public.gridex_get_user_permissions_in_company(uuid, uuid) is
  'F-2: company-scoped permission resolution. A company-bound role grants only inside its own company.';

create or replace function public.gridex_has_permission_in_company(
  p_company_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
  select p_company_id is not null
    and p_permission is not null
    and (select auth.uid()) is not null
    and p_permission = any(
      public.gridex_get_user_permissions_in_company((select auth.uid()), p_company_id)
    );
$function$;

comment on function public.gridex_has_permission_in_company(uuid, text) is
  'F-2: use this in RLS policies. gridex_has_permission(uid, perm) carries no tenant binding.';

-- ---------------------------------------------------------------------------
-- F-7: enforce role scope in the schema, both directions.
-- ---------------------------------------------------------------------------

create or replace function public.gridex_assert_role_scope_is_consistent()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_is_platform boolean;
begin
  select public.gridex_normalize_platform_role(coalesce(r.key, r.name))
           in ('super_admin', 'platform_admin')
    into v_is_platform
  from public.roles r
  where r.id = new.role_id;

  if v_is_platform is null then
    return new;
  end if;

  if v_is_platform and new.company_id is not null then
    raise exception 'platform_role_must_be_global'
      using errcode = '23514',
            detail = 'A super_admin or platform_admin role cannot be scoped to a company.';
  end if;

  if not v_is_platform and new.company_id is null then
    raise exception 'company_role_requires_company'
      using errcode = '23514',
            detail = 'A non-platform role must be bound to a company; a global company role grants everywhere.';
  end if;

  return new;
end
$function$;

drop trigger if exists gridex_user_roles_platform_role_global on public.user_roles;
drop trigger if exists gridex_user_roles_scope_consistent on public.user_roles;
create trigger gridex_user_roles_scope_consistent
  before insert or update on public.user_roles
  for each row execute function public.gridex_assert_role_scope_is_consistent();

commit;
