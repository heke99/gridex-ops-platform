-- OPS-04 controlled live evidence owner. Forward only; nothing is seeded: no
-- correction, counterparty agreement, LIVE mandate, relay capture or
-- consumption exists after this migration.
-- Incidents stay immutable 'reported'; a correction is a new append-only row.
-- Activation is server-side: a route with a current, unrevoked counterparty
-- agreement (or a message that already consumed one) is a controlled flow,
-- whatever the caller's payload says (probe_v1). Each agreement and each LIVE
-- mandate authorises exactly one outbound message (append-only consumption,
-- unique per agreement, per mandate and per message, written atomically by
-- consume_v1 after the evidence has been re-validated under lock).
-- Separation-of-duty rules and validity bounds (agreement <= 31 days,
-- mandate <= 24 hours) are this implementation's explicit security policy;
-- they are not asserted to be frozen Handbook constants.
BEGIN;
CREATE SCHEMA gridex_ediel_ops04;
REVOKE ALL ON SCHEMA gridex_ediel_ops04 FROM PUBLIC,anon,authenticated,service_role;

-- Header-name allowlist: only what TR-08 relayTrace consumes. Every other
-- header (Authorization, Cookie, X-Api-Key, ...) is rejected, never redacted.
CREATE FUNCTION gridex_ediel_ops04.relay_headers_allowed_v1(raw text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT raw IS NOT NULL AND octet_length(raw) BETWEEN 1 AND 65536
  AND raw !~ '^[ \t]' AND raw ~* '(^|\n)received[ \t]*:'
  AND NOT EXISTS(SELECT FROM regexp_split_to_table(raw,E'\r?\n') l(line)
   WHERE line<>'' AND line !~ '^[ \t]' AND line !~* '^(received|received-spf|authentication-results)[ \t]*:')
$$;

CREATE TABLE gridex_ediel_ops04.incident_corrections(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 environment text NOT NULL CHECK(environment IN('test','production')),
 incident_id uuid NOT NULL REFERENCES gridex_ediel_business_incidents.incidents(id),
 command_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 correction_ref text NOT NULL CHECK(length(btrim(correction_ref)) BETWEEN 1 AND 200),
 input jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,command_id));
CREATE TABLE gridex_ediel_ops04.counterparty_agreements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 environment text NOT NULL CHECK(environment IN('test','production')),
 route_profile_id uuid NOT NULL REFERENCES public.ediel_route_profiles(id),
 counterparty_id uuid NOT NULL REFERENCES public.ediel_counterparties(id),
 agreement_ref text NOT NULL CHECK(length(btrim(agreement_ref)) BETWEEN 1 AND 200),
 valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(valid_to>valid_from),
 command_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 input jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,command_id));
CREATE INDEX counterparty_agreements_route_idx ON gridex_ediel_ops04.counterparty_agreements(company_id,environment,route_profile_id);
CREATE TABLE gridex_ediel_ops04.live_mandates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 environment text NOT NULL CHECK(environment='production'),
 incident_id uuid NOT NULL REFERENCES gridex_ediel_business_incidents.incidents(id),
 correction_id uuid NOT NULL REFERENCES gridex_ediel_ops04.incident_corrections(id),
 mandate_ref text NOT NULL CHECK(length(btrim(mandate_ref)) BETWEEN 1 AND 200),
 valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL CHECK(valid_to>valid_from),
 command_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 input jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,command_id));
CREATE TABLE gridex_ediel_ops04.relay_captures(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 environment text NOT NULL CHECK(environment IN('test','production')),
 route_profile_id uuid NOT NULL REFERENCES public.ediel_route_profiles(id),
 evidence_ref text NOT NULL CHECK(length(btrim(evidence_ref)) BETWEEN 1 AND 200),
 raw_headers text NOT NULL CHECK(gridex_ediel_ops04.relay_headers_allowed_v1(raw_headers)),
 raw_headers_sha256 text NOT NULL CHECK(raw_headers_sha256~'^[a-f0-9]{64}$'),
 command_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 input jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,command_id));
CREATE TABLE gridex_ediel_ops04.revocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 correction_id uuid UNIQUE REFERENCES gridex_ediel_ops04.incident_corrections(id),
 agreement_id uuid UNIQUE REFERENCES gridex_ediel_ops04.counterparty_agreements(id),
 mandate_id uuid UNIQUE REFERENCES gridex_ediel_ops04.live_mandates(id),
 capture_id uuid UNIQUE REFERENCES gridex_ediel_ops04.relay_captures(id),
 CHECK(num_nonnulls(correction_id,agreement_id,mandate_id,capture_id)=1),
 reason_ref text NOT NULL CHECK(length(btrim(reason_ref)) BETWEEN 1 AND 200),
 command_id uuid NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 input jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,command_id));
-- Single-use authority: one message per agreement, per mandate and per message.
CREATE TABLE gridex_ediel_ops04.consumptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 environment text NOT NULL CHECK(environment IN('test','production')),
 message_id uuid NOT NULL REFERENCES public.ediel_messages(id),
 incident_id uuid NOT NULL REFERENCES gridex_ediel_business_incidents.incidents(id),
 correction_id uuid NOT NULL REFERENCES gridex_ediel_ops04.incident_corrections(id),
 route_profile_id uuid NOT NULL REFERENCES public.ediel_route_profiles(id),
 agreement_id uuid NOT NULL UNIQUE REFERENCES gridex_ediel_ops04.counterparty_agreements(id),
 mandate_id uuid UNIQUE REFERENCES gridex_ediel_ops04.live_mandates(id),
 CHECK((environment='production')=(mandate_id IS NOT NULL)),
 resend boolean NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 binding jsonb NOT NULL CHECK(jsonb_typeof(binding)='object'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,message_id));

CREATE FUNCTION gridex_ediel_ops04.immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'ediel_ops04_evidence_immutable';END $$;
DO $ops04$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['incident_corrections','counterparty_agreements','live_mandates','relay_captures','revocations','consumptions'] LOOP
 EXECUTE format('ALTER TABLE gridex_ediel_ops04.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE gridex_ediel_ops04.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON gridex_ediel_ops04.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER immutable_ops04_evidence BEFORE UPDATE OR DELETE ON gridex_ediel_ops04.%I FOR EACH ROW EXECUTE FUNCTION gridex_ediel_ops04.immutable_v1()',t);
 EXECUTE format('CREATE TRIGGER gridex_history_truncate_guard BEFORE TRUNCATE ON gridex_ediel_ops04.%I FOR EACH STATEMENT EXECUTE FUNCTION public.gridex_guard_history_truncate_v1()',t);
END LOOP;END $ops04$;

-- Boolean actor gate over the shared business actor check.
-- 'prepare'|'send' map to the existing phases; 'live' adds ediel.send and the
-- tenant operation decision for ediel.production.send (production must be live).
CREATE FUNCTION gridex_ediel_ops04.authorized_v1(c uuid,actor uuid,phase text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF phase IS NULL OR phase NOT IN('prepare','send','live') THEN RETURN false;END IF;
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 PERFORM gridex_ediel_duplicate_responses.require_business_read_actor_v1(c,actor,CASE phase WHEN 'prepare' THEN 'prepare' ELSE 'send' END);
 IF phase='live' AND (public.gridex_actor_has_company_permission(actor,c,'ediel.send') IS NOT TRUE
  OR NOT EXISTS(SELECT FROM public.canonical_tenant_operation_decision(c,'ediel.production.send') d WHERE d.allowed)) THEN RETURN false;END IF;
 RETURN true;EXCEPTION WHEN insufficient_privilege THEN RETURN false;END $$;

-- Command replay: serialize per table, return the original id, reject drift.
CREATE FUNCTION gridex_ediel_ops04.replay_v1(t text,c uuid,cmd uuid,actor uuid,input jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE fid uuid;fa uuid;fi jsonb;BEGIN
 IF t IS NULL OR t NOT IN('incident_corrections','counterparty_agreements','live_mandates','relay_captures','revocations') THEN RAISE EXCEPTION 'ediel_ops04_table_invalid';END IF;
 EXECUTE format('LOCK TABLE gridex_ediel_ops04.%I IN SHARE ROW EXCLUSIVE MODE',t);
 LOCK TABLE gridex_ediel_ops04.revocations IN SHARE ROW EXCLUSIVE MODE;
 EXECUTE format('SELECT id,actor_user_id,input FROM gridex_ediel_ops04.%I WHERE company_id=$1 AND command_id=$2',t) INTO fid,fa,fi USING c,cmd;
 IF fid IS NOT NULL AND (fa IS DISTINCT FROM actor OR fi IS DISTINCT FROM input) THEN RAISE EXCEPTION 'ediel_ops04_command_conflict';END IF;
 RETURN fid;END $$;

CREATE FUNCTION public.gridex_ediel_ops04_record_v1(p_company_id uuid,p_actor_user_id uuid,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET "TimeZone" TO 'UTC' AS $$
DECLARE k text:=p_input->>'kind';keys text[];cmd uuid;rid uuid;vf timestamptz;vt timestamptz;raw text;inp jsonb;
 i gridex_ediel_business_incidents.incidents%rowtype;r public.ediel_route_profiles%rowtype;fix gridex_ediel_ops04.incident_corrections%rowtype;
BEGIN
 keys:=CASE k WHEN 'incident_correction' THEN ARRAY['kind','commandId','incidentId','correctionRef']
  WHEN 'counterparty_agreement' THEN ARRAY['kind','commandId','routeProfileId','counterpartyId','agreementRef','validFrom','validTo']
  WHEN 'live_mandate' THEN ARRAY['kind','commandId','incidentId','correctionId','mandateRef','validFrom','validTo']
  WHEN 'relay_capture' THEN ARRAY['kind','commandId','routeProfileId','evidenceRef','rawHeaders'] END;
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR keys IS NULL
  OR NOT(p_input ?& keys) OR EXISTS(SELECT FROM jsonb_each(p_input) e WHERE e.key<>ALL(keys) OR jsonb_typeof(e.value)<>'string')
  THEN RAISE EXCEPTION 'ediel_ops04_input_invalid' USING ERRCODE='22023';END IF;
 cmd:=(p_input->>'commandId')::uuid;
 IF gridex_ediel_ops04.authorized_v1(p_company_id,p_actor_user_id,CASE k WHEN 'live_mandate' THEN 'live' ELSE 'prepare' END) IS NOT TRUE
  THEN RAISE EXCEPTION 'ediel_ops04_actor_forbidden' USING ERRCODE='42501';END IF;
 IF k IN('counterparty_agreement','live_mandate') THEN
  vf:=(p_input->>'validFrom')::timestamptz;vt:=(p_input->>'validTo')::timestamptz;
  IF vt<=vf OR vt<=clock_timestamp() OR vt>vf+(CASE k WHEN 'live_mandate' THEN interval '24 hours' ELSE interval '31 days' END)
   THEN RAISE EXCEPTION 'ediel_ops04_bounded_current_validity_required';END IF;
 END IF;

 IF k='incident_correction' THEN
  rid:=gridex_ediel_ops04.replay_v1('incident_corrections',p_company_id,cmd,p_actor_user_id,p_input);
  IF rid IS NULL THEN
   SELECT * INTO i FROM gridex_ediel_business_incidents.incidents WHERE id=(p_input->>'incidentId')::uuid AND company_id=p_company_id FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'ediel_ops04_own_incident_required' USING ERRCODE='42501';END IF;
   PERFORM public.ediel_read_fresh_business_incident_v1(p_company_id,p_actor_user_id,i.id); -- requalify current originals
   IF i.actor_user_id=p_actor_user_id THEN RAISE EXCEPTION 'ediel_ops04_independent_correction_actor_required' USING ERRCODE='42501';END IF;
   IF EXISTS(SELECT FROM gridex_ediel_ops04.incident_corrections x WHERE x.incident_id=i.id
    AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.correction_id=x.id)) THEN RAISE EXCEPTION 'ediel_ops04_current_correction_exists';END IF;
   INSERT INTO gridex_ediel_ops04.incident_corrections(company_id,environment,incident_id,command_id,actor_user_id,correction_ref,input)
   VALUES(p_company_id,i.environment,i.id,cmd,p_actor_user_id,btrim(p_input->>'correctionRef'),p_input) RETURNING id INTO rid;
  END IF;

 ELSIF k IN('counterparty_agreement','relay_capture') THEN
  -- Capture input is stored without the raw text but with its hash, so replay compares exactly that.
  inp:=CASE k WHEN 'relay_capture' THEN (p_input-'rawHeaders')||jsonb_build_object('rawHeadersSha256',encode(sha256(convert_to(p_input->>'rawHeaders','UTF8')),'hex')) ELSE p_input END;
  rid:=gridex_ediel_ops04.replay_v1(CASE k WHEN 'relay_capture' THEN 'relay_captures' ELSE 'counterparty_agreements' END,p_company_id,cmd,p_actor_user_id,inp);
  IF rid IS NULL THEN
   SELECT * INTO r FROM public.ediel_route_profiles WHERE id=(p_input->>'routeProfileId')::uuid AND company_id=p_company_id FOR SHARE;
   IF NOT FOUND OR r.is_enabled IS NOT TRUE OR r.is_active IS FALSE OR r.environment NOT IN('test','production')
    THEN RAISE EXCEPTION 'ediel_ops04_own_usable_route_required' USING ERRCODE='42501';END IF;
   IF k='counterparty_agreement' THEN
    IF r.counterparty_id IS DISTINCT FROM (p_input->>'counterpartyId')::uuid
     OR NOT EXISTS(SELECT FROM public.ediel_counterparties p WHERE p.id=r.counterparty_id AND p.company_id=p_company_id
      AND p.environment=r.environment AND p.is_active AND p.lifecycle_status IN('verified','active'))
     THEN RAISE EXCEPTION 'ediel_ops04_route_counterparty_required';END IF;
    IF EXISTS(SELECT FROM gridex_ediel_ops04.counterparty_agreements a WHERE a.route_profile_id=r.id
     AND tstzrange(a.valid_from,a.valid_to)&&tstzrange(vf,vt) AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.agreement_id=a.id))
     THEN RAISE EXCEPTION 'ediel_ops04_overlapping_agreement';END IF;
    INSERT INTO gridex_ediel_ops04.counterparty_agreements(company_id,environment,route_profile_id,counterparty_id,agreement_ref,valid_from,valid_to,command_id,actor_user_id,input)
    VALUES(p_company_id,r.environment,r.id,r.counterparty_id,btrim(p_input->>'agreementRef'),vf,vt,cmd,p_actor_user_id,inp) RETURNING id INTO rid;
   ELSE
    raw:=p_input->>'rawHeaders';
    IF gridex_ediel_ops04.relay_headers_allowed_v1(raw) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_ops04_relay_header_allowlist_required';END IF;
    IF EXISTS(SELECT FROM gridex_ediel_ops04.relay_captures x WHERE x.route_profile_id=r.id
     AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.capture_id=x.id)) THEN RAISE EXCEPTION 'ediel_ops04_current_capture_exists';END IF;
    INSERT INTO gridex_ediel_ops04.relay_captures(company_id,environment,route_profile_id,evidence_ref,raw_headers,raw_headers_sha256,command_id,actor_user_id,input)
    VALUES(p_company_id,r.environment,r.id,btrim(p_input->>'evidenceRef'),raw,inp->>'rawHeadersSha256',cmd,p_actor_user_id,inp) RETURNING id INTO rid;
   END IF;
  END IF;

 ELSE -- live_mandate
  rid:=gridex_ediel_ops04.replay_v1('live_mandates',p_company_id,cmd,p_actor_user_id,p_input);
  IF rid IS NULL THEN
   SELECT * INTO i FROM gridex_ediel_business_incidents.incidents WHERE id=(p_input->>'incidentId')::uuid AND company_id=p_company_id AND environment='production' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'ediel_ops04_own_production_incident_required' USING ERRCODE='42501';END IF;
   SELECT * INTO fix FROM gridex_ediel_ops04.incident_corrections WHERE id=(p_input->>'correctionId')::uuid AND company_id=p_company_id AND incident_id=i.id FOR SHARE;
   IF NOT FOUND OR EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.correction_id=fix.id) THEN RAISE EXCEPTION 'ediel_ops04_current_correction_required';END IF;
   IF fix.actor_user_id=p_actor_user_id THEN RAISE EXCEPTION 'ediel_ops04_independent_mandate_actor_required' USING ERRCODE='42501';END IF;
   IF EXISTS(SELECT FROM gridex_ediel_ops04.live_mandates m WHERE m.incident_id=i.id
    AND tstzrange(m.valid_from,m.valid_to)&&tstzrange(vf,vt) AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.mandate_id=m.id))
    THEN RAISE EXCEPTION 'ediel_ops04_overlapping_mandate';END IF;
   INSERT INTO gridex_ediel_ops04.live_mandates(company_id,environment,incident_id,correction_id,mandate_ref,valid_from,valid_to,command_id,actor_user_id,input)
   VALUES(p_company_id,'production',i.id,fix.id,btrim(p_input->>'mandateRef'),vf,vt,cmd,p_actor_user_id,p_input) RETURNING id INTO rid;
  END IF;
 END IF;
 RETURN jsonb_build_object('kind',k,'id',rid,'companyId',p_company_id,'commandId',cmd);
END $$;

-- Append-only revocation; never UPDATE. Idempotent on (company, command).
CREATE FUNCTION public.gridex_ediel_ops04_revoke_v1(p_company_id uuid,p_actor_user_id uuid,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s text:=p_input->>'subjectKind';sid uuid;cmd uuid;rid uuid;BEGIN
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object'
  OR NOT(p_input ?& ARRAY['commandId','subjectKind','subjectId','reasonRef'])
  OR EXISTS(SELECT FROM jsonb_each(p_input) e WHERE e.key NOT IN('commandId','subjectKind','subjectId','reasonRef') OR jsonb_typeof(e.value)<>'string')
  OR s IS NULL OR s NOT IN('incident_correction','counterparty_agreement','live_mandate','relay_capture')
  THEN RAISE EXCEPTION 'ediel_ops04_input_invalid' USING ERRCODE='22023';END IF;
 cmd:=(p_input->>'commandId')::uuid;sid:=(p_input->>'subjectId')::uuid;
 IF gridex_ediel_ops04.authorized_v1(p_company_id,p_actor_user_id,'prepare') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_ops04_actor_forbidden' USING ERRCODE='42501';END IF;
 rid:=gridex_ediel_ops04.replay_v1('revocations',p_company_id,cmd,p_actor_user_id,p_input);
 IF rid IS NULL THEN
  IF NOT (CASE s
   WHEN 'incident_correction' THEN EXISTS(SELECT FROM gridex_ediel_ops04.incident_corrections WHERE id=sid AND company_id=p_company_id)
   WHEN 'counterparty_agreement' THEN EXISTS(SELECT FROM gridex_ediel_ops04.counterparty_agreements WHERE id=sid AND company_id=p_company_id)
   WHEN 'live_mandate' THEN EXISTS(SELECT FROM gridex_ediel_ops04.live_mandates WHERE id=sid AND company_id=p_company_id)
   ELSE EXISTS(SELECT FROM gridex_ediel_ops04.relay_captures WHERE id=sid AND company_id=p_company_id) END)
   THEN RAISE EXCEPTION 'ediel_ops04_own_subject_required' USING ERRCODE='42501';END IF;
  INSERT INTO gridex_ediel_ops04.revocations(company_id,correction_id,agreement_id,mandate_id,capture_id,reason_ref,command_id,actor_user_id,input)
  VALUES(p_company_id,CASE s WHEN 'incident_correction' THEN sid END,CASE s WHEN 'counterparty_agreement' THEN sid END,
   CASE s WHEN 'live_mandate' THEN sid END,CASE s WHEN 'relay_capture' THEN sid END,btrim(p_input->>'reasonRef'),cmd,p_actor_user_id,p_input)
  ON CONFLICT DO NOTHING RETURNING id INTO rid;
 END IF;
 RETURN jsonb_build_object('revocationId',rid,'alreadyRevoked',rid IS NULL,'companyId',p_company_id,'commandId',cmd);
END $$;

-- Server-side activation. One scoped read per routed outbound send: the flow
-- is controlled when the route the send uses (or the stored message's route or
-- route profile) has a current, unrevoked agreement in this company and
-- environment, or when this message already consumed an authorisation.
-- Returns only a boolean for the caller's own scope; no evidence is exposed.
CREATE FUNCTION public.gridex_ediel_ops04_controlled_flow_probe_v1(p_company_id uuid,p_environment text,p_message_id uuid,p_communication_route_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET "TimeZone" TO 'UTC' AS $$
DECLARE now_ts timestamptz:=clock_timestamp();m_route uuid;m_profile uuid;controlled boolean;BEGIN
 IF p_company_id IS NULL OR p_message_id IS NULL OR p_environment IS NULL OR p_environment NOT IN('test','production')
  THEN RAISE EXCEPTION 'ediel_ops04_scope_required' USING ERRCODE='22023';END IF;
 SELECT m.communication_route_id,m.route_profile_id INTO m_route,m_profile FROM public.ediel_messages m WHERE m.id=p_message_id AND m.company_id=p_company_id;
 controlled:=EXISTS(SELECT FROM gridex_ediel_ops04.consumptions x WHERE x.company_id=p_company_id AND x.message_id=p_message_id)
  OR EXISTS(SELECT FROM gridex_ediel_ops04.counterparty_agreements a JOIN public.ediel_route_profiles r ON r.id=a.route_profile_id AND r.company_id=p_company_id
   WHERE a.company_id=p_company_id AND a.environment=p_environment
    AND (r.communication_route_id IN(p_communication_route_id,m_route) OR r.id=m_profile)
    AND a.valid_from<=now_ts AND now_ts<a.valid_to AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.agreement_id=a.id));
 RETURN jsonb_build_object('companyId',p_company_id,'environment',p_environment,'messageId',p_message_id,'controlled',controlled);
END $$;

-- The evidence read the guard calls. Own company + environment only; fail-closed.
CREATE FUNCTION public.gridex_ediel_ops04_controlled_live_evidence_v1(p_company_id uuid,p_environment text,p_actor_user_id uuid,
 p_message_id uuid,p_incident_id uuid,p_route_profile_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET "TimeZone" TO 'UTC' AS $$
DECLARE r public.ediel_route_profiles%rowtype;now_ts timestamptz;
 fix gridex_ediel_ops04.incident_corrections%rowtype;agr gridex_ediel_ops04.counterparty_agreements%rowtype;
 man gridex_ediel_ops04.live_mandates%rowtype;cap gridex_ediel_ops04.relay_captures%rowtype;n integer;
BEGIN
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR p_message_id IS NULL OR p_incident_id IS NULL OR p_route_profile_id IS NULL
  OR p_environment IS NULL OR p_environment NOT IN('test','production') THEN RAISE EXCEPTION 'ediel_ops04_scope_required' USING ERRCODE='22023';END IF;
 IF gridex_ediel_ops04.authorized_v1(p_company_id,p_actor_user_id,'send') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_ops04_actor_forbidden' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT FROM gridex_ediel_business_incidents.incidents WHERE id=p_incident_id AND company_id=p_company_id AND environment=p_environment)
  THEN RAISE EXCEPTION 'ediel_ops04_evidence_unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.ediel_route_profiles WHERE id=p_route_profile_id AND company_id=p_company_id AND environment=p_environment;
 IF NOT FOUND OR NOT EXISTS(SELECT FROM public.ediel_messages m WHERE m.id=p_message_id AND m.company_id=p_company_id AND m.environment=p_environment
  AND m.direction='outbound' AND m.communication_route_id=r.communication_route_id AND (m.route_profile_id IS NULL OR m.route_profile_id=r.id))
  THEN RAISE EXCEPTION 'ediel_ops04_evidence_unavailable' USING ERRCODE='42501';END IF;
 LOCK TABLE gridex_ediel_ops04.revocations IN SHARE MODE;
 now_ts:=clock_timestamp();

 SELECT count(*) INTO n FROM gridex_ediel_ops04.incident_corrections x WHERE x.company_id=p_company_id AND x.environment=p_environment AND x.incident_id=p_incident_id
  AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.correction_id=x.id);
 IF n>1 THEN RAISE EXCEPTION 'ediel_ops04_correction_ambiguous';END IF;
 SELECT * INTO fix FROM gridex_ediel_ops04.incident_corrections x WHERE x.company_id=p_company_id AND x.environment=p_environment AND x.incident_id=p_incident_id
  AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.correction_id=x.id);

 SELECT count(*) INTO n FROM gridex_ediel_ops04.counterparty_agreements a WHERE a.company_id=p_company_id AND a.environment=p_environment AND a.route_profile_id=r.id
  AND a.valid_from<=now_ts AND now_ts<a.valid_to AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.agreement_id=a.id);
 IF n>1 THEN RAISE EXCEPTION 'ediel_ops04_agreement_ambiguous';END IF;
 SELECT * INTO agr FROM gridex_ediel_ops04.counterparty_agreements a WHERE a.company_id=p_company_id AND a.environment=p_environment AND a.route_profile_id=r.id
  AND a.valid_from<=now_ts AND now_ts<a.valid_to AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.agreement_id=a.id);

 IF p_environment='production' AND fix.id IS NOT NULL THEN
  SELECT count(*) INTO n FROM gridex_ediel_ops04.live_mandates m WHERE m.company_id=p_company_id AND m.incident_id=p_incident_id AND m.correction_id=fix.id
   AND m.valid_from<=now_ts AND now_ts<m.valid_to AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.mandate_id=m.id);
  IF n>1 THEN RAISE EXCEPTION 'ediel_ops04_mandate_ambiguous';END IF;
  SELECT * INTO man FROM gridex_ediel_ops04.live_mandates m WHERE m.company_id=p_company_id AND m.incident_id=p_incident_id AND m.correction_id=fix.id
   AND m.valid_from<=now_ts AND now_ts<m.valid_to AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.mandate_id=m.id);
  -- Grantor must still hold LIVE authority now.
  IF man.id IS NOT NULL AND gridex_ediel_ops04.authorized_v1(p_company_id,man.actor_user_id,'live') IS NOT TRUE THEN man:=NULL;END IF;
 END IF;

 SELECT count(*) INTO n FROM gridex_ediel_ops04.relay_captures x WHERE x.company_id=p_company_id AND x.environment=p_environment AND x.route_profile_id=r.id
  AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.capture_id=x.id);
 IF n>1 THEN RAISE EXCEPTION 'ediel_ops04_capture_ambiguous';END IF;
 SELECT * INTO cap FROM gridex_ediel_ops04.relay_captures x WHERE x.company_id=p_company_id AND x.environment=p_environment AND x.route_profile_id=r.id
  AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.capture_id=x.id);
 IF cap.id IS NOT NULL AND cap.raw_headers_sha256 IS DISTINCT FROM encode(sha256(convert_to(cap.raw_headers,'UTF8')),'hex')
  THEN RAISE EXCEPTION 'ediel_ops04_capture_integrity_required';END IF;

 RETURN jsonb_build_object('companyId',p_company_id,'environment',p_environment,'incidentId',p_incident_id,'routeProfileId',r.id,
  'incidentCorrection',CASE WHEN fix.id IS NULL THEN NULL ELSE jsonb_build_object('companyId',fix.company_id,'environment',fix.environment,'incidentId',fix.incident_id,'correctionRef',fix.correction_ref) END,
  'counterpartyAgreement',CASE WHEN agr.id IS NULL THEN NULL ELSE jsonb_build_object('id',agr.id,'companyId',agr.company_id,'environment',agr.environment,'ref',agr.agreement_ref,
   'counterpartyId',agr.counterparty_id,'routeId',agr.route_profile_id,'validFrom',agr.valid_from,'validTo',agr.valid_to,
   'consumedByMessageId',(SELECT x.message_id FROM gridex_ediel_ops04.consumptions x WHERE x.agreement_id=agr.id)) END,
  'liveMandate',CASE WHEN man.id IS NULL THEN NULL ELSE jsonb_build_object('id',man.id,'companyId',man.company_id,'environment',man.environment,'ref',man.mandate_ref,'incidentId',man.incident_id,
   'consumedByMessageId',(SELECT x.message_id FROM gridex_ediel_ops04.consumptions x WHERE x.mandate_id=man.id)) END,
  'relayCapture',CASE WHEN cap.id IS NULL THEN NULL ELSE jsonb_build_object('companyId',cap.company_id,'environment',cap.environment,'evidenceRef',cap.evidence_ref,
   'routeId',cap.route_profile_id,'rawHeaders',cap.raw_headers) END);
END $$;

-- Final-use consumption: the fixed provider gate calls this AFTER the existing
-- generic/sealed prepare + enter callback, before the provider. A committed
-- consumption survives later provider failure; it never authorises a resend.
-- Exact same-message replay remains an auditable receipt (replayed=true), not
-- permission to call the provider again. The final TS gate refuses that receipt.
CREATE FUNCTION public.gridex_ediel_ops04_consume_controlled_live_v1(p_company_id uuid,p_environment text,p_actor_user_id uuid,p_message_id uuid,
 p_incident_id uuid,p_route_profile_id uuid,p_agreement_id uuid,p_mandate_id uuid,p_resend boolean,p_binding jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET "TimeZone" TO 'UTC' AS $$
DECLARE now_ts timestamptz;m public.ediel_messages%rowtype;r public.ediel_route_profiles%rowtype;
 cert public.ediel_certificates%rowtype;tp public.ediel_transport_profiles%rowtype;cp public.ediel_counterparties%rowtype;
 snapshot public.ediel_message_payloads%rowtype;i gridex_ediel_business_incidents.incidents%rowtype;
 fix gridex_ediel_ops04.incident_corrections%rowtype;agr gridex_ediel_ops04.counterparty_agreements%rowtype;
 man gridex_ediel_ops04.live_mandates%rowtype;cap gridex_ediel_ops04.relay_captures%rowtype;
 prior gridex_ediel_ops04.consumptions%rowtype;ga gridex_ediel_transport.attempts%rowtype;
 za gridex_outbound_dispatch.attempts%rowtype;gr gridex_ediel_transport.reservations%rowtype;
 zr gridex_outbound_dispatch.reservations%rowtype;n integer;cid uuid;aid uuid;lane text;
 provider jsonb;message_binding jsonb;audit_binding jsonb;source_hash text;fingerprint text;
BEGIN
 IF p_company_id IS NULL OR p_actor_user_id IS NULL OR p_message_id IS NULL OR p_incident_id IS NULL OR p_route_profile_id IS NULL
  OR p_agreement_id IS NULL OR p_resend IS NULL OR p_environment IS NULL OR p_environment NOT IN('test','production')
  OR (p_environment='production')<>(p_mandate_id IS NOT NULL) THEN RAISE EXCEPTION 'ediel_ops04_scope_required' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(p_binding) IS DISTINCT FROM 'object'
  OR NOT(p_binding ?& ARRAY['message','routeProfile','certificateId','certificateFingerprint','correctionRef','relayEvidenceRef','relayHeadersHash','provider'])
  OR EXISTS(SELECT FROM jsonb_object_keys(p_binding) k WHERE k NOT IN('message','routeProfile','certificateId','certificateFingerprint','correctionRef','relayEvidenceRef','relayHeadersHash','provider'))
  OR jsonb_typeof(p_binding->'message') IS DISTINCT FROM 'object' OR jsonb_typeof(p_binding->'routeProfile') IS DISTINCT FROM 'object'
  OR jsonb_typeof(p_binding->'provider') IS DISTINCT FROM 'object'
  OR NOT((p_binding->'message') ?& ARRAY['id','companyId','environment','direction','communicationRouteId','originalMessageId','sourcePayloadHash','recipient','senderEdielId','receiverEdielId'])
  OR EXISTS(SELECT FROM jsonb_object_keys(p_binding->'message') k WHERE k NOT IN('id','companyId','environment','direction','communicationRouteId','originalMessageId','sourcePayloadHash','recipient','senderEdielId','receiverEdielId'))
  OR EXISTS(SELECT FROM jsonb_each(p_binding) e WHERE e.key IN('certificateId','certificateFingerprint','correctionRef','relayEvidenceRef','relayHeadersHash') AND (jsonb_typeof(e.value)<>'string' OR nullif(btrim(e.value#>>'{}'),'') IS NULL))
  THEN RAISE EXCEPTION 'ediel_ops04_binding_invalid' USING ERRCODE='22023';END IF;
 provider:=p_binding->'provider';
 IF NOT(provider ?& ARRAY['originalHash','routeId','to','from','payloadHash','payloadLength','encoding','mimeMode','mimeSha256','mimeLength','mimeArchiveRef','rfcMessageId','mimePayloadSnapshotId'])
  OR EXISTS(SELECT FROM jsonb_each(provider) e WHERE e.key NOT IN('originalHash','routeId','to','from','payloadHash','payloadLength','encoding','mimeMode','mimeSha256','mimeLength','mimeArchiveRef','rfcMessageId','mimePayloadSnapshotId')
   OR CASE WHEN e.key IN('payloadLength','mimeLength') THEN jsonb_typeof(e.value)<>'number' OR (e.value#>>'{}')!~'^[1-9][0-9]*$'
    ELSE jsonb_typeof(e.value)<>'string' OR nullif(btrim(e.value#>>'{}'),'') IS NULL END)
  OR provider->>'originalHash' !~ '^[a-f0-9]{64}$' OR provider->>'payloadHash' !~ '^[a-f0-9]{64}$'
  OR provider->>'mimeSha256' !~ '^[a-f0-9]{64}$' OR p_binding->>'relayHeadersHash' !~ '^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'ediel_ops04_binding_invalid' USING ERRCODE='22023';END IF;

 -- Qualified shared graph lock holds current membership/permission decisions
 -- stable until commit. Acquire it before OPS evidence locks in every writer.
 IF gridex_ediel_ops04.authorized_v1(p_company_id,p_actor_user_id,'send') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_ops04_actor_forbidden' USING ERRCODE='42501';END IF;
 LOCK TABLE gridex_ediel_ops04.consumptions IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE gridex_ediel_ops04.revocations IN SHARE MODE;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id AND environment=p_environment AND direction='outbound' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_ops04_evidence_unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.ediel_route_profiles p WHERE p.id=p_route_profile_id AND p.company_id=p_company_id AND p.environment=p_environment
  AND p.is_enabled AND p.is_active IS NOT FALSE AND p.communication_route_id=m.communication_route_id AND (m.route_profile_id IS NULL OR m.route_profile_id=p.id) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_ops04_evidence_unavailable' USING ERRCODE='42501';END IF;
 source_hash:=encode(sha256(convert_to(coalesce(m.raw_payload,''),'UTF8')),'hex');
 message_binding:=jsonb_build_object('id',m.id,'companyId',m.company_id,'environment',m.environment,'direction',m.direction,
  'communicationRouteId',m.communication_route_id,'originalMessageId',m.original_message_id,'sourcePayloadHash',source_hash,
  'recipient',m.receiver_email,'senderEdielId',m.sender_ediel_id,'receiverEdielId',m.receiver_ediel_id);
 IF p_binding->'message' IS DISTINCT FROM message_binding OR p_binding->'routeProfile' IS DISTINCT FROM to_jsonb(r)
  OR provider->>'originalHash' IS DISTINCT FROM source_hash OR provider->>'routeId' IS DISTINCT FROM m.communication_route_id::text
  OR provider->>'to' IS DISTINCT FROM m.receiver_email THEN RAISE EXCEPTION 'ediel_ops04_source_binding_changed';END IF;
 SELECT * INTO cert FROM public.ediel_certificates WHERE id=coalesce(r.receiver_certificate_id,r.certificate_id)
  AND company_id=p_company_id AND environment=p_environment FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_ops04_current_certificate_required';END IF;
 fingerprint:=lower(regexp_replace(coalesce(nullif(btrim(cert.fingerprint_sha256),''),nullif(btrim(cert.certificate_fingerprint),'')), '[[:space:]:]','','g'));
 IF cert.id::text IS DISTINCT FROM p_binding->>'certificateId' OR fingerprint IS DISTINCT FROM p_binding->>'certificateFingerprint'
  OR nullif(fingerprint,'') IS NULL OR cert.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'ediel_ops04_current_certificate_required';END IF;
 SELECT * INTO tp FROM public.ediel_transport_profiles WHERE id=r.transport_profile_id AND company_id=p_company_id AND environment=p_environment AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_ops04_current_transport_profile_required';END IF;
 SELECT * INTO cp FROM public.ediel_counterparties WHERE id=r.counterparty_id AND company_id=p_company_id AND environment=p_environment
  AND is_active AND lifecycle_status IN('verified','active') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_ops04_route_counterparty_required';END IF;
 SELECT * INTO i FROM gridex_ediel_business_incidents.incidents WHERE id=p_incident_id AND company_id=p_company_id AND environment=p_environment FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_ops04_evidence_unavailable' USING ERRCODE='42501';END IF;
 IF p_resend AND m.original_message_id IS DISTINCT FROM i.source_message_id::text THEN RAISE EXCEPTION 'ediel_ops04_resend_original_mismatch';END IF;
 SELECT count(*) INTO n FROM gridex_ediel_ops04.incident_corrections x WHERE x.company_id=p_company_id AND x.environment=p_environment AND x.incident_id=i.id
  AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.correction_id=x.id);
 IF n<>1 THEN RAISE EXCEPTION 'ediel_ops04_current_correction_required';END IF;
 SELECT * INTO fix FROM gridex_ediel_ops04.incident_corrections x WHERE x.company_id=p_company_id AND x.environment=p_environment AND x.incident_id=i.id
  AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.correction_id=x.id);
 IF fix.correction_ref IS DISTINCT FROM p_binding->>'correctionRef' THEN RAISE EXCEPTION 'ediel_ops04_correction_binding_changed';END IF;
 SELECT count(*) INTO n FROM gridex_ediel_ops04.relay_captures x WHERE x.company_id=p_company_id AND x.environment=p_environment AND x.route_profile_id=r.id
  AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.capture_id=x.id);
 IF n<>1 THEN RAISE EXCEPTION 'ediel_ops04_current_capture_required';END IF;
 SELECT * INTO cap FROM gridex_ediel_ops04.relay_captures x WHERE x.company_id=p_company_id AND x.environment=p_environment AND x.route_profile_id=r.id
  AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.capture_id=x.id);
 IF cap.evidence_ref IS DISTINCT FROM p_binding->>'relayEvidenceRef' OR cap.raw_headers_sha256 IS DISTINCT FROM p_binding->>'relayHeadersHash'
  OR cap.raw_headers_sha256 IS DISTINCT FROM encode(sha256(convert_to(cap.raw_headers,'UTF8')),'hex')
  OR gridex_ediel_ops04.relay_headers_allowed_v1(cap.raw_headers) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_ops04_capture_binding_changed';END IF;
 SELECT * INTO agr FROM gridex_ediel_ops04.counterparty_agreements a WHERE a.id=p_agreement_id AND a.company_id=p_company_id AND a.environment=p_environment
  AND a.route_profile_id=r.id AND a.counterparty_id=r.counterparty_id AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.agreement_id=a.id);
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_ops04_current_agreement_required';END IF;
 IF p_environment='production' THEN
  SELECT * INTO man FROM gridex_ediel_ops04.live_mandates x WHERE x.id=p_mandate_id AND x.company_id=p_company_id AND x.incident_id=i.id
   AND x.correction_id=fix.id AND NOT EXISTS(SELECT FROM gridex_ediel_ops04.revocations v WHERE v.mandate_id=x.id);
  IF NOT FOUND OR gridex_ediel_ops04.authorized_v1(p_company_id,man.actor_user_id,'live') IS NOT TRUE
   THEN RAISE EXCEPTION 'ediel_ops04_current_mandate_required';END IF;
 END IF;
 SELECT * INTO snapshot FROM public.ediel_message_payloads WHERE id=(provider->>'mimePayloadSnapshotId')::uuid AND company_id=p_company_id
  AND ediel_message_id=m.id AND payload_kind IN('raw_mime','smime_enveloped') AND encrypted_payload_ref=provider->>'mimeArchiveRef'
  AND metadata->>'archive_verified'='true' AND metadata->>'archived_mime_sha256'=provider->>'mimeSha256'
  AND metadata->>'archived_mime_bytes'=provider->>'mimeLength' AND metadata->>'archived_rfc_message_id'=provider->>'rfcMessageId' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_ops04_entered_archive_required';END IF;
 -- Current reservations are locked as in their existing entry/result writers;
 -- message FOR SHARE also excludes those writers' message FOR UPDATE. Only
 -- actual entered, unobserved authority can reach this final-use transaction.
 SELECT * INTO gr FROM gridex_ediel_transport.reservations WHERE message_id=m.id FOR SHARE;
 SELECT * INTO zr FROM gridex_outbound_dispatch.reservations WHERE message_id=m.id FOR SHARE;
 IF gr.state='entered' THEN
  SELECT * INTO ga FROM gridex_ediel_transport.attempts WHERE id=gr.attempt_id AND message_id=m.id AND company_id=p_company_id
   AND environment=p_environment AND actor_user_id=p_actor_user_id AND entered_at IS NOT NULL AND observed_at IS NULL AND classification IS NULL
   AND binding @> provider FOR SHARE;
  IF FOUND THEN aid:=ga.id;lane:='generic_journal';END IF;
 END IF;
 IF zr.state='provider_call_entered' THEN
  SELECT * INTO za FROM gridex_outbound_dispatch.attempts a WHERE a.id=zr.attempt_id AND a.message_id=m.id AND a.company_id=p_company_id
   AND a.environment=p_environment AND a.actor_user_id=p_actor_user_id AND a.binding @> provider
   AND EXISTS(SELECT FROM gridex_outbound_dispatch.events e WHERE e.attempt_id=a.id AND e.message_id=m.id AND e.company_id=p_company_id AND e.environment=p_environment AND e.kind='provider_call_entered')
   AND NOT EXISTS(SELECT FROM gridex_outbound_dispatch.events e WHERE e.attempt_id=a.id AND e.message_id=m.id AND e.company_id=p_company_id AND e.environment=p_environment AND e.kind='provider_result') FOR SHARE;
  IF FOUND THEN
   IF aid IS NOT NULL THEN RAISE EXCEPTION 'ediel_ops04_entered_attempt_ambiguous';END IF;
   aid:=za.id;lane:='sealed_z08';
  END IF;
 END IF;
 IF aid IS NULL THEN RAISE EXCEPTION 'ediel_ops04_entered_attempt_required';END IF;
 PERFORM public.ediel_read_fresh_business_incident_v1(p_company_id,p_actor_user_id,i.id);
 -- Re-evaluate time-sensitive permission decisions after every lock wait too.
 IF gridex_ediel_ops04.authorized_v1(p_company_id,p_actor_user_id,'send') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_ops04_actor_forbidden' USING ERRCODE='42501';END IF;
 IF p_environment='production' AND gridex_ediel_ops04.authorized_v1(p_company_id,man.actor_user_id,'live') IS NOT TRUE
  THEN RAISE EXCEPTION 'ediel_ops04_current_mandate_required';END IF;
 -- This clock is sampled AFTER all potentially waiting graph/source/archive/
 -- reservation locks and current grantor checks, never before a lock wait.
 now_ts:=clock_timestamp();
 IF coalesce(cert.valid_from,cert.certificate_valid_from) IS NULL OR coalesce(cert.valid_to,cert.certificate_valid_to) IS NULL
  OR now_ts<coalesce(cert.valid_from,cert.certificate_valid_from) OR now_ts>=coalesce(cert.valid_to,cert.certificate_valid_to)
  THEN RAISE EXCEPTION 'ediel_ops04_current_certificate_required';END IF;
 IF NOT(agr.valid_from<=now_ts AND now_ts<agr.valid_to) THEN RAISE EXCEPTION 'ediel_ops04_current_agreement_required';END IF;
 IF p_environment='production' AND NOT(man.valid_from<=now_ts AND now_ts<man.valid_to) THEN RAISE EXCEPTION 'ediel_ops04_current_mandate_required';END IF;
 -- Preserve only the bounded immutable projection and exact MIME/entry IDs.
 -- Full profile/certificate rows, raw source, relay headers and secrets stay out.
 audit_binding:=(p_binding-'routeProfile')||jsonb_build_object('routeProfileHash',encode(sha256(convert_to((p_binding->'routeProfile')::text,'UTF8')),'hex'),
  'relayCaptureId',cap.id,'attemptId',aid,'lane',lane);
 SELECT * INTO prior FROM gridex_ediel_ops04.consumptions WHERE company_id=p_company_id AND message_id=m.id;
 IF FOUND THEN
  IF prior.environment=p_environment AND prior.incident_id=i.id AND prior.correction_id=fix.id AND prior.route_profile_id=r.id
   AND prior.agreement_id=agr.id AND prior.mandate_id IS NOT DISTINCT FROM man.id AND prior.resend=p_resend
   AND prior.actor_user_id=p_actor_user_id AND prior.binding IS NOT DISTINCT FROM audit_binding
  THEN RETURN jsonb_build_object('consumptionId',prior.id,'companyId',p_company_id,'environment',p_environment,'messageId',m.id,
   'agreementId',agr.id,'mandateId',man.id,'replayed',true);END IF;
  RAISE EXCEPTION 'ediel_ops04_consumption_conflict';
 END IF;
 IF EXISTS(SELECT FROM gridex_ediel_ops04.consumptions x WHERE x.agreement_id=agr.id OR (man.id IS NOT NULL AND x.mandate_id=man.id))
  THEN RAISE EXCEPTION 'ediel_ops04_authorization_consumed';END IF;
 INSERT INTO gridex_ediel_ops04.consumptions(company_id,environment,message_id,incident_id,correction_id,route_profile_id,agreement_id,mandate_id,resend,actor_user_id,binding)
 VALUES(p_company_id,p_environment,m.id,i.id,fix.id,r.id,agr.id,man.id,p_resend,p_actor_user_id,audit_binding) RETURNING id INTO cid;
 RETURN jsonb_build_object('consumptionId',cid,'companyId',p_company_id,'environment',p_environment,'messageId',m.id,
  'agreementId',agr.id,'mandateId',man.id,'replayed',false);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_ops04 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gridex_ediel_ops04_record_v1(uuid,uuid,jsonb),public.gridex_ediel_ops04_revoke_v1(uuid,uuid,jsonb),
 public.gridex_ediel_ops04_controlled_flow_probe_v1(uuid,text,uuid,uuid),
 public.gridex_ediel_ops04_controlled_live_evidence_v1(uuid,text,uuid,uuid,uuid,uuid),
 public.gridex_ediel_ops04_consume_controlled_live_v1(uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,boolean,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_ediel_ops04_record_v1(uuid,uuid,jsonb),public.gridex_ediel_ops04_revoke_v1(uuid,uuid,jsonb),
 public.gridex_ediel_ops04_controlled_flow_probe_v1(uuid,text,uuid,uuid),
 public.gridex_ediel_ops04_controlled_live_evidence_v1(uuid,text,uuid,uuid,uuid,uuid),
 public.gridex_ediel_ops04_consume_controlled_live_v1(uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,boolean,jsonb) TO service_role;
COMMIT;
