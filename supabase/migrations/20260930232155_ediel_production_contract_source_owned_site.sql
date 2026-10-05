-- Source-owned internal site is required by the ordinary intent/native scope.
-- It is a projection of the already qualified production contract's own point.
BEGIN;
ALTER FUNCTION gridex_received_sources.production_contract_source_for_execution_v1(uuid,uuid,uuid,text) RENAME TO production_contract_source_before_site_v1;
CREATE FUNCTION gridex_received_sources.production_contract_source_for_execution_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid,p_permission text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE basis jsonb;point public.metering_points%rowtype;site public.customer_sites%rowtype;
BEGIN
 basis:=gridex_received_sources.production_contract_source_before_site_v1(p_company_id,p_event_id,p_actor_user_id,p_permission);
 IF basis->>'status' IS DISTINCT FROM 'authorized' THEN RETURN basis;END IF;
 SELECT * INTO point FROM public.metering_points WHERE id=(basis->>'meteringPointId')::uuid AND company_id=p_company_id FOR SHARE;
 SELECT * INTO site FROM public.customer_sites WHERE id=point.site_id AND company_id=p_company_id FOR SHARE;
 IF point.id IS NULL OR point.customer_id::text IS DISTINCT FROM basis->>'customerId' OR point.site_id IS NULL OR site.id IS NULL OR site.customer_id IS DISTINCT FROM point.customer_id THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_source_owned_site_required'));END IF;
 RETURN basis||jsonb_build_object('siteId',site.id);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.production_contract_source_for_execution_v1(uuid,uuid,uuid,text),gridex_received_sources.production_contract_source_before_site_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
