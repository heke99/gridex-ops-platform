-- Debug Batch 2F: normalize Afshin/Nibela after the wrong provisional user id was used earlier.
-- Safe to run multiple times. It does not create auth.users; Afshin must already exist in Supabase Auth.

begin;

do $$
declare
  v_company_id uuid := 'aa121d1e-990b-40ed-8399-4442539fec62'::uuid;
  v_correct_user_id uuid := 'bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c'::uuid;
  v_old_user_id uuid := '08bbafb2-dac7-44e1-ac0b-a72223a4975c'::uuid;
  v_email text := 'afshin.hemmati@nibela.se';
  v_role_id uuid;
  v_membership_role_type text;
  v_membership_role_value text := 'company_admin';
  v_membership_role_expression text;
begin
  if not exists (select 1 from auth.users where id = v_correct_user_id and lower(email) = lower(v_email)) then
    raise exception 'Afshin auth.user saknas eller matchar inte e-post. user_id=%, email=%', v_correct_user_id, v_email;
  end if;


  -- Compatibility repair: older schema uses company_invitations.email, some setup files also expect invited_email.
  -- Keep both columns available so manual/debug SQL and dashboard provisioning can update the same invitation row safely.
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

  insert into public.companies (id, name, status, created_at, updated_at)
  values (v_company_id, 'Nibela AB', 'onboarding', now(), now())
  on conflict (id) do update
    set name = excluded.name,
        status = case when public.companies.status in ('active', 'onboarding') then public.companies.status else 'onboarding' end,
        updated_at = now();

  select r.id into v_role_id
  from public.roles r
  where coalesce(nullif(r.key, ''), r.name) = 'company_admin'
     or r.name = 'company_admin'
     or r.name = 'admin'
  order by case when coalesce(nullif(r.key, ''), r.name) = 'company_admin' then 0 else 1 end
  limit 1;

  if v_role_id is null then
    insert into public.roles (name, description, key, scope, created_at)
    values ('company_admin', 'Company administrator', 'company_admin', 'company', now())
    returning id into v_role_id;
  end if;

  select format_type(a.atttypid, a.atttypmod)
  into v_membership_role_type
  from pg_attribute a
  where a.attrelid = 'public.company_memberships'::regclass
    and a.attname = 'membership_role'
    and not a.attisdropped;

  if v_membership_role_type like 'public.%' or v_membership_role_type = 'company_membership_role' then
    if not exists (
      select 1
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
      where (n.nspname || '.' || t.typname = v_membership_role_type or t.typname = v_membership_role_type)
        and e.enumlabel = v_membership_role_value
    ) then
      select e.enumlabel into v_membership_role_value
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
      where (n.nspname || '.' || t.typname = v_membership_role_type or t.typname = v_membership_role_type)
        and e.enumlabel in ('member', 'admin', 'owner', 'company_admin')
      order by case e.enumlabel when 'company_admin' then 0 when 'admin' then 1 when 'owner' then 2 else 3 end
      limit 1;
    end if;
    v_membership_role_expression := quote_literal(v_membership_role_value) || '::' || v_membership_role_type;
  else
    v_membership_role_expression := quote_literal(v_membership_role_value);
  end if;

  -- Move any stale rows that used the provisional/wrong user id onto the real Auth user id.
  if to_regclass('public.company_memberships') is not null then
    update public.company_memberships
       set user_id = v_correct_user_id,
           updated_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
             'normalized_from_old_afshin_user_id', v_old_user_id::text,
             'debug_batch_2f', true
           )
     where company_id = v_company_id
       and user_id = v_old_user_id;
  end if;

  if to_regclass('public.company_invitations') is not null then
    update public.company_invitations
       set invited_user_id = v_correct_user_id,
           updated_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
             'normalized_from_old_afshin_user_id', v_old_user_id::text,
             'debug_batch_2f', true
           )
     where company_id = v_company_id
       and invited_user_id = v_old_user_id;
  end if;

  -- Ensure exactly one active membership for Afshin/Nibela.
  execute format($fmt$
    insert into public.company_memberships (
      company_id,
      user_id,
      role,
      role_key,
      membership_role,
      status,
      is_active,
      invited_email,
      invited_at,
      accepted_at,
      joined_at,
      created_at,
      updated_at,
      metadata
    )
    values (
      %L::uuid,
      %L::uuid,
      'company_admin',
      'company_admin',
      %s,
      'active',
      true,
      %L,
      now(),
      now(),
      now(),
      now(),
      now(),
      jsonb_build_object('debug_batch_2f_normalized', true)
    )
    on conflict (company_id, user_id) do update
      set role = 'company_admin',
          role_key = 'company_admin',
          membership_role = excluded.membership_role,
          status = 'active',
          is_active = true,
          invited_email = excluded.invited_email,
          accepted_at = coalesce(public.company_memberships.accepted_at, now()),
          joined_at = coalesce(public.company_memberships.joined_at, now()),
          removed_at = null,
          removed_by = null,
          disabled_at = null,
          disabled_by = null,
          status_reason = null,
          updated_at = now(),
          metadata = coalesce(public.company_memberships.metadata, '{}'::jsonb) || jsonb_build_object('debug_batch_2f_normalized', true)
  $fmt$, v_company_id, v_correct_user_id, v_membership_role_expression, v_email);

  -- Ensure company-scoped system role for Afshin/Nibela.
  insert into public.user_roles (user_id, role_id, role, company_id, status, is_active, created_at)
  values (v_correct_user_id, v_role_id, 'company_admin', v_company_id, 'active', true, now())
  on conflict do nothing;

  update public.user_roles
     set role_id = coalesce(role_id, v_role_id),
         role = 'company_admin',
         status = 'active',
         is_active = true,
         company_id = v_company_id
   where user_id = v_correct_user_id
     and (company_id = v_company_id or company_id is null)
     and (role = 'company_admin' or role_id = v_role_id);

  -- Deactivate any stale role rows with the wrong user id if they somehow exist.
  update public.user_roles
     set status = 'inactive', is_active = false
   where user_id = v_old_user_id
     and company_id = v_company_id;

  -- Mark invitation accepted for the real user.
  if to_regclass('public.company_invitations') is not null then
    update public.company_invitations
       set status = 'accepted',
           invited_user_id = v_correct_user_id,
           accepted_at = coalesce(accepted_at, now()),
           expires_at = null,
           updated_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('debug_batch_2f_accepted', true)
     where company_id = v_company_id
       and (lower(coalesce(email, invited_email, '')) = lower(v_email)
         or lower(coalesce(invited_email, email, '')) = lower(v_email));
  end if;
end $$;

commit;

select
  'auth_user' as check_name,
  u.id,
  u.email,
  null::text as company_name,
  null::text as role,
  null::text as role_key,
  null::text as status,
  null::boolean as is_active
from auth.users u
where u.id = 'bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c'::uuid
union all
select
  'membership' as check_name,
  cm.user_id as id,
  coalesce(cm.invited_email, 'afshin.hemmati@nibela.se') as email,
  c.name as company_name,
  cm.role,
  cm.role_key,
  cm.status,
  cm.is_active
from public.company_memberships cm
join public.companies c on c.id = cm.company_id
where cm.company_id = 'aa121d1e-990b-40ed-8399-4442539fec62'::uuid
  and cm.user_id = 'bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c'::uuid
union all
select
  'user_role' as check_name,
  ur.user_id as id,
  'afshin.hemmati@nibela.se' as email,
  c.name as company_name,
  ur.role,
  coalesce(r.key, r.name) as role_key,
  ur.status,
  ur.is_active
from public.user_roles ur
left join public.roles r on r.id = ur.role_id
left join public.companies c on c.id = ur.company_id
where ur.user_id = 'bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c'::uuid
  and ur.company_id = 'aa121d1e-990b-40ed-8399-4442539fec62'::uuid
order by check_name;
