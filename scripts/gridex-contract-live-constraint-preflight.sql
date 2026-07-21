-- Read-only preflight for the Gridex contract lifecycle migration.
-- Safe to run in Supabase SQL Editor before applying the migration.

select
  c.conrelid::regclass::text as table_name,
  c.conname as constraint_name,
  c.convalidated,
  pg_get_constraintdef(c.oid, true) as definition
from pg_constraint c
where c.contype = 'c'
  and c.conrelid in (
    'public.contract_offers'::regclass,
    'public.public_contract_offers'::regclass
  )
order by table_name, constraint_name;

with legacy as (
  select
    id,
    created_at,
    public_name,
    publication_status,
    is_public,
    is_archived,
    contract_type,
    customer_type,
    vat_rate,
    binding_months,
    notice_months,
    automatic_renewal,
    metadata->>'automatic_renewal_term_months' as metadata_renewal_term,
    discount_value,
    discount_unit,
    discount_months,
    start_fee_sek,
    administration_fee_sek,
    break_fee_sek,
    monthly_fee_sek,
    invoice_fee_sek
  from public.public_contract_offers
)
select
  id,
  public_name,
  publication_status,
  array_remove(array[
    case when vat_rate is not null and (vat_rate < 0 or vat_rate > 100) then 'vat_rate_out_of_range' end,
    case when binding_months is not null and binding_months < 0 then 'negative_binding_months' end,
    case when notice_months is not null and notice_months < 0 then 'negative_notice_months' end,
    case when automatic_renewal
      and not (
        coalesce(metadata_renewal_term, '') ~ '^[1-9][0-9]*$'
        or coalesce(binding_months, 0) > 0
      ) then 'automatic_renewal_term_missing' end,
    case when discount_value is not null and (
      discount_value < 0
      or (discount_unit = 'percent' and discount_value > 100)
      or coalesce(discount_months, 0) < 1
    ) then 'invalid_discount_configuration' end,
    case when start_fee_sek < 0 then 'negative_start_fee' end,
    case when administration_fee_sek < 0 then 'negative_administration_fee' end,
    case when break_fee_sek < 0 then 'negative_break_fee' end,
    case when monthly_fee_sek < 0 then 'negative_monthly_fee' end,
    case when invoice_fee_sek < 0 then 'negative_invoice_fee' end
  ], null) as migration_anomalies
from legacy
where
  (vat_rate is not null and (vat_rate < 0 or vat_rate > 100))
  or (binding_months is not null and binding_months < 0)
  or (notice_months is not null and notice_months < 0)
  or (
    automatic_renewal
    and not (
      coalesce(metadata_renewal_term, '') ~ '^[1-9][0-9]*$'
      or coalesce(binding_months, 0) > 0
    )
  )
  or (discount_value is not null and (
    discount_value < 0
    or (discount_unit = 'percent' and discount_value > 100)
    or coalesce(discount_months, 0) < 1
  ))
  or start_fee_sek < 0
  or administration_fee_sek < 0
  or break_fee_sek < 0
  or monthly_fee_sek < 0
  or invoice_fee_sek < 0
order by created_at nulls last, id;
