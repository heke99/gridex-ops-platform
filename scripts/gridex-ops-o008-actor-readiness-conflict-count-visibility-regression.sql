\set ON_ERROR_STOP on
\pset pager off

-- GRIDEX-OPS-O-008 regression. Run against an isolated/staging database after
-- 20260809131500_gridex_ops_o008_actor_readiness_conflict_count_visibility.sql.
-- Everything rolls back.

begin;

select set_config('gridex.test.ordinary_user_id', gen_random_uuid()::text, true);
select set_config('gridex.test.company_admin_user_id', gen_random_uuid()::text, true);
select set_config('gridex.test.fixture_token', gen_random_uuid()::text, true);
select set_config('gridex.test.company_a_id', id::text, true)
from public.companies order by id limit 1;
select set_config('gridex.test.platform_admin_user_id', u.id::text, true)
from auth.users u
where public.canonical_actor_is_platform_admin(u.id)
order by u.id limit 1;
select set_config('gridex.test.actor_id', id::text, true)
from public.platform_market_actors
order by id
limit 1;

do $$
begin
  if nullif(current_setting('gridex.test.company_a_id', true), '') is null then
    raise exception 'company_fixture_unavailable';
  end if;
  if nullif(current_setting('gridex.test.platform_admin_user_id', true), '') is null then
    raise exception 'platform_admin_fixture_unavailable';
  end if;
  if nullif(current_setting('gridex.test.actor_id', true), '') is null then
    raise exception 'platform_market_actor_fixture_unavailable';
  end if;
  if to_regprocedure('public.gridex_actor_open_blocking_conflict_counts()') is null then
    raise exception 'conflict_count_helper_missing';
  end if;
end;
$$;

insert into auth.users(
  id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
)
select fixture_id, 'authenticated', 'authenticated',
       'gridex-o008-' || fixture_id::text || '@example.invalid',
       now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false
from (
  values
    (current_setting('gridex.test.ordinary_user_id')::uuid),
    (current_setting('gridex.test.company_admin_user_id')::uuid)
) fixtures(fixture_id);

insert into public.user_profiles(id,email,full_name,user_status,created_at,updated_at,must_change_password)
select fixture_id,
       'gridex-o008-' || fixture_id::text || '@example.invalid',
       'GRIDEX-OPS-O-008 rollback fixture',
       'active', now(), now(), false
from (
  values
    (current_setting('gridex.test.ordinary_user_id')::uuid),
    (current_setting('gridex.test.company_admin_user_id')::uuid)
) fixtures(fixture_id)
on conflict (id) do update
set user_status='active', updated_at=now();

insert into public.company_memberships(
  company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key
) values
(
  current_setting('gridex.test.company_a_id')::uuid,
  current_setting('gridex.test.company_admin_user_id')::uuid,
  'company_admin','active',now(),'{}'::jsonb,'company_admin',true,now(),'company_admin'
);

select set_config('gridex.test.conflict_id', gen_random_uuid()::text, true);

insert into public.actor_registry_conflicts(
  id, company_id, actor_id, conflict_type, severity, status, title, message, metadata
) values (
  current_setting('gridex.test.conflict_id')::uuid,
  current_setting('gridex.test.company_a_id')::uuid,
  current_setting('gridex.test.actor_id')::uuid,
  'o008_regression',
  'blocking',
  'open',
  'O-008 fixture',
  'open blocking conflict for readiness undercount regression',
  jsonb_build_object('fixture', current_setting('gridex.test.fixture_token'))
);

-- Service-role / definer path must see the conflict count.
do $$
declare
  v_count integer;
begin
  select open_blocking_conflicts
    into v_count
  from public.gridex_actor_open_blocking_conflict_counts()
  where actor_id = current_setting('gridex.test.actor_id')::uuid;

  if coalesce(v_count, 0) < 1 then
    raise exception 'helper_under_count_for_service_context';
  end if;
end;
$$;

-- Company-admin JWT must see the same conflict count through the readiness view.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('gridex.test.company_admin_user_id'), true);
do $$
declare
  v_count integer;
begin
  select open_blocking_conflicts
    into v_count
  from public.actor_readiness_status
  where platform_market_actor_id = current_setting('gridex.test.actor_id')::uuid;

  if coalesce(v_count, 0) < 1 then
    raise exception 'company_admin_readiness_undercount';
  end if;
end;
$$;

-- Ordinary authenticated JWT must also see the count (no silent undercount).
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('gridex.test.ordinary_user_id'), true);
do $$
declare
  v_count integer;
begin
  select open_blocking_conflicts
    into v_count
  from public.actor_readiness_status
  where platform_market_actor_id = current_setting('gridex.test.actor_id')::uuid;

  if coalesce(v_count, 0) < 1 then
    raise exception 'ordinary_user_readiness_undercount';
  end if;
end;
$$;

-- Direct conflict row details remain blocked for non-admins.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('gridex.test.company_admin_user_id'), true);
do $$
declare
  v_visible integer;
begin
  select count(*)::integer
    into v_visible
  from public.actor_registry_conflicts
  where id = current_setting('gridex.test.conflict_id')::uuid;

  if coalesce(v_visible, 0) <> 0 then
    raise exception 'company_admin_should_not_see_conflict_rows';
  end if;
end;
$$;

-- Role dashboard views are service_role-only after the revoke.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('gridex.test.company_admin_user_id'), true);
do $$
begin
  begin
    perform 1 from public.actor_readiness_by_role_v limit 1;
    raise exception 'authenticated_should_not_select_actor_readiness_by_role_v';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

reset role;

rollback;
\echo 'GRIDEX-OPS-O-008 actor readiness conflict-count visibility regression passed.'
