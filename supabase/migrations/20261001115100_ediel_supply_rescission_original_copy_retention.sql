-- DB-05: CLI-created105328 moved after dependent nationalH114500/115000.
-- Independent legal original custody; no invented issuer or lawful period.
BEGIN;
GRANT USAGE ON SCHEMA gridex_supply_rescission TO gridex_ediel_retention_owner;
GRANT EXECUTE ON FUNCTION gridex_supply_rescission.lock_v1() TO gridex_ediel_retention_owner;
GRANT SELECT,UPDATE ON gridex_supply_rescission.artifacts TO gridex_ediel_retention_owner;
ALTER TABLE gridex_supply_rescission.artifacts ALTER COLUMN source_bytes DROP NOT NULL;
CREATE VIEW gridex_ediel_retention.supply_rescission_source_originals WITH(security_barrier=true) AS SELECT a.id,a.company_id,a.source_bytes document_bytes,a.source_hash document_hash,NULL::bigint document_byte_length,NULL::timestamptz document_purged_at,to_jsonb(a)-'source_bytes' source_metadata FROM gridex_supply_rescission.artifacts a;
ALTER VIEW gridex_ediel_retention.supply_rescission_source_originals OWNER TO gridex_ediel_retention_owner;
REVOKE ALL ON gridex_ediel_retention.supply_rescission_source_originals FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO gridex_ediel_retention.decision_evidence_catalog VALUES('supply_rescission_source_original_bytes','supply_rescission_source_originals','ediel.retention.record_decision_evidence','protected_copy_revocations','target_id','protected_copy_current_v1');
INSERT INTO gridex_ediel_retention.protected_copy_specs VALUES('supply_rescission_source_original_bytes','supply_rescission_source_originals','gridex_supply_rescission','artifacts','source_bytes','source_hash');
DO $source_custody$
DECLARE f record;body text;needle text:=E' ELSE\n  PERFORM id FROM gridex_customer_life_events.certification_classifications';actual jsonb;
BEGIN
 SELECT * INTO STRICT f FROM pg_proc WHERE oid='gridex_ediel_retention.protected_copy_row_v1(uuid,text,uuid)'::regprocedure;
 IF strpos(f.prosrc,needle)=0 THEN RAISE EXCEPTION 'supply_rescission_retention_existing_source_review_required';END IF;
 body:=replace(f.prosrc,needle,$body$
 ELSIF spec.source_schema='gridex_supply_rescission' THEN
  PERFORM gridex_supply_rescission.lock_v1();
  PERFORM id FROM gridex_supply_rescission.artifacts WHERE id=target AND company_id=c FOR UPDATE;
 ELSE
  PERFORM id FROM gridex_customer_life_events.certification_classifications$body$);
 EXECUTE replace(pg_get_functiondef(f.oid),f.prosrc,body);
 SELECT to_jsonb(p)-'prosrc' INTO actual FROM pg_proc p WHERE p.oid=f.oid;
 IF actual IS DISTINCT FROM to_jsonb(f)-'prosrc' THEN RAISE EXCEPTION 'supply_rescission_retention_existing_authority_changed';END IF;
 SELECT * INTO STRICT f FROM pg_proc WHERE oid='gridex_supply_rescission.receipt_current_v1(gridex_supply_rescission.artifacts)'::regprocedure;
 needle:='PERFORM gridex_supply_rescission.lock_v1();';
 IF strpos(f.prosrc,needle)=0 THEN RAISE EXCEPTION 'supply_rescission_retention_source_guard_review_required';END IF;
 body:=replace(f.prosrc,needle,needle||' IF gridex_ediel_retention.protected_copy_current_v1(a.company_id,a.id) IS NOT TRUE THEN RETURN false;END IF;');
 EXECUTE replace(pg_get_functiondef(f.oid),f.prosrc,body);
 SELECT to_jsonb(p)-'prosrc' INTO actual FROM pg_proc p WHERE p.oid=f.oid;
 IF actual IS DISTINCT FROM to_jsonb(f)-'prosrc' THEN RAISE EXCEPTION 'supply_rescission_retention_source_authority_changed';END IF;
END$source_custody$;
CREATE FUNCTION gridex_ediel_retention.supply_rescission_original_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND gridex_ediel_retention.protected_copy_transition_v1('supply_rescission_source_original_bytes',to_jsonb(OLD),to_jsonb(NEW)) IS TRUE THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'permission_transition_evidence_is_append_only' USING ERRCODE='23514';
END$$;
ALTER FUNCTION gridex_ediel_retention.supply_rescission_original_guard_v1() OWNER TO gridex_ediel_retention_owner;
REVOKE ALL ON FUNCTION gridex_ediel_retention.supply_rescission_original_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER artifacts_immutable ON gridex_supply_rescission.artifacts;
CREATE TRIGGER artifacts_immutable BEFORE UPDATE OR DELETE ON gridex_supply_rescission.artifacts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.supply_rescission_original_guard_v1();
CREATE TRIGGER brp_00_retention_source_lock BEFORE INSERT ON gridex_supply_rescission.artifacts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.protected_copy_insert_v1();
CREATE TRIGGER protected_copy_view_update INSTEAD OF UPDATE ON gridex_ediel_retention.supply_rescission_source_originals FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.protected_copy_view_update_v1();
COMMIT;
