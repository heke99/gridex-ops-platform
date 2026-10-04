-- CLI-created bounded forward. Existing v1 producers and internal incidents
-- consume the same immutable source/own ACK qualifier as scope/status readers.
-- Raw sequence identity is retained; parsed/relation/outcome caches are not
-- capabilities. No retained ACK is repaired, reminted or delivered here.
BEGIN;
-- Technical ACKs have no outbound-owner witness. Their immutable atomic birth
-- receipt supplies the exact candidate source binding when a public relation
-- is absent. The installed original reader still validates technical evidence,
-- raw envelope, immutable hash and source; this expands discovery only.
DO $birth_candidates$ DECLARE definition text;original text;needle text;BEGIN
 definition:=pg_get_functiondef('gridex_ack_authority.read_outbound_originals_v1(uuid,text)'::regprocedure);
 SELECT prosrc INTO STRICT original FROM pg_proc WHERE oid='gridex_ack_authority.read_outbound_originals_v1(uuid,text)'::regprocedure;
 needle:='w.source_message_id=source.id)) ORDER BY m.created_at,m.id LOOP';
 IF position(needle IN original)=0 OR position('is_duplicate_ack_v1(ack.id)' IN original)=0 THEN RAISE EXCEPTION 'ediel_ack_original_birth_candidate_shape_changed';END IF;
 EXECUTE replace(definition,needle,'w.source_message_id=source.id) OR EXISTS(SELECT FROM gridex_ediel_ack_replay.creation_receipts r WHERE r.ack_message_id=m.id AND r.source_message_id=source.id AND r.company_id=company AND r.environment=source.environment AND r.source_payload_hash=source_hash AND r.ack_payload_hash=encode(sha256(convert_to(m.raw_payload,''UTF8'')),''hex''))) ORDER BY m.created_at,m.id LOOP');
END $birth_candidates$;
CREATE FUNCTION gridex_ediel_duplicate_responses.matches_business_sequence_v1(source public.ediel_messages,ack public.ediel_messages,sequence_field text,sequence_value text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt gridex_ediel_ack_replay.creation_receipts%rowtype;a jsonb;s jsonb;tokens jsonb;BEGIN
 a:=gridex_ack_authority.wire_v1(ack.raw_payload);s:=gridex_ack_authority.wire_v1(source.raw_payload);
 SELECT * INTO receipt FROM gridex_ediel_ack_replay.creation_receipts WHERE ack_message_id=ack.id FOR SHARE;
 IF receipt.ack_message_id IS NOT NULL AND (receipt.sequence_field IS DISTINCT FROM sequence_field OR receipt.sequence_value IS DISTINCT FROM sequence_value) THEN RETURN false;END IF;
 IF sequence_field='relatedTransactionReference' THEN
  RETURN coalesce(s->'ide','[]') ? sequence_value AND (CASE ack.message_family WHEN 'APERAK' THEN coalesce(a#>'{refs,ACW}','[]') ELSE coalesce(a#>'{refs,TN}','[]') END) ? sequence_value;
 ELSIF sequence_field='utiltsErrSequenceToken' THEN
  tokens:=gridex_utilts_binding.wire_tokens_v1(ack.raw_payload);
  RETURN EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='STS' AND t#>>'{elements,1,0}'='E01' AND t#>>'{elements,2,0}'='41' AND t#>>'{elements,3,0}'=sequence_value);
 ELSIF sequence_field IS NOT NULL OR sequence_value IS NOT NULL THEN RAISE EXCEPTION 'ediel_ack_replay_sequence_mismatch';END IF;
 -- The immutable birth tuple disambiguates a recorded full response. Older
 -- unreceipted UTILTS originals need actual full raw series coverage; never
 -- reinterpret one physical status/transaction as an unscoped response.
 IF receipt.ack_message_id IS NULL AND source.message_family='UTILTS' THEN
  IF ack.message_family='UTILTS_ERR' THEN
   tokens:=gridex_utilts_binding.wire_tokens_v1(ack.raw_payload);
   IF EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='STS' AND t#>>'{elements,1,0}'='E01' AND t#>>'{elements,2,0}'='41') THEN RAISE EXCEPTION 'ediel_historical_ack_sequence_basis_unavailable';END IF;
  ELSIF ack.message_family='APERAK' THEN
   IF EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(s->'ide','[]'))x WHERE NOT coalesce(a#>'{refs,ACW}','[]') ? x) THEN RAISE EXCEPTION 'ediel_historical_ack_sequence_basis_unavailable';END IF;
  END IF;
 END IF;
 RETURN true;
END$$;
REVOKE ALL ON FUNCTION gridex_ediel_duplicate_responses.matches_business_sequence_v1(public.ediel_messages,public.ediel_messages,text,text) FROM PUBLIC,anon,authenticated,service_role;

DO $v1_read$ DECLARE definition text;original text;body text;cut integer;BEGIN
 SELECT prosrc INTO STRICT original FROM pg_proc WHERE oid='gridex_ediel_ack_replay.read_v1(uuid,text,uuid,uuid,text,text,text)'::regprocedure;
 definition:=pg_get_functiondef('gridex_ediel_ack_replay.read_v1(uuid,text,uuid,uuid,text,text,text)'::regprocedure);
 cut:=position(' -- A permission decision' IN original);
 IF cut=0 OR position('ediel_ack_replay_sequence_mismatch' IN original)=0 OR position('is_duplicate_ack_v1(m.id)' IN original)=0 THEN RAISE EXCEPTION 'ediel_ack_v1_installed_reader_shape_changed';END IF;
 -- Preserve the original signature and exact input/scope validation. Source,
 -- own guide/namespace/ledger/outcome admission moves to the shared qualifier.
 body:=left(original,cut-1)||$body$
 context:=gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source_id,actor,family,NULL,'prepare');
 source:=jsonb_populate_record(NULL::public.ediel_messages,context->'sourceMessage');
 IF sequence_field='relatedTransactionReference' AND NOT coalesce(gridex_ack_authority.wire_v1(source.raw_payload)->'ide','[]') ? sequence_value THEN RAISE EXCEPTION 'ediel_ack_replay_sequence_mismatch';END IF;
 basis:=gridex_ack_authority.read_outbound_originals_v1(source.id,family);
 IF basis->>'sourceMessageId' IS DISTINCT FROM source.id::text OR basis->>'companyId' IS DISTINCT FROM c::text OR basis->>'environment' IS DISTINCT FROM env THEN RAISE EXCEPTION 'ediel_business_ack_own_original_required';END IF;
 FOR a IN SELECT x FROM jsonb_array_elements(basis->'originals')x LOOP
  ack:=jsonb_populate_record(NULL::public.ediel_messages,a->'message');
  -- Determine only physical applicability before current per-original
  -- admission. An unrelated series' policy cannot redefine this sequence.
  IF gridex_ediel_duplicate_responses.matches_business_sequence_v1(source,ack,sequence_field,sequence_value) THEN
   IF a->>'status' IS DISTINCT FROM 'qualified' THEN RAISE EXCEPTION 'ediel_historical_ack_scope_basis_unavailable';END IF;
   ack_context:=gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source.id,actor,family,ack.id,'prepare');
   IF ack_context IS NULL THEN RAISE EXCEPTION 'ediel_historical_ack_scope_basis_unavailable';END IF;
   IF own_basis IS NOT NULL THEN RAISE EXCEPTION 'ediel_ack_replay_own_response_ambiguous';END IF;own_basis:=ack_context;
  END IF;
 END LOOP;
 IF own_basis IS NULL THEN PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source.id,actor,family,NULL,'prepare');RETURN NULL;END IF;
 own_basis:=gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source.id,actor,family,(own_basis#>>'{ackMessage,id}')::uuid,'prepare');
 ack:=jsonb_populate_record(NULL::public.ediel_messages,own_basis->'ackMessage');
 IF gridex_ediel_duplicate_responses.matches_business_sequence_v1(source,ack,sequence_field,sequence_value) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_ack_replay_sequence_mismatch';END IF;
 IF sequence_field IS NOT NULL THEN
  ack.parsed_payload:=coalesce(ack.parsed_payload,'{}')||jsonb_build_object(sequence_field,sequence_value);
  IF sequence_field='relatedTransactionReference' THEN ack.parsed_payload:=ack.parsed_payload||jsonb_build_object('ackScope','transaction');END IF;
 END IF;
 PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source.id,actor,family,ack.id,'prepare');
 RETURN own_basis||jsonb_build_object('ackMessage',to_jsonb(ack));
END
$body$;
 EXECUTE replace(definition,original,body);
END $v1_read$;
DO $v1_create$ DECLARE definition text;original text;body text;needle text;BEGIN
 SELECT prosrc INTO STRICT original FROM pg_proc WHERE oid='gridex_ediel_ack_replay.create_v1(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)'::regprocedure;
 definition:=pg_get_functiondef('gridex_ediel_ack_replay.create_v1(uuid,text,uuid,text,uuid,text,text,text,text,jsonb,jsonb)'::regprocedure);body:=original;
 IF position('ediel_ack_atomic_postwrite_owner_mismatch' IN body)=0 OR position('INSERT INTO gridex_ediel_ack_replay.creation_receipts' IN body)=0 THEN RAISE EXCEPTION 'ediel_ack_v1_installed_creation_shape_changed';END IF;
 needle:='RETURN existing||jsonb_build_object(''replayed'',true);';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_ack_v1_creation_replay_shape_changed';END IF;
 body:=replace(body,needle,'result:=gridex_ediel_ack_replay.read_v1(c,env,s.id,actor,family,sequence_field,sequence_value);'||chr(10)||'  IF result#>>''{ackMessage,id}'' IS DISTINCT FROM existing#>>''{ackMessage,id}'' THEN RAISE EXCEPTION ''ediel_ack_atomic_postwrite_owner_mismatch'';END IF; existing:=result;'||chr(10)||'  '||needle);
 needle:='RETURN result||jsonb_build_object(''replayed'',false);';IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_ack_v1_creation_final_shape_changed';END IF;
 body:=replace(body,needle,'result:=gridex_ediel_ack_replay.read_v1(c,env,s.id,actor,family,sequence_field,sequence_value);'||chr(10)||' IF result#>>''{ackMessage,id}'' IS DISTINCT FROM m.id::text THEN RAISE EXCEPTION ''ediel_ack_atomic_postwrite_owner_mismatch'';END IF;'||chr(10)||' '||needle);
 EXECUTE replace(definition,original,body);
END $v1_create$;

DO $incident_actor$ DECLARE definition text;original text;BEGIN
 definition:=pg_get_functiondef('gridex_ediel_business_incidents.actor_v2(uuid,uuid,text)'::regprocedure);
 SELECT prosrc INTO STRICT original FROM pg_proc WHERE oid='gridex_ediel_business_incidents.actor_v2(uuid,uuid,text)'::regprocedure;
 IF position('mode IN(''read'',''report'')' IN original)=0 THEN RAISE EXCEPTION 'ediel_incident_actor_phase_shape_changed';END IF;
 EXECUTE replace(definition,original,$body$BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 IF mode IS NULL OR mode NOT IN('read','report') THEN RETURN false;END IF;
 PERFORM gridex_ediel_duplicate_responses.require_business_read_actor_v1(c,actor,CASE mode WHEN 'read' THEN 'read' ELSE 'prepare' END);
 RETURN true;EXCEPTION WHEN insufficient_privilege THEN RETURN false;END$body$);
END $incident_actor$;
DO $incident_inspect$ DECLARE definition text;original text;BEGIN
 definition:=pg_get_functiondef('gridex_ediel_business_incidents.inspect_ack_v1(uuid,text,uuid,uuid,text,uuid)'::regprocedure);
 SELECT prosrc INTO STRICT original FROM pg_proc WHERE oid='gridex_ediel_business_incidents.inspect_ack_v1(uuid,text,uuid,uuid,text,uuid)'::regprocedure;
 IF position('require_readonly_guide_v2' IN original)=0 OR position('ediel_ack_replay_original_basis_mismatch' IN original)=0 THEN RAISE EXCEPTION 'ediel_incident_installed_inspection_shape_changed';END IF;
 EXECUTE replace(definition,original,$body$BEGIN
 IF gridex_ediel_business_incidents.actor_v2(c,actor,'read') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_ack_replay_actor_not_authorized' USING ERRCODE='42501';END IF;
 RETURN gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source_id,actor,family,ack_id,'read');END$body$);
END $incident_inspect$;
DO $incident_originals$ DECLARE signature text;definition text;original text;body text;needle text;phase text;BEGIN
 FOREACH signature IN ARRAY ARRAY['gridex_ediel_business_incidents.original_v1(uuid,uuid,jsonb)','gridex_ediel_business_incidents.original_read_v2(uuid,uuid,jsonb)'] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);SELECT prosrc INTO STRICT original FROM pg_proc WHERE oid=signature::regprocedure;body:=original;
  IF position('ediel_business_incident_actual_positive_scope_required' IN body)=0 OR position('ediel_business_incident_actual_accepted_ack_required' IN body)=0 THEN RAISE EXCEPTION 'ediel_incident_original_applicability_shape_changed';END IF;
  IF signature LIKE '%original_v1(%' THEN
   phase:='prepare';
   needle:='IF public.gridex_actor_has_company_permission(actor,c,''communication.write'') IS NOT TRUE OR public.gridex_actor_has_company_permission(actor,c,''communication.send'') IS NOT TRUE THEN';
   IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_incident_original_actor_shape_changed';END IF;
   body:=replace(body,needle,'IF gridex_ediel_business_incidents.actor_v2(c,actor,''report'') IS NOT TRUE THEN');
   needle:='gridex_ediel_ack_replay.read_exact_v2(c,source.environment,source.id,actor,''APERAK'',(input->>''ackMessageId'')::uuid)';
   IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_incident_original_reader_shape_changed';END IF;
   body:=replace(body,needle,'gridex_ediel_duplicate_responses.read_business_original_v1(c,source.environment,source.id,actor,''APERAK'',(input->>''ackMessageId'')::uuid,''prepare'')');
   needle:='public.gridex_ediel_accepted_transport_projection_v1(c,source.environment,actor,ack.id)';
   IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_incident_transport_basis_shape_changed';END IF;
   body:=replace(body,needle,'gridex_ediel_transport.accepted_source_basis_v1(ack)');
  ELSE phase:='read';END IF;
  needle:='SELECT * INTO STRICT ack FROM public.ediel_messages WHERE company_id=c AND id=(owned#>>''{ackMessage,id}'')::uuid AND related_message_id=source.id AND environment=source.environment FOR SHARE;';
  IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_incident_original_cache_reader_shape_changed';END IF;
  body:=replace(body,needle,'ack:=jsonb_populate_record(NULL::public.ediel_messages,owned->''ackMessage'');');
  needle:='RETURN jsonb_build_object(''companyId'',c,''environment'',source.environment,''sourceMessageId'',source.id,''ackMessageId'',ack.id';
  IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_incident_original_return_shape_changed';END IF;
  body:=replace(body,needle,'PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,source.environment,source.id,actor,''APERAK'',ack.id,'||quote_literal(phase)||');'||chr(10)||' '||needle);
  EXECUTE replace(definition,original,body);
 END LOOP;
END $incident_originals$;
DO $incident_report$ DECLARE definition text;original text;body text;needle text;BEGIN
 definition:=pg_get_functiondef('public.ediel_report_fresh_business_incident_v1(uuid,uuid,jsonb)'::regprocedure);
 SELECT prosrc INTO STRICT original FROM pg_proc WHERE oid='public.ediel_report_fresh_business_incident_v1(uuid,uuid,jsonb)'::regprocedure;body:=original;
 needle:='RETURN gridex_ediel_business_incidents.result_v1(i);';
 IF position(needle IN body)=0 OR position('INSERT INTO gridex_ediel_business_incidents.events' IN body)=0 THEN RAISE EXCEPTION 'ediel_incident_report_return_shape_changed';END IF;
 body:=replace(body,needle,'PERFORM gridex_ediel_business_incidents.original_v1(p_company_id,p_actor_user_id,p_input);'||chr(10)||'  '||needle);
 EXECUTE replace(definition,original,body);
END $incident_report$;
COMMIT;
