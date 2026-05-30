-- Debug Batch 2C: activate Afshin Hemmati as company admin for Nibela AB.
-- Safe to rerun. Requires the user to exist in auth.users first.

do $$
declare
  v_company_id uuid := 'aa121d1e-990b-40ed-8399-4442539fec62';
  v_user_id uuid := 'bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c';
  v_email text := 'afshin.hemmati@nibela.se';
  v_actor_user_id uuid := 'f1fba10a-242d-455c-9ad7-18d7e2ffd2fc';
  v_role_id uuid;
  v_membership_role_type text;
  v_membership_role_value text := 'company_admin';
  v_has_membership boolean := false;
  v_has_invitation_email boolean := false;
  v_has_invitation_invited_email boolean := false;
  v_updated_invitations integer := 0;
begin
  if not exists (select 1 from auth.users where id = v_user_id and lower(email) = lower(v_email)) then
    raise exception 'Auth user % with email % does not exist in this Supabase project.', v_user_id, v_email;
  end if;

  if not exists (select 1 from public.companies where id = v_company_id) then
    raise exception 'Nibela company % does not exist.', v_company_id;
  end if;

  update public.companies
     set status = case when status in ('archived', 'paused', 'suspended', 'pending_deletion') then 'onboarding' else coalesce(status, 'onboarding') end,
         updated_at = now(),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('debug_batch_2c_nibela_checked', true)
   where id = v_company_id;

  insert into public.user_profiles (id, email, full_name, user_status, active_company_id, updated_at)
  values (v_user_id, v_email, 'Afshin Hemmati', 'active', v_company_id, now())
  on conflict (id) do update
     set email = excluded.email,
         full_name = coalesce(public.user_profiles.full_name, excluded.full_name),
         user_status = 'active',
         active_company_id = excluded.active_company_id,
         updated_at = now();

  select id
    into v_role_id
    from public.roles
   where coalesce(key, name) = 'company_admin'
      or key = 'company_admin'
      or name = 'company_admin'
   order by case when key = 'company_admin' then 0 else 1 end
   limit 1;

  if v_role_id is null then
    insert into public.roles (name, key, description, scope)
    values ('company_admin', 'company_admin', 'Company admin access', 'company')
    returning id into v_role_id;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'company_memberships' and column_name = 'membership_role'
  ) into v_has_membership;

  if v_has_membership then
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

    if exists (
      select 1
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.oid = v_membership_role_type::regtype::oid
        and e.enumlabel = 'company_admin'
    ) then
      v_membership_role_value := 'company_admin';
    elsif exists (
      select 1
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.oid = v_membership_role_type::regtype::oid
        and e.enumlabel = 'admin'
    ) then
      v_membership_role_value := 'admin';
    elsif exists (
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
              metadata = coalesce(metadata, ''{}''::jsonb) || jsonb_build_object(''debug_batch_2c_activation'', true)
        where company_id = $9
          and (user_id = $1 or lower(coalesce(invited_email, '''')) = lower($5))',
      v_membership_role_type
    ) using v_user_id, 'company_admin', v_role_id, 'active', v_email, v_actor_user_id, v_membership_role_value, 'company_admin', v_company_id;

    if not found then
      execute format(
        'insert into public.company_memberships (
           company_id, user_id, role, role_id, status, is_active, invited_email, invited_by,
           invited_at, joined_at, accepted_at, membership_role, role_key, created_at, updated_at, metadata
         ) values ($1,$2,$3,$4,$5,true,$6,$7,now(),now(),now(),$8::%s,$9,now(),now(),$10)',
        v_membership_role_type
      ) using v_company_id, v_user_id, 'company_admin', v_role_id, 'active', v_email, v_actor_user_id, v_membership_role_value, 'company_admin', jsonb_build_object('debug_batch_2c_activation', true);
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
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('debug_batch_2c_activation', true)
     where company_id = v_company_id
       and (user_id = v_user_id or lower(coalesce(invited_email, '')) = lower(v_email));

    if not found then
      insert into public.company_memberships (
        company_id, user_id, role, role_id, status, is_active, invited_email, invited_by,
        invited_at, joined_at, accepted_at, role_key, created_at, updated_at, metadata
      ) values (
        v_company_id, v_user_id, 'company_admin', v_role_id, 'active', true, v_email, v_actor_user_id,
        now(), now(), now(), 'company_admin', now(), now(), jsonb_build_object('debug_batch_2c_activation', true)
      );
    end if;
  end if;

  update public.user_roles
     set role_id = v_role_id,
         role = 'company_admin',
         company_id = v_company_id,
         status = 'active',
         is_active = true
   where user_id = v_user_id
     and (role_id = v_role_id or role = 'company_admin')
     and (company_id = v_company_id or company_id is null);

  if not found then
    insert into public.user_roles (user_id, role, role_id, company_id, status, is_active, created_at)
    values (v_user_id, 'company_admin', v_role_id, v_company_id, 'active', true, now());
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'company_invitations' and column_name = 'email'
  ) into v_has_invitation_email;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'company_invitations' and column_name = 'invited_email'
  ) into v_has_invitation_invited_email;

  if to_regclass('public.company_invitations') is not null and v_has_invitation_email then
    update public.company_invitations
       set status = 'accepted',
           invited_user_id = v_user_id,
           role_key = 'company_admin',
           membership_role = v_membership_role_value,
           accepted_at = coalesce(accepted_at, now()),
           expires_at = null,
           revoked_at = null,
           updated_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('debug_batch_2c_activation', true)
     where company_id = v_company_id
       and lower(email) = lower(v_email);
    get diagnostics v_updated_invitations = row_count;
  end if;

  if to_regclass('public.company_invitations') is not null and v_updated_invitations = 0 and v_has_invitation_invited_email then
    update public.company_invitations
       set status = 'accepted',
           invited_user_id = v_user_id,
           role_key = 'company_admin',
           membership_role = v_membership_role_value,
           accepted_at = coalesce(accepted_at, now()),
           expires_at = null,
           revoked_at = null,
           updated_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('debug_batch_2c_activation', true)
     where company_id = v_company_id
       and lower(invited_email) = lower(v_email);
    get diagnostics v_updated_invitations = row_count;
  end if;

  if to_regclass('public.company_invitations') is not null and v_updated_invitations = 0 and v_has_invitation_email then
    insert into public.company_invitations (
      company_id, email, full_name, membership_role, role_key, status,
      invited_by, invited_user_id, expires_at, accepted_at, metadata
    ) values (
      v_company_id, v_email, 'Afshin Hemmati', v_membership_role_value, 'company_admin', 'accepted',
      v_actor_user_id, v_user_id, null, now(), jsonb_build_object('debug_batch_2c_activation', true)
    );
  end if;
end $$;

select
  c.id as company_id,
  c.name as company_name,
  cm.user_id,
  cm.invited_email,
  cm.role,
  cm.role_key,
  cm.status,
  cm.is_active,
  cm.accepted_at
from public.company_memberships cm
join public.companies c on c.id = cm.company_id
where cm.company_id = 'aa121d1e-990b-40ed-8399-4442539fec62'
  and cm.user_id = 'bc5784ed-96f1-4f6e-9fc3-a11b50a95a6c';
