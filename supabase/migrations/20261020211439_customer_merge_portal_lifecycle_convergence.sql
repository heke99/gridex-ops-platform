-- Converge only the exact observed portal-merge installation, not the whole
-- historical512-line migration. No business rows, ACL/owner changes, backfill,
-- validation or historical ledger rewrite. Existing later staff contact source
-- and all other enabled trigger/RI graphs remain untouched.
-- Immutable canonical donor20261002230000 SHA256836c083fad0f231a145cf4117527057a20bdc2f73d094c3fbaa53fbab525a4c9.
-- Requires qualified serial DDL on PG17/postgres; one atomic statement. Local
-- component qualification does not attest native concurrent/provider behavior.
DO $customer_merge_portal_convergence$
DECLARE
 function_profiles constant jsonb:=$profiles$[{"name":"gridex_merge_customers_v1","signature":"public.gridex_merge_customers_v1(uuid, uuid, uuid[], uuid, text)","types":"uuid, uuid, uuid[], uuid, text","args":["p_company_id","p_primary_customer_id","p_source_customer_ids","p_actor_user_id","p_reason"],"result":"jsonb","securityDefiner":true,"config":["search_path=public, extensions, pg_catalog, pg_temp"],"hash":"b9d5ec34f050761b5ae84da0d4391d90e506d201c3cf2e776942e47db1aa5037"},{"name":"gridex_guard_merged_portal_customer_write","signature":"public.gridex_guard_merged_portal_customer_write()","types":"","args":[],"result":"trigger","securityDefiner":true,"config":["search_path=public, extensions, pg_catalog, pg_temp"],"hash":"d5e0a686c9dc52c7aa08cfd3dd9d75a3be4fc77248964f1a248f29d4e8e394a6"},{"name":"gridex_customer_contact_change_v1","signature":"public.gridex_customer_contact_change_v1(uuid, uuid, text, uuid, uuid, text, text, timestamp with time zone, jsonb, jsonb, text)","types":"uuid, uuid, text, uuid, uuid, text, text, timestamp with time zone, jsonb, jsonb, text","args":["p_company_id","p_customer_id","p_actor_kind","p_actor_user_id","p_api_client_id","p_portal_identity_id","p_channel","p_expected_updated_at","p_customer_patch","p_contact_patch","p_idempotency_key"],"result":"jsonb","securityDefiner":false,"config":["search_path=\"\""],"hash":"dcc59600b4daa4a3dc25b5ff531ace5c9b4b6a7834408ed5751b5d82657bea54"}]$profiles$::jsonb;
 fk_profiles constant jsonb:=$foreign_keys$[{"table":"customer_case_attachments","name":"customer_case_attachments_case_owner_fk","columns":["customer_case_id","company_id","customer_id"],"parent":"customer_cases","parentColumns":["id","company_id","customer_id"],"delete":"c"},{"table":"customer_case_events","name":"customer_case_events_case_owner_fk","columns":["customer_case_id","company_id","customer_id"],"parent":"customer_cases","parentColumns":["id","company_id","customer_id"],"delete":"c"},{"table":"customer_contracts","name":"customer_contracts_company_customer_customer_site_rel_fkey","columns":["company_id","customer_id","customer_site_id"],"parent":"customer_sites","parentColumns":["company_id","customer_id","id"],"delete":"a"},{"table":"customer_contracts","name":"customer_contracts_company_customer_site_rel_fkey","columns":["company_id","customer_id","site_id"],"parent":"customer_sites","parentColumns":["company_id","customer_id","id"],"delete":"a"},{"table":"customer_info_requests","name":"customer_info_requests_company_customer_site_rel_fkey","columns":["company_id","customer_id","site_id"],"parent":"customer_sites","parentColumns":["company_id","customer_id","id"],"delete":"a"},{"table":"grid_owner_data_requests","name":"grid_owner_data_requests_company_customer_site_rel_fkey","columns":["company_id","customer_id","site_id"],"parent":"customer_sites","parentColumns":["company_id","customer_id","id"],"delete":"a"},{"table":"grid_owner_information_requests","name":"grid_owner_information_requests_company_customer_site_rel_fkey","columns":["company_id","customer_id","customer_site_id"],"parent":"customer_sites","parentColumns":["company_id","customer_id","id"],"delete":"a"},{"table":"metering_points","name":"metering_points_company_customer_site_rel_fkey","columns":["company_id","customer_id","site_id"],"parent":"customer_sites","parentColumns":["company_id","customer_id","id"],"delete":"a"},{"table":"outbound_requests","name":"outbound_requests_company_customer_customer_site_rel_fkey","columns":["company_id","customer_id","customer_site_id"],"parent":"customer_sites","parentColumns":["company_id","customer_id","id"],"delete":"a"},{"table":"outbound_requests","name":"outbound_requests_company_customer_site_rel_fkey","columns":["company_id","customer_id","site_id"],"parent":"customer_sites","parentColumns":["company_id","customer_id","id"],"delete":"a"},{"table":"powers_of_attorney","name":"powers_of_attorney_company_customer_customer_site_rel_fkey","columns":["company_id","customer_id","customer_site_id"],"parent":"customer_sites","parentColumns":["company_id","customer_id","id"],"delete":"a"},{"table":"powers_of_attorney","name":"powers_of_attorney_company_customer_site_rel_fkey","columns":["company_id","customer_id","site_id"],"parent":"customer_sites","parentColumns":["company_id","customer_id","id"],"delete":"a"},{"table":"supplier_switch_requests","name":"supplier_switch_requests_company_customer_customer_site_rel_fke","columns":["company_id","customer_id","customer_site_id"],"parent":"customer_sites","parentColumns":["company_id","customer_id","id"],"delete":"a"},{"table":"supplier_switch_requests","name":"supplier_switch_requests_company_customer_site_rel_fkey","columns":["company_id","customer_id","site_id"],"parent":"customer_sites","parentColumns":["company_id","customer_id","id"],"delete":"a"}]$foreign_keys$::jsonb;
 guard_tables constant text[]:=ARRAY['customer_portal_accounts','customer_portal_identities','tenant_portal_customer_links','customer_portal_claims','customer_portal_events','customer_portal_requests','customer_portal_completions','customer_portal_write_idempotency','customer_cases','customer_case_events','customer_case_attachments','customer_events','customer_contacts'];
 absent_tables constant text[]:=ARRAY['customer_case_attachments','customer_portal_identities','customer_portal_requests','customer_portal_write_idempotency','tenant_portal_customer_links'];
 move_tables constant text[]:=ARRAY['customer_sites','metering_points','customer_contacts','customer_addresses','customer_contracts','customer_contract_events','powers_of_attorney','power_of_attorney_scopes','authorization_scopes','customer_authorization_documents','customer_cases','customer_case_events','customer_info_requests','customer_info_request_events','customer_internal_notes','customer_operation_tasks','customer_lifecycle_decisions','customer_lifecycle_events','customer_duplicate_resolution_events','customer_readiness_snapshots','document_ai_extractions','supplier_switch_requests','supplier_switch_events','grid_owner_data_requests','grid_owner_information_requests','outbound_requests','outbound_dispatch_events','billing_underlays','billing_export_run_items','partner_exports','tenant_email_outbox','ediel_messages','customer_import_rows','customer_case_attachments','customer_portal_accounts','customer_portal_identities','tenant_portal_customer_links','customer_profiles','customer_portal_claims','customer_portal_events','customer_portal_requests','customer_portal_completions','customer_portal_api_access_logs','customer_portal_write_idempotency','customer_events'];
 canonical_body constant text:=$canonical_merge$
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
$canonical_merge$;
 profile jsonb; f pg_catalog.pg_proc%rowtype;
 merge_function oid; guard_function oid; attachment_fk oid;
 relation_oid oid; parent_oid oid; child_columns smallint[]; parent_columns smallint[];
 company_column smallint; customer_column smallint;
 con pg_catalog.pg_constraint%rowtype; trig pg_catalog.pg_trigger%rowtype;
 present integer:=0; present_in_absent integer:=0; pre_state boolean; post_state boolean;
 merge_hash text; old_body text; ddl text; name text;
 source_before jsonb; source_after jsonb; constraints_before jsonb; constraints_after jsonb;
 triggers_before jsonb; triggers_after jsonb; envelope_before jsonb; envelope_after jsonb;
 permitted_ri oid[]; ri_count integer;
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres'
 OR pg_catalog.current_setting('server_version_num')::integer<170000
 OR pg_catalog.current_setting('server_version_num')::integer>=180000
 THEN RAISE EXCEPTION 'merge_portal_convergence_pg17_postgres_required' USING ERRCODE='55000';END IF;
 PERFORM pg_catalog.set_config('lock_timeout','5s',true);
 PERFORM pg_catalog.set_config('statement_timeout','60s',true);
 PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
 -- Exact qualified signatures, complete headers and ACL tuples, including grantor
 -- and grant option, are required even when the installation is already complete.
 FOR profile IN SELECT value FROM pg_catalog.jsonb_array_elements(function_profiles) LOOP
  SELECT p.* INTO f FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(profile->>'signature');
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_portal_convergence_existing_function_required' USING ERRCODE='55000';END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=profile->>'name')<>1
  OR f.proowner<>pg_catalog.to_regrole('postgres')::oid
  OR pg_catalog.oidvectortypes(f.proargtypes) IS DISTINCT FROM profile->>'types'
  OR f.proargnames IS DISTINCT FROM (CASE WHEN pg_catalog.jsonb_array_length(profile->'args')=0 THEN NULL::text[] ELSE ARRAY(SELECT pg_catalog.jsonb_array_elements_text(profile->'args')) END)
  OR f.pronargs<>pg_catalog.jsonb_array_length(profile->'args')
  OR f.proallargtypes IS NOT NULL OR f.proargmodes IS NOT NULL
  OR f.pronargdefaults<>0 OR f.proargdefaults IS NOT NULL OR f.provariadic<>0
  OR f.prorettype<>pg_catalog.to_regtype(profile->>'result') OR f.proretset OR f.prokind<>'f'
  OR f.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
  OR f.prosecdef IS DISTINCT FROM (profile->>'securityDefiner')::boolean
  OR f.proisstrict OR f.proleakproof OR f.provolatile<>'v' OR f.proparallel<>'u'
  OR f.procost<>100 OR f.prorows<>0 OR f.prosupport<>0 OR f.protrftypes IS NOT NULL
  OR f.probin IS NOT NULL OR f.prosqlbody IS NOT NULL
  OR f.proconfig IS DISTINCT FROM ARRAY(SELECT pg_catalog.jsonb_array_elements_text(profile->'config'))
  OR pg_catalog.has_function_privilege('anon',f.oid,'EXECUTE')
  OR pg_catalog.has_function_privilege('authenticated',f.oid,'EXECUTE')
  OR NOT pg_catalog.has_function_privilege('service_role',f.oid,'EXECUTE')
  OR (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
       CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
       pg_catalog.pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
       ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END COLLATE "C")
      FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a)
     IS DISTINCT FROM '[["postgres","postgres","EXECUTE",false],["service_role","postgres","EXECUTE",false]]'::jsonb
  THEN RAISE EXCEPTION 'merge_portal_convergence_exact_function_header_acl_required' USING ERRCODE='55000';END IF;
  IF profile->>'name'='gridex_merge_customers_v1' THEN
   merge_function:=f.oid;old_body:=f.prosrc;
   merge_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.prosrc,'UTF8')),'hex');
   IF merge_hash NOT IN('b9d5ec34f050761b5ae84da0d4391d90e506d201c3cf2e776942e47db1aa5037',
    '76a070a53a5789bc3a64e89e8eaeca3920443a258bf1d33972504e7d318c7b67')
   THEN RAISE EXCEPTION 'merge_portal_convergence_exact_merge_source_required' USING ERRCODE='55000';END IF;
  ELSE
   IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM profile->>'hash'
   THEN RAISE EXCEPTION 'merge_portal_convergence_protected_function_source_required' USING ERRCODE='55000';END IF;
   IF profile->>'name'='gridex_guard_merged_portal_customer_write' THEN guard_function:=f.oid;END IF;
  END IF;
 END LOOP;
 IF NOT pg_catalog.has_function_privilege(current_user,guard_function,'EXECUTE')
 THEN RAISE EXCEPTION 'merge_portal_convergence_existing_guard_execute_required' USING ERRCODE='55000';END IF;
 -- The finite owner-FK tuples must already exist, validated, with their exact
 -- key order/actions and a valid ready unique parent index. No data validation.
 FOR profile IN SELECT value FROM pg_catalog.jsonb_array_elements(fk_profiles) LOOP
  relation_oid:=pg_catalog.to_regclass('public.'||(profile->>'table'));
  parent_oid:=pg_catalog.to_regclass('public.'||(profile->>'parent'));
  SELECT ARRAY(SELECT a.attnum FROM pg_catalog.jsonb_array_elements_text(profile->'columns') WITH ORDINALITY k(name,n)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=relation_oid AND a.attname=k.name AND a.attnum>0 AND NOT a.attisdropped ORDER BY k.n),
   ARRAY(SELECT a.attnum FROM pg_catalog.jsonb_array_elements_text(profile->'parentColumns') WITH ORDINALITY k(name,n)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=parent_oid AND a.attname=k.name AND a.attnum>0 AND NOT a.attisdropped ORDER BY k.n)
   INTO child_columns,parent_columns;
  SELECT c.* INTO con FROM pg_catalog.pg_constraint c WHERE c.conrelid=relation_oid AND c.conname=profile->>'name';
  IF NOT FOUND OR relation_oid IS NULL OR parent_oid IS NULL
  OR con.connamespace<>'public'::regnamespace OR con.contype<>'f' OR NOT con.convalidated OR con.condeferred
  OR con.confrelid<>parent_oid OR con.conkey IS DISTINCT FROM child_columns OR con.confkey IS DISTINCT FROM parent_columns
  OR pg_catalog.cardinality(child_columns)<>pg_catalog.jsonb_array_length(profile->'columns')
  OR pg_catalog.cardinality(parent_columns)<>pg_catalog.jsonb_array_length(profile->'parentColumns')
  OR con.confmatchtype<>'s' OR con.confupdtype<>'a' OR con.confdeltype::text IS DISTINCT FROM profile->>'delete'
  OR (SELECT count(*) FROM pg_catalog.pg_constraint c WHERE c.connamespace='public'::regnamespace AND c.conname=profile->>'name')<>1
  OR NOT EXISTS(SELECT FROM pg_catalog.pg_index ix WHERE ix.indexrelid=con.conindid AND ix.indrelid=parent_oid
    AND ix.indisunique AND ix.indisvalid AND ix.indisready AND ix.indpred IS NULL AND ix.indexprs IS NULL)
  OR EXISTS(SELECT FROM pg_catalog.pg_attribute a WHERE a.attrelid=relation_oid AND a.attnum=ANY(child_columns) AND a.atttypid<>'uuid'::regtype)
  OR EXISTS(SELECT FROM pg_catalog.pg_attribute a WHERE a.attrelid=parent_oid AND a.attnum=ANY(parent_columns) AND a.atttypid<>'uuid'::regtype)
  THEN RAISE EXCEPTION 'merge_portal_convergence_exact_existing_owner_fk_required' USING ERRCODE='55000';END IF;
  IF profile->>'name'='customer_case_attachments_case_owner_fk' THEN attachment_fk:=con.oid;
  ELSIF NOT con.condeferrable THEN RAISE EXCEPTION 'merge_portal_convergence_other_thirteen_fk_flags_required' USING ERRCODE='55000';END IF;
 END LOOP;
 -- Validate the existing guard's exact13 potential instances and the approved
 -- 8present/5absent matrix. Alias triggers or occupied slots are not repaired.
 FOREACH name IN ARRAY guard_tables LOOP
  relation_oid:=pg_catalog.to_regclass('public.'||name);
  IF relation_oid IS NULL OR NOT EXISTS(SELECT FROM pg_catalog.pg_class c WHERE c.oid=relation_oid AND c.relkind='r'
    AND c.relowner=pg_catalog.to_regrole('postgres')::oid)
   OR NOT pg_catalog.has_table_privilege(current_user,relation_oid,'TRIGGER')
  THEN RAISE EXCEPTION 'merge_portal_convergence_existing_guard_table_authority_required' USING ERRCODE='55000';END IF;
  SELECT attnum INTO company_column FROM pg_catalog.pg_attribute WHERE attrelid=relation_oid AND attname='company_id' AND attnum>0 AND NOT attisdropped AND atttypid='uuid'::regtype;
  SELECT attnum INTO customer_column FROM pg_catalog.pg_attribute WHERE attrelid=relation_oid AND attname='customer_id' AND attnum>0 AND NOT attisdropped AND atttypid='uuid'::regtype;
  IF company_column IS NULL OR customer_column IS NULL
  THEN RAISE EXCEPTION 'merge_portal_convergence_existing_guard_columns_required' USING ERRCODE='55000';END IF;
  SELECT t.* INTO trig FROM pg_catalog.pg_trigger t WHERE t.tgrelid=relation_oid AND t.tgname='guard_merged_portal_customer_write';
  IF FOUND THEN
   IF trig.tgfoid<>guard_function OR trig.tgisinternal OR trig.tgenabled<>'O' OR trig.tgtype<>23
    OR trig.tgconstraint<>0 OR trig.tgconstrrelid<>0 OR trig.tgdeferrable OR trig.tginitdeferred
    OR trig.tgattr::text IS DISTINCT FROM company_column::text||' '||customer_column::text
    OR trig.tgnargs<>0 OR pg_catalog.octet_length(trig.tgargs)<>0 OR trig.tgqual IS NOT NULL
    OR trig.tgoldtable IS NOT NULL OR trig.tgnewtable IS NOT NULL
   THEN RAISE EXCEPTION 'merge_portal_convergence_exact_existing_guard_required' USING ERRCODE='55000';END IF;
   present:=present+1;IF name=ANY(absent_tables) THEN present_in_absent:=present_in_absent+1;END IF;
  ELSIF NOT name=ANY(absent_tables) THEN
   RAISE EXCEPTION 'merge_portal_convergence_existing_eight_guards_required' USING ERRCODE='55000';
  END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgfoid=guard_function)<>present
 THEN RAISE EXCEPTION 'merge_portal_convergence_unknown_guard_alias_required_review' USING ERRCODE='55000';END IF;
 pre_state:=merge_hash='b9d5ec34f050761b5ae84da0d4391d90e506d201c3cf2e776942e47db1aa5037'
  AND present=8 AND present_in_absent=0 AND NOT(SELECT condeferrable FROM pg_catalog.pg_constraint WHERE oid=attachment_fk);
 post_state:=merge_hash='76a070a53a5789bc3a64e89e8eaeca3920443a258bf1d33972504e7d318c7b67'
  AND present=13 AND present_in_absent=5 AND (SELECT condeferrable FROM pg_catalog.pg_constraint WHERE oid=attachment_fk);
 IF NOT pre_state AND NOT post_state
 THEN RAISE EXCEPTION 'merge_portal_convergence_unknown_mixed_installation' USING ERRCODE='55000';END IF;
 -- Verify each of the four existing RI instances, not just pg_constraint flags.
 SELECT pg_catalog.array_agg(t.oid ORDER BY t.oid) FILTER(WHERE p.proname IN('RI_FKey_check_ins','RI_FKey_check_upd','RI_FKey_noaction_upd')),count(*)
 INTO permitted_ri,ri_count FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
 WHERE t.tgconstraint=attachment_fk AND t.tgisinternal AND t.tgenabled='O'
  AND p.pronamespace='pg_catalog'::regnamespace AND t.tginitdeferred=false
  AND ((p.proname='RI_FKey_cascade_del' AND NOT t.tgdeferrable AND t.tgtype=9)
   OR(p.proname='RI_FKey_check_ins' AND t.tgdeferrable=post_state AND t.tgtype=5)
   OR(p.proname IN('RI_FKey_check_upd','RI_FKey_noaction_upd') AND t.tgdeferrable=post_state AND t.tgtype=17));
 IF ri_count<>4 OR pg_catalog.cardinality(permitted_ri)<>3
 THEN RAISE EXCEPTION 'merge_portal_convergence_exact_attachment_ri_profile_required' USING ERRCODE='55000';END IF;
 -- Customer ownership columns on every present dynamic move table retain their
 -- existing type and optional-table semantics; no customer_profiles synthesis.
 FOREACH name IN ARRAY move_tables LOOP
  relation_oid:=pg_catalog.to_regclass('public.'||name);
  IF relation_oid IS NULL THEN CONTINUE;END IF;
  IF EXISTS(SELECT FROM pg_catalog.pg_attribute WHERE attrelid=relation_oid AND attname='company_id' AND attnum>0 AND NOT attisdropped)
   AND EXISTS(SELECT FROM pg_catalog.pg_attribute WHERE attrelid=relation_oid AND attname='customer_id' AND attnum>0 AND NOT attisdropped)
   AND EXISTS(SELECT FROM pg_catalog.pg_attribute WHERE attrelid=relation_oid AND attname IN('company_id','customer_id') AND attnum>0 AND NOT attisdropped AND atttypid<>'uuid'::regtype)
  THEN RAISE EXCEPTION 'merge_portal_convergence_dynamic_owner_type_required' USING ERRCODE='55000';END IF;
 END LOOP;
 IF post_state THEN RETURN;END IF;
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(canonical_body,'UTF8')),'hex')<>'76a070a53a5789bc3a64e89e8eaeca3920443a258bf1d33972504e7d318c7b67'
 THEN RAISE EXCEPTION 'merge_portal_convergence_immutable_canonical_body_required' USING ERRCODE='55000';END IF;
 -- Snapshot application function rows, all public constraints/triggers/column
 -- metadata and the privilege envelope. Only three exact RI deferrability bits
 -- and this FK flag are excluded from equality, then explicitly checked below.
 SELECT pg_catalog.jsonb_agg(CASE WHEN p.oid=merge_function THEN pg_catalog.to_jsonb(p)-'prosrc' ELSE pg_catalog.to_jsonb(p) END ORDER BY p.oid)
 INTO source_before FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace;
 SELECT pg_catalog.jsonb_agg(CASE WHEN c.oid=attachment_fk THEN pg_catalog.to_jsonb(c)-'condeferrable' ELSE pg_catalog.to_jsonb(c) END ORDER BY c.oid)
 INTO constraints_before FROM pg_catalog.pg_constraint c WHERE c.connamespace='public'::regnamespace;
 SELECT pg_catalog.jsonb_agg(CASE WHEN t.oid=ANY(permitted_ri) THEN pg_catalog.to_jsonb(t)-'tgdeferrable' ELSE pg_catalog.to_jsonb(t) END ORDER BY t.oid)
 INTO triggers_before FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
 WHERE c.relnamespace='public'::regnamespace;
 SELECT pg_catalog.jsonb_build_object(
  'relations',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.oid,c.relname,c.relnamespace,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.relkind) ORDER BY c.oid) FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN('r','p','v','m','f')),
  'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='public'::regnamespace AND a.attnum>0),
  'policies',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) ORDER BY q.oid) FROM pg_catalog.pg_policy q),
  'schemas',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(n) ORDER BY n.oid) FROM pg_catalog.pg_namespace n),
  'roles',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) ORDER BY q.oid) FROM pg_catalog.pg_roles q),
  'memberships',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) ORDER BY q.roleid,q.member,q.grantor) FROM pg_catalog.pg_auth_members q),
  'defaults',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) ORDER BY q.oid) FROM pg_catalog.pg_default_acl q)) INTO envelope_before;
 ALTER TABLE public.customer_case_attachments ALTER CONSTRAINT customer_case_attachments_case_owner_fk DEFERRABLE INITIALLY IMMEDIATE;
 FOREACH name IN ARRAY absent_tables LOOP
  EXECUTE pg_catalog.format('CREATE TRIGGER guard_merged_portal_customer_write BEFORE INSERT OR UPDATE OF company_id,customer_id ON public.%I FOR EACH ROW EXECUTE FUNCTION public.gridex_guard_merged_portal_customer_write()',name);
 END LOOP;
 ddl:=pg_catalog.pg_get_functiondef(merge_function);
 IF pg_catalog.length(ddl)-pg_catalog.length(pg_catalog.replace(ddl,old_body,''))<>pg_catalog.length(old_body)
 THEN RAISE EXCEPTION 'merge_portal_convergence_unique_definition_body_required' USING ERRCODE='55000';END IF;
 EXECUTE pg_catalog.replace(ddl,old_body,canonical_body);
 SELECT pg_catalog.jsonb_agg(CASE WHEN p.oid=merge_function THEN pg_catalog.to_jsonb(p)-'prosrc' ELSE pg_catalog.to_jsonb(p) END ORDER BY p.oid)
 INTO source_after FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace;
 SELECT pg_catalog.jsonb_agg(CASE WHEN c.oid=attachment_fk THEN pg_catalog.to_jsonb(c)-'condeferrable' ELSE pg_catalog.to_jsonb(c) END ORDER BY c.oid)
 INTO constraints_after FROM pg_catalog.pg_constraint c WHERE c.connamespace='public'::regnamespace;
 SELECT pg_catalog.jsonb_agg(CASE WHEN t.oid=ANY(permitted_ri) THEN pg_catalog.to_jsonb(t)-'tgdeferrable' ELSE pg_catalog.to_jsonb(t) END ORDER BY t.oid)
 INTO triggers_after FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
 WHERE c.relnamespace='public'::regnamespace AND NOT(c.relname=ANY(absent_tables) AND t.tgname='guard_merged_portal_customer_write');
 SELECT pg_catalog.jsonb_build_object(
  'relations',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.oid,c.relname,c.relnamespace,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.relkind) ORDER BY c.oid) FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN('r','p','v','m','f')),
  'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='public'::regnamespace AND a.attnum>0),
  'policies',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) ORDER BY q.oid) FROM pg_catalog.pg_policy q),
  'schemas',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(n) ORDER BY n.oid) FROM pg_catalog.pg_namespace n),
  'roles',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) ORDER BY q.oid) FROM pg_catalog.pg_roles q),
  'memberships',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) ORDER BY q.roleid,q.member,q.grantor) FROM pg_catalog.pg_auth_members q),
  'defaults',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) ORDER BY q.oid) FROM pg_catalog.pg_default_acl q)) INTO envelope_after;
 IF source_after IS DISTINCT FROM source_before OR constraints_after IS DISTINCT FROM constraints_before
 OR triggers_after IS DISTINCT FROM triggers_before OR envelope_after IS DISTINCT FROM envelope_before
 OR NOT(SELECT condeferrable AND NOT condeferred FROM pg_catalog.pg_constraint WHERE oid=attachment_fk)
 OR EXISTS(SELECT FROM pg_catalog.pg_trigger t WHERE t.oid=ANY(permitted_ri) AND(NOT t.tgdeferrable OR t.tginitdeferred))
 OR (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc WHERE oid=merge_function)
    IS DISTINCT FROM '76a070a53a5789bc3a64e89e8eaeca3920443a258bf1d33972504e7d318c7b67'
 THEN RAISE EXCEPTION 'merge_portal_convergence_complete_catalog_preservation_required' USING ERRCODE='55000';END IF;
 -- New5 rows have no before snapshot: validate their complete allowed shape
 -- after the last DDL, so a later event-trigger alteration cannot be hidden.
 FOREACH name IN ARRAY absent_tables LOOP
  relation_oid:=pg_catalog.to_regclass('public.'||name);
  SELECT attnum INTO company_column FROM pg_catalog.pg_attribute WHERE attrelid=relation_oid AND attname='company_id' AND attnum>0 AND NOT attisdropped;
  SELECT attnum INTO customer_column FROM pg_catalog.pg_attribute WHERE attrelid=relation_oid AND attname='customer_id' AND attnum>0 AND NOT attisdropped;
  SELECT t.* INTO trig FROM pg_catalog.pg_trigger t WHERE t.tgrelid=relation_oid AND t.tgname='guard_merged_portal_customer_write';
  IF NOT FOUND OR trig.tgfoid<>guard_function OR trig.tgisinternal OR trig.tgenabled<>'O' OR trig.tgtype<>23
   OR trig.tgconstraint<>0 OR trig.tgconstrrelid<>0 OR trig.tgdeferrable OR trig.tginitdeferred
   OR trig.tgattr::text IS DISTINCT FROM company_column::text||' '||customer_column::text
   OR trig.tgnargs<>0 OR pg_catalog.octet_length(trig.tgargs)<>0 OR trig.tgqual IS NOT NULL OR trig.tgoldtable IS NOT NULL OR trig.tgnewtable IS NOT NULL
  THEN RAISE EXCEPTION 'merge_portal_convergence_new_guard_final_profile_required' USING ERRCODE='55000';END IF;
 END LOOP;
END $customer_merge_portal_convergence$;
