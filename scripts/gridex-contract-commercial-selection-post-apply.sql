\set ON_ERROR_STOP on

select
  case when to_regclass('public.contract_price_options') is not null
    then 1 else 1/0 end as contract_price_options_exists,
  case when to_regclass('public.contract_price_option_area_prices') is not null
    then 1 else 1/0 end as contract_price_option_area_prices_exists;

select
  case when exists(
    select 1
    from pg_proc
    where oid='public.gridex_upsert_internal_contract_offer_v3(uuid,uuid,jsonb,jsonb,uuid)'::regprocedure
  ) then 1 else 1/0 end as v3_offer_command_exists;

select
  case when count(*)=0 then 1 else 1/0 end as no_cross_tenant_options
from public.contract_price_options option_row
join public.price_plan_versions version_row
  on version_row.id=option_row.price_plan_version_id
where option_row.company_id<>version_row.company_id;

select
  case when count(*)=0 then 1 else 1/0 end as no_cross_version_area_rows
from public.contract_price_option_area_prices area_row
join public.contract_price_options option_row
  on option_row.id=area_row.contract_price_option_id
where area_row.company_id<>option_row.company_id
   or area_row.price_plan_version_id<>option_row.price_plan_version_id;

select
  case when count(*)=0 then 1 else 1/0 end as v6_quotes_complete
from public.website_contract_quotes quote
where quote.quote_hash_version='v3_commercial_selection'
  and (
    quote.price_option_reference is null
    or quote.invoice_delivery_method is null
    or jsonb_typeof(quote.resolved_base_components)<>'array'
    or jsonb_typeof(quote.resolved_price_components)<>'array'
  );

select
  status,
  reason_code,
  count(*) as rows
from public.contract_pricing_migration_reviews
group by status,reason_code
order by status,reason_code;
