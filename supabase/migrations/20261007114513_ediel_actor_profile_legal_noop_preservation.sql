-- Preserve legal projections on Ediel-only saves; real legal changes still sync.
-- Replace only verified existing source slots. Preserve function OID/ACL/owner,
-- signature, security/search path, every other body byte and historical rows.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $repair$
DECLARE
  function_oid oid := to_regprocedure('public.canonical_save_ediel_actor_profile_v1_unchecked(jsonb)');
  original_definition text;
  original_body text;
  original_metadata jsonb;
  expected_body text;
  replacement_definition text;
  old_slots text[] := ARRAY[
    $oldslot$    update public.companies set
      org_number = nullif(p_command->>'organization_number', ''),
      market_role = v_actor_role,$oldslot$,
    $oldslot$      support_email = nullif(p_command->>'support_email', ''),
      billing_contact_email = nullif(p_command->>'billing_contact_email', ''),
$oldslot$
  ];
  new_slots text[] := ARRAY[
    $newslot$    -- UPDATE OF legal fields fires the real legal-sync trigger even for equal
    -- values. Invoke it only for a real change; never disable or bypass it.
    update public.companies set
      org_number = nullif(p_command->>'organization_number', ''),
      support_email = nullif(p_command->>'support_email', ''),
      billing_contact_email = nullif(p_command->>'billing_contact_email', '')
    where id = v_company_id
      and (org_number, support_email, billing_contact_email) is distinct from
        (public.gridex_normalize_swedish_organization_number(nullif(p_command->>'organization_number', '')),
         nullif(p_command->>'support_email', ''),
         nullif(p_command->>'billing_contact_email', ''));

    update public.companies set
      market_role = v_actor_role,$newslot$,
    $newslot$$newslot$
  ];
  slot integer;
BEGIN
  IF function_oid IS NULL THEN RAISE EXCEPTION 'canonical_save_ediel_actor_profile_v1_unchecked_existing_function_required'; END IF;
  SELECT pg_get_functiondef(p.oid), p.prosrc, to_jsonb(p)-'prosrc'
    INTO STRICT original_definition, original_body, original_metadata
  FROM pg_proc p WHERE p.oid=function_oid;
  IF strpos(original_body, old_slots[1])=0 THEN
    FOR slot IN 1..array_length(new_slots,1) LOOP
      IF new_slots[slot]<>'' AND (length(original_body)-length(replace(original_body,new_slots[slot],'')))/length(new_slots[slot])<>1 THEN
        RAISE EXCEPTION 'canonical_save_ediel_actor_profile_v1_unchecked_repaired_shape_required:%',slot;
      END IF;
      IF strpos(new_slots[slot],old_slots[slot])=0 AND strpos(original_body,old_slots[slot])<>0 THEN
        RAISE EXCEPTION 'canonical_save_ediel_actor_profile_v1_unchecked_partial_repair_refused:%',slot;
      END IF;
    END LOOP;
    RETURN;
  END IF;
  expected_body:=original_body;
  replacement_definition:=original_definition;
  FOR slot IN 1..array_length(old_slots,1) LOOP
    IF (length(original_body)-length(replace(original_body,old_slots[slot],'')))/length(old_slots[slot])<>1 THEN
      RAISE EXCEPTION 'canonical_save_ediel_actor_profile_v1_unchecked_exact_original_source_required:%',slot;
    END IF;
    expected_body:=replace(expected_body,old_slots[slot],new_slots[slot]);
    replacement_definition:=replace(replacement_definition,old_slots[slot],new_slots[slot]);
  END LOOP;
  EXECUTE replacement_definition;
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=function_oid) IS DISTINCT FROM original_metadata
    OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=function_oid) IS DISTINCT FROM expected_body THEN
    RAISE EXCEPTION 'canonical_save_ediel_actor_profile_v1_unchecked_metadata_or_body_changed';
  END IF;
END
$repair$;
COMMIT;
