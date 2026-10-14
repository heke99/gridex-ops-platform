-- Gridex OPS only. Forward correction; published migrations remain immutable.
-- No business records are changed by installation. Preserve the complete function ABI/ACL.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $signing_prepare_postlock$
DECLARE
  target oid := 'public.gridex_prepare_customer_contract_signature_request_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text)'::regprocedure;
  before_function pg_catalog.pg_proc%rowtype;
  after_function pg_catalog.pg_proc%rowtype;
  definition text;
  anchor constant text := $anchor$  -- Revalidate freshness after the company/contract/publication/snapshot locks.
$anchor$;
  addition constant text := $addition$  -- Wait for current pending request writers before checking wall-clock expiry.
  -- The contract lock serializes preparation; mark-sent locks these rows directly.
  perform id
  from public.customer_contract_signature_requests
  where company_id=p_company_id and customer_contract_id=p_contract_id
    and used_at is null and revoked_at is null
  order by id for update;

$addition$;
BEGIN
  SELECT * INTO STRICT before_function FROM pg_catalog.pg_proc WHERE oid=target;
  definition := pg_catalog.pg_get_functiondef(target);
  IF pg_catalog.pg_get_userbyid(before_function.proowner)<>'postgres'
     OR before_function.proacl::text[] IS DISTINCT FROM ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]
     OR pg_catalog.md5(definition) NOT IN ('7cae537fc5619cf82cbfcca78a2b5344','0e6cbec5c3c542330d33e88be75ed060') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ops_signing_prepare_unknown_definition_or_permissions';
  END IF;
  IF pg_catalog.md5(definition)='7cae537fc5619cf82cbfcca78a2b5344' THEN
    IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ops_signing_prepare_freshness_anchor_invalid';
    END IF;
    definition := replace(definition,anchor,addition||anchor);
    IF pg_catalog.md5(definition)<>'0e6cbec5c3c542330d33e88be75ed060' THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ops_signing_prepare_transformed_definition_mismatch';
    END IF;
    EXECUTE definition;
  END IF;
  SELECT * INTO STRICT after_function FROM pg_catalog.pg_proc WHERE oid=target;
  IF (to_jsonb(after_function)-'prosrc') IS DISTINCT FROM (to_jsonb(before_function)-'prosrc')
     OR pg_catalog.md5(pg_catalog.pg_get_functiondef(target))<>'0e6cbec5c3c542330d33e88be75ed060' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ops_signing_prepare_postlock_metadata_mismatch';
  END IF;
END
$signing_prepare_postlock$;
COMMIT;
