-- Created with Supabase CLI 2.118.0. Prospective original UTILTS capture
-- precedes canonical assessment and consumption; it grants no business approval.
BEGIN;
LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
CREATE FUNCTION gridex_received_sources.seal_utilts_insert_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE observed timestamptz:=clock_timestamp();
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.execution_context_snapshot ? 'receivedUtiltsContext' THEN
   IF NEW.execution_context_snapshot->'receivedUtiltsContext' IS DISTINCT FROM OLD.execution_context_snapshot->'receivedUtiltsContext'
    OR NEW.raw_payload IS DISTINCT FROM OLD.raw_payload OR NEW.immutable_payload_hash IS DISTINCT FROM OLD.immutable_payload_hash
    OR ROW(NEW.id,NEW.company_id,NEW.environment,NEW.direction,NEW.message_family,NEW.message_standard,NEW.message_code,NEW.message_received_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.environment,OLD.direction,OLD.message_family,OLD.message_standard,OLD.message_code,OLD.message_received_at)
   THEN RAISE EXCEPTION 'immutable_received_utilts_source_cannot_change' USING ERRCODE='23514'; END IF;
  ELSIF NEW.execution_context_snapshot ? 'receivedUtiltsContext' THEN
   RAISE EXCEPTION 'received_utilts_context_cannot_be_backfilled' USING ERRCODE='23514';
  END IF;
 ELSIF TG_OP='INSERT' THEN
  IF jsonb_typeof(NEW.execution_context_snapshot) IN ('object','array') THEN
   NEW.execution_context_snapshot:=NEW.execution_context_snapshot-'receivedUtiltsContext';
  END IF;
  IF NEW.direction='inbound' AND NEW.message_family='UTILTS' AND NEW.message_standard='edifact'
   AND NEW.id IS NOT NULL AND NEW.company_id IS NOT NULL AND NEW.environment IN('test','production')
   AND NEW.message_code IS NOT NULL AND NEW.message_received_at IS NOT NULL AND NEW.raw_payload IS NOT NULL THEN
   NEW.immutable_payload_hash:=encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex');
   NEW.execution_context_snapshot:=(CASE WHEN jsonb_typeof(NEW.execution_context_snapshot)='object' THEN NEW.execution_context_snapshot ELSE '{}'::jsonb END)
    ||jsonb_build_object('receivedUtiltsContext',jsonb_build_object('version',1,'contextOrigin','database_insert','sourceMessageId',NEW.id,
     'companyId',NEW.company_id,'environment',NEW.environment,'messageCode',NEW.message_code,'payloadHash',NEW.immutable_payload_hash,
     'sourceReceivedAt',NEW.message_received_at,'capturedAt',observed));
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION gridex_received_sources.capture_utilts_insert_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.direction='inbound' AND NEW.message_family='UTILTS' AND NEW.message_standard='edifact'
  AND NEW.execution_context_snapshot ? 'receivedUtiltsContext' THEN
  INSERT INTO gridex_received_sources.sources(source_message_id,company_id,environment,origin,message_code,source_received_at,captured_at,raw_payload,payload_hash,received_context)
   VALUES(NEW.id,NEW.company_id,NEW.environment,'database_insert',NEW.message_code,NEW.message_received_at,
    (NEW.execution_context_snapshot#>>'{receivedUtiltsContext,capturedAt}')::timestamptz,
    NEW.raw_payload,NEW.immutable_payload_hash,NEW.execution_context_snapshot->'receivedUtiltsContext');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.seal_utilts_insert_v1(),gridex_received_sources.capture_utilts_insert_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER gridex_seal_received_utilts_source BEFORE INSERT OR UPDATE ON public.ediel_messages
 FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.seal_utilts_insert_v1();
CREATE TRIGGER gridex_capture_received_utilts_source AFTER INSERT ON public.ediel_messages
 FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.capture_utilts_insert_v1();
COMMIT;
