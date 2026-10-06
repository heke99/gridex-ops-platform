-- The real partitioned permission producer has committed own receipts.
-- Preserve legacy ACK projections and require every new positive own scope.
-- This confirms processed permission data and grants no tenant data access.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_ediel_ack_replay.prodat_permission_scope_projection_v2(c uuid,env text,sourceid uuid,ackraw text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;s public.ediel_messages%rowtype;outcomes jsonb;transitions jsonb;source_rules jsonb;h text;committed jsonb;positive_indices integer[];own jsonb;source_wire jsonb;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 ctx:=gridex_ediel_ack_replay.require_current_source_role_v2(c,env,sourceid);
 SELECT * INTO STRICT s FROM public.ediel_messages WHERE company_id=c AND id=sourceid AND environment=env AND direction='inbound' FOR SHARE;
 IF (ctx->>'actorRole' IN('energy_service_company','esco')) IS NOT TRUE OR ctx->>'family' IS DISTINCT FROM 'PRODAT' OR s.message_family IS DISTINCT FROM 'PRODAT' OR s.message_code NOT IN('Z14','Z15') OR ctx->>'code' IS DISTINCT FROM s.message_code THEN RAISE EXCEPTION 'ediel_ack_service_scope_source_unqualified';END IF;
 source_rules:=gridex_ediel_source_rules.require_v1(c,sourceid);
 outcomes:=gridex_ediel_ack_guide.prodat_outcomes_v1(ackraw,s.raw_payload);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(outcomes)x WHERE x->>'outcome'='positive') THEN RAISE EXCEPTION 'ediel_ack_service_scope_positive_reference_unavailable';END IF;
 h:=encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex');
 SELECT jsonb_agg(to_jsonb(t) ORDER BY t.permission_id) INTO transitions FROM gridex_received_sources.permission_transitions t WHERE t.company_id=c AND t.source_message_id=sourceid AND t.payload_hash=h AND t.qualified_expected_message_code=s.message_code AND t.qualified_original_message_id IS NOT NULL;
 -- Historical projections stay byte-identical. A new producer must prove
 -- every positive physical object using its committed own canonical receipt.
 IF transitions IS NULL THEN
  IF EXISTS(SELECT FROM jsonb_array_elements(outcomes)x WHERE x->>'outcome'='positive' AND(x->>'scope' IS DISTINCT FROM 'object' OR x#>>'{physicalReference,lineIndex}' IS NULL)) THEN
   RAISE EXCEPTION 'ediel_ack_service_scope_prodat_own_commit_required';
  END IF;
  SELECT array_agg(DISTINCT (x#>>'{physicalReference,lineIndex}')::integer ORDER BY (x#>>'{physicalReference,lineIndex}')::integer)
   INTO positive_indices FROM jsonb_array_elements(outcomes)x WHERE x->>'outcome'='positive';
  committed:=gridex_received_sources.committed_permission_effects_v1(c,sourceid,positive_indices);
  source_wire:=gridex_received_sources.permission_partition_wire_v1(s.raw_payload);
  FOR own IN SELECT value FROM jsonb_array_elements(outcomes) WHERE value->>'outcome'='positive' LOOP
   IF NOT EXISTS(SELECT FROM jsonb_array_elements(committed)e
    WHERE e#>>'{objectScope,registers,0,segmentIndex}'=own#>>'{physicalReference,lineIndex}'
     AND e#>>'{objectScope,objectId}' IS NOT DISTINCT FROM own#>>'{physicalReference,id}'
     AND e->>'sourcePayloadHash'=h
     AND EXISTS(SELECT FROM jsonb_array_elements(source_wire->'objects')o
      WHERE o->>'firstLineIndex'=own#>>'{physicalReference,lineIndex}'
       AND o->>'point' IS NOT DISTINCT FROM own#>>'{physicalReference,id}'
       AND o->>'li' IS NOT DISTINCT FROM own#>>'{physicalReference,li}')) THEN
    RAISE EXCEPTION 'ediel_ack_service_scope_prodat_own_commit_required';
   END IF;
  END LOOP;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.permission_id) INTO transitions
   FROM gridex_received_sources.permission_effect_transitions_v1 t
   WHERE t.company_id=c AND t.source_message_id=sourceid AND t.payload_hash=h
    AND t.qualified_expected_message_code=s.message_code AND t.qualified_original_message_id IS NOT NULL
    AND EXISTS(SELECT FROM gridex_received_sources.permission_effect_receipts r,jsonb_array_elements(committed)e
     WHERE r.id::text=e->>'receiptId' AND r.company_id=c AND r.source_message_id=sourceid
      AND r.permission_id=t.permission_id AND r.payload_hash=h);
 END IF;
 IF transitions IS NULL THEN RAISE EXCEPTION 'ediel_ack_service_scope_prodat_own_commit_required';END IF;
 RETURN jsonb_build_object('version',2,'scopeKind','prescribed_prodat_permission_ack','companyId',c,'environment',env,'sourceMessageId',sourceid,'sourceRawHash',h,'ackRawHash',encode(sha256(convert_to(ackraw,'UTF8')),'hex'),'sourceContext',ctx,'sourceRuleEvidence',source_rules,'outcomes',outcomes,'permissionTransitions',transitions,'dataAccessGranted',false);
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_ack_replay.prodat_permission_scope_projection_v2(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
