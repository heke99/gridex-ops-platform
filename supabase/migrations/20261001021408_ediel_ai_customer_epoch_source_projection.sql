-- Actual forward: compose source-only customer deltas over the SAME qualified
-- AI Z04 baseline. The existing structural/source/supply/whole-cell matcher
-- remains sole row owner; current public customer scalars never qualify history.
BEGIN;
CREATE FUNCTION gridex_ai_processing.customer_row_epoch_v1(i public.ediel_message_intents,cutoff timestamptz,baseline_ud jsonb,period_start text,requested_day text,search_end text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE history jsonb;p jsonb;customer_id text:=baseline_ud#>>'{elements,2,0}';customer_name text:=gridex_ai_processing.party_text_v1(baseline_ud,4,2);start_day text:=period_start;next_day text;day text;at timestamptz;name jsonb;BEGIN
 history:=gridex_customer_life_events.qualified_patches_v1(i.company_id,i.customer_id,gridex_received_sources.permission_time_v1(period_start||'0000'),gridex_received_sources.permission_time_v1(search_end||'0000'),cutoff);
 IF history->>'status' IS DISTINCT FROM 'authorized' OR history->>'authorizesInitialCustomer' IS DISTINCT FROM 'false' OR jsonb_array_length(history->'patches')>1000 THEN RAISE EXCEPTION 'ai_list_original_customer_patch_owner_required';END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(history->'patches') LOOP
  IF NOT ((p->'customerFields') ?| ARRAY['org_number','personal_number']) AND NOT ((p->'endUserMasterdata') ? 'name') THEN CONTINUE;END IF;
  at:=(p->>'effectiveAt')::timestamptz;day:=to_char(at AT TIME ZONE 'Etc/GMT-1','YYYYMMDD');
  IF at IS DISTINCT FROM gridex_received_sources.permission_time_v1(day||'0000') THEN RAISE EXCEPTION 'ai_list_date_only_customer_boundary_unrepresentable';END IF;
  IF day>requested_day THEN next_day:=day;EXIT;END IF;start_day:=day;
  IF (p->'customerFields') ? 'org_number' AND (p->'customerFields') ? 'personal_number' THEN RAISE EXCEPTION 'ai_list_customer_identity_patch_ambiguous';END IF;
  IF (p->'customerFields') ? 'org_number' THEN customer_id:=p#>>'{customerFields,org_number}';ELSIF (p->'customerFields') ? 'personal_number' THEN customer_id:=p#>>'{customerFields,personal_number}';END IF;
  IF (p->'endUserMasterdata') ? 'name' THEN
   name:=p#>'{endUserMasterdata,name}';IF jsonb_typeof(name) IS DISTINCT FROM 'array' OR jsonb_array_length(name) NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'ai_list_customer_name_patch_invalid';END IF;
   customer_name:=gridex_ai_processing.party_text_v1(jsonb_build_object('elements',jsonb_build_array(jsonb_build_array('NAD'),jsonb_build_array('UD'),'null'::jsonb,'null'::jsonb,name)),4,2);
  END IF;
  IF nullif(customer_id,'') IS NULL OR customer_id<>btrim(customer_id) OR length(customer_id)>35 OR customer_id~'[[:cntrl:];]' OR nullif(customer_name,'') IS NULL THEN RAISE EXCEPTION 'ai_list_customer_identity_patch_invalid';END IF;
 END LOOP;
 RETURN jsonb_build_object('customerId',customer_id,'customerName',customer_name,'startDay',start_day,'nextDay',next_day);
END$$;

-- This is a projection of the SAME C object owner, not source-wide customer
-- acceptance. A mixed source's independently unavailable F/G object stays held.
CREATE FUNCTION gridex_ai_processing.customer_only_patch_object_v1(i public.ediel_message_intents,history jsonb,source jsonb,object_id text,agency text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE wire jsonb:=gridex_customer_life_events.wire_partition_v1(source->>'rawPayload');own jsonb;p jsonb;a gridex_received_sources.object_assessments%rowtype;entry jsonb;BEGIN
 IF wire->>'family' IS DISTINCT FROM 'PRODAT' OR wire->>'code' IS DISTINCT FROM 'Z06'
  OR source->>'payloadHash' IS DISTINCT FROM encode(sha256(convert_to(source->>'rawPayload','UTF8')),'hex') THEN RETURN false;END IF;
 SELECT x INTO own FROM jsonb_array_elements(wire->'objects') x WHERE x->>'point'=object_id AND x->>'identityAgency'=agency;
 IF own IS NULL OR own->>'projectionHeld'='true' OR own->>'reason' IS DISTINCT FROM 'E34' OR nullif(own->>'li','') IS NULL OR own->>'effectiveAt' IS NULL OR (own#>>'{customerParty,1}' IN('SE1','SE2')) IS NOT TRUE OR own#>>'{customerParty,2}' IS DISTINCT FROM '260' THEN RETURN false;END IF;
 FOR p IN SELECT x FROM jsonb_array_elements(history->'patches')x WHERE x->>'sourceMessageId'=source->>'sourceMessageId' AND x->>'sourcePayloadHash'=source->>'payloadHash' LOOP
  SELECT * INTO a FROM gridex_received_sources.object_assessments x WHERE x.id=(p->>'primaryAssessmentId')::uuid AND x.company_id=i.company_id AND x.source_message_id=(source->>'sourceMessageId')::uuid AND x.source_payload_hash=source->>'payloadHash' AND x.facts_hash=p->>'primaryFactsHash' AND x.facts_hash=encode(sha256(convert_to(x.facts_text,'UTF8')),'hex') AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=x.id);
  IF a.id IS NULL THEN CONTINUE;END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(a.facts_text::jsonb->'objects')x WHERE x#>>'{object,objectId}'=object_id AND x#>>'{object,identityAgency}'=agency)<>1 THEN CONTINUE;END IF;
  SELECT x INTO entry FROM jsonb_array_elements(a.facts_text::jsonb->'objects')x WHERE x#>>'{object,objectId}'=object_id AND x#>>'{object,identityAgency}'=agency;
  IF entry->>'disposition'='accepted' AND entry#>>'{business,customerId}'=i.customer_id::text AND gridex_customer_life_events.owner_proof_consistent_v1(entry->'party',entry->'business',(source->>'sourceMessageId')::uuid) IS TRUE THEN RETURN true;END IF;
 END LOOP;RETURN false;
END$$;
REVOKE ALL ON FUNCTION gridex_ai_processing.customer_only_patch_object_v1(public.ediel_message_intents,jsonb,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION gridex_ai_processing.row_epoch_matches_v1(body jsonb,cutoff timestamptz,i public.ediel_message_intents,object_id text,agency text,period_id text,state_id text,address_id text,period_start text,search_start text,search_end text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source jsonb;candidate jsonb;other jsonb;basis jsonb;active jsonb:='[]';all_owned jsonb:='[]';replaced text[]:=ARRAY[]::text[];id text;at text;state_at text;next_at text;address_at text;latest_address text;n integer;cursor_id text;ancestors text[];tokens jsonb;code text;first_lin integer;own_start integer;own_end integer;physical_at text;latest jsonb;own_entry jsonb;customer_history jsonb;
BEGIN
 customer_history:=gridex_customer_life_events.qualified_patches_v1(i.company_id,i.customer_id,gridex_received_sources.permission_time_v1(period_start||'0000'),gridex_received_sources.permission_time_v1(search_end||'0000'),cutoff);
 IF customer_history->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'ai_list_original_customer_patch_owner_required';END IF;
 FOR source IN SELECT value FROM jsonb_array_elements(body->'sources') LOOP
  id:=source->>'sourceMessageId';basis:=gridex_ai_processing.source_row_basis_v1(body,cutoff,id,i,object_id,agency);
  IF basis IS NULL THEN
   -- Missing own approval cannot disappear from an otherwise complete source
   -- universe. Independently identify only its physical scope/time; no new
   -- positive business fact or event time is manufactured here.
   tokens:=gridex_received_sources.closure_wire_tokens_v2(source->>'rawPayload');
   IF tokens IS NULL THEN RAISE EXCEPTION 'ai_list_original_source_universe_unqualified';END IF;
   SELECT t#>>'{elements,1,0}' INTO code FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' ORDER BY (t->>'index')::integer LIMIT 1;
   IF code NOT IN ('Z04','Z06','Z10') THEN CONTINUE;END IF;
   SELECT min((t->>'index')::integer) INTO first_lin FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN';
   IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='NAD' AND (t->>'index')::integer<first_lin AND t#>>'{elements,1,0}'='FR' AND t#>>'{elements,2,0}'=i.receiver_ediel_id AND t#>>'{elements,2,1}'='160' AND t#>>'{elements,2,2}'='SVK')
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='NAD' AND (t->>'index')::integer<first_lin AND t#>>'{elements,1,0}'='DO' AND t#>>'{elements,2,0}'=i.sender_ediel_id AND t#>>'{elements,2,1}'='160' AND t#>>'{elements,2,2}'='SVK') THEN CONTINUE;END IF;
   SELECT min((t->>'index')::integer) INTO own_start FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' AND t#>>'{elements,3,0}'=object_id AND t#>>'{elements,3,3}'=agency;
   IF own_start IS NULL THEN CONTINUE;END IF;
   -- A source-wide customer patch is not structural acceptance for another
   -- own object. The SAME E owner parser must prove this exact physical own
   -- event is customer-only; unknown F/G scopes remain independently held.
   IF gridex_ai_processing.customer_only_patch_object_v1(i,customer_history,source,object_id,agency) THEN CONTINUE;END IF;
   SELECT min((t->>'index')::integer) INTO own_end FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' AND (t->>'index')::integer>own_start;
   SELECT t#>>'{elements,1,1}' INTO physical_at FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='DTM' AND (t->>'index')::integer>own_start AND (own_end IS NULL OR (t->>'index')::integer<own_end)
    AND t#>>'{elements,1,0}'=CASE WHEN code='Z04' THEN '92' ELSE '157' END ORDER BY (t->>'index')::integer LIMIT 1;
   IF physical_at IS NOT NULL AND (physical_at<period_start||'0000' OR physical_at>=search_end||'0000') THEN CONTINUE;END IF;
   SELECT x INTO latest FROM jsonb_array_elements(source->'assessments') x WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(source->'assessments') child WHERE child->>'previousAssessmentId'=x->>'id');
   SELECT x INTO own_entry FROM jsonb_array_elements((latest->>'factsText')::jsonb->'objects') x WHERE x#>>'{object,objectId}'=object_id AND x#>>'{object,identityAgency}'=agency;
   IF own_entry->>'disposition'='rejected' THEN CONTINUE;END IF;
   RAISE EXCEPTION 'ai_list_original_dated_source_owner_missing';
  END IF;
  IF basis#>>'{business,supplyPeriodId}' IS DISTINCT FROM period_id THEN CONTINUE;END IF;
  IF basis#>>'{business,wire,businessCase}'='customer_only' THEN
   IF gridex_ai_processing.customer_only_patch_object_v1(i,customer_history,source,object_id,agency) AND EXISTS(SELECT FROM jsonb_array_elements(customer_history->'patches') p WHERE p->>'sourceMessageId'=id AND p->>'sourcePayloadHash'=basis#>>'{business,sourcePayloadHash}' AND (p->>'effectiveAt')::timestamptz=gridex_received_sources.permission_time_v1(basis#>>'{business,wire,effectiveFrom,marketMinute}')) THEN CONTINUE;END IF;
   RAISE EXCEPTION 'ai_list_dated_customer_change_owner_required';
  END IF;
  all_owned:=all_owned||jsonb_build_array(jsonb_build_object('id',id,'basis',basis));
 END LOOP;
 -- Only already-qualified exact replacement edges from the same original
 -- object/period may remove a prior event. A claim cannot create an edge.
 FOR candidate IN SELECT value FROM jsonb_array_elements(all_owned) LOOP
  basis:=candidate->'basis';
  IF basis#>>'{business,wire,functionCode}'='5' THEN
   id:=basis#>>'{business,replaces,sourceMessageId}';
   SELECT count(*) INTO n FROM jsonb_array_elements(all_owned) old WHERE old->>'id'=id
    AND old#>>'{basis,business,sourcePayloadHash}'=basis#>>'{business,replaces,payloadHash}'
    AND old#>>'{basis,assessmentId}'=basis#>>'{business,replaces,assessmentId}';
   IF n<>1 OR id=ANY(replaced) OR id=candidate->>'id' THEN RAISE EXCEPTION 'ai_list_original_correction_source_unqualified';END IF;
   replaced:=array_append(replaced,id);
  ELSIF basis#>'{business,replaces}' IS NOT NULL AND basis#>'{business,replaces}'<>'null'::jsonb THEN RAISE EXCEPTION 'ai_list_original_correction_source_unqualified';END IF;
 END LOOP;
 FOR candidate IN SELECT value FROM jsonb_array_elements(all_owned) LOOP
  cursor_id:=candidate->>'id';ancestors:=ARRAY[]::text[];
  WHILE cursor_id IS NOT NULL LOOP
   IF cursor_id=ANY(ancestors) OR cardinality(ancestors)>1000 THEN RAISE EXCEPTION 'ai_list_original_correction_cycle';END IF;
   ancestors:=array_append(ancestors,cursor_id);
   SELECT x#>>'{basis,business,replaces,sourceMessageId}' INTO cursor_id FROM jsonb_array_elements(all_owned) x WHERE x->>'id'=cursor_id;
  END LOOP;
 END LOOP;
 FOR candidate IN SELECT value FROM jsonb_array_elements(all_owned) LOOP
  IF NOT(candidate->>'id'=ANY(replaced)) THEN active:=active||jsonb_build_array(candidate);END IF;
 END LOOP;
 SELECT count(*),max(x#>>'{basis,business,wire,effectiveFrom,marketMinute}') INTO n,state_at FROM jsonb_array_elements(active) x WHERE x->>'id'=state_id;
 IF n<>1 OR state_at IS NULL OR state_at<period_start||'0000' OR state_at>=search_end||'0000' THEN RAISE EXCEPTION 'ai_list_original_row_epoch_mismatch';END IF;
 -- No omitted own source may split or precede this emitted epoch. This binds
 -- the row's end to the full immutable source universe, not the next claim.
 SELECT min(x#>>'{basis,business,wire,effectiveFrom,marketMinute}') INTO next_at FROM jsonb_array_elements(active) x
 WHERE x#>>'{basis,business,wire,effectiveFrom,marketMinute}'>state_at AND x#>>'{basis,business,wire,effectiveFrom,marketMinute}'<search_end||'0000';
 IF EXISTS(SELECT FROM jsonb_array_elements(active) x WHERE x->>'id'<>state_id
   AND (x#>>'{basis,business,wire,effectiveFrom,marketMinute}'=state_at
    OR state_at<search_start||'0000' AND x#>>'{basis,business,wire,effectiveFrom,marketMinute}'>state_at AND x#>>'{basis,business,wire,effectiveFrom,marketMinute}'<=search_start||'0000')) THEN RAISE EXCEPTION 'ai_list_original_row_epoch_mismatch';END IF;
 SELECT max(x#>>'{basis,business,wire,effectiveFrom,marketMinute}') INTO address_at FROM jsonb_array_elements(active) x
 WHERE x#>>'{basis,business,wire,messageCode}'<>'Z10' AND x#>>'{basis,business,wire,effectiveFrom,marketMinute}'<=state_at
  AND x#>>'{basis,business,wire,effectiveFrom,marketMinute}'>=period_start||'0000';
 SELECT count(*),max(x->>'id') INTO n,latest_address FROM jsonb_array_elements(active) x
 WHERE x#>>'{basis,business,wire,messageCode}'<>'Z10' AND x#>>'{basis,business,wire,effectiveFrom,marketMinute}'=address_at;
 IF n<>1 OR latest_address IS DISTINCT FROM address_id OR right(state_at,4)<>'0000' OR next_at IS NOT NULL AND right(next_at,4)<>'0000' THEN RAISE EXCEPTION 'ai_list_original_row_address_epoch_mismatch';END IF;
 RETURN jsonb_build_object('stateMinute',state_at,'nextMinute',next_at);
END $$;

CREATE OR REPLACE FUNCTION gridex_ai_processing.require_original_row_sources_before_applied_structure_v1(body jsonb,cutoff timestamptz,i public.ediel_message_intents,raw text,claims text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE refs jsonb;ref jsonb;state jsonb;base jsonb;address jsonb;cols text[];records text[];h text[];normalized text;
 matched integer;expected text[];baseline_ud jsonb;address_it jsonb;brp jsonb;grid jsonb;period public.customer_supply_periods%rowtype;
 cover jsonb;epoch jsonb;customer_epoch jsonb;intervals jsonb:='[]';span jsonb;cursor_date text;required_end text;period_count integer:=0;covered_periods uuid[]:=ARRAY[]::uuid[];start_date text;end_date text;state_date text;period_from text;period_to text;seen text[]:=ARRAY[]::text[];row integer;n integer;
BEGIN
 IF claims IS NULL OR octet_length(claims)>262144 THEN RAISE EXCEPTION 'ai_list_original_row_sources_required';END IF;refs:=claims::jsonb;
 normalized:=replace(raw,E'\r\n',E'\n');IF left(normalized,1)=chr(65279) THEN normalized:=substring(normalized FROM 2);END IF;IF right(normalized,1)=E'\n' THEN normalized:=left(normalized,length(normalized)-1);END IF;
 records:=string_to_array(normalized,E'\n');h:=string_to_array(records[1],';');
 IF jsonb_typeof(refs)<>'array' OR jsonb_array_length(refs)<>cardinality(records)-1 OR jsonb_array_length(refs)>1000 THEN RAISE EXCEPTION 'ai_list_original_row_sources_required';END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(refs) LOOP
  IF jsonb_typeof(ref)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(ref))<>4 OR NOT(ref ?& ARRAY['sourceMessageId','baselineSourceMessageId','addressSourceMessageId','supplyPeriodId']) THEN RAISE EXCEPTION 'ai_list_original_row_source_scope_invalid';END IF;
  SELECT * INTO period FROM public.customer_supply_periods p WHERE p.id=(ref->>'supplyPeriodId')::uuid AND p.company_id=i.company_id AND p.customer_id=i.customer_id ;
  IF NOT FOUND OR nullif(i.metering_point_id,'') IS NOT NULL AND period.metering_point_id::text IS DISTINCT FROM i.metering_point_id THEN RAISE EXCEPTION 'ai_list_original_row_supply_scope_invalid';END IF;
  -- Match by actual original object, never by mutable portal point/name fields.
  matched:=0;
  FOR row IN 2..cardinality(records) LOOP
   IF row::text=ANY(seen) THEN CONTINUE;END IF;cols:=string_to_array(records[row],';');
   state:=gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'sourceMessageId',i,cols[2],cols[3]);
   IF state IS NULL THEN CONTINUE;END IF;
   base:=gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'baselineSourceMessageId',i,cols[2],cols[3]);
   address:=gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'addressSourceMessageId',i,cols[2],cols[3]);
   IF base IS NULL OR address IS NULL OR base#>>'{business,wire,businessCase}'<>'supply_baseline'
    OR state#>>'{business,coverageWindow,baselineSourceMessageId}' IS DISTINCT FROM ref->>'baselineSourceMessageId'
    OR address#>>'{business,coverageWindow,baselineSourceMessageId}' IS DISTINCT FROM ref->>'baselineSourceMessageId'
    OR state#>>'{business,supplyPeriodId}' IS DISTINCT FROM period.id::text OR base#>>'{business,supplyPeriodId}' IS DISTINCT FROM period.id::text
    OR address#>>'{business,supplyPeriodId}' IS DISTINCT FROM period.id::text OR address#>>'{business,wire,messageCode}'='Z10'
    OR address#>>'{business,wire,effectiveFrom,marketMinute}'>state#>>'{business,wire,effectiveFrom,marketMinute}' THEN CONTINUE;END IF;
   SELECT t INTO baseline_ud FROM jsonb_array_elements(base->'ownTokens') t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='UD' ORDER BY (t->>'index')::integer LIMIT 1;
   SELECT t INTO address_it FROM jsonb_array_elements(address->'ownTokens') t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='IT' ORDER BY (t->>'index')::integer LIMIT 1;
   SELECT t INTO brp FROM jsonb_array_elements(state->'ownTokens') t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='Z02' ORDER BY (t->>'index')::integer LIMIT 1;
   SELECT t INTO grid FROM jsonb_array_elements(state->'ownTokens') t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='Z05' ORDER BY (t->>'index')::integer LIMIT 1;
   IF baseline_ud#>>'{elements,2,1}' NOT IN ('SE1','SE2') OR baseline_ud#>>'{elements,2,2}' IS DISTINCT FROM '260'
    OR nullif(baseline_ud#>>'{elements,2,0}','') IS NULL OR nullif(brp#>>'{elements,2,0}','') IS NULL OR nullif(grid#>>'{elements,1,1}','') IS NULL THEN CONTINUE;END IF;
   state_date:=state#>>'{business,wire,effectiveFrom,marketMinute}';IF right(state_date,4)<>'0000' THEN CONTINUE;END IF;state_date:=left(state_date,8);
   period_from:=to_char(coalesce(period.actual_start_date,period.start_date),'YYYYMMDD');period_to:=to_char(coalesce(period.actual_end_date,period.end_date),'YYYYMMDD');
   IF base#>>'{business,wire,effectiveFrom,marketMinute}' IS DISTINCT FROM period_from||'0000' THEN CONTINUE;END IF;
   cover:=gridex_received_sources.supply_period_source_basis_v1(i.company_id,period.id,gridex_received_sources.permission_time_v1(greatest(h[8],period_from)||'0000'),gridex_received_sources.permission_time_v1(least(h[9],coalesce(period_to,h[9]))||'0000'));
   IF cover->>'qualified' IS DISTINCT FROM 'true' OR cover->>'customerId' IS DISTINCT FROM i.customer_id::text
    OR cover->>'siteId' IS DISTINCT FROM i.customer_site_id::text OR cover->>'initialSourceMessageId' IS DISTINCT FROM ref->>'baselineSourceMessageId'
    OR (cover->>'marketStartAt')::timestamptz IS DISTINCT FROM gridex_received_sources.permission_time_v1(period_from||'0000')
    OR (cover->>'marketEndAt')::timestamptz IS DISTINCT FROM gridex_received_sources.permission_time_v1(period_to||'0000') THEN CONTINUE;END IF;
   -- The shared lifecycle owner locks original/source before period; re-read
   -- that exact period only after its source-owned lock order is established.
   PERFORM p.id FROM public.customer_supply_periods p WHERE p.id=period.id AND p.company_id=i.company_id AND to_jsonb(p)=to_jsonb(period) FOR SHARE;
   IF NOT FOUND THEN CONTINUE;END IF;
   start_date:=greatest(h[8],period_from,state_date);end_date:=least(h[9],coalesce(period_to,h[9]));
   epoch:=gridex_ai_processing.row_epoch_matches_v1(body,cutoff,i,cols[2],cols[3],period.id::text,ref->>'sourceMessageId',ref->>'addressSourceMessageId',period_from,h[8],least(h[9],coalesce(period_to,h[9])));
   IF epoch->>'nextMinute' IS NOT NULL THEN end_date:=least(end_date,left(epoch->>'nextMinute',8));END IF;
   customer_epoch:=gridex_ai_processing.customer_row_epoch_v1(i,cutoff,baseline_ud,period_from,coalesce(nullif(cols[20],''),h[8]),least(h[9],coalesce(period_to,h[9])));
   start_date:=greatest(start_date,customer_epoch->>'startDay');
   IF customer_epoch->>'nextDay' IS NOT NULL THEN end_date:=least(end_date,customer_epoch->>'nextDay');END IF;
   IF start_date>=end_date THEN CONTINUE;END IF;
   expected:=ARRAY[grid#>>'{elements,1,1}',cols[2],cols[3],'','','','',gridex_ai_processing.party_text_v1(address_it,5,3),coalesce(address_it#>>'{elements,8,0}',''),coalesce(address_it#>>'{elements,6,0}',''),brp#>>'{elements,2,0}','','','','','','',customer_epoch->>'customerId',customer_epoch->>'customerName',CASE WHEN start_date=h[8] THEN '' ELSE start_date END,CASE WHEN end_date=h[9] THEN '' ELSE end_date END,''];
   IF cols IS DISTINCT FROM expected THEN CONTINUE;END IF;
   seen:=array_append(seen,row::text);covered_periods:=array_append(covered_periods,period.id);matched:=matched+1;
   intervals:=intervals||jsonb_build_array(jsonb_build_object('periodId',period.id,'start',start_date,'end',end_date));
   -- Customer epochs can repeat the same structural source claim. Consume
   -- exactly one already-qualified physical row per occurrence; every row is
   -- still required by equal cardinality/seen and exact contiguous coverage.
   EXIT;
  END LOOP;
  IF matched<>1 THEN RAISE EXCEPTION 'ai_list_original_row_source_mismatch';END IF;
 END LOOP;
 -- An empty or partial CSV cannot omit an owned overlapping supply period.
 -- No current-row status is treated as historical ownership.
 FOR period IN SELECT p.* FROM public.customer_supply_periods p WHERE p.company_id=i.company_id AND p.customer_id=i.customer_id
  AND (nullif(i.metering_point_id,'') IS NULL OR p.metering_point_id::text=i.metering_point_id)
  AND to_char(coalesce(p.actual_start_date,p.start_date),'YYYYMMDD')<h[9]
  AND (coalesce(p.actual_end_date,p.end_date) IS NULL OR to_char(coalesce(p.actual_end_date,p.end_date),'YYYYMMDD')>h[8]) ORDER BY p.id LOOP
  period_count:=period_count+1;IF period_count>1000 THEN RAISE EXCEPTION 'ai_list_supply_history_read_incomplete';END IF;
  period_from:=to_char(coalesce(period.actual_start_date,period.start_date),'YYYYMMDD');period_to:=to_char(coalesce(period.actual_end_date,period.end_date),'YYYYMMDD');
  cover:=gridex_received_sources.supply_period_source_basis_v1(i.company_id,period.id,gridex_received_sources.permission_time_v1(greatest(h[8],period_from)||'0000'),gridex_received_sources.permission_time_v1(least(h[9],coalesce(period_to,h[9]))||'0000'));
  IF cover->>'qualified' IS DISTINCT FROM 'true' OR cover->>'customerId' IS DISTINCT FROM i.customer_id::text THEN RAISE EXCEPTION 'ai_list_original_dated_supply_owner_required';END IF;
  IF cover->>'siteId'=i.customer_site_id::text AND NOT(period.id=ANY(covered_periods)) THEN RAISE EXCEPTION 'ai_list_original_supply_period_omitted';END IF;
  IF cover->>'siteId'=i.customer_site_id::text THEN
   cursor_date:=greatest(h[8],period_from);required_end:=least(h[9],coalesce(period_to,h[9]));
   FOR span IN SELECT value FROM jsonb_array_elements(intervals) WHERE value->>'periodId'=period.id::text ORDER BY value->>'start' LOOP
    IF span->>'start' IS DISTINCT FROM cursor_date OR span->>'end'>required_end OR span->>'end'<=span->>'start' THEN RAISE EXCEPTION 'ai_list_original_supply_epoch_omitted';END IF;
    cursor_date:=span->>'end';
   END LOOP;
   IF cursor_date IS DISTINCT FROM required_end THEN RAISE EXCEPTION 'ai_list_original_supply_epoch_omitted';END IF;
  END IF;
 END LOOP;
 RETURN refs;
END $$;

CREATE FUNCTION gridex_ai_processing.customer_history_for_rows_v1(body jsonb,cutoff timestamptz,i public.ediel_message_intents,raw text,claims text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE refs jsonb;ref jsonb;basis jsonb;records text[];cols text[];normalized text;row integer;first_at timestamptz;candidate_at timestamptz;history jsonb;BEGIN
 IF claims IS NULL OR octet_length(claims)>262144 THEN RAISE EXCEPTION 'ai_list_original_row_sources_required';END IF;refs:=claims::jsonb;
 IF jsonb_typeof(refs) IS DISTINCT FROM 'array' OR jsonb_array_length(refs)>1000 THEN RAISE EXCEPTION 'ai_list_original_row_sources_required';END IF;
 normalized:=replace(raw,E'\r\n',E'\n');IF left(normalized,1)=chr(65279) THEN normalized:=substring(normalized FROM 2);END IF;
 IF right(normalized,1)=E'\n' THEN normalized:=left(normalized,length(normalized)-1);END IF;records:=string_to_array(normalized,E'\n');
 IF jsonb_array_length(refs)=0 THEN RETURN jsonb_build_object('status','authorized','companyId',i.company_id,'customerId',i.customer_id,'cutoff',cutoff,'authorizesInitialCustomer',false,'patches','[]'::jsonb);END IF;
 -- Range discovery uses qualified actual baseline bytes, not portal start dates.
 -- The complete row owner still validates every claimed baseline/period below.
 FOR ref IN SELECT value FROM jsonb_array_elements(refs) LOOP
  FOR row IN 2..cardinality(records) LOOP
   cols:=string_to_array(records[row],';');basis:=gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'baselineSourceMessageId',i,cols[2],cols[3]);
   IF basis#>>'{business,wire,businessCase}' IS DISTINCT FROM 'supply_baseline' OR basis#>>'{business,supplyPeriodId}' IS DISTINCT FROM ref->>'supplyPeriodId' THEN CONTINUE;END IF;
   candidate_at:=gridex_received_sources.permission_time_v1(basis#>>'{business,wire,effectiveFrom,marketMinute}');
   IF first_at IS NULL OR candidate_at<first_at THEN first_at:=candidate_at;END IF;
  END LOOP;
 END LOOP;
 IF first_at IS NULL THEN RAISE EXCEPTION 'ai_list_original_row_source_mismatch';END IF;
 history:=gridex_customer_life_events.qualified_patches_v1(i.company_id,i.customer_id,first_at,gridex_received_sources.permission_time_v1(split_part(records[1],';',9)||'0000'),cutoff);
 IF history->>'status' IS DISTINCT FROM 'authorized' OR history->>'authorizesInitialCustomer' IS DISTINCT FROM 'false' OR jsonb_array_length(history->'patches')>1000 THEN RAISE EXCEPTION 'ai_list_original_customer_patch_owner_required';END IF;
 RETURN history;
END$$;

CREATE OR REPLACE FUNCTION gridex_ai_processing.require_original_row_sources_v1(body jsonb,cutoff timestamptz,i public.ediel_message_intents,raw text,claims text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE refs jsonb;ref jsonb;basis jsonb;state jsonb;base jsonb;address jsonb;source_id text;records text[];cols text[];normalized text;row integer;matched boolean;
BEGIN
 PERFORM gridex_ai_processing.customer_history_for_rows_v1(body,cutoff,i,raw,claims);
 -- Full physical CSV/source/supply/epoch equality remains the existing owner.
 refs:=gridex_ai_processing.require_original_row_sources_before_applied_structure_v1(body,cutoff,i,raw,claims);
 normalized:=replace(raw,E'\r\n',E'\n');IF left(normalized,1)=chr(65279) THEN normalized:=substring(normalized FROM 2);END IF;
 IF right(normalized,1)=E'\n' THEN normalized:=left(normalized,length(normalized)-1);END IF;records:=string_to_array(normalized,E'\n');
 FOR ref IN SELECT value FROM jsonb_array_elements(refs) LOOP
  matched:=false;
  FOR row IN 2..cardinality(records) LOOP
   cols:=string_to_array(records[row],';');
   state:=gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'sourceMessageId',i,cols[2],cols[3]);
   base:=gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'baselineSourceMessageId',i,cols[2],cols[3]);
   address:=gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'addressSourceMessageId',i,cols[2],cols[3]);
   IF state IS NULL OR base IS NULL OR address IS NULL
    OR state#>>'{business,supplyPeriodId}' IS DISTINCT FROM ref->>'supplyPeriodId'
    OR base#>>'{business,supplyPeriodId}' IS DISTINCT FROM ref->>'supplyPeriodId'
    OR address#>>'{business,supplyPeriodId}' IS DISTINCT FROM ref->>'supplyPeriodId' THEN CONTINUE;END IF;
   matched:=true;
   FOR source_id,basis IN SELECT DISTINCT x.id,x.basis FROM (VALUES(ref->>'sourceMessageId',state),(ref->>'baselineSourceMessageId',base),(ref->>'addressSourceMessageId',address)) x(id,basis) LOOP
    -- Z04 is qualified by the sole current normal-supply owner in the full
    -- row binder. Other structural states require their own immutable effect.
    IF basis#>>'{business,wire,messageCode}'='Z04' THEN CONTINUE;END IF;
    IF nullif(basis#>>'{business,meteringPointId}','') IS NULL OR gridex_received_sources.structural_effect_matches_v1(
     i.company_id,i.environment,source_id::uuid,(basis->>'assessmentId')::uuid,i.customer_id,i.customer_site_id,
     (basis#>>'{business,meteringPointId}')::uuid,(ref->>'supplyPeriodId')::uuid,cols[2],cols[3],cutoff) IS NOT TRUE
     THEN RAISE EXCEPTION 'ai_list_applied_structural_source_unconfirmed';END IF;
   END LOOP;
  END LOOP;
  IF NOT matched THEN RAISE EXCEPTION 'ai_list_applied_history_own_scope_unconfirmed';END IF;
 END LOOP;
 RETURN refs;
END $$;
ALTER TABLE gridex_ai_processing.outbound_origins ADD COLUMN customer_history_basis jsonb;
CREATE OR REPLACE FUNCTION public.gridex_ai_record_outbound_original_v1(p_company_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_snapshot_id uuid,p_readset_hash text,p_raw_payload text,p_file_name text,p_mime_type text,p_row_sources text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.ediel_message_intents%rowtype;snap gridex_received_sources.object_selection_snapshots%rowtype;
 prior gridex_ai_processing.outbound_origins%rowtype;wire jsonb;decision jsonb;basis jsonb;source_ids jsonb;header text;point uuid;row_sources jsonb;customer_history jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_list_origination_service_required' USING ERRCODE='42501'; END IF;
 i:=gridex_ai_processing.intent_request_v1(p_company_id,p_intent_id);
 decision:=gridex_ai_processing.require_export_decision_for_intent_v1(p_company_id,p_actor_user_id,p_intent_id);
 SELECT * INTO prior FROM gridex_ai_processing.outbound_origins WHERE intent_id=i.id;
 IF FOUND THEN
  IF prior.company_id IS DISTINCT FROM p_company_id OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(p_raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ai_list_original_conflict'; END IF;
  RETURN jsonb_build_object('status','original','payloadHash',prior.payload_hash);
 END IF;
 wire:=gridex_ai_processing.outbound_wire_v1(p_raw_payload);
 IF wire->>'supplierEdielId' IS DISTINCT FROM i.sender_ediel_id OR wire->>'networkEdielId' IS DISTINCT FROM i.receiver_ediel_id THEN RAISE EXCEPTION 'ai_list_original_party_scope_mismatch'; END IF;
 header:=split_part(replace(p_raw_payload,E'\r\n',E'\n'),E'\n',1);
 IF split_part(header,';',8) IS DISTINCT FROM replace(i.payload->>'fromDate','-','') OR split_part(header,';',9) IS DISTINCT FROM replace(i.payload->>'toDate','-','') THEN RAISE EXCEPTION 'ai_list_original_search_scope_mismatch'; END IF;
 IF p_file_name IS NULL OR lower(p_file_name) NOT LIKE '%.csv' OR p_mime_type IS NULL OR p_mime_type!~* '^text/csv([ \t]*;[ \t]*charset[ \t]*=[ \t]*(utf-8|"utf-8"))?[ \t]*$' THEN RAISE EXCEPTION 'ai_list_csv_file_type_required'; END IF;
 basis:=gridex_ai_processing.header_company_basis_v1(p_company_id,i.environment,i.sender_ediel_id,i.receiver_ediel_id);
 -- A source-owned persisted COMPLETE snapshot, not a caller serialized history.
 SELECT * INTO snap FROM gridex_received_sources.object_selection_snapshots WHERE id=p_snapshot_id AND company_id=p_company_id AND environment=i.environment AND readset_hash=p_readset_hash FOR SHARE;
 IF NOT FOUND OR snap.readset_hash IS DISTINCT FROM encode(sha256(convert_to(snap.readset_text,'UTF8')),'hex') OR snap.cutoff_at<i.created_at
  OR snap.readset_text::jsonb->>'complete' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'ai_list_original_complete_history_snapshot_required'; END IF;
 -- First acquire source-owned customer epochs and the normal supply owner's
 -- source/period locks; tenant site/point equality is checked after those locks.
 customer_history:=gridex_ai_processing.customer_history_for_rows_v1(snap.readset_text::jsonb,snap.cutoff_at,i,p_raw_payload,p_row_sources);
 row_sources:=gridex_ai_processing.require_original_row_sources_v1(snap.readset_text::jsonb,snap.cutoff_at,i,p_raw_payload,p_row_sources);
 PERFORM cs.id FROM public.customer_sites cs WHERE cs.id=i.customer_site_id AND cs.company_id=p_company_id AND cs.customer_id=i.customer_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ai_list_customer_site_scope_mismatch'; END IF;
 IF nullif(i.metering_point_id,'') IS NOT NULL THEN
  point:=i.metering_point_id::uuid;
  PERFORM mp.id FROM public.metering_points mp WHERE mp.id=point AND mp.company_id=p_company_id AND mp.customer_id=i.customer_id AND coalesce(mp.customer_site_id,mp.site_id)=i.customer_site_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ai_list_metering_point_scope_mismatch'; END IF;
 END IF;
 -- References below have already passed own original/hash/leaf/cell/period
 -- equality. Earlier superseded accepted markers cannot enter this provenance.
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') INTO source_ids FROM (
  SELECT DISTINCT ref->>key AS id FROM jsonb_array_elements(row_sources) ref,
   unnest(ARRAY['sourceMessageId','baselineSourceMessageId','addressSourceMessageId']) key
  UNION SELECT p->>'sourceMessageId' FROM jsonb_array_elements(customer_history->'patches') p
 ) ids;
 INSERT INTO gridex_ai_processing.outbound_origins(intent_id,company_id,environment,actor_user_id,processing_decision_id,snapshot_id,readset_hash,raw_payload,payload_hash,file_name,mime_type,header_basis,source_ids,row_sources,customer_history_basis)
 VALUES(i.id,p_company_id,i.environment,p_actor_user_id,(decision#>>'{decision,id}')::uuid,snap.id,snap.readset_hash,p_raw_payload,encode(sha256(convert_to(p_raw_payload,'UTF8')),'hex'),p_file_name,p_mime_type,basis,source_ids,row_sources,customer_history);
 RETURN jsonb_build_object('status','original','payloadHash',encode(sha256(convert_to(p_raw_payload,'UTF8')),'hex'));
END $$;

REVOKE ALL ON FUNCTION gridex_ai_processing.customer_history_for_rows_v1(jsonb,timestamptz,public.ediel_message_intents,text,text),
 gridex_ai_processing.require_original_row_sources_v1(jsonb,timestamptz,public.ediel_message_intents,text,text),
 gridex_ai_processing.customer_row_epoch_v1(public.ediel_message_intents,timestamptz,jsonb,text,text,text),
 gridex_ai_processing.row_epoch_matches_v1(jsonb,timestamptz,public.ediel_message_intents,text,text,text,text,text,text,text,text),
 gridex_ai_processing.require_original_row_sources_before_applied_structure_v1(jsonb,timestamptz,public.ediel_message_intents,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gridex_ai_record_outbound_original_v1(uuid,uuid,uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_ai_record_outbound_original_v1(uuid,uuid,uuid,uuid,text,text,text,text,text) TO service_role;
COMMIT;
