-- A signed agreement's explicitly declared NEW requested field217 is distinct
-- from an earlier received DSO method. No owner approval/original is seeded;
-- registration remains unavailable until the genuine legal owner is verified.
BEGIN;
CREATE FUNCTION gridex_metering_method_changes.requested_method_supported_v1(method text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT FROM jsonb_each(gridex_metering_method_changes.canonical_tuple_projection_v1()) p WHERE p.value->>'method'=method)$$;
CREATE TABLE gridex_metering_method_changes.contract_request_declarations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),previous_declaration_id uuid UNIQUE REFERENCES gridex_metering_method_changes.contract_request_declarations(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 contract_id uuid NOT NULL REFERENCES public.customer_contracts(id),contract_revision text NOT NULL CHECK(length(contract_revision)>0),protected_contract_hash text NOT NULL CHECK(protected_contract_hash~'^[a-f0-9]{64}$'),
 customer_id uuid NOT NULL REFERENCES public.customers(id),site_id uuid NOT NULL REFERENCES public.customer_sites(id),metering_point_id uuid NOT NULL REFERENCES public.metering_points(id),
 legal_actor_id uuid NOT NULL,legal_sender_id text NOT NULL,legal_receiver_id text NOT NULL,point_id text NOT NULL,identity_agency text NOT NULL CHECK(identity_agency IN('9','89')),grid_area_code text NOT NULL,
 requested_method text NOT NULL CHECK(gridex_metering_method_changes.requested_method_supported_v1(requested_method)),
 agreement_original bytea NOT NULL CHECK(octet_length(agreement_original) BETWEEN 1 AND 10485760),agreement_sha256 text NOT NULL CHECK(agreement_sha256=encode(sha256(agreement_original),'hex')),
 source_reference text NOT NULL CHECK(length(source_reference)>0),source_version text NOT NULL CHECK(length(source_version)>0),source_original bytea NOT NULL CHECK(octet_length(source_original) BETWEEN 1 AND 10485760),source_sha256 text NOT NULL CHECK(source_sha256=encode(sha256(source_original),'hex')),
 approved_by uuid NOT NULL REFERENCES auth.users(id),approved_at timestamptz NOT NULL,
 UNIQUE(company_id,environment,contract_id,source_reference,source_version));
CREATE INDEX contract_request_scope ON gridex_metering_method_changes.contract_request_declarations(company_id,contract_id,environment);
CREATE TABLE gridex_metering_method_changes.contract_request_revocations(declaration_id uuid PRIMARY KEY REFERENCES gridex_metering_method_changes.contract_request_declarations(id),source_reference text NOT NULL CHECK(length(source_reference)>0),source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),actor_user_id uuid NOT NULL REFERENCES auth.users(id),revoked_at timestamptz NOT NULL DEFAULT now());
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['contract_request_declarations','contract_request_revocations'] LOOP
 EXECUTE format('ALTER TABLE gridex_metering_method_changes.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_metering_method_changes.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_metering_method_changes.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER requested_method_source_immutable BEFORE UPDATE OR DELETE ON gridex_metering_method_changes.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
 EXECUTE format('CREATE TRIGGER requested_method_source_no_truncate BEFORE TRUNCATE ON gridex_metering_method_changes.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
END LOOP;END$$;
CREATE FUNCTION gridex_metering_method_changes.contract_declaration_scope_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE prior gridex_metering_method_changes.contract_request_declarations%rowtype;BEGIN
 IF TG_TABLE_NAME='contract_request_revocations' THEN
 SELECT * INTO prior FROM gridex_metering_method_changes.contract_request_declarations WHERE id=NEW.declaration_id;
 IF prior.id IS NULL THEN RAISE EXCEPTION 'contract_request_revocation_original_required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('contract-method-request:'||prior.company_id::text||':'||prior.contract_id::text,0));
 PERFORM id FROM gridex_metering_method_changes.contract_request_declarations WHERE id=NEW.declaration_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'contract_request_revocation_original_required';END IF;
 ELSE
 PERFORM pg_advisory_xact_lock(hashtextextended('contract-method-request:'||NEW.company_id::text||':'||NEW.contract_id::text,0));
 IF NEW.previous_declaration_id IS NOT NULL THEN
 SELECT * INTO prior FROM gridex_metering_method_changes.contract_request_declarations WHERE id=NEW.previous_declaration_id FOR UPDATE;
 IF prior.id IS NULL OR prior.company_id IS DISTINCT FROM NEW.company_id OR prior.environment IS DISTINCT FROM NEW.environment OR prior.contract_id IS DISTINCT FROM NEW.contract_id OR NEW.approved_at<prior.approved_at THEN RAISE EXCEPTION 'contract_request_declaration_own_version_required';END IF;
 END IF;END IF;RETURN NEW;
END$$;
CREATE TRIGGER contract_declaration_scope BEFORE INSERT ON gridex_metering_method_changes.contract_request_declarations FOR EACH ROW EXECUTE FUNCTION gridex_metering_method_changes.contract_declaration_scope_v1();
CREATE TRIGGER contract_request_revocation_scope BEFORE INSERT ON gridex_metering_method_changes.contract_request_revocations FOR EACH ROW EXECUTE FUNCTION gridex_metering_method_changes.contract_declaration_scope_v1();
CREATE FUNCTION gridex_metering_method_changes.contract_request_basis_v1(c uuid,ct uuid,actor uuid,phase text,expected_environment text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d gridex_metering_method_changes.contract_request_declarations%rowtype;contract public.customer_contracts%rowtype;point public.metering_points%rowtype;site public.customer_sites%rowtype;header jsonb;network jsonb;
BEGIN
 IF (phase IN('prepare','send')) IS NOT TRUE THEN RAISE EXCEPTION 'contract_requested_method_phase_required';END IF;
 PERFORM gridex_ai_processing.authorize_purpose_phase_v1(c,actor,CASE phase WHEN 'prepare' THEN 'origination' ELSE 'send' END,NULL);
 SELECT * INTO contract FROM public.customer_contracts WHERE id=ct AND company_id=c FOR SHARE;
 IF contract.id IS NULL OR contract.signed_at IS NULL OR nullif(contract.signed_version,'') IS NULL OR (contract.status IN('signed','active')) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_signed_new_customer_agreement']);END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('contract-method-request:'||c::text||':'||ct::text,0));
 IF (SELECT count(*) FROM gridex_metering_method_changes.contract_request_declarations a WHERE a.company_id=c AND a.contract_id=ct AND (expected_environment IS NULL OR a.environment=expected_environment) AND a.approved_at<=statement_timestamp() AND NOT EXISTS(SELECT FROM gridex_metering_method_changes.contract_request_declarations child WHERE child.previous_declaration_id=a.id AND child.approved_at<=statement_timestamp()) AND NOT EXISTS(SELECT FROM gridex_metering_method_changes.contract_request_revocations r WHERE r.declaration_id=a.id))<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unique_authentic_new_agreement_requested_method_declaration']);END IF;
 SELECT * INTO d FROM gridex_metering_method_changes.contract_request_declarations a WHERE a.company_id=c AND a.contract_id=ct AND (expected_environment IS NULL OR a.environment=expected_environment) AND a.approved_at<=statement_timestamp() AND NOT EXISTS(SELECT FROM gridex_metering_method_changes.contract_request_declarations child WHERE child.previous_declaration_id=a.id AND child.approved_at<=statement_timestamp()) AND NOT EXISTS(SELECT FROM gridex_metering_method_changes.contract_request_revocations r WHERE r.declaration_id=a.id) FOR SHARE;
 SELECT * INTO point FROM public.metering_points WHERE id=d.metering_point_id AND company_id=c FOR SHARE;
 SELECT * INTO site FROM public.customer_sites WHERE id=d.site_id AND company_id=c FOR SHARE;
 IF point.id IS NULL OR site.id IS NULL OR contract.customer_id IS DISTINCT FROM d.customer_id OR contract.metering_point_id IS DISTINCT FROM d.metering_point_id OR coalesce(contract.customer_site_id,contract.site_id) IS DISTINCT FROM d.site_id OR (contract.customer_site_id IS NOT NULL AND contract.customer_site_id IS DISTINCT FROM d.site_id) OR (contract.site_id IS NOT NULL AND contract.site_id IS DISTINCT FROM d.site_id)
 OR contract.signed_version IS DISTINCT FROM d.contract_revision OR gridex_received_sources.production_contract_hash_v1(contract) IS DISTINCT FROM d.protected_contract_hash OR contract.document_sha256 IS DISTINCT FROM d.agreement_sha256
 OR site.customer_id IS DISTINCT FROM d.customer_id OR point.customer_id IS DISTINCT FROM d.customer_id OR coalesce(point.customer_site_id,point.site_id) IS DISTINCT FROM d.site_id OR (point.customer_site_id IS NOT NULL AND point.customer_site_id IS DISTINCT FROM d.site_id) OR (point.site_id IS NOT NULL AND point.site_id IS DISTINCT FROM d.site_id)
 OR coalesce(nullif(point.ediel_metering_point_id,''),nullif(point.meter_point_id,'')) IS DISTINCT FROM d.point_id OR point.grid_owner_ediel_id IS DISTINCT FROM d.legal_receiver_id OR point.grid_area_code IS DISTINCT FROM d.grid_area_code THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_signed_agreement_revision_original_customer_site_point']);END IF;
 network:=gridex_ai_processing.network_registry_basis_v1(d.legal_receiver_id,d.environment);
 IF network->>'status' IS DISTINCT FROM 'authorized' THEN RETURN jsonb_build_object('status','held','missing',ARRAY[coalesce(network->>'blocker','authenticated_versioned_network_owner_basis_required')]);END IF;
 header:=gridex_ai_processing.header_company_basis_v1(c,d.environment,d.legal_sender_id,d.legal_receiver_id);
 IF header->>'legalActorId' IS DISTINCT FROM d.legal_actor_id::text THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_legal_supplier_agreement_scope_changed']);END IF;
 RETURN jsonb_build_object('status','authorized','declarationId',d.id,'companyId',c,'environment',d.environment,'contractId',ct,'contractRevision',d.contract_revision,'protectedContractHash',d.protected_contract_hash,'agreementSha256',d.agreement_sha256,'customerId',d.customer_id,'siteId',d.site_id,'meteringPointId',d.metering_point_id,'pointId',d.point_id,'identityAgency',d.identity_agency,'legalActorId',d.legal_actor_id,'legalSenderId',d.legal_sender_id,'legalReceiverId',d.legal_receiver_id,'gridArea',d.grid_area_code,'requestedMethod',d.requested_method,'sourceReference',d.source_reference,'sourceVersion',d.source_version,'sourceDigest',d.source_sha256);
END$$;
CREATE FUNCTION public.ediel_contract_metering_request_source_v1(p_company_id uuid,p_contract_id uuid,p_actor_user_id uuid,p_environment text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_metering_method_changes.contract_request_basis_v1(p_company_id,p_contract_id,p_actor_user_id,'prepare',p_environment)$$;
-- New F/G source events select the SAME declaration. Existing immutable desired
-- originals and accepted journals are untouched; no historical declaration made.
ALTER TABLE gridex_metering_method_changes.events ADD COLUMN requested_method_declaration_id uuid REFERENCES gridex_metering_method_changes.contract_request_declarations(id);
ALTER FUNCTION gridex_metering_method_changes.context_v1(uuid,uuid,uuid,text) RENAME TO context_before_contract_request_v1;
REVOKE ALL ON FUNCTION gridex_metering_method_changes.context_before_contract_request_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_metering_method_changes.context_v1(c uuid,event uuid,actor uuid,phase text DEFAULT 'origination') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;d jsonb;e gridex_metering_method_changes.events%rowtype;
BEGIN
 b:=gridex_metering_method_changes.context_before_contract_request_v1(c,event,actor,phase);
 IF b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b;END IF;
 SELECT * INTO e FROM gridex_metering_method_changes.events WHERE id=event AND company_id=c;
 IF e.requested_method_declaration_id IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['authentic_new_agreement_requested_method_declaration']);END IF;
 d:=gridex_metering_method_changes.contract_request_basis_v1(c,e.contract_id,actor,CASE phase WHEN 'send' THEN 'send' ELSE 'prepare' END,e.environment);
 IF d->>'status' IS DISTINCT FROM 'authorized' THEN RETURN d;END IF;
 IF d->>'declarationId' IS DISTINCT FROM e.requested_method_declaration_id::text OR d->>'customerId' IS DISTINCT FROM e.customer_id::text OR d->>'siteId' IS DISTINCT FROM b->>'siteId' OR d->>'meteringPointId' IS DISTINCT FROM e.metering_point_id::text OR d->>'legalActorId' IS DISTINCT FROM e.legal_actor_id::text OR d->>'legalSenderId' IS DISTINCT FROM e.legal_sender_id OR d->>'legalReceiverId' IS DISTINCT FROM e.legal_receiver_id OR d->>'pointId' IS DISTINCT FROM e.point_id OR d->>'identityAgency' IS DISTINCT FROM e.identity_agency OR d->>'gridArea' IS DISTINCT FROM e.grid_area_code OR d->>'contractRevision' IS DISTINCT FROM e.contract_revision OR d->>'agreementSha256' IS DISTINCT FROM e.agreement_sha256 OR d->>'requestedMethod' IS DISTINCT FROM b->>'method' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_customer_agreed_method_event_and_signed_declaration']);END IF;
 RETURN b||jsonb_build_object('requestedMethodDeclaration',d);
END$$;
DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_metering_method_changes' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);END LOOP;END$$;
REVOKE ALL ON FUNCTION public.ediel_contract_metering_request_source_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_contract_metering_request_source_v1(uuid,uuid,uuid,text) TO service_role;
COMMIT;
