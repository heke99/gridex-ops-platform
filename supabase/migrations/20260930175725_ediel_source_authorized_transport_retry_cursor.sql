-- Advance only a current reservation cursor after immutable, source-qualified
-- transfer-loss authorization. Existing attempt/ACK/provider outcomes stay fixed.
BEGIN;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_source_retry_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c uuid:=(p_input->>'companyId')::uuid;mid uuid:=(p_input->>'messageId')::uuid;
 actor uuid:=(p_input->>'actorUserId')::uuid;aid uuid:=(p_input->>'attemptId')::uuid;
 m public.ediel_messages%rowtype;r gridex_ediel_transport.reservations%rowtype;a gridex_ediel_transport.attempts%rowtype;
 retry jsonb:=p_input#>'{binding,recoveryAuthorization}';basis jsonb;result jsonb;prior jsonb;
BEGIN
 IF p_input->>'action'='prepare' THEN
  -- Freeze the genuine candidate universe before rows, in the same lock order
  -- as qualified inbound ACK effects. This lock is not activation evidence.
  LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=mid AND company_id=c AND environment=p_input->>'environment' FOR UPDATE;
  IF actor IS NULL OR aid IS NULL OR m.direction IS DISTINCT FROM 'outbound' OR m.immutable_rendered_at IS NULL
   OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
   OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
   OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
   OR NOT coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.send'),false)
  THEN RAISE EXCEPTION 'ediel_transport_replay_scope_invalid' USING ERRCODE='42501';END IF;
  SELECT * INTO r FROM gridex_ediel_transport.reservations WHERE message_id=mid FOR UPDATE;
  IF FOUND AND r.state<>'released' THEN
   SELECT * INTO STRICT a FROM gridex_ediel_transport.attempts WHERE id=r.attempt_id AND message_id=mid AND company_id=c AND environment=m.environment FOR SHARE;
   IF a.binding->>'originalHash' IS DISTINCT FROM m.immutable_payload_hash THEN RAISE EXCEPTION 'ediel_transport_original_changed';END IF;
   IF retry IS NULL OR retry='null'::jsonb OR r.state<>'observed' OR a.classification NOT IN('pre_connect_negative','explicit_negative','all_rejected') THEN
    -- Prior accepted/uncertain/scoped outcomes are historical observations. A
    -- later permission, route or rule change cannot authorize another entry.
    RETURN jsonb_build_object('proceed',false,'state',r.state,'classification',a.classification,
      'providerReceipt',CASE WHEN a.classification='accepted' THEN a.provider_result ELSE NULL END,'observedAt',a.observed_at);
   END IF;
   IF p_input#>>'{owner,kind}' IS DISTINCT FROM 'worker' OR jsonb_typeof(retry) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_transport_retry_private_outbox_required';END IF;
   basis:=public.ediel_prodat_retry_outbox_basis_v1(c,(p_input#>>'{owner,outboxId}')::uuid,actor);
   IF basis IS NULL OR basis IS DISTINCT FROM retry OR basis->>'messageId' IS DISTINCT FROM mid::text
    OR basis->>'previousAttemptId' IS DISTINCT FROM r.attempt_id::text THEN RAISE EXCEPTION 'ediel_transport_retry_binding_invalid';END IF;
   PERFORM 1 FROM public.ediel_outbox o WHERE o.id=(basis->>'outboxId')::uuid AND o.company_id=c AND o.ediel_message_id=mid AND o.environment=m.environment
    AND o.status='sending' AND o.current_send_attempt_id=(p_input#>>'{owner,sendAttemptId}')::uuid AND o.locked_by=p_input#>>'{owner,workerId}' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'ediel_transport_worker_fence_lost';END IF;
   IF NOT public.ediel_consume_prodat_retry_authorization_v1(c,mid,r.attempt_id,aid,actor,(basis->>'operationId')::uuid) THEN RAISE EXCEPTION 'ediel_transport_retry_authorization_denied';END IF;
   prior:=to_jsonb(a);
   -- Only the mutable cursor is advanced in this transaction. Any current
   -- source/readiness/archive/worker failure rolls this and consumption back.
   UPDATE gridex_ediel_transport.reservations SET state='released' WHERE message_id=mid AND attempt_id=r.attempt_id AND state='observed';
   result:=gridex_ediel_transport.mutate_before_source_retry_v1(p_input);
   IF result->>'proceed' IS DISTINCT FROM 'true' OR NOT EXISTS(SELECT FROM gridex_ediel_transport.reservations x WHERE x.message_id=mid AND x.attempt_id=aid AND x.state='prepared')
    OR (SELECT to_jsonb(old) FROM gridex_ediel_transport.attempts old WHERE old.id=r.attempt_id) IS DISTINCT FROM prior THEN RAISE EXCEPTION 'ediel_transport_retry_cursor_contract_failed';END IF;
   RETURN result;
  ELSIF retry IS NOT NULL AND retry<>'null'::jsonb THEN
   RAISE EXCEPTION 'ediel_transport_retry_observed_original_required';
  END IF;
 END IF;
 IF p_input->>'action' IN('prepare','enter') THEN
  PERFORM public.ediel_require_prodat_recovery_current_v1(c,mid);
 END IF;
 RETURN gridex_ediel_transport.mutate_before_source_retry_v1(p_input);
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.mutate_before_source_retry_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb) TO service_role;
COMMIT;
