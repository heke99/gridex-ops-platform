-- DB05: qualify current authority and finite legal windows after the last wait.
-- PUBLIC-main573 composed predecessors only; no private source or applied-history edit.
-- Original function identities and complete metadata are retained; unknown bodies fail.
-- Native controls appended in the two owned files are PREPARED, NOT_RUN.
DO $db05_patch$
DECLARE
 target regprocedure; expected_md5 text; next_body text; old_body text;
 definition text; before_meta jsonb; after_meta jsonb; before_comment text;
BEGIN
 target:='gridex_ediel_retention.record_permission_v1(uuid,uuid,text)'::regprocedure;
 expected_md5:='4e85ddcbe6d2ca6b1ac46067fb3023a5';
 SELECT p.prosrc,to_jsonb(p)-'prosrc',obj_description(p.oid,'pg_proc') INTO STRICT old_body,before_meta,before_comment FROM pg_proc p WHERE p.oid=target;
 IF md5(old_body) IS DISTINCT FROM expected_md5 THEN RAISE EXCEPTION 'db05_public_composed_predecessor_mismatch: %',target;END IF;
 next_body:=$db05_body$
DECLARE wanted text;db05_observed_at timestamptz;BEGIN
 IF k='__read_scope__' THEN wanted:='ediel.retention.read';ELSE SELECT permission_key INTO wanted FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=k;END IF;
 IF wanted IS NULL OR NOT EXISTS(SELECT FROM public.companies WHERE id=c AND status IN('active','archived','pending_deletion','closed'))
 OR NOT public.ediel_retention_lock_auth_actor_v1(actor)
 OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active' AND to_jsonb(u)->>'disabled_at' IS NULL)
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.permissions WHERE key=wanted AND is_active) THEN RETURN false;END IF;
 db05_observed_at:=clock_timestamp();
 IF EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND u.effect='deny' AND p.key=wanted)
 OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND (o.company_id=c OR o.company_id IS NULL) AND o.is_active AND o.effect='deny' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=db05_observed_at) AND (o.valid_to IS NULL OR db05_observed_at<o.valid_to))
 OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='deny' AND p.key=wanted) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND u.effect='allow' AND p.is_active AND p.key=wanted)
 OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='allow' AND p.is_active AND p.key=wanted)
 OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND o.company_id=c AND o.is_active AND o.effect='allow' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=db05_observed_at) AND (o.valid_to IS NULL OR db05_observed_at<o.valid_to));
END$db05_body$;
 definition:=pg_get_functiondef(target);
 IF position(old_body IN definition)=0 OR (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'db05_unique_body_replacement_required: %',target;END IF;
 EXECUTE replace(definition,old_body,next_body);
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_meta FROM pg_proc p WHERE p.oid=target;
 IF after_meta IS DISTINCT FROM before_meta OR obj_description(target,'pg_proc') IS DISTINCT FROM before_comment OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'e109be0d0134f957dd1a8d755068d272' THEN RAISE EXCEPTION 'db05_function_metadata_preservation_required: %',target;END IF;

 target:='gridex_ediel_retention.record_receipt_v1(gridex_ediel_retention.record_decisions)'::regprocedure;
 expected_md5:='de636571b8ae4842d8b09b44a46308d5';
 SELECT p.prosrc,to_jsonb(p)-'prosrc',obj_description(p.oid,'pg_proc') INTO STRICT old_body,before_meta,before_comment FROM pg_proc p WHERE p.oid=target;
 IF md5(old_body) IS DISTINCT FROM expected_md5 THEN RAISE EXCEPTION 'db05_public_composed_predecessor_mismatch: %',target;END IF;
 next_body:=$db05_body$
DECLARE issuer gridex_ediel_retention.issuers%rowtype;spec gridex_ediel_retention.record_class_catalog%rowtype;body jsonb;bytes bytea;issued timestamptz;expires timestamptz;deadline timestamptz;journal_deadline timestamptz;db05_observed_at timestamptz;
BEGIN IF d.document_bytes IS NULL OR encode(sha256(d.document_bytes),'hex') IS DISTINCT FROM d.document_hash THEN RETURN NULL;END IF;
 IF jsonb_typeof(d.issuer_receipt) IS DISTINCT FROM 'object' OR coalesce(d.issuer_receipt->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(d.issuer_receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 32768 THEN RETURN NULL;END IF;
 SELECT * INTO issuer FROM gridex_ediel_retention.issuers WHERE id=(d.issuer_receipt->>'issuerId')::uuid AND company_id=d.company_id FOR SHARE;
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=d.retention_class;
 db05_observed_at:=clock_timestamp();
 IF issuer.id IS NULL OR db05_observed_at<issuer.valid_from OR db05_observed_at>=issuer.valid_to OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=issuer.id) OR EXISTS(SELECT FROM gridex_ediel_retention.record_revocations WHERE decision_id=d.id) THEN RETURN NULL;END IF;
 bytes:=decode(d.issuer_receipt->>'payloadBase64','base64');IF encode(gridex_requested_changes.receipt_hmac_sha256_v1(bytes,issuer.signing_key),'hex') IS DISTINCT FROM d.issuer_receipt->>'signatureHex' THEN RETURN NULL;END IF;
 body:=convert_from(bytes,'UTF8')::jsonb;issued:=(body->>'issuedAt')::timestamptz;expires:=(body->>'expiresAt')::timestamptz;deadline:=(body->>'retainUntil')::timestamptz;journal_deadline:=(body->>'journalRetainUntil')::timestamptz;
 IF body->>'format' IS DISTINCT FROM 'ediel_customer_record_retention_policy_v1' OR body->>'retentionClass' IS DISTINCT FROM d.retention_class OR body->>'sourceTable' IS DISTINCT FROM spec.source_table OR body->>'operation' IS DISTINCT FROM spec.operation OR body->>'companyId' IS DISTINCT FROM d.company_id::text OR body->>'customerId' IS DISTINCT FROM d.customer_id::text OR body->>'targetId' IS DISTINCT FROM d.target_id::text OR body->>'sourceHash' IS DISTINCT FROM d.source_hash OR body->>'targetHash' IS DISTINCT FROM d.target_hash OR body->>'documentHash' IS DISTINCT FROM d.document_hash OR body->>'issuerLegalReference' IS DISTINCT FROM issuer.legal_reference
 OR nullif(body->>'legalBasisReference','') IS NULL OR nullif(body->>'journalPurposeReference','') IS NULL OR body->>'accessRevocationRequired' IS DISTINCT FROM 'true'
 OR issued IS NULL OR expires IS NULL OR deadline IS NULL OR journal_deadline IS NULL
 OR isfinite(issued) IS DISTINCT FROM true OR isfinite(expires) IS DISTINCT FROM true OR isfinite(deadline) IS DISTINCT FROM true OR isfinite(journal_deadline) IS DISTINCT FROM true OR issued>db05_observed_at OR expires<=db05_observed_at OR issued<issuer.valid_from OR expires>issuer.valid_to OR journal_deadline<=db05_observed_at THEN RETURN NULL;END IF;
 RETURN body;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;
END$db05_body$;
 definition:=pg_get_functiondef(target);
 IF position(old_body IN definition)=0 OR (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'db05_unique_body_replacement_required: %',target;END IF;
 EXECUTE replace(definition,old_body,next_body);
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_meta FROM pg_proc p WHERE p.oid=target;
 IF after_meta IS DISTINCT FROM before_meta OR obj_description(target,'pg_proc') IS DISTINCT FROM before_comment OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'b74f15db6694a860b1e3494bb3cdaac2' THEN RAISE EXCEPTION 'db05_function_metadata_preservation_required: %',target;END IF;

 target:='gridex_ediel_retention.process_receipt_v1(gridex_ediel_retention.process_decisions)'::regprocedure;
 expected_md5:='ec5cdc320266e083f12cced52ebaf7aa';
 SELECT p.prosrc,to_jsonb(p)-'prosrc',obj_description(p.oid,'pg_proc') INTO STRICT old_body,before_meta,before_comment FROM pg_proc p WHERE p.oid=target;
 IF md5(old_body) IS DISTINCT FROM expected_md5 THEN RAISE EXCEPTION 'db05_public_composed_predecessor_mismatch: %',target;END IF;
 next_body:=$db05_body$
DECLARE issuer gridex_ediel_retention.issuers%rowtype;p jsonb;bytes bytea;issued timestamptz;expires timestamptz;deadline timestamptz;journal_end timestamptz;operation text;db05_observed_at timestamptz;BEGIN IF d.document_bytes IS NULL OR encode(sha256(d.document_bytes),'hex') IS DISTINCT FROM d.document_hash THEN RETURN NULL;END IF;
 IF jsonb_typeof(d.issuer_receipt) IS DISTINCT FROM 'object' OR coalesce(d.issuer_receipt->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(d.issuer_receipt->>'payloadBase64','')) NOT BETWEEN 1 AND 32768 THEN RETURN NULL;END IF;
 SELECT * INTO issuer FROM gridex_ediel_retention.issuers WHERE id=(d.issuer_receipt->>'issuerId')::uuid AND company_id=d.company_id FOR SHARE;
 db05_observed_at:=clock_timestamp();
 IF issuer.id IS NULL OR db05_observed_at<issuer.valid_from OR db05_observed_at>=issuer.valid_to OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=issuer.id) OR EXISTS(SELECT FROM gridex_ediel_retention.process_revocations WHERE decision_id=d.id) THEN RETURN NULL;END IF;
 bytes:=decode(d.issuer_receipt->>'payloadBase64','base64');IF encode(gridex_requested_changes.receipt_hmac_sha256_v1(bytes,issuer.signing_key),'hex') IS DISTINCT FROM d.issuer_receipt->>'signatureHex' THEN RETURN NULL;END IF;
 p:=convert_from(bytes,'UTF8')::jsonb;issued:=(p->>'issuedAt')::timestamptz;expires:=(p->>'expiresAt')::timestamptz;deadline:=(p->>'retainUntil')::timestamptz;journal_end:=(p->>'journalRetainUntil')::timestamptz;
 SELECT x.operation INTO STRICT operation FROM gridex_ediel_retention.process_class_catalog x WHERE retention_class=d.retention_class;
 IF p->>'format' IS DISTINCT FROM 'ediel_process_journal_retention_policy_v1' OR p->>'retentionClass' IS DISTINCT FROM d.retention_class OR p->>'targetId' IS DISTINCT FROM d.target_id OR p->>'companyId' IS DISTINCT FROM d.company_id::text
 OR p->>'sourceTable' IS DISTINCT FROM (SELECT source_table FROM gridex_ediel_retention.process_class_catalog WHERE retention_class=d.retention_class)
 OR p->>'sourceHash' IS DISTINCT FROM d.source_hash OR p->>'targetHash' IS DISTINCT FROM d.target_hash OR p->>'scopeHash' IS DISTINCT FROM d.scope_hash OR p->>'documentHash' IS DISTINCT FROM d.document_hash OR p->>'operation' IS DISTINCT FROM operation
 OR p->>'issuerLegalReference' IS DISTINCT FROM issuer.legal_reference OR nullif(p->>'legalBasisReference','') IS NULL OR nullif(p->>'journalPurposeReference','') IS NULL OR p->>'accessRevocationRequired' IS DISTINCT FROM 'true'
 OR issued IS NULL OR expires IS NULL OR deadline IS NULL OR journal_end IS NULL
 OR isfinite(issued) IS DISTINCT FROM true OR isfinite(expires) IS DISTINCT FROM true OR isfinite(deadline) IS DISTINCT FROM true OR isfinite(journal_end) IS DISTINCT FROM true OR journal_end<=db05_observed_at OR issued>db05_observed_at OR expires<=db05_observed_at OR issued<issuer.valid_from OR expires>issuer.valid_to THEN RETURN NULL;END IF;RETURN p;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR datetime_field_overflow OR character_not_in_repertoire THEN RETURN NULL;END$db05_body$;
 definition:=pg_get_functiondef(target);
 IF position(old_body IN definition)=0 OR (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'db05_unique_body_replacement_required: %',target;END IF;
 EXECUTE replace(definition,old_body,next_body);
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_meta FROM pg_proc p WHERE p.oid=target;
 IF after_meta IS DISTINCT FROM before_meta OR obj_description(target,'pg_proc') IS DISTINCT FROM before_comment OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM '5ec7cd776c2d8a1794a8f173a6f40f89' THEN RAISE EXCEPTION 'db05_function_metadata_preservation_required: %',target;END IF;

 target:='public.ediel_begin_customer_record_retention_v1(uuid,uuid,uuid)'::regprocedure;
 expected_md5:='9449aec8ea95863bd4135a88a3b6bef8';
 SELECT p.prosrc,to_jsonb(p)-'prosrc',obj_description(p.oid,'pg_proc') INTO STRICT old_body,before_meta,before_comment FROM pg_proc p WHERE p.oid=target;
 IF md5(old_body) IS DISTINCT FROM expected_md5 THEN RAISE EXCEPTION 'db05_public_composed_predecessor_mismatch: %',target;END IF;
 next_body:=$db05_body$
DECLARE d gridex_ediel_retention.record_decisions%rowtype;t gridex_ediel_retention.record_tombstones%rowtype;spec gridex_ediel_retention.record_class_catalog%rowtype;basis jsonb;claims jsonb;r uuid;customer public.customers%rowtype;at timestamptz:=clock_timestamp();assignments text;BEGIN
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');SELECT * INTO STRICT d FROM gridex_ediel_retention.record_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;
 IF gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_record_class_grant_required';END IF;
 SELECT * INTO t FROM gridex_ediel_retention.record_tombstones WHERE retention_class=d.retention_class AND target_id=d.target_id;
 IF FOUND THEN IF t.decision_id IS DISTINCT FROM d.id THEN RAISE EXCEPTION 'record_retention_tombstone_conflict';END IF;RETURN jsonb_build_object('status',CASE WHEN t.retention_class='contract_signed_pdf_bytes' AND NOT EXISTS(SELECT FROM gridex_ediel_retention.record_events WHERE retention_class=t.retention_class AND target_id=t.target_id AND kind='storage_object_absent') THEN 'storage_purge_pending' ELSE 'redacted' END,'retentionClass',t.retention_class,'targetId',t.target_id,'sourceHash',t.source_hash,'byteLength',t.byte_length,'storagePath',t.storage_path,'replay',true);END IF;
 -- Prevent a new issuer revocation from committing after the final receipt.
 LOCK TABLE gridex_ediel_retention.issuer_revocations IN SHARE MODE;
 r:=gridex_ediel_retention.record_current_review_v1(d);IF r IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_exact_class_legal_review_deadline']);END IF;
 LOCK TABLE public.customer_supply_periods,public.customer_portal_accounts,public.customer_portal_claims IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT customer FROM public.customers WHERE id=d.customer_id AND company_id=p_company_id FOR UPDATE;
 IF customer.status IS DISTINCT FROM 'archived' OR EXISTS(SELECT FROM public.customer_supply_periods WHERE company_id=p_company_id AND customer_id=d.customer_id AND status NOT IN('cancelled','rejected','terminated','ended','closed','inactive') AND (coalesce(actual_end_date,end_date) IS NULL OR coalesce(actual_end_date,end_date)>=current_date)) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['operative_customer_closed_and_no_active_supply']);END IF;
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=d.retention_class;
 -- Complete target row waits before binding hashes and any effect. The
 -- catalog chooses the actual source table; the decision supplies UUID scope.
 EXECUTE format('SELECT id FROM public.%I WHERE id=$1 AND company_id=$2 ORDER BY id FOR UPDATE',spec.source_table) USING d.target_id,p_company_id;
 PERFORM id FROM public.customer_portal_accounts WHERE company_id=p_company_id AND customer_id=d.customer_id ORDER BY id FOR UPDATE;
 PERFORM id FROM public.customer_portal_claims WHERE company_id=p_company_id AND customer_id=d.customer_id ORDER BY id FOR UPDATE;
 basis:=gridex_ediel_retention.record_basis_v1(p_company_id,d.retention_class,d.target_id);IF basis->>'targetHash' IS DISTINCT FROM d.target_hash OR basis->>'sourceHash' IS DISTINCT FROM d.source_hash THEN RETURN jsonb_build_object('status','held','missing',ARRAY['exact_native_record_target_changed']);END IF;
 IF d.retention_class='customer_address_history' AND EXISTS(SELECT FROM public.customer_addresses WHERE id=d.target_id AND (is_active OR moved_out_at IS NULL OR moved_out_at>=current_date)) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['inactive_historical_address_required']);END IF;
 -- All actual table/customer/basis waits above are finished. The original
 -- actor/reviewer bridges hold auth/profile/membership and RBAC protections;
 -- the decision FOR UPDATE and issuer-revocation table lock prevent phantoms.
 PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 IF gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'retention_current_record_class_grant_required' USING ERRCODE='42501';END IF;
 r:=gridex_ediel_retention.record_current_review_v1(d);
 claims:=gridex_ediel_retention.record_receipt_v1(d);
 at:=clock_timestamp();
 IF r IS NULL OR claims IS NULL
 OR (claims->>'issuedAt')::timestamptz>at OR (claims->>'expiresAt')::timestamptz<=at
 OR (claims->>'retainUntil')::timestamptz>at OR (claims->>'journalRetainUntil')::timestamptz<=at
 OR NOT EXISTS(SELECT FROM gridex_ediel_retention.issuers i WHERE i.id=(d.issuer_receipt->>'issuerId')::uuid AND i.company_id=p_company_id AND i.valid_from<=at AND at<i.valid_to)
 OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=(d.issuer_receipt->>'issuerId')::uuid)
 OR EXISTS(SELECT FROM gridex_ediel_retention.record_revocations WHERE decision_id=d.id)
 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['post_last_wait_current_authority_and_legal_deadline']);END IF;
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
END$db05_body$;
 definition:=pg_get_functiondef(target);
 IF position(old_body IN definition)=0 OR (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'db05_unique_body_replacement_required: %',target;END IF;
 EXECUTE replace(definition,old_body,next_body);
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_meta FROM pg_proc p WHERE p.oid=target;
 IF after_meta IS DISTINCT FROM before_meta OR obj_description(target,'pg_proc') IS DISTINCT FROM before_comment OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM '8bc1371eaf2d64c626e3e4d8512716ea' THEN RAISE EXCEPTION 'db05_function_metadata_preservation_required: %',target;END IF;

 target:='public.ediel_purge_process_journal_retention_v1(uuid,uuid,uuid)'::regprocedure;
 expected_md5:='6a307b544abcb1685f2931f1a8392259';
 SELECT p.prosrc,to_jsonb(p)-'prosrc',obj_description(p.oid,'pg_proc') INTO STRICT old_body,before_meta,before_comment FROM pg_proc p WHERE p.oid=target;
 IF md5(old_body) IS DISTINCT FROM expected_md5 THEN RAISE EXCEPTION 'db05_public_composed_predecessor_mismatch: %',target;END IF;
 next_body:=$db05_body$DECLARE d gridex_ediel_retention.process_decisions%rowtype;t gridex_ediel_retention.process_tombstones%rowtype;p jsonb;basis jsonb;r gridex_ediel_retention.process_reviews%rowtype;spec gridex_ediel_retention.process_class_catalog%rowtype;at timestamptz:=clock_timestamp();BEGIN
 PERFORM gridex_ediel_retention.record_actor_v1(p_company_id,p_actor_user_id,'legal_acceptance_personal_snapshot','ediel.retention.purge');SELECT * INTO STRICT d FROM gridex_ediel_retention.process_decisions WHERE id=p_decision_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO t FROM gridex_ediel_retention.process_tombstones WHERE retention_class=d.retention_class AND target_id=d.target_id;IF FOUND THEN IF t.decision_id IS DISTINCT FROM d.id OR t.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'process_retention_replay_conflict';END IF;RETURN jsonb_build_object('status','redacted','retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'byteLength',t.byte_length,'replay',true);END IF;
 -- Decision and actor locks retain their existing protections.
 LOCK TABLE gridex_ediel_retention.issuer_revocations IN SHARE MODE;
 SELECT * INTO r FROM gridex_ediel_retention.process_reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;IF r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id=d.submitted_by OR gridex_ediel_retention.record_permission_v1(p_company_id,r.actor_user_id,'legal_acceptance_personal_snapshot') IS NOT TRUE OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_separate_exact_class_review']);END IF;
 -- Re-lock the separate reviewer's actual auth/row/grant graph, not a cached UI.
 PERFORM gridex_ediel_retention.record_lock_review_actor_v1(p_company_id,r.actor_user_id);
 p:=gridex_ediel_retention.process_receipt_v1(d);IF p IS NULL OR (p->>'retainUntil')::timestamptz>at THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_exact_class_legal_deadline']);END IF;
 SELECT * INTO STRICT spec FROM gridex_ediel_retention.process_class_catalog WHERE retention_class=d.retention_class;
 -- Promote the exact native target before process_basis observes its
 -- body/scope hashes. Never upgrade a source SHARE lock after effects.
 IF d.retention_class='correction_process_fact_body' THEN
  IF d.target_id!~'^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'process_retention_fact_selector_required';END IF;
  PERFORM id FROM gridex_correction_process.facts WHERE id=d.target_id::bigint AND company_id=p_company_id ORDER BY id FOR UPDATE;
 ELSE
  IF d.target_id!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'process_retention_snapshot_selector_required';END IF;
  EXECUTE format('SELECT id FROM gridex_correction_process.%I WHERE id=$1 AND company_id=$2 ORDER BY id FOR UPDATE',spec.source_table) USING d.target_id::uuid,p_company_id;
 END IF;
 basis:=gridex_ediel_retention.process_basis_v1(p_company_id,d.retention_class,d.target_id);IF basis->>'sourceHash' IS DISTINCT FROM d.source_hash OR basis->>'targetHash' IS DISTINCT FROM d.target_hash OR basis->>'scopeHash' IS DISTINCT FROM d.scope_hash OR basis->>'allIncludedScopesClosed' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unchanged_source_and_all_included_scopes_closed']);END IF;
 LOCK TABLE public.customer_portal_accounts,public.customer_portal_claims IN SHARE ROW EXCLUSIVE MODE;
 -- The protected portal ranges include only the basis-qualified customers.
 -- Lock each actual account/claim row deterministically before qualification.
 PERFORM id FROM public.customer_portal_accounts WHERE company_id=p_company_id AND customer_id IN(SELECT value::uuid FROM jsonb_array_elements_text(basis->'includedCustomers')) ORDER BY id FOR UPDATE;
 PERFORM id FROM public.customer_portal_claims WHERE company_id=p_company_id AND customer_id IN(SELECT value::uuid FROM jsonb_array_elements_text(basis->'includedCustomers')) ORDER BY id FOR UPDATE;
 -- No body/scope/portal wait follows this final authority and legal boundary.
 PERFORM gridex_ediel_retention.record_actor_v1(p_company_id,p_actor_user_id,'legal_acceptance_personal_snapshot','ediel.retention.purge');
 SELECT * INTO r FROM gridex_ediel_retention.process_reviews WHERE decision_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE;
 PERFORM gridex_ediel_retention.record_lock_review_actor_v1(p_company_id,r.actor_user_id);
 IF r.id IS NULL OR r.outcome IS DISTINCT FROM 'approved' OR r.actor_user_id IS NOT DISTINCT FROM d.submitted_by
 OR gridex_ediel_retention.record_permission_v1(p_company_id,r.actor_user_id,'legal_acceptance_personal_snapshot') IS NOT TRUE
 OR gridex_ediel_retention.permission_v1(p_company_id,r.actor_user_id,'ediel.retention.review') IS NOT TRUE
 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['post_last_wait_current_separate_exact_class_review']);END IF;
 p:=gridex_ediel_retention.process_receipt_v1(d);
 at:=clock_timestamp();
 IF p IS NULL OR (p->>'issuedAt')::timestamptz>at OR (p->>'expiresAt')::timestamptz<=at
 OR (p->>'retainUntil')::timestamptz>at OR (p->>'journalRetainUntil')::timestamptz<=at
 OR NOT EXISTS(SELECT FROM gridex_ediel_retention.issuers i WHERE i.id=(d.issuer_receipt->>'issuerId')::uuid AND i.company_id=p_company_id AND i.valid_from<=at AND at<i.valid_to)
 OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=(d.issuer_receipt->>'issuerId')::uuid)
 OR EXISTS(SELECT FROM gridex_ediel_retention.process_revocations WHERE decision_id=d.id)
 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['post_last_wait_current_authority_and_legal_deadline']);END IF;
 UPDATE public.customer_portal_accounts SET status='revoked',is_active=false,updated_at=at WHERE company_id=p_company_id AND customer_id IN(SELECT value::uuid FROM jsonb_array_elements_text(basis->'includedCustomers'));UPDATE public.customer_portal_claims SET status='revoked',updated_at=at WHERE company_id=p_company_id AND customer_id IN(SELECT value::uuid FROM jsonb_array_elements_text(basis->'includedCustomers'));
 INSERT INTO gridex_ediel_retention.process_tombstones(retention_class,target_id,company_id,decision_id,review_id,source_hash,target_hash,scope_hash,byte_length,actor_user_id,journal_retain_until,journal_purpose_reference,created_at) VALUES(d.retention_class,d.target_id,p_company_id,d.id,r.id,d.source_hash,d.target_hash,d.scope_hash,(basis->>'byteLength')::bigint,p_actor_user_id,(p->>'journalRetainUntil')::timestamptz,p->>'journalPurposeReference',at);
 IF d.retention_class='correction_process_fact_body' THEN UPDATE gridex_correction_process.facts f SET old_fact=NULL,new_fact=jsonb_build_object('retentionUnavailable',true,'sourceHash',d.source_hash,'complete',false,'authority','none') WHERE id=d.target_id::bigint AND company_id=p_company_id;
 ELSE EXECUTE format('UPDATE gridex_correction_process.%I SET readset_text=$1 WHERE id=$2 AND company_id=$3',spec.source_table) USING jsonb_build_object('retentionUnavailable',true,'sourceHash',d.source_hash,'complete',false,'authority','none')::text,d.target_id::uuid,p_company_id;END IF;
 INSERT INTO gridex_ediel_retention.process_events(retention_class,target_id,actor_user_id) VALUES(d.retention_class,d.target_id,p_actor_user_id);INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,p_company_id,'process_journal_retention',d.id,'ediel.retention.process_redacted',jsonb_build_object('retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'scopeHash',d.scope_hash,'journalRetainUntil',p->>'journalRetainUntil','journalPurposeReference',p->>'journalPurposeReference','complete',false,'authority','none'));
 RETURN jsonb_build_object('status','redacted','retentionClass',d.retention_class,'targetId',d.target_id,'sourceHash',d.source_hash,'byteLength',(basis->>'byteLength')::bigint,'replay',false);END$db05_body$;
 definition:=pg_get_functiondef(target);
 IF position(old_body IN definition)=0 OR (length(definition)-length(replace(definition,old_body,'')))/length(old_body)<>1 THEN RAISE EXCEPTION 'db05_unique_body_replacement_required: %',target;END IF;
 EXECUTE replace(definition,old_body,next_body);
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_meta FROM pg_proc p WHERE p.oid=target;
 IF after_meta IS DISTINCT FROM before_meta OR obj_description(target,'pg_proc') IS DISTINCT FROM before_comment OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'c4efe5d58ebef49db630d9ccd58b8f69' THEN RAISE EXCEPTION 'db05_function_metadata_preservation_required: %',target;END IF;

END
$db05_patch$;
