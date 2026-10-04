-- Source-only mechanical reconciliation writer; shared application adapter owns
-- technical AI/BI validation. No legal owner, retention/basis or historical
-- receipt is invented. Every real new write still crosses current_decision_v1.
BEGIN;
-- The existing actor catalog does not supply authenticated versioned network
-- owner approval. Current verified identifiers/importRunId are not that proof.
-- This consumption boundary stays closed until the real registry contract is
-- supplied; no registration API, guessed issuer or source version is seeded.
CREATE FUNCTION gridex_ai_processing.network_registry_basis_v1(network_id text,env text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('status','held','blocker','ai_bi_network_registry_version_unqualified')
$$;
REVOKE ALL ON FUNCTION gridex_ai_processing.network_registry_basis_v1(text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ai_processing.header_company_basis_v1(c uuid,env text,supplier_id text,network_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor_count bigint;id_count bigint; legal_actor uuid;legal_id text;network_basis jsonb;
BEGIN
 IF c IS NULL OR env IS NULL OR env NOT IN ('test','production') OR supplier_id IS NULL OR network_id IS NULL THEN RAISE EXCEPTION 'ai_bi_header_tenant_context_required'; END IF;
 -- Native consistency guard of the canonicalTenantEdielIdentity owner inputs,
 -- with the same unique legal actor/ID, supplier role and half-open intervals.
 -- Technical transport identity and mailbox owner never supply legal parties.
 PERFORM p.id FROM public.tenant_ediel_profiles p WHERE p.company_id=c AND p.environment=env ORDER BY p.id FOR SHARE;
 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=env ORDER BY i.id FOR SHARE;
 PERFORM r.id FROM public.tenant_actor_roles r WHERE r.company_id=c AND r.environment=env ORDER BY r.id FOR SHARE;
 SELECT count(DISTINCT i.actor_id),count(DISTINCT nullif(btrim(i.identifier_value),'')),min(i.actor_id::text)::uuid,min(nullif(btrim(i.identifier_value),''))
 INTO actor_count,id_count,legal_actor,legal_id FROM public.tenant_actor_identifiers i
 WHERE i.company_id=c AND i.environment=env AND i.identifier_type='EdielId' AND i.valid_from<=statement_timestamp() AND (i.valid_to IS NULL OR statement_timestamp()<i.valid_to);
 IF actor_count<>1 OR id_count<>1 OR legal_id IS DISTINCT FROM supplier_id
 OR NOT EXISTS(SELECT FROM public.tenant_ediel_profiles p WHERE p.company_id=c AND p.environment=env AND p.market='electricity' AND p.is_enabled AND p.valid_from<=statement_timestamp() AND (p.valid_to IS NULL OR statement_timestamp()<p.valid_to))
 OR NOT EXISTS(SELECT FROM public.tenant_actor_roles r WHERE r.company_id=c AND r.environment=env AND r.actor_id=legal_actor AND btrim(r.role_code)='electricity_supplier' AND r.valid_from<=statement_timestamp() AND (r.valid_to IS NULL OR statement_timestamp()<r.valid_to)) THEN RAISE EXCEPTION 'ai_bi_header_supplier_tenant_mismatch'; END IF;
 network_basis:=gridex_ai_processing.network_registry_basis_v1(network_id,env);
 IF network_basis->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',coalesce(network_basis->>'blocker','ai_bi_network_registry_version_unqualified'); END IF;
 RETURN jsonb_build_object('legalActorId',legal_actor,'legalSupplier',legal_id,'companyId',c,'environment',env,'network',network_basis);
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.header_company_basis_v1(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.gridex_ai_bi_personal_storage_scope_v1(p_company_id uuid,p_actor_user_id uuid,p_environment text,p_header_line text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h text[];assessment jsonb;basis jsonb;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_bi_processing_service_required' USING ERRCODE='42501'; END IF;
 h:=string_to_array(p_header_line,';');
 IF cardinality(h)<>10 OR h[1] NOT IN ('AI','BI') THEN RAISE EXCEPTION 'ai_bi_personal_storage_header_required'; END IF;
 assessment:=gridex_ai_processing.current_decision_v1(p_company_id,p_actor_user_id,h[1]);
 IF assessment->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',coalesce(assessment->>'blocker','ai_bi_processing_decision_invalid') USING ERRCODE='42501'; END IF;
 basis:=gridex_ai_processing.header_company_basis_v1(p_company_id,p_environment,h[4],h[2]);
 RETURN jsonb_build_object('status','authorized','decision',assessment->'decision','headerBasis',basis);
END $$;
REVOKE ALL ON FUNCTION public.gridex_ai_bi_personal_storage_scope_v1(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_ai_bi_personal_storage_scope_v1(uuid,uuid,text,text) TO service_role;
CREATE TABLE gridex_ai_processing.reconciliation_receipts (
 source_message_id uuid PRIMARY KEY REFERENCES public.ediel_messages(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
 source_payload_hash text NOT NULL CHECK(source_payload_hash ~ '^[a-f0-9]{64}$'),
 import_id uuid NOT NULL UNIQUE REFERENCES public.ai_list_imports(id) ON DELETE RESTRICT,
 processing_decision_id uuid NOT NULL REFERENCES gridex_ai_processing.decisions(id) ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL, header_basis jsonb NOT NULL,result jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE gridex_ai_processing.reconciliation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ai_processing.reconciliation_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ai_processing.reconciliation_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON gridex_ai_processing.reconciliation_receipts TO service_role;
CREATE POLICY ai_reconciliation_receipt_service_read ON gridex_ai_processing.reconciliation_receipts FOR SELECT TO service_role USING(true);
CREATE TRIGGER ai_reconciliation_receipts_no_mutation BEFORE UPDATE OR DELETE ON gridex_ai_processing.reconciliation_receipts FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();
CREATE TRIGGER ai_reconciliation_receipts_no_truncate BEFORE TRUNCATE ON gridex_ai_processing.reconciliation_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();

CREATE FUNCTION gridex_ai_processing.reconcile_source_v1(c uuid,actor uuid,source_id uuid,expected_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
<<reconciliation>>
DECLARE m public.ediel_messages%rowtype; receipt gridex_ai_processing.reconciliation_receipts%rowtype;
 assessment jsonb; header_basis jsonb;import_id uuid; import_row_id uuid; result jsonb; records text[]; head text[]; cols text[];
 raw_columns jsonb; current_values jsonb; reasons text[]; matching integer; matched_rows jsonb; point public.metering_points%rowtype;
 i integer; row_count integer:=0; discrepancy_count integer:=0; normalized text; source_type text;
BEGIN
 IF c IS NULL OR actor IS NULL OR source_id IS NULL OR expected_hash IS NULL OR expected_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'ai_bi_reconciliation_scope_required'; END IF;
 PERFORM a.user_id FROM public.company_memberships a WHERE a.company_id=c AND a.user_id=actor FOR SHARE;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships a WHERE a.company_id=c AND a.user_id=actor AND a.status='active' AND a.is_active AND a.accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
 OR NOT (coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.write'),false) OR coalesce(public.gridex_actor_has_company_permission(actor,c,'ediel_testing.write'),false)) THEN RAISE EXCEPTION 'ediel_tenant_actor_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.ediel_messages s WHERE s.id=source_id AND s.company_id=c FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_standard IS DISTINCT FROM 'ai_list' OR m.message_family IS DISTINCT FROM 'AI_LIST'
  OR m.message_code IS NULL OR m.message_code NOT IN ('AI','BI') OR m.raw_payload IS NULL OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM expected_hash
  OR expected_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ai_bi_reconciliation_sealed_source_required'; END IF;
 SELECT * INTO receipt FROM gridex_ai_processing.reconciliation_receipts r WHERE r.source_message_id=source_id;
 IF FOUND THEN
  IF receipt.company_id<>c OR receipt.source_payload_hash<>expected_hash THEN RAISE EXCEPTION 'ai_bi_reconciliation_source_conflict'; END IF;
  RETURN receipt.result;
 END IF;
 -- A prior partial legacy import is not evidence of a whole atomic result.
 IF EXISTS(SELECT FROM public.ai_list_imports x WHERE x.source_ediel_message_id=source_id) THEN RAISE EXCEPTION 'ai_bi_legacy_reconciliation_requires_review'; END IF;
 assessment:=gridex_ai_processing.current_decision_v1(c,actor,m.message_code);
 IF assessment->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION '%',coalesce(assessment->>'blocker','ai_bi_processing_decision_invalid') USING ERRCODE='42501'; END IF;
 IF assessment#>>'{decision,companyId}' IS DISTINCT FROM c::text OR assessment#>>'{decision,listType}' IS DISTINCT FROM m.message_code THEN RAISE EXCEPTION 'ai_bi_processing_decision_mismatch'; END IF;
 -- Bounded physical records, not a second guide-version selector. The actual
 -- native source supplies every column; no caller matching/projection is used.
 IF octet_length(m.raw_payload)>10485760 THEN RAISE EXCEPTION 'ai_bi_reconciliation_resource_bound'; END IF;
 normalized:=replace(m.raw_payload,E'\r\n',E'\n');
 IF left(normalized,1)=chr(65279) THEN normalized:=substring(normalized FROM 2); END IF;
 IF right(normalized,1)=E'\n' THEN normalized:=left(normalized,length(normalized)-1); END IF;
 IF replace(normalized,E'\n','') ~ '[\r\x01-\x1f\x7f]' THEN RAISE EXCEPTION 'ai_bi_reconciliation_source_records_invalid'; END IF;
 records:=string_to_array(normalized,E'\n');
 IF cardinality(records)>100001 THEN RAISE EXCEPTION 'ai_bi_reconciliation_resource_bound'; END IF;
 head:=string_to_array(records[1],';');source_type:=head[1];
 IF cardinality(head)<>10 OR source_type IS DISTINCT FROM m.message_code OR source_type NOT IN ('AI','BI') OR head[2]!~ '^[0-9]{5}$' OR head[4]!~ '^[0-9]{5}$' THEN RAISE EXCEPTION 'ai_bi_reconciliation_source_records_invalid'; END IF;
 IF m.sender_ediel_id IS DISTINCT FROM head[2] OR m.receiver_ediel_id IS DISTINCT FROM head[4] THEN RAISE EXCEPTION 'ai_bi_reconciliation_source_party_mismatch'; END IF;
 header_basis:=gridex_ai_processing.header_company_basis_v1(c,m.environment,head[4],head[2]);
 FOR i IN 2..cardinality(records) LOOP
  cols:=string_to_array(records[i],';');
  IF cardinality(cols)<>22 OR cols[22]<>'' OR cols[1]='' OR cols[2]='' OR cols[3] NOT IN ('9','89') OR cols[3]='9' AND cols[2]!~ '^[0-9]{18}$' THEN RAISE EXCEPTION 'ai_bi_reconciliation_source_records_invalid'; END IF;
 END LOOP;
 INSERT INTO public.ai_list_imports(company_id,list_type,filename,grid_owner_id,status,row_count,raw_payload,metadata,retention_until,gdpr_basis,created_by,processing_decision_id,source_ediel_message_id)
 VALUES(c,source_type,m.file_name,m.grid_owner_id,'parsed',greatest(cardinality(records)-1,0),m.raw_payload,
  jsonb_build_object('reconciliationOnly',true,'masterdataAutoOverwrite',false,'rawColumnsFormat','physical_columns_v1','processingDecision',assessment->'decision','headerBasis',header_basis),
  (assessment#>>'{decision,retentionUntil}')::date,assessment#>>'{decision,gdprBasis}',actor,(assessment#>>'{decision,id}')::uuid,source_id) RETURNING id INTO import_id;
 FOR i IN 2..cardinality(records) LOOP
  cols:=string_to_array(records[i],';'); reasons:=ARRAY[]::text[];current_values:='{}'::jsonb;point:=NULL;matching:=0;
  raw_columns:=jsonb_build_object('physical_columns',to_jsonb(cols[1:21]),'source_row_number',i);
  IF cols[3]='9' THEN
   SELECT count(*),jsonb_agg(to_jsonb(candidate)) INTO matching,matched_rows FROM (
    SELECT p.* FROM public.metering_points p WHERE p.company_id=c AND cols[2] IN (p.metering_point_id,p.meter_point_id,p.ediel_reference,p.site_facility_id) FOR SHARE
   ) candidate;
   IF matching=1 THEN
    point:=jsonb_populate_record(NULL::public.metering_points,matched_rows->0);
    IF point.customer_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.customers customer WHERE customer.id=point.customer_id AND customer.company_id=c)
     OR coalesce(point.customer_site_id,point.site_id) IS NOT NULL AND NOT EXISTS(SELECT FROM public.customer_sites s WHERE s.id=coalesce(point.customer_site_id,point.site_id) AND s.company_id=c) THEN point:=NULL;matching:=0; END IF;
   END IF;
  END IF;
  IF cols[3]<>'9' THEN reasons:=array_append(reasons,'object_identity_agency_unqualified');
  ELSIF matching>1 THEN reasons:=array_append(reasons,'metering_point_ambiguous');
  ELSIF point.id IS NULL THEN reasons:=array_append(reasons,'metering_point_not_found'); END IF;
  IF point.id IS NOT NULL THEN
   current_values:=jsonb_build_object('id',point.id,'company_id',point.company_id,'customer_id',point.customer_id,'site_id',coalesce(point.customer_site_id,point.site_id),'grid_area_code',point.grid_area_code,'grid_owner_ediel_id',point.grid_owner_ediel_id);
   IF nullif(btrim(point.grid_area_code),'') IS NOT NULL AND upper(regexp_replace(point.grid_area_code,'\s','','g')) IS DISTINCT FROM upper(regexp_replace(cols[1],'\s','','g')) THEN reasons:=array_append(reasons,'grid_area_mismatch'); END IF;
   IF nullif(btrim(point.grid_owner_ediel_id),'') IS NOT NULL AND point.grid_owner_ediel_id IS DISTINCT FROM head[2] THEN reasons:=array_append(reasons,'grid_owner_mismatch'); END IF;
  END IF;
  INSERT INTO public.ai_list_import_rows(company_id,import_id,row_number,raw_columns,metering_point_external_id,matched_metering_point_id,matched_customer_id,matched_customer_site_id,match_status,discrepancy_reasons)
  VALUES(c,import_id,i,raw_columns,cols[2],point.id,point.customer_id,coalesce(point.customer_site_id,point.site_id),CASE WHEN point.id IS NULL THEN 'unmatched' WHEN cardinality(reasons)>0 THEN 'discrepancy' ELSE 'matched' END,reasons) RETURNING id INTO import_row_id;
  IF cardinality(reasons)>0 THEN
   discrepancy_count:=discrepancy_count+1;
   INSERT INTO public.ai_list_discrepancies(company_id,import_id,import_row_id,discrepancy_type,severity,current_values,imported_values,status)
   VALUES(c,import_id,import_row_id,reasons[1],CASE WHEN point.id IS NULL THEN 'warning' ELSE 'info' END,current_values,raw_columns,'open');
  END IF;
  row_count:=row_count+1;
 END LOOP;
 UPDATE public.ai_list_imports x SET status=CASE WHEN reconciliation.discrepancy_count>0 THEN 'review_required' ELSE 'matched' END,discrepancy_count=reconciliation.discrepancy_count WHERE x.id=reconciliation.import_id AND x.company_id=c;
 result:=jsonb_build_object('status','applied','importId',import_id,'rowCount',row_count,'discrepancyCount',discrepancy_count);
 INSERT INTO gridex_ai_processing.reconciliation_receipts(source_message_id,company_id,source_payload_hash,import_id,processing_decision_id,actor_user_id,header_basis,result)
 VALUES(source_id,c,expected_hash,import_id,(assessment#>>'{decision,id}')::uuid,actor,header_basis,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_ai_processing.reconcile_source_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.gridex_ai_bi_reconcile_source_v1(p_company_id uuid,p_actor_user_id uuid,p_source_message_id uuid,p_source_payload_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ai_bi_processing_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_ai_processing.reconcile_source_v1(p_company_id,p_actor_user_id,p_source_message_id,p_source_payload_hash);
END $$;
REVOKE ALL ON FUNCTION public.gridex_ai_bi_reconcile_source_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_ai_bi_reconcile_source_v1(uuid,uuid,uuid,text) TO service_role;
COMMENT ON TABLE gridex_ai_processing.reconciliation_receipts IS 'Immutable whole-source atomic reconciliation outcomes only; no historical receipts synthesized and no masterdata update authority.';
COMMIT;
