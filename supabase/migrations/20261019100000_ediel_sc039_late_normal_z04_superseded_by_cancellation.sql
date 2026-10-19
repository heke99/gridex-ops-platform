-- SC-039: preserve the exact normal path and lock order; admit only a prior
-- committed, fully source-bound own C as a causal no-business-effect late L.
BEGIN;
DO $sc039$DECLARE f record;body text;
 old_declaration CONSTANT text:=$sc039_text$ ids uuid[];original_ids uuid[];switch_ids uuid[]:=ARRAY[]::uuid[];pid uuid;event_at timestamptz;customer_identity text;$sc039_text$;
 new_declaration CONSTANT text:=$sc039_text$ ids uuid[];original_ids uuid[];switch_ids uuid[]:=ARRAY[]::uuid[];pid uuid;event_at timestamptz;customer_identity text;
 cancellation_receipt_ids uuid[];$sc039_text$;
 old_status CONSTANT text:=$sc039_text$(sw.status IN('prepared','queued','submitted','sent','waiting','waiting_response','waiting_for_z04','awaiting_confirmation'))$sc039_text$;
 new_status CONSTANT text:=$sc039_text$(sw.status IN('prepared','queued','submitted','sent','waiting','waiting_response','waiting_for_z04','awaiting_confirmation','cancelled_before_start'))$sc039_text$;
 old_owned_reason CONSTANT text:=$sc039_text$THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_owned_signed_contract_scope_required');END IF;$sc039_text$;
 new_owned_reason CONSTANT text:=$sc039_text$THEN RETURN jsonb_build_object('applied',false,'reason',CASE WHEN sw.status='cancelled_before_start' THEN 'normal_z04_locked_original_scope_required' ELSE 'normal_z04_owned_signed_contract_scope_required' END);END IF;$sc039_text$;
 old_anchor CONSTANT text:=$sc039_text$  event_at:=gridex_received_sources.permission_time_v1(own->>'start');$sc039_text$;
 cancellation_guard CONSTANT text:=$sc039_text$  -- A prior committed C may supersede this exact late normal L. No C-row
  -- lock is acquired here: outer source-cohort locks already precede sw/point,
  -- and the no-period C is not necessarily present in that original cohort.
  IF sw.status='cancelled_before_start' THEN
   SELECT array_agg(r.id ORDER BY r.id) INTO cancellation_receipt_ids
   FROM gridex_received_sources.supply_object_effect_receipts r
   JOIN public.ediel_messages c ON c.id=r.source_message_id AND c.company_id=r.company_id
   JOIN gridex_received_sources.supply_object_partitions cp ON cp.source_message_id=c.id AND cp.company_id=c.company_id
   JOIN gridex_received_sources.supply_source_transitions ct ON ct.source_message_id=c.id AND ct.company_id=c.company_id
   JOIN gridex_received_sources.validation_assessments ca ON ca.id=r.canonical_assessment_id AND ca.company_id=c.company_id AND ca.source_message_id=c.id
   JOIN gridex_received_sources.prodat_application_facets cf ON cf.assessment_id=ca.id AND cf.company_id=c.company_id AND cf.source_message_id=c.id
   JOIN gridex_received_sources.prodat_response_facets cr ON cr.assessment_id=ca.id AND cr.company_id=c.company_id AND cr.source_message_id=c.id
   JOIN gridex_ediel_inbound_context.receipts cc ON cc.source_message_id=c.id AND cc.company_id=c.company_id
   JOIN gridex_ediel_source_rules.receipts cb ON cb.source_message_id=c.id AND cb.company_id=c.company_id
   CROSS JOIN LATERAL (SELECT r.effect_text::jsonb facts,gridex_received_sources.supply_wire_for_scope_v1(c.raw_payload,r.object_scope) cwire) proof
   WHERE r.company_id=m.company_id AND r.environment=m.environment AND r.source_message_id=sw.inbound_z04_message_id
    AND r.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296)
    AND jsonb_array_length(wire->'objects')=1 AND plans='[]'::jsonb
    AND c.environment=m.environment AND c.direction='inbound' AND c.message_standard='edifact' AND c.message_family='PRODAT' AND c.message_code='Z04'
    AND (c.customer_id IS NULL OR c.customer_id=sw.customer_id) AND(c.metering_point_id IS NULL OR c.metering_point_id=sw.metering_point_id)
    AND r.payload_hash=encode(sha256(convert_to(c.raw_payload,'UTF8')),'hex') AND r.effect_hash=encode(sha256(convert_to(r.effect_text,'UTF8')),'hex')
    AND r.first_line_index=(r.object_scope#>>'{registers,0,segmentIndex}')::integer
    AND r.object_scope->>'objectId'=own->>'point' AND r.object_scope->>'identityAgency'=own->>'identityAgency'
    AND cp.environment=c.environment AND cp.payload_hash=r.payload_hash AND cp.canonical_assessment_id=ca.id
    AND cp.partition_hash=encode(sha256(convert_to(cp.partition_text,'UTF8')),'hex') AND cp.result->>'applied'='true'
    AND cp.result->'partition'=cp.partition_text::jsonb
    AND cp.result->'effectReceiptIds' @> jsonb_build_array(r.id) AND cp.result->'switchIds' @> jsonb_build_array(sw.id)
    AND EXISTS(SELECT FROM jsonb_array_elements(cp.partition_text::jsonb) part WHERE part->'object'=r.object_scope AND part->>'disposition'='applied' AND part->>'effectReceiptId'=r.id::text AND part->>'effectFactsHash'=r.effect_hash)
    AND ct.payload_hash=r.payload_hash AND ct.source_code='Z04' AND sw.id=ANY(ct.qualified_switch_ids)
    AND ct.source_objects @> jsonb_build_array(proof.facts->'wire') AND ct.resulting_states @> (proof.facts->'resultingStates')
    AND ca.environment=c.environment AND ca.source_payload_hash=r.payload_hash AND ca.owner='canonical-runtime-with-registry-v1'
    AND ca.facts_hash=encode(sha256(convert_to(ca.facts_text,'UTF8')),'hex')
    AND ca.facts_text::jsonb->>'syntaxDecision'='accepted' AND ca.facts_text::jsonb->>'functionalDecision'='accepted'
    AND cf.environment=c.environment AND cf.source_payload_hash=r.payload_hash AND cf.application_facts_hash=encode(sha256(convert_to(cf.application_facts_text,'UTF8')),'hex')
    AND cf.application_facts_text::jsonb->>'headerDecision'='accepted'
    AND cr.environment=c.environment AND cr.source_payload_hash=r.payload_hash AND cr.response_facts_hash=encode(sha256(convert_to(cr.response_facts_text,'UTF8')),'hex')
    AND gridex_received_sources.validate_prodat_application_v1(c.raw_payload,ca.facts_text::jsonb,cf.application_facts_text::jsonb,cr.response_facts_text::jsonb) IS TRUE
    AND EXISTS(SELECT FROM jsonb_array_elements(cf.application_facts_text::jsonb->'objects') app WHERE app-'applicationDecision'-'reasonCodes'=r.object_scope AND app->>'applicationDecision'='accepted')
    AND cc.status='ready' AND cc.environment=c.environment AND cc.direction=c.direction AND cc.source_received_at=c.message_received_at AND cc.payload_sha256=r.payload_hash
    AND cb.environment=c.environment AND cb.direction=c.direction AND cb.payload_sha256=r.payload_hash
    AND ca.facts_text::jsonb->'rulePackEvidence'=jsonb_build_object('profileKey',cb.evidence->'profileKey','messageProfileId',cb.evidence->'messageProfileId','rulePackId',cb.evidence->'rulePackId','sourceHash',cb.evidence->'sourceHash','version',cb.evidence->'version','snapshot',jsonb_build_object('rulePack',cb.evidence#>'{snapshot,rulePack}','messageProfile',cb.evidence#>'{snapshot,messageProfile}','guideSources',cb.evidence#>'{snapshot,guideSources}'))
    AND proof.cwire->>'code'='Z04' AND proof.cwire->>'sender'=wire->>'sender' AND proof.cwire->>'receiver'=wire->>'receiver'
    AND jsonb_array_length(proof.cwire->'objects')=1 AND proof.facts->'wire'=proof.cwire#>'{objects,0}'
    AND proof.facts->>'version'='1' AND proof.facts->>'owner'='inbound-supply-object-v1'
    AND proof.facts->>'sourceMessageId'=c.id::text AND proof.facts->>'sourcePayloadHash'=r.payload_hash
    AND proof.facts->>'companyId'=m.company_id::text AND proof.facts->>'environment'=m.environment AND proof.facts->>'canonicalAssessmentId'=ca.id::text
    AND proof.facts->'object'=r.object_scope AND proof.facts->'legalContext'=cc.context
    AND cc.context->>'actorRole'='electricity_supplier' AND cc.context->>'family'='PRODAT' AND cc.context->>'code'='Z04' AND cc.context->>'legalEdielId'=wire->>'receiver'
    AND proof.facts#>>'{plan,kind}'='cancel_start' AND proof.facts#>>'{plan,switchId}'=sw.id::text AND proof.facts#>'{plan,object}'=proof.facts->'wire'
    AND proof.facts#>>'{wire,reason}'='Z24' AND proof.facts#>>'{wire,point}'=own->>'point' AND proof.facts#>>'{wire,identityAgency}'=own->>'identityAgency'
    AND proof.facts#>>'{wire,li}'=own->>'li' AND proof.facts#>>'{wire,customerIdentity}'=own->>'customerIdentity' AND proof.facts#>>'{wire,gridArea}'=own->>'gridArea' AND proof.facts#>>'{wire,start}'=own->>'start'
    AND EXISTS(SELECT FROM jsonb_array_elements(proof.facts->'resultingSwitches') cancelled WHERE cancelled->>'id'=sw.id::text AND cancelled->>'company_id'=m.company_id::text
     AND cancelled->>'customer_id'=sw.customer_id::text AND cancelled->>'metering_point_id'=sw.metering_point_id::text AND cancelled->>'outbound_z03_message_id'=original.id::text
     AND cancelled->>'rff_li_reference'=own->>'li' AND cancelled->>'status'='cancelled_before_start' AND cancelled->>'inbound_z04_message_id'=c.id::text);
   IF coalesce(cardinality(cancellation_receipt_ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_locked_original_scope_required');END IF;
   -- The caller records L's OWN receipt/partition/transition, with zero
   -- relationship projections. cancelledSwitchId is causal data, not switchId.
   RETURN jsonb_build_object('applied',true,'idempotent',false,'periods','[]'::jsonb,'switchIds','[]'::jsonb,'commits','[]'::jsonb,'previousStates','[]'::jsonb,'previousSwitches','[]'::jsonb,
    'plans',jsonb_build_array(jsonb_build_object('kind','superseded_by_cancellation','cancelledSwitchId',sw.id,'originalId',original.id,'originalHash',original.immutable_payload_hash,'cancellationSourceMessageId',sw.inbound_z04_message_id,'cancellationEffectReceiptId',cancellation_receipt_ids[1])));
  END IF;
$sc039_text$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition
 INTO STRICT f FROM pg_proc p
 WHERE p.oid='gridex_received_sources.normal_switch_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'd1e509b5ae3a36f5f585fb723364e8df295088da484ea8baf62aa0d841adf014'
  OR (length(f.prosrc)-length(replace(f.prosrc,old_declaration,'')))/length(old_declaration)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,old_status,'')))/length(old_status)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,old_anchor,'')))/length(old_anchor)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,old_owned_reason,'')))/length(old_owned_reason)<>1
  THEN RAISE EXCEPTION 'sc039_late_normal_predecessor_required';END IF;
 body:=replace(replace(replace(replace(f.prosrc,old_declaration,new_declaration),old_status,new_status),old_anchor,cancellation_guard||old_anchor),old_owned_reason,new_owned_reason);
 IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM '546ea4dff4b007a589eb84236f081851c641a60f357398b1365f5249cd78ab19'
  OR replace(replace(replace(replace(body,new_owned_reason,old_owned_reason),cancellation_guard,''),new_status,old_status),new_declaration,old_declaration) IS DISTINCT FROM f.prosrc
  THEN RAISE EXCEPTION 'sc039_late_normal_inverse_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata
  OR (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM '546ea4dff4b007a589eb84236f081851c641a60f357398b1365f5249cd78ab19'
  THEN RAISE EXCEPTION 'sc039_late_normal_metadata_or_postimage_changed';END IF;
END$sc039$;
COMMIT;
