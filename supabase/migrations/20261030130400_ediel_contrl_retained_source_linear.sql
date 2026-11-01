-- claude-track3/005: linear CONTRL original discovery. Bounded forward
-- CREATE OR REPLACE of gridex_ack_authority.read_outbound_originals_v1 with
-- unchanged signature, SECURITY DEFINER, search_path, owner and grants. Only the
-- retained CONTRL discovery branch gains an exact necessary-condition gate;
-- all qualification checks inside the loop are unchanged. No RLS/grant change.
BEGIN;
DO $preimage$ BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc
     WHERE oid='gridex_ack_authority.read_outbound_originals_v1(uuid,text)'::regprocedure)
    IS DISTINCT FROM '142f25b2cfdb260e7183a2ceb5fcb309498bd0bc9b86ce297738743f9434707e' THEN
  RAISE EXCEPTION 'ediel_contrl_retained_source_linear_preimage_changed';END IF;
END $preimage$;
CREATE OR REPLACE FUNCTION gridex_ack_authority.read_outbound_originals_v1(p_source uuid, p_family text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE source public.ediel_messages%rowtype;ack public.ediel_messages%rowtype;a jsonb;s jsonb;h jsonb;items jsonb:='[]';source_hash text;ack_hash text;qualified boolean;matched boolean;company uuid;technical gridex_ediel_technical_ack.sources%rowtype;reply gridex_ediel_technical_ack.replies%rowtype;common gridex_ediel_common_header.sources%rowtype;source_envelope jsonb;source_envelope_known boolean:=false;
BEGIN
 IF p_source IS NULL OR p_family IS NULL OR p_family NOT IN('CONTRL','APERAK','UTILTS_ERR') THEN RAISE EXCEPTION 'ack_original_read_scope_required' USING ERRCODE='22023';END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source AND direction='inbound';
 IF source.id IS NULL THEN RAISE EXCEPTION 'ack_original_inbound_source_required' USING ERRCODE='23514';END IF;
 source_hash:=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex');s:=gridex_ack_authority.wire_v1(source.raw_payload);
 SELECT * INTO technical FROM gridex_ediel_technical_ack.sources WHERE source_message_id=source.id AND environment=source.environment AND payload_sha256=source_hash AND status='ready';
 SELECT * INTO common FROM gridex_ediel_common_header.sources WHERE source_message_id=source.id AND environment=source.environment AND payload_sha256=source_hash AND status='ready';
 IF source.company_id IS NULL AND technical.company_id IS NOT NULL AND common.company_id IS NOT NULL AND technical.company_id<>common.company_id THEN RAISE EXCEPTION 'ack_original_tenant_basis_ambiguous';END IF;
 company:=coalesce(source.company_id,technical.company_id,common.company_id);
 IF company IS NULL THEN RETURN jsonb_build_object('version',1,'sourceMessageId',source.id,'sourcePayloadHash',source_hash,'environment',source.environment,'companyId',NULL,'originals','[]'::jsonb);END IF;
 -- Linear discovery: the source envelope is computed once. retained_source_v1
 -- can only return source.id when the ACK uciRef equals this envelope's
 -- uciReference, so other ACKs skip the per-ACK scan of all ready sources.
 -- If the envelope cannot be computed, the unfiltered owner call is kept.
 IF p_family='CONTRL' THEN
  BEGIN source_envelope:=gridex_ediel_technical_ack.envelope(source.raw_payload);source_envelope_known:=true;
  EXCEPTION WHEN OTHERS THEN source_envelope:=NULL;source_envelope_known:=false;END;
 END IF;
 FOR ack IN SELECT m.* FROM public.ediel_messages m WHERE m.direction='outbound' AND m.company_id=company AND m.environment=source.environment AND m.message_family=p_family
  AND (m.related_message_id=source.id OR EXISTS(SELECT FROM gridex_ediel_outbound_owner.consumptions c JOIN gridex_ediel_outbound_owner.witnesses w ON w.id=c.witness_id WHERE c.source_message_id=m.id AND w.related_message_id=source.id)
   OR EXISTS(SELECT FROM gridex_ediel_common_header.negative_consumptions c JOIN gridex_ediel_common_header.negative_witnesses w ON w.id=c.witness_id WHERE c.ack_message_id=m.id AND w.source_message_id=source.id) OR EXISTS(SELECT FROM gridex_ediel_ack_replay.creation_receipts r WHERE r.ack_message_id=m.id AND r.source_message_id=source.id AND r.company_id=company AND r.environment=source.environment AND r.source_payload_hash=source_hash AND r.ack_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')) OR (p_family='CONTRL' AND CASE WHEN source_envelope_known AND (m.company_id IS DISTINCT FROM company OR m.environment IS DISTINCT FROM source.environment OR source_envelope IS NULL OR gridex_ack_authority.wire_v1(m.raw_payload)->>'uciRef' IS DISTINCT FROM source_envelope->>'uciReference') THEN false ELSE gridex_ediel_technical_ack.retained_source_v1(m,false)=source.id END)) ORDER BY m.created_at,m.id LOOP
  IF gridex_ediel_duplicate_responses.is_duplicate_ack_v1(ack.id) THEN CONTINUE;END IF;
  ack_hash:=encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex');a:=gridex_ack_authority.wire_v1(ack.raw_payload);qualified:=false;matched:=false;
  IF p_family='CONTRL' THEN
   h:=gridex_ediel_technical_ack.envelope(source.raw_payload);
   matched:=a IS NOT NULL AND h IS NOT NULL AND a->>'family'='CONTRL' AND a->'sender'=h->'receiver' AND a->'receiver'=h->'sender'
    AND a->>'environment'=h->>'environment' AND a->>'app'=h->>'applicationReference' AND a->>'uciRef'=h->>'uciReference' AND a->'uciSender'=h->'sender' AND a->'uciReceiver'=h->'receiver';
   IF NOT coalesce(matched,false) THEN CONTINUE;END IF;
   SELECT * INTO reply FROM gridex_ediel_technical_ack.replies WHERE source_message_id=source.id AND company_id=company AND environment=source.environment AND payload_sha256=source_hash;
   qualified:=gridex_ediel_technical_ack.retained_source_v1(ack,true)=source.id AND technical.company_id IS NOT DISTINCT FROM company AND reply.source_message_id IS NOT NULL AND reply.evidence->'originalUNB'=h
    AND reply.evidence->>'syntaxDecision' IN('accepted','rejected') AND a->>'uciAction'=CASE reply.evidence->>'syntaxDecision' WHEN 'accepted' THEN '1' ELSE '4' END
    AND ack.immutable_rendered_at IS NOT NULL AND ack.immutable_payload_hash=ack_hash;
  ELSE
   matched:=gridex_ediel_header_negative_birth.source_matches_v1(a,s,source);
   IF NOT coalesce(matched,false) THEN CONTINUE;END IF;
   qualified:=EXISTS(SELECT FROM gridex_received_sources.sources r WHERE r.source_message_id=source.id AND r.company_id=company AND r.environment=source.environment AND r.payload_hash=source_hash AND r.raw_payload=source.raw_payload)
    AND EXISTS(SELECT FROM gridex_ediel_outbound_owner.consumptions c JOIN gridex_ediel_outbound_owner.witnesses w ON w.id=c.witness_id
    WHERE c.source_message_id=ack.id AND c.company_id=company AND c.environment=source.environment AND c.payload_sha256=ack_hash
     AND w.company_id=company AND w.environment=source.environment AND w.payload_sha256=ack_hash AND w.related_message_id=source.id AND w.family=p_family AND w.code=ack.message_code)
    OR EXISTS(SELECT FROM gridex_ediel_common_header.negative_consumptions c JOIN gridex_ediel_common_header.negative_witnesses w ON w.id=c.witness_id
     WHERE common.source_message_id=source.id AND common.company_id=company AND common.payload_sha256=source_hash
      AND c.ack_message_id=ack.id AND c.company_id=company AND c.environment=source.environment AND c.payload_sha256=ack_hash
      AND w.company_id=company AND w.environment=source.environment AND w.source_message_id=source.id AND w.payload_sha256=ack_hash);
  END IF;
  -- Failed/cancelled is only an operational projection. A genuine born ACK
  -- remains its own original; missing historical basis is an explicit hold.
  items:=items||jsonb_build_array(jsonb_build_object('status',CASE WHEN coalesce(qualified,false) THEN 'qualified' ELSE 'held' END,'message',to_jsonb(ack),'payloadHash',ack_hash));
 END LOOP;
 RETURN jsonb_build_object('version',1,'sourceMessageId',source.id,'sourcePayloadHash',source_hash,'environment',source.environment,'companyId',company,'originals',items);
END $function$;
COMMIT;
