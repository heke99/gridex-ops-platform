-- AI/customer consumers use actual immutable E epochs, then the SAME protected
-- primary owner/availability projection. No global customer row/history chooser.
CREATE FUNCTION public.ediel_customer_life_event_boundaries_v1(p_company_id uuid,p_customer_id uuid,p_actor_user_id uuid,p_from timestamptz,p_to timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE epoch timestamptz;projection jsonb;boundaries jsonb:='[]';BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_life_event_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_customer_life_events.require_actor_v1(p_company_id,p_actor_user_id,'read');
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>=p_to THEN RAISE EXCEPTION 'customer_life_event_boundary_period_required';END IF;
 IF NOT EXISTS(SELECT FROM public.customers WHERE id=p_customer_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'customer_life_event_projection_tenant_scope_required';END IF;
 -- Source locks use the same order as mutation owners. Source assessments and
 -- their availability cannot change between epoch discovery and projection.
 PERFORM m.id FROM public.ediel_messages m WHERE m.company_id=p_company_id AND m.id IN(SELECT v.source_message_id FROM gridex_customer_life_events.customer_versions v WHERE v.company_id=p_company_id AND v.customer_id=p_customer_id AND v.effective_at<p_to) ORDER BY m.id FOR UPDATE;
 projection:=public.ediel_customer_life_event_export_at_v1(p_company_id,p_customer_id,p_actor_user_id,p_from);
 IF projection->>'status'='held' THEN RETURN projection;END IF;
 FOR epoch IN SELECT DISTINCT effective_at FROM gridex_customer_life_events.customer_versions WHERE company_id=p_company_id AND customer_id=p_customer_id AND effective_at>=p_from AND effective_at<p_to ORDER BY effective_at LOOP
  projection:=public.ediel_customer_life_event_export_at_v1(p_company_id,p_customer_id,p_actor_user_id,epoch);
  IF projection->>'status' IS DISTINCT FROM 'authorized' OR (projection->>'effectiveVersionCount')::integer<1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['qualified_customer_event_epoch_projection']);END IF;
  boundaries:=boundaries||jsonb_build_array(jsonb_build_object('effectiveAt',epoch,'sourceMessageId',projection->>'sourceMessageId','customerVersion',projection->'customerVersion','projection',projection));
 END LOOP;
 RETURN jsonb_build_object('status','authorized','companyId',p_company_id,'customerId',p_customer_id,'from',p_from,'to',p_to,'boundaries',boundaries);
END$$;
REVOKE ALL ON FUNCTION public.ediel_customer_life_event_boundaries_v1(uuid,uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_customer_life_event_boundaries_v1(uuid,uuid,uuid,timestamptz,timestamptz) TO service_role;
