-- Z04C after an own start was actually executed (HB 26B 4.1.7/4.1.9): the
-- cancellation is accepted and answered, and the executed start is corrected
-- through a controlled process instead of an immediate reversal. Only a
-- completed switch whose exact sent original, own confirmation, period and
-- activation are all bound qualifies. The own C then commits one effect receipt
-- naming that switch, period, original and confirmation, and opens one real
-- tenant work case for the correction. No switch, period, point, contract or
-- billing row is changed. Any other executed state, a second C for the same
-- executed switch, or a missing binding stays held with its reason.
-- Every existing source, sender, original, customer and cohort check is kept.
BEGIN;
DO $z04c$DECLARE f record;body text;
 executed_held CONSTANT text:=$needle$   IF (sw.status IN ('draft','prepared','queued','sent','submitted','waiting','waiting_for_z04','accepted','cancellation_requested','cancelled_before_start')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','z04c_effect_already_executed_compensation_required');END IF;$needle$;
 compensation_branch CONSTANT text:=$branch$   -- An executed own start is corrected under review; it is never reversed here.
   IF sw.status='completed' THEN
    IF EXISTS(SELECT FROM gridex_received_sources.supply_object_effect_receipts e WHERE e.company_id=m.company_id AND e.environment=m.environment
     AND e.effect_text::jsonb#>>'{plan,kind}'='executed_start_compensation' AND e.effect_text::jsonb#>>'{plan,executedSwitchId}'=sw.id::text) THEN RETURN jsonb_build_object('applied',false,'reason','z04c_executed_start_compensation_already_recorded');END IF;
    SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.customer_supply_periods p
     JOIN gridex_received_sources.normal_switch_confirmations c ON c.period_id=p.id AND c.company_id=p.company_id
     JOIN gridex_received_sources.normal_supply_activations a ON a.period_id=p.id AND a.company_id=p.company_id AND a.source_message_id=c.source_message_id
     WHERE p.company_id=m.company_id AND p.customer_id=sw.customer_id AND p.metering_point_id=sw.metering_point_id AND (p.status IN ('active','ending','ended')) IS TRUE
      AND c.switch_id=sw.id AND c.original_message_id=origin.id AND c.original_payload_hash=origin.immutable_payload_hash AND c.source_message_id=sw.inbound_z04_message_id
      AND p.start_date=gridex_received_sources.permission_date_v1(own->>'start') AND c.market_start_at<=now();
    IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','z04c_effect_already_executed_compensation_required');END IF;
    SELECT * INTO sp FROM public.customer_supply_periods WHERE id=ids[1] AND company_id=m.company_id FOR SHARE;
    previous_switches:=previous_switches||jsonb_build_array(to_jsonb(sw));
    plans:=plans||jsonb_build_array(jsonb_build_object('kind','executed_start_compensation','switchId',NULL,'periodId',NULL,'disposition','controlled_review',
     'executedSwitchId',sw.id,'executedPeriodId',sp.id,'executedPeriod',to_jsonb(sp),'originalId',origin.id,'originalHash',origin.immutable_payload_hash,
     'confirmationSourceMessageId',sw.inbound_z04_message_id,'siteId',coalesce(sw.site_id,sw.customer_site_id),'caseId',gen_random_uuid(),'object',own));
    CONTINUE;
   END IF;
$branch$;
 end_apply CONSTANT text:=$needle$  ELSIF plan->>'kind'='end' THEN$needle$;
 case_apply CONSTANT text:=$apply$  ELSIF plan->>'kind'='executed_start_compensation' THEN
   INSERT INTO public.customer_cases(id,company_id,customer_id,site_id,metering_point_id,customer_contract_id,supplier_switch_request_id,case_type,status,priority,title,description,reason_category,next_action,source,metadata,created_by,updated_by,source_ediel_message_id,source_business_process)
    VALUES((plan->>'caseId')::uuid,m.company_id,(plan#>>'{executedPeriod,customer_id}')::uuid,(plan->>'siteId')::uuid,(plan#>>'{executedPeriod,metering_point_id}')::uuid,
     coalesce(plan#>>'{executedPeriod,customer_contract_id}',plan#>>'{executedPeriod,contract_id}')::uuid,(plan->>'executedSwitchId')::uuid,'other','manual_follow_up','high',
     'Annullering efter genomförd leveransstart – korrigera',
     'Nätägaren har annullerat en leveransstart som redan genomförts. Annulleringen är besvarad. Korrigera starten med bibehållen historik och kompensera vid behov.',
     'executed_start_cancellation','Utred och genomför korrigering av den genomförda starten.','ediel_inbound_state_machine',
     jsonb_build_object('review_intent','executed_start_compensation','source_ediel_message_id',m.id,'executed_switch_id',plan->'executedSwitchId','executed_period_id',plan->'executedPeriodId',
      'original_message_id',plan->'originalId','original_payload_hash',plan->'originalHash','confirmation_source_message_id',plan->'confirmationSourceMessageId','object',plan->'object'),
     p_actor_user_id,p_actor_user_id,m.id,'supplier_switch');
$apply$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition
 INTO STRICT f FROM pg_proc p
 WHERE p.oid='gridex_received_sources.other_supply_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'e2bba947e4ade9d3a1128cc826f6b43b336da0733ba35d90eb43b498f53e350e'
  OR (length(f.prosrc)-length(replace(f.prosrc,executed_held,'')))/length(executed_held)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,end_apply,'')))/length(end_apply)<>1
  OR position(compensation_branch IN f.prosrc)>0 OR position(case_apply IN f.prosrc)>0
  THEN RAISE EXCEPTION 'z04c_compensation_predecessor_required';END IF;
 body:=replace(replace(f.prosrc,executed_held,compensation_branch||executed_held),end_apply,case_apply||end_apply);
 IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM 'c30e7398338c7b0a39da7220ea62bffa4d8ae0134f1c7d8b272b09e07736e03e'
  OR replace(replace(body,compensation_branch,''),case_apply,'') IS DISTINCT FROM f.prosrc
  THEN RAISE EXCEPTION 'z04c_compensation_inverse_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata
  OR (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM 'c30e7398338c7b0a39da7220ea62bffa4d8ae0134f1c7d8b272b09e07736e03e'
  THEN RAISE EXCEPTION 'z04c_compensation_metadata_or_postimage_changed';END IF;
END$z04c$;
COMMIT;
