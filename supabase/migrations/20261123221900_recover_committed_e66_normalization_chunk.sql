-- Store the attempted chunk and its committed checkpoint in its normalization transaction.
CREATE TABLE gridex_e66_metering_stage.chunk_receipts (
  source_id uuid NOT NULL REFERENCES gridex_e66_metering_stage.jobs(source_id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  environment text NOT NULL,
  mailbox_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  lease_token uuid NOT NULL,
  raw_hash text NOT NULL,
  start_ordinal integer NOT NULL CHECK (start_ordinal >= 0),
  requested_limit integer NOT NULL CHECK (requested_limit BETWEEN 1 AND 8),
  next_ordinal integer NOT NULL,
  PRIMARY KEY (source_id,lease_token,start_ordinal),
  CHECK (next_ordinal > start_ordinal AND next_ordinal - start_ordinal <= requested_limit)
);
ALTER TABLE gridex_e66_metering_stage.chunk_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_e66_metering_stage.chunk_receipts FROM PUBLIC,anon,authenticated,service_role;

DO $guard$
BEGIN
 IF NOT EXISTS(
  SELECT FROM pg_proc p
  WHERE p.oid=to_regprocedure('public.gridex_normalize_e66_with_customer_outcome_v1(uuid,text,uuid,uuid,uuid,uuid,integer,integer)')
    AND p.proowner=current_user::regrole AND p.prosecdef AND md5(p.prosrc)='cc9d96c09a62459669fa26c918cdf4b3'
 ) THEN RAISE EXCEPTION 'e66_normalization_receipt_owner_preimage_changed'; END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.gridex_normalize_e66_with_customer_outcome_v1(
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
 INSERT INTO gridex_e66_metering_stage.chunk_receipts(
  source_id,company_id,environment,mailbox_id,actor_id,lease_token,raw_hash,start_ordinal,requested_limit,next_ordinal
 ) VALUES(w.source_id,w.company_id,w.environment,w.mailbox_id,p_actor,p_lease,w.payload_sha256,
  p_next,p_limit,(result->>'nextOrdinal')::integer);
 RETURN jsonb_build_object('state','progress') || result;
END $$;

-- A later checkpoint or a new lease cannot confirm a missing receipt for this call.
CREATE FUNCTION public.gridex_read_e66_normalization_chunk_receipt_v1(
 p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,p_next integer,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='1500ms'
AS $receipt$
DECLARE result jsonb;
BEGIN
 PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
 SELECT jsonb_build_object('state','progress','nextOrdinal',r.next_ordinal) INTO result
 FROM gridex_e66_metering_stage.chunk_receipts r
 JOIN gridex_e66_intake.work w ON (w.source_id,w.company_id,w.environment,w.mailbox_id,w.payload_sha256)
  =(r.source_id,r.company_id,r.environment,r.mailbox_id,r.raw_hash)
 JOIN gridex_e66_metering_stage.jobs j ON (j.source_id,j.company_id,j.environment,j.raw_hash)
  =(r.source_id,r.company_id,r.environment,r.raw_hash)
 WHERE (r.source_id,r.lease_token,r.start_ordinal)=(p_source,p_lease,p_next)
   AND (r.company_id,r.environment,r.mailbox_id,r.actor_id,r.requested_limit)
    =(p_company,p_environment,p_mailbox,p_actor,p_limit);
 RETURN result;
END
$receipt$;
REVOKE ALL ON FUNCTION public.gridex_read_e66_normalization_chunk_receipt_v1(uuid,text,uuid,uuid,uuid,uuid,integer,integer)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_e66_normalization_chunk_receipt_v1(uuid,text,uuid,uuid,uuid,uuid,integer,integer)
 TO service_role;
