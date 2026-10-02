-- Atomic hard delete of a test customer.
--
-- Before: deleteCustomerForRecreateImpl ran ~40 separate deletes from the app
-- and removed Storage objects first. An interruption left a half-deleted
-- customer. After: one SECURITY DEFINER command checks the test-data and
-- protected-history rules inside the transaction and deletes the remaining
-- graph; any row still referencing the customer through a non-cascading
-- foreign key aborts the whole delete. Storage is cleaned by the app only
-- after this command has committed.

create or replace function public.gridex_delete_test_customer_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_customer public.customers%rowtype;
  v_site_ids uuid[];
  v_point_ids uuid[];
  v_outbound_ids uuid[];
  v_test_run_ids uuid[];
  v_protected text[] := '{}';
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'customer_delete_service_role_required';
  end if;
  if p_company_id is null or p_customer_id is null or p_actor_user_id is null then
    raise exception using errcode = '22023', message = 'customer_delete_payload_invalid';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id and company_id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer_not_found_for_tenant';
  end if;

  if v_customer.is_test_data is not true
     and coalesce(lower(v_customer.source), '') not like '%test%' then
    raise exception using errcode = '23514', message = 'customer_delete_requires_test_data';
  end if;

  select coalesce(array_agg(id), '{}') into v_site_ids
  from public.customer_sites where customer_id = p_customer_id;
  select coalesce(array_agg(id), '{}') into v_point_ids
  from public.metering_points
  where customer_id = p_customer_id or site_id = any (v_site_ids);

  -- Same protected-history rule as the customer card: real history is archived, never deleted.
  if exists (select 1 from public.customer_contracts where customer_id = p_customer_id) then
    v_protected := v_protected || 'customer_contracts'; end if;
  if exists (select 1 from public.customer_invoices where customer_id = p_customer_id) then
    v_protected := v_protected || 'customer_invoices'; end if;
  if exists (select 1 from public.supplier_switch_requests where customer_id = p_customer_id) then
    v_protected := v_protected || 'supplier_switch_requests'; end if;
  if exists (select 1 from public.ediel_messages
             where customer_id = p_customer_id
                or site_id = any (v_site_ids)
                or metering_point_id = any (v_point_ids)) then
    v_protected := v_protected || 'ediel_messages'; end if;
  if exists (select 1 from public.partner_exports where customer_id = p_customer_id) then
    v_protected := v_protected || 'partner_exports'; end if;
  if exists (select 1 from public.grid_owner_information_requests
             where customer_id = p_customer_id or customer_site_id = any (v_site_ids)) then
    v_protected := v_protected || 'grid_owner_information_requests'; end if;
  if exists (select 1 from public.powers_of_attorney where customer_id = p_customer_id) then
    v_protected := v_protected || 'powers_of_attorney'; end if;
  if exists (select 1 from public.customer_documents where customer_id = p_customer_id) then
    v_protected := v_protected || 'customer_documents'; end if;
  if exists (select 1 from public.customer_operation_events where customer_id = p_customer_id) then
    v_protected := v_protected || 'customer_operation_events'; end if;
  if exists (select 1 from public.customer_blockers where customer_id = p_customer_id) then
    v_protected := v_protected || 'customer_blockers'; end if;
  if exists (select 1 from public.communication_logs
             where customer_id = p_customer_id
                or site_id = any (v_site_ids)
                or metering_point_id = any (v_point_ids)) then
    v_protected := v_protected || 'communication_logs'; end if;

  if cardinality(v_protected) > 0 then
    raise exception using
      errcode = '23514',
      message = 'customer_delete_protected_history',
      detail = array_to_string(v_protected, ',');
  end if;

  -- Audit first; the row survives because audit_logs has no customer foreign key.
  insert into public.audit_logs (
    actor_user_id, company_id, entity_type, entity_id, action, old_values, metadata
  ) values (
    p_actor_user_id, p_company_id, 'customer', p_customer_id::text, 'customer.deleted_test',
    to_jsonb(v_customer),
    jsonb_build_object(
      'label', 'Raderade testkund',
      'sites', cardinality(v_site_ids),
      'meteringPoints', cardinality(v_point_ids),
      'source', 'gridex_delete_test_customer_v1'
    )
  );

  select coalesce(array_agg(id), '{}') into v_test_run_ids
  from public.ediel_test_runs
  where customer_id = p_customer_id
     or site_id = any (v_site_ids)
     or metering_point_id = any (v_point_ids);
  delete from public.ediel_test_run_messages where test_run_id = any (v_test_run_ids);
  delete from public.ediel_test_runs where id = any (v_test_run_ids);

  select coalesce(array_agg(id), '{}') into v_outbound_ids
  from public.outbound_requests where customer_id = p_customer_id;
  delete from public.outbound_dispatch_events where outbound_request_id = any (v_outbound_ids);
  delete from public.outbound_requests where id = any (v_outbound_ids);

  delete from public.customer_portal_events where customer_id = p_customer_id;
  delete from public.metering_values where customer_id = p_customer_id;
  delete from public.billing_underlays where customer_id = p_customer_id;
  delete from public.grid_owner_data_requests where customer_id = p_customer_id;
  delete from public.customer_authorization_documents where customer_id = p_customer_id;
  delete from public.customer_operation_tasks where customer_id = p_customer_id;
  delete from public.customer_internal_notes where customer_id = p_customer_id;
  delete from public.customer_portal_claims where customer_id = p_customer_id;
  delete from public.customer_portal_accounts where customer_id = p_customer_id;
  delete from public.customer_addresses where customer_id = p_customer_id;
  delete from public.customer_contacts where customer_id = p_customer_id;
  delete from public.metering_points where id = any (v_point_ids);
  delete from public.customer_sites where id = any (v_site_ids);
  delete from public.customers where id = p_customer_id and company_id = p_company_id;

  return jsonb_build_object(
    'deleted', true,
    'sites', cardinality(v_site_ids),
    'metering_points', cardinality(v_point_ids),
    'test_runs', cardinality(v_test_run_ids),
    'outbound_requests', cardinality(v_outbound_ids)
  );
end
$function$;

revoke all on function public.gridex_delete_test_customer_v1(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.gridex_delete_test_customer_v1(uuid, uuid, uuid) to service_role;
