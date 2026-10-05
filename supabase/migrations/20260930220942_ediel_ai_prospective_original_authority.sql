-- Prospective AI originals retain their own technical authority. No EDIFACT
-- witness, reference, historical intent operation or legal approval is invented.
BEGIN;
-- Separate current actor capabilities at the same purpose-decision owner.
CREATE FUNCTION gridex_ai_processing.current_purpose_decision_for_phase_v1(c uuid,actor uuid,list_type text,purpose text,phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidates integer;d gridex_ai_processing.decisions%rowtype;
BEGIN
 IF phase IS NULL OR phase NOT IN ('origination','send') OR c IS NULL OR actor IS NULL OR list_type IS NULL OR list_type NOT IN ('AI','BI') OR purpose IS NULL OR purpose NOT IN ('ediel_list_reconciliation','ediel_list_export') THEN RAISE EXCEPTION 'ai_bi_processing_scope_required'; END IF;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor FOR SHARE;
 PERFORM p.id FROM public.user_profiles p WHERE p.id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.user_profiles p WHERE p.id=actor AND p.user_status='active')
 OR NOT (CASE WHEN phase='origination' THEN coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.write'),false) OR coalesce(public.gridex_actor_has_company_permission(actor,c,'ediel_testing.write'),false) ELSE coalesce(public.gridex_actor_has_company_permission(actor,c,'ediel.send'),false) OR coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.send'),false) END) THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO candidates FROM gridex_ai_processing.decisions x WHERE x.company_id=c AND x.list_type=current_purpose_decision_for_phase_v1.list_type AND x.purpose=current_purpose_decision_for_phase_v1.purpose
  AND NOT EXISTS(SELECT FROM gridex_ai_processing.decisions next WHERE next.previous_decision_id=x.id);
 IF candidates<>1 THEN RETURN jsonb_build_object('status','held','blocker',CASE WHEN candidates=0 THEN 'ai_bi_processing_decision_missing' ELSE 'ai_bi_processing_decision_ambiguous' END); END IF;
 SELECT * INTO d FROM gridex_ai_processing.decisions x WHERE x.company_id=c AND x.list_type=current_purpose_decision_for_phase_v1.list_type AND x.purpose=current_purpose_decision_for_phase_v1.purpose
  AND NOT EXISTS(SELECT FROM gridex_ai_processing.decisions next WHERE next.previous_decision_id=x.id) FOR SHARE;
 IF d.valid_from>statement_timestamp() OR d.valid_until<=statement_timestamp() THEN RETURN jsonb_build_object('status','held','blocker','ai_bi_processing_decision_not_current'); END IF;
 -- The current repository has no authenticated decision-owner registry.
 -- A stored UUID, hash, tenant role or retention value cannot qualify one.
 RETURN jsonb_build_object('status','held','blocker','ai_bi_processing_decision_owner_registry_unqualified');
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.current_purpose_decision_for_phase_v1(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION gridex_ai_processing.current_purpose_decision_v1(c uuid,actor uuid,list_type text,purpose text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_ai_processing.current_purpose_decision_for_phase_v1(c,actor,list_type,purpose,'origination')$$;
CREATE FUNCTION gridex_ai_processing.require_export_decision_for_phase_v1(c uuid,actor uuid,phase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE decision jsonb;BEGIN
 decision:=gridex_ai_processing.current_purpose_decision_for_phase_v1(c,actor,'AI','ediel_list_export',phase);
 IF decision->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',coalesce(decision->>'blocker','ai_bi_processing_decision_invalid') USING ERRCODE='42501'; END IF;
 IF decision#>>'{decision,companyId}' IS DISTINCT FROM c::text OR decision#>>'{decision,listType}' IS DISTINCT FROM 'AI' OR decision#>>'{decision,purpose}' IS DISTINCT FROM 'ediel_list_export' THEN RAISE EXCEPTION 'ai_list_export_decision_scope_mismatch'; END IF;
 RETURN decision;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.require_export_decision_for_phase_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION gridex_ai_processing.require_export_decision_v1(c uuid,actor uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_ai_processing.require_export_decision_for_phase_v1(c,actor,'origination')$$;
CREATE OR REPLACE FUNCTION gridex_ai_processing.require_ai_outbound_source_before_origin_v1(c uuid,message_id uuid,actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;wire jsonb;decision jsonb;basis jsonb;profile jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages s WHERE s.id=message_id AND s.company_id=c FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'ai_list' OR m.message_family IS DISTINCT FROM 'AI_LIST'
  OR m.message_code IS DISTINCT FROM 'AI' OR m.raw_payload IS NULL OR m.immutable_rendered_at IS NULL
  OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ai_list_sealed_outbound_source_required'; END IF;
 wire:=gridex_ai_processing.outbound_wire_v1(m.raw_payload);profile:=wire->'profile';
 IF m.sender_ediel_id IS DISTINCT FROM wire->>'supplierEdielId' OR m.receiver_ediel_id IS DISTINCT FROM wire->>'networkEdielId'
  OR m.message_version IS DISTINCT FROM profile->>'technicalVersion' THEN RAISE EXCEPTION 'ai_list_outbound_party_profile_scope_mismatch'; END IF;
 IF m.file_name IS NULL OR lower(m.file_name) NOT LIKE '%.csv' OR m.mime_type IS NULL
  OR m.mime_type!~* '^text/csv([ \t]*;[ \t]*charset[ \t]*=[ \t]*(utf-8|"utf-8"))?[ \t]*$' THEN RAISE EXCEPTION 'ai_list_csv_file_type_required'; END IF;
 decision:=gridex_ai_processing.require_export_decision_for_phase_v1(c,actor,'send');
 basis:=gridex_ai_processing.header_company_basis_v1(c,m.environment,wire->>'supplierEdielId',wire->>'networkEdielId');
 PERFORM public.ediel_require_scoped_capability_for_message_v1(c,m.id);
 IF m.environment='production' AND NOT EXISTS(SELECT FROM gridex_ediel_readiness.evidence e WHERE e.company_id=c AND e.scope->>'family'='AI_LIST'
  AND e.scope->>'code'='AI' AND e.expires_at>statement_timestamp() AND e.dependencies->>'rulepackHash'=profile->>'sourceSha256'
  AND e.dependencies->>'technicalFormatVersion'=profile->>'technicalVersion') THEN RAISE EXCEPTION 'ai_list_scoped_profile_dependency_required'; END IF;
 RETURN jsonb_build_object('sourceHash',m.immutable_payload_hash,'profile',profile,'headerBasis',basis,'decisionId',decision#>>'{decision,id}','rowCount',wire->'rowCount');
END $$;
ALTER FUNCTION gridex_ai_processing.intent_request_v1(uuid,uuid) RENAME TO intent_request_before_operation_v1;
CREATE FUNCTION gridex_ai_processing.intent_request_v1(c uuid,intent uuid) RETURNS public.ediel_message_intents
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.ediel_message_intents%rowtype;BEGIN
 i:=gridex_ai_processing.intent_request_before_operation_v1(c,intent);
 IF i.market IS DISTINCT FROM 'electricity' OR i.operation_id IS NULL OR i.payload->>'requestId' IS DISTINCT FROM i.operation_id::text
  OR i.validation_result->>'ok' IS DISTINCT FROM 'true' OR i.blocking_reasons IS DISTINCT FROM '[]'::jsonb
  OR i.supplier_switch_request_id IS NOT NULL OR i.customer_info_request_id IS NOT NULL OR i.grid_owner_information_request_id IS NOT NULL THEN
  RAISE EXCEPTION 'ai_list_validated_technical_operation_required';
 END IF;
 RETURN i;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.intent_request_before_operation_v1(uuid,uuid),gridex_ai_processing.intent_request_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Existing unsealed operations are not reconstructed. New receipts freeze
-- the real validated request before any public message is persisted.
ALTER TABLE gridex_ai_processing.outbound_origins ADD COLUMN operation_id uuid,ADD COLUMN intent_basis jsonb;
CREATE FUNCTION gridex_ai_processing.intent_basis_v1(i public.ediel_message_intents) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT jsonb_build_object('companyId',i.company_id,'environment',i.environment,'operationId',i.operation_id,
 'customerId',i.customer_id,'siteId',i.customer_site_id,'meteringPointId',nullif(i.metering_point_id,''),'routeId',i.communication_route_id,'routeProfileId',i.route_profile_id,
 'supplier',i.sender_ediel_id,'network',i.receiver_ediel_id,'payload',i.payload)$$;
REVOKE ALL ON FUNCTION gridex_ai_processing.intent_basis_v1(public.ediel_message_intents) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ai_processing.capture_origin_operation_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE i public.ediel_message_intents%rowtype;BEGIN
 i:=gridex_ai_processing.intent_request_v1(NEW.company_id,NEW.intent_id);
 NEW.operation_id:=i.operation_id;NEW.intent_basis:=gridex_ai_processing.intent_basis_v1(i);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.capture_origin_operation_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ai_origin_actual_operation BEFORE INSERT ON gridex_ai_processing.outbound_origins FOR EACH ROW EXECUTE FUNCTION gridex_ai_processing.capture_origin_operation_v1();
-- Draft values identify the prospective original; they never confer authority.
-- The complete private source-selection receipt and validated intent predate it.
CREATE FUNCTION gridex_ai_processing.require_original_draft_v1(c uuid,actor uuid,intent uuid,d jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.ediel_message_intents%rowtype;o gridex_ai_processing.outbound_origins%rowtype;decision jsonb;header jsonb;profile jsonb:=gridex_ai_processing.native_profile_v1();k text;
BEGIN
 decision:=gridex_ai_processing.require_export_decision_v1(c,actor);
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
REVOKE ALL ON FUNCTION gridex_ai_processing.require_original_draft_v1(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.gridex_ai_prepare_outbound_original_v1(p_company_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_draft_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_list_origination_service_required' USING ERRCODE='42501'; END IF;
 IF p_draft_text IS NULL OR octet_length(p_draft_text)>23068672 THEN RAISE EXCEPTION 'ai_list_original_draft_resource_bound'; END IF;
 RETURN gridex_ai_processing.require_original_draft_v1(p_company_id,p_actor_user_id,p_intent_id,p_draft_text::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.gridex_ai_prepare_outbound_original_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_ai_prepare_outbound_original_v1(uuid,uuid,uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION gridex_ai_processing.bind_original_message_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m jsonb:=to_jsonb(NEW);d jsonb;proof jsonb;BEGIN
 IF NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_standard IS DISTINCT FROM 'ai_list' THEN RETURN NEW; END IF;
 d:=jsonb_build_object('actorUserId',NEW.created_by,'companyId',NEW.company_id,'intentId',NEW.intent_id,'sourceOperationId',m->'source_operation_id',
  'direction',NEW.direction,'messageStandard',NEW.message_standard,'messageFamily',NEW.message_family,'messageCode',NEW.message_code,'messageVersion',NEW.message_version,'environment',NEW.environment,
  'processType',m->'process_type','rawPayload',NEW.raw_payload,'fileName',NEW.file_name,'mimeType',NEW.mime_type,'senderEdielId',NEW.sender_ediel_id,'receiverEdielId',NEW.receiver_ediel_id,
  'customerId',NEW.customer_id,'siteId',NEW.site_id,'meteringPointId',m->'metering_point_id','communicationRouteId',NEW.communication_route_id,'routeProfileId',NEW.route_profile_id,
  'applicationReference',m->'application_reference','interchangeReference',m->'interchange_reference','externalReference',m->'external_reference','correlationReference',m->'correlation_reference','transactionReference',m->'transaction_reference',
  'originalMessageId',m->'original_message_id','originalTransactionId',m->'original_transaction_id','originalMessageCode',m->'original_message_code','relatedMessageId',m->'related_message_id','switchRequestId',m->'switch_request_id',
  'gridOwnerDataRequestId',m->'grid_owner_data_request_id','outboundRequestId',m->'outbound_request_id','partnerExportId',m->'partner_export_id','canonicalRulePackId',m->'canonical_rule_pack_id',
  'ruleProfileKey',m->'rule_profile_key','ruleProfileVersionId',m->'rule_profile_version_id','ruleProfileVersion',m->'rule_profile_version','rulePackChecksum',m->'rule_pack_checksum','rulePackSnapshot',m->'rule_pack_snapshot');
 proof:=gridex_ai_processing.require_original_draft_v1(NEW.company_id,NEW.created_by,NEW.intent_id,d);
 INSERT INTO gridex_ai_processing.outbound_origin_bindings(intent_id,message_id,company_id,payload_hash) VALUES(NEW.intent_id,NEW.id,NEW.company_id,proof->>'sourceHash');
 RETURN NEW;
END $$;
-- Existing binding/read and transport guard still consume the same immutable
-- origin, operation and whole draft. There is no parallel send journal.
ALTER FUNCTION gridex_ai_processing.require_ai_outbound_origin_v1(uuid,uuid) RENAME TO require_ai_outbound_origin_before_operation_v1;
CREATE FUNCTION gridex_ai_processing.require_ai_outbound_origin_v1(c uuid,message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE proof jsonb;m public.ediel_messages%rowtype;i public.ediel_message_intents%rowtype;o gridex_ai_processing.outbound_origins%rowtype;BEGIN
 proof:=gridex_ai_processing.require_ai_outbound_origin_before_operation_v1(c,message_id);
 SELECT * INTO m FROM public.ediel_messages WHERE id=message_id AND company_id=c FOR SHARE;
 i:=gridex_ai_processing.intent_request_v1(c,m.intent_id);
 SELECT * INTO o FROM gridex_ai_processing.outbound_origins WHERE intent_id=i.id AND company_id=c FOR SHARE;
 IF o.operation_id IS DISTINCT FROM i.operation_id OR o.intent_basis IS DISTINCT FROM gridex_ai_processing.intent_basis_v1(i) OR to_jsonb(m)->>'source_operation_id' IS DISTINCT FROM i.operation_id::text THEN RAISE EXCEPTION 'ai_list_private_original_conflict'; END IF;
 RETURN proof||jsonb_build_object('operationId',i.operation_id);
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.require_ai_outbound_origin_before_operation_v1(uuid,uuid),gridex_ai_processing.require_ai_outbound_origin_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
