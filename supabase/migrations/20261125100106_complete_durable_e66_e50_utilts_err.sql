ALTER TABLE gridex_e66_intake.registration_rejections DROP CONSTRAINT e66_rejection_reason_supported;
ALTER TABLE gridex_e66_intake.registration_rejections ADD CONSTRAINT e66_rejection_reason_supported CHECK (
  rejection_reason IN ('UTILTS_E66_REGISTRATION_DATE_INVALID','UTILTS_TIMEZONE_INVALID','UTILTS_E66_DELIVERY_END_AFTER_REGISTRATION')
);

CREATE FUNCTION gridex_e66_intake.require_e50_original_v1(p_company uuid,p_source uuid,p_raw text,p_transaction text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $proof$
DECLARE
  token_index integer;
  tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(p_raw);
  boundary integer;
  wire jsonb:=gridex_ack_authority.wire_v1(p_raw);
  guide jsonb;
  deliveries jsonb;
  registrations jsonb;
  dates text;
  delivered_until timestamptz;
  registered_at timestamptz;
BEGIN
  guide:=gridex_ediel_source_rules.require_v1(p_company,p_source);
  IF NOT EXISTS(SELECT FROM public.ediel_rule_packs p WHERE p.id=(guide->>'rulePackId')::uuid
      AND p.family='UTILTS' AND p.guide_version='25-A-5')
    OR wire->>'family' IS DISTINCT FROM 'UTILTS' OR wire->>'code' IS DISTINCT FROM 'E66'
    OR wire->'ide' IS DISTINCT FROM jsonb_build_array(p_transaction)
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t
      WHERE t->>'tag'='MKS' AND t#>>'{elements,2,0}' IN ('E02','E03'))
  THEN RAISE EXCEPTION 'e66_e50_original_required' USING ERRCODE='55000'; END IF;
  SELECT min((t->>'index')::int) INTO token_index FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='IDE';
  SELECT min((t->>'index')::int) INTO boundary FROM jsonb_array_elements(tokens) t
    WHERE t->>'tag' IN ('SEQ','UNT') AND (t->>'index')::int>token_index;
  SELECT jsonb_agg(t#>'{elements,1}') FILTER(WHERE t#>>'{elements,1,0}'='324'),
    jsonb_agg(t#>'{elements,1}') FILTER(WHERE t#>>'{elements,1,0}'='597')
  INTO deliveries,registrations FROM jsonb_array_elements(tokens) t
  WHERE t->>'tag'='DTM' AND (t->>'index')::int>token_index AND (t->>'index')::int<boundary;
  IF jsonb_array_length(deliveries) IS DISTINCT FROM 1 OR jsonb_array_length(registrations) IS DISTINCT FROM 1
    OR jsonb_array_length(deliveries->0) IS DISTINCT FROM 3 OR jsonb_array_length(registrations->0) IS DISTINCT FROM 3
    OR deliveries#>>'{0,2}' IS DISTINCT FROM '719' OR registrations#>>'{0,2}' IS DISTINCT FROM '203'
  THEN RAISE EXCEPTION 'e66_e50_original_required' USING ERRCODE='55000'; END IF;
  dates:=deliveries#>>'{0,1}';
  IF NOT coalesce(dates ~ '^[0-9]{24}$',false) THEN RAISE EXCEPTION 'e66_e50_original_required' USING ERRCODE='55000'; END IF;
  delivered_until:=gridex_utilts_binding.esco_local_time_v1(right(dates,12),'+0000');
  registered_at:=gridex_utilts_binding.esco_local_time_v1(registrations#>>'{0,1}','+0000');
  IF NOT coalesce(delivered_until>registered_at,false) THEN
    RAISE EXCEPTION 'e66_e50_original_required' USING ERRCODE='55000';
  END IF;
END
$proof$;
REVOKE ALL ON FUNCTION gridex_e66_intake.require_e50_original_v1(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_commit_e66_e50_rejection_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid,p_transactions jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $commit$
DECLARE w gridex_e66_intake.work; saved gridex_e66_intake.registration_rejections; tx jsonb; answer jsonb; digest text; raw text;
DECLARE reason constant text:='UTILTS_E66_DELIVERY_END_AFTER_REGISTRATION';
BEGIN
  w:=gridex_e66_intake.require_registration_rejection_claim_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_lease);
  IF jsonb_typeof(p_transactions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_transactions)<>1 THEN
    RAISE EXCEPTION 'e66_e50_command_required' USING ERRCODE='22023';
  END IF;
  tx:=p_transactions->0;
  IF nullif(tx->>'transactionId','') IS NULL OR tx->>'disposition' IS DISTINCT FROM 'processability_rejected'
    OR tx->>'responseType' IS DISTINCT FROM 'utilts_err' OR tx->'issueCodes' IS DISTINCT FROM jsonb_build_array(reason)
    OR tx#>'{consumptionContract,observations}' IS DISTINCT FROM '[]'::jsonb
    OR tx#>>'{consumptionContract,metering,capability}' IS DISTINCT FROM 'skip'
    OR tx#>>'{consumptionContract,billing,capability}' IS DISTINCT FROM 'skip'
  THEN RAISE EXCEPTION 'e66_e50_command_required' USING ERRCODE='22023'; END IF;
  digest:=encode(sha256(convert_to(p_transactions::text,'UTF8')),'hex');
  SELECT * INTO saved FROM gridex_e66_intake.registration_rejections WHERE source_id=p_source;
  IF FOUND THEN
    IF (saved.company_id,saved.environment,saved.mailbox_id,saved.reception_id,saved.payload_sha256,saved.command_sha256,saved.transaction_id,saved.rejection_reason)
      IS DISTINCT FROM (w.company_id,w.environment,w.mailbox_id,w.reception_id,w.payload_sha256,digest,tx->>'transactionId',reason)
      OR saved.completed_at IS NOT NULL THEN RAISE EXCEPTION 'e66_e50_replay_changed' USING ERRCODE='55000'; END IF;
  ELSIF gridex_e66_intake.request_upgrade_state_v1(p_source) IS DISTINCT FROM 'qualify_normally' THEN
    RAISE EXCEPTION 'e66_e50_conflicting_authority' USING ERRCODE='55000';
  END IF;
  SELECT raw_payload INTO STRICT raw FROM public.ediel_messages WHERE id=w.source_id;
  PERFORM gridex_e66_intake.require_e50_original_v1(w.company_id,w.source_id,raw,tx->>'transactionId');
  answer:=gridex_e66_intake.persist_owned_utilts_v1(p_company,p_environment,p_source,'E66',raw,p_transactions,p_actor);
  IF NOT EXISTS(SELECT FROM public.ediel_ack_transaction_results a
    WHERE (a.company_id,a.environment,a.source_message_id,a.source_transaction_id)=(w.company_id,w.environment,w.source_id,tx->>'transactionId')
      AND a.disposition='processability_rejected' AND a.planned_response_type='utilts_err' AND a.persisted_series_id IS NULL
      AND (a.final_response_type IS NULL OR a.final_response_type='utilts_err'))
  THEN RAISE EXCEPTION 'e66_e50_proof_required' USING ERRCODE='55000'; END IF;
  INSERT INTO gridex_e66_intake.registration_rejections
    (source_id,reception_id,company_id,environment,mailbox_id,payload_sha256,command_sha256,transaction_id,rejection_reason)
  VALUES(w.source_id,w.reception_id,w.company_id,w.environment,w.mailbox_id,w.payload_sha256,digest,tx->>'transactionId',reason)
  ON CONFLICT(source_id) DO NOTHING;
  RETURN answer;
END
$commit$;

CREATE FUNCTION public.gridex_finish_e66_e50_rejection_v1(
  p_company uuid,p_environment text,p_mailbox uuid,p_source uuid,p_actor uuid,p_lease uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $finish$
DECLARE w gridex_e66_intake.work; saved gridex_e66_intake.registration_rejections; ack public.ediel_messages; tokens jsonb;
BEGIN
  w:=gridex_e66_intake.require_registration_rejection_claim_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_lease);
  SELECT * INTO saved FROM gridex_e66_intake.registration_rejections
  WHERE (source_id,reception_id,company_id,environment,mailbox_id,payload_sha256)
    =(w.source_id,w.reception_id,w.company_id,w.environment,w.mailbox_id,w.payload_sha256)
    AND rejection_reason='UTILTS_E66_DELIVERY_END_AFTER_REGISTRATION' AND completed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'e66_e50_proof_required' USING ERRCODE='55000'; END IF;
  SELECT m.* INTO ack FROM public.ediel_ack_transaction_results a JOIN public.ediel_messages m
    ON (m.company_id,m.environment,m.id)=(a.company_id,a.environment,a.response_message_id)
  WHERE (a.company_id,a.environment,a.source_message_id,a.source_transaction_id)
      =(saved.company_id,saved.environment,saved.source_id,saved.transaction_id)
    AND a.disposition='processability_rejected' AND a.planned_response_type='utilts_err' AND a.final_response_type='utilts_err'
    AND a.finalized_at IS NOT NULL AND a.persisted_series_id IS NULL
    AND (m.direction,m.message_standard,m.message_family,m.related_message_id)=('outbound','edifact','UTILTS_ERR',saved.source_id)
    AND m.immutable_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  FOR SHARE OF a,m;
  tokens:=gridex_utilts_binding.wire_tokens_v1(ack.raw_payload);
  IF ack.id IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t
      WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='ERR')
    OR (SELECT jsonb_agg(jsonb_build_array(t#>'{elements,1}',t#>'{elements,2}',t#>'{elements,3}'))
      FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='STS' AND t#>>'{elements,1,0}'='E01')
      IS DISTINCT FROM '[[["E01","","260"],["41"],["E50","","260"]]]'::jsonb
    OR (SELECT jsonb_agg(t#>>'{elements,1,1}') FROM jsonb_array_elements(tokens) t
      WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='TN') IS DISTINCT FROM jsonb_build_array(saved.transaction_id)
  THEN RAISE EXCEPTION 'e66_e50_canonical_err_required' USING ERRCODE='55000'; END IF;
  UPDATE gridex_e66_intake.registration_rejections SET response_message_id=ack.id,
    response_sha256=ack.immutable_payload_hash,completed_at=clock_timestamp() WHERE source_id=saved.source_id;
  INSERT INTO public.ediel_message_events(company_id,ediel_message_id,event_type,event_status,message,payload,created_by)
  VALUES(w.company_id,w.source_id,'validated','warning','E66-leveransperioden slutar efter registreringstiden.',
    jsonb_build_object('reason',saved.rejection_reason,'responseMessageId',ack.id),p_actor);
  UPDATE gridex_e66_intake.work SET phase='registration_rejected',lease_actor=NULL,lease_token=NULL,lease_until=NULL
    WHERE source_id=w.source_id;
  RETURN ack.id;
END
$finish$;

REVOKE ALL ON FUNCTION public.gridex_commit_e66_e50_rejection_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb),
  public.gridex_finish_e66_e50_rejection_v1(uuid,text,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_commit_e66_e50_rejection_v1(uuid,text,uuid,uuid,uuid,uuid,jsonb),
  public.gridex_finish_e66_e50_rejection_v1(uuid,text,uuid,uuid,uuid,uuid) TO service_role;

DO $resume$
DECLARE target constant regprocedure:='gridex_e66_intake.request_upgrade_state_v1(uuid)'::regprocedure;
DECLARE original constant text:=$old$       AND a.disposition='guide_rejected' AND a.planned_response_type='negative_aperak' AND a.persisted_series_id IS NULL$old$;
DECLARE extended constant text:=$new$       AND a.persisted_series_id IS NULL AND ((a.disposition,a.planned_response_type)=('guide_rejected','negative_aperak')
         OR (pending.rejection_reason,a.disposition,a.planned_response_type)=
           ('UTILTS_E66_DELIVERY_END_AFTER_REGISTRATION','processability_rejected','utilts_err'))$new$;
BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=target)
      IS DISTINCT FROM '91b736c9ac19658a84f691a7609d930a015a58ec824f9d5e6d9495af6f8d0c6c' THEN
    RAISE EXCEPTION 'e66_e50_resume_predecessor_changed' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(pg_get_functiondef(target),original,extended);
END
$resume$;
