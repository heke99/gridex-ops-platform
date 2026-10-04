-- The old environment-less origination APIs require ordinary write permission.
-- TEST permission is only considered after a genuine validated AI intent supplies
-- its immutable source environment. No caller flag, role or mailbox can do so.
BEGIN;
CREATE FUNCTION gridex_ai_processing.authorize_purpose_phase_v1(c uuid,actor uuid,phase text,qualified_environment text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF phase IS NULL OR phase NOT IN ('origination','send') OR c IS NULL OR actor IS NULL OR (qualified_environment IS NOT NULL AND qualified_environment NOT IN ('test','production')) THEN RAISE EXCEPTION 'ai_bi_processing_scope_required'; END IF;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor FOR SHARE;
 PERFORM p.id FROM public.user_profiles p WHERE p.id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.user_profiles p WHERE p.id=actor AND p.user_status='active')
 OR NOT(CASE WHEN phase='send' THEN coalesce(public.gridex_actor_has_company_permission(actor,c,'ediel.send'),false) OR coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.send'),false)
 ELSE coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.write'),false) OR (coalesce(qualified_environment='test',false) AND coalesce(public.gridex_actor_has_company_permission(actor,c,'ediel_testing.write'),false)) END) THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.authorize_purpose_phase_v1(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ai_processing.purpose_decision_after_actor_v1(c uuid,list_type text,purpose text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE candidates integer;d gridex_ai_processing.decisions%rowtype;BEGIN
 IF list_type IS NULL OR list_type NOT IN('AI','BI') OR purpose IS NULL OR purpose NOT IN('ediel_list_reconciliation','ediel_list_export') THEN RAISE EXCEPTION 'ai_bi_processing_scope_required'; END IF;
 SELECT count(*) INTO candidates FROM gridex_ai_processing.decisions x WHERE x.company_id=c AND x.list_type=purpose_decision_after_actor_v1.list_type AND x.purpose=purpose_decision_after_actor_v1.purpose
  AND NOT EXISTS(SELECT FROM gridex_ai_processing.decisions next WHERE next.previous_decision_id=x.id);
 IF candidates<>1 THEN RETURN jsonb_build_object('status','held','blocker',CASE WHEN candidates=0 THEN 'ai_bi_processing_decision_missing' ELSE 'ai_bi_processing_decision_ambiguous' END); END IF;
 SELECT * INTO d FROM gridex_ai_processing.decisions x WHERE x.company_id=c AND x.list_type=purpose_decision_after_actor_v1.list_type AND x.purpose=purpose_decision_after_actor_v1.purpose
  AND NOT EXISTS(SELECT FROM gridex_ai_processing.decisions next WHERE next.previous_decision_id=x.id) FOR SHARE;
 IF d.valid_from>statement_timestamp() OR d.valid_until<=statement_timestamp() THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_processing_decision_not_current'); END IF;
 -- The current repository has no authenticated decision-owner registry.
 -- A stored UUID, hash, tenant role or retention value cannot qualify one.
 RETURN jsonb_build_object('status','held','blocker','ai_bi_processing_decision_owner_registry_unqualified');
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.purpose_decision_after_actor_v1(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION gridex_ai_processing.current_purpose_decision_for_phase_v1(c uuid,actor uuid,list_type text,purpose text,phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ai_processing.authorize_purpose_phase_v1(c,actor,phase,NULL);
 RETURN gridex_ai_processing.purpose_decision_after_actor_v1(c,list_type,purpose);
END $$;
CREATE FUNCTION gridex_ai_processing.require_export_decision_for_intent_v1(c uuid,actor uuid,intent uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE i public.ediel_message_intents%rowtype;decision jsonb;BEGIN
 i:=gridex_ai_processing.intent_request_v1(c,intent);
 PERFORM gridex_ai_processing.authorize_purpose_phase_v1(c,actor,'origination',i.environment);
 decision:=gridex_ai_processing.purpose_decision_after_actor_v1(c,'AI','ediel_list_export');
 IF decision->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',coalesce(decision->>'blocker','ai_bi_processing_decision_invalid') USING ERRCODE='42501'; END IF;
 IF decision#>>'{decision,companyId}' IS DISTINCT FROM c::text OR decision#>>'{decision,listType}' IS DISTINCT FROM 'AI' OR decision#>>'{decision,purpose}' IS DISTINCT FROM 'ediel_list_export' THEN RAISE EXCEPTION 'ai_list_export_decision_scope_mismatch'; END IF;
 RETURN decision;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.require_export_decision_for_intent_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.gridex_ai_outbound_origin_status_v1(p_company_id uuid,p_actor_user_id uuid,p_intent_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_ai_processing.outbound_origins%rowtype;b gridex_ai_processing.outbound_origin_bindings%rowtype;i public.ediel_message_intents%rowtype;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_list_origination_service_required' USING ERRCODE='42501'; END IF;
 -- Current actor scope precedes any original personal source disclosure.
 PERFORM gridex_ai_processing.require_export_decision_for_intent_v1(p_company_id,p_actor_user_id,p_intent_id);
 i:=gridex_ai_processing.intent_request_v1(p_company_id,p_intent_id);
 SELECT * INTO o FROM gridex_ai_processing.outbound_origins WHERE intent_id=i.id AND company_id=p_company_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','new'); END IF;
 SELECT * INTO b FROM gridex_ai_processing.outbound_origin_bindings WHERE intent_id=i.id;
 IF FOUND THEN RETURN jsonb_build_object('status','bound','messageId',b.message_id,'payloadHash',o.payload_hash); END IF;
 PERFORM gridex_ai_processing.header_company_basis_v1(p_company_id,o.environment,i.sender_ediel_id,i.receiver_ediel_id);
 RETURN jsonb_build_object('status','original','rawPayload',o.raw_payload,'fileName',o.file_name,'mimeType',o.mime_type,'payloadHash',o.payload_hash);
END $$;
CREATE OR REPLACE FUNCTION public.gridex_ai_record_outbound_original_v1(p_company_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_snapshot_id uuid,p_readset_hash text,p_raw_payload text,p_file_name text,p_mime_type text,p_row_sources text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.ediel_message_intents%rowtype;snap gridex_received_sources.object_selection_snapshots%rowtype;
 prior gridex_ai_processing.outbound_origins%rowtype;wire jsonb;decision jsonb;basis jsonb;source_ids jsonb;header text;point uuid;row_sources jsonb;
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
CREATE OR REPLACE FUNCTION gridex_ai_processing.require_original_draft_v1(c uuid,actor uuid,intent uuid,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.ediel_message_intents%rowtype;o gridex_ai_processing.outbound_origins%rowtype;decision jsonb;header jsonb;profile jsonb:=gridex_ai_processing.native_profile_v1();k text;
BEGIN
 decision:=gridex_ai_processing.require_export_decision_for_intent_v1(c,actor,intent);
 i:=gridex_ai_processing.intent_request_v1(c,intent);
 SELECT * INTO o FROM gridex_ai_processing.outbound_origins WHERE intent_id=i.id AND company_id=c FOR SHARE;
 IF NOT FOUND OR o.operation_id IS DISTINCT FROM i.operation_id OR o.intent_basis IS DISTINCT FROM gridex_ai_processing.intent_basis_v1(i) OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR d->>'actorUserId' IS DISTINCT FROM actor::text
  OR d->>'companyId' IS DISTINCT FROM c::text OR d->>'intentId' IS DISTINCT FROM i.id::text OR d->>'sourceOperationId' IS DISTINCT FROM i.operation_id::text
  OR d->>'direction' IS DISTINCT FROM 'outbound' OR d->>'messageStandard' IS DISTINCT FROM 'ai_list' OR d->>'messageFamily' IS DISTINCT FROM 'AI_LIST'
  OR d->>'messageCode' IS DISTINCT FROM 'AI' OR d->>'messageVersion' IS DISTINCT FROM profile->>'technicalVersion' OR d->>'environment' IS DISTINCT FROM o.environment
  OR d->>'processType' IS DISTINCT FROM 'ai_list_export' OR d->>'rawPayload' IS DISTINCT FROM o.raw_payload
  OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(o.raw_payload,'UTF8')),'hex') OR d->>'fileName' IS DISTINCT FROM o.file_name OR d->>'mimeType' IS DISTINCT FROM o.mime_type
  OR d->>'senderEdielId' IS DISTINCT FROM i.sender_ediel_id OR d->>'receiverEdielId' IS DISTINCT FROM i.receiver_ediel_id
  OR d->>'customerId' IS DISTINCT FROM i.customer_id::text OR d->>'siteId' IS DISTINCT FROM i.customer_site_id::text
  OR nullif(d->>'meteringPointId','') IS DISTINCT FROM nullif(i.metering_point_id,'')
  OR d->>'communicationRouteId' IS DISTINCT FROM i.communication_route_id::text OR d->>'routeProfileId' IS DISTINCT FROM i.route_profile_id::text THEN RAISE EXCEPTION 'ai_list_private_original_required'; END IF;
 FOREACH k IN ARRAY ARRAY['applicationReference','interchangeReference','externalReference','correlationReference','transactionReference',
  'originalMessageId','originalTransactionId','originalMessageCode','relatedMessageId','switchRequestId','gridOwnerDataRequestId','outboundRequestId','partnerExportId',
  'canonicalRulePackId','ruleProfileKey','ruleProfileVersionId','ruleProfileVersion','rulePackChecksum'] LOOP
  IF nullif(d->>k,'') IS NOT NULL THEN RAISE EXCEPTION 'ai_list_edifact_or_foreign_link_forbidden'; END IF;
 END LOOP;
 IF coalesce(d->'rulePackSnapshot','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb) THEN RAISE EXCEPTION 'ai_list_edifact_or_foreign_link_forbidden'; END IF;
 PERFORM gridex_ai_processing.outbound_wire_v1(o.raw_payload);
 header:=gridex_ai_processing.header_company_basis_v1(c,o.environment,i.sender_ediel_id,i.receiver_ediel_id);
 RETURN jsonb_build_object('owner','ai-list-private-original-v1','companyId',c,'environment',o.environment,'intentId',i.id,'operationId',i.operation_id,
  'sourceHash',o.payload_hash,'snapshotId',o.snapshot_id,'readsetHash',o.readset_hash,'sourceSha256',profile->>'sourceSha256','technicalVersion',profile->>'technicalVersion',
  'processingDecisionId',decision#>>'{decision,id}','headerBasis',header);
END $$;
COMMIT;
