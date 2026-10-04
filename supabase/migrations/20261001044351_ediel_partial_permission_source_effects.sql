-- Same full physical source; own application acceptance plus global functional
-- acceptance never creates a grant. Prior fixed results remain first.
BEGIN;
CREATE TABLE gridex_received_sources.permission_effect_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),company_id uuid NOT NULL REFERENCES public.companies(id),permission_id uuid NOT NULL REFERENCES public.metering_permissions(id),payload_hash text NOT NULL,canonical_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id),object_scopes jsonb NOT NULL CHECK(jsonb_typeof(object_scopes)='array' AND jsonb_array_length(object_scopes)>0),previous_state jsonb NOT NULL,previous_sites jsonb NOT NULL,resulting_state jsonb NOT NULL,resulting_sites jsonb NOT NULL,qualified_original_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),qualified_expected_message_code text NOT NULL CHECK(qualified_expected_message_code IN('Z14','Z15')),actor_user_id uuid NOT NULL REFERENCES auth.users(id),applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(source_message_id,permission_id));
CREATE TABLE gridex_received_sources.permission_partition_receipts(source_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id),company_id uuid NOT NULL,environment text NOT NULL,payload_hash text NOT NULL,canonical_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id),manifest jsonb NOT NULL,result jsonb NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['permission_effect_receipts','permission_partition_receipts'] LOOP
 EXECUTE format('ALTER TABLE gridex_received_sources.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_received_sources.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON gridex_received_sources.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER permission_effect_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);EXECUTE format('CREATE TRIGGER permission_effect_no_truncate BEFORE TRUNCATE ON gridex_received_sources.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
END LOOP;END$$;
CREATE VIEW gridex_received_sources.permission_effect_transitions_v1 AS
 SELECT source_message_id,company_id,permission_id,payload_hash,previous_state,previous_sites,resulting_state,applied_at,actor_user_id,resulting_sites,qualified_original_message_id,qualified_expected_message_code FROM gridex_received_sources.permission_transitions
 UNION ALL SELECT source_message_id,company_id,permission_id,payload_hash,previous_state,previous_sites,resulting_state,applied_at,actor_user_id,resulting_sites,qualified_original_message_id,qualified_expected_message_code FROM gridex_received_sources.permission_effect_receipts;
REVOKE ALL ON gridex_received_sources.permission_effect_transitions_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_received_sources.permission_partition_wire_v1(raw text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(raw);t jsonb;e jsonb;w jsonb:='{}';objects jsonb:='[]';physical jsonb:='[]';obj jsonb;prior jsonb;key text;field_value text;characteristic text;seen text[]:=ARRAY[]::text[];fingerprint text;field text;BEGIN
 IF tokens IS NULL OR(SELECT count(*) FROM jsonb_array_elements(tokens)token WHERE token->>'tag'='UNH')<>1 OR(SELECT count(*) FROM jsonb_array_elements(tokens)token WHERE token->>'tag'='BGM')<>1 THEN RETURN NULL;END IF;
 FOR t IN SELECT value FROM jsonb_array_elements(tokens)ORDER BY(value->>'index')::int LOOP
  e:=t->'elements';
  IF t->>'tag'='UNH' THEN w:=w||jsonb_build_object('messageReference',e#>>'{1,0}','family',e#>>'{2,0}');END IF;
  IF t->>'tag'='BGM' THEN w:=w||jsonb_build_object('code',e#>>'{1,0}');END IF;
  IF t->>'tag'='NAD' AND obj IS NULL AND e#>>'{1,0}' IN('FR','DO') THEN
   key:=CASE e#>>'{1,0}' WHEN 'FR' THEN 'sender' ELSE 'receiver' END;
   IF w ? key OR e#>>'{2,1}' IS DISTINCT FROM '160' OR e#>>'{2,2}' IS DISTINCT FROM 'SVK' THEN RETURN NULL;END IF;
   w:=w||jsonb_build_object(key,e#>>'{2,0}');
  END IF;
  IF t->>'tag'='LIN' THEN
   IF obj IS NOT NULL THEN objects:=objects||jsonb_build_array(obj);END IF;
   obj:=jsonb_build_object('point',nullif(e#>>'{3,0}',''),'identityAgency',nullif(e#>>'{3,3}',''),'line',e#>>'{1,0}','firstLineIndex',t->'index','lineIndexes',jsonb_build_array(t->'index'));characteristic:=NULL;
  ELSIF obj IS NOT NULL THEN
   key:=NULL;field_value:=NULL;
   IF t->>'tag'='RFF' AND e#>>'{1,0}' IN('LI','Z09','Z05') THEN key:=CASE e#>>'{1,0}' WHEN 'LI' THEN 'li' WHEN 'Z09' THEN 'permissionId' ELSE 'gridArea' END;field_value:=e#>>'{1,1}';
   ELSIF t->>'tag'='NAD' AND e#>>'{1,0}'='UD' THEN key:='customerIdentity';field_value:=e#>>'{2,0}';
   ELSIF t->>'tag'='DTM' AND e#>>'{1,0}' IN('90','91','693','164') THEN
    key:=CASE e#>>'{1,0}' WHEN '90' THEN 'reportStart' WHEN '91' THEN 'reportEnd' WHEN '693' THEN 'permissionTime' ELSE 'permissionEnd' END;field_value:=e#>>'{1,1}';IF(e#>>'{1,2}' IN('102','203','303')) IS NOT TRUE THEN obj:=obj||'{"projectionHeld":true}';END IF;
   ELSIF t->>'tag'='CCI' THEN characteristic:=e#>>'{2,0}';
   ELSIF t->>'tag'='CAV' THEN key:=CASE characteristic WHEN 'Z13' THEN 'reason' WHEN 'Z23' THEN 'status' WHEN 'Z24' THEN 'purpose' WHEN 'Z25' THEN 'endReason' WHEN 'Z12' THEN 'frequency' WHEN 'Z14' THEN 'product' END;field_value:=CASE characteristic WHEN 'Z12' THEN e#>>'{1,3}' WHEN 'Z14' THEN e#>>'{1,4}' ELSE e#>>'{1,0}' END;
   END IF;
   IF key IS NOT NULL THEN IF obj ? key THEN obj:=obj||'{"projectionHeld":true}';END IF;obj:=obj||jsonb_build_object(key,nullif(field_value,''));END IF;
  END IF;
 END LOOP;
 IF obj IS NOT NULL THEN objects:=objects||jsonb_build_array(obj);END IF;
 IF w->>'family' IS DISTINCT FROM 'PRODAT' OR(w->>'code' IN('Z13','Z14','Z15','Z18')) IS NOT TRUE OR nullif(w->>'sender','') IS NULL OR nullif(w->>'receiver','') IS NULL OR jsonb_array_length(objects)=0 THEN RETURN NULL;END IF;
 -- Repeated register fragments belong to one physical installation. Every
 -- present consumed common value must equal its first physical occurrence.
 FOR obj IN SELECT value FROM jsonb_array_elements(objects) LOOP
  fingerprint:=jsonb_build_array(obj->'point',obj->'identityAgency',CASE WHEN obj->>'point' IS NULL THEN obj->'firstLineIndex' ELSE NULL END)::text;
  IF fingerprint=ANY(seen) THEN
   SELECT x INTO prior FROM jsonb_array_elements(physical)x WHERE x->'point' IS NOT DISTINCT FROM obj->'point' AND x->'identityAgency' IS NOT DISTINCT FROM obj->'identityAgency';
   FOREACH field IN ARRAY ARRAY['li','permissionId','gridArea','customerIdentity','reportStart','reportEnd','permissionTime','permissionEnd','reason','status','purpose','endReason','frequency','product'] LOOP IF obj ? field AND obj->field IS DISTINCT FROM prior->field THEN prior:=prior||'{"projectionHeld":true}';END IF;END LOOP;
   prior:=prior||jsonb_build_object('lineIndexes',prior->'lineIndexes'||obj->'lineIndexes');IF obj->>'projectionHeld'='true' THEN prior:=prior||'{"projectionHeld":true}';END IF;
   SELECT jsonb_agg(CASE WHEN x->>'firstLineIndex'=prior->>'firstLineIndex' THEN prior ELSE x END ORDER BY ord) INTO physical FROM jsonb_array_elements(physical)WITH ORDINALITY e(x,ord);
  ELSE seen:=array_append(seen,fingerprint);physical:=physical||jsonb_build_array(obj);END IF;
 END LOOP;
 RETURN w||jsonb_build_object('objects',physical);
END$$;
-- The old whole-source projection uses the SAME neutral decoder, preserving
-- its full-source refusal. The new native executor alone selects own scopes.
CREATE OR REPLACE FUNCTION gridex_received_sources.permission_wire_v1(p_raw text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$DECLARE w jsonb:=gridex_received_sources.permission_partition_wire_v1(p_raw);BEGIN IF w IS NULL OR EXISTS(SELECT FROM jsonb_array_elements(w->'objects')x WHERE x->>'projectionHeld'='true') THEN RETURN NULL;END IF;RETURN w;END$$;
CREATE FUNCTION gridex_received_sources.apply_permission_group_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid,p_expected_permission_id uuid,p_wire jsonb,p_canonical_id uuid,p_scopes jsonb,p_validate_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype; origin public.ediel_messages%rowtype; p public.metering_permissions%rowtype;
 wire jsonb; original jsonb; a jsonb; b jsonb; prior gridex_received_sources.permission_effect_transitions_v1%rowtype;
 ids uuid[]; mode text; reason text; next_status text; negative_status text; count_positive int:=0; count_negative int:=0;incomplete boolean:=false;
 start_day date; end_day date; end_time timestamptz; before_state jsonb; before_sites jsonb; after_state jsonb; ended_source public.ediel_messages%rowtype; ended_wire jsonb; termination public.ediel_messages%rowtype; termination_wire jsonb; qualified_original uuid; qualified_code text;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR p_actor_user_id IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','permission_source_unavailable'); END IF;
 IF NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,m.company_id,'metering.write'),false)
 OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
 THEN RETURN jsonb_build_object('applied',false,'reason','permission_execution_actor_unqualified'); END IF;
 SELECT * INTO prior FROM gridex_received_sources.permission_effect_transitions_v1 WHERE source_message_id=m.id AND permission_id=p_expected_permission_id;
 IF FOUND THEN
  IF prior.company_id<>p_company_id OR prior.payload_hash<>encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR (p_expected_permission_id IS NOT NULL AND prior.permission_id<>p_expected_permission_id) THEN RAISE EXCEPTION 'permission_replay_conflict'; END IF;
  RETURN jsonb_build_object('applied',true,'idempotent',true,'permissionId',prior.permission_id,'status',prior.resulting_state->>'status');
 END IF;
 -- Private input is minted from the SAME full raw/application partition.
 IF p_canonical_id IS NULL OR jsonb_typeof(p_scopes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_scopes)=0 OR p_wire->>'code' IS DISTINCT FROM m.message_code OR p_wire-'objects' IS DISTINCT FROM gridex_received_sources.permission_partition_wire_v1(m.raw_payload)-'objects'
  OR EXISTS(SELECT FROM jsonb_array_elements(p_scopes)x WHERE gridex_received_sources.prodat_application_object_accepted_v1(m.company_id,m.id,p_canonical_id,x) IS NOT TRUE)
  OR NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.id=p_canonical_id AND v.source_message_id=m.id AND v.company_id=m.company_id AND v.environment=m.environment AND v.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN jsonb_build_object('applied',false,'reason','permission_own_application_and_function_required');END IF;
 wire:=p_wire;
 IF wire IS NULL OR(wire->>'code' IN('Z14','Z15')) IS NOT TRUE OR EXISTS(SELECT FROM jsonb_array_elements(wire->'objects')o WHERE o->>'projectionHeld'='true' OR NOT EXISTS(SELECT FROM jsonb_array_elements(gridex_received_sources.permission_partition_wire_v1(m.raw_payload)->'objects')x WHERE x=o)) THEN RETURN jsonb_build_object('applied',false,'reason','permission_wire_unavailable');END IF;
 -- Correlation is exact: permission owner, outbound original Z13, environment,
 -- opposite legal actors, and original LI. No unrelated unique-row fallback.
 SELECT array_agg(mp.id ORDER BY mp.id) INTO ids FROM public.metering_permissions mp
 JOIN public.ediel_messages z ON z.id=coalesce(mp.source_z13_message_id,mp.outbound_z13_message_id) AND z.company_id=mp.company_id AND z.environment=m.environment
 WHERE mp.company_id=m.company_id AND (p_expected_permission_id IS NULL OR mp.id=p_expected_permission_id)
 AND z.direction='outbound' AND gridex_received_sources.sent_source_is_current_v1(z) IS TRUE
 AND EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE nullif(o->>'li','') IS NOT NULL AND o->>'li'=mp.rff_li_reference);
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','no_unique_source_bound_permission'); END IF;
 SELECT * INTO p FROM public.metering_permissions WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
 SELECT * INTO origin FROM public.ediel_messages WHERE id=coalesce(p.source_z13_message_id,p.outbound_z13_message_id) AND company_id=m.company_id FOR SHARE;
 IF NOT FOUND OR origin.environment IS DISTINCT FROM m.environment OR origin.direction IS DISTINCT FROM 'outbound' OR gridex_received_sources.sent_source_is_current_v1(origin) IS NOT TRUE
  OR origin.immutable_rendered_at IS NULL OR origin.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex')
 THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_not_sealed_and_sent'); END IF;
 original:=gridex_received_sources.permission_partition_wire_v1(origin.raw_payload);
 IF original IS NULL OR original->>'code' IS DISTINCT FROM 'Z13' OR wire->>'sender' IS DISTINCT FROM original->>'receiver' OR wire->>'receiver' IS DISTINCT FROM original->>'sender'
 OR p.grid_owner_ediel_id IS DISTINCT FROM wire->>'sender' THEN RETURN jsonb_build_object('applied',false,'reason','permission_legal_actor_mismatch'); END IF;
 IF origin.customer_id IS DISTINCT FROM p.customer_id OR (SELECT count(DISTINCT jsonb_build_array(o->'customerIdentity',o->'reason')) FROM jsonb_array_elements(original->'objects')o WHERE o->>'li'=p.rff_li_reference)<>1 OR EXISTS(SELECT FROM jsonb_array_elements(original->'objects')o WHERE o->>'li'=p.rff_li_reference AND(o->>'projectionHeld'='true' OR nullif(o->>'customerIdentity','') IS NULL OR(o->>'reason' IN('S17','S18')) IS NOT TRUE)) THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_customer_scope_unavailable');END IF;
 SELECT o INTO b FROM jsonb_array_elements(original->'objects')o WHERE o->>'li'=p.rff_li_reference;
 IF b IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_mode_unavailable');END IF;
 -- Every own positive physical installation is either exactly requested or
 -- part of the genuine customer-bound unspecified installation request.
 IF EXISTS(SELECT FROM jsonb_array_elements(wire->'objects')o WHERE o->>'status'='A74' AND(SELECT count(*) FROM jsonb_array_elements(original->'objects')x WHERE x->>'li'=p.rff_li_reference AND(x->>'point' IS NULL OR(x->>'point'=o->>'point' AND x->>'identityAgency' IS NOT DISTINCT FROM o->>'identityAgency')) )<>1) THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_physical_scope_unavailable');END IF;
 mode:=b->>'reason';before_state:=to_jsonb(p);qualified_original:=origin.id;qualified_code:=wire->>'code';
 PERFORM ps.id FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id ORDER BY ps.id FOR UPDATE;
 SELECT coalesce(jsonb_agg(to_jsonb(ps) ORDER BY ps.id),'[]'::jsonb) INTO before_sites FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id;
 IF wire->>'code'='Z14' THEN
  IF p.source_z13_message_id IS NOT NULL AND p.outbound_z13_message_id IS NOT NULL AND p.source_z13_message_id<>p.outbound_z13_message_id THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_identity_conflict'); END IF;
  IF (p.status IN ('z13_sent','waiting_for_customer_approval','z13_ready')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','permission_business_outcome_already_established'); END IF;
  FOR a IN SELECT o FROM jsonb_array_elements(wire->'objects') o LOOP
   IF a->>'customerIdentity' IS NOT NULL AND a->>'customerIdentity' IS DISTINCT FROM b->>'customerIdentity' THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_customer_scope_unavailable');END IF;
   IF a->>'li' IS DISTINCT FROM p.rff_li_reference THEN RETURN jsonb_build_object('applied',false,'reason','permission_object_reference_mismatch'); END IF;
   reason:=a->>'reason';
   IF reason='Z96' AND a->>'status' IN ('A13','A76') THEN
    count_negative:=count_negative+1;
    IF negative_status IS NOT NULL AND negative_status<>a->>'status' THEN RETURN jsonb_build_object('applied',false,'reason','mixed_permission_denial_reasons'); END IF;
    negative_status:=a->>'status';
   ELSIF reason=mode AND a->>'status'='A74' THEN
    count_positive:=count_positive+1;start_day:=gridex_received_sources.permission_date_v1(a->>'reportStart');end_day:=gridex_received_sources.permission_date_v1(a->>'reportEnd');
    IF nullif(a->>'point','') IS NULL OR nullif(a->>'permissionId','') IS NULL OR nullif(a->>'customerIdentity','') IS NULL OR a->>'customerIdentity' IS DISTINCT FROM b->>'customerIdentity'
    
    OR start_day IS NULL OR gridex_received_sources.permission_time_v1(a->>'reportStart') IS NULL OR (a->>'reportEnd' IS NOT NULL AND gridex_received_sources.permission_time_v1(a->>'reportEnd') IS NULL) OR (a->>'reportEnd' IS NOT NULL AND end_day IS NULL) OR (end_day IS NOT NULL AND end_day<start_day) THEN RETURN jsonb_build_object('applied',false,'reason','permission_approved_object_evidence_invalid'); END IF;
   ELSE RETURN jsonb_build_object('applied',false,'reason','permission_business_reason_unqualified'); END IF;
  END LOOP;
  IF p_validate_only THEN RETURN jsonb_build_object('qualified',true);END IF;
  -- Z14N denies the referenced request. Its prescribed omitted installation
  -- cannot be treated as an unresponded positive-only point.
  incomplete:=count_positive>0 AND(EXISTS(SELECT FROM jsonb_array_elements(gridex_received_sources.permission_partition_wire_v1(m.raw_payload)->'objects')x WHERE x->>'li'=p.rff_li_reference AND NOT EXISTS(SELECT FROM jsonb_array_elements(wire->'objects')y WHERE y=x)) OR EXISTS(SELECT FROM jsonb_array_elements(original->'objects')x WHERE x->>'li'=p.rff_li_reference AND x->>'point' IS NOT NULL AND NOT EXISTS(SELECT FROM jsonb_array_elements(wire->'objects')y WHERE y->>'point'=x->>'point' AND y->>'identityAgency' IS NOT DISTINCT FROM x->>'identityAgency')));
  next_status:=CASE WHEN count_positive=0 AND incomplete THEN p.status WHEN count_positive=0 THEN CASE negative_status WHEN 'A76' THEN 'rejected_passive_timeout' ELSE 'rejected_active' END WHEN count_negative>0 OR incomplete THEN 'partially_approved' ELSE 'active' END;
  -- Parent/site/history writes are one database transaction. Never copy one
  -- linked local site or point to every physical approved object.
  DELETE FROM public.metering_permission_sites WHERE company_id=m.company_id AND metering_permission_id=p.id AND facility_id IN(SELECT o->>'point' FROM jsonb_array_elements(wire->'objects')o WHERE o->>'status'='A74');
  FOR a IN SELECT o FROM jsonb_array_elements(wire->'objects') o WHERE o->>'status'='A74' LOOP
   INSERT INTO public.metering_permission_sites(company_id,metering_permission_id,customer_id,facility_id,grid_area_code,status,start_date,end_date,start_at,end_at,metadata)
   VALUES(m.company_id,p.id,p.customer_id,a->>'point',a->>'gridArea','approved',gridex_received_sources.permission_date_v1(a->>'reportStart'),gridex_received_sources.permission_date_v1(a->>'reportEnd'),gridex_received_sources.permission_time_v1(a->>'reportStart'),gridex_received_sources.permission_time_v1(a->>'reportEnd'),jsonb_build_object('source','inbound_prodat_z14','edielMessageId',m.id,'permissionId',a->>'permissionId','mode',mode,'product',a->>'product'));
  END LOOP;
  SELECT o INTO a FROM jsonb_array_elements(wire->'objects') o WHERE o->>'status'='A74' LIMIT 1;
  UPDATE public.metering_permissions SET status=next_status,source_z14_message_id=m.id,inbound_z14_message_id=m.id,
   permission_id=CASE WHEN count_positive=1 THEN a->>'permissionId' ELSE permission_id END,
   permission_reference=CASE WHEN count_positive=1 THEN a->>'permissionId' ELSE permission_reference END,
   approved_start_date=CASE WHEN count_positive=1 THEN gridex_received_sources.permission_date_v1(a->>'reportStart') ELSE NULL END,
   approved_end_date=CASE WHEN count_positive=1 THEN gridex_received_sources.permission_date_v1(a->>'reportEnd') ELSE NULL END,
   approved_start_at=CASE WHEN count_positive=1 THEN gridex_received_sources.permission_time_v1(a->>'reportStart') ELSE NULL END,
   approved_end_at=CASE WHEN count_positive=1 THEN gridex_received_sources.permission_time_v1(a->>'reportEnd') ELSE NULL END,
   product_code=CASE WHEN count_positive=1 THEN a->>'product' ELSE NULL END,
   report_frequency=CASE WHEN count_positive=1 THEN a->>'frequency' ELSE NULL END,
   last_blocker=CASE WHEN count_positive=0 THEN 'source_z14_denied_'||negative_status ELSE NULL END,
   metadata=coalesce(metadata,'{}')||jsonb_build_object('marketPermission',jsonb_build_object('mode',mode,'sourceZ14',m.id,'legalActor',wire->>'receiver','dsoActor',wire->>'sender','objects',wire->'objects')),
   market_state_version=market_state_version+1,updated_at=now(),updated_by=p_actor_user_id WHERE id=p.id AND company_id=m.company_id;
 ELSE
  IF public.ediel_permission_source_is_current_v1(m.company_id,p.id,coalesce(p.inbound_z14_message_id,p.source_z14_message_id)) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','permission_current_approved_source_required');END IF;
  -- Validate every physical object before mutating any of them.
  FOR a IN SELECT o FROM jsonb_array_elements(wire->'objects') o LOOP
   end_time:=gridex_received_sources.permission_time_v1(a->>'permissionEnd');
   IF end_time IS NULL OR a->>'li' IS DISTINCT FROM p.rff_li_reference OR NOT EXISTS(SELECT FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id AND ps.facility_id=a->>'point' AND ps.metadata->>'permissionId'=a->>'permissionId') THEN RETURN jsonb_build_object('applied',false,'reason','z15_permission_object_mismatch'); END IF;
   reason:=a->>'reason';
   IF reason='Z24' THEN
    IF a->>'status' IS DISTINCT FROM 'A74' THEN RETURN jsonb_build_object('applied',false,'reason','z15c_status_unqualified'); END IF;
   ELSIF reason=mode AND a->>'status' IN ('A74','A75') AND a->>'endReason' IN ('B77','B78','B79','B80','E37') THEN NULL;
   ELSE RETURN jsonb_build_object('applied',false,'reason','z15_mode_or_reason_unqualified'); END IF;
  END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE o->>'reason' IS DISTINCT FROM reason) THEN RETURN jsonb_build_object('applied',false,'reason','mixed_z15_modes'); END IF;
  IF reason='Z24' THEN
   FOR a IN SELECT o FROM jsonb_array_elements(wire->'objects')o LOOP
    SELECT tr.* INTO prior FROM gridex_received_sources.permission_effect_transitions_v1 tr WHERE tr.company_id=m.company_id AND tr.permission_id=p.id AND tr.qualified_expected_message_code='Z15'
     AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_state#>'{metadata,z15,objects}')x WHERE x->>'point'=a->>'point') ORDER BY(tr.resulting_state->>'market_state_version')::bigint DESC LIMIT 1;
    SELECT * INTO ended_source FROM public.ediel_messages WHERE id=prior.source_message_id AND company_id=m.company_id AND environment=m.environment;
    IF prior.source_message_id IS NULL OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(ended_source.raw_payload,'UTF8')),'hex') OR coalesce(prior.resulting_state->>'source_z13_message_id',prior.resulting_state->>'outbound_z13_message_id') IS DISTINCT FROM origin.id::text
     OR NOT EXISTS(SELECT FROM jsonb_array_elements(prior.resulting_state#>'{metadata,z15,objects}')x WHERE x->>'point'=a->>'point' AND x->>'permissionId'=a->>'permissionId' AND x->>'permissionEnd'=a->>'permissionEnd' AND x->>'li'=a->>'li' AND x->>'reason'=mode) THEN RETURN jsonb_build_object('applied',false,'reason','z15c_original_ending_not_bound');END IF;
    IF NOT EXISTS(SELECT FROM public.metering_permission_sites ps JOIN LATERAL jsonb_array_elements(prior.resulting_sites)s ON s->>'id'=ps.id::text WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id AND ps.facility_id=a->>'point'
     AND(to_jsonb(ps)-ARRAY['status','updated_at'])=(s-ARRAY['status','updated_at']) AND(ps.status=s->>'status' OR(ps.status='ended' AND s->>'status' IN('approved','active') AND ps.permission_end_at<=now()))) THEN RETURN jsonb_build_object('applied',false,'reason','z15c_current_own_site_snapshot_unavailable');END IF;
   END LOOP;
   IF p_validate_only THEN RETURN jsonb_build_object('qualified',true);END IF;
   -- Validate the complete selected set before its first write.
   FOR a IN SELECT o FROM jsonb_array_elements(wire->'objects')o LOOP
    SELECT tr.* INTO prior FROM gridex_received_sources.permission_effect_transitions_v1 tr WHERE tr.company_id=m.company_id AND tr.permission_id=p.id AND tr.qualified_expected_message_code='Z15' AND EXISTS(SELECT FROM jsonb_array_elements(tr.resulting_state#>'{metadata,z15,objects}')x WHERE x->>'point'=a->>'point') ORDER BY(tr.resulting_state->>'market_state_version')::bigint DESC LIMIT 1;
    UPDATE public.metering_permission_sites ps SET status=old->>'status',end_date=(old->>'end_date')::date,end_at=(old->>'end_at')::timestamptz,permission_end_at=(old->>'permission_end_at')::timestamptz,updated_at=now()
     FROM jsonb_array_elements(prior.previous_sites)old WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id AND ps.facility_id=a->>'point' AND ps.id=(old->>'id')::uuid;
   END LOOP;
   SELECT tr.resulting_state->>'status' INTO next_status FROM gridex_received_sources.permission_effect_transitions_v1 tr WHERE tr.company_id=m.company_id AND tr.permission_id=p.id AND tr.qualified_expected_message_code='Z14' ORDER BY(tr.resulting_state->>'market_state_version')::bigint DESC LIMIT 1;
   IF(next_status IN('active','approved','partially_approved','z14_received')) IS NOT TRUE THEN RAISE EXCEPTION 'z15c_original_permission_basis_unavailable';END IF;
   IF NOT EXISTS(SELECT FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id AND ps.status IN('approved','active')) THEN next_status:='ended';END IF;
   UPDATE public.metering_permissions SET status=next_status,approved_end_date=CASE WHEN jsonb_array_length(before_sites)=1 THEN(SELECT ps.end_date FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id) ELSE approved_end_date END,
    approved_end_at=CASE WHEN jsonb_array_length(before_sites)=1 THEN(SELECT ps.end_at FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id) ELSE approved_end_at END WHERE id=p.id AND company_id=m.company_id;

  ELSE
   IF p_validate_only THEN RETURN jsonb_build_object('qualified',true);END IF;
   FOR a IN SELECT o FROM jsonb_array_elements(wire->'objects') o LOOP
    end_day:=gridex_received_sources.permission_date_v1(a->>'permissionEnd');end_time:=gridex_received_sources.permission_time_v1(a->>'permissionEnd');
    UPDATE public.metering_permission_sites SET end_date=CASE WHEN end_at IS NULL OR end_time<end_at THEN end_day ELSE end_date END,end_at=least(end_at,end_time),permission_end_at=end_time,status=CASE WHEN end_time>now() THEN status ELSE 'ended' END,updated_at=now()
    WHERE company_id=m.company_id AND metering_permission_id=p.id AND facility_id=a->>'point';
   END LOOP;
   next_status:=CASE WHEN NOT EXISTS(SELECT FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id AND (ps.permission_end_at IS NULL OR ps.permission_end_at>now())) THEN 'ended' ELSE p.status END;
   UPDATE public.metering_permissions SET status=next_status,
    approved_end_date=CASE WHEN jsonb_array_length(before_sites)=1 AND (approved_end_at IS NULL OR end_time<approved_end_at) THEN end_day ELSE approved_end_date END,
    approved_end_at=CASE WHEN jsonb_array_length(before_sites)=1 THEN least(approved_end_at,end_time) ELSE approved_end_at END WHERE id=p.id AND company_id=m.company_id;
  END IF;
  UPDATE public.metering_permissions SET inbound_z15_message_id=m.id,market_state_version=market_state_version+1,updated_at=now(),updated_by=p_actor_user_id,
   metadata=coalesce(metadata,'{}')||jsonb_build_object('z15',jsonb_build_object('edielMessageId',m.id,'reason',reason,'objects',wire->'objects')) WHERE id=p.id AND company_id=m.company_id;
 END IF;
 IF wire->>'code'='Z14' THEN
  qualified_original:=origin.id;qualified_code:='Z14';
  UPDATE public.ediel_business_expectations SET status=CASE WHEN incomplete THEN 'manual_review' WHEN count_positive=0 THEN 'rejected' ELSE 'fulfilled' END,
   fulfilled_by_message_id=m.id,updated_at=now()
   WHERE company_id=m.company_id AND environment=m.environment AND source_message_id=origin.id
    AND expected_family='PRODAT' AND expected_code='Z14' AND status IN ('pending','timeout','manual_review');
 ELSIF reason=mode AND p.outbound_z18_message_id IS NOT NULL THEN
  SELECT * INTO termination FROM public.ediel_messages WHERE id=p.outbound_z18_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
  termination_wire:=gridex_received_sources.permission_wire_v1(termination.raw_payload);
  IF termination.direction='outbound' AND gridex_received_sources.sent_source_is_current_v1(termination) IS TRUE AND termination.immutable_rendered_at IS NOT NULL
   AND termination.immutable_payload_hash=encode(sha256(convert_to(termination.raw_payload,'UTF8')),'hex')
   AND termination_wire->>'code'='Z18' AND termination_wire->>'sender'=wire->>'receiver' AND termination_wire->>'receiver'=wire->>'sender'
   AND jsonb_array_length(termination_wire->'objects')=jsonb_array_length(wire->'objects')
   AND NOT EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') own WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(termination_wire->'objects') requested WHERE requested->>'reason'=mode AND requested->>'li'=own->>'li' AND requested->>'point'=own->>'point' AND requested->>'permissionId'=own->>'permissionId' AND requested->>'permissionEnd'=own->>'permissionEnd'))
   THEN qualified_original:=termination.id;
    UPDATE public.ediel_business_expectations SET status='fulfilled',fulfilled_by_message_id=m.id,updated_at=now()
    WHERE company_id=m.company_id AND environment=m.environment AND source_message_id=termination.id AND expected_family='PRODAT' AND expected_code='Z15' AND status IN ('pending','timeout','manual_review'); END IF;
 END IF;
 SELECT to_jsonb(mp) INTO after_state FROM public.metering_permissions mp WHERE id=p.id;
 INSERT INTO gridex_received_sources.permission_effect_receipts(source_message_id,company_id,permission_id,payload_hash,previous_state,previous_sites,resulting_state,actor_user_id,resulting_sites,qualified_original_message_id,qualified_expected_message_code,canonical_assessment_id,object_scopes)
 VALUES(m.id,m.company_id,p.id,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),before_state,before_sites,after_state,p_actor_user_id,(SELECT coalesce(jsonb_agg(to_jsonb(ps) ORDER BY ps.id),'[]'::jsonb) FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id),qualified_original,qualified_code,p_canonical_id,p_scopes);
 RETURN jsonb_build_object('applied',true,'permissionId',p.id,'status',next_status,'stateVersion',after_state->'market_state_version');
END $$;
ALTER FUNCTION public.ediel_apply_permission_source_v1(uuid,uuid,uuid,uuid) RENAME TO apply_permission_before_own_partition_v1;
ALTER FUNCTION public.apply_permission_before_own_partition_v1(uuid,uuid,uuid,uuid) SET SCHEMA gridex_received_sources;
REVOKE ALL ON FUNCTION gridex_received_sources.apply_permission_before_own_partition_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_apply_permission_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid,p_expected_permission_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype;prior gridex_received_sources.permission_partition_receipts%rowtype;canonical gridex_received_sources.validation_assessments%rowtype;
 application jsonb;wire jsonb;entry jsonb;own jsonb;scope jsonb;manifest jsonb:='[]';plans jsonb:='[]';selected jsonb;scopes jsonb;result jsonb;results jsonb:='[]';ids uuid[];originals uuid[];all_sources uuid[];pid uuid;first_line int;seen integer[]:='{}';local_legal jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'permission_source_service_required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR(m.message_code IN('Z14','Z15')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','permission_source_unavailable');END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM u.id FROM auth.users u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR public.gridex_actor_has_company_permission(p_actor_user_id,m.company_id,'metering.write') IS NOT TRUE OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) THEN RETURN jsonb_build_object('applied',false,'reason','permission_execution_actor_unqualified');END IF;
 -- Current execution authority is checked, but a historical fixed effect never
 -- selects today's source/guide/business basis or changes an old outcome.
 IF EXISTS(SELECT FROM gridex_received_sources.permission_transitions tr WHERE tr.source_message_id=m.id) THEN RETURN gridex_received_sources.apply_permission_before_own_partition_v1(p_company_id,m.id,p_actor_user_id,p_expected_permission_id);END IF;
 SELECT * INTO prior FROM gridex_received_sources.permission_partition_receipts WHERE source_message_id=m.id FOR SHARE;
 IF FOUND THEN
  IF prior.company_id IS DISTINCT FROM m.company_id OR prior.environment IS DISTINCT FROM m.environment OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR(p_expected_permission_id IS NOT NULL AND NOT EXISTS(SELECT FROM jsonb_array_elements(prior.manifest)x WHERE x->>'permissionId'=p_expected_permission_id::text)) THEN RAISE EXCEPTION 'permission_partition_replay_conflict';END IF;
  RETURN prior.result||jsonb_build_object('idempotent',true);
 END IF;
 wire:=gridex_received_sources.permission_partition_wire_v1(m.raw_payload);
 IF wire IS NULL OR wire->>'code' IS DISTINCT FROM m.message_code THEN RETURN jsonb_build_object('applied',false,'reason','permission_wire_unavailable');END IF;
 local_legal:=gridex_ediel_inbound_context.require_v1(m.company_id,m.id);
 IF local_legal->>'actorRole' IS DISTINCT FROM 'energy_service_company' OR local_legal->>'legalEdielId' IS DISTINCT FROM wire->>'receiver' OR local_legal->>'environment' IS DISTINCT FROM m.environment OR local_legal->>'family' IS DISTINCT FROM 'PRODAT' OR local_legal->>'code' IS DISTINCT FROM m.message_code THEN RETURN jsonb_build_object('applied',false,'reason','permission_frozen_legal_context_required');END IF;
 application:=gridex_received_sources.require_prodat_application_objects_v1(m.company_id,m.id);
 SELECT * INTO canonical FROM gridex_received_sources.validation_assessments WHERE id=(application->>'assessmentId')::uuid AND company_id=m.company_id AND source_message_id=m.id AND environment=m.environment FOR SHARE;
 IF canonical.id IS NULL OR application->>'headerDecision' IS DISTINCT FROM 'accepted' OR canonical.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR canonical.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR canonical.facts_text::jsonb->>'functionalDecision' IS DISTINCT FROM 'accepted' THEN RETURN jsonb_build_object('applied',false,'reason','permission_own_application_and_global_function_required');END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(application->'objects') LOOP
  scope:=entry-'applicationDecision'-'reasonCodes';first_line:=(entry#>>'{registers,0,segmentIndex}')::integer;
  SELECT value INTO own FROM jsonb_array_elements(wire->'objects') WHERE(value->>'firstLineIndex')::integer=first_line AND value->>'point' IS NOT DISTINCT FROM entry->>'objectId' AND value->>'identityAgency' IS NOT DISTINCT FROM entry->>'identityAgency';
  IF own IS NULL OR entry->>'messageIndex' IS DISTINCT FROM '0' OR entry->>'messageReference' IS DISTINCT FROM wire->>'messageReference' OR(SELECT jsonb_agg((r->>'segmentIndex')::integer ORDER BY(r->>'segmentIndex')::integer) FROM jsonb_array_elements(entry->'registers')r) IS DISTINCT FROM(SELECT jsonb_agg(value ORDER BY(value#>>'{}')::integer) FROM jsonb_array_elements(own->'lineIndexes')value) THEN RAISE EXCEPTION 'permission_complete_physical_partition_required';END IF;
  seen:=array_append(seen,first_line);ids:=NULL;
  IF entry->>'applicationDecision'='accepted' AND own->>'projectionHeld' IS DISTINCT FROM 'true' AND gridex_received_sources.prodat_application_object_accepted_v1(m.company_id,m.id,canonical.id,scope) IS TRUE THEN
   -- Discovery selects exact retained own originals. It grants no authority.
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.metering_permissions p JOIN public.ediel_messages z ON z.id=coalesce(p.source_z13_message_id,p.outbound_z13_message_id) AND z.company_id=p.company_id AND z.environment=m.environment WHERE p.company_id=m.company_id AND p.rff_li_reference=own->>'li' AND nullif(own->>'li','') IS NOT NULL;
  END IF;
  IF cardinality(ids)=1 THEN plans:=plans||jsonb_build_array(jsonb_build_object('permissionId',ids[1],'object',own,'scope',scope));manifest:=manifest||jsonb_build_array(jsonb_build_object('object',scope,'status','eligible','permissionId',ids[1]));
  ELSE manifest:=manifest||jsonb_build_array(jsonb_build_object('object',scope,'status',CASE WHEN entry->>'applicationDecision'='rejected' THEN 'rejected' ELSE 'held' END,'reason',CASE WHEN entry->>'applicationDecision'='accepted' THEN 'permission_independent_source_unavailable' ELSE 'own_application_not_accepted' END));END IF;
 END LOOP;
 IF p_expected_permission_id IS NOT NULL AND NOT EXISTS(SELECT FROM jsonb_array_elements(plans)x WHERE x->>'permissionId'=p_expected_permission_id::text) THEN RETURN jsonb_build_object('applied',false,'reason','expected_permission_source_scope_unavailable');END IF;
 IF cardinality(seen)<>jsonb_array_length(wire->'objects') OR EXISTS(SELECT FROM jsonb_array_elements(wire->'objects')x WHERE NOT(x->>'firstLineIndex')::int=ANY(seen)) THEN RAISE EXCEPTION 'permission_complete_physical_partition_required';END IF;
 SELECT array_agg(DISTINCT(x->>'permissionId')::uuid ORDER BY(x->>'permissionId')::uuid) INTO ids FROM jsonb_array_elements(plans)x;
 SELECT array_agg(DISTINCT source ORDER BY source) INTO all_sources FROM(
  SELECT coalesce(p.source_z13_message_id,p.outbound_z13_message_id) source FROM public.metering_permissions p WHERE p.company_id=m.company_id AND p.id=ANY(ids)
  UNION SELECT p.outbound_z18_message_id FROM public.metering_permissions p WHERE p.company_id=m.company_id AND p.id=ANY(ids)
  UNION SELECT tr.source_message_id FROM gridex_received_sources.permission_effect_transitions_v1 tr WHERE tr.company_id=m.company_id AND tr.permission_id=ANY(ids)
 )s WHERE source IS NOT NULL;
 IF coalesce(cardinality(all_sources),0)>16384 THEN RETURN jsonb_build_object('applied',false,'reason','permission_source_history_budget_held');END IF;
 -- Match all genuine sources before any permission/site lock or first effect.
 PERFORM s.id FROM public.ediel_messages s WHERE s.company_id=m.company_id AND s.id=ANY(all_sources) ORDER BY s.id FOR UPDATE;
 PERFORM p.id FROM public.metering_permissions p WHERE p.company_id=m.company_id AND p.id=ANY(ids) ORDER BY p.id FOR UPDATE;
 PERFORM s.id FROM public.metering_permission_sites s WHERE s.company_id=m.company_id AND s.metering_permission_id=ANY(ids) ORDER BY s.id FOR UPDATE;
 IF EXISTS(SELECT FROM public.metering_permissions p WHERE p.company_id=m.company_id AND p.id=ANY(ids) AND((coalesce(p.source_z13_message_id,p.outbound_z13_message_id) IS NOT NULL AND NOT coalesce(p.source_z13_message_id,p.outbound_z13_message_id)=ANY(coalesce(all_sources,'{}'::uuid[]))) OR(p.outbound_z18_message_id IS NOT NULL AND NOT p.outbound_z18_message_id=ANY(coalesce(all_sources,'{}'::uuid[]))))) OR EXISTS(SELECT FROM gridex_received_sources.permission_effect_transitions_v1 tr WHERE tr.company_id=m.company_id AND tr.permission_id=ANY(ids) AND NOT tr.source_message_id=ANY(coalesce(all_sources,'{}'::uuid[]))) THEN RETURN jsonb_build_object('applied',false,'reason','permission_locked_source_cohort_changed');END IF;
 -- The same owner performs its complete independent business/source checks
 -- without writes for each scope, then atomically commits the qualified set.
 FOR entry IN SELECT value FROM jsonb_array_elements(plans) LOOP
  result:=gridex_received_sources.apply_permission_group_v1(m.company_id,m.id,p_actor_user_id,(entry->>'permissionId')::uuid,(wire-'objects')||jsonb_build_object('objects',jsonb_build_array(entry->'object')),canonical.id,jsonb_build_array(entry->'scope'),true);
  IF result->>'qualified' IS DISTINCT FROM 'true' THEN
   SELECT coalesce(jsonb_agg(x ORDER BY(x#>>'{object,firstLineIndex}')::integer),'[]') INTO plans FROM jsonb_array_elements(plans)x WHERE x->'scope' IS DISTINCT FROM entry->'scope';
   SELECT jsonb_agg(CASE WHEN x->'object'=entry->'scope' THEN x||jsonb_build_object('status','held','reason',coalesce(result->>'reason','permission_independent_business_source_held')) ELSE x END ORDER BY(x#>>'{object,registers,0,segmentIndex}')::int) INTO manifest FROM jsonb_array_elements(manifest)x;
  END IF;
 END LOOP;
 SELECT array_agg(DISTINCT(x->>'permissionId')::uuid ORDER BY(x->>'permissionId')::uuid) INTO ids FROM jsonb_array_elements(plans)x;
 FOREACH pid IN ARRAY coalesce(ids,'{}'::uuid[]) LOOP
  SELECT jsonb_agg(x->'object' ORDER BY(x#>>'{object,firstLineIndex}')::integer),jsonb_agg(x->'scope' ORDER BY(x#>>'{object,firstLineIndex}')::integer) INTO selected,scopes FROM jsonb_array_elements(plans)x WHERE x->>'permissionId'=pid::text;
  result:=gridex_received_sources.apply_permission_group_v1(m.company_id,m.id,p_actor_user_id,pid,(wire-'objects')||jsonb_build_object('objects',selected),canonical.id,scopes);
  results:=results||jsonb_build_array(result||jsonb_build_object('permissionId',pid));
  SELECT jsonb_agg(x||CASE WHEN x->>'permissionId'=pid::text AND x->>'status'='eligible' THEN jsonb_build_object('status',CASE WHEN result->>'applied'='true' THEN 'applied' ELSE 'held' END,'reason',CASE WHEN result->>'applied'='true' THEN NULL ELSE result->>'reason' END) ELSE '{}'::jsonb END ORDER BY(x#>>'{object,registers,0,segmentIndex}')::int) INTO manifest FROM jsonb_array_elements(manifest)x;

 END LOOP;
 result:=jsonb_build_object('version',1,'applied',EXISTS(SELECT FROM gridex_received_sources.permission_effect_receipts e WHERE e.source_message_id=m.id AND e.company_id=m.company_id),'permissionId',CASE WHEN cardinality(ids)=1 AND EXISTS(SELECT FROM gridex_received_sources.permission_effect_receipts e WHERE e.source_message_id=m.id AND e.permission_id=ids[1]) THEN ids[1] ELSE NULL END,'status',CASE WHEN jsonb_array_length(results)=1 THEN results#>>'{0,status}' ELSE NULL END,'reason',CASE WHEN NOT EXISTS(SELECT FROM gridex_received_sources.permission_effect_receipts e WHERE e.source_message_id=m.id) THEN 'permission_no_qualified_object' ELSE NULL END,'manifest',manifest,'permissionResults',results,'sourceMessageId',m.id,'sourceCode',m.message_code,'canonicalAssessmentId',canonical.id,'sourcePayloadHash',canonical.source_payload_hash,'idempotent',false);
 INSERT INTO gridex_received_sources.permission_partition_receipts VALUES(m.id,m.company_id,m.environment,canonical.source_payload_hash,canonical.id,manifest,result,p_actor_user_id,clock_timestamp());
 RETURN result;
END$$;
-- Current permission authority reads the same atomic legacy/own-scope ledger.
-- A public status or mutable site row alone is never an approval basis.
CREATE OR REPLACE FUNCTION public.ediel_permission_source_is_current_v1(p_company_id uuid,p_permission_id uuid,p_source_z14_message_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE p public.metering_permissions%rowtype;tr gridex_received_sources.permission_effect_transitions_v1%rowtype;approval gridex_received_sources.permission_effect_transitions_v1%rowtype;m public.ediel_messages%rowtype;s public.metering_permission_sites%rowtype;wire jsonb;own jsonb;saved jsonb;k text;
 fields text[]:=ARRAY['company_id','customer_id','source_z13_message_id','outbound_z13_message_id','source_z14_message_id','inbound_z14_message_id','inbound_z15_message_id','rff_li_reference','grid_owner_ediel_id','permission_id','permission_reference','approved_start_date','approved_end_date','approved_start_at','approved_end_at','product_code','report_frequency','market_state_version'];
BEGIN
 SELECT * INTO p FROM public.metering_permissions WHERE id=p_permission_id AND company_id=p_company_id;
 IF p.id IS NULL OR coalesce(p.inbound_z14_message_id,p.source_z14_message_id) IS DISTINCT FROM p_source_z14_message_id OR p_source_z14_message_id IS NULL THEN RETURN false;END IF;
 IF(SELECT count(*) FROM gridex_received_sources.permission_effect_transitions_v1 x WHERE x.company_id=p.company_id AND x.permission_id=p.id AND(x.resulting_state->>'market_state_version')::bigint=p.market_state_version)<>1 THEN RETURN false;END IF;
 SELECT * INTO tr FROM gridex_received_sources.permission_effect_transitions_v1 x WHERE x.company_id=p.company_id AND x.permission_id=p.id AND(x.resulting_state->>'market_state_version')::bigint=p.market_state_version;
 FOREACH k IN ARRAY fields LOOP IF to_jsonb(p)->k IS DISTINCT FROM tr.resulting_state->k THEN RETURN false;END IF;END LOOP;
 IF p.metadata->'marketPermission' IS DISTINCT FROM tr.resulting_state#>'{metadata,marketPermission}' OR p.metadata->'z15' IS DISTINCT FROM tr.resulting_state#>'{metadata,z15}' THEN RETURN false;END IF;
 IF p.status IS DISTINCT FROM tr.resulting_state->>'status' AND(p.status='ended' AND tr.resulting_state->>'status' IN('active','approved','partially_approved','z14_received') AND NOT EXISTS(SELECT FROM public.metering_permission_sites x WHERE x.company_id=p.company_id AND x.metering_permission_id=p.id AND x.status IN('approved','active'))) IS NOT TRUE THEN RETURN false;END IF;
 IF tr.resulting_sites IS NULL OR jsonb_typeof(tr.resulting_sites) IS DISTINCT FROM 'array' OR(SELECT count(*) FROM public.metering_permission_sites x WHERE x.company_id=p.company_id AND x.metering_permission_id=p.id)<>jsonb_array_length(tr.resulting_sites) THEN RETURN false;END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=tr.source_message_id AND company_id=p.company_id;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR tr.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RETURN false;END IF;
 FOR s IN SELECT * FROM public.metering_permission_sites x WHERE x.company_id=p.company_id AND x.metering_permission_id=p.id LOOP
  SELECT value INTO saved FROM jsonb_array_elements(tr.resulting_sites)WHERE value->>'id'=s.id::text;
  IF saved IS NULL OR to_jsonb(s)-ARRAY['status','updated_at'] IS DISTINCT FROM saved-ARRAY['status','updated_at'] OR(s.status IS DISTINCT FROM saved->>'status' AND(s.status='ended' AND saved->>'status' IN('approved','active') AND s.permission_end_at<=now()) IS NOT TRUE) THEN RETURN false;END IF;
  -- Unapproved held objects remain present but cannot become beneficiary access.
  IF s.status IN('approved','active','ended') THEN
   IF s.metadata->>'source' IS DISTINCT FROM 'inbound_prodat_z14' OR s.customer_id IS DISTINCT FROM p.customer_id OR s.metadata->>'edielMessageId' IS NULL THEN RETURN false;END IF;
   SELECT * INTO approval FROM gridex_received_sources.permission_effect_transitions_v1 x WHERE x.company_id=p.company_id AND x.permission_id=p.id AND x.source_message_id::text=s.metadata->>'edielMessageId' AND x.qualified_expected_message_code='Z14';
   SELECT * INTO m FROM public.ediel_messages WHERE id=approval.source_message_id AND company_id=p.company_id;
   IF approval.source_message_id IS NULL OR m.message_code IS DISTINCT FROM 'Z14' OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR approval.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RETURN false;END IF;
   wire:=gridex_received_sources.permission_partition_wire_v1(m.raw_payload);
   IF wire IS NULL OR(SELECT count(*) FROM jsonb_array_elements(wire->'objects')x WHERE x->>'point'=s.facility_id AND x->>'permissionId'=s.metadata->>'permissionId' AND x->>'status'='A74' AND x->>'projectionHeld' IS DISTINCT FROM 'true')<>1 THEN RETURN false;END IF;
   SELECT value INTO own FROM jsonb_array_elements(wire->'objects') WHERE value->>'point'=s.facility_id AND value->>'permissionId'=s.metadata->>'permissionId' AND value->>'status'='A74';
   IF s.metadata->>'mode' IS DISTINCT FROM own->>'reason' OR s.metadata->>'product' IS DISTINCT FROM own->>'product' OR s.start_at IS DISTINCT FROM gridex_received_sources.permission_time_v1(own->>'reportStart') OR s.start_date IS DISTINCT FROM gridex_received_sources.permission_date_v1(own->>'reportStart') OR s.grid_area_code IS DISTINCT FROM own->>'gridArea' OR(gridex_received_sources.permission_time_v1(own->>'reportEnd') IS NOT NULL AND(s.end_at IS NULL OR s.end_at>gridex_received_sources.permission_time_v1(own->>'reportEnd'))) THEN RETURN false;END IF;
   IF EXISTS(SELECT FROM gridex_received_sources.permission_effect_receipts e WHERE e.source_message_id=m.id AND e.permission_id=p.id) THEN
    IF NOT EXISTS(SELECT FROM gridex_received_sources.permission_effect_receipts e JOIN gridex_received_sources.validation_assessments v ON v.id=e.canonical_assessment_id WHERE e.source_message_id=m.id AND e.permission_id=p.id AND v.company_id=p.company_id AND v.source_message_id=m.id AND v.environment=m.environment AND v.source_payload_hash=approval.payload_hash AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id) AND EXISTS(SELECT FROM jsonb_array_elements(e.object_scopes)x WHERE x->>'objectId'=own->>'point' AND x->>'identityAgency' IS NOT DISTINCT FROM own->>'identityAgency' AND gridex_received_sources.prodat_application_object_accepted_v1(p.company_id,m.id,v.id,x) IS TRUE)) THEN RETURN false;END IF;
   ELSE
    IF NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=m.id AND v.company_id=p.company_id AND v.environment=m.environment AND v.source_payload_hash=approval.payload_hash AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND v.facts_text::jsonb->>'applicationDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted' AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN false;END IF;
   END IF;
  END IF;
 END LOOP;
 RETURN true;
END$$;
-- Only durable, already committed permission effects can support final replies.
-- It neither projects a new effect nor treats an ACK as permission evidence.
CREATE FUNCTION gridex_received_sources.committed_permission_effects_v1(c uuid,source_id uuid,requested integer[] DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;e gridex_received_sources.permission_effect_receipts%rowtype;v gridex_received_sources.validation_assessments%rowtype;f gridex_received_sources.prodat_application_facets%rowtype;r gridex_received_sources.prodat_response_facets%rowtype;scope jsonb;result jsonb:='[]';tx text:=(mod(pg_current_xact_id_if_assigned()::text::numeric,4294967296))::text;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=source_id AND company_id=c;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR(m.message_code IN('Z14','Z15')) IS NOT TRUE THEN RETURN result;END IF;
 IF requested IS NOT NULL AND(cardinality(requested) NOT BETWEEN 1 AND 8192 OR EXISTS(SELECT FROM unnest(requested)x WHERE x IS NULL OR x<0) OR cardinality(requested)<>(SELECT count(DISTINCT x) FROM unnest(requested)x)) THEN RAISE EXCEPTION 'permission_final_response_scope_required';END IF;
 FOR e IN SELECT x.* FROM gridex_received_sources.permission_effect_receipts x WHERE x.source_message_id=m.id AND x.company_id=c AND(tx IS NULL OR x.xmin::text<>tx) ORDER BY x.permission_id LOOP
  SELECT * INTO v FROM gridex_received_sources.validation_assessments WHERE id=e.canonical_assessment_id;
  SELECT * INTO f FROM gridex_received_sources.prodat_application_facets WHERE assessment_id=v.id AND company_id=c AND source_message_id=m.id;
  SELECT * INTO r FROM gridex_received_sources.prodat_response_facets WHERE assessment_id=v.id;
  IF e.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR v.company_id IS DISTINCT FROM c OR v.source_message_id IS DISTINCT FROM m.id OR v.environment IS DISTINCT FROM m.environment OR v.source_payload_hash IS DISTINCT FROM e.payload_hash OR v.owner IS DISTINCT FROM 'canonical-runtime-with-registry-v1' OR v.facts_hash IS DISTINCT FROM encode(sha256(convert_to(v.facts_text,'UTF8')),'hex') OR f.assessment_id IS NULL OR f.environment IS DISTINCT FROM m.environment OR f.source_payload_hash IS DISTINCT FROM e.payload_hash OR f.application_facts_hash IS DISTINCT FROM encode(sha256(convert_to(f.application_facts_text,'UTF8')),'hex') OR r.assessment_id IS NULL OR r.company_id IS DISTINCT FROM c OR r.source_message_id IS DISTINCT FROM m.id OR r.environment IS DISTINCT FROM m.environment OR r.source_payload_hash IS DISTINCT FROM e.payload_hash OR r.response_facts_hash IS DISTINCT FROM encode(sha256(convert_to(r.response_facts_text,'UTF8')),'hex') OR gridex_received_sources.validate_prodat_application_v1(m.raw_payload,v.facts_text::jsonb,f.application_facts_text::jsonb,r.response_facts_text::jsonb) IS NOT TRUE OR v.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR v.facts_text::jsonb->>'functionalDecision' IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'permission_committed_effect_source_conflict';END IF;
  FOR scope IN SELECT value FROM jsonb_array_elements(e.object_scopes) LOOP
   IF requested IS NOT NULL AND NOT(scope#>>'{registers,0,segmentIndex}')::integer=ANY(requested) THEN CONTINUE;END IF;
   IF NOT EXISTS(SELECT FROM jsonb_array_elements(f.application_facts_text::jsonb->'objects')object WHERE object-'applicationDecision'-'reasonCodes'=scope AND object->>'applicationDecision'='accepted') THEN RAISE EXCEPTION 'permission_committed_own_application_conflict';END IF;
   result:=result||jsonb_build_array(jsonb_build_object('receiptId',e.id,'canonicalAssessmentId',v.id,'sourcePayloadHash',e.payload_hash,'objectScope',scope,'appliedAt',e.applied_at,'effectKind','metering_permission','effectFactsHash',encode(sha256(convert_to(jsonb_build_object('previousState',e.previous_state,'previousSites',e.previous_sites,'resultingState',e.resulting_state,'resultingSites',e.resulting_sites,'sourceOriginalId',e.qualified_original_message_id,'objectScopes',e.object_scopes)::text,'UTF8')),'hex')));
  END LOOP;
 END LOOP;
 IF requested IS NOT NULL AND cardinality(requested)<>jsonb_array_length(result) THEN RAISE EXCEPTION 'permission_final_response_own_effect_uncommitted';END IF;
 RETURN result;
END$$;
-- Timer projection reads the same locked source snapshot; malformed unrelated
-- physical objects do not erase an already approved own end timestamp.
CREATE OR REPLACE FUNCTION public.ediel_advance_permission_deadlines_v1(p_actor_user_id uuid,p_company_id uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE pid uuid;p public.metering_permissions%rowtype;tr gridex_received_sources.permission_effect_transitions_v1%rowtype;changed integer:=0;rows_changed integer;source_ids uuid[];
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'permission_source_service_required' USING ERRCODE='42501';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') THEN RAISE EXCEPTION 'permission_execution_actor_unqualified' USING ERRCODE='42501';END IF;
 FOR pid IN SELECT x.id FROM public.metering_permissions x WHERE(p_company_id IS NULL OR x.company_id=p_company_id) AND x.inbound_z15_message_id IS NOT NULL AND x.status IN('active','approved','partially_approved','z14_received') AND EXISTS(SELECT FROM public.metering_permission_sites s WHERE s.company_id=x.company_id AND s.metering_permission_id=x.id AND s.status IN('approved','active') AND s.permission_end_at<=now()) ORDER BY x.id LIMIT least(greatest(coalesce(p_limit,100),1),200) LOOP
  SELECT array_agg(DISTINCT x.source_message_id ORDER BY x.source_message_id) INTO source_ids FROM gridex_received_sources.permission_effect_transitions_v1 x WHERE x.permission_id=pid;
  PERFORM m.id FROM public.ediel_messages m WHERE m.id=ANY(source_ids) ORDER BY m.id FOR UPDATE;
  SELECT * INTO p FROM public.metering_permissions WHERE id=pid FOR UPDATE SKIP LOCKED;
  IF p.id IS NULL THEN CONTINUE;END IF;
  PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=p.company_id AND cm.user_id=p_actor_user_id FOR SHARE;
  IF public.gridex_actor_has_company_permission(p_actor_user_id,p.company_id,'metering.write') IS NOT TRUE OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) THEN CONTINUE;END IF;
  PERFORM s.id FROM public.metering_permission_sites s WHERE s.company_id=p.company_id AND s.metering_permission_id=p.id ORDER BY s.id FOR UPDATE;
  IF public.ediel_permission_source_is_current_v1(p.company_id,p.id,coalesce(p.inbound_z14_message_id,p.source_z14_message_id)) IS NOT TRUE THEN CONTINUE;END IF;
  SELECT * INTO tr FROM gridex_received_sources.permission_effect_transitions_v1 x WHERE x.company_id=p.company_id AND x.permission_id=p.id AND(x.resulting_state->>'market_state_version')::bigint=p.market_state_version;
  UPDATE public.metering_permission_sites s SET status='ended',updated_at=now() FROM jsonb_array_elements(tr.resulting_sites)own WHERE s.company_id=p.company_id AND s.metering_permission_id=p.id AND own->>'id'=s.id::text AND s.status IN('approved','active') AND own->>'status' IN('approved','active') AND s.permission_end_at IS NOT NULL AND s.permission_end_at=(own->>'permission_end_at')::timestamptz AND s.permission_end_at<=now();
  GET DIAGNOSTICS rows_changed=ROW_COUNT;changed:=changed+rows_changed;
  IF NOT EXISTS(SELECT FROM public.metering_permission_sites s WHERE s.company_id=p.company_id AND s.metering_permission_id=p.id AND s.status IN('approved','active')) THEN UPDATE public.metering_permissions SET status='ended',updated_at=now(),updated_by=p_actor_user_id WHERE id=p.id AND company_id=p.company_id AND market_state_version=p.market_state_version;END IF;
 END LOOP;
 RETURN jsonb_build_object('updated',changed);
END$$;
REVOKE ALL ON FUNCTION gridex_received_sources.permission_partition_wire_v1(text),gridex_received_sources.apply_permission_group_v1(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb,boolean),gridex_received_sources.committed_permission_effects_v1(uuid,uuid,integer[]) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_apply_permission_source_v1(uuid,uuid,uuid,uuid),public.ediel_permission_source_is_current_v1(uuid,uuid,uuid),public.ediel_advance_permission_deadlines_v1(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_apply_permission_source_v1(uuid,uuid,uuid,uuid),public.ediel_permission_source_is_current_v1(uuid,uuid,uuid),public.ediel_advance_permission_deadlines_v1(uuid,uuid,integer) TO service_role;
COMMIT;
