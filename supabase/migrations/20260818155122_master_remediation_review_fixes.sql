-- Forward-only fixes for verified production remediation review findings.
-- This migration intentionally preserves already-applied migration history.

begin;

create or replace function private.gridex_recompute_spot_price_month_v1(
  p_source text,
  p_price_area text,
  p_billing_month text
)
returns public.spot_price_monthly_summaries
language plpgsql
security definer
set search_path to 'public','extensions','pg_catalog','pg_temp'
as $$
declare
  v_month_start_date date;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_expected_days int;
  v_verified_days int;
  v_expected_intervals int;
  v_actual_intervals int;
  v_expected_minutes bigint;
  v_covered_minutes bigint;
  v_avg numeric;
  v_min numeric;
  v_max numeric;
  v_checksum text;
  v_complete boolean;
  v_now timestamptz := now();
  v_row public.spot_price_monthly_summaries%rowtype;
begin
  if p_source is null or nullif(btrim(p_price_area),'') is null
     or p_billing_month !~ '^\d{4}-\d{2}$' then
    raise exception using errcode='22023', message='spot_month_scope_invalid';
  end if;

  v_month_start_date := to_date(p_billing_month || '-01','YYYY-MM-DD');
  v_period_start := (v_month_start_date::timestamp at time zone 'Europe/Stockholm');
  v_period_end := ((v_month_start_date + interval '1 month')::timestamp at time zone 'Europe/Stockholm');
  v_expected_minutes := extract(epoch from (v_period_end-v_period_start))::bigint / 60;

  select
    count(*)::int,
    coalesce(sum(expected_interval_count),0)::int,
    count(*) filter (where status in ('verified','locked'))::int
  into v_expected_days, v_expected_intervals, v_verified_days
  from public.spot_price_daily_summaries
  where source=p_source
    and price_area=p_price_area
    and price_date>=v_month_start_date
    and price_date<(v_month_start_date + interval '1 month')::date;

  select
    count(*)::int,
    avg(sek_per_kwh),
    min(sek_per_kwh),
    max(sek_per_kwh),
    coalesce(sum(extract(epoch from (
      least(time_end,v_period_end)-greatest(time_start,v_period_start)
    ))/60),0)::bigint,
    encode(
      digest(
        coalesce(string_agg(
          concat_ws('|',time_start::text,time_end::text,sek_per_kwh::text),
          '||' order by time_start,time_end
        ),''),
        'sha256'
      ),
      'hex'
    )
  into v_actual_intervals,v_avg,v_min,v_max,v_covered_minutes,v_checksum
  from public.spot_price_intervals
  where source=p_source
    and price_area=p_price_area
    and time_start>=v_period_start
    and time_start<v_period_end;

  v_complete :=
    v_expected_days = extract(day from ((v_month_start_date + interval '1 month' - interval '1 day')::date))::int
    and v_verified_days = v_expected_days
    and v_expected_intervals > 0
    and v_actual_intervals = v_expected_intervals
    and v_covered_minutes = v_expected_minutes;

  insert into public.spot_price_monthly_summaries(
    source,price_area,billing_month,period_start,period_end,
    average_sek_per_kwh,min_sek_per_kwh,max_sek_per_kwh,
    interval_count,expected_interval_count,
    covered_duration_minutes,expected_duration_minutes,
    quality_issues,provider_fetched_at,verified_at,status,source_checksum,updated_at
  ) values (
    p_source,p_price_area,p_billing_month,v_period_start,v_period_end,
    v_avg,v_min,v_max,v_actual_intervals,v_expected_intervals,
    v_covered_minutes,v_expected_minutes,
    case when v_complete then '[]'::jsonb else jsonb_build_array(jsonb_build_object('code','incomplete_month_coverage')) end,
    v_now,case when v_complete then v_now else null end,
    case when v_complete then 'verified' else 'incomplete' end,
    v_checksum,v_now
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

create or replace function public.gridex_enforce_spot_price_month_server_aggregate_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','private','extensions','pg_catalog','pg_temp'
as $$
begin
  if tg_op='UPDATE' then
    if old.status='locked' then
      return new;
    end if;

    -- Locking/annotation is not an aggregate rewrite. Let it pass through.
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

  -- Direct aggregate writes are replaced by the authoritative server aggregate.
  perform private.gridex_recompute_spot_price_month_v1(
    new.source,
    new.price_area,
    new.billing_month
  );

  return null;
end
$$;

revoke all on function public.gridex_enforce_spot_price_month_server_aggregate_v1()
  from public,anon,authenticated;

create or replace function private.gridex_normalize_fixed_area_snapshot_v1(p_snapshot jsonb)
returns jsonb
language sql
immutable
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

create or replace function public.gridex_claim_customer_operation_jobs(
  p_worker_id text,
  p_limit integer default 20
)
returns setof public.customer_operation_jobs
language plpgsql
security definer
set search_path to 'public'
as $$
begin
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
      last_error=case when jobs.status='running'
        then coalesce(jobs.last_error,'stale_customer_operation_lock_reclaimed')
        else jobs.last_error end,
      updated_at=now()
  from candidates
  where jobs.id=candidates.id
  returning jobs.*;
end
$$;

commit;
