-- P08 / CASE-Z09D-SUPPLIER: a signed/ceased production contract event owns
-- field210 XOR211. DATE projections and an ordinary supplier switch never do.
-- This unseeded evidence ledger has no application approval/write API.
BEGIN;
CREATE TABLE gridex_received_sources.production_contract_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.companies(id),
 environment text NOT NULL CHECK(environment IN ('test','production')), contract_id uuid NOT NULL REFERENCES public.customer_contracts(id),
 customer_id uuid NOT NULL REFERENCES public.customers(id), metering_point_id uuid NOT NULL REFERENCES public.metering_points(id),
 legal_actor_id uuid NOT NULL, dso_actor_id uuid NOT NULL, dso_registry_version text NOT NULL CHECK(length(dso_registry_version)>0), dso_registry_sha256 text NOT NULL CHECK(dso_registry_sha256~'^[a-f0-9]{64}$'), legal_sender_id text NOT NULL, legal_receiver_id text NOT NULL,
 point_id text NOT NULL, identity_agency text NOT NULL CHECK(identity_agency IN ('9','89')), grid_area_code text NOT NULL,
 event_kind text NOT NULL CHECK(event_kind IN ('signed','ceased')), boundary_at timestamptz NOT NULL CHECK(extract(second FROM boundary_at)=0),
 start_event_id uuid REFERENCES gridex_received_sources.production_contract_events(id),
 contract_reference text NOT NULL CHECK(length(contract_reference)>0), contract_revision text NOT NULL CHECK(length(contract_revision)>0),
 protected_contract_hash text NOT NULL CHECK(protected_contract_hash~'^[a-f0-9]{64}$'),
 source_reference text NOT NULL CHECK(length(source_reference)>0), source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),
 source_version text NOT NULL CHECK(length(source_version)>0), approved_by uuid NOT NULL REFERENCES auth.users(id), approved_at timestamptz NOT NULL,
 CHECK((event_kind='signed' AND start_event_id IS NULL) OR (event_kind='ceased' AND start_event_id IS NOT NULL)),
 UNIQUE(company_id,environment,source_reference,source_version)
);
CREATE TABLE gridex_received_sources.production_contract_revocations (
 event_id uuid PRIMARY KEY REFERENCES gridex_received_sources.production_contract_events(id), revoked_at timestamptz NOT NULL,
 source_reference text NOT NULL CHECK(length(source_reference)>0), source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'), actor_user_id uuid NOT NULL
);
CREATE TABLE gridex_received_sources.production_contract_origins (
 event_id uuid PRIMARY KEY REFERENCES gridex_received_sources.production_contract_events(id), intent_id uuid NOT NULL UNIQUE REFERENCES public.ediel_message_intents(id),
 company_id uuid NOT NULL REFERENCES public.companies(id), actor_user_id uuid NOT NULL, outbound_request_id uuid NOT NULL REFERENCES public.outbound_requests(id), message_id uuid UNIQUE REFERENCES public.ediel_messages(id),
 payload_hash text, reserved_at timestamptz NOT NULL DEFAULT now(), CHECK((message_id IS NULL)=(payload_hash IS NULL))
);
CREATE TABLE gridex_received_sources.production_contract_periods (
 start_event_id uuid PRIMARY KEY REFERENCES gridex_received_sources.production_contract_events(id), company_id uuid NOT NULL REFERENCES public.companies(id),
 environment text NOT NULL, contract_id uuid NOT NULL REFERENCES public.customer_contracts(id), customer_id uuid NOT NULL, metering_point_id uuid NOT NULL,
 start_at timestamptz NOT NULL, end_at timestamptz CHECK(end_at>start_at), end_event_id uuid UNIQUE REFERENCES gridex_received_sources.production_contract_events(id)
);
CREATE UNIQUE INDEX production_contract_one_open_period ON gridex_received_sources.production_contract_periods(company_id,environment,contract_id,metering_point_id) WHERE end_event_id IS NULL;
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT unnest(ARRAY['production_contract_events','production_contract_revocations','production_contract_origins','production_contract_periods']) LOOP
 EXECUTE format('ALTER TABLE gridex_received_sources.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_received_sources.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
 FOR t IN SELECT unnest(ARRAY['production_contract_events','production_contract_revocations']) LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gridex_received_sources.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_immutable',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gridex_received_sources.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_no_truncate',t);
 END LOOP;
END $$;
CREATE FUNCTION gridex_received_sources.production_contract_origin_guard_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'production_contract_origin_immutable';END IF;
 IF (to_jsonb(NEW)-ARRAY['message_id','payload_hash']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['message_id','payload_hash'])
 OR OLD.message_id IS NOT NULL OR NEW.message_id IS NULL OR NEW.payload_hash IS NULL THEN RAISE EXCEPTION 'production_contract_origin_immutable';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.production_contract_origin_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER production_contract_origin_immutable BEFORE UPDATE OR DELETE ON gridex_received_sources.production_contract_origins FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.production_contract_origin_guard_v1();
CREATE TRIGGER production_contract_origin_no_truncate BEFORE TRUNCATE ON gridex_received_sources.production_contract_origins FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.production_contract_origin_guard_v1();
CREATE FUNCTION gridex_received_sources.production_contract_revocation_lock_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 -- A revocation cannot race a qualified source read/message binding: all readers
 -- hold SHARE on the same immutable parent until their atomic effect commits.
 PERFORM e.id FROM gridex_received_sources.production_contract_events e WHERE e.id=NEW.event_id FOR UPDATE;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.production_contract_revocation_lock_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER production_contract_revocation_lock BEFORE INSERT ON gridex_received_sources.production_contract_revocations FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.production_contract_revocation_lock_v1();
CREATE FUNCTION gridex_received_sources.production_contract_hash_v1(c public.customer_contracts)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('id',c.id,'companyId',c.company_id,'customerId',c.customer_id,'pointId',c.metering_point_id,
 'contractVersion',c.contract_version,'signedVersion',c.signed_version,'signedAt',c.signed_at,'versionSnapshot',c.version_snapshot)::text,'UTF8')),'hex')
$$;
REVOKE ALL ON FUNCTION gridex_received_sources.production_contract_hash_v1(public.customer_contracts) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ediel_production_contract_source_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e gridex_received_sources.production_contract_events%rowtype;c public.customer_contracts%rowtype;mp public.metering_points%rowtype;ids uuid[];start gridex_received_sources.production_contract_events%rowtype;
BEGIN
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM cm.id FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id FOR SHARE;
 IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id AND u.user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
 OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write'),false)
 THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_execution_actor_unqualified'));END IF;
 SELECT * INTO e FROM gridex_received_sources.production_contract_events WHERE id=p_event_id AND company_id=p_company_id FOR SHARE;
 IF NOT FOUND OR e.approved_at>now() OR EXISTS(SELECT FROM gridex_received_sources.production_contract_revocations r WHERE r.event_id=e.id)
 THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('authentic_production_contract_event_required'));END IF;
 PERFORM customer.id FROM public.customers customer WHERE customer.id=e.customer_id AND customer.company_id=e.company_id FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_owned_customer_required'));END IF;
 SELECT * INTO c FROM public.customer_contracts WHERE id=e.contract_id AND company_id=e.company_id FOR SHARE;
 SELECT * INTO mp FROM public.metering_points WHERE id=e.metering_point_id AND company_id=e.company_id FOR SHARE;
 IF c.id IS NULL OR mp.id IS NULL OR c.customer_id IS DISTINCT FROM e.customer_id OR c.metering_point_id IS DISTINCT FROM e.metering_point_id
 OR mp.customer_id IS DISTINCT FROM e.customer_id OR mp.product_direction IS DISTINCT FROM 'production'
 OR mp.ediel_metering_point_id IS DISTINCT FROM e.point_id OR mp.grid_owner_ediel_id IS DISTINCT FROM e.legal_receiver_id OR mp.grid_area_code IS DISTINCT FROM e.grid_area_code
 OR c.signed_at IS NULL OR nullif(c.signed_version,'') IS NULL OR c.signed_version IS DISTINCT FROM e.contract_revision
 OR gridex_received_sources.production_contract_hash_v1(c) IS DISTINCT FROM e.protected_contract_hash
 THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_current_owner_scope_changed'));END IF;
 PERFORM p.id FROM public.tenant_ediel_profiles p WHERE p.company_id=e.company_id AND p.environment=e.environment ORDER BY p.id FOR SHARE;
 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=e.company_id AND i.environment=e.environment ORDER BY i.id FOR SHARE;
 PERFORM r.id FROM public.tenant_actor_roles r WHERE r.company_id=e.company_id AND r.environment=e.environment ORDER BY r.id FOR SHARE;
 PERFORM i.id FROM public.platform_actor_identifiers i WHERE i.identifier_value=e.legal_receiver_id ORDER BY i.id FOR SHARE;
 PERFORM a.id FROM public.platform_market_actors a WHERE a.id=e.dso_actor_id FOR SHARE;
 PERFORM r.id FROM public.platform_actor_roles r WHERE r.actor_id=e.dso_actor_id ORDER BY r.id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.tenant_ediel_profiles p WHERE p.company_id=e.company_id AND p.environment=e.environment AND p.market='electricity' AND p.is_enabled AND p.valid_from<=now() AND (p.valid_to IS NULL OR now()<p.valid_to))
 OR NOT EXISTS(SELECT FROM public.tenant_actor_roles r WHERE r.company_id=e.company_id AND r.environment=e.environment AND r.actor_id=e.legal_actor_id AND r.role_code='electricity_supplier' AND r.valid_from<=now() AND (r.valid_to IS NULL OR now()<r.valid_to))
 OR (SELECT count(DISTINCT (i.actor_id,i.identifier_value)) FROM public.tenant_actor_identifiers i WHERE i.company_id=e.company_id AND i.environment=e.environment AND i.identifier_type='EdielId' AND i.valid_from<=now() AND (i.valid_to IS NULL OR now()<i.valid_to))<>1
 OR NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.company_id=e.company_id AND i.environment=e.environment AND i.actor_id=e.legal_actor_id AND i.identifier_type='EdielId' AND i.identifier_value=e.legal_sender_id AND i.valid_from<=now() AND (i.valid_to IS NULL OR now()<i.valid_to))
 THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_current_legal_supplier_required'));END IF;
 SELECT array_agg(DISTINCT i.actor_id) INTO ids FROM public.platform_actor_identifiers i WHERE lower(i.identifier_type) IN ('edielid','ediel_id') AND i.identifier_value=e.legal_receiver_id AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR current_date<=i.valid_to);
 IF coalesce(cardinality(ids),0)<>1 OR ids[1] IS DISTINCT FROM e.dso_actor_id
 OR NOT EXISTS(SELECT FROM public.platform_actor_identifiers i WHERE i.actor_id=e.dso_actor_id AND i.identifier_type='EdielId' AND i.identifier_value=e.legal_receiver_id AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR current_date<=i.valid_to))
 OR NOT EXISTS(SELECT FROM public.platform_market_actors a WHERE a.id=e.dso_actor_id AND a.status='active' AND a.match_status='verified')
 OR NOT EXISTS(SELECT FROM public.platform_actor_roles r WHERE r.actor_id=e.dso_actor_id AND r.actor_role='grid_owner' AND r.is_active) THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_verified_dso_identity_required'));END IF;
 IF e.event_kind='ceased' THEN
 SELECT * INTO start FROM gridex_received_sources.production_contract_events WHERE id=e.start_event_id AND company_id=e.company_id FOR SHARE;
 IF start.id IS NULL OR start.event_kind IS DISTINCT FROM 'signed' OR start.environment IS DISTINCT FROM e.environment OR start.contract_id IS DISTINCT FROM e.contract_id OR start.metering_point_id IS DISTINCT FROM e.metering_point_id OR start.customer_id IS DISTINCT FROM e.customer_id OR start.boundary_at>=e.boundary_at OR EXISTS(SELECT FROM gridex_received_sources.production_contract_revocations r WHERE r.event_id=start.id)
 THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_original_start_required'));END IF;
 END IF;
 RETURN jsonb_build_object('status','authorized','companyId',e.company_id,'environment',e.environment,'eventId',e.id,'eventKind',e.event_kind,'sourceDigest',e.source_sha256,'sourceVersion',e.source_version,'sourceReference',e.source_reference,
 'legalActorId',e.legal_actor_id,'legalSenderId',e.legal_sender_id,'legalReceiverId',e.legal_receiver_id,'contractId',e.contract_id,'customerId',e.customer_id,'meteringPointId',e.metering_point_id,'pointId',e.point_id,'identityAgency',e.identity_agency,'gridArea',e.grid_area_code,
 'contractReference',e.contract_reference,'contractRevision',e.contract_revision,'boundaryAt',e.boundary_at);
END $$;
REVOKE ALL ON FUNCTION public.ediel_production_contract_source_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_production_contract_source_v1(uuid,uuid,uuid) TO service_role;
CREATE FUNCTION public.ediel_reserve_production_contract_origin_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_outbound_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;e gridex_received_sources.production_contract_events%rowtype;o gridex_received_sources.production_contract_origins%rowtype;i public.ediel_message_intents%rowtype;period gridex_received_sources.production_contract_periods%rowtype;
BEGIN
 SELECT * INTO e FROM gridex_received_sources.production_contract_events WHERE id=p_event_id AND company_id=p_company_id FOR UPDATE;
 PERFORM mp.id FROM public.metering_points mp WHERE mp.id=e.metering_point_id AND mp.company_id=e.company_id FOR UPDATE;
 b:=public.ediel_production_contract_source_v1(p_company_id,p_event_id,p_actor_user_id);IF b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b;END IF;
 SELECT * INTO i FROM public.ediel_message_intents WHERE id=p_intent_id AND company_id=p_company_id FOR SHARE;
 IF i.id IS NULL OR i.environment IS DISTINCT FROM e.environment OR i.message_family IS DISTINCT FROM 'PRODAT' OR i.message_code IS DISTINCT FROM 'Z09' OR i.customer_id IS DISTINCT FROM e.customer_id OR i.metering_point_id IS DISTINCT FROM e.point_id OR i.operation_id IS DISTINCT FROM e.id
 THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_intent_scope_mismatch'));END IF;
 SELECT * INTO o FROM gridex_received_sources.production_contract_origins WHERE event_id=e.id FOR UPDATE;
 IF FOUND THEN IF o.intent_id IS DISTINCT FROM i.id THEN RAISE EXCEPTION 'production_contract_origin_conflict';END IF;RETURN jsonb_build_object('status','reserved','messageId',o.message_id,'outboundRequestId',o.outbound_request_id);END IF;
 IF NOT EXISTS(SELECT FROM public.outbound_requests r WHERE r.id=p_outbound_request_id AND r.company_id=e.company_id AND r.customer_id=e.customer_id AND r.source_type='manual' AND r.source_id=i.id::text AND r.request_type='customer_masterdata') THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_owned_request_required'));END IF;
 IF e.event_kind='signed' THEN
 IF EXISTS(SELECT FROM gridex_received_sources.production_contract_periods p WHERE p.company_id=e.company_id AND p.environment=e.environment AND p.metering_point_id=e.metering_point_id AND (p.end_at IS NULL OR p.end_at>e.boundary_at)) THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_overlapping_owned_period'));END IF;
 INSERT INTO gridex_received_sources.production_contract_periods(start_event_id,company_id,environment,contract_id,customer_id,metering_point_id,start_at) VALUES(e.id,e.company_id,e.environment,e.contract_id,e.customer_id,e.metering_point_id,e.boundary_at);
 ELSE
 SELECT * INTO period FROM gridex_received_sources.production_contract_periods WHERE start_event_id=e.start_event_id AND company_id=e.company_id FOR UPDATE;
 IF NOT FOUND OR period.end_event_id IS NOT NULL THEN RETURN jsonb_build_object('status','held','missing',jsonb_build_array('production_contract_owned_open_period_required'));END IF;
 UPDATE gridex_received_sources.production_contract_periods SET end_at=e.boundary_at,end_event_id=e.id WHERE start_event_id=period.start_event_id;
 END IF;
 INSERT INTO gridex_received_sources.production_contract_origins(event_id,intent_id,company_id,actor_user_id,outbound_request_id) VALUES(e.id,i.id,e.company_id,p_actor_user_id,p_outbound_request_id);
 RETURN jsonb_build_object('status','reserved','messageId',null,'outboundRequestId',p_outbound_request_id);
END $$;
REVOKE ALL ON FUNCTION public.ediel_reserve_production_contract_origin_v1(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_reserve_production_contract_origin_v1(uuid,uuid,uuid,uuid,uuid) TO service_role;
CREATE FUNCTION gridex_received_sources.bind_production_contract_origin_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_received_sources.production_contract_origins%rowtype;e gridex_received_sources.production_contract_events%rowtype;b jsonb;w jsonb;obj jsonb;tokens jsonb;dates jsonb;
BEGIN
 SELECT * INTO o FROM gridex_received_sources.production_contract_origins WHERE intent_id=NEW.intent_id;
 IF NOT FOUND THEN RETURN NEW;END IF;
 SELECT * INTO e FROM gridex_received_sources.production_contract_events WHERE id=o.event_id FOR SHARE;
 b:=public.ediel_production_contract_source_v1(o.company_id,e.id,o.actor_user_id);IF b->>'status' IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'production_contract_source_changed';END IF;
 SELECT * INTO STRICT o FROM gridex_received_sources.production_contract_origins WHERE intent_id=NEW.intent_id FOR UPDATE;
 w:=gridex_received_sources.prodat_recovery_wire_v1(NEW.raw_payload);tokens:=gridex_received_sources.closure_wire_tokens_v2(NEW.raw_payload);
 IF NEW.company_id IS DISTINCT FROM e.company_id OR NEW.environment IS DISTINCT FROM e.environment OR NEW.direction IS DISTINCT FROM 'outbound' OR NEW.message_family IS DISTINCT FROM 'PRODAT' OR NEW.message_code IS DISTINCT FROM 'Z09' OR NEW.source_operation_id IS DISTINCT FROM e.id::text
 OR NEW.outbound_request_id IS DISTINCT FROM o.outbound_request_id OR NEW.customer_id IS DISTINCT FROM e.customer_id OR NEW.metering_point_id IS DISTINCT FROM e.metering_point_id OR w->>'family' IS DISTINCT FROM 'PRODAT' OR w->>'code' IS DISTINCT FROM 'Z09' OR w->>'legalSender' IS DISTINCT FROM e.legal_sender_id OR w->>'legalReceiver' IS DISTINCT FROM e.legal_receiver_id OR jsonb_array_length(w->'objects') IS DISTINCT FROM 1
 THEN RAISE EXCEPTION 'production_contract_message_scope_mismatch';END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}' IN ('FR','DO') AND (t#>>'{elements,2,1}' IS DISTINCT FROM '160' OR t#>>'{elements,2,2}' IS DISTINCT FROM 'SVK')) THEN RAISE EXCEPTION 'production_contract_legal_party_qualifier_mismatch';END IF;
 obj:=w->'objects'->0;
 IF obj->>'point' IS DISTINCT FROM e.point_id OR obj->>'identityAgency' IS DISTINCT FROM e.identity_agency OR obj->>'reason' IS DISTINCT FROM 'Z70'
 THEN RAISE EXCEPTION 'production_contract_physical_object_mismatch';END IF;
 SELECT jsonb_agg(t->'elements'->1) INTO dates FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}' IN ('92','93','157');
 IF jsonb_array_length(dates) IS DISTINCT FROM 1 OR dates#>>'{0,0}' IS DISTINCT FROM (CASE e.event_kind WHEN 'signed' THEN '92' ELSE '93' END)
 OR dates#>>'{0,1}' IS DISTINCT FROM to_char(e.boundary_at AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI') OR dates#>>'{0,2}' IS DISTINCT FROM '203'
 THEN RAISE EXCEPTION 'production_contract_boundary_mismatch';END IF;
 IF o.message_id IS NOT NULL AND (o.message_id IS DISTINCT FROM NEW.id OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex')) THEN RAISE EXCEPTION 'production_contract_message_already_bound' USING ERRCODE='23505';END IF;
 UPDATE gridex_received_sources.production_contract_origins SET message_id=NEW.id,payload_hash=encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex') WHERE event_id=e.id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.bind_production_contract_origin_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER bind_production_contract_origin AFTER INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.bind_production_contract_origin_v1();
CREATE FUNCTION public.ediel_production_contract_message_basis_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o gridex_received_sources.production_contract_origins%rowtype;m public.ediel_messages%rowtype;b jsonb;
BEGIN
 SELECT * INTO o FROM gridex_received_sources.production_contract_origins WHERE company_id=p_company_id AND message_id=p_message_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF m.intent_id IS DISTINCT FROM o.intent_id OR m.source_operation_id IS DISTINCT FROM o.event_id::text OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'production_contract_bound_payload_changed';END IF;
 b:=public.ediel_production_contract_source_v1(p_company_id,o.event_id,p_actor_user_id);
 IF b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b;END IF;
 RETURN jsonb_build_object('basis',b,'intentId',o.intent_id);
END $$;
REVOKE ALL ON FUNCTION public.ediel_production_contract_message_basis_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_production_contract_message_basis_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
