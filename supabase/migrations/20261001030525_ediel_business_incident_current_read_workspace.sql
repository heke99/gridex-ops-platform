-- CLI-created forward: explicit own-company read and separate mutation access.
-- ACK replay remains write-authorized; this private inspection body has identical
-- immutable source/ACK/grant/namespace checks and only changes its actor gate.
BEGIN;
CREATE FUNCTION gridex_ediel_business_incidents.actor_v2(c uuid,actor uuid,mode text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 RETURN c IS NOT NULL AND actor IS NOT NULL AND mode IN('read','report')
 AND EXISTS(SELECT FROM auth.users WHERE id=actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))
 AND EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
 AND EXISTS(SELECT FROM public.companies WHERE id=c AND status='active')
 AND EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
 AND CASE WHEN mode='read' THEN gridex_requested_changes.scoped_permission_v1(c,actor,'communication.read')
 ELSE gridex_requested_changes.scoped_permission_v1(c,actor,'communication.write') AND gridex_requested_changes.scoped_permission_v1(c,actor,'communication.send') END;
END $$;
CREATE FUNCTION public.ediel_fresh_business_incident_access_v1(p_company_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF gridex_ediel_business_incidents.actor_v2(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_business_incident_reader_forbidden' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('companyId',p_company_id,'canRead',true,'canReport',gridex_ediel_business_incidents.actor_v2(p_company_id,p_actor_user_id,'report'));
END $$;
CREATE FUNCTION gridex_ediel_business_incidents.inspect_ack_v1(c uuid,env text,source_id uuid,actor uuid,family text,ack_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE source public.ediel_messages%rowtype;ack public.ediel_messages%rowtype;ids uuid[];context jsonb;ack_context jsonb;basis jsonb;own_basis jsonb;
 a jsonb;s jsonb;tokens jsonb;sequence_field text:=NULL;sequence_value text:=NULL;common_source boolean;observed timestamptz:=clock_timestamp();companies uuid[];wire_outcome text;
BEGIN
 IF c IS NULL OR actor IS NULL OR source_id IS NULL OR env IS NULL OR env NOT IN('test','production') OR family IS NULL OR family NOT IN('CONTRL','APERAK','UTILTS_ERR')
  OR (sequence_field IS NULL)<>(sequence_value IS NULL) OR sequence_field IS NOT NULL AND (sequence_field NOT IN('relatedTransactionReference','utiltsErrSequenceToken') OR nullif(btrim(sequence_value),'') IS NULL)
  OR family='CONTRL' AND sequence_field IS NOT NULL OR sequence_field='utiltsErrSequenceToken' AND family<>'UTILTS_ERR' THEN
  RAISE EXCEPTION 'ediel_ack_replay_scope_required' USING ERRCODE='22023';END IF;
 -- A permission decision must remain true through source/ACK qualification.
 -- SHARE prevents UPDATE/DELETE and phantom INSERT grants/namespace collisions;
 -- all permission sources used by the current native resolver are included.
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
  OR NOT EXISTS(SELECT FROM public.companies co WHERE co.id=c AND co.status='active') THEN
  RAISE EXCEPTION 'ediel_ack_replay_actor_not_authorized' USING ERRCODE='42501';END IF;
 -- Stabilize the entire own-source candidate set, including opposite outcomes.
 -- A later concurrent INSERT is re-read through this same command after 23505.
 LOCK TABLE public.ediel_messages IN SHARE MODE;
 SELECT * INTO source FROM public.ediel_messages WHERE id=source_id AND environment=env AND direction='inbound'
  AND message_standard='edifact' AND (company_id=c OR company_id IS NULL) FOR SHARE;
 IF source.id IS NULL OR nullif(source.raw_payload,'') IS NULL THEN RAISE EXCEPTION 'ediel_ack_replay_actual_source_unavailable';END IF;
 common_source:=family='APERAK' AND source.message_family='PRODAT' AND EXISTS(SELECT FROM gridex_ediel_common_header.sources p WHERE p.source_message_id=source.id AND p.company_id=c AND p.environment=env AND p.status='ready');
 IF gridex_ediel_business_incidents.actor_v2(c,actor,'read') IS NOT TRUE THEN
  RAISE EXCEPTION 'ediel_ack_replay_actor_not_authorized' USING ERRCODE='42501';END IF;
 IF family='CONTRL' THEN
  basis:=gridex_ediel_technical_ack.require_source_v1(c,source.id);
  PERFORM gridex_ediel_technical_ack.require_current_endpoint_v1(basis);
 ELSIF common_source THEN
  basis:=gridex_ediel_common_header.require_v1(c,env,source.id);
  PERFORM gridex_ediel_common_header.require_current_scope_v1(basis);
 ELSE
  IF source.company_id IS DISTINCT FROM c THEN RAISE EXCEPTION 'ediel_ack_replay_actual_source_unavailable';END IF;
  basis:=gridex_ediel_source_rules.require_v1(c,source.id);
  context:=gridex_ediel_ack_replay.require_current_source_role_v2(c,env,source.id);
  -- The immutable local legal recipient becomes the ACK issuer. Both wire
  -- legal parties and full transport components are matched below; only the
  -- current local namespace is resolved here, without profile/role re-selection.
  IF context->>'basisKind' IS DISTINCT FROM 'observed_source_persistence' OR context->>'companyId' IS DISTINCT FROM c::text OR context->>'environment' IS DISTINCT FROM env THEN RAISE EXCEPTION 'ediel_ack_replay_legal_scope_invalid';END IF;
  SELECT array_agg(DISTINCT i.company_id) INTO companies FROM public.tenant_actor_identifiers i WHERE i.environment=env AND i.identifier_type='EdielId'
   AND i.identifier_value=context->>'legalEdielId' AND i.valid_from<=observed AND (i.valid_to IS NULL OR observed<i.valid_to);
  IF cardinality(companies) IS DISTINCT FROM 1 OR companies[1] IS DISTINCT FROM c OR NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=env
   AND i.actor_id::text=context->>'legalActorId' AND i.identifier_type='EdielId' AND i.identifier_value=context->>'legalEdielId'
   AND i.valid_from<=observed AND (i.valid_to IS NULL OR observed<i.valid_to)) THEN RAISE EXCEPTION 'ediel_ack_replay_legal_scope_invalid';END IF;
  PERFORM gridex_ediel_technical_ack.require_current_endpoint_v1(context);
 END IF;
 IF ack_id IS NULL THEN RETURN jsonb_build_object('version',1,'sourceMessage',to_jsonb(source));END IF;
 SELECT array_agg(m.id) INTO ids FROM public.ediel_messages m WHERE m.id=ack_id AND m.company_id=c AND m.environment=env AND m.direction='outbound' AND m.related_message_id=source.id AND m.message_family=family;
 IF coalesce(cardinality(ids),0)=0 THEN RETURN NULL;END IF;
 IF cardinality(ids)<>1 THEN RAISE EXCEPTION 'ediel_ack_replay_own_response_ambiguous';END IF;
 SELECT * INTO STRICT ack FROM public.ediel_messages WHERE id=ids[1] AND company_id=c AND environment=env AND direction='outbound' AND related_message_id=source.id AND message_family=family FOR SHARE;
 IF NOT EXISTS(SELECT FROM gridex_ediel_wire_namespace.coverage w WHERE w.source_message_id=ack.id AND w.company_id=c AND w.environment=env
  AND w.payload_sha256=encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex')) THEN RAISE EXCEPTION 'ediel_ack_replay_private_own_wire_unavailable';END IF;
 IF family='CONTRL' THEN
  own_basis:=gridex_ediel_technical_ack.require_contrl_v1(ack);
  IF own_basis IS DISTINCT FROM basis THEN RAISE EXCEPTION 'ediel_ack_replay_original_basis_mismatch';END IF;
  wire_outcome:=CASE own_basis->>'syntaxDecision' WHEN 'accepted' THEN 'positive' WHEN 'rejected' THEN 'negative' END;
 ELSIF common_source THEN
  own_basis:=gridex_ediel_ack_replay.require_common_own_v2(ack);
  IF own_basis IS DISTINCT FROM basis THEN RAISE EXCEPTION 'ediel_ack_replay_original_basis_mismatch';END IF;
  wire_outcome:='negative';
 ELSE
  own_basis:=gridex_ediel_outbound_owner.require_v1(c,ack.id);
  IF own_basis IS DISTINCT FROM basis OR gridex_ediel_source_rules.require_v1(c,ack.id) IS DISTINCT FROM basis
   OR NOT EXISTS(SELECT FROM gridex_ediel_source_rules.receipts r WHERE r.source_message_id=ack.id AND r.original_source_message_id=source.id) THEN RAISE EXCEPTION 'ediel_ack_replay_original_basis_mismatch';END IF;
  ack_context:=gridex_ediel_inbound_context.require_v1(c,ack.id);
  IF ack_context->>'basisKind' IS DISTINCT FROM 'prescribed_outbound_ack' OR ack_context->>'originalSourceMessageId' IS DISTINCT FROM source.id::text
   OR ack_context->>'originalSourceHash' IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex')
   OR ack_context->>'legalActorId' IS DISTINCT FROM context->>'legalActorId' OR ack_context->>'legalEdielId' IS DISTINCT FROM context->>'legalEdielId'
   OR ack_context->>'transportActorId' IS DISTINCT FROM context->>'transportActorId' THEN RAISE EXCEPTION 'ediel_ack_replay_legal_scope_invalid';END IF;
  a:=gridex_ack_authority.wire_v1(ack.raw_payload);s:=gridex_ack_authority.wire_v1(source.raw_payload);
  IF NOT coalesce(gridex_ack_authority.source_match_v1(a,s),false) THEN RAISE EXCEPTION 'ediel_ack_replay_physical_source_mismatch';END IF;
  IF sequence_field='relatedTransactionReference' AND (NOT coalesce(s->'ide','[]') ? sequence_value
   OR NOT (CASE family WHEN 'APERAK' THEN coalesce(a#>'{refs,ACW}','[]') ELSE coalesce(a#>'{refs,TN}','[]') END) ? sequence_value
   OR ack.parsed_payload->>'ackScope' IS DISTINCT FROM 'transaction') THEN RAISE EXCEPTION 'ediel_ack_replay_sequence_mismatch';END IF;
  IF sequence_field='utiltsErrSequenceToken' THEN
   tokens:=gridex_utilts_binding.wire_tokens_v1(ack.raw_payload);
   IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='STS' AND t#>>'{elements,1,0}'='E01' AND t#>>'{elements,2,0}'='41' AND t#>>'{elements,3,0}'=sequence_value) THEN RAISE EXCEPTION 'ediel_ack_replay_sequence_mismatch';END IF;
  END IF;
  wire_outcome:=CASE WHEN family='UTILTS_ERR' THEN 'negative' WHEN jsonb_array_length(coalesce(a->'erc','[]'))>0 AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(a->'erc') x WHERE x<>'100') THEN 'positive' ELSE 'negative' END;
 END IF;
 IF common_source THEN PERFORM gridex_ediel_ack_replay.require_common_guide_v2(ack,own_basis);ELSE PERFORM gridex_ediel_ack_replay.require_readonly_guide_v2(ack);END IF;
 IF family='APERAK' AND source.message_family='PRODAT' THEN PERFORM gridex_ediel_ack_replay.require_readonly_prodat_ledger_v2(ack);END IF;
 IF family='APERAK' AND source.message_family='PRODAT' AND EXISTS(SELECT FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(ack.raw_payload))t WHERE t->>'tag'='ERC' AND t#>>'{elements,1,0}'='100') THEN
  PERFORM public.ediel_require_recorded_prodat_bilateral_ack_source_v1(c,source.id,encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex'));END IF;
 IF NOT common_source AND family<>'CONTRL' AND context->>'actorRole' IN('energy_service_company','esco') AND wire_outcome='positive' THEN
  PERFORM gridex_ediel_ack_replay.require_positive_service_scope_v1(c,env,source.id,ack.raw_payload);END IF;
 IF wire_outcome IS NULL OR ack.ack_outcome IS NOT NULL AND ack.ack_outcome IS DISTINCT FROM wire_outcome THEN RAISE EXCEPTION 'ediel_ack_replay_own_outcome_mismatch';END IF;
 RETURN jsonb_build_object('version',1,'sourceMessage',to_jsonb(source),'ackMessage',to_jsonb(ack)||jsonb_build_object('ack_outcome',wire_outcome));
END $$;
CREATE FUNCTION gridex_ediel_business_incidents.original_read_v2(c uuid,actor uuid,input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;ack public.ediel_messages%rowtype;owned jsonb;receipt jsonb;scopes jsonb;scope jsonb;tokens jsonb;refs text[];context jsonb;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 IF c IS NULL OR actor IS NULL OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(input) k WHERE k NOT IN('commandId','sourceMessageId','ackMessageId','scopeReference','finding'))
 OR NOT(input ?& ARRAY['commandId','sourceMessageId','ackMessageId','scopeReference','finding']) OR jsonb_typeof(input->'finding') IS DISTINCT FROM 'object'
 OR EXISTS(SELECT FROM jsonb_object_keys(input->'finding') k WHERE k NOT IN('code','summary')) OR input#>>'{finding,code}' IS DISTINCT FROM 'late_internal_business_error'
 OR jsonb_typeof(input#>'{finding,summary}') IS DISTINCT FROM 'string' OR length(btrim(input#>>'{finding,summary}')) NOT BETWEEN 1 AND 2000
 OR jsonb_typeof(input->'scopeReference') IS DISTINCT FROM 'string' OR length(btrim(input->>'scopeReference')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'ediel_business_incident_input_invalid';END IF;
 PERFORM (input->>'commandId')::uuid;
 IF gridex_ediel_business_incidents.actor_v2(c,actor,'read') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_business_incident_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE company_id=c AND id=(input->>'sourceMessageId')::uuid AND direction='inbound' AND message_family IN('PRODAT','UTILTS') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_business_incident_own_source_required';END IF;
 owned:=gridex_ediel_business_incidents.inspect_ack_v1(c,source.environment,source.id,actor,'APERAK',(input->>'ackMessageId')::uuid);
 IF owned IS NULL OR owned#>>'{sourceMessage,id}' IS DISTINCT FROM source.id::text THEN RAISE EXCEPTION 'ediel_business_incident_own_ack_required';END IF;
 SELECT * INTO STRICT ack FROM public.ediel_messages WHERE company_id=c AND id=(owned#>>'{ackMessage,id}')::uuid AND related_message_id=source.id AND environment=source.environment FOR SHARE;
 context:=gridex_ediel_ack_replay.require_current_source_role_v2(c,source.environment,source.id);
 receipt:=gridex_ediel_transport.accepted_source_basis_v1(ack);
 IF receipt IS NULL OR receipt->>'status' IS DISTINCT FROM 'accepted_projection' OR receipt->>'messageId' IS DISTINCT FROM ack.id::text THEN RAISE EXCEPTION 'ediel_business_incident_actual_accepted_ack_required';END IF;
 IF source.message_family='PRODAT' THEN
  scopes:=gridex_ediel_ack_guide.prodat_outcomes_v1(ack.raw_payload,source.raw_payload);
  SELECT x INTO scope FROM jsonb_array_elements(scopes)x WHERE x->>'reference'=input->>'scopeReference' AND x->>'outcome'='positive';
  IF scope IS NULL OR (SELECT count(*) FROM jsonb_array_elements(scopes)x WHERE x->>'reference'=input->>'scopeReference' AND x->>'outcome'='positive')<>1 THEN RAISE EXCEPTION 'ediel_business_incident_actual_positive_scope_required';END IF;
 ELSE
  tokens:=gridex_utilts_binding.wire_tokens_v1(ack.raw_payload);
  IF (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='BGM' AND x#>>'{elements,1,0}'='312')<>1 OR ack.ack_outcome IS DISTINCT FROM 'positive' THEN RAISE EXCEPTION 'ediel_business_incident_actual_positive_scope_required';END IF;
  SELECT array_agg(x#>>'{elements,1,1}') INTO refs FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='ACW';
  IF NOT coalesce(input->>'scopeReference'=ANY(refs),false) OR (SELECT count(*) FROM unnest(refs) r WHERE r=input->>'scopeReference')<>1 THEN RAISE EXCEPTION 'ediel_business_incident_actual_positive_scope_required';END IF;
  scope:=jsonb_build_object('scope','transaction','reference',input->>'scopeReference','outcome','positive');
 END IF;
 RETURN jsonb_build_object('companyId',c,'environment',source.environment,'sourceMessageId',source.id,'ackMessageId',ack.id,'sourceHash',encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex'),'ackHash',encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex'),'scope',scope,'sourceContext',context,'transportReceipt',receipt);
END $$;
CREATE OR REPLACE FUNCTION public.ediel_report_fresh_business_incident_v1(p_company_id uuid,p_actor_user_id uuid,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE basis jsonb;i gridex_ediel_business_incidents.incidents%rowtype;kind text;
BEGIN
 IF gridex_ediel_business_incidents.actor_v2(p_company_id,p_actor_user_id,'report') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_business_incident_actor_forbidden' USING ERRCODE='42501';END IF;
 basis:=gridex_ediel_business_incidents.original_v1(p_company_id,p_actor_user_id,p_input);
 -- Serialize command discovery before INSERT: retries return original rows
 -- without INSERT ON CONFLICT, trigger attempts, new timestamps or audits.
 LOCK TABLE gridex_ediel_business_incidents.incidents IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO i FROM gridex_ediel_business_incidents.incidents WHERE company_id=p_company_id AND command_id=(p_input->>'commandId')::uuid;
 IF FOUND THEN
  IF i.actor_user_id IS DISTINCT FROM p_actor_user_id OR i.input IS DISTINCT FROM p_input OR i.source_hash IS DISTINCT FROM basis->>'sourceHash' OR i.ack_hash IS DISTINCT FROM basis->>'ackHash' OR i.scope IS DISTINCT FROM basis->'scope' THEN RAISE EXCEPTION 'ediel_business_incident_command_conflict';END IF;
  RETURN gridex_ediel_business_incidents.result_v1(i);
 END IF;
 INSERT INTO gridex_ediel_business_incidents.incidents(company_id,environment,command_id,actor_user_id,source_message_id,ack_message_id,source_hash,ack_hash,scope,source_context,transport_receipt,input)
 VALUES(p_company_id,basis->>'environment',(p_input->>'commandId')::uuid,p_actor_user_id,(basis->>'sourceMessageId')::uuid,(basis->>'ackMessageId')::uuid,basis->>'sourceHash',basis->>'ackHash',basis->'scope',basis->'sourceContext',basis->'transportReceipt',p_input) RETURNING * INTO i;
 FOREACH kind IN ARRAY ARRAY['contact','correction'] LOOP INSERT INTO gridex_ediel_business_incidents.plans(incident_id,company_id,kind,status,authority_required,basis)
 VALUES(i.id,p_company_id,kind,'held','source_supported_independent_review_and_new_operation_required',jsonb_build_object('original',basis,'reportedFinding',p_input->'finding','mayChangeOriginalAck',false,'mayCreateOppositeAck',false,'maySendTraffic',false));END LOOP;
 INSERT INTO gridex_ediel_business_incidents.events(incident_id,company_id,actor_user_id,kind) VALUES(i.id,p_company_id,p_actor_user_id,'fresh_business_issue_reported');
 RETURN gridex_ediel_business_incidents.result_v1(i);
END $$;
CREATE OR REPLACE FUNCTION public.ediel_read_fresh_business_incident_v1(p_company_id uuid,p_actor_user_id uuid,p_incident_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i gridex_ediel_business_incidents.incidents%rowtype;b jsonb;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 IF gridex_ediel_business_incidents.actor_v2(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_business_incident_reader_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO i FROM gridex_ediel_business_incidents.incidents WHERE company_id=p_company_id AND id=p_incident_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_business_incident_unavailable' USING ERRCODE='42501';END IF;
 b:=gridex_ediel_business_incidents.original_read_v2(p_company_id,p_actor_user_id,i.input);
 IF i.source_hash IS DISTINCT FROM b->>'sourceHash' OR i.ack_hash IS DISTINCT FROM b->>'ackHash' OR i.scope IS DISTINCT FROM b->'scope' OR i.source_context IS DISTINCT FROM b->'sourceContext' OR i.transport_receipt IS DISTINCT FROM b->'transportReceipt' THEN RAISE EXCEPTION 'ediel_business_incident_original_changed';END IF;
 RETURN gridex_ediel_business_incidents.result_v1(i);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_business_incidents FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_fresh_business_incident_access_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_fresh_business_incident_access_v1(uuid,uuid) TO service_role;
COMMIT;
