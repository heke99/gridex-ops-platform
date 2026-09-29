\set ON_ERROR_STOP on
-- Disposable clean-replay database only. All synthetic writes roll back.
-- Detects lost stored versions, either missing scope predicate, changed keyset
-- ordering/limits, duplicate/omitted rows at ties, and leaked RPC grants.
begin;

insert into public.companies(id, name) values
  ('00000000-0000-4000-8000-0000000e2001', 'Synthetic event tenant A'),
  ('00000000-0000-4000-8000-0000000e2002', 'Synthetic event tenant B');
insert into public.customers(id, company_id, customer_number, name, customer_type) values
  ('00000000-0000-4000-8000-0000000e2101', '00000000-0000-4000-8000-0000000e2001', 'EVENT-V2-A-1', 'Synthetic event customer A1', 'private'),
  ('00000000-0000-4000-8000-0000000e2102', '00000000-0000-4000-8000-0000000e2001', 'EVENT-V2-A-2', 'Synthetic event customer A2', 'private'),
  ('00000000-0000-4000-8000-0000000e2103', '00000000-0000-4000-8000-0000000e2002', 'EVENT-V2-B-1', 'Synthetic event customer B1', 'private');

-- Remove only events authored by customer-insert triggers for these disposable
-- fixture tenants, before installing the hand-derived timeline below.
delete from public.customer_events
where company_id in ('00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2002');
delete from public.domain_events
where company_id in ('00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2002');

insert into public.customer_events(id, company_id, customer_id, event_type, source, occurred_at, created_at, payload) values
  ('00000000-0000-4000-8000-0000000e2310', '00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2101', 'customer.fixture_latest', 'event-v2-native', '2026-09-29 19:00:00+00', '2026-09-29 19:00:01+00', '{"internal":"must not project"}'),
  ('00000000-0000-4000-8000-0000000e2302', '00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2101', 'customer.fixture_tie_high', 'event-v2-native', '2026-09-29 18:00:00.123456+00', '2026-09-29 18:00:01+00', '{}'),
  ('00000000-0000-4000-8000-0000000e2301', '00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2101', 'customer.fixture_tie_low', 'event-v2-native', '2026-09-29 18:00:00.123456+00', '2026-09-29 18:00:02+00', '{}'),
  ('00000000-0000-4000-8000-0000000e2401', '00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2102', 'customer.fixture_other_customer', 'event-v2-native', '2026-09-29 20:00:00+00', '2026-09-29 20:00:01+00', '{}'),
  ('00000000-0000-4000-8000-0000000e2501', '00000000-0000-4000-8000-0000000e2002', '00000000-0000-4000-8000-0000000e2103', 'customer.fixture_other_tenant', 'event-v2-native', '2026-09-29 20:00:00+00', '2026-09-29 20:00:01+00', '{}');

-- IDs 2301/2302 deliberately occur in BOTH tables at the same microsecond.
insert into public.domain_events(id, company_id, subject_customer_id, event_type, aggregate_type, aggregate_id, source, event_version, occurred_at, created_at, payload) values
  ('00000000-0000-4000-8000-0000000e2302', '00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2101', 'customer.fixture_tie_high', 'customer', 'event-v2-a1', 'event-v2-native', 7, '2026-09-29 18:00:00.123456+00', '2026-09-29 18:00:03+00', '{"internal":"must not project"}'),
  ('00000000-0000-4000-8000-0000000e2301', '00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2101', 'customer.fixture_tie_low', 'customer', 'event-v2-a1', 'event-v2-native', 3, '2026-09-29 18:00:00.123456+00', '2026-09-29 18:00:04+00', '{}'),
  ('00000000-0000-4000-8000-0000000e2303', '00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2101', 'customer.fixture_older', 'customer', 'event-v2-a1', 'event-v2-native', 2, '2026-09-29 17:00:00+00', '2026-09-29 17:00:01+00', '{}'),
  ('00000000-0000-4000-8000-0000000e2402', '00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2102', 'customer.fixture_other_customer', 'customer', 'event-v2-a2', 'event-v2-native', 9, '2026-09-29 20:00:00+00', '2026-09-29 20:00:01+00', '{}'),
  ('00000000-0000-4000-8000-0000000e2502', '00000000-0000-4000-8000-0000000e2002', '00000000-0000-4000-8000-0000000e2103', 'customer.fixture_other_tenant', 'customer', 'event-v2-b1', 'event-v2-native', 11, '2026-09-29 20:00:00+00', '2026-09-29 20:00:01+00', '{}');

insert into public.domain_events(id, company_id, subject_customer_id, event_type, aggregate_type, aggregate_id, source, event_version, occurred_at, created_at)
select ('00000000-0000-4000-8000-' || lpad((9000 + n)::text, 12, '0'))::uuid,
  '00000000-0000-4000-8000-0000000e2001'::uuid,
  '00000000-0000-4000-8000-0000000e2101'::uuid,
  'customer.fixture_tail', 'customer', 'event-v2-a1', 'event-v2-native', 4,
  '2026-09-29 16:00:00.123456+00'::timestamptz, '2026-09-29 16:00:01+00'::timestamptz
from generate_series(1, 110) n;

create temporary table event_v2_source_before on commit drop as
select 'customer_events'::text as source_table, to_jsonb(e) as row
from public.customer_events e
where e.company_id in ('00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2002')
union all
select 'domain_events', to_jsonb(e)
from public.domain_events e
where e.company_id in ('00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2002');

do $test$
declare fn regprocedure := 'public.portal_customer_events_page_v2(uuid,uuid,timestamptz,integer,uuid,integer)'::regprocedure;
begin
  if not has_function_privilege('service_role', fn, 'EXECUTE')
     or has_function_privilege('anon', fn, 'EXECUTE')
     or has_function_privilege('authenticated', fn, 'EXECUTE')
     or exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a
                where p.oid = fn and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception 'event-v2 service-only ACL violated';
  end if;
  if not exists (select 1 from pg_proc where oid = fn and not prosecdef
                 and provolatile = 's' and proconfig @> array['search_path=public, pg_catalog']) then
    raise exception 'event-v2 must remain a stable invoker with pinned search_path';
  end if;
  raise notice 'EVENT_V2_ACL_PASS';
end
$test$;

set local role service_role;
do $test$
declare
  ca constant uuid := '00000000-0000-4000-8000-0000000e2001';
  cb constant uuid := '00000000-0000-4000-8000-0000000e2002';
  a1 constant uuid := '00000000-0000-4000-8000-0000000e2101';
  a2 constant uuid := '00000000-0000-4000-8000-0000000e2102';
  b1 constant uuid := '00000000-0000-4000-8000-0000000e2103';
  expected_prefix constant text[] := array[
    'customer_events:00000000-0000-4000-8000-0000000e2310',
    'customer_events:00000000-0000-4000-8000-0000000e2302',
    'customer_events:00000000-0000-4000-8000-0000000e2301',
    'domain_events:00000000-0000-4000-8000-0000000e2302',
    'domain_events:00000000-0000-4000-8000-0000000e2301',
    'domain_events:00000000-0000-4000-8000-0000000e2303'];
  actual_prefix text[];
  all_rows jsonb;
  old_rows jsonb;
  page jsonb;
  replay jsonb;
  seen jsonb := '[]';
  cursor_time timestamptz := null;
  cursor_rank integer := null;
  cursor_id uuid := null;
  last_row jsonb;
  page_count integer := 0;
begin
  -- Characterize the real v1 gap on the same stored version, without altering
  -- its return contract. This is not a fallback/projection fabricated in JS.
  if (select d.event_version from public.domain_events d
       where d.id = '00000000-0000-4000-8000-0000000e2302') is distinct from 7
     or exists (select 1 from public.portal_customer_events_page_v1(ca, a1) e
                 where e.source_table = 'domain_events' and to_jsonb(e) ? 'event_version') then
    raise exception 'fixture must reproduce stored version 7 omitted by v1';
  end if;
  raise notice 'EVENT_V1_VERSION_GAP_CONFIRMED stored=7 v1_has_version=false';

  if (select e.event_version from public.portal_customer_events_page_v2(ca, a1) e
       where e.source_table = 'domain_events' and e.id = '00000000-0000-4000-8000-0000000e2302') is distinct from 7
     or (select e.event_version from public.portal_customer_events_page_v2(ca, a1) e
          where e.source_table = 'domain_events' and e.id = '00000000-0000-4000-8000-0000000e2301') is distinct from 3
     or exists (select 1 from public.portal_customer_events_page_v2(ca, a1) e
                 where e.source_table = 'customer_events' and e.event_version is distinct from 1)
     or exists (select 1 from public.portal_customer_events_page_v2(ca, a1) e
                 where e.source_table = 'domain_events'
                   and e.event_version is distinct from (select d.event_version from public.domain_events d where d.id = e.id)) then
    raise exception 'stored domain version or explicit legacy version lost';
  end if;
  if exists (select 1 from public.portal_customer_events_page_v2(ca, a1) e
              where (to_jsonb(e) - array['id','source_table','source_rank','event_type','event_version','source','occurred_at','created_at']) <> '{}'::jsonb) then
    raise exception 'event-v2 exposed fields outside its eight-column projection';
  end if;
  raise notice 'EVENT_V2_VERSIONS_PROJECTION_PASS domain=7,3,2,4 customer=1';

  select array_agg(e.source_table || ':' || e.id::text order by e.occurred_at desc, e.source_rank desc, e.id desc)
  into actual_prefix from public.portal_customer_events_page_v2(ca, a1, p_limit => 6) e;
  if actual_prefix is distinct from expected_prefix then
    raise exception 'event-v2 changed timestamp/rank/UUID order: %', actual_prefix;
  end if;
  select jsonb_agg(to_jsonb(e) - 'event_version' order by e.occurred_at desc, e.source_rank desc, e.id desc)
  into all_rows from public.portal_customer_events_page_v2(ca, a1, p_limit => 101) e;
  select jsonb_agg(to_jsonb(e) order by e.occurred_at desc, e.source_rank desc, e.id desc)
  into old_rows from public.portal_customer_events_page_v1(ca, a1, p_limit => 101) e;
  if all_rows is distinct from old_rows then raise exception 'v1 fields changed in v2'; end if;
  raise notice 'EVENT_V2_ORDER_V1_PARITY_PASS';

  if (select count(*) from public.portal_customer_events_page_v2(ca, a2)) <> 2
     or (select array_agg(e.event_version order by e.source_rank desc) from public.portal_customer_events_page_v2(ca, a2) e) is distinct from array[1,9]
     or (select count(*) from public.portal_customer_events_page_v2(cb, b1)) <> 2
     or (select array_agg(e.event_version order by e.source_rank desc) from public.portal_customer_events_page_v2(cb, b1) e) is distinct from array[1,11] then
    raise exception 'two same-tenant customers or foreign tenant projection failed';
  end if;
  if exists (select 1 from public.portal_customer_events_page_v2(ca, a1) e
              where e.event_type in ('customer.fixture_other_customer','customer.fixture_other_tenant'))
     or exists (select 1 from public.portal_customer_events_page_v2(cb, a1))
     or exists (select 1 from public.portal_customer_events_page_v2(ca, b1))
     or exists (select 1 from public.portal_customer_events_page_v2(null, a1))
     or exists (select 1 from public.portal_customer_events_page_v2(ca, null)) then
    raise exception 'event-v2 tenant/customer filter failed';
  end if;
  raise notice 'EVENT_V2_TENANT_CUSTOMER_FILTERS_PASS';

  if (select count(*) from public.portal_customer_events_page_v2(ca, a1)) <> 51
     or (select count(*) from public.portal_customer_events_page_v2(ca, a1, p_limit => null)) <> 51
     or (select count(*) from public.portal_customer_events_page_v2(ca, a1, p_limit => 0)) <> 1
     or (select count(*) from public.portal_customer_events_page_v2(ca, a1, p_limit => -3)) <> 1
     or (select count(*) from public.portal_customer_events_page_v2(ca, a1, p_limit => 10000)) <> 101 then
    raise exception 'event-v2 changed default/null/lower/upper limit semantics';
  end if;
  raise notice 'EVENT_V2_LIMITS_PASS default=51 null=51 low=1 high=101';

  loop
    select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at desc, e.source_rank desc, e.id desc), '[]')
    into page from public.portal_customer_events_page_v2(ca, a1, cursor_time, cursor_rank, cursor_id, 2) e;
    select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at desc, e.source_rank desc, e.id desc), '[]')
    into replay from public.portal_customer_events_page_v2(ca, a1, cursor_time, cursor_rank, cursor_id, 2) e;
    if page is distinct from replay then raise exception 'same cursor produced a different page'; end if;
    select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at desc, e.source_rank desc, e.id desc), '[]')
    into old_rows from public.portal_customer_events_page_v1(ca, a1, cursor_time, cursor_rank, cursor_id, 2) e;
    select coalesce(jsonb_agg(value - 'event_version' order by ordinal), '[]')
    into replay from jsonb_array_elements(page) with ordinality p(value, ordinal);
    if replay is distinct from old_rows then raise exception 'v2 cursor page differs from v1'; end if;
    exit when page = '[]'::jsonb;
    page_count := page_count + 1;
    if page_count > 58 then raise exception 'cursor did not advance within 58 pages'; end if;
    seen := seen || page;
    last_row := page -> (jsonb_array_length(page) - 1);
    cursor_time := (last_row ->> 'occurred_at')::timestamptz;
    cursor_rank := (last_row ->> 'source_rank')::integer;
    cursor_id := (last_row ->> 'id')::uuid;
  end loop;
  if page_count <> 58 or jsonb_array_length(seen) <> 116 then
    raise exception 'cursor lost/duplicated rows: pages=% rows=%', page_count, jsonb_array_length(seen);
  end if;
  select array_agg((value ->> 'source_table') || ':' || (value ->> 'id') order by ordinal)
  into actual_prefix from jsonb_array_elements(seen) with ordinality p(value, ordinal) where ordinal <= 6;
  if actual_prefix is distinct from expected_prefix
     or (select count(distinct (value ->> 'source_table', value ->> 'id')) from jsonb_array_elements(seen)) <> 116 then
    raise exception 'tie cursor skipped or duplicated a source/ID';
  end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at desc, e.source_rank desc, e.id desc), '[]')
  into all_rows from public.portal_customer_events_page_v2(ca, a1, p_limit => 101) e;
  select jsonb_agg(value order by ordinal) into replay
  from jsonb_array_elements(seen) with ordinality p(value, ordinal) where ordinal <= 101;
  if replay is distinct from all_rows then raise exception 'paginated rows differ from first 101-row page'; end if;
  raise notice 'EVENT_V2_CURSOR_REPLAY_PASS events=116 pages=58 replay_checks=59 microsecond_ties=true shared_ids=true';
end
$test$;
reset role;

set local role anon;
do $test$
begin
  begin
    perform * from public.portal_customer_events_page_v2('00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2101');
    raise exception 'anon executed the event-v2 RPC';
  exception when insufficient_privilege then
    if sqlerrm not like '%function portal_customer_events_page_v2%' then raise; end if;
  end;
  raise notice 'EVENT_V2_ANON_DENIED_PASS sqlstate=42501';
end
$test$;
reset role;

set local role authenticated;
do $test$
begin
  begin
    perform * from public.portal_customer_events_page_v2('00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2101');
    raise exception 'authenticated executed the event-v2 RPC';
  exception when insufficient_privilege then
    if sqlerrm not like '%function portal_customer_events_page_v2%' then raise; end if;
  end;
  raise notice 'EVENT_V2_AUTHENTICATED_DENIED_PASS sqlstate=42501';
end
$test$;
reset role;

do $test$
begin
  if exists (
    with after_rows as (
      select 'customer_events'::text as source_table, to_jsonb(e) as row from public.customer_events e
      where e.company_id in ('00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2002')
      union all
      select 'domain_events', to_jsonb(e) from public.domain_events e
      where e.company_id in ('00000000-0000-4000-8000-0000000e2001', '00000000-0000-4000-8000-0000000e2002')
    )
    select 1 from ((select * from event_v2_source_before except all select * from after_rows)
                  union all (select * from after_rows except all select * from event_v2_source_before)) delta
  ) then raise exception 'event-v2 reads changed source rows'; end if;
  raise notice 'EVENT_V2_SOURCE_IMMUTABLE_PASS';
  raise notice 'EVENT_V2_NATIVE_PASS';
end
$test$;
rollback;
