-- AI header parties are legal; intent/message/SMTP parties are technical.
-- Same canonical AI profile/history/original/transport journal. No source,
-- network owner, mandate, legal processing decision or activation is seeded.
BEGIN;
CREATE FUNCTION gridex_ai_processing.transport_mandate_basis_v1(c uuid,env text,legal_actor uuid,transport_actor uuid,relation_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('status','held','blocker','ai_list_transport_mandate_source_unqualified')
$$;
-- Existing tenant relations identify a technical agent. They are not an
-- authenticated supplier-wide legal mandate. No such approved registry exists.
CREATE FUNCTION gridex_ai_processing.party_source_v1(c uuid,intent uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.ediel_message_intents%rowtype;q jsonb;supplier jsonb;header jsonb;mandate jsonb;legal_actor uuid;legal_id text;
 relation public.tenant_counterparty_relations%rowtype;transport_actor uuid;transport_id text;n integer;facts jsonb;
BEGIN
 i:=gridex_ai_processing.intent_request_v1(c,intent);
 -- Actual current profile and SMTP tuple, separately from legal network ID.
 q:=gridex_registry_import.dispatch_source_v1(c,i.communication_route_id,i.route_profile_id,i.environment,'AI_LIST',NULL);
 IF q IS NULL OR q->>'status' IS DISTINCT FROM 'source_qualified' OR q->>'market' IS DISTINCT FROM 'EL' OR q#>>'{wire,family}' IS DISTINCT FROM 'AI'
  OR q#>>'{wire,applicationReference}' IS NOT NULL OR q->>'legalName' IS NULL OR btrim(q->>'legalName')='' THEN RAISE EXCEPTION 'ai_list_actual_network_dispatch_source_required';END IF;
 PERFORM x.id FROM public.tenant_actor_identifiers x WHERE x.company_id=c AND x.environment=i.environment ORDER BY x.id FOR SHARE;
 SELECT count(DISTINCT(x.actor_id,btrim(x.identifier_value))) INTO n FROM public.tenant_actor_identifiers x WHERE x.company_id=c AND x.environment=i.environment AND x.identifier_type='EdielId' AND x.valid_from<=statement_timestamp() AND(x.valid_to IS NULL OR statement_timestamp()<x.valid_to);
 IF n<>1 THEN RAISE EXCEPTION 'ai_list_unique_legal_supplier_required';END IF;
 SELECT x.actor_id,btrim(x.identifier_value) INTO legal_actor,legal_id FROM public.tenant_actor_identifiers x WHERE x.company_id=c AND x.environment=i.environment AND x.identifier_type='EdielId' AND x.valid_from<=statement_timestamp() AND(x.valid_to IS NULL OR statement_timestamp()<x.valid_to);
 -- This SAME private owner requires current unique supplier role/profile and
 -- authenticated versioned network-owner evidence. Its external hold remains.
 header:=gridex_ai_processing.header_company_basis_v1(c,i.environment,legal_id,q->>'legalEdielId');
 IF header->>'legalActorId' IS DISTINCT FROM legal_actor::text OR header->>'legalSupplier' IS DISTINCT FROM legal_id THEN RAISE EXCEPTION 'ai_list_legal_supplier_source_changed';END IF;
 supplier:=gridex_registry_import.current_el_actor_source_v1(legal_actor);
 IF supplier->>'status' IS DISTINCT FROM 'source_qualified' OR supplier->>'legalEdielId' IS DISTINCT FROM legal_id OR supplier->>'legalName' IS NULL OR btrim(supplier->>'legalName')='' THEN RAISE EXCEPTION 'ai_list_supplier_original_name_source_required';END IF;
 PERFORM x.id FROM public.tenant_counterparty_relations x WHERE x.company_id=c AND x.environment=i.environment AND x.relation_type='ediel_transport_agent' ORDER BY x.id FOR SHARE;
 SELECT count(*) INTO n FROM public.tenant_counterparty_relations x WHERE x.company_id=c AND x.environment=i.environment AND x.relation_type='ediel_transport_agent' AND x.is_enabled AND x.valid_from<=statement_timestamp() AND(x.valid_to IS NULL OR statement_timestamp()<x.valid_to);
 IF n>1 THEN RAISE EXCEPTION 'ai_list_current_transport_ambiguous';END IF;
 transport_actor:=legal_actor;transport_id:=legal_id;
 IF n=1 THEN
  SELECT * INTO relation FROM public.tenant_counterparty_relations x WHERE x.company_id=c AND x.environment=i.environment AND x.relation_type='ediel_transport_agent' AND x.is_enabled AND x.valid_from<=statement_timestamp() AND(x.valid_to IS NULL OR statement_timestamp()<x.valid_to);
  transport_actor:=relation.counterparty_actor_id;
  PERFORM x.id FROM public.platform_actor_identifiers x WHERE x.actor_id=transport_actor ORDER BY x.id FOR SHARE;
  SELECT count(DISTINCT btrim(x.identifier_value)),min(btrim(x.identifier_value)) INTO n,transport_id FROM public.platform_actor_identifiers x WHERE x.actor_id=transport_actor AND x.identifier_type='EdielId' AND(x.valid_from IS NULL OR x.valid_from<=statement_timestamp()::date) AND(x.valid_to IS NULL OR statement_timestamp()::date<=x.valid_to);
  IF transport_actor=legal_actor OR n<>1 OR nullif(transport_id,'') IS NULL OR transport_id=legal_id THEN RAISE EXCEPTION 'ai_list_current_transport_identity_unqualified';END IF;
  mandate:=gridex_ai_processing.transport_mandate_basis_v1(c,i.environment,legal_actor,transport_actor,relation.id);
  IF mandate->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',coalesce(mandate->>'blocker','ai_list_transport_mandate_source_unqualified');END IF;
 END IF;
 IF NOT EXISTS(SELECT FROM public.ediel_route_profiles p WHERE p.id=i.route_profile_id AND p.company_id=c AND p.sender_ediel_id=transport_id) THEN RAISE EXCEPTION 'ai_list_current_profile_technical_sender_mismatch';END IF;
 IF (nullif(i.payload->>'expectedLegalSupplier','') IS NOT NULL AND i.payload->>'expectedLegalSupplier' IS DISTINCT FROM legal_id) OR (nullif(i.payload->>'expectedLegalNetwork','') IS NOT NULL AND i.payload->>'expectedLegalNetwork' IS DISTINCT FROM q->>'legalEdielId') THEN RAISE EXCEPTION 'ai_list_expected_legal_party_mismatch';END IF;
 IF i.sender_ediel_id IS DISTINCT FROM transport_id OR i.receiver_ediel_id IS DISTINCT FROM q#>>'{wire,interchangePartyId}' THEN RAISE EXCEPTION 'ai_list_technical_intent_party_source_mismatch';END IF;
 facts:=jsonb_build_object('supplier',supplier,'networkDispatch',q,'tenantHeader',header,'networkOwner',header->'network','transportRelation',CASE WHEN relation.id IS NULL THEN NULL ELSE to_jsonb(relation) END,
  'transportIdentifiers',CASE WHEN relation.id IS NULL THEN NULL ELSE(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.platform_actor_identifiers x WHERE x.actor_id=transport_actor AND x.identifier_type='EdielId' AND(x.valid_from IS NULL OR x.valid_from<=statement_timestamp()::date) AND(x.valid_to IS NULL OR statement_timestamp()::date<=x.valid_to)) END,'transportMandate',mandate);
 RETURN jsonb_build_object('status','source_qualified','companyId',c,'environment',i.environment,'intentId',i.id,'communicationRouteId',i.communication_route_id,'routeProfileId',i.route_profile_id,
  'legalActorId',legal_actor,'transportActorId',transport_actor,'legalSupplier',legal_id,'legalSupplierName',supplier->'legalName','legalNetwork',q->'legalEdielId','legalNetworkName',q->'legalName',
  'technicalSender',transport_id,'technicalReceiver',q#>'{wire,interchangePartyId}','sourceBasis',facts);
END$$;
CREATE FUNCTION public.ediel_ai_outbound_party_basis_v1(p_company_id uuid,p_actor_user_id uuid,p_intent_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_list_origination_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ai_processing.require_export_decision_for_intent_v1(p_company_id,p_actor_user_id,p_intent_id);
 RETURN gridex_ai_processing.party_source_v1(p_company_id,p_intent_id);
END$$;
CREATE FUNCTION gridex_ai_processing.require_party_wire_v1(raw text,parties jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$DECLARE wire jsonb;h text[];normalized text;BEGIN
 wire:=gridex_ai_processing.outbound_wire_v1(raw);normalized:=replace(raw,E'\r\n',E'\n');IF left(normalized,1)=chr(65279) THEN normalized:=substring(normalized FROM 2);END IF;h:=string_to_array(split_part(normalized,E'\n',1),';');
 IF wire->>'supplierEdielId' IS DISTINCT FROM parties->>'legalSupplier' OR wire->>'networkEdielId' IS DISTINCT FROM parties->>'legalNetwork'
  OR h[5] IS DISTINCT FROM parties->>'legalSupplierName' OR h[3] IS DISTINCT FROM parties->>'legalNetworkName' THEN RAISE EXCEPTION 'ai_list_original_legal_party_source_mismatch';END IF;RETURN wire;
END$$;
CREATE FUNCTION gridex_ai_processing.authorize_original_actor_v1(c uuid,actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF c IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden' USING ERRCODE='42501';END IF;
 PERFORM x.user_id FROM public.company_memberships x WHERE x.company_id=c AND x.user_id=actor FOR SHARE;PERFORM x.id FROM public.user_profiles x WHERE x.id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships x WHERE x.company_id=c AND x.user_id=actor AND x.status='active' AND x.is_active AND x.accepted_at IS NOT NULL)
  OR NOT EXISTS(SELECT FROM public.user_profiles x WHERE x.id=actor AND x.user_status='active') THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden' USING ERRCODE='42501';END IF;
END$$;
CREATE FUNCTION gridex_ai_processing.authorize_original_read_v1(c uuid,actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM gridex_ai_processing.authorize_original_actor_v1(c,actor);
 IF NOT(coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.read'),false) OR coalesce(public.gridex_actor_has_company_permission(actor,c,'metering.read'),false)) THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden' USING ERRCODE='42501';END IF;
END$$;
CREATE OR REPLACE FUNCTION public.gridex_ai_outbound_origin_status_v1(p_company_id uuid,p_actor_user_id uuid,p_intent_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_ai_processing.outbound_origins%rowtype;b gridex_ai_processing.outbound_origin_bindings%rowtype;i public.ediel_message_intents%rowtype;m public.ediel_messages%rowtype;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_list_origination_service_required' USING ERRCODE='42501';END IF;
 PERFORM gridex_ai_processing.authorize_original_actor_v1(p_company_id,p_actor_user_id);
 -- A bound message is locked before the intent, matching current provider
 -- entry. Immutable bindings discover that exact row without a latest lookup.
 SELECT * INTO b FROM gridex_ai_processing.outbound_origin_bindings WHERE intent_id=p_intent_id AND company_id=p_company_id;
 IF FOUND THEN SELECT * INTO m FROM public.ediel_messages WHERE id=b.message_id AND company_id=p_company_id FOR SHARE;END IF;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=p_intent_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ai_list_validated_technical_intent_required';END IF;
 SELECT * INTO o FROM gridex_ai_processing.outbound_origins WHERE intent_id=i.id AND company_id=p_company_id FOR SHARE;
 IF NOT FOUND THEN
  PERFORM gridex_ai_processing.require_export_decision_for_intent_v1(p_company_id,p_actor_user_id,p_intent_id);
  RETURN jsonb_build_object('status','new');
 END IF;
 PERFORM gridex_ai_processing.authorize_original_read_v1(p_company_id,p_actor_user_id);
 IF o.environment IS DISTINCT FROM i.environment OR o.operation_id IS DISTINCT FROM i.operation_id OR o.intent_basis IS DISTINCT FROM gridex_ai_processing.intent_basis_v1(i)
  OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(o.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ai_list_private_original_conflict';END IF;
 SELECT * INTO b FROM gridex_ai_processing.outbound_origin_bindings WHERE intent_id=i.id AND company_id=p_company_id FOR SHARE;
 IF FOUND THEN
  IF m.id IS DISTINCT FROM b.message_id OR b.payload_hash IS DISTINCT FROM o.payload_hash OR m.immutable_payload_hash IS DISTINCT FROM o.payload_hash OR m.raw_payload IS DISTINCT FROM o.raw_payload
   OR m.intent_id IS DISTINCT FROM i.id OR m.environment IS DISTINCT FROM i.environment OR m.source_operation_id IS DISTINCT FROM i.operation_id OR m.sender_ediel_id IS DISTINCT FROM i.sender_ediel_id OR m.receiver_ediel_id IS DISTINCT FROM i.receiver_ediel_id
   OR m.customer_id IS DISTINCT FROM i.customer_id OR m.site_id IS DISTINCT FROM i.customer_site_id OR m.communication_route_id IS DISTINCT FROM i.communication_route_id OR m.route_profile_id IS DISTINCT FROM i.route_profile_id THEN RAISE EXCEPTION 'ai_list_private_original_conflict';END IF;
  RETURN jsonb_build_object('status','bound','messageId',b.message_id,'payloadHash',o.payload_hash);
 END IF;
 -- Immutable own original first: no current legal/route/guide/purpose reselect
 -- can rewrite this stored raw/name/party binding. A NEW INSERT/send still
 -- passes its existing phase-specific protected original/current source gate.
 RETURN jsonb_build_object('status','original','rawPayload',o.raw_payload,'fileName',o.file_name,'mimeType',o.mime_type,'payloadHash',o.payload_hash);
END$$;

-- Preserve the SAME source/epoch implementation and its physical equality
-- fences. Legal constraints are explicit extra parameters; the real intent's
-- technical transport tuple is never rewritten into fictional legal parties.
DO $scope$
DECLARE def text;needle text;signature text;closing integer;
BEGIN
 FOR signature IN SELECT unnest(ARRAY[
  'gridex_ai_processing.source_row_basis_v1(jsonb,timestamptz,text,public.ediel_message_intents,text,text)',
  'gridex_ai_processing.row_epoch_matches_v1(jsonb,timestamptz,public.ediel_message_intents,text,text,text,text,text,text,text,text)']) LOOP
  def:=pg_get_functiondef(signature::regprocedure);closing:=position(')' IN def);
  IF closing=0 OR position('i.sender_ediel_id' IN def)=0 OR position('i.receiver_ediel_id' IN def)=0 THEN RAISE EXCEPTION 'ai_list_legal_source_owner_changed';END IF;
  def:=overlay(def placing ', legal_supplier text, legal_network text' FROM closing FOR 0);
  def:=replace(replace(def,'i.sender_ediel_id','legal_supplier'),'i.receiver_ediel_id','legal_network');
  IF signature LIKE '%row_epoch_matches%' THEN
   needle:='gridex_ai_processing.source_row_basis_v1(body,cutoff,id,i,object_id,agency)';
   IF position(needle IN def)=0 THEN RAISE EXCEPTION 'ai_list_epoch_source_owner_changed';END IF;
   def:=replace(def,needle,'gridex_ai_processing.source_row_basis_v1(body,cutoff,id,i,object_id,agency,legal_supplier,legal_network)');
  END IF;EXECUTE def;
 END LOOP;
 -- The physical header values constrain the SAME approved historical legal
 -- parties. Their positive authority is the protected original/current port,
 -- never this caller raw/header in isolation.
 FOR signature IN SELECT unnest(ARRAY[
  'gridex_ai_processing.customer_history_for_rows_v1(jsonb,timestamptz,public.ediel_message_intents,text,text)',
  'gridex_ai_processing.require_original_row_sources_before_applied_structure_v1(jsonb,timestamptz,public.ediel_message_intents,text,text)',
  'gridex_ai_processing.require_original_row_sources_v1(jsonb,timestamptz,public.ediel_message_intents,text,text)']) LOOP
  def:=pg_get_functiondef(signature::regprocedure);
  IF position('BEGIN' IN def)=0 OR position('gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>' IN def)=0 THEN RAISE EXCEPTION 'ai_list_row_source_owner_changed';END IF;
  def:=replace(def,'DECLARE ','DECLARE ai_legal_wire jsonb;');
  def:=replace(def,'BEGIN',E'BEGIN\n ai_legal_wire:=gridex_ai_processing.outbound_wire_v1(raw);');
  FOR needle IN SELECT unnest(ARRAY['sourceMessageId','baselineSourceMessageId','addressSourceMessageId']) LOOP
   def:=replace(def,'gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'''||needle||''',i,cols[2],cols[3])',
    'gridex_ai_processing.source_row_basis_v1(body,cutoff,ref->>'''||needle||''',i,cols[2],cols[3],ai_legal_wire->>''supplierEdielId'',ai_legal_wire->>''networkEdielId'')');
  END LOOP;
  needle:='gridex_ai_processing.row_epoch_matches_v1(body,cutoff,i,cols[2],cols[3],period.id::text,ref->>''sourceMessageId'',ref->>''addressSourceMessageId'',period_from,h[8],least(h[9],coalesce(period_to,h[9])))';
  IF signature LIKE '%before_applied_structure%' AND position(needle IN def)=0 THEN RAISE EXCEPTION 'ai_list_row_epoch_owner_changed';END IF;
  def:=replace(def,needle,left(needle,length(needle)-1)||',ai_legal_wire->>''supplierEdielId'',ai_legal_wire->>''networkEdielId'')');
  EXECUTE def;
 END LOOP;
END $scope$;
-- Same immutable prospective-original owner, changed only at its party and
-- replay/read boundary. Complete source/cell/epoch/effect equality is retained.
DO $original$
DECLARE def text;needle text;
BEGIN
 def:=pg_get_functiondef('public.gridex_ai_record_outbound_original_v1(uuid,uuid,uuid,uuid,text,text,text,text,text)'::regprocedure);
 needle:=' decision:=gridex_ai_processing.require_export_decision_for_intent_v1(p_company_id,p_actor_user_id,p_intent_id);';
 IF position(needle IN def)=0 THEN RAISE EXCEPTION 'ai_list_original_permission_owner_changed';END IF;
 def:=replace(def,needle,'');
 needle:=' i:=gridex_ai_processing.intent_request_v1(p_company_id,p_intent_id);';
 IF position(needle IN def)=0 THEN RAISE EXCEPTION 'ai_list_original_scope_owner_changed';END IF;
 def:=replace(def,needle,E' PERFORM gridex_ai_processing.authorize_original_actor_v1(p_company_id,p_actor_user_id);\n SELECT * INTO i FROM public.ediel_message_intents WHERE id=p_intent_id AND company_id=p_company_id FOR UPDATE;\n IF NOT FOUND THEN RAISE EXCEPTION ''ai_list_validated_technical_intent_required'';END IF;');
 needle:=E' IF FOUND THEN\n  IF prior.company_id';
 IF position(needle IN def)=0 THEN RAISE EXCEPTION 'ai_list_original_prior_owner_changed';END IF;
 def:=replace(def,needle,E' IF FOUND THEN\n  PERFORM gridex_ai_processing.authorize_original_read_v1(p_company_id,p_actor_user_id);\n  IF prior.company_id');
 needle:='IF prior.company_id IS DISTINCT FROM p_company_id OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(p_raw_payload,''UTF8'')),''hex'') THEN';
 IF position(needle IN def)=0 THEN RAISE EXCEPTION 'ai_list_original_replay_owner_changed';END IF;
 def:=replace(def,needle,'IF prior.company_id IS DISTINCT FROM p_company_id OR prior.environment IS DISTINCT FROM i.environment OR prior.operation_id IS DISTINCT FROM i.operation_id OR prior.intent_basis IS DISTINCT FROM gridex_ai_processing.intent_basis_v1(i) OR prior.raw_payload IS DISTINCT FROM p_raw_payload OR prior.file_name IS DISTINCT FROM p_file_name OR prior.mime_type IS DISTINCT FROM p_mime_type OR prior.payload_hash IS DISTINCT FROM encode(sha256(convert_to(p_raw_payload,''UTF8'')),''hex'') THEN');
 needle:=' wire:=gridex_ai_processing.outbound_wire_v1(p_raw_payload);';
 IF position(needle IN def)=0 THEN RAISE EXCEPTION 'ai_list_original_wire_owner_changed';END IF;
 def:=replace(def,needle,E' i:=gridex_ai_processing.intent_request_v1(p_company_id,p_intent_id);\n decision:=gridex_ai_processing.require_export_decision_for_intent_v1(p_company_id,p_actor_user_id,p_intent_id);\n basis:=gridex_ai_processing.party_source_v1(p_company_id,i.id);\n wire:=gridex_ai_processing.require_party_wire_v1(p_raw_payload,basis);');
 needle:=' IF wire->>''supplierEdielId'' IS DISTINCT FROM i.sender_ediel_id OR wire->>''networkEdielId'' IS DISTINCT FROM i.receiver_ediel_id THEN RAISE EXCEPTION ''ai_list_original_party_scope_mismatch''; END IF;';
 IF position(needle IN def)=0 THEN RAISE EXCEPTION 'ai_list_original_party_owner_changed';END IF;def:=replace(def,needle,'');
 needle:=' basis:=gridex_ai_processing.header_company_basis_v1(p_company_id,i.environment,i.sender_ediel_id,i.receiver_ediel_id);';
 IF position(needle IN def)=0 THEN RAISE EXCEPTION 'ai_list_original_header_owner_changed';END IF;def:=replace(def,needle,'');EXECUTE def;
 def:=pg_get_functiondef('gridex_ai_processing.require_original_draft_v1(uuid,uuid,uuid,jsonb)'::regprocedure);
 needle:=' header:=gridex_ai_processing.header_company_basis_v1(c,o.environment,i.sender_ediel_id,i.receiver_ediel_id);';
 IF position(needle IN def)=0 THEN RAISE EXCEPTION 'ai_list_draft_header_owner_changed';END IF;
 def:=replace(def,needle,E' header:=gridex_ai_processing.party_source_v1(c,i.id);\n PERFORM gridex_ai_processing.require_party_wire_v1(o.raw_payload,header);\n IF o.header_basis->>''legalSupplier'' IS DISTINCT FROM header->>''legalSupplier'' OR o.header_basis->>''legalNetwork'' IS DISTINCT FROM header->>''legalNetwork'' OR (o.header_basis ? ''technicalSender'' AND (o.header_basis->>''technicalSender'' IS DISTINCT FROM header->>''technicalSender'' OR o.header_basis->>''technicalReceiver'' IS DISTINCT FROM header->>''technicalReceiver'')) THEN RAISE EXCEPTION ''ai_list_private_original_party_source_changed'';END IF;');EXECUTE def;
END $original$;
CREATE OR REPLACE FUNCTION gridex_ai_processing.require_ai_outbound_source_before_origin_v1(c uuid,message_id uuid,actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;wire jsonb;decision jsonb;basis jsonb;profile jsonb;q jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages s WHERE s.id=message_id AND s.company_id=c FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'ai_list' OR m.message_family IS DISTINCT FROM 'AI_LIST'
  OR m.message_code IS DISTINCT FROM 'AI' OR m.raw_payload IS NULL OR m.immutable_rendered_at IS NULL
  OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ai_list_sealed_outbound_source_required';END IF;
 decision:=gridex_ai_processing.require_export_decision_for_phase_v1(c,actor,'send');
 basis:=gridex_ai_processing.party_source_v1(c,m.intent_id);wire:=gridex_ai_processing.require_party_wire_v1(m.raw_payload,basis);profile:=wire->'profile';
 IF m.sender_ediel_id IS DISTINCT FROM basis->>'technicalSender' OR m.receiver_ediel_id IS DISTINCT FROM basis->>'technicalReceiver'
  OR m.environment IS DISTINCT FROM basis->>'environment' OR m.communication_route_id::text IS DISTINCT FROM basis->>'communicationRouteId' OR m.route_profile_id::text IS DISTINCT FROM basis->>'routeProfileId'
  OR m.message_version IS DISTINCT FROM profile->>'technicalVersion' THEN RAISE EXCEPTION 'ai_list_outbound_party_profile_scope_mismatch';END IF;
 IF m.file_name IS NULL OR lower(m.file_name) NOT LIKE '%.csv' OR m.mime_type IS NULL
  OR m.mime_type!~* '^text/csv([ \t]*;[ \t]*charset[ \t]*=[ \t]*(utf-8|"utf-8"))?[ \t]*$' THEN RAISE EXCEPTION 'ai_list_csv_file_type_required';END IF;
 q:=gridex_registry_import.require_message_market_v1(c,m.id);
 IF q->>'status' IS DISTINCT FROM 'source_qualified' OR q->>'legalEdielId' IS DISTINCT FROM basis->>'legalNetwork' THEN RAISE EXCEPTION 'ai_list_actual_message_dispatch_source_required';END IF;
 PERFORM public.ediel_require_scoped_capability_for_message_v1(c,m.id);
 IF m.environment='production' AND NOT EXISTS(SELECT FROM gridex_ediel_readiness.evidence e WHERE e.company_id=c AND e.scope->>'family'='AI_LIST'
  AND e.scope->>'code'='AI' AND e.expires_at>statement_timestamp() AND e.dependencies->>'rulepackHash'=profile->>'sourceSha256'
  AND e.dependencies->>'technicalFormatVersion'=profile->>'technicalVersion') THEN RAISE EXCEPTION 'ai_list_scoped_profile_dependency_required';END IF;
 RETURN jsonb_build_object('sourceHash',m.immutable_payload_hash,'profile',profile,'headerBasis',basis,'dispatchSource',q,'decisionId',decision#>>'{decision,id}','rowCount',wire->'rowCount');
END$$;
-- The first-storage trigger consumes the SAME intent-qualified purpose and
-- party owner for outbound AI. Incoming legal-header scope is unchanged.
DO $storage$
DECLARE def text;needle text;BEGIN
 def:=pg_get_functiondef('gridex_ai_processing.guard_message_storage_v1()'::regprocedure);
 needle:=E'  OR NEW.sender_ediel_id IS DISTINCT FROM (CASE WHEN NEW.direction=''inbound'' THEN h[2] ELSE h[4] END)\n  OR NEW.receiver_ediel_id IS DISTINCT FROM (CASE WHEN NEW.direction=''inbound'' THEN h[4] ELSE h[2] END)';
 IF position(needle IN def)=0 THEN RAISE EXCEPTION 'ai_list_storage_party_owner_changed';END IF;
 def:=replace(def,needle,E'  OR (NEW.direction=''inbound'' AND (NEW.sender_ediel_id IS DISTINCT FROM h[2] OR NEW.receiver_ediel_id IS DISTINCT FROM h[4]))');
 needle:=' basis:=gridex_ai_processing.personal_storage_basis_for_purpose_v1(NEW.company_id,NEW.created_by,NEW.environment,NEW.raw_payload,CASE WHEN NEW.direction=''outbound'' THEN ''ediel_list_export'' ELSE ''ediel_list_reconciliation'' END);';
 IF position(needle IN def)=0 THEN RAISE EXCEPTION 'ai_list_storage_purpose_owner_changed';END IF;
 def:=replace(def,needle,E' IF NEW.direction=''outbound'' THEN\n  PERFORM gridex_ai_processing.require_export_decision_for_intent_v1(NEW.company_id,NEW.created_by,NEW.intent_id);\n  basis:=gridex_ai_processing.party_source_v1(NEW.company_id,NEW.intent_id);PERFORM gridex_ai_processing.require_party_wire_v1(NEW.raw_payload,basis);\n  IF NEW.environment IS DISTINCT FROM basis->>''environment'' OR NEW.sender_ediel_id IS DISTINCT FROM basis->>''technicalSender'' OR NEW.receiver_ediel_id IS DISTINCT FROM basis->>''technicalReceiver'' THEN RAISE EXCEPTION ''ai_bi_personal_storage_source_context_mismatch'';END IF;\n ELSE\n  basis:=gridex_ai_processing.personal_storage_basis_for_purpose_v1(NEW.company_id,NEW.created_by,NEW.environment,NEW.raw_payload,''ediel_list_reconciliation'');\n END IF;');EXECUTE def;
END $storage$;
-- Capture/current readiness retains its existing source-owned legal role and
-- canonical profile, adding the SAME qualified technical relation/mandate.
ALTER FUNCTION gridex_ediel_readiness.source_scope(public.ediel_messages) RENAME TO source_scope_before_ai_legal_transport_v1;
CREATE FUNCTION gridex_ediel_readiness.source_scope(m public.ediel_messages) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE parties jsonb;scope jsonb;BEGIN
 IF m.message_family IS DISTINCT FROM 'AI_LIST' THEN RETURN gridex_ediel_readiness.source_scope_before_ai_legal_transport_v1(m);END IF;
 parties:=gridex_ai_processing.party_source_v1(m.company_id,m.intent_id);PERFORM gridex_ai_processing.require_party_wire_v1(m.raw_payload,parties);
 IF m.sender_ediel_id IS DISTINCT FROM parties->>'technicalSender' OR m.receiver_ediel_id IS DISTINCT FROM parties->>'technicalReceiver' THEN RAISE EXCEPTION 'ai_list_readiness_technical_party_source_mismatch';END IF;
 scope:=gridex_ediel_readiness.source_scope_before_ai_legal_transport_v1(m);
 RETURN scope||jsonb_build_object('transportRelation',parties#>'{sourceBasis,transportRelation}','transportEdielId',parties->'technicalSender','transportIdentifiers',parties#>'{sourceBasis,transportIdentifiers}','aiPartySource',parties);
END$$;
REVOKE ALL ON FUNCTION gridex_ai_processing.transport_mandate_basis_v1(uuid,text,uuid,uuid,uuid),
 gridex_ai_processing.party_source_v1(uuid,uuid),gridex_ai_processing.require_party_wire_v1(text,jsonb),gridex_ai_processing.authorize_original_actor_v1(uuid,uuid),gridex_ai_processing.authorize_original_read_v1(uuid,uuid),
 gridex_ai_processing.source_row_basis_v1(jsonb,timestamptz,text,public.ediel_message_intents,text,text,text,text),
 gridex_ai_processing.row_epoch_matches_v1(jsonb,timestamptz,public.ediel_message_intents,text,text,text,text,text,text,text,text,text,text),
 gridex_ediel_readiness.source_scope(public.ediel_messages),gridex_ediel_readiness.source_scope_before_ai_legal_transport_v1(public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_ai_outbound_party_basis_v1(uuid,uuid,uuid),public.gridex_ai_outbound_origin_status_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_ai_outbound_party_basis_v1(uuid,uuid,uuid),public.gridex_ai_outbound_origin_status_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
