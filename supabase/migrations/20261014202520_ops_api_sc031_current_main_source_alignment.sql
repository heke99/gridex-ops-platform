-- OPS current-main private source alignment; no business rows or grants.
-- Immutable source SHA256 d4555df6177b1d702a4262fc0d305986e0e029bbf50124a285e5418e3beb3a89.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $ops_sc031_known_predecessor$
DECLARE p pg_catalog.pg_proc%rowtype;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'ops_sc031_postgres_execution_required'; END IF;
 SELECT * INTO STRICT p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('gridex_prodat_object_batch.require_wire_projection_v1(text,jsonb,jsonb,text,uuid)');
 IF md5(p.prosrc) NOT IN ('575139caedf161f007a16b64873bb727','4682314319fefd9d2d258b0d31b7b554')
  OR pg_get_userbyid(p.proowner)<>'postgres' OR p.proacl IS DISTINCT FROM ARRAY['postgres=X/postgres']::aclitem[]
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] OR p.prosecdef OR p.provolatile<>'v'
  OR p.procost<>100 OR p.prorows<>0 OR p.prokind<>'f' OR p.proretset
  OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prosupport<>0
  OR p.probin IS NOT NULL OR p.prosqlbody IS NOT NULL OR p.proargdefaults IS NOT NULL OR p.pronargdefaults<>0
  OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL
  OR p.proargnames IS DISTINCT FROM ARRAY['raw','own','command','mode','actor']
  OR p.proargtypes::text<>'25 3802 3802 25 2950' OR p.prorettype<>'void'::regtype
  OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') THEN
  RAISE EXCEPTION 'ops_sc031_unknown_function_state_requires_review';
 END IF;
END $ops_sc031_known_predecessor$;
-- SC031 / P02: source-owned ignored input cannot supply business values.
-- Only this same-signature private invoker body changes; applied history,
-- ACL/owner/callers/role/source/CAS/receipt/retention and raw evidence stay intact.
-- Historical missing facets or polluted saved commands HOLD, never backfill.
-- Transaction-local catalog witness: no permanent helper or new grant.
DO $sc031_catalog$
DECLARE before_metadata jsonb;after_metadata jsonb;target_oid oid;
BEGIN
 target_oid:=to_regprocedure('gridex_prodat_object_batch.require_wire_projection_v1(text,jsonb,jsonb,text,uuid)');
 IF target_oid IS NULL THEN RAISE EXCEPTION 'sc031_existing_wire_projection_required';END IF;
 SELECT to_jsonb(p)-'prosrc' INTO before_metadata FROM pg_catalog.pg_proc p WHERE p.oid=target_oid;
 EXECUTE $sc031_forward$
CREATE OR REPLACE FUNCTION gridex_prodat_object_batch.require_wire_projection_v1(raw text, own jsonb, command jsonb, mode text, actor uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $_$
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
END $_$;
$sc031_forward$;
 SELECT to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_catalog.pg_proc p WHERE p.oid=target_oid;
 IF after_metadata IS DISTINCT FROM before_metadata THEN RAISE EXCEPTION 'sc031_wire_projection_catalog_changed';END IF;
 RAISE NOTICE 'SC031 catalog preservation target=% metadataSHA256=% before=% after=%',target_oid,
  encode(sha256(convert_to(before_metadata::text,'UTF8')),'hex'),before_metadata,after_metadata;
END;
$sc031_catalog$;

DO $ops_sc031_exact_postimage$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('gridex_prodat_object_batch.require_wire_projection_v1(text,jsonb,jsonb,text,uuid)')) IS DISTINCT FROM '4682314319fefd9d2d258b0d31b7b554' THEN RAISE EXCEPTION 'ops_sc031_current_main_body_required'; END IF;
END $ops_sc031_exact_postimage$;
COMMIT;
