-- Created with Supabase CLI2.118.0. Actual DSO network-contract period is
-- signed and reviewed independently of legal evidence validity. No legacy fill.
BEGIN;
ALTER TABLE public.ediel_service_evidence ADD COLUMN permission_network_contract_start date,
 ADD COLUMN permission_network_contract_end date,
 ADD CONSTRAINT ediel_service_evidence_network_period CHECK(permission_network_contract_end IS NULL OR permission_network_contract_start IS NOT NULL AND permission_network_contract_end>=permission_network_contract_start),
 ADD CONSTRAINT ediel_service_evidence_network_period_kind CHECK(kind='dso_contract' OR permission_network_contract_start IS NULL AND permission_network_contract_end IS NULL);
CREATE OR REPLACE FUNCTION gridex_ediel_services.evidence_terms_v1(e public.ediel_service_evidence) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT jsonb_build_object('valid_from',e.valid_from,'valid_to',e.valid_to,'permission_agreement_reference',e.permission_agreement_reference,'permission_requested_method',e.permission_requested_method,'permission_purpose_code',e.permission_purpose_code,'permission_reporting_frequency',e.permission_reporting_frequency,'permission_request_grid_area',e.permission_request_grid_area,'permission_reporting_term_kind',e.permission_reporting_term_kind,'permission_customer_classification',e.permission_customer_classification,'permission_termination_reason',e.permission_termination_reason,'permission_termination_at',e.permission_termination_at)||CASE WHEN e.permission_network_contract_start IS NULL AND e.permission_network_contract_end IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('permission_network_contract_start',e.permission_network_contract_start,'permission_network_contract_end',e.permission_network_contract_end) END
$$;
CREATE OR REPLACE FUNCTION gridex_ediel_services.evidence_basis_v1(e public.ediel_service_evidence) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT (to_jsonb(e)-ARRAY['status','approved_by','approved_at','approved_assignment_version'])-CASE WHEN e.permission_network_contract_start IS NULL AND e.permission_network_contract_end IS NULL THEN ARRAY['permission_network_contract_start','permission_network_contract_end'] ELSE ARRAY[]::text[] END
$$;
CREATE FUNCTION gridex_ediel_services.evidence_receipt_row_v1(e public.ediel_service_evidence) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT to_jsonb(e)-CASE WHEN e.permission_network_contract_start IS NULL AND e.permission_network_contract_end IS NULL THEN ARRAY['permission_network_contract_start','permission_network_contract_end'] ELSE ARRAY[]::text[] END
$$;
REVOKE ALL ON FUNCTION gridex_ediel_services.evidence_receipt_row_v1(public.ediel_service_evidence) FROM PUBLIC,anon,authenticated,service_role;
-- NULL added columns preserve established eleven-term receipt shapes. NonNULL
-- network facts stay sealed, and are required independently for fresh requests.
DO $$DECLARE signature text;oid regprocedure;definition text;BEGIN
 FOREACH signature IN ARRAY ARRAY['gridex_ediel_ack_replay.current_service_grant_set_v2(uuid,text,jsonb,text,text,text,timestamptz,timestamptz,jsonb,uuid[])','gridex_ediel_ack_replay.positive_service_scope_projection_v1(uuid,text,uuid,text)'] LOOP
  oid:=to_regprocedure(signature);IF oid IS NOT NULL THEN
   definition:=pg_get_functiondef(oid);IF position('to_jsonb(e)' IN definition)>0 THEN EXECUTE replace(definition,'to_jsonb(e)','gridex_ediel_services.evidence_receipt_row_v1(e)');END IF;
  END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.ediel_archive_service_evidence_v1(p_company_id uuid,p_actor_user_id uuid,p_submission jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a public.ediel_service_assignments%rowtype;bytes bytea;archive gridex_ediel_services.artifacts%rowtype;terms_record public.ediel_service_evidence%rowtype;terms jsonb;v_scope jsonb;sh text;v_source_hash text;kind text;missing jsonb:='["separate_qualified_reviewer_required"]';
BEGIN
 PERFORM gridex_service_permission.lock_request_writer_v1();
 IF gridex_ediel_services.actor_current_v1(p_company_id,p_actor_user_id,false) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_service_archive_actor_forbidden' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_submission) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_submission) x WHERE x NOT IN('assignmentId','scopeBasisVersion','kind','source','terms','issuerReceipt','transportRelationId','transportActorId'))
 OR jsonb_typeof(p_submission->'source') IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_submission->'source') x WHERE x NOT IN('bytesBase64','mimeType','reference','version')) THEN RAISE EXCEPTION 'ediel_service_archive_shape_invalid';END IF;
 IF jsonb_typeof(p_submission->'terms') IS DISTINCT FROM 'object' OR NOT(p_submission->'terms' ? 'valid_from' AND p_submission->'terms' ? 'valid_to') OR EXISTS(SELECT FROM jsonb_object_keys(p_submission->'terms') x WHERE x NOT IN('valid_from','valid_to','permission_agreement_reference','permission_requested_method','permission_network_contract_start','permission_network_contract_end','permission_purpose_code','permission_reporting_frequency','permission_request_grid_area','permission_reporting_term_kind','permission_customer_classification','permission_termination_reason','permission_termination_at')) THEN RAISE EXCEPTION 'ediel_service_archive_evidence_terms_required';END IF;
 IF EXISTS(SELECT FROM jsonb_each(p_submission->'terms') x WHERE x.key IN('permission_network_contract_start','permission_network_contract_end') AND x.value<>'null'::jsonb AND (jsonb_typeof(x.value)<>'string' OR x.value#>>'{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) THEN RAISE EXCEPTION 'ediel_service_archive_network_period_invalid';END IF;
 terms_record:=jsonb_populate_record(NULL::public.ediel_service_evidence,p_submission->'terms');terms:=gridex_ediel_services.evidence_terms_v1(terms_record);
 IF (terms_record.permission_agreement_reference IS NOT NULL AND (terms_record.permission_agreement_reference<>btrim(terms_record.permission_agreement_reference) OR length(terms_record.permission_agreement_reference) NOT BETWEEN 1 AND 35)) OR (terms_record.permission_requested_method IS NOT NULL AND gridex_metering_method_changes.requested_method_supported_v1(terms_record.permission_requested_method) IS NOT TRUE) THEN RAISE EXCEPTION 'ediel_service_archive_source_permission_terms_invalid';END IF;
 IF (terms_record.permission_network_contract_start IS NOT NULL AND NOT isfinite(terms_record.permission_network_contract_start)) OR (terms_record.permission_network_contract_end IS NOT NULL AND (NOT isfinite(terms_record.permission_network_contract_end) OR terms_record.permission_network_contract_start IS NULL OR terms_record.permission_network_contract_end<terms_record.permission_network_contract_start)) THEN RAISE EXCEPTION 'ediel_service_archive_network_period_invalid';END IF;
 IF terms_record.valid_from IS NULL OR NOT isfinite(terms_record.valid_from) OR (terms_record.valid_to IS NOT NULL AND (NOT isfinite(terms_record.valid_to) OR terms_record.valid_to<=terms_record.valid_from)) THEN RAISE EXCEPTION 'ediel_service_archive_evidence_terms_invalid';END IF;
 SELECT * INTO a FROM public.ediel_service_assignments WHERE company_id=p_company_id AND id=(p_submission->>'assignmentId')::uuid;
 IF a.id IS NULL OR a.scope_basis_version IS DISTINCT FROM (p_submission->>'scopeBasisVersion')::bigint OR a.scope_basis_version IS NULL THEN RAISE EXCEPTION 'ediel_service_archive_current_scope_required';END IF;
 v_scope:=gridex_service_administration.scope_v1(a);sh:=encode(sha256(convert_to(v_scope::text,'UTF8')),'hex');
 IF NOT EXISTS(SELECT FROM gridex_service_administration.scope_versions s WHERE s.company_id=a.company_id AND s.assignment_id=a.id AND s.scope_basis_version=a.scope_basis_version AND s.scope=v_scope) THEN RAISE EXCEPTION 'ediel_service_archive_authentic_scope_required';END IF;
 bytes:=decode(p_submission#>>'{source,bytesBase64}','base64');kind:=p_submission->>'kind';v_source_hash:=encode(sha256(bytes),'hex');
 IF kind IS DISTINCT FROM 'dso_contract' AND (terms_record.permission_network_contract_start IS NOT NULL OR terms_record.permission_network_contract_end IS NOT NULL) THEN RAISE EXCEPTION 'ediel_service_archive_network_period_kind_invalid';END IF;
 IF octet_length(bytes) NOT BETWEEN 1 AND 8388608 OR substring(bytes,1,5)<>decode('255044462d','hex') OR p_submission#>>'{source,mimeType}' IS DISTINCT FROM 'application/pdf'
 OR nullif(p_submission#>>'{source,reference}','') IS NULL OR length(p_submission#>>'{source,reference}')>2000 OR nullif(p_submission#>>'{source,version}','') IS NULL OR length(p_submission#>>'{source,version}')>200 THEN RAISE EXCEPTION 'ediel_service_archive_bytes_invalid';END IF;
 IF kind='transport_mandate' THEN
  IF NOT EXISTS(SELECT FROM public.tenant_counterparty_relations r WHERE r.company_id=a.company_id AND r.id=(p_submission->>'transportRelationId')::uuid AND r.counterparty_actor_id=(p_submission->>'transportActorId')::uuid AND r.environment=a.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=now() AND (r.valid_to IS NULL OR now()<r.valid_to)) THEN RAISE EXCEPTION 'ediel_service_archive_transport_relation_required';END IF;
 ELSIF p_submission->>'transportRelationId' IS NOT NULL OR p_submission->>'transportActorId' IS NOT NULL THEN RAISE EXCEPTION 'ediel_service_archive_transport_scope_invalid';END IF;
 SELECT * INTO archive FROM gridex_ediel_services.artifacts x WHERE x.company_id=a.company_id AND x.environment=a.environment AND x.assignment_id=a.id AND x.scope_basis_version=a.scope_basis_version AND x.evidence_kind=kind AND x.source_hash=v_source_hash AND x.source_reference=p_submission#>>'{source,reference}' AND x.source_version=p_submission#>>'{source,version}';
 IF FOUND THEN
  IF archive.evidence_terms IS DISTINCT FROM terms OR archive.issuer_receipt IS DISTINCT FROM p_submission->'issuerReceipt' OR archive.transport_relation_id IS DISTINCT FROM (p_submission->>'transportRelationId')::uuid OR archive.transport_actor_id IS DISTINCT FROM (p_submission->>'transportActorId')::uuid THEN RAISE EXCEPTION 'ediel_service_archive_receipt_conflict';END IF;
 ELSE
  INSERT INTO gridex_ediel_services.artifacts(company_id,environment,assignment_id,scope_basis_version,scope,scope_hash,evidence_kind,transport_relation_id,transport_actor_id,evidence_terms,source_bytes,source_hash,mime_type,source_reference,source_version,issuer_receipt,submitted_by)
  VALUES(a.company_id,a.environment,a.id,a.scope_basis_version,v_scope,sh,kind,(p_submission->>'transportRelationId')::uuid,(p_submission->>'transportActorId')::uuid,terms,bytes,v_source_hash,'application/pdf',p_submission#>>'{source,reference}',p_submission#>>'{source,version}',p_submission->'issuerReceipt',p_actor_user_id) RETURNING * INTO archive;
 END IF;
 IF gridex_ediel_services.receipt_current_v1(archive) IS NOT TRUE THEN missing:=missing||'"authentic_current_issuer_and_representation_receipt"'::jsonb;END IF;
 RETURN jsonb_build_object('status','archived','companyId',archive.company_id,'assignmentId',archive.assignment_id,'artifactId',archive.id,'sourceHash',archive.source_hash,'scopeHash',archive.scope_hash,'scopeBasisVersion',archive.scope_basis_version,'missing',missing);
END $$;
CREATE OR REPLACE FUNCTION public.ediel_service_administration_command_v1(p_company_id uuid,p_actor_user_id uuid,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE action text;v_command_id uuid;fields jsonb;allowed text[];a public.ediel_service_assignments%rowtype;g public.ediel_data_access_grants%rowtype;
 n_a public.ediel_service_assignments%rowtype;n_e public.ediel_service_evidence%rowtype;n_g public.ediel_data_access_grants%rowtype;
 prior gridex_service_administration.commands%rowtype;result jsonb;expected_version bigint;detail_text text;message_text text;l public.ediel_assignment_permission_links%rowtype;permission public.metering_permissions%rowtype;
BEGIN
 PERFORM gridex_service_permission.lock_request_writer_v1();
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id FOR SHARE;
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL) OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_service_administration_actor_forbidden' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('action','commandId','assignmentId','expectedVersion','grantId','expectedGrantVersion','fields')) THEN RAISE EXCEPTION 'ediel_service_command_shape_required';END IF;
 action:=p_input->>'action';v_command_id:=(p_input->>'commandId')::uuid;fields:=coalesce(p_input->'fields','{}');
 IF v_command_id IS NULL OR (action IN ('create_assignment','stage_evidence','create_grant','revoke_grant','approve_assignment','publish_grant')) IS NOT TRUE OR jsonb_typeof(fields) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_service_command_shape_required';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ediel_service_command:'||v_command_id::text,0));
 SELECT * INTO prior FROM gridex_service_administration.commands c WHERE c.command_id=v_command_id FOR SHARE;
 IF FOUND THEN IF prior.company_id IS DISTINCT FROM p_company_id OR prior.actor_user_id IS DISTINCT FROM p_actor_user_id OR prior.input IS DISTINCT FROM p_input THEN RAISE EXCEPTION 'ediel_service_command_scope_conflict';END IF;RETURN prior.result;END IF;
 IF action='create_assignment' THEN
  IF p_input ? 'assignmentId' OR p_input ? 'expectedVersion' OR p_input ? 'grantId' THEN RAISE EXCEPTION 'ediel_service_create_scope_invalid';END IF;
  allowed:=ARRAY['beneficiary_company_id','provider_actor_id','actor_profile_id','customer_id','dso_actor_id','environment','mode','purpose','object_ids','product_ids','field_sets','data_start','data_end','valid_from','valid_to'];
  IF EXISTS(SELECT FROM jsonb_object_keys(fields) k WHERE NOT(k=ANY(allowed))) THEN RAISE EXCEPTION 'ediel_service_assignment_field_forbidden';END IF;
  n_a:=jsonb_populate_record(NULL::public.ediel_service_assignments,fields);
  -- These are administrative draft ownership checks; they grant no market or
  -- beneficiary permission and do not certify the referenced external actor.
  PERFORM x.id FROM public.customers x WHERE x.id=n_a.customer_id AND x.company_id=p_company_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'ediel_service_customer_not_owned';END IF;
  PERFORM x.id FROM public.tenant_ediel_profiles x WHERE x.id=n_a.actor_profile_id AND x.company_id=p_company_id AND x.environment=n_a.environment FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'ediel_service_profile_not_owned';END IF;
  PERFORM x.id FROM public.tenant_actor_identifiers x WHERE x.company_id=p_company_id AND x.environment=n_a.environment AND x.actor_id=n_a.provider_actor_id AND x.identifier_type='EdielId' AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'ediel_service_legal_provider_not_owned';END IF;
  INSERT INTO public.ediel_service_assignments(company_id,beneficiary_company_id,provider_actor_id,actor_profile_id,customer_id,dso_actor_id,environment,mode,purpose,object_ids,product_ids,field_sets,data_start,data_end,valid_from,valid_to,status)
   VALUES(p_company_id,n_a.beneficiary_company_id,n_a.provider_actor_id,n_a.actor_profile_id,n_a.customer_id,n_a.dso_actor_id,n_a.environment,n_a.mode,n_a.purpose,n_a.object_ids,n_a.product_ids,n_a.field_sets,n_a.data_start,n_a.data_end,n_a.valid_from,n_a.valid_to,'held') RETURNING * INTO a;
  result:=jsonb_build_object('status','held','assignmentId',a.id,'assignmentVersion',a.version,'missing',jsonb_build_array('authentic_current_owner_approvals_and_scoped_readiness'));
 ELSE
  expected_version:=(p_input->>'expectedVersion')::bigint;
  IF p_input->>'assignmentId' IS NULL OR expected_version IS NULL OR expected_version<1 THEN RAISE EXCEPTION 'ediel_service_assignment_version_required';END IF;
  SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=p_company_id AND id=(p_input->>'assignmentId')::uuid;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(a.company_id::text||':'||a.environment||':'||a.provider_actor_id::text||':'||a.customer_id::text||':'||a.dso_actor_id::text||':'||a.mode,0));
  SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=p_company_id AND id=(p_input->>'assignmentId')::uuid FOR UPDATE;
  IF a.version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION 'ediel_service_assignment_stale';END IF;
  IF action='approve_assignment' THEN
   IF fields<>'{}'::jsonb OR p_input ? 'grantId' OR a.status IS DISTINCT FROM 'held' THEN RAISE EXCEPTION 'ediel_service_approval_scope_invalid';END IF;
   -- Only actual preexisting verified owner evidence can approve this scope.
   -- A held assessment rolls this status/history write back atomically.
   BEGIN
    UPDATE public.ediel_service_assignments SET status='active' WHERE company_id=p_company_id AND id=a.id RETURNING * INTO a;
    result:=public.ediel_service_assignment_assessment_v1(p_company_id,a.id);
    IF result->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'ediel_service_assignment_approval_held' USING DETAIL=result::text;END IF;
    result:=result||jsonb_build_object('status','approved_waiting_permission','accessGranted',false);
   EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS detail_text=PG_EXCEPTION_DETAIL,message_text=MESSAGE_TEXT;
    IF message_text IS DISTINCT FROM 'ediel_service_assignment_approval_held' THEN RAISE;END IF;
    result:=detail_text::jsonb;
   END;
  ELSIF action='stage_evidence' THEN
   IF p_input ? 'grantId' THEN RAISE EXCEPTION 'ediel_service_evidence_scope_invalid';END IF;
   allowed:=ARRAY['kind','source_reference','source_sha256','source_version','valid_from','valid_to','transport_relation_id','transport_actor_id','permission_agreement_reference','permission_requested_method','permission_network_contract_start','permission_network_contract_end','permission_purpose_code','permission_reporting_frequency','permission_request_grid_area','permission_reporting_term_kind','permission_customer_classification','permission_termination_reason','permission_termination_at'];
   IF EXISTS(SELECT FROM jsonb_object_keys(fields) k WHERE NOT(k=ANY(allowed))) THEN RAISE EXCEPTION 'ediel_service_evidence_approval_field_forbidden';END IF;
   n_e:=jsonb_populate_record(NULL::public.ediel_service_evidence,fields);
   IF n_e.kind='transport_mandate' THEN PERFORM r.id FROM public.tenant_counterparty_relations r WHERE r.company_id=p_company_id AND r.id=n_e.transport_relation_id AND r.counterparty_actor_id=n_e.transport_actor_id AND r.environment=a.environment AND r.relation_type='ediel_transport_agent' FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'ediel_service_transport_relation_not_owned';END IF;END IF;
   INSERT INTO public.ediel_service_evidence(company_id,assignment_id,kind,source_reference,source_sha256,source_version,valid_from,valid_to,status,transport_relation_id,transport_actor_id,permission_agreement_reference,permission_requested_method,permission_network_contract_start,permission_network_contract_end,permission_purpose_code,permission_reporting_frequency,permission_request_grid_area,permission_reporting_term_kind,permission_customer_classification,permission_termination_reason,permission_termination_at)
    VALUES(p_company_id,a.id,n_e.kind,n_e.source_reference,n_e.source_sha256,n_e.source_version,n_e.valid_from,n_e.valid_to,'pending',n_e.transport_relation_id,n_e.transport_actor_id,n_e.permission_agreement_reference,n_e.permission_requested_method,n_e.permission_network_contract_start,n_e.permission_network_contract_end,n_e.permission_purpose_code,n_e.permission_reporting_frequency,n_e.permission_request_grid_area,n_e.permission_reporting_term_kind,n_e.permission_customer_classification,n_e.permission_termination_reason,n_e.permission_termination_at) RETURNING * INTO n_e;
   result:=jsonb_build_object('status','pending','assignmentId',a.id,'assignmentVersion',a.version,'evidenceId',n_e.id,'approvalGranted',false);
  ELSIF action='create_grant' THEN
   IF p_input ? 'grantId' THEN RAISE EXCEPTION 'ediel_service_grant_scope_invalid';END IF;
   allowed:=ARRAY['permission_link_id','object_ids','product_ids','fields','data_start','data_end','valid_from','valid_to'];
   IF EXISTS(SELECT FROM jsonb_object_keys(fields) k WHERE NOT(k=ANY(allowed))) THEN RAISE EXCEPTION 'ediel_service_grant_field_forbidden';END IF;
   n_g:=jsonb_populate_record(NULL::public.ediel_data_access_grants,fields);
   INSERT INTO public.ediel_data_access_grants(company_id,beneficiary_company_id,assignment_id,permission_link_id,object_ids,product_ids,fields,purpose,data_start,data_end,valid_from,valid_to,status)
    VALUES(p_company_id,a.beneficiary_company_id,a.id,n_g.permission_link_id,n_g.object_ids,n_g.product_ids,n_g.fields,a.purpose,n_g.data_start,n_g.data_end,n_g.valid_from,n_g.valid_to,'held') RETURNING * INTO g;
   result:=jsonb_build_object('status','held','assignmentId',a.id,'assignmentVersion',a.version,'grantId',g.id,'grantVersion',g.version,'accessGranted',false);
  ELSE
   IF fields<>'{}'::jsonb OR p_input->>'grantId' IS NULL THEN RAISE EXCEPTION 'ediel_service_revoke_scope_invalid';END IF;
   IF (p_input->>'expectedGrantVersion')::bigint IS NULL OR (p_input->>'expectedGrantVersion')::bigint<1 THEN RAISE EXCEPTION 'ediel_grant_version_required';END IF;
   SELECT * INTO STRICT g FROM public.ediel_data_access_grants WHERE company_id=p_company_id AND assignment_id=a.id AND id=(p_input->>'grantId')::uuid FOR UPDATE;
   IF g.version IS DISTINCT FROM (p_input->>'expectedGrantVersion')::bigint THEN RAISE EXCEPTION 'ediel_grant_version_stale';END IF;
   IF action='publish_grant' THEN
    IF g.status IS DISTINCT FROM 'held' OR g.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'ediel_revoked_grant_requires_new_basis';END IF;
    result:=public.ediel_service_assignment_assessment_v1(p_company_id,a.id);
    IF result->>'status' IS DISTINCT FROM 'authorized' THEN RETURN result;END IF;
    SELECT * INTO STRICT l FROM public.ediel_assignment_permission_links WHERE company_id=p_company_id AND id=g.permission_link_id AND assignment_id=a.id FOR SHARE;
    SELECT * INTO STRICT permission FROM public.metering_permissions WHERE company_id=p_company_id AND id=l.permission_id FOR SHARE;
    PERFORM x.id FROM public.metering_permission_sites x WHERE x.company_id=p_company_id AND x.metering_permission_id=permission.id ORDER BY x.id FOR SHARE;
    IF (permission.status IN ('active','approved','partially_approved')) IS NOT TRUE OR permission.customer_id IS DISTINCT FROM a.customer_id OR gridex_service_administration.permission_matches_assignment_v1(a,permission) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('current_source_approved_market_permission'));END IF;
    IF g.valid_from>now() OR (g.valid_to IS NOT NULL AND g.valid_to<=now()) OR g.beneficiary_company_id IS DISTINCT FROM a.beneficiary_company_id OR g.purpose IS DISTINCT FROM a.purpose OR NOT(g.object_ids<@a.object_ids AND g.product_ids<@a.product_ids AND g.fields<@a.field_sets) OR g.data_start<a.data_start OR (a.data_end IS NOT NULL AND (g.data_end IS NULL OR g.data_end>a.data_end)) THEN RAISE EXCEPTION 'ediel_grant_basis_changed';END IF;
    IF EXISTS(SELECT FROM unnest(g.object_ids) object_id CROSS JOIN unnest(g.product_ids) product_id WHERE NOT EXISTS(SELECT FROM public.metering_permission_sites x WHERE x.company_id=p_company_id AND x.metering_permission_id=permission.id AND x.customer_id=a.customer_id AND x.facility_id=object_id AND x.status IN ('approved','active') AND x.metadata->>'source'='inbound_prodat_z14' AND x.metadata->>'edielMessageId'=coalesce(permission.inbound_z14_message_id,permission.source_z14_message_id)::text AND x.metadata->>'mode'=CASE a.mode WHEN 'V' THEN 'S17' ELSE 'S18' END AND x.metadata->>'product'=product_id AND x.start_at IS NOT NULL AND g.data_start>=x.start_at AND (x.end_at IS NULL OR (g.data_end IS NOT NULL AND g.data_end<=x.end_at)))) THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('explicit_approved_object_product_period'));END IF;
    UPDATE public.ediel_data_access_grants SET status='active' WHERE company_id=p_company_id AND id=g.id RETURNING * INTO g;
    result:=jsonb_build_object('status','active','assignmentId',a.id,'assignmentVersion',a.version,'grantId',g.id,'grantVersion',g.version,'accessGranted',true);
   ELSE
   IF g.status<>'revoked' THEN UPDATE public.ediel_data_access_grants SET status='revoked',revoked_at=now() WHERE id=g.id AND company_id=p_company_id RETURNING * INTO g;END IF;
   result:=jsonb_build_object('status','revoked','assignmentId',a.id,'assignmentVersion',a.version,'grantId',g.id,'grantVersion',g.version,'accessGranted',false);
   END IF;
  END IF;
 END IF;
 INSERT INTO gridex_service_administration.commands(command_id,company_id,actor_user_id,input,result) VALUES(v_command_id,p_company_id,p_actor_user_id,p_input,result);
 RETURN result;
END $$;
CREATE TABLE gridex_service_permission.request_timing_receipts(
 company_id uuid NOT NULL,assignment_id uuid NOT NULL,scope_basis_version bigint NOT NULL,permission_id uuid NOT NULL,
 scope jsonb NOT NULL,proof jsonb NOT NULL,request_day date NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(company_id,assignment_id,scope_basis_version),
 FOREIGN KEY(company_id,assignment_id) REFERENCES public.ediel_service_assignments(company_id,id),
 FOREIGN KEY(company_id,permission_id) REFERENCES public.metering_permissions(company_id,id)
);
ALTER TABLE gridex_service_permission.request_timing_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_service_permission.request_timing_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_service_permission.request_timing_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ediel_service_request_timing_immutable BEFORE UPDATE OR DELETE ON gridex_service_permission.request_timing_receipts FOR EACH ROW EXECUTE FUNCTION gridex_service_administration.immutable_v1();
CREATE TRIGGER ediel_service_request_timing_no_truncate BEFORE TRUNCATE ON gridex_service_permission.request_timing_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_service_administration.immutable_v1();

-- Exact shared auth order. Native prospective producers take writer-compatible
-- modes on the service tables BEFORE any reader obtains its SHARE locks.
CREATE FUNCTION gridex_service_permission.lock_request_writer_v1() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 LOCK TABLE auth.users,public.user_profiles,public.companies,public.company_memberships,public.admin_users,
  public.user_roles,public.roles,public.role_permissions,public.permissions,public.user_permissions,public.user_permission_overrides,
  public.tenant_actor_identifiers,public.tenant_actor_roles,public.tenant_ediel_profiles,public.tenant_counterparty_relations,public.platform_actor_identifiers IN SHARE MODE;
 LOCK TABLE public.ediel_service_assignments,public.ediel_service_evidence,public.ediel_data_access_grants,public.ediel_assignment_permission_links,public.metering_permissions,public.metering_permission_sites IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.ediel_ack_transaction_results,public.meter_reading_series,gridex_utilts_binding.receipts,gridex_utilts_binding.contracts,
 gridex_service_administration.scope_versions,gridex_received_sources.permission_transitions,gridex_received_sources.validation_assessments IN SHARE MODE;
 LOCK TABLE gridex_service_administration.commands,gridex_ediel_services.artifacts IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE gridex_ediel_services.issuer_keys,gridex_ediel_services.issuer_representations,gridex_ediel_services.issuer_revocations IN SHARE MODE;
 LOCK TABLE gridex_ediel_services.reviews IN SHARE ROW EXCLUSIVE MODE;
 PERFORM gridex_ediel_services.lock_evidence_graph_v1();
END $$;
REVOKE ALL ON FUNCTION gridex_service_permission.lock_request_writer_v1() FROM PUBLIC,anon,authenticated,service_role;

-- Parity with deadlinePolicy's Stockholm request-day and clamped calendar years.
-- Requested wire days use the actual Ediel fixed UTC+1 source calendar; legal
-- validity is never interpreted as the original DSO network-contract period.
CREATE FUNCTION gridex_service_permission.evaluate_request_period_v1(mode text,starts timestamptz,ends timestamptz,day date,network_start date,network_end date) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$DECLARE first_day date;last_day date;earliest date;missing text[]:='{}';BEGIN
 IF mode IS NULL OR mode NOT IN('V','VH') OR day IS NULL OR network_start IS NULL OR NOT isfinite(day) OR NOT isfinite(network_start)
 OR network_end IS NOT NULL AND (NOT isfinite(network_end) OR network_end<network_start) OR starts IS NULL OR NOT isfinite(starts) OR ends IS NOT NULL AND NOT isfinite(ends) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['authentic_dso_network_contract_period_required']);END IF;
 first_day:=(starts AT TIME ZONE INTERVAL '01:00')::date;last_day:=(ends AT TIME ZONE INTERVAL '01:00')::date;
 earliest:=greatest((day-interval '3 years')::date,network_start);
 IF first_day<earliest THEN missing:=array_append(missing,'esco_request_start_before_three_year_or_network_contract_bound');END IF;
 IF network_end IS NOT NULL AND (first_day>network_end OR last_day>network_end) THEN missing:=array_append(missing,'esco_request_outside_dso_network_contract_period');END IF;
 IF mode='VH' THEN
  IF last_day IS NULL THEN missing:=array_append(missing,'esco_historical_end_required');END IF;
  IF first_day>=day OR last_day>=day THEN missing:=array_append(missing,'esco_historical_period_must_precede_request_day');END IF;
 ELSE
  IF network_end IS NOT NULL AND network_end<day THEN missing:=array_append(missing,'esco_continuous_dso_contract_not_current');END IF;
  IF first_day>day THEN missing:=array_append(missing,'esco_continuous_start_after_request_day');END IF;
  IF last_day IS NOT NULL AND last_day<=day THEN missing:=array_append(missing,'esco_continuous_end_must_be_future');END IF;
 END IF;
 IF ends IS NOT NULL AND ends<=starts THEN missing:=array_append(missing,'esco_request_period_end_before_start');END IF;
 RETURN jsonb_build_object('status',CASE WHEN cardinality(missing)=0 THEN 'authorized' ELSE 'held' END,'missing',missing,'requestDay',day,'earliestAllowedDate',earliest,'startDate',first_day,'endDate',last_day,'mode',mode,'networkStart',network_start,'networkEnd',network_end);
END $$;
REVOKE ALL ON FUNCTION gridex_service_permission.evaluate_request_period_v1(text,timestamptz,timestamptz,date,date,date) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_service_permission.current_request_timing_v1(c uuid,aid uuid,actor uuid,expected_version bigint,require_recorded boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a public.ediel_service_assignments%rowtype;e public.ediel_service_evidence%rowtype;review gridex_ediel_services.reviews%rowtype;recorded gridex_service_permission.request_timing_receipts%rowtype;day date;bounds jsonb;proof jsonb;scope jsonb;BEGIN
 PERFORM gridex_ediel_services.lock_evidence_graph_v1();PERFORM gridex_service_administration.require_manual_actor_v1(c,actor);
 SELECT * INTO a FROM public.ediel_service_assignments WHERE company_id=c AND id=aid;
 IF a.id IS NULL OR a.version IS DISTINCT FROM expected_version OR a.scope_basis_version IS NULL THEN RAISE EXCEPTION 'ediel_assignment_version_stale';END IF;
 IF public.ediel_service_assignment_assessment_v1(c,aid)->>'status' IS DISTINCT FROM 'authorized' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_authentic_service_assignment_evidence_required']);END IF;
 scope:=gridex_service_administration.scope_v1(a);
 SELECT * INTO recorded FROM gridex_service_permission.request_timing_receipts WHERE company_id=c AND assignment_id=aid AND scope_basis_version=a.scope_basis_version;
 IF recorded.assignment_id IS NOT NULL THEN
  IF recorded.scope IS DISTINCT FROM scope THEN RETURN jsonb_build_object('status','held','missing',ARRAY['immutable_service_request_scope_changed']);END IF;
  SELECT * INTO e FROM public.ediel_service_evidence WHERE company_id=c AND assignment_id=aid AND id=(recorded.proof->>'evidenceId')::uuid;
  day:=recorded.request_day;
 ELSE
  IF require_recorded THEN RETURN jsonb_build_object('status','held','missing',ARRAY['immutable_service_request_timing_required']);END IF;
  SELECT * INTO e FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid AND x.kind='dso_contract' AND x.status='verified' AND x.approved_assignment_version=a.scope_basis_version AND x.permission_network_contract_start IS NOT NULL AND gridex_ediel_services.review_current_v1(x) IS TRUE ORDER BY x.id LIMIT 1;
  IF e.id IS NULL OR (SELECT count(DISTINCT (x.permission_network_contract_start,x.permission_network_contract_end)) FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid AND x.kind='dso_contract' AND x.status='verified' AND x.approved_assignment_version=a.scope_basis_version AND x.permission_network_contract_start IS NOT NULL AND gridex_ediel_services.review_current_v1(x) IS TRUE)<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['authentic_unique_dso_network_contract_period_required']);END IF;
  day:=(clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date;
 END IF;
 IF e.id IS NULL OR e.kind IS DISTINCT FROM 'dso_contract' OR e.approved_assignment_version IS DISTINCT FROM a.scope_basis_version OR gridex_ediel_services.review_current_v1(e) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['captured_dso_contract_authority_not_current']);END IF;
 SELECT * INTO review FROM gridex_ediel_services.reviews WHERE company_id=c AND evidence_id=e.id ORDER BY review_sequence DESC LIMIT 1;
 proof:=jsonb_build_object('version',1,'evidenceId',e.id,'sourceHash',e.source_sha256,'sourceReference',e.source_reference,'sourceVersion',e.source_version,'networkStart',e.permission_network_contract_start,'networkEnd',e.permission_network_contract_end,'reviewId',review.id,'reviewerUserId',review.reviewer_user_id,'reviewSequence',review.review_sequence,'scopeBasisVersion',a.scope_basis_version,'requestDay',day);
 IF recorded.assignment_id IS NOT NULL AND recorded.proof IS DISTINCT FROM proof THEN RETURN jsonb_build_object('status','held','missing',ARRAY['immutable_captured_dso_contract_proof_changed']);END IF;
 bounds:=gridex_service_permission.evaluate_request_period_v1(a.mode,a.data_start,a.data_end,day,e.permission_network_contract_start,e.permission_network_contract_end);
 RETURN bounds||jsonb_build_object('proof',proof,'scope',scope,'permissionId',recorded.permission_id);
END $$;
REVOKE ALL ON FUNCTION gridex_service_permission.current_request_timing_v1(uuid,uuid,uuid,bigint,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- Copy full predecessors, preserving public/private entry OIDs, ACLs and all
-- original source/role/permission/wire guards. No historic body is edited.
DO $$DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('public.ediel_coordinate_service_permission_v1(uuid,uuid,uuid,bigint,text)'::regprocedure);
 EXECUTE replace(definition,'public.ediel_coordinate_service_permission_v1(', 'gridex_service_administration.coordinate_before_source_timing_v1(');
 definition:=pg_get_functiondef('gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid)'::regprocedure);
 EXECUTE replace(definition,'gridex_service_permission.context_v1(', 'gridex_service_permission.context_before_source_timing_v1(');
 definition:=pg_get_functiondef('public.ediel_review_service_evidence_v1(uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
 EXECUTE replace(definition,'public.ediel_review_service_evidence_v1(', 'gridex_ediel_services.review_before_source_timing_v1(');
END $$;
REVOKE ALL ON FUNCTION gridex_service_administration.coordinate_before_source_timing_v1(uuid,uuid,uuid,bigint,text),gridex_service_permission.context_before_source_timing_v1(uuid,uuid,uuid,bigint,text,uuid),gridex_ediel_services.review_before_source_timing_v1(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.ediel_review_service_evidence_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_evidence_id uuid,p_review jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_service_permission.lock_request_writer_v1();
 RETURN gridex_ediel_services.review_before_source_timing_v1(p_company_id,p_actor_user_id,p_artifact_id,p_evidence_id,p_review);
END $$;
CREATE OR REPLACE FUNCTION public.ediel_coordinate_service_permission_v1(p_provider_company_id uuid,p_assignment_id uuid,p_actor_user_id uuid,p_expected_version bigint,p_command text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$DECLARE timing jsonb;result jsonb;BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ediel_service_manual_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_service_permission.lock_request_writer_v1();
 IF p_command IS DISTINCT FROM 'request_access' THEN RETURN gridex_service_administration.coordinate_before_source_timing_v1(p_provider_company_id,p_assignment_id,p_actor_user_id,p_expected_version,p_command);END IF;
 timing:=gridex_service_permission.current_request_timing_v1(p_provider_company_id,p_assignment_id,p_actor_user_id,p_expected_version,false);
 IF timing->>'status' IS DISTINCT FROM 'authorized' THEN RETURN jsonb_build_object('status','held','permissionId',NULL,'missing',timing->'missing');END IF;
 IF timing->>'permissionId' IS NOT NULL THEN
  -- Immutable current retry calls only the retained protected resolver. It does
  -- not re-enter the original coordinator's INSERT ON CONFLICT link path.
  RETURN public.ediel_resolve_service_permission_command_v1(p_provider_company_id,p_assignment_id,p_actor_user_id,p_expected_version,(timing->>'permissionId')::uuid);
 END IF;
 BEGIN
  result:=gridex_service_administration.coordinate_before_source_timing_v1(p_provider_company_id,p_assignment_id,p_actor_user_id,p_expected_version,p_command);
  IF (result->>'status' IN('permission_required','reuse_permission')) IS NOT TRUE OR result->>'permissionId' IS NULL THEN RAISE EXCEPTION 'ediel_service_timing_predecessor_held' USING ERRCODE='P0917';END IF;
  INSERT INTO gridex_service_permission.request_timing_receipts(company_id,assignment_id,scope_basis_version,permission_id,scope,proof,request_day)
   VALUES(p_provider_company_id,p_assignment_id,(timing#>>'{proof,scopeBasisVersion}')::bigint,(result->>'permissionId')::uuid,timing->'scope',timing->'proof',(timing->>'requestDay')::date);
 EXCEPTION WHEN SQLSTATE 'P0917' THEN RETURN result;
 END;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION gridex_service_permission.context_v1(c uuid,aid uuid,actor uuid,expected_version bigint,code text,pid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE timing jsonb;basis jsonb;BEGIN
 PERFORM gridex_ediel_services.lock_evidence_graph_v1();
 IF code='Z13' THEN
  timing:=gridex_service_permission.current_request_timing_v1(c,aid,actor,expected_version,true);
  IF timing->>'status' IS DISTINCT FROM 'authorized' OR timing->>'permissionId' IS DISTINCT FROM pid::text THEN RETURN jsonb_build_object('status','held','missing',coalesce(timing->'missing','["immutable_service_request_permission_required"]'::jsonb));END IF;
 END IF;
 basis:=gridex_service_permission.context_before_source_timing_v1(c,aid,actor,expected_version,code,pid);
 IF basis->>'status'='authorized' AND code='Z13' THEN RETURN basis||jsonb_build_object('requestTiming',timing->'proof');END IF;
 RETURN basis;
END $$;
COMMIT;
