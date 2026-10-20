-- FINDINGS F60: a manual intake with an uploaded signed agreement already
-- binds the contract to a canonical, hashed price snapshot valid from the
-- contract start (the same snapshot online signing signs). The import trigger
-- gridex_finalize_admin_imported_signed_agreement_v1 then always inserted a
-- second receipt snapshot with that same contract and valid_from, which the
-- unique index contract_price_snapshots_contract_valid_from_uidx refuses, so
-- no signed agreement could ever be imported (production: 0 imports). The
-- import now signs the snapshot the contract is bound to when it belongs to
-- the same tenant, contract, customer and price plan version, is hashed and
-- starts on the contract start; otherwise the receipt is created as before.
-- Body rewritten in place with metadata/OID preserved.
BEGIN;

DO $rewrite$DECLARE f record;body text;
 target CONSTANT text:='public.gridex_finalize_admin_imported_signed_agreement_v1()';
 needle_insert CONSTANT text:=$n$  insert into public.contract_price_snapshots($n$;
 replacement_insert CONSTANT text:=$r$  select * into v_price
  from public.contract_price_snapshots s
  where s.id = v_contract.contract_price_snapshot_id
    and s.company_id = v_contract.company_id
    and s.contract_id = v_contract.id
    and s.customer_id = v_contract.customer_id
    and s.price_plan_version_id is not distinct from v_contract.price_plan_version_id
    and nullif(s.snapshot_hash, '') is not null
    and s.valid_from = coalesce(v_contract.starts_at::date, current_date);
  if found then
    v_snapshot := v_price.snapshot_json;
  else
  insert into public.contract_price_snapshots($r$;
 needle_end CONSTANT text:=$n$  ) returning * into v_price;
  v_snapshot_id := v_price.id;$n$;
 replacement_end CONSTANT text:=$r$  ) returning * into v_price;
  end if;
  v_snapshot_id := v_price.id;$r$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=target::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle_insert,'')))/length(needle_insert)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,needle_end,'')))/length(needle_end)<>1 THEN
  RAISE EXCEPTION 'signed_import_snapshot_reuse_predecessor_required';
 END IF;
 body:=replace(replace(f.prosrc,needle_insert,replacement_insert),needle_end,replacement_end);
 EXECUTE replace(f.definition,f.prosrc,body);
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'signed_import_snapshot_reuse_metadata_changed';END IF;
END$rewrite$;

COMMIT;
