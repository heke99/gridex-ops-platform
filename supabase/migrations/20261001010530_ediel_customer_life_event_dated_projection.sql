-- Forward dated source projection. The existing current-time reader remains
-- unchanged. Earlier unknown values are held rather than inferred from today's
-- customer scalars, invoicee fields, or installation address.
CREATE FUNCTION public.ediel_customer_life_event_export_at_v1(p_company_id uuid,p_customer_id uuid,p_actor_user_id uuid,p_as_of timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v gridex_customer_life_events.customer_versions%rowtype;tr gridex_customer_life_events.transitions%rowtype;a gridex_received_sources.object_assessments%rowtype;sc jsonb;entry jsonb;own jsonb;
 patch jsonb:='{}';address jsonb:='{}';fields text[];n text;phase text;version_count integer:=0;last_source uuid;last_version bigint;BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_life_event_service_required' USING ERRCODE='42501';END IF;
 IF p_as_of IS NULL OR NOT isfinite(p_as_of) THEN RAISE EXCEPTION 'customer_life_event_export_date_required';END IF;
 IF NOT EXISTS(SELECT FROM gridex_customer_life_events.customer_versions WHERE company_id=p_company_id AND customer_id=p_customer_id) THEN RETURN jsonb_build_object('status','not_applicable');END IF;
 phase:=CASE WHEN coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.read'),false) THEN 'read' WHEN coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write'),false) THEN 'prepare' ELSE 'send' END;
 PERFORM gridex_customer_life_events.require_actor_v1(p_company_id,p_actor_user_id,phase);
 IF NOT EXISTS(SELECT FROM public.customers WHERE id=p_customer_id AND company_id=p_company_id) THEN RAISE EXCEPTION 'customer_life_event_projection_tenant_scope_required';END IF;
 FOR v IN SELECT * FROM gridex_customer_life_events.customer_versions WHERE company_id=p_company_id AND customer_id=p_customer_id AND effective_at<=p_as_of ORDER BY effective_at,version LOOP
  SELECT * INTO tr FROM gridex_customer_life_events.transitions WHERE source_message_id=v.source_message_id AND company_id=p_company_id;
  IF (SELECT count(*) FROM gridex_received_sources.object_assessments oa WHERE oa.source_message_id=v.source_message_id AND oa.company_id=p_company_id AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=oa.id))<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_primary_customer_event_owner']);END IF;
  SELECT oa.* INTO a FROM gridex_received_sources.object_assessments oa JOIN gridex_received_sources.object_availability_witnesses aw ON aw.assessment_id=oa.id AND aw.company_id=oa.company_id AND aw.environment=oa.environment AND aw.source_message_id=oa.source_message_id AND aw.facts_hash=oa.facts_hash
   WHERE oa.source_message_id=v.source_message_id AND oa.company_id=p_company_id AND oa.source_payload_hash=tr.payload_hash AND oa.facts_hash=encode(sha256(convert_to(oa.facts_text,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=oa.id);
  IF a.id IS NULL OR jsonb_typeof(a.facts_text::jsonb->'objects') IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['committed_primary_customer_event_availability']);END IF;
  FOR sc IN SELECT value FROM jsonb_array_elements(tr.approved_scope) WHERE value->>'customerId'=p_customer_id::text LOOP
   IF (SELECT count(*) FROM jsonb_array_elements(a.facts_text::jsonb->'objects') obj WHERE obj#>>'{object,objectId}'=sc->>'pointId' AND obj#>>'{object,identityAgency}'=sc->>'identityAgency')<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['whole_customer_event_primary_scope']);END IF;
   SELECT obj INTO entry FROM jsonb_array_elements(a.facts_text::jsonb->'objects') obj WHERE obj#>>'{object,objectId}'=sc->>'pointId' AND obj#>>'{object,identityAgency}'=sc->>'identityAgency';
   IF entry->>'disposition' IS DISTINCT FROM 'accepted' OR gridex_customer_life_events.owner_proof_consistent_v1(entry->'party',entry->'business',v.source_message_id) IS DISTINCT FROM true THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_qualified_customer_event_projection']);END IF;
  END LOOP;
  SELECT scope INTO sc FROM jsonb_array_elements(tr.approved_scope) scope WHERE scope->>'customerId'=p_customer_id::text LIMIT 1;
  SELECT obj INTO own FROM jsonb_array_elements(tr.source_objects) obj WHERE obj->>'point'=sc->>'pointId' AND obj->>'identityAgency'=sc->>'identityAgency';
  SELECT array_agg(f) INTO fields FROM jsonb_array_elements_text(sc->'allowedFields') f;
  IF '228'=ANY(fields) AND jsonb_typeof(own->'name')='array' THEN SELECT string_agg(part,' ' ORDER BY ord) INTO n FROM jsonb_array_elements_text(own->'name') WITH ORDINALITY x(part,ord);patch:=patch||jsonb_build_object('name',n,'full_name',n);IF own#>>'{customerParty,1}'='SE1' THEN patch:=patch||jsonb_build_object('company_name',n);END IF;address:=address||jsonb_build_object('name',own->'name');END IF;
  IF '227'=ANY(fields) THEN patch:=patch||jsonb_build_object(CASE own#>>'{customerParty,1}' WHEN 'SE1' THEN 'org_number' ELSE 'personal_number' END,own#>>'{customerParty,0}');END IF;
  IF '229'=ANY(fields) AND jsonb_typeof(own->'street')='array' THEN address:=address||jsonb_build_object('street',own->'street');END IF;
  IF '231'=ANY(fields) AND own->>'postCode' IS NOT NULL THEN address:=address||jsonb_build_object('postCode',own->>'postCode');END IF;
  IF '232'=ANY(fields) AND own->>'city' IS NOT NULL THEN address:=address||jsonb_build_object('city',own->>'city');END IF;
  IF '316'=ANY(fields) AND own->>'country' IS NOT NULL THEN address:=address||jsonb_build_object('country',own->>'country');END IF;
  version_count:=version_count+1;last_source:=v.source_message_id;last_version:=v.version;
 END LOOP;
 IF EXISTS(
  SELECT FROM gridex_customer_life_events.customer_versions future
  JOIN gridex_customer_life_events.transitions later ON later.source_message_id=future.source_message_id AND later.company_id=future.company_id
  CROSS JOIN LATERAL jsonb_array_elements(later.approved_scope) later_scope
  CROSS JOIN LATERAL jsonb_array_elements_text(later_scope->'allowedFields') field
  WHERE future.company_id=p_company_id AND future.customer_id=p_customer_id AND future.effective_at>p_as_of AND later_scope->>'customerId'=p_customer_id::text
   AND field IN('227','228','229','231','232','316')
   AND NOT EXISTS(
    SELECT FROM gridex_customer_life_events.customer_versions prior
    JOIN gridex_customer_life_events.transitions earlier ON earlier.source_message_id=prior.source_message_id AND earlier.company_id=prior.company_id
    CROSS JOIN LATERAL jsonb_array_elements(earlier.approved_scope) earlier_scope
    WHERE prior.company_id=p_company_id AND prior.customer_id=p_customer_id AND prior.effective_at<=p_as_of AND earlier_scope->>'customerId'=p_customer_id::text AND (earlier_scope->'allowedFields') ? field
   )
 ) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_qualified_customer_masterdata_at_requested_time']);END IF;
 RETURN jsonb_build_object('status','authorized','companyId',p_company_id,'customerId',p_customer_id,'asOf',p_as_of,'sourceMessageId',last_source,'customerVersion',last_version,'effectiveVersionCount',version_count,'customerFields',patch,'endUserMasterdata',address);
END$$;
REVOKE ALL ON FUNCTION public.ediel_customer_life_event_export_at_v1(uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_customer_life_event_export_at_v1(uuid,uuid,uuid,timestamptz) TO service_role;
