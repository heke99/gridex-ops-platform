-- Compatible F114 read basis; deploy this before the application snapshot producer.
-- Row text is opaque across JavaScript so JSONB numeric precision is preserved.
BEGIN;
CREATE FUNCTION public.ediel_inbound_graph_snapshot_basis_v1(p_company_id uuid,p_customer_id uuid,p_site_id uuid,p_metering_point_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE customer_text text;site_text text;point_text text;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN
  RAISE EXCEPTION 'ediel_inbound_graph_basis_service_required' USING ERRCODE='42501';
 END IF;
 -- The delta-only app protocol must never reach the legacy overwrite core.
 -- During helper -> app -> mandatory-core rollout, hold safely until the exact
 -- reviewed mandatory core is installed; there is no legacy write fallback.
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.gridex_onboard_customer_graph_core(jsonb)'))
   IS DISTINCT FROM '24f5c95224de6a75cd9e42537f1029b3' THEN
  RAISE EXCEPTION 'ediel_inbound_graph_core_not_ready' USING ERRCODE='55000';
 END IF;
 IF p_company_id IS NULL THEN RAISE EXCEPTION 'ediel_inbound_graph_basis_company_required' USING ERRCODE='22023';END IF;
 SELECT to_jsonb(c)::text INTO customer_text FROM public.customers c WHERE c.company_id=p_company_id AND c.id=p_customer_id;
 IF customer_text IS NOT NULL THEN
  SELECT to_jsonb(s)::text INTO site_text FROM public.customer_sites s WHERE s.company_id=p_company_id AND s.customer_id=p_customer_id AND s.id=p_site_id;
  SELECT to_jsonb(m)::text INTO point_text FROM public.metering_points m WHERE m.company_id=p_company_id AND m.customer_id=p_customer_id AND m.id=p_metering_point_id;
 END IF;
 RETURN jsonb_build_object('customer',customer_text,'site',site_text,'metering_point',point_text);
END$$;
REVOKE ALL ON FUNCTION public.ediel_inbound_graph_snapshot_basis_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_inbound_graph_snapshot_basis_v1(uuid,uuid,uuid,uuid) TO service_role;

-- Internal core helper; no caller receives new write authority from a mask.
-- Only keys in the existing command are considered. Non-wire keys come from
-- the exact locked database row; metadata receives only the original delta.
CREATE FUNCTION public.ediel_preserve_inbound_graph_payload_v1(current_row jsonb,payload jsonb,directive jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE k text;v jsonb;result jsonb:=payload;wire jsonb:=directive->'wire_keys';delta jsonb:=directive->'metadata_delta';
BEGIN
 IF jsonb_typeof(current_row) IS DISTINCT FROM 'object' OR jsonb_typeof(payload) IS DISTINCT FROM 'object'
  OR jsonb_typeof(directive) IS DISTINCT FROM 'object' OR NOT directive?&ARRAY['wire_keys','metadata_delta']
  OR (SELECT count(*) FROM jsonb_object_keys(directive))<>2
  OR jsonb_typeof(wire) IS DISTINCT FROM 'array' OR jsonb_typeof(delta) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT FROM jsonb_array_elements(wire)e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string' OR NOT payload?(e#>>'{}'))
  OR (SELECT count(*) FROM jsonb_array_elements(wire))<>(SELECT count(DISTINCT e#>>'{}') FROM jsonb_array_elements(wire)e) THEN
  RAISE EXCEPTION 'ediel_inbound_graph_preservation_required' USING ERRCODE='22023';
 END IF;
 FOR k,v IN SELECT key,value FROM jsonb_each(payload) LOOP
  IF k='metadata' THEN
   IF jsonb_typeof(current_row->k) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'ediel_inbound_existing_metadata_object_required' USING ERRCODE='22023';
   END IF;
   result:=jsonb_set(result,ARRAY[k],(current_row->k)||delta);
  ELSIF NOT wire?k THEN
   IF current_row?k THEN result:=jsonb_set(result,ARRAY[k],current_row->k);ELSE result:=result-k;END IF;
  END IF;
 END LOOP;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.ediel_preserve_inbound_graph_payload_v1(jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
