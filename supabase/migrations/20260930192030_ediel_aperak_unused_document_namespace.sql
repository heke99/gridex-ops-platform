-- Forward correction of the physical reference projection only. Frozen rule
-- ACK-10 / AT-ACK-10, P26.A/16.B pp98–100 (source manifest SHA256
-- 83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95):
-- PRODAT APERAK leaves BGM/1001 and 1004 unused and uses function 27/34.
-- Its own UNB/UNH remain reserved; ACW identifies the original document.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_ediel_wire_namespace.keys(p_raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb; unb jsonb; unh jsonb; token jsonb; sender text; legal_sender text; application text; interchange text; family text; prodat_aperak boolean; output jsonb:='[]'; value text; kind text; key jsonb;
BEGIN
 tokens:=gridex_utilts_binding.wire_tokens_v1(p_raw);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNB')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNH')<>1 THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 SELECT x INTO unb FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNB';
 SELECT x INTO unh FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNH';
 sender:=nullif(unb#>>'{elements,2,0}',''); application:=nullif(unb#>>'{elements,7,0}',''); interchange:=nullif(unb#>>'{elements,5,0}',''); family:=unh#>>'{elements,2,0}';
 IF sender IS NULL OR application IS NULL OR interchange IS NULL OR char_length(interchange)>14 OR family NOT IN('PRODAT','UTILTS','APERAK','CONTRL') THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 -- Physical directory and association qualify this rule, never row labels or
 -- generic APERAK. National UTILTS APERAK still owns its required BGM/1004.
 prodat_aperak:=coalesce(unh#>'{elements,2}'='["APERAK","D","96A","UN","E2SE6A"]'::jsonb,false);
 IF prodat_aperak AND (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='BGM')<>1 THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 SELECT min(x#>>'{elements,2,0}') INTO legal_sender FROM jsonb_array_elements(tokens) x
  WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'=CASE WHEN family='PRODAT' THEN 'FR' ELSE 'MS' END;
 IF (SELECT count(DISTINCT x#>>'{elements,2,0}') FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'=CASE WHEN family='PRODAT' THEN 'FR' ELSE 'MS' END)>1 THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 legal_sender:=coalesce(nullif(legal_sender,''),sender);
 -- UNB is unique for the technical sender across applications/subaddresses.
 output:=jsonb_build_array(jsonb_build_object('sender',sender,'application','','kind','UNB','value',interchange));
 FOR token IN SELECT x FROM jsonb_array_elements(tokens) x WHERE x->>'tag' IN('UNH','BGM','IDE','RFF') LOOP
  kind:=NULL;value:=NULL;
  CASE token->>'tag'
   WHEN 'UNH' THEN kind:='UNH';value:=token#>>'{elements,1,0}';
   WHEN 'BGM' THEN
    IF prodat_aperak THEN
     IF token#>'{elements,1}' IS DISTINCT FROM '[""]'::jsonb OR token#>'{elements,2}' IS DISTINCT FROM '[""]'::jsonb
      OR (token#>'{elements,3}' IS DISTINCT FROM '["27"]'::jsonb AND token#>'{elements,3}' IS DISTINCT FROM '["34"]'::jsonb)
      OR EXISTS(SELECT FROM jsonb_array_elements(token->'elements') WITH ORDINALITY e(element,n) WHERE e.n>4 AND e.element IS DISTINCT FROM '[""]'::jsonb)
      THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
     -- There is no own document reference to allocate or invent.
    ELSE kind:='BGM';value:=token#>>'{elements,2,0}'; END IF;
   WHEN 'IDE' THEN kind:='IDE';value:=token#>>'{elements,2,0}';
   WHEN 'RFF' THEN
    IF token#>>'{elements,1,0}'='DM' THEN kind:='DM';value:=coalesce(nullif(token#>>'{elements,1,1}',''),token#>>'{elements,2,0}'); END IF;
   ELSE NULL;
  END CASE;
  IF kind IS NOT NULL THEN
   IF nullif(value,'') IS NULL OR char_length(value)>35 THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
   key:=jsonb_build_object('sender',CASE WHEN kind='UNH' THEN sender ELSE legal_sender END,'application',CASE WHEN kind='UNH' THEN interchange ELSE application END,'kind',kind,'value',value);
   IF output @> jsonb_build_array(key) THEN RAISE EXCEPTION 'ediel_wire_reference_duplicate_in_source'; END IF;
   output:=output||jsonb_build_array(key);
  END IF;
 END LOOP;
 RETURN output;
END $$;
-- CREATE OR REPLACE preserves the existing owner and revoked ACLs. Reservation
-- tables, RLS, allocation locks, collision owner and write trigger are unchanged.
COMMIT;
