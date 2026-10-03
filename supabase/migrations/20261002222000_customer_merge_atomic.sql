-- Atomic customer merge within one tenant.
--
-- Before: the duplicates page moved customer_id on ~30 tables with one update
-- per table, then marked the source customer merged, then wrote the merge event
-- and audit row (audit errors ignored). An interruption split the customer graph
-- between two customers, and multi-source merges could be partly applied.
-- The canonical schema also lacked the merge columns on customers, so the
-- source-customer update failed silently and the source stayed active.
-- After: gridex_merge_customers_v1 moves every customer-scoped row for all
-- sources, marks them merged and records the merge event and audit row in one
-- transaction, strictly inside the tenant.

alter table public.customers add column if not exists possible_duplicate boolean default false;
alter table public.customers add column if not exists duplicate_review_status text;
alter table public.customers add column if not exists merge_status text;
alter table public.customers add column if not exists merged_into_customer_id uuid references public.customers(id) on delete set null;
alter table public.customers add column if not exists merged_at timestamptz;
alter table public.customers add column if not exists merged_by uuid references auth.users(id) on delete set null;

create or replace function public.gridex_merge_customers_v1(
  p_company_id uuid,
  p_primary_customer_id uuid,
  p_source_customer_ids uuid[],
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
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
    'grid_owner_data_requests', 'outbound_requests', 'outbound_dispatch_events',
    'billing_underlays', 'billing_export_run_items', 'partner_exports',
    'tenant_email_outbox', 'ediel_messages', 'customer_import_rows'
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
    foreach v_table in array v_tables loop
      if to_regclass('public.' || v_table) is null
         or not exists (select 1 from pg_attribute where attrelid = ('public.' || v_table)::regclass
                        and attname = 'customer_id' and not attisdropped)
         or not exists (select 1 from pg_attribute where attrelid = ('public.' || v_table)::regclass
                        and attname = 'company_id' and not attisdropped) then
        continue;
      end if;
      v_has_updated_by := v_table <> 'customer_import_rows' and exists (
        select 1 from pg_attribute where attrelid = ('public.' || v_table)::regclass
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

  return jsonb_build_object('primary_customer_id', p_primary_customer_id, 'merged', v_results);
end
$function$;

revoke all on function public.gridex_merge_customers_v1(uuid, uuid, uuid[], uuid, text) from public, anon, authenticated;
grant execute on function public.gridex_merge_customers_v1(uuid, uuid, uuid[], uuid, text) to service_role;
