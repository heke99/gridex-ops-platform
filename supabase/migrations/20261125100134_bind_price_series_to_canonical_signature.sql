-- A source label cannot substitute for acceptance of the exact customer price.
DO $migration$
DECLARE
  target constant regprocedure :=
    'gridex_billing_source.lock_price_series_members_v1(uuid,uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure;
  predecessor constant text := 'aab2caf6dce9c94173ae3a74b347960bbda520dc371655eff1244aa50d316120';
  before_body text;
  definition text;
  before_metadata jsonb;
  old_clause constant text := $old$      AND s.pricing_model='fixed' AND s.source='issue_signed_terms'$old$;
  new_clause constant text := $new$      AND s.pricing_model='fixed'
      AND gridex_billing_source.has_canonical_signed_series_price_v1(
        p_company,p_customer,p_contract,s.id,start_at,end_at)$new$;
BEGIN
  SELECT p.prosrc,pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc'
  INTO STRICT before_body,definition,before_metadata FROM pg_proc p WHERE p.oid=target;
  IF encode(sha256(convert_to(before_body,'UTF8')),'hex') IS DISTINCT FROM predecessor
    OR (length(before_body)-length(replace(before_body,old_clause,'')))/length(old_clause)<>1 THEN
    RAISE EXCEPTION 'price_series_signature_owner_preimage_changed';
  END IF;

  EXECUTE $ddl$
    CREATE FUNCTION gridex_billing_source.has_canonical_signed_series_price_v1(
      p_company uuid,p_customer uuid,p_contract uuid,p_price uuid,p_start timestamptz,p_end timestamptz
    ) RETURNS boolean LANGUAGE sql STABLE STRICT SET search_path TO pg_catalog
    AS $body$
      SELECT EXISTS(
        SELECT 1
        FROM public.customer_contracts contract
        JOIN public.contract_price_snapshots price
          ON (price.company_id,price.customer_id,price.contract_id,price.id)
           =(p_company,p_customer,contract.id,p_price)
        JOIN public.customer_contract_signature_requests request
          ON request.id=CASE
            WHEN contract.signature_snapshot->>'signature_request_id' ~
                 '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
            THEN (contract.signature_snapshot->>'signature_request_id')::uuid END
          AND (request.company_id,request.customer_id,request.customer_contract_id)
             =(contract.company_id,contract.customer_id,contract.id)
          AND request.used_at=contract.signed_at AND request.revoked_at IS NULL
        JOIN public.customer_contract_evidence evidence
          ON (evidence.company_id,evidence.customer_contract_id,evidence.evidence_type,evidence.evidence_sha256)
           =(contract.company_id,contract.id,'online_acceptance',contract.signature_snapshot_sha256)
          AND evidence.evidence_snapshot=contract.signature_snapshot AND evidence.captured_at=request.used_at
        WHERE (contract.company_id,contract.customer_id,contract.id)=(p_company,p_customer,p_contract)
          AND contract.contract_price_snapshot_id=price.id
          AND contract.price_plan_version_id=price.price_plan_version_id
          AND price.source='signature_prepare' AND price.pricing_model='fixed'
          AND price.snapshot_quality='canonical'
          AND price.snapshot_schema_version='gridex_contract_pricing_v7_signed_receipt'
          AND price.snapshot_hash=encode(sha256(convert_to(price.snapshot_json::text,'UTF8')),'hex')
          AND isfinite(p_start) AND isfinite(p_end) AND p_start<p_end
          AND price.valid_from<=(p_start AT TIME ZONE 'Europe/Stockholm')::date
          AND (price.valid_to IS NULL OR
            price.valid_to>=((p_end-interval '1 microsecond') AT TIME ZONE 'Europe/Stockholm')::date)
          AND contract.signature_snapshot->>'schema'='gridex_online_contract_signature_v1'
          AND contract.signature_snapshot_sha256=
            encode(sha256(convert_to(contract.signature_snapshot::text,'UTF8')),'hex')
          AND (contract.signature_snapshot->>'company_id',contract.signature_snapshot->>'customer_id',
            contract.signature_snapshot->>'contract_id',contract.signature_snapshot->>'contract_price_snapshot_id',
            contract.signature_snapshot->>'price_plan_version_id',contract.signature_snapshot->>'pricing_snapshot_sha256')
           =(p_company::text,p_customer::text,p_contract::text,p_price::text,price.price_plan_version_id::text,price.snapshot_hash)
          AND request.metadata->>'contract_price_snapshot_id'=price.id::text
          AND request.metadata->>'price_plan_version_id'=price.price_plan_version_id::text
      )
    $body$
  $ddl$;
  REVOKE ALL ON FUNCTION gridex_billing_source.has_canonical_signed_series_price_v1(
    uuid,uuid,uuid,uuid,timestamptz,timestamptz
  ) FROM PUBLIC,anon,authenticated,service_role;

  EXECUTE replace(definition,before_body,replace(before_body,old_clause,new_clause));
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM before_metadata THEN
    RAISE EXCEPTION 'price_series_signature_owner_metadata_changed';
  END IF;
END
$migration$;
