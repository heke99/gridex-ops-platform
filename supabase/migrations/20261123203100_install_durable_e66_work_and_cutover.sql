-- Keep the durable E66 owners and their migration receipt in one transaction.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $e66_release_batch$
BEGIN
DO $e66_catalog_install$
BEGIN
CREATE SCHEMA gridex_e66_intake;
REVOKE ALL ON SCHEMA gridex_e66_intake FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE gridex_e66_intake.work (
 source_id uuid PRIMARY KEY, reception_id uuid NOT NULL UNIQUE, company_id uuid NOT NULL, environment text NOT NULL,
 mailbox_id uuid NOT NULL, mail_id uuid NOT NULL, payload_sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE gridex_e66_intake.handoffs (
 job_id uuid PRIMARY KEY, source_id uuid NOT NULL, receipt_id uuid NOT NULL, actor_id uuid NOT NULL, worker_id text NOT NULL,
 claimed_at timestamptz NOT NULL, final_status text NOT NULL
);

CREATE FUNCTION public.gridex_finish_e66_classification_v1(
 p_job uuid, p_company uuid, p_environment text, p_mailbox uuid,
 p_message uuid, p_parse uuid, p_actor uuid, p_worker text, p_claimed_at timestamptz, p_outcome text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.inbound_processing_jobs%rowtype; x public.ediel_messages%rowtype;
 prior gridex_e66_intake.handoffs%rowtype; w gridex_e66_intake.work%rowtype;
 mail public.inbound_email_messages%rowtype; box public.ediel_mailboxes%rowtype;
 receipt jsonb; disposition text; ts timestamptz; mail_id uuid;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_outcome IS NULL OR p_outcome NOT IN ('done','manual_review') OR p_environment IS NULL
   OR p_environment NOT IN('test','production') OR p_worker IS NULL OR p_claimed_at IS NULL OR p_mailbox IS NULL THEN
  RAISE EXCEPTION 'e66_bridge_scope_required' USING ERRCODE='22023';
 END IF;
 PERFORM gridex_ediel_inbound_receptions.authorize_v1(p_company,p_actor,'communication.write');
 -- Discover selectors only. The real reception owner locks source -> mail -> parse -> mailbox.
 SELECT j0.inbound_email_message_id INTO mail_id FROM public.inbound_processing_jobs j0 WHERE j0.id=p_job;
 SELECT * INTO x FROM public.ediel_messages m WHERE m.id=p_message AND m.company_id=p_company FOR UPDATE;
 IF x.id IS NULL OR x.environment IS DISTINCT FROM p_environment OR x.direction IS DISTINCT FROM 'inbound'
  OR x.message_family IS DISTINCT FROM 'UTILTS' OR x.message_code IS DISTINCT FROM 'E66'
  OR x.inbound_email_message_id IS DISTINCT FROM mail_id OR x.mailbox_message_id IS DISTINCT FROM mail_id::text
  OR nullif(x.raw_payload,'') IS NULL THEN RAISE EXCEPTION 'e66_bridge_source_not_owned'; END IF;
 SELECT * INTO mail FROM public.inbound_email_messages m WHERE m.id=mail_id FOR UPDATE;
 IF mail.id IS NULL OR mail.mailbox_id IS DISTINCT FROM p_mailbox OR mail.environment IS DISTINCT FROM p_environment
  OR (mail.company_id IS NOT NULL AND mail.company_id IS DISTINCT FROM p_company) THEN RAISE EXCEPTION 'e66_bridge_mail_scope_changed'; END IF;
 receipt:=public.ediel_record_inbound_reception_v1(p_company,p_message,p_actor,mail_id,p_parse);
 SELECT * INTO box FROM public.ediel_mailboxes b WHERE b.id=p_mailbox FOR SHARE;
 IF box.id IS NULL OR box.environment IS DISTINCT FROM p_environment
   OR (box.company_id IS DISTINCT FROM p_company AND box.is_shared_platform_mailbox IS NOT TRUE)
   OR receipt->>'classification' IS DISTINCT FROM 'first_reception'
   OR receipt->>'status' IS DISTINCT FROM 'observed'
   OR receipt->>'parseResultId' IS DISTINCT FROM p_parse::text
   OR receipt->>'canonicalPayloadHash' IS DISTINCT FROM receipt->>'receivedPayloadHash' THEN
   RAISE EXCEPTION 'e66_bridge_first_reception_required';
 END IF;
 -- Now lock actual classification claim; no status transition on stale/idle authority.
 SELECT * INTO j FROM public.inbound_processing_jobs j0 WHERE j0.id=p_job FOR UPDATE;
 IF j.id IS NULL OR j.mailbox_id IS DISTINCT FROM p_mailbox OR j.inbound_email_message_id IS DISTINCT FROM mail_id
  OR (j.company_id IS NOT NULL AND j.company_id IS DISTINCT FROM p_company) THEN RAISE EXCEPTION 'e66_bridge_job_scope_changed'; END IF;
 SELECT * INTO prior FROM gridex_e66_intake.handoffs h WHERE h.job_id=p_job;
 IF FOUND THEN
  IF prior.source_id IS DISTINCT FROM p_message OR prior.receipt_id::text IS DISTINCT FROM receipt->>'receptionId'
   OR prior.actor_id IS DISTINCT FROM p_actor OR prior.worker_id IS DISTINCT FROM p_worker
   OR prior.claimed_at IS DISTINCT FROM p_claimed_at OR prior.final_status IS DISTINCT FROM p_outcome
   OR j.status IS DISTINCT FROM p_outcome THEN RAISE EXCEPTION 'e66_bridge_replay_conflict'; END IF;
  RETURN jsonb_build_object('sourceId',p_message,'classificationStatus',j.status,'replayed',true);
 END IF;
 IF j.status IS DISTINCT FROM 'processing' OR j.locked_by IS DISTINCT FROM p_worker OR j.locked_at IS DISTINCT FROM p_claimed_at THEN
  RAISE EXCEPTION 'e66_bridge_stale_lease';
 END IF;
 INSERT INTO gridex_e66_intake.work(source_id,reception_id,company_id,environment,mailbox_id,mail_id,payload_sha256)
 VALUES(p_message,(receipt->>'receptionId')::uuid,p_company,p_environment,p_mailbox,mail_id,receipt->>'canonicalPayloadHash')
 ON CONFLICT(source_id) DO NOTHING;
 SELECT * INTO STRICT w FROM gridex_e66_intake.work q WHERE q.source_id=p_message;
 IF (w.reception_id,w.company_id,w.environment,w.mailbox_id,w.mail_id,w.payload_sha256) IS DISTINCT FROM
    ((receipt->>'receptionId')::uuid,p_company,p_environment,p_mailbox,mail_id,receipt->>'canonicalPayloadHash')
 THEN RAISE EXCEPTION 'e66_bridge_work_scope_changed'; END IF;
 ts:=clock_timestamp();
 UPDATE public.inbound_processing_jobs SET status=p_outcome,step=CASE p_outcome WHEN 'done' THEN 'processed' ELSE 'manual_review' END,
   locked_at=NULL,locked_by=NULL,finished_at=ts,updated_at=ts,error_message=NULL,
   review_resolved_at=CASE WHEN p_outcome='manual_review' THEN NULL ELSE review_resolved_at END,
   review_resolution=CASE WHEN p_outcome='manual_review' THEN NULL ELSE review_resolution END,
   review_owner=CASE WHEN p_outcome='manual_review' THEN 'tenant_operations' ELSE review_owner END,
   review_priority=CASE WHEN p_outcome='manual_review' THEN 'normal' ELSE review_priority END,
   review_reason=CASE WHEN p_outcome='manual_review' THEN 'manual_review_unclassified' ELSE review_reason END,
   review_sla_due_at=CASE WHEN p_outcome='manual_review' THEN ts+interval '24 hours' ELSE review_sla_due_at END
 WHERE id=p_job;
 INSERT INTO gridex_e66_intake.handoffs VALUES(p_job,p_message,w.reception_id,p_actor,p_worker,p_claimed_at,p_outcome);
 RETURN jsonb_build_object('sourceId',p_message,'classificationStatus',p_outcome,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.gridex_finish_e66_classification_v1(uuid,uuid,text,uuid,uuid,uuid,uuid,text,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_finish_e66_classification_v1(uuid,uuid,text,uuid,uuid,uuid,uuid,text,timestamptz,text) TO service_role;

CREATE FUNCTION public.gridex_finish_discovered_e66_classification_v1(
 p_job uuid,p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid,p_worker text,
 p_claimed_at timestamptz,p_outcome text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.inbound_processing_jobs%rowtype; m public.inbound_email_messages%rowtype;
 b public.ediel_mailboxes%rowtype; r gridex_ediel_inbound_receptions.receptions%rowtype;
 candidates uuid[]; reception_count bigint; seen_e66 boolean; result jsonb; held_receipt jsonb;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_job IS NULL OR p_mailbox IS NULL OR p_environment IS NULL OR p_environment NOT IN('test','production')
   OR p_worker IS NULL OR p_claimed_at IS NULL OR p_outcome IS NULL OR p_outcome NOT IN('done','manual_review')
 THEN RAISE EXCEPTION 'e66_discovery_scope_required' USING ERRCODE='22023'; END IF;
 PERFORM gridex_ediel_inbound_receptions.authorize_v1(p_company,p_actor,'communication.write');
 SELECT * INTO j FROM public.inbound_processing_jobs jr WHERE jr.id=p_job;
 SELECT * INTO m FROM public.inbound_email_messages mail WHERE mail.id=j.inbound_email_message_id;
 SELECT * INTO b FROM public.ediel_mailboxes box WHERE box.id=m.mailbox_id;
 IF j.id IS NULL OR m.id IS NULL OR b.id IS NULL OR j.mailbox_id IS DISTINCT FROM p_mailbox
  OR m.mailbox_id IS DISTINCT FROM p_mailbox OR m.environment IS DISTINCT FROM p_environment OR b.environment IS DISTINCT FROM p_environment
  OR (j.company_id IS NOT NULL AND j.company_id IS DISTINCT FROM p_company)
  OR (m.company_id IS NOT NULL AND m.company_id IS DISTINCT FROM p_company)
  OR (b.company_id IS DISTINCT FROM p_company AND b.is_shared_platform_mailbox IS NOT TRUE)
 THEN RAISE EXCEPTION 'e66_discovery_scope_changed'; END IF;
 SELECT count(*) INTO reception_count FROM gridex_ediel_inbound_receptions.receptions rr WHERE rr.inbound_email_message_id=m.id;
 IF reception_count>1 THEN RAISE EXCEPTION 'e66_discovery_conflicting_receptions'; END IF;
 SELECT * INTO r FROM gridex_ediel_inbound_receptions.receptions rr WHERE rr.inbound_email_message_id=m.id;
 -- Detect conflicting native selectors without exposing foreign rows or taking locks out of source order.
 SELECT array_agg(e.id ORDER BY e.id) INTO candidates FROM public.ediel_messages e
 WHERE e.direction='inbound' AND e.message_family='UTILTS' AND e.message_code='E66'
   AND (e.inbound_email_message_id=m.id OR e.mailbox_message_id=m.id::text);
 seen_e66:=coalesce(cardinality(candidates),0)>0
  OR (r.scope->>'family' IS NOT DISTINCT FROM 'UTILTS' AND r.scope->>'code' IS NOT DISTINCT FROM 'E66')
  OR EXISTS(SELECT FROM public.inbound_ediel_parse_results p WHERE p.inbound_email_message_id=m.id
    AND p.message_family='UTILTS' AND p.message_code='E66');
 IF seen_e66 THEN
  IF r.id IS NULL THEN RAISE EXCEPTION 'e66_discovery_first_reception_missing'; END IF;
  IF r.classification IN ('protocol_duplicate','identity_conflict')
   AND r.company_id=p_company AND r.environment=p_environment AND r.transport_source_snapshot->>'mailboxId'=p_mailbox::text
   AND r.scope->>'family'='UTILTS' AND r.scope->>'code'='E66' AND coalesce(cardinality(candidates),0)=0 THEN
   held_receipt:=public.ediel_record_inbound_reception_v1(p_company,r.source_message_id,p_actor,m.id,r.parse_result_id);
   IF held_receipt->>'receptionId' IS DISTINCT FROM r.id::text OR held_receipt->>'classification' IS DISTINCT FROM r.classification
      OR held_receipt->>'status' IS DISTINCT FROM 'held' THEN
    RAISE EXCEPTION 'e66_discovery_conflicting_reception';
   END IF;
   SELECT * INTO j FROM public.inbound_processing_jobs jr WHERE jr.id=p_job AND jr.inbound_email_message_id=m.id
    AND jr.mailbox_id=p_mailbox AND (jr.company_id IS NULL OR jr.company_id=p_company) FOR SHARE;
   IF j.status IS DISTINCT FROM 'processing' OR j.locked_by IS DISTINCT FROM p_worker OR j.locked_at IS DISTINCT FROM p_claimed_at
   THEN RAISE EXCEPTION 'e66_bridge_stale_lease'; END IF;
   IF EXISTS(SELECT FROM public.ediel_messages e WHERE e.direction='inbound' AND e.message_family='UTILTS'
       AND e.message_code='E66' AND (e.inbound_email_message_id=m.id OR e.mailbox_message_id=m.id::text)) THEN
    RAISE EXCEPTION 'e66_discovery_conflicting_reception';
   END IF;
   RETURN jsonb_build_object('kind','held_legacy','classification',r.classification);
  END IF;
  IF r.classification IS DISTINCT FROM 'first_reception' OR r.company_id IS DISTINCT FROM p_company
    OR r.environment IS DISTINCT FROM p_environment OR r.transport_source_snapshot->>'mailboxId' IS DISTINCT FROM p_mailbox::text
    OR r.scope->>'family' IS DISTINCT FROM 'UTILTS' OR r.scope->>'code' IS DISTINCT FROM 'E66'
    OR candidates IS DISTINCT FROM ARRAY[r.source_message_id]
  THEN RAISE EXCEPTION 'e66_discovery_conflicting_reception'; END IF;
  result:=public.gridex_finish_e66_classification_v1(p_job,p_company,p_environment,p_mailbox,r.source_message_id,r.parse_result_id,
     p_actor,p_worker,p_claimed_at,p_outcome);
  -- Owner now holds source, mail and claim. Abort the same transaction
  -- if a competing selector appeared before those locks were taken.
  IF EXISTS(SELECT FROM public.ediel_messages e WHERE e.id<>r.source_message_id
    AND e.direction='inbound' AND e.message_family='UTILTS' AND e.message_code='E66'
    AND (e.inbound_email_message_id=m.id OR e.mailbox_message_id=m.id::text)) THEN
   RAISE EXCEPTION 'e66_discovery_conflicting_reception';
  END IF;
  RETURN jsonb_build_object('kind','completed')||result;
 END IF;
 -- No eligible work is a read outcome. Validate the current claim and keep the legacy CAS with its owner.
 SELECT * INTO j FROM public.inbound_processing_jobs jr WHERE jr.id=p_job AND jr.inbound_email_message_id=m.id
  AND jr.mailbox_id=p_mailbox AND (jr.company_id IS NULL OR jr.company_id=p_company) FOR SHARE;
 IF j.status IS DISTINCT FROM 'processing' OR j.locked_by IS DISTINCT FROM p_worker OR j.locked_at IS DISTINCT FROM p_claimed_at
 THEN RAISE EXCEPTION 'e66_bridge_stale_lease'; END IF;
 RETURN jsonb_build_object('kind','no_eligible');
END $$;
REVOKE ALL ON FUNCTION public.gridex_finish_discovered_e66_classification_v1(uuid,uuid,text,uuid,uuid,text,timestamptz,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_finish_discovered_e66_classification_v1(uuid,uuid,text,uuid,uuid,text,timestamptz,text)
 TO service_role;

-- This separate probe mounts the ordinary native metering writer in an isolated
-- working state. The fixture caller initializes the job and its lease.
CREATE SCHEMA gridex_e66_metering_stage;
REVOKE ALL ON SCHEMA gridex_e66_metering_stage FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE gridex_e66_metering_stage.jobs (
  source_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),
  company_id uuid NOT NULL,
  environment text NOT NULL,
  transaction_id text NOT NULL,
  raw_hash text NOT NULL,
  contract_hash text NOT NULL,
  observation_count integer NOT NULL CHECK(observation_count>0),
  next_ordinal integer NOT NULL DEFAULT 0 CHECK(next_ordinal>=0 AND next_ordinal<=observation_count),
  worker_id uuid NOT NULL,
  lease_token uuid NOT NULL,
  lease_until timestamptz NOT NULL
);
CREATE TABLE gridex_e66_metering_stage.effects (
  source_id uuid NOT NULL REFERENCES gridex_e66_metering_stage.jobs(source_id),
  ordinal integer NOT NULL,
  metering_id uuid NOT NULL REFERENCES public.metering_values(id),
  normalized_id uuid NOT NULL REFERENCES public.normalized_metering_values(id),
  PRIMARY KEY(source_id,ordinal)
);

CREATE FUNCTION public.gridex_consume_unassigned_e66_metering_v1(
 p_company uuid, p_environment text, p_source uuid, p_actor uuid, p_lease uuid, p_next integer, p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job gridex_e66_metering_stage.jobs%rowtype; owned_contract jsonb; saved public.metering_values%rowtype;
 normalized_id uuid; target_ordinal integer; stop_ordinal integer;
BEGIN
 IF coalesce(current_setting('role',true),'') <> 'service_role' AND session_user <> 'service_role'
 THEN RAISE EXCEPTION 'stage_probe_service_required' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 8
 THEN RAISE EXCEPTION 'stage_probe_invalid_limit' USING ERRCODE='22023'; END IF;
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 SELECT * INTO job FROM gridex_e66_metering_stage.jobs j
 WHERE j.source_id=p_source AND j.company_id=p_company AND j.environment=p_environment
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'stage_probe_job_unavailable' USING ERRCODE='P0002'; END IF;
 IF job.worker_id IS DISTINCT FROM p_actor OR job.lease_token IS DISTINCT FROM p_lease
  OR job.lease_until<=clock_timestamp() OR job.next_ordinal IS DISTINCT FROM p_next
 THEN RAISE EXCEPTION 'stage_probe_stale' USING ERRCODE='P0001'; END IF;
 owned_contract:=gridex_utilts_binding.stored_contract_v1(job.company_id,job.source_id,job.transaction_id);
 IF jsonb_array_length(owned_contract->'observations') IS DISTINCT FROM job.observation_count
  OR NOT EXISTS (
   SELECT FROM gridex_utilts_binding.receipts r
   JOIN gridex_utilts_binding.contracts c ON c.company_id=r.company_id AND c.source_message_id=r.source_message_id
   WHERE r.company_id=job.company_id AND r.environment=job.environment AND r.source_message_id=job.source_id
    AND r.raw_hash=job.raw_hash AND c.contract_hash=job.contract_hash AND c.contract=owned_contract
  ) THEN RAISE EXCEPTION 'stage_probe_receipt_changed' USING ERRCODE='23514'; END IF;
 stop_ordinal:=least(job.next_ordinal+p_limit,job.observation_count);
 FOR target_ordinal IN job.next_ordinal..stop_ordinal-1 LOOP
  SELECT * INTO STRICT saved FROM public.gridex_consume_utilts_metering_v1(
   job.company_id,job.source_id,job.transaction_id,target_ordinal,p_actor,owned_contract
  );
  SELECT n.id INTO STRICT normalized_id FROM public.normalized_metering_values n
  WHERE n.company_id=job.company_id AND n.source_message_id=job.source_id
    AND n.source_metering_value_id=saved.id AND n.revision_status='current';
  INSERT INTO gridex_e66_metering_stage.effects VALUES(job.source_id,target_ordinal,saved.id,normalized_id);
 END LOOP;
 IF job.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'stage_probe_expired' USING ERRCODE='P0001'; END IF;
 UPDATE gridex_e66_metering_stage.jobs SET next_ordinal=stop_ordinal WHERE source_id=job.source_id;
 RETURN jsonb_build_object('nextOrdinal',stop_ordinal);
END $$;
REVOKE ALL ON FUNCTION public.gridex_consume_unassigned_e66_metering_v1(uuid,text,uuid,uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_consume_unassigned_e66_metering_v1(uuid,text,uuid,uuid,uuid,integer,integer) TO service_role;

ALTER TABLE gridex_e66_intake.work
 ADD COLUMN lease_actor uuid, ADD COLUMN lease_token uuid, ADD COLUMN lease_until timestamptz,
 ADD COLUMN ready_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 ADD COLUMN phase text NOT NULL DEFAULT 'normalization',
 ADD CONSTRAINT e66_one_lease CHECK ((lease_token IS NULL)=(lease_actor IS NULL) AND (lease_token IS NULL)=(lease_until IS NULL));

CREATE FUNCTION gridex_e66_intake.require_dispatch_scope(c uuid, e text, b uuid, a uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 PERFORM gridex_ediel_inbound_receptions.authorize_v1(c,a,'communication.write');
 PERFORM gridex_utilts_binding.require_execution_actor_v1(c,a);
 PERFORM 1 FROM public.ediel_mailboxes x WHERE x.id=b AND x.environment=e
  AND (x.company_id=c OR x.is_shared_platform_mailbox IS TRUE) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'e66_dispatch_scope_required' USING ERRCODE='42501'; END IF;
END $$;

-- The adoption row remains the only mutable lease authority. Business actions
-- requalify the source after a separate short dispatch transaction.
CREATE FUNCTION public.gridex_claim_e66_normalization_v1(p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_e66_intake.work%rowtype;
BEGIN
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT x.* INTO w FROM gridex_e66_intake.work x
 JOIN gridex_ediel_inbound_receptions.receptions rr ON rr.id=x.reception_id AND rr.source_message_id=x.source_id
 JOIN gridex_utilts_binding.receipts r ON r.source_message_id=x.source_id AND r.company_id=x.company_id AND r.environment=x.environment
 JOIN public.ediel_messages m ON m.id=x.source_id AND m.company_id=x.company_id AND m.environment=x.environment
 WHERE x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox
  AND x.phase='normalization' AND x.ready_at<=clock_timestamp() AND (x.lease_until IS NULL OR x.lease_until<=clock_timestamp())
  AND m.raw_payload IS NOT NULL AND m.direction='inbound' AND m.message_family='UTILTS' AND m.message_code='E66'
  AND rr.company_id=p_company AND rr.environment=p_environment AND rr.inbound_email_message_id=x.mail_id
  AND rr.classification='first_reception' AND rr.canonical_payload_hash=x.payload_sha256
  AND r.raw_hash=x.payload_sha256 AND r.message_code='E66' AND jsonb_array_length(r.membership)=1
  AND EXISTS(SELECT FROM public.ediel_ack_transaction_results a WHERE a.company_id=x.company_id AND a.environment=x.environment
      AND a.source_message_id=x.source_id AND a.source_transaction_id=r.membership->>0
      AND a.disposition='accepted' AND a.persistence_status='persisted' AND a.planned_response_type='positive_aperak' AND a.persisted_series_id IS NOT NULL)
 ORDER BY x.ready_at,x.source_id LIMIT 1 FOR UPDATE OF x SKIP LOCKED;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','idle'); END IF;
 UPDATE gridex_e66_intake.work x SET lease_actor=p_actor,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'
 WHERE x.source_id=w.source_id RETURNING x.* INTO w;
 RETURN jsonb_build_object('kind','claimed','sourceId',w.source_id,'leaseToken',w.lease_token,'leaseUntil',w.lease_until);
END $$;

CREATE FUNCTION public.gridex_read_e66_normalization_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_e66_intake.work%rowtype; next integer;
BEGIN
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT * INTO w FROM gridex_e66_intake.work x WHERE x.source_id=p_source AND x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox FOR SHARE;
 IF NOT FOUND OR w.phase IS DISTINCT FROM 'normalization' OR w.lease_actor IS DISTINCT FROM p_actor
   OR w.lease_token IS NULL OR w.lease_token IS DISTINCT FROM p_lease OR w.lease_until<=clock_timestamp()
 THEN RAISE EXCEPTION 'e66_dispatch_stale' USING ERRCODE='P0001'; END IF;
 SELECT j.next_ordinal INTO next FROM gridex_e66_metering_stage.jobs j WHERE j.source_id=w.source_id;
 RETURN jsonb_build_object('sourceId',w.source_id,'nextOrdinal',coalesce(next,0),'leaseUntil',w.lease_until);
END $$;
REVOKE ALL ON FUNCTION gridex_e66_intake.require_dispatch_scope(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gridex_claim_e66_normalization_v1(uuid,text,uuid,uuid),
 public.gridex_read_e66_normalization_v1(uuid,text,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_claim_e66_normalization_v1(uuid,text,uuid,uuid),
 public.gridex_read_e66_normalization_v1(uuid,text,uuid,uuid,uuid,uuid) TO service_role;

DO $actor$
DECLARE original record; guarded_body text;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata INTO STRICT original
 FROM pg_proc p WHERE p.oid=to_regprocedure('public.gridex_consume_utilts_metering_v1(uuid,uuid,text,integer,uuid,jsonb)');
 IF md5(original.prosrc) IS DISTINCT FROM 'e2bb02f0ec69925e1714ee58856907e8'
 THEN RAISE EXCEPTION 'e66_application_receipt_actor_preimage_changed'; END IF;
 guarded_body:=replace(replace(original.prosrc,
   ' PERFORM gridex_utilts_binding.lock_storage_graph_v1();',E' PERFORM gridex_utilts_binding.lock_storage_graph_v1();\n PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company_id,p_actor_id);'),' RETURN v_result;',E' PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company_id,p_actor_id);\n RETURN v_result;');
 IF md5(guarded_body) IS DISTINCT FROM '01a23c06db9d8c542727201576d7c0af'
 THEN RAISE EXCEPTION 'e66_application_receipt_actor_candidate_changed'; END IF;
 EXECUTE replace(original.definition,original.prosrc,guarded_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=original.oid) IS DISTINCT FROM original.metadata
 THEN RAISE EXCEPTION 'e66_application_receipt_actor_metadata_changed'; END IF;
END
$actor$;
-- Private physical donor. Uses the exact actor-guarded normalizer implementation
-- once. The public façade keeps its OID and PostgreSQL metadata.
DO $guard$
DECLARE original record; replacement text;
 old_signature constant text := 'FUNCTION public.gridex_consume_utilts_metering_v1(';
 private_signature constant text := 'FUNCTION gridex_e66_intake.consume_owned_e66_meter_v1(';
 public_body constant text := $body$
BEGIN
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 -- The receiver takes this same row FOR UPDATE before native work admission.
 -- Reading the work owner after this wait prevents an older invocation from
 -- making a second materialization after that admission commits.
 PERFORM 1 FROM public.ediel_messages s
  WHERE s.id=p_source_message_id AND s.company_id=p_company_id FOR SHARE;
 IF EXISTS(SELECT FROM gridex_e66_intake.work w
    WHERE w.source_id=p_source_message_id AND w.company_id=p_company_id)
 THEN RAISE EXCEPTION 'e66_normalization_owned_by_durable_worker' USING ERRCODE='55000'; END IF;
 RETURN gridex_e66_intake.consume_owned_e66_meter_v1(
  p_company_id,p_source_message_id,p_transaction_id,p_observation_ordinal,p_actor_id,p_expected_contract);
END
$body$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata INTO STRICT original
 FROM pg_proc p WHERE oid=to_regprocedure('public.gridex_consume_utilts_metering_v1(uuid,uuid,text,integer,uuid,jsonb)');
 IF md5(original.prosrc) IS DISTINCT FROM '01a23c06db9d8c542727201576d7c0af'
  OR (length(original.definition)-length(replace(original.definition,old_signature,'')))/length(old_signature)<>1
  OR (length(original.definition)-length(replace(original.definition,original.prosrc,'')))/length(original.prosrc)<>1
 THEN RAISE EXCEPTION 'e66_normalization_owner_predecessor_changed'; END IF;
 EXECUTE replace(original.definition,old_signature,private_signature);
 REVOKE ALL ON FUNCTION gridex_e66_intake.consume_owned_e66_meter_v1(uuid,uuid,text,integer,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
 replacement:=replace(original.definition,original.prosrc,public_body);
 EXECUTE replacement;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=original.oid) IS DISTINCT FROM original.metadata
  OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=original.oid) IS DISTINCT FROM public_body
  OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid='gridex_e66_intake.consume_owned_e66_meter_v1(uuid,uuid,text,integer,uuid,jsonb)'::regprocedure)
    IS DISTINCT FROM original.prosrc
 THEN RAISE EXCEPTION 'e66_normalization_owner_metadata_changed'; END IF;
END
$guard$;

DROP FUNCTION public.gridex_consume_unassigned_e66_metering_v1(uuid,text,uuid,uuid,uuid,integer,integer);
ALTER TABLE gridex_e66_metering_stage.jobs DROP COLUMN worker_id, DROP COLUMN lease_token, DROP COLUMN lease_until;
CREATE FUNCTION public.gridex_consume_dispatched_e66_metering_v1(
 p_company uuid, p_environment text, p_mailbox uuid, p_source uuid, p_actor uuid, p_lease uuid, p_next integer, p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_e66_intake.work%rowtype; job gridex_e66_metering_stage.jobs%rowtype; owned_contract jsonb; saved public.metering_values%rowtype;
 normalized_id uuid; target_ordinal integer; stop_ordinal integer;
BEGIN
 IF coalesce(current_setting('role',true),'') <> 'service_role' AND session_user <> 'service_role'
 THEN RAISE EXCEPTION 'stage_probe_service_required' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 8
 THEN RAISE EXCEPTION 'stage_probe_invalid_limit' USING ERRCODE='22023'; END IF;
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT * INTO w FROM gridex_e66_intake.work x WHERE x.source_id=p_source AND x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox FOR UPDATE;
 IF w.source_id IS NULL OR w.phase IS DISTINCT FROM 'normalization' OR w.lease_actor IS DISTINCT FROM p_actor
   OR w.lease_token IS NULL OR w.lease_token IS DISTINCT FROM p_lease OR w.lease_until<=clock_timestamp()
 THEN RAISE EXCEPTION 'e66_dispatch_stale' USING ERRCODE='P0001'; END IF;
 INSERT INTO gridex_e66_metering_stage.jobs(source_id,company_id,environment,transaction_id,raw_hash,contract_hash,observation_count)
 SELECT r.source_message_id,r.company_id,r.environment,c.transaction_id,r.raw_hash,c.contract_hash,jsonb_array_length(c.contract->'observations')
 FROM gridex_utilts_binding.receipts r JOIN gridex_utilts_binding.contracts c ON c.source_message_id=r.source_message_id AND c.company_id=r.company_id AND c.environment=r.environment
 WHERE r.source_message_id=w.source_id AND r.company_id=w.company_id AND r.environment=w.environment AND r.raw_hash=w.payload_sha256
   AND r.membership=jsonb_build_array(c.transaction_id) AND jsonb_array_length(c.contract->'observations')>0
 ON CONFLICT(source_id) DO NOTHING;

 SELECT * INTO job FROM gridex_e66_metering_stage.jobs j
 WHERE j.source_id=p_source AND j.company_id=p_company AND j.environment=p_environment
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'stage_probe_job_unavailable' USING ERRCODE='P0002'; END IF;
 IF job.next_ordinal IS DISTINCT FROM p_next OR job.raw_hash IS DISTINCT FROM w.payload_sha256
 THEN RAISE EXCEPTION 'stage_probe_stale' USING ERRCODE='P0001'; END IF;
 owned_contract:=gridex_utilts_binding.stored_contract_v1(job.company_id,job.source_id,job.transaction_id);
 IF jsonb_array_length(owned_contract->'observations') IS DISTINCT FROM job.observation_count
  OR NOT EXISTS (
   SELECT FROM gridex_utilts_binding.receipts r
   JOIN gridex_utilts_binding.contracts c ON c.company_id=r.company_id AND c.source_message_id=r.source_message_id
   WHERE r.company_id=job.company_id AND r.environment=job.environment AND r.source_message_id=job.source_id
    AND r.raw_hash=job.raw_hash AND c.contract_hash=job.contract_hash AND c.contract=owned_contract
  ) THEN RAISE EXCEPTION 'stage_probe_receipt_changed' USING ERRCODE='23514'; END IF;
 stop_ordinal:=least(job.next_ordinal+p_limit,job.observation_count);
 FOR target_ordinal IN job.next_ordinal..stop_ordinal-1 LOOP
  SELECT * INTO STRICT saved FROM gridex_e66_intake.consume_owned_e66_meter_v1(
   job.company_id,job.source_id,job.transaction_id,target_ordinal,p_actor,owned_contract
  );
  SELECT n.id INTO STRICT normalized_id FROM public.normalized_metering_values n
  WHERE n.company_id=job.company_id AND n.source_message_id=job.source_id
    AND n.source_metering_value_id=saved.id AND n.revision_status='current';
  INSERT INTO gridex_e66_metering_stage.effects VALUES(job.source_id,target_ordinal,saved.id,normalized_id);
 END LOOP;
 IF w.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'stage_probe_expired' USING ERRCODE='P0001'; END IF;
 UPDATE gridex_e66_metering_stage.jobs SET next_ordinal=stop_ordinal WHERE source_id=job.source_id;
 IF stop_ordinal=job.observation_count THEN
  UPDATE gridex_e66_intake.work SET phase='readiness',lease_actor=NULL,lease_token=NULL,lease_until=NULL
  WHERE source_id=p_source;
 END IF;
 RETURN jsonb_build_object('nextOrdinal',stop_ordinal);
END $$;

REVOKE ALL ON FUNCTION public.gridex_consume_dispatched_e66_metering_v1(uuid,text,uuid,uuid,uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_consume_dispatched_e66_metering_v1(uuid,text,uuid,uuid,uuid,uuid,integer,integer) TO service_role;

ALTER TABLE gridex_e66_intake.work ALTER COLUMN phase SET DEFAULT 'qualification';
CREATE TABLE gridex_e66_intake.qualified (
 source_id uuid PRIMARY KEY REFERENCES gridex_e66_intake.work(source_id),
 actor uuid NOT NULL, lease uuid NOT NULL, command_hash text NOT NULL,
 transaction_id text NOT NULL, series_id uuid NOT NULL, contract_hash text NOT NULL,
 qualified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION public.gridex_claim_e66_qualification_v1(p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_e66_intake.work%rowtype;
BEGIN
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT x.* INTO w FROM gridex_e66_intake.work x
 JOIN gridex_ediel_inbound_receptions.receptions rr ON rr.id=x.reception_id AND rr.source_message_id=x.source_id
 JOIN public.ediel_messages m ON m.id=x.source_id AND m.company_id=x.company_id AND m.environment=x.environment
 WHERE x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox
  AND x.phase='qualification' AND x.ready_at<=clock_timestamp() AND (x.lease_until IS NULL OR x.lease_until<=clock_timestamp())
  AND m.raw_payload IS NOT NULL AND m.direction='inbound' AND m.message_family='UTILTS' AND m.message_code='E66'
  AND rr.company_id=p_company AND rr.environment=p_environment AND rr.inbound_email_message_id=x.mail_id
  AND rr.classification='first_reception' AND rr.canonical_payload_hash=x.payload_sha256
 ORDER BY x.ready_at,x.source_id LIMIT 1 FOR UPDATE OF x SKIP LOCKED;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','idle'); END IF;
 UPDATE gridex_e66_intake.work x SET lease_actor=p_actor,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'
 WHERE x.source_id=w.source_id RETURNING x.* INTO w;
 RETURN jsonb_build_object('kind','claimed','phase',w.phase,'sourceId',w.source_id,'leaseToken',w.lease_token,'leaseUntil',w.lease_until);
END $$;

CREATE FUNCTION public.gridex_commit_e66_qualification_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,p_transactions jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_e66_intake.work%rowtype; q gridex_e66_intake.qualified%rowtype;
 source public.ediel_messages%rowtype; command_hash text; tx_id text; series uuid; contract_hash text;
BEGIN
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT * INTO w FROM gridex_e66_intake.work x
 WHERE x.source_id=p_source AND x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox FOR UPDATE;
 IF w.source_id IS NULL OR p_lease IS NULL OR jsonb_typeof(p_transactions) IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_transactions)<>1 THEN RAISE EXCEPTION 'e66_qualification_scope_required' USING ERRCODE='22023'; END IF;
 tx_id:=p_transactions#>>'{0,transactionId}';
 IF nullif(tx_id,'') IS NULL THEN RAISE EXCEPTION 'e66_qualification_scope_required' USING ERRCODE='22023'; END IF;
 SELECT * INTO source FROM public.ediel_messages m WHERE m.id=p_source AND m.company_id=p_company AND m.environment=p_environment FOR UPDATE;
 IF source.id IS NULL OR source.direction IS DISTINCT FROM 'inbound' OR source.message_family IS DISTINCT FROM 'UTILTS' OR source.message_code IS DISTINCT FROM 'E66'
   OR encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') IS DISTINCT FROM w.payload_sha256
   OR NOT EXISTS(SELECT FROM gridex_ediel_inbound_receptions.receptions r WHERE r.id=w.reception_id AND r.source_message_id=w.source_id
       AND r.company_id=p_company AND r.environment=p_environment AND r.inbound_email_message_id=w.mail_id
       AND r.classification='first_reception' AND r.canonical_payload_hash=w.payload_sha256)
 THEN RAISE EXCEPTION 'e66_qualification_source_changed'; END IF;
 command_hash:=encode(sha256(convert_to(p_transactions::text,'UTF8')),'hex');
 SELECT * INTO q FROM gridex_e66_intake.qualified x WHERE x.source_id=w.source_id;
 IF FOUND THEN
  IF q.actor IS DISTINCT FROM p_actor OR q.lease IS DISTINCT FROM p_lease OR q.command_hash IS DISTINCT FROM command_hash
   OR w.phase='qualification' THEN RAISE EXCEPTION 'e66_qualification_stale'; END IF;
 ELSE
  IF w.phase IS DISTINCT FROM 'qualification' OR w.lease_actor IS DISTINCT FROM p_actor
    OR w.lease_token IS DISTINCT FROM p_lease OR w.lease_until<=clock_timestamp()
  THEN RAISE EXCEPTION 'e66_qualification_stale'; END IF;
  IF EXISTS(SELECT FROM gridex_utilts_binding.receipts r WHERE r.source_message_id=p_source)
  THEN RAISE EXCEPTION 'e66_qualification_prior_owner_uncertain'; END IF;
  -- The ordinary native owner validates and writes the physical series/contract/ACK plan.
  PERFORM public.gridex_persist_utilts_consumption_v1(p_company,p_environment,p_source,'E66',source.raw_payload,p_transactions,p_actor);
 END IF;
 SELECT a.persisted_series_id,c.contract_hash INTO series,contract_hash
 FROM gridex_utilts_binding.receipts r JOIN public.ediel_ack_transaction_results a
   ON a.source_message_id=r.source_message_id AND a.company_id=r.company_id AND a.environment=r.environment
 JOIN gridex_utilts_binding.contracts c ON c.series_id=a.persisted_series_id AND c.company_id=r.company_id AND c.environment=r.environment
 WHERE r.source_message_id=w.source_id AND r.company_id=w.company_id AND r.environment=w.environment AND r.raw_hash=w.payload_sha256
   AND r.membership=jsonb_build_array(tx_id) AND a.source_transaction_id=tx_id AND c.transaction_id=tx_id
   AND a.disposition='accepted' AND a.planned_response_type='positive_aperak' AND a.persistence_status='persisted'
   AND (a.final_response_type IS NULL OR a.final_response_type='positive_aperak')
   AND c.source_message_id=w.source_id AND jsonb_array_length(c.contract->'observations')>0;
 IF series IS NULL OR contract_hash IS NULL THEN RAISE EXCEPTION 'e66_qualification_unavailable'; END IF;
 IF q.source_id IS NOT NULL THEN
  IF (q.transaction_id,q.series_id,q.contract_hash) IS DISTINCT FROM (tx_id,series,contract_hash)
  THEN RAISE EXCEPTION 'e66_qualification_unavailable'; END IF;
  RETURN jsonb_build_object('kind','qualified','transactionId',q.transaction_id,'seriesId',q.series_id,
    'contractHash',q.contract_hash,'replayed',true);
 END IF;
 IF w.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'e66_qualification_stale'; END IF;
 INSERT INTO gridex_e66_intake.qualified(source_id,actor,lease,command_hash,transaction_id,series_id,contract_hash)
 VALUES(p_source,p_actor,p_lease,command_hash,tx_id,series,contract_hash);
 UPDATE gridex_e66_intake.work SET phase='normalization',lease_actor=NULL,lease_token=NULL,lease_until=NULL
 WHERE source_id=p_source;
 RETURN jsonb_build_object('kind','qualified','transactionId',tx_id,'seriesId',series,'contractHash',contract_hash,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.gridex_claim_e66_qualification_v1(uuid,text,uuid,uuid),
 public.gridex_commit_e66_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_claim_e66_qualification_v1(uuid,text,uuid,uuid),
 public.gridex_commit_e66_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb) TO service_role;

CREATE FUNCTION public.gridex_read_e66_work_progress_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_e66_intake.work%rowtype; expected integer; next integer;
BEGIN
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT * INTO w FROM gridex_e66_intake.work x
 WHERE x.source_id=p_source AND x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox FOR SHARE;
 IF w.source_id IS NULL OR w.phase IS DISTINCT FROM 'normalization' OR w.lease_actor IS DISTINCT FROM p_actor
   OR p_lease IS NULL OR w.lease_token IS DISTINCT FROM p_lease OR w.lease_until<=clock_timestamp()
 THEN RAISE EXCEPTION 'e66_dispatch_stale' USING ERRCODE='P0001'; END IF;
 SELECT jsonb_array_length(c.contract->'observations'),coalesce(j.next_ordinal,0)
 INTO expected,next
 FROM gridex_e66_intake.qualified q
 JOIN gridex_utilts_binding.contracts c ON c.source_message_id=q.source_id AND c.series_id=q.series_id
   AND c.company_id=w.company_id AND c.environment=w.environment AND c.contract_hash=q.contract_hash
   AND c.transaction_id=q.transaction_id
 LEFT JOIN gridex_e66_metering_stage.jobs j ON j.source_id=q.source_id
 WHERE q.source_id=w.source_id AND
   (j.source_id IS NULL OR (j.company_id,j.environment,j.transaction_id,j.raw_hash,j.contract_hash,j.observation_count)
      IS NOT DISTINCT FROM (w.company_id,w.environment,c.transaction_id,w.payload_sha256,c.contract_hash,
        jsonb_array_length(c.contract->'observations')));
 IF expected IS NULL OR expected<=0 OR next<0 OR next>=expected
 THEN RAISE EXCEPTION 'e66_dispatch_progress_unavailable' USING ERRCODE='P0U01'; END IF;
 RETURN jsonb_build_object('sourceId',w.source_id,'nextOrdinal',next,'observationCount',expected);
END $$;

CREATE FUNCTION public.gridex_yield_e66_normalization_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,p_next integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_e66_intake.work%rowtype;
BEGIN
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT * INTO w FROM gridex_e66_intake.work x
 WHERE x.source_id=p_source AND x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox FOR UPDATE;
 IF w.source_id IS NULL OR w.phase IS DISTINCT FROM 'normalization' OR w.lease_actor IS DISTINCT FROM p_actor
   OR p_lease IS NULL OR w.lease_token IS DISTINCT FROM p_lease OR w.lease_until<=clock_timestamp()
   OR NOT EXISTS(SELECT FROM gridex_e66_metering_stage.jobs j WHERE j.source_id=w.source_id AND j.company_id=w.company_id
     AND j.environment=w.environment AND j.raw_hash=w.payload_sha256 AND j.next_ordinal=p_next
     AND j.next_ordinal>0 AND j.next_ordinal<j.observation_count)
 THEN RAISE EXCEPTION 'e66_dispatch_stale' USING ERRCODE='P0001'; END IF;
 UPDATE gridex_e66_intake.work SET lease_actor=NULL,lease_token=NULL,lease_until=NULL,ready_at=clock_timestamp()
 WHERE source_id=w.source_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.gridex_read_e66_work_progress_v1(uuid,text,uuid,uuid,uuid,uuid),
 public.gridex_yield_e66_normalization_v1(uuid,text,uuid,uuid,uuid,uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_e66_work_progress_v1(uuid,text,uuid,uuid,uuid,uuid),
 public.gridex_yield_e66_normalization_v1(uuid,text,uuid,uuid,uuid,uuid,integer) TO service_role;

-- Preserve the existing published ABI and keep the single canonical writer.
DO $migration$
DECLARE
 original record;
 qualification record;
 old_signature constant text := 'FUNCTION public.gridex_persist_utilts_consumption_v1(';
 owned_signature constant text := 'FUNCTION gridex_e66_intake.persist_owned_utilts_v1(';
 old_invocation constant text := 'PERFORM public.gridex_persist_utilts_consumption_v1(';
 owned_invocation constant text := 'PERFORM gridex_e66_intake.persist_owned_utilts_v1(';
 public_body constant text := $body$
DECLARE source public.ediel_messages%rowtype;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role'
    AND current_user<>'service_role' AND session_user<>'service_role'
 THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 SELECT * INTO source FROM public.ediel_messages
  WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF source.id IS NULL OR source.environment IS DISTINCT FROM p_environment OR source.direction IS DISTINCT FROM 'inbound'
  OR source.message_family IS DISTINCT FROM 'UTILTS' OR source.message_code IS DISTINCT FROM p_message_code
  OR source.raw_payload IS DISTINCT FROM p_raw_payload
 THEN RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01'; END IF;
 PERFORM gridex_utilts_binding.require_execution_actor_v1(p_company_id,p_actor_user_id);
 -- Admission holds the same source row until its durable work is committed.
 -- An older app request already waiting on it must observe the new owner.
 IF p_message_code='E66' AND EXISTS(
    SELECT FROM gridex_e66_intake.work w
     WHERE w.source_id=p_source_message_id AND w.company_id=p_company_id AND w.environment=p_environment
 ) THEN RAISE EXCEPTION 'e66_persistence_owned_by_durable_worker' USING ERRCODE='55000'; END IF;
 RETURN gridex_e66_intake.persist_owned_utilts_v1(
   p_company_id,p_environment,p_source_message_id,p_message_code,p_raw_payload,p_transactions,p_actor_user_id);
END
$body$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
 INTO STRICT original FROM pg_proc p
 WHERE p.oid=to_regprocedure('public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb,uuid)');
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
 INTO STRICT qualification FROM pg_proc p
 WHERE p.oid=to_regprocedure('public.gridex_commit_e66_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb)');
 IF md5(original.prosrc) IS DISTINCT FROM '2f3ea8b4f861d02e93be3582b1fad5f1'
  OR (length(original.definition)-length(replace(original.definition,old_signature,'')))/length(old_signature)<>1
  OR (length(original.definition)-length(replace(original.definition,original.prosrc,'')))/length(original.prosrc)<>1
  OR (length(qualification.prosrc)-length(replace(qualification.prosrc,old_invocation,'')))/length(old_invocation)<>1
 THEN RAISE EXCEPTION 'e66_persistence_owner_predecessor_changed'; END IF;
 EXECUTE replace(original.definition,old_signature,owned_signature);
 REVOKE ALL ON FUNCTION gridex_e66_intake.persist_owned_utilts_v1(uuid,text,uuid,text,text,jsonb,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
 EXECUTE replace(original.definition,original.prosrc,public_body);
 EXECUTE replace(qualification.definition,old_invocation,owned_invocation);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=original.oid) IS DISTINCT FROM original.metadata
    OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=qualification.oid) IS DISTINCT FROM qualification.metadata
    OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=to_regprocedure(
       'gridex_e66_intake.persist_owned_utilts_v1(uuid,text,uuid,text,text,jsonb,uuid)')) IS DISTINCT FROM original.prosrc
 THEN RAISE EXCEPTION 'e66_persistence_owner_metadata_changed'; END IF;
END
$migration$;

END
$e66_catalog_install$;

DO $e66_catalog_install$
BEGIN
ALTER TABLE gridex_e66_metering_stage.jobs ADD COLUMN ready_ordinal integer NOT NULL DEFAULT 0
 CHECK (ready_ordinal >= 0 AND ready_ordinal <= next_ordinal);

CREATE FUNCTION public.gridex_claim_e66_readiness_v1(p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_e66_intake.work%rowtype; ready integer;
BEGIN
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT x.* INTO w FROM gridex_e66_intake.work x
 JOIN gridex_e66_intake.qualified q ON q.source_id=x.source_id
 JOIN gridex_e66_metering_stage.jobs j ON j.source_id=x.source_id AND j.company_id=x.company_id
  AND j.environment=x.environment AND j.raw_hash=x.payload_sha256
  AND j.transaction_id=q.transaction_id AND j.contract_hash=q.contract_hash
 WHERE x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox AND x.phase='readiness'
  AND x.ready_at<=clock_timestamp() AND (x.lease_until IS NULL OR x.lease_until<=clock_timestamp())
  AND j.next_ordinal=j.observation_count
 ORDER BY x.ready_at,x.source_id LIMIT 1 FOR UPDATE OF x SKIP LOCKED;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','idle'); END IF;
 UPDATE gridex_e66_intake.work x
 SET lease_actor=p_actor,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'
 WHERE x.source_id=w.source_id RETURNING x.* INTO w;
 SELECT j.ready_ordinal INTO STRICT ready FROM gridex_e66_metering_stage.jobs j WHERE j.source_id=w.source_id;
 RETURN jsonb_build_object('kind','claimed','phase',w.phase,'sourceId',w.source_id,'leaseToken',w.lease_token,'leaseUntil',w.lease_until,'nextOrdinal',ready);
END $$;

CREATE FUNCTION public.gridex_commit_e66_readiness_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,
 p_next integer,p_metering_id uuid,p_normalized_id uuid,p_gate jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_e66_intake.work%rowtype; j gridex_e66_metering_stage.jobs%rowtype;
BEGIN
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT * INTO w FROM gridex_e66_intake.work x
 WHERE x.source_id=p_source AND x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox FOR UPDATE;
 IF w.phase IS DISTINCT FROM 'readiness' OR w.lease_actor IS DISTINCT FROM p_actor OR p_lease IS NULL
   OR w.lease_token IS DISTINCT FROM p_lease OR w.lease_until<=clock_timestamp()
 THEN RAISE EXCEPTION 'e66_readiness_stale'; END IF;
 SELECT * INTO j FROM gridex_e66_metering_stage.jobs x
 WHERE x.source_id=p_source AND x.company_id=p_company AND x.environment=p_environment AND x.raw_hash=w.payload_sha256 FOR UPDATE;
 IF NOT FOUND OR j.next_ordinal<>j.observation_count OR j.ready_ordinal IS DISTINCT FROM p_next OR p_next>=j.observation_count
   OR NOT EXISTS(SELECT FROM gridex_e66_intake.qualified q
    WHERE q.source_id=p_source AND q.transaction_id=j.transaction_id AND q.contract_hash=j.contract_hash)
   OR NOT EXISTS(SELECT FROM gridex_e66_metering_stage.effects e
    WHERE e.source_id=p_source AND (e.ordinal,e.metering_id,e.normalized_id)=(p_next,p_metering_id,p_normalized_id))
   OR jsonb_typeof(p_gate) IS DISTINCT FROM 'object'
   OR p_gate->>'source_message_id' IS DISTINCT FROM p_source::text
   OR p_gate->>'billing_status' IS DISTINCT FROM 'billable'
   OR p_gate->>'billing_gate_status' IS DISTINCT FROM 'eligible'
 THEN RAISE EXCEPTION 'e66_readiness_unavailable' USING ERRCODE='P0U01'; END IF;
 PERFORM public.gridex_set_metering_billing_gate(p_company,p_metering_id,p_normalized_id,p_gate);
 IF w.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'e66_readiness_stale'; END IF;
 UPDATE gridex_e66_metering_stage.jobs SET ready_ordinal=p_next+1 WHERE source_id=p_source;
 RETURN jsonb_build_object('nextOrdinal',p_next+1);
END $$;
REVOKE ALL ON FUNCTION public.gridex_claim_e66_readiness_v1(uuid,text,uuid,uuid),
 public.gridex_commit_e66_readiness_v1(uuid,text,uuid,uuid,uuid,uuid,integer,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_claim_e66_readiness_v1(uuid,text,uuid,uuid),
 public.gridex_commit_e66_readiness_v1(uuid,text,uuid,uuid,uuid,uuid,integer,uuid,uuid,jsonb) TO service_role;

CREATE TABLE gridex_e66_intake.completions (
 source_id uuid PRIMARY KEY REFERENCES gridex_e66_intake.work(source_id),
 company_id uuid NOT NULL, environment text NOT NULL, source_sha256 text NOT NULL,
 transaction_id text NOT NULL, contract_hash text NOT NULL, observation_count integer NOT NULL,
 seal_actor uuid NOT NULL, seal_lease uuid NOT NULL, sealed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION public.gridex_seal_e66_completion_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j gridex_e66_metering_stage.jobs%rowtype; w gridex_e66_intake.work%rowtype; c jsonb; expected integer; actual integer; done gridex_e66_intake.completions%rowtype;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT * INTO w FROM gridex_e66_intake.work x WHERE x.source_id=p_source AND x.company_id=p_company
  AND x.environment=p_environment AND x.mailbox_id=p_mailbox FOR UPDATE;
 SELECT * INTO done FROM gridex_e66_intake.completions x WHERE x.source_id=p_source;
 IF p_lease IS NULL OR w.source_id IS NULL OR
   (done.source_id IS NULL AND (w.phase IS DISTINCT FROM 'readiness' OR w.lease_actor IS DISTINCT FROM p_actor
    OR w.lease_token IS DISTINCT FROM p_lease OR w.lease_until<=clock_timestamp())) OR
   (done.source_id IS NOT NULL AND (w.phase IS DISTINCT FROM 'complete'
    OR done.seal_actor IS DISTINCT FROM p_actor OR done.seal_lease IS DISTINCT FROM p_lease))
 THEN RAISE EXCEPTION 'e66_completion_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT * INTO j FROM gridex_e66_metering_stage.jobs x WHERE x.source_id=p_source AND x.company_id=p_company AND x.environment=p_environment FOR UPDATE;
 IF j.source_id IS NULL OR j.raw_hash IS DISTINCT FROM w.payload_sha256
   OR j.next_ordinal<>j.observation_count OR j.ready_ordinal<>j.observation_count
   OR NOT EXISTS(SELECT FROM gridex_e66_intake.qualified q WHERE q.source_id=p_source
    AND q.transaction_id=j.transaction_id AND q.contract_hash=j.contract_hash)
 THEN RAISE EXCEPTION 'e66_completion_unavailable' USING ERRCODE='P0U01'; END IF;
 -- This source admission is pinned to a single current IDE in this fixture.
 IF NOT EXISTS(SELECT FROM gridex_utilts_binding.receipts r JOIN gridex_utilts_binding.contracts c ON c.company_id=r.company_id
   AND c.source_message_id=r.source_message_id AND c.environment=r.environment
   WHERE r.company_id=p_company AND r.environment=p_environment AND r.source_message_id=p_source AND r.raw_hash=w.payload_sha256
     AND r.membership=jsonb_build_array(j.transaction_id) AND c.transaction_id=j.transaction_id AND c.contract_hash=j.contract_hash)
 THEN RAISE EXCEPTION 'e66_completion_unavailable' USING ERRCODE='P0U01'; END IF;
 c:=gridex_utilts_binding.stored_contract_v1(p_company,p_source,j.transaction_id);
 expected:=jsonb_array_length(c->'observations');
 IF expected IS DISTINCT FROM j.observation_count OR expected<1 OR c#>>'{billing,capability}' IS DISTINCT FROM 'skip' THEN RAISE EXCEPTION 'e66_completion_unavailable' USING ERRCODE='P0U01'; END IF;
 -- Check every exact ordinal/readiness pair, not meter_value_count or arrival order.
 PERFORM m.id FROM gridex_e66_metering_stage.effects e JOIN public.metering_values m ON m.id=e.metering_id AND m.company_id=p_company
  WHERE e.source_id=p_source ORDER BY m.id FOR SHARE OF m;
 PERFORM n.id FROM gridex_e66_metering_stage.effects e JOIN public.normalized_metering_values n ON n.id=e.normalized_id AND n.company_id=p_company
  WHERE e.source_id=p_source ORDER BY n.id FOR SHARE OF n;
 SELECT count(*) INTO actual FROM jsonb_array_elements(c->'observations') WITH ORDINALITY o(v,i)
 JOIN gridex_e66_metering_stage.effects e ON e.source_id=p_source AND e.ordinal=o.i-1
 JOIN public.metering_values m ON m.id=e.metering_id AND m.company_id=p_company AND m.source_ediel_message_id=p_source
 JOIN public.normalized_metering_values n ON n.id=e.normalized_id AND n.company_id=p_company AND n.source_metering_value_id=m.id
    AND n.source_message_id=p_source
 WHERE m.is_current AND m.revision_status='current' AND n.revision_status='current'
  AND m.source_transaction_reference=j.transaction_id AND n.source_transaction_reference=j.transaction_id
  AND m.raw_payload->'sourceOrdinal'=o.v->'sourceOrdinal' AND n.raw_payload->'sourceOrdinal'=o.v->'sourceOrdinal'
  AND m.billing_status='billable' AND m.billing_gate_status='eligible' AND n.billing_status='billable' AND n.billing_gate_status='eligible'
  AND m.billing_gate_snapshot=n.billing_gate_snapshot
  AND n.billing_gate_snapshot#>>'{supply_source_basis,qualified}'='true'
  AND n.billing_gate_snapshot#>>'{supply_source_basis,periodId}'=n.supply_period_id::text
  AND n.billing_gate_snapshot#>>'{source_basis,qualified}'='true'
  AND n.billing_gate_snapshot#>>'{source_basis,sourcePayloadHash}'=j.raw_hash
  AND n.billing_gate_snapshot#>>'{source_basis,contractHash}'=j.contract_hash
  AND n.billing_gate_snapshot#>>'{source_basis,observationOrdinal}'=e.ordinal::text;
 IF actual<>expected OR (SELECT count(*) FROM gridex_e66_metering_stage.effects e WHERE e.source_id=p_source)<>expected
   OR (done.source_id IS NULL AND w.lease_until<=clock_timestamp())
 THEN RAISE EXCEPTION 'e66_completion_unavailable' USING ERRCODE='P0U01'; END IF;
 IF done.source_id IS NULL THEN
  INSERT INTO gridex_e66_intake.completions(source_id,company_id,environment,source_sha256,
   transaction_id,contract_hash,observation_count,seal_actor,seal_lease)
  VALUES(p_source,p_company,p_environment,j.raw_hash,j.transaction_id,j.contract_hash,expected,p_actor,p_lease);
  UPDATE gridex_e66_intake.work SET phase='complete',lease_actor=NULL,lease_token=NULL,lease_until=NULL
  WHERE source_id=p_source;
 ELSIF (done.company_id,done.environment,done.source_sha256,done.transaction_id,done.contract_hash,done.observation_count)
  IS DISTINCT FROM (p_company,p_environment,j.raw_hash,j.transaction_id,j.contract_hash,expected)
 THEN RAISE EXCEPTION 'e66_completion_unavailable' USING ERRCODE='P0U01'; END IF;
 RETURN expected;
END $$;
REVOKE ALL ON FUNCTION public.gridex_seal_e66_completion_v1(uuid,text,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_seal_e66_completion_v1(uuid,text,uuid,uuid,uuid,uuid) TO service_role;

DO $$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('gridex_utilts_binding.require_positive_storage_authority_v1(uuid,text,uuid,text,uuid,text)')) IS DISTINCT FROM '34956f0b8dc5acc18283c6e528f88b0b' THEN RAISE EXCEPTION 'positive_ack_authority_preimage_changed'; END IF;
END $$;
CREATE OR REPLACE FUNCTION gridex_utilts_binding.require_positive_storage_authority_v1(p_company_id uuid, p_environment text, p_source_message_id uuid, p_transaction_id text, p_ack_message_id uuid DEFAULT NULL::uuid, p_ack_raw_payload text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    SET "TimeZone" TO 'UTC'
    AS $$
DECLARE
 source public.ediel_messages%rowtype; ack public.ediel_messages%rowtype;
 receipt gridex_utilts_binding.receipts%rowtype; origin gridex_utilts_binding.receipts%rowtype;
 reservation public.ediel_ack_transaction_results%rowtype;
 series public.meter_reading_series%rowtype; stored gridex_utilts_binding.contracts%rowtype;
 tokens jsonb; ack_tokens jsonb; source_hash text; ack_hash text; document_id text;
BEGIN
 IF p_company_id IS NULL OR p_environment NOT IN ('test','production') OR p_source_message_id IS NULL
 OR nullif(p_transaction_id,'') IS NULL OR (p_ack_message_id IS NULL)<>(p_ack_raw_payload IS NULL) THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01';
 END IF;
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id AND environment=p_environment FOR SHARE;
 IF NOT FOUND OR source.direction<>'inbound' OR source.message_family<>'UTILTS' OR source.raw_payload IS NULL THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 source_hash:=encode(digest(convert_to(source.raw_payload,'UTF8'),'sha256'),'hex');
 SELECT * INTO receipt FROM gridex_utilts_binding.receipts WHERE source_message_id=source.id;
 IF NOT FOUND OR receipt.company_id IS DISTINCT FROM p_company_id OR receipt.environment IS DISTINCT FROM p_environment
 OR receipt.raw_hash IS DISTINCT FROM source_hash OR receipt.source_context IS DISTINCT FROM gridex_utilts_binding.source_context_v1(source)
 OR NOT receipt.membership ? p_transaction_id THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(source.raw_payload);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) t
  WHERE t->>'tag'='IDE' AND t#>>'{elements,1,0}'='24' AND t#>>'{elements,2,0}'=p_transaction_id)<>1 THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT * INTO reservation FROM public.ediel_ack_transaction_results WHERE company_id=p_company_id AND environment=p_environment
  AND source_message_id=source.id AND source_transaction_id=p_transaction_id FOR SHARE;
 IF NOT FOUND OR reservation.disposition IS DISTINCT FROM 'accepted' OR reservation.planned_response_type IS DISTINCT FROM 'positive_aperak'
 OR reservation.persistence_status IS DISTINCT FROM 'persisted' OR reservation.persisted_series_id IS NULL
 OR (reservation.final_response_type IS NOT NULL AND reservation.final_response_type<>'positive_aperak') THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT * INTO series FROM public.meter_reading_series WHERE id=reservation.persisted_series_id AND company_id=p_company_id FOR SHARE;
 IF NOT FOUND OR series.message_code IS DISTINCT FROM source.message_code OR series.source_transaction_reference IS DISTINCT FROM p_transaction_id
 OR jsonb_typeof(series.raw_transaction) IS DISTINCT FROM 'object'
 OR series.immutable_hash IS DISTINCT FROM encode(digest(convert_to(series.raw_transaction::text,'UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 -- Identical old/late accepted data can legitimately reuse an earlier series.
 -- Its genuine source/contract origin stays authoritative; is_current is not an
 -- acceptance criterion and must not silently reject old-late-positive ACKs.
 SELECT * INTO origin FROM gridex_utilts_binding.receipts WHERE source_message_id=series.source_ediel_message_id;
 SELECT * INTO stored FROM gridex_utilts_binding.contracts WHERE series_id=series.id;
 IF origin.source_message_id IS NULL OR stored.series_id IS NULL OR origin.company_id IS DISTINCT FROM p_company_id
 OR origin.environment IS DISTINCT FROM p_environment OR origin.message_code IS DISTINCT FROM source.message_code
 OR stored.company_id IS DISTINCT FROM p_company_id OR stored.environment IS DISTINCT FROM p_environment
 OR stored.source_message_id IS DISTINCT FROM origin.source_message_id OR stored.transaction_id IS DISTINCT FROM p_transaction_id
 OR stored.contract_version NOT IN (1,2) OR stored.contract->>'version' IS DISTINCT FROM stored.contract_version::text
 OR NOT coalesce(gridex_utilts_binding.validate_contract_v1(stored.contract),false)
 OR stored.contract_hash IS DISTINCT FROM encode(digest(convert_to(stored.contract::text,'UTF8'),'sha256'),'hex')
 OR stored.contract IS DISTINCT FROM series.raw_transaction->'consumptionContract' THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 IF source.message_code='E66' AND EXISTS(SELECT FROM gridex_e66_intake.work w WHERE w.source_id=source.id) THEN
  IF NOT EXISTS(SELECT FROM gridex_e66_intake.work w
   JOIN gridex_e66_intake.completions d ON d.source_id=w.source_id AND d.company_id=w.company_id
    AND d.environment=w.environment AND d.source_sha256=w.payload_sha256
   WHERE w.source_id=source.id AND w.company_id=p_company_id AND w.environment=p_environment AND w.phase='complete'
    AND w.payload_sha256=source_hash AND d.transaction_id=p_transaction_id AND d.contract_hash=stored.contract_hash
    AND d.observation_count=jsonb_array_length(stored.contract->'observations')) THEN
   RAISE EXCEPTION 'e66_completion_unavailable' USING ERRCODE='P0U01'; END IF;
 END IF;
 IF p_ack_message_id IS NOT NULL THEN
  SELECT * INTO ack FROM public.ediel_messages WHERE id=p_ack_message_id AND company_id=p_company_id AND environment=p_environment FOR SHARE;
  IF NOT FOUND OR ack.direction<>'outbound' OR ack.message_family<>'APERAK' OR ack.related_message_id IS DISTINCT FROM source.id
  OR ack.raw_payload IS DISTINCT FROM p_ack_raw_payload OR reservation.final_response_type IS DISTINCT FROM 'positive_aperak'
  OR reservation.response_message_id IS DISTINCT FROM ack.id OR reservation.finalized_at IS NULL THEN
   RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
  ack_tokens:=gridex_utilts_binding.wire_tokens_v1(ack.raw_payload);
  SELECT t#>>'{elements,2,0}' INTO document_id FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM';
  IF ack_tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='UNH'
    AND t#>>'{elements,2,0}'='APERAK' AND t#>>'{elements,2,2}'='04A' AND t#>>'{elements,2,4}'='E5SE5A')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='312')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW' AND t#>>'{elements,1,1}'=p_transaction_id)<>1
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW' AND t#>>'{elements,1,1}'=p_transaction_id)
   OR (SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='DM')
      <>(SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW')
   OR EXISTS(SELECT FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='DM'
       AND (nullif(t#>>'{elements,1,1}','') IS NULL OR length(t#>>'{elements,1,1}')>35 OR btrim(t#>>'{elements,1,1}') IS DISTINCT FROM t#>>'{elements,1,1}'))
   OR EXISTS(SELECT t#>>'{elements,1,1}' FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='DM'
       GROUP BY t#>>'{elements,1,1}' HAVING count(*)>1)
   OR (SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='DOC' AND t#>>'{elements,2,0}'=document_id)<>1 THEN
   RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
  ack_hash:=encode(digest(convert_to(ack.raw_payload,'UTF8'),'sha256'),'hex');
 END IF;
 IF p_ack_message_id IS NOT NULL AND EXISTS(SELECT FROM gridex_ediel_inbound_context.receipts x WHERE x.company_id=p_company_id AND x.source_message_id=source.id AND x.environment=p_environment AND x.status='ready' AND x.context->>'actorRole' IN('energy_service_company','esco')) THEN
  PERFORM gridex_ediel_ack_replay.require_positive_service_scope_v1(p_company_id,p_environment,source.id,ack.raw_payload);
 END IF;
 RETURN jsonb_build_object('authorityVersion',1,'companyId',p_company_id,'environment',p_environment,'sourceMessageId',source.id,
  'transactionId',p_transaction_id,'sourceRawHash',source_hash,'ackMessageId',p_ack_message_id,'ackRawHash',ack_hash);
END $$;

-- A successful insert can precede request completion. Such retries may reuse
-- only the row bearing the original business projection and contributors.
-- Workflow status, readiness annotations and audit actors remain mutable.
CREATE OR REPLACE FUNCTION public.gridex_consume_utilts_billing_v1(p_company_id uuid,p_source_message_id uuid,p_actor_id uuid,p_expected_contracts jsonb)
RETURNS public.billing_underlays LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE v_transaction text; v_contract jsonb; v_context jsonb; v_contracts jsonb:='[]'; v_total numeric:=0; v_ordinal jsonb;
 v_result public.billing_underlays%rowtype; v_source public.ediel_messages%rowtype;
BEGIN
 SELECT s.* INTO v_source FROM public.ediel_messages s WHERE s.id=p_source_message_id AND s.company_id=p_company_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'utilts_consumption_source_unavailable' USING ERRCODE='P0U01'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('utilts-billing|'||p_company_id::text||'|'||p_source_message_id::text,0));
 FOR v_transaction IN SELECT a.source_transaction_id FROM public.ediel_ack_transaction_results a
  WHERE a.source_message_id=p_source_message_id AND a.company_id=p_company_id AND a.environment=v_source.environment
  AND a.disposition='accepted' AND a.persistence_status='persisted' ORDER BY a.source_transaction_id LOOP
  v_contract:=gridex_utilts_binding.stored_contract_v1(p_company_id,p_source_message_id,v_transaction);
  IF v_contract#>>'{billing,capability}' IS DISTINCT FROM 'write' THEN RAISE EXCEPTION 'utilts_consumption_billing_context_mismatch' USING ERRCODE='P0U01'; END IF;
  IF v_context IS NULL THEN v_context:=v_contract->'billing';
  ELSIF v_context IS DISTINCT FROM v_contract->'billing' THEN RAISE EXCEPTION 'utilts_consumption_billing_context_mismatch' USING ERRCODE='P0U01'; END IF;
  FOR v_ordinal IN SELECT value FROM jsonb_array_elements(v_contract->'billingContributionOrdinals') LOOP
   v_total:=v_total+(v_contract->'observations'->((v_ordinal#>>'{}')::integer)->>'quantity')::numeric;
  END LOOP;
  v_contracts:=v_contracts||jsonb_build_array(v_contract);
 END LOOP;
 IF v_context IS NULL THEN RAISE EXCEPTION 'utilts_consumption_billing_missing' USING ERRCODE='P0U01'; END IF;
 IF jsonb_typeof(p_expected_contracts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'utilts_consumption_returned_contract_changed' USING ERRCODE='P0U01'; END IF;
 IF (SELECT jsonb_agg(e.value ORDER BY e.value->>'transactionId') FROM jsonb_array_elements(p_expected_contracts) e) IS DISTINCT FROM v_contracts THEN
  RAISE EXCEPTION 'utilts_consumption_returned_contract_changed' USING ERRCODE='P0U01'; END IF;
 PERFORM gridex_utilts_binding.lock_attribution_v1(p_company_id,v_context,true);
 SELECT b.* INTO v_result FROM public.billing_underlays b WHERE b.company_id=p_company_id AND b.source_system='ediel_utilts'
  AND b.payload->>'edielMessageId'=p_source_message_id::text ORDER BY b.created_at,b.id LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  IF v_result.customer_id::text IS DISTINCT FROM v_context->>'customerId' OR v_result.site_id::text IS DISTINCT FROM v_context->>'siteId'
   OR v_result.customer_site_id::text IS DISTINCT FROM v_context->>'customerSiteId'
   OR v_result.metering_point_id::text IS DISTINCT FROM v_context->>'meteringPointId' OR v_result.grid_owner_id::text IS DISTINCT FROM v_context->>'gridOwnerId'
   OR v_result.source_request_id::text IS DISTINCT FROM v_context->>'sourceRequestId' OR v_result.total_kwh IS DISTINCT FROM v_total
   OR v_result.underlay_month IS DISTINCT FROM (v_context->>'month')::integer
   OR v_result.underlay_year IS DISTINCT FROM (v_context->>'year')::integer
   OR v_result.currency IS DISTINCT FROM v_context->>'currency'
   OR v_result.payload->'consumptionContracts' IS DISTINCT FROM v_contracts THEN
   RAISE EXCEPTION 'utilts_consumption_existing_billing_conflict' USING ERRCODE='P0U01'; END IF;
  RETURN v_result;
 END IF;
 INSERT INTO public.billing_underlays(company_id,customer_id,site_id,customer_site_id,metering_point_id,source_request_id,grid_owner_id,underlay_month,underlay_year,
  status,total_kwh,currency,source_system,payload,readiness_status,readiness_issues,created_by,updated_by,received_at)
 VALUES(p_company_id,(v_context->>'customerId')::uuid,(v_context->>'siteId')::uuid,(v_context->>'customerSiteId')::uuid,(v_context->>'meteringPointId')::uuid,(v_context->>'sourceRequestId')::uuid,
  (v_context->>'gridOwnerId')::uuid,(v_context->>'month')::integer,(v_context->>'year')::integer,v_context->>'status',v_total,v_context->>'currency',v_context->>'sourceSystem',
  jsonb_build_object('edielMessageId',p_source_message_id,'consumptionContracts',v_contracts,'tenant',jsonb_build_object('company_id',p_company_id,'issues','[]'::jsonb)),
  'not_checked','[]'::jsonb,p_actor_id,p_actor_id,now()) RETURNING * INTO v_result;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.gridex_consume_utilts_billing_v1(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_consume_utilts_billing_v1(uuid,uuid,uuid,jsonb) TO service_role;

ALTER TABLE gridex_e66_intake.completions
 ADD COLUMN billing_underlay_id uuid,
 ADD COLUMN billing_underlay_fingerprint text,
 ADD CONSTRAINT e66_billing_completion_fields CHECK (
   (billing_underlay_id IS NULL AND billing_underlay_fingerprint IS NULL)
   OR (billing_underlay_id IS NOT NULL AND billing_underlay_fingerprint IS NOT NULL
       AND billing_underlay_fingerprint ~ '^[a-f0-9]{64}$')
 );

CREATE FUNCTION gridex_e66_intake.bound_underlay_fingerprint_v1(p_company uuid,p_source uuid,p_underlay uuid)
RETURNS text LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(
   b.id,b.company_id,b.customer_id,b.site_id,b.customer_site_id,b.metering_point_id,b.grid_owner_id,
   b.source_request_id,b.underlay_year,b.underlay_month,b.total_kwh,b.currency,b.source_system,
   b.payload->'edielMessageId',b.payload->'consumptionContracts'
 )::text,'UTF8')),'hex')
 FROM public.billing_underlays b
 WHERE b.id=p_underlay AND b.company_id=p_company AND b.source_system='ediel_utilts'
   AND b.payload->>'edielMessageId'=p_source::text
 FOR SHARE OF b
$$;
REVOKE ALL ON FUNCTION gridex_e66_intake.bound_underlay_fingerprint_v1(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

DO $migration$
DECLARE writer record; completion record; ack record; completion_body text; ack_body text;
 old_writer constant text := 'FUNCTION public.gridex_consume_utilts_billing_v1(';
 owned_writer constant text := 'FUNCTION gridex_e66_intake.consume_owned_utilts_billing_v1(';
 old_declaration constant text := 'done gridex_e66_intake.completions%rowtype;';
 new_declaration constant text := 'done gridex_e66_intake.completions%rowtype; billing_capability text; finance public.billing_underlays%rowtype; billing_hash text;';
 old_gate constant text := 'OR c#>>''{billing,capability}'' IS DISTINCT FROM ''skip''';
 old_issue constant text := $anchor$ IF done.source_id IS NULL THEN
  INSERT INTO gridex_e66_intake.completions$anchor$;
 new_issue constant text := $finance$
 billing_capability:=c#>>'{billing,capability}';
 IF billing_capability IS NULL OR billing_capability NOT IN ('skip','write')
 THEN RAISE EXCEPTION 'e66_completion_unavailable' USING ERRCODE='P0U01'; END IF;
 IF billing_capability='write' THEN
  IF done.source_id IS NULL THEN
   finance:=gridex_e66_intake.consume_owned_utilts_billing_v1(p_company,p_source,p_actor,jsonb_build_array(c));
   billing_hash:=gridex_e66_intake.bound_underlay_fingerprint_v1(p_company,p_source,finance.id);
   IF finance.id IS NULL OR billing_hash IS NULL OR w.lease_until<=clock_timestamp()
   THEN RAISE EXCEPTION 'e66_completion_unavailable' USING ERRCODE='P0U01'; END IF;
  ELSE
   billing_hash:=gridex_e66_intake.bound_underlay_fingerprint_v1(p_company,p_source,done.billing_underlay_id);
   IF billing_hash IS NULL OR billing_hash IS DISTINCT FROM done.billing_underlay_fingerprint
   THEN RAISE EXCEPTION 'e66_completion_unavailable' USING ERRCODE='P0U01'; END IF;
  END IF;
 ELSIF done.billing_underlay_id IS NOT NULL OR done.billing_underlay_fingerprint IS NOT NULL
 THEN RAISE EXCEPTION 'e66_completion_unavailable' USING ERRCODE='P0U01'; END IF;
 IF done.source_id IS NULL THEN
  INSERT INTO gridex_e66_intake.completions$finance$;
 old_members constant text := 'observation_count,seal_actor,seal_lease)';
 new_members constant text := 'observation_count,seal_actor,seal_lease,billing_underlay_id,billing_underlay_fingerprint)';
 old_values constant text := 'j.contract_hash,expected,p_actor,p_lease);';
 new_values constant text := 'j.contract_hash,expected,p_actor,p_lease,finance.id,billing_hash);';
 old_ack constant text := 'd.observation_count=jsonb_array_length(stored.contract->''observations'')) THEN';
 new_ack constant text := $ack$d.observation_count=jsonb_array_length(stored.contract->'observations')
    AND CASE stored.contract#>>'{billing,capability}'
     WHEN 'skip' THEN d.billing_underlay_id IS NULL AND d.billing_underlay_fingerprint IS NULL
     WHEN 'write' THEN d.billing_underlay_id IS NOT NULL AND d.billing_underlay_fingerprint IS NOT NULL
      AND gridex_e66_intake.bound_underlay_fingerprint_v1(p_company_id,source.id,d.billing_underlay_id)
        = d.billing_underlay_fingerprint
     ELSE false END) THEN$ack$;
 public_body constant text := $body$
DECLARE source public.ediel_messages%rowtype;
BEGIN
 SELECT * INTO source FROM public.ediel_messages
  WHERE id=p_source_message_id AND company_id=p_company_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'utilts_consumption_source_unavailable' USING ERRCODE='P0U01'; END IF;
 IF source.message_code='E66' AND EXISTS(SELECT FROM gridex_e66_intake.work w
  WHERE w.source_id=source.id AND w.company_id=p_company_id AND w.environment=source.environment)
 THEN RAISE EXCEPTION 'e66_billing_owned_by_durable_worker' USING ERRCODE='55000'; END IF;
 RETURN gridex_e66_intake.consume_owned_utilts_billing_v1(
   p_company_id,p_source_message_id,p_actor_id,p_expected_contracts);
END
$body$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
 INTO STRICT writer FROM pg_proc p WHERE p.oid=to_regprocedure('public.gridex_consume_utilts_billing_v1(uuid,uuid,uuid,jsonb)');
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
 INTO STRICT completion FROM pg_proc p
 WHERE p.oid=to_regprocedure('public.gridex_seal_e66_completion_v1(uuid,text,uuid,uuid,uuid,uuid)');
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
 INTO STRICT ack FROM pg_proc p
 WHERE p.oid=to_regprocedure('gridex_utilts_binding.require_positive_storage_authority_v1(uuid,text,uuid,text,uuid,text)');
 IF md5(writer.prosrc) IS DISTINCT FROM '5436275fd48f4e748d9fed8ce42618cd'
    OR md5(completion.prosrc) IS DISTINCT FROM '871b72382db140c7fde613b64af43d4c'
    OR (length(ack.prosrc)-length(replace(ack.prosrc,old_ack,'')))/length(old_ack)<>1
 THEN RAISE EXCEPTION 'e66_billing_owner_predecessor_changed'; END IF;
 completion_body:=replace(replace(replace(replace(replace(
  completion.prosrc,old_declaration,new_declaration),old_gate,''),old_issue,new_issue),old_members,new_members),old_values,new_values);
 ack_body:=replace(ack.prosrc,old_ack,new_ack);
 EXECUTE replace(writer.definition,old_writer,owned_writer);
 REVOKE ALL ON FUNCTION gridex_e66_intake.consume_owned_utilts_billing_v1(uuid,uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
 EXECUTE replace(writer.definition,writer.prosrc,public_body);
 EXECUTE replace(completion.definition,completion.prosrc,completion_body);
 EXECUTE replace(ack.definition,ack.prosrc,ack_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=writer.oid) IS DISTINCT FROM writer.metadata
    OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=completion.oid) IS DISTINCT FROM completion.metadata
    OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=ack.oid) IS DISTINCT FROM ack.metadata
    OR (SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('gridex_e66_intake.consume_owned_utilts_billing_v1(uuid,uuid,uuid,jsonb)'))
       IS DISTINCT FROM writer.prosrc
 THEN RAISE EXCEPTION 'e66_billing_owner_metadata_changed'; END IF;
END
$migration$;

CREATE FUNCTION public.gridex_read_e66_readiness_batch_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_e66_intake.work%rowtype; j gridex_e66_metering_stage.jobs%rowtype; evidence jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 16 THEN
  RAISE EXCEPTION 'e66_readiness_batch_limit' USING ERRCODE='22023'; END IF;
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT * INTO w FROM gridex_e66_intake.work x
 WHERE x.source_id=p_source AND x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox FOR SHARE;
 IF w.phase IS DISTINCT FROM 'readiness' OR w.lease_actor IS DISTINCT FROM p_actor OR p_lease IS NULL
   OR w.lease_token IS DISTINCT FROM p_lease OR w.lease_until<=clock_timestamp()
 THEN RAISE EXCEPTION 'e66_readiness_stale'; END IF;
 SELECT * INTO j FROM gridex_e66_metering_stage.jobs x
 WHERE x.source_id=w.source_id AND x.company_id=p_company AND x.environment=p_environment AND x.raw_hash=w.payload_sha256;
 IF j.next_ordinal IS DISTINCT FROM j.observation_count OR j.source_id IS NULL
   OR NOT EXISTS(SELECT FROM gridex_e66_intake.qualified q WHERE q.source_id=p_source
       AND q.transaction_id=j.transaction_id AND q.contract_hash=j.contract_hash)
 THEN RAISE EXCEPTION 'e66_readiness_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'ordinal',e.ordinal,'normalizedId',n.id,
   'meter',jsonb_build_object(
    'id',m.id,'company_id',m.company_id,'metering_point_id',m.metering_point_id,
    'period_start',m.period_start,'period_end',m.period_end,'source_ediel_message_id',p_source
   )
 ) ORDER BY e.ordinal),'[]'::jsonb)
 INTO evidence
 FROM gridex_e66_metering_stage.effects e
 JOIN public.metering_values m ON m.id=e.metering_id AND m.company_id=p_company AND m.source_ediel_message_id=p_source
 JOIN public.normalized_metering_values n ON n.id=e.normalized_id AND n.company_id=p_company AND n.source_message_id=p_source
  AND n.source_metering_value_id=m.id
 WHERE e.source_id=p_source AND e.ordinal>=j.ready_ordinal AND e.ordinal<j.ready_ordinal+p_limit
   AND m.is_current AND m.revision_status='current' AND n.revision_status='current';
 IF jsonb_array_length(evidence)<>least(p_limit,j.observation_count-j.ready_ordinal)
 THEN RAISE EXCEPTION 'e66_readiness_unavailable' USING ERRCODE='P0U01'; END IF;
 RETURN jsonb_build_object('sourceId',w.source_id,'nextOrdinal',j.ready_ordinal,'observationCount',j.observation_count,'values',evidence);
END $$;

CREATE FUNCTION public.gridex_yield_e66_readiness_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,p_next integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_e66_intake.work%rowtype;
BEGIN
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT * INTO w FROM gridex_e66_intake.work x
 WHERE x.source_id=p_source AND x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox FOR UPDATE;
 IF w.phase IS DISTINCT FROM 'readiness' OR w.lease_actor IS DISTINCT FROM p_actor OR p_lease IS NULL
   OR w.lease_token IS DISTINCT FROM p_lease OR w.lease_until<=clock_timestamp()
   OR NOT EXISTS(SELECT FROM gridex_e66_metering_stage.jobs j WHERE j.source_id=w.source_id AND j.company_id=w.company_id
     AND j.environment=w.environment AND j.raw_hash=w.payload_sha256 AND j.ready_ordinal=p_next
     AND j.ready_ordinal>0 AND j.ready_ordinal<j.observation_count)
 THEN RAISE EXCEPTION 'e66_readiness_stale'; END IF;
 UPDATE gridex_e66_intake.work SET lease_actor=NULL,lease_token=NULL,lease_until=NULL,ready_at=clock_timestamp()
 WHERE source_id=w.source_id;
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.gridex_read_e66_readiness_batch_v1(uuid,text,uuid,uuid,uuid,uuid,integer),
 public.gridex_yield_e66_readiness_v1(uuid,text,uuid,uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_read_e66_readiness_batch_v1(uuid,text,uuid,uuid,uuid,uuid,integer),
 public.gridex_yield_e66_readiness_v1(uuid,text,uuid,uuid,uuid,uuid,integer) TO service_role;

DO $migration$
DECLARE target regprocedure := 'public.gridex_yield_e66_readiness_v1(uuid,text,uuid,uuid,uuid,uuid,integer)'::regprocedure;
 before_def text; replacement text; metadata_before jsonb;
BEGIN
 SELECT pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' INTO STRICT before_def,metadata_before FROM pg_proc p
 WHERE p.oid=target AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ee3daab2df8d30e94adabd48b3da4aee06715bf9f0096eb518dbdc66eda58484';
 replacement:=replace(before_def,'j.ready_ordinal>0 AND j.ready_ordinal<j.observation_count','j.ready_ordinal>0 AND j.ready_ordinal<=j.observation_count');
 IF replacement=before_def THEN RAISE EXCEPTION 'e66_readiness_yield_preimage_mismatch'; END IF;
 EXECUTE replacement;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM metadata_before
 THEN RAISE EXCEPTION 'e66_readiness_yield_catalog_changed'; END IF;
END
$migration$;

-- Capture only PostgreSQL's explicit lock-not-available result inside the
-- delegated owner's savepoint. Transport errors and other SQLSTATEs stay errors.
CREATE TABLE gridex_e66_intake.customer_import_failures (
 source_id uuid NOT NULL REFERENCES gridex_e66_intake.work(source_id),
 company_id uuid NOT NULL, environment text NOT NULL, request_id uuid NOT NULL,
 customer_id uuid NOT NULL, site_id uuid NOT NULL, metering_point_id uuid NOT NULL,
 requested_period_start date NOT NULL, requested_period_end date NOT NULL,
 source_hash text NOT NULL, transaction_id text NOT NULL, contract_hash text NOT NULL,
 stage text NOT NULL CHECK(stage IN ('normalization','readiness')),
 lease_token uuid NOT NULL, checkpoint integer NOT NULL,
 first_recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (source_id,stage,lease_token,checkpoint)
);
REVOKE ALL ON TABLE gridex_e66_intake.customer_import_failures FROM PUBLIC,anon,authenticated,service_role;

CREATE INDEX customer_import_failures_request
ON gridex_e66_intake.customer_import_failures(company_id,customer_id,request_id);
CREATE VIEW gridex_e66_intake.customer_import_binding AS
 SELECT w.source_id,w.company_id,w.environment,w.payload_sha256 source_hash,
  q.transaction_id,q.contract_hash,r.id request_id,r.customer_id,r.site_id,r.metering_point_id,
  r.requested_period_start,r.requested_period_end,
  CASE WHEN r.request_scope='billing_underlay' AND contract.contract#>>'{billing,sourceRequestId}'=r.id::text
    AND contract.contract#>>'{billing,year}' ~ '^[0-9]{4}$'
    AND contract.contract#>>'{billing,month}' ~ '^([1-9]|1[0-2])$'
    THEN (contract.contract#>>'{billing,year}')||'-'||lpad(contract.contract#>>'{billing,month}',2,'0') END billing_month
 FROM gridex_e66_intake.work w
 JOIN gridex_e66_intake.qualified q ON q.source_id=w.source_id
 JOIN gridex_utilts_binding.receipts receipt
  ON receipt.source_message_id=w.source_id AND receipt.company_id=w.company_id AND receipt.environment=w.environment
 AND receipt.raw_hash=w.payload_sha256 AND receipt.membership=jsonb_build_array(q.transaction_id)
 JOIN gridex_utilts_binding.contracts contract
  ON contract.source_message_id=w.source_id AND contract.company_id=w.company_id AND contract.environment=w.environment
 AND contract.transaction_id=q.transaction_id AND contract.contract_hash=q.contract_hash
 JOIN public.grid_owner_data_requests r ON r.company_id=w.company_id
 AND r.id::text=contract.contract#>>'{metering,sourceRequestId}'
 AND r.customer_id::text=contract.contract#>>'{metering,customerId}'
 AND r.site_id::text=coalesce(contract.contract#>>'{metering,customerSiteId}',contract.contract#>>'{metering,siteId}')
 AND r.metering_point_id::text=contract.contract#>>'{metering,meteringPointId}'
 WHERE r.status <> 'cancelled' AND r.request_scope IN ('meter_values','billing_underlay')
 AND r.requested_period_start IS NOT NULL AND r.requested_period_end IS NOT NULL;
REVOKE ALL ON TABLE gridex_e66_intake.customer_import_binding FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.record_customer_import_lock_retry_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,p_stage text,p_checkpoint integer
) RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
BEGIN
 INSERT INTO gridex_e66_intake.customer_import_failures
  (source_id,company_id,environment,request_id,customer_id,site_id,metering_point_id,requested_period_start,requested_period_end,
   source_hash,transaction_id,contract_hash,stage,lease_token,checkpoint)
 SELECT b.source_id,b.company_id,b.environment,b.request_id,b.customer_id,b.site_id,b.metering_point_id,
  b.requested_period_start,b.requested_period_end,b.source_hash,b.transaction_id,b.contract_hash,p_stage,p_lease,p_checkpoint
 FROM gridex_e66_intake.customer_import_binding b
 WHERE b.source_id=p_source AND b.company_id=p_company AND b.environment=p_environment
 ON CONFLICT(source_id,stage,lease_token,checkpoint) DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE gridex_e66_intake.work w
 SET lease_actor=NULL,lease_token=NULL,lease_until=NULL,ready_at=clock_timestamp()+interval '3 seconds'
 WHERE w.source_id=p_source AND w.company_id=p_company AND w.environment=p_environment
   AND w.mailbox_id=p_mailbox AND w.phase=p_stage AND w.lease_actor=p_actor
   AND w.lease_token=p_lease AND w.lease_until>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'e66_import_retry_lease_changed' USING ERRCODE='55000'; END IF;
 RETURN jsonb_build_object('state','retry_required','reason','database_lock_contended',
   'sourceId',p_source,'phase',p_stage,'checkpoint',p_checkpoint);
END $$;
REVOKE ALL ON FUNCTION gridex_e66_intake.record_customer_import_lock_retry_v1(uuid,text,uuid,uuid,uuid,uuid,text,integer)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_seal_e66_with_customer_outcome_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog SET lock_timeout TO '1500ms' AS $$
DECLARE affected integer; checkpoint integer; retry jsonb; w gridex_e66_intake.work%rowtype;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'customer_import_outcome_forbidden' USING ERRCODE='42501';
 END IF;
 -- Take the same first lock as the actual immutable finalization owner.
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT * INTO w FROM gridex_e66_intake.work x WHERE x.source_id=p_source AND x.company_id=p_company
  AND x.environment=p_environment AND x.mailbox_id=p_mailbox FOR UPDATE;
 IF w.source_id IS NULL THEN RAISE EXCEPTION 'customer_import_outcome_unavailable' USING ERRCODE='P0U01'; END IF;
 IF w.phase='readiness' THEN
  IF p_lease IS NULL OR w.lease_actor IS DISTINCT FROM p_actor
    OR w.lease_token IS DISTINCT FROM p_lease OR w.lease_until<=clock_timestamp()
  THEN RAISE EXCEPTION 'e66_completion_unavailable' USING ERRCODE='P0U01'; END IF;
  SELECT j.ready_ordinal INTO checkpoint
  FROM gridex_e66_metering_stage.jobs j
  JOIN gridex_e66_intake.qualified q ON q.source_id=j.source_id AND q.transaction_id=j.transaction_id
    AND q.contract_hash=j.contract_hash
  WHERE j.source_id=w.source_id AND j.company_id=w.company_id AND j.environment=w.environment
    AND j.raw_hash=w.payload_sha256 AND j.ready_ordinal=j.observation_count AND j.next_ordinal=j.observation_count;
 END IF;
 BEGIN
  affected:=public.gridex_seal_e66_completion_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_lease);
 EXCEPTION WHEN lock_not_available THEN
  IF w.phase IS DISTINCT FROM 'readiness' OR checkpoint IS NULL THEN RAISE; END IF;
  retry:=gridex_e66_intake.record_customer_import_lock_retry_v1(
    p_company,p_environment,p_mailbox,p_source,p_actor,p_lease,'readiness',checkpoint);
  IF retry IS NULL THEN RAISE; END IF;
  RETURN retry;
 END;
 RETURN jsonb_build_object('state','complete','observationCount',affected);
END $$;
REVOKE ALL ON FUNCTION public.gridex_seal_e66_with_customer_outcome_v1(uuid,text,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_seal_e66_with_customer_outcome_v1(uuid,text,uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.gridex_read_customer_import_outcome_v1(
 p_company uuid,p_customer uuid,p_actor uuid,p_requests uuid[]
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role'
  OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company
   AND cm.user_id=p_actor AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(p_actor,p_company,'billing_underlay.read') IS NOT TRUE THEN
  RAISE EXCEPTION 'customer_import_outcome_forbidden' USING ERRCODE='42501';
 END IF;
 IF p_company IS NULL OR p_customer IS NULL OR p_requests IS NULL OR cardinality(p_requests)>50
   OR array_position(p_requests,NULL::uuid) IS NOT NULL THEN
  RAISE EXCEPTION 'customer_import_outcome_invalid' USING ERRCODE='22023';
 END IF;
 WITH affected AS (
  SELECT DISTINCT b.source_id,b.company_id,b.environment,b.source_hash,b.transaction_id,b.contract_hash,
    b.request_id,b.site_id,b.metering_point_id,b.requested_period_start,b.requested_period_end,b.billing_month
  FROM gridex_e66_intake.customer_import_failures f
  JOIN gridex_e66_intake.customer_import_binding b ON (f.source_id,f.company_id,f.environment,f.source_hash,
    f.transaction_id,f.contract_hash,f.request_id,f.customer_id,f.site_id,f.metering_point_id,f.requested_period_start,f.requested_period_end) =
   (b.source_id,b.company_id,b.environment,b.source_hash,b.transaction_id,b.contract_hash,
    b.request_id,b.customer_id,b.site_id,b.metering_point_id,b.requested_period_start,b.requested_period_end)
  WHERE f.company_id=p_company AND f.customer_id=p_customer AND f.request_id=ANY(p_requests)
 ), explicit AS (
  SELECT a.request_id,a.site_id,a.metering_point_id,a.requested_period_start,a.requested_period_end,a.billing_month,a.environment,
  CASE WHEN w.phase='complete' AND d.source_id IS NOT NULL THEN 'resolved'
       WHEN w.phase IN ('normalization','readiness') AND d.source_id IS NULL THEN 'retry_required' END state
  FROM affected a JOIN gridex_e66_intake.work w
   ON w.source_id=a.source_id AND w.company_id=a.company_id AND w.environment=a.environment
  LEFT JOIN gridex_e66_intake.completions d
   ON d.source_id=a.source_id AND d.company_id=a.company_id AND d.environment=a.environment
   AND d.source_sha256=a.source_hash AND d.transaction_id=a.transaction_id AND d.contract_hash=a.contract_hash
 ), unique_scope AS (
  SELECT request_id,MIN(site_id::text) site_id,MIN(metering_point_id::text) metering_point_id,MIN(environment) environment,MIN(requested_period_start) requested_period_start,
   MIN(requested_period_end) requested_period_end,MIN(billing_month) billing_month,MIN(state) state
  FROM explicit WHERE state IS NOT NULL GROUP BY request_id HAVING count(*)=1
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('requestId',q.request_id,'siteId',q.site_id,
  'meteringPointId',q.metering_point_id,'periodStart',q.requested_period_start,'periodEnd',q.requested_period_end,'billingMonth',q.billing_month,'environment',q.environment,'state',q.state) ORDER BY q.request_id),'[]'::jsonb)
 INTO result FROM unique_scope q;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.gridex_read_customer_import_outcome_v1(uuid,uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_customer_import_outcome_v1(uuid,uuid,uuid,uuid[]) TO service_role;

CREATE FUNCTION public.gridex_normalize_e66_with_customer_outcome_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,p_next integer,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog SET lock_timeout TO '1500ms' AS $$
DECLARE result jsonb; retry jsonb; w gridex_e66_intake.work%rowtype;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'customer_import_outcome_forbidden' USING ERRCODE='42501';
 END IF;
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT * INTO w FROM gridex_e66_intake.work x WHERE x.source_id=p_source AND x.company_id=p_company
  AND x.environment=p_environment AND x.mailbox_id=p_mailbox FOR UPDATE;
 IF w.source_id IS NULL OR w.phase IS DISTINCT FROM 'normalization' OR p_lease IS NULL
   OR w.lease_actor IS DISTINCT FROM p_actor OR w.lease_token IS DISTINCT FROM p_lease
   OR w.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'e66_dispatch_stale' USING ERRCODE='P0001'; END IF;
 -- Check the durable cursor before invoking a write that might hit a lock.
 IF p_next IS DISTINCT FROM (public.gridex_read_e66_work_progress_v1(
      p_company,p_environment,p_mailbox,p_source,p_actor,p_lease)->>'nextOrdinal')::integer
 THEN RAISE EXCEPTION 'stage_probe_stale' USING ERRCODE='P0001'; END IF;
 BEGIN
  result:=public.gridex_consume_dispatched_e66_metering_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_lease,p_next,p_limit);
 EXCEPTION WHEN lock_not_available THEN
  retry:=gridex_e66_intake.record_customer_import_lock_retry_v1(
    p_company,p_environment,p_mailbox,p_source,p_actor,p_lease,'normalization',p_next);
  IF retry IS NULL THEN RAISE; END IF;
  RETURN retry;
 END;
 RETURN jsonb_build_object('state','progress') || result;
END $$;
REVOKE ALL ON FUNCTION public.gridex_normalize_e66_with_customer_outcome_v1(uuid,text,uuid,uuid,uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_normalize_e66_with_customer_outcome_v1(uuid,text,uuid,uuid,uuid,uuid,integer,integer) TO service_role;

CREATE FUNCTION public.gridex_claim_e66_aperak_draft_v1(p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_e66_intake.work%rowtype; transaction_id text;
BEGIN
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT x.* INTO w FROM gridex_e66_intake.work x
 JOIN gridex_e66_intake.completions d ON d.source_id=x.source_id AND d.company_id=x.company_id
  AND d.environment=x.environment AND d.source_sha256=x.payload_sha256
 JOIN gridex_e66_intake.qualified q ON q.source_id=x.source_id
  AND q.transaction_id=d.transaction_id AND q.contract_hash=d.contract_hash
 JOIN public.ediel_ack_transaction_results r ON r.source_message_id=x.source_id AND r.source_transaction_id=q.transaction_id
  AND r.company_id=x.company_id AND r.environment=x.environment AND r.persisted_series_id=q.series_id
 JOIN public.ediel_messages m ON m.id=x.source_id AND m.company_id=x.company_id AND m.environment=x.environment
 WHERE x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox
  AND x.phase='complete' AND (x.lease_until IS NULL OR x.lease_until<=clock_timestamp())
  AND m.direction='inbound' AND m.message_family='UTILTS' AND m.message_code='E66' AND m.raw_payload IS NOT NULL
  AND r.disposition='accepted' AND r.planned_response_type='positive_aperak' AND r.persistence_status='persisted'
  AND r.response_message_id IS NULL AND r.final_response_type IS NULL AND r.finalized_at IS NULL
 ORDER BY d.sealed_at,x.source_id LIMIT 1 FOR UPDATE OF x SKIP LOCKED;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','idle'); END IF;
 SELECT q.transaction_id INTO STRICT transaction_id FROM gridex_e66_intake.qualified q WHERE q.source_id=w.source_id;
 UPDATE gridex_e66_intake.work x
 SET lease_actor=p_actor,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'
 WHERE x.source_id=w.source_id;
 RETURN jsonb_build_object('kind','claimed','sourceId',w.source_id,'transactionId',transaction_id);
END $$;
REVOKE ALL ON FUNCTION public.gridex_claim_e66_aperak_draft_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_claim_e66_aperak_draft_v1(uuid,text,uuid,uuid) TO service_role;

CREATE FUNCTION public.gridex_prepare_e66_scheduler_v1(
 p_environment text,p_mailboxes uuid[],p_company uuid,p_actor uuid,p_sources uuid[],p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE scopes jsonb; owned jsonb;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role'
 THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_environment IS NULL OR p_environment NOT IN ('test','production') OR p_actor IS NULL
   OR p_mailboxes IS NULL OR cardinality(p_mailboxes)>100 OR p_sources IS NULL OR cardinality(p_sources)>500
   OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 12
 THEN RAISE EXCEPTION 'e66_scheduler_scope_required' USING ERRCODE='22023'; END IF;
 WITH permitted AS MATERIALIZED (
   SELECT w.*
   FROM gridex_e66_intake.work w JOIN public.ediel_mailboxes m ON m.id=w.mailbox_id
    AND m.environment=w.environment AND (m.company_id=w.company_id OR m.is_shared_platform_mailbox IS TRUE)
   WHERE w.environment=p_environment AND w.mailbox_id=ANY(p_mailboxes)
    AND (p_company IS NULL OR p_company=w.company_id)
    AND public.gridex_actor_has_company_permission(p_actor,w.company_id,'communication.write')
    AND public.gridex_actor_has_company_permission(p_actor,w.company_id,'metering.write')
 ), due AS (
   SELECT w.company_id,w.mailbox_id,min(w.ready_at) AS first_at FROM permitted w
   WHERE w.ready_at<=clock_timestamp() AND (w.lease_until IS NULL OR w.lease_until<=clock_timestamp())
     AND (w.phase IN ('qualification','normalization','readiness') OR (
       w.phase='complete' AND EXISTS(
         SELECT FROM gridex_e66_intake.qualified q
         JOIN public.ediel_ack_transaction_results r ON r.source_message_id=q.source_id AND r.source_transaction_id=q.transaction_id
           AND r.company_id=w.company_id AND r.environment=w.environment AND r.persisted_series_id=q.series_id
         WHERE q.source_id=w.source_id AND r.planned_response_type='positive_aperak'
           AND r.response_message_id IS NULL AND r.final_response_type IS NULL AND r.finalized_at IS NULL
       )
     ))
   GROUP BY w.company_id,w.mailbox_id
   ORDER BY first_at,w.company_id,w.mailbox_id LIMIT p_limit
 )
 SELECT
  (SELECT coalesce(jsonb_agg(jsonb_build_object('companyId',d.company_id,'mailboxId',d.mailbox_id)
    ORDER BY d.first_at,d.company_id,d.mailbox_id),'[]'::jsonb) FROM due d),
  (SELECT coalesce(jsonb_agg(w.source_id ORDER BY w.source_id),'[]'::jsonb) FROM permitted w WHERE w.source_id=ANY(p_sources))
 INTO scopes,owned;
 RETURN jsonb_build_object('scopes',scopes,'ownedSources',owned);
END $$;
REVOKE ALL ON FUNCTION public.gridex_prepare_e66_scheduler_v1(text,uuid[],uuid,uuid,uuid[],integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_prepare_e66_scheduler_v1(text,uuid[],uuid,uuid,uuid[],integer) TO service_role;

END
$e66_catalog_install$;

DO $e66_catalog_install$
BEGIN

CREATE TABLE gridex_e66_intake.matched_request_basis (
 source_id uuid PRIMARY KEY REFERENCES gridex_e66_intake.qualified(source_id),
 company_id uuid NOT NULL, environment text NOT NULL, request_id uuid NOT NULL,
 source_sha256 text NOT NULL, transaction_id text NOT NULL, contract_hash text NOT NULL,
 basis_digest bytea NOT NULL, parsed_digest bytea NOT NULL, actor_id uuid NOT NULL,
 response_base jsonb
);
REVOKE ALL ON TABLE gridex_e66_intake.matched_request_basis FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.gridex_commit_e66_matched_qualification_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,p_transactions jsonb,p_reply jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_e66_intake.work%rowtype; q gridex_e66_intake.qualified%rowtype;
 source public.ediel_messages%rowtype; command_hash text; tx_id text; series uuid; contract_hash text; native_results jsonb; reply_digest bytea; req uuid; saved record;
BEGIN
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT * INTO w FROM gridex_e66_intake.work x
 WHERE x.source_id=p_source AND x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox FOR UPDATE;
 IF w.source_id IS NULL OR p_lease IS NULL OR jsonb_typeof(p_transactions) IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_transactions)<>1 THEN RAISE EXCEPTION 'e66_qualification_scope_required' USING ERRCODE='22023'; END IF;
 tx_id:=p_transactions#>>'{0,transactionId}';
 IF nullif(tx_id,'') IS NULL THEN RAISE EXCEPTION 'e66_qualification_scope_required' USING ERRCODE='22023'; END IF;
 SELECT * INTO source FROM public.ediel_messages m WHERE m.id=p_source AND m.company_id=p_company AND m.environment=p_environment FOR UPDATE;
 IF source.id IS NULL OR source.direction IS DISTINCT FROM 'inbound' OR source.message_family IS DISTINCT FROM 'UTILTS' OR source.message_code IS DISTINCT FROM 'E66'
   OR encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') IS DISTINCT FROM w.payload_sha256
   OR NOT EXISTS(SELECT FROM gridex_ediel_inbound_receptions.receptions r WHERE r.id=w.reception_id AND r.source_message_id=w.source_id
       AND r.company_id=p_company AND r.environment=p_environment AND r.inbound_email_message_id=w.mail_id
       AND r.classification='first_reception' AND r.canonical_payload_hash=w.payload_sha256)
 THEN RAISE EXCEPTION 'e66_qualification_source_changed'; END IF;
 IF jsonb_typeof(p_reply) IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_reply->'normalizedMeteringPayload') IS DISTINCT FROM 'object'
   OR p_reply#>'{normalizedMeteringPayload,utiltsTransactionPersistenceResults}' IS DISTINCT FROM '[]'::jsonb
   OR jsonb_typeof(p_reply->'utiltsRuntime') IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_reply#>'{utiltsRuntime,validation}') IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_reply#>'{utiltsRuntime,ackPlan}') IS DISTINCT FROM 'object'
   OR NOT (p_reply ? 'billingUnderlayCandidate')
   OR p_reply - ARRAY['requestId','normalizedMeteringPayload','utiltsRuntime','billingUnderlayCandidate'] <> '{}'::jsonb
   OR jsonb_typeof(source.parsed_payload) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'e66_matched_request_basis_invalid' USING ERRCODE='22023'; END IF;
 req:=source.grid_owner_data_request_id;
 IF req IS NULL OR p_reply->>'requestId' IS DISTINCT FROM req::text
  OR p_transactions#>>'{0,consumptionContract,metering,sourceRequestId}' IS DISTINCT FROM req::text
  OR NOT EXISTS (SELECT FROM public.grid_owner_data_requests r
    WHERE r.id=req AND r.company_id=p_company AND r.request_scope IN ('meter_values','billing_underlay')
      AND r.customer_id=source.customer_id AND r.site_id IS NOT DISTINCT FROM source.site_id
      AND r.metering_point_id IS NOT DISTINCT FROM source.metering_point_id
      AND CASE WHEN r.request_scope='billing_underlay' THEN
         jsonb_typeof(p_reply->'billingUnderlayCandidate')='object'
         AND p_reply#>>'{billingUnderlayCandidate,status}' =
           CASE p_transactions#>>'{0,consumptionContract,billing,capability}' WHEN 'write' THEN 'created' ELSE 'not_created' END
       ELSE p_reply->'billingUnderlayCandidate'='null'::jsonb END)
 THEN RAISE EXCEPTION 'e66_matched_request_scope_changed' USING ERRCODE='23514'; END IF;
 reply_digest:=sha256(convert_to(p_reply::text,'UTF8'));
 command_hash:=encode(sha256(convert_to(p_transactions::text,'UTF8')),'hex');
 SELECT * INTO q FROM gridex_e66_intake.qualified x WHERE x.source_id=w.source_id;
 IF FOUND THEN
  SELECT b.basis_digest,b.request_id,b.actor_id INTO saved
   FROM gridex_e66_intake.matched_request_basis b WHERE b.source_id=w.source_id;
  IF NOT FOUND OR (saved.basis_digest,saved.request_id,saved.actor_id) IS DISTINCT FROM (reply_digest,req,p_actor)
  THEN RAISE EXCEPTION 'e66_matched_request_basis_changed' USING ERRCODE='23514'; END IF;
  IF q.actor IS DISTINCT FROM p_actor OR q.lease IS DISTINCT FROM p_lease OR q.command_hash IS DISTINCT FROM command_hash
   OR w.phase='qualification' THEN RAISE EXCEPTION 'e66_qualification_stale'; END IF;
 ELSE
  IF w.phase IS DISTINCT FROM 'qualification' OR w.lease_actor IS DISTINCT FROM p_actor
    OR w.lease_token IS DISTINCT FROM p_lease OR w.lease_until<=clock_timestamp()
  THEN RAISE EXCEPTION 'e66_qualification_stale'; END IF;
  IF EXISTS(SELECT FROM gridex_utilts_binding.receipts r WHERE r.source_message_id=p_source)
  THEN RAISE EXCEPTION 'e66_qualification_prior_owner_uncertain'; END IF;
  -- The ordinary native owner validates and writes the physical series/contract/ACK plan.
  native_results:=gridex_e66_intake.persist_owned_utilts_v1(
   p_company,p_environment,p_source,'E66',source.raw_payload,p_transactions,p_actor);
 END IF;
 SELECT a.persisted_series_id,c.contract_hash INTO series,contract_hash
 FROM gridex_utilts_binding.receipts r JOIN public.ediel_ack_transaction_results a
   ON a.source_message_id=r.source_message_id AND a.company_id=r.company_id AND a.environment=r.environment
 JOIN gridex_utilts_binding.contracts c ON c.series_id=a.persisted_series_id AND c.company_id=r.company_id AND c.environment=r.environment
 WHERE r.source_message_id=w.source_id AND r.company_id=w.company_id AND r.environment=w.environment AND r.raw_hash=w.payload_sha256
   AND r.membership=jsonb_build_array(tx_id) AND a.source_transaction_id=tx_id AND c.transaction_id=tx_id
   AND a.disposition='accepted' AND a.planned_response_type='positive_aperak' AND a.persistence_status='persisted'
   AND (a.final_response_type IS NULL OR a.final_response_type='positive_aperak')
   AND c.source_message_id=w.source_id AND jsonb_array_length(c.contract->'observations')>0;
 IF series IS NULL OR contract_hash IS NULL THEN RAISE EXCEPTION 'e66_qualification_unavailable'; END IF;
 IF q.source_id IS NOT NULL THEN
  IF (q.transaction_id,q.series_id,q.contract_hash) IS DISTINCT FROM (tx_id,series,contract_hash)
  THEN RAISE EXCEPTION 'e66_qualification_unavailable'; END IF;
  RETURN jsonb_build_object('kind','qualified','transactionId',q.transaction_id,'seriesId',q.series_id,
    'contractHash',q.contract_hash,'replayed',true);
 END IF;
 IF w.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'e66_qualification_stale'; END IF;
 INSERT INTO gridex_e66_intake.qualified(source_id,actor,lease,command_hash,transaction_id,series_id,contract_hash)
 VALUES(p_source,p_actor,p_lease,command_hash,tx_id,series,contract_hash);
 IF jsonb_typeof(native_results) IS DISTINCT FROM 'array' OR jsonb_array_length(native_results)<>1
  OR native_results#>>'{0,transactionId}' IS DISTINCT FROM tx_id
  OR native_results#>>'{0,sourceBinding,sourceMessageId}' IS DISTINCT FROM p_source::text
  OR native_results#>>'{0,sourceBinding,rawHash}' IS DISTINCT FROM w.payload_sha256
  OR native_results#>>'{0,contractHash}' IS DISTINCT FROM contract_hash
  OR native_results#>>'{0,seriesId}' IS DISTINCT FROM series::text
  OR native_results#>>'{0,persistenceStatus}' IS DISTINCT FROM 'persisted'
  OR native_results#>>'{0,disposition}' IS DISTINCT FROM 'accepted'
  OR native_results#>>'{0,responseType}' IS DISTINCT FROM 'positive_aperak'
  OR native_results#>>'{0,versionState}' IS DISTINCT FROM 'current'
 THEN RAISE EXCEPTION 'e66_matched_request_result_invalid' USING ERRCODE='P0U01'; END IF;
 INSERT INTO gridex_e66_intake.matched_request_basis
  (source_id,company_id,environment,request_id,source_sha256,transaction_id,contract_hash,
   basis_digest,parsed_digest,actor_id,response_base)
 VALUES(p_source,p_company,p_environment,req,w.payload_sha256,tx_id,contract_hash,
  reply_digest,sha256(convert_to(source.parsed_payload::text,'UTF8')),p_actor,
  jsonb_set(p_reply - 'requestId','{normalizedMeteringPayload,utiltsTransactionPersistenceResults}',native_results,false));
 UPDATE gridex_e66_intake.work SET phase='normalization',lease_actor=NULL,lease_token=NULL,lease_until=NULL
 WHERE source_id=p_source;
 RETURN jsonb_build_object('kind','qualified','transactionId',tx_id,'seriesId',series,'contractHash',contract_hash,'replayed',false);
END $$;

REVOKE ALL ON FUNCTION public.gridex_commit_e66_matched_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_commit_e66_matched_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb,jsonb)
 TO service_role;


CREATE FUNCTION public.gridex_seal_e66_with_request_handoff_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 sealed jsonb;
 b gridex_e66_intake.matched_request_basis%rowtype;
 d gridex_e66_intake.completions%rowtype;
 w gridex_e66_intake.work%rowtype;
 s public.ediel_messages%rowtype;
 q gridex_e66_request_retry.commands%rowtype;
 meter_ids uuid[];
 expectation jsonb;
BEGIN
 -- The existing seal remains the only completion, underlay and lease owner.
 sealed:=public.gridex_seal_e66_with_customer_outcome_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_lease);
 IF sealed->>'state' IS DISTINCT FROM 'complete' THEN RETURN sealed; END IF;
 SELECT * INTO b FROM gridex_e66_intake.matched_request_basis x WHERE x.source_id=p_source;
 IF NOT FOUND THEN
  IF EXISTS(SELECT FROM public.ediel_messages m WHERE m.id=p_source AND m.company_id=p_company
    AND m.environment=p_environment AND m.grid_owner_data_request_id IS NOT NULL)
  THEN RAISE EXCEPTION 'e66_qualified_request_basis_unavailable' USING ERRCODE='P0U01'; END IF;
  RETURN sealed; -- Only an actually unmatched source bypasses the handoff.
 END IF;
 SELECT * INTO STRICT w FROM gridex_e66_intake.work x WHERE x.source_id=p_source;
 SELECT * INTO STRICT d FROM gridex_e66_intake.completions x WHERE x.source_id=p_source;
 SELECT * INTO STRICT s FROM public.ediel_messages x WHERE x.id=p_source AND x.company_id=p_company FOR SHARE NOWAIT;
 IF (b.company_id,b.environment,b.actor_id,b.source_sha256,b.transaction_id,b.contract_hash,b.request_id)
   IS DISTINCT FROM (p_company,p_environment,p_actor,d.source_sha256,d.transaction_id,d.contract_hash,s.grid_owner_data_request_id)
   OR w.mailbox_id IS DISTINCT FROM p_mailbox OR w.phase IS DISTINCT FROM 'complete'
   OR w.reception_id IS DISTINCT FROM gridex_e66_request_retry.bound_reception(
     p_company,p_environment,p_mailbox,p_source,b.request_id)
   OR (b.response_base IS NOT NULL AND b.parsed_digest IS DISTINCT FROM sha256(convert_to(s.parsed_payload::text,'UTF8')))
 THEN RAISE EXCEPTION 'e66_sealed_request_scope_changed' USING ERRCODE='23514'; END IF;

 SELECT array_agg(e.metering_id ORDER BY e.ordinal) INTO meter_ids
 FROM gridex_e66_metering_stage.effects e
 JOIN gridex_utilts_binding.metering_application_receipts a
  ON a.company_id=p_company AND a.environment=p_environment AND a.source_message_id=p_source
   AND a.transaction_id=d.transaction_id AND a.contract_hash=decode(d.contract_hash,'hex')
   AND a.observation_ordinal=e.ordinal AND a.value_id=e.metering_id AND a.normalized_id=e.normalized_id
 WHERE e.source_id=p_source;
 IF cardinality(meter_ids) IS DISTINCT FROM d.observation_count OR d.observation_count<1
   OR (SELECT count(DISTINCT id) FROM unnest(meter_ids) AS qid(id))<>d.observation_count
 THEN RAISE EXCEPTION 'e66_sealed_request_effects_unavailable' USING ERRCODE='P0U01'; END IF;

 IF b.response_base IS NULL THEN
  SELECT * INTO STRICT q FROM gridex_e66_request_retry.commands x WHERE x.source_id=p_source;
  IF (q.company_id,q.environment,q.mailbox_id,q.actor_id,q.request_id,q.reception_id,q.meter_ids)
     IS DISTINCT FROM (p_company,p_environment,p_mailbox,p_actor,b.request_id,w.reception_id,meter_ids)
  THEN RAISE EXCEPTION 'e66_sealed_request_command_changed' USING ERRCODE='23514'; END IF;
  RETURN sealed;
 END IF;
 IF b.response_base->'billingUnderlayCandidate'<>'null'::jsonb
   AND ((b.response_base#>>'{billingUnderlayCandidate,status}'='created') IS DISTINCT FROM (d.billing_underlay_id IS NOT NULL))
 THEN RAISE EXCEPTION 'e66_sealed_request_underlay_changed' USING ERRCODE='23514'; END IF;
 expectation:=b.response_base||jsonb_build_object(
   'edielMessageId',p_source,'ingestedMeterValueId',meter_ids[1],'ingestedMeterValueIds',meter_ids,
   'billingUnderlayId',d.billing_underlay_id,'receivedVia','inbound_ediel');
 -- Insert only. The initial durable seal has the unique source work lock.
 -- Existing drain acquires its command row before graph/storage locks, so
 -- no request command is executed or locked by the seal path.
 INSERT INTO gridex_e66_request_retry.commands
  (source_id,reception_id,company_id,request_id,actor_id,environment,mailbox_id,meter_ids,
   response_patch,response_digest,response_shape_digest)
 VALUES(p_source,w.reception_id,p_company,b.request_id,p_actor,p_environment,p_mailbox,meter_ids,expectation,
   sha256(convert_to((expectation||jsonb_build_object('parsedPayload',s.parsed_payload))::text,'UTF8')),
   sha256(convert_to(expectation::text,'UTF8')));
 UPDATE gridex_e66_intake.matched_request_basis SET response_base=NULL WHERE source_id=p_source;
 RETURN sealed;
END $$;
REVOKE ALL ON FUNCTION public.gridex_seal_e66_with_request_handoff_v1(uuid,text,uuid,uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_seal_e66_with_request_handoff_v1(uuid,text,uuid,uuid,uuid,uuid)
 TO service_role;

CREATE FUNCTION public.gridex_drain_sealed_e66_request_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 cmd gridex_e66_request_retry.commands%ROWTYPE;
 sealed_billing uuid;
 sealed_hash text;
 result jsonb;

BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role'
   OR public.gridex_actor_has_company_permission(p_actor,p_company,'communication.send') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'e66_request_retry_scope_required' USING ERRCODE='42501'; END IF;
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT c.* INTO cmd FROM gridex_e66_request_retry.commands c
 JOIN gridex_e66_intake.matched_request_basis b ON b.source_id=c.source_id AND b.response_base IS NULL
   AND (b.company_id,b.environment,b.request_id,b.actor_id)=(c.company_id,c.environment,c.request_id,c.actor_id)
 JOIN gridex_e66_intake.work w ON w.source_id=c.source_id AND w.reception_id=c.reception_id
   AND w.company_id=c.company_id AND w.environment=c.environment AND w.mailbox_id=c.mailbox_id
   AND w.phase='complete' AND w.payload_sha256=b.source_sha256
 JOIN gridex_e66_intake.completions d ON d.source_id=w.source_id AND d.source_sha256=w.payload_sha256
   AND d.company_id=c.company_id AND d.environment=c.environment
   AND (d.transaction_id,d.contract_hash)=(b.transaction_id,b.contract_hash)
 WHERE c.company_id=p_company AND c.environment=p_environment AND c.mailbox_id=p_mailbox
   AND c.actor_id=p_actor AND c.outcome IS NULL
 ORDER BY c.last_attempt_at,c.source_id LIMIT 1 FOR UPDATE OF c SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT d.billing_underlay_id,d.billing_underlay_fingerprint INTO STRICT sealed_billing,sealed_hash
  FROM gridex_e66_intake.completions d WHERE d.source_id=cmd.source_id;
 BEGIN
  -- The canonical CAS obtains its own domain locks first. Its effect and the
  -- terminal marker remain provisional until the sealed underlay proof agrees.
  result:=gridex_e66_request_retry.attempt(cmd,true);
  IF result->>'status'='received' AND (
    cmd.response_patch->>'billingUnderlayId' IS DISTINCT FROM sealed_billing::text
    OR (sealed_billing IS NOT NULL AND
      gridex_e66_intake.bound_underlay_fingerprint_v1(cmd.company_id,cmd.source_id,sealed_billing) IS DISTINCT FROM sealed_hash)
  ) THEN RAISE EXCEPTION 'e66_sealed_request_underlay_proof_changed' USING ERRCODE='P0U01'; END IF;
 EXCEPTION WHEN SQLSTATE 'P0U01' THEN
  IF SQLERRM IS DISTINCT FROM 'e66_sealed_request_underlay_proof_changed' THEN RAISE; END IF;
  result:=jsonb_build_object('status','held','reason','underlay_scope_changed');
  UPDATE gridex_e66_request_retry.commands
   SET outcome=result, response_patch=NULL, attempts=attempts+1,last_attempt_at=clock_timestamp()
   WHERE source_id=cmd.source_id;
  RETURN result||jsonb_build_object('sourceId',cmd.source_id);
 END;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.gridex_drain_sealed_e66_request_v1(uuid,text,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_drain_sealed_e66_request_v1(uuid,text,uuid,uuid)
 TO service_role;

CREATE FUNCTION gridex_e66_intake.matched_request_ack_eligible_v1(p_source uuid) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(
   SELECT FROM gridex_e66_intake.matched_request_basis b LEFT JOIN gridex_e66_request_retry.commands c ON c.source_id=b.source_id AND
     (c.company_id,c.environment,c.request_id,c.actor_id)=(b.company_id,b.environment,b.request_id,b.actor_id)
   WHERE b.source_id=p_source AND (b.response_base IS NOT NULL
     OR coalesce(c.outcome->>'status','') NOT IN ('received','replaced')))
 $$;
 REVOKE ALL ON FUNCTION gridex_e66_intake.matched_request_ack_eligible_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.gridex_claim_e66_aperak_draft_v1(p_company uuid,p_environment text,p_mailbox uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w gridex_e66_intake.work%rowtype; transaction_id text;
BEGIN
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT x.* INTO w FROM gridex_e66_intake.work x
 JOIN gridex_e66_intake.completions d ON d.source_id=x.source_id AND d.company_id=x.company_id
  AND d.environment=x.environment AND d.source_sha256=x.payload_sha256
 JOIN gridex_e66_intake.qualified q ON q.source_id=x.source_id
  AND q.transaction_id=d.transaction_id AND q.contract_hash=d.contract_hash
 JOIN public.ediel_ack_transaction_results r ON r.source_message_id=x.source_id AND r.source_transaction_id=q.transaction_id
  AND r.company_id=x.company_id AND r.environment=x.environment AND r.persisted_series_id=q.series_id
 JOIN public.ediel_messages m ON m.id=x.source_id AND m.company_id=x.company_id AND m.environment=x.environment
 WHERE x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox
  AND gridex_e66_intake.matched_request_ack_eligible_v1(x.source_id)
  AND x.phase='complete' AND (x.lease_until IS NULL OR x.lease_until<=clock_timestamp())
  AND m.direction='inbound' AND m.message_family='UTILTS' AND m.message_code='E66' AND m.raw_payload IS NOT NULL
  AND r.disposition='accepted' AND r.planned_response_type='positive_aperak' AND r.persistence_status='persisted'
  AND r.response_message_id IS NULL AND r.final_response_type IS NULL AND r.finalized_at IS NULL
 ORDER BY d.sealed_at,x.source_id LIMIT 1 FOR UPDATE OF x SKIP LOCKED;
 IF NOT FOUND THEN RETURN jsonb_build_object('kind','idle'); END IF;
 SELECT q.transaction_id INTO STRICT transaction_id FROM gridex_e66_intake.qualified q WHERE q.source_id=w.source_id;
 UPDATE gridex_e66_intake.work x
 SET lease_actor=p_actor,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'
 WHERE x.source_id=w.source_id;
 RETURN jsonb_build_object('kind','claimed','sourceId',w.source_id,'transactionId',transaction_id);
END $$;
REVOKE ALL ON FUNCTION public.gridex_claim_e66_aperak_draft_v1(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_claim_e66_aperak_draft_v1(uuid,text,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.gridex_prepare_e66_scheduler_v1(
 p_environment text,p_mailboxes uuid[],p_company uuid,p_actor uuid,p_sources uuid[],p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE scopes jsonb; owned jsonb;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role'
 THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_environment IS NULL OR p_environment NOT IN ('test','production') OR p_actor IS NULL
   OR p_mailboxes IS NULL OR cardinality(p_mailboxes)>100 OR p_sources IS NULL OR cardinality(p_sources)>500
   OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 12
 THEN RAISE EXCEPTION 'e66_scheduler_scope_required' USING ERRCODE='22023'; END IF;
 WITH permitted AS MATERIALIZED (
   SELECT w.*
   FROM gridex_e66_intake.work w JOIN public.ediel_mailboxes m ON m.id=w.mailbox_id
    AND m.environment=w.environment AND (m.company_id=w.company_id OR m.is_shared_platform_mailbox IS TRUE)
   WHERE w.environment=p_environment AND w.mailbox_id=ANY(p_mailboxes)
    AND (p_company IS NULL OR p_company=w.company_id)
    AND public.gridex_actor_has_company_permission(p_actor,w.company_id,'communication.write')
    AND public.gridex_actor_has_company_permission(p_actor,w.company_id,'metering.write')
 ), due AS (
   SELECT w.company_id,w.mailbox_id,min(w.ready_at) AS first_at FROM permitted w
   WHERE w.ready_at<=clock_timestamp() AND (w.lease_until IS NULL OR w.lease_until<=clock_timestamp())
     AND (w.phase IN ('qualification','normalization','readiness') OR (
       w.phase='complete' AND gridex_e66_intake.matched_request_ack_eligible_v1(w.source_id) AND EXISTS(
         SELECT FROM gridex_e66_intake.qualified q
         JOIN public.ediel_ack_transaction_results r ON r.source_message_id=q.source_id AND r.source_transaction_id=q.transaction_id
           AND r.company_id=w.company_id AND r.environment=w.environment AND r.persisted_series_id=q.series_id
         WHERE q.source_id=w.source_id AND r.planned_response_type='positive_aperak'
           AND r.response_message_id IS NULL AND r.final_response_type IS NULL AND r.finalized_at IS NULL
       )
     ) OR (w.phase='complete' AND
       public.gridex_actor_has_company_permission(p_actor,w.company_id,'communication.send') AND
       EXISTS (SELECT FROM gridex_e66_request_retry.commands c JOIN gridex_e66_intake.matched_request_basis b ON b.source_id=c.source_id
         WHERE c.source_id=w.source_id AND c.company_id=w.company_id AND c.environment=w.environment
           AND c.mailbox_id=w.mailbox_id AND c.actor_id=p_actor AND c.outcome IS NULL
           AND b.company_id=c.company_id AND b.request_id=c.request_id AND b.response_base IS NULL)))
   GROUP BY w.company_id,w.mailbox_id
   ORDER BY first_at,w.company_id,w.mailbox_id LIMIT p_limit
 )
 SELECT
  (SELECT coalesce(jsonb_agg(jsonb_build_object('companyId',d.company_id,'mailboxId',d.mailbox_id)
    ORDER BY d.first_at,d.company_id,d.mailbox_id),'[]'::jsonb) FROM due d),
  (SELECT coalesce(jsonb_agg(w.source_id ORDER BY w.source_id),'[]'::jsonb) FROM permitted w WHERE w.source_id=ANY(p_sources))
 INTO scopes,owned;
 RETURN jsonb_build_object('scopes',scopes,'ownedSources',owned);
END $$;
REVOKE ALL ON FUNCTION public.gridex_prepare_e66_scheduler_v1(text,uuid[],uuid,uuid,uuid[],integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_prepare_e66_scheduler_v1(text,uuid[],uuid,uuid,uuid[],integer) TO service_role;

CREATE OR REPLACE FUNCTION public.gridex_submit_e66_request_retry_v1(
  p_company uuid, p_environment text, p_mailbox uuid, p_source uuid, p_request uuid,
  p_actor uuid, p_meter_ids uuid[], p_response_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  cmd gridex_e66_request_retry.commands%ROWTYPE;
  reception uuid;
  digest bytea;
  shape_digest bytea;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
    OR public.gridex_actor_has_company_permission(p_actor,p_company,'communication.send') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'e66_request_retry_scope_required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_response_patch) IS DISTINCT FROM 'object'
    OR p_response_patch->>'edielMessageId' IS DISTINCT FROM p_source::text
    OR jsonb_typeof(p_response_patch->'parsedPayload') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'e66_request_retry_command_invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT FROM gridex_e66_intake.work w
    WHERE w.source_id=p_source AND w.company_id=p_company AND w.environment=p_environment)
  THEN RAISE EXCEPTION 'e66_request_owned_by_durable_worker' USING ERRCODE='55000'; END IF;
  reception := gridex_e66_request_retry.bound_reception(p_company,p_environment,p_mailbox,p_source,p_request);
  IF reception IS NULL THEN
    RAISE EXCEPTION 'e66_request_retry_reception_required' USING ERRCODE = '23514';
  END IF;
  digest := sha256(convert_to(p_response_patch::text,'UTF8'));
  shape_digest := sha256(convert_to((p_response_patch - 'parsedPayload')::text,'UTF8'));
  INSERT INTO gridex_e66_request_retry.commands
    (source_id,reception_id,company_id,request_id,actor_id,environment,mailbox_id,meter_ids,response_patch,response_digest,response_shape_digest)
  VALUES (p_source,reception,p_company,p_request,p_actor,p_environment,p_mailbox,p_meter_ids,p_response_patch - 'parsedPayload',digest,shape_digest)
  ON CONFLICT (source_id) DO NOTHING;
  SELECT * INTO STRICT cmd FROM gridex_e66_request_retry.commands WHERE source_id = p_source FOR UPDATE;
  IF (cmd.reception_id,cmd.company_id,cmd.request_id,cmd.actor_id,cmd.environment,cmd.mailbox_id,cmd.meter_ids,cmd.response_shape_digest)
     IS DISTINCT FROM (reception,p_company,p_request,p_actor,p_environment,p_mailbox,p_meter_ids,shape_digest) THEN
    RAISE EXCEPTION 'e66_request_retry_command_conflict' USING ERRCODE = '23514';
  END IF;
  -- A terminal command only returns its receipt. The ordinary status
  -- projection can enrich parsedPayload after that command has committed.
  IF cmd.outcome IS NOT NULL THEN
    RETURN cmd.outcome || jsonb_build_object('sourceId',cmd.source_id);
  END IF;
  IF cmd.response_digest IS DISTINCT FROM digest THEN
    RAISE EXCEPTION 'e66_request_retry_command_conflict' USING ERRCODE = '23514';
  END IF;
  IF cmd.attempts > 0 THEN
    RETURN jsonb_build_object('status','deferred','sourceId',cmd.source_id);
  END IF;
  RETURN gridex_e66_request_retry.attempt(cmd,false);
END;
$$;

CREATE OR REPLACE FUNCTION public.gridex_drain_e66_request_retry_v1(
  p_company uuid, p_environment text, p_mailbox uuid, p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE cmd gridex_e66_request_retry.commands%ROWTYPE;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
    OR public.gridex_actor_has_company_permission(p_actor,p_company,'communication.send') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'e66_request_retry_scope_required' USING ERRCODE = '42501';
  END IF;
  SELECT c.* INTO cmd FROM gridex_e66_request_retry.commands c
  WHERE company_id = p_company AND environment = p_environment AND mailbox_id = p_mailbox
    AND actor_id = p_actor AND outcome IS NULL

    AND NOT EXISTS (SELECT FROM gridex_e66_intake.work owned WHERE owned.source_id=c.source_id
       AND owned.company_id=c.company_id AND owned.environment=c.environment AND owned.mailbox_id=c.mailbox_id)
  ORDER BY last_attempt_at, source_id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN gridex_e66_request_retry.attempt(cmd,true);
END;
$$;



DO $finder$
DECLARE original record;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS ddl,to_jsonb(p)-'prosrc' AS metadata INTO STRICT original
 FROM pg_proc p WHERE p.oid=to_regprocedure('public.gridex_find_scheduled_e66_request_retry_v1(text,uuid[],uuid,uuid)');
 IF md5(original.prosrc) IS DISTINCT FROM '9a420ff8fa287a709a02c2457d1a3985'
 THEN RAISE EXCEPTION 'e66_legacy_finder_predecessor_changed'; END IF;
 EXECUTE replace(original.ddl,original.prosrc,$after$
DECLARE scope jsonb;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
    OR p_actor IS NULL THEN
    RAISE EXCEPTION 'e66_scheduled_request_scope_required' USING ERRCODE = '42501';
  END IF;
  IF p_environment IS NULL OR p_environment NOT IN ('test','production')
    OR coalesce(cardinality(p_mailboxes),0) NOT BETWEEN 1 AND 100
    OR array_position(p_mailboxes,NULL::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'e66_scheduled_request_input_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_build_object('companyId',c.company_id,'mailboxId',c.mailbox_id)
  INTO scope
  FROM gridex_e66_request_retry.commands c
  JOIN public.ediel_mailboxes b
    ON b.id = c.mailbox_id AND b.is_active AND b.environment = c.environment
    AND (b.company_id = c.company_id OR b.is_shared_platform_mailbox)
  WHERE c.outcome IS NULL AND c.environment = p_environment AND c.actor_id = p_actor

    AND NOT EXISTS (SELECT FROM gridex_e66_intake.work owned WHERE owned.source_id=c.source_id
       AND owned.company_id=c.company_id AND owned.environment=c.environment AND owned.mailbox_id=c.mailbox_id)
    AND c.mailbox_id = ANY(p_mailboxes) AND (p_company IS NULL OR c.company_id = p_company)
    AND public.gridex_actor_has_company_permission(p_actor,c.company_id,'communication.send') IS TRUE
    AND EXISTS (
      SELECT FROM auth.users u WHERE u.id = p_actor AND u.deleted_at IS NULL
        AND (u.banned_until IS NULL OR u.banned_until <= clock_timestamp())
    )
    AND EXISTS (
      SELECT FROM public.companies o WHERE o.id = c.company_id AND coalesce(o.is_active,true)
        AND coalesce(o.status,'active') NOT IN ('archived','suspended','pending_deletion','deleted')
    )
    AND EXISTS (SELECT FROM public.user_profiles u WHERE u.id = p_actor AND u.user_status = 'active')
    AND EXISTS (
      SELECT FROM public.company_memberships m WHERE m.company_id = c.company_id AND m.user_id = p_actor
        AND m.status = 'active' AND m.is_active AND m.accepted_at IS NOT NULL
    )
    AND gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(c.company_id,p_actor,'metering.write') IS TRUE
  ORDER BY c.last_attempt_at,c.source_id LIMIT 1;
  RETURN scope;
END;
$after$);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=original.oid) IS DISTINCT FROM original.metadata
 THEN RAISE EXCEPTION 'e66_legacy_finder_metadata_changed'; END IF;
END
$finder$;

-- Further work must get a turn even if an earlier worker cannot reach yield.
DO $migration$
DECLARE
 f record;
 signature text;
 after text;
 timestamp_anchor constant text := 'lease_until=clock_timestamp()+interval ''60 seconds''';
 ack_order constant text := 'ORDER BY d.sealed_at,x.source_id';
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.gridex_claim_e66_qualification_v1(uuid,text,uuid,uuid)',
  'public.gridex_claim_e66_normalization_v1(uuid,text,uuid,uuid)',
  'public.gridex_claim_e66_readiness_v1(uuid,text,uuid,uuid)',
  'public.gridex_claim_e66_aperak_draft_v1(uuid,text,uuid,uuid)'
 ] LOOP
  SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
  INTO STRICT f FROM pg_proc p WHERE p.oid=to_regprocedure(signature);
  IF (length(f.prosrc)-length(replace(f.prosrc,timestamp_anchor,'')))/length(timestamp_anchor)<>1
   OR (length(f.definition)-length(replace(f.definition,f.prosrc,'')))/length(f.prosrc)<>1
  THEN RAISE EXCEPTION 'e66_claim_fairness_predecessor_changed'; END IF;
  after:=replace(f.prosrc,timestamp_anchor,timestamp_anchor||',ready_at=clock_timestamp()');
  IF signature LIKE '%aperak%' THEN
   IF (length(f.prosrc)-length(replace(f.prosrc,ack_order,'')))/length(ack_order)<>1
   THEN RAISE EXCEPTION 'e66_claim_fairness_predecessor_changed'; END IF;
   after:=replace(after,ack_order,'ORDER BY x.ready_at,d.sealed_at,x.source_id');
  END IF;
  EXECUTE replace(f.definition,f.prosrc,after);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata
   OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM after
  THEN RAISE EXCEPTION 'e66_claim_fairness_metadata_changed'; END IF;
 END LOOP;
END
$migration$;

END
$e66_catalog_install$;

DO $e66_catalog_install$
BEGIN
CREATE FUNCTION gridex_e66_intake.request_upgrade_state_v1(p_source uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE
 w gridex_e66_intake.work%rowtype;
 m public.ediel_messages%rowtype;
 q gridex_e66_intake.qualified%rowtype;
 r gridex_utilts_binding.receipts%rowtype;
 c gridex_utilts_binding.contracts%rowtype;
 b gridex_e66_intake.matched_request_basis%rowtype;
 bound_request text;
BEGIN
 SELECT * INTO w FROM gridex_e66_intake.work x WHERE x.source_id=p_source;
 IF NOT FOUND THEN RETURN 'outside'; END IF;
 SELECT * INTO m FROM public.ediel_messages x
  WHERE x.id=p_source AND x.company_id=w.company_id AND x.environment=w.environment
   AND x.direction='inbound' AND x.message_family='UTILTS' AND x.message_code='E66';
 IF NOT FOUND OR m.raw_payload IS NULL OR
  w.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR NOT EXISTS (
   SELECT FROM gridex_ediel_inbound_receptions.receptions rr
    WHERE rr.id=w.reception_id AND rr.source_message_id=w.source_id AND rr.company_id=w.company_id
     AND rr.environment=w.environment AND rr.inbound_email_message_id=w.mail_id
     AND m.inbound_email_message_id=w.mail_id AND rr.classification='first_reception'
     AND rr.canonical_payload_hash=w.payload_sha256 AND rr.received_payload_hash=w.payload_sha256
  ) THEN RETURN 'hold_source_unverified'; END IF;
 SELECT * INTO q FROM gridex_e66_intake.qualified x WHERE x.source_id=p_source;
 SELECT * INTO r FROM gridex_utilts_binding.receipts x WHERE x.source_message_id=p_source;
 IF w.phase='qualification' THEN
  IF q.source_id IS NULL AND r.source_message_id IS NULL AND NOT EXISTS (
    SELECT FROM gridex_e66_metering_stage.jobs j WHERE j.source_id=p_source
   ) AND NOT EXISTS (
    SELECT FROM gridex_e66_intake.completions d WHERE d.source_id=p_source
   ) AND NOT EXISTS (
    SELECT FROM public.ediel_ack_transaction_results a WHERE a.source_message_id=p_source
   ) AND NOT EXISTS (
    SELECT FROM gridex_e66_request_retry.commands x WHERE x.source_id=p_source
   ) THEN RETURN 'qualify_normally'; END IF;
  RETURN 'hold_preexisting_qualification_effect';
 END IF;
 IF w.phase NOT IN ('normalization','readiness','complete') OR q.source_id IS NULL
  OR (r.company_id,r.environment,r.raw_hash,r.membership) IS DISTINCT FROM
     (w.company_id,w.environment,w.payload_sha256,jsonb_build_array(q.transaction_id))
 THEN RETURN 'hold_qualification_unverified'; END IF;
 SELECT * INTO c FROM gridex_utilts_binding.contracts x
  WHERE x.source_message_id=p_source AND x.company_id=w.company_id AND x.environment=w.environment
    AND x.transaction_id=q.transaction_id AND x.contract_hash=q.contract_hash AND x.series_id=q.series_id;
 IF NOT FOUND OR c.contract_hash IS DISTINCT FROM encode(sha256(convert_to(c.contract::text,'UTF8')),'hex')
 THEN RETURN 'hold_qualification_unverified'; END IF;
 bound_request:=c.contract#>>'{metering,sourceRequestId}';
 IF bound_request IS DISTINCT FROM m.grid_owner_data_request_id::text
 THEN RETURN 'hold_request_scope_changed'; END IF;
 SELECT * INTO b FROM gridex_e66_intake.matched_request_basis x WHERE x.source_id=p_source;
 IF NOT FOUND THEN
   IF bound_request IS NULL AND c.contract#>>'{billing,sourceRequestId}' IS NULL THEN RETURN 'unmatched'; END IF;
   RETURN 'hold_missing_reply_basis';
 END IF;
 IF bound_request IS NULL OR (b.company_id,b.environment,b.source_sha256,b.transaction_id,b.contract_hash,b.request_id::text)
  IS DISTINCT FROM (w.company_id,w.environment,w.payload_sha256,q.transaction_id,q.contract_hash,bound_request)
 THEN RETURN 'hold_request_scope_changed'; END IF;
 IF (w.phase='complete') IS DISTINCT FROM (b.response_base IS NULL)
 THEN RETURN 'hold_qualification_unverified'; END IF;
 RETURN 'matched_basis';
END $$;
REVOKE ALL ON FUNCTION gridex_e66_intake.request_upgrade_state_v1(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

DO $upgrade$
DECLARE s record; next_body text;
 needle constant text:=$needle$     AND (w.phase IN ('qualification','normalization','readiness') OR ($needle$;
 replacement constant text:=$needle$     AND ((w.phase='qualification' AND gridex_e66_intake.request_upgrade_state_v1(w.source_id)='qualify_normally')
       OR (w.phase IN ('normalization','readiness') AND gridex_e66_intake.request_upgrade_state_v1(w.source_id) IN ('matched_basis','unmatched')) OR ($needle$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS ddl,to_jsonb(p)-'prosrc' AS metadata, p.proowner,p.prosecdef
 INTO STRICT s FROM pg_proc p WHERE p.oid=to_regprocedure('public.gridex_prepare_e66_scheduler_v1(text,uuid[],uuid,uuid,uuid[],integer)');
 IF s.proowner IS DISTINCT FROM current_user::regrole OR s.prosecdef IS DISTINCT FROM true
   OR md5(s.prosrc) IS DISTINCT FROM 'e3c04e7f47a5d7ee0da23becac34eca6' OR (length(s.prosrc)-length(replace(s.prosrc,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'e66_upgrade_owner_preimage_changed:public.gridex_prepare_e66_scheduler_v1(text,uuid[],uuid,uuid,uuid[],integer)'; END IF;
 next_body:=replace(s.prosrc,needle,replacement);
 EXECUTE replace(s.ddl,s.prosrc,next_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=s.oid) IS DISTINCT FROM s.metadata
 THEN RAISE EXCEPTION 'e66_upgrade_owner_metadata_changed:public.gridex_prepare_e66_scheduler_v1(text,uuid[],uuid,uuid,uuid[],integer)'; END IF;
END $upgrade$;
DO $upgrade$
DECLARE s record; next_body text;
 needle constant text:=$needle$     ) OR (w.phase='complete' AND$needle$;
 replacement constant text:=$needle$     ) OR (w.phase='complete' AND gridex_e66_intake.request_upgrade_state_v1(w.source_id)='matched_basis' AND$needle$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS ddl,to_jsonb(p)-'prosrc' AS metadata, p.proowner,p.prosecdef
 INTO STRICT s FROM pg_proc p WHERE p.oid=to_regprocedure('public.gridex_prepare_e66_scheduler_v1(text,uuid[],uuid,uuid,uuid[],integer)');
 IF s.proowner IS DISTINCT FROM current_user::regrole OR s.prosecdef IS DISTINCT FROM true
    OR (length(s.prosrc)-length(replace(s.prosrc,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'e66_upgrade_owner_preimage_changed:public.gridex_prepare_e66_scheduler_v1(text,uuid[],uuid,uuid,uuid[],integer)'; END IF;
 next_body:=replace(s.prosrc,needle,replacement);
 EXECUTE replace(s.ddl,s.prosrc,next_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=s.oid) IS DISTINCT FROM s.metadata
 THEN RAISE EXCEPTION 'e66_upgrade_owner_metadata_changed:public.gridex_prepare_e66_scheduler_v1(text,uuid[],uuid,uuid,uuid[],integer)'; END IF;
END $upgrade$;
DO $upgrade$
DECLARE s record; next_body text;
 needle constant text:=$needle$  AND x.phase='qualification' AND$needle$;
 replacement constant text:=$needle$  AND gridex_e66_intake.request_upgrade_state_v1(x.source_id)='qualify_normally' AND x.phase='qualification' AND$needle$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS ddl,to_jsonb(p)-'prosrc' AS metadata, p.proowner,p.prosecdef
 INTO STRICT s FROM pg_proc p WHERE p.oid=to_regprocedure('public.gridex_claim_e66_qualification_v1(uuid,text,uuid,uuid)');
 IF s.proowner IS DISTINCT FROM current_user::regrole OR s.prosecdef IS DISTINCT FROM true
   OR md5(s.prosrc) IS DISTINCT FROM '537fd7ab049e33da4bb98f5e549f4f2d' OR (length(s.prosrc)-length(replace(s.prosrc,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'e66_upgrade_owner_preimage_changed:public.gridex_claim_e66_qualification_v1(uuid,text,uuid,uuid)'; END IF;
 next_body:=replace(s.prosrc,needle,replacement);
 EXECUTE replace(s.ddl,s.prosrc,next_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=s.oid) IS DISTINCT FROM s.metadata
 THEN RAISE EXCEPTION 'e66_upgrade_owner_metadata_changed:public.gridex_claim_e66_qualification_v1(uuid,text,uuid,uuid)'; END IF;
END $upgrade$;
DO $upgrade$
DECLARE s record; next_body text;
 needle constant text:=$needle$  AND x.phase='normalization' AND$needle$;
 replacement constant text:=$needle$  AND gridex_e66_intake.request_upgrade_state_v1(x.source_id) IN ('matched_basis','unmatched') AND x.phase='normalization' AND$needle$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS ddl,to_jsonb(p)-'prosrc' AS metadata, p.proowner,p.prosecdef
 INTO STRICT s FROM pg_proc p WHERE p.oid=to_regprocedure('public.gridex_claim_e66_normalization_v1(uuid,text,uuid,uuid)');
 IF s.proowner IS DISTINCT FROM current_user::regrole OR s.prosecdef IS DISTINCT FROM true
   OR md5(s.prosrc) IS DISTINCT FROM '7f6742c245162a855f4857f2eaf5ab48' OR (length(s.prosrc)-length(replace(s.prosrc,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'e66_upgrade_owner_preimage_changed:public.gridex_claim_e66_normalization_v1(uuid,text,uuid,uuid)'; END IF;
 next_body:=replace(s.prosrc,needle,replacement);
 EXECUTE replace(s.ddl,s.prosrc,next_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=s.oid) IS DISTINCT FROM s.metadata
 THEN RAISE EXCEPTION 'e66_upgrade_owner_metadata_changed:public.gridex_claim_e66_normalization_v1(uuid,text,uuid,uuid)'; END IF;
END $upgrade$;
DO $upgrade$
DECLARE s record; next_body text;
 needle constant text:=$needle$ WHERE x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox AND x.phase='readiness'$needle$;
 replacement constant text:=$needle$ WHERE x.company_id=p_company AND x.environment=p_environment AND x.mailbox_id=p_mailbox AND x.phase='readiness'
  AND gridex_e66_intake.request_upgrade_state_v1(x.source_id) IN ('matched_basis','unmatched')$needle$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS ddl,to_jsonb(p)-'prosrc' AS metadata, p.proowner,p.prosecdef
 INTO STRICT s FROM pg_proc p WHERE p.oid=to_regprocedure('public.gridex_claim_e66_readiness_v1(uuid,text,uuid,uuid)');
 IF s.proowner IS DISTINCT FROM current_user::regrole OR s.prosecdef IS DISTINCT FROM true
   OR md5(s.prosrc) IS DISTINCT FROM '0d56922782eced1ee4fb500bc9d63aaa' OR (length(s.prosrc)-length(replace(s.prosrc,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'e66_upgrade_owner_preimage_changed:public.gridex_claim_e66_readiness_v1(uuid,text,uuid,uuid)'; END IF;
 next_body:=replace(s.prosrc,needle,replacement);
 EXECUTE replace(s.ddl,s.prosrc,next_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=s.oid) IS DISTINCT FROM s.metadata
 THEN RAISE EXCEPTION 'e66_upgrade_owner_metadata_changed:public.gridex_claim_e66_readiness_v1(uuid,text,uuid,uuid)'; END IF;
END $upgrade$;
DO $upgrade$
DECLARE s record; next_body text;
 needle constant text:=$needle$ INSERT INTO gridex_e66_metering_stage.jobs($needle$;
 replacement constant text:=$needle$
 IF gridex_e66_intake.request_upgrade_state_v1(p_source) NOT IN ('matched_basis','unmatched')
 THEN RAISE EXCEPTION 'e66_existing_work_held_for_qualified_reply' USING ERRCODE='55000'; END IF;
 INSERT INTO gridex_e66_metering_stage.jobs($needle$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS ddl,to_jsonb(p)-'prosrc' AS metadata, p.proowner,p.prosecdef
 INTO STRICT s FROM pg_proc p WHERE p.oid=to_regprocedure('public.gridex_consume_dispatched_e66_metering_v1(uuid,text,uuid,uuid,uuid,uuid,integer,integer)');
 IF s.proowner IS DISTINCT FROM current_user::regrole OR s.prosecdef IS DISTINCT FROM true
   OR md5(s.prosrc) IS DISTINCT FROM 'c22ba7943685d56625ff2793569af621' OR (length(s.prosrc)-length(replace(s.prosrc,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'e66_upgrade_owner_preimage_changed:public.gridex_consume_dispatched_e66_metering_v1(uuid,text,uuid,uuid,uuid,uuid,integer,integer)'; END IF;
 next_body:=replace(s.prosrc,needle,replacement);
 EXECUTE replace(s.ddl,s.prosrc,next_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=s.oid) IS DISTINCT FROM s.metadata
 THEN RAISE EXCEPTION 'e66_upgrade_owner_metadata_changed:public.gridex_consume_dispatched_e66_metering_v1(uuid,text,uuid,uuid,uuid,uuid,integer,integer)'; END IF;
END $upgrade$;
DO $upgrade$
DECLARE s record; next_body text;
 needle constant text:=$needle$ PERFORM public.gridex_set_metering_billing_gate$needle$;
 replacement constant text:=$needle$
 IF gridex_e66_intake.request_upgrade_state_v1(p_source) NOT IN ('matched_basis','unmatched')
 THEN RAISE EXCEPTION 'e66_existing_work_held_for_qualified_reply' USING ERRCODE='55000'; END IF;
 PERFORM public.gridex_set_metering_billing_gate$needle$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS ddl,to_jsonb(p)-'prosrc' AS metadata, p.proowner,p.prosecdef
 INTO STRICT s FROM pg_proc p WHERE p.oid=to_regprocedure('public.gridex_commit_e66_readiness_v1(uuid,text,uuid,uuid,uuid,uuid,integer,uuid,uuid,jsonb)');
 IF s.proowner IS DISTINCT FROM current_user::regrole OR s.prosecdef IS DISTINCT FROM true
   OR md5(s.prosrc) IS DISTINCT FROM '6e735ece4c5bb0cfd06632ba674321b1' OR (length(s.prosrc)-length(replace(s.prosrc,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'e66_upgrade_owner_preimage_changed:public.gridex_commit_e66_readiness_v1(uuid,text,uuid,uuid,uuid,uuid,integer,uuid,uuid,jsonb)'; END IF;
 next_body:=replace(s.prosrc,needle,replacement);
 EXECUTE replace(s.ddl,s.prosrc,next_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=s.oid) IS DISTINCT FROM s.metadata
 THEN RAISE EXCEPTION 'e66_upgrade_owner_metadata_changed:public.gridex_commit_e66_readiness_v1(uuid,text,uuid,uuid,uuid,uuid,integer,uuid,uuid,jsonb)'; END IF;
END $upgrade$;
DO $upgrade$
DECLARE s record; next_body text;
 needle constant text:=$needle$ SELECT * INTO j FROM gridex_e66_metering_stage.jobs x$needle$;
 replacement constant text:=$needle$ IF done.source_id IS NULL AND gridex_e66_intake.request_upgrade_state_v1(p_source) NOT IN ('matched_basis','unmatched')
 THEN RAISE EXCEPTION 'e66_existing_work_held_for_qualified_reply' USING ERRCODE='55000'; END IF;
 SELECT * INTO j FROM gridex_e66_metering_stage.jobs x$needle$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS ddl,to_jsonb(p)-'prosrc' AS metadata, p.proowner,p.prosecdef
 INTO STRICT s FROM pg_proc p WHERE p.oid=to_regprocedure('public.gridex_seal_e66_completion_v1(uuid,text,uuid,uuid,uuid,uuid)');
 IF s.proowner IS DISTINCT FROM current_user::regrole OR s.prosecdef IS DISTINCT FROM true
   OR md5(s.prosrc) IS DISTINCT FROM 'a115a3a5dc5cc20c405419e52344fc21' OR (length(s.prosrc)-length(replace(s.prosrc,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'e66_upgrade_owner_preimage_changed:public.gridex_seal_e66_completion_v1(uuid,text,uuid,uuid,uuid,uuid)'; END IF;
 next_body:=replace(s.prosrc,needle,replacement);
 EXECUTE replace(s.ddl,s.prosrc,next_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=s.oid) IS DISTINCT FROM s.metadata
 THEN RAISE EXCEPTION 'e66_upgrade_owner_metadata_changed:public.gridex_seal_e66_completion_v1(uuid,text,uuid,uuid,uuid,uuid)'; END IF;
END $upgrade$;
DO $upgrade$
DECLARE s record; next_body text;
 needle constant text:=$needle$  PERFORM gridex_e66_intake.persist_owned_utilts_v1($needle$;
 replacement constant text:=$needle$  IF gridex_e66_intake.request_upgrade_state_v1(p_source)<>'qualify_normally' OR source.grid_owner_data_request_id IS NOT NULL
    OR p_transactions#>>'{0,consumptionContract,metering,sourceRequestId}' IS NOT NULL
  THEN RAISE EXCEPTION 'e66_matched_qualification_reply_required' USING ERRCODE='55000'; END IF;
  PERFORM gridex_e66_intake.persist_owned_utilts_v1($needle$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS ddl,to_jsonb(p)-'prosrc' AS metadata, p.proowner,p.prosecdef
 INTO STRICT s FROM pg_proc p WHERE p.oid=to_regprocedure('public.gridex_commit_e66_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb)');
 IF s.proowner IS DISTINCT FROM current_user::regrole OR s.prosecdef IS DISTINCT FROM true
   OR md5(s.prosrc) IS DISTINCT FROM '3e2b8328d7dc988b0e07e1b075ab2b70' OR (length(s.prosrc)-length(replace(s.prosrc,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'e66_upgrade_owner_preimage_changed:public.gridex_commit_e66_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb)'; END IF;
 next_body:=replace(s.prosrc,needle,replacement);
 EXECUTE replace(s.ddl,s.prosrc,next_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=s.oid) IS DISTINCT FROM s.metadata
 THEN RAISE EXCEPTION 'e66_upgrade_owner_metadata_changed:public.gridex_commit_e66_qualification_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb)'; END IF;
END $upgrade$;
DO $upgrade$
DECLARE s record; next_body text;
 needle constant text:=$needle$ SELECT NOT EXISTS($needle$;
 replacement constant text:=$needle$ SELECT gridex_e66_intake.request_upgrade_state_v1(p_source) IN ('matched_basis','unmatched') AND NOT EXISTS($needle$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS ddl,to_jsonb(p)-'prosrc' AS metadata, p.proowner,p.prosecdef
 INTO STRICT s FROM pg_proc p WHERE p.oid=to_regprocedure('gridex_e66_intake.matched_request_ack_eligible_v1(uuid)');
 IF s.proowner IS DISTINCT FROM current_user::regrole OR s.prosecdef IS DISTINCT FROM false
   OR md5(s.prosrc) IS DISTINCT FROM 'aaead6c9c64f88e3453fb8b6b586fc8d' OR (length(s.prosrc)-length(replace(s.prosrc,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'e66_upgrade_owner_preimage_changed:gridex_e66_intake.matched_request_ack_eligible_v1(uuid)'; END IF;
 next_body:=replace(s.prosrc,needle,replacement);
 EXECUTE replace(s.ddl,s.prosrc,next_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=s.oid) IS DISTINCT FROM s.metadata
 THEN RAISE EXCEPTION 'e66_upgrade_owner_metadata_changed:gridex_e66_intake.matched_request_ack_eligible_v1(uuid)'; END IF;
END $upgrade$;
DO $upgrade$
DECLARE s record; next_body text;
 needle constant text:=$needle$ IF source.message_code='E66' AND EXISTS(SELECT FROM gridex_e66_intake.work w WHERE w.source_id=source.id) THEN$needle$;
 replacement constant text:=$needle$ IF source.message_code='E66' AND p_ack_message_id IS NULL AND reservation.response_message_id IS NULL
   AND gridex_e66_intake.request_upgrade_state_v1(source.id) NOT IN ('outside','matched_basis','unmatched')
 THEN RAISE EXCEPTION 'e66_existing_work_held_for_qualified_reply' USING ERRCODE='55000'; END IF;
 IF source.message_code='E66' AND EXISTS(SELECT FROM gridex_e66_intake.work w WHERE w.source_id=source.id) THEN$needle$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS ddl,to_jsonb(p)-'prosrc' AS metadata, p.proowner,p.prosecdef
 INTO STRICT s FROM pg_proc p WHERE p.oid=to_regprocedure('gridex_utilts_binding.require_positive_storage_authority_v1(uuid,text,uuid,text,uuid,text)');
 IF s.proowner IS DISTINCT FROM current_user::regrole OR s.prosecdef IS DISTINCT FROM true
   OR md5(s.prosrc) IS DISTINCT FROM '1b321cb31fae2bba3a0d5f312a6a097d' OR (length(s.prosrc)-length(replace(s.prosrc,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'e66_upgrade_owner_preimage_changed:gridex_utilts_binding.require_positive_storage_authority_v1(uuid,text,uuid,text,uuid,text)'; END IF;
 next_body:=replace(s.prosrc,needle,replacement);
 EXECUTE replace(s.ddl,s.prosrc,next_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=s.oid) IS DISTINCT FROM s.metadata
 THEN RAISE EXCEPTION 'e66_upgrade_owner_metadata_changed:gridex_utilts_binding.require_positive_storage_authority_v1(uuid,text,uuid,text,uuid,text)'; END IF;
END $upgrade$;
DO $upgrade$
DECLARE s record; next_body text;
 needle constant text:=$needle$  -- Keep the ordinary outbound-before-request order when both exist.$needle$;
 replacement constant text:=$needle$  IF gridex_e66_intake.request_upgrade_state_v1(p_source_message_id) NOT IN ('outside','matched_basis','unmatched')
  THEN RAISE EXCEPTION 'e66_existing_work_held_for_qualified_reply' USING ERRCODE='55000'; END IF;
  -- Keep the ordinary outbound-before-request order when both exist.$needle$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS ddl,to_jsonb(p)-'prosrc' AS metadata, p.proowner,p.prosecdef
 INTO STRICT s FROM pg_proc p WHERE p.oid=to_regprocedure('public.gridex_sync_current_e66_request_v1(uuid,uuid,uuid,uuid,uuid[],jsonb)');
 IF s.proowner IS DISTINCT FROM current_user::regrole OR s.prosecdef IS DISTINCT FROM true
   OR md5(s.prosrc) IS DISTINCT FROM 'c8316c24d03ef099f782567ce4dec0c7' OR (length(s.prosrc)-length(replace(s.prosrc,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'e66_upgrade_owner_preimage_changed:public.gridex_sync_current_e66_request_v1(uuid,uuid,uuid,uuid,uuid[],jsonb)'; END IF;
 next_body:=replace(s.prosrc,needle,replacement);
 EXECUTE replace(s.ddl,s.prosrc,next_body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=s.oid) IS DISTINCT FROM s.metadata
 THEN RAISE EXCEPTION 'e66_upgrade_owner_metadata_changed:public.gridex_sync_current_e66_request_v1(uuid,uuid,uuid,uuid,uuid[],jsonb)'; END IF;
END $upgrade$;

END
$e66_catalog_install$;

END
$e66_release_batch$;
RESET statement_timeout;
RESET lock_timeout;
