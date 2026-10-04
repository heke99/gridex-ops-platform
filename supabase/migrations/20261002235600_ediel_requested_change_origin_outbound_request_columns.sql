-- public.ediel_originate_requested_change_before_scope_fence_v1
-- (20261001010758) inserts the originated customer-masterdata request into
-- public.outbound_requests with an `environment` column. That table has no
-- environment column (neither in a clean replay nor in production), so every
-- requested-change origination failed with
-- 'column "environment" of relation "outbound_requests" does not exist'.
--
-- The same origination also minted a 20-character UNB interchange reference
-- (ref:=upper(substring(ref,1,20))), but UNB/0020 is an..14, so the Z09 wire
-- was refused by gridex_ediel_wire_namespace.keys. It is now 14 characters.
--
-- The environment stays bound by the event and the intent (and is rechecked
-- against the message by gridex_requested_changes.require_message_v1); the
-- request row never carried it. Remove only that column/value pair; the
-- stored request binding (to_jsonb of the row) and every other check are
-- unchanged. Body rewrite with predecessor and metadata guards.
BEGIN;
DO $origin$DECLARE f record;
 needle CONSTANT text:=$n$request_type,source_type,source_id,environment,status,channel_type$n$;
 replacement CONSTANT text:=$n$request_type,source_type,source_id,status,channel_type$n$;
 value_needle CONSTANT text:=$n$'customer_masterdata','manual',i.id,e.environment,'prepared'$n$;
 value_replacement CONSTANT text:=$n$'customer_masterdata','manual',i.id,'prepared'$n$;
 ref_needle CONSTANT text:=$n$ref:=upper(substring(ref,1,20));$n$;
 ref_replacement CONSTANT text:=$n$ref:=upper(substring(ref,1,14));$n$;
 body text;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE oid='public.ediel_originate_requested_change_before_scope_fence_v1(uuid,uuid,uuid,jsonb)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,value_needle,'')))/length(value_needle)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,ref_needle,'')))/length(ref_needle)<>1
 THEN RAISE EXCEPTION 'requested_change_origin_request_columns_predecessor_required';END IF;
 body:=replace(replace(replace(f.prosrc,needle,replacement),value_needle,value_replacement),ref_needle,ref_replacement);
 EXECUTE replace(f.definition,f.prosrc,body);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'requested_change_origin_request_columns_metadata_changed';END IF;
END$origin$;
COMMIT;
