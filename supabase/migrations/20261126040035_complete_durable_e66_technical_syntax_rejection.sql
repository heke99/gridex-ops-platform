-- A technical rejection authorizes only a retained negative CONTRL. It must
-- never supply an accepted transaction, metering source or transport receipt.
CREATE TABLE gridex_e66_intake.technical_rejections (
  source_id uuid PRIMARY KEY REFERENCES gridex_e66_intake.work(source_id),
  reception_id uuid NOT NULL,
  company_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  mailbox_id uuid NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_id uuid NOT NULL,
  lease_token uuid NOT NULL,
  ack_id uuid NOT NULL UNIQUE REFERENCES public.ediel_messages(id),
  ack_sha256 text NOT NULL CHECK (ack_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE gridex_e66_intake.technical_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_e66_intake.technical_rejections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_e66_intake.technical_rejections FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.gridex_finish_e66_technical_rejection_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,p_ack uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $finish$
DECLARE w gridex_e66_intake.work; prior gridex_e66_intake.technical_rejections;
  owned jsonb; source_wire text; tokens jsonb; unt_value text; own_unh integer; own_unt integer; owned_ack_hash text;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR p_lease IS NULL OR p_ack IS NULL THEN
    RAISE EXCEPTION 'e66_technical_rejection_scope_required' USING ERRCODE='42501';
  END IF;

  -- Acquire the existing technical read owner's locks before the durable
  -- graph, and require a protected reply for the exact current actor.
  owned:=gridex_ediel_technical_ack.read_persisted_contrl_v2(p_company,p_environment,p_ack,p_actor,'prepare');
  owned_ack_hash:=owned#>>'{ackMessage,immutable_payload_hash}';
  IF owned#>>'{technicalSyntaxAckEvidence,syntaxDecision}' IS DISTINCT FROM 'rejected'
    OR owned#>>'{technicalSyntaxAckEvidence,sourceMessageId}' IS DISTINCT FROM p_source::text
    OR owned#>>'{ackMessage,id}' IS DISTINCT FROM p_ack::text
    OR owned#>>'{ackMessage,related_message_id}' IS DISTINCT FROM p_source::text
    OR owned_ack_hash IS DISTINCT FROM encode(sha256(convert_to(owned#>>'{ackMessage,raw_payload}','UTF8')),'hex')
    OR NOT coalesce(owned_ack_hash ~ '^[0-9a-f]{64}$',false)
  THEN RAISE EXCEPTION 'e66_technical_rejection_ack_required' USING ERRCODE='55000'; END IF;

  PERFORM gridex_utilts_binding.lock_storage_graph_v1();
  PERFORM gridex_e66_intake.require_dispatch_scope(p_company,p_environment,p_mailbox,p_actor);
  SELECT * INTO w FROM gridex_e66_intake.work WHERE source_id=p_source FOR UPDATE;
  IF w.source_id IS NULL OR (w.company_id,w.environment,w.mailbox_id) IS DISTINCT FROM (p_company,p_environment,p_mailbox)
    OR w.payload_sha256 IS DISTINCT FROM owned#>>'{technicalSyntaxAckEvidence,sourceHash}'
  THEN RAISE EXCEPTION 'e66_technical_rejection_scope_changed' USING ERRCODE='42501'; END IF;

  SELECT * INTO prior FROM gridex_e66_intake.technical_rejections WHERE source_id=p_source;
  IF FOUND THEN
    IF w.phase IS DISTINCT FROM 'technical_rejected'
      OR (prior.reception_id,prior.company_id,prior.environment,prior.mailbox_id,prior.payload_sha256,
        prior.actor_id,prior.lease_token,prior.ack_id,prior.ack_sha256) IS DISTINCT FROM
        (w.reception_id,p_company,p_environment,p_mailbox,w.payload_sha256,p_actor,p_lease,p_ack,owned_ack_hash)
    THEN RAISE EXCEPTION 'e66_technical_rejection_replay_conflict' USING ERRCODE='55000'; END IF;
    RETURN p_ack;
  END IF;
  w:=gridex_e66_intake.require_registration_rejection_claim_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_lease);
  SELECT raw_payload INTO STRICT source_wire FROM public.ediel_messages WHERE id=p_source;
  IF NOT EXISTS (
    SELECT FROM gridex_ediel_technical_ack.syntax_facets f WHERE f.source_message_id=w.source_id
      AND f.company_id=w.company_id AND f.environment=w.environment AND f.payload_sha256=w.payload_sha256
      AND f.facts_text::jsonb->>'syntaxDecision'='rejected'
      AND (f.facts_text::jsonb->'reasonCodes') ? 'unt_count_mismatch'
  ) THEN RAISE EXCEPTION 'e66_technical_rejection_syntax_receipt_required' USING ERRCODE='55000'; END IF;

  tokens:=gridex_utilts_binding.wire_tokens_v1(source_wire);
  IF (SELECT count(*) FROM jsonb_array_elements(tokens) s WHERE s->>'tag'='UNH')<>1
    OR (SELECT count(*) FROM jsonb_array_elements(tokens) s WHERE s->>'tag'='UNT')<>1
  THEN RAISE EXCEPTION 'e66_technical_rejection_own_message_required' USING ERRCODE='55000'; END IF;
  SELECT ordinal INTO own_unh FROM jsonb_array_elements(tokens) WITH ORDINALITY AS s(token,ordinal)
  WHERE token->>'tag'='UNH' AND token#>>'{elements,2,0}'='UTILTS';
  SELECT ordinal,token#>>'{elements,1,0}' INTO own_unt,unt_value
  FROM jsonb_array_elements(tokens) WITH ORDINALITY AS s(token,ordinal) WHERE token->>'tag'='UNT';
  IF own_unh IS NULL OR own_unt<=own_unh OR NOT coalesce(unt_value ~ '^[0-9]{1,6}$',false)

  THEN RAISE EXCEPTION 'e66_technical_rejection_unt_mismatch_required' USING ERRCODE='55000'; END IF;

  IF own_unt-own_unh+1=unt_value::integer THEN
    RAISE EXCEPTION 'e66_technical_rejection_unt_mismatch_required' USING ERRCODE='55000';
  END IF;

  INSERT INTO gridex_e66_intake.technical_rejections(source_id,reception_id,company_id,environment,mailbox_id,
    payload_sha256,actor_id,lease_token,ack_id,ack_sha256)
  VALUES(w.source_id,w.reception_id,w.company_id,w.environment,w.mailbox_id,w.payload_sha256,p_actor,p_lease,p_ack,owned_ack_hash);
  UPDATE gridex_e66_intake.work SET phase='technical_rejected',lease_actor=NULL,lease_token=NULL,lease_until=NULL
  WHERE source_id=w.source_id;
  RETURN p_ack;
END
$finish$;

REVOKE ALL ON FUNCTION public.gridex_finish_e66_technical_rejection_v1(uuid,text,uuid,uuid,uuid,uuid,uuid)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_finish_e66_technical_rejection_v1(uuid,text,uuid,uuid,uuid,uuid,uuid)
TO service_role;
