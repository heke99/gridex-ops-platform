-- Retention authority is separate from operational authority. Explicit current
-- own-company retention grants may act on an archived tenant, with actual class
-- policy, separate review, legal issuer and native target checks still required.
-- No global allow, administrator fallback, default role or deadline is added.
BEGIN;
INSERT INTO public.permissions(key,name,category,description,is_active) VALUES
 ('ediel.retention.source_bytes','Retention source artifact bytes','ediel','Explicit class authority for requested-change source artifact bytes',true),
 ('ediel.retention.customer_fields','Retention current customer fields','ediel','Explicit class authority for closed customer canonical personal fields',true),
 ('ediel.retention.original_bytes','Retention received original content','ediel','Explicit class authority for captured received message content',true),
 ('ediel.retention.mime_bytes','Retention transport MIME bytes','ediel','Explicit class authority for immutable entered transport MIME bytes',true)
ON CONFLICT(key) DO NOTHING;
CREATE OR REPLACE FUNCTION gridex_ediel_retention.permission_v1(c uuid,actor uuid,wanted text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE retention_keys constant text[]:=ARRAY['ediel.retention.submit','ediel.retention.review','ediel.retention.purge','ediel.retention.source_bytes','ediel.retention.customer_fields','ediel.retention.original_bytes','ediel.retention.mime_bytes'];
BEGIN
 IF wanted<>ALL(retention_keys) THEN RETURN gridex_requested_changes.scoped_permission_v1(c,actor,wanted) IS TRUE
 AND NOT EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND u.effect='deny' AND p.key=wanted)
 AND NOT EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND (o.company_id=c OR o.company_id IS NULL) AND o.is_active AND o.effect='deny' AND o.permission_key=wanted)
 AND public.gridex_actor_has_company_permission(actor,c,wanted) IS TRUE;END IF;
 IF NOT EXISTS(SELECT FROM public.companies WHERE id=c AND status IN('active','archived','pending_deletion'))
  OR NOT EXISTS(SELECT FROM auth.users WHERE id=actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))
  OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT FROM public.permissions WHERE key=wanted AND is_active)
  OR EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND u.effect='deny' AND p.key=wanted)
  OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND (o.company_id=c OR o.company_id IS NULL) AND o.is_active AND o.effect='deny' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=now()) AND (o.valid_to IS NULL OR now()<o.valid_to))
  OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='deny' AND p.key=wanted) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND u.effect='allow' AND p.is_active AND p.key=wanted)
  OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='allow' AND p.is_active AND p.key=wanted)
  OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND o.company_id=c AND o.is_active AND o.effect='allow' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=now()) AND (o.valid_to IS NULL OR now()<o.valid_to));
END$$;
CREATE FUNCTION gridex_ediel_retention.class_permission_v1(c uuid,actor uuid,retention_class text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT gridex_ediel_retention.permission_v1(c,actor,CASE retention_class WHEN 'requested_change_source_artifact_bytes' THEN 'ediel.retention.source_bytes' WHEN 'customer_canonical_personal_fields' THEN 'ediel.retention.customer_fields' WHEN 'received_ediel_message_content' THEN 'ediel.retention.original_bytes' WHEN 'transport_raw_mime_bytes' THEN 'ediel.retention.mime_bytes' ELSE NULL END) IS TRUE
$$;
-- Replace only retention-local authority expressions in the installed owner
-- functions, preserving complete native policy/bytes/reviewer/immutable checks.
DO $$DECLARE f record;definition text;old_definition text;BEGIN
 FOR f IN SELECT p.oid,p.oid::regprocedure identity,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('ediel_submit_artifact_retention_v1','ediel_review_artifact_retention_v1','ediel_purge_artifact_retention_v1','ediel_submit_customer_retention_v1','ediel_review_customer_retention_v1','ediel_pseudonymise_customer_retention_v1','ediel_submit_blob_retention_v1','ediel_review_blob_retention_v1','ediel_begin_blob_purge_v1') LOOP
  old_definition:=pg_get_functiondef(f.oid);definition:=old_definition;
  IF f.proname LIKE '%customer%' THEN
   definition:=replace(definition,'''customers.write''','''ediel.retention.customer_fields''');
   IF f.proname='ediel_review_customer_retention_v1' THEN definition:=replace(definition,'SELECT * INTO STRICT d FROM gridex_ediel_retention.customer_decisions','IF gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,''customer_canonical_personal_fields'') IS NOT TRUE THEN RAISE EXCEPTION ''retention_current_class_grant_required'';END IF;SELECT * INTO STRICT d FROM gridex_ediel_retention.customer_decisions');END IF;
   IF f.proname='ediel_pseudonymise_customer_retention_v1' THEN definition:=replace(definition,'claims:=gridex_ediel_retention.customer_receipt_v1(d);','IF gridex_ediel_retention.class_permission_v1(p_company_id,r.actor_user_id,''customer_canonical_personal_fields'') IS NOT TRUE THEN RETURN jsonb_build_object(''status'',''held'',''missing'',ARRAY[''current_retention_class_reviewer_authority'']);END IF;claims:=gridex_ediel_retention.customer_receipt_v1(d);');END IF;
  ELSIF f.proname LIKE '%artifact%' THEN
   definition:=replace(definition,'SELECT * INTO STRICT ', 'IF gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,''requested_change_source_artifact_bytes'') IS NOT TRUE THEN RAISE EXCEPTION ''retention_current_class_grant_required'';END IF;SELECT * INTO STRICT ');
   IF f.proname='ediel_purge_artifact_retention_v1' THEN definition:=replace(definition,'claims:=gridex_ediel_retention.receipt_v1(d);','IF gridex_ediel_retention.class_permission_v1(p_company_id,r.actor_user_id,''requested_change_source_artifact_bytes'') IS NOT TRUE THEN RETURN jsonb_build_object(''status'',''held'',''missing'',ARRAY[''current_retention_class_reviewer_authority'']);END IF;claims:=gridex_ediel_retention.receipt_v1(d);');END IF;
  ELSIF f.proname='ediel_submit_blob_retention_v1' THEN
   definition:=replace(definition,'gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,''communication.write'')','gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,p_retention_class)');
  ELSE
   IF f.proname='ediel_begin_blob_purge_v1' THEN definition:=replace(definition,'IF gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,''communication.write'') IS NOT TRUE THEN RAISE EXCEPTION ''blob_retention_scoped_communication_required'' USING ERRCODE=''42501'';END IF;','');END IF;
   definition:=replace(definition,'PERFORM id FROM public.ediel_messages WHERE','IF gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION ''retention_current_class_grant_required'';END IF;PERFORM id FROM public.ediel_messages WHERE');
   IF f.proname='ediel_review_blob_retention_v1' THEN definition:=replace(definition,'IF p_outcome NOT IN','IF gridex_ediel_retention.class_permission_v1(p_company_id,p_actor_user_id,d.retention_class) IS NOT TRUE THEN RAISE EXCEPTION ''retention_current_class_grant_required'';END IF;IF p_outcome NOT IN');END IF;
  END IF;
  IF definition=old_definition THEN RAISE EXCEPTION 'retention_class_owner_interface_not_found: %',f.identity;END IF;
  EXECUTE definition;
 END LOOP;
 FOR f IN SELECT p.oid,p.oid::regprocedure identity,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_retention' AND p.proname IN('blob_current_v1','storage_guard_v1') LOOP
  definition:=pg_get_functiondef(f.oid);
  IF f.proname='blob_current_v1' THEN definition:=replace(definition,'claims:=gridex_ediel_retention.blob_receipt_v1(d);','IF gridex_ediel_retention.class_permission_v1(d.company_id,r.actor_user_id,d.retention_class) IS NOT TRUE THEN RETURN NULL;END IF;claims:=gridex_ediel_retention.blob_receipt_v1(d);');
  ELSE definition:=replace(definition,'gridex_ediel_retention.permission_v1(t.company_id,actor,''communication.write'')','gridex_ediel_retention.class_permission_v1(t.company_id,actor,t.retention_class)');END IF;
  IF definition=pg_get_functiondef(f.oid) THEN RAISE EXCEPTION 'retention_native_class_consumer_interface_not_found: %',f.identity;END IF;EXECUTE definition;
 END LOOP;
END$$;
ALTER FUNCTION gridex_ediel_retention.class_permission_v1(uuid,uuid,text) OWNER TO gridex_ediel_retention_owner;
REVOKE ALL ON FUNCTION gridex_ediel_retention.class_permission_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
