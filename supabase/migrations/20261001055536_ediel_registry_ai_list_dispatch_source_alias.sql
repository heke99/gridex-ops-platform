BEGIN;
-- Explicit source family AI maps only to the actual AI_LIST route profile.
-- Original source market/legal/transport facts and network legal grounds remain
-- independent. No historical route or AI capability is activated/backfilled.
CREATE FUNCTION gridex_registry_import.current_el_actor_source_v1(p_actor_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s text;rec gridex_registry_import.market_records%rowtype;n gridex_registry_import.normalized_batches%rowtype;b gridex_registry_import.batches%rowtype;
BEGIN
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'ediel_registry_actual_legal_actor_required';END IF;
 SELECT source_sha256 INTO s FROM gridex_registry_import.market_current WHERE actor_id=p_actor_id AND market='EL' FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','held','actorId',p_actor_id,'reason','current_original_legal_actor_source_required');END IF;
 SELECT * INTO rec FROM gridex_registry_import.market_records WHERE actor_id=p_actor_id AND market='EL' AND source_sha256=s FOR SHARE;
 SELECT * INTO n FROM gridex_registry_import.normalized_batches WHERE source_sha256=s FOR SHARE;
 SELECT * INTO b FROM gridex_registry_import.batches WHERE source_sha256=s FOR SHARE;
 PERFORM 1 FROM public.platform_actor_identifiers i WHERE i.identifier_type='EdielId' AND i.identifier_value=rec.record->>'edielId' ORDER BY i.actor_id FOR SHARE;
 IF rec.actor_id IS NULL OR n.source_sha256 IS NULL OR b.source_sha256 IS NULL OR rec.record->>'market' IS DISTINCT FROM 'EL'
  OR nullif(rec.record->>'name','') IS NULL OR nullif(rec.record->>'countryCode','') IS NULL OR nullif(rec.record->>'edielId','') IS NULL
  OR rec.record_sha256 IS DISTINCT FROM encode(sha256(convert_to(rec.record::text,'UTF8')),'hex')
  OR b.source_sha256 IS DISTINCT FROM encode(sha256(b.source_bytes),'hex')
  OR b.normalized_sha256 IS DISTINCT FROM encode(sha256(convert_to(n.records::text,'UTF8')),'hex')
  OR(SELECT count(*) FROM jsonb_array_elements(n.records)item WHERE item=rec.record)<>1
  OR(SELECT count(*) FROM public.platform_actor_identifiers i WHERE i.identifier_type='EdielId' AND i.identifier_value=rec.record->>'edielId' AND i.actor_id=p_actor_id)<>1 THEN
  RETURN jsonb_build_object('status','held','actorId',p_actor_id,'reason','current_original_legal_actor_source_required');END IF;
 RETURN jsonb_build_object('status','source_qualified','actorId',p_actor_id,'market','EL','legalEdielId',rec.record->>'edielId','legalName',rec.record->>'name','countryCode',rec.record->>'countryCode','roles',rec.record->'roles','sourceSha256',s,'sourceRecordSha256',rec.record_sha256);
END$$;
CREATE OR REPLACE FUNCTION gridex_registry_import.route_source_v1(rid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.platform_actor_routes%rowtype;own gridex_registry_import.route_market_sources%rowtype;rec gridex_registry_import.market_records%rowtype;n gridex_registry_import.normalized_batches%rowtype;b gridex_registry_import.batches%rowtype;s text;
BEGIN
 SELECT * INTO r FROM public.platform_actor_routes WHERE id=rid FOR SHARE;
 IF r.id IS NULL OR r.registry_market IS NULL THEN RETURN jsonb_build_object('status','held','routeId',rid,'reason','source_declared_registry_market_required');END IF;
 SELECT source_sha256 INTO s FROM gridex_registry_import.route_market_current WHERE route_id=r.id FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','held','routeId',rid,'reason','prospective_route_market_basis_required');END IF;
 SELECT * INTO own FROM gridex_registry_import.route_market_sources WHERE route_id=r.id AND source_sha256=s FOR SHARE;
 SELECT * INTO rec FROM gridex_registry_import.market_records WHERE actor_id=own.actor_id AND market=own.market AND source_sha256=own.source_sha256 FOR SHARE;
 SELECT * INTO n FROM gridex_registry_import.normalized_batches WHERE source_sha256=own.source_sha256 FOR SHARE;
 SELECT * INTO b FROM gridex_registry_import.batches WHERE source_sha256=own.source_sha256 FOR SHARE;
 IF own.route_id IS NULL OR rec.actor_id IS NULL OR b.source_sha256 IS NULL OR n.source_sha256 IS NULL OR own.actor_id IS DISTINCT FROM r.actor_id OR own.market IS DISTINCT FROM r.registry_market
  OR own.wire_tuple IS DISTINCT FROM gridex_registry_import.route_tuple_v1(r) OR rec.record_sha256 IS DISTINCT FROM own.record_sha256
  OR rec.record->>'market' IS DISTINCT FROM own.market OR nullif(rec.record->>'countryCode','') IS NULL OR rec.record->>'edielId' IS DISTINCT FROM r.party_id
  OR b.source_sha256 IS DISTINCT FROM encode(sha256(b.source_bytes),'hex') OR b.normalized_sha256 IS DISTINCT FROM encode(sha256(convert_to(n.records::text,'UTF8')),'hex')
  OR(SELECT count(*) FROM jsonb_array_elements(n.records) item WHERE item=rec.record)<>1
  OR NOT EXISTS(SELECT FROM gridex_registry_import.market_current p WHERE p.actor_id=own.actor_id AND p.market=own.market AND p.source_sha256=own.source_sha256)
  OR NOT EXISTS(SELECT FROM public.platform_actor_identifiers i WHERE i.actor_id=own.actor_id AND i.identifier_type='EdielId' AND i.identifier_value=rec.record->>'edielId') THEN
  RETURN jsonb_build_object('status','held','routeId',rid,'reason','current_exact_registry_market_source_required');END IF;
 RETURN jsonb_build_object('status','source_qualified','routeId',r.id,'actorId',r.actor_id,'market',own.market,'sourceSha256',own.source_sha256,'sourceRecordSha256',own.record_sha256,'countryCode',rec.record->>'countryCode','legalName',rec.record->>'name','roles',rec.record->'roles','legalEdielId',rec.record->>'edielId','wire',own.wire_tuple);
END$$;

CREATE OR REPLACE FUNCTION gridex_registry_import.dispatch_source_v1(c uuid,communication uuid,profile uuid,env text,family text,application text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.ediel_route_profiles%rowtype;r public.communication_routes%rowtype;profile_id text;communication_id text;registry_id uuid;q jsonb;profile_wire jsonb;subaddress text;source_family text;BEGIN
 source_family:=CASE WHEN family='AI_LIST' THEN 'AI' ELSE family END;
 SELECT * INTO p FROM public.ediel_route_profiles WHERE id=profile AND company_id=c FOR SHARE;
 SELECT * INTO r FROM public.communication_routes WHERE id=communication AND company_id=c FOR SHARE;
 IF p.id IS NULL OR r.id IS NULL OR p.communication_route_id IS DISTINCT FROM r.id OR(env IN('test','production')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_registry_owned_route_profile_required';END IF;
 profile_id:=nullif(p.metadata->>'platform_actor_route_id','');communication_id:=nullif(r.auth_config->>'platform_actor_route_id','');
 IF profile_id IS NOT NULL AND communication_id IS NOT NULL AND profile_id IS DISTINCT FROM communication_id THEN RAISE EXCEPTION 'ediel_registry_route_mapping_conflict';END IF;
 IF coalesce(profile_id,communication_id) IS NULL THEN
  IF p.metadata->>'materialized_from'='platform_actor_routes' OR r.auth_config->>'materialized_from'='platform_actor_routes' THEN RAISE EXCEPTION 'ediel_registry_route_mapping_required';END IF;RETURN NULL;
 END IF;
 registry_id:=coalesce(profile_id,communication_id)::uuid;q:=gridex_registry_import.require_el_route_v1(registry_id);profile_wire:=to_jsonb(p);
 IF nullif(profile_wire->>'receiver_subaddress','') IS NOT NULL AND nullif(profile_wire->>'receiver_sub_address','') IS NOT NULL AND profile_wire->>'receiver_subaddress' IS DISTINCT FROM profile_wire->>'receiver_sub_address' THEN RAISE EXCEPTION 'ediel_registry_route_dispatch_source_mismatch';END IF;
 subaddress:=coalesce(nullif(profile_wire->>'receiver_subaddress',''),nullif(profile_wire->>'receiver_sub_address',''));
 -- Registry APP absence remains absent. The SAME canonical policy owns the
 -- protocol APP; actual saved/profile APP is still bound below. A declared
 -- registry APP can never be widened to a different selected application.
 IF q#>>'{wire,environment}' IS DISTINCT FROM env OR q#>>'{wire,family}' IS DISTINCT FROM source_family OR profile_wire->>'environment' IS DISTINCT FROM env
  OR profile_wire->>'message_family' IS DISTINCT FROM family OR lower(q#>>'{wire,transport}') IS DISTINCT FROM 'smtp'
  OR profile_wire->>'transport_type' IS DISTINCT FROM 'smtp' OR to_jsonb(r)->>'route_type' IS DISTINCT FROM 'ediel_partner'
  OR(env='production' AND to_jsonb(r)->>'environment_type' IS DISTINCT FROM 'production') OR(env='test' AND(to_jsonb(r)->>'environment_type' IN('tgt_test','agt_test','bilateral_test')) IS NOT TRUE)
  OR profile_wire->>'receiver_ediel_id' IS DISTINCT FROM q#>>'{wire,interchangePartyId}' OR subaddress IS DISTINCT FROM nullif(q#>>'{wire,subaddress}','')
  OR nullif(profile_wire->>'application_reference','') IS DISTINCT FROM nullif(application,'')
  OR(q#>>'{wire,applicationReference}' IS NOT NULL AND q#>>'{wire,applicationReference}' IS DISTINCT FROM application)
  OR r.target_email IS DISTINCT FROM q#>>'{wire,address}' THEN RAISE EXCEPTION 'ediel_registry_route_dispatch_source_mismatch';END IF;
 IF family='AI_LIST' AND(application IS NOT NULL OR q#>>'{wire,applicationReference}' IS NOT NULL OR nullif(q->>'legalName','') IS NULL
  OR profile_wire->>'is_active' IS DISTINCT FROM 'true' OR profile_wire->>'is_enabled' IS DISTINCT FROM 'true'
  OR to_jsonb(r)->>'is_active' IS DISTINCT FROM 'true' OR profile_wire->>'message_standard' IS DISTINCT FROM 'ai_list'
  OR profile_wire->>'payload_format' IS DISTINCT FROM 'raw') THEN RAISE EXCEPTION 'ediel_registry_ai_list_dispatch_source_required';END IF;
 RETURN q||jsonb_build_object('companyId',c,'communicationRouteId',r.id,'routeProfileId',p.id,'selectedApplicationReference',application)
  ||CASE WHEN family='AI_LIST' THEN jsonb_build_object('canonicalFamily','AI') ELSE '{}'::jsonb END;
END$$;

CREATE OR REPLACE FUNCTION gridex_registry_import.require_message_market_v1(c uuid,mid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;q jsonb;tokens jsonb;unb jsonb;unh jsonb;receiver_legal jsonb;BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=mid AND company_id=c FOR SHARE;
 IF m.id IS NULL THEN RAISE EXCEPTION 'ediel_registry_message_scope_required';END IF;
 IF m.direction IS DISTINCT FROM 'outbound' OR(m.message_family IN('PRODAT','UTILTS','AI','AI_LIST')) IS NOT TRUE OR m.message_code='ERR' THEN RETURN NULL;END IF;
 q:=gridex_registry_import.dispatch_source_v1(c,m.communication_route_id,m.route_profile_id,m.environment,m.message_family,m.application_reference);
 IF q IS NULL THEN RETURN NULL;END IF;
 IF m.receiver_ediel_id IS DISTINCT FROM q#>>'{wire,interchangePartyId}' OR nullif(m.receiver_sub_address,'') IS DISTINCT FROM nullif(q#>>'{wire,subaddress}','') OR m.receiver_email IS DISTINCT FROM q#>>'{wire,address}' OR m.transport_type IS DISTINCT FROM 'smtp' THEN RAISE EXCEPTION 'ediel_registry_message_dispatch_source_mismatch';END IF;
 IF m.message_family IN('PRODAT','UTILTS') THEN
  tokens:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);
  IF(SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNB')<>1 OR(SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH')<>1 THEN RAISE EXCEPTION 'ediel_registry_message_wire_source_required';END IF;
  SELECT t INTO unb FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB';SELECT t INTO unh FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH';
  IF unb#>>'{elements,3,0}' IS DISTINCT FROM q#>>'{wire,interchangePartyId}' OR nullif(unb#>>'{elements,3,2}','') IS DISTINCT FROM nullif(q#>>'{wire,subaddress}','') OR nullif(unb#>>'{elements,7,0}','') IS DISTINCT FROM nullif(m.application_reference,'') OR unh#>>'{elements,2,0}' IS DISTINCT FROM m.message_family THEN RAISE EXCEPTION 'ediel_registry_message_wire_source_mismatch';END IF;
  -- Legal receiver is the original actor PartyId, independently of technical
  -- UNB interchange identity. Only own common-header NAD is consumed.
  IF(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'=CASE m.message_family WHEN 'PRODAT' THEN 'DO' ELSE 'MR' END AND (t->>'index')::int < coalesce((SELECT min((u->>'index')::int) FROM jsonb_array_elements(tokens)u WHERE u->>'tag'=CASE m.message_family WHEN 'PRODAT' THEN 'LIN' ELSE 'IDE' END),2147483647))<>1 THEN RAISE EXCEPTION 'ediel_registry_message_legal_receiver_required';END IF;
  SELECT t INTO receiver_legal FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'=CASE m.message_family WHEN 'PRODAT' THEN 'DO' ELSE 'MR' END AND (t->>'index')::int < coalesce((SELECT min((u->>'index')::int) FROM jsonb_array_elements(tokens)u WHERE u->>'tag'=CASE m.message_family WHEN 'PRODAT' THEN 'LIN' ELSE 'IDE' END),2147483647);
  IF receiver_legal#>>'{elements,2,0}' IS DISTINCT FROM q->>'legalEdielId' THEN RAISE EXCEPTION 'ediel_registry_message_legal_receiver_source_mismatch';END IF;
 END IF;RETURN q;
END$$;
REVOKE ALL ON FUNCTION gridex_registry_import.current_el_actor_source_v1(uuid),gridex_registry_import.route_source_v1(uuid),gridex_registry_import.dispatch_source_v1(uuid,uuid,uuid,text,text,text),gridex_registry_import.require_message_market_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
