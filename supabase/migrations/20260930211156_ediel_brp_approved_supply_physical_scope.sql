-- B is authorized for the actual approved supply object and counterpart.
-- A mutable mapping on the same MP UUID cannot establish a new legal relation.
-- No historical origin, actor profile, approval or provider outcome is changed.
BEGIN;
ALTER FUNCTION gridex_brp_changes.context_v1(uuid,uuid,uuid,boolean)
  RENAME TO context_before_supply_physical_scope_v1;
REVOKE ALL ON FUNCTION gridex_brp_changes.context_before_supply_physical_scope_v1(uuid,uuid,uuid,boolean)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_brp_changes.context_v1(c uuid,event uuid,actor uuid,notice boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE basis jsonb; supply jsonb;
BEGIN
  basis:=gridex_brp_changes.context_before_supply_physical_scope_v1(c,event,actor,notice);
  IF basis->>'status' IS DISTINCT FROM 'authorized' THEN RETURN basis; END IF;
  -- The same normal/regulated source owner holds its initial source and current
  -- relation version. Its object projection is scoped to this approved period.
  supply:=gridex_received_sources.supply_period_source_basis_v1(
    c,(basis->>'supplyPeriodId')::uuid,(basis->>'effectiveAt')::timestamptz,
    (basis->>'effectiveAt')::timestamptz+interval '1 minute');
  IF supply IS NULL OR supply->>'qualified' IS DISTINCT FROM 'true'
     OR supply->>'marketStateVersion' IS DISTINCT FROM basis->>'supplyStateVersion'
     OR supply->>'sourceMessageId' IS DISTINCT FROM basis->>'supplySourceMessageId'
     OR supply->>'dsoEdielId' IS DISTINCT FROM basis->>'legalReceiverId'
     OR jsonb_typeof(supply->'sourceObjects') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('status','held','missing',ARRAY['brp_approved_source_object_and_counterpart']);
  END IF;
  IF jsonb_array_length(supply->'sourceObjects')<>1
     OR (SELECT count(*) FROM jsonb_array_elements(supply->'sourceObjects') own
         WHERE own->>'point'=basis->>'pointId'
           AND own->>'identityAgency'=basis->>'identityAgency'
           AND own->>'gridArea'=basis->>'gridArea')<>1 THEN
    RETURN jsonb_build_object('status','held','missing',ARRAY['brp_approved_source_object_and_counterpart']);
  END IF;
  -- Keep the frozen origin basis unchanged; this strengthens current admission
  -- rather than inventing a new historical approval from today's mapping.
  RETURN basis;
END $$;
REVOKE ALL ON FUNCTION gridex_brp_changes.context_v1(uuid,uuid,uuid,boolean)
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
