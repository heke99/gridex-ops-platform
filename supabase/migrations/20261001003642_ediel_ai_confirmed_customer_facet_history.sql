-- A read capability from the SAME committed source snapshot, never caller rows.
BEGIN;
CREATE FUNCTION gridex_requested_changes.customer_facet_basis_v1(body jsonb,cutoff timestamptz,c uuid,env text,customer uuid,site uuid,source_id text,p_object_id text,agency text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v gridex_requested_changes.confirmed_customer_versions%rowtype;w gridex_requested_changes.customer_version_availability%rowtype;e gridex_requested_changes.events%rowtype;
 snap gridex_received_sources.object_selection_snapshots%rowtype;m public.ediel_messages%rowtype;canonical gridex_received_sources.validation_assessments%rowtype;src jsonb;b jsonb;n integer;
BEGIN
 SELECT count(*) INTO n FROM gridex_received_sources.object_selection_snapshots s WHERE s.company_id=c AND s.environment=env AND s.cutoff_at=cutoff AND s.readset_text::jsonb=body AND s.readset_hash=encode(sha256(convert_to(s.readset_text,'UTF8')),'hex');
 IF n<>1 THEN RETURN NULL;END IF;
 SELECT * INTO snap FROM gridex_received_sources.object_selection_snapshots s WHERE s.company_id=c AND s.environment=env AND s.cutoff_at=cutoff AND s.readset_text::jsonb=body FOR SHARE;
 SELECT * INTO v FROM gridex_requested_changes.confirmed_customer_versions x WHERE x.source_message_id::text=source_id AND x.company_id=c AND x.environment=env AND x.customer_id=customer AND x.site_id=site AND x.object_id=p_object_id AND x.identity_agency=agency AND x.canonical_assessment_id IS NOT NULL FOR SHARE;
 IF NOT FOUND OR NOT pg_visible_in_snapshot(v.created_xid,snap.visibility_snapshot::pg_snapshot) THEN RETURN NULL;END IF;
 SELECT * INTO w FROM gridex_requested_changes.customer_version_availability x WHERE x.source_message_id=v.source_message_id AND x.company_id=c AND x.environment=env AND x.payload_hash=v.payload_hash AND x.observed_at<=cutoff FOR SHARE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT count(*),jsonb_agg(x)->0 INTO n,src FROM jsonb_array_elements(body->'sources') x WHERE x->>'sourceMessageId'=source_id AND x->>'payloadHash'=v.payload_hash;
 IF n<>1 OR src->>'rawPayload' IS NULL OR encode(sha256(convert_to(src->>'rawPayload','UTF8')),'hex') IS DISTINCT FROM v.payload_hash THEN RETURN NULL;END IF;
 SELECT * INTO m FROM public.ediel_messages x WHERE x.id=v.source_message_id AND x.company_id=c AND x.environment=env FOR SHARE;
 IF m.raw_payload IS DISTINCT FROM src->>'rawPayload' OR m.message_received_at IS DISTINCT FROM v.received_at THEN RETURN NULL;END IF;
 SELECT * INTO canonical FROM gridex_received_sources.validation_assessments a WHERE a.id=v.canonical_assessment_id AND a.source_message_id=v.source_message_id AND a.company_id=c AND a.environment=env AND a.source_payload_hash=v.payload_hash AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id) FOR SHARE;
 IF NOT FOUND OR canonical.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR canonical.facts_text::jsonb->>'applicationDecision' IS DISTINCT FROM 'accepted' OR canonical.facts_text::jsonb->>'functionalDecision' IS DISTINCT FROM 'accepted' THEN RETURN NULL;END IF;
 SELECT * INTO e FROM gridex_requested_changes.events x WHERE x.id=v.event_id AND x.company_id=c AND x.environment=env FOR SHARE;
 b:=gridex_requested_changes.context_v1(c,e.id,e.approved_by,'communication.write');
 IF b->>'status' IS DISTINCT FROM 'authorized' OR e.customer_id IS DISTINCT FROM v.customer_id OR e.metering_point_id IS DISTINCT FROM v.metering_point_id OR e.supply_period_id IS DISTINCT FROM v.supply_period_id OR e.point_id IS DISTINCT FROM p_object_id OR e.identity_agency IS DISTINCT FROM agency OR e.effective_at IS DISTINCT FROM v.effective_at OR e.legal_receiver_id IS DISTINCT FROM v.legal_sender OR e.legal_sender_id IS DISTINCT FROM v.legal_receiver OR v.party->>'id' IS DISTINCT FROM e.customer_identity->>'id' THEN RETURN NULL;END IF;
 PERFORM s.id FROM public.customer_sites s WHERE s.id=site AND s.company_id=c AND s.customer_id=customer FOR SHARE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM gridex_ediel_inbound_context.require_v1(c,v.source_message_id);PERFORM gridex_ediel_source_rules.require_v1(c,v.source_message_id);
 RETURN jsonb_build_object('sourceMessageId',v.source_message_id,'payloadHash',v.payload_hash,'companyId',c,'environment',env,'customerId',customer,'siteId',site,'meteringPointId',v.metering_point_id,'supplyPeriodId',v.supply_period_id,'objectId',v.object_id,'identityAgency',v.identity_agency,'legalSender',v.legal_sender,'legalReceiver',v.legal_receiver,'effectiveAt',v.effective_at,'marketMinute',to_char(v.effective_at AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI'),'availableAt',w.observed_at,'party',v.party);
END$$;
REVOKE ALL ON FUNCTION gridex_requested_changes.customer_facet_basis_v1(jsonb,timestamptz,uuid,text,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_confirmed_customer_snapshot_v1(p_company_id uuid,p_actor_user_id uuid,p_snapshot_id uuid,p_readset_hash text,p_customer_id uuid,p_site_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE snap gridex_received_sources.object_selection_snapshots%rowtype;v gridex_requested_changes.confirmed_customer_versions%rowtype;b jsonb;rows jsonb:='[]';n integer:=0;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_source_service_required' USING ERRCODE='42501';END IF;
 IF gridex_requested_changes.actor_v1(p_company_id,p_actor_user_id,'read','death') IS NOT TRUE THEN RAISE EXCEPTION 'customer_history_reader_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO snap FROM gridex_received_sources.object_selection_snapshots s WHERE s.id=p_snapshot_id AND s.company_id=p_company_id AND s.readset_hash=p_readset_hash FOR SHARE;
 IF NOT FOUND OR snap.readset_hash IS DISTINCT FROM encode(sha256(convert_to(snap.readset_text,'UTF8')),'hex') OR snap.readset_text::jsonb->>'complete' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'customer_history_actual_snapshot_required';END IF;
 PERFORM s.id FROM public.customer_sites s WHERE s.id=p_site_id AND s.company_id=p_company_id AND s.customer_id=p_customer_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'customer_history_owned_site_required';END IF;
 FOR v IN SELECT * FROM gridex_requested_changes.confirmed_customer_versions x WHERE x.company_id=p_company_id AND x.environment=snap.environment AND x.customer_id=p_customer_id AND x.site_id=p_site_id AND x.canonical_assessment_id IS NOT NULL ORDER BY x.effective_at,x.source_message_id FOR SHARE LOOP
  n:=n+1;IF n>1000 THEN RAISE EXCEPTION 'customer_history_bounded_read_incomplete';END IF;
  b:=gridex_requested_changes.customer_facet_basis_v1(snap.readset_text::jsonb,snap.cutoff_at,p_company_id,snap.environment,p_customer_id,p_site_id,v.source_message_id::text,v.object_id,v.identity_agency);
  IF b IS NOT NULL THEN rows:=rows||jsonb_build_array(b);END IF;
 END LOOP;
 RETURN jsonb_build_object('owner','confirmed-customer-facet-snapshot-v1','companyId',p_company_id,'environment',snap.environment,'customerId',p_customer_id,'siteId',p_site_id,'snapshotId',snap.id,'readsetHash',snap.readset_hash,'cutoffAt',snap.cutoff_at,'versions',rows);
END$$;
REVOKE ALL ON FUNCTION public.ediel_confirmed_customer_snapshot_v1(uuid,uuid,uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_confirmed_customer_snapshot_v1(uuid,uuid,uuid,text,uuid,uuid) TO service_role;
-- Structural epochs retain their existing owner. Only a separately qualified
-- customer facet may be removed from the structural candidate universe.
ALTER FUNCTION gridex_ai_processing.row_epoch_matches_v1(jsonb,timestamptz,public.ediel_message_intents,text,text,text,text,text,text,text,text) RENAME TO row_epoch_before_customer_v1;
CREATE FUNCTION gridex_ai_processing.row_epoch_matches_v1(body jsonb,cutoff timestamptz,i public.ediel_message_intents,object_id text,agency text,period_id text,state_id text,address_id text,period_start text,search_start text,search_end text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s jsonb;b jsonb;structural jsonb:='[]';
BEGIN
 FOR s IN SELECT value FROM jsonb_array_elements(body->'sources') LOOP
  b:=gridex_requested_changes.customer_facet_basis_v1(body,cutoff,i.company_id,i.environment,i.customer_id,i.customer_site_id,s->>'sourceMessageId',object_id,agency);
  IF b IS NULL OR b->>'supplyPeriodId' IS DISTINCT FROM period_id OR b->>'legalSender' IS DISTINCT FROM i.receiver_ediel_id OR b->>'legalReceiver' IS DISTINCT FROM i.sender_ediel_id THEN structural:=structural||jsonb_build_array(s);END IF;
 END LOOP;
 RETURN gridex_ai_processing.row_epoch_before_customer_v1(jsonb_set(body,'{sources}',structural),cutoff,i,object_id,agency,period_id,state_id,address_id,period_start,search_start,search_end);
END$$;
REVOKE ALL ON FUNCTION gridex_ai_processing.row_epoch_before_customer_v1(jsonb,timestamptz,public.ediel_message_intents,text,text,text,text,text,text,text,text),gridex_ai_processing.row_epoch_matches_v1(jsonb,timestamptz,public.ediel_message_intents,text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
-- Verify customer cells and every customer split first. Adjacent verified
-- customer epochs are recombined solely for the unchanged structural fence;
-- its original coverage, row cells, replacement and omitted-source checks run.
ALTER FUNCTION gridex_ai_processing.require_original_row_sources_v1(jsonb,timestamptz,public.ediel_message_intents,text,text) RENAME TO require_original_rows_before_customer_v1;
CREATE FUNCTION gridex_ai_processing.require_original_row_sources_v1(body jsonb,cutoff timestamptz,i public.ediel_message_intents,raw text,claims text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE refs jsonb;ref jsonb;clean_ref jsonb;last_ref jsonb;merged_refs jsonb:='[]';records text[];h text[];cols text[];last_cols text[];normalized text;merged text;
 state jsonb;base jsonb;ud jsonb;s jsonb;facet jsonb;latest jsonb;next_customer text;start_day text;end_day text;expected_start text;expected_end text;period_from text;period_to text;state_minute text;
 epoch jsonb;period public.customer_supply_periods%rowtype;row integer;customer_count integer;all_facets jsonb;n integer;
BEGIN
 IF claims IS NULL OR octet_length(claims)>262144 THEN RAISE EXCEPTION 'ai_list_original_row_sources_required';END IF;refs:=claims::jsonb;
 normalized:=replace(raw,E'\r\n',E'\n');IF left(normalized,1)=chr(65279) THEN normalized:=substring(normalized FROM 2);END IF;IF right(normalized,1)=E'\n' THEN normalized:=left(normalized,length(normalized)-1);END IF;
 records:=string_to_array(normalized,E'\n');h:=string_to_array(records[1],';');merged:=records[1];
 customer_count:=0;
 FOR row IN 2..cardinality(records) LOOP
  cols:=string_to_array(records[row],';');
  FOR s IN SELECT value FROM jsonb_array_elements(body->'sources') LOOP
   facet:=gridex_requested_changes.customer_facet_basis_v1(body,cutoff,i.company_id,i.environment,i.customer_id,i.customer_site_id,s->>'sourceMessageId',cols[2],cols[3]);
   IF facet IS NOT NULL AND facet->>'marketMinute'<h[9]||'0000' THEN customer_count:=1;EXIT;END IF;
  END LOOP;
  IF customer_count=1 THEN EXIT;END IF;
 END LOOP;
 IF customer_count=0 AND NOT EXISTS(SELECT FROM jsonb_array_elements(refs) x WHERE x ? 'customerSourceMessageId') THEN RETURN gridex_ai_processing.require_original_rows_before_customer_v1(body,cutoff,i,raw,claims);END IF;
 IF jsonb_typeof(refs)<>'array' OR jsonb_array_length(refs)<>cardinality(records)-1 OR jsonb_array_length(refs)>1000 THEN RAISE EXCEPTION 'ai_list_original_row_sources_required';END IF;
 FOR row IN 2..cardinality(records) LOOP
  ref:=refs->(row-2);cols:=string_to_array(records[row],';');clean_ref:=ref-'customerSourceMessageId';
  IF jsonb_typeof(ref)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(clean_ref))<>4 OR NOT(clean_ref ?& ARRAY['sourceMessageId','baselineSourceMessageId','addressSourceMessageId','supplyPeriodId']) OR cardinality(cols)<>22 OR ref ? 'customerSourceMessageId' AND nullif(ref->>'customerSourceMessageId','') IS NULL THEN RAISE EXCEPTION 'ai_list_customer_row_scope_invalid';END IF;
  SELECT * INTO period FROM public.customer_supply_periods p WHERE p.id=(ref->>'supplyPeriodId')::uuid AND p.company_id=i.company_id AND p.customer_id=i.customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ai_list_original_row_supply_scope_invalid';END IF;
  state:=gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'sourceMessageId',i,cols[2],cols[3]);base:=gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'baselineSourceMessageId',i,cols[2],cols[3]);
  IF state IS NULL OR base IS NULL THEN RAISE EXCEPTION 'ai_list_original_row_source_mismatch';END IF;
  SELECT t INTO ud FROM jsonb_array_elements(base->'ownTokens') t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='UD' ORDER BY (t->>'index')::integer LIMIT 1;
  period_from:=to_char(coalesce(period.actual_start_date,period.start_date),'YYYYMMDD');period_to:=to_char(coalesce(period.actual_end_date,period.end_date),'YYYYMMDD');
  epoch:=gridex_ai_processing.row_epoch_matches_v1(body,cutoff,i,cols[2],cols[3],period.id::text,ref->>'sourceMessageId',ref->>'addressSourceMessageId',period_from,h[8],least(h[9],coalesce(period_to,h[9])));
  state_minute:=epoch->>'stateMinute';start_day:=coalesce(nullif(cols[20],''),h[8]);end_day:=coalesce(nullif(cols[21],''),h[9]);
  IF start_day>=end_day THEN RAISE EXCEPTION 'ai_list_customer_row_interval_invalid';END IF;
  all_facets:='[]';
  FOR s IN SELECT value FROM jsonb_array_elements(body->'sources') LOOP
   facet:=gridex_requested_changes.customer_facet_basis_v1(body,cutoff,i.company_id,i.environment,i.customer_id,i.customer_site_id,s->>'sourceMessageId',cols[2],cols[3]);
   IF facet IS NOT NULL AND facet->>'supplyPeriodId'=period.id::text AND facet->>'legalSender'=i.receiver_ediel_id AND facet->>'legalReceiver'=i.sender_ediel_id AND facet->>'marketMinute'>=period_from||'0000' AND facet->>'marketMinute'<least(h[9],coalesce(period_to,h[9]))||'0000' THEN
    IF right(facet->>'marketMinute',4)<>'0000' THEN RAISE EXCEPTION 'ai_list_date_only_customer_boundary_unrepresentable';END IF;
    all_facets:=all_facets||jsonb_build_array(facet);
   END IF;
  END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements(all_facets) x GROUP BY x->>'marketMinute' HAVING count(*)>1) THEN RAISE EXCEPTION 'ai_list_customer_epoch_ambiguous';END IF;
  SELECT x INTO latest FROM jsonb_array_elements(all_facets) x WHERE x->>'marketMinute'<=start_day||'0000' ORDER BY x->>'marketMinute' DESC LIMIT 1;
  IF ref->>'customerSourceMessageId' IS DISTINCT FROM latest->>'sourceMessageId' THEN RAISE EXCEPTION 'ai_list_customer_epoch_source_mismatch';END IF;
  IF latest IS NULL THEN
   IF cols[18] IS DISTINCT FROM ud#>>'{elements,2,0}' OR cols[19] IS DISTINCT FROM gridex_ai_processing.party_text_v1(ud,4,2) THEN RAISE EXCEPTION 'ai_list_customer_baseline_cell_mismatch';END IF;
  ELSE
   IF latest#>>'{party,id}' IS DISTINCT FROM ud#>>'{elements,2,0}' OR cols[18] IS DISTINCT FROM latest#>>'{party,id}' OR cols[19] IS DISTINCT FROM latest#>>'{party,name}' THEN RAISE EXCEPTION 'ai_list_customer_version_cell_mismatch';END IF;
  END IF;
  expected_start:=greatest(h[8],period_from,left(state_minute,8),coalesce(left(latest->>'marketMinute',8),period_from));
  SELECT min(x->>'marketMinute') INTO next_customer FROM jsonb_array_elements(all_facets) x WHERE x->>'marketMinute'>start_day||'0000';
  expected_end:=least(h[9],coalesce(period_to,h[9]),coalesce(left(epoch->>'nextMinute',8),h[9]),coalesce(left(next_customer,8),h[9]));
  IF start_day IS DISTINCT FROM expected_start OR end_day IS DISTINCT FROM expected_end THEN RAISE EXCEPTION 'ai_list_customer_epoch_omitted_or_forged';END IF;
  -- Customer fields and dates were separately checked above. All other cells
  -- must remain identical when recombining one unchanged structural epoch.
  cols[18]:=ud#>>'{elements,2,0}';cols[19]:=gridex_ai_processing.party_text_v1(ud,4,2);
  IF last_ref=clean_ref THEN
   IF last_cols[21] IS DISTINCT FROM cols[20] OR last_cols[1:19] IS DISTINCT FROM cols[1:19] OR last_cols[22] IS DISTINCT FROM cols[22] THEN RAISE EXCEPTION 'ai_list_customer_split_structural_cells_changed';END IF;
   last_cols[21]:=cols[21];
  ELSE
   IF last_ref IS NOT NULL THEN merged:=merged||E'\n'||array_to_string(last_cols,';');merged_refs:=merged_refs||jsonb_build_array(last_ref);END IF;
   last_ref:=clean_ref;last_cols:=cols;
  END IF;
 END LOOP;
 IF last_ref IS NOT NULL THEN merged:=merged||E'\n'||array_to_string(last_cols,';');merged_refs:=merged_refs||jsonb_build_array(last_ref);END IF;
 PERFORM gridex_ai_processing.require_original_rows_before_customer_v1(body,cutoff,i,merged,merged_refs::text);
 RETURN refs;
END$$;
REVOKE ALL ON FUNCTION gridex_ai_processing.require_original_rows_before_customer_v1(jsonb,timestamptz,public.ediel_message_intents,text,text),gridex_ai_processing.require_original_row_sources_v1(jsonb,timestamptz,public.ediel_message_intents,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_requested_changes.capture_ai_customer_sources_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') INTO NEW.source_ids FROM(SELECT DISTINCT id FROM(SELECT jsonb_array_elements_text(NEW.source_ids) id UNION ALL SELECT x->>'customerSourceMessageId' FROM jsonb_array_elements(NEW.row_sources) x WHERE x ? 'customerSourceMessageId') all_ids WHERE id IS NOT NULL) ids;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION gridex_requested_changes.capture_ai_customer_sources_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ai_origin_customer_sources BEFORE INSERT ON gridex_ai_processing.outbound_origins FOR EACH ROW EXECUTE FUNCTION gridex_requested_changes.capture_ai_customer_sources_v1();
-- Fresh provider entry rechecks the actual customer references in the frozen
-- original. Existing immutable accepted delivery/replay behavior is untouched.
ALTER FUNCTION gridex_ai_processing.require_ai_outbound_origin_v1(uuid,uuid) RENAME TO require_ai_origin_before_customer_v1;
CREATE FUNCTION gridex_ai_processing.require_ai_outbound_origin_v1(c uuid,message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;o gridex_ai_processing.outbound_origins%rowtype;snap gridex_received_sources.object_selection_snapshots%rowtype;i public.ediel_message_intents%rowtype;
BEGIN
 result:=gridex_ai_processing.require_ai_origin_before_customer_v1(c,message_id);
 SELECT * INTO o FROM gridex_ai_processing.outbound_origins x WHERE x.intent_id=(result->>'intentId')::uuid AND x.company_id=c FOR SHARE;
 IF EXISTS(SELECT FROM jsonb_array_elements(o.row_sources) x WHERE x ? 'customerSourceMessageId') THEN
  SELECT * INTO snap FROM gridex_received_sources.object_selection_snapshots x WHERE x.id=o.snapshot_id AND x.company_id=c AND x.environment=o.environment AND x.readset_hash=o.readset_hash FOR SHARE;
  SELECT * INTO i FROM public.ediel_message_intents x WHERE x.id=o.intent_id AND x.company_id=c FOR SHARE;
  IF snap.id IS NULL OR i.id IS NULL THEN RAISE EXCEPTION 'ai_list_customer_original_source_required';END IF;
  PERFORM gridex_ai_processing.require_original_row_sources_v1(snap.readset_text::jsonb,snap.cutoff_at,i,o.raw_payload,o.row_sources::text);
 END IF;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION gridex_ai_processing.require_ai_origin_before_customer_v1(uuid,uuid),gridex_ai_processing.require_ai_outbound_origin_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
