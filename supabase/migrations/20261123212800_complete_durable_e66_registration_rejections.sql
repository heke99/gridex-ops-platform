-- Keep native qualification ownership while a source-bound E66 registration rejection drafts its ACK.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $e66_negative_registration$
BEGIN
CREATE TABLE gridex_e66_intake.registration_rejections (
  source_id uuid PRIMARY KEY,
  reception_id uuid NOT NULL,
  company_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  mailbox_id uuid NOT NULL,
  payload_sha256 text NOT NULL,
  command_sha256 text NOT NULL,
  transaction_id text NOT NULL,
  response_message_id uuid,
  response_sha256 text,
  completed_at timestamptz,
  CHECK ((response_message_id IS NULL) = (response_sha256 IS NULL)
    AND (response_message_id IS NULL) = (completed_at IS NULL))
);
REVOKE ALL ON gridex_e66_intake.registration_rejections FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_e66_intake.require_registration_rejection_claim_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid
) RETURNS gridex_e66_intake.work
LANGUAGE plpgsql SET search_path=pg_catalog AS $claim$
DECLARE w gridex_e66_intake.work; s public.ediel_messages;
BEGIN
  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
  SELECT * INTO w FROM gridex_e66_intake.work
  WHERE (company_id,environment,mailbox_id,source_id)=(p_company,p_environment,p_mailbox,p_source)
  FOR UPDATE;
  IF w.source_id IS NULL OR p_lease IS NULL OR w.phase IS DISTINCT FROM 'qualification'
    OR w.lease_token IS DISTINCT FROM p_lease OR w.lease_actor IS DISTINCT FROM p_actor
    OR w.lease_until<=clock_timestamp()
  THEN RAISE EXCEPTION 'e66_registration_rejection_claim_changed' USING ERRCODE='55000'; END IF;
  SELECT * INTO s FROM public.ediel_messages
  WHERE (company_id,environment,id)=(p_company,p_environment,p_source) AND direction='inbound'
    AND message_standard='edifact' AND message_family='UTILTS' AND message_code='E66'
  FOR UPDATE;
  IF s.id IS NULL OR s.raw_payload IS NULL OR encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') IS DISTINCT FROM w.payload_sha256
    OR s.inbound_email_message_id IS DISTINCT FROM w.mail_id
    OR NOT EXISTS(SELECT FROM gridex_ediel_inbound_receptions.receptions r
      WHERE (r.id,r.source_message_id,r.company_id,r.environment,r.inbound_email_message_id)
        =(w.reception_id,w.source_id,w.company_id,w.environment,w.mail_id)
        AND r.classification='first_reception'
        AND r.canonical_payload_hash=w.payload_sha256 AND r.received_payload_hash=w.payload_sha256)
  THEN RAISE EXCEPTION 'e66_registration_rejection_source_changed' USING ERRCODE='55000'; END IF;
  RETURN w;
END
$claim$;
REVOKE ALL ON FUNCTION gridex_e66_intake.require_registration_rejection_claim_v1(uuid,text,uuid,uuid,uuid,uuid)
FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_commit_e66_registration_rejection_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,p_transactions jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $commit$
DECLARE w gridex_e66_intake.work; saved gridex_e66_intake.registration_rejections; tx jsonb; result jsonb; digest text; raw text;
BEGIN
  w:=gridex_e66_intake.require_registration_rejection_claim_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_lease);
  IF jsonb_typeof(p_transactions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_transactions)<>1
  THEN RAISE EXCEPTION 'e66_registration_rejection_input_required' USING ERRCODE='22023'; END IF;
  tx:=p_transactions->0;
  IF nullif(tx->>'transactionId','') IS NULL OR tx->>'disposition' IS DISTINCT FROM 'guide_rejected'
    OR tx->>'responseType' IS DISTINCT FROM 'negative_aperak'
    OR (tx->'issueCodes' ? 'UTILTS_E66_REGISTRATION_DATE_INVALID') IS NOT TRUE
    OR tx#>'{consumptionContract,observations}' IS DISTINCT FROM '[]'::jsonb
    OR tx#>>'{consumptionContract,metering,capability}' IS DISTINCT FROM 'skip'
    OR tx#>>'{consumptionContract,billing,capability}' IS DISTINCT FROM 'skip'
  THEN RAISE EXCEPTION 'e66_registration_rejection_input_required' USING ERRCODE='22023'; END IF;
  digest:=encode(sha256(convert_to(p_transactions::text,'UTF8')),'hex');
  SELECT * INTO saved FROM gridex_e66_intake.registration_rejections WHERE source_id=p_source;
  IF saved.source_id IS NOT NULL THEN
    IF (saved.company_id,saved.environment,saved.mailbox_id,saved.reception_id,saved.payload_sha256,saved.command_sha256,saved.transaction_id)
      IS DISTINCT FROM (w.company_id,w.environment,w.mailbox_id,w.reception_id,w.payload_sha256,digest,tx->>'transactionId')
      OR saved.completed_at IS NOT NULL
    THEN RAISE EXCEPTION 'e66_registration_rejection_replay_changed' USING ERRCODE='55000'; END IF;
  ELSIF gridex_e66_intake.request_upgrade_state_v1(p_source) IS DISTINCT FROM 'qualify_normally' THEN
    RAISE EXCEPTION 'e66_registration_rejection_conflicting_authority' USING ERRCODE='55000';
  END IF;
  SELECT raw_payload INTO STRICT raw FROM public.ediel_messages WHERE id=w.source_id;
  result:=gridex_e66_intake.persist_owned_utilts_v1(p_company,p_environment,p_source,'E66',raw,p_transactions,p_actor);
  IF NOT EXISTS(SELECT FROM public.ediel_ack_transaction_results a
    WHERE (a.company_id,a.environment,a.source_message_id,a.source_transaction_id)=(w.company_id,w.environment,w.source_id,tx->>'transactionId')
      AND a.disposition='guide_rejected' AND a.planned_response_type='negative_aperak' AND a.persisted_series_id IS NULL
      AND (a.final_response_type IS NULL OR a.final_response_type='negative_aperak'))
  THEN RAISE EXCEPTION 'e66_registration_rejection_proof_required' USING ERRCODE='55000'; END IF;
  INSERT INTO gridex_e66_intake.registration_rejections
   (source_id,reception_id,company_id,environment,mailbox_id,payload_sha256,command_sha256,transaction_id)
  VALUES(w.source_id,w.reception_id,w.company_id,w.environment,w.mailbox_id,w.payload_sha256,digest,tx->>'transactionId')
  ON CONFLICT(source_id) DO NOTHING;
  RETURN result;
END
$commit$;

CREATE FUNCTION public.gridex_finish_e66_registration_rejection_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $finish$
DECLARE w gridex_e66_intake.work; saved gridex_e66_intake.registration_rejections; ack public.ediel_messages;
BEGIN
  w:=gridex_e66_intake.require_registration_rejection_claim_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_lease);
  SELECT * INTO saved FROM gridex_e66_intake.registration_rejections
  WHERE (source_id,reception_id,company_id,environment,mailbox_id,payload_sha256)
    =(w.source_id,w.reception_id,w.company_id,w.environment,w.mailbox_id,w.payload_sha256)
    AND completed_at IS NULL FOR UPDATE;
  IF saved.source_id IS NULL THEN RAISE EXCEPTION 'e66_registration_rejection_proof_required' USING ERRCODE='55000'; END IF;
  SELECT m.* INTO ack FROM public.ediel_ack_transaction_results a JOIN public.ediel_messages m
    ON (m.company_id,m.environment,m.id)=(a.company_id,a.environment,a.response_message_id)
  WHERE (a.company_id,a.environment,a.source_message_id,a.source_transaction_id)
      =(saved.company_id,saved.environment,saved.source_id,saved.transaction_id)
    AND a.disposition='guide_rejected' AND a.planned_response_type='negative_aperak' AND a.final_response_type='negative_aperak'
    AND a.finalized_at IS NOT NULL AND a.persisted_series_id IS NULL
    AND (m.direction,m.message_standard,m.message_family,m.related_message_id)=('outbound','edifact','APERAK',saved.source_id)
    AND m.immutable_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
    AND EXISTS (SELECT FROM jsonb_array_elements(gridex_received_sources.wire_tokens_bounded_v1(m.raw_payload,999999)) t
      WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='313')
  FOR SHARE OF a,m;
  IF ack.id IS NULL THEN RAISE EXCEPTION 'e66_registration_rejection_ack_required' USING ERRCODE='55000'; END IF;
  UPDATE gridex_e66_intake.registration_rejections SET response_message_id=ack.id,
    response_sha256=ack.immutable_payload_hash,completed_at=clock_timestamp() WHERE source_id=saved.source_id;
  INSERT INTO public.ediel_message_events(company_id,ediel_message_id,event_type,event_status,message,payload,created_by)
  VALUES(w.company_id,w.source_id,'validated','warning','E66 registrerades efter originalets mottagningstid.',
    jsonb_build_object('reason','UTILTS_E66_REGISTRATION_DATE_INVALID','responseMessageId',ack.id),p_actor);
  UPDATE gridex_e66_intake.work SET phase='registration_rejected',lease_actor=NULL,lease_token=NULL,lease_until=NULL
  WHERE source_id=w.source_id;
  RETURN ack.id;
END
$finish$;

REVOKE ALL ON FUNCTION public.gridex_commit_e66_registration_rejection_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb),
  public.gridex_finish_e66_registration_rejection_v1(uuid,text,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_commit_e66_registration_rejection_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb),
  public.gridex_finish_e66_registration_rejection_v1(uuid,text,uuid,uuid,uuid,uuid) TO service_role;

DO $resume$
DECLARE
  owner_oid regprocedure := to_regprocedure('gridex_e66_intake.request_upgrade_state_v1(uuid)');
  before_update pg_proc%ROWTYPE;
  after_update pg_proc%ROWTYPE;
  definition text;
  patch constant text := $patch$ IF w.phase='qualification' THEN
   IF EXISTS(
     SELECT FROM gridex_e66_intake.registration_rejections pending
     JOIN public.ediel_ack_transaction_results a ON (a.company_id,a.environment,a.source_message_id,a.source_transaction_id)
       =(pending.company_id,pending.environment,pending.source_id,pending.transaction_id)
     WHERE (pending.source_id,pending.reception_id,pending.company_id,pending.environment,pending.mailbox_id,pending.payload_sha256)
         =(w.source_id,w.reception_id,w.company_id,w.environment,w.mailbox_id,w.payload_sha256)
       AND pending.completed_at IS NULL
       AND a.disposition='guide_rejected' AND a.planned_response_type='negative_aperak' AND a.persisted_series_id IS NULL
   ) THEN RETURN 'qualify_normally'; END IF;
$patch$;
  needle constant text := $needle$ IF w.phase='qualification' THEN
$needle$;
BEGIN
  SELECT * INTO before_update FROM pg_proc WHERE oid=owner_oid;
  IF encode(sha256(convert_to(before_update.prosrc,'UTF8')),'hex') IS DISTINCT FROM '8d8385b4047f0d1cf8b4ec4755948be7f4e44c1aac2e12b47214df08c79bb206'
    OR length(before_update.prosrc)-length(replace(before_update.prosrc,needle,''))<>length(needle)
  THEN RAISE EXCEPTION 'e66_registration_resume_predecessor_changed' USING ERRCODE='55000'; END IF;
  definition:=pg_get_functiondef(owner_oid);
  EXECUTE replace(definition,before_update.prosrc,replace(before_update.prosrc,needle,patch));
  SELECT * INTO STRICT after_update FROM pg_proc WHERE oid=owner_oid;
  IF (to_jsonb(after_update)-'prosrc') IS DISTINCT FROM (to_jsonb(before_update)-'prosrc')
  THEN RAISE EXCEPTION 'e66_registration_resume_authority_changed' USING ERRCODE='55000'; END IF;
END
$resume$;
END
$e66_negative_registration$;
RESET statement_timeout;
RESET lock_timeout;
