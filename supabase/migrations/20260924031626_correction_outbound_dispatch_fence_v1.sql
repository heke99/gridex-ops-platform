-- CLI-created. Outbound observation/fence only: no delivery or rescission authority.
BEGIN;
CREATE SCHEMA gridex_outbound_dispatch;
REVOKE ALL ON SCHEMA gridex_outbound_dispatch FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_outbound_dispatch.epoch (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 installed_xid xid8 NOT NULL DEFAULT pg_current_xact_id(), complete boolean NOT NULL DEFAULT false CHECK(NOT complete)
);
INSERT INTO gridex_outbound_dispatch.epoch DEFAULT VALUES;
CREATE TABLE gridex_outbound_dispatch.originals (
 message_id uuid PRIMARY KEY, company_id uuid NOT NULL, environment text NOT NULL CHECK(environment IN ('test','production')),
 raw_payload text NOT NULL CHECK(octet_length(raw_payload)<=262144), payload_hash text NOT NULL,
 facts jsonb NOT NULL, captured_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_xid xid8 NOT NULL DEFAULT pg_current_xact_id()
);
CREATE INDEX ON gridex_outbound_dispatch.originals(company_id,environment);
CREATE TABLE gridex_outbound_dispatch.attempts (
 id uuid PRIMARY KEY, message_id uuid NOT NULL REFERENCES gridex_outbound_dispatch.originals(message_id),
 company_id uuid NOT NULL, environment text NOT NULL, actor_user_id uuid NOT NULL,
 owner jsonb NOT NULL, binding jsonb NOT NULL CHECK(octet_length(binding::text)<=6291456),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_xid xid8 NOT NULL DEFAULT pg_current_xact_id()
);
CREATE INDEX ON gridex_outbound_dispatch.attempts(message_id);
CREATE TABLE gridex_outbound_dispatch.reservations (
 message_id uuid PRIMARY KEY REFERENCES gridex_outbound_dispatch.originals(message_id),
 attempt_id uuid NOT NULL REFERENCES gridex_outbound_dispatch.attempts(id),
 state text NOT NULL CHECK(state IN ('prepared','provider_call_entered','released'))
);
CREATE TABLE gridex_outbound_dispatch.events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL REFERENCES gridex_outbound_dispatch.originals(message_id),
 attempt_id uuid NOT NULL REFERENCES gridex_outbound_dispatch.attempts(id), company_id uuid NOT NULL, environment text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('prepared','provider_call_entered','released','provider_result')),
 facts jsonb NOT NULL, observed_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 UNIQUE(attempt_id,kind)
);
CREATE INDEX ON gridex_outbound_dispatch.events(company_id,environment,message_id);
CREATE TABLE gridex_outbound_dispatch.witnesses (
 event_id uuid PRIMARY KEY REFERENCES gridex_outbound_dispatch.events(id), company_id uuid NOT NULL, environment text NOT NULL,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(), visibility_snapshot text NOT NULL,
 created_xid xid8 NOT NULL DEFAULT pg_current_xact_id()
);
CREATE FUNCTION gridex_outbound_dispatch.immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'outbound_dispatch_append_only' USING ERRCODE='55000'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['epoch','originals','attempts','reservations','events','witnesses'] LOOP
  EXECUTE format('ALTER TABLE gridex_outbound_dispatch.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE gridex_outbound_dispatch.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON gridex_outbound_dispatch.%I FROM PUBLIC,anon,authenticated,service_role',t);
  IF t<>'reservations' THEN
   EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_outbound_dispatch.%I FOR EACH ROW EXECUTE FUNCTION gridex_outbound_dispatch.immutable_v1()',t);
  END IF;
  EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON gridex_outbound_dispatch.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_outbound_dispatch.immutable_v1()',t);
 END LOOP;
END $$;

-- The server-authenticated service supplies its authenticated actor. No public DML.
CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE
 c uuid:=(p_input->>'companyId')::uuid; env text:=p_input->>'environment'; actor uuid:=(p_input->>'actorUserId')::uuid;
 mid uuid:=(p_input->>'messageId')::uuid; aid uuid:=(p_input->>'attemptId')::uuid; action text:=p_input->>'action';
 m public.ediel_messages%rowtype; a gridex_outbound_dispatch.attempts%rowtype; r gridex_outbound_dispatch.reservations%rowtype;
 o gridex_outbound_dispatch.originals%rowtype; e gridex_outbound_dispatch.events%rowtype;
 tokens jsonb; owner jsonb:=p_input->'owner'; binding jsonb:=p_input->'binding'; result jsonb:=p_input->'result';
 scoped boolean; event_kind text; body jsonb; classification text; bytes bytea;
BEGIN
 IF action='prepare' THEN
  -- Canonical DB row owns eligibility. Caller subtype, status and hash cannot opt out.
  SELECT * INTO m FROM public.ediel_messages WHERE id=mid AND company_id=c AND environment=env FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'outbound_dispatch_message_unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM gridex_outbound_dispatch.originals WHERE message_id=mid;
  tokens:=gridex_received_sources.closure_wire_tokens_v1(m.raw_payload);
  scoped:=o.message_id IS NOT NULL OR (m.direction='outbound' AND (m.message_code='Z08' OR EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='Z08')));
  -- A canonical LK wire remains outside this H checkpoint. A caller subtype
  -- cannot hide Z25/H bytes behind a different profile.
  IF o.message_id IS NULL AND m.rule_profile_key='PRODAT:Z08:LK:26.A:r3'
   AND EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}'='Z23')
   AND NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}'='Z25') THEN scoped:=false; END IF;
  IF NOT coalesce(scoped,false) THEN RETURN jsonb_build_object('scoped',false); END IF;
 IF c IS NULL OR actor IS NULL OR mid IS NULL OR env IS NULL OR env NOT IN ('test','production')
 OR NOT coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.send'),false)
 OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.canonical_tenant_operation_decision(c,CASE env WHEN 'production' THEN 'ediel.production.send' ELSE 'ediel.test.process' END) d WHERE d.allowed)
 THEN RAISE EXCEPTION 'outbound_dispatch_actor_unavailable' USING ERRCODE='42501'; END IF;

  IF m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT'
  OR m.raw_payload IS NULL OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR octet_length(m.raw_payload)>262144 OR m.rule_profile_key IS DISTINCT FROM 'PRODAT:Z08:H:26.A:r3'
  OR NOT EXISTS(SELECT FROM public.ediel_message_profiles p JOIN public.ediel_rule_packs pack ON pack.id=p.rule_pack_id
    WHERE p.id=m.rule_profile_version_id AND p.profile_key=m.rule_profile_key AND p.is_enabled AND pack.id=m.canonical_rule_pack_id
    AND pack.status='active' AND pack.valid_from<=current_date AND (pack.valid_to IS NULL OR pack.valid_to>=current_date)
    AND pack.family='PRODAT' AND pack.guide_version='26.A' AND pack.guide_revision='3'
    AND pack.source_hash=m.rule_pack_checksum AND m.rule_profile_version=pack.guide_version||':r'||pack.guide_revision)
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='Z08')
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}'='Z25'
   AND tokens->((t->>'index')::integer-1)->>'tag'='CCI' AND tokens->((t->>'index')::integer-1)#>>'{elements,2,0}'='Z13')
  THEN RAISE EXCEPTION 'outbound_dispatch_sealed_original_unavailable' USING ERRCODE='23514'; END IF;
  IF aid IS NULL OR jsonb_typeof(owner) IS DISTINCT FROM 'object' OR owner->>'kind' IS NULL OR owner->>'kind' NOT IN ('direct','worker')
  OR jsonb_typeof(binding) IS DISTINCT FROM 'object' OR binding->>'originalHash' IS DISTINCT FROM m.immutable_payload_hash
  OR binding->>'routeId' IS DISTINCT FROM m.communication_route_id::text OR binding->>'to' IS DISTINCT FROM m.receiver_email
  OR nullif(binding->>'from','') IS NULL OR binding->>'encoding' IS DISTINCT FROM 'latin1'
  OR nullif(binding->>'mimeMode','') IS NULL OR octet_length(binding::text)>6291456
  THEN RAISE EXCEPTION 'outbound_dispatch_binding_invalid' USING ERRCODE='23514'; END IF;
  bytes:=decode(binding->>'payloadBase64','base64');
  IF bytes IS NULL OR octet_length(bytes)=0 OR octet_length(bytes)>262144
   OR binding->>'payloadHash' IS DISTINCT FROM encode(sha256(bytes),'hex')
   OR (binding->>'payloadLength')::integer IS DISTINCT FROM octet_length(bytes)
  THEN RAISE EXCEPTION 'outbound_dispatch_physical_bytes_invalid' USING ERRCODE='23514'; END IF;
  body:=jsonb_build_object('rawOriginalHash',m.immutable_payload_hash,'renderedAt',m.immutable_rendered_at,
    'profileKey',m.rule_profile_key,'profileId',m.rule_profile_version_id,'packId',m.canonical_rule_pack_id,'packChecksum',m.rule_pack_checksum,
    'sender',m.sender_ediel_id,'receiver',m.receiver_ediel_id,'pointId',m.metering_point_id,'siteId',m.site_id,
    'wireTokens',tokens,'coverage','prospective_only','complete',false);
  INSERT INTO gridex_outbound_dispatch.originals(message_id,company_id,environment,raw_payload,payload_hash,facts)
   VALUES(mid,c,env,m.raw_payload,m.immutable_payload_hash,body) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT o FROM gridex_outbound_dispatch.originals WHERE message_id=mid FOR UPDATE;
  IF o.company_id<>c OR o.environment<>env OR o.payload_hash<>m.immutable_payload_hash OR o.raw_payload<>m.raw_payload
  THEN RAISE EXCEPTION 'outbound_dispatch_original_changed' USING ERRCODE='23514'; END IF;
  SELECT * INTO r FROM gridex_outbound_dispatch.reservations WHERE message_id=mid FOR UPDATE;
  IF FOUND AND r.state<>'released' THEN
   SELECT ev.* INTO e FROM gridex_outbound_dispatch.events ev JOIN gridex_outbound_dispatch.witnesses w ON w.event_id=ev.id
    WHERE ev.attempt_id=r.attempt_id AND ev.kind='provider_result' AND ev.facts->>'classification'='accepted';
   RETURN jsonb_build_object('scoped',true,'proceed',false,'state',r.state,
    'acceptedReceipt',CASE WHEN e.id IS NOT NULL THEN (e.facts->'provider')||jsonb_build_object('observedAt',e.observed_at) ELSE NULL END);
  END IF;
  IF EXISTS(SELECT FROM gridex_outbound_dispatch.attempts WHERE id=aid) THEN RAISE EXCEPTION 'outbound_dispatch_attempt_reused'; END IF;
  IF owner->>'kind'='worker' THEN
   PERFORM 1 FROM public.ediel_outbox WHERE id=(owner->>'outboxId')::uuid AND ediel_message_id=mid AND company_id=c AND environment=env
    AND status='sending' AND current_send_attempt_id=(owner->>'sendAttemptId')::uuid AND locked_by=owner->>'workerId' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'outbound_dispatch_worker_fence_lost' USING ERRCODE='42501'; END IF;
  ELSIF owner IS DISTINCT FROM '{"kind":"direct"}'::jsonb THEN RAISE EXCEPTION 'outbound_dispatch_direct_owner_invalid'; END IF;
  INSERT INTO gridex_outbound_dispatch.attempts(id,message_id,company_id,environment,actor_user_id,owner,binding) VALUES(aid,mid,c,env,actor,owner,binding);
  INSERT INTO gridex_outbound_dispatch.reservations(message_id,attempt_id,state) VALUES(mid,aid,'prepared')
   ON CONFLICT(message_id) DO UPDATE SET attempt_id=excluded.attempt_id,state='prepared';
  event_kind:='prepared';body:=jsonb_build_object('bindingHash',encode(sha256(convert_to(binding::text,'UTF8')),'hex'));
 ELSE
 IF c IS NULL OR actor IS NULL OR mid IS NULL OR env IS NULL OR env NOT IN ('test','production')
 OR NOT coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.send'),false)
 OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.canonical_tenant_operation_decision(c,CASE env WHEN 'production' THEN 'ediel.production.send' ELSE 'ediel.test.process' END) d WHERE d.allowed)
 THEN RAISE EXCEPTION 'outbound_dispatch_actor_unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM gridex_outbound_dispatch.attempts WHERE id=aid AND message_id=mid AND company_id=c AND environment=env AND actor_user_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'outbound_dispatch_attempt_unavailable' USING ERRCODE='42501'; END IF;
  IF action='witness' THEN
   SELECT * INTO e FROM gridex_outbound_dispatch.events WHERE id=(p_input->>'eventId')::uuid AND attempt_id=aid AND company_id=c AND environment=env;
   IF NOT FOUND OR e.created_xid=pg_current_xact_id() OR NOT pg_visible_in_snapshot(e.created_xid,pg_current_snapshot())
   THEN RAISE EXCEPTION 'outbound_dispatch_visibility_unproven'; END IF;
   INSERT INTO gridex_outbound_dispatch.witnesses(event_id,company_id,environment,visibility_snapshot) VALUES(e.id,c,env,pg_current_snapshot()::text) ON CONFLICT DO NOTHING;
   RETURN jsonb_build_object('scoped',true,'eventId',e.id,'witnessed',true);
  END IF;
  -- Every transition locks the same original before the mutable current owner.
  PERFORM 1 FROM gridex_outbound_dispatch.originals WHERE message_id=mid FOR UPDATE;
  SELECT * INTO r FROM gridex_outbound_dispatch.reservations WHERE message_id=mid FOR UPDATE;
  IF r.attempt_id IS DISTINCT FROM aid THEN RAISE EXCEPTION 'outbound_dispatch_stale_owner'; END IF;
  IF action='enter' THEN
   IF r.state<>'prepared' THEN RETURN jsonb_build_object('scoped',true,'proceed',false,'state',r.state); END IF;
   IF a.owner->>'kind'='worker' THEN
    PERFORM 1 FROM public.ediel_outbox WHERE id=(a.owner->>'outboxId')::uuid AND ediel_message_id=mid AND company_id=c AND environment=env
     AND status='sending' AND current_send_attempt_id=(a.owner->>'sendAttemptId')::uuid AND locked_by=a.owner->>'workerId' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'outbound_dispatch_worker_fence_lost' USING ERRCODE='42501'; END IF;
   END IF;
   UPDATE gridex_outbound_dispatch.reservations SET state='provider_call_entered' WHERE message_id=mid;
   event_kind:='provider_call_entered';body:='{"observation":"provider_entry_authorized_not_acceptance"}';
  ELSIF action='release' THEN
   IF r.state<>'prepared' OR EXISTS(SELECT FROM gridex_outbound_dispatch.events WHERE attempt_id=aid AND kind='provider_call_entered')
    THEN RAISE EXCEPTION 'outbound_dispatch_release_unsafe'; END IF;
   UPDATE gridex_outbound_dispatch.reservations SET state='released' WHERE message_id=mid;
   event_kind:='released';body:='{"proof":"entry_never_committed"}';
  ELSIF action='result' THEN
   IF r.state<>'provider_call_entered' OR jsonb_typeof(result) IS DISTINCT FROM 'object' OR octet_length(result::text)>262144
    THEN RAISE EXCEPTION 'outbound_dispatch_result_invalid'; END IF;
   classification:='uncertain';
   IF jsonb_typeof(result->'accepted')='array' AND jsonb_typeof(result->'rejected')='array'
    AND NOT EXISTS(SELECT FROM jsonb_array_elements((result->'accepted')||(result->'rejected')) x WHERE jsonb_typeof(x)<>'string' OR nullif(btrim(x#>>'{}'),'') IS NULL) THEN
    IF jsonb_array_length(result->'accepted')>0 THEN classification:=CASE WHEN jsonb_array_length(result->'rejected')>0 THEN 'partial' ELSE 'accepted' END;
    ELSIF jsonb_array_length(result->'rejected')>0 THEN classification:='all_rejected'; END IF;
   ELSIF result#>>'{error,syscall}'='connect' THEN classification:='pre_connect_negative';
   ELSIF result#>>'{error,responseCode}' ~ '^[45][0-9][0-9]$' THEN classification:='explicit_negative'; END IF;
   event_kind:='provider_result';body:=jsonb_build_object('classification',classification,'provider',result,'acceptanceTime','not_observed','automaticResend',false);
  ELSE RAISE EXCEPTION 'outbound_dispatch_action_invalid'; END IF;
 END IF;
 INSERT INTO gridex_outbound_dispatch.events(message_id,attempt_id,company_id,environment,kind,facts) VALUES(mid,aid,c,env,event_kind,body)
  ON CONFLICT(attempt_id,kind) DO NOTHING RETURNING * INTO e;
 IF NOT FOUND THEN
  SELECT * INTO STRICT e FROM gridex_outbound_dispatch.events WHERE attempt_id=aid AND kind=event_kind;
  IF e.facts IS DISTINCT FROM body THEN RAISE EXCEPTION 'outbound_dispatch_receipt_conflict'; END IF;
 END IF;
 RETURN jsonb_build_object('scoped',true,'proceed',true,'eventId',e.id,'attemptId',aid,'kind',event_kind,'facts',e.facts);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_outbound_dispatch FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA gridex_outbound_dispatch TO service_role;
GRANT EXECUTE ON FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) TO service_role;
CREATE FUNCTION public.gridex_outbound_dispatch_v1(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'outbound_dispatch_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_outbound_dispatch.mutate_v1(p_input);
END $$;
REVOKE ALL ON FUNCTION public.gridex_outbound_dispatch_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_outbound_dispatch_v1(jsonb) TO service_role;
-- Owner-only composition helper. Task4 must call this in its one MVCC statement;
-- it never asserts inception coverage or activates a correction hold by itself.
CREATE FUNCTION gridex_outbound_dispatch.scope_v1(p_raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE t jsonb:=gridex_received_sources.closure_wire_tokens_v1(p_raw); point text; fr text; receiver text; n integer;
BEGIN
 IF t IS NULL THEN RETURN '{}'::jsonb; END IF;
 n:=jsonb_array_length(t);
 IF n<8 OR t->0->>'tag'<>'UNB' OR t->1->>'tag'<>'UNH' OR t->(n-2)->>'tag'<>'UNT' OR t->(n-1)->>'tag'<>'UNZ'
  OR t->1#>>'{elements,2,0}' IS DISTINCT FROM 'PRODAT'
  OR t->(n-2)#>'{elements,1}' IS DISTINCT FROM jsonb_build_array((n-2)::text)
  OR t->(n-2)#>'{elements,2}' IS DISTINCT FROM t->1#>'{elements,1}'
  OR (SELECT count(*) FROM jsonb_array_elements(t) x WHERE x->>'tag' IN ('UNB','UNH','UNT','UNZ','BGM'))<>5
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(t) x WHERE x->>'tag'='BGM' AND x#>>'{elements,1,0}'='Z08')
 THEN RETURN '{}'::jsonb; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(t) x WHERE x->>'tag'='LIN')=1 THEN
  SELECT x#>>'{elements,3,0}' INTO point FROM jsonb_array_elements(t) x WHERE x->>'tag'='LIN' AND x#>>'{elements,3,3}'='9';
 END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(t) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='FR')=1 THEN
  SELECT x#>>'{elements,2,0}' INTO fr FROM jsonb_array_elements(t) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='FR'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(t) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='DO')=1 THEN
  SELECT x#>>'{elements,2,0}' INTO receiver FROM jsonb_array_elements(t) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='DO'; END IF;
 RETURN jsonb_build_object('point',nullif(point,''),'outboundSender',nullif(fr,''),'outboundReceiver',nullif(receiver,''));
END $$;
CREATE FUNCTION gridex_outbound_dispatch.readset_v1(p_company_id uuid,p_environment text,p_actor_user_id uuid,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ids uuid[]; n bigint; size bigint; too_large boolean; originals jsonb; attempts jsonb; events jsonb; witnesses jsonb; body jsonb;
BEGIN
 IF NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.read'),false)
 OR p_environment IS NULL OR p_environment NOT IN ('test','production')
 OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=p_company_id AND user_id=p_actor_user_id AND status='active' AND is_active AND accepted_at IS NOT NULL)
 OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=p_actor_user_id AND user_status='active')
 THEN RAISE EXCEPTION 'outbound_dispatch_reader_unavailable' USING ERRCODE='42501'; END IF;
 -- Unknown party/object dimensions are wildcards. Compare outbound FR to the
 -- inbound receiver and outbound DO to inbound sender. Dates remain conservative.
 WITH candidates AS (
  SELECT o.message_id,o.raw_payload,(o.payload_hash=encode(sha256(convert_to(o.raw_payload,'UTF8')),'hex')) AS seal_verified FROM gridex_outbound_dispatch.originals o WHERE o.company_id=p_company_id AND o.environment=p_environment
  UNION ALL
  SELECT m.id,m.raw_payload,(m.immutable_rendered_at IS NOT NULL AND m.immutable_payload_hash IS NOT NULL
   AND m.immutable_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')) AS seal_verified FROM public.ediel_messages m WHERE m.company_id=p_company_id AND m.environment=p_environment
   AND m.direction='outbound' AND (m.message_code='Z08' OR m.rule_profile_key='PRODAT:Z08:H:26.A:r3'
    OR (m.message_family='PRODAT' AND (gridex_received_sources.closure_wire_tokens_v1(m.raw_payload) IS NULL
      OR EXISTS(SELECT FROM jsonb_array_elements(gridex_received_sources.closure_wire_tokens_v1(m.raw_payload)) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='Z08'))))
   AND NOT EXISTS(SELECT FROM gridex_outbound_dispatch.originals o WHERE o.message_id=m.id)
 ), scoped AS (
  SELECT c.* FROM candidates c CROSS JOIN LATERAL (SELECT gridex_outbound_dispatch.scope_v1(CASE WHEN c.seal_verified THEN c.raw_payload ELSE NULL END) value) s
  WHERE (nullif(p_scope->>'point','') IS NULL OR s.value->>'point' IS NULL OR s.value->>'point'=p_scope->>'point')
   AND (nullif(p_scope->>'inboundSender','') IS NULL OR s.value->>'outboundReceiver' IS NULL OR s.value->>'outboundReceiver'=p_scope->>'inboundSender')
   AND (nullif(p_scope->>'inboundReceiver','') IS NULL OR s.value->>'outboundSender' IS NULL OR s.value->>'outboundSender'=p_scope->>'inboundReceiver')
 ) SELECT count(*),coalesce(sum(octet_length(raw_payload)),0),coalesce(bool_or(octet_length(raw_payload)>262144),false),
  CASE WHEN count(*)<=1000 THEN array_agg(message_id) ELSE NULL END INTO n,size,too_large,ids FROM scoped;
 IF n>1000 OR too_large THEN RETURN jsonb_build_object('complete',false,'originalCount',n,'reason',CASE WHEN n>1000 THEN 'scoped_original_count_overflow' ELSE 'scoped_original_bytes_overflow' END); END IF;
 SELECT size+coalesce(sum(octet_length(binding::text)),0) INTO size FROM gridex_outbound_dispatch.attempts WHERE message_id=ANY(ids);
 IF size>6291456 THEN RETURN jsonb_build_object('complete',false,'originalCount',n,'reason','scoped_original_attempt_bytes_overflow'); END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'message_id'),'[]') INTO originals FROM (
  SELECT to_jsonb(o) x FROM gridex_outbound_dispatch.originals o WHERE message_id=ANY(ids)
  UNION ALL SELECT jsonb_build_object('message_id',m.id,'raw_payload',m.raw_payload,'payload_hash',m.immutable_payload_hash,'uninstrumented',true)
   FROM public.ediel_messages m WHERE id=ANY(ids) AND NOT EXISTS(SELECT FROM gridex_outbound_dispatch.originals o WHERE o.message_id=m.id)
 ) q;
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') INTO attempts FROM gridex_outbound_dispatch.attempts a WHERE message_id=ANY(ids);
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') INTO events FROM gridex_outbound_dispatch.events e WHERE message_id=ANY(ids);
 SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.event_id),'[]') INTO witnesses FROM gridex_outbound_dispatch.witnesses w JOIN gridex_outbound_dispatch.events e ON e.id=w.event_id WHERE e.message_id=ANY(ids);
 body:=jsonb_build_object('version',1,'complete',false,'reason','prospective_history_only','originalCount',n,'originals',originals,'attempts',attempts,'events',events,'witnesses',witnesses,
  'epoch',(SELECT to_jsonb(ep) FROM gridex_outbound_dispatch.epoch ep),'visibilitySnapshot',pg_current_snapshot()::text,
  'gaps',(SELECT coalesce(jsonb_agg(jsonb_build_object('messageId',id,'reason',reason)),'[]') FROM (
   SELECT m.id,'uninstrumented_original' reason FROM public.ediel_messages m WHERE id=ANY(ids) AND NOT EXISTS(SELECT FROM gridex_outbound_dispatch.originals o WHERE o.message_id=m.id)
   UNION ALL SELECT e.message_id,'unwitnessed_event' FROM gridex_outbound_dispatch.events e WHERE message_id=ANY(ids) AND NOT EXISTS(SELECT FROM gridex_outbound_dispatch.witnesses w WHERE w.event_id=e.id)
   UNION ALL SELECT e.message_id,'unresolved_provider_entry' FROM gridex_outbound_dispatch.events e WHERE message_id=ANY(ids) AND kind='provider_call_entered' AND NOT EXISTS(SELECT FROM gridex_outbound_dispatch.events r WHERE r.attempt_id=e.attempt_id AND r.kind='provider_result')
  ) g));
 IF octet_length(body::text)>6291456 THEN RETURN jsonb_build_object('complete',false,'originalCount',n,'reason','scoped_owner_inputs_overflow'); END IF;
 RETURN body;
END $$;
REVOKE ALL ON FUNCTION gridex_outbound_dispatch.scope_v1(text),gridex_outbound_dispatch.readset_v1(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_outbound_dispatch.readset_v1(uuid,text,uuid,jsonb) TO service_role;
COMMIT;
