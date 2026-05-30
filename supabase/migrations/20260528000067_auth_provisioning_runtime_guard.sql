-- Runtime guard/diagnostics for user/company provisioning.
-- This migration does not delete users, does not reset passwords and does not overwrite roles.

create extension if not exists pgcrypto;

create table if not exists public.auth_provisioning_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_type text not null,
  status text not null default 'info',
  email text null,
  user_id uuid null,
  company_id uuid null,
  actor_user_id uuid null,
  supabase_project_ref text null,
  message text null,
  details jsonb not null default '{}'::jsonb
);

create index if not exists auth_provisioning_events_company_created_idx
  on public.auth_provisioning_events(company_id, created_at desc);

create index if not exists auth_provisioning_events_email_created_idx
  on public.auth_provisioning_events(lower(email), created_at desc)
  where email is not null;

create or replace view public.gridex_user_auth_integrity_v as
select
  coalesce(cm.company_id, ur.company_id) as company_id,
  coalesce(cm.user_id, ur.user_id, up.id) as user_id,
  lower(coalesce(au.email, up.email, cm.invited_email)) as email,
  case when au.id is null then false else true end as has_auth_user,
  case when up.id is null then false else true end as has_user_profile,
  case when cm.id is null then false else true end as has_company_membership,
  case when ur.id is null then false else true end as has_user_role,
  cm.status as membership_status,
  ur.status as user_role_status,
  ur.is_active as user_role_is_active,
  coalesce(cm.updated_at, ur.updated_at, up.updated_at, au.updated_at, au.created_at) as latest_seen_at
from public.company_memberships cm
full join public.user_roles ur
  on ur.company_id = cm.company_id and ur.user_id = cm.user_id
full join public.user_profiles up
  on up.id = coalesce(cm.user_id, ur.user_id)
left join auth.users au
  on au.id = coalesce(cm.user_id, ur.user_id, up.id)
where coalesce(cm.user_id, ur.user_id, up.id) is not null;

comment on view public.gridex_user_auth_integrity_v is 'Shows app users/tenant access rows that do or do not have a real Supabase Auth user. Missing auth users cannot log in.';

notify pgrst, 'reload schema';
