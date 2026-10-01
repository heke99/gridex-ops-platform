-- A real committed own end effect creates its operational final-value/billing
-- task once. The task grants no supply, billing or whole-message authority.
BEGIN;
CREATE TABLE gridex_received_sources.supply_end_followups(
 effect_receipt_id uuid PRIMARY KEY REFERENCES gridex_received_sources.supply_object_effect_receipts(id),
 company_id uuid NOT NULL,source_message_id uuid NOT NULL,source_payload_hash text NOT NULL,effect_facts_hash text NOT NULL,
 case_id uuid NOT NULL UNIQUE REFERENCES public.customer_cases(id),customer_id uuid NOT NULL,metering_point_id uuid NOT NULL,
 site_id uuid,supply_period_id uuid NOT NULL,actor_user_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE gridex_received_sources.supply_end_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.supply_end_followups FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.supply_end_followups FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_received_sources.supply_end_followups FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_sources.supply_end_followups FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();

CREATE FUNCTION public.ediel_project_supply_end_followup_v1(p_company_id uuid,p_effect_receipt_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r gridex_received_sources.supply_object_effect_receipts%rowtype;old gridex_received_sources.supply_end_followups%rowtype;
 m public.ediel_messages%rowtype;effect jsonb;plan jsonb;period jsonb;proof gridex_received_sources.normal_switch_confirmations%rowtype;
 site_id uuid;switch_id uuid;case_id uuid;customer_id uuid;point_id uuid;v_period_id uuid;receipts jsonb;current_period public.customer_supply_periods%rowtype;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'supply_followup_service_required' USING ERRCODE='42501';END IF;
 -- Discovery carries no authority. Source lock precedes executor and relations.
 SELECT * INTO r FROM gridex_received_sources.supply_object_effect_receipts WHERE id=p_effect_receipt_id AND company_id=p_company_id;
 IF r.id IS NULL THEN RAISE EXCEPTION 'supply_followup_own_receipt_required';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=r.source_message_id AND company_id=p_company_id FOR UPDATE;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS NOT TRUE THEN RAISE EXCEPTION 'supply_followup_execution_actor_unqualified' USING ERRCODE='42501';END IF;
 IF m.id IS NULL OR m.environment IS DISTINCT FROM r.environment OR r.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR r.effect_hash IS DISTINCT FROM encode(sha256(convert_to(r.effect_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'supply_followup_source_conflict';END IF;
 SELECT * INTO old FROM gridex_received_sources.supply_end_followups WHERE effect_receipt_id=r.id;
 IF old.effect_receipt_id IS NOT NULL THEN
  IF old.company_id IS DISTINCT FROM p_company_id OR old.source_message_id IS DISTINCT FROM m.id OR old.source_payload_hash IS DISTINCT FROM r.payload_hash OR old.effect_facts_hash IS DISTINCT FROM r.effect_hash
   OR NOT EXISTS(SELECT FROM public.customer_cases c WHERE c.id=old.case_id AND c.company_id=old.company_id AND c.customer_id=old.customer_id AND c.metering_point_id=old.metering_point_id AND c.site_id IS NOT DISTINCT FROM old.site_id) THEN RAISE EXCEPTION 'supply_followup_replay_conflict';END IF;
  RETURN jsonb_build_object('status','existing','caseId',old.case_id,'effectReceiptId',r.id,'sourceMessageId',m.id);
 END IF;
 receipts:=gridex_received_sources.committed_supply_effects_v1(p_company_id,m.id,ARRAY[r.first_line_index]);
 IF jsonb_typeof(receipts) IS DISTINCT FROM 'array' OR jsonb_array_length(receipts)<>1 OR receipts#>>'{0,receiptId}' IS DISTINCT FROM r.id::text THEN RAISE EXCEPTION 'supply_followup_committed_effect_required';END IF;
 effect:=r.effect_text::jsonb;plan:=effect->'plan';
 IF plan->>'kind' IS DISTINCT FROM 'end' THEN RETURN jsonb_build_object('status','not_applicable','effectReceiptId',r.id,'sourceMessageId',m.id);END IF;
 IF m.message_code IS DISTINCT FROM 'Z05' OR effect->'wire' IS DISTINCT FROM plan->'object' OR jsonb_typeof(effect->'resultingStates') IS DISTINCT FROM 'array' OR jsonb_array_length(effect->'resultingStates')<>1 THEN RAISE EXCEPTION 'supply_followup_end_scope_required';END IF;
 period:=effect#>'{resultingStates,0}';v_period_id:=(period->>'id')::uuid;customer_id:=(period->>'customer_id')::uuid;point_id:=(period->>'metering_point_id')::uuid;
 IF v_period_id IS NULL OR customer_id IS NULL OR point_id IS NULL OR v_period_id::text IS DISTINCT FROM plan->>'periodId' OR period->>'company_id' IS DISTINCT FROM p_company_id::text
  OR period->>'source_end_message_id' IS DISTINCT FROM m.id::text OR (period->>'status' IN('ending','ended')) IS NOT TRUE
  OR (period->>'market_end_at')::timestamptz IS DISTINCT FROM (plan->>'eventAt')::timestamptz THEN RAISE EXCEPTION 'supply_followup_end_state_required';END IF;
 -- Existing tasks preserve their historical outcome above. A new operational
 -- task cannot be born for an end already superseded by an authentic C/update.
 SELECT * INTO current_period FROM public.customer_supply_periods WHERE id=v_period_id AND company_id=p_company_id FOR SHARE;
 IF current_period.id IS NULL OR current_period.customer_id IS DISTINCT FROM customer_id OR current_period.metering_point_id IS DISTINCT FROM point_id
  OR current_period.source_end_message_id IS DISTINCT FROM m.id OR current_period.market_state_version::text IS DISTINCT FROM period->>'market_state_version'
  OR current_period.market_end_at IS DISTINCT FROM (period->>'market_end_at')::timestamptz
  OR coalesce(current_period.contract_id,current_period.customer_contract_id)::text IS DISTINCT FROM coalesce(period->>'contract_id',period->>'customer_contract_id')
  OR (current_period.status IN('ending','ended')) IS NOT TRUE THEN RETURN jsonb_build_object('status','not_applicable','reason','own_end_no_longer_current','effectReceiptId',r.id,'sourceMessageId',m.id);END IF;
 -- Site/switch come only from the same immutable normal confirmation, when
 -- available. Regulated receipts without a frozen internal site keep NULL.
 SELECT * INTO proof FROM gridex_received_sources.normal_switch_confirmations WHERE company_id=p_company_id AND period_id=v_period_id;
 IF proof.source_message_id IS NOT NULL THEN
  IF proof.confirmed_period->>'id' IS DISTINCT FROM v_period_id::text OR proof.confirmed_period->>'customer_id' IS DISTINCT FROM customer_id::text
   OR proof.confirmed_period->>'metering_point_id' IS DISTINCT FROM point_id::text OR proof.confirmed_switch->>'customer_id' IS DISTINCT FROM customer_id::text OR proof.confirmed_switch->>'metering_point_id' IS DISTINCT FROM point_id::text
   OR proof.confirmed_switch->>'id' IS DISTINCT FROM proof.switch_id::text THEN RAISE EXCEPTION 'supply_followup_initial_scope_conflict';END IF;
  site_id:=coalesce(proof.confirmed_switch->>'site_id',proof.confirmed_switch->>'customer_site_id')::uuid;switch_id:=proof.switch_id;
 END IF;
 INSERT INTO public.customer_cases(company_id,customer_id,site_id,metering_point_id,customer_contract_id,supplier_switch_request_id,case_type,status,priority,title,description,reason_category,next_action,source,metadata,created_by,updated_by,source_ediel_message_id,source_business_process)
 VALUES(p_company_id,customer_id,site_id,point_id,coalesce(period->>'contract_id',period->>'customer_contract_id')::uuid,switch_id,'other','open','normal','Leveransen upphör – slutför mätvärden och fakturering',
  'Ett källbundet leveransslut är registrerat. Säkerställ slutmätvärden och slutfakturering för den berörda perioden med bibehållen historik.','final_metering_and_billing','Kontrollera slutmätvärden och faktureringsberedskap vid angiven giltig sluttid.','ediel_supply_end_effect',
  jsonb_build_object('review_intent','final_metering_and_billing','source_ediel_message_id',m.id,'supply_period_id',v_period_id,'effect_receipt_id',r.id,'effect_facts_hash',r.effect_hash,'source_payload_hash',r.payload_hash,'object_scope',r.object_scope,'market_end_at',period->>'market_end_at'),p_actor_user_id,p_actor_user_id,m.id,'supply_termination') RETURNING id INTO case_id;
 INSERT INTO gridex_received_sources.supply_end_followups(effect_receipt_id,company_id,source_message_id,source_payload_hash,effect_facts_hash,case_id,customer_id,metering_point_id,site_id,supply_period_id,actor_user_id)
 VALUES(r.id,p_company_id,m.id,r.payload_hash,r.effect_hash,case_id,customer_id,point_id,site_id,v_period_id,p_actor_user_id);
 RETURN jsonb_build_object('status','created','caseId',case_id,'effectReceiptId',r.id,'sourceMessageId',m.id);
END$$;
REVOKE ALL ON FUNCTION public.ediel_project_supply_end_followup_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_project_supply_end_followup_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
