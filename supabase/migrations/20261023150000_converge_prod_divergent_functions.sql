-- Converge five functions whose production body differs from the repository.
--
-- The first four take the production body byte-for-byte (prosrc sha256 noted
-- per function):
--   gridex_apply_exact_z02_core                    04902d0a… re-checks that the
--     request and the site belong to the given company and customer, under
--     row locks, before the first application of a Z02. It keeps the
--     repository's search_path 'pg_catalog' (production still has 'public');
--     every relation and helper in the body is schema-qualified.
--   gridex_dependency_circuit_before_request_v1    f164fc53… only half-opens an
--     open circuit whose half_open_after is set.
--   gridex_stage_energy_geodata_features_v2        da6b6286… same checks and
--     upsert, written with a materialized batch CTE.
--   gridex_create_invoice_export_graph_v1_core     aa5e13cc… leaves the draft
--     invoice's partner_export_id null until the provider event records it,
--     and writes an explicit draft invoice_reference that
--     customer_invoices_public_reference_trg replaces on insert.
--
-- run_tenant_integrity_audit merges both OUTBOUND-001 variants. Production
-- also compared the outbound request with its supplier switch and contract;
-- the repository also compared its customer with the metering point customer.
-- The switch and contract links are read through to_jsonb(o) because the
-- typed replay schema of outbound_requests does not carry those columns
-- (20260830012500), so the body runs on both schemas. Grants of all five
-- functions are unchanged.

CREATE OR REPLACE FUNCTION public.gridex_apply_exact_z02_core(p_company_id uuid, p_customer_id uuid, p_site_id uuid, p_request_id uuid, p_message_id uuid, p_operation_id uuid DEFAULT NULL::uuid, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE m public.ediel_messages%rowtype;s gridex_received_sources.sources%rowtype;
 prior gridex_received_sources.z02_core_applications%rowtype;application jsonb;obj jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN
  RAISE EXCEPTION 'z02_source_service_required' USING ERRCODE='42501';END IF;
 -- Preserve the deployed atomic-core request -> message -> site lock order.
 -- These are the same tenant/customer/site predicates as the protected kernel.
 IF NOT EXISTS(SELECT FROM gridex_received_sources.z02_core_applications
  WHERE source_message_id=p_message_id AND request_id=p_request_id) THEN
  PERFORM r.id FROM public.customer_info_requests r WHERE r.id=p_request_id
   AND r.company_id=p_company_id AND r.customer_id=p_customer_id AND r.site_id=p_site_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','z02_request_site_customer_mismatch');END IF;
 END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z02' THEN
  RETURN jsonb_build_object('ok',false,'code','z02_inbound_message_not_found');END IF;
 IF NOT EXISTS(SELECT FROM gridex_received_sources.z02_core_applications
  WHERE source_message_id=p_message_id AND request_id=p_request_id) THEN
  PERFORM site.id FROM public.customer_sites site WHERE site.id=p_site_id
   AND site.company_id=p_company_id AND site.customer_id=p_customer_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','z02_site_not_found');END IF;
 END IF;
 SELECT * INTO s FROM gridex_received_sources.sources WHERE source_message_id=m.id AND company_id=p_company_id AND environment=m.environment AND message_code='Z02';
 IF s.source_message_id IS NULL OR s.raw_payload IS NULL OR s.raw_payload IS DISTINCT FROM m.raw_payload
  OR s.payload_hash IS DISTINCT FROM m.immutable_payload_hash OR s.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN
  RETURN jsonb_build_object('ok',false,'code','z02_frozen_source_unavailable');END IF;
 SELECT * INTO prior FROM gridex_received_sources.z02_core_applications WHERE source_message_id=m.id AND request_id=p_request_id;
 IF prior.source_message_id IS NOT NULL AND (prior.company_id IS DISTINCT FROM p_company_id OR prior.environment IS DISTINCT FROM m.environment
   OR prior.customer_id IS DISTINCT FROM p_customer_id OR prior.site_id IS DISTINCT FROM p_site_id OR prior.source_payload_hash IS DISTINCT FROM s.payload_hash) THEN
  RETURN jsonb_build_object('ok',false,'code','z02_applied_source_scope_mismatch');END IF;
 -- Fixed history remains confidential. Current READ authorization does not
 -- relabel, replay or apply the old result and does not reselect its rulepack.
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id
  AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'z02_execution_actor_required' USING ERRCODE='42501';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'z02_execution_actor_required' USING ERRCODE='42501';END IF;
 IF prior.source_message_id IS NOT NULL THEN
  IF NOT(coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.read'),false)
   OR coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.read'),false)) THEN
   RAISE EXCEPTION 'z02_history_actor_read_required' USING ERRCODE='42501';END IF;
  RETURN prior.result;
 END IF;
 IF public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS NOT TRUE THEN
  RAISE EXCEPTION 'z02_execution_actor_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_inbound_context.require_v1(p_company_id,m.id);
 PERFORM gridex_ediel_source_rules.require_v1(p_company_id,m.id);
 application:=gridex_received_sources.require_prodat_application_objects_v1(p_company_id,m.id);
 IF application->>'headerDecision' IS DISTINCT FROM 'accepted' OR jsonb_typeof(application->'objects') IS DISTINCT FROM 'array'
  OR jsonb_array_length(application->'objects')=0 THEN RETURN jsonb_build_object('ok',false,'code','z02_own_application_scope_unavailable');END IF;
 -- The legacy whole-source Z02 operation still requires global acceptance.
 -- Its exact own LIN/register correlation is unchanged in the delegate. Full
 -- canonical field-owner acceptance is additionally required, never inferred
 -- from a register-only or ACK-planning facet.
 FOR obj IN SELECT e FROM jsonb_array_elements(application->'objects') e LOOP
  IF gridex_received_sources.prodat_application_object_accepted_v1(p_company_id,m.id,(application->>'assessmentId')::uuid,obj-'applicationDecision'-'reasonCodes') IS DISTINCT FROM true THEN
   RETURN jsonb_build_object('ok',false,'code','z02_own_application_scope_unavailable');END IF;
 END LOOP;
 RETURN gridex_received_sources.gridex_apply_exact_z02_core_before_current_source_v1(p_company_id,p_customer_id,p_site_id,p_request_id,m.id,p_operation_id,p_actor_user_id);
END $function$;

CREATE OR REPLACE FUNCTION public.gridex_dependency_circuit_before_request_v1(p_dependency_key text, p_probe_lease_seconds integer DEFAULT 30)
 RETURNS TABLE(allowed boolean, circuit_state text, retry_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_key text := lower(btrim(coalesce(p_dependency_key, '')));
  v_row public.dependency_circuit_state%rowtype;
begin
  if v_key !~ '^[a-z0-9._:-]{2,100}$' or p_probe_lease_seconds < 5 or p_probe_lease_seconds > 300 then
    raise exception using errcode = '22023', message = 'dependency_circuit_input_invalid';
  end if;

  insert into public.dependency_circuit_state(dependency_key)
  values (v_key)
  on conflict (dependency_key) do nothing;

  select * into v_row
  from public.dependency_circuit_state
  where dependency_key = v_key
  for update;

  if v_row.state = 'closed' then
    update public.dependency_circuit_state
    set last_attempt_at = now(), updated_at = now()
    where dependency_key = v_key;
    return query select true, 'closed'::text, null::timestamptz;
    return;
  end if;

  if v_row.state = 'open' and v_row.half_open_after is not null and v_row.half_open_after <= now() then
    update public.dependency_circuit_state
    set state = 'half_open',
        probe_lease_expires_at = now() + make_interval(secs => p_probe_lease_seconds),
        last_attempt_at = now(),
        updated_at = now()
    where dependency_key = v_key;
    return query select true, 'half_open'::text, null::timestamptz;
    return;
  end if;

  if v_row.state = 'half_open'
     and (v_row.probe_lease_expires_at is null or v_row.probe_lease_expires_at <= now()) then
    update public.dependency_circuit_state
    set probe_lease_expires_at = now() + make_interval(secs => p_probe_lease_seconds),
        last_attempt_at = now(),
        updated_at = now()
    where dependency_key = v_key;
    return query select true, 'half_open'::text, null::timestamptz;
    return;
  end if;

  return query select false, v_row.state, coalesce(v_row.half_open_after, v_row.probe_lease_expires_at);
end
$function$;

CREATE OR REPLACE FUNCTION public.gridex_stage_energy_geodata_features_v2(p_geodata_version_id uuid, p_features jsonb)
 RETURNS TABLE(rows_received integer, rows_upserted integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_received integer;
  v_upserted integer;
begin
  if p_geodata_version_id is null
     or p_features is null
     or jsonb_typeof(p_features) <> 'array'
     or jsonb_array_length(p_features) < 1
     or jsonb_array_length(p_features) > 1000 then
    raise exception using errcode = '22023', message = 'invalid_energy_geodata_feature_batch';
  end if;

  if not exists (
    select 1 from public.energy_geodata_versions
    where id = p_geodata_version_id and provider = 'svk_arcgis' and status = 'importing'
  ) then
    raise exception using errcode = '55000', message = 'energy_geodata_version_not_importing';
  end if;

  with batch as materialized (
    select btrim(feature_id) as feature_id,
           coalesce(properties, '{}'::jsonb) as properties,
           geometry_geojson,
           nullif(btrim(coalesce(source_url, '')), '') as source_url
    from jsonb_to_recordset(p_features) as f(
      feature_id text,
      properties jsonb,
      geometry_geojson jsonb,
      source_url text
    )
  )
  select count(*)::integer into v_received from batch;

  if exists (
    select 1
    from jsonb_to_recordset(p_features) as f(
      feature_id text,
      properties jsonb,
      geometry_geojson jsonb,
      source_url text
    )
    where nullif(btrim(feature_id), '') is null
       or geometry_geojson is null
       or jsonb_typeof(geometry_geojson) <> 'object'
  ) then
    raise exception using errcode = '22023', message = 'invalid_energy_geodata_feature';
  end if;

  insert into public.energy_geodata_features_staging(
    geodata_version_id, feature_id, source_url, properties, geometry_geojson, updated_at
  )
  select
    p_geodata_version_id,
    btrim(f.feature_id),
    nullif(btrim(coalesce(f.source_url, '')), ''),
    coalesce(f.properties, '{}'::jsonb),
    f.geometry_geojson,
    now()
  from jsonb_to_recordset(p_features) as f(
    feature_id text,
    properties jsonb,
    geometry_geojson jsonb,
    source_url text
  )
  on conflict (geodata_version_id, feature_id) do update set
    source_url = excluded.source_url,
    properties = excluded.properties,
    geometry_geojson = excluded.geometry_geojson,
    updated_at = now();

  get diagnostics v_upserted = row_count;
  return query select v_received, v_upserted;
end
$function$;

CREATE OR REPLACE FUNCTION public.gridex_create_invoice_export_graph_v1_core(p_run jsonb, p_items jsonb, p_invoices jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_company_id uuid:=nullif(p_run->>'company_id','')::uuid;
  v_run_id uuid:=coalesce(nullif(p_run->>'id','')::uuid,gen_random_uuid());
  v_idempotency_key text:=nullif(p_run->>'idempotency_key','');
  v_existing_id uuid;
  v_item jsonb;
  v_invoice jsonb;
  v_underlay public.billing_underlays%rowtype;
  v_export_item_id uuid;
  v_count integer:=0;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='invoice_export_graph_service_role_required';
  end if;
  if v_company_id is null or v_idempotency_key is null then
    raise exception using errcode='22023',message='invoice_export_company_idempotency_required';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_invoices,'[]'::jsonb))<>'array'
     or jsonb_array_length(coalesce(p_items,'[]'::jsonb))<>jsonb_array_length(coalesce(p_invoices,'[]'::jsonb)) then
    raise exception using errcode='22023',message='invoice_export_graph_array_mismatch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text||':'||v_idempotency_key,0));
  select id into v_existing_id from public.invoice_export_runs where company_id=v_company_id and idempotency_key=v_idempotency_key;
  if v_existing_id is not null then return jsonb_build_object('run_id',v_existing_id,'existing',true); end if;

  insert into public.invoice_export_runs(
    id,company_id,provider,environment,billing_month,financing_mode,status,total_items,readiness_snapshot,metadata,requested_by,idempotency_key
  ) values (
    v_run_id,v_company_id,coalesce(nullif(p_run->>'provider',''),'capway_aptic'),coalesce(nullif(p_run->>'environment',''),'test'),p_run->>'billing_month',
    coalesce(nullif(p_run->>'financing_mode',''),'invoice_service'),'draft',jsonb_array_length(p_items),coalesce(p_run->'readiness_snapshot','{}'::jsonb),
    coalesce(p_run->'metadata','{}'::jsonb),nullif(p_run->>'requested_by','')::uuid,v_idempotency_key
  );

  for v_item,v_invoice in
    select i.value,n.value from jsonb_array_elements(p_items) with ordinality i(value,ordinality)
    join jsonb_array_elements(p_invoices) with ordinality n(value,ordinality) using(ordinality)
  loop
    v_export_item_id:=nullif(v_item->>'id','')::uuid;
    select * into v_underlay from public.billing_underlays
    where id=nullif(v_item->>'billing_underlay_id','')::uuid and company_id=v_company_id for share;
    if not found
       or v_underlay.customer_id is distinct from nullif(v_item->>'customer_id','')::uuid
       or coalesce(v_underlay.customer_contract_id,v_underlay.contract_id) is distinct from nullif(v_item->>'customer_contract_id','')::uuid then
      raise exception using errcode='23514',message='invoice_export_underlay_customer_contract_mismatch';
    end if;

    insert into public.invoice_export_items(
      id,company_id,export_run_id,customer_id,billing_underlay_id,pricing_run_id,customer_contract_id,metering_point_id,period_start,period_end,total_kwh,currency,
      provider,environment,status,financing_mode,amount_ex_vat,vat_amount,amount_inc_vat,idempotency_key,metadata
    ) values (
      v_export_item_id,v_company_id,v_run_id,nullif(v_item->>'customer_id','')::uuid,v_underlay.id,nullif(v_item->>'pricing_run_id','')::uuid,
      nullif(v_item->>'customer_contract_id','')::uuid,nullif(v_item->>'metering_point_id','')::uuid,nullif(v_item->>'period_start','')::date,nullif(v_item->>'period_end','')::date,
      nullif(v_item->>'total_kwh','')::numeric,coalesce(nullif(v_item->>'currency',''),'SEK'),coalesce(nullif(v_item->>'provider',''),'capway_aptic'),
      coalesce(nullif(v_item->>'environment',''),'test'),'pending',coalesce(nullif(v_item->>'financing_mode',''),'invoice_service'),
      coalesce(nullif(v_item->>'amount_ex_vat','')::numeric,0),coalesce(nullif(v_item->>'vat_amount','')::numeric,0),coalesce(nullif(v_item->>'amount_inc_vat','')::numeric,0),
      nullif(v_item->>'idempotency_key',''),coalesce(v_item->'metadata','{}'::jsonb)
    );

    if nullif(v_invoice->>'invoice_export_item_id','')::uuid is distinct from v_export_item_id
       or nullif(v_invoice->>'customer_id','')::uuid is distinct from v_underlay.customer_id
       or nullif(v_invoice->>'customer_contract_id','')::uuid is distinct from coalesce(v_underlay.customer_contract_id,v_underlay.contract_id) then
      raise exception using errcode='23514',message='customer_invoice_export_identity_mismatch';
    end if;

    insert into public.customer_invoices(
      company_id,customer_id,contract_id,customer_contract_id,billing_underlay_id,partner_export_id,partner_invoice_reference,invoice_reference,
      invoice_export_item_id,canonical_export_item_id,period_start,period_end,total_kwh,amount_ex_vat,vat_amount,amount_inc_vat,currency,status,source_system,metadata,updated_at
    ) values (
      v_company_id,v_underlay.customer_id,coalesce(v_underlay.customer_contract_id,v_underlay.contract_id),coalesce(v_underlay.customer_contract_id,v_underlay.contract_id),
      v_underlay.id,null,
      coalesce(nullif(v_invoice->>'partner_invoice_reference',''),'pending:'||v_export_item_id::text),
      coalesce(nullif(v_invoice->>'invoice_reference',''),'draft:'||v_export_item_id::text),
      v_export_item_id,v_export_item_id,nullif(v_invoice->>'period_start','')::date,nullif(v_invoice->>'period_end','')::date,nullif(v_invoice->>'total_kwh','')::numeric,
      coalesce(nullif(v_invoice->>'amount_ex_vat','')::numeric,0),coalesce(nullif(v_invoice->>'vat_amount','')::numeric,0),coalesce(nullif(v_invoice->>'amount_inc_vat','')::numeric,0),
      coalesce(nullif(v_invoice->>'currency',''),'SEK'),'draft','canonical_invoice_export',coalesce(v_invoice->'metadata','{}'::jsonb),now()
    );
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('run_id',v_run_id,'existing',false,'item_count',v_count);
end
$function$;

CREATE OR REPLACE FUNCTION public.run_tenant_integrity_audit(p_company_id uuid DEFAULT NULL::uuid, p_scope text DEFAULT 'all'::text, p_requested_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_run_id uuid;
  v_scope text := lower(coalesce(nullif(btrim(p_scope),''),'all'));
  v_total integer := 0;
  v_critical integer := 0;
  v_high integer := 0;
  v_medium integer := 0;
  v_low integer := 0;
  v_info integer := 0;
begin
  if v_scope not in ('all','access','operations','ediel') then
    raise exception using errcode='22023', message='tenant_integrity_invalid_scope';
  end if;
  if p_company_id is not null and not exists(select 1 from public.companies c where c.id=p_company_id) then
    raise exception using errcode='P0002', message='tenant_integrity_company_not_found';
  end if;

  insert into public.tenant_integrity_audit_runs(company_id,scope,requested_by,status,metadata)
  values(p_company_id,v_scope,p_requested_by,'running',jsonb_build_object('engine_version','v1'))
  returning id into v_run_id;

  begin
    if v_scope in ('all','operations') then
      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'TENANT-001',c.id,'company',c.id,r.severity,r.title,
             'Tenant lifecycle/status flags contradict the canonical tenant state.',
             md5('TENANT-001:'||c.id::text),
             jsonb_build_object('status',c.status,'is_active',c.is_active,'is_paused',c.is_paused,'lifecycle_status',c.lifecycle_status,'outbound_frozen',c.outbound_frozen)
      from public.companies c
      join public.tenant_integrity_rule_registry r on r.rule_key='TENANT-001' and r.is_enabled
      where (p_company_id is null or c.id=p_company_id)
        and (
          (c.status='paused' and coalesce(c.is_paused,false)=false)
          or (coalesce(c.is_paused,false)=true and c.status<>'paused')
          or (c.status in ('suspended','archived','pending_deletion','closed','deleted_test_only') and coalesce(c.is_active,false)=true)
        );

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'OPS-001',x.company_id,x.entity_type,x.entity_id,r.severity,r.title,
             x.message,md5('OPS-001:'||x.entity_type||':'||x.entity_id::text),x.evidence
      from (
        select coalesce(s.company_id,c.company_id) company_id,'customer_site'::text entity_type,s.id entity_id,
               'Customer site tenant differs from its customer tenant.'::text message,
               jsonb_build_object('site_company_id',s.company_id,'customer_company_id',c.company_id,'customer_id',c.id) evidence
        from public.customer_sites s join public.customers c on c.id=s.customer_id
        where s.company_id is distinct from c.company_id
          and (p_company_id is null or s.company_id=p_company_id or c.company_id=p_company_id)
        union all
        select coalesce(mp.company_id,s.company_id,c.company_id),'metering_point',mp.id,
               'Metering point relation disagrees with customer/site tenant or customer identity.',
               jsonb_build_object('meter_company_id',mp.company_id,'site_company_id',s.company_id,'customer_company_id',c.company_id,'meter_customer_id',mp.customer_id,'site_customer_id',s.customer_id,'site_id',s.id)
        from public.metering_points mp
        join public.customer_sites s on s.id=mp.site_id
        join public.customers c on c.id=s.customer_id
        where (mp.company_id is distinct from s.company_id or s.company_id is distinct from c.company_id or (mp.customer_id is not null and mp.customer_id is distinct from s.customer_id))
          and (p_company_id is null or mp.company_id=p_company_id or s.company_id=p_company_id or c.company_id=p_company_id)
        union all
        select coalesce(cc.company_id,c.company_id),'customer_contract',cc.id,
               'Customer contract relation disagrees with customer/site/metering point tenant.',
               jsonb_build_object('contract_company_id',cc.company_id,'customer_company_id',c.company_id,'site_company_id',s.company_id,'meter_company_id',mp.company_id,'customer_id',cc.customer_id,'site_id',coalesce(cc.customer_site_id,cc.site_id),'metering_point_id',cc.metering_point_id)
        from public.customer_contracts cc
        join public.customers c on c.id=cc.customer_id
        left join public.customer_sites s on s.id=coalesce(cc.customer_site_id,cc.site_id)
        left join public.metering_points mp on mp.id=cc.metering_point_id
        where (cc.company_id is distinct from c.company_id or (s.id is not null and cc.company_id is distinct from s.company_id) or (mp.id is not null and cc.company_id is distinct from mp.company_id))
          and (p_company_id is null or cc.company_id=p_company_id or c.company_id=p_company_id or s.company_id=p_company_id or mp.company_id=p_company_id)
        union all
        select coalesce(sw.company_id,c.company_id),'supplier_switch_request',sw.id,
               'Supplier switch relation disagrees with customer/site/metering point/contract tenant.',
               jsonb_build_object('switch_company_id',sw.company_id,'customer_company_id',c.company_id,'site_company_id',s.company_id,'meter_company_id',mp.company_id,'contract_company_id',cc.company_id,'customer_id',sw.customer_id,'site_id',sw.site_id,'metering_point_id',sw.metering_point_id)
        from public.supplier_switch_requests sw
        join public.customers c on c.id=sw.customer_id
        join public.customer_sites s on s.id=sw.site_id
        join public.metering_points mp on mp.id=sw.metering_point_id
        left join public.customer_contracts cc on cc.id=coalesce(sw.customer_contract_id,sw.contract_id)
        where (sw.company_id is distinct from c.company_id or sw.company_id is distinct from s.company_id or sw.company_id is distinct from mp.company_id or (cc.id is not null and sw.company_id is distinct from cc.company_id) or s.customer_id is distinct from sw.customer_id or (mp.customer_id is not null and mp.customer_id is distinct from sw.customer_id))
          and (p_company_id is null or sw.company_id=p_company_id or c.company_id=p_company_id or s.company_id=p_company_id or mp.company_id=p_company_id or cc.company_id=p_company_id)
      ) x
      join public.tenant_integrity_rule_registry r on r.rule_key='OPS-001' and r.is_enabled;

      -- The switch and contract links are optional columns of outbound_requests:
      -- to_jsonb(o) yields null for a column the table does not carry.
      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'OUTBOUND-001',coalesce(o.company_id,c.company_id), 'outbound_request',o.id,r.severity,r.title,
             'Outbound request tenant disagrees with one or more linked business entities.',
             md5('OUTBOUND-001:'||o.id::text),
             jsonb_build_object('outbound_company_id',o.company_id,'customer_company_id',c.company_id,'site_company_id',s.company_id,'meter_company_id',mp.company_id,'switch_company_id',sw.company_id,'contract_company_id',cc.company_id,'customer_id',o.customer_id,'meter_customer_id',mp.customer_id,'site_id',coalesce(o.customer_site_id,o.site_id),'metering_point_id',o.metering_point_id)
      from public.outbound_requests o
      join public.customers c on c.id=o.customer_id
      left join public.customer_sites s on s.id=coalesce(o.customer_site_id,o.site_id)
      left join public.metering_points mp on mp.id=o.metering_point_id
      left join public.supplier_switch_requests sw on sw.id=coalesce(nullif(to_jsonb(o)->>'supplier_switch_request_id',''),nullif(to_jsonb(o)->>'switch_request_id',''))::uuid
      left join public.customer_contracts cc on cc.id=coalesce(nullif(to_jsonb(o)->>'customer_contract_id',''),nullif(to_jsonb(o)->>'contract_id',''))::uuid
      join public.tenant_integrity_rule_registry r on r.rule_key='OUTBOUND-001' and r.is_enabled
      where (
          o.company_id is distinct from c.company_id
          or (s.id is not null and o.company_id is distinct from s.company_id)
          or (mp.id is not null and o.company_id is distinct from mp.company_id)
          or (mp.id is not null and mp.customer_id is not null and o.customer_id is distinct from mp.customer_id)
          or (sw.id is not null and o.company_id is distinct from sw.company_id)
          or (cc.id is not null and o.company_id is distinct from cc.company_id)
          or (o.customer_site_id is not null and o.site_id is not null and o.customer_site_id<>o.site_id)
        )
        and (p_company_id is null or o.company_id=p_company_id or c.company_id=p_company_id or s.company_id=p_company_id or mp.company_id=p_company_id or sw.company_id=p_company_id or cc.company_id=p_company_id);
    end if;

    if v_scope in ('all','access') then
      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'ACCESS-001',cm.company_id,'company_membership',cm.id,r.severity,r.title,
             'Active membership does not resolve to an active user profile.',md5('ACCESS-001:'||cm.id::text),
             jsonb_build_object('user_id',cm.user_id,'membership_status',cm.status,'membership_is_active',cm.is_active,'profile_status',up.user_status)
      from public.company_memberships cm
      left join public.user_profiles up on up.id=cm.user_id
      join public.tenant_integrity_rule_registry r on r.rule_key='ACCESS-001' and r.is_enabled
      where cm.status='active' and coalesce(cm.is_active,true)=true
        and (up.id is null or up.user_status<>'active')
        and (p_company_id is null or cm.company_id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'ACCESS-002',cm.company_id,'company_membership',cm.id,r.severity,r.title,
             'membership_role does not match canonical role_key mapping.',md5('ACCESS-002:'||cm.id::text),
             jsonb_build_object('user_id',cm.user_id,'role_key',cm.role_key,'membership_role',cm.membership_role,'expected_membership_role',m.membership_role)
      from public.company_memberships cm
      left join public.canonical_tenant_access_role_mapping m on m.role_key=lower(cm.role_key)
      join public.tenant_integrity_rule_registry r on r.rule_key='ACCESS-002' and r.is_enabled
      where cm.status='active' and coalesce(cm.is_active,true)=true
        and (cm.role_key is null or m.role_key is null or lower(cm.membership_role)<>lower(m.membership_role))
        and (p_company_id is null or cm.company_id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'ACCESS-003',cm.company_id,'company_membership',cm.id,r.severity,r.title,
             'Active membership lacks a matching active tenant RBAC role.',md5('ACCESS-003:'||cm.id::text),
             jsonb_build_object('user_id',cm.user_id,'role_key',cm.role_key,'membership_role',cm.membership_role)
      from public.company_memberships cm
      join public.tenant_integrity_rule_registry r on r.rule_key='ACCESS-003' and r.is_enabled
      where cm.status='active' and coalesce(cm.is_active,true)=true
        and not exists (
          select 1 from public.user_roles ur
          join public.roles rr on rr.id=ur.role_id
          where ur.company_id=cm.company_id and ur.user_id=cm.user_id
            and ur.status='active' and coalesce(ur.is_active,true)=true
            and lower(coalesce(rr.key,rr.name,ur.role,''))=lower(coalesce(cm.role_key,''))
        )
        and (p_company_id is null or cm.company_id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'ACCESS-004',up.active_company_id,'user_profile',up.id,r.severity,r.title,
             'active_company_id points to a tenant without an active membership.',md5('ACCESS-004:'||up.id::text||':'||up.active_company_id::text),
             jsonb_build_object('user_id',up.id,'active_company_id',up.active_company_id,'profile_status',up.user_status)
      from public.user_profiles up
      join public.tenant_integrity_rule_registry r on r.rule_key='ACCESS-004' and r.is_enabled
      where up.active_company_id is not null
        and not exists (
          select 1 from public.company_memberships cm
          where cm.company_id=up.active_company_id and cm.user_id=up.id
            and cm.status='active' and coalesce(cm.is_active,true)=true
        )
        and (p_company_id is null or up.active_company_id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'ACCESS-005',ci.company_id,'company_invitation',ci.id,r.severity,r.title,
             'Accepted invitation has no membership row for the invited tenant/user.',md5('ACCESS-005:'||ci.id::text),
             jsonb_build_object('invited_user_id',ci.invited_user_id,'invitation_status',ci.status,'role_key',ci.role_key,'membership_role',ci.membership_role)
      from public.company_invitations ci
      join public.tenant_integrity_rule_registry r on r.rule_key='ACCESS-005' and r.is_enabled
      where ci.status='accepted'
        and (ci.invited_user_id is null or not exists(
          select 1 from public.company_memberships cm where cm.company_id=ci.company_id and cm.user_id=ci.invited_user_id
        ))
        and (p_company_id is null or ci.company_id=p_company_id);
    end if;

    if v_scope in ('all','ediel') then
      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'EDIEL-001',coalesce(em.company_id,c.company_id,s.company_id,mp.company_id,o.company_id,sw.company_id),
             'ediel_message',em.id,r.severity,r.title,
             'Outbound Ediel message tenant disagrees with one or more linked business entities.',md5('EDIEL-001:'||em.id::text),
             jsonb_build_object('message_company_id',em.company_id,'customer_company_id',c.company_id,'site_company_id',s.company_id,'meter_company_id',mp.company_id,'outbound_company_id',o.company_id,'switch_company_id',sw.company_id,'status',em.status,'environment',em.environment)
      from public.ediel_messages em
      left join public.customers c on c.id=em.customer_id
      left join public.customer_sites s on s.id=em.site_id
      left join public.metering_points mp on mp.id=em.metering_point_id
      left join public.outbound_requests o on o.id=em.outbound_request_id
      left join public.supplier_switch_requests sw on sw.id=em.switch_request_id
      join public.tenant_integrity_rule_registry r on r.rule_key='EDIEL-001' and r.is_enabled
      where em.direction='outbound' and em.status<>'draft'
        and (
          (c.id is not null and em.company_id is distinct from c.company_id)
          or (s.id is not null and em.company_id is distinct from s.company_id)
          or (mp.id is not null and em.company_id is distinct from mp.company_id)
          or (o.id is not null and em.company_id is distinct from o.company_id)
          or (sw.id is not null and em.company_id is distinct from sw.company_id)
        )
        and (p_company_id is null or em.company_id=p_company_id or c.company_id=p_company_id or s.company_id=p_company_id or mp.company_id=p_company_id or o.company_id=p_company_id or sw.company_id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'EDIEL-002',coalesce(em.company_id,em.resolved_company_id),'ediel_message',em.id,r.severity,r.title,
             'Ediel message company_id disagrees with resolved_company_id.',md5('EDIEL-002:'||em.id::text),
             jsonb_build_object('company_id',em.company_id,'resolved_company_id',em.resolved_company_id,'direction',em.direction,'status',em.status,'tenant_resolution_status',em.tenant_resolution_status)
      from public.ediel_messages em
      join public.tenant_integrity_rule_registry r on r.rule_key='EDIEL-002' and r.is_enabled
      where em.company_id is not null and em.resolved_company_id is not null and em.company_id<>em.resolved_company_id
        and (p_company_id is null or em.company_id=p_company_id or em.resolved_company_id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'EDIEL-003',coalesce(eo.company_id,em.company_id),'ediel_outbox',eo.id,r.severity,r.title,
             'Sendable Ediel outbox tenant disagrees with its Ediel message tenant.',md5('EDIEL-003:'||eo.id::text),
             jsonb_build_object('outbox_company_id',eo.company_id,'message_company_id',em.company_id,'ediel_message_id',em.id,'outbox_status',eo.status,'environment',eo.environment)
      from public.ediel_outbox eo
      join public.ediel_messages em on em.id=eo.ediel_message_id
      join public.tenant_integrity_rule_registry r on r.rule_key='EDIEL-003' and r.is_enabled
      where eo.status in ('prepared','queued','sending','sent','delivery_uncertain')
        and eo.company_id is distinct from em.company_id
        and (p_company_id is null or eo.company_id=p_company_id or em.company_id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'EDIEL-004',c.id,'ediel_outbox',eo.id,r.severity,r.title,
             'Tenant is blocked/frozen but production Ediel work remains sendable.',md5('EDIEL-004:'||eo.id::text),
             jsonb_build_object('company_status',c.status,'outbound_frozen',c.outbound_frozen,'ediel_production_status',c.ediel_production_status,'outbox_status',eo.status,'environment',eo.environment,'ediel_message_id',eo.ediel_message_id)
      from public.ediel_outbox eo
      join public.companies c on c.id=eo.company_id
      join public.tenant_integrity_rule_registry r on r.rule_key='EDIEL-004' and r.is_enabled
      where eo.environment='production' and eo.status in ('prepared','queued','sending')
        and (c.status in ('paused','suspended','archived','pending_deletion','closed','deleted_test_only') or coalesce(c.outbound_frozen,false)=true or c.ediel_production_status in ('paused','blocked'))
        and (p_company_id is null or c.id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'EDIEL-005',c.id,'company',c.id,r.severity,r.title,
             'Production Ediel is enabled/live but no active valid production actor setting exists.',md5('EDIEL-005:'||c.id::text),
             jsonb_build_object('ediel_production_enabled',c.ediel_production_enabled,'live_ediel_enabled',c.live_ediel_enabled,'ediel_production_status',c.ediel_production_status)
      from public.companies c
      join public.tenant_integrity_rule_registry r on r.rule_key='EDIEL-005' and r.is_enabled
      where (coalesce(c.ediel_production_enabled,false)=true or coalesce(c.live_ediel_enabled,false)=true or c.ediel_production_status='live')
        and not exists (
          select 1 from public.ediel_actor_settings eas
          where eas.company_id=c.id and eas.environment='production' and eas.is_active=true
            and (eas.valid_from is null or eas.valid_from<=current_date)
            and (eas.valid_to is null or eas.valid_to>=current_date)
        )
        and (p_company_id is null or c.id=p_company_id);

      insert into public.tenant_integrity_findings
        (run_id,rule_key,company_id,entity_type,entity_id,severity,title,message,fingerprint,evidence)
      select v_run_id,'EDIEL-006',tep.company_id,'tenant_ediel_profile',min(tep.id::text)::uuid,r.severity,r.title,
             'More than one currently active tenant Ediel profile overlaps for the same tenant/environment/market.',
             md5('EDIEL-006:'||tep.company_id::text||':'||tep.environment||':'||tep.market),
             jsonb_build_object('environment',tep.environment,'market',tep.market,'active_profile_count',count(*),'profile_ids',jsonb_agg(tep.id order by tep.valid_from,tep.id))
      from public.tenant_ediel_profiles tep
      join public.tenant_integrity_rule_registry r on r.rule_key='EDIEL-006' and r.is_enabled
      where tep.is_enabled=true and tep.valid_from<=now() and (tep.valid_to is null or tep.valid_to>now())
        and (p_company_id is null or tep.company_id=p_company_id)
      group by tep.company_id,tep.environment,tep.market,r.severity,r.title
      having count(*)>1;
    end if;

    select count(*)::integer,
           count(*) filter(where severity='critical')::integer,
           count(*) filter(where severity='high')::integer,
           count(*) filter(where severity='medium')::integer,
           count(*) filter(where severity='low')::integer,
           count(*) filter(where severity='info')::integer
      into v_total,v_critical,v_high,v_medium,v_low,v_info
    from public.tenant_integrity_findings where run_id=v_run_id;

    update public.tenant_integrity_audit_runs
    set status='completed',finished_at=now(),finding_count=v_total,critical_count=v_critical,high_count=v_high,
        medium_count=v_medium,low_count=v_low,info_count=v_info,
        metadata=metadata||jsonb_build_object('completed_at',now())
    where id=v_run_id;

    return jsonb_build_object('ok',true,'run_id',v_run_id,'company_id',p_company_id,'scope',v_scope,
      'finding_count',v_total,'critical_count',v_critical,'high_count',v_high,'medium_count',v_medium,'low_count',v_low,'info_count',v_info);
  exception when others then
    update public.tenant_integrity_audit_runs
    set status='failed',finished_at=now(),error_message=left(sqlerrm,2000)
    where id=v_run_id;
    return jsonb_build_object('ok',false,'run_id',v_run_id,'company_id',p_company_id,'scope',v_scope,'error',sqlerrm);
  end;
end
$function$;
