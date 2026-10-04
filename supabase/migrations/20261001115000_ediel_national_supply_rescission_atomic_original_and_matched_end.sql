-- Semantic forward from read-only 100148 reference; derive from installed current owners.
-- CLI forward. National Z08 H is a legal rescission of OWN supply, not the
-- bilateral H start/end profile. No caller approval or incoming receipt is a
-- mandate. Original/witness/current legal source and first INSERT are one TX.
BEGIN;
-- Reuse the canonical own-company grant resolver at execution wall clock.
-- The selected service session never supplies operator or reviewer authority.
CREATE FUNCTION gridex_supply_rescission.execution_actor_active_v1(c uuid,actor uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_supply_rescission.lock_v1();
 RETURN actor IS NOT NULL AND EXISTS(SELECT FROM public.companies WHERE id=c AND status='active' AND is_active)
 AND EXISTS(SELECT FROM auth.users WHERE id=actor AND deleted_at IS NULL AND(banned_until IS NULL OR banned_until<=clock_timestamp()))
 AND EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
 AND EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL);
END$$;
CREATE OR REPLACE FUNCTION gridex_supply_rescission.actor_v1(c uuid,actor uuid,mode text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 RETURN mode IN('archive','read','review') AND gridex_supply_rescission.execution_actor_active_v1(c,actor) IS TRUE
 AND gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(c,actor,CASE mode WHEN 'read' THEN 'communication.read' ELSE 'communication.write' END) IS TRUE
 AND gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(c,actor,'contracts.read') IS TRUE
 AND gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(c,actor,CASE mode WHEN 'read' THEN 'metering.read' ELSE 'metering.write' END) IS TRUE
 AND(mode<>'review' OR gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(c,actor,'ediel.supply_rescission.review') IS TRUE);
END$$;
CREATE FUNCTION gridex_supply_rescission.sender_v1(c uuid,actor uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 RETURN gridex_supply_rescission.execution_actor_active_v1(c,actor) IS TRUE
 AND(gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(c,actor,'communication.send') IS TRUE
 OR gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(c,actor,'ediel.send') IS TRUE);
END$$;
-- Legal issuer/representation/grant expiry must not freeze at transaction start.
DO $clock$DECLARE signature text;definition text;BEGIN
 FOREACH signature IN ARRAY ARRAY['gridex_supply_rescission.scope_v1(uuid,jsonb)','gridex_supply_rescission.receipt_current_v1(gridex_supply_rescission.artifacts)','gridex_supply_rescission.mandate_current_v1(uuid,uuid,boolean)'] LOOP
 definition:=pg_get_functiondef(to_regprocedure(signature));IF definition IS NULL THEN RAISE EXCEPTION 'supply_rescission_actual_clock_owner_required:%',signature;END IF;
 EXECUTE replace(replace(definition,'now()','clock_timestamp()'),'current_date','(clock_timestamp()::date)');
 END LOOP;
END$clock$;
CREATE TABLE gridex_supply_rescission.outbound_operations(
 message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id) DEFERRABLE INITIALLY DEFERRED,
 company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 mandate_id uuid NOT NULL UNIQUE REFERENCES gridex_supply_rescission.mandates(id),payload_hash text NOT NULL,capability jsonb NOT NULL,creation_txid bigint NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_supply_rescission.outbound_receipts(
 message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id) DEFERRABLE INITIALLY DEFERRED,company_id uuid NOT NULL REFERENCES public.companies(id),
 witness_id uuid NOT NULL UNIQUE REFERENCES gridex_ediel_outbound_owner.witnesses(id),payload_hash text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_supply_rescission.end_receipts(
 source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),mandate_id uuid NOT NULL UNIQUE REFERENCES gridex_supply_rescission.mandates(id),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL,
 source_payload_hash text NOT NULL,original_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),original_payload_hash text NOT NULL,period_id uuid NOT NULL REFERENCES public.customer_supply_periods(id),
 source_object jsonb NOT NULL,transition_hash text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(source_message_id,mandate_id));
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['outbound_operations','outbound_receipts','end_receipts'] LOOP
 EXECUTE format('ALTER TABLE gridex_supply_rescission.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_supply_rescission.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_supply_rescission.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gridex_supply_rescission.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_immutable',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gridex_supply_rescission.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_no_truncate',t);
END LOOP;END$$;
CREATE FUNCTION gridex_supply_rescission.lock_original_v1() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_supply_rescission.lock_v1();PERFORM gridex_bilateral_prodat.lock_closure_v1();
 LOCK TABLE gridex_supply_rescission.outbound_operations,gridex_supply_rescission.outbound_receipts,gridex_supply_rescission.end_receipts IN SHARE ROW EXCLUSIVE MODE;
END$$;
CREATE FUNCTION gridex_supply_rescission.outbound_required_v1(raw text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE w jsonb;BEGIN
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(gridex_received_sources.wire_tokens_bounded_v1(raw,10000)) t WHERE t->>'tag'='UNH' AND t#>>'{elements,2,0}'='PRODAT') THEN RETURN false;END IF;
 w:=gridex_bilateral_prodat.draft_wire_v1(raw);RETURN(w->>'code'='Z08' AND EXISTS(SELECT FROM jsonb_array_elements(w->'objects') o WHERE o->>'reason'='Z25')) IS TRUE;
END$$;
-- Own physical NAD projection uses the existing decoded tokenizer. It supplies
-- qualifiers absent from the legacy draft/supply projection; no caller facts.
CREATE FUNCTION gridex_supply_rescission.own_customer_identity_v1(raw text,own jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(raw);lin jsonb;party jsonb;stop int;BEGIN
 IF tokens IS NULL THEN RETURN NULL;END IF;
 IF(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN' AND t#>>'{elements,1,0}'=own->>'line' AND t#>>'{elements,3,0}'=own->>'point')<>1 THEN RETURN NULL;END IF;
 SELECT t INTO lin FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='LIN' AND t#>>'{elements,1,0}'=own->>'line' AND t#>>'{elements,3,0}'=own->>'point';
 SELECT min((t->>'index')::int) INTO stop FROM jsonb_array_elements(tokens)t WHERE(t->>'index')::int>(lin->>'index')::int AND t->>'tag' IN('LIN','UNT','UNH','UNZ');
 IF stop IS NULL OR(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE(t->>'index')::int>(lin->>'index')::int AND(t->>'index')::int<stop AND t->>'tag'='NAD' AND t#>>'{elements,1,0}'='UD')<>1 THEN RETURN NULL;END IF;
 SELECT t#>'{elements,2}' INTO party FROM jsonb_array_elements(tokens)t WHERE(t->>'index')::int>(lin->>'index')::int AND(t->>'index')::int<stop AND t->>'tag'='NAD' AND t#>>'{elements,1,0}'='UD';
 RETURN jsonb_build_object('id',party->>0,'qualifier',party->>1,'agency',party->>2);
END$$;
CREATE FUNCTION gridex_supply_rescission.outbound_source_capability_v1(c uuid,actor uuid,env text,raw text,mandate uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m gridex_supply_rescission.mandates%rowtype;s jsonb;w jsonb;o jsonb;profile uuid;BEGIN
 PERFORM gridex_supply_rescission.lock_original_v1();
 IF actor IS NULL OR env NOT IN('test','production') OR octet_length(raw) NOT BETWEEN 1 AND 8388608 OR(SELECT count(*) FROM jsonb_array_elements(gridex_received_sources.wire_tokens_bounded_v1(raw,10000))t WHERE t->>'tag'='UNH')<>1 OR gridex_supply_rescission.mandate_current_v1(c,mandate,true) IS NOT TRUE THEN RETURN NULL;END IF;
 SELECT * INTO m FROM gridex_supply_rescission.mandates WHERE id=mandate AND company_id=c AND environment=env;s:=m.scope;w:=gridex_bilateral_prodat.draft_wire_v1(raw);o:=w#>'{objects,0}';
 IF m.id IS NULL OR gridex_supply_rescission.outbound_required_v1(raw) IS NOT TRUE OR jsonb_array_length(w->'objects')<>1 OR w->>'bgmId' IS DISTINCT FROM 'H'||replace(m.id::text,'-','')
  OR w->>'sender' IS DISTINCT FROM s->>'legalSenderId' OR w->>'receiver' IS DISTINCT FROM s->>'legalReceiverId'
  OR o->>'li' IS DISTINCT FROM 'H'||replace(m.id::text,'-','') OR o->>'point' IS DISTINCT FROM s->>'externalPoint' OR o->>'reason' IS DISTINCT FROM 'Z25'
  OR (SELECT t#>>'{elements,3,3}' FROM jsonb_array_elements(gridex_received_sources.wire_tokens_bounded_v1(raw,10000)) t WHERE t->>'tag'='LIN') IS DISTINCT FROM s->>'identityAgency'
  OR o->>'gridArea' IS DISTINCT FROM s->>'gridArea' OR o->>'customerIdentity' IS DISTINCT FROM s#>>'{customerIdentity,id}'
  OR gridex_supply_rescission.own_customer_identity_v1(raw,o) IS DISTINCT FROM s->'customerIdentity'
  OR gridex_received_sources.permission_time_v1(o->>'end') IS DISTINCT FROM(s->>'effectiveAt')::timestamptz THEN RETURN NULL;END IF;
 SELECT(p->>'id')::uuid INTO profile FROM jsonb_array_elements(s#>'{sourceGrammar,profiles}') p WHERE p->>'profile_key'='PRODAT:Z08:H:26.A:r3' AND p->>'direction' IN('outbound','both');IF profile IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('version',1,'owner','immutable-national-supply-rescission-original-v1','companyId',c,'environment',env,'actorUserId',actor,'mandateId',m.id,'payloadHash',encode(sha256(convert_to(raw,'UTF8')),'hex'),'messageCode','Z08','objects',jsonb_build_array(jsonb_build_object('process','national_supply_rescission','mandateId',m.id,'objectId',s->>'externalPoint','identityAgency',s->>'identityAgency','lineItemReference',o->>'li','firstLineIndex',gridex_bilateral_prodat.first_line_index_v1(raw,o||jsonb_build_object('identityAgency',s->>'identityAgency')),'sourceHash',m.source_hash,'sourceGrammarHash',s->>'sourceGrammarHash','rulePackId',s->>'rulePackId','messageProfileId',profile,'pointId',s->>'pointId','customerId',s->>'customerId','siteId',s->>'siteId','contractId',s->>'contractId','contractHash',s->>'contractHash','eventAt',s->>'effectiveAt','supplyPeriodId',s->>'periodId','marketStateVersion',s->>'stateVersion')));
END$$;
-- Capability actor remains the immutable renderer provenance. Only this actual
-- producer wrapper authorizes creation; source consumers have their own current
-- execution actor and never inherit the historic renderer's ordinary grants.
CREATE FUNCTION gridex_supply_rescission.outbound_capability_v1(c uuid,actor uuid,env text,raw text,mandate uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE cap jsonb;BEGIN
 IF gridex_supply_rescission.actor_v1(c,actor,'archive') IS NOT TRUE THEN RETURN NULL;END IF;
 cap:=gridex_supply_rescission.outbound_source_capability_v1(c,actor,env,raw,mandate);
 IF gridex_supply_rescission.actor_v1(c,actor,'archive') IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_terminal_producer_forbidden' USING ERRCODE='42501';END IF;RETURN cap;
END$$;
CREATE FUNCTION gridex_supply_rescission.require_recorded_outbound_source_current_v1(m public.ediel_messages) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_supply_rescission.outbound_operations%rowtype;r gridex_supply_rescission.outbound_receipts%rowtype;mandate gridex_supply_rescission.mandates%rowtype;BEGIN
 PERFORM gridex_supply_rescission.lock_original_v1();PERFORM public.ediel_require_source_bytes_available_v1(m.company_id,m.id);
 SELECT * INTO o FROM gridex_supply_rescission.outbound_operations WHERE message_id=m.id AND company_id=m.company_id;SELECT * INTO r FROM gridex_supply_rescission.outbound_receipts WHERE message_id=m.id AND company_id=m.company_id;
 SELECT * INTO mandate FROM gridex_supply_rescission.mandates WHERE id=o.mandate_id AND company_id=m.company_id;
 IF o.message_id IS NULL OR r.message_id IS NULL OR m.raw_payload IS NULL OR m.source_operation_id IS DISTINCT FROM o.mandate_id::text OR m.environment IS DISTINCT FROM o.environment OR m.created_by IS DISTINCT FROM o.actor_user_id
  OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR m.immutable_payload_hash IS DISTINCT FROM o.payload_hash OR r.payload_hash IS DISTINCT FROM o.payload_hash OR r.witness_id::text IS DISTINCT FROM m.execution_context_snapshot->>'outboundOwnerWitnessId'
  OR gridex_supply_rescission.mandate_current_v1(m.company_id,o.mandate_id,false) IS NOT TRUE OR o.capability#>>'{objects,0,sourceHash}' IS DISTINCT FROM mandate.source_hash OR o.capability#>>'{objects,0,sourceGrammarHash}' IS DISTINCT FROM mandate.scope->>'sourceGrammarHash'
  OR NOT EXISTS(SELECT FROM gridex_ediel_outbound_owner.consumptions used JOIN gridex_ediel_outbound_owner.witnesses witness ON witness.id=used.witness_id WHERE used.source_message_id=m.id AND used.company_id=m.company_id AND used.environment=m.environment AND used.payload_sha256=o.payload_hash AND witness.id=r.witness_id AND witness.payload_sha256=o.payload_hash AND witness.actor_user_id=o.actor_user_id)
  OR NOT EXISTS(SELECT FROM gridex_ediel_source_rules.receipts source WHERE source.source_message_id=m.id AND source.company_id=m.company_id AND source.environment=m.environment AND source.direction='outbound' AND source.payload_sha256=o.payload_hash) THEN RAISE EXCEPTION 'supply_rescission_recorded_original_required';END IF;
END$$;
CREATE FUNCTION gridex_supply_rescission.require_recorded_outbound_v1(m public.ediel_messages,actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF gridex_supply_rescission.actor_v1(m.company_id,actor,'read') IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_recorded_actor_forbidden' USING ERRCODE='42501';END IF;
 PERFORM gridex_supply_rescission.require_recorded_outbound_source_current_v1(m);
 IF gridex_supply_rescission.actor_v1(m.company_id,actor,'read') IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_terminal_reader_forbidden' USING ERRCODE='42501';END IF;
END$$;
CREATE FUNCTION gridex_supply_rescission.require_original_v1(m public.ediel_messages,creating boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_supply_rescission.outbound_operations%rowtype;r gridex_supply_rescission.outbound_receipts%rowtype;cap jsonb;BEGIN
 IF m.direction IS DISTINCT FROM 'outbound' OR gridex_supply_rescission.outbound_required_v1(m.raw_payload) IS NOT TRUE THEN RETURN;END IF;
 PERFORM gridex_supply_rescission.lock_original_v1();SELECT * INTO o FROM gridex_supply_rescission.outbound_operations WHERE message_id=m.id AND company_id=m.company_id;SELECT * INTO r FROM gridex_supply_rescission.outbound_receipts WHERE message_id=m.id AND company_id=m.company_id;
 IF o.message_id IS NULL OR r.message_id IS NULL OR m.source_operation_id IS DISTINCT FROM o.mandate_id::text OR m.created_by IS DISTINCT FROM o.actor_user_id OR m.environment IS DISTINCT FROM o.environment OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR r.payload_hash IS DISTINCT FROM o.payload_hash OR r.witness_id::text IS DISTINCT FROM m.execution_context_snapshot->>'outboundOwnerWitnessId'
  OR creating AND o.creation_txid IS DISTINCT FROM txid_current() OR NOT EXISTS(SELECT FROM gridex_ediel_outbound_owner.witnesses witness WHERE witness.id=r.witness_id AND witness.company_id=m.company_id AND witness.actor_user_id=o.actor_user_id AND witness.environment=o.environment AND witness.payload_sha256=o.payload_hash) THEN RAISE EXCEPTION 'supply_rescission_atomic_original_required';END IF;
 cap:=gridex_supply_rescission.outbound_source_capability_v1(m.company_id,o.actor_user_id,m.environment,m.raw_payload,o.mandate_id);IF cap IS NULL OR cap IS DISTINCT FROM o.capability THEN RAISE EXCEPTION 'supply_rescission_current_mandate_required';END IF;
END$$;
CREATE FUNCTION gridex_supply_rescission.guard_original_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN PERFORM gridex_supply_rescission.require_original_v1(NEW,TG_OP='INSERT');RETURN NEW;END$$;
CREATE TRIGGER ediel_national_supply_rescission_original BEFORE INSERT OR UPDATE OF raw_payload ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_supply_rescission.guard_original_v1();
CREATE FUNCTION gridex_supply_rescission.require_draft_v1(c uuid,actor uuid,d jsonb,cap jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s jsonb;i public.ediel_message_intents%rowtype;r public.outbound_requests%rowtype;BEGIN
 s:=public.ediel_read_supply_rescission_mandate_v1(c,actor,(d->>'sourceOperationId')::uuid);
 IF s IS NULL OR cap->>'mandateId' IS DISTINCT FROM s->>'mandateId' OR d->>'customerId' IS DISTINCT FROM s->>'customerId' OR d->>'siteId' IS DISTINCT FROM s->>'siteId' OR d->>'meteringPointId' IS DISTINCT FROM s->>'pointId' OR nullif(d->>'switchRequestId','') IS NOT NULL THEN RAISE EXCEPTION 'supply_rescission_actual_mandate_required';END IF;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=(d->>'intentId')::uuid AND company_id=c FOR UPDATE;SELECT * INTO r FROM public.outbound_requests WHERE id=(d->>'outboundRequestId')::uuid AND company_id=c FOR SHARE;
 IF i.id IS NULL OR i.ediel_message_id IS NOT NULL OR i.created_by IS DISTINCT FROM actor OR i.environment IS DISTINCT FROM s->>'environment' OR i.direction IS DISTINCT FROM 'outbound' OR i.message_family IS DISTINCT FROM 'PRODAT' OR i.message_code IS DISTINCT FROM 'Z08' OR i.operation_id::text IS DISTINCT FROM s->>'mandateId' OR i.payload->>'transactionSubtype' IS DISTINCT FROM 'H'
  OR i.customer_id::text IS DISTINCT FROM s->>'customerId' OR i.customer_site_id::text IS DISTINCT FROM s->>'siteId' OR i.metering_point_id IS DISTINCT FROM s->>'pointId' OR i.transaction_reference IS DISTINCT FROM s->>'lineItemReference'
  OR r.id IS NULL OR r.request_type IS DISTINCT FROM 'supplier_switch_cancellation' OR r.source_type IS DISTINCT FROM 'manual' OR r.source_id IS DISTINCT FROM i.id OR r.operation_id IS DISTINCT FROM i.operation_id OR r.customer_id IS DISTINCT FROM i.customer_id OR r.site_id IS DISTINCT FROM i.customer_site_id OR r.metering_point_id::text IS DISTINCT FROM s->>'pointId' OR r.payload->>'environment' IS DISTINCT FROM s->>'environment' THEN RAISE EXCEPTION 'supply_rescission_validated_own_intent_request_required';END IF;
END$$;
ALTER FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb) RENAME TO prepare_before_national_rescission_v1;
CREATE FUNCTION gridex_ediel_outbound_owner.prepare_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_supply_rescission.outbound_operations%rowtype;own jsonb;BEGIN
 IF gridex_supply_rescission.outbound_required_v1(p_input->>'rawPayload') IS TRUE THEN
  PERFORM gridex_supply_rescission.lock_original_v1();SELECT * INTO o FROM gridex_supply_rescission.outbound_operations WHERE message_id=(p_input->>'nationalOriginalMessageId')::uuid AND company_id=(p_input->>'companyId')::uuid;
  IF o.message_id IS NULL OR o.creation_txid IS DISTINCT FROM txid_current() OR o.actor_user_id::text IS DISTINCT FROM p_input->>'actorUserId' OR o.environment IS DISTINCT FROM p_input->>'environment' OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(p_input->>'rawPayload','UTF8')),'hex') OR o.capability IS DISTINCT FROM gridex_supply_rescission.outbound_capability_v1(o.company_id,o.actor_user_id,o.environment,p_input->>'rawPayload',o.mandate_id) THEN RAISE EXCEPTION 'supply_rescission_atomic_original_required';END IF;
  own:=o.capability#>'{objects,0}';IF own->>'rulePackId' IS DISTINCT FROM p_input#>>'{rulePackEvidence,rulePackId}' OR own->>'messageProfileId' IS DISTINCT FROM p_input#>>'{rulePackEvidence,messageProfileId}' THEN RAISE EXCEPTION 'supply_rescission_actual_selected_source_grammar_required';END IF;
 END IF;RETURN gridex_ediel_outbound_owner.prepare_before_national_rescission_v1(p_input);
END$$;
-- Clone the complete installed atomic owner into a separately named national
-- owner. Assert exact anchors. Preserve the predecessor OID, owner, ACL/path.
DO $atomic$ DECLARE d text;b text;BEGIN
 d:=pg_get_functiondef('public.ediel_create_bilateral_prodat_original_v1(uuid,uuid,jsonb)'::regprocedure);SELECT prosrc INTO STRICT b FROM pg_proc WHERE oid='public.ediel_create_bilateral_prodat_original_v1(uuid,uuid,jsonb)'::regprocedure;
 IF position('require_closure_draft_v1' IN b)=0 OR position('INSERT INTO public.ediel_messages(id,company_id' IN b)=0 OR position('ediel_bind_switch_original_v1' IN b)=0 OR position('outboundOwnerWitnessId' IN b)=0 THEN RAISE EXCEPTION 'supply_rescission_installed_atomic_owner_contract_changed';END IF;
 b:=replace(b,'gridex_bilateral_prodat.lock_outbound_v1()','gridex_supply_rescission.lock_original_v1()');
 b:=replace(b,' IF FOUND THEN',E' IF FOUND THEN\n  IF gridex_supply_rescission.actor_v1(p_company_id,p_actor_user_id,''archive'') IS NOT TRUE THEN RAISE EXCEPTION ''supply_rescission_replay_actor_forbidden'' USING ERRCODE=''42501'';END IF;');
 b:=replace(b,'p_draft->>''messageCode'' NOT IN(''Z03'',''Z08'')','p_draft->>''messageCode'' IS DISTINCT FROM ''Z08''');
 b:=replace(b,'gridex_bilateral_prodat.outbound_capability_v1(p_company_id,p_actor_user_id,env,raw)','gridex_supply_rescission.outbound_capability_v1(p_company_id,p_actor_user_id,env,raw,(p_draft->>''sourceOperationId'')::uuid)');
 b:=replace(b,'gridex_bilateral_prodat.require_closure_draft_v1','gridex_supply_rescission.require_draft_v1');
 b:=replace(b,'gridex_bilateral_prodat.require_recorded_outbound_v1(m,p_actor_user_id)','gridex_supply_rescission.require_recorded_outbound_source_current_v1(m)');
 b:=replace(b,'RETURN jsonb_build_object(''version'',1,''message'',to_jsonb(m),''replayed'',true)','IF gridex_supply_rescission.actor_v1(p_company_id,p_actor_user_id,''archive'') IS NOT TRUE THEN RAISE EXCEPTION ''supply_rescission_terminal_replay_producer_forbidden'' USING ERRCODE=''42501'';END IF;RETURN jsonb_build_object(''version'',1,''message'',to_jsonb(m),''replayed'',true)');
 b:=replace(b,'gridex_bilateral_prodat.require_outbound_original_v1','gridex_supply_rescission.require_original_v1');
 b:=replace(b,'RETURN jsonb_build_object(''version'',1,''message'',to_jsonb(m),''replayed'',false)','IF gridex_supply_rescission.actor_v1(p_company_id,p_actor_user_id,''archive'') IS NOT TRUE THEN RAISE EXCEPTION ''supply_rescission_terminal_producer_forbidden'' USING ERRCODE=''42501'';END IF;RETURN jsonb_build_object(''version'',1,''message'',to_jsonb(m),''replayed'',false)');
 b:=replace(b,'gridex_bilateral_prodat.outbound_operations(message_id,company_id,environment,actor_user_id,payload_hash,capability,creation_txid) VALUES(mid,p_company_id,env,p_actor_user_id,cap->>''payloadHash'',cap,txid_current())','gridex_supply_rescission.outbound_operations(message_id,company_id,environment,actor_user_id,mandate_id,payload_hash,capability,creation_txid) VALUES(mid,p_company_id,env,p_actor_user_id,(p_draft->>''sourceOperationId'')::uuid,cap->>''payloadHash'',cap,txid_current())');
 b:=replace(b,'gridex_bilateral_prodat.outbound_receipts','gridex_supply_rescission.outbound_receipts');b:=replace(b,'''bilateralOriginalMessageId''','''nationalOriginalMessageId''');b:=replace(b,'bilateral_prodat_outbound','national_supply_rescission');b:=replace(b,'ediel.bilateral_profile.original_registered','ediel.supply_rescission.original_registered');b:=replace(b,'Bilateral PRODAT original created','National legal supply rescission original created');
 d:=replace(d,'CREATE OR REPLACE FUNCTION public.ediel_create_bilateral_prodat_original_v1(','CREATE OR REPLACE FUNCTION public.ediel_create_national_supply_rescission_original_v1(');EXECUTE replace(d,(SELECT prosrc FROM pg_proc WHERE oid='public.ediel_create_bilateral_prodat_original_v1(uuid,uuid,jsonb)'::regprocedure),b);
END $atomic$;
CREATE FUNCTION public.ediel_qualify_supply_rescission_draft_v1(p_company_id uuid,p_actor_user_id uuid,p_environment text,p_raw_payload text,p_mandate_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 RETURN gridex_supply_rescission.outbound_capability_v1(p_company_id,p_actor_user_id,p_environment,p_raw_payload,p_mandate_id);
END$$;
CREATE FUNCTION public.ediel_read_supply_rescission_original_v1(p_company_id uuid,p_actor_user_id uuid,p_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE m public.ediel_messages%rowtype;cap jsonb;BEGIN
 IF gridex_supply_rescission.actor_v1(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_recorded_actor_forbidden' USING ERRCODE='42501';END IF;
 PERFORM gridex_supply_rescission.lock_original_v1();SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id;IF m.id IS NULL THEN IF gridex_supply_rescission.actor_v1(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_terminal_reader_forbidden' USING ERRCODE='42501';END IF;RETURN NULL;END IF;
 PERFORM gridex_supply_rescission.require_recorded_outbound_v1(m,p_actor_user_id);SELECT capability INTO cap FROM gridex_supply_rescission.outbound_operations WHERE company_id=p_company_id AND message_id=m.id;IF gridex_supply_rescission.actor_v1(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_terminal_reader_forbidden' USING ERRCODE='42501';END IF;RETURN cap||jsonb_build_object('originalActorUserId',cap->>'actorUserId','actorUserId',p_actor_user_id);
END$$;
-- Immutable accepted transport replay is decided by the predecessor first.
-- A fresh prepare/enter rechecks current mandate, cutoff and exact original;
-- all predecessor writes roll back if this guard rejects.
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_national_rescission_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r jsonb;m public.ediel_messages%rowtype;BEGIN
 IF p_input->>'action' IN('prepare','enter') THEN PERFORM gridex_supply_rescission.lock_original_v1();END IF;r:=gridex_ediel_transport.mutate_before_national_rescission_v1(p_input);
 IF p_input->>'action' IN('prepare','enter') AND r->>'proceed'='true' THEN SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid AND company_id=(p_input->>'companyId')::uuid FOR SHARE;
  IF gridex_supply_rescission.outbound_required_v1(m.raw_payload) IS TRUE THEN
   IF gridex_supply_rescission.sender_v1(m.company_id,(p_input->>'actorUserId')::uuid) IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_transport_executor_forbidden' USING ERRCODE='42501';END IF;
   PERFORM gridex_supply_rescission.require_original_v1(m,false);
   IF gridex_supply_rescission.sender_v1(m.company_id,(p_input->>'actorUserId')::uuid) IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_terminal_transport_executor_forbidden' USING ERRCODE='42501';END IF;
  END IF;END IF;RETURN r;
END$$;
ALTER FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RENAME TO mutate_before_national_rescission_v1;
CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r jsonb;m public.ediel_messages%rowtype;BEGIN
 IF p_input->>'action' IN('prepare','enter') THEN PERFORM gridex_supply_rescission.lock_original_v1();END IF;r:=gridex_outbound_dispatch.mutate_before_national_rescission_v1(p_input);
 IF p_input->>'action' IN('prepare','enter') AND r->>'proceed'='true' THEN SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid AND company_id=(p_input->>'companyId')::uuid FOR SHARE;
  IF gridex_supply_rescission.outbound_required_v1(m.raw_payload) IS TRUE THEN
   IF gridex_supply_rescission.sender_v1(m.company_id,(p_input->>'actorUserId')::uuid) IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_transport_executor_forbidden' USING ERRCODE='42501';END IF;
   PERFORM gridex_supply_rescission.require_original_v1(m,false);
   IF gridex_supply_rescission.sender_v1(m.company_id,(p_input->>'actorUserId')::uuid) IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_terminal_transport_executor_forbidden' USING ERRCODE='42501';END IF;
  END IF;END IF;RETURN r;
END$$;
CREATE FUNCTION gridex_supply_rescission.has_end_selector_v1(m public.ediel_messages,own jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT own->>'reason'='Z22' AND EXISTS(SELECT FROM gridex_supply_rescission.mandates legal WHERE legal.company_id=m.company_id AND legal.environment=m.environment AND 'H'||replace(legal.id::text,'-','')=own->>'li' AND legal.scope->>'externalPoint'=own->>'point' AND legal.scope->>'identityAgency'=own->>'identityAgency');$$;
CREATE FUNCTION gridex_supply_rescission.matched_end_v1(m public.ediel_messages,w jsonb,own jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE ids uuid[];z public.ediel_messages%rowtype;o gridex_supply_rescission.outbound_operations%rowtype;legal gridex_supply_rescission.mandates%rowtype;ow jsonb;p public.customer_supply_periods%rowtype;BEGIN
 IF w IS DISTINCT FROM gridex_received_sources.normal_switch_wire_v1(m.raw_payload) OR w->>'code' IS DISTINCT FROM 'Z05' OR gridex_supply_rescission.has_end_selector_v1(m,own) IS NOT TRUE OR (SELECT count(*) FROM jsonb_array_elements(w->'objects') actual WHERE actual=own)<>1 THEN RETURN NULL;END IF;
 SELECT array_agg(candidate.id ORDER BY candidate.id) INTO ids FROM public.ediel_messages candidate JOIN gridex_supply_rescission.outbound_operations op ON op.company_id=candidate.company_id AND op.message_id=candidate.id
 WHERE candidate.company_id=m.company_id AND candidate.environment=m.environment AND candidate.direction='outbound' AND candidate.message_family='PRODAT' AND candidate.message_code='Z08' AND gridex_received_sources.sent_source_is_current_v1(candidate) AND op.capability#>>'{objects,0,lineItemReference}'=own->>'li' AND op.capability#>>'{objects,0,objectId}'=own->>'point' AND op.capability#>>'{objects,0,identityAgency}'=own->>'identityAgency';
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;SELECT * INTO z FROM public.ediel_messages WHERE id=ids[1] AND company_id=m.company_id FOR SHARE;SELECT * INTO o FROM gridex_supply_rescission.outbound_operations WHERE message_id=z.id AND company_id=m.company_id;SELECT * INTO legal FROM gridex_supply_rescission.mandates WHERE id=o.mandate_id AND company_id=m.company_id;
 PERFORM gridex_supply_rescission.require_recorded_outbound_source_current_v1(z);ow:=gridex_bilateral_prodat.draft_wire_v1(z.raw_payload);SELECT * INTO p FROM public.customer_supply_periods WHERE id=(legal.scope->>'periodId')::uuid AND company_id=m.company_id;
 IF p.id IS NULL OR p.source_end_message_id IS NOT NULL OR p.market_end_at IS NOT NULL OR p.market_state_version IS DISTINCT FROM(legal.scope->>'stateVersion')::bigint OR p.customer_id::text IS DISTINCT FROM legal.scope->>'customerId' OR p.metering_point_id::text IS DISTINCT FROM legal.scope->>'pointId'
  OR ow->>'sender' IS DISTINCT FROM w->>'receiver' OR ow->>'receiver' IS DISTINCT FROM w->>'sender' OR jsonb_array_length(ow->'objects')<>1 OR ow#>>'{objects,0,reason}' IS DISTINCT FROM 'Z25' OR ow#>>'{objects,0,li}' IS DISTINCT FROM own->>'li' OR ow#>>'{objects,0,point}' IS DISTINCT FROM own->>'point'
  OR own->>'customerIdentity' IS DISTINCT FROM legal.scope#>>'{customerIdentity,id}' OR gridex_supply_rescission.own_customer_identity_v1(m.raw_payload,own) IS DISTINCT FROM legal.scope->'customerIdentity' OR own->>'gridArea' IS DISTINCT FROM legal.scope->>'gridArea'
  OR gridex_received_sources.permission_time_v1(own->>'end') IS DISTINCT FROM(legal.scope->>'effectiveAt')::timestamptz OR gridex_received_sources.permission_time_v1(ow#>>'{objects,0,end}') IS DISTINCT FROM(legal.scope->>'effectiveAt')::timestamptz THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('mandateId',legal.id,'originalMessageId',z.id,'originalPayloadHash',z.immutable_payload_hash,'periodId',p.id);
END$$;
CREATE FUNCTION gridex_supply_rescission.require_matched_end_v1(m public.ediel_messages,w jsonb,own jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF gridex_supply_rescission.matched_end_v1(m,w,own) IS NULL THEN RAISE EXCEPTION 'supply_rescission_exact_sent_original_required';END IF;
END$$;
DO $end$ DECLARE d text;needle text;BEGIN
 d:=pg_get_functiondef('gridex_bilateral_prodat.confirm_closure_end_v1(uuid,uuid,uuid)'::regprocedure);needle:='   IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object(''applied'',false,''reason'',''z05_accepted_relationship_baseline_required'');END IF;';
 IF position(needle IN d)=0 OR position('require_matched_closure_v1' IN d)=0 OR position('regulated_supply_authentic_ground_required' IN d)=0 OR position('INSERT INTO gridex_received_sources.supply_source_transitions' IN d)=0 THEN RAISE EXCEPTION 'supply_rescission_full_national_end_owner_contract_changed';END IF;
 d:=replace(d,'CREATE OR REPLACE FUNCTION gridex_bilateral_prodat.confirm_closure_end_v1(','CREATE OR REPLACE FUNCTION gridex_supply_rescission.confirm_end_v1(');
 d:=replace(d,needle,E'   IF gridex_supply_rescission.has_end_selector_v1(m,own) IS TRUE THEN PERFORM gridex_supply_rescission.require_matched_end_v1(m,wire,own);ids:=ARRAY[(gridex_supply_rescission.matched_end_v1(m,wire,own)->>''periodId'')::uuid];END IF;\n'||needle);
 d:=replace(d,E'BEGIN\n',E'BEGIN\n PERFORM gridex_supply_rescission.lock_original_v1();\n');EXECUTE d;
END $end$;
CREATE FUNCTION gridex_supply_rescission.recorded_end_current_v1(c uuid,s uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE m public.ediel_messages%rowtype;t gridex_received_sources.supply_source_transitions%rowtype;r gridex_supply_rescission.end_receipts%rowtype;z public.ediel_messages%rowtype;n int;BEGIN
 PERFORM gridex_supply_rescission.lock_original_v1();SELECT * INTO m FROM public.ediel_messages WHERE id=s AND company_id=c;SELECT * INTO t FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=s AND company_id=c;
 IF m.id IS NULL OR t.source_message_id IS NULL OR m.raw_payload IS NULL OR t.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RETURN false;END IF;PERFORM public.ediel_require_source_bytes_available_v1(c,s);
 SELECT count(*) INTO n FROM jsonb_array_elements(t.source_objects) own WHERE gridex_supply_rescission.has_end_selector_v1(m,own);IF n=0 THEN RETURN NOT EXISTS(SELECT FROM gridex_supply_rescission.end_receipts WHERE company_id=c AND source_message_id=s);END IF;
 IF n<>(SELECT count(*) FROM gridex_supply_rescission.end_receipts WHERE company_id=c AND source_message_id=s) THEN RETURN false;END IF;
 FOR r IN SELECT receipt.* FROM gridex_supply_rescission.end_receipts receipt WHERE receipt.company_id=c AND receipt.source_message_id=s LOOP
  IF r.environment IS DISTINCT FROM m.environment OR r.source_payload_hash IS DISTINCT FROM t.payload_hash OR r.transition_hash IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') OR gridex_supply_rescission.mandate_current_v1(c,r.mandate_id,false) IS NOT TRUE OR NOT EXISTS(SELECT FROM jsonb_array_elements(t.source_objects) own WHERE own=r.source_object) OR NOT EXISTS(SELECT FROM jsonb_array_elements(t.resulting_states) state WHERE state->>'id'=r.period_id::text AND state->>'source_end_message_id'=s::text AND(state->>'market_end_at')::timestamptz=gridex_received_sources.permission_time_v1(r.source_object->>'end')) THEN RETURN false;END IF;
  SELECT * INTO z FROM public.ediel_messages WHERE id=r.original_message_id AND company_id=c AND environment=m.environment;IF z.id IS NULL OR z.immutable_payload_hash IS DISTINCT FROM r.original_payload_hash OR gridex_received_sources.sent_source_is_current_v1(z) IS NOT TRUE THEN RETURN false;END IF;PERFORM gridex_supply_rescission.require_recorded_outbound_source_current_v1(z);
 END LOOP;RETURN true;
END$$;
CREATE FUNCTION gridex_supply_rescission.record_end_v1(m public.ediel_messages,plans jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE t gridex_received_sources.supply_source_transitions%rowtype;plan jsonb;b jsonb;own jsonb;BEGIN
 SELECT * INTO STRICT t FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id AND company_id=m.company_id;
 FOR plan IN SELECT p FROM jsonb_array_elements(plans)p LOOP b:=plan->'binding';own:=plan->'object';
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(t.resulting_states) state WHERE state->>'id'=b->>'periodId' AND state->>'source_end_message_id'=m.id::text AND(state->>'market_end_at')::timestamptz=gridex_received_sources.permission_time_v1(own->>'end')) THEN RAISE EXCEPTION 'supply_rescission_actual_owned_end_required';END IF;
  INSERT INTO gridex_supply_rescission.end_receipts(source_message_id,mandate_id,company_id,environment,source_payload_hash,original_message_id,original_payload_hash,period_id,source_object,transition_hash) VALUES(m.id,(b->>'mandateId')::uuid,m.company_id,m.environment,t.payload_hash,(b->>'originalMessageId')::uuid,b->>'originalPayloadHash',(b->>'periodId')::uuid,own,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'));
 END LOOP;IF gridex_supply_rescission.recorded_end_current_v1(m.company_id,m.id) IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_recorded_current_source_required';END IF;
 INSERT INTO public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,details) VALUES(m.company_id,t.actor_user_id,'ediel.supply_rescission.end_applied','ediel_message',m.id,jsonb_build_object('sourcePayloadHash',t.payload_hash,'ownedOriginals',plans,'resultingStates',t.resulting_states));
END$$;
ALTER FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) SET SCHEMA gridex_supply_rescission;
ALTER FUNCTION gridex_supply_rescission.ediel_apply_supply_source_v1(uuid,uuid,uuid) RENAME TO apply_supply_before_rescission_v1;
REVOKE ALL ON FUNCTION gridex_supply_rescission.apply_supply_before_rescission_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_apply_supply_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE m public.ediel_messages%rowtype;w jsonb;own jsonb;b jsonb;plans jsonb:='[]';r jsonb;prior boolean;BEGIN
 PERFORM gridex_supply_rescission.lock_original_v1();SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;IF m.id IS NOT NULL THEN PERFORM public.ediel_require_source_bytes_available_v1(m.company_id,m.id);END IF;w:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);
 IF m.direction='inbound' AND m.message_family='PRODAT' AND w->>'code'='Z05' AND EXISTS(SELECT FROM jsonb_array_elements(w->'objects') o WHERE gridex_supply_rescission.has_end_selector_v1(m,o)) THEN
  IF gridex_supply_rescission.actor_v1(p_company_id,p_actor_user_id,'archive') IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_execution_actor_forbidden' USING ERRCODE='42501';END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(w->'objects') o WHERE(o->>'reason' IN('Z22','Z23','Z25')) IS NOT TRUE) THEN RETURN jsonb_build_object('applied',false,'reason','supply_rescission_whole_known_scope_required');END IF;
  prior:=EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id AND company_id=m.company_id);
  IF prior THEN IF gridex_supply_rescission.recorded_end_current_v1(m.company_id,m.id) IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_recorded_current_source_required';END IF;
  ELSE FOR own IN SELECT o FROM jsonb_array_elements(w->'objects') o WHERE gridex_supply_rescission.has_end_selector_v1(m,o) LOOP b:=gridex_supply_rescission.matched_end_v1(m,w,own);IF b IS NULL THEN RAISE EXCEPTION 'supply_rescission_exact_sent_original_required';END IF;plans:=plans||jsonb_build_array(jsonb_build_object('object',own,'binding',b));END LOOP;END IF;
  r:=gridex_supply_rescission.confirm_end_v1(p_company_id,p_source_message_id,p_actor_user_id);IF r->>'applied'='true' AND NOT prior THEN PERFORM gridex_supply_rescission.record_end_v1(m,plans);END IF;
  IF gridex_supply_rescission.actor_v1(p_company_id,p_actor_user_id,'archive') IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_post_write_actor_forbidden' USING ERRCODE='42501';END IF;
  IF r->>'applied'='true' AND gridex_supply_rescission.recorded_end_current_v1(m.company_id,m.id) IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_post_write_current_source_required';END IF;
  IF gridex_supply_rescission.actor_v1(p_company_id,p_actor_user_id,'archive') IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_terminal_execution_actor_forbidden' USING ERRCODE='42501';END IF;RETURN r;
 END IF;RETURN gridex_supply_rescission.apply_supply_before_rescission_v1(p_company_id,p_source_message_id,p_actor_user_id);
END$$;
-- Later supply/billing readers retain every existing ordinary/P12/H/LK gate.
DO $current$ DECLARE d text;b text;BEGIN
 d:=pg_get_functiondef('gridex_bilateral_prodat.recorded_supply_current_v1(uuid,uuid)'::regprocedure);SELECT prosrc INTO STRICT b FROM pg_proc WHERE oid='gridex_bilateral_prodat.recorded_supply_current_v1(uuid,uuid)'::regprocedure;
 IF position('recorded_closure_end_current_v1' IN b)=0 OR position('t.payload_hash' IN b)=0 THEN RAISE EXCEPTION 'supply_rescission_recorded_supply_contract_changed';END IF;
 b:=replace(b,' IF r.source_message_id IS NULL THEN',E' IF gridex_supply_rescission.recorded_end_current_v1(c,s) IS NOT TRUE THEN RETURN false;END IF;\n IF r.source_message_id IS NULL THEN');EXECUTE replace(d,(SELECT prosrc FROM pg_proc WHERE oid='gridex_bilateral_prodat.recorded_supply_current_v1(uuid,uuid)'::regprocedure),b);
END $current$;
-- Execution rechecks after the last potentially blocking native write.
DO $intake$DECLARE definition text;body text;anchor text;BEGIN
 definition:=pg_get_functiondef('public.ediel_archive_supply_rescission_v1(uuid,uuid,jsonb)'::regprocedure);
 anchor:=' RETURN jsonb_build_object(''status'',''archived''';IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'supply_rescission_archive_return_contract_changed';END IF;
 definition:=replace(definition,anchor,E' IF gridex_supply_rescission.actor_v1(p_company_id,p_actor_user_id,''archive'') IS NOT TRUE THEN RAISE EXCEPTION ''supply_rescission_post_write_archive_actor_forbidden'' USING ERRCODE=''42501'';END IF;\n'||anchor);EXECUTE definition;
 definition:=pg_get_functiondef('public.ediel_review_supply_rescission_v1(uuid,uuid,uuid,jsonb)'::regprocedure);
 anchor:=' RETURN jsonb_build_object(''status'',''authorized''';IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'supply_rescission_review_return_contract_changed';END IF;
 definition:=replace(definition,anchor,E' IF gridex_supply_rescission.actor_v1(p_company_id,p_actor_user_id,''review'') IS NOT TRUE THEN RAISE EXCEPTION ''supply_rescission_post_write_reviewer_forbidden'' USING ERRCODE=''42501'';END IF;\n IF gridex_supply_rescission.mandate_current_v1(p_company_id,m.id) IS NOT TRUE THEN RAISE EXCEPTION ''supply_rescission_post_write_current_mandate_required'';END IF;\n'||anchor);EXECUTE definition;
END$intake$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_supply_rescission FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_ediel_outbound_owner.prepare_before_national_rescission_v1(jsonb),gridex_ediel_transport.mutate_before_national_rescission_v1(jsonb),gridex_outbound_dispatch.mutate_before_national_rescission_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb),public.ediel_create_national_supply_rescission_original_v1(uuid,uuid,jsonb),public.ediel_qualify_supply_rescission_draft_v1(uuid,uuid,text,text,uuid),public.ediel_read_supply_rescission_original_v1(uuid,uuid,uuid),public.ediel_apply_supply_source_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb),public.ediel_create_national_supply_rescission_original_v1(uuid,uuid,jsonb),public.ediel_qualify_supply_rescission_draft_v1(uuid,uuid,text,text,uuid),public.ediel_read_supply_rescission_original_v1(uuid,uuid,uuid),public.ediel_apply_supply_source_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
