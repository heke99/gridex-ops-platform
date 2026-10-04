-- Prospective signed-contract original ingress. This adapter uses existing
-- masterdata/metering/production commands and the established retention engine.
-- It seeds no issuer, representation, permission, review or market activation.
BEGIN;
CREATE SCHEMA gridex_contract_source_intake;
REVOKE ALL ON SCHEMA gridex_contract_source_intake FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_contract_source_intake.kinds(kind text PRIMARY KEY,source_schema text NOT NULL,source_table text NOT NULL UNIQUE,purpose text NOT NULL UNIQUE);
INSERT INTO gridex_contract_source_intake.kinds VALUES
 ('masterdata_declaration','gridex_customer_masterdata','signed_declarations','signed_contract_customer_masterdata'),
 ('contract_requested_method','gridex_metering_method_changes','contract_request_declarations','signed_contract_requested_metering_method'),
 ('metering_method_event','gridex_metering_method_changes','events','signed_contract_customer_agreed_method_event'),
 ('production_contract_event','gridex_received_sources','production_contract_events','signed_production_contract_event');
CREATE TABLE gridex_contract_source_intake.issuer_keys(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 issuer_code text NOT NULL CHECK(length(issuer_code)>0),legal_authority_reference text NOT NULL CHECK(length(legal_authority_reference)>0),legal_authority_source_hash text NOT NULL CHECK(legal_authority_source_hash~'^[a-f0-9]{64}$'),
 signing_key bytea NOT NULL CHECK(octet_length(signing_key)>=32),valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(isfinite(valid_from) AND isfinite(valid_to) AND valid_to>valid_from));
CREATE TABLE gridex_contract_source_intake.representations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 issuer_key_id uuid NOT NULL REFERENCES gridex_contract_source_intake.issuer_keys(id),legal_actor_id uuid NOT NULL,kind text NOT NULL REFERENCES gridex_contract_source_intake.kinds(kind),
 legal_representation_reference text NOT NULL CHECK(length(legal_representation_reference)>0),legal_authority_source_hash text NOT NULL CHECK(legal_authority_source_hash~'^[a-f0-9]{64}$'),valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(isfinite(valid_from) AND isfinite(valid_to) AND valid_to>valid_from));
CREATE TABLE gridex_contract_source_intake.artifacts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),kind text NOT NULL REFERENCES gridex_contract_source_intake.kinds(kind),
 target_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),contract_id uuid NOT NULL REFERENCES public.customer_contracts(id),contract_document_id uuid NOT NULL REFERENCES public.customer_contract_documents(id),native_scope jsonb NOT NULL,claims jsonb NOT NULL,
 agreement_original bytea,agreement_sha256 text NOT NULL CHECK(agreement_sha256~'^[a-f0-9]{64}$'),source_original bytea,source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),claims_hash text NOT NULL CHECK(claims_hash=encode(sha256(convert_to(claims::text,'UTF8')),'hex')),
 issuer_key_id uuid REFERENCES gridex_contract_source_intake.issuer_keys(id),representation_id uuid REFERENCES gridex_contract_source_intake.representations(id),signature_hex text CHECK(signature_hex~'^[a-f0-9]{64}$'),submitted_by uuid NOT NULL REFERENCES auth.users(id),captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,environment,kind,contract_id,source_sha256));
CREATE TABLE gridex_contract_source_intake.reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),artifact_id uuid NOT NULL REFERENCES gridex_contract_source_intake.artifacts(id),company_id uuid NOT NULL REFERENCES public.companies(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),outcome text NOT NULL CHECK(outcome IN('approved','held','rejected')),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 4000),missing jsonb NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_contract_source_intake.qualifications(artifact_id uuid PRIMARY KEY REFERENCES gridex_contract_source_intake.artifacts(id),target_id uuid NOT NULL UNIQUE,review_id uuid NOT NULL UNIQUE REFERENCES gridex_contract_source_intake.reviews(id),company_id uuid NOT NULL,kind text NOT NULL,row_hash text NOT NULL CHECK(row_hash~'^[a-f0-9]{64}$'),approved_by uuid NOT NULL REFERENCES auth.users(id),approved_at timestamptz NOT NULL);
CREATE TABLE gridex_contract_source_intake.revocations(target_kind text NOT NULL CHECK(target_kind IN('key','representation','artifact')),target_id uuid NOT NULL,source_reference text NOT NULL CHECK(length(source_reference)>0),source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),actor_user_id uuid NOT NULL REFERENCES auth.users(id),revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(target_kind,target_id));
DO $$DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['kinds','issuer_keys','representations','reviews','qualifications','revocations'] LOOP
  EXECUTE format('ALTER TABLE gridex_contract_source_intake.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE gridex_contract_source_intake.%I FORCE ROW LEVEL SECURITY',tab);EXECUTE format('REVOKE ALL ON gridex_contract_source_intake.%I FROM PUBLIC,anon,authenticated,service_role',tab);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_contract_source_intake.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',tab);EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON gridex_contract_source_intake.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',tab);
 END LOOP;
END$$;
CREATE FUNCTION gridex_contract_source_intake.claims_valid_v1(a gridex_contract_source_intake.artifacts) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE p jsonb:=a.claims;s jsonb;previous uuid;boundary timestamptz;kind text;tuple jsonb;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR nullif(p->>'sourceReference','') IS NULL OR nullif(p->>'sourceVersion','') IS NULL THEN RETURN false;END IF;
 IF a.kind='masterdata_declaration' THEN
  RETURN (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(p)x)=ARRAY['customerIdentity','endUserMasterdata','sourceReference','sourceVersion','validFrom','validTo']::text[]
  AND gridex_customer_masterdata.identity_v1(p->'customerIdentity') IS TRUE AND gridex_customer_masterdata.literal_masterdata_v1(p->'endUserMasterdata') IS TRUE
  AND isfinite((p->>'validFrom')::timestamptz) AND (p->>'validFrom')::timestamptz<=clock_timestamp() AND (p->>'validTo' IS NULL OR isfinite((p->>'validTo')::timestamptz) AND(p->>'validTo')::timestamptz>(p->>'validFrom')::timestamptz);
 ELSIF a.kind='contract_requested_method' THEN
  previous:=(p->>'previousDeclarationId')::uuid;
  RETURN (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(p)x)=ARRAY['previousDeclarationId','requestedMethod','sourceReference','sourceVersion']::text[]
  AND gridex_metering_method_changes.requested_method_supported_v1(p->>'requestedMethod') IS TRUE
  AND(previous IS NULL OR EXISTS(SELECT FROM gridex_metering_method_changes.contract_request_declarations d WHERE id=previous AND company_id=a.company_id AND environment=a.environment AND contract_id=a.contract_id AND gridex_ediel_retention.contract_copy_source_current_v1(a.company_id,'gridex_metering_method_changes','contract_request_declarations',d.id) IS TRUE));
 ELSIF a.kind='metering_method_event' THEN
  boundary:=(p->>'effectiveAt')::timestamptz;tuple:=gridex_metering_method_changes.canonical_tuple_projection_v1()->(p->>'subtype');
  s:=gridex_received_sources.supply_period_source_at_v1(a.company_id,(p->>'supplyPeriodId')::uuid,boundary);
  RETURN (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(p)x)=ARRAY['effectiveAt','requestedMethodDeclarationId','sourceReference','sourceVersion','subtype','supplyPeriodId']::text[]
  AND isfinite(boundary) AND extract(second FROM boundary)=0 AND tuple IS NOT NULL AND s->>'qualified'='true'
  AND s->>'customerId'=a.native_scope->>'customerId' AND s->>'meteringPointId'=a.native_scope->>'meteringPointId' AND s->>'siteId'=a.native_scope->>'siteId' AND s->>'legalActorId'=a.native_scope->>'legalActorId' AND s->>'dsoEdielId'=a.native_scope->>'legalReceiverId'
  AND(SELECT count(*) FROM jsonb_array_elements(s->'sourceObjects') own WHERE own->>'point'=a.native_scope->>'pointId' AND own->>'identityAgency'=a.native_scope->>'identityAgency' AND own->>'gridArea'=a.native_scope->>'gridArea')=1
  AND EXISTS(SELECT FROM gridex_metering_method_changes.contract_request_declarations d WHERE id=(p->>'requestedMethodDeclarationId')::uuid AND company_id=a.company_id AND environment=a.environment AND contract_id=a.contract_id AND requested_method=tuple->>'method' AND gridex_ediel_retention.contract_copy_source_current_v1(a.company_id,'gridex_metering_method_changes','contract_request_declarations',d.id) IS TRUE);
 ELSIF a.kind='production_contract_event' THEN
  boundary:=(p->>'boundaryAt')::timestamptz;kind:=p->>'eventKind';previous:=(p->>'startEventId')::uuid;
  RETURN (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(p)x)=ARRAY['boundaryAt','contractReference','eventKind','sourceReference','sourceVersion','startEventId']::text[]
  AND isfinite(boundary) AND extract(second FROM boundary)=0 AND nullif(p->>'contractReference','') IS NOT NULL
  AND(kind='signed' AND previous IS NULL OR kind='ceased' AND EXISTS(SELECT FROM gridex_received_sources.production_contract_events e WHERE id=previous AND company_id=a.company_id AND environment=a.environment AND contract_id=a.contract_id AND customer_id=(a.native_scope->>'customerId')::uuid AND metering_point_id=(a.native_scope->>'meteringPointId')::uuid AND legal_actor_id=(a.native_scope->>'legalActorId')::uuid AND legal_receiver_id=a.native_scope->>'legalReceiverId' AND event_kind='signed' AND boundary_at<boundary AND NOT EXISTS(SELECT FROM gridex_received_sources.production_contract_revocations WHERE event_id=e.id)));
 END IF;RETURN false;
 EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END$$;
ALTER TABLE gridex_contract_source_intake.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_contract_source_intake.artifacts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_contract_source_intake.artifacts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_contract_source_intake.lock_graph_v1() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 LOCK TABLE gridex_contract_source_intake.issuer_keys,gridex_contract_source_intake.representations,gridex_contract_source_intake.artifacts,gridex_contract_source_intake.reviews,gridex_contract_source_intake.qualifications,gridex_contract_source_intake.revocations IN SHARE ROW EXCLUSIVE MODE;
END$$;
CREATE FUNCTION gridex_contract_source_intake.actor_v1(c uuid,a uuid,mode text,k text,session_bound boolean DEFAULT true) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE wanted text;
BEGIN
 PERFORM gridex_contract_source_intake.lock_graph_v1();PERFORM id FROM auth.users WHERE id=a FOR SHARE;PERFORM id FROM public.user_profiles WHERE id=a FOR SHARE;PERFORM user_id FROM public.company_memberships WHERE company_id=c AND user_id=a FOR SHARE;
 IF (session_bound AND auth.uid() IS DISTINCT FROM a) OR mode NOT IN('archive','read','review') OR NOT EXISTS(SELECT FROM gridex_contract_source_intake.kinds WHERE kind=k)
 OR NOT EXISTS(SELECT FROM auth.users WHERE id=a AND deleted_at IS NULL AND(banned_until IS NULL OR banned_until<=clock_timestamp())) OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=a AND user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=a AND status='active' AND is_active AND accepted_at IS NOT NULL) OR NOT EXISTS(SELECT FROM public.companies WHERE id=c AND status='active') THEN RAISE EXCEPTION 'contract_intake_current_actor_required' USING ERRCODE='42501';END IF;
 FOREACH wanted IN ARRAY CASE WHEN mode='read' THEN ARRAY['communication.read','customers.read','contracts.read'] ELSE ARRAY['communication.write','customers.write','contracts.write'] END LOOP
  IF public.gridex_actor_has_company_permission(a,c,wanted) IS NOT TRUE OR gridex_requested_changes.scoped_permission_v1(c,a,wanted) IS NOT TRUE THEN RAISE EXCEPTION 'contract_intake_current_explicit_permission_required' USING ERRCODE='42501';END IF;
 END LOOP;
 IF k IN('contract_requested_method','metering_method_event') THEN
  wanted:=CASE mode WHEN 'read' THEN 'metering.read' ELSE 'metering.write' END;
  IF public.gridex_actor_has_company_permission(a,c,wanted) IS NOT TRUE OR gridex_requested_changes.scoped_permission_v1(c,a,wanted) IS NOT TRUE THEN RAISE EXCEPTION 'contract_intake_current_metering_permission_required' USING ERRCODE='42501';END IF;
 END IF;
 IF mode='review' AND(public.gridex_actor_has_company_permission(a,c,'ediel.source.review') IS NOT TRUE OR gridex_requested_changes.scoped_permission_v1(c,a,'ediel.source.review') IS NOT TRUE) THEN RAISE EXCEPTION 'contract_intake_current_reviewer_required' USING ERRCODE='42501';END IF;
END$$;
CREATE FUNCTION gridex_contract_source_intake.scope_v1(c uuid,ct uuid,env text,k text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE contract public.customer_contracts%rowtype;doc public.customer_contract_documents%rowtype;point public.metering_points%rowtype;site public.customer_sites%rowtype;header jsonb;network jsonb;legal_id text;id_count bigint;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();IF (env IN('test','production')) IS NOT TRUE OR NOT EXISTS(SELECT FROM gridex_contract_source_intake.kinds WHERE kind=k) THEN RAISE EXCEPTION 'contract_intake_scope_kind_environment_required';END IF;
 SELECT * INTO contract FROM public.customer_contracts WHERE id=ct AND company_id=c FOR SHARE;
 SELECT * INTO point FROM public.metering_points WHERE id=contract.metering_point_id AND company_id=c FOR SHARE;
 SELECT * INTO site FROM public.customer_sites WHERE id=coalesce(contract.customer_site_id,contract.site_id) AND company_id=c FOR SHARE;
 IF contract.id IS NULL OR (contract.status IN('signed','active')) IS NOT TRUE OR contract.signed_at IS NULL OR contract.signed_at>clock_timestamp() OR nullif(contract.signed_version,'') IS NULL OR contract.signature_snapshot IS NULL
 OR contract.signature_snapshot->>'company_id' IS DISTINCT FROM c::text OR contract.signature_snapshot->>'customer_id' IS DISTINCT FROM contract.customer_id::text OR contract.signature_snapshot->>'contract_id' IS DISTINCT FROM contract.id::text
 OR contract.signature_snapshot_sha256 IS DISTINCT FROM encode(sha256(convert_to(contract.signature_snapshot::text,'UTF8')),'hex') OR point.id IS NULL OR site.id IS NULL OR point.customer_id IS DISTINCT FROM contract.customer_id OR site.customer_id IS DISTINCT FROM contract.customer_id
 OR coalesce(point.customer_site_id,point.site_id) IS DISTINCT FROM site.id OR(contract.customer_site_id IS NOT NULL AND contract.customer_site_id<>site.id) OR(contract.site_id IS NOT NULL AND contract.site_id<>site.id)
 OR NOT EXISTS(SELECT FROM public.customers WHERE id=contract.customer_id AND company_id=c) THEN RAISE EXCEPTION 'contract_intake_actual_signed_contract_tuple_required';END IF;
 PERFORM public.ediel_require_contract_records_available_v1(c,contract.id);
 SELECT * INTO doc FROM public.customer_contract_documents WHERE company_id=c AND customer_contract_id=ct AND document_type='signed_contract_pdf' AND document_sha256=contract.document_sha256 AND verified_at IS NOT NULL ORDER BY id LIMIT 1 FOR SHARE;
 IF doc.id IS NULL OR doc.mime_type IS DISTINCT FROM 'application/pdf' OR doc.verified_at>clock_timestamp() OR doc.storage_bucket IS DISTINCT FROM 'customer-contract-documents' OR nullif(doc.storage_path,'') IS NULL OR NOT EXISTS(SELECT FROM storage.objects WHERE bucket_id=doc.storage_bucket AND name=doc.storage_path) THEN RAISE EXCEPTION 'contract_intake_actual_signed_pdf_custody_required';END IF;
 network:=gridex_network_registry_sources.network_for_company_v1(c,point.grid_owner_ediel_id,env);
 IF coalesce(nullif(point.ediel_metering_point_id,''),nullif(point.meter_point_id,'')) !~ '^[0-9]{18}$' OR nullif(point.grid_area_code,'') IS NULL OR network->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'contract_intake_current_company_network_source_required';END IF;
 SELECT count(DISTINCT (actor_id,identifier_value)),min(identifier_value) INTO id_count,legal_id FROM public.tenant_actor_identifiers WHERE company_id=c AND environment=env AND identifier_type='EdielId' AND valid_from<=clock_timestamp() AND(valid_to IS NULL OR valid_to>clock_timestamp());
 IF id_count<>1 THEN RAISE EXCEPTION 'contract_intake_unique_legal_supplier_required';END IF;
 header:=gridex_ai_processing.header_company_basis_v1(c,env,legal_id,point.grid_owner_ediel_id);
 IF nullif(header->>'legalActorId','') IS NULL OR header->>'legalSupplier' IS DISTINCT FROM legal_id OR header->>'companyId' IS DISTINCT FROM c::text OR header->>'environment' IS DISTINCT FROM env THEN RAISE EXCEPTION 'contract_intake_current_legal_supplier_required';END IF;
 IF k='production_contract_event' AND point.product_direction IS DISTINCT FROM 'production' THEN RAISE EXCEPTION 'contract_intake_actual_production_point_required';END IF;
 RETURN jsonb_build_object('companyId',c,'environment',env,'kind',k,'contractId',ct,'contractRevision',contract.signed_version,'protectedContractHash',gridex_received_sources.production_contract_hash_v1(contract),'signatureHash',contract.signature_snapshot_sha256,
 'contractDocumentId',doc.id,'agreementHash',doc.document_sha256,'storageBucket',doc.storage_bucket,'storagePath',doc.storage_path,'customerId',contract.customer_id,'siteId',site.id,'meteringPointId',point.id,'pointId',coalesce(nullif(point.ediel_metering_point_id,''),nullif(point.meter_point_id,'')),
 'identityAgency','9','gridArea',point.grid_area_code,'legalActorId',header->>'legalActorId','legalSenderId',legal_id,'legalReceiverId',point.grid_owner_ediel_id,'networkBasis',network->'basis');
END$$;
CREATE FUNCTION public.ediel_contract_intake_scope_v1(p_company_id uuid,p_actor_user_id uuid,p_contract_id uuid,p_environment text,p_kind text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$BEGIN PERFORM gridex_contract_source_intake.actor_v1(p_company_id,p_actor_user_id,'archive',p_kind);RETURN gridex_contract_source_intake.scope_v1(p_company_id,p_contract_id,p_environment,p_kind);END$$;
CREATE FUNCTION gridex_contract_source_intake.receipt_v1(a gridex_contract_source_intake.artifacts) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE key gridex_contract_source_intake.issuer_keys%rowtype;rep gridex_contract_source_intake.representations%rowtype;p jsonb;at timestamptz;issued timestamptz;expires timestamptz;purpose text;
BEGIN
 IF a.source_original IS NULL OR a.agreement_original IS NULL OR encode(sha256(a.source_original),'hex') IS DISTINCT FROM a.source_sha256 OR encode(sha256(a.agreement_original),'hex') IS DISTINCT FROM a.agreement_sha256 OR a.signature_hex IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO key FROM gridex_contract_source_intake.issuer_keys WHERE id=a.issuer_key_id AND company_id=a.company_id AND environment=a.environment FOR SHARE;
 SELECT * INTO rep FROM gridex_contract_source_intake.representations WHERE id=a.representation_id AND issuer_key_id=key.id AND company_id=a.company_id AND environment=a.environment AND kind=a.kind AND legal_actor_id=(a.native_scope->>'legalActorId')::uuid FOR SHARE;at:=clock_timestamp();
 IF key.id IS NULL OR rep.id IS NULL OR key.valid_from>at OR key.valid_to<=at OR rep.valid_from>at OR rep.valid_to<=at
 OR EXISTS(SELECT FROM gridex_contract_source_intake.revocations WHERE target_kind='key' AND target_id=key.id OR target_kind='representation' AND target_id=rep.id OR target_kind='artifact' AND target_id=a.id)
 OR encode(gridex_requested_changes.receipt_hmac_sha256_v1(a.source_original,key.signing_key),'hex') IS DISTINCT FROM a.signature_hex THEN RETURN NULL;END IF;
 p:=convert_from(a.source_original,'UTF8')::jsonb;issued:=(p->>'issuedAt')::timestamptz;expires:=(p->>'expiresAt')::timestamptz;SELECT kinds.purpose INTO STRICT purpose FROM gridex_contract_source_intake.kinds WHERE kind=a.kind;
 IF (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(p)x) IS DISTINCT FROM ARRAY['agreementHash','claims','expiresAt','format','issuedAt','issuerCode','legalAuthorityReference','nativeScope','purpose','receiptId','representationReference']::text[]
 OR p->>'format' IS DISTINCT FROM 'ediel_contract_original_source_v1' OR p->>'purpose' IS DISTINCT FROM purpose OR p->>'issuerCode' IS DISTINCT FROM key.issuer_code OR p->>'legalAuthorityReference' IS DISTINCT FROM key.legal_authority_reference OR p->>'representationReference' IS DISTINCT FROM rep.legal_representation_reference
 OR p->'nativeScope' IS DISTINCT FROM a.native_scope OR p->>'agreementHash' IS DISTINCT FROM a.agreement_sha256 OR p->'claims' IS DISTINCT FROM a.claims OR nullif(p->>'receiptId','') IS NULL
 OR isfinite(issued) IS NOT TRUE OR isfinite(expires) IS NOT TRUE OR expires<=issued OR issued>a.captured_at OR issued>at OR expires<=at OR issued<greatest(key.valid_from,rep.valid_from) OR expires>least(key.valid_to,rep.valid_to) THEN RETURN NULL;END IF;
 RETURN p;
 EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;
END$$;
CREATE FUNCTION public.ediel_archive_contract_original_source_v1(p_company_id uuid,p_actor_user_id uuid,p_contract_id uuid,p_environment text,p_kind text,p_submission jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE scope jsonb;pdf bytea;original bytea;packet jsonb;artifact gridex_contract_source_intake.artifacts%rowtype;missing text[]:=ARRAY[]::text[];
BEGIN
 PERFORM gridex_contract_source_intake.actor_v1(p_company_id,p_actor_user_id,'archive',p_kind);
 scope:=gridex_contract_source_intake.scope_v1(p_company_id,p_contract_id,p_environment,p_kind);
 PERFORM pg_advisory_xact_lock(hashtextextended('contract-original-intake:'||p_company_id::text||':'||p_contract_id::text,0));
 IF (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(p_submission)x) IS DISTINCT FROM ARRAY['agreementBase64','issuerKeyId','representationId','signatureHex','sourceBase64']::text[] THEN RAISE EXCEPTION 'contract_intake_exact_submission_required';END IF;
 pdf:=decode(p_submission->>'agreementBase64','base64');original:=decode(p_submission->>'sourceBase64','base64');packet:=convert_from(original,'UTF8')::jsonb;
 IF octet_length(pdf) NOT BETWEEN 1 AND 10485760 OR octet_length(original) NOT BETWEEN 1 AND 10485760 OR encode(sha256(pdf),'hex') IS DISTINCT FROM scope->>'agreementHash' OR jsonb_typeof(packet->'claims') IS DISTINCT FROM 'object'
 OR replace(encode(pdf,'base64'),E'\n','') IS DISTINCT FROM p_submission->>'agreementBase64' OR replace(encode(original,'base64'),E'\n','') IS DISTINCT FROM p_submission->>'sourceBase64' THEN RAISE EXCEPTION 'contract_intake_actual_immutable_original_bytes_required';END IF;
 SELECT * INTO artifact FROM gridex_contract_source_intake.artifacts WHERE company_id=p_company_id AND environment=p_environment AND kind=p_kind AND contract_id=p_contract_id AND source_sha256=encode(sha256(original),'hex') FOR UPDATE;
 IF artifact.id IS NULL THEN
  INSERT INTO gridex_contract_source_intake.artifacts(company_id,environment,kind,contract_id,contract_document_id,native_scope,claims,agreement_original,agreement_sha256,source_original,source_sha256,claims_hash,issuer_key_id,representation_id,signature_hex,submitted_by)
  VALUES(p_company_id,p_environment,p_kind,p_contract_id,(scope->>'contractDocumentId')::uuid,scope,packet->'claims',pdf,encode(sha256(pdf),'hex'),original,encode(sha256(original),'hex'),encode(sha256(convert_to((packet->'claims')::text,'UTF8')),'hex'),(p_submission->>'issuerKeyId')::uuid,(p_submission->>'representationId')::uuid,p_submission->>'signatureHex',p_actor_user_id) RETURNING * INTO artifact;
  INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'ediel_contract_source',artifact.id,'ediel.contract_original.archived',jsonb_build_object('kind',p_kind,'contractId',p_contract_id,'sourceHash',artifact.source_sha256,'agreementHash',artifact.agreement_sha256,'claimsHash',artifact.claims_hash));
 ELSE
  IF artifact.native_scope IS DISTINCT FROM scope OR artifact.agreement_sha256 IS DISTINCT FROM encode(sha256(pdf),'hex') OR artifact.issuer_key_id IS DISTINCT FROM(p_submission->>'issuerKeyId')::uuid OR artifact.representation_id IS DISTINCT FROM(p_submission->>'representationId')::uuid OR artifact.signature_hex IS DISTINCT FROM p_submission->>'signatureHex' THEN RAISE EXCEPTION 'contract_intake_idempotency_scope_conflict';END IF;
 END IF;
 IF gridex_contract_source_intake.receipt_v1(artifact) IS NULL THEN missing:=array_append(missing,'current_authentic_issuer_receipt_and_legal_representation');END IF;
 IF gridex_contract_source_intake.claims_valid_v1(artifact) IS NOT TRUE THEN missing:=array_append(missing,'exact_signed_native_domain_claims');END IF;
 PERFORM gridex_contract_source_intake.actor_v1(p_company_id,p_actor_user_id,'archive',p_kind);
 RETURN jsonb_build_object('status','archived','artifactId',artifact.id,'kind',artifact.kind,'sourceHash',artifact.source_sha256,'agreementHash',artifact.agreement_sha256,'claimsHash',artifact.claims_hash,'missing',missing||ARRAY['independent_current_source_review']);
END$$;
CREATE FUNCTION gridex_contract_source_intake.materialize_v1(a gridex_contract_source_intake.artifacts,actor uuid,at timestamptz) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE p jsonb:=a.claims;s jsonb:=a.native_scope;supply jsonb;row jsonb;k gridex_contract_source_intake.kinds%rowtype;
BEGIN
 IF a.kind='masterdata_declaration' THEN
  INSERT INTO gridex_customer_masterdata.signed_declarations(id,company_id,customer_id,environment,contract_id,contract_revision,contract_hash,agreement_original,agreement_sha256,valid_from,valid_to,customer_identity,end_user_masterdata,source_reference,source_version,source_original,source_sha256,approved_by,approved_at)
  VALUES(a.target_id,a.company_id,(s->>'customerId')::uuid,a.environment,a.contract_id,s->>'contractRevision',s->>'protectedContractHash',a.agreement_original,a.agreement_sha256,(p->>'validFrom')::timestamptz,(p->>'validTo')::timestamptz,p->'customerIdentity',p->'endUserMasterdata',p->>'sourceReference',p->>'sourceVersion',a.source_original,a.source_sha256,actor,at);
 ELSIF a.kind='contract_requested_method' THEN
  INSERT INTO gridex_metering_method_changes.contract_request_declarations(id,previous_declaration_id,company_id,environment,contract_id,contract_revision,protected_contract_hash,customer_id,site_id,metering_point_id,legal_actor_id,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,requested_method,agreement_original,agreement_sha256,source_reference,source_version,source_original,source_sha256,approved_by,approved_at)
  VALUES(a.target_id,(p->>'previousDeclarationId')::uuid,a.company_id,a.environment,a.contract_id,s->>'contractRevision',s->>'protectedContractHash',(s->>'customerId')::uuid,(s->>'siteId')::uuid,(s->>'meteringPointId')::uuid,(s->>'legalActorId')::uuid,s->>'legalSenderId',s->>'legalReceiverId',s->>'pointId',s->>'identityAgency',s->>'gridArea',p->>'requestedMethod',a.agreement_original,a.agreement_sha256,p->>'sourceReference',p->>'sourceVersion',a.source_original,a.source_sha256,actor,at);
 ELSIF a.kind='metering_method_event' THEN
  supply:=gridex_received_sources.supply_period_source_at_v1(a.company_id,(p->>'supplyPeriodId')::uuid,(p->>'effectiveAt')::timestamptz);
  INSERT INTO gridex_metering_method_changes.events(id,company_id,environment,supply_period_id,customer_id,metering_point_id,legal_actor_id,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,supply_source_message_id,supply_state_version,subtype,effective_at,contract_id,contract_revision,protected_contract_hash,agreement_original,agreement_sha256,source_reference,source_original,source_sha256,source_version,approved_by,approved_at,requested_method_declaration_id)
  VALUES(a.target_id,a.company_id,a.environment,(p->>'supplyPeriodId')::uuid,(s->>'customerId')::uuid,(s->>'meteringPointId')::uuid,(s->>'legalActorId')::uuid,s->>'legalSenderId',s->>'legalReceiverId',s->>'pointId',s->>'identityAgency',s->>'gridArea',(supply->>'sourceMessageId')::uuid,(supply->>'marketStateVersion')::bigint,p->>'subtype',(p->>'effectiveAt')::timestamptz,a.contract_id,s->>'contractRevision',s->>'protectedContractHash',a.agreement_original,a.agreement_sha256,p->>'sourceReference',a.source_original,a.source_sha256,p->>'sourceVersion',actor,at,(p->>'requestedMethodDeclarationId')::uuid);
 ELSIF a.kind='production_contract_event' THEN
  INSERT INTO gridex_received_sources.production_contract_events(id,company_id,environment,contract_id,customer_id,metering_point_id,legal_actor_id,dso_actor_id,dso_registry_version,dso_registry_sha256,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,event_kind,boundary_at,start_event_id,contract_reference,contract_revision,protected_contract_hash,source_reference,source_sha256,source_version,approved_by,approved_at)
  VALUES(a.target_id,a.company_id,a.environment,a.contract_id,(s->>'customerId')::uuid,(s->>'meteringPointId')::uuid,(s->>'legalActorId')::uuid,(s->'networkBasis'->>'networkActorId')::uuid,s->'networkBasis'->>'registryVersion',s->'networkBasis'->>'sourceSha256',s->>'legalSenderId',s->>'legalReceiverId',s->>'pointId',s->>'identityAgency',s->>'gridArea',p->>'eventKind',(p->>'boundaryAt')::timestamptz,(p->>'startEventId')::uuid,p->>'contractReference',s->>'contractRevision',s->>'protectedContractHash',p->>'sourceReference',a.source_sha256,p->>'sourceVersion',actor,at);
 ELSE RAISE EXCEPTION 'contract_intake_exact_native_kind_required';END IF;
 SELECT * INTO STRICT k FROM gridex_contract_source_intake.kinds WHERE kind=a.kind;
 EXECUTE format('SELECT to_jsonb(r) FROM %I.%I r WHERE id=$1 AND company_id=$2',k.source_schema,k.source_table) INTO STRICT row USING a.target_id,a.company_id;
 RETURN encode(sha256(convert_to(row::text,'UTF8')),'hex');
END$$;
CREATE FUNCTION public.ediel_review_contract_original_source_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_review jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a gridex_contract_source_intake.artifacts%rowtype;r gridex_contract_source_intake.reviews%rowtype;q gridex_contract_source_intake.qualifications%rowtype;missing text[]:=ARRAY[]::text[];outcome text;row_hash text;scope jsonb;at timestamptz;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT * INTO a FROM gridex_contract_source_intake.artifacts WHERE id=p_artifact_id AND company_id=p_company_id;
 IF a.id IS NULL THEN RAISE EXCEPTION 'contract_intake_artifact_scope_required';END IF;
 PERFORM gridex_contract_source_intake.actor_v1(p_company_id,p_actor_user_id,'review',a.kind);
 PERFORM id FROM public.customer_contracts WHERE id=a.contract_id AND company_id=p_company_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended('contract-original-intake:'||p_company_id::text||':'||a.contract_id::text,0));
 SELECT * INTO STRICT a FROM gridex_contract_source_intake.artifacts WHERE id=p_artifact_id AND company_id=p_company_id FOR UPDATE;
 IF p_actor_user_id=a.submitted_by OR (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(p_review)x) IS DISTINCT FROM ARRAY['agreementHash','claimsHash','decision','reason','sourceHash']::text[] OR p_review->>'sourceHash' IS DISTINCT FROM a.source_sha256 OR p_review->>'agreementHash' IS DISTINCT FROM a.agreement_sha256 OR p_review->>'claimsHash' IS DISTINCT FROM a.claims_hash OR length(p_review->>'reason') NOT BETWEEN 1 AND 4000 OR (p_review->>'decision' IN('approve','hold','reject')) IS NOT TRUE THEN RAISE EXCEPTION 'contract_intake_independent_exact_hash_bound_review_required';END IF;
 SELECT * INTO q FROM gridex_contract_source_intake.qualifications WHERE artifact_id=a.id;
 IF q.artifact_id IS NOT NULL THEN
  IF p_review->>'decision'<>'approve' THEN RAISE EXCEPTION 'contract_intake_qualified_original_requires_explicit_revocation';END IF;
  IF gridex_contract_source_intake.current_v1(p_company_id,a.kind,a.target_id) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','artifactId',a.id,'kind',a.kind,'missing',ARRAY['current_qualified_contract_original']);END IF;
  RETURN jsonb_build_object('status','authorized','artifactId',a.id,'kind',a.kind,'sourceId',a.target_id,'replay',true);
 END IF;
 IF p_review->>'decision'='reject' THEN outcome:='rejected';missing:=ARRAY['independent_source_review_rejected'];
 ELSIF p_review->>'decision'='hold' THEN outcome:='held';missing:=ARRAY['independent_source_review_held'];
 ELSE
  BEGIN
   scope:=gridex_contract_source_intake.scope_v1(p_company_id,a.contract_id,a.environment,a.kind);
   IF scope IS DISTINCT FROM a.native_scope THEN missing:=array_append(missing,'current_exact_signed_contract_actor_network_scope');END IF;
   IF gridex_contract_source_intake.receipt_v1(a) IS NULL THEN missing:=array_append(missing,'current_authentic_issuer_receipt_and_legal_representation');END IF;
   IF gridex_contract_source_intake.claims_valid_v1(a) IS NOT TRUE THEN missing:=array_append(missing,'exact_signed_native_domain_claims');END IF;
   IF cardinality(missing)=0 THEN at:=clock_timestamp();row_hash:=gridex_contract_source_intake.materialize_v1(a,p_actor_user_id,at);END IF;
  EXCEPTION WHEN check_violation OR foreign_key_violation OR unique_violation OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN missing:=array_append(missing,'current_exact_native_domain_relation');END;
  outcome:=CASE WHEN cardinality(missing)=0 THEN 'approved' ELSE 'held' END;
 END IF;
 INSERT INTO gridex_contract_source_intake.reviews(artifact_id,company_id,actor_user_id,outcome,reason,missing) VALUES(a.id,p_company_id,p_actor_user_id,outcome,p_review->>'reason',to_jsonb(missing)) RETURNING * INTO r;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'ediel_contract_source',a.id,'ediel.contract_original.reviewed',jsonb_build_object('kind',a.kind,'sourceHash',a.source_sha256,'agreementHash',a.agreement_sha256,'claimsHash',a.claims_hash,'reviewId',r.id,'outcome',outcome,'missing',missing));
 IF outcome='approved' THEN
  INSERT INTO gridex_contract_source_intake.qualifications(artifact_id,target_id,review_id,company_id,kind,row_hash,approved_by,approved_at) VALUES(a.id,a.target_id,r.id,p_company_id,a.kind,row_hash,p_actor_user_id,at);
  IF gridex_contract_source_intake.current_v1(p_company_id,a.kind,a.target_id) IS NOT TRUE THEN RAISE EXCEPTION 'contract_intake_policy_changed_at_native_approval';END IF;
  RETURN jsonb_build_object('status','authorized','artifactId',a.id,'kind',a.kind,'sourceId',a.target_id,'replay',false);
 END IF;
 RETURN jsonb_build_object('status',outcome,'artifactId',a.id,'kind',a.kind,'missing',missing);
END$$;
CREATE FUNCTION gridex_contract_source_intake.current_v1(c uuid,k text,target uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a gridex_contract_source_intake.artifacts%rowtype;q gridex_contract_source_intake.qualifications%rowtype;r gridex_contract_source_intake.reviews%rowtype;scope jsonb;source jsonb;spec gridex_contract_source_intake.kinds%rowtype;
BEGIN
 PERFORM gridex_contract_source_intake.lock_graph_v1();SELECT * INTO q FROM gridex_contract_source_intake.qualifications WHERE target_id=target AND company_id=c AND kind=k FOR SHARE;
 IF q.artifact_id IS NULL THEN RETURN false;END IF;
 SELECT * INTO a FROM gridex_contract_source_intake.artifacts WHERE id=q.artifact_id AND company_id=c;IF a.id IS NULL THEN RETURN false;END IF;
 PERFORM id FROM public.customer_contracts WHERE id=a.contract_id AND company_id=c FOR SHARE;
 SELECT * INTO STRICT a FROM gridex_contract_source_intake.artifacts WHERE id=q.artifact_id AND company_id=c FOR SHARE;
 SELECT * INTO r FROM gridex_contract_source_intake.reviews WHERE id=q.review_id AND artifact_id=a.id AND company_id=c FOR SHARE;
 IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id IS DISTINCT FROM q.approved_by OR r.actor_user_id=a.submitted_by OR q.approved_at>clock_timestamp() THEN RETURN false;END IF;
 BEGIN
  PERFORM gridex_contract_source_intake.actor_v1(c,r.actor_user_id,'review',k,false);
  scope:=gridex_contract_source_intake.scope_v1(c,a.contract_id,a.environment,k);
 EXCEPTION WHEN insufficient_privilege OR raise_exception THEN RETURN false;END;
 IF scope IS DISTINCT FROM a.native_scope OR gridex_contract_source_intake.receipt_v1(a) IS NULL OR gridex_contract_source_intake.claims_valid_v1(a) IS NOT TRUE OR gridex_ediel_retention.protected_copy_current_v1(c,a.id) IS NOT TRUE THEN RETURN false;END IF;
 SELECT * INTO STRICT spec FROM gridex_contract_source_intake.kinds WHERE kind=k;
 EXECUTE format('SELECT to_jsonb(r) FROM %I.%I r WHERE id=$1 AND company_id=$2 FOR SHARE',spec.source_schema,spec.source_table) INTO source USING target,c;
 RETURN source IS NOT NULL AND encode(sha256(convert_to(source::text,'UTF8')),'hex')=q.row_hash;
END$$;
CREATE FUNCTION public.ediel_read_contract_original_source_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a gridex_contract_source_intake.artifacts%rowtype;q gridex_contract_source_intake.qualifications%rowtype;r gridex_contract_source_intake.reviews%rowtype;current boolean:=false;
BEGIN
 SELECT * INTO a FROM gridex_contract_source_intake.artifacts WHERE id=p_artifact_id AND company_id=p_company_id;IF a.id IS NULL THEN RAISE EXCEPTION 'contract_intake_artifact_scope_required';END IF;
 PERFORM gridex_contract_source_intake.actor_v1(p_company_id,p_actor_user_id,'read',a.kind);
 SELECT * INTO q FROM gridex_contract_source_intake.qualifications WHERE artifact_id=a.id;
 SELECT * INTO r FROM gridex_contract_source_intake.reviews WHERE artifact_id=a.id ORDER BY reviewed_at DESC,id DESC LIMIT 1;
 IF q.artifact_id IS NOT NULL THEN current:=gridex_contract_source_intake.current_v1(p_company_id,a.kind,q.target_id);END IF;
 RETURN jsonb_build_object('status',CASE WHEN current THEN 'authorized' WHEN q.artifact_id IS NOT NULL THEN 'held' WHEN r.outcome='rejected' THEN 'rejected' WHEN r.id IS NOT NULL THEN 'held' ELSE 'archived' END,'artifactId',a.id,'kind',a.kind,'contractId',a.contract_id,'environment',a.environment,'sourceHash',a.source_sha256,'agreementHash',a.agreement_sha256,'claimsHash',a.claims_hash,'nativeScope',a.native_scope,'claims',a.claims,'submittedBy',a.submitted_by,'capturedAt',a.captured_at,'sourceId',CASE WHEN current THEN q.target_id ELSE NULL END,'missing',CASE WHEN current THEN '[]'::jsonb WHEN q.artifact_id IS NOT NULL THEN '["current_qualified_contract_original"]'::jsonb ELSE coalesce(r.missing,'["independent_current_source_review"]'::jsonb) END);
END$$;
CREATE FUNCTION public.ediel_list_contract_original_sources_v1(p_company_id uuid,p_actor_user_id uuid,p_contract_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$DECLARE row record;items jsonb:='[]'::jsonb;BEGIN
 -- Authorize even an empty list; selectors are never an authorization assertion.
 PERFORM gridex_contract_source_intake.actor_v1(p_company_id,p_actor_user_id,'read','masterdata_declaration');
 IF NOT EXISTS(SELECT FROM public.customer_contracts WHERE id=p_contract_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'contract_intake_contract_scope_required';END IF;
 FOR row IN SELECT id FROM gridex_contract_source_intake.artifacts WHERE company_id=p_company_id AND contract_id=p_contract_id ORDER BY captured_at DESC,id DESC LIMIT 100 LOOP items:=items||jsonb_build_array(public.ediel_read_contract_original_source_v1(p_company_id,p_actor_user_id,row.id));END LOOP;RETURN items;
END$$;
-- Preserve all original consumer rules and add current source qualification at
-- their common native execution boundary, including resend/recovery paths.
DO $$DECLARE f record;definition text;body text;signature text;helper text;BEGIN
 FOR signature IN SELECT unnest(ARRAY['gridex_ediel_retention.contract_copy_source_current_v1(uuid,text,text,uuid)','gridex_received_sources.production_contract_source_for_execution_v1(uuid,uuid,uuid,text)']) LOOP
  SELECT p.oid,p.proowner,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=signature::regprocedure;
  IF signature LIKE 'gridex_ediel_retention.%' THEN
   helper:='gridex_ediel_retention.contract_copy_source_before_intake_v1';
   definition:=replace(f.definition,'FUNCTION gridex_ediel_retention.contract_copy_source_current_v1(', 'FUNCTION '||helper||'(');
   body:='DECLARE k text;BEGIN
    IF gridex_ediel_retention.contract_copy_source_before_intake_v1(c,ns,tab,target) IS NOT TRUE THEN RETURN false;END IF;
    SELECT kind INTO k FROM gridex_contract_source_intake.kinds WHERE source_schema=ns AND source_table=tab;
    RETURN NOT EXISTS(SELECT FROM gridex_contract_source_intake.qualifications WHERE target_id=target) OR gridex_contract_source_intake.current_v1(c,k,target);
   END';
  ELSE
   helper:='gridex_received_sources.production_contract_source_before_intake_v1';
   definition:=replace(f.definition,'FUNCTION gridex_received_sources.production_contract_source_for_execution_v1(', 'FUNCTION '||helper||'(');
   body:='DECLARE basis jsonb;BEGIN
    basis:=gridex_received_sources.production_contract_source_before_intake_v1(p_company_id,p_event_id,p_actor_user_id,p_permission);
    IF basis->>''status''=''authorized'' AND EXISTS(SELECT FROM gridex_contract_source_intake.qualifications WHERE target_id=p_event_id) AND gridex_contract_source_intake.current_v1(p_company_id,''production_contract_event'',p_event_id) IS NOT TRUE THEN RETURN jsonb_build_object(''status'',''held'',''missing'',ARRAY[''current_qualified_production_contract_original'']);END IF;RETURN basis;
   END';
  END IF;
  IF definition=f.definition OR f.definition NOT LIKE '%LANGUAGE plpgsql%' THEN RAISE EXCEPTION 'contract_intake_native_owner_adapter_review_required';END IF;
  EXECUTE definition;EXECUTE format('ALTER FUNCTION %s(%s) OWNER TO %I',helper,pg_get_function_identity_arguments(f.oid),pg_get_userbyid(f.proowner));
  EXECUTE replace(f.definition,f.prosrc,body);
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'contract_intake_native_owner_metadata_changed';END IF;
 END LOOP;
END$$;
-- Immutable intake originals participate in the existing independently approved
-- original-byte retention policy. No default legal period or approval is seeded.
GRANT USAGE ON SCHEMA gridex_contract_source_intake TO gridex_ediel_retention_owner;
GRANT SELECT,UPDATE ON gridex_contract_source_intake.artifacts TO gridex_ediel_retention_owner;
GRANT SELECT ON gridex_contract_source_intake.kinds,gridex_contract_source_intake.qualifications TO gridex_ediel_retention_owner;
CREATE VIEW gridex_ediel_retention.contract_intake_agreement_originals WITH(security_barrier=true) AS SELECT a.id,a.company_id,a.agreement_original document_bytes,a.agreement_sha256 document_hash,NULL::bigint document_byte_length,NULL::timestamptz document_purged_at,to_jsonb(a)-ARRAY['agreement_original','source_original'] source_metadata FROM gridex_contract_source_intake.artifacts a;
CREATE VIEW gridex_ediel_retention.contract_intake_source_originals WITH(security_barrier=true) AS SELECT a.id,a.company_id,a.source_original document_bytes,a.source_sha256 document_hash,NULL::bigint document_byte_length,NULL::timestamptz document_purged_at,to_jsonb(a)-ARRAY['agreement_original','source_original'] source_metadata FROM gridex_contract_source_intake.artifacts a;
ALTER VIEW gridex_ediel_retention.contract_intake_agreement_originals OWNER TO gridex_ediel_retention_owner;
ALTER VIEW gridex_ediel_retention.contract_intake_source_originals OWNER TO gridex_ediel_retention_owner;
REVOKE ALL ON gridex_ediel_retention.contract_intake_agreement_originals,gridex_ediel_retention.contract_intake_source_originals FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO gridex_ediel_retention.decision_evidence_catalog VALUES
 ('contract_intake_agreement_original_bytes','contract_intake_agreement_originals','ediel.retention.record_decision_evidence','protected_copy_revocations','target_id','protected_copy_current_v1'),
 ('contract_intake_source_original_bytes','contract_intake_source_originals','ediel.retention.record_decision_evidence','protected_copy_revocations','target_id','protected_copy_current_v1');
INSERT INTO gridex_ediel_retention.protected_copy_specs VALUES
 ('contract_intake_agreement_original_bytes','contract_intake_agreement_originals','gridex_contract_source_intake','artifacts','agreement_original','agreement_sha256'),
 ('contract_intake_source_original_bytes','contract_intake_source_originals','gridex_contract_source_intake','artifacts','source_original','source_sha256');
CREATE FUNCTION gridex_contract_source_intake.original_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$BEGIN
 IF TG_OP='UPDATE' AND(gridex_ediel_retention.protected_copy_transition_v1('contract_intake_agreement_original_bytes',to_jsonb(OLD),to_jsonb(NEW)) IS TRUE OR gridex_ediel_retention.protected_copy_transition_v1('contract_intake_source_original_bytes',to_jsonb(OLD),to_jsonb(NEW)) IS TRUE) THEN RETURN NEW;END IF;RAISE EXCEPTION 'contract_intake_original_is_immutable';END$$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_contract_source_intake.artifacts FOR EACH ROW EXECUTE FUNCTION gridex_contract_source_intake.original_guard_v1();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON gridex_contract_source_intake.artifacts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER protected_copy_insert BEFORE INSERT ON gridex_contract_source_intake.artifacts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.protected_copy_insert_v1();
CREATE TRIGGER protected_copy_view_update INSTEAD OF UPDATE ON gridex_ediel_retention.contract_intake_agreement_originals FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.protected_copy_view_update_v1();
CREATE TRIGGER protected_copy_view_update INSTEAD OF UPDATE ON gridex_ediel_retention.contract_intake_source_originals FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.protected_copy_view_update_v1();
DO $$DECLARE f record;body text;needle text;BEGIN
 SELECT oid,to_jsonb(p)-'prosrc' metadata,prosrc,pg_get_functiondef(oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_ediel_retention.protected_copy_row_v1(uuid,text,uuid)'::regprocedure;
 needle:=' ELSE'||chr(10)||'  PERFORM id FROM gridex_customer_life_events.certification_classifications';
 IF position(needle IN f.prosrc)=0 THEN RAISE EXCEPTION 'contract_intake_retention_lock_adapter_review_required';END IF;
 body:=replace(f.prosrc,needle,' ELSIF spec.source_schema=''gridex_contract_source_intake'' THEN
  PERFORM gridex_contract_source_intake.lock_graph_v1();
  SELECT contract_id INTO ct FROM gridex_contract_source_intake.artifacts WHERE id=target AND company_id=c;
  PERFORM id FROM public.customer_contracts WHERE id=ct AND company_id=c FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION ''decision_evidence_original_scope_required'';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(''contract-original-intake:''||c::text||'':''||ct::text,0));PERFORM id FROM gridex_contract_source_intake.artifacts WHERE id=target AND company_id=c FOR UPDATE;
'||needle);
 EXECUTE replace(f.definition,f.prosrc,body);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'contract_intake_retention_metadata_changed';END IF;
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_contract_source_intake FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_ediel_retention.contract_copy_source_before_intake_v1(uuid,text,text,uuid),gridex_received_sources.production_contract_source_before_intake_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_contract_source_intake.lock_graph_v1(),gridex_contract_source_intake.current_v1(uuid,text,uuid) TO gridex_ediel_retention_owner;
REVOKE ALL ON FUNCTION public.ediel_contract_intake_scope_v1(uuid,uuid,uuid,text,text),public.ediel_archive_contract_original_source_v1(uuid,uuid,uuid,text,text,jsonb),public.ediel_review_contract_original_source_v1(uuid,uuid,uuid,jsonb),public.ediel_read_contract_original_source_v1(uuid,uuid,uuid),public.ediel_list_contract_original_sources_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_contract_intake_scope_v1(uuid,uuid,uuid,text,text),public.ediel_archive_contract_original_source_v1(uuid,uuid,uuid,text,text,jsonb),public.ediel_review_contract_original_source_v1(uuid,uuid,uuid,jsonb),public.ediel_read_contract_original_source_v1(uuid,uuid,uuid),public.ediel_list_contract_original_sources_v1(uuid,uuid,uuid) TO authenticated;
COMMIT;
