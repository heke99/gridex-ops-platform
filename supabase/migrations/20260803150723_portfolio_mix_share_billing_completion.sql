-- Complete mixed portfolio billing so spot, portfolio and fixed shares are all billed.
begin;

alter table public.customer_invoices
  add column if not exists fixed_share_percent numeric null,
  add column if not exists fixed_price_sek_per_kwh numeric null,
  add column if not exists fixed_energy_cost_sek numeric null;

alter table public.customer_invoices
  drop constraint if exists customer_invoices_portfolio_shares_check;

alter table public.customer_invoices
  add constraint customer_invoices_portfolio_shares_check
  check (
    (
      portfolio_share_percent is null
      and spot_share_percent is null
      and fixed_share_percent is null
    )
    or (
      portfolio_share_percent between 0 and 100
      and spot_share_percent between 0 and 100
      and fixed_share_percent between 0 and 100
      and abs(
        portfolio_share_percent
        + spot_share_percent
        + fixed_share_percent
        - 100
      ) <= 0.000001
    )
  );

alter table public.customer_invoices
  drop constraint if exists customer_invoices_fixed_price_nonnegative_check;
alter table public.customer_invoices
  add constraint customer_invoices_fixed_price_nonnegative_check
  check (fixed_price_sek_per_kwh is null or fixed_price_sek_per_kwh >= 0);

alter table public.customer_invoices
  drop constraint if exists customer_invoices_fixed_energy_cost_nonnegative_check;
alter table public.customer_invoices
  add constraint customer_invoices_fixed_energy_cost_nonnegative_check
  check (fixed_energy_cost_sek is null or fixed_energy_cost_sek >= 0);

create or replace function public.gridex_attach_portfolio_settlement_to_invoice(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_customer_invoice_id uuid,
  p_billing_underlay_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_binding public.portfolio_settlement_invoice_bindings%rowtype;
  v_settlement public.portfolio_monthly_settlements%rowtype;
  v_underlay public.billing_underlays%rowtype;
  v_version_snapshot jsonb;
  v_method jsonb;
  v_consumption numeric;
  v_portfolio_share numeric;
  v_spot_share numeric;
  v_fixed_share numeric;
  v_portfolio_cost numeric;
  v_spot_cost numeric;
  v_fixed_price numeric;
  v_fixed_cost numeric;
  v_management_fee numeric;
  v_other_fees numeric;
  v_calculation_snapshot jsonb;
  v_calculation_sha256 text;
begin
  if p_actor_user_id is null
     or not exists(select 1 from auth.users where id = p_actor_user_id) then
    raise exception using errcode = '42501', message = 'real_billing_actor_required';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'invoice_settlement_idempotency_key_required';
  end if;

  select *
    into v_binding
  from public.portfolio_settlement_invoice_bindings
  where company_id = p_company_id
    and invoice_idempotency_key = btrim(p_idempotency_key);

  if found then
    if v_binding.customer_invoice_id is distinct from p_customer_invoice_id
       or v_binding.billing_underlay_id is distinct from p_billing_underlay_id then
      raise exception using errcode = '23505', message = 'invoice_settlement_idempotency_scope_mismatch';
    end if;
    return (
      select to_jsonb(i)
      from public.customer_invoices i
      where i.id = p_customer_invoice_id
    );
  end if;

  select *
    into v_binding
  from public.portfolio_settlement_invoice_bindings
  where company_id = p_company_id
    and billing_underlay_id = p_billing_underlay_id;
  if not found then
    raise exception using errcode = '23514', message = 'portfolio_settlement_binding_required';
  end if;

  select *
    into v_settlement
  from public.portfolio_monthly_settlements
  where id = v_binding.portfolio_monthly_settlement_id
    and company_id = p_company_id
    and status = 'locked'
    and is_current;
  if not found then
    raise exception using errcode = '23514', message = 'locked_current_portfolio_settlement_required';
  end if;

  select *
    into v_underlay
  from public.billing_underlays
  where id = p_billing_underlay_id
    and company_id = p_company_id;
  if not found or v_underlay.contract_id is null then
    raise exception using errcode = '23514', message = 'exact_contract_billing_underlay_required';
  end if;

  select coalesce(v.snapshot_json, '{}'::jsonb)
    into v_version_snapshot
  from public.price_plan_versions v
  where v.id = v_settlement.price_plan_version_id
    and v.company_id = p_company_id;
  if not found then
    raise exception using errcode = '23514', message = 'portfolio_price_plan_version_required';
  end if;

  v_method := coalesce(v_version_snapshot -> 'portfolio_method', '{}'::jsonb);
  v_consumption := v_underlay.total_kwh;
  v_portfolio_share := coalesce(
    nullif(v_method #>> '{mix_shares,portfolio_weight_percent}', '')::numeric,
    100
  );
  v_spot_share := coalesce(
    nullif(v_method #>> '{mix_shares,spot_weight_percent}', '')::numeric,
    0
  );
  v_fixed_share := coalesce(
    nullif(v_method #>> '{mix_shares,fixed_weight_percent}', '')::numeric,
    0
  );

  if coalesce(v_consumption, 0) <= 0
     or v_portfolio_share < 0
     or v_spot_share < 0
     or v_fixed_share < 0
     or v_portfolio_share > 100
     or v_spot_share > 100
     or v_fixed_share > 100
     or abs(v_portfolio_share + v_spot_share + v_fixed_share - 100) > 0.000001 then
    raise exception using errcode = '23514', message = 'portfolio_invoice_mix_shares_must_total_100';
  end if;

  v_portfolio_cost :=
    v_consumption
    * (v_portfolio_share / 100)
    * (v_settlement.portfolio_price_ore_per_kwh / 100);

  if v_spot_share > 0 then
    v_spot_cost := nullif(
      v_underlay.pricing_snapshot #>> '{portfolio_billing,spot_energy_cost_sek}',
      ''
    )::numeric;
    if v_spot_cost is null or v_spot_cost < 0 then
      raise exception using errcode = '23514', message = 'final_spot_energy_cost_required_for_mixed_invoice';
    end if;
  else
    v_spot_cost := 0;
  end if;

  if v_fixed_share > 0 then
    select nullif(component ->> 'fixed_price_sek_per_kwh', '')::numeric
      into v_fixed_price
    from jsonb_array_elements(
      coalesce(v_version_snapshot -> 'base_components', '[]'::jsonb)
    ) component
    where component ->> 'source_type' = 'fixed'
      and coalesce(component ->> 'price_area', '') in ('', v_settlement.price_area_code)
    order by case
      when component ->> 'price_area' = v_settlement.price_area_code then 0
      else 1
    end
    limit 1;

    if v_fixed_price is null or v_fixed_price < 0 then
      raise exception using errcode = '23514', message = 'final_fixed_area_price_required_for_mixed_invoice';
    end if;
    v_fixed_cost := v_consumption * (v_fixed_share / 100) * v_fixed_price;
  else
    v_fixed_price := null;
    v_fixed_cost := 0;
  end if;

  v_management_fee :=
    v_consumption
    * (v_portfolio_share / 100)
    * (v_settlement.management_fee_ore_per_kwh / 100);
  v_other_fees := coalesce(
    nullif(v_underlay.pricing_snapshot #>> '{portfolio_billing,other_fees_sek}', '')::numeric,
    0
  );

  v_calculation_snapshot := jsonb_build_object(
    'customer_contract_id', v_underlay.contract_id,
    'price_plan_version_id', v_settlement.price_plan_version_id,
    'portfolio_monthly_settlement_id', v_settlement.id,
    'delivery_month', v_settlement.delivery_month,
    'price_area_code', v_settlement.price_area_code,
    'consumption_kwh', v_consumption,
    'portfolio_share_percent', v_portfolio_share,
    'spot_share_percent', v_spot_share,
    'fixed_share_percent', v_fixed_share,
    'portfolio_price_ore_per_kwh', v_settlement.portfolio_price_ore_per_kwh,
    'fixed_price_sek_per_kwh', v_fixed_price,
    'portfolio_energy_cost_sek', v_portfolio_cost,
    'spot_energy_cost_sek', v_spot_cost,
    'fixed_energy_cost_sek', v_fixed_cost,
    'management_fee_sek', v_management_fee,
    'other_fees_sek', v_other_fees,
    'energy_cost_sek_ex_vat', v_portfolio_cost + v_spot_cost + v_fixed_cost,
    'vat_rate', v_settlement.vat_rate,
    'settlement_snapshot_sha256', v_binding.settlement_sha256
  );
  v_calculation_sha256 := encode(
    extensions.digest(convert_to(v_calculation_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );

  update public.customer_invoices
  set billing_underlay_id = p_billing_underlay_id,
      contract_id = v_underlay.contract_id,
      customer_contract_id = v_underlay.contract_id,
      portfolio_id = v_settlement.portfolio_id,
      portfolio_monthly_settlement_id = v_settlement.id,
      price_plan_version_id = v_settlement.price_plan_version_id,
      portfolio_price_area_code = v_settlement.price_area_code,
      portfolio_delivery_month = v_settlement.delivery_month,
      portfolio_settlement_revision = v_settlement.revision_no,
      portfolio_settlement_status = v_settlement.status,
      portfolio_price_ore_per_kwh = v_settlement.portfolio_price_ore_per_kwh,
      portfolio_management_fee_ore_per_kwh = v_settlement.management_fee_ore_per_kwh,
      portfolio_gross_energy_cost_sek = v_settlement.gross_energy_cost_sek,
      portfolio_energy_volume_kwh = v_settlement.energy_volume_kwh,
      portfolio_settlement_sha256 = v_binding.settlement_sha256,
      portfolio_settlement_source = v_settlement.source,
      portfolio_settlement_snapshot = v_binding.settlement_snapshot,
      delivery_month = v_settlement.delivery_month,
      price_area_code = v_settlement.price_area_code,
      consumption_kwh = v_consumption,
      portfolio_share_percent = v_portfolio_share,
      spot_share_percent = v_spot_share,
      fixed_share_percent = v_fixed_share,
      fixed_price_sek_per_kwh = v_fixed_price,
      portfolio_energy_cost_sek = v_portfolio_cost,
      spot_energy_cost_sek = v_spot_cost,
      fixed_energy_cost_sek = v_fixed_cost,
      management_fee_sek = v_management_fee,
      other_fees_sek = v_other_fees,
      vat_rate = v_settlement.vat_rate,
      calculation_snapshot = v_calculation_snapshot,
      calculation_snapshot_sha256 = v_calculation_sha256,
      updated_at = now()
  where id = p_customer_invoice_id
    and company_id = p_company_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer_invoice_not_found';
  end if;

  update public.portfolio_settlement_invoice_bindings
  set customer_invoice_id = p_customer_invoice_id,
      invoice_idempotency_key = btrim(p_idempotency_key)
  where id = v_binding.id
    and customer_invoice_id is null;
  if not found and (
    v_binding.customer_invoice_id is distinct from p_customer_invoice_id
    or v_binding.invoice_idempotency_key is distinct from btrim(p_idempotency_key)
  ) then
    raise exception using errcode = '23505', message = 'portfolio_settlement_binding_already_attached';
  end if;

  return (
    select to_jsonb(i)
    from public.customer_invoices i
    where i.id = p_customer_invoice_id
  );
end $$;

create or replace function public.gridex_guard_portfolio_invoice_evidence()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.status in ('issued', 'sent', 'exported', 'paid') and (
    new.portfolio_id is distinct from old.portfolio_id
    or new.customer_contract_id is distinct from old.customer_contract_id
    or new.price_plan_version_id is distinct from old.price_plan_version_id
    or new.portfolio_monthly_settlement_id is distinct from old.portfolio_monthly_settlement_id
    or new.portfolio_settlement_revision is distinct from old.portfolio_settlement_revision
    or new.portfolio_settlement_sha256 is distinct from old.portfolio_settlement_sha256
    or new.portfolio_settlement_snapshot is distinct from old.portfolio_settlement_snapshot
    or new.portfolio_price_area_code is distinct from old.portfolio_price_area_code
    or new.portfolio_delivery_month is distinct from old.portfolio_delivery_month
    or new.portfolio_price_ore_per_kwh is distinct from old.portfolio_price_ore_per_kwh
    or new.portfolio_management_fee_ore_per_kwh is distinct from old.portfolio_management_fee_ore_per_kwh
    or new.portfolio_gross_energy_cost_sek is distinct from old.portfolio_gross_energy_cost_sek
    or new.portfolio_energy_volume_kwh is distinct from old.portfolio_energy_volume_kwh
    or new.delivery_month is distinct from old.delivery_month
    or new.price_area_code is distinct from old.price_area_code
    or new.consumption_kwh is distinct from old.consumption_kwh
    or new.portfolio_share_percent is distinct from old.portfolio_share_percent
    or new.spot_share_percent is distinct from old.spot_share_percent
    or new.fixed_share_percent is distinct from old.fixed_share_percent
    or new.fixed_price_sek_per_kwh is distinct from old.fixed_price_sek_per_kwh
    or new.portfolio_energy_cost_sek is distinct from old.portfolio_energy_cost_sek
    or new.spot_energy_cost_sek is distinct from old.spot_energy_cost_sek
    or new.fixed_energy_cost_sek is distinct from old.fixed_energy_cost_sek
    or new.management_fee_sek is distinct from old.management_fee_sek
    or new.other_fees_sek is distinct from old.other_fees_sek
    or new.vat_rate is distinct from old.vat_rate
    or new.calculation_snapshot is distinct from old.calculation_snapshot
    or new.calculation_snapshot_sha256 is distinct from old.calculation_snapshot_sha256
  ) then
    raise exception using errcode = '55000', message = 'issued_invoice_portfolio_evidence_immutable';
  end if;

  if new.status in ('issued', 'sent', 'exported', 'paid')
     and new.portfolio_id is not null
     and (
       new.portfolio_monthly_settlement_id is null
       or new.portfolio_settlement_status <> 'locked'
       or nullif(new.portfolio_settlement_sha256, '') is null
       or coalesce(new.portfolio_settlement_snapshot, '{}'::jsonb) = '{}'::jsonb
       or new.customer_contract_id is null
       or new.price_plan_version_id is null
       or new.delivery_month is null
       or new.price_area_code is null
       or new.consumption_kwh is null
       or new.portfolio_share_percent is null
       or new.spot_share_percent is null
       or new.fixed_share_percent is null
       or abs(
         new.portfolio_share_percent
         + new.spot_share_percent
         + new.fixed_share_percent
         - 100
       ) > 0.000001
       or new.portfolio_energy_cost_sek is null
       or new.spot_energy_cost_sek is null
       or new.fixed_energy_cost_sek is null
       or (new.fixed_share_percent > 0 and new.fixed_price_sek_per_kwh is null)
       or new.management_fee_sek is null
       or new.other_fees_sek is null
       or new.vat_rate is null
       or nullif(new.calculation_snapshot_sha256, '') is null
       or coalesce(new.calculation_snapshot, '{}'::jsonb) = '{}'::jsonb
     ) then
    raise exception using errcode = '23514', message = 'final_invoice_requires_locked_portfolio_settlement_evidence';
  end if;
  return new;
end $$;

revoke execute on function public.gridex_attach_portfolio_settlement_to_invoice(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.gridex_attach_portfolio_settlement_to_invoice(
  uuid, uuid, uuid, uuid, text
) to service_role;

commit;
