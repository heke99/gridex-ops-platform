-- Created with actual Supabase CLI2.118.0. Prospective U APERAK own A906 DM
-- uses the SAME immutable source edition already generated in 20261001034855.
-- That publication's input manifest/hash remains unchanged; this forward
-- repairs consumers, without publishing new guide data or resetting receipts.
BEGIN;
CREATE FUNCTION gridex_ediel_ack_guide.utilts_reference_constraints_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cfg jsonb;
BEGIN
 SELECT projection#>'{constraints,UTILTS}' INTO STRICT cfg FROM gridex_ediel_ack_guide.editions
  WHERE source_version='a30473a34535076e12e46386563adb3fa36431a0e7a245fc1be666c5737e8708';
 IF jsonb_typeof(cfg) IS DISTINCT FROM 'object' OR jsonb_typeof(cfg->'technicalProfile') IS DISTINCT FROM 'array'
  OR jsonb_typeof(cfg->'ownDmMax') IS DISTINCT FROM 'number' OR (cfg->>'ownDmMax')::integer<1 THEN RAISE EXCEPTION 'ediel_utilts_reference_source_unavailable';END IF;
 RETURN cfg;
END $$;

CREATE OR REPLACE FUNCTION gridex_ediel_wire_namespace.keys(p_raw text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb; unb jsonb; unh jsonb; token jsonb; sender text; legal_sender text; application text; interchange text; family text; output jsonb:='[]'; value text; kind text; key jsonb; cfg jsonb; maximum integer;
BEGIN
 tokens:=gridex_utilts_binding.wire_tokens_v1(p_raw);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNB')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNH')<>1 THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 SELECT x INTO unb FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNB';
 SELECT x INTO unh FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNH';
 sender:=nullif(unb#>>'{elements,2,0}',''); application:=nullif(unb#>>'{elements,7,0}',''); interchange:=nullif(unb#>>'{elements,5,0}',''); family:=unh#>>'{elements,2,0}';
 IF sender IS NULL OR (application IS NULL AND family<>'CONTRL') OR interchange IS NULL OR char_length(interchange)>14 OR family NOT IN('PRODAT','UTILTS','APERAK','CONTRL') THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 SELECT min(x#>>'{elements,2,0}') INTO legal_sender FROM jsonb_array_elements(tokens) x
  WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'=CASE WHEN family='PRODAT' THEN 'FR' ELSE 'MS' END;
 IF (SELECT count(DISTINCT x#>>'{elements,2,0}') FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'=CASE WHEN family='PRODAT' THEN 'FR' ELSE 'MS' END)>1 THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 legal_sender:=coalesce(nullif(legal_sender,''),sender);application:=coalesce(application,'');
 -- UNB is unique for the technical sender across applications/subaddresses.
 output:=jsonb_build_array(jsonb_build_object('sender',sender,'application','','kind','UNB','value',interchange));
 FOR token IN SELECT x FROM jsonb_array_elements(tokens) x WHERE x->>'tag' IN('UNH','BGM','IDE','RFF') LOOP
  kind:=NULL;value:=NULL;
  CASE token->>'tag'
   WHEN 'UNH' THEN kind:='UNH';value:=token#>>'{elements,1,0}';
   WHEN 'BGM' THEN kind:='BGM';value:=token#>>'{elements,2,0}';
   WHEN 'IDE' THEN kind:='IDE';value:=token#>>'{elements,2,0}';
   WHEN 'RFF' THEN
    IF token#>>'{elements,1,0}'='DM' THEN kind:='DM';value:=coalesce(nullif(token#>>'{elements,1,1}',''),token#>>'{elements,2,0}'); END IF;
   ELSE NULL;
  END CASE;
  IF kind IS NOT NULL THEN
   maximum:=35;
   IF kind='DM' THEN
    cfg:=gridex_ediel_ack_guide.utilts_reference_constraints_v1();
    IF unh#>'{elements,2}'=cfg->'technicalProfile' THEN maximum:=(cfg->>'ownDmMax')::integer;END IF;
   END IF;
   IF nullif(value,'') IS NULL OR char_length(value)>maximum THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
   key:=jsonb_build_object('sender',CASE WHEN kind='UNH' THEN sender ELSE legal_sender END,'application',CASE WHEN kind='UNH' THEN interchange ELSE application END,'kind',kind,'value',value);
   IF output @> jsonb_build_array(key) THEN RAISE EXCEPTION 'ediel_wire_reference_duplicate_in_source'; END IF;
   output:=output||jsonb_build_array(key);
  END IF;
 END LOOP;
 RETURN output;
END $$;

CREATE OR REPLACE FUNCTION gridex_ediel_outbound_owner.require_positive_before_received_err_v1(m public.ediel_messages,p_sending boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;a jsonb;s jsonb;groups jsonb;g jsonb;code text;transaction_id text;header_scope boolean;expected_header jsonb;actual_header jsonb;reservation public.ediel_ack_transaction_results%rowtype;
BEGIN
 IF m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'APERAK' THEN RETURN;END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=m.related_message_id AND company_id=m.company_id AND environment=m.environment AND direction='inbound' FOR SHARE;
 IF source.message_family IS DISTINCT FROM 'UTILTS' THEN RETURN;END IF;
 -- Reuse the one native physical ACK lexical/scope projector. The added own
 -- ERC groups never select policy, decide business acceptance or invent codes.
 a:=gridex_ack_authority.wire_v1(m.raw_payload);s:=gridex_ack_authority.wire_v1(source.raw_payload);
 IF a IS NULL OR a->>'family' IS DISTINCT FROM 'APERAK' OR a#>>'{type,1}' IS DISTINCT FROM 'D' OR a#>>'{type,2}' IS DISTINCT FROM '04A' OR a#>>'{type,3}' IS DISTINCT FROM 'UN' OR a#>>'{type,4}' IS DISTINCT FROM 'E5SE5A'
  OR NOT coalesce(gridex_ack_authority.source_match_v1(a,s),false) THEN RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable';END IF;
 code:=a->>'code';groups:=a->'ercGroups';
 IF code IS NULL OR code NOT IN('312','313') OR jsonb_typeof(groups) IS DISTINCT FROM 'array' OR jsonb_array_length(groups)=0
  OR (jsonb_array_length(groups)<>jsonb_array_length(coalesce(a#>'{refs,ACW}','[]')) AND NOT(code='313' AND jsonb_array_length(coalesce(a#>'{refs,ACW}','[]'))=0)) OR jsonb_array_length(groups)<>jsonb_array_length(coalesce(a#>'{refs,DM}','[]'))
  OR EXISTS(SELECT x FROM jsonb_array_elements_text(coalesce(a#>'{refs,DM}','[]'))x GROUP BY x HAVING count(*)>1)
  OR (code='312' AND EXISTS(SELECT x FROM jsonb_array_elements_text(coalesce(a#>'{refs,ACW}','[]'))x GROUP BY x HAVING count(*)>1)) THEN RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable';END IF;
 header_scope:=code='313' AND jsonb_array_length(coalesce(a#>'{refs,ACW}','[]'))=0;
 IF header_scope THEN
  expected_header:=gridex_received_sources.require_utilts_header_v1(m.company_id,source.id);
  IF EXISTS(SELECT FROM jsonb_array_elements(groups)x WHERE jsonb_array_length(coalesce(x->'texts','[]'))<>1) THEN RAISE EXCEPTION 'utilts_header_ack_owner_unavailable';END IF;
  SELECT jsonb_agg(row ORDER BY row::text) INTO actual_header FROM (SELECT jsonb_build_object('ercCode',x->>'code','fieldCode',x#>>'{texts,0,3,0}','text',x#>>'{texts,0,4,0}') row FROM jsonb_array_elements(groups)x) own_errors;
  SELECT jsonb_agg(x ORDER BY x::text) INTO expected_header FROM jsonb_array_elements(expected_header->'applicationErrors')x;
  IF actual_header IS DISTINCT FROM expected_header THEN RAISE EXCEPTION 'utilts_header_ack_owner_unavailable';END IF;
 END IF;
 FOR g IN SELECT x FROM jsonb_array_elements(groups)x LOOP
  IF nullif(g->>'code','') IS NULL OR (code='312' AND g->>'code' IS DISTINCT FROM '100') OR (code='313' AND g->>'code'='100')
   OR jsonb_array_length(g->'acw')<>(CASE WHEN header_scope THEN 0 ELSE 1 END) OR jsonb_array_length(g->'dm')<>1 OR (NOT header_scope AND nullif(g#>>'{acw,0}','') IS NULL) OR nullif(g#>>'{dm,0}','') IS NULL OR length(g#>>'{dm,0}')>(gridex_ediel_ack_guide.utilts_reference_constraints_v1()->>'ownDmMax')::integer OR btrim(g#>>'{dm,0}') IS DISTINCT FROM g#>>'{dm,0}' THEN RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable';END IF;
  IF header_scope THEN CONTINUE;END IF;
  transaction_id:=g#>>'{acw,0}';
  IF code='312' THEN
   PERFORM public.gridex_require_utilts_positive_ack_authority_v1(m.company_id,m.environment,source.id,transaction_id,
    CASE WHEN p_sending THEN m.id ELSE NULL END,CASE WHEN p_sending THEN m.raw_payload ELSE NULL END);
  ELSE
   -- A negative own-IDE response cannot replace an already established positive
   -- storage/ACK result or bypass its own immutable planned/final reservation.
   SELECT * INTO reservation FROM public.ediel_ack_transaction_results WHERE company_id=m.company_id AND environment=m.environment AND source_message_id=source.id AND source_transaction_id=transaction_id FOR SHARE;
   IF NOT FOUND OR reservation.planned_response_type IS DISTINCT FROM 'negative_aperak' OR reservation.disposition='accepted'
    OR (reservation.final_response_type IS NOT NULL AND reservation.final_response_type<>'negative_aperak')
    OR (p_sending AND (reservation.final_response_type IS DISTINCT FROM 'negative_aperak' OR reservation.response_message_id IS DISTINCT FROM m.id OR reservation.finalized_at IS NULL)) THEN RAISE EXCEPTION 'utilts_negative_ack_reservation_unavailable';END IF;
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(m public.ediel_messages,p_sending boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;a jsonb;s jsonb;groups jsonb;g jsonb;ids text[]:='{}';dms text[]:='{}';tx text;dm text;
BEGIN
 IF m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'APERAK' THEN RETURN;END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=m.related_message_id AND company_id=m.company_id AND environment=m.environment AND direction='inbound' FOR SHARE;
 IF source.message_family IS DISTINCT FROM 'UTILTS_ERR' THEN PERFORM gridex_ediel_outbound_owner.require_positive_before_received_err_v1(m,p_sending);RETURN;END IF;
 a:=gridex_ack_authority.wire_v1(m.raw_payload);s:=gridex_ack_authority.wire_v1(source.raw_payload);groups:=a->'ercGroups';
 IF a IS NULL OR a->>'family' IS DISTINCT FROM 'APERAK' OR a->>'code' IS DISTINCT FROM '312' OR a#>>'{type,2}' IS DISTINCT FROM '04A' OR a#>>'{type,4}' IS DISTINCT FROM 'E5SE5A'
  OR NOT coalesce(gridex_ack_authority.source_match_v1(a,s),false) OR jsonb_typeof(groups) IS DISTINCT FROM 'array' OR jsonb_array_length(groups)=0 THEN RAISE EXCEPTION 'utilts_err_application_response_authority_unavailable';END IF;
 FOR g IN SELECT x FROM jsonb_array_elements(groups)x LOOP
  tx:=g#>>'{acw,0}';dm:=g#>>'{dm,0}';
  IF g->>'code' IS DISTINCT FROM '100' OR jsonb_array_length(g->'acw')<>1 OR jsonb_array_length(g->'dm')<>1 OR nullif(tx,'') IS NULL OR nullif(dm,'') IS NULL OR length(dm)>(gridex_ediel_ack_guide.utilts_reference_constraints_v1()->>'ownDmMax')::integer OR tx=ANY(ids) OR dm=ANY(dms) THEN RAISE EXCEPTION 'utilts_err_application_response_authority_unavailable';END IF;
  ids:=array_append(ids,tx);dms:=array_append(dms,dm);
  PERFORM public.gridex_require_utilts_positive_ack_authority_v1(m.company_id,m.environment,source.id,tx,CASE WHEN p_sending THEN m.id ELSE NULL END,CASE WHEN p_sending THEN m.raw_payload ELSE NULL END);
 END LOOP;
END $$;

-- Existing trigger/RPC callers retain their prior permissions. The reference
-- source reader and namespace projector cannot be caller-injected authorities.
REVOKE ALL ON FUNCTION gridex_ediel_ack_guide.utilts_reference_constraints_v1(),gridex_ediel_wire_namespace.keys(text),gridex_ediel_outbound_owner.require_positive_before_received_err_v1(public.ediel_messages,boolean),gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(public.ediel_messages,boolean) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
