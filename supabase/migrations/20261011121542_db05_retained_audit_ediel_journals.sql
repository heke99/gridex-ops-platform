-- DB-05 component: refuse physical parent deletion of these named journals.
-- A terminal tombstone preserves them; its existing status checks stay intact.
-- Authorized retention-class content purge remains separate. This is not a
-- complete retention map or a change to the database-owner maintenance path.
-- Forward only: preserve the applied migration and the original six-category
-- helper used by the disposable-status guard.

create or replace function public.gridex_guard_company_hard_delete_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_retained text[];
begin
  if current_user in ('postgres', 'supabase_admin') then
    return old;
  end if;
  if old.status = 'deleted_test_only' then
    v_retained := public.gridex_company_retained_history_v1(old.id) || array_remove(array[
      case when exists (select 1 from public.canonical_audit_events x where x.company_id = old.id) then 'canonical_audit_events' end,
      case when exists (select 1 from public.canonical_command_results x where x.company_id = old.id) then 'canonical_command_results' end,
      case when exists (select 1 from public.canonical_domain_events x where x.company_id = old.id) then 'canonical_domain_events' end,
      case when exists (select 1 from public.canonical_event_outbox x where x.company_id = old.id) then 'canonical_event_outbox' end,
      case when exists (select 1 from public.pricing_audit_logs x where x.company_id = old.id) then 'pricing_audit_logs' end,
      case when exists (select 1 from public.domain_events x where x.company_id = old.id) then 'domain_events' end,
      case when exists (select 1 from public.ediel_ack_transaction_results x where x.company_id = old.id) then 'ediel_ack_transaction_results' end,
      case when exists (select 1 from public.ediel_business_correlations x where x.company_id = old.id) then 'ediel_business_correlations' end,
      case when exists (select 1 from public.ediel_business_errors x where x.company_id = old.id) then 'ediel_business_errors' end,
      case when exists (select 1 from public.ediel_route_history x where x.company_id = old.id) then 'ediel_route_history' end,
      case when exists (select 1 from public.ediel_certification_evidence x where x.company_id = old.id) then 'ediel_certification_evidence' end
    ], null);
    if cardinality(v_retained) = 0 then
      return old;
    end if;
    raise exception using
      errcode = '23001',
      message = 'company_hard_delete_blocked',
      detail = 'Disposable tenant still holds retained history: ' || array_to_string(v_retained, ',');
  end if;
  raise exception using
    errcode = '23001',
    message = 'company_hard_delete_blocked',
    detail = 'Retained audit, journal and billing history would be cascaded away; close the tenant through canonical_transition_tenant_lifecycle.';
end
$function$;
