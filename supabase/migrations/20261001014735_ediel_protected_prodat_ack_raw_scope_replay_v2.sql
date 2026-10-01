-- CLI-created forward. Actual immutable physical PRODAT scopes join the
-- protected current actor/source/ACK owner. Replay never invokes scope writers.
BEGIN;
CREATE FUNCTION gridex_ediel_ack_replay.require_readonly_prodat_ledger_v2(m public.ediel_messages) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;scopes jsonb;a jsonb;scope jsonb;n bigint;BEGIN
 a:=gridex_ack_authority.wire_v1(m.raw_payload);
 IF m.message_family IS DISTINCT FROM 'APERAK' OR a#>>'{type,2}' IS DISTINCT FROM '96A' OR a#>>'{type,4}' IS DISTINCT FROM 'E2SE6A' THEN RETURN;END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=m.related_message_id AND direction='inbound' AND environment=m.environment AND (company_id=m.company_id OR company_id IS NULL) FOR SHARE;
 IF source.id IS NULL OR nullif(source.raw_payload,'') IS NULL THEN RAISE EXCEPTION 'ediel_ack_replay_actual_source_unavailable';END IF;
 scopes:=gridex_ediel_ack_guide.prodat_outcomes_v1(m.raw_payload,source.raw_payload);
 SELECT count(*) INTO n FROM gridex_ediel_ack_guide.outbound_prodat_scopes WHERE ack_message_id=m.id;
 -- Older already consumed native originals are qualified from their protected
 -- source/witness/raw guide, without retroactive ledger INSERT or repair.
 IF n=0 THEN RETURN;END IF;
 IF n<>jsonb_array_length(scopes) THEN RAISE EXCEPTION 'ediel_prodat_ack_scope_original_changed';END IF;
 FOR scope IN SELECT x FROM jsonb_array_elements(scopes)x LOOP
  IF NOT EXISTS(SELECT FROM gridex_ediel_ack_guide.outbound_prodat_scopes r WHERE r.ack_message_id=m.id AND r.company_id=m.company_id AND r.environment=m.environment AND r.source_message_id=source.id
   AND r.source_payload_sha256=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') AND r.ack_payload_sha256=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
   AND r.scope_kind=scope->>'scope' AND r.scope_reference=scope->>'reference' AND r.physical_source_reference=scope->'physicalReference' AND r.outcome=scope->>'outcome') THEN RAISE EXCEPTION 'ediel_prodat_ack_scope_original_changed';END IF;
 END LOOP;
END $$;
CREATE FUNCTION gridex_ediel_ack_replay.require_readonly_guide_v2(m public.ediel_messages) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ediel_ack_guide.require_before_prodat_scope_v1(m);PERFORM gridex_ediel_ack_replay.require_readonly_prodat_ledger_v2(m);END $$;
CREATE OR REPLACE FUNCTION gridex_ediel_ack_replay.read_v1(c uuid,env text,source_id uuid,actor uuid,family text,sequence_field text,sequence_value text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE source public.ediel_messages%rowtype;ack public.ediel_messages%rowtype;ids uuid[];context jsonb;ack_context jsonb;basis jsonb;own_basis jsonb;
 a jsonb;s jsonb;tokens jsonb;common_source boolean;observed timestamptz:=clock_timestamp();companies uuid[];wire_outcome text;
BEGIN
 IF c IS NULL OR actor IS NULL OR source_id IS NULL OR env IS NULL OR env NOT IN('test','production') OR family IS NULL OR family NOT IN('CONTRL','APERAK','UTILTS_ERR')
  OR (sequence_field IS NULL)<>(sequence_value IS NULL) OR sequence_field IS NOT NULL AND (sequence_field NOT IN('relatedTransactionReference','utiltsErrSequenceToken') OR nullif(btrim(sequence_value),'') IS NULL)
  OR family='CONTRL' AND sequence_field IS NOT NULL OR sequence_field='utiltsErrSequenceToken' AND family<>'UTILTS_ERR' THEN
  RAISE EXCEPTION 'ediel_ack_replay_scope_required' USING ERRCODE='22023';END IF;
 -- A permission decision must remain true through source/ACK qualification.
 -- SHARE prevents UPDATE/DELETE and phantom INSERT grants/namespace collisions;
 -- all permission sources used by the current native resolver are included.
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
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
 IF public.gridex_actor_has_company_permission(actor,c,'communication.write') IS NOT TRUE
  AND NOT(env='test' AND (family='CONTRL' OR common_source) AND public.gridex_actor_has_company_permission(actor,c,'ediel_testing.write') IS TRUE) THEN
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
 SELECT array_agg(m.id ORDER BY m.id) INTO ids FROM public.ediel_messages m WHERE m.company_id=c AND m.environment=env AND m.direction='outbound'
  AND m.related_message_id=source.id AND m.message_family=family AND m.status NOT IN('cancelled','failed')
  AND CASE WHEN sequence_field IS NOT NULL THEN m.parsed_payload->>sequence_field=sequence_value
   ELSE nullif(m.parsed_payload->>'relatedTransactionReference','') IS NULL AND nullif(m.parsed_payload->>'utiltsErrSequenceToken','') IS NULL END;
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
CREATE FUNCTION gridex_ediel_ack_replay.read_exact_v2(c uuid,env text,source_id uuid,actor uuid,family text,ack_id uuid) RETURNS jsonb
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
 IF public.gridex_actor_has_company_permission(actor,c,'communication.write') IS NOT TRUE
  AND NOT(env='test' AND (family='CONTRL' OR common_source) AND public.gridex_actor_has_company_permission(actor,c,'ediel_testing.write') IS TRUE) THEN
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

CREATE FUNCTION gridex_ediel_ack_replay.read_scope_v2(c uuid,env text,source_id uuid,source_hash text,actor uuid,family text,wanted_raw text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE gate jsonb;source public.ediel_messages%rowtype;wanted jsonb;own_scopes jsonb;want jsonb;own_scope jsonb;qualified jsonb;chosen jsonb;candidate public.ediel_messages%rowtype;overlap boolean;covers boolean;any_overlap boolean:=false;BEGIN
 -- Same protected current-source gate precedes every candidate selection. All
 -- current graph fences and message SHARE are acquired by the exact reader.
 gate:=gridex_ediel_ack_replay.read_exact_v2(c,env,source_id,actor,family,NULL);
 source:=jsonb_populate_record(NULL::public.ediel_messages,gate->'sourceMessage');
 IF source_hash IS NULL OR source_hash IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'canonical_ack_actual_original_mismatch';END IF;
 IF family IS DISTINCT FROM 'APERAK' OR source.message_family IS DISTINCT FROM 'PRODAT' OR nullif(wanted_raw,'') IS NULL OR octet_length(wanted_raw)>8388608 THEN RAISE EXCEPTION 'ediel_ack_replay_physical_prodat_scope_required';END IF;
 wanted:=gridex_ediel_ack_guide.prodat_outcomes_v1(wanted_raw,source.raw_payload);
 FOR candidate IN SELECT p.* FROM public.ediel_messages p WHERE
  (p.company_id=c AND p.environment=env AND p.direction='outbound' AND p.message_family=family AND p.related_message_id=source.id)
  OR EXISTS(SELECT FROM gridex_ediel_outbound_owner.consumptions co JOIN gridex_ediel_outbound_owner.witnesses w ON w.id=co.witness_id WHERE co.source_message_id=p.id AND w.related_message_id=source.id AND w.family=read_scope_v2.family)
  OR EXISTS(SELECT FROM gridex_ediel_common_header.negative_consumptions co JOIN gridex_ediel_common_header.negative_witnesses w ON w.id=co.witness_id WHERE co.ack_message_id=p.id AND w.source_message_id=source.id) ORDER BY p.id FOR SHARE LOOP
  -- A forged, foreign, held or missing immutable own original never becomes
  -- authority just because its public parsed/status/outcome cache matches.
  qualified:=gridex_ediel_ack_replay.read_exact_v2(c,env,source.id,actor,family,candidate.id);
  IF qualified IS NULL THEN RAISE EXCEPTION 'ediel_historical_prodat_ack_scope_basis_unavailable';END IF;
  own_scopes:=gridex_ediel_ack_guide.prodat_outcomes_v1(candidate.raw_payload,source.raw_payload);overlap:=false;covers:=true;
  FOR want IN SELECT x FROM jsonb_array_elements(wanted)x LOOP
   IF NOT EXISTS(SELECT FROM jsonb_array_elements(own_scopes)x WHERE
    (x->>'scope'='message' OR x->>'scope'=want->>'scope' AND x->>'reference'=want->>'reference') AND x->>'outcome'=want->>'outcome') THEN covers:=false;END IF;
   FOR own_scope IN SELECT x FROM jsonb_array_elements(own_scopes)x LOOP
    IF gridex_ediel_ack_guide.prodat_scope_overlap_v1(want,own_scope) THEN
     overlap:=true;IF own_scope->>'outcome' IS DISTINCT FROM want->>'outcome' THEN RAISE EXCEPTION 'ediel_prodat_ack_scope_conflicting_outcome';END IF;
    END IF;
   END LOOP;
  END LOOP;
  any_overlap:=any_overlap OR overlap;
  IF covers THEN
   IF chosen IS NOT NULL THEN RAISE EXCEPTION 'ediel_ack_replay_own_response_ambiguous';END IF;
   chosen:=qualified||jsonb_build_object('version',2,'requestedPayloadHash',encode(sha256(convert_to(wanted_raw,'UTF8')),'hex'),'requestedScopes',wanted,'ackScopes',own_scopes);
  END IF;
 END LOOP;
 IF chosen IS NOT NULL THEN RETURN chosen;END IF;
 -- Never replay one fixed subgroup as if it answered the entire request, nor
 -- mint a fresh overlapping decision. Caller can request its actual new scopes.
 IF any_overlap THEN RAISE EXCEPTION 'ediel_prodat_ack_scope_partially_fixed';END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION public.ediel_read_outbound_ack_scope_replay_v2(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_actor_user_id uuid,p_ack_family text,p_ack_raw_payload text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN
 RETURN gridex_ediel_ack_replay.read_scope_v2(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_actor_user_id,p_ack_family,p_ack_raw_payload);END $$;
CREATE FUNCTION gridex_ediel_ack_replay.create_scope_v2(c uuid,env text,source_id uuid,source_hash text,actor uuid,family text,sequence_field text,sequence_value text,outcome text,draft jsonb,smtp jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE existing jsonb;s public.ediel_messages%rowtype;m public.ediel_messages%rowtype;w gridex_ediel_outbound_owner.witnesses%rowtype;
 ctx jsonb;basis jsonb;prepared jsonb;route jsonb;tokens jsonb;scopes jsonb;unb jsonb;unh jsonb;bgm jsonb;parsed jsonb;raw text;physical_family text;wire_outcome text;common boolean;
 op text;event_id uuid;business_type text;business_id uuid;resource record;resource_json jsonb;reference record;result jsonb;
BEGIN
 -- Identical lock order to replay. Stabilize every current native permission,
 -- local role/profile, representation and positive data-approval source first.
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 -- Acquire write-compatible candidate-universe lock before replay's SHARE.
 -- Concurrent fresh creations cannot both upgrade SHARE to INSERT, even when
 -- their original/sequence keys differ. They re-read after the first commits.
 LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
 existing:=gridex_ediel_ack_replay.read_scope_v2(c,env,source_id,source_hash,actor,family,draft->>'rawPayload');
 SELECT * INTO STRICT s FROM public.ediel_messages WHERE id=source_id AND environment=env AND direction='inbound' AND (company_id=c OR company_id IS NULL) FOR SHARE;
 IF source_hash IS NULL OR source_hash IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'canonical_ack_actual_original_mismatch';END IF;
 IF outcome IS NOT NULL AND outcome NOT IN('positive','negative') THEN RAISE EXCEPTION 'ediel_ack_atomic_outcome_required';END IF;
 IF existing IS NOT NULL THEN
  IF outcome IS NOT NULL AND outcome IS DISTINCT FROM (CASE WHEN NOT EXISTS(SELECT FROM jsonb_array_elements(existing->'requestedScopes')x WHERE x->>'outcome'<>'positive') THEN 'positive' ELSE 'negative' END) THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_outcome_mismatch';END IF;
  RETURN existing||jsonb_build_object('replayed',true);END IF;
 PERFORM public.ediel_require_source_bytes_available_v1(c,s.id);
 -- Fresh-only caller whitelist. An established own response above never uses
 -- a new draft, mints a witness, writes a receipt/event or selects a route.
 IF jsonb_typeof(draft) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(draft) k WHERE k<>ALL(ARRAY[
  'rawPayload','messageVersion','processType','transportType','mailbox','senderEdielId','senderName','senderSubAddress','receiverEdielId','receiverName','receiverSubAddress',
  'senderEmail','receiverEmail','subject','fileName','mimeType','interchangeReference','externalReference','correlationReference','transactionReference','applicationReference',
  'originalMessageId','originalTransactionId','originalMessageCode','communicationRouteId','routeProfileId','parsedPayload','validationReport',
  'requiresContrl','requiresAperak','syntaxCheckStatus','functionalCheckStatus','messageCreatedAt','validatedAt','ackDueAt'])) THEN RAISE EXCEPTION 'ediel_ack_atomic_draft_whitelist_required';END IF;
 raw:=draft->>'rawPayload';IF nullif(raw,'') IS NULL OR octet_length(raw)>8388608 THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_required';END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(raw);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')<>1 THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_required';END IF;
 SELECT t INTO unb FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB';SELECT t INTO unh FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH';SELECT t INTO bgm FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 physical_family:=CASE WHEN unh#>>'{elements,2,0}'='UTILTS' AND bgm#>>'{elements,1,0}'='ERR' THEN 'UTILTS_ERR' ELSE unh#>>'{elements,2,0}' END;
 IF physical_family IS DISTINCT FROM family THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_family_mismatch';END IF;
 common:=family='APERAK' AND s.message_family='PRODAT' AND EXISTS(SELECT FROM gridex_ediel_common_header.sources p WHERE p.source_message_id=s.id AND p.company_id=c AND p.environment=env AND p.status='ready');
 IF family='CONTRL' THEN
  basis:=gridex_ediel_technical_ack.require_source_v1(c,s.id);
  IF jsonb_typeof(smtp) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_ack_atomic_smtp_required';END IF;
  route:=gridex_ediel_technical_ack.select_configured_reply_route_v2(c,basis,'CONTRL',smtp->>'from',smtp->>'host',(smtp->>'port')::integer);
 ELSIF common THEN
  IF sequence_field IS NOT NULL OR outcome IS DISTINCT FROM 'negative' THEN RAISE EXCEPTION 'canonical_common_header_negative_only';END IF;
  IF jsonb_typeof(smtp) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_ack_atomic_smtp_required';END IF;
  prepared:=gridex_ediel_common_header.prepare_with_route_v2(c,env,s.id,actor,raw,smtp->>'from',smtp->>'host',(smtp->>'port')::integer);
  basis:=prepared->'evidence';SELECT b.route INTO route FROM gridex_ediel_common_header.negative_route_bindings b WHERE b.witness_id=(prepared->>'witnessId')::uuid;
 ELSE
  ctx:=gridex_ediel_ack_replay.require_current_source_role_v2(c,env,s.id);basis:=gridex_ediel_source_rules.require_v1(c,s.id);
  -- Derive positive service scope only from genuine current private native
  -- accepted storage. A prescribed negative ACK requires no data grant.
  IF ctx->>'actorRole' IN('energy_service_company','esco') AND family='APERAK' AND EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC' AND t#>>'{elements,1,0}'='100') THEN
   PERFORM gridex_ediel_ack_replay.capture_positive_service_scope_v1(c,env,s.id,raw,actor);END IF;
  IF s.message_family='PRODAT' AND family='APERAK' AND EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC' AND t#>>'{elements,1,0}'='100') THEN
   PERFORM public.ediel_require_prodat_bilateral_positive_source_v1(c,s.id);END IF;
  prepared:=gridex_ediel_outbound_owner.prepare_v1(jsonb_build_object('companyId',c,'environment',env,'actorUserId',actor,'rawPayload',raw,'relatedMessageId',s.id,'rulePackEvidence',basis));
  SELECT * INTO STRICT w FROM gridex_ediel_outbound_owner.witnesses WHERE id=(prepared->>'witnessId')::uuid;
  IF w.family IS DISTINCT FROM family OR w.related_message_id IS DISTINCT FROM s.id OR w.company_id IS DISTINCT FROM c OR w.environment IS DISTINCT FROM env THEN RAISE EXCEPTION 'ediel_ack_atomic_owner_scope_mismatch';END IF;
 END IF;
 -- Native parse controls all physical reference/endpoint metadata; no parsed
 -- caller reference or foreign resource ID becomes a business identity.
 parsed:=coalesce(draft->'parsedPayload','{}'::jsonb)-ARRAY['relatedTransactionReference','utiltsErrSequenceToken','ackScope','sourceMessageId','ackSourceId','serviceAssignment','sourceAuthority','rulePackEvidence'];
 IF jsonb_typeof(parsed) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_ack_atomic_metadata_required';END IF;
 IF sequence_field IS NOT NULL THEN parsed:=parsed||jsonb_build_object(sequence_field,sequence_value);END IF;
 IF sequence_field='relatedTransactionReference' THEN parsed:=parsed||jsonb_build_object('ackScope','transaction');END IF;
 parsed:=parsed||jsonb_build_object('ackSourceId',s.id,'ackFamily',family);
 scopes:=gridex_ediel_ack_guide.prodat_outcomes_v1(raw,s.raw_payload);
 parsed:=parsed||jsonb_build_object('ackScope',CASE WHEN EXISTS(SELECT FROM jsonb_array_elements(scopes)x WHERE x->>'scope'='message') THEN 'message' ELSE 'object' END);
 -- Derived index only. Its physical source scopes are recomputed natively on
 -- every use; no caller sequence/hash becomes an authority capability.
 op:='ediel_ack:'||s.id::text||':'||family||':rawscope:'||encode(sha256(convert_to(scopes::text,'UTF8')),'hex');
 m.id:=gen_random_uuid();m.company_id:=c;m.environment:=env;m.direction:='outbound';m.message_standard:='edifact';m.message_family:=family;
 m.message_code:=CASE WHEN w.id IS NOT NULL THEN w.code ELSE family END;m.raw_payload:=raw;m.related_message_id:=s.id;m.status:='draft';m.source_operation_id:=op;
 m.test_flag:=CASE env WHEN 'production' THEN 0 ELSE 1 END;m.message_version:=draft->>'messageVersion';m.process_type:=draft->>'processType';m.transport_type:='smtp';
 m.sender_ediel_id:=unb#>>'{elements,2,0}';m.receiver_ediel_id:=unb#>>'{elements,3,0}';m.sender_sub_address:=nullif(unb#>>'{elements,2,2}','');m.receiver_sub_address:=nullif(unb#>>'{elements,3,2}','');
 m.interchange_reference:=unb#>>'{elements,5,0}';m.application_reference:=unb#>>'{elements,7,0}';m.original_message_id:=unh#>>'{elements,1,0}';m.external_reference:=bgm#>>'{elements,2,0}';
 m.original_transaction_id:=sequence_value;m.original_message_code:=CASE WHEN common THEN NULL ELSE s.message_code END;
 SELECT t#>>'{elements,1,1}' INTO m.correlation_reference FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW' ORDER BY (t->>'index')::int LIMIT 1;
 SELECT t#>>'{elements,1,1}' INTO m.transaction_reference FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='TN' ORDER BY (t->>'index')::int LIMIT 1;
 m.sender_name:=draft->>'senderName';m.receiver_name:=draft->>'receiverName';m.subject:=draft->>'subject';m.file_name:=draft->>'fileName';m.mime_type:=draft->>'mimeType';
 m.communication_route_id:=nullif(draft->>'communicationRouteId','')::uuid;m.route_profile_id:=nullif(draft->>'routeProfileId','')::uuid;
 m.sender_email:=draft->>'senderEmail';m.receiver_email:=draft->>'receiverEmail';m.mailbox:=draft->>'mailbox';
 IF route IS NOT NULL THEN
  IF m.communication_route_id::text IS DISTINCT FROM route#>>'{route,id}' OR m.route_profile_id::text IS DISTINCT FROM route#>>'{routeRuntime,route_profile_id}'
   OR m.sender_email IS DISTINCT FROM route->>'senderEmail' OR m.receiver_email IS DISTINCT FROM route->>'receiverEmail' OR m.mailbox IS DISTINCT FROM route->>'mailbox' THEN RAISE EXCEPTION 'ediel_ack_atomic_route_changed';END IF;
 ELSE
  -- Fresh ordinary response selects the exact named route/profile under lock;
  -- replay above never consults these mutable rows.
  LOCK TABLE public.communication_routes,public.ediel_route_profiles,public.ediel_transport_profiles IN SHARE MODE;
  IF NOT EXISTS(SELECT FROM public.communication_routes r JOIN public.ediel_route_profiles p ON p.communication_route_id=r.id AND p.company_id=c
   WHERE r.id=m.communication_route_id AND p.id=m.route_profile_id AND r.company_id=c AND r.is_active AND p.is_enabled AND p.environment=env
    AND p.sender_ediel_id=m.sender_ediel_id AND p.receiver_ediel_id=m.receiver_ediel_id
    AND coalesce(p.sender_subaddress,p.sender_sub_address,'')=coalesce(m.sender_sub_address,'') AND coalesce(p.receiver_subaddress,p.receiver_sub_address,'')=coalesce(m.receiver_sub_address,'')
    AND p.application_reference IS NOT DISTINCT FROM m.application_reference AND r.target_email IS NOT DISTINCT FROM m.receiver_email AND p.mailbox IS NOT DISTINCT FROM m.mailbox) THEN RAISE EXCEPTION 'ediel_ack_atomic_route_changed';END IF;
 END IF;
 IF common THEN m.execution_context_snapshot:=jsonb_build_object('prodatCommonHeaderNegativeWitnessId',prepared->>'witnessId');
 ELSIF w.id IS NOT NULL THEN
  m.execution_context_snapshot:=jsonb_build_object('outboundOwnerWitnessId',w.id);m.canonical_rule_pack_id:=(w.evidence->>'rulePackId')::uuid;m.rule_profile_version_id:=(w.evidence->>'messageProfileId')::uuid;
  m.rule_profile_key:=w.evidence->>'profileKey';m.rule_profile_version:=w.evidence->>'version';m.rule_pack_checksum:=w.evidence->>'sourceHash';m.rule_pack_snapshot:=w.evidence->'snapshot';
  -- Resource links must be owned by the actual original tenant. They never
  -- arrive through the caller draft. Lock the real rows before inheriting.
  FOR resource IN SELECT * FROM (VALUES('customers',s.customer_id),('customer_sites',s.site_id),('metering_points',s.metering_point_id),('grid_owners',s.grid_owner_id),('supplier_switch_requests',s.switch_request_id),('grid_owner_data_requests',s.grid_owner_data_request_id),('outbound_requests',s.outbound_request_id),('partner_exports',s.partner_export_id)) v(table_name,id) WHERE id IS NOT NULL LOOP
   EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE r.id=$1 AND r.company_id=$2 FOR SHARE',resource.table_name) INTO resource_json USING resource.id,c;
   IF resource_json IS NULL THEN RAISE EXCEPTION 'ediel_ack_atomic_foreign_source_resource';END IF;
  END LOOP;
  m.customer_id:=s.customer_id;m.site_id:=s.site_id;m.metering_point_id:=s.metering_point_id;m.grid_owner_id:=s.grid_owner_id;
  m.switch_request_id:=s.switch_request_id;m.grid_owner_data_request_id:=s.grid_owner_data_request_id;m.outbound_request_id:=s.outbound_request_id;m.partner_export_id:=s.partner_export_id;
 END IF;
 m.parsed_payload:=parsed;m.validation_report:=coalesce(draft->'validationReport','{}'::jsonb);m.requires_contrl:=false;m.requires_aperak:=false;
 m.contrl_status:='not_required';m.aperak_status:='not_required';m.utilts_err_status:='not_required';m.syntax_check_status:=draft->>'syntaxCheckStatus';m.functional_check_status:=draft->>'functionalCheckStatus';
 m.message_created_at:=coalesce((draft->>'messageCreatedAt')::timestamptz,clock_timestamp());m.validated_at:=(draft->>'validatedAt')::timestamptz;m.ack_due_at:=(draft->>'ackDueAt')::timestamptz;
 m.created_by:=actor;m.updated_by:=actor;
 -- Set physical outcome before immutable namespace/public row insertion.
 IF family='CONTRL' THEN wire_outcome:=CASE basis->>'syntaxDecision' WHEN 'accepted' THEN 'positive' WHEN 'rejected' THEN 'negative' END;
 ELSIF common OR family='UTILTS_ERR' THEN wire_outcome:='negative';
 ELSE wire_outcome:=CASE WHEN EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC') AND NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC' AND t#>>'{elements,1,0}'<>'100') THEN 'positive' ELSE 'negative' END;END IF;
 IF wire_outcome IS NULL OR outcome IS NOT NULL AND outcome IS DISTINCT FROM wire_outcome THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_outcome_mismatch';END IF;
 m.ack_outcome:=wire_outcome;m.ack_status:=wire_outcome;m.parsed_payload:=m.parsed_payload||jsonb_build_object('ackOutcome',wire_outcome);
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,message_version,process_type,test_flag,status,transport_type,
  raw_payload,related_message_id,source_operation_id,sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address,sender_name,receiver_name,sender_email,receiver_email,mailbox,subject,file_name,mime_type,
  communication_route_id,route_profile_id,interchange_reference,application_reference,original_message_id,original_transaction_id,original_message_code,external_reference,correlation_reference,transaction_reference,
  execution_context_snapshot,canonical_rule_pack_id,rule_profile_version_id,rule_profile_key,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,
  customer_id,site_id,metering_point_id,grid_owner_id,switch_request_id,grid_owner_data_request_id,outbound_request_id,partner_export_id,
  parsed_payload,validation_report,requires_contrl,requires_aperak,contrl_status,aperak_status,utilts_err_status,ack_outcome,ack_status,syntax_check_status,functional_check_status,message_created_at,validated_at,ack_due_at,created_by,updated_by)
 VALUES(m.id,m.company_id,m.environment,m.direction,m.message_standard,m.message_family,m.message_code,m.message_version,m.process_type,m.test_flag,m.status,m.transport_type,
  m.raw_payload,m.related_message_id,m.source_operation_id,m.sender_ediel_id,m.receiver_ediel_id,m.sender_sub_address,m.receiver_sub_address,m.sender_name,m.receiver_name,m.sender_email,m.receiver_email,m.mailbox,m.subject,m.file_name,m.mime_type,
  m.communication_route_id,m.route_profile_id,m.interchange_reference,m.application_reference,m.original_message_id,m.original_transaction_id,m.original_message_code,m.external_reference,m.correlation_reference,m.transaction_reference,
  m.execution_context_snapshot,m.canonical_rule_pack_id,m.rule_profile_version_id,m.rule_profile_key,m.rule_profile_version,m.rule_pack_checksum,m.rule_pack_snapshot,
  m.customer_id,m.site_id,m.metering_point_id,m.grid_owner_id,m.switch_request_id,m.grid_owner_data_request_id,m.outbound_request_id,m.partner_export_id,
  m.parsed_payload,m.validation_report,m.requires_contrl,m.requires_aperak,m.contrl_status,m.aperak_status,m.utilts_err_status,m.ack_outcome,m.ack_status,m.syntax_check_status,m.functional_check_status,m.message_created_at,m.validated_at,m.ack_due_at,m.created_by,m.updated_by) RETURNING * INTO m;
 -- Real native guide/source/namespace/witness consumption triggers ran. Re-read
 -- their immutable original/ACK receipts before publishing effects/results.
 result:=gridex_ediel_ack_replay.read_exact_v2(c,env,s.id,actor,family,m.id);
 result:=result||jsonb_build_object('version',2,'requestedPayloadHash',encode(sha256(convert_to(raw,'UTF8')),'hex'),'requestedScopes',scopes,'ackScopes',scopes);
 IF result#>>'{ackMessage,id}' IS DISTINCT FROM m.id::text THEN RAISE EXCEPTION 'ediel_ack_atomic_postwrite_owner_mismatch';END IF;
 business_type:=CASE WHEN m.switch_request_id IS NOT NULL THEN 'supplier_switch_request' WHEN m.grid_owner_data_request_id IS NOT NULL THEN 'grid_owner_data_request' WHEN m.outbound_request_id IS NOT NULL THEN 'outbound_request' WHEN m.partner_export_id IS NOT NULL THEN 'partner_export' END;
 business_id:=coalesce(m.switch_request_id,m.grid_owner_data_request_id,m.outbound_request_id,m.partner_export_id);
 IF business_id IS NOT NULL THEN
  FOR reference IN SELECT DISTINCT reference_type,reference_value FROM (
   SELECT 'UNB_REF'::text reference_type,m.interchange_reference reference_value UNION ALL SELECT 'BGM_REF',m.external_reference
   UNION ALL SELECT 'RFF_'||(t#>>'{elements,1,0}'),t#>>'{elements,1,1}' FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}' IN('LI','ACW','Z07','TN')
   UNION ALL SELECT 'IDE',t#>>'{elements,2,0}' FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='IDE') r WHERE nullif(reference_value,'') IS NOT NULL LOOP
   INSERT INTO public.ediel_business_references(company_id,source_message_id,reference_type,reference_value,message_family,message_code,business_object_type,business_object_id,customer_id,customer_site_id,metering_point_id)
    VALUES(c,m.id,reference.reference_type,reference.reference_value,family,m.message_code,business_type,business_id,m.customer_id,m.site_id,m.metering_point_id)
    ON CONFLICT(company_id,reference_type,reference_value,business_object_type,business_object_id) DO NOTHING;
  END LOOP;
 END IF;
 INSERT INTO public.ediel_message_events(company_id,ediel_message_id,message_id,event_type,event_status,message,payload,event_payload,created_by)
  VALUES(c,m.id,m.id,'created','info','Ediel message '||family||' '||coalesce(m.message_code,'')||' skapad.',jsonb_build_object('status',m.status,'direction',m.direction,'externalReference',m.external_reference,'communicationRouteId',m.communication_route_id),jsonb_build_object('sourceMessageId',s.id,'sourceOperationId',op,'atomicOwner',true),actor) RETURNING id INTO event_id;
 INSERT INTO gridex_ediel_ack_replay.creation_receipts VALUES(m.id,s.id,c,env,actor,source_hash,encode(sha256(convert_to(raw,'UTF8')),'hex'),op,event_id,family,sequence_field,sequence_value,wire_outcome,clock_timestamp());
 RETURN result||jsonb_build_object('replayed',false);
END $$;

-- Direct legacy public callers retain the exact v1 body and OID/ACL, with
-- fresh byte/capability guards; no replay reconstruction or new witness.
CREATE OR REPLACE FUNCTION gridex_ediel_ack_replay.create_v1(c uuid,env text,source_id uuid,source_hash text,actor uuid,family text,sequence_field text,sequence_value text,outcome text,draft jsonb,smtp jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE existing jsonb;s public.ediel_messages%rowtype;m public.ediel_messages%rowtype;w gridex_ediel_outbound_owner.witnesses%rowtype;
 ctx jsonb;basis jsonb;prepared jsonb;route jsonb;tokens jsonb;unb jsonb;unh jsonb;bgm jsonb;parsed jsonb;raw text;physical_family text;wire_outcome text;common boolean;
 op text;event_id uuid;business_type text;business_id uuid;resource record;resource_json jsonb;reference record;result jsonb;
BEGIN
 -- Identical lock order to replay. Stabilize every current native permission,
 -- local role/profile, representation and positive data-approval source first.
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 -- Acquire write-compatible candidate-universe lock before replay's SHARE.
 -- Concurrent fresh creations cannot both upgrade SHARE to INSERT, even when
 -- their original/sequence keys differ. They re-read after the first commits.
 LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
 existing:=gridex_ediel_ack_replay.read_v1(c,env,source_id,actor,family,sequence_field,sequence_value);
 SELECT * INTO STRICT s FROM public.ediel_messages WHERE id=source_id AND environment=env AND direction='inbound' AND (company_id=c OR company_id IS NULL) FOR SHARE;
 IF source_hash IS NULL OR source_hash IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'canonical_ack_actual_original_mismatch';END IF;
 IF outcome IS NOT NULL AND outcome NOT IN('positive','negative') THEN RAISE EXCEPTION 'ediel_ack_atomic_outcome_required';END IF;
 IF existing IS NOT NULL THEN
  IF outcome IS NOT NULL AND existing#>>'{ackMessage,ack_outcome}' IS DISTINCT FROM outcome THEN RAISE EXCEPTION 'conflicting_ack_draft_exists';END IF;
  RETURN existing||jsonb_build_object('replayed',true);END IF;
 PERFORM public.ediel_require_source_bytes_available_v1(c,s.id);
 -- Fresh-only caller whitelist. An established own response above never uses
 -- a new draft, mints a witness, writes a receipt/event or selects a route.
 IF jsonb_typeof(draft) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(draft) k WHERE k<>ALL(ARRAY[
  'rawPayload','messageVersion','processType','transportType','mailbox','senderEdielId','senderName','senderSubAddress','receiverEdielId','receiverName','receiverSubAddress',
  'senderEmail','receiverEmail','subject','fileName','mimeType','interchangeReference','externalReference','correlationReference','transactionReference','applicationReference',
  'originalMessageId','originalTransactionId','originalMessageCode','communicationRouteId','routeProfileId','parsedPayload','validationReport',
  'requiresContrl','requiresAperak','syntaxCheckStatus','functionalCheckStatus','messageCreatedAt','validatedAt','ackDueAt'])) THEN RAISE EXCEPTION 'ediel_ack_atomic_draft_whitelist_required';END IF;
 raw:=draft->>'rawPayload';IF nullif(raw,'') IS NULL OR octet_length(raw)>8388608 THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_required';END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(raw);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')<>1 THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_required';END IF;
 SELECT t INTO unb FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB';SELECT t INTO unh FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH';SELECT t INTO bgm FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 physical_family:=CASE WHEN unh#>>'{elements,2,0}'='UTILTS' AND bgm#>>'{elements,1,0}'='ERR' THEN 'UTILTS_ERR' ELSE unh#>>'{elements,2,0}' END;
 IF physical_family IS DISTINCT FROM family THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_family_mismatch';END IF;
 common:=family='APERAK' AND s.message_family='PRODAT' AND EXISTS(SELECT FROM gridex_ediel_common_header.sources p WHERE p.source_message_id=s.id AND p.company_id=c AND p.environment=env AND p.status='ready');
 IF family='CONTRL' THEN
  basis:=gridex_ediel_technical_ack.require_source_v1(c,s.id);
  IF jsonb_typeof(smtp) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_ack_atomic_smtp_required';END IF;
  route:=gridex_ediel_technical_ack.select_configured_reply_route_v2(c,basis,'CONTRL',smtp->>'from',smtp->>'host',(smtp->>'port')::integer);
 ELSIF common THEN
  IF sequence_field IS NOT NULL OR outcome IS DISTINCT FROM 'negative' THEN RAISE EXCEPTION 'canonical_common_header_negative_only';END IF;
  IF jsonb_typeof(smtp) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_ack_atomic_smtp_required';END IF;
  prepared:=gridex_ediel_common_header.prepare_with_route_v2(c,env,s.id,actor,raw,smtp->>'from',smtp->>'host',(smtp->>'port')::integer);
  basis:=prepared->'evidence';SELECT b.route INTO route FROM gridex_ediel_common_header.negative_route_bindings b WHERE b.witness_id=(prepared->>'witnessId')::uuid;
 ELSE
  ctx:=gridex_ediel_ack_replay.require_current_source_role_v2(c,env,s.id);basis:=gridex_ediel_source_rules.require_v1(c,s.id);
  -- Derive positive service scope only from genuine current private native
  -- accepted storage. A prescribed negative ACK requires no data grant.
  IF ctx->>'actorRole' IN('energy_service_company','esco') AND family='APERAK' AND EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC' AND t#>>'{elements,1,0}'='100') THEN
   PERFORM gridex_ediel_ack_replay.capture_positive_service_scope_v1(c,env,s.id,raw,actor);END IF;
  IF s.message_family='PRODAT' AND family='APERAK' AND EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC' AND t#>>'{elements,1,0}'='100') THEN
   PERFORM public.ediel_require_prodat_bilateral_positive_source_v1(c,s.id);END IF;
  prepared:=gridex_ediel_outbound_owner.prepare_v1(jsonb_build_object('companyId',c,'environment',env,'actorUserId',actor,'rawPayload',raw,'relatedMessageId',s.id,'rulePackEvidence',basis));
  SELECT * INTO STRICT w FROM gridex_ediel_outbound_owner.witnesses WHERE id=(prepared->>'witnessId')::uuid;
  IF w.family IS DISTINCT FROM family OR w.related_message_id IS DISTINCT FROM s.id OR w.company_id IS DISTINCT FROM c OR w.environment IS DISTINCT FROM env THEN RAISE EXCEPTION 'ediel_ack_atomic_owner_scope_mismatch';END IF;
 END IF;
 -- Native parse controls all physical reference/endpoint metadata; no parsed
 -- caller reference or foreign resource ID becomes a business identity.
 parsed:=coalesce(draft->'parsedPayload','{}'::jsonb)-ARRAY['relatedTransactionReference','utiltsErrSequenceToken','ackScope','sourceMessageId','ackSourceId','serviceAssignment','sourceAuthority','rulePackEvidence'];
 IF jsonb_typeof(parsed) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_ack_atomic_metadata_required';END IF;
 IF sequence_field IS NOT NULL THEN parsed:=parsed||jsonb_build_object(sequence_field,sequence_value);END IF;
 IF sequence_field='relatedTransactionReference' THEN parsed:=parsed||jsonb_build_object('ackScope','transaction');END IF;
 parsed:=parsed||jsonb_build_object('ackSourceId',s.id,'ackFamily',family);
 op:='ediel_ack:'||s.id::text||':'||family||':'||coalesce(sequence_value,'message');
 m.id:=gen_random_uuid();m.company_id:=c;m.environment:=env;m.direction:='outbound';m.message_standard:='edifact';m.message_family:=family;
 m.message_code:=CASE WHEN w.id IS NOT NULL THEN w.code ELSE family END;m.raw_payload:=raw;m.related_message_id:=s.id;m.status:='draft';m.source_operation_id:=op;
 m.test_flag:=CASE env WHEN 'production' THEN 0 ELSE 1 END;m.message_version:=draft->>'messageVersion';m.process_type:=draft->>'processType';m.transport_type:='smtp';
 m.sender_ediel_id:=unb#>>'{elements,2,0}';m.receiver_ediel_id:=unb#>>'{elements,3,0}';m.sender_sub_address:=nullif(unb#>>'{elements,2,2}','');m.receiver_sub_address:=nullif(unb#>>'{elements,3,2}','');
 m.interchange_reference:=unb#>>'{elements,5,0}';m.application_reference:=unb#>>'{elements,7,0}';m.original_message_id:=unh#>>'{elements,1,0}';m.external_reference:=bgm#>>'{elements,2,0}';
 m.original_transaction_id:=sequence_value;m.original_message_code:=CASE WHEN common THEN NULL ELSE s.message_code END;
 SELECT t#>>'{elements,1,1}' INTO m.correlation_reference FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW' ORDER BY (t->>'index')::int LIMIT 1;
 SELECT t#>>'{elements,1,1}' INTO m.transaction_reference FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='TN' ORDER BY (t->>'index')::int LIMIT 1;
 m.sender_name:=draft->>'senderName';m.receiver_name:=draft->>'receiverName';m.subject:=draft->>'subject';m.file_name:=draft->>'fileName';m.mime_type:=draft->>'mimeType';
 m.communication_route_id:=nullif(draft->>'communicationRouteId','')::uuid;m.route_profile_id:=nullif(draft->>'routeProfileId','')::uuid;
 m.sender_email:=draft->>'senderEmail';m.receiver_email:=draft->>'receiverEmail';m.mailbox:=draft->>'mailbox';
 IF route IS NOT NULL THEN
  IF m.communication_route_id::text IS DISTINCT FROM route#>>'{route,id}' OR m.route_profile_id::text IS DISTINCT FROM route#>>'{routeRuntime,route_profile_id}'
   OR m.sender_email IS DISTINCT FROM route->>'senderEmail' OR m.receiver_email IS DISTINCT FROM route->>'receiverEmail' OR m.mailbox IS DISTINCT FROM route->>'mailbox' THEN RAISE EXCEPTION 'ediel_ack_atomic_route_changed';END IF;
 ELSE
  -- Fresh ordinary response selects the exact named route/profile under lock;
  -- replay above never consults these mutable rows.
  LOCK TABLE public.communication_routes,public.ediel_route_profiles,public.ediel_transport_profiles IN SHARE MODE;
  IF NOT EXISTS(SELECT FROM public.communication_routes r JOIN public.ediel_route_profiles p ON p.communication_route_id=r.id AND p.company_id=c
   WHERE r.id=m.communication_route_id AND p.id=m.route_profile_id AND r.company_id=c AND r.is_active AND p.is_enabled AND p.environment=env
    AND p.sender_ediel_id=m.sender_ediel_id AND p.receiver_ediel_id=m.receiver_ediel_id
    AND coalesce(p.sender_subaddress,p.sender_sub_address,'')=coalesce(m.sender_sub_address,'') AND coalesce(p.receiver_subaddress,p.receiver_sub_address,'')=coalesce(m.receiver_sub_address,'')
    AND p.application_reference IS NOT DISTINCT FROM m.application_reference AND r.target_email IS NOT DISTINCT FROM m.receiver_email AND p.mailbox IS NOT DISTINCT FROM m.mailbox) THEN RAISE EXCEPTION 'ediel_ack_atomic_route_changed';END IF;
 END IF;
 IF common THEN m.execution_context_snapshot:=jsonb_build_object('prodatCommonHeaderNegativeWitnessId',prepared->>'witnessId');
 ELSIF w.id IS NOT NULL THEN
  m.execution_context_snapshot:=jsonb_build_object('outboundOwnerWitnessId',w.id);m.canonical_rule_pack_id:=(w.evidence->>'rulePackId')::uuid;m.rule_profile_version_id:=(w.evidence->>'messageProfileId')::uuid;
  m.rule_profile_key:=w.evidence->>'profileKey';m.rule_profile_version:=w.evidence->>'version';m.rule_pack_checksum:=w.evidence->>'sourceHash';m.rule_pack_snapshot:=w.evidence->'snapshot';
  -- Resource links must be owned by the actual original tenant. They never
  -- arrive through the caller draft. Lock the real rows before inheriting.
  FOR resource IN SELECT * FROM (VALUES('customers',s.customer_id),('customer_sites',s.site_id),('metering_points',s.metering_point_id),('grid_owners',s.grid_owner_id),('supplier_switch_requests',s.switch_request_id),('grid_owner_data_requests',s.grid_owner_data_request_id),('outbound_requests',s.outbound_request_id),('partner_exports',s.partner_export_id)) v(table_name,id) WHERE id IS NOT NULL LOOP
   EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE r.id=$1 AND r.company_id=$2 FOR SHARE',resource.table_name) INTO resource_json USING resource.id,c;
   IF resource_json IS NULL THEN RAISE EXCEPTION 'ediel_ack_atomic_foreign_source_resource';END IF;
  END LOOP;
  m.customer_id:=s.customer_id;m.site_id:=s.site_id;m.metering_point_id:=s.metering_point_id;m.grid_owner_id:=s.grid_owner_id;
  m.switch_request_id:=s.switch_request_id;m.grid_owner_data_request_id:=s.grid_owner_data_request_id;m.outbound_request_id:=s.outbound_request_id;m.partner_export_id:=s.partner_export_id;
 END IF;
 m.parsed_payload:=parsed;m.validation_report:=coalesce(draft->'validationReport','{}'::jsonb);m.requires_contrl:=false;m.requires_aperak:=false;
 m.contrl_status:='not_required';m.aperak_status:='not_required';m.utilts_err_status:='not_required';m.syntax_check_status:=draft->>'syntaxCheckStatus';m.functional_check_status:=draft->>'functionalCheckStatus';
 m.message_created_at:=coalesce((draft->>'messageCreatedAt')::timestamptz,clock_timestamp());m.validated_at:=(draft->>'validatedAt')::timestamptz;m.ack_due_at:=(draft->>'ackDueAt')::timestamptz;
 m.created_by:=actor;m.updated_by:=actor;
 -- Set physical outcome before immutable namespace/public row insertion.
 IF family='CONTRL' THEN wire_outcome:=CASE basis->>'syntaxDecision' WHEN 'accepted' THEN 'positive' WHEN 'rejected' THEN 'negative' END;
 ELSIF common OR family='UTILTS_ERR' THEN wire_outcome:='negative';
 ELSE wire_outcome:=CASE WHEN EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC') AND NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC' AND t#>>'{elements,1,0}'<>'100') THEN 'positive' ELSE 'negative' END;END IF;
 IF wire_outcome IS NULL OR outcome IS NOT NULL AND outcome IS DISTINCT FROM wire_outcome THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_outcome_mismatch';END IF;
 m.ack_outcome:=wire_outcome;m.ack_status:=wire_outcome;m.parsed_payload:=m.parsed_payload||jsonb_build_object('ackOutcome',wire_outcome);
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,message_version,process_type,test_flag,status,transport_type,
  raw_payload,related_message_id,source_operation_id,sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address,sender_name,receiver_name,sender_email,receiver_email,mailbox,subject,file_name,mime_type,
  communication_route_id,route_profile_id,interchange_reference,application_reference,original_message_id,original_transaction_id,original_message_code,external_reference,correlation_reference,transaction_reference,
  execution_context_snapshot,canonical_rule_pack_id,rule_profile_version_id,rule_profile_key,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,
  customer_id,site_id,metering_point_id,grid_owner_id,switch_request_id,grid_owner_data_request_id,outbound_request_id,partner_export_id,
  parsed_payload,validation_report,requires_contrl,requires_aperak,contrl_status,aperak_status,utilts_err_status,ack_outcome,ack_status,syntax_check_status,functional_check_status,message_created_at,validated_at,ack_due_at,created_by,updated_by)
 VALUES(m.id,m.company_id,m.environment,m.direction,m.message_standard,m.message_family,m.message_code,m.message_version,m.process_type,m.test_flag,m.status,m.transport_type,
  m.raw_payload,m.related_message_id,m.source_operation_id,m.sender_ediel_id,m.receiver_ediel_id,m.sender_sub_address,m.receiver_sub_address,m.sender_name,m.receiver_name,m.sender_email,m.receiver_email,m.mailbox,m.subject,m.file_name,m.mime_type,
  m.communication_route_id,m.route_profile_id,m.interchange_reference,m.application_reference,m.original_message_id,m.original_transaction_id,m.original_message_code,m.external_reference,m.correlation_reference,m.transaction_reference,
  m.execution_context_snapshot,m.canonical_rule_pack_id,m.rule_profile_version_id,m.rule_profile_key,m.rule_profile_version,m.rule_pack_checksum,m.rule_pack_snapshot,
  m.customer_id,m.site_id,m.metering_point_id,m.grid_owner_id,m.switch_request_id,m.grid_owner_data_request_id,m.outbound_request_id,m.partner_export_id,
  m.parsed_payload,m.validation_report,m.requires_contrl,m.requires_aperak,m.contrl_status,m.aperak_status,m.utilts_err_status,m.ack_outcome,m.ack_status,m.syntax_check_status,m.functional_check_status,m.message_created_at,m.validated_at,m.ack_due_at,m.created_by,m.updated_by) RETURNING * INTO m;
 -- Real native guide/source/namespace/witness consumption triggers ran. Re-read
 -- their immutable original/ACK receipts before publishing effects/results.
 result:=gridex_ediel_ack_replay.read_v1(c,env,s.id,actor,family,sequence_field,sequence_value);
 IF result#>>'{ackMessage,id}' IS DISTINCT FROM m.id::text THEN RAISE EXCEPTION 'ediel_ack_atomic_postwrite_owner_mismatch';END IF;
 business_type:=CASE WHEN m.switch_request_id IS NOT NULL THEN 'supplier_switch_request' WHEN m.grid_owner_data_request_id IS NOT NULL THEN 'grid_owner_data_request' WHEN m.outbound_request_id IS NOT NULL THEN 'outbound_request' WHEN m.partner_export_id IS NOT NULL THEN 'partner_export' END;
 business_id:=coalesce(m.switch_request_id,m.grid_owner_data_request_id,m.outbound_request_id,m.partner_export_id);
 IF business_id IS NOT NULL THEN
  FOR reference IN SELECT DISTINCT reference_type,reference_value FROM (
   SELECT 'UNB_REF'::text reference_type,m.interchange_reference reference_value UNION ALL SELECT 'BGM_REF',m.external_reference
   UNION ALL SELECT 'RFF_'||(t#>>'{elements,1,0}'),t#>>'{elements,1,1}' FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}' IN('LI','ACW','Z07','TN')
   UNION ALL SELECT 'IDE',t#>>'{elements,2,0}' FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='IDE') r WHERE nullif(reference_value,'') IS NOT NULL LOOP
   INSERT INTO public.ediel_business_references(company_id,source_message_id,reference_type,reference_value,message_family,message_code,business_object_type,business_object_id,customer_id,customer_site_id,metering_point_id)
    VALUES(c,m.id,reference.reference_type,reference.reference_value,family,m.message_code,business_type,business_id,m.customer_id,m.site_id,m.metering_point_id)
    ON CONFLICT(company_id,reference_type,reference_value,business_object_type,business_object_id) DO NOTHING;
  END LOOP;
 END IF;
 INSERT INTO public.ediel_message_events(company_id,ediel_message_id,message_id,event_type,event_status,message,payload,event_payload,created_by)
  VALUES(c,m.id,m.id,'created','info','Ediel message '||family||' '||coalesce(m.message_code,'')||' skapad.',jsonb_build_object('status',m.status,'direction',m.direction,'externalReference',m.external_reference,'communicationRouteId',m.communication_route_id),jsonb_build_object('sourceMessageId',s.id,'sourceOperationId',op,'atomicOwner',true),actor) RETURNING id INTO event_id;
 INSERT INTO gridex_ediel_ack_replay.creation_receipts VALUES(m.id,s.id,c,env,actor,source_hash,encode(sha256(convert_to(raw,'UTF8')),'hex'),op,event_id,family,sequence_field,sequence_value,wire_outcome,clock_timestamp());
 RETURN result||jsonb_build_object('replayed',false);
END $$;
CREATE FUNCTION public.ediel_create_outbound_ack_scope_atomic_v2(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_actor_user_id uuid,p_ack_family text,p_outcome text,p_draft jsonb,p_common_smtp jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN
 RETURN gridex_ediel_ack_replay.create_scope_v2(p_company_id,p_environment,p_source_message_id,p_source_payload_hash,p_actor_user_id,p_ack_family,NULL,NULL,p_outcome,p_draft,p_common_smtp);END $$;
REVOKE ALL ON FUNCTION gridex_ediel_ack_replay.require_readonly_prodat_ledger_v2(public.ediel_messages),gridex_ediel_ack_replay.require_readonly_guide_v2(public.ediel_messages),gridex_ediel_ack_replay.read_exact_v2(uuid,text,uuid,uuid,text,uuid),gridex_ediel_ack_replay.read_scope_v2(uuid,text,uuid,text,uuid,text,text),gridex_ediel_ack_replay.create_scope_v2(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb),public.ediel_read_outbound_ack_scope_replay_v2(uuid,text,uuid,text,uuid,text,text),public.ediel_create_outbound_ack_scope_atomic_v2(uuid,text,uuid,text,uuid,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_ack_replay.read_scope_v2(uuid,text,uuid,text,uuid,text,text),gridex_ediel_ack_replay.create_scope_v2(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb),public.ediel_read_outbound_ack_scope_replay_v2(uuid,text,uuid,text,uuid,text,text),public.ediel_create_outbound_ack_scope_atomic_v2(uuid,text,uuid,text,uuid,text,text,jsonb,jsonb) TO service_role;
COMMIT;
