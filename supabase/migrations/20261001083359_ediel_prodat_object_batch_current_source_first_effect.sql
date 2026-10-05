-- Supabase CLI 2.119.0 forward, recreated after loss of the unpublished packet.
-- Only EDIEL object-batch first effects and its conditional case saves change.
-- Other intake callers, original OIDs/ACLs and immutable migrations remain.
BEGIN;
CREATE SCHEMA gridex_prodat_object_batch;
REVOKE ALL ON SCHEMA gridex_prodat_object_batch FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_prodat_object_batch.graph_receipts(
 company_id uuid NOT NULL,case_id uuid NOT NULL REFERENCES public.ediel_inbound_cases(id) ON DELETE RESTRICT,
 source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,environment text NOT NULL,
 source_hash text NOT NULL,assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL,object_key text NOT NULL,command_hash text NOT NULL,result_hash text NOT NULL,
 operation_id uuid UNIQUE NOT NULL REFERENCES public.customer_onboarding_operations(id) ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(company_id,case_id,object_key));
ALTER TABLE gridex_prodat_object_batch.graph_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_prodat_object_batch.graph_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_prodat_object_batch.graph_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_prodat_object_batch.graph_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_prodat_object_batch.graph_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();

CREATE TABLE gridex_prodat_object_batch.review_receipts(
 company_id uuid NOT NULL,case_id uuid NOT NULL REFERENCES public.ediel_inbound_cases(id) ON DELETE RESTRICT,
 source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,environment text NOT NULL,source_hash text NOT NULL,
 assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL,fingerprint text NOT NULL,command_hash text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(company_id,case_id));
ALTER TABLE gridex_prodat_object_batch.review_receipts ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_prodat_object_batch.review_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_prodat_object_batch.review_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_prodat_object_batch.review_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_prodat_object_batch.review_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
-- Match the existing server's stable JSON transport checksum. This is integrity,
-- not authorization; only native original/facet/actor checks supply authority.
CREATE FUNCTION gridex_prodat_object_batch.json_text_v1(j jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE result text;BEGIN
 IF jsonb_typeof(j)='object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||gridex_prodat_object_batch.json_text_v1(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(j);RETURN result;
 ELSIF jsonb_typeof(j)='array' THEN SELECT '['||coalesce(string_agg(gridex_prodat_object_batch.json_text_v1(value),',' ORDER BY ord),'')||']' INTO result FROM jsonb_array_elements(j) WITH ORDINALITY a(value,ord);RETURN result;
 ELSE RETURN j::text;END IF;
END $$;
CREATE FUNCTION gridex_prodat_object_batch.hash_v1(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT encode(sha256(convert_to(gridex_prodat_object_batch.json_text_v1(j),'UTF8')),'hex')$$;
CREATE FUNCTION gridex_prodat_object_batch.require_service_v1() RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'prodat_object_batch_service_required' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION gridex_prodat_object_batch.source_v1(c uuid,source_id uuid,actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;s gridex_received_sources.sources%rowtype;a gridex_received_sources.validation_assessments%rowtype;
 f gridex_received_sources.prodat_object_validation_facets%rowtype;r gridex_received_sources.prodat_response_facets%rowtype;app jsonb;ctx jsonb;own jsonb;fullown jsonb;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 IF actor IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(actor,c,'communication.write') IS NOT TRUE
  OR public.gridex_actor_has_company_permission(actor,c,'customers.write') IS NOT TRUE THEN RAISE EXCEPTION 'prodat_object_batch_current_actor_required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c FOR SHARE;
 SELECT * INTO s FROM gridex_received_sources.sources WHERE source_message_id=source_id AND company_id=c AND environment=m.environment FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.raw_payload IS NULL
  OR s.source_message_id IS NULL OR s.origin IS DISTINCT FROM 'database_insert' OR s.raw_payload IS DISTINCT FROM m.raw_payload
  OR s.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR s.message_code IS DISTINCT FROM m.message_code
  OR s.source_received_at IS NULL OR s.source_received_at IS DISTINCT FROM m.message_received_at
  OR s.received_context IS DISTINCT FROM m.execution_context_snapshot->'receivedProdatContext'
  OR s.received_context->>'contextOrigin' IS DISTINCT FROM 'database_insert' OR s.received_context->>'payloadHash' IS DISTINCT FROM s.payload_hash
  OR s.received_context->>'sourceMessageId' IS DISTINCT FROM m.id::text OR s.received_context->>'companyId' IS DISTINCT FROM c::text
  OR s.received_context->>'environment' IS DISTINCT FROM m.environment OR s.received_context->>'messageCode' IS DISTINCT FROM m.message_code
  OR (s.received_context->>'sourceReceivedAt')::timestamptz IS DISTINCT FROM s.source_received_at THEN RAISE EXCEPTION 'prodat_object_batch_immutable_original_required';END IF;
 ctx:=gridex_ediel_ack_replay.require_current_source_role_v2(c,m.environment,m.id);
 IF ctx->>'actorRole' IS DISTINCT FROM 'electricity_supplier' THEN RAISE EXCEPTION 'prodat_object_batch_current_receiver_role_required';END IF;
 app:=gridex_received_sources.require_prodat_application_objects_v1(c,m.id);
 SELECT * INTO a FROM gridex_received_sources.validation_assessments WHERE id=(app->>'assessmentId')::uuid AND company_id=c AND environment=m.environment AND source_message_id=m.id AND source_payload_hash=s.payload_hash FOR SHARE;
 SELECT * INTO f FROM gridex_received_sources.prodat_object_validation_facets WHERE assessment_id=a.id AND company_id=c AND environment=m.environment AND source_message_id=m.id AND source_payload_hash=s.payload_hash;
 SELECT * INTO r FROM gridex_received_sources.prodat_response_facets WHERE assessment_id=a.id AND company_id=c AND environment=m.environment AND source_message_id=m.id AND source_payload_hash=s.payload_hash;
 IF a.id IS NULL OR f.assessment_id IS NULL OR r.assessment_id IS NULL OR f.facts_hash IS DISTINCT FROM encode(sha256(convert_to(f.facts_text,'UTF8')),'hex')
  OR r.response_facts_hash IS DISTINCT FROM encode(sha256(convert_to(r.response_facts_text,'UTF8')),'hex') OR f.facts_text::jsonb->>'sharedAccepted' IS DISTINCT FROM 'true'
  OR a.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR a.facts_text::jsonb->>'functionalDecision' IS DISTINCT FROM 'accepted'
  OR app->>'headerDecision' IS DISTINCT FROM 'accepted' OR jsonb_array_length(app->'objects') NOT BETWEEN 2 AND 16
  OR jsonb_array_length(app->'objects') IS DISTINCT FROM jsonb_array_length(f.facts_text::jsonb->'objects') THEN RAISE EXCEPTION 'prodat_object_batch_complete_own_facets_required';END IF;
 FOR own IN SELECT value FROM jsonb_array_elements(app->'objects') LOOP
  SELECT value INTO fullown FROM jsonb_array_elements(f.facts_text::jsonb->'objects') WHERE value->>'objectId'=own->>'objectId' AND value->>'identityAgency'=own->>'identityAgency' AND value->>'messageReference'=own->>'messageReference' AND value->'firstLineIndex'=own#>'{registers,0,lineIndex}';
  IF own->>'applicationDecision' IS DISTINCT FROM 'accepted' OR fullown->>'disposition' IS DISTINCT FROM 'accepted'
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(r.response_facts_text::jsonb->'objects') o WHERE o->>'id'=own->>'objectId' AND o->>'li' IS NOT DISTINCT FROM fullown->>'lineItemReference' AND o->'lineIndex'=own#>'{registers,0,segmentIndex}' AND o->>'outcome'='positive')
   OR EXISTS(SELECT FROM jsonb_array_elements(r.response_facts_text::jsonb->'responses') o WHERE o->>'ercCode'<>'100' AND(o->>'scope'='message' OR o->'lineIndex'=own#>'{registers,0,segmentIndex}')) THEN RAISE EXCEPTION 'prodat_object_batch_own_accepted_partition_required';END IF;
 END LOOP;
 IF (SELECT count(DISTINCT o->>'objectId') FROM jsonb_array_elements(app->'objects')o)<>jsonb_array_length(app->'objects') THEN RAISE EXCEPTION 'prodat_object_batch_namespace_unsupported';END IF;
 RETURN jsonb_build_object('version',1,'sourceMessage',to_jsonb(m),'sourcePayloadHash',s.payload_hash,'assessmentId',a.id,'applicationValidation',app-'assessmentId');
END $$;
CREATE FUNCTION public.ediel_read_prodat_object_batch_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_prodat_object_batch.require_service_v1();RETURN gridex_prodat_object_batch.source_v1(p_company_id,p_source_message_id,p_actor_user_id);END $$;

-- Raw framing companion to the existing neutral lexer. It preserves release
-- sequences for lossless register metadata; canonical facets still own syntax.
CREATE FUNCTION gridex_prodat_object_batch.raw_segments_v1(raw text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE body text:=raw;release_char text:='?';terminator text:='''';ch text;part text:='';released bool:=false;out jsonb:='[]';BEGIN
 IF gridex_received_sources.closure_wire_tokens_v2(raw) IS NULL THEN RETURN NULL;END IF;
 IF left(body,3)='UNA' THEN release_char:=substr(body,7,1);terminator:=substr(body,9,1);body:=substr(body,10);END IF;
 body:=replace(replace(body,E'\r\n',''),E'\n','');
 FOREACH ch IN ARRAY string_to_array(body,NULL) LOOP
  IF released THEN part:=part||ch;released:=false;
  ELSIF ch=release_char THEN part:=part||ch;released:=true;
  ELSIF ch=terminator THEN IF btrim(part,E' \t')<>'' THEN out:=out||jsonb_build_array(btrim(part,E' \t'));END IF;part:='';
  ELSE part:=part||ch;END IF;
 END LOOP;
 RETURN out;
END $$;
-- Derive the mutatable customer/site values independently from the physical
-- first register. Stored case JSON and its self-consistent checksum are never
-- a source of customer identity, address, quantities or service dates.
CREATE FUNCTION gridex_prodat_object_batch.require_wire_projection_v1(raw text,own jsonb,command jsonb,mode text,actor uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(raw);raw_parts jsonb:=gridex_prodat_object_batch.raw_segments_v1(raw);t jsonb;e jsonb;first_index int:=(own#>>'{registers,0,segmentIndex}')::int;next_index int;
 ud jsonb;it jsonb;qty text;start_day text;frequency text;product text;reference text;area text;grid_id uuid;characteristic text;name text;personal text;org text;is_business bool;key text;expected jsonb;field_value jsonb;reg jsonb;wire_reg jsonb;reg_end int;reg_raw jsonb;reg_qty text;BEGIN
 IF tokens IS NULL THEN RAISE EXCEPTION 'prodat_object_batch_physical_projection_required';END IF;
 SELECT min((x->>'index')::int) INTO next_index FROM jsonb_array_elements(tokens)x WHERE x->>'tag' IN('LIN','UNT') AND (x->>'index')::int>first_index;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens)x WHERE (x->>'index')::int>first_index AND (x->>'index')::int<next_index ORDER BY(x->>'index')::int LOOP
  e:=t->'elements';
  IF t->>'tag'='NAD' AND e#>>'{1,0}'='UD' THEN ud:=e;ELSIF t->>'tag'='NAD' AND e#>>'{1,0}'='IT' THEN it:=e;
  ELSIF t->>'tag'='QTY' AND e#>>'{1,0}'='31' THEN qty:=e#>>'{1,1}';
  ELSIF t->>'tag'='DTM' AND e#>>'{1,0}'='92' THEN start_day:=e#>>'{1,1}';
  ELSIF t->>'tag'='RFF' AND e#>>'{1,0}'='Z07' THEN reference:=e#>>'{1,1}';
  ELSIF t->>'tag'='RFF' AND e#>>'{1,0}'='Z05' THEN area:=e#>>'{1,1}';
  ELSIF t->>'tag'='CCI' THEN characteristic:=e#>>'{2,0}';
  ELSIF t->>'tag'='CAV' AND characteristic='Z12' THEN frequency:=e#>>'{1,3}';
  ELSIF t->>'tag'='CAV' AND characteristic='Z14' THEN product:=e#>>'{1,3}';END IF;
 END LOOP;
 FOR reg IN SELECT value FROM jsonb_array_elements(command#>'{application,payload_snapshot,prodatRegisters}') LOOP
  SELECT x INTO wire_reg FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='LIN' AND x#>>'{elements,1,0}'=reg->>'lineSequenceNumber';
  SELECT min((x->>'index')::int) INTO reg_end FROM jsonb_array_elements(tokens)x WHERE x->>'tag' IN('LIN','UNT') AND (x->>'index')::int>(wire_reg->>'index')::int;
  SELECT jsonb_agg(raw_parts->((x->>'index')::int) ORDER BY(x->>'index')::int) INTO reg_raw FROM jsonb_array_elements(tokens)x WHERE (x->>'index')::int>=(wire_reg->>'index')::int AND(x->>'index')::int<reg_end;
  SELECT btrim(x#>>'{elements,1,1}') INTO reg_qty FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='QTY' AND x#>>'{elements,1,0}'='31' AND(x->>'index')::int>(wire_reg->>'index')::int AND(x->>'index')::int<reg_end;
  IF wire_reg IS NULL OR wire_reg#>>'{elements,3,0}' IS DISTINCT FROM own->>'objectId' OR wire_reg#>>'{elements,3,3}' IS DISTINCT FROM own->>'identityAgency'
   OR reg->>'meteringPointId' IS DISTINCT FROM own->>'objectId' OR reg->>'identityAgency' IS DISTINCT FROM own->>'identityAgency'
   OR reg->'rawSegments' IS DISTINCT FROM reg_raw OR reg->>'annualConsumption' IS DISTINCT FROM reg_qty OR reg->>'registerIndex' IS DISTINCT FROM nullif(wire_reg#>>'{elements,4,1}','')
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(own->'registers')r WHERE r->'lineIndex'=reg->'sourceOrder' AND r->>'lineNumber'=reg->>'lineSequenceNumber' AND r->'segmentIndex'=wire_reg->'index') THEN RAISE EXCEPTION 'prodat_object_batch_physical_register_required';END IF;
 END LOOP;
 IF mode='link_existing_only' THEN
  IF command->'customer'<>'{}'::jsonb OR command->'site' IS DISTINCT FROM jsonb_build_object('facility_id',own->>'objectId') OR command->'metering_point' IS DISTINCT FROM jsonb_build_object('meter_point_id',own->>'objectId') OR command->'update_existing' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'prodat_object_batch_link_identity_only_required';END IF;RETURN;
 END IF;
 IF area IS NOT NULL THEN SELECT id INTO grid_id FROM public.grid_owners WHERE company_id=(command->>'company_id')::uuid AND owner_code=area FOR SHARE;
  IF (SELECT count(*) FROM public.grid_owners WHERE company_id=(command->>'company_id')::uuid AND owner_code=area)>1 THEN RAISE EXCEPTION 'prodat_object_batch_grid_namespace_ambiguous';END IF;END IF;
 IF command#>'{site,grid_owner_id}' IS NOT NULL AND command#>'{site,grid_owner_id}' IS DISTINCT FROM coalesce(to_jsonb(grid_id::text),'null'::jsonb) OR command#>'{metering_point,grid_owner_id}' IS NOT NULL AND command#>'{metering_point,grid_owner_id}' IS DISTINCT FROM coalesce(to_jsonb(grid_id::text),'null'::jsonb) THEN RAISE EXCEPTION 'prodat_object_batch_wire_grid_owner_required';END IF;
 SELECT string_agg(btrim(v#>>'{}'),E'\n' ORDER BY ord) INTO name FROM jsonb_array_elements(coalesce(ud->4,'[]')) WITH ORDINALITY n(v,ord) WHERE ord<=2 AND btrim(v#>>'{}')<>'';
 is_business:=ud#>>'{2,1}'='SE1';
 IF ud#>>'{2,0}'~'^[0-9]+([-+][0-9]+)?$' THEN
  IF ud#>>'{2,1}'='SE1' THEN org:=regexp_replace(ud#>>'{2,0}','[^0-9]','','g');ELSIF ud#>>'{2,1}'='SE2' THEN personal:=regexp_replace(ud#>>'{2,0}','[^0-9]','','g');END IF;
 END IF;
 expected:=jsonb_build_object('customer_type',CASE WHEN is_business THEN 'business' ELSE 'private' END,'full_name',coalesce(name,'Ediel inbound-kund'),'company_name',CASE WHEN is_business THEN name END,
  'first_name',CASE WHEN NOT coalesce(is_business,false) THEN split_part(name,' ',1) END,'last_name',CASE WHEN NOT coalesce(is_business,false) THEN nullif(substr(name,strpos(name,' ')+1),name) END,'personal_number',personal,'org_number',org);
 FOR key,field_value IN SELECT * FROM jsonb_each(command->'customer') LOOP
  IF expected ? key AND field_value IS DISTINCT FROM expected->key THEN RAISE EXCEPTION 'prodat_object_batch_wire_customer_required';END IF;
  IF NOT(expected ? key) AND key NOT IN('status','source','metadata','created_by','updated_by') THEN RAISE EXCEPTION 'prodat_object_batch_customer_field_not_source_bound';END IF;
  IF key='status' AND field_value IS DISTINCT FROM '"draft"'::jsonb OR key='source' AND field_value IS DISTINCT FROM '"ediel_inbound"'::jsonb THEN RAISE EXCEPTION 'prodat_object_batch_customer_binding_required';END IF;
  IF key IN('created_by','updated_by') AND field_value IS DISTINCT FROM to_jsonb(actor::text) THEN RAISE EXCEPTION 'prodat_object_batch_actor_required';END IF;
 END LOOP;
 expected:=jsonb_build_object('site_name','Ediel '||(own->>'objectId'),'facility_id',own->>'objectId','site_type',CASE WHEN product='L641Q' THEN 'production' ELSE 'consumption' END,
  'street',CASE WHEN it IS NOT NULL THEN array_to_string(ARRAY(SELECT btrim(v#>>'{}') FROM jsonb_array_elements(it->5) WITH ORDINALITY a(v,ord) WHERE ord<=3 AND btrim(v#>>'{}')<>''),E'\n') END,
  'postal_code',nullif(it#>>'{8,0}',''),'city',nullif(it#>>'{6,0}',''),'country',coalesce(nullif(it#>>'{9,0}',''),'SE'),
  'annual_consumption_kwh',CASE WHEN qty IS NOT NULL THEN replace(qty,',','.')::numeric END,'move_in_date',CASE WHEN start_day IS NOT NULL THEN substr(start_day,1,4)||'-'||substr(start_day,5,2)||'-'||substr(start_day,7,2) END);
 FOR key,field_value IN SELECT * FROM jsonb_each(command->'site') LOOP
  IF expected ? key AND field_value IS DISTINCT FROM expected->key THEN RAISE EXCEPTION 'prodat_object_batch_wire_site_required';END IF;
  IF key='status' AND field_value IS DISTINCT FROM '"draft"'::jsonb OR key IN('created_by','updated_by') AND field_value IS DISTINCT FROM to_jsonb(actor::text) THEN RAISE EXCEPTION 'prodat_object_batch_actor_required';END IF;
  IF NOT(expected ? key) AND key NOT IN('status','grid_owner_id','internal_notes','created_by','updated_by') THEN RAISE EXCEPTION 'prodat_object_batch_site_field_not_source_bound';END IF;
 END LOOP;
 expected:=jsonb_build_object('meter_point_id',own->>'objectId','metering_point_id',own->>'objectId','site_facility_id',own->>'objectId','ediel_reference',reference,
  'measurement_type',CASE WHEN product='L641Q' THEN 'production' ELSE 'consumption' END,'reading_frequency',CASE frequency WHEN 'D' THEN 'daily' WHEN 'M' THEN 'monthly' ELSE 'hourly' END,
  'start_date',CASE WHEN start_day IS NOT NULL THEN substr(start_day,1,4)||'-'||substr(start_day,5,2)||'-'||substr(start_day,7,2) END,'is_settlement_relevant',true);
 FOR key,field_value IN SELECT * FROM jsonb_each(command->'metering_point') LOOP
  IF expected ? key AND field_value IS DISTINCT FROM expected->key THEN RAISE EXCEPTION 'prodat_object_batch_wire_meter_required';END IF;
  IF key='status' AND field_value IS DISTINCT FROM '"draft"'::jsonb OR key IN('created_by','updated_by') AND field_value IS DISTINCT FROM to_jsonb(actor::text) THEN RAISE EXCEPTION 'prodat_object_batch_actor_required';END IF;
  IF NOT(expected ? key) AND key NOT IN('status','grid_owner_id','created_by','updated_by') THEN RAISE EXCEPTION 'prodat_object_batch_meter_field_not_source_bound';END IF;
 END LOOP;
END $$;
CREATE FUNCTION gridex_prodat_object_batch.require_plan_v1(row_case public.ediel_inbound_cases,plan jsonb,proof jsonb,actor uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d jsonb;command jsonb;own jsonb;i int:=0;source public.ediel_messages%rowtype;scope_key text;BEGIN
 source:=jsonb_populate_record(NULL::public.ediel_messages,proof->'sourceMessage');
 IF plan->'version' IS DISTINCT FROM '1'::jsonb OR(plan->>'revision')::int<1 OR plan->>'originalActorId' IS DISTINCT FROM actor::text
  OR plan->>'sourceHash' IS DISTINCT FROM proof->>'sourcePayloadHash' OR jsonb_typeof(plan->'decisions') IS DISTINCT FROM 'array' OR jsonb_typeof(plan->'commands') IS DISTINCT FROM 'array' OR jsonb_typeof(plan->'receipts') IS DISTINCT FROM 'array'
  OR jsonb_array_length(plan->'decisions') IS DISTINCT FROM jsonb_array_length(proof#>'{applicationValidation,objects}') OR jsonb_array_length(plan->'commands') IS DISTINCT FROM jsonb_array_length(plan->'decisions')
  OR plan->>'commandHash' IS DISTINCT FROM gridex_prodat_object_batch.hash_v1(plan->'commands')
  OR plan->>'fingerprint' IS DISTINCT FROM gridex_prodat_object_batch.hash_v1(jsonb_build_array(row_case.company_id,row_case.id,source.id,proof->>'sourcePayloadHash',plan->'decisions')) THEN RAISE EXCEPTION 'prodat_object_batch_plan_integrity_required';END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(plan->'decisions') LOOP
  own:=proof#>ARRAY['applicationValidation','objects',i::text];command:=plan#>ARRAY['commands',i::text];
  scope_key:=gridex_prodat_object_batch.hash_v1(jsonb_build_array(d->>'meteringPointId',d->>'identityAgency'));
  IF d->>'meteringPointId' IS DISTINCT FROM own->>'objectId' OR d->>'identityAgency' IS DISTINCT FROM own->>'identityAgency' OR d->>'meteringPointId'!~'^[A-Z0-9]+$'
   OR(d->>'mode' IN('create_new_customer','update_existing_customer','link_existing_only')) IS NOT TRUE
   OR command->>'company_id' IS DISTINCT FROM row_case.company_id::text OR command->>'actor_user_id' IS DISTINCT FROM actor::text OR command->>'channel' IS DISTINCT FROM 'ediel_inbound'
   OR command#>>'{application,source_record_type}' IS DISTINCT FROM 'ediel_inbound_case' OR command#>>'{application,source_record_id}' IS DISTINCT FROM row_case.id::text||':object:'||scope_key
   OR command->>'idempotency_key' IS DISTINCT FROM 'ediel_inbound:'||row_case.id::text||':object:'||scope_key
   OR command#>>'{application,payload_snapshot,edielMessageId}' IS DISTINCT FROM source.id::text OR command#>>'{application,payload_snapshot,mode}' IS DISTINCT FROM d->>'mode'
   OR command#>>'{metering_point,meter_point_id}' IS DISTINCT FROM own->>'objectId' OR command#>>'{site,facility_id}' IS DISTINCT FROM own->>'objectId'
   OR jsonb_array_length(command#>'{application,payload_snapshot,prodatObjects}') IS DISTINCT FROM 1
   OR command#>>'{application,payload_snapshot,prodatObjects,0,meteringPointId}' IS DISTINCT FROM own->>'objectId'
   OR command#>>'{application,payload_snapshot,prodatObjects,0,identityAgency}' IS DISTINCT FROM own->>'identityAgency'
   OR jsonb_array_length(command#>'{application,payload_snapshot,prodatRegisters}') IS DISTINCT FROM jsonb_array_length(own->'registers')
   OR command#>'{application,payload_snapshot,prodatRegisters}' IS DISTINCT FROM command#>'{application,payload_snapshot,prodatObjects,0,registers}'
   OR command-ARRAY['company_id','actor_user_id','channel','idempotency_key','matching_policy','existing_customer_id','existing_site_id','existing_metering_point_id','update_existing','customer','site','metering_point','application']<>'{}'::jsonb THEN RAISE EXCEPTION 'prodat_object_batch_command_source_partition_required';END IF;
  IF d->>'mode'='create_new_customer' AND(command->>'matching_policy' IS DISTINCT FROM 'create_separate' OR command->>'existing_customer_id' IS NOT NULL OR command->>'existing_site_id' IS NOT NULL OR command->>'existing_metering_point_id' IS NOT NULL)
   OR d->>'mode'<>'create_new_customer' AND(command->>'matching_policy' IS DISTINCT FROM 'link_selected' OR command->>'existing_customer_id' IS DISTINCT FROM d->>'selectedCustomerId' OR command->>'existing_site_id' IS DISTINCT FROM d->>'selectedSiteId' OR command->>'existing_metering_point_id' IS DISTINCT FROM d->>'selectedMeteringPointId') THEN RAISE EXCEPTION 'prodat_object_batch_choice_required';END IF;
  PERFORM gridex_prodat_object_batch.require_wire_projection_v1(source.raw_payload,own,command,d->>'mode',actor);
  i:=i+1;
 END LOOP;
END $$;
CREATE FUNCTION gridex_prodat_object_batch.require_review_v1(row_case public.ediel_inbound_cases,plan jsonb,proof jsonb,actor uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE r gridex_prodat_object_batch.review_receipts%rowtype;BEGIN
 SELECT * INTO r FROM gridex_prodat_object_batch.review_receipts WHERE company_id=row_case.company_id AND case_id=row_case.id;
 IF r.case_id IS NULL OR r.source_message_id IS DISTINCT FROM row_case.ediel_message_id OR r.environment IS DISTINCT FROM proof#>>'{sourceMessage,environment}' OR r.source_hash IS DISTINCT FROM proof->>'sourcePayloadHash'
  OR r.actor_user_id IS DISTINCT FROM actor OR r.actor_user_id IS DISTINCT FROM row_case.reviewed_by OR r.fingerprint IS DISTINCT FROM plan->>'fingerprint' OR r.command_hash IS DISTINCT FROM plan->>'commandHash'
  OR row_case.reviewed_at IS NULL OR row_case.reviewed_at IS DISTINCT FROM r.recorded_at THEN RAISE EXCEPTION 'prodat_object_batch_native_review_required';END IF;
END $$;
CREATE FUNCTION gridex_prodat_object_batch.require_receipts_v1(row_case public.ediel_inbound_cases,plan jsonb,proof jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE receipt jsonb;r gridex_prodat_object_batch.graph_receipts%rowtype;op public.customer_onboarding_operations%rowtype;key text;idx int;BEGIN
 IF (SELECT count(DISTINCT e->>'key') FROM jsonb_array_elements(plan->'receipts')e)<>jsonb_array_length(plan->'receipts') THEN RAISE EXCEPTION 'prodat_object_batch_duplicate_receipt';END IF;
 FOR receipt IN SELECT value FROM jsonb_array_elements(plan->'receipts') LOOP
  key:=receipt->>'key';SELECT (ord-1)::int INTO idx FROM jsonb_array_elements(plan->'decisions') WITH ORDINALITY d(value,ord) WHERE gridex_prodat_object_batch.json_text_v1(jsonb_build_array(value->>'meteringPointId',value->>'identityAgency'))=key;
  SELECT * INTO r FROM gridex_prodat_object_batch.graph_receipts WHERE company_id=row_case.company_id AND case_id=row_case.id AND object_key=key;
  SELECT * INTO op FROM public.customer_onboarding_operations WHERE id=r.operation_id AND company_id=row_case.company_id AND channel='ediel_inbound' AND status='completed' FOR SHARE;
  IF idx IS NULL OR r.operation_id IS NULL OR op.id IS NULL OR r.source_message_id IS DISTINCT FROM row_case.ediel_message_id OR r.source_hash IS DISTINCT FROM proof->>'sourcePayloadHash'
   OR r.actor_user_id::text IS DISTINCT FROM plan->>'originalActorId' OR r.command_hash IS DISTINCT FROM gridex_prodat_object_batch.hash_v1(plan#>ARRAY['commands',idx::text])
   OR r.result_hash IS DISTINCT FROM gridex_prodat_object_batch.hash_v1(op.result_snapshot) OR op.result_snapshot IS DISTINCT FROM receipt->'result' THEN RAISE EXCEPTION 'prodat_object_batch_native_receipt_required';END IF;
 END LOOP;
END $$;
CREATE FUNCTION gridex_prodat_object_batch.onboard_v1(command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c uuid:=(command->>'company_id')::uuid;actor uuid:=(command->>'actor_user_id')::uuid;case_id uuid:=split_part(command#>>'{application,source_record_id}',':object:',1)::uuid;
 row_case public.ediel_inbound_cases%rowtype;proof jsonb;plan jsonb;key text;canonical_command jsonb:=command-ARRAY['correlation_id','test_fail_after'];stored_command jsonb;r gridex_prodat_object_batch.graph_receipts%rowtype;op public.customer_onboarding_operations%rowtype;result jsonb;BEGIN
 PERFORM gridex_prodat_object_batch.require_service_v1();
 SELECT ediel_message_id INTO row_case.ediel_message_id FROM public.ediel_inbound_cases WHERE id=case_id AND company_id=c;
 proof:=gridex_prodat_object_batch.source_v1(c,row_case.ediel_message_id,actor);
 SELECT * INTO row_case FROM public.ediel_inbound_cases WHERE id=case_id AND company_id=c FOR UPDATE;
 plan:=row_case.review_decision->'objectApplication';
 IF row_case.id IS NULL OR row_case.reviewed_by IS DISTINCT FROM actor OR row_case.reviewed_at IS NULL OR row_case.status NOT IN('approved','failed','applied') THEN RAISE EXCEPTION 'prodat_object_batch_approved_case_required';END IF;
 PERFORM gridex_prodat_object_batch.require_plan_v1(row_case,plan,proof,actor);
 PERFORM gridex_prodat_object_batch.require_review_v1(row_case,plan,proof,actor);
 SELECT value INTO stored_command FROM jsonb_array_elements(plan->'commands') WHERE value->>'idempotency_key'=command->>'idempotency_key';
 IF stored_command IS NULL OR stored_command IS DISTINCT FROM canonical_command THEN RAISE EXCEPTION 'prodat_object_batch_exact_approved_command_required';END IF;
 SELECT gridex_prodat_object_batch.json_text_v1(jsonb_build_array(d->>'meteringPointId',d->>'identityAgency')) INTO key FROM jsonb_array_elements(plan->'decisions')d WHERE d->>'meteringPointId'=command#>>'{metering_point,meter_point_id}';
 SELECT * INTO r FROM gridex_prodat_object_batch.graph_receipts gr WHERE gr.company_id=c AND gr.case_id=row_case.id AND gr.object_key=key;
 IF r.operation_id IS NOT NULL THEN
  SELECT * INTO op FROM public.customer_onboarding_operations WHERE id=r.operation_id AND company_id=c AND channel='ediel_inbound' AND status='completed' FOR SHARE;
  IF op.id IS NULL OR r.source_hash IS DISTINCT FROM proof->>'sourcePayloadHash' OR r.command_hash IS DISTINCT FROM gridex_prodat_object_batch.hash_v1(canonical_command) OR r.actor_user_id IS DISTINCT FROM actor OR r.result_hash IS DISTINCT FROM gridex_prodat_object_batch.hash_v1(op.result_snapshot) THEN RAISE EXCEPTION 'prodat_object_batch_replay_conflict';END IF;
  RETURN op.result_snapshot; -- Established operation: no writer or new receipt.
 END IF;
 IF row_case.status='applied' THEN RAISE EXCEPTION 'prodat_object_batch_applied_receipt_missing';END IF;
 PERFORM public.ediel_require_source_bytes_available_v1(c,row_case.ediel_message_id);
 result:=public.gridex_onboard_customer_graph(command);
 IF result->'ok' IS DISTINCT FROM 'true'::jsonb THEN RETURN result;END IF;
 SELECT * INTO op FROM public.customer_onboarding_operations WHERE id=(result->>'operation_id')::uuid AND company_id=c AND channel='ediel_inbound' AND idempotency_key=command->>'idempotency_key' AND status='completed';
 IF op.id IS NULL OR op.result_snapshot IS DISTINCT FROM result OR op.command_snapshot-ARRAY['correlation_id','test_fail_after'] IS DISTINCT FROM canonical_command THEN RAISE EXCEPTION 'prodat_object_batch_native_graph_result_required';END IF;
 INSERT INTO gridex_prodat_object_batch.graph_receipts(company_id,case_id,source_message_id,environment,source_hash,assessment_id,actor_user_id,object_key,command_hash,result_hash,operation_id)
 VALUES(c,row_case.id,row_case.ediel_message_id,proof#>>'{sourceMessage,environment}',proof->>'sourcePayloadHash',(proof->>'assessmentId')::uuid,actor,key,gridex_prodat_object_batch.hash_v1(canonical_command),gridex_prodat_object_batch.hash_v1(result),op.id);
 RETURN result;
END $$;
-- Preserve the complete pre-existing canonical wrapper, including signed admin
-- contract normalization. The branch merely redirects actual object commands.
DO $forward$DECLARE body text;old text:='return public.gridex_onboard_customer_graph(v_command);';replacement text;BEGIN
 SELECT pg_get_functiondef('public.canonical_onboard_customer_graph(jsonb)'::regprocedure) INTO body;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'prodat_object_batch_canonical_wrapper_changed';END IF;
 replacement:=$branch$if v_command->>'channel'='ediel_inbound' and v_command#>>'{application,source_record_type}'='ediel_inbound_case' and strpos(coalesce(v_command#>>'{application,source_record_id}',''),':object:')>0 then
    return gridex_prodat_object_batch.onboard_v1(v_command);
  end if;
  return public.gridex_onboard_customer_graph(v_command);$branch$;
 EXECUTE replace(body,old,replacement);
END $forward$;

CREATE FUNCTION public.ediel_compare_and_set_prodat_object_case_v1(p_company_id uuid,p_case_id uuid,p_source_message_id uuid,p_actor_user_id uuid,p_expected_updated_at timestamptz,p_expected_status text,p_expected_fingerprint text,p_expected_revision int,p_patch jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row_case public.ediel_inbound_cases%rowtype;proof jsonb;oldplan jsonb;plan jsonb;result jsonb;BEGIN
 PERFORM gridex_prodat_object_batch.require_service_v1();proof:=gridex_prodat_object_batch.source_v1(p_company_id,p_source_message_id,p_actor_user_id);
 SELECT * INTO row_case FROM public.ediel_inbound_cases WHERE id=p_case_id AND company_id=p_company_id AND ediel_message_id=p_source_message_id FOR UPDATE;
 IF row_case.id IS NULL THEN RAISE EXCEPTION 'prodat_object_batch_case_source_required';END IF;
 oldplan:=row_case.review_decision->'objectApplication';
 IF oldplan IS NOT NULL AND oldplan->>'originalActorId' IS DISTINCT FROM p_actor_user_id::text THEN RAISE EXCEPTION 'prodat_object_batch_original_actor_required';END IF;
 IF row_case.status='applied' THEN
  PERFORM gridex_prodat_object_batch.require_plan_v1(row_case,oldplan,proof,p_actor_user_id);PERFORM gridex_prodat_object_batch.require_receipts_v1(row_case,oldplan,proof);PERFORM gridex_prodat_object_batch.require_review_v1(row_case,oldplan,proof,p_actor_user_id);
  IF oldplan->>'fingerprint' IS DISTINCT FROM p_expected_fingerprint THEN RAISE EXCEPTION 'prodat_object_batch_replay_conflict';END IF;
  RETURN NULL; -- CAS lost to an identical finished operation; caller re-reads.
 END IF;
 IF row_case.updated_at IS DISTINCT FROM p_expected_updated_at OR row_case.status IS DISTINCT FROM p_expected_status OR oldplan->>'fingerprint' IS DISTINCT FROM p_expected_fingerprint OR(oldplan->>'revision')::int IS DISTINCT FROM p_expected_revision THEN RETURN NULL;END IF;
 IF p_patch-ARRAY['status','review_decision','reviewed_by','reviewed_at','failure_reason','updated_by','customer_id','site_id','metering_point_id','applied_at']<>'{}'::jsonb OR p_patch->>'updated_by' IS DISTINCT FROM p_actor_user_id::text OR(p_patch->>'status' IN('approved','failed','applied')) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_object_batch_case_patch_required';END IF;
 plan:=coalesce(p_patch#>'{review_decision,objectApplication}',oldplan);
 PERFORM gridex_prodat_object_batch.require_plan_v1(row_case,plan,proof,p_actor_user_id);PERFORM gridex_prodat_object_batch.require_receipts_v1(row_case,plan,proof);
 IF oldplan IS NULL THEN
  IF EXISTS(SELECT FROM gridex_prodat_object_batch.review_receipts WHERE company_id=p_company_id AND case_id=p_case_id) THEN RAISE EXCEPTION 'prodat_object_batch_original_review_conflict';END IF;
  IF row_case.status NOT IN('pending_review','failed') OR plan->'revision'<>'1'::jsonb OR p_patch->>'reviewed_by' IS DISTINCT FROM p_actor_user_id::text OR jsonb_array_length(plan->'receipts')<>0 OR p_patch->>'status'<>'approved' THEN RAISE EXCEPTION 'prodat_object_batch_initial_review_required';END IF;
  INSERT INTO gridex_prodat_object_batch.review_receipts(company_id,case_id,source_message_id,environment,source_hash,assessment_id,actor_user_id,fingerprint,command_hash) VALUES(p_company_id,p_case_id,p_source_message_id,proof#>>'{sourceMessage,environment}',proof->>'sourcePayloadHash',(proof->>'assessmentId')::uuid,p_actor_user_id,plan->>'fingerprint',plan->>'commandHash');
 ELSE
  PERFORM gridex_prodat_object_batch.require_review_v1(row_case,oldplan,proof,p_actor_user_id);
  IF row_case.reviewed_by IS DISTINCT FROM p_actor_user_id OR plan-ARRAY['revision','receipts'] IS DISTINCT FROM oldplan-ARRAY['revision','receipts'] OR(plan->>'revision')::int<>(oldplan->>'revision')::int+1 OR NOT((plan->'receipts') @> (oldplan->'receipts')) THEN RAISE EXCEPTION 'prodat_object_batch_saved_plan_changed';END IF;
 END IF;
 IF p_patch->>'status'='applied' THEN
  IF jsonb_array_length(plan->'receipts')<>jsonb_array_length(plan->'commands') THEN RAISE EXCEPTION 'prodat_object_batch_incomplete';END IF;
  result:=jsonb_build_object('objectCount',jsonb_array_length(plan->'commands'),'receipts',plan->'receipts','fingerprint',plan->>'fingerprint','sourceHash',plan->>'sourceHash');
  INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,new_values,metadata) VALUES(p_company_id,p_actor_user_id,'ediel_inbound_case',p_case_id::text,'ediel_inbound_objects_applied',result,jsonb_build_object('edielMessageId',p_source_message_id,'fingerprint',plan->>'fingerprint'));
  INSERT INTO public.ediel_message_events(company_id,ediel_message_id,event_type,event_status,message,payload,created_by) VALUES(p_company_id,p_source_message_id,'validated','success','Samtliga PRODAT-objekt har egna kanoniska kundtransaktioner och sparade kvitton.',result,p_actor_user_id);
 END IF;
 UPDATE public.ediel_inbound_cases SET status=p_patch->>'status',review_decision=coalesce(p_patch->'review_decision',review_decision),reviewed_by=coalesce((p_patch->>'reviewed_by')::uuid,reviewed_by),reviewed_at=CASE WHEN oldplan IS NULL THEN(SELECT recorded_at FROM gridex_prodat_object_batch.review_receipts WHERE company_id=p_company_id AND case_id=p_case_id) ELSE reviewed_at END,
  failure_reason=p_patch->>'failure_reason',updated_by=p_actor_user_id,updated_at=clock_timestamp(),applied_at=CASE WHEN p_patch->>'status'='applied' THEN clock_timestamp() ELSE applied_at END,
  customer_id=CASE WHEN p_patch->>'status'='applied' THEN NULL ELSE customer_id END,site_id=CASE WHEN p_patch->>'status'='applied' THEN NULL ELSE site_id END,metering_point_id=CASE WHEN p_patch->>'status'='applied' THEN NULL ELSE metering_point_id END WHERE id=row_case.id RETURNING * INTO row_case;
 RETURN to_jsonb(row_case);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_prodat_object_batch FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_read_prodat_object_batch_source_v1(uuid,uuid,uuid),public.ediel_compare_and_set_prodat_object_case_v1(uuid,uuid,uuid,uuid,timestamptz,text,text,int,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_read_prodat_object_batch_source_v1(uuid,uuid,uuid),public.ediel_compare_and_set_prodat_object_case_v1(uuid,uuid,uuid,uuid,timestamptz,text,text,int,jsonb) TO service_role;
COMMIT;
