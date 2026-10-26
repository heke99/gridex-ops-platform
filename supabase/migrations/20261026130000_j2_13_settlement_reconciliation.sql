-- FINDINGS J2-13 / owner decision 34 (quality/audits/live-chain-20261015/OWNER-DECISIONS.md): reconciliation with
-- a correct split. Two separate checks, per tenant (supplier), settlement grid area, delivery period and series type:
--
--   aggregate_vs_metered  our own current metering values against the grid owner's comparable aggregated values
--                         (UTILTS aggregate series, public.meter_reading_series series_kind 'aggregate', E31) over
--                         exactly the aggregate's own period. S03 is preliminary shares/plan values: it is recorded
--                         as 'preliminary', never compared as final measured consumption and never approved.
--   billed_vs_basis       net invoiced kWh (invoices, minus credit invoices from billing_adjustment_cases, plus
--                         replacement invoices) against the current metering values for the same metering points
--                         and billing periods (the billing basis). Break-fee underlays carry no energy and are left out.
--
-- Status: 'matched' (inside tolerance), 'deviation' (outside), 'incomplete' (own or reference data missing or not
-- comparable: missing intervals for a supplied facility, an unsupported unit, an invoice without kWh), and
-- 'missing_reference' (a supplied grid area and month with no final aggregate). Missing data is never counted as zero
-- and never approved. Only the current version of a corrected aggregate (is_current) is compared; an earlier result
-- for the same key is kept but marked not current.
--
-- Tolerances (public.settlement_reconciliation_tolerances, documented per row): a difference is inside tolerance when
-- |diff| <= abs_kwh OR |diff| <= pct % of the reference; a deviation exceeds both. A tenant row overrides the
-- platform default (company_id NULL).
--
-- Every deviation, incomplete or missing-reference result opens (or refreshes) one traceable staff case in
-- public.customer_operation_tasks (task_type 'settlement_reconciliation_deviation', one open case per tenant, check,
-- grid area and period) with the evidence for contacting the grid owner. Nothing is corrected automatically and no
-- billing is blocked: the existing billing checks are unchanged and nothing here is read by them.
--
-- When: gridex_settlement_reconcile_v1(company, month, trigger) for the monthly summary, and on new or corrected
-- metering basis: statement triggers on meter_reading_series and metering_values queue (company, grid area, month) in
-- public.settlement_reconciliation_requests, which gridex_settlement_reconcile_pending_v1 processes (cron). The
-- triggers only insert queue rows; no locked function (DB-05, SC-031, SC-046) is rewritten.
begin;

create table public.settlement_reconciliation_tolerances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  check_kind text not null check (check_kind in ('aggregate_vs_metered', 'billed_vs_basis')),
  abs_kwh numeric not null check (abs_kwh >= 0),
  pct numeric not null check (pct >= 0 and pct <= 100),
  documentation text not null check (btrim(documentation) <> ''),
  created_at timestamptz not null default now()
);
create unique index settlement_reconciliation_tolerances_scope_uidx
  on public.settlement_reconciliation_tolerances (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), check_kind);
insert into public.settlement_reconciliation_tolerances (company_id, check_kind, abs_kwh, pct, documentation) values
  (null, 'aggregate_vs_metered', 1.0, 0.5,
   'Plattformsstandard (ägarbeslut 34): egna mätvärden mot nätägarens summerade värden. Inom tolerans om |diff| <= 1,0 kWh eller <= 0,5 % av nätägarens värde; avrundning per intervall i E31 ryms.'),
  (null, 'billed_vs_basis', 0.5, 0.1,
   'Plattformsstandard (ägarbeslut 34): nettofakturerade kWh mot faktureringsgrundande mätvärden. Inom tolerans om |diff| <= 0,5 kWh eller <= 0,1 % av underlaget; fakturerad kWh avrundas per rad.');

create table public.settlement_reconciliation_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  grid_area_code text,
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  reason text not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index settlement_reconciliation_requests_pending_uidx
  on public.settlement_reconciliation_requests (company_id, coalesce(grid_area_code, ''), period_month) where processed_at is null;

create table public.settlement_reconciliation_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  check_kind text not null check (check_kind in ('aggregate_vs_metered', 'billed_vs_basis')),
  grid_area_code text not null,
  period_month date not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  series_type text not null,
  reference_message_code text,
  reference_series_id uuid,
  reference_version integer,
  own_kwh numeric,
  reference_kwh numeric,
  diff_kwh numeric,
  diff_pct numeric,
  status text not null check (status in ('matched', 'deviation', 'incomplete', 'missing_reference', 'preliminary')),
  reasons jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  tolerance jsonb not null default '{}'::jsonb,
  task_id uuid,
  trigger text not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index settlement_reconciliation_results_current_uidx
  on public.settlement_reconciliation_results (company_id, check_kind, grid_area_code, period_start, period_end, series_type, coalesce(reference_message_code, ''))
  where is_current;
create index settlement_reconciliation_results_company_month_idx on public.settlement_reconciliation_results (company_id, period_month, status) where is_current;

alter table public.settlement_reconciliation_tolerances enable row level security;
alter table public.settlement_reconciliation_requests enable row level security;
alter table public.settlement_reconciliation_results enable row level security;
revoke all on table public.settlement_reconciliation_tolerances, public.settlement_reconciliation_requests, public.settlement_reconciliation_results
  from public, anon, authenticated, service_role;
grant select on table public.settlement_reconciliation_tolerances, public.settlement_reconciliation_results to authenticated, service_role;
grant select on table public.settlement_reconciliation_requests to service_role;
create policy settlement_reconciliation_results_tenant_read on public.settlement_reconciliation_results for select to authenticated
  using (public.gridex_can_read_company(company_id));
create policy settlement_reconciliation_tolerances_read on public.settlement_reconciliation_tolerances for select to authenticated
  using (company_id is null or public.gridex_can_read_company(company_id));

-- kWh for a quantity in a unit; NULL for an unsupported unit (then the result is 'incomplete', never zero).
create function public.gridex_settlement_kwh_v1(p_quantity numeric, p_unit text)
returns numeric language sql immutable set search_path to pg_catalog as $fn$
  select case upper(coalesce(nullif(btrim(p_unit), ''), 'KWH'))
    when 'KWH' then p_quantity when 'MWH' then p_quantity * 1000 when 'WH' then p_quantity / 1000 else null end
$fn$;

create function public.gridex_settlement_tolerance_v1(p_company_id uuid, p_check text)
returns public.settlement_reconciliation_tolerances language sql stable security definer set search_path to public, pg_catalog as $fn$
  select t.* from public.settlement_reconciliation_tolerances t
  where t.check_kind = p_check and (t.company_id = p_company_id or t.company_id is null)
  order by t.company_id is null limit 1
$fn$;

-- Writes one current result per key (an earlier current result for the key is kept, not current) and opens or
-- refreshes the staff case for a deviation, incomplete or missing-reference result. Returns the result id.
create function public.gridex_settlement_record_result_v1(p_row public.settlement_reconciliation_results, p_actor_user_id uuid)
returns uuid language plpgsql security definer set search_path to public, pg_catalog as $fn$
declare v_id uuid; v_task uuid; v_title text; v_key text;
begin
  update public.settlement_reconciliation_results r set is_current = false
  where r.is_current and r.company_id = p_row.company_id and r.check_kind = p_row.check_kind and r.grid_area_code = p_row.grid_area_code
    and r.period_start = p_row.period_start and r.period_end = p_row.period_end and r.series_type = p_row.series_type
    and coalesce(r.reference_message_code, '') = coalesce(p_row.reference_message_code, '');
  v_key := concat_ws('|', p_row.check_kind, p_row.grid_area_code, p_row.period_start, p_row.period_end, p_row.series_type, coalesce(p_row.reference_message_code, ''));
  if p_row.status in ('deviation', 'incomplete', 'missing_reference') then
    v_title := case p_row.check_kind
      when 'aggregate_vs_metered' then 'Avstämning mot nätägarens summerade värden: ' || p_row.grid_area_code
      else 'Avstämning fakturerat mot mätunderlag: ' || p_row.grid_area_code end
      || ' ' || to_char(p_row.period_month, 'YYYY-MM') || ' (' || case p_row.status when 'deviation' then 'avvikelse'
        when 'incomplete' then 'ofullständiga data' else 'nätägarens värden saknas' end || ')';
    select t.id into v_task from public.customer_operation_tasks t
    where t.company_id = p_row.company_id and t.task_type = 'settlement_reconciliation_deviation'
      and t.status in ('open', 'in_progress', 'blocked') and t.metadata->>'reconciliation_key' = v_key
    order by t.created_at limit 1 for update;
    if v_task is null then
      insert into public.customer_operation_tasks (company_id, task_type, status, priority, title, description, assigned_to, metadata, created_by)
      values (p_row.company_id, 'settlement_reconciliation_deviation', 'open', case p_row.status when 'deviation' then 'high' else 'normal' end,
        v_title, 'Stäm av med nätägaren. Ingen automatisk rättelse görs och faktureringen spärras inte av denna kontroll.',
        p_actor_user_id,
        jsonb_build_object('reconciliation_key', v_key, 'check_kind', p_row.check_kind, 'status', p_row.status, 'grid_area_code', p_row.grid_area_code,
          'period_start', p_row.period_start, 'period_end', p_row.period_end, 'own_kwh', p_row.own_kwh, 'reference_kwh', p_row.reference_kwh,
          'diff_kwh', p_row.diff_kwh, 'diff_pct', p_row.diff_pct, 'reasons', p_row.reasons, 'evidence', p_row.evidence,
          'responsible_role', 'settlement_reconciliation', 'source', 'gridex_settlement_reconcile_v1'),
        p_actor_user_id)
      returning id into v_task;
    else
      update public.customer_operation_tasks t set title = v_title, updated_at = now(),
        metadata = t.metadata || jsonb_build_object('status', p_row.status, 'own_kwh', p_row.own_kwh, 'reference_kwh', p_row.reference_kwh,
          'diff_kwh', p_row.diff_kwh, 'diff_pct', p_row.diff_pct, 'reasons', p_row.reasons, 'evidence', p_row.evidence, 'refreshed_at', now())
      where t.id = v_task;
    end if;
  end if;
  insert into public.settlement_reconciliation_results (company_id, check_kind, grid_area_code, period_month, period_start, period_end, series_type,
    reference_message_code, reference_series_id, reference_version, own_kwh, reference_kwh, diff_kwh, diff_pct, status, reasons, evidence, tolerance,
    task_id, trigger)
  values (p_row.company_id, p_row.check_kind, p_row.grid_area_code, p_row.period_month, p_row.period_start, p_row.period_end, p_row.series_type,
    p_row.reference_message_code, p_row.reference_series_id, p_row.reference_version, p_row.own_kwh, p_row.reference_kwh, p_row.diff_kwh, p_row.diff_pct,
    p_row.status, p_row.reasons, p_row.evidence, p_row.tolerance, v_task, p_row.trigger)
  returning id into v_id;
  return v_id;
end $fn$;

create function public.gridex_settlement_classify_v1(p_own numeric, p_reference numeric, p_tol public.settlement_reconciliation_tolerances)
returns text language sql immutable set search_path to pg_catalog as $fn$
  select case when p_own is null or p_reference is null then 'incomplete'
    when abs(p_own - p_reference) <= p_tol.abs_kwh then 'matched'
    when p_reference <> 0 and abs(p_own - p_reference) * 100 <= p_tol.pct * abs(p_reference) then 'matched'
    else 'deviation' end
$fn$;

create function public.gridex_settlement_reconcile_v1(p_company_id uuid, p_month date, p_trigger text default 'monthly',
  p_grid_area_code text default null, p_actor_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path to public, pg_catalog as $fn$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_from timestamptz := (date_trunc('month', p_month)::date)::timestamp at time zone 'Europe/Stockholm';
  v_to timestamptz := ((date_trunc('month', p_month) + interval '1 month')::date)::timestamp at time zone 'Europe/Stockholm';
  tol_a public.settlement_reconciliation_tolerances; tol_b public.settlement_reconciliation_tolerances;
  s record; g record; r public.settlement_reconciliation_results; own numeric; ref numeric; reasons text[]; ids uuid[] := array[]::uuid[];
  supplied int; covered int; bad_units int; v_dir text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if p_actor_user_id is null or auth.uid() is distinct from p_actor_user_id
       or not public.gridex_actor_has_company_permission(p_actor_user_id, p_company_id, 'billing_underlay.read') then
      raise exception using errcode = '42501', message = 'settlement_reconciliation_not_allowed';
    end if;
  end if;
  if p_company_id is null or p_month is null then raise exception using errcode = '22023', message = 'settlement_reconciliation_input_required'; end if;
  tol_a := public.gridex_settlement_tolerance_v1(p_company_id, 'aggregate_vs_metered');
  tol_b := public.gridex_settlement_tolerance_v1(p_company_id, 'billed_vs_basis');

  -- Check 1: every current aggregate series of the tenant overlapping the month, over exactly its own period.
  for s in
    select ms.id, ms.grid_area_id, ms.period_start, ms.period_end, ms.message_code, ms.version_no, ms.source_ediel_message_id, ms.actor_context,
           case when lower(coalesce(ms.time_series_product->>'direction', ms.raw_transaction->>'direction', '')) = 'production' then 'production' else 'consumption' end as direction,
           (select sum(public.gridex_settlement_kwh_v1(v.quantity, v.unit)) from public.meter_reading_values v where v.series_id = ms.id and v.company_id = p_company_id) as ref_kwh,
           (select count(*) from public.meter_reading_values v where v.series_id = ms.id and v.company_id = p_company_id and public.gridex_settlement_kwh_v1(v.quantity, v.unit) is null) as bad_units,
           (select count(*) from public.meter_reading_values v where v.series_id = ms.id and v.company_id = p_company_id) as n_values
    from public.meter_reading_series ms
    where ms.company_id = p_company_id and ms.series_kind = 'aggregate' and ms.is_current
      and ms.message_code in ('E31', 'S03') and ms.grid_area_id is not null
      and (p_grid_area_code is null or ms.grid_area_id = p_grid_area_code)
      and ms.period_start < v_to and ms.period_end > v_from and ms.period_end > ms.period_start
  loop
    reasons := array[]::text[];
    -- Own values: current values of the tenant's metering points in the grid area and direction, inside the window.
    select sum(public.gridex_settlement_kwh_v1(coalesce(mv.value_kwh, mv.quantity), case when mv.value_kwh is not null then 'KWH' else mv.unit end)),
           count(*) filter (where public.gridex_settlement_kwh_v1(coalesce(mv.value_kwh, mv.quantity), case when mv.value_kwh is not null then 'KWH' else mv.unit end) is null)
      into own, bad_units
    from public.metering_values mv join public.metering_points mp on mp.id = mv.metering_point_id and mp.company_id = p_company_id
    where mv.company_id = p_company_id and mv.is_current and coalesce(mv.value_status, 'current') = 'current'
      and coalesce(mv.grid_area_code, mp.grid_area_code) = s.grid_area_id
      and coalesce(nullif(mv.reading_type, ''), 'consumption') = s.direction
      and mv.period_start >= s.period_start and mv.period_end <= s.period_end;
    -- Completeness: every facility supplied in the window must have values covering its supplied part of the window.
    select count(*), count(*) filter (where cov.covered_seconds + 1 >= cov.needed_seconds) into supplied, covered
    from (
      select mp.id,
             extract(epoch from (least(s.period_end, coalesce((coalesce(sp.actual_end_date, sp.end_date) + 1)::timestamp at time zone 'Europe/Stockholm', s.period_end))
                                - greatest(s.period_start, (coalesce(sp.actual_start_date, sp.start_date))::timestamp at time zone 'Europe/Stockholm'))) as needed_seconds,
             coalesce((select sum(extract(epoch from (least(mv.period_end, s.period_end) - greatest(mv.period_start, s.period_start))))
                       from public.metering_values mv where mv.company_id = p_company_id and mv.metering_point_id = mp.id and mv.is_current
                         and coalesce(mv.value_status, 'current') = 'current' and coalesce(nullif(mv.reading_type, ''), 'consumption') = s.direction
                         and mv.period_start < s.period_end and mv.period_end > s.period_start), 0) as covered_seconds
      from public.customer_supply_periods sp join public.metering_points mp on mp.id = sp.metering_point_id and mp.company_id = p_company_id
      where sp.company_id = p_company_id and sp.status in ('active', 'confirmed_by_grid_owner', 'ending', 'ended')
        and mp.grid_area_code = s.grid_area_id
        and (coalesce(sp.actual_start_date, sp.start_date))::timestamp at time zone 'Europe/Stockholm' < s.period_end
        and (coalesce(sp.actual_end_date, sp.end_date) is null or (coalesce(sp.actual_end_date, sp.end_date) + 1)::timestamp at time zone 'Europe/Stockholm' > s.period_start)
    ) cov;
    if supplied > covered then reasons := array_append(reasons, 'own_values_missing_intervals'); end if;
    if bad_units > 0 or s.bad_units > 0 then reasons := array_append(reasons, 'unit_not_supported'); end if;
    if s.n_values = 0 then reasons := array_append(reasons, 'reference_values_missing'); end if;
    if supplied = 0 and own is null then reasons := array_append(reasons, 'no_supplied_facility_in_window'); end if;
    own := case when supplied > covered or bad_units > 0 then null else coalesce(own, case when supplied = 0 then null else 0 end) end;
    ref := case when s.bad_units > 0 or s.n_values = 0 then null else s.ref_kwh end;
    r := null;
    r.company_id := p_company_id; r.check_kind := 'aggregate_vs_metered'; r.grid_area_code := s.grid_area_id; r.period_month := v_month;
    r.period_start := s.period_start; r.period_end := s.period_end; r.series_type := s.direction; r.reference_message_code := s.message_code;
    r.reference_series_id := s.id; r.reference_version := s.version_no; r.own_kwh := own; r.reference_kwh := ref;
    r.diff_kwh := own - ref; r.diff_pct := case when ref is not null and ref <> 0 and own is not null then round((own - ref) * 100 / abs(ref), 4) end;
    if s.message_code = 'S03' then
      r.status := 'preliminary'; reasons := array_append(reasons, 's03_preliminary_shares_not_final_consumption');
    else
      r.status := public.gridex_settlement_classify_v1(own, ref, tol_a);
    end if;
    r.reasons := to_jsonb(reasons); r.tolerance := to_jsonb(tol_a) - 'id' - 'created_at'; r.trigger := p_trigger;
    r.evidence := jsonb_build_object('reference_series_id', s.id, 'reference_version', s.version_no, 'source_ediel_message_id', s.source_ediel_message_id,
      'grid_owner', s.actor_context, 'supplied_facilities', supplied, 'facilities_with_complete_values', covered, 'reference_value_count', s.n_values);
    ids := ids || public.gridex_settlement_record_result_v1(r, p_actor_user_id);
  end loop;

  -- Check 1, missing reference: a grid area where we supplied during the month but no final (E31) aggregate exists.
  -- Only for a monthly summary of an ended month; data in flight is not a deviation before then.
  if p_trigger = 'monthly' and v_to <= now() then
    for g in
      select distinct mp.grid_area_code as area from public.customer_supply_periods sp
      join public.metering_points mp on mp.id = sp.metering_point_id and mp.company_id = p_company_id
      where sp.company_id = p_company_id and sp.status in ('active', 'confirmed_by_grid_owner', 'ending', 'ended') and mp.grid_area_code is not null
        and (p_grid_area_code is null or mp.grid_area_code = p_grid_area_code)
        and (coalesce(sp.actual_start_date, sp.start_date))::timestamp at time zone 'Europe/Stockholm' < v_to
        and (coalesce(sp.actual_end_date, sp.end_date) is null or (coalesce(sp.actual_end_date, sp.end_date) + 1)::timestamp at time zone 'Europe/Stockholm' > v_from)
        and not exists (select from public.meter_reading_series ms where ms.company_id = p_company_id and ms.series_kind = 'aggregate' and ms.is_current
          and ms.message_code = 'E31' and ms.grid_area_id = mp.grid_area_code and ms.period_start < v_to and ms.period_end > v_from)
    loop
      r := null;
      r.company_id := p_company_id; r.check_kind := 'aggregate_vs_metered'; r.grid_area_code := g.area; r.period_month := v_month;
      r.period_start := v_from; r.period_end := v_to; r.series_type := 'consumption'; r.reference_message_code := 'E31';
      r.status := 'missing_reference'; r.reasons := '["grid_owner_aggregate_missing"]'::jsonb; r.tolerance := to_jsonb(tol_a) - 'id' - 'created_at';
      r.trigger := p_trigger; r.evidence := jsonb_build_object('expected', 'UTILTS E31 för nätområdet och månaden');
      ids := ids || public.gridex_settlement_record_result_v1(r, p_actor_user_id);
    end loop;
  end if;

  -- Check 2: net invoiced kWh against the billing basis, per grid area, month and direction.
  for g in
    with inv as (
      select i.id, i.total_kwh, i.billing_underlay_id,
             exists (select from public.billing_adjustment_cases a where a.company_id = p_company_id and a.credit_invoice_id = i.id) as is_credit
      from public.customer_invoices i
      where i.company_id = p_company_id and i.status not in ('draft', 'cancelled', 'failed')
    ), lines as (
      select coalesce(mp.grid_area_code, '?') as area, coalesce(nullif(u.energy_direction, ''), 'consumption') as direction,
             inv.id as invoice_id, inv.is_credit, inv.total_kwh, u.id as underlay_id, u.metering_point_id, u.billing_period_start, u.billing_period_end
      from inv join public.billing_underlays u on u.id = coalesce(inv.billing_underlay_id,
                 (select a.original_billing_underlay_id from public.billing_adjustment_cases a where a.company_id = p_company_id and a.credit_invoice_id = inv.id limit 1))
                 and u.company_id = p_company_id
      left join public.metering_points mp on mp.id = u.metering_point_id and mp.company_id = p_company_id
      where coalesce(u.payload->>'charge_kind', '') <> 'break_fee'
        and u.billing_period_start < (v_month + interval '1 month')::date and u.billing_period_end > v_month
        and (p_grid_area_code is null or mp.grid_area_code = p_grid_area_code)
    )
    select l.area, l.direction,
           sum(case when l.is_credit then -abs(l.total_kwh) else l.total_kwh end) as billed,
           count(*) filter (where l.total_kwh is null) as missing_kwh,
           count(distinct l.invoice_id) as invoices, count(*) filter (where l.is_credit) as credits,
           (select coalesce(jsonb_agg(distinct jsonb_build_array(x.metering_point_id, x.billing_period_start, x.billing_period_end)), '[]'::jsonb)
              from lines x where x.area = l.area and x.direction = l.direction) as windows
    from lines l group by l.area, l.direction
  loop
    reasons := array[]::text[];
    -- Basis: current metering values inside each distinct (metering point, billing period), counted once.
    select sum(public.gridex_settlement_kwh_v1(coalesce(mv.value_kwh, mv.quantity), case when mv.value_kwh is not null then 'KWH' else mv.unit end)),
           count(*) filter (where public.gridex_settlement_kwh_v1(coalesce(mv.value_kwh, mv.quantity), case when mv.value_kwh is not null then 'KWH' else mv.unit end) is null)
      into own, bad_units
    from jsonb_array_elements(g.windows) w
    join public.metering_values mv on mv.company_id = p_company_id and mv.metering_point_id = (w->>0)::uuid and mv.is_current
      and coalesce(mv.value_status, 'current') = 'current' and coalesce(nullif(mv.reading_type, ''), 'consumption') = g.direction
      and mv.period_start >= ((w->>1)::date)::timestamp at time zone 'Europe/Stockholm'
      and mv.period_end <= ((w->>2)::date)::timestamp at time zone 'Europe/Stockholm';
    if g.missing_kwh > 0 then reasons := array_append(reasons, 'invoice_without_kwh'); end if;
    if bad_units > 0 then reasons := array_append(reasons, 'unit_not_supported'); end if;
    if own is null then reasons := array_append(reasons, 'billing_basis_values_missing'); end if;
    ref := case when bad_units > 0 then null else own end;
    own := case when g.missing_kwh > 0 then null else g.billed end;
    r := null;
    r.company_id := p_company_id; r.check_kind := 'billed_vs_basis'; r.grid_area_code := g.area; r.period_month := v_month;
    r.period_start := v_from; r.period_end := v_to; r.series_type := g.direction; r.own_kwh := own; r.reference_kwh := ref;
    r.diff_kwh := own - ref; r.diff_pct := case when ref is not null and ref <> 0 and own is not null then round((own - ref) * 100 / abs(ref), 4) end;
    r.status := public.gridex_settlement_classify_v1(own, ref, tol_b);
    r.reasons := to_jsonb(reasons); r.tolerance := to_jsonb(tol_b) - 'id' - 'created_at'; r.trigger := p_trigger;
    r.evidence := jsonb_build_object('invoices', g.invoices, 'credit_invoices', g.credits, 'billing_windows', g.windows);
    ids := ids || public.gridex_settlement_record_result_v1(r, p_actor_user_id);
  end loop;

  return jsonb_build_object('month', v_month, 'trigger', p_trigger, 'results', (
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'check', x.check_kind, 'area', x.grid_area_code, 'status', x.status,
      'own_kwh', x.own_kwh, 'reference_kwh', x.reference_kwh, 'diff_kwh', x.diff_kwh, 'reasons', x.reasons, 'task_id', x.task_id) order by x.check_kind, x.grid_area_code), '[]'::jsonb)
    from public.settlement_reconciliation_results x where x.id = any(ids)));
end $fn$;

-- Processes queued requests (new or corrected metering basis), oldest first.
create function public.gridex_settlement_reconcile_pending_v1(p_company_id uuid default null, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path to public, pg_catalog as $fn$
declare q record; done int := 0; out jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'settlement_reconciliation_not_allowed';
  end if;
  for q in
    select * from public.settlement_reconciliation_requests r
    where r.processed_at is null and (p_company_id is null or r.company_id = p_company_id)
    order by r.created_at limit greatest(1, least(coalesce(p_limit, 50), 500)) for update skip locked
  loop
    update public.settlement_reconciliation_requests set processed_at = now() where id = q.id;
    out := out || jsonb_build_array(public.gridex_settlement_reconcile_v1(q.company_id, q.period_month, 'new_or_corrected_basis', q.grid_area_code, null));
    done := done + 1;
  end loop;
  return jsonb_build_object('processed', done, 'runs', out);
end $fn$;

-- Queue triggers: only insert (company, grid area, month) requests; never touch the ingest itself.
create function public.gridex_settlement_queue_from_series_v1()
returns trigger language plpgsql security definer set search_path to public, pg_catalog as $fn$
begin
  insert into public.settlement_reconciliation_requests (company_id, grid_area_code, period_month, reason)
  select distinct n.company_id, n.grid_area_id, date_trunc('month', n.period_start at time zone 'Europe/Stockholm')::date, 'aggregate_series_' || coalesce(n.message_code, '?')
  from new_rows n
  where n.series_kind = 'aggregate' and n.company_id is not null and n.period_start is not null
  on conflict do nothing;
  return null;
end $fn$;

create function public.gridex_settlement_queue_from_values_v1()
returns trigger language plpgsql security definer set search_path to public, pg_catalog as $fn$
begin
  insert into public.settlement_reconciliation_requests (company_id, grid_area_code, period_month, reason)
  select distinct n.company_id, coalesce(n.grid_area_code, mp.grid_area_code), date_trunc('month', n.period_start at time zone 'Europe/Stockholm')::date,
         case when n.revision_number > 1 then 'corrected_metering_value' else 'new_metering_value' end
  from new_rows n left join public.metering_points mp on mp.id = n.metering_point_id
  where n.company_id is not null and n.period_start is not null and n.is_current
  on conflict do nothing;
  return null;
end $fn$;

create trigger settlement_reconciliation_queue_series after insert on public.meter_reading_series
  referencing new table as new_rows for each statement execute function public.gridex_settlement_queue_from_series_v1();
create trigger settlement_reconciliation_queue_values_insert after insert on public.metering_values
  referencing new table as new_rows for each statement execute function public.gridex_settlement_queue_from_values_v1();
create trigger settlement_reconciliation_queue_values_update after update on public.metering_values
  referencing new table as new_rows for each statement execute function public.gridex_settlement_queue_from_values_v1();

revoke all on function public.gridex_settlement_kwh_v1(numeric, text) from public, anon;
revoke all on function public.gridex_settlement_tolerance_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.gridex_settlement_record_result_v1(public.settlement_reconciliation_results, uuid) from public, anon, authenticated, service_role;
revoke all on function public.gridex_settlement_classify_v1(numeric, numeric, public.settlement_reconciliation_tolerances) from public, anon;
revoke all on function public.gridex_settlement_reconcile_v1(uuid, date, text, text, uuid) from public, anon;
revoke all on function public.gridex_settlement_reconcile_pending_v1(uuid, int) from public, anon, authenticated;
revoke all on function public.gridex_settlement_queue_from_series_v1() from public, anon, authenticated, service_role;
revoke all on function public.gridex_settlement_queue_from_values_v1() from public, anon, authenticated, service_role;
grant execute on function public.gridex_settlement_reconcile_v1(uuid, date, text, text, uuid) to authenticated, service_role;
grant execute on function public.gridex_settlement_reconcile_pending_v1(uuid, int) to service_role;

commit;
