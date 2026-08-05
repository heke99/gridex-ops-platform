\set ON_ERROR_STOP on

-- Gridex OPS API + billing tenant hardening verification
-- Read-only. Expected result: every affected count is 0 and every constraint is validated.

with findings as (
  select 'quote.company_client_tenant_mismatch' as finding, count(*)::bigint as affected
  from public.website_contract_quotes quote
  join public.integration_api_clients client on client.id = quote.api_client_id
  where quote.company_id is distinct from client.company_id

  union all
  select 'idempotency.company_client_tenant_mismatch', count(*)
  from public.integration_api_write_idempotency idem
  join public.integration_api_clients client on client.id = idem.api_client_id
  where idem.company_id is distinct from client.company_id

  union all
  select 'snapshot.contract_tenant_mismatch', count(*)
  from public.contract_price_snapshots snapshot
  join public.customer_contracts contract on contract.id = snapshot.contract_id
  where snapshot.company_id is distinct from contract.company_id

  union all
  select 'underlay.item_tenant_mismatch', count(*)
  from public.billing_underlay_items item
  join public.billing_underlays underlay on underlay.id = item.billing_underlay_id
  where item.company_id is distinct from underlay.company_id

  union all
  select 'invoice.line_tenant_mismatch', count(*)
  from public.customer_invoice_lines line
  join public.customer_invoices invoice on invoice.id = line.invoice_id
  where line.company_id is distinct from invoice.company_id

  union all
  select 'invoice.line_amount_inconsistent', count(*)
  from public.customer_invoice_lines
  where vat_amount is not null
    and amount_inc_vat is not null
    and abs(amount_inc_vat - (amount_ex_vat + vat_amount)) > 0.01

  union all
  select 'contract.billing_identity_incomplete', count(*)
  from public.customer_contracts
  where billing_eligible_at is not null
    and (
      contract_price_snapshot_id is null
      or contract_product_version_id is null
      or contract_publication_version_id is null
      or price_area_used not in ('SE1', 'SE2', 'SE3', 'SE4')
      or nullif(snapshot_hash, '') is null
    )

  union all
  select 'idempotency.processing_stale_15m', count(*)
  from public.integration_api_write_idempotency
  where status = 'processing'
    and started_at < now() - interval '15 minutes'

  union all
  select 'usage_event_failures.open', count(*)
  from public.platform_usage_event_failures
  where status = 'open'

  union all
  select 'migration.expected_missing', count(*)
  from (values
    ('20260804003000'),
    ('20260804093500'),
    ('20260804121000'),
    ('20260804151500'),
    ('20260804173000'),
    ('20260805085617')
  ) expected(version)
  where not exists (
    select 1
    from supabase_migrations.schema_migrations migration
    where migration.version = expected.version
  )
)
select * from findings order by finding;

with expected_constraint(name) as (values
  ('integration_api_write_idempotency_company_client_fkey'),
  ('website_contract_quotes_company_client_fkey'),
  ('website_contract_quotes_company_application_fkey'),
  ('contract_price_snapshots_company_contract_fkey'),
  ('billing_underlays_company_snapshot_fkey'),
  ('billing_underlay_items_company_underlay_fkey'),
  ('billing_underlay_items_company_contract_fkey'),
  ('customer_invoice_lines_company_invoice_fkey'),
  ('customer_invoice_lines_company_snapshot_fkey'),
  ('contract_charge_ledger_company_contract_fkey'),
  ('contract_charge_ledger_company_invoice_fkey'),
  ('customer_invoice_lines_vat_rate_fraction_check'),
  ('customer_invoice_lines_amount_consistency_check'),
  ('customer_contracts_billing_identity_check'),
  ('customer_invoices_company_partner_reference_key')
)
select
  expected.name,
  constraint_row.contype,
  coalesce(constraint_row.convalidated, false) as validated
from expected_constraint expected
left join pg_constraint constraint_row on constraint_row.conname = expected.name
order by expected.name;

select table_name, column_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'customer_contracts',
    'billing_underlays',
    'customer_invoices',
    'customer_invoice_lines'
  )
  and column_name = 'company_id'
order by table_name;

select
  function_row.oid::regprocedure::text as function_signature,
  has_function_privilege('anon', function_row.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', function_row.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', function_row.oid, 'EXECUTE') as service_role_execute
from pg_proc function_row
join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
where namespace_row.nspname = 'public'
  and function_row.proname = 'gridex_required_legal_modules'
order by function_signature;
