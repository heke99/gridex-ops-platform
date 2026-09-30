-- AT-Z09B-SUPPLIER. Approved original BRP decision/contract and versioned
-- registry evidence are external inputs. No seed, approval API or global BRP rewrite.
-- The shared supply_period_source_basis_v1 is added by the coordinated later
-- normal-supply migration. No runtime origination occurs during replay.
BEGIN;

CREATE SCHEMA gridex_brp_changes;

REVOKE ALL ON SCHEMA gridex_brp_changes FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE gridex_brp_changes.registry_grounds(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 environment text NOT NULL CHECK(environment IN('test','production')),dso_actor_id uuid NOT NULL,brp_actor_id uuid NOT NULL,
 dso_ediel_id text NOT NULL,brp_ediel_id text NOT NULL,grid_area_code text NOT NULL,
 registry_version text NOT NULL CHECK(length(registry_version)>0),source_reference text NOT NULL CHECK(length(source_reference)>0),source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),
 registry_snapshot jsonb NOT NULL CHECK(jsonb_typeof(registry_snapshot)='object'),approved_by uuid NOT NULL REFERENCES auth.users(id),approved_at timestamptz NOT NULL,
 valid_from timestamptz NOT NULL,valid_to timestamptz CHECK(valid_to>valid_from),UNIQUE(company_id,environment,dso_actor_id,brp_actor_id,grid_area_code,registry_version));

CREATE TABLE gridex_brp_changes.events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL CHECK(environment IN('test','production')),
 supply_period_id uuid NOT NULL REFERENCES public.customer_supply_periods(id),customer_id uuid NOT NULL REFERENCES public.customers(id),metering_point_id uuid NOT NULL REFERENCES public.metering_points(id),
 legal_actor_id uuid NOT NULL,legal_sender_id text NOT NULL,point_id text NOT NULL,identity_agency text NOT NULL CHECK(identity_agency IN('9','89')),registry_ground_id uuid NOT NULL REFERENCES gridex_brp_changes.registry_grounds(id),
 supply_source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),supply_state_version bigint NOT NULL CHECK(supply_state_version>0),
 effective_at timestamptz NOT NULL CHECK(extract(second FROM effective_at)=0),
 brp_contract_reference text NOT NULL CHECK(length(brp_contract_reference)>0),brp_contract_sha256 text NOT NULL CHECK(brp_contract_sha256~'^[a-f0-9]{64}$'),brp_contract_version text NOT NULL CHECK(length(brp_contract_version)>0),
 market_decision_reference text NOT NULL CHECK(length(market_decision_reference)>0),source_reference text NOT NULL CHECK(length(source_reference)>0),source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),source_version text NOT NULL CHECK(length(source_version)>0),
 approved_by uuid NOT NULL REFERENCES auth.users(id),approved_at timestamptz NOT NULL,
 UNIQUE(company_id,environment,supply_period_id,effective_at),UNIQUE(company_id,environment,source_reference,source_version));

CREATE TABLE gridex_brp_changes.revocations(target_kind text NOT NULL CHECK(target_kind IN('event','registry')),target_id uuid NOT NULL,source_reference text NOT NULL CHECK(length(source_reference)>0),source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),actor_user_id uuid NOT NULL REFERENCES auth.users(id),revoked_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(target_kind,target_id));

CREATE TABLE gridex_brp_changes.origins(event_id uuid PRIMARY KEY REFERENCES gridex_brp_changes.events(id),company_id uuid NOT NULL REFERENCES public.companies(id),intent_id uuid UNIQUE NOT NULL REFERENCES public.ediel_message_intents(id),outbound_request_id uuid UNIQUE NOT NULL REFERENCES public.outbound_requests(id),actor_user_id uuid NOT NULL REFERENCES auth.users(id),message_id uuid UNIQUE REFERENCES public.ediel_messages(id),payload_hash text,basis jsonb NOT NULL,intent_binding jsonb NOT NULL,reserved_at timestamptz NOT NULL DEFAULT now(),CHECK((message_id IS NULL)=(payload_hash IS NULL)));

CREATE TABLE gridex_brp_changes.period_versions(event_id uuid PRIMARY KEY REFERENCES gridex_brp_changes.events(id),company_id uuid NOT NULL REFERENCES public.companies(id),environment text NOT NULL,supply_period_id uuid NOT NULL REFERENCES public.customer_supply_periods(id),effective_at timestamptz NOT NULL,brp_actor_id uuid NOT NULL,brp_ediel_id text NOT NULL,source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),source_payload_hash text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,environment,supply_period_id,effective_at));

DO $$DECLARE t text;
BEGIN FOR t IN SELECT unnest(ARRAY['registry_grounds','events','revocations','origins','period_versions']) LOOP EXECUTE format('ALTER TABLE gridex_brp_changes.%I ENABLE ROW LEVEL SECURITY',t);
EXECUTE format('ALTER TABLE gridex_brp_changes.%I FORCE ROW LEVEL SECURITY',t);
EXECUTE format('REVOKE ALL ON gridex_brp_changes.%I FROM PUBLIC,anon,authenticated,service_role',t);
END LOOP;
FOR t IN SELECT unnest(ARRAY['registry_grounds','events','revocations','period_versions']) LOOP EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE
  OR DELETE ON gridex_brp_changes.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_immutable',t);
EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON gridex_brp_changes.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1()',t||'_no_truncate',t);
END LOOP;
END$$;

CREATE FUNCTION gridex_brp_changes.revocation_lock_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$BEGIN IF NEW.target_kind='event' THEN PERFORM id FROM gridex_brp_changes.events WHERE id=NEW.target_id FOR UPDATE;
ELSE PERFORM id FROM gridex_brp_changes.registry_grounds WHERE id=NEW.target_id FOR UPDATE;
END IF;
IF NOT FOUND THEN RAISE EXCEPTION 'brp_revocation_target_unavailable';
END IF;
RETURN NEW;
END$$;

CREATE TRIGGER brp_revocation_lock BEFORE INSERT ON gridex_brp_changes.revocations FOR EACH ROW EXECUTE FUNCTION gridex_brp_changes.revocation_lock_v1();

CREATE FUNCTION gridex_brp_changes.registry_snapshot_v1(dso uuid,brp uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$SELECT jsonb_build_object(
 'actors',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'status',a.status,'matchStatus',a.match_status) ORDER BY a.id),'[]') FROM public.platform_market_actors a WHERE a.id IN(dso,brp)),
 'identifiers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'actorId',i.actor_id,'type',i.identifier_type,'value',i.identifier_value,'verified',i.is_verified,'validFrom',i.valid_from,'validTo',i.valid_to) ORDER BY i.id),'[]') FROM public.platform_actor_identifiers i WHERE i.actor_id IN(dso,brp)
  AND lower(i.identifier_type) IN('edielid','ediel_id')),
 'roles',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'actorId',r.actor_id,'role',r.actor_role,'active',r.is_active) ORDER BY r.id),'[]') FROM public.platform_actor_roles r WHERE r.actor_id IN(dso,brp)
  AND r.actor_role IN('grid_owner','balance_responsible')))$$;

CREATE FUNCTION gridex_brp_changes.context_v1(c uuid,event uuid,actor uuid,notice boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE e gridex_brp_changes.events%rowtype;
g gridex_brp_changes.registry_grounds%rowtype;
mp public.metering_points%rowtype;
supply jsonb;

BEGIN
 PERFORM u.id FROM public.user_profiles u WHERE u.id=actor FOR SHARE;
PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=c
  AND m.user_id=actor FOR SHARE;

 IF c IS NULL
  OR event IS NULL
  OR actor IS NULL
  OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor
  AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c
  AND m.user_id=actor
  AND m.status='active'
  AND m.is_active
  AND m.accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(actor,c,'communication.write') IS NOT TRUE THEN RAISE EXCEPTION 'brp_change_actor_forbidden' USING ERRCODE='42501';
END IF;

 SELECT * INTO e FROM gridex_brp_changes.events WHERE id=event
  AND company_id=c FOR SHARE;

 IF NOT FOUND
  OR e.approved_at>now()
  OR EXISTS(SELECT FROM gridex_brp_changes.revocations WHERE target_kind='event'
  AND target_id=e.id) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['authentic_brp_contract_and_market_decision_event']);
END IF;

 -- Shared supply authority owns every normal/regulated relation and its source
 -- lock order. Status/date or a BRP company setting cannot replace this proof.
 supply:=gridex_received_sources.supply_period_source_basis_v1(c,e.supply_period_id,e.effective_at,e.effective_at+interval '1 minute');

 IF supply IS NULL
  OR supply->>'qualified' IS DISTINCT FROM 'true'
  OR supply->>'customerId' IS DISTINCT FROM e.customer_id::text
  OR supply->>'meteringPointId' IS DISTINCT FROM e.metering_point_id::text
  OR supply->>'legalActorId' IS DISTINCT FROM e.legal_actor_id::text
  OR supply->>'sourceMessageId' IS DISTINCT FROM e.supply_source_message_id::text
  OR (supply->>'marketStateVersion')::bigint IS DISTINCT FROM e.supply_state_version
  OR NOT EXISTS(SELECT FROM public.ediel_messages source WHERE source.id=e.supply_source_message_id
  AND source.company_id=c
  AND source.environment=e.environment
  AND source.direction='inbound') THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_source_approved_supply_relation']);
END IF;

 SELECT * INTO g FROM gridex_brp_changes.registry_grounds WHERE id=e.registry_ground_id
  AND company_id=c
  AND environment=e.environment FOR SHARE;

 IF NOT FOUND
  OR g.approved_at>now()
  OR EXISTS(SELECT FROM gridex_brp_changes.revocations WHERE target_kind='registry'
  AND target_id=g.id)
  OR g.valid_from>e.effective_at
  OR (g.valid_to IS NOT NULL
  AND g.valid_to<=e.effective_at) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['authentic_versioned_dso_brp_registry_ground']);
END IF;

 PERFORM a.id FROM public.platform_market_actors a WHERE a.id IN(g.dso_actor_id,g.brp_actor_id) ORDER BY a.id FOR SHARE;
PERFORM i.id FROM public.platform_actor_identifiers i WHERE i.actor_id IN(g.dso_actor_id,g.brp_actor_id) ORDER BY i.id FOR SHARE;
PERFORM r.id FROM public.platform_actor_roles r WHERE r.actor_id IN(g.dso_actor_id,g.brp_actor_id) ORDER BY r.id FOR SHARE;

 IF g.registry_snapshot IS DISTINCT FROM gridex_brp_changes.registry_snapshot_v1(g.dso_actor_id,g.brp_actor_id)
  OR NOT EXISTS(SELECT FROM public.platform_market_actors a WHERE a.id=g.dso_actor_id
  AND a.status='active'
  AND a.match_status='verified')
  OR NOT EXISTS(SELECT FROM public.platform_market_actors a WHERE a.id=g.brp_actor_id
  AND a.status='active'
  AND a.match_status='verified')
  OR NOT EXISTS(SELECT FROM public.platform_actor_roles r WHERE r.actor_id=g.dso_actor_id
  AND r.actor_role='grid_owner'
  AND r.is_active)
  OR NOT EXISTS(SELECT FROM public.platform_actor_roles r WHERE r.actor_id=g.brp_actor_id
  AND r.actor_role='balance_responsible'
  AND r.is_active) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_exact_verified_registry_actors_and_roles']);
END IF;

 IF (SELECT count(DISTINCT i.actor_id) FROM public.platform_actor_identifiers i WHERE lower(i.identifier_type) IN('edielid','ediel_id')
  AND i.identifier_value=g.dso_ediel_id
  AND i.is_verified
  AND (i.valid_from IS NULL
  OR i.valid_from<=current_date)
  AND (i.valid_to IS NULL
  OR i.valid_to>=current_date))<>1
  OR NOT EXISTS(SELECT FROM public.platform_actor_identifiers i WHERE i.actor_id=g.dso_actor_id
  AND lower(i.identifier_type) IN('edielid','ediel_id')
  AND i.identifier_value=g.dso_ediel_id
  AND i.is_verified
  AND (i.valid_from IS NULL
  OR i.valid_from<=current_date)
  AND (i.valid_to IS NULL
  OR i.valid_to>=current_date))
  OR (SELECT count(DISTINCT i.actor_id) FROM public.platform_actor_identifiers i WHERE lower(i.identifier_type) IN('edielid','ediel_id')
  AND i.identifier_value=g.brp_ediel_id
  AND i.is_verified
  AND (i.valid_from IS NULL
  OR i.valid_from<=(e.effective_at AT TIME ZONE 'Etc/GMT-1')::date)
  AND (i.valid_to IS NULL
  OR i.valid_to>=(e.effective_at AT TIME ZONE 'Etc/GMT-1')::date))<>1
  OR NOT EXISTS(SELECT FROM public.platform_actor_identifiers i WHERE i.actor_id=g.brp_actor_id
  AND lower(i.identifier_type) IN('edielid','ediel_id')
  AND i.identifier_value=g.brp_ediel_id
  AND i.is_verified
  AND (i.valid_from IS NULL
  OR i.valid_from<=(e.effective_at AT TIME ZONE 'Etc/GMT-1')::date)
  AND (i.valid_to IS NULL
  OR i.valid_to>=(e.effective_at AT TIME ZONE 'Etc/GMT-1')::date)) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unique_current_registry_ediel_identities']);
END IF;

 PERFORM i.id FROM public.tenant_actor_identifiers i WHERE i.company_id=c
  AND i.environment=e.environment ORDER BY i.id FOR SHARE;
PERFORM r.id FROM public.tenant_actor_roles r WHERE r.company_id=c
  AND r.environment=e.environment ORDER BY r.id FOR SHARE;
PERFORM p.id FROM public.tenant_ediel_profiles p WHERE p.company_id=c
  AND p.environment=e.environment ORDER BY p.id FOR SHARE;

 IF (SELECT count(DISTINCT(i.actor_id,i.identifier_value)) FROM public.tenant_actor_identifiers i WHERE i.company_id=c
  AND i.environment=e.environment
  AND i.identifier_type='EdielId'
  AND i.valid_from<=now()
  AND (i.valid_to IS NULL
  OR i.valid_to>now()))<>1
  OR NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.company_id=c
  AND i.environment=e.environment
  AND i.actor_id=e.legal_actor_id
  AND i.identifier_type='EdielId'
  AND i.identifier_value=e.legal_sender_id
  AND i.valid_from<=now()
  AND (i.valid_to IS NULL
  OR i.valid_to>now()))
  OR NOT EXISTS(SELECT FROM public.tenant_actor_roles r WHERE r.company_id=c
  AND r.environment=e.environment
  AND r.actor_id=e.legal_actor_id
  AND r.role_code='electricity_supplier'
  AND r.valid_from<=now()
  AND (r.valid_to IS NULL
  OR r.valid_to>now()))
  OR NOT EXISTS(SELECT FROM public.tenant_ediel_profiles p WHERE p.company_id=c
  AND p.environment=e.environment
  AND p.market='electricity'
  AND p.is_enabled
  AND p.valid_from<=now()
  AND (p.valid_to IS NULL
  OR p.valid_to>now())) THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_unique_legal_supplier_profile']);
END IF;

 SELECT * INTO mp FROM public.metering_points WHERE id=e.metering_point_id
  AND company_id=c FOR SHARE;

 IF NOT FOUND
  OR mp.customer_id IS DISTINCT FROM e.customer_id
  OR mp.ediel_metering_point_id IS DISTINCT FROM e.point_id
  OR mp.grid_owner_ediel_id IS DISTINCT FROM g.dso_ediel_id
  OR mp.grid_area_code IS DISTINCT FROM g.grid_area_code THEN RETURN jsonb_build_object('status','held','missing',ARRAY['brp_change_owned_point_dso_and_grid']);
END IF;

 IF notice IS TRUE
  AND now()>(e.effective_at AT TIME ZONE 'Etc/GMT-1'-interval '1 month') AT TIME ZONE 'Etc/GMT-1' THEN RETURN jsonb_build_object('status','held','missing',ARRAY['one_calendar_month_notice_boundary']);
END IF;

 RETURN jsonb_build_object('status','authorized','companyId',c,'environment',e.environment,'eventId',e.id,'supplyPeriodId',e.supply_period_id,'supplyStateVersion',e.supply_state_version,'supplySourceMessageId',e.supply_source_message_id,'customerId',e.customer_id,'meteringPointId',e.metering_point_id,'legalActorId',e.legal_actor_id,'legalSenderId',e.legal_sender_id,'legalReceiverId',g.dso_ediel_id,'brpActorId',g.brp_actor_id,'brpEdielId',g.brp_ediel_id,'pointId',e.point_id,'identityAgency',e.identity_agency,'gridArea',g.grid_area_code,'effectiveAt',e.effective_at,'registryGroundId',g.id,'registryVersion',g.registry_version,'registrySha256',g.source_sha256,'sourceReference',e.source_reference,'sourceVersion',e.source_version,'sourceDigest',e.source_sha256);

END$$;

CREATE FUNCTION public.ediel_brp_change_source_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN RETURN gridex_brp_changes.context_v1(p_company_id,p_event_id,p_actor_user_id);
END$$;

CREATE FUNCTION gridex_brp_changes.wire_v1(raw text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE tokens jsonb:=gridex_utilts_binding.wire_tokens_v1(raw);
v_token jsonb;
obj jsonb:='{}';
head jsonb:='{}';
characteristic text;
key text;

BEGIN IF tokens IS NULL
  OR (SELECT count(*) FROM jsonb_array_elements(tokens) j WHERE j->>'tag'='UNB')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens) j WHERE j->>'tag'='BGM')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens) j WHERE j->>'tag'='UNH')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens) j WHERE j->>'tag'='LIN')<>1 THEN RETURN NULL;
END IF;

 FOR v_token IN SELECT j.value FROM jsonb_array_elements(tokens) AS j(value) LOOP
 IF v_token->>'tag'='BGM' THEN head:=head||jsonb_build_object('code',v_token#>>'{elements,1,0}');
ELSIF v_token->>'tag'='UNB' THEN head:=head||jsonb_build_object('application',v_token#>>'{elements,7,0}','interchange',v_token#>>'{elements,5,0}','transportSender',v_token#>>'{elements,2,0}','transportReceiver',v_token#>>'{elements,3,0}','senderSubaddress',nullif(v_token#>>'{elements,2,2}',''),'receiverSubaddress',nullif(v_token#>>'{elements,3,2}',''));
ELSIF v_token->>'tag'='UNH' THEN head:=head||jsonb_build_object('message',v_token#>>'{elements,1,0}');
ELSIF v_token->>'tag'='NAD'
  AND v_token#>>'{elements,1,0}' IN('FR','DO') THEN key:=CASE v_token#>>'{elements,1,0}' WHEN 'FR' THEN 'sender' ELSE 'receiver' END;
IF head?key
  OR v_token#>>'{elements,2,1}' IS DISTINCT FROM '160'
  OR v_token#>>'{elements,2,2}' IS DISTINCT FROM 'SVK' THEN RETURN NULL;
END IF;
head:=head||jsonb_build_object(key,v_token#>>'{elements,2,0}');

 ELSIF v_token->>'tag'='LIN' THEN obj:=obj||jsonb_build_object('point',v_token#>>'{elements,3,0}','agency',v_token#>>'{elements,3,3}');

 ELSIF v_token->>'tag'='CCI' THEN characteristic:=v_token#>>'{elements,2,0}';

 ELSIF v_token->>'tag'='CAV'
  AND characteristic='Z13' THEN IF obj?'reason' THEN RETURN NULL;
END IF;
obj:=obj||jsonb_build_object('reason',v_token#>>'{elements,1,0}');

 ELSIF v_token->>'tag'='RFF'
  AND v_token#>>'{elements,1,0}' IN('LI','Z05') THEN key:=CASE v_token#>>'{elements,1,0}' WHEN 'LI' THEN 'li' ELSE 'gridArea' END;
IF obj?key THEN RETURN NULL;
END IF;
obj:=obj||jsonb_build_object(key,v_token#>>'{elements,1,1}');

 ELSIF v_token->>'tag'='DTM'
  AND v_token#>>'{elements,1,0}'='157' THEN IF obj?'effective'
  OR v_token#>>'{elements,1,2}' IS DISTINCT FROM '203' THEN RETURN NULL;
END IF;
obj:=obj||jsonb_build_object('effective',v_token#>>'{elements,1,1}');

 ELSIF v_token->>'tag'='NAD'
  AND v_token#>>'{elements,1,0}'='Z02' THEN IF obj?'brp'
  OR v_token#>>'{elements,2,1}' IS DISTINCT FROM '160'
  OR v_token#>>'{elements,2,2}' IS DISTINCT FROM 'SVK' THEN RETURN NULL;
END IF;
obj:=obj||jsonb_build_object('brp',v_token#>>'{elements,2,0}');
END IF;
END LOOP;

 RETURN head||jsonb_build_object('object',obj);
END$$;

CREATE FUNCTION public.ediel_reserve_brp_change_origin_v1(p_company_id uuid,p_event_id uuid,p_actor_user_id uuid,p_intent_id uuid,p_outbound_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE basis jsonb;
prior gridex_brp_changes.origins%rowtype;
i public.ediel_message_intents%rowtype;
r public.outbound_requests%rowtype;

BEGIN basis:=gridex_brp_changes.context_v1(p_company_id,p_event_id,p_actor_user_id);
IF basis->>'status' IS DISTINCT FROM 'authorized' THEN RETURN basis;
END IF;

 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('brp-change:'||p_company_id::text||':'||p_event_id::text,0));
SELECT * INTO prior FROM gridex_brp_changes.origins WHERE company_id=p_company_id
  AND event_id=p_event_id FOR UPDATE;

 IF FOUND THEN IF prior.intent_id IS DISTINCT FROM p_intent_id
  OR prior.basis IS DISTINCT FROM basis THEN RAISE EXCEPTION 'brp_change_frozen_origin_conflict';
END IF;
RETURN jsonb_build_object('status','reserved','messageId',prior.message_id,'outboundRequestId',prior.outbound_request_id);
END IF;

 SELECT * INTO i FROM public.ediel_message_intents WHERE company_id=p_company_id
  AND id=p_intent_id FOR SHARE;
SELECT * INTO r FROM public.outbound_requests WHERE company_id=p_company_id
  AND id=p_outbound_request_id FOR SHARE;

 IF i.id IS NULL
  OR r.id IS NULL
  OR i.environment IS DISTINCT FROM basis->>'environment'
  OR i.direction IS DISTINCT FROM 'outbound'
  OR i.message_family IS DISTINCT FROM 'PRODAT'
  OR i.message_code IS DISTINCT FROM 'Z09'
  OR i.operation_id IS DISTINCT FROM p_event_id
  OR i.customer_id IS DISTINCT FROM (basis->>'customerId')::uuid
  OR i.metering_point_id IS DISTINCT FROM basis->>'pointId'
  OR i.validation_status IS DISTINCT FROM 'validated'
  OR i.application_reference IS DISTINCT FROM '23-DDQ-PRODAT'
  OR r.request_type IS DISTINCT FROM 'customer_masterdata'
  OR r.source_type IS DISTINCT FROM 'manual'
  OR i.communication_route_id IS NULL
  OR i.route_profile_id IS NULL
  OR nullif(i.interchange_reference,'') IS NULL
  OR nullif(i.message_reference,'') IS NULL
  OR nullif(i.transaction_reference,'') IS NULL
  OR r.source_id::text IS DISTINCT FROM i.id::text
  OR r.metering_point_id IS DISTINCT FROM (basis->>'meteringPointId')::uuid
  OR r.operation_id IS DISTINCT FROM p_event_id
  OR r.customer_id IS DISTINCT FROM i.customer_id
  OR r.communication_route_id IS DISTINCT FROM i.communication_route_id THEN RAISE EXCEPTION 'brp_change_owned_intent_request_required';
END IF;

 INSERT INTO gridex_brp_changes.origins(event_id,company_id,intent_id,outbound_request_id,actor_user_id,basis,intent_binding) VALUES(p_event_id,p_company_id,p_intent_id,p_outbound_request_id,p_actor_user_id,basis,jsonb_build_object('sender',i.sender_ediel_id,'receiver',i.receiver_ediel_id,'senderSubaddress',i.sender_subaddress,'receiverSubaddress',i.receiver_subaddress,'interchange',i.interchange_reference,'message',i.message_reference,'transaction',i.transaction_reference,'route',i.communication_route_id,'routeProfile',i.route_profile_id));

 RETURN jsonb_build_object('status','reserved','messageId',NULL,'outboundRequestId',p_outbound_request_id);
END$$;

CREATE FUNCTION gridex_brp_changes.origin_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$BEGIN IF TG_OP IS DISTINCT FROM 'UPDATE'
  OR (to_jsonb(NEW)-ARRAY['message_id','payload_hash']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['message_id','payload_hash'])
  OR OLD.message_id IS NOT NULL
  OR NEW.message_id IS NULL
  OR NEW.payload_hash IS NULL THEN RAISE EXCEPTION 'brp_origin_immutable';
END IF;
RETURN NEW;
END$$;

CREATE TRIGGER brp_origin_immutable BEFORE UPDATE
  OR DELETE ON gridex_brp_changes.origins FOR EACH ROW EXECUTE FUNCTION gridex_brp_changes.origin_guard_v1();
CREATE TRIGGER brp_origin_no_truncate BEFORE TRUNCATE ON gridex_brp_changes.origins FOR EACH STATEMENT EXECUTE FUNCTION gridex_brp_changes.origin_guard_v1();

CREATE FUNCTION gridex_brp_changes.request_binding_v1(r public.outbound_requests,o gridex_brp_changes.origins) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$SELECT
 r.id IS NOT DISTINCT FROM o.outbound_request_id
  AND r.company_id IS NOT DISTINCT FROM o.company_id
  AND r.source_id::text IS NOT DISTINCT FROM o.intent_id::text
  AND r.source_type IS NOT DISTINCT FROM 'manual'
  AND r.request_type IS NOT DISTINCT FROM 'customer_masterdata'
  AND r.customer_id IS NOT DISTINCT FROM (o.basis->>'customerId')::uuid
  AND r.metering_point_id IS NOT DISTINCT FROM (o.basis->>'meteringPointId')::uuid
  AND r.operation_id IS NOT DISTINCT FROM o.event_id
  AND r.communication_route_id IS NOT DISTINCT FROM (o.intent_binding->>'route')::uuid$$;

CREATE FUNCTION gridex_brp_changes.message_binding_v1(m public.ediel_messages,o gridex_brp_changes.origins) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$SELECT
 m.id IS NOT DISTINCT FROM o.message_id
  AND m.intent_id IS NOT DISTINCT FROM o.intent_id
  AND m.company_id IS NOT DISTINCT FROM o.company_id
  AND m.environment IS NOT DISTINCT FROM o.basis->>'environment'
  AND m.direction IS NOT DISTINCT FROM 'outbound'
  AND m.message_family IS NOT DISTINCT FROM 'PRODAT'
  AND m.message_code IS NOT DISTINCT FROM 'Z09'
  AND m.source_operation_id IS NOT DISTINCT FROM o.event_id::text
  AND m.outbound_request_id IS NOT DISTINCT FROM o.outbound_request_id
  AND m.customer_id IS NOT DISTINCT FROM (o.basis->>'customerId')::uuid
  AND m.metering_point_id IS NOT DISTINCT FROM (o.basis->>'meteringPointId')::uuid
  AND m.communication_route_id IS NOT DISTINCT FROM (o.intent_binding->>'route')::uuid
  AND m.route_profile_id IS NOT DISTINCT FROM (o.intent_binding->>'routeProfile')::uuid
  AND m.sender_ediel_id IS NOT DISTINCT FROM o.intent_binding->>'sender'
  AND m.receiver_ediel_id IS NOT DISTINCT FROM o.intent_binding->>'receiver'
  AND m.interchange_reference IS NOT DISTINCT FROM o.intent_binding->>'interchange'
  AND m.transaction_reference IS NOT DISTINCT FROM o.intent_binding->>'transaction'
  AND o.payload_hash IS NOT DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')$$;

CREATE FUNCTION gridex_brp_changes.bind_message_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE o gridex_brp_changes.origins%rowtype;
b jsonb;
w jsonb;
r public.outbound_requests%rowtype;

BEGIN SELECT * INTO o FROM gridex_brp_changes.origins WHERE intent_id=NEW.intent_id
  OR message_id=NEW.id;
IF NOT FOUND THEN RETURN NEW;
END IF;

 IF o.message_id IS NOT NULL THEN IF gridex_brp_changes.message_binding_v1(NEW,o) IS NOT TRUE THEN RAISE EXCEPTION 'brp_bound_message_immutable';
END IF;
RETURN NEW;
END IF;

 b:=gridex_brp_changes.context_v1(o.company_id,o.event_id,o.actor_user_id);
SELECT * INTO STRICT o FROM gridex_brp_changes.origins WHERE intent_id=NEW.intent_id FOR UPDATE;

 IF o.message_id IS NOT NULL THEN IF gridex_brp_changes.message_binding_v1(NEW,o) IS NOT TRUE THEN RAISE EXCEPTION 'brp_bound_message_immutable';
END IF;
RETURN NEW;
END IF;

 SELECT * INTO r FROM public.outbound_requests WHERE id=o.outbound_request_id
  AND company_id=o.company_id FOR SHARE;

 IF gridex_brp_changes.request_binding_v1(r,o) IS NOT TRUE THEN RAISE EXCEPTION 'brp_change_owned_request_changed';
END IF;

 w:=gridex_brp_changes.wire_v1(NEW.raw_payload);

 IF b IS DISTINCT FROM o.basis
  OR b->>'status' IS DISTINCT FROM 'authorized'
  OR NEW.company_id IS DISTINCT FROM o.company_id
  OR NEW.environment IS DISTINCT FROM b->>'environment'
  OR NEW.direction IS DISTINCT FROM 'outbound'
  OR NEW.message_family IS DISTINCT FROM 'PRODAT'
  OR NEW.message_code IS DISTINCT FROM 'Z09'
  OR NEW.source_operation_id IS DISTINCT FROM o.event_id::text
  OR NEW.outbound_request_id IS DISTINCT FROM o.outbound_request_id
  OR NEW.customer_id IS DISTINCT FROM (b->>'customerId')::uuid
  OR NEW.metering_point_id IS DISTINCT FROM (b->>'meteringPointId')::uuid
  OR NEW.communication_route_id IS DISTINCT FROM (o.intent_binding->>'route')::uuid
  OR NEW.route_profile_id IS DISTINCT FROM (o.intent_binding->>'routeProfile')::uuid
  OR NEW.sender_ediel_id IS DISTINCT FROM o.intent_binding->>'sender'
  OR NEW.receiver_ediel_id IS DISTINCT FROM o.intent_binding->>'receiver'
  OR NEW.interchange_reference IS DISTINCT FROM o.intent_binding->>'interchange'
  OR NEW.transaction_reference IS DISTINCT FROM o.intent_binding->>'transaction'
  OR w IS NULL
  OR w->>'code' IS DISTINCT FROM 'Z09'
  OR w->>'application' IS DISTINCT FROM '23-DDQ-PRODAT'
  OR w->>'sender' IS DISTINCT FROM b->>'legalSenderId'
  OR w->>'receiver' IS DISTINCT FROM b->>'legalReceiverId'
  OR w#>>'{object,reason}' IS DISTINCT FROM 'Z27'
  OR w#>>'{object,point}' IS DISTINCT FROM b->>'pointId'
  OR w#>>'{object,agency}' IS DISTINCT FROM b->>'identityAgency'
  OR w#>>'{object,gridArea}' IS DISTINCT FROM b->>'gridArea'
  OR w#>>'{object,brp}' IS DISTINCT FROM b->>'brpEdielId'
  OR w#>>'{object,effective}' IS DISTINCT FROM to_char((b->>'effectiveAt')::timestamptz AT TIME ZONE 'Etc/GMT-1','YYYYMMDDHH24MI')
  OR w#>>'{object,li}' IS DISTINCT FROM o.intent_binding->>'transaction'
  OR w->>'interchange' IS DISTINCT FROM o.intent_binding->>'interchange'
  OR w->>'message' IS DISTINCT FROM o.intent_binding->>'message'
  OR w->>'transportSender' IS DISTINCT FROM o.intent_binding->>'sender'
  OR w->>'transportReceiver' IS DISTINCT FROM o.intent_binding->>'receiver'
  OR w->>'senderSubaddress' IS DISTINCT FROM o.intent_binding->>'senderSubaddress'
  OR w->>'receiverSubaddress' IS DISTINCT FROM o.intent_binding->>'receiverSubaddress' THEN RAISE EXCEPTION 'brp_change_exact_wire_basis_required';
END IF;

 UPDATE gridex_brp_changes.origins SET message_id=NEW.id,payload_hash=encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex') WHERE event_id=o.event_id;

 INSERT INTO gridex_brp_changes.period_versions(event_id,company_id,environment,supply_period_id,effective_at,brp_actor_id,brp_ediel_id,source_message_id,source_payload_hash) VALUES(o.event_id,o.company_id,b->>'environment',(b->>'supplyPeriodId')::uuid,(b->>'effectiveAt')::timestamptz,(b->>'brpActorId')::uuid,b->>'brpEdielId',NEW.id,encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex'));

 RETURN NEW;
END$$;

CREATE TRIGGER brp_bind_message AFTER INSERT
  OR UPDATE OF intent_id,raw_payload,company_id,environment,direction,message_family,message_code,source_operation_id,outbound_request_id,customer_id,metering_point_id,communication_route_id,route_profile_id,sender_ediel_id,receiver_ediel_id,interchange_reference,transaction_reference ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_brp_changes.bind_message_v1();

CREATE FUNCTION public.ediel_require_brp_change_source_current_v1(p_company_id uuid,p_message_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.ediel_messages%rowtype;
o gridex_brp_changes.origins%rowtype;
b jsonb;
w jsonb;
tokens jsonb;
r public.outbound_requests%rowtype;

BEGIN SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=p_company_id
  AND id=p_message_id FOR SHARE;
tokens:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);
w:=gridex_brp_changes.wire_v1(m.raw_payload);
IF w IS NULL
  AND EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM'
  AND t#>>'{elements,1,0}'='Z09')
  AND EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CAV'
  AND t#>>'{elements,1,0}'='Z27') THEN RAISE EXCEPTION 'brp_change_physical_scope_required';
END IF;
IF w IS NULL
  OR w->>'code' IS DISTINCT FROM 'Z09'
  OR w#>>'{object,reason}' IS DISTINCT FROM 'Z27' THEN RETURN;
END IF;

 SELECT * INTO o FROM gridex_brp_changes.origins WHERE company_id=p_company_id
  AND message_id=p_message_id;

 IF NOT FOUND THEN RAISE EXCEPTION 'authentic_brp_change_origin_required';
END IF;

 b:=gridex_brp_changes.context_v1(o.company_id,o.event_id,o.actor_user_id);
SELECT * INTO r FROM public.outbound_requests WHERE id=o.outbound_request_id
  AND company_id=o.company_id FOR SHARE;
IF gridex_brp_changes.request_binding_v1(r,o) IS NOT TRUE
  OR b IS DISTINCT FROM o.basis
  OR b->>'status' IS DISTINCT FROM 'authorized'
  OR gridex_brp_changes.message_binding_v1(m,o) IS NOT TRUE THEN RAISE EXCEPTION 'brp_change_current_source_held';
END IF;
END$$;

CREATE FUNCTION public.ediel_brp_change_message_basis_v1(p_company_id uuid,p_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o gridex_brp_changes.origins%rowtype;
b jsonb;

BEGIN PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=p_company_id
  AND m.user_id=p_actor_user_id FOR SHARE;
IF p_company_id IS NULL
  OR p_actor_user_id IS NULL
  OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=p_actor_user_id
  AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=p_company_id
  AND m.user_id=p_actor_user_id
  AND m.status='active'
  AND m.is_active
  AND m.accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.send') IS NOT TRUE THEN RAISE EXCEPTION 'brp_message_actor_forbidden' USING ERRCODE='42501';
END IF;
SELECT * INTO o FROM gridex_brp_changes.origins WHERE company_id=p_company_id
  AND message_id=p_message_id;
IF NOT FOUND THEN RETURN NULL;
END IF;
b:=gridex_brp_changes.context_v1(o.company_id,o.event_id,o.actor_user_id);
IF b IS DISTINCT FROM o.basis THEN RETURN jsonb_build_object('status','held','missing',ARRAY['brp_change_current_source_changed']);
END IF;
PERFORM public.ediel_require_brp_change_source_current_v1(p_company_id,p_message_id);
RETURN jsonb_build_object('basis',b,'intentId',o.intent_id,'actorUserId',o.actor_user_id);
END$$;

CREATE FUNCTION public.ediel_brp_responsibility_history_v1(p_company_id uuid,p_supply_period_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;

BEGIN PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=p_company_id
  AND m.user_id=p_actor_user_id FOR SHARE;
IF p_company_id IS NULL
  OR p_supply_period_id IS NULL
  OR p_actor_user_id IS NULL
  OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=p_actor_user_id
  AND user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=p_company_id
  AND user_id=p_actor_user_id
  AND status='active'
  AND is_active
  AND accepted_at IS NOT NULL)
  OR public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.read') IS NOT TRUE THEN RAISE EXCEPTION 'brp_history_actor_forbidden' USING ERRCODE='42501';
END IF;
PERFORM p.id FROM public.customer_supply_periods p WHERE p.company_id=p_company_id
  AND p.id=p_supply_period_id FOR SHARE;
IF NOT FOUND THEN RAISE EXCEPTION 'brp_history_relation_unavailable';
END IF;

 SELECT coalesce(jsonb_agg(jsonb_build_object('eventId',v.event_id,'effectiveAt',v.effective_at,'effectiveUntil',(SELECT min(next.effective_at) FROM gridex_brp_changes.period_versions next WHERE next.company_id=v.company_id
  AND next.environment=v.environment
  AND next.supply_period_id=v.supply_period_id
  AND next.effective_at>v.effective_at),'brpActorId',v.brp_actor_id,'brpEdielId',v.brp_ediel_id,'sourceMessageId',v.source_message_id,'sourcePayloadHash',v.source_payload_hash,'status','source_declared','sourceRevoked',EXISTS(SELECT FROM gridex_brp_changes.revocations WHERE target_kind='event'
  AND target_id=v.event_id),'marketActivationProven',false) ORDER BY v.effective_at,v.event_id),'[]') INTO rows FROM gridex_brp_changes.period_versions v WHERE v.company_id=p_company_id
  AND v.supply_period_id=p_supply_period_id;

 RETURN jsonb_build_object('companyId',p_company_id,'supplyPeriodId',p_supply_period_id,'versions',rows,'marketActivationProven',false);
END$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_brp_changes FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.ediel_brp_change_source_v1(uuid,uuid,uuid),public.ediel_reserve_brp_change_origin_v1(uuid,uuid,uuid,uuid,uuid),public.ediel_require_brp_change_source_current_v1(uuid,uuid),public.ediel_brp_change_message_basis_v1(uuid,uuid,uuid),public.ediel_brp_responsibility_history_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.ediel_brp_change_source_v1(uuid,uuid,uuid),public.ediel_reserve_brp_change_origin_v1(uuid,uuid,uuid,uuid,uuid),public.ediel_require_brp_change_source_current_v1(uuid,uuid),public.ediel_brp_change_message_basis_v1(uuid,uuid,uuid),public.ediel_brp_responsibility_history_v1(uuid,uuid,uuid) TO service_role;

COMMIT;

