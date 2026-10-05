-- Created by Supabase CLI2.118.0. Prospective physical reference allocation.
-- Existing source bytes are inspected, never rewritten or declared approved.
BEGIN;
CREATE SCHEMA gridex_ediel_wire_namespace;
REVOKE ALL ON SCHEMA gridex_ediel_wire_namespace FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_ediel_wire_namespace.reservations(
 environment text NOT NULL CHECK(environment IN('test','production')),
 sender_namespace text NOT NULL,
 application_namespace text NOT NULL,
 reference_kind text NOT NULL CHECK(reference_kind IN('UNB','UNH','BGM','IDE','DM')),
 wire_reference text NOT NULL,
 source_message_id uuid NOT NULL,
 company_id uuid NOT NULL,
 first_payload_sha256 text NOT NULL CHECK(first_payload_sha256 ~ '^[a-f0-9]{64}$'),
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(environment,sender_namespace,application_namespace,reference_kind,wire_reference)
);
CREATE INDEX ediel_wire_namespace_message_idx ON gridex_ediel_wire_namespace.reservations(source_message_id);
CREATE TABLE gridex_ediel_wire_namespace.coverage(source_message_id uuid PRIMARY KEY,payload_sha256 text NOT NULL,company_id uuid NOT NULL,environment text NOT NULL);
ALTER TABLE gridex_ediel_wire_namespace.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_wire_namespace.reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_wire_namespace.coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_wire_namespace.coverage FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA gridex_ediel_wire_namespace FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ediel_wire_namespace.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'ediel_wire_reference_reservation_immutable'; END $$;
CREATE TRIGGER immutable_reservations BEFORE UPDATE OR DELETE ON gridex_ediel_wire_namespace.reservations FOR EACH ROW EXECUTE FUNCTION gridex_ediel_wire_namespace.immutable();

-- Reuse the existing lossless UNA-aware tokenizer. No mutable reference index,
-- tenant-local counter, re-splitting decoded values or source sanitization.
CREATE FUNCTION gridex_ediel_wire_namespace.keys(p_raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE tokens jsonb; unb jsonb; unh jsonb; token jsonb; sender text; legal_sender text; application text; interchange text; family text; output jsonb:='[]'; value text; kind text; key jsonb;
BEGIN
 tokens:=gridex_utilts_binding.wire_tokens_v1(p_raw);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNB')<>1
  OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNH')<>1 THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 SELECT x INTO unb FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNB';
 SELECT x INTO unh FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNH';
 sender:=nullif(unb#>>'{elements,2,0}',''); application:=nullif(unb#>>'{elements,7,0}',''); interchange:=nullif(unb#>>'{elements,5,0}',''); family:=unh#>>'{elements,2,0}';
 IF sender IS NULL OR application IS NULL OR interchange IS NULL OR char_length(interchange)>14 OR family NOT IN('PRODAT','UTILTS','APERAK','CONTRL') THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 SELECT min(x#>>'{elements,2,0}') INTO legal_sender FROM jsonb_array_elements(tokens) x
  WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'=CASE WHEN family='PRODAT' THEN 'FR' ELSE 'MS' END;
 IF (SELECT count(DISTINCT x#>>'{elements,2,0}') FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'=CASE WHEN family='PRODAT' THEN 'FR' ELSE 'MS' END)>1 THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 legal_sender:=coalesce(nullif(legal_sender,''),sender);
 -- UNB is unique for the technical sender across applications/subaddresses.
 output:=jsonb_build_array(jsonb_build_object('sender',sender,'application','','kind','UNB','value',interchange));
 FOR token IN SELECT x FROM jsonb_array_elements(tokens) x WHERE x->>'tag' IN('UNH','BGM','IDE','RFF') LOOP
  kind:=NULL;value:=NULL;
  CASE token->>'tag'
   WHEN 'UNH' THEN kind:='UNH';value:=token#>>'{elements,1,0}';
   WHEN 'BGM' THEN kind:='BGM';value:=token#>>'{elements,2,0}';
   WHEN 'IDE' THEN kind:='IDE';value:=token#>>'{elements,2,0}';
   WHEN 'RFF' THEN
    IF token#>>'{elements,1,0}'='DM' THEN kind:='DM';value:=coalesce(nullif(token#>>'{elements,1,1}',''),token#>>'{elements,2,0}'); END IF;
   ELSE NULL;
  END CASE;
  IF kind IS NOT NULL THEN
   IF nullif(value,'') IS NULL OR char_length(value)>35 THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
   key:=jsonb_build_object('sender',CASE WHEN kind='UNH' THEN sender ELSE legal_sender END,'application',CASE WHEN kind='UNH' THEN interchange ELSE application END,'kind',kind,'value',value);
   IF output @> jsonb_build_array(key) THEN RAISE EXCEPTION 'ediel_wire_reference_duplicate_in_source'; END IF;
   output:=output||jsonb_build_array(key);
  END IF;
 END LOOP;
 RETURN output;
END $$;

CREATE FUNCTION gridex_ediel_wire_namespace.reserve(m public.ediel_messages) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE keys jsonb; key jsonb; payload_hash text; old public.ediel_messages%rowtype; old_keys jsonb; owner uuid; test_indicator text;
BEGIN
 IF m.direction IS DISTINCT FROM 'outbound' THEN RETURN; END IF;
 IF nullif(m.raw_payload,'') IS NULL THEN RETURN; END IF;
 IF left(m.raw_payload,3) NOT IN('UNA','UNB') THEN
  IF m.message_family IN('PRODAT','UTILTS','UTILTS_ERR','APERAK','CONTRL') THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
  RETURN;
 END IF;
 IF m.company_id IS NULL OR m.environment NOT IN('test','production') OR m.id IS NULL THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 keys:=gridex_ediel_wire_namespace.keys(m.raw_payload);
 SELECT coalesce(x#>>'{elements,11,0}','') INTO test_indicator FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(m.raw_payload)) x WHERE x->>'tag'='UNB';
 IF test_indicator NOT IN('','1') OR m.environment IS DISTINCT FROM (CASE WHEN test_indicator='1' THEN 'test' ELSE 'production' END) THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 payload_hash:=encode(digest(convert_to(m.raw_payload,'UTF8'),'sha256'),'hex');
 -- Stable lock order makes shared-sender concurrency atomic across tenants.
 FOR key IN SELECT x FROM jsonb_array_elements(keys) x ORDER BY x::text LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(m.environment||':'||key::text,0));
 END LOOP;
 IF EXISTS(SELECT FROM gridex_ediel_wire_namespace.coverage c WHERE c.source_message_id=m.id AND c.payload_sha256=payload_hash AND c.company_id=m.company_id AND c.environment=m.environment) THEN
  IF EXISTS(SELECT FROM jsonb_array_elements(keys) k WHERE NOT EXISTS(SELECT FROM gridex_ediel_wire_namespace.reservations r WHERE r.environment=m.environment AND r.sender_namespace=k->>'sender' AND r.application_namespace=k->>'application' AND r.reference_kind=k->>'kind' AND r.wire_reference=k->>'value' AND r.source_message_id=m.id AND r.company_id=m.company_id)) THEN RAISE EXCEPTION 'ediel_wire_reference_reservation_missing'; END IF;
  RETURN;
 END IF;
 -- Genuine retained legacy rows have not been prospectively indexed. Inspect
 -- their actual bytes before first allocation; do not infer historical sends.
 FOR old IN SELECT e.* FROM public.ediel_messages e WHERE e.id<>m.id AND e.direction='outbound' AND e.environment=m.environment AND left(e.raw_payload,3) IN('UNA','UNB')
  AND NOT EXISTS(SELECT FROM gridex_ediel_wire_namespace.coverage c WHERE c.source_message_id=e.id AND c.payload_sha256=encode(digest(convert_to(e.raw_payload,'UTF8'),'sha256'),'hex')) LOOP
  BEGIN old_keys:=gridex_ediel_wire_namespace.keys(old.raw_payload); EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'ediel_wire_reference_legacy_source_unqualified'; END;
  IF EXISTS(SELECT FROM jsonb_array_elements(keys) k JOIN jsonb_array_elements(old_keys) o ON k=o) THEN RAISE EXCEPTION 'ediel_wire_reference_namespace_collision'; END IF;
 END LOOP;
 FOR key IN SELECT x FROM jsonb_array_elements(keys) x ORDER BY x::text LOOP
  INSERT INTO gridex_ediel_wire_namespace.reservations(environment,sender_namespace,application_namespace,reference_kind,wire_reference,source_message_id,company_id,first_payload_sha256)
   VALUES(m.environment,key->>'sender',key->>'application',key->>'kind',key->>'value',m.id,m.company_id,payload_hash) ON CONFLICT DO NOTHING;
  SELECT source_message_id INTO owner FROM gridex_ediel_wire_namespace.reservations WHERE environment=m.environment AND sender_namespace=key->>'sender' AND application_namespace=key->>'application' AND reference_kind=key->>'kind' AND wire_reference=key->>'value';
  IF owner IS DISTINCT FROM m.id OR NOT EXISTS(SELECT FROM gridex_ediel_wire_namespace.reservations WHERE environment=m.environment AND sender_namespace=key->>'sender' AND application_namespace=key->>'application' AND reference_kind=key->>'kind' AND wire_reference=key->>'value' AND company_id=m.company_id) THEN RAISE EXCEPTION 'ediel_wire_reference_namespace_collision'; END IF;
 END LOOP;
 INSERT INTO gridex_ediel_wire_namespace.coverage VALUES(m.id,payload_hash,m.company_id,m.environment)
  ON CONFLICT(source_message_id) DO UPDATE SET payload_sha256=EXCLUDED.payload_sha256,company_id=EXCLUDED.company_id,environment=EXCLUDED.environment;
END $$;
CREATE FUNCTION public.ediel_reserve_wire_reference_namespace_v1(p_company_id uuid,p_message_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.ediel_messages%rowtype;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'outbound' OR nullif(m.raw_payload,'') IS NULL THEN RAISE EXCEPTION 'ediel_wire_reference_source_invalid'; END IF;
 PERFORM gridex_ediel_wire_namespace.reserve(m);
END $$;
CREATE FUNCTION gridex_ediel_wire_namespace.before_message_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.environment IS DISTINCT FROM OLD.environment OR NEW.direction IS DISTINCT FROM OLD.direction)
  AND EXISTS(SELECT FROM gridex_ediel_wire_namespace.coverage WHERE source_message_id=OLD.id) THEN RAISE EXCEPTION 'ediel_wire_reference_namespace_context_immutable'; END IF;
 PERFORM gridex_ediel_wire_namespace.reserve(NEW);
 RETURN NEW;
END $$;
CREATE TRIGGER ediel_wire_reference_namespace_before_write BEFORE INSERT OR UPDATE OF raw_payload,company_id,environment,direction ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_ediel_wire_namespace.before_message_write();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_wire_namespace FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_reserve_wire_reference_namespace_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_reserve_wire_reference_namespace_v1(uuid,uuid) TO service_role;
COMMIT;
