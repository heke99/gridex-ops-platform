-- ACK08/P85–87: first effects consume complete own canonical application scope,
-- unchanged global function authority and independently qualified business facts.
-- Original wire and established source/ACK outcomes are never rewritten.
BEGIN;
CREATE TABLE gridex_received_sources.supply_object_partitions(
 source_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),company_id uuid NOT NULL,environment text NOT NULL,
 payload_hash text NOT NULL,canonical_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id),
 partition_text text NOT NULL,partition_hash text NOT NULL CHECK(partition_hash=encode(sha256(convert_to(partition_text,'UTF8')),'hex')),
 result jsonb NOT NULL,actor_user_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE gridex_received_sources.supply_object_effect_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_message_id uuid NOT NULL REFERENCES gridex_received_sources.supply_object_partitions(source_message_id) DEFERRABLE INITIALLY DEFERRED,
 company_id uuid NOT NULL,environment text NOT NULL,payload_hash text NOT NULL,canonical_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id),
 first_line_index integer NOT NULL,object_scope jsonb NOT NULL,effect_text text NOT NULL,effect_hash text NOT NULL CHECK(effect_hash=encode(sha256(convert_to(effect_text,'UTF8')),'hex')),
 applied_at timestamptz NOT NULL DEFAULT now(),UNIQUE(source_message_id,first_line_index));
ALTER TABLE gridex_received_sources.supply_object_partitions ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_received_sources.supply_object_partitions FORCE ROW LEVEL SECURITY;
ALTER TABLE gridex_received_sources.supply_object_effect_receipts ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_received_sources.supply_object_effect_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_received_sources.supply_object_partitions,gridex_received_sources.supply_object_effect_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_received_sources.supply_object_partitions FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_sources.supply_object_partitions FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_received_sources.supply_object_effect_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_sources.supply_object_effect_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();

-- Physical projection only. The complete canonical scope owns grouping and its
-- first register owns common fields; another LIN can never donate missing data.
CREATE FUNCTION gridex_received_sources.supply_wire_for_scope_v1(raw text,scope jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(raw);t jsonb;e jsonb;header jsonb:='{}';own jsonb;first_index integer;last_index integer;key text;value text;characteristic text;
BEGIN
 IF tokens IS NULL OR scope->>'messageIndex' IS DISTINCT FROM '0' OR jsonb_typeof(scope->'registers') IS DISTINCT FROM 'array' OR jsonb_array_length(scope->'registers')<1 THEN RETURN NULL;END IF;
 first_index:=(scope#>>'{registers,0,segmentIndex}')::integer;
 SELECT x INTO t FROM jsonb_array_elements(tokens)x WHERE x->>'index'=first_index::text AND x->>'tag'='LIN';
 IF t IS NULL OR t#>>'{elements,3,0}' IS DISTINCT FROM scope->>'objectId' OR t#>>'{elements,3,3}' IS DISTINCT FROM scope->>'identityAgency' THEN RETURN NULL;END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(scope->'registers')r WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='LIN' AND x->>'index'=r->>'segmentIndex' AND x#>>'{elements,3,0}'=scope->>'objectId' AND x#>>'{elements,3,3}'=scope->>'identityAgency')) THEN RETURN NULL;END IF;
 SELECT min((x->>'index')::integer) INTO last_index FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='LIN' AND (x->>'index')::integer>first_index;
 IF(SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='BGM')<>1 OR(SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH')<>1 THEN RETURN NULL;END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens)x WHERE(x->>'index')::integer<(SELECT min((first_lin->>'index')::integer) FROM jsonb_array_elements(tokens)first_lin WHERE first_lin->>'tag'='LIN') AND x->>'tag' IN('BGM','NAD') ORDER BY(x->>'index')::integer LOOP
  e:=t->'elements';IF t->>'tag'='BGM' THEN header:=header||jsonb_build_object('code',e#>>'{1,0}','bgmId',e#>>'{2,0}');END IF;
  IF t->>'tag'='NAD' AND e#>>'{1,0}' IN('FR','DO') THEN key:=CASE e#>>'{1,0}' WHEN 'FR' THEN 'sender' ELSE 'receiver' END;IF header?key OR e#>>'{2,1}' IS DISTINCT FROM '160' OR e#>>'{2,2}' IS DISTINCT FROM 'SVK' THEN RETURN NULL;END IF;header:=header||jsonb_build_object(key,e#>>'{2,0}');END IF;
 END LOOP;
 -- Only message-header parties precede the FIRST physical LIN. Later objects
 -- must not expose an earlier object's NAD as a second message header.
 IF nullif(header->>'sender','') IS NULL OR nullif(header->>'receiver','') IS NULL OR(header->>'code' IN('Z04','Z05')) IS NOT TRUE THEN RETURN NULL;END IF;
 SELECT x INTO t FROM jsonb_array_elements(tokens)x WHERE x->>'index'=first_index::text;
 own:=jsonb_build_object('point',scope->>'objectId','identityAgency',scope->>'identityAgency','line',t#>>'{elements,1,0}','registerCount',jsonb_array_length(scope->'registers'));
 FOR t IN SELECT x FROM jsonb_array_elements(tokens)x WHERE(x->>'index')::integer>first_index AND(last_index IS NULL OR(x->>'index')::integer<last_index) ORDER BY(x->>'index')::integer LOOP
  e:=t->'elements';key:=NULL;value:=NULL;
  IF t->>'tag'='RFF' AND e#>>'{1,0}' IN('LI','Z05','Z07') THEN key:=CASE e#>>'{1,0}' WHEN 'LI' THEN 'li' WHEN 'Z05' THEN 'gridArea' ELSE 'consumptionPoint' END;value:=e#>>'{1,1}';
  ELSIF t->>'tag'='NAD' AND e#>>'{1,0}'='UD' THEN key:='customerIdentity';value:=e#>>'{2,0}';
  ELSIF t->>'tag'='DTM' AND e#>>'{1,0}' IN('92','93') THEN IF e#>>'{1,2}' IS DISTINCT FROM '203' THEN RETURN NULL;END IF;key:=CASE e#>>'{1,0}' WHEN '92' THEN 'start' ELSE 'end' END;value:=e#>>'{1,1}';
  ELSIF t->>'tag'='CCI' THEN characteristic:=e#>>'{2,0}';
  ELSIF t->>'tag'='CAV' THEN key:=CASE characteristic WHEN 'Z13' THEN 'reason' WHEN 'Z23' THEN 'status' END;value:=e#>>'{1,0}';END IF;
  IF key IS NOT NULL THEN IF own?key THEN RETURN NULL;END IF;own:=own||jsonb_build_object(key,nullif(value,''));END IF;
 END LOOP;
 RETURN header||jsonb_build_object('objects',jsonb_build_array(own));
END$$;

CREATE FUNCTION gridex_received_sources.require_supply_scope_admission_v1(c uuid,source_id uuid,scope jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;a gridex_received_sources.validation_assessments%rowtype;application jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE company_id=c AND id=source_id FOR UPDATE;
 application:=gridex_received_sources.require_prodat_application_objects_v1(c,source_id);
 SELECT * INTO a FROM gridex_received_sources.validation_assessments WHERE company_id=c AND source_message_id=source_id AND id=(application->>'assessmentId')::uuid FOR SHARE;
 IF m.id IS NULL OR a.id IS NULL OR a.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR a.environment IS DISTINCT FROM m.environment
  OR a.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR a.facts_text::jsonb->>'functionalDecision' IS DISTINCT FROM 'accepted'
  OR gridex_received_sources.prodat_application_object_accepted_v1(c,source_id,a.id,scope) IS NOT TRUE THEN RAISE EXCEPTION 'supply_own_canonical_application_and_function_required';END IF;
 RETURN a.id;
END$$;

CREATE FUNCTION gridex_received_sources.supply_wire_for_period_receipt_v1(c uuid,source_id uuid,period_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;r gridex_received_sources.supply_object_effect_receipts%rowtype;wire jsonb;BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c;
 SELECT e.* INTO r FROM gridex_received_sources.supply_object_effect_receipts e WHERE e.company_id=c AND e.source_message_id=source_id AND e.environment=m.environment
  AND e.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296)
  AND e.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND e.effect_hash=encode(sha256(convert_to(e.effect_text,'UTF8')),'hex')
  AND EXISTS(SELECT FROM jsonb_array_elements(e.effect_text::jsonb->'resultingStates')state WHERE state->>'id'=period_id::text);
 IF r.id IS NULL OR r.effect_text::jsonb->>'owner' IS DISTINCT FROM 'inbound-supply-object-v1' OR r.effect_text::jsonb->'object' IS DISTINCT FROM r.object_scope THEN RETURN NULL;END IF;
 wire:=gridex_received_sources.supply_wire_for_scope_v1(m.raw_payload,r.object_scope);
 IF wire#>'{objects,0}' IS DISTINCT FROM r.effect_text::jsonb->'wire' THEN RETURN NULL;END IF;RETURN wire;
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.supply_wire_for_period_receipt_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Adapt the actual business owners to one already admitted physical scope.
-- All their original/ground/current relationship checks and writes remain.
-- No public or service role can call this private scoped adapter directly.
DO $$DECLARE body text;old text;new text;signature regprocedure;BEGIN
 signature:='gridex_received_sources.normal_switch_confirm_v1(uuid,uuid,uuid)'::regprocedure;
 SELECT pg_get_functiondef(signature) INTO body;
 body:=replace(body,'normal_switch_confirm_v1(p_company_id uuid, p_source_message_id uuid, p_actor_user_id uuid)','normal_switch_scope_effect_v1(p_company_id uuid, p_source_message_id uuid, p_actor_user_id uuid, p_scope jsonb, p_source_cohort uuid[], p_canonical_id uuid)');
 IF strpos(body,'normal_switch_scope_effect_v1')=0 THEN RAISE EXCEPTION 'normal_supply_scope_adapter_signature_changed';END IF;
 old:='SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;';
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'normal_supply_scope_adapter_source_changed';END IF;
 body:=replace(body,old,old||' IF gridex_received_sources.require_supply_scope_admission_v1(p_company_id,p_source_message_id,p_scope) IS DISTINCT FROM p_canonical_id THEN RAISE EXCEPTION ''supply_scoped_canonical_assessment_changed'';END IF; IF jsonb_array_length(gridex_received_sources.require_prodat_application_objects_v1(p_company_id,p_source_message_id)->''objects'')>1 THEN m.customer_id:=NULL;m.metering_point_id:=NULL;END IF;');
 old:=' OR canonical.facts_text::jsonb->>''applicationDecision'' IS DISTINCT FROM ''accepted''';
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'normal_supply_scope_adapter_application_changed';END IF;body:=replace(body,old,'');
 body:=replace(body,'IF canonical.facts_text::jsonb->>''syntaxDecision''', 'IF canonical.id IS DISTINCT FROM p_canonical_id OR canonical.facts_text::jsonb->>''syntaxDecision''');
 body:=replace(body,'wire:=gridex_received_sources.normal_switch_wire_v1(m.raw_payload);','wire:=gridex_received_sources.supply_wire_for_scope_v1(m.raw_payload,p_scope);');
 old:=$old$AND (o->>'point' IS NULL OR o->>'point'=own->>'point')$old$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'normal_supply_scope_original_namespace_changed';END IF;
 new:=$new$AND (o->>'point' IS NULL OR o->>'point'=own->>'point') AND(o->>'point' IS NULL OR o->>'identityAgency'=own->>'identityAgency')$new$;
 body:=replace(body,old,new);

 old:=' OR jsonb_array_length(canonical.facts_text::jsonb#>''{registerValidation,objects}'')<>jsonb_array_length(wire->''objects'')';
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'normal_supply_scope_adapter_partition_changed';END IF;body:=replace(body,old,'');
 old:=$old$ INSERT INTO gridex_received_sources.supply_source_transitions(source_message_id,company_id,payload_hash,source_code,source_objects,previous_states,resulting_states,qualified_switch_ids,actor_user_id) VALUES(m.id,m.company_id,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'Z04',wire->'objects','[]',after_states,switch_ids,p_actor_user_id);$old$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'normal_supply_scope_adapter_transition_changed';END IF;body:=replace(body,old,'');
 IF strpos(body,'''periods'',after_states,''switchIds'',switch_ids,''commits''')=0 THEN RAISE EXCEPTION 'normal_supply_scoped_result_shape_changed';END IF;
 body:=replace(body,'''periods'',after_states,''switchIds'',switch_ids,''commits''','''periods'',after_states,''switchIds'',switch_ids,''plans'',plans,''previousStates'',''[]''::jsonb,''previousSwitches'',before_switches,''commits''');
 old:='PERFORM z.id FROM public.ediel_messages z WHERE z.company_id=m.company_id AND z.id=ANY(original_ids) ORDER BY z.id FOR SHARE;';
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'normal_supply_original_cohort_shape_changed';END IF;
 body:=replace(body,old,'IF EXISTS(SELECT FROM unnest(original_ids) id WHERE NOT(id=ANY(p_source_cohort))) THEN RETURN jsonb_build_object(''applied'',false,''reason'',''supply_original_cohort_changed'');END IF;'||old);
 old:='SELECT * INTO original FROM public.ediel_messages WHERE id=sw.outbound_z03_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;';
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'normal_supply_current_original_cohort_shape_changed';END IF;
 body:=replace(body,old,'IF coalesce(sw.outbound_z03_message_id=ANY(p_source_cohort),false) IS NOT TRUE THEN RETURN jsonb_build_object(''applied'',false,''reason'',''supply_original_cohort_changed'');END IF;'||old);
 EXECUTE body;
 signature:='gridex_received_sources.apply_supply_before_legal_context_v1(uuid,uuid,uuid)'::regprocedure;SELECT pg_get_functiondef(signature) INTO body;
 body:=replace(body,'apply_supply_before_legal_context_v1(p_company_id uuid, p_source_message_id uuid, p_actor_user_id uuid)','other_supply_scope_effect_v1(p_company_id uuid, p_source_message_id uuid, p_actor_user_id uuid, p_scope jsonb, p_source_cohort uuid[], p_canonical_id uuid)');
 IF strpos(body,'other_supply_scope_effect_v1')=0 THEN RAISE EXCEPTION 'other_supply_scope_adapter_signature_changed';END IF;
 old:='SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;';IF strpos(body,old)=0 THEN RAISE EXCEPTION 'other_supply_scope_adapter_source_changed';END IF;body:=replace(body,old,old||' IF gridex_received_sources.require_supply_scope_admission_v1(p_company_id,p_source_message_id,p_scope) IS DISTINCT FROM p_canonical_id THEN RAISE EXCEPTION ''supply_scoped_canonical_assessment_changed'';END IF; IF jsonb_array_length(gridex_received_sources.require_prodat_application_objects_v1(p_company_id,p_source_message_id)->''objects'')>1 THEN m.customer_id:=NULL;m.metering_point_id:=NULL;END IF;');
 old:=' AND v.facts_text::jsonb->>''applicationDecision''=''accepted''';IF strpos(body,old)=0 THEN RAISE EXCEPTION 'other_supply_scope_adapter_application_changed';END IF;body:=replace(body,old,'');
 body:=replace(body,'WHERE v.source_message_id=m.id AND v.company_id=m.company_id', 'WHERE v.id=p_canonical_id AND v.source_message_id=m.id AND v.company_id=m.company_id');
 body:=replace(body,'wire:=gridex_received_sources.supply_wire_v1(m.raw_payload);','wire:=gridex_received_sources.supply_wire_for_scope_v1(m.raw_payload,p_scope);');
 body:=replace(body,'original:=gridex_received_sources.supply_wire_v1(origin.raw_payload);','original:=coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(m.company_id,origin.id,sp.id),gridex_received_sources.normal_switch_wire_v1(origin.raw_payload));');
 body:=replace(body,'gridex_received_sources.supply_wire_v1(z.raw_payload)','gridex_received_sources.normal_switch_wire_v1(z.raw_payload)');
 body:=replace(body,$old$o->>'point'=own->>'point' AND o->>'li'=own->>'li'$old$,$new$o->>'point'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency' AND o->>'li'=own->>'li'$new$);
 body:=replace(body,$old$o->>'point'=own->>'point' AND o->>'customerIdentity'=own->>'customerIdentity'$old$,$new$o->>'point'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency' AND o->>'customerIdentity'=own->>'customerIdentity'$new$);
 old:=$old$tr.payload_hash=encode(sha256(convert_to(z.raw_payload,'UTF8')),'hex') AND gridex_received_sources.normal_switch_wire_v1(z.raw_payload)->>'sender'=wire->>'sender' AND gridex_received_sources.normal_switch_wire_v1(z.raw_payload)->>'receiver'=wire->>'receiver'$old$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'supply_ending_original_wire_shape_changed';END IF;
 new:=replace(old,'gridex_received_sources.normal_switch_wire_v1(z.raw_payload)','coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p.company_id,z.id,p.id),gridex_received_sources.normal_switch_wire_v1(z.raw_payload))')||$new$ AND EXISTS(SELECT FROM jsonb_array_elements(coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p.company_id,z.id,p.id),gridex_received_sources.normal_switch_wire_v1(z.raw_payload))->'objects') original_scope WHERE original_scope->>'point'=own->>'point' AND original_scope->>'identityAgency'=own->>'identityAgency')$new$;
 body:=replace(body,old,new);
 body:=replace(body,$old$jsonb_array_elements(tr.source_objects) o WHERE o->>'point'=own->>'point' AND o->>'identityAgency'=own->>'identityAgency' AND o->>'li'=own->>'li'$old$,$new$jsonb_array_elements(tr.source_objects) o WHERE o->>'point'=own->>'point' AND o->>'li'=own->>'li'$new$);
 old:=$old$AND object->>'reason' IN ('Z26','Z70')$old$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'supply_own_effect_baseline_adapter_changed';END IF;
 new:=$new$AND (object->>'reason' IN ('Z26','Z70') OR object->>'reason' IN ('Z22','Z23') AND EXISTS(SELECT FROM gridex_received_sources.supply_object_effect_receipts own_effect WHERE own_effect.company_id=p.company_id AND own_effect.source_message_id=tr.source_message_id AND own_effect.object_scope->>'objectId'=own->>'point' AND own_effect.object_scope->>'identityAgency'=own->>'identityAgency' AND gridex_received_sources.supply_effect_assessment_owns_period_v1(p.company_id,tr.source_message_id,p.id,own_effect.canonical_assessment_id)))$new$;
 body:=replace(body,old,new);

 old:=$old$state->>'metering_point_id'=p.metering_point_id::text)$old$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'supply_own_effect_period_object_adapter_changed';END IF;
 new:=$new$state->>'metering_point_id'=p.metering_point_id::text AND(state#>>'{metadata,sourceObject,point}'=own->>'point' OR state#>>'{metadata,normalSourceBasis,object,point}'=own->>'point'))$new$;
 body:=replace(body,old,new);

 old:=$old$ INSERT INTO gridex_received_sources.supply_source_transitions(source_message_id,company_id,payload_hash,source_code,source_objects,previous_states,resulting_states,qualified_switch_ids,actor_user_id) VALUES(m.id,m.company_id,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),wire->>'code',wire->'objects',before_states,after_states,ARRAY(SELECT (plan->>'switchId')::uuid FROM jsonb_array_elements(plans) plan WHERE plan->>'kind'='cancel_start'),p_actor_user_id);$old$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'other_supply_scope_adapter_transition_changed';END IF;body:=replace(body,old,'');

 old:=$old$(SELECT (plan->>'periodId')::uuid FROM jsonb_array_elements(plans) plan)$old$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'other_supply_scope_adapter_period_projection_changed';END IF;
 body:=replace(body,old,$new$(SELECT (chosen_plan->>'periodId')::uuid FROM jsonb_array_elements(plans) chosen_plan)$new$);
 IF strpos(body,'before_states jsonb:=''[]'';')=0 OR strpos(body,'''periods'',after_states,''regulated''')=0 THEN RAISE EXCEPTION 'other_supply_scoped_result_shape_changed';END IF;
 body:=replace(body,'before_states jsonb:=''[]'';','before_states jsonb:=''[]'';previous_switches jsonb:=''[]'';');
 old:='SELECT * INTO origin FROM public.ediel_messages WHERE id=sw.outbound_z03_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;';
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'other_supply_original_cohort_shape_changed';END IF;
 body:=replace(body,old,'IF coalesce(sw.outbound_z03_message_id=ANY(p_source_cohort),false) IS NOT TRUE THEN RETURN jsonb_build_object(''applied'',false,''reason'',''supply_original_cohort_changed'');END IF;'||old);
 old:='SELECT * INTO origin FROM public.ediel_messages WHERE id=sp.source_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;';
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'other_supply_baseline_cohort_shape_changed';END IF;
 body:=replace(body,old,'IF coalesce(sp.source_message_id=ANY(p_source_cohort),false) IS NOT TRUE THEN RETURN jsonb_build_object(''applied'',false,''reason'',''supply_original_cohort_changed'');END IF;'||old);
 old:='SELECT * INTO prior FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=sp.source_end_message_id AND company_id=m.company_id;';
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'other_supply_ending_cohort_shape_changed';END IF;
 body:=replace(body,old,'IF coalesce(sp.source_end_message_id=ANY(p_source_cohort),false) IS NOT TRUE THEN RETURN jsonb_build_object(''applied'',false,''reason'',''supply_original_cohort_changed'');END IF;'||old);
 old:=$old$plans:=plans||jsonb_build_array(jsonb_build_object('kind','cancel_start'$old$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'other_supply_switch_snapshot_shape_changed';END IF;
 body:=replace(body,old,'previous_switches:=previous_switches||jsonb_build_array(to_jsonb(sw));'||old);
 body:=replace(body,'''periods'',after_states,''regulated''','''periods'',after_states,''plans'',plans,''previousStates'',before_states,''previousSwitches'',previous_switches,''regulated''');
 EXECUTE body;
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.supply_wire_for_scope_v1(text,jsonb),gridex_received_sources.require_supply_scope_admission_v1(uuid,uuid,jsonb),gridex_received_sources.normal_switch_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid),gridex_received_sources.other_supply_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) SET SCHEMA gridex_received_sources;
ALTER FUNCTION gridex_received_sources.ediel_apply_supply_source_v1(uuid,uuid,uuid) RENAME TO apply_supply_before_own_partition_v1;
REVOKE ALL ON FUNCTION gridex_received_sources.apply_supply_before_own_partition_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_apply_supply_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;old_partition gridex_received_sources.supply_object_partitions%rowtype;application jsonb;canonical uuid;context jsonb;scope jsonb;entry jsonb;wire jsonb;own jsonb;
 result jsonb;partition jsonb:='[]';periods jsonb:='[]';previous_states jsonb:='[]';source_objects jsonb:='[]';switch_ids uuid[]:=ARRAY[]::uuid[];source_ids uuid[];
 effect jsonb;effect_id uuid;effect_hash text;old_state jsonb;plan jsonb;raw_hash text;register_indices integer[];all_indices integer[];receipt_ids uuid[]:=ARRAY[]::uuid[];outcome jsonb;applied_count integer:=0;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'supply_service_required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR(m.message_code IN('Z04','Z05')) IS NOT TRUE THEN RETURN gridex_received_sources.apply_supply_before_own_partition_v1(p_company_id,p_source_message_id,p_actor_user_id);END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.user_id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','supply_execution_actor_unqualified');END IF;
 raw_hash:=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
 -- Established first outcomes precede today's source selection. Historical
 -- global receipts remain their own truth, never prospectively backfilled.
 SELECT * INTO old_partition FROM gridex_received_sources.supply_object_partitions WHERE source_message_id=m.id;
 IF old_partition.source_message_id IS NOT NULL THEN
  IF old_partition.company_id IS DISTINCT FROM m.company_id OR old_partition.environment IS DISTINCT FROM m.environment OR old_partition.payload_hash IS DISTINCT FROM raw_hash THEN RAISE EXCEPTION 'supply_partition_replay_conflict';END IF;
  RETURN old_partition.result||jsonb_build_object('idempotent',true);
 END IF;
 IF EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions WHERE source_message_id=m.id) THEN RETURN gridex_received_sources.apply_supply_before_own_partition_v1(p_company_id,p_source_message_id,p_actor_user_id);END IF;
 context:=gridex_ediel_inbound_context.require_v1(m.company_id,m.id);
 PERFORM gridex_ediel_source_rules.require_v1(m.company_id,m.id);
 IF context->>'actorRole' IS DISTINCT FROM 'electricity_supplier' OR context->>'family' IS DISTINCT FROM 'PRODAT' OR context->>'code' IS DISTINCT FROM m.message_code THEN RETURN jsonb_build_object('applied',false,'reason','supply_frozen_legal_context_required');END IF;
 application:=gridex_received_sources.require_prodat_application_objects_v1(m.company_id,m.id);
 canonical:=(application->>'assessmentId')::uuid;
 IF application->>'headerDecision' IS DISTINCT FROM 'accepted' OR jsonb_typeof(application->'objects') IS DISTINCT FROM 'array' OR jsonb_array_length(application->'objects') NOT BETWEEN 1 AND 8192
  OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments a WHERE a.id=canonical AND a.source_message_id=m.id AND a.company_id=m.company_id AND a.environment=m.environment AND a.source_payload_hash=raw_hash AND a.facts_text::jsonb->>'syntaxDecision'='accepted' AND a.facts_text::jsonb->>'functionalDecision'='accepted') THEN RETURN jsonb_build_object('applied',false,'reason','supply_complete_own_application_and_function_required');END IF;
 SELECT array_agg((r->>'segmentIndex')::integer ORDER BY(r->>'segmentIndex')::integer) INTO register_indices FROM jsonb_array_elements(application->'objects')o CROSS JOIN LATERAL jsonb_array_elements(o->'registers')r;
 SELECT array_agg((t->>'index')::integer ORDER BY(t->>'index')::integer) INTO all_indices FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v2(m.raw_payload))t WHERE t->>'tag'='LIN';
 IF register_indices IS DISTINCT FROM all_indices OR cardinality(register_indices)<>(SELECT count(DISTINCT r) FROM unnest(register_indices)r) THEN RETURN jsonb_build_object('applied',false,'reason','supply_complete_physical_partition_required');END IF;
 -- Lock the whole discoverable source cohort before switch/period/point rows.
 -- A later baseline revision fails exact owner checks rather than acquiring a
 -- newly selected source after its dependent period has already been locked.
 SELECT array_agg(DISTINCT id ORDER BY id) INTO source_ids FROM(
  SELECT s.outbound_z03_message_id id FROM public.supplier_switch_requests s WHERE s.company_id=m.company_id AND EXISTS(SELECT FROM jsonb_array_elements(application->'objects')o WHERE o->>'objectId'=(SELECT p.ediel_metering_point_id FROM public.metering_points p WHERE p.id=s.metering_point_id AND p.company_id=s.company_id))
  UNION SELECT p.source_message_id FROM public.customer_supply_periods p JOIN public.metering_points mp ON mp.id=p.metering_point_id AND mp.company_id=p.company_id WHERE p.company_id=m.company_id AND EXISTS(SELECT FROM jsonb_array_elements(application->'objects')o WHERE o->>'objectId'=mp.ediel_metering_point_id)
  UNION SELECT p.source_end_message_id FROM public.customer_supply_periods p JOIN public.metering_points mp ON mp.id=p.metering_point_id AND mp.company_id=p.company_id WHERE p.company_id=m.company_id AND EXISTS(SELECT FROM jsonb_array_elements(application->'objects')o WHERE o->>'objectId'=mp.ediel_metering_point_id))discovered WHERE id IS NOT NULL;
 PERFORM z.id FROM public.ediel_messages z WHERE z.company_id=m.company_id AND z.id=ANY(source_ids) ORDER BY z.id FOR UPDATE;
 FOR entry IN SELECT o FROM jsonb_array_elements(application->'objects')o ORDER BY(o#>>'{registers,0,segmentIndex}')::integer LOOP
  scope:=entry-'applicationDecision'-'reasonCodes';result:=NULL;wire:=NULL;own:=NULL;effect_id:=NULL;
  IF gridex_received_sources.prodat_application_object_accepted_v1(m.company_id,m.id,canonical,scope) IS NOT TRUE THEN
   partition:=partition||jsonb_build_array(jsonb_build_object('object',scope,'disposition','held','reason','own_application_not_accepted'));CONTINUE;
  END IF;
  -- Two separately represented scopes for the same physical point cannot
  -- compete for one relationship. All remain held, including the first one.
  IF(SELECT count(*) FROM jsonb_array_elements(application->'objects')o WHERE o->>'objectId'=scope->>'objectId')<>1 THEN
   partition:=partition||jsonb_build_array(jsonb_build_object('object',scope,'disposition','held','reason','ambiguous_physical_supply_scope'));CONTINUE;
  END IF;
  wire:=gridex_received_sources.supply_wire_for_scope_v1(m.raw_payload,scope);own:=wire#>'{objects,0}';
  IF wire IS NULL OR wire->>'code' IS DISTINCT FROM m.message_code OR wire->>'receiver' IS DISTINCT FROM context->>'legalEdielId' THEN
   partition:=partition||jsonb_build_array(jsonb_build_object('object',scope,'disposition','held','reason','own_supply_wire_or_legal_scope_unavailable'));CONTINUE;
  END IF;
  -- Each private adapter has no effect until its original complete business
  -- checks pass. A failed returned qualification has performed no writes.
  IF m.message_code='Z04' AND own->>'reason' IN('Z22','Z23') THEN
   result:=gridex_received_sources.normal_switch_scope_effect_v1(m.company_id,m.id,p_actor_user_id,scope,coalesce(source_ids,ARRAY[]::uuid[]),canonical);
  ELSE result:=gridex_received_sources.other_supply_scope_effect_v1(m.company_id,m.id,p_actor_user_id,scope,coalesce(source_ids,ARRAY[]::uuid[]),canonical);END IF;
  IF result->>'applied' IS DISTINCT FROM 'true' THEN
   partition:=partition||jsonb_build_array(jsonb_build_object('object',scope,'disposition','held','reason',coalesce(result->>'reason','own_supply_business_unqualified')));CONTINUE;
  END IF;
  IF jsonb_typeof(result->'plans') IS DISTINCT FROM 'array' OR jsonb_array_length(result->'plans')<>1 OR jsonb_typeof(result->'periods') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'supply_scoped_business_receipt_required';END IF;
  plan:=result#>'{plans,0}';
  -- Exact effects are frozen in the same transaction as the actual source write.
  effect:=jsonb_build_object('version',1,'owner','inbound-supply-object-v1','sourceMessageId',m.id,'sourcePayloadHash',raw_hash,'companyId',m.company_id,'environment',m.environment,'canonicalAssessmentId',canonical,'object',scope,'wire',own,'legalContext',context,'plan',plan,'previousStates',coalesce(result->'previousStates','[]'::jsonb),'resultingStates',result->'periods','previousSwitches',coalesce(result->'previousSwitches','[]'::jsonb),'resultingSwitches',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM public.supplier_switch_requests s WHERE s.company_id=m.company_id AND s.id=(plan->>'switchId')::uuid),'[]'::jsonb));
  effect_hash:=encode(sha256(convert_to(effect::text,'UTF8')),'hex');
  INSERT INTO gridex_received_sources.supply_object_effect_receipts(source_message_id,company_id,environment,payload_hash,canonical_assessment_id,first_line_index,object_scope,effect_text,effect_hash)
   VALUES(m.id,m.company_id,m.environment,raw_hash,canonical,(scope#>>'{registers,0,segmentIndex}')::integer,scope,effect::text,effect_hash) RETURNING id INTO effect_id;
  receipt_ids:=array_append(receipt_ids,effect_id);applied_count:=applied_count+1;periods:=periods||(result->'periods');previous_states:=previous_states||coalesce(result->'previousStates','[]'::jsonb);source_objects:=source_objects||jsonb_build_array(own);
  IF plan->>'switchId' IS NOT NULL THEN switch_ids:=array_append(switch_ids,(plan->>'switchId')::uuid);END IF;
  partition:=partition||jsonb_build_array(jsonb_build_object('object',scope,'disposition','applied','effectReceiptId',effect_id,'effectFactsHash',effect_hash));
 END LOOP;
 -- No object was applied: preserve the source as held without minting an effect
 -- or preventing a later independently qualified source review.
 IF applied_count=0 THEN RETURN jsonb_build_object('applied',false,'reason','no_qualified_supply_objects','partition',partition,'periods','[]'::jsonb,'commits','[]'::jsonb);END IF;
 outcome:=jsonb_build_object('applied',true,'idempotent',false,'periods',periods,'partition',partition,'effectReceiptIds',to_jsonb(receipt_ids),'switchIds',to_jsonb(switch_ids),'commits',
  coalesce((SELECT jsonb_agg(jsonb_build_object('switchRequestId',switch_id,'supplyPeriodId',period_id,'customerId',confirmed_period->>'customer_id','meteringPointId',confirmed_period->>'metering_point_id','siteId',coalesce(confirmed_switch->>'site_id',confirmed_switch->>'customer_site_id'))) FROM gridex_received_sources.normal_switch_confirmations WHERE source_message_id=m.id AND company_id=m.company_id),'[]'::jsonb));
 INSERT INTO gridex_received_sources.supply_source_transitions(source_message_id,company_id,payload_hash,source_code,source_objects,previous_states,resulting_states,qualified_switch_ids,actor_user_id) VALUES(m.id,m.company_id,raw_hash,m.message_code,source_objects,previous_states,periods,switch_ids,p_actor_user_id);
 INSERT INTO gridex_received_sources.supply_object_partitions(source_message_id,company_id,environment,payload_hash,canonical_assessment_id,partition_text,partition_hash,result,actor_user_id) VALUES(m.id,m.company_id,m.environment,raw_hash,canonical,partition::text,encode(sha256(convert_to(partition::text,'UTF8')),'hex'),outcome,p_actor_user_id);
 RETURN outcome;
END$$;
REVOKE ALL ON FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION public.ediel_apply_supply_source_v1(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION gridex_received_sources.supply_effect_assessment_owns_period_v1(c uuid,source_id uuid,period_id uuid,canonical_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r gridex_received_sources.supply_object_effect_receipts%rowtype;m public.ediel_messages%rowtype;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c;
 SELECT stored.* INTO r FROM gridex_received_sources.supply_object_effect_receipts stored WHERE stored.company_id=c AND stored.source_message_id=source_id AND stored.canonical_assessment_id=canonical_id AND stored.environment=m.environment
  AND stored.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296)
  AND stored.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND stored.effect_hash=encode(sha256(convert_to(stored.effect_text,'UTF8')),'hex')
  AND EXISTS(SELECT FROM jsonb_array_elements(stored.effect_text::jsonb->'resultingStates')state WHERE state->>'id'=period_id::text);
 RETURN r.id IS NOT NULL AND r.effect_text::jsonb->>'owner'='inbound-supply-object-v1' AND r.effect_text::jsonb->'object'=r.object_scope
  AND EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions tr WHERE tr.company_id=c AND tr.source_message_id=source_id AND tr.payload_hash=r.payload_hash AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_states)state WHERE state->>'id'=period_id::text AND r.effect_text::jsonb->'resultingStates'@>jsonb_build_array(state)));
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.supply_effect_assessment_owns_period_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- The SAME current supply authority accepts only the actual committed own
-- effect alternative; current canonical syntax/function and every remaining
-- original, period version, legal, contract and ground predicate are retained.
DO $$DECLARE signature regprocedure;body text;old text;new text;BEGIN
 FOR signature IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_received_sources'
  AND(p.proname='billing_supply_before_normal_switch_v1' OR strpos(p.prosrc,'initial_wire:=gridex_received_sources.normal_switch_wire_v1(initial_message.raw_payload);')>0) LOOP
  SELECT pg_get_functiondef(signature) INTO body;
  old:=$old$v.facts_text::jsonb->>'applicationDecision'='accepted'$old$;
  IF strpos(body,old)=0 THEN RAISE EXCEPTION 'supply_own_effect_current_authority_shape_changed';END IF;
  new:=$new$(v.facts_text::jsonb->>'applicationDecision'='accepted' OR gridex_received_sources.supply_effect_assessment_owns_period_v1(p_company_id,v.source_message_id,p.id,v.id))$new$;
  body:=replace(body,old,new);
  body:=replace(body,'initial_wire:=gridex_received_sources.normal_switch_wire_v1(initial_message.raw_payload);','initial_wire:=coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p_company_id,initial_message.id,p.id),gridex_received_sources.normal_switch_wire_v1(initial_message.raw_payload));');
  body:=replace(body,'gridex_received_sources.normal_switch_wire_v1(origin.raw_payload)','coalesce(gridex_received_sources.supply_wire_for_period_receipt_v1(p_company_id,origin.id,p.id),gridex_received_sources.normal_switch_wire_v1(origin.raw_payload))');
  EXECUTE body;
 END LOOP;
END$$;

-- Read-only final response capability. Historical committed effects retain
-- their fixed admitted assessment; this never reselects current source facts.
CREATE FUNCTION gridex_received_sources.committed_supply_effects_v1(c uuid,source_id uuid,requested integer[] DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;r gridex_received_sources.supply_object_effect_receipts%rowtype;p gridex_received_sources.supply_object_partitions%rowtype;a gridex_received_sources.validation_assessments%rowtype;
 f gridex_received_sources.prodat_application_facets%rowtype;response gridex_received_sources.prodat_response_facets%rowtype;own jsonb;effects jsonb:='[]';wire jsonb;effect jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR(m.message_code IN('Z04','Z05')) IS NOT TRUE THEN RETURN NULL;END IF;
 IF requested IS NOT NULL AND(cardinality(requested) NOT BETWEEN 1 AND 8192 OR EXISTS(SELECT FROM unnest(requested)x WHERE x IS NULL OR x<0) OR cardinality(requested)<>(SELECT count(DISTINCT x) FROM unnest(requested)x)) THEN RAISE EXCEPTION 'supply_final_response_scope_required';END IF;
 SELECT * INTO p FROM gridex_received_sources.supply_object_partitions WHERE source_message_id=m.id AND company_id=c;
 IF p.source_message_id IS NULL THEN RETURN NULL;END IF;
 IF p.environment IS DISTINCT FROM m.environment OR p.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR p.partition_hash IS DISTINCT FROM encode(sha256(convert_to(p.partition_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'supply_final_response_source_changed';END IF;
 SELECT * INTO a FROM gridex_received_sources.validation_assessments WHERE id=p.canonical_assessment_id AND company_id=c AND source_message_id=m.id;
 SELECT * INTO f FROM gridex_received_sources.prodat_application_facets WHERE assessment_id=a.id AND company_id=c AND source_message_id=m.id;
 SELECT * INTO response FROM gridex_received_sources.prodat_response_facets WHERE assessment_id=a.id;
 IF a.id IS NULL OR a.environment IS DISTINCT FROM m.environment OR a.source_payload_hash IS DISTINCT FROM p.payload_hash OR a.facts_hash IS DISTINCT FROM encode(sha256(convert_to(a.facts_text,'UTF8')),'hex') OR a.owner IS DISTINCT FROM 'canonical-runtime-with-registry-v1'
  OR a.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR a.facts_text::jsonb->>'functionalDecision' IS DISTINCT FROM 'accepted'
  OR f.assessment_id IS NULL OR f.environment IS DISTINCT FROM m.environment OR f.source_payload_hash IS DISTINCT FROM p.payload_hash
  OR response.assessment_id IS NULL OR response.company_id IS DISTINCT FROM c OR response.source_message_id IS DISTINCT FROM m.id OR response.environment IS DISTINCT FROM m.environment OR response.source_payload_hash IS DISTINCT FROM p.payload_hash OR response.response_facts_hash IS DISTINCT FROM encode(sha256(convert_to(response.response_facts_text,'UTF8')),'hex')
  OR f.application_facts_hash IS DISTINCT FROM encode(sha256(convert_to(f.application_facts_text,'UTF8')),'hex')
  OR gridex_received_sources.validate_prodat_application_v1(m.raw_payload,a.facts_text::jsonb,f.application_facts_text::jsonb,response.response_facts_text::jsonb) IS NOT TRUE THEN RAISE EXCEPTION 'supply_final_response_admitted_canonical_required';END IF;
 FOR r IN SELECT stored.* FROM gridex_received_sources.supply_object_effect_receipts stored WHERE stored.company_id=c AND stored.source_message_id=m.id AND(requested IS NULL OR stored.first_line_index=ANY(requested))
  AND stored.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296) ORDER BY stored.first_line_index LOOP
  effect:=r.effect_text::jsonb;wire:=gridex_received_sources.supply_wire_for_scope_v1(m.raw_payload,r.object_scope);
  SELECT o INTO own FROM jsonb_array_elements(f.application_facts_text::jsonb->'objects')o WHERE o-'applicationDecision'-'reasonCodes'=r.object_scope;
  IF r.environment IS DISTINCT FROM m.environment OR r.payload_hash IS DISTINCT FROM p.payload_hash OR r.canonical_assessment_id IS DISTINCT FROM a.id OR r.effect_hash IS DISTINCT FROM encode(sha256(convert_to(r.effect_text,'UTF8')),'hex')
   OR own->>'applicationDecision' IS DISTINCT FROM 'accepted' OR r.first_line_index IS DISTINCT FROM(r.object_scope#>>'{registers,0,segmentIndex}')::integer
   OR effect->>'owner' IS DISTINCT FROM 'inbound-supply-object-v1' OR effect->'object' IS DISTINCT FROM r.object_scope OR effect->'wire' IS DISTINCT FROM wire#>'{objects,0}'
   OR effect->>'sourceMessageId' IS DISTINCT FROM m.id::text OR effect->>'sourcePayloadHash' IS DISTINCT FROM p.payload_hash OR effect->>'companyId' IS DISTINCT FROM c::text OR effect->>'environment' IS DISTINCT FROM m.environment
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(p.partition_text::jsonb)part WHERE part->'object'=r.object_scope AND part->>'disposition'='applied' AND part->>'effectReceiptId'=r.id::text AND part->>'effectFactsHash'=r.effect_hash)
   OR NOT EXISTS(SELECT FROM gridex_received_sources.supply_source_transitions tr WHERE tr.source_message_id=m.id AND tr.company_id=c AND tr.payload_hash=p.payload_hash AND tr.resulting_states@>(effect->'resultingStates') AND(effect#>>'{plan,switchId}' IS NULL OR(effect#>>'{plan,switchId}')::uuid=ANY(tr.qualified_switch_ids)))
   OR(effect#>>'{plan,kind}'='cancel_start' AND NOT EXISTS(SELECT FROM jsonb_array_elements(effect->'resultingSwitches')sw WHERE sw->>'id'=effect#>>'{plan,switchId}' AND sw->>'status'='cancelled_before_start' AND sw->>'inbound_z04_message_id'=m.id::text)) THEN RAISE EXCEPTION 'supply_final_response_own_effect_required';END IF;
  effects:=effects||jsonb_build_array(jsonb_build_object('receiptId',r.id,'canonicalAssessmentId',r.canonical_assessment_id,'sourcePayloadHash',r.payload_hash,'objectScope',r.object_scope,'appliedAt',r.applied_at,'effectKind','supply','effectFactsHash',r.effect_hash));
 END LOOP;
 IF requested IS NOT NULL AND cardinality(requested)<>jsonb_array_length(effects) THEN RAISE EXCEPTION 'supply_final_response_own_effect_uncommitted';END IF;
 RETURN effects;
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.committed_supply_effects_v1(uuid,uuid,integer[]) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
