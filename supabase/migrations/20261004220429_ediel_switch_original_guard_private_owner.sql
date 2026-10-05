-- An ordinary service-role ACK status UPDATE invokes this existing guard.
-- Its private original lookup needs the existing trusted function owner's
-- privileges. Keep the exact immutable-row/qualified-retention body and
-- public row access policy; no caller gains SELECT on private originals.
BEGIN;
DO $switch_guard$
DECLARE f record;actual jsonb;
BEGIN
 SELECT * INTO STRICT f FROM pg_proc WHERE oid='gridex_received_sources.switch_original_message_immutable_v1()'::regprocedure;
 IF f.prosecdef IS NOT FALSE OR f.prorettype<>'trigger'::regtype OR f.pronargs<>0
  OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
  OR f.proowner<>(SELECT relowner FROM pg_class WHERE oid='gridex_received_sources.switch_originals'::regclass)
  OR encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')<>'ea25f87b4f884959c6cf26cfafdf06b14347385952cdbdec773d62e241e8a840'
 THEN RAISE EXCEPTION 'switch_original_guard_existing_owner_review_required';END IF;
 ALTER FUNCTION gridex_received_sources.switch_original_message_immutable_v1() SECURITY DEFINER;
 SELECT to_jsonb(p)-'prosecdef' INTO actual FROM pg_proc p WHERE p.oid=f.oid;
 IF actual IS DISTINCT FROM to_jsonb(f)-'prosecdef'
  OR NOT(SELECT prosecdef FROM pg_proc WHERE oid=f.oid)
 THEN RAISE EXCEPTION 'switch_original_guard_existing_metadata_changed';END IF;
END$switch_guard$;
COMMIT;
