-- FINDINGS F46 (owner decision 2026-10-20): a new agreement's requested
-- metering method (Z03) came only from an uploaded, separately reviewed source
-- signed by an external issuer key that no application path can create, so no
-- new agreement could ever be sent. The method is a term of the signed
-- agreement itself: a quarter-hour price product (signed price snapshot
-- interval_resolution='quarterly') requests quarter-hour metering (F),
-- otherwise the grid owner decides (G). This owner derives the declaration from
-- the archived, verified signed agreement PDF (bytes must hash to the
-- contract's document_sha256) and the signed price snapshot, with the same
-- point, party and network checks as a reviewed declaration. A contract that
-- has, or had, its own declaration keeps that path; nothing is derived for it.
BEGIN;

CREATE FUNCTION gridex_metering_method_changes.gs1_point_v1(point text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT point~'^[0-9]{18}$' AND (10-(SELECT sum(substr(point,i,1)::integer*CASE WHEN (18-i)%2=1 THEN 3 ELSE 1 END) FROM generate_series(1,17) i)%10)%10=substr(point,18,1)::integer
$$;

CREATE FUNCTION public.ediel_derive_contract_requested_method_v1(p_company_id uuid,p_contract_id uuid,p_actor_user_id uuid,p_environment text,p_agreement_original bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE contract public.customer_contracts%rowtype;point public.metering_points%rowtype;site public.customer_sites%rowtype;n integer;sender text;header jsonb;network jsonb;
 point_id text;interval text;subtype text;method text;source jsonb;source_bytes bytea;declaration uuid;
BEGIN
 IF (p_environment IN('test','production')) IS NOT TRUE THEN RAISE EXCEPTION 'contract_requested_method_environment_required';END IF;
 PERFORM gridex_ai_processing.authorize_purpose_phase_v1(p_company_id,p_actor_user_id,'origination',NULL);
 PERFORM pg_advisory_xact_lock(hashtextextended('contract-method-request:'||p_company_id::text||':'||p_contract_id::text,0));
 IF EXISTS(SELECT FROM gridex_metering_method_changes.contract_request_declarations d WHERE d.company_id=p_company_id AND d.contract_id=p_contract_id AND d.environment=p_environment) THEN
  RETURN jsonb_build_object('status','unchanged');END IF;
 SELECT * INTO contract FROM public.customer_contracts WHERE id=p_contract_id AND company_id=p_company_id FOR SHARE;
 IF contract.id IS NULL OR contract.signed_at IS NULL OR nullif(contract.signed_version,'') IS NULL OR (contract.status IN('signed','active')) IS NOT TRUE OR contract.document_sha256 IS NULL THEN
  RETURN jsonb_build_object('status','held','missing',ARRAY['current_signed_new_customer_agreement']);END IF;
 IF p_agreement_original IS NULL OR encode(sha256(p_agreement_original),'hex') IS DISTINCT FROM contract.document_sha256
  OR NOT EXISTS(SELECT FROM public.customer_contract_documents d WHERE d.company_id=p_company_id AND d.customer_contract_id=contract.id AND d.document_type='signed_contract_pdf' AND d.document_sha256=contract.document_sha256 AND d.verified_at IS NOT NULL)
 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['archived_verified_signed_agreement_original']);END IF;
 SELECT * INTO point FROM public.metering_points WHERE id=contract.metering_point_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO site FROM public.customer_sites WHERE id=coalesce(contract.customer_site_id,contract.site_id) AND company_id=p_company_id FOR SHARE;
 point_id:=coalesce(nullif(point.ediel_metering_point_id,''),nullif(point.meter_point_id,''));
 IF point.id IS NULL OR site.id IS NULL OR point.customer_id IS DISTINCT FROM contract.customer_id OR site.customer_id IS DISTINCT FROM contract.customer_id
  OR coalesce(point.customer_site_id,point.site_id) IS DISTINCT FROM site.id OR point.customer_site_id IS NOT NULL AND point.customer_site_id IS DISTINCT FROM site.id OR point.site_id IS NOT NULL AND point.site_id IS DISTINCT FROM site.id
  OR nullif(point.grid_owner_ediel_id,'') IS NULL OR nullif(point.grid_area_code,'') IS NULL
 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_signed_agreement_revision_original_customer_site_point']);END IF;
 -- A GS1 metering point identity (18 digits, valid check digit) is code list 3055 agency 9.
 IF gridex_metering_method_changes.gs1_point_v1(point_id) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['gs1_metering_point_identity']);END IF;
 PERFORM id FROM public.tenant_actor_identifiers WHERE company_id=p_company_id AND environment=p_environment ORDER BY id FOR SHARE;
 SELECT count(DISTINCT actor_id),min(identifier_value) INTO n,sender FROM public.tenant_actor_identifiers WHERE company_id=p_company_id AND environment=p_environment AND identifier_type='EdielId' AND valid_from<=clock_timestamp() AND (valid_to IS NULL OR clock_timestamp()<valid_to);
 IF n<>1 OR nullif(sender,'') IS NULL OR (SELECT count(DISTINCT identifier_value) FROM public.tenant_actor_identifiers WHERE company_id=p_company_id AND environment=p_environment AND identifier_type='EdielId' AND valid_from<=clock_timestamp() AND (valid_to IS NULL OR clock_timestamp()<valid_to))<>1
 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_legal_supplier_agreement_scope_changed']);END IF;
 network:=gridex_network_registry_sources.network_for_company_v1(p_company_id,point.grid_owner_ediel_id,p_environment);
 IF network->>'status' IS DISTINCT FROM 'authorized' THEN RETURN jsonb_build_object('status','held','missing',ARRAY[coalesce(network->>'blocker','authenticated_versioned_network_owner_basis_required')]);END IF;
 header:=gridex_ai_processing.header_company_basis_v1(p_company_id,p_environment,sender,point.grid_owner_ediel_id);
 IF header->>'legalActorId' IS NULL OR header->>'legalSupplier' IS DISTINCT FROM sender THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_legal_supplier_agreement_scope_changed']);END IF;
 interval:=contract.price_snapshot->>'interval_resolution';
 subtype:=CASE WHEN interval='quarterly' THEN 'F' ELSE 'G' END;
 method:=gridex_metering_method_changes.canonical_tuple_projection_v1()#>>ARRAY[subtype,'method'];
 IF gridex_metering_method_changes.requested_method_supported_v1(method) IS NOT TRUE THEN RAISE EXCEPTION 'contract_requested_method_projection_required';END IF;
 source:=jsonb_build_object('format','gridex_signed_agreement_requested_method_v1','contractId',contract.id,'contractRevision',contract.signed_version,
  'agreementSha256',contract.document_sha256,'priceSnapshotIntervalResolution',interval,'subtype',subtype,'requestedMethod',method);
 source_bytes:=convert_to(source::text,'UTF8');
 INSERT INTO gridex_metering_method_changes.contract_request_declarations(company_id,environment,contract_id,contract_revision,protected_contract_hash,customer_id,site_id,metering_point_id,
  legal_actor_id,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,requested_method,agreement_original,agreement_sha256,source_reference,source_version,source_original,source_sha256,approved_by,approved_at)
 VALUES(p_company_id,p_environment,contract.id,contract.signed_version,gridex_received_sources.production_contract_hash_v1(contract),contract.customer_id,site.id,point.id,
  (header->>'legalActorId')::uuid,sender,point.grid_owner_ediel_id,point_id,'9',point.grid_area_code,method,p_agreement_original,contract.document_sha256,
  'signed_contract_product:'||contract.id::text,contract.signed_version,source_bytes,encode(sha256(source_bytes),'hex'),p_actor_user_id,clock_timestamp())
 RETURNING id INTO declaration;
 RETURN jsonb_build_object('status','derived','declarationId',declaration,'requestedMethod',method,'subtype',subtype);
END$$;
REVOKE ALL ON FUNCTION public.ediel_derive_contract_requested_method_v1(uuid,uuid,uuid,text,bytea) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_derive_contract_requested_method_v1(uuid,uuid,uuid,text,bytea) TO service_role;
REVOKE ALL ON FUNCTION gridex_metering_method_changes.gs1_point_v1(text) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
