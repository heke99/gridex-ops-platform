-- Private bounded evidence parser. This checkpoint does NOT enable closure
-- approval. The closure owner must invoke this against sources.raw_payload in
-- its append-time statement; a caller-supplied original is never authority.
BEGIN;
CREATE FUNCTION gridex_received_sources.closure_wire_tokens_v1(p_raw text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE
 component_sep text:=':'; data_sep text:='+'; release_char text:='?'; terminator text:='''';
 decimal_mark text:='.'; reserved text:=' '; body text; ch text; chars text[];
 released boolean:=false; current_component text:=''; current_element jsonb:='[]'; elements jsonb:='[]';
 result jsonb:='[]'; tag text; segment_count integer:=0; line_count integer:=0;
 component_size integer:=0; component_count integer:=0; element_count integer:=0;
BEGIN
 IF p_raw IS NULL OR octet_length(p_raw)>262144 THEN RETURN NULL; END IF;
 -- Read advice before CRLF/LF normalization. No inferred repetition grammar.
 body:=p_raw;
 IF upper(left(body,3))='UNA' THEN
  IF left(body,3)<>'UNA' OR char_length(body)<9 THEN RETURN NULL; END IF;
  component_sep:=substr(body,4,1);data_sep:=substr(body,5,1);decimal_mark:=substr(body,6,1);
  release_char:=substr(body,7,1);reserved:=substr(body,8,1);terminator:=substr(body,9,1);body:=substr(body,10);
 END IF;
 IF reserved<>' ' OR decimal_mark NOT IN ('.',',')
 OR decimal_mark=ANY(ARRAY[component_sep,data_sep,release_char,terminator])
 OR (SELECT count(DISTINCT value) FROM unnest(ARRAY[component_sep,data_sep,release_char,terminator]) value)<>4
 OR EXISTS(SELECT FROM unnest(ARRAY[component_sep,data_sep,release_char,terminator]) value
   WHERE ascii(value)<33 OR ascii(value)>126 OR value ~ '[A-Za-z0-9]') THEN RETURN NULL; END IF;
 body:=replace(replace(body,E'\r\n',''),E'\n','');
 IF strpos(body,E'\r')>0 OR right(body,1)<>terminator THEN RETURN NULL; END IF;
 -- NULL delimiter enumerates code points, NOT segments/elements. Exactly one
 -- state machine consumes these; decoded literals are never split again.
 chars:=string_to_array(body,NULL);
 FOREACH ch IN ARRAY chars LOOP
  IF released THEN
   current_component:=current_component||ch;component_size:=component_size+1;released:=false;
  ELSIF ch=release_char THEN released:=true;
  ELSIF ch=component_sep OR ch=data_sep OR ch=terminator THEN
   -- Match canonical leading segment trim. Other whitespace forms are held
   -- explicitly; in particular a released trailing space must not be trimmed.
   IF elements='[]'::jsonb AND current_element='[]'::jsonb THEN current_component:=ltrim(current_component,E' \t'); END IF;
   IF ch=terminator AND current_component<>rtrim(current_component,E' \t') THEN RETURN NULL; END IF;
   IF ch=terminator AND elements='[]'::jsonb AND current_element='[]'::jsonb AND current_component='' THEN CONTINUE; END IF;
   current_element:=current_element||jsonb_build_array(current_component);component_count:=component_count+1;
   current_component:='';component_size:=0;
   IF component_count>128 THEN RETURN NULL; END IF;
   IF ch<>component_sep THEN
    elements:=elements||jsonb_build_array(current_element);element_count:=element_count+1;
    current_element:='[]';component_count:=0;
    IF element_count>128 THEN RETURN NULL; END IF;
   END IF;
   IF ch=terminator THEN
    tag:=elements#>>'{0,0}';
    IF jsonb_array_length(elements->0)<>1 OR tag !~ '^[A-Z]{3}$' OR tag='UNA' THEN RETURN NULL; END IF;
    IF tag='LIN' THEN line_count:=line_count+1; END IF;
    IF segment_count>=4096 OR line_count>16 THEN RETURN NULL; END IF;
    result:=result||jsonb_build_array(jsonb_build_object('index',segment_count,'tag',tag,'elements',elements));
    segment_count:=segment_count+1;elements:='[]';element_count:=0;
   END IF;
  ELSE current_component:=current_component||ch;component_size:=component_size+1;
  END IF;
  IF component_size>4096 THEN RETURN NULL; END IF;
 END LOOP;
 IF released OR current_component<>'' OR elements<>'[]'::jsonb OR current_element<>'[]'::jsonb THEN RETURN NULL; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.closure_wire_tokens_v1(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_received_sources.closure_wire_projection_v1(p_raw text,p_object jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE
 tokens jsonb:=gridex_received_sources.closure_wire_tokens_v1(p_raw); token jsonb; e jsonb;
 unb jsonb; unh jsonb; unt jsonb; unz jsonb; bgm jsonb; fr jsonb; receiver jsonb; zone jsonb;
 n integer; first_line integer; stop_index integer; chosen_index integer; next_line integer;
 line_index integer:=0; object_value jsonb; selected_object jsonb; identities jsonb:='[]'; identity_value jsonb;
 selected_date jsonb; selected_reason jsonb; selected_reference jsonb; common_end integer; reference_end integer;
 date_count integer:=0; reason_count integer:=0; reference_count integer:=0;
 reason text; minute text; market_time timestamp; utc_value timestamptz; tag_name text;
BEGIN
 IF tokens IS NULL OR jsonb_typeof(p_object) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
 n:=jsonb_array_length(tokens);
 IF n<8 THEN RETURN NULL; END IF;
 FOREACH tag_name IN ARRAY ARRAY['UNB','UNH','UNT','UNZ','BGM'] LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'=tag_name)<>1 THEN RETURN NULL; END IF;
 END LOOP;
 unb:=tokens->0;unh:=tokens->1;unt:=tokens->(n-2);unz:=tokens->(n-1);
 SELECT t INTO bgm FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM';
 SELECT min((t->>'index')::integer) INTO first_line FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN';
 IF first_line IS NULL OR unb->>'tag'<>'UNB' OR unh->>'tag'<>'UNH' OR unt->>'tag'<>'UNT' OR unz->>'tag'<>'UNZ'
 OR (bgm->>'index')::integer<=1 OR (bgm->>'index')::integer>=first_line
 OR unb#>>'{elements,1,1}' IS DISTINCT FROM '3' OR unh#>>'{elements,2,0}' IS DISTINCT FROM 'PRODAT'
 OR jsonb_array_length(unh#>'{elements,1}') IS DISTINCT FROM 1 OR nullif(unh#>>'{elements,1,0}','') IS NULL
 OR unt#>'{elements,2}' IS DISTINCT FROM unh#>'{elements,1}'
 OR unt#>'{elements,1}' IS DISTINCT FROM jsonb_build_array((n-2)::text)
 OR unz#>'{elements,1}' IS DISTINCT FROM '["1"]'::jsonb
 OR jsonb_array_length(unb#>'{elements,5}') IS DISTINCT FROM 1 OR nullif(unb#>>'{elements,5,0}','') IS NULL
 OR unz#>'{elements,2}' IS DISTINCT FROM unb#>'{elements,5}'
 OR bgm#>'{elements,1}' IS DISTINCT FROM '["Z05"]'::jsonb
 OR jsonb_array_length(bgm#>'{elements,2}') IS DISTINCT FROM 1 OR nullif(bgm#>>'{elements,2,0}','') IS NULL
 OR coalesce(bgm#>'{elements,3}','[""]'::jsonb) NOT IN ('["9"]'::jsonb,'[""]'::jsonb) THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::int<first_line AND t->>'tag'='NAD' AND t#>'{elements,1}'='["FR"]'::jsonb)<>1
 OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::int<first_line AND t->>'tag'='NAD' AND t#>'{elements,1}'='["DO"]'::jsonb)<>1
 OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::int<first_line AND t->>'tag'='DTM' AND t#>>'{elements,1,0}'='ZZZ')<>1 THEN RETURN NULL; END IF;
 SELECT t->'elements' INTO fr FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::int<first_line AND t->>'tag'='NAD' AND t#>'{elements,1}'='["FR"]'::jsonb;
 SELECT t->'elements' INTO receiver FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::int<first_line AND t->>'tag'='NAD' AND t#>'{elements,1}'='["DO"]'::jsonb;
 SELECT t#>'{elements,1}' INTO zone FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::int<first_line AND t->>'tag'='DTM' AND t#>>'{elements,1,0}'='ZZZ';
 IF zone IS DISTINCT FROM '["ZZZ","1","805"]'::jsonb
 OR jsonb_array_length(fr->2) IS DISTINCT FROM 3 OR jsonb_array_length(receiver->2) IS DISTINCT FROM 3
 OR fr#>>'{2,1}' IS DISTINCT FROM '160' OR fr#>>'{2,2}' IS DISTINCT FROM 'SVK'
 OR receiver#>>'{2,1}' IS DISTINCT FROM '160' OR receiver#>>'{2,2}' IS DISTINCT FROM 'SVK'
 OR nullif(fr#>>'{2,0}','') IS NULL OR fr#>>'{2,0}'<>btrim(fr#>>'{2,0}')
 OR nullif(receiver#>>'{2,0}','') IS NULL OR receiver#>>'{2,0}'<>btrim(receiver#>>'{2,0}')
 OR jsonb_array_length(unb#>'{elements,2}') IS DISTINCT FROM 2 OR jsonb_array_length(unb#>'{elements,3}') IS DISTINCT FROM 2
 OR unb#>>'{elements,2,0}' IS DISTINCT FROM fr#>>'{2,0}'
 OR unb#>>'{elements,2,1}' NOT IN ('14','ZZ') OR unb#>>'{elements,3,1}' NOT IN ('14','ZZ')
 OR nullif(unb#>>'{elements,3,0}','') IS NULL OR unb#>>'{elements,3,0}'<>btrim(unb#>>'{elements,3,0}') THEN RETURN NULL; END IF;
 -- Enumerate and validate EVERY physical LIN before matching caller scope.
 -- No caller offset or object ID selects an alleged segment as authority.
 FOR token IN SELECT t FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' ORDER BY (t->>'index')::integer LOOP
  e:=token->'elements';stop_index:=(token->>'index')::integer;
  IF stop_index<=1 OR stop_index>=n-2 OR jsonb_array_length(e)<>4
  OR e->1 IS DISTINCT FROM jsonb_build_array((line_index+1)::text)
  OR jsonb_array_length(e->3) IS DISTINCT FROM 4 OR nullif(e#>>'{3,0}','') IS NULL
  OR e#>>'{3,3}' IS DISTINCT FROM '9' OR e#>>'{3,1}' IS DISTINCT FROM '' OR e#>>'{3,2}' IS DISTINCT FROM ''
  THEN RETURN NULL; END IF;
  identity_value:=jsonb_build_array(e#>>'{3,0}',e#>>'{3,3}');
  IF identities @> jsonb_build_array(identity_value) THEN RETURN NULL; END IF;
  identities:=identities||jsonb_build_array(identity_value);
  object_value:=jsonb_build_object('messageIndex',0,'messageReference',unh#>>'{elements,1,0}',
    'objectId',e#>>'{3,0}','identityAgency',e#>>'{3,3}','registers',jsonb_build_array(jsonb_build_object(
      'lineIndex',line_index,'lineNumber',e#>>'{1,0}','registerIndex',NULL,'registerPosition',1,'segmentIndex',stop_index)));
  IF object_value=p_object THEN selected_object:=object_value;chosen_index:=stop_index; END IF;
  line_index:=line_index+1;
 END LOOP;
 IF selected_object IS NULL THEN RETURN NULL; END IF;
 SELECT min((t->>'index')::integer) INTO next_line FROM jsonb_array_elements(tokens) t
 WHERE (t->>'index')::integer>chosen_index AND t->>'tag' IN ('LIN','UNT');
 SELECT coalesce(min((t->>'index')::integer),next_line) INTO common_end FROM jsonb_array_elements(tokens) t
 WHERE (t->>'index')::integer>chosen_index AND (t->>'index')::integer<next_line AND t->>'tag' IN ('RFF','NAD');
 SELECT coalesce(min((t->>'index')::integer),next_line) INTO reference_end FROM jsonb_array_elements(tokens) t
 WHERE (t->>'index')::integer>chosen_index AND (t->>'index')::integer<next_line AND t->>'tag'='NAD';
 FOR token IN SELECT t FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::integer>chosen_index AND (t->>'index')::integer<next_line LOOP
  e:=token->'elements';stop_index:=(token->>'index')::integer;
  IF stop_index<common_end AND token->>'tag'='DTM' AND e#>>'{1,0}'='93' THEN
   date_count:=date_count+1;selected_date:=e->1;
  END IF;
  IF stop_index<common_end AND token->>'tag'='CCI' AND e#>'{2}'='["Z13"]'::jsonb THEN
   reason_count:=reason_count+1;
   IF stop_index+1>=common_end OR tokens->(stop_index+1)->>'tag'<>'CAV' THEN RETURN NULL; END IF;
   selected_reason:=tokens->(stop_index+1)#>'{elements,1}';
  END IF;
  IF stop_index<reference_end AND token->>'tag'='RFF' AND e#>>'{1,0}'='LI' THEN
   reference_count:=reference_count+1;selected_reference:=e->1;
  END IF;
 END LOOP;
 IF date_count<>1 OR reason_count<>1 OR reference_count<>1 OR jsonb_array_length(selected_date) IS DISTINCT FROM 3
 OR selected_date->>2 IS DISTINCT FROM '203' OR jsonb_array_length(selected_reason) IS DISTINCT FROM 1
 OR selected_reason NOT IN ('["Z22"]'::jsonb,'["Z23"]'::jsonb)
 OR jsonb_array_length(selected_reference) IS DISTINCT FROM 2 OR nullif(selected_reference->>1,'') IS NULL THEN RETURN NULL; END IF;
 minute:=selected_date->>1;reason:=selected_reason->>0;
 IF minute IS NULL OR minute !~ '^[0-9]{12}$' OR substring(minute,1,4)::int<1 OR substring(minute,9,2)::int>23 OR substring(minute,11,2)::int>59 THEN RETURN NULL; END IF;
 market_time:=make_timestamp(substring(minute,1,4)::int,substring(minute,5,2)::int,substring(minute,7,2)::int,substring(minute,9,2)::int,substring(minute,11,2)::int,0);
 utc_value:=market_time AT TIME ZONE 'Etc/GMT-1';
 IF NOT isfinite(utc_value) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('object',selected_object,'messageCode','Z05','subtype',CASE reason WHEN 'Z22' THEN 'L' ELSE 'LK' END,'reason',reason,
  'functionCode',nullif(bgm#>>'{elements,3,0}',''),'documentReference',bgm#>>'{elements,2,0}','caseReference',selected_reference->>1,
  'effectiveTo',jsonb_build_object('fieldNumber','211','marketMinute',minute,'utc',to_char(utc_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  'legalSender',fr#>>'{2,0}','legalReceiver',receiver#>>'{2,0}',
  'transportSender',unb#>>'{elements,2,0}','transportReceiver',unb#>>'{elements,3,0}',
  'transportSenderQualifier',unb#>>'{elements,2,1}','transportReceiverQualifier',unb#>>'{elements,3,1}');
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.closure_wire_projection_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_received_sources.closure_wire_matches_v1(p_raw text,p_object jsonb,p_wire jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(gridex_received_sources.closure_wire_projection_v1(p_raw,p_object)=p_wire,false)
$$;
REVOKE ALL ON FUNCTION gridex_received_sources.closure_wire_matches_v1(text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
