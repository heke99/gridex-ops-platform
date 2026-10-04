-- public.ediel_require_message_consumed_records_v1 (20261001015945) reads
-- ediel_messages.original_message_id into a uuid. The column is text and, for
-- outbound APERAK/CONTRL replies, holds the replied EDIFACT reference (e.g.
-- '1'), never a native message id. Every transport prepare of such a reply
-- therefore failed with "invalid input syntax for type uuid".
--
-- Only a UUID-shaped value is a native original-message selector whose bytes
-- the retention owner must still hold. An EDIFACT reference selects no stored
-- original, so it adds no byte-retention requirement. Everything else is
-- unchanged. Body rewrite with predecessor and metadata guards.
BEGIN;
DO $consumed$DECLARE f record;
 needle CONSTANT text:=$n$SELECT original_message_id INTO source FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id;$n$;
 replacement CONSTANT text:=$n$SELECT CASE WHEN original_message_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN original_message_id::uuid END INTO source FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id;$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE oid='public.ediel_require_message_consumed_records_v1(uuid,uuid)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'consumed_records_original_reference_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'consumed_records_original_reference_metadata_changed';END IF;
END$consumed$;
COMMIT;
