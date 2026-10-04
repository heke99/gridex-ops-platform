-- Prospective AI technical intent -> recomputed dated-history original. Existing
-- personal/legal/header authority remains sole decision/actor owner. No historical
-- origins, versioned decision owners, deletion histories or mandates synthesized.
BEGIN;
CREATE TABLE gridex_ai_processing.outbound_origins (
 intent_id uuid PRIMARY KEY REFERENCES public.ediel_message_intents(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,environment text NOT NULL CHECK(environment IN ('test','production')),
 actor_user_id uuid NOT NULL,processing_decision_id uuid NOT NULL REFERENCES gridex_ai_processing.decisions(id) ON DELETE RESTRICT,
 snapshot_id uuid NOT NULL REFERENCES gridex_received_sources.object_selection_snapshots(id) ON DELETE RESTRICT,readset_hash text NOT NULL,
 raw_payload text NOT NULL,payload_hash text NOT NULL CHECK(payload_hash=encode(sha256(convert_to(raw_payload,'UTF8')),'hex')),
 file_name text NOT NULL,mime_type text NOT NULL,header_basis jsonb NOT NULL,source_ids jsonb NOT NULL,row_sources jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE gridex_ai_processing.outbound_origin_bindings (
 intent_id uuid PRIMARY KEY REFERENCES gridex_ai_processing.outbound_origins(intent_id) ON DELETE RESTRICT,
 message_id uuid NOT NULL UNIQUE REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,company_id uuid NOT NULL,
 payload_hash text NOT NULL,bound_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $security$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['outbound_origins','outbound_origin_bindings'] LOOP
  EXECUTE format('ALTER TABLE gridex_ai_processing.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE gridex_ai_processing.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON gridex_ai_processing.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER ai_origin_immutable BEFORE UPDATE OR DELETE ON gridex_ai_processing.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
  EXECUTE format('CREATE TRIGGER ai_origin_no_truncate BEFORE TRUNCATE ON gridex_ai_processing.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
 END LOOP;
END $security$;
CREATE FUNCTION public.gridex_ai_export_decision_v1(p_company_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_list_origination_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_ai_processing.require_export_decision_v1(p_company_id,p_actor_user_id);
END $$;
REVOKE ALL ON FUNCTION public.gridex_ai_export_decision_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_ai_export_decision_v1(uuid,uuid) TO service_role;
CREATE FUNCTION gridex_ai_processing.intent_request_v1(c uuid,intent uuid) RETURNS public.ediel_message_intents
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.ediel_message_intents%rowtype;profile jsonb:=gridex_ai_processing.native_profile_v1();
BEGIN
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=intent AND company_id=c FOR UPDATE;
 IF NOT FOUND OR i.environment NOT IN ('test','production') OR i.message_family IS DISTINCT FROM 'AI_LIST' OR i.message_code IS DISTINCT FROM 'AI'
  OR i.direction IS DISTINCT FROM 'outbound' OR i.business_process IS DISTINCT FROM 'reconciliation' OR i.validation_status IS DISTINCT FROM 'validated'
  OR i.customer_id IS NULL OR i.customer_site_id IS NULL OR i.communication_route_id IS NULL OR i.route_profile_id IS NULL
  OR i.application_reference IS DISTINCT FROM '' OR i.interchange_reference IS DISTINCT FROM '' OR i.message_reference IS DISTINCT FROM '' OR nullif(i.transaction_reference,'') IS NOT NULL
  OR i.payload->>'owner' IS DISTINCT FROM 'ai-list-export-request-v1' OR i.payload->>'sourceSha256' IS DISTINCT FROM profile->>'sourceSha256'
  OR i.payload->>'technicalVersion' IS DISTINCT FROM profile->>'technicalVersion' OR nullif(i.payload->>'requestId','') IS NULL THEN RAISE EXCEPTION 'ai_list_validated_technical_intent_required'; END IF;
 IF gridex_ai_processing.technical_date_v1(replace(i.payload->>'fromDate','-',''))>=gridex_ai_processing.technical_date_v1(replace(i.payload->>'toDate','-','')) THEN RAISE EXCEPTION 'ai_list_search_period_invalid'; END IF;
 RETURN i;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.intent_request_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.gridex_ai_outbound_origin_status_v1(p_company_id uuid,p_actor_user_id uuid,p_intent_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_ai_processing.outbound_origins%rowtype;b gridex_ai_processing.outbound_origin_bindings%rowtype;i public.ediel_message_intents%rowtype;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_list_origination_service_required' USING ERRCODE='42501'; END IF;
 -- Current actor scope precedes any original personal source disclosure.
 PERFORM gridex_ai_processing.require_export_decision_v1(p_company_id,p_actor_user_id);
 i:=gridex_ai_processing.intent_request_v1(p_company_id,p_intent_id);
 SELECT * INTO o FROM gridex_ai_processing.outbound_origins WHERE intent_id=i.id AND company_id=p_company_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','new'); END IF;
 SELECT * INTO b FROM gridex_ai_processing.outbound_origin_bindings WHERE intent_id=i.id;
 IF FOUND THEN RETURN jsonb_build_object('status','bound','messageId',b.message_id,'payloadHash',o.payload_hash); END IF;
 PERFORM gridex_ai_processing.header_company_basis_v1(p_company_id,o.environment,i.sender_ediel_id,i.receiver_ediel_id);
 RETURN jsonb_build_object('status','original','rawPayload',o.raw_payload,'fileName',o.file_name,'mimeType',o.mime_type,'payloadHash',o.payload_hash);
END $$;
REVOKE ALL ON FUNCTION public.gridex_ai_outbound_origin_status_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_ai_outbound_origin_status_v1(uuid,uuid,uuid) TO service_role;
-- Source-reference claims never authorize CSV cells. Every emitted cell is
-- compared to actual bytes under an accepted, witnessed own-object marker in
-- the SAME immutable snapshot. This is a source equality fence; guide/time
-- selection remains the existing canonical dated structural owner/projection.
CREATE FUNCTION gridex_ai_processing.source_row_basis_v1(body jsonb,cutoff timestamptz,source_id text,i public.ediel_message_intents,object_id text,agency text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE src jsonb;a jsonb;o jsonb;b jsonb;tokens jsonb;own_tokens jsonb;start_index integer;end_index integer;n integer;
BEGIN
 SELECT count(*),jsonb_agg(s)->0 INTO n,src FROM jsonb_array_elements(body->'sources') s WHERE s->>'sourceMessageId'=source_id;
 IF n<>1 OR src->>'rawPayload' IS NULL OR src->>'payloadHash' IS DISTINCT FROM encode(sha256(convert_to(src->>'rawPayload','UTF8')),'hex') THEN RETURN NULL;END IF;
 SELECT count(*),jsonb_agg(x)->0 INTO n,a FROM jsonb_array_elements(src->'assessments') x WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(src->'assessments') child WHERE child->>'previousAssessmentId'=x->>'id');
 IF n<>1 OR a->>'availabilityWitnessId' IS NULL OR a->>'availableAt' IS NULL OR (a->>'availableAt')::timestamptz>cutoff
  OR a->>'factsHash' IS DISTINCT FROM encode(sha256(convert_to(a->>'factsText','UTF8')),'hex') THEN RETURN NULL;END IF;
 SELECT count(*),jsonb_agg(x)->0 INTO n,o FROM jsonb_array_elements((a->>'factsText')::jsonb->'objects') x
 WHERE x->>'disposition'='accepted' AND x#>>'{object,objectId}'=object_id AND x#>>'{object,identityAgency}'=agency
  AND x#>>'{business,owner}'='reviewed-received-structure-v1' AND x#>>'{business,companyId}'=i.company_id::text
  AND x#>>'{business,environment}'=i.environment AND x#>>'{business,customerId}'=i.customer_id::text AND x#>>'{business,siteId}'=i.customer_site_id::text
  AND (nullif(i.metering_point_id,'') IS NULL OR x#>>'{business,meteringPointId}'=i.metering_point_id);
 IF n<>1 THEN RETURN NULL;END IF;b:=o->'business';
 IF b->>'sourceMessageId' IS DISTINCT FROM source_id OR b->>'sourcePayloadHash' IS DISTINCT FROM src->>'payloadHash'
  OR b#>>'{wire,legalSender}' IS DISTINCT FROM i.receiver_ediel_id OR b#>>'{wire,legalReceiver}' IS DISTINCT FROM i.sender_ediel_id THEN RETURN NULL;END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(src->>'rawPayload');IF tokens IS NULL THEN RETURN NULL;END IF;
 start_index:=(o#>>'{object,registers,0,segmentIndex}')::integer;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::integer=start_index AND t->>'tag'='LIN'
  AND t#>>'{elements,3,0}'=object_id AND t#>>'{elements,3,3}'=agency) THEN RETURN NULL;END IF;
 SELECT min((t->>'index')::integer) INTO end_index FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' AND (t->>'index')::integer>start_index;
 SELECT jsonb_agg(t ORDER BY (t->>'index')::integer) INTO own_tokens FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::integer>=start_index AND (end_index IS NULL OR (t->>'index')::integer<end_index);
 RETURN jsonb_build_object('business',b,'ownTokens',own_tokens,'assessmentId',a->>'id');
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.source_row_basis_v1(jsonb,timestamptz,text,public.ediel_message_intents,text,text) FROM PUBLIC,anon,authenticated,service_role;
-- A membership/equality fence for the owner's proposed dated row. It does
-- not render rows or select guide/profile versions. The existing accepted
-- object owner supplies immutable replacement edges and physical event clocks.
CREATE FUNCTION gridex_ai_processing.row_epoch_matches_v1(body jsonb,cutoff timestamptz,i public.ediel_message_intents,object_id text,agency text,period_id text,state_id text,address_id text,period_start text,search_start text,search_end text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source jsonb;candidate jsonb;other jsonb;basis jsonb;active jsonb:='[]';all_owned jsonb:='[]';replaced text[]:=ARRAY[]::text[];id text;at text;state_at text;next_at text;address_at text;latest_address text;n integer;cursor_id text;ancestors text[];tokens jsonb;code text;first_lin integer;own_start integer;own_end integer;physical_at text;latest jsonb;own_entry jsonb;
BEGIN
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
  IF basis#>>'{business,wire,businessCase}'='customer_only' THEN RAISE EXCEPTION 'ai_list_dated_customer_change_owner_required';END IF;
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
REVOKE ALL ON FUNCTION gridex_ai_processing.row_epoch_matches_v1(jsonb,timestamptz,public.ediel_message_intents,text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ai_processing.party_text_v1(token jsonb,element integer,capacity integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE values text[];last integer;
BEGIN
 SELECT array_agg(btrim(value) ORDER BY ordinal) INTO values FROM jsonb_array_elements_text(token#>ARRAY['elements',element::text]) WITH ORDINALITY v(value,ordinal) WHERE ordinal<=capacity;
 last:=cardinality(values);WHILE last>0 AND values[last]='' LOOP last:=last-1;END LOOP;
 RETURN coalesce(array_to_string(values[1:last],E'\n'),'');
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.party_text_v1(jsonb,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ai_processing.require_original_row_sources_v1(body jsonb,cutoff timestamptz,i public.ediel_message_intents,raw text,claims text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE refs jsonb;ref jsonb;state jsonb;base jsonb;address jsonb;cols text[];records text[];h text[];normalized text;
 matched integer;expected text[];baseline_ud jsonb;address_it jsonb;brp jsonb;grid jsonb;period public.customer_supply_periods%rowtype;
 cover jsonb;epoch jsonb;intervals jsonb:='[]';span jsonb;cursor_date text;required_end text;period_count integer:=0;covered_periods uuid[]:=ARRAY[]::uuid[];start_date text;end_date text;state_date text;period_from text;period_to text;seen text[]:=ARRAY[]::text[];row integer;n integer;
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
   IF start_date>=end_date THEN CONTINUE;END IF;
   expected:=ARRAY[grid#>>'{elements,1,1}',cols[2],cols[3],'','','','',gridex_ai_processing.party_text_v1(address_it,5,3),coalesce(address_it#>>'{elements,8,0}',''),coalesce(address_it#>>'{elements,6,0}',''),brp#>>'{elements,2,0}','','','','','','',baseline_ud#>>'{elements,2,0}',gridex_ai_processing.party_text_v1(baseline_ud,4,2),CASE WHEN start_date=h[8] THEN '' ELSE start_date END,CASE WHEN end_date=h[9] THEN '' ELSE end_date END,''];
   IF cols IS DISTINCT FROM expected THEN CONTINUE;END IF;
   seen:=array_append(seen,row::text);covered_periods:=array_append(covered_periods,period.id);matched:=matched+1;
   intervals:=intervals||jsonb_build_array(jsonb_build_object('periodId',period.id,'start',start_date,'end',end_date));
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
REVOKE ALL ON FUNCTION gridex_ai_processing.require_original_row_sources_v1(jsonb,timestamptz,public.ediel_message_intents,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.gridex_ai_record_outbound_original_v1(p_company_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_snapshot_id uuid,p_readset_hash text,p_raw_payload text,p_file_name text,p_mime_type text,p_row_sources text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.ediel_message_intents%rowtype;snap gridex_received_sources.object_selection_snapshots%rowtype;
 prior gridex_ai_processing.outbound_origins%rowtype;wire jsonb;decision jsonb;basis jsonb;source_ids jsonb;header text;point uuid;row_sources jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_list_origination_service_required' USING ERRCODE='42501'; END IF;
 i:=gridex_ai_processing.intent_request_v1(p_company_id,p_intent_id);
 decision:=gridex_ai_processing.require_export_decision_v1(p_company_id,p_actor_user_id);
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
 PERFORM cs.id FROM public.customer_sites cs WHERE cs.id=i.customer_site_id AND cs.company_id=p_company_id AND cs.customer_id=i.customer_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ai_list_customer_site_scope_mismatch'; END IF;
 IF nullif(i.metering_point_id,'') IS NOT NULL THEN
  point:=i.metering_point_id::uuid;
  PERFORM mp.id FROM public.metering_points mp WHERE mp.id=point AND mp.company_id=p_company_id AND mp.customer_id=i.customer_id AND coalesce(mp.customer_site_id,mp.site_id)=i.customer_site_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ai_list_metering_point_scope_mismatch'; END IF;
 END IF;
 row_sources:=gridex_ai_processing.require_original_row_sources_v1(snap.readset_text::jsonb,snap.cutoff_at,i,p_raw_payload,p_row_sources);
 -- References below have already passed own original/hash/leaf/cell/period
 -- equality. Earlier superseded accepted markers cannot enter this provenance.
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') INTO source_ids FROM (
  SELECT DISTINCT ref->>key AS id FROM jsonb_array_elements(row_sources) ref,
   unnest(ARRAY['sourceMessageId','baselineSourceMessageId','addressSourceMessageId']) key
 ) ids;
 INSERT INTO gridex_ai_processing.outbound_origins(intent_id,company_id,environment,actor_user_id,processing_decision_id,snapshot_id,readset_hash,raw_payload,payload_hash,file_name,mime_type,header_basis,source_ids,row_sources)
 VALUES(i.id,p_company_id,i.environment,p_actor_user_id,(decision#>>'{decision,id}')::uuid,snap.id,snap.readset_hash,p_raw_payload,encode(sha256(convert_to(p_raw_payload,'UTF8')),'hex'),p_file_name,p_mime_type,basis,source_ids,row_sources);
 RETURN jsonb_build_object('status','original','payloadHash',encode(sha256(convert_to(p_raw_payload,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.gridex_ai_record_outbound_original_v1(uuid,uuid,uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_ai_record_outbound_original_v1(uuid,uuid,uuid,uuid,text,text,text,text,text) TO service_role;
CREATE FUNCTION gridex_ai_processing.bind_original_message_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_ai_processing.outbound_origins%rowtype;i public.ediel_message_intents%rowtype;
BEGIN
 IF NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_standard IS DISTINCT FROM 'ai_list' THEN RETURN NEW; END IF;
 i:=gridex_ai_processing.intent_request_v1(NEW.company_id,NEW.intent_id);
 SELECT * INTO o FROM gridex_ai_processing.outbound_origins WHERE intent_id=i.id AND company_id=NEW.company_id FOR SHARE;
 IF NOT FOUND OR o.environment IS DISTINCT FROM NEW.environment OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex')
  OR o.file_name IS DISTINCT FROM NEW.file_name OR o.mime_type IS DISTINCT FROM NEW.mime_type OR i.sender_ediel_id IS DISTINCT FROM NEW.sender_ediel_id
  OR i.receiver_ediel_id IS DISTINCT FROM NEW.receiver_ediel_id OR i.customer_id IS DISTINCT FROM NEW.customer_id OR i.customer_site_id IS DISTINCT FROM NEW.site_id
  OR i.communication_route_id IS DISTINCT FROM NEW.communication_route_id OR i.route_profile_id IS DISTINCT FROM NEW.route_profile_id THEN RAISE EXCEPTION 'ai_list_private_original_required'; END IF;
 INSERT INTO gridex_ai_processing.outbound_origin_bindings(intent_id,message_id,company_id,payload_hash) VALUES(i.id,NEW.id,NEW.company_id,o.payload_hash);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.bind_original_message_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ai_original_message_binding AFTER INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ai_processing.bind_original_message_v1();
CREATE FUNCTION gridex_ai_processing.require_ai_outbound_origin_v1(c uuid,message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;o gridex_ai_processing.outbound_origins%rowtype;b gridex_ai_processing.outbound_origin_bindings%rowtype;i public.ediel_message_intents%rowtype;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=message_id AND company_id=c FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ai_list_private_original_required'; END IF;
 SELECT * INTO b FROM gridex_ai_processing.outbound_origin_bindings binding WHERE binding.message_id=m.id AND binding.company_id=c FOR SHARE;
 IF NOT FOUND OR b.payload_hash IS DISTINCT FROM m.immutable_payload_hash THEN RAISE EXCEPTION 'ai_list_private_original_required'; END IF;
 SELECT * INTO o FROM gridex_ai_processing.outbound_origins WHERE intent_id=b.intent_id AND company_id=c FOR SHARE;
 i:=gridex_ai_processing.intent_request_v1(c,b.intent_id);
 IF o.payload_hash IS DISTINCT FROM m.immutable_payload_hash OR o.raw_payload IS DISTINCT FROM m.raw_payload OR o.environment IS DISTINCT FROM m.environment OR m.intent_id IS DISTINCT FROM i.id
  OR m.communication_route_id IS DISTINCT FROM i.communication_route_id OR m.route_profile_id IS DISTINCT FROM i.route_profile_id OR m.customer_id IS DISTINCT FROM i.customer_id OR m.site_id IS DISTINCT FROM i.customer_site_id THEN RAISE EXCEPTION 'ai_list_private_original_conflict'; END IF;
 RETURN jsonb_build_object('intentId',i.id,'snapshotId',o.snapshot_id,'readsetHash',o.readset_hash,'sourceHash',o.payload_hash,'sourceIds',o.source_ids);
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.require_ai_outbound_origin_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Compose the new origin into the SAME AI source authority used by generic
-- transport prepare/entry. There is still exactly one transport journal.
ALTER FUNCTION gridex_ai_processing.require_ai_outbound_source_v1(uuid,uuid,uuid) RENAME TO require_ai_outbound_source_before_origin_v1;
CREATE FUNCTION gridex_ai_processing.require_ai_outbound_source_v1(c uuid,message_id uuid,actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source jsonb;origin jsonb;BEGIN
 origin:=gridex_ai_processing.require_ai_outbound_origin_v1(c,message_id);
 source:=gridex_ai_processing.require_ai_outbound_source_before_origin_v1(c,message_id,actor);
 RETURN source||jsonb_build_object('origin',origin);
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.require_ai_outbound_source_v1(uuid,uuid,uuid),gridex_ai_processing.require_ai_outbound_source_before_origin_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE gridex_ai_processing.outbound_origins IS 'Prospective approved-purpose personal originals recomputed by the sole dated source-history projection and bound to real technical intents and complete source snapshots. Not an authenticity, deletion-history, retention-owner or activation claim.';
COMMIT;
