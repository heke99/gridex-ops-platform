-- 20261002070000 narrowed the CONTRL original-identity uniqueness scan in
-- gridex_ediel_technical_ack.require_contrl_v1 to inbound rows whose raw bytes
-- contain the alphanumeric UCI reference (UNB 0020). A short reference such as
-- "I" occurs in almost every message, so the scan still parsed the whole
-- inbound history with the plpgsql envelope parser and hit statement_timeout.
--
-- With the default separators UNB 0020 is always delimited: "+" before it and
-- "+" or the segment terminator "'" after it, and an alphanumeric value needs
-- no release character. Only rows that contain the delimited value can match;
-- rows with a UNA that changes the element separator or segment terminator keep
-- the full parse. Matching rows are still parsed and compared exactly as before.
BEGIN;
DO $prefilter$DECLARE f record;
 needle CONSTANT text:=$n$AND (coalesce(evidence#>>'{originalUNB,uciReference}','') !~ '^[A-Za-z0-9]+$' OR strpos(o.raw_payload,evidence#>>'{originalUNB,uciReference}')>0) OFFSET 0) old$n$;
 replacement CONSTANT text:=$n$AND (coalesce(evidence#>>'{originalUNB,uciReference}','') !~ '^[A-Za-z0-9]+$'
   OR (left(o.raw_payload,3)='UNA' AND (substring(o.raw_payload,5,1)<>'+' OR substring(o.raw_payload,9,1)<>''''))
   OR strpos(o.raw_payload,'+'||(evidence#>>'{originalUNB,uciReference}')||'+')>0
   OR strpos(o.raw_payload,'+'||(evidence#>>'{originalUNB,uciReference}')||'''')>0) OFFSET 0) old$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_ediel_technical_ack.require_contrl_v1(public.ediel_messages)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'technical_ack_uniqueness_prefilter_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'technical_ack_uniqueness_prefilter_metadata_changed';END IF;
END$prefilter$;
COMMIT;
