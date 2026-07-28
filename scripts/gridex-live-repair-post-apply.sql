\set ON_ERROR_STOP on

-- The only writes in this transaction target a temporary table. Everything is
-- rolled back, so no persistent production object or row is changed.
begin;
set local statement_timeout = '120s';

create temporary table gridex_post_apply_failures(
  check_key text primary key,
  issue_count bigint not null,
  details jsonb not null default '{}'::jsonb
) on commit drop;

insert into gridex_post_apply_failures(check_key, issue_count)
select 'unsafe_pgcrypto_resolution', count(*)
from pg_proc routine
join pg_namespace namespace on namespace.oid = routine.pronamespace
where namespace.nspname = 'public'
  and pg_get_functiondef(routine.oid) ~
    '(digest|gen_random_bytes)[[:space:]]*[(]'
  and pg_get_functiondef(routine.oid) !~
    'extensions[.](digest|gen_random_bytes)[[:space:]]*[(]'
  and coalesce(array_to_string(routine.proconfig, ','), '')
    not like '%extensions%';

insert into gridex_post_apply_failures(check_key, issue_count, details)
select
  'missing_required_objects',
  count(*),
  coalesce(jsonb_agg(object_name order by object_name), '[]'::jsonb)
from (
  values
    ('company_onboarding_tasks', to_regclass('public.company_onboarding_tasks') is not null),
    ('communication_log_events', to_regclass('public.communication_log_events') is not null),
    ('customer_invoices.metadata', exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='customer_invoices'
        and column_name='metadata'
    )),
    ('customer_invoice_lines.vat_amount', exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='customer_invoice_lines'
        and column_name='vat_amount'
    )),
    ('customer_invoice_lines.amount_inc_vat', exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='customer_invoice_lines'
        and column_name='amount_inc_vat'
    )),
    ('invoice_provider_events.environment', exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='invoice_provider_events'
        and column_name='environment'
    )),
    ('billing_provider_webhook_events.environment', exists(
      select 1 from information_schema.columns
      where table_schema='public'
        and table_name='billing_provider_webhook_events'
        and column_name='environment'
    )),
    ('billing_provider_webhook_events.billing_provider_connection_id', exists(
      select 1 from information_schema.columns
      where table_schema='public'
        and table_name='billing_provider_webhook_events'
        and column_name='billing_provider_connection_id'
    )),
    ('billing_provider_webhook_events.signature_timestamp', exists(
      select 1 from information_schema.columns
      where table_schema='public'
        and table_name='billing_provider_webhook_events'
        and column_name='signature_timestamp'
    )),
    ('invoice_provider_events_provider_idempotency_uidx', to_regclass(
      'public.invoice_provider_events_provider_idempotency_uidx'
    ) is not null),
    ('billing_provider_webhook_events_provider_idempotency_uidx', to_regclass(
      'public.billing_provider_webhook_events_provider_idempotency_uidx'
    ) is not null),
    ('canonical_public_contract_offers_v.lifecycle_status', exists(
      select 1 from information_schema.columns
      where table_schema='public'
        and table_name='canonical_public_contract_offers_v'
        and column_name='lifecycle_status'
    )),
    ('canonical_public_contract_offers_v.energy_direction', exists(
      select 1 from information_schema.columns
      where table_schema='public'
        and table_name='canonical_public_contract_offers_v'
        and column_name='energy_direction'
    )),
    ('gridex_end_contract_channel', to_regprocedure(
      'public.gridex_end_contract_channel(uuid,uuid,text,uuid)'
    ) is not null),
    ('gridex_retry_website_contract_signature', to_regprocedure(
      'public.gridex_retry_website_contract_signature(uuid,uuid,uuid)'
    ) is not null)
) required(object_name, present)
where not present;

insert into gridex_post_apply_failures(check_key, issue_count)
select 'actionable_provider_events_without_environment', count(*)
from public.invoice_provider_events
where environment is null
  and status in ('received','processing','needs_review','failed');

insert into gridex_post_apply_failures(check_key, issue_count)
select 'received_provider_webhooks_without_environment', count(*)
from public.billing_provider_webhook_events
where environment is null
  and status = 'received';

insert into gridex_post_apply_failures(check_key, issue_count)
select 'published_contract_graph_inconsistent', count(*)
from public.contract_publication_graph_integrity_v graph
join public.public_contract_offers public_offer
  on public_offer.id = graph.public_contract_offer_id
where not coalesce(graph.canonical_graph_consistent, false)
  and public_offer.publication_status = 'published'
  and public_offer.is_public
  and public_offer.website_enabled;

insert into gridex_post_apply_failures(check_key, issue_count)
select 'invalid_contract_energy_direction', count(*)
from (
  select energy_direction from public.contract_offers
  union all select energy_direction from public.public_contract_offers
  union all select energy_direction from public.contract_product_versions
  union all select energy_direction from public.contract_publication_versions
  union all select energy_direction from public.customer_contracts
) direction
where nullif(lower(direction.energy_direction), '')
  not in ('consumption','production')
   or direction.energy_direction is null;

insert into gridex_post_apply_failures(check_key, issue_count)
select 'duplicate_active_supply_direction', count(*)
from (
  select
    company_id,
    coalesce(
      metering_point_id::text,
      'site:' || coalesce(customer_site_id, site_id)::text
    ),
    coalesce(nullif(lower(energy_direction), ''), 'consumption')
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
  having count(*) > 1
) duplicate;

insert into gridex_post_apply_failures(check_key, issue_count, details)
select
  'internal_core_execute_grants',
  count(*),
  coalesce(jsonb_agg(
    jsonb_build_object(
      'function', routine.proname,
      'role', role_name
    )
    order by routine.proname, role_name
  ), '[]'::jsonb)
from pg_proc routine
join pg_namespace namespace on namespace.oid = routine.pronamespace
cross join (
  values ('anon'), ('authenticated'), ('service_role')
) roles(role_name)
where namespace.nspname = 'public'
  and routine.proname in (
    'gridex_onboard_customer_graph_core',
    'gridex_upsert_internal_contract_offer',
    'gridex_create_invoice_export_graph_v1_core'
  )
  and has_function_privilege(role_name, routine.oid, 'EXECUTE');

select
  check_key,
  issue_count,
  details,
  case when issue_count = 0 then 'PASS' else 'FAIL' end as result
from gridex_post_apply_failures
order by check_key;

do $$
declare
  v_failures jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'check_key', check_key,
    'issue_count', issue_count,
    'details', details
  ) order by check_key)
  into v_failures
  from gridex_post_apply_failures
  where issue_count > 0;
  if v_failures is not null then
    raise exception using
      errcode = '23514',
      message = 'gridex_live_repair_post_apply_failed',
      detail = v_failures::text;
  end if;
end
$$;

rollback;
