-- Run ONLY in a separate empty local PostgreSQL database with the standard
-- anon/authenticated/service_role cluster roles. Never run against production.
-- The transaction rolls back all synthetic fixtures and migration statements.
\set ON_ERROR_STOP on
begin;

    create schema auth;create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;
    create table public.companies(id uuid primary key);
    create table public.customers(id uuid primary key,company_id uuid,status text,source text,email text,onboarding_status text);
    create table public.customer_sites(id uuid primary key,company_id uuid,customer_id uuid references public.customers(id),status text);
    create table public.metering_points(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,
      status text,bidding_zone_code text,estimated_annual_consumption_kwh numeric,grid_owner_id uuid,start_date date,end_date date,
      meter_point_id text,site_facility_id text,ediel_reference text,measurement_type text,reading_frequency text,
      data_quality_status text,verification_status text,price_area_code text,is_settlement_relevant boolean,updated_by uuid);
    create table public.metering_values(id uuid primary key,company_id uuid,metering_point_id uuid,value_kwh numeric,quantity_kwh numeric,period_start timestamptz);
    create table public.ediel_messages(id uuid,company_id uuid,status text);
    create table public.grid_owner_data_requests(id uuid,company_id uuid,status text,created_at timestamptz);
    insert into public.companies values('11111111-1111-4111-8111-111111111111');
    insert into public.customers values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','draft','ediel_portal_test','fixture@example.invalid','completed');
    insert into public.customer_sites values('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','draft');
    insert into public.metering_points(id,company_id,customer_id,site_id,status,bidding_zone_code,estimated_annual_consumption_kwh,grid_owner_id,start_date)
      values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','draft','SE1',100,'55555555-5555-4555-8555-555555555555','2026-01-01');
CREATE TABLE public.data_quality_issues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    issue_type text NOT NULL,
    severity text DEFAULT 'warning'::text,
    message text NOT NULL,
    status text DEFAULT 'open'::text,
    detected_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.dashboard_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    alert_type text NOT NULL,
    severity text DEFAULT 'info'::text,
    title text NOT NULL,
    message text,
    entity_type text,
    entity_id uuid,
    status text DEFAULT 'open'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone
);
CREATE TABLE public.forecast_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    forecast_type text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    status text DEFAULT 'draft'::text,
    method text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone
);
CREATE TABLE public.forecast_run_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    forecast_run_id uuid NOT NULL,
    customer_id uuid,
    site_id uuid,
    metering_point_id uuid,
    grid_owner_id uuid,
    bidding_zone_code text,
    period_start date NOT NULL,
    period_end date NOT NULL,
    forecast_kwh numeric,
    actual_kwh numeric,
    diff_kwh numeric,
    diff_percent numeric,
    confidence_score numeric,
    method text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
\ir ../../../supabase/migrations/20261013094514_data_quality_lifecycle_consistency.sql
create or replace function public.gridex_company_has_customer_data(p_company_id uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp
as $$
 select exists(select 1 from public.customers c where c.company_id=p_company_id
   and coalesce(c.source,'')<>'ediel_portal_test'
   and coalesce(c.status,'') not in ('deleted','deleted_test_only','pending_deletion'))
$$;
update public.metering_points set status='active' where id='33333333-3333-4333-8333-333333333333';
insert into public.metering_values values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333',-5,null,date_trunc('month',current_date)-interval '2 months');
do $$declare c uuid:='11111111-1111-4111-8111-111111111111';r jsonb;begin
 if public.gridex_company_has_customer_data(c) then raise exception 'red_company_fixture_expected_excluded';end if;
 r:=public.gridex_scan_data_quality_v1(c,date_trunc('month',current_date)::date,null);
 if (r->>'issues')::int<>3 then raise exception 'red_expected_three_portal_operational_issues: %',r;end if;
 if not exists(select 1 from public.gridex_actionable_data_quality_issues_v where issue_type='invalid_metering_value')
 then raise exception 'red_expected_canonical_negative_actionable';end if;
end$$;
\ir ../../../supabase/migrations/20261013130700_operational_quality_customer_source_consistency.sql
\ir ../../../supabase/migrations/20261013130700_operational_quality_customer_source_consistency.sql

-- Model the retained live legacy keys, not the later application cutover.
alter table public.data_quality_issues add constraint data_quality_issues_company_id_entity_type_entity_id_issue__key
 unique(company_id,entity_type,entity_id,issue_type,status);
alter table public.dashboard_alerts add constraint dashboard_alerts_company_id_alert_type_entity_type_entity_i_key
 unique(company_id,alert_type,entity_type,entity_id,status);
create temp table quality_expected_writers as select p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,
 pg_get_functiondef(p.oid) definition from pg_proc p where p.oid=any(array[
 'public.gridex_upsert_data_quality_issue_v1(uuid,uuid,text,text,text,date)'::regprocedure,
 'public.gridex_upsert_dashboard_alert_v1(uuid,text,text,text,text,text,uuid,text)'::regprocedure,
 'public.gridex_reconcile_dashboard_alerts_internal_v1(uuid)'::regprocedure,
 'public.gridex_scan_data_quality_v1(uuid,date,uuid)'::regprocedure]);
create temp table quality_expected_legacy as select oid,conname,conrelid,pg_get_constraintdef(oid) definition
 from pg_constraint where conname in('data_quality_issues_company_id_entity_type_entity_id_issue__key',
 'dashboard_alerts_company_id_alert_type_entity_type_entity_i_key');
\ir ../../../supabase/migrations/20261013174700_operational_quality_company_unique_keys.sql
\ir ../../../supabase/migrations/20261013174700_operational_quality_company_unique_keys.sql
do $$declare r record;k text[];begin
 if (select count(*) from quality_expected_writers)<>4 or exists(
  select 1 from quality_expected_writers e join pg_proc p on p.oid=e.oid where
  row(p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile) is distinct from row(e.proowner,e.proacl,e.prosecdef,e.proconfig,e.provolatile)
  or pg_get_functiondef(p.oid) is distinct from replace(e.definition,'on conflict(open_key)','on conflict(company_id,open_key)'))
 then raise exception 'current_function_body_or_permissions_changed';end if;
 if (select count(*) from quality_expected_legacy)<>2 or exists(select 1 from quality_expected_legacy e
  left join pg_constraint c on c.oid=e.oid where c.oid is null or pg_get_constraintdef(c.oid) is distinct from e.definition)
 then raise exception 'legacy_cutover_constraints_changed';end if;
 for r in select indexrelid from pg_index where indexrelid in(
  'public.data_quality_issues_open_key_uidx'::regclass,'public.dashboard_alerts_open_key_uidx'::regclass) loop
  select array_agg(a.attname::text order by x.ord) into k from pg_index i
  cross join lateral unnest(i.indkey) with ordinality x(attnum,ord)
  join pg_attribute a on a.attrelid=i.indrelid and a.attnum=x.attnum
  where i.indexrelid=r.indexrelid and x.ord<=i.indnkeyatts;
  if k is distinct from array['company_id','open_key']::text[] then raise exception 'uniqueness_not_explicitly_tenant_scoped';end if;
 end loop;
 if has_function_privilege('service_role','public.gridex_reconcile_dashboard_alerts_internal_v1(uuid)','EXECUTE')
 then raise exception 'private_internal_alert_writer_exposed';end if;
end$$;

do $$declare c uuid:='11111111-1111-4111-8111-111111111111';m date:=date_trunc('month',current_date)::date;begin
 perform public.gridex_scan_data_quality_v1(c,m,null);
 if exists(select 1 from public.gridex_actionable_data_quality_issues_v) then raise exception 'portal_issues_still_actionable';end if;
 if (select count(*) from public.data_quality_issues where status='resolved')<>3 then raise exception 'resolved_history_not_retained';end if;
 if exists(select 1 from public.dashboard_alerts where status='open') then raise exception 'portal_alerts_still_open';end if;
 if not public.gridex_data_quality_source_exists_v1(c,'metering_value','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false)
 then raise exception 'physical_value_validation_changed';end if;
 insert into public.companies values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 insert into public.customers values
 ('66666666-6666-4666-8666-666666666666',c,'active','manual','fixture@example.invalid','completed'),
 ('88888888-8888-4888-8888-888888888888',c,'draft','manual','fixture@example.invalid','completed');
 insert into public.metering_points(id,company_id,customer_id,status,bidding_zone_code,estimated_annual_consumption_kwh,grid_owner_id,start_date) values
 ('77777777-7777-4777-8777-777777777777',c,'66666666-6666-4666-8666-666666666666','active','SE1',100,'55555555-5555-4555-8555-555555555555','2026-01-01'),
 ('99999999-9999-4999-8999-999999999999',c,'88888888-8888-4888-8888-888888888888','active','SE1',100,'55555555-5555-4555-8555-555555555555','2026-01-01'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',c,null,'active','SE1',100,'55555555-5555-4555-8555-555555555555','2026-01-01'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','active','SE1',100,'55555555-5555-4555-8555-555555555555','2026-01-01');
 if (select count(*) from public.gridex_missing_metering_points_v1(c,m))<>3 then raise exception 'normal_null_or_foreign_source_scope_changed';end if;
 if (select count(*) from public.gridex_missing_metering_points_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',m))<>1 then raise exception 'foreign_parent_decides_company_source';end if;
 perform public.gridex_scan_data_quality_v1(c,m,null);
 if not exists(select 1 from public.gridex_actionable_data_quality_issues_v where issue_type='active_metering_point_without_active_customer'
  and entity_id='99999999-9999-4999-8999-999999999999') then raise exception 'inactive_parent_warning_hidden';end if;
 update public.metering_points set status='inactive' where id='99999999-9999-4999-8999-999999999999';
 insert into public.metering_values values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',c,'77777777-7777-4777-8777-777777777777',-5,null,current_date),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff',c,'99999999-9999-4999-8999-999999999999',-5,null,current_date),
 ('abababab-abab-4bab-8bab-abababababab',c,null,-5,null,current_date);
 insert into public.data_quality_issues(company_id,entity_type,entity_id,issue_type,severity,message,status,source)
 values(c,'metering_point','33333333-3333-4333-8333-333333333333','manual_review','warning','Fixture manual review','open','manual');
 perform public.gridex_scan_data_quality_v1(c,m,null);
 if (select count(*) from public.gridex_actionable_data_quality_issues_v where issue_type='invalid_metering_value')<>3 then raise exception 'normal_inactive_or_orphan_negative_hidden';end if;
 if not exists(select 1 from public.gridex_actionable_data_quality_issues_v where issue_type='manual_review') then raise exception 'unknown_manual_review_hidden';end if;
 if exists(select 1 from pg_proc where oid='gridex_quality.operational_customer_source_v1(uuid,text,uuid)'::regprocedure and prosecdef)
 or not has_schema_privilege('authenticated','gridex_quality','USAGE')
 or not has_function_privilege('authenticated','gridex_quality.operational_customer_source_v1(uuid,text,uuid)','EXECUTE')
 or has_schema_privilege('anon','gridex_quality','USAGE')
 or has_function_privilege('anon','gridex_quality.operational_customer_source_v1(uuid,text,uuid)','EXECUTE') then raise exception 'private_helper_acl_changed';end if;
end$$;

-- Exercise issue upsert, direct alert upsert, both internal aggregate upserts,
-- and the source7-preserving scanner after the composite-index replacement.
do $$declare
 c uuid:='11111111-1111-4111-8111-111111111111';other_c uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 p uuid:='77777777-7777-4777-8777-777777777777';m date:=date_trunc('month',current_date)::date;
 q1 uuid;q2 uuid;a1 uuid;a2 uuid;b1 uuid;b_hash text;begin
 -- Retained legacy status keys permit one resolved history and one recurrence;
 -- keep its real condition faulty so the later scan does not close it again
 -- before the separate post-deployment legacy-key cutover.
 update public.metering_points set start_date=null where id=p;
 q1:=public.gridex_upsert_data_quality_issue_v1(c,p,'missing_start_date','warning','Fixture issue',null);
 q2:=public.gridex_upsert_data_quality_issue_v1(c,p,'missing_start_date','warning','Fixture issue replay',null);
 if q1<>q2 then raise exception 'same_company_issue_upsert_not_idempotent';end if;
 if not exists(select 1 from public.dashboard_alerts where company_id=c and source='gridex_data_quality'
  and alert_type='missing_metering_values' and status='open') or not exists(select 1 from public.dashboard_alerts
  where company_id=c and source='gridex_data_quality' and alert_type='data_quality' and status='open')
 then raise exception 'typed_and_total_aggregate_writers_not_exercised';end if;
 begin perform public.gridex_upsert_data_quality_issue_v1(other_c,p,'missing_start_date','warning','Foreign fixture',null);
  raise exception 'foreign_known_source_accepted';exception when foreign_key_violation then null;end;
 perform public.gridex_resolve_data_quality_issue_v1(c,q1);
 q2:=public.gridex_upsert_data_quality_issue_v1(c,p,'missing_start_date','warning','Fixture recurrence',null);
 if q1=q2 or not exists(select 1 from public.data_quality_issues where id=q1 and status='resolved' and open_key is null)
 then raise exception 'issue_resolution_history_not_retained';end if;
 a1:=public.gridex_upsert_dashboard_alert_v1(c,'fixture_aggregate','warning','Fixture','Fixture',null,null,'manual');
 a2:=public.gridex_upsert_dashboard_alert_v1(c,'fixture_aggregate','warning','Fixture replay','Fixture',null,null,'manual');
 b1:=public.gridex_upsert_dashboard_alert_v1(other_c,'fixture_aggregate','warning','Other company','Fixture',null,null,'manual');
 if a1<>a2 or a1=b1 then raise exception 'nullable_aggregate_company_identity_broken';end if;
 select md5(to_jsonb(a)::text) into b_hash from public.dashboard_alerts a where id=b1;
 perform public.gridex_resolve_dashboard_alert_v1(c,a1);
 a2:=public.gridex_upsert_dashboard_alert_v1(c,'fixture_aggregate','warning','Fixture recurrence','Fixture',null,null,'manual');
 if a1=a2 or not exists(select 1 from public.dashboard_alerts where id=a1 and status='resolved' and open_key is null)
 then raise exception 'aggregate_resolution_history_not_retained';end if;
 update public.customers set status='active',email=null,onboarding_status='draft'
 where id='22222222-2222-4222-8222-222222222222';
 perform public.gridex_scan_data_quality_v1(c,m,null);
 if exists(select 1 from public.gridex_actionable_data_quality_issues_v q join public.gridex_data_quality_rule_catalog_v r
  on r.issue_type=q.issue_type and r.entity_type=q.entity_type where q.entity_id in(
   '22222222-2222-4222-8222-222222222222'::uuid,'33333333-3333-4333-8333-333333333333'::uuid,'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid))
 then raise exception 'source7_portal_eligibility_reversed';end if;
 if not exists(select 1 from public.gridex_actionable_data_quality_issues_v where issue_type='manual_review')
 then raise exception 'unknown_manual_issue_lost';end if;
 if (select md5(to_jsonb(a)::text) from public.dashboard_alerts a where id=b1) is distinct from b_hash
 then raise exception 'other_company_history_mutated';end if;
end$$;
select 'native_quality_company_open_keys_regression_passed' as result;
rollback;
