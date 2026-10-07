-- Rejected-only physical register serialization. This never admits a source,
-- accepts a missing identity or supplies H business/party/point authority.
BEGIN;
CREATE FUNCTION gridex_received_sources.rejected_identity_scope_v1(raw text, object_scope jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb; own jsonb; lin jsonb; cci jsonb; cav jsonb; refs jsonb;
 message_end integer; next_index integer; parent_index integer; party_index integer;
 ordinal integer:=0; reason text; message_reason text; own_li text; selected_li text;
 line_refs text[]:=ARRAY[]::text[]; selected boolean:=false;
BEGIN
 IF raw IS NULL OR jsonb_typeof(object_scope) IS DISTINCT FROM 'object'
  OR object_scope->>'disposition' IS DISTINCT FROM 'rejected'
  OR object_scope->'objectId' IS DISTINCT FROM 'null'::jsonb
  OR object_scope->'messageIndex' IS DISTINCT FROM '0'::jsonb
  OR jsonb_typeof(object_scope->'registers') IS DISTINCT FROM 'array'
  OR jsonb_array_length(object_scope->'registers') IS DISTINCT FROM 1
  OR object_scope#>'{registers,0,registerIndex}' IS DISTINCT FROM 'null'::jsonb
  OR object_scope#>'{registers,0,registerPosition}' IS DISTINCT FROM '1'::jsonb THEN RETURN false; END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(raw);
 IF tokens IS NULL
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')<>1
  OR (SELECT t#>>'{elements,2,0}' FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH') IS DISTINCT FROM 'PRODAT'
  OR (SELECT t#>>'{elements,1,0}' FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH') IS DISTINCT FROM object_scope->>'messageReference'
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM')<>1
  OR (SELECT t#>>'{elements,1,0}' FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM') IS DISTINCT FROM 'Z05'
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='CCI' AND t#>>'{elements,2,0}'='Z13')
   <>(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN')
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNT')<>1 THEN RETURN false; END IF;
 SELECT (t->>'index')::integer INTO message_end FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNT';
 IF (SELECT (t->>'index')::integer FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')
   >=(SELECT (t->>'index')::integer FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM')
  OR (SELECT (t->>'index')::integer FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM')
   >=(SELECT min((t->>'index')::integer) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN') THEN RETURN false; END IF;
 FOR lin IN SELECT t FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN' ORDER BY (t->>'index')::integer LOOP
  ordinal:=ordinal+1;
  IF (lin->>'index')::integer>=message_end OR jsonb_array_length(lin->'elements')>4
   OR jsonb_array_length(lin#>'{elements,1}') IS DISTINCT FROM 1
   OR (lin#>>'{elements,1,0}' ~ '^[0-9]{1,6}$') IS NOT TRUE
   OR (lin#>>'{elements,1,0}')::integer<>ordinal THEN RETURN false; END IF;
  SELECT coalesce(min((t->>'index')::integer),message_end) INTO next_index
   FROM jsonb_array_elements(tokens)t WHERE t->>'tag' IN('LIN','UNT','UNZ') AND (t->>'index')::integer>(lin->>'index')::integer;
  SELECT jsonb_agg(t ORDER BY (t->>'index')::integer) INTO own FROM jsonb_array_elements(tokens)t
   WHERE (t->>'index')::integer>=(lin->>'index')::integer AND (t->>'index')::integer<next_index;
  SELECT min((t->>'index')::integer) INTO parent_index FROM jsonb_array_elements(own)t WHERE t->>'tag' IN('RFF','NAD');
  IF (SELECT count(*) FROM jsonb_array_elements(own)t WHERE t->>'tag'='CCI' AND t#>>'{elements,2,0}'='Z13')<>1 THEN RETURN false; END IF;
  SELECT t INTO cci FROM jsonb_array_elements(own)t WHERE t->>'tag'='CCI' AND t#>>'{elements,2,0}'='Z13';
  SELECT t INTO cav FROM jsonb_array_elements(own)t WHERE t->>'tag'='CAV' AND (t->>'index')::integer=(cci->>'index')::integer+1;
  IF cav IS NULL OR (parent_index IS NOT NULL AND (cci->>'index')::integer>=parent_index)
   OR jsonb_array_length(cci->'elements')<>3 OR jsonb_array_length(cci#>'{elements,2}')<>1
   OR EXISTS(SELECT FROM jsonb_array_elements(cci#>'{elements,1}')v WHERE v#>>'{}'<>'')
   OR jsonb_array_length(cav->'elements')<>2 OR jsonb_array_length(cav#>'{elements,1}')<>1
   OR EXISTS(SELECT FROM jsonb_array_elements(own)t WHERE t->>'tag'='CAV' AND (t->>'index')::integer=(cav->>'index')::integer+1)
   OR coalesce(cav#>>'{elements,1,0}','') NOT IN('Z25','Z22') THEN RETURN false; END IF;
  reason:=cav#>>'{elements,1,0}';
  IF message_reason IS NOT NULL AND reason<>message_reason THEN RETURN false; END IF;
  message_reason:=reason;
  SELECT min((t->>'index')::integer) INTO party_index FROM jsonb_array_elements(own)t WHERE t->>'tag'='NAD';
  SELECT jsonb_agg(t) INTO refs FROM jsonb_array_elements(own)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='LI'
   AND (party_index IS NULL OR (t->>'index')::integer<party_index);
  own_li:=NULL;
  IF jsonb_array_length(refs)=1 AND jsonb_array_length(refs#>'{0,elements,1}')=2
   AND char_length(refs#>>'{0,elements,1,1}') BETWEEN 1 AND 128
   AND refs#>>'{0,elements,1,1}'=btrim(refs#>>'{0,elements,1,1}')
   AND refs#>>'{0,elements,1,1}' !~ '[[:cntrl:]]' THEN own_li:=refs#>>'{0,elements,1,1}'; END IF;
  line_refs:=array_append(line_refs,own_li);
  IF lin->'index'=object_scope#>'{registers,0,segmentIndex}' THEN
   IF nullif(lin#>>'{elements,3,0}','') IS NOT NULL
    OR to_jsonb(nullif(lin#>>'{elements,3,3}','')) IS DISTINCT FROM nullif(object_scope->'identityAgency','null'::jsonb)
    OR object_scope#>'{registers,0,lineIndex}' IS DISTINCT FROM to_jsonb(ordinal-1)
    OR object_scope#>>'{registers,0,lineNumber}' IS DISTINCT FROM lin#>>'{elements,1,0}'
    OR own_li IS NULL THEN RETURN false; END IF;
   selected:=true; selected_li:=own_li;
  END IF;
 END LOOP;
 RETURN selected AND selected_li IS NOT NULL AND (SELECT count(*) FROM unnest(line_refs)r WHERE r=selected_li)=1;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.rejected_identity_scope_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $$DECLARE definition text; prior_body text; old text; replacement text; BEGIN
 prior_body:=(SELECT prosrc FROM pg_proc WHERE oid='gridex_received_sources.append_validation_before_reference_profile_v1(uuid,text,uuid,text,text)'::regprocedure);
 old:=$old$(obj->>'disposition'='accepted' AND gridex_received_sources.identity_omission_scope_v1(src.raw_payload,obj))$old$;
 replacement:=$new$((obj->>'disposition'='accepted' AND gridex_received_sources.identity_omission_scope_v1(src.raw_payload,obj)) OR (obj->>'disposition'='rejected' AND gridex_received_sources.rejected_identity_scope_v1(src.raw_payload,obj) IS TRUE))$new$;
 IF encode(sha256(convert_to(prior_body,'UTF8')),'hex') IS DISTINCT FROM '1139e0b60dac82ed9c3c3d744eb7d3bcffb0253ebd800429ff8809d46eba3348'
  OR (length(prior_body)-length(replace(prior_body,old,'')))/length(old)<>1 THEN
  RAISE EXCEPTION 'rejected_identity_append_owner_changed' USING ERRCODE='23514'; END IF;
 definition:=pg_get_functiondef('gridex_received_sources.append_validation_before_reference_profile_v1(uuid,text,uuid,text,text)'::regprocedure);
 EXECUTE replace(definition,old,replacement);
 IF replace((SELECT prosrc FROM pg_proc WHERE oid='gridex_received_sources.append_validation_before_reference_profile_v1(uuid,text,uuid,text,text)'::regprocedure),replacement,old) IS DISTINCT FROM prior_body THEN
  RAISE EXCEPTION 'rejected_identity_append_inverse_changed' USING ERRCODE='23514'; END IF;
END $$;
COMMIT;
