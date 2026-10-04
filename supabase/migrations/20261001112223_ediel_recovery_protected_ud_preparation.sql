-- TR-05: a corrected Z01/Z03 owns a fresh per-operation/current-preparer UD
-- credential. Existing original, source proof and ordinary preparations stay.
BEGIN;
ALTER TABLE gridex_customer_masterdata.preparations ADD COLUMN recovery_operation_id uuid REFERENCES gridex_received_sources.prodat_recovery_operations(id);
ALTER TABLE gridex_customer_masterdata.preparations DROP CONSTRAINT customer_masterdata_preparation_actor_basis_key;
ALTER TABLE gridex_customer_masterdata.preparations ADD CONSTRAINT customer_masterdata_preparation_actor_operation_key UNIQUE NULLS NOT DISTINCT(company_id,customer_id,environment,as_of,actor_user_id,basis_hash,recovery_operation_id);

CREATE FUNCTION public.ediel_prepare_customer_masterdata_recovery_v1(p_company_id uuid,p_operation_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_route_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;o gridex_received_sources.prodat_recovery_origins%rowtype;i public.ediel_message_intents%rowtype;m public.ediel_messages%rowtype;source gridex_customer_masterdata.preparations%rowtype;prep gridex_customer_masterdata.preparations%rowtype;q jsonb;b jsonb;ud jsonb;obj jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_masterdata_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'prepare');
 PERFORM gridex_received_sources.prelock_recovery_source_cohort_v1(p_company_id,p_operation_id);
 q:=public.ediel_prodat_recovery_operation_basis_v1(p_company_id,p_operation_id,p_actor_user_id);
 SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO o FROM gridex_received_sources.prodat_recovery_origins WHERE operation_id=op.id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=o.intent_id AND company_id=p_company_id FOR SHARE;
 IF q IS NULL OR op.id IS NULL OR (op.kind IN('contrl_correction','aperak_correction')) IS NOT TRUE OR o.intent_id IS DISTINCT FROM p_intent_id OR i.id IS NULL OR i.communication_route_id IS DISTINCT FROM p_route_id OR i.operation_id IS DISTINCT FROM op.id OR i.environment IS DISTINCT FROM op.environment OR i.direction IS DISTINCT FROM 'outbound' OR i.message_family IS DISTINCT FROM 'PRODAT' OR (i.message_code IN('Z01','Z03')) IS NOT TRUE OR i.validation_status IS DISTINCT FROM 'validated' OR i.message_code IS DISTINCT FROM gridex_received_sources.prodat_recovery_wire_v1(op.corrected_raw_payload)->>'code' THEN RAISE EXCEPTION 'customer_masterdata_recovery_private_scope_required';END IF;
 ud:=gridex_customer_masterdata.wire_ud_v1(op.corrected_raw_payload);IF ud IS NOT NULL AND jsonb_array_length(ud)=0 THEN RETURN NULL;END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=(q->>'sourceOriginMessageId')::uuid AND company_id=p_company_id AND environment=op.environment FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM i.message_code OR m.customer_id IS DISTINCT FROM i.customer_id OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'customer_masterdata_recovery_terminal_source_required';END IF;
 PERFORM gridex_customer_masterdata.prelock_message_v1(p_company_id,m.id);
 PERFORM gridex_customer_masterdata.require_current_v1(p_company_id,m.id,p_actor_user_id,'prepare');
 SELECT p.* INTO source FROM gridex_customer_masterdata.originals original JOIN gridex_customer_masterdata.preparations p ON p.id=original.preparation_id WHERE original.company_id=p_company_id AND original.message_id=m.id AND original.payload_hash=m.immutable_payload_hash FOR SHARE OF p;
 IF source.id IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['authentic_terminal_customer_masterdata_original']);END IF;
 b:=gridex_customer_masterdata.basis_v1(p_company_id,source.customer_id,p_actor_user_id,source.as_of,source.environment,'prepare',source.observed_at,source.basis#>'{sourceProof,sourceIds}');
 IF b->>'status' IS DISTINCT FROM 'authorized' OR b IS DISTINCT FROM source.basis OR ud IS NULL THEN RAISE EXCEPTION 'customer_masterdata_recovery_current_source_changed';END IF;
 FOR obj IN SELECT item FROM jsonb_array_elements(ud)item LOOP IF obj->'customerIdentity' IS DISTINCT FROM b->'customerIdentity' OR obj->'endUserMasterdata' IS DISTINCT FROM gridex_customer_masterdata.wire_masterdata_v1(b->'endUserMasterdata') THEN RAISE EXCEPTION 'customer_masterdata_recovery_actual_wire_changed';END IF;END LOOP;
 -- Locks may wait: qualify today's actor and the same established negative
 -- source again immediately before creating its durable preparation.
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(p_company_id,p_actor_user_id,'prepare');
 PERFORM gridex_received_sources.qualified_recovery_origin_v1(p_company_id,p_operation_id);
 INSERT INTO gridex_customer_masterdata.preparations(company_id,customer_id,environment,as_of,observed_at,actor_user_id,basis,basis_hash,recovery_operation_id) VALUES(p_company_id,source.customer_id,source.environment,source.as_of,source.observed_at,p_actor_user_id,b,encode(sha256(convert_to(b::text,'UTF8')),'hex'),op.id) ON CONFLICT DO NOTHING RETURNING * INTO prep;
 IF prep.id IS NULL THEN SELECT * INTO STRICT prep FROM gridex_customer_masterdata.preparations WHERE company_id=p_company_id AND customer_id=source.customer_id AND environment IS NOT DISTINCT FROM source.environment AND as_of=source.as_of AND actor_user_id=p_actor_user_id AND basis=b AND recovery_operation_id=op.id;END IF;
 IF prep.id=source.id THEN RAISE EXCEPTION 'customer_masterdata_recovery_fresh_preparation_required';END IF;
 RETURN (b-'sourceProof')||jsonb_build_object('sourceContextId',prep.id,'recoveryBinding',jsonb_build_object('operationId',op.id,'actorUserId',p_actor_user_id,'intentId',i.id,'routeId',i.communication_route_id,'environment',op.environment,'originalMessageId',op.original_message_id,'sourceOriginMessageId',m.id,'payloadHash',op.corrected_payload_hash));
END$$;
REVOKE ALL ON FUNCTION public.ediel_prepare_customer_masterdata_recovery_v1(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_prepare_customer_masterdata_recovery_v1(uuid,uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION gridex_customer_masterdata.require_recovery_preparation_v1(p gridex_customer_masterdata.preparations,m public.ediel_messages,actor uuid,phase text) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q jsonb;op gridex_received_sources.prodat_recovery_operations%rowtype;o gridex_received_sources.prodat_recovery_origins%rowtype;source gridex_customer_masterdata.preparations%rowtype;
BEGIN
 IF p.recovery_operation_id IS NULL THEN IF EXISTS(SELECT FROM gridex_received_sources.prodat_recovery_operations WHERE id::text=m.source_operation_id AND company_id=m.company_id AND kind IN('contrl_correction','aperak_correction')) THEN RAISE EXCEPTION 'customer_masterdata_recovery_fresh_preparation_required';END IF;RETURN;END IF;
 PERFORM gridex_received_sources.require_recovery_execution_actor_v1(m.company_id,actor,phase);
 q:=gridex_received_sources.qualified_recovery_origin_v1(m.company_id,p.recovery_operation_id);
 SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id=p.recovery_operation_id AND company_id=m.company_id FOR SHARE;
 SELECT * INTO o FROM gridex_received_sources.prodat_recovery_origins WHERE operation_id=op.id AND company_id=m.company_id FOR SHARE;
 SELECT prep.* INTO source FROM gridex_customer_masterdata.originals original JOIN gridex_customer_masterdata.preparations prep ON prep.id=original.preparation_id WHERE original.company_id=m.company_id AND original.message_id=(q->>'sourceOriginMessageId')::uuid FOR SHARE OF prep;
 IF source.id IS NULL OR p.id=source.id OR p.actor_user_id IS DISTINCT FROM m.created_by OR p.customer_id IS DISTINCT FROM source.customer_id OR p.environment IS DISTINCT FROM source.environment OR p.as_of IS DISTINCT FROM source.as_of OR p.observed_at IS DISTINCT FROM source.observed_at OR p.basis IS DISTINCT FROM source.basis OR m.source_operation_id IS DISTINCT FROM op.id::text OR m.intent_id IS DISTINCT FROM o.intent_id OR m.outbound_request_id IS DISTINCT FROM o.outbound_request_id OR m.original_message_id IS DISTINCT FROM op.original_message_id OR m.raw_payload IS DISTINCT FROM op.corrected_raw_payload OR encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') IS DISTINCT FROM op.corrected_payload_hash THEN RAISE EXCEPTION 'customer_masterdata_recovery_preparation_scope_required';END IF;
END$$;
REVOKE ALL ON FUNCTION gridex_customer_masterdata.require_recovery_preparation_v1(gridex_customer_masterdata.preparations,public.ediel_messages,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- Existing source/issuer/registered-address/time semantics remain byte exact.
-- Protect both actual INSERT and every actual current SEND/read consumer.
DO $source_consumers$
DECLARE f record;body text;signature text;needle text;actual jsonb;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.ediel_prepare_customer_masterdata_v1(uuid,uuid,uuid,timestamptz,text)','gridex_customer_masterdata.bind_original_v1()','gridex_customer_masterdata.require_current_v1(uuid,uuid,uuid,text)'] LOOP
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=signature::regprocedure;
  IF signature LIKE 'public.ediel_prepare%' THEN
   needle:='AND actor_user_id=p_actor_user_id AND basis=b;';IF strpos(f.prosrc,needle)=0 THEN RAISE EXCEPTION 'customer_masterdata_recovery_existing_prepare_review_required';END IF;
   body:=replace(f.prosrc,needle,'AND actor_user_id=p_actor_user_id AND basis=b AND recovery_operation_id IS NULL;');
  ELSE
   needle:=CASE WHEN signature LIKE '%bind_original%' THEN 'b:=gridex_customer_masterdata.basis_v1(NEW.company_id' ELSE 'b:=gridex_customer_masterdata.basis_v1(c,p.customer_id' END;
   IF strpos(f.prosrc,needle)=0 THEN RAISE EXCEPTION 'customer_masterdata_recovery_existing_consumer_review_required';END IF;
   body:=replace(f.prosrc,needle,CASE WHEN signature LIKE '%bind_original%' THEN 'PERFORM gridex_customer_masterdata.require_recovery_preparation_v1(p,NEW,NEW.created_by,''prepare''); ' ELSE 'PERFORM gridex_customer_masterdata.require_recovery_preparation_v1(p,m,actor,phase); ' END||needle);
  END IF;
  EXECUTE replace(pg_get_functiondef(f.oid),f.prosrc,body);
  SELECT to_jsonb(p)-'prosrc' INTO actual FROM pg_proc p WHERE p.oid=f.oid;
  IF actual IS DISTINCT FROM to_jsonb(f)-'prosrc' THEN RAISE EXCEPTION 'customer_masterdata_recovery_existing_authority_changed';END IF;
 END LOOP;
END$source_consumers$;
COMMIT;
