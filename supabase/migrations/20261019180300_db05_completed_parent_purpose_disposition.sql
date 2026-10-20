BEGIN;
-- DB05_INSTALL_OWNER_SCOPE_BEGIN
-- Same guarded atomic install capability as existing OPS part03/part11.
-- No role/owner/application capability persists outside this transaction.
DO $db05_install_preflight$
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolinherit AND rolcreaterole AND rolbypassrls)
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner' AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls)
 OR (SELECT nspowner FROM pg_namespace WHERE nspname='gridex_ediel_retention') IS DISTINCT FROM 'gridex_ediel_retention_owner'::regrole::oid
 OR EXISTS(SELECT FROM pg_auth_members WHERE roleid='gridex_ediel_retention_owner'::regrole AND member<>'postgres'::regrole)
 OR (SELECT jsonb_agg(jsonb_build_array(g.rolname,m.admin_option,m.inherit_option,m.set_option) ORDER BY g.rolname COLLATE "C") FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor WHERE m.roleid='gridex_ediel_retention_owner'::regrole AND m.member='postgres'::regrole)
 IS DISTINCT FROM '[["postgres",false,false,true],["supabase_admin",true,false,false]]'::jsonb
 OR pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') IS DISTINCT FROM false
 OR pg_has_role('postgres','gridex_ediel_retention_owner','SET') IS DISTINCT FROM true
 OR pg_has_role('postgres','gridex_ediel_retention_owner','MEMBER') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'db05_qualified_non_super_migration_owner_profile_required' USING ERRCODE='42501';END IF;
 IF to_regclass('pg_temp.gridex_db05_install_scope') IS NOT NULL THEN RAISE EXCEPTION 'db05_unexpected_existing_install_scope';END IF;
END $db05_install_preflight$;
CREATE TEMPORARY TABLE gridex_db05_install_scope ON COMMIT DROP AS
 SELECT (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m) AS memberships,
 (SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r) AS roles,
 (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','gridex_ediel_retention')) AS namespaces,
 has_schema_privilege('gridex_ediel_retention_owner','public','CREATE') AS owner_public_create;
GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;
DO $db05_install_capability$ BEGIN
 IF NOT pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') THEN RAISE EXCEPTION 'db05_atomic_owner_inheritance_unavailable';END IF;
 IF NOT has_schema_privilege('gridex_ediel_retention_owner','public','CREATE') THEN GRANT CREATE ON SCHEMA public TO gridex_ediel_retention_owner;END IF;
END $db05_install_capability$;
-- DB05_INSTALL_OWNER_SCOPE_END

-- DB-05/AT-DB-05: atomically install bounded source-parent/purpose owners.
-- Synthetic component qualification does not supply actual issuer/legal facts.
DO $new_scope$ BEGIN
 IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname=ANY(ARRAY['gridex_ediel_retention.completed_parent_receipt_v1', 'gridex_ediel_retention.completed_parent_actor_v1', 'gridex_ediel_retention.completed_parent_graph_v1', 'gridex_ediel_retention.completed_parent_references_v1', 'public.ediel_review_completed_parent_v1', 'gridex_ediel_retention.completed_parent_execute_v1', 'public.ediel_dispose_completed_parent_v1', 'public.ediel_advance_completed_parent_v1', 'public.ediel_gc_completed_parent_v1', 'gridex_ediel_retention.completed_parent_purpose_guard_v1', 'gridex_ediel_retention.completed_parent_purpose_scope_v1', 'gridex_ediel_retention.completed_parent_purpose_receipt_v1', 'gridex_ediel_retention.completed_parent_purpose_terms_v1', 'gridex_ediel_retention.completed_parent_purpose_current_v1', 'gridex_ediel_retention.require_completed_parent_purpose_disclosure_v1', 'gridex_ediel_retention.completed_parent_purpose_closure_v1', 'gridex_ediel_retention.completed_parent_purpose_operation_v1', 'public.ediel_admit_completed_parent_purpose_v1', 'public.ediel_completed_parent_purpose_status_v1']::text[])) OR to_regclass('gridex_ediel_retention.completed_parent_approvals_v1') IS NOT NULL OR to_regclass('gridex_ediel_retention.completed_parent_purposes_v1') IS NOT NULL THEN RAISE EXCEPTION 'completed_parent_new_owned_scope_must_be_absent';END IF;
END $new_scope$;
DO $anchors$ DECLARE x jsonb;actual text;BEGIN
 FOR x IN SELECT value FROM jsonb_array_elements($bindings$[["gridex_ediel_retention.completed_witness_guard_v1()","b7e3b12566292f2a595c55cb250cb597dba3120b0891c927a2b5e75f2f99e125"],["gridex_ediel_retention.completed_witness_holds_v1(uuid)","7a1422ce995839794f3b9a8e36fe5a1afb6453082b9c3c1921272b03f4c44a61"],["gridex_ediel_retention.completed_witness_worker_actor_v1(uuid,uuid)","709525c37511e3e52cee15c9cd06f6a5c1f8b13e8431e5ce87bb770e16884a95"],["gridex_ediel_retention.completed_witness_approval_terms_v1(jsonb,timestamp with time zone)","4cc49a1c93e8976baa4ea75ea5ea3e0928a573813b7d651b0a4a0c8a42dc4cfe"],["gridex_ediel_retention.completed_witness_terms_v1(jsonb,text[],text,timestamp with time zone,timestamp with time zone,timestamp with time zone)","f5f38be101a5f9993c7ef473163de5ee6ec39ea7a9bb019b7172320a6f0fecfc"],["gridex_ediel_retention.decision_evidence_lock_v1(uuid)","ef3eed908c6accd29c05324f1e1267a1b1d9621d6a1e313807f455f1e9014e2f"],["gridex_ediel_retention.permission_v1(uuid,uuid,text)","6bedde3f4c01c504eae815ba0895b0872603dd2f6d8adace45669b640db689c7"]]$bindings$::jsonb) LOOP
 SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') INTO STRICT actual FROM pg_proc WHERE oid=(x->>0)::regprocedure;
 IF actual IS DISTINCT FROM x->>1 THEN RAISE EXCEPTION 'parent_exact_d61_owner_anchor_required';END IF;END LOOP;
END $anchors$;
CREATE FUNCTION gridex_ediel_retention.completed_parent_receipt_v1(c uuid,policy uuid,envelope jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE issuer gridex_ediel_retention.issuers%rowtype;p jsonb;bytes bytea;at timestamptz;BEGIN
 IF jsonb_typeof(envelope) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(envelope) k WHERE k NOT IN('issuerId','payloadBase64','signatureHex')) OR coalesce(envelope->>'signatureHex','')!~'^[a-f0-9]{64}$'
 OR length(coalesce(envelope->>'payloadBase64','')) NOT BETWEEN 1 AND 65536 THEN RAISE EXCEPTION 'phase_receipt_shape_required' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT issuer FROM gridex_ediel_retention.issuers WHERE id=(envelope->>'issuerId')::uuid AND company_id=c FOR SHARE;
 -- Actual retention_issuer_revocation_lock takes this SAME issuer FOR UPDATE
 -- before INSERT; an absent revocation is therefore not an unlocked phantom.
 bytes:=decode(envelope->>'payloadBase64','base64');
 IF encode(gridex_requested_changes.receipt_hmac_sha256_v1(bytes,issuer.signing_key),'hex') IS DISTINCT FROM envelope->>'signatureHex'
 OR encode(sha256(issuer.legal_evidence),'hex') IS DISTINCT FROM issuer.legal_hash
 OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=issuer.id)
 THEN RAISE EXCEPTION 'phase_current_issuer_signature_required' USING ERRCODE='42501';END IF;
 p:=convert_from(bytes,'UTF8')::jsonb;at:=clock_timestamp();
 IF p->>'format' IS DISTINCT FROM 'ediel_completed_source_parent_disposition_bundle_v1'
 OR p->>'replayScope' IS DISTINCT FROM 'no_parent_replay'
 OR p->>'companyId' IS DISTINCT FROM c::text OR p->>'policyId' IS DISTINCT FROM policy::text
 OR p->>'issuerLegalReference' IS DISTINCT FROM issuer.legal_reference
 OR p->>'executionMode' IS NULL OR p->>'executionMode' NOT IN('interactive','delegated_worker')
 OR EXISTS(SELECT FROM jsonb_object_keys(p) k WHERE k NOT IN('format','replayScope','companyId','policyId','sourceCommitment','customerScopeHash','issuerLegalReference','issuedAt','expiresAt','approvalUntil','executionMode','executionActorId','reviewerId','approvalFields','W','R','fields','replayFields','terminalFields'))
 OR isfinite((p->>'issuedAt')::timestamptz) IS DISTINCT FROM true
 OR isfinite((p->>'expiresAt')::timestamptz) IS DISTINCT FROM true
 OR isfinite((p->>'approvalUntil')::timestamptz) IS DISTINCT FROM true
 OR at<issuer.valid_from OR at>=issuer.valid_to OR (p->>'issuedAt')::timestamptz>at
 OR (p->>'issuedAt')::timestamptz<issuer.valid_from OR (p->>'expiresAt')::timestamptz>issuer.valid_to
 OR (p->>'expiresAt')::timestamptz<=at OR (p->>'approvalUntil')::timestamptz> (p->>'expiresAt')::timestamptz
 OR (p->>'approvalUntil')::timestamptz<=at
 THEN RAISE EXCEPTION 'phase_current_domain_and_time_required' USING ERRCODE='42501';END IF;
 RETURN p;
END$$;

-- Bounded component; substantive live policy requires independent qualified admission.
-- Actual current auth/HMAC/issuer/holds/per-field/immutable owners come from d61.
CREATE TABLE gridex_ediel_retention.completed_parent_approvals_v1 (
 company_id uuid NOT NULL,policy_id uuid NOT NULL,source_commitment text NOT NULL,
 receipt jsonb NOT NULL,receipt_hash text NOT NULL,reviewer_user_id uuid NOT NULL,
 approved_at timestamptz NOT NULL,stage text NOT NULL CHECK(stage='dispose'),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),PRIMARY KEY(company_id,policy_id)
);

CREATE FUNCTION gridex_ediel_retention.completed_parent_actor_v1(c uuid,actor uuid,operation text,delegated boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF delegated THEN
  IF operation<>'ediel.retention.purge' THEN RAISE EXCEPTION 'parent_worker_operation_required' USING ERRCODE='42501';END IF;
  PERFORM gridex_ediel_retention.completed_witness_worker_actor_v1(c,actor);
  IF gridex_ediel_retention.permission_v1(c,actor,'ediel.retention.blob_decision_evidence') IS NOT TRUE THEN RAISE EXCEPTION 'parent_current_worker_blob_class_required' USING ERRCODE='42501';END IF;RETURN;
 END IF;
 PERFORM gridex_ediel_retention.decision_evidence_actor_v1(c,actor,'completed_decision_review_reason',operation);
 PERFORM gridex_ediel_retention.decision_evidence_actor_v1(c,actor,'blob_retention_decision_original_bytes',operation);
END$$;

CREATE FUNCTION gridex_ediel_retention.completed_parent_graph_v1(c uuid,policy uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d gridex_ediel_retention.decision_evidence_policies%rowtype;q gridex_ediel_retention.decision_evidence_reviews%rowtype;t gridex_ediel_retention.decision_evidence_tombstones%rowtype;b gridex_ediel_retention.blob_decisions%rowtype;m public.ediel_messages%rowtype;payload public.ediel_message_payloads%rowtype;v jsonb;terms text[];BEGIN
 IF NOT EXISTS(SELECT FROM gridex_ediel_retention.decision_evidence_catalog WHERE retention_class='blob_retention_decision_original_bytes' AND source_table='blob_decisions' AND permission_key='ediel.retention.blob_decision_evidence' AND revocation_table='blob_revocations' AND revocation_id_column='decision_id' AND receipt_function='blob_receipt_v1') THEN RAISE EXCEPTION 'parent_actual_blob_catalog_required' USING ERRCODE='42501';END IF;
 LOCK TABLE gridex_ediel_retention.decision_evidence_policies,gridex_ediel_retention.decision_evidence_reviews,gridex_ediel_retention.decision_evidence_revocations,gridex_ediel_retention.decision_evidence_tombstones IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO STRICT d FROM gridex_ediel_retention.decision_evidence_policies WHERE id=policy AND company_id=c FOR UPDATE;
 IF d.retention_class<>'blob_retention_decision_original_bytes' OR (d.document_bytes IS NOT NULL AND encode(sha256(d.document_bytes),'hex') IS DISTINCT FROM d.document_hash) THEN RAISE EXCEPTION 'parent_exact_blob_policy_required' USING ERRCODE='42501';END IF;
 IF (SELECT count(*) FROM gridex_ediel_retention.decision_evidence_reviews WHERE policy_id=policy)<>1 OR (SELECT count(*) FROM gridex_ediel_retention.decision_evidence_tombstones WHERE policy_id=policy)<>1 THEN RAISE EXCEPTION 'parent_exact_one_review_completion_required' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT q FROM gridex_ediel_retention.decision_evidence_reviews WHERE policy_id=policy FOR UPDATE;
 SELECT * INTO STRICT t FROM gridex_ediel_retention.decision_evidence_tombstones WHERE policy_id=policy FOR UPDATE;
 IF q.reason<>'' OR q.outcome<>'approved' OR q.actor_user_id=d.submitted_by OR t.company_id<>c OR t.retention_class<>d.retention_class OR t.target_id<>d.target_id OR t.review_id<>q.id OR t.source_hash<>d.source_hash OR t.target_metadata_hash<>d.target_metadata_hash OR NOT isfinite(t.journal_retain_until) THEN RAISE EXCEPTION 'parent_actual_zero_and_completion_scope_required' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT b FROM gridex_ediel_retention.blob_decisions WHERE id=d.target_id AND company_id=c FOR SHARE;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=b.message_id AND company_id=c FOR SHARE;
 IF b.retention_class='received_ediel_message_content' THEN
  IF b.target_id<>m.id THEN RAISE EXCEPTION 'parent_message_route_required' USING ERRCODE='42501';END IF;
 ELSIF b.retention_class='transport_raw_mime_bytes' THEN
  SELECT * INTO STRICT payload FROM public.ediel_message_payloads WHERE id=b.target_id AND company_id=c FOR SHARE;
  IF payload.ediel_message_id IS DISTINCT FROM m.id THEN RAISE EXCEPTION 'parent_payload_route_required' USING ERRCODE='42501';END IF;
 ELSE RAISE EXCEPTION 'parent_blob_class_required' USING ERRCODE='42501';END IF;
 IF m.customer_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.customers WHERE id=m.customer_id AND company_id=c) THEN RAISE EXCEPTION 'parent_foreign_customer_route_required' USING ERRCODE='42501';END IF;
 -- A route projection alone is insufficient for deleting its original-byte witness.
 IF b.document_bytes IS NOT NULL OR b.document_hash IS DISTINCT FROM t.source_hash OR b.document_byte_length IS DISTINCT FROM t.byte_length OR b.document_purged_at IS DISTINCT FROM t.created_at OR encode(sha256(convert_to((to_jsonb(b)-ARRAY['document_bytes','document_byte_length','document_purged_at'])::text,'UTF8')),'hex') IS DISTINCT FROM t.target_metadata_hash OR NOT EXISTS(SELECT FROM gridex_ediel_retention.blob_revocations WHERE decision_id=b.id) THEN RAISE EXCEPTION 'parent_actual_prior_bytes_effect_required' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('policy',to_jsonb(d),'review',to_jsonb(q),'completion',to_jsonb(t),'revocation',(SELECT to_jsonb(x) FROM gridex_ediel_retention.decision_evidence_revocations x WHERE policy_id=policy),'blob',to_jsonb(b),'blobRevocation',(SELECT to_jsonb(x) FROM gridex_ediel_retention.blob_revocations x WHERE decision_id=b.id),'message',to_jsonb(m),'payload',to_jsonb(payload)) INTO v;
 SELECT array_agg(field ORDER BY field) INTO terms FROM (
  SELECT 'parent_policy.'||jsonb_object_keys(to_jsonb(d)) field
  UNION ALL SELECT 'parent_review.'||jsonb_object_keys(to_jsonb(q))
  UNION ALL SELECT 'parent_completion.'||jsonb_object_keys(to_jsonb(t))
  UNION ALL SELECT 'parent_revocation.'||jsonb_object_keys(to_jsonb(x)) FROM gridex_ediel_retention.decision_evidence_revocations x WHERE policy_id=policy
 ) f;
 RETURN jsonb_build_object('commitment',encode(sha256(convert_to(v::text,'UTF8')),'hex'),'fields',terms,'minimum',t.journal_retain_until,'reviewId',q.id,'submittedBy',d.submitted_by);
END$$;

CREATE FUNCTION gridex_ediel_retention.completed_parent_references_v1(c uuid,policy uuid,review_id uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE f record;col text;keycol text;ids uuid[];found_ref boolean;BEGIN
 FOR f IN SELECT DISTINCT conrelid FROM pg_constraint WHERE contype='f' AND confrelid=ANY(ARRAY['gridex_ediel_retention.decision_evidence_policies'::regclass,'gridex_ediel_retention.decision_evidence_reviews'::regclass,'gridex_ediel_retention.decision_evidence_revocations'::regclass,'gridex_ediel_retention.decision_evidence_tombstones'::regclass]) ORDER BY conrelid LOOP
  EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE NOWAIT',f.conrelid::regclass);
 END LOOP;
 FOR f IN SELECT * FROM pg_constraint WHERE contype='f' AND confrelid=ANY(ARRAY['gridex_ediel_retention.decision_evidence_policies'::regclass,'gridex_ediel_retention.decision_evidence_reviews'::regclass,'gridex_ediel_retention.decision_evidence_revocations'::regclass,'gridex_ediel_retention.decision_evidence_tombstones'::regclass]) ORDER BY conrelid,oid LOOP
  IF cardinality(f.conkey)<>1 OR cardinality(f.confkey)<>1 THEN RAISE EXCEPTION 'parent_unsupported_incoming_reference' USING ERRCODE='42501';END IF;
  SELECT attname INTO STRICT col FROM pg_attribute WHERE attrelid=f.conrelid AND attnum=f.conkey[1];SELECT attname INTO STRICT keycol FROM pg_attribute WHERE attrelid=f.confrelid AND attnum=f.confkey[1];
  IF f.confrelid='gridex_ediel_retention.decision_evidence_reviews'::regclass AND keycol='id' THEN ids:=ARRAY[review_id];
  ELSIF keycol IN('id','policy_id') THEN ids:=ARRAY[policy];ELSE RAISE EXCEPTION 'parent_unsupported_incoming_reference' USING ERRCODE='42501';END IF;
  IF f.conrelid='gridex_ediel_retention.decision_evidence_reviews'::regclass AND col='policy_id' AND f.confrelid='gridex_ediel_retention.decision_evidence_policies'::regclass THEN CONTINUE;END IF;
  IF f.conrelid='gridex_ediel_retention.decision_evidence_revocations'::regclass AND col='policy_id' AND f.confrelid='gridex_ediel_retention.decision_evidence_policies'::regclass THEN CONTINUE;END IF;
  IF f.conrelid='gridex_ediel_retention.decision_evidence_tombstones'::regclass AND col IN('policy_id','review_id') THEN
   EXECUTE format('SELECT EXISTS(SELECT FROM gridex_ediel_retention.decision_evidence_tombstones WHERE %I=ANY($1) AND NOT(policy_id=$2 AND review_id=$3 AND company_id=$4))',col) INTO found_ref USING ids,policy,review_id,c;
  ELSE EXECUTE format('SELECT EXISTS(SELECT FROM %s WHERE %I=ANY($1))',f.conrelid::regclass,col) INTO found_ref USING ids;END IF;
  IF found_ref THEN RAISE EXCEPTION 'parent_incoming_consumer_required' USING ERRCODE='42501';END IF;
 END LOOP;
 IF EXISTS(SELECT FROM gridex_ediel_retention.decision_evidence_policies WHERE id<>policy AND target_id=ANY(ARRAY[policy,review_id])) THEN RAISE EXCEPTION 'parent_opaque_policy_consumer_required' USING ERRCODE='42501';END IF;
END$$;

CREATE FUNCTION public.ediel_review_completed_parent_v1(p_company_id uuid,p_actor_user_id uuid,p_policy_id uuid,p_receipt jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p jsonb;g jsonb;holds text;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_ediel_retention.decision_evidence_lock_v1(p_company_id);
 PERFORM gridex_ediel_retention.completed_parent_actor_v1(p_company_id,p_actor_user_id,'ediel.retention.review');
 holds:=gridex_ediel_retention.completed_witness_holds_v1(p_company_id);g:=gridex_ediel_retention.completed_parent_graph_v1(p_company_id,p_policy_id);
 PERFORM gridex_ediel_retention.completed_parent_references_v1(p_company_id,p_policy_id,(g->>'reviewId')::uuid);
 p:=gridex_ediel_retention.completed_parent_receipt_v1(p_company_id,p_policy_id,p_receipt);
 IF p->>'reviewerId' IS DISTINCT FROM p_actor_user_id::text OR p->>'executionActorId' IS NULL OR p->>'executionActorId'=p_actor_user_id::text OR p->>'executionMode' NOT IN('interactive','delegated_worker') OR p->>'sourceCommitment' IS DISTINCT FROM g->>'commitment' OR p->>'customerScopeHash' IS DISTINCT FROM holds OR p->>'W' IS NULL OR p->>'R' IS DISTINCT FROM p->>'W' OR (p->>'W')::timestamptz<(g->>'minimum')::timestamptz OR p->'replayFields' IS DISTINCT FROM '[]'::jsonb OR p->'terminalFields' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'parent_exact_separate_finite_scope_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_retention.completed_witness_approval_terms_v1(p,clock_timestamp());
 -- Admission can precede the effect, but fieldshape/purpose/time must already qualify.
 PERFORM gridex_ediel_retention.completed_witness_terms_v1(jsonb_build_object('executeBefore',p->>'approvalUntil','fields',p->'fields','replayFields','[]'::jsonb),ARRAY(SELECT jsonb_array_elements_text(g->'fields')),'dispose',(p->>'W')::timestamptz,(p->>'W')::timestamptz,clock_timestamp());
 PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(p_company_id,p_actor_user_id,'blob_retention_decision_original_bytes');PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(p_company_id,p_actor_user_id,'completed_decision_review_reason');
 p:=gridex_ediel_retention.completed_parent_receipt_v1(p_company_id,p_policy_id,p_receipt);
 INSERT INTO gridex_ediel_retention.completed_parent_approvals_v1 VALUES(p_company_id,p_policy_id,g->>'commitment',p_receipt,encode(sha256(convert_to(p_receipt::text,'UTF8')),'hex'),p_actor_user_id,clock_timestamp(),'dispose',(p->>'approvalUntil')::timestamptz);
 RETURN jsonb_build_object('status','approved','authority','none');
END$$;

CREATE FUNCTION gridex_ediel_retention.completed_parent_execute_v1(p_company_id uuid,p_actor_user_id uuid,p_policy_id uuid,delegated boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a gridex_ediel_retention.completed_parent_approvals_v1%rowtype;p jsonb;g jsonb;holds text;tab text;at timestamptz;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_ediel_retention.decision_evidence_lock_v1(p_company_id);
 PERFORM gridex_ediel_retention.completed_parent_actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge',delegated);
 SELECT * INTO a FROM gridex_ediel_retention.completed_parent_approvals_v1 WHERE company_id=p_company_id AND policy_id=p_policy_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable','authority','none');END IF;
 IF encode(sha256(convert_to(a.receipt::text,'UTF8')),'hex') IS DISTINCT FROM a.receipt_hash THEN RAISE EXCEPTION 'parent_approval_integrity_required' USING ERRCODE='42501';END IF;
 holds:=gridex_ediel_retention.completed_witness_holds_v1(p_company_id);g:=gridex_ediel_retention.completed_parent_graph_v1(p_company_id,p_policy_id);
 PERFORM gridex_ediel_retention.completed_parent_references_v1(p_company_id,p_policy_id,(g->>'reviewId')::uuid);
 p:=gridex_ediel_retention.completed_parent_receipt_v1(p_company_id,p_policy_id,a.receipt);
 IF p->>'executionActorId' IS DISTINCT FROM p_actor_user_id::text OR p->>'reviewerId' IS DISTINCT FROM a.reviewer_user_id::text OR a.reviewer_user_id=p_actor_user_id OR p->>'sourceCommitment' IS DISTINCT FROM g->>'commitment' OR a.source_commitment IS DISTINCT FROM g->>'commitment' OR p->>'customerScopeHash' IS DISTINCT FROM holds OR p->>'R' IS DISTINCT FROM p->>'W' OR (p->>'W')::timestamptz<(g->>'minimum')::timestamptz OR p->>'executionMode' IS DISTINCT FROM (CASE WHEN delegated THEN 'delegated_worker' ELSE 'interactive' END) THEN RAISE EXCEPTION 'parent_current_exact_scope_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(p_company_id,a.reviewer_user_id,'blob_retention_decision_original_bytes');PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(p_company_id,a.reviewer_user_id,'completed_decision_review_reason');
 PERFORM gridex_ediel_retention.completed_parent_actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge',delegated);
 p:=gridex_ediel_retention.completed_parent_receipt_v1(p_company_id,p_policy_id,a.receipt);PERFORM gridex_ediel_retention.completed_witness_holds_v1(p_company_id);at:=clock_timestamp();
 IF at>=a.expires_at THEN RAISE EXCEPTION 'parent_approval_expired' USING ERRCODE='42501';END IF;
 IF at<(p->>'W')::timestamptz THEN RETURN jsonb_build_object('status','held','authority','none');END IF;
 PERFORM gridex_ediel_retention.completed_witness_terms_v1(jsonb_build_object('executeBefore',a.expires_at,'fields',p->'fields','replayFields','[]'::jsonb),ARRAY(SELECT jsonb_array_elements_text(g->'fields')),'dispose',(p->>'W')::timestamptz,(p->>'W')::timestamptz,at);
 FOREACH tab IN ARRAY ARRAY['decision_evidence_tombstones','decision_evidence_reviews','decision_evidence_revocations','decision_evidence_policies'] LOOP
  IF tab='decision_evidence_policies' THEN
   INSERT INTO gridex_ediel_retention.completed_witness_phase_permits_v1 SELECT pg_backend_pid(),txid_current(),tab,encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex'),'DELETE',NULL FROM gridex_ediel_retention.decision_evidence_policies x WHERE id=p_policy_id AND company_id=p_company_id;
   DELETE FROM gridex_ediel_retention.decision_evidence_policies WHERE id=p_policy_id AND company_id=p_company_id;
  ELSE
   EXECUTE format('INSERT INTO gridex_ediel_retention.completed_witness_phase_permits_v1 SELECT pg_backend_pid(),txid_current(),$1,encode(sha256(convert_to(to_jsonb(x)::text,''UTF8'')),''hex''),''DELETE'',NULL FROM gridex_ediel_retention.%I x WHERE policy_id=$2',tab) USING tab,p_policy_id;
   EXECUTE format('DELETE FROM gridex_ediel_retention.%I WHERE policy_id=$1',tab) USING p_policy_id;
  END IF;
 END LOOP;
 IF EXISTS(SELECT FROM gridex_ediel_retention.completed_witness_phase_permits_v1 WHERE backend=pg_backend_pid() AND xid=txid_current()) THEN RAISE EXCEPTION 'parent_unconsumed_permit';END IF;
 DELETE FROM gridex_ediel_retention.completed_parent_approvals_v1 WHERE company_id=p_company_id AND policy_id=p_policy_id;
 RETURN jsonb_build_object('status','disposed','replay',false,'authority','none');
END$$;

CREATE FUNCTION public.ediel_dispose_completed_parent_v1(p_company_id uuid,p_actor_user_id uuid,p_policy_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_ediel_retention.completed_parent_execute_v1(p_company_id,p_actor_user_id,p_policy_id,false)$$;

CREATE FUNCTION public.ediel_advance_completed_parent_v1(p_actor_user_id uuid,p_limit integer DEFAULT 20) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a record;p jsonb;result jsonb;n integer:=0;disposed integer:=0;cleared integer:=0;held integer:=0;BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'parent_worker_batch_limit_required';END IF;
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 FOR a IN SELECT x.* FROM gridex_ediel_retention.completed_parent_approvals_v1 x
 WHERE CASE WHEN x.expires_at<=clock_timestamp() THEN true ELSE
  convert_from(decode(x.receipt->>'payloadBase64','base64'),'UTF8')::jsonb->>'executionMode'='delegated_worker'
  AND convert_from(decode(x.receipt->>'payloadBase64','base64'),'UTF8')::jsonb->>'executionActorId'=p_actor_user_id::text
  AND (convert_from(decode(x.receipt->>'payloadBase64','base64'),'UTF8')::jsonb->>'W')::timestamptz<=clock_timestamp()
  AND NOT EXISTS(SELECT FROM public.customers c WHERE c.company_id=x.company_id AND c.legal_hold) END
 ORDER BY x.expires_at,x.company_id,x.policy_id LIMIT p_limit LOOP
  n:=n+1;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('gridex:retention:decision-original:'||a.company_id::text,0)) THEN held:=held+1;CONTINUE;END IF;
  PERFORM gridex_ediel_retention.decision_evidence_lock_v1(a.company_id);
  BEGIN
   PERFORM gridex_ediel_retention.completed_parent_actor_v1(a.company_id,p_actor_user_id,'ediel.retention.purge',true);
   IF a.expires_at<=clock_timestamp() THEN
    DELETE FROM gridex_ediel_retention.completed_parent_approvals_v1 WHERE company_id=a.company_id AND policy_id=a.policy_id AND expires_at<=clock_timestamp();cleared:=cleared+1;CONTINUE;
   END IF;
   result:=gridex_ediel_retention.completed_parent_execute_v1(a.company_id,p_actor_user_id,a.policy_id,true);
   IF result->>'status'='disposed' THEN disposed:=disposed+1;ELSE held:=held+1;END IF;
  EXCEPTION WHEN insufficient_privilege OR no_data_found OR lock_not_available THEN held:=held+1;END;
 END LOOP;
 RETURN jsonb_build_object('scanned',n,'disposed',disposed,'clearedApprovals',cleared,'held',held);
END$$;

-- Only finite operational metadata GC, independent of physical source holds.
CREATE FUNCTION public.ediel_gc_completed_parent_v1(p_company_id uuid,p_actor_user_id uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_ediel_retention.decision_evidence_lock_v1(p_company_id);PERFORM gridex_ediel_retention.completed_parent_actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');
 DELETE FROM gridex_ediel_retention.completed_parent_approvals_v1 WHERE company_id=p_company_id AND expires_at<=clock_timestamp();GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END$$;

DO $$DECLARE f text;BEGIN
 ALTER TABLE gridex_ediel_retention.completed_parent_approvals_v1 OWNER TO gridex_ediel_retention_owner;
 ALTER TABLE gridex_ediel_retention.completed_parent_approvals_v1 ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_ediel_retention.completed_parent_approvals_v1 FORCE ROW LEVEL SECURITY;
 REVOKE ALL ON gridex_ediel_retention.completed_parent_approvals_v1 FROM PUBLIC,anon,authenticated,service_role;
 FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_retention' AND p.proname LIKE 'completed_parent_%' OR n.nspname='public' AND p.proname IN('ediel_review_completed_parent_v1','ediel_dispose_completed_parent_v1','ediel_gc_completed_parent_v1','ediel_advance_completed_parent_v1') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO gridex_ediel_retention_owner',f);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);
 END LOOP;
END$$;
GRANT EXECUTE ON FUNCTION public.ediel_review_completed_parent_v1(uuid,uuid,uuid,jsonb),public.ediel_dispose_completed_parent_v1(uuid,uuid,uuid),public.ediel_gc_completed_parent_v1(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_advance_completed_parent_v1(uuid,integer) TO service_role;

-- One current purpose owner; code and synthetic tests do not supply live legal facts.
-- One current substantive P; finite operational A remains a separate existing9.
CREATE TABLE gridex_ediel_retention.completed_parent_purposes_v1(
 company_id uuid NOT NULL REFERENCES public.companies(id),
 policy_id uuid NOT NULL CONSTRAINT completed_parent_purpose_exact_policy_fk REFERENCES gridex_ediel_retention.decision_evidence_policies(id),
 version bigint NOT NULL CHECK(version>0),receipt jsonb NOT NULL,receipt_hash text NOT NULL,
 reviewer_user_id uuid NOT NULL REFERENCES auth.users(id),admitted_at timestamptz NOT NULL,
 ordinary_until timestamptz NOT NULL CHECK(isfinite(ordinary_until)),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at>ordinary_until),
 PRIMARY KEY(company_id,policy_id)
);
CREATE FUNCTION gridex_ediel_retention.completed_parent_purpose_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 DELETE FROM gridex_ediel_retention.completed_witness_phase_permits_v1 WHERE backend=pg_backend_pid() AND xid=txid_current() AND relation_name=TG_TABLE_NAME AND before_hash=encode(sha256(convert_to(to_jsonb(OLD)::text,'UTF8')),'hex') AND operation=TG_OP AND (TG_OP='DELETE' OR after_hash=encode(sha256(convert_to(to_jsonb(NEW)::text,'UTF8')),'hex'));
 IF FOUND THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 RAISE EXCEPTION 'purpose_admitted_source_is_guarded' USING ERRCODE='23514';
END$$;
CREATE TRIGGER completed_parent_purpose_immutable BEFORE UPDATE OR DELETE ON gridex_ediel_retention.completed_parent_purposes_v1 FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.completed_parent_purpose_guard_v1();

CREATE FUNCTION gridex_ediel_retention.completed_parent_purpose_scope_v1(c uuid,policy uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d gridex_ediel_retention.decision_evidence_policies%rowtype;q gridex_ediel_retention.decision_evidence_reviews%rowtype;t gridex_ediel_retention.decision_evidence_tombstones%rowtype;v jsonb;names text[];BEGIN
 SELECT * INTO STRICT d FROM gridex_ediel_retention.decision_evidence_policies WHERE id=policy AND company_id=c FOR SHARE;
 IF d.retention_class<>'blob_retention_decision_original_bytes' OR (SELECT count(*) FROM gridex_ediel_retention.decision_evidence_reviews WHERE policy_id=policy)<>1 OR (SELECT count(*) FROM gridex_ediel_retention.decision_evidence_tombstones WHERE policy_id=policy)<>1 THEN RAISE EXCEPTION 'purpose_current_family_integrity_required' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT q FROM gridex_ediel_retention.decision_evidence_reviews WHERE policy_id=policy FOR SHARE;
 SELECT * INTO STRICT t FROM gridex_ediel_retention.decision_evidence_tombstones WHERE policy_id=policy FOR SHARE;
 IF q.reason<>'' OR q.outcome<>'approved' OR t.company_id<>c OR t.review_id<>q.id OR t.retention_class<>d.retention_class OR t.target_id<>d.target_id THEN RAISE EXCEPTION 'purpose_current_family_integrity_required' USING ERRCODE='42501';END IF;
 v:=jsonb_build_object('policy',to_jsonb(d),'review',to_jsonb(q),'completion',to_jsonb(t),'revocation',(SELECT to_jsonb(x) FROM gridex_ediel_retention.decision_evidence_revocations x WHERE policy_id=policy));
 SELECT array_agg(field ORDER BY field) INTO names FROM(SELECT 'parent_policy.'||jsonb_object_keys(to_jsonb(d)) field UNION ALL SELECT 'parent_review.'||jsonb_object_keys(to_jsonb(q)) UNION ALL SELECT 'parent_completion.'||jsonb_object_keys(to_jsonb(t)) UNION ALL SELECT 'parent_revocation.'||jsonb_object_keys(to_jsonb(x)) FROM gridex_ediel_retention.decision_evidence_revocations x WHERE policy_id=policy)s;
 RETURN jsonb_build_object('familyCommitment',encode(sha256(convert_to(v::text,'UTF8')),'hex'),'fields',names,'minimum',t.journal_retain_until,'reviewId',q.id,'submittedBy',d.submitted_by);
END$$;

CREATE FUNCTION gridex_ediel_retention.completed_parent_purpose_receipt_v1(c uuid,policy uuid,envelope jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE issuer gridex_ediel_retention.issuers%rowtype;bytes bytea;p jsonb;at timestamptz;BEGIN
 IF jsonb_typeof(envelope) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(envelope) k WHERE k NOT IN('issuerId','payloadBase64','signatureHex')) OR coalesce(envelope->>'signatureHex','')!~'^[a-f0-9]{64}$' OR length(coalesce(envelope->>'payloadBase64','')) NOT BETWEEN 1 AND 65536 THEN RAISE EXCEPTION 'purpose_signed_envelope_required' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT issuer FROM gridex_ediel_retention.issuers WHERE id=(envelope->>'issuerId')::uuid AND company_id=c FOR SHARE;
 bytes:=decode(envelope->>'payloadBase64','base64');
 IF encode(gridex_requested_changes.receipt_hmac_sha256_v1(bytes,issuer.signing_key),'hex') IS DISTINCT FROM envelope->>'signatureHex' OR encode(sha256(issuer.legal_evidence),'hex') IS DISTINCT FROM issuer.legal_hash OR EXISTS(SELECT FROM gridex_ediel_retention.issuer_revocations WHERE issuer_id=issuer.id) THEN RAISE EXCEPTION 'purpose_current_qualified_signature_required' USING ERRCODE='42501';END IF;
 p:=convert_from(bytes,'UTF8')::jsonb;at:=clock_timestamp();
 IF p->>'format' IS DISTINCT FROM 'ediel_completed_source_parent_purpose_policy_v1' OR p->>'purpose' IS DISTINCT FROM 'ordinary_retention_evidence_use' OR p->>'scope' IS DISTINCT FROM 'ordinary_metadata_and_original_disclosure' OR p->>'holdTreatment' IS DISTINCT FROM 'preserve_under_hold_without_post_D_ordinary_disclosure' OR p->>'companyId' IS DISTINCT FROM c::text OR p->>'policyId' IS DISTINCT FROM policy::text OR p->>'issuerLegalReference' IS DISTINCT FROM issuer.legal_reference
 OR EXISTS(SELECT FROM jsonb_object_keys(p) k WHERE k NOT IN('format','purpose','scope','holdTreatment','companyId','policyId','version','predecessorHash','familyCommitment','issuerLegalReference','issuedAt','expiresAt','D','E','reviewerId','fields','policyFields'))
 OR (p->>'version')!~'^[1-9][0-9]{0,8}$' OR isfinite((p->>'issuedAt')::timestamptz) IS DISTINCT FROM true OR isfinite((p->>'expiresAt')::timestamptz) IS DISTINCT FROM true OR at<issuer.valid_from OR at>=issuer.valid_to OR (p->>'issuedAt')::timestamptz>at OR (p->>'issuedAt')::timestamptz<issuer.valid_from OR (p->>'expiresAt')::timestamptz>issuer.valid_to OR (p->>'expiresAt')::timestamptz<=at THEN RAISE EXCEPTION 'purpose_current_domain_scope_and_admission_window_required' USING ERRCODE='42501';END IF;
 RETURN p;
END$$;

CREATE FUNCTION gridex_ediel_retention.completed_parent_purpose_terms_v1(p jsonb,g jsonb,at timestamptz) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE f jsonb;actual text[];D timestamptz:=(p->>'D')::timestamptz;E timestamptz:=(p->>'E')::timestamptz;BEGIN
 IF isfinite(D) IS DISTINCT FROM true OR isfinite(E) IS DISTINCT FROM true OR E<=at OR E<=D OR D<(g->>'minimum')::timestamptz THEN RAISE EXCEPTION 'purpose_explicit_finite_D_E_and_original_floor_required' USING ERRCODE='42501';END IF;
 SELECT array_agg(value->>'field' ORDER BY value->>'field') INTO actual FROM jsonb_array_elements(p->'fields');
 IF actual IS DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(g->'fields')) THEN RAISE EXCEPTION 'purpose_exact_family_fieldset_required' USING ERRCODE='42501';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p->'fields') LOOP
  IF EXISTS(SELECT FROM jsonb_object_keys(f) k WHERE k NOT IN('field','purposeReference','basisReference','min','max','reviewBy','action','ordinaryUseEnds')) OR jsonb_typeof(f->'purposeReference') IS DISTINCT FROM 'string' OR jsonb_typeof(f->'basisReference') IS DISTINCT FROM 'string' OR nullif(btrim(f->>'purposeReference'),'') IS NULL OR nullif(btrim(f->>'basisReference'),'') IS NULL OR isfinite((f->>'min')::timestamptz) IS DISTINCT FROM true OR (f->>'min')::timestamptz>at OR (f->>'min')::timestamptz>D OR (f->>'max')::timestamptz IS DISTINCT FROM D OR (f->>'ordinaryUseEnds')::timestamptz IS DISTINCT FROM D OR isfinite((f->>'reviewBy')::timestamptz) IS DISTINCT FROM true OR (f->>'reviewBy')::timestamptz<=at OR f->>'action' IS DISTINCT FROM 'erase_with_qualified_current_approval' THEN RAISE EXCEPTION 'purpose_all_family_field_purpose_basis_min_D_review_action_required' USING ERRCODE='42501';END IF;
 END LOOP;
 SELECT array_agg(value->>'field' ORDER BY value->>'field') INTO actual FROM jsonb_array_elements(p->'policyFields');
 IF actual IS DISTINCT FROM ARRAY['purpose.admitted_at','purpose.company_id','purpose.expires_at','purpose.ordinary_until','purpose.policy_id','purpose.receipt','purpose.receipt_hash','purpose.reviewer_user_id','purpose.version']::text[] THEN RAISE EXCEPTION 'purpose_all_nine_own_fields_required' USING ERRCODE='42501';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p->'policyFields') LOOP
  IF EXISTS(SELECT FROM jsonb_object_keys(f) k WHERE k NOT IN('field','purposeReference','basisReference','min','max','reviewBy','action')) OR jsonb_typeof(f->'purposeReference') IS DISTINCT FROM 'string' OR jsonb_typeof(f->'basisReference') IS DISTINCT FROM 'string' OR nullif(btrim(f->>'purposeReference'),'') IS NULL OR nullif(btrim(f->>'basisReference'),'') IS NULL OR isfinite((f->>'min')::timestamptz) IS DISTINCT FROM true OR (f->>'min')::timestamptz>at OR (f->>'max')::timestamptz IS DISTINCT FROM E OR isfinite((f->>'reviewBy')::timestamptz) IS DISTINCT FROM true OR (f->>'reviewBy')::timestamptz<=at OR (f->>'reviewBy')::timestamptz>E OR f->>'action' IS DISTINCT FROM 'erase_with_source_or_qualified_successor_by_E' THEN RAISE EXCEPTION 'purpose_own_qualified_finite_E_terms_required' USING ERRCODE='42501';END IF;
 END LOOP;
END$$;

CREATE FUNCTION gridex_ediel_retention.completed_parent_purpose_current_v1(c uuid,policy uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE x gridex_ediel_retention.completed_parent_purposes_v1%rowtype;p jsonb;g jsonb;BEGIN
 SELECT * INTO x FROM gridex_ediel_retention.completed_parent_purposes_v1 WHERE company_id=c AND policy_id=policy FOR SHARE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 -- Accepted substantive admission survives old issuer/window/execution-grant expiry.
 -- Guarded row + admitted envelope hash and exact immutable Q generation are its
 -- historical attestation. Current read actor checks remain in the real callers.
 p:=convert_from(decode(x.receipt->>'payloadBase64','base64'),'UTF8')::jsonb;
 IF encode(sha256(convert_to(x.receipt::text,'UTF8')),'hex') IS DISTINCT FROM x.receipt_hash OR p->>'format' IS DISTINCT FROM 'ediel_completed_source_parent_purpose_policy_v1' OR p->>'purpose' IS DISTINCT FROM 'ordinary_retention_evidence_use' OR p->>'companyId' IS DISTINCT FROM c::text OR p->>'policyId' IS DISTINCT FROM policy::text OR (p->>'version')::bigint IS DISTINCT FROM x.version OR p->>'reviewerId' IS DISTINCT FROM x.reviewer_user_id::text OR (p->>'D')::timestamptz IS DISTINCT FROM x.ordinary_until OR (p->>'E')::timestamptz IS DISTINCT FROM x.expires_at THEN RAISE EXCEPTION 'purpose_historical_admission_integrity_required' USING ERRCODE='42501';END IF;
 g:=gridex_ediel_retention.completed_parent_purpose_scope_v1(c,policy);
 IF p->>'familyCommitment' IS DISTINCT FROM g->>'familyCommitment' OR ARRAY(SELECT value->>'field' FROM jsonb_array_elements(p->'fields') ORDER BY value->>'field') IS DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(g->'fields')) THEN RAISE EXCEPTION 'purpose_current_generation_drift_refused' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('payload',p,'receiptHash',x.receipt_hash,'version',x.version,'D',x.ordinary_until,'E',x.expires_at);
END$$;

CREATE FUNCTION gridex_ediel_retention.require_completed_parent_purpose_disclosure_v1(c uuid,policy uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p jsonb;at timestamptz;BEGIN
 p:=gridex_ediel_retention.completed_parent_purpose_current_v1(c,policy);IF p IS NULL THEN RETURN;END IF;at:=clock_timestamp();
 IF at>=(p->>'E')::timestamptz THEN RAISE EXCEPTION 'POLICY_OVERDUE: qualified purpose control storage requires resolution; ordinary use remains ended' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(p->'payload'->'policyFields') f WHERE (f->>'reviewBy')::timestamptz<=at) THEN RAISE EXCEPTION 'POLICY_REVIEW_OVERDUE: current qualified policy review required; no automatic renewal' USING ERRCODE='42501';END IF;
 IF at>=(p->>'D')::timestamptz THEN RAISE EXCEPTION 'purpose_ordinary_use_ended' USING ERRCODE='42501';END IF;
END$$;

CREATE FUNCTION gridex_ediel_retention.completed_parent_purpose_closure_v1(c uuid,policy uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE f record;col text;hit boolean;BEGIN
 FOR f IN SELECT DISTINCT conrelid FROM pg_constraint WHERE contype='f' AND confrelid='gridex_ediel_retention.completed_parent_purposes_v1'::regclass ORDER BY conrelid LOOP EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE NOWAIT',f.conrelid::regclass);END LOOP;
 FOR f IN SELECT * FROM pg_constraint WHERE contype='f' AND confrelid='gridex_ediel_retention.completed_parent_purposes_v1'::regclass ORDER BY conrelid,oid LOOP
  -- No owned P children exist in this component. Unknown/composite consumers
  -- are never swept or exempted, even if their caller uses the same Q id.
  IF cardinality(f.conkey)<>1 OR cardinality(f.confkey)<>1 THEN RAISE EXCEPTION 'purpose_unsupported_incoming_reference' USING ERRCODE='42501';END IF;
  SELECT attname INTO STRICT col FROM pg_attribute WHERE attrelid=f.conrelid AND attnum=f.conkey[1];
  RAISE EXCEPTION 'purpose_unowned_incoming_reference' USING ERRCODE='42501';
 END LOOP;
END$$;

CREATE FUNCTION gridex_ediel_retention.completed_parent_purpose_operation_v1(c uuid,policy uuid,a jsonb,cleanup boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p jsonb;at timestamptz;f jsonb;BEGIN
 PERFORM 1 FROM gridex_ediel_retention.completed_parent_purposes_v1 WHERE company_id=c AND policy_id=policy FOR UPDATE;
 p:=gridex_ediel_retention.completed_parent_purpose_current_v1(c,policy);
 IF p IS NULL THEN IF a->>'purposeVersion' IS NOT NULL OR a->>'purposeHash' IS NOT NULL THEN RAISE EXCEPTION 'purpose_referenced_current_admission_required' USING ERRCODE='42501';END IF;RETURN;END IF;
 IF a->>'purposeVersion' IS DISTINCT FROM p->>'version' OR a->>'purposeHash' IS DISTINCT FROM p->>'receiptHash' OR (a->>'W')::timestamptz IS DISTINCT FROM (p->>'D')::timestamptz THEN RAISE EXCEPTION 'purpose_current_version_bound_approval_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_retention.completed_parent_purpose_closure_v1(c,policy);
 IF cleanup THEN
  at:=clock_timestamp();IF at<(p->>'D')::timestamptz OR at>=(p->>'E')::timestamptz THEN RAISE EXCEPTION 'purpose_current_finite_cleanup_window_required' USING ERRCODE='42501';END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(p->'payload'->'fields') LOOP
   IF (f->>'min')::timestamptz>at OR (f->>'reviewBy')::timestamptz<=at THEN RAISE EXCEPTION 'purpose_source_current_min_review_required' USING ERRCODE='42501';END IF;
  END LOOP;
  FOR f IN SELECT value FROM jsonb_array_elements(p->'payload'->'policyFields') LOOP
   IF (f->>'min')::timestamptz>at OR (f->>'reviewBy')::timestamptz<=at THEN RAISE EXCEPTION 'purpose_own_current_min_review_required' USING ERRCODE='42501';END IF;
  END LOOP;
  INSERT INTO gridex_ediel_retention.completed_witness_phase_permits_v1 SELECT pg_backend_pid(),txid_current(),'completed_parent_purposes_v1',encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex'),'DELETE',NULL FROM gridex_ediel_retention.completed_parent_purposes_v1 x WHERE company_id=c AND policy_id=policy;
  DELETE FROM gridex_ediel_retention.completed_parent_purposes_v1 WHERE company_id=c AND policy_id=policy;
 END IF;
END$$;

CREATE FUNCTION public.ediel_admit_completed_parent_purpose_v1(p_company_id uuid,p_actor_user_id uuid,p_policy_id uuid,p_receipt jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p jsonb;g jsonb;prior gridex_ediel_retention.completed_parent_purposes_v1%rowtype;fresh gridex_ediel_retention.completed_parent_purposes_v1%rowtype;at timestamptz;f jsonb;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_ediel_retention.decision_evidence_lock_v1(p_company_id);
 PERFORM gridex_ediel_retention.completed_parent_actor_v1(p_company_id,p_actor_user_id,'ediel.retention.review');
 LOCK TABLE public.customers,gridex_ediel_retention.completed_parent_purposes_v1 IN SHARE ROW EXCLUSIVE MODE;
 -- A hold does not invent/cancel ordinary-use authority; it is not an
 -- admission clearance flag. Physical execution keeps the actual holds owner.
 g:=gridex_ediel_retention.completed_parent_graph_v1(p_company_id,p_policy_id);
 PERFORM gridex_ediel_retention.completed_parent_references_v1(p_company_id,p_policy_id,(g->>'reviewId')::uuid);
 g:=gridex_ediel_retention.completed_parent_purpose_scope_v1(p_company_id,p_policy_id);
 p:=gridex_ediel_retention.completed_parent_purpose_receipt_v1(p_company_id,p_policy_id,p_receipt);
 IF p->>'reviewerId' IS DISTINCT FROM p_actor_user_id::text OR p->>'reviewerId' IS NOT DISTINCT FROM g->>'submittedBy' OR p->>'familyCommitment' IS DISTINCT FROM g->>'familyCommitment' THEN RAISE EXCEPTION 'purpose_exact_independent_review_and_family_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(p_company_id,p_actor_user_id,'blob_retention_decision_original_bytes');PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(p_company_id,p_actor_user_id,'completed_decision_review_reason');
 p:=gridex_ediel_retention.completed_parent_purpose_receipt_v1(p_company_id,p_policy_id,p_receipt);at:=clock_timestamp();PERFORM gridex_ediel_retention.completed_parent_purpose_terms_v1(p,g,at);
 SELECT * INTO prior FROM gridex_ediel_retention.completed_parent_purposes_v1 WHERE company_id=p_company_id AND policy_id=p_policy_id FOR UPDATE;
 IF FOUND THEN
  PERFORM gridex_ediel_retention.completed_parent_purpose_current_v1(p_company_id,p_policy_id);
  IF (p->>'version')::bigint<>prior.version+1 OR p->>'predecessorHash' IS DISTINCT FROM prior.receipt_hash THEN RAISE EXCEPTION 'purpose_exact_qualified_successor_required' USING ERRCODE='42501';END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(convert_from(decode(prior.receipt->>'payloadBase64','base64'),'UTF8')::jsonb->'policyFields') LOOP IF (f->>'min')::timestamptz>at THEN RAISE EXCEPTION 'purpose_prior_own_minimum_required' USING ERRCODE='42501';END IF;END LOOP;
 ELSE IF (p->>'version')::bigint<>1 OR p->>'predecessorHash' IS NOT NULL THEN RAISE EXCEPTION 'purpose_first_generation_required' USING ERRCODE='42501';END IF;END IF;
 fresh:=(p_company_id,p_policy_id,(p->>'version')::bigint,p_receipt,encode(sha256(convert_to(p_receipt::text,'UTF8')),'hex'),p_actor_user_id,at,(p->>'D')::timestamptz,(p->>'E')::timestamptz)::gridex_ediel_retention.completed_parent_purposes_v1;
 IF prior.policy_id IS NOT NULL THEN
  INSERT INTO gridex_ediel_retention.completed_witness_phase_permits_v1 VALUES(pg_backend_pid(),txid_current(),'completed_parent_purposes_v1',encode(sha256(convert_to(to_jsonb(prior)::text,'UTF8')),'hex'),'UPDATE',encode(sha256(convert_to(to_jsonb(fresh)::text,'UTF8')),'hex'));
  UPDATE gridex_ediel_retention.completed_parent_purposes_v1 SET version=fresh.version,receipt=fresh.receipt,receipt_hash=fresh.receipt_hash,reviewer_user_id=fresh.reviewer_user_id,admitted_at=fresh.admitted_at,ordinary_until=fresh.ordinary_until,expires_at=fresh.expires_at WHERE company_id=p_company_id AND policy_id=p_policy_id;
 ELSE INSERT INTO gridex_ediel_retention.completed_parent_purposes_v1 SELECT (fresh).*;END IF;
 RETURN jsonb_build_object('status','purpose_admitted','version',fresh.version,'authority','none');
END$$;

CREATE FUNCTION public.ediel_completed_parent_purpose_status_v1(p_company_id uuid,p_actor_user_id uuid,p_policy_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p jsonb;at timestamptz;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_ediel_retention.decision_evidence_lock_v1(p_company_id);PERFORM gridex_ediel_retention.decision_evidence_read_actor_v1(p_company_id,p_actor_user_id,'blob_retention_decision_original_bytes');
 p:=gridex_ediel_retention.completed_parent_purpose_current_v1(p_company_id,p_policy_id);IF p IS NULL THEN RETURN jsonb_build_object('status','unavailable','authority','none');END IF;at:=clock_timestamp();
 RETURN jsonb_build_object('status',CASE WHEN at>=(p->>'E')::timestamptz THEN 'POLICY_OVERDUE' WHEN EXISTS(SELECT FROM jsonb_array_elements(p->'payload'->'policyFields') f WHERE (f->>'reviewBy')::timestamptz<=at) THEN 'POLICY_REVIEW_OVERDUE' WHEN at>=(p->>'D')::timestamptz THEN 'ordinary_use_ended' ELSE 'active' END,'disposed',false,'authority','none');
END$$;

DO $patch$ DECLARE x jsonb;c jsonb;body text;definition text;identity text;catalog_before jsonb;BEGIN
 FOR x IN SELECT value FROM jsonb_array_elements($purpose_specs$[{"name":"gridex_ediel_retention.completed_parent_receipt_v1","before":"3f54d20d65cfb20b570081857166e5e0b2c1c60494b50bb7590c1646fe436623","after":"eb43871bdc9e3e63f60cbfb34563ee4cd0f1b25d9c481d67fe1b71a271157e14","changes":[{"old":"'terminalFields'))","new":"'terminalFields','purposeVersion','purposeHash'))","count":1}]},{"name":"gridex_ediel_retention.completed_parent_references_v1","before":"a593e249bfa342b9dad2167dbb3c8c2a0515a0cea1dc55fb7f4a8cdc44a6ff25","after":"731047cb124c2823cd6af8c4857797e60ed943a93fd7eab8567501d9a01873b9","changes":[{"old":"  IF f.conrelid='gridex_ediel_retention.decision_evidence_reviews'::regclass AND col='policy_id'","new":"  IF f.conrelid='gridex_ediel_retention.completed_parent_purposes_v1'::regclass AND f.confrelid='gridex_ediel_retention.decision_evidence_policies'::regclass AND col='policy_id' AND keycol='id' AND f.conname='completed_parent_purpose_exact_policy_fk' THEN\n   IF EXISTS(SELECT FROM gridex_ediel_retention.completed_parent_purposes_v1 WHERE policy_id=policy AND company_id<>c) THEN RAISE EXCEPTION 'purpose_exact_owned_fk_scope_required' USING ERRCODE='42501';END IF;\n   PERFORM gridex_ediel_retention.completed_parent_purpose_current_v1(c,policy);CONTINUE;\n  END IF;\n  IF f.conrelid='gridex_ediel_retention.decision_evidence_reviews'::regclass AND col='policy_id'","count":1}]},{"name":"public.ediel_review_completed_parent_v1","before":"2d7972e7c4f2e48eccb053cbbffcc48b186887ee8cbffb5fbfa50425f7c87179","after":"268568d60cacf9c56b5e15fd8c269eabb02128121f028e62bb38793d40991c47","changes":[{"old":" PERFORM gridex_ediel_retention.completed_witness_approval_terms_v1(p,clock_timestamp());","new":" PERFORM gridex_ediel_retention.completed_parent_purpose_operation_v1(p_company_id,p_policy_id,p,false);\n PERFORM gridex_ediel_retention.completed_witness_approval_terms_v1(p,clock_timestamp());","count":1}]},{"name":"gridex_ediel_retention.completed_parent_execute_v1","before":"6e61ff5f29c5980488456662052ce7fd98affb56c6df0411c1987f216919f4b0","after":"262728769ae6302f7680025eb5d5e0509102e9c8f74067d0fdbe317b4927e9a9","changes":[{"old":" IF p->>'executionActorId' IS DISTINCT","new":" PERFORM gridex_ediel_retention.completed_parent_purpose_operation_v1(p_company_id,p_policy_id,p,false);\n IF p->>'executionActorId' IS DISTINCT","count":1},{"old":" FOREACH tab IN ARRAY ARRAY['decision_evidence_tombstones'","new":" PERFORM gridex_ediel_retention.completed_parent_purpose_operation_v1(p_company_id,p_policy_id,p,true);\n FOREACH tab IN ARRAY ARRAY['decision_evidence_tombstones'","count":1}]},{"name":"public.ediel_read_decision_evidence_policy_v1","before":"289988176a5b14a5bbc23445e518b32def1edce2b85300733d841c54cf6724cc","after":"a1b2dbaaba7ab4503dc1527d712d9043824d7cdd270eda844ef1720840cef1f2","changes":[{"old":" PERFORM gridex_ediel_retention.require_completed_review_witness_disclosure_v1","new":" PERFORM gridex_ediel_retention.require_completed_parent_purpose_disclosure_v1(p_company_id,d.id);\n PERFORM gridex_ediel_retention.require_completed_review_witness_disclosure_v1","count":1}]},{"name":"public.ediel_read_retention_decision_original_v1","before":"2a61722dde35012bbda239c68efe9bebf2a2be7b2ebb591e6bbd702786ac5132","after":"d462ac43a21de3911bce47b5fb27ca8c873324afb1baa7cc1fced5d43ee5c5d1","changes":[{"old":" IF p_retention_class='decision_evidence_policy_original_bytes' THEN PERFORM","new":" IF p_retention_class='decision_evidence_policy_original_bytes' THEN PERFORM gridex_ediel_retention.require_completed_parent_purpose_disclosure_v1(p_company_id,p_target_id);END IF;\n IF p_retention_class='decision_evidence_policy_original_bytes' THEN PERFORM","count":1}]}]$purpose_specs$::jsonb) LOOP
  SELECT prosrc,pg_get_functiondef(p.oid),p.oid::regprocedure::text INTO STRICT body,definition,identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname=x->>'name';
  IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM x->>'before' THEN RAISE EXCEPTION 'purpose_exact_installed_body_anchor_required:%',x->>'name';END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(x->'changes') LOOP
   IF (length(body)-length(replace(body,c->>'old','')))/length(c->>'old')<>(c->>'count')::integer THEN RAISE EXCEPTION 'purpose_exact_patch_occurrence_required';END IF;
   body:=replace(body,c->>'old',c->>'new');
  END LOOP;
  IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM x->>'after' THEN RAISE EXCEPTION 'purpose_exact_result_body_required';END IF;
  SELECT to_jsonb(p)-'prosrc' INTO STRICT catalog_before FROM pg_proc p WHERE oid=identity::regprocedure;
  EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=identity::regprocedure),body);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=identity::regprocedure) IS DISTINCT FROM catalog_before THEN RAISE EXCEPTION 'purpose_patch_catalog_owner_acl_security_must_be_exact';END IF;
 END LOOP;
END $patch$;
DO $$DECLARE f text;BEGIN
 ALTER TABLE gridex_ediel_retention.completed_parent_purposes_v1 OWNER TO gridex_ediel_retention_owner;
 ALTER TABLE gridex_ediel_retention.completed_parent_purposes_v1 ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_ediel_retention.completed_parent_purposes_v1 FORCE ROW LEVEL SECURITY;
 REVOKE ALL ON gridex_ediel_retention.completed_parent_purposes_v1 FROM PUBLIC,anon,authenticated,service_role;
 FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_retention' AND (p.proname LIKE 'completed_parent_purpose_%' OR p.proname='require_completed_parent_purpose_disclosure_v1') OR n.nspname='public' AND p.proname IN('ediel_admit_completed_parent_purpose_v1','ediel_completed_parent_purpose_status_v1') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO gridex_ediel_retention_owner',f);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);
 END LOOP;
END$$;
GRANT EXECUTE ON FUNCTION public.ediel_admit_completed_parent_purpose_v1(uuid,uuid,uuid,jsonb),public.ediel_completed_parent_purpose_status_v1(uuid,uuid,uuid) TO authenticated;

DO $atomic_install_final$ DECLARE x jsonb;actual text;
 expected_reader_body CONSTANT text:='a1b2dbaaba7ab4503dc1527d712d9043824d7cdd270eda844ef1720840cef1f2';
BEGIN
 FOR x IN SELECT value FROM jsonb_array_elements($atomic_bodies$[{"name":"gridex_ediel_retention.completed_parent_receipt_v1","sha256":"eb43871bdc9e3e63f60cbfb34563ee4cd0f1b25d9c481d67fe1b71a271157e14"},{"name":"gridex_ediel_retention.completed_parent_actor_v1","sha256":"85deb06a78b45a139a859102780be9feb19d18658c4352f62f04ade0479eeb70"},{"name":"gridex_ediel_retention.completed_parent_graph_v1","sha256":"5d2ab2d3818979e2b5b69b0afead0a9446934328105fbd663f32ea282f4507dd"},{"name":"gridex_ediel_retention.completed_parent_references_v1","sha256":"731047cb124c2823cd6af8c4857797e60ed943a93fd7eab8567501d9a01873b9"},{"name":"public.ediel_review_completed_parent_v1","sha256":"268568d60cacf9c56b5e15fd8c269eabb02128121f028e62bb38793d40991c47"},{"name":"gridex_ediel_retention.completed_parent_execute_v1","sha256":"262728769ae6302f7680025eb5d5e0509102e9c8f74067d0fdbe317b4927e9a9"},{"name":"public.ediel_dispose_completed_parent_v1","sha256":"42b06ab40af54f1c941272652c5ae86d4613770a6a8954ae477aceadcab432b7"},{"name":"public.ediel_advance_completed_parent_v1","sha256":"5277e056d4609847d23ae79e1aed207d1929e2f03759e1c7045548a20bd7e061"},{"name":"public.ediel_gc_completed_parent_v1","sha256":"6b3348ed3c4bf20305b88d1d17497a091ff8af8425e53933e1ca050360a8447d"},{"name":"gridex_ediel_retention.completed_parent_purpose_guard_v1","sha256":"d36374b20daad3d147141c3a7424d5d9d6de1722d0cd197fcd77d090add7c566"},{"name":"gridex_ediel_retention.completed_parent_purpose_scope_v1","sha256":"244cc26e71d30b40cbb1583901c72b70aad36a3e619258fe921428ca4c4d98dc"},{"name":"gridex_ediel_retention.completed_parent_purpose_receipt_v1","sha256":"f0d173e4da30ab92d088daa9397dafa3c4ceaca24309f4df16763a5946f33f0d"},{"name":"gridex_ediel_retention.completed_parent_purpose_terms_v1","sha256":"22aea228f1e709fc0702df5220013ab18706b336c16d4dc16a5d34942217b5e0"},{"name":"gridex_ediel_retention.completed_parent_purpose_current_v1","sha256":"3014d72ae5db3b7efd4006166d55186fdf1538f8dcac64bd581c1506db23cd2f"},{"name":"gridex_ediel_retention.require_completed_parent_purpose_disclosure_v1","sha256":"01ac6c0570a5b9586f35e39d68b7cdcc223d62064c8b9346717f966a540294fd"},{"name":"gridex_ediel_retention.completed_parent_purpose_closure_v1","sha256":"3de19e09d986c6020914fe70b82a33532b1d890ae3bf39bbafbd25870c7e4f0d"},{"name":"gridex_ediel_retention.completed_parent_purpose_operation_v1","sha256":"975190c18b97bf2e74a8d10e0144d5d39a9aa790eaa7ea0e4855408a3184fcb0"},{"name":"public.ediel_admit_completed_parent_purpose_v1","sha256":"6147e1a2d7f31e3875936a21c4b26de2edfec5405e7e2d15bdd6f8492417d1b1"},{"name":"public.ediel_completed_parent_purpose_status_v1","sha256":"1662f5f8016d7a9a5644fa276529219c12a7e79f90f24964e26d880111d8c0bf"},{"name":"public.ediel_read_decision_evidence_policy_v1","sha256":"a1b2dbaaba7ab4503dc1527d712d9043824d7cdd270eda844ef1720840cef1f2"},{"name":"public.ediel_read_retention_decision_original_v1","sha256":"d462ac43a21de3911bce47b5fb27ca8c873324afb1baa7cc1fced5d43ee5c5d1"},{"name":"gridex_received_sources.other_supply_scope_effect_v1","sha256":"c30e7398338c7b0a39da7220ea62bffa4d8ae0134f1c7d8b272b09e07736e03e"},{"name":"gridex_prodat_object_batch.require_wire_projection_v1","sha256":"4c9dd19aaa1c28efccd3faa17b04d68272891879859e3212b3746fa71b0ba43a"},{"name":"gridex_ediel_retention.permission_v1","sha256":"6bedde3f4c01c504eae815ba0895b0872603dd2f6d8adace45669b640db689c7"},{"name":"gridex_ediel_retention.completed_witness_graph_v1","sha256":"ecabc5b921034a2f3a275f0ca34d13a62847bda24a3f5736a96436eb68488c76"},{"name":"gridex_ediel_retention.completed_witness_holds_v1","sha256":"7a1422ce995839794f3b9a8e36fe5a1afb6453082b9c3c1921272b03f4c44a61"},{"name":"gridex_ediel_retention.completed_witness_worker_actor_v1","sha256":"709525c37511e3e52cee15c9cd06f6a5c1f8b13e8431e5ce87bb770e16884a95"},{"name":"gridex_ediel_retention.completed_witness_receipt_v1","sha256":"acdd7da917484ed6b20e9b7453ce3c9d962bb87b191f7541a19d9228757ec796"},{"name":"gridex_ediel_retention.completed_witness_approval_terms_v1","sha256":"4cc49a1c93e8976baa4ea75ea5ea3e0928a573813b7d651b0a4a0c8a42dc4cfe"},{"name":"gridex_ediel_retention.completed_witness_fields_v1","sha256":"e0da7471f83cfa19c8d1a5dc7de0449e90ccd99273969fbd051f45b68252a78a"},{"name":"gridex_ediel_retention.completed_witness_terms_v1","sha256":"f5f38be101a5f9993c7ef473163de5ee6ec39ea7a9bb019b7172320a6f0fecfc"},{"name":"gridex_ediel_retention.completed_witness_reason_intake_v1","sha256":"11a67195922642add7e12b0dbef4fd077b96859c23c482eca26ce3283567f931"},{"name":"gridex_ediel_retention.completed_witness_guard_v1","sha256":"b7e3b12566292f2a595c55cb250cb597dba3120b0891c927a2b5e75f2f99e125"},{"name":"gridex_ediel_retention.completed_witness_permits_empty_v1","sha256":"b55f8c005a1bfcf821381d8b2f5506d3dc54f60eec6e81e72fd8718c9181abda"},{"name":"gridex_ediel_retention.completed_witness_references_v1","sha256":"4b8e3233345b123988586df4a10c833875aa1ce1c86c7d158ab7f219d33f3382"},{"name":"gridex_ediel_retention.completed_witness_route_v1","sha256":"68cfffa0556dc4c8b73715455e98943e05988f39fe3120761e2ea1a8216f19ed"},{"name":"gridex_ediel_retention.completed_witness_payload_terms_v1","sha256":"29b65148f552bed9e5c9b658fcbb9b427d5924e2ae25353d5e7d4832acfcd533"},{"name":"public.ediel_review_completed_witness_disposition_v1","sha256":"8a0a75485e13b8e1464856a22cf0109adeb045f7674bc1fed19077b7981af608"},{"name":"gridex_ediel_retention.completed_witness_execute_v1","sha256":"b4021600a192c796aaa55dfe0183cd4db822c5dc76c38af90a7dccf04d46cde8"},{"name":"gridex_ediel_retention.completed_witness_status_v1","sha256":"8272b5b635a78c73cad8f79d89dbe62a44a7ca4c03cb533042de769b5253d1a5"},{"name":"gridex_ediel_retention.completed_witness_dispatch_v1","sha256":"15acf40acda97aeea70dbf018edbb787db5d673ca7040d59b9a27ecd2c7c3665"},{"name":"public.ediel_advance_completed_witness_disposition_v1","sha256":"7c01ea693dd74962484362f8b42c7a46788c4b9e4c75a381520c10d687a16911"}]$atomic_bodies$::jsonb) LOOP
  SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') INTO STRICT actual FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname=x->>'name';
  IF actual IS DISTINCT FROM x->>'sha256' THEN RAISE EXCEPTION 'completed_parent_atomic_installed_body_required:%',x->>'name';END IF;
 END LOOP;
 SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') INTO STRICT actual FROM pg_proc WHERE oid='public.ediel_read_decision_evidence_policy_v1(uuid,uuid,uuid,boolean)'::regprocedure;
 IF actual IS DISTINCT FROM expected_reader_body THEN RAISE EXCEPTION 'completed_parent_atomic_late_reader_anchor_required';END IF;
END $atomic_install_final$;
-- DB05_INSTALL_OWNER_RESTORE_BEGIN
DO $db05_install_restore$
DECLARE before_row record;BEGIN
 SELECT * INTO STRICT before_row FROM pg_temp.gridex_db05_install_scope;
 IF NOT before_row.owner_public_create THEN REVOKE CREATE ON SCHEMA public FROM gridex_ediel_retention_owner;END IF;
 GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
 IF current_user<>'postgres' OR session_user<>'postgres'
 OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m) IS DISTINCT FROM before_row.memberships
 OR (SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r) IS DISTINCT FROM before_row.roles
 OR (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','gridex_ediel_retention')) IS DISTINCT FROM before_row.namespaces
 OR pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'db05_install_roles_memberships_namespaces_must_restore';END IF;
END $db05_install_restore$;
-- DB05_INSTALL_OWNER_RESTORE_END
COMMIT;
