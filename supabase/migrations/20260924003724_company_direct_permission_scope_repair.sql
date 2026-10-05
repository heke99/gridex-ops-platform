-- Created by Supabase CLI 2.101.0. Restrict only the company resolver's direct
-- grant branch; preserve role/platform branches, null-company legacy grants,
-- positive-grant union semantics, owner and existing effective function ACL.
-- Deny/inactive direct rows are not positive grants. No permission assignments.
BEGIN;
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
      and coalesce(up.status, 'active') = 'active'
      and coalesce(up.is_active, true)
      and coalesce(up.effect, 'allow') = 'allow'
      and (
        -- Preserve legacy global direct grants. Company-bound grants need the
        -- same selected-company membership as the unchanged role branch.
        up.company_id is null
        or (
          p_company_id is not null
          and up.company_id = p_company_id
          and exists (
            select 1 from public.company_memberships m
            where m.user_id = p_user_id
              and m.company_id = up.company_id
              and m.status = 'active'
              and coalesce(m.is_active, true)
          )
        )
      )
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
COMMIT;
