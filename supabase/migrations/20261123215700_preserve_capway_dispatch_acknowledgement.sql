DO $migration$
BEGIN
CREATE FUNCTION public.gridex_record_capway_dispatch_ack_v1(
 p_company uuid,p_item uuid,p_entry uuid,p_lease uuid,p_ack jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s'
AS $function$
DECLARE
  reserved gridex_capway_dispatch.entries%ROWTYPE;
  acknowledgement_hash text;
  invoice_guid text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'capway_dispatch_service_role_required' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(p_ack) IS DISTINCT FROM 'object' OR p_ack='{}'::jsonb THEN
    RAISE EXCEPTION 'capway_dispatch_ack_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO STRICT reserved FROM gridex_capway_dispatch.entries
    WHERE company_id=p_company AND item_id=p_item AND entry_id=p_entry AND lease_token=p_lease FOR UPDATE;
  IF reserved.phase='create' AND
    (p_ack->>'reconciled'='true' OR jsonb_typeof(p_ack->'invoiceGuids') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_ack->'invoiceGuids')<>1
      OR nullif(btrim(p_ack#>>'{invoiceGuids,0}'),'') IS NULL) THEN
    RAISE EXCEPTION 'capway_dispatch_ack_invalid' USING ERRCODE='22023';
  END IF;
  acknowledgement_hash:=encode(sha256(convert_to(p_ack::text,'UTF8')),'hex');
  IF reserved.provider_ack_sha256 IS NOT NULL THEN
    IF reserved.provider_ack_sha256 IS DISTINCT FROM acknowledgement_hash THEN
      RAISE EXCEPTION 'capway_dispatch_ack_changed' USING ERRCODE='23514';
    END IF;
    RETURN reserved.entry_id;
  END IF;
  -- A later withdrawal can prohibit another transport without rewriting the
  -- fact that this reserved request already got its direct partner response.
  IF reserved.phase='create' THEN invoice_guid:=p_ack#>>'{invoiceGuids,0}'; END IF;
  UPDATE gridex_capway_dispatch.entries
    SET provider_ack_sha256=acknowledgement_hash,provider_invoice_guid=invoice_guid,partner_ack_at=clock_timestamp()
    WHERE entry_id=reserved.entry_id;
  RETURN reserved.entry_id;
END
$function$;
REVOKE ALL ON FUNCTION public.gridex_record_capway_dispatch_ack_v1(uuid,uuid,uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_record_capway_dispatch_ack_v1(uuid,uuid,uuid,uuid,jsonb) TO service_role;

-- The normal draft graph writes pending:<same item>. The already-verified
-- receipt may replace that exact placeholder, preserving foreign references.
DO $mirror$
DECLARE
  prior record;
  old_predicate constant text:=$before$    and (partner_invoice_reference is null or partner_invoice_reference = p_invoice_guid);$before$;
  new_predicate constant text:=$after$    and (partner_invoice_reference is null or partner_invoice_reference = p_invoice_guid
      or partner_invoice_reference = 'pending:'||item.id::text);$after$;
BEGIN
  SELECT oid,prosrc,pg_get_functiondef(oid) AS definition,to_jsonb(proc)-'prosrc' AS metadata
    INTO STRICT prior FROM pg_proc proc
    WHERE oid='public.gridex_finalize_automatic_invoice_purchase_ack_v1(uuid,uuid,uuid,text,text,text,integer,timestamptz,jsonb,jsonb,uuid,timestamptz,date)'::regprocedure;
  IF encode(sha256(convert_to(prior.prosrc,'UTF8')),'hex')<>'6fc3d420c010ee30fa2b331c062d91cf3ee88af24da5e9fee18cc37dc25e2e7d' THEN
    RAISE EXCEPTION 'capway_dispatch_purchase_mirror_predecessor_changed';
  END IF;
  EXECUTE replace(prior.definition,prior.prosrc,replace(prior.prosrc,old_predicate,new_predicate));
  IF (SELECT to_jsonb(proc)-'prosrc' FROM pg_proc proc WHERE oid=prior.oid) IS DISTINCT FROM prior.metadata
    OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=prior.oid)<>'f97e5715701eeeb4dcc762e38ba83d65fdc161304647dc862fc4e016d110cdd4' THEN
    RAISE EXCEPTION 'capway_dispatch_purchase_mirror_metadata_changed';
  END IF;
END
$mirror$;

NOTIFY pgrst,'reload schema';
END
$migration$;
