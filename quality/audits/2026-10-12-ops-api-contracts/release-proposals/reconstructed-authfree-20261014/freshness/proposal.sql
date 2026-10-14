-- PRIVATE new reconstruction proposal; not frozen A6, not applied.
CREATE FUNCTION gridex_ediel_retention.blob_receipt_v1(d gridex_ediel_retention.blob_decisions) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE k gridex_ediel_retention.issuers%rowtype;p jsonb;b bytea;issued timestamptz;expires timestamptz;deadline timestamptz;
observed_at timestamptz;BEGIN IF d.document_bytes IS NULL OR encode(sha256(d.document_bytes),'hex') IS DISTINCT FROM d.document_hash THEN RETURN NULL;END IF;
 IF jsonb_typeof(d.issuer_receipt) IS DISTINCT FROM 'object' OR coalesce(d.issuer_receipt->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(d.issuer_receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 32768 THEN RETURN NULL;END IF;
 SELECT * INTO k FROM gridex_ediel_retention.issuers WHERE id=(d.issuer_receipt->>'issuerId')::uuid AND company_id=d.company_id FOR SHARE;
 observed_at:=clock_timestamp();
 IF k.id IS NULL OR observed_at<k.valid_from OR observed_at>=k.valid_to OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=k.id) OR EXISTS(SELECT FROM gridex_ediel_retention.blob_revocations WHERE decision_id=d.id) THEN RETURN NULL;END IF;
 b:=decode(d.issuer_receipt->>'payloadBase64','base64');IF encode(gridex_requested_changes.receipt_hmac_sha256_v1(b,k.signing_key),'hex') IS DISTINCT FROM d.issuer_receipt->>'signatureHex' THEN RETURN NULL;END IF;
 p:=convert_from(b,'UTF8')::jsonb;issued:=(p->>'issuedAt')::timestamptz;expires:=(p->>'expiresAt')::timestamptz;deadline:=(p->>'retainUntil')::timestamptz;
 IF p->>'format' IS DISTINCT FROM 'ediel_blob_retention_policy_v1' OR p->>'retentionClass' IS DISTINCT FROM d.retention_class OR p->>'companyId' IS DISTINCT FROM d.company_id::text OR p->>'targetId' IS DISTINCT FROM d.target_id::text OR p->>'messageId' IS DISTINCT FROM d.message_id::text OR p->>'sourceHash' IS DISTINCT FROM d.source_hash OR p->>'targetHash' IS DISTINCT FROM d.target_hash OR p->>'documentHash' IS DISTINCT FROM d.document_hash OR p->>'issuerLegalReference' IS DISTINCT FROM k.legal_reference OR nullif(p->>'legalBasisReference','') IS NULL OR isfinite(issued) IS DISTINCT FROM true OR isfinite(expires) IS DISTINCT FROM true OR isfinite(deadline) IS DISTINCT FROM true OR issued>observed_at OR expires<=observed_at OR issued<k.valid_from OR expires>k.valid_to THEN RETURN NULL;END IF;RETURN p;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;
END$_$;

CREATE FUNCTION gridex_ediel_retention.receipt_v1(d gridex_ediel_retention.decisions) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE k gridex_ediel_retention.issuers%rowtype;p jsonb;bytes bytea;issued timestamptz;expires timestamptz;deadline timestamptz;
observed_at timestamptz;BEGIN IF d.document_bytes IS NULL OR encode(sha256(d.document_bytes),'hex') IS DISTINCT FROM d.document_hash THEN RETURN NULL;END IF;
 IF jsonb_typeof(d.issuer_receipt) IS DISTINCT FROM 'object' OR coalesce(d.issuer_receipt->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(d.issuer_receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 32768 THEN RETURN NULL;END IF;
 SELECT * INTO k FROM gridex_ediel_retention.issuers WHERE id=(d.issuer_receipt->>'issuerId')::uuid AND company_id=d.company_id FOR SHARE;
 observed_at:=clock_timestamp();
 IF k.id IS NULL OR observed_at<k.valid_from OR observed_at>=k.valid_to OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=k.id) OR EXISTS(SELECT FROM gridex_ediel_retention.revocations WHERE decision_id=d.id) THEN RETURN NULL;END IF;
 bytes:=decode(d.issuer_receipt->>'payloadBase64','base64');IF encode(gridex_requested_changes.receipt_hmac_sha256_v1(bytes,k.signing_key),'hex') IS DISTINCT FROM d.issuer_receipt->>'signatureHex' THEN RETURN NULL;END IF;
 p:=convert_from(bytes,'UTF8')::jsonb;issued:=(p->>'issuedAt')::timestamptz;expires:=(p->>'expiresAt')::timestamptz;deadline:=(p->>'retainUntil')::timestamptz;
 IF p->>'format' IS DISTINCT FROM 'ediel_retention_policy_v1' OR p->>'retentionClass' IS DISTINCT FROM 'requested_change_source_artifact_bytes'
 OR p->>'companyId' IS DISTINCT FROM d.company_id::text OR p->>'artifactId' IS DISTINCT FROM d.artifact_id::text OR p->>'sourceHash' IS DISTINCT FROM d.source_hash OR p->>'claimsHash' IS DISTINCT FROM d.claims_hash
 OR p->>'documentHash' IS DISTINCT FROM d.document_hash OR p->>'issuerLegalReference' IS DISTINCT FROM k.legal_reference OR nullif(p->>'legalBasisReference','') IS NULL
 OR isfinite(issued) IS DISTINCT FROM true OR isfinite(expires) IS DISTINCT FROM true OR isfinite(deadline) IS DISTINCT FROM true OR issued>observed_at OR expires<=observed_at OR issued<k.valid_from OR expires>k.valid_to THEN RETURN NULL;END IF;
 RETURN p;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;
END$_$;

CREATE FUNCTION gridex_ediel_retention.finance_receipt_v1(d gridex_ediel_retention.finance_decisions) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE issuer gridex_ediel_retention.issuers%rowtype;p jsonb;bytes bytea;issued timestamptz;expires timestamptz;deadline timestamptz;journal_end timestamptz;operation text;observed_at timestamptz;BEGIN IF d.document_bytes IS NULL OR encode(sha256(d.document_bytes),'hex') IS DISTINCT FROM d.document_hash THEN RETURN NULL;END IF;
 IF jsonb_typeof(d.issuer_receipt) IS DISTINCT FROM 'object' OR coalesce(d.issuer_receipt->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(d.issuer_receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 32768 THEN RETURN NULL;END IF;
 SELECT * INTO issuer FROM gridex_ediel_retention.issuers WHERE id=(d.issuer_receipt->>'issuerId')::uuid AND company_id=d.company_id FOR SHARE;
 observed_at:=clock_timestamp();
 IF issuer.id IS NULL OR observed_at<issuer.valid_from OR observed_at>=issuer.valid_to OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=issuer.id) OR EXISTS(SELECT FROM gridex_ediel_retention.finance_revocations WHERE decision_id=d.id) THEN RETURN NULL;END IF;
 bytes:=decode(d.issuer_receipt->>'payloadBase64','base64');IF encode(gridex_requested_changes.receipt_hmac_sha256_v1(bytes,issuer.signing_key),'hex') IS DISTINCT FROM d.issuer_receipt->>'signatureHex' THEN RETURN NULL;END IF;
 p:=convert_from(bytes,'UTF8')::jsonb;issued:=(p->>'issuedAt')::timestamptz;expires:=(p->>'expiresAt')::timestamptz;deadline:=(p->>'retainUntil')::timestamptz;journal_end:=(p->>'journalRetainUntil')::timestamptz;
 SELECT x.operation INTO STRICT operation FROM gridex_ediel_retention.finance_class_catalog x WHERE retention_class=d.retention_class;
 IF p->>'format' IS DISTINCT FROM 'ediel_finance_copy_retention_policy_v1' OR p->>'retentionClass' IS DISTINCT FROM d.retention_class OR p->>'targetId' IS DISTINCT FROM d.target_id OR p->>'companyId' IS DISTINCT FROM d.company_id::text
 OR p->>'sourceTable' IS DISTINCT FROM (SELECT source_schema||'.'||source_table FROM gridex_ediel_retention.finance_class_catalog WHERE retention_class=d.retention_class)
 OR p->>'sourceHash' IS DISTINCT FROM d.source_hash OR p->>'targetHash' IS DISTINCT FROM d.target_hash OR p->>'scopeHash' IS DISTINCT FROM d.scope_hash OR p->>'documentHash' IS DISTINCT FROM d.document_hash OR p->>'operation' IS DISTINCT FROM operation
 OR p->>'issuerLegalReference' IS DISTINCT FROM issuer.legal_reference OR nullif(p->>'legalBasisReference','') IS NULL OR nullif(p->>'journalPurposeReference','') IS NULL OR p->>'accessRevocationRequired' IS DISTINCT FROM 'true'
 OR isfinite(issued) IS DISTINCT FROM true OR isfinite(expires) IS DISTINCT FROM true OR isfinite(deadline) IS DISTINCT FROM true OR isfinite(journal_end) IS DISTINCT FROM true OR journal_end<=observed_at OR issued>observed_at OR expires<=observed_at OR issued<issuer.valid_from OR expires>issuer.valid_to THEN RETURN NULL;END IF;RETURN p;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;END$_$;

CREATE FUNCTION gridex_ediel_retention.process_receipt_v1(d gridex_ediel_retention.process_decisions) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE issuer gridex_ediel_retention.issuers%rowtype;p jsonb;bytes bytea;issued timestamptz;expires timestamptz;deadline timestamptz;journal_end timestamptz;operation text;observed_at timestamptz;BEGIN IF d.document_bytes IS NULL OR encode(sha256(d.document_bytes),'hex') IS DISTINCT FROM d.document_hash THEN RETURN NULL;END IF;
 IF jsonb_typeof(d.issuer_receipt) IS DISTINCT FROM 'object' OR coalesce(d.issuer_receipt->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(d.issuer_receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 32768 THEN RETURN NULL;END IF;
 SELECT * INTO issuer FROM gridex_ediel_retention.issuers WHERE id=(d.issuer_receipt->>'issuerId')::uuid AND company_id=d.company_id FOR SHARE;
 observed_at:=clock_timestamp();
 IF issuer.id IS NULL OR observed_at<issuer.valid_from OR observed_at>=issuer.valid_to OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=issuer.id) OR EXISTS(SELECT FROM gridex_ediel_retention.process_revocations WHERE decision_id=d.id) THEN RETURN NULL;END IF;
 bytes:=decode(d.issuer_receipt->>'payloadBase64','base64');IF encode(gridex_requested_changes.receipt_hmac_sha256_v1(bytes,issuer.signing_key),'hex') IS DISTINCT FROM d.issuer_receipt->>'signatureHex' THEN RETURN NULL;END IF;
 p:=convert_from(bytes,'UTF8')::jsonb;issued:=(p->>'issuedAt')::timestamptz;expires:=(p->>'expiresAt')::timestamptz;deadline:=(p->>'retainUntil')::timestamptz;journal_end:=(p->>'journalRetainUntil')::timestamptz;
 SELECT x.operation INTO STRICT operation FROM gridex_ediel_retention.process_class_catalog x WHERE retention_class=d.retention_class;
 IF p->>'format' IS DISTINCT FROM 'ediel_process_journal_retention_policy_v1' OR p->>'retentionClass' IS DISTINCT FROM d.retention_class OR p->>'targetId' IS DISTINCT FROM d.target_id OR p->>'companyId' IS DISTINCT FROM d.company_id::text
 OR p->>'sourceTable' IS DISTINCT FROM (SELECT source_table FROM gridex_ediel_retention.process_class_catalog WHERE retention_class=d.retention_class)
 OR p->>'sourceHash' IS DISTINCT FROM d.source_hash OR p->>'targetHash' IS DISTINCT FROM d.target_hash OR p->>'scopeHash' IS DISTINCT FROM d.scope_hash OR p->>'documentHash' IS DISTINCT FROM d.document_hash OR p->>'operation' IS DISTINCT FROM operation
 OR p->>'issuerLegalReference' IS DISTINCT FROM issuer.legal_reference OR nullif(p->>'legalBasisReference','') IS NULL OR nullif(p->>'journalPurposeReference','') IS NULL OR p->>'accessRevocationRequired' IS DISTINCT FROM 'true'
 OR isfinite(issued) IS DISTINCT FROM true OR isfinite(expires) IS DISTINCT FROM true OR isfinite(deadline) IS DISTINCT FROM true OR isfinite(journal_end) IS DISTINCT FROM true OR journal_end<=observed_at OR issued>observed_at OR expires<=observed_at OR issued<issuer.valid_from OR expires>issuer.valid_to THEN RETURN NULL;END IF;RETURN p;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;END$_$;

CREATE FUNCTION gridex_ediel_retention.record_receipt_v1(d gridex_ediel_retention.record_decisions) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE issuer gridex_ediel_retention.issuers%rowtype;spec gridex_ediel_retention.record_class_catalog%rowtype;body jsonb;bytes bytea;issued timestamptz;expires timestamptz;deadline timestamptz;journal_deadline timestamptz;
observed_at timestamptz;BEGIN IF d.document_bytes IS NULL OR encode(sha256(d.document_bytes),'hex') IS DISTINCT FROM d.document_hash THEN RETURN NULL;END IF;
 IF jsonb_typeof(d.issuer_receipt) IS DISTINCT FROM 'object' OR coalesce(d.issuer_receipt->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(d.issuer_receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 32768 THEN RETURN NULL;END IF;
 SELECT * INTO issuer FROM gridex_ediel_retention.issuers WHERE id=(d.issuer_receipt->>'issuerId')::uuid AND company_id=d.company_id FOR SHARE;
 observed_at:=clock_timestamp();
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=d.retention_class;
 IF issuer.id IS NULL OR observed_at<issuer.valid_from OR observed_at>=issuer.valid_to OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=issuer.id) OR EXISTS(SELECT FROM gridex_ediel_retention.record_revocations WHERE decision_id=d.id) THEN RETURN NULL;END IF;
 bytes:=decode(d.issuer_receipt->>'payloadBase64','base64');IF encode(gridex_requested_changes.receipt_hmac_sha256_v1(bytes,issuer.signing_key),'hex') IS DISTINCT FROM d.issuer_receipt->>'signatureHex' THEN RETURN NULL;END IF;
 body:=convert_from(bytes,'UTF8')::jsonb;issued:=(body->>'issuedAt')::timestamptz;expires:=(body->>'expiresAt')::timestamptz;deadline:=(body->>'retainUntil')::timestamptz;journal_deadline:=(body->>'journalRetainUntil')::timestamptz;
 IF body->>'format' IS DISTINCT FROM 'ediel_customer_record_retention_policy_v1' OR body->>'retentionClass' IS DISTINCT FROM d.retention_class OR body->>'sourceTable' IS DISTINCT FROM spec.source_table OR body->>'operation' IS DISTINCT FROM spec.operation OR body->>'companyId' IS DISTINCT FROM d.company_id::text OR body->>'customerId' IS DISTINCT FROM d.customer_id::text OR body->>'targetId' IS DISTINCT FROM d.target_id::text OR body->>'sourceHash' IS DISTINCT FROM d.source_hash OR body->>'targetHash' IS DISTINCT FROM d.target_hash OR body->>'documentHash' IS DISTINCT FROM d.document_hash OR body->>'issuerLegalReference' IS DISTINCT FROM issuer.legal_reference
 OR nullif(body->>'legalBasisReference','') IS NULL OR nullif(body->>'journalPurposeReference','') IS NULL OR body->>'accessRevocationRequired' IS DISTINCT FROM 'true'
 OR isfinite(issued) IS DISTINCT FROM true OR isfinite(expires) IS DISTINCT FROM true OR isfinite(deadline) IS DISTINCT FROM true OR isfinite(journal_deadline) IS DISTINCT FROM true OR issued>observed_at OR expires<=observed_at OR issued<issuer.valid_from OR expires>issuer.valid_to OR journal_deadline<=observed_at THEN RETURN NULL;END IF;
 RETURN body;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;
END$_$;

CREATE FUNCTION gridex_ediel_retention.record_permission_v1(c uuid, actor uuid, k text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE wanted text;observed_at timestamptz;BEGIN
 LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides IN SHARE MODE;
 PERFORM public.ediel_retention_lock_auth_actor_v1(actor);
 PERFORM id FROM public.companies WHERE id=c FOR SHARE;
 PERFORM id FROM public.user_profiles WHERE id=actor FOR SHARE;
 PERFORM user_id FROM public.company_memberships WHERE company_id=c AND user_id=actor FOR SHARE;
 observed_at:=clock_timestamp();
 IF k='__read_scope__' THEN wanted:='ediel.retention.read';ELSE SELECT permission_key INTO wanted FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=k;END IF;
 IF wanted IS NULL OR NOT EXISTS(SELECT FROM public.companies WHERE id=c AND status IN('active','archived','pending_deletion','closed'))
 OR NOT public.ediel_retention_lock_auth_actor_v1(actor)
 OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active' AND to_jsonb(u)->>'disabled_at' IS NULL)
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.permissions WHERE key=wanted AND is_active) THEN RETURN false;END IF;
 IF EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND u.effect='deny' AND p.key=wanted)
 OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND (o.company_id=c OR o.company_id IS NULL) AND o.is_active AND o.effect='deny' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=observed_at) AND (o.valid_to IS NULL OR observed_at<o.valid_to))
 OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='deny' AND p.key=wanted) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND u.effect='allow' AND p.is_active AND p.key=wanted)
 OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='allow' AND p.is_active AND p.key=wanted)
 OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND o.company_id=c AND o.is_active AND o.effect='allow' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=observed_at) AND (o.valid_to IS NULL OR observed_at<o.valid_to));
END$$;

CREATE FUNCTION gridex_ediel_retention.blob_current_v1(d gridex_ediel_retention.blob_decisions) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE r gridex_ediel_retention.blob_reviews%rowtype;claims jsonb;observed_at timestamptz;BEGIN
 LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides IN SHARE MODE;
 SELECT * INTO r FROM gridex_ediel_retention.blob_reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
 PERFORM public.ediel_retention_lock_auth_actor_v1(r.actor_user_id);PERFORM id FROM public.user_profiles WHERE id=r.actor_user_id FOR SHARE;PERFORM user_id FROM public.company_memberships WHERE company_id=d.company_id AND user_id=r.actor_user_id FOR SHARE;
 IF r.outcome IS DISTINCT FROM 'approved' OR NOT public.ediel_retention_lock_auth_actor_v1(r.actor_user_id) OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=r.actor_user_id AND user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=d.company_id AND user_id=r.actor_user_id AND status='active' AND is_active AND accepted_at IS NOT NULL) OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE THEN RETURN NULL;END IF;
 IF gridex_ediel_retention.class_permission_v1(d.company_id,r.actor_user_id,d.retention_class) IS NOT TRUE THEN RETURN NULL;END IF;claims:=gridex_ediel_retention.blob_receipt_v1(d);
 IF r.outcome IS DISTINCT FROM 'approved' OR NOT public.ediel_retention_lock_auth_actor_v1(r.actor_user_id) OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=r.actor_user_id AND user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=d.company_id AND user_id=r.actor_user_id AND status='active' AND is_active AND accepted_at IS NOT NULL) OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE THEN RETURN NULL;END IF;
 IF gridex_ediel_retention.class_permission_v1(d.company_id,r.actor_user_id,d.retention_class) IS NOT TRUE THEN RETURN NULL;END IF;
 observed_at:=clock_timestamp();IF claims IS NULL OR (claims->>'retainUntil')::timestamptz>observed_at THEN RETURN NULL;END IF;RETURN r.id;
END$$;

CREATE FUNCTION gridex_ediel_retention.record_current_review_v1(d gridex_ediel_retention.record_decisions) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE r gridex_ediel_retention.record_reviews%rowtype;claims jsonb;observed_at timestamptz;BEGIN
 LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides IN SHARE MODE;
 SELECT * INTO r FROM gridex_ediel_retention.record_reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
 PERFORM public.ediel_retention_lock_auth_actor_v1(r.actor_user_id);PERFORM id FROM public.user_profiles WHERE id=r.actor_user_id FOR SHARE;PERFORM user_id FROM public.company_memberships WHERE company_id=d.company_id AND user_id=r.actor_user_id FOR SHARE;
 IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE OR gridex_ediel_retention.record_permission_v1(d.company_id,r.actor_user_id,d.retention_class) IS NOT TRUE THEN RETURN NULL;END IF;
 claims:=gridex_ediel_retention.record_receipt_v1(d);
 IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR gridex_ediel_retention.permission_v1(d.company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE OR gridex_ediel_retention.record_permission_v1(d.company_id,r.actor_user_id,d.retention_class) IS NOT TRUE THEN RETURN NULL;END IF;
 observed_at:=clock_timestamp();IF claims IS NULL OR (claims->>'retainUntil')::timestamptz>observed_at THEN RETURN NULL;END IF;RETURN r.id;
END$$;

CREATE FUNCTION public.ediel_begin_customer_record_retention_v1(p_company_id uuid, p_actor_user_id uuid, p_decision_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$
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
 EXECUTE format('SELECT id FROM public.%I WHERE id=$1 AND company_id=$2 FOR UPDATE',spec.source_table) USING d.target_id,p_company_id;
 claims:=gridex_ediel_retention.record_receipt_v1(d);
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 IF gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_record_class_grant_required';END IF;
 r:=gridex_ediel_retention.record_current_review_v1(d);at:=clock_timestamp();
 IF r IS NULL OR claims IS NULL OR (claims->>'retainUntil')::timestamptz>at THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_exact_class_legal_review_deadline']);END IF;
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
END$_$;

CREATE FUNCTION public.ediel_purge_artifact_retention_v1(p_company_id uuid, p_actor_user_id uuid, p_decision_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE d gridex_ediel_retention.decisions%rowtype;r gridex_ediel_retention.reviews%rowtype;a gridex_requested_changes.artifacts%rowtype;p gridex_ediel_retention.purges%rowtype;claims jsonb;o gridex_requested_changes.review_origins%rowtype;at timestamptz:=clock_timestamp();
BEGIN PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 IF gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,'requested_change_source_artifact_bytes') IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_class_grant_required';END IF;SELECT * INTO STRICT d FROM gridex_ediel_retention.decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;
 IF gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,'requested_change_source_artifact_bytes') IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_class_grant_required';END IF;SELECT * INTO STRICT a FROM gridex_requested_changes.artifacts WHERE id=d.artifact_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO p FROM gridex_ediel_retention.purges WHERE artifact_id=a.id;
 IF FOUND THEN IF p.decision_id IS DISTINCT FROM d.id THEN RAISE EXCEPTION 'ediel_retention_purge_decision_conflict';END IF;RETURN jsonb_build_object('status','purged','artifactId',a.id,'sourceHash',p.source_hash,'byteLength',p.byte_length,'purgedAt',p.created_at,'replay',true);END IF;
 SELECT * INTO r FROM gridex_ediel_retention.reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
 PERFORM public.ediel_retention_lock_auth_actor_v1(r.actor_user_id);PERFORM id FROM public.user_profiles WHERE id=r.actor_user_id FOR SHARE;
 PERFORM user_id FROM public.company_memberships WHERE company_id=p_company_id AND user_id=r.actor_user_id FOR SHARE;
 IF NOT public.ediel_retention_lock_auth_actor_v1(r.actor_user_id)
 OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=r.actor_user_id AND user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=p_company_id AND user_id=r.actor_user_id AND status='active' AND is_active AND accepted_at IS NOT NULL)
 OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_retention_reviewer_authority']);END IF;
 IF gridex_ediel_retention.class_permission_v1(p_company_id,r.actor_user_id,'requested_change_source_artifact_bytes') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_retention_class_reviewer_authority']);END IF;claims:=gridex_ediel_retention.receipt_v1(d);
 IF r.outcome IS DISTINCT FROM 'approved' OR claims IS NULL OR (claims->>'retainUntil')::timestamptz>clock_timestamp() THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_approved_legal_retention_deadline']);END IF;
 IF a.source_hash IS DISTINCT FROM d.source_hash OR a.claims_hash IS DISTINCT FROM d.claims_hash OR a.source_bytes IS NULL OR encode(sha256(a.source_bytes),'hex') IS DISTINCT FROM d.source_hash THEN RAISE EXCEPTION 'ediel_retention_target_original_changed';END IF;
 SELECT * INTO o FROM gridex_requested_changes.review_origins WHERE artifact_id=a.id AND company_id=p_company_id FOR SHARE;
 IF o.event_id IS NOT NULL THEN
  PERFORM id FROM gridex_requested_changes.events WHERE id=o.event_id AND company_id=p_company_id FOR UPDATE;
 END IF;
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 IF gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,'requested_change_source_artifact_bytes') IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_class_grant_required';END IF;
 claims:=gridex_ediel_retention.receipt_v1(d);
 IF NOT public.ediel_retention_lock_auth_actor_v1(r.actor_user_id) OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE OR gridex_ediel_retention.class_permission_v1(p_company_id,r.actor_user_id,'requested_change_source_artifact_bytes') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_retention_reviewer_authority']);END IF;
 at:=clock_timestamp();IF r.outcome IS DISTINCT FROM 'approved' OR claims IS NULL OR (claims->>'retainUntil')::timestamptz>at THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_approved_legal_retention_deadline']);END IF;
 IF o.event_id IS NOT NULL THEN
  INSERT INTO gridex_requested_changes.revocations(event_id,source_reference,source_sha256,actor_user_id) VALUES(o.event_id,claims->>'legalBasisReference',d.document_hash,p_actor_user_id) ON CONFLICT DO NOTHING;
 END IF;
 INSERT INTO gridex_ediel_retention.purges(artifact_id,company_id,decision_id,review_id,source_hash,claims_hash,byte_length,actor_user_id,event_id,created_at) VALUES(a.id,a.company_id,d.id,r.id,a.source_hash,a.claims_hash,octet_length(a.source_bytes),p_actor_user_id,o.event_id,at);
 UPDATE gridex_requested_changes.artifacts SET source_bytes=NULL,purged_at=at WHERE id=a.id AND company_id=p_company_id;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'ediel_source_artifact',a.id,'ediel.retention.bytes_purged',jsonb_build_object('decisionId',d.id,'reviewId',r.id,'sourceHash',a.source_hash,'claimsHash',a.claims_hash,'byteLength',octet_length(a.source_bytes),'purgedAt',at,'operationalEventRevoked',o.event_id));
 RETURN jsonb_build_object('status','purged','artifactId',a.id,'sourceHash',a.source_hash,'byteLength',octet_length(a.source_bytes),'purgedAt',at,'replay',false);
END$$;

CREATE FUNCTION public.ediel_purge_process_journal_retention_v1(p_company_id uuid, p_actor_user_id uuid, p_decision_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$DECLARE d gridex_ediel_retention.process_decisions%rowtype;t gridex_ediel_retention.process_tombstones%rowtype;p jsonb;basis jsonb;r gridex_ediel_retention.process_reviews%rowtype;spec gridex_ediel_retention.process_class_catalog%rowtype;at timestamptz:=clock_timestamp();BEGIN
 PERFORM gridex_ediel_retention.record_actor_v1(p_company_id,p_actor_user_id,'legal_acceptance_personal_snapshot','ediel.retention.purge');SELECT * INTO STRICT d FROM gridex_ediel_retention.process_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO t FROM gridex_ediel_retention.process_tombstones WHERE retention_class=d.retention_class AND target_id=d.target_id;IF FOUND THEN IF t.decision_id IS DISTINCT FROM d.id OR t.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'process_retention_replay_conflict';END IF;RETURN jsonb_build_object('status','redacted','retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'byteLength',t.byte_length,'replay',true);END IF;
 SELECT * INTO r FROM gridex_ediel_retention.process_reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR gridex_ediel_retention.record_permission_v1(p_company_id,r.actor_user_id,'legal_acceptance_personal_snapshot') IS NOT TRUE OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_separate_exact_class_review']);END IF;
 -- Re-lock the separate reviewer's actual auth/row/grant graph, not a cached UI.
 PERFORM gridex_ediel_retention.record_lock_review_actor_v1(p_company_id,r.actor_user_id);
 p:=gridex_ediel_retention.process_receipt_v1(d);IF p IS NULL OR (p->>'retainUntil')::timestamptz>at THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_exact_class_legal_deadline']);END IF;
 basis:=gridex_ediel_retention.process_basis_v1(p_company_id,d.retention_class,d.target_id);IF basis->>'sourceHash' IS DISTINCT FROM d.source_hash OR basis->>'targetHash' IS DISTINCT FROM d.target_hash OR basis->>'scopeHash' IS DISTINCT FROM d.scope_hash OR basis->>'allIncludedScopesClosed' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unchanged_source_and_all_included_scopes_closed']);END IF;
 LOCK TABLE public.customer_portal_accounts,public.customer_portal_claims IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.process_class_catalog WHERE retention_class=d.retention_class;
 EXECUTE format('SELECT id FROM gridex_correction_process.%I WHERE id::text=$1 AND company_id=$2 FOR UPDATE',spec.source_table) USING d.target_id,p_company_id;
 PERFORM gridex_ediel_retention.record_actor_v1(p_company_id,p_actor_user_id,'legal_acceptance_personal_snapshot','ediel.retention.purge');
 PERFORM gridex_ediel_retention.record_lock_review_actor_v1(p_company_id,r.actor_user_id);
 p:=gridex_ediel_retention.process_receipt_v1(d);
 PERFORM gridex_ediel_retention.record_actor_v1(p_company_id,p_actor_user_id,'legal_acceptance_personal_snapshot','ediel.retention.purge');
 PERFORM gridex_ediel_retention.record_lock_review_actor_v1(p_company_id,r.actor_user_id);
 at:=clock_timestamp();IF p IS NULL OR (p->>'retainUntil')::timestamptz>at THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_exact_class_legal_deadline']);END IF;
 UPDATE public.customer_portal_accounts SET status='revoked',is_active=false,updated_at=at WHERE company_id=p_company_id AND customer_id IN(SELECT value::uuid FROM jsonb_array_elements_text(basis->'includedCustomers'));UPDATE public.customer_portal_claims SET status='revoked',updated_at=at WHERE company_id=p_company_id AND customer_id IN(SELECT value::uuid FROM jsonb_array_elements_text(basis->'includedCustomers'));
 INSERT INTO gridex_ediel_retention.process_tombstones(retention_class,target_id,company_id,decision_id,review_id,source_hash,target_hash,scope_hash,byte_length,actor_user_id,journal_retain_until,journal_purpose_reference,created_at) VALUES(d.retention_class,d.target_id,p_company_id,d.id,r.id,d.source_hash,d.target_hash,d.scope_hash,(basis->>'byteLength')::bigint,p_actor_user_id,(p->>'journalRetainUntil')::timestamptz,p->>'journalPurposeReference',at);
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.process_class_catalog WHERE retention_class=d.retention_class;
 IF d.retention_class='correction_process_fact_body' THEN UPDATE gridex_correction_process.facts f SET old_fact=NULL,new_fact=jsonb_build_object('retentionUnavailable',true,'sourceHash',d.source_hash,'complete',false,'authority','none') WHERE id=d.target_id::bigint AND company_id=p_company_id;
 ELSE EXECUTE format('UPDATE gridex_correction_process.%I SET readset_text=$1 WHERE id=$2 AND company_id=$3',spec.source_table) USING jsonb_build_object('retentionUnavailable',true,'sourceHash',d.source_hash,'complete',false,'authority','none')::text,d.target_id::uuid,p_company_id;END IF;
 INSERT INTO gridex_ediel_retention.process_events(retention_class,target_id,actor_user_id) VALUES(d.retention_class,d.target_id,p_actor_user_id);INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'process_journal_retention',d.id,'ediel.retention.process_redacted',jsonb_build_object('retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'scopeHash',d.scope_hash,'journalRetainUntil',p->>'journalRetainUntil','journalPurposeReference',p->>'journalPurposeReference','complete',false,'authority','none'));
 RETURN jsonb_build_object('status','redacted','retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'byteLength',(basis->>'byteLength')::bigint,'replay',false);END$_$;

CREATE FUNCTION public.ediel_purge_finance_copy_retention_v1(p_company_id uuid, p_actor_user_id uuid, p_decision_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$DECLARE d gridex_ediel_retention.finance_decisions%rowtype;t gridex_ediel_retention.finance_tombstones%rowtype;r gridex_ediel_retention.finance_reviews%rowtype;spec gridex_ediel_retention.finance_class_catalog%rowtype;p jsonb;basis jsonb;oldrow jsonb;redacted jsonb;cols text;at timestamptz;BEGIN
 SELECT * INTO STRICT d FROM gridex_ediel_retention.finance_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;PERFORM gridex_ediel_retention.finance_actor_v1(p_company_id,p_actor_user_id,d.retention_class,'ediel.retention.purge');SELECT * INTO t FROM gridex_ediel_retention.finance_tombstones WHERE retention_class=d.retention_class AND target_id=d.target_id;IF FOUND THEN IF t.decision_id IS DISTINCT FROM d.id OR t.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'finance_retention_replay_conflict';END IF;RETURN jsonb_build_object('status','redacted','retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'byteLength',t.byte_length,'replay',true);END IF;
 SELECT * INTO r FROM gridex_ediel_retention.finance_reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;SELECT * INTO STRICT spec FROM gridex_ediel_retention.finance_class_catalog WHERE retention_class=d.retention_class;
 IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR public.ediel_retention_lock_auth_actor_v1(r.actor_user_id) IS NOT TRUE OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,spec.permission_key) IS NOT TRUE OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_separate_exact_class_review']);END IF;
 p:=gridex_ediel_retention.finance_receipt_v1(d);IF p IS NULL OR (p->>'retainUntil')::timestamptz>clock_timestamp() THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_exact_class_legal_deadline']);END IF;
 basis:=gridex_ediel_retention.finance_basis_v1(p_company_id,d.retention_class,d.target_id);IF basis->>'sourceHash' IS DISTINCT FROM d.source_hash OR basis->>'targetHash' IS DISTINCT FROM d.target_hash OR basis->>'scopeHash' IS DISTINCT FROM d.scope_hash OR basis->>'allIncludedScopesClosed' IS DISTINCT FROM 'true' OR p->>'periodStart' IS DISTINCT FROM basis->>'periodStart' OR p->>'periodEnd' IS DISTINCT FROM basis->>'periodEnd' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unchanged_source_native_period_all_scopes_closed']);END IF;
 LOCK TABLE public.customer_portal_accounts,public.customer_portal_claims IN SHARE ROW EXCLUSIVE MODE;EXECUTE format('SELECT to_jsonb(x) FROM %I.%I x WHERE %I::text=$1 AND company_id=$2 FOR UPDATE',spec.source_schema,spec.source_table,spec.id_column) INTO oldrow USING d.target_id,p_company_id;
 PERFORM id FROM public.user_profiles WHERE id=r.actor_user_id FOR SHARE;PERFORM user_id FROM public.company_memberships WHERE company_id=p_company_id AND user_id=r.actor_user_id FOR SHARE;
 p:=gridex_ediel_retention.finance_receipt_v1(d);
 PERFORM gridex_ediel_retention.finance_actor_v1(p_company_id,p_actor_user_id,d.retention_class,'ediel.retention.purge');
 IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR public.ediel_retention_lock_auth_actor_v1(r.actor_user_id) IS NOT TRUE OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,spec.permission_key) IS NOT TRUE OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_separate_exact_class_review']);END IF;
 at:=clock_timestamp();IF p IS NULL OR (p->>'retainUntil')::timestamptz>at THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_exact_class_legal_deadline']);END IF;
UPDATE public.customer_portal_accounts SET status='revoked',is_active=false,updated_at=at WHERE company_id=p_company_id AND customer_id IN(SELECT value::uuid FROM jsonb_array_elements_text(basis->'includedCustomers'));UPDATE public.customer_portal_claims SET status='revoked',updated_at=at WHERE company_id=p_company_id AND customer_id IN(SELECT value::uuid FROM jsonb_array_elements_text(basis->'includedCustomers'));
 INSERT INTO gridex_ediel_retention.finance_tombstones(retention_class,target_id,company_id,decision_id,review_id,source_hash,target_hash,scope_hash,byte_length,actor_user_id,journal_retain_until,journal_purpose_reference) VALUES(d.retention_class,d.target_id,p_company_id,d.id,r.id,d.source_hash,d.target_hash,d.scope_hash,(basis->>'byteLength')::bigint,p_actor_user_id,(p->>'journalRetainUntil')::timestamptz,p->>'journalPurposeReference');
 redacted:=gridex_ediel_retention.finance_redacted_v1(d.retention_class,oldrow,d.source_hash);SELECT string_agg(format('%I',v),',') INTO cols FROM unnest(spec.body_columns)v;EXECUTE format('UPDATE %I.%I SET (%s)=(SELECT %s FROM jsonb_populate_record(NULL::%I.%I,$1)) WHERE %I::text=$2 AND company_id=$3',spec.source_schema,spec.source_table,cols,cols,spec.source_schema,spec.source_table,spec.id_column) USING redacted,d.target_id,p_company_id;
 INSERT INTO gridex_ediel_retention.finance_events(retention_class,target_id,actor_user_id) VALUES(d.retention_class,d.target_id,p_actor_user_id);INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'finance_copy_retention',d.id,'ediel.retention.finance_redacted',jsonb_build_object('retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'scopeHash',d.scope_hash,'journalRetainUntil',p->>'journalRetainUntil','journalPurposeReference',p->>'journalPurposeReference','complete',false,'authority','none'));RETURN jsonb_build_object('status','redacted','retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'byteLength',(basis->>'byteLength')::bigint,'replay',false);END$_$;

CREATE FUNCTION public.ediel_purge_decision_evidence_retention_v1(p_company_id uuid, p_actor_user_id uuid, p_policy_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $_$DECLARE d gridex_ediel_retention.decision_evidence_policies%rowtype;r gridex_ediel_retention.decision_evidence_reviews%rowtype;t gridex_ediel_retention.decision_evidence_tombstones%rowtype;spec gridex_ediel_retention.decision_evidence_catalog%rowtype;p jsonb;basis jsonb;at timestamptz:=clock_timestamp();BEGIN PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 PERFORM gridex_ediel_retention.decision_evidence_lock_v1(p_company_id);
 SELECT * INTO STRICT d FROM gridex_ediel_retention.decision_evidence_policies WHERE id=p_policy_id AND company_id=p_company_id FOR UPDATE;PERFORM gridex_ediel_retention.decision_evidence_actor_v1(p_company_id,p_actor_user_id,d.retention_class,'ediel.retention.purge');
 SELECT * INTO t FROM gridex_ediel_retention.decision_evidence_tombstones WHERE retention_class=d.retention_class AND target_id=d.target_id;
 IF FOUND THEN IF t.policy_id IS DISTINCT FROM d.id OR t.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'decision_original_purge_replay_conflict';END IF;RETURN jsonb_build_object('status','purged','retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',t.source_hash,'byteLength',t.byte_length,'bytesAvailable',false,'authority','none','replay',true);END IF;
 SELECT * INTO r FROM gridex_ediel_retention.decision_evidence_reviews WHERE policy_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
 IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by THEN RETURN jsonb_build_object('status','held','policyId',d.id,'missing',ARRAY['separate_current_original_class_review']);END IF;
 PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(p_company_id,r.actor_user_id,d.retention_class);p:=gridex_ediel_retention.decision_evidence_receipt_v1(d);
 IF p IS NULL OR (p->>'retainUntil')::timestamptz>at THEN RETURN jsonb_build_object('status','held','policyId',d.id,'missing',ARRAY['current_exact_original_deadline']);END IF;
 basis:=gridex_ediel_retention.decision_evidence_basis_v1(p_company_id,d.retention_class,d.target_id);IF basis->>'sourceHash' IS DISTINCT FROM d.source_hash OR basis->>'targetMetadataHash' IS DISTINCT FROM d.target_metadata_hash THEN RETURN jsonb_build_object('status','held','policyId',d.id,'missing',ARRAY['unchanged_original_source_metadata']);END IF;
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.decision_evidence_catalog WHERE retention_class=d.retention_class;
 PERFORM gridex_ediel_retention.decision_evidence_actor_v1(p_company_id,p_actor_user_id,d.retention_class,'ediel.retention.purge');
 PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(p_company_id,r.actor_user_id,d.retention_class);
 p:=gridex_ediel_retention.decision_evidence_receipt_v1(d);
 PERFORM gridex_ediel_retention.decision_evidence_actor_v1(p_company_id,p_actor_user_id,d.retention_class,'ediel.retention.purge');
 PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(p_company_id,r.actor_user_id,d.retention_class);
 at:=clock_timestamp();IF p IS NULL OR (p->>'retainUntil')::timestamptz>at THEN RETURN jsonb_build_object('status','held','policyId',d.id,'missing',ARRAY['current_exact_original_deadline']);END IF;
 -- Invalidate the consumed original policy before physical byte removal. Its
 -- already completed receipts remain available as immutable historical facts.
 IF d.retention_class IN('masterdata_declaration_agreement_original_bytes','masterdata_declaration_source_original_bytes','masterdata_preparation_agreement_original_bytes','masterdata_preparation_source_original_bytes','metering_contract_request_agreement_original_bytes','metering_contract_request_source_original_bytes','metering_method_event_agreement_original_bytes','metering_method_event_source_original_bytes') THEN INSERT INTO gridex_ediel_retention.contract_copy_revocations(retention_class,target_id,company_id,policy_id,review_id,source_hash,actor_user_id) VALUES(d.retention_class,d.target_id,d.company_id,d.id,r.id,d.source_hash,p_actor_user_id);ELSIF d.retention_class IN('life_event_classification_source_original_bytes','life_event_classification_receipt_original_bytes','life_event_classification_revocation_original_bytes') THEN INSERT INTO gridex_ediel_retention.classification_copy_revocations(retention_class,classification_id,company_id,source_message_id,policy_id,review_id,source_hash,actor_user_id) SELECT d.retention_class,d.target_id,d.company_id,q.source_message_id,d.id,r.id,d.source_hash,p_actor_user_id FROM gridex_customer_life_events.inbound_classifications q WHERE q.id=d.target_id AND q.company_id=d.company_id;ELSE IF EXISTS(SELECT FROM gridex_ediel_retention.protected_copy_specs WHERE retention_class=d.retention_class) THEN INSERT INTO gridex_ediel_retention.protected_copy_revocations(retention_class,target_id,company_id,policy_id,review_id,source_hash,actor_user_id) VALUES(d.retention_class,d.target_id,d.company_id,d.id,r.id,d.source_hash,p_actor_user_id);ELSE EXECUTE format('INSERT INTO gridex_ediel_retention.%I(%I,actor_user_id,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',spec.revocation_table,spec.revocation_id_column) USING d.target_id,p_actor_user_id,left('Qualified decision-original policy: '||(p->>'legalBasisReference'),4000); END IF; END IF;
 p:=gridex_ediel_retention.decision_evidence_receipt_v1(d);at:=clock_timestamp();IF p IS NULL OR (p->>'retainUntil')::timestamptz>at THEN RAISE EXCEPTION 'contract_copy_native_deadline_changed';END IF; INSERT INTO gridex_ediel_retention.decision_evidence_tombstones(retention_class,target_id,company_id,policy_id,review_id,source_hash,target_metadata_hash,byte_length,actor_user_id,journal_retain_until,journal_purpose_reference,created_at) VALUES(d.retention_class,d.target_id,p_company_id,d.id,r.id,d.source_hash,d.target_metadata_hash,(basis->>'byteLength')::bigint,p_actor_user_id,(p->>'journalRetainUntil')::timestamptz,p->>'journalPurposeReference',at);
 EXECUTE format('UPDATE gridex_ediel_retention.%I SET document_bytes=NULL,document_byte_length=$1,document_purged_at=$2 WHERE id=$3 AND company_id=$4',spec.source_table) USING (basis->>'byteLength')::bigint,at,d.target_id,p_company_id;
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'retention_decision_original',d.target_id,'ediel.retention.decision_original_bytes_removed',jsonb_build_object('policyId',d.id,'reviewId',r.id,'retentionClass',d.retention_class,'sourceHash',d.source_hash,'byteLength',(basis->>'byteLength')::bigint,'journalRetainUntil',p->>'journalRetainUntil','journalPurposeReference',p->>'journalPurposeReference','freshAuthorityRevoked',true));
 RETURN jsonb_build_object('status','purged','retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'byteLength',(basis->>'byteLength')::bigint,'bytesAvailable',false,'authority','none','replay',false);
END$_$;
