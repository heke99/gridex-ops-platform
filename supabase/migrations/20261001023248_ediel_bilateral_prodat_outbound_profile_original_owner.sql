-- Actual prospective profile is read again under the native authorization and
-- source epoch. No client flag or pre-existing witness permits H/LK origination.
BEGIN;
CREATE TABLE gridex_bilateral_prodat.outbound_operations(
 message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id) DEFERRABLE INITIALLY DEFERRED,
 company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'),
 capability jsonb NOT NULL,creation_txid bigint NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE gridex_bilateral_prodat.outbound_receipts(
 message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id) DEFERRABLE INITIALLY DEFERRED,
 company_id uuid NOT NULL,witness_id uuid NOT NULL UNIQUE REFERENCES gridex_ediel_outbound_owner.witnesses(id),
 payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['outbound_operations','outbound_receipts'] LOOP
 EXECUTE format('ALTER TABLE gridex_bilateral_prodat.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_bilateral_prodat.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_bilateral_prodat.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gridex_bilateral_prodat.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_immutable',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gridex_bilateral_prodat.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_no_truncate',t);
END LOOP;END$$;
CREATE FUNCTION gridex_bilateral_prodat.draft_wire_v1(p_raw text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(p_raw);t jsonb;e jsonb;out jsonb:='{}';objects jsonb:='[]';obj jsonb;characteristic text;key text;value text;
BEGIN
 IF tokens IS NULL THEN RETURN NULL; END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens) x ORDER BY (x->>'index')::int LOOP
  e:=t->'elements';
  IF t->>'tag'='BGM' THEN out:=out||jsonb_build_object('code',e#>>'{1,0}','bgmId',e#>>'{2,0}'); END IF;
  IF t->>'tag'='NAD' AND obj IS NULL AND e#>>'{1,0}' IN ('FR','DO') THEN
   key:=CASE e#>>'{1,0}' WHEN 'FR' THEN 'sender' ELSE 'receiver' END;
   IF out ? key OR e#>>'{2,1}' IS DISTINCT FROM '160' OR e#>>'{2,2}' IS DISTINCT FROM 'SVK' THEN RETURN NULL; END IF;
   out:=out||jsonb_build_object(key,e#>>'{2,0}');
  END IF;
  IF t->>'tag'='LIN' THEN
   IF obj IS NOT NULL THEN objects:=objects||jsonb_build_array(obj); END IF;
   obj:=jsonb_build_object('point',nullif(e#>>'{3,0}',''),'line',e#>>'{1,0}');characteristic:=NULL;
  ELSIF obj IS NOT NULL THEN
   key:=NULL;value:=NULL;
   IF t->>'tag'='RFF' AND e#>>'{1,0}' IN ('LI','Z05','Z07') THEN key:=CASE e#>>'{1,0}' WHEN 'LI' THEN 'li' WHEN 'Z05' THEN 'gridArea' ELSE 'consumptionPoint' END;value:=e#>>'{1,1}';
   ELSIF t->>'tag'='NAD' AND e#>>'{1,0}'='UD' THEN key:='customerIdentity';value:=e#>>'{2,0}';
   ELSIF t->>'tag'='DTM' AND e#>>'{1,0}' IN ('92','93') THEN
    key:=CASE e#>>'{1,0}' WHEN '92' THEN 'start' ELSE 'end' END;value:=e#>>'{1,1}';
    IF e#>>'{1,2}' IS DISTINCT FROM '203' THEN RETURN NULL; END IF;
   ELSIF t->>'tag'='CCI' THEN characteristic:=e#>>'{2,0}';
   ELSIF t->>'tag'='CAV' THEN key:=CASE characteristic WHEN 'Z13' THEN 'reason' WHEN 'Z23' THEN 'status' END;value:=e#>>'{1,0}';
   END IF;
   IF key IS NOT NULL THEN IF obj ? key THEN RETURN NULL; END IF;obj:=obj||jsonb_build_object(key,nullif(value,''));END IF;
  END IF;
 END LOOP;
 IF obj IS NOT NULL THEN objects:=objects||jsonb_build_array(obj);END IF;
 IF (out->>'code' IN ('Z03','Z08')) IS NOT TRUE OR nullif(out->>'sender','') IS NULL OR nullif(out->>'receiver','') IS NULL OR jsonb_array_length(objects)=0 THEN RETURN NULL;END IF;
 RETURN out||jsonb_build_object('objects',objects);
END $$;

CREATE FUNCTION gridex_bilateral_prodat.outbound_required_v1(raw text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.wire_tokens_bounded_v1(raw,10000);family text;code text;characteristic text;t jsonb;
BEGIN
 SELECT x#>>'{elements,2,0}' INTO family FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH';SELECT x#>>'{elements,1,0}' INTO code FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='BGM';
 IF family IS DISTINCT FROM 'PRODAT' OR code NOT IN('Z03','Z08') THEN RETURN false;END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens)x LOOP
 IF t->>'tag'='CCI' THEN characteristic:=t#>>'{elements,2,0}';ELSIF t->>'tag'='CAV' AND characteristic='Z13' AND t#>>'{elements,1,0}'=(CASE code WHEN 'Z03' THEN 'Z25' ELSE 'Z23' END) THEN RETURN true;END IF;END LOOP;RETURN false;
END$$;
CREATE FUNCTION gridex_bilateral_prodat.lock_outbound_v1() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 LOCK TABLE gridex_bilateral_prodat.outbound_operations,gridex_bilateral_prodat.outbound_receipts IN SHARE ROW EXCLUSIVE MODE;
 -- Public original epoch is acquired only after actual authorization/profile
 -- locks, matching atomic ACK/source owners and excluding insertion races.
 LOCK TABLE public.ediel_messages IN SHARE ROW EXCLUSIVE MODE;
END$$;
CREATE FUNCTION gridex_bilateral_prodat.outbound_capability_v1(c uuid,actor uuid,env text,raw text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE wire jsonb;own jsonb;ids uuid[];g gridex_bilateral_prodat.profile_versions%rowtype;a gridex_bilateral_prodat.artifacts%rowtype;
 point public.metering_points%rowtype;customer public.customers%rowtype;site public.customer_sites%rowtype;contract public.customer_contracts%rowtype;
 sw public.supplier_switch_requests%rowtype;period public.customer_supply_periods%rowtype;doc public.customer_contract_documents%rowtype;
 objects jsonb:='[]';kind text;event_at timestamptz;profile_id uuid;basis jsonb;sig text;identity text;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 IF gridex_bilateral_prodat.actor_v1(c,actor,'archive') IS NOT TRUE OR env NOT IN('test','production') OR octet_length(raw) NOT BETWEEN 1 AND 8388608 OR gridex_bilateral_prodat.outbound_required_v1(raw) IS NOT TRUE THEN RETURN NULL;END IF;
 wire:=gridex_bilateral_prodat.draft_wire_v1(raw);IF wire IS NULL THEN RETURN NULL;END IF;
 kind:=CASE wire->>'code' WHEN 'Z03' THEN 'normal_start_h' ELSE 'closure_request_lk' END;
 IF (SELECT count(*) FROM jsonb_array_elements(gridex_received_sources.wire_tokens_bounded_v1(raw,10000)) t WHERE t->>'tag'='UNH')<>1
 OR (SELECT count(DISTINCT o->>'point') FROM jsonb_array_elements(wire->'objects')o)<>jsonb_array_length(wire->'objects') THEN RETURN NULL;END IF;
 FOR own IN SELECT o FROM jsonb_array_elements(wire->'objects')o LOOP
  IF nullif(own->>'li','') IS NULL OR nullif(own->>'point','') IS NULL OR own->>'reason' IS DISTINCT FROM (CASE kind WHEN 'normal_start_h' THEN 'Z25' ELSE 'Z23' END) THEN RETURN NULL;END IF;
  SELECT array_agg(mp.id) INTO ids FROM public.metering_points mp WHERE mp.company_id=c AND mp.ediel_metering_point_id=own->>'point' AND mp.grid_owner_ediel_id=wire->>'receiver' AND mp.grid_area_code=own->>'gridArea';
  IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;SELECT * INTO point FROM public.metering_points WHERE id=ids[1] AND company_id=c;
  SELECT * INTO customer FROM public.customers WHERE id=point.customer_id AND company_id=c;SELECT * INTO site FROM public.customer_sites WHERE id=coalesce(point.customer_site_id,point.site_id) AND company_id=c AND customer_id=point.customer_id;
  identity:=coalesce(nullif(btrim(customer.org_number),''),nullif(btrim(customer.personal_number),''));
  IF customer.id IS NULL OR site.id IS NULL OR own->>'customerIdentity' IS DISTINCT FROM identity THEN RETURN NULL;END IF;
  own:=own||jsonb_build_object('identityAgency',(SELECT t#>>'{elements,3,3}' FROM jsonb_array_elements(gridex_received_sources.wire_tokens_bounded_v1(raw,10000))t WHERE t->>'tag'='LIN' AND t#>>'{elements,3,0}'=own->>'point' LIMIT 1));
  IF (own->>'identityAgency' IN('9','89')) IS NOT TRUE THEN RETURN NULL;END IF;
  event_at:=gridex_received_sources.permission_time_v1(own->>CASE kind WHEN 'normal_start_h' THEN 'start' ELSE 'end' END);IF event_at IS NULL THEN RETURN NULL;END IF;
  SELECT array_agg(v.id ORDER BY v.id) INTO ids FROM gridex_bilateral_prodat.profile_versions v JOIN gridex_bilateral_prodat.origins origin ON origin.ground_id=v.id AND origin.company_id=v.company_id JOIN gridex_bilateral_prodat.artifacts archived ON archived.id=origin.artifact_id AND archived.company_id=v.company_id
   WHERE v.company_id=c AND v.environment=env AND v.process=kind AND v.grid_area_code=own->>'gridArea' AND archived.scope->>'legalSenderId'=wire->>'sender' AND archived.scope->>'legalReceiverId'=wire->>'receiver'
   AND EXISTS(SELECT FROM jsonb_array_elements(archived.scope#>'{sourceGrammar,profiles}') p WHERE p->>'message_code'=wire->>'code' AND p->>'direction' IN('outbound','both')) AND gridex_bilateral_prodat.ground_current_v1(v.id,c,event_at) IS TRUE;
  IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;SELECT * INTO g FROM gridex_bilateral_prodat.profile_versions WHERE id=ids[1];SELECT archived.* INTO a FROM gridex_bilateral_prodat.origins o JOIN gridex_bilateral_prodat.artifacts archived ON archived.id=o.artifact_id AND archived.company_id=o.company_id WHERE o.ground_id=g.id;
  SELECT (p->>'id')::uuid INTO profile_id FROM jsonb_array_elements(a.scope#>'{sourceGrammar,profiles}')p WHERE p->>'message_code'=wire->>'code' AND p->>'direction' IN('outbound','both');
  SELECT array_agg(cc.id) INTO ids FROM public.customer_contracts cc WHERE cc.company_id=c AND cc.customer_id=customer.id AND cc.metering_point_id=point.id AND cc.status IN('signed','active') AND cc.signed_at IS NOT NULL AND cc.signed_version=cc.contract_version;
  IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;SELECT * INTO contract FROM public.customer_contracts WHERE id=ids[1] AND company_id=c;
  sig:=encode(sha256(convert_to(contract.signature_snapshot::text,'UTF8')),'hex');SELECT * INTO doc FROM public.customer_contract_documents WHERE company_id=c AND customer_contract_id=contract.id AND document_type='signed_contract_pdf' AND document_sha256=contract.document_sha256 AND verified_at IS NOT NULL ORDER BY id LIMIT 1;
  IF doc.id IS NULL OR contract.signature_snapshot_sha256 IS DISTINCT FROM sig OR contract.signature_snapshot->>'company_id' IS DISTINCT FROM c::text OR contract.signature_snapshot->>'customer_id' IS DISTINCT FROM customer.id::text OR contract.signature_snapshot->>'contract_id' IS DISTINCT FROM contract.id::text THEN RETURN NULL;END IF;
  IF kind='normal_start_h' THEN
   SELECT array_agg(s.id) INTO ids FROM public.supplier_switch_requests s WHERE s.company_id=c AND s.customer_id=customer.id AND s.metering_point_id=point.id AND coalesce(s.contract_id,s.customer_contract_id)=contract.id AND coalesce(s.site_id,s.customer_site_id)=site.id AND (s.rff_li_reference=own->>'li' OR s.rff_li_reference IS NULL) AND s.prodat_variant='H' AND s.prodat_reason='Z25' AND (s.outbound_z03_message_id IS NULL OR EXISTS(SELECT FROM gridex_bilateral_prodat.outbound_operations original WHERE original.message_id=s.outbound_z03_message_id AND original.company_id=c AND original.capability->>'messageCode'='Z03')) AND s.status IN('draft','ready','ready_for_switch','ready_for_z03','z03_ready','validated','prepared','queued','submitted','sent','waiting','waiting_response','waiting_for_z04','awaiting_confirmation') AND NOT s.lifecycle_blocked;
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;SELECT * INTO sw FROM public.supplier_switch_requests WHERE id=ids[1] AND company_id=c;
   IF sw.requested_start_date IS DISTINCT FROM gridex_received_sources.permission_date_v1(own->>'start') THEN RETURN NULL;END IF;
  ELSE
   SELECT array_agg(p.id) INTO ids FROM public.customer_supply_periods p WHERE p.company_id=c AND p.customer_id=customer.id AND p.metering_point_id=point.id AND coalesce(p.contract_id,p.customer_contract_id)=contract.id AND p.status IN('active','confirmed_by_grid_owner') AND p.market_start_at<event_at AND (p.market_end_at IS NULL OR p.market_end_at=event_at);
   IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;SELECT * INTO period FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=c;
   basis:=gridex_received_sources.supply_period_source_basis_v1(c,period.id,event_at-interval '1 minute',event_at);IF basis IS NULL THEN RETURN NULL;END IF;
  END IF;
  objects:=objects||jsonb_build_array(jsonb_build_object('objectId',own->>'point','identityAgency',(SELECT t#>>'{elements,3,3}' FROM jsonb_array_elements(gridex_received_sources.wire_tokens_bounded_v1(raw,10000))t WHERE t->>'tag'='LIN' AND t#>>'{elements,3,0}'=own->>'point' LIMIT 1),'firstLineIndex',gridex_bilateral_prodat.first_line_index_v1(raw,own||jsonb_build_object('identityAgency',(SELECT t#>>'{elements,3,3}' FROM jsonb_array_elements(gridex_received_sources.wire_tokens_bounded_v1(raw,10000))t WHERE t->>'tag'='LIN' AND t#>>'{elements,3,0}'=own->>'point' LIMIT 1))),'lineItemReference',own->>'li','profileVersionId',g.id,'process',kind,'sourceHash',a.source_hash,'sourceGrammarHash',a.scope->>'sourceGrammarHash','rulePackId',a.scope->>'rulePackId','messageProfileId',profile_id,'pointId',point.id,'customerId',customer.id,'siteId',site.id,'contractId',contract.id,'contractHash',gridex_received_sources.production_contract_hash_v1(contract),'eventAt',event_at,'switchId',CASE kind WHEN 'normal_start_h' THEN sw.id ELSE NULL END,'supplyPeriodId',CASE kind WHEN 'closure_request_lk' THEN period.id ELSE NULL END,'marketStateVersion',CASE kind WHEN 'closure_request_lk' THEN period.market_state_version ELSE NULL END));
 END LOOP;
 IF jsonb_array_length(objects)=0 OR EXISTS(SELECT FROM jsonb_array_elements(objects)o WHERE o->>'identityAgency' NOT IN('9','89')) THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('version',1,'owner','immutable-bilateral-prodat-outbound-profile-v1','companyId',c,'environment',env,'actorUserId',actor,'payloadHash',encode(sha256(convert_to(raw,'UTF8')),'hex'),'messageCode',wire->>'code','objects',objects);
END$$;
CREATE FUNCTION public.ediel_qualify_bilateral_prodat_outbound_draft_v1(p_company_id uuid,p_actor_user_id uuid,p_environment text,p_raw_payload text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 RETURN gridex_bilateral_prodat.outbound_capability_v1(p_company_id,p_actor_user_id,p_environment,p_raw_payload);END$$;

CREATE FUNCTION gridex_bilateral_prodat.require_outbound_original_v1(m public.ediel_messages,p_creating boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_bilateral_prodat.outbound_operations%rowtype;r gridex_bilateral_prodat.outbound_receipts%rowtype;cap jsonb;
BEGIN
 IF m.direction IS DISTINCT FROM 'outbound' OR m.raw_payload IS NULL OR gridex_bilateral_prodat.outbound_required_v1(m.raw_payload) IS NOT TRUE THEN RETURN;END IF;
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 SELECT * INTO o FROM gridex_bilateral_prodat.outbound_operations WHERE message_id=m.id AND company_id=m.company_id;
 SELECT * INTO r FROM gridex_bilateral_prodat.outbound_receipts WHERE message_id=m.id AND company_id=m.company_id;
 IF o.message_id IS NULL OR r.message_id IS NULL OR o.environment IS DISTINCT FROM m.environment OR o.actor_user_id IS DISTINCT FROM m.created_by
  OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR r.payload_hash IS DISTINCT FROM o.payload_hash
  OR r.witness_id::text IS DISTINCT FROM m.execution_context_snapshot->>'outboundOwnerWitnessId'
  OR p_creating AND o.creation_txid IS DISTINCT FROM txid_current()
  OR NOT EXISTS(SELECT FROM gridex_ediel_outbound_owner.witnesses w WHERE w.id=r.witness_id AND w.company_id=m.company_id AND w.actor_user_id=o.actor_user_id AND w.environment=m.environment AND w.payload_sha256=o.payload_hash) THEN RAISE EXCEPTION 'bilateral_prodat_outbound_atomic_original_required';END IF;
 cap:=gridex_bilateral_prodat.outbound_capability_v1(m.company_id,o.actor_user_id,m.environment,m.raw_payload);
 IF cap IS NULL OR cap IS DISTINCT FROM o.capability THEN RAISE EXCEPTION 'bilateral_prodat_outbound_current_profile_required';END IF;
END$$;
CREATE FUNCTION gridex_bilateral_prodat.require_recorded_outbound_v1(m public.ediel_messages,actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_bilateral_prodat.outbound_operations%rowtype;r gridex_bilateral_prodat.outbound_receipts%rowtype;own jsonb;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 IF gridex_bilateral_prodat.actor_v1(m.company_id,actor,'read') IS NOT TRUE THEN RAISE EXCEPTION 'bilateral_prodat_outbound_recorded_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO o FROM gridex_bilateral_prodat.outbound_operations WHERE message_id=m.id AND company_id=m.company_id;SELECT * INTO r FROM gridex_bilateral_prodat.outbound_receipts WHERE message_id=m.id AND company_id=m.company_id;
 IF o.message_id IS NULL OR r.message_id IS NULL OR o.environment IS DISTINCT FROM m.environment OR o.payload_hash IS DISTINCT FROM m.immutable_payload_hash OR r.payload_hash IS DISTINCT FROM o.payload_hash
  OR NOT EXISTS(SELECT FROM gridex_ediel_outbound_owner.consumptions consumed JOIN gridex_ediel_outbound_owner.witnesses witness ON witness.id=consumed.witness_id WHERE consumed.source_message_id=m.id AND consumed.company_id=m.company_id AND consumed.environment=m.environment AND consumed.payload_sha256=o.payload_hash AND witness.id=r.witness_id AND witness.payload_sha256=o.payload_hash AND witness.actor_user_id=o.actor_user_id)
  OR NOT EXISTS(SELECT FROM gridex_ediel_source_rules.receipts original WHERE original.source_message_id=m.id AND original.company_id=m.company_id AND original.environment=m.environment AND original.direction='outbound' AND original.payload_sha256=o.payload_hash) THEN RAISE EXCEPTION 'bilateral_prodat_outbound_recorded_original_required';END IF;
 FOR own IN SELECT x FROM jsonb_array_elements(o.capability->'objects')x LOOP
  IF gridex_bilateral_prodat.recorded_profile_authority_v1((own->>'profileVersionId')::uuid,m.company_id) IS NOT TRUE OR NOT EXISTS(SELECT FROM gridex_bilateral_prodat.origins origin JOIN gridex_bilateral_prodat.artifacts archived ON archived.id=origin.artifact_id AND archived.company_id=origin.company_id WHERE origin.ground_id=(own->>'profileVersionId')::uuid AND origin.company_id=m.company_id AND archived.source_hash=own->>'sourceHash' AND archived.scope->>'sourceGrammarHash'=own->>'sourceGrammarHash') THEN RAISE EXCEPTION 'bilateral_prodat_outbound_recorded_profile_required';END IF;
 END LOOP;
END$$;
CREATE FUNCTION gridex_bilateral_prodat.guard_original_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_bilateral_prodat.require_outbound_original_v1(NEW,TG_OP='INSERT');RETURN NEW;END$$;
CREATE TRIGGER ediel_bilateral_prodat_original_owner BEFORE INSERT OR UPDATE OF raw_payload ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_bilateral_prodat.guard_original_v1();

ALTER FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb) RENAME TO prepare_before_bilateral_prodat_v1;
CREATE FUNCTION gridex_ediel_outbound_owner.prepare_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_bilateral_prodat.outbound_operations%rowtype;own jsonb;
BEGIN
 IF gridex_bilateral_prodat.outbound_required_v1(p_input->>'rawPayload') IS TRUE THEN
  PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
  SELECT * INTO o FROM gridex_bilateral_prodat.outbound_operations WHERE message_id=(p_input->>'bilateralOriginalMessageId')::uuid AND company_id=(p_input->>'companyId')::uuid;
  IF o.message_id IS NULL OR o.creation_txid IS DISTINCT FROM txid_current() OR o.actor_user_id::text IS DISTINCT FROM p_input->>'actorUserId' OR o.environment IS DISTINCT FROM p_input->>'environment' OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(p_input->>'rawPayload','UTF8')),'hex')
   OR o.capability IS DISTINCT FROM gridex_bilateral_prodat.outbound_capability_v1(o.company_id,o.actor_user_id,o.environment,p_input->>'rawPayload') THEN RAISE EXCEPTION 'bilateral_prodat_outbound_atomic_original_required';END IF;
  FOR own IN SELECT x FROM jsonb_array_elements(o.capability->'objects')x LOOP
   IF own->>'rulePackId' IS DISTINCT FROM p_input#>>'{rulePackEvidence,rulePackId}' OR own->>'messageProfileId' IS DISTINCT FROM p_input#>>'{rulePackEvidence,messageProfileId}' THEN RAISE EXCEPTION 'bilateral_prodat_outbound_captured_source_grammar_required';END IF;
  END LOOP;
 END IF;
 RETURN gridex_ediel_outbound_owner.prepare_before_bilateral_prodat_v1(p_input);
END$$;

CREATE FUNCTION gridex_bilateral_prodat.bind_switch_before_bilateral_v1(p_company_id uuid,p_switch_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;s public.supplier_switch_requests%rowtype;c public.customer_contracts%rowtype;
 r public.outbound_requests%rowtype;mp public.metering_points%rowtype;prior gridex_received_sources.switch_originals%rowtype;
 w jsonb;own jsonb;before_state jsonb;identity text;identity_qualifier text;expected_reason text;i public.ediel_message_intents%rowtype;
BEGIN
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write') IS NOT TRUE THEN RAISE EXCEPTION 'switch_original_execution_actor_required';END IF;
 SELECT * INTO prior FROM gridex_received_sources.switch_originals WHERE message_id=m.id;
 IF FOUND THEN IF prior.company_id IS DISTINCT FROM p_company_id OR prior.switch_id IS DISTINCT FROM p_switch_id OR prior.intent_id IS DISTINCT FROM m.intent_id OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'switch_original_replay_conflict';END IF;RETURN jsonb_build_object('status','bound','messageId',m.id,'idempotent',true);END IF;
 PERFORM gridex_ediel_transport.require_message_intent_v1(m);
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=m.intent_id FOR SHARE;
 SELECT * INTO s FROM public.supplier_switch_requests WHERE id=p_switch_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO c FROM public.customer_contracts WHERE id=coalesce(s.customer_contract_id,s.contract_id) AND company_id=p_company_id FOR SHARE;
 SELECT * INTO mp FROM public.metering_points WHERE id=s.metering_point_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=m.outbound_request_id AND company_id=p_company_id FOR SHARE;
 PERFORM customer.id FROM public.customers customer WHERE customer.id=s.customer_id AND customer.company_id=p_company_id FOR SHARE;
 SELECT coalesce(nullif(btrim(customer.org_number),''),nullif(btrim(customer.personal_number),'')),CASE WHEN nullif(btrim(customer.org_number),'') IS NOT NULL THEN 'SE1' ELSE 'SE2' END INTO identity,identity_qualifier FROM public.customers customer WHERE customer.id=s.customer_id AND customer.company_id=p_company_id;
 w:=gridex_received_sources.switch_origin_wire_v1(m.raw_payload);own:=w#>'{objects,0}';
 expected_reason:=CASE WHEN s.request_type='move_in' OR s.prodat_variant='LK' OR s.prodat_reason='Z23' THEN 'Z23' ELSE 'Z22' END;
 IF i.id IS NULL OR i.operation_id IS DISTINCT FROM s.id OR s.id IS NULL OR c.id IS NULL OR mp.id IS NULL OR r.id IS NULL OR w IS NULL OR m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z03' OR m.status IS DISTINCT FROM 'draft'
  OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR m.switch_request_id IS DISTINCT FROM s.id OR m.source_operation_id IS DISTINCT FROM s.id::text OR m.customer_id IS DISTINCT FROM s.customer_id OR m.site_id IS DISTINCT FROM coalesce(s.site_id,s.customer_site_id) OR m.metering_point_id IS DISTINCT FROM s.metering_point_id
  OR (s.site_id IS NOT NULL AND s.site_id IS DISTINCT FROM m.site_id) OR (s.customer_site_id IS NOT NULL AND s.customer_site_id IS DISTINCT FROM m.site_id) OR (s.contract_id IS NOT NULL AND s.contract_id IS DISTINCT FROM c.id) OR (s.customer_contract_id IS NOT NULL AND s.customer_contract_id IS DISTINCT FROM c.id)
  OR s.outbound_z03_message_id IS NOT NULL OR s.inbound_z04_message_id IS NOT NULL OR s.lifecycle_blocked IS DISTINCT FROM false OR (s.status IN('draft','ready','ready_for_switch','ready_for_z03','z03_ready','prepared','queued','waiting')) IS NOT TRUE
  OR (r.payload->>'environment') IS DISTINCT FROM m.environment OR r.source_type IS DISTINCT FROM 'supplier_switch_request' OR r.source_id IS DISTINCT FROM s.id OR r.operation_id IS DISTINCT FROM s.id OR r.request_type IS DISTINCT FROM 'supplier_switch' OR r.customer_id IS DISTINCT FROM s.customer_id OR r.site_id IS DISTINCT FROM m.site_id OR r.metering_point_id IS DISTINCT FROM mp.id
  OR c.customer_id IS DISTINCT FROM s.customer_id OR c.metering_point_id IS DISTINCT FROM mp.id OR (c.status IN('signed','active')) IS NOT TRUE OR c.signed_at IS NULL OR nullif(c.signed_version,'') IS NULL
  OR mp.customer_id IS DISTINCT FROM s.customer_id OR mp.site_id IS DISTINCT FROM m.site_id OR own->>'installationPoint' IS DISTINCT FROM coalesce(nullif(mp.ediel_metering_point_id,''),nullif(mp.meter_point_id,'')) OR own->>'installationAgency' IS DISTINCT FROM '9'
  OR own->>'customerQualifier' IS DISTINCT FROM identity_qualifier OR own->>'customerAgency' IS DISTINCT FROM '260' OR own->>'reason' IS DISTINCT FROM expected_reason OR own->>'customerIdentity' IS DISTINCT FROM identity OR nullif(own->>'li','') IS NULL
  OR gridex_received_sources.permission_date_v1(own->>'start') IS DISTINCT FROM s.requested_start_date THEN RAISE EXCEPTION 'switch_original_owned_source_required';END IF;
 PERFORM public.gridex_assert_supplier_switch_ready(p_company_id,c.id);
 before_state:=to_jsonb(s);
 UPDATE public.supplier_switch_requests SET outbound_z03_message_id=m.id,rff_li_reference=own->>'li',status='prepared',updated_by=p_actor_user_id,updated_at=now() WHERE id=s.id AND company_id=p_company_id RETURNING * INTO s;
 INSERT INTO gridex_received_sources.switch_originals(message_id,company_id,switch_id,intent_id,outbound_request_id,payload_hash,contract_id,contract_hash,original_object,previous_switch,resulting_switch,actor_user_id)
 VALUES(m.id,p_company_id,s.id,m.intent_id,m.outbound_request_id,m.immutable_payload_hash,c.id,gridex_received_sources.production_contract_hash_v1(c),own,before_state,to_jsonb(s),p_actor_user_id);
 RETURN jsonb_build_object('status','bound','messageId',m.id,'idempotent',false);
END $$;
CREATE FUNCTION gridex_bilateral_prodat.bind_switch_h_v1(p_company_id uuid,p_switch_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;s public.supplier_switch_requests%rowtype;c public.customer_contracts%rowtype;
 r public.outbound_requests%rowtype;mp public.metering_points%rowtype;prior gridex_received_sources.switch_originals%rowtype;
 w jsonb;own jsonb;before_state jsonb;identity text;identity_qualifier text;expected_reason text;i public.ediel_message_intents%rowtype;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_outbound_v1();
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write') IS NOT TRUE THEN RAISE EXCEPTION 'switch_original_execution_actor_required';END IF;
 PERFORM gridex_bilateral_prodat.require_recorded_outbound_v1(m,p_actor_user_id);
 SELECT * INTO prior FROM gridex_received_sources.switch_originals WHERE message_id=m.id;
 IF FOUND THEN IF prior.company_id IS DISTINCT FROM p_company_id OR prior.switch_id IS DISTINCT FROM p_switch_id OR prior.intent_id IS DISTINCT FROM m.intent_id OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'switch_original_replay_conflict';END IF;RETURN jsonb_build_object('status','bound','messageId',m.id,'idempotent',true);END IF;
 PERFORM gridex_bilateral_prodat.require_outbound_original_v1(m,false);
 PERFORM gridex_ediel_transport.require_message_intent_v1(m);
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=m.intent_id FOR SHARE;
 SELECT * INTO s FROM public.supplier_switch_requests WHERE id=p_switch_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO c FROM public.customer_contracts WHERE id=coalesce(s.customer_contract_id,s.contract_id) AND company_id=p_company_id FOR SHARE;
 SELECT * INTO mp FROM public.metering_points WHERE id=s.metering_point_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO r FROM public.outbound_requests WHERE id=m.outbound_request_id AND company_id=p_company_id FOR SHARE;
 PERFORM customer.id FROM public.customers customer WHERE customer.id=s.customer_id AND customer.company_id=p_company_id FOR SHARE;
 SELECT coalesce(nullif(btrim(customer.org_number),''),nullif(btrim(customer.personal_number),'')),CASE WHEN nullif(btrim(customer.org_number),'') IS NOT NULL THEN 'SE1' ELSE 'SE2' END INTO identity,identity_qualifier FROM public.customers customer WHERE customer.id=s.customer_id AND customer.company_id=p_company_id;
 w:=gridex_received_sources.switch_origin_wire_v1(m.raw_payload);own:=w#>'{objects,0}';
 expected_reason:='Z25';
 IF s.prodat_variant IS DISTINCT FROM 'H' OR s.prodat_reason IS DISTINCT FROM 'Z25' THEN RAISE EXCEPTION 'bilateral_prodat_switch_actual_h_operation_required';END IF;
 IF i.id IS NULL OR i.operation_id IS DISTINCT FROM s.id OR s.id IS NULL OR c.id IS NULL OR mp.id IS NULL OR r.id IS NULL OR w IS NULL OR m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z03' OR m.status IS DISTINCT FROM 'draft'
  OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR m.switch_request_id IS DISTINCT FROM s.id OR m.source_operation_id IS DISTINCT FROM s.id::text OR m.customer_id IS DISTINCT FROM s.customer_id OR m.site_id IS DISTINCT FROM coalesce(s.site_id,s.customer_site_id) OR m.metering_point_id IS DISTINCT FROM s.metering_point_id
  OR (s.site_id IS NOT NULL AND s.site_id IS DISTINCT FROM m.site_id) OR (s.customer_site_id IS NOT NULL AND s.customer_site_id IS DISTINCT FROM m.site_id) OR (s.contract_id IS NOT NULL AND s.contract_id IS DISTINCT FROM c.id) OR (s.customer_contract_id IS NOT NULL AND s.customer_contract_id IS DISTINCT FROM c.id)
  OR s.outbound_z03_message_id IS NOT NULL OR s.inbound_z04_message_id IS NOT NULL OR s.lifecycle_blocked IS DISTINCT FROM false OR (s.status IN('draft','ready','ready_for_switch','ready_for_z03','z03_ready','prepared','queued','waiting')) IS NOT TRUE
  OR (r.payload->>'environment') IS DISTINCT FROM m.environment OR r.source_type IS DISTINCT FROM 'supplier_switch_request' OR r.source_id IS DISTINCT FROM s.id OR r.operation_id IS DISTINCT FROM s.id OR r.request_type IS DISTINCT FROM 'supplier_switch' OR r.customer_id IS DISTINCT FROM s.customer_id OR r.site_id IS DISTINCT FROM m.site_id OR r.metering_point_id IS DISTINCT FROM mp.id
  OR c.customer_id IS DISTINCT FROM s.customer_id OR c.metering_point_id IS DISTINCT FROM mp.id OR (c.status IN('signed','active')) IS NOT TRUE OR c.signed_at IS NULL OR nullif(c.signed_version,'') IS NULL
  OR mp.customer_id IS DISTINCT FROM s.customer_id OR mp.site_id IS DISTINCT FROM m.site_id OR own->>'installationPoint' IS DISTINCT FROM coalesce(nullif(mp.ediel_metering_point_id,''),nullif(mp.meter_point_id,'')) OR own->>'installationAgency' IS DISTINCT FROM '9'
  OR own->>'customerQualifier' IS DISTINCT FROM identity_qualifier OR own->>'customerAgency' IS DISTINCT FROM '260' OR own->>'reason' IS DISTINCT FROM expected_reason OR own->>'customerIdentity' IS DISTINCT FROM identity OR nullif(own->>'li','') IS NULL
  OR gridex_received_sources.permission_date_v1(own->>'start') IS DISTINCT FROM s.requested_start_date THEN RAISE EXCEPTION 'switch_original_owned_source_required';END IF;
 PERFORM public.gridex_assert_supplier_switch_ready(p_company_id,c.id);
 before_state:=to_jsonb(s);
 UPDATE public.supplier_switch_requests SET outbound_z03_message_id=m.id,rff_li_reference=own->>'li',status='prepared',updated_by=p_actor_user_id,updated_at=now() WHERE id=s.id AND company_id=p_company_id RETURNING * INTO s;
 INSERT INTO gridex_received_sources.switch_originals(message_id,company_id,switch_id,intent_id,outbound_request_id,payload_hash,contract_id,contract_hash,original_object,previous_switch,resulting_switch,actor_user_id)
 VALUES(m.id,p_company_id,s.id,m.intent_id,m.outbound_request_id,m.immutable_payload_hash,c.id,gridex_received_sources.production_contract_hash_v1(c),own,before_state,to_jsonb(s),p_actor_user_id);
 RETURN jsonb_build_object('status','bound','messageId',m.id,'idempotent',false);
END $$;
CREATE OR REPLACE FUNCTION public.ediel_bind_switch_original_v1(p_company_id uuid,p_switch_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_outbound_v1();SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF m.message_family='PRODAT' AND m.message_code='Z03' AND gridex_bilateral_prodat.outbound_required_v1(m.raw_payload) IS TRUE THEN RETURN gridex_bilateral_prodat.bind_switch_h_v1(p_company_id,p_switch_id,p_message_id,p_actor_user_id);END IF;
 RETURN gridex_bilateral_prodat.bind_switch_before_bilateral_v1(p_company_id,p_switch_id,p_message_id,p_actor_user_id);
END$$;
CREATE FUNCTION public.ediel_create_bilateral_prodat_original_v1(p_company_id uuid,p_actor_user_id uuid,p_draft jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE raw text:=p_draft->>'rawPayload';env text:=p_draft->>'environment';cap jsonb;own jsonb;e jsonb;sealed jsonb;m public.ediel_messages%rowtype;mid uuid:=gen_random_uuid();reference record;token jsonb;intent public.ediel_message_intents%rowtype;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_outbound_v1();
 IF jsonb_typeof(p_draft) IS DISTINCT FROM 'object' OR p_draft->>'companyId' IS DISTINCT FROM p_company_id::text OR p_draft->>'direction' IS DISTINCT FROM 'outbound' OR p_draft->>'messageStandard' IS DISTINCT FROM 'edifact' OR p_draft->>'messageFamily' IS DISTINCT FROM 'PRODAT'
 OR p_draft->>'messageCode' NOT IN('Z03','Z08') OR coalesce(p_draft->>'status','draft') NOT IN('draft','prepared','queued') OR nullif(p_draft->>'sourceOperationId','') IS NULL
 OR nullif(p_draft->>'messageSentAt','') IS NOT NULL OR nullif(p_draft->>'relatedMessageId','') IS NOT NULL THEN RAISE EXCEPTION 'bilateral_prodat_outbound_actual_draft_required';END IF;
 IF (SELECT count(*) FROM public.ediel_messages WHERE company_id=p_company_id AND environment=env AND direction='outbound' AND source_operation_id=p_draft->>'sourceOperationId')>1 THEN RAISE EXCEPTION 'bilateral_prodat_outbound_operation_ambiguous';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE company_id=p_company_id AND environment=env AND direction='outbound' AND source_operation_id=p_draft->>'sourceOperationId' FOR SHARE;
 IF FOUND THEN
  IF m.raw_payload IS DISTINCT FROM raw OR m.message_code IS DISTINCT FROM p_draft->>'messageCode' OR m.message_family IS DISTINCT FROM 'PRODAT' THEN RAISE EXCEPTION 'bilateral_prodat_outbound_operation_conflict';END IF;
  PERFORM gridex_bilateral_prodat.require_recorded_outbound_v1(m,p_actor_user_id);RETURN jsonb_build_object('version',1,'message',to_jsonb(m),'replayed',true);
 END IF;
 cap:=gridex_bilateral_prodat.outbound_capability_v1(p_company_id,p_actor_user_id,env,raw);
 IF cap IS NULL OR cap->>'messageCode' IS DISTINCT FROM p_draft->>'messageCode' THEN RAISE EXCEPTION 'bilateral_prodat_outbound_current_profile_required';END IF;
 FOR own IN SELECT x FROM jsonb_array_elements(cap->'objects')x LOOP
  IF nullif(p_draft->>'customerId','') IS NOT NULL AND p_draft->>'customerId' IS DISTINCT FROM own->>'customerId'
   OR nullif(p_draft->>'meteringPointId','') IS NOT NULL AND p_draft->>'meteringPointId' IS DISTINCT FROM own->>'pointId'
   OR nullif(p_draft->>'siteId','') IS NOT NULL AND p_draft->>'siteId' IS DISTINCT FROM own->>'siteId'
   OR nullif(p_draft->>'switchRequestId','') IS NOT NULL AND p_draft->>'switchRequestId' IS DISTINCT FROM own->>'switchId' THEN RAISE EXCEPTION 'bilateral_prodat_outbound_actual_owned_draft_required';END IF;
 END LOOP;
 IF cap->>'messageCode'='Z03' THEN
  IF jsonb_array_length(cap->'objects')<>1 OR nullif(p_draft->>'switchRequestId','') IS NULL OR p_draft->>'sourceOperationId' IS DISTINCT FROM cap#>>'{objects,0,switchId}' OR p_draft->>'switchRequestId' IS DISTINCT FROM cap#>>'{objects,0,switchId}' THEN RAISE EXCEPTION 'bilateral_prodat_outbound_actual_h_operation_required';END IF;
  SELECT * INTO intent FROM public.ediel_message_intents WHERE id=(p_draft->>'intentId')::uuid AND company_id=p_company_id FOR UPDATE;
  IF intent.id IS NULL OR intent.environment IS DISTINCT FROM env OR intent.message_family IS DISTINCT FROM 'PRODAT' OR intent.message_code IS DISTINCT FROM 'Z03' OR intent.direction IS DISTINCT FROM 'outbound' OR intent.created_by IS DISTINCT FROM p_actor_user_id OR intent.operation_id IS DISTINCT FROM (p_draft->>'switchRequestId')::uuid OR intent.supplier_switch_request_id IS DISTINCT FROM intent.operation_id OR intent.ediel_message_id IS NOT NULL
   OR intent.customer_id::text IS DISTINCT FROM cap#>>'{objects,0,customerId}' OR intent.customer_site_id::text IS DISTINCT FROM cap#>>'{objects,0,siteId}' OR intent.payload->>'transactionSubtype' IS DISTINCT FROM 'H' THEN RAISE EXCEPTION 'bilateral_prodat_outbound_actual_h_intent_required';END IF;
 END IF;
 IF p_draft#>>'{executionContextSnapshot,outboundOwnerWitnessId}' IS NOT NULL THEN RAISE EXCEPTION 'bilateral_prodat_outbound_atomic_original_required';END IF;
 e:=jsonb_build_object('rulePackId',p_draft->>'canonicalRulePackId','messageProfileId',p_draft->>'ruleProfileVersionId','profileKey',p_draft->>'ruleProfileKey','version',p_draft->>'ruleProfileVersion','sourceHash',p_draft->>'rulePackChecksum','snapshot',p_draft->'rulePackSnapshot');
 INSERT INTO gridex_bilateral_prodat.outbound_operations(message_id,company_id,environment,actor_user_id,payload_hash,capability,creation_txid) VALUES(mid,p_company_id,env,p_actor_user_id,cap->>'payloadHash',cap,txid_current());
 sealed:=gridex_ediel_outbound_owner.prepare_v1(jsonb_build_object('companyId',p_company_id,'actorUserId',p_actor_user_id,'environment',env,'rawPayload',raw,'rulePackEvidence',e,'bilateralOriginalMessageId',mid));
 INSERT INTO gridex_bilateral_prodat.outbound_receipts(message_id,company_id,witness_id,payload_hash) VALUES(mid,p_company_id,(sealed->>'witnessId')::uuid,cap->>'payloadHash');
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,created_by,updated_by,raw_payload,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot,execution_context_snapshot,tenant_resolution_status,business_match_status,processing_status,message_version,process_type,transport_type,mailbox,sender_ediel_id,sender_name,sender_sub_address,receiver_ediel_id,receiver_name,receiver_sub_address,sender_email,receiver_email,subject,file_name,mime_type,interchange_reference,external_reference,correlation_reference,transaction_reference,application_reference,original_message_id,original_transaction_id,original_message_code,source_operation_id,transport_security_mode,route_transport_security_mode,contrl_status,aperak_status,utilts_err_status,communication_route_id,route_profile_id,intent_id,party_id,party_address_id,expected_receiver_certificate_id,outbound_request_id,switch_request_id,grid_owner_data_request_id,partner_export_id,customer_id,site_id,metering_point_id,grid_owner_id,parsed_payload,validation_report,requires_contrl,requires_aperak,was_smime_encrypted,cms_expected_receiver_present,test_flag,unb_sender_id,unb_receiver_id,unb_sender_subaddress,unb_receiver_subaddress,message_reference,bgm_code,bgm_reference)
 VALUES(mid,p_company_id,env,'outbound','edifact','PRODAT',cap->>'messageCode',coalesce(p_draft->>'status','draft'),p_actor_user_id,p_actor_user_id,raw,(e->>'rulePackId')::uuid,e->>'profileKey',(e->>'messageProfileId')::uuid,e->>'version',e->>'sourceHash',e->'snapshot',jsonb_build_object('outboundOwnerWitnessId',sealed->>'witnessId'),'tenant_resolved','not_checked',coalesce(p_draft->>'status','draft'),p_draft->>'messageVersion',p_draft->>'processType',p_draft->>'transportType',p_draft->>'mailbox',p_draft->>'senderEdielId',p_draft->>'senderName',p_draft->>'senderSubAddress',p_draft->>'receiverEdielId',p_draft->>'receiverName',p_draft->>'receiverSubAddress',p_draft->>'senderEmail',p_draft->>'receiverEmail',p_draft->>'subject',p_draft->>'fileName',p_draft->>'mimeType',p_draft->>'interchangeReference',p_draft->>'externalReference',p_draft->>'correlationReference',p_draft->>'transactionReference',p_draft->>'applicationReference',p_draft->>'originalMessageId',p_draft->>'originalTransactionId',p_draft->>'originalMessageCode',p_draft->>'sourceOperationId',p_draft->>'transportSecurityMode',p_draft->>'routeTransportSecurityMode',p_draft->>'contrlStatus',p_draft->>'aperakStatus',p_draft->>'utiltsErrStatus',nullif(p_draft->>'communicationRouteId','')::uuid,nullif(p_draft->>'routeProfileId','')::uuid,nullif(p_draft->>'intentId','')::uuid,nullif(p_draft->>'partyId','')::uuid,nullif(p_draft->>'partyAddressId','')::uuid,nullif(p_draft->>'expectedReceiverCertificateId','')::uuid,nullif(p_draft->>'outboundRequestId','')::uuid,nullif(p_draft->>'switchRequestId','')::uuid,nullif(p_draft->>'gridOwnerDataRequestId','')::uuid,nullif(p_draft->>'partnerExportId','')::uuid,nullif(p_draft->>'customerId','')::uuid,nullif(p_draft->>'siteId','')::uuid,nullif(p_draft->>'meteringPointId','')::uuid,nullif(p_draft->>'gridOwnerId','')::uuid,coalesce(p_draft->'parsedPayload','{}'::jsonb),coalesce(p_draft->'validationReport','{}'::jsonb),(p_draft->>'requiresContrl')::boolean,(p_draft->>'requiresAperak')::boolean,(p_draft->>'wasSmimeEncrypted')::boolean,(p_draft->>'cmsExpectedReceiverPresent')::boolean,coalesce((p_draft->>'testFlag')::integer,CASE env WHEN 'test' THEN 1 ELSE 0 END),p_draft->>'senderEdielId',p_draft->>'receiverEdielId',p_draft->>'senderSubAddress',p_draft->>'receiverSubAddress',p_draft->>'originalMessageId',cap->>'messageCode',p_draft->>'externalReference') RETURNING * INTO m;
 PERFORM gridex_ediel_source_rules.capture_v1(m.company_id,m.id);
 IF m.message_code='Z03' THEN
  UPDATE public.ediel_message_intents SET ediel_message_id=m.id,outbound_request_id=m.outbound_request_id,render_status='rendered',updated_at=now() WHERE id=m.intent_id AND company_id=m.company_id;
  PERFORM public.ediel_bind_switch_original_v1(m.company_id,m.switch_request_id,m.id,p_actor_user_id);
 END IF;
 -- Immutable own references and created event are part of the same transaction.
 IF coalesce(m.switch_request_id,m.grid_owner_data_request_id,m.outbound_request_id,m.partner_export_id) IS NOT NULL THEN
 FOR reference IN SELECT DISTINCT reference_type,reference_value FROM (
 SELECT 'UNB_REF'::text reference_type,m.interchange_reference reference_value UNION ALL SELECT 'BGM_REF',m.external_reference
 UNION ALL SELECT 'RFF_'||(t#>>'{elements,1,0}'),t#>>'{elements,1,1}' FROM jsonb_array_elements(gridex_received_sources.wire_tokens_bounded_v1(raw,10000))t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}' IN('LI','ACW','Z07','TN')) refs WHERE nullif(reference_value,'') IS NOT NULL LOOP
  IF EXISTS(SELECT FROM public.ediel_business_references existing WHERE existing.company_id=m.company_id AND existing.reference_type=reference.reference_type AND existing.reference_value=reference.reference_value AND existing.business_object_type=CASE WHEN m.switch_request_id IS NOT NULL THEN 'supplier_switch_request' WHEN m.grid_owner_data_request_id IS NOT NULL THEN 'grid_owner_data_request' WHEN m.outbound_request_id IS NOT NULL THEN 'outbound_request' ELSE 'partner_export' END AND existing.business_object_id=coalesce(m.switch_request_id,m.grid_owner_data_request_id,m.outbound_request_id,m.partner_export_id) AND existing.source_message_id IS DISTINCT FROM m.id) THEN RAISE EXCEPTION 'bilateral_prodat_outbound_reference_owner_conflict';END IF;
  INSERT INTO public.ediel_business_references(company_id,source_message_id,reference_type,reference_value,message_family,message_code,business_object_type,business_object_id,customer_id,customer_site_id,metering_point_id)
   VALUES(m.company_id,m.id,reference.reference_type,reference.reference_value,m.message_family,m.message_code,CASE WHEN m.switch_request_id IS NOT NULL THEN 'supplier_switch_request' WHEN m.grid_owner_data_request_id IS NOT NULL THEN 'grid_owner_data_request' WHEN m.outbound_request_id IS NOT NULL THEN 'outbound_request' ELSE 'partner_export' END,coalesce(m.switch_request_id,m.grid_owner_data_request_id,m.outbound_request_id,m.partner_export_id),m.customer_id,m.site_id,m.metering_point_id)
   ON CONFLICT(company_id,reference_type,reference_value,business_object_type,business_object_id) DO NOTHING;
 END LOOP;END IF;
 INSERT INTO public.ediel_message_events(company_id,ediel_message_id,message_id,event_type,event_status,message,payload,event_payload,created_by)
 VALUES(m.company_id,m.id,m.id,'created','info','Bilateral PRODAT original created by atomic source owner',jsonb_build_object('sourceOperationId',m.source_operation_id,'payloadHash',cap->>'payloadHash'),jsonb_build_object('owner','bilateral_prodat_outbound_atomic_v1'),p_actor_user_id);
 INSERT INTO public.audit_logs(actor_user_id,company_id,entity_type,entity_id,action,metadata) VALUES(p_actor_user_id,m.company_id,'ediel_message',m.id,'ediel.bilateral_profile.original_registered',jsonb_build_object('payloadHash',cap->>'payloadHash','objects',cap->'objects'));
 PERFORM gridex_bilateral_prodat.require_outbound_original_v1(m,false);
 RETURN jsonb_build_object('version',1,'message',to_jsonb(m),'replayed',false);
END$$;

-- The predecessor determines immutable replay. Only a genuinely fresh true
-- prepare/enter result consumes current profile/original/ACK authority.
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_bilateral_prodat_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;m public.ediel_messages%rowtype;
BEGIN
 IF p_input->>'action' IN('prepare','enter') THEN PERFORM gridex_bilateral_prodat.lock_outbound_v1();END IF;
 r:=gridex_ediel_transport.mutate_before_bilateral_prodat_v1(p_input);
 IF p_input->>'action' IN('prepare','enter') AND r->>'proceed'='true' THEN SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid AND company_id=(p_input->>'companyId')::uuid FOR SHARE;PERFORM gridex_bilateral_prodat.require_outbound_original_v1(m,false);PERFORM public.ediel_require_current_prodat_bilateral_ack_source_v1(m.company_id,m.id);END IF;RETURN r;
END$$;
ALTER FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RENAME TO mutate_before_bilateral_prodat_v1;
CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;m public.ediel_messages%rowtype;
BEGIN
 IF p_input->>'action' IN('prepare','enter') THEN PERFORM gridex_bilateral_prodat.lock_outbound_v1();END IF;
 r:=gridex_outbound_dispatch.mutate_before_bilateral_prodat_v1(p_input);
 IF p_input->>'action' IN('prepare','enter') AND r->>'proceed'='true' THEN SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid AND company_id=(p_input->>'companyId')::uuid FOR SHARE;PERFORM gridex_bilateral_prodat.require_outbound_original_v1(m,false);PERFORM public.ediel_require_current_prodat_bilateral_ack_source_v1(m.company_id,m.id);END IF;RETURN r;
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_bilateral_prodat FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_ediel_outbound_owner.prepare_before_bilateral_prodat_v1(jsonb),gridex_ediel_outbound_owner.prepare_v1(jsonb),gridex_ediel_transport.mutate_before_bilateral_prodat_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_before_bilateral_prodat_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_qualify_bilateral_prodat_outbound_draft_v1(uuid,uuid,text,text),public.ediel_create_bilateral_prodat_original_v1(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ediel_bind_switch_original_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_bind_switch_original_v1(uuid,uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ediel_qualify_bilateral_prodat_outbound_draft_v1(uuid,uuid,text,text),public.ediel_create_bilateral_prodat_original_v1(uuid,uuid,jsonb) TO service_role;
COMMIT;
