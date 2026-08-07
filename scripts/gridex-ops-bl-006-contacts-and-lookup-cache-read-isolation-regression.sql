\set ON_ERROR_STOP on
\pset pager off

-- GRIDEX-OPS-BL-006 regression. Run against an isolated/staging database after
-- 20260807154500_gridex_ops_bl_006_contacts_and_lookup_cache_read_isolation.sql.
-- Everything rolls back.
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
       'gridex-bl006-' || fixture_id::text || '@example.invalid',
       now(), '{}'::jsonb, '{}'::jsonb, now(), now(), false, false
from (
  values
    (current_setting('gridex.test.ordinary_user_id')::uuid),
    (current_setting('gridex.test.tenant_user_id')::uuid),
    (current_setting('gridex.test.company_admin_user_id')::uuid)
) fixtures(fixture_id);

insert into public.user_profiles(id,email,full_name,user_status,created_at,updated_at,must_change_password)
select fixture_id,
       'gridex-bl006-' || fixture_id::text || '@example.invalid',
       'GRIDEX-OPS-BL-006 rollback fixture',
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

select set_config('gridex.test.actor_a_id', gen_random_uuid()::text, true);
select set_config('gridex.test.actor_b_id', gen_random_uuid()::text, true);
select set_config('gridex.test.contact_a_id', gen_random_uuid()::text, true);
select set_config('gridex.test.contact_b_id', gen_random_uuid()::text, true);
select set_config('gridex.test.address_a_id', gen_random_uuid()::text, true);
select set_config('gridex.test.address_b_id', gen_random_uuid()::text, true);
select set_config('gridex.test.energy_a_id', gen_random_uuid()::text, true);
select set_config('gridex.test.energy_b_id', gen_random_uuid()::text, true);

insert into public.platform_market_actors(id,name,source,metadata)
values
(
  current_setting('gridex.test.actor_a_id')::uuid,
  'BL003 Fixture A ' || current_setting('gridex.test.fixture_token'),
  'bl006_rollback',
  jsonb_build_object('fixture', current_setting('gridex.test.fixture_token'))
),
(
  current_setting('gridex.test.actor_b_id')::uuid,
  'BL003 Fixture B ' || current_setting('gridex.test.fixture_token'),
  'bl006_rollback',
  jsonb_build_object('fixture', current_setting('gridex.test.fixture_token'))
);

insert into public.platform_actor_contacts(id,actor_id,contact_type,email,phone,source,metadata)
values
(
  current_setting('gridex.test.contact_a_id')::uuid,
  current_setting('gridex.test.actor_a_id')::uuid,
  'switching',
  'a-' || current_setting('gridex.test.fixture_token') || '@example.invalid',
  null,
  'bl006_rollback',
  jsonb_build_object('fixture', current_setting('gridex.test.fixture_token'))
),
(
  current_setting('gridex.test.contact_b_id')::uuid,
  current_setting('gridex.test.actor_b_id')::uuid,
  'switching',
  'b-' || current_setting('gridex.test.fixture_token') || '@example.invalid',
  null,
  'bl006_rollback',
  jsonb_build_object('fixture', current_setting('gridex.test.fixture_token'))
);

insert into public.platform_address_lookup_cache(id,address_key,street,postal_code,city,raw_payload)
values
(
  current_setting('gridex.test.address_a_id')::uuid,
  'bl006-a-' || current_setting('gridex.test.fixture_token'),
  'Fixture Street A',
  '11122',
  'Stockholm',
  jsonb_build_object('fixture', current_setting('gridex.test.fixture_token'))
),
(
  current_setting('gridex.test.address_b_id')::uuid,
  'bl006-b-' || current_setting('gridex.test.fixture_token'),
  'Fixture Street B',
  '22233',
  'Göteborg',
  jsonb_build_object('fixture', current_setting('gridex.test.fixture_token'))
);

insert into public.platform_energy_lookup_cache(id,lookup_key,input,result)
values
(
  current_setting('gridex.test.energy_a_id')::uuid,
  'bl006-a-' || current_setting('gridex.test.fixture_token'),
  jsonb_build_object('fixture', current_setting('gridex.test.fixture_token'), 'side', 'a'),
  jsonb_build_object('fixture', current_setting('gridex.test.fixture_token'))
),
(
  current_setting('gridex.test.energy_b_id')::uuid,
  'bl006-b-' || current_setting('gridex.test.fixture_token'),
  jsonb_build_object('fixture', current_setting('gridex.test.fixture_token'), 'side', 'b'),
  jsonb_build_object('fixture', current_setting('gridex.test.fixture_token'))
);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('gridex.test.ordinary_user_id'), true);
do $$
begin
  if (select count(*) from public.platform_actor_contacts where id in (current_setting('gridex.test.contact_a_id')::uuid,current_setting('gridex.test.contact_b_id')::uuid)) <> 0
     or (select count(*) from public.platform_address_lookup_cache where id in (current_setting('gridex.test.address_a_id')::uuid,current_setting('gridex.test.address_b_id')::uuid)) <> 0
     or (select count(*) from public.platform_energy_lookup_cache where id in (current_setting('gridex.test.energy_a_id')::uuid,current_setting('gridex.test.energy_b_id')::uuid)) <> 0 then
    raise exception 'ordinary_authenticated_can_read_global_rows';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('gridex.test.tenant_user_id'), true);
do $$
begin
  if (select count(*) from public.platform_actor_contacts where id in (current_setting('gridex.test.contact_a_id')::uuid,current_setting('gridex.test.contact_b_id')::uuid)) <> 0
     or (select count(*) from public.platform_address_lookup_cache where id in (current_setting('gridex.test.address_a_id')::uuid,current_setting('gridex.test.address_b_id')::uuid)) <> 0
     or (select count(*) from public.platform_energy_lookup_cache where id in (current_setting('gridex.test.energy_a_id')::uuid,current_setting('gridex.test.energy_b_id')::uuid)) <> 0 then
    raise exception 'tenant_member_can_read_global_rows';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('gridex.test.company_admin_user_id'), true);
do $$
begin
  if (select count(*) from public.platform_actor_contacts where id in (current_setting('gridex.test.contact_a_id')::uuid,current_setting('gridex.test.contact_b_id')::uuid)) <> 0
     or (select count(*) from public.platform_address_lookup_cache where id in (current_setting('gridex.test.address_a_id')::uuid,current_setting('gridex.test.address_b_id')::uuid)) <> 0
     or (select count(*) from public.platform_energy_lookup_cache where id in (current_setting('gridex.test.energy_a_id')::uuid,current_setting('gridex.test.energy_b_id')::uuid)) <> 0 then
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
  if (select count(*) from public.platform_actor_contacts where id in (current_setting('gridex.test.contact_a_id')::uuid,current_setting('gridex.test.contact_b_id')::uuid)) <> 2
     or (select count(*) from public.platform_address_lookup_cache where id in (current_setting('gridex.test.address_a_id')::uuid,current_setting('gridex.test.address_b_id')::uuid)) <> 2
     or (select count(*) from public.platform_energy_lookup_cache where id in (current_setting('gridex.test.energy_a_id')::uuid,current_setting('gridex.test.energy_b_id')::uuid)) <> 2 then
    raise exception 'platform_admin_cannot_read_all_global_rows';
  end if;
end;
$$;

reset role;
set local role service_role;
do $$
begin
  if (select count(*) from public.platform_actor_contacts where id in (current_setting('gridex.test.contact_a_id')::uuid,current_setting('gridex.test.contact_b_id')::uuid)) <> 2
     or (select count(*) from public.platform_address_lookup_cache where id in (current_setting('gridex.test.address_a_id')::uuid,current_setting('gridex.test.address_b_id')::uuid)) <> 2
     or (select count(*) from public.platform_energy_lookup_cache where id in (current_setting('gridex.test.energy_a_id')::uuid,current_setting('gridex.test.energy_b_id')::uuid)) <> 2 then
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
    and c.relname in ('platform_actor_contacts','platform_address_lookup_cache','platform_energy_lookup_cache')
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
    and c.relname in ('platform_actor_contacts','platform_address_lookup_cache','platform_energy_lookup_cache')
    and pol.polcmd='r'
    and pol.polname in (c.relname || '_platform_admin_read', c.relname || '_service_role_read');
  if v_expected <> 6 then
    raise exception 'expected_read_policy_count_mismatch:%', v_expected;
  end if;
end;
$$;

rollback;
\echo 'GRIDEX-OPS-BL-006 two-tenant rollback regression passed.'
