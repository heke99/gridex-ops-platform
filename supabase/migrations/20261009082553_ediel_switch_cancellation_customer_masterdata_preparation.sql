-- A cancellation copies the immutable original customer's dated proof, while
-- the new preparation belongs to its actual current preparer and private origin.
BEGIN;
ALTER TABLE gridex_customer_masterdata.preparations ADD COLUMN cancellation_origin_id uuid REFERENCES gridex_switch_cancellations.origins(id);
ALTER TABLE gridex_customer_masterdata.preparations ADD CONSTRAINT customer_masterdata_one_scoped_origin CHECK(recovery_operation_id IS NULL OR cancellation_origin_id IS NULL);
ALTER TABLE gridex_customer_masterdata.preparations DROP CONSTRAINT customer_masterdata_preparation_actor_operation_key;
ALTER TABLE gridex_customer_masterdata.preparations ADD CONSTRAINT customer_masterdata_preparation_actor_operation_key UNIQUE NULLS NOT DISTINCT(company_id,customer_id,environment,as_of,actor_user_id,basis_hash,recovery_operation_id,cancellation_origin_id);

-- Discover selectors only, then take the retention graph and the complete
-- source-message cohort in the same order before any mutable parent locks.
CREATE FUNCTION gridex_switch_cancellations.prelock_customer_source_v1(c uuid,sw uuid,message uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE original uuid;customer uuid;after_original uuid;after_customer uuid;source_ids jsonb;after_sources jsonb;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT outbound_z03_message_id,customer_id INTO original,customer FROM public.supplier_switch_requests WHERE company_id=c AND id=sw;
 SELECT coalesce(jsonb_agg(DISTINCT v.source_message_id ORDER BY v.source_message_id),'[]') INTO source_ids FROM gridex_customer_life_events.customer_versions v WHERE v.company_id=c AND v.customer_id=customer;
 PERFORM m.id FROM public.ediel_messages m WHERE m.company_id=c AND m.id IN(
  SELECT original UNION SELECT message UNION
  SELECT v.source_message_id FROM gridex_customer_life_events.customer_versions v WHERE v.company_id=c AND v.customer_id=customer UNION
  SELECT value::uuid FROM gridex_customer_masterdata.originals o JOIN gridex_customer_masterdata.preparations p ON p.id=o.preparation_id CROSS JOIN LATERAL jsonb_array_elements_text(p.basis#>'{sourceProof,sourceIds}') WHERE o.company_id=c AND o.message_id=original
 ) ORDER BY m.id FOR UPDATE;
 SELECT outbound_z03_message_id,customer_id INTO after_original,after_customer FROM public.supplier_switch_requests WHERE company_id=c AND id=sw;
 SELECT coalesce(jsonb_agg(DISTINCT v.source_message_id ORDER BY v.source_message_id),'[]') INTO after_sources FROM gridex_customer_life_events.customer_versions v WHERE v.company_id=c AND v.customer_id=customer;
 IF ROW(after_original,after_customer) IS DISTINCT FROM ROW(original,customer) OR after_sources IS DISTINCT FROM source_ids THEN RAISE EXCEPTION 'customer_masterdata_cancellation_source_epoch_changed' USING ERRCODE='40001';END IF;
END$$;

CREATE FUNCTION gridex_switch_cancellations.prelock_customer_message_v1(c uuid,message uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sw uuid;
BEGIN
 SELECT o.switch_id INTO sw FROM gridex_switch_cancellations.origins o JOIN public.ediel_messages m ON m.company_id=o.company_id AND (m.id=o.message_id OR m.intent_id=o.intent_id) WHERE m.company_id=c AND m.id=message;
 IF sw IS NOT NULL THEN PERFORM gridex_switch_cancellations.prelock_customer_source_v1(c,sw,message);END IF;
END$$;

CREATE FUNCTION gridex_switch_cancellations.customer_source_v1(c uuid,sw uuid,actor uuid,phase text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q jsonb;m public.ediel_messages%rowtype;p gridex_customer_masterdata.preparations%rowtype;b jsonb;
BEGIN
 IF phase NOT IN('prepare','send') OR phase IS NULL THEN RAISE EXCEPTION 'customer_masterdata_cancellation_phase_required';END IF;
 PERFORM gridex_switch_cancellations.prelock_customer_source_v1(c,sw);
 PERFORM gridex_customer_life_events.require_actor_v1(c,actor,phase);
 q:=gridex_switch_cancellations.context_v1(c,sw,actor,phase='prepare');
 IF q->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'customer_masterdata_cancellation_source_held';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=(q->>'originalMessageId')::uuid AND company_id=c FOR SHARE;
 SELECT prep.* INTO p FROM gridex_customer_masterdata.originals o JOIN gridex_customer_masterdata.preparations prep ON prep.id=o.preparation_id WHERE o.company_id=c AND o.message_id=m.id AND o.payload_hash=m.immutable_payload_hash FOR SHARE OF prep;
 IF p.id IS NULL OR p.actor_user_id IS DISTINCT FROM m.created_by OR p.customer_id IS DISTINCT FROM m.customer_id OR m.customer_id::text IS DISTINCT FROM q->>'customerId'
  OR p.cancellation_origin_id IS NOT NULL OR (p.environment IS NOT NULL AND p.environment IS DISTINCT FROM m.environment)
  OR m.immutable_payload_hash IS DISTINCT FROM q->>'originalHash' OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR m.intent_id IS NULL OR m.communication_route_id IS NULL THEN RAISE EXCEPTION 'customer_masterdata_cancellation_original_scope_required';END IF;
 -- This is a real prepare/current-source read. The ordinary SEND-only reader
 -- remains unchanged; a prepare-only writer does not borrow SEND authority.
 PERFORM gridex_customer_masterdata.require_current_v1(c,m.id,actor,phase);
 b:=gridex_customer_masterdata.basis_v1(c,p.customer_id,actor,p.as_of,p.environment,phase,p.observed_at,p.basis#>'{sourceProof,sourceIds}');
 IF b IS DISTINCT FROM p.basis THEN RAISE EXCEPTION 'customer_masterdata_cancellation_original_source_changed';END IF;
 RETURN (b-'sourceProof')||jsonb_build_object('sourceContextId',p.id,'messageBinding',jsonb_build_object('id',m.id,'environment',m.environment,'intentId',m.intent_id,'routeId',m.communication_route_id,'payloadHash',m.immutable_payload_hash),
  'cancellationSourceBinding',jsonb_build_object('switchRequestId',sw,'actorUserId',actor,'originalMessageId',m.id,'originalHash',m.immutable_payload_hash,'environment',m.environment,'originalPreparerId',p.actor_user_id));
END$$;

CREATE FUNCTION public.ediel_switch_cancellation_customer_masterdata_basis_v1(p_company_id uuid,p_switch_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_masterdata_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_switch_cancellations.customer_source_v1(p_company_id,p_switch_id,p_actor_user_id,'prepare');
END$$;

-- Qualify the reserved origin and actual prospective bytes, rather than a
-- caller-provided parsed selector. The INSERT owner checks them again later.
CREATE FUNCTION gridex_switch_cancellations.customer_draft_v1(c uuid,operation uuid,actor uuid,phase text,intent uuid,route uuid,raw text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_switch_cancellations.origins%rowtype;i public.ediel_message_intents%rowtype;r public.outbound_requests%rowtype;q jsonb;b jsonb;w jsonb;own jsonb;tokens jsonb;original_tokens jsonb;unb jsonb;unh jsonb;unt jsonb;unz jsonb;ud jsonb;obj jsonb;source gridex_customer_masterdata.preparations%rowtype;
BEGIN
 SELECT * INTO o FROM gridex_switch_cancellations.origins WHERE company_id=c AND id=operation;
 IF o.id IS NULL THEN RAISE EXCEPTION 'customer_masterdata_cancellation_private_origin_required';END IF;
 PERFORM gridex_switch_cancellations.prelock_customer_source_v1(c,o.switch_id,o.message_id);
 q:=gridex_switch_cancellations.customer_source_v1(c,o.switch_id,actor,phase);
 b:=gridex_switch_cancellations.context_v1(c,o.switch_id,actor,phase='prepare');
 SELECT * INTO o FROM gridex_switch_cancellations.origins WHERE company_id=c AND id=operation FOR SHARE;
 SELECT * INTO i FROM public.ediel_message_intents WHERE company_id=c AND id=o.intent_id FOR SHARE;
 SELECT * INTO r FROM public.outbound_requests WHERE company_id=c AND id=o.outbound_request_id FOR SHARE;
 IF b->>'status' IS DISTINCT FROM 'authorized' OR (b-ARRAY['operationId','intentId','outboundRequestId','messageId']) IS DISTINCT FROM o.basis
  OR o.original_message_id::text IS DISTINCT FROM q#>>'{cancellationSourceBinding,originalMessageId}' OR o.original_hash IS DISTINCT FROM q#>>'{cancellationSourceBinding,originalHash}'
  OR o.intent_id IS DISTINCT FROM intent OR i.id IS NULL OR r.id IS NULL OR i.operation_id IS DISTINCT FROM operation OR i.communication_route_id IS DISTINCT FROM route
  OR i.environment IS DISTINCT FROM b->>'environment' OR i.direction IS DISTINCT FROM 'outbound' OR i.message_family IS DISTINCT FROM 'PRODAT' OR i.message_code IS DISTINCT FROM 'Z03'
  OR i.business_process IS DISTINCT FROM 'supplier_switch' OR i.validation_status IS DISTINCT FROM 'validated' OR i.customer_id::text IS DISTINCT FROM b->>'customerId'
  OR i.metering_point_id IS DISTINCT FROM b->>'pointId' OR i.grid_area_code IS DISTINCT FROM b->>'gridArea' OR i.transaction_reference IS DISTINCT FROM b->>'li'
  OR to_jsonb(i)-ARRAY['created_at','updated_at','validation_status','validation_report','render_status','outbox_status','ack_status','ediel_message_id','outbound_request_id'] IS DISTINCT FROM o.intent_binding
  OR r.payload->>'environment' IS DISTINCT FROM b->>'environment' OR r.source_type IS DISTINCT FROM 'manual' OR r.source_id::text IS DISTINCT FROM i.id::text
  OR r.request_type IS DISTINCT FROM 'supplier_switch' OR r.operation_id IS DISTINCT FROM operation OR r.customer_id::text IS DISTINCT FROM b->>'customerId'
  OR r.site_id::text IS DISTINCT FROM b->>'siteId' OR r.metering_point_id::text IS DISTINCT FROM b->>'meteringPointId'
 THEN RAISE EXCEPTION 'customer_masterdata_cancellation_private_scope_required';END IF;
 w:=gridex_received_sources.switch_origin_wire_v1(raw);own:=w#>'{objects,0}';tokens:=gridex_received_sources.closure_wire_tokens_v2(raw);
 SELECT t INTO unb FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB';
 SELECT t INTO unh FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH';
 SELECT t INTO unt FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNT';
 SELECT t INTO unz FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNZ';
 SELECT gridex_received_sources.closure_wire_tokens_v2(m.raw_payload) INTO original_tokens FROM public.ediel_messages m WHERE m.company_id=c AND m.id=o.original_message_id;
 IF raw IS NULL OR w IS NULL OR w->>'code' IS DISTINCT FROM 'Z03' OR own->>'reason' IS DISTINCT FROM 'Z24'
  OR own->>'li' IS DISTINCT FROM b->>'li' OR own->>'installationPoint' IS DISTINCT FROM b->>'pointId' OR own->>'installationAgency' IS DISTINCT FROM b->>'identityAgency'
  OR own->>'customerIdentity' IS DISTINCT FROM b->>'customerIdentity' OR own->>'customerQualifier' IS DISTINCT FROM b->>'customerQualifier' OR own->>'customerAgency' IS DISTINCT FROM '260'
  OR own->>'gridArea' IS DISTINCT FROM b->>'gridArea' OR own->>'start' IS DISTINCT FROM b#>>'{sourceObject,start}'
  OR w->>'sender' IS DISTINCT FROM b->>'legalSenderId' OR w->>'receiver' IS DISTINCT FROM b->>'legalReceiverId'
  OR w->>'bgmId' IS DISTINCT FROM i.interchange_reference OR unb#>>'{elements,2,0}' IS DISTINCT FROM i.sender_ediel_id OR unb#>>'{elements,3,0}' IS DISTINCT FROM i.receiver_ediel_id
  OR coalesce(unb#>>'{elements,2,2}','') IS DISTINCT FROM coalesce(i.sender_subaddress,'') OR coalesce(unb#>>'{elements,3,2}','') IS DISTINCT FROM coalesce(i.receiver_subaddress,'')
  OR unb#>>'{elements,5,0}' IS DISTINCT FROM i.interchange_reference OR unb#>>'{elements,7,0}' IS DISTINCT FROM i.application_reference
  OR unh#>>'{elements,1,0}' IS DISTINCT FROM i.message_reference
  OR unb->'index' >= unh->'index' OR unh->'index' >= unt->'index' OR unt->'index' >= unz->'index'
  OR unt#>>'{elements,1,0}' IS DISTINCT FROM ((unt->>'index')::int-(unh->>'index')::int+1)::text
  OR unt#>>'{elements,2,0}' IS DISTINCT FROM unh#>>'{elements,1,0}' OR unz#>>'{elements,1,0}' IS DISTINCT FROM '1' OR unz#>>'{elements,2,0}' IS DISTINCT FROM unb#>>'{elements,5,0}'
  OR unb->'index' IS DISTINCT FROM (SELECT to_jsonb(min((t->>'index')::int)) FROM jsonb_array_elements(tokens)t)
  OR unz->'index' IS DISTINCT FROM (SELECT to_jsonb(max((t->>'index')::int)) FROM jsonb_array_elements(tokens)t)
  OR unh#>'{elements,2}' IS DISTINCT FROM (SELECT t#>'{elements,2}' FROM jsonb_array_elements(original_tokens)t WHERE t->>'tag'='UNH')
  OR unb#>'{elements,1}' IS DISTINCT FROM (SELECT t#>'{elements,1}' FROM jsonb_array_elements(original_tokens)t WHERE t->>'tag'='UNB')
  OR EXISTS(SELECT FROM unnest(ARRAY['UNB','UNH','BGM','UNT','UNZ']) tag WHERE (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'=tag)<>1)
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ANJ')<>1
  OR (SELECT t#>>'{elements,1,1}' FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ANJ') IS DISTINCT FROM (SELECT t#>>'{elements,1,1}' FROM jsonb_array_elements(original_tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ANJ')
 THEN RAISE EXCEPTION 'customer_masterdata_cancellation_actual_wire_required';END IF;
 PERFORM gridex_switch_cancellations.require_original_method_v1(c,o.original_message_id,o.original_hash,i.environment,raw);
 ud:=gridex_customer_masterdata.wire_ud_v1(raw);
 IF ud IS NULL OR jsonb_array_length(ud)<>1 THEN RAISE EXCEPTION 'customer_masterdata_cancellation_actual_wire_required';END IF;
 FOR obj IN SELECT item FROM jsonb_array_elements(ud)item LOOP IF obj->'customerIdentity' IS DISTINCT FROM q->'customerIdentity' OR obj->'endUserMasterdata' IS DISTINCT FROM gridex_customer_masterdata.wire_masterdata_v1(q->'endUserMasterdata') THEN RAISE EXCEPTION 'customer_masterdata_cancellation_actual_wire_changed';END IF;END LOOP;
 SELECT * INTO source FROM gridex_customer_masterdata.preparations WHERE id=(q->>'sourceContextId')::uuid AND company_id=c FOR SHARE;
 IF source.id IS NULL OR source.cancellation_origin_id IS NOT NULL THEN RAISE EXCEPTION 'customer_masterdata_cancellation_original_scope_required';END IF;
 RETURN q||jsonb_build_object('cancellationBinding',jsonb_build_object('operationId',o.id,'switchRequestId',o.switch_id,'actorUserId',actor,'intentId',i.id,'routeId',i.communication_route_id,'environment',i.environment,'originalMessageId',o.original_message_id,'originalHash',o.original_hash,'payloadHash',encode(sha256(convert_to(raw,'UTF8')),'hex')));
END$$;

CREATE FUNCTION public.ediel_prepare_switch_cancellation_customer_masterdata_v1(p_company_id uuid,p_operation_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_route_id uuid,p_raw_payload text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q jsonb;source gridex_customer_masterdata.preparations%rowtype;prep gridex_customer_masterdata.preparations%rowtype;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_masterdata_service_required' USING ERRCODE='42501';END IF;
 q:=gridex_switch_cancellations.customer_draft_v1(p_company_id,p_operation_id,p_actor_user_id,'prepare',p_intent_id,p_route_id,p_raw_payload);
 SELECT * INTO STRICT source FROM gridex_customer_masterdata.preparations WHERE company_id=p_company_id AND id=(q->>'sourceContextId')::uuid FOR SHARE;
 -- Recheck current execution permission after source/parent locks may wait.
 PERFORM gridex_customer_life_events.require_actor_v1(p_company_id,p_actor_user_id,'prepare');
 INSERT INTO gridex_customer_masterdata.preparations(company_id,customer_id,environment,as_of,observed_at,actor_user_id,basis,basis_hash,cancellation_origin_id)
 VALUES(p_company_id,source.customer_id,source.environment,source.as_of,source.observed_at,p_actor_user_id,source.basis,source.basis_hash,p_operation_id) ON CONFLICT DO NOTHING RETURNING * INTO prep;
 IF prep.id IS NULL THEN SELECT * INTO STRICT prep FROM gridex_customer_masterdata.preparations WHERE company_id=p_company_id AND customer_id=source.customer_id AND environment IS NOT DISTINCT FROM source.environment AND as_of=source.as_of AND observed_at=source.observed_at AND actor_user_id=p_actor_user_id AND basis=source.basis AND recovery_operation_id IS NULL AND cancellation_origin_id=p_operation_id;END IF;
 IF prep.id=source.id THEN RAISE EXCEPTION 'customer_masterdata_cancellation_fresh_preparation_required';END IF;
 RETURN (q-ARRAY['sourceContextId','messageBinding','cancellationSourceBinding'])||jsonb_build_object('sourceContextId',prep.id);
END$$;

-- A legitimate subsequent preparer can continue the existing bound draft.
-- Its immutable bytes/preparation creator stay intact; no new credential is
-- minted for a message that has already been created by someone else.
CREATE FUNCTION public.ediel_switch_cancellation_customer_masterdata_message_basis_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;o gridex_switch_cancellations.origins%rowtype;p gridex_customer_masterdata.preparations%rowtype;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_masterdata_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_switch_cancellations.prelock_customer_message_v1(p_company_id,p_message_id);
 SELECT * INTO m FROM public.ediel_messages WHERE company_id=p_company_id AND id=p_message_id FOR SHARE;
 SELECT * INTO o FROM gridex_switch_cancellations.origins WHERE company_id=p_company_id AND message_id=m.id FOR SHARE;
 IF m.id IS NULL OR o.id IS NULL OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z03' OR m.status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'customer_masterdata_cancellation_bound_draft_required';END IF;
 PERFORM gridex_customer_masterdata.require_current_v1(p_company_id,m.id,p_actor_user_id,'prepare');
 SELECT prep.* INTO p FROM gridex_customer_masterdata.originals original JOIN gridex_customer_masterdata.preparations prep ON prep.id=original.preparation_id WHERE original.company_id=p_company_id AND original.message_id=m.id AND original.payload_hash=m.immutable_payload_hash FOR SHARE OF prep;
 IF p.id IS NULL OR p.cancellation_origin_id IS DISTINCT FROM o.id OR p.actor_user_id IS DISTINCT FROM m.created_by THEN RAISE EXCEPTION 'customer_masterdata_cancellation_bound_draft_required';END IF;
 RETURN (p.basis-'sourceProof')||jsonb_build_object('sourceContextId',p.id,'messageBinding',jsonb_build_object('id',m.id,'environment',m.environment,'intentId',m.intent_id,'routeId',m.communication_route_id,'payloadHash',m.immutable_payload_hash),
  'cancellationBinding',jsonb_build_object('operationId',o.id,'switchRequestId',o.switch_id,'actorUserId',p_actor_user_id,'originalMessageId',o.original_message_id,'originalHash',o.original_hash,'preparerId',p.actor_user_id));
END$$;

CREATE FUNCTION gridex_customer_masterdata.require_cancellation_preparation_v1(p gridex_customer_masterdata.preparations,m public.ediel_messages,actor uuid,phase text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_switch_cancellations.origins%rowtype;source gridex_customer_masterdata.preparations%rowtype;q jsonb;w jsonb;
BEGIN
 IF p.cancellation_origin_id IS NULL THEN
  IF p.recovery_operation_id IS NOT NULL THEN RETURN;END IF;
  w:=gridex_received_sources.switch_origin_wire_v1(m.raw_payload);
  IF EXISTS(SELECT FROM gridex_switch_cancellations.origins WHERE company_id=m.company_id AND (id::text=m.source_operation_id OR intent_id=m.intent_id OR message_id=m.id)) OR w#>>'{objects,0,reason}'='Z24' THEN RAISE EXCEPTION 'customer_masterdata_cancellation_fresh_preparation_required';END IF;
  RETURN;
 END IF;
 q:=gridex_switch_cancellations.customer_draft_v1(m.company_id,p.cancellation_origin_id,actor,phase,m.intent_id,m.communication_route_id,m.raw_payload);
 SELECT * INTO o FROM gridex_switch_cancellations.origins WHERE company_id=m.company_id AND id=p.cancellation_origin_id FOR SHARE;
 SELECT * INTO source FROM gridex_customer_masterdata.preparations WHERE id=(q->>'sourceContextId')::uuid AND company_id=m.company_id FOR SHARE;
 IF p.recovery_operation_id IS NOT NULL OR p.id=source.id OR p.actor_user_id IS DISTINCT FROM m.created_by OR p.customer_id IS DISTINCT FROM source.customer_id
  OR p.environment IS DISTINCT FROM source.environment OR p.as_of IS DISTINCT FROM source.as_of OR p.observed_at IS DISTINCT FROM source.observed_at OR p.basis IS DISTINCT FROM source.basis OR p.basis_hash IS DISTINCT FROM source.basis_hash
  OR m.source_operation_id IS DISTINCT FROM o.id::text OR m.original_message_id IS DISTINCT FROM o.original_message_id::text OR m.switch_request_id IS DISTINCT FROM o.switch_id
  OR m.intent_id IS DISTINCT FROM o.intent_id OR m.outbound_request_id IS DISTINCT FROM o.outbound_request_id OR m.customer_id::text IS DISTINCT FROM o.basis->>'customerId'
  OR m.site_id::text IS DISTINCT FROM o.basis->>'siteId' OR m.metering_point_id::text IS DISTINCT FROM o.basis->>'meteringPointId' OR m.environment IS DISTINCT FROM o.basis->>'environment'
  OR m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z03'
  OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM q#>>'{cancellationBinding,payloadHash}'
  OR (o.message_id IS NOT NULL AND (o.message_id IS DISTINCT FROM m.id OR o.payload_hash IS DISTINCT FROM m.immutable_payload_hash))
 THEN RAISE EXCEPTION 'customer_masterdata_cancellation_preparation_scope_required';END IF;
END$$;

REVOKE ALL ON FUNCTION gridex_switch_cancellations.prelock_customer_message_v1(uuid,uuid),gridex_switch_cancellations.prelock_customer_source_v1(uuid,uuid,uuid),gridex_switch_cancellations.customer_source_v1(uuid,uuid,uuid,text),gridex_switch_cancellations.customer_draft_v1(uuid,uuid,uuid,text,uuid,uuid,text),gridex_customer_masterdata.require_cancellation_preparation_v1(gridex_customer_masterdata.preparations,public.ediel_messages,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_switch_cancellation_customer_masterdata_basis_v1(uuid,uuid,uuid),public.ediel_prepare_switch_cancellation_customer_masterdata_v1(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_switch_cancellation_customer_masterdata_basis_v1(uuid,uuid,uuid),public.ediel_prepare_switch_cancellation_customer_masterdata_v1(uuid,uuid,uuid,uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_switch_cancellation_customer_masterdata_message_basis_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_switch_cancellation_customer_masterdata_message_basis_v1(uuid,uuid,uuid) TO service_role;

-- Preserve the complete genuine captured predecessor and ordered postimage,
-- including all current retention/recovery checks, OID, owner, ACL and config.
DO $consumers$
DECLARE f record;spec record;body text;actual jsonb;installed text;
BEGIN
 FOR spec IN SELECT * FROM(VALUES
  (1,'public.ediel_prepare_customer_masterdata_v1(uuid,uuid,uuid,timestamptz,text)','AND recovery_operation_id IS NULL;','AND recovery_operation_id IS NULL AND cancellation_origin_id IS NULL;','3bf53aa7df75a909ae4e4fd107ca8a7152fb40d6fcc199f3ceb3f4de88324872','558af171232fc8767eb8fe8e56e1a303922f890a767b2cf0424aaab2a6e3d6dd'),
  (2,'public.ediel_prepare_customer_masterdata_recovery_v1(uuid,uuid,uuid,uuid,uuid)','AND recovery_operation_id=op.id;','AND recovery_operation_id=op.id AND cancellation_origin_id IS NULL;','6a1eb5ffccdba6d7233fff7d7f6426427cc234a79cbbca0015f5fecbd8cd28b3','86b83d5876b5abc5797605d39d85ff4750dcb65dd304d67bd52b7a0a0c8c71d3'),
  (3,'gridex_customer_masterdata.bind_original_v1()','PERFORM gridex_customer_masterdata.require_recovery_preparation_v1(p,NEW,NEW.created_by,''prepare'');','PERFORM gridex_customer_masterdata.require_recovery_preparation_v1(p,NEW,NEW.created_by,''prepare''); PERFORM gridex_customer_masterdata.require_cancellation_preparation_v1(p,NEW,NEW.created_by,''prepare'');','1e607fe2f3a2c8afa873b695eb07e2cbeab46d874a101892ca624bd67dd48a96','b49e086aee9f0e58106c0bf16c76a9546416a94b4ad44321e70e67151772da84'),
  (4,'gridex_customer_masterdata.require_current_v1(uuid,uuid,uuid,text)','PERFORM gridex_customer_masterdata.require_recovery_preparation_v1(p,m,actor,phase);','PERFORM gridex_customer_masterdata.require_recovery_preparation_v1(p,m,actor,phase); PERFORM gridex_customer_masterdata.require_cancellation_preparation_v1(p,m,actor,phase);','32803540e65f19b2f0d08f555f5cc9c5ac58a8fc4c650bef10275229becae3ad','1f7235bd65eb2a1ac133d09e2c315c5ac6d450a44c9c993e53dba8f04b226c24'),
  (5,'gridex_customer_masterdata.require_current_v1(uuid,uuid,uuid,text)','SELECT * INTO m FROM public.ediel_messages WHERE id=message AND company_id=c FOR UPDATE;','PERFORM gridex_switch_cancellations.prelock_customer_message_v1(c,message); SELECT * INTO m FROM public.ediel_messages WHERE id=message AND company_id=c FOR UPDATE;','1f7235bd65eb2a1ac133d09e2c315c5ac6d450a44c9c993e53dba8f04b226c24','2e2164318fa69e5fe1bb5c2f7f2b288c06cf8b8b8e84840880855abae2370159'),
  (6,'public.ediel_require_switch_cancellation_source_current_v1(uuid,uuid)','SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;','PERFORM gridex_switch_cancellations.prelock_customer_message_v1(p_company_id,p_message_id); SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;','d06be59b55bb6f8360c147ddd60862a73737e4a9a634ed1749cf8f7fd891aafa','cdf016fbe519fcdc79c0f630d8600dc3c11506dd0b3dd94241f7a99bded4149f'),
  (7,'gridex_customer_masterdata.prelock_new_v1()','IF p.id IS NOT NULL THEN PERFORM m.id','IF p.cancellation_origin_id IS NOT NULL THEN PERFORM gridex_switch_cancellations.prelock_customer_source_v1(NEW.company_id,(SELECT o.switch_id FROM gridex_switch_cancellations.origins o WHERE o.company_id=NEW.company_id AND o.id=p.cancellation_origin_id));END IF; IF p.id IS NOT NULL THEN PERFORM m.id','fd36a8f0e60adde16822aa473862af432db6fe92a9eca69f42c07ced1726b83d','48a69fbf042ebb8734c7ffc7b42887486223f2b026038a4344fd42c9265dd673'),
  (8,'gridex_switch_cancellations.context_v1(uuid,uuid,uuid,boolean)','SELECT outbound_z03_message_id INTO original_id','PERFORM gridex_switch_cancellations.prelock_customer_source_v1(c,sw); SELECT outbound_z03_message_id INTO original_id','36268e59a33cdba60f6b4e4c2e420a42b09f81e6efe5ccfc164fe149aaae560b','600e83702ed4695229aeaa133b258867d9736ac1939b8196e7d2e56ca145aa4e')
 ) AS x(ordinal,signature,needle,replacement,preimage_sha256,postimage_sha256) ORDER BY ordinal LOOP
  SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=spec.signature::regprocedure;
  IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM spec.preimage_sha256
   OR (length(f.prosrc)-length(replace(f.prosrc,spec.needle,'')))/length(spec.needle)<>1 THEN RAISE EXCEPTION 'customer_masterdata_cancellation_predecessor_required:%:%',spec.ordinal,spec.signature;END IF;
  body:=replace(f.prosrc,spec.needle,spec.replacement);
  IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM spec.postimage_sha256
   OR (length(body)-length(replace(body,spec.replacement,'')))/length(spec.replacement)<>1
   OR replace(body,spec.replacement,spec.needle) IS DISTINCT FROM f.prosrc THEN RAISE EXCEPTION 'customer_masterdata_cancellation_inverse_required:%:%',spec.ordinal,spec.signature;END IF;
  EXECUTE replace(f.definition,f.prosrc,body);
  SELECT to_jsonb(p)-'prosrc',p.prosrc INTO actual,installed FROM pg_proc p WHERE p.oid=f.oid;
  IF actual IS DISTINCT FROM f.metadata OR installed IS DISTINCT FROM body OR encode(sha256(convert_to(installed,'UTF8')),'hex') IS DISTINCT FROM spec.postimage_sha256 THEN RAISE EXCEPTION 'customer_masterdata_cancellation_metadata_or_postimage_changed:%:%',spec.ordinal,spec.signature;END IF;
 END LOOP;
END$consumers$;
COMMIT;
