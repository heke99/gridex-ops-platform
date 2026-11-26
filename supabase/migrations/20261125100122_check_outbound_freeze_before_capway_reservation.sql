DO $dispatch_outbound_freeze$
DECLARE
  owner constant regprocedure := 'public.gridex_reserve_capway_dispatch_entry_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,text,text,text,text,text)'::regprocedure;
  anchor constant text := $anchor$  INSERT INTO gridex_capway_dispatch.entries(company_id,item_id,phase,lease_token,actor_id,request_hash,provider_key,target_guid)$anchor$;
  guard constant text := $guard$  -- Reuse the locked company snapshot before granting a new transport phase.
  -- Existing phases still take the ordinary duplicate-reservation path.
  IF (company.outbound_frozen IS TRUE
      OR company.outbound_frozen_channels && ARRAY['invoice_export','*']::text[])
     AND NOT EXISTS (
       SELECT FROM gridex_capway_dispatch.entries existing_entry
       WHERE existing_entry.company_id=p_company AND existing_entry.item_id=p_item AND existing_entry.phase=p_phase
     ) THEN
    RAISE EXCEPTION 'invoice_export_outbound_frozen' USING ERRCODE='23514';
  END IF;

  INSERT INTO gridex_capway_dispatch.entries(company_id,item_id,phase,lease_token,actor_id,request_hash,provider_key,target_guid)$guard$;
  prior_sha256 constant text := '429f43e229ca7796432a16a54568ba52d840644259a71b249c095ff088358a9f';
  next_sha256 constant text := 'fab80682da0b128c26ffaeb739b17ba9e6cf464e1dbd9703799176799c0b4ed5';
  definition text;
  body text;
  metadata jsonb;
  actual_sha256 text;
  next_body text;
BEGIN
  SELECT pg_get_functiondef(oid),prosrc,to_jsonb(p)-'prosrc'
    INTO STRICT definition,body,metadata FROM pg_proc p WHERE oid=owner;
  actual_sha256:=encode(sha256(convert_to(body,'UTF8')),'hex');
  IF actual_sha256=next_sha256 THEN RETURN; END IF;
  IF actual_sha256 IS DISTINCT FROM prior_sha256
     OR (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN
    RAISE EXCEPTION 'capway_outbound_freeze_predecessor_changed';
  END IF;
  next_body:=replace(body,anchor,guard);
  EXECUTE replace(definition,body,next_body);
  IF NOT EXISTS (
    SELECT FROM pg_proc p WHERE p.oid=owner
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=next_sha256
      AND to_jsonb(p)-'prosrc'=metadata
  ) THEN RAISE EXCEPTION 'capway_outbound_freeze_replacement_failed'; END IF;
END
$dispatch_outbound_freeze$;
