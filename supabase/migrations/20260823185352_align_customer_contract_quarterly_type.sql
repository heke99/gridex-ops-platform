-- The canonical commercial engine supports variable_quarterly. Keep the
-- customer_contracts constraint aligned so a valid quarterly publication cannot
-- fail inside canonical customer onboarding with PostgreSQL 23514.

alter table public.customer_contracts
  drop constraint if exists customer_contracts_contract_type_check;

alter table public.customer_contracts
  add constraint customer_contracts_contract_type_check
  check (contract_type = any (array[
    'fixed'::text,
    'variable'::text,
    'variable_spot'::text,
    'variable_monthly'::text,
    'variable_hourly'::text,
    'variable_quarterly'::text,
    'hourly_spot'::text,
    'spot'::text,
    'portfolio'::text,
    'mixed'::text,
    'manual_override'::text
  ]));
