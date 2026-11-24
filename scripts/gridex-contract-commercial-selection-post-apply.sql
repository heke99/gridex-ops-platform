\set ON_ERROR_STOP on

begin transaction isolation level repeatable read read only;

do $verification$
begin
  if to_regclass('public.contract_price_options') is null
    or to_regclass('public.contract_price_option_area_prices') is null then
    raise exception 'commercial_selection_price_tables_missing'
      using errcode='55000';
  end if;

  if to_regprocedure('public.gridex_upsert_internal_contract_offer_v3(uuid,uuid,jsonb,jsonb,uuid)') is null then
    raise exception 'commercial_selection_v3_offer_command_missing'
      using errcode='55000';
  end if;

  if exists (
    select 1
    from public.contract_price_options option_row
    join public.price_plan_versions version_row
      on version_row.id=option_row.price_plan_version_id
    where option_row.company_id<>version_row.company_id
  ) then
    raise exception 'commercial_selection_cross_tenant_price_option'
      using errcode='23514';
  end if;

  if exists (
    select 1
    from public.contract_price_option_area_prices area_row
    join public.contract_price_options option_row
      on option_row.id=area_row.contract_price_option_id
    where area_row.company_id<>option_row.company_id
       or area_row.price_plan_version_id<>option_row.price_plan_version_id
  ) then
    raise exception 'commercial_selection_cross_scope_area_price'
      using errcode='23514';
  end if;

  if exists (
    select 1
    from public.website_contract_quotes quote
    where quote.quote_hash_version='v3_commercial_selection'
      and (
        quote.price_option_reference is null
        or quote.invoice_delivery_method is null
        or jsonb_typeof(quote.resolved_base_components) is distinct from 'array'
        or jsonb_typeof(quote.resolved_price_components) is distinct from 'array'
      )
  ) then
    raise exception 'commercial_selection_v3_quote_incomplete'
      using errcode='23514';
  end if;
end
$verification$;

select 1 as contract_price_options_exists, 1 as contract_price_option_area_prices_exists;
select 1 as v3_offer_command_exists;
select 1 as no_cross_tenant_options;
select 1 as no_cross_version_area_rows;
select 1 as v6_quotes_complete;

select
  status,
  reason_code,
  count(*) as rows
from public.contract_pricing_migration_reviews
group by status,reason_code
order by status,reason_code;

rollback;
