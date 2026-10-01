-- Qualified source-byte purge of gridex_received_sources.sources
-- (ediel_begin_blob_purge_v1, 20261001000700) could never succeed:
--
-- 1. scope_point is a stored generated column
--    (gridex_received_sources.source_wire_point_v1(raw_payload), 20260925*).
--    The purge runs as gridex_ediel_retention_owner and nulls raw_payload;
--    PostgreSQL recomputes the column as that role, which had no EXECUTE on
--    the private parser ("permission denied for function source_wire_point_v1").
-- 2. The immutability guard gridex_ediel_retention.source_guard_v1 compares
--    every column except raw_payload/retention_purged_at. In a BEFORE trigger
--    NEW exposes a stored generated column as NULL, so the comparison always
--    differed and raised received_original_immutable_without_native_retention.
--
-- Fix, least privilege and same meaning:
-- - EXECUTE on that immutable parser and its two invoker tokenizer
--   dependencies (closure_wire_tokens_v1 -> wire_tokens_bounded_v1; pure, no
--   data access) for the one internal non-login owner role that already owns
--   the purge.
-- - The guard also excludes scope_point. It is a pure projection of
--   raw_payload and cannot be assigned by any UPDATE, so no writable column
--   gains freedom; every other column, the tombstone match and the
--   raw_payload/retention_purged_at conditions are unchanged.
BEGIN;
DO $fix$DECLARE f record;
 needle CONSTANT text:=$n$(to_jsonb(new)-ARRAY['raw_payload','retention_purged_at']) IS DISTINCT FROM (to_jsonb(old)-ARRAY['raw_payload','retention_purged_at'])$n$;
 replacement CONSTANT text:=$n$(to_jsonb(new)-ARRAY['raw_payload','retention_purged_at','scope_point']) IS DISTINCT FROM (to_jsonb(old)-ARRAY['raw_payload','retention_purged_at','scope_point'])$n$;
BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner' AND NOT rolcanlogin)
  OR (SELECT proowner::regrole::text FROM pg_proc WHERE oid='public.ediel_begin_blob_purge_v1(uuid,uuid,uuid)'::regprocedure) IS DISTINCT FROM 'gridex_ediel_retention_owner'
  OR (SELECT a.attgenerated FROM pg_attribute a WHERE a.attrelid='gridex_received_sources.sources'::regclass AND a.attname='scope_point') IS DISTINCT FROM 's'
  OR pg_get_expr((SELECT adbin FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='gridex_received_sources.sources'::regclass AND a.attname='scope_point'),'gridex_received_sources.sources'::regclass)
   IS DISTINCT FROM 'gridex_received_sources.source_wire_point_v1(raw_payload)'
   OR EXISTS(SELECT FROM pg_proc p WHERE p.oid IN('gridex_received_sources.source_wire_point_v1(text)'::regprocedure,'gridex_received_sources.closure_wire_tokens_v1(text)'::regprocedure,'gridex_received_sources.wire_tokens_bounded_v1(text,integer)'::regprocedure) AND (p.provolatile<>'i' OR p.prosecdef))
 THEN RAISE EXCEPTION 'retention_source_point_projection_predecessor_required';END IF;
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_ediel_retention.source_guard_v1()'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'retention_source_guard_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'retention_source_guard_metadata_changed';END IF;
END$fix$;
GRANT EXECUTE ON FUNCTION gridex_received_sources.source_wire_point_v1(text),gridex_received_sources.closure_wire_tokens_v1(text),gridex_received_sources.wire_tokens_bounded_v1(text,integer) TO gridex_ediel_retention_owner;
COMMIT;
