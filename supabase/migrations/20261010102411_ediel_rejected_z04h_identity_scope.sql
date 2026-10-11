-- Rejected-only physical H209 serialization. No source birth/admission changes.
BEGIN;
-- Original pre-trim spelling of the selected segment. Release-aware scanning
-- matches the actual TS tokenizer's CR/LF normalization and index partition.
-- This pure observation grants no source, legal, ACK or business authority.
CREATE FUNCTION gridex_received_sources.rejected_z04h_raw_segment_v1(raw text,wanted integer)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE body text;ch text;current text:='';released boolean:=false;idx integer:=0;
 release_char text:=CASE WHEN left(raw,3)='UNA' THEN substr(raw,7,1) ELSE '?' END;
 terminator text:=CASE WHEN left(raw,3)='UNA' THEN substr(raw,9,1) ELSE '''' END;
BEGIN
 IF raw IS NULL OR octet_length(raw)>262144 OR wanted NOT BETWEEN 0 AND 4095 THEN RETURN NULL;END IF;
 body:=CASE WHEN left(raw,3)='UNA' THEN substr(raw,10) ELSE raw END;
 body:=replace(replace(body,E'\r\n',''),E'\n','');
 FOREACH ch IN ARRAY string_to_array(body,NULL) LOOP
  IF released THEN current:=current||ch;released:=false;
  ELSIF ch=release_char THEN current:=current||ch;released:=true;
  ELSIF ch=terminator THEN
   IF btrim(current,E' \t')<>'' THEN
    IF idx=wanted THEN RETURN current;END IF;
    idx:=idx+1;
   END IF;current:='';
  ELSE current:=current||ch;END IF;
 END LOOP;
 RETURN NULL;
END $$;
-- Pure rejected-only original Z04 H serialization. No source/admission grant.
CREATE FUNCTION gridex_received_sources.rejected_z04h_identity_scope_v1(raw text, object_scope jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb;lin jsonb;cci jsonb;cav jsonb;unb jsonb;unh jsonb;bgm jsonb;own_li text;party integer;n integer;data_sep text:=CASE WHEN left(raw,3)='UNA' THEN substr(raw,5,1) ELSE '+' END;component_sep text:=CASE WHEN left(raw,3)='UNA' THEN substr(raw,4,1) ELSE ':' END;
BEGIN
 IF raw IS NULL OR octet_length(raw)>262144 OR jsonb_typeof(object_scope) IS DISTINCT FROM 'object'
  OR object_scope->>'disposition' IS DISTINCT FROM 'rejected' OR object_scope->'objectId' IS DISTINCT FROM 'null'::jsonb
  OR object_scope->'messageIndex' IS DISTINCT FROM '0'::jsonb
  OR jsonb_typeof(object_scope->'registers') IS DISTINCT FROM 'array' OR jsonb_array_length(object_scope->'registers')<>1
  OR object_scope#>'{registers,0,lineIndex}' IS DISTINCT FROM '0'::jsonb
  OR object_scope#>'{registers,0,registerIndex}' IS DISTINCT FROM 'null'::jsonb
  OR object_scope#>'{registers,0,registerPosition}' IS DISTINCT FROM '1'::jsonb
  OR object_scope#>>'{registers,0,lineNumber}' IS DISTINCT FROM '1' THEN RETURN false;END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(raw);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNT')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='CCI' AND upper(btrim(t#>>'{elements,2,0}'))='Z13')<>1 THEN RETURN false;END IF;
 SELECT t INTO unb FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB';
 SELECT t INTO unh FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH';
 SELECT t INTO bgm FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 SELECT t INTO lin FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN';
 SELECT t INTO cci FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='CCI' AND t#>>'{elements,2,0}'='Z13';
 SELECT t INTO cav FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='CAV' AND (t->>'index')::integer=(cci->>'index')::integer+1;
 IF unb#>'{elements,7}' IS DISTINCT FROM '["23-DDQ-PRODAT"]'::jsonb
  OR unh#>'{elements,2}' IS DISTINCT FROM '["PRODAT","D","97A","UN","E2SE6A"]'::jsonb
  OR unh#>>'{elements,1,0}' IS DISTINCT FROM object_scope->>'messageReference'
  OR bgm#>'{elements,1}' IS DISTINCT FROM '["Z04"]'::jsonb OR (bgm->>'index')::integer>=(lin->>'index')::integer
  OR lin->'index' IS DISTINCT FROM object_scope#>'{registers,0,segmentIndex}'
  OR jsonb_array_length(lin->'elements')<>4 OR lin#>'{elements,1}' IS DISTINCT FROM '["1"]'::jsonb
  OR jsonb_array_length(lin#>'{elements,3}')<>4 OR lin#>'{elements,3,0}' IS DISTINCT FROM '""'::jsonb
  OR lin#>'{elements,3,1}' IS DISTINCT FROM '""'::jsonb OR lin#>'{elements,3,2}' IS DISTINCT FROM '""'::jsonb
  OR (lin#>>'{elements,3,3}' IN('9','89')) IS NOT TRUE
  OR to_jsonb(lin#>>'{elements,3,3}') IS DISTINCT FROM object_scope->'identityAgency'
  OR cci IS NULL OR cav IS NULL OR jsonb_array_length(cci->'elements')<>3
  OR cci#>'{elements,1}' IS DISTINCT FROM '[""]'::jsonb OR cci#>'{elements,2}' IS DISTINCT FROM '["Z13"]'::jsonb
  OR jsonb_array_length(cav->'elements')<>2 OR jsonb_array_length(cav#>'{elements,1}') NOT BETWEEN 1 AND 5
  OR cav#>>'{elements,1,0}' IS DISTINCT FROM 'Z25'
  OR EXISTS(SELECT FROM jsonb_array_elements(cav#>'{elements,1}')WITH ORDINALITY v(value,ord) WHERE ord>1 AND value IS DISTINCT FROM '""'::jsonb)
  OR gridex_received_sources.rejected_z04h_raw_segment_v1(raw,(cci->>'index')::integer) IS DISTINCT FROM 'CCI'||data_sep||data_sep||'Z13'
  OR gridex_received_sources.rejected_z04h_raw_segment_v1(raw,(cav->>'index')::integer) IS DISTINCT FROM 'CAV'||data_sep||'Z25'||repeat(component_sep,jsonb_array_length(cav#>'{elements,1}')-1)
  OR (cci->>'index')::integer<=(lin->>'index')::integer
  OR EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='CAV' AND (t->>'index')::integer=(cav->>'index')::integer+1)
 THEN RETURN false;END IF;
 SELECT min((t->>'index')::integer) INTO party FROM jsonb_array_elements(tokens)t WHERE t->>'tag' IN('NAD','RFF') AND (t->>'index')::integer>(lin->>'index')::integer;
 IF party IS NOT NULL AND (cci->>'index')::integer>=party THEN RETURN false;END IF;
 SELECT min((t->>'index')::integer) INTO party FROM jsonb_array_elements(tokens)t WHERE t->>'tag' IN('NAD','UNT') AND (t->>'index')::integer>(lin->>'index')::integer;
 SELECT count(*),min(t#>>'{elements,1,1}') INTO n,own_li FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF'
  AND t#>>'{elements,1,0}'='LI' AND (t->>'index')::integer>(lin->>'index')::integer AND (t->>'index')::integer<party
  AND jsonb_array_length(t->'elements')=2 AND jsonb_array_length(t#>'{elements,1}')=2;
 IF n<>1 OR own_li IS NULL OR length(own_li) NOT BETWEEN 1 AND 128 OR own_li<>btrim(own_li) OR own_li~'[[:cntrl:]]'
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='LI')<>1 THEN RETURN false;END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

REVOKE ALL ON FUNCTION gridex_received_sources.rejected_z04h_raw_segment_v1(text,integer),gridex_received_sources.rejected_z04h_identity_scope_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $$DECLARE definition text;prior_body text;old text;replacement text;BEGIN
 prior_body:=(SELECT prosrc FROM pg_proc WHERE oid='gridex_received_sources.append_validation_before_reference_profile_v1(uuid,text,uuid,text,text)'::regprocedure);
 old:=$old$(obj->>'disposition'='rejected' AND gridex_received_sources.rejected_identity_scope_v1(src.raw_payload,obj) IS TRUE)$old$;
 replacement:=$new$(obj->>'disposition'='rejected' AND (gridex_received_sources.rejected_identity_scope_v1(src.raw_payload,obj) IS TRUE OR gridex_received_sources.rejected_z04h_identity_scope_v1(src.raw_payload,obj) IS TRUE))$new$;
 IF encode(sha256(convert_to(prior_body,'UTF8')),'hex') IS DISTINCT FROM 'f487a3c60c8c0bdfe0be3786d50662ea7d3abb6df8214be573f9d76a176ca6bf'
  OR (length(prior_body)-length(replace(prior_body,old,'')))/length(old)<>1 THEN
  RAISE EXCEPTION 'rejected_z04h_identity_append_owner_changed' USING ERRCODE='23514';END IF;
 definition:=pg_get_functiondef('gridex_received_sources.append_validation_before_reference_profile_v1(uuid,text,uuid,text,text)'::regprocedure);
 EXECUTE replace(definition,old,replacement);
 IF replace((SELECT prosrc FROM pg_proc WHERE oid='gridex_received_sources.append_validation_before_reference_profile_v1(uuid,text,uuid,text,text)'::regprocedure),replacement,old) IS DISTINCT FROM prior_body THEN
  RAISE EXCEPTION 'rejected_z04h_identity_append_inverse_changed' USING ERRCODE='23514';END IF;
END $$;
COMMIT;
