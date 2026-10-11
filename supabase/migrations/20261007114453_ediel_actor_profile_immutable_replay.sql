-- Keep actor-profile replay bound to the original canonical request and actor.
-- Replace only verified existing source slots. Preserve function OID/ACL/owner,
-- signature, security/search path, every other body byte and historical rows.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $repair$
DECLARE
  function_oid oid := to_regprocedure('public.canonical_save_ediel_actor_profile(jsonb)');
  original_definition text;
  original_body text;
  original_metadata jsonb;
  expected_body text;
  replacement_definition text;
  old_slots text[] := ARRAY[
    $oldslot$  select * into v_existing from public.canonical_command_results
  where company_id = v_company_id and command_type = 'ediel.actor_profile.save'
    and idempotency_key = v_idempotency_key;
  if found then
    if v_existing.actor_user_id is distinct from v_actor_user_id then raise exception 'idempotency_actor_mismatch'; end if;
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key_payload_mismatch'; end if;
    return v_existing.result_payload;
  end if;
$oldslot$,
    $oldslot$  v_defaults := jsonb_build_object($oldslot$
  ];
  new_slots text[] := ARRAY[
    $newslot$$newslot$,
    $newslot$  -- Historical command replay precedes current defaults/identity binding.
  -- This immutable receipt supplies no current profile or LIVE authority.
  select * into v_existing from public.canonical_command_results
  where company_id = v_company_id and command_type = 'ediel.actor_profile.save'
    and idempotency_key = v_idempotency_key;
  if found then
    if v_existing.actor_user_id is distinct from v_actor_user_id then raise exception 'idempotency_actor_mismatch'; end if;
    v_hash := public.canonical_json_sha256((v_existing.request_payload || p_command) - 'actor_user_id');
    if v_existing.request_payload is null or v_existing.request_hash is distinct from v_hash then
      raise exception 'idempotency_key_payload_mismatch';
    end if;
    return v_existing.result_payload;
  end if;

  v_defaults := jsonb_build_object($newslot$
  ];
  slot integer;
BEGIN
  IF function_oid IS NULL THEN RAISE EXCEPTION 'canonical_save_ediel_actor_profile_existing_function_required'; END IF;
  SELECT pg_get_functiondef(p.oid), p.prosrc, to_jsonb(p)-'prosrc'
    INTO STRICT original_definition, original_body, original_metadata
  FROM pg_proc p WHERE p.oid=function_oid;
  IF strpos(original_body, old_slots[1])=0 THEN
    FOR slot IN 1..array_length(new_slots,1) LOOP
      IF new_slots[slot]<>'' AND (length(original_body)-length(replace(original_body,new_slots[slot],'')))/length(new_slots[slot])<>1 THEN
        RAISE EXCEPTION 'canonical_save_ediel_actor_profile_repaired_shape_required:%',slot;
      END IF;
      IF strpos(new_slots[slot],old_slots[slot])=0 AND strpos(original_body,old_slots[slot])<>0 THEN
        RAISE EXCEPTION 'canonical_save_ediel_actor_profile_partial_repair_refused:%',slot;
      END IF;
    END LOOP;
    RETURN;
  END IF;
  expected_body:=original_body;
  replacement_definition:=original_definition;
  FOR slot IN 1..array_length(old_slots,1) LOOP
    IF (length(original_body)-length(replace(original_body,old_slots[slot],'')))/length(old_slots[slot])<>1 THEN
      RAISE EXCEPTION 'canonical_save_ediel_actor_profile_exact_original_source_required:%',slot;
    END IF;
    expected_body:=replace(expected_body,old_slots[slot],new_slots[slot]);
    replacement_definition:=replace(replacement_definition,old_slots[slot],new_slots[slot]);
  END LOOP;
  EXECUTE replacement_definition;
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=function_oid) IS DISTINCT FROM original_metadata
    OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=function_oid) IS DISTINCT FROM expected_body THEN
    RAISE EXCEPTION 'canonical_save_ediel_actor_profile_metadata_or_body_changed';
  END IF;
END
$repair$;
COMMIT;
