-- Forward-only repair of the same native beneficiary consumer.
-- All original filtered/current source/provenance guards and OID/ACL remain.
-- Retained current reads perform zero attempted receipt writes.
-- Same public OID/ACL and current filtered consumer. The receipt is created
-- only after that consumer has checked the actual actor, assignment, current
-- native permission source, accepted storage and exact purpose/field scope.
CREATE OR REPLACE FUNCTION public.ediel_beneficiary_series_page_v1(
 p_beneficiary_company_id uuid,p_actor_user_id uuid,p_grant_id uuid,p_expected_grant_version bigint,
 p_purpose text,p_series_id uuid,p_fields text[],p_start timestamptz,p_end timestamptz,
 p_limit integer DEFAULT 100,p_after_at timestamptz DEFAULT NULL,p_after_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE
 page jsonb; g public.ediel_data_access_grants%rowtype; a public.ediel_service_assignments%rowtype;
 s public.meter_reading_series%rowtype; m public.ediel_messages%rowtype; ctx jsonb;
 stored gridex_utilts_binding.contracts%rowtype; native_contract jsonb; source_sender text;
 source_app text; source_role text; origin jsonb; receipt_proof jsonb; h text; receipt_id uuid;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 page:=gridex_ediel_ack_replay.beneficiary_series_page_filtered_v2(
  p_beneficiary_company_id,p_actor_user_id,p_grant_id,p_expected_grant_version,p_purpose,p_series_id,
  p_fields,p_start,p_end,p_limit,p_after_at,p_after_id);
 SELECT * INTO STRICT g FROM public.ediel_data_access_grants WHERE id=p_grant_id AND beneficiary_company_id=p_beneficiary_company_id FOR SHARE;
 SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=g.company_id AND id=g.assignment_id FOR SHARE;
 SELECT * INTO STRICT s FROM public.meter_reading_series WHERE company_id=g.company_id AND id=p_series_id FOR SHARE;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=g.company_id AND id=s.source_ediel_message_id;
 ctx:=gridex_ediel_ack_replay.require_current_source_role_v2(g.company_id,m.environment,m.id);
 SELECT * INTO STRICT stored FROM gridex_utilts_binding.contracts
  WHERE company_id=g.company_id AND source_message_id=m.id AND series_id=s.id;
 native_contract:=gridex_utilts_binding.stored_contract_v1(g.company_id,m.id,stored.transaction_id);
 IF native_contract IS DISTINCT FROM stored.contract OR stored.contract_version NOT IN (1,2) OR stored.contract->>'version' IS DISTINCT FROM stored.contract_version::text OR stored.contract_hash IS NULL
  OR stored.contract_hash IS DISTINCT FROM encode(sha256(convert_to(stored.contract::text,'UTF8')),'hex')
 THEN RAISE EXCEPTION 'ediel_projection_native_origin_unavailable'; END IF;
 SELECT t#>>'{elements,7,0}' INTO STRICT source_app FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(m.raw_payload)) t WHERE t->>'tag'='UNB';
 SELECT t#>>'{elements,2,0}' INTO STRICT source_sender FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(m.raw_payload)) t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='MS';
 source_role:=split_part(source_app,'-',2);
 IF source_app IS NULL OR source_app IS DISTINCT FROM ctx->>'applicationReference' OR source_role NOT IN ('DDQ','DGI')
  OR source_sender IS NULL OR ctx->>'actorRole' IS DISTINCT FROM 'energy_service_company'
  OR page->>'grantId' IS DISTINCT FROM g.id::text OR (page->>'grantVersion')::bigint IS DISTINCT FROM g.version
  OR page->>'seriesId' IS DISTINCT FROM s.id::text
 THEN RAISE EXCEPTION 'ediel_projection_source_provenance_unavailable'; END IF;
 origin:=jsonb_build_object(
  'version',1,'sourceMessageId',m.id,'sourceRawHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),
  'sourceFamily',m.message_family,'sourceCode',m.message_code,'sourceEnvironment',m.environment,
  'sourceRole',source_role,'sourceApplicationReference',source_app,'sourceSenderEdielId',source_sender,
  'receiverActorId',ctx->>'legalActorId','receiverRole',ctx->>'actorRole',
  'contractVersion',stored.contract_version,'contractHash',stored.contract_hash,
  'purpose',g.purpose,'fields',to_jsonb(p_fields),
  'qualityOrigin',CASE WHEN 'quality'=ANY(p_fields) THEN jsonb_build_object('sourceMessageId',m.id,'seriesId',s.id,'column','meter_reading_values.quality') ELSE NULL END);
 receipt_proof:=jsonb_build_object('version',1,'providerCompanyId',g.company_id,'beneficiaryCompanyId',p_beneficiary_company_id,
  'actorUserId',p_actor_user_id,'assignmentId',a.id,'assignmentVersion',a.version,'grantId',g.id,'grantVersion',g.version,
  'permissionLinkId',g.permission_link_id,'seriesId',s.id,'origin',origin,'start',p_start,'end',p_end,
  'limit',p_limit,'afterAt',p_after_at,'afterId',p_after_id,
  'pageHash',encode(sha256(convert_to(page::text,'UTF8')),'hex'));
 h:=encode(sha256(convert_to(receipt_proof::text,'UTF8')),'hex');
 -- The capability hash is derived from the fully qualified native proof above;
 -- it is never supplied by a caller. Serialize this one proof only after all
 -- current authority/source checks, then return retained bytes without an
 -- attempted INSERT. Different purposes/actors/pages retain separate receipts.
 PERFORM pg_advisory_xact_lock(hashtextextended('ediel_beneficiary_projection_receipt:'||h,0));
 SELECT id INTO receipt_id FROM gridex_ediel_services.projection_receipts WHERE proof_hash=h AND proof=receipt_proof;
 IF receipt_id IS NULL THEN
  IF EXISTS(SELECT FROM gridex_ediel_services.projection_receipts WHERE proof_hash=h) THEN
   RAISE EXCEPTION 'ediel_projection_receipt_proof_conflict';
  END IF;
  INSERT INTO gridex_ediel_services.projection_receipts(company_id,beneficiary_company_id,actor_user_id,source_message_id,series_id,grant_id,grant_version,proof_hash,proof)
   VALUES(g.company_id,p_beneficiary_company_id,p_actor_user_id,m.id,s.id,g.id,g.version,h,receipt_proof)
   RETURNING id INTO STRICT receipt_id;
 END IF;
 RETURN page||jsonb_build_object('consumerReceiptId',receipt_id,'provenance',origin);
END $$;
COMMENT ON FUNCTION public.ediel_beneficiary_series_page_v1(uuid,uuid,uuid,bigint,text,uuid,text[],timestamptz,timestamptz,integer,timestamptz,uuid)
 IS 'Current scoped beneficiary page with immutable first native source provenance and a private consumer receipt; no raw source exposure or market-role conversion.';
