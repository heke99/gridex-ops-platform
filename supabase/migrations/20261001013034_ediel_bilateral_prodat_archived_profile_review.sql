-- Supabase CLI 2.118.0. Prospective immutable custody of a scoped bilateral PRODAT
-- transitions profile. Known H/LK codes do not create normative approval. No issuer key, representation, reviewer grant or approval seed.
BEGIN;
CREATE SCHEMA gridex_bilateral_prodat;
REVOKE ALL ON SCHEMA gridex_bilateral_prodat FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.permissions(key,name,category,description,is_active)
 VALUES('ediel.bilateral_profile.review','Review bilateral PRODAT ground','ediel','Separate own-company review of issuer-authenticated bilateral PRODAT original bytes.',true) ON CONFLICT(key) DO NOTHING;
CREATE TABLE gridex_bilateral_prodat.profile_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,environment text NOT NULL,legal_actor_id uuid NOT NULL,dso_actor_id uuid NOT NULL,grid_area_code text NOT NULL,process text NOT NULL,
 bilateral_agreement_id uuid NOT NULL,consumption_supply_period_id uuid,source_reference text NOT NULL,source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),legal_decision_reference text NOT NULL,registry_version text NOT NULL,
 approved_by uuid NOT NULL,approved_at timestamptz NOT NULL,valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL,revoked_at timestamptz,
 CHECK(environment IN('test','production')),CHECK(process IN('normal_start_h','own_end_h','closure_request_lk')),CHECK(valid_to>valid_from));
CREATE TABLE gridex_bilateral_prodat.artifacts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 selector jsonb NOT NULL,scope jsonb NOT NULL,scope_hash text NOT NULL CHECK(scope_hash~'^[a-f0-9]{64}$'),
 source_bytes bytea NOT NULL CHECK(octet_length(source_bytes) BETWEEN 1 AND 8388608),source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),mime_type text NOT NULL CHECK(mime_type IN('application/pdf','text/plain','application/json')),
 source_reference text NOT NULL,source_version text NOT NULL,issuer_receipt jsonb,receipt_hash text NOT NULL CHECK(receipt_hash~'^[a-f0-9]{64}$'),submitted_by uuid NOT NULL REFERENCES auth.users(id),archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,environment,scope_hash,source_hash,receipt_hash));
CREATE TABLE gridex_bilateral_prodat.issuer_keys(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 issuer_code text NOT NULL,legal_issuer_reference text NOT NULL,legal_authority_source_hash text NOT NULL CHECK(legal_authority_source_hash~'^[a-f0-9]{64}$'),
 receipt_signing_key bytea NOT NULL CHECK(octet_length(receipt_signing_key)>=32),valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(valid_to>valid_from));
CREATE TABLE gridex_bilateral_prodat.issuer_representations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 issuer_key_id uuid NOT NULL REFERENCES gridex_bilateral_prodat.issuer_keys(id),legal_actor_id uuid NOT NULL,dso_actor_id uuid NOT NULL,grid_area_code text NOT NULL,
 permitted_kind text NOT NULL CHECK(permitted_kind IN('normal_start_h','own_end_h','closure_request_lk')),bilateral_agreement_id uuid NOT NULL REFERENCES public.tenant_bilateral_agreements(id),
 legal_representation_reference text NOT NULL,legal_authority_source_hash text NOT NULL CHECK(legal_authority_source_hash~'^[a-f0-9]{64}$'),valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(valid_to>valid_from));
CREATE TABLE gridex_bilateral_prodat.issuer_revocations(
 target_kind text NOT NULL CHECK(target_kind IN('key','representation')),target_id uuid NOT NULL,source_reference text NOT NULL,source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(target_kind,target_id));
CREATE TABLE gridex_bilateral_prodat.reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),artifact_id uuid NOT NULL REFERENCES gridex_bilateral_prodat.artifacts(id),
 reviewer_user_id uuid NOT NULL REFERENCES auth.users(id),decision text NOT NULL CHECK(decision IN('approved','held','rejected')),reason text NOT NULL,missing jsonb NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_bilateral_prodat.origins(
 ground_id uuid PRIMARY KEY REFERENCES gridex_bilateral_prodat.profile_versions(id),company_id uuid NOT NULL,artifact_id uuid NOT NULL UNIQUE REFERENCES gridex_bilateral_prodat.artifacts(id),review_id uuid NOT NULL UNIQUE REFERENCES gridex_bilateral_prodat.reviews(id),ground_binding jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['profile_versions','artifacts','issuer_keys','issuer_representations','issuer_revocations','reviews','origins'] LOOP
 EXECUTE format('ALTER TABLE gridex_bilateral_prodat.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_bilateral_prodat.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_bilateral_prodat.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gridex_bilateral_prodat.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_immutable',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gridex_bilateral_prodat.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_no_truncate',t);
 END LOOP;END$$;
CREATE FUNCTION gridex_bilateral_prodat.lock_graph_v1() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 -- Write-compatible serialization precedes every source/market row. Readers
 -- use the same order; no SHARE-to-writer upgrade or grant-revocation race.
 LOCK TABLE gridex_bilateral_prodat.artifacts,gridex_bilateral_prodat.issuer_keys,gridex_bilateral_prodat.issuer_representations,
 gridex_bilateral_prodat.issuer_revocations,gridex_bilateral_prodat.reviews,gridex_bilateral_prodat.origins,
 gridex_bilateral_prodat.profile_versions IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.customer_contracts,public.customer_contract_documents,public.customers,public.customer_sites,public.metering_points,public.grid_owners,public.tenant_bilateral_agreements,public.ediel_rule_packs,public.ediel_message_profiles,public.ediel_segment_rules,public.ediel_field_rules,public.ediel_rule_pack_sources,public.ediel_ack_rules IN SHARE MODE;
END$$;
CREATE FUNCTION gridex_bilateral_prodat.actor_v1(c uuid,actor uuid,mode text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$BEGIN
 PERFORM gridex_bilateral_prodat.lock_graph_v1();
 RETURN mode IN('archive','read','review') AND EXISTS(SELECT FROM public.companies WHERE id=c AND status='active')
 AND EXISTS(SELECT FROM auth.users WHERE id=actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))
 AND EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
 AND EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
 AND public.gridex_actor_has_company_permission(actor,c,CASE mode WHEN 'read' THEN 'communication.read' ELSE 'communication.write' END) IS TRUE
 AND public.gridex_actor_has_company_permission(actor,c,'contracts.read') IS TRUE
 AND public.gridex_actor_has_company_permission(actor,c,CASE mode WHEN 'read' THEN 'metering.read' ELSE 'metering.write' END) IS TRUE
 AND (mode<>'review' OR public.gridex_actor_has_company_permission(actor,c,'ediel.bilateral_profile.review') IS TRUE AND (
 EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND u.effect='allow' AND p.is_active AND p.key='ediel.bilateral_profile.review')
 OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='allow' AND p.is_active AND p.key='ediel.bilateral_profile.review')));
END$$;
CREATE FUNCTION gridex_bilateral_prodat.scope_v1(c uuid,selector jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE agreement public.tenant_bilateral_agreements%rowtype;pack public.ediel_rule_packs%rowtype;profiles jsonb;env text:=selector->>'environment';kind text:=selector->>'kind';first_at timestamptz;last_at timestamptz;ids uuid[];legal uuid;dso uuid;sender text;receiver text;binding jsonb;grammar jsonb;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_graph_v1();
 IF jsonb_typeof(selector) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(selector) k WHERE k NOT IN('environment','kind','rulePackId','bilateralAgreementId','gridAreaCode','validFrom','validTo')) OR (env IN('test','production')) IS NOT TRUE OR (kind IN('normal_start_h','own_end_h','closure_request_lk')) IS NOT TRUE OR nullif(selector->>'gridAreaCode','') IS NULL THEN RETURN NULL;END IF;
 first_at:=(selector->>'validFrom')::timestamptz;last_at:=(selector->>'validTo')::timestamptz;IF NOT isfinite(first_at) OR NOT isfinite(last_at) OR first_at>=last_at THEN RETURN NULL;END IF;
 SELECT array_agg(DISTINCT i.actor_id) INTO ids FROM public.tenant_actor_identifiers i JOIN public.tenant_actor_roles r ON r.company_id=i.company_id AND r.environment=i.environment AND r.actor_id=i.actor_id WHERE i.company_id=c AND i.environment=env AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR now()<i.valid_to) AND r.role_code='electricity_supplier' AND r.valid_from<=now() AND (r.valid_to IS NULL OR now()<r.valid_to);
 IF coalesce(cardinality(ids),0)<>1 OR NOT EXISTS(SELECT FROM public.tenant_ediel_profiles WHERE company_id=c AND environment=env AND market='electricity' AND is_enabled AND valid_from<=now() AND (valid_to IS NULL OR now()<valid_to)) THEN RETURN NULL;END IF;legal:=ids[1];
 SELECT identifier_value INTO sender FROM public.tenant_actor_identifiers WHERE company_id=c AND environment=env AND actor_id=legal AND identifier_type='EdielId' AND valid_from<=now() AND (valid_to IS NULL OR now()<valid_to) ORDER BY id LIMIT 1;
 IF (SELECT count(DISTINCT (company_id,actor_id)) FROM public.tenant_actor_identifiers WHERE environment=env AND identifier_type='EdielId' AND identifier_value=sender AND valid_from<=now() AND(valid_to IS NULL OR now()<valid_to))<>1 THEN RETURN NULL;END IF;
 IF (SELECT count(DISTINCT identifier_value) FROM public.tenant_actor_identifiers WHERE company_id=c AND environment=env AND actor_id=legal AND identifier_type='EdielId' AND valid_from<=now() AND (valid_to IS NULL OR now()<valid_to))<>1 THEN RETURN NULL;END IF;
 SELECT * INTO agreement FROM public.tenant_bilateral_agreements WHERE id=(selector->>'bilateralAgreementId')::uuid AND company_id=c AND environment=env AND is_enabled AND valid_from<=first_at AND (valid_to IS NULL OR last_at<=valid_to) FOR SHARE;
 IF agreement.id IS NULL OR agreement.capability_code IS DISTINCT FROM 'PRODAT:BILATERAL:'||kind OR nullif(agreement.source_reference,'') IS NULL THEN RETURN NULL;END IF;dso:=agreement.counterparty_actor_id;
 SELECT identifier_value INTO receiver FROM public.platform_actor_identifiers WHERE actor_id=dso AND lower(identifier_type) IN('edielid','ediel_id') AND is_verified AND (valid_from IS NULL OR valid_from<=current_date) AND (valid_to IS NULL OR current_date<=valid_to) ORDER BY id LIMIT 1;
 IF (SELECT count(DISTINCT identifier_value) FROM public.platform_actor_identifiers WHERE actor_id=dso AND lower(identifier_type) IN('edielid','ediel_id') AND is_verified AND (valid_from IS NULL OR valid_from<=current_date) AND (valid_to IS NULL OR current_date<=valid_to))<>1 OR (SELECT count(DISTINCT actor_id) FROM public.platform_actor_identifiers WHERE lower(identifier_type) IN('edielid','ediel_id') AND identifier_value=receiver AND is_verified AND (valid_from IS NULL OR valid_from<=current_date) AND (valid_to IS NULL OR current_date<=valid_to))<>1 THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT FROM public.metering_points point JOIN public.customer_sites site ON site.id=coalesce(point.customer_site_id,point.site_id) AND site.company_id=point.company_id JOIN public.grid_owners grid ON grid.id=site.grid_owner_id AND grid.company_id=point.company_id WHERE point.company_id=c AND point.grid_area_code=selector->>'gridAreaCode' AND point.grid_owner_ediel_id=receiver AND grid.ediel_id=receiver AND grid.environment=env AND grid.is_active) THEN RETURN NULL;END IF;
 SELECT * INTO pack FROM public.ediel_rule_packs WHERE id=(selector->>'rulePackId')::uuid AND family='PRODAT' AND market='electricity' AND status IN('active','transition') AND valid_from<=current_date AND(valid_to IS NULL OR current_date<=valid_to) FOR SHARE;
 IF pack.id IS NULL OR pack.guide_version IS DISTINCT FROM '26.A' OR pack.guide_revision IS DISTINCT FROM '3' THEN RETURN NULL;END IF;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.profile_key,p.id) INTO profiles FROM public.ediel_message_profiles p WHERE p.rule_pack_id=pack.id AND p.is_enabled AND (kind='normal_start_h' AND p.message_code IN('Z03','Z04') AND p.transaction_subtype='H' AND(p.message_code='Z03' AND p.direction IN('outbound','both') OR p.message_code='Z04' AND p.direction IN('inbound','both')) OR kind='own_end_h' AND p.message_code='Z05' AND p.transaction_subtype='H' AND p.direction IN('inbound','both') OR kind='closure_request_lk' AND p.message_code IN('Z08','Z05') AND p.transaction_subtype='LK' AND(p.message_code='Z08' AND p.direction IN('outbound','both') OR p.message_code='Z05' AND p.direction IN('inbound','both')));
 IF jsonb_array_length(profiles) IS DISTINCT FROM (CASE kind WHEN 'own_end_h' THEN 1 ELSE 2 END) THEN RETURN NULL;END IF;
 SELECT jsonb_build_object('pack',to_jsonb(pack),'profiles',profiles,'segments',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.ediel_segment_rules r WHERE r.message_profile_id IN(SELECT (p->>'id')::uuid FROM jsonb_array_elements(profiles) p)),
 'fields',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.ediel_field_rules r WHERE r.message_profile_id IN(SELECT (p->>'id')::uuid FROM jsonb_array_elements(profiles) p)),
 'sources',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.ediel_rule_pack_sources r WHERE r.rule_pack_id=pack.id),
 'acks',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.ediel_ack_rules r WHERE r.rule_pack_id=pack.id AND r.inbound_family='PRODAT' AND r.message_code IN(SELECT p->>'message_code' FROM jsonb_array_elements(profiles) p))) INTO grammar;
 IF jsonb_typeof(grammar->'fields') IS DISTINCT FROM 'array' OR jsonb_typeof(grammar->'sources') IS DISTINCT FROM 'array' OR jsonb_typeof(grammar->'acks') IS DISTINCT FROM 'array' OR jsonb_array_length(grammar->'fields')=0 OR jsonb_array_length(grammar->'sources')=0 OR jsonb_array_length(grammar->'acks')=0 THEN RETURN NULL;END IF;
 SELECT jsonb_build_object('profiles',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.tenant_ediel_profiles p WHERE company_id=c AND environment=env AND market='electricity' AND is_enabled),'identifiers',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.tenant_actor_identifiers i WHERE company_id=c AND environment=env AND actor_id=legal),'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.tenant_actor_roles r WHERE company_id=c AND environment=env AND actor_id=legal),'counterparty',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.platform_actor_identifiers i WHERE actor_id=dso AND is_verified)) INTO binding;
 RETURN jsonb_build_object('companyId',c,'environment',env,'kind',kind,'legalActorId',legal,'legalSenderId',sender,'dsoActorId',dso,'legalReceiverId',receiver,'gridArea',selector->>'gridAreaCode','bilateralAgreementId',agreement.id,'agreementBinding',to_jsonb(agreement),'legalBinding',binding,'rulePackId',pack.id,'sourceVersion',pack.guide_version||':r'||pack.guide_revision,'sourceGrammar',grammar,'sourceGrammarHash',encode(sha256(convert_to(grammar::text,'UTF8')),'hex'),'validFrom',first_at,'validTo',last_at);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL;
END$$;
CREATE FUNCTION public.ediel_bilateral_prodat_ground_scope_v1(p_company_id uuid,p_actor_user_id uuid,p_selector jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$DECLARE scope jsonb;BEGIN
 IF gridex_bilateral_prodat.actor_v1(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'bilateral_prodat_scope_actor_forbidden' USING ERRCODE='42501';END IF;
 scope:=gridex_bilateral_prodat.scope_v1(p_company_id,p_selector);IF scope IS NULL THEN RETURN jsonb_build_object('status','held','companyId',p_company_id,'missing',ARRAY['actual_current_own_contract_point_legal_registry_and_bilateral_scope']);END IF;
 RETURN jsonb_build_object('status','scoped','companyId',p_company_id,'scope',scope,'scopeHash',encode(sha256(convert_to(scope::text,'UTF8')),'hex'),'missing','[]'::jsonb);
END$$;
CREATE FUNCTION gridex_bilateral_prodat.receipt_current_v1(a gridex_bilateral_prodat.artifacts) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE k gridex_bilateral_prodat.issuer_keys%rowtype;r gridex_bilateral_prodat.issuer_representations%rowtype;p jsonb;raw bytea;issued timestamptz;expires timestamptz;receipt jsonb:=a.issuer_receipt;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_graph_v1();
 IF receipt IS NULL OR jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(receipt) key WHERE key NOT IN('keyId','representationId','payloadBase64','signatureHex')) OR coalesce(receipt->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 65536
 OR a.source_hash IS DISTINCT FROM encode(sha256(a.source_bytes),'hex') OR a.scope_hash IS DISTINCT FROM encode(sha256(convert_to(a.scope::text,'UTF8')),'hex') THEN RETURN false;END IF;
 SELECT * INTO k FROM gridex_bilateral_prodat.issuer_keys WHERE id=(receipt->>'keyId')::uuid AND company_id=a.company_id AND environment=a.environment;
 SELECT * INTO r FROM gridex_bilateral_prodat.issuer_representations WHERE id=(receipt->>'representationId')::uuid AND issuer_key_id=k.id AND company_id=a.company_id AND environment=a.environment
 AND legal_actor_id::text=a.scope->>'legalActorId' AND dso_actor_id::text=a.scope->>'dsoActorId' AND grid_area_code=a.scope->>'gridArea' AND permitted_kind=a.scope->>'kind' AND bilateral_agreement_id::text=a.scope->>'bilateralAgreementId';
 IF k.id IS NULL OR r.id IS NULL OR now()<k.valid_from OR now()>=k.valid_to OR now()<r.valid_from OR now()>=r.valid_to OR EXISTS(SELECT FROM gridex_bilateral_prodat.issuer_revocations v WHERE v.target_kind='key' AND v.target_id=k.id OR v.target_kind='representation' AND v.target_id=r.id) THEN RETURN false;END IF;
 raw:=decode(receipt->>'payloadBase64','base64');IF sha256(gridex_requested_changes.receipt_hmac_sha256_v1(raw,k.receipt_signing_key)) IS DISTINCT FROM sha256(decode(receipt->>'signatureHex','hex')) THEN RETURN false;END IF;
 p:=convert_from(raw,'UTF8')::jsonb;issued:=(p->>'issuedAt')::timestamptz;expires:=(p->>'expiresAt')::timestamptz;
 RETURN (p->>'format'='ediel_bilateral_prodat_ground_receipt_v1' AND p->>'issuerCode'=k.issuer_code AND nullif(p->>'receiptId','') IS NOT NULL AND p->>'companyId'=a.company_id::text AND p->>'environment'=a.environment AND p->'scope'=a.scope
 AND p->>'sourceHash'=a.source_hash AND p->>'sourceReference'=a.source_reference AND p->>'sourceVersion'=a.source_version AND nullif(p->>'legalDecisionReference','') IS NOT NULL AND length(p->>'legalDecisionReference')<=2000
 AND isfinite(issued) AND isfinite(expires) AND issued<=now() AND expires>(a.scope->>'validTo')::timestamptz AND (a.scope->>'validFrom')::timestamptz>=r.valid_from AND (a.scope->>'validTo')::timestamptz>=r.valid_from AND issued>=greatest(k.valid_from,r.valid_from) AND expires<=least(k.valid_to,r.valid_to)) IS TRUE;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR invalid_datetime_format OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN false;
END$$;
CREATE FUNCTION public.ediel_archive_bilateral_prodat_ground_v1(p_company_id uuid,p_actor_user_id uuid,p_submission jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE v_scope jsonb;selector jsonb;bytes bytea;v_hash text;v_scope_hash text;rh text;a gridex_bilateral_prodat.artifacts%rowtype;
BEGIN
 IF gridex_bilateral_prodat.actor_v1(p_company_id,p_actor_user_id,'archive') IS NOT TRUE THEN RAISE EXCEPTION 'bilateral_prodat_archive_actor_forbidden' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_submission) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_submission) k WHERE k NOT IN('environment','kind','rulePackId','bilateralAgreementId','gridAreaCode','validFrom','validTo','source','issuerReceipt')) OR jsonb_typeof(p_submission->'source') IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_submission->'source') k WHERE k NOT IN('bytesBase64','mimeType','reference','version')) THEN RAISE EXCEPTION 'bilateral_prodat_archive_shape_required';END IF;
 selector:=p_submission-ARRAY['source','issuerReceipt'];v_scope:=gridex_bilateral_prodat.scope_v1(p_company_id,selector);
 IF v_scope IS NULL THEN RETURN jsonb_build_object('status','held','companyId',p_company_id,'missing',ARRAY['actual_current_own_contract_point_legal_registry_and_bilateral_scope']);END IF;
 IF length(coalesce(p_submission#>>'{source,bytesBase64}',''))>11184812 THEN RAISE EXCEPTION 'bilateral_prodat_archive_bytes_limit';END IF;bytes:=decode(p_submission#>>'{source,bytesBase64}','base64');
 IF octet_length(bytes) NOT BETWEEN 1 AND 8388608 OR (p_submission#>>'{source,mimeType}' IN('application/pdf','text/plain','application/json')) IS NOT TRUE OR p_submission#>>'{source,mimeType}'='application/pdf' AND substring(bytes,1,5)<>decode('255044462d','hex')
 OR p_submission#>>'{source,reference}' IS DISTINCT FROM v_scope#>>'{agreementBinding,source_reference}' OR nullif(p_submission#>>'{source,version}','') IS NULL OR length(p_submission#>>'{source,version}')>200 THEN RAISE EXCEPTION 'bilateral_prodat_archive_actual_bytes_reference_version_required';END IF;
 v_hash:=encode(sha256(bytes),'hex');v_scope_hash:=encode(sha256(convert_to(v_scope::text,'UTF8')),'hex');rh:=encode(sha256(convert_to(coalesce(p_submission->'issuerReceipt','null'::jsonb)::text,'UTF8')),'hex');
 SELECT * INTO a FROM gridex_bilateral_prodat.artifacts WHERE company_id=p_company_id AND environment=v_scope->>'environment' AND scope_hash=v_scope_hash AND source_hash=v_hash AND receipt_hash=rh;
 IF FOUND THEN IF a.source_reference IS DISTINCT FROM p_submission#>>'{source,reference}' OR a.source_version IS DISTINCT FROM p_submission#>>'{source,version}' THEN RAISE EXCEPTION 'bilateral_prodat_archive_original_conflict';END IF;
 ELSE INSERT INTO gridex_bilateral_prodat.artifacts(company_id,environment,selector,scope,scope_hash,source_bytes,source_hash,mime_type,source_reference,source_version,issuer_receipt,receipt_hash,submitted_by)
 VALUES(p_company_id,v_scope->>'environment',selector,v_scope,v_scope_hash,bytes,v_hash,p_submission#>>'{source,mimeType}',p_submission#>>'{source,reference}',p_submission#>>'{source,version}',p_submission->'issuerReceipt',rh,p_actor_user_id) RETURNING * INTO a;END IF;
 RETURN jsonb_build_object('status','archived','companyId',p_company_id,'artifactId',a.id,'sourceHash',a.source_hash,'scopeHash',a.scope_hash,'missing',ARRAY['separate_qualified_source_review_required']);
END$$;
CREATE FUNCTION gridex_bilateral_prodat.ground_current_v1(ground uuid,company uuid,effective timestamptz) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE o gridex_bilateral_prodat.origins%rowtype;a gridex_bilateral_prodat.artifacts%rowtype;r gridex_bilateral_prodat.reviews%rowtype;g gridex_bilateral_prodat.profile_versions%rowtype;scope jsonb;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_graph_v1();SELECT * INTO o FROM gridex_bilateral_prodat.origins WHERE ground_id=ground AND company_id=company;SELECT * INTO a FROM gridex_bilateral_prodat.artifacts WHERE id=o.artifact_id AND company_id=company;SELECT * INTO r FROM gridex_bilateral_prodat.reviews WHERE id=o.review_id AND artifact_id=a.id AND company_id=company;SELECT * INTO g FROM gridex_bilateral_prodat.profile_versions WHERE id=ground AND company_id=company;
 IF o.ground_id IS NULL OR a.id IS NULL OR r.id IS NULL OR g.id IS NULL OR r.decision IS DISTINCT FROM 'approved' OR r.reviewer_user_id=a.submitted_by OR g.revoked_at IS NOT NULL OR effective<g.valid_from OR effective>=g.valid_to OR now()<g.valid_from OR now()>=g.valid_to OR o.ground_binding IS DISTINCT FROM to_jsonb(g)-'revoked_at' OR gridex_bilateral_prodat.actor_v1(company,r.reviewer_user_id,'review') IS NOT TRUE OR gridex_bilateral_prodat.receipt_current_v1(a) IS NOT TRUE THEN RETURN false;END IF;
 scope:=gridex_bilateral_prodat.scope_v1(company,a.selector);RETURN scope IS NOT NULL AND scope=a.scope;
END$$;
CREATE FUNCTION public.ediel_review_bilateral_prodat_ground_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_review jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a gridex_bilateral_prodat.artifacts%rowtype;o gridex_bilateral_prodat.origins%rowtype;g gridex_bilateral_prodat.profile_versions%rowtype;scope jsonb;decision text;missing jsonb:='[]';rid uuid;receipt jsonb;
BEGIN
 IF gridex_bilateral_prodat.actor_v1(p_company_id,p_actor_user_id,'review') IS NOT TRUE THEN RAISE EXCEPTION 'bilateral_prodat_review_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT a FROM gridex_bilateral_prodat.artifacts WHERE id=p_artifact_id AND company_id=p_company_id FOR UPDATE;
 decision:=p_review->>'decision';IF jsonb_typeof(p_review) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_review) k WHERE k NOT IN('sourceHash','scopeHash','decision','reason')) OR (decision IN('approve','hold','reject')) IS NOT TRUE OR p_review->>'sourceHash' IS DISTINCT FROM a.source_hash OR p_review->>'scopeHash' IS DISTINCT FROM a.scope_hash OR nullif(p_review->>'reason','') IS NULL OR length(p_review->>'reason')>4000 THEN RAISE EXCEPTION 'bilateral_prodat_review_exact_archived_candidate_required';END IF;
 IF decision='approve' AND a.submitted_by=p_actor_user_id THEN RAISE EXCEPTION 'bilateral_prodat_separate_reviewer_required';END IF;
 SELECT * INTO o FROM gridex_bilateral_prodat.origins WHERE artifact_id=a.id AND company_id=a.company_id;
 IF FOUND THEN IF decision<>'approve' THEN RAISE EXCEPTION 'bilateral_prodat_authorized_ground_requires_revocation';END IF;
 IF gridex_bilateral_prodat.ground_current_v1(o.ground_id,a.company_id,greatest(now(),(a.scope->>'validFrom')::timestamptz)) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','companyId',p_company_id,'artifactId',a.id,'missing',ARRAY['actual_current_qualified_ground']);END IF;
 RETURN jsonb_build_object('status','authorized','companyId',p_company_id,'artifactId',a.id,'profileVersionId',o.ground_id,'missing','[]'::jsonb);END IF;
 IF decision='hold' THEN missing:='["explicit_source_review_hold"]';ELSIF decision='reject' THEN missing:='["explicit_source_review_rejection"]';
 ELSE scope:=gridex_bilateral_prodat.scope_v1(p_company_id,a.selector);
 IF scope IS NULL OR scope IS DISTINCT FROM a.scope THEN missing:='["actual_current_immutable_contract_point_legal_registry_scope"]';
 ELSIF gridex_bilateral_prodat.receipt_current_v1(a) IS NOT TRUE THEN missing:='["authentic_current_issuer_representation_and_legal_ground_receipt"]';END IF;END IF;
 IF missing<>'[]'::jsonb THEN INSERT INTO gridex_bilateral_prodat.reviews(company_id,artifact_id,reviewer_user_id,decision,reason,missing) VALUES(p_company_id,a.id,p_actor_user_id,CASE decision WHEN 'reject' THEN 'rejected' ELSE 'held' END,p_review->>'reason',missing);
 RETURN jsonb_build_object('status',CASE decision WHEN 'reject' THEN 'rejected' ELSE 'held' END,'companyId',p_company_id,'artifactId',a.id,'missing',missing);END IF;
 receipt:=convert_from(decode(a.issuer_receipt->>'payloadBase64','base64'),'UTF8')::jsonb;
 INSERT INTO gridex_bilateral_prodat.reviews(company_id,artifact_id,reviewer_user_id,decision,reason,missing) VALUES(p_company_id,a.id,p_actor_user_id,'approved',p_review->>'reason','[]') RETURNING id INTO rid;
 INSERT INTO gridex_bilateral_prodat.profile_versions(company_id,environment,legal_actor_id,dso_actor_id,grid_area_code,process,bilateral_agreement_id,consumption_supply_period_id,source_reference,source_sha256,legal_decision_reference,registry_version,approved_by,approved_at,valid_from,valid_to)
 VALUES(p_company_id,a.environment,(a.scope->>'legalActorId')::uuid,(a.scope->>'dsoActorId')::uuid,a.scope->>'gridArea',a.scope->>'kind',(a.scope->>'bilateralAgreementId')::uuid,NULL,a.source_reference,a.source_hash,receipt->>'legalDecisionReference',a.source_version||':'||a.scope_hash,p_actor_user_id,(SELECT reviewed_at FROM gridex_bilateral_prodat.reviews WHERE id=rid),(a.scope->>'validFrom')::timestamptz,(a.scope->>'validTo')::timestamptz) RETURNING * INTO g;
 INSERT INTO gridex_bilateral_prodat.origins(ground_id,company_id,artifact_id,review_id,ground_binding) VALUES(g.id,p_company_id,a.id,rid,to_jsonb(g)-'revoked_at');
 IF gridex_bilateral_prodat.ground_current_v1(g.id,p_company_id,greatest(now(),(a.scope->>'validFrom')::timestamptz)) IS NOT TRUE THEN RAISE EXCEPTION 'bilateral_prodat_postwrite_actual_ground_unqualified';END IF;
 RETURN jsonb_build_object('status','authorized','companyId',p_company_id,'artifactId',a.id,'profileVersionId',g.id,'missing','[]'::jsonb);
END$$;
CREATE FUNCTION public.ediel_read_bilateral_prodat_ground_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_include_bytes boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a gridex_bilateral_prodat.artifacts%rowtype;r gridex_bilateral_prodat.reviews%rowtype;o gridex_bilateral_prodat.origins%rowtype;out jsonb;current boolean:=false;
BEGIN
 IF gridex_bilateral_prodat.actor_v1(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'bilateral_prodat_artifact_read_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT a FROM gridex_bilateral_prodat.artifacts WHERE id=p_artifact_id AND company_id=p_company_id;
 SELECT * INTO r FROM gridex_bilateral_prodat.reviews WHERE company_id=p_company_id AND artifact_id=a.id ORDER BY reviewed_at DESC,id DESC LIMIT 1;SELECT * INTO o FROM gridex_bilateral_prodat.origins WHERE company_id=p_company_id AND artifact_id=a.id;
 IF o.ground_id IS NOT NULL THEN current:=gridex_bilateral_prodat.ground_current_v1(o.ground_id,p_company_id,greatest(now(),(a.scope->>'validFrom')::timestamptz));END IF;
 out:=jsonb_build_object('status',CASE WHEN current THEN 'authorized' WHEN o.ground_id IS NOT NULL THEN 'held' WHEN r.id IS NOT NULL THEN r.decision ELSE 'archived' END,'companyId',p_company_id,'artifactId',a.id,'profileVersionId',o.ground_id,'sourceHash',a.source_hash,'scopeHash',a.scope_hash,'scope',a.scope,'sourceReference',a.source_reference,'sourceVersion',a.source_version,'mimeType',a.mime_type,'byteLength',octet_length(a.source_bytes),'missing',CASE WHEN current THEN '[]'::jsonb WHEN o.ground_id IS NOT NULL THEN '["actual_current_qualified_ground"]'::jsonb ELSE coalesce(r.missing,'["separate_qualified_source_review_required"]') END);
 IF p_include_bytes THEN out:=out||jsonb_build_object('bytesBase64',encode(a.source_bytes,'base64'));END IF;RETURN out;
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_bilateral_prodat FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_bilateral_prodat_ground_scope_v1(uuid,uuid,jsonb),public.ediel_archive_bilateral_prodat_ground_v1(uuid,uuid,jsonb),public.ediel_review_bilateral_prodat_ground_v1(uuid,uuid,uuid,jsonb),public.ediel_read_bilateral_prodat_ground_v1(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_bilateral_prodat_ground_scope_v1(uuid,uuid,jsonb),public.ediel_archive_bilateral_prodat_ground_v1(uuid,uuid,jsonb),public.ediel_review_bilateral_prodat_ground_v1(uuid,uuid,uuid,jsonb),public.ediel_read_bilateral_prodat_ground_v1(uuid,uuid,uuid,boolean) TO service_role;

CREATE FUNCTION gridex_bilateral_prodat.first_line_index_v1(raw text,own jsonb) RETURNS integer LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT min(index)::integer FROM(SELECT t,row_number() OVER(ORDER BY ord)-1 index FROM jsonb_array_elements(gridex_received_sources.wire_tokens_bounded_v1(raw,10000)) WITH ORDINALITY source(t,ord) WHERE t->>'tag'='LIN') l WHERE t#>>'{elements,3,0}'=own->>'point' AND t#>>'{elements,3,3}'=own->>'identityAgency'
$$;
-- The permission facet covers the ACTUAL complete physical original. It does
-- not accept application fields or grant a business outcome to any sibling.
CREATE FUNCTION gridex_bilateral_prodat.source_capability_v1(m public.ediel_messages) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE wire jsonb;own jsonb;ids uuid[];g gridex_bilateral_prodat.profile_versions%rowtype;a gridex_bilateral_prodat.artifacts%rowtype;event_at timestamptz;kind text;objects jsonb:='[]';pack jsonb;legal jsonb;scope jsonb;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_graph_v1();
 IF m.id IS NULL OR m.company_id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.raw_payload IS NULL THEN RETURN NULL;END IF;
 PERFORM public.ediel_require_source_bytes_available_v1(m.company_id,m.id);
 IF NOT EXISTS(SELECT FROM gridex_received_sources.sources original WHERE original.source_message_id=m.id AND original.company_id=m.company_id AND original.environment=m.environment AND original.raw_payload=m.raw_payload AND original.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')) THEN RETURN NULL;END IF;
 legal:=gridex_ediel_inbound_context.require_v1(m.company_id,m.id);pack:=gridex_ediel_source_rules.require_v1(m.company_id,m.id);wire:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF wire IS NULL OR wire->>'receiver' IS DISTINCT FROM legal->>'legalEdielId' OR legal->>'actorRole' IS DISTINCT FROM 'electricity_supplier' OR legal->>'code' IS DISTINCT FROM wire->>'code' THEN RETURN NULL;END IF;
 FOR own IN SELECT o FROM jsonb_array_elements(wire->'objects') o LOOP
  kind:=CASE WHEN wire->>'code'='Z04' AND own->>'reason'='Z25' THEN 'normal_start_h' WHEN wire->>'code'='Z05' AND own->>'reason'='Z25' THEN 'own_end_h' WHEN wire->>'code'='Z05' AND own->>'reason'='Z23' THEN 'closure_request_lk' END;
  event_at:=gridex_received_sources.permission_time_v1(own->>CASE wire->>'code' WHEN 'Z04' THEN 'start' ELSE 'end' END);
  IF kind IS NULL OR event_at IS NULL OR nullif(own->>'li','') IS NULL OR nullif(own->>'point','') IS NULL OR (own->>'identityAgency' IN('9','89')) IS NOT TRUE THEN RETURN NULL;END IF;
  IF (SELECT count(*) FROM public.metering_points mp JOIN public.customers customer ON customer.id=mp.customer_id AND customer.company_id=mp.company_id WHERE mp.company_id=m.company_id AND mp.ediel_metering_point_id=own->>'point' AND mp.grid_owner_ediel_id=wire->>'sender' AND mp.grid_area_code=own->>'gridArea')<>1 THEN RETURN NULL;END IF;
  SELECT array_agg(v.id ORDER BY v.id) INTO ids FROM gridex_bilateral_prodat.profile_versions v JOIN gridex_bilateral_prodat.origins origin ON origin.ground_id=v.id AND origin.company_id=v.company_id JOIN gridex_bilateral_prodat.artifacts archived ON archived.id=origin.artifact_id AND archived.company_id=v.company_id
  WHERE v.company_id=m.company_id AND v.environment=m.environment AND v.process=kind AND v.legal_actor_id::text=legal->>'legalActorId' AND v.grid_area_code=own->>'gridArea' AND v.approved_at<=m.message_received_at
   AND archived.scope->>'legalSenderId'=wire->>'receiver' AND archived.scope->>'legalReceiverId'=wire->>'sender'
   AND EXISTS(SELECT FROM jsonb_array_elements(archived.scope#>'{sourceGrammar,profiles}') p WHERE p->>'id'=m.rule_profile_version_id::text AND p->>'message_code'=wire->>'code')
   AND archived.scope->>'rulePackId'=m.canonical_rule_pack_id::text AND archived.scope#>>'{sourceGrammar,pack,source_hash}'=m.rule_pack_checksum
   AND gridex_bilateral_prodat.ground_current_v1(v.id,m.company_id,event_at) IS TRUE;
  IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;
  SELECT * INTO g FROM gridex_bilateral_prodat.profile_versions WHERE id=ids[1];SELECT archived.* INTO a FROM gridex_bilateral_prodat.origins o JOIN gridex_bilateral_prodat.artifacts archived ON archived.id=o.artifact_id AND archived.company_id=o.company_id WHERE o.ground_id=g.id;
  objects:=objects||jsonb_build_array(jsonb_build_object('objectId',own->>'point','identityAgency',own->>'identityAgency','firstLineIndex',gridex_bilateral_prodat.first_line_index_v1(m.raw_payload,own),'lineItemReference',own->>'li','profileVersionId',g.id,'process',kind,'sourceHash',a.source_hash,'sourceGrammarHash',a.scope->>'sourceGrammarHash'));
 END LOOP;
 IF jsonb_array_length(objects)=0 THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('version',1,'owner','immutable-bilateral-prodat-profile-v1','companyId',m.company_id,'environment',m.environment,'sourceMessageId',m.id,'sourcePayloadHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'messageCode',wire->>'code','subtype',CASE WHEN wire->>'code'='Z05' AND objects#>>'{0,process}'='closure_request_lk' THEN 'LK' ELSE 'H' END,'objects',objects);
END$$;
CREATE FUNCTION gridex_regulated_supply.source_capability_v1(m public.ediel_messages) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE wire jsonb;legal jsonb;own jsonb;event_at timestamptz;ids uuid[];point uuid;objects jsonb:='[]';g gridex_received_sources.regulated_supply_ground_versions%rowtype;
BEGIN
 PERFORM gridex_regulated_supply.lock_graph_v1();IF m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.raw_payload IS NULL THEN RETURN NULL;END IF;PERFORM public.ediel_require_source_bytes_available_v1(m.company_id,m.id);
 IF NOT EXISTS(SELECT FROM gridex_received_sources.sources original WHERE original.source_message_id=m.id AND original.company_id=m.company_id AND original.environment=m.environment AND original.raw_payload=m.raw_payload AND original.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')) THEN RETURN NULL;END IF;
 legal:=gridex_ediel_inbound_context.require_v1(m.company_id,m.id);PERFORM gridex_ediel_source_rules.require_v1(m.company_id,m.id);wire:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF wire IS NULL OR wire->>'code' IS DISTINCT FROM 'Z04' OR wire->>'receiver' IS DISTINCT FROM legal->>'legalEdielId' OR legal->>'actorRole' IS DISTINCT FROM 'electricity_supplier' THEN RETURN NULL;END IF;
 FOR own IN SELECT o FROM jsonb_array_elements(wire->'objects') o LOOP
  IF (own->>'reason' IN('Z26','Z70')) IS NOT TRUE THEN RETURN NULL;END IF;event_at:=gridex_received_sources.permission_time_v1(own->>'start');
  SELECT array_agg(mp.id) INTO ids FROM public.metering_points mp WHERE mp.company_id=m.company_id AND mp.ediel_metering_point_id=own->>'point' AND mp.grid_owner_ediel_id=wire->>'sender' AND mp.grid_area_code=own->>'gridArea';IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;point:=ids[1];
  SELECT array_agg(ground.id) INTO ids FROM gridex_received_sources.regulated_supply_ground_versions ground WHERE ground.company_id=m.company_id AND ground.environment=m.environment AND ground.legal_actor_id::text=legal->>'legalActorId' AND ground.process=CASE own->>'reason' WHEN 'Z26' THEN 'assigned_supply' ELSE 'production_receipt_obligation' END AND ground.approved_at<=m.message_received_at AND gridex_regulated_supply.ground_wire_current_v1(ground.id,m.company_id,point,event_at,own) IS TRUE;
  IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;SELECT * INTO g FROM gridex_received_sources.regulated_supply_ground_versions WHERE id=ids[1];
  objects:=objects||jsonb_build_array(jsonb_build_object('objectId',own->>'point','identityAgency',own->>'identityAgency','firstLineIndex',gridex_bilateral_prodat.first_line_index_v1(m.raw_payload,own),'lineItemReference',own->>'li','profileVersionId',g.id,'process',g.process,'sourceHash',g.source_sha256,'sourceGrammarHash',right(g.registry_version,64)));
 END LOOP;
 IF jsonb_array_length(objects)=0 THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('version',1,'owner','immutable-regulated-supply-ground-v1','companyId',m.company_id,'environment',m.environment,'sourceMessageId',m.id,'sourcePayloadHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'messageCode','Z04','subtype',CASE objects#>>'{0,process}' WHEN 'assigned_supply' THEN 'A' ELSE 'D' END,'objects',objects);
END$$;
CREATE FUNCTION public.ediel_read_prodat_bilateral_source_capability_v1(p_company_id uuid,p_source_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype;wire jsonb;result jsonb;BEGIN
 PERFORM gridex_regulated_supply.lock_graph_v1();PERFORM gridex_bilateral_prodat.lock_graph_v1();SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.raw_payload IS NULL THEN RETURN NULL;END IF;wire:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE o->>'reason' IN('Z26','Z70')) THEN RETURN gridex_regulated_supply.source_capability_v1(m);END IF;
 RETURN gridex_bilateral_prodat.source_capability_v1(m);
END$$;
REVOKE ALL ON FUNCTION public.ediel_read_prodat_bilateral_source_capability_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_read_prodat_bilateral_source_capability_v1(uuid,uuid) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_bilateral_prodat FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_regulated_supply.source_capability_v1(public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
