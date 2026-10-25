-- FINDINGS H3d D11 / owner decision 28, slice 2 of 2: an approved break fee (public.break_fee_charges, slice 1
-- 20261025110000) becomes its own billing underlay and, by default, its own invoice through the existing invoice engine
-- (pricing run -> gridex_lock_pricing_run -> gridex_create_invoice_export_graph_v1_core). No parallel invoicing.
--
-- 1. public.gridex_underlay_break_fee_v1(company, charge, actor): same actor/permission rule as the approval
--    (caller = actor or service_role; billing_underlay.export). For an 'approved' charge it inserts one billing underlay:
--    the charge's contract, customer, site, metering point and the contract price snapshot valid on the supply end day;
--    period = that Stockholm day [supply end, +1 day), so it never shares the energy underlay's segment
--    (billing_underlays_company_segment_uidx); total_kwh 0; payload.charge_kind = 'break_fee' with the charge id; status
--    'validated', readiness 'blocked' until its pricing run is locked (gridex_lock_pricing_run sets 'ready'). All existing
--    underlay guards apply (exact refs, customer chain, price area, energy flow, retention). The charge becomes
--    'underlaid' with the underlay id. A repeated call returns the existing underlay (idempotent).
-- 2. Trigger break_fee_charge_invoiced on public.customer_invoices (AFTER INSERT): an invoice of a break-fee underlay
--    marks its charge 'invoiced' with the invoice id. A second invoice of the same underlay is refused
--    (break_fee_already_invoiced): the fee is invoiced once.
-- 3. public.gridex_read_billing_underlay_source_basis_v1 (exact pre-image 496d105d..., same as supabase/schema.sql;
--    refused otherwise with d11_underlay_source_basis_pre_image_changed; metadata checked): a break-fee underlay has no
--    metering source; it is qualified exactly when its own approved charge is bound to it ('underlaid' or 'invoiced').
--    Every other underlay keeps gridex_billing_source.require_underlay_v1 unchanged.
-- 4. public.gridex_record_break_fee_credit_v1(company, charge, credit invoice, actor): links the credit invoice to an
--    'invoiced' charge only when a billing_adjustment_cases row of the company names the charge's invoice as original and
--    this credit invoice; the charge becomes 'credited' with credit_invoice_id and credited_at (traceable to the original).
begin;

create function public.gridex_underlay_break_fee_v1(p_company_id uuid, p_charge_id uuid, p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public, extensions, pg_catalog, pg_temp
as $fn$
declare
  ch public.break_fee_charges%rowtype;
  t public.customer_operation_tasks%rowtype;
  c public.customer_contracts%rowtype;
  snap public.contract_price_snapshots%rowtype;
  v_day date;
  v_start timestamptz;
  v_end timestamptz;
  v_underlay uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_actor_user_id then
    raise exception using errcode = '42501', message = 'break_fee_actor_mismatch';
  end if;
  if not public.gridex_actor_has_company_permission(p_actor_user_id, p_company_id, 'billing_underlay.export') then
    raise exception using errcode = '42501', message = 'break_fee_underlay_not_allowed';
  end if;
  select * into ch from public.break_fee_charges where id = p_charge_id and company_id = p_company_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'break_fee_charge_not_found_for_tenant';
  end if;
  if ch.billing_underlay_id is not null then
    return jsonb_build_object('applied', false, 'reason', 'already_underlaid', 'billingUnderlayId', ch.billing_underlay_id, 'status', ch.status);
  end if;
  if ch.status is distinct from 'approved' then
    raise exception using errcode = '23514', message = 'break_fee_charge_not_approved';
  end if;
  select * into t from public.customer_operation_tasks where id = ch.review_task_id and company_id = p_company_id;
  select * into c from public.customer_contracts where id = ch.customer_contract_id and company_id = p_company_id;
  v_day := nullif(t.metadata->>'supply_end_date', '')::date;
  if v_day is null or c.id is null then
    raise exception using errcode = '23514', message = 'break_fee_underlay_context_missing';
  end if;
  v_start := v_day::timestamp at time zone 'Europe/Stockholm';
  v_end := (v_day + 1)::timestamp at time zone 'Europe/Stockholm';
  select s.* into snap from public.contract_price_snapshots s
  where s.company_id = p_company_id and s.contract_id = c.id
    and s.valid_from <= v_day and (s.valid_to is null or s.valid_to > v_day)
  order by s.valid_from desc limit 1;
  if snap.id is null then
    raise exception using errcode = '23514', message = 'break_fee_price_snapshot_missing';
  end if;

  insert into public.billing_underlays (company_id, customer_id, site_id, customer_site_id, metering_point_id, contract_id,
    customer_contract_id, contract_price_snapshot_id, pricing_snapshot_id, underlay_year, underlay_month, billing_period_start,
    billing_period_end, status, readiness_status, total_kwh, currency, source_system, energy_direction, settlement_type,
    payload, metadata, created_by, updated_by)
  values (p_company_id, ch.customer_id, coalesce(c.site_id, c.customer_site_id), coalesce(c.customer_site_id, c.site_id),
    c.metering_point_id, c.id, c.id, snap.id, snap.id, extract(year from v_day)::int, extract(month from v_day)::int, v_day,
    v_day + 1, 'validated', 'blocked', 0, ch.currency, 'break_fee_review', 'consumption', 'invoice',
    jsonb_build_object('charge_kind', 'break_fee', 'break_fee_charge_id', ch.id, 'billing_period_start_instant', v_start,
      'billing_period_end_instant', v_end, 'billing_period_timezone', 'Europe/Stockholm', 'billing_period_end_exclusive', true),
    jsonb_build_object('break_fee_charge_id', ch.id, 'review_task_id', ch.review_task_id), p_actor_user_id, p_actor_user_id)
  returning id into v_underlay;

  update public.break_fee_charges set status = 'underlaid', billing_underlay_id = v_underlay, updated_at = now() where id = ch.id;
  return jsonb_build_object('applied', true, 'billingUnderlayId', v_underlay, 'status', 'underlaid');
end
$fn$;

create function public.gridex_break_fee_charge_invoiced_v1()
returns trigger
language plpgsql
security definer
set search_path to public, extensions, pg_catalog, pg_temp
as $fn$
declare ch public.break_fee_charges%rowtype;
begin
  if new.billing_underlay_id is null then return new; end if;
  select * into ch from public.break_fee_charges where billing_underlay_id = new.billing_underlay_id and company_id = new.company_id for update;
  if not found then return new; end if;
  if ch.invoice_id is not null and ch.invoice_id is distinct from new.id then
    raise exception using errcode = '23505', message = 'break_fee_already_invoiced';
  end if;
  update public.break_fee_charges set status = 'invoiced', invoice_id = new.id, updated_at = now() where id = ch.id;
  return new;
end
$fn$;
revoke all on function public.gridex_break_fee_charge_invoiced_v1() from public, anon, authenticated, service_role;
create trigger break_fee_charge_invoiced after insert on public.customer_invoices
  for each row execute function public.gridex_break_fee_charge_invoiced_v1();

create function public.gridex_record_break_fee_credit_v1(p_company_id uuid, p_charge_id uuid, p_credit_invoice_id uuid, p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public, extensions, pg_catalog, pg_temp
as $fn$
declare ch public.break_fee_charges%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_actor_user_id then
    raise exception using errcode = '42501', message = 'break_fee_actor_mismatch';
  end if;
  if not public.gridex_actor_has_company_permission(p_actor_user_id, p_company_id, 'billing_underlay.export') then
    raise exception using errcode = '42501', message = 'break_fee_credit_not_allowed';
  end if;
  select * into ch from public.break_fee_charges where id = p_charge_id and company_id = p_company_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'break_fee_charge_not_found_for_tenant';
  end if;
  if ch.status = 'credited' and ch.credit_invoice_id = p_credit_invoice_id then
    return jsonb_build_object('applied', false, 'reason', 'already_credited', 'status', ch.status);
  end if;
  if ch.status is distinct from 'invoiced' or ch.invoice_id is null then
    raise exception using errcode = '23514', message = 'break_fee_charge_not_invoiced';
  end if;
  if not exists (select from public.billing_adjustment_cases a
                 where a.company_id = p_company_id and a.original_invoice_id = ch.invoice_id and a.credit_invoice_id = p_credit_invoice_id) then
    raise exception using errcode = '23514', message = 'break_fee_credit_not_traceable';
  end if;
  update public.break_fee_charges set status = 'credited', credit_invoice_id = p_credit_invoice_id, credited_at = now(), updated_at = now()
  where id = ch.id;
  return jsonb_build_object('applied', true, 'status', 'credited');
end
$fn$;

do $d11basis$
declare
  fn constant regprocedure := 'public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[])'::regprocedure;
  pre_image constant text := '496d105d3460b02556c830318043efd3cb8939b97475690729b325b50787cbb7';
  old_text constant text := $old$  BEGIN PERFORM gridex_billing_source.require_underlay_v1(p_company_id,u.id);
  EXCEPTION WHEN check_violation THEN qualified:=false; END;$old$;
  new_text constant text := $new$  -- D11 (20261025120000): a break-fee underlay is backed by its own approved charge, not by metering values.
  IF u.payload->>'charge_kind'='break_fee' THEN
   qualified:=EXISTS(SELECT FROM public.break_fee_charges ch WHERE ch.company_id=p_company_id AND ch.billing_underlay_id=u.id
     AND ch.id::text=u.payload->>'break_fee_charge_id' AND ch.status IN ('underlaid','invoiced'));
  ELSE
  BEGIN PERFORM gridex_billing_source.require_underlay_v1(p_company_id,u.id);
  EXCEPTION WHEN check_violation THEN qualified:=false; END;
  END IF;$new$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = fn;
  if encode(sha256(convert_to(f.prosrc, 'UTF8')), 'hex') is distinct from pre_image
    or (length(f.prosrc) - length(replace(f.prosrc, old_text, ''))) / length(old_text) <> 1
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'd11_underlay_source_basis_pre_image_changed' using errcode = 'P0U01';
  end if;
  body := replace(f.prosrc, old_text, new_text);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'd11_underlay_source_basis_metadata_changed' using errcode = 'P0U01';
  end if;
end
$d11basis$;

revoke all on function public.gridex_underlay_break_fee_v1(uuid, uuid, uuid) from public, anon;
grant execute on function public.gridex_underlay_break_fee_v1(uuid, uuid, uuid) to authenticated, service_role;
revoke all on function public.gridex_record_break_fee_credit_v1(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.gridex_record_break_fee_credit_v1(uuid, uuid, uuid, uuid) to authenticated, service_role;

commit;
