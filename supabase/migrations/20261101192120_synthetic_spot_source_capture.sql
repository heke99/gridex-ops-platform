-- Stage 1 only: explicitly synthetic originals and immutable review history.
-- No catalog, source policy, price interval, pricing, settlement or invoice writes.
BEGIN;

CREATE SCHEMA gridex_synthetic_spot_sources;
REVOKE ALL ON SCHEMA gridex_synthetic_spot_sources FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE gridex_synthetic_spot_sources.originals (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 request_key uuid NOT NULL,
 original_bytes bytea NOT NULL CHECK(octet_length(original_bytes) BETWEEN 1 AND 1048576),
 original_sha256 text GENERATED ALWAYS AS (encode(sha256(original_bytes),'hex')) STORED,
 source_version text NOT NULL, billing_month text NOT NULL, price_area text NOT NULL, resolution text NOT NULL,
 period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
 interval_count integer NOT NULL, expected_interval_count integer NOT NULL, covered_minutes integer NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(), capture_event_id uuid NOT NULL,
 UNIQUE(company_id,actor_user_id,request_key),
 UNIQUE(company_id,source_version,billing_month,price_area,resolution),
 UNIQUE(id,company_id)
);
CREATE TABLE gridex_synthetic_spot_sources.events (
 id uuid PRIMARY KEY, source_id uuid NOT NULL, company_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES auth.users(id), request_key uuid NOT NULL,
 event_number bigint NOT NULL CHECK(event_number>0),
 decision text NOT NULL CHECK(decision IN('capture','hold','reject','review_capture')),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500),
 expected_previous_event_id uuid, previous_event_id uuid REFERENCES gridex_synthetic_spot_sources.events(id),
 previous_event_sha256 text, event_sha256 text NOT NULL,
 created_at timestamptz NOT NULL,
 FOREIGN KEY(source_id,company_id) REFERENCES gridex_synthetic_spot_sources.originals(id,company_id),
 UNIQUE(source_id,event_number), UNIQUE(company_id,actor_user_id,request_key),
 CHECK((event_number=1 AND decision='capture' AND previous_event_id IS NULL AND previous_event_sha256 IS NULL)
    OR (event_number>1 AND decision<>'capture' AND previous_event_id IS NOT NULL AND previous_event_sha256 IS NOT NULL))
);
ALTER TABLE gridex_synthetic_spot_sources.originals ADD CONSTRAINT synthetic_spot_capture_event_fk
 FOREIGN KEY(capture_event_id) REFERENCES gridex_synthetic_spot_sources.events(id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION gridex_synthetic_spot_sources.immutable_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='synthetic_spot_immutable';
END$$;
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['originals','events'] LOOP
  EXECUTE format('ALTER TABLE gridex_synthetic_spot_sources.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE gridex_synthetic_spot_sources.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON gridex_synthetic_spot_sources.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON gridex_synthetic_spot_sources.%I FOR EACH ROW EXECUTE FUNCTION gridex_synthetic_spot_sources.immutable_v1()',t);
  EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON gridex_synthetic_spot_sources.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_synthetic_spot_sources.immutable_v1()',t);
 END LOOP;
END$$;

CREATE FUNCTION gridex_synthetic_spot_sources.authorize_v1(c uuid,a uuid,writing boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 -- A permission revocation cannot interleave with a successful command. Every
 -- RPC takes this same bounded graph order before locking an archive subject.
 LOCK TABLE auth.users, public.user_profiles, public.companies, public.company_memberships,
  public.permissions, public.admin_users, public.roles, public.user_roles, public.role_permissions,
  public.user_permissions, public.user_permission_overrides IN SHARE MODE;
 IF c IS NULL OR a IS NULL OR writing IS NULL
  OR public.canonical_actor_is_platform_admin(a) IS DISTINCT FROM false
  OR NOT EXISTS(SELECT FROM auth.users u WHERE u.id=a AND u.email_confirmed_at IS NOT NULL
    AND u.email_confirmed_at<=clock_timestamp() AND u.deleted_at IS NULL
    AND u.is_anonymous IS FALSE AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp()))
  OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=a AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.companies co WHERE co.id=c AND co.status='active' AND co.is_active IS TRUE)
  OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=a
    AND m.status='active' AND m.is_active IS TRUE AND m.accepted_at IS NOT NULL AND m.accepted_at<=clock_timestamp())
  OR NOT (public.gridex_actor_has_company_permission(a,c,'pricing.write') IS TRUE
       OR NOT writing AND public.gridex_actor_has_company_permission(a,c,'pricing.read') IS TRUE)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='synthetic_spot_actor_denied';END IF;
END$$;

CREATE FUNCTION gridex_synthetic_spot_sources.unique_json_v1(value json,depth integer DEFAULT 0) RETURNS void
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE child json;BEGIN
 IF depth>32 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_json_depth';END IF;
 IF json_typeof(value)='object' THEN
  IF EXISTS(SELECT FROM json_each(value) GROUP BY key HAVING count(*)>1) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_duplicate_json_key';END IF;
  FOR child IN SELECT v.value FROM json_each(value) v LOOP
   PERFORM gridex_synthetic_spot_sources.unique_json_v1(child,depth+1);
  END LOOP;
 ELSIF json_typeof(value)='array' THEN
  FOR child IN SELECT v.value FROM json_array_elements(value) v LOOP
   PERFORM gridex_synthetic_spot_sources.unique_json_v1(child,depth+1);
  END LOOP;
 END IF;
END$$;

CREATE FUNCTION gridex_synthetic_spot_sources.parse_original_v1(bytes bytea) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE j json; data jsonb; item jsonb; month_start date; period_start timestamptz; period_end timestamptz;
 step_minutes integer; expected integer; n integer:=0; prior timestamptz; at timestamptz; until_at timestamptz; price numeric; k text;
BEGIN
 IF bytes IS NULL OR octet_length(bytes) NOT BETWEEN 1 AND 1048576 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_original_size';END IF;
 BEGIN j:=convert_from(bytes,'UTF8')::json;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_invalid_utf8_json';END;
 BEGIN
  PERFORM gridex_synthetic_spot_sources.unique_json_v1(j);
  data:=j::jsonb;
 EXCEPTION WHEN SQLSTATE '22023' THEN RAISE;
  WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_invalid_json_unicode';
 END;
 IF jsonb_typeof(data) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_original_schema';END IF;
 FOREACH k IN ARRAY ARRAY['schema','declaration','sourceVersion','billingMonth','civilZone','priceArea','resolution','currency'] LOOP
  IF jsonb_typeof(data->k) IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_original_schema';END IF;
 END LOOP;
 -- Eight scalar fields plus intervals = nine keys; exact key-vector is checked
 -- below rather than trusting an adapter-provided parsed/normalized manifest.
 IF (SELECT count(*) FROM jsonb_object_keys(data))<>9 OR NOT data ?& ARRAY['schema','declaration','sourceVersion','billingMonth','civilZone','priceArea','resolution','currency','intervals']
  OR EXISTS(SELECT FROM jsonb_object_keys(data) key WHERE key NOT IN('schema','declaration','sourceVersion','billingMonth','civilZone','priceArea','resolution','currency','intervals'))
  OR data->>'schema'<>'gridex-synthetic-spot-source-v1'
  OR data->>'declaration'<>'SYNTHETIC_TEST_DATA_NOT_MARKET_ORIGINAL'
  OR (data->>'sourceVersion') COLLATE "C" !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  OR (data->>'billingMonth') COLLATE "C" !~ '^(19[0-9]{2}|20[0-9]{2}|2100)-(0[1-9]|1[0-2])$'
  OR data->>'civilZone'<>'Europe/Stockholm' OR (data->>'priceArea' IN('SE1','SE2','SE3','SE4')) IS NOT TRUE
  OR (data->>'resolution' IN('PT60M','PT15M')) IS NOT TRUE OR data->>'currency'<>'SEK_PER_KWH'
  OR jsonb_typeof(data->'intervals') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_original_schema';END IF;
 month_start:=((data->>'billingMonth')||'-01')::date;
 period_start:=month_start::timestamp AT TIME ZONE 'Europe/Stockholm';
 period_end:=(month_start+interval '1 month')::timestamp AT TIME ZONE 'Europe/Stockholm';
 step_minutes:=CASE data->>'resolution' WHEN 'PT15M' THEN 15 ELSE 60 END;
 expected:=(extract(epoch FROM period_end-period_start)/60/step_minutes)::integer;
 IF jsonb_array_length(data->'intervals')<>expected THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_interval_count';END IF;
 prior:=period_start;
 FOR item IN SELECT value FROM jsonb_array_elements(data->'intervals') LOOP
  IF (CASE WHEN jsonb_typeof(item)='object' THEN (SELECT count(*) FROM jsonb_object_keys(item)) ELSE -1 END)<>3
   OR NOT item ?& ARRAY['start','end','priceSekPerKwh']
   OR jsonb_typeof(item->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'end') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'priceSekPerKwh') IS DISTINCT FROM 'string'
   OR (item->>'start') COLLATE "C" !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:00[.]000Z$'
   OR (item->>'end') COLLATE "C" !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:00[.]000Z$'
   OR (item->>'priceSekPerKwh') COLLATE "C" !~ '^-?(0|[1-9][0-9]{0,5})([.][0-9]{1,6})?$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_interval_schema';END IF;
  BEGIN at:=(item->>'start')::timestamptz;until_at:=(item->>'end')::timestamptz;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_interval_time';END;
  IF to_char(at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>item->>'start'
   OR to_char(until_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>item->>'end'
   OR at<>prior OR until_at-at<>make_interval(mins=>step_minutes) OR until_at>period_end THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_interval_coverage';END IF;
  price:=(item->>'priceSekPerKwh')::numeric;
  IF abs(price)>100000 OR price=0 AND left(item->>'priceSekPerKwh',1)='-' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_price_range';END IF;
  prior:=until_at;n:=n+1;
 END LOOP;
 IF prior<>period_end THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_interval_coverage';END IF;
 RETURN jsonb_build_object('source_version',data->>'sourceVersion','billing_month',data->>'billingMonth',
  'price_area',data->>'priceArea','resolution',data->>'resolution','period_start',period_start,'period_end',period_end,
  'interval_count',n,'expected_interval_count',expected,'covered_minutes',extract(epoch FROM period_end-period_start)::integer/60);
END$$;

CREATE FUNCTION gridex_synthetic_spot_sources.receipt_v1(source uuid,replayed boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s gridex_synthetic_spot_sources.originals%rowtype; e gridex_synthetic_spot_sources.events%rowtype;BEGIN
 SELECT * INTO STRICT s FROM gridex_synthetic_spot_sources.originals WHERE id=source;
 SELECT * INTO STRICT e FROM gridex_synthetic_spot_sources.events WHERE source_id=source ORDER BY event_number DESC LIMIT 1;
 RETURN jsonb_build_object('source_id',s.id,'original_sha256',s.original_sha256,'source_version',s.source_version,
  'billing_month',s.billing_month,'price_area',s.price_area,'resolution',s.resolution,
  'period_start',to_char(s.period_start,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'period_end',to_char(s.period_end,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'interval_count',s.interval_count,'expected_interval_count',s.expected_interval_count,'covered_minutes',s.covered_minutes,
  'original_byte_length',octet_length(s.original_bytes),'capture_event_id',s.capture_event_id,
  'latest_event_id',e.id,'latest_event_sha256',e.event_sha256,
  'status',CASE e.decision WHEN 'capture' THEN 'captured' WHEN 'hold' THEN 'held' WHEN 'reject' THEN 'rejected' ELSE 'reviewed_capture_only' END,
  'consumer_enabled',false,'replayed',replayed);
END$$;

CREATE FUNCTION gridex_synthetic_spot_sources.append_v1(source uuid,c uuid,a uuid,request uuid,
 decision text,reason text,expected uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE prior gridex_synthetic_spot_sources.events%rowtype; eid uuid:=gen_random_uuid();at timestamptz:=clock_timestamp(); seq bigint; hash text;BEGIN
 SELECT * INTO prior FROM gridex_synthetic_spot_sources.events WHERE source_id=source ORDER BY event_number DESC LIMIT 1;
 seq:=coalesce(prior.event_number,0)+1;
 hash:=encode(sha256(convert_to(jsonb_build_object('original_sha256',(SELECT original_sha256 FROM gridex_synthetic_spot_sources.originals WHERE id=source),
  'id',eid,'source_id',source,'company_id',c,'actor_user_id',a,
  'request_key',request,'event_number',seq,'decision',decision,'reason',reason,'expected_previous_event_id',expected,
  'previous_event_id',prior.id,'previous_event_sha256',prior.event_sha256,'created_at',at)::text,'UTF8')),'hex');
 INSERT INTO gridex_synthetic_spot_sources.events VALUES(eid,source,c,a,request,seq,decision,reason,expected,prior.id,prior.event_sha256,hash,at);
 RETURN eid;
END$$;

CREATE FUNCTION public.gridex_capture_synthetic_spot_source_v1(p_company_id uuid,p_actor_user_id uuid,p_request_key uuid,p_original_base64 text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE bytes bytea; manifest jsonb; prior gridex_synthetic_spot_sources.originals%rowtype; sid uuid:=gen_random_uuid();capture_id uuid;BEGIN
 PERFORM gridex_synthetic_spot_sources.authorize_v1(p_company_id,p_actor_user_id,true);
 IF p_request_key IS NULL OR p_original_base64 IS NULL OR octet_length(p_original_base64)>1398104 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_capture_input';END IF;
 BEGIN bytes:=decode(p_original_base64,'base64');
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_invalid_base64';END;
 manifest:=gridex_synthetic_spot_sources.parse_original_v1(bytes);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||p_actor_user_id::text||p_request_key::text,0));
 SELECT * INTO prior FROM gridex_synthetic_spot_sources.originals
  WHERE company_id=p_company_id AND actor_user_id=p_actor_user_id AND request_key=p_request_key;
 IF FOUND THEN
  IF prior.original_bytes<>bytes THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='synthetic_spot_command_conflict';END IF;
  RETURN gridex_synthetic_spot_sources.receipt_v1(prior.id,true);
 END IF;
 capture_id:=gen_random_uuid();
 INSERT INTO gridex_synthetic_spot_sources.originals(id,company_id,actor_user_id,request_key,original_bytes,source_version,billing_month,
  price_area,resolution,period_start,period_end,interval_count,expected_interval_count,covered_minutes,capture_event_id)
 VALUES(sid,p_company_id,p_actor_user_id,p_request_key,bytes,manifest->>'source_version',manifest->>'billing_month',manifest->>'price_area',manifest->>'resolution',
 (manifest->>'period_start')::timestamptz,(manifest->>'period_end')::timestamptz,(manifest->>'interval_count')::integer,
 (manifest->>'expected_interval_count')::integer,(manifest->>'covered_minutes')::integer,capture_id);
 -- Capture identity is reserved before insert; the deferred FK makes source,
 -- immutable bytes and its first event atomic without rewriting the original.
 INSERT INTO gridex_synthetic_spot_sources.events(id,source_id,company_id,actor_user_id,request_key,event_number,decision,reason,event_sha256,created_at)
 SELECT capture_id,sid,p_company_id,p_actor_user_id,p_request_key,1,'capture','Synthetic capture; consumer disabled',
 encode(sha256(convert_to(jsonb_build_object('original_sha256',encode(sha256(bytes),'hex'),'id',capture_id,'source_id',sid,'company_id',p_company_id,'actor_user_id',p_actor_user_id,
 'request_key',p_request_key,'event_number',1,'decision','capture','reason','Synthetic capture; consumer disabled',
 'expected_previous_event_id',NULL,'previous_event_id',NULL,'previous_event_sha256',NULL,'created_at',t.at)::text,'UTF8')),'hex'),t.at
 FROM (SELECT clock_timestamp() at) t;
 RETURN gridex_synthetic_spot_sources.receipt_v1(sid,false);
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='synthetic_spot_capture_conflict';
END$$;

CREATE FUNCTION public.gridex_read_synthetic_spot_source_v1(p_company_id uuid,p_actor_user_id uuid,p_source_id uuid,p_include_original boolean,p_request_key uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$DECLARE s gridex_synthetic_spot_sources.originals%rowtype;r jsonb;BEGIN
 PERFORM gridex_synthetic_spot_sources.authorize_v1(p_company_id,p_actor_user_id,false);
 IF p_include_original IS NULL OR (p_source_id IS NULL)=(p_request_key IS NULL) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_read_input';END IF;
 SELECT * INTO s FROM gridex_synthetic_spot_sources.originals o WHERE o.company_id=p_company_id
  AND (p_source_id IS NOT NULL AND o.id=p_source_id
       OR p_request_key IS NOT NULL AND o.actor_user_id=p_actor_user_id AND o.request_key=p_request_key) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='synthetic_spot_source_not_found';END IF;
 r:=gridex_synthetic_spot_sources.receipt_v1(s.id,false);
 IF p_include_original THEN r:=r||jsonb_build_object('original_base64',replace(encode(s.original_bytes,'base64'),E'\n',''));END IF;
 RETURN r;
END$$;

CREATE FUNCTION public.gridex_review_synthetic_spot_source_v1(p_company_id uuid,p_actor_user_id uuid,p_source_id uuid,p_request_key uuid,
 p_expected_previous_event_id uuid,p_decision text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s gridex_synthetic_spot_sources.originals%rowtype;prior gridex_synthetic_spot_sources.events%rowtype;
 replay gridex_synthetic_spot_sources.events%rowtype;eid uuid;BEGIN
 PERFORM gridex_synthetic_spot_sources.authorize_v1(p_company_id,p_actor_user_id,true);
 IF p_request_key IS NULL OR p_expected_previous_event_id IS NULL OR (p_decision IN('hold','reject','review_capture')) IS NOT TRUE
  OR p_reason IS NULL OR char_length(p_reason) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='synthetic_spot_review_input';END IF;
 SELECT * INTO s FROM gridex_synthetic_spot_sources.originals WHERE id=p_source_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='synthetic_spot_source_not_found';END IF;
 IF s.actor_user_id=p_actor_user_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='synthetic_spot_independent_reviewer_required';END IF;
 SELECT * INTO replay FROM gridex_synthetic_spot_sources.events WHERE company_id=p_company_id AND actor_user_id=p_actor_user_id AND request_key=p_request_key;
 IF FOUND THEN
  IF replay.source_id<>s.id OR replay.expected_previous_event_id IS DISTINCT FROM p_expected_previous_event_id
   OR replay.decision<>p_decision OR replay.reason<>p_reason THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='synthetic_spot_review_command_conflict';END IF;
  RETURN gridex_synthetic_spot_sources.receipt_v1(s.id,true)||jsonb_build_object('event_id',replay.id,'decision',replay.decision);
 END IF;
 SELECT * INTO STRICT prior FROM gridex_synthetic_spot_sources.events WHERE source_id=s.id ORDER BY event_number DESC LIMIT 1;
 IF prior.id<>p_expected_previous_event_id OR prior.decision='reject' OR prior.decision='review_capture' AND p_decision='review_capture' THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='synthetic_spot_review_predecessor_or_transition_conflict';END IF;
 eid:=gridex_synthetic_spot_sources.append_v1(s.id,p_company_id,p_actor_user_id,p_request_key,p_decision,p_reason,p_expected_previous_event_id);
 RETURN gridex_synthetic_spot_sources.receipt_v1(s.id,false)||jsonb_build_object('event_id',eid,'decision',p_decision);
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='synthetic_spot_review_conflict';
END$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_synthetic_spot_sources FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gridex_capture_synthetic_spot_source_v1(uuid,uuid,uuid,text),
 public.gridex_read_synthetic_spot_source_v1(uuid,uuid,uuid,boolean,uuid),
 public.gridex_review_synthetic_spot_source_v1(uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_capture_synthetic_spot_source_v1(uuid,uuid,uuid,text),
 public.gridex_read_synthetic_spot_source_v1(uuid,uuid,uuid,boolean,uuid),
 public.gridex_review_synthetic_spot_source_v1(uuid,uuid,uuid,uuid,uuid,text,text) TO service_role;

COMMIT;
