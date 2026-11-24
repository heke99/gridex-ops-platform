create schema gridex_staff_bulk_metering;
revoke all on schema gridex_staff_bulk_metering from public, anon, authenticated, service_role;

create table gridex_staff_bulk_metering.dispatch_claims (
  request_id uuid primary key references public.grid_owner_data_requests(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  company_id uuid not null,
  actor_user_id uuid not null,
  created_at timestamptz not null default now()
);

alter table gridex_staff_bulk_metering.dispatch_claims enable row level security;
revoke all on gridex_staff_bulk_metering.dispatch_claims from public, anon, authenticated, service_role;

create function public.gridex_read_bulk_metering_coverage_v1(
  p_company_id uuid,
  p_point_ids uuid[],
  p_month date,
  p_environment text
)
returns table (point_id uuid, coverage_status text, request_status text)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if p_company_id is null or p_point_ids is null or cardinality(p_point_ids) not between 1 and 100
    or array_position(p_point_ids, null) is not null
    or p_month is null or p_month not between date '2000-01-01' and date '2200-12-01'
    or extract(day from p_month) <> 1 or p_environment is null or p_environment not in ('test','production') then
    raise exception 'bulk_metering_coverage_input_invalid' using errcode = '22023';
  end if;

  return query
  with month_window as (
    select
      p_month::timestamp at time zone 'Europe/Stockholm' as starts_at,
      (p_month + interval '1 month') at time zone 'Europe/Stockholm' as ends_at,
      (p_month + interval '1 month - 1 day')::date as last_date
  ), selected_points as (
    select mp.id, mp.measurement_type, mp.status, mp.grid_owner_id, s.id as site_id, s.customer_id
    from (select distinct unnest(p_point_ids) as id) requested
    join public.metering_points mp on mp.id = requested.id and mp.company_id = p_company_id
    join public.customer_sites s on s.id = coalesce(mp.customer_site_id, mp.site_id)
      and s.company_id = p_company_id and s.customer_id = mp.customer_id
      and (mp.site_id is null or mp.site_id = s.id)
  )
  select sp.id,
    case
      when sp.status is null or sp.status not in ('active','connected') or sp.grid_owner_id is null
        or sp.measurement_type is null or sp.measurement_type not in ('consumption','production')
        or supply.covered is distinct from tstzmultirange(tstzrange(mw.starts_at, mw.ends_at, '[)'))
        or coalesce(supply.unconfirmed, false)
        or coalesce(observations.crosses_month, false)
        or coalesce(observations.raw_duration > observations.union_duration, false) then 'review'
      when observations.covered @> tstzrange(mw.starts_at, mw.ends_at, '[)') then 'complete'
      when observations.covered is null then 'empty'
      else 'partial'
    end,
    case
      when legacy.exists_unbound then 'review'
      when previous.request_count = 0 then 'none'
      when previous.request_count = 1 and previous.safe_pending then 'resume'
      when previous.request_count = 1 and previous.confirmed_origin then 'existing'
      else 'review'
    end
  from selected_points sp
  cross join month_window mw
  left join lateral (
    select range_agg(tstzrange(greatest(b.starts_at, mw.starts_at), least(b.ends_at, mw.ends_at), '[)'))
        filter (where b.confirmed) as covered,
      bool_or(not b.confirmed) as unconfirmed
    from public.customer_supply_periods s
    cross join lateral (
      select greatest(coalesce(s.actual_start_date, s.start_date)::timestamp at time zone 'Europe/Stockholm',
                coalesce(s.market_start_at, '-infinity'::timestamptz)) as starts_at,
        least(coalesce((s.actual_end_date + 1)::timestamp at time zone 'Europe/Stockholm', 'infinity'::timestamptz),
              coalesce((s.end_date + 1)::timestamp at time zone 'Europe/Stockholm', 'infinity'::timestamptz),
              coalesce(s.market_end_at, 'infinity'::timestamptz)) as ends_at,
        s.actual_start_date is not null and s.market_start_at is not null
          and (s.status <> 'ended' or s.actual_end_date is not null) as confirmed
    ) b
    where s.company_id = p_company_id and s.customer_id = sp.customer_id and s.metering_point_id = sp.id
      and s.status in ('active','confirmed_by_grid_owner','ending','ended')
      and b.starts_at < b.ends_at and b.starts_at < mw.ends_at and b.ends_at > mw.starts_at
  ) supply on true
  left join lateral (
    select result.covered, result.raw_duration, result.crosses_month,
      (select sum(upper(span) - lower(span)) from unnest(result.covered) as ranges(span)) as union_duration
    from (
      select range_agg(tstzrange(greatest(mv.period_start, mw.starts_at), least(mv.period_end, mw.ends_at), '[)')) as covered,
        sum(least(mv.period_end, mw.ends_at) - greatest(mv.period_start, mw.starts_at)) as raw_duration,
        bool_or(mv.period_start < mw.starts_at or mv.period_end > mw.ends_at) as crosses_month
      from public.metering_values mv
      where mv.company_id = p_company_id and mv.metering_point_id = sp.id and mv.customer_id = sp.customer_id
        and (mv.site_id is null or mv.site_id = sp.site_id)
        and (mv.customer_site_id is null or mv.customer_site_id = sp.site_id)
        and mv.direction = sp.measurement_type and mv.is_current and mv.revision_status = 'current'
        and mv.value_kwh is not null and mv.period_start < mv.period_end
        and mv.period_start < mw.ends_at and mv.period_end > mw.starts_at
    ) result
  ) observations on true
  cross join lateral (
    select exists (
      select 1 from public.outbound_requests r
      where (r.company_id = p_company_id or r.company_id is null)
        and r.customer_id = sp.customer_id and r.site_id = sp.site_id and r.metering_point_id = sp.id
        and r.request_type = 'meter_values'
        and r.source_type is distinct from 'grid_owner_data_request'
        and (r.period_start is null or r.period_start <= mw.last_date)
        and (r.period_end is null or r.period_end >= p_month)
        and (r.status in ('queued','prepared','sent','acknowledged') or r.sent_at is not null)
    ) as exists_unbound
  ) legacy
  cross join lateral (
    select count(*) as request_count,
      bool_and(
        r.automation_origin = 'staff_bulk_metering_v1' and r.request_payload->>'ediel_environment' = p_environment
          and r.status = 'pending' and r.sent_at is null
          and not exists (select 1 from public.outbound_requests o where o.source_type = 'grid_owner_data_request' and o.source_id = r.id)
          and not exists (select 1 from public.ediel_messages e where e.grid_owner_data_request_id = r.id)
          and not exists (select 1 from gridex_staff_bulk_metering.dispatch_claims a where a.request_id = r.id)
      ) as safe_pending,
      bool_and(
        r.automation_origin = 'staff_bulk_metering_v1' and r.request_payload->>'ediel_environment' = p_environment
          and exists (
            select 1 from public.ediel_messages e
            join public.ediel_outbox o on o.ediel_message_id = e.id and o.company_id = e.company_id and o.environment = e.environment
            where e.grid_owner_data_request_id = r.id and e.company_id = p_company_id
              and e.environment = p_environment and e.message_family = 'UTILTS' and e.message_code = 'E73' and e.direction = 'outbound'
          )
      ) as confirmed_origin
    from public.grid_owner_data_requests r
    where r.company_id = p_company_id and r.metering_point_id = sp.id and r.request_scope = 'meter_values'
      and (r.automation_key = 'meter-values:' || p_company_id::text || ':' || sp.id::text || ':' || to_char(p_month, 'YYYY-MM')
        or (r.requested_period_start in (p_month, (mw.starts_at at time zone 'UTC')::date)
          and r.requested_period_end in (mw.last_date, (mw.ends_at at time zone 'UTC')::date)))
  ) previous;
end;
$$;

revoke all on function public.gridex_read_bulk_metering_coverage_v1(uuid, uuid[], date, text)
  from public, anon, authenticated;
grant execute on function public.gridex_read_bulk_metering_coverage_v1(uuid, uuid[], date, text)
  to service_role;

create function public.gridex_claim_staff_bulk_metering_e73_v1(
  p_company_id uuid, p_actor_user_id uuid, p_request_id uuid, p_environment text
)
returns uuid
language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
declare
  v_token uuid;
begin
  if (select auth.role()) is distinct from 'service_role' or p_company_id is null or p_actor_user_id is null
    or p_environment is null or p_environment not in ('test','production') then
    raise exception 'bulk_metering_dispatch_actor_invalid' using errcode = '42501';
  end if;

  perform 1
  from public.grid_owner_data_requests r
  where r.id = p_request_id and r.company_id = p_company_id
    and r.automation_origin = 'staff_bulk_metering_v1' and r.request_scope = 'meter_values'
    and r.request_payload->>'ediel_environment' = p_environment and r.status = 'pending' and r.sent_at is null
    and not exists (select 1 from public.outbound_requests o where o.source_type = 'grid_owner_data_request' and o.source_id = r.id)
    and not exists (select 1 from public.ediel_messages e where e.grid_owner_data_request_id = r.id)
  for update;

  if not found then return null; end if;

  insert into gridex_staff_bulk_metering.dispatch_claims (request_id, company_id, actor_user_id)
  values (p_request_id, p_company_id, p_actor_user_id)
  on conflict (request_id) do nothing
  returning token into v_token;

  return v_token;
end;
$$;

create function public.gridex_release_staff_bulk_metering_e73_v1(
  p_company_id uuid, p_actor_user_id uuid, p_request_id uuid, p_token uuid
)
returns boolean
language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'bulk_metering_dispatch_actor_invalid' using errcode = '42501';
  end if;

  perform 1 from public.grid_owner_data_requests
  where id = p_request_id and company_id = p_company_id and status = 'pending' and sent_at is null
  for update;

  if not found then return false; end if;

  delete from gridex_staff_bulk_metering.dispatch_claims c
  where c.request_id = p_request_id and c.company_id = p_company_id
    and c.actor_user_id = p_actor_user_id and c.token = p_token
    and not exists (select 1 from public.outbound_requests o where o.source_type = 'grid_owner_data_request' and o.source_id = c.request_id)
    and not exists (select 1 from public.ediel_messages e where e.grid_owner_data_request_id = c.request_id);

  return found;
end;
$$;

revoke all on function
  public.gridex_claim_staff_bulk_metering_e73_v1(uuid, uuid, uuid, text),
  public.gridex_release_staff_bulk_metering_e73_v1(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.gridex_claim_staff_bulk_metering_e73_v1(uuid, uuid, uuid, text),
  public.gridex_release_staff_bulk_metering_e73_v1(uuid, uuid, uuid, uuid)
  to service_role;

create function public.gridex_check_staff_bulk_metering_e73_claim_v1(
  p_company_id uuid, p_actor_user_id uuid, p_request_id uuid, p_environment text, p_token uuid
)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select (select auth.role()) is not distinct from 'service_role' and exists (
    select 1 from gridex_staff_bulk_metering.dispatch_claims c
    join public.grid_owner_data_requests r on r.id = c.request_id and r.company_id = c.company_id
    where c.request_id = p_request_id and c.company_id = p_company_id and c.actor_user_id = p_actor_user_id
      and c.token = p_token and r.status = 'pending' and r.sent_at is null
      and r.request_payload->>'ediel_environment' = p_environment and r.automation_origin = 'staff_bulk_metering_v1'
  );
$$;

revoke all on function public.gridex_check_staff_bulk_metering_e73_claim_v1(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.gridex_check_staff_bulk_metering_e73_claim_v1(uuid, uuid, uuid, text, uuid)
  to service_role;
