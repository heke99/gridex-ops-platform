-- Forward corrections from independent source/consumer review.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_service_permission.context_v1(c uuid, aid uuid, actor uuid, expected_version bigint, code text, pid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE a public.ediel_service_assignments%rowtype; p public.metering_permissions%rowtype; e public.ediel_service_evidence%rowtype;
 assessment jsonb; objects jsonb; legal_id text; dso_id text; customer_record jsonb; previous_origin gridex_service_permission.origins%rowtype;
BEGIN
 IF c IS NULL OR aid IS NULL OR actor IS NULL OR pid IS NULL OR expected_version IS NULL OR expected_version<1 OR (code IN ('Z13','Z18')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_permission_origin_scope_required'; END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
 OR NOT coalesce(public.gridex_actor_has_company_permission(actor,c,'metering.write'),false) THEN RAISE EXCEPTION 'ediel_permission_origin_actor_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=c AND id=aid;
 -- Same tuple order as the coordinator. The permission cannot be terminated
 -- concurrently with another assignment acquiring/reusing that permission.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(a.company_id::text||':'||a.environment||':'||a.provider_actor_id::text||':'||a.customer_id::text||':'||a.dso_actor_id::text||':'||a.mode,0));
 SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=c AND id=aid FOR SHARE;
 IF a.version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION 'ediel_permission_origin_assignment_stale'; END IF;
 -- Legal ESCO and its own electricity profile must remain current for BOTH
 -- request and termination; an ended internal assignment does not revoke a
 -- legal actor's authorization checks.
 PERFORM x.id FROM public.tenant_ediel_profiles x WHERE x.company_id=c AND x.id=a.actor_profile_id FOR SHARE;
 PERFORM r.id FROM public.tenant_actor_roles r WHERE r.company_id=c AND r.actor_id=a.provider_actor_id AND r.environment=a.environment ORDER BY r.id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.tenant_ediel_profiles x WHERE x.company_id=c AND x.id=a.actor_profile_id AND x.environment=a.environment AND x.market='electricity' AND x.is_enabled AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()))
 OR NOT EXISTS(SELECT FROM public.tenant_actor_roles r WHERE r.company_id=c AND r.actor_id=a.provider_actor_id AND r.environment=a.environment AND r.role_code='energy_service_company' AND r.valid_from<=now() AND (r.valid_to IS NULL OR r.valid_to>now())) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_provider_electricity_profile_and_esco_role']); END IF;
 PERFORM r.id FROM public.tenant_counterparty_relations r WHERE r.company_id=c AND r.environment=a.environment AND r.relation_type='ediel_transport_agent' ORDER BY r.id FOR SHARE;
 PERFORM ev.id FROM public.ediel_service_evidence ev WHERE ev.company_id=c AND ev.assignment_id=aid ORDER BY ev.id FOR SHARE;
 IF (SELECT count(*) FROM public.tenant_counterparty_relations r WHERE r.company_id=c AND r.environment=a.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=now() AND (r.valid_to IS NULL OR r.valid_to>now()))>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['provider_transport_relation_ambiguous']); END IF;
 IF EXISTS(SELECT FROM public.tenant_counterparty_relations r WHERE r.company_id=c AND r.environment=a.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.counterparty_actor_id<>a.provider_actor_id AND r.valid_from<=now() AND (r.valid_to IS NULL OR r.valid_to>now())) AND NOT EXISTS(SELECT FROM public.ediel_service_evidence ev JOIN public.tenant_counterparty_relations r ON r.company_id=c AND r.id=ev.transport_relation_id AND r.counterparty_actor_id=ev.transport_actor_id AND r.environment=a.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=now() AND (r.valid_to IS NULL OR r.valid_to>now()) WHERE ev.company_id=c AND ev.assignment_id=aid AND ev.kind='transport_mandate' AND ev.status='verified' AND ev.approved_assignment_version=a.version AND ev.approved_at<=now() AND ev.valid_from<=now() AND (ev.valid_to IS NULL OR ev.valid_to>now())) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_transport_mandate']); END IF;

 SELECT * INTO STRICT p FROM public.metering_permissions WHERE company_id=c AND id=pid FOR UPDATE;
 IF p.customer_id IS DISTINCT FROM a.customer_id OR NOT EXISTS(SELECT FROM public.ediel_assignment_permission_links l WHERE l.company_id=c AND l.assignment_id=aid AND l.permission_id=pid) THEN RAISE EXCEPTION 'ediel_permission_origin_link_mismatch'; END IF;
 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=a.environment FOR SHARE;
 SELECT min(i.identifier_value) INTO legal_id FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=a.environment AND i.actor_id=a.provider_actor_id AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR i.valid_to>now());
 PERFORM i.id FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id FOR SHARE;
 SELECT min(i.identifier_value) INTO dso_id FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN ('edielid','ediel_id') AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date);
 IF (SELECT count(DISTINCT (i.actor_id,i.identifier_value)) FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=a.environment AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR i.valid_to>now()))<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['provider_legal_identity_ambiguous']); END IF;
 IF nullif(legal_id,'') IS NULL OR nullif(dso_id,'') IS NULL OR (SELECT count(DISTINCT i.identifier_value) FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=a.environment AND i.actor_id=a.provider_actor_id AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR i.valid_to>now()))<>1 OR (SELECT count(DISTINCT i.identifier_value) FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN ('edielid','ediel_id') AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date))<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_unique_legal_sender_and_dso_identity']); END IF;
 SELECT to_jsonb(x) INTO customer_record FROM public.customers x WHERE x.id=a.customer_id AND x.company_id=c FOR SHARE;
 PERFORM x.id FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid FOR SHARE;
 IF code='Z13' THEN
  assessment:=public.ediel_service_assignment_assessment_v1(c,aid);
  IF assessment->>'status' IS DISTINCT FROM 'authorized' THEN RETURN assessment; END IF;
  IF (p.status IN ('draft','z13_ready','z13_sent','waiting_for_customer_approval')) IS NOT TRUE OR (p.status IN ('z13_sent','waiting_for_customer_approval') AND p.outbound_z13_message_id IS NULL) OR (p.source_z13_message_id IS NOT NULL AND p.source_z13_message_id IS DISTINCT FROM p.outbound_z13_message_id) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['request_permission_state']); END IF;
  SELECT * INTO e FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid AND x.kind='end_user_contract' AND x.status='verified' AND x.approved_assignment_version=a.version AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) AND x.approved_at<=now() AND x.permission_purpose_code IS NOT NULL AND nullif(x.permission_reporting_frequency,'') IS NOT NULL ORDER BY x.id LIMIT 1;
  IF NOT FOUND OR (SELECT count(DISTINCT (x.permission_purpose_code,x.permission_reporting_frequency)) FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid AND x.kind='end_user_contract' AND x.status='verified' AND x.approved_assignment_version=a.version AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) AND x.approved_at<=now())<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_assessed_permission_purpose_and_frequency']); END IF;
  IF cardinality(a.product_ids)<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['single_source_defined_request_product']); END IF;
  IF nullif(e.permission_request_grid_area,'') IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_defined_request_grid_area']); END IF;
  IF e.permission_reporting_term_kind IS NULL OR e.permission_customer_classification IS NULL OR (e.permission_reporting_term_kind='bounded' AND a.data_end IS NULL) OR (e.permission_reporting_term_kind='indefinite' AND (a.data_end IS NOT NULL OR a.mode='VH')) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_declared_reporting_term_and_customer_classification']); END IF;
  IF date_trunc('minute',a.data_start) IS DISTINCT FROM a.data_start OR date_trunc('minute',a.data_end) IS DISTINCT FROM a.data_end THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_minute_precision_reporting_dates']); END IF;
  objects:=jsonb_build_array(jsonb_build_object('point',NULL,'permissionId',NULL,'product',a.product_ids[1],'gridArea',e.permission_request_grid_area,'reportStart',a.data_start,'reportEnd',a.data_end));
 ELSE
  IF a.status IS DISTINCT FROM 'ended' OR a.mode IS DISTINCT FROM 'V' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['ended_fortlopande_assignment']); END IF;
  IF EXISTS(SELECT FROM public.ediel_assignment_permission_links l JOIN public.ediel_service_assignments other ON other.company_id=l.company_id AND other.id=l.assignment_id WHERE l.company_id=c AND l.permission_id=pid AND other.status='active' AND other.valid_from<=now() AND (other.valid_to IS NULL OR other.valid_to>now())) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['permission_still_required_by_active_assignment']); END IF;
  PERFORM s.id FROM public.metering_permission_sites s WHERE s.company_id=c AND s.metering_permission_id=pid ORDER BY s.id FOR SHARE;
  IF (p.status IN ('active','approved','partially_approved')) IS NOT TRUE OR public.ediel_permission_source_is_current_v1(c,pid,coalesce(p.inbound_z14_message_id,p.source_z14_message_id)) IS NOT TRUE OR p.grid_owner_ediel_id IS DISTINCT FROM dso_id OR p.metadata#>>'{marketPermission,legalActor}' IS DISTINCT FROM legal_id THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_source_approved_permission']); END IF;
  SELECT * INTO e FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid AND x.kind='service_contract' AND x.status='verified' AND x.approved_assignment_version=a.version AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) AND x.approved_at<=now() AND x.permission_termination_reason IS NOT NULL AND x.permission_termination_at IS NOT NULL ORDER BY x.id LIMIT 1;
  IF NOT FOUND OR (SELECT count(DISTINCT (x.permission_termination_reason,x.permission_termination_at)) FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid AND x.kind='service_contract' AND x.status='verified' AND x.approved_assignment_version=a.version AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) AND x.approved_at<=now())<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_assessed_permission_termination']); END IF;
  IF p.outbound_z18_message_id IS NOT NULL THEN
   SELECT * INTO previous_origin FROM gridex_service_permission.origins prior WHERE prior.company_id=c AND prior.permission_id=pid AND prior.message_id=p.outbound_z18_message_id AND prior.message_code='Z18';
   IF NOT FOUND OR (NOT(previous_origin.basis->>'evidenceId'=e.id::text AND (previous_origin.basis->>'permissionStateVersion')::bigint=p.market_state_version) AND (p.metadata#>>'{z15,reason}' IS DISTINCT FROM 'Z24' OR p.market_state_version<=(previous_origin.basis->>'permissionStateVersion')::bigint)) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['prior_termination_cycle_not_source_cancelled']); END IF;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('point',s.facility_id,'permissionId',s.metadata->>'permissionId','product',s.metadata->>'product','gridArea',s.grid_area_code,'permissionEnd',e.permission_termination_at) ORDER BY s.facility_id,s.id) INTO objects FROM public.metering_permission_sites s WHERE s.company_id=c AND s.metering_permission_id=pid AND s.status IN ('approved','active');
  IF objects IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['approved_permission_objects']); END IF;
  IF date_trunc('minute',e.permission_termination_at) IS DISTINCT FROM e.permission_termination_at THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_minute_precision_termination_date']); END IF;
 END IF;
 RETURN jsonb_build_object('status','authorized','companyId',c,'assignmentId',aid,'assignmentVersion',a.version,'permissionId',pid,'permissionStateVersion',p.market_state_version,'code',code,'environment',a.environment,'providerActorId',a.provider_actor_id,'dsoActorId',a.dso_actor_id,'legalSenderId',legal_id,'legalReceiverId',dso_id,'customerId',a.customer_id,'customer',customer_record,'mode',a.mode,'purposeCode',e.permission_purpose_code,'frequency',e.permission_reporting_frequency,'reportingTerm',e.permission_reporting_term_kind,'customerClassification',e.permission_customer_classification,'terminationReason',e.permission_termination_reason,'evidenceId',e.id,'evidenceSha256',e.source_sha256,'evidenceVersion',e.source_version,'objects',objects,'li',CASE WHEN code='Z18' THEN p.rff_li_reference ELSE NULL END);
END $$;

CREATE OR REPLACE FUNCTION public.ediel_apply_actor_registry_v1(p_actor_user_id uuid,p_source_base64 text,p_source_sha256 text,p_source_kind text,p_source_filename text,p_records jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE prior gridex_registry_import.batches%rowtype; item jsonb; route jsonb; cert jsonb; ident jsonb;
 actor_row public.platform_market_actors%rowtype; route_row public.platform_actor_routes%rowtype;
 ids uuid[]; aid uuid; run_id uuid; ui_id uuid; item_id uuid; rid uuid; owner_id uuid; v_identifier_type text; v_identifier_value text;
 plan jsonb:='[]'; results jsonb:='[]'; route_ids jsonb:='[]'; issues jsonb:='[]'; normalized_hash text; v_source_hash text;
 v_created_count integer:=0;v_updated_count integer:=0;v_unchanged_count integer:=0;v_conflict_count integer:=0; before_row jsonb; after_row jsonb;
 is_new boolean; changed boolean; role text; market text; certificate_hash text; encoded_der text; v_source_bytes bytea;
BEGIN
 IF p_actor_user_id IS NULL OR public.canonical_actor_is_platform_admin(p_actor_user_id) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_registry_platform_actor_required' USING ERRCODE='42501';END IF;
 v_source_bytes:=decode(p_source_base64,'base64');
 IF p_source_base64 IS NULL OR octet_length(v_source_bytes)>16777216 OR octet_length(v_source_bytes)=0 OR (p_source_kind IN ('companies_xml','csv')) IS NOT TRUE OR jsonb_typeof(p_records) IS DISTINCT FROM 'array' OR jsonb_array_length(p_records)<1 OR jsonb_array_length(p_records)>4096 THEN RAISE EXCEPTION 'ediel_registry_source_shape_required';END IF;
 v_source_hash:=encode(sha256(v_source_bytes),'hex'); normalized_hash:=encode(sha256(convert_to(p_records::text,'UTF8')),'hex');
 IF p_source_sha256 IS DISTINCT FROM v_source_hash THEN RAISE EXCEPTION 'ediel_registry_exact_source_hash_required';END IF;
 -- Serialize import diff and apply against the same actual actor graph. This
 -- finite administrative batch may never interleave identifier ownership.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ediel_registry_atomic_apply_v1',0));
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM u.id FROM auth.users u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM au.user_id FROM public.admin_users au WHERE au.user_id=p_actor_user_id FOR SHARE;
 PERFORM ur.id FROM public.user_roles ur WHERE ur.user_id=p_actor_user_id FOR SHARE;
 IF public.canonical_actor_is_platform_admin(p_actor_user_id) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_registry_platform_actor_revoked' USING ERRCODE='42501';END IF;
 SELECT * INTO prior FROM gridex_registry_import.batches WHERE source_sha256=v_source_hash FOR SHARE;
 IF FOUND THEN
  IF prior.normalized_sha256 IS DISTINCT FROM normalized_hash OR prior.source_kind IS DISTINCT FROM p_source_kind OR prior.source_bytes IS DISTINCT FROM v_source_bytes THEN RAISE EXCEPTION 'ediel_registry_source_normalization_conflict';END IF;
  RETURN prior.result||jsonb_build_object('reusedExistingRun',true);
 END IF;
 -- A historical per-row running/partial run is not proof of an atomic apply.
 IF EXISTS(SELECT FROM public.actor_registry_import_runs r WHERE r.source_hash=v_source_hash) THEN RAISE EXCEPTION 'ediel_registry_legacy_run_requires_reconciliation';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_records) v WHERE nullif(v->>'edielId','') IS NOT NULL)<>(SELECT count(DISTINCT v->>'edielId') FROM jsonb_array_elements(p_records) v WHERE nullif(v->>'edielId','') IS NOT NULL) THEN RAISE EXCEPTION 'ediel_registry_duplicate_source_legal_identity';END IF;
 PERFORM a.id FROM public.platform_market_actors a ORDER BY a.id FOR UPDATE;
 PERFORM i.id FROM public.platform_actor_identifiers i ORDER BY i.id FOR UPDATE;
 PERFORM r.id FROM public.platform_actor_roles r ORDER BY r.id FOR UPDATE;
 PERFORM r.id FROM public.platform_actor_routes r ORDER BY r.id FOR UPDATE;
 PERFORM c.id FROM public.platform_actor_certificates c ORDER BY c.id FOR UPDATE;
 -- Complete preflight before the first actor mutation. An ambiguous strong
 -- identity or incompatible legal OrgNo rejects the entire source transaction.
 FOR item IN SELECT value FROM jsonb_array_elements(p_records) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR nullif(item->>'name','') IS NULL OR jsonb_typeof(item->'roles') IS DISTINCT FROM 'array' OR jsonb_typeof(item->'routes') IS DISTINCT FROM 'array' OR jsonb_typeof(item->'certificates') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'ediel_registry_normalized_record_required';END IF;
  aid:=NULL;actor_row:=NULL;
  IF nullif(item->>'edielId','') IS NULL OR (item->>'market' IN ('EL','GAS')) IS NOT TRUE OR nullif(item->>'countryCode','') IS NULL THEN
   plan:=plan||jsonb_build_array(item||jsonb_build_object('_held','source_legal_identity_market_country_required'));CONTINUE;
  END IF;
  SELECT array_agg(DISTINCT i.actor_id) INTO ids FROM public.platform_actor_identifiers i WHERE lower(i.identifier_type) IN ('edielid','ediel_id') AND i.identifier_value=item->>'edielId';
  IF coalesce(cardinality(ids),0)>1 THEN RAISE EXCEPTION 'ediel_registry_legal_identity_ambiguous';END IF;
  IF cardinality(ids)=1 THEN
   aid:=ids[1];SELECT * INTO STRICT actor_row FROM public.platform_market_actors a WHERE a.id=aid;
   IF nullif(actor_row.org_number,'') IS NOT NULL AND nullif(item->>'orgNumber','') IS NOT NULL AND actor_row.org_number IS DISTINCT FROM item->>'orgNumber' THEN RAISE EXCEPTION 'ediel_registry_legal_org_conflict';END IF;
  END IF;
  FOR ident IN SELECT value FROM jsonb_array_elements(jsonb_build_array(jsonb_build_object('type','EIC','value',item->>'eic'),jsonb_build_object('type','SvKId','value',item->>'svkId'))) LOOP
   IF nullif(ident->>'value','') IS NULL THEN CONTINUE;END IF;
   SELECT array_agg(DISTINCT i.actor_id) INTO ids FROM public.platform_actor_identifiers i WHERE lower(i.identifier_type)=lower(ident->>'type') AND i.identifier_value=ident->>'value';
   IF coalesce(cardinality(ids),0)>0 AND (cardinality(ids)<>1 OR aid IS NULL OR ids[1] IS DISTINCT FROM aid) THEN RAISE EXCEPTION 'ediel_registry_secondary_identifier_owner_conflict';END IF;
  END LOOP;
  FOR route IN SELECT value FROM jsonb_array_elements(item->'routes') LOOP
   IF nullif(route->>'messageFamily','') IS NULL OR (route->>'environment' IN ('test','production')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_registry_route_source_shape_required';END IF;
  END LOOP;
  FOR cert IN SELECT value FROM jsonb_array_elements(item->'certificates') LOOP
   encoded_der:=nullif(cert->>'derBase64','');certificate_hash:=nullif(cert->>'fingerprintSha256','');
   IF encoded_der IS NOT NULL AND upper(encode(sha256(decode(encoded_der,'base64')),'hex')) IS DISTINCT FROM certificate_hash THEN RAISE EXCEPTION 'ediel_registry_certificate_exact_der_hash_required';END IF;
  END LOOP;
  plan:=plan||jsonb_build_array(item||jsonb_build_object('_actorId',aid));
 END LOOP;
 INSERT INTO public.actor_registry_import_runs(source,source_filename,source_hash,status,uploaded_by,total_records,metadata) VALUES(p_source_kind,p_source_filename,v_source_hash,'running',p_actor_user_id,jsonb_array_length(p_records),jsonb_build_object('atomicApplyVersion',1,'normalizedSha256',normalized_hash)) RETURNING id INTO run_id;
 INSERT INTO public.platform_actor_import_runs(source,import_type,status,records_seen,created_by,metadata) VALUES(coalesce(p_source_filename,p_source_kind),p_source_kind,'running',jsonb_array_length(p_records),p_actor_user_id,jsonb_build_object('atomicApplyVersion',1,'sourceSha256',v_source_hash,'actorRegistryImportRunId',run_id)) RETURNING id INTO ui_id;
 FOR item IN SELECT value FROM jsonb_array_elements(plan) LOOP
  market:=item->>'market'; aid:=(item->>'_actorId')::uuid;
  INSERT INTO public.actor_registry_import_items(import_run_id,raw_payload,normalized_payload,normalized_name,normalized_org_no,normalized_ediel_id,normalized_eic,roles,routes,certificates) VALUES(run_id,coalesce(item->'raw','{}'),item-'_actorId'-'_held',lower(regexp_replace(item->>'name','\s+',' ','g')),nullif(item->>'orgNumber',''),nullif(item->>'edielId',''),nullif(item->>'eic',''),ARRAY(SELECT jsonb_array_elements_text(item->'roles')),item->'routes',item->'certificates') RETURNING id INTO item_id;
  IF item ? '_held' THEN
   v_conflict_count:=v_conflict_count+1;issues:=issues||jsonb_build_array(jsonb_build_object('name',item->>'name','code',item->>'_held'));
   UPDATE public.actor_registry_import_items SET match_status='skipped',review_required=true,review_reason=item->>'_held' WHERE id=item_id;
   INSERT INTO public.platform_actor_import_issues(import_run_id,issue_type,severity,message,metadata) VALUES(ui_id,item->>'_held','blocking','Source legal Ediel identity is required; this record was staged without actor activation.',jsonb_build_object('importItemId',item_id));CONTINUE;
  END IF;
  is_new:=aid IS NULL;before_row:=NULL;
  IF is_new THEN
   INSERT INTO public.platform_market_actors(name,legal_name,org_number,country_code,source,source_reference,match_status,status,visible_to_tenants,imported_at,not_seen_in_latest_import,last_seen_in_import_at,registry_import_status,metadata) VALUES(item->>'name',coalesce(item->>'legalName',item->>'name'),nullif(item->>'orgNumber',''),item->>'countryCode','xml_import',run_id::text,'strong_suggestion','active',false,now(),false,now(),'created',jsonb_build_object('market',market,'roles',item->'roles','sourceRecord',item->'raw','importRunId',run_id)) RETURNING id INTO aid;
   v_created_count:=v_created_count+1;
  ELSE
   SELECT to_jsonb(a) INTO before_row FROM public.platform_market_actors a WHERE a.id=aid;
   UPDATE public.platform_market_actors SET name=item->>'name',legal_name=coalesce(item->>'legalName',item->>'name'),org_number=coalesce(org_number,nullif(item->>'orgNumber','')),source_reference=run_id::text,not_seen_in_latest_import=false,last_seen_in_import_at=now(),registry_import_status='updated',metadata=metadata||jsonb_build_object('market',market,'roles',item->'roles','sourceRecord',item->'raw','importRunId',run_id),visible_to_tenants=CASE WHEN market='EL' THEN visible_to_tenants ELSE false END,updated_at=now() WHERE id=aid;
   SELECT to_jsonb(a) INTO after_row FROM public.platform_market_actors a WHERE a.id=aid;
   changed:=(before_row-'metadata'-'updated_at'-'source_reference'-'last_seen_in_import_at'-'registry_import_status'-'not_seen_in_latest_import') IS DISTINCT FROM (after_row-'metadata'-'updated_at'-'source_reference'-'last_seen_in_import_at'-'registry_import_status'-'not_seen_in_latest_import');
   IF changed THEN v_updated_count:=v_updated_count+1;ELSE v_unchanged_count:=v_unchanged_count+1;END IF;
  END IF;
  FOR ident IN SELECT value FROM jsonb_array_elements(jsonb_build_array(jsonb_build_object('type','EdielId','value',item->>'edielId'),jsonb_build_object('type','OrgNo','value',item->>'orgNumber'),jsonb_build_object('type','EIC','value',item->>'eic'),jsonb_build_object('type','SvKId','value',item->>'svkId'))) LOOP
   v_identifier_type:=ident->>'type';v_identifier_value:=nullif(ident->>'value','');IF v_identifier_value IS NULL THEN CONTINUE;END IF;
   owner_id:=NULL;SELECT i.actor_id INTO owner_id FROM public.platform_actor_identifiers i WHERE i.identifier_type=v_identifier_type AND i.identifier_value=v_identifier_value;
   IF owner_id IS NOT NULL AND owner_id<>aid THEN IF v_identifier_type='OrgNo' THEN CONTINUE;ELSE RAISE EXCEPTION 'ediel_registry_identifier_owner_conflict';END IF;END IF;
   INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,source,is_verified,metadata) VALUES(aid,v_identifier_type,v_identifier_value,'xml_import',p_source_kind='companies_xml',jsonb_build_object('importRunId',run_id,'sourceSha256',v_source_hash)) ON CONFLICT(identifier_type,identifier_value) DO UPDATE SET source=excluded.source,is_verified=CASE WHEN excluded.is_verified THEN true ELSE public.platform_actor_identifiers.is_verified END,metadata=public.platform_actor_identifiers.metadata||excluded.metadata,updated_at=now() WHERE public.platform_actor_identifiers.actor_id=excluded.actor_id;
  END LOOP;
  -- Missing records/roles/routes are never treated as an authenticated deletion.
  FOR role IN SELECT jsonb_array_elements_text(item->'roles') LOOP
   INSERT INTO public.platform_actor_roles(actor_id,actor_role,role_source,is_active,metadata) VALUES(aid,role,'xml_import',market='EL',jsonb_build_object('importRunId',run_id,'market',market)) ON CONFLICT(actor_id,actor_role) DO UPDATE SET role_source=excluded.role_source,is_active=excluded.is_active,metadata=public.platform_actor_roles.metadata||excluded.metadata,updated_at=now();
  END LOOP;
  INSERT INTO public.platform_actor_aliases(actor_id,alias,alias_source,is_verified,metadata) VALUES(aid,item->>'name','xml_import',p_source_kind='companies_xml',jsonb_build_object('importRunId',run_id)) ON CONFLICT(actor_id,normalized_alias) DO NOTHING;
  FOR route IN SELECT value FROM jsonb_array_elements(item->'routes') LOOP
   -- Contradictory target for the same declared wire application is a source
   -- change, never evidence that the previously selected target remains safe.
   -- Retain both rows and all history; revoke only their readiness flags.
   UPDATE public.platform_actor_routes r SET auto_send_allowed=false,is_verified=false,status='needs_review',metadata=r.metadata||jsonb_build_object('sourceTargetConflict',true,'conflictingSourceSha256',v_source_hash,'importRunId',run_id),updated_at=now()
    WHERE r.actor_id=aid AND upper(r.message_family)=upper(route->>'messageFamily') AND r.environment=route->>'environment' AND r.subaddress IS NOT DISTINCT FROM nullif(route->>'subaddress','') AND r.application_reference IS NOT DISTINCT FROM nullif(route->>'applicationReference','') AND r.communication_address IS DISTINCT FROM nullif(route->>'communicationAddress','') AND (r.auto_send_allowed OR r.is_verified OR r.status IS DISTINCT FROM 'needs_review');
   IF (SELECT count(*) FROM public.platform_actor_routes r WHERE r.actor_id=aid AND upper(r.message_family)=upper(route->>'messageFamily') AND r.environment=route->>'environment' AND r.subaddress IS NOT DISTINCT FROM nullif(route->>'subaddress','') AND r.application_reference IS NOT DISTINCT FROM nullif(route->>'applicationReference','') AND r.communication_address IS NOT DISTINCT FROM nullif(route->>'communicationAddress',''))>1 THEN RAISE EXCEPTION 'ediel_registry_route_source_ambiguous';END IF;
   SELECT * INTO route_row FROM public.platform_actor_routes r WHERE r.actor_id=aid AND upper(r.message_family)=upper(route->>'messageFamily') AND r.environment=route->>'environment' AND r.subaddress IS NOT DISTINCT FROM nullif(route->>'subaddress','') AND r.communication_address IS NOT DISTINCT FROM nullif(route->>'communicationAddress','') AND r.application_reference IS NOT DISTINCT FROM nullif(route->>'applicationReference','');
   rid:=route_row.id;
   IF rid IS NULL THEN
    INSERT INTO public.platform_actor_routes(actor_id,message_family,application_reference,environment,subaddress,communication_type,communication_address,party_id,interchange_party_id,party_id_qualifier,party_id_responsible,interchange_id_qualifier,edi_charset,edi_syntax,is_verified,status,source,auto_send_allowed,metadata) VALUES(aid,upper(route->>'messageFamily'),nullif(route->>'applicationReference',''),route->>'environment',nullif(route->>'subaddress',''),nullif(route->>'communicationType',''),nullif(route->>'communicationAddress',''),nullif(route->>'partyId',''),nullif(route->>'interchangePartyId',''),nullif(route->>'partyIdQualifier',''),nullif(route->>'partyIdResponsible',''),nullif(route->>'interchangeIdQualifier',''),nullif(route->>'ediCharset',''),nullif(route->>'ediSyntax',''),false,'needs_review','xml_import',false,coalesce(route->'metadata','{}')||jsonb_build_object('importRunId',run_id,'sourceSha256',v_source_hash,'market',market,'blank_subaddress_requires_review',nullif(route->>'subaddress','') IS NULL)) RETURNING id INTO rid;
   ELSIF (route_row.application_reference,route_row.communication_type,route_row.party_id,route_row.interchange_party_id,route_row.party_id_qualifier,route_row.party_id_responsible,route_row.interchange_id_qualifier,route_row.edi_charset,route_row.edi_syntax) IS DISTINCT FROM (nullif(route->>'applicationReference',''),nullif(route->>'communicationType',''),nullif(route->>'partyId',''),nullif(route->>'interchangePartyId',''),nullif(route->>'partyIdQualifier',''),nullif(route->>'partyIdResponsible',''),nullif(route->>'interchangeIdQualifier',''),nullif(route->>'ediCharset',''),nullif(route->>'ediSyntax','')) THEN
    UPDATE public.platform_actor_routes SET application_reference=nullif(route->>'applicationReference',''),communication_type=nullif(route->>'communicationType',''),party_id=nullif(route->>'partyId',''),interchange_party_id=nullif(route->>'interchangePartyId',''),party_id_qualifier=nullif(route->>'partyIdQualifier',''),party_id_responsible=nullif(route->>'partyIdResponsible',''),interchange_id_qualifier=nullif(route->>'interchangeIdQualifier',''),edi_charset=nullif(route->>'ediCharset',''),edi_syntax=nullif(route->>'ediSyntax',''),auto_send_allowed=false,is_verified=false,status='needs_review',metadata=metadata||coalesce(route->'metadata','{}')||jsonb_build_object('importRunId',run_id,'sourceSha256',v_source_hash,'market',market),updated_at=now() WHERE id=rid;
   END IF;
   route_ids:=route_ids||to_jsonb(rid);
  END LOOP;
  FOR cert IN SELECT value FROM jsonb_array_elements(item->'certificates') LOOP
   certificate_hash:=nullif(cert->>'fingerprintSha256','');IF certificate_hash IS NULL THEN CONTINUE;END IF;
   INSERT INTO public.platform_actor_certificates(actor_id,ediel_id,environment,purpose,certificate_type,subject,issuer,serial_number,fingerprint_sha256,valid_from,valid_to,status,source,raw_certificate_pem,metadata,last_checked_at,next_check_at) VALUES(aid,item->>'edielId',cert->>'environment',cert->>'purpose','smime',cert->>'subject',cert->>'issuer',cert->>'serialNumber',certificate_hash,(cert->>'validFrom')::timestamptz,(cert->>'validTo')::timestamptz,'unknown','xml_import',cert->>'pem',coalesce(cert->'metadata','{}')||jsonb_build_object('importRunId',run_id,'sourceSha256',v_source_hash,'issuerTrust','unverified'),now(),now()) ON CONFLICT(actor_id,environment,purpose,fingerprint_sha256) WHERE fingerprint_sha256 IS NOT NULL DO NOTHING;
  END LOOP;
  UPDATE public.actor_registry_import_items SET matched_actor_id=aid,match_status=CASE WHEN is_new THEN 'created' WHEN changed THEN 'updated' ELSE 'unchanged' END,match_reason='source_legal_ediel_identity',applied_at=now() WHERE id=item_id;
  results:=results||jsonb_build_array(jsonb_build_object('actorId',aid,'importItemId',item_id));
 END LOOP;
 UPDATE public.actor_registry_import_runs SET status=CASE WHEN v_conflict_count>0 THEN 'completed_with_warnings' ELSE 'completed' END,finished_at=now(),created_count=v_created_count,updated_count=v_updated_count,unchanged_count=v_unchanged_count,conflict_count=v_conflict_count,updated_at=now() WHERE id=run_id;
 UPDATE public.platform_actor_import_runs SET status=CASE WHEN v_conflict_count>0 THEN 'completed_with_warnings' ELSE 'completed' END,records_upserted=v_created_count+v_updated_count+v_unchanged_count,records_failed=v_conflict_count,safe=v_conflict_count=0,completed_at=now(),error_log=issues WHERE id=ui_id;
 after_row:=jsonb_build_object('importRunId',run_id,'uiRunId',ui_id,'reusedExistingRun',false,'totalRecords',jsonb_array_length(p_records),'created',v_created_count,'updated',v_updated_count,'unchanged',v_unchanged_count,'conflicts',v_conflict_count,'errors',0,'actors',results,'routeIds',route_ids,'activation','held_pending_current_source_readiness');
 INSERT INTO gridex_registry_import.batches VALUES(v_source_hash,normalized_hash,v_source_bytes,p_source_kind,p_actor_user_id,run_id,ui_id,after_row,now());
 RETURN after_row;
END $$;


-- Atomic projection reconciliation never enters a provider and never downgrades
-- an ACK/cancellation/final failure that committed before this row lock.
CREATE FUNCTION public.gridex_ediel_repair_accepted_transport_projection_v1(p_company_id uuid,p_environment text,p_actor_user_id uuid,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype; projection jsonb; resulting_status text;
BEGIN
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR p_message_id IS NULL OR (p_environment IN ('test','production')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_accepted_projection_scope_required';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_accepted_projection_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=p_company_id AND environment=p_environment AND id=p_message_id AND direction='outbound' FOR UPDATE;
 projection:=public.gridex_ediel_accepted_transport_projection_v1(p_company_id,p_environment,p_actor_user_id,p_message_id);
 IF projection IS NULL THEN RETURN NULL;END IF;
 UPDATE public.ediel_messages SET
  status=CASE WHEN status IN ('draft','prepared','queued','dispatching','provider_accepted','sent') THEN 'sent' ELSE status END,
  processing_status=CASE WHEN processing_status IS NULL OR processing_status IN ('draft','prepared','queued','dispatching','provider_accepted','sent') THEN 'sent' ELSE processing_status END,
  message_sent_at=(projection->>'observedAt')::timestamptz,updated_by=p_actor_user_id,updated_at=now()
 WHERE id=p_message_id AND company_id=p_company_id AND environment=p_environment RETURNING status INTO resulting_status;
 RETURN projection||jsonb_build_object('projectionStatus',resulting_status);
END $$;
REVOKE ALL ON FUNCTION public.gridex_ediel_repair_accepted_transport_projection_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_ediel_repair_accepted_transport_projection_v1(uuid,text,uuid,uuid) TO service_role;

COMMIT;
