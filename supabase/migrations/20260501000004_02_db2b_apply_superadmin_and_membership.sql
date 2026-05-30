-- DB2B SAFE — Apply explicit superadmin + Div3rsa AB company admin membership
-- Source of truth:
--   Owner instruction:
--   user_id = f1fba10a-242d-455c-9ad7-18d7e2ffd2fc
--   email   = hekmat.h@div3rsa.com
--   platform role = superadmin
--   company role  = company_admin for Div3rsa AB
--
-- Safety:
--   - Idempotent
--   - No customer creation
--   - No tenant auto-discovery
--   - No destructive statements

do $$
declare
  v_company_id uuid;
  v_user_id uuid := 'f1fba10a-242d-455c-9ad7-18d7e2ffd2fc'::uuid;
  v_email text := 'hekmat.h@div3rsa.com';
  v_run_id uuid;
  v_admin_existed boolean;
  v_membership_existed boolean;
  v_membership_id uuid;
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
    raise exception 'DB2B blocked: Div3rsa AB was not found in public.companies. No changes applied.';
  end if;

  insert into public.backfill_runs (
    run_key,
    source_scope,
    status,
    started_at,
    completed_at,
    rows_seen,
    rows_inserted,
    rows_updated,
    rows_skipped,
    rows_failed,
    summary
  )
  values (
    'db2b_superadmin_div3rsa_membership_' || to_char(now(), 'YYYYMMDDHH24MISSMS'),
    'tenant_rbac',
    'completed',
    now(),
    now(),
    2,
    0,
    0,
    0,
    0,
    jsonb_build_object(
      'phase', 'db2b',
      'safe', true,
      'delete_operations', false,
      'aggressive_merge', false,
      'source', 'owner_explicit_instruction',
      'target_user_id', v_user_id,
      'target_email', v_email,
      'target_company_id', v_company_id,
      'target_company_slug', 'div3rsa-ab'
    )
  )
  returning id into v_run_id;

  select exists (
    select 1 from public.admin_users where user_id = v_user_id
  ) into v_admin_existed;

  insert into public.admin_users (
    user_id,
    role,
    is_active,
    created_at
  )
  select
    v_user_id,
    'superadmin',
    true,
    now()
  where not exists (
    select 1 from public.admin_users where user_id = v_user_id
  );

  update public.admin_users
     set role = 'superadmin',
         is_active = true
   where user_id = v_user_id
     and (
       role is distinct from 'superadmin'
       or coalesce(is_active, false) is distinct from true
     );

  insert into public.backfill_run_items (
    backfill_run_id,
    source_table,
    source_id,
    target_table,
    target_id,
    status,
    message,
    details
  )
  values (
    v_run_id,
    'owner_instruction',
    v_user_id::text,
    'admin_users',
    v_user_id,
    case when v_admin_existed then 'updated_or_confirmed' else 'inserted' end,
    'Ensured explicit platform superadmin in public.admin_users.',
    jsonb_build_object(
      'email', v_email,
      'role', 'superadmin',
      'is_active', true,
      'source', 'owner_explicit_instruction'
    )
  );

  select exists (
    select 1
    from public.company_memberships
    where company_id = v_company_id
      and user_id = v_user_id
  ) into v_membership_existed;

  insert into public.company_memberships (
    company_id,
    user_id,
    role,
    status,
    is_active,
    invited_email,
    joined_at,
    created_at,
    updated_at
  )
  select
    v_company_id,
    v_user_id,
    'company_admin',
    'active',
    true,
    v_email,
    now(),
    now(),
    now()
  where not exists (
    select 1
    from public.company_memberships
    where company_id = v_company_id
      and user_id = v_user_id
  )
  returning id into v_membership_id;

  if v_membership_id is null then
    select id into v_membership_id
    from public.company_memberships
    where company_id = v_company_id
      and user_id = v_user_id
    order by created_at nulls last, id::text
    limit 1;
  end if;

  update public.company_memberships
     set role = 'company_admin',
         status = 'active',
         is_active = true,
         invited_email = coalesce(invited_email, v_email),
         joined_at = coalesce(joined_at, now()),
         updated_at = now()
   where company_id = v_company_id
     and user_id = v_user_id
     and (
       role is distinct from 'company_admin'
       or status is distinct from 'active'
       or coalesce(is_active, false) is distinct from true
       or invited_email is null
       or joined_at is null
     );

  insert into public.backfill_run_items (
    backfill_run_id,
    source_table,
    source_id,
    target_table,
    target_id,
    status,
    message,
    details
  )
  values (
    v_run_id,
    'owner_instruction',
    v_user_id::text,
    'company_memberships',
    v_membership_id,
    case when v_membership_existed then 'updated_or_confirmed' else 'inserted' end,
    'Ensured explicit Div3rsa AB company_admin membership.',
    jsonb_build_object(
      'email', v_email,
      'company_id', v_company_id,
      'company_slug', 'div3rsa-ab',
      'role', 'company_admin',
      'status', 'active',
      'is_active', true,
      'source', 'owner_explicit_instruction'
    )
  );

  insert into public.audit_logs (
    company_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values,
    metadata,
    created_at,
    updated_at
  )
  values (
    v_company_id,
    v_user_id,
    'company_membership',
    coalesce(v_membership_id::text, v_user_id::text),
    'db2b_superadmin_company_admin_ensured',
    '{}'::jsonb,
    jsonb_build_object(
      'user_id', v_user_id,
      'email', v_email,
      'company_id', v_company_id,
      'platform_role', 'superadmin',
      'company_role', 'company_admin'
    ),
    jsonb_build_object(
      'phase', 'db2b',
      'safe', true,
      'source', 'owner_explicit_instruction',
      'delete_operations', false,
      'aggressive_merge', false
    ),
    now(),
    now()
  );

  update public.backfill_runs
     set rows_inserted = (
           case when v_admin_existed then 0 else 1 end
           + case when v_membership_existed then 0 else 1 end
         ),
         rows_updated = (
           case when v_admin_existed then 1 else 0 end
           + case when v_membership_existed then 1 else 0 end
         ),
         summary = summary || jsonb_build_object(
           'admin_existed_before', v_admin_existed,
           'membership_existed_before', v_membership_existed,
           'membership_id', v_membership_id
         )
   where id = v_run_id;
end $$;
