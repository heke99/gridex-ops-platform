-- Retake only a claim whose batch supplied the durable before-dispatch fence.
SET lock_timeout = '2s';
SET statement_timeout = '30s';
DO $ediel_unstarted_recovery_migration$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'ediel_outbox_recovery_owner_required' USING ERRCODE='42501';
  END IF;
  IF (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.gridex_note_ediel_outbox_batch_v1(jsonb)') AND p.prosecdef)
    IS DISTINCT FROM '792d0133ed8fb830087ff80b17a90b7870c8b94b4749e479ba85905f7d4ce312'
    OR (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.gridex_read_ediel_outbox_batch_v1(uuid,uuid,uuid)') AND p.prosecdef)
    IS DISTINCT FROM 'e5d1604a3917ae5deb00b8f67e4fd4e27498f12e976cda26333e72b10c305570' THEN
    RAISE EXCEPTION 'ediel_outbox_recovery_predecessor_changed' USING ERRCODE='55000';
  END IF;

ALTER TABLE gridex_ediel_outbox_batches.runs
  ADD COLUMN dispatch_fence_version smallint CHECK (dispatch_fence_version=1),
  ADD COLUMN recovered_unstarted_count bigint NOT NULL DEFAULT 0;
ALTER TABLE gridex_ediel_outbox_batches.items
  ADD COLUMN dispatch_started_at timestamptz,
  ADD COLUMN recovered_by_run_id uuid REFERENCES gridex_ediel_outbox_batches.runs(id);

CREATE FUNCTION gridex_ediel_outbox_batches.recover_unstarted_v1(p_run_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'pg_catalog'
AS $recover$
DECLARE
  batch gridex_ediel_outbox_batches.runs;
  candidate record;
  queued bigint := 0;
  stale_before timestamptz := clock_timestamp() - interval '10 minutes';
BEGIN
  SELECT * INTO STRICT batch FROM gridex_ediel_outbox_batches.runs WHERE id=p_run_id;
  IF batch.dispatch_fence_version IS DISTINCT FROM 1 OR batch.finished_at IS NOT NULL
    OR batch.company_id IS NULL OR batch.environment IS NULL THEN
    RAISE EXCEPTION 'ediel_unstarted_recovery_scope_required' USING ERRCODE='42501';
  END IF;

  -- Canonical journal owners take these before message/lease rows.
  PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
  PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
  PERFORM 1 FROM public.user_profiles u WHERE u.id=batch.actor_user_id AND u.user_status='active' FOR SHARE;
  IF NOT FOUND THEN RETURN 0; END IF;
  PERFORM 1 FROM public.company_memberships m
  WHERE m.company_id=batch.company_id AND m.user_id=batch.actor_user_id
    AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL FOR SHARE;
  IF NOT FOUND OR (public.gridex_actor_has_company_permission(batch.actor_user_id,batch.company_id,'communication.send')
      OR public.gridex_actor_has_company_permission(batch.actor_user_id,batch.company_id,'ediel.send')) IS NOT TRUE
    OR NOT EXISTS(SELECT FROM public.canonical_tenant_operation_decision(batch.company_id,
      CASE batch.environment WHEN 'test' THEN 'ediel.test.process' ELSE 'ediel.production.send' END) d WHERE d.allowed) THEN
    RETURN 0;
  END IF;

  FOR candidate IN
    SELECT o.id,o.ediel_message_id,o.current_send_attempt_id,a.run_id,a.started_at,a.worker_id
    FROM public.ediel_outbox o
    JOIN gridex_ediel_outbox_batches.items a ON a.outbox_id=o.id AND a.attempt_id=o.current_send_attempt_id
    JOIN gridex_ediel_outbox_batches.runs prior ON prior.id=a.run_id
    WHERE o.company_id=batch.company_id AND o.environment=batch.environment
      AND a.company_id=o.company_id AND a.environment=o.environment AND a.started_at<stale_before
      AND prior.dispatch_fence_version=1 AND prior.actor_user_id=batch.actor_user_id
      AND (prior.company_id IS NULL OR prior.company_id=o.company_id)
      AND (prior.environment IS NULL OR prior.environment=o.environment)
      AND a.dispatch_started_at IS NULL AND a.outcome IS NULL AND a.recovered_by_run_id IS NULL
      AND o.blocked_reason IS NULL AND o.sent_at IS NULL
      AND (o.status='sending' AND o.last_error IS NULL AND o.locked_at=a.started_at AND o.locked_by=a.worker_id
           OR o.status='delivery_uncertain' AND o.locked_at IS NULL AND o.locked_by IS NULL
             AND o.last_error='stale_sending_lock_requires_transport_reconciliation')
    ORDER BY a.started_at,a.outbox_id LIMIT 25
  LOOP
    -- A direct sender with its own journal is independent of the batch. Lock
    -- the immutable original before checking either journal, even if empty.
    PERFORM 1 FROM public.ediel_messages m
    WHERE m.id=candidate.ediel_message_id AND m.company_id=batch.company_id AND m.environment=batch.environment
      AND m.direction='outbound' AND m.status IN ('draft','prepared','queued','dispatching')
      AND m.immutable_rendered_at IS NOT NULL AND m.raw_payload IS NOT NULL
      AND m.immutable_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
    FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    PERFORM 1 FROM public.ediel_outbox o
    WHERE o.id=candidate.id AND o.company_id=batch.company_id AND o.environment=batch.environment
      AND o.ediel_message_id=candidate.ediel_message_id AND o.current_send_attempt_id=candidate.current_send_attempt_id
      AND o.blocked_reason IS NULL AND o.sent_at IS NULL
      AND (o.status='sending' AND o.last_error IS NULL AND o.locked_at=candidate.started_at AND o.locked_by=candidate.worker_id
           OR o.status='delivery_uncertain' AND o.locked_at IS NULL AND o.locked_by IS NULL
             AND o.last_error='stale_sending_lock_requires_transport_reconciliation')
    FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;

    PERFORM 1 FROM gridex_ediel_outbox_batches.items a
    WHERE a.run_id=candidate.run_id AND a.outbox_id=candidate.id AND a.attempt_id=candidate.current_send_attempt_id
      AND a.dispatch_started_at IS NULL AND a.outcome IS NULL AND a.recovered_by_run_id IS NULL
    FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR gridex_ediel_outbox_claim.actorless_reserved_v1(candidate.id)
      OR EXISTS(SELECT FROM gridex_ediel_transport.reservations g WHERE g.message_id=candidate.ediel_message_id)
      OR EXISTS(SELECT FROM gridex_ediel_transport.attempts g WHERE g.message_id=candidate.ediel_message_id)
      OR EXISTS(SELECT FROM gridex_outbound_dispatch.reservations z WHERE z.message_id=candidate.ediel_message_id)
      OR EXISTS(SELECT FROM gridex_outbound_dispatch.attempts z WHERE z.message_id=candidate.ediel_message_id)
      OR EXISTS(SELECT FROM gridex_outbound_dispatch.events z WHERE z.message_id=candidate.ediel_message_id) THEN
      CONTINUE;
    END IF;

    UPDATE public.ediel_outbox SET status='queued',locked_at=NULL,locked_by=NULL,last_error=NULL,updated_at=clock_timestamp()
    WHERE id=candidate.id AND current_send_attempt_id=candidate.current_send_attempt_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ediel_unstarted_recovery_lease_lost'; END IF;

    UPDATE gridex_ediel_outbox_batches.items
    SET outcome='released_unstarted',finished_at=clock_timestamp(),recovered_by_run_id=p_run_id
    WHERE run_id=candidate.run_id AND outbox_id=candidate.id AND attempt_id=candidate.current_send_attempt_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ediel_unstarted_recovery_receipt_lost'; END IF;
    queued:=queued+1;
  END LOOP;
  RETURN queued;
END
$recover$;
REVOKE ALL ON FUNCTION gridex_ediel_outbox_batches.recover_unstarted_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

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

CREATE OR REPLACE FUNCTION public.gridex_read_ediel_outbox_batch_v1(p_run_id uuid,p_actor_user_id uuid,p_company_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $reader$
  SELECT jsonb_build_object('runId',r.id,'startedAt',r.started_at,'finishedAt',r.finished_at,
    'environment',r.environment,'stoppedBy',r.stop_code,'remainingReady',r.remaining_ready,
    'staleDeliveryUncertain',r.stale_transition_count,'recoveredUnstarted',r.recovered_unstarted_count,'items',
    coalesce((SELECT jsonb_agg(jsonb_build_object('outboxId',i.outbox_id,'attemptId',i.attempt_id,
      'outcome',i.outcome,'delivery',i.delivery) ORDER BY i.started_at,i.outbox_id)
      FROM gridex_ediel_outbox_batches.items i WHERE i.run_id=r.id),'[]'::jsonb))
  FROM gridex_ediel_outbox_batches.runs r
  WHERE r.id=p_run_id AND r.actor_user_id=p_actor_user_id
    AND r.company_id IS NOT DISTINCT FROM p_company_id
    AND current_setting('role',true)='service_role';
$reader$;

END
$ediel_unstarted_recovery_migration$;
RESET statement_timeout;
RESET lock_timeout;
