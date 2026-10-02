-- A PRODAT APERAK D.96A E2SE6A that rejects a whole message carries BGM+++27:
-- message function 27 without an own document number (built by
-- lib/ediel/inbound/duplicateResponses.ts and the common-header negative
-- APERAK owner). gridex_ediel_wire_namespace.keys required a non-empty BGM
-- 1004 for every family, so every such reply failed its INSERT with
-- ediel_wire_reference_source_invalid.
--
-- An APERAK without BGM 1004 has no own document reference to reserve. Only
-- that case is skipped; a present BGM 1004 of any family, and an empty BGM 1004
-- of PRODAT/UTILTS/CONTRL, are handled exactly as before.
BEGIN;
DO $keys$DECLARE f record;
 needle CONSTANT text:=$n$   WHEN 'BGM' THEN kind:='BGM';value:=token#>>'{elements,2,0}';$n$;
 replacement CONSTANT text:=$n$   WHEN 'BGM' THEN IF NOT(family='APERAK' AND nullif(token#>>'{elements,2,0}','') IS NULL) THEN kind:='BGM';value:=token#>>'{elements,2,0}';END IF;$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_ediel_wire_namespace.keys(text)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'wire_namespace_aperak_bgm_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'wire_namespace_aperak_bgm_metadata_changed';END IF;
END$keys$;
COMMIT;
