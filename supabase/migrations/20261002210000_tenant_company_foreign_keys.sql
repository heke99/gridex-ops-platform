-- Tenant-owned tables whose company_id had no foreign key to companies.
--
-- Nothing stopped a write with an unknown or mistyped company id, and nothing
-- tied these rows to the tenant lifecycle. Event/audit/usage logs and shared
-- registries (grid_owners, ediel_message_rules, ediel_aperak_error_rules) are
-- deliberately left out: logs must outlive deleted rows and registries are
-- platform data with an optional tenant override.
--
-- Configuration follows its company (ON DELETE CASCADE, like ediel_mailboxes
-- and integration_api_clients). Operational data blocks a company hard delete
-- (NO ACTION, like customer_contracts). Companies are only soft-deleted today.
--
-- Constraints are added NOT VALID and validated separately so existing rows
-- are checked without holding a long exclusive lock.

do $$
declare
  v_spec record;
  v_name text;
begin
  for v_spec in
    select * from (values
      ('communication_routes', 'cascade'),
      ('company_market_party_routes', 'cascade'),
      ('customer_communication_templates', 'cascade'),
      ('integration_provider_accounts', 'cascade'),
      ('ediel_actor_settings', 'cascade'),
      ('ediel_route_profiles', 'cascade'),
      ('ediel_it_system_profiles', 'cascade'),
      ('user_permissions', 'cascade'),
      ('ediel_certificates', 'no action'),
      ('customer_invoice_documents', 'no action'),
      ('ediel_outbound_queue', 'no action'),
      ('ediel_production_send_approvals', 'no action'),
      ('ediel_message_payloads', 'no action'),
      ('ediel_message_splits', 'no action'),
      ('ediel_message_correlations', 'no action'),
      ('ediel_inbound_business_decisions', 'no action'),
      ('metering_value_batches', 'no action'),
      ('metering_value_errors', 'no action'),
      ('tenant_customer_sync_requests', 'no action'),
      ('duplicate_groups', 'no action'),
      ('ediel_tgt_test_data', 'no action'),
      ('customer_portal_write_idempotency', 'no action')
    ) as spec(table_name, on_delete)
  loop
    -- Skip tables that already reference companies through company_id.
    if exists (
      select 1
      from pg_constraint con
      join pg_attribute att
        on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
      where con.contype = 'f'
        and con.conrelid = format('public.%I', v_spec.table_name)::regclass
        and con.confrelid = 'public.companies'::regclass
        and att.attname = 'company_id'
    ) then
      continue;
    end if;

    v_name := v_spec.table_name || '_company_id_tenant_fkey';
    execute format(
      'alter table public.%I add constraint %I foreign key (company_id) references public.companies(id) on delete %s not valid',
      v_spec.table_name, v_name, v_spec.on_delete
    );
    execute format('alter table public.%I validate constraint %I', v_spec.table_name, v_name);
  end loop;
end
$$;
