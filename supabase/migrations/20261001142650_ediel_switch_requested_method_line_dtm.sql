-- gridex_received_sources.switch_requested_method_v1 reads the requested
-- metering method (CCI Z04 / CAV) of the single Z03 object. It closed the
-- attribute section on the first DTM, but in the PRODAT line group the
-- line-level DTM (e.g. DTM+92 start) precedes the CCI/CAV attributes. Every
-- canonical Z03 therefore yielded NULL and the requested-method binding failed
-- with switch_signed_new_agreement_requested_method_required.
--
-- A DTM before the object's first CCI is line-level and leaves the attribute
-- section open. A DTM after a CCI, and any RFF/NAD/UNT, still closes it; a
-- second LIN, a duplicate or empty method still returns NULL.
BEGIN;
DO $rewrite$DECLARE f record;
 needles CONSTANT text[]:=ARRAY[
  $n$attribute text;method text;$n$,
  $n$  IF token->>'tag' IN('RFF','NAD','DTM','UNT') THEN common_open:=false;attribute:=NULL;CONTINUE;END IF;
  IF token->>'tag'='CCI' THEN attribute:=token#>>'{elements,2,0}';CONTINUE;END IF;$n$];
 replacements CONSTANT text[]:=ARRAY[
  $n$attribute text;method text;seen_cci boolean:=false;$n$,
  $n$  IF token->>'tag'='DTM' AND NOT seen_cci THEN CONTINUE;END IF;
  IF token->>'tag' IN('RFF','NAD','DTM','UNT') THEN common_open:=false;attribute:=NULL;CONTINUE;END IF;
  IF token->>'tag'='CCI' THEN seen_cci:=true;attribute:=token#>>'{elements,2,0}';CONTINUE;END IF;$n$];
 body text;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_received_sources.switch_requested_method_v1(text)'::regprocedure;
 body:=f.prosrc;
 FOR i IN 1..array_length(needles,1) LOOP
  IF (length(body)-length(replace(body,needles[i],'')))/length(needles[i])<>1 THEN RAISE EXCEPTION 'switch_requested_method_predecessor_required:%',i;END IF;
  body:=replace(body,needles[i],replacements[i]);
 END LOOP;
 EXECUTE replace(f.definition,f.prosrc,body);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'switch_requested_method_metadata_changed';END IF;
END$rewrite$;
COMMIT;
