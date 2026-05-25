-- Debug Batch 2I: RBAC user_roles duplicate cleanup + active-role uniqueness guards.
-- Safe to run more than once.
-- Hotfix: live user_roles does not have updated_at, so ordering uses created_at/id only.

begin;

-- 1) Remove exact duplicate active role rows by role text per user/company.
with ranked as (
  select
    id,
    row_number() over (
      partition by
        user_id,
        coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
        lower(coalesce(role, ''))
      order by
        created_at desc nulls last,
        id desc
    ) as rn
  from public.user_roles
  where role is not null
    and coalesce(status, 'active') = 'active'
    and coalesce(is_active, true) = true
)
delete from public.user_roles ur
using ranked r
where ur.id = r.id
  and r.rn > 1;

-- 2) Remove duplicate active role rows by role_id per user/company.
with ranked as (
  select
    id,
    row_number() over (
      partition by
        user_id,
        coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
        role_id
      order by
        created_at desc nulls last,
        id desc
    ) as rn
  from public.user_roles
  where role_id is not null
    and coalesce(status, 'active') = 'active'
    and coalesce(is_active, true) = true
)
delete from public.user_roles ur
using ranked r
where ur.id = r.id
  and r.rn > 1;

-- 3) Prevent duplicate active role rows by role text.
create unique index if not exists user_roles_active_unique_role_text_idx
on public.user_roles (
  user_id,
  coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
  lower(role)
)
where role is not null
  and coalesce(status, 'active') = 'active'
  and coalesce(is_active, true) = true;

-- 4) Prevent duplicate active role rows by role_id.
create unique index if not exists user_roles_active_unique_role_id_idx
on public.user_roles (
  user_id,
  coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
  role_id
)
where role_id is not null
  and coalesce(status, 'active') = 'active'
  and coalesce(is_active, true) = true;

commit;

-- Verification: Afshin should appear once as active company_admin for Nibela.
select
  'afshin_user_role_after_dedupe' as check_name,
  ur.user_id,
  au.email,
  c.name as company_name,
  ur.role,
  r.key as role_key,
  ur.status,
  ur.is_active,
  count(*) over (partition by ur.user_id, ur.company_id, lower(coalesce(ur.role, ''))) as active_role_text_count
from public.user_roles ur
left join auth.users au on au.id = ur.user_id
left join public.companies c on c.id = ur.company_id
left join public.roles r on r.id = ur.role_id
where ur.user_id = 'bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c'
  and ur.company_id = 'aa121d1e-990b-40ed-8399-4442539fec62'
  and coalesce(ur.status, 'active') = 'active'
  and coalesce(ur.is_active, true) = true
order by ur.created_at desc nulls last;
