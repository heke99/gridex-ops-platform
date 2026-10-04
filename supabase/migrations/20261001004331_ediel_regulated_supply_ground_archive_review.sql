-- Supabase CLI 2.118.0. Prospective, company-scoped custody of a real regulated
-- legal ground. No issuer key, representation, reviewer grant or approval seed.
BEGIN;
CREATE SCHEMA gridex_regulated_supply;
REVOKE ALL ON SCHEMA gridex_regulated_supply FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.permissions(key,name,category,description,is_active)
 VALUES('ediel.regulated_supply.review','Review regulated supply ground','ediel','Separate own-company review of issuer-authenticated regulated supply original bytes.',true) ON CONFLICT(key) DO NOTHING;
CREATE TABLE gridex_regulated_supply.artifacts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 selector jsonb NOT NULL,scope jsonb NOT NULL,scope_hash text NOT NULL CHECK(scope_hash~'^[a-f0-9]{64}$'),
 source_bytes bytea NOT NULL CHECK(octet_length(source_bytes) BETWEEN 1 AND 8388608),source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),mime_type text NOT NULL CHECK(mime_type IN('application/pdf','text/plain','application/json')),
 source_reference text NOT NULL,source_version text NOT NULL,issuer_receipt jsonb,receipt_hash text NOT NULL CHECK(receipt_hash~'^[a-f0-9]{64}$'),submitted_by uuid NOT NULL REFERENCES auth.users(id),archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,environment,scope_hash,source_hash,receipt_hash));
CREATE TABLE gridex_regulated_supply.issuer_keys(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 issuer_code text NOT NULL,legal_issuer_reference text NOT NULL,legal_authority_source_hash text NOT NULL CHECK(legal_authority_source_hash~'^[a-f0-9]{64}$'),
 receipt_signing_key bytea NOT NULL CHECK(octet_length(receipt_signing_key)>=32),valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(valid_to>valid_from));
CREATE TABLE gridex_regulated_supply.issuer_representations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 issuer_key_id uuid NOT NULL REFERENCES gridex_regulated_supply.issuer_keys(id),legal_actor_id uuid NOT NULL,dso_actor_id uuid NOT NULL,grid_area_code text NOT NULL,
 permitted_kind text NOT NULL CHECK(permitted_kind IN('assigned_supply','production_receipt_obligation')),bilateral_agreement_id uuid NOT NULL REFERENCES public.tenant_bilateral_agreements(id),
 legal_representation_reference text NOT NULL,legal_authority_source_hash text NOT NULL CHECK(legal_authority_source_hash~'^[a-f0-9]{64}$'),valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(valid_to>valid_from));
CREATE TABLE gridex_regulated_supply.issuer_revocations(
 target_kind text NOT NULL CHECK(target_kind IN('key','representation')),target_id uuid NOT NULL,source_reference text NOT NULL,source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(target_kind,target_id));
CREATE TABLE gridex_regulated_supply.reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),artifact_id uuid NOT NULL REFERENCES gridex_regulated_supply.artifacts(id),
 reviewer_user_id uuid NOT NULL REFERENCES auth.users(id),decision text NOT NULL CHECK(decision IN('approved','held','rejected')),reason text NOT NULL,missing jsonb NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_regulated_supply.origins(
 ground_id uuid PRIMARY KEY REFERENCES gridex_received_sources.regulated_supply_ground_versions(id),company_id uuid NOT NULL,artifact_id uuid NOT NULL UNIQUE REFERENCES gridex_regulated_supply.artifacts(id),review_id uuid NOT NULL UNIQUE REFERENCES gridex_regulated_supply.reviews(id),ground_binding jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['artifacts','issuer_keys','issuer_representations','issuer_revocations','reviews','origins'] LOOP
 EXECUTE format('ALTER TABLE gridex_regulated_supply.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_regulated_supply.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_regulated_supply.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gridex_regulated_supply.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_immutable',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gridex_regulated_supply.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_no_truncate',t);
 END LOOP;END$$;
CREATE FUNCTION gridex_regulated_supply.lock_graph_v1() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 -- Write-compatible serialization precedes every source/market row. Readers
 -- use the same order; no SHARE-to-writer upgrade or grant-revocation race.
 LOCK TABLE gridex_regulated_supply.artifacts,gridex_regulated_supply.issuer_keys,gridex_regulated_supply.issuer_representations,
 gridex_regulated_supply.issuer_revocations,gridex_regulated_supply.reviews,gridex_regulated_supply.origins,
 gridex_received_sources.regulated_supply_ground_versions IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.customer_contracts,public.customer_contract_documents,public.customers,public.customer_sites,public.metering_points,public.grid_owners,public.tenant_bilateral_agreements IN SHARE MODE;
END$$;
CREATE FUNCTION gridex_regulated_supply.actor_v1(c uuid,actor uuid,mode text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$BEGIN
 PERFORM gridex_regulated_supply.lock_graph_v1();
 RETURN mode IN('archive','read','review') AND EXISTS(SELECT FROM public.companies WHERE id=c AND status='active')
 AND EXISTS(SELECT FROM auth.users WHERE id=actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))
 AND EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
 AND EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
 AND public.gridex_actor_has_company_permission(actor,c,CASE mode WHEN 'read' THEN 'communication.read' ELSE 'communication.write' END) IS TRUE
 AND public.gridex_actor_has_company_permission(actor,c,'contracts.read') IS TRUE
 AND public.gridex_actor_has_company_permission(actor,c,CASE mode WHEN 'read' THEN 'metering.read' ELSE 'metering.write' END) IS TRUE
 AND (mode<>'review' OR public.gridex_actor_has_company_permission(actor,c,'ediel.regulated_supply.review') IS TRUE AND (
 EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND u.effect='allow' AND p.is_active AND p.key='ediel.regulated_supply.review')
 OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='allow' AND p.is_active AND p.key='ediel.regulated_supply.review')));
END$$;
CREATE FUNCTION gridex_regulated_supply.scope_v1(c uuid,selector jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE contract public.customer_contracts%rowtype;customer public.customers%rowtype;point public.metering_points%rowtype;site public.customer_sites%rowtype;agreement public.tenant_bilateral_agreements%rowtype;doc public.customer_contract_documents%rowtype;
 consumption public.customer_supply_periods%rowtype;consumption_point public.metering_points%rowtype;env text:=selector->>'environment';kind text:=selector->>'kind';at timestamptz;ids uuid[];legal uuid;dso uuid;sender text;registry jsonb;sig text;supply jsonb;legal_binding jsonb;
BEGIN
 PERFORM gridex_regulated_supply.lock_graph_v1();
 IF jsonb_typeof(selector) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(selector) k WHERE k NOT IN('environment','kind','contractId','meteringPointId','identityAgency','bilateralAgreementId','startAt','consumptionSupplyPeriodId')) OR (selector->>'identityAgency' IN('9','89')) IS NOT TRUE OR (env IN('test','production')) IS NOT TRUE OR (kind IN('assigned_supply','production_receipt_obligation')) IS NOT TRUE THEN RETURN NULL;END IF;
 at:=(selector->>'startAt')::timestamptz;IF NOT isfinite(at) OR extract(second FROM at)<>0 THEN RETURN NULL;END IF;
 SELECT * INTO contract FROM public.customer_contracts WHERE id=(selector->>'contractId')::uuid AND company_id=c FOR SHARE;
 SELECT * INTO point FROM public.metering_points WHERE id=(selector->>'meteringPointId')::uuid AND company_id=c FOR SHARE;
 SELECT * INTO customer FROM public.customers WHERE id=point.customer_id AND company_id=c FOR SHARE;
 SELECT * INTO site FROM public.customer_sites WHERE id=coalesce(point.customer_site_id,point.site_id) AND company_id=c AND customer_id=customer.id FOR SHARE;
 IF contract.id IS NULL OR point.id IS NULL OR customer.id IS NULL OR site.id IS NULL OR contract.customer_id IS DISTINCT FROM customer.id OR contract.metering_point_id IS DISTINCT FROM point.id OR contract.status NOT IN('signed','active')
 OR contract.signed_at IS NULL OR contract.signed_version IS DISTINCT FROM contract.contract_version OR nullif(point.ediel_metering_point_id,'') IS NULL OR nullif(point.grid_area_code,'') IS NULL OR nullif(point.grid_owner_ediel_id,'') IS NULL
 OR NOT EXISTS(SELECT FROM public.grid_owners WHERE id=site.grid_owner_id AND company_id=c AND ediel_id=point.grid_owner_ediel_id AND environment=env AND is_active) THEN RETURN NULL;END IF;
 IF (SELECT count(*) FROM public.metering_points owned WHERE owned.company_id=c AND owned.ediel_metering_point_id=point.ediel_metering_point_id)<>1 OR (SELECT count(*) FROM public.customer_contracts owned WHERE owned.company_id=c AND owned.customer_id=customer.id AND owned.metering_point_id=point.id AND owned.status IN('signed','active') AND owned.signed_version=owned.contract_version)<>1 THEN RETURN NULL;END IF;
 sig:=encode(sha256(convert_to(contract.signature_snapshot::text,'UTF8')),'hex');
 SELECT * INTO doc FROM public.customer_contract_documents WHERE company_id=c AND customer_contract_id=contract.id AND document_type='signed_contract_pdf' AND document_sha256=contract.document_sha256 AND verified_at IS NOT NULL ORDER BY id LIMIT 1 FOR SHARE;
 IF doc.id IS NULL OR contract.signature_snapshot_sha256 IS DISTINCT FROM sig OR contract.signature_snapshot->>'company_id' IS DISTINCT FROM c::text OR contract.signature_snapshot->>'customer_id' IS DISTINCT FROM customer.id::text OR contract.signature_snapshot->>'contract_id' IS DISTINCT FROM contract.id::text THEN RETURN NULL;END IF;
 SELECT array_agg(DISTINCT i.actor_id) INTO ids FROM public.tenant_actor_identifiers i JOIN public.tenant_actor_roles r ON r.company_id=i.company_id AND r.environment=i.environment AND r.actor_id=i.actor_id
 WHERE i.company_id=c AND i.environment=env AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR now()<i.valid_to) AND r.role_code='electricity_supplier' AND r.valid_from<=now() AND (r.valid_to IS NULL OR now()<r.valid_to);
 IF coalesce(cardinality(ids),0)<>1 OR NOT EXISTS(SELECT FROM public.tenant_ediel_profiles WHERE company_id=c AND environment=env AND market='electricity' AND is_enabled AND valid_from<=now() AND (valid_to IS NULL OR now()<valid_to)) THEN RETURN NULL;END IF;legal:=ids[1];
 SELECT identifier_value INTO sender FROM public.tenant_actor_identifiers WHERE company_id=c AND environment=env AND actor_id=legal AND identifier_type='EdielId' AND valid_from<=now() AND (valid_to IS NULL OR now()<valid_to) ORDER BY id LIMIT 1;
 IF (SELECT count(DISTINCT identifier_value) FROM public.tenant_actor_identifiers WHERE company_id=c AND environment=env AND actor_id=legal AND identifier_type='EdielId' AND valid_from<=now() AND (valid_to IS NULL OR now()<valid_to))<>1 THEN RETURN NULL;END IF;
 SELECT array_agg(DISTINCT actor_id) INTO ids FROM public.platform_actor_identifiers WHERE lower(identifier_type) IN('edielid','ediel_id') AND identifier_value=point.grid_owner_ediel_id AND is_verified AND (valid_from IS NULL OR valid_from<=(now() AT TIME ZONE 'Etc/GMT-1')::date) AND (valid_to IS NULL OR (now() AT TIME ZONE 'Etc/GMT-1')::date<=valid_to);
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;dso:=ids[1];
 SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]') INTO registry FROM public.platform_actor_identifiers i WHERE actor_id=dso AND lower(identifier_type) IN('edielid','ediel_id') AND identifier_value=point.grid_owner_ediel_id AND is_verified AND (valid_from IS NULL OR valid_from<=(now() AT TIME ZONE 'Etc/GMT-1')::date) AND (valid_to IS NULL OR (now() AT TIME ZONE 'Etc/GMT-1')::date<=valid_to);
 SELECT * INTO agreement FROM public.tenant_bilateral_agreements WHERE id=(selector->>'bilateralAgreementId')::uuid AND company_id=c AND environment=env AND counterparty_actor_id=dso AND is_enabled AND valid_from<=at AND (valid_to IS NULL OR at<valid_to) FOR SHARE;
 IF agreement.id IS NULL OR agreement.capability_code IS DISTINCT FROM (CASE kind WHEN 'assigned_supply' THEN 'PRODAT:Z04:A' ELSE 'PRODAT:Z04:D' END) OR nullif(agreement.source_reference,'') IS NULL THEN RETURN NULL;END IF;
 IF kind='production_receipt_obligation' THEN
  SELECT * INTO consumption FROM public.customer_supply_periods WHERE id=(selector->>'consumptionSupplyPeriodId')::uuid AND company_id=c AND customer_id=customer.id FOR SHARE;
  SELECT * INTO consumption_point FROM public.metering_points WHERE id=consumption.metering_point_id AND company_id=c FOR SHARE;
  supply:=gridex_received_sources.supply_period_source_basis_v1(c,consumption.id,at,at+interval '1 minute');
  IF point.product_direction IS DISTINCT FROM 'production' OR consumption_point.product_direction IS DISTINCT FROM 'consumption' OR supply->>'qualified' IS DISTINCT FROM 'true' OR supply->>'customerId' IS DISTINCT FROM customer.id::text OR nullif(consumption_point.ediel_metering_point_id,'') IS NULL THEN RETURN NULL;END IF;
 ELSIF selector->>'consumptionSupplyPeriodId' IS NOT NULL OR point.product_direction IS DISTINCT FROM 'consumption' THEN RETURN NULL;END IF;
 SELECT jsonb_build_object('profile',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.tenant_ediel_profiles p WHERE company_id=c AND environment=env AND market='electricity' AND is_enabled AND valid_from<=now() AND (valid_to IS NULL OR now()<valid_to)),
 'identifiers',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.tenant_actor_identifiers i WHERE company_id=c AND environment=env AND actor_id=legal AND identifier_type='EdielId' AND valid_from<=now() AND (valid_to IS NULL OR now()<valid_to)),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.tenant_actor_roles r WHERE company_id=c AND environment=env AND actor_id=legal AND role_code='electricity_supplier' AND valid_from<=now() AND (valid_to IS NULL OR now()<valid_to))) INTO legal_binding;
 RETURN jsonb_build_object('companyId',c,'environment',env,'kind',kind,'contractId',contract.id,'contractHash',gridex_received_sources.production_contract_hash_v1(contract),'contractDocumentBinding',to_jsonb(doc),'signatureHash',sig,
 'customerId',customer.id,'customerIdentity',coalesce(nullif(btrim(customer.org_number),''),nullif(btrim(customer.personal_number),'')),'customerHash',encode(sha256(convert_to(to_jsonb(customer)::text,'UTF8')),'hex'),
 'meteringPointId',point.id,'point',point.ediel_metering_point_id,'identityAgency',selector->>'identityAgency','pointHash',encode(sha256(convert_to(to_jsonb(point)::text,'UTF8')),'hex'),'siteHash',encode(sha256(convert_to(to_jsonb(site)::text,'UTF8')),'hex'),
 'legalActorId',legal,'legalSenderId',sender,'dsoActorId',dso,'legalReceiverId',point.grid_owner_ediel_id,'gridArea',point.grid_area_code,'registryBinding',registry,'legalBinding',legal_binding,
 'bilateralAgreementId',agreement.id,'agreementBinding',to_jsonb(agreement),'startAt',at,'consumptionSupplyPeriodId',consumption.id,'consumptionPoint',consumption_point.ediel_metering_point_id,'consumptionBasis',supply);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL;
END$$;
CREATE FUNCTION public.ediel_regulated_supply_ground_scope_v1(p_company_id uuid,p_actor_user_id uuid,p_selector jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$DECLARE scope jsonb;BEGIN
 IF gridex_regulated_supply.actor_v1(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'regulated_supply_scope_actor_forbidden' USING ERRCODE='42501';END IF;
 scope:=gridex_regulated_supply.scope_v1(p_company_id,p_selector);IF scope IS NULL THEN RETURN jsonb_build_object('status','held','companyId',p_company_id,'missing',ARRAY['actual_current_own_contract_point_legal_registry_and_bilateral_scope']);END IF;
 RETURN jsonb_build_object('status','scoped','companyId',p_company_id,'scope',scope,'scopeHash',encode(sha256(convert_to(scope::text,'UTF8')),'hex'),'missing','[]'::jsonb);
END$$;
CREATE FUNCTION gridex_regulated_supply.receipt_current_v1(a gridex_regulated_supply.artifacts) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE k gridex_regulated_supply.issuer_keys%rowtype;r gridex_regulated_supply.issuer_representations%rowtype;p jsonb;raw bytea;issued timestamptz;expires timestamptz;receipt jsonb:=a.issuer_receipt;
BEGIN
 PERFORM gridex_regulated_supply.lock_graph_v1();
 IF receipt IS NULL OR jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(receipt) key WHERE key NOT IN('keyId','representationId','payloadBase64','signatureHex')) OR coalesce(receipt->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 65536
 OR a.source_hash IS DISTINCT FROM encode(sha256(a.source_bytes),'hex') OR a.scope_hash IS DISTINCT FROM encode(sha256(convert_to(a.scope::text,'UTF8')),'hex') THEN RETURN false;END IF;
 SELECT * INTO k FROM gridex_regulated_supply.issuer_keys WHERE id=(receipt->>'keyId')::uuid AND company_id=a.company_id AND environment=a.environment;
 SELECT * INTO r FROM gridex_regulated_supply.issuer_representations WHERE id=(receipt->>'representationId')::uuid AND issuer_key_id=k.id AND company_id=a.company_id AND environment=a.environment
 AND legal_actor_id::text=a.scope->>'legalActorId' AND dso_actor_id::text=a.scope->>'dsoActorId' AND grid_area_code=a.scope->>'gridArea' AND permitted_kind=a.scope->>'kind' AND bilateral_agreement_id::text=a.scope->>'bilateralAgreementId';
 IF k.id IS NULL OR r.id IS NULL OR now()<k.valid_from OR now()>=k.valid_to OR now()<r.valid_from OR now()>=r.valid_to OR EXISTS(SELECT FROM gridex_regulated_supply.issuer_revocations v WHERE v.target_kind='key' AND v.target_id=k.id OR v.target_kind='representation' AND v.target_id=r.id) THEN RETURN false;END IF;
 raw:=decode(receipt->>'payloadBase64','base64');IF sha256(gridex_requested_changes.receipt_hmac_sha256_v1(raw,k.receipt_signing_key)) IS DISTINCT FROM sha256(decode(receipt->>'signatureHex','hex')) THEN RETURN false;END IF;
 p:=convert_from(raw,'UTF8')::jsonb;issued:=(p->>'issuedAt')::timestamptz;expires:=(p->>'expiresAt')::timestamptz;
 RETURN (p->>'format'='ediel_regulated_supply_ground_receipt_v1' AND p->>'issuerCode'=k.issuer_code AND nullif(p->>'receiptId','') IS NOT NULL AND p->>'companyId'=a.company_id::text AND p->>'environment'=a.environment AND p->'scope'=a.scope
 AND p->>'sourceHash'=a.source_hash AND p->>'sourceReference'=a.source_reference AND p->>'sourceVersion'=a.source_version AND nullif(p->>'legalDecisionReference','') IS NOT NULL AND length(p->>'legalDecisionReference')<=2000
 AND isfinite(issued) AND isfinite(expires) AND issued<=now() AND expires>greatest(now(),(a.scope->>'startAt')::timestamptz) AND (a.scope->>'startAt')::timestamptz>=r.valid_from AND issued>=greatest(k.valid_from,r.valid_from) AND expires<=least(k.valid_to,r.valid_to)) IS TRUE;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR invalid_datetime_format OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN false;
END$$;
CREATE FUNCTION public.ediel_archive_regulated_supply_ground_v1(p_company_id uuid,p_actor_user_id uuid,p_submission jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE v_scope jsonb;selector jsonb;bytes bytea;v_hash text;v_scope_hash text;rh text;a gridex_regulated_supply.artifacts%rowtype;
BEGIN
 IF gridex_regulated_supply.actor_v1(p_company_id,p_actor_user_id,'archive') IS NOT TRUE THEN RAISE EXCEPTION 'regulated_supply_archive_actor_forbidden' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_submission) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_submission) k WHERE k NOT IN('environment','kind','contractId','meteringPointId','identityAgency','bilateralAgreementId','startAt','consumptionSupplyPeriodId','source','issuerReceipt')) OR jsonb_typeof(p_submission->'source') IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_submission->'source') k WHERE k NOT IN('bytesBase64','mimeType','reference','version')) THEN RAISE EXCEPTION 'regulated_supply_archive_shape_required';END IF;
 selector:=p_submission-ARRAY['source','issuerReceipt'];v_scope:=gridex_regulated_supply.scope_v1(p_company_id,selector);
 IF v_scope IS NULL THEN RETURN jsonb_build_object('status','held','companyId',p_company_id,'missing',ARRAY['actual_current_own_contract_point_legal_registry_and_bilateral_scope']);END IF;
 IF length(coalesce(p_submission#>>'{source,bytesBase64}',''))>11184812 THEN RAISE EXCEPTION 'regulated_supply_archive_bytes_limit';END IF;bytes:=decode(p_submission#>>'{source,bytesBase64}','base64');
 IF octet_length(bytes) NOT BETWEEN 1 AND 8388608 OR (p_submission#>>'{source,mimeType}' IN('application/pdf','text/plain','application/json')) IS NOT TRUE OR p_submission#>>'{source,mimeType}'='application/pdf' AND substring(bytes,1,5)<>decode('255044462d','hex')
 OR p_submission#>>'{source,reference}' IS DISTINCT FROM v_scope#>>'{agreementBinding,source_reference}' OR nullif(p_submission#>>'{source,version}','') IS NULL OR length(p_submission#>>'{source,version}')>200 THEN RAISE EXCEPTION 'regulated_supply_archive_actual_bytes_reference_version_required';END IF;
 v_hash:=encode(sha256(bytes),'hex');v_scope_hash:=encode(sha256(convert_to(v_scope::text,'UTF8')),'hex');rh:=encode(sha256(convert_to(coalesce(p_submission->'issuerReceipt','null'::jsonb)::text,'UTF8')),'hex');
 SELECT * INTO a FROM gridex_regulated_supply.artifacts WHERE company_id=p_company_id AND environment=v_scope->>'environment' AND scope_hash=v_scope_hash AND source_hash=v_hash AND receipt_hash=rh;
 IF FOUND THEN IF a.source_reference IS DISTINCT FROM p_submission#>>'{source,reference}' OR a.source_version IS DISTINCT FROM p_submission#>>'{source,version}' THEN RAISE EXCEPTION 'regulated_supply_archive_original_conflict';END IF;
 ELSE INSERT INTO gridex_regulated_supply.artifacts(company_id,environment,selector,scope,scope_hash,source_bytes,source_hash,mime_type,source_reference,source_version,issuer_receipt,receipt_hash,submitted_by)
 VALUES(p_company_id,v_scope->>'environment',selector,v_scope,v_scope_hash,bytes,v_hash,p_submission#>>'{source,mimeType}',p_submission#>>'{source,reference}',p_submission#>>'{source,version}',p_submission->'issuerReceipt',rh,p_actor_user_id) RETURNING * INTO a;END IF;
 RETURN jsonb_build_object('status','archived','companyId',p_company_id,'artifactId',a.id,'sourceHash',a.source_hash,'scopeHash',a.scope_hash,'missing',ARRAY['separate_qualified_source_review_required']);
END$$;
CREATE FUNCTION gridex_regulated_supply.ground_current_v1(ground uuid,company uuid,point uuid,effective timestamptz) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE o gridex_regulated_supply.origins%rowtype;a gridex_regulated_supply.artifacts%rowtype;r gridex_regulated_supply.reviews%rowtype;g gridex_received_sources.regulated_supply_ground_versions%rowtype;scope jsonb;
BEGIN
 PERFORM gridex_regulated_supply.lock_graph_v1();
 SELECT * INTO o FROM gridex_regulated_supply.origins WHERE ground_id=ground AND company_id=company;
 SELECT * INTO a FROM gridex_regulated_supply.artifacts WHERE id=o.artifact_id AND company_id=company;SELECT * INTO r FROM gridex_regulated_supply.reviews WHERE id=o.review_id AND artifact_id=a.id AND company_id=company;
 SELECT * INTO g FROM gridex_received_sources.regulated_supply_ground_versions WHERE id=ground AND company_id=company;
 IF o.ground_id IS NULL OR a.id IS NULL OR r.decision IS DISTINCT FROM 'approved' OR r.reviewer_user_id=a.submitted_by OR gridex_regulated_supply.actor_v1(company,r.reviewer_user_id,'review') IS NOT TRUE
 OR g.revoked_at IS NOT NULL OR (to_jsonb(g)-'revoked_at') IS DISTINCT FROM o.ground_binding OR g.approved_by IS DISTINCT FROM r.reviewer_user_id OR g.approved_at IS DISTINCT FROM r.reviewed_at
 OR a.scope->>'meteringPointId' IS DISTINCT FROM point::text OR (a.scope->>'startAt')::timestamptz IS DISTINCT FROM effective OR gridex_regulated_supply.receipt_current_v1(a) IS NOT TRUE THEN RETURN false;END IF;
 scope:=gridex_regulated_supply.scope_v1(company,a.selector);RETURN scope IS NOT NULL AND scope=a.scope;
END$$;
CREATE FUNCTION public.ediel_review_regulated_supply_ground_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_review jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a gridex_regulated_supply.artifacts%rowtype;o gridex_regulated_supply.origins%rowtype;g gridex_received_sources.regulated_supply_ground_versions%rowtype;scope jsonb;decision text;missing jsonb:='[]';rid uuid;receipt jsonb;
BEGIN
 IF gridex_regulated_supply.actor_v1(p_company_id,p_actor_user_id,'review') IS NOT TRUE THEN RAISE EXCEPTION 'regulated_supply_review_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT a FROM gridex_regulated_supply.artifacts WHERE id=p_artifact_id AND company_id=p_company_id FOR UPDATE;
 decision:=p_review->>'decision';IF jsonb_typeof(p_review) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_review) k WHERE k NOT IN('sourceHash','scopeHash','decision','reason')) OR (decision IN('approve','hold','reject')) IS NOT TRUE OR p_review->>'sourceHash' IS DISTINCT FROM a.source_hash OR p_review->>'scopeHash' IS DISTINCT FROM a.scope_hash OR nullif(p_review->>'reason','') IS NULL OR length(p_review->>'reason')>4000 THEN RAISE EXCEPTION 'regulated_supply_review_exact_archived_candidate_required';END IF;
 IF decision='approve' AND a.submitted_by=p_actor_user_id THEN RAISE EXCEPTION 'regulated_supply_separate_reviewer_required';END IF;
 SELECT * INTO o FROM gridex_regulated_supply.origins WHERE artifact_id=a.id AND company_id=a.company_id;
 IF FOUND THEN IF decision<>'approve' THEN RAISE EXCEPTION 'regulated_supply_authorized_ground_requires_revocation';END IF;
 IF gridex_regulated_supply.ground_current_v1(o.ground_id,a.company_id,(a.scope->>'meteringPointId')::uuid,(a.scope->>'startAt')::timestamptz) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','companyId',p_company_id,'artifactId',a.id,'missing',ARRAY['actual_current_qualified_ground']);END IF;
 RETURN jsonb_build_object('status','authorized','companyId',p_company_id,'artifactId',a.id,'groundId',o.ground_id,'missing','[]'::jsonb);END IF;
 IF decision='hold' THEN missing:='["explicit_source_review_hold"]';ELSIF decision='reject' THEN missing:='["explicit_source_review_rejection"]';
 ELSE scope:=gridex_regulated_supply.scope_v1(p_company_id,a.selector);
 IF scope IS NULL OR scope IS DISTINCT FROM a.scope THEN missing:='["actual_current_immutable_contract_point_legal_registry_scope"]';
 ELSIF gridex_regulated_supply.receipt_current_v1(a) IS NOT TRUE THEN missing:='["authentic_current_issuer_representation_and_legal_ground_receipt"]';END IF;END IF;
 IF missing<>'[]'::jsonb THEN INSERT INTO gridex_regulated_supply.reviews(company_id,artifact_id,reviewer_user_id,decision,reason,missing) VALUES(p_company_id,a.id,p_actor_user_id,CASE decision WHEN 'reject' THEN 'rejected' ELSE 'held' END,p_review->>'reason',missing);
 RETURN jsonb_build_object('status',CASE decision WHEN 'reject' THEN 'rejected' ELSE 'held' END,'companyId',p_company_id,'artifactId',a.id,'missing',missing);END IF;
 receipt:=convert_from(decode(a.issuer_receipt->>'payloadBase64','base64'),'UTF8')::jsonb;
 INSERT INTO gridex_regulated_supply.reviews(company_id,artifact_id,reviewer_user_id,decision,reason,missing) VALUES(p_company_id,a.id,p_actor_user_id,'approved',p_review->>'reason','[]') RETURNING id INTO rid;
 INSERT INTO gridex_received_sources.regulated_supply_ground_versions(company_id,environment,legal_actor_id,dso_actor_id,grid_area_code,process,bilateral_agreement_id,consumption_supply_period_id,source_reference,source_sha256,legal_decision_reference,registry_version,approved_by,approved_at,valid_from,valid_to)
 VALUES(p_company_id,a.environment,(a.scope->>'legalActorId')::uuid,(a.scope->>'dsoActorId')::uuid,a.scope->>'gridArea',a.scope->>'kind',(a.scope->>'bilateralAgreementId')::uuid,(a.scope->>'consumptionSupplyPeriodId')::uuid,a.source_reference,a.source_hash,receipt->>'legalDecisionReference',a.source_version||':'||a.scope_hash,p_actor_user_id,(SELECT reviewed_at FROM gridex_regulated_supply.reviews WHERE id=rid),(a.scope->>'startAt')::timestamptz,least((a.scope#>>'{agreementBinding,valid_to}')::timestamptz,(receipt->>'expiresAt')::timestamptz)) RETURNING * INTO g;
 INSERT INTO gridex_regulated_supply.origins(ground_id,company_id,artifact_id,review_id,ground_binding) VALUES(g.id,p_company_id,a.id,rid,to_jsonb(g)-'revoked_at');
 IF gridex_regulated_supply.ground_current_v1(g.id,p_company_id,(a.scope->>'meteringPointId')::uuid,(a.scope->>'startAt')::timestamptz) IS NOT TRUE THEN RAISE EXCEPTION 'regulated_supply_postwrite_actual_ground_unqualified';END IF;
 RETURN jsonb_build_object('status','authorized','companyId',p_company_id,'artifactId',a.id,'groundId',g.id,'missing','[]'::jsonb);
END$$;
CREATE FUNCTION public.ediel_read_regulated_supply_ground_v1(p_company_id uuid,p_actor_user_id uuid,p_artifact_id uuid,p_include_bytes boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a gridex_regulated_supply.artifacts%rowtype;r gridex_regulated_supply.reviews%rowtype;o gridex_regulated_supply.origins%rowtype;out jsonb;current boolean:=false;
BEGIN
 IF gridex_regulated_supply.actor_v1(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'regulated_supply_artifact_read_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT a FROM gridex_regulated_supply.artifacts WHERE id=p_artifact_id AND company_id=p_company_id;
 SELECT * INTO r FROM gridex_regulated_supply.reviews WHERE company_id=p_company_id AND artifact_id=a.id ORDER BY reviewed_at DESC,id DESC LIMIT 1;SELECT * INTO o FROM gridex_regulated_supply.origins WHERE company_id=p_company_id AND artifact_id=a.id;
 IF o.ground_id IS NOT NULL THEN current:=gridex_regulated_supply.ground_current_v1(o.ground_id,p_company_id,(a.scope->>'meteringPointId')::uuid,(a.scope->>'startAt')::timestamptz);END IF;
 out:=jsonb_build_object('status',CASE WHEN current THEN 'authorized' WHEN o.ground_id IS NOT NULL THEN 'held' WHEN r.id IS NOT NULL THEN r.decision ELSE 'archived' END,'companyId',p_company_id,'artifactId',a.id,'groundId',o.ground_id,'sourceHash',a.source_hash,'scopeHash',a.scope_hash,'scope',a.scope,'sourceReference',a.source_reference,'sourceVersion',a.source_version,'mimeType',a.mime_type,'byteLength',octet_length(a.source_bytes),'missing',CASE WHEN current THEN '[]'::jsonb WHEN o.ground_id IS NOT NULL THEN '["actual_current_qualified_ground"]'::jsonb ELSE coalesce(r.missing,'["separate_qualified_source_review_required"]') END);
 IF p_include_bytes THEN out:=out||jsonb_build_object('bytesBase64',encode(a.source_bytes,'base64'));END IF;RETURN out;
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_regulated_supply FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_regulated_supply_ground_scope_v1(uuid,uuid,jsonb),public.ediel_archive_regulated_supply_ground_v1(uuid,uuid,jsonb),public.ediel_review_regulated_supply_ground_v1(uuid,uuid,uuid,jsonb),public.ediel_read_regulated_supply_ground_v1(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_regulated_supply_ground_scope_v1(uuid,uuid,jsonb),public.ediel_archive_regulated_supply_ground_v1(uuid,uuid,jsonb),public.ediel_review_regulated_supply_ground_v1(uuid,uuid,uuid,jsonb),public.ediel_read_regulated_supply_ground_v1(uuid,uuid,uuid,boolean) TO service_role;

CREATE FUNCTION gridex_regulated_supply.ground_wire_current_v1(ground uuid,company uuid,point uuid,effective timestamptz,own jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a gridex_regulated_supply.artifacts%rowtype;BEGIN
 IF gridex_regulated_supply.ground_current_v1(ground,company,point,effective) IS NOT TRUE THEN RETURN false;END IF;
 SELECT archive.* INTO a FROM gridex_regulated_supply.origins o JOIN gridex_regulated_supply.artifacts archive ON archive.id=o.artifact_id AND archive.company_id=o.company_id WHERE o.ground_id=ground AND o.company_id=company;
 RETURN (a.scope->>'point'=own->>'point' AND a.scope->>'identityAgency'=own->>'identityAgency' AND a.scope->>'customerIdentity'=own->>'customerIdentity' AND a.scope->>'gridArea'=own->>'gridArea'
 AND a.scope->>'kind'=CASE own->>'reason' WHEN 'Z26' THEN 'assigned_supply' WHEN 'Z70' THEN 'production_receipt_obligation' END
 AND (a.scope->>'kind'<>'production_receipt_obligation' OR a.scope->>'consumptionPoint'=own->>'consumptionPoint')) IS TRUE;
END$$;
-- Complete current definitions retained; only actual regulated source ownership
-- and its auth-first entry are additive. No normal or mixed guard is removed.
CREATE OR REPLACE FUNCTION gridex_received_sources.apply_supply_before_legal_context_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype;sp public.customer_supply_periods%rowtype;sw public.supplier_switch_requests%rowtype;origin public.ediel_messages%rowtype;
 prior gridex_received_sources.supply_source_transitions%rowtype;ground gridex_received_sources.regulated_supply_ground_versions%rowtype;
 wire jsonb;original jsonb;own jsonb;entry jsonb;plan jsonb;plans jsonb:='[]';before_states jsonb:='[]';after_states jsonb;old jsonb;
 ids uuid[];point public.metering_points%rowtype;consumption public.metering_points%rowtype;legal_actor uuid;dso_actor uuid;
 event_at timestamptz;start_at timestamptz;reason text;period_id uuid;expected_version bigint;qualified boolean;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR p_actor_user_id IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','supply_source_unavailable');END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,m.company_id,'metering.write'),false)
 OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) THEN RETURN jsonb_build_object('applied',false,'reason','supply_execution_actor_unqualified');END IF;
 SELECT * INTO prior FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id;
 IF FOUND AND (prior.company_id IS DISTINCT FROM m.company_id OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')) THEN RAISE EXCEPTION 'supply_replay_conflict';END IF;
 IF NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=m.id AND v.company_id=m.company_id AND v.environment=m.environment AND v.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
 AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND v.facts_text::jsonb->>'applicationDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN jsonb_build_object('applied',false,'reason','canonical_supply_source_not_accepted');END IF;
 wire:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF wire IS NULL OR (wire->>'code' IN ('Z04','Z05')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','supply_wire_unavailable');END IF;
 -- No mixed physical subtype, duplicate point, or partially applied message.
 SELECT o->>'reason' INTO reason FROM jsonb_array_elements(wire->'objects') o LIMIT 1;
 IF nullif(reason,'') IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE o->>'reason' IS DISTINCT FROM reason OR nullif(o->>'point','') IS NULL OR nullif(o->>'li','') IS NULL)
 OR (SELECT count(DISTINCT o->>'point') FROM jsonb_array_elements(wire->'objects') o)<>jsonb_array_length(wire->'objects') THEN RETURN jsonb_build_object('applied',false,'reason','supply_object_scope_unqualified');END IF;
 IF prior.source_message_id IS NOT NULL THEN
  IF wire->>'code'='Z04' AND reason IN('Z26','Z70') AND EXISTS(SELECT FROM jsonb_array_elements(prior.resulting_states) saved WHERE gridex_regulated_supply.ground_current_v1((saved#>>'{metadata,sourceGroundId}')::uuid,m.company_id,(saved->>'metering_point_id')::uuid,(saved->>'market_start_at')::timestamptz) IS NOT TRUE) THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_current_ground_required');END IF;
  RETURN jsonb_build_object('applied',true,'idempotent',true,'periods',prior.resulting_states);
 END IF;
 PERFORM tp.id FROM public.tenant_ediel_profiles tp WHERE tp.company_id=m.company_id AND tp.environment=m.environment ORDER BY tp.id FOR SHARE;
 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=m.company_id AND i.environment=m.environment ORDER BY i.id FOR SHARE;
 PERFORM r.id FROM public.tenant_actor_roles r WHERE r.company_id=m.company_id AND r.environment=m.environment ORDER BY r.id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.tenant_ediel_profiles tp WHERE tp.company_id=m.company_id AND tp.environment=m.environment AND tp.market='electricity' AND tp.is_enabled AND tp.valid_from<=m.message_received_at AND (tp.valid_to IS NULL OR m.message_received_at<tp.valid_to)) THEN RETURN jsonb_build_object('applied',false,'reason','supply_tenant_profile_unqualified');END IF;
 SELECT array_agg(DISTINCT i.actor_id) INTO ids FROM public.tenant_actor_identifiers i JOIN public.tenant_actor_roles r ON r.company_id=i.company_id AND r.environment=i.environment AND r.actor_id=i.actor_id
 WHERE i.company_id=m.company_id AND i.environment=m.environment AND i.identifier_type='EdielId' AND i.identifier_value=wire->>'receiver' AND i.valid_from<=m.message_received_at AND (i.valid_to IS NULL OR m.message_received_at<i.valid_to)
 AND r.role_code='electricity_supplier' AND r.valid_from<=m.message_received_at AND (r.valid_to IS NULL OR m.message_received_at<r.valid_to);
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','supply_legal_actor_unqualified');END IF;legal_actor:=ids[1];
 FOR own IN SELECT o FROM jsonb_array_elements(wire->'objects') o ORDER BY o->>'point' LOOP
  event_at:=gridex_received_sources.permission_time_v1(own->>CASE WHEN wire->>'code'='Z04' THEN 'start' ELSE 'end' END);
  IF event_at IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','supply_effective_time_unavailable');END IF;
  IF wire->>'code'='Z04' AND reason IN ('Z26','Z70') THEN
   SELECT array_agg(mp.id ORDER BY mp.id) INTO ids FROM public.metering_points mp WHERE mp.company_id=m.company_id AND mp.ediel_metering_point_id=own->>'point' AND mp.grid_area_code=own->>'gridArea' AND mp.grid_owner_ediel_id=wire->>'sender'
    AND mp.customer_id IS NOT NULL AND (m.customer_id IS NULL OR m.customer_id=mp.customer_id) AND (m.metering_point_id IS NULL OR m.metering_point_id=mp.id);
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_exact_object_unavailable');END IF;
   SELECT * INTO point FROM public.metering_points WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   PERFORM customer.id FROM public.customers customer WHERE customer.id=point.customer_id AND customer.company_id=m.company_id FOR SHARE;
   IF NOT EXISTS(SELECT FROM public.customers customer WHERE customer.id=point.customer_id AND customer.company_id=m.company_id AND own->>'customerIdentity'=coalesce(nullif(btrim(customer.org_number),''),nullif(btrim(customer.personal_number),''))) THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_customer_identity_unqualified');END IF;
   PERFORM ai.id FROM public.platform_actor_identifiers ai WHERE lower(ai.identifier_type) IN ('edielid','ediel_id') AND ai.identifier_value=wire->>'sender' ORDER BY ai.id FOR SHARE;
   SELECT array_agg(DISTINCT ai.actor_id) INTO ids FROM public.platform_actor_identifiers ai WHERE lower(ai.identifier_type) IN ('edielid','ediel_id') AND ai.identifier_value=wire->>'sender' AND ai.is_verified AND (ai.valid_from IS NULL OR ai.valid_from<=(m.message_received_at AT TIME ZONE 'Etc/GMT-1')::date) AND (ai.valid_to IS NULL OR (m.message_received_at AT TIME ZONE 'Etc/GMT-1')::date<=ai.valid_to);
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_dso_registry_unavailable');END IF;dso_actor:=ids[1];
   PERFORM ba.id FROM public.tenant_bilateral_agreements ba WHERE ba.company_id=m.company_id AND ba.environment=m.environment AND ba.counterparty_actor_id=dso_actor ORDER BY ba.id FOR SHARE;
   PERFORM g.id FROM gridex_received_sources.regulated_supply_ground_versions g WHERE g.company_id=m.company_id AND g.environment=m.environment AND g.legal_actor_id=legal_actor AND g.dso_actor_id=dso_actor AND g.grid_area_code=own->>'gridArea' ORDER BY g.id FOR SHARE;
   SELECT array_agg(g.id ORDER BY g.id) INTO ids FROM gridex_received_sources.regulated_supply_ground_versions g JOIN public.tenant_bilateral_agreements ba ON ba.id=g.bilateral_agreement_id AND ba.company_id=g.company_id AND ba.environment=g.environment AND ba.counterparty_actor_id=g.dso_actor_id
   WHERE g.company_id=m.company_id AND g.environment=m.environment AND g.legal_actor_id=legal_actor AND g.dso_actor_id=dso_actor AND g.grid_area_code=own->>'gridArea' AND g.process=CASE reason WHEN 'Z26' THEN 'assigned_supply' ELSE 'production_receipt_obligation' END
    AND gridex_regulated_supply.ground_wire_current_v1(g.id,m.company_id,point.id,event_at,own) IS TRUE
    AND g.approved_at<=m.message_received_at AND g.revoked_at IS NULL AND g.valid_from<=event_at AND (g.valid_to IS NULL OR event_at<g.valid_to) AND ba.is_enabled AND ba.valid_from<=event_at AND (ba.valid_to IS NULL OR event_at<ba.valid_to) AND ba.source_reference=g.source_reference;
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_authentic_ground_required');END IF;
   SELECT * INTO ground FROM gridex_received_sources.regulated_supply_ground_versions WHERE id=ids[1] FOR SHARE;
   IF reason='Z70' THEN
    SELECT cp.* INTO consumption FROM public.customer_supply_periods rel JOIN public.metering_points cp ON cp.id=rel.metering_point_id AND cp.company_id=rel.company_id JOIN public.customer_contracts cc ON cc.id=coalesce(rel.customer_contract_id,rel.contract_id) AND cc.company_id=rel.company_id AND cc.customer_id=rel.customer_id
    WHERE rel.id=ground.consumption_supply_period_id AND rel.company_id=m.company_id AND rel.customer_id=point.customer_id AND cp.ediel_metering_point_id=own->>'consumptionPoint' AND cp.product_direction='consumption' AND cc.energy_direction='consumption' AND cc.status IN ('signed','active') AND rel.status IN ('active','confirmed_by_grid_owner')
    AND rel.start_date<=gridex_received_sources.permission_date_v1(own->>'start') AND (rel.end_date IS NULL OR rel.end_date>gridex_received_sources.permission_date_v1(own->>'start')) FOR SHARE OF rel,cp,cc;
    IF NOT FOUND OR point.product_direction IS DISTINCT FROM 'production' THEN RETURN jsonb_build_object('applied',false,'reason','production_obligation_own_consumption_link_required');END IF;
   END IF;
   IF EXISTS(SELECT FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.metering_point_id=point.id AND p.status NOT IN ('cancelled','ended') AND (p.end_date IS NULL OR p.end_date>gridex_received_sources.permission_date_v1(own->>'start'))) THEN RETURN jsonb_build_object('applied',false,'reason','regulated_supply_conflicting_period');END IF;
   period_id:=gen_random_uuid();plans:=plans||jsonb_build_array(jsonb_build_object('kind','regulated','periodId',period_id,'pointId',point.id,'customerId',point.customer_id,'eventAt',event_at,'groundId',ground.id,'object',own));
  ELSIF wire->>'code'='Z04' AND reason='Z24' THEN
   -- Match every cancellation to its sealed, actually sent original Z03.
   SELECT array_agg(s.id ORDER BY s.id) INTO ids FROM public.supplier_switch_requests s JOIN public.ediel_messages z ON z.id=s.outbound_z03_message_id AND z.company_id=s.company_id AND z.environment=m.environment
    WHERE s.company_id=m.company_id AND z.direction='outbound' AND gridex_received_sources.sent_source_is_current_v1(z)
    AND EXISTS(SELECT FROM jsonb_array_elements(gridex_received_sources.supply_wire_v1(z.raw_payload)->'objects') o WHERE o->>'point'=own->>'point' AND o->>'li'=own->>'li' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'start'=own->>'start' AND o->>'reason' IN ('Z22','Z23'))
    AND gridex_received_sources.supply_wire_v1(z.raw_payload)->>'sender'=wire->>'receiver' AND gridex_received_sources.supply_wire_v1(z.raw_payload)->>'receiver'=wire->>'sender';
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z04c_exact_original_unavailable');END IF;
   SELECT * INTO sw FROM public.supplier_switch_requests WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   SELECT * INTO origin FROM public.ediel_messages WHERE id=sw.outbound_z03_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
   original:=gridex_received_sources.supply_wire_v1(origin.raw_payload);
   IF NOT FOUND OR origin.direction IS DISTINCT FROM 'outbound' OR gridex_received_sources.sent_source_is_current_v1(origin) IS NOT TRUE
    OR original IS NULL OR original->>'code' IS DISTINCT FROM 'Z03' OR original->>'sender' IS DISTINCT FROM wire->>'receiver' OR original->>'receiver' IS DISTINCT FROM wire->>'sender'
    OR origin.customer_id IS DISTINCT FROM sw.customer_id OR origin.metering_point_id IS DISTINCT FROM sw.metering_point_id OR (m.customer_id IS NOT NULL AND m.customer_id<>sw.customer_id) OR (m.metering_point_id IS NOT NULL AND m.metering_point_id<>sw.metering_point_id)
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(original->'objects') o WHERE o->>'point'=own->>'point' AND o->>'li'=own->>'li' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'start'=own->>'start' AND o->>'reason' IN ('Z22','Z23'))
    THEN RETURN jsonb_build_object('applied',false,'reason','z04c_locked_original_mismatch');END IF;
   IF (sw.status IN ('draft','prepared','queued','sent','submitted','waiting','waiting_for_z04','accepted','cancellation_requested','cancelled_before_start')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','z04c_effect_already_executed_compensation_required');END IF;
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.customer_id=sw.customer_id AND p.metering_point_id=sw.metering_point_id AND (p.source_switch_request_id=sw.id OR p.source_message_id=sw.inbound_z04_message_id);
   IF coalesce(cardinality(ids),0)>1 THEN RETURN jsonb_build_object('applied',false,'reason','z04c_conflicting_periods');END IF;
   IF coalesce(cardinality(ids),0)=1 THEN
    SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
    IF sp.status IS DISTINCT FROM 'confirmed_by_grid_owner' OR sp.customer_id IS DISTINCT FROM sw.customer_id OR sp.metering_point_id IS DISTINCT FROM sw.metering_point_id OR sp.start_date IS DISTINCT FROM gridex_received_sources.permission_date_v1(own->>'start') OR coalesce(sp.market_start_at,sp.start_date::timestamp AT TIME ZONE 'Etc/GMT-1')<=now() THEN RETURN jsonb_build_object('applied',false,'reason','z04c_effect_already_executed_compensation_required');END IF;
    before_states:=before_states||jsonb_build_array(to_jsonb(sp));period_id:=sp.id;
   ELSE period_id:=NULL;END IF;
   plans:=plans||jsonb_build_array(jsonb_build_object('kind','cancel_start','periodId',period_id,'switchId',sw.id,'object',own));
  ELSIF wire->>'code'='Z05' AND reason='Z24' THEN
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p JOIN gridex_received_sources.supply_source_transitions tr ON tr.source_message_id=p.source_end_message_id AND tr.company_id=p.company_id
    JOIN public.ediel_messages z ON z.id=tr.source_message_id AND z.company_id=tr.company_id AND z.environment=m.environment
    WHERE p.company_id=m.company_id AND z.direction='inbound' AND tr.payload_hash=encode(sha256(convert_to(z.raw_payload,'UTF8')),'hex') AND gridex_received_sources.supply_wire_v1(z.raw_payload)->>'sender'=wire->>'sender' AND gridex_received_sources.supply_wire_v1(z.raw_payload)->>'receiver'=wire->>'receiver'
    AND EXISTS(SELECT FROM jsonb_array_elements(tr.source_objects) o WHERE o->>'point'=own->>'point' AND o->>'li'=own->>'li' AND o->>'end'=own->>'end')
    AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) state WHERE state->>'id'=p.id::text AND (state->>'market_state_version')::bigint=p.market_state_version AND (state-ARRAY['updated_at','status'])=(to_jsonb(p)-ARRAY['updated_at','status']));
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z05c_exact_original_ending_unavailable');END IF;
   SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   SELECT * INTO prior FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=sp.source_end_message_id AND company_id=m.company_id;
   SELECT state INTO old FROM jsonb_array_elements(prior.previous_states) state WHERE state->>'id'=sp.id::text;
   IF old IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(prior.resulting_states) saved WHERE saved->>'id'=sp.id::text AND (sp.status=saved->>'status' OR sp.status='ended' AND saved->>'status'='ending' AND sp.market_end_at<=now())) OR EXISTS(SELECT FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.metering_point_id=sp.metering_point_id AND p.id<>sp.id AND p.status NOT IN ('ended','cancelled') AND (p.end_date IS NULL OR p.end_date>sp.start_date)) THEN RETURN jsonb_build_object('applied',false,'reason','z05c_conflicting_continuation');END IF;
   before_states:=before_states||jsonb_build_array(to_jsonb(sp));plans:=plans||jsonb_build_array(jsonb_build_object('kind','restore_end','periodId',sp.id,'previous',old,'object',own));
  ELSIF wire->>'code'='Z05' AND reason IN ('Z22','Z23') THEN
   -- Actual accepted baseline owner ties the physical object to a relationship;
   -- a unique local row or DATE similarity is never sufficient authority.
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p
    WHERE p.company_id=m.company_id AND p.status IN ('active','confirmed_by_grid_owner','ending') AND p.source_end_message_id IS NULL AND (
     EXISTS(SELECT FROM gridex_received_sources.object_assessments assessment JOIN gridex_received_sources.sources src ON src.source_message_id=assessment.source_message_id AND src.company_id=assessment.company_id AND src.payload_hash=assessment.source_payload_hash
      JOIN public.ediel_messages base ON base.id=src.source_message_id AND base.company_id=src.company_id AND base.environment=src.environment AND base.direction='inbound' AND src.payload_hash=encode(sha256(convert_to(base.raw_payload,'UTF8')),'hex')
      CROSS JOIN LATERAL jsonb_array_elements(assessment.facts_text::jsonb->'objects') object
      WHERE assessment.company_id=p.company_id AND assessment.environment=m.environment AND assessment.source_message_id=p.source_message_id
       AND object->>'disposition'='accepted' AND object#>>'{object,objectId}'=own->>'point' AND object#>>'{object,identityAgency}'='9'
       AND object#>>'{business,supplyPeriodId}'=p.id::text AND object#>>'{business,customerId}'=p.customer_id::text AND object#>>'{business,meteringPointId}'=p.metering_point_id::text
       AND object#>>'{business,owner}' IN ('inbound-z04-switch-confirmation-v1','reviewed-received-structure-v1')
       AND object#>>'{party,parties,legalSender}'=wire->>'sender' AND object#>>'{party,parties,legalReceiver}'=wire->>'receiver'
       AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=assessment.id))
     OR EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions tr JOIN public.ediel_messages base ON base.id=tr.source_message_id AND base.company_id=tr.company_id AND base.environment=m.environment AND base.direction='inbound'
      WHERE tr.company_id=p.company_id AND tr.source_message_id=p.source_message_id AND tr.source_code='Z04' AND tr.payload_hash=encode(sha256(convert_to(base.raw_payload,'UTF8')),'hex')
       AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) state WHERE state->>'id'=p.id::text AND state->>'customer_id'=p.customer_id::text AND state->>'metering_point_id'=p.metering_point_id::text)
       AND EXISTS(SELECT FROM jsonb_array_elements(tr.source_objects) object WHERE object->>'point'=own->>'point' AND object->>'customerIdentity'=own->>'customerIdentity' AND object->>'gridArea'=own->>'gridArea' AND object->>'reason' IN ('Z26','Z70')))
    );
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z05_accepted_relationship_baseline_required');END IF;
   SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
   SELECT * INTO origin FROM public.ediel_messages WHERE id=sp.source_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
   original:=gridex_received_sources.supply_wire_v1(origin.raw_payload);
   IF original IS NULL OR original->>'code' IS DISTINCT FROM 'Z04' OR original->>'sender' IS DISTINCT FROM wire->>'sender' OR original->>'receiver' IS DISTINCT FROM wire->>'receiver'
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(original->'objects') o WHERE o->>'point'=own->>'point' AND o->>'customerIdentity'=own->>'customerIdentity' AND o->>'gridArea'=own->>'gridArea' AND gridex_received_sources.permission_time_v1(o->>'start')<event_at)
    OR (m.customer_id IS NOT NULL AND m.customer_id<>sp.customer_id) OR (m.metering_point_id IS NOT NULL AND m.metering_point_id<>sp.metering_point_id) THEN RETURN jsonb_build_object('applied',false,'reason','z05_original_object_mismatch');END IF;
   before_states:=before_states||jsonb_build_array(to_jsonb(sp));plans:=plans||jsonb_build_array(jsonb_build_object('kind','end','periodId',sp.id,'eventAt',event_at,'object',own));
  ELSE RETURN jsonb_build_object('applied',false,'reason','supply_profile_not_qualified');END IF;
 END LOOP;
 -- All owned objects, current originals and ground records are locked/qualified.
 FOR plan IN SELECT x FROM jsonb_array_elements(plans) x LOOP
  IF plan->>'kind'='regulated' THEN
   INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,start_date,market_start_at,source,source_process,source_message_id,status,market_state_version,metadata)
    VALUES((plan->>'periodId')::uuid,m.company_id,(plan->>'customerId')::uuid,(plan->>'pointId')::uuid,gridex_received_sources.permission_date_v1(plan#>>'{object,start}'),(plan->>'eventAt')::timestamptz,'ediel_qualified_source',CASE reason WHEN 'Z26' THEN 'assigned_supply' ELSE 'production_receipt_obligation' END,m.id,'confirmed_by_grid_owner',1,jsonb_build_object('sourceGroundId',plan->>'groundId','sourceObject',plan->'object','sourceReceivedAt',m.message_received_at));
  ELSIF plan->>'kind'='cancel_start' THEN
   UPDATE public.supplier_switch_requests SET status='cancelled_before_start',inbound_z04_message_id=m.id,completed_at=now(),updated_at=now() WHERE id=(plan->>'switchId')::uuid AND company_id=m.company_id;
   UPDATE public.customer_supply_periods SET status='cancelled',market_state_version=market_state_version+1,updated_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('startCancellationSource',m.id) WHERE id=(plan->>'periodId')::uuid AND company_id=m.company_id;
  ELSIF plan->>'kind'='end' THEN
   UPDATE public.customer_supply_periods SET end_date=gridex_received_sources.permission_date_v1(plan#>>'{object,end}'),market_end_at=(plan->>'eventAt')::timestamptz,source_end_message_id=m.id,status=CASE WHEN (plan->>'eventAt')::timestamptz<=now() THEN 'ended' ELSE 'ending' END,market_state_version=market_state_version+1,updated_at=now() WHERE id=(plan->>'periodId')::uuid AND company_id=m.company_id;
  ELSIF plan->>'kind'='restore_end' THEN
   UPDATE public.customer_supply_periods SET status=plan#>>'{previous,status}',end_date=(plan#>>'{previous,end_date}')::date,market_end_at=(plan#>>'{previous,market_end_at}')::timestamptz,source_end_message_id=(plan#>>'{previous,source_end_message_id}')::uuid,market_state_version=market_state_version+1,updated_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('endCancellationSource',m.id) WHERE id=(plan->>'periodId')::uuid AND company_id=m.company_id;
  END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) INTO after_states FROM public.customer_supply_periods p WHERE p.company_id=m.company_id AND p.id IN (SELECT (planned->>'periodId')::uuid FROM jsonb_array_elements(plans) planned);
 INSERT INTO gridex_received_sources.supply_source_transitions(source_message_id,company_id,payload_hash,source_code,source_objects,previous_states,resulting_states,qualified_switch_ids,actor_user_id) VALUES(m.id,m.company_id,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),wire->>'code',wire->'objects',before_states,after_states,ARRAY(SELECT (planned->>'switchId')::uuid FROM jsonb_array_elements(plans) planned WHERE planned->>'kind'='cancel_start'),p_actor_user_id);
 RETURN jsonb_build_object('applied',true,'periods',after_states,'regulated',wire->>'code'='Z04' AND reason IN ('Z26','Z70'));
END $$;
CREATE OR REPLACE FUNCTION public.ediel_apply_supply_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;w jsonb;ids uuid[];
BEGIN
 PERFORM gridex_regulated_supply.lock_graph_v1();
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 w:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF m.direction='inbound' AND m.message_family='PRODAT' AND w->>'code'='Z04' THEN
  -- A normal replay returns its immutable receipt before original locks.
  -- Original-before-switch order protects the preserved cancellation path.
  IF EXISTS(SELECT FROM jsonb_array_elements(w->'objects') o WHERE o->>'reason' IN('Z22','Z23')) THEN RETURN gridex_received_sources.normal_switch_confirm_v1(p_company_id,p_source_message_id,p_actor_user_id);END IF;
  SELECT array_agg(DISTINCT s.outbound_z03_message_id ORDER BY s.outbound_z03_message_id) INTO ids FROM public.supplier_switch_requests s WHERE s.company_id=p_company_id AND EXISTS(SELECT FROM jsonb_array_elements(w->'objects') o WHERE o->>'li'=s.rff_li_reference);
  PERFORM z.id FROM public.ediel_messages z WHERE z.company_id=p_company_id AND z.id=ANY(ids) ORDER BY z.id FOR SHARE;
 END IF;
 RETURN gridex_received_sources.apply_supply_before_normal_switch_v1(p_company_id,p_source_message_id,p_actor_user_id);
END $$;
CREATE OR REPLACE FUNCTION gridex_received_sources.advance_supply_before_normal_switch_v1(p_company_id uuid,p_actor_user_id uuid,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE changed integer;activated integer;
BEGIN
 PERFORM gridex_regulated_supply.lock_graph_v1();
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') THEN RETURN jsonb_build_object('updated',0);END IF;
 WITH due AS (SELECT p.id FROM public.customer_supply_periods p JOIN gridex_received_sources.supply_source_transitions tr ON tr.source_message_id=p.source_end_message_id AND tr.company_id=p.company_id JOIN public.ediel_messages m ON m.id=tr.source_message_id AND m.company_id=tr.company_id WHERE (p_company_id IS NULL OR p.company_id=p_company_id) AND coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p.company_id,'metering.write'),false) AND EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) AND p.status='ending' AND p.market_end_at<=now() AND tr.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) s WHERE s->>'id'=p.id::text AND (s->>'market_state_version')::bigint=p.market_state_version AND (s->>'market_end_at')::timestamptz=p.market_end_at) ORDER BY p.market_end_at,p.id LIMIT least(greatest(coalesce(p_limit,100),1),200) FOR UPDATE OF p SKIP LOCKED)
 UPDATE public.customer_supply_periods p SET status='ended',updated_at=now() FROM due WHERE p.id=due.id AND (p_company_id IS NULL OR p.company_id=p_company_id) AND p.status='ending';
 GET DIAGNOSTICS changed=ROW_COUNT;
 -- These are separate regulated market relationships. No ordinary Z03 or
 -- consumer-contract activation/notification is introduced by this profile.
 WITH due AS (
  SELECT p.id FROM public.customer_supply_periods p JOIN gridex_received_sources.supply_source_transitions tr ON tr.source_message_id=p.source_message_id AND tr.company_id=p.company_id
  JOIN public.ediel_messages m ON m.id=tr.source_message_id AND m.company_id=tr.company_id
  JOIN gridex_received_sources.regulated_supply_ground_versions g ON g.id::text=p.metadata->>'sourceGroundId' AND g.company_id=p.company_id AND g.environment=m.environment
  JOIN public.tenant_bilateral_agreements ba ON ba.id=g.bilateral_agreement_id AND ba.company_id=g.company_id AND ba.environment=g.environment AND ba.counterparty_actor_id=g.dso_actor_id
  JOIN public.tenant_actor_roles role ON role.company_id=p.company_id AND role.environment=m.environment AND role.actor_id=g.legal_actor_id AND role.role_code='electricity_supplier' AND role.valid_from<=now() AND (role.valid_to IS NULL OR now()<role.valid_to)
  JOIN public.tenant_ediel_profiles profile ON profile.company_id=p.company_id AND profile.environment=m.environment AND profile.market='electricity' AND profile.is_enabled AND profile.valid_from<=now() AND (profile.valid_to IS NULL OR now()<profile.valid_to)
  WHERE (p_company_id IS NULL OR p.company_id=p_company_id) AND p.status='confirmed_by_grid_owner' AND p.source_process IN ('assigned_supply','production_receipt_obligation') AND p.market_start_at<=now()
   AND coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p.company_id,'metering.write'),false) AND EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
   AND gridex_regulated_supply.ground_current_v1(g.id,p.company_id,p.metering_point_id,p.market_start_at) IS TRUE
   AND tr.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND g.revoked_at IS NULL AND g.valid_from<=now() AND (g.valid_to IS NULL OR now()<g.valid_to) AND ba.is_enabled AND ba.source_reference=g.source_reference AND ba.valid_from<=now() AND (ba.valid_to IS NULL OR now()<ba.valid_to)
      AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states) saved WHERE saved->>'id'=p.id::text AND (saved->>'market_state_version')::bigint=p.market_state_version AND (saved->>'market_start_at')::timestamptz=p.market_start_at AND saved->>'customer_id'=p.customer_id::text AND saved->>'metering_point_id'=p.metering_point_id::text AND saved->>'source_process'=p.source_process AND saved->'metadata'=p.metadata)
   ORDER BY p.market_start_at,p.id LIMIT least(greatest(coalesce(p_limit,100),1),200) FOR UPDATE OF p SKIP LOCKED FOR SHARE OF g,ba,role,profile)
 UPDATE public.customer_supply_periods p SET status='active',updated_at=now() FROM due WHERE p.id=due.id AND p.status='confirmed_by_grid_owner';
 GET DIAGNOSTICS activated=ROW_COUNT;RETURN jsonb_build_object('updated',changed+activated);

END $$;
CREATE OR REPLACE FUNCTION gridex_received_sources.supply_period_source_basis_v1(p_company_id uuid,p_period_id uuid,p_start timestamptz,p_end timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.customer_supply_periods%rowtype;proof gridex_received_sources.normal_switch_confirmations%rowtype;
 tr gridex_received_sources.supply_source_transitions%rowtype;activation gridex_received_sources.normal_supply_activations%rowtype;
 m public.ediel_messages%rowtype;origin public.ediel_messages%rowtype;initial_message public.ediel_messages%rowtype;c public.customer_contracts%rowtype;s public.supplier_switch_requests%rowtype;
 expected jsonb;baseline jsonb;legal jsonb;initial_owned jsonb;source_objects jsonb;initial_wire jsonb;accepted_original jsonb;initial_transition gridex_received_sources.supply_source_transitions%rowtype;ids uuid[];version bigint;source_id uuid;
BEGIN
 PERFORM gridex_regulated_supply.lock_graph_v1();
 IF p_company_id IS NULL OR p_period_id IS NULL OR p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_end<=p_start THEN RETURN NULL;END IF;
 SELECT * INTO p FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF p.source_process IN('assigned_supply','production_receipt_obligation') AND gridex_regulated_supply.ground_current_v1((p.metadata->>'sourceGroundId')::uuid,p_company_id,p.metering_point_id,p.market_start_at) IS NOT TRUE THEN RETURN NULL;END IF;
 SELECT * INTO proof FROM gridex_received_sources.normal_switch_confirmations WHERE period_id=p.id AND company_id=p_company_id;
 IF NOT FOUND THEN
  baseline:=gridex_received_sources.billing_supply_before_normal_switch_v1(p_company_id,p_period_id,p_start,p_end);
  IF baseline IS NULL THEN RETURN NULL;END IF;
  SELECT * INTO p FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id;
  IF p.market_state_version IS DISTINCT FROM (baseline->>'marketStateVersion')::bigint THEN RETURN NULL;END IF;
  SELECT own#>'{metadata,sourceObject}' INTO initial_owned FROM gridex_received_sources.supply_source_transitions initial,jsonb_array_elements(initial.resulting_states) own WHERE initial.source_message_id=p.source_message_id AND initial.company_id=p_company_id AND own->>'id'=p.id::text;
  SELECT * INTO origin FROM public.ediel_messages WHERE id=p.source_message_id AND company_id=p_company_id;
  SELECT jsonb_agg(own) INTO source_objects FROM jsonb_array_elements(gridex_received_sources.normal_switch_wire_v1(origin.raw_payload)->'objects') own WHERE own->>'point'=initial_owned->>'point' AND own->>'li'=initial_owned->>'li' AND own->>'start'=initial_owned->>'start';
  IF jsonb_array_length(source_objects) IS DISTINCT FROM 1 OR (source_objects#>>'{0,identityAgency}' IN('9','89')) IS NOT TRUE THEN RETURN NULL;END IF;
  RETURN baseline||jsonb_build_object('initialSourceMessageId',p.source_message_id,'legalActorId',(SELECT g.legal_actor_id FROM gridex_received_sources.regulated_supply_ground_versions g WHERE g.id::text=baseline->>'groundId' AND g.company_id=p_company_id),'sourceObjects',source_objects,'dsoEdielId',gridex_received_sources.normal_switch_wire_v1(origin.raw_payload)->>'sender');
 END IF;
 version:=p.market_state_version;source_id:=p.source_message_id;
 SELECT array_agg(t.source_message_id) INTO ids FROM gridex_received_sources.supply_source_transitions t WHERE t.company_id=p_company_id AND EXISTS(SELECT FROM jsonb_array_elements(t.resulting_states) own WHERE own->>'id'=p.id::text AND (own->>'market_state_version')::bigint=version);
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;
 PERFORM z.id FROM public.ediel_messages z WHERE z.company_id=p_company_id AND z.id=ANY(ARRAY[ids[1],source_id,proof.source_message_id,proof.original_message_id]) ORDER BY z.id FOR UPDATE;
 legal:=gridex_ediel_inbound_context.require_v1(p_company_id,proof.source_message_id);
 SELECT * INTO initial_message FROM public.ediel_messages WHERE id=proof.source_message_id AND company_id=p_company_id;
 SELECT * INTO initial_transition FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=proof.source_message_id AND company_id=p_company_id;
 initial_wire:=gridex_received_sources.normal_switch_wire_v1(initial_message.raw_payload);
 IF initial_message.direction IS DISTINCT FROM 'inbound' OR initial_message.message_family IS DISTINCT FROM 'PRODAT' OR initial_message.message_code IS DISTINCT FROM 'Z04'
  OR initial_transition.payload_hash IS DISTINCT FROM encode(sha256(convert_to(initial_message.raw_payload,'UTF8')),'hex')
  OR initial_wire->>'receiver' IS DISTINCT FROM proof.legal_context->>'legalEdielId' OR nullif(initial_wire->>'sender','') IS NULL
  OR (SELECT count(*) FROM jsonb_array_elements(initial_wire->'objects') own WHERE own=proof.source_object)<>1
  OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=initial_message.id AND v.company_id=p_company_id AND v.environment=initial_message.environment AND v.source_payload_hash=initial_transition.payload_hash AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND (v.facts_text::jsonb->>'applicationDecision'='accepted' OR gridex_received_sources.mixed_period_canonical_v1(v.id,p_company_id,proof.period_id,proof.source_message_id)) AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN NULL;END IF;
 SELECT * INTO s FROM public.supplier_switch_requests WHERE id=proof.switch_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO p FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id FOR SHARE;
 IF p.market_state_version IS DISTINCT FROM version OR p.source_message_id IS DISTINCT FROM source_id OR p.source_message_id IS DISTINCT FROM proof.source_message_id OR p.source_switch_request_id IS DISTINCT FROM proof.switch_id
  OR p.customer_id IS DISTINCT FROM (proof.confirmed_period->>'customer_id')::uuid OR p.metering_point_id IS DISTINCT FROM (proof.confirmed_period->>'metering_point_id')::uuid
  OR p.market_start_at IS DISTINCT FROM proof.market_start_at OR p.market_start_at>p_start OR (p.market_end_at IS NOT NULL AND p_end>p.market_end_at)
  OR (p.status IN('confirmed_by_grid_owner','active','ending','ended')) IS NOT TRUE OR s.inbound_z04_message_id IS DISTINCT FROM proof.source_message_id OR s.outbound_z03_message_id IS DISTINCT FROM proof.original_message_id
  OR s.customer_id IS DISTINCT FROM p.customer_id OR s.metering_point_id IS DISTINCT FROM p.metering_point_id OR s.lifecycle_blocked THEN RETURN NULL;END IF;
 SELECT * INTO tr FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=ids[1] AND company_id=p_company_id;
 SELECT * INTO m FROM public.ediel_messages WHERE id=tr.source_message_id AND company_id=p_company_id;
 SELECT own INTO expected FROM jsonb_array_elements(tr.resulting_states) own WHERE own->>'id'=p.id::text;
 SELECT * INTO activation FROM gridex_received_sources.normal_supply_activations WHERE period_id=p.id AND company_id=p_company_id;
 baseline:=CASE WHEN activation.period_id IS NOT NULL AND tr.source_message_id=proof.source_message_id THEN activation.resulting_period ELSE expected END;
 IF expected IS NULL OR baseline IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR tr.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR (to_jsonb(p)-ARRAY['updated_at','status']) IS DISTINCT FROM (baseline-ARRAY['updated_at','status'])
  OR (p.status IS DISTINCT FROM baseline->>'status' AND NOT(p.status='ended' AND baseline->>'status'='ending' AND p.market_end_at<=now()))
  OR (s.status IS DISTINCT FROM proof.confirmed_switch->>'status' AND NOT(s.status='completed' AND activation.period_id IS NOT NULL)) THEN RETURN NULL;END IF;
 SELECT * INTO origin FROM public.ediel_messages WHERE id=proof.original_message_id AND company_id=p_company_id AND environment=m.environment;
 SELECT * INTO c FROM public.customer_contracts WHERE id=proof.contract_id AND company_id=p_company_id FOR SHARE;
 IF origin.direction IS DISTINCT FROM 'outbound' OR gridex_received_sources.sent_source_is_current_v1(origin) IS NOT TRUE OR origin.immutable_payload_hash IS DISTINCT FROM proof.original_payload_hash OR origin.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex')
  OR c.id IS NULL OR c.customer_id IS DISTINCT FROM p.customer_id OR c.metering_point_id IS DISTINCT FROM p.metering_point_id OR (c.status IN('signed','active')) IS NOT TRUE OR gridex_received_sources.production_contract_hash_v1(c) IS DISTINCT FROM proof.protected_contract_hash
  OR legal->>'legalActorId' IS DISTINCT FROM proof.legal_context->>'legalActorId' OR legal->>'actorRole' IS DISTINCT FROM 'electricity_supplier'
  OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=m.id AND v.company_id=p_company_id AND v.environment=m.environment AND v.source_payload_hash=tr.payload_hash AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND (v.facts_text::jsonb->>'applicationDecision'='accepted' OR gridex_received_sources.mixed_period_canonical_v1(v.id,p_company_id,proof.period_id,proof.source_message_id)) AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN NULL;END IF;
 accepted_original:=gridex_ediel_transport.accepted_source_basis_v1(origin);
 IF accepted_original IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('qualified',true,'periodId',p.id,'companyId',p.company_id,'customerId',p.customer_id,'meteringPointId',p.metering_point_id,'siteId',coalesce(proof.confirmed_switch->>'site_id',proof.confirmed_switch->>'customer_site_id'),'switchId',proof.switch_id,
  'sourceMessageId',m.id,'initialSourceMessageId',proof.source_message_id,'currentSourceMessageId',m.id,'payloadHash',tr.payload_hash,'marketStateVersion',p.market_state_version,'marketStartAt',p.market_start_at,'marketEndAt',p.market_end_at,
  'legalActorId',proof.legal_context->>'legalActorId','sourceObjects',jsonb_build_array(proof.source_object),'dsoEdielId',initial_wire->>'sender','originalMessageId',origin.id,'originalPayloadHash',origin.immutable_payload_hash,'originalAcceptedAt',accepted_original->>'observedAt','activated',activation.period_id IS NOT NULL);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_regulated_supply FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
