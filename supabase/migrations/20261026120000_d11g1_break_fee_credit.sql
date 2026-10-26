-- FINDINGS D11-G1 / owner decision 33 (quality/audits/live-chain-20261015/OWNER-DECISIONS.md): an invoiced break fee is
-- credited, fully or partially, through the existing invoice engine (billing_adjustment_cases, a credit underlay, the
-- pricing run lock and the normal invoice export graph). The general credit endpoint stays closed; refunds are not part
-- of this and are tracked separately.
--
-- 1. public.break_fee_charges: status 'partially_credited' and credited_amount_ex_vat (0..amount_ex_vat).
-- 2. public.break_fee_credits: one row per credit of a charge (amount, reason, kind full/partial, the original invoice,
--    underlay, ledger event and VAT/accounting classification copied from the charge at request time, the adjustment
--    case, the credit underlay and, once invoiced, the credit invoice). Read by tenant members; written only below.
--    Trigger break_fee_credit_cap: the sum of a charge's credits never exceeds its debited amount (row lock on the
--    charge, so concurrent requests serialise).
-- 3. public.gridex_request_break_fee_credit_v1(company, charge, input {amount_ex_vat?, reason}, actor): caller = actor or
--    service_role, billing_underlay.export in the company. Locks the charge; requires it invoiced (or partially
--    credited) with no credit still waiting for its invoice; amount defaults to the remaining debit and never exceeds
--    it; a reason is required. Creates the adjustment case (original underlay and invoice, status credit_queued, the
--    actor as approver), the credit underlay (consumption_correction -> settlement credit_invoice, 0 kWh, the request's
--    Stockholm day, the original underlay's contract and price snapshot, readiness blocked until its pricing run is
--    locked; payload.charge_kind 'break_fee_credit') and the credit row, in one transaction.
-- 4. Triggers on public.customer_invoices: BEFORE INSERT for a credit underlay refuses a second invoice
--    (break_fee_credit_already_invoiced) or an amount other than minus the credit (break_fee_credit_amount_mismatch),
--    and stamps metadata.credit_of_invoice_id, credit_of_billing_underlay_id, break_fee_charge_id, break_fee_credit_id
--    and the credited fee line (ledger event); AFTER INSERT marks the credit invoiced, the case credited with the credit
--    invoice, and the charge partially_credited or credited with its credited amount.
-- 5. public.gridex_read_billing_underlay_source_basis_v1 (exact pre-image 12d91d8d..., the body after 20261025120000;
--    refused otherwise with d11g1_underlay_source_basis_pre_image_changed; metadata checked): a credit underlay is
--    qualified exactly when its own credit row binds it and is underlaid or invoiced.
begin;

alter table public.break_fee_charges drop constraint break_fee_charges_status_check;
alter table public.break_fee_charges add constraint break_fee_charges_status_check
  check (status in ('approved', 'underlaid', 'invoiced', 'partially_credited', 'credited', 'cancelled'));
alter table public.break_fee_charges add column credited_amount_ex_vat numeric(14, 2) not null default 0;
alter table public.break_fee_charges add constraint break_fee_charges_credited_amount_check
  check (credited_amount_ex_vat >= 0 and credited_amount_ex_vat <= amount_ex_vat);

create table public.break_fee_credits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  break_fee_charge_id uuid not null references public.break_fee_charges(id),
  original_invoice_id uuid not null,
  original_billing_underlay_id uuid not null references public.billing_underlays(id),
  original_fee_line jsonb not null check (jsonb_typeof(original_fee_line) = 'object'),
  adjustment_case_id uuid not null references public.billing_adjustment_cases(id),
  credit_underlay_id uuid not null unique references public.billing_underlays(id),
  credit_invoice_id uuid unique,
  amount_ex_vat numeric(14, 2) not null check (amount_ex_vat > 0),
  currency text not null check (currency = 'SEK'),
  vat_classification jsonb not null check (jsonb_typeof(vat_classification) = 'object'),
  kind text not null check (kind in ('full', 'partial')),
  reason text not null check (btrim(reason) <> ''),
  status text not null default 'underlaid' check (status in ('underlaid', 'invoiced')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  invoiced_at timestamptz,
  check ((status = 'invoiced') = (credit_invoice_id is not null))
);
alter table public.break_fee_credits enable row level security;
revoke all on table public.break_fee_credits from public, anon, authenticated, service_role;
grant select on table public.break_fee_credits to authenticated, service_role;
create policy break_fee_credits_tenant_read on public.break_fee_credits for select to authenticated
  using (public.gridex_can_write_company(company_id));

create function public.gridex_break_fee_credit_cap_v1()
returns trigger
language plpgsql
security definer
set search_path to public, extensions, pg_catalog, pg_temp
as $fn$
declare ch public.break_fee_charges%rowtype; v_sum numeric;
begin
  select * into ch from public.break_fee_charges where id = new.break_fee_charge_id and company_id = new.company_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'break_fee_charge_not_found_for_tenant'; end if;
  select coalesce(sum(amount_ex_vat), 0) into v_sum from public.break_fee_credits where break_fee_charge_id = ch.id;
  if v_sum + new.amount_ex_vat > ch.amount_ex_vat then
    raise exception using errcode = '23514', message = 'break_fee_credit_exceeds_debit';
  end if;
  return new;
end
$fn$;
revoke all on function public.gridex_break_fee_credit_cap_v1() from public, anon, authenticated, service_role;
create trigger break_fee_credit_cap before insert on public.break_fee_credits
  for each row execute function public.gridex_break_fee_credit_cap_v1();

create function public.gridex_request_break_fee_credit_v1(p_company_id uuid, p_charge_id uuid, p_input jsonb, p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public, extensions, pg_catalog, pg_temp
as $fn$
declare
  ch public.break_fee_charges%rowtype;
  u public.billing_underlays%rowtype;
  v_reason text := nullif(btrim(coalesce(p_input->>'reason', '')), '');
  v_remaining numeric;
  v_amount numeric;
  v_day date := (now() at time zone 'Europe/Stockholm')::date;
  v_line jsonb;
  v_case uuid;
  v_underlay uuid;
  v_credit uuid;
begin
  if p_company_id is null or p_charge_id is null or p_actor_user_id is null then
    raise exception using errcode = '22023', message = 'break_fee_credit_input_required';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_actor_user_id then
    raise exception using errcode = '42501', message = 'break_fee_actor_mismatch';
  end if;
  if not public.gridex_actor_has_company_permission(p_actor_user_id, p_company_id, 'billing_underlay.export') then
    raise exception using errcode = '42501', message = 'break_fee_credit_not_allowed';
  end if;
  select * into ch from public.break_fee_charges where id = p_charge_id and company_id = p_company_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'break_fee_charge_not_found_for_tenant'; end if;
  if ch.status not in ('invoiced', 'partially_credited') or ch.invoice_id is null or ch.billing_underlay_id is null then
    raise exception using errcode = '23514', message = 'break_fee_charge_not_invoiced';
  end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'break_fee_credit_reason_required'; end if;
  if exists (select from public.break_fee_credits c where c.break_fee_charge_id = ch.id and c.status = 'underlaid') then
    raise exception using errcode = '23514', message = 'break_fee_credit_pending';
  end if;
  select ch.amount_ex_vat - coalesce(sum(c.amount_ex_vat), 0) into v_remaining from public.break_fee_credits c where c.break_fee_charge_id = ch.id;
  v_amount := round(coalesce(nullif(p_input->>'amount_ex_vat', '')::numeric, v_remaining), 2);
  if v_amount <= 0 then raise exception using errcode = '22023', message = 'break_fee_credit_amount_invalid'; end if;
  if v_amount > v_remaining then raise exception using errcode = '23514', message = 'break_fee_credit_exceeds_debit'; end if;
  select * into u from public.billing_underlays where id = ch.billing_underlay_id and company_id = p_company_id;
  if not found then raise exception using errcode = 'P0002', message = 'break_fee_original_underlay_missing'; end if;
  if not exists (select from public.customer_invoices i where i.id = ch.invoice_id and i.company_id = p_company_id and i.billing_underlay_id = u.id) then
    raise exception using errcode = 'P0002', message = 'break_fee_original_invoice_missing';
  end if;
  if exists (select from public.billing_underlays x where x.company_id = p_company_id and x.customer_id = u.customer_id
             and x.metering_point_id is not distinct from u.metering_point_id and x.billing_period_start = v_day
             and x.energy_direction = 'consumption_correction' and x.payload->>'charge_kind' = 'break_fee_credit') then
    raise exception using errcode = '23514', message = 'break_fee_credit_same_day';
  end if;
  -- The credited fee line: the original charge's ledger event (gridex_lock_pricing_run, component break_fee).
  select jsonb_build_object('contract_charge_ledger_id', l.id, 'pricing_run_id', l.pricing_run_id, 'component_key', l.component_key,
           'event_key', l.event_key, 'amount_ex_vat', l.amount_ex_vat)
    into v_line
  from public.contract_charge_ledger l
  where l.company_id = p_company_id and l.customer_contract_id = ch.customer_contract_id and l.component_key = 'break_fee' and l.event_key = ch.id::text;
  if v_line is null then raise exception using errcode = 'P0002', message = 'break_fee_original_fee_line_missing'; end if;

  insert into public.billing_adjustment_cases (company_id, original_billing_underlay_id, original_invoice_id, reason, status,
    difference_minor_units, currency, approval_required, approved_by, approved_at, metadata)
  values (p_company_id, u.id, ch.invoice_id, 'break_fee_credit', 'credit_queued', -(v_amount * 100)::bigint, ch.currency, false,
    p_actor_user_id, now(), jsonb_build_object('break_fee_charge_id', ch.id, 'reason', v_reason, 'amount_ex_vat', v_amount))
  returning id into v_case;

  insert into public.billing_underlays (company_id, customer_id, site_id, customer_site_id, metering_point_id, contract_id,
    customer_contract_id, contract_price_snapshot_id, pricing_snapshot_id, underlay_year, underlay_month, billing_period_start,
    billing_period_end, status, readiness_status, total_kwh, currency, source_system, energy_direction, settlement_type,
    payload, metadata, created_by, updated_by)
  values (p_company_id, u.customer_id, u.site_id, u.customer_site_id, u.metering_point_id, u.contract_id, u.customer_contract_id,
    u.contract_price_snapshot_id, u.pricing_snapshot_id, extract(year from v_day)::int, extract(month from v_day)::int, v_day, v_day + 1,
    'validated', 'blocked', 0, ch.currency, 'break_fee_credit', 'consumption_correction', 'credit_invoice',
    jsonb_build_object('charge_kind', 'break_fee_credit', 'energy_direction', 'consumption_correction', 'break_fee_charge_id', ch.id,
      'original_invoice_id', ch.invoice_id, 'original_billing_underlay_id', u.id, 'adjustment_case_id', v_case,
      'billing_period_start_instant', v_day::timestamp at time zone 'Europe/Stockholm',
      'billing_period_end_instant', (v_day + 1)::timestamp at time zone 'Europe/Stockholm',
      'billing_period_timezone', 'Europe/Stockholm', 'billing_period_end_exclusive', true),
    jsonb_build_object('break_fee_charge_id', ch.id, 'adjustment_case_id', v_case), p_actor_user_id, p_actor_user_id)
  returning id into v_underlay;
  update public.billing_adjustment_cases set corrected_billing_underlay_id = v_underlay where id = v_case;

  insert into public.break_fee_credits (company_id, break_fee_charge_id, original_invoice_id, original_billing_underlay_id, original_fee_line,
    adjustment_case_id, credit_underlay_id, amount_ex_vat, currency, vat_classification, kind, reason, requested_by)
  values (p_company_id, ch.id, ch.invoice_id, u.id, v_line, v_case, v_underlay, v_amount, ch.currency, ch.vat_classification,
    case when v_amount = v_remaining and v_remaining = ch.amount_ex_vat then 'full' else 'partial' end, v_reason, p_actor_user_id)
  returning id into v_credit;
  update public.billing_underlays set payload = payload || jsonb_build_object('break_fee_credit_id', v_credit) where id = v_underlay;

  return jsonb_build_object('applied', true, 'creditId', v_credit, 'adjustmentCaseId', v_case, 'billingUnderlayId', v_underlay,
    'amountExVat', v_amount, 'remainingAfterExVat', v_remaining - v_amount);
end
$fn$;

create function public.gridex_break_fee_credit_invoice_guard_v1()
returns trigger
language plpgsql
security definer
set search_path to public, extensions, pg_catalog, pg_temp
as $fn$
declare cr public.break_fee_credits%rowtype;
begin
  if new.billing_underlay_id is null then return new; end if;
  select * into cr from public.break_fee_credits where credit_underlay_id = new.billing_underlay_id and company_id = new.company_id for update;
  if not found then return new; end if;
  if cr.credit_invoice_id is not null then
    raise exception using errcode = '23505', message = 'break_fee_credit_already_invoiced';
  end if;
  if coalesce(new.amount_ex_vat, 0) <> -cr.amount_ex_vat then
    raise exception using errcode = '23514', message = 'break_fee_credit_amount_mismatch';
  end if;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('credit_of_invoice_id', cr.original_invoice_id,
    'credit_of_billing_underlay_id', cr.original_billing_underlay_id, 'break_fee_charge_id', cr.break_fee_charge_id,
    'break_fee_credit_id', cr.id, 'credited_fee_lines', jsonb_build_array(cr.original_fee_line), 'credit_reason', cr.reason,
    'adjustment_case_id', cr.adjustment_case_id);
  return new;
end
$fn$;
revoke all on function public.gridex_break_fee_credit_invoice_guard_v1() from public, anon, authenticated, service_role;
create trigger break_fee_credit_invoice_guard before insert on public.customer_invoices
  for each row execute function public.gridex_break_fee_credit_invoice_guard_v1();

create function public.gridex_break_fee_credit_invoiced_v1()
returns trigger
language plpgsql
security definer
set search_path to public, extensions, pg_catalog, pg_temp
as $fn$
declare cr public.break_fee_credits%rowtype; v_total numeric;
begin
  if new.billing_underlay_id is null then return new; end if;
  select * into cr from public.break_fee_credits where credit_underlay_id = new.billing_underlay_id and company_id = new.company_id for update;
  if not found then return new; end if;
  update public.break_fee_credits set status = 'invoiced', credit_invoice_id = new.id, invoiced_at = now() where id = cr.id;
  update public.billing_adjustment_cases set credit_invoice_id = new.id, status = 'credited', updated_at = now() where id = cr.adjustment_case_id;
  select coalesce(sum(amount_ex_vat), 0) into v_total from public.break_fee_credits where break_fee_charge_id = cr.break_fee_charge_id and status = 'invoiced';
  update public.break_fee_charges
     set credited_amount_ex_vat = v_total,
         status = case when v_total >= amount_ex_vat then 'credited' else 'partially_credited' end,
         credit_invoice_id = new.id, credited_at = now(), updated_at = now()
   where id = cr.break_fee_charge_id;
  return new;
end
$fn$;
revoke all on function public.gridex_break_fee_credit_invoiced_v1() from public, anon, authenticated, service_role;
create trigger break_fee_credit_invoiced after insert on public.customer_invoices
  for each row execute function public.gridex_break_fee_credit_invoiced_v1();

do $d11g1basis$
declare
  fn constant regprocedure := 'public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[])'::regprocedure;
  pre_image constant text := '12d91d8dc29466088cfa2e8f40d6e51162c54a4226ffec12dceaee5cbc268fde';
  old_text constant text := $old$  IF u.payload->>'charge_kind'='break_fee' THEN$old$;
  new_text constant text := $new$  -- D11-G1 (20261026120000): a break-fee credit underlay is backed by its own credit row.
  IF u.payload->>'charge_kind'='break_fee_credit' THEN
   qualified:=EXISTS(SELECT FROM public.break_fee_credits cr WHERE cr.company_id=p_company_id AND cr.credit_underlay_id=u.id
     AND cr.id::text=u.payload->>'break_fee_credit_id' AND cr.status IN ('underlaid','invoiced'));
  ELSIF u.payload->>'charge_kind'='break_fee' THEN$new$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = fn;
  if encode(sha256(convert_to(f.prosrc, 'UTF8')), 'hex') is distinct from pre_image
    or (length(f.prosrc) - length(replace(f.prosrc, old_text, ''))) / length(old_text) <> 1
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'd11g1_underlay_source_basis_pre_image_changed' using errcode = 'P0U01';
  end if;
  body := replace(f.prosrc, old_text, new_text);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'd11g1_underlay_source_basis_metadata_changed' using errcode = 'P0U01';
  end if;
end
$d11g1basis$;

revoke all on function public.gridex_request_break_fee_credit_v1(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.gridex_request_break_fee_credit_v1(uuid, uuid, jsonb, uuid) to authenticated, service_role;

commit;
