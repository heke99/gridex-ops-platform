-- DB-01: contain the existing legacy relation without copying, rekeying or
-- deleting history. This changes operational access, not retention policy.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

LOCK TABLE public.ediel_party_addresses, public.ediel_messages,
  public.ediel_route_profiles IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.ediel_parties, public.ediel_certificates IN SHARE MODE;

-- Expand and capture the exact existing authority before the contract step.
CREATE TEMP TABLE gridex_db01_relation_before ON COMMIT DROP AS
SELECT oid, relowner, reltype, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE oid = 'public.ediel_party_addresses'::regclass;
CREATE TEMP TABLE gridex_db01_rows_before ON COMMIT DROP AS
SELECT 'addresses'::text AS relation, id, to_jsonb(t) AS original,
  encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex') AS original_hash
FROM public.ediel_party_addresses t
UNION ALL
SELECT 'messages', id, to_jsonb(t),
  encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex')
FROM public.ediel_messages t WHERE party_address_id IS NOT NULL
UNION ALL
SELECT 'profiles', id, to_jsonb(t),
  encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex')
FROM public.ediel_route_profiles t WHERE party_address_id IS NOT NULL;
CREATE TEMP TABLE gridex_db01_fks_before ON COMMIT DROP AS
SELECT oid, to_jsonb(c) - 'connamespace' AS definition
FROM pg_constraint c WHERE contype = 'f'
AND (conrelid = 'public.ediel_party_addresses'::regclass
  OR confrelid = 'public.ediel_party_addresses'::regclass);
CREATE TEMP TABLE gridex_db01_indexes_before ON COMMIT DROP AS
SELECT indexrelid, to_jsonb(i) AS definition
FROM pg_index i WHERE indrelid = 'public.ediel_party_addresses'::regclass;
CREATE TEMP TABLE gridex_db01_policies_before ON COMMIT DROP AS
SELECT oid, to_jsonb(p) AS definition
FROM pg_policy p WHERE polrelid = 'public.ediel_party_addresses'::regclass;

DO $validate_existing$
BEGIN
  IF (SELECT count(*) FROM pg_temp.gridex_db01_fks_before) <> 4
    OR EXISTS (SELECT FROM pg_temp.gridex_db01_fks_before
      WHERE definition->>'convalidated' IS DISTINCT FROM 'true') THEN
    RAISE EXCEPTION 'ediel_legacy_address_expected_validated_fk_graph_required';
  END IF;
  IF EXISTS (SELECT FROM public.ediel_messages m
    LEFT JOIN public.ediel_party_addresses a ON a.id = m.party_address_id
    WHERE m.party_address_id IS NOT NULL AND a.id IS NULL)
    OR EXISTS (SELECT FROM public.ediel_route_profiles p
      LEFT JOIN public.ediel_party_addresses a ON a.id = p.party_address_id
      WHERE p.party_address_id IS NOT NULL AND a.id IS NULL) THEN
    RAISE EXCEPTION 'ediel_legacy_address_history_orphan';
  END IF;
END
$validate_existing$;

CREATE SCHEMA gridex_ediel_legacy_archive;
REVOKE ALL ON SCHEMA gridex_ediel_legacy_archive
  FROM PUBLIC, anon, authenticated, service_role;

-- Keep the complete protected creators, including their replay branches,
-- guards, owners, OIDs and ACLs. Only the fresh INSERT value is retired.
DO $retire_fresh_hints$
DECLARE
  signature text;
  function_oid oid;
  original_definition text;
  original_metadata jsonb;
  original_body text;
  expression text := 'nullif(p_draft->>''partyAddressId'','''')::uuid';
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.ediel_create_bilateral_prodat_original_v1(uuid,uuid,jsonb)',
    'public.ediel_create_national_supply_rescission_original_v1(uuid,uuid,jsonb)'
  ] LOOP
    function_oid := to_regprocedure(signature);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'ediel_legacy_address_existing_original_creator_required: %', signature;
    END IF;
    SELECT pg_get_functiondef(p.oid), to_jsonb(p) - 'prosrc', p.prosrc
      INTO STRICT original_definition, original_metadata, original_body
    FROM pg_proc p WHERE p.oid = function_oid;
    IF (length(original_body) - length(replace(original_body, expression, '')))
      / length(expression) <> 1 THEN
      RAISE EXCEPTION 'ediel_legacy_address_exact_original_insert_required: %', signature;
    END IF;
    EXECUTE replace(original_definition, expression, 'NULL');
    IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = function_oid)
      IS DISTINCT FROM original_metadata
      OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid = function_oid)
      IS DISTINCT FROM replace(original_body, expression, 'NULL') THEN
      RAISE EXCEPTION 'ediel_legacy_address_original_creator_changed: %', signature;
    END IF;
  END LOOP;
END
$retire_fresh_hints$;

CREATE FUNCTION gridex_ediel_legacy_archive.refuse_new_address_reference_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.party_address_id IS NOT NULL THEN
    RAISE EXCEPTION 'ediel_legacy_party_address_hint_retired' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION gridex_ediel_legacy_archive.refuse_new_address_reference_v1()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER ediel_legacy_address_insert_only
  BEFORE INSERT ON public.ediel_messages FOR EACH ROW
  EXECUTE FUNCTION gridex_ediel_legacy_archive.refuse_new_address_reference_v1();
CREATE TRIGGER ediel_legacy_address_insert_only
  BEFORE INSERT ON public.ediel_route_profiles FOR EACH ROW
  EXECUTE FUNCTION gridex_ediel_legacy_archive.refuse_new_address_reference_v1();

-- Move the same relation and composite type. FK references still point to the
-- same OID; existing CASCADE / SET NULL actions and historical updates remain.
ALTER TABLE public.ediel_party_addresses SET SCHEMA gridex_ediel_legacy_archive;
REVOKE ALL ON TABLE gridex_ediel_legacy_archive.ediel_party_addresses
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TEMP TABLE gridex_db01_rows_after ON COMMIT DROP AS
SELECT 'addresses'::text AS relation, id, to_jsonb(t) AS original,
  encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex') AS original_hash
FROM gridex_ediel_legacy_archive.ediel_party_addresses t
UNION ALL
SELECT 'messages', id, to_jsonb(t),
  encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex')
FROM public.ediel_messages t WHERE party_address_id IS NOT NULL
UNION ALL
SELECT 'profiles', id, to_jsonb(t),
  encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex')
FROM public.ediel_route_profiles t WHERE party_address_id IS NOT NULL;

DO $validate_contract$
DECLARE
  legacy_oid oid := 'gridex_ediel_legacy_archive.ediel_party_addresses'::regclass;
  api_role text;
BEGIN
  IF to_regclass('public.ediel_party_addresses') IS NOT NULL
    OR NOT EXISTS (SELECT FROM pg_temp.gridex_db01_relation_before b
      JOIN pg_class c ON c.oid = b.oid
      WHERE c.oid = legacy_oid AND c.relowner = b.relowner
        AND c.reltype = b.reltype AND c.relrowsecurity = b.relrowsecurity
        AND c.relforcerowsecurity = b.relforcerowsecurity) THEN
    RAISE EXCEPTION 'ediel_legacy_address_relation_identity_changed';
  END IF;
  IF EXISTS ((SELECT * FROM pg_temp.gridex_db01_rows_before
      EXCEPT SELECT * FROM pg_temp.gridex_db01_rows_after)
    UNION ALL (SELECT * FROM pg_temp.gridex_db01_rows_after
      EXCEPT SELECT * FROM pg_temp.gridex_db01_rows_before)) THEN
    RAISE EXCEPTION 'ediel_legacy_address_history_changed';
  END IF;
  IF EXISTS ((SELECT * FROM pg_temp.gridex_db01_fks_before
      EXCEPT SELECT oid, to_jsonb(c) - 'connamespace' FROM pg_constraint c
        WHERE contype = 'f' AND (conrelid = legacy_oid OR confrelid = legacy_oid))
    UNION ALL (SELECT oid, to_jsonb(c) - 'connamespace' FROM pg_constraint c
      WHERE contype = 'f' AND (conrelid = legacy_oid OR confrelid = legacy_oid)
      EXCEPT SELECT * FROM pg_temp.gridex_db01_fks_before)) THEN
    RAISE EXCEPTION 'ediel_legacy_address_fk_graph_changed';
  END IF;
  IF EXISTS ((SELECT * FROM pg_temp.gridex_db01_indexes_before
      EXCEPT SELECT indexrelid, to_jsonb(i) FROM pg_index i WHERE indrelid = legacy_oid)
    UNION ALL (SELECT indexrelid, to_jsonb(i) FROM pg_index i WHERE indrelid = legacy_oid
      EXCEPT SELECT * FROM pg_temp.gridex_db01_indexes_before))
    OR EXISTS ((SELECT * FROM pg_temp.gridex_db01_policies_before
      EXCEPT SELECT oid, to_jsonb(p) FROM pg_policy p WHERE polrelid = legacy_oid)
    UNION ALL (SELECT oid, to_jsonb(p) FROM pg_policy p WHERE polrelid = legacy_oid
      EXCEPT SELECT * FROM pg_temp.gridex_db01_policies_before)) THEN
    RAISE EXCEPTION 'ediel_legacy_address_index_or_policy_changed';
  END IF;
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_schema_privilege(api_role, 'gridex_ediel_legacy_archive', 'USAGE,CREATE')
      OR has_table_privilege(api_role, legacy_oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(api_role, legacy_oid,
        'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'ediel_legacy_address_api_privilege_remains: %', api_role;
    END IF;
  END LOOP;
  IF EXISTS (SELECT FROM public.ediel_messages m
      LEFT JOIN gridex_ediel_legacy_archive.ediel_party_addresses a ON a.id = m.party_address_id
      WHERE m.party_address_id IS NOT NULL AND a.id IS NULL)
    OR EXISTS (SELECT FROM public.ediel_route_profiles p
      LEFT JOIN gridex_ediel_legacy_archive.ediel_party_addresses a ON a.id = p.party_address_id
      WHERE p.party_address_id IS NOT NULL AND a.id IS NULL) THEN
    RAISE EXCEPTION 'ediel_legacy_address_history_orphan';
  END IF;
END
$validate_contract$;
COMMIT;
