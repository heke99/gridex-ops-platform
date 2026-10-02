-- Keep the customer portal and support graph on the surviving customer.
-- Forward-only: existing identity/provider/role/status/verification evidence is
-- preserved. Admin-authorized merging unions access for disjoint existing users;
-- actual unique collisions abort the complete transaction, never delete/dedupe.
-- Signed-contract immutability and ordinary tenant ownership triggers stay on.
-- Owner tuples may be inconsistent only inside this RPC, then are fully checked.

alter table public.customer_case_attachments alter constraint customer_case_attachments_case_owner_fk deferrable initially immediate;
alter table public.customer_case_events alter constraint customer_case_events_case_owner_fk deferrable initially immediate;
alter table public.customer_contracts alter constraint customer_contracts_company_customer_customer_site_rel_fkey deferrable initially immediate;
alter table public.customer_contracts alter constraint customer_contracts_company_customer_site_rel_fkey deferrable initially immediate;
alter table public.customer_info_requests alter constraint customer_info_requests_company_customer_site_rel_fkey deferrable initially immediate;
alter table public.grid_owner_data_requests alter constraint grid_owner_data_requests_company_customer_site_rel_fkey deferrable initially immediate;
alter table public.grid_owner_information_requests alter constraint grid_owner_information_requests_company_customer_site_rel_fkey deferrable initially immediate;
alter table public.metering_points alter constraint metering_points_company_customer_site_rel_fkey deferrable initially immediate;
alter table public.outbound_requests alter constraint outbound_requests_company_customer_customer_site_rel_fkey deferrable initially immediate;
alter table public.outbound_requests alter constraint outbound_requests_company_customer_site_rel_fkey deferrable initially immediate;
alter table public.powers_of_attorney alter constraint powers_of_attorney_company_customer_customer_site_rel_fkey deferrable initially immediate;
alter table public.powers_of_attorney alter constraint powers_of_attorney_company_customer_site_rel_fkey deferrable initially immediate;
alter table public.supplier_switch_requests alter constraint supplier_switch_requests_company_customer_customer_site_rel_fke deferrable initially immediate;
alter table public.supplier_switch_requests alter constraint supplier_switch_requests_company_customer_site_rel_fkey deferrable initially immediate;

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
$function$;

revoke all on function public.gridex_merge_customers_v1(uuid, uuid, uuid[], uuid, text) from public, anon, authenticated;
grant execute on function public.gridex_merge_customers_v1(uuid, uuid, uuid[], uuid, text) to service_role;

-- Close the stale-resolution race: customer graph locking orders this write
-- before a merge, or makes it observe the committed merged marker afterwards.
create or replace function public.gridex_guard_merged_portal_customer_write()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_merged_into uuid;
begin
  if new.customer_id is null then return new; end if;
  if tg_op = 'UPDATE' then
    -- UPDATE already owns a child tuple. Do not wait in the inverse lock order
    -- of a merge (customer first, then child): fail safely instead of deadlock.
    select merged_into_customer_id into v_merged_into from public.customers
    where id = new.customer_id and company_id = new.company_id for share nowait;
  else
    select merged_into_customer_id into v_merged_into from public.customers
    where id = new.customer_id and company_id = new.company_id for share;
  end if;
  if not found then
    raise exception using errcode = '23514', message = 'customer_portal_customer_not_found_for_tenant';
  end if;
  if v_merged_into is not null then
    raise exception using errcode = '23514', message = 'customer_merged_write_conflict';
  end if;
  return new;
exception when lock_not_available then
  raise exception using errcode = '23514', message = 'customer_merged_write_conflict';
end
$function$;
revoke all on function public.gridex_guard_merged_portal_customer_write() from public, anon, authenticated;
grant execute on function public.gridex_guard_merged_portal_customer_write() to service_role;

drop trigger if exists guard_merged_portal_customer_write on public.customer_portal_accounts;

create trigger guard_merged_portal_customer_write before insert or update of company_id, customer_id on public.customer_portal_accounts
for each row execute function public.gridex_guard_merged_portal_customer_write();

drop trigger if exists guard_merged_portal_customer_write on public.customer_portal_identities;

create trigger guard_merged_portal_customer_write before insert or update of company_id, customer_id on public.customer_portal_identities
for each row execute function public.gridex_guard_merged_portal_customer_write();

drop trigger if exists guard_merged_portal_customer_write on public.tenant_portal_customer_links;

create trigger guard_merged_portal_customer_write before insert or update of company_id, customer_id on public.tenant_portal_customer_links
for each row execute function public.gridex_guard_merged_portal_customer_write();

drop trigger if exists guard_merged_portal_customer_write on public.customer_portal_claims;

create trigger guard_merged_portal_customer_write before insert or update of company_id, customer_id on public.customer_portal_claims
for each row execute function public.gridex_guard_merged_portal_customer_write();

drop trigger if exists guard_merged_portal_customer_write on public.customer_portal_events;

create trigger guard_merged_portal_customer_write before insert or update of company_id, customer_id on public.customer_portal_events
for each row execute function public.gridex_guard_merged_portal_customer_write();

drop trigger if exists guard_merged_portal_customer_write on public.customer_portal_requests;

create trigger guard_merged_portal_customer_write before insert or update of company_id, customer_id on public.customer_portal_requests
for each row execute function public.gridex_guard_merged_portal_customer_write();

drop trigger if exists guard_merged_portal_customer_write on public.customer_portal_completions;

create trigger guard_merged_portal_customer_write before insert or update of company_id, customer_id on public.customer_portal_completions
for each row execute function public.gridex_guard_merged_portal_customer_write();

drop trigger if exists guard_merged_portal_customer_write on public.customer_portal_write_idempotency;

create trigger guard_merged_portal_customer_write before insert or update of company_id, customer_id on public.customer_portal_write_idempotency
for each row execute function public.gridex_guard_merged_portal_customer_write();

drop trigger if exists guard_merged_portal_customer_write on public.customer_cases;

create trigger guard_merged_portal_customer_write before insert or update of company_id, customer_id on public.customer_cases
for each row execute function public.gridex_guard_merged_portal_customer_write();

drop trigger if exists guard_merged_portal_customer_write on public.customer_case_events;

create trigger guard_merged_portal_customer_write before insert or update of company_id, customer_id on public.customer_case_events
for each row execute function public.gridex_guard_merged_portal_customer_write();

drop trigger if exists guard_merged_portal_customer_write on public.customer_case_attachments;

create trigger guard_merged_portal_customer_write before insert or update of company_id, customer_id on public.customer_case_attachments
for each row execute function public.gridex_guard_merged_portal_customer_write();

drop trigger if exists guard_merged_portal_customer_write on public.customer_events;

create trigger guard_merged_portal_customer_write before insert or update of company_id, customer_id on public.customer_events
for each row execute function public.gridex_guard_merged_portal_customer_write();

drop trigger if exists guard_merged_portal_customer_write on public.customer_contacts;
create trigger guard_merged_portal_customer_write before insert or update of company_id, customer_id on public.customer_contacts
for each row execute function public.gridex_guard_merged_portal_customer_write();

-- Keep the existing atomic contact command and its authorization/idempotency
-- semantics, adding only the post-lock source fence for stale portal profiles.
CREATE OR REPLACE FUNCTION public.gridex_customer_contact_change_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_actor_kind text,
  p_actor_user_id uuid,
  p_api_client_id uuid,
  p_portal_identity_id text,
  p_channel text,
  p_expected_updated_at timestamptz,
  p_customer_patch jsonb,
  p_contact_patch jsonb,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_allowed_customer constant text[] := ARRAY[
    'customer_type','status','first_name','last_name','full_name','company_name','personal_number','org_number',
    'email','phone','invoice_email','preferred_language','apartment_number','metadata'
  ];
  v_allowed_contact constant text[] := ARRAY['name','email','phone'];
  v_customer public.customers%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_contact public.customer_contacts%ROWTYPE;
  v_contact_before jsonb := NULL;
  v_contact_after jsonb := NULL;
  v_changes jsonb := '{}'::jsonb;
  v_contact_changes jsonb := '{}'::jsonb;
  v_key text;
  v_event_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_actor_kind NOT IN ('staff','customer_portal') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='contact_change_actor_kind_invalid';
  END IF;
  IF p_actor_kind='staff' AND p_actor_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='contact_change_staff_actor_required';
  END IF;
  IF p_actor_kind='customer_portal' AND p_api_client_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='contact_change_api_client_required';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(coalesce(p_customer_patch,'{}'::jsonb)) LOOP
    IF NOT v_key = ANY(v_allowed_customer) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='contact_change_field_not_allowed:'||v_key;
    END IF;
  END LOOP;
  FOR v_key IN SELECT jsonb_object_keys(coalesce(p_contact_patch,'{}'::jsonb)) LOOP
    IF NOT v_key = ANY(v_allowed_contact) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='contact_change_contact_field_not_allowed:'||v_key;
    END IF;
  END LOOP;

  -- Idempotent replay: the same key returns the recorded result without writing again.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_event_id FROM public.domain_events
      WHERE idempotency_key = 'customer.contact_changed:'||p_company_id||':'||p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('replayed',true,'domain_event_id',v_event_id);
    END IF;
  END IF;

  SELECT * INTO v_customer FROM public.customers
    WHERE id=p_customer_id AND company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='customer_not_found_in_scope';
  END IF;

  -- Staff: the canonical resolver grants masterdata.write in exactly this company (active member
  -- with the permission) or to an active platform superadmin; disabled/banned users never pass.
  IF p_actor_kind='staff'
     AND NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'masterdata.write'),false) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='contact_change_actor_not_authorized';
  END IF;

  IF v_customer.merged_into_customer_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='customer_merged_write_conflict';
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_customer.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='contact_change_version_conflict';
  END IF;
  IF v_customer.status='archived' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='contact_change_customer_archived';
  END IF;

  v_before := to_jsonb(v_customer);
  SELECT jsonb_object_agg(e.key, jsonb_build_object('from', v_before->e.key, 'to', e.value))
    INTO v_changes
    FROM jsonb_each(coalesce(p_customer_patch,'{}'::jsonb)) e
    WHERE (v_before->e.key) IS DISTINCT FROM e.value;
  v_changes := coalesce(v_changes,'{}'::jsonb);

  IF v_changes <> '{}'::jsonb THEN
    UPDATE public.customers c SET
      customer_type = CASE WHEN p_customer_patch ? 'customer_type' THEN p_customer_patch->>'customer_type' ELSE c.customer_type END,
      status = CASE WHEN p_customer_patch ? 'status' THEN p_customer_patch->>'status' ELSE c.status END,
      first_name = CASE WHEN p_customer_patch ? 'first_name' THEN p_customer_patch->>'first_name' ELSE c.first_name END,
      last_name = CASE WHEN p_customer_patch ? 'last_name' THEN p_customer_patch->>'last_name' ELSE c.last_name END,
      full_name = CASE WHEN p_customer_patch ? 'full_name' THEN p_customer_patch->>'full_name' ELSE c.full_name END,
      company_name = CASE WHEN p_customer_patch ? 'company_name' THEN p_customer_patch->>'company_name' ELSE c.company_name END,
      personal_number = CASE WHEN p_customer_patch ? 'personal_number' THEN p_customer_patch->>'personal_number' ELSE c.personal_number END,
      org_number = CASE WHEN p_customer_patch ? 'org_number' THEN p_customer_patch->>'org_number' ELSE c.org_number END,
      email = CASE WHEN p_customer_patch ? 'email' THEN p_customer_patch->>'email' ELSE c.email END,
      phone = CASE WHEN p_customer_patch ? 'phone' THEN p_customer_patch->>'phone' ELSE c.phone END,
      invoice_email = CASE WHEN p_customer_patch ? 'invoice_email' THEN p_customer_patch->>'invoice_email' ELSE c.invoice_email END,
      preferred_language = CASE WHEN p_customer_patch ? 'preferred_language' THEN p_customer_patch->>'preferred_language' ELSE c.preferred_language END,
      apartment_number = CASE WHEN p_customer_patch ? 'apartment_number' THEN p_customer_patch->>'apartment_number' ELSE c.apartment_number END,
      metadata = CASE WHEN p_customer_patch ? 'metadata' THEN p_customer_patch->'metadata' ELSE c.metadata END,
      updated_at = v_now
    WHERE c.id=v_customer.id AND c.company_id=p_company_id
    RETURNING * INTO v_customer;
  END IF;
  v_after := to_jsonb(v_customer);

  IF coalesce(p_contact_patch,'{}'::jsonb) <> '{}'::jsonb THEN
    SELECT * INTO v_contact FROM public.customer_contacts
      WHERE company_id=p_company_id AND customer_id=p_customer_id AND is_primary
      ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      v_contact_before := to_jsonb(v_contact);
      SELECT jsonb_object_agg(e.key, jsonb_build_object('from', v_contact_before->e.key, 'to', e.value))
        INTO v_contact_changes
        FROM jsonb_each(p_contact_patch) e
        WHERE (v_contact_before->e.key) IS DISTINCT FROM e.value;
      v_contact_changes := coalesce(v_contact_changes,'{}'::jsonb);
      IF v_contact_changes <> '{}'::jsonb THEN
        UPDATE public.customer_contacts cc SET
          name = CASE WHEN p_contact_patch ? 'name' THEN p_contact_patch->>'name' ELSE cc.name END,
          email = CASE WHEN p_contact_patch ? 'email' THEN p_contact_patch->>'email' ELSE cc.email END,
          phone = CASE WHEN p_contact_patch ? 'phone' THEN p_contact_patch->>'phone' ELSE cc.phone END
        WHERE cc.id=v_contact.id AND cc.company_id=p_company_id AND cc.customer_id=p_customer_id
        RETURNING to_jsonb(cc.*) INTO v_contact_after;
      END IF;
    ELSIF p_contact_patch ? 'name' OR p_contact_patch ? 'email' OR p_contact_patch ? 'phone' THEN
      INSERT INTO public.customer_contacts(company_id,customer_id,type,name,email,phone,title,is_primary)
      VALUES (p_company_id,p_customer_id,'primary',p_contact_patch->>'name',p_contact_patch->>'email',p_contact_patch->>'phone',NULL,true)
      RETURNING to_jsonb(customer_contacts.*) INTO v_contact_after;
      v_contact_changes := jsonb_build_object('created', true);
    END IF;
  END IF;

  IF v_changes = '{}'::jsonb AND v_contact_changes = '{}'::jsonb THEN
    RETURN jsonb_build_object('replayed',false,'changed',false,'customer_updated_at',v_customer.updated_at);
  END IF;

  INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  VALUES (
    p_company_id, p_actor_user_id, 'customer', p_customer_id::text, 'customer_profile_updated',
    (SELECT coalesce(jsonb_object_agg(k, v->'from'),'{}'::jsonb) FROM jsonb_each(v_changes) x(k,v)),
    (SELECT coalesce(jsonb_object_agg(k, v->'to'),'{}'::jsonb) FROM jsonb_each(v_changes) x(k,v)),
    jsonb_build_object(
      'channel', p_channel,
      'actor_type', CASE WHEN p_actor_kind='staff' THEN 'staff' ELSE 'customer_portal_account' END,
      'api_client_id', p_api_client_id,
      'portal_identity_id', p_portal_identity_id,
      'primary_contact_changes', v_contact_changes,
      'transaction', 'gridex_customer_contact_change_v1'
    )
  );

  -- Durable integration intent. Only changed field names leave the database; values stay internal.
  INSERT INTO public.domain_events(company_id,event_type,aggregate_type,aggregate_id,subject_customer_id,actor_user_id,source,idempotency_key,payload)
  VALUES (
    p_company_id, 'customer.contact_changed', 'customer', p_customer_id::text, p_customer_id, p_actor_user_id,
    CASE WHEN p_actor_kind='staff' THEN 'ops' ELSE 'customer_api' END,
    CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE 'customer.contact_changed:'||p_company_id||':'||p_idempotency_key END,
    jsonb_build_object(
      'changed_fields', (SELECT coalesce(jsonb_agg(k ORDER BY k),'[]'::jsonb) FROM jsonb_object_keys(v_changes) k),
      'primary_contact_changed', v_contact_changes <> '{}'::jsonb,
      'customer_version', v_customer.updated_at
    )
  ) RETURNING id INTO v_event_id;

  INSERT INTO public.event_outbox(company_id,domain_event_id,destination_type,destination_key,status,attempts,max_attempts,available_at,payload)
  VALUES (p_company_id, v_event_id, 'webhook', 'webhook_fanout_v1', 'queued', 0, 12, v_now,
    jsonb_build_object('event_type','customer.contact_changed','aggregate_type','customer','aggregate_id',p_customer_id::text));

  RETURN jsonb_build_object(
    'replayed', false,
    'changed', true,
    'domain_event_id', v_event_id,
    'customer_updated_at', v_customer.updated_at,
    'changes', v_changes,
    'primary_contact_changes', v_contact_changes
  );
END
$$;

REVOKE ALL ON FUNCTION public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text)
  TO service_role;

COMMENT ON FUNCTION public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text) IS
  'Tenantservice P2b: atomic customer contact/profile change (customer, primary contact, audit, domain event, outbox) for OPS and the customer API.';
