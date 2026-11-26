-- Inbound CONTRL and UTILTS APERAK must qualify against the physical originals
-- already sent at the immutable receipt time. Keep the global candidate set,
-- exact tenant checks, first-write locks and durable committed replay.
DO $migration$
DECLARE
  target record;
  function_id pg_catalog.regprocedure;
  before_update pg_catalog.pg_proc%ROWTYPE;
  after_update pg_catalog.pg_proc%ROWTYPE;
  definition text;
  updated_body text;
  hash_predicate CONSTANT text :=
    'AND m.immutable_payload_hash=encode(sha256(convert_to(m.raw_payload';
  causal_filter CONSTANT text := 'AND m.message_sent_at <= captured.source_received_at';
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('gridex_ediel_source_rules.read_ack_source_before_basis_v1(uuid,text,uuid)',
      '37cd232afd3d510f59f70ea8fedb33e4ba1ae22c5e19d157118f22fae7f5b662'),
    ('gridex_ack_authority.apply_before_committed_replay_v1(uuid,text,uuid,uuid,uuid)',
      '411317aec4133e8b580331c5202264c29de10fe31bc0330e7236d99a03c9e692')
  ) AS targets(signature, body_sha256)
  LOOP
    function_id := pg_catalog.to_regprocedure(target.signature);
    IF function_id IS NULL THEN
      RAISE EXCEPTION 'ediel_ack_causality_prerequisite_missing: %', target.signature USING ERRCODE = '55000';
    END IF;

    SELECT * INTO STRICT before_update FROM pg_catalog.pg_proc WHERE oid = function_id;
    IF before_update.prokind IS DISTINCT FROM 'f'
      OR before_update.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
      OR before_update.prorettype IS DISTINCT FROM 'pg_catalog.jsonb'::pg_catalog.regtype
      OR before_update.prosecdef IS DISTINCT FROM true
      OR before_update.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog', 'TimeZone=UTC']
      OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(before_update.prosrc, 'UTF8')), 'hex')
        IS DISTINCT FROM target.body_sha256
      OR length(before_update.prosrc) - length(replace(before_update.prosrc, hash_predicate, '')) <> length(hash_predicate)
    THEN
      RAISE EXCEPTION 'ediel_ack_causality_prerequisite_changed: %', target.signature USING ERRCODE = '55000';
    END IF;

    updated_body := replace(before_update.prosrc, hash_predicate, causal_filter || E'\n  ' || hash_predicate);
    definition := pg_catalog.pg_get_functiondef(function_id);
    IF length(definition) - length(replace(definition, before_update.prosrc, '')) <> length(before_update.prosrc) THEN
      RAISE EXCEPTION 'ediel_ack_causality_definition_changed: %', target.signature USING ERRCODE = '55000';
    END IF;

    EXECUTE replace(definition, before_update.prosrc, updated_body);
    SELECT * INTO STRICT after_update FROM pg_catalog.pg_proc WHERE oid = function_id;
    IF after_update.prosrc IS DISTINCT FROM updated_body
      OR (to_jsonb(after_update) - 'prosrc') IS DISTINCT FROM (to_jsonb(before_update) - 'prosrc')
    THEN
      RAISE EXCEPTION 'ediel_ack_causality_authority_changed: %', target.signature USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$migration$;
