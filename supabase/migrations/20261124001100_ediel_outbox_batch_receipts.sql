-- Atomically persist the same scope and stale progress as the shared claim.
SET lock_timeout = '2s';
SET statement_timeout = '30s';
DO $ediel_outbox_batch_migration$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'ediel_outbox_batch_owner_required' USING ERRCODE='42501';
  END IF;
  IF (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p
      WHERE p.oid=to_regprocedure('gridex_ediel_outbox_claim.claim_v1(text,uuid,integer,text,interval)')
      AND NOT p.prosecdef)
    IS DISTINCT FROM 'ab1a6b1d11bb377bc91c4fa63bc8fb6c49a7bda39fac7812d734185e0818d357' THEN
    RAISE EXCEPTION 'ediel_outbox_batch_predecessor_changed' USING ERRCODE='55000';
  END IF;
  IF (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.canonical_block_claimed_ediel_outbox_item(uuid,text,text,text,jsonb)')
      AND p.prosecdef)
    IS DISTINCT FROM '22f19e696e750708ec79a40236c7c388056018313b7e817c91cb3be7f3f2319b' THEN
    RAISE EXCEPTION 'ediel_outbox_batch_block_predecessor_changed' USING ERRCODE='55000';
  END IF;

CREATE SCHEMA gridex_ediel_outbox_batches;
REVOKE ALL ON SCHEMA gridex_ediel_outbox_batches FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_ediel_outbox_batches.runs (
  id uuid PRIMARY KEY,actor_user_id uuid NOT NULL,company_id uuid,environment text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz,
  stop_code text,remaining_ready bigint,stale_transition_count bigint NOT NULL DEFAULT 0,
  CHECK(environment IS NULL OR environment IN ('test','production'))
);
CREATE TABLE gridex_ediel_outbox_batches.items (
  run_id uuid REFERENCES gridex_ediel_outbox_batches.runs(id) NOT NULL,
  outbox_id uuid NOT NULL,attempt_id uuid NOT NULL,worker_id text NOT NULL,
  company_id uuid,environment text NOT NULL,
  started_at timestamptz NOT NULL,finished_at timestamptz,
  outcome text,delivery text,
  PRIMARY KEY(run_id,outbox_id,attempt_id),
  UNIQUE(outbox_id,attempt_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA gridex_ediel_outbox_batches FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_note_ediel_outbox_batch_v1(p_event jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  rid uuid:=(p_event->>'runId')::uuid;
  batch gridex_ediel_outbox_batches.runs;
  kind text:=p_event->>'kind';
  oid uuid:=(p_event->>'outboxId')::uuid;
  aid uuid:=(p_event->>'attemptId')::uuid;
  count_ready bigint;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
     OR jsonb_typeof(p_event) IS DISTINCT FROM 'object' OR rid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ediel_outbox_batch_service_required';
  END IF;
  IF kind='start' THEN
    INSERT INTO gridex_ediel_outbox_batches.runs(id,actor_user_id,company_id,environment)
    VALUES(rid,(p_event->>'actorUserId')::uuid,(p_event->>'companyId')::uuid,p_event->>'environment');
    RETURN jsonb_build_object('runId',rid);
  END IF;
  SELECT * INTO STRICT batch FROM gridex_ediel_outbox_batches.runs WHERE id=rid FOR UPDATE;
  IF batch.finished_at IS NOT NULL THEN RAISE EXCEPTION 'ediel_outbox_batch_closed'; END IF;

  IF kind='outcome' THEN
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
  RETURN jsonb_build_object('runId',rid,'remainingReady',count_ready);
END
$function$;
REVOKE ALL ON FUNCTION public.gridex_note_ediel_outbox_batch_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_note_ediel_outbox_batch_v1(jsonb) TO service_role;

CREATE FUNCTION public.gridex_read_ediel_outbox_batch_v1(p_run_id uuid,p_actor_user_id uuid,p_company_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $reader$
  SELECT jsonb_build_object('runId',r.id,'startedAt',r.started_at,'finishedAt',r.finished_at,
    'environment',r.environment,'stoppedBy',r.stop_code,'remainingReady',r.remaining_ready,
    'staleDeliveryUncertain',r.stale_transition_count,'items',
    coalesce((SELECT jsonb_agg(jsonb_build_object('outboxId',i.outbox_id,'attemptId',i.attempt_id,
      'outcome',i.outcome,'delivery',i.delivery) ORDER BY i.started_at,i.outbox_id)
      FROM gridex_ediel_outbox_batches.items i WHERE i.run_id=r.id),'[]'::jsonb))
  FROM gridex_ediel_outbox_batches.runs r
  WHERE r.id=p_run_id AND r.actor_user_id=p_actor_user_id
    AND r.company_id IS NOT DISTINCT FROM p_company_id
    AND current_setting('role',true)='service_role';
$reader$;
REVOKE ALL ON FUNCTION public.gridex_read_ediel_outbox_batch_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_ediel_outbox_batch_v1(uuid,uuid,uuid) TO service_role;

CREATE INDEX ediel_outbox_batch_actor_scope_recent_idx
  ON gridex_ediel_outbox_batches.runs(actor_user_id,company_id,started_at DESC,id DESC);

CREATE FUNCTION public.gridex_list_ediel_outbox_batches_v1(p_actor_user_id uuid,p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
  SELECT coalesce(jsonb_agg(public.gridex_read_ediel_outbox_batch_v1(r.id,p_actor_user_id,p_company_id)
    ORDER BY r.started_at DESC,r.id DESC),'[]'::jsonb)
  FROM (
    SELECT id,started_at FROM gridex_ediel_outbox_batches.runs
    WHERE actor_user_id=p_actor_user_id AND company_id IS NOT DISTINCT FROM p_company_id
      AND current_setting('role',true)='service_role'
    ORDER BY started_at DESC,id DESC LIMIT 20
  ) r;
$function$;

CREATE FUNCTION public.gridex_claim_ediel_outbox_batch_v1(p_run_id uuid,p_worker_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  batch gridex_ediel_outbox_batches.runs;
  progress record;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ediel_outbox_batch_service_required';
  END IF;
  SELECT * INTO STRICT batch FROM gridex_ediel_outbox_batches.runs WHERE id=p_run_id AND finished_at IS NULL FOR UPDATE;
  IF nullif(btrim(p_worker_id),'') IS NULL THEN RAISE EXCEPTION 'ediel_outbox_worker_id_required'; END IF;
  SELECT c.items,c.stale_transition_count INTO STRICT progress
  FROM gridex_ediel_outbox_claim.claim_v1(batch.environment,batch.company_id,1,p_worker_id,interval '10 minutes') c;
  INSERT INTO gridex_ediel_outbox_batches.items(run_id,outbox_id,attempt_id,worker_id,company_id,environment,started_at)
  SELECT p_run_id,o.id,o.current_send_attempt_id,p_worker_id,o.company_id,o.environment,o.locked_at
  FROM unnest(progress.items) o;
  IF progress.stale_transition_count > 0 THEN
    UPDATE gridex_ediel_outbox_batches.runs SET stale_transition_count=stale_transition_count+progress.stale_transition_count
    WHERE id=p_run_id;
  END IF;
  RETURN jsonb_build_object('items',progress.items,'staleTransitionCount',progress.stale_transition_count);
END
$function$;

CREATE FUNCTION public.gridex_block_ediel_outbox_batch_item_v1(
  p_run_id uuid,p_outbox_item_id uuid,p_worker_id text,p_attempt_id uuid,p_reason text,
  p_company_status text,p_operation_decision jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ediel_outbox_batch_service_required';
  END IF;
  PERFORM 1 FROM gridex_ediel_outbox_batches.runs WHERE id=p_run_id AND finished_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ediel_outbox_batch_closed'; END IF;
  UPDATE gridex_ediel_outbox_batches.items
  SET outcome='blocked_tenant_state',finished_at=clock_timestamp()
  WHERE run_id=p_run_id AND outbox_id=p_outbox_item_id AND attempt_id=p_attempt_id
    AND worker_id=p_worker_id AND outcome IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ediel_outbox_batch_item_missing'; END IF;
  IF public.canonical_block_claimed_ediel_outbox_item(
    p_outbox_item_id,p_worker_id,p_reason,p_company_status,p_operation_decision
  ) IS DISTINCT FROM 'blocked_tenant_state' THEN
    RAISE EXCEPTION 'ediel_outbox_claim_block_lock_lost';
  END IF;
  RETURN 'blocked_tenant_state';
END
$function$;

REVOKE ALL ON FUNCTION public.gridex_list_ediel_outbox_batches_v1(uuid,uuid),
  public.gridex_claim_ediel_outbox_batch_v1(uuid,text),
  public.gridex_block_ediel_outbox_batch_item_v1(uuid,uuid,text,uuid,text,text,jsonb)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_list_ediel_outbox_batches_v1(uuid,uuid),
  public.gridex_claim_ediel_outbox_batch_v1(uuid,text),
  public.gridex_block_ediel_outbox_batch_item_v1(uuid,uuid,text,uuid,text,text,jsonb)
TO service_role;

END
$ediel_outbox_batch_migration$;
RESET statement_timeout;
RESET lock_timeout;
