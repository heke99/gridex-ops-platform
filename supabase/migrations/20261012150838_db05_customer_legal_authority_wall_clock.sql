-- A purge waiting on the customer must not consume a legal receipt that
-- expired during the wait. Observe current validity after the issuer lock;
-- preserve the installed original-byte, HMAC, scope and revocation guards.
BEGIN;
DO $customer_legal_clock$
DECLARE
 f record;
 installed record;
 body text;
 definition text;
 declaration_needle constant text := 'deadline timestamptz;';
 lock_needle constant text := 'company_id=d.company_id FOR SHARE;';
BEGIN
 SELECT p.*,p.oid::regprocedure identity,to_jsonb(p)-'prosrc' authority_before
 INTO STRICT f FROM pg_catalog.pg_proc p
 WHERE p.oid='gridex_ediel_retention.customer_receipt_v1(gridex_ediel_retention.customer_decisions)'::regprocedure;
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.prosrc,'UTF8')),'hex')<>'9238f39eb6a8a06225e4a4fd9edf464ec383a16e50271d89a3fd4e378ddbb48f'
  OR NOT f.prosecdef OR f.proowner<>'gridex_ediel_retention_owner'::regrole
  OR f.provolatile<>'v' OR (f.proconfig @> ARRAY['search_path=pg_catalog']) IS DISTINCT FROM true
  OR (length(f.prosrc)-length(replace(f.prosrc,declaration_needle,'')))/length(declaration_needle)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,lock_needle,'')))/length(lock_needle)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,'now()','')))/length('now()')<>4
 THEN RAISE EXCEPTION 'customer_legal_clock_original_review_required';END IF;
 body:=replace(f.prosrc,declaration_needle,declaration_needle||'legal_observed_at timestamptz;');
 body:=replace(body,lock_needle,lock_needle||chr(10)||' legal_observed_at:=clock_timestamp();');
 body:=replace(body,'now()','legal_observed_at');
 definition:=pg_catalog.pg_get_functiondef(f.oid);
 IF position(f.prosrc IN definition)=0 THEN RAISE EXCEPTION 'customer_legal_clock_definition_required';END IF;
 EXECUTE replace(definition,f.prosrc,body);
 SELECT * INTO STRICT installed FROM pg_catalog.pg_proc p WHERE p.oid=f.oid;
 IF to_jsonb(installed)-'prosrc' IS DISTINCT FROM f.authority_before
  OR installed.prosrc IS DISTINCT FROM body
  OR pg_catalog.to_regprocedure(f.identity::text) IS DISTINCT FROM f.oid
 THEN RAISE EXCEPTION 'customer_legal_clock_authority_changed';END IF;
END
$customer_legal_clock$;
COMMIT;
