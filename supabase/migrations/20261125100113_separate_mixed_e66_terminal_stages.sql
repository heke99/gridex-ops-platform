-- Keep each durable terminal effect inside its own ordinary worker statement.
DO $migration$
DECLARE
  owner regprocedure:='public.gridex_step_mixed_e66_worker_v1(uuid,text,uuid,uuid,text,uuid,text,uuid,uuid,jsonb)';
  p record;
  changed text;
  normalize_before constant text:=$old$      checkpoint:=gridex_e66_metering_stage.consume_mixed_chunk_v1(
        p_company,p_environment,p_mailbox,p_source,p_actor,p_ide,coalesce(cursor_now,0),8);
      did_progress:=true;
    END IF;
    IF EXISTS (SELECT FROM gridex_e66_metering_stage.mixed_jobs n WHERE (n.source_id,n.transaction_id)=(p_source,p_ide)
      AND n.next_ordinal<n.observation_count) THEN
      PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,false);
      RETURN jsonb_build_object('kind','progress');
    END IF;
    PERFORM gridex_e66_metering_stage.seal_mixed_normalization_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_ide);$old$;
  normalize_after constant text:=$new$      PERFORM gridex_e66_metering_stage.consume_mixed_chunk_v1(
        p_company,p_environment,p_mailbox,p_source,p_actor,p_ide,coalesce(cursor_now,0),8);
      PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,false);
      RETURN jsonb_build_object('kind','progress');
    END IF;
    PERFORM gridex_e66_metering_stage.seal_mixed_normalization_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_ide);
    PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,false);
    RETURN jsonb_build_object('kind','progress');$new$;
  basis_before constant text:=$old$    IF gridex_e66_intake.read_mixed_e73_evidence_v1(p_company,p_environment,p_source,p_actor,p_ide) IS NULL THEN
      PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,true);
      RETURN jsonb_build_object('kind','held','reason','mixed_worker_e73_basis_unavailable','progress',did_progress);
    END IF;
    PERFORM gridex_e66_intake.seal_mixed_e73_request_basis_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_ide);$old$;
  basis_after constant text:=$new$    BEGIN
      PERFORM gridex_e66_intake.seal_mixed_e73_request_basis_v1(p_company,p_environment,p_mailbox,p_source,p_actor,p_ide);
    EXCEPTION WHEN SQLSTATE '55000' THEN
      IF SQLERRM <> 'mixed_e73_basis_evidence_unavailable' THEN RAISE; END IF;
      PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,true);
      RETURN jsonb_build_object('kind','held','reason','mixed_worker_e73_basis_unavailable','progress',false);
    END;
    PERFORM gridex_e66_intake.yield_mixed_worker_attempt_v1(p_source,p_ide,p_worker_lease,false);
    RETURN jsonb_build_object('kind','progress');$new$;
BEGIN
  SELECT f.oid,f.prosrc,pg_get_functiondef(f.oid) AS definition,to_jsonb(f)-'prosrc' AS metadata
  INTO STRICT p FROM pg_proc f WHERE f.oid=owner;
  IF encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') <> 'eaccdf3068acd6385385d02fc437c40f1e27f74bdf2f69df259c3c194b454767'
    OR strpos(p.prosrc,normalize_before)=0 OR strpos(p.prosrc,basis_before)=0
  THEN RAISE EXCEPTION 'mixed_e66_terminal_stage_preimage_changed'; END IF;

  changed:=replace(replace(p.prosrc,normalize_before,normalize_after),basis_before,basis_after);
  changed:=replace(changed,E'  did_progress boolean:=false;\n','');
  changed:=replace(changed,'''progress'',did_progress','''progress'',false');
  IF strpos(changed,'did_progress')<>0 THEN RAISE EXCEPTION 'mixed_e66_terminal_stage_progress_shape_changed'; END IF;
  EXECUTE replace(p.definition,p.prosrc,changed);
  IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE f.oid=p.oid) IS DISTINCT FROM p.metadata
  THEN RAISE EXCEPTION 'mixed_e66_terminal_stage_metadata_changed'; END IF;
END
$migration$;
