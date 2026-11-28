CREATE TABLE gridex_e66_intake.mixed_worker_attempts (
  source_id uuid NOT NULL,
  transaction_id text NOT NULL,
  lease_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL,
  PRIMARY KEY (source_id,transaction_id),
  FOREIGN KEY (source_id,transaction_id)
    REFERENCES gridex_e66_intake.mixed_accepted_transactions(source_id,transaction_id),
  CHECK ((lease_token IS NULL)=(lease_expires_at IS NULL))
);
REVOKE ALL ON gridex_e66_intake.mixed_worker_attempts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.yield_mixed_worker_attempt_v1(
  p_source uuid,p_ide text,p_worker_lease uuid,p_delay boolean
) RETURNS void LANGUAGE sql SET search_path TO pg_catalog AS $$
  UPDATE gridex_e66_intake.mixed_worker_attempts
    SET lease_token=NULL,lease_expires_at=NULL,
      next_attempt_at=clock_timestamp()+CASE WHEN p_delay THEN interval '60 seconds' ELSE interval '0 seconds' END
  WHERE (source_id,transaction_id,lease_token)=(p_source,p_ide,p_worker_lease)
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.yield_mixed_worker_attempt_v1(uuid,text,uuid,boolean)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.due_mixed_worker_members_v1(
  w gridex_e66_intake.work,p_actor uuid,p_now timestamptz
) RETURNS TABLE(transaction_id text,transaction_index integer,due_at timestamptz)
LANGUAGE sql STABLE SET search_path TO pg_catalog AS $$
  SELECT c.transaction_id,c.transaction_index,coalesce(x.next_attempt_at,w.created_at)
  FROM gridex_e66_intake.mixed_qualification_receipts q
  JOIN gridex_e66_intake.mixed_accepted_transactions c ON c.source_id=q.source_id
  JOIN public.ediel_ack_transaction_results a
    ON (a.company_id,a.environment,a.source_message_id,a.source_transaction_id,a.persisted_series_id)
      =(w.company_id,w.environment,w.source_id,c.transaction_id,c.series_id)
  LEFT JOIN gridex_e66_intake.mixed_worker_attempts x ON (x.source_id,x.transaction_id)=(c.source_id,c.transaction_id)
  WHERE (q.source_id,q.actor_id)=(w.source_id,p_actor)
    AND w.environment='test' AND w.phase='mixed_qualified' AND w.lease_token IS NULL
    AND a.disposition='accepted' AND a.planned_response_type='positive_aperak'
    AND a.persistence_status='persisted' AND a.finalized_at IS NULL
    AND coalesce(x.next_attempt_at,w.created_at)<=p_now
    AND (x.lease_expires_at IS NULL OR x.lease_expires_at<=p_now)
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.due_mixed_worker_members_v1(gridex_e66_intake.work,uuid,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;

-- Candidate TEST port. Existing normalization, recovery, draft and finalization owners retain writes.
CREATE FUNCTION public.gridex_step_mixed_e66_worker_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid,p_action text,
  p_source uuid DEFAULT NULL,p_ide text DEFAULT NULL,p_worker_lease uuid DEFAULT NULL,
  p_draft_lease uuid DEFAULT NULL,p_draft jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE
  candidate record;
  worker_lease uuid;
  cursor_now integer;
  observation_total integer;
  checkpoint jsonb;
  ready jsonb;
  draft_proof jsonb;
  stored jsonb;
  did_progress boolean:=false;
BEGIN
  IF p_environment IS DISTINCT FROM 'test' OR (p_action IN ('claim','advance','store','finish','defer')) IS NOT TRUE THEN
    RAISE EXCEPTION 'mixed_worker_invalid_scope' USING ERRCODE='22023';
  END IF;
  PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
  IF p_action='claim' THEN
    SELECT w.source_id,c.transaction_id INTO candidate
    FROM gridex_e66_intake.work w
    CROSS JOIN LATERAL gridex_e66_intake.due_mixed_worker_members_v1(w,p_actor,statement_timestamp()) c
    WHERE (w.company_id,w.environment,w.mailbox_id)=(p_company,p_environment,p_mailbox)
    ORDER BY c.due_at,w.source_id,c.transaction_index LIMIT 1
    FOR UPDATE OF w SKIP LOCKED;
    IF NOT FOUND THEN RETURN jsonb_build_object('kind','idle'); END IF;
    worker_lease:=gen_random_uuid();
    INSERT INTO gridex_e66_intake.mixed_worker_attempts AS prior
      (source_id,transaction_id,lease_token,lease_expires_at,next_attempt_at)
    VALUES(candidate.source_id,candidate.transaction_id,worker_lease,clock_timestamp()+interval '75 seconds',clock_timestamp())
    ON CONFLICT(source_id,transaction_id) DO UPDATE SET
      lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at,next_attempt_at=excluded.next_attempt_at
      WHERE (prior.lease_expires_at IS NULL OR prior.lease_expires_at<=clock_timestamp())
        AND prior.next_attempt_at<=clock_timestamp();
    IF NOT FOUND THEN RETURN jsonb_build_object('kind','idle'); END IF;
    RETURN jsonb_build_object('kind','claimed','sourceId',candidate.source_id,'transactionId',candidate.transaction_id,'lease',worker_lease);
  END IF;

  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  PERFORM 1 FROM gridex_e66_intake.work w
  JOIN gridex_e66_intake.mixed_qualification_receipts q ON q.source_id=w.source_id AND q.actor_id=p_actor
  JOIN gridex_e66_intake.mixed_worker_attempts x ON x.source_id=w.source_id
  WHERE (w.source_id,w.company_id,w.environment,w.mailbox_id,x.transaction_id,x.lease_token)
    =(p_source,p_company,p_environment,p_mailbox,p_ide,p_worker_lease)
    AND w.phase='mixed_qualified' AND w.lease_token IS NULL AND x.lease_expires_at>clock_timestamp()
  FOR UPDATE OF w,x;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind','held','reason','mixed_worker_lease_unavailable'); END IF;

  IF p_action IN ('finish','defer') THEN
    PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,p_action='defer');
    RETURN jsonb_build_object('kind','yielded');
  END IF;
  IF p_action='store' THEN
    checkpoint:=gridex_e66_intake.seal_mixed_e73_ide_completion_v1(
      p_company,p_environment,p_mailbox,p_source,p_actor,p_ide,p_draft_lease,p_draft->>'rawPayload');
    IF checkpoint->>'status' IS DISTINCT FROM 'ide_preparation_recorded' THEN RETURN checkpoint||'{"kind":"held"}'::jsonb; END IF;
    stored:=gridex_e66_intake.persist_mixed_positive_draft_v1(
      p_company,p_environment,p_mailbox,p_source,p_actor,p_ide,p_draft_lease,p_draft);
    IF stored#>>'{ackMessage,id}' IS NULL THEN
      RAISE EXCEPTION 'mixed_worker_native_draft_unavailable' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('kind','finalize','responseId',stored#>>'{ackMessage,id}');
  END IF;

  IF NOT EXISTS (
    SELECT FROM gridex_e66_metering_stage.mixed_normalization_receipts n
    WHERE (n.source_id,n.transaction_id)=(p_source,p_ide)
  ) THEN
    SELECT n.next_ordinal,n.observation_count INTO cursor_now,observation_total
    FROM gridex_e66_metering_stage.mixed_jobs n WHERE (n.source_id,n.transaction_id)=(p_source,p_ide);
    IF observation_total IS NULL OR cursor_now<observation_total THEN
      checkpoint:=gridex_e66_metering_stage.consume_mixed_chunk_v1(
        p_company,p_environment,p_mailbox,p_source,p_actor,p_ide,coalesce(cursor_now,0),8);
      did_progress:=true;
    END IF;
    IF EXISTS (SELECT FROM gridex_e66_metering_stage.mixed_jobs n WHERE (n.source_id,n.transaction_id)=(p_source,p_ide)
      AND n.next_ordinal<n.observation_count) THEN
      PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,false);
      RETURN jsonb_build_object('kind','progress');
    END IF;
    PERFORM gridex_e66_metering_stage.seal_mixed_normalization_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_ide);
  END IF;

  IF NOT EXISTS (SELECT FROM gridex_e66_intake.mixed_e73_request_basis b WHERE (b.source_id,b.transaction_id)=(p_source,p_ide)) THEN
    IF gridex_e66_intake.read_mixed_e73_evidence_v1(p_company,p_environment,p_source,p_actor,p_ide) IS NULL THEN
      PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,true);
      RETURN jsonb_build_object('kind','held','reason','mixed_worker_e73_basis_unavailable','progress',did_progress);
    END IF;
    PERFORM gridex_e66_intake.seal_mixed_e73_request_basis_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_ide);
  END IF;
  ready:=gridex_e66_intake.read_mixed_e73_ide_readiness_v1(p_company,p_environment,p_source,p_actor,p_ide);
  IF ready->>'status' IS DISTINCT FROM 'ready_for_reply_evaluation' THEN
    PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,true);
    RETURN jsonb_build_object('kind','held','reason',ready->>'status','progress',did_progress);
  END IF;
  IF EXISTS (SELECT FROM gridex_e66_intake.mixed_e73_ide_completions c WHERE (c.source_id,c.transaction_id)=(p_source,p_ide)) THEN
    stored:=gridex_e66_intake.read_mixed_positive_recovery_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_ide);
    IF stored->>'status'='recovered_draft' THEN
      RETURN jsonb_build_object('kind','finalize','responseId',stored->>'ackId');
    END IF;
    PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,true);
    RETURN jsonb_build_object('kind','held','reason',stored->>'reason');
  END IF;
  draft_proof:=gridex_e66_intake.mixed_e73_draft_precondition_v1(
    p_company,p_environment,p_mailbox,p_source,p_actor,p_ide,'claim',NULL);
  IF draft_proof->>'status' IS DISTINCT FROM 'claimed' THEN
    PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,true);
    RETURN draft_proof||'{"kind":"held"}'::jsonb;
  END IF;
  RETURN jsonb_build_object('kind','render','draftLease',draft_proof->>'leaseToken','sourceHash',draft_proof->>'sourceSha256');
END
$$;
REVOKE ALL ON FUNCTION public.gridex_step_mixed_e66_worker_v1(uuid,text,uuid,uuid,text,uuid,text,uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_step_mixed_e66_worker_v1(uuid,text,uuid,uuid,text,uuid,text,uuid,uuid,jsonb)
  TO service_role;

-- Keep the existing scheduler ACL and every ordinary branch on the exact tree.
DO $$
DECLARE
  owner regprocedure:='public.gridex_prepare_e66_scheduler_v1(text,uuid[],uuid,uuid,uuid[],integer)';
  definition text; body text; patched text;
  query_head text:='SELECT w.company_id,w.mailbox_id,min(w.ready_at) AS first_at FROM permitted w';
  due_guard text:='AND ((w.phase=''qualification''';
BEGIN
  SELECT pg_get_functiondef(owner),p.prosrc INTO STRICT definition,body FROM pg_proc p WHERE p.oid=owner;
  IF encode(sha256(convert_to(body,'UTF8')),'hex') <> '8e5488b80c2a2309409b499acd049c4c6208d183820a9b7cef382aed02c8aac3'
    OR strpos(body,query_head)=0 OR strpos(body,due_guard)=0
  THEN RAISE EXCEPTION 'mixed_worker_discovery_preimage_changed: %',encode(sha256(convert_to(body,'UTF8')),'hex'); END IF;
  patched:=replace(body,query_head,$body$SELECT w.company_id,w.mailbox_id,
     min(CASE WHEN w.phase='mixed_qualified' THEN mixed.due_at ELSE w.ready_at END) AS first_at FROM permitted w
   LEFT JOIN LATERAL (
     SELECT min(x.due_at) AS due_at
     FROM gridex_e66_intake.due_mixed_worker_members_v1(w,p_actor,statement_timestamp()) x
   ) mixed ON w.phase='mixed_qualified'$body$);
  patched:=replace(patched,due_guard,'AND (mixed.due_at IS NOT NULL OR (w.phase=''qualification''');
  EXECUTE replace(definition,body,patched);
END
$$;
