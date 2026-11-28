-- Resolve the private TEST addendum authority only for its reserved source.
-- PostgreSQL may check function EXECUTE while planning a boolean expression,
-- even when the ordinary snapshot source makes its other operand false.
DO $migration$
DECLARE
  original record;
  candidate text;
  old_guard constant text := $old$  IF new.source='staff_manually_verified_signed_addendum_v1'
    AND gridex_billing_source.check_test_price_addendum_snapshot_insert_v1(new) IS NOT TRUE THEN
    RAISE EXCEPTION 'price_addendum_snapshot_native_authority_required' USING ERRCODE='23514';
  END IF;$old$;
  new_guard constant text := $new$  IF new.source='staff_manually_verified_signed_addendum_v1' THEN
    IF gridex_billing_source.check_test_price_addendum_snapshot_insert_v1(new) IS NOT TRUE THEN
      RAISE EXCEPTION 'price_addendum_snapshot_native_authority_required' USING ERRCODE='23514';
    END IF;
  END IF;$new$;
BEGIN
  SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
  INTO STRICT original
  FROM pg_catalog.pg_proc p
  WHERE p.oid='public.gridex_fill_contract_price_snapshot_binding_v1()'::regprocedure;

  IF encode(sha256(convert_to(original.prosrc,'UTF8')),'hex')
       IS DISTINCT FROM '0eff3c13750ee0ec93ba30c173a4c201bafc7ce4a5d859a9d5daf019043093ba'
     OR (length(original.prosrc)-length(replace(original.prosrc,old_guard,'')))/length(old_guard)<>1 THEN
    RAISE EXCEPTION 'price_addendum_snapshot_guard_preimage_changed';
  END IF;
  candidate:=replace(original.prosrc,old_guard,new_guard);
  EXECUTE replace(original.definition,original.prosrc,candidate);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_catalog.pg_proc p WHERE p.oid=original.oid)
       IS DISTINCT FROM original.metadata THEN
    RAISE EXCEPTION 'price_addendum_snapshot_binding_metadata_changed';
  END IF;
END
$migration$;
