\set ON_ERROR_STOP on

begin transaction read only;
set local statement_timeout = '90s';

select
  current_database() as database_name,
  current_user as database_user,
  current_setting('server_version') as postgres_version,
  now() as checked_at;

select
  table_name,
  column_name,
  data_type,
  case
    when table_name = 'customer_invoice_lines'
      and column_name in ('vat_amount', 'amount_inc_vat')
      then 'added_by_repair_if_missing'
    else 'present'
  end as repair_action
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'customer_invoice_lines'
      and column_name in (
        'amount_ex_vat','vat_rate','vat_amount','amount_inc_vat'
      ))
    or (table_name = 'customer_invoices' and column_name = 'metadata')
  )
order by table_name, ordinal_position;

select
  'invoice_provider_events.actionable_without_environment' as check_key,
  count(*) as issue_count
from public.invoice_provider_events
where to_jsonb(invoice_provider_events)->>'environment' is null
  and status in ('received','processing','needs_review','failed')
union all
select
  'billing_provider_webhook_events.received_without_environment',
  count(*)
from public.billing_provider_webhook_events
where to_jsonb(billing_provider_webhook_events)->>'environment' is null
  and status = 'received';

with required_object(object_name, object_oid) as (
  values
    ('extensions.digest(text,text)', to_regprocedure('extensions.digest(text,text)')::oid),
    ('extensions.digest(bytea,text)', to_regprocedure('extensions.digest(bytea,text)')::oid),
    ('gridex_onboard_customer_graph(jsonb)', to_regprocedure('public.gridex_onboard_customer_graph(jsonb)')::oid),
    ('gridex_onboard_customer_graph_core(jsonb)', to_regprocedure('public.gridex_onboard_customer_graph_core(jsonb)')::oid),
    ('gridex_sync_public_offer_to_canonical(uuid)', to_regprocedure('public.gridex_sync_public_offer_to_canonical(uuid)')::oid),
    ('gridex_sync_internal_offer_to_canonical(uuid)', to_regprocedure('public.gridex_sync_internal_offer_to_canonical(uuid)')::oid),
    ('gridex_record_customer_contract_event_v1', to_regprocedure('public.gridex_record_customer_contract_event_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,uuid,timestamptz,text)')::oid),
    ('canonical_public_contract_offers_v', to_regclass('public.canonical_public_contract_offers_v')::oid),
    ('contract_publication_graph_integrity_v', to_regclass('public.contract_publication_graph_integrity_v')::oid)
)
select object_name, object_oid is not null as present
from required_object
order by object_name;

select
  'contract_offers.invalid_energy_direction' as check_key,
  count(*) as issue_count
from public.contract_offers
where nullif(lower(energy_direction), '') not in ('consumption','production')
   or energy_direction is null
union all
select
  'public_contract_offers.invalid_energy_direction',
  count(*)
from public.public_contract_offers
where nullif(lower(energy_direction), '') not in ('consumption','production')
   or energy_direction is null
union all
select
  'contract_product_versions.invalid_energy_direction',
  count(*)
from public.contract_product_versions
where nullif(lower(energy_direction), '') not in ('consumption','production')
   or energy_direction is null
union all
select
  'contract_publication_versions.invalid_energy_direction',
  count(*)
from public.contract_publication_versions
where nullif(lower(energy_direction), '') not in ('consumption','production')
   or energy_direction is null
union all
select
  'customer_contracts.invalid_energy_direction',
  count(*)
from public.customer_contracts
where nullif(lower(energy_direction), '') not in ('consumption','production')
   or energy_direction is null;

select
  company_id,
  coalesce(
    metering_point_id::text,
    'site:' || coalesce(customer_site_id, site_id)::text
  ) as supply_identity,
  coalesce(nullif(lower(energy_direction), ''), 'consumption')
    as energy_direction,
  count(*) as active_contracts
from public.customer_contracts
where status = 'active'
  and company_id is not null
  and (
    metering_point_id is not null
    or coalesce(customer_site_id, site_id) is not null
  )
group by
  company_id,
  coalesce(
    metering_point_id::text,
    'site:' || coalesce(customer_site_id, site_id)::text
  ),
  coalesce(nullif(lower(energy_direction), ''), 'consumption')
having count(*) > 1;

select
  'published_graph_inconsistent_before_repair' as check_key,
  count(*) as issue_count
from public.contract_publication_graph_integrity_v graph
join public.public_contract_offers public_offer
  on public_offer.id = graph.public_contract_offer_id
where not coalesce(graph.canonical_graph_consistent, false)
  and public_offer.publication_status = 'published'
  and public_offer.is_public
  and public_offer.website_enabled;

select
  routine.proname,
  pg_get_function_identity_arguments(routine.oid) as arguments,
  routine.proconfig,
  case
    when pg_get_functiondef(routine.oid) ~
      'extensions[.](digest|gen_random_bytes)[[:space:]]*[(]'
      then 'qualified'
    when coalesce(array_to_string(routine.proconfig, ','), '')
      like '%extensions%'
      then 'search_path'
    else 'unsafe'
  end as crypto_resolution
from pg_proc routine
join pg_namespace namespace on namespace.oid = routine.pronamespace
where namespace.nspname = 'public'
  and pg_get_functiondef(routine.oid) ~
    '(digest|gen_random_bytes)[[:space:]]*[(]'
order by crypto_resolution, routine.proname, arguments;

do $$
declare
  v_missing text[];
  v_duplicate record;
begin
  select array_agg(object_name order by object_name)
  into v_missing
  from (
    values
      ('extensions.digest(text,text)', to_regprocedure('extensions.digest(text,text)') is not null),
      ('extensions.digest(bytea,text)', to_regprocedure('extensions.digest(bytea,text)') is not null),
      ('gridex_onboard_customer_graph(jsonb)', to_regprocedure('public.gridex_onboard_customer_graph(jsonb)') is not null),
      ('gridex_onboard_customer_graph_core(jsonb)', to_regprocedure('public.gridex_onboard_customer_graph_core(jsonb)') is not null),
      ('gridex_sync_public_offer_to_canonical(uuid)', to_regprocedure('public.gridex_sync_public_offer_to_canonical(uuid)') is not null),
      ('gridex_sync_internal_offer_to_canonical(uuid)', to_regprocedure('public.gridex_sync_internal_offer_to_canonical(uuid)') is not null)
  ) required(object_name, present)
  where not present;
  if coalesce(cardinality(v_missing), 0) > 0 then
    raise exception using
      errcode = '55000',
      message = 'gridex_repair_preflight_missing_objects',
      detail = array_to_string(v_missing, ', ');
  end if;

  select
    contract.company_id,
    coalesce(
      contract.metering_point_id::text,
      'site:' || coalesce(
        contract.customer_site_id,
        contract.site_id
      )::text
    ) as supply_identity,
    coalesce(
      nullif(lower(contract.energy_direction), ''),
      'consumption'
    ) as energy_direction,
    count(*) as total
  into v_duplicate
  from public.customer_contracts contract
  where contract.status = 'active'
    and contract.company_id is not null
    and (
      contract.metering_point_id is not null
      or coalesce(contract.customer_site_id, contract.site_id) is not null
    )
  group by
    contract.company_id,
    coalesce(
      contract.metering_point_id::text,
      'site:' || coalesce(
        contract.customer_site_id,
        contract.site_id
      )::text
    ),
    coalesce(
      nullif(lower(contract.energy_direction), ''),
      'consumption'
    )
  having count(*) > 1
  limit 1;
  if found then
    raise exception using
      errcode = '23505',
      message = 'active_customer_contract_duplicates_block_repair',
      detail = row_to_json(v_duplicate)::text;
  end if;
end
$$;

rollback;
