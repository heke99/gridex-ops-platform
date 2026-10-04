-- Exact customer record classes, not a shared retention period. Each target
-- requires its own immutable original hash, signed competent legal decision,
-- separate current reviewer and class grant. No default policy/issuer/grant.
-- Only approved personal fields/bytes are removed; journal references/hashes
-- and version clocks survive. No cascade or real purge is performed by DDL.
BEGIN;
CREATE TABLE gridex_ediel_retention.record_class_catalog(
 retention_class text PRIMARY KEY,source_table text NOT NULL UNIQUE,permission_key text NOT NULL,
 operation text NOT NULL,redaction jsonb NOT NULL CHECK(jsonb_typeof(redaction)='object'));
INSERT INTO gridex_ediel_retention.record_class_catalog VALUES
('contract_signed_pdf_bytes','customer_contract_documents','ediel.retention.contract_pdf','remove_contract_pdf_bytes','{"storage_path": null, "generation_snapshot": {}}'::jsonb),
 ('contract_signature_personal_snapshot','customer_contracts','ediel.retention.signature','redact_contract_signature_personal_snapshot','{"signature_snapshot": {}, "signed_ip_hash": null, "signed_user_agent": null}'::jsonb),
 ('contract_signature_request_personal','customer_contract_signature_requests','ediel.retention.signature','redact_signature_request_personal','{"recipient_email": "RETENTION_EMAIL", "metadata": {}}'::jsonb),
 ('contract_acceptance_personal_snapshot','customer_contract_acceptances','ediel.retention.signature','redact_contract_acceptance_personal','{"ip_hash": null, "user_agent": null, "customer_identity_snapshot": {}, "power_of_attorney_snapshot": {}, "acceptance_snapshot": {}}'::jsonb),
 ('contract_evidence_personal_snapshot','customer_contract_evidence','ediel.retention.signature','redact_contract_evidence_personal','{"evidence_snapshot": {}}'::jsonb),
 ('customer_address_history','customer_addresses','ediel.retention.address_history','redact_inactive_customer_address','{"street_1": null, "street_2": null, "postal_code": null, "city": null, "municipality": null, "metadata": {}}'::jsonb),
 ('portal_event_history','customer_portal_events','ediel.retention.portal_history','redact_portal_event_personal','{"user_id": null, "payload": {}, "metadata": {}}'::jsonb),
 ('portal_access_log_history','customer_portal_api_access_logs','ediel.retention.portal_history','redact_portal_access_log_personal','{"external_customer_id": null, "metadata": {}}'::jsonb),
 ('portal_customer_event_history','customer_events','ediel.retention.portal_history','redact_portal_customer_event_personal','{"external_customer_id": null, "customer_number": null, "payload": {}, "metadata": {}}'::jsonb),
 ('portal_domain_event_history','domain_events','ediel.retention.portal_history','redact_portal_domain_event_personal','{"actor_user_id": null, "payload": {}}'::jsonb),
 ('legal_acceptance_personal_snapshot','customer_legal_acceptances','ediel.retention.legal_history','redact_legal_acceptance_personal','{"accepted_ip": null, "accepted_ip_hash": null, "accepted_user_agent": null, "snapshot": {}, "metadata": {}, "customer_number": null, "external_customer_id": null}'::jsonb),
 ('onboarding_legal_personal_snapshot','customer_onboarding_legal_snapshots','ediel.retention.legal_history','redact_onboarding_legal_personal','{"signed_scope_snapshot": [], "acceptance_snapshot": {}}'::jsonb);
-- This is an immutable native class-to-owner mapping, never a deadline catalog.
CREATE TABLE gridex_ediel_retention.record_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 retention_class text NOT NULL REFERENCES gridex_ediel_retention.record_class_catalog(retention_class),target_id uuid NOT NULL,
 customer_id uuid NOT NULL REFERENCES public.customers(id),contract_id uuid,source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),target_hash text NOT NULL CHECK(target_hash~'^[a-f0-9]{64}$'),
 document_bytes bytea NOT NULL CHECK(octet_length(document_bytes) BETWEEN 1 AND 1048576),document_hash text NOT NULL CHECK(document_hash=encode(sha256(document_bytes),'hex')),
 issuer_receipt jsonb,submitted_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,retention_class,target_id,target_hash,document_hash));
CREATE TABLE gridex_ediel_retention.record_reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),decision_id uuid NOT NULL REFERENCES gridex_ediel_retention.record_decisions(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),outcome text NOT NULL CHECK(outcome IN('approved','held','rejected')),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_ediel_retention.record_revocations(decision_id uuid PRIMARY KEY REFERENCES gridex_ediel_retention.record_decisions(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_ediel_retention.record_tombstones(retention_class text NOT NULL REFERENCES gridex_ediel_retention.record_class_catalog(retention_class),target_id uuid NOT NULL,company_id uuid NOT NULL,customer_id uuid NOT NULL,contract_id uuid,decision_id uuid NOT NULL REFERENCES gridex_ediel_retention.record_decisions(id),review_id uuid NOT NULL REFERENCES gridex_ediel_retention.record_reviews(id),source_hash text NOT NULL,target_hash text NOT NULL,byte_length bigint NOT NULL CHECK(byte_length>0),storage_path text,actor_user_id uuid NOT NULL REFERENCES auth.users(id),journal_retain_until timestamptz NOT NULL,journal_purpose_reference text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(retention_class,target_id));
CREATE TABLE gridex_ediel_retention.record_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),retention_class text NOT NULL,target_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('personal_fields_redacted','storage_delete_authorized','storage_object_absent')),actor_user_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),FOREIGN KEY(retention_class,target_id) REFERENCES gridex_ediel_retention.record_tombstones(retention_class,target_id),UNIQUE(retention_class,target_id,kind));
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['record_class_catalog','record_decisions','record_reviews','record_revocations','record_tombstones','record_events'] LOOP
 EXECUTE format('ALTER TABLE gridex_ediel_retention.%I OWNER TO gridex_ediel_retention_owner',t);EXECUTE format('ALTER TABLE gridex_ediel_retention.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_ediel_retention.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON gridex_ediel_retention.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gridex_ediel_retention.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t||'_immutable',t);EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gridex_ediel_retention.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t||'_no_truncate',t);
 END LOOP;END$$;
INSERT INTO public.permissions(key,name,category,description,is_active) VALUES
 ('ediel.retention.contract_pdf','Retention contract PDF bytes','ediel','Explicit own class grant; no legal policy or role authority is implied',true),
 ('ediel.retention.signature','Retention signature personal records','ediel','Explicit own class grant; each actual target requires a separate decision',true),
 ('ediel.retention.address_history','Retention address history','ediel','Explicit own class grant for inactive address personal fields',true),
 ('ediel.retention.portal_history','Retention portal history','ediel','Explicit own class grant for each portal/history personal target',true),
 ('ediel.retention.legal_history','Retention legal journal personal snapshots','ediel','Explicit own class grant preserving separately qualified minimal journal purpose',true)
 ON CONFLICT(key) DO NOTHING;
CREATE FUNCTION gridex_ediel_retention.record_permission_v1(c uuid,actor uuid,k text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE wanted text;BEGIN
 SELECT permission_key INTO wanted FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=k;
 IF wanted IS NULL OR NOT EXISTS(SELECT FROM public.companies WHERE id=c AND status IN('active','archived','pending_deletion'))
 OR NOT EXISTS(SELECT FROM auth.users WHERE id=actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))
 OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.permissions WHERE key=wanted AND is_active) THEN RETURN false;END IF;
 IF EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND u.effect='deny' AND p.key=wanted)
 OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND (o.company_id=c OR o.company_id IS NULL) AND o.is_active AND o.effect='deny' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=now()) AND (o.valid_to IS NULL OR now()<o.valid_to))
 OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='deny' AND p.key=wanted) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND u.effect='allow' AND p.is_active AND p.key=wanted)
 OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='allow' AND p.is_active AND p.key=wanted)
 OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND o.company_id=c AND o.is_active AND o.effect='allow' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=now()) AND (o.valid_to IS NULL OR now()<o.valid_to));
END$$;
CREATE FUNCTION gridex_ediel_retention.record_actor_v1(c uuid,actor uuid,k text,operation text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ediel_retention.actor_v1(c,actor,operation);
 IF gridex_ediel_retention.record_permission_v1(c,actor,k) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_record_class_grant_required' USING ERRCODE='42501';END IF;
END$$;
CREATE FUNCTION gridex_ediel_retention.record_basis_v1(c uuid,k text,target uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE spec gridex_ediel_retention.record_class_catalog%rowtype;rowdata jsonb;customer uuid;contract uuid;source text;path text;bytes bigint;
BEGIN
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=k;
 EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id=$1 AND company_id=$2 FOR SHARE',spec.source_table) INTO STRICT rowdata USING target,c;
 IF spec.source_table IN('customer_contract_documents','customer_contract_signature_requests','customer_contract_acceptances','customer_contract_evidence') THEN
  contract:=(rowdata->>'customer_contract_id')::uuid;SELECT customer_id INTO STRICT customer FROM public.customer_contracts WHERE id=contract AND company_id=c FOR SHARE;
 ELSIF spec.source_table='customer_contracts' THEN contract:=target;customer:=(rowdata->>'customer_id')::uuid;
 ELSIF spec.source_table='domain_events' THEN customer:=(rowdata->>'subject_customer_id')::uuid;
 ELSE customer:=(rowdata->>'customer_id')::uuid;contract:=nullif(rowdata->>'contract_id','')::uuid;END IF;
 PERFORM id FROM public.customers WHERE id=customer AND company_id=c FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'retention_actual_record_customer_scope_required';END IF;
 IF contract IS NOT NULL THEN PERFORM id FROM public.customer_contracts WHERE id=contract AND company_id=c AND customer_id=customer FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'retention_actual_record_contract_scope_required';END IF;END IF;
 source:=encode(sha256(convert_to(rowdata::text,'UTF8')),'hex');bytes:=octet_length(convert_to(rowdata::text,'UTF8'));
 IF k='contract_signed_pdf_bytes' THEN
  source:=rowdata->>'document_sha256';path:=rowdata->>'storage_path';
  IF rowdata->>'document_type' IS DISTINCT FROM 'signed_contract_pdf' OR rowdata->>'storage_bucket' IS DISTINCT FROM 'customer-contract-documents' OR rowdata->>'mime_type' IS DISTINCT FROM 'application/pdf' OR rowdata->>'verified_at' IS NULL OR rowdata->>'archived_at' IS NULL OR source!~'^[a-f0-9]{64}$' OR path IS DISTINCT FROM c::text||'/'||contract::text||'/signed-contract-'||source||'.pdf' THEN RAISE EXCEPTION 'retention_actual_signed_pdf_archive_required';END IF;
  SELECT (metadata->>'size')::bigint INTO STRICT bytes FROM storage.objects WHERE bucket_id='customer-contract-documents' AND name=path FOR SHARE;
  IF bytes NOT BETWEEN 1 AND 2097152 THEN RAISE EXCEPTION 'retention_actual_signed_pdf_byte_length_required';END IF;
 END IF;
 RETURN jsonb_build_object('companyId',c,'retentionClass',k,'sourceTable',spec.source_table,'targetId',target,'customerId',customer,'contractId',contract,'sourceHash',source,'targetHash',encode(sha256(convert_to(rowdata::text,'UTF8')),'hex'),'byteLength',bytes,'storagePath',path,'operation',spec.operation);
END$$;
CREATE FUNCTION gridex_ediel_retention.record_receipt_v1(d gridex_ediel_retention.record_decisions) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE issuer gridex_ediel_retention.issuers%rowtype;spec gridex_ediel_retention.record_class_catalog%rowtype;body jsonb;bytes bytea;issued timestamptz;expires timestamptz;deadline timestamptz;journal_deadline timestamptz;
BEGIN
 IF jsonb_typeof(d.issuer_receipt) IS DISTINCT FROM 'object' OR coalesce(d.issuer_receipt->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(d.issuer_receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 32768 THEN RETURN NULL;END IF;
 SELECT * INTO issuer FROM gridex_ediel_retention.issuers WHERE id=(d.issuer_receipt->>'issuerId')::uuid AND company_id=d.company_id FOR SHARE;
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=d.retention_class;
 IF issuer.id IS NULL OR now()<issuer.valid_from OR now()>=issuer.valid_to OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=issuer.id) OR EXISTS(SELECT FROM gridex_ediel_retention.record_revocations WHERE decision_id=d.id) THEN RETURN NULL;END IF;
 bytes:=decode(d.issuer_receipt->>'payloadBase64','base64');IF encode(gridex_requested_changes.receipt_hmac_sha256_v1(bytes,issuer.signing_key),'hex') IS DISTINCT FROM d.issuer_receipt->>'signatureHex' THEN RETURN NULL;END IF;
 body:=convert_from(bytes,'UTF8')::jsonb;issued:=(body->>'issuedAt')::timestamptz;expires:=(body->>'expiresAt')::timestamptz;deadline:=(body->>'retainUntil')::timestamptz;journal_deadline:=(body->>'journalRetainUntil')::timestamptz;
 IF body->>'format' IS DISTINCT FROM 'ediel_customer_record_retention_policy_v1' OR body->>'retentionClass' IS DISTINCT FROM d.retention_class OR body->>'sourceTable' IS DISTINCT FROM spec.source_table OR body->>'operation' IS DISTINCT FROM spec.operation OR body->>'companyId' IS DISTINCT FROM d.company_id::text OR body->>'customerId' IS DISTINCT FROM d.customer_id::text OR body->>'targetId' IS DISTINCT FROM d.target_id::text OR body->>'sourceHash' IS DISTINCT FROM d.source_hash OR body->>'targetHash' IS DISTINCT FROM d.target_hash OR body->>'documentHash' IS DISTINCT FROM d.document_hash OR body->>'issuerLegalReference' IS DISTINCT FROM issuer.legal_reference
 OR nullif(body->>'legalBasisReference','') IS NULL OR nullif(body->>'journalPurposeReference','') IS NULL OR body->>'accessRevocationRequired' IS DISTINCT FROM 'true'
 OR isfinite(issued) IS DISTINCT FROM true OR isfinite(expires) IS DISTINCT FROM true OR isfinite(deadline) IS DISTINCT FROM true OR isfinite(journal_deadline) IS DISTINCT FROM true OR issued>now() OR expires<=now() OR issued<issuer.valid_from OR expires>issuer.valid_to OR journal_deadline<=now() THEN RETURN NULL;END IF;
 RETURN body;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;
END$$;
CREATE FUNCTION gridex_ediel_retention.record_current_review_v1(d gridex_ediel_retention.record_decisions) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r gridex_ediel_retention.record_reviews%rowtype;claims jsonb;BEGIN
 SELECT * INTO r FROM gridex_ediel_retention.record_reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
 PERFORM id FROM auth.users WHERE id=r.actor_user_id FOR SHARE;PERFORM id FROM public.user_profiles WHERE id=r.actor_user_id FOR SHARE;PERFORM user_id FROM public.company_memberships WHERE company_id=d.company_id AND user_id=r.actor_user_id FOR SHARE;
 IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE OR gridex_ediel_retention.record_permission_v1(d.company_id,r.actor_user_id,d.retention_class) IS NOT TRUE THEN RETURN NULL;END IF;
 claims:=gridex_ediel_retention.record_receipt_v1(d);IF claims IS NULL OR (claims->>'retainUntil')::timestamptz>now() THEN RETURN NULL;END IF;RETURN r.id;
END$$;
CREATE FUNCTION public.ediel_submit_customer_record_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_retention_class text,p_target_id uuid,p_document_base64 text,p_issuer_receipt jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE basis jsonb;bytes bytea;doc_hash text;d gridex_ediel_retention.record_decisions%rowtype;BEGIN
 PERFORM gridex_ediel_retention.record_actor_v1(p_company_id,p_actor_user_id,p_retention_class,'ediel.retention.submit');basis:=gridex_ediel_retention.record_basis_v1(p_company_id,p_retention_class,p_target_id);
 IF length(p_document_base64)>1398104 THEN RAISE EXCEPTION 'record_retention_document_limit';END IF;bytes:=decode(p_document_base64,'base64');IF octet_length(bytes) NOT BETWEEN 1 AND 1048576 THEN RAISE EXCEPTION 'record_retention_document_required';END IF;doc_hash:=encode(sha256(bytes),'hex');
 INSERT INTO gridex_ediel_retention.record_decisions(company_id,retention_class,target_id,customer_id,contract_id,source_hash,target_hash,document_bytes,document_hash,issuer_receipt,submitted_by) VALUES(p_company_id,p_retention_class,p_target_id,(basis->>'customerId')::uuid,(basis->>'contractId')::uuid,basis->>'sourceHash',basis->>'targetHash',bytes,doc_hash,p_issuer_receipt,p_actor_user_id) ON CONFLICT(company_id,retention_class,target_id,target_hash,document_hash) DO NOTHING;
 SELECT * INTO STRICT d FROM gridex_ediel_retention.record_decisions WHERE company_id=p_company_id AND retention_class=p_retention_class AND target_id=p_target_id AND target_hash=basis->>'targetHash' AND document_hash=doc_hash FOR SHARE;IF d.issuer_receipt IS DISTINCT FROM p_issuer_receipt OR d.submitted_by IS DISTINCT FROM p_actor_user_id THEN RAISE EXCEPTION 'record_retention_original_decision_conflict';END IF;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'record_retention_decision',d.id,'ediel.retention.record_submitted',jsonb_build_object('retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'targetHash',d.target_hash,'documentHash',d.document_hash));
 RETURN jsonb_build_object('status','submitted','decisionId',d.id,'sourceHash',d.source_hash,'targetHash',d.target_hash,'documentHash',d.document_hash,'retentionClass',d.retention_class,'issuerQualified',gridex_ediel_retention.record_receipt_v1(d) IS NOT NULL);
END$$;
CREATE FUNCTION public.ediel_review_customer_record_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid,p_outcome text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d gridex_ediel_retention.record_decisions%rowtype;outcome text;r uuid;BEGIN
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.review');SELECT * INTO STRICT d FROM gridex_ediel_retention.record_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;
 IF gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_record_class_grant_required';END IF;
 IF p_outcome NOT IN('approve','hold','reject') OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>4000 THEN RAISE EXCEPTION 'record_retention_review_shape_required';END IF;IF p_outcome='approve' AND d.submitted_by=p_actor_user_id THEN RAISE EXCEPTION 'record_retention_separate_reviewer_required';END IF;
 outcome:=CASE WHEN p_outcome='reject' THEN 'rejected' WHEN p_outcome='approve' AND gridex_ediel_retention.record_receipt_v1(d) IS NOT NULL THEN 'approved' ELSE 'held' END;
 INSERT INTO gridex_ediel_retention.record_reviews(decision_id,actor_user_id,outcome,reason) VALUES(d.id,p_actor_user_id,outcome,p_reason) RETURNING id INTO r;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'record_retention_decision',d.id,'ediel.retention.record_reviewed',jsonb_build_object('reviewId',r,'outcome',outcome));RETURN jsonb_build_object('status',outcome,'decisionId',d.id,'reviewId',r);
END$$;
CREATE FUNCTION public.ediel_revoke_customer_record_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.review');PERFORM id FROM gridex_ediel_retention.record_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;IF NOT FOUND OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>4000 THEN RAISE EXCEPTION 'record_retention_revoke_scope_required';END IF;
 INSERT INTO gridex_ediel_retention.record_revocations(decision_id,actor_user_id,reason) VALUES(p_decision_id,p_actor_user_id,p_reason) ON CONFLICT DO NOTHING;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'record_retention_decision',p_decision_id,'ediel.retention.record_revoked',jsonb_build_object('reason',p_reason));END$$;
CREATE FUNCTION gridex_ediel_retention.record_redacted_v1(k text,rowdata jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE fields jsonb;BEGIN SELECT redaction INTO STRICT fields FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=k;
 IF fields->>'recipient_email'='RETENTION_EMAIL' THEN fields:=jsonb_set(fields,'{recipient_email}',to_jsonb('retained-signature-'||(rowdata->>'id')||'@example.invalid'));END IF;
 RETURN rowdata||fields;
END$$;
CREATE FUNCTION public.ediel_is_qualified_customer_record_transition_v1(p_table text,p_old jsonb,p_new jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE spec gridex_ediel_retention.record_class_catalog%rowtype;t gridex_ediel_retention.record_tombstones%rowtype;BEGIN
 SELECT * INTO spec FROM gridex_ediel_retention.record_class_catalog WHERE source_table=p_table;IF NOT FOUND THEN RETURN false;END IF;
 SELECT * INTO t FROM gridex_ediel_retention.record_tombstones WHERE retention_class=spec.retention_class AND target_id=(p_old->>'id')::uuid AND company_id=(p_old->>'company_id')::uuid;
 IF NOT FOUND OR p_new IS NULL THEN RETURN false;END IF;
 IF encode(sha256(convert_to(p_old::text,'UTF8')),'hex') IS DISTINCT FROM t.target_hash AND (p_old-'updated_at') IS DISTINCT FROM (gridex_ediel_retention.record_redacted_v1(spec.retention_class,p_old)-'updated_at') THEN RETURN false;END IF;
 RETURN (p_new-'updated_at') IS NOT DISTINCT FROM (gridex_ediel_retention.record_redacted_v1(spec.retention_class,p_old)-'updated_at');
END$$;
-- Clone only each actual table's existing immutable trigger body. Its original
-- ordinary behaviour and ACL survive; shared immutable functions are untouched.
DO $$DECLARE spec record;f record;new_name text;body text;definition text;setting text;BEGIN
 FOR spec IN SELECT source_table FROM gridex_ediel_retention.record_class_catalog LOOP
  FOR f IN SELECT t.tgname,p.oid,p.oid::regprocedure signature,p.prosrc,l.lanname,p.proowner,p.proconfig,p.prosecdef FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_language l ON l.oid=p.prolang WHERE t.tgrelid=format('public.%I',spec.source_table)::regclass AND NOT t.tgisinternal AND (t.tgname ILIKE '%immutable%' OR t.tgname='customer_contracts_lock_signed') LOOP
   IF f.lanname<>'plpgsql' OR f.prosrc!~*'\mBEGIN\M' THEN RAISE EXCEPTION 'record_retention_trigger_requires_explicit_review:%',f.signature;END IF;
   new_name:='record_'||substr(encode(sha256(convert_to(spec.source_table||f.tgname,'UTF8')),'hex'),1,20)||'_guard_v1';
   body:=regexp_replace(f.prosrc,'\mBEGIN\M','BEGIN IF TG_OP=''UPDATE'' AND public.ediel_is_qualified_customer_record_transition_v1(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW;END IF;','i');
   EXECUTE format('CREATE FUNCTION gridex_ediel_retention.%I() RETURNS trigger LANGUAGE plpgsql SECURITY %s SET search_path=pg_catalog AS %L',new_name,CASE WHEN f.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END,body);
   FOREACH setting IN ARRAY coalesce(f.proconfig,ARRAY[]::text[]) LOOP EXECUTE format('ALTER FUNCTION gridex_ediel_retention.%I() SET %I TO %L',new_name,split_part(setting,'=',1),substring(setting from position('=' in setting)+1));END LOOP;
   EXECUTE format('ALTER FUNCTION gridex_ediel_retention.%I() OWNER TO %I',new_name,(SELECT rolname FROM pg_roles WHERE oid=f.proowner));
   EXECUTE format('REVOKE ALL ON FUNCTION gridex_ediel_retention.%I() FROM PUBLIC,anon,authenticated,service_role',new_name);
   definition:=pg_get_triggerdef((SELECT oid FROM pg_trigger WHERE tgrelid=format('public.%I',spec.source_table)::regclass AND tgname=f.tgname));
   EXECUTE format('DROP TRIGGER %I ON public.%I',f.tgname,spec.source_table);
   EXECUTE regexp_replace(definition,'EXECUTE (FUNCTION|PROCEDURE) .*$',format('EXECUTE FUNCTION gridex_ediel_retention.%I()',new_name));
  END LOOP;
 END LOOP;
END$$;
CREATE FUNCTION gridex_ediel_retention.record_target_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE spec gridex_ediel_retention.record_class_catalog%rowtype;t gridex_ediel_retention.record_tombstones%rowtype;BEGIN
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.record_class_catalog WHERE source_table=TG_TABLE_NAME;
 SELECT * INTO t FROM gridex_ediel_retention.record_tombstones WHERE retention_class=spec.retention_class AND target_id=(CASE WHEN TG_OP='INSERT' THEN new.id ELSE old.id END);
 IF FOUND THEN IF TG_OP='UPDATE' AND public.ediel_is_qualified_customer_record_transition_v1(TG_TABLE_NAME,to_jsonb(old),to_jsonb(new)) THEN RETURN new;END IF;RAISE EXCEPTION 'customer_record_retention_tombstoned';END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME IN('customer_contract_documents','customer_contract_signature_requests','customer_contract_acceptances','customer_contract_evidence') AND EXISTS(SELECT FROM gridex_ediel_retention.record_tombstones WHERE company_id=new.company_id AND contract_id=(to_jsonb(new)->>'customer_contract_id')::uuid) THEN RAISE EXCEPTION 'customer_contract_records_retention_tombstoned';END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'customer_record_native_class_retention_required';ELSE RETURN new;END IF;
END$$;
DO $$DECLARE spec record;BEGIN FOR spec IN SELECT source_table FROM gridex_ediel_retention.record_class_catalog LOOP
 EXECUTE format('CREATE TRIGGER zz_record_retention_target BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.record_target_guard_v1()',spec.source_table);
 END LOOP;END$$;
CREATE FUNCTION public.ediel_begin_customer_record_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d gridex_ediel_retention.record_decisions%rowtype;t gridex_ediel_retention.record_tombstones%rowtype;spec gridex_ediel_retention.record_class_catalog%rowtype;basis jsonb;claims jsonb;r uuid;customer public.customers%rowtype;at timestamptz:=clock_timestamp();assignments text;BEGIN
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');SELECT * INTO STRICT d FROM gridex_ediel_retention.record_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;
 IF gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_record_class_grant_required';END IF;
 SELECT * INTO t FROM gridex_ediel_retention.record_tombstones WHERE retention_class=d.retention_class AND target_id=d.target_id;
 IF FOUND THEN IF t.decision_id IS DISTINCT FROM d.id THEN RAISE EXCEPTION 'record_retention_tombstone_conflict';END IF;RETURN jsonb_build_object('status',CASE WHEN t.retention_class='contract_signed_pdf_bytes' AND NOT EXISTS(SELECT FROM gridex_ediel_retention.record_events WHERE retention_class=t.retention_class AND target_id=t.target_id AND kind='storage_object_absent') THEN 'storage_purge_pending' ELSE 'redacted' END,'retentionClass',t.retention_class,'targetId',t.target_id,'sourceHash',t.source_hash,'byteLength',t.byte_length,'storagePath',t.storage_path,'replay',true);END IF;
 r:=gridex_ediel_retention.record_current_review_v1(d);IF r IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_exact_class_legal_review_deadline']);END IF;
 LOCK TABLE public.customer_supply_periods,public.customer_portal_accounts,public.customer_portal_claims IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT customer FROM public.customers WHERE id=d.customer_id AND company_id=p_company_id FOR UPDATE;
 IF customer.status IS DISTINCT FROM 'archived' OR EXISTS(SELECT FROM public.customer_supply_periods WHERE company_id=p_company_id AND customer_id=d.customer_id AND status NOT IN('cancelled','rejected','terminated','ended','closed','inactive') AND (coalesce(actual_end_date,end_date) IS NULL OR coalesce(actual_end_date,end_date)>=current_date)) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['operative_customer_closed_and_no_active_supply']);END IF;
 basis:=gridex_ediel_retention.record_basis_v1(p_company_id,d.retention_class,d.target_id);IF basis->>'targetHash' IS DISTINCT FROM d.target_hash OR basis->>'sourceHash' IS DISTINCT FROM d.source_hash THEN RETURN jsonb_build_object('status','held','missing',ARRAY['exact_native_record_target_changed']);END IF;
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=d.retention_class;
 IF d.retention_class='customer_address_history' AND EXISTS(SELECT FROM public.customer_addresses WHERE id=d.target_id AND (is_active OR moved_out_at IS NULL OR moved_out_at>=current_date)) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['inactive_historical_address_required']);END IF;
 claims:=gridex_ediel_retention.record_receipt_v1(d);
 UPDATE public.customer_portal_accounts SET status='revoked',is_active=false,updated_at=at WHERE company_id=p_company_id AND customer_id=d.customer_id;
 UPDATE public.customer_portal_claims SET status='revoked',updated_at=at WHERE company_id=p_company_id AND customer_id=d.customer_id;
 INSERT INTO gridex_ediel_retention.record_tombstones(retention_class,target_id,company_id,customer_id,contract_id,decision_id,review_id,source_hash,target_hash,byte_length,storage_path,actor_user_id,journal_retain_until,journal_purpose_reference,created_at) VALUES(d.retention_class,d.target_id,p_company_id,d.customer_id,d.contract_id,d.id,r,d.source_hash,d.target_hash,(basis->>'byteLength')::bigint,basis->>'storagePath',p_actor_user_id,(claims->>'journalRetainUntil')::timestamptz,claims->>'journalPurposeReference',at);
 IF d.retention_class<>'contract_signed_pdf_bytes' THEN
  SELECT string_agg(format('%I=(jsonb_populate_record(NULL::public.%I,gridex_ediel_retention.record_redacted_v1(%L,to_jsonb(r)))).%I',key,spec.source_table,d.retention_class,key),',') INTO assignments FROM jsonb_object_keys(spec.redaction) key;
  EXECUTE format('UPDATE public.%I r SET %s WHERE id=$1 AND company_id=$2',spec.source_table,assignments) USING d.target_id,p_company_id;
  INSERT INTO gridex_ediel_retention.record_events(retention_class,target_id,kind,actor_user_id) VALUES(d.retention_class,d.target_id,'personal_fields_redacted',p_actor_user_id);
 END IF;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'customer_record',d.target_id,'ediel.retention.record_tombstoned',jsonb_build_object('decisionId',d.id,'reviewId',r,'retentionClass',d.retention_class,'sourceHash',d.source_hash,'targetHash',d.target_hash,'accessRevoked',true,'journalRetainUntil',claims->>'journalRetainUntil','journalPurposeReference',claims->>'journalPurposeReference'));
 RETURN jsonb_build_object('status',CASE WHEN d.retention_class='contract_signed_pdf_bytes' THEN 'storage_purge_pending' ELSE 'redacted' END,'retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'byteLength',(basis->>'byteLength')::bigint,'storagePath',basis->>'storagePath','replay',false);
END$$;
CREATE FUNCTION gridex_ediel_retention.record_revocation_lock_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN PERFORM id FROM gridex_ediel_retention.record_decisions WHERE id=new.decision_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'record_retention_revocation_target_required';END IF;RETURN new;END$$;
CREATE TRIGGER record_retention_revocation_lock BEFORE INSERT ON gridex_ediel_retention.record_revocations FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.record_revocation_lock_v1();
CREATE FUNCTION gridex_ediel_retention.contract_storage_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t gridex_ediel_retention.record_tombstones%rowtype;d gridex_ediel_retention.record_decisions%rowtype;basis jsonb;r uuid;actor uuid:=auth.uid();BEGIN
 IF TG_OP<>'DELETE' AND new.bucket_id='customer-contract-documents' AND EXISTS(SELECT FROM gridex_ediel_retention.record_tombstones WHERE retention_class='contract_signed_pdf_bytes' AND storage_path=new.name) THEN RAISE EXCEPTION 'contract_pdf_retention_tombstoned';END IF;
 IF (CASE WHEN TG_OP='INSERT' THEN new.bucket_id ELSE old.bucket_id END) IS DISTINCT FROM 'customer-contract-documents' THEN IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;
 SELECT * INTO t FROM gridex_ediel_retention.record_tombstones WHERE retention_class='contract_signed_pdf_bytes' AND storage_path=(CASE WHEN TG_OP='INSERT' THEN new.name ELSE old.name END);
 IF NOT FOUND THEN IF TG_OP IN('UPDATE','DELETE') AND EXISTS(SELECT FROM public.customer_contract_documents WHERE storage_bucket='customer-contract-documents' AND storage_path=old.name) THEN RAISE EXCEPTION 'contract_pdf_native_class_purge_required';END IF;IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;
 IF TG_OP<>'DELETE' THEN RAISE EXCEPTION 'contract_pdf_retention_tombstoned';END IF;
 PERFORM gridex_ediel_retention.record_actor_v1(t.company_id,actor,t.retention_class,'ediel.retention.purge');SELECT * INTO STRICT d FROM gridex_ediel_retention.record_decisions WHERE id=t.decision_id FOR UPDATE;
 r:=gridex_ediel_retention.record_current_review_v1(d);basis:=gridex_ediel_retention.record_basis_v1(t.company_id,t.retention_class,t.target_id);
 IF r IS NULL OR basis->>'targetHash' IS DISTINCT FROM t.target_hash OR basis->>'storagePath' IS DISTINCT FROM old.name THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;
 INSERT INTO gridex_ediel_retention.record_events(retention_class,target_id,kind,actor_user_id) VALUES(t.retention_class,t.target_id,'storage_delete_authorized',actor) ON CONFLICT DO NOTHING;RETURN old;
END$$;
CREATE TRIGGER contract_retention_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.contract_storage_guard_v1();
CREATE FUNCTION public.ediel_contract_retention_storage_target_v1(p_path text) RETURNS SETOF boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT true FROM gridex_ediel_retention.record_tombstones t WHERE t.retention_class='contract_signed_pdf_bytes' AND t.storage_path=p_path AND gridex_ediel_retention.permission_v1(t.company_id,auth.uid(),'ediel.retention.purge') IS TRUE AND gridex_ediel_retention.record_permission_v1(t.company_id,auth.uid(),t.retention_class) IS TRUE
$$;
CREATE POLICY contract_qualified_retention_storage_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='customer-contract-documents' AND EXISTS(SELECT FROM public.ediel_contract_retention_storage_target_v1(name)));
CREATE FUNCTION public.ediel_finish_contract_document_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d gridex_ediel_retention.record_decisions%rowtype;t gridex_ediel_retention.record_tombstones%rowtype;spec gridex_ediel_retention.record_class_catalog%rowtype;assignments text;BEGIN
 PERFORM gridex_ediel_retention.record_actor_v1(p_company_id,p_actor_user_id,'contract_signed_pdf_bytes','ediel.retention.purge');SELECT * INTO STRICT d FROM gridex_ediel_retention.record_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;SELECT * INTO STRICT t FROM gridex_ediel_retention.record_tombstones WHERE retention_class=d.retention_class AND target_id=d.target_id;
 IF t.retention_class IS DISTINCT FROM 'contract_signed_pdf_bytes' OR NOT EXISTS(SELECT FROM gridex_ediel_retention.record_events WHERE retention_class=t.retention_class AND target_id=t.target_id AND kind='storage_delete_authorized') OR EXISTS(SELECT FROM storage.objects WHERE bucket_id='customer-contract-documents' AND name=t.storage_path) THEN RAISE EXCEPTION 'contract_pdf_actual_storage_delete_receipt_required';END IF;
 IF NOT EXISTS(SELECT FROM gridex_ediel_retention.record_events WHERE retention_class=t.retention_class AND target_id=t.target_id AND kind='storage_object_absent') THEN
  UPDATE public.customer_contract_documents SET storage_path=NULL,generation_snapshot='{}' WHERE id=t.target_id AND company_id=t.company_id;
  INSERT INTO gridex_ediel_retention.record_events(retention_class,target_id,kind,actor_user_id) VALUES(t.retention_class,t.target_id,'storage_object_absent',p_actor_user_id);
  INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'customer_contract_document',t.target_id,'ediel.retention.contract_pdf_storage_absent',jsonb_build_object('decisionId',d.id,'sourceHash',t.source_hash,'byteLength',t.byte_length,'nativeReceipt','authenticated_storage_delete_object_absence'));
  RETURN jsonb_build_object('status','storage_object_absent','retentionClass',t.retention_class,'targetId',t.target_id,'sourceHash',t.source_hash,'byteLength',t.byte_length,'replay',false);
 END IF;RETURN jsonb_build_object('status','storage_object_absent','retentionClass',t.retention_class,'targetId',t.target_id,'sourceHash',t.source_hash,'byteLength',t.byte_length,'replay',true);
END$$;
CREATE FUNCTION public.ediel_require_customer_record_available_v1(p_company_id uuid,p_retention_class text,p_target_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE basis jsonb;BEGIN
 IF EXISTS(SELECT FROM gridex_ediel_retention.record_tombstones WHERE company_id=p_company_id AND retention_class=p_retention_class AND target_id=p_target_id) THEN RAISE EXCEPTION 'customer_record_retention_tombstoned';END IF;
 basis:=gridex_ediel_retention.record_basis_v1(p_company_id,p_retention_class,p_target_id);
 RETURN jsonb_build_object('status','not_tombstoned','companyId',p_company_id,'retentionClass',p_retention_class,'targetId',p_target_id,'customerId',basis->>'customerId','authorizesProviderEntry',false);
END$$;
CREATE FUNCTION public.ediel_require_contract_records_available_v1(p_company_id uuid,p_contract_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM id FROM public.customer_contracts WHERE id=p_contract_id AND company_id=p_company_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'customer_contract_record_scope_required';END IF;
 IF EXISTS(SELECT FROM gridex_ediel_retention.record_tombstones WHERE company_id=p_company_id AND contract_id=p_contract_id) THEN RAISE EXCEPTION 'customer_contract_records_retention_tombstoned';END IF;
END$$;
CREATE FUNCTION public.ediel_customer_record_tombstones_v1(p_company_id uuid,p_customer_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM id FROM public.customers WHERE id=p_customer_id AND company_id=p_company_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'customer_record_customer_scope_required';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('retentionClass',retention_class,'targetId',target_id,'sourceHash',source_hash,'journalRetainUntil',journal_retain_until,'personalDataAvailable',false) ORDER BY retention_class,target_id) FROM gridex_ediel_retention.record_tombstones WHERE company_id=p_company_id AND customer_id=p_customer_id),'[]');
END$$;
CREATE FUNCTION public.ediel_require_portal_retention_access_v1(p_company_id uuid,p_customer_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM id FROM public.customers WHERE id=p_customer_id AND company_id=p_company_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'customer_record_customer_scope_required';END IF;
 IF EXISTS(SELECT FROM gridex_ediel_retention.record_tombstones WHERE company_id=p_company_id AND customer_id=p_customer_id) OR EXISTS(SELECT FROM gridex_ediel_retention.customer_tombstones WHERE company_id=p_company_id AND customer_id=p_customer_id) THEN RAISE EXCEPTION 'portal_customer_retention_access_revoked';END IF;
END$$;
-- Native signature owners are protected inside their transaction as well as at
-- their runtime consumers. Existing token/tenant/status gates remain intact.
ALTER FUNCTION public.gridex_prepare_customer_contract_signature_request_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text) RENAME TO gridex_prepare_signature_before_record_retention_v1;
CREATE FUNCTION public.gridex_prepare_customer_contract_signature_request_v1(p_company_id uuid,p_customer_id uuid,p_contract_id uuid,p_token_hash text,p_recipient_email text,p_expires_at timestamptz,p_actor_user_id uuid,p_channel text DEFAULT 'internal') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM public.ediel_require_contract_records_available_v1(p_company_id,p_contract_id);
 RETURN public.gridex_prepare_signature_before_record_retention_v1(p_company_id,p_customer_id,p_contract_id,p_token_hash,p_recipient_email,p_expires_at,p_actor_user_id,p_channel);
END$$;
ALTER FUNCTION public.gridex_get_customer_contract_signature_receipt_v1(text) RENAME TO gridex_get_signature_before_record_retention_v1;
CREATE FUNCTION public.gridex_get_customer_contract_signature_receipt_v1(p_token_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r public.customer_contract_signature_requests%rowtype;BEGIN
 SELECT * INTO STRICT r FROM public.customer_contract_signature_requests WHERE token_hash=p_token_hash FOR SHARE;
 PERFORM public.ediel_require_contract_records_available_v1(r.company_id,r.customer_contract_id);
 RETURN public.gridex_get_signature_before_record_retention_v1(p_token_hash);
END$$;
ALTER FUNCTION public.gridex_finalize_customer_contract_signature_v1(text,text,text) RENAME TO gridex_finalize_signature_before_record_retention_v1;
CREATE FUNCTION public.gridex_finalize_customer_contract_signature_v1(p_token_hash text,p_signed_ip_hash text DEFAULT NULL,p_signed_user_agent text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r public.customer_contract_signature_requests%rowtype;BEGIN
 SELECT * INTO STRICT r FROM public.customer_contract_signature_requests WHERE token_hash=p_token_hash FOR SHARE;PERFORM public.ediel_require_contract_records_available_v1(r.company_id,r.customer_contract_id);
 RETURN public.gridex_finalize_signature_before_record_retention_v1(p_token_hash,p_signed_ip_hash,p_signed_user_agent);
END$$;
-- Every fresh provider-stage requires current contract evidence. Actual accepted
-- replay calls its genuine predecessor first and never reopens provider entry.
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_customer_records_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;contract uuid;BEGIN
 result:=gridex_ediel_transport.mutate_before_customer_records_v1(p_input);
 IF p_input->>'action' IN('prepare','enter') AND result->>'proceed'='true' THEN
  IF EXISTS(SELECT FROM gridex_ediel_retention.record_tombstones t JOIN public.ediel_messages m ON m.company_id=t.company_id AND m.customer_id=t.customer_id WHERE m.id=(p_input->>'messageId')::uuid AND m.company_id=(p_input->>'companyId')::uuid) THEN RAISE EXCEPTION 'customer_source_records_retention_tombstoned';END IF;
  SELECT coalesce(s.customer_contract_id,s.contract_id) INTO contract FROM public.supplier_switch_requests s JOIN public.ediel_messages m ON m.id=(p_input->>'messageId')::uuid AND m.company_id=s.company_id WHERE s.company_id=(p_input->>'companyId')::uuid AND s.outbound_z03_message_id=m.id;IF contract IS NOT NULL THEN PERFORM public.ediel_require_contract_records_available_v1((p_input->>'companyId')::uuid,contract);END IF;
 END IF;RETURN result;
END$$;
ALTER FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RENAME TO mutate_before_customer_records_v1;
CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;BEGIN
 result:=gridex_outbound_dispatch.mutate_before_customer_records_v1(p_input);
 IF p_input->>'action' IN('prepare','enter') AND result->>'proceed'='true' AND EXISTS(SELECT FROM gridex_ediel_retention.record_tombstones t JOIN public.ediel_messages m ON m.company_id=t.company_id AND m.customer_id=t.customer_id WHERE m.id=(p_input->>'messageId')::uuid AND m.company_id=(p_input->>'companyId')::uuid) THEN RAISE EXCEPTION 'customer_source_records_retention_tombstoned';END IF;RETURN result;
END$$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb),gridex_ediel_transport.mutate_before_customer_records_v1(jsonb),gridex_outbound_dispatch.mutate_before_customer_records_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb) TO service_role;
CREATE FUNCTION public.ediel_current_retention_session_v1(p_company_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE wanted text;own_class text;allowed text[]:=ARRAY[]::text[];BEGIN
 LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides IN SHARE MODE;
 PERFORM id FROM auth.users WHERE id=p_actor_user_id FOR SHARE;PERFORM id FROM public.user_profiles WHERE id=p_actor_user_id FOR SHARE;PERFORM id FROM public.companies WHERE id=p_company_id FOR SHARE;PERFORM user_id FROM public.company_memberships WHERE company_id=p_company_id AND user_id=p_actor_user_id FOR SHARE;
 IF auth.uid() IS DISTINCT FROM p_actor_user_id THEN RAISE EXCEPTION 'retention_current_session_actor_required' USING ERRCODE='42501';END IF;
 FOREACH wanted IN ARRAY ARRAY['ediel.retention.submit','ediel.retention.review','ediel.retention.purge','ediel.retention.source_bytes','ediel.retention.customer_fields','ediel.retention.original_bytes','ediel.retention.mime_bytes','ediel.retention.contract_pdf','ediel.retention.signature','ediel.retention.address_history','ediel.retention.portal_history','ediel.retention.legal_history'] LOOP
  SELECT retention_class INTO own_class FROM gridex_ediel_retention.record_class_catalog WHERE permission_key=wanted ORDER BY retention_class LIMIT 1;
  IF (own_class IS NOT NULL AND gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,own_class) IS TRUE) OR (own_class IS NULL AND gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,wanted) IS TRUE) THEN allowed:=array_append(allowed,wanted);END IF;
 END LOOP;
 IF NOT allowed&&ARRAY['ediel.retention.submit','ediel.retention.review','ediel.retention.purge'] OR NOT allowed&&ARRAY['ediel.retention.source_bytes','ediel.retention.customer_fields','ediel.retention.original_bytes','ediel.retention.mime_bytes','ediel.retention.contract_pdf','ediel.retention.signature','ediel.retention.address_history','ediel.retention.portal_history','ediel.retention.legal_history'] THEN RAISE EXCEPTION 'retention_current_explicit_session_required' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('companyId',p_company_id,'actorUserId',p_actor_user_id,'permissions',allowed);
END$$;
CREATE FUNCTION public.ediel_customer_record_retention_targets_v1(p_company_id uuid,p_actor_user_id uuid,p_retention_class text,p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE session jsonb;spec gridex_ediel_retention.record_class_catalog%rowtype;rows jsonb;BEGIN
 session:=public.ediel_current_retention_session_v1(p_company_id,p_actor_user_id);
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=p_retention_class;
 IF gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,p_retention_class) IS NOT TRUE OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'retention_current_class_read_scope_required';END IF;
 EXECUTE format('SELECT coalesce(jsonb_agg(jsonb_build_object(''targetId'',r.id,''sourceTable'',%L,''retentionClass'',%L,''recordedAt'',coalesce(to_jsonb(r)->>''created_at'',to_jsonb(r)->>''generated_at'',to_jsonb(r)->>''accepted_at''),''tombstoned'',exists(select from gridex_ediel_retention.record_tombstones t where t.retention_class=%L and t.target_id=r.id)) ORDER BY r.id),''[]'') FROM (SELECT * FROM public.%I WHERE company_id=$1 ORDER BY id LIMIT $2) r',spec.source_table,p_retention_class,p_retention_class,spec.source_table) INTO rows USING p_company_id,p_limit;
 RETURN rows;
END$$;
CREATE FUNCTION public.ediel_read_customer_record_retention_v1(p_company_id uuid,p_actor_user_id uuid,p_decision_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d gridex_ediel_retention.record_decisions%rowtype;claims jsonb;BEGIN
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.review');SELECT * INTO STRICT d FROM gridex_ediel_retention.record_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR SHARE;
 IF gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_class_read_scope_required';END IF;
 claims:=gridex_ediel_retention.record_receipt_v1(d);
 RETURN jsonb_build_object('decisionId',d.id,'retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'targetHash',d.target_hash,'documentHash',d.document_hash,'documentBase64',encode(d.document_bytes,'base64'),'submittedBy',d.submitted_by,'issuerQualified',claims IS NOT NULL,'retainUntil',claims->>'retainUntil','journalRetainUntil',claims->>'journalRetainUntil','journalPurposeReference',claims->>'journalPurposeReference');
END$$;
GRANT SELECT,UPDATE ON public.customer_contract_documents,public.customer_contracts,public.customer_contract_signature_requests,public.customer_contract_acceptances,public.customer_contract_evidence,public.customer_addresses,public.customer_portal_events,public.customer_portal_api_access_logs,public.customer_events,public.domain_events,public.customer_legal_acceptances,public.customer_onboarding_legal_snapshots,public.customers,public.customer_supply_periods,public.customer_portal_accounts,public.customer_portal_claims,storage.objects TO gridex_ediel_retention_owner;

DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_retention' AND p.proname LIKE 'record_%' AND p.proname!~'^record_[a-f0-9]{20}_guard_v1$' OR n.nspname='gridex_ediel_retention' AND p.proname='contract_storage_guard_v1' OR n.nspname='public' AND p.proname IN('ediel_submit_customer_record_retention_v1','ediel_review_customer_record_retention_v1','ediel_revoke_customer_record_retention_v1','ediel_begin_customer_record_retention_v1','ediel_finish_contract_document_retention_v1','ediel_is_qualified_customer_record_transition_v1','ediel_require_customer_record_available_v1','ediel_require_contract_records_available_v1','ediel_customer_record_tombstones_v1','ediel_require_portal_retention_access_v1','ediel_contract_retention_storage_target_v1','ediel_current_retention_session_v1','ediel_customer_record_retention_targets_v1','ediel_read_customer_record_retention_v1') LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO gridex_ediel_retention_owner',f.identity);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.identity);END LOOP;END$$;
REVOKE ALL ON FUNCTION public.gridex_prepare_signature_before_record_retention_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text),public.gridex_get_signature_before_record_retention_v1(text),public.gridex_finalize_signature_before_record_retention_v1(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gridex_prepare_customer_contract_signature_request_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text),public.gridex_get_customer_contract_signature_receipt_v1(text),public.gridex_finalize_customer_contract_signature_v1(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_prepare_customer_contract_signature_request_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text),public.gridex_get_customer_contract_signature_receipt_v1(text),public.gridex_finalize_customer_contract_signature_v1(text,text,text) TO service_role;

GRANT EXECUTE ON FUNCTION public.ediel_submit_customer_record_retention_v1(uuid,uuid,text,uuid,text,jsonb),public.ediel_review_customer_record_retention_v1(uuid,uuid,uuid,text,text),public.ediel_revoke_customer_record_retention_v1(uuid,uuid,uuid,text),public.ediel_begin_customer_record_retention_v1(uuid,uuid,uuid),public.ediel_finish_contract_document_retention_v1(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_is_qualified_customer_record_transition_v1(text,jsonb,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_require_customer_record_available_v1(uuid,text,uuid),public.ediel_require_contract_records_available_v1(uuid,uuid),public.ediel_customer_record_tombstones_v1(uuid,uuid),public.ediel_require_portal_retention_access_v1(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ediel_contract_retention_storage_target_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_current_retention_session_v1(uuid,uuid),public.ediel_customer_record_retention_targets_v1(uuid,uuid,text,integer),public.ediel_read_customer_record_retention_v1(uuid,uuid,uuid) TO authenticated;
COMMIT;
