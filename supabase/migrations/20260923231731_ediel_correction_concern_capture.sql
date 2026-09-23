-- CLI-created forward. Sealed-source-only concern registration, never C authority.
-- No new document bytes, historical backfill, target inference or approval.
BEGIN;
-- One private neutral decoder owns the common envelope/party/LIN/group/date
-- structure. It reports raw grammar and counts, never acceptance or subtype.
-- Closure and correction policy gates below independently interpret its output.
CREATE FUNCTION gridex_received_sources.z05_wire_structure_v1(p_raw text,p_object jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE
 tokens jsonb:=gridex_received_sources.closure_wire_tokens_v1(p_raw); token jsonb; e jsonb;
 unb jsonb; unh jsonb; unt jsonb; unz jsonb; bgm jsonb; fr jsonb; receiver jsonb; zone jsonb;
 n integer; first_line integer; stop_index integer; chosen_index integer; next_line integer;
 line_index integer:=0; object_value jsonb; selected_object jsonb; identities jsonb:='[]'; identity_value jsonb;
 selected_date jsonb; selected_reason jsonb; selected_reference jsonb; common_end integer; reference_end integer;
 date_count integer:=0; reason_count integer:=0; reference_count integer:=0;
 reason text; minute text; market_time timestamp; utc_value timestamptz; tag_name text;
BEGIN
 IF tokens IS NULL OR jsonb_typeof(p_object) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
 n:=jsonb_array_length(tokens);
 IF n<8 THEN RETURN NULL; END IF;
 FOREACH tag_name IN ARRAY ARRAY['UNB','UNH','UNT','UNZ','BGM'] LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'=tag_name)<>1 THEN RETURN NULL; END IF;
 END LOOP;
 unb:=tokens->0;unh:=tokens->1;unt:=tokens->(n-2);unz:=tokens->(n-1);
 SELECT t INTO bgm FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM';
 SELECT min((t->>'index')::integer) INTO first_line FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN';
 IF first_line IS NULL OR unb->>'tag'<>'UNB' OR unh->>'tag'<>'UNH' OR unt->>'tag'<>'UNT' OR unz->>'tag'<>'UNZ'
 OR (bgm->>'index')::integer<=1 OR (bgm->>'index')::integer>=first_line
 OR unb#>>'{elements,1,1}' IS DISTINCT FROM '3' OR unh#>>'{elements,2,0}' IS DISTINCT FROM 'PRODAT'
 OR jsonb_array_length(unh#>'{elements,1}') IS DISTINCT FROM 1 OR nullif(unh#>>'{elements,1,0}','') IS NULL
 OR unt#>'{elements,2}' IS DISTINCT FROM unh#>'{elements,1}'
 OR unt#>'{elements,1}' IS DISTINCT FROM jsonb_build_array((n-2)::text)
 OR unz#>'{elements,1}' IS DISTINCT FROM '["1"]'::jsonb
 OR jsonb_array_length(unb#>'{elements,5}') IS DISTINCT FROM 1 OR nullif(unb#>>'{elements,5,0}','') IS NULL
 OR unz#>'{elements,2}' IS DISTINCT FROM unb#>'{elements,5}'
 OR bgm#>'{elements,1}' IS DISTINCT FROM '["Z05"]'::jsonb
 OR jsonb_array_length(bgm#>'{elements,2}') IS DISTINCT FROM 1 OR nullif(bgm#>>'{elements,2,0}','') IS NULL
 OR coalesce(bgm#>'{elements,3}','[""]'::jsonb) NOT IN ('["9"]'::jsonb,'[""]'::jsonb) THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::int<first_line AND t->>'tag'='NAD' AND t#>'{elements,1}'='["FR"]'::jsonb)<>1
 OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::int<first_line AND t->>'tag'='NAD' AND t#>'{elements,1}'='["DO"]'::jsonb)<>1
 OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::int<first_line AND t->>'tag'='DTM' AND t#>>'{elements,1,0}'='ZZZ')<>1 THEN RETURN NULL; END IF;
 SELECT t->'elements' INTO fr FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::int<first_line AND t->>'tag'='NAD' AND t#>'{elements,1}'='["FR"]'::jsonb;
 SELECT t->'elements' INTO receiver FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::int<first_line AND t->>'tag'='NAD' AND t#>'{elements,1}'='["DO"]'::jsonb;
 SELECT t#>'{elements,1}' INTO zone FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::int<first_line AND t->>'tag'='DTM' AND t#>>'{elements,1,0}'='ZZZ';
 IF zone IS DISTINCT FROM '["ZZZ","1","805"]'::jsonb
 OR jsonb_array_length(fr->2) IS DISTINCT FROM 3 OR jsonb_array_length(receiver->2) IS DISTINCT FROM 3
 OR fr#>>'{2,1}' IS DISTINCT FROM '160' OR fr#>>'{2,2}' IS DISTINCT FROM 'SVK'
 OR receiver#>>'{2,1}' IS DISTINCT FROM '160' OR receiver#>>'{2,2}' IS DISTINCT FROM 'SVK'
 OR nullif(fr#>>'{2,0}','') IS NULL OR fr#>>'{2,0}'<>btrim(fr#>>'{2,0}')
 OR nullif(receiver#>>'{2,0}','') IS NULL OR receiver#>>'{2,0}'<>btrim(receiver#>>'{2,0}')
 OR jsonb_array_length(unb#>'{elements,2}') IS DISTINCT FROM 2 OR jsonb_array_length(unb#>'{elements,3}') IS DISTINCT FROM 2
 OR unb#>>'{elements,2,0}' IS DISTINCT FROM fr#>>'{2,0}'
 OR unb#>>'{elements,2,1}' NOT IN ('14','ZZ') OR unb#>>'{elements,3,1}' NOT IN ('14','ZZ')
 OR nullif(unb#>>'{elements,3,0}','') IS NULL OR unb#>>'{elements,3,0}'<>btrim(unb#>>'{elements,3,0}') THEN RETURN NULL; END IF;
 -- Enumerate and validate EVERY physical LIN before matching caller scope.
 -- No caller offset or object ID selects an alleged segment as authority.
 FOR token IN SELECT t FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' ORDER BY (t->>'index')::integer LOOP
  e:=token->'elements';stop_index:=(token->>'index')::integer;
  IF stop_index<=1 OR stop_index>=n-2 OR jsonb_array_length(e)<>4
  OR e->1 IS DISTINCT FROM jsonb_build_array((line_index+1)::text)
  OR jsonb_array_length(e->3) IS DISTINCT FROM 4 OR nullif(e#>>'{3,0}','') IS NULL
  OR e#>>'{3,3}' IS DISTINCT FROM '9' OR e#>>'{3,1}' IS DISTINCT FROM '' OR e#>>'{3,2}' IS DISTINCT FROM ''
  THEN RETURN NULL; END IF;
  identity_value:=jsonb_build_array(e#>>'{3,0}',e#>>'{3,3}');
  IF identities @> jsonb_build_array(identity_value) THEN RETURN NULL; END IF;
  identities:=identities||jsonb_build_array(identity_value);
  object_value:=jsonb_build_object('messageIndex',0,'messageReference',unh#>>'{elements,1,0}',
    'objectId',e#>>'{3,0}','identityAgency',e#>>'{3,3}','registers',jsonb_build_array(jsonb_build_object(
      'lineIndex',line_index,'lineNumber',e#>>'{1,0}','registerIndex',NULL,'registerPosition',1,'segmentIndex',stop_index)));
  IF object_value=p_object THEN selected_object:=object_value;chosen_index:=stop_index; END IF;
  line_index:=line_index+1;
 END LOOP;
 IF selected_object IS NULL THEN RETURN NULL; END IF;
 SELECT min((t->>'index')::integer) INTO next_line FROM jsonb_array_elements(tokens) t
 WHERE (t->>'index')::integer>chosen_index AND t->>'tag' IN ('LIN','UNT');
 SELECT coalesce(min((t->>'index')::integer),next_line) INTO common_end FROM jsonb_array_elements(tokens) t
 WHERE (t->>'index')::integer>chosen_index AND (t->>'index')::integer<next_line AND t->>'tag' IN ('RFF','NAD');
 SELECT coalesce(min((t->>'index')::integer),next_line) INTO reference_end FROM jsonb_array_elements(tokens) t
 WHERE (t->>'index')::integer>chosen_index AND (t->>'index')::integer<next_line AND t->>'tag'='NAD';
 FOR token IN SELECT t FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::integer>chosen_index AND (t->>'index')::integer<next_line LOOP
  e:=token->'elements';stop_index:=(token->>'index')::integer;
  IF stop_index<common_end AND token->>'tag'='DTM' AND e#>>'{1,0}'='93' THEN
   date_count:=date_count+1;selected_date:=e->1;
  END IF;
  IF stop_index<common_end AND token->>'tag'='CCI' AND e#>'{2}'='["Z13"]'::jsonb THEN
   reason_count:=reason_count+1;
   IF stop_index+1>=common_end OR tokens->(stop_index+1)->>'tag'<>'CAV' THEN RETURN NULL; END IF;
   selected_reason:=tokens->(stop_index+1)#>'{elements,1}';
  END IF;
  IF stop_index<reference_end AND token->>'tag'='RFF' AND e#>>'{1,0}'='LI' THEN
   reference_count:=reference_count+1;selected_reference:=e->1;
  END IF;
 END LOOP;
 IF date_count<>1 OR reason_count<>1 OR reference_count>1 OR jsonb_array_length(selected_date) IS DISTINCT FROM 3
 OR selected_date->>2 IS DISTINCT FROM '203' OR jsonb_array_length(selected_reason) IS DISTINCT FROM 1
 OR (reference_count=1 AND (jsonb_array_length(selected_reference) IS DISTINCT FROM 2 OR nullif(selected_reference->>1,'') IS NULL)) THEN RETURN NULL; END IF;
 minute:=selected_date->>1;reason:=selected_reason->>0;
 IF minute IS NULL OR minute !~ '^[0-9]{12}$' OR substring(minute,1,4)::int<1 OR substring(minute,9,2)::int>23 OR substring(minute,11,2)::int>59 THEN RETURN NULL; END IF;
 market_time:=make_timestamp(substring(minute,1,4)::int,substring(minute,5,2)::int,substring(minute,7,2)::int,substring(minute,9,2)::int,substring(minute,11,2)::int,0);
 utc_value:=market_time AT TIME ZONE 'Etc/GMT-1';
 IF NOT isfinite(utc_value) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('wire',jsonb_build_object('object',selected_object,'messageCode','Z05','reason',reason,
  'functionCode',nullif(bgm#>>'{elements,3,0}',''),'documentReference',bgm#>>'{elements,2,0}','caseReference',selected_reference->>1,
  'effectiveTo',jsonb_build_object('fieldNumber','211','marketMinute',minute,'utc',to_char(utc_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  'legalSender',fr#>>'{2,0}','legalReceiver',receiver#>>'{2,0}',
  'transportSender',unb#>>'{elements,2,0}','transportReceiver',unb#>>'{elements,3,0}',
  'transportSenderQualifier',unb#>>'{elements,2,1}','transportReceiverQualifier',unb#>>'{elements,3,1}'),
  'syntax',unb#>'{elements,1}','messageType',unh#>'{elements,2}',
  'objectCount',line_index,'caseReferenceCount',reference_count);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.z05_wire_structure_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the L/LK contract and its existing accepted shapes. This policy
-- requires exactly one LI and cannot promote Z24, even though the neutral
-- decoder can observe it. No published migration or TypeScript owner changes.
CREATE OR REPLACE FUNCTION gridex_received_sources.closure_wire_projection_v1(p_raw text,p_object jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE decoded jsonb:=gridex_received_sources.z05_wire_structure_v1(p_raw,p_object); wire jsonb;
BEGIN
 IF decoded IS NULL OR decoded#>>'{wire,reason}' NOT IN ('Z22','Z23')
 OR decoded->>'caseReferenceCount'<>'1' THEN RETURN NULL; END IF;
 wire:=decoded->'wire';
 RETURN wire||jsonb_build_object('subtype',CASE wire->>'reason' WHEN 'Z22' THEN 'L' ELSE 'LK' END);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.closure_wire_projection_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- C's observational gate is deliberately narrower: a supported physical
-- namespace, one direct object and optional LI. A tuple with missing, extra,
-- different or empty components cannot supply exact concern scope.
CREATE FUNCTION gridex_received_sources.correction_wire_exact_v1(p_raw text,p_object jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE decoded jsonb:=gridex_received_sources.z05_wire_structure_v1(p_raw,p_object); wire jsonb;
BEGIN
 IF decoded IS NULL OR decoded->'syntax' IS DISTINCT FROM '["UNOC","3"]'::jsonb
 OR decoded->'messageType' IS DISTINCT FROM '["PRODAT","D","97A","UN","E2SE6A"]'::jsonb
 OR decoded->>'objectCount'<>'1' OR decoded#>>'{wire,reason}' IS DISTINCT FROM 'Z24'
 OR decoded#>>'{wire,transportReceiver}' IS DISTINCT FROM decoded#>>'{wire,legalReceiver}'
 THEN RETURN NULL; END IF;
 wire:=decoded->'wire';
 RETURN wire||jsonb_build_object('subtype','C');
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.correction_wire_exact_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_received_sources.correction_wire_observation_v1(p_raw text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v1(p_raw); line jsonb; obj jsonb; wire jsonb;
 result jsonb:=jsonb_build_object('objectId',NULL,'identityAgency',NULL,'legalSender',NULL,'legalReceiver',NULL,
  'caseReference',NULL,'candidateTarget',NULL,'oldStop',jsonb_build_object('kind','unknown'),
  'proposedStop',jsonb_build_object('kind','unknown'),'observedSourceStop',jsonb_build_object('kind','unknown'),'disposition','unreviewed');
BEGIN
 IF tokens IS NULL THEN RETURN result; END IF;
 SELECT t INTO line FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN' ORDER BY (t->>'index')::int LIMIT 1;
 IF line IS NULL THEN RETURN result; END IF;
 obj:=jsonb_build_object('messageIndex',0,'messageReference',tokens#>>'{1,elements,1,0}',
  'objectId',line#>>'{elements,3,0}','identityAgency',line#>>'{elements,3,3}',
  'registers',jsonb_build_array(jsonb_build_object('lineIndex',0,'lineNumber',line#>>'{elements,1,0}',
   'registerIndex',NULL,'registerPosition',1,'segmentIndex',(line->>'index')::int)));
 wire:=gridex_received_sources.correction_wire_exact_v1(p_raw,obj);
 IF wire IS NULL OR EXISTS(SELECT FROM unnest(ARRAY[obj->>'objectId',wire->>'legalSender',wire->>'legalReceiver']) v
  WHERE length(v)>128 OR v<>btrim(v) OR v ~ '[[:cntrl:]]') THEN RETURN result; END IF;
 -- A C date alone cannot establish the old L/LK target boundary. Keep oldStop
 -- unknown; only a later, independently linked target owner can enrich it.
 -- A bare, completely read C has no separate proposed date. Any additional
 -- free text/date or unfamiliar grammar stays unknown, hence whole-interval hold.
 result:=result||jsonb_build_object('objectId',obj->>'objectId','identityAgency','9',
  'legalSender',wire->>'legalSender','legalReceiver',wire->>'legalReceiver','caseReference',wire->>'caseReference',
  'observedSourceStop',jsonb_build_object('kind','known','utc',wire#>>'{effectiveTo,utc}'));
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE
  t->>'tag' NOT IN ('UNB','UNH','BGM','DTM','NAD','LIN','CCI','CAV','RFF','UNT','UNZ')
  OR (t->>'tag'='DTM' AND t#>>'{elements,1,0}' NOT IN ('137','ZZZ','93'))
  OR (t->>'tag'='RFF' AND t#>>'{elements,1,0}' NOT IN ('Z05','LI')))
  AND (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='93')=1
  AND (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CCI')=1
  AND (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='CAV')=1
 THEN result:=result||jsonb_build_object('proposedStop',jsonb_build_object('kind','not_asserted')); END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.correction_wire_observation_v1(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE gridex_received_sources.correction_concerns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_message_id uuid NOT NULL REFERENCES gridex_received_sources.sources(source_message_id) ON DELETE RESTRICT,
 company_id uuid NOT NULL, environment text NOT NULL CHECK(environment IN ('test','production')),
 source_payload_hash text NOT NULL CHECK(source_payload_hash ~ '^[a-f0-9]{64}$'),
 actor_user_id uuid NOT NULL,
 source_received_at timestamptz NOT NULL, source_captured_at timestamptz NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 rule_version text NOT NULL DEFAULT 'sealed-z05-concern-v1' CHECK(rule_version='sealed-z05-concern-v1'),
 previous_capture_id uuid REFERENCES gridex_received_sources.correction_concerns(id) ON DELETE RESTRICT,
 facts jsonb NOT NULL CHECK(jsonb_typeof(facts)='object' AND octet_length(facts::text)<=262144),
 facts_hash text NOT NULL CHECK(facts_hash=encode(sha256(convert_to(facts::text,'UTF8')),'hex')),
 disposition text NOT NULL DEFAULT 'unreviewed' CHECK(disposition='unreviewed'),
 UNIQUE(source_message_id,rule_version),
 CHECK(captured_at>=source_captured_at)
);
-- v1 derives only immutable original facts. Same source is idempotent regardless
-- of actor or mutable linkage. Later evidence owners must append, never UPDATE.
CREATE INDEX correction_concerns_scope ON gridex_received_sources.correction_concerns(company_id,environment,captured_at,id);
CREATE TABLE gridex_received_sources.correction_witnesses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 capture_id uuid NOT NULL UNIQUE REFERENCES gridex_received_sources.correction_concerns(id) ON DELETE RESTRICT,
 company_id uuid NOT NULL, environment text NOT NULL CHECK(environment IN ('test','production')),
 facts_hash text NOT NULL, observed_at timestamptz NOT NULL DEFAULT clock_timestamp(), visibility_snapshot text NOT NULL
);
CREATE INDEX correction_witnesses_scope ON gridex_received_sources.correction_witnesses(company_id,environment,observed_at,id);
DO $security$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['correction_concerns','correction_witnesses'] LOOP
  EXECUTE format('ALTER TABLE gridex_received_sources.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE gridex_received_sources.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON gridex_received_sources.%I FROM PUBLIC,anon,authenticated,service_role',tab);
  EXECUTE format('CREATE TRIGGER immutable_update_delete BEFORE UPDATE OR DELETE ON gridex_received_sources.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',tab);
  EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_received_sources.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',tab);
 END LOOP;
END $security$;
CREATE FUNCTION gridex_received_sources.correction_receipt_v1(c gridex_received_sources.correction_concerns)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('version',1,'captureId',c.id,'companyId',c.company_id,'environment',c.environment,
  'sourceMessageId',c.source_message_id,'contentHash',c.source_payload_hash,'factsHash',c.facts_hash,
  'capturedAt',c.captured_at,'disposition','unreviewed')
$$;
REVOKE ALL ON FUNCTION gridex_received_sources.correction_receipt_v1(gridex_received_sources.correction_concerns) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_received_sources.capture_correction_concern_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE src gridex_received_sources.sources%rowtype; captured gridex_received_sources.correction_concerns%rowtype; observation jsonb; body jsonb;
BEGIN
 IF p_company_id IS NULL OR p_source_message_id IS NULL OR p_actor_user_id IS NULL OR p_environment IS NULL OR p_environment NOT IN ('test','production')
 OR NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'communication.write'),false)
 OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=p_actor_user_id AND user_status='active')
 OR NOT EXISTS(SELECT FROM public.companies WHERE id=p_company_id AND coalesce(is_active,true)
  AND coalesce(status,'active') NOT IN ('archived','suspended','pending_deletion','deleted','deleted_test_only','inactive','paused','closed'))
 THEN RAISE EXCEPTION 'correction_capture_actor_unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO src FROM gridex_received_sources.sources WHERE source_message_id=p_source_message_id
  AND company_id=p_company_id AND environment=p_environment;
 IF NOT FOUND OR src.origin<>'database_insert' OR src.message_code IS DISTINCT FROM 'Z05' OR src.source_received_at IS NULL
 OR src.raw_payload IS NULL OR octet_length(src.raw_payload)>2097152 OR src.payload_hash IS NULL
 OR src.payload_hash IS DISTINCT FROM encode(sha256(convert_to(src.raw_payload,'UTF8')),'hex')
 OR NOT coalesce(src.received_context @> jsonb_build_object('version',1,'contextOrigin','database_insert',
  'sourceMessageId',src.source_message_id,'companyId',src.company_id,'environment',src.environment,'messageCode','Z05','payloadHash',src.payload_hash),false)
 OR (src.received_context->>'sourceReceivedAt')::timestamptz IS DISTINCT FROM src.source_received_at
 OR (src.received_context->>'capturedAt') IS NULL
 OR NOT isfinite((src.received_context->>'capturedAt')::timestamptz)
 OR (src.received_context->>'capturedAt')::timestamptz>src.captured_at
 THEN RAISE EXCEPTION 'correction_sealed_original_unavailable' USING ERRCODE='23514'; END IF;
 -- This is observational registration, not canonical review. Unsupported or
 -- malformed sealed Z05s remain visible as wildcard concerns, never exclusions.
 observation:=gridex_received_sources.correction_wire_observation_v1(src.raw_payload);
 body:=jsonb_build_object('version',1,'owner','sealed-z05-concern-v1','sourceMessageId',src.source_message_id,
  'sourcePayloadHash',src.payload_hash,'sourceReceivedAt',src.source_received_at,'sourceCapturedAt',src.captured_at,
  'scope',jsonb_build_object('companyId',src.company_id,'environment',src.environment,'customerId',NULL,'supplyPeriodId',NULL,
   'objectId',observation->'objectId','identityAgency',observation->'identityAgency',
   'legalSender',observation->'legalSender','legalReceiver',observation->'legalReceiver'),
  'oldStop',observation->'oldStop','proposedStop',observation->'proposedStop',
  'observedSourceStop',observation->'observedSourceStop','caseReference',observation->'caseReference',
  'candidateTarget',NULL,'disposition','unreviewed','provenance',jsonb_build_object('channel','sealed_inbound_original','authentication','unknown'),
  'retention',jsonb_build_object('sourceCategory','edifact_raw_payloads','coverage','not_established','documentBytes','unavailable'));
 INSERT INTO gridex_received_sources.correction_concerns(source_message_id,company_id,environment,source_payload_hash,actor_user_id,
  source_received_at,source_captured_at,facts,facts_hash)
 VALUES(src.source_message_id,src.company_id,src.environment,src.payload_hash,p_actor_user_id,src.source_received_at,src.captured_at,
  body,encode(sha256(convert_to(body::text,'UTF8')),'hex')) ON CONFLICT(source_message_id,rule_version) DO NOTHING;
 SELECT * INTO STRICT captured FROM gridex_received_sources.correction_concerns WHERE source_message_id=src.source_message_id AND rule_version='sealed-z05-concern-v1';
 IF captured.facts IS DISTINCT FROM body THEN RAISE EXCEPTION 'correction_original_facts_changed' USING ERRCODE='23514'; END IF;
 RETURN gridex_received_sources.correction_receipt_v1(captured);
END $$;
CREATE FUNCTION public.gridex_capture_correction_concern_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'correction_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_received_sources.capture_correction_concern_v1(p_company_id,p_environment,p_source_message_id,p_actor_user_id);
END $$;
CREATE FUNCTION gridex_received_sources.witness_correction_concern_v1(p_company_id uuid,p_environment text,p_capture_id uuid,p_facts_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE captured gridex_received_sources.correction_concerns%rowtype; witness gridex_received_sources.correction_witnesses%rowtype; snap text;
BEGIN
 SELECT c.* INTO captured FROM gridex_received_sources.correction_concerns c
 WHERE c.id=p_capture_id AND c.company_id=p_company_id AND c.environment=p_environment AND c.facts_hash=p_facts_hash
  AND c.created_xid<>pg_current_xact_id();
 IF captured.id IS NULL THEN RAISE EXCEPTION 'correction_availability_unproven' USING ERRCODE='23514'; END IF;
 snap:=pg_current_snapshot()::text;
 INSERT INTO gridex_received_sources.correction_witnesses(capture_id,company_id,environment,facts_hash,visibility_snapshot)
 VALUES(captured.id,captured.company_id,captured.environment,captured.facts_hash,snap) ON CONFLICT(capture_id) DO NOTHING;
 SELECT * INTO STRICT witness FROM gridex_received_sources.correction_witnesses WHERE capture_id=captured.id;
 RETURN gridex_received_sources.correction_receipt_v1(captured)||jsonb_build_object('witnessId',witness.id,'availableAt',witness.observed_at);
END $$;
CREATE FUNCTION public.gridex_witness_correction_concern_v1(p_company_id uuid,p_environment text,p_capture_id uuid,p_facts_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'correction_service_required' USING ERRCODE='42501'; END IF;
 RETURN gridex_received_sources.witness_correction_concern_v1(p_company_id,p_environment,p_capture_id,p_facts_hash);
END $$;
REVOKE ALL ON FUNCTION gridex_received_sources.capture_correction_concern_v1(uuid,text,uuid,uuid),public.gridex_capture_correction_concern_v1(uuid,text,uuid,uuid),gridex_received_sources.witness_correction_concern_v1(uuid,text,uuid,text),public.gridex_witness_correction_concern_v1(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_received_sources.capture_correction_concern_v1(uuid,text,uuid,uuid),public.gridex_capture_correction_concern_v1(uuid,text,uuid,uuid),gridex_received_sources.witness_correction_concern_v1(uuid,text,uuid,text),public.gridex_witness_correction_concern_v1(uuid,text,uuid,text) TO service_role;
COMMIT;
