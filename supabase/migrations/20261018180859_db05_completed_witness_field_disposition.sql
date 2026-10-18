BEGIN;
-- DB-05 / AT-DB-05: physical own-leaf disposition, not a blanket witness policy.
-- No legal facts, issuer keys, periods, grants or live scheduler credentials seed here.
-- Source6/W originals stay intact. Audit/source-parent/siblings remain separately scoped.
DO $predecessor$ BEGIN
 IF (SELECT nspowner FROM pg_namespace WHERE nspname='gridex_ediel_retention') IS DISTINCT FROM 'gridex_ediel_retention_owner'::regrole::oid
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner' AND NOT rolcanlogin AND rolbypassrls)
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='gridex_ediel_retention.permission_v1(uuid,uuid,text)'::regprocedure)
 IS DISTINCT FROM '6bedde3f4c01c504eae815ba0895b0872603dd2f6d8adace45669b640db689c7'
 OR NOT EXISTS(SELECT FROM gridex_ediel_retention.decision_evidence_catalog WHERE retention_class='completed_decision_review_reason' AND source_table='decision_evidence_reviews' AND permission_key='ediel.retention.completed_review_reason' AND revocation_table IS NULL AND revocation_id_column IS NULL AND receipt_function IS NULL)
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.ediel_read_decision_evidence_policy_v1(uuid,uuid,uuid,boolean)'::regprocedure) IS DISTINCT FROM '289988176a5b14a5bbc23445e518b32def1edce2b85300733d841c54cf6724cc'
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.ediel_read_retention_decision_original_v1(uuid,uuid,text,uuid,boolean)'::regprocedure) IS DISTINCT FROM '2a61722dde35012bbda239c68efe9bebf2a2be7b2ebb591e6bbd702786ac5132'
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='gridex_ediel_retention.decision_evidence_lock_v1(uuid)'::regprocedure) IS DISTINCT FROM 'ef3eed908c6accd29c05324f1e1267a1b1d9621d6a1e313807f455f1e9014e2f'
 THEN RAISE EXCEPTION 'completed_witness_actual_Source6_owner_permission_required';END IF;
END $predecessor$;
CREATE TABLE gridex_ediel_retention.completed_witness_phase_authorizations_v1(
 company_id uuid NOT NULL,policy_id uuid NOT NULL,source_commitment text NOT NULL,
 receipt jsonb NOT NULL,receipt_hash text NOT NULL,reviewer_user_id uuid NOT NULL,
 approved_at timestamptz NOT NULL,stage text NOT NULL CHECK(stage IN('dispose','expire')),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),PRIMARY KEY(company_id,policy_id),
 CHECK(receipt_hash=encode(sha256(convert_to(receipt::text,'UTF8')),'hex'))
);
CREATE TABLE gridex_ediel_retention.completed_witness_replays_v1(
 company_id uuid NOT NULL,policy_id uuid NOT NULL,source_commitment text NOT NULL,
 replay_until timestamptz NOT NULL CHECK(isfinite(replay_until)),PRIMARY KEY(company_id,policy_id)
);
CREATE TABLE gridex_ediel_retention.completed_witness_phase_permits_v1(
 backend integer NOT NULL,xid bigint NOT NULL,relation_name text NOT NULL,before_hash text NOT NULL,
 operation text NOT NULL CHECK(operation IN('DELETE','UPDATE')),after_hash text,
 PRIMARY KEY(backend,xid,relation_name,before_hash),CHECK(operation='DELETE' AND after_hash IS NULL OR operation='UPDATE' AND after_hash IS NOT NULL)
);
ALTER TABLE gridex_ediel_retention.decision_evidence_reviews DROP CONSTRAINT decision_evidence_reviews_reason_check;
ALTER TABLE gridex_ediel_retention.decision_evidence_reviews ADD CONSTRAINT decision_evidence_reviews_reason_check CHECK(length(reason) BETWEEN 0 AND 4000);
CREATE FUNCTION gridex_ediel_retention.completed_witness_graph_v1(c uuid,policy uuid) RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d gridex_ediel_retention.decision_evidence_policies%rowtype;b jsonb;BEGIN
 SELECT * INTO STRICT d FROM gridex_ediel_retention.decision_evidence_policies WHERE id=policy AND company_id=c FOR UPDATE;
 b:=gridex_ediel_retention.completed_review_reason_scope_v1(c,d.target_id);
 IF d.retention_class<>'completed_decision_review_reason' OR b->>'targetMetadataHash' IS DISTINCT FROM d.target_metadata_hash THEN RAISE EXCEPTION 'phase_original_commitment_required' USING ERRCODE='42501';END IF;
 RETURN encode(sha256(convert_to(jsonb_build_object('policy',to_jsonb(d),'sourceScope',b,
 'reviews',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM gridex_ediel_retention.decision_evidence_reviews x WHERE policy_id=policy),
 'revocation',(SELECT to_jsonb(x) FROM gridex_ediel_retention.decision_evidence_revocations x WHERE policy_id=policy),
 'completion',(SELECT to_jsonb(x) FROM gridex_ediel_retention.decision_evidence_tombstones x WHERE policy_id=policy))::text,'UTF8')),'hex');
END$$;

CREATE FUNCTION gridex_ediel_retention.completed_witness_holds_v1(c uuid) RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE n integer;h text;BEGIN
 -- Same conservative tenant-population policy as actual finance/process basis.
 -- No caller list, missing-row clearance flag or single-message assumption.
 LOCK TABLE public.customers IN SHARE ROW EXCLUSIVE MODE;
 SELECT count(*),encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('id',id,'legalHold',legal_hold) ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex')
 INTO n,h FROM public.customers WHERE company_id=c;
 IF n>10000 OR EXISTS(SELECT FROM public.customers WHERE company_id=c AND legal_hold) THEN RAISE EXCEPTION 'phase_current_customer_hold' USING ERRCODE='42501';END IF;
 RETURN h;
END$$;

CREATE FUNCTION gridex_ediel_retention.completed_witness_worker_actor_v1(c uuid,actor uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 -- Deliberate service entrypoint: NEVER fabricate auth.uid/session claims.
 -- All permission/membership checks use actual installed retention owners.
 LOCK TABLE public.permissions,public.roles,public.user_roles,public.role_permissions,public.user_permissions,public.user_permission_overrides IN SHARE MODE;
 PERFORM id FROM public.companies WHERE id=c FOR SHARE;
 PERFORM id FROM public.user_profiles WHERE id=actor FOR SHARE;
 PERFORM user_id FROM public.company_memberships WHERE company_id=c AND user_id=actor FOR SHARE;
 IF public.ediel_retention_lock_auth_actor_v1(actor) IS NOT TRUE
 OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
 OR gridex_ediel_retention.permission_v1(c,actor,'ediel.retention.purge') IS NOT TRUE
 OR gridex_ediel_retention.permission_v1(c,actor,'ediel.retention.completed_review_reason') IS NOT TRUE
 THEN RAISE EXCEPTION 'phase_current_delegated_actor_required' USING ERRCODE='42501';END IF;
END$$;

CREATE FUNCTION gridex_ediel_retention.completed_witness_receipt_v1(c uuid,policy uuid,envelope jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
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
 IF p->>'format' IS DISTINCT FROM 'ediel_completed_witness_disposition_bundle_v1'
 OR p->>'replayScope' IS DISTINCT FROM 'committed_leaf_disposition_only'
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

CREATE FUNCTION gridex_ediel_retention.completed_witness_approval_terms_v1(p jsonb,at timestamptz) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE f jsonb;fields text[];BEGIN
 SELECT array_agg(value->>'field' ORDER BY value->>'field') INTO fields FROM jsonb_array_elements(p->'approvalFields');
 IF fields IS DISTINCT FROM ARRAY['approval.approved_at','approval.company_id','approval.expires_at','approval.policy_id','approval.receipt','approval.receipt_hash','approval.reviewer_user_id','approval.source_commitment','approval.stage']::text[]
 THEN RAISE EXCEPTION 'phase_all_nine_approval_fields_required' USING ERRCODE='42501';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p->'approvalFields') LOOP
  IF jsonb_typeof(f->'purposeReference') IS DISTINCT FROM 'string' OR jsonb_typeof(f->'basisReference') IS DISTINCT FROM 'string' OR EXISTS(SELECT FROM jsonb_object_keys(f) k WHERE k NOT IN('field','purposeReference','basisReference','min','max','reviewBy','action')) OR nullif(btrim(f->>'purposeReference'),'') IS NULL OR nullif(btrim(f->>'basisReference'),'') IS NULL
  OR f->>'action' IS DISTINCT FROM 'consume_or_expire'
  OR isfinite((f->>'min')::timestamptz) IS DISTINCT FROM true OR (f->>'min')::timestamptz>at
  OR (f->>'max')::timestamptz IS DISTINCT FROM (p->>'approvalUntil')::timestamptz
  OR isfinite((f->>'reviewBy')::timestamptz) IS DISTINCT FROM true OR (f->>'reviewBy')::timestamptz<=at
  THEN RAISE EXCEPTION 'phase_finite_approval_storage_terms_required' USING ERRCODE='42501';END IF;
 END LOOP;
END$$;

CREATE FUNCTION gridex_ediel_retention.completed_witness_fields_v1(c uuid,policy uuid) RETURNS text[] LANGUAGE sql AS $$
 SELECT array_agg(field ORDER BY field) FROM (
 SELECT 'policy.'||jsonb_object_keys(to_jsonb(x)) field FROM gridex_ediel_retention.decision_evidence_policies x WHERE id=policy AND company_id=c
 UNION ALL SELECT 'review.'||jsonb_object_keys(to_jsonb(x)) FROM gridex_ediel_retention.decision_evidence_reviews x WHERE policy_id=policy
 UNION ALL SELECT 'revocation.'||jsonb_object_keys(to_jsonb(x)) FROM gridex_ediel_retention.decision_evidence_revocations x WHERE policy_id=policy
 UNION ALL SELECT 'tombstone.'||jsonb_object_keys(to_jsonb(x)) FROM gridex_ediel_retention.decision_evidence_tombstones x WHERE policy_id=policy
 UNION ALL SELECT 'source_review.reason' FROM gridex_ediel_retention.decision_evidence_policies x WHERE id=policy AND company_id=c
 ) f
$$;
CREATE FUNCTION gridex_ediel_retention.completed_witness_terms_v1(p jsonb,expected text[],phase text,w timestamptz,r timestamptz,at timestamptz) RETURNS void LANGUAGE plpgsql AS $$DECLARE f jsonb;actual text[];lo timestamptz;hi timestamptz;review_at timestamptz;BEGIN
 IF isfinite((p->>'executeBefore')::timestamptz) IS DISTINCT FROM true OR (p->>'executeBefore')::timestamptz<=at THEN RAISE EXCEPTION 'completed_witness_finite_current_cleanup_mandate_required' USING ERRCODE='42501';END IF;
 SELECT array_agg(value->>'field' ORDER BY value->>'field') INTO actual FROM jsonb_array_elements(p->'fields');
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'completed_witness_exact_per_field_scope_required' USING ERRCODE='42501';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p->'fields') LOOP
  lo:=(f->>'min')::timestamptz;hi:=(f->>'max')::timestamptz;review_at:=(f->>'reviewBy')::timestamptz;
  IF jsonb_typeof(f->'purposeReference') IS DISTINCT FROM 'string' OR jsonb_typeof(f->'basisReference') IS DISTINCT FROM 'string' OR EXISTS(SELECT FROM jsonb_object_keys(f) k WHERE k NOT IN('field','purposeReference','basisReference','min','max','reviewBy','action')) OR nullif(btrim(f->>'purposeReference'),'') IS NULL OR nullif(btrim(f->>'basisReference'),'') IS NULL
   OR isfinite(lo) IS DISTINCT FROM true OR isfinite(hi) IS DISTINCT FROM true OR isfinite(review_at) IS DISTINCT FROM true
   OR lo>at OR review_at<=at OR lo>hi OR hi IS DISTINCT FROM (CASE WHEN phase='dispose' THEN w ELSE r END)
   OR f->>'action' IS DISTINCT FROM 'erase'
  THEN RAISE EXCEPTION 'completed_witness_current_per_field_purpose_min_max_review_action_required' USING ERRCODE='42501';END IF;
 END LOOP;
 IF phase='dispose' AND r=w THEN
  IF p->'replayFields' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'completed_witness_no_post_W_replay_purpose' USING ERRCODE='42501';END IF;
 ELSIF phase='dispose' THEN
  SELECT array_agg(value->>'field' ORDER BY value->>'field') INTO actual FROM jsonb_array_elements(p->'replayFields');
  IF actual IS DISTINCT FROM ARRAY['replay.company_id','replay.policy_id','replay.replay_until','replay.source_commitment']::text[] THEN RAISE EXCEPTION 'completed_witness_exact_finite_replay_terms_required' USING ERRCODE='42501';END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(p->'replayFields') LOOP
   IF jsonb_typeof(f->'purposeReference') IS DISTINCT FROM 'string' OR jsonb_typeof(f->'basisReference') IS DISTINCT FROM 'string' OR EXISTS(SELECT FROM jsonb_object_keys(f) k WHERE k NOT IN('field','purposeReference','basisReference','min','max','reviewBy','action')) OR nullif(btrim(f->>'purposeReference'),'') IS NULL OR nullif(btrim(f->>'basisReference'),'') IS NULL OR f->>'action' IS DISTINCT FROM 'retain_until_R'
    OR (f->>'max')::timestamptz IS DISTINCT FROM r OR isfinite((f->>'min')::timestamptz) IS DISTINCT FROM true OR isfinite((f->>'reviewBy')::timestamptz) IS DISTINCT FROM true OR (f->>'min')::timestamptz>w OR (f->>'reviewBy')::timestamptz<=at
   THEN RAISE EXCEPTION 'completed_witness_separate_replay_purpose_required' USING ERRCODE='42501';END IF;
  END LOOP;
 END IF;
END$$;
CREATE FUNCTION gridex_ediel_retention.completed_witness_reason_intake_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF NEW.reason IS NULL OR length(NEW.reason) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'decision_evidence_review_reason_intake_required' USING ERRCODE='23514';END IF;RETURN NEW;
END$$;
CREATE TRIGGER completed_witness_reason_intake BEFORE INSERT ON gridex_ediel_retention.decision_evidence_reviews FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.completed_witness_reason_intake_v1();

CREATE FUNCTION gridex_ediel_retention.completed_witness_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guard$
DECLARE h text;BEGIN
 h:=encode(sha256(convert_to(to_jsonb(OLD)::text,'UTF8')),'hex');
 DELETE FROM gridex_ediel_retention.completed_witness_phase_permits_v1
 WHERE backend=pg_backend_pid() AND xid=txid_current() AND relation_name=TG_TABLE_NAME AND before_hash=h AND operation=TG_OP
 AND (TG_OP='DELETE' OR after_hash=encode(sha256(convert_to(to_jsonb(NEW)::text,'UTF8')),'hex'));
 IF FOUND THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='decision_evidence_policies' AND gridex_ediel_retention.decision_evidence_transition_v1(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) IS TRUE THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='decision_evidence_reviews' AND OLD.reason<>'' AND gridex_ediel_retention.completed_review_reason_transition_v1(to_jsonb(OLD),to_jsonb(NEW)) IS TRUE THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'received_source_evidence_is_append_only' USING ERRCODE='23514';
END $guard$;
CREATE FUNCTION gridex_ediel_retention.completed_witness_permits_empty_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF EXISTS(SELECT FROM gridex_ediel_retention.completed_witness_phase_permits_v1 WHERE backend=pg_backend_pid() AND xid=txid_current()) THEN RAISE EXCEPTION 'completed_witness_unconsumed_permit' USING ERRCODE='23514';END IF;RETURN NULL;
END$$;
CREATE CONSTRAINT TRIGGER completed_witness_permits_empty AFTER INSERT ON gridex_ediel_retention.completed_witness_phase_permits_v1 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.completed_witness_permits_empty_v1();

-- Lock every current incoming FK relation before inspecting rows. Composite,
-- unknown or inaccessible consumers fail closed. No whole-table own-row exemption.
CREATE FUNCTION gridex_ediel_retention.completed_witness_references_v1(c uuid,policy uuid,source_review uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $refs$
DECLARE f record;found_reference boolean;col text;keycol text;ids uuid[];parent gridex_ediel_retention.decision_evidence_policies%rowtype;BEGIN
 SELECT p.* INTO STRICT parent FROM gridex_ediel_retention.decision_evidence_reviews r JOIN gridex_ediel_retention.decision_evidence_policies p ON p.id=r.policy_id WHERE r.id=source_review AND p.company_id=c FOR SHARE OF p;
 LOCK TABLE gridex_ediel_retention.decision_evidence_policies,gridex_ediel_retention.decision_evidence_reviews,gridex_ediel_retention.decision_evidence_revocations,gridex_ediel_retention.decision_evidence_tombstones IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 FOR f IN SELECT DISTINCT conrelid FROM pg_constraint WHERE contype='f' AND confrelid=ANY(ARRAY['gridex_ediel_retention.decision_evidence_policies'::regclass,'gridex_ediel_retention.decision_evidence_reviews'::regclass,'gridex_ediel_retention.decision_evidence_revocations'::regclass,'gridex_ediel_retention.decision_evidence_tombstones'::regclass]) ORDER BY conrelid LOOP
  EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE NOWAIT',f.conrelid::regclass);
 END LOOP;
 FOR f IN SELECT * FROM pg_constraint WHERE contype='f' AND confrelid=ANY(ARRAY['gridex_ediel_retention.decision_evidence_policies'::regclass,'gridex_ediel_retention.decision_evidence_reviews'::regclass,'gridex_ediel_retention.decision_evidence_revocations'::regclass,'gridex_ediel_retention.decision_evidence_tombstones'::regclass]) ORDER BY conrelid,oid LOOP
  IF cardinality(f.conkey)<>1 OR cardinality(f.confkey)<>1 THEN RAISE EXCEPTION 'completed_witness_unsupported_incoming_reference' USING ERRCODE='42501';END IF;
  SELECT attname INTO STRICT col FROM pg_attribute WHERE attrelid=f.conrelid AND attnum=f.conkey[1];
  SELECT attname INTO STRICT keycol FROM pg_attribute WHERE attrelid=f.confrelid AND attnum=f.confkey[1];
  IF f.confrelid='gridex_ediel_retention.decision_evidence_reviews'::regclass AND keycol='id' THEN
   SELECT array_agg(id) INTO ids FROM gridex_ediel_retention.decision_evidence_reviews WHERE policy_id=policy;ids:=coalesce(ids,ARRAY[]::uuid[])||source_review;
  ELSIF keycol IN('id','policy_id') THEN ids:=ARRAY[policy];
  ELSE RAISE EXCEPTION 'completed_witness_unsupported_incoming_reference' USING ERRCODE='42501';END IF;
  IF f.conrelid='gridex_ediel_retention.decision_evidence_reviews'::regclass AND col='policy_id' AND f.confrelid='gridex_ediel_retention.decision_evidence_policies'::regclass THEN CONTINUE;END IF;
  IF f.conrelid='gridex_ediel_retention.decision_evidence_revocations'::regclass AND col='policy_id' AND f.confrelid='gridex_ediel_retention.decision_evidence_policies'::regclass THEN CONTINUE;END IF;
  IF f.conrelid='gridex_ediel_retention.decision_evidence_tombstones'::regclass THEN
   IF col='policy_id' AND f.confrelid='gridex_ediel_retention.decision_evidence_policies'::regclass THEN CONTINUE;END IF;
   IF col='review_id' AND f.confrelid='gridex_ediel_retention.decision_evidence_reviews'::regclass THEN
    IF EXISTS(SELECT FROM gridex_ediel_retention.decision_evidence_tombstones x WHERE x.review_id=ANY(ids)
      AND NOT (x.policy_id=policy AND x.company_id=c AND x.review_id<>source_review
       OR x.policy_id=parent.id AND x.review_id=source_review AND x.company_id=c AND x.retention_class=parent.retention_class AND x.target_id=parent.target_id AND x.source_hash=parent.source_hash AND x.target_metadata_hash=parent.target_metadata_hash))
    THEN RAISE EXCEPTION 'completed_witness_foreign_completion_consumer' USING ERRCODE='42501';END IF;CONTINUE;
   END IF;
  END IF;
  EXECUTE format('SELECT EXISTS(SELECT FROM %s WHERE %I=ANY($1))',f.conrelid::regclass,col) INTO found_reference USING ids;
  IF found_reference THEN RAISE EXCEPTION 'completed_witness_incoming_reference_required' USING ERRCODE='42501';END IF;
 END LOOP;
 IF EXISTS(SELECT FROM gridex_ediel_retention.decision_evidence_policies x WHERE x.id<>policy AND x.target_id=ANY(ARRAY[policy,source_review]||(SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) FROM gridex_ediel_retention.decision_evidence_reviews WHERE policy_id=policy))) THEN RAISE EXCEPTION 'completed_witness_untyped_policy_consumer' USING ERRCODE='42501';END IF;
END $refs$;

-- Initial supported source owner is the completed blob decision. Bytes are
-- already gone, so blob_basis_v1 must NOT be re-called to manufacture custody.
CREATE FUNCTION gridex_ediel_retention.completed_witness_route_v1(c uuid,policy uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $route$
DECLARE p gridex_ediel_retention.decision_evidence_policies%rowtype;b gridex_ediel_retention.blob_decisions%rowtype;m public.ediel_messages%rowtype;payload public.ediel_message_payloads%rowtype;BEGIN
 SELECT q.* INTO STRICT p FROM gridex_ediel_retention.decision_evidence_policies d JOIN gridex_ediel_retention.decision_evidence_reviews r ON r.id=d.target_id JOIN gridex_ediel_retention.decision_evidence_policies q ON q.id=r.policy_id WHERE d.id=policy AND d.company_id=c AND q.company_id=c FOR SHARE OF q;
 IF p.retention_class<>'blob_retention_decision_original_bytes' THEN RAISE EXCEPTION 'completed_witness_source_owner_not_admitted' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT b FROM gridex_ediel_retention.blob_decisions WHERE id=p.target_id AND company_id=c FOR SHARE;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=b.message_id AND company_id=c FOR SHARE;
 IF b.retention_class='received_ediel_message_content' THEN
  IF b.target_id<>m.id THEN RAISE EXCEPTION 'completed_witness_message_route_required' USING ERRCODE='42501';END IF;
 ELSIF b.retention_class='transport_raw_mime_bytes' THEN
  SELECT * INTO STRICT payload FROM public.ediel_message_payloads WHERE id=b.target_id AND company_id=c FOR SHARE;
  IF payload.ediel_message_id IS DISTINCT FROM m.id THEN RAISE EXCEPTION 'completed_witness_payload_route_required' USING ERRCODE='42501';END IF;
 ELSE RAISE EXCEPTION 'completed_witness_blob_class_required' USING ERRCODE='42501';END IF;
 IF m.customer_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.customers WHERE id=m.customer_id AND company_id=c) THEN RAISE EXCEPTION 'completed_witness_current_customer_route_required' USING ERRCODE='42501';END IF;
END $route$;

CREATE FUNCTION gridex_ediel_retention.completed_witness_payload_terms_v1(c uuid,policy uuid,p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $payload$
DECLARE w timestamptz;r timestamptz;a timestamptz;BEGIN
 SELECT journal_retain_until INTO STRICT w FROM gridex_ediel_retention.decision_evidence_tombstones WHERE policy_id=policy AND company_id=c;
 r:=(p->>'R')::timestamptz;a:=(p->>'approvalUntil')::timestamptz;
 IF (p->>'W')::timestamptz IS DISTINCT FROM w OR isfinite(w) IS DISTINCT FROM true OR isfinite(r) IS DISTINCT FROM true OR r<w OR a<=r THEN RAISE EXCEPTION 'completed_witness_exact_finite_phase_boundaries_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_retention.completed_witness_terms_v1(jsonb_build_object('executeBefore',a,'fields',p->'fields','replayFields',p->'replayFields'),gridex_ediel_retention.completed_witness_fields_v1(c,policy),'dispose',w,r,w);
 IF r>w THEN PERFORM gridex_ediel_retention.completed_witness_terms_v1(jsonb_build_object('executeBefore',a,'fields',p->'terminalFields'),ARRAY['replay.company_id','replay.policy_id','replay.replay_until','replay.source_commitment'],'expire',r,r,r);
 ELSIF p->'terminalFields' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'completed_witness_no_terminal_replay_scope_required' USING ERRCODE='42501';END IF;
END $payload$;

CREATE FUNCTION public.ediel_review_completed_witness_disposition_v1(p_company_id uuid,p_actor_user_id uuid,p_policy_id uuid,p_outcome text,p_receipt jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $review$
DECLARE p jsonb;h text;holds text;phase_stage text:='dispose';r gridex_ediel_retention.completed_witness_replays_v1%rowtype;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_ediel_retention.decision_evidence_lock_v1(p_company_id);
 PERFORM gridex_ediel_retention.decision_evidence_actor_v1(p_company_id,p_actor_user_id,'completed_decision_review_reason','ediel.retention.review');
 PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(p_company_id,p_actor_user_id,'completed_decision_review_reason');
 IF p_outcome='revoke' THEN DELETE FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1 WHERE company_id=p_company_id AND policy_id=p_policy_id ;RETURN jsonb_build_object('status','revoked','authority','none');END IF;
 IF p_outcome IS DISTINCT FROM 'approve' THEN RAISE EXCEPTION 'completed_witness_explicit_review_outcome_required' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT FROM gridex_ediel_retention.decision_evidence_policies WHERE id=p_policy_id AND company_id=p_company_id) THEN
  h:=gridex_ediel_retention.completed_witness_graph_v1(p_company_id,p_policy_id);
  PERFORM gridex_ediel_retention.completed_witness_route_v1(p_company_id,p_policy_id);
  PERFORM gridex_ediel_retention.completed_witness_references_v1(p_company_id,p_policy_id,(SELECT target_id FROM gridex_ediel_retention.decision_evidence_policies WHERE id=p_policy_id AND company_id=p_company_id));
 ELSE
  -- Explicit recovery after an overdue terminal phase: the physical leaf is
  -- already gone. This can only authorize erasing the exact surviving four
  -- replay fields. It never changes their R or recreates disclosure/replay.
  SELECT * INTO STRICT r FROM gridex_ediel_retention.completed_witness_replays_v1 WHERE company_id=p_company_id AND policy_id=p_policy_id FOR UPDATE;
  IF clock_timestamp()<r.replay_until THEN RAISE EXCEPTION 'completed_witness_terminal_recovery_not_due' USING ERRCODE='42501';END IF;
  h:=r.source_commitment;phase_stage:='expire';
 END IF;
 holds:=gridex_ediel_retention.completed_witness_holds_v1(p_company_id);p:=gridex_ediel_retention.completed_witness_receipt_v1(p_company_id,p_policy_id,p_receipt);
 IF p->>'reviewerId' IS DISTINCT FROM p_actor_user_id::text OR p->>'executionActorId'=p_actor_user_id::text OR p->>'sourceCommitment' IS DISTINCT FROM h OR p->>'customerScopeHash' IS DISTINCT FROM holds THEN RAISE EXCEPTION 'completed_witness_separate_exact_review_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_retention.completed_witness_worker_actor_v1(p_company_id,(p->>'executionActorId')::uuid);
 IF phase_stage='dispose' THEN PERFORM gridex_ediel_retention.completed_witness_payload_terms_v1(p_company_id,p_policy_id,p);
 ELSE
  IF (p->>'W')::timestamptz IS DISTINCT FROM r.replay_until OR (p->>'R')::timestamptz IS DISTINCT FROM r.replay_until OR p->'fields' IS DISTINCT FROM '[]'::jsonb OR p->'replayFields' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'completed_witness_exact_overdue_terminal_scope_required' USING ERRCODE='42501';END IF;
  PERFORM gridex_ediel_retention.completed_witness_terms_v1(jsonb_build_object('executeBefore',p->>'approvalUntil','fields',p->'terminalFields'),ARRAY['replay.company_id','replay.policy_id','replay.replay_until','replay.source_commitment'],'expire',r.replay_until,r.replay_until,clock_timestamp());
 END IF;
 PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(p_company_id,p_actor_user_id,'completed_decision_review_reason');p:=gridex_ediel_retention.completed_witness_receipt_v1(p_company_id,p_policy_id,p_receipt);PERFORM gridex_ediel_retention.completed_witness_approval_terms_v1(p,clock_timestamp());
 INSERT INTO gridex_ediel_retention.completed_witness_phase_authorizations_v1 VALUES(p_company_id,p_policy_id,h,p_receipt,encode(sha256(convert_to(p_receipt::text,'UTF8')),'hex'),p_actor_user_id,clock_timestamp(),phase_stage,(p->>'approvalUntil')::timestamptz);
 RETURN jsonb_build_object('status','approved','authority','none');
END $review$;

CREATE FUNCTION gridex_ediel_retention.completed_witness_execute_v1(c uuid,actor uuid,policy uuid,delegated boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $execute$
DECLARE a gridex_ediel_retention.completed_witness_phase_authorizations_v1%rowtype;d gridex_ediel_retention.decision_evidence_policies%rowtype;t gridex_ediel_retention.decision_evidence_tombstones%rowtype;q gridex_ediel_retention.decision_evidence_reviews%rowtype;r gridex_ediel_retention.completed_witness_replays_v1%rowtype;p jsonb;w timestamptz;until_r timestamptz;at timestamptz;h text;tab text;holds text;BEGIN
 IF delegated THEN PERFORM gridex_ediel_retention.completed_witness_worker_actor_v1(c,actor);ELSE PERFORM gridex_ediel_retention.decision_evidence_actor_v1(c,actor,'completed_decision_review_reason','ediel.retention.purge');END IF;
 SELECT * INTO STRICT a FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1 WHERE company_id=c AND policy_id=policy FOR UPDATE;
 IF encode(sha256(convert_to(a.receipt::text,'UTF8')),'hex') IS DISTINCT FROM a.receipt_hash THEN RAISE EXCEPTION 'completed_witness_stored_receipt_integrity_required' USING ERRCODE='42501';END IF;
 holds:=gridex_ediel_retention.completed_witness_holds_v1(c);p:=gridex_ediel_retention.completed_witness_receipt_v1(c,policy,a.receipt);
 IF p->>'executionActorId' IS DISTINCT FROM actor::text OR p->>'reviewerId' IS DISTINCT FROM a.reviewer_user_id::text OR actor=a.reviewer_user_id OR delegated AND p->>'executionMode' IS DISTINCT FROM 'delegated_worker' OR NOT delegated AND p->>'executionMode' IS DISTINCT FROM 'interactive' OR p->>'sourceCommitment' IS DISTINCT FROM a.source_commitment OR p->>'customerScopeHash' IS DISTINCT FROM holds THEN RAISE EXCEPTION 'completed_witness_exact_execution_delegation_required' USING ERRCODE='42501';END IF;
 IF a.stage='dispose' THEN
  SELECT * INTO STRICT d FROM gridex_ediel_retention.decision_evidence_policies WHERE id=policy AND company_id=c FOR UPDATE;
  SELECT * INTO STRICT t FROM gridex_ediel_retention.decision_evidence_tombstones WHERE policy_id=policy AND company_id=c FOR UPDATE;
  SELECT * INTO STRICT q FROM gridex_ediel_retention.decision_evidence_reviews WHERE id=t.review_id AND policy_id=policy FOR UPDATE;
  PERFORM policy_id FROM gridex_ediel_retention.decision_evidence_revocations WHERE policy_id=policy FOR UPDATE;
  IF d.retention_class<>'completed_decision_review_reason' OR t.retention_class<>d.retention_class OR t.target_id<>d.target_id OR t.source_hash<>d.source_hash OR t.target_metadata_hash<>d.target_metadata_hash OR q.outcome<>'approved' OR q.actor_user_id=d.submitted_by
  OR (SELECT count(*) FROM gridex_ediel_retention.decision_evidence_reviews WHERE policy_id=policy)<>1 OR NOT EXISTS(SELECT FROM gridex_ediel_retention.decision_evidence_revocations WHERE policy_id=policy AND actor_user_id=t.actor_user_id) THEN RAISE EXCEPTION 'completed_witness_exact_completed_leaf_required' USING ERRCODE='42501';END IF;
  h:=gridex_ediel_retention.completed_witness_graph_v1(c,policy);
  IF h IS DISTINCT FROM a.source_commitment OR p->>'customerScopeHash' IS DISTINCT FROM holds OR gridex_ediel_retention.completed_review_reason_scope_v1(c,d.target_id)->>'targetMetadataHash' IS DISTINCT FROM d.target_metadata_hash THEN RAISE EXCEPTION 'completed_witness_current_graph_commitment_required' USING ERRCODE='42501';END IF;
  PERFORM gridex_ediel_retention.completed_witness_route_v1(c,policy);PERFORM gridex_ediel_retention.completed_witness_references_v1(c,policy,d.target_id);
  w:=t.journal_retain_until;until_r:=(p->>'R')::timestamptz;
 ELSE
  SELECT * INTO STRICT r FROM gridex_ediel_retention.completed_witness_replays_v1 WHERE company_id=c AND policy_id=policy FOR UPDATE;
  IF r.source_commitment IS DISTINCT FROM a.source_commitment OR (p->>'R')::timestamptz IS DISTINCT FROM r.replay_until THEN RAISE EXCEPTION 'completed_witness_exact_terminal_scope_required' USING ERRCODE='42501';END IF;
 END IF;
 -- Every wait/reference/issuer/current-authority lock precedes this final time.
 PERFORM gridex_ediel_retention.decision_evidence_lock_reviewer_v1(c,a.reviewer_user_id,'completed_decision_review_reason');
 IF delegated THEN PERFORM gridex_ediel_retention.completed_witness_worker_actor_v1(c,actor);ELSE PERFORM gridex_ediel_retention.decision_evidence_actor_v1(c,actor,'completed_decision_review_reason','ediel.retention.purge');END IF;
 p:=gridex_ediel_retention.completed_witness_receipt_v1(c,policy,a.receipt);PERFORM gridex_ediel_retention.completed_witness_holds_v1(c);at:=clock_timestamp();
 IF at>=a.expires_at THEN RAISE EXCEPTION 'completed_witness_approval_expired' USING ERRCODE='42501';END IF;
 IF a.stage='expire' THEN
  IF at<r.replay_until THEN RETURN gridex_ediel_retention.completed_witness_status_v1(c,actor,policy,delegated);END IF;
  PERFORM gridex_ediel_retention.completed_witness_terms_v1(jsonb_build_object('executeBefore',a.expires_at,'fields',p->'terminalFields'),ARRAY['replay.company_id','replay.policy_id','replay.replay_until','replay.source_commitment'],'expire',r.replay_until,r.replay_until,at);
  DELETE FROM gridex_ediel_retention.completed_witness_replays_v1 WHERE company_id=c AND policy_id=policy;DELETE FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1 WHERE company_id=c AND policy_id=policy;
  RETURN jsonb_build_object('status','expired','authority','none');
 END IF;
 IF at<w OR until_r>w AND at>=until_r THEN RAISE EXCEPTION 'completed_witness_disposition_window_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_retention.completed_witness_terms_v1(jsonb_build_object('executeBefore',a.expires_at,'fields',p->'fields','replayFields',p->'replayFields'),gridex_ediel_retention.completed_witness_fields_v1(c,policy),'dispose',w,until_r,at);
 IF (SELECT reason FROM gridex_ediel_retention.decision_evidence_reviews WHERE id=d.target_id) IS DISTINCT FROM '[Retired retention review reason]' THEN RAISE EXCEPTION 'completed_witness_actual_prior_reason_retirement_required' USING ERRCODE='42501';END IF;
 INSERT INTO gridex_ediel_retention.completed_witness_phase_permits_v1 SELECT pg_backend_pid(),txid_current(),'decision_evidence_reviews',encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex'),'UPDATE',encode(sha256(convert_to((to_jsonb(x)||jsonb_build_object('reason',''))::text,'UTF8')),'hex') FROM gridex_ediel_retention.decision_evidence_reviews x WHERE id=d.target_id;
 UPDATE gridex_ediel_retention.decision_evidence_reviews SET reason='' WHERE id=d.target_id;
 IF until_r>w THEN INSERT INTO gridex_ediel_retention.completed_witness_replays_v1 VALUES(c,policy,a.source_commitment,until_r);END IF;
 FOREACH tab IN ARRAY ARRAY['decision_evidence_tombstones','decision_evidence_reviews','decision_evidence_revocations','decision_evidence_policies'] LOOP
  IF tab='decision_evidence_policies' THEN
   INSERT INTO gridex_ediel_retention.completed_witness_phase_permits_v1 SELECT pg_backend_pid(),txid_current(),tab,encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex'),'DELETE',NULL FROM gridex_ediel_retention.decision_evidence_policies x WHERE id=policy AND company_id=c;
   DELETE FROM gridex_ediel_retention.decision_evidence_policies WHERE id=policy AND company_id=c;
  ELSE
   EXECUTE format('INSERT INTO gridex_ediel_retention.completed_witness_phase_permits_v1 SELECT pg_backend_pid(),txid_current(),$1,encode(sha256(convert_to(to_jsonb(x)::text,''UTF8'')),''hex''),''DELETE'',NULL FROM gridex_ediel_retention.%I x WHERE policy_id=$2',tab) USING tab,policy;
   EXECUTE format('DELETE FROM gridex_ediel_retention.%I WHERE policy_id=$1',tab) USING policy;
  END IF;
 END LOOP;
 IF EXISTS(SELECT FROM gridex_ediel_retention.completed_witness_phase_permits_v1 WHERE backend=pg_backend_pid() AND xid=txid_current()) THEN RAISE EXCEPTION 'completed_witness_unconsumed_permit';END IF;
 IF until_r=w THEN DELETE FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1 WHERE company_id=c AND policy_id=policy;ELSE UPDATE gridex_ediel_retention.completed_witness_phase_authorizations_v1 SET stage='expire' WHERE company_id=c AND policy_id=policy;END IF;
 RETURN jsonb_build_object('status','disposed','replay',false,'authority','none');
END $execute$;

CREATE FUNCTION gridex_ediel_retention.completed_witness_status_v1(c uuid,actor uuid,policy uuid,delegated boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $status$
DECLARE r gridex_ediel_retention.completed_witness_replays_v1%rowtype;BEGIN
 IF delegated THEN PERFORM gridex_ediel_retention.completed_witness_worker_actor_v1(c,actor);ELSE PERFORM gridex_ediel_retention.decision_evidence_actor_v1(c,actor,'completed_decision_review_reason','ediel.retention.purge');END IF;
 SELECT * INTO r FROM gridex_ediel_retention.completed_witness_replays_v1 WHERE company_id=c AND policy_id=policy FOR SHARE;
 IF NOT FOUND OR clock_timestamp()>=r.replay_until THEN RETURN jsonb_build_object('status','unavailable','authority','none');END IF;
 RETURN jsonb_build_object('status','disposed','replay',true,'authority','none');
END $status$;

CREATE FUNCTION gridex_ediel_retention.completed_witness_dispatch_v1(c uuid,actor uuid,policy uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $dispatch$
DECLARE d gridex_ediel_retention.decision_evidence_policies%rowtype;t gridex_ediel_retention.decision_evidence_tombstones%rowtype;b jsonb;result jsonb;BEGIN
 IF EXISTS(SELECT FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1 WHERE company_id=c AND policy_id=policy) THEN
  PERFORM gridex_ediel_retention.decision_evidence_actor_v1(c,actor,'completed_decision_review_reason','ediel.retention.purge');
  BEGIN RETURN gridex_ediel_retention.completed_witness_execute_v1(c,actor,policy);EXCEPTION WHEN insufficient_privilege THEN
   IF EXISTS(SELECT FROM gridex_ediel_retention.completed_witness_replays_v1 WHERE company_id=c AND policy_id=policy) THEN RETURN gridex_ediel_retention.completed_witness_status_v1(c,actor,policy);END IF;
   RETURN jsonb_build_object('status','held','policyId',policy,'missing',ARRAY['current_qualified_leaf_disposition']);END;
 END IF;
 SELECT * INTO d FROM gridex_ediel_retention.decision_evidence_policies WHERE id=policy AND company_id=c FOR UPDATE;
 IF NOT FOUND THEN RETURN gridex_ediel_retention.completed_witness_status_v1(c,actor,policy);END IF;
 IF d.retention_class<>'completed_decision_review_reason' THEN RETURN NULL;END IF;
 SELECT * INTO t FROM gridex_ediel_retention.decision_evidence_tombstones WHERE retention_class=d.retention_class AND target_id=d.target_id FOR SHARE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF t.policy_id IS DISTINCT FROM d.id OR t.company_id IS DISTINCT FROM c OR t.source_hash IS DISTINCT FROM d.source_hash OR t.target_metadata_hash IS DISTINCT FROM d.target_metadata_hash THEN RAISE EXCEPTION 'decision_original_purge_replay_conflict';END IF;
 b:=gridex_ediel_retention.completed_review_reason_scope_v1(c,d.target_id);
 IF b->>'targetMetadataHash' IS DISTINCT FROM t.target_metadata_hash THEN RAISE EXCEPTION 'completed_witness_legacy_scope_conflict' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_retention.decision_evidence_actor_v1(c,actor,d.retention_class,'ediel.retention.purge');
 IF clock_timestamp()<t.journal_retain_until THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('status','purged','replay',true,'authority','none');
END $dispatch$;

-- One bounded existing-cron adapter; no fake session, actor or new producer.
CREATE FUNCTION public.ediel_advance_completed_witness_disposition_v1(p_actor_user_id uuid,p_limit integer DEFAULT 20) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $worker$
DECLARE a record;result jsonb;p jsonb;scanned integer:=0;disposed integer:=0;expired integer:=0;cleared integer:=0;held integer:=0;removed integer;BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'completed_witness_bounded_worker_required';END IF;
 -- Graphlocks precede each company advisorylock, matching interactive entrypoints.
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 -- Discovery only: all authority, routing, holds and time are rechecked under
 -- locks before effects. Known holds/future commands do not consume the prefix.
 -- Expired operation-authority state remains eligible even with customer holds.
 FOR a IN
  SELECT q.company_id,q.policy_id FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1 q
  CROSS JOIN LATERAL (SELECT convert_from(decode(q.receipt->>'payloadBase64','base64'),'UTF8')::jsonb payload) signed
  WHERE q.expires_at<=clock_timestamp() OR (
   signed.payload->>'executionMode'='delegated_worker' AND signed.payload->>'executionActorId'=p_actor_user_id::text
   AND (q.stage='dispose' AND (signed.payload->>'W')::timestamptz<=clock_timestamp()
    OR q.stage='expire' AND EXISTS(SELECT FROM gridex_ediel_retention.completed_witness_replays_v1 r WHERE r.company_id=q.company_id AND r.policy_id=q.policy_id AND r.replay_until<=clock_timestamp()))
   AND NOT EXISTS(SELECT FROM public.customers h WHERE h.company_id=q.company_id AND h.legal_hold))
  ORDER BY q.expires_at,q.company_id,q.policy_id LIMIT p_limit LOOP
  scanned:=scanned+1;
  BEGIN
   -- Earlier batch scopes may retain mutation table locks. Never wait on
   -- another company command that can itself be waiting on those locks.
   IF pg_try_advisory_xact_lock(hashtextextended('gridex:retention:decision-original:'||a.company_id::text,0)) IS NOT TRUE THEN held:=held+1;CONTINUE;END IF;
   PERFORM gridex_ediel_retention.decision_evidence_lock_v1(a.company_id);
   PERFORM gridex_ediel_retention.completed_witness_worker_actor_v1(a.company_id,p_actor_user_id);
   SELECT convert_from(decode(receipt->>'payloadBase64','base64'),'UTF8')::jsonb INTO STRICT p FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1 WHERE company_id=a.company_id AND policy_id=a.policy_id FOR UPDATE;
   IF EXISTS(SELECT FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1 WHERE company_id=a.company_id AND policy_id=a.policy_id AND expires_at<=clock_timestamp()) THEN
    -- Consumed/expired operation-authority state is not physical effect. Its signed finite storage
    -- end cannot be prolonged by issuing an automatic recursive approval.
    DELETE FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1 WHERE company_id=a.company_id AND policy_id=a.policy_id AND receipt_hash=encode(sha256(convert_to(receipt::text,'UTF8')),'hex') AND expires_at=(p->>'approvalUntil')::timestamptz;
    GET DIAGNOSTICS removed=ROW_COUNT;cleared:=cleared+removed;CONTINUE;
   END IF;
   result:=gridex_ediel_retention.completed_witness_execute_v1(a.company_id,p_actor_user_id,a.policy_id,true);
   IF result->>'status'='disposed' AND result->>'replay'='false' THEN disposed:=disposed+1;ELSIF result->>'status'='expired' THEN expired:=expired+1;END IF;
  EXCEPTION WHEN insufficient_privilege OR lock_not_available OR no_data_found THEN held:=held+1;
  END;
 END LOOP;
 RETURN jsonb_build_object('scanned',scanned,'disposed',disposed,'expired',expired,'clearedApprovals',cleared,'held',held,'authority','none');
END $worker$;
DO $forward$
DECLARE spec jsonb;change jsonb;f record;after_row jsonb;body text;before_metadata jsonb;
 specs constant jsonb := $specs$[{"name":"gridex_ediel_retention.completed_review_reason_basis_v1","before":"4dd38a83b64873bd4126a627ebadfeada3aa323fcf7d2ad97e7b43027dee0a57","after":"766c49ea981677e5c3ef19009a08997e4f920bb7187de888874003f999eef032","changes":[{"old":" b:=gridex_ediel_retention.completed_review_reason_scope_v1(c,target);","new":" b:=gridex_ediel_retention.completed_review_reason_scope_v1(c,target);\n IF (b->>'byteLength')::bigint=0 THEN RAISE EXCEPTION 'completed_review_reason_disposition_ended' USING ERRCODE='42501';END IF;","count":1}]},{"name":"gridex_ediel_retention.completed_review_reason_read_v1","before":"c1b61c6bbe84ad4554af9bd143c1bd0e944d01a5725e5d2c5cbd5f417cd7f80c","after":"66de62b4bbdd3e69ea70be31fd7d8050277112e7095cfc148125fe7e648fb47c","changes":[{"old":" b:=gridex_ediel_retention.completed_review_reason_scope_v1(c,target);","new":" b:=gridex_ediel_retention.completed_review_reason_scope_v1(c,target);\n IF (b->>'byteLength')::bigint=0 THEN RAISE EXCEPTION 'completed_review_reason_disposition_ended' USING ERRCODE='42501';END IF;","count":1}]},{"name":"public.ediel_purge_decision_evidence_retention_v1","before":"30ae0d48b6adefe9cb4eacb5253b8b38b0fa7f29faacb7d417777d0820872e12","after":"2955596190537241aea6c4b083bea67829e84a1f93a34de9c35c945b55e43785","changes":[{"old":" PERFORM gridex_ediel_retention.decision_evidence_lock_v1(p_company_id);","new":" PERFORM gridex_ediel_retention.decision_evidence_lock_v1(p_company_id);\n p:=gridex_ediel_retention.completed_witness_dispatch_v1(p_company_id,p_actor_user_id,p_policy_id);IF p IS NOT NULL THEN RETURN p;END IF;","count":1}]}]$specs$::jsonb;
BEGIN
 FOR spec IN SELECT value FROM jsonb_array_elements(specs) LOOP
  SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata INTO STRICT f
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=split_part(spec->>'name','.',1) AND p.proname=split_part(spec->>'name','.',2);
  IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM spec->>'before' THEN RAISE EXCEPTION 'completed_review_witness_predecessor_changed:%',spec->>'name';END IF;
  body:=f.prosrc;before_metadata:=f.metadata;
  FOR change IN SELECT value FROM jsonb_array_elements(spec->'changes') LOOP
   IF (length(body)-length(replace(body,change->>'old','')))/length(change->>'old')<>(change->>'count')::int THEN RAISE EXCEPTION 'completed_review_witness_anchor_changed:%',spec->>'name';END IF;
   body:=replace(body,change->>'old',change->>'new');
  END LOOP;
  IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM spec->>'after' THEN RAISE EXCEPTION 'completed_review_witness_output_changed:%',spec->>'name';END IF;
  EXECUTE replace(f.definition,f.prosrc,body);
  SELECT to_jsonb(p)-'prosrc' INTO STRICT after_row FROM pg_proc p WHERE p.oid=f.oid;
  IF after_row IS DISTINCT FROM before_metadata THEN RAISE EXCEPTION 'completed_review_witness_function_metadata_changed:%',spec->>'name';END IF;
 END LOOP;
END $forward$;
DO $install$
DECLARE t record;tab text;expected regprocedure;name text;BEGIN
 FOREACH tab IN ARRAY ARRAY['decision_evidence_policies','decision_evidence_reviews','decision_evidence_revocations','decision_evidence_tombstones'] LOOP
  expected:=CASE tab WHEN 'decision_evidence_policies' THEN 'gridex_ediel_retention.decision_evidence_policies_original_guard_v1()'::regprocedure WHEN 'decision_evidence_reviews' THEN 'gridex_ediel_retention.completed_review_reason_guard_v1()'::regprocedure ELSE 'gridex_received_sources.reject_mutation()'::regprocedure END;
  SELECT x.oid,x.tgenabled,pg_get_triggerdef(x.oid) definition INTO STRICT t FROM pg_trigger x WHERE x.tgrelid=('gridex_ediel_retention.'||tab)::regclass AND x.tgname='immutable' AND x.tgfoid=expected AND NOT x.tgisinternal;
  IF t.tgenabled NOT IN('O','A') THEN RAISE EXCEPTION 'completed_witness_enabled_predecessor_required';END IF;
  EXECUTE format('DROP TRIGGER immutable ON gridex_ediel_retention.%I',tab);
  EXECUTE regexp_replace(t.definition,'EXECUTE (FUNCTION|PROCEDURE) .*$','EXECUTE FUNCTION gridex_ediel_retention.completed_witness_guard_v1()');
  IF t.tgenabled='A' THEN EXECUTE format('ALTER TABLE gridex_ediel_retention.%I ENABLE ALWAYS TRIGGER immutable',tab);END IF;
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['completed_witness_phase_authorizations_v1','completed_witness_replays_v1','completed_witness_phase_permits_v1'] LOOP
  EXECUTE format('ALTER TABLE gridex_ediel_retention.%I OWNER TO gridex_ediel_retention_owner',tab);
  EXECUTE format('ALTER TABLE gridex_ediel_retention.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE gridex_ediel_retention.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON TABLE gridex_ediel_retention.%I FROM PUBLIC,anon,authenticated,service_role',tab);
 END LOOP;
 FOR name IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_retention' AND p.proname LIKE 'completed_witness_%' OR n.nspname='public' AND p.proname IN('ediel_review_completed_witness_disposition_v1','ediel_advance_completed_witness_disposition_v1') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO gridex_ediel_retention_owner',name);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',name);
 END LOOP;
END $install$;
GRANT DELETE ON gridex_ediel_retention.decision_evidence_policies,gridex_ediel_retention.decision_evidence_reviews,gridex_ediel_retention.decision_evidence_revocations,gridex_ediel_retention.decision_evidence_tombstones TO gridex_ediel_retention_owner;
GRANT EXECUTE ON FUNCTION public.ediel_review_completed_witness_disposition_v1(uuid,uuid,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_advance_completed_witness_disposition_v1(uuid,integer) TO service_role;
-- Existing permission_v1/catalog and all W-reader ACL/owner/security stay exact.
COMMIT;
