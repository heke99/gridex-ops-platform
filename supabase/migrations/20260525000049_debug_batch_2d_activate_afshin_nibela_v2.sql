-- Debug Batch 2D: activate Afshin Hemmati as company admin for Nibela AB.
-- Safe to rerun. This version uses explicit row counts and returns diagnostics.

begin;

do $$
declare
  v_company_id uuid := 'aa121d1e-990b-40ed-8399-4442539fec62';
  v_user_id uuid := 'bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c';
  v_email text := 'afshin.hemmati@nibela.se';
  v_actor_user_id uuid := 'f1fba10a-242d-455c-9ad7-18d7e2ffd2fc';
  v_role_id uuid;
  v_membership_role_type text;
  v_membership_role_value text := 'company_admin';
  v_membership_rows integer := 0;
  v_user_role_rows integer := 0;
  v_invitation_rows integer := 0;
  v_has_membership_role boolean := false;
  v_has_invitation_email boolean := false;
  v_has_invitation_invited_email boolean := false;
  v_has_invitation_membership_role boolean := false;
  v_has_invitation_role_key boolean := false;
  v_has_invitation_invited_user_id boolean := false;
  v_has_invitation_accepted_at boolean := false;
  v_has_invitation_updated_at boolean := false;
  v_has_invitation_metadata boolean := false;
begin
  if not exists (select 1 from auth.users where id = v_user_id and lower(email) = lower(v_email)) then
    raise exception 'Auth user % with email % does not exist in this Supabase project.', v_user_id, v_email;
  end if;

  insert into public.companies (id, name, status, created_at, updated_at)
  values (v_company_id, 'Nibela AB', 'onboarding', now(), now())
  on conflict (id) do update
     set name = coalesce(nullif(public.companies.name, ''), excluded.name),
         status = case
           when public.companies.status in ('active', 'onboarding') then public.companies.status
           else 'onboarding'
         end,
         updated_at = now();

  update public.roles
     set key = coalesce(nullif(key, ''), nullif(name, ''))
   where key is null or key = '';

  select id
    into v_role_id
    from public.roles
   where key = 'company_admin'
      or name = 'company_admin'
      or name = 'admin'
   order by case when key = 'company_admin' then 0 when name = 'company_admin' then 1 else 2 end
   limit 1;

  if v_role_id is null then
    insert into public.roles (name, key, description, scope, created_at)
    values ('company_admin', 'company_admin', 'Company admin access', 'company', now())
    returning id into v_role_id;
  else
    update public.roles
       set key = coalesce(nullif(key, ''), 'company_admin')
     where id = v_role_id;
  end if;

  insert into public.user_profiles (id, email, full_name, user_status, active_company_id, updated_at)
  values (v_user_id, v_email, 'Afshin Hemmati', 'active', v_company_id, now())
  on conflict (id) do update
     set email = excluded.email,
         full_name = coalesce(nullif(public.user_profiles.full_name, ''), excluded.full_name),
         user_status = 'active',
         active_company_id = excluded.active_company_id,
         updated_at = now();

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'company_memberships' and column_name = 'membership_role'
  ) into v_has_membership_role;

  if v_has_membership_role then
    select a.atttypid::regtype::text
      into v_membership_role_type
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'company_memberships'
       and a.attname = 'membership_role'
       and not a.attisdropped
     limit 1;

    if v_membership_role_type is not null and exists (
      select 1
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.oid = v_membership_role_type::regtype::oid
        and e.enumlabel = 'company_admin'
    ) then
      v_membership_role_value := 'company_admin';
    elsif v_membership_role_type is not null and exists (
      select 1
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.oid = v_membership_role_type::regtype::oid
        and e.enumlabel = 'admin'
    ) then
      v_membership_role_value := 'admin';
    elsif v_membership_role_type is not null and exists (
      select 1
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.oid = v_membership_role_type::regtype::oid
        and e.enumlabel = 'member'
    ) then
      v_membership_role_value := 'member';
    end if;

    execute format(
      'update public.company_memberships
          set user_id = $1,
              role = $2,
              role_id = $3,
              status = $4,
              is_active = true,
              invited_email = $5,
              invited_by = $6,
              invited_at = coalesce(invited_at, now()),
              joined_at = coalesce(joined_at, now()),
              accepted_at = coalesce(accepted_at, now()),
              disabled_at = null,
              disabled_by = null,
              removed_at = null,
              removed_by = null,
              status_reason = null,
              membership_role = $7::%s,
              role_key = $8,
              updated_at = now(),
              metadata = coalesce(metadata, ''{}''::jsonb) || jsonb_build_object(''debug_batch_2d_activation'', true)
        where company_id = $9
          and (user_id = $1 or lower(coalesce(invited_email, '''')) = lower($5))',
      v_membership_role_type
    ) using v_user_id, 'company_admin', v_role_id, 'active', v_email, v_actor_user_id, v_membership_role_value, 'company_admin', v_company_id;

    get diagnostics v_membership_rows = row_count;

    if v_membership_rows = 0 then
      execute format(
        'insert into public.company_memberships (
           company_id, user_id, role, role_id, status, is_active, invited_email, invited_by,
           invited_at, joined_at, accepted_at, membership_role, role_key, created_at, updated_at, metadata
         ) values ($1,$2,$3,$4,$5,true,$6,$7,now(),now(),now(),$8::%s,$9,now(),now(),$10)',
        v_membership_role_type
      ) using v_company_id, v_user_id, 'company_admin', v_role_id, 'active', v_email, v_actor_user_id, v_membership_role_value, 'company_admin', jsonb_build_object('debug_batch_2d_activation', true);

      get diagnostics v_membership_rows = row_count;
    end if;
  else
    update public.company_memberships
       set user_id = v_user_id,
           role = 'company_admin',
           role_id = v_role_id,
           status = 'active',
           is_active = true,
           invited_email = v_email,
           invited_by = v_actor_user_id,
           invited_at = coalesce(invited_at, now()),
           joined_at = coalesce(joined_at, now()),
           accepted_at = coalesce(accepted_at, now()),
           disabled_at = null,
           disabled_by = null,
           removed_at = null,
           removed_by = null,
           status_reason = null,
           role_key = 'company_admin',
           updated_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('debug_batch_2d_activation', true)
     where company_id = v_company_id
       and (user_id = v_user_id or lower(coalesce(invited_email, '')) = lower(v_email));

    get diagnostics v_membership_rows = row_count;

    if v_membership_rows = 0 then
      insert into public.company_memberships (
        company_id, user_id, role, role_id, status, is_active, invited_email, invited_by,
        invited_at, joined_at, accepted_at, role_key, created_at, updated_at, metadata
      ) values (
        v_company_id, v_user_id, 'company_admin', v_role_id, 'active', true, v_email, v_actor_user_id,
        now(), now(), now(), 'company_admin', now(), now(), jsonb_build_object('debug_batch_2d_activation', true)
      );
      get diagnostics v_membership_rows = row_count;
    end if;
  end if;

  update public.user_roles
     set role_id = v_role_id,
         role = 'company_admin',
         company_id = v_company_id,
         status = 'active',
         is_active = true
   where user_id = v_user_id
     and (company_id = v_company_id or company_id is null)
     and (role_id = v_role_id or role = 'company_admin' or role is null);

  get diagnostics v_user_role_rows = row_count;

  if v_user_role_rows = 0 then
    insert into public.user_roles (user_id, role, role_id, company_id, status, is_active, created_at)
    values (v_user_id, 'company_admin', v_role_id, v_company_id, 'active', true, now());
    get diagnostics v_user_role_rows = row_count;
  end if;

  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_invitations' and column_name = 'email') into v_has_invitation_email;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_invitations' and column_name = 'invited_email') into v_has_invitation_invited_email;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_invitations' and column_name = 'membership_role') into v_has_invitation_membership_role;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_invitations' and column_name = 'role_key') into v_has_invitation_role_key;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_invitations' and column_name = 'invited_user_id') into v_has_invitation_invited_user_id;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_invitations' and column_name = 'accepted_at') into v_has_invitation_accepted_at;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_invitations' and column_name = 'updated_at') into v_has_invitation_updated_at;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_invitations' and column_name = 'metadata') into v_has_invitation_metadata;

  if to_regclass('public.company_invitations') is not null and (v_has_invitation_email or v_has_invitation_invited_email) then
    execute 'update public.company_invitations set status = $1'
      || case when v_has_invitation_invited_user_id then ', invited_user_id = $2' else '' end
      || case when v_has_invitation_role_key then ', role_key = $3' else '' end
      || case when v_has_invitation_membership_role then format(', membership_role = $4::%s', v_membership_role_type) else '' end
      || case when v_has_invitation_accepted_at then ', accepted_at = coalesce(accepted_at, now())' else '' end
      || ', expires_at = null'
      || case when v_has_invitation_updated_at then ', updated_at = now()' else '' end
      || case when v_has_invitation_metadata then ', metadata = coalesce(metadata, ''{}''::jsonb) || jsonb_build_object(''debug_batch_2d_activation'', true)' else '' end
      || ' where company_id = $5 and ('
      || case when v_has_invitation_email then 'lower(email) = lower($6)' else 'false' end
      || case when v_has_invitation_email and v_has_invitation_invited_email then ' or ' else '' end
      || case when v_has_invitation_invited_email then 'lower(invited_email) = lower($6)' else '' end
      || ')'
      using 'accepted', v_user_id, 'company_admin', v_membership_role_value, v_company_id, v_email;
    get diagnostics v_invitation_rows = row_count;
  end if;

  raise notice 'Batch 2D activation complete. membership rows touched: %, user_role rows touched: %, invitation rows touched: %', v_membership_rows, v_user_role_rows, v_invitation_rows;
end $$;

commit;

select
  'auth_user' as check_name,
  u.id::text as id,
  u.email,
  null::text as company_name,
  null::text as role,
  null::text as role_key,
  null::text as status,
  null::boolean as is_active
from auth.users u
where u.id = 'bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c'

union all

select
  'membership' as check_name,
  cm.user_id::text as id,
  cm.invited_email as email,
  c.name as company_name,
  cm.role,
  cm.role_key,
  cm.status,
  cm.is_active
from public.company_memberships cm
join public.companies c on c.id = cm.company_id
where cm.company_id = 'aa121d1e-990b-40ed-8399-4442539fec62'
  and cm.user_id = 'bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c'

union all

select
  'user_role' as check_name,
  ur.user_id::text as id,
  'afshin.hemmati@nibela.se' as email,
  c.name as company_name,
  ur.role,
  coalesce(r.key, r.name) as role_key,
  ur.status,
  ur.is_active
from public.user_roles ur
left join public.roles r on r.id = ur.role_id
left join public.companies c on c.id = ur.company_id
where ur.user_id = 'bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c'
  and ur.company_id = 'aa121d1e-990b-40ed-8399-4442539fec62'
order by check_name;
