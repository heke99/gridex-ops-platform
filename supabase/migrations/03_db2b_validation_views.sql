-- DB2B SAFE v2 — Validation views and final readiness
-- Run after SQL 2.
-- Patch note: simplified descriptions to avoid SQL parser issues in Supabase SQL editor.

create or replace view public.gridex_db2b_superadmin_membership_v as
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
  au.role as platform_admin_role,
  au.is_active as platform_admin_is_active,
  cm.id as membership_id,
  cm.role as company_membership_role,
  cm.status as company_membership_status,
  cm.is_active as company_membership_is_active,
  cm.invited_email,
  cm.joined_at,
  cm.created_at as membership_created_at,
  cm.updated_at as membership_updated_at
from target t
left join resolved_company rc on true
left join public.admin_users au on au.user_id = t.user_id
left join public.company_memberships cm
  on cm.user_id = t.user_id
 and cm.company_id = rc.company_id;

create or replace view public.gridex_db2b_final_readiness_v as
select
  checks.check_key,
  checks.issue_count,
  checks.description
from (
  select
    'target_company_exists'::text as check_key,
    case when company_id is not null then 0 else 1 end::integer as issue_count,
    'Div3rsa AB exists in companies'::text as description
  from public.gridex_db2b_superadmin_membership_v

  union all

  select
    'target_company_active'::text,
    case when company_id is not null
           and coalesce(company_is_active, true) = true
           and coalesce(company_is_paused, false) = false
         then 0 else 1 end::integer,
    'Div3rsa AB is active'::text
  from public.gridex_db2b_superadmin_membership_v

  union all

  select
    'platform_superadmin_exists'::text,
    case when platform_admin_role = 'superadmin'
           and coalesce(platform_admin_is_active, false) = true
         then 0 else 1 end::integer,
    'Explicit user is active superadmin'::text
  from public.gridex_db2b_superadmin_membership_v

  union all

  select
    'div3rsa_company_admin_membership_exists'::text,
    case when membership_id is not null then 0 else 1 end::integer,
    'Explicit user has Div3rsa membership'::text
  from public.gridex_db2b_superadmin_membership_v

  union all

  select
    'div3rsa_company_admin_membership_active'::text,
    case when membership_id is not null
           and company_membership_role = 'company_admin'
           and company_membership_status = 'active'
           and coalesce(company_membership_is_active, false) = true
         then 0 else 1 end::integer,
    'Explicit user is active Div3rsa company_admin'::text
  from public.gridex_db2b_superadmin_membership_v

  union all

  select
    'no_profile_customer_conversion'::text,
    case when exists (
      select 1
      from public.backfill_run_items bri
      where bri.source_table = 'customer_profiles'
        and bri.target_table = 'customers'
        and bri.status not in ('skipped_no_customer_signal', 'not_migrated_profile_only')
        and bri.created_at >= timestamp with time zone '2026-05-23 00:00:00+00'
    ) then 1 else 0 end::integer,
    'No login profiles were converted to customers'::text
) checks;

create or replace view public.gridex_db2b_rbac_snapshot_v as
select
  'admin_users'::text as source_table,
  au.user_id,
  null::uuid as company_id,
  null::text as company_name,
  au.role,
  au.is_active,
  au.created_at,
  jsonb_build_object(
    'scope', 'platform',
    'meaning', case when au.role = 'superadmin' then 'platform_superadmin' else 'platform_admin_or_legacy_admin' end
  ) as details
from public.admin_users au

union all

select
  'company_memberships'::text as source_table,
  cm.user_id,
  cm.company_id,
  c.name as company_name,
  cm.role,
  cm.is_active,
  cm.created_at,
  jsonb_build_object(
    'scope', 'tenant',
    'status', cm.status,
    'invited_email', cm.invited_email,
    'joined_at', cm.joined_at
  ) as details
from public.company_memberships cm
left join public.companies c on c.id = cm.company_id;

select * from public.gridex_db2b_final_readiness_v order by check_key;
select * from public.gridex_db2b_superadmin_membership_v;
select * from public.gridex_db2b_rbac_snapshot_v order by source_table, company_name nulls first, user_id;
