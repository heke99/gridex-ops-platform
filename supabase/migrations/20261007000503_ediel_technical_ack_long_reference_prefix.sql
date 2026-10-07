-- T p16 prescribes the first 14 logical characters of a longer received UNB
-- reference in UCI. A delimited full-value prefilter loses both the genuine
-- long original and foreign originals with the same projected prefix.
-- Normalize only the cheap candidate search. False candidates still undergo
-- the unchanged complete parser/global namespace check before tenant selection.
-- Short UCI references retain their trailing delimiter and selectivity.
DO $prefix$
DECLARE f record;body text;body_hash text;
 signature CONSTANT text:='gridex_ediel_technical_ack.require_contrl_v1(public.ediel_messages)';
 old_hash CONSTANT text:='3232a29750f83738243ac958a500d572c21cdc0543c25a5bdcf46ea03869c2a3';
 new_hash CONSTANT text:='464abc12a297a8c6e6cd682499e1750f36f993b50abd1a97e311de5fb027551f';
 needle CONSTANT text:=$needle$   OR (left(o.raw_payload,3)='UNA' AND (substring(o.raw_payload,5,1)<>'+' OR substring(o.raw_payload,9,1)<>''''))
   OR strpos(o.raw_payload,'+'||(evidence#>>'{originalUNB,uciReference}')||'+')>0
   OR strpos(o.raw_payload,'+'||(evidence#>>'{originalUNB,uciReference}')||'''')>0$needle$;
 replacement CONSTANT text:=$replacement$   OR (left(o.raw_payload,3)='UNA' AND (substring(o.raw_payload,5,1)<>'+' OR substring(o.raw_payload,7,1)<>'?' OR substring(o.raw_payload,9,1)<>''''))
   OR CASE WHEN char_length(evidence#>>'{originalUNB,uciReference}')=14
    THEN strpos(translate(o.raw_payload,E'?\r\n',''),'+'||(evidence#>>'{originalUNB,uciReference}'))>0
    ELSE strpos(translate(o.raw_payload,E'?\r\n',''),'+'||(evidence#>>'{originalUNB,uciReference}')||'+')>0
     OR strpos(translate(o.raw_payload,E'?\r\n',''),'+'||(evidence#>>'{originalUNB,uciReference}')||'''')>0 END$replacement$;
BEGIN
 IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION 'technical_ack_prefix_predecessor_required';END IF;
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=to_regprocedure(signature);
 body_hash:=encode(sha256(convert_to(f.prosrc,'UTF8')),'hex');
 IF body_hash=new_hash THEN RETURN;END IF;
 IF body_hash<>old_hash OR (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1
  OR (length(f.definition)-length(replace(f.definition,f.prosrc,'')))/length(f.prosrc)<>1 THEN RAISE EXCEPTION 'technical_ack_prefix_predecessor_required';END IF;
 body:=replace(f.prosrc,needle,replacement);
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>new_hash THEN RAISE EXCEPTION 'technical_ack_prefix_body_shape_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=f.oid) IS DISTINCT FROM new_hash THEN RAISE EXCEPTION 'technical_ack_prefix_metadata_changed';END IF;
END
$prefix$;
