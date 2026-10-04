-- Restore the already implemented authentic TXT adapter after the declared-route
-- owner revision. Preserve declared country updates and source-kind syntax; exact bytes, independent
-- legal identity, declared transport fields, atomicity and prior replay remain.
BEGIN;
DO $forward$
DECLARE signature text; original text; expanded text; original_oid oid; original_acl aclitem[]; original_owner oid; original_config text[];
BEGIN
 IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='gridex_registry_import.batches'::regclass
  AND conname='batches_source_kind_check' AND position('companies_txt' IN pg_get_constraintdef(oid))>0) THEN
  RAISE EXCEPTION 'ediel_registry_txt_source_catalog_required';
 END IF;
 FOREACH signature IN ARRAY ARRAY['public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)',
  'public.ediel_read_actor_registry_batch_v1(uuid,text,text,text)'] LOOP
  SELECT oid,proacl,proowner,proconfig INTO STRICT original_oid,original_acl,original_owner,original_config FROM pg_proc WHERE oid=signature::regprocedure;
  original:=pg_get_functiondef(original_oid);
  IF position('ediel_registry_platform_actor_revoked' IN original)=0 OR position('ediel_registry_exact_source_hash_required' IN original)=0
   OR position('gridex_registry_import.batches' IN original)=0 OR position('reusedExistingRun' IN original)=0 THEN
   RAISE EXCEPTION 'ediel_registry_current_txt_owner_predecessor_required';
  END IF;
  IF signature LIKE '%ediel_apply_%' AND (position('ediel_registry_declared_transport_source_required' IN original)=0
   OR position('ediel_registry_zero_routes_source_held' IN original)=0 OR position('ediel_registry_source_normalization_conflict' IN original)=0) THEN
   RAISE EXCEPTION 'ediel_registry_declared_route_txt_predecessor_required';
  END IF;
  IF signature LIKE '%ediel_read_%' AND position('ediel_registry_exact_original_source_required' IN original)=0 THEN
   RAISE EXCEPTION 'ediel_registry_prior_txt_predecessor_required';
  END IF;
  expanded:=replace(original,'(''companies_xml'',''csv'')','(''companies_xml'',''companies_txt'',''csv'')');
  IF signature LIKE '%ediel_apply_%' THEN
   IF position('org_number=coalesce(org_number,nullif(item->>''orgNumber'','''')),source_reference' IN expanded)=0 THEN
    RAISE EXCEPTION 'ediel_registry_declared_country_update_predecessor_required';
   END IF;
   expanded:=replace(expanded,'org_number=coalesce(org_number,nullif(item->>''orgNumber'','''')),source_reference',
    'org_number=coalesce(org_number,nullif(item->>''orgNumber'','''')),country_code=coalesce(nullif(item->>''countryCode'',''''),country_code),source_reference');
  END IF;
  IF expanded=original OR position('(''companies_xml'',''csv'')' IN expanded)>0 THEN RAISE EXCEPTION 'ediel_registry_txt_source_kind_boundary_required';END IF;
  EXECUTE expanded;
  IF EXISTS(SELECT FROM pg_proc WHERE oid=signature::regprocedure AND
   (oid IS DISTINCT FROM original_oid OR proacl IS DISTINCT FROM original_acl OR proowner IS DISTINCT FROM original_owner OR proconfig IS DISTINCT FROM original_config)) THEN
   RAISE EXCEPTION 'ediel_registry_txt_owner_identity_changed';
  END IF;
 END LOOP;
END $forward$;
COMMIT;
