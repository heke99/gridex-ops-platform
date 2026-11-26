DO $migration$
DECLARE
  merger regprocedure := to_regprocedure('public.gridex_merge_customers_v1(uuid,uuid,uuid[],uuid,text)');
  guard regprocedure := to_regprocedure('public.gridex_guard_merged_portal_customer_write()');
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc WHERE oid = merger)
      IS DISTINCT FROM '76a070a53a5789bc3a64e89e8eaeca3920443a258bf1d33972504e7d318c7b67'
    OR (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc WHERE oid = guard)
      IS DISTINCT FROM 'd5e0a686c9dc52c7aa08cfd3dd9d75a3be4fc77248964f1a248f29d4e8e394a6' THEN
    RAISE EXCEPTION 'portal_document_merge_exact_preimage_required' USING ERRCODE = '55000';
  END IF;

CREATE OR REPLACE FUNCTION public.gridex_merge_customers_v1(p_company_id uuid, p_primary_customer_id uuid, p_source_customer_ids uuid[], p_actor_user_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_catalog', 'pg_temp'
    AS $_$
declare
  -- Customer-scoped tables whose rows follow the surviving customer. Tables
  -- without customer_id/company_id in this database are skipped.
  v_tables constant text[] := array[
    'customer_sites', 'metering_points', 'customer_contacts', 'customer_addresses',
    'customer_contracts', 'customer_contract_events', 'powers_of_attorney',
    'power_of_attorney_scopes', 'authorization_scopes', 'customer_authorization_documents',
    'customer_cases', 'customer_case_events', 'customer_info_requests',
    'customer_info_request_events', 'customer_internal_notes', 'customer_operation_tasks',
    'customer_lifecycle_decisions', 'customer_lifecycle_events',
    'customer_duplicate_resolution_events', 'customer_readiness_snapshots',
    'document_ai_extractions', 'supplier_switch_requests', 'supplier_switch_events',
    'grid_owner_data_requests', 'grid_owner_information_requests', 'outbound_requests', 'outbound_dispatch_events',
    'billing_underlays', 'billing_export_run_items', 'partner_exports',
    'tenant_email_outbox', 'ediel_messages', 'customer_import_rows',
    'customer_case_attachments', 'customer_portal_accounts',
    'customer_portal_identities', 'tenant_portal_customer_links',
    'customer_profiles', 'customer_portal_claims', 'customer_portal_events',
    'customer_portal_requests', 'customer_portal_completions',
    'customer_portal_api_access_logs', 'customer_portal_write_idempotency',
    'customer_events'
  ];
  v_primary public.customers%rowtype;
  v_source public.customers%rowtype;
  v_source_id uuid;
  v_table text;
  v_has_updated_by boolean;
  v_rows integer;
  v_moved jsonb;
  v_snapshot jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'customer_merge_service_role_required';
  end if;
  if p_company_id is null or p_primary_customer_id is null or p_actor_user_id is null
     or coalesce(cardinality(p_source_customer_ids), 0) = 0
     or p_primary_customer_id = any (p_source_customer_ids)
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'customer_merge_payload_invalid';
  end if;

  -- Lock every customer in a stable order to avoid deadlocks between merges.
  perform 1 from public.customers
  where company_id = p_company_id
    and (id = p_primary_customer_id or id = any (p_source_customer_ids))
  order by id
  for update;

  select * into v_primary from public.customers
  where id = p_primary_customer_id and company_id = p_company_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer_merge_primary_not_found_for_tenant';
  end if;
  if v_primary.merged_into_customer_id is not null or v_primary.status = 'archived' then
    raise exception using errcode = '23514', message = 'customer_merge_primary_not_mergeable';
  end if;

  -- Lock binding rows after the customer graph, in a consistent table/key order.
  perform 1 from public.customer_portal_accounts where company_id = p_company_id
    and (customer_id = p_primary_customer_id or customer_id = any(p_source_customer_ids)) order by id for update;
  perform 1 from public.customer_portal_identities where company_id = p_company_id
    and (customer_id = p_primary_customer_id or customer_id = any(p_source_customer_ids)) order by id for update;
  perform 1 from public.tenant_portal_customer_links where company_id = p_company_id
    and (customer_id = p_primary_customer_id or customer_id = any(p_source_customer_ids)) order by id for update;

  -- The public portal/auth IDs belong to one external subject; native account
  -- user_id has a different namespace and is deliberately not compared with it.
  if exists(select 1 from public.customer_portal_identities where company_id = p_company_id
    and (customer_id = p_primary_customer_id or customer_id = any(p_source_customer_ids))
    and status = 'active' and auth_user_id is not null and customer_portal_user_id is not null
    and auth_user_id <> customer_portal_user_id) then
    raise exception using errcode = '23514', message = 'customer_merge_ambiguous_portal_subject';
  end if;
  -- Header-based identity resolution cannot choose between different providers
  -- presenting the same raw external subject. Never collapse those providers.
  if exists(select 1 from public.customer_portal_identities where company_id = p_company_id
    and (customer_id = p_primary_customer_id or customer_id = any(p_source_customer_ids))
    and status = 'active' and coalesce(customer_portal_user_id, auth_user_id) is not null
    group by coalesce(customer_portal_user_id, auth_user_id) having count(*) > 1) then
    raise exception using errcode = '23514', message = 'customer_merge_ambiguous_portal_subject';
  end if;
  if exists(select 1 from public.customer_portal_identities where company_id = p_company_id
    and (customer_id = p_primary_customer_id or customer_id = any(p_source_customer_ids))
    and status = 'active' and nullif(btrim(external_account_id), '') is not null
    group by external_account_id having count(*) > 1)
    or exists(select 1 from public.customer_portal_accounts where company_id = p_company_id
      and (customer_id = p_primary_customer_id or customer_id = any(p_source_customer_ids))
      and is_active and (nullif(lower(btrim(status)), '') is null or lower(btrim(status)) in ('active','confirmed','enabled'))
      and nullif(btrim(external_account_id), '') is not null
      group by external_account_id having count(*) > 1)
    or exists(select 1 from public.tenant_portal_customer_links where company_id = p_company_id
      and (customer_id = p_primary_customer_id or customer_id = any(p_source_customer_ids))
      and status = 'active' and external_customer_id is not null
      group by external_customer_id having count(*) > 1) then
    raise exception using errcode = '23514', message = 'customer_merge_ambiguous_portal_subject';
  end if;

  set constraints customer_case_attachments_case_owner_fk, customer_case_events_case_owner_fk, customer_contracts_company_customer_customer_site_rel_fkey, customer_contracts_company_customer_site_rel_fkey, customer_info_requests_company_customer_site_rel_fkey, grid_owner_data_requests_company_customer_site_rel_fkey, grid_owner_information_requests_company_customer_site_rel_fkey, metering_points_company_customer_site_rel_fkey, outbound_requests_company_customer_customer_site_rel_fkey, outbound_requests_company_customer_site_rel_fkey, powers_of_attorney_company_customer_customer_site_rel_fkey, powers_of_attorney_company_customer_site_rel_fkey, supplier_switch_requests_company_customer_customer_site_rel_fke, supplier_switch_requests_company_customer_site_rel_fkey deferred;

  foreach v_source_id in array (select array_agg(distinct s) from unnest(p_source_customer_ids) s) loop
    select * into v_source from public.customers
    where id = v_source_id and company_id = p_company_id;
    if not found then
      -- Also the answer for another tenant's customer: never reveal or touch it.
      raise exception using errcode = 'P0002', message = 'customer_merge_source_not_found_for_tenant', detail = v_source_id::text;
    end if;
    if v_source.merged_into_customer_id is not null then
      raise exception using errcode = '23514', message = 'customer_merge_source_already_merged', detail = v_source_id::text;
    end if;

    v_moved := '{}'::jsonb;
    -- Both customer rows are already locked. Transfer only a primary document
    -- whose legal anchor belongs to the exact source before POA ownership moves.
    if exists (
      select 1 from public.customer_documents d
      join public.powers_of_attorney poa on poa.id = d.power_of_attorney_id
        and poa.company_id = d.company_id and poa.customer_id = d.customer_id
      where d.company_id = p_company_id and d.customer_id = v_source_id
    ) then
      perform public.ediel_require_portal_retention_access_v1(p_company_id, v_source_id);
      perform public.ediel_require_portal_retention_access_v1(p_company_id, p_primary_customer_id);
      update public.customer_documents d
      set customer_id = p_primary_customer_id
      from public.powers_of_attorney poa
      where d.company_id = p_company_id and d.customer_id = v_source_id
        and poa.id = d.power_of_attorney_id
        and poa.company_id = d.company_id and poa.customer_id = d.customer_id;
      get diagnostics v_rows = row_count;
      v_moved := jsonb_build_object('customer_documents', v_rows);
    end if;
    foreach v_table in array v_tables loop
      if to_regclass('public.' || v_table) is null
         or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.' || v_table)
                        and attname = 'customer_id' and not attisdropped)
         or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.' || v_table)
                        and attname = 'company_id' and not attisdropped) then
        continue;
      end if;
      v_has_updated_by := v_table <> 'customer_import_rows' and exists (
        select 1 from pg_attribute where attrelid = to_regclass('public.' || v_table)
          and attname = 'updated_by' and not attisdropped);
      execute format(
        'update public.%I set customer_id = $1%s where customer_id = $2 and company_id = $3',
        v_table, case when v_has_updated_by then ', updated_by = $4' else '' end
      ) using p_primary_customer_id, v_source_id, p_company_id, p_actor_user_id;
      get diagnostics v_rows = row_count;
      v_moved := v_moved || jsonb_build_object(v_table, v_rows);
    end loop;

    v_snapshot := jsonb_build_object(
      'id', v_source.id,
      'customer_number', v_source.customer_number,
      'full_name', v_source.full_name,
      'company_name', v_source.company_name,
      'email', v_source.email,
      'status', v_source.status
    );

    update public.customers
    set status = 'inactive',
        merge_status = 'merged',
        merged_into_customer_id = p_primary_customer_id,
        merged_at = now(),
        merged_by = p_actor_user_id,
        duplicate_review_status = 'merged',
        possible_duplicate = false,
        updated_by = p_actor_user_id,
        updated_at = now()
    where id = v_source_id and company_id = p_company_id;

    insert into public.customer_merge_events (
      company_id, primary_customer_id, merged_customer_id, reason, moved_counts, source_snapshot, created_by
    ) values (
      p_company_id, p_primary_customer_id, v_source_id, p_reason, v_moved, v_snapshot, p_actor_user_id
    );

    insert into public.audit_logs (
      actor_user_id, company_id, entity_type, entity_id, action, old_values, new_values, metadata
    ) values (
      p_actor_user_id, p_company_id, 'customer_merge', p_primary_customer_id::text, 'customers_merged',
      jsonb_build_object('source', v_snapshot),
      jsonb_build_object('primaryCustomerId', p_primary_customer_id, 'mergedCustomerId', v_source_id, 'moved', v_moved),
      jsonb_build_object('reason', p_reason, 'crossTenantBlocked', false, 'source', 'gridex_merge_customers_v1')
    );

    v_results := v_results || jsonb_build_array(jsonb_build_object('merged_customer_id', v_source_id, 'moved', v_moved));
  end loop;

  set constraints customer_case_attachments_case_owner_fk, customer_case_events_case_owner_fk, customer_contracts_company_customer_customer_site_rel_fkey, customer_contracts_company_customer_site_rel_fkey, customer_info_requests_company_customer_site_rel_fkey, grid_owner_data_requests_company_customer_site_rel_fkey, grid_owner_information_requests_company_customer_site_rel_fkey, metering_points_company_customer_site_rel_fkey, outbound_requests_company_customer_customer_site_rel_fkey, outbound_requests_company_customer_site_rel_fkey, powers_of_attorney_company_customer_customer_site_rel_fkey, powers_of_attorney_company_customer_site_rel_fkey, supplier_switch_requests_company_customer_customer_site_rel_fke, supplier_switch_requests_company_customer_site_rel_fkey immediate;

  return jsonb_build_object('primary_customer_id', p_primary_customer_id, 'merged', v_results);
end
$_$;

  -- A stale primary document writer must not attach a POA to a retired owner.
  -- Match the existing merge lock protocol for inserts and source-link updates.
  CREATE TRIGGER guard_merged_portal_poa_document_write
    BEFORE INSERT OR UPDATE OF company_id, customer_id, power_of_attorney_id
    ON public.customer_documents FOR EACH ROW
    WHEN (new.power_of_attorney_id IS NOT NULL)
    EXECUTE FUNCTION public.gridex_guard_merged_portal_customer_write();

  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc WHERE oid = merger)
      IS DISTINCT FROM 'bf466fd9c2bee22864a5e8af62e58b0634f9c41df8700a0ebd7fd98ba9e3acd6' THEN
    RAISE EXCEPTION 'portal_document_merge_not_installed' USING ERRCODE = '55000';
  END IF;
END;
$migration$;
