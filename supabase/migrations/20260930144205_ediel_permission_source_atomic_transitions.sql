-- Forward source-bound ESCO transitions. Canonical validation remains the rule
-- authority; this decoder projects only fields applicable to market permissions.
BEGIN;
CREATE FUNCTION gridex_received_sources.wire_tokens_bounded_v1(p_raw text,p_max_lines integer)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE
 component_sep text:=':'; data_sep text:='+'; release_char text:='?'; terminator text:='''';
 decimal_mark text:='.'; reserved text:=' '; body text; ch text; chars text[];
 released boolean:=false; current_component text:=''; current_element jsonb:='[]'; elements jsonb:='[]';
 result jsonb:='[]'; tag text; segment_count integer:=0; line_count integer:=0;
 component_size integer:=0; component_count integer:=0; element_count integer:=0;
BEGIN
 IF (p_max_lines BETWEEN 1 AND 999999) IS NOT TRUE OR p_raw IS NULL OR octet_length(p_raw)>262144 THEN RETURN NULL; END IF;
 -- Read advice before CRLF/LF normalization. No inferred repetition grammar.
 body:=p_raw;
 IF upper(left(body,3))='UNA' THEN
  IF left(body,3)<>'UNA' OR char_length(body)<9 THEN RETURN NULL; END IF;
  component_sep:=substr(body,4,1);data_sep:=substr(body,5,1);decimal_mark:=substr(body,6,1);
  release_char:=substr(body,7,1);reserved:=substr(body,8,1);terminator:=substr(body,9,1);body:=substr(body,10);
 END IF;
 IF reserved<>' ' OR decimal_mark NOT IN ('.',',')
 OR decimal_mark=ANY(ARRAY[component_sep,data_sep,release_char,terminator])
 OR (SELECT count(DISTINCT value) FROM unnest(ARRAY[component_sep,data_sep,release_char,terminator]) value)<>4
 OR EXISTS(SELECT FROM unnest(ARRAY[component_sep,data_sep,release_char,terminator]) value
   WHERE ascii(value)<33 OR ascii(value)>126 OR value ~ '[A-Za-z0-9]') THEN RETURN NULL; END IF;
 body:=replace(replace(body,E'\r\n',''),E'\n','');
 IF strpos(body,E'\r')>0 OR right(body,1)<>terminator THEN RETURN NULL; END IF;
 -- NULL delimiter enumerates code points, NOT segments/elements. Exactly one
 -- state machine consumes these; decoded literals are never split again.
 chars:=string_to_array(body,NULL);
 FOREACH ch IN ARRAY chars LOOP
  IF released THEN
   current_component:=current_component||ch;component_size:=component_size+1;released:=false;
  ELSIF ch=release_char THEN released:=true;
  ELSIF ch=component_sep OR ch=data_sep OR ch=terminator THEN
   -- Match canonical leading segment trim. Other whitespace forms are held
   -- explicitly; in particular a released trailing space must not be trimmed.
   IF elements='[]'::jsonb AND current_element='[]'::jsonb THEN current_component:=ltrim(current_component,E' \t'); END IF;
   IF ch=terminator AND current_component<>rtrim(current_component,E' \t') THEN RETURN NULL; END IF;
   IF ch=terminator AND elements='[]'::jsonb AND current_element='[]'::jsonb AND current_component='' THEN CONTINUE; END IF;
   current_element:=current_element||jsonb_build_array(current_component);component_count:=component_count+1;
   current_component:='';component_size:=0;
   IF component_count>128 THEN RETURN NULL; END IF;
   IF ch<>component_sep THEN
    elements:=elements||jsonb_build_array(current_element);element_count:=element_count+1;
    current_element:='[]';component_count:=0;
    IF element_count>128 THEN RETURN NULL; END IF;
   END IF;
   IF ch=terminator THEN
    tag:=elements#>>'{0,0}';
    IF jsonb_array_length(elements->0)<>1 OR tag !~ '^[A-Z]{3}$' OR tag='UNA' THEN RETURN NULL; END IF;
    IF tag='LIN' THEN line_count:=line_count+1; END IF;
    IF segment_count>=4096 OR line_count>p_max_lines THEN RETURN NULL; END IF;
    result:=result||jsonb_build_array(jsonb_build_object('index',segment_count,'tag',tag,'elements',elements));
    segment_count:=segment_count+1;elements:='[]';element_count:=0;
   END IF;
  ELSE current_component:=current_component||ch;component_size:=component_size+1;
  END IF;
  IF component_size>4096 THEN RETURN NULL; END IF;
 END LOOP;
 IF released OR current_component<>'' OR elements<>'[]'::jsonb OR current_element<>'[]'::jsonb THEN RETURN NULL; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.wire_tokens_bounded_v1(text,integer) FROM PUBLIC,anon,authenticated,service_role;
-- Keep the existing closure budget unchanged; permission scopes use the same
-- neutral lexer without the unrelated sixteen-object closure budget. Canonical
-- validation owns national/UNSM occurrence limits. Over-budget payloads return
-- NULL as a whole; no prefix can be used as permission authority.
CREATE OR REPLACE FUNCTION gridex_received_sources.closure_wire_tokens_v1(p_raw text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT gridex_received_sources.wire_tokens_bounded_v1(p_raw,16)
$$;
REVOKE ALL ON FUNCTION gridex_received_sources.closure_wire_tokens_v1(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_received_sources.closure_wire_tokens_v2(p_raw text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT gridex_received_sources.wire_tokens_bounded_v1(p_raw,999999)
$$;
REVOKE ALL ON FUNCTION gridex_received_sources.closure_wire_tokens_v2(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_received_sources.permission_wire_v1(p_raw text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(p_raw); t jsonb; e jsonb;
 out jsonb:='{}'; objects jsonb:='[]'; obj jsonb; characteristic text; key text; value text;
BEGIN
 IF tokens IS NULL THEN RETURN NULL; END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens) x ORDER BY (x->>'index')::int LOOP
  e:=t->'elements';
  IF t->>'tag'='BGM' THEN out:=out||jsonb_build_object('code',e#>>'{1,0}'); END IF;
  IF t->>'tag'='NAD' AND obj IS NULL AND e#>>'{1,0}' IN ('FR','DO') THEN
   key:=CASE e#>>'{1,0}' WHEN 'FR' THEN 'sender' ELSE 'receiver' END;
   IF out ? key OR e#>>'{2,1}' IS DISTINCT FROM '160' OR e#>>'{2,2}' IS DISTINCT FROM 'SVK' THEN RETURN NULL; END IF;
   out:=out||jsonb_build_object(key,e#>>'{2,0}');
  END IF;
  IF t->>'tag'='LIN' THEN
   IF obj IS NOT NULL THEN objects:=objects||jsonb_build_array(obj); END IF;
   obj:=jsonb_build_object('point',nullif(e#>>'{3,0}',''),'line',e#>>'{1,0}'); characteristic:=NULL;
  ELSIF obj IS NOT NULL THEN
   key:=NULL;value:=NULL;
   IF t->>'tag'='RFF' AND e#>>'{1,0}' IN ('LI','Z09','Z05') THEN
    key:=CASE e#>>'{1,0}' WHEN 'LI' THEN 'li' WHEN 'Z09' THEN 'permissionId' ELSE 'gridArea' END;value:=e#>>'{1,1}';
   ELSIF t->>'tag'='NAD' AND e#>>'{1,0}'='UD' THEN key:='customerIdentity';value:=e#>>'{2,0}';
   ELSIF t->>'tag'='DTM' AND e#>>'{1,0}' IN ('90','91','693','164') THEN
    key:=CASE e#>>'{1,0}' WHEN '90' THEN 'reportStart' WHEN '91' THEN 'reportEnd' WHEN '693' THEN 'permissionTime' ELSE 'permissionEnd' END;
    value:=e#>>'{1,1}';
    IF (e#>>'{1,2}' IN ('102','203','303')) IS NOT TRUE THEN RETURN NULL; END IF;
   ELSIF t->>'tag'='CCI' THEN characteristic:=e#>>'{2,0}';
   ELSIF t->>'tag'='CAV' THEN
    key:=CASE characteristic WHEN 'Z13' THEN 'reason' WHEN 'Z23' THEN 'status' WHEN 'Z24' THEN 'purpose' WHEN 'Z25' THEN 'endReason' WHEN 'Z12' THEN 'frequency' WHEN 'Z14' THEN 'product' END;
    value:=CASE characteristic WHEN 'Z12' THEN e#>>'{1,3}' WHEN 'Z14' THEN e#>>'{1,4}' ELSE e#>>'{1,0}' END;
   END IF;
   IF key IS NOT NULL THEN
    IF obj ? key THEN RETURN NULL; END IF;
    obj:=obj||jsonb_build_object(key,nullif(value,''));
   END IF;
  END IF;
 END LOOP;
 IF obj IS NOT NULL THEN objects:=objects||jsonb_build_array(obj); END IF;
 IF (out->>'code' IN ('Z13','Z14','Z15','Z18')) IS NOT TRUE OR nullif(out->>'sender','') IS NULL OR nullif(out->>'receiver','') IS NULL OR jsonb_array_length(objects)=0 THEN RETURN NULL; END IF;
 RETURN out||jsonb_build_object('objects',objects);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.permission_wire_v1(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_received_sources.permission_date_v1(p_value text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE result date;
BEGIN
 IF p_value IS NULL THEN RETURN NULL; END IF;
 IF p_value !~ '^[0-9]{8}([0-9]{4}([+-][0-9]{4})?)?$' THEN RETURN NULL; END IF;
 result:=to_date(substr(p_value,1,8),'YYYYMMDD');
 IF to_char(result,'YYYYMMDD')<>substr(p_value,1,8) THEN RETURN NULL; END IF;
 RETURN result;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.permission_date_v1(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_received_sources.permission_time_v1(p_value text)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE result timestamptz; value text;
BEGIN
 IF p_value IS NULL OR p_value !~ '^[0-9]{12}$' OR gridex_received_sources.permission_date_v1(p_value) IS NULL THEN RETURN NULL; END IF;
 value:=substr(p_value,1,4)||'-'||substr(p_value,5,2)||'-'||substr(p_value,7,2)||'T'||substr(p_value,9,2)||':'||substr(p_value,11,2)||':00+01:00';
 result:=value::timestamptz;
 RETURN result;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.permission_time_v1(text) FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.metering_permissions ADD COLUMN market_state_version bigint NOT NULL DEFAULT 0;
ALTER TABLE public.metering_permissions ADD COLUMN approved_start_at timestamptz, ADD COLUMN approved_end_at timestamptz;
ALTER TABLE public.metering_permission_sites ADD COLUMN IF NOT EXISTS start_at timestamptz, ADD COLUMN IF NOT EXISTS end_at timestamptz;
CREATE TABLE gridex_received_sources.permission_transitions (
 source_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL REFERENCES public.companies(id), permission_id uuid NOT NULL REFERENCES public.metering_permissions(id),
 payload_hash text NOT NULL, previous_state jsonb NOT NULL, previous_sites jsonb NOT NULL, resulting_state jsonb NOT NULL,
 applied_at timestamptz NOT NULL DEFAULT now(), actor_user_id uuid NOT NULL
);
ALTER TABLE gridex_received_sources.permission_transitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_received_sources.permission_transitions FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_apply_permission_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid,p_expected_permission_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype; origin public.ediel_messages%rowtype; p public.metering_permissions%rowtype;
 wire jsonb; original jsonb; a jsonb; b jsonb; prior gridex_received_sources.permission_transitions%rowtype;
 ids uuid[]; mode text; reason text; next_status text; negative_status text; count_positive int:=0; count_negative int:=0;
 start_day date; end_day date; end_time timestamptz; before_state jsonb; before_sites jsonb; after_state jsonb; ended_source public.ediel_messages%rowtype; ended_wire jsonb; termination public.ediel_messages%rowtype; termination_wire jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR p_actor_user_id IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','permission_source_unavailable'); END IF;
 IF NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,m.company_id,'metering.write'),false)
 OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
 THEN RETURN jsonb_build_object('applied',false,'reason','permission_execution_actor_unqualified'); END IF;
 SELECT * INTO prior FROM gridex_received_sources.permission_transitions WHERE source_message_id=m.id;
 IF FOUND THEN
  IF prior.company_id<>p_company_id OR prior.payload_hash<>encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR (p_expected_permission_id IS NOT NULL AND prior.permission_id<>p_expected_permission_id) THEN RAISE EXCEPTION 'permission_replay_conflict'; END IF;
  RETURN jsonb_build_object('applied',true,'idempotent',true,'permissionId',prior.permission_id,'status',prior.resulting_state->>'status');
 END IF;
 -- The real canonical runtime must have accepted this exact immutable payload.
 IF NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=m.id AND v.company_id=m.company_id AND v.environment=m.environment
 AND v.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND (v.facts_text::jsonb)->>'syntaxDecision'='accepted'
 AND (v.facts_text::jsonb)->>'applicationDecision'='accepted' AND (v.facts_text::jsonb)->>'functionalDecision'='accepted'
 AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN jsonb_build_object('applied',false,'reason','canonical_permission_source_not_accepted'); END IF;
 wire:=gridex_received_sources.permission_wire_v1(m.raw_payload);
 IF wire IS NULL OR (wire->>'code' IN ('Z14','Z15')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','permission_wire_unavailable'); END IF;
 -- Correlation is exact: permission owner, outbound original Z13, environment,
 -- opposite legal actors, and original LI. No unrelated unique-row fallback.
 SELECT array_agg(mp.id ORDER BY mp.id) INTO ids FROM public.metering_permissions mp
 JOIN public.ediel_messages z ON z.id=coalesce(mp.source_z13_message_id,mp.outbound_z13_message_id) AND z.company_id=mp.company_id AND z.environment=m.environment
 WHERE mp.company_id=m.company_id AND (p_expected_permission_id IS NULL OR mp.id=p_expected_permission_id)
 AND z.direction='outbound' AND z.status='sent' AND z.message_sent_at IS NOT NULL
 AND EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE nullif(o->>'li','') IS NOT NULL AND o->>'li'=mp.rff_li_reference);
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','no_unique_source_bound_permission'); END IF;
 SELECT * INTO p FROM public.metering_permissions WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
 SELECT * INTO origin FROM public.ediel_messages WHERE id=coalesce(p.source_z13_message_id,p.outbound_z13_message_id) AND company_id=m.company_id FOR SHARE;
 IF NOT FOUND OR origin.environment IS DISTINCT FROM m.environment OR origin.direction IS DISTINCT FROM 'outbound' OR origin.status IS DISTINCT FROM 'sent' OR origin.message_sent_at IS NULL
  OR origin.immutable_rendered_at IS NULL OR origin.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex')
 THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_not_sealed_and_sent'); END IF;
 original:=gridex_received_sources.permission_wire_v1(origin.raw_payload);
 IF original IS NULL OR original->>'code' IS DISTINCT FROM 'Z13' OR wire->>'sender' IS DISTINCT FROM original->>'receiver' OR wire->>'receiver' IS DISTINCT FROM original->>'sender'
 OR p.grid_owner_ediel_id IS DISTINCT FROM wire->>'sender' THEN RETURN jsonb_build_object('applied',false,'reason','permission_legal_actor_mismatch'); END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(original->'objects') o WHERE o->>'li'=p.rff_li_reference)<>1 OR origin.customer_id IS DISTINCT FROM p.customer_id THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_customer_scope_unavailable'); END IF;
 SELECT o INTO b FROM jsonb_array_elements(original->'objects') o WHERE o->>'li'=p.rff_li_reference;
 IF b IS NULL OR nullif(b->>'customerIdentity','') IS NULL OR (b->>'reason' IN ('S17','S18')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_mode_unavailable'); END IF;
 mode:=b->>'reason';before_state:=to_jsonb(p);
 PERFORM ps.id FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id ORDER BY ps.id FOR UPDATE;
 SELECT coalesce(jsonb_agg(to_jsonb(ps) ORDER BY ps.id),'[]'::jsonb) INTO before_sites FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id;
 IF wire->>'code'='Z14' THEN
  IF p.source_z13_message_id IS NOT NULL AND p.outbound_z13_message_id IS NOT NULL AND p.source_z13_message_id<>p.outbound_z13_message_id THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_identity_conflict'); END IF;
  IF (p.status IN ('z13_sent','waiting_for_customer_approval','z13_ready')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','permission_business_outcome_already_established'); END IF;
  FOR a IN SELECT o FROM jsonb_array_elements(wire->'objects') o LOOP
   IF a->>'li' IS DISTINCT FROM p.rff_li_reference THEN RETURN jsonb_build_object('applied',false,'reason','permission_object_reference_mismatch'); END IF;
   reason:=a->>'reason';
   IF reason='Z96' AND a->>'status' IN ('A13','A76') THEN
    count_negative:=count_negative+1;
    IF negative_status IS NOT NULL AND negative_status<>a->>'status' THEN RETURN jsonb_build_object('applied',false,'reason','mixed_permission_denial_reasons'); END IF;
    negative_status:=a->>'status';
   ELSIF reason=mode AND a->>'status'='A74' THEN
    count_positive:=count_positive+1;start_day:=gridex_received_sources.permission_date_v1(a->>'reportStart');end_day:=gridex_received_sources.permission_date_v1(a->>'reportEnd');
    IF nullif(a->>'point','') IS NULL OR nullif(a->>'permissionId','') IS NULL OR nullif(a->>'customerIdentity','') IS NULL OR a->>'customerIdentity' IS DISTINCT FROM b->>'customerIdentity'
    OR (b->>'point' IS NOT NULL AND a->>'point' IS DISTINCT FROM b->>'point')
    OR start_day IS NULL OR gridex_received_sources.permission_time_v1(a->>'reportStart') IS NULL OR (a->>'reportEnd' IS NOT NULL AND gridex_received_sources.permission_time_v1(a->>'reportEnd') IS NULL) OR (a->>'reportEnd' IS NOT NULL AND end_day IS NULL) OR (end_day IS NOT NULL AND end_day<start_day) THEN RETURN jsonb_build_object('applied',false,'reason','permission_approved_object_evidence_invalid'); END IF;
   ELSE RETURN jsonb_build_object('applied',false,'reason','permission_business_reason_unqualified'); END IF;
  END LOOP;
  next_status:=CASE WHEN count_positive=0 THEN CASE negative_status WHEN 'A76' THEN 'rejected_passive_timeout' ELSE 'rejected_active' END WHEN count_negative>0 THEN 'partially_approved' ELSE 'active' END;
  -- Parent/site/history writes are one database transaction. Never copy one
  -- linked local site or point to every physical approved object.
  DELETE FROM public.metering_permission_sites WHERE company_id=m.company_id AND metering_permission_id=p.id;
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
   SELECT * INTO ended_source FROM public.ediel_messages WHERE id=p.inbound_z15_message_id AND company_id=m.company_id AND environment=m.environment;
   ended_wire:=gridex_received_sources.permission_wire_v1(ended_source.raw_payload);
   IF ended_wire IS NULL OR ended_wire->>'sender' IS DISTINCT FROM wire->>'sender' OR ended_wire->>'receiver' IS DISTINCT FROM wire->>'receiver'
    OR jsonb_array_length(ended_wire->'objects')<>jsonb_array_length(wire->'objects')
    OR EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') own WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(ended_wire->'objects') old WHERE old->>'reason'=mode AND old->>'permissionId'=own->>'permissionId' AND old->>'point'=own->>'point' AND old->>'permissionEnd'=own->>'permissionEnd' AND old->>'li'=own->>'li'))
    THEN RETURN jsonb_build_object('applied',false,'reason','z15c_original_ending_not_bound'); END IF;
   SELECT * INTO prior FROM gridex_received_sources.permission_transitions WHERE source_message_id=ended_source.id AND permission_id=p.id;
   IF NOT FOUND OR p.market_state_version<>(prior.resulting_state->>'market_state_version')::bigint THEN RETURN jsonb_build_object('applied',false,'reason','z15c_original_snapshot_unavailable'); END IF;
   next_status:=prior.previous_state->>'status';
   UPDATE public.metering_permissions SET status=next_status,approved_end_date=(prior.previous_state->>'approved_end_date')::date,approved_end_at=(prior.previous_state->>'approved_end_at')::timestamptz WHERE id=p.id AND company_id=m.company_id;
   -- Restore exactly the previous object period; no customer-contract or
   -- beneficiary/service grant is revived by a market cancellation.
   UPDATE public.metering_permission_sites ps SET status=old->>'status',end_date=(old->>'end_date')::date,end_at=(old->>'end_at')::timestamptz,updated_at=now()
   FROM jsonb_array_elements(prior.previous_sites) old
   WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id AND ps.id=(old->>'id')::uuid
    AND EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') own WHERE own->>'point'=ps.facility_id);
  ELSE
   FOR a IN SELECT o FROM jsonb_array_elements(wire->'objects') o LOOP
    end_day:=gridex_received_sources.permission_date_v1(a->>'permissionEnd');end_time:=gridex_received_sources.permission_time_v1(a->>'permissionEnd');
    UPDATE public.metering_permission_sites SET end_date=end_day,end_at=end_time,status=CASE WHEN end_time>now() THEN status ELSE 'ended' END,updated_at=now()
    WHERE company_id=m.company_id AND metering_permission_id=p.id AND facility_id=a->>'point';
   END LOOP;
   next_status:=CASE WHEN NOT EXISTS(SELECT FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id AND (ps.end_at IS NULL OR ps.end_at>now())) THEN 'ended' ELSE p.status END;
   UPDATE public.metering_permissions SET status=next_status,
    approved_end_date=CASE WHEN jsonb_array_length(before_sites)=1 THEN end_day ELSE approved_end_date END,
    approved_end_at=CASE WHEN jsonb_array_length(before_sites)=1 THEN end_time ELSE approved_end_at END WHERE id=p.id AND company_id=m.company_id;
  END IF;
  UPDATE public.metering_permissions SET inbound_z15_message_id=m.id,market_state_version=market_state_version+1,updated_at=now(),updated_by=p_actor_user_id,
   metadata=coalesce(metadata,'{}')||jsonb_build_object('z15',jsonb_build_object('edielMessageId',m.id,'reason',reason,'objects',wire->'objects')) WHERE id=p.id AND company_id=m.company_id;
 END IF;
 IF wire->>'code'='Z14' THEN
  UPDATE public.ediel_business_expectations SET status=CASE WHEN count_positive=0 THEN 'rejected' ELSE 'fulfilled' END,
   fulfilled_by_message_id=m.id,updated_at=now()
   WHERE company_id=m.company_id AND environment=m.environment AND source_message_id=origin.id
    AND expected_family='PRODAT' AND expected_code='Z14' AND status IN ('pending','timeout','manual_review');
 ELSIF reason=mode AND p.outbound_z18_message_id IS NOT NULL THEN
  SELECT * INTO termination FROM public.ediel_messages WHERE id=p.outbound_z18_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
  termination_wire:=gridex_received_sources.permission_wire_v1(termination.raw_payload);
  IF termination.direction='outbound' AND termination.status='sent' AND termination.message_sent_at IS NOT NULL AND termination.immutable_rendered_at IS NOT NULL
   AND termination.immutable_payload_hash=encode(sha256(convert_to(termination.raw_payload,'UTF8')),'hex')
   AND termination_wire->>'code'='Z18' AND termination_wire->>'sender'=wire->>'receiver' AND termination_wire->>'receiver'=wire->>'sender'
   AND jsonb_array_length(termination_wire->'objects')=jsonb_array_length(wire->'objects')
   AND NOT EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') own WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(termination_wire->'objects') requested WHERE requested->>'reason'=mode AND requested->>'li'=own->>'li' AND requested->>'point'=own->>'point' AND requested->>'permissionId'=own->>'permissionId' AND requested->>'permissionEnd'=own->>'permissionEnd'))
   THEN UPDATE public.ediel_business_expectations SET status='fulfilled',fulfilled_by_message_id=m.id,updated_at=now()
    WHERE company_id=m.company_id AND environment=m.environment AND source_message_id=termination.id AND expected_family='PRODAT' AND expected_code='Z15' AND status IN ('pending','timeout','manual_review'); END IF;
 END IF;
 SELECT to_jsonb(mp) INTO after_state FROM public.metering_permissions mp WHERE id=p.id;
 INSERT INTO gridex_received_sources.permission_transitions(source_message_id,company_id,permission_id,payload_hash,previous_state,previous_sites,resulting_state,actor_user_id)
 VALUES(m.id,m.company_id,p.id,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),before_state,before_sites,after_state,p_actor_user_id);
 RETURN jsonb_build_object('applied',true,'permissionId',p.id,'status',next_status,'stateVersion',after_state->'market_state_version');
END $$;
REVOKE ALL ON FUNCTION public.ediel_apply_permission_source_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_apply_permission_source_v1(uuid,uuid,uuid,uuid) TO service_role;
-- Source-derived time projection. Expiry does not invent a denial or send a
-- command; only an already accepted Z15 end can change the due object status.
CREATE FUNCTION public.ediel_advance_permission_deadlines_v1(p_actor_user_id uuid,p_company_id uuid DEFAULT NULL,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE p public.metering_permissions%rowtype; a jsonb; wire jsonb; raw text; changed integer:=0; rows_changed integer;
BEGIN
 FOR p IN SELECT mp.* FROM public.metering_permissions mp WHERE mp.status IN ('active','approved','partially_approved','z14_received')
  AND (p_company_id IS NULL OR mp.company_id=p_company_id)
  AND mp.inbound_z15_message_id IS NOT NULL
  AND coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,mp.company_id,'metering.write'),false)
  AND EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=mp.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  AND EXISTS(SELECT FROM public.metering_permission_sites ps WHERE ps.company_id=mp.company_id AND ps.metering_permission_id=mp.id AND ps.status IN ('approved','active') AND ps.end_at<=now())
  ORDER BY mp.updated_at,mp.id LIMIT least(greatest(coalesce(p_limit,100),1),200) FOR UPDATE SKIP LOCKED LOOP
  IF NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p.company_id,'metering.write'),false)
   OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) THEN CONTINUE; END IF;
  SELECT m.raw_payload INTO raw FROM public.ediel_messages m JOIN gridex_received_sources.permission_transitions tr ON tr.source_message_id=m.id AND tr.company_id=m.company_id AND tr.permission_id=p.id
   WHERE m.id=p.inbound_z15_message_id AND m.company_id=p.company_id AND tr.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
  wire:=gridex_received_sources.permission_wire_v1(raw);
  IF wire IS NULL OR wire->>'code' IS DISTINCT FROM 'Z15' THEN CONTINUE; END IF;
  FOR a IN SELECT o FROM jsonb_array_elements(wire->'objects') o WHERE o->>'reason' IN ('S17','S18') AND o->>'status' IN ('A74','A75') LOOP
   UPDATE public.metering_permission_sites ps SET status='ended',updated_at=now()
    WHERE ps.company_id=p.company_id AND ps.metering_permission_id=p.id AND ps.facility_id=a->>'point' AND ps.metadata->>'permissionId'=a->>'permissionId'
     AND ps.status IN ('approved','active') AND ps.end_at=gridex_received_sources.permission_time_v1(a->>'permissionEnd') AND ps.end_at<=now();
   GET DIAGNOSTICS rows_changed=ROW_COUNT;changed:=changed+rows_changed;
  END LOOP;
  IF NOT EXISTS(SELECT FROM public.metering_permission_sites ps WHERE ps.company_id=p.company_id AND ps.metering_permission_id=p.id AND ps.status IN ('approved','active')) THEN
   UPDATE public.metering_permissions SET status='ended',updated_at=now(),updated_by=p_actor_user_id WHERE id=p.id AND company_id=p.company_id AND market_state_version=p.market_state_version;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('updated',changed);
END $$;
REVOKE ALL ON FUNCTION public.ediel_advance_permission_deadlines_v1(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_advance_permission_deadlines_v1(uuid,uuid,integer) TO service_role;
CREATE FUNCTION gridex_received_sources.permission_transition_immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'permission_transition_is_immutable' USING ERRCODE='55000'; END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.permission_transition_immutable_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER permission_transition_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.permission_transitions FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
COMMIT;

