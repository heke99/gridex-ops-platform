-- PRIVATE finite SOURCE proposal only; NOT executed, not canonical source, not GEN/native proof.
-- Derived from immutable effect a2a7e91e1bbb97e0b2d73171b1e0893fad9e4acf915ca620c02f25b8e6aa4a0d.
-- All original transport source/executable byte/hash checks remain unchanged.
-- Temporarily normalize only exact SC031 current body for the original sealed installer,
-- then restore identical original body/catalog row in the SAME transaction.
-- The resulting catalog does not claim the sealed module whole fingerprint.
-- ONE effect-loader proposal for OPS atomic SHA256 bb0bd0cedeabc3ba40872eae8cead8b6a8a9ff298c567baa324a1b4044045b04.
-- The 12 earlier stages register source transport only. Eight logical component
-- references remain provenance, never eight fabricated applied child migrations.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $ops_compact_apply$
DECLARE raw bytea; executable bytea;
 projection_before pg_catalog.pg_proc%rowtype; projection_during pg_catalog.pg_proc%rowtype; projection_after pg_catalog.pg_proc%rowtype;
 projection_target oid; projection_definition text; projection_normalized boolean:=false;
 projection_old constant text:=$projection_old$
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
END $projection_old$;
 projection_current constant text:=$projection_current$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(raw);raw_parts jsonb:=gridex_prodat_object_batch.raw_segments_v1(raw);t jsonb;e jsonb;first_index int:=(own#>>'{registers,0,segmentIndex}')::int;next_index int;
 ud jsonb;it jsonb;qty text;start_day text;frequency text;product text;reference text;area text;grid_id uuid;characteristic text;name text;personal text;org text;is_business bool;key text;expected jsonb;field_value jsonb;reg jsonb;wire_reg jsonb;reg_end int;reg_raw jsonb;reg_qty text;
 source_company uuid;source_id uuid;source_hash text;source_row public.ediel_messages%rowtype;source_original gridex_received_sources.sources%rowtype;
 application jsonb;ignored gridex_received_sources.prodat_ignored_field_facets%rowtype;fields jsonb;field jsonb;occ jsonb;physical jsonb;owner_object jsonb;owner_register jsonb;
 first_owner_index int;first_owner_end int;first_party_index int;li text;customer_ref text;li_count int;customer_count int;refs jsonb;own_fields text[]:=ARRAY[]::text[];
BEGIN
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
 -- Same immutable canonical assessment under the caller's existing graph
 -- lock; raw/register snapshots stay intact. Missing facets are UNKNOWN/HOLD.
 source_company:=(command->>'company_id')::uuid;
 source_id:=(command#>>'{application,payload_snapshot,edielMessageId}')::uuid;
 source_hash:=encode(sha256(convert_to(raw,'UTF8')),'hex');
 SELECT * INTO source_row FROM public.ediel_messages WHERE id=source_id AND company_id=source_company;
 SELECT * INTO source_original FROM gridex_received_sources.sources WHERE source_message_id=source_id AND company_id=source_company AND environment=source_row.environment;
 IF source_row.id IS NULL OR source_original.source_message_id IS NULL OR source_row.direction IS DISTINCT FROM 'inbound'
  OR source_row.message_family IS DISTINCT FROM 'PRODAT' OR source_row.message_standard IS DISTINCT FROM 'edifact'
  OR source_row.raw_payload IS DISTINCT FROM raw OR source_original.raw_payload IS DISTINCT FROM raw
  OR source_original.payload_hash IS DISTINCT FROM source_hash OR source_original.message_code IS DISTINCT FROM source_row.message_code
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH' AND x#>>'{elements,2,0}'='PRODAT')<>1
  THEN RAISE EXCEPTION 'prodat_object_batch_ignored_same_source_required';END IF;
 application:=gridex_received_sources.require_prodat_application_objects_v1(source_company,source_id);
 IF application->>'sourcePayloadHash' IS DISTINCT FROM source_hash
  OR (SELECT count(*) FROM jsonb_array_elements(application->'objects')x WHERE x=own)<>1
  THEN RAISE EXCEPTION 'prodat_object_batch_ignored_same_application_required';END IF;
 SELECT * INTO ignored FROM gridex_received_sources.prodat_ignored_field_facets WHERE canonical_assessment_id=(application->>'assessmentId')::uuid
  AND company_id=source_company AND environment=source_row.environment AND source_message_id=source_id AND source_payload_hash=source_hash;
 IF ignored.canonical_assessment_id IS NULL OR ignored.fields_hash IS DISTINCT FROM encode(sha256(convert_to(ignored.fields_text,'UTF8')),'hex')
  OR octet_length(ignored.fields_text)>262144 THEN RAISE EXCEPTION 'prodat_object_batch_ignored_canonical_facet_required';END IF;
 fields:=ignored.fields_text::jsonb;
 IF jsonb_typeof(fields) IS DISTINCT FROM 'array' OR jsonb_array_length(fields)>8192
  OR (SELECT count(*) FROM jsonb_array_elements(fields)x)<>(SELECT count(DISTINCT x) FROM jsonb_array_elements(fields)x)
  THEN RAISE EXCEPTION 'prodat_object_batch_ignored_field_scope_invalid';END IF;
 FOR field IN SELECT value FROM jsonb_array_elements(fields) LOOP
  occ:=field->'occurrence';
  IF jsonb_typeof(field) IS DISTINCT FROM 'object' OR field-ARRAY['fieldNumber','sourceRule','occurrence']<>'{}'::jsonb
   OR jsonb_typeof(field->'fieldNumber') IS DISTINCT FROM 'string' OR nullif(btrim(field->>'fieldNumber'),'') IS NULL
   OR field->>'sourceRule' IS DISTINCT FROM 'PRODAT26A:P119' OR jsonb_typeof(occ) IS DISTINCT FROM 'object'
   OR NOT(occ ?& ARRAY['scope','messageReference','lineIndex','lineNumber','registerPosition','objectId','identityAgency','lineItemReference','ownReferences'])
   OR occ-ARRAY['scope','messageReference','lineIndex','lineNumber','registerPosition','objectId','identityAgency','lineItemReference','ownReferences']<>'{}'::jsonb
   OR (occ->>'scope' IN('header','object','register')) IS NOT TRUE
   OR occ->>'messageReference' IS DISTINCT FROM own->>'messageReference'
   OR occ->>'messageReference' IS DISTINCT FROM (SELECT x#>>'{elements,1,0}' FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH')
   THEN RAISE EXCEPTION 'prodat_object_batch_ignored_field_scope_invalid';END IF;
  IF occ->>'scope'='header' THEN
   IF occ->'lineIndex' IS DISTINCT FROM 'null'::jsonb OR occ->'lineNumber' IS DISTINCT FROM 'null'::jsonb
    OR occ->'registerPosition' IS DISTINCT FROM 'null'::jsonb OR occ->'objectId' IS DISTINCT FROM 'null'::jsonb
    OR occ->'identityAgency' IS DISTINCT FROM 'null'::jsonb OR occ->'lineItemReference' IS DISTINCT FROM 'null'::jsonb
    OR occ ? 'ownReferences' AND occ->'ownReferences' IS DISTINCT FROM jsonb_build_object('objectId',jsonb_build_object('kind','unavailable'),'lineItemReference',jsonb_build_object('kind','unavailable'),'customerId',jsonb_build_object('kind','unavailable'))
    THEN RAISE EXCEPTION 'prodat_object_batch_ignored_field_physical_scope_invalid';END IF;
   CONTINUE;
  END IF;
  IF jsonb_typeof(occ->'lineIndex') IS DISTINCT FROM 'number' OR (occ->>'lineIndex'~'^[0-9]+$') IS NOT TRUE
   THEN RAISE EXCEPTION 'prodat_object_batch_ignored_field_physical_scope_invalid';END IF;
  SELECT x INTO physical FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='LIN'
   AND (SELECT count(*) FROM jsonb_array_elements(tokens)prior WHERE prior->>'tag'='LIN' AND (prior->>'index')::int<(x->>'index')::int)=(occ->>'lineIndex')::int;
  SELECT o,r INTO owner_object,owner_register FROM jsonb_array_elements(application->'objects')o CROSS JOIN LATERAL jsonb_array_elements(o->'registers')r
   WHERE o->>'objectId'=occ->>'objectId' AND o->>'identityAgency'=occ->>'identityAgency' AND o->>'messageReference'=occ->>'messageReference' AND r->'lineIndex'=occ->'lineIndex';
  IF physical IS NULL OR owner_object IS NULL OR physical#>>'{elements,1,0}' IS DISTINCT FROM occ->>'lineNumber'
   OR physical#>>'{elements,3,0}' IS DISTINCT FROM occ->>'objectId' OR physical#>>'{elements,3,3}' IS DISTINCT FROM occ->>'identityAgency'
   OR owner_register->'segmentIndex' IS DISTINCT FROM physical->'index' OR owner_register->'lineNumber' IS DISTINCT FROM occ->'lineNumber'
   OR owner_register->'registerPosition' IS DISTINCT FROM occ->'registerPosition'
   THEN RAISE EXCEPTION 'prodat_object_batch_ignored_field_physical_scope_invalid';END IF;
  first_owner_index:=(owner_object#>>'{registers,0,segmentIndex}')::int;
  SELECT min((x->>'index')::int) INTO first_owner_end FROM jsonb_array_elements(tokens)x WHERE x->>'tag' IN('LIN','UNT') AND(x->>'index')::int>first_owner_index;
  SELECT min((x->>'index')::int) INTO first_party_index FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='NAD' AND(x->>'index')::int>first_owner_index AND(x->>'index')::int<first_owner_end;
  SELECT count(*),min(nullif(x#>>'{elements,1,1}','')) INTO li_count,li FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='LI'
   AND(x->>'index')::int>first_owner_index AND(x->>'index')::int<coalesce(first_party_index,first_owner_end);
  SELECT count(*),min(nullif(x#>>'{elements,2,0}','')) INTO customer_count,customer_ref FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='UD'
   AND(x->>'index')::int>first_owner_index AND(x->>'index')::int<first_owner_end;
  refs:=jsonb_build_object('objectId',jsonb_build_object('kind','present','value',owner_object->>'objectId'),
   'lineItemReference',CASE WHEN li_count>1 THEN jsonb_build_object('kind','unavailable') WHEN li IS NULL THEN jsonb_build_object('kind','absent') ELSE jsonb_build_object('kind','present','value',li) END,
   'customerId',CASE WHEN customer_count>1 THEN jsonb_build_object('kind','unavailable') WHEN customer_ref IS NULL THEN jsonb_build_object('kind','absent') ELSE jsonb_build_object('kind','present','value',customer_ref) END);
  IF occ->>'lineItemReference' IS DISTINCT FROM (CASE WHEN li_count=1 THEN li END)
   OR occ ? 'ownReferences' AND occ->'ownReferences' IS DISTINCT FROM refs
   THEN RAISE EXCEPTION 'prodat_object_batch_ignored_field_physical_scope_invalid';END IF;
  -- Valid other-object/register entries are nonmatching, never global errors.
  IF owner_object=own AND occ->'lineIndex'=own#>'{registers,0,lineIndex}' AND (physical->>'index')::int=first_index THEN
   own_fields:=array_append(own_fields,field->>'fieldNumber');
  END IF;
 END LOOP;
 -- Consume canonical decisions without another subtype classifier.
 IF 'END_USER_GROUP'=ANY(own_fields) THEN ud:=NULL;
 ELSE
  IF '227'=ANY(own_fields) THEN ud:=jsonb_set(ud,'{2}','[]'::jsonb);END IF;
  IF '228'=ANY(own_fields) THEN ud:=jsonb_set(ud,'{4}','[]'::jsonb);END IF;
 END IF;
 IF 'INSTALLATION_GROUP'=ANY(own_fields) THEN it:=NULL;
 ELSE
  IF '234'=ANY(own_fields) THEN it:=jsonb_set(it,'{5}','[]'::jsonb);END IF;
  IF '235'=ANY(own_fields) THEN it:=jsonb_set(it,'{8}','[]'::jsonb);END IF;
  IF '236'=ANY(own_fields) THEN it:=jsonb_set(it,'{6}','[]'::jsonb);END IF;
  IF '237'=ANY(own_fields) THEN it:=jsonb_set(it,'{9}','[]'::jsonb);END IF;
 END IF;
 IF '319'=ANY(own_fields) THEN reference:=NULL;END IF;
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
  'street',CASE WHEN it IS NOT NULL AND NOT('234'=ANY(own_fields)) THEN array_to_string(ARRAY(SELECT btrim(v#>>'{}') FROM jsonb_array_elements(it->5) WITH ORDINALITY a(v,ord) WHERE ord<=3 AND btrim(v#>>'{}')<>''),E'\n') END,
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
END $projection_current$;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'ops_compact_transport_postgres_execution_required'; END IF;
 IF to_regclass('ops_api_atomic_transport_bb0bd0ce.payload_parts') IS NULL THEN RAISE EXCEPTION 'ops_compact_transport_staged_source_required'; END IF;
 LOCK TABLE ops_api_atomic_transport_bb0bd0ce.payload_parts IN ACCESS EXCLUSIVE MODE;
 
 IF NOT EXISTS (SELECT FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce' AND nspowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND nspacl=acldefault('n',(SELECT oid FROM pg_roles WHERE rolname='postgres'))) THEN RAISE EXCEPTION 'ops_compact_transport_schema_metadata_unknown'; END IF;
 IF EXISTS(SELECT FROM pg_namespace n CROSS JOIN pg_roles r WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce' AND r.rolname IN ('anon','authenticated','service_role','authenticator') AND (has_schema_privilege(r.rolname::text,n.oid,'USAGE') OR has_schema_privilege(r.rolname::text,n.oid,'CREATE') OR pg_has_role(r.rolname::text,'postgres','MEMBER') OR pg_has_role(r.rolname::text,'postgres','SET') OR pg_has_role(r.rolname::text,'postgres','USAGE'))) THEN RAISE EXCEPTION 'ops_compact_transport_app_privilege_forbidden'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce')<>2 OR NOT EXISTS(SELECT FROM pg_class c WHERE c.oid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND c.relkind='r' AND c.relpersistence='p' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND c.relrowsecurity AND c.relforcerowsecurity AND c.relacl=acldefault('r',c.relowner) AND c.reloptions IS NULL AND c.relam=(SELECT oid FROM pg_am WHERE amname='heap')) THEN RAISE EXCEPTION 'ops_compact_transport_relation_metadata_unknown'; END IF;
 IF EXISTS(SELECT FROM pg_depend d WHERE d.refclassid='pg_namespace'::regclass AND d.refobjid=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce') AND NOT ((d.classid='pg_class'::regclass AND d.objid IN ('ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass,'ops_api_atomic_transport_bb0bd0ce.payload_parts_pkey'::regclass)) OR (d.classid='pg_type'::regclass AND d.objid IN ('ops_api_atomic_transport_bb0bd0ce.payload_parts'::regtype,'ops_api_atomic_transport_bb0bd0ce._payload_parts'::regtype)))) THEN RAISE EXCEPTION 'ops_compact_transport_unexpected_namespace_object'; END IF;
 IF EXISTS(SELECT FROM pg_attribute WHERE attrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND attacl IS NOT NULL) THEN RAISE EXCEPTION 'ops_compact_transport_column_acl_forbidden'; END IF;
 IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce') OR EXISTS(SELECT FROM pg_policy WHERE polrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_trigger WHERE tgrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_rewrite WHERE ev_class='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_inherits WHERE inhrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass OR inhparent='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_attrdef WHERE adrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) THEN RAISE EXCEPTION 'ops_compact_transport_extra_metadata_forbidden'; END IF;
 IF (SELECT jsonb_agg(jsonb_build_object('name',attname,'type',atttypid::regtype::text,'number',attnum,'notnull',attnotnull,'typmod',atttypmod,'identity',attidentity,'generated',attgenerated,'collation',attcollation::regcollation::text,'acl',attacl::text,'options',attoptions,'fdwoptions',attfdwoptions,'storage',attstorage,'compression',attcompression,'local',attislocal,'inheritance',attinhcount) ORDER BY attnum) FROM pg_attribute WHERE attrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND attnum>0) IS DISTINCT FROM '[{"name":"ordinal","type":"integer","number":1,"notnull":true,"typmod":-1,"identity":"","generated":"","collation":"-","acl":null,"options":null,"fdwoptions":null,"storage":"p","compression":"","local":true,"inheritance":0},{"name":"payload","type":"text","number":2,"notnull":true,"typmod":-1,"identity":"","generated":"","collation":"\"default\"","acl":null,"options":null,"fdwoptions":null,"storage":"x","compression":"","local":true,"inheritance":0}]'::jsonb THEN RAISE EXCEPTION 'ops_compact_transport_column_metadata_unknown'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass)<>1 OR NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND conname='payload_parts_pkey' AND contype='p' AND conkey=ARRAY[1]::smallint[] AND NOT condeferrable AND NOT condeferred AND convalidated AND conislocal AND coninhcount=0 AND conparentid=0 AND pg_get_constraintdef(oid)='PRIMARY KEY (ordinal)') THEN RAISE EXCEPTION 'ops_compact_transport_constraint_metadata_unknown'; END IF;
 IF NOT EXISTS(SELECT FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.oid='ops_api_atomic_transport_bb0bd0ce.payload_parts_pkey'::regclass AND c.relkind='i' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND c.relacl IS NULL AND c.reloptions IS NULL AND c.relpersistence='p' AND i.indrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND i.indisunique AND i.indisprimary AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate AND NOT i.indisexclusion AND NOT i.indisclustered AND NOT i.indisreplident AND NOT i.indnullsnotdistinct AND i.indnatts=1 AND i.indnkeyatts=1 AND i.indkey='1'::int2vector AND i.indcollation='0'::oidvector AND i.indoption='0'::int2vector AND i.indclass=(SELECT oid::text::oidvector FROM pg_opclass WHERE opcnamespace='pg_catalog'::regnamespace AND opcname='int4_ops' AND opcmethod=(SELECT oid FROM pg_am WHERE amname='btree')) AND i.indexprs IS NULL AND i.indpred IS NULL AND pg_get_indexdef(c.oid)='CREATE UNIQUE INDEX payload_parts_pkey ON ops_api_atomic_transport_bb0bd0ce.payload_parts USING btree (ordinal)') THEN RAISE EXCEPTION 'ops_compact_transport_index_metadata_unknown'; END IF;
 IF (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce')<>2 OR NOT EXISTS(SELECT FROM pg_type WHERE typnamespace=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce') AND typname='payload_parts' AND typtype='c' AND typrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND typowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND typacl IS NULL) OR NOT EXISTS(SELECT FROM pg_type WHERE typnamespace=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce') AND typname='_payload_parts' AND typtype='b' AND typelem='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regtype AND typowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND typacl IS NULL) THEN RAISE EXCEPTION 'ops_compact_transport_type_metadata_unknown'; END IF;
 IF EXISTS(SELECT FROM pg_depend WHERE deptype='e' AND ((classid='pg_namespace'::regclass AND objid=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce')) OR (classid='pg_class'::regclass AND objid IN ('ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass,'ops_api_atomic_transport_bb0bd0ce.payload_parts_pkey'::regclass)))) THEN RAISE EXCEPTION 'ops_compact_transport_extension_membership_forbidden'; END IF;
 IF EXISTS(SELECT FROM ops_api_atomic_transport_bb0bd0ce.payload_parts p LEFT JOIN (VALUES (1,80547,'aeac6d55ebfafc9c0d5ad30bf4dad37178fd46d9e52f43c846612fac1cc0b073'),(2,80547,'1056f8241fab935b5b36174658b4566d6562e7980f66a4f62399137708480f55'),(3,80547,'8d7736d9c18f0ec7e02c421907daf0f254ee9fe54aa61353e13d6827c8443f73'),(4,80547,'1f375fd1052f325b5a2e23f1c0a87d7a5c4c0c39c84b01ad6afa154865ecafc7'),(5,80547,'7ec7255e4de7f738c33eb48119de9d7d4dcbb2ed542e9136f9165824edc352c1'),(6,80547,'6e3ba08e32dd8605bd8a2378ba6cdfcec4d513eafdf55bd3fc2940b96dfa9749'),(7,80547,'7e941361061f7515bce84fb77b83f10c7dd1814356ac762bf12856d37abb4d2a'),(8,80547,'929b535701f910a90c5a2ead0a1a501bc631a04ecabc2b779c9a7286e25064f7'),(9,80547,'32b289b55a734020b96487e5498b908b8d1978a4878e8ab3470e0e73c6bdce5e'),(10,80547,'d0ca52a50e80383ced15051bcba9ca7e24e69858fa0be512c40cd4fbc6e975c3'),(11,80547,'e7773322ceb01f55240b0372e3ee234bb9cfd7bc8d8c572c867c585ee4bb76e7'),(12,80536,'8e9a209d6d969d1fc0435bcb564c05f54400a9faaf58ee4dcd3373d3013f91fa')) expected(ordinal,byte_count,digest) USING(ordinal) WHERE expected.ordinal IS NULL OR octet_length(convert_to(p.payload,'UTF8'))<>expected.byte_count OR encode(sha256(convert_to(p.payload,'UTF8')),'hex')<>expected.digest) THEN RAISE EXCEPTION 'ops_compact_transport_part_bytes_unknown'; END IF;

 IF (SELECT count(*) FROM ops_api_atomic_transport_bb0bd0ce.payload_parts)<>12 THEN RAISE EXCEPTION 'ops_compact_transport_all_parts_required'; END IF;
 SELECT convert_to(string_agg(payload,'' ORDER BY ordinal),'UTF8') INTO raw FROM ops_api_atomic_transport_bb0bd0ce.payload_parts;
 IF octet_length(raw)<>966553 OR encode(sha256(raw),'hex')<>'bb0bd0cedeabc3ba40872eae8cead8b6a8a9ff298c567baa324a1b4044045b04' THEN RAISE EXCEPTION 'ops_compact_transport_full_source_mismatch'; END IF;
 IF substring(raw from 80 for 6)<>convert_to('BEGIN;','UTF8') OR substring(raw from 966546 for 7)<>convert_to('COMMIT;','UTF8') THEN RAISE EXCEPTION 'ops_compact_transport_outer_transaction_tokens_unknown'; END IF;
 executable:=substring(raw from 1 for 79) || substring(raw from 86 for 966460) || substring(raw from 966553);
 IF octet_length(executable)<>966540 OR encode(sha256(executable),'hex')<>'af1652d62cadee0e0184af0574342c0d5104982705eab5b100c51fdf90afc02b' THEN RAISE EXCEPTION 'ops_compact_transport_executable_mismatch'; END IF;

 -- Both exact source literals and full known function ABI/attributes are mandatory.
 projection_target:=to_regprocedure('gridex_prodat_object_batch.require_wire_projection_v1(text,jsonb,jsonb,text,uuid)');
 SELECT * INTO STRICT projection_before FROM pg_catalog.pg_proc WHERE oid=projection_target;
 IF pg_get_userbyid(projection_before.proowner)<>'postgres'
 OR projection_before.pronamespace<>'gridex_prodat_object_batch'::regnamespace
 OR projection_before.proname<>'require_wire_projection_v1' OR projection_before.prokind<>'f'
 OR projection_before.proacl IS DISTINCT FROM ARRAY['postgres=X/postgres']::aclitem[]
 OR projection_before.proargtypes<>ARRAY['text'::regtype::oid,'jsonb'::regtype::oid,'jsonb'::regtype::oid,'text'::regtype::oid,'uuid'::regtype::oid]::oidvector
 OR projection_before.pronargs<>5 OR projection_before.proallargtypes IS NOT NULL OR projection_before.proargmodes IS NOT NULL
 OR projection_before.proargnames IS DISTINCT FROM ARRAY['raw','own','command','mode','actor']::text[]
 OR projection_before.prorettype<>'void'::regtype OR projection_before.proretset
 OR projection_before.pronargdefaults<>0 OR projection_before.proargdefaults IS NOT NULL
 OR projection_before.prosecdef OR projection_before.proisstrict OR projection_before.proleakproof
 OR projection_before.provolatile<>'v' OR projection_before.proparallel<>'u'
 OR projection_before.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR (SELECT lanname FROM pg_catalog.pg_language WHERE oid=projection_before.prolang)<>'plpgsql'
 OR projection_before.procost<>100 OR projection_before.prorows<>0 OR projection_before.provariadic<>0 OR projection_before.prosupport<>0
 OR projection_before.protrftypes IS NOT NULL OR projection_before.probin IS NOT NULL OR projection_before.prosqlbody IS NOT NULL
 THEN RAISE EXCEPTION 'sc031_atomic_replay_projection_full_metadata_unknown'; END IF;
 IF md5(projection_old)<>'575139caedf161f007a16b64873bb727'
 OR encode(sha256(convert_to(projection_old,'UTF8')),'hex')<>'c384bcefd09417f9d5220f01de98d7139ac7b8f461fbac590edb8779a5ff260a'
 OR md5(projection_current)<>'4682314319fefd9d2d258b0d31b7b554'
 OR encode(sha256(convert_to(projection_current,'UTF8')),'hex')<>'6d5e21a429db0d8d1a0e07a08bf391f0ae643118b20ac19d2059490feaf2f500'
 THEN RAISE EXCEPTION 'sc031_atomic_replay_projection_source_literal_unknown'; END IF;
 IF projection_before.prosrc=projection_current
 AND md5(projection_before.prosrc)='4682314319fefd9d2d258b0d31b7b554' THEN
  projection_definition:=pg_get_functiondef(projection_target);
  IF strpos(projection_definition,projection_current)=0 THEN RAISE EXCEPTION 'sc031_atomic_replay_projection_definition_unknown'; END IF;
  EXECUTE replace(projection_definition,projection_current,projection_old);
  SELECT * INTO STRICT projection_during FROM pg_catalog.pg_proc WHERE oid=projection_target;
  IF (to_jsonb(projection_during)-'prosrc') IS DISTINCT FROM (to_jsonb(projection_before)-'prosrc')
  OR projection_during.prosrc IS DISTINCT FROM projection_old OR md5(projection_during.prosrc)<>'575139caedf161f007a16b64873bb727'
  THEN RAISE EXCEPTION 'sc031_atomic_replay_projection_normalization_changed_identity'; END IF;
  projection_normalized:=true;
 ELSIF projection_before.prosrc IS DISTINCT FROM projection_old
 OR md5(projection_before.prosrc)<>'575139caedf161f007a16b64873bb727' THEN
  RAISE EXCEPTION 'sc031_atomic_replay_projection_body_unknown';
 END IF;
 EXECUTE convert_from(executable,'UTF8');
 -- Restore only after every unchanged sealed component/global assertion completes.
 SELECT * INTO STRICT projection_during FROM pg_catalog.pg_proc WHERE oid=projection_target;
 IF (to_jsonb(projection_during)-'prosrc') IS DISTINCT FROM (to_jsonb(projection_before)-'prosrc')
 OR projection_during.prosrc IS DISTINCT FROM projection_old OR md5(projection_during.prosrc)<>'575139caedf161f007a16b64873bb727'
 THEN RAISE EXCEPTION 'sc031_atomic_replay_projection_installer_changed_identity'; END IF;
 IF projection_normalized THEN
  projection_definition:=pg_get_functiondef(projection_target);
  IF strpos(projection_definition,projection_old)=0 THEN RAISE EXCEPTION 'sc031_atomic_replay_projection_restore_definition_unknown'; END IF;
  EXECUTE replace(projection_definition,projection_old,projection_current);
 END IF;
 SELECT * INTO STRICT projection_after FROM pg_catalog.pg_proc WHERE oid=projection_target;
 IF to_jsonb(projection_after) IS DISTINCT FROM to_jsonb(projection_before)
 THEN RAISE EXCEPTION 'sc031_atomic_replay_projection_original_full_row_not_restored'; END IF;

 -- All eight component effects must complete before removing this private transport.
 
 IF NOT EXISTS (SELECT FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce' AND nspowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND nspacl=acldefault('n',(SELECT oid FROM pg_roles WHERE rolname='postgres'))) THEN RAISE EXCEPTION 'ops_compact_transport_schema_metadata_unknown'; END IF;
 IF EXISTS(SELECT FROM pg_namespace n CROSS JOIN pg_roles r WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce' AND r.rolname IN ('anon','authenticated','service_role','authenticator') AND (has_schema_privilege(r.rolname::text,n.oid,'USAGE') OR has_schema_privilege(r.rolname::text,n.oid,'CREATE') OR pg_has_role(r.rolname::text,'postgres','MEMBER') OR pg_has_role(r.rolname::text,'postgres','SET') OR pg_has_role(r.rolname::text,'postgres','USAGE'))) THEN RAISE EXCEPTION 'ops_compact_transport_app_privilege_forbidden'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce')<>2 OR NOT EXISTS(SELECT FROM pg_class c WHERE c.oid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND c.relkind='r' AND c.relpersistence='p' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND c.relrowsecurity AND c.relforcerowsecurity AND c.relacl=acldefault('r',c.relowner) AND c.reloptions IS NULL AND c.relam=(SELECT oid FROM pg_am WHERE amname='heap')) THEN RAISE EXCEPTION 'ops_compact_transport_relation_metadata_unknown'; END IF;
 IF EXISTS(SELECT FROM pg_depend d WHERE d.refclassid='pg_namespace'::regclass AND d.refobjid=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce') AND NOT ((d.classid='pg_class'::regclass AND d.objid IN ('ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass,'ops_api_atomic_transport_bb0bd0ce.payload_parts_pkey'::regclass)) OR (d.classid='pg_type'::regclass AND d.objid IN ('ops_api_atomic_transport_bb0bd0ce.payload_parts'::regtype,'ops_api_atomic_transport_bb0bd0ce._payload_parts'::regtype)))) THEN RAISE EXCEPTION 'ops_compact_transport_unexpected_namespace_object'; END IF;
 IF EXISTS(SELECT FROM pg_attribute WHERE attrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND attacl IS NOT NULL) THEN RAISE EXCEPTION 'ops_compact_transport_column_acl_forbidden'; END IF;
 IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce') OR EXISTS(SELECT FROM pg_policy WHERE polrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_trigger WHERE tgrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_rewrite WHERE ev_class='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_inherits WHERE inhrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass OR inhparent='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_attrdef WHERE adrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) THEN RAISE EXCEPTION 'ops_compact_transport_extra_metadata_forbidden'; END IF;
 IF (SELECT jsonb_agg(jsonb_build_object('name',attname,'type',atttypid::regtype::text,'number',attnum,'notnull',attnotnull,'typmod',atttypmod,'identity',attidentity,'generated',attgenerated,'collation',attcollation::regcollation::text,'acl',attacl::text,'options',attoptions,'fdwoptions',attfdwoptions,'storage',attstorage,'compression',attcompression,'local',attislocal,'inheritance',attinhcount) ORDER BY attnum) FROM pg_attribute WHERE attrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND attnum>0) IS DISTINCT FROM '[{"name":"ordinal","type":"integer","number":1,"notnull":true,"typmod":-1,"identity":"","generated":"","collation":"-","acl":null,"options":null,"fdwoptions":null,"storage":"p","compression":"","local":true,"inheritance":0},{"name":"payload","type":"text","number":2,"notnull":true,"typmod":-1,"identity":"","generated":"","collation":"\"default\"","acl":null,"options":null,"fdwoptions":null,"storage":"x","compression":"","local":true,"inheritance":0}]'::jsonb THEN RAISE EXCEPTION 'ops_compact_transport_column_metadata_unknown'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass)<>1 OR NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND conname='payload_parts_pkey' AND contype='p' AND conkey=ARRAY[1]::smallint[] AND NOT condeferrable AND NOT condeferred AND convalidated AND conislocal AND coninhcount=0 AND conparentid=0 AND pg_get_constraintdef(oid)='PRIMARY KEY (ordinal)') THEN RAISE EXCEPTION 'ops_compact_transport_constraint_metadata_unknown'; END IF;
 IF NOT EXISTS(SELECT FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.oid='ops_api_atomic_transport_bb0bd0ce.payload_parts_pkey'::regclass AND c.relkind='i' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND c.relacl IS NULL AND c.reloptions IS NULL AND c.relpersistence='p' AND i.indrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND i.indisunique AND i.indisprimary AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate AND NOT i.indisexclusion AND NOT i.indisclustered AND NOT i.indisreplident AND NOT i.indnullsnotdistinct AND i.indnatts=1 AND i.indnkeyatts=1 AND i.indkey='1'::int2vector AND i.indcollation='0'::oidvector AND i.indoption='0'::int2vector AND i.indclass=(SELECT oid::text::oidvector FROM pg_opclass WHERE opcnamespace='pg_catalog'::regnamespace AND opcname='int4_ops' AND opcmethod=(SELECT oid FROM pg_am WHERE amname='btree')) AND i.indexprs IS NULL AND i.indpred IS NULL AND pg_get_indexdef(c.oid)='CREATE UNIQUE INDEX payload_parts_pkey ON ops_api_atomic_transport_bb0bd0ce.payload_parts USING btree (ordinal)') THEN RAISE EXCEPTION 'ops_compact_transport_index_metadata_unknown'; END IF;
 IF (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce')<>2 OR NOT EXISTS(SELECT FROM pg_type WHERE typnamespace=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce') AND typname='payload_parts' AND typtype='c' AND typrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND typowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND typacl IS NULL) OR NOT EXISTS(SELECT FROM pg_type WHERE typnamespace=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce') AND typname='_payload_parts' AND typtype='b' AND typelem='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regtype AND typowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND typacl IS NULL) THEN RAISE EXCEPTION 'ops_compact_transport_type_metadata_unknown'; END IF;
 IF EXISTS(SELECT FROM pg_depend WHERE deptype='e' AND ((classid='pg_namespace'::regclass AND objid=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce')) OR (classid='pg_class'::regclass AND objid IN ('ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass,'ops_api_atomic_transport_bb0bd0ce.payload_parts_pkey'::regclass)))) THEN RAISE EXCEPTION 'ops_compact_transport_extension_membership_forbidden'; END IF;
 IF EXISTS(SELECT FROM ops_api_atomic_transport_bb0bd0ce.payload_parts p LEFT JOIN (VALUES (1,80547,'aeac6d55ebfafc9c0d5ad30bf4dad37178fd46d9e52f43c846612fac1cc0b073'),(2,80547,'1056f8241fab935b5b36174658b4566d6562e7980f66a4f62399137708480f55'),(3,80547,'8d7736d9c18f0ec7e02c421907daf0f254ee9fe54aa61353e13d6827c8443f73'),(4,80547,'1f375fd1052f325b5a2e23f1c0a87d7a5c4c0c39c84b01ad6afa154865ecafc7'),(5,80547,'7ec7255e4de7f738c33eb48119de9d7d4dcbb2ed542e9136f9165824edc352c1'),(6,80547,'6e3ba08e32dd8605bd8a2378ba6cdfcec4d513eafdf55bd3fc2940b96dfa9749'),(7,80547,'7e941361061f7515bce84fb77b83f10c7dd1814356ac762bf12856d37abb4d2a'),(8,80547,'929b535701f910a90c5a2ead0a1a501bc631a04ecabc2b779c9a7286e25064f7'),(9,80547,'32b289b55a734020b96487e5498b908b8d1978a4878e8ab3470e0e73c6bdce5e'),(10,80547,'d0ca52a50e80383ced15051bcba9ca7e24e69858fa0be512c40cd4fbc6e975c3'),(11,80547,'e7773322ceb01f55240b0372e3ee234bb9cfd7bc8d8c572c867c585ee4bb76e7'),(12,80536,'8e9a209d6d969d1fc0435bcb564c05f54400a9faaf58ee4dcd3373d3013f91fa')) expected(ordinal,byte_count,digest) USING(ordinal) WHERE expected.ordinal IS NULL OR octet_length(convert_to(p.payload,'UTF8'))<>expected.byte_count OR encode(sha256(convert_to(p.payload,'UTF8')),'hex')<>expected.digest) THEN RAISE EXCEPTION 'ops_compact_transport_part_bytes_unknown'; END IF;

 DROP TABLE ops_api_atomic_transport_bb0bd0ce.payload_parts RESTRICT;
 DROP SCHEMA ops_api_atomic_transport_bb0bd0ce RESTRICT;
 IF EXISTS(SELECT FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce') THEN RAISE EXCEPTION 'ops_compact_transport_cleanup_postcheck_failed'; END IF;
END $ops_compact_apply$;
COMMIT;
