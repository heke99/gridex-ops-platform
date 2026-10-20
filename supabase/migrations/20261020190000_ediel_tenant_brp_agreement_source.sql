-- FINDINGS F44 (owner decision 2026-10-20): field 262 of a new agreement's Z03
-- comes from the tenant's balance responsible party chosen at onboarding.
-- Until now only a per-contract signed declaration (with a registry ground that
-- no application path can create) qualified, so no first supply could ever be
-- sent. The tenant choice is a dated version in ediel_brp_settings; the version
-- valid on the supply start is used, the BRP must be an active, verified
-- balance_responsible actor with one verified Ediel ID in the actor registry,
-- and the point/party scope is the contract's own authenticated requested-method
-- source. A contract that has (or had) its own declaration keeps that path.
-- Bodies are rewritten with metadata/OID preserved, like 20261001142600.
BEGIN;

CREATE FUNCTION gridex_brp_sources.tenant_agreement_source_v1(c uuid,ct uuid,env text,customer uuid,site uuid,point uuid,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE contract public.customer_contracts%rowtype;mp public.metering_points%rowtype;cs public.customer_sites%rowtype;m gridex_metering_method_changes.contract_request_declarations%rowtype;s public.ediel_brp_settings%rowtype;network jsonb;header jsonb;day date;n integer;brp_actor uuid;
BEGIN
 day:=(p_at AT TIME ZONE 'Etc/GMT-1')::date;
 SELECT * INTO contract FROM public.customer_contracts WHERE id=ct AND company_id=c FOR SHARE;
 SELECT * INTO mp FROM public.metering_points WHERE id=point AND company_id=c FOR SHARE;
 SELECT * INTO cs FROM public.customer_sites WHERE id=site AND company_id=c FOR SHARE;
 IF contract.id IS NULL OR mp.id IS NULL OR cs.id IS NULL OR contract.signed_at IS NULL OR nullif(contract.signed_version,'') IS NULL OR (contract.status IN('signed','active')) IS NOT TRUE
  OR contract.customer_id IS DISTINCT FROM customer OR contract.metering_point_id IS DISTINCT FROM point OR coalesce(contract.customer_site_id,contract.site_id) IS DISTINCT FROM site
  OR contract.customer_site_id IS NOT NULL AND contract.customer_site_id IS DISTINCT FROM site OR contract.site_id IS NOT NULL AND contract.site_id IS DISTINCT FROM site
  OR mp.customer_id IS DISTINCT FROM customer OR cs.customer_id IS DISTINCT FROM customer OR coalesce(mp.customer_site_id,mp.site_id) IS DISTINCT FROM site
  OR nullif(coalesce(nullif(mp.ediel_metering_point_id,''),mp.meter_point_id),'') IS NULL OR nullif(mp.grid_owner_ediel_id,'') IS NULL OR nullif(mp.grid_area_code,'') IS NULL
 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_current_signed_contract_point_scope']);END IF;
 SELECT count(*) INTO n FROM gridex_metering_method_changes.contract_request_declarations a WHERE a.company_id=c AND a.contract_id=ct AND a.environment=env AND a.approved_at<=statement_timestamp()
  AND NOT EXISTS(SELECT FROM gridex_metering_method_changes.contract_request_declarations child WHERE child.previous_declaration_id=a.id AND child.approved_at<=statement_timestamp())
  AND NOT EXISTS(SELECT FROM gridex_metering_method_changes.contract_request_revocations r WHERE r.declaration_id=a.id);
 IF n<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unique_authentic_new_agreement_requested_method_declaration']);END IF;
 SELECT * INTO m FROM gridex_metering_method_changes.contract_request_declarations a WHERE a.company_id=c AND a.contract_id=ct AND a.environment=env AND a.approved_at<=statement_timestamp()
  AND NOT EXISTS(SELECT FROM gridex_metering_method_changes.contract_request_declarations child WHERE child.previous_declaration_id=a.id AND child.approved_at<=statement_timestamp())
  AND NOT EXISTS(SELECT FROM gridex_metering_method_changes.contract_request_revocations r WHERE r.declaration_id=a.id) FOR SHARE;
 IF m.customer_id IS DISTINCT FROM customer OR m.site_id IS DISTINCT FROM site OR m.metering_point_id IS DISTINCT FROM point OR m.contract_revision IS DISTINCT FROM contract.signed_version
  OR m.point_id IS DISTINCT FROM coalesce(nullif(mp.ediel_metering_point_id,''),nullif(mp.meter_point_id,'')) OR m.legal_receiver_id IS DISTINCT FROM mp.grid_owner_ediel_id OR m.grid_area_code IS DISTINCT FROM mp.grid_area_code
 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_current_requested_method_point_scope']);END IF;
 PERFORM x.id FROM public.ediel_brp_settings x WHERE x.company_id=c AND x.environment=env ORDER BY x.id FOR SHARE;
 SELECT count(*) INTO n FROM public.ediel_brp_settings x WHERE x.company_id=c AND x.environment=env AND x.is_active AND nullif(btrim(x.brp_ediel_id),'') IS NOT NULL
  AND x.valid_from IS NOT NULL AND x.valid_from<=day AND (x.valid_to IS NULL OR x.valid_to>=day);
 IF n<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unique_dated_tenant_brp_agreement_at_start']);END IF;
 SELECT * INTO s FROM public.ediel_brp_settings x WHERE x.company_id=c AND x.environment=env AND x.is_active AND nullif(btrim(x.brp_ediel_id),'') IS NOT NULL
  AND x.valid_from IS NOT NULL AND x.valid_from<=day AND (x.valid_to IS NULL OR x.valid_to>=day);
 IF s.brp_ediel_id IS DISTINCT FROM btrim(s.brp_ediel_id) OR length(s.brp_ediel_id)>35 OR s.brp_ediel_id~'[[:cntrl:]]' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unique_dated_tenant_brp_agreement_at_start']);END IF;
 PERFORM i.id FROM public.platform_actor_identifiers i WHERE i.identifier_value=s.brp_ediel_id ORDER BY i.id FOR SHARE;
 SELECT count(DISTINCT i.actor_id),min(i.actor_id::text)::uuid INTO n,brp_actor FROM public.platform_actor_identifiers i WHERE lower(i.identifier_type) IN('edielid','ediel_id') AND i.identifier_value=s.brp_ediel_id AND i.is_verified
  AND (i.valid_from IS NULL OR i.valid_from<=day) AND (i.valid_to IS NULL OR i.valid_to>=day);
 IF n<>1 OR NOT EXISTS(SELECT FROM public.platform_market_actors a WHERE a.id=brp_actor AND a.status='active' AND a.match_status='verified')
  OR NOT EXISTS(SELECT FROM public.platform_actor_roles r WHERE r.actor_id=brp_actor AND r.actor_role='balance_responsible' AND r.is_active)
 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['registry_verified_balance_responsible']);END IF;
 network:=gridex_network_registry_sources.network_for_company_v1(c,m.legal_receiver_id,env);
 IF network->>'status' IS DISTINCT FROM 'authorized' THEN RETURN jsonb_build_object('status','held','missing',ARRAY[coalesce(network->>'blocker','authenticated_current_brp_and_network_registry')]);END IF;
 header:=gridex_ai_processing.header_company_basis_v1(c,env,m.legal_sender_id,m.legal_receiver_id);
 IF header->>'legalActorId' IS DISTINCT FROM m.legal_actor_id::text THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_current_legal_supplier_brp_agreement']);END IF;
 RETURN jsonb_build_object('status','authorized','sourceKind','tenant_brp_agreement','companyId',c,'environment',env,'contractId',ct,'customerId',customer,'siteId',site,'meteringPointId',point,'at',p_at,'supplyPeriodId',NULL,
  'brpEdielId',s.brp_ediel_id,'pointId',m.point_id,'identityAgency',m.identity_agency,'legalActorId',m.legal_actor_id,'legalSenderId',m.legal_sender_id,'legalReceiverId',m.legal_receiver_id,'gridArea',m.grid_area_code,
  'tenantBrpSettingId',s.id,'brpActorId',brp_actor,'sourceReference','ediel_brp_settings:'||s.id::text,'sourceVersion',s.valid_from::text,
  'sourceDigest',encode(sha256(convert_to(jsonb_build_object('id',s.id,'companyId',s.company_id,'environment',s.environment,'brpEdielId',s.brp_ediel_id,'validFrom',s.valid_from)::text,'UTF8')),'hex'),
  'registryBasis',jsonb_build_object('brpActorId',brp_actor,'requestedMethodDeclarationId',m.id));
END$$;
REVOKE ALL ON FUNCTION gridex_brp_sources.tenant_agreement_source_v1(uuid,uuid,text,uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

DO $rewrite$DECLARE f record;
 targets CONSTANT text[][]:=ARRAY[
  ARRAY['gridex_brp_sources.require_source_v1(uuid,uuid,uuid,text,text,uuid,uuid,uuid,timestamp with time zone,uuid)',
   $n$IF n<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unique_authentic_signed_contract_brp_declaration']);END IF;$n$,
   $r$IF n=0 AND NOT EXISTS(SELECT FROM gridex_brp_sources.contract_declarations x WHERE x.company_id=c AND x.environment=env AND x.contract_id=ct) THEN RETURN gridex_brp_sources.tenant_agreement_source_v1(c,ct,env,customer,site,point,p_at);END IF;IF n<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unique_authentic_signed_contract_brp_declaration']);END IF;$r$],
  ARRAY['gridex_received_sources.switch_brp_source_basis_v1(uuid,uuid,uuid,text)',
   $n$b->>'sourceKind' IS DISTINCT FROM 'signed_contract_brp_declaration'$n$,
   $r$(b->>'sourceKind' IN('signed_contract_brp_declaration','tenant_brp_agreement')) IS NOT TRUE$r$]];
BEGIN
 FOR i IN 1..array_length(targets,1) LOOP
  SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=targets[i][1]::regprocedure;
  IF (length(f.prosrc)-length(replace(f.prosrc,targets[i][2],'')))/length(targets[i][2])<>1 THEN RAISE EXCEPTION 'tenant_brp_source_predecessor_required:%',targets[i][1];END IF;
  EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,targets[i][2],targets[i][3]));
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'tenant_brp_source_metadata_changed:%',targets[i][1];END IF;
 END LOOP;
END$rewrite$;

COMMIT;
