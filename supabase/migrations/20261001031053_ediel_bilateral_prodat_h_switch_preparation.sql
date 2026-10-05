-- H origination reads actual current source/profile before the first request or
-- intent. This read-only receipt only permits rendering; 23248 independently
-- requalifies the physical original and owns all persisted effects atomically.
BEGIN;
CREATE FUNCTION public.ediel_qualify_bilateral_prodat_switch_preparation_v1(p_company_id uuid,p_switch_id uuid,p_actor_user_id uuid,p_environment text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE sw public.supplier_switch_requests%rowtype;point public.metering_points%rowtype;site public.customer_sites%rowtype;customer public.customers%rowtype;contract public.customer_contracts%rowtype;
 g gridex_bilateral_prodat.profile_versions%rowtype;a gridex_bilateral_prodat.artifacts%rowtype;ids uuid[];event_at timestamptz;profile_id uuid;sig text;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();
 IF gridex_bilateral_prodat.actor_v1(p_company_id,p_actor_user_id,'archive') IS NOT TRUE OR p_environment NOT IN('test','production') THEN RETURN NULL;END IF;
 SELECT * INTO sw FROM public.supplier_switch_requests WHERE id=p_switch_id AND company_id=p_company_id FOR SHARE;
 IF sw.id IS NULL OR sw.prodat_variant IS DISTINCT FROM 'H' OR sw.prodat_reason IS DISTINCT FROM 'Z25' OR sw.lifecycle_blocked IS DISTINCT FROM false OR sw.requested_start_date IS NULL
  OR sw.status NOT IN('draft','ready','ready_for_switch','ready_for_z03','z03_ready','validated','prepared','queued','submitted','sent','waiting','waiting_response','waiting_for_z04','awaiting_confirmation')
  OR (sw.outbound_z03_message_id IS NOT NULL AND NOT EXISTS(SELECT FROM gridex_bilateral_prodat.outbound_operations existing WHERE existing.message_id=sw.outbound_z03_message_id AND existing.company_id=p_company_id)) THEN RETURN NULL;END IF;
 SELECT * INTO point FROM public.metering_points WHERE id=sw.metering_point_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO site FROM public.customer_sites WHERE id=coalesce(sw.site_id,sw.customer_site_id) AND company_id=p_company_id FOR SHARE;
 SELECT * INTO customer FROM public.customers WHERE id=sw.customer_id AND company_id=p_company_id FOR SHARE;
 SELECT * INTO contract FROM public.customer_contracts WHERE id=coalesce(sw.customer_contract_id,sw.contract_id) AND company_id=p_company_id FOR SHARE;
 IF point.id IS NULL OR site.id IS NULL OR customer.id IS NULL OR contract.id IS NULL OR point.customer_id IS DISTINCT FROM customer.id OR coalesce(point.customer_site_id,point.site_id) IS DISTINCT FROM site.id OR site.customer_id IS DISTINCT FROM customer.id
  OR contract.customer_id IS DISTINCT FROM customer.id OR contract.metering_point_id IS DISTINCT FROM point.id OR contract.status NOT IN('signed','active') OR contract.signed_at IS NULL OR contract.signed_version IS DISTINCT FROM contract.contract_version
  OR nullif(point.ediel_metering_point_id,'') IS NULL OR nullif(point.grid_owner_ediel_id,'') IS NULL OR nullif(point.grid_area_code,'') IS NULL THEN RETURN NULL;END IF;
 IF (SELECT count(*) FROM public.customer_contracts own WHERE own.company_id=p_company_id AND own.customer_id=customer.id AND own.metering_point_id=point.id AND own.status IN('signed','active') AND own.signed_at IS NOT NULL AND own.signed_version=own.contract_version)<>1 THEN RETURN NULL;END IF;
 sig:=encode(sha256(convert_to(contract.signature_snapshot::text,'UTF8')),'hex');
 IF contract.signature_snapshot_sha256 IS DISTINCT FROM sig OR contract.signature_snapshot->>'company_id' IS DISTINCT FROM p_company_id::text OR contract.signature_snapshot->>'customer_id' IS DISTINCT FROM customer.id::text OR contract.signature_snapshot->>'contract_id' IS DISTINCT FROM contract.id::text
  OR NOT EXISTS(SELECT FROM public.customer_contract_documents doc WHERE doc.company_id=p_company_id AND doc.customer_contract_id=contract.id AND doc.document_type='signed_contract_pdf' AND doc.document_sha256=contract.document_sha256 AND doc.verified_at IS NOT NULL) THEN RETURN NULL;END IF;
 event_at:=gridex_received_sources.permission_time_v1(to_char(sw.requested_start_date,'YYYYMMDD')||'0000');
 SELECT array_agg(v.id ORDER BY v.id) INTO ids FROM gridex_bilateral_prodat.profile_versions v JOIN gridex_bilateral_prodat.origins origin ON origin.ground_id=v.id AND origin.company_id=v.company_id JOIN gridex_bilateral_prodat.artifacts archived ON archived.id=origin.artifact_id AND archived.company_id=v.company_id
 WHERE v.company_id=p_company_id AND v.environment=p_environment AND v.process='normal_start_h' AND v.grid_area_code=point.grid_area_code AND archived.scope->>'legalReceiverId'=point.grid_owner_ediel_id
  AND EXISTS(SELECT FROM jsonb_array_elements(archived.scope#>'{sourceGrammar,profiles}') profile WHERE profile->>'message_code'='Z03' AND profile->>'transaction_subtype'='H' AND profile->>'direction' IN('outbound','both')) AND gridex_bilateral_prodat.ground_current_v1(v.id,p_company_id,event_at) IS TRUE;
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN NULL;END IF;
 SELECT * INTO g FROM gridex_bilateral_prodat.profile_versions WHERE id=ids[1];SELECT archived.* INTO a FROM gridex_bilateral_prodat.origins origin JOIN gridex_bilateral_prodat.artifacts archived ON archived.id=origin.artifact_id AND archived.company_id=origin.company_id WHERE origin.ground_id=g.id;
 SELECT (profile->>'id')::uuid INTO profile_id FROM jsonb_array_elements(a.scope#>'{sourceGrammar,profiles}')profile WHERE profile->>'message_code'='Z03' AND profile->>'direction' IN('outbound','both');
 PERFORM public.gridex_assert_supplier_switch_ready(p_company_id,contract.id);
 RETURN jsonb_build_object('version',1,'owner','immutable-bilateral-prodat-switch-preparation-v1','companyId',p_company_id,'actorUserId',p_actor_user_id,'environment',p_environment,'switchId',sw.id,'pointId',point.id,'objectId',point.ediel_metering_point_id,'customerId',customer.id,'siteId',site.id,'contractId',contract.id,'contractHash',gridex_received_sources.production_contract_hash_v1(contract),'requestedStartDate',sw.requested_start_date,'senderEdielId',a.scope->>'legalSenderId','receiverEdielId',a.scope->>'legalReceiverId','gridAreaCode',point.grid_area_code,'profileVersionId',g.id,'rulePackId',a.scope->>'rulePackId','messageProfileId',profile_id,'sourceVersion',a.scope->>'sourceVersion','sourceHash',a.source_hash,'sourceGrammarHash',a.scope->>'sourceGrammarHash');
END$$;
CREATE FUNCTION public.ediel_read_bilateral_prodat_outbound_original_v1(p_company_id uuid,p_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;cap jsonb;
BEGIN
 PERFORM gridex_bilateral_prodat.lock_source_receipts_v1();SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF m.id IS NULL OR gridex_bilateral_prodat.outbound_required_v1(m.raw_payload) IS NOT TRUE THEN RETURN NULL;END IF;
 PERFORM public.ediel_require_source_bytes_available_v1(p_company_id,p_message_id);PERFORM gridex_bilateral_prodat.require_outbound_original_v1(m,false);
 SELECT capability INTO cap FROM gridex_bilateral_prodat.outbound_operations WHERE message_id=m.id AND company_id=m.company_id;RETURN cap;
END$$;
REVOKE ALL ON FUNCTION public.ediel_read_bilateral_prodat_outbound_original_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_read_bilateral_prodat_outbound_original_v1(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_qualify_bilateral_prodat_switch_preparation_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_qualify_bilateral_prodat_switch_preparation_v1(uuid,uuid,uuid,text) TO service_role;
COMMIT;
