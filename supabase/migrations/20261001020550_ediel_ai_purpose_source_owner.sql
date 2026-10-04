-- Actual prospective legal/purpose document owner; no legal registry, decision,
-- source or grant is seeded. Only separately authenticated competence and an
-- independent current company reviewer can append a usable purpose decision.
BEGIN;
INSERT INTO public.permissions(key,name,category,is_active) VALUES('ediel.ai_purpose.review','Granska AI/BI-ändamålsunderlag','ediel',true) ON CONFLICT(key) DO NOTHING;
CREATE SCHEMA gridex_ai_purpose_sources;
REVOKE ALL ON SCHEMA gridex_ai_purpose_sources FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_ai_purpose_sources.artifacts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 claims jsonb NOT NULL,claims_hash text NOT NULL CHECK(claims_hash~'^[a-f0-9]{64}$'),source_bytes bytea NOT NULL CHECK(octet_length(source_bytes) BETWEEN 1 AND 8388608),source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),source_reference text NOT NULL,source_version text NOT NULL,issuer_receipt jsonb,submitted_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,environment,source_hash,claims_hash));
CREATE TABLE gridex_ai_purpose_sources.reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),artifact_id uuid NOT NULL REFERENCES gridex_ai_purpose_sources.artifacts(id),company_id uuid NOT NULL,reviewer_user_id uuid NOT NULL REFERENCES auth.users(id),decision text NOT NULL CHECK(decision IN('approved','held','rejected')),reason text NOT NULL,clause jsonb,missing jsonb NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_ai_purpose_sources.issuer_keys(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,environment text NOT NULL,list_type text NOT NULL CHECK(list_type IN('AI','BI')),purpose text NOT NULL CHECK(purpose IN('ediel_list_export','ediel_list_reconciliation')),registry_version text NOT NULL CHECK(length(registry_version)>0),legal_authority_reference text NOT NULL CHECK(length(legal_authority_reference)>0),legal_authority_hash text NOT NULL CHECK(legal_authority_hash~'^[a-f0-9]{64}$'),receipt_signing_key bytea NOT NULL CHECK(octet_length(receipt_signing_key)>=32),valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(valid_to>valid_from));
CREATE TABLE gridex_ai_purpose_sources.representations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,environment text NOT NULL,issuer_key_id uuid NOT NULL REFERENCES gridex_ai_purpose_sources.issuer_keys(id),legal_actor_id uuid NOT NULL,list_type text NOT NULL CHECK(list_type IN('AI','BI')),purpose text NOT NULL CHECK(purpose IN('ediel_list_export','ediel_list_reconciliation')),legal_authority_reference text NOT NULL CHECK(length(legal_authority_reference)>0),legal_authority_hash text NOT NULL CHECK(legal_authority_hash~'^[a-f0-9]{64}$'),valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(valid_to>valid_from));
CREATE TABLE gridex_ai_purpose_sources.origins(artifact_id uuid PRIMARY KEY REFERENCES gridex_ai_purpose_sources.artifacts(id),review_id uuid NOT NULL UNIQUE REFERENCES gridex_ai_purpose_sources.reviews(id),decision_id uuid NOT NULL UNIQUE REFERENCES gridex_ai_processing.decisions(id),company_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_ai_purpose_sources.revocations(target_kind text NOT NULL CHECK(target_kind IN('key','representation','artifact')),target_id uuid NOT NULL,source_reference text NOT NULL CHECK(length(source_reference)>0),source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(target_kind,target_id));
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['artifacts','reviews','issuer_keys','representations','origins','revocations'] LOOP
 EXECUTE format('ALTER TABLE gridex_ai_purpose_sources.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_ai_purpose_sources.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON gridex_ai_purpose_sources.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gridex_ai_purpose_sources.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_immutable',t);EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gridex_ai_purpose_sources.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_no_truncate',t);
END LOOP;END$$;
CREATE FUNCTION gridex_ai_purpose_sources.actor_v1(c uuid,actor uuid,mode text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 RETURN mode IN('archive','read','review') AND gridex_requested_changes.actor_v1(c,actor,CASE WHEN mode='review' THEN 'archive' ELSE mode END,'method_contract') IS TRUE
 AND (mode<>'review' OR gridex_requested_changes.scoped_permission_v1(c,actor,'ediel.ai_purpose.review') IS TRUE);
END$$;
CREATE FUNCTION gridex_ai_purpose_sources.legal_scope_v1(c uuid,env text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE company public.companies%rowtype;actor uuid;identifier text;n int;
BEGIN
 IF env IS NULL OR env NOT IN('test','production') THEN RAISE EXCEPTION 'ai_purpose_environment_required';END IF;
 SELECT * INTO company FROM public.companies WHERE id=c FOR SHARE;
 IF NOT FOUND OR coalesce(to_jsonb(company)->>'status','') IN('archived','suspended','deleted','pending_deletion') OR coalesce(to_jsonb(company)->>'is_active','true')<>'true' OR nullif(to_jsonb(company)->>'legal_name','') IS NULL OR nullif(to_jsonb(company)->>'org_number','') IS NULL THEN RAISE EXCEPTION 'ai_purpose_current_legal_company_required';END IF;
 PERFORM id FROM public.tenant_actor_identifiers WHERE company_id=c AND environment=env ORDER BY id FOR SHARE;PERFORM id FROM public.tenant_actor_roles WHERE company_id=c AND environment=env ORDER BY id FOR SHARE;PERFORM id FROM public.tenant_ediel_profiles WHERE company_id=c AND environment=env ORDER BY id FOR SHARE;
 SELECT count(*) INTO n FROM public.tenant_actor_identifiers WHERE company_id=c AND environment=env AND identifier_type='EdielId' AND valid_from<=now() AND (valid_to IS NULL OR valid_to>now());
 SELECT actor_id,identifier_value INTO actor,identifier FROM public.tenant_actor_identifiers WHERE company_id=c AND environment=env AND identifier_type='EdielId' AND valid_from<=now() AND (valid_to IS NULL OR valid_to>now()) ORDER BY id LIMIT 1;
 IF n<>1 OR identifier!~'^[0-9]{5}$' OR NOT EXISTS(SELECT FROM public.tenant_actor_roles WHERE company_id=c AND environment=env AND actor_id=actor AND role_code='electricity_supplier' AND valid_from<=now() AND (valid_to IS NULL OR valid_to>now())) OR NOT EXISTS(SELECT FROM public.tenant_ediel_profiles WHERE company_id=c AND environment=env AND market='electricity' AND is_enabled AND valid_from<=now() AND (valid_to IS NULL OR valid_to>now())) THEN RAISE EXCEPTION 'ai_purpose_current_own_supplier_required';END IF;
 RETURN jsonb_build_object('companyId',c,'environment',env,'legalActorId',actor,'legalSupplierEdielId',identifier,'legalCompany',jsonb_build_object('name',to_jsonb(company)->>'legal_name','organizationNumber',to_jsonb(company)->>'org_number'),'sourceProfile',gridex_ai_processing.native_profile_v1());
END$$;
CREATE FUNCTION gridex_ai_purpose_sources.claims_v1(c uuid,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;from_at timestamptz;until_at timestamptz;retention_until date;days int;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (p->>'listType' IN('AI','BI')) IS NOT TRUE OR (p->>'purpose' IN('ediel_list_export','ediel_list_reconciliation')) IS NOT TRUE OR p->>'purpose'='ediel_list_export' AND p->>'listType'<>'AI' OR length(coalesce(btrim(p->>'gdprBasis'),'')) NOT BETWEEN 1 AND 2000 OR coalesce(p->>'retentionDays','')!~'^[0-9]{1,8}$' OR coalesce(p->>'retentionUntil','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'ai_purpose_claims_required';END IF;
 from_at:=(p->>'validFrom')::timestamptz;until_at:=(p->>'validUntil')::timestamptz;retention_until:=(p->>'retentionUntil')::date;days:=(p->>'retentionDays')::integer;
 IF from_at IS NULL OR until_at IS NULL OR NOT isfinite(from_at) OR NOT isfinite(until_at) OR from_at>=until_at OR until_at<=now() OR days<1 OR retention_until<current_date OR retention_until<(until_at AT TIME ZONE 'UTC')::date THEN RAISE EXCEPTION 'ai_purpose_validity_retention_required';END IF;
 result:=gridex_ai_purpose_sources.legal_scope_v1(c,p->>'environment');
 RETURN result||jsonb_build_object('listType',p->>'listType','purpose',p->>'purpose','gdprBasis',p->>'gdprBasis','retentionDays',days,'retentionUntil',retention_until,'validFrom',from_at,'validUntil',until_at,'retentionClass','ai_bi_personal_source_for_exact_purpose');
END$$;
CREATE FUNCTION gridex_ai_purpose_sources.receipt_current_v1(a gridex_ai_purpose_sources.artifacts) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k gridex_ai_purpose_sources.issuer_keys%rowtype;g gridex_ai_purpose_sources.representations%rowtype;r jsonb:=a.issuer_receipt;raw bytea;p jsonb;issued timestamptz;expires timestamptz;
BEGIN
 IF r IS NULL OR jsonb_typeof(r)<>'object' OR coalesce(r->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(r->>'payloadBase64','')) NOT BETWEEN 1 AND 65536 THEN RETURN NULL;END IF;
 SELECT * INTO k FROM gridex_ai_purpose_sources.issuer_keys WHERE id=(r->>'keyId')::uuid AND company_id=a.company_id AND environment=a.environment AND list_type=a.claims->>'listType' AND purpose=a.claims->>'purpose' FOR SHARE;
 SELECT * INTO g FROM gridex_ai_purpose_sources.representations WHERE id=(r->>'representationId')::uuid AND company_id=a.company_id AND environment=a.environment AND issuer_key_id=k.id AND legal_actor_id=(a.claims->>'legalActorId')::uuid AND list_type=a.claims->>'listType' AND purpose=a.claims->>'purpose' FOR SHARE;
 IF k.id IS NULL OR g.id IS NULL OR now()<k.valid_from OR now()>=k.valid_to OR now()<g.valid_from OR now()>=g.valid_to OR EXISTS(SELECT FROM gridex_ai_purpose_sources.revocations WHERE target_kind='key' AND target_id=k.id OR target_kind='representation' AND target_id=g.id OR target_kind='artifact' AND target_id=a.id) THEN RETURN NULL;END IF;
 raw:=decode(r->>'payloadBase64','base64');IF sha256(gridex_requested_changes.receipt_hmac_sha256_v1(raw,k.receipt_signing_key)) IS DISTINCT FROM sha256(decode(r->>'signatureHex','hex')) THEN RETURN NULL;END IF;
 p:=convert_from(raw,'UTF8')::jsonb;issued:=(p->>'issuedAt')::timestamptz;expires:=(p->>'expiresAt')::timestamptz;
 IF p->>'format' IS DISTINCT FROM 'ediel_ai_purpose_receipt_v1' OR nullif(p->>'receiptId','') IS NULL OR p->'claims' IS DISTINCT FROM a.claims OR p->>'sourceHash' IS DISTINCT FROM a.source_hash OR p->>'sourceReference' IS DISTINCT FROM a.source_reference OR p->>'sourceVersion' IS DISTINCT FROM a.source_version OR p->>'registryVersion' IS DISTINCT FROM k.registry_version OR jsonb_typeof(p->'clause') IS DISTINCT FROM 'object' OR nullif(p#>>'{clause,locator}','') IS NULL OR nullif(p#>>'{clause,quote}','') IS NULL OR position(convert_to(p#>>'{clause,quote}','UTF8') IN a.source_bytes)=0 OR issued IS NULL OR expires IS NULL OR NOT isfinite(issued) OR NOT isfinite(expires) OR issued>now() OR expires<=now() OR issued<greatest(k.valid_from,g.valid_from) OR expires>least(k.valid_to,g.valid_to) OR expires<(a.claims->>'validUntil')::timestamptz THEN RETURN NULL;END IF;
 RETURN p||jsonb_build_object('ownerRegistryId',k.id,'ownerRegistryVersion',k.registry_version);
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR invalid_datetime_format OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;
END$$;
CREATE FUNCTION gridex_ai_purpose_sources.current_v1(a gridex_ai_purpose_sources.artifacts) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_ai_purpose_sources.origins%rowtype;r gridex_ai_purpose_sources.reviews%rowtype;d gridex_ai_processing.decisions%rowtype;receipt jsonb;actual jsonb;
BEGIN
 SELECT * INTO o FROM gridex_ai_purpose_sources.origins WHERE artifact_id=a.id AND company_id=a.company_id FOR SHARE;SELECT * INTO r FROM gridex_ai_purpose_sources.reviews WHERE id=o.review_id AND artifact_id=a.id AND company_id=a.company_id FOR SHARE;SELECT * INTO d FROM gridex_ai_processing.decisions WHERE id=o.decision_id AND company_id=a.company_id FOR SHARE;
 IF d.id IS NULL OR r.decision IS DISTINCT FROM 'approved' OR r.reviewer_user_id=a.submitted_by OR gridex_ai_purpose_sources.actor_v1(a.company_id,r.reviewer_user_id,'review') IS NOT TRUE OR encode(sha256(a.source_bytes),'hex') IS DISTINCT FROM a.source_hash OR encode(sha256(convert_to(a.claims::text,'UTF8')),'hex') IS DISTINCT FROM a.claims_hash OR EXISTS(SELECT FROM gridex_ai_processing.decisions next WHERE next.previous_decision_id=d.id) THEN RETURN NULL;END IF;
 actual:=gridex_ai_purpose_sources.claims_v1(a.company_id,a.claims);receipt:=gridex_ai_purpose_sources.receipt_current_v1(a);
 IF actual IS DISTINCT FROM a.claims OR receipt IS NULL OR r.clause IS DISTINCT FROM receipt->'clause' OR now()<(a.claims->>'validFrom')::timestamptz OR now()>=(a.claims->>'validUntil')::timestamptz OR d.list_type IS DISTINCT FROM a.claims->>'listType' OR d.purpose IS DISTINCT FROM a.claims->>'purpose' OR d.gdpr_basis IS DISTINCT FROM a.claims->>'gdprBasis' OR d.retention_days IS DISTINCT FROM (a.claims->>'retentionDays')::integer OR d.valid_from IS DISTINCT FROM (a.claims->>'validFrom')::timestamptz OR d.valid_until IS DISTINCT FROM (a.claims->>'validUntil')::timestamptz OR d.source_sha256 IS DISTINCT FROM a.source_hash OR d.source_reference IS DISTINCT FROM a.source_reference OR d.decision_owner_registry_id::text IS DISTINCT FROM receipt->>'ownerRegistryId' OR d.decision_owner_registry_version IS DISTINCT FROM receipt->>'ownerRegistryVersion' THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('id',d.id,'revision',d.revision,'companyId',a.company_id,'environment',a.environment,'listType',d.list_type,'purpose',d.purpose,'gdprBasis',d.gdpr_basis,'retentionDays',d.retention_days,'retentionUntil',a.claims->>'retentionUntil','sourceReference',a.source_reference,'sourceSha256',a.source_hash,'ownerRegistryId',d.decision_owner_registry_id,'ownerRegistryVersion',d.decision_owner_registry_version,'artifactId',a.id);
EXCEPTION WHEN raise_exception THEN RETURN NULL;
END$$;
CREATE FUNCTION public.ediel_archive_ai_purpose_source_v1(p_company_id uuid,p_actor_user_id uuid,p_submission jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a gridex_ai_purpose_sources.artifacts%rowtype;claims jsonb;bytes bytea;hash text;ch text;missing jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_purpose_service_required' USING ERRCODE='42501';END IF;
 IF gridex_ai_purpose_sources.actor_v1(p_company_id,p_actor_user_id,'archive') IS NOT TRUE THEN RAISE EXCEPTION 'ai_purpose_actor_forbidden' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_submission) IS DISTINCT FROM 'object' OR NOT(p_submission ?& ARRAY['environment','listType','purpose','gdprBasis','retentionDays','retentionUntil','validFrom','validUntil','source']) OR EXISTS(SELECT FROM jsonb_object_keys(p_submission) x WHERE x NOT IN('environment','listType','purpose','gdprBasis','retentionDays','retentionUntil','validFrom','validUntil','source','issuerReceipt')) OR jsonb_typeof(p_submission->'source') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_submission->'source'))<>4 OR NOT(p_submission->'source' ?& ARRAY['bytesBase64','mimeType','reference','version']) OR p_submission#>>'{source,mimeType}' IS DISTINCT FROM 'application/pdf' OR length(coalesce(p_submission#>>'{source,bytesBase64}','')) NOT BETWEEN 4 AND 11184812 OR length(coalesce(p_submission#>>'{source,reference}','')) NOT BETWEEN 1 AND 2000 OR length(coalesce(p_submission#>>'{source,version}','')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'ai_purpose_submission_shape_required';END IF;
 bytes:=decode(p_submission#>>'{source,bytesBase64}','base64');IF octet_length(bytes) NOT BETWEEN 1 AND 8388608 OR left(convert_from(substring(bytes FROM 1 FOR 5),'UTF8'),5)<>'%PDF-' OR replace(encode(bytes,'base64'),E'\n','') IS DISTINCT FROM p_submission#>>'{source,bytesBase64}' THEN RAISE EXCEPTION 'ai_purpose_original_pdf_required';END IF;
 claims:=gridex_ai_purpose_sources.claims_v1(p_company_id,p_submission);hash:=encode(sha256(bytes),'hex');ch:=encode(sha256(convert_to(claims::text,'UTF8')),'hex');LOCK TABLE gridex_ai_purpose_sources.artifacts IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO a FROM gridex_ai_purpose_sources.artifacts WHERE company_id=p_company_id AND environment=p_submission->>'environment' AND source_hash=hash AND claims_hash=ch FOR SHARE;
 IF NOT FOUND THEN INSERT INTO gridex_ai_purpose_sources.artifacts(company_id,environment,claims,claims_hash,source_bytes,source_hash,source_reference,source_version,issuer_receipt,submitted_by) VALUES(p_company_id,p_submission->>'environment',claims,ch,bytes,hash,p_submission#>>'{source,reference}',p_submission#>>'{source,version}',p_submission->'issuerReceipt',p_actor_user_id) RETURNING * INTO a;
 ELSIF a.source_bytes IS DISTINCT FROM bytes OR a.source_reference IS DISTINCT FROM p_submission#>>'{source,reference}' OR a.source_version IS DISTINCT FROM p_submission#>>'{source,version}' OR a.issuer_receipt IS DISTINCT FROM p_submission->'issuerReceipt' OR a.submitted_by IS DISTINCT FROM p_actor_user_id THEN RAISE EXCEPTION 'ai_purpose_archive_conflict';END IF;
 missing:=CASE WHEN gridex_ai_purpose_sources.receipt_current_v1(a) IS NULL THEN '["authentic_current_purpose_issuer_and_representation"]'::jsonb ELSE '[]'::jsonb END;
 RETURN jsonb_build_object('status','archived','artifactId',a.id,'sourceHash',a.source_hash,'claimsHash',a.claims_hash,'missing',missing);
END$$;
CREATE FUNCTION public.ediel_review_ai_purpose_source_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_review jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a gridex_ai_purpose_sources.artifacts%rowtype;r gridex_ai_purpose_sources.reviews%rowtype;o gridex_ai_purpose_sources.origins%rowtype;prior gridex_ai_processing.decisions%rowtype;actual jsonb;receipt jsonb;missing jsonb:='[]';result text;decision uuid;n int;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_purpose_service_required' USING ERRCODE='42501';END IF;
 IF gridex_ai_purpose_sources.actor_v1(p_company_id,p_actor_user_id,'review') IS NOT TRUE THEN RAISE EXCEPTION 'ai_purpose_review_actor_forbidden' USING ERRCODE='42501';END IF;
 -- Same central authorization prefix, then stable decision/journal table fence.
 LOCK TABLE gridex_ai_processing.decisions,gridex_ai_purpose_sources.origins,gridex_ai_purpose_sources.reviews IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO a FROM gridex_ai_purpose_sources.artifacts WHERE id=p_artifact_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR jsonb_typeof(p_review) IS DISTINCT FROM 'object' OR NOT(p_review ?& ARRAY['sourceHash','claimsHash','decision','reason']) OR EXISTS(SELECT FROM jsonb_object_keys(p_review) x WHERE x NOT IN('sourceHash','claimsHash','decision','reason','clause')) OR p_review->>'sourceHash' IS DISTINCT FROM a.source_hash OR p_review->>'claimsHash' IS DISTINCT FROM a.claims_hash OR (p_review->>'decision' IN('approve','hold','reject')) IS NOT TRUE OR length(coalesce(p_review->>'reason','')) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'ai_purpose_actual_archived_candidate_required';END IF;
 IF a.submitted_by=p_actor_user_id THEN RAISE EXCEPTION 'ai_purpose_separate_reviewer_required' USING ERRCODE='42501';END IF;
 actual:=gridex_ai_purpose_sources.claims_v1(a.company_id,a.claims);receipt:=gridex_ai_purpose_sources.receipt_current_v1(a);
 IF actual IS DISTINCT FROM a.claims OR encode(sha256(a.source_bytes),'hex') IS DISTINCT FROM a.source_hash THEN missing:=missing||'"current_exact_archived_claims_required"'::jsonb;END IF;
 IF receipt IS NULL THEN missing:=missing||'"authentic_current_purpose_issuer_and_representation"'::jsonb;END IF;
 IF p_review->>'decision'='approve' AND (jsonb_typeof(p_review->'clause') IS DISTINCT FROM 'object' OR p_review->'clause' IS DISTINCT FROM receipt->'clause') THEN missing:=missing||'"exact_signed_original_legal_clause_required"'::jsonb;END IF;
 SELECT * INTO o FROM gridex_ai_purpose_sources.origins WHERE artifact_id=a.id;
 IF FOUND THEN IF gridex_ai_purpose_sources.current_v1(a) IS NULL THEN RETURN jsonb_build_object('status','held','artifactId',a.id,'missing','["current_purpose_authority_revoked_or_superseded"]'::jsonb);END IF;RETURN jsonb_build_object('status','authorized','artifactId',a.id,'decisionId',o.decision_id);END IF;
 result:=CASE WHEN p_review->>'decision'='reject' THEN 'rejected' WHEN p_review->>'decision'='hold' OR jsonb_array_length(missing)>0 THEN 'held' ELSE 'approved' END;
 INSERT INTO gridex_ai_purpose_sources.reviews(artifact_id,company_id,reviewer_user_id,decision,reason,clause,missing) VALUES(a.id,a.company_id,p_actor_user_id,result,p_review->>'reason',p_review->'clause',missing) RETURNING * INTO r;
 IF result<>'approved' THEN RETURN jsonb_build_object('status',result,'artifactId',a.id,'missing',missing);END IF;
 SELECT count(*) INTO n FROM gridex_ai_processing.decisions d WHERE company_id=a.company_id AND list_type=a.claims->>'listType' AND purpose=a.claims->>'purpose' AND EXISTS(SELECT FROM gridex_ai_purpose_sources.origins origin_candidate JOIN gridex_ai_purpose_sources.artifacts candidate ON candidate.id=origin_candidate.artifact_id WHERE origin_candidate.decision_id=d.id AND candidate.environment=a.environment) AND NOT EXISTS(SELECT FROM gridex_ai_processing.decisions next WHERE next.previous_decision_id=d.id);
 IF n>1 THEN RAISE EXCEPTION 'ai_purpose_previous_decision_ambiguous';END IF;
 SELECT * INTO prior FROM gridex_ai_processing.decisions d WHERE company_id=a.company_id AND list_type=a.claims->>'listType' AND purpose=a.claims->>'purpose' AND EXISTS(SELECT FROM gridex_ai_purpose_sources.origins origin_candidate JOIN gridex_ai_purpose_sources.artifacts candidate ON candidate.id=origin_candidate.artifact_id WHERE origin_candidate.decision_id=d.id AND candidate.environment=a.environment) AND NOT EXISTS(SELECT FROM gridex_ai_processing.decisions next WHERE next.previous_decision_id=d.id) ORDER BY id LIMIT 1 FOR SHARE;
 INSERT INTO gridex_ai_processing.decisions(company_id,list_type,purpose,revision,previous_decision_id,gdpr_basis,retention_days,valid_from,valid_until,source_reference,source_sha256,decision_owner_registry_id,decision_owner_registry_version)
 VALUES(a.company_id,a.claims->>'listType',a.claims->>'purpose',(SELECT coalesce(max(d.revision),0)+1 FROM gridex_ai_processing.decisions d WHERE d.company_id=a.company_id AND d.list_type=a.claims->>'listType' AND d.purpose=a.claims->>'purpose'),prior.id,a.claims->>'gdprBasis',(a.claims->>'retentionDays')::integer,(a.claims->>'validFrom')::timestamptz,(a.claims->>'validUntil')::timestamptz,a.source_reference,a.source_hash,(receipt->>'ownerRegistryId')::uuid,receipt->>'ownerRegistryVersion') RETURNING id INTO decision;
 INSERT INTO gridex_ai_purpose_sources.origins(artifact_id,review_id,decision_id,company_id) VALUES(a.id,r.id,decision,a.company_id);
 RETURN jsonb_build_object('status','authorized','artifactId',a.id,'decisionId',decision);
END$$;
CREATE FUNCTION public.ediel_read_ai_purpose_source_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_include_bytes boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a gridex_ai_purpose_sources.artifacts%rowtype;r gridex_ai_purpose_sources.reviews%rowtype;result jsonb;basis jsonb;state text;missing jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_purpose_service_required' USING ERRCODE='42501';END IF;
 IF gridex_ai_purpose_sources.actor_v1(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'ai_purpose_read_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO a FROM gridex_ai_purpose_sources.artifacts WHERE id=p_artifact_id AND company_id=p_company_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'ai_purpose_artifact_unavailable';END IF;
 SELECT * INTO r FROM gridex_ai_purpose_sources.reviews WHERE artifact_id=a.id ORDER BY reviewed_at DESC,id DESC LIMIT 1 FOR SHARE;basis:=gridex_ai_purpose_sources.current_v1(a);
 state:=CASE WHEN basis IS NOT NULL THEN 'authorized' WHEN r.decision='rejected' THEN 'rejected' WHEN r.id IS NOT NULL THEN 'held' ELSE 'archived' END;missing:=CASE WHEN basis IS NOT NULL THEN '[]'::jsonb WHEN r.id IS NOT NULL AND r.decision<>'approved' THEN r.missing ELSE '["current_purpose_authority_missing_or_revoked"]'::jsonb END;
 result:=a.claims-ARRAY['companyId','legalActorId','legalSupplierEdielId','legalCompany','sourceProfile','retentionClass'];result:=result||jsonb_build_object('artifactId',a.id,'sourceReference',a.source_reference,'sourceVersion',a.source_version,'sourceHash',a.source_hash,'claimsHash',a.claims_hash,'mimeType','application/pdf','byteLength',octet_length(a.source_bytes),'status',state,'missing',missing);
 IF p_include_bytes THEN result:=result||jsonb_build_object('bytesBase64',replace(encode(a.source_bytes,'base64'),E'\n',''));END IF;RETURN result;
END$$;
CREATE FUNCTION gridex_ai_purpose_sources.revoke_lock_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF NEW.target_kind='key' THEN PERFORM id FROM gridex_ai_purpose_sources.issuer_keys WHERE id=NEW.target_id FOR UPDATE;ELSIF NEW.target_kind='representation' THEN PERFORM id FROM gridex_ai_purpose_sources.representations WHERE id=NEW.target_id FOR UPDATE;ELSE PERFORM id FROM gridex_ai_purpose_sources.artifacts WHERE id=NEW.target_id FOR UPDATE;END IF;IF NOT FOUND THEN RAISE EXCEPTION 'ai_purpose_revocation_target_required';END IF;RETURN NEW;END$$;
CREATE TRIGGER ai_purpose_revoke_lock BEFORE INSERT ON gridex_ai_purpose_sources.revocations FOR EACH ROW EXECUTE FUNCTION gridex_ai_purpose_sources.revoke_lock_v1();
CREATE FUNCTION gridex_ai_purpose_sources.current_for_scope_v1(c uuid,list_type text,purpose text,env text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d gridex_ai_processing.decisions%rowtype;a gridex_ai_purpose_sources.artifacts%rowtype;result jsonb;n int;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 IF list_type IS NULL OR list_type NOT IN('AI','BI') OR purpose IS NULL OR purpose NOT IN('ediel_list_export','ediel_list_reconciliation') OR purpose='ediel_list_export' AND list_type<>'AI' THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_purpose_not_allowed');END IF;
 SELECT count(*) INTO n FROM gridex_ai_processing.decisions x WHERE company_id=c AND x.list_type=current_for_scope_v1.list_type AND x.purpose=current_for_scope_v1.purpose AND EXISTS(SELECT FROM gridex_ai_purpose_sources.origins origin_candidate JOIN gridex_ai_purpose_sources.artifacts candidate ON candidate.id=origin_candidate.artifact_id WHERE origin_candidate.decision_id=x.id AND (env IS NULL OR candidate.environment=env)) AND NOT EXISTS(SELECT FROM gridex_ai_processing.decisions child WHERE child.previous_decision_id=x.id);
 IF n<>1 THEN RETURN jsonb_build_object('status','held','blocker',CASE WHEN n=0 THEN 'ai_bi_processing_decision_missing' ELSE 'ai_bi_processing_decision_ambiguous' END);END IF;
 SELECT * INTO d FROM gridex_ai_processing.decisions x WHERE company_id=c AND x.list_type=current_for_scope_v1.list_type AND x.purpose=current_for_scope_v1.purpose AND EXISTS(SELECT FROM gridex_ai_purpose_sources.origins origin_candidate JOIN gridex_ai_purpose_sources.artifacts candidate ON candidate.id=origin_candidate.artifact_id WHERE origin_candidate.decision_id=x.id AND (env IS NULL OR candidate.environment=env)) AND NOT EXISTS(SELECT FROM gridex_ai_processing.decisions child WHERE child.previous_decision_id=x.id) FOR SHARE;
 SELECT artifact.* INTO a FROM gridex_ai_purpose_sources.origins o JOIN gridex_ai_purpose_sources.artifacts artifact ON artifact.id=o.artifact_id AND artifact.company_id=o.company_id WHERE o.decision_id=d.id AND o.company_id=c FOR SHARE OF artifact;
 IF a.id IS NULL OR env IS NOT NULL AND a.environment IS DISTINCT FROM env THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_processing_decision_owner_scope_unqualified');END IF;
 result:=gridex_ai_purpose_sources.current_v1(a);IF result IS NULL THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_processing_decision_owner_registry_unqualified');END IF;RETURN jsonb_build_object('status','authorized','decision',result);
END$$;
CREATE OR REPLACE FUNCTION gridex_ai_processing.purpose_decision_after_actor_v1(c uuid,list_type text,purpose text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_ai_purpose_sources.current_for_scope_v1(c,list_type,purpose,NULL)$$;
CREATE FUNCTION gridex_ai_purpose_sources.consumer_v1(c uuid,actor uuid,phase text,env text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 IF (phase IN('origination','send')) IS NOT TRUE OR (env IN('test','production')) IS NOT TRUE OR gridex_requested_changes.actor_v1(c,actor,'read','method_contract') IS NOT TRUE OR (CASE WHEN phase='send' THEN gridex_requested_changes.scoped_permission_v1(c,actor,'ediel.send') IS TRUE OR gridex_requested_changes.scoped_permission_v1(c,actor,'communication.send') IS TRUE ELSE gridex_requested_changes.scoped_permission_v1(c,actor,'communication.write') IS TRUE END) IS NOT TRUE THEN RAISE EXCEPTION 'ai_purpose_current_consumer_forbidden' USING ERRCODE='42501';END IF;
 PERFORM gridex_ai_purpose_sources.legal_scope_v1(c,env);
END$$;
CREATE FUNCTION public.ediel_ai_export_decision_v2(p_company_id uuid,p_actor_user_id uuid,p_environment text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_purpose_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ai_purpose_sources.consumer_v1(p_company_id,p_actor_user_id,'origination',p_environment);
 RETURN gridex_ai_purpose_sources.current_for_scope_v1(p_company_id,'AI','ediel_list_export',p_environment);
END$$;
CREATE OR REPLACE FUNCTION gridex_ai_processing.require_export_decision_for_intent_v1(c uuid,actor uuid,intent uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.ediel_message_intents%rowtype;decision jsonb;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();i:=gridex_ai_processing.intent_request_v1(c,intent);PERFORM gridex_ai_purpose_sources.consumer_v1(c,actor,'origination',i.environment);
 decision:=gridex_ai_purpose_sources.current_for_scope_v1(c,'AI','ediel_list_export',i.environment);IF decision->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',coalesce(decision->>'blocker','ai_bi_processing_decision_invalid') USING ERRCODE='42501';END IF;RETURN decision;
END$$;
-- Native originals and fresh provider reads bind the frozen decision and actual
-- original environment; a later legal decision never silently relabels it.
ALTER FUNCTION gridex_ai_processing.require_ai_outbound_source_v1(uuid,uuid,uuid) RENAME TO require_ai_source_before_purpose_owner_v1;
CREATE FUNCTION gridex_ai_processing.require_ai_outbound_source_v1(c uuid,message_id uuid,actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;o gridex_ai_processing.outbound_origins%rowtype;decision jsonb;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();SELECT * INTO m FROM public.ediel_messages WHERE id=message_id AND company_id=c FOR SHARE;
 PERFORM gridex_ai_purpose_sources.consumer_v1(c,actor,'send',m.environment);decision:=gridex_ai_purpose_sources.current_for_scope_v1(c,'AI','ediel_list_export',m.environment);SELECT * INTO o FROM gridex_ai_processing.outbound_origins WHERE intent_id=m.intent_id AND company_id=c FOR SHARE;
 IF decision->>'status' IS DISTINCT FROM 'authorized' OR o.processing_decision_id::text IS DISTINCT FROM decision#>>'{decision,id}' THEN RAISE EXCEPTION 'ai_purpose_frozen_original_current_decision_required';END IF;
 result:=gridex_ai_processing.require_ai_source_before_purpose_owner_v1(c,message_id,actor);RETURN result;
END$$;
CREATE OR REPLACE FUNCTION gridex_ai_processing.guard_outbound_purpose_storage_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE decision jsonb;BEGIN
 IF NEW.direction='outbound' AND (NEW.message_standard='ai_list' OR NEW.message_family IN ('AI_LIST','BI_LIST') OR NEW.raw_payload ~ '(^|\n)[\t ]*(AI|BI);' OR NEW.raw_payload LIKE chr(65279)||'AI;%' OR NEW.raw_payload LIKE chr(65279)||'BI;%') THEN
  IF TG_OP='INSERT' THEN
   IF NEW.message_code IS DISTINCT FROM 'AI' THEN RAISE EXCEPTION 'ai_list_outbound_header_required'; END IF;
   PERFORM gridex_ai_processing.outbound_wire_v1(NEW.raw_payload);
   PERFORM gridex_ai_purpose_sources.consumer_v1(NEW.company_id,NEW.created_by,'origination',NEW.environment);decision:=gridex_ai_purpose_sources.current_for_scope_v1(NEW.company_id,'AI','ediel_list_export',NEW.environment);IF decision->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'ai_purpose_actual_row_environment_required';END IF;
  ELSIF NEW.raw_payload IS DISTINCT FROM OLD.raw_payload OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.direction IS DISTINCT FROM OLD.direction OR NEW.environment IS DISTINCT FROM OLD.environment THEN
   PERFORM gridex_ai_purpose_sources.consumer_v1(NEW.company_id,NEW.created_by,'origination',NEW.environment);decision:=gridex_ai_purpose_sources.current_for_scope_v1(NEW.company_id,'AI','ediel_list_export',NEW.environment);IF decision->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'ai_purpose_actual_row_environment_required';END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION gridex_ai_processing.personal_storage_basis_for_purpose_v1(c uuid,actor uuid,env text,raw text,purpose text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE line text;h text[];assessment jsonb;basis jsonb;previous jsonb;
BEGIN
 FOR line IN SELECT l FROM regexp_split_to_table(replace(raw,E'\r\n',E'\n'),E'\n') l WHERE l ~ '^[\t ]*(AI|BI);' OR l LIKE chr(65279)||'AI;%' OR l LIKE chr(65279)||'BI;%' LOOP
  IF left(line,1)=chr(65279) THEN line:=substring(line FROM 2); END IF;
  h:=string_to_array(line,';');
  IF cardinality(h)<>10 OR h[1] NOT IN ('AI','BI') THEN RAISE EXCEPTION 'ai_bi_personal_storage_header_required'; END IF;
  PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor FOR SHARE;
  PERFORM p.id FROM public.user_profiles p WHERE p.id=actor FOR SHARE;
  PERFORM gridex_ai_purpose_sources.consumer_v1(c,actor,'origination',env);assessment:=gridex_ai_purpose_sources.current_for_scope_v1(c,h[1],purpose,env);
  IF assessment->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',coalesce(assessment->>'blocker','ai_bi_processing_decision_invalid') USING ERRCODE='42501'; END IF;
  basis:=jsonb_build_object('listType',h[1],'decisionId',assessment#>>'{decision,id}','headerBasis',gridex_ai_processing.header_company_basis_v1(c,env,h[4],h[2]));
  IF previous IS NOT NULL AND previous IS DISTINCT FROM basis THEN RAISE EXCEPTION 'ai_bi_personal_storage_mixed_scope'; END IF;
  previous:=basis;
 END LOOP;
 RETURN previous;
END $$;
DROP TRIGGER ai_a_outbound_requires_export_purpose ON public.ediel_messages;
CREATE TRIGGER ai_a_outbound_requires_export_purpose BEFORE INSERT OR UPDATE OF raw_payload,company_id,created_by,direction,environment ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ai_processing.guard_outbound_purpose_storage_v1();
CREATE OR REPLACE FUNCTION gridex_ai_processing.require_ai_outbound_source_before_origin_v1(c uuid,message_id uuid,actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;wire jsonb;decision jsonb;basis jsonb;profile jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages s WHERE s.id=message_id AND s.company_id=c FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'ai_list' OR m.message_family IS DISTINCT FROM 'AI_LIST'
  OR m.message_code IS DISTINCT FROM 'AI' OR m.raw_payload IS NULL OR m.immutable_rendered_at IS NULL
  OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ai_list_sealed_outbound_source_required'; END IF;
 wire:=gridex_ai_processing.outbound_wire_v1(m.raw_payload);profile:=wire->'profile';
 IF m.sender_ediel_id IS DISTINCT FROM wire->>'supplierEdielId' OR m.receiver_ediel_id IS DISTINCT FROM wire->>'networkEdielId'
  OR m.message_version IS DISTINCT FROM profile->>'technicalVersion' THEN RAISE EXCEPTION 'ai_list_outbound_party_profile_scope_mismatch'; END IF;
 IF m.file_name IS NULL OR lower(m.file_name) NOT LIKE '%.csv' OR m.mime_type IS NULL
  OR m.mime_type!~* '^text/csv([ \t]*;[ \t]*charset[ \t]*=[ \t]*(utf-8|"utf-8"))?[ \t]*$' THEN RAISE EXCEPTION 'ai_list_csv_file_type_required'; END IF;
 PERFORM gridex_ai_purpose_sources.consumer_v1(c,actor,'send',m.environment);decision:=gridex_ai_purpose_sources.current_for_scope_v1(c,'AI','ediel_list_export',m.environment);IF decision->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'ai_purpose_actual_outbound_environment_required';END IF;
 basis:=gridex_ai_processing.header_company_basis_v1(c,m.environment,wire->>'supplierEdielId',wire->>'networkEdielId');
 PERFORM public.ediel_require_scoped_capability_for_message_v1(c,m.id);
 IF m.environment='production' AND NOT EXISTS(SELECT FROM gridex_ediel_readiness.evidence e WHERE e.company_id=c AND e.scope->>'family'='AI_LIST'
  AND e.scope->>'code'='AI' AND e.expires_at>statement_timestamp() AND e.dependencies->>'rulepackHash'=profile->>'sourceSha256'
  AND e.dependencies->>'technicalFormatVersion'=profile->>'technicalVersion') THEN RAISE EXCEPTION 'ai_list_scoped_profile_dependency_required'; END IF;
 RETURN jsonb_build_object('sourceHash',m.immutable_payload_hash,'profile',profile,'headerBasis',basis,'decisionId',decision#>>'{decision,id}','rowCount',wire->'rowCount');
END $$;
ALTER FUNCTION gridex_ai_processing.require_original_draft_v1(uuid,uuid,uuid,jsonb) RENAME TO require_original_before_purpose_owner_v1;
CREATE FUNCTION gridex_ai_processing.require_original_draft_v1(c uuid,actor uuid,intent uuid,d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_ai_processing.outbound_origins%rowtype;decision jsonb;BEGIN
 decision:=gridex_ai_processing.require_export_decision_for_intent_v1(c,actor,intent);SELECT * INTO o FROM gridex_ai_processing.outbound_origins WHERE intent_id=intent AND company_id=c FOR SHARE;
 IF o.processing_decision_id::text IS DISTINCT FROM decision#>>'{decision,id}' THEN RAISE EXCEPTION 'ai_purpose_frozen_original_current_decision_required';END IF;
 RETURN gridex_ai_processing.require_original_before_purpose_owner_v1(c,actor,intent,d);
END$$;
REVOKE ALL ON FUNCTION gridex_ai_processing.require_original_before_purpose_owner_v1(uuid,uuid,uuid,jsonb),gridex_ai_processing.require_original_draft_v1(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $$DECLARE f regprocedure;BEGIN FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ai_purpose_sources' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);END LOOP;END$$;
REVOKE ALL ON FUNCTION gridex_ai_processing.require_ai_source_before_purpose_owner_v1(uuid,uuid,uuid),gridex_ai_processing.require_ai_outbound_source_v1(uuid,uuid,uuid),gridex_ai_processing.purpose_decision_after_actor_v1(uuid,text,text),gridex_ai_processing.require_export_decision_for_intent_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_archive_ai_purpose_source_v1(uuid,uuid,jsonb),public.ediel_review_ai_purpose_source_v1(uuid,uuid,uuid,jsonb),public.ediel_read_ai_purpose_source_v1(uuid,uuid,uuid,boolean),public.ediel_ai_export_decision_v2(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_archive_ai_purpose_source_v1(uuid,uuid,jsonb),public.ediel_review_ai_purpose_source_v1(uuid,uuid,uuid,jsonb),public.ediel_read_ai_purpose_source_v1(uuid,uuid,uuid,boolean),public.ediel_ai_export_decision_v2(uuid,uuid,text) TO service_role;
COMMIT;
