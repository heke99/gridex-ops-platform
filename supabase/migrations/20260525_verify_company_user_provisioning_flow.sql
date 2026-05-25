-- Verifierar att dashboardflödet för bolag/användare registrerade allt korrekt.
-- Byt värdena i params efter testet.
with params as (
  select
    'aa121d1e-990b-40ed-8399-4442539fec62'::uuid as company_id,
    lower('byt.till.testanvandare@nibela.se')::text as email
), auth_match as (
  select au.id, au.email, au.created_at, au.email_confirmed_at, au.last_sign_in_at
  from auth.users au
  join params p on lower(au.email) = p.email
), membership_match as (
  select
    cm.id,
    cm.company_id,
    cm.user_id,
    cm.invited_email,
    cm.membership_role::text as membership_role,
    cm.role,
    cm.role_key,
    cm.status,
    cm.is_active,
    cm.invited_at,
    cm.accepted_at,
    cm.created_at,
    cm.updated_at
  from public.company_memberships cm
  join params p on p.company_id = cm.company_id
  join auth_match au on au.id = cm.user_id
), role_match as (
  select
    ur.id,
    ur.company_id,
    ur.user_id,
    ur.role,
    r.key as role_key_from_roles,
    ur.status,
    ur.is_active,
    ur.created_at
  from public.user_roles ur
  left join public.roles r on r.id = ur.role_id
  join params p on p.company_id = ur.company_id
  join auth_match au on au.id = ur.user_id
  where coalesce(ur.status, 'active') = 'active'
    and coalesce(ur.is_active, true) = true
), invitation_match as (
  select
    ci.id,
    ci.company_id,
    ci.email,
    ci.invited_email,
    ci.invited_user_id,
    ci.membership_role::text as membership_role,
    ci.role_key,
    ci.status,
    ci.accepted_at,
    ci.created_at,
    ci.updated_at
  from public.company_invitations ci
  join params p on p.company_id = ci.company_id
  join auth_match au on au.id = ci.invited_user_id
  where lower(coalesce(ci.email, ci.invited_email, '')) = p.email
     or lower(coalesce(ci.invited_email, ci.email, '')) = p.email
)
select 'auth_user' as check_name, id::text, email, null::text as company_id, null::text as role, null::text as role_key, null::text as status, null::boolean as is_active
from auth_match
union all
select 'membership', id::text, invited_email, company_id::text, membership_role, role_key, status, is_active
from membership_match
union all
select 'user_role', id::text, null::text, company_id::text, role, role_key_from_roles, status, is_active
from role_match
union all
select 'invitation', id::text, coalesce(email, invited_email), company_id::text, membership_role, role_key, status, null::boolean
from invitation_match
order by check_name;
