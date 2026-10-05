-- Customer portfolio analytics ("Kundportfölj") and read-only white-label overview.
--
-- Not to be confused with the pricing `portfolios` / `portfolio_monthly_*` tables.
--
-- Definitions (customer_supply_periods is the single source of truth;
-- status 'cancelled' never supplied and is ignored; end_date is the last supplied day):
--   active at date D : a period with start_date <= D and (end_date is null or end_date > D)
--   new in month M   : the customer's first ever start_date falls in M
--   churned in month M: the customer's last end_date falls in M and no open/later period exists
--   churn rate       : churned in M / active at the day before M
--
-- Every figure is computed by one statement over one snapshot, so a page never shows
-- numbers from different points in time. Snapshots into company_monthly_metrics are
-- written atomically under a per company/month advisory lock. The snapshot owns the
-- customer counts (active/new/ended) so every screen uses the supply-period definition;
-- forecast_kwh/actual_kwh stay owned by the forecast-run pipeline.

-- ---------------------------------------------------------------------------
-- 1. Consistent monthly table: extend company_monthly_metrics
-- ---------------------------------------------------------------------------
alter table public.company_monthly_metrics
  add column if not exists churned_customers integer not null default 0,
  add column if not exists net_change integer not null default 0,
  add column if not exists churn_rate numeric,
  add column if not exists poa_requested integer not null default 0,
  add column if not exists poa_signed integer not null default 0,
  add column if not exists poa_active integer not null default 0,
  add column if not exists metering_requests_total integer not null default 0,
  add column if not exists metering_requests_historical integer not null default 0,
  add column if not exists metering_requests_ongoing integer not null default 0,
  add column if not exists metering_requests_failed integer not null default 0,
  add column if not exists portfolio_source_version text,
  add column if not exists portfolio_computed_at timestamptz;

create index if not exists customer_supply_periods_portfolio_idx
  on public.customer_supply_periods(company_id, customer_id, start_date, end_date)
  where status <> 'cancelled';

create index if not exists powers_of_attorney_company_created_idx
  on public.powers_of_attorney(company_id, created_at);

create index if not exists grid_owner_data_requests_company_requested_idx
  on public.grid_owner_data_requests(company_id, requested_at);

-- ---------------------------------------------------------------------------
-- 2. Access helpers
-- ---------------------------------------------------------------------------
create or replace function public.gridex_user_can_read_whitelabel_platform(p_white_label_platform_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
-- plpgsql (not sql) so the body is resolved at call time: the white-label tables
-- are absent in the canonical clean replay (see 20260829194612).
begin
  return p_white_label_platform_id is not null
    and public.gridex_is_current_session_allowed()
    and (
      public.gridex_user_is_platform_admin()
      or exists (
        select 1
        from public.white_label_platform_memberships m
        join public.white_label_platforms p on p.id = m.white_label_platform_id
        where m.white_label_platform_id = p_white_label_platform_id
          and m.user_id = auth.uid()
          and m.status = 'active'
          and p.status <> 'archived'
      )
    );
end;
$$;

-- Read access to one company's portfolio: tenant read access, or read-only through
-- the white-label platform the company belongs to, or the service role.
create or replace function public.gridex_customer_portfolio_assert_read(p_company_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_platform_id uuid;
begin
  if p_company_id is null then
    raise exception 'company_id is required' using errcode = '22023';
  end if;

  if coalesce(auth.role(), '') = 'service_role' then
    return;
  end if;

  if public.gridex_can_read_company(p_company_id) then
    return;
  end if;

  select c.white_label_platform_id into v_platform_id
  from public.companies c
  where c.id = p_company_id;

  if v_platform_id is not null and public.gridex_user_can_read_whitelabel_platform(v_platform_id) then
    return;
  end if;

  raise exception 'Not allowed to read portfolio for this company' using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Internal compute functions (not callable by clients directly)
-- ---------------------------------------------------------------------------
create or replace function public.gridex_customer_portfolio_monthly_internal(
  p_company_id uuid,
  p_from date,
  p_to date
)
returns table (
  month date,
  active_customers_start integer,
  active_customers integer,
  new_customers integer,
  churned_customers integer,
  net_change integer,
  churn_rate numeric,
  active_metering_points integer,
  poa_requested integer,
  poa_signed integer,
  poa_active integer,
  metering_requests_total integer,
  metering_requests_historical integer,
  metering_requests_ongoing integer,
  metering_requests_failed integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with months as (
    select gs::date as m_start,
           (gs + interval '1 month' - interval '1 day')::date as m_end
    from generate_series(date_trunc('month', p_from)::date, date_trunc('month', p_to)::date, interval '1 month') gs
  ),
  periods as (
    select sp.customer_id, sp.metering_point_id, sp.start_date, sp.end_date
    from public.customer_supply_periods sp
    where sp.company_id = p_company_id
      and sp.status <> 'cancelled'
  ),
  customer_span as (
    select p.customer_id,
           min(p.start_date) as first_start,
           case when bool_or(p.end_date is null) then null else max(p.end_date) end as last_end
    from periods p
    group by p.customer_id
  ),
  poa as (
    select x.created_at::date as created_on, x.signed_at::date as signed_on,
           x.valid_from, x.valid_to, x.status
    from public.powers_of_attorney x
    where x.company_id = p_company_id
  ),
  req as (
    select x.requested_at::date as requested_on, x.status, x.request_scope,
           x.requested_period_start
    from public.grid_owner_data_requests x
    where x.company_id = p_company_id
  )
  select
    m.m_start,
    (select count(distinct p.customer_id) from periods p
       where p.start_date <= m.m_start - 1 and (p.end_date is null or p.end_date > m.m_start - 1))::integer,
    (select count(distinct p.customer_id) from periods p
       where p.start_date <= m.m_end and (p.end_date is null or p.end_date > m.m_end))::integer,
    (select count(*) from customer_span cs where cs.first_start between m.m_start and m.m_end)::integer,
    (select count(*) from customer_span cs where cs.last_end between m.m_start and m.m_end)::integer,
    null::integer,
    null::numeric,
    (select count(distinct p.metering_point_id) from periods p
       where p.start_date <= m.m_end and (p.end_date is null or p.end_date > m.m_end))::integer,
    (select count(*) from poa x where x.created_on between m.m_start and m.m_end)::integer,
    (select count(*) from poa x where x.signed_on between m.m_start and m.m_end)::integer,
    (select count(*) from poa x
       where x.status in ('signed', 'accepted', 'active', 'completed')
         and coalesce(x.valid_from, x.signed_on, x.created_on) <= m.m_end
         and (x.valid_to is null or x.valid_to >= m.m_end))::integer,
    (select count(*) from req r where r.requested_on between m.m_start and m.m_end)::integer,
    (select count(*) from req r where r.requested_on between m.m_start and m.m_end
       and r.request_scope in ('meter_values', 'billing_underlay')
       and r.requested_period_start is not null and r.requested_period_start < date_trunc('month', r.requested_on)::date)::integer,
    (select count(*) from req r where r.requested_on between m.m_start and m.m_end
       and r.request_scope in ('meter_values', 'billing_underlay')
       and (r.requested_period_start is null or r.requested_period_start >= date_trunc('month', r.requested_on)::date))::integer,
    (select count(*) from req r where r.requested_on between m.m_start and m.m_end
       and r.status in ('failed', 'rejected', 'error'))::integer
  from months m
  order by m.m_start;
end;
$$;

-- Forward consumption forecast for the customers supplied at p_as_of.
-- Per metering point and target month:
--   1. same calendar month last 12 months (actual kWh), else
--   2. the point's average month in the last 12 months * seasonal factor, else
--   3. the company's average point-month * seasonal factor.
-- Seasonal factor = default consumption profile weight * 12 / 100 (1 when missing).
-- Points whose supply ends before the target month are excluded (known churn).
create or replace function public.gridex_customer_portfolio_forecast_internal(
  p_company_id uuid,
  p_as_of date default current_date,
  p_months integer default 12
)
returns table (
  month date,
  month_index integer,
  forecast_kwh numeric,
  low_kwh numeric,
  high_kwh numeric,
  metering_points integer,
  points_with_history integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_start date := date_trunc('month', coalesce(p_as_of, current_date))::date;
  v_hist_from date := (date_trunc('month', coalesce(p_as_of, current_date)) - interval '12 months')::date;
  v_months integer := least(greatest(coalesce(p_months, 12), 1), 24);
begin
  return query
  with targets as (
    select (v_start + make_interval(months => i))::date as t_month, i + 1 as idx
    from generate_series(0, v_months - 1) i
  ),
  profile as (
    select w.month_number, w.weight_percent * 12 / 100.0 as factor
    from public.consumption_profile_month_weights w
    where w.profile_id = (
      select cp.id from public.consumption_profiles cp
      where cp.is_default = true and (cp.company_id = p_company_id or cp.company_id is null)
      order by (cp.company_id is null), cp.created_at
      limit 1
    )
  ),
  points as (
    select sp.metering_point_id,
           case when bool_or(sp.end_date is null) then null else max(sp.end_date) end as supply_end
    from public.customer_supply_periods sp
    where sp.company_id = p_company_id
      and sp.status <> 'cancelled'
      and sp.start_date <= v_start
      and (sp.end_date is null or sp.end_date >= v_start)
    group by sp.metering_point_id
  ),
  history as (
    select mv.metering_point_id,
           extract(month from mv.period_start)::integer as month_number,
           sum(mv.value_kwh) as kwh
    from public.metering_values mv
    join points pt on pt.metering_point_id = mv.metering_point_id
    where mv.company_id = p_company_id
      and mv.is_current
      and mv.reading_type = 'consumption'
      and mv.value_kwh is not null
      and mv.period_start >= v_hist_from
      and mv.period_start < v_start
    group by 1, 2
  ),
  point_avg as (
    select h.metering_point_id, avg(h.kwh) as avg_kwh
    from history h
    group by 1
  ),
  company_avg as (
    select avg(pa.avg_kwh) as avg_kwh from point_avg pa
  ),
  per_point as (
    select t.t_month, t.idx, pt.metering_point_id,
           (pa.metering_point_id is not null) as has_history,
           greatest(0, coalesce(
             h.kwh,
             pa.avg_kwh * coalesce(pr.factor, 1),
             (select ca.avg_kwh from company_avg ca) * coalesce(pr.factor, 1),
             0
           )) as kwh,
           (h.kwh is not null) as exact
    from targets t
    cross join points pt
    left join history h on h.metering_point_id = pt.metering_point_id
      and h.month_number = extract(month from t.t_month)::integer
    left join point_avg pa on pa.metering_point_id = pt.metering_point_id
    left join profile pr on pr.month_number = extract(month from t.t_month)::integer
    where pt.supply_end is null or pt.supply_end >= t.t_month
  )
  select t.t_month,
         t.idx,
         round(coalesce(sum(pp.kwh), 0), 3),
         round(coalesce(sum(pp.kwh * case when pp.exact then 0.92 when pp.has_history then 0.85 else 0.7 end), 0), 3),
         round(coalesce(sum(pp.kwh * case when pp.exact then 1.08 when pp.has_history then 1.15 else 1.3 end), 0), 3),
         count(pp.metering_point_id)::integer,
         count(pp.metering_point_id) filter (where pp.has_history)::integer
  from targets t
  left join per_point pp on pp.t_month = t.t_month
  group by t.t_month, t.idx
  order by t.t_month;
end;
$$;

revoke all on function public.gridex_customer_portfolio_monthly_internal(uuid, date, date) from public, anon, authenticated;
revoke all on function public.gridex_customer_portfolio_forecast_internal(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.gridex_customer_portfolio_monthly_internal(uuid, date, date) to service_role;
grant execute on function public.gridex_customer_portfolio_forecast_internal(uuid, date, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Public read RPCs (assert access, then compute)
-- ---------------------------------------------------------------------------
create or replace function public.gridex_customer_portfolio_summary(
  p_company_id uuid,
  p_from date default (date_trunc('month', current_date) - interval '11 months')::date,
  p_to date default current_date
)
returns table (
  month date,
  active_customers_start integer,
  active_customers integer,
  new_customers integer,
  churned_customers integer,
  net_change integer,
  churn_rate numeric,
  active_metering_points integer,
  poa_requested integer,
  poa_signed integer,
  poa_active integer,
  metering_requests_total integer,
  metering_requests_historical integer,
  metering_requests_ongoing integer,
  metering_requests_failed integer
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.gridex_customer_portfolio_assert_read(p_company_id);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3700 then
    raise exception 'Invalid period' using errcode = '22023';
  end if;

  return query
  select r.month, r.active_customers_start, r.active_customers, r.new_customers, r.churned_customers,
         r.active_customers - r.active_customers_start,
         case when r.active_customers_start > 0
              then round(r.churned_customers::numeric / r.active_customers_start, 4) end,
         r.active_metering_points, r.poa_requested, r.poa_signed, r.poa_active,
         r.metering_requests_total, r.metering_requests_historical, r.metering_requests_ongoing,
         r.metering_requests_failed
  from public.gridex_customer_portfolio_monthly_internal(p_company_id, p_from, p_to) r;
end;
$$;

create or replace function public.gridex_customer_portfolio_forecast(
  p_company_id uuid,
  p_as_of date default current_date
)
returns table (
  month date,
  month_index integer,
  forecast_kwh numeric,
  low_kwh numeric,
  high_kwh numeric,
  metering_points integer,
  points_with_history integer
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.gridex_customer_portfolio_assert_read(p_company_id);
  return query
  select * from public.gridex_customer_portfolio_forecast_internal(p_company_id, coalesce(p_as_of, current_date), 12);
end;
$$;

-- Platforms the caller may read (white-label members; platform admins see all).
create or replace function public.gridex_list_readable_whitelabel_platforms()
returns table (id uuid, name text, slug text, status text, membership_role text)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  return query
  select p.id, p.name, p.slug, p.status,
         coalesce(m.membership_role, case when public.gridex_user_is_platform_admin() then 'platform_admin' end)
  from public.white_label_platforms p
  left join public.white_label_platform_memberships m
    on m.white_label_platform_id = p.id and m.user_id = auth.uid() and m.status = 'active'
  where public.gridex_user_can_read_whitelabel_platform(p.id)
  order by p.name;
end;
$$;

-- Read-only per-tenant overview for one white-label platform and month.
create or replace function public.gridex_whitelabel_portfolio_overview(
  p_white_label_platform_id uuid,
  p_month date default current_date
)
returns table (
  company_id uuid,
  company_name text,
  company_status text,
  active_customers integer,
  new_customers integer,
  churned_customers integer,
  net_change integer,
  poa_requested integer,
  poa_active integer,
  metering_requests_total integer,
  metering_requests_historical integer,
  forecast_month_kwh numeric,
  forecast_3m_kwh numeric,
  forecast_6m_kwh numeric,
  forecast_12m_kwh numeric
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
begin
  if not public.gridex_user_can_read_whitelabel_platform(p_white_label_platform_id)
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not allowed to read this white-label platform' using errcode = '42501';
  end if;

  return query
  select c.id, c.name, c.status,
         s.active_customers, s.new_customers, s.churned_customers,
         s.active_customers - s.active_customers_start,
         s.poa_requested, s.poa_active, s.metering_requests_total, s.metering_requests_historical,
         f.m1, f.m3, f.m6, f.m12
  from public.companies c
  cross join lateral public.gridex_customer_portfolio_monthly_internal(c.id, v_month, v_month) s
  cross join lateral (
    select sum(x.forecast_kwh) filter (where x.month_index <= 1) as m1,
           sum(x.forecast_kwh) filter (where x.month_index <= 3) as m3,
           sum(x.forecast_kwh) filter (where x.month_index <= 6) as m6,
           sum(x.forecast_kwh) as m12
    from public.gridex_customer_portfolio_forecast_internal(c.id, v_month, 12) x
  ) f
  where c.white_label_platform_id = p_white_label_platform_id
    and c.status <> 'deleted_test_only'
  order by c.name;
end;
$$;

revoke all on function public.gridex_user_can_read_whitelabel_platform(uuid) from public, anon;
revoke all on function public.gridex_customer_portfolio_assert_read(uuid) from public, anon;
revoke all on function public.gridex_customer_portfolio_summary(uuid, date, date) from public, anon;
revoke all on function public.gridex_customer_portfolio_forecast(uuid, date) from public, anon;
revoke all on function public.gridex_list_readable_whitelabel_platforms() from public, anon;
revoke all on function public.gridex_whitelabel_portfolio_overview(uuid, date) from public, anon;
grant execute on function public.gridex_user_can_read_whitelabel_platform(uuid) to authenticated, service_role;
grant execute on function public.gridex_customer_portfolio_assert_read(uuid) to authenticated, service_role;
grant execute on function public.gridex_customer_portfolio_summary(uuid, date, date) to authenticated, service_role;
grant execute on function public.gridex_customer_portfolio_forecast(uuid, date) to authenticated, service_role;
grant execute on function public.gridex_list_readable_whitelabel_platforms() to authenticated, service_role;
grant execute on function public.gridex_whitelabel_portfolio_overview(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Atomic monthly snapshot into company_monthly_metrics (service role / jobs)
-- ---------------------------------------------------------------------------
create or replace function public.gridex_snapshot_customer_portfolio_month(
  p_company_id uuid,
  p_month date
)
returns public.company_monthly_metrics
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_row public.company_monthly_metrics;
begin
  if p_company_id is null or p_month is null then
    raise exception 'company_id and month are required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('customer_portfolio:' || p_company_id::text || ':' || v_month::text, 0));

  insert into public.company_monthly_metrics as cmm (
    company_id, month, active_customers, new_customers, ended_customers, churned_customers,
    net_change, churn_rate, poa_requested, poa_signed, poa_active,
    metering_requests_total, metering_requests_historical, metering_requests_ongoing,
    metering_requests_failed, portfolio_source_version, portfolio_computed_at, updated_at
  )
  select p_company_id, v_month, s.active_customers, s.new_customers, s.churned_customers, s.churned_customers,
         s.active_customers - s.active_customers_start,
         case when s.active_customers_start > 0 then round(s.churned_customers::numeric / s.active_customers_start, 4) end,
         s.poa_requested, s.poa_signed, s.poa_active,
         s.metering_requests_total, s.metering_requests_historical, s.metering_requests_ongoing,
         s.metering_requests_failed,
         'customer_portfolio_v1', now(), now()
  from public.gridex_customer_portfolio_monthly_internal(p_company_id, v_month, v_month) s
  on conflict (company_id, month) do update set
    active_customers = excluded.active_customers,
    new_customers = excluded.new_customers,
    ended_customers = excluded.ended_customers,
    churned_customers = excluded.churned_customers,
    net_change = excluded.net_change,
    churn_rate = excluded.churn_rate,
    poa_requested = excluded.poa_requested,
    poa_signed = excluded.poa_signed,
    poa_active = excluded.poa_active,
    metering_requests_total = excluded.metering_requests_total,
    metering_requests_historical = excluded.metering_requests_historical,
    metering_requests_ongoing = excluded.metering_requests_ongoing,
    metering_requests_failed = excluded.metering_requests_failed,
    portfolio_source_version = excluded.portfolio_source_version,
    portfolio_computed_at = excluded.portfolio_computed_at,
    updated_at = excluded.updated_at
  returning cmm.* into v_row;

  return v_row;
end;
$$;

revoke all on function public.gridex_snapshot_customer_portfolio_month(uuid, date) from public, anon, authenticated;
grant execute on function public.gridex_snapshot_customer_portfolio_month(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Only platform superadmins may attach/detach a company to a white-label
-- ---------------------------------------------------------------------------
create or replace function public.gridex_guard_company_white_label_platform()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.white_label_platform_id is not distinct from old.white_label_platform_id then
    return new;
  end if;

  if coalesce(current_setting('gridex.white_label_assignment', true), '') = 'on'
     or coalesce(auth.role(), '') = 'service_role'
     -- direct database sessions (migrations, operators) carry no JWT at all
     or (auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated'))
     or public.gridex_user_is_platform_admin() then
    return new;
  end if;

  raise exception 'Only platform superadmins can change a company''s white-label platform' using errcode = '42501';
end;
$$;

do $migration$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'companies' and column_name = 'white_label_platform_id'
  ) then
    raise notice 'companies.white_label_platform_id is absent in canonical clean replay; skipping white-label guard trigger';
    return;
  end if;

  execute 'create or replace trigger gridex_guard_company_white_label_platform
    before update of white_label_platform_id on public.companies
    for each row execute function public.gridex_guard_company_white_label_platform()';
end
$migration$;

create or replace function public.gridex_assign_company_to_whitelabel(
  p_company_id uuid,
  p_white_label_platform_id uuid
)
returns public.companies
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_old uuid;
  v_row public.companies;
begin
  if not public.gridex_user_is_platform_admin() then
    raise exception 'Only platform superadmins can assign white-label platforms' using errcode = '42501';
  end if;

  select c.white_label_platform_id into v_old
  from public.companies c
  where c.id = p_company_id
  for update;

  if not found then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;

  if p_white_label_platform_id is not null and not exists (
    select 1 from public.white_label_platforms p
    where p.id = p_white_label_platform_id and p.status in ('active', 'paused')
  ) then
    raise exception 'White-label platform not found or not active' using errcode = 'P0002';
  end if;

  if v_old is not distinct from p_white_label_platform_id then
    select * into v_row from public.companies c where c.id = p_company_id;
    return v_row;
  end if;

  perform set_config('gridex.white_label_assignment', 'on', true);
  update public.companies c
     set white_label_platform_id = p_white_label_platform_id,
         updated_at = now()
   where c.id = p_company_id
  returning c.* into v_row;
  perform set_config('gridex.white_label_assignment', '', true);

  insert into public.audit_logs (company_id, actor_user_id, entity_type, entity_id, action, old_values, new_values, metadata)
  values (
    p_company_id, auth.uid(), 'company', p_company_id::text,
    case when p_white_label_platform_id is null then 'white_label.detach' else 'white_label.assign' end,
    jsonb_build_object('white_label_platform_id', v_old),
    jsonb_build_object('white_label_platform_id', p_white_label_platform_id),
    jsonb_build_object('source', 'gridex_assign_company_to_whitelabel')
  );

  return v_row;
end;
$$;

revoke all on function public.gridex_guard_company_white_label_platform() from public, anon, authenticated;
revoke all on function public.gridex_assign_company_to_whitelabel(uuid, uuid) from public, anon;
grant execute on function public.gridex_assign_company_to_whitelabel(uuid, uuid) to authenticated, service_role;
