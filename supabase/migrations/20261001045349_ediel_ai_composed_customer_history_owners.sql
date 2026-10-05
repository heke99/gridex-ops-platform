-- Additive composition of independently qualified customer owners. The complete
-- physical row/source/supply/structural matcher remains the existing owner.
BEGIN;
CREATE FUNCTION gridex_ai_processing.customer_source_object_composed_v1(body jsonb,cutoff timestamptz,i public.ediel_message_intents,history jsonb,source jsonb,object_id text,agency text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE facet jsonb;wire jsonb;own jsonb;BEGIN
 IF NOT EXISTS(SELECT FROM public.ediel_messages m WHERE m.id::text=source->>'sourceMessageId' AND m.company_id=i.company_id AND m.environment=i.environment AND m.direction='inbound' AND m.message_family='PRODAT' AND m.raw_payload=source->>'rawPayload') THEN RETURN false;END IF;
 wire:=gridex_customer_life_events.wire_partition_v1(source->>'rawPayload');
 IF wire->>'family' IS DISTINCT FROM 'PRODAT' OR wire->>'code' IS DISTINCT FROM 'Z06' OR source->>'payloadHash' IS DISTINCT FROM encode(sha256(convert_to(source->>'rawPayload','UTF8')),'hex') THEN RETURN false;END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(wire->'objects') x WHERE x->>'point'=object_id AND x->>'identityAgency'=agency)<>1 THEN RETURN false;END IF;
 SELECT x INTO own FROM jsonb_array_elements(wire->'objects') x WHERE x->>'point'=object_id AND x->>'identityAgency'=agency;
 IF gridex_ai_processing.customer_only_patch_object_v1(i,history,source,object_id,agency) AND EXISTS(SELECT FROM jsonb_array_elements(history->'patches') p WHERE p->>'sourceMessageId'=source->>'sourceMessageId' AND p->>'sourcePayloadHash'=source->>'payloadHash' AND (p->>'effectiveAt')::timestamptz=(own->>'effectiveAt')::timestamptz) THEN RETURN true;END IF;
 facet:=gridex_requested_changes.customer_facet_basis_v1(body,cutoff,i.company_id,i.environment,i.customer_id,i.customer_site_id,source->>'sourceMessageId',object_id,agency);
 IF facet IS NULL OR facet->>'payloadHash' IS DISTINCT FROM source->>'payloadHash' OR facet->>'legalSender' IS DISTINCT FROM i.receiver_ediel_id OR facet->>'legalReceiver' IS DISTINCT FROM i.sender_ediel_id THEN RETURN false;END IF;
 RETURN own->>'projectionHeld' IS DISTINCT FROM 'true' AND own->>'reason'='E34' AND nullif(own->>'li','') IS NOT NULL AND (own->>'effectiveAt')::timestamptz=(facet->>'effectiveAt')::timestamptz AND (own#>>'{customerParty,1}' IN('SE1','SE2')) IS TRUE AND own#>>'{customerParty,2}'='260';
END$$;
CREATE FUNCTION gridex_ai_processing.customer_row_epoch_composed_v1(body jsonb,cutoff timestamptz,i public.ediel_message_intents,baseline_ud jsonb,object_id text,agency text,period_id text,period_start text,requested_day text,search_end text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE history jsonb;source jsonb;p jsonb;facet jsonb;event jsonb;events jsonb:='[]';customer_id text:=baseline_ud#>>'{elements,2,0}';customer_name text:=gridex_ai_processing.party_text_v1(baseline_ud,4,2);start_day text:=period_start;next_day text;day text;at timestamptz;name jsonb;customer_source text;n int;BEGIN
 IF jsonb_typeof(body->'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'sources')>1000 THEN RAISE EXCEPTION 'ai_list_customer_source_window_incomplete';END IF;
 history:=gridex_customer_life_events.qualified_patches_v1(i.company_id,i.customer_id,gridex_received_sources.permission_time_v1(period_start||'0000'),gridex_received_sources.permission_time_v1(search_end||'0000'),cutoff);
 IF history->>'status' IS DISTINCT FROM 'authorized' OR history->>'authorizesInitialCustomer' IS DISTINCT FROM 'false' OR jsonb_array_length(history->'patches')>1000 THEN RAISE EXCEPTION 'ai_list_original_customer_patch_owner_required';END IF;
 FOR source IN SELECT value FROM jsonb_array_elements(body->'sources') ORDER BY value->>'sourceMessageId' LOOP
  facet:=gridex_requested_changes.customer_facet_basis_v1(body,cutoff,i.company_id,i.environment,i.customer_id,i.customer_site_id,source->>'sourceMessageId',object_id,agency);
  IF facet IS NOT NULL AND facet->>'supplyPeriodId'=period_id AND facet->>'legalSender'=i.receiver_ediel_id AND facet->>'legalReceiver'=i.sender_ediel_id AND facet->>'marketMinute'>=period_start||'0000' AND facet->>'marketMinute'<search_end||'0000' THEN
   IF facet->>'payloadHash' IS DISTINCT FROM source->>'payloadHash' OR gridex_ai_processing.customer_source_object_composed_v1(body,cutoff,i,history,source,object_id,agency) IS NOT TRUE THEN RAISE EXCEPTION 'ai_list_customer_facet_physical_scope_invalid';END IF;
   IF facet#>>'{party,id}' IS DISTINCT FROM baseline_ud#>>'{elements,2,0}' AND NOT coalesce(facet->>'authorityKind'='bilateral' AND facet->>'identityChangeAuthorized'='true',false) THEN RAISE EXCEPTION 'ai_list_customer_identity_transition_unqualified';END IF;
   events:=events||jsonb_build_array(jsonb_build_object('kind','facet','basis',facet,'effectiveAt',facet->>'effectiveAt','sourceMessageId',facet->>'sourceMessageId'));
  END IF;
 END LOOP;
 FOR p IN SELECT value FROM jsonb_array_elements(history->'patches') LOOP
  IF NOT ((p->'customerFields') ?| ARRAY['org_number','personal_number']) AND NOT ((p->'endUserMasterdata') ? 'name') THEN CONTINUE;END IF;
  SELECT count(*),jsonb_agg(x)->0 INTO n,source FROM jsonb_array_elements(body->'sources') x WHERE x->>'sourceMessageId'=p->>'sourceMessageId' AND x->>'payloadHash'=p->>'sourcePayloadHash';
  IF n<>1 OR gridex_ai_processing.customer_only_patch_object_v1(i,history,source,object_id,agency) IS NOT TRUE THEN CONTINUE;END IF;
  at:=(p->>'effectiveAt')::timestamptz;day:=to_char(at AT TIME ZONE 'Etc/GMT-1','YYYYMMDD');
  IF at IS DISTINCT FROM gridex_received_sources.permission_time_v1(day||'0000') THEN RAISE EXCEPTION 'ai_list_date_only_customer_boundary_unrepresentable';END IF;
  IF gridex_ai_processing.customer_source_object_composed_v1(body,cutoff,i,history,source,object_id,agency) IS NOT TRUE THEN RAISE EXCEPTION 'ai_list_customer_patch_physical_time_invalid';END IF;
  -- A full facet for the SAME source supersedes its delta, not another source.
  IF EXISTS(SELECT FROM jsonb_array_elements(events) x WHERE x->>'sourceMessageId'=p->>'sourceMessageId' AND (x->>'effectiveAt')::timestamptz=(p->>'effectiveAt')::timestamptz) THEN CONTINUE;END IF;
  events:=events||jsonb_build_array(jsonb_build_object('kind','patch','basis',p,'effectiveAt',p->>'effectiveAt','sourceMessageId',p->>'sourceMessageId'));
 END LOOP;
 IF jsonb_array_length(events)>1000 OR EXISTS(SELECT FROM jsonb_array_elements(events) x GROUP BY (x->>'effectiveAt')::timestamptz HAVING count(*)>1) THEN RAISE EXCEPTION 'ai_list_customer_epoch_ambiguous';END IF;
 FOR event IN SELECT value FROM jsonb_array_elements(events) ORDER BY (value->>'effectiveAt')::timestamptz LOOP
  at:=(event->>'effectiveAt')::timestamptz;day:=to_char(at AT TIME ZONE 'Etc/GMT-1','YYYYMMDD');
  IF at IS DISTINCT FROM gridex_received_sources.permission_time_v1(day||'0000') THEN RAISE EXCEPTION 'ai_list_date_only_customer_boundary_unrepresentable';END IF;
  IF day>requested_day THEN next_day:=day;EXIT;END IF;start_day:=day;
  p:=event->'basis';
  IF event->>'kind'='facet' THEN customer_id:=p#>>'{party,id}';customer_name:=p#>>'{party,name}';customer_source:=p->>'sourceMessageId';
  ELSE
   IF (p->'customerFields') ? 'org_number' AND (p->'customerFields') ? 'personal_number' THEN RAISE EXCEPTION 'ai_list_customer_identity_patch_ambiguous';END IF;
   IF (p->'customerFields') ? 'org_number' THEN customer_id:=p#>>'{customerFields,org_number}';ELSIF (p->'customerFields') ? 'personal_number' THEN customer_id:=p#>>'{customerFields,personal_number}';END IF;
   IF (p->'endUserMasterdata') ? 'name' THEN
    name:=p#>'{endUserMasterdata,name}';IF jsonb_typeof(name) IS DISTINCT FROM 'array' OR jsonb_array_length(name) NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'ai_list_customer_name_patch_invalid';END IF;
    customer_name:=gridex_ai_processing.party_text_v1(jsonb_build_object('elements',jsonb_build_array(jsonb_build_array('NAD'),jsonb_build_array('UD'),'null'::jsonb,'null'::jsonb,name)),4,2);
   END IF;
  END IF;
  IF nullif(customer_id,'') IS NULL OR customer_id<>btrim(customer_id) OR length(customer_id)>35 OR customer_id~'[[:cntrl:];]' OR nullif(customer_name,'') IS NULL OR customer_name<>btrim(customer_name) OR customer_name~'[[:cntrl:];]' THEN RAISE EXCEPTION 'ai_list_customer_identity_patch_invalid';END IF;
 END LOOP;
 RETURN jsonb_build_object('customerId',customer_id,'customerName',customer_name,'startDay',start_day,'nextDay',next_day,'customerSourceMessageId',customer_source);
END$$;
-- Freeze only deltas qualified for an actual own row in this complete source
-- universe. The prior range/cutoff/primary-effect reader remains authoritative.
ALTER FUNCTION gridex_ai_processing.customer_history_for_rows_v1(jsonb,timestamptz,public.ediel_message_intents,text,text) RENAME TO customer_history_before_composed_scope_v1;
CREATE FUNCTION gridex_ai_processing.customer_history_for_rows_v1(body jsonb,cutoff timestamptz,i public.ediel_message_intents,raw text,claims text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE history jsonb;p jsonb;source jsonb;refs jsonb:=claims::jsonb;records text[];cols text[];ref jsonb;base jsonb;filtered jsonb:='[]';normalized text;row int;n int;matched boolean;BEGIN
 history:=gridex_ai_processing.customer_history_before_composed_scope_v1(body,cutoff,i,raw,claims);
 normalized:=replace(raw,E'\r\n',E'\n');IF left(normalized,1)=chr(65279) THEN normalized:=substring(normalized FROM 2);END IF;IF right(normalized,1)=E'\n' THEN normalized:=left(normalized,length(normalized)-1);END IF;records:=string_to_array(normalized,E'\n');
 FOR p IN SELECT value FROM jsonb_array_elements(history->'patches') LOOP
  SELECT count(*),jsonb_agg(x)->0 INTO n,source FROM jsonb_array_elements(body->'sources') x WHERE x->>'sourceMessageId'=p->>'sourceMessageId' AND x->>'payloadHash'=p->>'sourcePayloadHash';
  IF n<>1 THEN CONTINUE;END IF;matched:=false;
  FOR row IN 2..cardinality(records) LOOP
   cols:=string_to_array(records[row],';');
   IF gridex_ai_processing.customer_only_patch_object_v1(i,history,source,cols[2],cols[3]) IS NOT TRUE OR gridex_ai_processing.customer_source_object_composed_v1(body,cutoff,i,history,source,cols[2],cols[3]) IS NOT TRUE THEN CONTINUE;END IF;
   FOR ref IN SELECT value FROM jsonb_array_elements(refs) LOOP
    base:=gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'baselineSourceMessageId',i,cols[2],cols[3]);
    IF base#>>'{business,wire,businessCase}'='supply_baseline' AND base#>>'{business,supplyPeriodId}'=ref->>'supplyPeriodId' AND (p->>'effectiveAt')::timestamptz>=gridex_received_sources.permission_time_v1(base#>>'{business,wire,effectiveFrom,marketMinute}') AND EXISTS(SELECT FROM public.customer_supply_periods period WHERE period.id::text=ref->>'supplyPeriodId' AND period.company_id=i.company_id AND period.customer_id=i.customer_id AND (p->>'effectiveAt')::timestamptz<gridex_received_sources.permission_time_v1(least(split_part(records[1],';',9),coalesce(to_char(coalesce(period.actual_end_date,period.end_date),'YYYYMMDD'),split_part(records[1],';',9)))||'0000')) THEN matched:=true;EXIT;END IF;
   END LOOP;
   IF matched THEN EXIT;END IF;
  END LOOP;
  IF matched THEN filtered:=filtered||jsonb_build_array(p);END IF;
 END LOOP;
 RETURN jsonb_set(history,'{patches}',filtered);
END$$;
REVOKE ALL ON FUNCTION gridex_ai_processing.customer_history_before_composed_scope_v1(jsonb,timestamptz,public.ediel_message_intents,text,text),gridex_ai_processing.customer_history_for_rows_v1(jsonb,timestamptz,public.ediel_message_intents,text,text) FROM PUBLIC,anon,authenticated,service_role;
-- Narrow same-OID changes only at the exact customer ports. Keep every existing
-- source-universe, replacement, supply-cover and full 22-cell comparison.
DO $composition$
DECLARE definition text;old_call text;new_call text;BEGIN
 definition:=pg_get_functiondef('gridex_ai_processing.row_epoch_matches_v1(jsonb,timestamptz,public.ediel_message_intents,text,text,text,text,text,text,text,text)'::regprocedure);
 old_call:='gridex_ai_processing.customer_only_patch_object_v1(i,customer_history,source,object_id,agency)';new_call:='gridex_ai_processing.customer_source_object_composed_v1(body,cutoff,i,customer_history,source,object_id,agency)';
 IF (length(definition)-length(replace(definition,old_call,'')))/length(old_call)<>2 THEN RAISE EXCEPTION 'ai_customer_row_epoch_owner_drift';END IF;
 definition:=replace(definition,old_call,new_call);
 old_call:='AND EXISTS(SELECT FROM jsonb_array_elements(customer_history->''patches'') p WHERE p->>''sourceMessageId''=id AND p->>''sourcePayloadHash''=basis#>>''{business,sourcePayloadHash}'' AND (p->>''effectiveAt'')::timestamptz=gridex_received_sources.permission_time_v1(basis#>>''{business,wire,effectiveFrom,marketMinute}''))';
 IF position(old_call IN definition)=0 THEN RAISE EXCEPTION 'ai_customer_row_epoch_patch_owner_drift';END IF;
 -- The composed exact-object port proves either independent owner itself.
 definition:=replace(definition,old_call,'');EXECUTE definition;
 definition:=pg_get_functiondef('gridex_ai_processing.require_original_row_sources_before_applied_structure_v1(jsonb,timestamptz,public.ediel_message_intents,text,text)'::regprocedure);
 old_call:='gridex_ai_processing.customer_row_epoch_v1(i,cutoff,baseline_ud,period_from,coalesce(nullif(cols[20],''''),h[8]),least(h[9],coalesce(period_to,h[9])))';
 new_call:='gridex_ai_processing.customer_row_epoch_composed_v1(body,cutoff,i,baseline_ud,cols[2],cols[3],period.id::text,period_from,coalesce(nullif(cols[20],''''),h[8]),least(h[9],coalesce(period_to,h[9])))';
 IF (length(definition)-length(replace(definition,old_call,'')))/length(old_call)<>1 THEN RAISE EXCEPTION 'ai_customer_whole_row_owner_drift';END IF;
 EXECUTE replace(definition,old_call,new_call);
END$composition$;
-- Preserve the actual applied-structure owner as a private delegate. The new
-- optional fifth reference is admitted only by the joint exact native epoch.
ALTER FUNCTION gridex_ai_processing.require_original_row_sources_v1(jsonb,timestamptz,public.ediel_message_intents,text,text) RENAME TO require_original_rows_before_composed_customer_v1;
CREATE FUNCTION gridex_ai_processing.require_original_row_sources_v1(body jsonb,cutoff timestamptz,i public.ediel_message_intents,raw text,claims text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE refs jsonb;ref jsonb;clean jsonb:='[]';records text[];h text[];cols text[];normalized text;row int;period public.customer_supply_periods%rowtype;baseline jsonb;ud jsonb;epoch jsonb;BEGIN
 IF claims IS NULL OR octet_length(claims)>262144 THEN RAISE EXCEPTION 'ai_list_original_row_sources_required';END IF;refs:=claims::jsonb;
 normalized:=replace(raw,E'\r\n',E'\n');IF left(normalized,1)=chr(65279) THEN normalized:=substring(normalized FROM 2);END IF;IF right(normalized,1)=E'\n' THEN normalized:=left(normalized,length(normalized)-1);END IF;
 records:=string_to_array(normalized,E'\n');h:=string_to_array(records[1],';');
 IF jsonb_typeof(refs) IS DISTINCT FROM 'array' OR jsonb_array_length(refs)<>cardinality(records)-1 OR jsonb_array_length(refs)>1000 THEN RAISE EXCEPTION 'ai_list_original_row_sources_required';END IF;
 FOR row IN 2..cardinality(records) LOOP
  ref:=refs->(row-2);cols:=string_to_array(records[row],';');
  IF jsonb_typeof(ref) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(ref-'customerSourceMessageId'))<>4 OR NOT((ref-'customerSourceMessageId') ?& ARRAY['sourceMessageId','baselineSourceMessageId','addressSourceMessageId','supplyPeriodId']) OR cardinality(cols)<>22 OR ref ? 'customerSourceMessageId' AND nullif(ref->>'customerSourceMessageId','') IS NULL THEN RAISE EXCEPTION 'ai_list_customer_row_scope_invalid';END IF;
  SELECT * INTO period FROM public.customer_supply_periods p WHERE p.id=(ref->>'supplyPeriodId')::uuid AND p.company_id=i.company_id AND p.customer_id=i.customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ai_list_original_row_supply_scope_invalid';END IF;
  baseline:=gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'baselineSourceMessageId',i,cols[2],cols[3]);
  IF baseline IS NULL OR baseline#>>'{business,wire,businessCase}' IS DISTINCT FROM 'supply_baseline' OR baseline#>>'{business,supplyPeriodId}' IS DISTINCT FROM period.id::text THEN RAISE EXCEPTION 'ai_list_original_row_source_mismatch';END IF;
  SELECT t INTO ud FROM jsonb_array_elements(baseline->'ownTokens') t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='UD' ORDER BY (t->>'index')::integer LIMIT 1;
  epoch:=gridex_ai_processing.customer_row_epoch_composed_v1(body,cutoff,i,ud,cols[2],cols[3],period.id::text,to_char(coalesce(period.actual_start_date,period.start_date),'YYYYMMDD'),coalesce(nullif(cols[20],''),h[8]),least(h[9],coalesce(to_char(coalesce(period.actual_end_date,period.end_date),'YYYYMMDD'),h[9])));
  IF ref->>'customerSourceMessageId' IS DISTINCT FROM epoch->>'customerSourceMessageId' THEN RAISE EXCEPTION 'ai_list_customer_epoch_source_mismatch';END IF;
  clean:=clean||jsonb_build_array(ref-'customerSourceMessageId');
 END LOOP;
 PERFORM gridex_ai_processing.require_original_rows_before_composed_customer_v1(body,cutoff,i,raw,clean::text);
 RETURN refs;
END$$;
REVOKE ALL ON FUNCTION gridex_ai_processing.customer_source_object_composed_v1(jsonb,timestamptz,public.ediel_message_intents,jsonb,jsonb,text,text),gridex_ai_processing.customer_row_epoch_composed_v1(jsonb,timestamptz,public.ediel_message_intents,jsonb,text,text,text,text,text,text),gridex_ai_processing.require_original_rows_before_composed_customer_v1(jsonb,timestamptz,public.ediel_message_intents,text,text),gridex_ai_processing.require_original_row_sources_v1(jsonb,timestamptz,public.ediel_message_intents,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
