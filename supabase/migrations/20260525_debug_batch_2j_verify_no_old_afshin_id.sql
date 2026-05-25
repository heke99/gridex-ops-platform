-- Debug Batch 2J: verify Afshin/Nibela uses the canonical Auth user id.
-- Expected canonical auth user id: bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c
-- Old incorrect id: 08bbafb2-dac7-44e1-ac0b-a72223a4975c

select
  'auth.users by email/ids' as check_name,
  u.id::text as id,
  u.email,
  null::text as company_id,
  null::text as status,
  null::boolean as is_active
from auth.users u
where lower(u.email) = lower('afshin.hemmati@nibela.se')
   or u.id in (
    'bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c'::uuid,
    '08bbafb2-dac7-44e1-ac0b-a72223a4975c'::uuid
  )

union all

select
  'company_memberships' as check_name,
  cm.user_id::text as id,
  cm.invited_email as email,
  cm.company_id::text as company_id,
  cm.status,
  cm.is_active
from public.company_memberships cm
where cm.company_id = 'aa121d1e-990b-40ed-8399-4442539fec62'::uuid
  and (
    cm.user_id in (
      'bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c'::uuid,
      '08bbafb2-dac7-44e1-ac0b-a72223a4975c'::uuid
    )
    or lower(coalesce(cm.invited_email, '')) = lower('afshin.hemmati@nibela.se')
  )

union all

select
  'user_roles' as check_name,
  ur.user_id::text as id,
  null::text as email,
  ur.company_id::text as company_id,
  ur.status,
  ur.is_active
from public.user_roles ur
where ur.company_id = 'aa121d1e-990b-40ed-8399-4442539fec62'::uuid
  and ur.user_id in (
    'bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c'::uuid,
    '08bbafb2-dac7-44e1-ac0b-a72223a4975c'::uuid
  )

union all

select
  'company_invitations' as check_name,
  ci.invited_user_id::text as id,
  coalesce(ci.email, ci.invited_email) as email,
  ci.company_id::text as company_id,
  ci.status,
  null::boolean as is_active
from public.company_invitations ci
where ci.company_id = 'aa121d1e-990b-40ed-8399-4442539fec62'::uuid
  and (
    ci.invited_user_id in (
      'bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c'::uuid,
      '08bbafb2-dac7-44e1-ac0b-a72223a4975c'::uuid
    )
    or lower(coalesce(ci.email, ci.invited_email, '')) = lower('afshin.hemmati@nibela.se')
  )
order by check_name, id;
