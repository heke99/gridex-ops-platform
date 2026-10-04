-- CLI-created forward. Explicit NEW operator business-check report after a
-- genuinely accepted positive ACK. Never called by ACK retry/conflict replay.
BEGIN;
CREATE SCHEMA gridex_ediel_business_incidents;
REVOKE ALL ON SCHEMA gridex_ediel_business_incidents FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_ediel_business_incidents.incidents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 command_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),ack_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),
 source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),ack_hash text NOT NULL CHECK(ack_hash~'^[a-f0-9]{64}$'),scope jsonb NOT NULL,source_context jsonb NOT NULL,transport_receipt jsonb NOT NULL,
 input jsonb NOT NULL,reported_at timestamptz NOT NULL DEFAULT clock_timestamp(),status text NOT NULL DEFAULT 'reported' CHECK(status='reported'),UNIQUE(company_id,command_id)
);
CREATE TABLE gridex_ediel_business_incidents.plans(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),incident_id uuid NOT NULL REFERENCES gridex_ediel_business_incidents.incidents(id),company_id uuid NOT NULL REFERENCES public.companies(id),
 kind text NOT NULL CHECK(kind IN('contact','correction')),status text NOT NULL CHECK(status='held'),authority_required text NOT NULL,basis jsonb NOT NULL,UNIQUE(incident_id,kind)
);
CREATE TABLE gridex_ediel_business_incidents.events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),incident_id uuid NOT NULL REFERENCES gridex_ediel_business_incidents.incidents(id),company_id uuid NOT NULL REFERENCES public.companies(id),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),kind text NOT NULL CHECK(kind='fresh_business_issue_reported'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(incident_id,kind)
);
CREATE FUNCTION gridex_ediel_business_incidents.immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'ediel_business_incident_immutable';END $$;
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['incidents','plans','events'] LOOP
 EXECUTE format('ALTER TABLE gridex_ediel_business_incidents.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_ediel_business_incidents.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_ediel_business_incidents.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER immutable_business_incident BEFORE UPDATE OR DELETE ON gridex_ediel_business_incidents.%I FOR EACH ROW EXECUTE FUNCTION gridex_ediel_business_incidents.immutable_v1()',t);
END LOOP;END $$;
CREATE FUNCTION gridex_ediel_business_incidents.original_v1(c uuid,actor uuid,input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;ack public.ediel_messages%rowtype;owned jsonb;receipt jsonb;scopes jsonb;scope jsonb;tokens jsonb;refs text[];context jsonb;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 IF c IS NULL OR actor IS NULL OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(input) k WHERE k NOT IN('commandId','sourceMessageId','ackMessageId','scopeReference','finding'))
 OR NOT(input ?& ARRAY['commandId','sourceMessageId','ackMessageId','scopeReference','finding']) OR jsonb_typeof(input->'finding') IS DISTINCT FROM 'object'
 OR EXISTS(SELECT FROM jsonb_object_keys(input->'finding') k WHERE k NOT IN('code','summary')) OR input#>>'{finding,code}' IS DISTINCT FROM 'late_internal_business_error'
 OR jsonb_typeof(input#>'{finding,summary}') IS DISTINCT FROM 'string' OR length(btrim(input#>>'{finding,summary}')) NOT BETWEEN 1 AND 2000
 OR jsonb_typeof(input->'scopeReference') IS DISTINCT FROM 'string' OR length(btrim(input->>'scopeReference')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'ediel_business_incident_input_invalid';END IF;
 PERFORM (input->>'commandId')::uuid;
 IF public.gridex_actor_has_company_permission(actor,c,'communication.write') IS NOT TRUE OR public.gridex_actor_has_company_permission(actor,c,'communication.send') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_business_incident_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE company_id=c AND id=(input->>'sourceMessageId')::uuid AND direction='inbound' AND message_family IN('PRODAT','UTILTS') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_business_incident_own_source_required';END IF;
 owned:=gridex_ediel_ack_replay.read_exact_v2(c,source.environment,source.id,actor,'APERAK',(input->>'ackMessageId')::uuid);
 IF owned IS NULL OR owned#>>'{sourceMessage,id}' IS DISTINCT FROM source.id::text THEN RAISE EXCEPTION 'ediel_business_incident_own_ack_required';END IF;
 SELECT * INTO STRICT ack FROM public.ediel_messages WHERE company_id=c AND id=(owned#>>'{ackMessage,id}')::uuid AND related_message_id=source.id AND environment=source.environment FOR SHARE;
 context:=gridex_ediel_ack_replay.require_current_source_role_v2(c,source.environment,source.id);
 receipt:=public.gridex_ediel_accepted_transport_projection_v1(c,source.environment,actor,ack.id);
 IF receipt IS NULL OR receipt->>'status' IS DISTINCT FROM 'accepted_projection' OR receipt->>'messageId' IS DISTINCT FROM ack.id::text THEN RAISE EXCEPTION 'ediel_business_incident_actual_accepted_ack_required';END IF;
 IF source.message_family='PRODAT' THEN
  scopes:=gridex_ediel_ack_guide.prodat_outcomes_v1(ack.raw_payload,source.raw_payload);
  SELECT x INTO scope FROM jsonb_array_elements(scopes)x WHERE x->>'reference'=input->>'scopeReference' AND x->>'outcome'='positive';
  IF scope IS NULL OR (SELECT count(*) FROM jsonb_array_elements(scopes)x WHERE x->>'reference'=input->>'scopeReference' AND x->>'outcome'='positive')<>1 THEN RAISE EXCEPTION 'ediel_business_incident_actual_positive_scope_required';END IF;
 ELSE
  tokens:=gridex_utilts_binding.wire_tokens_v1(ack.raw_payload);
  IF (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='BGM' AND x#>>'{elements,1,0}'='312')<>1 OR ack.ack_outcome IS DISTINCT FROM 'positive' THEN RAISE EXCEPTION 'ediel_business_incident_actual_positive_scope_required';END IF;
  SELECT array_agg(x#>>'{elements,1,1}') INTO refs FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='ACW';
  IF NOT coalesce(input->>'scopeReference'=ANY(refs),false) OR (SELECT count(*) FROM unnest(refs) r WHERE r=input->>'scopeReference')<>1 THEN RAISE EXCEPTION 'ediel_business_incident_actual_positive_scope_required';END IF;
  scope:=jsonb_build_object('scope','transaction','reference',input->>'scopeReference','outcome','positive');
 END IF;
 RETURN jsonb_build_object('companyId',c,'environment',source.environment,'sourceMessageId',source.id,'ackMessageId',ack.id,'sourceHash',encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex'),'ackHash',encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex'),'scope',scope,'sourceContext',context,'transportReceipt',receipt);
END $$;
CREATE FUNCTION gridex_ediel_business_incidents.result_v1(i gridex_ediel_business_incidents.incidents) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('incidentId',i.id,'commandId',i.command_id,'companyId',i.company_id,'environment',i.environment,'sourceMessageId',i.source_message_id,'ackMessageId',i.ack_message_id,'scope',i.scope,'reportedAt',i.reported_at,'finding',i.input->'finding','status','reported','findingValidated',false,'ackHistoryChanged',false,'contactStatus','held','correctionStatus','held','trafficAuthorized',false)
$$;
CREATE FUNCTION public.ediel_report_fresh_business_incident_v1(p_company_id uuid,p_actor_user_id uuid,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE basis jsonb;i gridex_ediel_business_incidents.incidents%rowtype;kind text;
BEGIN
 basis:=gridex_ediel_business_incidents.original_v1(p_company_id,p_actor_user_id,p_input);
 -- Serialize command discovery before INSERT: retries return original rows
 -- without INSERT ON CONFLICT, trigger attempts, new timestamps or audits.
 LOCK TABLE gridex_ediel_business_incidents.incidents IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO i FROM gridex_ediel_business_incidents.incidents WHERE company_id=p_company_id AND command_id=(p_input->>'commandId')::uuid;
 IF FOUND THEN
  IF i.actor_user_id IS DISTINCT FROM p_actor_user_id OR i.input IS DISTINCT FROM p_input OR i.source_hash IS DISTINCT FROM basis->>'sourceHash' OR i.ack_hash IS DISTINCT FROM basis->>'ackHash' OR i.scope IS DISTINCT FROM basis->'scope' THEN RAISE EXCEPTION 'ediel_business_incident_command_conflict';END IF;
  RETURN gridex_ediel_business_incidents.result_v1(i);
 END IF;
 INSERT INTO gridex_ediel_business_incidents.incidents(company_id,environment,command_id,actor_user_id,source_message_id,ack_message_id,source_hash,ack_hash,scope,source_context,transport_receipt,input)
 VALUES(p_company_id,basis->>'environment',(p_input->>'commandId')::uuid,p_actor_user_id,(basis->>'sourceMessageId')::uuid,(basis->>'ackMessageId')::uuid,basis->>'sourceHash',basis->>'ackHash',basis->'scope',basis->'sourceContext',basis->'transportReceipt',p_input) RETURNING * INTO i;
 FOREACH kind IN ARRAY ARRAY['contact','correction'] LOOP INSERT INTO gridex_ediel_business_incidents.plans(incident_id,company_id,kind,status,authority_required,basis)
 VALUES(i.id,p_company_id,kind,'held','source_supported_independent_review_and_new_operation_required',jsonb_build_object('original',basis,'reportedFinding',p_input->'finding','mayChangeOriginalAck',false,'mayCreateOppositeAck',false,'maySendTraffic',false));END LOOP;
 INSERT INTO gridex_ediel_business_incidents.events(incident_id,company_id,actor_user_id,kind) VALUES(i.id,p_company_id,p_actor_user_id,'fresh_business_issue_reported');
 RETURN gridex_ediel_business_incidents.result_v1(i);
END $$;
CREATE FUNCTION public.ediel_read_fresh_business_incident_v1(p_company_id uuid,p_actor_user_id uuid,p_incident_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i gridex_ediel_business_incidents.incidents%rowtype;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 SELECT * INTO i FROM gridex_ediel_business_incidents.incidents WHERE company_id=p_company_id AND id=p_incident_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_business_incident_unavailable' USING ERRCODE='42501';END IF;
 PERFORM gridex_ediel_business_incidents.original_v1(p_company_id,p_actor_user_id,i.input);
 RETURN gridex_ediel_business_incidents.result_v1(i);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_business_incidents FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_report_fresh_business_incident_v1(uuid,uuid,jsonb),public.ediel_read_fresh_business_incident_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_report_fresh_business_incident_v1(uuid,uuid,jsonb),public.ediel_read_fresh_business_incident_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
