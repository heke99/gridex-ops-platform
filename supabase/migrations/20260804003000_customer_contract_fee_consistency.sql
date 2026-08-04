-- Preserve contract-wide agreement fees when a customer contract is created
-- from the catalog. Commercial price-option selection may change the selected
-- area price and optional components, but it must not remove the agreement's
-- monthly, invoice, environmental or one-time/conditional standard fees.
--
-- Existing signed/customer-specific contracts are not rewritten to match a
-- later offer edit. The offer is only projected when a catalog binding is
-- created or deliberately changed, and manual overrides remain untouched.

begin;

alter table public.customer_contracts
  add column if not exists invoice_fee_sek numeric;

alter table public.customer_contracts
  drop constraint if exists customer_contracts_invoice_fee_nonnegative;
alter table public.customer_contracts
  add constraint customer_contracts_invoice_fee_nonnegative
  check (invoice_fee_sek is null or invoice_fee_sek >= 0) not valid;

create or replace function public.gridex_apply_contract_offer_standard_fees()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.contract_offers%rowtype;
begin
  if new.contract_offer_id is null or new.company_id is null then
    return new;
  end if;

  -- Customer-specific/manual pricing is intentional and must not be replaced
  -- by catalog values merely because the original offer reference is retained.
  if coalesce(new.source_type, '') in ('manual', 'manual_override') then
    return new;
  end if;

  select offer.*
    into v_offer
  from public.contract_offers offer
  where offer.id = new.contract_offer_id
    and offer.company_id = new.company_id;

  if not found then
    return new;
  end if;

  new.monthly_fee_sek := v_offer.monthly_fee_sek;
  new.invoice_fee_sek := v_offer.invoice_fee_sek;
  new.green_fee_mode := v_offer.green_fee_mode;
  new.green_fee_value := v_offer.green_fee_value;
  new.discount_value := v_offer.discount_value;
  new.discount_unit := v_offer.discount_unit;
  new.start_fee_sek := v_offer.start_fee_sek;
  new.admin_fee_sek := v_offer.admin_fee_sek;
  new.break_fee_sek := v_offer.break_fee_sek;
  new.vat_rate := v_offer.vat_rate;

  return new;
end;
$$;

revoke all on function public.gridex_apply_contract_offer_standard_fees()
  from public, anon, authenticated;
grant execute on function public.gridex_apply_contract_offer_standard_fees()
  to service_role;

drop trigger if exists gridex_sync_customer_contract_offer_fees_trg
  on public.customer_contracts;
drop trigger if exists gridex_apply_contract_offer_standard_fees_trg
  on public.customer_contracts;
create trigger gridex_apply_contract_offer_standard_fees_trg
before insert or update of contract_offer_id, source_type
on public.customer_contracts
for each row
execute function public.gridex_apply_contract_offer_standard_fees();

-- Repair only missing compatibility scalars. Never overwrite an already frozen
-- value or a manual/customer-specific override in historical contracts.
update public.customer_contracts contract
set
  monthly_fee_sek = coalesce(contract.monthly_fee_sek, offer.monthly_fee_sek),
  invoice_fee_sek = coalesce(contract.invoice_fee_sek, offer.invoice_fee_sek),
  green_fee_value = coalesce(contract.green_fee_value, offer.green_fee_value),
  discount_value = coalesce(contract.discount_value, offer.discount_value),
  discount_unit = coalesce(contract.discount_unit, offer.discount_unit),
  start_fee_sek = coalesce(contract.start_fee_sek, offer.start_fee_sek),
  admin_fee_sek = coalesce(contract.admin_fee_sek, offer.admin_fee_sek),
  break_fee_sek = coalesce(contract.break_fee_sek, offer.break_fee_sek),
  vat_rate = coalesce(contract.vat_rate, offer.vat_rate),
  updated_at = now()
from public.contract_offers offer
where contract.contract_offer_id = offer.id
  and contract.company_id = offer.company_id
  and coalesce(contract.source_type, '') not in ('manual', 'manual_override')
  and (
    (contract.monthly_fee_sek is null and offer.monthly_fee_sek is not null)
    or (contract.invoice_fee_sek is null and offer.invoice_fee_sek is not null)
    or (contract.green_fee_value is null and offer.green_fee_value is not null)
    or (contract.discount_value is null and offer.discount_value is not null)
    or (contract.discount_unit is null and offer.discount_unit is not null)
    or (contract.start_fee_sek is null and offer.start_fee_sek is not null)
    or (contract.admin_fee_sek is null and offer.admin_fee_sek is not null)
    or (contract.break_fee_sek is null and offer.break_fee_sek is not null)
    or (contract.vat_rate is null and offer.vat_rate is not null)
  );

alter table public.customer_contracts
  validate constraint customer_contracts_invoice_fee_nonnegative;

comment on function public.gridex_apply_contract_offer_standard_fees() is
  'Projects catalog-wide standard fees into a newly bound customer contract without mutating manual overrides or tracking later offer edits.';

commit;
