-- public.gridex_ai_outbound_origin_status_v1 compares the bound message's
-- source_operation_id (text) with the intent's operation_id (uuid). Once an AI
-- original is bound, every status read (queue replay, immutable disclosure)
-- failed with 'operator does not exist: text = uuid' (42883), in a clean
-- replay and in production alike. Compare the canonical text form; every
-- other binding check is unchanged. Body rewrite with predecessor and
-- metadata guards.
BEGIN;
DO $status$DECLARE f record;
 needle CONSTANT text:=$n$m.source_operation_id IS DISTINCT FROM i.operation_id OR$n$;
 replacement CONSTANT text:=$n$m.source_operation_id IS DISTINCT FROM i.operation_id::text OR$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE oid='public.gridex_ai_outbound_origin_status_v1(uuid,uuid,uuid)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'ai_outbound_origin_status_operation_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'ai_outbound_origin_status_operation_metadata_changed';END IF;
END$status$;
COMMIT;
