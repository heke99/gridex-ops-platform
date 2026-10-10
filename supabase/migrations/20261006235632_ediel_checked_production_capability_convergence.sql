-- Prerequisite: retain the canonical lock upsert while satisfying the existing
-- legacy NOT NULL fields. Existing keys and historical lock data stay intact.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $repair_lock_upsert$
DECLARE
  function_oid oid := to_regprocedure(
    'public.canonical_transition_ediel_production_v1_unchecked(uuid,text,bigint,uuid,uuid,uuid,text,uuid,text)');
  original_definition text;
  original_body text;
  original_metadata jsonb;
  expected_body text;
  replacement_definition text;
  old_slots text[] := ARRAY[
    '    company_id,environment,locked,locked_reason,locked_by,locked_at,',
    '    p_company_id,''production'',v_lock,',
    '    case when v_lock then now() else null end,',
    '      locked_by=excluded.locked_by,locked_at=excluded.locked_at,'
  ];
  new_slots text[] := ARRAY[
    '    company_id,environment,lock_key,locked,locked_reason,locked_by,locked_at,',
    '    p_company_id,''production'',jsonb_build_array(p_company_id,''production'')::text,v_lock,',
    '    now(),',
    '      locked_by=excluded.locked_by,locked_at=case when excluded.locked then excluded.locked_at else public.ediel_send_locks.locked_at end,'
  ];
  slot integer;
BEGIN
  IF function_oid IS NULL THEN
    RAISE EXCEPTION 'ediel_checked_production_existing_unchecked_transition_required';
  END IF;
  SELECT pg_get_functiondef(p.oid), p.prosrc, to_jsonb(p) - 'prosrc'
    INTO STRICT original_definition, original_body, original_metadata
  FROM pg_proc p WHERE p.oid=function_oid;
  IF strpos(original_body, old_slots[1])=0 THEN
    FOR slot IN 1..array_length(new_slots,1) LOOP
      IF slot<>3 AND (length(original_body)-length(replace(original_body,new_slots[slot],'')))
        /length(new_slots[slot])<>1 THEN
        RAISE EXCEPTION 'ediel_checked_production_repaired_lock_shape_required: %',slot;
      END IF;
    END LOOP;
    IF strpos(original_body,old_slots[3])<>0 THEN
      RAISE EXCEPTION 'ediel_checked_production_repaired_lock_timestamp_required';
    END IF;
    RETURN;
  END IF;
  expected_body:=original_body;
  replacement_definition:=original_definition;
  FOR slot IN 1..array_length(old_slots,1) LOOP
    IF (length(original_body)-length(replace(original_body,old_slots[slot],'')))
      /length(old_slots[slot])<>1 THEN
      RAISE EXCEPTION 'ediel_checked_production_exact_original_lock_upsert_required: %',slot;
    END IF;
    expected_body:=replace(expected_body,old_slots[slot],new_slots[slot]);
    replacement_definition:=replace(replacement_definition,old_slots[slot],new_slots[slot]);
  END LOOP;
  EXECUTE replacement_definition;
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=function_oid)
    IS DISTINCT FROM original_metadata
    OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=function_oid)
    IS DISTINCT FROM expected_body THEN
    RAISE EXCEPTION 'ediel_checked_production_unchecked_metadata_or_body_changed';
  END IF;
END
$repair_lock_upsert$;
-- Project only fresh checked LIVE transitions backed by the current evidence.
-- Explicit configuration, audit markers and historical edits stay authoritative.
DO $project_checked_live$
DECLARE
  function_oid oid := to_regprocedure(
    'public.canonical_transition_ediel_production(uuid,text,bigint,uuid,uuid,uuid,text,uuid,text)');
  original_definition text;
  original_body text;
  original_metadata jsonb;
  expected_body text;
  anchor text := '  update public.canonical_command_results';
  projection text := $projection$
  -- checked_live_untouched_capability_projection_v1
  if p_target_state='live'
    and v_result->>'changed'='true'
    and v_result->>'company_id'=p_company_id::text
    and v_result->>'state'='live'
    and coalesce((v_readiness->>'ready')::boolean,false)
    and v_readiness->>'company_id'=p_company_id::text
    and v_readiness->>'configuration_snapshot_id'=p_configuration_snapshot_id::text
    and exists (
      select 1 from public.ediel_production_state s
      where s.company_id=p_company_id and s.state='live'
        and s.state_version=(v_result->>'state_version')::bigint
        and s.configuration_snapshot_id=p_configuration_snapshot_id
        and s.readiness_check_id=p_readiness_check_id
        and s.dry_run_id=p_dry_run_id
    )
    and coalesce((public.canonical_ediel_production_evidence_readiness(p_company_id)->>'ready')::boolean,false)
  then
    insert into public.company_capabilities as capability (
      company_id,capability_code,enabled,readiness_status,
      last_verified_at,last_verified_by,created_by,updated_by
    ) values (
      p_company_id,'ediel_production',true,'ready',
      now(),p_actor_user_id,p_actor_user_id,p_actor_user_id
    ) on conflict (company_id,capability_code) do update
    set enabled=true,readiness_status='ready',last_verified_at=now(),
        last_verified_by=p_actor_user_id,updated_by=p_actor_user_id,updated_at=now()
    where capability.enabled=false and capability.readiness_status='not_configured'
      and capability.configuration='{}'::jsonb and capability.blockers='{}'::text[]
      and capability.last_verified_at is null and capability.last_verified_by is null
      and capability.created_by is null and capability.updated_by is null
      and capability.updated_at is not distinct from capability.created_at;
  end if;

$projection$;
BEGIN
  IF function_oid IS NULL THEN
    RAISE EXCEPTION 'ediel_checked_production_existing_checked_transition_required';
  END IF;
  SELECT pg_get_functiondef(p.oid),p.prosrc,to_jsonb(p)-'prosrc'
    INTO STRICT original_definition,original_body,original_metadata
  FROM pg_proc p WHERE p.oid=function_oid;
  IF (length(original_body)-length(replace(original_body,anchor,'')))/length(anchor)<>1 THEN
    RAISE EXCEPTION 'ediel_checked_production_exact_checked_command_update_required';
  END IF;
  IF strpos(original_body,'checked_live_untouched_capability_projection_v1')<>0 THEN
    IF (length(original_body)-length(replace(original_body,projection,'')))/length(projection)<>1 THEN
      RAISE EXCEPTION 'ediel_checked_production_exact_existing_projection_required';
    END IF;
    RETURN;
  END IF;
  expected_body:=replace(original_body,anchor,projection||anchor);
  EXECUTE replace(original_definition,anchor,projection||anchor);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=function_oid)
    IS DISTINCT FROM original_metadata
    OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=function_oid)
    IS DISTINCT FROM expected_body THEN
    RAISE EXCEPTION 'ediel_checked_production_checked_metadata_or_body_changed';
  END IF;
END
$project_checked_live$;
COMMIT;
