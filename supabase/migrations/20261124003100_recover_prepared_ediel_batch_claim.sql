-- Retake an expired prepared journal only through its existing owner.
SET lock_timeout = '2s';
SET statement_timeout = '30s';
DO $ediel_prepared_recovery_migration$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'ediel_outbox_prepared_recovery_owner_required' USING ERRCODE='42501';
  END IF;
  IF (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.gridex_note_ediel_outbox_batch_v1(jsonb)') AND p.prosecdef)
    IS DISTINCT FROM '21c9d392ffd4547fa3798fe870b2cdc0b58e7b96b9e7450511fcfe5da3949969' THEN
    RAISE EXCEPTION 'ediel_outbox_prepared_recovery_predecessor_changed' USING ERRCODE='55000';
  END IF;

CREATE FUNCTION gridex_ediel_outbox_batches.eligible_prepared_v1(c uuid, e text, actor uuid, p_outbox_id uuid DEFAULT NULL)
RETURNS TABLE(outbox_id uuid, message_id uuid, token uuid, lane text, owner_attempt uuid, phase text, release_event uuid)
LANGUAGE sql STABLE SET search_path=pg_catalog AS $eligibility$
 WITH admission AS MATERIALIZED (
   SELECT q.id,q.ediel_message_id,q.current_send_attempt_id,i.worker_id,b.actor_user_id,i.outcome,i.started_at,b.dispatch_fence_version,
     count(*) OVER(PARTITION BY q.id) AS evidence_count
   FROM public.ediel_outbox q
   JOIN gridex_ediel_outbox_batches.items i ON i.company_id=q.company_id AND i.environment=q.environment
     AND i.outbox_id=q.id AND i.attempt_id=q.current_send_attempt_id
   JOIN gridex_ediel_outbox_batches.runs b ON b.id=i.run_id
     AND (b.company_id IS NULL OR b.company_id=q.company_id) AND (b.environment IS NULL OR b.environment=q.environment)
   WHERE q.company_id=c AND q.environment=e AND e IN ('test','production')
     AND (p_outbox_id IS NULL OR q.id=p_outbox_id)
     AND q.blocked_reason IS NULL AND q.sent_at IS NULL
     AND i.dispatch_started_at IS NOT NULL AND i.recovered_by_run_id IS NULL
     AND NOT gridex_ediel_outbox_claim.actorless_reserved_v1(q.id)
     AND (q.status='sending' AND q.last_error IS NULL AND q.locked_at=i.started_at AND q.locked_by=i.worker_id
          OR q.status='delivery_uncertain' AND q.locked_at IS NULL AND q.locked_by IS NULL
            AND q.last_error='stale_sending_lock_requires_transport_reconciliation')
     AND EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
     AND EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=c AND cm.user_id=actor
       AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
     AND (public.gridex_actor_has_company_permission(actor,c,'communication.send')
       OR public.gridex_actor_has_company_permission(actor,c,'ediel.send'))
     AND EXISTS(SELECT FROM public.canonical_tenant_operation_decision(c,
       CASE WHEN e='test' THEN 'ediel.test.process' ELSE 'ediel.production.send' END) ts WHERE ts.allowed)
 ), exact AS MATERIALIZED (
   SELECT a.*,m.immutable_payload_hash AS original_hash,
      jsonb_build_object('kind','worker','outboxId',a.id,'workerId',a.worker_id,
        'sendAttemptId',a.current_send_attempt_id) AS exact_owner
   FROM admission a JOIN public.ediel_messages m ON m.company_id=c AND m.environment=e AND m.id=a.ediel_message_id
   WHERE a.evidence_count=1 AND a.actor_user_id=actor AND a.dispatch_fence_version=1 AND a.outcome IS NULL
     AND a.started_at < statement_timestamp()-interval '10 minutes' AND m.direction='outbound' AND m.status IN ('draft','prepared','queued','dispatching')
     AND m.immutable_rendered_at IS NOT NULL AND m.immutable_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
     AND NOT EXISTS(SELECT FROM gridex_ediel_transport.attempts g WHERE g.company_id=c AND g.environment=e
          AND g.message_id=m.id AND g.entered_at IS NOT NULL)
     AND NOT EXISTS(SELECT FROM gridex_outbound_dispatch.events z WHERE z.company_id=c AND z.environment=e
          AND z.message_id=m.id AND z.kind IN ('provider_call_entered','provider_result'))
 ), candidates AS (
   SELECT x.id,x.ediel_message_id,x.current_send_attempt_id,'generic_journal'::text,a.id attempt_id,r.state,NULL::uuid event_id
   FROM exact x JOIN gridex_ediel_transport.reservations r ON r.message_id=x.ediel_message_id
   JOIN gridex_ediel_transport.attempts a ON a.id=r.attempt_id AND a.message_id=r.message_id AND a.company_id=c
     AND a.environment=e AND a.actor_user_id=actor AND a.owner=x.exact_owner
     AND a.binding->>'originalHash'=x.original_hash AND a.entered_at IS NULL AND a.observed_at IS NULL
   WHERE r.state IN ('prepared','released')
     AND NOT EXISTS(SELECT FROM gridex_outbound_dispatch.reservations z WHERE z.message_id=x.ediel_message_id)
   UNION ALL
   SELECT x.id,x.ediel_message_id,x.current_send_attempt_id,'sealed_z08',a.id,r.state,ev.id
   FROM exact x JOIN gridex_outbound_dispatch.reservations r ON r.message_id=x.ediel_message_id
   JOIN gridex_outbound_dispatch.originals o ON o.message_id=x.ediel_message_id AND o.company_id=c AND o.environment=e
     AND o.payload_hash=x.original_hash AND o.payload_hash=encode(sha256(convert_to(o.raw_payload,'UTF8')),'hex')
   JOIN gridex_outbound_dispatch.attempts a ON a.id=r.attempt_id AND a.message_id=r.message_id AND a.company_id=c
     AND a.environment=e AND a.actor_user_id=actor AND a.owner=x.exact_owner AND a.binding->>'originalHash'=x.original_hash
   JOIN gridex_outbound_dispatch.events ep ON ep.attempt_id=a.id AND ep.message_id=r.message_id AND ep.company_id=c
     AND ep.environment=e AND ep.kind='prepared'
   JOIN gridex_outbound_dispatch.witnesses wp ON wp.event_id=ep.id AND wp.company_id=c AND wp.environment=e
   LEFT JOIN gridex_outbound_dispatch.events ev ON ev.attempt_id=a.id AND ev.message_id=r.message_id AND ev.company_id=c
     AND ev.environment=e AND ev.kind='released' AND ev.facts->>'proof'='entry_never_committed'
   WHERE (r.state='prepared' AND ev.id IS NULL OR r.state='released' AND ev.id IS NOT NULL)
     AND NOT EXISTS(SELECT FROM gridex_ediel_transport.reservations g WHERE g.message_id=x.ediel_message_id)
 )
 SELECT * FROM candidates ORDER BY id LIMIT 25
$eligibility$;

REVOKE ALL ON FUNCTION gridex_ediel_outbox_batches.eligible_prepared_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ediel_outbox_batches.advance_prepared_v1(p_run_id uuid,p_kind text)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path='pg_catalog'
AS $advance$
DECLARE
  batch gridex_ediel_outbox_batches.runs;
  candidate record;
  current_choice record;
  claim_receipt gridex_ediel_outbox_batches.items;
  identity jsonb;
  receipt jsonb;
  changed bigint := 0;
BEGIN
  SELECT * INTO STRICT batch FROM gridex_ediel_outbox_batches.runs WHERE id=p_run_id;
  IF p_kind NOT IN ('release_prepared','requeue_prepared') OR batch.dispatch_fence_version IS DISTINCT FROM 1
    OR batch.finished_at IS NOT NULL OR batch.company_id IS NULL OR batch.environment IS NULL THEN
    RAISE EXCEPTION 'ediel_prepared_recovery_scope_required' USING ERRCODE='42501';
  END IF;

  -- Skip shared graph locks when no matching recovery work is visible.
  -- Eligibility is evaluated again under the owners' graph before any write.
  IF NOT EXISTS(SELECT FROM gridex_ediel_outbox_batches.eligible_prepared_v1(batch.company_id,batch.environment,batch.actor_user_id) c
    WHERE c.phase=CASE p_kind WHEN 'release_prepared' THEN 'prepared' ELSE 'released' END) THEN
    RETURN 0;
  END IF;
  PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
  PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
  FOR candidate IN SELECT * FROM gridex_ediel_outbox_batches.eligible_prepared_v1(batch.company_id,batch.environment,batch.actor_user_id)
  LOOP
    PERFORM 1 FROM public.ediel_messages m
    WHERE m.id=candidate.message_id AND m.company_id=batch.company_id AND m.environment=batch.environment
    FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    -- Match the selected private owner before acquiring the outbox row.
    IF candidate.lane='sealed_z08' THEN
      PERFORM 1 FROM gridex_outbound_dispatch.originals WHERE message_id=candidate.message_id FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN CONTINUE; END IF;
      PERFORM 1 FROM gridex_outbound_dispatch.reservations WHERE message_id=candidate.message_id
        AND attempt_id=candidate.owner_attempt FOR UPDATE SKIP LOCKED;
    ELSE
      PERFORM 1 FROM gridex_ediel_transport.reservations WHERE message_id=candidate.message_id
        AND attempt_id=candidate.owner_attempt FOR UPDATE SKIP LOCKED;
    END IF;
    IF NOT FOUND THEN CONTINUE; END IF;
    PERFORM 1 FROM public.ediel_outbox q WHERE q.id=candidate.outbox_id AND q.company_id=batch.company_id
      AND q.environment=batch.environment AND q.ediel_message_id=candidate.message_id
      AND q.current_send_attempt_id=candidate.token FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT * INTO claim_receipt FROM gridex_ediel_outbox_batches.items i
    WHERE i.outbox_id=candidate.outbox_id AND i.attempt_id=candidate.token
      AND i.company_id=batch.company_id AND i.environment=batch.environment AND i.outcome IS NULL
    FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT * INTO current_choice FROM gridex_ediel_outbox_batches.eligible_prepared_v1(batch.company_id,batch.environment,batch.actor_user_id,candidate.outbox_id) x
    WHERE x.outbox_id=candidate.outbox_id AND x.token=candidate.token AND x.lane=candidate.lane
      AND x.owner_attempt=candidate.owner_attempt AND x.phase=candidate.phase
      AND x.release_event IS NOT DISTINCT FROM candidate.release_event;
    IF NOT FOUND THEN CONTINUE; END IF;

    identity:=jsonb_build_object('companyId',batch.company_id,'environment',batch.environment,'actorUserId',batch.actor_user_id,
      'messageId',candidate.message_id,'attemptId',candidate.owner_attempt);
    IF p_kind='release_prepared' THEN
      IF candidate.phase='released' THEN CONTINUE; END IF;
      IF candidate.lane='generic_journal' THEN
        receipt:=gridex_ediel_transport.mutate_v1(identity||'{"action":"release"}');
        IF receipt->>'state' IS DISTINCT FROM 'released' THEN RAISE EXCEPTION 'ediel_prepared_recovery_generic_release_missing'; END IF;
      ELSE
        receipt:=gridex_outbound_dispatch.mutate_v1(identity||'{"action":"release"}');
        IF receipt->>'kind' IS DISTINCT FROM 'released'
          OR receipt#>>'{facts,proof}' IS DISTINCT FROM 'entry_never_committed' THEN
          RAISE EXCEPTION 'ediel_prepared_recovery_sealed_release_missing';
        END IF;
      END IF;
    ELSE
      IF candidate.phase<>'released' THEN CONTINUE; END IF;
      IF candidate.lane='sealed_z08' THEN
        receipt:=gridex_outbound_dispatch.mutate_v1(identity||
          jsonb_build_object('action','witness','eventId',candidate.release_event));
        IF receipt->>'witnessed' IS DISTINCT FROM 'true' THEN
          RAISE EXCEPTION 'ediel_prepared_recovery_sealed_witness_missing';
        END IF;
      END IF;
      UPDATE public.ediel_outbox
      SET status='queued',locked_at=NULL,locked_by=NULL,last_error=NULL,updated_at=clock_timestamp()
      WHERE id=candidate.outbox_id AND company_id=batch.company_id AND environment=batch.environment
        AND ediel_message_id=candidate.message_id AND current_send_attempt_id=candidate.token;
      IF NOT FOUND THEN RAISE EXCEPTION 'ediel_prepared_recovery_lease_lost'; END IF;
      UPDATE gridex_ediel_outbox_batches.items
      SET outcome='released_before_provider_entry',finished_at=clock_timestamp(),recovered_by_run_id=p_run_id
      WHERE run_id=claim_receipt.run_id AND outbox_id=candidate.outbox_id AND attempt_id=candidate.token AND outcome IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'ediel_prepared_recovery_receipt_lost'; END IF;
    END IF;
    changed:=changed+1;
  END LOOP;
  RETURN changed;
END
$advance$;
REVOKE ALL ON FUNCTION gridex_ediel_outbox_batches.advance_prepared_v1(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.gridex_note_ediel_outbox_batch_v1(p_event jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  rid uuid:=(p_event->>'runId')::uuid;
  batch gridex_ediel_outbox_batches.runs;
  kind text:=p_event->>'kind';
  oid uuid:=(p_event->>'outboxId')::uuid;
  aid uuid:=(p_event->>'attemptId')::uuid;
  count_ready bigint;
  recovered bigint;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
     OR jsonb_typeof(p_event) IS DISTINCT FROM 'object' OR rid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ediel_outbox_batch_service_required';
  END IF;
  IF kind='start' THEN
    INSERT INTO gridex_ediel_outbox_batches.runs(id,actor_user_id,company_id,environment,dispatch_fence_version)
    VALUES(rid,(p_event->>'actorUserId')::uuid,(p_event->>'companyId')::uuid,p_event->>'environment',
      CASE WHEN p_event->'dispatchFenceVersion'='1'::jsonb THEN 1 END);
    RETURN jsonb_build_object('runId',rid);
  END IF;
  SELECT * INTO STRICT batch FROM gridex_ediel_outbox_batches.runs WHERE id=rid FOR UPDATE;
  IF batch.finished_at IS NOT NULL THEN RAISE EXCEPTION 'ediel_outbox_batch_closed'; END IF;

  IF kind='recover_unstarted' THEN
    recovered:=gridex_ediel_outbox_batches.recover_unstarted_v1(rid);
    UPDATE gridex_ediel_outbox_batches.runs
    SET recovered_unstarted_count=recovered_unstarted_count+recovered
    WHERE id=rid;
  ELSIF kind IN ('release_prepared','requeue_prepared') THEN
    recovered:=gridex_ediel_outbox_batches.advance_prepared_v1(rid,kind);
  ELSIF kind='dispatch' THEN
    PERFORM 1 FROM public.ediel_outbox o
    JOIN gridex_ediel_outbox_batches.items a ON a.outbox_id=o.id AND a.attempt_id=o.current_send_attempt_id
    WHERE o.id=oid AND a.run_id=rid AND a.attempt_id=aid AND a.worker_id=p_event->>'workerId'
      AND o.company_id IS NOT DISTINCT FROM a.company_id AND o.environment=a.environment
      AND o.status='sending' AND o.locked_by=a.worker_id AND o.locked_at=a.started_at
      AND o.locked_at>clock_timestamp()-interval '10 minutes'
      AND o.sent_at IS NULL AND a.outcome IS NULL AND a.dispatch_started_at IS NULL
    FOR UPDATE OF o;
    IF batch.dispatch_fence_version IS DISTINCT FROM 1 OR NOT FOUND THEN
      RAISE EXCEPTION 'ediel_outbox_batch_dispatch_not_available' USING ERRCODE='55000';
    END IF;
    UPDATE gridex_ediel_outbox_batches.items
    SET dispatch_started_at=clock_timestamp()
    WHERE run_id=rid AND outbox_id=oid AND attempt_id=aid AND worker_id=p_event->>'workerId'
      AND dispatch_started_at IS NULL AND outcome IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'ediel_outbox_batch_dispatch_not_available' USING ERRCODE='55000'; END IF;
  ELSIF kind='outcome' THEN
    IF coalesce(p_event->>'status','') NOT IN('sent','failed','blocked','delivery_uncertain','dependency_held','local_projection_held','released_unstarted')
      OR (p_event ? 'delivery' AND coalesce(p_event->>'delivery','') NOT IN('new_acceptance','repaired_projection')) THEN
      RAISE EXCEPTION 'ediel_outbox_batch_bad_outcome';
    END IF;
    UPDATE gridex_ediel_outbox_batches.items SET outcome=p_event->>'status',delivery=p_event->>'delivery',finished_at=clock_timestamp()
    WHERE run_id=rid AND outbox_id=oid AND attempt_id=aid AND worker_id=p_event->>'workerId' AND outcome IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'ediel_outbox_batch_item_missing'; END IF;
  ELSIF kind='finish' THEN
    SELECT count(*) INTO count_ready FROM public.ediel_outbox
    WHERE status IN('queued','prepared')
      AND (locked_at IS NULL OR locked_at < now() - interval '10 minutes')
      AND (batch.company_id IS NULL OR company_id=batch.company_id)
      AND (batch.environment IS NULL OR environment=batch.environment)
      AND NOT gridex_ediel_outbox_claim.actorless_reserved_v1(id);
    UPDATE gridex_ediel_outbox_batches.runs SET finished_at=clock_timestamp(),stop_code=p_event->>'reason',remaining_ready=count_ready WHERE id=rid;
  ELSE
    RAISE EXCEPTION 'ediel_outbox_batch_bad_event';
  END IF;
  RETURN jsonb_build_object('runId',rid,'remainingReady',count_ready,'recoveredUnstarted',recovered);
END
$function$;
END
$ediel_prepared_recovery_migration$;
RESET statement_timeout;
RESET lock_timeout;
