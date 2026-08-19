-- Regression coverage for PR #164 review remediation.
-- Runs against the ephemeral clean-replay database and rolls back all fixtures.
-- Covers:
--   1) fixed-area pricing snapshots with/without price area
--   2) monthly spot coverage, including an interval crossing month end
--   3) queued claim, stale reclaim, retry ceiling terminalization
--   4) direct INSERT/UPDATE persistence on spot_price_monthly_summaries

begin;

do $regression$
declare
  v_snapshot jsonb;
  v_expected jsonb;
  v_month public.spot_price_monthly_summaries%rowtype;
  v_company_id uuid := '91000000-0000-4000-8000-000000000001'::uuid;
  v_customer_id uuid := '91000000-0000-4000-8000-000000000002'::uuid;
  v_job_id uuid := '91000000-0000-4000-8000-000000000003'::uuid;
  v_capped_job_id uuid := '91000000-0000-4000-8000-000000000004'::uuid;
  v_claimed public.customer_operation_jobs%rowtype;
  v_claim_count integer;
  v_start timestamptz;
  v_end timestamptz;
begin
  -- Snapshot without price area must remain byte-for-byte equivalent.
  v_snapshot := jsonb_build_object(
    'base_price_components_snapshot', jsonb_build_array(
      jsonb_build_object('id','se1','source_type','fixed','price_area','SE1'),
      jsonb_build_object('id','variable','source_type','variable'),
      jsonb_build_object('id','se2','source_type','fixed','price_area','SE2')
    ),
    'metadata', jsonb_build_object('marker','keep-me')
  );
  if private.gridex_normalize_fixed_area_snapshot_v1(v_snapshot) is distinct from v_snapshot then
    raise exception 'pr164_snapshot_without_price_area_changed';
  end if;

  -- Valid SE2 snapshot must keep non-fixed components and exactly one matching fixed base component.
  v_snapshot := jsonb_build_object(
    'price_area','SE2',
    'base_price_components_snapshot', jsonb_build_array(
      jsonb_build_object('id','se1','source_type','fixed','price_area','SE1'),
      jsonb_build_object('id','variable','source_type','variable'),
      jsonb_build_object('id','se2-first','source_type','fixed','price_area','SE2'),
      jsonb_build_object('id','se2-duplicate','source_type','fixed','price_area','SE2'),
      jsonb_build_object('id','area-independent','source_type','fixed')
    )
  );
  v_expected := jsonb_build_array(
    jsonb_build_object('id','variable','source_type','variable'),
    jsonb_build_object('id','se2-first','source_type','fixed','price_area','SE2'),
    jsonb_build_object('id','area-independent','source_type','fixed')
  );
  if private.gridex_normalize_fixed_area_snapshot_v1(v_snapshot)->'base_price_components_snapshot' is distinct from v_expected then
    raise exception 'pr164_snapshot_se2_normalization_failed';
  end if;

  -- Full January with one authoritative interval crossing one hour into February.
  v_start := timestamp '2099-01-01 00:00:00' at time zone 'Europe/Stockholm';
  v_end := timestamp '2099-02-01 00:00:00' at time zone 'Europe/Stockholm';

  insert into public.spot_price_daily_summaries(
    source,price_area,price_date,average_sek_per_kwh,min_sek_per_kwh,max_sek_per_kwh,
    interval_count,status,period_start,period_end,expected_interval_count,
    covered_duration_minutes,expected_duration_minutes,resolution,quality_issues,
    provider_fetched_at,verified_at,source_checksum
  )
  select
    'pr164-cross-boundary','SE1',d::date,1,1,1,
    case when d::date=date '2099-01-01' then 1 else 0 end,
    'verified',
    d at time zone 'Europe/Stockholm',
    (d + interval '1 day') at time zone 'Europe/Stockholm',
    case when d::date=date '2099-01-01' then 1 else 0 end,
    extract(epoch from (((d + interval '1 day') at time zone 'Europe/Stockholm') - (d at time zone 'Europe/Stockholm')))::integer / 60,
    extract(epoch from (((d + interval '1 day') at time zone 'Europe/Stockholm') - (d at time zone 'Europe/Stockholm')))::integer / 60,
    'hourly','[]'::jsonb,now(),now(),md5('pr164-cross-boundary:' || d::text)
  from generate_series(timestamp '2099-01-01 00:00:00', timestamp '2099-01-31 00:00:00', interval '1 day') d;

  insert into public.spot_price_intervals(source,price_area,time_start,time_end,sek_per_kwh,resolution)
  values('pr164-cross-boundary','SE1',v_start,v_end + interval '1 hour',1,'hourly');

  select * into v_month
  from private.gridex_recompute_spot_price_month_v1('pr164-cross-boundary','SE1','2099-01');

  if v_month.status <> 'verified'
     or v_month.interval_count <> 1
     or v_month.expected_interval_count <> 1
     or v_month.covered_duration_minutes <> v_month.expected_duration_minutes then
    raise exception 'pr164_cross_boundary_month_not_complete:%',row_to_json(v_month);
  end if;

  -- Full February with exact month-end boundary is also complete.
  v_start := timestamp '2099-02-01 00:00:00' at time zone 'Europe/Stockholm';
  v_end := timestamp '2099-03-01 00:00:00' at time zone 'Europe/Stockholm';

  insert into public.spot_price_daily_summaries(
    source,price_area,price_date,average_sek_per_kwh,min_sek_per_kwh,max_sek_per_kwh,
    interval_count,status,period_start,period_end,expected_interval_count,
    covered_duration_minutes,expected_duration_minutes,resolution,quality_issues,
    provider_fetched_at,verified_at,source_checksum
  )
  select
    'pr164-full-month','SE1',d::date,1,1,1,
    case when d::date=date '2099-02-01' then 1 else 0 end,
    'verified',
    d at time zone 'Europe/Stockholm',
    (d + interval '1 day') at time zone 'Europe/Stockholm',
    case when d::date=date '2099-02-01' then 1 else 0 end,
    extract(epoch from (((d + interval '1 day') at time zone 'Europe/Stockholm') - (d at time zone 'Europe/Stockholm')))::integer / 60,
    extract(epoch from (((d + interval '1 day') at time zone 'Europe/Stockholm') - (d at time zone 'Europe/Stockholm')))::integer / 60,
    'hourly','[]'::jsonb,now(),now(),md5('pr164-full-month:' || d::text)
  from generate_series(timestamp '2099-02-01 00:00:00', timestamp '2099-02-28 00:00:00', interval '1 day') d;

  insert into public.spot_price_intervals(source,price_area,time_start,time_end,sek_per_kwh,resolution)
  values('pr164-full-month','SE1',v_start,v_end,1,'hourly');

  select * into v_month
  from private.gridex_recompute_spot_price_month_v1('pr164-full-month','SE1','2099-02');

  if v_month.status <> 'verified'
     or v_month.covered_duration_minutes <> v_month.expected_duration_minutes then
    raise exception 'pr164_full_month_not_complete:%',row_to_json(v_month);
  end if;

  -- Direct monthly INSERT must persist the row operation while canonicalizing aggregate fields.
  v_start := timestamp '2099-03-01 00:00:00' at time zone 'Europe/Stockholm';
  v_end := timestamp '2099-04-01 00:00:00' at time zone 'Europe/Stockholm';

  insert into public.spot_price_daily_summaries(
    source,price_area,price_date,average_sek_per_kwh,min_sek_per_kwh,max_sek_per_kwh,
    interval_count,status,period_start,period_end,expected_interval_count,
    covered_duration_minutes,expected_duration_minutes,resolution,quality_issues,
    provider_fetched_at,verified_at,source_checksum
  )
  select
    'pr164-direct-write','SE1',d::date,1,1,1,
    case when d::date=date '2099-03-01' then 1 else 0 end,
    'verified',
    d at time zone 'Europe/Stockholm',
    (d + interval '1 day') at time zone 'Europe/Stockholm',
    case when d::date=date '2099-03-01' then 1 else 0 end,
    extract(epoch from (((d + interval '1 day') at time zone 'Europe/Stockholm') - (d at time zone 'Europe/Stockholm')))::integer / 60,
    extract(epoch from (((d + interval '1 day') at time zone 'Europe/Stockholm') - (d at time zone 'Europe/Stockholm')))::integer / 60,
    'hourly','[]'::jsonb,now(),now(),md5('pr164-direct-write:' || d::text)
  from generate_series(timestamp '2099-03-01 00:00:00', timestamp '2099-03-31 00:00:00', interval '1 day') d;

  insert into public.spot_price_intervals(source,price_area,time_start,time_end,sek_per_kwh,resolution)
  values('pr164-direct-write','SE1',v_start,v_end,1,'hourly');

  insert into public.spot_price_monthly_summaries(
    source,price_area,billing_month,average_sek_per_kwh,min_sek_per_kwh,max_sek_per_kwh,
    interval_count,expected_interval_count,status,lock_reason
  ) values (
    'pr164-direct-write','SE1','2099-03',999,999,999,999,999,'incomplete','insert-marker'
  );

  select * into v_month
  from public.spot_price_monthly_summaries
  where source='pr164-direct-write' and price_area='SE1' and billing_month='2099-03';

  if v_month.lock_reason is distinct from 'insert-marker'
     or v_month.average_sek_per_kwh <> 1
     or v_month.status <> 'verified' then
    raise exception 'pr164_direct_insert_not_persisted_or_not_canonical:%',row_to_json(v_month);
  end if;

  update public.spot_price_monthly_summaries
  set average_sek_per_kwh=777,
      lock_reason='update-marker'
  where source='pr164-direct-write' and price_area='SE1' and billing_month='2099-03';

  select * into v_month
  from public.spot_price_monthly_summaries
  where source='pr164-direct-write' and price_area='SE1' and billing_month='2099-03';

  if v_month.lock_reason is distinct from 'update-marker'
     or v_month.average_sek_per_kwh <> 1 then
    raise exception 'pr164_direct_update_not_persisted_or_not_canonical:%',row_to_json(v_month);
  end if;

  update public.spot_price_monthly_summaries
  set status='locked',locked_at=now(),lock_reason='locked-marker'
  where source='pr164-direct-write' and price_area='SE1' and billing_month='2099-03';

  if not exists(
    select 1 from public.spot_price_monthly_summaries
    where source='pr164-direct-write' and price_area='SE1' and billing_month='2099-03'
      and status='locked' and locked_at is not null and lock_reason='locked-marker'
  ) then
    raise exception 'pr164_month_lock_update_not_persisted';
  end if;

  -- Job claiming: first claim and stale reclaim each increment attempts.
  insert into public.companies(id,name,slug,status,lifecycle_status)
  values(v_company_id,'PR164 Regression AB','pr164-regression','active','active');

  insert into public.customers(id,company_id,customer_type,status,name,email,is_test_data)
  values(v_customer_id,v_company_id,'private','active','PR164 Regression Customer','pr164@example.invalid',true);

  insert into public.customer_operation_jobs(
    id,company_id,customer_id,job_type,status,priority,idempotency_key,attempts,max_attempts,run_after
  ) values (
    v_job_id,v_company_id,v_customer_id,'pr164_regression','queued',-32768,'pr164:claim',0,3,now()-interval '1 minute'
  );

  select * into v_claimed
  from public.gridex_claim_customer_operation_jobs('pr164-worker',1)
  where id=v_job_id;
  if v_claimed.id is null or v_claimed.attempts <> 1 or v_claimed.status <> 'running' then
    raise exception 'pr164_first_claim_failed:%',row_to_json(v_claimed);
  end if;

  update public.customer_operation_jobs
  set locked_at=now()-interval '20 minutes',heartbeat_at=now()-interval '20 minutes'
  where id=v_job_id;
  select * into v_claimed
  from public.gridex_claim_customer_operation_jobs('pr164-worker',1)
  where id=v_job_id;
  if v_claimed.id is null or v_claimed.attempts <> 2 then
    raise exception 'pr164_stale_reclaim_did_not_increment:%',row_to_json(v_claimed);
  end if;

  update public.customer_operation_jobs
  set locked_at=now()-interval '20 minutes',heartbeat_at=now()-interval '20 minutes'
  where id=v_job_id;
  select * into v_claimed
  from public.gridex_claim_customer_operation_jobs('pr164-worker',1)
  where id=v_job_id;
  if v_claimed.id is null or v_claimed.attempts <> 3 then
    raise exception 'pr164_last_allowed_attempt_failed:%',row_to_json(v_claimed);
  end if;

  update public.customer_operation_jobs
  set locked_at=now()-interval '20 minutes',heartbeat_at=now()-interval '20 minutes'
  where id=v_job_id;
  select count(*) into v_claim_count
  from public.gridex_claim_customer_operation_jobs('pr164-worker',1)
  where id=v_job_id;

  if v_claim_count <> 0 or not exists(
    select 1 from public.customer_operation_jobs
    where id=v_job_id and attempts=3 and status='failed'
      and locked_at is null and locked_by is null and lock_token is null
  ) then
    raise exception 'pr164_retry_ceiling_not_terminalized';
  end if;

  -- A queued job already at its ceiling must never be claimed and must become terminal.
  insert into public.customer_operation_jobs(
    id,company_id,customer_id,job_type,status,priority,idempotency_key,attempts,max_attempts,run_after
  ) values (
    v_capped_job_id,v_company_id,v_customer_id,'pr164_regression','queued',-32768,'pr164:capped',1,1,now()-interval '1 minute'
  );

  select count(*) into v_claim_count
  from public.gridex_claim_customer_operation_jobs('pr164-worker',10)
  where id=v_capped_job_id;

  if v_claim_count <> 0 or not exists(
    select 1 from public.customer_operation_jobs
    where id=v_capped_job_id and attempts=1 and status='failed'
  ) then
    raise exception 'pr164_queued_retry_ceiling_not_terminalized';
  end if;
end;
$regression$;

rollback;
