-- FINDINGS J2-02 / owner decision 40 (quality/audits/live-chain-20261015/OWNER-DECISIONS.md): a grid owner's metering
-- correction for a month that is already invoiced reaches the customer as normal customer handling, with traceable
-- correction and credit records. Before this, gridex_billing_source.capture_correction_v1 only journalled the correction
-- against the finalized underlay (reconciliation check metering_corrections_after_billing); nothing billed or credited it.
--
-- Rules (owner decision 40):
--   * The original invoice, its finalized underlay, items and source binding are never changed (the existing guards
--     billing_source_finalized_immutable / underlay_bindings / correction_journal are untouched).
--   * A correction is bound to the original invoice, the original underlay and period, every corrected metering revision
--     (previous and current normalized value per interval) and the original contract and contract price snapshot: it is
--     priced over the original period with the original price rules (lib/pricing/engine.ts), never today's prices.
--   * Per interval the delta is current kWh minus what was billed for it (the original item, or the last correction).
--     Positive deltas become one charge underlay (consumption/invoice); negative deltas one credit underlay
--     (consumption_correction/credit_invoice) -> a credit invoice. Energy components only: no monthly or invoice fee.
--   * Idempotent per metering revision: (original underlay, original item, current value) is unique, so a re-run, a
--     concurrent run or a later month never charges the same revision twice; a further revision is charged as the
--     difference to what is already billed.
--   * Terminated contract or ended supply (no next regular invoice): flow 'separate_correction' (its own correction or
--     credit invoice bound to the original invoice). Otherwise 'next_invoice' (the next billing run).
--   * No amount or time limit makes a correction disappear. public.metering_correction_policies holds a documented
--     approval threshold in kWh (tenant row over platform row, optionally per customer category); above it the
--     correction waits as 'pending_approval' with a blocked adjustment case until gridex_decide_metering_billing_correction_v1.
--     Prescription/contract rules per customer category: hook only (prescription_rule 'manual_review' routes the
--     category to manual approval; 'not_enforced' is the documented default). A manual rejection needs a reason.
--
-- Objects:
--   1. public.metering_correction_policies (+ platform default row), public.metering_billing_corrections,
--      public.metering_billing_correction_revisions. Tenant members read; written only by the functions below.
--   2. public.gridex_metering_correction_pending_v1(company, underlay): items of a finalized underlay whose current
--      metering revision is not yet covered by a correction (0 = handled).
--   3. public.gridex_record_metering_billing_corrections_v1(company, billing month 'YYYY-MM', scope, actor):
--      service_role; per invoiced finalized consumption underlay with a correction journal, under an advisory lock per
--      original underlay. Only qualified current revisions (billable, eligible, same supply period/customer/metering
--      point, gridex_billing_source.bases_v1 qualified, quality established) are corrected; the rest wait and stay
--      visible. The correction underlay covers the whole Ediel/civil days of its intervals inside the original period,
--      in the run's billing month; if that segment is occupied it waits for a later run.
--   4. public.gridex_decide_metering_billing_correction_v1(company, correction, decision, reason, actor):
--      caller = actor or service_role, billing_underlay.export in the company.
--   5. Triggers: customer_invoices BEFORE INSERT (one invoice per correction, original invoice not cancelled, amount
--      sign, stamps the links) and AFTER INSERT (correction invoiced, adjustment case credited/completed);
--      billing_underlays / billing_underlay_items: a correction underlay and its items are immutable once bound.
--   6. Exact-needle rewrites (owner, ACL, security mode and proconfig checked; marker must be absent):
--      public.gridex_read_billing_underlay_source_basis_v1: a correction underlay is qualified by its own correction
--        row ('underlaid'/'invoiced'); new key correctionPending (journal and uncovered revisions). correctionRequired
--        is unchanged.
--      public.gridex_create_billing_export_run (after H-B6b): a ready correction underlay backed by its own correction
--        row is accepted; every other item keeps require_underlay_v1.
begin;

create table public.metering_correction_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  customer_category text check (customer_category is null or customer_category in ('private', 'business', 'association')),
  approval_threshold_kwh numeric not null check (approval_threshold_kwh >= 0),
  prescription_rule text not null default 'not_enforced' check (prescription_rule in ('not_enforced', 'manual_review')),
  documentation text not null check (btrim(documentation) <> ''),
  created_at timestamptz not null default now()
);
create unique index metering_correction_policies_scope_uidx on public.metering_correction_policies
  (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(customer_category, ''));
alter table public.metering_correction_policies enable row level security;
revoke all on table public.metering_correction_policies from public, anon, authenticated, service_role;
grant select on table public.metering_correction_policies to authenticated, service_role;
create policy metering_correction_policies_read on public.metering_correction_policies for select to authenticated
  using (company_id is null or public.gridex_can_write_company(company_id));
insert into public.metering_correction_policies (company_id, customer_category, approval_threshold_kwh, prescription_rule, documentation)
values (null, null, 500, 'not_enforced',
  'Plattformens standard (ägarbeslut 40, J2-02): en rättelse över 500 kWh (absolut differens per rättelseunderlag) kräver manuellt '
  || 'godkännande innan den faktureras eller krediteras. Gränsen styr bara godkännandet; ingen rättelse tas bort. Preskription och '
  || 'avtalsregler per kundkategori: inte tillämpade automatiskt (not_enforced); en kategori kan styras till manuell granskning (manual_review).');

create table public.metering_billing_corrections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  original_billing_underlay_id uuid not null references public.billing_underlays(id),
  original_invoice_id uuid not null,
  customer_id uuid not null,
  metering_point_id uuid not null,
  supply_period_id uuid not null,
  contract_id uuid not null,
  contract_price_snapshot_id uuid not null,
  original_period_start date not null,
  original_period_end date not null,
  direction text not null check (direction in ('charge', 'credit')),
  delta_kwh numeric not null check (delta_kwh > 0),
  revision_count integer not null check (revision_count > 0),
  flow text not null check (flow in ('next_invoice', 'separate_correction')),
  flow_reason text,
  customer_category text,
  prescription_rule text not null,
  approval_required boolean not null,
  approval_threshold_kwh numeric not null,
  status text not null check (status in ('pending_approval', 'approved', 'underlaid', 'invoiced', 'rejected')),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  adjustment_case_id uuid not null unique references public.billing_adjustment_cases(id),
  correction_underlay_id uuid unique references public.billing_underlays(id),
  correction_invoice_id uuid unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status in ('underlaid', 'invoiced')) = (correction_underlay_id is not null)),
  check ((status = 'invoiced') = (correction_invoice_id is not null)),
  check (status <> 'rejected' or nullif(btrim(decision_reason), '') is not null),
  check (approval_required or status <> 'pending_approval')
);
create index metering_billing_corrections_original_idx on public.metering_billing_corrections (company_id, original_billing_underlay_id);
create index metering_billing_corrections_status_idx on public.metering_billing_corrections (company_id, status);
alter table public.metering_billing_corrections enable row level security;
revoke all on table public.metering_billing_corrections from public, anon, authenticated, service_role;
grant select on table public.metering_billing_corrections to authenticated, service_role;
create policy metering_billing_corrections_tenant_read on public.metering_billing_corrections for select to authenticated
  using (public.gridex_can_write_company(company_id));

create table public.metering_billing_correction_revisions (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id),
  -- NULL for a revision whose delta is zero (e.g. only the quality changed): covered, nothing to bill.
  correction_id uuid references public.metering_billing_corrections(id),
  original_billing_underlay_id uuid not null references public.billing_underlays(id),
  original_item_id uuid not null,
  previous_value_id uuid not null,
  previous_kwh numeric not null,
  current_value_id uuid not null,
  current_kwh numeric not null,
  delta_kwh numeric not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_at timestamptz not null default now(),
  unique (original_billing_underlay_id, original_item_id, current_value_id),
  check ((delta_kwh = 0) = (correction_id is null))
);
create index metering_billing_correction_revisions_item_idx on public.metering_billing_correction_revisions
  (company_id, original_billing_underlay_id, original_item_id, id desc);
create index metering_billing_correction_revisions_correction_idx on public.metering_billing_correction_revisions (correction_id);
alter table public.metering_billing_correction_revisions enable row level security;
revoke all on table public.metering_billing_correction_revisions from public, anon, authenticated, service_role;
grant select on table public.metering_billing_correction_revisions to authenticated, service_role;
create policy metering_billing_correction_revisions_tenant_read on public.metering_billing_correction_revisions for select to authenticated
  using (public.gridex_can_write_company(company_id));

-- Items of a finalized underlay whose current metering revision (same canonical_dedupe_key, revision_status 'current')
-- is not what was last billed for the item (the original value, or the last recorded correction revision).
create function public.gridex_metering_correction_pending_v1(p_company_id uuid, p_underlay_id uuid)
returns integer
language sql
stable
set search_path to pg_catalog
as $fn$
  select count(*)::integer
  from public.billing_underlay_items i
  join public.normalized_metering_values o on o.company_id = p_company_id and o.id = i.source_normalized_metering_value_id
  left join lateral (
    select r.current_value_id from public.metering_billing_correction_revisions r
    where r.company_id = p_company_id and r.original_billing_underlay_id = p_underlay_id and r.original_item_id = i.id
    order by r.id desc limit 1
  ) r on true
  left join lateral (
    select coalesce(case when o.revision_status = 'current' then o.id end,
      (select c.id from public.normalized_metering_values c where o.canonical_dedupe_key is not null and c.company_id = p_company_id
        and c.canonical_dedupe_key = o.canonical_dedupe_key and c.revision_status = 'current' limit 1)) as id
  ) c on true
  where i.company_id = p_company_id and i.billing_underlay_id = p_underlay_id
    and c.id is distinct from coalesce(r.current_value_id, o.id)
$fn$;
revoke all on function public.gridex_metering_correction_pending_v1(uuid, uuid) from public, anon, authenticated, service_role;

-- Creates the correction underlay and its items for an approved correction (internal). Returns the underlay id, or NULL
-- when it must wait (segment occupied in this month, or a revision is no longer gate-eligible).
create function public.gridex_metering_correction_underlay_v1(p_correction_id uuid, p_year integer, p_month integer, p_actor_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to public, extensions, pg_catalog, pg_temp
as $fn$
declare
  mc public.metering_billing_corrections%rowtype;
  u public.billing_underlays%rowtype;
  v_frame text;
  v_zone text;
  v_first timestamptz;
  v_last timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_start_date date;
  v_end_date date;
  v_direction text;
  v_settlement text;
  v_underlay uuid;
  v_waiting integer;
begin
  select * into mc from public.metering_billing_corrections where id = p_correction_id for update;
  if not found or mc.status <> 'approved' then return mc.correction_underlay_id; end if;
  select * into u from public.billing_underlays where id = mc.original_billing_underlay_id and company_id = mc.company_id;
  -- Every revision must still resolve to one current, gate-eligible value of the same supply (the item gate guard).
  select count(*) into v_waiting
  from public.metering_billing_correction_revisions r
  join public.normalized_metering_values p on p.id = r.current_value_id and p.company_id = mc.company_id
  left join lateral (
    select cc.* from public.normalized_metering_values cc
    where cc.company_id = mc.company_id and cc.id = coalesce(case when p.revision_status = 'current' then p.id end,
      (select k.id from public.normalized_metering_values k where p.canonical_dedupe_key is not null and k.company_id = mc.company_id
         and k.canonical_dedupe_key = p.canonical_dedupe_key and k.revision_status = 'current' limit 1))
  ) c on true
  where r.correction_id = mc.id
    and (c.id is null or c.billing_status <> 'billable' or c.billing_gate_status <> 'eligible' or c.supply_period_id is distinct from mc.supply_period_id);
  if v_waiting > 0 then return null; end if;

  v_frame := coalesce(u.payload->>'billing_month_frame', 'stockholm_civil');
  v_zone := case when v_frame = 'ediel_fixed_normal_time' then 'Etc/GMT-1' else 'Europe/Stockholm' end;
  select min(period_start), max(period_end) into v_first, v_last from public.metering_billing_correction_revisions where correction_id = mc.id;
  -- Whole Ediel (fixed +0100) or civil days around the corrected intervals, inside the original period.
  v_start := date_trunc('day', v_first at time zone v_zone) at time zone v_zone;
  v_end := (date_trunc('day', (v_last - interval '1 microsecond') at time zone v_zone) + interval '1 day') at time zone v_zone;
  if (u.payload->>'billing_period_start_instant') is not null and v_start < (u.payload->>'billing_period_start_instant')::timestamptz then
    v_start := (u.payload->>'billing_period_start_instant')::timestamptz;
  end if;
  if (u.payload->>'billing_period_end_instant') is not null and v_end > (u.payload->>'billing_period_end_instant')::timestamptz then
    v_end := (u.payload->>'billing_period_end_instant')::timestamptz;
  end if;
  v_start_date := (v_start at time zone 'Europe/Stockholm')::date;
  v_end_date := (v_end at time zone 'Europe/Stockholm')::date;
  v_direction := case when mc.direction = 'credit' then 'consumption_correction' else 'consumption' end;
  v_settlement := case when mc.direction = 'credit' then 'credit_invoice' else 'invoice' end;
  if v_end_date <= v_start_date or exists (select from public.billing_underlays x where x.company_id = mc.company_id and x.customer_id = mc.customer_id
      and x.metering_point_id = mc.metering_point_id and x.underlay_year = p_year and x.underlay_month = p_month
      and x.billing_period_start = v_start_date and x.billing_period_end = v_end_date and x.energy_direction = v_direction) then
    return null;
  end if;

  insert into public.billing_underlays (company_id, customer_id, site_id, customer_site_id, metering_point_id, supply_period_id, contract_id,
    customer_contract_id, contract_price_snapshot_id, pricing_snapshot_id, price_plan_id, price_plan_version_id, price_book_id, campaign_id,
    price_area, underlay_year, underlay_month, billing_period_start, billing_period_end, status, readiness_status, readiness_issues, total_kwh,
    currency, source_system, energy_direction, settlement_type, source_meter_value_count, missing_values_count, vat_rate, pricing_snapshot,
    payload, metadata, received_at, validated_at, created_by, updated_by)
  values (mc.company_id, u.customer_id, u.site_id, u.customer_site_id, u.metering_point_id, u.supply_period_id, u.contract_id,
    coalesce(u.customer_contract_id, u.contract_id), u.contract_price_snapshot_id, u.pricing_snapshot_id, u.price_plan_id, u.price_plan_version_id,
    u.price_book_id, u.campaign_id, u.price_area, p_year, p_month, v_start_date, v_end_date, 'validated', 'ready', '[]'::jsonb, mc.delta_kwh,
    coalesce(u.currency, 'SEK'), 'metering_correction_after_billing', v_direction, v_settlement, mc.revision_count, 0, u.vat_rate, u.pricing_snapshot,
    jsonb_build_object('charge_kind', 'metering_correction', 'metering_correction_id', mc.id, 'correction_direction', mc.direction,
      'energy_direction', v_direction, 'settlement_type', v_settlement, 'original_billing_underlay_id', u.id,
      'original_invoice_id', mc.original_invoice_id, 'original_billing_month', format('%s-%s', u.underlay_year, lpad(u.underlay_month::text, 2, '0')),
      'original_billing_period_start_instant', u.payload->'billing_period_start_instant', 'original_billing_period_end_instant', u.payload->'billing_period_end_instant',
      'adjustment_case_id', mc.adjustment_case_id, 'correction_flow', mc.flow, 'billing_month', format('%s-%s', p_year, lpad(p_month::text, 2, '0')),
      'billing_month_frame', v_frame, 'supply_period_id', u.supply_period_id, 'generated_from', 'metering_correction_after_billing',
      'billing_period_start_instant', to_char(v_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'billing_period_end_instant', to_char(v_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'billing_period_timezone', 'Europe/Stockholm', 'billing_period_end_exclusive', true, 'timezone', 'Europe/Stockholm'),
    jsonb_build_object('metering_correction_id', mc.id, 'adjustment_case_id', mc.adjustment_case_id),
    now(), now(), p_actor_user_id, p_actor_user_id)
  returning id into v_underlay;

  insert into public.billing_underlay_items (company_id, billing_underlay_id, source_normalized_metering_value_id, customer_id, customer_site_id,
    site_id, metering_point_id, contract_id, price_plan_id, price_plan_version_id, price_book_id, campaign_id, facility_id, price_area, grid_area,
    source_table, period_start, period_end, quantity, quantity_kwh, unit, product_code, register_code, quality_code, resolution, status,
    energy_direction, settlement_type, warnings, metadata)
  select mc.company_id, v_underlay, c.id, u.customer_id, u.customer_site_id, u.site_id, u.metering_point_id, u.contract_id, u.price_plan_id,
    u.price_plan_version_id, u.price_book_id, u.campaign_id, c.facility_id, u.price_area, c.grid_area, 'normalized_metering_values', r.period_start,
    r.period_end, abs(r.delta_kwh), abs(r.delta_kwh), 'kWh', c.product_code, c.register_code, c.quality_status, c.resolution, 'ready_for_pricing',
    v_direction, v_settlement, '[]'::jsonb,
    jsonb_build_object('metering_correction_id', mc.id, 'original_item_id', r.original_item_id, 'previous_value_id', r.previous_value_id,
      'previous_kwh', r.previous_kwh, 'revision_value_id', r.current_value_id, 'current_kwh', r.current_kwh, 'delta_kwh', r.delta_kwh)
  from public.metering_billing_correction_revisions r
  join public.normalized_metering_values p on p.id = r.current_value_id and p.company_id = mc.company_id
  join lateral (
    select cc.* from public.normalized_metering_values cc
    where cc.company_id = mc.company_id and cc.id = coalesce(case when p.revision_status = 'current' then p.id end,
      (select k.id from public.normalized_metering_values k where p.canonical_dedupe_key is not null and k.company_id = mc.company_id
         and k.canonical_dedupe_key = p.canonical_dedupe_key and k.revision_status = 'current' limit 1))
  ) c on true
  where r.correction_id = mc.id;

  update public.metering_billing_corrections set status = 'underlaid', correction_underlay_id = v_underlay, updated_at = now() where id = mc.id;
  update public.billing_adjustment_cases set corrected_billing_underlay_id = v_underlay, updated_at = now() where id = mc.adjustment_case_id;
  return v_underlay;
end
$fn$;
revoke all on function public.gridex_metering_correction_underlay_v1(uuid, integer, integer, uuid) from public, anon, authenticated, service_role;

create function public.gridex_record_metering_billing_corrections_v1(p_company_id uuid, p_billing_month text, p_scope jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to public, extensions, pg_catalog, pg_temp
as $fn$
declare
  v_year integer;
  v_month integer;
  v_month_start date;
  v_customer uuid := nullif(p_scope->>'customer_id', '')::uuid;
  v_meter uuid := nullif(p_scope->>'metering_point_id', '')::uuid;
  v_limit integer := least(greatest(coalesce(nullif(p_scope->>'limit', '')::integer, 500), 1), 2000);
  u public.billing_underlays%rowtype;
  v_invoice uuid;
  v_results jsonb := '[]'::jsonb;
  v_rows jsonb;
  v_ids uuid[];
  v_bases jsonb;
  v_basis jsonb;
  v_ready jsonb;
  v_waiting integer;
  i integer;
  v_set record;
  v_contract public.customer_contracts%rowtype;
  v_supply public.customer_supply_periods%rowtype;
  v_category text;
  v_policy record;
  v_approval boolean;
  v_flow text;
  v_flow_reason text;
  v_case uuid;
  v_correction uuid;
  v_underlay uuid;
  v_created jsonb;
  v_error text;
  v_count integer := 0;
  r record;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' and current_user <> 'service_role' and session_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  if p_company_id is null or coalesce(p_billing_month, '') !~ '^\d{4}-(0[1-9]|1[0-2])$' or jsonb_typeof(coalesce(p_scope, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'metering_correction_scope_required';
  end if;
  v_year := left(p_billing_month, 4)::integer;
  v_month := right(p_billing_month, 2)::integer;
  v_month_start := make_date(v_year, v_month, 1);

  for u in
    select bu.* from public.billing_underlays bu
    join gridex_billing_source.underlay_bindings b on b.underlay_id = bu.id and b.company_id = p_company_id
    where bu.company_id = p_company_id and bu.energy_direction = 'consumption' and coalesce(bu.payload->>'charge_kind', '') = ''
      and (v_customer is null or bu.customer_id = v_customer) and (v_meter is null or bu.metering_point_id = v_meter)
      and exists (select from gridex_billing_source.correction_journal j where j.underlay_id = bu.id and j.company_id = p_company_id)
    order by bu.id
    limit v_limit
  loop
    v_count := v_count + 1;
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':metering-correction:' || u.id::text, 0));
    v_created := '[]'::jsonb;

    -- Approved corrections (after manual approval or an occupied segment) become underlays in this run's month.
    for r in select id from public.metering_billing_corrections where company_id = p_company_id and original_billing_underlay_id = u.id
      and status = 'approved' order by created_at, id loop
      v_error := null;
      begin
        v_underlay := public.gridex_metering_correction_underlay_v1(r.id, v_year, v_month, p_actor_user_id);
      exception when others then v_underlay := null; v_error := sqlerrm;
      end;
      v_created := v_created || jsonb_build_array(jsonb_build_object('correctionId', r.id, 'underlayId', v_underlay, 'error', v_error,
        'status', case when v_error is not null then 'approved_blocked' when v_underlay is null then 'approved_waiting' else 'underlaid' end));
    end loop;

    select i2.id into v_invoice from public.customer_invoices i2
    where i2.company_id = p_company_id and i2.billing_underlay_id = u.id and i2.status not in ('cancelled', 'failed')
    order by i2.created_at, i2.id limit 1;
    if v_invoice is null then
      v_results := v_results || jsonb_build_array(jsonb_build_object('originalUnderlayId', u.id, 'outcome', 'original_not_invoiced',
        'pending', public.gridex_metering_correction_pending_v1(p_company_id, u.id), 'corrections', v_created));
      continue;
    end if;

    -- The uncovered items: what was last billed (original value or last correction revision) and the current revision.
    select coalesce(jsonb_agg(jsonb_build_object('item', x.item_id, 'period_start', x.period_start, 'period_end', x.period_end,
             'base_id', x.base_id, 'base_kwh', x.base_kwh, 'cur_id', x.cur_id, 'cur_kwh', x.cur_kwh, 'eligible', x.eligible) order by x.period_start, x.item_id), '[]'::jsonb)
      into v_rows
    from (
      select i.id as item_id, i.period_start, i.period_end,
        coalesce(r2.current_value_id, o.id) as base_id, coalesce(r2.current_kwh, i.quantity_kwh) as base_kwh,
        c.id as cur_id, abs(c.quantity_kwh) as cur_kwh,
        (c.id is not null and c.billing_status = 'billable' and c.billing_gate_status = 'eligible' and c.supply_period_id = u.supply_period_id
          and c.customer_id = u.customer_id and c.metering_point_id = u.metering_point_id and c.direction = 'consumption'
          and c.quantity_kwh >= 0 and c.period_start = i.period_start and c.period_end = i.period_end) as eligible
      from public.billing_underlay_items i
      join public.normalized_metering_values o on o.company_id = p_company_id and o.id = i.source_normalized_metering_value_id
      left join lateral (
        select rr.current_value_id, rr.current_kwh from public.metering_billing_correction_revisions rr
        where rr.company_id = p_company_id and rr.original_billing_underlay_id = u.id and rr.original_item_id = i.id
        order by rr.id desc limit 1
      ) r2 on true
      left join lateral (
        select cc.* from public.normalized_metering_values cc
        where cc.company_id = p_company_id and cc.id = coalesce(case when o.revision_status = 'current' then o.id end,
          (select k.id from public.normalized_metering_values k where o.canonical_dedupe_key is not null and k.company_id = p_company_id
             and k.canonical_dedupe_key = o.canonical_dedupe_key and k.revision_status = 'current' limit 1))
      ) c on true
      where i.company_id = p_company_id and i.billing_underlay_id = u.id
        and c.id is distinct from coalesce(r2.current_value_id, o.id)
    ) x;

    if jsonb_array_length(v_rows) = 0 then
      v_results := v_results || jsonb_build_array(jsonb_build_object('originalUnderlayId', u.id, 'outcome', 'handled', 'pending', 0, 'corrections', v_created));
      continue;
    end if;

    -- The same qualification as the store: the current revision's source basis is qualified with established quality.
    v_ids := array(select (x.e->>'cur_id')::uuid from jsonb_array_elements(v_rows) with ordinality as x(e, ord) where (x.e->>'eligible')::boolean order by x.ord);
    v_ready := '[]'::jsonb;
    if cardinality(v_ids) > 0 then
      v_bases := gridex_billing_source.bases_v1(p_company_id, v_ids, true, true);
      i := 0;
      for r in select x.e from jsonb_array_elements(v_rows) with ordinality as x(e, ord) where (x.e->>'eligible')::boolean order by x.ord loop
        i := i + 1;
        begin
          v_basis := gridex_billing_source.basis_entry_v1(v_bases->(i - 1));
        exception when others then v_basis := null;
        end;
        if v_basis->'qualified' = 'true'::jsonb and v_basis->'quality' = 'null'::jsonb and v_basis->'qualityEstablished' = 'true'::jsonb
           and (v_basis->>'normalizedValueId') = (r.e->>'cur_id') then
          v_ready := v_ready || jsonb_build_array(r.e);
        end if;
      end loop;
    end if;
    v_waiting := jsonb_array_length(v_rows) - jsonb_array_length(v_ready);

    -- Zero deltas (e.g. only the quality changed) are covered without any document.
    insert into public.metering_billing_correction_revisions (company_id, correction_id, original_billing_underlay_id, original_item_id,
      previous_value_id, previous_kwh, current_value_id, current_kwh, delta_kwh, period_start, period_end)
    select p_company_id, null, u.id, (e->>'item')::uuid, (e->>'base_id')::uuid, (e->>'base_kwh')::numeric, (e->>'cur_id')::uuid,
      (e->>'cur_kwh')::numeric, 0, (e->>'period_start')::timestamptz, (e->>'period_end')::timestamptz
    from jsonb_array_elements(v_ready) as x(e) where (e->>'cur_kwh')::numeric = (e->>'base_kwh')::numeric;

    if exists (select from jsonb_array_elements(v_ready) as x(e) where (e->>'cur_kwh')::numeric <> (e->>'base_kwh')::numeric) then
      select * into v_contract from public.customer_contracts where id = u.contract_id and company_id = p_company_id;
      select * into v_supply from public.customer_supply_periods where id = u.supply_period_id and company_id = p_company_id;
      select c.customer_type into v_category from public.customers c where c.id = u.customer_id and c.company_id = p_company_id;
      -- A terminated contract or an ended supply has no next regular invoice: the separate correction flow.
      v_flow_reason := case
        when v_contract.status = 'terminated' then 'contract_terminated'
        when v_supply.status = 'ended' then 'supply_ended'
        when coalesce(v_supply.actual_end_date, v_supply.end_date) is not null and coalesce(v_supply.actual_end_date, v_supply.end_date) < v_month_start then 'supply_ended'
        else null end;
      v_flow := case when v_flow_reason is null then 'next_invoice' else 'separate_correction' end;
      select p.approval_threshold_kwh, p.prescription_rule into v_policy from public.metering_correction_policies p
      where (p.company_id = p_company_id or p.company_id is null) and (p.customer_category is null or p.customer_category = v_category)
      order by (p.company_id is null), (p.customer_category is null) limit 1;

      for v_set in
        select case when (e->>'cur_kwh')::numeric > (e->>'base_kwh')::numeric then 'charge' else 'credit' end as direction,
          sum(abs((e->>'cur_kwh')::numeric - (e->>'base_kwh')::numeric)) as delta, count(*)::integer as n
        from jsonb_array_elements(v_ready) as x(e) where (e->>'cur_kwh')::numeric <> (e->>'base_kwh')::numeric
        group by 1 order by 1
      loop
        -- No policy row means no documented threshold: every correction then waits for approval (never dropped).
        v_approval := v_policy.approval_threshold_kwh is null or v_set.delta > v_policy.approval_threshold_kwh
          or coalesce(v_policy.prescription_rule, 'not_enforced') = 'manual_review';
        insert into public.billing_adjustment_cases (company_id, original_billing_underlay_id, original_invoice_id, reason, status, currency,
          approval_required, metadata)
        values (p_company_id, u.id, v_invoice, 'metering_correction_after_billing',
          case when v_approval then 'blocked' when v_set.direction = 'credit' then 'credit_queued' else 'rebill_queued' end, 'SEK', v_approval,
          jsonb_build_object('direction', v_set.direction, 'delta_kwh', v_set.delta, 'revision_count', v_set.n, 'flow', v_flow, 'flow_reason', v_flow_reason,
            'billing_month', p_billing_month, 'owner_decision', 40))
        returning id into v_case;
        insert into public.metering_billing_corrections (company_id, original_billing_underlay_id, original_invoice_id, customer_id, metering_point_id,
          supply_period_id, contract_id, contract_price_snapshot_id, original_period_start, original_period_end, direction, delta_kwh, revision_count,
          flow, flow_reason, customer_category, prescription_rule, approval_required, approval_threshold_kwh, status, adjustment_case_id, created_by)
        values (p_company_id, u.id, v_invoice, u.customer_id, u.metering_point_id, u.supply_period_id, u.contract_id,
          coalesce(u.contract_price_snapshot_id, u.pricing_snapshot_id), u.billing_period_start, u.billing_period_end, v_set.direction, v_set.delta, v_set.n,
          v_flow, v_flow_reason, v_category, coalesce(v_policy.prescription_rule, 'not_enforced'), v_approval, coalesce(v_policy.approval_threshold_kwh, 0),
          case when v_approval then 'pending_approval' else 'approved' end, v_case, p_actor_user_id)
        returning id into v_correction;
        update public.billing_adjustment_cases set metadata = metadata || jsonb_build_object('metering_correction_id', v_correction) where id = v_case;
        insert into public.metering_billing_correction_revisions (company_id, correction_id, original_billing_underlay_id, original_item_id,
          previous_value_id, previous_kwh, current_value_id, current_kwh, delta_kwh, period_start, period_end)
        select p_company_id, v_correction, u.id, (e->>'item')::uuid, (e->>'base_id')::uuid, (e->>'base_kwh')::numeric, (e->>'cur_id')::uuid,
          (e->>'cur_kwh')::numeric, (e->>'cur_kwh')::numeric - (e->>'base_kwh')::numeric, (e->>'period_start')::timestamptz, (e->>'period_end')::timestamptz
        from jsonb_array_elements(v_ready) as x(e)
        where (e->>'cur_kwh')::numeric <> (e->>'base_kwh')::numeric
          and (case when (e->>'cur_kwh')::numeric > (e->>'base_kwh')::numeric then 'charge' else 'credit' end) = v_set.direction;
        v_underlay := null;
        v_error := null;
        if not v_approval then
          begin
            v_underlay := public.gridex_metering_correction_underlay_v1(v_correction, v_year, v_month, p_actor_user_id);
          exception when others then v_underlay := null; v_error := sqlerrm;
          end;
        end if;
        v_created := v_created || jsonb_build_array(jsonb_build_object('correctionId', v_correction, 'adjustmentCaseId', v_case, 'underlayId', v_underlay,
          'direction', v_set.direction, 'deltaKwh', v_set.delta, 'revisions', v_set.n, 'flow', v_flow, 'flowReason', v_flow_reason,
          'approvalRequired', v_approval, 'error', v_error,
          'status', case when v_approval then 'pending_approval' when v_error is not null then 'approved_blocked' when v_underlay is null then 'approved_waiting' else 'underlaid' end));
      end loop;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('originalUnderlayId', u.id, 'originalInvoiceId', v_invoice,
      'outcome', case when v_waiting > 0 then 'waiting_for_qualified_revision' else 'recorded' end, 'pending', v_waiting, 'corrections', v_created));
  end loop;
  return jsonb_build_object('billingMonth', p_billing_month, 'originals', v_count, 'truncated', v_count >= v_limit, 'results', v_results);
end
$fn$;
revoke all on function public.gridex_record_metering_billing_corrections_v1(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.gridex_record_metering_billing_corrections_v1(uuid, text, jsonb, uuid) to service_role;

create function public.gridex_decide_metering_billing_correction_v1(p_company_id uuid, p_correction_id uuid, p_decision text, p_reason text,
  p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public, extensions, pg_catalog, pg_temp
as $fn$
declare
  mc public.metering_billing_corrections%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_company_id is null or p_correction_id is null or p_actor_user_id is null or p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception using errcode = '22023', message = 'metering_correction_decision_input_required';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_actor_user_id then
    raise exception using errcode = '42501', message = 'metering_correction_actor_mismatch';
  end if;
  if not public.gridex_actor_has_company_permission(p_actor_user_id, p_company_id, 'billing_underlay.export') then
    raise exception using errcode = '42501', message = 'metering_correction_decision_not_allowed';
  end if;
  select * into mc from public.metering_billing_corrections where id = p_correction_id and company_id = p_company_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'metering_correction_not_found_for_tenant'; end if;
  if mc.status <> 'pending_approval' then
    raise exception using errcode = '23514', message = 'metering_correction_not_pending_approval';
  end if;
  if p_decision = 'reject' and v_reason is null then
    raise exception using errcode = '22023', message = 'metering_correction_rejection_reason_required';
  end if;
  update public.metering_billing_corrections
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end, decided_by = p_actor_user_id, decided_at = now(),
         decision_reason = v_reason, updated_at = now()
   where id = mc.id;
  update public.billing_adjustment_cases
     set status = case when p_decision = 'reject' then 'rejected' when mc.direction = 'credit' then 'credit_queued' else 'rebill_queued' end,
         approved_by = case when p_decision = 'approve' then p_actor_user_id end, approved_at = case when p_decision = 'approve' then now() end,
         metadata = metadata || jsonb_build_object('decision', p_decision, 'decision_reason', v_reason, 'decided_by', p_actor_user_id), updated_at = now()
   where id = mc.adjustment_case_id;
  return jsonb_build_object('correctionId', mc.id, 'status', case when p_decision = 'approve' then 'approved' else 'rejected' end);
end
$fn$;
revoke all on function public.gridex_decide_metering_billing_correction_v1(uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.gridex_decide_metering_billing_correction_v1(uuid, uuid, text, text, uuid) to authenticated, service_role;

create function public.gridex_metering_correction_invoice_guard_v1()
returns trigger
language plpgsql
security definer
set search_path to public, extensions, pg_catalog, pg_temp
as $fn$
declare mc public.metering_billing_corrections%rowtype;
begin
  if new.billing_underlay_id is null then return new; end if;
  select * into mc from public.metering_billing_corrections where correction_underlay_id = new.billing_underlay_id and company_id = new.company_id for update;
  if not found then return new; end if;
  if mc.correction_invoice_id is not null then
    raise exception using errcode = '23505', message = 'metering_correction_already_invoiced';
  end if;
  if not exists (select from public.customer_invoices o where o.id = mc.original_invoice_id and o.company_id = mc.company_id
                 and o.billing_underlay_id = mc.original_billing_underlay_id and o.status not in ('cancelled', 'failed')) then
    raise exception using errcode = '23514', message = 'metering_correction_original_invoice_cancelled';
  end if;
  if (mc.direction = 'charge' and coalesce(new.amount_ex_vat, 0) < 0) or (mc.direction = 'credit' and coalesce(new.amount_ex_vat, 0) > 0) then
    raise exception using errcode = '23514', message = 'metering_correction_amount_sign_mismatch';
  end if;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('correction_of_invoice_id', mc.original_invoice_id,
    'correction_of_billing_underlay_id', mc.original_billing_underlay_id, 'metering_correction_id', mc.id,
    'metering_correction_direction', mc.direction, 'metering_correction_flow', mc.flow, 'metering_revision_count', mc.revision_count,
    'original_billing_period', jsonb_build_object('start', mc.original_period_start, 'end', mc.original_period_end),
    'adjustment_case_id', mc.adjustment_case_id);
  return new;
end
$fn$;
revoke all on function public.gridex_metering_correction_invoice_guard_v1() from public, anon, authenticated, service_role;
create trigger metering_correction_invoice_guard before insert on public.customer_invoices
  for each row execute function public.gridex_metering_correction_invoice_guard_v1();

create function public.gridex_metering_correction_invoiced_v1()
returns trigger
language plpgsql
security definer
set search_path to public, extensions, pg_catalog, pg_temp
as $fn$
declare mc public.metering_billing_corrections%rowtype;
begin
  if new.billing_underlay_id is null then return new; end if;
  select * into mc from public.metering_billing_corrections where correction_underlay_id = new.billing_underlay_id and company_id = new.company_id for update;
  if not found then return new; end if;
  update public.metering_billing_corrections set status = 'invoiced', correction_invoice_id = new.id, updated_at = now() where id = mc.id;
  update public.billing_adjustment_cases
     set credit_invoice_id = case when mc.direction = 'credit' then new.id else credit_invoice_id end,
         status = case when mc.direction = 'credit' then 'credited' else 'completed' end,
         difference_minor_units = round(coalesce(new.amount_ex_vat, 0) * 100)::bigint,
         metadata = metadata || jsonb_build_object('correction_invoice_id', new.id), updated_at = now()
   where id = mc.adjustment_case_id;
  return new;
end
$fn$;
revoke all on function public.gridex_metering_correction_invoiced_v1() from public, anon, authenticated, service_role;
create trigger metering_correction_invoiced after insert on public.customer_invoices
  for each row execute function public.gridex_metering_correction_invoiced_v1();

-- A bound correction underlay and its items never change (the finalized-underlay rule for correction documents).
create function public.gridex_metering_correction_underlay_immutable_v1()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
begin
  if tg_op = 'UPDATE' and pg_catalog.has_function_privilege(current_user, 'public.ediel_is_qualified_finance_retention_transition_v1(text,text,jsonb,jsonb)', 'EXECUTE')
     and public.ediel_is_qualified_finance_retention_transition_v1(tg_table_schema, tg_table_name, to_jsonb(old), to_jsonb(new)) is true then
    return new;
  end if;
  if tg_table_name = 'billing_underlays' then
    if exists (select from public.metering_billing_corrections mc where mc.correction_underlay_id = old.id) and (tg_op = 'DELETE' or
      row(new.company_id, new.customer_id, new.metering_point_id, new.supply_period_id, new.contract_id, new.contract_price_snapshot_id, new.total_kwh,
          new.billing_period_start, new.billing_period_end, new.underlay_year, new.underlay_month, new.payload, new.energy_direction, new.settlement_type)
      is distinct from
      row(old.company_id, old.customer_id, old.metering_point_id, old.supply_period_id, old.contract_id, old.contract_price_snapshot_id, old.total_kwh,
          old.billing_period_start, old.billing_period_end, old.underlay_year, old.underlay_month, old.payload, old.energy_direction, old.settlement_type)) then
      raise exception using errcode = '55000', message = 'metering_correction_underlay_immutable';
    end if;
  elsif exists (select from public.metering_billing_corrections mc
                where mc.correction_underlay_id = case when tg_op = 'INSERT' then new.billing_underlay_id else old.billing_underlay_id end)
     or (tg_op = 'UPDATE' and exists (select from public.metering_billing_corrections mc where mc.correction_underlay_id = new.billing_underlay_id)) then
    raise exception using errcode = '55000', message = 'metering_correction_items_immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$fn$;
revoke all on function public.gridex_metering_correction_underlay_immutable_v1() from public, anon, authenticated, service_role;
create trigger metering_correction_underlay_immutable before update or delete on public.billing_underlays
  for each row execute function public.gridex_metering_correction_underlay_immutable_v1();
create trigger metering_correction_items_immutable before insert or update or delete on public.billing_underlay_items
  for each row execute function public.gridex_metering_correction_underlay_immutable_v1();

do $j202basis$
declare
  needle_branch constant text := $n$  ELSIF u.payload->>'charge_kind'='break_fee' THEN$n$;
  replacement_branch constant text := $r$  -- J2-02 (20261028120000): a metering-correction underlay is backed by its own correction row (owner decision 40).
  ELSIF u.payload->>'charge_kind'='metering_correction' THEN
   qualified:=EXISTS(SELECT FROM public.metering_billing_corrections mc WHERE mc.company_id=p_company_id AND mc.correction_underlay_id=u.id
     AND mc.id::text=u.payload->>'metering_correction_id' AND mc.status IN ('underlaid','invoiced'));
  ELSIF u.payload->>'charge_kind'='break_fee' THEN$r$;
  needle_result constant text := $n$'correctionRequired',EXISTS(SELECT FROM gridex_billing_source.correction_journal j WHERE j.underlay_id=u.id)));$n$;
  replacement_result constant text := $r$'correctionRequired',EXISTS(SELECT FROM gridex_billing_source.correction_journal j WHERE j.underlay_id=u.id),
   -- J2-02 (20261028120000): a journalled correction whose current revisions are not yet all covered by a correction.
   'correctionPending',EXISTS(SELECT FROM gridex_billing_source.correction_journal j WHERE j.underlay_id=u.id)
     AND public.gridex_metering_correction_pending_v1(p_company_id,u.id)>0));$r$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = 'public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[])'::regprocedure;
  if (length(f.prosrc) - length(replace(f.prosrc, needle_branch, ''))) / length(needle_branch) <> 1
    or (length(f.prosrc) - length(replace(f.prosrc, needle_result, ''))) / length(needle_result) <> 1
    or position('D11-G1 (20261026120000)' in f.prosrc) = 0
    or position('J2-02 (20261028120000)' in f.prosrc) <> 0
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'j2_02_underlay_source_basis_predecessor_required' using errcode = 'P0U01';
  end if;
  body := replace(replace(f.prosrc, needle_branch, replacement_branch), needle_result, replacement_result);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'j2_02_underlay_source_basis_metadata_changed' using errcode = 'P0U01';
  end if;
end
$j202basis$;

do $j202export$
declare
  needle constant text := $n$     WHERE u.id=(item->>'billing_underlay_id')::uuid AND u.company_id=company AND u.payload->>'charge_kind'='break_fee_credit') THEN$n$;
  replacement constant text := $r$     WHERE u.id=(item->>'billing_underlay_id')::uuid AND u.company_id=company AND u.payload->>'charge_kind'='break_fee_credit')
    -- J2-02 (20261028120000): a metering-correction underlay is backed by its own correction row (owner decision 40).
    AND NOT EXISTS(SELECT FROM public.billing_underlays u JOIN public.metering_billing_corrections mc ON mc.company_id=u.company_id
      AND mc.correction_underlay_id=u.id AND mc.id::text=u.payload->>'metering_correction_id' AND mc.status IN ('underlaid','invoiced')
     WHERE u.id=(item->>'billing_underlay_id')::uuid AND u.company_id=company AND u.payload->>'charge_kind'='metering_correction') THEN$r$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = 'public.gridex_create_billing_export_run(jsonb,jsonb)'::regprocedure;
  if (length(f.prosrc) - length(replace(f.prosrc, needle, ''))) / length(needle) <> 1
    or position('H-B6b (20261027170000)' in f.prosrc) = 0
    or position('J2-02 (20261028120000)' in f.prosrc) <> 0
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'j2_02_export_run_predecessor_required' using errcode = 'P0U01';
  end if;
  body := replace(f.prosrc, needle, replacement);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'j2_02_export_run_metadata_changed' using errcode = 'P0U01';
  end if;
end
$j202export$;

commit;
