-- Internal routing site is projected only for the same source-approved physical
-- point/customer/market version. This is not a market grant or historical site
-- approval. Missing or changed physical ownership remains held.
BEGIN;
ALTER FUNCTION gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz) RENAME TO supply_period_source_before_internal_site_v1;
CREATE FUNCTION gridex_received_sources.supply_period_source_basis_v1(p_company_id uuid,p_period_id uuid,p_start timestamptz,p_end timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.customer_supply_periods%rowtype;point public.metering_points%rowtype;site public.customer_sites%rowtype;
 basis jsonb;ids uuid[];version bigint;initial_id uuid;point_id uuid;customer_id uuid;own jsonb;
BEGIN
 IF p_company_id IS NULL OR p_period_id IS NULL OR p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) OR p_end<=p_start THEN RETURN NULL;END IF;
 SELECT * INTO p FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 -- Ordinary switch sites are already frozen in their immutable confirmation.
 IF EXISTS(SELECT FROM gridex_received_sources.normal_switch_confirmations proof WHERE proof.period_id=p.id AND proof.company_id=p_company_id) THEN
  RETURN gridex_received_sources.supply_period_source_before_internal_site_v1(p_company_id,p_period_id,p_start,p_end);
 END IF;
 -- Discovery grants nothing. Lock source -> physical point/site -> period,
 -- matching the native source writer, then let the sole owner requalify all
 -- immutable source/hash/current version/ground/legal/period criteria.
 version:=p.market_state_version;initial_id:=p.source_message_id;point_id:=p.metering_point_id;customer_id:=p.customer_id;
 SELECT array_agg(t.source_message_id) INTO ids FROM gridex_received_sources.supply_source_transitions t WHERE t.company_id=p_company_id AND EXISTS(SELECT FROM jsonb_array_elements(t.resulting_states) state WHERE state->>'id'=p.id::text AND (state->>'market_state_version')::bigint=version);
 IF coalesce(cardinality(ids),0)<>1 OR initial_id IS NULL OR point_id IS NULL OR customer_id IS NULL THEN RETURN NULL;END IF;
 PERFORM m.id FROM public.ediel_messages m WHERE m.company_id=p_company_id AND m.id=ANY(ARRAY[ids[1],initial_id]) ORDER BY m.id FOR UPDATE;
 SELECT * INTO point FROM public.metering_points WHERE id=point_id AND company_id=p_company_id FOR SHARE;
 IF point.id IS NULL OR point.customer_id IS DISTINCT FROM customer_id OR point.site_id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO site FROM public.customer_sites WHERE id=point.site_id AND company_id=p_company_id FOR SHARE;
 IF site.id IS NULL OR site.customer_id IS DISTINCT FROM customer_id THEN RETURN NULL;END IF;
 basis:=gridex_received_sources.supply_period_source_before_internal_site_v1(p_company_id,p_period_id,p_start,p_end);
 SELECT * INTO p FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id;
 IF basis IS NULL OR basis->>'qualified' IS DISTINCT FROM 'true' OR p.market_state_version IS DISTINCT FROM version OR p.source_message_id IS DISTINCT FROM initial_id OR p.metering_point_id IS DISTINCT FROM point_id OR p.customer_id IS DISTINCT FROM customer_id
  OR basis->>'periodId' IS DISTINCT FROM p.id::text OR basis->>'meteringPointId' IS DISTINCT FROM point.id::text OR basis->>'customerId' IS DISTINCT FROM customer_id::text OR (basis->>'marketStateVersion')::bigint IS DISTINCT FROM version OR jsonb_array_length(basis->'sourceObjects') IS DISTINCT FROM 1 THEN RETURN NULL;END IF;
 own:=basis#>'{sourceObjects,0}';
 IF nullif(own->>'point','') IS NULL OR own->>'point' IS DISTINCT FROM point.ediel_metering_point_id OR (own->>'identityAgency' IN('9','89')) IS NOT TRUE
  OR nullif(own->>'gridArea','') IS NULL OR own->>'gridArea' IS DISTINCT FROM point.grid_area_code OR nullif(basis->>'dsoEdielId','') IS NULL OR basis->>'dsoEdielId' IS DISTINCT FROM point.grid_owner_ediel_id THEN RETURN NULL;END IF;
 RETURN basis||jsonb_build_object('companyId',p_company_id,'siteId',site.id,'siteProjectionKind','current_owned_source_physical_point');
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz),gridex_received_sources.supply_period_source_before_internal_site_v1(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
