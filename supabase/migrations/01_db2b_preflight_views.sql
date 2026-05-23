-- DB2B SAFE — Full-view preflight for explicit platform superadmin + Div3rsa AB company admin
-- Purpose:
--   1) Verify that Div3rsa AB exists as a canonical tenant/company.
--   2) Verify the explicit user_id/email provided by the owner.
--   3) Prepare validation views only.
--
-- Safety:
--   - No row-removal statements
--   - No table-emptying statements
--   - No table-removal statements
--   - No constraint-removal statements
--   - Does not create Test bolaget
--   - Does not create customers from customer_profiles

do $$
declare
  v_company_id uuid;
begin
  select c.id
    into v_company_id
  from public.companies c
  where c.company_slug = 'div3rsa-ab'
     or c.slug = 'div3rsa-ab'
     or c.name = 'Div3rsa AB'
  order by c.created_at nulls last, c.id::text
  limit 1;

  if v_company_id is null then
    raise exception 'DB2B blocked: Div3rsa AB was not found in public.companies. Do not continue.';
  end if;
end $$;

create or replace view public.gridex_db2b_superadmin_target_v as
with target as (
  select
    'f1fba10a-242d-455c-9ad7-18d7e2ffd2fc'::uuid as user_id,
    'hekmat.h@div3rsa.com'::text as email,
    'Div3rsa AB'::text as company_name,
    'div3rsa-ab'::text as company_slug
),
resolved_company as (
  select
    c.id as company_id,
    c.name,
    c.company_slug,
    c.slug,
    c.status,
    c.is_active,
    c.is_paused,
    c.created_at
  from public.companies c
  join target t on (
    c.company_slug = t.company_slug
    or c.slug = t.company_slug
    or c.name = t.company_name
  )
  order by c.created_at nulls last, c.id::text
  limit 1
)
select
  t.user_id,
  t.email,
  rc.company_id,
  rc.name as company_name,
  rc.company_slug,
  rc.slug,
  rc.status as company_status,
  rc.is_active as company_is_active,
  rc.is_paused as company_is_paused,
  au.user_id is not null as exists_in_admin_users,
  au.role as current_admin_role,
  coalesce(au.is_active, false) as current_admin_is_active,
  cm.id is not null as exists_in_company_memberships,
  cm.id as current_membership_id,
  cm.role as current_membership_role,
  cm.status as current_membership_status,
  coalesce(cm.is_active, false) as current_membership_is_active
from target t
left join resolved_company rc on true
left join public.admin_users au on au.user_id = t.user_id
left join public.company_memberships cm
  on cm.user_id = t.user_id
 and cm.company_id = rc.company_id;

create or replace view public.gridex_db2b_preflight_v as
select
  'target_company_found'::text as check_key,
  case when company_id is not null then 0 else 1 end as issue_count,
  'Div3rsa AB must exist before DB2B creates membership.'::text as description
from public.gridex_db2b_superadmin_target_v

union all

select
  'target_company_active',
  case when company_id is not null and coalesce(company_is_active, true) = true and coalesce(company_is_paused, false) = false then 0 else 1 end,
  'Div3rsa AB must be active and not paused for normal tenant admin access.'
from public.gridex_db2b_superadmin_target_v

union all

select
  'target_user_known_as_admin_or_ready',
  0,
  'DB2B can create or update public.admin_users for the explicit user_id; this is owner-provided data.'
from public.gridex_db2b_superadmin_target_v;
