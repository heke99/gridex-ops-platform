DO $migration$
DECLARE
  owner_signature constant regprocedure :=
    'gridex_billing_source.require_contract_price_timeline_v1(uuid,uuid,uuid,timestamptz,timestamptz,jsonb)'::regprocedure;
  definition text := pg_get_functiondef(owner_signature);
  old_raise constant text := $old$RAISE EXCEPTION 'billing_price_timeline_changed' USING ERRCODE='PT409';$old$;
  new_raise constant text := $new$RAISE EXCEPTION 'billing_price_timeline_changed' USING ERRCODE='PT409',
   DETAIL=jsonb_build_object('companyId',p_company,'contractId',p_contract)::text;$new$;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=owner_signature) IS DISTINCT FROM 'f0de1a07420bf3b04d00d8971a6e2b76'
     OR (length(definition)-length(replace(definition,old_raise,'')))/length(old_raise)<>1
  THEN
    RAISE EXCEPTION 'billing_price_timeline_conflict_scope_predecessor_changed';
  END IF;
  EXECUTE replace(definition,old_raise,new_raise);
END
$migration$;
