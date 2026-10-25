-- FINDINGS H3d D11 / owner decision 28 (quality/audits/live-chain-20261015/OWNER-DECISIONS.md), slice 1 of 2.
-- A break fee is charged only after operator review and approval, as a separate, traceable charge that the existing
-- invoice engine invoices (slice 2: its own billing underlay and invoice). This slice adds the charge record and the
-- approval with every eligibility rule of the decision; nothing is invoiced by it.
--
-- public.break_fee_charges: one row per approved fee, bound to its review task (customer_operation_tasks
-- 'break_fee_review', H3d B2/B5) and contract. It keeps the contract version (contract_version/terms_version and the
-- signed snapshot hash), the customer category and its basis, the contract basis, the calculation and the loss basis,
-- the VAT/accounting classification and who approved it. One fee per contract and review (unique), any status; a
-- credit keeps the row and links the credit invoice. Read by tenant members; written only by the functions below.
--
-- public.gridex_approve_break_fee_v1(company, review_task, input, actor): the only writer. Refuses unless
--   * the caller is the actor (or service_role) and the actor has billing_underlay.export in the company;
--   * the task is an open break_fee_review of the company and its contract, and the binding ends after the supply end;
--   * consumer and small business: a time-bound contract with a fixed-price share (contract_type 'fixed', or 'mixed'/
--     'portfolio' with fixed_price_ore_per_kwh); never for variable price or a portfolio without a fixed part; the
--     amount is at most the computed loss (max(0, fixed price - replacement price) x remaining expected volume);
--   * large business: an explicit contract rule reference (contract_rule_reference) and a recorded loss basis;
--   * the calculation never includes remaining monthly fees or administrative switch fees;
--   * a verified VAT/accounting classification (code, vat_rate 0..0.25, account, verified_by, verified_at, source).
-- On success it inserts the charge and resolves the task with a link, in one transaction. A repeated call for the same
-- task returns the existing charge (idempotent, applied=false); it never creates a second fee.
begin;

create table public.break_fee_charges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  customer_id uuid not null,
  customer_contract_id uuid not null references public.customer_contracts(id),
  review_task_id uuid not null references public.customer_operation_tasks(id),
  contract_version jsonb not null check (jsonb_typeof(contract_version) = 'object'),
  customer_category text not null check (customer_category in ('consumer', 'small_business', 'large_business')),
  category_basis jsonb not null check (jsonb_typeof(category_basis) = 'object' and category_basis <> '{}'::jsonb),
  contract_basis text not null check (contract_basis in ('consumer_fixed_term_fixed_price', 'small_business_fixed_term_fixed_price', 'large_business_contract_rule')),
  contract_rule_reference text,
  calculation jsonb not null check (jsonb_typeof(calculation) = 'object'),
  loss_basis jsonb not null check (jsonb_typeof(loss_basis) = 'object' and loss_basis <> '{}'::jsonb),
  amount_ex_vat numeric(14, 2) not null check (amount_ex_vat > 0),
  currency text not null default 'SEK' check (currency = 'SEK'),
  vat_classification jsonb not null check (jsonb_typeof(vat_classification) = 'object'),
  status text not null default 'approved' check (status in ('approved', 'underlaid', 'invoiced', 'credited', 'cancelled')),
  approved_by uuid not null,
  approved_at timestamptz not null default now(),
  billing_underlay_id uuid references public.billing_underlays(id),
  invoice_id uuid,
  credit_invoice_id uuid,
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_task_id),
  unique (customer_contract_id),
  check (contract_basis <> 'large_business_contract_rule' or nullif(btrim(contract_rule_reference), '') is not null),
  check ((customer_category = 'large_business') = (contract_basis = 'large_business_contract_rule'))
);
alter table public.break_fee_charges enable row level security;
revoke all on table public.break_fee_charges from public, anon, authenticated, service_role;
grant select on table public.break_fee_charges to authenticated, service_role;
create policy break_fee_charges_tenant_read on public.break_fee_charges for select to authenticated
  using (public.gridex_can_write_company(company_id));

create function public.gridex_approve_break_fee_v1(p_company_id uuid, p_review_task_id uuid, p_input jsonb, p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public, extensions, pg_catalog, pg_temp
as $fn$
declare
  t public.customer_operation_tasks%rowtype;
  c public.customer_contracts%rowtype;
  existing public.break_fee_charges%rowtype;
  v_category text := p_input->>'customer_category';
  v_basis text;
  v_calc jsonb := coalesce(p_input->'calculation', '{}'::jsonb);
  v_vat jsonb := coalesce(p_input->'vat_classification', '{}'::jsonb);
  v_amount numeric := nullif(p_input->>'amount_ex_vat', '')::numeric;
  v_fixed numeric; v_replacement numeric; v_volume numeric; v_loss numeric;
  v_has_fixed boolean;
  v_row public.break_fee_charges%rowtype;
begin
  if p_company_id is null or p_review_task_id is null or p_actor_user_id is null then
    raise exception using errcode = '22023', message = 'break_fee_input_required';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_actor_user_id then
    raise exception using errcode = '42501', message = 'break_fee_actor_mismatch';
  end if;
  if not public.gridex_actor_has_company_permission(p_actor_user_id, p_company_id, 'billing_underlay.export') then
    raise exception using errcode = '42501', message = 'break_fee_approval_not_allowed';
  end if;

  select * into t from public.customer_operation_tasks where id = p_review_task_id and company_id = p_company_id for update;
  if not found or t.task_type is distinct from 'break_fee_review' then
    raise exception using errcode = 'P0002', message = 'break_fee_review_not_found_for_tenant';
  end if;
  select * into existing from public.break_fee_charges where review_task_id = t.id;
  if found then
    return jsonb_build_object('applied', false, 'reason', 'already_approved', 'chargeId', existing.id, 'status', existing.status);
  end if;
  if t.status is null or t.status not in ('open', 'in_progress') then
    raise exception using errcode = '23514', message = 'break_fee_review_not_open';
  end if;
  select * into c from public.customer_contracts
  where id = nullif(t.metadata->>'contract_id', '')::uuid and company_id = p_company_id and customer_id = t.customer_id
  for share;
  if not found then
    raise exception using errcode = '23514', message = 'break_fee_contract_not_found';
  end if;
  if coalesce(c.binding_months, 0) <= 0
    or nullif(t.metadata->>'binding_ends_at', '') is null or nullif(t.metadata->>'supply_end_date', '') is null
    or (t.metadata->>'binding_ends_at')::date <= (t.metadata->>'supply_end_date')::date then
    raise exception using errcode = '23514', message = 'break_fee_not_inside_binding';
  end if;

  if v_category is null or v_category not in ('consumer', 'small_business', 'large_business') then
    raise exception using errcode = '22023', message = 'break_fee_customer_category_required';
  end if;
  if jsonb_typeof(p_input->'category_basis') is distinct from 'object' or p_input->'category_basis' = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'break_fee_category_basis_required';
  end if;
  if jsonb_typeof(p_input->'loss_basis') is distinct from 'object' or p_input->'loss_basis' = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'break_fee_loss_basis_required';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception using errcode = '22023', message = 'break_fee_amount_required';
  end if;
  -- Never remaining monthly fees or administrative switch fees.
  if exists (select from jsonb_array_elements_text(coalesce(v_calc->'components', '[]'::jsonb)) k
             where k not in ('price_difference')) then
    raise exception using errcode = '23514', message = 'break_fee_component_not_allowed';
  end if;
  if v_vat->>'code' is null or v_vat->>'account' is null or v_vat->>'verified_by' is null or v_vat->>'verified_at' is null
    or v_vat->>'source' is null or nullif(v_vat->>'vat_rate', '') is null
    or (v_vat->>'vat_rate')::numeric < 0 or (v_vat->>'vat_rate')::numeric > 0.25 then
    raise exception using errcode = '22023', message = 'break_fee_vat_classification_unverified';
  end if;

  v_has_fixed := c.contract_type = 'fixed' or (c.contract_type in ('mixed', 'portfolio') and c.fixed_price_ore_per_kwh is not null);
  if v_category in ('consumer', 'small_business') then
    if not v_has_fixed then
      raise exception using errcode = '23514', message = 'break_fee_requires_fixed_price_share';
    end if;
    v_fixed := coalesce(nullif(v_calc->>'fixed_price_ore_per_kwh', '')::numeric, c.fixed_price_ore_per_kwh);
    v_replacement := nullif(v_calc->>'replacement_price_ore_per_kwh', '')::numeric;
    v_volume := nullif(v_calc->>'remaining_expected_kwh', '')::numeric;
    if v_fixed is null or v_replacement is null or v_volume is null or v_volume < 0 then
      raise exception using errcode = '22023', message = 'break_fee_calculation_incomplete';
    end if;
    v_loss := round(greatest(0, v_fixed - v_replacement) * v_volume / 100, 2);
    if v_amount > v_loss then
      raise exception using errcode = '23514', message = 'break_fee_exceeds_loss', detail = v_loss::text;
    end if;
    v_basis := case v_category when 'consumer' then 'consumer_fixed_term_fixed_price' else 'small_business_fixed_term_fixed_price' end;
  else
    if nullif(btrim(p_input->>'contract_rule_reference'), '') is null then
      raise exception using errcode = '23514', message = 'break_fee_contract_rule_required';
    end if;
    v_basis := 'large_business_contract_rule';
  end if;

  insert into public.break_fee_charges (company_id, customer_id, customer_contract_id, review_task_id, contract_version,
    customer_category, category_basis, contract_basis, contract_rule_reference, calculation, loss_basis, amount_ex_vat,
    vat_classification, approved_by)
  values (p_company_id, t.customer_id, c.id, t.id,
    jsonb_build_object('contract_version', c.contract_version, 'terms_version', c.terms_version, 'signed_version', c.signed_version,
      'snapshot_hash', c.snapshot_hash, 'signature_snapshot_sha256', c.signature_snapshot_sha256, 'contract_type', c.contract_type,
      'binding_months', c.binding_months, 'fixed_price_ore_per_kwh', c.fixed_price_ore_per_kwh),
    v_category, p_input->'category_basis', v_basis, nullif(btrim(p_input->>'contract_rule_reference'), ''),
    v_calc || case when v_loss is null then '{}'::jsonb else jsonb_build_object('computed_loss_sek', v_loss) end,
    p_input->'loss_basis', v_amount, v_vat, p_actor_user_id)
  returning * into v_row;

  update public.customer_operation_tasks
     set status = 'done', resolved_at = now(), updated_at = now(), updated_by = p_actor_user_id,
         metadata = metadata || jsonb_build_object('break_fee_charge_id', v_row.id, 'decision', 'approved', 'charged_automatically', false)
   where id = t.id;
  return jsonb_build_object('applied', true, 'chargeId', v_row.id, 'status', v_row.status, 'computedLossSek', v_loss);
end
$fn$;

revoke all on function public.gridex_approve_break_fee_v1(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.gridex_approve_break_fee_v1(uuid, uuid, jsonb, uuid) to authenticated, service_role;

commit;
