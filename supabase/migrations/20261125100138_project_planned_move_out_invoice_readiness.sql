-- Invoice readiness needs the qualified administrative close separately
-- from the market-ended and pricing projections. Keep existing receipts intact.
DO $migration$
DECLARE
  owner constant regprocedure := 'public.gridex_read_billing_underlay_source_basis_v1(uuid,uuid[])'::regprocedure;
  expected constant text := '4d5adf0ce61a312df97b434b88d48fb6e0cc590577da91dc16277db37f8bb4ac';
  original record;
  patched text;
BEGIN
  SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
  INTO STRICT original FROM pg_proc p WHERE p.oid=owner;
  IF encode(sha256(convert_to(original.prosrc,'UTF8')),'hex') IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'planned_move_out_invoice_readiness_owner_preimage_changed';
  END IF;

  patched:=replace(original.prosrc,
    $old$qualified boolean;ended_contract jsonb;$old$,
    $new$qualified boolean;ended_contract jsonb;planned_move_out boolean;correction_required boolean;$new$);
  patched:=replace(patched,
    $old$  IF qualified AND (b.source_basis->>'contractStatus'='terminated'
    OR gridex_billing_source.is_planned_move_out_underlay_v1(u,b.source_basis))$old$,
    $new$  planned_move_out:=qualified AND gridex_billing_source.is_planned_move_out_underlay_v1(u,b.source_basis);
  IF qualified AND (b.source_basis->>'contractStatus'='terminated' OR planned_move_out)$new$);
  patched:=replace(patched,
    $old$  result:=result||jsonb_build_array(jsonb_build_object('id',u.id,'qualified',qualified,'totalKwh',gridex_utilts_binding.canonical_decimal_v2(u.total_kwh::text),'sourceBasisHash',b.source_basis_hash,'correctionRequired',EXISTS(SELECT FROM gridex_billing_source.correction_journal j WHERE j.underlay_id=u.id)) || CASE WHEN ended_contract IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('terminatedPricingContract',ended_contract) END);$old$,
    $new$  correction_required:=EXISTS(SELECT FROM gridex_billing_source.correction_journal j WHERE j.underlay_id=u.id);
  result:=result||jsonb_build_array(jsonb_build_object('id',u.id,'qualified',qualified,'totalKwh',gridex_utilts_binding.canonical_decimal_v2(u.total_kwh::text),'sourceBasisHash',b.source_basis_hash,'correctionRequired',correction_required)
    || CASE WHEN ended_contract IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('terminatedPricingContract',ended_contract) END
    || CASE WHEN planned_move_out AND ended_contract IS NOT NULL AND NOT correction_required THEN
      jsonb_build_object('plannedMoveOutContractId',u.contract_id,'plannedMoveOutSupplyPeriodId',u.supply_period_id)
      ELSE '{}'::jsonb END);$new$);

  IF position('planned_move_out:=qualified' in patched)=0 OR position('plannedMoveOutSupplyPeriodId' in patched)=0
    OR position('correction_required boolean' in patched)=0 THEN
    RAISE EXCEPTION 'planned_move_out_invoice_readiness_owner_anchor_missing';
  END IF;
  EXECUTE replace(original.definition,original.prosrc,patched);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=original.oid) IS DISTINCT FROM original.metadata THEN
    RAISE EXCEPTION 'planned_move_out_invoice_readiness_owner_metadata_changed';
  END IF;
END
$migration$;
