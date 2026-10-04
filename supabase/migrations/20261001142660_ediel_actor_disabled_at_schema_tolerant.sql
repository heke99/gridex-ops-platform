-- public.user_profiles.disabled_at exists only on databases that carry the
-- batch 6d governance columns; the canonical replay has user_status only.
-- 20260728190000 and public.ediel_retention_lock_auth_actor_v1 therefore read
-- it schema-tolerantly (to_jsonb(row)->>'disabled_at'). Three later actor
-- gates referenced the column directly and failed with
-- "column disabled_at does not exist" on the canonical schema, so every
-- retention permission check, retention reviewer lock and recovery execution
-- actor check aborted.
--
-- Same meaning on both shapes: an active profile that is not disabled. Only
-- the column reference changes; signatures, security, configuration and ACLs
-- are unchanged.
BEGIN;
DO $rewrite$DECLARE f record;
 targets CONSTANT text[][]:=ARRAY[
  ARRAY['gridex_ediel_retention.record_permission_v1(uuid,uuid,text)',
   $n$SELECT FROM public.user_profiles WHERE id=actor AND user_status='active' AND disabled_at IS NULL)$n$,
   $n$SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active' AND to_jsonb(u)->>'disabled_at' IS NULL)$n$],
  ARRAY['gridex_ediel_retention.decision_evidence_lock_reviewer_v1(uuid,uuid,text)',
   $n$SELECT FROM public.user_profiles WHERE id=actor AND user_status='active' AND disabled_at IS NULL)$n$,
   $n$SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active' AND to_jsonb(u)->>'disabled_at' IS NULL)$n$],
  ARRAY['gridex_received_sources.require_recovery_execution_actor_v1(uuid,uuid,text)',
   $n$u.user_status='active' AND u.disabled_at IS NULL)$n$,
   $n$u.user_status='active' AND to_jsonb(u)->>'disabled_at' IS NULL)$n$]];
BEGIN
 FOR i IN 1..array_length(targets,1) LOOP
  SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=targets[i][1]::regprocedure;
  IF (length(f.prosrc)-length(replace(f.prosrc,targets[i][2],'')))/length(targets[i][2])<>1 THEN RAISE EXCEPTION 'actor_disabled_at_predecessor_required:%',targets[i][1];END IF;
  EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,targets[i][2],targets[i][3]));
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'actor_disabled_at_metadata_changed:%',targets[i][1];END IF;
 END LOOP;
END$rewrite$;
COMMIT;
