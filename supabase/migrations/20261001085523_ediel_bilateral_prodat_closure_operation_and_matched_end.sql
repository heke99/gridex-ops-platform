-- CLI forward. A private, source-qualified requested closure is not a market
-- end. Only a matching actually sent Z08 and a whole accepted Z05 can end its
-- OWN period. Reuse the existing archived profile; create no legal byte copy.
BEGIN;
CREATE TABLE gridex_bilateral_prodat.closure_operations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),period_id uuid NOT NULL REFERENCES public.customer_supply_periods(id),
 profile_id uuid NOT NULL REFERENCES gridex_bilateral_prodat.profile_versions(id),effective_at timestamptz NOT NULL,
 period_binding jsonb NOT NULL,supply_basis jsonb NOT NULL,profile_binding jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,period_id,profile_id,effective_at));
CREATE TABLE gridex_bilateral_prodat.closure_end_receipts(
 source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),operation_id uuid NOT NULL UNIQUE REFERENCES gridex_bilateral_prodat.closure_operations(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL,source_payload_hash text NOT NULL,
 original_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),original_payload_hash text NOT NULL,
 period_id uuid NOT NULL REFERENCES public.customer_supply_periods(id),profile_id uuid NOT NULL REFERENCES gridex_bilateral_prodat.profile_versions(id),
 source_object jsonb NOT NULL,transition_hash text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(source_message_id,operation_id));
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['closure_operations','closure_end_receipts'] LOOP
 EXECUTE format('ALTER TABLE gridex_bilateral_prodat.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_bilateral_prodat.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_bilateral_prodat.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gridex_bilateral_prodat.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_immutable',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gridex_bilateral_prodat.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_no_truncate',t);
END LOOP;END$$;
CREATE FUNCTION gridex_bilateral_prodat.lock_closure_v1() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 LOCK TABLE gridex_bilateral_prodat.closure_operations,gridex_bilateral_prodat.closure_end_receipts IN SHARE ROW EXCLUSIVE MODE;
END$$;
CREATE FUNCTION gridex_bilateral_prodat.closure_scope_v1(c uuid,actor uuid,period uuid,effective timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE p public.customer_supply_periods%rowtype;mp public.metering_points%rowtype;customer public.customers%rowtype;site public.customer_sites%rowtype;contract public.customer_contracts%rowtype;
 g gridex_bilateral_prodat.profile_versions%rowtype;a gridex_bilateral_prodat.artifacts%rowtype;basis jsonb;ids uuid[];identity text;BEGIN
 PERFORM gridex_bilateral_prodat.lock_closure_v1();
 IF gridex_bilateral_prodat.actor_v1(c,actor,'archive') IS NOT TRUE OR public.gridex_actor_has_company_permission(actor,c,'metering.write') IS NOT TRUE THEN RAISE EXCEPTION 'bilateral_closure_actor_forbidden' USING ERRCODE='42501';END IF;
 IF effective IS NULL OR NOT isfinite(effective) OR date_trunc('minute',effective) IS DISTINCT FROM effective THEN RETURN NULL;END IF;
 SELECT * INTO p FROM public.customer_supply_periods WHERE id=period AND company_id=c;
 IF p.id IS NULL OR p.source_end_message_id IS NOT NULL OR p.market_end_at IS NOT NULL OR p.market_start_at>=effective OR (p.status IN('active','confirmed_by_grid_owner')) IS NOT TRUE THEN RETURN NULL;END IF;
 basis:=gridex_received_sources.supply_period_source_basis_v1(c,p.id,effective-interval '1 minute',effective);IF basis IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO mp FROM public.metering_points WHERE id=p.metering_point_id AND company_id=c;
 SELECT * INTO customer FROM public.customers WHERE id=p.customer_id AND company_id=c;
 SELECT * INTO site FROM public.customer_sites WHERE id=coalesce(mp.customer_site_id,mp.site_id) AND company_id=c AND customer_id=p.customer_id;
 SELECT * INTO contract FROM public.customer_contracts WHERE id=coalesce(p.contract_id,p.customer_contract_id) AND company_id=c AND customer_id=p.customer_id AND metering_point_id=p.metering_point_id;
 identity:=coalesce(nullif(btrim(customer.org_number),''),nullif(btrim(customer.personal_number),''));
 IF mp.id IS NULL OR customer.id IS NULL OR site.id IS NULL OR contract.id IS NULL OR mp.customer_id IS DISTINCT FROM p.customer_id OR nullif(mp.ediel_metering_point_id,'') IS NULL OR nullif(mp.grid_area_code,'') IS NULL OR nullif(mp.grid_owner_ediel_id,'') IS NULL OR nullif(identity,'') IS NULL THEN RETURN NULL;END IF;
 SELECT array_agg(v.id ORDER BY v.id) INTO ids FROM gridex_bilateral_prodat.profile_versions v JOIN gridex_bilateral_prodat.origins o ON o.ground_id=v.id AND o.company_id=v.company_id JOIN gridex_bilateral_prodat.artifacts archived ON archived.id=o.artifact_id AND archived.company_id=v.company_id
 WHERE v.company_id=c AND v.environment=(SELECT environment FROM public.ediel_messages WHERE id=p.source_message_id AND company_id=c) AND v.process='closure_request_lk' AND v.legal_actor_id::text=basis->>'legalActorId' AND v.grid_area_code=mp.grid_area_code AND archived.scope->>'legalReceiverId'=mp.grid_owner_ediel_id AND gridex_bilateral_prodat.ground_current_v1(v.id,c,effective) IS TRUE;
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;SELECT * INTO g FROM gridex_bilateral_prodat.profile_versions WHERE id=ids[1];SELECT archived.* INTO a FROM gridex_bilateral_prodat.origins o JOIN gridex_bilateral_prodat.artifacts archived ON archived.id=o.artifact_id AND archived.company_id=o.company_id WHERE o.ground_id=g.id AND o.company_id=c;
 RETURN jsonb_build_object('companyId',c,'environment',g.environment,'periodId',p.id,'periodBinding',to_jsonb(p),'supplyBasis',basis,'profileId',g.id,'profileBinding',to_jsonb(g)-'revoked_at','effectiveAt',effective,
 'customerId',customer.id,'siteId',site.id,'pointId',mp.id,'contractId',contract.id,'contractHash',gridex_received_sources.production_contract_hash_v1(contract),'externalPoint',mp.ediel_metering_point_id,'identityAgency','9','gridArea',mp.grid_area_code,'legalActorId',g.legal_actor_id,'legalSenderId',a.scope->>'legalSenderId','legalReceiverId',a.scope->>'legalReceiverId','sourceHash',a.source_hash,'sourceGrammarHash',a.scope->>'sourceGrammarHash','customerIdentity',jsonb_build_object('id',identity,'qualifier',CASE WHEN nullif(btrim(customer.org_number),'') IS NOT NULL THEN 'SE1' ELSE 'SE2' END,'agency','260'));
END$$;
CREATE FUNCTION public.ediel_prepare_bilateral_prodat_closure_operation_v1(p_company_id uuid,p_actor_user_id uuid,p_supply_period_id uuid,p_effective_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$DECLARE scope jsonb;o gridex_bilateral_prodat.closure_operations%rowtype;BEGIN
 scope:=gridex_bilateral_prodat.closure_scope_v1(p_company_id,p_actor_user_id,p_supply_period_id,p_effective_at);
 IF scope IS NULL THEN RETURN jsonb_build_object('status','held','companyId',p_company_id,'missing',ARRAY['actual_current_own_supply_and_authenticated_reviewed_lk_agreement']);END IF;
 SELECT * INTO o FROM gridex_bilateral_prodat.closure_operations WHERE company_id=p_company_id AND period_id=p_supply_period_id AND profile_id=(scope->>'profileId')::uuid AND effective_at=p_effective_at;
 IF NOT FOUND THEN INSERT INTO gridex_bilateral_prodat.closure_operations(company_id,environment,actor_user_id,period_id,profile_id,effective_at,period_binding,supply_basis,profile_binding) VALUES(p_company_id,scope->>'environment',p_actor_user_id,p_supply_period_id,(scope->>'profileId')::uuid,p_effective_at,scope->'periodBinding',scope->'supplyBasis',scope->'profileBinding') RETURNING * INTO o;END IF;
 IF o.actor_user_id IS DISTINCT FROM p_actor_user_id THEN RAISE EXCEPTION 'bilateral_closure_operation_actor_conflict';END IF;
 RETURN jsonb_build_object('status','prepared','companyId',p_company_id,'operationId',o.id,'missing','[]'::jsonb);
END$$;
CREATE FUNCTION gridex_bilateral_prodat.closure_operation_current_v1(c uuid,actor uuid,operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$DECLARE o gridex_bilateral_prodat.closure_operations%rowtype;scope jsonb;BEGIN
 PERFORM gridex_bilateral_prodat.lock_closure_v1();SELECT * INTO o FROM gridex_bilateral_prodat.closure_operations WHERE company_id=c AND id=operation;
 IF o.id IS NULL OR o.actor_user_id IS DISTINCT FROM actor THEN RETURN NULL;END IF;
 scope:=gridex_bilateral_prodat.closure_scope_v1(c,actor,o.period_id,o.effective_at);
 IF scope IS NULL OR scope->>'profileId' IS DISTINCT FROM o.profile_id::text OR scope->'profileBinding' IS DISTINCT FROM o.profile_binding
  OR ((scope->'periodBinding')-ARRAY['updated_at','status','actual_start_date']) IS DISTINCT FROM (o.period_binding-ARRAY['updated_at','status','actual_start_date'])
  OR scope#>>'{supplyBasis,initialSourceMessageId}' IS DISTINCT FROM o.supply_basis->>'initialSourceMessageId' OR scope#>>'{supplyBasis,originalPayloadHash}' IS DISTINCT FROM o.supply_basis->>'originalPayloadHash' THEN RETURN NULL;END IF;
 RETURN scope||jsonb_build_object('status','authorized','version',1,'owner','immutable-bilateral-prodat-closure-operation-v1','actorUserId',actor,'operationId',o.id,'lineItemReference','LK'||replace(o.id::text,'-',''),'documentReference','LK'||replace(o.id::text,'-',''));
END$$;
CREATE FUNCTION public.ediel_read_bilateral_prodat_closure_operation_v1(p_company_id uuid,p_actor_user_id uuid,p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 RETURN gridex_bilateral_prodat.closure_operation_current_v1(p_company_id,p_actor_user_id,p_operation_id);END$$;

CREATE FUNCTION gridex_bilateral_prodat.require_closure_draft_v1(c uuid,actor uuid,d jsonb,cap jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE scope jsonb;w jsonb;own jsonb;i public.ediel_message_intents%rowtype;r public.outbound_requests%rowtype;BEGIN
 scope:=gridex_bilateral_prodat.closure_operation_current_v1(c,actor,(d->>'sourceOperationId')::uuid);
 w:=gridex_bilateral_prodat.draft_wire_v1(d->>'rawPayload');own:=w#>'{objects,0}';
 IF scope IS NULL OR cap->>'messageCode' IS DISTINCT FROM 'Z08' OR jsonb_array_length(cap->'objects')<>1 OR jsonb_array_length(w->'objects')<>1 OR w->>'bgmId' IS DISTINCT FROM scope->>'documentReference'
  OR own->>'li' IS DISTINCT FROM scope->>'lineItemReference' OR own->>'reason' IS DISTINCT FROM 'Z23' OR own->>'point' IS DISTINCT FROM scope->>'externalPoint' OR gridex_received_sources.permission_time_v1(own->>'end') IS DISTINCT FROM (scope->>'effectiveAt')::timestamptz
  OR cap#>>'{objects,0,supplyPeriodId}' IS DISTINCT FROM scope->>'periodId' OR cap#>>'{objects,0,profileVersionId}' IS DISTINCT FROM scope->>'profileId'
  OR d->>'customerId' IS DISTINCT FROM scope->>'customerId' OR d->>'siteId' IS DISTINCT FROM scope->>'siteId' OR d->>'meteringPointId' IS DISTINCT FROM scope->>'pointId'
  OR nullif(d->>'switchRequestId','') IS NOT NULL THEN RAISE EXCEPTION 'bilateral_closure_actual_operation_required';END IF;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=(d->>'intentId')::uuid AND company_id=c FOR UPDATE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=(d->>'outboundRequestId')::uuid AND company_id=c FOR SHARE;
 IF i.id IS NULL OR i.ediel_message_id IS NOT NULL OR i.created_by IS DISTINCT FROM actor OR i.environment IS DISTINCT FROM scope->>'environment' OR i.direction IS DISTINCT FROM 'outbound' OR i.message_family IS DISTINCT FROM 'PRODAT' OR i.message_code IS DISTINCT FROM 'Z08' OR i.operation_id::text IS DISTINCT FROM scope->>'operationId'
  OR i.customer_id::text IS DISTINCT FROM scope->>'customerId' OR i.customer_site_id::text IS DISTINCT FROM scope->>'siteId' OR i.metering_point_id IS DISTINCT FROM scope->>'pointId' OR i.payload->>'transactionSubtype' IS DISTINCT FROM 'LK'
  OR r.id IS NULL OR r.request_type IS DISTINCT FROM 'supplier_switch_cancellation' OR r.source_type IS DISTINCT FROM 'manual' OR r.source_id IS DISTINCT FROM i.id OR r.operation_id IS DISTINCT FROM i.operation_id OR r.customer_id IS DISTINCT FROM i.customer_id OR r.site_id IS DISTINCT FROM i.customer_site_id OR r.metering_point_id::text IS DISTINCT FROM scope->>'pointId' OR r.payload->>'environment' IS DISTINCT FROM scope->>'environment'
 THEN RAISE EXCEPTION 'bilateral_closure_validated_own_intent_request_required';END IF;
END$$;
DO $atomic$
DECLARE d text;body text;anchor text;BEGIN
 d:=pg_get_functiondef('public.ediel_create_bilateral_prodat_original_v1(uuid,uuid,jsonb)'::regprocedure);SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='public.ediel_create_bilateral_prodat_original_v1(uuid,uuid,jsonb)'::regprocedure;
 anchor:=' IF p_draft#>>''{executionContextSnapshot,outboundOwnerWitnessId}'' IS NOT NULL';
 IF position(anchor IN body)=0 OR position('sealed:=gridex_ediel_outbound_owner.prepare_v1' IN body)=0 OR position('bilateral_prodat_outbound_actual_h_intent_required' IN body)=0 THEN RAISE EXCEPTION 'bilateral_closure_atomic_original_contract_changed';END IF;
 body:=replace(body,anchor,E' IF cap->>''messageCode''=''Z08'' THEN PERFORM gridex_bilateral_prodat.require_closure_draft_v1(p_company_id,p_actor_user_id,p_draft,cap);END IF;\n'||anchor);
 anchor:=' -- Immutable own references and created event are part of the same transaction.';
 IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'bilateral_closure_atomic_final_intent_contract_changed';END IF;
 body:=replace(body,anchor,E' IF m.message_code=''Z08'' THEN UPDATE public.ediel_message_intents SET ediel_message_id=m.id,outbound_request_id=m.outbound_request_id,render_status=''rendered'',updated_at=now() WHERE id=m.intent_id AND company_id=m.company_id;END IF;\n'||anchor);
 body:=replace(body,E'BEGIN\n',E'BEGIN\n PERFORM gridex_bilateral_prodat.lock_closure_v1();\n');
 EXECUTE replace(d,(SELECT prosrc FROM pg_proc WHERE oid='public.ediel_create_bilateral_prodat_original_v1(uuid,uuid,jsonb)'::regprocedure),body);
END $atomic$;

CREATE FUNCTION gridex_bilateral_prodat.matched_closure_operation_v1(m public.ediel_messages,w jsonb,own jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE ids uuid[];o gridex_bilateral_prodat.closure_operations%rowtype;z public.ediel_messages%rowtype;op gridex_bilateral_prodat.outbound_operations%rowtype;cap jsonb;ow jsonb;BEGIN
 IF w IS DISTINCT FROM gridex_received_sources.normal_switch_wire_v1(m.raw_payload) OR w->>'code' IS DISTINCT FROM 'Z05' OR own->>'reason' IS DISTINCT FROM 'Z23' OR (SELECT count(*) FROM jsonb_array_elements(w->'objects') actual WHERE actual=own)<>1 THEN RETURN NULL;END IF;
 cap:=gridex_bilateral_prodat.own_source_capability_v1(m,w,own);IF cap->>'process' IS DISTINCT FROM 'closure_request_lk' THEN RETURN NULL;END IF;
 SELECT array_agg(candidate.id ORDER BY candidate.id) INTO ids FROM public.ediel_messages candidate JOIN gridex_bilateral_prodat.outbound_operations sealed ON sealed.message_id=candidate.id AND sealed.company_id=candidate.company_id JOIN gridex_bilateral_prodat.closure_operations operation ON operation.id::text=candidate.source_operation_id AND operation.company_id=candidate.company_id
 WHERE candidate.company_id=m.company_id AND candidate.environment=m.environment AND candidate.direction='outbound' AND candidate.message_family='PRODAT' AND candidate.message_code='Z08' AND gridex_received_sources.sent_source_is_current_v1(candidate)
  AND operation.effective_at=gridex_received_sources.permission_time_v1(own->>'end') AND operation.profile_id::text=cap->>'profileVersionId'
  AND sealed.capability#>>'{objects,0,lineItemReference}'=own->>'li' AND sealed.capability#>>'{objects,0,objectId}'=own->>'point' AND sealed.capability#>>'{objects,0,identityAgency}'=own->>'identityAgency';
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;
 SELECT * INTO z FROM public.ediel_messages WHERE id=ids[1] AND company_id=m.company_id FOR SHARE;SELECT * INTO op FROM gridex_bilateral_prodat.outbound_operations WHERE message_id=z.id AND company_id=m.company_id;
 SELECT * INTO o FROM gridex_bilateral_prodat.closure_operations WHERE id=z.source_operation_id::uuid AND company_id=m.company_id;
 PERFORM gridex_bilateral_prodat.require_recorded_outbound_v1(z,o.actor_user_id);ow:=gridex_bilateral_prodat.draft_wire_v1(z.raw_payload);
 IF o.id IS NULL OR ow->>'sender' IS DISTINCT FROM w->>'receiver' OR ow->>'receiver' IS DISTINCT FROM w->>'sender' OR jsonb_array_length(ow->'objects')<>1 OR ow#>>'{objects,0,li}' IS DISTINCT FROM own->>'li' OR ow#>>'{objects,0,point}' IS DISTINCT FROM own->>'point'
  OR ow#>>'{objects,0,customerIdentity}' IS DISTINCT FROM own->>'customerIdentity' OR ow#>>'{objects,0,gridArea}' IS DISTINCT FROM own->>'gridArea' OR ow#>>'{objects,0,reason}' IS DISTINCT FROM 'Z23'
  OR gridex_received_sources.permission_time_v1(ow#>>'{objects,0,end}') IS DISTINCT FROM o.effective_at OR o.profile_id::text IS DISTINCT FROM cap->>'profileVersionId'
  OR NOT EXISTS(SELECT FROM public.customer_supply_periods p WHERE p.id=o.period_id AND p.company_id=m.company_id AND p.source_end_message_id IS NULL AND p.market_state_version=(o.period_binding->>'market_state_version')::bigint AND p.customer_id::text=op.capability#>>'{objects,0,customerId}' AND p.metering_point_id::text=op.capability#>>'{objects,0,pointId}') THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('operationId',o.id,'originalMessageId',z.id,'originalPayloadHash',z.immutable_payload_hash,'periodId',o.period_id,'profileId',o.profile_id);
END$$;
CREATE FUNCTION gridex_bilateral_prodat.require_matched_closure_v1(m public.ediel_messages,w jsonb,own jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF gridex_bilateral_prodat.matched_closure_operation_v1(m,w,own) IS NULL THEN RAISE EXCEPTION 'bilateral_closure_exact_sent_original_required';END IF;
END$$;
DO $end_owner$
DECLARE d text;anchor text;BEGIN
 d:=pg_get_functiondef('gridex_bilateral_prodat.confirm_h_end_v1(uuid,uuid,uuid)'::regprocedure);
 anchor:='   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object(''applied'',false,''reason'',''z05_accepted_relationship_baseline_required'');END IF;';
 IF position(anchor IN d)=0 OR position('normal_switch_confirmations confirmation' IN d)=0 OR position('regulated_supply_authentic_ground_required' IN d)=0 THEN RAISE EXCEPTION 'bilateral_closure_full_end_owner_contract_changed';END IF;
 d:=replace(d,'CREATE OR REPLACE FUNCTION gridex_bilateral_prodat.confirm_h_end_v1(','CREATE OR REPLACE FUNCTION gridex_bilateral_prodat.confirm_closure_end_v1(');
 d:=replace(d,anchor,E'   IF own->>''reason''=''Z23'' THEN PERFORM gridex_bilateral_prodat.require_matched_closure_v1(m,wire,own);ids:=ARRAY[(gridex_bilateral_prodat.matched_closure_operation_v1(m,wire,own)->>''periodId'')::uuid];END IF;\n'||anchor);
 d:=replace(d,E'BEGIN\n',E'BEGIN\n PERFORM gridex_bilateral_prodat.lock_closure_v1();\n');EXECUTE d;
END $end_owner$;

CREATE FUNCTION gridex_bilateral_prodat.recorded_closure_end_current_v1(c uuid,s uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE r gridex_bilateral_prodat.closure_end_receipts%rowtype;z public.ediel_messages%rowtype;t gridex_received_sources.supply_source_transitions%rowtype;m public.ediel_messages%rowtype;own_count int;BEGIN
 PERFORM gridex_bilateral_prodat.lock_closure_v1();SELECT * INTO m FROM public.ediel_messages WHERE id=s AND company_id=c;
 SELECT * INTO t FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=s AND company_id=c;
 IF m.id IS NULL OR t.source_message_id IS NULL OR t.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RETURN false;END IF;
 SELECT count(*) INTO own_count FROM jsonb_array_elements(t.source_objects) own WHERE own->>'reason'='Z23';
 IF own_count=0 OR own_count<>(SELECT count(*) FROM gridex_bilateral_prodat.closure_end_receipts WHERE company_id=c AND source_message_id=s) THEN RETURN false;END IF;
 FOR r IN SELECT receipt.* FROM gridex_bilateral_prodat.closure_end_receipts receipt WHERE receipt.company_id=c AND receipt.source_message_id=s LOOP
  IF r.environment IS DISTINCT FROM m.environment OR r.source_payload_hash IS DISTINCT FROM t.payload_hash OR r.transition_hash IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') OR gridex_bilateral_prodat.recorded_profile_authority_v1(r.profile_id,c) IS NOT TRUE OR NOT EXISTS(SELECT FROM jsonb_array_elements(t.source_objects) own WHERE own=r.source_object) THEN RETURN false;END IF;
  SELECT * INTO z FROM public.ediel_messages WHERE id=r.original_message_id AND company_id=c AND environment=m.environment;
  IF z.id IS NULL OR z.immutable_payload_hash IS DISTINCT FROM r.original_payload_hash OR gridex_received_sources.sent_source_is_current_v1(z) IS NOT TRUE THEN RETURN false;END IF;
  PERFORM gridex_bilateral_prodat.require_recorded_outbound_v1(z,z.created_by);
 END LOOP;RETURN true;
END$$;
CREATE FUNCTION gridex_bilateral_prodat.record_closure_end_v1(m public.ediel_messages,plans jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE t gridex_received_sources.supply_source_transitions%rowtype;plan jsonb;own jsonb;binding jsonb;BEGIN
 SELECT * INTO STRICT t FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id AND company_id=m.company_id;
 FOR plan IN SELECT p FROM jsonb_array_elements(plans) p LOOP
  own:=plan->'object';binding:=plan->'binding';
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(t.resulting_states) p WHERE p->>'id'=binding->>'periodId' AND p->>'source_end_message_id'=m.id::text AND (p->>'market_end_at')::timestamptz=gridex_received_sources.permission_time_v1(own->>'end')) THEN RAISE EXCEPTION 'bilateral_closure_actual_owned_end_required';END IF;
  INSERT INTO gridex_bilateral_prodat.closure_end_receipts(source_message_id,operation_id,company_id,environment,source_payload_hash,original_message_id,original_payload_hash,period_id,profile_id,source_object,transition_hash)
  VALUES(m.id,(binding->>'operationId')::uuid,m.company_id,m.environment,t.payload_hash,(binding->>'originalMessageId')::uuid,binding->>'originalPayloadHash',(binding->>'periodId')::uuid,(binding->>'profileId')::uuid,own,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'));
 END LOOP;
 IF gridex_bilateral_prodat.recorded_closure_end_current_v1(m.company_id,m.id) IS NOT TRUE THEN RAISE EXCEPTION 'bilateral_closure_postcommit_captured_profile_required';END IF;
 INSERT INTO public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,details) VALUES(m.company_id,t.actor_user_id,'ediel.bilateral_profile.closure_applied','ediel_message',m.id,jsonb_build_object('sourcePayloadHash',t.payload_hash,'ownedOriginals',plans,'resultingStates',t.resulting_states));
END$$;
ALTER FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) SET SCHEMA gridex_bilateral_prodat;
ALTER FUNCTION gridex_bilateral_prodat.ediel_apply_supply_source_v1(uuid,uuid,uuid) RENAME TO apply_supply_before_closure_v1;
REVOKE ALL ON FUNCTION gridex_bilateral_prodat.apply_supply_before_closure_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_apply_supply_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype;w jsonb;own jsonb;binding jsonb;plans jsonb:='[]';r jsonb;prior boolean;BEGIN
 PERFORM gridex_bilateral_prodat.lock_closure_v1();SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF m.id IS NOT NULL THEN PERFORM public.ediel_require_source_bytes_available_v1(m.company_id,m.id);END IF;w:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF m.direction='inbound' AND m.message_family='PRODAT' AND w->>'code'='Z05' AND EXISTS(SELECT FROM jsonb_array_elements(w->'objects') o WHERE o->>'reason'='Z23') THEN
  IF EXISTS(SELECT FROM jsonb_array_elements(w->'objects') o WHERE (o->>'reason' IN('Z22','Z23')) IS NOT TRUE) THEN RETURN jsonb_build_object('applied',false,'reason','bilateral_closure_whole_scope_required');END IF;
  prior:=EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id AND company_id=m.company_id);
  IF prior THEN IF gridex_bilateral_prodat.recorded_closure_end_current_v1(m.company_id,m.id) IS NOT TRUE THEN RAISE EXCEPTION 'bilateral_closure_recorded_current_profile_required';END IF;
  ELSE FOR own IN SELECT o FROM jsonb_array_elements(w->'objects') o WHERE o->>'reason'='Z23' LOOP binding:=gridex_bilateral_prodat.matched_closure_operation_v1(m,w,own);IF binding IS NULL THEN RAISE EXCEPTION 'bilateral_closure_exact_sent_original_required';END IF;plans:=plans||jsonb_build_array(jsonb_build_object('object',own,'binding',binding));END LOOP;END IF;
  r:=gridex_bilateral_prodat.confirm_closure_end_v1(p_company_id,p_source_message_id,p_actor_user_id);IF r->>'applied'='true' AND NOT prior THEN PERFORM gridex_bilateral_prodat.record_closure_end_v1(m,plans);END IF;RETURN r;
 END IF;RETURN gridex_bilateral_prodat.apply_supply_before_closure_v1(p_company_id,p_source_message_id,p_actor_user_id);
END$$;
-- Existing H/non-H currentness receives the additional own LK end contract.
DO $$DECLARE d text;body text;needle text;BEGIN
 d:=pg_get_functiondef('gridex_bilateral_prodat.recorded_supply_current_v1(uuid,uuid)'::regprocedure);SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_bilateral_prodat.recorded_supply_current_v1(uuid,uuid)'::regprocedure;
 needle:=' IF r.source_message_id IS NULL THEN RETURN NOT EXISTS(SELECT FROM jsonb_array_elements(t.source_objects) o WHERE o->>''reason''=''Z25'');END IF;';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'bilateral_closure_recorded_supply_contract_changed';END IF;
 body:=replace(body,needle,E' IF m.message_code=''Z05'' AND EXISTS(SELECT FROM jsonb_array_elements(t.source_objects) o WHERE o->>''reason''=''Z23'') THEN RETURN gridex_bilateral_prodat.recorded_closure_end_current_v1(c,s);END IF;\n'||needle);
 EXECUTE replace(d,(SELECT prosrc FROM pg_proc WHERE oid='gridex_bilateral_prodat.recorded_supply_current_v1(uuid,uuid)'::regprocedure),body);
END$$;
DO $positive_source$
DECLARE d text;body text;signature text;needle text;BEGIN
 FOREACH signature IN ARRAY ARRAY['public.ediel_require_prodat_bilateral_positive_source_v1(uuid,uuid)','public.ediel_require_recorded_prodat_bilateral_ack_source_v1(uuid,uuid,text)'] LOOP
  d:=pg_get_functiondef(signature::regprocedure);SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid=signature::regprocedure;
  IF position('prodat_bilateral_positive_source_unqualified' IN body)=0 AND position('prodat_bilateral_recorded_source_authority_required' IN body)=0 THEN RAISE EXCEPTION 'bilateral_closure_positive_source_contract_changed';END IF;
  body:=replace(body,'o->>''reason'' IN(''Z25'',''Z26'',''Z70'')','(o->>''reason'' IN(''Z25'',''Z26'',''Z70'') OR wire->>''code''=''Z05'' AND o->>''reason''=''Z23'')');
  IF signature LIKE '%positive_source%' THEN
   body:=replace(body,'IF own->>''reason'' NOT IN(''Z25'',''Z26'',''Z70'') THEN CONTINUE;END IF;','IF NOT(own->>''reason'' IN(''Z25'',''Z26'',''Z70'') OR wire->>''code''=''Z05'' AND own->>''reason''=''Z23'') THEN CONTINUE;END IF;');
   needle:='  positive:=positive||jsonb_build_array(cap||jsonb_build_object';
   IF position(needle IN body)=0 THEN RAISE EXCEPTION 'bilateral_closure_positive_owned_effect_contract_changed';END IF;
   body:=replace(body,needle,E'  IF cap->>''process''=''closure_request_lk'' AND (state->>''source_end_message_id'' IS DISTINCT FROM m.id::text OR gridex_bilateral_prodat.recorded_closure_end_current_v1(m.company_id,m.id) IS NOT TRUE) THEN RAISE EXCEPTION ''prodat_bilateral_positive_source_unqualified'';END IF;\n'||needle);
  ELSE
   needle:=' FOR own IN SELECT o FROM jsonb_array_elements(r.positive_objects) o LOOP';
   IF position(needle IN body)=0 THEN RAISE EXCEPTION 'bilateral_closure_recorded_positive_objects_contract_changed';END IF;
   body:=replace(body,needle,E' IF EXISTS(SELECT FROM jsonb_array_elements(r.positive_objects) o WHERE o->>''process''=''closure_request_lk'') AND gridex_bilateral_prodat.recorded_closure_end_current_v1(m.company_id,m.id) IS NOT TRUE THEN RAISE EXCEPTION ''prodat_bilateral_recorded_source_authority_required'';END IF;\n'||needle);
  END IF;
  EXECUTE replace(d,(SELECT prosrc FROM pg_proc WHERE oid=signature::regprocedure),body);
 END LOOP;
END $positive_source$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_bilateral_prodat FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_prepare_bilateral_prodat_closure_operation_v1(uuid,uuid,uuid,timestamptz),public.ediel_read_bilateral_prodat_closure_operation_v1(uuid,uuid,uuid),public.ediel_apply_supply_source_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_prepare_bilateral_prodat_closure_operation_v1(uuid,uuid,uuid,timestamptz),public.ediel_read_bilateral_prodat_closure_operation_v1(uuid,uuid,uuid),public.ediel_apply_supply_source_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
