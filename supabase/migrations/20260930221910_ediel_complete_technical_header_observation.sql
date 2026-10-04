-- Prospective complete-header observation for syntax-negative CONTRL. The full
-- original remains immutable and its separate syntax owner remains rejected.
-- Existing held source receipts are neither rewritten nor backfilled.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_ediel_technical_ack.envelope(p_raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE advice text:='';body text;sep text:='+';release_char text:='?';terminator text:='''';chars text[];ch text;released boolean:=false;segment_start integer:=1;position integer:=0;segment_raw text;tokens jsonb;u jsonb;unbs integer:=0;header text;ref text;indicator text;
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
  IF released THEN released:=false;CONTINUE;END IF;
  IF ch=release_char THEN released:=true;CONTINUE;END IF;
  IF ch<>terminator THEN CONTINUE;END IF;
  segment_raw:=substr(body,segment_start,position-segment_start);segment_start:=position+1;
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
END $$;
COMMIT;
