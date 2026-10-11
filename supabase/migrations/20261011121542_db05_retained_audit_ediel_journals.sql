-- DB-05 component: a disposable marker must not erase these named audit and
-- Ediel journals through a parent DELETE. Content purge remains a separate,
-- authorized retention-class workflow; this is not a complete retention map.
-- Preserve the existing six checks, caller rights and both guard callers.
-- Forward only: do not rewrite the already applied hard-delete migration.

create or replace function public.gridex_company_retained_history_v1(p_company_id uuid)
returns text[]
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select array_remove(array[
    case when exists (select 1 from public.customers c where c.company_id = p_company_id
      and c.is_test_data is not true and coalesce(lower(c.source), '') not like '%test%') then 'customers' end,
    case when exists (select 1 from public.customer_contracts x where x.company_id = p_company_id) then 'customer_contracts' end,
    case when exists (select 1 from public.customer_invoices x where x.company_id = p_company_id) then 'customer_invoices' end,
    case when exists (select 1 from public.invoice_documents x where x.company_id = p_company_id) then 'invoice_documents' end,
    case when exists (select 1 from public.billing_underlays x where x.company_id = p_company_id) then 'billing_underlays' end,
    case when exists (select 1 from public.contract_charge_ledger x where x.company_id = p_company_id) then 'contract_charge_ledger' end,
    case when exists (select 1 from public.canonical_audit_events x where x.company_id = p_company_id) then 'canonical_audit_events' end,
    case when exists (select 1 from public.canonical_command_results x where x.company_id = p_company_id) then 'canonical_command_results' end,
    case when exists (select 1 from public.canonical_domain_events x where x.company_id = p_company_id) then 'canonical_domain_events' end,
    case when exists (select 1 from public.canonical_event_outbox x where x.company_id = p_company_id) then 'canonical_event_outbox' end,
    case when exists (select 1 from public.pricing_audit_logs x where x.company_id = p_company_id) then 'pricing_audit_logs' end,
    case when exists (select 1 from public.domain_events x where x.company_id = p_company_id) then 'domain_events' end,
    case when exists (select 1 from public.ediel_ack_transaction_results x where x.company_id = p_company_id) then 'ediel_ack_transaction_results' end,
    case when exists (select 1 from public.ediel_business_correlations x where x.company_id = p_company_id) then 'ediel_business_correlations' end,
    case when exists (select 1 from public.ediel_business_errors x where x.company_id = p_company_id) then 'ediel_business_errors' end,
    case when exists (select 1 from public.ediel_route_history x where x.company_id = p_company_id) then 'ediel_route_history' end,
    case when exists (select 1 from public.ediel_certification_evidence x where x.company_id = p_company_id) then 'ediel_certification_evidence' end
  ], null)
$function$;
