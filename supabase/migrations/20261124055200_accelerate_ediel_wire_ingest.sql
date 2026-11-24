-- Preserve wire contracts while reducing the work done by normal inbound INSERT triggers.
SET lock_timeout = '5s';
SET statement_timeout = '30s';
DO $gridex_ediel_wire_ingest$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('gridex_received_sources.wire_tokens_bounded_v1(text,integer)'))
  IS DISTINCT FROM 'c90c433eda52f9f267fe7c95519b57b0' THEN
  RAISE EXCEPTION 'ediel_bounded_wire_tokenizer_predecessor_changed';
 END IF;
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('gridex_ediel_technical_ack.envelope(text)'))
  IS DISTINCT FROM 'b4debb471635ff47d9a11ccb795eec7c' THEN
  RAISE EXCEPTION 'ediel_technical_envelope_framer_predecessor_changed';
 END IF;

-- Accumulate completed bounded tokens without repeatedly rebuilding their JSONB array.
CREATE OR REPLACE FUNCTION gridex_received_sources.wire_tokens_bounded_v1(p_raw text, p_max_lines integer) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $_$
DECLARE
 component_sep text:=':'; data_sep text:='+'; release_char text:='?'; terminator text:='''';
 decimal_mark text:='.'; reserved text:=' '; body text; ch text; chars text[];
 released boolean:=false; current_component text:=''; current_element jsonb:='[]'; elements jsonb:='[]';
 result jsonb[]:=ARRAY[]::jsonb[]; tag text; segment_count integer:=0; line_count integer:=0;
 component_size integer:=0; component_count integer:=0; element_count integer:=0;
BEGIN
 IF (p_max_lines BETWEEN 1 AND 999999) IS NOT TRUE OR p_raw IS NULL OR octet_length(p_raw)>262144 THEN RETURN NULL; END IF;
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
    IF segment_count>=4096 OR line_count>p_max_lines THEN RETURN NULL; END IF;
    result:=array_append(result,jsonb_build_object('index',segment_count,'tag',tag,'elements',elements));
    segment_count:=segment_count+1;elements:='[]';element_count:=0;
   END IF;
  ELSE current_component:=current_component||ch;component_size:=component_size+1;
  END IF;
  IF component_size>4096 THEN RETURN NULL; END IF;
 END LOOP;
 IF released OR current_component<>'' OR elements<>'[]'::jsonb OR current_element<>'[]'::jsonb THEN RETURN NULL; END IF;
 RETURN to_jsonb(result);
END $_$;

-- Walk the same characters and slice between UTF-8 byte offsets at segment boundaries.
CREATE OR REPLACE FUNCTION gridex_ediel_technical_ack.envelope(p_raw text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE advice text:='';body text;body_bytes bytea;character_bytes integer;sep text:='+';release_char text:='?';terminator text:='''';chars text[];ch text;released boolean:=false;segment_start integer:=1;position integer:=0;segment_raw text;tokens jsonb;u jsonb;unbs integer:=0;header text;ref text;indicator text;
BEGIN
 IF p_raw IS NULL OR octet_length(p_raw)>8388608 THEN RETURN NULL;END IF;
 body:=p_raw;
 IF upper(left(body,3))='UNA' THEN
  IF left(body,3)<>'UNA' OR length(body)<9 THEN RETURN NULL;END IF;
  advice:=left(body,9);sep:=substr(body,5,1);release_char:=substr(body,7,1);terminator:=substr(body,9,1);body:=substr(body,10);
 END IF;
 -- Framing only. Each complete segment is decoded by the existing one-owner
 -- v2 lexer; incomplete/error-bearing body data is never a parsed business AST.
 body:=replace(replace(body,E'\r\n',''),E'\n','');chars:=string_to_array(body,NULL);body_bytes:=convert_to(body,'UTF8');
 FOREACH ch IN ARRAY chars LOOP
  character_bytes:=octet_length(convert_to(ch,'UTF8'));position:=position+character_bytes;
  IF released THEN released:=false;CONTINUE;END IF;
  IF ch=release_char THEN released:=true;CONTINUE;END IF;
  IF ch<>terminator THEN CONTINUE;END IF;
  segment_raw:=convert_from(substr(body_bytes,segment_start,position-segment_start+1-character_bytes),'UTF8');segment_start:=position+1;
  IF nullif(btrim(segment_raw,E' \t'),'') IS NULL THEN CONTINUE;END IF;
  IF u IS NULL AND left(ltrim(segment_raw,E' \t'),4) IS DISTINCT FROM 'UNB'||sep THEN RETURN NULL;END IF;
  IF left(ltrim(segment_raw,E' \t'),4)='UNB'||sep THEN
   unbs:=unbs+1;IF unbs<>1 THEN RETURN NULL;END IF;
   header:=advice||segment_raw||terminator;tokens:=gridex_utilts_binding.wire_tokens_v1(header);
   IF tokens IS NULL OR jsonb_array_length(tokens)<>1 OR tokens#>>'{0,tag}'<>'UNB'
    OR EXISTS(SELECT FROM unnest(string_to_array(header,NULL))c WHERE ascii(c)>255 OR ascii(c)<32) THEN RETURN NULL;END IF;
   u:=tokens#>'{0,elements}';
  ELSIF left(ltrim(segment_raw,E' \t'),4)='UNH'||sep THEN
   tokens:=gridex_utilts_binding.wire_tokens_v1(advice||segment_raw||terminator);
   IF tokens#>>'{0,elements,2,0}'='CONTRL' THEN RETURN NULL;END IF;
  END IF;
 END LOOP;
 -- A second header beginning an incomplete tail is also ambiguous, not an
 -- excuse to copy the first one. Missing/unterminated first UNB stays held.
 IF u IS NULL OR unbs<>1 OR left(ltrim(convert_from(substr(body_bytes,segment_start),'UTF8'),E' \t'),4)='UNB'||sep THEN RETURN NULL;END IF;
 ref:=u#>>'{5,0}';indicator:=coalesce(u#>>'{11,0}','');
 IF nullif(ref,'') IS NULL OR length(ref)>512 OR ref~'[[:cntrl:]]' OR jsonb_array_length(u->5)<>1
  OR nullif(u#>>'{2,0}','') IS NULL OR nullif(u#>>'{3,0}','') IS NULL OR jsonb_array_length(u->2)>3 OR jsonb_array_length(u->3)>3
  OR EXISTS(SELECT FROM jsonb_array_elements_text(u->2||u->3)c WHERE length(c)>35)
  OR coalesce(jsonb_array_length(u->7),1)<>1 OR coalesce(jsonb_array_length(u->11),1)<>1 OR indicator NOT IN('','1') THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('sender',u->2,'receiver',u->3,'interchangeReference',ref,'uciReference',left(ref,14),
  'applicationReference',coalesce(u#>>'{7,0}',''),'environment',CASE WHEN indicator='1' THEN 'test' ELSE 'production' END,'testIndicator',indicator);
END $$;

 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('gridex_received_sources.wire_tokens_bounded_v1(text,integer)'))
  IS DISTINCT FROM 'f449d6789e7509ed8db56a739029ff58' THEN
  RAISE EXCEPTION 'ediel_bounded_wire_tokenizer_postcondition_mismatch';
 END IF;
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('gridex_ediel_technical_ack.envelope(text)'))
  IS DISTINCT FROM '5e5b376dd5afaa06e3fc7f16207b14c8' THEN
  RAISE EXCEPTION 'ediel_technical_envelope_framer_postcondition_mismatch';
 END IF;
END
$gridex_ediel_wire_ingest$;
RESET statement_timeout;
RESET lock_timeout;
