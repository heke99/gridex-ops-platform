-- Source-only E deltas. The authorized AI consumer supplies its independently
-- qualified Z04 baseline; this port never qualifies an initial global customer.
CREATE FUNCTION gridex_customer_life_events.qualified_patches_v1(c uuid,customer uuid,p_from timestamptz,p_to timestamptz,p_cutoff timestamptz DEFAULT statement_timestamp()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v gridex_customer_life_events.customer_versions%rowtype;tr gridex_customer_life_events.transitions%rowtype;a gridex_received_sources.object_assessments%rowtype;scope jsonb;entry jsonb;own jsonb;fields text[];patch jsonb;address jsonb;n text;patches jsonb:='[]';available_at timestamptz;BEGIN
 IF p_cutoff IS NULL OR NOT isfinite(p_cutoff) OR p_cutoff>statement_timestamp() THEN RAISE EXCEPTION 'customer_life_event_patch_cutoff_required';END IF;
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>=p_to THEN RAISE EXCEPTION 'customer_life_event_boundary_period_required';END IF;
 IF NOT EXISTS(SELECT FROM public.customers WHERE id=customer AND company_id=c) THEN RAISE EXCEPTION 'customer_life_event_projection_tenant_scope_required';END IF;
 IF (SELECT count(*) FROM gridex_customer_life_events.customer_versions WHERE company_id=c AND customer_id=customer AND effective_at>=p_from AND effective_at<p_to)>1000 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['whole_customer_event_patch_window_capacity']);END IF;
 PERFORM m.id FROM public.ediel_messages m WHERE m.company_id=c AND m.id IN(SELECT source_message_id FROM gridex_customer_life_events.customer_versions WHERE company_id=c AND customer_id=customer AND effective_at>=p_from AND effective_at<p_to) ORDER BY m.id FOR UPDATE;
 FOR v IN SELECT * FROM gridex_customer_life_events.customer_versions WHERE company_id=c AND customer_id=customer AND effective_at>=p_from AND effective_at<p_to ORDER BY effective_at,version LOOP
  SELECT * INTO tr FROM gridex_customer_life_events.transitions WHERE source_message_id=v.source_message_id AND company_id=c;
  IF (SELECT count(*) FROM gridex_received_sources.object_assessments x WHERE x.company_id=c AND x.source_message_id=v.source_message_id AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=x.id))<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_primary_customer_event_owner']);END IF;
  SELECT x.* INTO a FROM gridex_received_sources.object_assessments x JOIN gridex_received_sources.object_availability_witnesses w ON w.assessment_id=x.id AND w.company_id=x.company_id AND w.environment=x.environment AND w.source_message_id=x.source_message_id AND w.facts_hash=x.facts_hash WHERE x.company_id=c AND x.source_message_id=v.source_message_id AND x.source_payload_hash=tr.payload_hash AND x.facts_hash=encode(sha256(convert_to(x.facts_text,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=x.id);
  SELECT observed_at INTO available_at FROM gridex_received_sources.object_availability_witnesses WHERE assessment_id=a.id;
  IF tr.recorded_at>p_cutoff OR a.assessed_at>p_cutoff OR available_at>p_cutoff THEN RETURN jsonb_build_object('status','held','missing',ARRAY['customer_event_available_at_same_export_cutoff']);END IF;
  IF a.id IS NULL OR jsonb_typeof(a.facts_text::jsonb->'objects') IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['committed_primary_customer_event_availability']);END IF;
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(tr.approved_scope) sc WHERE sc->>'customerId'=customer::text AND (sc->>'effectiveAt')::timestamptz=v.effective_at) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['exact_customer_event_version_effect']);END IF;
  FOR scope IN SELECT item FROM jsonb_array_elements(tr.approved_scope)item WHERE item->>'customerId'=customer::text LOOP
   IF (SELECT count(*) FROM jsonb_array_elements(a.facts_text::jsonb->'objects') obj WHERE obj#>>'{object,objectId}'=scope->>'pointId' AND obj#>>'{object,identityAgency}'=scope->>'identityAgency')<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['whole_customer_event_primary_scope']);END IF;
   SELECT obj INTO entry FROM jsonb_array_elements(a.facts_text::jsonb->'objects') obj WHERE obj#>>'{object,objectId}'=scope->>'pointId' AND obj#>>'{object,identityAgency}'=scope->>'identityAgency';
   IF entry->>'disposition' IS DISTINCT FROM 'accepted' OR gridex_customer_life_events.owner_proof_consistent_v1(entry->'party',entry->'business',v.source_message_id) IS DISTINCT FROM true THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_qualified_customer_event_projection']);END IF;
  END LOOP;
  -- SAME first-effect owner already required identical changed tuples for all
  -- physical objects of this customer. Selecting that immutable tuple is not a
  -- conflict-resolution or chronology decision in this projection.
  SELECT item INTO scope FROM jsonb_array_elements(tr.approved_scope)item WHERE item->>'customerId'=customer::text LIMIT 1;
  SELECT item INTO own FROM jsonb_array_elements(tr.source_objects)item WHERE item->>'point'=scope->>'pointId' AND item->>'identityAgency'=scope->>'identityAgency';
  SELECT array_agg(f) INTO fields FROM jsonb_array_elements_text(scope->'allowedFields')f;patch:='{}';address:='{}';
  IF '228'=ANY(fields) AND jsonb_typeof(own->'name')='array' THEN SELECT string_agg(part,' ' ORDER BY ord) INTO n FROM jsonb_array_elements_text(own->'name') WITH ORDINALITY x(part,ord);patch:=patch||jsonb_build_object('name',n,'full_name',n);IF own#>>'{customerParty,1}'='SE1' THEN patch:=patch||jsonb_build_object('company_name',n);END IF;address:=address||jsonb_build_object('name',own->'name');END IF;
  IF '227'=ANY(fields) THEN patch:=patch||jsonb_build_object(CASE own#>>'{customerParty,1}' WHEN 'SE1' THEN 'org_number' ELSE 'personal_number' END,own#>>'{customerParty,0}');END IF;
  IF '229'=ANY(fields) AND jsonb_typeof(own->'street')='array' THEN address:=address||jsonb_build_object('street',own->'street');END IF;
  IF '231'=ANY(fields) AND own->>'postCode' IS NOT NULL THEN address:=address||jsonb_build_object('postCode',own->>'postCode');END IF;
  IF '232'=ANY(fields) AND own->>'city' IS NOT NULL THEN address:=address||jsonb_build_object('city',own->>'city');END IF;
  IF '316'=ANY(fields) AND own->>'country' IS NOT NULL THEN address:=address||jsonb_build_object('country',own->>'country');END IF;
  patches:=patches||jsonb_build_array(jsonb_build_object('effectiveAt',v.effective_at,'sourceMessageId',v.source_message_id,'sourcePayloadHash',tr.payload_hash,'customerVersion',v.version,'primaryAssessmentId',a.id,'primaryFactsHash',a.facts_hash,'appliedAt',tr.recorded_at,'availableAt',greatest(a.assessed_at,available_at),'customerFields',patch,'endUserMasterdata',address));
 END LOOP;
 RETURN jsonb_build_object('status','authorized','companyId',c,'customerId',customer,'from',p_from,'to',p_to,'cutoff',p_cutoff,'authorizesInitialCustomer',false,'patches',patches);
END$$;
CREATE FUNCTION public.ediel_customer_life_event_patches_v1(p_company_id uuid,p_customer_id uuid,p_actor_user_id uuid,p_from timestamptz,p_to timestamptz,p_cutoff timestamptz DEFAULT statement_timestamp()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_life_event_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_customer_life_events.require_actor_v1(p_company_id,p_actor_user_id,'read');RETURN gridex_customer_life_events.qualified_patches_v1(p_company_id,p_customer_id,p_from,p_to,p_cutoff);
END$$;
REVOKE ALL ON FUNCTION gridex_customer_life_events.qualified_patches_v1(uuid,uuid,timestamptz,timestamptz,timestamptz),public.ediel_customer_life_event_patches_v1(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_customer_life_event_patches_v1(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz) TO service_role;
