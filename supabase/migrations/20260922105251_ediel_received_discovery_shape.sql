-- E035 PR370 review hardening. No original migration or grant is rewritten.
-- Validate observation shape and tuple bindings; never confer source approval.
BEGIN;

CREATE OR REPLACE FUNCTION gridex_received_sources.append_discovery(p_company_id uuid,p_environment text,
 p_snapshot_id uuid,p_snapshot_hash text,p_engine_version text,p_inventory_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE snap gridex_received_sources.snapshots%rowtype; inv jsonb; src jsonb; expected jsonb; item jsonb;
  v_id uuid; v_hash text; n bigint; distinct_n bigint;
  v_position bigint; v_segment numeric; v_expected_objects jsonb;
BEGIN
  SELECT * INTO snap FROM gridex_received_sources.snapshots WHERE id=p_snapshot_id AND company_id=p_company_id AND environment=p_environment;
  IF NOT FOUND OR p_snapshot_hash IS DISTINCT FROM snap.manifest_hash
     OR p_engine_version IS DISTINCT FROM 'physical-lin-inventory-v1' OR p_inventory_text IS NULL
     OR octet_length(p_inventory_text)>8388608 THEN
    RAISE EXCEPTION 'received_discovery_binding_unavailable' USING ERRCODE='23514';
  END IF;
  inv := p_inventory_text::jsonb;
  IF jsonb_typeof(inv) IS DISTINCT FROM 'object'
    OR inv - ARRAY['version','universe','historyCoverage','authorityStatus','selection','status','sources','issues'] <> '{}'::jsonb
    OR inv->'version' IS DISTINCT FROM '1'::jsonb OR inv->>'universe' IS DISTINCT FROM 'durable_received_sources'
    OR inv->>'historyCoverage' IS DISTINCT FROM 'before_ledger_unknown' OR inv->>'authorityStatus' IS DISTINCT FROM 'not_established'
    OR inv->>'selection' IS DISTINCT FROM 'not_performed' OR coalesce(inv->>'status','') NOT IN ('enumerated','incomplete')
    OR jsonb_typeof(inv->'sources') IS DISTINCT FROM 'array' OR jsonb_typeof(inv->'issues') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'received_discovery_not_an_approval' USING ERRCODE='23514';
  END IF;
  SELECT count(*),count(DISTINCT value->>'sourceMessageId') INTO n,distinct_n FROM jsonb_array_elements(inv->'sources');
  IF n<>distinct_n OR n>1000 OR (inv->>'status'='enumerated' AND
      (snap.manifest->'exhaustive' IS DISTINCT FROM 'true'::jsonb OR n<>(snap.manifest->>'sourceCount')::bigint OR inv->'issues'<>'[]'::jsonb))
    OR (n<>0 AND n<>(snap.manifest->>'sourceCount')::bigint) THEN
    RAISE EXCEPTION 'received_discovery_incomplete_set' USING ERRCODE='23514';
  END IF;
  FOR src IN SELECT value FROM jsonb_array_elements(inv->'sources') LOOP
    SELECT value INTO expected FROM jsonb_array_elements(snap.manifest->'sources') WHERE value->>'sourceMessageId'=src->>'sourceMessageId';
    IF NOT FOUND OR jsonb_typeof(src) IS DISTINCT FROM 'object'
      OR src - ARRAY['sourceMessageId','sourcePayloadHash','sourceReceivedAt','capturedAt','receiptStatus','disposition','status','occurrences','objects','issues'] <> '{}'::jsonb
      OR src->'sourcePayloadHash' IS DISTINCT FROM expected->'payloadHash'
      OR src->'sourceReceivedAt' IS DISTINCT FROM expected->'sourceReceivedAt' OR src->'capturedAt' IS DISTINCT FROM expected->'capturedAt'
      OR src->>'disposition' IS DISTINCT FROM 'not_checked' OR coalesce(src->>'status','') NOT IN ('enumerated','incomplete')
      OR coalesce(src->>'receiptStatus','') NOT IN ('recorded','unavailable')
      OR (src->>'receiptStatus'='recorded' AND expected->'receiptContextRecorded' IS DISTINCT FROM 'true'::jsonb)
      OR jsonb_typeof(src->'occurrences') IS DISTINCT FROM 'array' OR jsonb_typeof(src->'objects') IS DISTINCT FROM 'array'
      OR jsonb_typeof(src->'issues') IS DISTINCT FROM 'array'
      OR (inv->>'status'='enumerated' AND (src->>'status'<>'enumerated' OR src->>'receiptStatus'<>'recorded' OR src->'issues'<>'[]'::jsonb))
      OR (src->>'status'='enumerated' AND (jsonb_typeof(src->'sourcePayloadHash') IS DISTINCT FROM 'string'
        OR coalesce(src->>'sourcePayloadHash','') !~ '^[a-f0-9]{64}$' OR jsonb_array_length(src->'occurrences')=0 OR jsonb_array_length(src->'objects')=0 OR src->>'receiptStatus'<>'recorded' OR src->'issues'<>'[]'::jsonb)) THEN
      RAISE EXCEPTION 'received_discovery_source_mismatch' USING ERRCODE='23514';
    END IF;
    -- Persist the producer's complete typed observation contract, not merely
    -- a set of allowed key names. This validates evidence shape and internal
    -- tuple bindings; it is NOT a second wire parser or source approval owner.
    IF jsonb_array_length(src->'occurrences')>8192 OR jsonb_array_length(src->'objects')>8192 THEN
      RAISE EXCEPTION 'received_discovery_observation_shape' USING ERRCODE='23514';
    END IF;
    v_segment := -1;
    FOR item,v_position IN SELECT value,ordinality FROM jsonb_array_elements(src->'occurrences') WITH ORDINALITY LOOP
      IF jsonb_typeof(item) IS DISTINCT FROM 'object'
        OR NOT item ?& ARRAY['ordinal','segmentIndex','messageIndex','lineNumber','objectId','identityAgency','identityStatus']
        OR item - ARRAY['ordinal','segmentIndex','messageIndex','lineNumber','objectId','identityAgency','identityStatus'] <> '{}'::jsonb
        OR jsonb_typeof(item->'ordinal') IS DISTINCT FROM 'number'
        OR jsonb_typeof(item->'segmentIndex') IS DISTINCT FROM 'number'
        OR coalesce(jsonb_typeof(item->'messageIndex'),'missing') NOT IN ('number','null')
        OR coalesce(jsonb_typeof(item->'lineNumber'),'missing') NOT IN ('string','null')
        OR coalesce(jsonb_typeof(item->'objectId'),'missing') NOT IN ('string','null')
        OR coalesce(jsonb_typeof(item->'identityAgency'),'missing') NOT IN ('string','null')
        OR jsonb_typeof(item->'identityStatus') IS DISTINCT FROM 'string'
        OR coalesce(item->>'identityStatus','') NOT IN ('observed','unresolved') THEN
        RAISE EXCEPTION 'received_discovery_observation_shape' USING ERRCODE='23514';
      END IF;
      -- Cast only AFTER the mandatory JSON types were checked. Ordinals are
      -- consecutive physical occurrences and segment indexes strictly increase.
      IF item->'ordinal' IS DISTINCT FROM to_jsonb(v_position)
        OR (item->>'segmentIndex')::numeric < 0 OR (item->>'segmentIndex')::numeric >= 8192
        OR trunc((item->>'segmentIndex')::numeric) <> (item->>'segmentIndex')::numeric
        OR (item->>'segmentIndex')::numeric <= v_segment
        OR (item->'messageIndex' <> 'null'::jsonb AND ((item->>'messageIndex')::numeric < 0
          OR (item->>'messageIndex')::numeric >= 8192
          OR trunc((item->>'messageIndex')::numeric) <> (item->>'messageIndex')::numeric))
        OR (item->'lineNumber' <> 'null'::jsonb AND length(item->>'lineNumber') NOT BETWEEN 1 AND 128) THEN
        RAISE EXCEPTION 'received_discovery_observation_shape' USING ERRCODE='23514';
      END IF;
      v_segment := (item->>'segmentIndex')::numeric;
      IF item->>'identityStatus'='observed' THEN
        IF jsonb_typeof(item->'messageIndex') IS DISTINCT FROM 'number'
          OR jsonb_typeof(item->'objectId') IS DISTINCT FROM 'string'
          OR length(item->>'objectId') NOT BETWEEN 1 AND 128
          OR jsonb_typeof(item->'identityAgency') IS DISTINCT FROM 'string'
          OR item->>'identityAgency' NOT IN ('9','89') THEN
          RAISE EXCEPTION 'received_discovery_observation_shape' USING ERRCODE='23514';
        END IF;
      ELSIF item->'objectId' IS DISTINCT FROM 'null'::jsonb OR item->'identityAgency' IS DISTINCT FROM 'null'::jsonb
        OR src->>'status'='enumerated' THEN
        RAISE EXCEPTION 'received_discovery_observation_shape' USING ERRCODE='23514';
      END IF;
    END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(src->'objects') LOOP
      IF jsonb_typeof(item) IS DISTINCT FROM 'object'
        OR NOT item ?& ARRAY['messageIndex','objectId','identityAgency','occurrenceOrdinals']
        OR item - ARRAY['messageIndex','objectId','identityAgency','occurrenceOrdinals'] <> '{}'::jsonb
        OR jsonb_typeof(item->'messageIndex') IS DISTINCT FROM 'number'
        OR jsonb_typeof(item->'objectId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'identityAgency') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'occurrenceOrdinals') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'received_discovery_observation_shape' USING ERRCODE='23514';
      END IF;
    END LOOP;
    -- Every observed occurrence must appear exactly once in the membership
    -- for its exact message/identity/agency tuple, preserving register repeats.
    -- This compares the submitted arrays, never interprets canonical registers.
    SELECT coalesce(jsonb_agg(jsonb_build_object('messageIndex',g.message_index,'objectId',g.object_id,
        'identityAgency',g.agency,'occurrenceOrdinals',g.ordinals) ORDER BY g.first_ordinal),'[]'::jsonb)
      INTO v_expected_objects
      FROM (SELECT value->'messageIndex' AS message_index,value->'objectId' AS object_id,value->'identityAgency' AS agency,
          jsonb_agg(value->'ordinal' ORDER BY ordinality) AS ordinals,min(ordinality) AS first_ordinal
        FROM jsonb_array_elements(src->'occurrences') WITH ORDINALITY
        WHERE value->>'identityStatus'='observed'
        GROUP BY value->'messageIndex',value->'objectId',value->'identityAgency') g;
    IF src->'objects' IS DISTINCT FROM v_expected_objects THEN
      RAISE EXCEPTION 'received_discovery_observation_shape' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT FROM jsonb_array_elements(src->'issues') AS value WHERE jsonb_typeof(value) IS DISTINCT FROM 'string' OR value#>>'{}' !~ '^[a-z0-9_]{1,128}$') THEN
      RAISE EXCEPTION 'received_discovery_observation_shape' USING ERRCODE='23514';
    END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(inv->'issues') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item - ARRAY['code','sourceMessageId'] <> '{}'::jsonb
      OR coalesce(item->>'code','') !~ '^[a-z0-9_]{1,128}$'
      OR (item ? 'sourceMessageId' AND NOT EXISTS(SELECT FROM jsonb_array_elements(inv->'sources') s WHERE s->>'sourceMessageId'=item->>'sourceMessageId')) THEN
      RAISE EXCEPTION 'received_discovery_observation_shape' USING ERRCODE='23514';
    END IF;
  END LOOP;
  v_hash:=encode(sha256(convert_to(p_inventory_text,'UTF8')),'hex');
  INSERT INTO gridex_received_sources.discovery_attempts(snapshot_id,company_id,environment,engine_version,inventory_text,inventory_hash)
    VALUES(snap.id,p_company_id,p_environment,p_engine_version,p_inventory_text,v_hash) RETURNING id INTO v_id;
  RETURN jsonb_build_object('version',1,'companyId',p_company_id,'environment',p_environment,'snapshotId',snap.id,
    'snapshotHash',snap.manifest_hash,'engineVersion',p_engine_version,'attemptId',v_id,'inventoryHash',v_hash);
END $$;

COMMIT;
