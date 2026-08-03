-- Index tenant-scoped foreign keys introduced by the contract and portfolio
-- consistency hardening so validation, deletion and billing joins remain fast.

begin;

create index if not exists price_plan_versions_company_price_plan_idx
  on public.price_plan_versions (company_id, price_plan_id);

create index if not exists contract_area_prices_company_option_idx
  on public.contract_price_option_area_prices (company_id, contract_price_option_id);

create index if not exists contract_area_prices_company_version_idx
  on public.contract_price_option_area_prices (company_id, price_plan_version_id);

create index if not exists portfolio_settlements_company_version_idx
  on public.portfolio_monthly_settlements (company_id, price_plan_version_id);

commit;
