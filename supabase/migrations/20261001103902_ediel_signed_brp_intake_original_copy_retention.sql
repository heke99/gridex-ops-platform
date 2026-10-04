-- DB-05: intake and derived BRP declaration are independent original copies.
-- Reuse the qualified per-copy retention command and immutable tombstone owner.
BEGIN;
GRANT USAGE ON SCHEMA gridex_brp_declaration_intake TO gridex_ediel_retention_owner;
GRANT SELECT,UPDATE ON gridex_brp_declaration_intake.artifacts TO gridex_ediel_retention_owner;
GRANT SELECT ON gridex_brp_declaration_intake.origins TO gridex_ediel_retention_owner;
ALTER TABLE gridex_brp_declaration_intake.artifacts ALTER COLUMN agreement_original DROP NOT NULL,ALTER COLUMN source_original DROP NOT NULL;
CREATE VIEW gridex_ediel_retention.signed_brp_intake_agreement_originals WITH(security_barrier=true) AS SELECT a.id,a.company_id,a.agreement_original document_bytes,a.agreement_sha256 document_hash,NULL::bigint document_byte_length,NULL::timestamptz document_purged_at,to_jsonb(a)-ARRAY['agreement_original','source_original'] source_metadata FROM gridex_brp_declaration_intake.artifacts a;
CREATE VIEW gridex_ediel_retention.signed_brp_intake_source_originals WITH(security_barrier=true) AS SELECT a.id,a.company_id,a.source_original document_bytes,a.source_sha256 document_hash,NULL::bigint document_byte_length,NULL::timestamptz document_purged_at,to_jsonb(a)-ARRAY['agreement_original','source_original'] source_metadata FROM gridex_brp_declaration_intake.artifacts a;
ALTER VIEW gridex_ediel_retention.signed_brp_intake_agreement_originals OWNER TO gridex_ediel_retention_owner;
ALTER VIEW gridex_ediel_retention.signed_brp_intake_source_originals OWNER TO gridex_ediel_retention_owner;
REVOKE ALL ON gridex_ediel_retention.signed_brp_intake_agreement_originals,gridex_ediel_retention.signed_brp_intake_source_originals FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO gridex_ediel_retention.decision_evidence_catalog VALUES
 ('signed_brp_intake_agreement_original_bytes','signed_brp_intake_agreement_originals','ediel.retention.record_decision_evidence','protected_copy_revocations','target_id','protected_copy_current_v1'),
 ('signed_brp_intake_source_original_bytes','signed_brp_intake_source_originals','ediel.retention.record_decision_evidence','protected_copy_revocations','target_id','protected_copy_current_v1');
INSERT INTO gridex_ediel_retention.protected_copy_specs VALUES
 ('signed_brp_intake_agreement_original_bytes','signed_brp_intake_agreement_originals','gridex_brp_declaration_intake','artifacts','agreement_original','agreement_sha256'),
 ('signed_brp_intake_source_original_bytes','signed_brp_intake_source_originals','gridex_brp_declaration_intake','artifacts','source_original','source_sha256');

-- Source readers and purge use the same contract -> declaration -> intake
-- order. Shared helper's old BRP and classification branches stay byte exact.
DO $intake_lock_order$
DECLARE f record;body text;needle text:=E' ELSE\n  PERFORM id FROM gridex_customer_life_events.certification_classifications';actual jsonb;
BEGIN
 SELECT * INTO STRICT f FROM pg_proc WHERE oid='gridex_ediel_retention.protected_copy_row_v1(uuid,text,uuid)'::regprocedure;
 IF strpos(f.prosrc,needle)=0 THEN RAISE EXCEPTION 'signed_brp_retention_existing_source_review_required';END IF;
 body:=replace(f.prosrc,needle,$body$
 ELSIF spec.source_schema='gridex_brp_declaration_intake' THEN
  SELECT contract_id INTO ct FROM gridex_brp_declaration_intake.artifacts WHERE id=target AND company_id=c;
  PERFORM id FROM public.customer_contracts WHERE id=ct AND company_id=c FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'decision_evidence_original_scope_required';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('contract-brp:'||c::text||':'||ct::text,0));
  PERFORM id FROM gridex_brp_sources.contract_declarations WHERE id IN(SELECT declaration_id FROM gridex_brp_declaration_intake.origins WHERE artifact_id=target AND company_id=c) ORDER BY id FOR UPDATE;
  PERFORM id FROM gridex_brp_declaration_intake.artifacts WHERE id=target AND company_id=c FOR UPDATE;
 ELSE
  PERFORM id FROM gridex_customer_life_events.certification_classifications$body$);
 EXECUTE replace(pg_get_functiondef(f.oid),f.prosrc,body);
 SELECT to_jsonb(p)-'prosrc' INTO actual FROM pg_proc p WHERE p.oid=f.oid;
 IF actual IS DISTINCT FROM to_jsonb(f)-'prosrc' THEN RAISE EXCEPTION 'signed_brp_retention_existing_authority_changed';END IF;
END$intake_lock_order$;
CREATE FUNCTION gridex_ediel_retention.signed_brp_intake_original_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND (
  gridex_ediel_retention.protected_copy_transition_v1('signed_brp_intake_agreement_original_bytes',to_jsonb(OLD),to_jsonb(NEW)) IS TRUE OR
  gridex_ediel_retention.protected_copy_transition_v1('signed_brp_intake_source_original_bytes',to_jsonb(OLD),to_jsonb(NEW)) IS TRUE
 ) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'ediel_source_append_only';
END$$;
ALTER FUNCTION gridex_ediel_retention.signed_brp_intake_original_guard_v1() OWNER TO gridex_ediel_retention_owner;
REVOKE ALL ON FUNCTION gridex_ediel_retention.signed_brp_intake_original_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER immutable ON gridex_brp_declaration_intake.artifacts;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_brp_declaration_intake.artifacts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.signed_brp_intake_original_guard_v1();
CREATE TRIGGER brp_00_retention_source_lock BEFORE INSERT ON gridex_brp_declaration_intake.artifacts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.protected_copy_insert_v1();
CREATE TRIGGER protected_copy_view_update INSTEAD OF UPDATE ON gridex_ediel_retention.signed_brp_intake_agreement_originals FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.protected_copy_view_update_v1();
CREATE TRIGGER protected_copy_view_update INSTEAD OF UPDATE ON gridex_ediel_retention.signed_brp_intake_source_originals FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.protected_copy_view_update_v1();
COMMIT;
