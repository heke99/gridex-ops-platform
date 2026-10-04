-- Network source authority is an independent dated original registry artifact.
-- No issuer, representation, registry version, approval or grant is seeded.
BEGIN;
INSERT INTO public.permissions(key,name,category,is_active) VALUES('ediel.network_registry.review','Granska autentiska nätregisterunderlag','ediel',true) ON CONFLICT(key) DO NOTHING;
CREATE SCHEMA gridex_network_registry_sources;
REVOKE ALL ON SCHEMA gridex_network_registry_sources FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_network_registry_sources.artifacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),network_actor_id uuid NOT NULL REFERENCES public.platform_market_actors(id),claims jsonb NOT NULL,claims_hash text NOT NULL CHECK(claims_hash~'^[a-f0-9]{64}$'),source_bytes bytea NOT NULL CHECK(octet_length(source_bytes) BETWEEN 1 AND 8388608),source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),source_reference text NOT NULL,source_version text NOT NULL,issuer_receipt jsonb,submitted_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,environment,source_hash,claims_hash));
CREATE TABLE gridex_network_registry_sources.reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),artifact_id uuid NOT NULL REFERENCES gridex_network_registry_sources.artifacts(id),company_id uuid NOT NULL,reviewer_user_id uuid NOT NULL REFERENCES auth.users(id),decision text NOT NULL CHECK(decision IN('approved','held','rejected')),reason text NOT NULL,clause jsonb,missing jsonb NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_network_registry_sources.issuer_keys(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,environment text NOT NULL,network_actor_id uuid NOT NULL REFERENCES public.platform_market_actors(id),registry_version text NOT NULL CHECK(length(registry_version)>0),legal_authority_reference text NOT NULL CHECK(length(legal_authority_reference)>0),legal_authority_hash text NOT NULL CHECK(legal_authority_hash~'^[a-f0-9]{64}$'),receipt_signing_key bytea NOT NULL CHECK(octet_length(receipt_signing_key)>=32),valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(valid_to>valid_from));
CREATE TABLE gridex_network_registry_sources.representations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,environment text NOT NULL,issuer_key_id uuid NOT NULL REFERENCES gridex_network_registry_sources.issuer_keys(id),network_actor_id uuid NOT NULL REFERENCES public.platform_market_actors(id),legal_authority_reference text NOT NULL CHECK(length(legal_authority_reference)>0),legal_authority_hash text NOT NULL CHECK(legal_authority_hash~'^[a-f0-9]{64}$'),valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(valid_to>valid_from));
CREATE TABLE gridex_network_registry_sources.origins(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),artifact_id uuid NOT NULL UNIQUE REFERENCES gridex_network_registry_sources.artifacts(id),review_id uuid NOT NULL UNIQUE REFERENCES gridex_network_registry_sources.reviews(id),company_id uuid NOT NULL,environment text NOT NULL,network_actor_id uuid NOT NULL,registry_version text NOT NULL,previous_version_id uuid UNIQUE REFERENCES gridex_network_registry_sources.origins(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,environment,network_actor_id,registry_version));
CREATE TABLE gridex_network_registry_sources.revocations(target_kind text NOT NULL CHECK(target_kind IN('key','representation','artifact')),target_id uuid NOT NULL,source_reference text NOT NULL CHECK(length(source_reference)>0),source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(target_kind,target_id));
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['artifacts','reviews','issuer_keys','representations','origins','revocations'] LOOP
 EXECUTE format('ALTER TABLE gridex_network_registry_sources.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_network_registry_sources.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON gridex_network_registry_sources.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gridex_network_registry_sources.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_immutable',t);EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gridex_network_registry_sources.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_no_truncate',t);
END LOOP;END$$;

CREATE FUNCTION gridex_network_registry_sources.actor_v1(c uuid,actor uuid,mode text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 RETURN mode IN('archive','read','review') AND gridex_requested_changes.actor_v1(c,actor,CASE WHEN mode='review' THEN 'archive' ELSE mode END,'method_contract') IS TRUE
 AND (mode<>'review' OR gridex_requested_changes.scoped_permission_v1(c,actor,'ediel.network_registry.review') IS TRUE);
END$$;
CREATE FUNCTION gridex_network_registry_sources.claims_v1(c uuid,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE network public.platform_market_actors%rowtype;identifier public.platform_actor_identifiers%rowtype;role public.platform_actor_roles%rowtype;own_scope jsonb;from_at timestamptz;until_at timestamptz;n int;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR nullif(p->>'networkActorId','') IS NULL OR (p->>'environment' IN('test','production')) IS NOT TRUE THEN RAISE EXCEPTION 'network_registry_claims_required';END IF;
 from_at:=(p->>'validFrom')::timestamptz;until_at:=(p->>'validUntil')::timestamptz;
 IF from_at IS NULL OR until_at IS NULL OR NOT isfinite(from_at) OR NOT isfinite(until_at) OR from_at>=until_at OR until_at<=now() THEN RAISE EXCEPTION 'network_registry_validity_required';END IF;
 own_scope:=gridex_ai_purpose_sources.legal_scope_v1(c,p->>'environment');
 LOCK TABLE public.platform_market_actors IN SHARE MODE;
 SELECT * INTO network FROM public.platform_market_actors WHERE id=(p->>'networkActorId')::uuid FOR SHARE;
 PERFORM id FROM public.platform_actor_identifiers WHERE actor_id=network.id ORDER BY id FOR SHARE;PERFORM id FROM public.platform_actor_roles WHERE actor_id=network.id ORDER BY id FOR SHARE;
 SELECT count(*) INTO n FROM public.platform_actor_identifiers WHERE actor_id=network.id AND lower(identifier_type) IN('edielid','ediel_id') AND is_verified AND (valid_from IS NULL OR valid_from<=current_date) AND (valid_to IS NULL OR valid_to>=current_date);
 SELECT * INTO identifier FROM public.platform_actor_identifiers WHERE actor_id=network.id AND lower(identifier_type) IN('edielid','ediel_id') AND is_verified AND (valid_from IS NULL OR valid_from<=current_date) AND (valid_to IS NULL OR valid_to>=current_date) ORDER BY id LIMIT 1;
 SELECT * INTO role FROM public.platform_actor_roles WHERE actor_id=network.id AND actor_role='grid_owner' AND is_active ORDER BY id LIMIT 1;
 IF network.id IS NULL OR network.status IS DISTINCT FROM 'active' OR n<>1 OR coalesce(identifier.identifier_value,'')!~'^[0-9]{5}$' OR role.id IS NULL OR nullif(network.name,'') IS NULL THEN RAISE EXCEPTION 'network_registry_current_verified_network_scope_required';END IF;
 RETURN own_scope||jsonb_build_object('networkActorId',network.id,'networkEdielId',identifier.identifier_value,'networkName',network.name,'identifierHash',encode(sha256(convert_to((to_jsonb(identifier)-ARRAY['updated_at','created_at'])::text,'UTF8')),'hex'),'roleHash',encode(sha256(convert_to((to_jsonb(role)-ARRAY['updated_at','created_at'])::text,'UTF8')),'hex'),'validFrom',from_at,'validUntil',until_at,'sourceClass','authenticated_original_network_registry');
END$$;
CREATE FUNCTION gridex_network_registry_sources.receipt_current_v1(a gridex_network_registry_sources.artifacts) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k gridex_network_registry_sources.issuer_keys%rowtype;g gridex_network_registry_sources.representations%rowtype;r jsonb:=a.issuer_receipt;raw bytea;p jsonb;issued timestamptz;expires timestamptz;
BEGIN
 IF r IS NULL OR jsonb_typeof(r)<>'object' OR coalesce(r->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(r->>'payloadBase64','')) NOT BETWEEN 1 AND 65536 THEN RETURN NULL;END IF;
 SELECT * INTO k FROM gridex_network_registry_sources.issuer_keys WHERE id=(r->>'keyId')::uuid AND company_id=a.company_id AND environment=a.environment AND network_actor_id=(a.claims->>'networkActorId')::uuid FOR SHARE;
 SELECT * INTO g FROM gridex_network_registry_sources.representations WHERE id=(r->>'representationId')::uuid AND company_id=a.company_id AND environment=a.environment AND issuer_key_id=k.id AND network_actor_id=(a.claims->>'networkActorId')::uuid FOR SHARE;
 IF k.id IS NULL OR g.id IS NULL OR now()<k.valid_from OR now()>=k.valid_to OR now()<g.valid_from OR now()>=g.valid_to OR EXISTS(SELECT FROM gridex_network_registry_sources.revocations WHERE target_kind='key' AND target_id=k.id OR target_kind='representation' AND target_id=g.id OR target_kind='artifact' AND target_id=a.id) THEN RETURN NULL;END IF;
 raw:=decode(r->>'payloadBase64','base64');IF sha256(gridex_requested_changes.receipt_hmac_sha256_v1(raw,k.receipt_signing_key)) IS DISTINCT FROM sha256(decode(r->>'signatureHex','hex')) THEN RETURN NULL;END IF;
 p:=convert_from(raw,'UTF8')::jsonb;issued:=(p->>'issuedAt')::timestamptz;expires:=(p->>'expiresAt')::timestamptz;
 IF p->>'format' IS DISTINCT FROM 'ediel_network_registry_receipt_v1' OR nullif(p->>'receiptId','') IS NULL OR p->'claims' IS DISTINCT FROM a.claims OR p->>'sourceHash' IS DISTINCT FROM a.source_hash OR p->>'sourceReference' IS DISTINCT FROM a.source_reference OR p->>'sourceVersion' IS DISTINCT FROM a.source_version OR p->>'registryVersion' IS DISTINCT FROM k.registry_version OR jsonb_typeof(p->'clause') IS DISTINCT FROM 'object' OR nullif(p#>>'{clause,locator}','') IS NULL OR nullif(p#>>'{clause,quote}','') IS NULL OR position(convert_to(p#>>'{clause,quote}','UTF8') IN a.source_bytes)=0 OR issued IS NULL OR expires IS NULL OR NOT isfinite(issued) OR NOT isfinite(expires) OR issued>now() OR expires<=now() OR issued<greatest(k.valid_from,g.valid_from) OR expires>least(k.valid_to,g.valid_to) OR expires<(a.claims->>'validUntil')::timestamptz THEN RETURN NULL;END IF;
 RETURN p||jsonb_build_object('ownerRegistryId',k.id,'ownerRegistryVersion',k.registry_version);
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR invalid_datetime_format OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;
END$$;
CREATE FUNCTION gridex_network_registry_sources.current_v1(a gridex_network_registry_sources.artifacts) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_network_registry_sources.origins%rowtype;r gridex_network_registry_sources.reviews%rowtype;receipt jsonb;actual jsonb;
BEGIN
 SELECT * INTO o FROM gridex_network_registry_sources.origins WHERE artifact_id=a.id AND company_id=a.company_id FOR SHARE;SELECT * INTO r FROM gridex_network_registry_sources.reviews WHERE id=o.review_id AND artifact_id=a.id AND company_id=a.company_id FOR SHARE;
 IF o.id IS NULL OR o.environment IS DISTINCT FROM a.environment OR o.network_actor_id IS DISTINCT FROM a.network_actor_id OR o.registry_version IS DISTINCT FROM a.source_version OR r.decision IS DISTINCT FROM 'approved' OR r.reviewer_user_id=a.submitted_by OR gridex_network_registry_sources.actor_v1(a.company_id,r.reviewer_user_id,'review') IS NOT TRUE OR encode(sha256(a.source_bytes),'hex') IS DISTINCT FROM a.source_hash OR encode(sha256(convert_to(a.claims::text,'UTF8')),'hex') IS DISTINCT FROM a.claims_hash OR EXISTS(SELECT FROM gridex_network_registry_sources.origins child WHERE child.previous_version_id=o.id) THEN RETURN NULL;END IF;
 actual:=gridex_network_registry_sources.claims_v1(a.company_id,a.claims);receipt:=gridex_network_registry_sources.receipt_current_v1(a);
 IF actual IS DISTINCT FROM a.claims OR receipt IS NULL OR r.clause IS DISTINCT FROM receipt->'clause' OR now()<(a.claims->>'validFrom')::timestamptz OR now()>=(a.claims->>'validUntil')::timestamptz THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('companyId',a.company_id,'environment',a.environment,'networkActorId',a.network_actor_id,'networkEdielId',a.claims->>'networkEdielId','registryVersionId',o.id,'registryVersion',o.registry_version,'sourceReference',a.source_reference,'sourceSha256',a.source_hash,'claimsHash',a.claims_hash,'artifactId',a.id,'ownerRegistryId',receipt->>'ownerRegistryId','ownerRegistryVersion',receipt->>'ownerRegistryVersion','validFrom',a.claims->>'validFrom','validUntil',a.claims->>'validUntil');
EXCEPTION WHEN raise_exception THEN RETURN NULL;
END$$;
CREATE FUNCTION public.ediel_archive_network_registry_source_v1(p_company_id uuid,p_actor_user_id uuid,p_submission jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a gridex_network_registry_sources.artifacts%rowtype;claims jsonb;bytes bytea;hash text;ch text;missing jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'network_registry_service_required' USING ERRCODE='42501';END IF;
 IF gridex_network_registry_sources.actor_v1(p_company_id,p_actor_user_id,'archive') IS NOT TRUE THEN RAISE EXCEPTION 'network_registry_actor_forbidden' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_submission) IS DISTINCT FROM 'object' OR NOT(p_submission ?& ARRAY['environment','networkActorId','validFrom','validUntil','source']) OR EXISTS(SELECT FROM jsonb_object_keys(p_submission) x WHERE x NOT IN('environment','networkActorId','validFrom','validUntil','source','issuerReceipt')) OR jsonb_typeof(p_submission->'source') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_submission->'source'))<>4 OR NOT(p_submission->'source' ?& ARRAY['bytesBase64','mimeType','reference','version']) OR p_submission#>>'{source,mimeType}' IS DISTINCT FROM 'application/pdf' OR length(coalesce(p_submission#>>'{source,bytesBase64}','')) NOT BETWEEN 4 AND 11184812 OR length(coalesce(p_submission#>>'{source,reference}','')) NOT BETWEEN 1 AND 2000 OR length(coalesce(p_submission#>>'{source,version}','')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'network_registry_submission_shape_required';END IF;
 bytes:=decode(p_submission#>>'{source,bytesBase64}','base64');IF octet_length(bytes) NOT BETWEEN 1 AND 8388608 OR left(convert_from(substring(bytes FROM 1 FOR 5),'UTF8'),5)<>'%PDF-' OR replace(encode(bytes,'base64'),E'\n','') IS DISTINCT FROM p_submission#>>'{source,bytesBase64}' THEN RAISE EXCEPTION 'network_registry_original_pdf_required';END IF;
 claims:=gridex_network_registry_sources.claims_v1(p_company_id,p_submission);hash:=encode(sha256(bytes),'hex');ch:=encode(sha256(convert_to(claims::text,'UTF8')),'hex');LOCK TABLE gridex_network_registry_sources.artifacts IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO a FROM gridex_network_registry_sources.artifacts WHERE company_id=p_company_id AND environment=p_submission->>'environment' AND source_hash=hash AND claims_hash=ch FOR SHARE;
 IF NOT FOUND THEN INSERT INTO gridex_network_registry_sources.artifacts(company_id,environment,network_actor_id,claims,claims_hash,source_bytes,source_hash,source_reference,source_version,issuer_receipt,submitted_by) VALUES(p_company_id,p_submission->>'environment',(claims->>'networkActorId')::uuid,claims,ch,bytes,hash,p_submission#>>'{source,reference}',p_submission#>>'{source,version}',p_submission->'issuerReceipt',p_actor_user_id) RETURNING * INTO a;
 ELSIF a.source_bytes IS DISTINCT FROM bytes OR a.source_reference IS DISTINCT FROM p_submission#>>'{source,reference}' OR a.source_version IS DISTINCT FROM p_submission#>>'{source,version}' OR a.issuer_receipt IS DISTINCT FROM p_submission->'issuerReceipt' OR a.submitted_by IS DISTINCT FROM p_actor_user_id THEN RAISE EXCEPTION 'network_registry_archive_conflict';END IF;
 missing:=CASE WHEN gridex_network_registry_sources.receipt_current_v1(a) IS NULL THEN '["authentic_current_network_registry_issuer_and_representation"]'::jsonb ELSE '[]'::jsonb END;
 RETURN jsonb_build_object('status','archived','artifactId',a.id,'sourceHash',a.source_hash,'claimsHash',a.claims_hash,'missing',missing);
END$$;
CREATE FUNCTION public.ediel_review_network_registry_source_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_review jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a gridex_network_registry_sources.artifacts%rowtype;r gridex_network_registry_sources.reviews%rowtype;o gridex_network_registry_sources.origins%rowtype;prior gridex_network_registry_sources.origins%rowtype;actual jsonb;receipt jsonb;missing jsonb:='[]';result text;version_id uuid;n int;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'network_registry_service_required' USING ERRCODE='42501';END IF;
 IF gridex_network_registry_sources.actor_v1(p_company_id,p_actor_user_id,'review') IS NOT TRUE THEN RAISE EXCEPTION 'network_registry_review_actor_forbidden' USING ERRCODE='42501';END IF;
 -- Same central authorization prefix, then stable decision/journal table fence.
 LOCK TABLE gridex_network_registry_sources.origins,gridex_network_registry_sources.reviews IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO a FROM gridex_network_registry_sources.artifacts WHERE id=p_artifact_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR jsonb_typeof(p_review) IS DISTINCT FROM 'object' OR NOT(p_review ?& ARRAY['sourceHash','claimsHash','decision','reason']) OR EXISTS(SELECT FROM jsonb_object_keys(p_review) x WHERE x NOT IN('sourceHash','claimsHash','decision','reason','clause')) OR p_review->>'sourceHash' IS DISTINCT FROM a.source_hash OR p_review->>'claimsHash' IS DISTINCT FROM a.claims_hash OR (p_review->>'decision' IN('approve','hold','reject')) IS NOT TRUE OR length(coalesce(p_review->>'reason','')) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'network_registry_actual_archived_candidate_required';END IF;
 IF a.submitted_by=p_actor_user_id THEN RAISE EXCEPTION 'network_registry_separate_reviewer_required' USING ERRCODE='42501';END IF;
 actual:=gridex_network_registry_sources.claims_v1(a.company_id,a.claims);receipt:=gridex_network_registry_sources.receipt_current_v1(a);
 IF actual IS DISTINCT FROM a.claims OR encode(sha256(a.source_bytes),'hex') IS DISTINCT FROM a.source_hash THEN missing:=missing||'"current_exact_archived_claims_required"'::jsonb;END IF;
 IF receipt IS NULL THEN missing:=missing||'"authentic_current_network_registry_issuer_and_representation"'::jsonb;END IF;
 IF p_review->>'decision'='approve' AND (jsonb_typeof(p_review->'clause') IS DISTINCT FROM 'object' OR p_review->'clause' IS DISTINCT FROM receipt->'clause') THEN missing:=missing||'"exact_signed_original_legal_clause_required"'::jsonb;END IF;
 SELECT * INTO o FROM gridex_network_registry_sources.origins WHERE artifact_id=a.id;
 IF FOUND THEN IF gridex_network_registry_sources.current_v1(a) IS NULL THEN RETURN jsonb_build_object('status','held','artifactId',a.id,'missing','["current_network_registry_authority_revoked_or_superseded"]'::jsonb);END IF;RETURN jsonb_build_object('status','authorized','artifactId',a.id,'registryVersionId',o.id);END IF;
 result:=CASE WHEN p_review->>'decision'='reject' THEN 'rejected' WHEN p_review->>'decision'='hold' OR jsonb_array_length(missing)>0 THEN 'held' ELSE 'approved' END;
 INSERT INTO gridex_network_registry_sources.reviews(artifact_id,company_id,reviewer_user_id,decision,reason,clause,missing) VALUES(a.id,a.company_id,p_actor_user_id,result,p_review->>'reason',p_review->'clause',missing) RETURNING * INTO r;
 IF result<>'approved' THEN RETURN jsonb_build_object('status',result,'artifactId',a.id,'missing',missing);END IF;
 SELECT count(*) INTO n FROM gridex_network_registry_sources.origins version WHERE company_id=a.company_id AND environment=a.environment AND network_actor_id=a.network_actor_id AND NOT EXISTS(SELECT FROM gridex_network_registry_sources.origins child WHERE child.previous_version_id=version.id);
 IF n>1 THEN RAISE EXCEPTION 'network_registry_previous_version_ambiguous';END IF;
 SELECT * INTO prior FROM gridex_network_registry_sources.origins version WHERE company_id=a.company_id AND environment=a.environment AND network_actor_id=a.network_actor_id AND NOT EXISTS(SELECT FROM gridex_network_registry_sources.origins child WHERE child.previous_version_id=version.id) FOR SHARE;
 INSERT INTO gridex_network_registry_sources.origins(artifact_id,review_id,company_id,environment,network_actor_id,registry_version,previous_version_id) VALUES(a.id,r.id,a.company_id,a.environment,a.network_actor_id,a.source_version,prior.id) RETURNING id INTO version_id;
 RETURN jsonb_build_object('status','authorized','artifactId',a.id,'registryVersionId',version_id);
END$$;
CREATE FUNCTION public.ediel_read_network_registry_source_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_include_bytes boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a gridex_network_registry_sources.artifacts%rowtype;r gridex_network_registry_sources.reviews%rowtype;result jsonb;basis jsonb;state text;missing jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'network_registry_service_required' USING ERRCODE='42501';END IF;
 IF gridex_network_registry_sources.actor_v1(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'network_registry_read_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO a FROM gridex_network_registry_sources.artifacts WHERE id=p_artifact_id AND company_id=p_company_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'network_registry_artifact_unavailable';END IF;
 SELECT * INTO r FROM gridex_network_registry_sources.reviews WHERE artifact_id=a.id ORDER BY reviewed_at DESC,id DESC LIMIT 1 FOR SHARE;basis:=gridex_network_registry_sources.current_v1(a);
 state:=CASE WHEN basis IS NOT NULL THEN 'authorized' WHEN r.decision='rejected' THEN 'rejected' WHEN r.id IS NOT NULL THEN 'held' ELSE 'archived' END;missing:=CASE WHEN basis IS NOT NULL THEN '[]'::jsonb WHEN r.id IS NOT NULL AND r.decision<>'approved' THEN r.missing ELSE '["current_network_registry_authority_missing_or_revoked"]'::jsonb END;
 result:=a.claims-ARRAY['companyId','legalActorId','legalSupplierEdielId','legalCompany','sourceProfile','sourceClass','identifierHash','roleHash'];result:=result||jsonb_build_object('artifactId',a.id,'sourceReference',a.source_reference,'sourceVersion',a.source_version,'sourceHash',a.source_hash,'claimsHash',a.claims_hash,'mimeType','application/pdf','byteLength',octet_length(a.source_bytes),'status',state,'missing',missing);
 IF p_include_bytes THEN result:=result||jsonb_build_object('bytesBase64',replace(encode(a.source_bytes,'base64'),E'\n',''));END IF;RETURN result;
END$$;
CREATE FUNCTION gridex_network_registry_sources.revoke_lock_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF NEW.target_kind='key' THEN PERFORM id FROM gridex_network_registry_sources.issuer_keys WHERE id=NEW.target_id FOR UPDATE;ELSIF NEW.target_kind='representation' THEN PERFORM id FROM gridex_network_registry_sources.representations WHERE id=NEW.target_id FOR UPDATE;ELSE PERFORM id FROM gridex_network_registry_sources.artifacts WHERE id=NEW.target_id FOR UPDATE;END IF;IF NOT FOUND THEN RAISE EXCEPTION 'network_registry_revocation_target_required';END IF;RETURN NEW;END$$;
CREATE TRIGGER network_registry_revoke_lock BEFORE INSERT ON gridex_network_registry_sources.revocations FOR EACH ROW EXECUTE FUNCTION gridex_network_registry_sources.revoke_lock_v1();
CREATE FUNCTION gridex_network_registry_sources.network_for_company_v1(c uuid,network_id text,env text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a gridex_network_registry_sources.artifacts%rowtype;basis jsonb;n int;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 LOCK TABLE gridex_network_registry_sources.artifacts,gridex_network_registry_sources.reviews,gridex_network_registry_sources.origins,gridex_network_registry_sources.issuer_keys,gridex_network_registry_sources.representations,gridex_network_registry_sources.revocations IN SHARE MODE;
 IF (env IN('test','production')) IS NOT TRUE OR coalesce(network_id,'')!~'^[0-9]{5}$' THEN RAISE EXCEPTION 'network_registry_company_environment_required';END IF;
 SELECT count(*) INTO n FROM gridex_network_registry_sources.origins version JOIN gridex_network_registry_sources.artifacts artifact ON artifact.id=version.artifact_id WHERE version.company_id=c AND version.environment=env AND artifact.claims->>'networkEdielId'=network_id AND NOT EXISTS(SELECT FROM gridex_network_registry_sources.origins child WHERE child.previous_version_id=version.id);
 IF n<>1 THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_network_registry_version_unqualified');END IF;
 SELECT artifact.* INTO a FROM gridex_network_registry_sources.origins version JOIN gridex_network_registry_sources.artifacts artifact ON artifact.id=version.artifact_id WHERE version.company_id=c AND version.environment=env AND artifact.claims->>'networkEdielId'=network_id AND NOT EXISTS(SELECT FROM gridex_network_registry_sources.origins child WHERE child.previous_version_id=version.id) FOR SHARE OF artifact;
 basis:=gridex_network_registry_sources.current_v1(a);IF basis IS NULL THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_network_registry_current_source_unqualified');END IF;RETURN jsonb_build_object('status','authorized','basis',basis);
END$$;
CREATE FUNCTION public.ediel_revoke_network_registry_source_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_review jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a gridex_network_registry_sources.artifacts%rowtype;BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'network_registry_service_required' USING ERRCODE='42501';END IF;
 IF gridex_network_registry_sources.actor_v1(p_company_id,p_actor_user_id,'review') IS NOT TRUE THEN RAISE EXCEPTION 'network_registry_review_actor_forbidden' USING ERRCODE='42501';END IF;
 LOCK TABLE gridex_network_registry_sources.artifacts,gridex_network_registry_sources.reviews,gridex_network_registry_sources.origins,gridex_network_registry_sources.issuer_keys,gridex_network_registry_sources.representations,gridex_network_registry_sources.revocations IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO a FROM gridex_network_registry_sources.artifacts WHERE id=p_artifact_id AND company_id=p_company_id FOR UPDATE;
 IF a.id IS NULL OR jsonb_typeof(p_review) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_review))<>3 OR p_review->>'sourceHash' IS DISTINCT FROM a.source_hash OR p_review->>'claimsHash' IS DISTINCT FROM a.claims_hash OR length(coalesce(p_review->>'reason','')) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'network_registry_actual_revocation_candidate_required';END IF;
 INSERT INTO gridex_network_registry_sources.revocations(target_kind,target_id,source_reference,source_hash) VALUES('artifact',a.id,p_review->>'reason',a.source_hash) ON CONFLICT(target_kind,target_id) DO NOTHING;
 RETURN jsonb_build_object('status','held','artifactId',a.id,'missing',ARRAY['network_registry_source_withdrawn']);
END$$;
CREATE OR REPLACE FUNCTION gridex_ai_processing.header_company_basis_v1(c uuid,env text,supplier_id text,network_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor_count bigint;id_count bigint; legal_actor uuid;legal_id text;network_basis jsonb;
BEGIN
 IF c IS NULL OR env IS NULL OR env NOT IN ('test','production') OR supplier_id IS NULL OR network_id IS NULL THEN RAISE EXCEPTION 'ai_bi_header_tenant_context_required'; END IF;
 -- Native consistency guard of the canonicalTenantEdielIdentity owner inputs,
 -- with the same unique legal actor/ID, supplier role and half-open intervals.
 -- Technical transport identity and mailbox owner never supply legal parties.
 PERFORM p.id FROM public.tenant_ediel_profiles p WHERE p.company_id=c AND p.environment=env ORDER BY p.id FOR SHARE;
 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=env ORDER BY i.id FOR SHARE;
 PERFORM r.id FROM public.tenant_actor_roles r WHERE r.company_id=c AND r.environment=env ORDER BY r.id FOR SHARE;
 SELECT count(DISTINCT i.actor_id),count(DISTINCT nullif(btrim(i.identifier_value),'')),min(i.actor_id::text)::uuid,min(nullif(btrim(i.identifier_value),''))
 INTO actor_count,id_count,legal_actor,legal_id FROM public.tenant_actor_identifiers i
 WHERE i.company_id=c AND i.environment=env AND i.identifier_type='EdielId' AND i.valid_from<=statement_timestamp() AND (i.valid_to IS NULL OR statement_timestamp()<i.valid_to);
 IF actor_count<>1 OR id_count<>1 OR legal_id IS DISTINCT FROM supplier_id
 OR NOT EXISTS(SELECT FROM public.tenant_ediel_profiles p WHERE p.company_id=c AND p.environment=env AND p.market='electricity' AND p.is_enabled AND p.valid_from<=statement_timestamp() AND (p.valid_to IS NULL OR statement_timestamp()<p.valid_to))
 OR NOT EXISTS(SELECT FROM public.tenant_actor_roles r WHERE r.company_id=c AND r.environment=env AND r.actor_id=legal_actor AND btrim(r.role_code)='electricity_supplier' AND r.valid_from<=statement_timestamp() AND (r.valid_to IS NULL OR statement_timestamp()<r.valid_to)) THEN RAISE EXCEPTION 'ai_bi_header_supplier_tenant_mismatch'; END IF;
 network_basis:=gridex_network_registry_sources.network_for_company_v1(c,network_id,env);
 IF network_basis->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',coalesce(network_basis->>'blocker','ai_bi_network_registry_version_unqualified'); END IF;
 RETURN jsonb_build_object('legalActorId',legal_actor,'legalSupplier',legal_id,'companyId',c,'environment',env,'network',network_basis);
END $$;
CREATE OR REPLACE FUNCTION public.gridex_ai_bi_personal_storage_scope_v1(p_company_id uuid,p_actor_user_id uuid,p_environment text,p_header_line text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h text[];assessment jsonb;basis jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_bi_processing_service_required' USING ERRCODE='42501'; END IF;
 h:=string_to_array(p_header_line,';');
 IF cardinality(h)<>10 OR h[1] NOT IN ('AI','BI') THEN RAISE EXCEPTION 'ai_bi_personal_storage_header_required'; END IF;
 PERFORM gridex_ai_purpose_sources.consumer_v1(p_company_id,p_actor_user_id,'origination',p_environment);assessment:=gridex_ai_purpose_sources.current_for_scope_v1(p_company_id,h[1],'ediel_list_reconciliation',p_environment);
 IF assessment->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',coalesce(assessment->>'blocker','ai_bi_processing_decision_invalid') USING ERRCODE='42501'; END IF;
 basis:=gridex_ai_processing.header_company_basis_v1(p_company_id,p_environment,h[4],h[2]);
 RETURN jsonb_build_object('status','authorized','decision',assessment->'decision','headerBasis',basis);
END $$;
CREATE OR REPLACE FUNCTION gridex_ai_processing.reconcile_source_v1(c uuid,actor uuid,source_id uuid,expected_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
<<reconciliation>>
DECLARE m public.ediel_messages%rowtype; receipt gridex_ai_processing.reconciliation_receipts%rowtype;
 assessment jsonb; header_basis jsonb;import_id uuid; import_row_id uuid; result jsonb; records text[]; head text[]; cols text[];
 raw_columns jsonb; current_values jsonb; reasons text[]; matching integer; matched_rows jsonb; point public.metering_points%rowtype;
 i integer; row_count integer:=0; discrepancy_count integer:=0; normalized text; source_type text;
BEGIN
 IF c IS NULL OR actor IS NULL OR source_id IS NULL OR expected_hash IS NULL OR expected_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'ai_bi_reconciliation_scope_required'; END IF;
 PERFORM a.user_id FROM public.company_memberships a WHERE a.company_id=c AND a.user_id=actor FOR SHARE;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships a WHERE a.company_id=c AND a.user_id=actor AND a.status='active' AND a.is_active AND a.accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
 OR NOT (coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.write'),false) OR coalesce(public.gridex_actor_has_company_permission(actor,c,'ediel_testing.write'),false)) THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.ediel_messages s WHERE s.id=source_id AND s.company_id=c FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_standard IS DISTINCT FROM 'ai_list' OR m.message_family IS DISTINCT FROM 'AI_LIST'
  OR m.message_code IS NULL OR m.message_code NOT IN ('AI','BI') OR m.raw_payload IS NULL OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM expected_hash
  OR expected_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ai_bi_reconciliation_sealed_source_required'; END IF;
 IF gridex_requested_changes.actor_v1(c,actor,'read','method_contract') IS NOT TRUE THEN RAISE EXCEPTION 'ai_bi_current_scoped_read_actor_required' USING ERRCODE='42501';END IF;
 SELECT * INTO receipt FROM gridex_ai_processing.reconciliation_receipts r WHERE r.source_message_id=source_id;
 IF FOUND THEN
  IF receipt.company_id<>c OR receipt.source_payload_hash<>expected_hash THEN RAISE EXCEPTION 'ai_bi_reconciliation_source_conflict'; END IF;
  RETURN receipt.result;
 END IF;
 -- A prior partial legacy import is not evidence of a whole atomic result.
 IF EXISTS(SELECT FROM public.ai_list_imports x WHERE x.source_ediel_message_id=source_id) THEN RAISE EXCEPTION 'ai_bi_legacy_reconciliation_requires_review'; END IF;
 PERFORM gridex_ai_purpose_sources.consumer_v1(c,actor,'origination',m.environment);assessment:=gridex_ai_purpose_sources.current_for_scope_v1(c,m.message_code,'ediel_list_reconciliation',m.environment);
 IF assessment->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',coalesce(assessment->>'blocker','ai_bi_processing_decision_invalid') USING ERRCODE='42501'; END IF;
 IF assessment#>>'{decision,companyId}' IS DISTINCT FROM c::text OR assessment#>>'{decision,listType}' IS DISTINCT FROM m.message_code THEN RAISE EXCEPTION 'ai_bi_processing_decision_mismatch'; END IF;
 -- Bounded physical records, not a second guide-version selector. The actual
 -- native source supplies every column; no caller matching/projection is used.
 IF octet_length(m.raw_payload)>10485760 THEN RAISE EXCEPTION 'ai_bi_reconciliation_resource_bound'; END IF;
 normalized:=replace(m.raw_payload,E'\r\n',E'\n');
 IF left(normalized,1)=chr(65279) THEN normalized:=substring(normalized FROM 2); END IF;
 IF right(normalized,1)=E'\n' THEN normalized:=left(normalized,length(normalized)-1); END IF;
 IF replace(normalized,E'\n','') ~ '[\r\x01-\x1f\x7f]' THEN RAISE EXCEPTION 'ai_bi_reconciliation_source_records_invalid'; END IF;
 records:=string_to_array(normalized,E'\n');
 IF cardinality(records)>100001 THEN RAISE EXCEPTION 'ai_bi_reconciliation_resource_bound'; END IF;
 head:=string_to_array(records[1],';');source_type:=head[1];
 IF cardinality(head)<>10 OR source_type IS DISTINCT FROM m.message_code OR source_type NOT IN ('AI','BI') OR head[2]!~ '^[0-9]{5}$' OR head[4]!~ '^[0-9]{5}$' THEN RAISE EXCEPTION 'ai_bi_reconciliation_source_records_invalid'; END IF;
 IF m.sender_ediel_id IS DISTINCT FROM head[2] OR m.receiver_ediel_id IS DISTINCT FROM head[4] THEN RAISE EXCEPTION 'ai_bi_reconciliation_source_party_mismatch'; END IF;
 header_basis:=gridex_ai_processing.header_company_basis_v1(c,m.environment,head[4],head[2]);
 FOR i IN 2..cardinality(records) LOOP
  cols:=string_to_array(records[i],';');
  IF cardinality(cols)<>22 OR cols[22]<>'' OR cols[1]='' OR cols[2]='' OR cols[3] NOT IN ('9','89') OR cols[3]='9' AND cols[2]!~ '^[0-9]{18}$' THEN RAISE EXCEPTION 'ai_bi_reconciliation_source_records_invalid'; END IF;
 END LOOP;
 INSERT INTO public.ai_list_imports(company_id,list_type,filename,grid_owner_id,status,row_count,raw_payload,metadata,retention_until,gdpr_basis,created_by,processing_decision_id,source_ediel_message_id)
 VALUES(c,source_type,m.file_name,m.grid_owner_id,'parsed',greatest(cardinality(records)-1,0),m.raw_payload,
  jsonb_build_object('reconciliationOnly',true,'masterdataAutoOverwrite',false,'rawColumnsFormat','physical_columns_v1','processingDecision',assessment->'decision','headerBasis',header_basis),
  (assessment#>>'{decision,retentionUntil}')::date,assessment#>>'{decision,gdprBasis}',actor,(assessment#>>'{decision,id}')::uuid,source_id) RETURNING id INTO import_id;
 FOR i IN 2..cardinality(records) LOOP
  cols:=string_to_array(records[i],';'); reasons:=ARRAY[]::text[];current_values:='{}'::jsonb;point:=NULL;matching:=0;
  raw_columns:=jsonb_build_object('physical_columns',to_jsonb(cols[1:21]),'source_row_number',i);
  IF cols[3]='9' THEN
   SELECT count(*),jsonb_agg(to_jsonb(candidate)) INTO matching,matched_rows FROM (
    SELECT p.* FROM public.metering_points p WHERE p.company_id=c AND cols[2] IN (p.metering_point_id,p.meter_point_id,p.ediel_reference,p.site_facility_id) FOR SHARE
   ) candidate;
   IF matching=1 THEN
    point:=jsonb_populate_record(NULL::public.metering_points,matched_rows->0);
    IF point.customer_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.customers customer WHERE customer.id=point.customer_id AND customer.company_id=c)
     OR coalesce(point.customer_site_id,point.site_id) IS NOT NULL AND NOT EXISTS(SELECT FROM public.customer_sites s WHERE s.id=coalesce(point.customer_site_id,point.site_id) AND s.company_id=c) THEN point:=NULL;matching:=0; END IF;
   END IF;
  END IF;
  IF cols[3]<>'9' THEN reasons:=array_append(reasons,'object_identity_agency_unqualified');
  ELSIF matching>1 THEN reasons:=array_append(reasons,'metering_point_ambiguous');
  ELSIF point.id IS NULL THEN reasons:=array_append(reasons,'metering_point_not_found'); END IF;
  IF point.id IS NOT NULL THEN
   current_values:=jsonb_build_object('id',point.id,'company_id',point.company_id,'customer_id',point.customer_id,'site_id',coalesce(point.customer_site_id,point.site_id),'grid_area_code',point.grid_area_code,'grid_owner_ediel_id',point.grid_owner_ediel_id);
   IF nullif(btrim(point.grid_area_code),'') IS NOT NULL AND upper(regexp_replace(point.grid_area_code,'\s','','g')) IS DISTINCT FROM upper(regexp_replace(cols[1],'\s','','g')) THEN reasons:=array_append(reasons,'grid_area_mismatch'); END IF;
   IF nullif(btrim(point.grid_owner_ediel_id),'') IS NOT NULL AND point.grid_owner_ediel_id IS DISTINCT FROM head[2] THEN reasons:=array_append(reasons,'grid_owner_mismatch'); END IF;
  END IF;
  INSERT INTO public.ai_list_import_rows(company_id,import_id,row_number,raw_columns,metering_point_external_id,matched_metering_point_id,matched_customer_id,matched_customer_site_id,match_status,discrepancy_reasons)
  VALUES(c,import_id,i,raw_columns,cols[2],point.id,point.customer_id,coalesce(point.customer_site_id,point.site_id),CASE WHEN point.id IS NULL THEN 'unmatched' WHEN cardinality(reasons)>0 THEN 'discrepancy' ELSE 'matched' END,reasons) RETURNING id INTO import_row_id;
  IF cardinality(reasons)>0 THEN
   discrepancy_count:=discrepancy_count+1;
   INSERT INTO public.ai_list_discrepancies(company_id,import_id,import_row_id,discrepancy_type,severity,current_values,imported_values,status)
   VALUES(c,import_id,import_row_id,reasons[1],CASE WHEN point.id IS NULL THEN 'warning' ELSE 'info' END,current_values,raw_columns,'open');
  END IF;
  row_count:=row_count+1;
 END LOOP;
 UPDATE public.ai_list_imports x SET status=CASE WHEN reconciliation.discrepancy_count>0 THEN 'review_required' ELSE 'matched' END,discrepancy_count=reconciliation.discrepancy_count WHERE x.id=reconciliation.import_id AND x.company_id=c;
 result:=jsonb_build_object('status','applied','importId',import_id,'rowCount',row_count,'discrepancyCount',discrepancy_count);
 INSERT INTO gridex_ai_processing.reconciliation_receipts(source_message_id,company_id,source_payload_hash,import_id,processing_decision_id,actor_user_id,header_basis,result)
 VALUES(source_id,c,expected_hash,import_id,(assessment#>>'{decision,id}')::uuid,actor,header_basis,result);
 RETURN result;
END $$;
CREATE FUNCTION public.ediel_ai_bi_processing_decision_v2(p_company_id uuid,p_actor_user_id uuid,p_list_type text,p_environment text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_purpose_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ai_purpose_sources.consumer_v1(p_company_id,p_actor_user_id,'origination',p_environment);
 RETURN gridex_ai_purpose_sources.current_for_scope_v1(p_company_id,p_list_type,'ediel_list_reconciliation',p_environment);
END$$;
REVOKE ALL ON FUNCTION public.ediel_ai_bi_processing_decision_v2(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_ai_bi_processing_decision_v2(uuid,uuid,text,text) TO service_role;

DO $$DECLARE f regprocedure;BEGIN FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_network_registry_sources' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);END LOOP;END$$;
REVOKE ALL ON FUNCTION public.ediel_archive_network_registry_source_v1(uuid,uuid,jsonb),public.ediel_review_network_registry_source_v1(uuid,uuid,uuid,jsonb),public.ediel_read_network_registry_source_v1(uuid,uuid,uuid,boolean),public.ediel_revoke_network_registry_source_v1(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_archive_network_registry_source_v1(uuid,uuid,jsonb),public.ediel_review_network_registry_source_v1(uuid,uuid,uuid,jsonb),public.ediel_read_network_registry_source_v1(uuid,uuid,uuid,boolean),public.ediel_revoke_network_registry_source_v1(uuid,uuid,uuid,jsonb) TO service_role;
COMMIT;
