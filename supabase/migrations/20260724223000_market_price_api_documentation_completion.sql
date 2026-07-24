-- Canonical current market-price API and preview evidence completion.
-- Additive migration for public API contract 2026-07-24.2.
begin;

set local lock_timeout = '15s';
set local statement_timeout = '20min';
set local idle_in_transaction_session_timeout = '2min';

select pg_advisory_xact_lock(
  hashtextextended('gridex:market-price-api-docs:20260724223000', 0)
);

alter table if exists public.market_price_previews
  add column if not exists source_as_of timestamptz,
  add column if not exists generated_at timestamptz,
  add column if not exists requested_days integer,
  add column if not exists included_days integer,
  add column if not exists source_resolution text;

update public.market_price_previews
set source_as_of = coalesce(source_as_of, as_of),
    generated_at = coalesce(generated_at, created_at, updated_at, as_of),
    requested_days = coalesce(
      requested_days,
      case
        when jsonb_typeof(metadata) = 'object' and metadata ? 'requested_days'
          then nullif(metadata->>'requested_days', '')::integer
        when reference_period = 'rolling_7_days' then 7
        when reference_period = 'rolling_30_days' then 30
        when reference_period = 'latest_complete_day' then 1
        else null
      end
    ),
    included_days = coalesce(
      included_days,
      case
        when jsonb_typeof(metadata) = 'object' and metadata ? 'included_days'
          then nullif(metadata->>'included_days', '')::integer
        when cardinality(source_summary_ids) > 0 then cardinality(source_summary_ids)
        else null
      end
    ),
    source_resolution = coalesce(
      source_resolution,
      case when jsonb_typeof(metadata) = 'object' then nullif(metadata->>'source_resolution', '') else null end,
      'daily'
    )
where source_as_of is null
   or generated_at is null
   or requested_days is null
   or included_days is null
   or source_resolution is null;

alter table if exists public.market_price_previews
  alter column source_as_of set not null,
  alter column generated_at set not null;

alter table if exists public.market_price_previews
  drop constraint if exists market_price_previews_window_check;
alter table if exists public.market_price_previews
  add constraint market_price_previews_window_check check (
    requested_days is null or requested_days > 0
  ) not valid;
alter table if exists public.market_price_previews
  drop constraint if exists market_price_previews_included_days_check;
alter table if exists public.market_price_previews
  add constraint market_price_previews_included_days_check check (
    included_days is null or (
      included_days > 0 and
      (requested_days is null or included_days <= requested_days)
    )
  ) not valid;

create index if not exists market_price_previews_source_freshness_idx
  on public.market_price_previews(provider, price_area, reference_period, source_as_of desc)
  where status = 'active';

-- V2 is intentionally a new signature/name. Do not replace the V1 return type.
create or replace function public.gridex_publish_market_price_preview_v2(
  p_provider text,
  p_price_area text,
  p_reference_period text,
  p_period_start date,
  p_period_end date,
  p_source_as_of timestamptz,
  p_generated_at timestamptz,
  p_price_sek_per_kwh numeric,
  p_stale_after timestamptz,
  p_requested_days integer,
  p_included_days integer,
  p_fallback_used boolean default false,
  p_fallback_reason text default null,
  p_source_summary_ids uuid[] default '{}'::uuid[],
  p_source_checksum text default null,
  p_source_resolution text default 'daily',
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_active public.market_price_previews%rowtype;
  v_id uuid;
  v_provider text := lower(trim(p_provider));
  v_area text := upper(trim(p_price_area));
  v_now timestamptz := now();
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'market_preview_publish_service_role_required' using errcode='42501';
  end if;
  if v_area not in ('SE1','SE2','SE3','SE4')
     or p_reference_period not in ('latest_complete_day','rolling_7_days','rolling_30_days','month_to_date','forecast')
     or p_period_end < p_period_start
     or p_source_as_of is null
     or p_generated_at is null
     or p_stale_after <= p_generated_at
     or p_price_sek_per_kwh is null
     or p_requested_days is null or p_requested_days <= 0
     or p_included_days is null or p_included_days <= 0 or p_included_days > p_requested_days then
    raise exception 'invalid_market_preview' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_provider||':'||v_area||':'||p_reference_period,0)
  );

  select * into v_active
  from public.market_price_previews m
  where m.provider = v_provider
    and m.price_area = v_area
    and m.reference_period = p_reference_period
    and m.status = 'active'
  for update;

  if found
     and v_active.source_checksum is not distinct from p_source_checksum
     and v_active.source_as_of is not distinct from p_source_as_of
     and v_active.price_sek_per_kwh is not distinct from p_price_sek_per_kwh
     and v_active.period_start = p_period_start
     and v_active.period_end = p_period_end
     and v_active.requested_days is not distinct from p_requested_days
     and v_active.included_days is not distinct from p_included_days
     and v_active.fallback_used is not distinct from coalesce(p_fallback_used,false)
     and v_active.fallback_reason is not distinct from nullif(btrim(p_fallback_reason),'') then
    return jsonb_build_object(
      'created', false,
      'unchanged', true,
      'preview_id', v_active.id,
      'source_checksum', v_active.source_checksum
    );
  end if;

  update public.market_price_previews
  set status='superseded', updated_at=v_now
  where provider=v_provider
    and price_area=v_area
    and reference_period=p_reference_period
    and status='active';

  insert into public.market_price_previews(
    provider,price_area,reference_period,period_start,period_end,
    as_of,source_as_of,generated_at,price_sek_per_kwh,stale_after,
    requested_days,included_days,status,fallback_used,fallback_reason,
    source_summary_ids,source_checksum,source_resolution,metadata,updated_at
  ) values (
    v_provider,v_area,p_reference_period,p_period_start,p_period_end,
    p_source_as_of,p_source_as_of,p_generated_at,p_price_sek_per_kwh,p_stale_after,
    p_requested_days,p_included_days,'active',coalesce(p_fallback_used,false),
    nullif(btrim(p_fallback_reason),''),coalesce(p_source_summary_ids,'{}'::uuid[]),
    p_source_checksum,coalesce(nullif(btrim(p_source_resolution),''),'daily'),
    coalesce(p_metadata,'{}'::jsonb),v_now
  ) returning id into v_id;

  return jsonb_build_object(
    'created', true,
    'unchanged', false,
    'preview_id', v_id,
    'source_checksum', p_source_checksum
  );
end;
$$;

revoke all on function public.gridex_publish_market_price_preview_v2(
  text,text,text,date,date,timestamptz,timestamptz,numeric,timestamptz,
  integer,integer,boolean,text,uuid[],text,text,jsonb
) from public,anon,authenticated;
grant execute on function public.gridex_publish_market_price_preview_v2(
  text,text,text,date,date,timestamptz,timestamptz,numeric,timestamptz,
  integer,integer,boolean,text,uuid[],text,text,jsonb
) to service_role;


-- Ordinary canonical website keys receive this additive read scope. No new
-- secret, tenant id or ENV variable is required by the tenant.
insert into public.integration_api_permission_groups(
  group_key,label,description,category,scopes,recommended_default,risk_level,sort_order
) values (
  'website_market_prices',
  'Läs aktuellt spotpris',
  'Hemsidan kan läsa aktuellt normaliserat spotpris för det SE-område som OPS bundit till resolution_id.',
  'website',
  array['website_market_prices.read']::text[],
  true,
  'low',
  9
)
on conflict(group_key) do update set
  label=excluded.label,
  description=excluded.description,
  category=excluded.category,
  scopes=excluded.scopes,
  recommended_default=excluded.recommended_default,
  risk_level=excluded.risk_level,
  sort_order=excluded.sort_order,
  is_active=true,
  updated_at=now();

update public.integration_api_client_profiles
set default_scopes = array(
      select distinct scope
      from unnest(coalesce(default_scopes,'{}'::text[]) || array['website_market_prices.read']::text[]) scope
      order by scope
    ),
    updated_at=now()
where key in ('website_signup','tenant_website');

update public.integration_api_clients c
set scopes = array(
      select distinct scope
      from unnest(coalesce(c.scopes,'{}'::text[]) || array['website_market_prices.read']::text[]) scope
      order by scope
    ),
    updated_at=now(),
    metadata=coalesce(c.metadata,'{}'::jsonb) || jsonb_build_object(
      'market_price_api_contract_version','2026-07-24.2',
      'market_price_scope_backfilled_at',now()
    )
where c.status='active'
  and not ('*'=any(coalesce(c.scopes,'{}'::text[])))
  and (
    c.profile_key in ('website_signup','tenant_website')
    or 'website_quotes.write'=any(coalesce(c.scopes,'{}'::text[]))
    or 'website_energy_area.resolve'=any(coalesce(c.scopes,'{}'::text[]))
  );

create or replace view public.gridex_market_preview_coverage_v
with (security_invoker=true) as
select
  provider,
  price_area,
  reference_period,
  period_start,
  period_end,
  requested_days,
  included_days,
  fallback_used,
  fallback_reason,
  source_as_of,
  generated_at,
  stale_after,
  now() > stale_after as globally_stale,
  source_checksum,
  status
from public.market_price_previews;

revoke all on public.gridex_market_preview_coverage_v from public,anon,authenticated;
grant select on public.gridex_market_preview_coverage_v to service_role;


-- Canonical operational readiness for the public market-price flow. This view
-- contains only aggregate counts and no tenant/customer data.
create or replace view public.gridex_market_price_readiness_v
with (security_invoker=true) as
with
  stockholm_clock as (
    select
      (now() at time zone 'Europe/Stockholm')::date as current_date,
      ((now() at time zone 'Europe/Stockholm')::date - 1) as previous_date
  ),
  areas(price_area) as (
    values ('SE1'::text),('SE2'::text),('SE3'::text),('SE4'::text)
  ),
  current_missing as (
    select count(*)::bigint as issue_count
    from areas a cross join stockholm_clock c
    left join public.spot_price_daily_summaries d
      on d.source='elprisetjustnu'
     and d.price_area=a.price_area
     and d.price_date=c.current_date
     and d.status in ('verified','locked')
    where d.id is null
  ),
  previous_missing as (
    select count(*)::bigint as issue_count
    from areas a cross join stockholm_clock c
    left join public.spot_price_daily_summaries d
      on d.source='elprisetjustnu'
     and d.price_area=a.price_area
     and d.price_date=c.previous_date
     and d.status in ('verified','locked')
    where d.id is null
  ),
  incomplete_window as (
    select count(*)::bigint as issue_count
    from areas a
    left join public.market_price_previews p
      on p.provider='elprisetjustnu'
     and p.price_area=a.price_area
     and p.reference_period='rolling_30_days'
     and p.status='active'
    where p.id is null
       or p.requested_days is distinct from 30
       or p.included_days is null
       or p.included_days < 30
       or p.fallback_used=true
  ),
  stale_preview as (
    select count(*)::bigint as issue_count
    from public.market_price_previews p
    where p.status='active' and now() > p.stale_after
  ),
  policy_conflict as (
    select count(*)::bigint as issue_count
    from public.company_market_price_sources s
    join public.market_price_previews p
      on p.provider=s.source_key
     and p.status='active'
     and p.fallback_used=true
     and (
       coalesce(cardinality(s.price_areas),0)=0
       or p.price_area=any(s.price_areas)
     )
    where s.enabled=true and s.allow_indicative_latest=false
  ),
  freshness_risk as (
    select count(*)::bigint as issue_count
    from public.company_market_price_sources s
    cross join areas a
    left join public.spot_price_daily_summaries d
      on d.source=s.source_key
     and d.price_area=a.price_area
     and d.price_date=(select current_date from stockholm_clock)
     and d.status in ('verified','locked')
    where s.enabled=true
      and (
        coalesce(cardinality(s.price_areas),0)=0
        or a.price_area=any(s.price_areas)
      )
      and (
        d.id is null
        or coalesce(d.provider_fetched_at,d.verified_at,d.updated_at)
           + make_interval(mins => greatest(1,s.max_age_minutes)) <= now()
      )
  )
select
  'spot_current_day_missing'::text as check_key,
  case when issue_count=0 then 'ok' else 'blocking' end::text as status,
  issue_count,
  jsonb_build_object('provider','elprisetjustnu','expected_areas',4) as details
from current_missing
union all
select
  'spot_previous_day_missing',
  case when issue_count=0 then 'ok' else 'blocking' end,
  issue_count,
  jsonb_build_object('provider','elprisetjustnu','expected_areas',4)
from previous_missing
union all
select
  'spot_reference_window_incomplete',
  case when issue_count=0 then 'ok' else 'blocking' end,
  issue_count,
  jsonb_build_object('reference_period','rolling_30_days','requested_days',30)
from incomplete_window
union all
select
  'spot_preview_stale',
  case when issue_count=0 then 'ok' else 'blocking' end,
  issue_count,
  '{}'::jsonb
from stale_preview
union all
select
  'spot_policy_fallback_conflict',
  case when issue_count=0 then 'ok' else 'blocking' end,
  issue_count,
  jsonb_build_object('rule','fallback_used requires allow_indicative_latest')
from policy_conflict
union all
select
  'spot_cron_slower_than_freshness_policy',
  case when issue_count=0 then 'ok' else 'blocking' end,
  issue_count,
  jsonb_build_object('rule','current provider evidence must be newer than tenant max_age_minutes')
from freshness_risk;

revoke all on public.gridex_market_price_readiness_v from public,anon,authenticated;
grant select on public.gridex_market_price_readiness_v to service_role;

-- V3 composes the existing V2 health checks and the new canonical market-price
-- readiness rows. A new function name avoids any return-type replacement risk.
create or replace function public.gridex_ops_health_checks_v3()
returns table(check_key text, status text, issue_count bigint, details jsonb)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  return query select h.check_key,h.status,h.issue_count,h.details
  from public.gridex_ops_health_checks_v2() h;

  return query select h.check_key,h.status,h.issue_count,h.details
  from public.gridex_market_price_readiness_v h;
end;
$$;

revoke all on function public.gridex_ops_health_checks_v3() from public,anon,authenticated;
grant execute on function public.gridex_ops_health_checks_v3() to service_role;

comment on column public.market_price_previews.source_as_of is
  'Timestamp derived from the newest underlying provider evidence. It must not be refreshed by recalculation alone.';
comment on column public.market_price_previews.generated_at is
  'Timestamp when the preview calculation was generated.';
comment on column public.market_price_previews.requested_days is
  'Requested reference-window size. For rolling_30_days this is 30.';
comment on column public.market_price_previews.included_days is
  'Number of verified daily summaries actually included in the preview.';
comment on function public.gridex_publish_market_price_preview_v2(
  text,text,text,date,date,timestamptz,timestamptz,numeric,timestamptz,
  integer,integer,boolean,text,uuid[],text,text,jsonb
) is 'Publishes a canonical market preview idempotently. An unchanged source checksum and unchanged provider evidence never receive artificial freshness. A new source_as_of requires a real provider fetch.';

commit;
