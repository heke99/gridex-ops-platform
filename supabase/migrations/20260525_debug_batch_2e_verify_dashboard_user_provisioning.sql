-- Debug Batch 2E verification
-- Byt värdena nedan när du testar en ny dashboard-skapad användare.
-- Compatibility: make both company_invitations.email and invited_email available before verifying.
do $$
begin
  if to_regclass('public.company_invitations') is not null then
    alter table public.company_invitations add column if not exists email text;
    alter table public.company_invitations add column if not exists invited_email text;

    update public.company_invitations
       set invited_email = email
     where invited_email is null
       and email is not null;

    update public.company_invitations
       set email = invited_email
     where email is null
       and invited_email is not null;
  end if;
end $$;

with params as (
  select
    'aa121d1e-990b-40ed-8399-4442539fec62'::uuid as company_id,
    lower('afshin.hemmati@nibela.se') as email
), auth_user as (
  select u.id, lower(u.email) as email
  from auth.users u
  join params p on lower(u.email) = p.email
), membership as (
  select
    cm.user_id,
    cm.company_id,
    cm.role,
    cm.role_key,
    cm.membership_role::text as membership_role,
    cm.status,
    cm.is_active,
    cm.accepted_at
  from public.company_memberships cm
  join params p on p.company_id = cm.company_id
  join auth_user au on au.id = cm.user_id
), user_role as (
  select
    ur.user_id,
    ur.company_id,
    ur.role,
    ur.status,
    ur.is_active
  from public.user_roles ur
  join params p on p.company_id = ur.company_id
  join auth_user au on au.id = ur.user_id
), invitation as (
  select
    ci.invited_user_id as user_id,
    ci.company_id,
    ci.invited_email,
    ci.status,
    ci.accepted_at
  from public.company_invitations ci
  join params p on p.company_id = ci.company_id
  where lower(coalesce(ci.invited_email, ci.email, '')) = p.email
  order by ci.created_at desc
  limit 1
)
select 'auth_user' as check_name, au.id::text as user_id, au.email, c.name as company_name, null::text as role, null::text as status, null::boolean as is_active
from auth_user au
cross join params p
left join public.companies c on c.id = p.company_id
union all
select 'membership', m.user_id::text, p.email, c.name, coalesce(m.role_key, m.role, m.membership_role), m.status, m.is_active
from membership m
join params p on true
left join public.companies c on c.id = m.company_id
union all
select 'user_role', ur.user_id::text, p.email, c.name, ur.role, ur.status, ur.is_active
from user_role ur
join params p on true
left join public.companies c on c.id = ur.company_id
union all
select 'invitation', i.user_id::text, p.email, c.name, null::text, i.status, (i.status = 'accepted')::boolean
from invitation i
join params p on true
left join public.companies c on c.id = i.company_id
order by check_name;