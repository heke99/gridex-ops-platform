-- TR-10 / SYS ST-T04: automatic technical tracking of entered uncertain SMTP.
-- No customer/business case, guessed delivery, reset, resend or caller resolution.
BEGIN;
CREATE TABLE gridex_ediel_transport.reconciliation_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 environment text NOT NULL CHECK(environment IN ('test','production')),
 lane text NOT NULL CHECK(lane IN ('generic_journal','sealed_z08')),
 attempt_id uuid NOT NULL, message_id uuid NOT NULL REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 original_hash text NOT NULL CHECK(original_hash ~ '^[a-f0-9]{64}$'),
 binding_hash text NOT NULL CHECK(binding_hash ~ '^[a-f0-9]{64}$'),
 mime_sha256 text NOT NULL CHECK(mime_sha256 ~ '^[a-f0-9]{64}$'),
 mime_length bigint NOT NULL CHECK(mime_length>0),
 mime_archive_ref text NOT NULL CHECK(length(mime_archive_ref)>0),
 mime_payload_snapshot_id uuid NOT NULL,
 rfc_message_id text NOT NULL CHECK(length(rfc_message_id)>0),
 entered_at timestamptz NOT NULL, opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL CHECK(reason IN ('provider_outcome_unknown','entry_unresolved_after_lease')),
 UNIQUE(company_id,environment,lane,attempt_id)
);
CREATE INDEX ediel_reconciliation_case_scope_idx ON gridex_ediel_transport.reconciliation_cases(company_id,environment,message_id,opened_at,id);
CREATE TABLE gridex_ediel_transport.reconciliation_case_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL UNIQUE REFERENCES gridex_ediel_transport.reconciliation_cases(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 environment text NOT NULL CHECK(environment IN ('test','production')),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind='opened'),
 origin text NOT NULL CHECK(origin IN ('generic_observation','sealed_result','worker_claim_uncertain')),
 origin_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE gridex_ediel_transport.reconciliation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_transport.reconciliation_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_transport.reconciliation_case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_transport.reconciliation_case_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ediel_transport.reconciliation_cases,gridex_ediel_transport.reconciliation_case_events FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_ediel_transport.reconciliation_append_only_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'ediel_reconciliation_append_only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER ediel_reconciliation_cases_immutable BEFORE UPDATE OR DELETE ON gridex_ediel_transport.reconciliation_cases FOR EACH ROW EXECUTE FUNCTION gridex_ediel_transport.reconciliation_append_only_v1();
CREATE TRIGGER ediel_reconciliation_cases_no_truncate BEFORE TRUNCATE ON gridex_ediel_transport.reconciliation_cases FOR EACH STATEMENT EXECUTE FUNCTION gridex_ediel_transport.reconciliation_append_only_v1();
CREATE TRIGGER ediel_reconciliation_events_immutable BEFORE UPDATE OR DELETE ON gridex_ediel_transport.reconciliation_case_events FOR EACH ROW EXECUTE FUNCTION gridex_ediel_transport.reconciliation_append_only_v1();
CREATE TRIGGER ediel_reconciliation_events_no_truncate BEFORE TRUNCATE ON gridex_ediel_transport.reconciliation_case_events FOR EACH STATEMENT EXECUTE FUNCTION gridex_ediel_transport.reconciliation_append_only_v1();

-- Private derivation; only the qualified owner triggers below invoke it.
CREATE FUNCTION gridex_ediel_transport.open_reconciliation_case_v1(p_lane text,p_attempt_id uuid,p_reason text,p_origin text,p_origin_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a record; m public.ediel_messages%rowtype; snapshot_id uuid; n bigint; old_case gridex_ediel_transport.reconciliation_cases%rowtype; case_id uuid; bh text;
BEGIN
 IF p_lane='generic_journal' THEN
  SELECT x.id,x.company_id,x.environment,x.message_id,x.actor_user_id,x.binding,x.entered_at INTO STRICT a
   FROM gridex_ediel_transport.attempts x JOIN gridex_ediel_transport.reservations r ON r.message_id=x.message_id AND r.attempt_id=x.id AND r.state IN ('entered','observed')
   WHERE x.id=p_attempt_id AND x.entered_at IS NOT NULL;
 ELSIF p_lane='sealed_z08' THEN
  SELECT x.id,x.company_id,x.environment,x.message_id,x.actor_user_id,x.binding,e.observed_at entered_at INTO STRICT a
   FROM gridex_outbound_dispatch.attempts x
   JOIN gridex_outbound_dispatch.originals o ON o.message_id=x.message_id AND o.company_id=x.company_id AND o.environment=x.environment AND o.payload_hash=x.binding->>'originalHash' AND o.payload_hash=encode(sha256(convert_to(o.raw_payload,'UTF8')),'hex')
   JOIN gridex_outbound_dispatch.reservations r ON r.message_id=x.message_id AND r.attempt_id=x.id AND r.state='provider_call_entered'
   JOIN gridex_outbound_dispatch.events e ON e.attempt_id=x.id AND e.message_id=x.message_id AND e.company_id=x.company_id AND e.environment=x.environment AND e.kind='provider_call_entered'
   JOIN gridex_outbound_dispatch.witnesses w ON w.event_id=e.id AND w.company_id=e.company_id AND w.environment=e.environment
   WHERE x.id=p_attempt_id AND e.created_xid<>pg_current_xact_id() AND w.created_xid<>pg_current_xact_id()
    AND pg_visible_in_snapshot(e.created_xid,pg_current_snapshot()) AND pg_visible_in_snapshot(w.created_xid,pg_current_snapshot());
 ELSE RAISE EXCEPTION 'ediel_reconciliation_lane_invalid'; END IF;
 IF p_reason='provider_outcome_unknown' THEN
  IF p_lane='generic_journal' THEN
   IF p_origin IS DISTINCT FROM 'generic_observation' OR p_origin_id IS DISTINCT FROM a.id OR NOT EXISTS(SELECT FROM gridex_ediel_transport.attempts x WHERE x.id=a.id AND x.observed_at IS NOT NULL AND x.classification='unknown' AND jsonb_typeof(x.provider_result)='object')
   THEN RAISE EXCEPTION 'ediel_reconciliation_observation_binding_invalid'; END IF;
  ELSE
   IF p_origin IS DISTINCT FROM 'sealed_result' OR NOT EXISTS(SELECT FROM gridex_outbound_dispatch.events e WHERE e.id=p_origin_id AND e.attempt_id=a.id AND e.message_id=a.message_id AND e.company_id=a.company_id AND e.environment=a.environment AND e.kind='provider_result' AND e.facts->>'classification'='uncertain' AND jsonb_typeof(e.facts->'provider')='object' AND e.facts->>'automaticResend'='false')
   THEN RAISE EXCEPTION 'ediel_reconciliation_observation_binding_invalid'; END IF;
  END IF;
 ELSIF p_reason='entry_unresolved_after_lease' THEN
  IF p_origin IS DISTINCT FROM 'worker_claim_uncertain'
   OR NOT EXISTS(SELECT FROM public.ediel_outbox o WHERE o.id=p_origin_id AND o.company_id=a.company_id AND o.environment=a.environment AND o.ediel_message_id=a.message_id AND o.status='delivery_uncertain')
   OR p_lane='generic_journal' AND EXISTS(SELECT FROM gridex_ediel_transport.attempts x WHERE x.id=a.id AND x.observed_at IS NOT NULL)
   OR p_lane='sealed_z08' AND EXISTS(SELECT FROM gridex_outbound_dispatch.events e WHERE e.attempt_id=a.id AND e.kind='provider_result')
  THEN RAISE EXCEPTION 'ediel_reconciliation_unresolved_binding_invalid'; END IF;
 ELSE RAISE EXCEPTION 'ediel_reconciliation_reason_invalid'; END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=a.message_id AND company_id=a.company_id AND environment=a.environment FOR SHARE;
 IF m.direction IS DISTINCT FROM 'outbound' OR m.immutable_rendered_at IS NULL OR m.raw_payload IS NULL
  OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR a.binding->>'originalHash' IS DISTINCT FROM m.immutable_payload_hash
  OR coalesce(a.binding->>'mimeSha256','') !~ '^[a-f0-9]{64}$' OR coalesce(a.binding->>'mimeLength','') !~ '^[1-9][0-9]*$'
  OR nullif(a.binding->>'mimeArchiveRef','') IS NULL OR nullif(a.binding->>'rfcMessageId','') IS NULL
 THEN RAISE EXCEPTION 'ediel_reconciliation_original_binding_invalid'; END IF;
 bh:=encode(sha256(convert_to(a.binding::text,'UTF8')),'hex');
 SELECT * INTO old_case FROM gridex_ediel_transport.reconciliation_cases WHERE company_id=a.company_id AND environment=a.environment AND lane=p_lane AND attempt_id=a.id;
 IF FOUND THEN
  IF old_case.message_id IS DISTINCT FROM a.message_id OR old_case.actor_user_id IS DISTINCT FROM a.actor_user_id OR old_case.binding_hash IS DISTINCT FROM bh OR old_case.entered_at IS DISTINCT FROM a.entered_at
  THEN RAISE EXCEPTION 'ediel_reconciliation_case_binding_changed'; END IF;
  RETURN old_case.id;
 END IF;
 -- Lock the exact retained archive metadata, without copying bytes or addresses.
 PERFORM 1 FROM public.ediel_message_payloads p WHERE p.company_id=a.company_id AND p.ediel_message_id=a.message_id AND p.encrypted_payload_ref=a.binding->>'mimeArchiveRef' FOR SHARE;
 SELECT count(*),(array_agg(p.id))[1] INTO n,snapshot_id FROM public.ediel_message_payloads p
  WHERE p.company_id=a.company_id AND p.ediel_message_id=a.message_id AND p.encrypted_payload_ref=a.binding->>'mimeArchiveRef'
   AND p.payload_kind IN ('raw_mime','smime_enveloped') AND p.metadata->>'archive_verified'='true'
   AND p.metadata->>'archived_mime_sha256'=a.binding->>'mimeSha256' AND p.metadata->>'archived_mime_bytes'=a.binding->>'mimeLength'
   AND p.metadata->>'archived_rfc_message_id'=a.binding->>'rfcMessageId';
 IF n<>1 THEN RAISE EXCEPTION 'ediel_reconciliation_archive_binding_not_qualified'; END IF;
 INSERT INTO gridex_ediel_transport.reconciliation_cases(company_id,environment,lane,attempt_id,message_id,actor_user_id,original_hash,binding_hash,mime_sha256,mime_length,mime_archive_ref,mime_payload_snapshot_id,rfc_message_id,entered_at,reason)
 VALUES(a.company_id,a.environment,p_lane,a.id,a.message_id,a.actor_user_id,m.immutable_payload_hash,bh,a.binding->>'mimeSha256',(a.binding->>'mimeLength')::bigint,a.binding->>'mimeArchiveRef',snapshot_id,a.binding->>'rfcMessageId',a.entered_at,p_reason) RETURNING id INTO case_id;
 INSERT INTO gridex_ediel_transport.reconciliation_case_events(case_id,company_id,environment,actor_user_id,kind,origin,origin_id)
 VALUES(case_id,a.company_id,a.environment,a.actor_user_id,'opened',p_origin,p_origin_id);
 RETURN case_id;
END $$;

CREATE FUNCTION gridex_ediel_transport.reconciliation_observed_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_SCHEMA='gridex_ediel_transport' AND TG_TABLE_NAME='attempts' AND TG_OP='UPDATE' THEN
  IF OLD.observed_at IS NULL AND NEW.observed_at IS NOT NULL AND NEW.classification='unknown' AND NEW.entered_at IS NOT NULL THEN
   PERFORM gridex_ediel_transport.open_reconciliation_case_v1('generic_journal',NEW.id,'provider_outcome_unknown','generic_observation',NEW.id);
  END IF;
 ELSIF TG_TABLE_SCHEMA='gridex_outbound_dispatch' AND TG_TABLE_NAME='events' AND TG_OP='INSERT' THEN
  IF NEW.kind='provider_result' AND NEW.facts->>'classification'='uncertain' THEN
   -- Result witness can only be made after commit; require the committed ENTRY witness.
   PERFORM gridex_ediel_transport.open_reconciliation_case_v1('sealed_z08',NEW.attempt_id,'provider_outcome_unknown','sealed_result',NEW.id);
  END IF;
 ELSE RAISE EXCEPTION 'ediel_reconciliation_observation_origin_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ediel_reconciliation_generic_observed AFTER UPDATE ON gridex_ediel_transport.attempts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_transport.reconciliation_observed_v1();
CREATE TRIGGER ediel_reconciliation_sealed_result AFTER INSERT ON gridex_outbound_dispatch.events FOR EACH ROW EXECUTE FUNCTION gridex_ediel_transport.reconciliation_observed_v1();

CREATE FUNCTION gridex_ediel_transport.reconciliation_worker_uncertain_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a record;
BEGIN
 IF OLD.status IS DISTINCT FROM 'sending' OR NEW.status IS DISTINCT FROM 'delivery_uncertain' OR OLD.current_send_attempt_id IS NULL OR OLD.locked_at IS NULL OR nullif(OLD.locked_by,'') IS NULL
  OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.environment IS DISTINCT FROM OLD.environment OR NEW.ediel_message_id IS DISTINCT FROM OLD.ediel_message_id OR NEW.current_send_attempt_id IS DISTINCT FROM OLD.current_send_attempt_id
 THEN RETURN NEW; END IF;
 -- The prior real claim, not a caller boolean, must own an unresolved entry.
 FOR a IN
  SELECT x.id,'generic_journal'::text lane FROM gridex_ediel_transport.attempts x
   JOIN gridex_ediel_transport.reservations r ON r.message_id=x.message_id AND r.attempt_id=x.id AND r.state='entered'
   WHERE x.company_id=OLD.company_id AND x.environment=OLD.environment AND x.message_id=OLD.ediel_message_id AND x.entered_at IS NOT NULL AND x.observed_at IS NULL
    AND x.owner->>'kind'='worker' AND x.owner->>'outboxId'=OLD.id::text AND x.owner->>'sendAttemptId'=OLD.current_send_attempt_id::text AND x.owner->>'workerId'=OLD.locked_by
  UNION ALL
  SELECT x.id,'sealed_z08' FROM gridex_outbound_dispatch.attempts x
   JOIN gridex_outbound_dispatch.reservations r ON r.message_id=x.message_id AND r.attempt_id=x.id AND r.state='provider_call_entered'
   WHERE x.company_id=OLD.company_id AND x.environment=OLD.environment AND x.message_id=OLD.ediel_message_id
    AND x.owner->>'kind'='worker' AND x.owner->>'outboxId'=OLD.id::text AND x.owner->>'sendAttemptId'=OLD.current_send_attempt_id::text AND x.owner->>'workerId'=OLD.locked_by
    AND EXISTS(SELECT FROM gridex_outbound_dispatch.events e WHERE e.attempt_id=x.id AND e.message_id=x.message_id AND e.company_id=x.company_id AND e.environment=x.environment AND e.kind='provider_call_entered')
    AND NOT EXISTS(SELECT FROM gridex_outbound_dispatch.events e WHERE e.attempt_id=x.id AND e.message_id=x.message_id AND e.company_id=x.company_id AND e.environment=x.environment AND e.kind='provider_result')
 LOOP
  PERFORM gridex_ediel_transport.open_reconciliation_case_v1(a.lane,a.id,'entry_unresolved_after_lease','worker_claim_uncertain',OLD.id);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER ediel_reconciliation_worker_uncertain AFTER UPDATE OF status ON public.ediel_outbox FOR EACH ROW EXECUTE FUNCTION gridex_ediel_transport.reconciliation_worker_uncertain_v1();

-- Private bounded projection; the existing public RPC first locks and authorizes.
-- An opening remains immutable. Current outcome is derived only from the same
-- private observed attempt or a committed sealed result and its witness.
CREATE FUNCTION gridex_ediel_transport.read_reconciliation_cases_v1(p_company_id uuid,p_environment text,p_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF (SELECT count(*) FROM gridex_ediel_transport.reconciliation_cases WHERE company_id=p_company_id AND environment=p_environment AND message_id=p_message_id)>50
 THEN RAISE EXCEPTION 'ediel_reconciliation_case_scope_overflow'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('caseId',c.id,'companyId',c.company_id,'environment',c.environment,'messageId',c.message_id,'lane',c.lane,'attemptId',c.attempt_id,'originalHash',c.original_hash,'mimeSha256',c.mime_sha256,'enteredAt',c.entered_at,'openedAt',c.opened_at,'reason',c.reason,
  'status',CASE WHEN coalesce(g.classification,s.classification) IN ('accepted','partial','all_rejected','explicit_negative','pre_connect_negative') THEN 'outcome_observed' ELSE 'needs_tracking' END,
  'observedClassification',coalesce(g.classification,s.classification),'observedAt',coalesce(g.observed_at,s.observed_at),'authorizesResend',false,'deliveryProven',false) ORDER BY c.opened_at,c.id),'[]'::jsonb) INTO result
 FROM gridex_ediel_transport.reconciliation_cases c
 LEFT JOIN gridex_ediel_transport.attempts g ON c.lane='generic_journal' AND g.id=c.attempt_id AND g.company_id=c.company_id AND g.environment=c.environment AND g.message_id=c.message_id AND g.entered_at=c.entered_at AND encode(sha256(convert_to(g.binding::text,'UTF8')),'hex')=c.binding_hash
 LEFT JOIN LATERAL (
  SELECT e.facts->>'classification' classification,e.observed_at FROM gridex_outbound_dispatch.attempts a
  JOIN gridex_outbound_dispatch.events e ON e.attempt_id=a.id AND e.message_id=a.message_id AND e.company_id=a.company_id AND e.environment=a.environment AND e.kind='provider_result'
  JOIN gridex_outbound_dispatch.witnesses w ON w.event_id=e.id AND w.company_id=e.company_id AND w.environment=e.environment
  WHERE c.lane='sealed_z08' AND a.id=c.attempt_id AND a.company_id=c.company_id AND a.environment=c.environment AND a.message_id=c.message_id
   AND encode(sha256(convert_to(a.binding::text,'UTF8')),'hex')=c.binding_hash AND e.created_xid<>pg_current_xact_id() AND w.created_xid<>pg_current_xact_id()
   AND pg_visible_in_snapshot(e.created_xid,pg_current_snapshot()) AND pg_visible_in_snapshot(w.created_xid,pg_current_snapshot())
 ) s ON true
 WHERE c.company_id=p_company_id AND c.environment=p_environment AND c.message_id=p_message_id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.reconciliation_append_only_v1(),gridex_ediel_transport.open_reconciliation_case_v1(text,uuid,text,text,uuid),gridex_ediel_transport.reconciliation_observed_v1(),gridex_ediel_transport.reconciliation_worker_uncertain_v1(),gridex_ediel_transport.read_reconciliation_cases_v1(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Guard exact reviewed fragments; preserve OID/signature/owner/ACL/defaults/settings.
DO $copy$
DECLARE f record; body text; old_return text:='''authorizesResend'',false,''deliveryProven'',false);'; old_auth text:=' IF NOT EXISTS(SELECT FROM public.company_memberships'; actual jsonb;
BEGIN
 SELECT * INTO STRICT f FROM pg_proc WHERE oid='public.gridex_ediel_transport_copy_v1(uuid,uuid,uuid)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,old_return,'')))<>length(old_return)
  OR (length(f.prosrc)-length(replace(f.prosrc,old_auth,'')))<>length(old_auth)
  OR strpos(f.prosrc,'reconciliationCases')>0
 THEN RAISE EXCEPTION 'ediel_reconciliation_copy_body_review_required'; END IF;
 body:=replace(f.prosrc,old_auth,' PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();'||chr(10)||old_auth);
 body:=replace(body,old_return,'''authorizesResend'',false,''deliveryProven'',false,''reconciliationCases'',gridex_ediel_transport.read_reconciliation_cases_v1(m.company_id,m.environment,m.id));');
 EXECUTE replace(pg_get_functiondef(f.oid),f.prosrc,body);
 SELECT to_jsonb(p)-'prosrc' INTO actual FROM pg_proc p WHERE p.oid=f.oid;
 IF actual IS DISTINCT FROM to_jsonb(f)-'prosrc' THEN RAISE EXCEPTION 'ediel_reconciliation_copy_authority_changed'; END IF;
END $copy$;
COMMIT;
