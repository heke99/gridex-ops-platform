-- Post-apply verification for the canonical multitenant website application flow.
-- Safe to rerun. It writes only to a transaction-local temporary table,
-- fails closed on schema/ledger drift, and always ends with ROLLBACK.

begin;

create temporary table _gridex_flow_verification (
  check_name text primary key,
  passed boolean not null,
  details jsonb not null default '{}'::jsonb
) on commit drop;

insert into _gridex_flow_verification(check_name, passed, details)
select 'migration_20260804003000_registered', exists (
  select 1 from supabase_migrations.schema_migrations
  where version::text = '20260804003000'
    and name = 'customer_contract_fee_consistency'
), '{}'::jsonb;

insert into _gridex_flow_verification(check_name, passed, details)
select 'migration_20260804093500_registered', exists (
  select 1 from supabase_migrations.schema_migrations
  where version::text = '20260804093500'
    and name = 'contract_publication_two_step_invoice_fee_repair'
), '{}'::jsonb;

insert into _gridex_flow_verification(check_name, passed, details)
select 'migration_20260804121000_registered', exists (
  select 1 from supabase_migrations.schema_migrations
  where version::text = '20260804121000'
    and name = 'multitenant_website_application_flow_completion'
), '{}'::jsonb;

insert into _gridex_flow_verification(check_name, passed, details)
select 'customer_portal_url_column', exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'companies'
    and column_name = 'customer_portal_url' and data_type = 'text'
), '{}'::jsonb;

insert into _gridex_flow_verification(check_name, passed, details)
select 'portal_identity_required_column', exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'website_customer_applications'
    and column_name = 'portal_identity_required'
    and data_type = 'boolean' and is_nullable = 'NO'
), '{}'::jsonb;

insert into _gridex_flow_verification(check_name, passed, details)
select 'portal_url_constraint_validated', exists (
  select 1 from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public' and rel.relname = 'companies'
    and con.conname = 'companies_customer_portal_url_https_check'
    and con.convalidated
), '{}'::jsonb;

insert into _gridex_flow_verification(check_name, passed, details)
select 'portal_identity_trigger', exists (
  select 1 from pg_trigger tg
  join pg_class rel on rel.oid = tg.tgrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public'
    and rel.relname = 'website_customer_applications'
    and tg.tgname = 'gridex_validate_website_application_portal_identity'
    and not tg.tgisinternal
    and tg.tgenabled <> 'D'
), '{}'::jsonb;

insert into _gridex_flow_verification(check_name, passed, details)
select 'terminal_projection_trigger', exists (
  select 1 from pg_trigger tg
  join pg_class rel on rel.oid = tg.tgrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public'
    and rel.relname = 'customer_operation_jobs'
    and tg.tgname = 'gridex_project_terminal_application_continuation'
    and not tg.tgisinternal
    and tg.tgenabled <> 'D'
), '{}'::jsonb;

with expected(signature, expected_hash, expected_security_definer) as (
  values
    ('gridex_apply_contract_offer_standard_fees()'::text, '2683a102674fb3468c7ad69806f60a69ac4b8f7375529bd144d1253df3fc4821'::text, true),
    ('gridex_canonicalize_publication_invoice_fee_v1(jsonb,numeric)'::text, '33a081c873fdbc641263444cbee02ec579739efeebfbe0c00cd028bfc4ee4e67'::text, false),
    ('gridex_finalize_contract_publication_v1(uuid,uuid,boolean)'::text, '04b22c1511ae4ebbb5d4d566d774fc3979a0c1e5aec05e6d5a621f1236e53efa'::text, true),
    ('gridex_validate_website_application_portal_identity()'::text, '9049cf8acc9d51fb6f8e1b2fb49391a1a842c0b89d2349747a6b8c7c8329a2a7'::text, false),
    ('gridex_project_terminal_application_continuation()'::text, 'e997894649dc0e65d3729f96c4b549875826e29478d131f63b672c7c316a2265'::text, true)
), actual as (
  select
    p.oid::regprocedure::text as signature,
    encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex') as body_hash,
    p.prosecdef as security_definer,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
)
insert into _gridex_flow_verification(check_name, passed, details)
select
  'function_' || regexp_replace(expected.signature, '[^a-zA-Z0-9]+', '_', 'g'),
  actual.signature is not null
    and actual.body_hash = expected.expected_hash
    and actual.security_definer = expected.expected_security_definer
    and not actual.anon_execute
    and not actual.authenticated_execute
    and actual.service_role_execute,
  jsonb_build_object(
    'signature', expected.signature,
    'expected_hash', expected.expected_hash,
    'actual_hash', actual.body_hash,
    'security_definer', actual.security_definer,
    'anon_execute', actual.anon_execute,
    'authenticated_execute', actual.authenticated_execute,
    'service_role_execute', actual.service_role_execute
  )
from expected
left join actual using (signature);

with required_indexes(index_name) as (
  values
    ('supplier_switch_requests_application_contract_idx'),
    ('supplier_switch_requests_application_site_idx'),
    ('supplier_switch_requests_application_meter_idx'),
    ('customer_supply_periods_application_contract_idx'),
    ('customer_supply_periods_application_meter_idx'),
    ('customer_operation_jobs_workflow_continuation_idx'),
    ('communication_logs_application_metadata_idx'),
    ('event_outbox_webhook_fanout_due_idx')
)
insert into _gridex_flow_verification(check_name, passed, details)
select
  'index_' || required_indexes.index_name,
  indexes.indexname is not null,
  jsonb_build_object('index_name', required_indexes.index_name)
from required_indexes
left join pg_indexes indexes
  on indexes.schemaname = 'public'
 and indexes.indexname = required_indexes.index_name;

insert into _gridex_flow_verification(check_name, passed, details)
select 'event_outbox_rls_and_acl',
  rel.relrowsecurity
  and not has_table_privilege('anon', 'public.event_outbox', 'SELECT')
  and not has_table_privilege('anon', 'public.event_outbox', 'INSERT')
  and not has_table_privilege('anon', 'public.event_outbox', 'UPDATE')
  and not has_table_privilege('anon', 'public.event_outbox', 'DELETE')
  and not has_table_privilege('authenticated', 'public.event_outbox', 'SELECT')
  and not has_table_privilege('authenticated', 'public.event_outbox', 'INSERT')
  and not has_table_privilege('authenticated', 'public.event_outbox', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.event_outbox', 'DELETE'),
  jsonb_build_object('rls', rel.relrowsecurity)
from pg_class rel
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public' and rel.relname = 'event_outbox';

insert into _gridex_flow_verification(check_name, passed, details)
select 'standard_fee_backfill_complete', count(*) = 0,
  jsonb_build_object('gap_count', count(*))
from public.customer_contracts contract
join public.contract_offers offer
  on offer.id = contract.contract_offer_id
 and offer.company_id = contract.company_id
where coalesce(contract.source_type, '') not in ('manual', 'manual_override')
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

do $verification$
declare
  v_failed jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'check', check_name,
    'details', details
  ) order by check_name), '[]'::jsonb)
  into v_failed
  from _gridex_flow_verification
  where not passed;

  if jsonb_array_length(v_failed) > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'MULTITENANT_WEBSITE_APPLICATION_POST_APPLY_FAILED',
      detail = v_failed::text;
  end if;
end
$verification$;

select check_name, passed, details
from _gridex_flow_verification
order by check_name;

-- Operational matrix. Rows may be blocked until each tenant is deliberately
-- provisioned; that is expected and is not a schema verification failure.
select
  company.id as company_id,
  company.name,
  company.status,
  company.external_tenant_reference,
  company.customer_portal_url,
  client.id as api_client_id,
  client.status as api_client_status,
  client.launch_ready,
  client.launch_blockers,
  coalesce((
    select count(*)
    from public.public_contract_offers offer
    where offer.company_id = company.id
      and offer.website_enabled
      and offer.website_cta_enabled
      and offer.publication_status = 'published'
      and not offer.is_archived
  ), 0) as published_website_offers,
  coalesce((
    select count(*)
    from public.webhook_subscriptions subscription
    where subscription.company_id = company.id
      and subscription.api_client_id = client.id
      and subscription.status = 'active'
  ), 0) as active_webhooks
from public.companies company
left join lateral (
  select api.*
  from public.integration_api_clients api
  where api.company_id = company.id
    and api.profile_key = 'tenant_website'
    and api.deleted_at is null
  order by (api.status = 'active') desc, api.created_at desc
  limit 1
) client on true
order by company.name;

rollback;
