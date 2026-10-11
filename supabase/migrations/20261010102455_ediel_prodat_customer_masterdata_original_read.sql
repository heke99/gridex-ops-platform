-- Incoming H address knowledge reads the accepted immutable outbound original.
-- READ keeps its current source/retention/profile guards and grants no new
-- preparation, sender capability, provider entry or business authority.
BEGIN;
CREATE FUNCTION public.ediel_read_prodat_h_accepted_original_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;q jsonb;accepted jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_masterdata_original_read_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 PERFORM gridex_bilateral_prodat.lock_graph_v1();
 PERFORM gridex_customer_life_events.require_actor_v1(p_company_id,p_actor_user_id,'read');
 PERFORM gridex_customer_masterdata.prelock_message_v1(p_company_id,p_message_id);
 SELECT * INTO m FROM public.ediel_messages WHERE company_id=p_company_id AND id=p_message_id FOR UPDATE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'edifact'
  OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z03'
  OR m.environment NOT IN('test','production') OR m.environment IS NULL OR m.created_by IS NULL OR m.intent_id IS NULL OR m.communication_route_id IS NULL
  OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RETURN NULL;END IF;
 -- The installed original READ owns signed H/profile/source-byte/current
 -- contract scope and its explicit current READ actor; no SEND reader is used.
 q:=public.ediel_read_bilateral_prodat_outbound_original_v1(p_company_id,p_actor_user_id,m.id);
 IF q IS NULL THEN RETURN NULL;END IF;
 IF q->>'version' IS DISTINCT FROM '1' OR q->>'owner' IS DISTINCT FROM 'immutable-bilateral-prodat-outbound-profile-v1'
  OR q->>'companyId' IS DISTINCT FROM p_company_id::text OR q->>'environment' IS DISTINCT FROM m.environment
  OR q->>'actorUserId' IS DISTINCT FROM p_actor_user_id::text OR q->>'originalActorUserId' IS DISTINCT FROM m.created_by::text
  OR q->>'payloadHash' IS DISTINCT FROM m.immutable_payload_hash OR q->>'messageCode' IS DISTINCT FROM 'Z03'
  OR jsonb_typeof(q->'objects') IS DISTINCT FROM 'array' OR jsonb_array_length(q->'objects')=0
  OR EXISTS(SELECT FROM jsonb_array_elements(q->'objects') own WHERE own->>'process' IS DISTINCT FROM 'normal_start_h')
 THEN RAISE EXCEPTION 'customer_masterdata_original_read_profile_scope_required';END IF;
 -- The private immutable receipt owner carries no actor/SEND gate. The
 -- actual READ/profile guards above own disclosure, while this owner still
 -- checks the exact stored hash, one entered acceptance and frozen recipient.
 accepted:=gridex_ediel_transport.accepted_source_basis_v1(m);
 IF accepted IS NULL THEN RETURN NULL;END IF;
 IF accepted->>'status' IS DISTINCT FROM 'accepted_projection' OR accepted->>'companyId' IS DISTINCT FROM p_company_id::text
  OR accepted->>'environment' IS DISTINCT FROM m.environment OR accepted->>'messageId' IS DISTINCT FROM m.id::text
  OR accepted->>'originalHash' IS DISTINCT FROM m.immutable_payload_hash OR accepted->>'authorizesProviderEntry' IS DISTINCT FROM 'false'
  OR nullif(accepted->>'observedAt','') IS NULL OR NOT isfinite((accepted->>'observedAt')::timestamptz)
  OR (accepted->>'observedAt')::timestamptz>statement_timestamp() THEN RAISE EXCEPTION 'customer_masterdata_original_read_accepted_scope_required';END IF;
 PERFORM gridex_customer_life_events.require_actor_v1(p_company_id,p_actor_user_id,'read');
 IF gridex_bilateral_prodat.actor_v1(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'prodat_h_original_current_reader_required' USING ERRCODE='42501';END IF;
 RETURN accepted||jsonb_build_object('version',1,'owner','immutable-prodat-h-accepted-original-read-v1',
  'actorUserId',p_actor_user_id,'originalActorUserId',m.created_by,
  'messageBinding',jsonb_build_object('id',m.id,'environment',m.environment,'intentId',m.intent_id,'routeId',m.communication_route_id,'payloadHash',m.immutable_payload_hash));
END$$;
CREATE FUNCTION public.ediel_read_prodat_customer_masterdata_original_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;p gridex_customer_masterdata.preparations%rowtype;accepted jsonb;
BEGIN
 -- The narrow H transport READ owns current actor, signed original and exact
 -- entered accepted receipt before protected dated customer data is read.
 accepted:=public.ediel_read_prodat_h_accepted_original_v1(p_company_id,p_message_id,p_actor_user_id);
 IF accepted IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=p_company_id AND id=p_message_id FOR UPDATE;
 SELECT prep.* INTO p FROM gridex_customer_masterdata.originals original JOIN gridex_customer_masterdata.preparations prep ON prep.id=original.preparation_id
  WHERE original.company_id=p_company_id AND original.message_id=m.id AND original.payload_hash=m.immutable_payload_hash FOR SHARE OF prep;
 IF p.id IS NULL THEN RETURN NULL;END IF;
 -- Genuine unavailable original knowledge stays unknown. A present protected
 -- original still owes the existing raw, history, retention and recovery guards.
 PERFORM gridex_customer_masterdata.require_current_v1(p_company_id,m.id,p_actor_user_id,'read');
 IF p.actor_user_id IS DISTINCT FROM m.created_by OR p.customer_id IS DISTINCT FROM m.customer_id
  OR p.environment IS NOT NULL AND p.environment IS DISTINCT FROM m.environment THEN RAISE EXCEPTION 'customer_masterdata_original_read_preparation_scope_required';END IF;
 PERFORM gridex_customer_life_events.require_actor_v1(p_company_id,p_actor_user_id,'read');
 IF gridex_bilateral_prodat.actor_v1(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'prodat_h_original_current_reader_required' USING ERRCODE='42501';END IF;
 RETURN (p.basis-'sourceProof')||jsonb_build_object('version',1,'owner','immutable-prodat-customer-masterdata-original-read-v1',
  'actorUserId',p_actor_user_id,'originalActorUserId',m.created_by,'sourceContextId',p.id,
  'messageBinding',jsonb_build_object('id',m.id,'environment',m.environment,'intentId',m.intent_id,'routeId',m.communication_route_id,'payloadHash',m.immutable_payload_hash));
END$$;
REVOKE ALL ON FUNCTION public.ediel_read_prodat_h_accepted_original_v1(uuid,uuid,uuid),public.ediel_read_prodat_customer_masterdata_original_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_read_prodat_h_accepted_original_v1(uuid,uuid,uuid),public.ediel_read_prodat_customer_masterdata_original_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
