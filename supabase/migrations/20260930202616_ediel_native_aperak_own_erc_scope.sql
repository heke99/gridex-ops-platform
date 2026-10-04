-- Created by actual Supabase CLI2.118.0. Shared own ERC/DM/ACW scope preserves
-- canonical syntax/guide owner; native journal cannot contradict its wire outcome.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_ack_authority.wire_v1(p_raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(p_raw);t jsonb;e jsonb;out jsonb:=jsonb_build_object('refs','{}'::jsonb);first_detail integer;family text;legal_sender text;legal_receiver text;erc text;group_index integer:=-1;group_key text;
BEGIN
 IF tokens IS NULL OR EXISTS(SELECT FROM unnest(ARRAY['UNB','UNH','UNT','UNZ']) tag WHERE (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'=tag)<>1) THEN RETURN NULL; END IF;
 SELECT min((x->>'index')::integer) INTO first_detail FROM jsonb_array_elements(tokens) x WHERE x->>'tag' IN ('IDE','LIN');
 FOR t IN SELECT x FROM jsonb_array_elements(tokens) x ORDER BY (x->>'index')::integer LOOP
  e:=t->'elements';
  IF t->>'tag'='UNB' THEN out:=out||jsonb_build_object('sender',e->2,'receiver',e->3,'interchange',e#>>'{5,0}','app',e#>>'{7,0}','environment',CASE e#>>'{11,0}' WHEN '1' THEN 'test' ELSE 'production' END);
  ELSIF t->>'tag'='UNH' THEN family:=e#>>'{2,0}';out:=out||jsonb_build_object('family',family,'type',e->2,'unhRef',e#>>'{1,0}','unhIndex',t->'index');
  ELSIF t->>'tag'='UNT' THEN out:=out||jsonb_build_object('untRef',e#>>'{2,0}','untCount',e#>>'{1,0}','untIndex',t->'index');
  ELSIF t->>'tag'='BGM' THEN IF out ? 'code' THEN RETURN NULL; END IF;out:=out||jsonb_build_object('code',e#>>'{1,0}','document',e#>>'{2,0}','function',e#>>'{3,0}');
  ELSIF t->>'tag'='DOC' THEN IF out ? 'docRef' THEN RETURN NULL; END IF;out:=out||jsonb_build_object('docCode',e#>>'{1,0}','docRef',e#>>'{2,0}');
  ELSIF t->>'tag'='UCI' THEN IF out ? 'uciRef' THEN RETURN NULL; END IF;out:=out||jsonb_build_object('uciRef',e#>>'{1,0}','uciSender',e->2,'uciReceiver',e->3,'uciAction',e#>>'{4,0}');
  ELSIF t->>'tag'='UCM' THEN out:=jsonb_set(out,'{ucm}',coalesce(out->'ucm','[]')||jsonb_build_array(e#>>'{1,0}'));
  ELSIF t->>'tag'='IDE' THEN IF e#>>'{1,0}'<>'24' THEN RETURN NULL; END IF;out:=jsonb_set(out,'{ide}',coalesce(out->'ide','[]')||jsonb_build_array(e#>>'{2,0}'));
  ELSIF t->>'tag'='RFF' THEN out:=jsonb_set(out,ARRAY['refs',e#>>'{1,0}'],coalesce(out#>ARRAY['refs',e#>>'{1,0}'],'[]')||jsonb_build_array(e#>>'{1,1}'));
   IF group_index>=0 AND e#>>'{1,0}' IN ('DM','ACW') THEN
    group_key:=lower(e#>>'{1,0}');out:=jsonb_set(out,ARRAY['ercGroups',group_index::text,group_key],coalesce(out#>ARRAY['ercGroups',group_index::text,group_key],'[]')||jsonb_build_array(e#>>'{1,1}'));END IF;
   IF e#>>'{1,0}' IN ('LI','ACW') AND erc IS NOT NULL THEN out:=jsonb_set(out,'{scopeResults}',coalesce(out->'scopeResults','[]')||jsonb_build_array(jsonb_build_object('qualifier',e#>>'{1,0}','reference',e#>>'{1,1}','outcome',CASE erc WHEN '100' THEN 'positive' ELSE 'negative' END))); END IF;
  ELSIF t->>'tag'='FTX' AND group_index>=0 THEN out:=jsonb_set(out,ARRAY['ercGroups',group_index::text,'texts'],coalesce(out#>ARRAY['ercGroups',group_index::text,'texts'],'[]')||jsonb_build_array(e));
  ELSIF t->>'tag'='NAD' AND (first_detail IS NULL OR (t->>'index')::integer<first_detail) THEN
   legal_sender:=CASE family WHEN 'PRODAT' THEN 'FR' WHEN 'APERAK' THEN CASE out#>>'{type,2}' WHEN '96A' THEN 'FR' ELSE 'MS' END ELSE 'MS' END;
   legal_receiver:=CASE family WHEN 'PRODAT' THEN 'DO' WHEN 'APERAK' THEN CASE out#>>'{type,2}' WHEN '96A' THEN 'DO' ELSE 'MR' END ELSE 'MR' END;
   IF e#>>'{1,0}'=legal_sender THEN IF out ? 'legalSender' THEN RETURN NULL; END IF;out:=out||jsonb_build_object('legalSender',e#>>'{2,0}');
   ELSIF e#>>'{1,0}'=legal_receiver THEN IF out ? 'legalReceiver' THEN RETURN NULL; END IF;out:=out||jsonb_build_object('legalReceiver',e#>>'{2,0}'); END IF;
  ELSIF t->>'tag'='ERC' THEN erc:=e#>>'{1,0}';group_index:=group_index+1;out:=jsonb_set(out,'{ercGroups}',coalesce(out->'ercGroups','[]')||jsonb_build_array(jsonb_build_object('code',erc,'acw','[]'::jsonb,'dm','[]'::jsonb)));out:=jsonb_set(out,'{erc}',coalesce(out->'erc','[]')||jsonb_build_array(e#>>'{1,0}'));
  ELSIF t->>'tag'='STS' AND e#>>'{1,0}'='E01' AND e#>>'{2,0}'='41' THEN out:=out||jsonb_build_object('errStatus',true);
  END IF;
 END LOOP;
 IF out->>'unhRef' IS DISTINCT FROM out->>'untRef' OR out->>'untCount' !~ '^[0-9]+$'
  OR (out->>'untCount')::integer<>(out->>'untIndex')::integer-(out->>'unhIndex')::integer+1
  OR nullif(out->>'app','') IS NULL OR nullif(out#>>'{sender,0}','') IS NULL OR nullif(out#>>'{receiver,0}','') IS NULL THEN RETURN NULL; END IF;
 RETURN out;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(m public.ediel_messages,p_sending boolean) RETURNS void
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
   OR jsonb_array_length(g->'acw')<>(CASE WHEN header_scope THEN 0 ELSE 1 END) OR jsonb_array_length(g->'dm')<>1 OR (NOT header_scope AND nullif(g#>>'{acw,0}','') IS NULL) OR nullif(g#>>'{dm,0}','') IS NULL OR length(g#>>'{dm,0}')>35 OR btrim(g#>>'{dm,0}') IS DISTINCT FROM g#>>'{dm,0}' THEN RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable';END IF;
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
REVOKE ALL ON FUNCTION gridex_ediel_outbound_owner.require_positive_utilts_ack_v1(public.ediel_messages,boolean) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
