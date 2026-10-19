-- DB-05: keep the explicit audit19 retention class usable after tenant closure.
-- Only the existing retention permission-key set changes; no grants or actor/status bypass.
BEGIN;
DO $audit19_archived_permission$
DECLARE target oid:='gridex_ediel_retention.permission_v1(uuid,uuid,text)'::regprocedure;
 body text;patched text;definition text;before_catalog jsonb;after_catalog jsonb;
 old_needle constant text:=$key$'ediel.retention.completed_review_reason'$key$;
 new_needle constant text:=$key$'ediel.retention.completed_review_reason','ediel.retention.audit_normalized19_cleanup'$key$;
BEGIN
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO STRICT body,before_catalog FROM pg_proc p WHERE oid=target;
 IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM '6bedde3f4c01c504eae815ba0895b0872603dd2f6d8adace45669b640db689c7'
 THEN RAISE EXCEPTION 'audit19_permission_exact_source6_predecessor_required';END IF;
 IF (length(body)-length(replace(body,old_needle,'')))/length(old_needle)<>1
 THEN RAISE EXCEPTION 'audit19_permission_unique_retention_key_anchor_required';END IF;
 patched:=replace(body,old_needle,new_needle);
 IF encode(sha256(convert_to(patched,'UTF8')),'hex') IS DISTINCT FROM 'b4027dcae1ce6e709fd37afb329589649197104c801aeb4110454a60045cc0fa'
 THEN RAISE EXCEPTION 'audit19_permission_exact_postimage_required';END IF;
 definition:=pg_get_functiondef(target);
 IF (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'audit19_permission_exact_definition_anchor_required';END IF;
 EXECUTE replace(definition,body,patched);
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_catalog FROM pg_proc p WHERE oid=target;
 IF after_catalog IS DISTINCT FROM before_catalog
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'b4027dcae1ce6e709fd37afb329589649197104c801aeb4110454a60045cc0fa'
 THEN RAISE EXCEPTION 'audit19_permission_catalog_or_body_changed';END IF;
END $audit19_archived_permission$;
COMMIT;
