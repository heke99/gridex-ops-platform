-- Apply the corresponding address owner and its migration receipt together.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_address_migration$
BEGIN
CREATE SCHEMA gridex_partner_postal_cache;
REVOKE ALL ON SCHEMA gridex_partner_postal_cache FROM public, anon, authenticated;
GRANT USAGE ON SCHEMA gridex_partner_postal_cache TO service_role;
CREATE TABLE gridex_partner_postal_cache.source_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision uuid NOT NULL DEFAULT gen_random_uuid()
);
REVOKE ALL ON gridex_partner_postal_cache.source_revision FROM public,anon,authenticated,service_role;
GRANT SELECT ON gridex_partner_postal_cache.source_revision TO service_role;
INSERT INTO gridex_partner_postal_cache.source_revision(singleton) VALUES (true);

CREATE FUNCTION gridex_partner_postal_cache.advance_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $advance$
BEGIN
  UPDATE gridex_partner_postal_cache.source_revision SET revision=gen_random_uuid() WHERE singleton;
  RETURN NULL;
END;
$advance$;
REVOKE ALL ON FUNCTION gridex_partner_postal_cache.advance_revision() FROM public,anon,authenticated,service_role;
CREATE TRIGGER gridex_partner_postal_revision
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.platform_postal_code_grid_mappings
FOR EACH STATEMENT EXECUTE FUNCTION gridex_partner_postal_cache.advance_revision();
CREATE TRIGGER gridex_partner_postal_revision
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.platform_grid_areas
FOR EACH STATEMENT EXECUTE FUNCTION gridex_partner_postal_cache.advance_revision();
CREATE TRIGGER gridex_partner_postal_revision
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.platform_grid_owners
FOR EACH STATEMENT EXECUTE FUNCTION gridex_partner_postal_cache.advance_revision();

CREATE INDEX customer_site_resolution_partner_postal_reuse_idx
ON public.customer_site_resolution (company_id,(source_claims->>'partner_postal_scope'),
  (source_claims->>'partner_postal_revision'),resolved_at DESC)
WHERE customer_id IS NULL AND customer_site_id IS NULL AND customer_application_id IS NULL
  AND source_claims ? 'partner_postal_scope';

CREATE FUNCTION public.gridex_get_partner_postal_resolution_v1(
  p_company_id uuid,p_scope_key text
) RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO ''
AS $lookup$
SELECT jsonb_build_object('revision',rev.revision,'cached',(
  SELECT jsonb_build_object('resolutionId',r.id,'resolvedAt',r.resolved_at,'expiresAt',r.expires_at,
      'resolverVersion',r.resolver_version,'snapshot',r.result_snapshot)
  FROM public.customer_site_resolution r
  WHERE r.company_id=p_company_id AND r.customer_id IS NULL AND r.customer_site_id IS NULL
    AND r.customer_application_id IS NULL AND r.source_claims ? 'partner_postal_scope'
    AND r.source_claims->>'partner_postal_scope'=p_scope_key
    AND r.source_claims->>'partner_postal_revision'=rev.revision::text
    AND r.resolution_status='postal_suggested' AND r.price_area_assurance_status='estimated'
    AND r.price_area_assurance_source IN ('postal_consensus','postal_city_consensus')
    AND r.price_area_unique_count=1 AND r.price_area_assurance_confidence>=0.8
    AND r.expires_at>statement_timestamp()
  ORDER BY r.resolved_at DESC LIMIT 1
))
FROM gridex_partner_postal_cache.source_revision rev WHERE rev.singleton
  AND p_company_id IS NOT NULL AND p_scope_key ~ '^[0-9a-f]{64}$';
$lookup$;
REVOKE ALL ON FUNCTION public.gridex_get_partner_postal_resolution_v1(uuid,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_get_partner_postal_resolution_v1(uuid,text) TO service_role;

CREATE FUNCTION public.gridex_save_partner_postal_resolution_v1(
  p_company_id uuid,p_scope_key text,p_expected_revision uuid,p_resolution jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $save$
DECLARE
  v_revision uuid;
  v_entry public.customer_site_resolution%ROWTYPE;
  v_cache jsonb;
  v_id uuid;
BEGIN
  IF p_company_id IS NULL OR p_expected_revision IS NULL OR NOT coalesce(p_scope_key ~ '^[0-9a-f]{64}$',false)
      OR jsonb_typeof(p_resolution) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='partner_postal_scope_invalid';
  END IF;

  -- Durable serialization across worker processes. Each request still uses the
  -- canonical pricing-readable immutable resolution table and original expiry.
  PERFORM pg_advisory_xact_lock(hashtextextended('gridex_partner_postal:'||p_company_id||':'||p_scope_key,0));
  SELECT revision INTO STRICT v_revision FROM gridex_partner_postal_cache.source_revision WHERE singleton FOR SHARE;
  IF v_revision<>p_expected_revision THEN RETURN jsonb_build_object('revisionChanged',true); END IF;
  v_cache := public.gridex_get_partner_postal_resolution_v1(p_company_id,p_scope_key)->'cached';
  IF jsonb_typeof(v_cache)='object' THEN RETURN jsonb_build_object('cached',v_cache); END IF;

  SELECT * INTO v_entry FROM jsonb_populate_record(NULL::public.customer_site_resolution,p_resolution);
  IF v_entry.company_id IS DISTINCT FROM p_company_id OR v_entry.customer_id IS NOT NULL
    OR v_entry.customer_site_id IS NOT NULL OR v_entry.customer_application_id IS NOT NULL
    OR v_entry.input_snapshot#>>'{metadata,source_channel}' IS DISTINCT FROM 'partner_api'
    OR v_entry.input_snapshot#>>'{metadata,partner_surface}' IS DISTINCT FROM 'business_v1'
    OR v_entry.input_snapshot->>'street' IS NOT NULL OR v_entry.input_snapshot->>'country' IS DISTINCT FROM 'SE'
    OR NOT coalesce(v_entry.input_snapshot->>'postalCode' ~ '^[0-9]{5}$',false)
    OR v_entry.resolution_status IS DISTINCT FROM 'postal_suggested'
    OR v_entry.price_area_assurance_status IS DISTINCT FROM 'estimated'
    OR NOT coalesce(v_entry.price_area_assurance_source IN ('postal_consensus','postal_city_consensus'),false)
    OR v_entry.price_area_unique_count IS DISTINCT FROM 1 OR NOT coalesce(v_entry.price_area_assurance_confidence>=0.8,false)
    OR jsonb_typeof(v_entry.source_claims) IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_entry.result_snapshot) IS DISTINCT FROM 'object'
    OR NOT coalesce(v_entry.expires_at>clock_timestamp(),false)
    OR v_entry.automation_allowed IS DISTINCT FROM false THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='partner_postal_evidence_invalid';
  END IF;

  INSERT INTO public.customer_site_resolution (
    company_id,customer_id,customer_site_id,customer_application_id,grid_owner_id,grid_area_code,grid_area_name,grid_owner_name,
    price_area,price_area_assurance_status,price_area_assurance_source,price_area_assurance_confidence,price_area_assurance_source_version,
    price_area_candidate_count,price_area_unique_count,price_area_evidence,resolution_status,confidence,source_chain,input_snapshot,
    result_snapshot,automation_allowed,next_required_action,resolved_at,expires_at,resolver_version,geodata_version,source_claims,
    conflict_code,updated_at
  ) VALUES (
    v_entry.company_id,NULL,NULL,NULL,v_entry.grid_owner_id,v_entry.grid_area_code,v_entry.grid_area_name,v_entry.grid_owner_name,
    v_entry.price_area,v_entry.price_area_assurance_status,v_entry.price_area_assurance_source,v_entry.price_area_assurance_confidence,
    v_entry.price_area_assurance_source_version,v_entry.price_area_candidate_count,v_entry.price_area_unique_count,
    v_entry.price_area_evidence,v_entry.resolution_status,v_entry.confidence,v_entry.source_chain,v_entry.input_snapshot,
    v_entry.result_snapshot,false,v_entry.next_required_action,v_entry.resolved_at,v_entry.expires_at,v_entry.resolver_version,
    v_entry.geodata_version,v_entry.source_claims || jsonb_build_object('partner_postal_scope',p_scope_key,'partner_postal_revision',v_revision),
    v_entry.conflict_code,v_entry.updated_at
  ) RETURNING id INTO v_id;
  INSERT INTO public.canonical_energy_flow_events(event_type,company_id,event_scope,resolution_id,source,payload)
  VALUES ('energy_area.resolved',p_company_id,'tenant',v_id,'ops_energy_resolver',
    jsonb_build_object(
      'price_area',v_entry.price_area,'grid_area_code',v_entry.grid_area_code,'grid_owner_id',v_entry.grid_owner_id,
      'resolution_status',v_entry.resolution_status,'confidence',v_entry.result_snapshot->'confidence',
      'price_area_assurance',v_entry.result_snapshot->'priceAreaAssurance','automation_allowed',false,
      'resolver_version',v_entry.resolver_version,'geodata_version',v_entry.geodata_version,'conflict_code',v_entry.conflict_code
    ));
  RETURN jsonb_build_object('resolutionId',v_id);
END;
$save$;
REVOKE ALL ON FUNCTION public.gridex_save_partner_postal_resolution_v1(uuid,text,uuid,jsonb) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_save_partner_postal_resolution_v1(uuid,text,uuid,jsonb) TO service_role;
END
$gridex_address_migration$;
RESET statement_timeout;
RESET lock_timeout;
