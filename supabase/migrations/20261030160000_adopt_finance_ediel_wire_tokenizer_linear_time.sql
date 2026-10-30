-- Adopted from finance (simulation T1 finding 010), placeholder version 20261030160000 (GEN assigns the final one).
-- Source: c400f6959d8c279fb518b7199fe6e77da30409c4:supabase/migrations/20261020120000_ediel_wire_tokenizer_linear_time.sql
--   (source file sha256 be403a83e8f240e4a7d97797017ea8f246f28e66c45018d9e5c5d92e618f9334).
-- Adopted verbatim: the source header and the CREATE OR REPLACE statements of wire_tokens_v1,
-- wire_tokens_bounded_v1 and envelope (prosrc sha256 main -> finance):
--   gridex_utilts_binding.wire_tokens_v1(text)                   fb9e5630...c3bf -> 41821a488c2086917ce6b73319720d13215f623983a8a4ba52b405a9177a3f4f
--   gridex_received_sources.wire_tokens_bounded_v1(text,integer) db791657...eeb  -> 3fcc2253a8fbf670080eec0179ea8857b0f959c7551933dbb09f410b2929333e
--   gridex_ediel_technical_ack.envelope(text)                    799a7375...369c -> cb1ee6eda31ddc0665d2f9e528bf1ab2c8d573237b138630d03aa2e1dbf82d02
-- Left as an unadopted finance change: gridex_prodat_object_batch.raw_segments_v1 (same source file; not called
-- by the adopted functions). Not adopted: the GRANT EXECUTE of 20261020280000 (main has no envelope() index).
--
-- Linear-time EDIFACT lexing for received wires.
--
-- Four received-wire functions grew their result one element at a time with
-- `jsonb := jsonb || jsonb_build_array(...)`, which copies the whole array on
-- every segment, or re-read the body with substr(body,start,len), which walks
-- the multibyte text from its start for every segment. Both are quadratic in
-- the number of segments. A month of hourly UTILTS E66 (744 observations,
-- ~3,000 segments) took ~4.3 s per wire_tokens_v1 call and a month of quarter
-- hours (~12,000 segments) ~96 s, beyond the 8 s API statement timeout, so
-- such sources could not be stored.
--
-- Only the accumulation changes: segments are collected in a jsonb[] and
-- converted once with to_jsonb(), and envelope() keeps the current segment in
-- a buffer. Every check, limit, NULL result and the produced JSON are
-- unchanged. CREATE OR REPLACE keeps owners, ACLs and dependent callers
-- (closure_wire_tokens_v2 delegates to wire_tokens_bounded_v1).

CREATE OR REPLACE FUNCTION gridex_utilts_binding.wire_tokens_v1(p_raw text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
 component_sep text:=':'; data_sep text:='+'; release_char text:='?'; terminator text:='''';
 decimal_mark text:='.'; reserved text:=' '; body text; ch text; chars text[];
 released boolean:=false; current_component text:=''; current_element jsonb:='[]'; elements jsonb:='[]';
 acc jsonb[]:='{}'; tag text; segment_count integer:=0; line_count integer:=0;
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
    acc:=acc||jsonb_build_object('index',segment_count,'tag',tag,'elements',elements);
    segment_count:=segment_count+1;elements:='[]';element_count:=0;
   END IF;
  ELSE current_component:=current_component||ch;component_size:=component_size+1;
  END IF;
  IF component_size>4096 THEN RETURN NULL; END IF;
 END LOOP;
 IF released OR current_component<>'' OR elements<>'[]'::jsonb OR current_element<>'[]'::jsonb THEN RETURN NULL; END IF;
 RETURN coalesce(to_jsonb(acc),'[]'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION gridex_received_sources.wire_tokens_bounded_v1(p_raw text, p_max_lines integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
 component_sep text:=':'; data_sep text:='+'; release_char text:='?'; terminator text:='''';
 decimal_mark text:='.'; reserved text:=' '; body text; ch text; chars text[];
 released boolean:=false; current_component text:=''; current_element jsonb:='[]'; elements jsonb:='[]';
 acc jsonb[]:='{}'; tag text; segment_count integer:=0; line_count integer:=0;
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
    acc:=acc||jsonb_build_object('index',segment_count,'tag',tag,'elements',elements);
    segment_count:=segment_count+1;elements:='[]';element_count:=0;
   END IF;
  ELSE current_component:=current_component||ch;component_size:=component_size+1;
  END IF;
  IF component_size>4096 THEN RETURN NULL; END IF;
 END LOOP;
 IF released OR current_component<>'' OR elements<>'[]'::jsonb OR current_element<>'[]'::jsonb THEN RETURN NULL; END IF;
 RETURN coalesce(to_jsonb(acc),'[]'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION gridex_ediel_technical_ack.envelope(p_raw text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE advice text:='';body text;sep text:='+';release_char text:='?';terminator text:='''';chars text[];ch text;released boolean:=false;seg text:='';segment_start integer:=1;position integer:=0;segment_raw text;tokens jsonb;u jsonb;unbs integer:=0;header text;ref text;indicator text;
BEGIN
 IF p_raw IS NULL OR octet_length(p_raw)>8388608 THEN RETURN NULL;END IF;
 body:=p_raw;
 IF upper(left(body,3))='UNA' THEN
  IF left(body,3)<>'UNA' OR length(body)<9 THEN RETURN NULL;END IF;
  advice:=left(body,9);sep:=substr(body,5,1);release_char:=substr(body,7,1);terminator:=substr(body,9,1);body:=substr(body,10);
 END IF;
 -- Framing only. Each complete segment is decoded by the existing one-owner
 -- v2 lexer; incomplete/error-bearing body data is never a parsed business AST.
 body:=replace(replace(body,E'\r\n',''),E'\n','');chars:=string_to_array(body,NULL);
 FOREACH ch IN ARRAY chars LOOP
  position:=position+1;
  IF released THEN released:=false;seg:=seg||ch;CONTINUE;END IF;
  IF ch=release_char THEN released:=true;seg:=seg||ch;CONTINUE;END IF;
  IF ch<>terminator THEN seg:=seg||ch;CONTINUE;END IF;
  segment_raw:=seg;seg:='';segment_start:=position+1;
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
 IF u IS NULL OR unbs<>1 OR left(ltrim(substr(body,segment_start),E' \t'),4)='UNB'||sep THEN RETURN NULL;END IF;
 ref:=u#>>'{5,0}';indicator:=coalesce(u#>>'{11,0}','');
 IF nullif(ref,'') IS NULL OR length(ref)>512 OR ref~'[[:cntrl:]]' OR jsonb_array_length(u->5)<>1
  OR nullif(u#>>'{2,0}','') IS NULL OR nullif(u#>>'{3,0}','') IS NULL OR jsonb_array_length(u->2)>3 OR jsonb_array_length(u->3)>3
  OR EXISTS(SELECT FROM jsonb_array_elements_text(u->2||u->3)c WHERE length(c)>35)
  OR coalesce(jsonb_array_length(u->7),1)<>1 OR coalesce(jsonb_array_length(u->11),1)<>1 OR indicator NOT IN('','1') THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('sender',u->2,'receiver',u->3,'interchangeReference',ref,'uciReference',left(ref,14),
  'applicationReference',coalesce(u#>>'{7,0}',''),'environment',CASE WHEN indicator='1' THEN 'test' ELSE 'production' END,'testIndicator',indicator);
END $function$;
