-- Bounded necessary-condition prefilter before the unchanged physical owner.
-- No reference cache, new authority, changed namespace, grant or outer timeout.
BEGIN;
DO $retained_contrl_prefilter$
DECLARE
 function_oid oid:=to_regprocedure('gridex_ediel_technical_ack.retained_source_v1(public.ediel_messages,boolean)');
 before_metadata jsonb;after_metadata jsonb;body text;post_body text;definition text;
 pre_hash CONSTANT text:='f6985446102ad8306a5905870b423f24b654884275047b2366059b111faae24d';
 post_hash CONSTANT text:='77aa7bad7fe352374e6769110173d1804ea4c0c0c68865dc62b248e6525d09c6';
 needle CONSTANT text:=$old$  ORDER BY s.id FOR SHARE OF b,r,s LOOP$old$;
 replacement CONSTANT text:=$new$   AND (coalesce(a->>'uciRef','') COLLATE "C" !~ '^[A-Za-z0-9]{8,14}$'
    OR (upper(left(s.raw_payload,3))='UNA' AND left(s.raw_payload,9)<>'UNA:+.? ''')
    OR strpos(CASE WHEN upper(left(s.raw_payload,3))='UNA' THEN substr(s.raw_payload,10) ELSE s.raw_payload END,'?')>0
    OR strpos(replace(replace(s.raw_payload,E'\r\n',''),E'\n',''),a->>'uciRef')>0)
  ORDER BY s.id FOR SHARE OF b,r,s LOOP$new$;
BEGIN
 IF function_oid IS NULL THEN RAISE EXCEPTION 'ediel_retained_contrl_prefilter_function_missing';END IF;
 SELECT to_jsonb(p)-'prosrc',p.prosrc INTO STRICT before_metadata,body FROM pg_catalog.pg_proc p WHERE p.oid=function_oid;
 IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM pre_hash THEN
  RAISE EXCEPTION 'ediel_retained_contrl_prefilter_preimage_changed';END IF;
 IF length(body)-length(replace(body,needle,''))<>length(needle) THEN
  RAISE EXCEPTION 'ediel_retained_contrl_prefilter_replacement_shape_changed';END IF;
 post_body:=replace(body,needle,replacement);
 IF encode(sha256(convert_to(post_body,'UTF8')),'hex') IS DISTINCT FROM post_hash THEN
  RAISE EXCEPTION 'ediel_retained_contrl_prefilter_definition_postimage_changed';END IF;
 definition:=pg_catalog.pg_get_functiondef(function_oid);
 IF length(definition)-length(replace(definition,body,''))<>length(body) THEN
  RAISE EXCEPTION 'ediel_retained_contrl_prefilter_definition_shape_changed';END IF;
 definition:=replace(definition,body,post_body);
 EXECUTE definition;
 IF to_regprocedure('gridex_ediel_technical_ack.retained_source_v1(public.ediel_messages,boolean)')::oid IS DISTINCT FROM function_oid THEN
  RAISE EXCEPTION 'ediel_retained_contrl_prefilter_oid_changed';END IF;
 SELECT to_jsonb(p)-'prosrc',p.prosrc INTO STRICT after_metadata,body FROM pg_catalog.pg_proc p WHERE p.oid=function_oid;
 IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM post_hash THEN
  RAISE EXCEPTION 'ediel_retained_contrl_prefilter_catalog_postimage_changed';END IF;
 IF after_metadata IS DISTINCT FROM before_metadata THEN
  RAISE EXCEPTION 'ediel_retained_contrl_prefilter_function_metadata_changed';END IF;
END
$retained_contrl_prefilter$;
COMMIT;
