-- P262 on actual E source commands. The same protected dated BRP owner is
-- consumed before first binding and on current send through source_v1. No
-- desired B event, current portal scalar or caller metadata becomes authority.
BEGIN;
CREATE FUNCTION gridex_customer_life_events.brp_objects_v1(raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE token jsonb;current_object jsonb;fragments jsonb:='[]';objects jsonb:='[]';fragment jsonb;first_object jsonb;brp text;BEGIN
 FOR token IN SELECT item FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2(raw)) item LOOP
  IF token->>'tag'='LIN' THEN
   IF current_object IS NOT NULL THEN fragments:=fragments||jsonb_build_array(current_object);END IF;
   current_object:=jsonb_build_object('point',token#>>'{elements,3,0}','identityAgency',token#>>'{elements,3,3}');
  ELSIF token->>'tag'='UNT' THEN
   IF current_object IS NOT NULL THEN fragments:=fragments||jsonb_build_array(current_object);current_object:=NULL;END IF;
  ELSIF current_object IS NOT NULL AND token->>'tag'='NAD' AND token#>>'{elements,1,0}'='Z02' THEN
   IF current_object ? 'brp' OR token#>>'{elements,2,1}' IS DISTINCT FROM '160' OR token#>>'{elements,2,2}' IS DISTINCT FROM 'SVK' OR jsonb_array_length(token#>'{elements,2}') IS DISTINCT FROM 3 THEN RETURN NULL;END IF;
   brp:=token#>>'{elements,2,0}';IF nullif(brp,'') IS NULL OR brp<>btrim(brp) OR length(brp)>35 OR brp~'[[:cntrl:]]' THEN RETURN NULL;END IF;
   current_object:=current_object||jsonb_build_object('brp',brp);
  END IF;
 END LOOP;
 IF current_object IS NOT NULL THEN fragments:=fragments||jsonb_build_array(current_object);END IF;
 FOR fragment IN SELECT item FROM jsonb_array_elements(fragments)item LOOP
  IF nullif(fragment->>'point','') IS NULL OR (fragment->>'identityAgency' IN('9','89')) IS NOT TRUE THEN RETURN NULL;END IF;
  SELECT item INTO first_object FROM jsonb_array_elements(objects)item WHERE item->>'point'=fragment->>'point' AND item->>'identityAgency'=fragment->>'identityAgency';
  IF first_object IS NOT NULL THEN
   IF fragment ? 'brp' AND fragment->>'brp' IS DISTINCT FROM first_object->>'brp' THEN RETURN NULL;END IF;
  ELSE
   IF nullif(fragment->>'brp','') IS NULL THEN RETURN NULL;END IF;
   objects:=objects||jsonb_build_array(fragment);
  END IF;
 END LOOP;
 IF jsonb_array_length(objects)=0 THEN RETURN NULL;END IF;RETURN objects;
END$$;
ALTER FUNCTION gridex_customer_life_events.source_v1(uuid,uuid,uuid,text) RENAME TO source_before_dated_brp_v1;
CREATE FUNCTION gridex_customer_life_events.source_v1(c uuid,event uuid,actor uuid,phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE basis jsonb;ev gridex_customer_life_events.events%rowtype;wire jsonb;brps jsonb;scope jsonb;own jsonb;physical jsonb;brp jsonb;BEGIN
 basis:=gridex_customer_life_events.source_before_dated_brp_v1(c,event,actor,phase);
 IF basis->>'status' IS DISTINCT FROM 'authorized' THEN RETURN basis;END IF;
 SELECT * INTO STRICT ev FROM gridex_customer_life_events.events WHERE id=event AND company_id=c;
 wire:=gridex_customer_life_events.wire_v1(basis->>'rawPayload');brps:=gridex_customer_life_events.brp_objects_v1(basis->>'rawPayload');
 IF brps IS NULL OR jsonb_array_length(brps) IS DISTINCT FROM jsonb_array_length(ev.approved_scope) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['whole_customer_event_physical_brp_scope']);END IF;
 FOR scope IN SELECT item FROM jsonb_array_elements(ev.approved_scope)item LOOP
  SELECT item INTO own FROM jsonb_array_elements(wire->'objects')item WHERE item->>'point'=scope->>'pointId' AND item->>'identityAgency'=scope->>'identityAgency';
  SELECT item INTO physical FROM jsonb_array_elements(brps)item WHERE item->>'point'=scope->>'pointId' AND item->>'identityAgency'=scope->>'identityAgency';
  brp:=gridex_brp_sources.require_source_v1(c,NULL,actor,phase,ev.environment,ev.customer_id,(scope->>'siteId')::uuid,(scope->>'meteringPointId')::uuid,(own->>'effectiveAt')::timestamptz,(scope->>'periodId')::uuid);
  IF brp->>'status' IS DISTINCT FROM 'authorized' THEN RETURN coalesce(brp,jsonb_build_object('status','held','missing',ARRAY['own_dated_customer_event_brp_source']));END IF;
  IF brp->>'sourceKind' IS DISTINCT FROM 'accepted_supply_brp' OR brp->>'companyId' IS DISTINCT FROM c::text OR brp->>'environment' IS DISTINCT FROM ev.environment OR brp->>'customerId' IS DISTINCT FROM ev.customer_id::text
   OR brp->>'siteId' IS DISTINCT FROM scope->>'siteId' OR brp->>'meteringPointId' IS DISTINCT FROM scope->>'meteringPointId' OR brp->>'supplyPeriodId' IS DISTINCT FROM scope->>'periodId' OR (brp->>'at')::timestamptz IS DISTINCT FROM (own->>'effectiveAt')::timestamptz
   OR brp->>'pointId' IS DISTINCT FROM scope->>'pointId' OR brp->>'identityAgency' IS DISTINCT FROM scope->>'identityAgency' OR brp->>'gridArea' IS DISTINCT FROM scope->>'gridArea'
   OR brp->>'legalActorId' IS DISTINCT FROM ev.legal_actor_id::text OR brp->>'legalSenderId' IS DISTINCT FROM ev.legal_sender_id OR brp->>'legalReceiverId' IS DISTINCT FROM ev.legal_receiver_id OR physical->>'brp' IS DISTINCT FROM brp->>'brpEdielId' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['customer_event_same_dated_brp_object']);END IF;
 END LOOP;RETURN basis;
END$$;
-- A preparation-only selector allows the shared structural owner to qualify its
-- own current candidate. It grants no event/binding/provider/business effect.
CREATE FUNCTION public.ediel_customer_life_event_brp_scope_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE basis jsonb;ev gridex_customer_life_events.events%rowtype;wire jsonb;scope jsonb;own jsonb;scopes jsonb:='[]';BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_life_event_service_required' USING ERRCODE='42501';END IF;
 basis:=gridex_customer_life_events.source_before_dated_brp_v1(p_company_id,p_event_id,p_actor_user_id,'prepare');IF basis->>'status' IS DISTINCT FROM 'authorized' THEN RETURN basis;END IF;
 SELECT * INTO STRICT ev FROM gridex_customer_life_events.events WHERE id=p_event_id AND company_id=p_company_id;wire:=gridex_customer_life_events.wire_v1(basis->>'rawPayload');
 FOR scope IN SELECT item FROM jsonb_array_elements(ev.approved_scope)item LOOP
  SELECT item INTO own FROM jsonb_array_elements(wire->'objects')item WHERE item->>'point'=scope->>'pointId' AND item->>'identityAgency'=scope->>'identityAgency';
  scopes:=scopes||jsonb_build_array(jsonb_build_object('companyId',p_company_id,'environment',ev.environment,'contractId',NULL,'customerId',ev.customer_id,'siteId',scope->>'siteId','meteringPointId',scope->>'meteringPointId','at',own->>'effectiveAt','supplyPeriodId',scope->>'periodId'));
 END LOOP;RETURN jsonb_build_object('status','authorized','companyId',p_company_id,'eventId',p_event_id,'scopes',scopes);
END$$;
REVOKE ALL ON FUNCTION public.ediel_customer_life_event_brp_scope_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_customer_life_event_brp_scope_v1(uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION gridex_customer_life_events.brp_objects_v1(text),gridex_customer_life_events.source_v1(uuid,uuid,uuid,text),gridex_customer_life_events.source_before_dated_brp_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
