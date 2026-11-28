-- Preserve the standard non-charging invoice component emitted by the canonical contract signer.
DO $migration$
BEGIN
  EXECUTE $ddl$
    CREATE FUNCTION gridex_billing_source.has_zero_only_addendum_invoice_fee_v1(components jsonb)
    RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path TO pg_catalog AS $body$
      SELECT CASE WHEN jsonb_typeof(components)='array' THEN
        jsonb_array_length(components)=0 OR (
          jsonb_array_length(components)=1 AND
          components#>>'{0,component_code}'='invoice_fee' AND
          components#>>'{0,component_type}'='invoice_fee' AND
          components#>>'{0,calculation_type}'='per_invoice' AND
          components#>>'{0,unit}'='sek_invoice' AND
          components#>>'{0,status}'='active' AND
          components#>>'{0,metadata,lifecycle}'='per_invoice' AND
          components#>'{0,amount}'='0'::jsonb
        ) ELSE false END
    $body$
  $ddl$;
  REVOKE ALL ON FUNCTION gridex_billing_source.has_zero_only_addendum_invoice_fee_v1(jsonb)
    FROM PUBLIC,anon,authenticated,service_role;

  DECLARE
    owner record;
    old record;
    candidate text;
    required_anchors integer;
  BEGIN
    FOR owner IN SELECT * FROM (VALUES
      ('activate','public.gridex_activate_test_contract_price_addendum_v1(uuid,uuid,uuid,uuid,uuid,text)',
        'e87e26af09f178e23c2f313c8241bc13c0c043bf4510ad4b6639148fb945eadf'),
      ('insert_check','gridex_billing_source.check_test_price_addendum_snapshot_insert_v1(public.contract_price_snapshots)',
        'd278a112dda4788079e3dab121d78bd472608182c804f4e4545d815b295cf522'),
      ('timeline','gridex_billing_source.resolve_test_contract_price_timeline_v1(uuid,uuid,uuid,timestamptz,timestamptz)',
        'ce73aaab3dcf1f5947f625481b024cb191ee36a87952df6ceb7d657d98122841')
    ) owners(kind,signature,digest) LOOP
      SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
      INTO STRICT old FROM pg_proc p WHERE p.oid=owner.signature::regprocedure;
      IF encode(sha256(convert_to(old.prosrc,'UTF8')),'hex') IS DISTINCT FROM owner.digest THEN
        RAISE EXCEPTION 'price_addendum_zero_fee_owner_preimage_changed: %',owner.signature;
      END IF;
      IF owner.kind='activate' THEN
        candidate:=replace(old.prosrc,$old$          OR original.price_components_snapshot<>'[]'::jsonb$old$,
          $new$          OR gridex_billing_source.has_zero_only_addendum_invoice_fee_v1(original.price_components_snapshot) IS NOT TRUE$new$);
        candidate:=replace(candidate,$old$'base_components',components,'price_components','[]'::jsonb)$old$,
          $new$'base_components',components,'price_components',original.price_components_snapshot)$new$);
        candidate:=replace(candidate,$old$'price_components_snapshot','[]'::jsonb);$old$,
          $new$'price_components_snapshot',original.price_components_snapshot);$new$);
        candidate:=replace(candidate,$old$applied.price_book_id,'fixed',components,'[]'::jsonb,frozen,$old$,
          $new$applied.price_book_id,'fixed',components,original.price_components_snapshot,frozen,$new$);
        required_anchors:=(length(candidate)-length(replace(candidate,'original.price_components_snapshot','')))
          /length('original.price_components_snapshot');
        IF required_anchors<>4 THEN RAISE EXCEPTION 'price_addendum_zero_fee_activation_anchors_missing'; END IF;
      ELSIF owner.kind='insert_check' THEN
        candidate:=replace(old.prosrc,$old$          AND successor.price_components_snapshot='[]'::jsonb$old$,
          $new$          AND successor.price_components_snapshot=version.snapshot_json->'price_components'
          AND gridex_billing_source.has_zero_only_addendum_invoice_fee_v1(successor.price_components_snapshot) IS TRUE$new$);
      ELSE
        candidate:=replace(old.prosrc,$old$            AND v.snapshot_json->'base_components'=successor.base_price_components_snapshot)$old$,
          $new$            AND v.snapshot_json->'base_components'=successor.base_price_components_snapshot
            AND v.snapshot_json->'price_components'=successor.price_components_snapshot)
        OR successor.price_components_snapshot IS DISTINCT FROM original.price_components_snapshot
        OR gridex_billing_source.has_zero_only_addendum_invoice_fee_v1(successor.price_components_snapshot) IS NOT TRUE$new$);
      END IF;
      IF candidate=old.prosrc THEN RAISE EXCEPTION 'price_addendum_zero_fee_anchor_missing: %',owner.signature; END IF;
      EXECUTE replace(old.definition,old.prosrc,candidate);
      IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=old.oid) IS DISTINCT FROM old.metadata THEN
        RAISE EXCEPTION 'price_addendum_zero_fee_metadata_changed: %',owner.signature;
      END IF;
    END LOOP;
  END;
END
$migration$;
