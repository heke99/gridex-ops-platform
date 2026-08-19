-- PR #164 forward-only remediation v2.
-- Keeps applied history immutable and replaces the current function definitions.

create or replace function private.gridex_calculate_spot_price_month_v1(
  p_source text,
  p_price_area text,
  p_billing_month text
)
returns table(
  period_start timestamptz,
  period_end timestamptz,
  average_sek_per_kwh numeric,
  min_sek_per_kwh numeric,
  max_sek_per_kwh numeric,
  interval_count integer,
  expected_interval_count integer,
  covered_duration_minutes bigint,
  expected_duration_minutes bigint,
  quality_issues jsonb,
  provider_fetched_at timestamptz,
  verified_at timestamptz,
  status text,
  source_checksum text,
  updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path to 'public','extensions','pg_catalog','pg_temp'
as $$
declare
  v_month_start_date date;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_expected_days integer;
  v_verified_days integer;
  v_expected_intervals integer;
  v_actual_intervals integer;
  v_expected_minutes bigint;
  v_covered_minutes bigint;
  v_avg numeric;
  v_min numeric;
  v_max numeric;
  v_checksum text;
  v_complete boolean;
  v_now timestamptz := now();
begin
  if p_source is null or nullif(btrim(p_price_area),'') is null
     or p_billing_month !~ '^\d{4}-\d{2}$' then
    raise exception using errcode='22023',message='spot_month_scope_invalid';
  end if;

  v_month_start_date := to_date(p_billing_month || '-01','YYYY-MM-DD');
  v_period_start := (v_month_start_date::timestamp at time zone 'Europe/Stockholm');
  v_period_end := ((v_month_start_date + interval '1 month')::timestamp at time zone 'Europe/Stockholm');
  v_expected_minutes := extract(epoch from (v_period_end-v_period_start))::bigint / 60;

  select
    count(*)::integer,
    coalesce(sum(d.expected_interval_count),0)::integer,
    count(*) filter (where d.status in ('verified','locked'))::integer
  into v_expected_days,v_expected_intervals,v_verified_days
  from public.spot_price_daily_summaries d
  where d.source=p_source
    and d.price_area=p_price_area
    and d.price_date>=v_month_start_date
    and d.price_date<(v_month_start_date + interval '1 month')::date;

  select
    count(*)::integer,
    avg(i.sek_per_kwh),
    min(i.sek_per_kwh),
    max(i.sek_per_kwh),
    coalesce(sum(extract(epoch from (
      least(i.time_end,v_period_end)-greatest(i.time_start,v_period_start)
    ))/60),0)::bigint,
    encode(
      digest(
        coalesce(string_agg(
          concat_ws('|',i.time_start::text,i.time_end::text,i.sek_per_kwh::text),
          '||' order by i.time_start,i.time_end
        ),''),
        'sha256'
      ),
      'hex'
    )
  into v_actual_intervals,v_avg,v_min,v_max,v_covered_minutes,v_checksum
  from public.spot_price_intervals i
  where i.source=p_source
    and i.price_area=p_price_area
    and i.time_start>=v_period_start
    and i.time_start<v_period_end;

  v_complete :=
    v_expected_days = extract(day from ((v_month_start_date + interval '1 month' - interval '1 day')::date))::integer
    and v_verified_days = v_expected_days
    and v_expected_intervals > 0
    and v_actual_intervals = v_expected_intervals
    and v_covered_minutes = v_expected_minutes;

  return query select
    v_period_start,
    v_period_end,
    v_avg,
    v_min,
    v_max,
    v_actual_intervals,
    v_expected_intervals,
    v_covered_minutes,
    v_expected_minutes,
    case when v_complete then '[]'::jsonb else jsonb_build_array(jsonb_build_object('code','incomplete_month_coverage')) end,
    v_now,
    case when v_complete then v_now else null end,
    case when v_complete then 'verified' else 'incomplete' end,
    v_checksum,
    v_now;
end
$$;

revoke all on function private.gridex_calculate_spot_price_month_v1(text,text,text)
  from public,anon,authenticated,service_role;

create or replace function private.gridex_recompute_spot_price_month_v1(
  p_source text,
  p_price_area text,
  p_billing_month text
)
returns public.spot_price_monthly_summaries
language plpgsql
security definer
set search_path to 'public','private','extensions','pg_catalog','pg_temp'
as $$
declare
  v_calc record;
  v_row public.spot_price_monthly_summaries%rowtype;
begin
  select * into strict v_calc
  from private.gridex_calculate_spot_price_month_v1(p_source,p_price_area,p_billing_month);

  insert into public.spot_price_monthly_summaries(
    source,price_area,billing_month,period_start,period_end,
    average_sek_per_kwh,min_sek_per_kwh,max_sek_per_kwh,
    interval_count,expected_interval_count,
    covered_duration_minutes,expected_duration_minutes,
    quality_issues,provider_fetched_at,verified_at,status,source_checksum,updated_at
  ) values (
    p_source,p_price_area,p_billing_month,v_calc.period_start,v_calc.period_end,
    v_calc.average_sek_per_kwh,v_calc.min_sek_per_kwh,v_calc.max_sek_per_kwh,
    v_calc.interval_count,v_calc.expected_interval_count,
    v_calc.covered_duration_minutes,v_calc.expected_duration_minutes,
    v_calc.quality_issues,v_calc.provider_fetched_at,v_calc.verified_at,
    v_calc.status,v_calc.source_checksum,v_calc.updated_at
  )
  on conflict(source,price_area,billing_month) do update set
    period_start=excluded.period_start,
    period_end=excluded.period_end,
    average_sek_per_kwh=excluded.average_sek_per_kwh,
    min_sek_per_kwh=excluded.min_sek_per_kwh,
    max_sek_per_kwh=excluded.max_sek_per_kwh,
    interval_count=excluded.interval_count,
    expected_interval_count=excluded.expected_interval_count,
    covered_duration_minutes=excluded.covered_duration_minutes,
    expected_duration_minutes=excluded.expected_duration_minutes,
    quality_issues=excluded.quality_issues,
    provider_fetched_at=excluded.provider_fetched_at,
    verified_at=excluded.verified_at,
    status=excluded.status,
    source_checksum=excluded.source_checksum,
    updated_at=excluded.updated_at
  where public.spot_price_monthly_summaries.locked_at is null
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from public.spot_price_monthly_summaries
    where source=p_source and price_area=p_price_area and billing_month=p_billing_month;
  end if;
  return v_row;
end
$$;

revoke all on function private.gridex_recompute_spot_price_month_v1(text,text,text)
  from public,anon,authenticated,service_role;

create or replace function private.gridex_normalize_fixed_area_snapshot_v1(p_snapshot jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path to 'pg_catalog'
as $$
with input as (
  select coalesce(p_snapshot,'{}'::jsonb) s,
         upper(nullif(coalesce(p_snapshot->>'price_area',p_snapshot->>'priceArea'),'')) selected_area
), arrays as (
  select s,selected_area,
         case
           when jsonb_typeof(s->'base_price_components_snapshot')='array' then s->'base_price_components_snapshot'
           when jsonb_typeof(s->'base_components')='array' then s->'base_components'
           else null
         end arr
  from input
), elems as (
  select a.s,a.selected_area,e.value,e.ord,
         lower(coalesce(e.value->>'source_type',e.value->>'sourceType','')) source_type,
         upper(nullif(coalesce(e.value->>'price_area',e.value->>'priceArea'),'')) component_area
  from arrays a
  left join lateral jsonb_array_elements(coalesce(a.arr,'[]'::jsonb)) with ordinality e(value,ord) on true
), selected_fixed as (
  select min(ord) ord
  from elems
  where source_type='fixed'
    and component_area=selected_area
    and selected_area in ('SE1','SE2','SE3','SE4')
), kept as (
  select e.*
  from elems e cross join selected_fixed f
  where e.value is not null
    and (
      e.source_type<>'fixed'
      or e.component_area is null
      or (e.component_area=e.selected_area and e.ord=f.ord)
    )
), rebuilt as (
  select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) arr
  from kept
)
select case
  when p_snapshot is null then '{}'::jsonb
  when coalesce((select selected_area from arrays),'') not in ('SE1','SE2','SE3','SE4')
       or (select arr from arrays) is null then p_snapshot
  else
    (p_snapshot || jsonb_build_object('base_price_components_snapshot',(select arr from rebuilt)))
    || case when p_snapshot ? 'base_components'
            then jsonb_build_object('base_components',(select arr from rebuilt))
            else '{}'::jsonb end
end;
$$;

revoke all on function private.gridex_normalize_fixed_area_snapshot_v1(jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.gridex_enforce_spot_price_month_server_aggregate_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','private','extensions','pg_catalog','pg_temp'
as $$
declare
  v_calc record;
begin
  if tg_op='UPDATE' then
    if old.status='locked' then
      return new;
    end if;

    -- Locking/annotation-only updates must be persisted verbatim.
    if (to_jsonb(new) - array['status','locked_at','locked_by','lock_reason','updated_at'])
       = (to_jsonb(old) - array['status','locked_at','locked_by','lock_reason','updated_at'])
       and (
         new.status is distinct from old.status
         or new.locked_at is distinct from old.locked_at
         or new.locked_by is distinct from old.locked_by
         or new.lock_reason is distinct from old.lock_reason
       ) then
      return new;
    end if;
  end if;

  -- Canonicalize aggregate fields in NEW instead of replacing/cancelling the row operation.
  select * into strict v_calc
  from private.gridex_calculate_spot_price_month_v1(new.source,new.price_area,new.billing_month);

  new.period_start := v_calc.period_start;
  new.period_end := v_calc.period_end;
  new.average_sek_per_kwh := v_calc.average_sek_per_kwh;
  new.min_sek_per_kwh := v_calc.min_sek_per_kwh;
  new.max_sek_per_kwh := v_calc.max_sek_per_kwh;
  new.interval_count := v_calc.interval_count;
  new.expected_interval_count := v_calc.expected_interval_count;
  new.covered_duration_minutes := v_calc.covered_duration_minutes;
  new.expected_duration_minutes := v_calc.expected_duration_minutes;
  new.quality_issues := v_calc.quality_issues;
  new.provider_fetched_at := v_calc.provider_fetched_at;
  new.verified_at := v_calc.verified_at;
  new.status := v_calc.status;
  new.source_checksum := v_calc.source_checksum;
  new.updated_at := v_calc.updated_at;

  return new;
end
$$;

revoke all on function public.gridex_enforce_spot_price_month_server_aggregate_v1()
  from public,anon,authenticated;

create or replace function public.gridex_claim_customer_operation_jobs(
  p_worker_id text,
  p_limit integer default 20
)
returns setof public.customer_operation_jobs
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $$
begin
  -- Terminalize jobs that have exhausted retries instead of leaving stale running rows forever.
  update public.customer_operation_jobs jobs
  set status='failed',
      last_error=coalesce(jobs.last_error,'customer_operation_retry_exhausted'),
      last_error_code=coalesce(jobs.last_error_code,'retry_exhausted'),
      last_error_message=coalesce(jobs.last_error_message,'Customer operation retry limit exhausted'),
      stale_reason=case when jobs.status='running'
        then coalesce(jobs.stale_reason,'retry_exhausted_after_stale_lock')
        else jobs.stale_reason end,
      completed_at=coalesce(jobs.completed_at,now()),
      locked_at=null,
      locked_by=null,
      lock_token=null,
      heartbeat_at=null,
      updated_at=now()
  from public.companies company
  where company.id=jobs.company_id
    and company.status in ('active','onboarding')
    and coalesce(jobs.lifecycle_blocked_by_tenant,false)=false
    and jobs.attempts>=jobs.max_attempts
    and (
      (jobs.status='queued' and jobs.run_after<=now())
      or
      (jobs.status='running' and (
        jobs.locked_at is null
        or jobs.lock_token is null
        or jobs.locked_at<now()-interval '15 minutes'
      ))
    );

  return query
  with candidates as (
    select jobs.id
    from public.customer_operation_jobs jobs
    join public.companies company on company.id=jobs.company_id
    where company.status in ('active','onboarding')
      and coalesce(jobs.lifecycle_blocked_by_tenant,false)=false
      and jobs.attempts < jobs.max_attempts
      and (
        (
          jobs.status='queued'
          and jobs.run_after<=now()
          and (jobs.locked_at is null or jobs.lock_token is null or jobs.locked_at<now()-interval '15 minutes')
        )
        or
        (
          jobs.status='running'
          and (jobs.locked_at is null or jobs.lock_token is null or jobs.locked_at<now()-interval '15 minutes')
        )
      )
    order by jobs.priority asc,jobs.run_after asc,jobs.created_at asc
    for update of jobs skip locked
    limit greatest(1,least(coalesce(p_limit,20),100))
  )
  update public.customer_operation_jobs jobs
  set status='running',
      attempts=jobs.attempts+1,
      locked_at=now(),
      locked_by=nullif(trim(p_worker_id),''),
      lock_token=gen_random_uuid(),
      heartbeat_at=now(),
      last_error=case when jobs.status='running'
        then coalesce(jobs.last_error,'stale_customer_operation_lock_reclaimed')
        else jobs.last_error end,
      updated_at=now()
  from candidates
  where jobs.id=candidates.id
  returning jobs.*;
end
$$;
