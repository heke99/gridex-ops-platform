-- Supabase CLI 2.118.0. Prospective source custody and separated, scoped ESCO
-- evidence review. No issuer keys, representations, reviewer grants or legal
-- approvals are seeded. Missing external authority remains held.
BEGIN;
CREATE SCHEMA gridex_ediel_services;
REVOKE ALL ON SCHEMA gridex_ediel_services FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.permissions(key,name,description,category)
VALUES('ediel.service_evidence.review','Granska egna Ediel-tjänstbevis','Separat bolagsbunden granskning av arkiverade och issuer-autentiserade tjänstbevis.','Ediel') ON CONFLICT(key) DO NOTHING;
CREATE TABLE gridex_ediel_services.artifacts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 assignment_id uuid NOT NULL,scope_basis_version bigint NOT NULL,scope jsonb NOT NULL,scope_hash text NOT NULL CHECK(scope_hash~'^[a-f0-9]{64}$'),
 evidence_kind text NOT NULL CHECK(evidence_kind IN('end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles','transport_mandate')),
 transport_relation_id uuid,transport_actor_id uuid,evidence_terms jsonb NOT NULL CHECK(jsonb_typeof(evidence_terms)='object'),source_bytes bytea NOT NULL CHECK(octet_length(source_bytes) BETWEEN 1 AND 8388608),
 source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),mime_type text NOT NULL CHECK(mime_type='application/pdf'),source_reference text NOT NULL,source_version text NOT NULL,
 issuer_receipt jsonb,submitted_by uuid NOT NULL REFERENCES auth.users(id),archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(company_id,assignment_id) REFERENCES public.ediel_service_assignments(company_id,id),
 UNIQUE(company_id,environment,assignment_id,scope_basis_version,evidence_kind,source_hash,source_reference,source_version)
);
CREATE TABLE gridex_ediel_services.issuer_keys(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 issuer_code text NOT NULL,legal_issuer_reference text NOT NULL,legal_authority_source_hash text NOT NULL CHECK(legal_authority_source_hash~'^[a-f0-9]{64}$'),
 receipt_signing_key bytea NOT NULL CHECK(octet_length(receipt_signing_key)>=32),valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(valid_to>valid_from)
);
CREATE TABLE gridex_ediel_services.issuer_representations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 issuer_key_id uuid NOT NULL REFERENCES gridex_ediel_services.issuer_keys(id),legal_actor_id uuid NOT NULL REFERENCES public.platform_market_actors(id),
 beneficiary_company_id uuid NOT NULL REFERENCES public.companies(id),customer_id uuid NOT NULL,dso_actor_id uuid NOT NULL REFERENCES public.platform_market_actors(id),
 evidence_kind text NOT NULL CHECK(evidence_kind IN('end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles','transport_mandate')),
 scope_hash text NOT NULL CHECK(scope_hash~'^[a-f0-9]{64}$'),transport_relation_id uuid,transport_actor_id uuid,
 legal_representation_reference text NOT NULL,legal_authority_source_hash text NOT NULL CHECK(legal_authority_source_hash~'^[a-f0-9]{64}$'),
 valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(valid_to>valid_from)
);
CREATE TABLE gridex_ediel_services.issuer_revocations(
 target_kind text NOT NULL CHECK(target_kind IN('key','representation')),target_id uuid NOT NULL,source_reference text NOT NULL,
 source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(target_kind,target_id)
);
CREATE TABLE gridex_ediel_services.reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),artifact_id uuid NOT NULL REFERENCES gridex_ediel_services.artifacts(id),
 evidence_id uuid NOT NULL REFERENCES public.ediel_service_evidence(id),stage_command_id uuid NOT NULL REFERENCES gridex_service_administration.commands(command_id),
 scope_basis_version bigint NOT NULL,evidence_basis jsonb NOT NULL,reviewer_user_id uuid NOT NULL REFERENCES auth.users(id),
 review_sequence bigint NOT NULL CHECK(review_sequence>0),decision text NOT NULL CHECK(decision IN('approved','held','rejected')),reason text NOT NULL,missing jsonb NOT NULL,
 reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(evidence_id,review_sequence)
);
CREATE FUNCTION gridex_ediel_services.immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $$ BEGIN RAISE EXCEPTION 'ediel_service_evidence_original_immutable';END $$;
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['artifacts','issuer_keys','issuer_representations','issuer_revocations','reviews'] LOOP
 EXECUTE format('ALTER TABLE gridex_ediel_services.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_ediel_services.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_ediel_services.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gridex_ediel_services.%I FOR EACH ROW EXECUTE FUNCTION gridex_ediel_services.immutable_v1()',t||'_immutable',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gridex_ediel_services.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_ediel_services.immutable_v1()',t||'_no_truncate',t);
 END LOOP;END $$;
CREATE FUNCTION gridex_ediel_services.lock_evidence_graph_v1() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$ BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 LOCK TABLE gridex_service_administration.commands,gridex_ediel_services.artifacts,gridex_ediel_services.issuer_keys,
 gridex_ediel_services.issuer_representations,gridex_ediel_services.issuer_revocations,gridex_ediel_services.reviews IN SHARE MODE;
END $$;
-- A revocation is immutable and serializes with the whole qualified graph,
-- including phantom revocations not present when a producer began reading.
CREATE FUNCTION gridex_ediel_services.revocation_lock_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $$ BEGIN
 PERFORM gridex_ediel_services.lock_evidence_graph_v1();
 IF NEW.target_kind='key' THEN PERFORM id FROM gridex_ediel_services.issuer_keys WHERE id=NEW.target_id FOR UPDATE;
 ELSE PERFORM id FROM gridex_ediel_services.issuer_representations WHERE id=NEW.target_id FOR UPDATE;END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_service_issuer_revocation_target_required';END IF;RETURN NEW;END $$;
CREATE TRIGGER service_issuer_revocation_lock BEFORE INSERT ON gridex_ediel_services.issuer_revocations FOR EACH ROW EXECUTE FUNCTION gridex_ediel_services.revocation_lock_v1();
CREATE FUNCTION gridex_ediel_services.receipt_hmac_sha256_v1(payload bytea,key bytea) RETURNS bytea LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE block bytea;inner_pad bytea:=decode(repeat('00',64),'hex');outer_pad bytea:=decode(repeat('00',64),'hex');n int;
BEGIN block:=CASE WHEN octet_length(key)>64 THEN sha256(key) ELSE key END;block:=block||decode(repeat('00',64-octet_length(block)),'hex');
 FOR n IN 0..63 LOOP inner_pad:=set_byte(inner_pad,n,get_byte(block,n)#54);outer_pad:=set_byte(outer_pad,n,get_byte(block,n)#92);END LOOP;
 RETURN sha256(outer_pad||sha256(inner_pad||payload));END $$;
CREATE FUNCTION gridex_ediel_services.scoped_review_permission_v1(c uuid,actor uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$ BEGIN
 -- The native resolver handles current denies; the explicit scoped grant below
 -- additionally prevents platform/global administrator inheritance.
 RETURN public.gridex_actor_has_company_permission(actor,c,'ediel.service_evidence.review') IS TRUE AND (
 EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key
  WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND u.effect='allow' AND p.is_active AND p.key='ediel.service_evidence.review')
 OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key
  WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='allow' AND p.is_active AND p.key='ediel.service_evidence.review'));
END $$;
CREATE FUNCTION gridex_ediel_services.actor_current_v1(c uuid,actor uuid,review boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$ BEGIN
 PERFORM gridex_ediel_services.lock_evidence_graph_v1();
 RETURN c IS NOT NULL AND actor IS NOT NULL AND EXISTS(SELECT FROM public.companies x WHERE x.id=c AND x.status='active')
 AND EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
 AND EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
 AND CASE WHEN review THEN gridex_ediel_services.scoped_review_permission_v1(c,actor) ELSE public.gridex_actor_has_company_permission(actor,c,'metering.write') END IS TRUE;
END $$;
CREATE FUNCTION gridex_ediel_services.evidence_basis_v1(e public.ediel_service_evidence) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT to_jsonb(e)-ARRAY['status','approved_by','approved_at','approved_assignment_version']
$$;
CREATE FUNCTION gridex_ediel_services.evidence_terms_v1(e public.ediel_service_evidence) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT jsonb_build_object('valid_from',e.valid_from,'valid_to',e.valid_to,'permission_purpose_code',e.permission_purpose_code,'permission_reporting_frequency',e.permission_reporting_frequency,'permission_request_grid_area',e.permission_request_grid_area,'permission_reporting_term_kind',e.permission_reporting_term_kind,'permission_customer_classification',e.permission_customer_classification,'permission_termination_reason',e.permission_termination_reason,'permission_termination_at',e.permission_termination_at)
$$;
CREATE FUNCTION gridex_ediel_services.receipt_current_v1(a gridex_ediel_services.artifacts) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE k gridex_ediel_services.issuer_keys%rowtype;r gridex_ediel_services.issuer_representations%rowtype;payload jsonb;raw bytea;sig jsonb:=a.issuer_receipt;issued timestamptz;expires timestamptz;
BEGIN
 PERFORM gridex_ediel_services.lock_evidence_graph_v1();
 IF sig IS NULL OR jsonb_typeof(sig) IS DISTINCT FROM 'object' OR coalesce(sig->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(sig->>'payloadBase64','')) NOT BETWEEN 1 AND 65536
 OR a.source_hash IS DISTINCT FROM encode(sha256(a.source_bytes),'hex') OR a.scope_hash IS DISTINCT FROM encode(sha256(convert_to(a.scope::text,'UTF8')),'hex') THEN RETURN false;END IF;
 SELECT * INTO k FROM gridex_ediel_services.issuer_keys WHERE id=(sig->>'keyId')::uuid AND company_id=a.company_id AND environment=a.environment;
 SELECT * INTO r FROM gridex_ediel_services.issuer_representations WHERE id=(sig->>'representationId')::uuid AND issuer_key_id=k.id AND company_id=a.company_id AND environment=a.environment
 AND legal_actor_id::text=a.scope->>'providerActorId' AND beneficiary_company_id::text=a.scope->>'beneficiaryCompanyId' AND customer_id::text=a.scope->>'customerId' AND dso_actor_id::text=a.scope->>'dsoActorId'
 AND evidence_kind=a.evidence_kind AND scope_hash=a.scope_hash AND transport_relation_id IS NOT DISTINCT FROM a.transport_relation_id AND transport_actor_id IS NOT DISTINCT FROM a.transport_actor_id;
 IF k.id IS NULL OR r.id IS NULL OR now()<k.valid_from OR now()>=k.valid_to OR now()<r.valid_from OR now()>=r.valid_to
 OR EXISTS(SELECT FROM gridex_ediel_services.issuer_revocations x WHERE x.target_kind='key' AND x.target_id=k.id OR x.target_kind='representation' AND x.target_id=r.id) THEN RETURN false;END IF;
 raw:=decode(sig->>'payloadBase64','base64');IF sha256(gridex_ediel_services.receipt_hmac_sha256_v1(raw,k.receipt_signing_key)) IS DISTINCT FROM sha256(decode(sig->>'signatureHex','hex')) THEN RETURN false;END IF;
 payload:=convert_from(raw,'UTF8')::jsonb;issued:=(payload->>'issuedAt')::timestamptz;expires:=(payload->>'expiresAt')::timestamptz;
 RETURN (payload->>'format'='ediel_service_evidence_receipt_v1' AND payload->>'issuerCode'=k.issuer_code AND nullif(payload->>'receiptId','') IS NOT NULL
 AND payload->>'companyId'=a.company_id::text AND payload->>'environment'=a.environment AND payload->>'assignmentId'=a.assignment_id::text
 AND payload->>'scopeBasisVersion'=a.scope_basis_version::text AND payload->'scope'=a.scope AND payload->>'evidenceKind'=a.evidence_kind
 AND payload->'evidenceTerms'=a.evidence_terms AND payload->>'sourceHash'=a.source_hash AND payload->>'sourceReference'=a.source_reference AND payload->>'sourceVersion'=a.source_version
 AND payload->>'transportRelationId' IS NOT DISTINCT FROM a.transport_relation_id::text AND payload->>'transportActorId' IS NOT DISTINCT FROM a.transport_actor_id::text
 AND isfinite(issued) AND isfinite(expires) AND issued<=now() AND expires>now() AND issued>=greatest(k.valid_from,r.valid_from) AND expires<=least(k.valid_to,r.valid_to)) IS TRUE;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR invalid_datetime_format OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN false;
END $$;
CREATE FUNCTION gridex_ediel_services.review_current_v1(e public.ediel_service_evidence) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE v gridex_ediel_services.reviews%rowtype;archive gridex_ediel_services.artifacts%rowtype;a public.ediel_service_assignments%rowtype;stage gridex_service_administration.commands%rowtype;
BEGIN
 PERFORM gridex_ediel_services.lock_evidence_graph_v1();
 SELECT * INTO v FROM gridex_ediel_services.reviews WHERE company_id=e.company_id AND evidence_id=e.id ORDER BY review_sequence DESC LIMIT 1;
 IF v.id IS NULL OR v.decision<>'approved' OR v.reviewed_at>clock_timestamp() OR e.valid_from>now() OR (e.valid_to IS NOT NULL AND now()>=e.valid_to) OR gridex_ediel_services.actor_current_v1(e.company_id,v.reviewer_user_id,true) IS NOT TRUE
 OR e.status IS DISTINCT FROM 'verified' OR e.approved_by IS DISTINCT FROM v.reviewer_user_id OR e.approved_at IS DISTINCT FROM v.reviewed_at
 OR e.approved_assignment_version IS DISTINCT FROM v.scope_basis_version OR gridex_ediel_services.evidence_basis_v1(e) IS DISTINCT FROM v.evidence_basis THEN RETURN false;END IF;
 SELECT * INTO archive FROM gridex_ediel_services.artifacts WHERE id=v.artifact_id AND company_id=e.company_id;
 SELECT * INTO stage FROM gridex_service_administration.commands WHERE command_id=v.stage_command_id AND company_id=e.company_id AND input->>'action'='stage_evidence' AND result->>'evidenceId'=e.id::text;
 SELECT * INTO a FROM public.ediel_service_assignments WHERE company_id=e.company_id AND id=e.assignment_id;
 RETURN archive.id IS NOT NULL AND stage.command_id IS NOT NULL AND v.reviewer_user_id<>archive.submitted_by AND v.reviewer_user_id<>stage.actor_user_id
 AND archive.assignment_id=a.id AND archive.scope_basis_version=a.scope_basis_version AND v.scope_basis_version=a.scope_basis_version
 AND archive.scope IS NOT DISTINCT FROM gridex_service_administration.scope_v1(a) AND archive.evidence_kind=e.kind
 AND archive.source_hash=e.source_sha256 AND archive.source_reference=e.source_reference AND archive.source_version=e.source_version
 AND archive.evidence_terms IS NOT DISTINCT FROM gridex_ediel_services.evidence_terms_v1(e) AND archive.transport_relation_id IS NOT DISTINCT FROM e.transport_relation_id AND archive.transport_actor_id IS NOT DISTINCT FROM e.transport_actor_id
 AND gridex_ediel_services.receipt_current_v1(archive) IS TRUE;
END $$;
CREATE FUNCTION gridex_ediel_services.verified_evidence_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$ BEGIN
 IF NEW.status='verified' AND gridex_ediel_services.review_current_v1(NEW) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_service_evidence_native_review_required';END IF;RETURN NEW;
END $$;
CREATE TRIGGER ediel_service_verified_evidence_native_review BEFORE INSERT OR UPDATE ON public.ediel_service_evidence FOR EACH ROW EXECUTE FUNCTION gridex_ediel_services.verified_evidence_guard_v1();

CREATE FUNCTION public.ediel_archive_service_evidence_v1(p_company_id uuid,p_actor_user_id uuid,p_submission jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a public.ediel_service_assignments%rowtype;bytes bytea;archive gridex_ediel_services.artifacts%rowtype;terms_record public.ediel_service_evidence%rowtype;terms jsonb;v_scope jsonb;sh text;v_source_hash text;kind text;missing jsonb:='["separate_qualified_reviewer_required"]';
BEGIN
 IF gridex_ediel_services.actor_current_v1(p_company_id,p_actor_user_id,false) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_service_archive_actor_forbidden' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_submission) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_submission) x WHERE x NOT IN('assignmentId','scopeBasisVersion','kind','source','terms','issuerReceipt','transportRelationId','transportActorId'))
 OR jsonb_typeof(p_submission->'source') IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_submission->'source') x WHERE x NOT IN('bytesBase64','mimeType','reference','version')) THEN RAISE EXCEPTION 'ediel_service_archive_shape_invalid';END IF;
 IF jsonb_typeof(p_submission->'terms') IS DISTINCT FROM 'object' OR NOT(p_submission->'terms' ? 'valid_from' AND p_submission->'terms' ? 'valid_to') OR EXISTS(SELECT FROM jsonb_object_keys(p_submission->'terms') x WHERE x NOT IN('valid_from','valid_to','permission_purpose_code','permission_reporting_frequency','permission_request_grid_area','permission_reporting_term_kind','permission_customer_classification','permission_termination_reason','permission_termination_at')) THEN RAISE EXCEPTION 'ediel_service_archive_evidence_terms_required';END IF;
 terms_record:=jsonb_populate_record(NULL::public.ediel_service_evidence,p_submission->'terms');terms:=gridex_ediel_services.evidence_terms_v1(terms_record);
 IF terms_record.valid_from IS NULL OR NOT isfinite(terms_record.valid_from) OR (terms_record.valid_to IS NOT NULL AND (NOT isfinite(terms_record.valid_to) OR terms_record.valid_to<=terms_record.valid_from)) THEN RAISE EXCEPTION 'ediel_service_archive_evidence_terms_invalid';END IF;
 SELECT * INTO a FROM public.ediel_service_assignments WHERE company_id=p_company_id AND id=(p_submission->>'assignmentId')::uuid;
 IF a.id IS NULL OR a.scope_basis_version IS DISTINCT FROM (p_submission->>'scopeBasisVersion')::bigint OR a.scope_basis_version IS NULL THEN RAISE EXCEPTION 'ediel_service_archive_current_scope_required';END IF;
 v_scope:=gridex_service_administration.scope_v1(a);sh:=encode(sha256(convert_to(v_scope::text,'UTF8')),'hex');
 IF NOT EXISTS(SELECT FROM gridex_service_administration.scope_versions s WHERE s.company_id=a.company_id AND s.assignment_id=a.id AND s.scope_basis_version=a.scope_basis_version AND s.scope=v_scope) THEN RAISE EXCEPTION 'ediel_service_archive_authentic_scope_required';END IF;
 bytes:=decode(p_submission#>>'{source,bytesBase64}','base64');kind:=p_submission->>'kind';v_source_hash:=encode(sha256(bytes),'hex');
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
CREATE FUNCTION public.ediel_review_service_evidence_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_evidence_id uuid,p_review jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE archive gridex_ediel_services.artifacts%rowtype;e public.ediel_service_evidence%rowtype;a public.ediel_service_assignments%rowtype;stage gridex_service_administration.commands%rowtype;v gridex_ediel_services.reviews%rowtype;decision text;seq bigint;missing jsonb:='[]';
BEGIN
 IF gridex_ediel_services.actor_current_v1(p_company_id,p_actor_user_id,true) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_service_evidence_reviewer_forbidden' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_review) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_review) x WHERE x NOT IN('decision','reason','sourceHash','scopeHash')) OR (p_review->>'decision' IN('approve','hold','reject')) IS NOT TRUE OR nullif(btrim(p_review->>'reason'),'') IS NULL OR length(p_review->>'reason')>2000 THEN RAISE EXCEPTION 'ediel_service_evidence_review_shape_invalid';END IF;
 SELECT * INTO archive FROM gridex_ediel_services.artifacts WHERE id=p_artifact_id AND company_id=p_company_id;
 SELECT * INTO e FROM public.ediel_service_evidence WHERE id=p_evidence_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO a FROM public.ediel_service_assignments WHERE id=e.assignment_id AND company_id=p_company_id;
 SELECT * INTO stage FROM gridex_service_administration.commands WHERE company_id=p_company_id AND input->>'action'='stage_evidence' AND result->>'evidenceId'=e.id::text;
 IF archive.id IS NULL OR e.id IS NULL OR a.id IS NULL OR stage.command_id IS NULL OR p_actor_user_id=archive.submitted_by OR p_actor_user_id=stage.actor_user_id THEN RAISE EXCEPTION 'ediel_service_evidence_separate_owned_review_required';END IF;
 IF archive.source_hash IS DISTINCT FROM p_review->>'sourceHash' OR archive.scope_hash IS DISTINCT FROM p_review->>'scopeHash' THEN RAISE EXCEPTION 'ediel_service_evidence_review_actual_hash_required';END IF;
 IF archive.assignment_id IS DISTINCT FROM a.id OR archive.scope_basis_version IS DISTINCT FROM a.scope_basis_version OR archive.scope IS DISTINCT FROM gridex_service_administration.scope_v1(a)
 OR archive.evidence_kind IS DISTINCT FROM e.kind OR archive.source_hash IS DISTINCT FROM e.source_sha256 OR archive.source_reference IS DISTINCT FROM e.source_reference OR archive.source_version IS DISTINCT FROM e.source_version
 OR archive.evidence_terms IS DISTINCT FROM gridex_ediel_services.evidence_terms_v1(e) OR archive.transport_relation_id IS DISTINCT FROM e.transport_relation_id OR archive.transport_actor_id IS DISTINCT FROM e.transport_actor_id THEN missing:=missing||'"current_exact_assignment_evidence_scope"'::jsonb;END IF;
 IF gridex_ediel_services.receipt_current_v1(archive) IS NOT TRUE THEN missing:=missing||'"authentic_current_issuer_and_representation_receipt"'::jsonb;END IF;
 IF e.valid_from>now() OR (e.valid_to IS NOT NULL AND now()>=e.valid_to) THEN missing:=missing||'"current_evidence_validity_required"'::jsonb;END IF;
 decision:=CASE WHEN p_review->>'decision'='reject' THEN 'rejected' WHEN p_review->>'decision'='hold' OR jsonb_array_length(missing)>0 THEN 'held' ELSE 'approved' END;
 SELECT coalesce(max(review_sequence),0)+1 INTO seq FROM gridex_ediel_services.reviews WHERE company_id=p_company_id AND evidence_id=e.id;
 INSERT INTO gridex_ediel_services.reviews(company_id,artifact_id,evidence_id,stage_command_id,scope_basis_version,evidence_basis,reviewer_user_id,review_sequence,decision,reason,missing)
 VALUES(p_company_id,archive.id,e.id,stage.command_id,a.scope_basis_version,gridex_ediel_services.evidence_basis_v1(e),p_actor_user_id,seq,decision,p_review->>'reason',missing) RETURNING * INTO v;
 IF decision='approved' THEN UPDATE public.ediel_service_evidence SET status='verified',approved_by=p_actor_user_id,approved_at=v.reviewed_at,approved_assignment_version=a.scope_basis_version WHERE id=e.id AND company_id=p_company_id;END IF;
 RETURN jsonb_build_object('status',CASE decision WHEN 'approved' THEN 'verified' ELSE decision END,'companyId',p_company_id,'reviewId',v.id,'reviewSequence',v.review_sequence,'artifactId',archive.id,'evidenceId',e.id,'scopeBasisVersion',a.scope_basis_version,'missing',missing,'marketActivationGranted',false);
END $$;
CREATE FUNCTION public.ediel_read_service_evidence_archive_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_include_bytes boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a gridex_ediel_services.artifacts%rowtype;v gridex_ediel_services.reviews%rowtype;result jsonb;
BEGIN
 IF gridex_ediel_services.actor_current_v1(p_company_id,p_actor_user_id,true) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_service_evidence_reviewer_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO a FROM gridex_ediel_services.artifacts WHERE company_id=p_company_id AND id=p_artifact_id;
 IF a.id IS NULL THEN RAISE EXCEPTION 'ediel_service_evidence_owned_archive_required';END IF;
 SELECT * INTO v FROM gridex_ediel_services.reviews WHERE company_id=p_company_id AND artifact_id=a.id ORDER BY review_sequence DESC LIMIT 1;
 result:=jsonb_build_object('artifactId',a.id,'companyId',a.company_id,'assignmentId',a.assignment_id,'scopeBasisVersion',a.scope_basis_version,'kind',a.evidence_kind,'mimeType',a.mime_type,'sourceHash',a.source_hash,'sourceReference',a.source_reference,'sourceVersion',a.source_version,'scopeHash',a.scope_hash,'scope',a.scope,'evidenceTerms',a.evidence_terms,'byteLength',octet_length(a.source_bytes),'issuerCurrent',gridex_ediel_services.receipt_current_v1(a),'reviewStatus',coalesce(v.decision,'unreviewed'),'marketActivationGranted',false);
 IF p_include_bytes IS TRUE THEN result:=result||jsonb_build_object('bytesBase64',replace(encode(a.source_bytes,'base64'),E'\n',''));END IF;RETURN result;
END $$;

-- The actual Z14 transition stores the national mode S17/S18. Assignment
-- administration uses V/VH; compare through the exact national mapping while
-- keeping immutable source-current and legal sender/DSO qualification intact.
CREATE OR REPLACE FUNCTION gridex_service_administration.permission_matches_assignment_v1(a public.ediel_service_assignments,p public.metering_permissions) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sender text;receiver text;
BEGIN
 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=a.company_id AND i.environment=a.environment ORDER BY i.id FOR SHARE;
 PERFORM i.id FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id ORDER BY i.id FOR SHARE;
 IF (SELECT count(DISTINCT (i.actor_id,i.identifier_value)) FROM public.tenant_actor_identifiers i WHERE i.company_id=a.company_id AND i.environment=a.environment AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR i.valid_to>now()))<>1 OR (SELECT count(DISTINCT i.identifier_value) FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN ('edielid','ediel_id') AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date))<>1 THEN RETURN false;END IF;
 SELECT i.identifier_value INTO sender FROM public.tenant_actor_identifiers i WHERE i.company_id=a.company_id AND i.environment=a.environment AND i.actor_id=a.provider_actor_id AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR i.valid_to>now()) LIMIT 1;
 SELECT i.identifier_value INTO receiver FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN ('edielid','ediel_id') AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date) LIMIT 1;
 RETURN p.company_id=a.company_id AND p.customer_id=a.customer_id AND sender IS NOT NULL AND receiver IS NOT NULL AND p.grid_owner_ediel_id=receiver AND p.metadata#>>'{marketPermission,legalActor}'=sender AND p.metadata#>>'{marketPermission,dsoActor}'=receiver AND p.metadata#>>'{marketPermission,mode}'=CASE a.mode WHEN 'V' THEN 'S17' WHEN 'VH' THEN 'S18' END AND public.ediel_permission_source_is_current_v1(a.company_id,p.id,coalesce(p.inbound_z14_message_id,p.source_z14_message_id)) IS TRUE;
END $$;
-- Keep every existing current native ownership/profile/permission check from
-- 184042 in a private basis function, then
-- require prospective authentic private review. Legacy public verified flags
-- acquire no approval by being migrated.
CREATE FUNCTION gridex_ediel_services.assignment_assessment_basis_v1(p_provider_company_id uuid,p_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.ediel_service_assignments%rowtype; missing text[]:='{}'; k text; t timestamptz:=now(); transport_required boolean;
begin
 select * into a from public.ediel_service_assignments where company_id=p_provider_company_id and id=p_assignment_id for share;
 if not found then return jsonb_build_object('status','held','missing',array['assignment_not_found']); end if;
 if a.scope_basis_version is null or not exists(select from gridex_service_administration.scope_versions sv where sv.company_id=a.company_id and sv.assignment_id=a.id and sv.scope_basis_version=a.scope_basis_version and sv.scope=gridex_service_administration.scope_v1(a)) then return jsonb_build_object('status','held','missing',array['authentic_assignment_scope_journal_required']);end if;
 if a.status<>'active' or a.valid_from>t or (a.valid_to is not null and a.valid_to<=t) then missing:=array_append(missing,'assignment_not_active'); end if;
 perform 1 from public.tenant_ediel_profiles x where x.id=a.actor_profile_id and x.company_id=a.company_id for share;
 perform 1 from public.tenant_actor_roles r where r.company_id=a.company_id and r.actor_id=a.provider_actor_id and r.environment=a.environment for share;
 perform 1 from public.tenant_actor_identifiers i where i.company_id=a.company_id and i.environment=a.environment for share;
 perform 1 from public.tenant_counterparty_relations r where r.company_id=a.company_id and r.environment=a.environment and r.relation_type='ediel_transport_agent' for share;
 if not exists(select 1 from public.tenant_ediel_profiles x where x.id=a.actor_profile_id and x.company_id=a.company_id and x.environment=a.environment and x.market='electricity' and x.is_enabled and x.valid_from<=t and (x.valid_to is null or x.valid_to>t)) then missing:=array_append(missing,'provider_profile_not_current'); end if;
 if not exists(select 1 from public.tenant_actor_roles r where r.company_id=a.company_id and r.actor_id=a.provider_actor_id and r.environment=a.environment and r.role_code='energy_service_company' and r.valid_from<=t and (r.valid_to is null or r.valid_to>t)) then missing:=array_append(missing,'provider_legal_esco_role_missing'); end if;
 if not exists(select 1 from public.tenant_actor_identifiers i where i.company_id=a.company_id and i.actor_id=a.provider_actor_id and i.environment=a.environment and i.identifier_type='EdielId' and length(btrim(i.identifier_value))>0 and i.valid_from<=t and (i.valid_to is null or i.valid_to>t)) then missing:=array_append(missing,'provider_legal_identity_missing'); end if;
 -- Mirror the shared canonical tenant identity: one current legal actor/Ediel ID.
 if (select count(distinct (i.actor_id,i.identifier_value)) from public.tenant_actor_identifiers i where i.company_id=a.company_id and i.environment=a.environment and i.identifier_type='EdielId' and i.valid_from<=t and (i.valid_to is null or i.valid_to>t))<>1 then missing:=array_append(missing,'provider_legal_identity_ambiguous'); end if;
 select exists(select 1 from public.tenant_counterparty_relations r where r.company_id=a.company_id and r.environment=a.environment and r.relation_type='ediel_transport_agent' and r.is_enabled and r.counterparty_actor_id<>a.provider_actor_id and r.valid_from<=t and (r.valid_to is null or r.valid_to>t)) into transport_required;
 perform 1 from public.ediel_service_evidence e where e.company_id=a.company_id and e.assignment_id=a.id for share;
 foreach k in array array['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles'] loop
  if not exists(select 1 from public.ediel_service_evidence e where e.company_id=a.company_id and e.assignment_id=a.id and e.kind=k and e.status='verified' and e.approved_assignment_version=a.scope_basis_version and e.valid_from<=t and (e.valid_to is null or e.valid_to>t) and e.approved_at<=t) then missing:=array_append(missing,k); end if;
 end loop;
 if (select count(*) from public.tenant_counterparty_relations r where r.company_id=a.company_id and r.environment=a.environment and r.relation_type='ediel_transport_agent' and r.is_enabled and r.valid_from<=t and (r.valid_to is null or r.valid_to>t))>1 then missing:=array_append(missing,'provider_transport_relation_ambiguous'); end if;
 if transport_required and not exists(select 1 from public.ediel_service_evidence e join public.tenant_counterparty_relations r on r.id=e.transport_relation_id and r.counterparty_actor_id=e.transport_actor_id and r.company_id=a.company_id and r.environment=a.environment and r.relation_type='ediel_transport_agent' and r.is_enabled and r.valid_from<=t and (r.valid_to is null or r.valid_to>t) where e.company_id=a.company_id and e.assignment_id=a.id and e.kind='transport_mandate' and e.status='verified' and e.approved_assignment_version=a.scope_basis_version and e.valid_from<=t and (e.valid_to is null or e.valid_to>t) and e.approved_at<=t) then missing:=array_append(missing,'transport_mandate'); end if;
 if cardinality(missing)>0 then return jsonb_build_object('status','held','missing',missing); end if;
 return jsonb_build_object('status','authorized','providerCompanyId',a.company_id,'providerActorId',a.provider_actor_id,'beneficiaryCompanyId',a.beneficiary_company_id,'assignmentId',a.id,'assignmentVersion',a.version,'environment',a.environment,'customerId',a.customer_id,'dsoActorId',a.dso_actor_id,'mode',a.mode,'purpose',a.purpose);
end;
$$;
CREATE OR REPLACE FUNCTION public.ediel_service_assignment_assessment_v1(p_provider_company_id uuid,p_assignment_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE result jsonb;a public.ediel_service_assignments%rowtype;k text;missing text[]:=ARRAY[]::text[];
BEGIN
 PERFORM gridex_ediel_services.lock_evidence_graph_v1();result:=gridex_ediel_services.assignment_assessment_basis_v1(p_provider_company_id,p_assignment_id);
 IF result->>'status' IS DISTINCT FROM 'authorized' THEN RETURN result;END IF;
 SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=p_provider_company_id AND id=p_assignment_id;
 FOREACH k IN ARRAY ARRAY['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles'] LOOP
  IF NOT EXISTS(SELECT FROM public.ediel_service_evidence e WHERE e.company_id=a.company_id AND e.assignment_id=a.id AND e.kind=k AND gridex_ediel_services.review_current_v1(e) IS TRUE) THEN missing:=array_append(missing,'native_review:'||k);END IF;
 END LOOP;
 IF EXISTS(SELECT FROM public.tenant_counterparty_relations r WHERE r.company_id=a.company_id AND r.environment=a.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.counterparty_actor_id<>a.provider_actor_id AND r.valid_from<=now() AND (r.valid_to IS NULL OR now()<r.valid_to))
 AND NOT EXISTS(SELECT FROM public.ediel_service_evidence e JOIN public.tenant_counterparty_relations r ON r.id=e.transport_relation_id AND r.counterparty_actor_id=e.transport_actor_id AND r.company_id=a.company_id AND r.environment=a.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=now() AND (r.valid_to IS NULL OR now()<r.valid_to) WHERE e.company_id=a.company_id AND e.assignment_id=a.id AND e.kind='transport_mandate' AND gridex_ediel_services.review_current_v1(e) IS TRUE) THEN missing:=array_append(missing,'native_review:transport_mandate');END IF;
 IF cardinality(missing)>0 THEN RETURN jsonb_build_object('status','held','missing',missing);END IF;RETURN result;
END $$;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_services' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.name);END LOOP;END $$;
REVOKE ALL ON FUNCTION public.ediel_archive_service_evidence_v1(uuid,uuid,jsonb),public.ediel_review_service_evidence_v1(uuid,uuid,uuid,uuid,jsonb),public.ediel_read_service_evidence_archive_v1(uuid,uuid,uuid,boolean),public.ediel_service_assignment_assessment_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_archive_service_evidence_v1(uuid,uuid,jsonb),public.ediel_review_service_evidence_v1(uuid,uuid,uuid,uuid,jsonb),public.ediel_read_service_evidence_archive_v1(uuid,uuid,uuid,boolean),public.ediel_service_assignment_assessment_v1(uuid,uuid) TO service_role;
COMMIT;
