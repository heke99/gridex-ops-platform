-- The profile has no environment_type column. Capture the selected tenant's
-- actual communication route, retaining every profile in the full snapshot.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

DO $repair_route_source$
DECLARE
  function_oid oid := to_regprocedure(
    'public.canonical_capture_ediel_test_configuration_snapshot(uuid,uuid,uuid,uuid,text)');
  original_definition text;
  original_body text;
  original_metadata jsonb;
  expected_body text;
  replacement_definition text;
  old_slots text[] := ARRAY[
    '  v_route public.ediel_route_profiles%rowtype;',
    '  v_payload := jsonb_build_object(',
    '''environment_type'', v_route.environment_type',
    '''environment_type'',r.environment_type,',
    E'      from public.ediel_route_profiles r\n      where r.company_id=p_company_id'
  ];
  new_slots text[] := ARRAY[
    E'  v_route public.ediel_route_profiles%rowtype;\n  v_communication_route public.communication_routes%rowtype;',
    $guard$  select * into v_communication_route
  from public.communication_routes
  where id=v_route.communication_route_id and company_id=p_company_id
  for share;
  if not found or v_communication_route.is_active is distinct from true
     or v_communication_route.environment_type is null
     or v_communication_route.environment_type not in ('agt_test','tgt_test','bilateral_test') then
    raise exception 'test_route_communication_source_required';
  end if;

  v_payload := jsonb_build_object($guard$,
    '''environment_type'', v_communication_route.environment_type',
    '''environment_type'',cr.environment_type,',
    $join$      from public.ediel_route_profiles r
      left join public.communication_routes cr
        on cr.id=r.communication_route_id and cr.company_id=r.company_id
      where r.company_id=p_company_id$join$
  ];
  slot integer;
BEGIN
  IF function_oid IS NULL THEN
    RAISE EXCEPTION 'ediel_test_configuration_existing_snapshot_function_required';
  END IF;
  SELECT pg_get_functiondef(p.oid), p.prosrc, to_jsonb(p) - 'prosrc'
    INTO STRICT original_definition, original_body, original_metadata
  FROM pg_proc p WHERE p.oid = function_oid;

  -- An exact already-installed shape is inert; mixed/partial changes refuse.
  IF strpos(original_body, old_slots[3]) = 0
    AND strpos(original_body, old_slots[4]) = 0 THEN
    FOR slot IN 1..array_length(new_slots, 1) LOOP
      IF (length(original_body) - length(replace(original_body, new_slots[slot], '')))
        / length(new_slots[slot]) <> 1 THEN
        RAISE EXCEPTION 'ediel_test_configuration_repaired_source_shape_required: %', slot;
      END IF;
    END LOOP;
    RETURN;
  END IF;

  expected_body := original_body;
  replacement_definition := original_definition;
  FOR slot IN 1..array_length(old_slots, 1) LOOP
    IF (length(original_body) - length(replace(original_body, old_slots[slot], '')))
      / length(old_slots[slot]) <> 1 THEN
      RAISE EXCEPTION 'ediel_test_configuration_exact_original_source_required: %', slot;
    END IF;
    expected_body := replace(expected_body, old_slots[slot], new_slots[slot]);
    replacement_definition := replace(replacement_definition, old_slots[slot], new_slots[slot]);
  END LOOP;
  EXECUTE replacement_definition;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = function_oid)
    IS DISTINCT FROM original_metadata
    OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid = function_oid)
    IS DISTINCT FROM expected_body THEN
    RAISE EXCEPTION 'ediel_test_configuration_snapshot_metadata_or_body_changed';
  END IF;
END
$repair_route_source$;
COMMIT;
