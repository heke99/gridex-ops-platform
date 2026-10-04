-- TR05 / TEN01 / CALL03: P §4.1 pp107–108, §3.2; T §1.4.
-- The creator remains immutable provenance. Actual current execution requires
-- its own accepted tenant actor and phase permission; no operation/status/JSON
-- grants SEND. New operation creation still requires communication.write.
-- Reuse the complete existing negative-ACK/definite-loss source authority as a
-- PRIVATE READ-ONLY qualifier, excluding only its execution permission and
-- operation storage tail. An absent established operation cannot be minted by read ports.
BEGIN;
CREATE FUNCTION gridex_received_sources.require_recovery_execution_actor_v1(c uuid,actor uuid,phase text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF c IS NULL OR actor IS NULL OR (phase IN('prepare','send')) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_recovery_execution_scope_required';END IF;
 PERFORM 1 FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 PERFORM 1 FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR (CASE phase WHEN 'prepare' THEN coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.write'),false)
   WHEN 'send' THEN coalesce(public.gridex_actor_has_company_permission(actor,c,'ediel.send'),false) OR coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.send'),false) END) IS NOT TRUE
 THEN RAISE EXCEPTION 'prodat_recovery_execution_actor_forbidden' USING ERRCODE='42501';END IF;
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.require_recovery_execution_actor_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
-- Preparation follows the same source UUID order as fresh provider entry,
-- including any actual prior-correction lineage; discovery grants nothing.
CREATE FUNCTION gridex_received_sources.prelock_recovery_candidate_v1(c uuid,original_id uuid,ack_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous_op uuid;cohort uuid[];current_cohort uuid[];ids uuid[];
BEGIN
 SELECT link.operation_id INTO previous_op FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations op ON op.id=link.operation_id WHERE link.message_id=original_id AND op.company_id=c;
 cohort:=CASE WHEN previous_op IS NULL THEN '{}'::uuid[] ELSE gridex_received_sources.recovery_source_cohort_v1(c,previous_op) END;
 ids:=array_append(cohort,original_id);IF ack_id IS NOT NULL THEN ids:=array_append(ids,ack_id);END IF;
 PERFORM 1 FROM public.ediel_messages m WHERE m.company_id=c AND m.id=ANY(ids) ORDER BY m.id FOR UPDATE;
 IF previous_op IS NOT NULL THEN
  current_cohort:=gridex_received_sources.recovery_source_cohort_v1(c,previous_op);
  IF current_cohort IS DISTINCT FROM cohort THEN RAISE EXCEPTION 'prodat_recovery_source_cohort_changed' USING ERRCODE='40001';END IF;
 END IF;
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.prelock_recovery_candidate_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE definition text;permission_gate text:=$gate$ IF NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write'),false) THEN RAISE EXCEPTION 'prodat_recovery_actor_forbidden' USING ERRCODE='42501';END IF;$gate$;tail integer;
BEGIN
 definition:=pg_get_functiondef('public.ediel_prepare_prodat_recovery_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure);
 IF strpos(definition,permission_gate)=0 OR strpos(definition,' SELECT * INTO operation FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id;')=0 THEN RAISE EXCEPTION 'prodat_recovery_source_owner_shape_changed';END IF;
 definition:=replace(definition,'public.ediel_prepare_prodat_recovery_v1(', 'gridex_received_sources.assess_recovery_source_v1(');
 definition:=replace(definition,permission_gate,'');
 definition:=replace(definition,' SELECT * INTO m FROM public.ediel_messages WHERE id=p_original_message_id', ' PERFORM gridex_received_sources.prelock_recovery_candidate_v1(p_company_id,p_original_message_id,p_source_ack_message_id);'||E'\n SELECT * INTO m FROM public.ediel_messages WHERE id=p_original_message_id');
 tail:=strpos(definition,' SELECT * INTO operation FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id;');
 -- ONE inherited source owner for creation, read and fresh execution. It has
 -- no operation lookup, INSERT, mutable status reset or execution permission.
 definition:=left(definition,tail-1)||$tail$ RETURN jsonb_build_object('status','qualified','kind',recovery_kind,'companyId',m.company_id,'environment',m.environment,'originalMessageId',m.id,'originalPayloadHash',m.immutable_payload_hash,'sourceAckHash',CASE WHEN ack.id IS NOT NULL THEN encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex') END,'correctedPayloadHash',CASE WHEN p_corrected_raw_payload IS NOT NULL THEN encode(sha256(convert_to(p_corrected_raw_payload,'UTF8')),'hex') END);
END $function$;$tail$;
 EXECUTE definition;
END$patch$;
REVOKE ALL ON FUNCTION gridex_received_sources.assess_recovery_source_v1(uuid,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_received_sources.qualify_established_recovery_source_v1(p_company_id uuid,p_original_message_id uuid,p_actor_user_id uuid,p_operation_id uuid,p_source_ack_message_id uuid DEFAULT NULL,p_previous_attempt_id uuid DEFAULT NULL,p_corrected_raw_payload text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;q jsonb;
BEGIN
 SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id AND company_id=p_company_id;
 IF op.id IS NULL THEN RAISE EXCEPTION 'prodat_recovery_established_operation_required';END IF;
 q:=gridex_received_sources.assess_recovery_source_v1(p_company_id,p_original_message_id,p_actor_user_id,p_operation_id,p_source_ack_message_id,p_previous_attempt_id,p_corrected_raw_payload);
 IF q->>'status' IS DISTINCT FROM 'qualified' THEN RETURN q;END IF;
 IF op.environment IS DISTINCT FROM q->>'environment' OR op.original_message_id IS DISTINCT FROM p_original_message_id OR op.kind IS DISTINCT FROM q->>'kind'
  OR op.original_payload_hash IS DISTINCT FROM q->>'originalPayloadHash' OR op.source_ack_hash IS DISTINCT FROM q->>'sourceAckHash' OR op.corrected_payload_hash IS DISTINCT FROM q->>'correctedPayloadHash'
  OR op.previous_attempt_id IS DISTINCT FROM p_previous_attempt_id OR op.source_ack_message_id IS DISTINCT FROM p_source_ack_message_id OR op.corrected_raw_payload IS DISTINCT FROM p_corrected_raw_payload THEN RAISE EXCEPTION 'prodat_recovery_operation_conflict';END IF;
 RETURN jsonb_build_object('status','authorized','operationId',op.id,'kind',op.kind,'originalMessageId',op.original_message_id,'previousAttemptId',op.previous_attempt_id,'newMessageId',(SELECT message_id FROM gridex_received_sources.prodat_recovery_messages WHERE operation_id=op.id));
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.qualify_established_recovery_source_v1(uuid,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_received_sources.require_established_recovery_source_v1(c uuid,operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;m public.ediel_messages%rowtype;ack public.ediel_messages%rowtype;q jsonb;
BEGIN
 SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id=operation_id AND company_id=c;
 IF op.id IS NULL THEN RAISE EXCEPTION 'prodat_recovery_established_operation_required';END IF;
 -- Provenance actor is passed solely to the unchanged immutable-operation
 -- identity comparison. The private qualifier has no execution gate or INSERT.
 q:=gridex_received_sources.qualify_established_recovery_source_v1(c,op.original_message_id,op.actor_user_id,op.id,op.source_ack_message_id,op.previous_attempt_id,op.corrected_raw_payload);
 IF q->>'status' IS DISTINCT FROM 'authorized' OR q->>'operationId' IS DISTINCT FROM op.id::text THEN RAISE EXCEPTION 'prodat_recovery_source_context_held';END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=op.original_message_id AND company_id=c FOR SHARE;
 IF m.environment IS DISTINCT FROM op.environment OR m.immutable_payload_hash IS DISTINCT FROM op.original_payload_hash
  OR op.original_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_recovery_current_source_required';END IF;
 IF op.kind IN('contrl_correction','aperak_correction') THEN
  SELECT * INTO STRICT ack FROM public.ediel_messages WHERE id=op.source_ack_message_id AND company_id=c AND environment=op.environment FOR SHARE;
  IF op.source_ack_hash IS DISTINCT FROM encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex')
   OR op.corrected_payload_hash IS DISTINCT FROM encode(sha256(convert_to(op.corrected_raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_recovery_current_source_required';END IF;
 END IF;
 RETURN q;
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.require_established_recovery_source_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Immutable lineage is discovery only. Lock the actual source/ACK universe
-- in one stable order before any original/event/service contract consumers.
CREATE FUNCTION gridex_received_sources.recovery_source_cohort_v1(c uuid,op_id uuid) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;ids uuid[]:='{}';seen uuid[]:='{}';i int;
BEGIN
 FOR i IN 1..32 LOOP
  SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id=op_id AND company_id=c;
  IF op.id IS NULL THEN IF i=1 THEN RETURN NULL;END IF;RAISE EXCEPTION 'prodat_recovery_source_cohort_changed';END IF;
  IF op.id=ANY(seen) THEN RAISE EXCEPTION 'prodat_recovery_source_cohort_cycle';END IF;
  seen:=array_append(seen,op.id);ids:=array_append(ids,op.original_message_id);
  IF op.source_ack_message_id IS NOT NULL THEN ids:=array_append(ids,op.source_ack_message_id);END IF;
  SELECT operation_id INTO op_id FROM gridex_received_sources.prodat_recovery_messages WHERE message_id=op.original_message_id;
  IF op_id IS NULL THEN RETURN ARRAY(SELECT DISTINCT source_id FROM unnest(ids) source_id ORDER BY source_id);END IF;
 END LOOP;
 RAISE EXCEPTION 'prodat_recovery_source_cohort_bound_exceeded';
END$$;
CREATE FUNCTION gridex_received_sources.prelock_recovery_source_cohort_v1(c uuid,op_id uuid,corrected_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cohort uuid[]:=gridex_received_sources.recovery_source_cohort_v1(c,op_id);all_ids uuid[];
BEGIN
 IF cohort IS NULL THEN RETURN;END IF;
 all_ids:=CASE WHEN corrected_id IS NULL THEN cohort ELSE array_append(cohort,corrected_id) END;
 PERFORM 1 FROM public.ediel_messages m WHERE m.company_id=c AND m.id=ANY(all_ids) ORDER BY m.id FOR UPDATE;
 IF gridex_received_sources.recovery_source_cohort_v1(c,op_id) IS DISTINCT FROM cohort THEN RAISE EXCEPTION 'prodat_recovery_source_cohort_changed' USING ERRCODE='40001';END IF;
 IF(SELECT count(DISTINCT m.id) FROM public.ediel_messages m WHERE m.company_id=c AND m.id=ANY(all_ids)) IS DISTINCT FROM (SELECT count(DISTINCT x) FROM unnest(all_ids) x) THEN RAISE EXCEPTION 'prodat_recovery_source_cohort_unavailable';END IF;
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.recovery_source_cohort_v1(uuid,uuid),gridex_received_sources.prelock_recovery_source_cohort_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Resolve a genuine source origin only through qualified private aliases.
-- Immediate failed source remains the new message's original pointer. Every
-- generation retains its exact negative ACK and immediate failed-object scope.
CREATE FUNCTION gridex_received_sources.qualified_recovery_origin_v1(c uuid,op_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE first_op gridex_received_sources.prodat_recovery_operations%rowtype;op gridex_received_sources.prodat_recovery_operations%rowtype;
 m public.ediel_messages%rowtype;next_op uuid;seen uuid[]:='{}';i int;
BEGIN
 SELECT * INTO first_op FROM gridex_received_sources.prodat_recovery_operations WHERE id=op_id AND company_id=c;
 IF first_op.id IS NULL THEN RAISE EXCEPTION 'prodat_recovery_established_operation_required';END IF;
 PERFORM gridex_received_sources.prelock_recovery_source_cohort_v1(c,first_op.id);
 FOR i IN 1..32 LOOP
  IF op_id=ANY(seen) THEN RAISE EXCEPTION 'prodat_recovery_source_cohort_cycle';END IF;seen:=array_append(seen,op_id);
  SELECT * INTO STRICT op FROM gridex_received_sources.prodat_recovery_operations WHERE id=op_id AND company_id=c;
  IF op.environment IS DISTINCT FROM first_op.environment THEN RAISE EXCEPTION 'prodat_recovery_origin_environment_changed';END IF;
  PERFORM gridex_received_sources.require_established_recovery_source_v1(c,op.id);
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=op.original_message_id AND company_id=c AND environment=op.environment FOR SHARE;
  SELECT operation_id INTO next_op FROM gridex_received_sources.prodat_recovery_messages WHERE message_id=m.id;
  IF next_op IS NULL THEN RETURN jsonb_build_object('sourceOriginMessageId',m.id,'originalMessageId',first_op.original_message_id,'operationId',first_op.id);END IF;
  SELECT * INTO STRICT op FROM gridex_received_sources.prodat_recovery_operations WHERE id=next_op AND company_id=c;
  IF (op.kind IN('contrl_correction','aperak_correction')) IS NOT TRUE OR op.environment IS DISTINCT FROM m.environment
   OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.source_operation_id IS DISTINCT FROM op.id::text
   OR m.original_message_id IS DISTINCT FROM op.original_message_id OR m.raw_payload IS DISTINCT FROM op.corrected_raw_payload
   OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM op.corrected_payload_hash
   OR op.corrected_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_recovery_origin_alias_changed';END IF;
  op_id:=next_op;
 END LOOP;
 RAISE EXCEPTION 'prodat_recovery_source_cohort_bound_exceeded';
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.qualified_recovery_origin_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Keep the existing public service-original bridge. Only its private delegate
-- changes from creation/WRITE to current execution + the same source qualifier.
CREATE OR REPLACE FUNCTION gridex_service_permission.recovery_operation_before_current_service_v1(p_company_id uuid,p_operation_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;phase text;origin jsonb;
BEGIN
 SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id AND company_id=p_company_id;
 IF op.id IS NULL OR op.kind='verified_transfer_loss' THEN RETURN NULL;END IF;
 PERFORM gridex_received_sources.prelock_recovery_source_cohort_v1(p_company_id,op.id);
 phase:=CASE WHEN coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'ediel.send'),false) OR coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send'),false) THEN 'send' ELSE 'prepare' END;
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,phase);
 origin:=gridex_received_sources.qualified_recovery_origin_v1(p_company_id,op.id);
 RETURN jsonb_build_object('sourceOriginMessageId',origin->>'sourceOriginMessageId','originalMessageId',op.original_message_id,'operationId',op.id,'sourceAckMessageId',op.source_ack_message_id,'kind',op.kind,'correctedPayloadHash',op.corrected_payload_hash,'allowedObjects',gridex_received_sources.prodat_recovery_wire_v1(op.corrected_raw_payload)->'objects');
END$$;
REVOKE ALL ON FUNCTION gridex_service_permission.recovery_operation_before_current_service_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Preserve the public service bridge and require the actual qualified source
-- origin; the immediate correction's new intent is never treated as that origin.
CREATE OR REPLACE FUNCTION public.ediel_prodat_recovery_operation_basis_v1(p_company_id uuid,p_operation_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE basis jsonb;
BEGIN
 basis:=gridex_service_permission.recovery_operation_before_current_service_v1(p_company_id,p_operation_id,p_actor_user_id);
 IF basis IS NULL THEN RETURN NULL;END IF;
 IF nullif(basis->>'sourceOriginMessageId','') IS NULL OR basis->>'operationId' IS DISTINCT FROM p_operation_id::text THEN RAISE EXCEPTION 'ediel_service_recovery_basis_unqualified';END IF;
 PERFORM gridex_service_permission.require_original_current_v1(p_company_id,(basis->>'sourceOriginMessageId')::uuid);
 RETURN basis;
END$$;
REVOKE ALL ON FUNCTION public.ediel_prodat_recovery_operation_basis_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_prodat_recovery_operation_basis_v1(uuid,uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.ediel_require_prodat_recovery_current_v1(p_company_id uuid,p_message_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;m public.ediel_messages%rowtype;
BEGIN
 SELECT operation.* INTO op FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations operation ON operation.id=link.operation_id WHERE link.message_id=p_message_id AND operation.company_id=p_company_id;
 IF op.id IS NULL THEN RETURN;END IF;
 PERFORM gridex_received_sources.prelock_recovery_source_cohort_v1(p_company_id,op.id,p_message_id);
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF m.environment IS DISTINCT FROM op.environment OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT'
  OR m.source_operation_id IS DISTINCT FROM op.id::text OR m.original_message_id IS DISTINCT FROM op.original_message_id
  OR m.raw_payload IS DISTINCT FROM op.corrected_raw_payload OR op.corrected_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_recovery_current_source_required';END IF;
 -- Source-only: actual sender/worker is authorized by its existing journal.
 -- An inactive historical creator cannot invalidate genuine immutable source.
 PERFORM gridex_received_sources.qualified_recovery_origin_v1(p_company_id,op.id);
END$$;
REVOKE ALL ON FUNCTION public.ediel_require_prodat_recovery_current_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_require_prodat_recovery_current_v1(uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.ediel_require_service_permission_origin_current_v1(p_company_id uuid,p_message_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;origin jsonb;
BEGIN
 IF p_company_id IS NULL OR p_message_id IS NULL THEN RAISE EXCEPTION 'ediel_service_permission_scope_required';END IF;
 PERFORM gridex_service_permission.require_original_current_v1(p_company_id,p_message_id);
 SELECT operation.* INTO op FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations operation ON operation.id=link.operation_id WHERE link.message_id=p_message_id AND operation.company_id=p_company_id;
 IF op.id IS NULL THEN RETURN;END IF;
 PERFORM public.ediel_require_prodat_recovery_current_v1(p_company_id,p_message_id);
 -- Same original service authority, without treating its preparer as today's
 -- transport executor. No new intent is rebound to an old service origin.
 origin:=gridex_received_sources.qualified_recovery_origin_v1(p_company_id,op.id);
 PERFORM gridex_service_permission.require_original_current_v1(p_company_id,(origin->>'sourceOriginMessageId')::uuid);
END$$;
REVOKE ALL ON FUNCTION public.ediel_require_service_permission_origin_current_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_require_service_permission_origin_current_v1(uuid,uuid) TO service_role;

-- Actual creation still uses WRITE, with locked current actor facts.
CREATE OR REPLACE FUNCTION public.ediel_prepare_prodat_recovery_v1(p_company_id uuid,p_original_message_id uuid,p_actor_user_id uuid,p_operation_id uuid,p_source_ack_message_id uuid DEFAULT NULL,p_previous_attempt_id uuid DEFAULT NULL,p_corrected_raw_payload text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q jsonb;op gridex_received_sources.prodat_recovery_operations%rowtype;oid uuid;
BEGIN
 IF p_operation_id IS NULL OR p_actor_user_id IS NULL THEN RAISE EXCEPTION 'prodat_recovery_scope_required';END IF;
 PERFORM gridex_received_sources.prelock_recovery_candidate_v1(p_company_id,p_original_message_id,p_source_ack_message_id);
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'prepare');
 q:=gridex_received_sources.assess_recovery_source_v1(p_company_id,p_original_message_id,p_actor_user_id,p_operation_id,p_source_ack_message_id,p_previous_attempt_id,p_corrected_raw_payload);
 IF q->>'status' IS DISTINCT FROM 'qualified' THEN RETURN q;END IF;
 SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id;
 IF FOUND THEN
  IF op.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'prodat_recovery_operation_conflict';END IF;
  RETURN gridex_received_sources.qualify_established_recovery_source_v1(p_company_id,p_original_message_id,p_actor_user_id,p_operation_id,p_source_ack_message_id,p_previous_attempt_id,p_corrected_raw_payload);
 END IF;
 INSERT INTO gridex_received_sources.prodat_recovery_operations(id,company_id,environment,original_message_id,original_payload_hash,kind,source_ack_message_id,source_ack_hash,previous_attempt_id,corrected_payload_hash,corrected_raw_payload,actor_user_id)
 VALUES(p_operation_id,p_company_id,q->>'environment',p_original_message_id,q->>'originalPayloadHash',q->>'kind',p_source_ack_message_id,q->>'sourceAckHash',p_previous_attempt_id,q->>'correctedPayloadHash',p_corrected_raw_payload,p_actor_user_id)
 ON CONFLICT DO NOTHING RETURNING id INTO oid;
 IF oid IS NULL THEN SELECT id INTO oid FROM gridex_received_sources.prodat_recovery_operations WHERE company_id=p_company_id AND original_message_id=p_original_message_id AND kind=q->>'kind' AND previous_attempt_id IS NOT DISTINCT FROM p_previous_attempt_id AND source_ack_message_id IS NOT DISTINCT FROM p_source_ack_message_id AND corrected_raw_payload IS NOT DISTINCT FROM p_corrected_raw_payload;END IF;
 IF oid IS NULL THEN RAISE EXCEPTION 'prodat_recovery_conflict';END IF;
 RETURN gridex_received_sources.qualify_established_recovery_source_v1(p_company_id,p_original_message_id,p_actor_user_id,oid,p_source_ack_message_id,p_previous_attempt_id,p_corrected_raw_payload);
END $$;
-- Queue/worker/consume use established source, current SEND union. Existing
-- outbox/attempt rows and reservation advancement semantics are unchanged.
CREATE OR REPLACE FUNCTION public.ediel_queue_prodat_retry_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid,p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;op gridex_received_sources.prodat_recovery_operations%rowtype;b gridex_received_sources.prodat_recovery_outboxes%rowtype;o public.ediel_outbox%rowtype;assessment jsonb;queued_id uuid;
BEGIN
 PERFORM 1 FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'send');
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO STRICT op FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id AND company_id=p_company_id AND original_message_id=m.id AND kind='verified_transfer_loss';
 IF m.environment IS DISTINCT FROM op.environment OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR op.original_payload_hash IS DISTINCT FROM m.immutable_payload_hash OR op.original_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_retry_queue_source_changed';END IF;
 SELECT * INTO b FROM gridex_received_sources.prodat_recovery_outboxes WHERE operation_id=op.id;
 IF FOUND THEN
  SELECT * INTO STRICT o FROM public.ediel_outbox WHERE id=b.outbox_id AND company_id=p_company_id AND ediel_message_id=m.id AND environment=m.environment;
  RETURN jsonb_build_object('status','existing','outboxId',o.id,'operationId',op.id,'previousAttemptId',op.previous_attempt_id);
 END IF;
 assessment:=gridex_received_sources.require_established_recovery_source_v1(p_company_id,op.id);
 IF assessment->>'status' IS DISTINCT FROM 'authorized' OR NOT EXISTS(SELECT FROM gridex_ediel_transport.reservations r WHERE r.message_id=m.id AND r.attempt_id=op.previous_attempt_id AND r.state='observed') THEN RAISE EXCEPTION 'prodat_retry_queue_actual_negative_required';END IF;
 INSERT INTO public.ediel_outbox(company_id,ediel_message_id,status,priority,lock_key,message_family,message_code,environment,route_profile_id,payload,queued_at,created_by,updated_by)
 VALUES(m.company_id,m.id,'queued',50,'prodat-loss-retry:'||op.id,'PRODAT',m.message_code,m.environment,m.route_profile_id,jsonb_build_object('recoveryOperationId',op.id,'previousAttemptId',op.previous_attempt_id),now(),p_actor_user_id,p_actor_user_id) ON CONFLICT(lock_key) DO NOTHING RETURNING id INTO queued_id;
 IF queued_id IS NULL THEN RAISE EXCEPTION 'prodat_retry_queue_unbound_collision';END IF;
 INSERT INTO gridex_received_sources.prodat_recovery_outboxes(operation_id,outbox_id,actor_user_id) VALUES(op.id,queued_id,p_actor_user_id);
 RETURN jsonb_build_object('status','queued','outboxId',queued_id,'operationId',op.id,'previousAttemptId',op.previous_attempt_id);
END $$;
CREATE OR REPLACE FUNCTION public.ediel_prodat_retry_outbox_basis_v1(p_company_id uuid,p_outbox_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;o public.ediel_outbox%rowtype;m public.ediel_messages%rowtype;
BEGIN
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'send');
 SELECT operation.* INTO op FROM gridex_received_sources.prodat_recovery_outboxes b JOIN gridex_received_sources.prodat_recovery_operations operation ON operation.id=b.operation_id WHERE b.outbox_id=p_outbox_id AND operation.company_id=p_company_id AND operation.kind='verified_transfer_loss';
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO STRICT o FROM public.ediel_outbox WHERE id=p_outbox_id AND company_id=p_company_id AND ediel_message_id=op.original_message_id AND environment=op.environment FOR SHARE;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=op.original_message_id AND company_id=p_company_id AND environment=op.environment FOR SHARE;
 IF op.original_payload_hash IS DISTINCT FROM m.immutable_payload_hash OR op.original_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR o.lock_key IS DISTINCT FROM 'prodat-loss-retry:'||op.id THEN RAISE EXCEPTION 'prodat_retry_outbox_source_changed';END IF;
 RETURN jsonb_build_object('operationId',op.id,'previousAttemptId',op.previous_attempt_id,'messageId',m.id,'outboxId',o.id,'originalPayloadHash',op.original_payload_hash);
END $$;
CREATE OR REPLACE FUNCTION public.ediel_consume_prodat_retry_authorization_v1(p_company_id uuid,p_message_id uuid,p_previous_attempt_id uuid,p_new_attempt_id uuid,p_actor_user_id uuid,p_operation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;m public.ediel_messages%rowtype;a gridex_ediel_transport.attempts%rowtype;used uuid;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 BEGIN PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'send');EXCEPTION WHEN insufficient_privilege THEN RETURN false;END;
 SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id AND company_id=p_company_id AND original_message_id=m.id AND kind='verified_transfer_loss' AND previous_attempt_id=p_previous_attempt_id;
 SELECT * INTO a FROM gridex_ediel_transport.attempts WHERE id=p_previous_attempt_id AND company_id=p_company_id AND message_id=m.id AND environment=m.environment FOR SHARE;
 IF op.id IS NULL OR op.environment IS DISTINCT FROM m.environment OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.immutable_rendered_at IS NULL OR a.id IS NULL OR p_new_attempt_id IS NULL OR p_new_attempt_id=p_previous_attempt_id OR op.original_payload_hash IS DISTINCT FROM m.immutable_payload_hash OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR (a.classification IN ('pre_connect_negative','explicit_negative','all_rejected')) IS NOT TRUE OR a.observed_at IS NULL
 OR NOT EXISTS(SELECT FROM gridex_ediel_transport.reservations r WHERE r.message_id=m.id AND r.attempt_id=p_previous_attempt_id AND r.state='observed') OR (m.contrl_status='received') IS TRUE OR (m.aperak_status='received') IS TRUE OR EXISTS(SELECT FROM public.ediel_messages ack WHERE ack.company_id=m.company_id AND ack.environment=m.environment AND ack.direction='inbound' AND ack.original_message_id=m.id AND ack.ack_outcome='positive')
 OR EXISTS(SELECT FROM gridex_ediel_transport.attempts prior WHERE prior.message_id=m.id AND (prior.classification IN ('accepted','partial','unknown') OR prior.entered_at IS NOT NULL AND prior.observed_at IS NULL)) THEN RETURN false;END IF;
 PERFORM gridex_received_sources.require_established_recovery_source_v1(p_company_id,op.id);
 INSERT INTO gridex_received_sources.prodat_recovery_attempts(operation_id,attempt_id) VALUES(op.id,p_new_attempt_id) ON CONFLICT DO NOTHING;
 SELECT attempt_id INTO used FROM gridex_received_sources.prodat_recovery_attempts WHERE operation_id=op.id;
 RETURN used=p_new_attempt_id;
END $$;
REVOKE ALL ON FUNCTION public.ediel_prepare_prodat_recovery_v1(uuid,uuid,uuid,uuid,uuid,uuid,text),public.ediel_queue_prodat_retry_v1(uuid,uuid,uuid,uuid),public.ediel_prodat_retry_outbox_basis_v1(uuid,uuid,uuid),public.ediel_consume_prodat_retry_authorization_v1(uuid,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_prepare_prodat_recovery_v1(uuid,uuid,uuid,uuid,uuid,uuid,text),public.ediel_queue_prodat_retry_v1(uuid,uuid,uuid,uuid),public.ediel_prodat_retry_outbox_basis_v1(uuid,uuid,uuid),public.ediel_consume_prodat_retry_authorization_v1(uuid,uuid,uuid,uuid,uuid,uuid) TO service_role;
-- The earlier replay cursor and technical-original wrapper already hold the
-- actual send actor. Use the same established SEND union in both real layers.
DO $patch$
DECLARE fn regprocedure;definition text;needle text;
BEGIN
 FOREACH fn IN ARRAY ARRAY['gridex_ediel_transport.mutate_before_original_basis_v1(jsonb)'::regprocedure,'gridex_ediel_transport.mutate_before_positive_storage_v1(jsonb)'::regprocedure] LOOP
  definition:=pg_get_functiondef(fn);
  needle:=CASE WHEN fn='gridex_ediel_transport.mutate_before_original_basis_v1(jsonb)'::regprocedure THEN 'coalesce(public.gridex_actor_has_company_permission(actor,c,''communication.send''),false)' ELSE 'coalesce(public.gridex_actor_has_company_permission(actor,m.company_id,''communication.send''),false)' END;
  IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'prodat_recovery_current_journal_shape_changed';END IF;
  definition:=replace(definition,needle,'('||needle||' OR '||replace(needle,'''communication.send''','''ediel.send''')||')');
  IF fn='gridex_ediel_transport.mutate_before_original_basis_v1(jsonb)'::regprocedure THEN
   IF strpos(definition,'  IF actor IS NULL OR aid IS NULL')=0 THEN RAISE EXCEPTION 'prodat_recovery_current_journal_actor_shape_changed';END IF;
   definition:=replace(definition,'  IF actor IS NULL OR aid IS NULL', E'  PERFORM 1 FROM public.user_profiles u WHERE u.id=actor FOR SHARE;\n  PERFORM 1 FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor FOR SHARE;\n  IF actor IS NULL OR aid IS NULL');
  ELSE
   IF strpos(definition,'   IF attempt.id IS NULL OR m.immutable_rendered_at IS NULL')=0 THEN RAISE EXCEPTION 'prodat_recovery_current_replay_actor_shape_changed';END IF;
   definition:=replace(definition,'   IF attempt.id IS NULL OR m.immutable_rendered_at IS NULL', E'   PERFORM 1 FROM public.user_profiles u WHERE u.id=actor FOR SHARE;\n   PERFORM 1 FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=actor FOR SHARE;\n   IF attempt.id IS NULL OR m.immutable_rendered_at IS NULL');
  END IF;
  EXECUTE definition;
 END LOOP;
END$patch$;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_recovery_execution_phase_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c uuid:=(i->>'companyId')::uuid;mid uuid:=(i->>'messageId')::uuid;env text:=i->>'environment';action text:=i->>'action';op_id uuid;
 m public.ediel_messages%rowtype;r gridex_ediel_transport.reservations%rowtype;
BEGIN
 IF(action IN('prepare','enter')) IS NOT TRUE THEN RETURN gridex_ediel_transport.mutate_before_recovery_execution_phase_v1(i);END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=mid AND company_id=c AND environment=env AND direction='outbound';
 IF m.id IS NULL THEN RETURN gridex_ediel_transport.mutate_before_recovery_execution_phase_v1(i);END IF;
 SELECT * INTO r FROM gridex_ediel_transport.reservations WHERE message_id=m.id;
 IF(action='prepare' AND r.message_id IS NOT NULL AND r.state IS DISTINCT FROM 'released')
  OR(action='enter' AND r.message_id IS NOT NULL AND r.state IS DISTINCT FROM 'prepared')
  OR gridex_ediel_transport.accepted_source_basis_v1(m) IS NOT NULL THEN RETURN gridex_ediel_transport.mutate_before_recovery_execution_phase_v1(i);END IF;
 -- This is the SAME existing retry/ACK universe lock, moved before source rows
 -- for fresh entry so no later table-lock upgrade can invert the cohort order.
 LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
 SELECT operation.id INTO op_id FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations operation ON operation.id=link.operation_id WHERE link.message_id=mid AND operation.company_id=c;
 IF op_id IS NOT NULL THEN PERFORM gridex_received_sources.prelock_recovery_source_cohort_v1(c,op_id,mid);END IF;
 RETURN gridex_ediel_transport.mutate_before_recovery_execution_phase_v1(i);
END$$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb),gridex_ediel_transport.mutate_before_recovery_execution_phase_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb) TO service_role;
COMMIT;
