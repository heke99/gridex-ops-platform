-- CLI-created 20261001025430, dependency-ordered before immutable 00700.
-- Rename the actual installed append-only source trigger, without disabling,
-- copying or changing its function, identity, row/event mask or enabled mode.
BEGIN;
DO $retention_source_trigger$
DECLARE original pg_trigger%rowtype;renamed pg_trigger%rowtype;
BEGIN
 SELECT * INTO original FROM pg_trigger
 WHERE tgrelid='gridex_received_sources.sources'::regclass
 AND tgname='received_sources_no_update_delete' AND NOT tgisinternal;
 IF original.oid IS NULL THEN
  RAISE EXCEPTION 'ediel_retention_original_source_trigger_required';
 END IF;
 IF original.tgfoid<>'gridex_received_sources.reject_mutation()'::regprocedure
 OR original.tgtype<>27 OR original.tgenabled NOT IN('O','A')
 OR original.tgnargs<>0 OR original.tgqual IS NOT NULL
 OR EXISTS(SELECT FROM pg_trigger WHERE tgrelid=original.tgrelid AND tgname='no_evidence_update_delete') THEN
  RAISE EXCEPTION 'ediel_retention_source_trigger_contract_changed';
 END IF;
 ALTER TRIGGER received_sources_no_update_delete ON gridex_received_sources.sources
 RENAME TO no_evidence_update_delete;
 SELECT * INTO STRICT renamed FROM pg_trigger WHERE oid=original.oid;
 IF (to_jsonb(renamed)-'tgname') IS DISTINCT FROM (to_jsonb(original)-'tgname')
 OR renamed.tgname<>'no_evidence_update_delete' THEN
  RAISE EXCEPTION 'ediel_retention_source_trigger_identity_changed';
 END IF;
END
$retention_source_trigger$;
COMMIT;
