-- Four bilateral/national-rescission owners write their audit row into
-- public.audit_logs(...,details), a column audit_logs never had (its JSON
-- payload column is metadata; audit_logs_normalize_context_v1 fills the
-- request/correlation/resource context). Every bilateral H supply effect,
-- matched LK closure end, rescission review and rescission end therefore
-- failed and rolled back. Write the same payload to metadata.
BEGIN;
DO $audit$DECLARE f record;target text;
 needle CONSTANT text:='audit_logs(company_id,actor_user_id,action,entity_type,entity_id,details)';
 replacement CONSTANT text:='audit_logs(company_id,actor_user_id,action,entity_type,entity_id,metadata)';
BEGIN
 FOREACH target IN ARRAY ARRAY['gridex_bilateral_prodat.record_supply_effect_v1(public.ediel_messages)','gridex_bilateral_prodat.record_closure_end_v1(public.ediel_messages,jsonb)',
  'public.ediel_review_supply_rescission_v1(uuid,uuid,uuid,jsonb)','gridex_supply_rescission.record_end_v1(public.ediel_messages,jsonb)'] LOOP
  SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=target::regprocedure;
  IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'audit_metadata_predecessor_required:%',target;END IF;
  EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
  IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'audit_metadata_changed:%',target;END IF;
 END LOOP;
END$audit$;
COMMIT;
