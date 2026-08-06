\set ON_ERROR_STOP on
\pset pager off

-- GRIDEX-OPS-BL-002 regression. Run against an isolated/staging database after
-- 20260806122255_gridex_ops_bl_002_global_read_isolation.sql. Everything rolls back.
begin;

select set_config('gridex.test.ordinary_user_id', gen_random_uuid()::text, true);
select set_config('gridex.test.tenant_user_id', gen_random_uuid()::text, true);
select set_config('gridex.test.company_admin_user_id', gen_random_uuid()::text, true);
select set_config('gridex.test.fixture_token', gen_random_uuid()::text, true);
select set_config('gridex.test.company_a_id', id::text, true)
from public.companies order by id limit 1;
select set_config('gridex.test.company_b_id', id::text, true)
from public.companies
where id <> current_setting('gridex.test.company_a_id')::uuid
order by id limit 1;
select set_config('gridex.test.platform_admin_user_id', u.id::text, true)
from auth.users u
where public.canonical_actor_is_platform_admin(u.id)
order by u.id limit 1;

do $$
begin
  if nullif(current_setting('gridex.test.company_a_id', true), '') is null
     or nullif(current_setting('gridex.test.company_b_id', true), '') is null then
    raise exception 'two_company_fixtures_unavailable';
  end if;
  if nullif(current_setting('gridex.test.platform_admin_user_id', true), '') is null then
    raise exception 'platform_admin_fixture_unavailable';
  end if;
end;
$$;

insert into auth.users(
  id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
)
select fixture_id, 'authenticated', 'authenticated',
       'gridex-bl002-' || fixture_id::text || '@example.invalid',
       now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false
from (
  values
    (current_setting('gridex.test.ordinary_user_id')::uuid),
    (current_setting('gridex.test.tenant_user_id')::uuid),
    (current_setting('gridex.test.company_admin_user_id')::uuid)
) fixtures(fixture_id);

insert into public.user_profiles(id,email,full_name,user_status,created_at,updated_at,must_change_password)
select fixture_id,
       'gridex-bl002-' || fixture_id::text || '@example.invalid',
       'GRIDEX-OPS-BL-002 rollback fixture',
       'active', now(), now(), false
from (
  values
    (current_setting('gridex.test.ordinary_user_id')::uuid),
    (current_setting('gridex.test.tenant_user_id')::uuid),
    (current_setting('gridex.test.company_admin_user_id')::uuid)
) fixtures(fixture_id)
on conflict (id) do update
set user_status='active', updated_at=now();

insert into public.company_memberships(
  company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key
) values
(
  current_setting('gridex.test.company_a_id')::uuid,
  current_setting('gridex.test.tenant_user_id')::uuid,
  'member','active',now(),'{}'::jsonb,'member',true,now(),'member'
),
(
  current_setting('gridex.test.company_a_id')::uuid,
  current_setting('gridex.test.company_admin_user_id')::uuid,
  'company_admin','active',now(),'{}'::jsonb,'company_admin',true,now(),'company_admin'
);

select set_config('gridex.test.run_a_id', gen_random_uuid()::text, true);
select set_config('gridex.test.run_b_id', gen_random_uuid()::text, true);
select set_config('gridex.test.item_a_id', gen_random_uuid()::text, true);
select set_config('gridex.test.item_b_id', gen_random_uuid()::text, true);
select set_config('gridex.test.conflict_a_id', gen_random_uuid()::text, true);
select set_config('gridex.test.conflict_b_id', gen_random_uuid()::text, true);
select set_config('gridex.test.job_a_id', gen_random_uuid()::text, true);
select set_config('gridex.test.job_b_id', gen_random_uuid()::text, true);

insert into public.actor_registry_import_runs(id,company_id,source,source_hash,metadata)
values
(current_setting('gridex.test.run_a_id')::uuid,current_setting('gridex.test.company_a_id')::uuid,'bl002_rollback',current_setting('gridex.test.fixture_token') || '-a',jsonb_build_object('fixture',current_setting('gridex.test.fixture_token'))),
(current_setting('gridex.test.run_b_id')::uuid,current_setting('gridex.test.company_b_id')::uuid,'bl002_rollback',current_setting('gridex.test.fixture_token') || '-b',jsonb_build_object('fixture',current_setting('gridex.test.fixture_token')));

insert into public.actor_registry_import_items(id,import_run_id,company_id,normalized_name)
values
(current_setting('gridex.test.item_a_id')::uuid,current_setting('gridex.test.run_a_id')::uuid,current_setting('gridex.test.company_a_id')::uuid,'bl002-' || current_setting('gridex.test.fixture_token') || '-a'),
(current_setting('gridex.test.item_b_id')::uuid,current_setting('gridex.test.run_b_id')::uuid,current_setting('gridex.test.company_b_id')::uuid,'bl002-' || current_setting('gridex.test.fixture_token') || '-b');

insert into public.actor_registry_conflicts(id,company_id,import_run_id,import_item_id,conflict_type,title,message,metadata)
values
(current_setting('gridex.test.conflict_a_id')::uuid,current_setting('gridex.test.company_a_id')::uuid,current_setting('gridex.test.run_a_id')::uuid,current_setting('gridex.test.item_a_id')::uuid,'bl002_regression','BL-002 fixture','rollback fixture',jsonb_build_object('fixture',current_setting('gridex.test.fixture_token'))),
(current_setting('gridex.test.conflict_b_id')::uuid,current_setting('gridex.test.company_b_id')::uuid,current_setting('gridex.test.run_b_id')::uuid,current_setting('gridex.test.item_b_id')::uuid,'bl002_regression','BL-002 fixture','rollback fixture',jsonb_build_object('fixture',current_setting('gridex.test.fixture_token')));

insert into public.ediel_certificate_refresh_jobs(id,company_id,triggered_by,metadata)
values
(current_setting('gridex.test.job_a_id')::uuid,current_setting('gridex.test.company_a_id')::uuid,'backfill',jsonb_build_object('fixture',current_setting('gridex.test.fixture_token'))),
(current_setting('gridex.test.job_b_id')::uuid,current_setting('gridex.test.company_b_id')::uuid,'backfill',jsonb_build_object('fixture',current_setting('gridex.test.fixture_token')));

-- Reusable assertion body: no target fixture row may be visible.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('gridex.test.ordinary_user_id'), true);
do $$
begin
  if (select count(*) from public.actor_registry_conflicts where id in (current_setting('gridex.test.conflict_a_id')::uuid,current_setting('gridex.test.conflict_b_id')::uuid)) <> 0
     or (select count(*) from public.actor_registry_import_items where id in (current_setting('gridex.test.item_a_id')::uuid,current_setting('gridex.test.item_b_id')::uuid)) <> 0
     or (select count(*) from public.actor_registry_import_runs where id in (current_setting('gridex.test.run_a_id')::uuid,current_setting('gridex.test.run_b_id')::uuid)) <> 0
     or (select count(*) from public.ediel_certificate_refresh_jobs where id in (current_setting('gridex.test.job_a_id')::uuid,current_setting('gridex.test.job_b_id')::uuid)) <> 0 then
    raise exception 'ordinary_authenticated_can_read_global_rows';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('gridex.test.tenant_user_id'), true);
do $$
begin
  if (select count(*) from public.actor_registry_conflicts where id in (current_setting('gridex.test.conflict_a_id')::uuid,current_setting('gridex.test.conflict_b_id')::uuid)) <> 0
     or (select count(*) from public.actor_registry_import_items where id in (current_setting('gridex.test.item_a_id')::uuid,current_setting('gridex.test.item_b_id')::uuid)) <> 0
     or (select count(*) from public.actor_registry_import_runs where id in (current_setting('gridex.test.run_a_id')::uuid,current_setting('gridex.test.run_b_id')::uuid)) <> 0
     or (select count(*) from public.ediel_certificate_refresh_jobs where id in (current_setting('gridex.test.job_a_id')::uuid,current_setting('gridex.test.job_b_id')::uuid)) <> 0 then
    raise exception 'tenant_member_can_read_global_rows';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('gridex.test.company_admin_user_id'), true);
do $$
begin
  if (select count(*) from public.actor_registry_conflicts where id in (current_setting('gridex.test.conflict_a_id')::uuid,current_setting('gridex.test.conflict_b_id')::uuid)) <> 0
     or (select count(*) from public.actor_registry_import_items where id in (current_setting('gridex.test.item_a_id')::uuid,current_setting('gridex.test.item_b_id')::uuid)) <> 0
     or (select count(*) from public.actor_registry_import_runs where id in (current_setting('gridex.test.run_a_id')::uuid,current_setting('gridex.test.run_b_id')::uuid)) <> 0
     or (select count(*) from public.ediel_certificate_refresh_jobs where id in (current_setting('gridex.test.job_a_id')::uuid,current_setting('gridex.test.job_b_id')::uuid)) <> 0 then
    raise exception 'company_admin_can_read_global_rows';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('gridex.test.platform_admin_user_id'), true);
do $$
begin
  if not public.gridex_user_is_platform_admin() then
    raise exception 'platform_admin_helper_failed';
  end if;
  if (select count(*) from public.actor_registry_conflicts where id in (current_setting('gridex.test.conflict_a_id')::uuid,current_setting('gridex.test.conflict_b_id')::uuid)) <> 2
     or (select count(*) from public.actor_registry_import_items where id in (current_setting('gridex.test.item_a_id')::uuid,current_setting('gridex.test.item_b_id')::uuid)) <> 2
     or (select count(*) from public.actor_registry_import_runs where id in (current_setting('gridex.test.run_a_id')::uuid,current_setting('gridex.test.run_b_id')::uuid)) <> 2
     or (select count(*) from public.ediel_certificate_refresh_jobs where id in (current_setting('gridex.test.job_a_id')::uuid,current_setting('gridex.test.job_b_id')::uuid)) <> 2 then
    raise exception 'platform_admin_cannot_read_all_global_rows';
  end if;
end;
$$;

reset role;
set local role service_role;
do $$
begin
  if (select count(*) from public.actor_registry_conflicts where id in (current_setting('gridex.test.conflict_a_id')::uuid,current_setting('gridex.test.conflict_b_id')::uuid)) <> 2
     or (select count(*) from public.actor_registry_import_items where id in (current_setting('gridex.test.item_a_id')::uuid,current_setting('gridex.test.item_b_id')::uuid)) <> 2
     or (select count(*) from public.actor_registry_import_runs where id in (current_setting('gridex.test.run_a_id')::uuid,current_setting('gridex.test.run_b_id')::uuid)) <> 2
     or (select count(*) from public.ediel_certificate_refresh_jobs where id in (current_setting('gridex.test.job_a_id')::uuid,current_setting('gridex.test.job_b_id')::uuid)) <> 2 then
    raise exception 'service_role_cannot_read_worker_rows';
  end if;
end;
$$;

reset role;

do $$
declare
  v_bad integer;
  v_expected integer;
begin
  select count(*) into v_bad
  from pg_policy pol
  join pg_class c on c.oid=pol.polrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname in ('actor_registry_conflicts','actor_registry_import_items','actor_registry_import_runs','ediel_certificate_refresh_jobs')
    and pol.polcmd='r'
    and pg_get_expr(pol.polqual, pol.polrelid, true) ilike '%auth.uid() IS NOT NULL%';
  if v_bad <> 0 then
    raise exception 'broad_authenticated_read_policy_remains:%', v_bad;
  end if;

  select count(*) into v_expected
  from pg_policy pol
  join pg_class c on c.oid=pol.polrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname in ('actor_registry_conflicts','actor_registry_import_items','actor_registry_import_runs','ediel_certificate_refresh_jobs')
    and pol.polcmd='r'
    and pol.polname in (c.relname || '_platform_admin_read', c.relname || '_service_role_read');
  if v_expected <> 8 then
    raise exception 'expected_read_policy_count_mismatch:%', v_expected;
  end if;
end;
$$;

rollback;
\echo 'GRIDEX-OPS-BL-002 two-tenant rollback regression passed.'
