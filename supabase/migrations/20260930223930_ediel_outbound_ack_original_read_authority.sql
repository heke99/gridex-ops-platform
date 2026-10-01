-- Read existing own ACK originals before today's mutable status/role/guide.
-- This creates no history, owner witness, response or market approval.
BEGIN;
-- A503 refers to the actual UTILTS original, including ERR (which has its own
-- APERAK requirement). The ERR-on-ERR exclusion still belongs to ERR itself.
DO $$DECLARE body text;needle text:='IF (s->>''family''=''UTILTS'' AND s->>''code''<>''ERR'') IS NOT TRUE THEN RETURN false; END IF;';BEGIN
 body:=pg_get_functiondef('gridex_ack_authority.source_match_v1(jsonb,jsonb)'::regprocedure);
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'ack_source_match_original_contract_changed';END IF;
 EXECUTE replace(body,needle,'IF (s->>''family''=''UTILTS'' AND (s->>''code''<>''ERR'' OR a->>''family''=''APERAK'')) IS NOT TRUE THEN RETURN false; END IF;');
END $$;
-- A technical syntax reply may mirror an absent original application reference.
-- Its immutable syntax receipt, not a business fallback, qualifies that scope.
DO $$DECLARE body text;needle text:='OR nullif(out->>''app'','''') IS NULL OR nullif(out#>>''{sender,0}'','''') IS NULL';BEGIN
 body:=pg_get_functiondef('gridex_ack_authority.wire_v1(text)'::regprocedure);
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'ack_wire_application_contract_changed';END IF;
 EXECUTE replace(body,needle,'OR (nullif(out->>''app'','''') IS NULL AND out->>''family''<>''CONTRL'') OR nullif(out#>>''{sender,0}'','''') IS NULL');
END $$;
CREATE FUNCTION gridex_ack_authority.read_outbound_originals_v1(p_source uuid,p_family text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;ack public.ediel_messages%rowtype;a jsonb;s jsonb;h jsonb;items jsonb:='[]';source_hash text;ack_hash text;qualified boolean;matched boolean;company uuid;technical gridex_ediel_technical_ack.sources%rowtype;reply gridex_ediel_technical_ack.replies%rowtype;common gridex_ediel_common_header.sources%rowtype;
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
 FOR ack IN SELECT m.* FROM public.ediel_messages m WHERE m.direction='outbound' AND m.company_id=company AND m.environment=source.environment AND m.message_family=p_family
  AND (m.related_message_id=source.id OR EXISTS(SELECT FROM gridex_ediel_outbound_owner.consumptions c JOIN gridex_ediel_outbound_owner.witnesses w ON w.id=c.witness_id WHERE c.source_message_id=m.id AND w.related_message_id=source.id)
   OR EXISTS(SELECT FROM gridex_ediel_common_header.negative_consumptions c JOIN gridex_ediel_common_header.negative_witnesses w ON w.id=c.witness_id WHERE c.ack_message_id=m.id AND w.source_message_id=source.id)) ORDER BY m.created_at,m.id LOOP
  ack_hash:=encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex');a:=gridex_ack_authority.wire_v1(ack.raw_payload);qualified:=false;matched:=false;
  IF p_family='CONTRL' THEN
   h:=gridex_ediel_technical_ack.envelope(source.raw_payload);
   matched:=a IS NOT NULL AND h IS NOT NULL AND a->>'family'='CONTRL' AND a->'sender'=h->'receiver' AND a->'receiver'=h->'sender'
    AND a->>'environment'=h->>'environment' AND a->>'app'=h->>'applicationReference' AND a->>'uciRef'=h->>'uciReference' AND a->'uciSender'=h->'sender' AND a->'uciReceiver'=h->'receiver';
   IF NOT coalesce(matched,false) THEN CONTINUE;END IF;
   SELECT * INTO reply FROM gridex_ediel_technical_ack.replies WHERE source_message_id=source.id AND company_id=company AND environment=source.environment AND payload_sha256=source_hash;
   qualified:=technical.company_id IS NOT DISTINCT FROM company AND reply.source_message_id IS NOT NULL AND reply.evidence->'originalUNB'=h
    AND reply.evidence->>'syntaxDecision' IN('accepted','rejected') AND a->>'uciAction'=CASE reply.evidence->>'syntaxDecision' WHEN 'accepted' THEN '1' ELSE '4' END
    AND ack.immutable_rendered_at IS NOT NULL AND ack.immutable_payload_hash=ack_hash;
  ELSE
   matched:=gridex_ack_authority.source_match_v1(a,s);
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
END $$;
CREATE FUNCTION public.gridex_read_outbound_acks_for_source_v1(p_source_message_id uuid,p_ack_family text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 RETURN gridex_ack_authority.read_outbound_originals_v1(p_source_message_id,p_ack_family);END $$;
REVOKE ALL ON FUNCTION gridex_ack_authority.read_outbound_originals_v1(uuid,text),public.gridex_read_outbound_acks_for_source_v1(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_outbound_acks_for_source_v1(uuid,text) TO service_role;
COMMIT;
