-- Bounded forward from immutable 20261001093425. Preserve the original
-- schema, source bytes, issuer/review/mandate rows and function identities.
-- Legal issuer/representation/grammar expiry must use execution wall clock,
-- including a transaction that waits across a real authority boundary.
BEGIN;
DO $source_clock$
DECLARE signature text;definition text;body text;next_body text;required text;
BEGIN
 IF to_regnamespace('gridex_supply_rescission') IS NULL
 OR to_regclass('gridex_supply_rescission.artifacts') IS NULL
 OR to_regclass('gridex_supply_rescission.issuer_keys') IS NULL
 OR to_regclass('gridex_supply_rescission.issuer_representations') IS NULL
 OR to_regclass('gridex_supply_rescission.issuer_revocations') IS NULL
 OR to_regclass('gridex_supply_rescission.reviews') IS NULL
 OR to_regclass('gridex_supply_rescission.mandates') IS NULL
 THEN RAISE EXCEPTION 'supply_rescission_original_archive_schema_required';END IF;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_trigger WHERE tgrelid='gridex_supply_rescission.artifacts'::regclass AND tgname='artifacts_immutable' AND NOT tgisinternal AND tgenabled<>'D')
 OR NOT EXISTS(SELECT FROM pg_catalog.pg_trigger WHERE tgrelid='gridex_supply_rescission.mandates'::regclass AND tgname='mandates_immutable' AND NOT tgisinternal AND tgenabled<>'D')
 THEN RAISE EXCEPTION 'supply_rescission_original_immutable_owner_required';END IF;
 FOREACH signature IN ARRAY ARRAY[
  'gridex_supply_rescission.scope_v1(uuid,jsonb)',
  'gridex_supply_rescission.receipt_current_v1(gridex_supply_rescission.artifacts)',
  'gridex_supply_rescission.mandate_current_v1(uuid,uuid,boolean)'
 ] LOOP
  IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION 'supply_rescission_original_source_owner_required:%',signature;END IF;
  SELECT pg_get_functiondef(p.oid),p.prosrc INTO STRICT definition,body FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(signature);
  required:=CASE signature
   WHEN 'gridex_supply_rescission.scope_v1(uuid,jsonb)' THEN 'gridex_received_sources.supply_period_source_basis_v1'
   WHEN 'gridex_supply_rescission.receipt_current_v1(gridex_supply_rescission.artifacts)' THEN 'receipt_hmac_sha256_v1'
   ELSE 'gridex_supply_rescission.receipt_current_v1' END;
  IF position(required IN body)=0 OR position('gridex_supply_rescission.lock_v1()' IN body)=0
  THEN RAISE EXCEPTION 'supply_rescission_original_source_contract_changed:%',signature;END IF;
  next_body:=replace(replace(body,'now()','clock_timestamp()'),'current_date','(clock_timestamp()::date)');
  IF position('clock_timestamp()' IN next_body)=0 THEN RAISE EXCEPTION 'supply_rescission_source_clock_contract_required:%',signature;END IF;
  -- pg_get_functiondef retains argument/default/return contract, security,
  -- timezone/search_path and volatility; OR REPLACE retains OID/owner/ACL.
  IF next_body IS DISTINCT FROM body THEN EXECUTE replace(definition,body,next_body);END IF;
 END LOOP;
END$source_clock$;
COMMIT;
