-- CLI 2.119.0 forward: genuine NEW transport reception only. 103 is a
-- distinct immutable negative protocol response, never the old business outcome.
BEGIN;
CREATE SCHEMA gridex_ediel_duplicate_responses;
REVOKE ALL ON SCHEMA gridex_ediel_duplicate_responses FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_ediel_duplicate_responses.intents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reception_id uuid UNIQUE NOT NULL REFERENCES gridex_ediel_inbound_receptions.receptions(id) ON DELETE RESTRICT,
 response_request_id uuid UNIQUE NOT NULL REFERENCES gridex_ediel_inbound_receptions.response_requests(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL,source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,environment text NOT NULL,
 source_hash text NOT NULL,actor_user_id uuid NOT NULL,ack_message_id uuid UNIQUE NOT NULL,ack_hash text NOT NULL,
 source_role_hash text NOT NULL,guide_source_version text NOT NULL,owner_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_ediel_duplicate_responses.consumptions(
 intent_id uuid PRIMARY KEY REFERENCES gridex_ediel_duplicate_responses.intents(id) ON DELETE RESTRICT,
 acknowledgement_id uuid UNIQUE NOT NULL REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,
 outbox_id uuid UNIQUE NOT NULL REFERENCES public.ediel_outbox(id) ON DELETE RESTRICT,
 event_id uuid UNIQUE NOT NULL REFERENCES public.ediel_message_events(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$DECLARE name text;BEGIN FOR name IN SELECT unnest(ARRAY['intents','consumptions']) LOOP
 EXECUTE format('ALTER TABLE gridex_ediel_duplicate_responses.%I ENABLE ROW LEVEL SECURITY',name);
 EXECUTE format('ALTER TABLE gridex_ediel_duplicate_responses.%I FORCE ROW LEVEL SECURITY',name);
 EXECUTE format('REVOKE ALL ON gridex_ediel_duplicate_responses.%I FROM PUBLIC,anon,authenticated,service_role',name);
 EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_ediel_duplicate_responses.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',name);
 EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_ediel_duplicate_responses.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',name);
END LOOP;END $$;
-- Current native original/actor and genuine retained NEW-mail receipt, not a
-- caller reception/hash/parsed approval. This read writes no intent or history.
CREATE FUNCTION gridex_ediel_duplicate_responses.require_actor_v1(c uuid,actor uuid,phase text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF c IS NULL OR actor IS NULL OR NOT EXISTS(SELECT FROM public.companies WHERE id=c AND status='active' AND is_active)
  OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
  OR (phase IN('prepare','send')) IS NOT TRUE
  OR (CASE phase WHEN 'prepare' THEN public.gridex_actor_has_company_permission(actor,c,'communication.write') IS TRUE
      WHEN 'send' THEN public.gridex_actor_has_company_permission(actor,c,'communication.send') IS TRUE OR public.gridex_actor_has_company_permission(actor,c,'ediel.send') IS TRUE END) IS NOT TRUE
  THEN RAISE EXCEPTION 'ediel_duplicate_current_actor_required' USING ERRCODE='42501';END IF;
END$$;
CREATE FUNCTION gridex_ediel_duplicate_responses.require_namespace_v1(c uuid,env text,ctx jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE companies uuid[];observed timestamptz;BEGIN
 IF ctx->>'basisKind' IS DISTINCT FROM 'observed_source_persistence' OR ctx->>'companyId' IS DISTINCT FROM c::text OR ctx->>'environment' IS DISTINCT FROM env THEN RAISE EXCEPTION 'ediel_duplicate_legal_scope_invalid';END IF;
 observed:=clock_timestamp();
 SELECT array_agg(DISTINCT i.company_id) INTO companies FROM public.tenant_actor_identifiers i WHERE i.environment=env AND i.identifier_type='EdielId'
  AND i.identifier_value=ctx->>'legalEdielId' AND i.valid_from<=observed AND(i.valid_to IS NULL OR observed<i.valid_to);
 IF cardinality(companies) IS DISTINCT FROM 1 OR companies[1] IS DISTINCT FROM c OR NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=env
  AND i.actor_id::text=ctx->>'legalActorId' AND i.identifier_type='EdielId' AND i.identifier_value=ctx->>'legalEdielId'
  AND i.valid_from<=observed AND(i.valid_to IS NULL OR observed<i.valid_to)) THEN RAISE EXCEPTION 'ediel_duplicate_legal_scope_invalid';END IF;
 PERFORM gridex_ediel_technical_ack.require_current_endpoint_v1(ctx);
END$$;
CREATE FUNCTION gridex_ediel_duplicate_responses.source_for_execution_v1(c uuid,source_id uuid,mail_id uuid,actor uuid,phase text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;r gridex_ediel_inbound_receptions.receptions%rowtype;q gridex_ediel_inbound_receptions.response_requests%rowtype;
 first gridex_ediel_inbound_receptions.receptions%rowtype;ctx jsonb;basis jsonb;t jsonb;original_hash text;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 PERFORM gridex_ediel_duplicate_responses.require_actor_v1(c,actor,phase);
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c AND direction='inbound' AND message_standard='edifact' AND message_family='PRODAT' FOR SHARE;
 IF m.id IS NULL OR nullif(m.raw_payload,'') IS NULL OR m.message_received_at IS NULL THEN RAISE EXCEPTION 'ediel_duplicate_actual_original_required';END IF;
 original_hash:=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
 -- Same protected source-only legal namespace/endpoint as read_exact_v2,
 -- with the actual execution purpose kept independent of that prepare port.
 ctx:=gridex_ediel_ack_replay.require_current_source_role_v2(c,m.environment,m.id);
 basis:=gridex_ediel_source_rules.require_v1(c,m.id);
 PERFORM gridex_ediel_duplicate_responses.require_namespace_v1(c,m.environment,ctx);
 IF ctx->>'actorRole' IS DISTINCT FROM 'electricity_supplier' OR ctx->>'applicationReference' IS DISTINCT FROM '23-DDQ-PRODAT' THEN RAISE EXCEPTION 'ediel_duplicate_captured_legal_ddq_required';END IF;
 SELECT * INTO r FROM gridex_ediel_inbound_receptions.receptions WHERE company_id=c AND source_message_id=m.id AND inbound_email_message_id=mail_id FOR SHARE;
 SELECT * INTO q FROM gridex_ediel_inbound_receptions.response_requests WHERE reception_id=r.id AND company_id=c AND source_message_id=m.id FOR SHARE;
 SELECT * INTO first FROM gridex_ediel_inbound_receptions.receptions WHERE company_id=c AND source_message_id=m.id AND classification='first_reception' FOR SHARE;
 IF r.id IS NULL OR q.id IS NULL OR first.id IS NULL OR r.classification IS DISTINCT FROM 'protocol_duplicate' OR q.reason IS DISTINCT FROM 'authentic_duplicate_transport_response_policy_required'
  OR r.inbound_email_message_id=first.inbound_email_message_id OR r.environment IS DISTINCT FROM m.environment OR r.canonical_payload_hash IS DISTINCT FROM original_hash OR r.received_payload_hash IS DISTINCT FROM original_hash
  OR first.canonical_payload_hash IS DISTINCT FROM original_hash OR first.received_payload_hash IS DISTINCT FROM original_hash OR r.scope IS DISTINCT FROM first.scope
  OR r.received_at IS NULL OR r.received_at<first.received_at THEN RAISE EXCEPTION 'ediel_duplicate_genuine_same_original_reception_required';END IF;
 -- P26.A p99 field A901 / DTM178 is the actual arrival. This response
 -- belongs to this NEW native reception, never the worker or first-reception
 -- clock. The canonical original timestamp and its earlier ACK remain fixed.
 -- Native source syntax/family and inherited edition/source binding are fixed.
 t:=gridex_ediel_technical_ack.require_source_v1(c,m.id);
 IF t->>'sourceHash' IS DISTINCT FROM original_hash OR t->>'environment' IS DISTINCT FROM m.environment THEN RAISE EXCEPTION 'ediel_duplicate_source_syntax_required';END IF;
 IF NOT EXISTS(SELECT FROM gridex_ediel_ack_guide.source_bindings b JOIN gridex_ediel_ack_guide.editions e ON e.source_version=b.source_version WHERE b.source_message_id=m.id AND b.kind='national' AND b.company_id=c AND b.environment=m.environment AND b.payload_sha256=original_hash AND b.original_basis=basis AND e.projection#>>'{constraints,PRODAT,applicationTexts,103}'='Dubblett av meddelandet') THEN RAISE EXCEPTION 'ediel_duplicate_inherited_103_guide_required';END IF;
 -- Source/guide/reception reads may wait; current clocks are independent of
 -- table-lock stability. Repeat purpose, role and namespace at the final edge.
 IF gridex_ediel_ack_replay.require_current_source_role_v2(c,m.environment,m.id) IS DISTINCT FROM ctx THEN RAISE EXCEPTION 'ediel_duplicate_current_source_changed';END IF;
 PERFORM gridex_ediel_duplicate_responses.require_namespace_v1(c,m.environment,ctx);
 PERFORM gridex_ediel_duplicate_responses.require_actor_v1(c,actor,phase);
 RETURN jsonb_build_object('sourceMessage',to_jsonb(m),'receptionId',r.id,'responseRequestId',q.id,'sourceHash',original_hash,'currentContext',ctx,'technicalBasis',t,'sourceReceivedDate203',to_char(r.received_at AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI'),'sourceRulePackEvidence',basis,'businessEffectAuthorized',false);
END $$;
CREATE FUNCTION gridex_ediel_duplicate_responses.source_v1(c uuid,source_id uuid,mail_id uuid,actor uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_ediel_duplicate_responses.source_for_execution_v1(c,source_id,mail_id,actor,'prepare')$$;
CREATE FUNCTION gridex_ediel_duplicate_responses.is_duplicate_ack_v1(ack_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT FROM gridex_ediel_duplicate_responses.consumptions c WHERE c.acknowledgement_id=ack_id)$$;
-- Prospective authorization is private native same-TX intent, not a JSON flag.
-- Established authorization additionally requires actual witness consumption.
CREATE FUNCTION gridex_ediel_duplicate_responses.allows_message_v1(m public.ediel_messages) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT m.direction='outbound' AND m.message_family='APERAK' AND EXISTS(SELECT FROM gridex_ediel_duplicate_responses.intents i WHERE i.company_id=m.company_id AND i.environment=m.environment AND i.source_message_id=m.related_message_id AND i.ack_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  AND((i.owner_xid=pg_current_xact_id() AND(m.id IS NULL OR m.id=i.ack_message_id)) OR EXISTS(SELECT FROM gridex_ediel_duplicate_responses.consumptions c JOIN gridex_ediel_outbound_owner.consumptions w ON w.source_message_id=c.acknowledgement_id AND w.company_id=i.company_id AND w.environment=i.environment AND w.payload_sha256=i.ack_hash WHERE c.intent_id=i.id AND c.acknowledgement_id=m.id AND m.id=i.ack_message_id)))
$$;
CREATE FUNCTION gridex_ediel_duplicate_responses.require_wire_v1(raw text,source_raw text,projection jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(raw);t jsonb;tags text[];ref_count int;BEGIN
 IF gridex_ediel_ack_guide.validate_v1(raw,source_raw,projection) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_duplicate_native_103_wire_required';END IF;
 PERFORM gridex_ediel_ack_guide.require_fresh_ack_envelope_v1(raw,'APERAK');
 SELECT array_agg(x->>'tag' ORDER BY(x->>'index')::int) INTO tags FROM jsonb_array_elements(tokens)x;
 -- Strict complete D96A producer subset: SG1 ACW before SG2 legal NAD;
 -- SG3 ERC+FTX; at most one SG4 RFF. No directory relaxation for known Z07+LI.
 IF tags IS DISTINCT FROM ARRAY['UNB','UNH','BGM','DTM','DTM','RFF','NAD','NAD','ERC','FTX','UNT','UNZ']::text[] AND tags IS DISTINCT FROM ARRAY['UNB','UNH','BGM','DTM','DTM','RFF','NAD','NAD','ERC','FTX','RFF','UNT','UNZ']::text[] THEN RAISE EXCEPTION 'ediel_duplicate_strict_96a_scope_held';END IF;
 IF tokens#>>'{2,elements,3,0}' IS DISTINCT FROM '27' OR tokens#>>'{3,elements,1,0}' IS DISTINCT FROM '137' OR tokens#>>'{4,elements,1,0}' IS DISTINCT FROM '178' OR tokens#>>'{5,elements,1,0}' IS DISTINCT FROM 'ACW'
  OR tokens#>>'{6,elements,1,0}' IS DISTINCT FROM 'FR' OR tokens#>>'{7,elements,1,0}' IS DISTINCT FROM 'DO' OR tokens#>>'{8,elements,1,0}' IS DISTINCT FROM '40' OR tokens#>>'{9,elements,3,0}' IS DISTINCT FROM '103' OR tokens#>>'{9,elements,4,0}' IS DISTINCT FROM 'Dubblett av meddelandet' THEN RAISE EXCEPTION 'ediel_duplicate_exact_103_required';END IF;
 -- Mandatory own known reference facts are retained, including when that
 -- requires a truthful strict-directory hold. Never drop one to make wire green.
 SELECT count(DISTINCT jsonb_build_array(x#>>'{elements,1,0}',x#>>'{elements,1,1}')) INTO ref_count FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2(source_raw))x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='LI' AND nullif(x#>>'{elements,1,1}','') IS NOT NULL;
 IF ref_count>1 THEN RAISE EXCEPTION 'ediel_duplicate_multiple_own_reference_scope_held';END IF;
 IF ref_count=1 AND NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)a JOIN jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2(source_raw))s ON s->>'tag'='RFF' AND s#>>'{elements,1,0}'='LI' AND a#>>'{elements,1,1}'=s#>>'{elements,1,1}' WHERE a->>'tag'='RFF' AND a#>>'{elements,1,0}'='LI') THEN RAISE EXCEPTION 'ediel_duplicate_known_own_reference_required';END IF;
 SELECT count(DISTINCT x#>>'{elements,3,0}') INTO ref_count FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2(source_raw))x WHERE x->>'tag'='LIN' AND nullif(x#>>'{elements,3,0}','') IS NOT NULL;
 IF ref_count>1 THEN RAISE EXCEPTION 'ediel_duplicate_multiple_own_reference_scope_held';END IF;
 IF ref_count=1 AND NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)a JOIN jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2(source_raw))s ON s->>'tag'='LIN' AND a#>>'{elements,1,1}'=s#>>'{elements,3,0}' WHERE a->>'tag'='RFF' AND a#>>'{elements,1,0}'='Z07') THEN RAISE EXCEPTION 'ediel_duplicate_known_own_reference_required';END IF;
END $$;
CREATE FUNCTION gridex_ediel_duplicate_responses.read_result_v1(i gridex_ediel_duplicate_responses.intents) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c gridex_ediel_duplicate_responses.consumptions%rowtype;m public.ediel_messages%rowtype;o public.ediel_outbox%rowtype;BEGIN
 SELECT * INTO c FROM gridex_ediel_duplicate_responses.consumptions WHERE intent_id=i.id;
 IF c.intent_id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=c.acknowledgement_id AND company_id=i.company_id AND environment=i.environment AND related_message_id=i.source_message_id FOR SHARE;
 SELECT * INTO o FROM public.ediel_outbox WHERE id=c.outbox_id AND company_id=i.company_id AND environment=i.environment AND ediel_message_id=m.id AND source_message_id=i.source_message_id FOR SHARE;
 IF m.id IS NULL OR o.id IS NULL OR m.message_family IS DISTINCT FROM 'APERAK' OR m.direction IS DISTINCT FROM 'outbound' OR m.ack_outcome IS DISTINCT FROM 'negative' OR encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') IS DISTINCT FROM i.ack_hash OR gridex_ediel_duplicate_responses.allows_message_v1(m) IS NOT TRUE OR NOT EXISTS(SELECT FROM public.ediel_message_events e WHERE e.id=c.event_id AND e.company_id=i.company_id AND e.ediel_message_id=m.id) THEN RAISE EXCEPTION 'ediel_duplicate_established_receipt_changed';END IF;
 RETURN jsonb_build_object('status','protocol_response_prepared','ackMessage',to_jsonb(m),'outboxId',o.id,'receptionId',i.reception_id,'responseRequestId',i.response_request_id,'businessEffectAuthorized',false);
END $$;
CREATE FUNCTION public.ediel_prepare_duplicate_103_response_v1(p_company_id uuid,p_source_message_id uuid,p_inbound_email_message_id uuid,p_actor_user_id uuid,p_smtp jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source jsonb;i gridex_ediel_duplicate_responses.intents%rowtype;existing jsonb;route jsonb;BEGIN
 PERFORM gridex_prodat_object_batch.require_service_v1();source:=gridex_ediel_duplicate_responses.source_v1(p_company_id,p_source_message_id,p_inbound_email_message_id,p_actor_user_id);
 SELECT * INTO i FROM gridex_ediel_duplicate_responses.intents WHERE reception_id=(source->>'receptionId')::uuid;
 existing:=gridex_ediel_duplicate_responses.read_result_v1(i);IF existing IS NOT NULL THEN
  PERFORM gridex_ediel_duplicate_responses.source_v1(p_company_id,p_source_message_id,p_inbound_email_message_id,p_actor_user_id);
  RETURN existing||jsonb_build_object('replayed',true);END IF;
 PERFORM public.ediel_require_source_bytes_available_v1(p_company_id,p_source_message_id);
 IF p_smtp IS NULL THEN
  IF gridex_ediel_duplicate_responses.source_v1(p_company_id,p_source_message_id,p_inbound_email_message_id,p_actor_user_id) IS DISTINCT FROM source THEN RAISE EXCEPTION 'ediel_duplicate_current_source_changed';END IF;
  RETURN source||jsonb_build_object('status','qualified','route',NULL,'serverDate203',to_char(clock_timestamp() AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI'));END IF;
 route:=gridex_ediel_technical_ack.select_configured_reply_route_v2(p_company_id,source->'technicalBasis','APERAK',p_smtp->>'from',p_smtp->>'host',(p_smtp->>'port')::int);
 IF gridex_ediel_duplicate_responses.source_v1(p_company_id,p_source_message_id,p_inbound_email_message_id,p_actor_user_id) IS DISTINCT FROM source THEN RAISE EXCEPTION 'ediel_duplicate_current_source_changed';END IF;
 RETURN source||jsonb_build_object('status','qualified','route',route,'serverDate203',to_char(clock_timestamp() AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI'));
END $$;

CREATE FUNCTION gridex_ediel_duplicate_responses.create_v1(c uuid,source_id uuid,mail_id uuid,actor uuid,draft jsonb,smtp jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE existing jsonb;s public.ediel_messages%rowtype;m public.ediel_messages%rowtype;w gridex_ediel_outbound_owner.witnesses%rowtype;
 env text;source_hash text;family text:='APERAK';sequence_field text;sequence_value text;outcome text:='negative';
 source jsonb;i gridex_ediel_duplicate_responses.intents%rowtype;outbox_id uuid;ctx jsonb;basis jsonb;prepared jsonb;route jsonb;tokens jsonb;unb jsonb;unh jsonb;bgm jsonb;parsed jsonb;raw text;physical_family text;wire_outcome text;common boolean;
 op text;event_id uuid;business_type text;business_id uuid;resource record;resource_json jsonb;reference record;result jsonb;
BEGIN
 -- Shared permission/bilateral prefix precedes the write-compatible native
 -- candidate universe; no SHARE-to-INSERT upgrade or caller hash capability.
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 LOCK TABLE gridex_ediel_duplicate_responses.intents IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
 source:=gridex_ediel_duplicate_responses.source_v1(c,source_id,mail_id,actor);
 s:=jsonb_populate_record(NULL::public.ediel_messages,source->'sourceMessage');env:=s.environment;source_hash:=source->>'sourceHash';basis:=source->'sourceRulePackEvidence';
 SELECT * INTO i FROM gridex_ediel_duplicate_responses.intents WHERE reception_id=(source->>'receptionId')::uuid;
 existing:=gridex_ediel_duplicate_responses.read_result_v1(i);IF existing IS NOT NULL THEN
  PERFORM gridex_ediel_duplicate_responses.source_v1(c,source_id,mail_id,actor);
  RETURN existing||jsonb_build_object('replayed',true);END IF;
 PERFORM public.ediel_require_source_bytes_available_v1(c,s.id);
 -- Fresh-only caller whitelist. An established own response above never uses
 -- a new draft, mints a witness, writes a receipt/event or selects a route.
 IF jsonb_typeof(draft) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(draft) k WHERE k<>ALL(ARRAY[
  'rawPayload','messageVersion','processType','transportType','mailbox','senderEdielId','senderName','senderSubAddress','receiverEdielId','receiverName','receiverSubAddress',
  'senderEmail','receiverEmail','subject','fileName','mimeType','interchangeReference','externalReference','correlationReference','transactionReference','applicationReference',
  'originalMessageId','originalTransactionId','originalMessageCode','communicationRouteId','routeProfileId','parsedPayload','validationReport',
  'requiresContrl','requiresAperak','syntaxCheckStatus','functionalCheckStatus','messageCreatedAt','validatedAt','ackDueAt'])) THEN RAISE EXCEPTION 'ediel_ack_atomic_draft_whitelist_required';END IF;
 raw:=draft->>'rawPayload';IF nullif(raw,'') IS NULL OR octet_length(raw)>8388608 THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_required';END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(raw);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH')<>1 THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_required';END IF;
 SELECT t INTO unb FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB';SELECT t INTO unh FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH';SELECT t INTO bgm FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM';
 physical_family:=CASE WHEN unh#>>'{elements,2,0}'='UTILTS' AND bgm#>>'{elements,1,0}'='ERR' THEN 'UTILTS_ERR' ELSE unh#>>'{elements,2,0}' END;
 IF physical_family IS DISTINCT FROM family THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_family_mismatch';END IF;
 IF jsonb_typeof(smtp) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_duplicate_actual_smtp_required';END IF;
 route:=gridex_ediel_technical_ack.select_configured_reply_route_v2(c,source->'technicalBasis','APERAK',smtp->>'from',smtp->>'host',(smtp->>'port')::int);
 IF tokens#>>'{4,elements,1,1}' IS DISTINCT FROM source->>'sourceReceivedDate203' OR tokens#>>'{4,elements,1,2}' IS DISTINCT FROM '203' THEN RAISE EXCEPTION 'ediel_duplicate_actual_received_clock_required';END IF;
 SELECT b.source_version INTO STRICT i.guide_source_version FROM gridex_ediel_ack_guide.source_bindings b WHERE b.source_message_id=s.id AND b.kind='national' AND b.company_id=c AND b.environment=env;
 PERFORM gridex_ediel_duplicate_responses.require_wire_v1(raw,s.raw_payload,(SELECT e.projection FROM gridex_ediel_ack_guide.editions e WHERE e.source_version=i.guide_source_version));
 i.id:=gen_random_uuid();i.reception_id:=(source->>'receptionId')::uuid;i.response_request_id:=(source->>'responseRequestId')::uuid;i.company_id:=c;i.source_message_id:=s.id;i.environment:=env;i.source_hash:=source_hash;i.actor_user_id:=actor;
 i.ack_message_id:=gen_random_uuid();i.ack_hash:=encode(sha256(convert_to(raw,'UTF8')),'hex');i.source_role_hash:=encode(sha256(convert_to((source->'currentContext')::text,'UTF8')),'hex');i.owner_xid:=pg_current_xact_id();i.created_at:=clock_timestamp();
 INSERT INTO gridex_ediel_duplicate_responses.intents SELECT i.*;
 prepared:=gridex_ediel_outbound_owner.prepare_v1(jsonb_build_object('companyId',c,'environment',env,'actorUserId',actor,'rawPayload',raw,'relatedMessageId',s.id,'rulePackEvidence',basis));
 SELECT * INTO STRICT w FROM gridex_ediel_outbound_owner.witnesses WHERE id=(prepared->>'witnessId')::uuid;
 IF w.family IS DISTINCT FROM 'APERAK' OR w.related_message_id IS DISTINCT FROM s.id OR w.company_id IS DISTINCT FROM c OR w.environment IS DISTINCT FROM env OR w.payload_sha256 IS DISTINCT FROM i.ack_hash THEN RAISE EXCEPTION 'ediel_duplicate_owner_scope_mismatch';END IF;
 -- Native parse controls all physical reference/endpoint metadata; no parsed
 -- caller reference or foreign resource ID becomes a business identity.
 parsed:=coalesce(draft->'parsedPayload','{}'::jsonb)-ARRAY['relatedTransactionReference','utiltsErrSequenceToken','ackScope','sourceMessageId','ackSourceId','serviceAssignment','sourceAuthority','rulePackEvidence'];
 IF jsonb_typeof(parsed) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_ack_atomic_metadata_required';END IF;
 IF sequence_field IS NOT NULL THEN parsed:=parsed||jsonb_build_object(sequence_field,sequence_value);END IF;
 IF sequence_field='relatedTransactionReference' THEN parsed:=parsed||jsonb_build_object('ackScope','transaction');END IF;
 parsed:=parsed||jsonb_build_object('ackSourceId',s.id,'ackFamily',family);
 op:='ediel_duplicate103:'||i.reception_id::text;
 m.id:=i.ack_message_id;m.company_id:=c;m.environment:=env;m.direction:='outbound';m.message_standard:='edifact';m.message_family:=family;
 m.message_code:=CASE WHEN w.id IS NOT NULL THEN w.code ELSE family END;m.raw_payload:=raw;m.related_message_id:=s.id;m.status:='draft';m.source_operation_id:=op;
 m.test_flag:=CASE env WHEN 'production' THEN 0 ELSE 1 END;m.message_version:=draft->>'messageVersion';m.process_type:=draft->>'processType';m.transport_type:='smtp';
 m.sender_ediel_id:=unb#>>'{elements,2,0}';m.receiver_ediel_id:=unb#>>'{elements,3,0}';m.sender_sub_address:=nullif(unb#>>'{elements,2,2}','');m.receiver_sub_address:=nullif(unb#>>'{elements,3,2}','');
 m.interchange_reference:=unb#>>'{elements,5,0}';m.application_reference:=unb#>>'{elements,7,0}';m.original_message_id:=unh#>>'{elements,1,0}';m.external_reference:=bgm#>>'{elements,2,0}';
 m.original_transaction_id:=sequence_value;m.original_message_code:=CASE WHEN common THEN NULL ELSE s.message_code END;
 SELECT t#>>'{elements,1,1}' INTO m.correlation_reference FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW' ORDER BY (t->>'index')::int LIMIT 1;
 SELECT t#>>'{elements,1,1}' INTO m.transaction_reference FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='TN' ORDER BY (t->>'index')::int LIMIT 1;
 m.sender_name:=draft->>'senderName';m.receiver_name:=draft->>'receiverName';m.subject:=draft->>'subject';m.file_name:=draft->>'fileName';m.mime_type:=draft->>'mimeType';
 m.communication_route_id:=nullif(draft->>'communicationRouteId','')::uuid;m.route_profile_id:=nullif(draft->>'routeProfileId','')::uuid;
 m.sender_email:=draft->>'senderEmail';m.receiver_email:=draft->>'receiverEmail';m.mailbox:=draft->>'mailbox';
 IF route IS NOT NULL THEN
  IF m.communication_route_id::text IS DISTINCT FROM route#>>'{route,id}' OR m.route_profile_id::text IS DISTINCT FROM route#>>'{routeRuntime,route_profile_id}'
   OR m.sender_email IS DISTINCT FROM route->>'senderEmail' OR m.receiver_email IS DISTINCT FROM route->>'receiverEmail' OR m.mailbox IS DISTINCT FROM route->>'mailbox' THEN RAISE EXCEPTION 'ediel_ack_atomic_route_changed';END IF;
 ELSE
  -- Fresh ordinary response selects the exact named route/profile under lock;
  -- replay above never consults these mutable rows.
  LOCK TABLE public.communication_routes,public.ediel_route_profiles,public.ediel_transport_profiles IN SHARE MODE;
  IF NOT EXISTS(SELECT FROM public.communication_routes r JOIN public.ediel_route_profiles p ON p.communication_route_id=r.id AND p.company_id=c
   WHERE r.id=m.communication_route_id AND p.id=m.route_profile_id AND r.company_id=c AND r.is_active AND p.is_enabled AND p.environment=env
    AND p.sender_ediel_id=m.sender_ediel_id AND p.receiver_ediel_id=m.receiver_ediel_id
    AND coalesce(p.sender_subaddress,p.sender_sub_address,'')=coalesce(m.sender_sub_address,'') AND coalesce(p.receiver_subaddress,p.receiver_sub_address,'')=coalesce(m.receiver_sub_address,'')
    AND p.application_reference IS NOT DISTINCT FROM m.application_reference AND r.target_email IS NOT DISTINCT FROM m.receiver_email AND p.mailbox IS NOT DISTINCT FROM m.mailbox) THEN RAISE EXCEPTION 'ediel_ack_atomic_route_changed';END IF;
 END IF;
 IF common THEN m.execution_context_snapshot:=jsonb_build_object('prodatCommonHeaderNegativeWitnessId',prepared->>'witnessId');
 ELSIF w.id IS NOT NULL THEN
  m.execution_context_snapshot:=jsonb_build_object('outboundOwnerWitnessId',w.id);m.canonical_rule_pack_id:=(w.evidence->>'rulePackId')::uuid;m.rule_profile_version_id:=(w.evidence->>'messageProfileId')::uuid;
  m.rule_profile_key:=w.evidence->>'profileKey';m.rule_profile_version:=w.evidence->>'version';m.rule_pack_checksum:=w.evidence->>'sourceHash';m.rule_pack_snapshot:=w.evidence->'snapshot';
  -- Protocol-only negative response inherits no business resource links.
 END IF;
 m.parsed_payload:=parsed;m.validation_report:=coalesce(draft->'validationReport','{}'::jsonb);m.requires_contrl:=false;m.requires_aperak:=false;
 m.contrl_status:='not_required';m.aperak_status:='not_required';m.utilts_err_status:='not_required';m.syntax_check_status:=draft->>'syntaxCheckStatus';m.functional_check_status:=draft->>'functionalCheckStatus';
 m.message_created_at:=coalesce((draft->>'messageCreatedAt')::timestamptz,clock_timestamp());m.validated_at:=(draft->>'validatedAt')::timestamptz;m.ack_due_at:=(draft->>'ackDueAt')::timestamptz;
 m.created_by:=actor;m.updated_by:=actor;
 -- Set physical outcome before immutable namespace/public row insertion.
 IF family='CONTRL' THEN wire_outcome:=CASE basis->>'syntaxDecision' WHEN 'accepted' THEN 'positive' WHEN 'rejected' THEN 'negative' END;
 ELSIF common OR family='UTILTS_ERR' THEN wire_outcome:='negative';
 ELSE wire_outcome:=CASE WHEN EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC') AND NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='ERC' AND t#>>'{elements,1,0}'<>'100') THEN 'positive' ELSE 'negative' END;END IF;
 IF wire_outcome IS NULL OR outcome IS NOT NULL AND outcome IS DISTINCT FROM wire_outcome THEN RAISE EXCEPTION 'ediel_ack_atomic_wire_outcome_mismatch';END IF;
 m.ack_outcome:=wire_outcome;m.ack_status:=wire_outcome;m.parsed_payload:=m.parsed_payload||jsonb_build_object('ackOutcome',wire_outcome);
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,message_version,process_type,test_flag,status,transport_type,
  raw_payload,related_message_id,source_operation_id,sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address,sender_name,receiver_name,sender_email,receiver_email,mailbox,subject,file_name,mime_type,
  communication_route_id,route_profile_id,interchange_reference,application_reference,original_message_id,original_transaction_id,original_message_code,external_reference,correlation_reference,transaction_reference,
  execution_context_snapshot,canonical_rule_pack_id,rule_profile_version_id,rule_profile_key,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,
  customer_id,site_id,metering_point_id,grid_owner_id,switch_request_id,grid_owner_data_request_id,outbound_request_id,partner_export_id,
  parsed_payload,validation_report,requires_contrl,requires_aperak,contrl_status,aperak_status,utilts_err_status,ack_outcome,ack_status,syntax_check_status,functional_check_status,message_created_at,validated_at,ack_due_at,created_by,updated_by)
 VALUES(m.id,m.company_id,m.environment,m.direction,m.message_standard,m.message_family,m.message_code,m.message_version,m.process_type,m.test_flag,m.status,m.transport_type,
  m.raw_payload,m.related_message_id,m.source_operation_id,m.sender_ediel_id,m.receiver_ediel_id,m.sender_sub_address,m.receiver_sub_address,m.sender_name,m.receiver_name,m.sender_email,m.receiver_email,m.mailbox,m.subject,m.file_name,m.mime_type,
  m.communication_route_id,m.route_profile_id,m.interchange_reference,m.application_reference,m.original_message_id,m.original_transaction_id,m.original_message_code,m.external_reference,m.correlation_reference,m.transaction_reference,
  m.execution_context_snapshot,m.canonical_rule_pack_id,m.rule_profile_version_id,m.rule_profile_key,m.rule_profile_version,m.rule_pack_checksum,m.rule_pack_snapshot,
  m.customer_id,m.site_id,m.metering_point_id,m.grid_owner_id,m.switch_request_id,m.grid_owner_data_request_id,m.outbound_request_id,m.partner_export_id,
  m.parsed_payload,m.validation_report,m.requires_contrl,m.requires_aperak,m.contrl_status,m.aperak_status,m.utilts_err_status,m.ack_outcome,m.ack_status,m.syntax_check_status,m.functional_check_status,m.message_created_at,m.validated_at,m.ack_due_at,m.created_by,m.updated_by) RETURNING * INTO m;
 -- Native witness/source/guide triggers consumed the exact same-TX intent.
 IF NOT EXISTS(SELECT FROM gridex_ediel_outbound_owner.consumptions co WHERE co.source_message_id=m.id AND co.witness_id=w.id AND co.company_id=c AND co.environment=env AND co.payload_sha256=i.ack_hash) THEN RAISE EXCEPTION 'ediel_duplicate_native_witness_not_consumed';END IF;
 INSERT INTO public.ediel_outbox(company_id,ediel_message_id,source_message_id,status,priority,lock_key,message_family,message_code,ack_outcome,environment,route_profile_id,payload,created_by,updated_by)
 VALUES(c,m.id,s.id,'prepared',100,c::text||':'||env||':ack:'||m.id::text,'APERAK',m.message_code,'negative',env,m.route_profile_id,'{}',actor,actor) RETURNING id INTO outbox_id;
 INSERT INTO public.ediel_message_events(company_id,ediel_message_id,message_id,event_type,event_status,message,payload,event_payload,created_by)
  VALUES(c,m.id,m.id,'created','info','Ediel message '||family||' '||coalesce(m.message_code,'')||' skapad.',jsonb_build_object('status',m.status,'direction',m.direction,'externalReference',m.external_reference,'communicationRouteId',m.communication_route_id),jsonb_build_object('sourceMessageId',s.id,'sourceOperationId',op,'atomicOwner',true),actor) RETURNING id INTO event_id;
 INSERT INTO gridex_ediel_duplicate_responses.consumptions(intent_id,acknowledgement_id,outbox_id,event_id,actor_user_id) VALUES(i.id,m.id,outbox_id,event_id,actor);
 -- NEW transport receipt only; canonical source and old ACK remain untouched.
 UPDATE public.inbound_email_messages SET processing_status='manual_review',match_status='protocol_response_prepared',error_message=NULL,match_payload=coalesce(match_payload,'{}')||jsonb_build_object('protocolResponse',jsonb_build_object('receptionId',i.reception_id,'responseRequestId',i.response_request_id,'ackMessageId',m.id,'outboxId',outbox_id)),updated_at=clock_timestamp() WHERE id=mail_id AND company_id=c;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_duplicate_new_mail_scope_changed';END IF;
 -- Row/table locks stabilize mutations; clocks can still cross validity bounds
 -- while native witness/namespace/outbox work waits. Recheck at commit end.
 result:=gridex_ediel_duplicate_responses.read_result_v1(i);
 IF gridex_ediel_duplicate_responses.source_v1(c,source_id,mail_id,actor) IS DISTINCT FROM source THEN RAISE EXCEPTION 'ediel_duplicate_current_source_changed';END IF;
 RETURN result||jsonb_build_object('replayed',false);
END $$;
CREATE FUNCTION public.ediel_commit_duplicate_103_response_v1(p_company_id uuid,p_source_message_id uuid,p_inbound_email_message_id uuid,p_actor_user_id uuid,p_draft jsonb,p_smtp jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_prodat_object_batch.require_service_v1();RETURN gridex_ediel_duplicate_responses.create_v1(p_company_id,p_source_message_id,p_inbound_email_message_id,p_actor_user_id,p_draft,p_smtp);END$$;
-- Prospective exception is a private same-TX birth receipt; all other paths
-- retain their full old native planned-response/positive/bilateral owners.
DO $prepare$ DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('gridex_ediel_outbound_owner.prepare_before_prodat_response_plan_v1(jsonb)'::regprocedure);
 -- The current public prepare chain is preserved verbatim. The 103 branch
 -- skips only the ordinary planned-response facet, retaining envelope/native
 -- guide, current actor/namespace/witness/source owner and unused BGM guards.
 definition:=pg_get_functiondef('gridex_ediel_outbound_owner.prepare_v1(jsonb)'::regprocedure);
 IF position('BEGIN' IN definition)=0 THEN RAISE EXCEPTION 'duplicate_prepare_body_changed';END IF;
 definition:=replace(definition,'BEGIN','BEGIN
 IF gridex_ediel_duplicate_responses.allows_message_v1(jsonb_populate_record(NULL::public.ediel_messages,jsonb_build_object(''direction'',''outbound'',''message_family'',''APERAK'',''company_id'',p_input->>''companyId'',''environment'',p_input->>''environment'',''related_message_id'',p_input->>''relatedMessageId'',''raw_payload'',p_input->>''rawPayload''))) THEN
  PERFORM gridex_ediel_ack_guide.require_fresh_ack_envelope_v1(p_input->>''rawPayload'',''APERAK'');PERFORM gridex_ediel_ack_guide.require_prodat_unused_document_v1(p_input->>''rawPayload'');
  RETURN gridex_ediel_outbound_owner.prepare_before_prodat_response_plan_v1(p_input);END IF;');
 EXECUTE definition;
END $prepare$;
DO $guide$ DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('gridex_ediel_ack_guide.validate_response_for_message_v1(public.ediel_messages,public.ediel_messages,jsonb)'::regprocedure);
 definition:=replace(definition,'BEGIN','BEGIN
 IF gridex_ediel_duplicate_responses.allows_message_v1(m) THEN PERFORM gridex_ediel_duplicate_responses.require_wire_v1(m.raw_payload,s.raw_payload,projection);RETURN true;END IF;');EXECUTE definition;
 definition:=pg_get_functiondef('gridex_ediel_ack_guide.require_prodat_scope_v1(public.ediel_messages)'::regprocedure);
 definition:=replace(definition,'BEGIN','BEGIN
 IF gridex_ediel_duplicate_responses.allows_message_v1(m) THEN RETURN;END IF;');
 IF position(' FOR SHARE LOOP' IN definition)=0 THEN RAISE EXCEPTION 'duplicate_scope_candidate_changed';END IF;
 -- Only immutable consumed duplicate IDs are omitted; no outcome/status flag.
 definition:=regexp_replace(definition,' FOR SHARE LOOP',' FOR SHARE LOOP
  IF gridex_ediel_duplicate_responses.is_duplicate_ack_v1(prior.id) THEN CONTINUE;END IF;');EXECUTE definition;
END $guide$;

-- Ordinary original readers never confuse this newly received protocol response
-- with the prior business outcome. Same OID/owner/ACL; no status/JSON inference.
DO $readers$ DECLARE definition text;needle text;BEGIN
 definition:=pg_get_functiondef('gridex_ediel_ack_replay.read_v1(uuid,text,uuid,uuid,text,text,text)'::regprocedure);
 needle:='AND m.related_message_id=source.id AND m.message_family=family';IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'duplicate_business_reader_shape_changed';END IF;
 EXECUTE replace(definition,needle,needle||' AND NOT gridex_ediel_duplicate_responses.is_duplicate_ack_v1(m.id)');
 definition:=pg_get_functiondef('gridex_ediel_ack_replay.read_scope_v2(uuid,text,uuid,text,uuid,text,text)'::regprocedure);
 needle:='ORDER BY p.id FOR SHARE LOOP';IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'duplicate_scope_reader_shape_changed';END IF;
 -- Continue before attempting ordinary ledger qualification; all OR candidates
 -- are covered and their immutable outcomes remain wholly unchanged.
 EXECUTE replace(definition,needle,needle||chr(10)||'  IF gridex_ediel_duplicate_responses.is_duplicate_ack_v1(candidate.id) THEN CONTINUE;END IF;');
 definition:=pg_get_functiondef('gridex_ack_authority.read_outbound_originals_v1(uuid,text)'::regprocedure);
 needle:='ORDER BY m.created_at,m.id LOOP';IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'duplicate_original_reader_shape_changed';END IF;
 EXECUTE replace(definition,needle,needle||chr(10)||'  IF gridex_ediel_duplicate_responses.is_duplicate_ack_v1(ack.id) THEN CONTINUE;END IF;');
END $readers$;
-- Retained ACK relation/outcome columns are read-model caches. Derive the full
-- installed per-original qualifier with a private source binding and local row
-- projection; retain every guide, namespace, wire, receipt and domain predicate.
CREATE FUNCTION gridex_ediel_duplicate_responses.require_business_read_actor_v1(c uuid,actor uuid,phase text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF phase NOT IN('prepare','read') OR phase IS NULL OR c IS NULL OR actor IS NULL
  OR NOT EXISTS(SELECT FROM public.companies WHERE id=c AND status='active' AND is_active)
  OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(actor,c,CASE phase WHEN 'prepare' THEN 'communication.write' ELSE 'communication.read' END) IS NOT TRUE
 THEN RAISE EXCEPTION 'ediel_business_ack_current_actor_required' USING ERRCODE='42501';END IF;
END$$;
CREATE FUNCTION gridex_ediel_duplicate_responses.require_business_binding_v1(c uuid,env text,source_id uuid,ack_id uuid,family text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE basis jsonb;entry jsonb;BEGIN
 basis:=gridex_ack_authority.read_outbound_originals_v1(source_id,family);
 IF basis->>'sourceMessageId' IS DISTINCT FROM source_id::text OR basis->>'companyId' IS DISTINCT FROM c::text OR basis->>'environment' IS DISTINCT FROM env THEN RAISE EXCEPTION 'ediel_business_ack_own_original_required';END IF;
 SELECT x INTO entry FROM jsonb_array_elements(basis->'originals')x WHERE x#>>'{message,id}'=ack_id::text;
 IF entry->>'status' IS DISTINCT FROM 'qualified' THEN RAISE EXCEPTION 'ediel_business_ack_own_original_required';END IF;
END$$;
CREATE FUNCTION gridex_ediel_duplicate_responses.require_business_creation_outcome_v1(c uuid,env text,source_id uuid,ack public.ediel_messages,outcome text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE receipt gridex_ediel_ack_replay.creation_receipts%rowtype;source public.ediel_messages%rowtype;BEGIN
 SELECT * INTO receipt FROM gridex_ediel_ack_replay.creation_receipts WHERE ack_message_id=ack.id FOR SHARE;
 IF receipt.ack_message_id IS NULL THEN RETURN;END IF;
 SELECT * INTO STRICT source FROM public.ediel_messages WHERE id=source_id FOR SHARE;
 IF receipt.company_id IS DISTINCT FROM c OR receipt.environment IS DISTINCT FROM env OR receipt.source_message_id IS DISTINCT FROM source_id
  OR receipt.family IS DISTINCT FROM ack.message_family OR receipt.ack_payload_hash IS DISTINCT FROM encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex')
  OR receipt.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') OR receipt.outcome IS DISTINCT FROM outcome
 THEN RAISE EXCEPTION 'ediel_business_ack_creation_outcome_changed';END IF;
END$$;
DO $business_original$DECLARE definition text;body text;needle text;BEGIN
 definition:=pg_get_functiondef('gridex_ediel_outbound_owner.require_v1(uuid,uuid)'::regprocedure);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_ediel_outbound_owner.require_v1(uuid,uuid)'::regprocedure;
 needle:='PERFORM gridex_ediel_outbound_owner.assert_message_v1(m,w);';
 IF position(needle IN body)=0 OR position('gridex_ediel_outbound_owner.consumptions' IN body)=0 THEN RAISE EXCEPTION 'ediel_business_ack_installed_owner_required';END IF;
 definition:=replace(replace(definition,'gridex_ediel_outbound_owner.require_v1(','gridex_ediel_duplicate_responses.require_business_owner_v1('),'p_message_id uuid)','p_message_id uuid, p_source_id uuid)');
 body:=replace(body,needle,'IF w.related_message_id IS DISTINCT FROM p_source_id THEN RAISE EXCEPTION ''ediel_business_ack_private_relation_changed'';END IF; m.related_message_id:=p_source_id; '||needle);
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid='gridex_ediel_outbound_owner.require_v1(uuid,uuid)'::regprocedure),body);
 definition:=pg_get_functiondef('gridex_ediel_ack_replay.read_exact_v2(uuid,text,uuid,uuid,text,uuid)'::regprocedure);
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_ediel_ack_replay.read_exact_v2(uuid,text,uuid,uuid,text,uuid)'::regprocedure;
 IF position('require_readonly_guide_v2' IN body)=0 OR position('require_readonly_prodat_ledger_v2' IN body)=0 OR position('ediel_ack_replay_physical_source_mismatch' IN body)=0 THEN RAISE EXCEPTION 'ediel_business_ack_installed_full_reader_required';END IF;
 definition:=replace(replace(definition,'gridex_ediel_ack_replay.read_exact_v2(','gridex_ediel_duplicate_responses.read_business_original_v1('),'ack_id uuid)','ack_id uuid, phase text)');
 needle:=$guard$IF public.gridex_actor_has_company_permission(actor,c,'communication.write') IS NOT TRUE
  AND NOT(env='test' AND (family='CONTRL' OR common_source) AND public.gridex_actor_has_company_permission(actor,c,'ediel_testing.write') IS TRUE) THEN$guard$;
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_business_ack_installed_phase_guard_required';END IF;
 body:=replace(body,needle,'IF public.gridex_actor_has_company_permission(actor,c,CASE phase WHEN ''prepare'' THEN ''communication.write'' WHEN ''read'' THEN ''communication.read'' END) IS NOT TRUE THEN');
 body:=replace(body,'AND m.related_message_id=source.id AND m.message_family=family','AND m.message_family=family');
 body:=replace(body,'AND related_message_id=source.id AND message_family=family FOR SHARE;','AND message_family=family FOR SHARE;');
 needle:=' IF NOT EXISTS(SELECT FROM gridex_ediel_wire_namespace.coverage';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_business_ack_installed_wire_guard_required';END IF;
 body:=replace(body,needle,' PERFORM gridex_ediel_duplicate_responses.require_business_binding_v1(c,env,source.id,ack.id,family); ack.related_message_id:=source.id;'||chr(10)||needle);
 body:=replace(body,'gridex_ediel_outbound_owner.require_v1(c,ack.id)','gridex_ediel_duplicate_responses.require_business_owner_v1(c,ack.id,source.id)');
 needle:='IF wire_outcome IS NULL OR ack.ack_outcome IS NOT NULL AND ack.ack_outcome IS DISTINCT FROM wire_outcome THEN';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_business_ack_installed_wire_outcome_required';END IF;
 body:=replace(body,needle,'IF wire_outcome IS NULL THEN');
 needle:=' RETURN jsonb_build_object(''version'',1,''sourceMessage'',to_jsonb(source),''ackMessage''';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'ediel_business_ack_installed_original_return_required';END IF;
 body:=replace(body,needle,' PERFORM gridex_ediel_duplicate_responses.require_business_creation_outcome_v1(c,env,source.id,ack,wire_outcome);'||chr(10)||' PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(c,env,source.id,actor,family,NULL,phase);'||chr(10)||' PERFORM gridex_ediel_duplicate_responses.require_business_read_actor_v1(c,actor,phase);'||chr(10)||needle);
 body:=replace(body,'IF ack_id IS NULL THEN RETURN jsonb_build_object','IF ack_id IS NULL THEN PERFORM gridex_ediel_duplicate_responses.require_business_read_actor_v1(c,actor,phase);RETURN jsonb_build_object');
 body:=replace(body,'IF coalesce(cardinality(ids),0)=0 THEN RETURN NULL;END IF;','IF coalesce(cardinality(ids),0)=0 THEN PERFORM gridex_ediel_duplicate_responses.require_business_read_actor_v1(c,actor,phase);RETURN NULL;END IF;');
 EXECUTE replace(definition,(SELECT prosrc FROM pg_proc WHERE oid='gridex_ediel_ack_replay.read_exact_v2(uuid,text,uuid,uuid,text,uuid)'::regprocedure),body);
END$business_original$;
CREATE FUNCTION public.ediel_list_business_acks_for_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid,p_environment text DEFAULT NULL,p_ack_family text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.ediel_messages%rowtype;m public.ediel_messages%rowtype;family text;source_family text;qualified jsonb;basis jsonb;entry jsonb;items jsonb:='[]';BEGIN
 PERFORM gridex_prodat_object_batch.require_service_v1();PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=p_actor_user_id AND user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=p_company_id AND user_id=p_actor_user_id AND status='active' AND is_active AND accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_business_ack_current_actor_required' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM public.ediel_messages WHERE id=p_source_message_id AND direction='inbound' AND(company_id=p_company_id OR company_id IS NULL) FOR SHARE;
 IF s.id IS NULL OR(p_environment IS NOT NULL AND p_environment IS DISTINCT FROM s.environment) THEN RAISE EXCEPTION 'ediel_business_ack_original_scope_required';END IF;
 source_family:=coalesce(p_ack_family,CASE WHEN s.message_family IN('PRODAT','UTILTS','UTILTS_ERR') THEN 'APERAK' WHEN s.message_family='APERAK' THEN 'CONTRL' END);
 -- Even an empty candidate set requires the actual current private original.
 PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(p_company_id,s.environment,s.id,p_actor_user_id,source_family,NULL,'prepare');
 FOREACH family IN ARRAY CASE WHEN p_ack_family IS NULL THEN ARRAY['CONTRL','APERAK','UTILTS_ERR'] ELSE ARRAY[p_ack_family] END LOOP
  basis:=gridex_ack_authority.read_outbound_originals_v1(s.id,family);
  IF basis->>'sourceMessageId' IS DISTINCT FROM s.id::text OR basis->>'companyId' IS DISTINCT FROM p_company_id::text OR basis->>'environment' IS DISTINCT FROM s.environment THEN RAISE EXCEPTION 'ediel_business_ack_own_original_required';END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(basis->'originals') LOOP
   IF entry->>'status' IS DISTINCT FROM 'qualified' THEN RAISE EXCEPTION 'ediel_business_ack_own_original_required';END IF;
   m:=jsonb_populate_record(NULL::public.ediel_messages,entry->'message');
   qualified:=gridex_ediel_duplicate_responses.read_business_original_v1(p_company_id,s.environment,s.id,p_actor_user_id,family,m.id,'prepare');
   IF qualified#>>'{ackMessage,id}' IS DISTINCT FROM m.id::text THEN RAISE EXCEPTION 'ediel_business_ack_own_original_required';END IF;
   items:=items||jsonb_build_array(qualified->'ackMessage');
  END LOOP;
 END LOOP;
 PERFORM gridex_ediel_duplicate_responses.require_actor_v1(p_company_id,p_actor_user_id,'prepare');
 PERFORM gridex_ediel_duplicate_responses.read_business_original_v1(p_company_id,s.environment,s.id,p_actor_user_id,source_family,NULL,'prepare');
 SELECT coalesce(jsonb_agg(value ORDER BY value->>'created_at' DESC,value->>'id' DESC),'[]') INTO items FROM jsonb_array_elements(items);
 RETURN jsonb_build_object('version',1,'companyId',p_company_id,'sourceMessageId',s.id,'environment',s.environment,'ackFamily',p_ack_family,'messages',items);
END$$;
-- Readonly predicate grants disclose only a boolean for actual public ACK IDs.
-- No private schema/table USAGE/SELECT is granted to view callers.
CREATE FUNCTION public.ediel_is_duplicate_protocol_ack_v1(p_ack_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_ediel_duplicate_responses.is_duplicate_ack_v1(p_ack_id) AND(coalesce(current_setting('role',true),'')='service_role' OR EXISTS(SELECT FROM public.ediel_messages m JOIN public.user_profiles u ON u.id=auth.uid() AND u.user_status='active' JOIN public.company_memberships cm ON cm.company_id=m.company_id AND cm.user_id=u.id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL WHERE m.id=p_ack_id AND(public.gridex_actor_has_company_permission(u.id,m.company_id,'communication.read') IS TRUE OR public.gridex_actor_has_company_permission(u.id,m.company_id,'communication.send') IS TRUE)))$$;
DO $view$ DECLARE definition text;needle text;options text;BEGIN
 SELECT array_to_string(reloptions,',') INTO options FROM pg_class WHERE oid='public.ediel_duplicate_ack_candidates_v'::regclass;
 definition:=pg_get_viewdef('public.ediel_duplicate_ack_candidates_v'::regclass,true);needle:='WHERE';
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'duplicate_candidates_view_shape_changed';END IF;
 -- CREATE OR REPLACE retains columns, security_invoker/options, owner and ACL.
 EXECUTE 'CREATE OR REPLACE VIEW public.ediel_duplicate_ack_candidates_v'||CASE WHEN options IS NULL THEN '' ELSE ' WITH ('||options||')' END||' AS '||regexp_replace(definition,'WHERE','WHERE NOT public.ediel_is_duplicate_protocol_ack_v1(id) AND');
END $view$;
CREATE FUNCTION gridex_ediel_duplicate_responses.require_transport_v1(c uuid,ack_id uuid,actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i gridex_ediel_duplicate_responses.intents%rowtype;r gridex_ediel_inbound_receptions.receptions%rowtype;source jsonb;BEGIN
 SELECT intent.* INTO i FROM gridex_ediel_duplicate_responses.consumptions co JOIN gridex_ediel_duplicate_responses.intents intent ON intent.id=co.intent_id WHERE co.acknowledgement_id=ack_id;
 IF i.id IS NULL THEN RETURN;END IF;
 IF i.company_id IS DISTINCT FROM c THEN RAISE EXCEPTION 'ediel_duplicate_transport_company_changed';END IF;
 SELECT * INTO STRICT r FROM gridex_ediel_inbound_receptions.receptions WHERE id=i.reception_id;
 source:=gridex_ediel_duplicate_responses.source_for_execution_v1(c,i.source_message_id,r.inbound_email_message_id,actor,'send');
 IF source->>'sourceHash' IS DISTINCT FROM i.source_hash OR encode(sha256(convert_to((source->'currentContext')::text,'UTF8')),'hex') IS DISTINCT FROM i.source_role_hash OR gridex_ediel_duplicate_responses.read_result_v1(i) IS NULL THEN RAISE EXCEPTION 'ediel_duplicate_current_capability_changed';END IF;
 PERFORM public.ediel_require_source_bytes_available_v1(c,i.source_message_id);
 IF gridex_ediel_duplicate_responses.source_for_execution_v1(c,i.source_message_id,r.inbound_email_message_id,actor,'send') IS DISTINCT FROM source THEN RAISE EXCEPTION 'ediel_duplicate_current_capability_changed';END IF;
END$$;
-- The established accepted transport journal returns before fresh authority.
-- Fresh paths consume actual private duplicate ACK IDs only. Never send here.
DO $transport$ DECLARE schema_name text;definition text;needle text;BEGIN
 FOREACH schema_name IN ARRAY ARRAY['gridex_ediel_transport','gridex_outbound_dispatch'] LOOP
  definition:=pg_get_functiondef(format('%I.mutate_v1(jsonb)',schema_name)::regprocedure);
  -- Use an internal predecessor without moving the public/current function OID.
  EXECUTE replace(definition,format('%I.mutate_v1(',schema_name),format('%I.mutate_before_duplicate_protocol_v1(',schema_name));
  definition:=format('CREATE OR REPLACE FUNCTION %I.mutate_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$DECLARE r jsonb;BEGIN PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();r:=%I.mutate_before_duplicate_protocol_v1(p_input);IF p_input->>''action'' IN(''prepare'',''enter'') AND r->>''proceed''=''true'' THEN PERFORM gridex_ediel_duplicate_responses.require_transport_v1((p_input->>''companyId'')::uuid,(p_input->>''messageId'')::uuid,(p_input->>''actorUserId'')::uuid);END IF;RETURN r;END$body$',schema_name,schema_name);
  EXECUTE definition;EXECUTE format('REVOKE ALL ON FUNCTION %I.mutate_before_duplicate_protocol_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role',schema_name);
 END LOOP;
END $transport$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_duplicate_responses FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_prepare_duplicate_103_response_v1(uuid,uuid,uuid,uuid,jsonb),public.ediel_commit_duplicate_103_response_v1(uuid,uuid,uuid,uuid,jsonb,jsonb),public.ediel_list_business_acks_for_source_v1(uuid,uuid,uuid,text,text),public.ediel_is_duplicate_protocol_ack_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_prepare_duplicate_103_response_v1(uuid,uuid,uuid,uuid,jsonb),public.ediel_commit_duplicate_103_response_v1(uuid,uuid,uuid,uuid,jsonb,jsonb),public.ediel_list_business_acks_for_source_v1(uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ediel_is_duplicate_protocol_ack_v1(uuid) TO authenticated,service_role;
COMMIT;
