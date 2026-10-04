-- TR05 prospective recovery. A timeout, mutable status or unverified DSN is
-- never authority. Existing attempt, ACK and business outcomes stay immutable.
BEGIN;
CREATE TABLE gridex_received_sources.prodat_recovery_operations (
 id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN ('test','production')),
 original_message_id uuid NOT NULL REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,original_payload_hash text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('verified_transfer_loss','contrl_correction','aperak_correction')),
 source_ack_message_id uuid REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,source_ack_hash text,
 previous_attempt_id uuid REFERENCES gridex_ediel_transport.attempts(id) ON DELETE RESTRICT,
 corrected_payload_hash text,corrected_raw_payload text,actor_user_id uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='verified_transfer_loss' AND previous_attempt_id IS NOT NULL AND source_ack_message_id IS NULL AND corrected_raw_payload IS NULL) OR (kind IN ('contrl_correction','aperak_correction') AND previous_attempt_id IS NULL AND source_ack_message_id IS NOT NULL AND corrected_payload_hash IS NOT NULL AND corrected_raw_payload IS NOT NULL))
);
CREATE UNIQUE INDEX prodat_recovery_attempt_unique ON gridex_received_sources.prodat_recovery_operations(previous_attempt_id) WHERE kind='verified_transfer_loss';
CREATE UNIQUE INDEX prodat_recovery_correction_unique ON gridex_received_sources.prodat_recovery_operations(original_message_id,source_ack_message_id,corrected_payload_hash) WHERE kind IN ('contrl_correction','aperak_correction');
CREATE TABLE gridex_received_sources.prodat_recovery_messages(operation_id uuid PRIMARY KEY REFERENCES gridex_received_sources.prodat_recovery_operations(id),message_id uuid UNIQUE NOT NULL REFERENCES public.ediel_messages(id) ON DELETE RESTRICT);
CREATE TABLE gridex_received_sources.prodat_recovery_attempts(operation_id uuid PRIMARY KEY REFERENCES gridex_received_sources.prodat_recovery_operations(id),attempt_id uuid UNIQUE NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE gridex_received_sources.prodat_recovery_outboxes(operation_id uuid PRIMARY KEY REFERENCES gridex_received_sources.prodat_recovery_operations(id),outbox_id uuid UNIQUE NOT NULL REFERENCES public.ediel_outbox(id) ON DELETE RESTRICT,actor_user_id uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE gridex_received_sources.prodat_recovery_outboxes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.prodat_recovery_outboxes FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER prodat_recovery_outbox_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.prodat_recovery_outboxes FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER prodat_recovery_outbox_no_truncate BEFORE TRUNCATE ON gridex_received_sources.prodat_recovery_outboxes FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
ALTER TABLE gridex_received_sources.prodat_recovery_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.prodat_recovery_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.prodat_recovery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.prodat_recovery_operations,gridex_received_sources.prodat_recovery_messages,gridex_received_sources.prodat_recovery_attempts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER prodat_recovery_operation_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.prodat_recovery_operations FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER prodat_recovery_operation_no_truncate BEFORE TRUNCATE ON gridex_received_sources.prodat_recovery_operations FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER prodat_recovery_message_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.prodat_recovery_messages FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER prodat_recovery_attempt_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.prodat_recovery_attempts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER prodat_recovery_message_no_truncate BEFORE TRUNCATE ON gridex_received_sources.prodat_recovery_messages FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER prodat_recovery_attempt_no_truncate BEFORE TRUNCATE ON gridex_received_sources.prodat_recovery_attempts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
-- Neutral decoded source identity/scope only. Current admission and field rules
-- still belong to the canonical authority, not a recovery-specific validator.
CREATE FUNCTION gridex_received_sources.prodat_recovery_wire_v1(p_raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(p_raw);t jsonb;e jsonb;out jsonb:='{}';objects jsonb:='[]';obj jsonb;characteristic text;key text;value text;
BEGIN
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) s WHERE s->>'tag'='UNB')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens) s WHERE s->>'tag'='UNH')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens) s WHERE s->>'tag'='UNT')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens) s WHERE s->>'tag'='UNZ')<>1 THEN RETURN NULL;END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens) x ORDER BY (x->>'index')::int LOOP
  e:=t->'elements';
  IF t->>'tag'='UNB' THEN out:=out||jsonb_build_object('interchange',e#>>'{5,0}','transportSender',e#>'{2}','transportReceiver',e#>'{3}');END IF;
  IF t->>'tag'='UNH' THEN out:=out||jsonb_build_object('family',e#>>'{2,0}','messageReference',e#>>'{1,0}','version',e#>'{2}');END IF;
  IF t->>'tag'='BGM' THEN out:=out||jsonb_build_object('code',e#>>'{1,0}','bgmId',e#>>'{2,0}','function',e#>>'{3,0}');END IF;
  IF t->>'tag'='NAD' AND obj IS NULL AND e#>>'{1,0}' IN ('FR','DO') THEN key:=CASE e#>>'{1,0}' WHEN 'FR' THEN 'legalSender' ELSE 'legalReceiver' END;IF out ? key THEN RETURN NULL;END IF;out:=out||jsonb_build_object(key,e#>>'{2,0}');END IF;
  IF t->>'tag'='LIN' THEN IF obj IS NOT NULL THEN objects:=objects||jsonb_build_array(obj);END IF;obj:=jsonb_build_object('point',nullif(e#>>'{3,0}', ''),'identityAgency',e#>>'{3,3}');characteristic:=NULL;
  ELSIF obj IS NOT NULL THEN
   key:=NULL;value:=NULL;
   IF t->>'tag'='RFF' AND e#>>'{1,0}'='LI' THEN key:='li';value:=e#>>'{1,1}';
   ELSIF t->>'tag'='NAD' AND e#>>'{1,0}'='UD' THEN key:='customerIdentity';value:=e#>>'{2,0}';
   ELSIF t->>'tag'='CCI' THEN characteristic:=e#>>'{2,0}';
   ELSIF t->>'tag'='CAV' AND characteristic='Z13' THEN key:='reason';value:=e#>>'{1,0}';END IF;
   IF key IS NOT NULL THEN IF obj ? key THEN RETURN NULL;END IF;obj:=obj||jsonb_build_object(key,value);END IF;
  END IF;
 END LOOP;
 IF obj IS NOT NULL THEN objects:=objects||jsonb_build_array(obj);END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]'::jsonb) INTO objects FROM jsonb_array_elements(objects) x;
 RETURN out||jsonb_build_object('objects',objects,'tokens',tokens);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.prodat_recovery_wire_v1(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_prepare_prodat_recovery_v1(p_company_id uuid,p_original_message_id uuid,p_actor_user_id uuid,p_operation_id uuid,p_source_ack_message_id uuid DEFAULT NULL,p_previous_attempt_id uuid DEFAULT NULL,p_corrected_raw_payload text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;ack public.ediel_messages%rowtype;attempt gridex_ediel_transport.attempts%rowtype;operation gridex_received_sources.prodat_recovery_operations%rowtype;
 original jsonb;corrected jsonb;response jsonb;allowed_objects jsonb;recovery_kind text;oid uuid;correlation record;
BEGIN
 IF p_operation_id IS NULL OR p_actor_user_id IS NULL THEN RAISE EXCEPTION 'prodat_recovery_scope_required';END IF;
 IF NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write'),false) THEN RAISE EXCEPTION 'prodat_recovery_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_original_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_recovery_sealed_original_required';END IF;
 original:=gridex_received_sources.prodat_recovery_wire_v1(m.raw_payload);
 IF original IS NULL OR original->>'family' IS DISTINCT FROM 'PRODAT' THEN RAISE EXCEPTION 'prodat_recovery_original_scope_unavailable';END IF;
 IF p_previous_attempt_id IS NOT NULL THEN
  IF p_source_ack_message_id IS NOT NULL OR p_corrected_raw_payload IS NOT NULL THEN RAISE EXCEPTION 'prodat_recovery_kind_conflict';END IF;
  SELECT * INTO attempt FROM gridex_ediel_transport.attempts WHERE id=p_previous_attempt_id AND message_id=m.id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
  IF NOT FOUND OR (attempt.classification IN ('pre_connect_negative','explicit_negative','all_rejected')) IS NOT TRUE OR attempt.observed_at IS NULL OR attempt.binding->>'originalHash' IS DISTINCT FROM m.immutable_payload_hash
   OR EXISTS(SELECT FROM gridex_ediel_transport.attempts a WHERE a.message_id=m.id AND (a.classification IN ('accepted','partial','unknown') OR a.entered_at IS NOT NULL AND a.observed_at IS NULL))
   OR (m.contrl_status='received') IS TRUE OR (m.aperak_status='received') IS TRUE OR EXISTS(SELECT FROM public.ediel_messages a WHERE a.company_id=m.company_id AND a.environment=m.environment AND a.direction='inbound' AND a.original_message_id=m.id AND a.ack_outcome='positive') THEN RETURN jsonb_build_object('status','held','reason','verified_transfer_loss_required');END IF;
  recovery_kind:='verified_transfer_loss';
 ELSE
  IF p_source_ack_message_id IS NULL OR p_corrected_raw_payload IS NULL OR octet_length(p_corrected_raw_payload)>262144 THEN RAISE EXCEPTION 'prodat_correction_source_required';END IF;
  SELECT * INTO ack FROM public.ediel_messages WHERE id=p_source_ack_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
  IF NOT FOUND OR ack.direction IS DISTINCT FROM 'inbound' OR (ack.message_family IN ('CONTRL','APERAK')) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_correction_ack_source_unavailable';END IF;
  IF NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=ack.id AND v.company_id=ack.company_id AND v.environment=ack.environment AND v.source_payload_hash=encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex') AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND v.facts_text::jsonb->>'applicationDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN jsonb_build_object('status','held','reason','canonical_negative_ack_source_required');END IF;
  -- Sole ACK authority derives and commits its own whole raw correlation. A
  -- caller's outcome/reference, mutable row pointers or local ERC table grant nothing.
  SELECT * INTO correlation FROM gridex_ack_authority.source_correlations a WHERE a.ack_message_id=ack.id AND a.source_message_id=m.id AND a.company_id=m.company_id AND a.environment=m.environment FOR SHARE;
  IF NOT FOUND OR correlation.ack_family IS DISTINCT FROM ack.message_family OR correlation.ack_outcome IS DISTINCT FROM 'negative' OR correlation.ack_payload_hash IS DISTINCT FROM encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex') OR correlation.source_payload_hash IS DISTINCT FROM m.immutable_payload_hash THEN RETURN jsonb_build_object('status','held','reason','qualified_negative_ack_source_required');END IF;
  response:=gridex_received_sources.prodat_recovery_wire_v1(ack.raw_payload);corrected:=gridex_received_sources.prodat_recovery_wire_v1(p_corrected_raw_payload);
  IF corrected IS NULL OR corrected->>'family' IS DISTINCT FROM 'PRODAT' OR corrected->>'code' IS DISTINCT FROM original->>'code' OR corrected->>'legalSender' IS DISTINCT FROM original->>'legalSender' OR corrected->>'legalReceiver' IS DISTINCT FROM original->>'legalReceiver' OR p_corrected_raw_payload=m.raw_payload THEN RETURN jsonb_build_object('status','held','reason','corrected_whole_original_scope_required');END IF;
  IF response IS NULL THEN RETURN jsonb_build_object('status','held','reason','negative_ack_wire_unavailable');END IF;
  allowed_objects:=original->'objects';
  IF ack.message_family='CONTRL' THEN
   IF correlation.ack_scope IS DISTINCT FROM 'interchange' THEN RETURN jsonb_build_object('status','held','reason','whole_original_negative_contrl_required');END IF;
   recovery_kind:='contrl_correction';
  ELSE
   -- Explicit physical object outcomes belong to the ACK owner. A positive
   -- sibling never enters this correction, and absent scope is not inferred.
   IF response->>'function'='27' THEN
    IF correlation.ack_scope IS DISTINCT FROM 'message' THEN RETURN jsonb_build_object('status','held','reason','source_supported_negative_aperak_scope_required');END IF;
   ELSIF response->>'function'='34' THEN
    IF correlation.ack_scope IS DISTINCT FROM 'object' OR jsonb_typeof(correlation.scope_outcomes) IS DISTINCT FROM 'array' OR jsonb_array_length(correlation.scope_outcomes)=0
     OR EXISTS(SELECT FROM jsonb_array_elements(correlation.scope_outcomes) result WHERE (result->>'outcome' IN ('positive','negative')) IS NOT TRUE OR nullif(result->>'reference','') IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(original->'objects') own WHERE own->>'li'=result->>'reference')) THEN RETURN jsonb_build_object('status','held','reason','source_supported_negative_aperak_scope_required');END IF;
    SELECT coalesce(jsonb_agg(own ORDER BY own::text),'[]') INTO allowed_objects FROM jsonb_array_elements(original->'objects') own WHERE EXISTS(SELECT FROM jsonb_array_elements(correlation.scope_outcomes) result WHERE result->>'reference'=own->>'li' AND result->>'outcome'='negative');
    IF jsonb_array_length(allowed_objects)=0 THEN RETURN jsonb_build_object('status','held','reason','negative_aperak_own_object_required');END IF;
   ELSE RETURN jsonb_build_object('status','held','reason','source_supported_negative_aperak_scope_required');END IF;
   IF nullif(corrected->>'bgmId','') IS NULL OR corrected->>'bgmId' IS NOT DISTINCT FROM original->>'bgmId' THEN RETURN jsonb_build_object('status','held','reason','negative_aperak_new_bgm_required');END IF;
   recovery_kind:='aperak_correction';
  END IF;
  IF corrected->'objects' IS DISTINCT FROM allowed_objects THEN RETURN jsonb_build_object('status','held','reason','corrected_exact_failed_scope_required');END IF;
 END IF;
 SELECT * INTO operation FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id;
 IF FOUND THEN IF operation.company_id IS DISTINCT FROM m.company_id OR operation.original_message_id IS DISTINCT FROM m.id OR operation.kind IS DISTINCT FROM recovery_kind OR operation.previous_attempt_id IS DISTINCT FROM p_previous_attempt_id OR operation.source_ack_message_id IS DISTINCT FROM p_source_ack_message_id OR operation.corrected_raw_payload IS DISTINCT FROM p_corrected_raw_payload THEN RAISE EXCEPTION 'prodat_recovery_operation_conflict';END IF;RETURN jsonb_build_object('status','authorized','operationId',operation.id,'kind',operation.kind,'originalMessageId',operation.original_message_id,'previousAttemptId',operation.previous_attempt_id,'newMessageId',(SELECT message_id FROM gridex_received_sources.prodat_recovery_messages WHERE operation_id=operation.id));END IF;
 INSERT INTO gridex_received_sources.prodat_recovery_operations(id,company_id,environment,original_message_id,original_payload_hash,kind,source_ack_message_id,source_ack_hash,previous_attempt_id,corrected_payload_hash,corrected_raw_payload,actor_user_id)
 VALUES(p_operation_id,m.company_id,m.environment,m.id,m.immutable_payload_hash,recovery_kind,p_source_ack_message_id,CASE WHEN ack.id IS NOT NULL THEN encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex') END,p_previous_attempt_id,CASE WHEN p_corrected_raw_payload IS NOT NULL THEN encode(sha256(convert_to(p_corrected_raw_payload,'UTF8')),'hex') END,p_corrected_raw_payload,p_actor_user_id)
 ON CONFLICT DO NOTHING RETURNING id INTO oid;
 IF oid IS NULL THEN SELECT id INTO oid FROM gridex_received_sources.prodat_recovery_operations WHERE company_id=m.company_id AND original_message_id=m.id AND kind=recovery_kind AND previous_attempt_id IS NOT DISTINCT FROM p_previous_attempt_id AND source_ack_message_id IS NOT DISTINCT FROM p_source_ack_message_id AND corrected_raw_payload IS NOT DISTINCT FROM p_corrected_raw_payload;END IF;
 IF oid IS NULL THEN RAISE EXCEPTION 'prodat_recovery_conflict';END IF;
 RETURN jsonb_build_object('status','authorized','operationId',oid,'kind',recovery_kind,'originalMessageId',m.id,'previousAttemptId',p_previous_attempt_id,'newMessageId',(SELECT message_id FROM gridex_received_sources.prodat_recovery_messages WHERE operation_id=oid));
END $$;
REVOKE ALL ON FUNCTION public.ediel_prepare_prodat_recovery_v1(uuid,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_prepare_prodat_recovery_v1(uuid,uuid,uuid,uuid,uuid,uuid,text) TO service_role;
-- Enqueue a distinct, privately bound retry. Existing message/outbox/attempt
-- state is retained; repeated authorization cannot requeue an established row.
CREATE FUNCTION public.ediel_queue_prodat_retry_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid,p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;op gridex_received_sources.prodat_recovery_operations%rowtype;b gridex_received_sources.prodat_recovery_outboxes%rowtype;o public.ediel_outbox%rowtype;assessment jsonb;queued_id uuid;
BEGIN
 IF NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send'),false) OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write'),false) THEN RAISE EXCEPTION 'prodat_retry_queue_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO STRICT op FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id AND company_id=p_company_id AND original_message_id=m.id AND kind='verified_transfer_loss';
 IF m.environment IS DISTINCT FROM op.environment OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR op.original_payload_hash IS DISTINCT FROM m.immutable_payload_hash OR op.original_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_retry_queue_source_changed';END IF;
 SELECT * INTO b FROM gridex_received_sources.prodat_recovery_outboxes WHERE operation_id=op.id;
 IF FOUND THEN
  SELECT * INTO STRICT o FROM public.ediel_outbox WHERE id=b.outbox_id AND company_id=p_company_id AND ediel_message_id=m.id AND environment=m.environment;
  RETURN jsonb_build_object('status','existing','outboxId',o.id,'operationId',op.id,'previousAttemptId',op.previous_attempt_id);
 END IF;
 assessment:=public.ediel_prepare_prodat_recovery_v1(p_company_id,m.id,p_actor_user_id,op.id,NULL,op.previous_attempt_id,NULL);
 IF assessment->>'status' IS DISTINCT FROM 'authorized' OR NOT EXISTS(SELECT FROM gridex_ediel_transport.reservations r WHERE r.message_id=m.id AND r.attempt_id=op.previous_attempt_id AND r.state='observed') THEN RAISE EXCEPTION 'prodat_retry_queue_actual_negative_required';END IF;
 INSERT INTO public.ediel_outbox(company_id,ediel_message_id,status,priority,lock_key,message_family,message_code,environment,route_profile_id,payload,queued_at,created_by,updated_by)
 VALUES(m.company_id,m.id,'queued',50,'prodat-loss-retry:'||op.id,'PRODAT',m.message_code,m.environment,m.route_profile_id,jsonb_build_object('recoveryOperationId',op.id,'previousAttemptId',op.previous_attempt_id),now(),p_actor_user_id,p_actor_user_id) ON CONFLICT(lock_key) DO NOTHING RETURNING id INTO queued_id;
 IF queued_id IS NULL THEN RAISE EXCEPTION 'prodat_retry_queue_unbound_collision';END IF;
 INSERT INTO gridex_received_sources.prodat_recovery_outboxes(operation_id,outbox_id,actor_user_id) VALUES(op.id,queued_id,p_actor_user_id);
 RETURN jsonb_build_object('status','queued','outboxId',queued_id,'operationId',op.id,'previousAttemptId',op.previous_attempt_id);
END $$;
REVOKE ALL ON FUNCTION public.ediel_queue_prodat_retry_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_queue_prodat_retry_v1(uuid,uuid,uuid,uuid) TO service_role;
-- Outbox worker derives its retry selectors from this private binding, not
-- caller-editable JSON. Provider entry consumes that exact operation anew.
CREATE FUNCTION public.ediel_prodat_retry_outbox_basis_v1(p_company_id uuid,p_outbox_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;o public.ediel_outbox%rowtype;m public.ediel_messages%rowtype;
BEGIN
 IF NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send'),false) THEN RAISE EXCEPTION 'prodat_retry_outbox_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT operation.* INTO op FROM gridex_received_sources.prodat_recovery_outboxes b JOIN gridex_received_sources.prodat_recovery_operations operation ON operation.id=b.operation_id WHERE b.outbox_id=p_outbox_id AND operation.company_id=p_company_id AND operation.kind='verified_transfer_loss';
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO STRICT o FROM public.ediel_outbox WHERE id=p_outbox_id AND company_id=p_company_id AND ediel_message_id=op.original_message_id AND environment=op.environment FOR SHARE;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=op.original_message_id AND company_id=p_company_id AND environment=op.environment FOR SHARE;
 IF op.original_payload_hash IS DISTINCT FROM m.immutable_payload_hash OR op.original_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR o.lock_key IS DISTINCT FROM 'prodat-loss-retry:'||op.id THEN RAISE EXCEPTION 'prodat_retry_outbox_source_changed';END IF;
 RETURN jsonb_build_object('operationId',op.id,'previousAttemptId',op.previous_attempt_id,'messageId',m.id,'outboxId',o.id,'originalPayloadHash',op.original_payload_hash);
END $$;
REVOKE ALL ON FUNCTION public.ediel_prodat_retry_outbox_basis_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_prodat_retry_outbox_basis_v1(uuid,uuid,uuid) TO service_role;
-- Journal calls under its original-message/current-reservation lock, before
-- advancing the cursor to a NEW attempt. The previous attempt is never edited.
CREATE FUNCTION public.ediel_consume_prodat_retry_authorization_v1(p_company_id uuid,p_message_id uuid,p_previous_attempt_id uuid,p_new_attempt_id uuid,p_actor_user_id uuid,p_operation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;m public.ediel_messages%rowtype;a gridex_ediel_transport.attempts%rowtype;used uuid;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send'),false) OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') THEN RETURN false;END IF;
 SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id AND company_id=p_company_id AND original_message_id=m.id AND kind='verified_transfer_loss' AND previous_attempt_id=p_previous_attempt_id;
 SELECT * INTO a FROM gridex_ediel_transport.attempts WHERE id=p_previous_attempt_id AND company_id=p_company_id AND message_id=m.id AND environment=m.environment FOR SHARE;
 IF op.id IS NULL OR op.environment IS DISTINCT FROM m.environment OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.immutable_rendered_at IS NULL OR a.id IS NULL OR p_new_attempt_id IS NULL OR p_new_attempt_id=p_previous_attempt_id OR op.original_payload_hash IS DISTINCT FROM m.immutable_payload_hash OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR (a.classification IN ('pre_connect_negative','explicit_negative','all_rejected')) IS NOT TRUE OR a.observed_at IS NULL
 OR NOT EXISTS(SELECT FROM gridex_ediel_transport.reservations r WHERE r.message_id=m.id AND r.attempt_id=p_previous_attempt_id AND r.state='observed') OR (m.contrl_status='received') IS TRUE OR (m.aperak_status='received') IS TRUE OR EXISTS(SELECT FROM public.ediel_messages ack WHERE ack.company_id=m.company_id AND ack.environment=m.environment AND ack.direction='inbound' AND ack.original_message_id=m.id AND ack.ack_outcome='positive')
 OR EXISTS(SELECT FROM gridex_ediel_transport.attempts prior WHERE prior.message_id=m.id AND (prior.classification IN ('accepted','partial','unknown') OR prior.entered_at IS NOT NULL AND prior.observed_at IS NULL)) THEN RETURN false;END IF;
 INSERT INTO gridex_received_sources.prodat_recovery_attempts(operation_id,attempt_id) VALUES(op.id,p_new_attempt_id) ON CONFLICT DO NOTHING;
 SELECT attempt_id INTO used FROM gridex_received_sources.prodat_recovery_attempts WHERE operation_id=op.id;
 RETURN used=p_new_attempt_id;
END $$;
REVOKE ALL ON FUNCTION public.ediel_consume_prodat_retry_authorization_v1(uuid,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_consume_prodat_retry_authorization_v1(uuid,uuid,uuid,uuid,uuid,uuid) TO service_role;
CREATE FUNCTION gridex_received_sources.bind_prodat_recovery_message_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;
BEGIN
 SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id::text=NEW.source_operation_id AND kind IN ('contrl_correction','aperak_correction');
 IF NOT FOUND THEN RETURN NEW;END IF;
 IF NEW.company_id IS DISTINCT FROM op.company_id OR NEW.environment IS DISTINCT FROM op.environment OR NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_family IS DISTINCT FROM 'PRODAT' OR NEW.original_message_id IS DISTINCT FROM op.original_message_id OR op.corrected_payload_hash IS DISTINCT FROM encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex') OR op.corrected_raw_payload IS DISTINCT FROM NEW.raw_payload THEN RAISE EXCEPTION 'prodat_recovery_bound_message_conflict';END IF;
 INSERT INTO gridex_received_sources.prodat_recovery_messages(operation_id,message_id) VALUES(op.id,NEW.id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.bind_prodat_recovery_message_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER prodat_recovery_message_bind AFTER INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.bind_prodat_recovery_message_v1();
-- Provider preparation/entry rechecks the immutable source operation and exact
-- fresh message binding. Current canonical guide and caller send permissions
-- are still checked by their existing owners.
CREATE FUNCTION public.ediel_require_prodat_recovery_current_v1(p_company_id uuid,p_message_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;m public.ediel_messages%rowtype;original public.ediel_messages%rowtype;ack public.ediel_messages%rowtype;
BEGIN
 SELECT operation.* INTO op FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations operation ON operation.id=link.operation_id WHERE link.message_id=p_message_id AND operation.company_id=p_company_id;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO STRICT original FROM public.ediel_messages WHERE id=op.original_message_id AND company_id=p_company_id AND environment=op.environment FOR SHARE;
 SELECT * INTO STRICT ack FROM public.ediel_messages WHERE id=op.source_ack_message_id AND company_id=p_company_id AND environment=op.environment FOR SHARE;
 IF m.environment IS DISTINCT FROM op.environment OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.source_operation_id IS DISTINCT FROM op.id::text OR m.original_message_id IS DISTINCT FROM original.id OR m.raw_payload IS DISTINCT FROM op.corrected_raw_payload OR op.corrected_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR original.immutable_rendered_at IS NULL OR original.immutable_payload_hash IS DISTINCT FROM op.original_payload_hash OR op.original_payload_hash IS DISTINCT FROM encode(sha256(convert_to(original.raw_payload,'UTF8')),'hex') OR op.source_ack_hash IS DISTINCT FROM encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex')
 OR NOT EXISTS(SELECT FROM gridex_ack_authority.source_correlations c WHERE c.ack_message_id=ack.id AND c.source_message_id=original.id AND c.company_id=p_company_id AND c.environment=op.environment AND c.ack_payload_hash=op.source_ack_hash AND c.source_payload_hash=op.original_payload_hash AND c.ack_outcome='negative')
 OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=op.actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=op.actor_user_id AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(op.actor_user_id,p_company_id,'communication.write'),false) THEN RAISE EXCEPTION 'prodat_recovery_current_source_required';END IF;
END $$;
REVOKE ALL ON FUNCTION public.ediel_require_prodat_recovery_current_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_require_prodat_recovery_current_v1(uuid,uuid) TO service_role;
COMMIT;
