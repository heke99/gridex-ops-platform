-- Real tenant-owned producers for prospective service drafts and claims.
-- A supplied document reference/hash is pending evidence, never a legal approval.
BEGIN;
CREATE SCHEMA gridex_service_administration;
REVOKE ALL ON SCHEMA gridex_service_administration FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_service_administration.commands(
 command_id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES public.companies(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 input jsonb NOT NULL,result jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE gridex_service_administration.commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_service_administration.commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_service_administration.commands FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_service_administration.immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'ediel_service_command_immutable';END $$;
REVOKE ALL ON FUNCTION gridex_service_administration.immutable_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER service_admin_command_immutable BEFORE UPDATE OR DELETE ON gridex_service_administration.commands FOR EACH ROW EXECUTE FUNCTION gridex_service_administration.immutable_v1();
CREATE TRIGGER service_admin_command_no_truncate BEFORE TRUNCATE ON gridex_service_administration.commands FOR EACH STATEMENT EXECUTE FUNCTION gridex_service_administration.immutable_v1();

-- Lifecycle CAS and the scope that authentic approvals assessed are distinct.
-- Existing rows receive NULL, never an invented historical approval version.
ALTER TABLE public.ediel_service_assignments ADD COLUMN scope_basis_version bigint CHECK(scope_basis_version>0);
COMMENT ON COLUMN public.ediel_service_evidence.approved_assignment_version IS 'Prospective immutable assignment scope_basis_version; legacy rows without an exact scope journal remain held.';
CREATE TABLE gridex_service_administration.scope_versions(
 company_id uuid NOT NULL,assignment_id uuid NOT NULL,scope_basis_version bigint NOT NULL CHECK(scope_basis_version>0),scope jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(assignment_id,scope_basis_version),FOREIGN KEY(company_id,assignment_id) REFERENCES public.ediel_service_assignments(company_id,id)
);
ALTER TABLE gridex_service_administration.scope_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_service_administration.scope_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_service_administration.scope_versions FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER service_scope_version_immutable BEFORE UPDATE OR DELETE ON gridex_service_administration.scope_versions FOR EACH ROW EXECUTE FUNCTION gridex_service_administration.immutable_v1();
CREATE TRIGGER service_scope_version_no_truncate BEFORE TRUNCATE ON gridex_service_administration.scope_versions FOR EACH STATEMENT EXECUTE FUNCTION gridex_service_administration.immutable_v1();
CREATE FUNCTION gridex_service_administration.scope_v1(a public.ediel_service_assignments) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' SET timezone='UTC' AS $$
 SELECT jsonb_build_object('companyId',a.company_id,'beneficiaryCompanyId',a.beneficiary_company_id,'providerActorId',a.provider_actor_id,'actorProfileId',a.actor_profile_id,'customerId',a.customer_id,'dsoActorId',a.dso_actor_id,'environment',a.environment,'mode',a.mode,'purpose',a.purpose,'objects',a.object_ids,'products',a.product_ids,'fields',a.field_sets,'dataStart',a.data_start,'dataEnd',a.data_end,'validFrom',a.valid_from,'validTo',a.valid_to)
$$;
REVOKE ALL ON FUNCTION gridex_service_administration.scope_v1(public.ediel_service_assignments) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_service_administration.scope_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.scope_basis_version IS NOT NULL THEN RAISE EXCEPTION 'ediel_service_scope_version_server_owned';END IF;
  NEW.scope_basis_version:=1;
 ELSE
  IF NEW.scope_basis_version IS DISTINCT FROM OLD.scope_basis_version THEN RAISE EXCEPTION 'ediel_service_scope_version_server_owned';END IF;
  IF gridex_service_administration.scope_v1(NEW) IS DISTINCT FROM gridex_service_administration.scope_v1(OLD) THEN
   -- An unjournalled legacy basis remains unknown even after editing it.
   NEW.scope_basis_version:=CASE WHEN OLD.scope_basis_version IS NULL THEN NULL ELSE OLD.scope_basis_version+1 END;
   IF NEW.status NOT IN ('revoked','ended') THEN NEW.status:='held';END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION gridex_service_administration.record_scope_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NEW.scope_basis_version IS NOT NULL AND (TG_OP='INSERT' OR NEW.scope_basis_version IS DISTINCT FROM OLD.scope_basis_version) THEN INSERT INTO gridex_service_administration.scope_versions(company_id,assignment_id,scope_basis_version,scope) VALUES(NEW.company_id,NEW.id,NEW.scope_basis_version,gridex_service_administration.scope_v1(NEW));END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_service_administration.scope_guard_v1(),gridex_service_administration.record_scope_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ediel_assignment_approval_scope_guard BEFORE INSERT OR UPDATE ON public.ediel_service_assignments FOR EACH ROW EXECUTE FUNCTION gridex_service_administration.scope_guard_v1();
CREATE TRIGGER ediel_assignment_record_scope AFTER INSERT OR UPDATE ON public.ediel_service_assignments FOR EACH ROW EXECUTE FUNCTION gridex_service_administration.record_scope_v1();

CREATE OR REPLACE FUNCTION public.ediel_service_assignment_assessment_v1(p_provider_company_id uuid,p_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.ediel_service_assignments%rowtype; missing text[]:='{}'; k text; t timestamptz:=now(); transport_required boolean;
begin
 select * into a from public.ediel_service_assignments where company_id=p_provider_company_id and id=p_assignment_id for share;
 if not found then return jsonb_build_object('status','held','missing',array['assignment_not_found']); end if;
 if a.scope_basis_version is null or not exists(select from gridex_service_administration.scope_versions sv where sv.company_id=a.company_id and sv.assignment_id=a.id and sv.scope_basis_version=a.scope_basis_version and sv.scope=gridex_service_administration.scope_v1(a)) then return jsonb_build_object('status','held','missing',array['authentic_assignment_scope_journal_required']);end if;
 if a.status<>'active' or a.valid_from>t or (a.valid_to is not null and a.valid_to<=t) then missing:=array_append(missing,'assignment_not_active'); end if;
 perform 1 from public.tenant_ediel_profiles x where x.id=a.actor_profile_id and x.company_id=a.company_id for share;
 perform 1 from public.tenant_actor_roles r where r.company_id=a.company_id and r.actor_id=a.provider_actor_id and r.environment=a.environment for share;
 perform 1 from public.tenant_actor_identifiers i where i.company_id=a.company_id and i.environment=a.environment for share;
 perform 1 from public.tenant_counterparty_relations r where r.company_id=a.company_id and r.environment=a.environment and r.relation_type='ediel_transport_agent' for share;
 if not exists(select 1 from public.tenant_ediel_profiles x where x.id=a.actor_profile_id and x.company_id=a.company_id and x.environment=a.environment and x.market='electricity' and x.is_enabled and x.valid_from<=t and (x.valid_to is null or x.valid_to>t)) then missing:=array_append(missing,'provider_profile_not_current'); end if;
 if not exists(select 1 from public.tenant_actor_roles r where r.company_id=a.company_id and r.actor_id=a.provider_actor_id and r.environment=a.environment and r.role_code='energy_service_company' and r.valid_from<=t and (r.valid_to is null or r.valid_to>t)) then missing:=array_append(missing,'provider_legal_esco_role_missing'); end if;
 if not exists(select 1 from public.tenant_actor_identifiers i where i.company_id=a.company_id and i.actor_id=a.provider_actor_id and i.environment=a.environment and i.identifier_type='EdielId' and length(btrim(i.identifier_value))>0 and i.valid_from<=t and (i.valid_to is null or i.valid_to>t)) then missing:=array_append(missing,'provider_legal_identity_missing'); end if;
 -- Mirror the shared canonical tenant identity: one current legal actor/Ediel ID.
 if (select count(distinct (i.actor_id,i.identifier_value)) from public.tenant_actor_identifiers i where i.company_id=a.company_id and i.environment=a.environment and i.identifier_type='EdielId' and i.valid_from<=t and (i.valid_to is null or i.valid_to>t))<>1 then missing:=array_append(missing,'provider_legal_identity_ambiguous'); end if;
 select exists(select 1 from public.tenant_counterparty_relations r where r.company_id=a.company_id and r.environment=a.environment and r.relation_type='ediel_transport_agent' and r.is_enabled and r.counterparty_actor_id<>a.provider_actor_id and r.valid_from<=t and (r.valid_to is null or r.valid_to>t)) into transport_required;
 perform 1 from public.ediel_service_evidence e where e.company_id=a.company_id and e.assignment_id=a.id for share;
 foreach k in array array['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles'] loop
  if not exists(select 1 from public.ediel_service_evidence e where e.company_id=a.company_id and e.assignment_id=a.id and e.kind=k and e.status='verified' and e.approved_assignment_version=a.scope_basis_version and e.valid_from<=t and (e.valid_to is null or e.valid_to>t) and e.approved_at<=t) then missing:=array_append(missing,k); end if;
 end loop;
 if (select count(*) from public.tenant_counterparty_relations r where r.company_id=a.company_id and r.environment=a.environment and r.relation_type='ediel_transport_agent' and r.is_enabled and r.valid_from<=t and (r.valid_to is null or r.valid_to>t))>1 then missing:=array_append(missing,'provider_transport_relation_ambiguous'); end if;
 if transport_required and not exists(select 1 from public.ediel_service_evidence e join public.tenant_counterparty_relations r on r.id=e.transport_relation_id and r.counterparty_actor_id=e.transport_actor_id and r.company_id=a.company_id and r.environment=a.environment and r.relation_type='ediel_transport_agent' and r.is_enabled and r.valid_from<=t and (r.valid_to is null or r.valid_to>t) where e.company_id=a.company_id and e.assignment_id=a.id and e.kind='transport_mandate' and e.status='verified' and e.approved_assignment_version=a.scope_basis_version and e.valid_from<=t and (e.valid_to is null or e.valid_to>t) and e.approved_at<=t) then missing:=array_append(missing,'transport_mandate'); end if;
 if cardinality(missing)>0 then return jsonb_build_object('status','held','missing',missing); end if;
 return jsonb_build_object('status','authorized','providerCompanyId',a.company_id,'providerActorId',a.provider_actor_id,'beneficiaryCompanyId',a.beneficiary_company_id,'assignmentId',a.id,'assignmentVersion',a.version,'environment',a.environment,'customerId',a.customer_id,'dsoActorId',a.dso_actor_id,'mode',a.mode,'purpose',a.purpose);
end;
$$;

CREATE FUNCTION gridex_service_administration.permission_matches_assignment_v1(a public.ediel_service_assignments,p public.metering_permissions) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sender text;receiver text;
BEGIN
 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=a.company_id AND i.environment=a.environment ORDER BY i.id FOR SHARE;
 PERFORM i.id FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id ORDER BY i.id FOR SHARE;
 IF (SELECT count(DISTINCT (i.actor_id,i.identifier_value)) FROM public.tenant_actor_identifiers i WHERE i.company_id=a.company_id AND i.environment=a.environment AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR i.valid_to>now()))<>1 OR (SELECT count(DISTINCT i.identifier_value) FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN ('edielid','ediel_id') AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date))<>1 THEN RETURN false;END IF;
 SELECT i.identifier_value INTO sender FROM public.tenant_actor_identifiers i WHERE i.company_id=a.company_id AND i.environment=a.environment AND i.actor_id=a.provider_actor_id AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR i.valid_to>now()) LIMIT 1;
 SELECT i.identifier_value INTO receiver FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN ('edielid','ediel_id') AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date) LIMIT 1;
 RETURN p.company_id=a.company_id AND p.customer_id=a.customer_id AND sender IS NOT NULL AND receiver IS NOT NULL AND p.grid_owner_ediel_id=receiver AND p.metadata#>>'{marketPermission,legalActor}'=sender AND p.metadata#>>'{marketPermission,dsoActor}'=receiver AND p.metadata#>>'{marketPermission,mode}'=a.mode AND public.ediel_permission_source_is_current_v1(a.company_id,p.id,coalesce(p.inbound_z14_message_id,p.source_z14_message_id)) IS TRUE;
END $$;
REVOKE ALL ON FUNCTION gridex_service_administration.permission_matches_assignment_v1(public.ediel_service_assignments,public.metering_permissions) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION gridex_service_permission.context_v1(c uuid, aid uuid, actor uuid, expected_version bigint, code text, pid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE a public.ediel_service_assignments%rowtype; p public.metering_permissions%rowtype; e public.ediel_service_evidence%rowtype;
 assessment jsonb; objects jsonb; legal_id text; dso_id text; customer_record jsonb; previous_origin gridex_service_permission.origins%rowtype;
BEGIN
 IF c IS NULL OR aid IS NULL OR actor IS NULL OR pid IS NULL OR expected_version IS NULL OR expected_version<1 OR (code IN ('Z13','Z18')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_permission_origin_scope_required'; END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
 OR NOT coalesce(public.gridex_actor_has_company_permission(actor,c,'metering.write'),false) THEN RAISE EXCEPTION 'ediel_permission_origin_actor_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=c AND id=aid;
 -- Same tuple order as the coordinator. The permission cannot be terminated
 -- concurrently with another assignment acquiring/reusing that permission.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(a.company_id::text||':'||a.environment||':'||a.provider_actor_id::text||':'||a.customer_id::text||':'||a.dso_actor_id::text||':'||a.mode,0));
 SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=c AND id=aid FOR SHARE;
 IF a.version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION 'ediel_permission_origin_assignment_stale'; END IF;
 IF a.scope_basis_version IS NULL OR NOT EXISTS(SELECT FROM gridex_service_administration.scope_versions sv WHERE sv.company_id=c AND sv.assignment_id=aid AND sv.scope_basis_version=a.scope_basis_version AND sv.scope=gridex_service_administration.scope_v1(a)) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['authentic_assignment_scope_journal_required']);END IF;
 -- Legal ESCO and its own electricity profile must remain current for BOTH
 -- request and termination; an ended internal assignment does not revoke a
 -- legal actor's authorization checks.
 PERFORM x.id FROM public.tenant_ediel_profiles x WHERE x.company_id=c AND x.id=a.actor_profile_id FOR SHARE;
 PERFORM r.id FROM public.tenant_actor_roles r WHERE r.company_id=c AND r.actor_id=a.provider_actor_id AND r.environment=a.environment ORDER BY r.id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.tenant_ediel_profiles x WHERE x.company_id=c AND x.id=a.actor_profile_id AND x.environment=a.environment AND x.market='electricity' AND x.is_enabled AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()))
 OR NOT EXISTS(SELECT FROM public.tenant_actor_roles r WHERE r.company_id=c AND r.actor_id=a.provider_actor_id AND r.environment=a.environment AND r.role_code='energy_service_company' AND r.valid_from<=now() AND (r.valid_to IS NULL OR r.valid_to>now())) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_provider_electricity_profile_and_esco_role']); END IF;
 PERFORM r.id FROM public.tenant_counterparty_relations r WHERE r.company_id=c AND r.environment=a.environment AND r.relation_type='ediel_transport_agent' ORDER BY r.id FOR SHARE;
 PERFORM ev.id FROM public.ediel_service_evidence ev WHERE ev.company_id=c AND ev.assignment_id=aid ORDER BY ev.id FOR SHARE;
 IF (SELECT count(*) FROM public.tenant_counterparty_relations r WHERE r.company_id=c AND r.environment=a.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=now() AND (r.valid_to IS NULL OR r.valid_to>now()))>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['provider_transport_relation_ambiguous']); END IF;
 IF EXISTS(SELECT FROM public.tenant_counterparty_relations r WHERE r.company_id=c AND r.environment=a.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.counterparty_actor_id<>a.provider_actor_id AND r.valid_from<=now() AND (r.valid_to IS NULL OR r.valid_to>now())) AND NOT EXISTS(SELECT FROM public.ediel_service_evidence ev JOIN public.tenant_counterparty_relations r ON r.company_id=c AND r.id=ev.transport_relation_id AND r.counterparty_actor_id=ev.transport_actor_id AND r.environment=a.environment AND r.relation_type='ediel_transport_agent' AND r.is_enabled AND r.valid_from<=now() AND (r.valid_to IS NULL OR r.valid_to>now()) WHERE ev.company_id=c AND ev.assignment_id=aid AND ev.kind='transport_mandate' AND ev.status='verified' AND ev.approved_assignment_version=a.scope_basis_version AND ev.approved_at<=now() AND ev.valid_from<=now() AND (ev.valid_to IS NULL OR ev.valid_to>now())) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_transport_mandate']); END IF;

 SELECT * INTO STRICT p FROM public.metering_permissions WHERE company_id=c AND id=pid FOR UPDATE;
 IF p.customer_id IS DISTINCT FROM a.customer_id OR NOT EXISTS(SELECT FROM public.ediel_assignment_permission_links l WHERE l.company_id=c AND l.assignment_id=aid AND l.permission_id=pid) THEN RAISE EXCEPTION 'ediel_permission_origin_link_mismatch'; END IF;
 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=a.environment FOR SHARE;
 SELECT min(i.identifier_value) INTO legal_id FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=a.environment AND i.actor_id=a.provider_actor_id AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR i.valid_to>now());
 PERFORM i.id FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id FOR SHARE;
 SELECT min(i.identifier_value) INTO dso_id FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN ('edielid','ediel_id') AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date);
 IF (SELECT count(DISTINCT (i.actor_id,i.identifier_value)) FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=a.environment AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR i.valid_to>now()))<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['provider_legal_identity_ambiguous']); END IF;
 IF nullif(legal_id,'') IS NULL OR nullif(dso_id,'') IS NULL OR (SELECT count(DISTINCT i.identifier_value) FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=a.environment AND i.actor_id=a.provider_actor_id AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR i.valid_to>now()))<>1 OR (SELECT count(DISTINCT i.identifier_value) FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN ('edielid','ediel_id') AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date))<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_unique_legal_sender_and_dso_identity']); END IF;
 SELECT to_jsonb(x) INTO customer_record FROM public.customers x WHERE x.id=a.customer_id AND x.company_id=c FOR SHARE;
 PERFORM x.id FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid FOR SHARE;
 IF code='Z13' THEN
  assessment:=public.ediel_service_assignment_assessment_v1(c,aid);
  IF assessment->>'status' IS DISTINCT FROM 'authorized' THEN RETURN assessment; END IF;
  IF (p.status IN ('draft','z13_ready','z13_sent','waiting_for_customer_approval')) IS NOT TRUE OR (p.status IN ('z13_sent','waiting_for_customer_approval') AND p.outbound_z13_message_id IS NULL) OR (p.source_z13_message_id IS NOT NULL AND p.source_z13_message_id IS DISTINCT FROM p.outbound_z13_message_id) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['request_permission_state']); END IF;
  SELECT * INTO e FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid AND x.kind='end_user_contract' AND x.status='verified' AND x.approved_assignment_version=a.scope_basis_version AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) AND x.approved_at<=now() AND x.permission_purpose_code IS NOT NULL AND nullif(x.permission_reporting_frequency,'') IS NOT NULL ORDER BY x.id LIMIT 1;
  IF NOT FOUND OR (SELECT count(DISTINCT (x.permission_purpose_code,x.permission_reporting_frequency,x.permission_request_grid_area,x.permission_reporting_term_kind,x.permission_customer_classification)) FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid AND x.kind='end_user_contract' AND x.status='verified' AND x.approved_assignment_version=a.scope_basis_version AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) AND x.approved_at<=now())<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_assessed_permission_reporting_tuple']); END IF;
  IF cardinality(a.product_ids)<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['single_source_defined_request_product']); END IF;
  IF nullif(e.permission_request_grid_area,'') IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_defined_request_grid_area']); END IF;
  IF e.permission_reporting_term_kind IS NULL OR e.permission_customer_classification IS NULL OR (e.permission_reporting_term_kind='bounded' AND a.data_end IS NULL) OR (e.permission_reporting_term_kind='indefinite' AND (a.data_end IS NOT NULL OR a.mode='VH')) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_declared_reporting_term_and_customer_classification']); END IF;
  IF date_trunc('minute',a.data_start) IS DISTINCT FROM a.data_start OR date_trunc('minute',a.data_end) IS DISTINCT FROM a.data_end THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_minute_precision_reporting_dates']); END IF;
  objects:=jsonb_build_array(jsonb_build_object('point',NULL,'permissionId',NULL,'product',a.product_ids[1],'gridArea',e.permission_request_grid_area,'reportStart',a.data_start,'reportEnd',a.data_end));
 ELSE
  IF a.status IS DISTINCT FROM 'ended' OR a.mode IS DISTINCT FROM 'V' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['ended_fortlopande_assignment']); END IF;
  IF EXISTS(SELECT FROM public.ediel_assignment_permission_links l JOIN public.ediel_service_assignments other ON other.company_id=l.company_id AND other.id=l.assignment_id WHERE l.company_id=c AND l.permission_id=pid AND other.status='active' AND other.valid_from<=now() AND (other.valid_to IS NULL OR other.valid_to>now())) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['permission_still_required_by_active_assignment']); END IF;
  PERFORM s.id FROM public.metering_permission_sites s WHERE s.company_id=c AND s.metering_permission_id=pid ORDER BY s.id FOR SHARE;
  IF (p.status IN ('active','approved','partially_approved')) IS NOT TRUE OR public.ediel_permission_source_is_current_v1(c,pid,coalesce(p.inbound_z14_message_id,p.source_z14_message_id)) IS NOT TRUE OR gridex_service_administration.permission_matches_assignment_v1(a,p) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_source_approved_permission']); END IF;
  SELECT * INTO e FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid AND x.kind='service_contract' AND x.status='verified' AND x.approved_assignment_version=a.scope_basis_version AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) AND x.approved_at<=now() AND x.permission_termination_reason IS NOT NULL AND x.permission_termination_at IS NOT NULL ORDER BY x.id LIMIT 1;
  IF NOT FOUND OR (SELECT count(DISTINCT (x.permission_termination_reason,x.permission_termination_at)) FROM public.ediel_service_evidence x WHERE x.company_id=c AND x.assignment_id=aid AND x.kind='service_contract' AND x.status='verified' AND x.approved_assignment_version=a.scope_basis_version AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) AND x.approved_at<=now())<>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_assessed_permission_termination']); END IF;
  IF p.outbound_z18_message_id IS NOT NULL THEN
   SELECT * INTO previous_origin FROM gridex_service_permission.origins prior WHERE prior.company_id=c AND prior.permission_id=pid AND prior.message_id=p.outbound_z18_message_id AND prior.message_code='Z18';
   IF NOT FOUND OR (NOT(previous_origin.basis->>'evidenceId'=e.id::text AND (previous_origin.basis->>'permissionStateVersion')::bigint=p.market_state_version) AND (p.metadata#>>'{z15,reason}' IS DISTINCT FROM 'Z24' OR p.market_state_version<=(previous_origin.basis->>'permissionStateVersion')::bigint)) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['prior_termination_cycle_not_source_cancelled']); END IF;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('point',s.facility_id,'permissionId',s.metadata->>'permissionId','product',s.metadata->>'product','gridArea',s.grid_area_code,'permissionEnd',e.permission_termination_at) ORDER BY s.facility_id,s.id) INTO objects FROM public.metering_permission_sites s WHERE s.company_id=c AND s.metering_permission_id=pid AND s.status IN ('approved','active');
  IF objects IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['approved_permission_objects']); END IF;
  IF date_trunc('minute',e.permission_termination_at) IS DISTINCT FROM e.permission_termination_at THEN RETURN jsonb_build_object('status','held','missing',ARRAY['source_minute_precision_termination_date']); END IF;
 END IF;
 RETURN jsonb_build_object('status','authorized','companyId',c,'assignmentId',aid,'assignmentVersion',a.version,'scopeBasisVersion',a.scope_basis_version,'permissionId',pid,'permissionStateVersion',p.market_state_version,'code',code,'environment',a.environment,'providerActorId',a.provider_actor_id,'dsoActorId',a.dso_actor_id,'legalSenderId',legal_id,'legalReceiverId',dso_id,'customerId',a.customer_id,'customer',customer_record,'mode',a.mode,'purposeCode',e.permission_purpose_code,'frequency',e.permission_reporting_frequency,'reportingTerm',e.permission_reporting_term_kind,'customerClassification',e.permission_customer_classification,'terminationReason',e.permission_termination_reason,'evidenceId',e.id,'evidenceSha256',e.source_sha256,'evidenceVersion',e.source_version,'objects',objects,'li',CASE WHEN code='Z18' THEN p.rff_li_reference ELSE NULL END);
END $$;


CREATE OR REPLACE FUNCTION public.ediel_beneficiary_series_page_v1(p_beneficiary_company_id uuid,p_actor_user_id uuid,p_grant_id uuid,p_expected_grant_version bigint,p_purpose text,p_series_id uuid,p_fields text[],p_start timestamptz,p_end timestamptz,p_limit integer default 100,p_after_at timestamptz default null,p_after_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.ediel_data_access_grants%rowtype; a public.ediel_service_assignments%rowtype; l public.ediel_assignment_permission_links%rowtype; p public.metering_permissions%rowtype; s public.meter_reading_series%rowtype; payload jsonb; next_cursor jsonb; source_id uuid; source_context jsonb; source_row public.ediel_messages%rowtype; bound_contract jsonb; selected_contract jsonb; source_transaction text; source_sender text; dso_id text;
begin
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=p_beneficiary_company_id AND m.user_id=p_actor_user_id FOR SHARE;
 if not exists(select 1 from public.company_memberships m where m.company_id=p_beneficiary_company_id and m.user_id=p_actor_user_id and m.status='active' and m.is_active and m.accepted_at is not null) or not exists(select 1 from public.user_profiles u where u.id=p_actor_user_id and u.user_status='active') or not coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_beneficiary_company_id,'metering.read'),false) then raise exception 'ediel_beneficiary_forbidden' using errcode='42501'; end if;
 if p_start is null or p_end is null or p_end<=p_start or p_limit is null or p_limit<1 or p_limit>500 or (p_after_at is null)<>(p_after_id is null) or p_fields is null or cardinality(p_fields)=0 or array_position(p_fields,null) is not null then raise exception 'ediel_projection_request_invalid'; end if;
 -- Match the command's assignment-before-grant lock order. Identity is immutable.
 select * into strict g from public.ediel_data_access_grants where id=p_grant_id and beneficiary_company_id=p_beneficiary_company_id;
 -- Discover the owned immutable source first, then lock it before assignment/grant:
 -- the shared legal-context authority takes the same source FOR UPDATE lock.
 SELECT source_ediel_message_id INTO STRICT source_id FROM public.meter_reading_series WHERE company_id=g.company_id AND id=p_series_id;
 source_context:=gridex_ediel_inbound_context.require_v1(g.company_id,source_id);
 SELECT * INTO STRICT source_row FROM public.ediel_messages WHERE company_id=g.company_id AND id=source_id;
 select * into strict a from public.ediel_service_assignments where company_id=g.company_id and id=g.assignment_id for share;
 select * into strict g from public.ediel_data_access_grants where id=p_grant_id and beneficiary_company_id=p_beneficiary_company_id for share;
 if p_expected_grant_version is null or p_expected_grant_version<1 or g.version is distinct from p_expected_grant_version or g.status<>'active' or g.revoked_at is not null or g.valid_from>now() or (g.valid_to is not null and g.valid_to<=now()) then raise exception 'ediel_grant_not_current'; end if;
 if g.beneficiary_company_id is distinct from a.beneficiary_company_id or g.purpose is distinct from a.purpose or not(g.object_ids <@ a.object_ids and g.product_ids <@ a.product_ids and g.fields <@ a.field_sets) or g.data_start<a.data_start or (a.data_end is not null and (g.data_end is null or g.data_end>a.data_end)) or g.valid_from<a.valid_from or (a.valid_to is not null and (g.valid_to is null or g.valid_to>a.valid_to)) then raise exception 'ediel_grant_basis_changed'; end if;
 if public.ediel_service_assignment_assessment_v1(a.company_id,a.id)->>'status' is distinct from 'authorized' then raise exception 'ediel_assignment_not_authorized'; end if;
 if p_purpose is null or p_purpose<>g.purpose or not(p_fields <@ g.fields) or p_start<g.data_start or (g.data_end is not null and p_end>g.data_end) then raise exception 'ediel_projection_outside_grant'; end if;
 select * into strict l from public.ediel_assignment_permission_links where company_id=g.company_id and id=g.permission_link_id and assignment_id=g.assignment_id for share;
 select * into strict p from public.metering_permissions where company_id=g.company_id and id=l.permission_id for share;
 if (p.status in ('active','approved','partially_approved')) is not true or p.customer_id is distinct from a.customer_id or p.source_z14_message_id is null and p.inbound_z14_message_id is null then raise exception 'ediel_market_permission_not_approved'; end if;
 PERFORM x.id FROM public.metering_permission_sites x WHERE x.company_id=g.company_id AND x.metering_permission_id=p.id ORDER BY x.id FOR SHARE;
 if public.ediel_permission_source_is_current_v1(g.company_id,p.id,coalesce(p.inbound_z14_message_id,p.source_z14_message_id)) is not true then raise exception 'ediel_permission_source_not_current'; end if;
 if gridex_service_administration.permission_matches_assignment_v1(a,p) is not true then raise exception 'ediel_permission_legal_actor_mismatch';end if;
 select * into strict s from public.meter_reading_series where company_id=g.company_id and id=p_series_id for share;
 if s.message_code is distinct from 'E66' or s.series_kind is distinct from 'actual' or (s.external_metering_point_id=any(g.object_ids)) is not true or (s.product_id=any(g.product_ids)) is not true or s.period_start is null or s.period_end is null or p_start<s.period_start or p_end>s.period_end then raise exception 'ediel_series_outside_grant'; end if;
 if s.source_ediel_message_id IS DISTINCT FROM source_id OR source_row.environment IS DISTINCT FROM a.environment OR source_row.direction IS DISTINCT FROM 'inbound' OR source_row.message_family IS DISTINCT FROM 'UTILTS' OR source_row.message_code IS DISTINCT FROM 'E66' OR source_context->>'legalActorId' IS DISTINCT FROM a.provider_actor_id::text OR source_context->>'actorRole' IS DISTINCT FROM 'energy_service_company' OR source_context->>'environment' IS DISTINCT FROM a.environment OR source_context->>'direction' IS DISTINCT FROM 'inbound' OR source_context->>'family' IS DISTINCT FROM 'UTILTS' OR source_context->>'code' IS DISTINCT FROM 'E66' THEN RAISE EXCEPTION 'ediel_series_source_actor_not_qualified'; END IF;
 -- Bind the series to its private accepted transaction, never parsed metadata.
 SELECT c.transaction_id,c.contract INTO STRICT source_transaction,selected_contract FROM gridex_utilts_binding.contracts c WHERE c.company_id=g.company_id AND c.series_id=s.id AND c.source_message_id=source_id;
 bound_contract:=gridex_utilts_binding.stored_contract_v1(g.company_id,source_id,source_transaction);
 IF bound_contract IS DISTINCT FROM selected_contract OR bound_contract->>'seriesKind' IS DISTINCT FROM 'actual' OR bound_contract->>'messageCode' IS DISTINCT FROM 'E66' OR EXISTS(SELECT FROM jsonb_array_elements(bound_contract->'observations') o WHERE o->>'externalPoint' IS DISTINCT FROM s.external_metering_point_id OR o->>'productCode' IS DISTINCT FROM s.product_id) THEN RAISE EXCEPTION 'ediel_series_source_contract_mismatch';END IF;
 SELECT min(t#>>'{elements,2,0}') INTO source_sender FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(source_row.raw_payload)) t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='MS';
 SELECT min(i.identifier_value) INTO dso_id FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN ('edielid','ediel_id') AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date);
 IF source_sender IS NULL OR source_sender IS DISTINCT FROM dso_id OR (SELECT count(*) FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(source_row.raw_payload)) t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='MS')<>1 THEN RAISE EXCEPTION 'ediel_series_source_dso_not_qualified';END IF;
 if not exists(select 1 from public.ediel_messages z14 where z14.id=coalesce(p.inbound_z14_message_id,p.source_z14_message_id) and z14.company_id=g.company_id and z14.environment=a.environment and z14.direction='inbound' and z14.message_family='PRODAT' and z14.message_code='Z14') then raise exception 'ediel_permission_source_not_qualified'; end if;
 if not exists(select 1 from public.metering_permission_sites x where x.company_id=g.company_id and x.metering_permission_id=p.id and x.customer_id=a.customer_id and x.facility_id=s.external_metering_point_id and x.status in ('approved','active') and x.metadata->>'source'='inbound_prodat_z14' and x.metadata->>'edielMessageId'=coalesce(p.inbound_z14_message_id,p.source_z14_message_id)::text and x.metadata->>'mode'=case a.mode when 'V' then 'S17' else 'S18' end and x.metadata->>'product'=s.product_id and x.start_at is not null and p_start>=x.start_at and (x.end_at is null or p_end<=x.end_at)) then raise exception 'ediel_permission_object_not_approved'; end if;
 -- Field whitelist is the full projection: raw_transaction/metadata/raw EML are never returned.
 with page as (
  select v.id,v.reading_at,(select jsonb_object_agg(k,value) from jsonb_each(jsonb_build_object('reading_at',v.reading_at,'quantity',v.quantity::text,'unit',v.unit,'quality',v.quality,'qualifier',v.qualifier,'registration_date',s.registration_date,'resolution',s.resolution,'product_id',s.product_id)) as allowed(k,value) where k=any(p_fields)) as projected
  from public.meter_reading_values v where v.company_id=g.company_id and v.series_id=s.id and v.reading_at>=p_start and v.reading_at<p_end and (p_after_at is null or (v.reading_at,v.id)>(p_after_at,p_after_id)) order by v.reading_at,v.id limit p_limit
 ) select coalesce(jsonb_agg(projected order by reading_at,id),'[]'::jsonb),(select jsonb_build_object('readingAt',reading_at,'valueId',id) from page order by reading_at desc,id desc limit 1) into payload,next_cursor from page;
 return jsonb_build_object('grantId',g.id,'grantVersion',g.version,'seriesId',s.id,'rows',payload,'next',case when jsonb_array_length(payload)=p_limit then next_cursor else null end);
end;
$$;

CREATE FUNCTION public.ediel_service_administration_command_v1(p_company_id uuid,p_actor_user_id uuid,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE action text;v_command_id uuid;fields jsonb;allowed text[];a public.ediel_service_assignments%rowtype;g public.ediel_data_access_grants%rowtype;
 n_a public.ediel_service_assignments%rowtype;n_e public.ediel_service_evidence%rowtype;n_g public.ediel_data_access_grants%rowtype;
 prior gridex_service_administration.commands%rowtype;result jsonb;expected_version bigint;detail_text text;message_text text;l public.ediel_assignment_permission_links%rowtype;permission public.metering_permissions%rowtype;
BEGIN
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id FOR SHARE;
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL) OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.write') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_service_administration_actor_forbidden' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('action','commandId','assignmentId','expectedVersion','grantId','expectedGrantVersion','fields')) THEN RAISE EXCEPTION 'ediel_service_command_shape_required';END IF;
 action:=p_input->>'action';v_command_id:=(p_input->>'commandId')::uuid;fields:=coalesce(p_input->'fields','{}');
 IF v_command_id IS NULL OR (action IN ('create_assignment','stage_evidence','create_grant','revoke_grant','approve_assignment','publish_grant')) IS NOT TRUE OR jsonb_typeof(fields) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ediel_service_command_shape_required';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ediel_service_command:'||v_command_id::text,0));
 SELECT * INTO prior FROM gridex_service_administration.commands c WHERE c.command_id=v_command_id FOR SHARE;
 IF FOUND THEN IF prior.company_id IS DISTINCT FROM p_company_id OR prior.actor_user_id IS DISTINCT FROM p_actor_user_id OR prior.input IS DISTINCT FROM p_input THEN RAISE EXCEPTION 'ediel_service_command_scope_conflict';END IF;RETURN prior.result;END IF;
 IF action='create_assignment' THEN
  IF p_input ? 'assignmentId' OR p_input ? 'expectedVersion' OR p_input ? 'grantId' THEN RAISE EXCEPTION 'ediel_service_create_scope_invalid';END IF;
  allowed:=ARRAY['beneficiary_company_id','provider_actor_id','actor_profile_id','customer_id','dso_actor_id','environment','mode','purpose','object_ids','product_ids','field_sets','data_start','data_end','valid_from','valid_to'];
  IF EXISTS(SELECT FROM jsonb_object_keys(fields) k WHERE NOT(k=ANY(allowed))) THEN RAISE EXCEPTION 'ediel_service_assignment_field_forbidden';END IF;
  n_a:=jsonb_populate_record(NULL::public.ediel_service_assignments,fields);
  -- These are administrative draft ownership checks; they grant no market or
  -- beneficiary permission and do not certify the referenced external actor.
  PERFORM x.id FROM public.customers x WHERE x.id=n_a.customer_id AND x.company_id=p_company_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'ediel_service_customer_not_owned';END IF;
  PERFORM x.id FROM public.tenant_ediel_profiles x WHERE x.id=n_a.actor_profile_id AND x.company_id=p_company_id AND x.environment=n_a.environment FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'ediel_service_profile_not_owned';END IF;
  PERFORM x.id FROM public.tenant_actor_identifiers x WHERE x.company_id=p_company_id AND x.environment=n_a.environment AND x.actor_id=n_a.provider_actor_id AND x.identifier_type='EdielId' AND x.valid_from<=now() AND (x.valid_to IS NULL OR x.valid_to>now()) FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'ediel_service_legal_provider_not_owned';END IF;
  INSERT INTO public.ediel_service_assignments(company_id,beneficiary_company_id,provider_actor_id,actor_profile_id,customer_id,dso_actor_id,environment,mode,purpose,object_ids,product_ids,field_sets,data_start,data_end,valid_from,valid_to,status)
   VALUES(p_company_id,n_a.beneficiary_company_id,n_a.provider_actor_id,n_a.actor_profile_id,n_a.customer_id,n_a.dso_actor_id,n_a.environment,n_a.mode,n_a.purpose,n_a.object_ids,n_a.product_ids,n_a.field_sets,n_a.data_start,n_a.data_end,n_a.valid_from,n_a.valid_to,'held') RETURNING * INTO a;
  result:=jsonb_build_object('status','held','assignmentId',a.id,'assignmentVersion',a.version,'missing',jsonb_build_array('authentic_current_owner_approvals_and_scoped_readiness'));
 ELSE
  expected_version:=(p_input->>'expectedVersion')::bigint;
  IF p_input->>'assignmentId' IS NULL OR expected_version IS NULL OR expected_version<1 THEN RAISE EXCEPTION 'ediel_service_assignment_version_required';END IF;
  SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=p_company_id AND id=(p_input->>'assignmentId')::uuid;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(a.company_id::text||':'||a.environment||':'||a.provider_actor_id::text||':'||a.customer_id::text||':'||a.dso_actor_id::text||':'||a.mode,0));
  SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=p_company_id AND id=(p_input->>'assignmentId')::uuid FOR UPDATE;
  IF a.version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION 'ediel_service_assignment_stale';END IF;
  IF action='approve_assignment' THEN
   IF fields<>'{}'::jsonb OR p_input ? 'grantId' OR a.status IS DISTINCT FROM 'held' THEN RAISE EXCEPTION 'ediel_service_approval_scope_invalid';END IF;
   -- Only actual preexisting verified owner evidence can approve this scope.
   -- A held assessment rolls this status/history write back atomically.
   BEGIN
    UPDATE public.ediel_service_assignments SET status='active' WHERE company_id=p_company_id AND id=a.id RETURNING * INTO a;
    result:=public.ediel_service_assignment_assessment_v1(p_company_id,a.id);
    IF result->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'ediel_service_assignment_approval_held' USING DETAIL=result::text;END IF;
    result:=result||jsonb_build_object('status','approved_waiting_permission','accessGranted',false);
   EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS detail_text=PG_EXCEPTION_DETAIL,message_text=MESSAGE_TEXT;
    IF message_text IS DISTINCT FROM 'ediel_service_assignment_approval_held' THEN RAISE;END IF;
    result:=detail_text::jsonb;
   END;
  ELSIF action='stage_evidence' THEN
   IF p_input ? 'grantId' THEN RAISE EXCEPTION 'ediel_service_evidence_scope_invalid';END IF;
   allowed:=ARRAY['kind','source_reference','source_sha256','source_version','valid_from','valid_to','transport_relation_id','transport_actor_id','permission_purpose_code','permission_reporting_frequency','permission_request_grid_area','permission_reporting_term_kind','permission_customer_classification','permission_termination_reason','permission_termination_at'];
   IF EXISTS(SELECT FROM jsonb_object_keys(fields) k WHERE NOT(k=ANY(allowed))) THEN RAISE EXCEPTION 'ediel_service_evidence_approval_field_forbidden';END IF;
   n_e:=jsonb_populate_record(NULL::public.ediel_service_evidence,fields);
   IF n_e.kind='transport_mandate' THEN PERFORM r.id FROM public.tenant_counterparty_relations r WHERE r.company_id=p_company_id AND r.id=n_e.transport_relation_id AND r.counterparty_actor_id=n_e.transport_actor_id AND r.environment=a.environment AND r.relation_type='ediel_transport_agent' FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'ediel_service_transport_relation_not_owned';END IF;END IF;
   INSERT INTO public.ediel_service_evidence(company_id,assignment_id,kind,source_reference,source_sha256,source_version,valid_from,valid_to,status,transport_relation_id,transport_actor_id,permission_purpose_code,permission_reporting_frequency,permission_request_grid_area,permission_reporting_term_kind,permission_customer_classification,permission_termination_reason,permission_termination_at)
    VALUES(p_company_id,a.id,n_e.kind,n_e.source_reference,n_e.source_sha256,n_e.source_version,n_e.valid_from,n_e.valid_to,'pending',n_e.transport_relation_id,n_e.transport_actor_id,n_e.permission_purpose_code,n_e.permission_reporting_frequency,n_e.permission_request_grid_area,n_e.permission_reporting_term_kind,n_e.permission_customer_classification,n_e.permission_termination_reason,n_e.permission_termination_at) RETURNING * INTO n_e;
   result:=jsonb_build_object('status','pending','assignmentId',a.id,'assignmentVersion',a.version,'evidenceId',n_e.id,'approvalGranted',false);
  ELSIF action='create_grant' THEN
   IF p_input ? 'grantId' THEN RAISE EXCEPTION 'ediel_service_grant_scope_invalid';END IF;
   allowed:=ARRAY['permission_link_id','object_ids','product_ids','fields','data_start','data_end','valid_from','valid_to'];
   IF EXISTS(SELECT FROM jsonb_object_keys(fields) k WHERE NOT(k=ANY(allowed))) THEN RAISE EXCEPTION 'ediel_service_grant_field_forbidden';END IF;
   n_g:=jsonb_populate_record(NULL::public.ediel_data_access_grants,fields);
   INSERT INTO public.ediel_data_access_grants(company_id,beneficiary_company_id,assignment_id,permission_link_id,object_ids,product_ids,fields,purpose,data_start,data_end,valid_from,valid_to,status)
    VALUES(p_company_id,a.beneficiary_company_id,a.id,n_g.permission_link_id,n_g.object_ids,n_g.product_ids,n_g.fields,a.purpose,n_g.data_start,n_g.data_end,n_g.valid_from,n_g.valid_to,'held') RETURNING * INTO g;
   result:=jsonb_build_object('status','held','assignmentId',a.id,'assignmentVersion',a.version,'grantId',g.id,'grantVersion',g.version,'accessGranted',false);
  ELSE
   IF fields<>'{}'::jsonb OR p_input->>'grantId' IS NULL THEN RAISE EXCEPTION 'ediel_service_revoke_scope_invalid';END IF;
   IF (p_input->>'expectedGrantVersion')::bigint IS NULL OR (p_input->>'expectedGrantVersion')::bigint<1 THEN RAISE EXCEPTION 'ediel_grant_version_required';END IF;
   SELECT * INTO STRICT g FROM public.ediel_data_access_grants WHERE company_id=p_company_id AND assignment_id=a.id AND id=(p_input->>'grantId')::uuid FOR UPDATE;
   IF g.version IS DISTINCT FROM (p_input->>'expectedGrantVersion')::bigint THEN RAISE EXCEPTION 'ediel_grant_version_stale';END IF;
   IF action='publish_grant' THEN
    IF g.status IS DISTINCT FROM 'held' OR g.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'ediel_revoked_grant_requires_new_basis';END IF;
    result:=public.ediel_service_assignment_assessment_v1(p_company_id,a.id);
    IF result->>'status' IS DISTINCT FROM 'authorized' THEN RETURN result;END IF;
    SELECT * INTO STRICT l FROM public.ediel_assignment_permission_links WHERE company_id=p_company_id AND id=g.permission_link_id AND assignment_id=a.id FOR SHARE;
    SELECT * INTO STRICT permission FROM public.metering_permissions WHERE company_id=p_company_id AND id=l.permission_id FOR SHARE;
    PERFORM x.id FROM public.metering_permission_sites x WHERE x.company_id=p_company_id AND x.metering_permission_id=permission.id ORDER BY x.id FOR SHARE;
    IF (permission.status IN ('active','approved','partially_approved')) IS NOT TRUE OR permission.customer_id IS DISTINCT FROM a.customer_id OR gridex_service_administration.permission_matches_assignment_v1(a,permission) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('current_source_approved_market_permission'));END IF;
    IF g.valid_from>now() OR (g.valid_to IS NOT NULL AND g.valid_to<=now()) OR g.beneficiary_company_id IS DISTINCT FROM a.beneficiary_company_id OR g.purpose IS DISTINCT FROM a.purpose OR NOT(g.object_ids<@a.object_ids AND g.product_ids<@a.product_ids AND g.fields<@a.field_sets) OR g.data_start<a.data_start OR (a.data_end IS NOT NULL AND (g.data_end IS NULL OR g.data_end>a.data_end)) THEN RAISE EXCEPTION 'ediel_grant_basis_changed';END IF;
    IF EXISTS(SELECT FROM unnest(g.object_ids) object_id CROSS JOIN unnest(g.product_ids) product_id WHERE NOT EXISTS(SELECT FROM public.metering_permission_sites x WHERE x.company_id=p_company_id AND x.metering_permission_id=permission.id AND x.customer_id=a.customer_id AND x.facility_id=object_id AND x.status IN ('approved','active') AND x.metadata->>'source'='inbound_prodat_z14' AND x.metadata->>'edielMessageId'=coalesce(permission.inbound_z14_message_id,permission.source_z14_message_id)::text AND x.metadata->>'mode'=CASE a.mode WHEN 'V' THEN 'S17' ELSE 'S18' END AND x.metadata->>'product'=product_id AND x.start_at IS NOT NULL AND g.data_start>=x.start_at AND (x.end_at IS NULL OR (g.data_end IS NOT NULL AND g.data_end<=x.end_at)))) THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('explicit_approved_object_product_period'));END IF;
    UPDATE public.ediel_data_access_grants SET status='active' WHERE company_id=p_company_id AND id=g.id RETURNING * INTO g;
    result:=jsonb_build_object('status','active','assignmentId',a.id,'assignmentVersion',a.version,'grantId',g.id,'grantVersion',g.version,'accessGranted',true);
   ELSE
   IF g.status<>'revoked' THEN UPDATE public.ediel_data_access_grants SET status='revoked',revoked_at=now() WHERE id=g.id AND company_id=p_company_id RETURNING * INTO g;END IF;
   result:=jsonb_build_object('status','revoked','assignmentId',a.id,'assignmentVersion',a.version,'grantId',g.id,'grantVersion',g.version,'accessGranted',false);
   END IF;
  END IF;
 END IF;
 INSERT INTO gridex_service_administration.commands(command_id,company_id,actor_user_id,input,result) VALUES(v_command_id,p_company_id,p_actor_user_id,p_input,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ediel_service_administration_command_v1(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_service_administration_command_v1(uuid,uuid,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.ediel_coordinate_service_permission_v1(p_provider_company_id uuid,p_assignment_id uuid,p_actor_user_id uuid,p_expected_version bigint,p_command text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.ediel_service_assignments%rowtype; assessment jsonb; permission uuid; sharing integer;
begin
 perform u.id from public.user_profiles u where u.id=p_actor_user_id for share;
 perform m.user_id from public.company_memberships m where m.company_id=p_provider_company_id and m.user_id=p_actor_user_id for share;
 if not exists(select 1 from public.company_memberships m where m.company_id=p_provider_company_id and m.user_id=p_actor_user_id and m.status='active' and m.is_active and m.accepted_at is not null) or not exists(select 1 from public.user_profiles u where u.id=p_actor_user_id and u.user_status='active') or not coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_provider_company_id,'metering.write'),false) then raise exception 'ediel_service_command_forbidden' using errcode='42501'; end if;
 -- Lock the shared market tuple before any assignment row, avoiding A/B lock inversion.
 select * into strict a from public.ediel_service_assignments where company_id=p_provider_company_id and id=p_assignment_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(a.company_id::text||':'||a.environment||':'||a.provider_actor_id::text||':'||a.customer_id::text||':'||a.dso_actor_id::text||':'||a.mode,0));
 select * into strict a from public.ediel_service_assignments where company_id=p_provider_company_id and id=p_assignment_id for update;
 if p_expected_version is null or p_expected_version<1 or a.version is distinct from p_expected_version then raise exception 'ediel_assignment_version_stale'; end if;
 if p_command='end_assignment' then
  update public.ediel_service_assignments set status='ended' where company_id=a.company_id and id=a.id;
  update public.ediel_data_access_grants set status='revoked',revoked_at=coalesce(revoked_at,now()) where company_id=a.company_id and assignment_id=a.id and status<>'revoked';
  select l.permission_id into permission from public.ediel_assignment_permission_links l where l.company_id=a.company_id and l.assignment_id=a.id order by l.created_at desc,l.id desc limit 1;
  select count(*) into sharing from public.ediel_assignment_permission_links l join public.ediel_service_assignments b on b.company_id=l.company_id and b.id=l.assignment_id where l.company_id=a.company_id and l.permission_id=permission and b.id<>a.id and b.status='active' and b.valid_from<=now() and (b.valid_to is null or b.valid_to>now());
  return jsonb_build_object('status',case when permission is not null and sharing=0 then 'market_termination_required' else 'assignment_ended' end,'permissionId',permission);
 elsif p_command is distinct from 'request_access' then raise exception 'ediel_service_command_invalid'; end if;
 assessment:=public.ediel_service_assignment_assessment_v1(a.company_id,a.id);
 if assessment->>'status'<>'authorized' then return assessment||jsonb_build_object('permissionId',null); end if;
 -- Compatibility requires the same market actor, environment, end-user, DSO, purpose, mode and full approved scope.
 select l.permission_id into permission from public.ediel_assignment_permission_links l
 join public.ediel_service_assignments b on b.company_id=l.company_id and b.id=l.assignment_id
 join public.metering_permissions p on p.company_id=l.company_id and p.id=l.permission_id
 where b.company_id=a.company_id and b.environment=a.environment and b.provider_actor_id=a.provider_actor_id and b.customer_id=a.customer_id and b.dso_actor_id=a.dso_actor_id and b.purpose=a.purpose and b.mode=a.mode
 and b.status='active' and b.valid_from<=now() and (b.valid_to is null or b.valid_to>now()) and a.field_sets <@ b.field_sets and public.ediel_service_assignment_assessment_v1(b.company_id,b.id)->>'status'='authorized' and a.object_ids <@ b.object_ids and a.product_ids <@ b.product_ids and a.data_start>=b.data_start and (b.data_end is null or (a.data_end is not null and a.data_end<=b.data_end))
 and p.status in ('draft','z13_ready','z13_sent','waiting_for_customer_approval','approved','partially_approved','z14_received','active')
 order by l.created_at,l.id limit 1;
 if permission is null then
  insert into public.metering_permissions(company_id,customer_id,status,purpose_code,permission_scope,requested_start_date,requested_end_date,metadata)
  values(a.company_id,a.customer_id,'draft',a.purpose,a.mode,(a.data_start at time zone 'Europe/Stockholm')::date,(a.data_end at time zone 'Europe/Stockholm')::date,jsonb_build_object('service_assignment_id',a.id,'provider_actor_id',a.provider_actor_id,'environment',a.environment,'dso_actor_id',a.dso_actor_id,'scope','service_assignment')) returning id into permission;
  insert into public.ediel_assignment_permission_links(company_id,assignment_id,permission_id) values(a.company_id,a.id,permission) on conflict do nothing;
  return jsonb_build_object('status','permission_required','permissionId',permission);
 end if;
 insert into public.ediel_assignment_permission_links(company_id,assignment_id,permission_id) values(a.company_id,a.id,permission) on conflict do nothing;
 return jsonb_build_object('status','reuse_permission','permissionId',permission);
end;
$$;

REVOKE INSERT,UPDATE ON public.ediel_service_assignments,public.ediel_service_evidence,public.ediel_assignment_permission_links,public.ediel_data_access_grants FROM service_role;

CREATE FUNCTION public.ediel_service_administration_read_v1(p_company_id uuid,p_actor_user_id uuid,p_assignment_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE assignments jsonb;evidence jsonb;grants jsonb;history jsonb;
BEGIN
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id FOR SHARE;
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=p_company_id AND m.user_id=p_actor_user_id AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL) OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'metering.read') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_service_administration_actor_forbidden' USING ERRCODE='42501';END IF;
 IF p_assignment_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.ediel_service_assignments a WHERE a.company_id=p_company_id AND a.id=p_assignment_id) THEN RAISE EXCEPTION 'ediel_service_assignment_unavailable';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('assignment',to_jsonb(a),'assessment',public.ediel_service_assignment_assessment_v1(p_company_id,a.id)) ORDER BY a.created_at DESC,a.id),'[]') INTO assignments FROM(SELECT * FROM public.ediel_service_assignments WHERE company_id=p_company_id AND (p_assignment_id IS NULL OR id=p_assignment_id) ORDER BY created_at DESC,id LIMIT 100) a;
 IF p_assignment_id IS NOT NULL THEN
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC,e.id),'[]') INTO evidence FROM(SELECT * FROM public.ediel_service_evidence WHERE company_id=p_company_id AND assignment_id=p_assignment_id ORDER BY created_at DESC,id LIMIT 100) e;
  SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.created_at DESC,g.id),'[]') INTO grants FROM(SELECT * FROM public.ediel_data_access_grants WHERE company_id=p_company_id AND assignment_id=p_assignment_id ORDER BY created_at DESC,id LIMIT 100) g;
  SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id DESC),'[]') INTO history FROM(SELECT * FROM public.ediel_service_history WHERE company_id=p_company_id AND (entity_table='ediel_service_assignments' AND entity_id=p_assignment_id OR entity_table='ediel_service_evidence' AND entity_id IN(SELECT id FROM public.ediel_service_evidence WHERE company_id=p_company_id AND assignment_id=p_assignment_id) OR entity_table='ediel_data_access_grants' AND entity_id IN(SELECT id FROM public.ediel_data_access_grants WHERE company_id=p_company_id AND assignment_id=p_assignment_id)) ORDER BY id DESC LIMIT 100) h;
 END IF;
 RETURN jsonb_build_object('companyId',p_company_id,'assignments',assignments,'evidence',coalesce(evidence,'[]'),'grants',coalesce(grants,'[]'),'history',coalesce(history,'[]'),'marketActivationGranted',false);
END $$;
REVOKE ALL ON FUNCTION public.ediel_service_administration_read_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_service_administration_read_v1(uuid,uuid,uuid) TO service_role;

COMMIT;
