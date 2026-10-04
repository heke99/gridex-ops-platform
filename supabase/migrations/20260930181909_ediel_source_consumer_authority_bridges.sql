-- New effects require genuine captured inbound legal context; established own
-- hash-qualified source outcomes remain immutable and replayable.
BEGIN;
ALTER FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) RENAME TO apply_supply_before_legal_context_v1;
ALTER FUNCTION public.apply_supply_before_legal_context_v1(uuid,uuid,uuid) SET SCHEMA gridex_received_sources;
REVOKE ALL ON FUNCTION gridex_received_sources.apply_supply_before_legal_context_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_apply_supply_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF FOUND AND m.direction='inbound' AND m.message_family='PRODAT'
 AND NOT EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions tr WHERE tr.source_message_id=m.id AND tr.company_id=m.company_id AND tr.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'))
 THEN PERFORM gridex_ediel_inbound_context.require_v1(p_company_id,m.id);END IF;
 RETURN gridex_received_sources.apply_supply_before_legal_context_v1(p_company_id,p_source_message_id,p_actor_user_id);
END $$;
REVOKE ALL ON FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) TO service_role;
ALTER FUNCTION public.ediel_apply_permission_source_v1(uuid,uuid,uuid,uuid) RENAME TO apply_permission_before_legal_context_v1;
ALTER FUNCTION public.apply_permission_before_legal_context_v1(uuid,uuid,uuid,uuid) SET SCHEMA gridex_received_sources;
REVOKE ALL ON FUNCTION gridex_received_sources.apply_permission_before_legal_context_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_apply_permission_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid,p_expected_permission_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF FOUND AND m.direction='inbound' AND m.message_family='PRODAT'
 AND NOT EXISTS(SELECT FROM gridex_received_sources.permission_transitions tr WHERE tr.source_message_id=m.id AND tr.company_id=m.company_id AND tr.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND (p_expected_permission_id IS NULL OR tr.permission_id=p_expected_permission_id))
 THEN PERFORM gridex_ediel_inbound_context.require_v1(p_company_id,m.id);END IF;
 RETURN gridex_received_sources.apply_permission_before_legal_context_v1(p_company_id,p_source_message_id,p_actor_user_id,p_expected_permission_id);
END $$;
REVOKE ALL ON FUNCTION public.ediel_apply_permission_source_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_apply_permission_source_v1(uuid,uuid,uuid,uuid) TO service_role;
-- Authentic regulated-ground source fields cannot be rewritten after a supply
-- decision. Revocation is terminal and retains the former decision as history.
CREATE FUNCTION gridex_received_sources.regulated_ground_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP<>'UPDATE' OR (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at') OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN RAISE EXCEPTION 'regulated_ground_source_immutable';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.regulated_ground_immutable_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER regulated_ground_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.regulated_supply_ground_versions FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.regulated_ground_immutable_v1();
CREATE TRIGGER regulated_ground_no_truncate BEFORE TRUNCATE ON gridex_received_sources.regulated_supply_ground_versions FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.regulated_ground_immutable_v1();
CREATE FUNCTION gridex_received_sources.billing_supply_basis_v1(p_company_id uuid,p_period_id uuid,p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.customer_supply_periods%rowtype;tr gridex_received_sources.supply_source_transitions%rowtype;initial gridex_received_sources.supply_source_transitions%rowtype;
 m public.ediel_messages%rowtype;origin public.ediel_messages%rowtype;ground gridex_received_sources.regulated_supply_ground_versions%rowtype;expected jsonb;first_state jsonb;basis jsonb;ids uuid[];discovered_version bigint;discovered_origin uuid;
BEGIN
 IF p_company_id IS NULL OR p_period_id IS NULL OR p_start IS NULL OR p_end IS NULL OR p_end<=p_start THEN RETURN NULL;END IF;
 -- Discovery does not authorize a read. Source transitions acquire source rows
 -- before the period; consumers must preserve that order, including the legal
 -- capture helper's source UPDATE lock. Requalify the period after those locks.
 SELECT * INTO p FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id;
 IF NOT FOUND OR p.market_start_at IS NULL OR p.market_start_at>p_start OR (p.market_end_at IS NOT NULL AND p_end>p.market_end_at) THEN RETURN NULL;END IF;
 SELECT array_agg(source_message_id) INTO ids FROM gridex_received_sources.supply_source_transitions t WHERE t.company_id=p_company_id AND EXISTS(SELECT FROM jsonb_array_elements(t.resulting_states) own WHERE own->>'id'=p.id::text AND (own->>'market_state_version')::bigint=p.market_state_version);
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;
 discovered_version:=p.market_state_version;discovered_origin:=p.source_message_id;
 PERFORM s.id FROM public.ediel_messages s WHERE s.company_id=p_company_id AND s.id=ANY(ARRAY[ids[1],discovered_origin]) ORDER BY s.id FOR UPDATE;
 BEGIN basis:=gridex_ediel_inbound_context.require_v1(p_company_id,discovered_origin);EXCEPTION WHEN OTHERS THEN RETURN NULL;END;
 SELECT * INTO p FROM public.customer_supply_periods WHERE id=p_period_id AND company_id=p_company_id FOR SHARE;
 IF NOT FOUND OR p.market_state_version IS DISTINCT FROM discovered_version OR p.source_message_id IS DISTINCT FROM discovered_origin
 OR p.market_start_at IS NULL OR p.market_start_at>p_start OR (p.market_end_at IS NOT NULL AND p_end>p.market_end_at) THEN RETURN NULL;END IF;
 SELECT * INTO tr FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=ids[1] AND company_id=p_company_id;
 SELECT * INTO m FROM public.ediel_messages WHERE id=tr.source_message_id AND company_id=p_company_id;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR tr.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RETURN NULL;END IF;
 SELECT own INTO expected FROM jsonb_array_elements(tr.resulting_states) own WHERE own->>'id'=p.id::text;
 IF expected IS NULL OR expected->>'status'='cancelled' OR (expected->>'company_id')::uuid IS DISTINCT FROM p.company_id OR (expected->>'customer_id')::uuid IS DISTINCT FROM p.customer_id OR (expected->>'metering_point_id')::uuid IS DISTINCT FROM p.metering_point_id
 OR (expected->>'market_state_version')::bigint IS DISTINCT FROM p.market_state_version OR (expected->>'market_start_at')::timestamptz IS DISTINCT FROM p.market_start_at OR (expected->>'market_end_at')::timestamptz IS DISTINCT FROM p.market_end_at
 OR (expected->>'source_message_id')::uuid IS DISTINCT FROM p.source_message_id OR (expected->>'source_end_message_id')::uuid IS DISTINCT FROM p.source_end_message_id OR expected#>>'{metadata,sourceGroundId}' IS DISTINCT FROM p.metadata->>'sourceGroundId' THEN RETURN NULL;END IF;
 SELECT * INTO initial FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=p.source_message_id AND company_id=p_company_id AND source_code='Z04';
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO origin FROM public.ediel_messages WHERE id=initial.source_message_id AND company_id=p_company_id AND environment=m.environment;
 IF origin.id IS NULL OR initial.payload_hash IS DISTINCT FROM encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex') THEN RETURN NULL;END IF;
 SELECT own INTO first_state FROM jsonb_array_elements(initial.resulting_states) own WHERE own->>'id'=p.id::text;
 IF first_state IS NULL OR first_state#>>'{metadata,sourceGroundId}' IS DISTINCT FROM p.metadata->>'sourceGroundId' OR (first_state->>'customer_id')::uuid IS DISTINCT FROM p.customer_id OR (first_state->>'metering_point_id')::uuid IS DISTINCT FROM p.metering_point_id OR (first_state->>'market_start_at')::timestamptz IS DISTINCT FROM p.market_start_at THEN RETURN NULL;END IF;
 SELECT * INTO ground FROM gridex_received_sources.regulated_supply_ground_versions WHERE id::text=first_state#>>'{metadata,sourceGroundId}' AND company_id=p_company_id AND environment=m.environment FOR SHARE;
 IF NOT FOUND OR ground.revoked_at IS NOT NULL OR ground.valid_from>p_start OR (ground.valid_to IS NOT NULL AND p_end>ground.valid_to) OR nullif(ground.source_reference,'') IS NULL OR ground.source_sha256 !~ '^[a-f0-9]{64}$' OR nullif(ground.legal_decision_reference,'') IS NULL OR nullif(ground.registry_version,'') IS NULL THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=m.id AND v.company_id=p_company_id AND v.environment=m.environment AND v.source_payload_hash=tr.payload_hash AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND v.facts_text::jsonb->>'applicationDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN NULL;END IF;
 IF basis->>'legalActorId' IS DISTINCT FROM ground.legal_actor_id::text OR basis->>'actorRole' IS DISTINCT FROM 'electricity_supplier' THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('qualified',true,'periodId',p.id,'customerId',p.customer_id,'meteringPointId',p.metering_point_id,'sourceMessageId',m.id,'payloadHash',tr.payload_hash,'marketStateVersion',p.market_state_version,'marketStartAt',p.market_start_at,'marketEndAt',p.market_end_at,'groundId',ground.id,'groundSourceSha256',ground.source_sha256,'groundRegistryVersion',ground.registry_version);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.billing_supply_basis_v1(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_prodat_recovery_operation_basis_v1(p_company_id uuid,p_operation_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;qualified jsonb;
BEGIN
 SELECT * INTO op FROM gridex_received_sources.prodat_recovery_operations WHERE id=p_operation_id AND company_id=p_company_id;
 IF NOT FOUND OR op.kind='verified_transfer_loss' THEN RETURN NULL;END IF;
 qualified:=public.ediel_prepare_prodat_recovery_v1(p_company_id,op.original_message_id,p_actor_user_id,op.id,op.source_ack_message_id,NULL,op.corrected_raw_payload);
 IF qualified->>'status' IS DISTINCT FROM 'authorized' OR qualified->>'operationId' IS DISTINCT FROM op.id::text THEN RAISE EXCEPTION 'prodat_recovery_source_context_held';END IF;
 RETURN jsonb_build_object('originalMessageId',op.original_message_id,'operationId',op.id,'sourceAckMessageId',op.source_ack_message_id,'kind',op.kind,'correctedPayloadHash',op.corrected_payload_hash,'allowedObjects',gridex_received_sources.prodat_recovery_wire_v1(op.corrected_raw_payload)->'objects');
END $$;
REVOKE ALL ON FUNCTION public.ediel_prodat_recovery_operation_basis_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_prodat_recovery_operation_basis_v1(uuid,uuid,uuid) TO service_role;
CREATE FUNCTION public.ediel_prodat_recovery_original_basis_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op gridex_received_sources.prodat_recovery_operations%rowtype;b jsonb;
BEGIN
 SELECT operation.* INTO op FROM gridex_received_sources.prodat_recovery_messages link JOIN gridex_received_sources.prodat_recovery_operations operation ON operation.id=link.operation_id WHERE link.message_id=p_message_id AND operation.company_id=p_company_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM public.ediel_require_prodat_recovery_current_v1(p_company_id,p_message_id);
 b:=public.ediel_prodat_recovery_operation_basis_v1(p_company_id,op.id,p_actor_user_id);
 IF b IS NULL THEN RAISE EXCEPTION 'prodat_recovery_original_basis_unqualified';END IF;
 RETURN b;
END $$;
REVOKE ALL ON FUNCTION public.ediel_prodat_recovery_original_basis_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_prodat_recovery_original_basis_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
