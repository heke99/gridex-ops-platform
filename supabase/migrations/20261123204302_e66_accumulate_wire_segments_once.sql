-- Apply the E66 month owner and record its migration in the same transaction.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_e66_month_owner$
BEGIN
-- Keep the exact parser contract. Buffer complete segment objects and serialize once.
DO $retain_wire_tokenizer$
DECLARE observed text;
BEGIN
 SELECT md5(prosrc) INTO observed
 FROM pg_catalog.pg_proc
 WHERE oid=to_regprocedure('gridex_utilts_binding.wire_tokens_v1(text)');
 IF observed IS DISTINCT FROM 'ef0637580c08cd5801c95f3d93decd02' THEN
  RAISE EXCEPTION 'utilts_wire_tokenizer_predecessor_changed';
 END IF;
END
$retain_wire_tokenizer$;
CREATE OR REPLACE FUNCTION gridex_utilts_binding.wire_tokens_v1(p_raw text) RETURNS jsonb
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
 IF p_raw IS NULL OR octet_length(p_raw)>8388608 THEN RETURN NULL; END IF;
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
    IF segment_count>=100000 OR line_count>4096 THEN RETURN NULL; END IF;
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
END
$gridex_e66_month_owner$;
RESET statement_timeout;
RESET lock_timeout;
