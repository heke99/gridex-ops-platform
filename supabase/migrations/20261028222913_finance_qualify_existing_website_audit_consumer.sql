-- V3: finite qualification of one unchanged producer with catalog-only private identity lookup.
-- The known private branch does not grant schema USAGE or exempt source-body validation.
-- Does not edit that function, its trigger, file/snapshot functions or policy gates.
BEGIN;
DO $finance_known_website_consumer$
DECLARE
 target oid := 'gridex_ediel_retention.audit19_source_contract_v1(text)'::regprocedure;
 website_oid oid := 'private.gridex_complete_tenant_website_receipt_on_launch_ready_v1()'::regprocedure;
 file_oid oid := 'public.gridex_create_invoice_export_file_v1(uuid,text,text,uuid,jsonb,text)'::regprocedure;
 initial_role text := current_user; owner_name text;
 original text; patched text; definition text;
 before_meta jsonb; after_meta jsonb; website_before jsonb; file_before jsonb;
 roles_before jsonb; memberships_before jsonb; namespaces_before jsonb; triggers_before jsonb; constraints_before jsonb;
 expected_before jsonb; expected_after jsonb; signatures_before jsonb; signatures_after jsonb;
 old_hash constant text := 'c29d375c9a5b0c25aa5655f3444457f1b33e47d93b7be895268b4c7322b10783';
 new_hash constant text := '935084153f171daa9fecd0b03487aaf36cbf99e01857d95c4028668946b10734';
 website_hash constant text := '38666eee982dfe87a8ee40cc5f56077289c947fae631f950cf21f0d5dff35180';
 file_hash constant text := 'fea8868580739ba44f0595fe720e6d7727d107472e6e81497f19cbbf591978f8';
 name_key constant text := 'private.gridex_complete_tenant_website_receipt_on_launch_ready_v1';
 expected_anchor constant text := '$contracts${';
 expected_new constant text := '$contracts${"private.gridex_complete_tenant_website_receipt_on_launch_ready_v1":"38666eee982dfe87a8ee40cc5f56077289c947fae631f950cf21f0d5dff35180",';
 signature_anchor constant text := '$signatures${';
 signature_new constant text := '$signatures${"private.gridex_complete_tenant_website_receipt_on_launch_ready_v1":"private.gridex_complete_tenant_website_receipt_on_launch_ready_v1()",';

 old_identity constant text := $identity_old$f.oid IS DISTINCT FROM to_regprocedure(signatures->>f.name)::oid$identity_old$;
 new_identity constant text := $identity_new$f.oid IS DISTINCT FROM (CASE WHEN f.name='private.gridex_complete_tenant_website_receipt_on_launch_ready_v1' THEN (
   SELECT known.oid FROM pg_proc known JOIN pg_namespace known_ns ON known_ns.oid=known.pronamespace
   WHERE known_ns.nspname='private' AND known.proname='gridex_complete_tenant_website_receipt_on_launch_ready_v1'
    AND signatures->>f.name='private.gridex_complete_tenant_website_receipt_on_launch_ready_v1()'
    AND known.pronargs=0 AND known.proargtypes=''::oidvector AND known.prokind='f'
    AND known.prorettype='trigger'::regtype AND NOT known.proretset AND known.prosecdef
    AND known.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
    AND known.proconfig=ARRAY['search_path=pg_catalog, public, private, extensions']
  ) ELSE to_regprocedure(signatures->>f.name)::oid END)$identity_new$;
BEGIN
 IF current_user<>session_user OR current_user IN('anon','authenticated','service_role')
 THEN RAISE EXCEPTION 'finance_website_consumer_existing_owner_session_required' USING ERRCODE='42501';END IF;
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO STRICT original,before_meta FROM pg_proc p WHERE oid=target;
 SELECT to_jsonb(p) INTO STRICT website_before FROM pg_proc p WHERE oid=website_oid;
 SELECT to_jsonb(p) INTO STRICT file_before FROM pg_proc p WHERE oid=file_oid;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=website_oid) IS DISTINCT FROM website_hash
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=file_oid) IS DISTINCT FROM file_hash
 THEN RAISE EXCEPTION 'finance_website_consumer_exact_registered_producer_and_file_required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT FROM pg_proc WHERE oid=website_oid AND pronargs=0 AND prorettype='trigger'::regtype AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public, private, extensions'])
 OR NOT EXISTS(SELECT FROM pg_proc WHERE oid=file_oid AND prosecdef AND prorettype='uuid'::regtype AND proconfig=ARRAY['search_path=pg_catalog'])
 OR NOT EXISTS(SELECT FROM pg_proc WHERE oid=target AND pronargs=1 AND prorettype='jsonb'::regtype AND NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog'])
 OR EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid IN(target,website_oid,file_oid) AND a.grantee=0 AND a.privilege_type='EXECUTE')
 OR has_function_privilege('anon',file_oid,'EXECUTE') OR has_function_privilege('authenticated',file_oid,'EXECUTE') OR NOT has_function_privilege('service_role',file_oid,'EXECUTE')
 OR has_function_privilege('anon',website_oid,'EXECUTE') OR has_function_privilege('authenticated',website_oid,'EXECUTE') OR has_function_privilege('service_role',website_oid,'EXECUTE')
 OR has_function_privilege('anon',target,'EXECUTE') OR has_function_privilege('authenticated',target,'EXECUTE') OR has_function_privilege('service_role',target,'EXECUTE')
 THEN RAISE EXCEPTION 'finance_website_consumer_exact_private_port_profile_required' USING ERRCODE='42501';END IF;
 IF encode(sha256(convert_to(original,'UTF8')),'hex')=new_hash THEN RETURN;END IF;
 IF encode(sha256(convert_to(original,'UTF8')),'hex') IS DISTINCT FROM old_hash
 THEN RAISE EXCEPTION 'finance_website_consumer_exact_contract_preimage_required' USING ERRCODE='42501';END IF;
 IF (length(original)-length(replace(original,expected_anchor,'')))/length(expected_anchor)<>1
 OR (length(original)-length(replace(original,signature_anchor,'')))/length(signature_anchor)<>1
 OR (length(original)-length(replace(original,old_identity,'')))/length(old_identity)<>1
 THEN RAISE EXCEPTION 'finance_website_consumer_unique_map_and_identity_anchors_required';END IF;
 expected_before:=split_part(original,'$contracts$',2)::jsonb;signatures_before:=split_part(original,'$signatures$',2)::jsonb;
 IF expected_before ? name_key OR signatures_before ? name_key
 OR (SELECT count(*) FROM jsonb_object_keys(expected_before))<>91 OR (SELECT count(*) FROM jsonb_object_keys(signatures_before))<>91
 THEN RAISE EXCEPTION 'finance_website_consumer_exact_missing_known_key_required';END IF;
 patched:=replace(replace(replace(original,expected_anchor,expected_new),signature_anchor,signature_new),old_identity,new_identity);
 IF encode(sha256(convert_to(patched,'UTF8')),'hex') IS DISTINCT FROM new_hash
 THEN RAISE EXCEPTION 'finance_website_consumer_exact_contract_postimage_required';END IF;
 expected_after:=split_part(patched,'$contracts$',2)::jsonb;signatures_after:=split_part(patched,'$signatures$',2)::jsonb;
 IF expected_after-name_key IS DISTINCT FROM expected_before OR signatures_after-name_key IS DISTINCT FROM signatures_before
 OR (SELECT count(*) FROM jsonb_object_keys(expected_after))<>92 OR (SELECT count(*) FROM jsonb_object_keys(signatures_after))<>92
 THEN RAISE EXCEPTION 'finance_website_consumer_all_existing_bindings_must_match';END IF;
 SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY oid) INTO roles_before FROM pg_roles r;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY oid) INTO memberships_before FROM pg_auth_members m;
 SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) INTO namespaces_before FROM pg_namespace n;
 SELECT jsonb_agg(to_jsonb(t) ORDER BY oid) INTO triggers_before FROM pg_trigger t;
 SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) INTO constraints_before FROM pg_constraint c;
 SELECT pg_get_userbyid(proowner) INTO STRICT owner_name FROM pg_proc WHERE oid=target;
 IF NOT pg_has_role(session_user,owner_name,'SET')
 THEN RAISE EXCEPTION 'finance_website_consumer_existing_owner_set_capability_required' USING ERRCODE='42501';END IF;
 definition:=pg_get_functiondef(target);
 IF (length(definition)-length(replace(definition,original,'')))/length(original)<>1
 THEN RAISE EXCEPTION 'finance_website_consumer_exact_definition_anchor_required';END IF;
 EXECUTE format('SET LOCAL ROLE %I',owner_name);EXECUTE replace(definition,original,patched);EXECUTE format('SET LOCAL ROLE %I',initial_role);
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_meta FROM pg_proc p WHERE oid=target;
 IF after_meta IS DISTINCT FROM before_meta
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=target) IS DISTINCT FROM new_hash
 OR (SELECT to_jsonb(p) FROM pg_proc p WHERE oid=website_oid) IS DISTINCT FROM website_before
 OR (SELECT to_jsonb(p) FROM pg_proc p WHERE oid=file_oid) IS DISTINCT FROM file_before
 OR current_user IS DISTINCT FROM initial_role
 OR (SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY oid) FROM pg_roles r) IS DISTINCT FROM roles_before
 OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY oid) FROM pg_auth_members m) IS DISTINCT FROM memberships_before
 OR (SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_namespace n) IS DISTINCT FROM namespaces_before
 OR (SELECT jsonb_agg(to_jsonb(t) ORDER BY oid) FROM pg_trigger t) IS DISTINCT FROM triggers_before
 OR (SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_constraint c) IS DISTINCT FROM constraints_before
 THEN RAISE EXCEPTION 'finance_website_consumer_catalog_role_source_or_schema_mismatch';END IF;
END $finance_known_website_consumer$;
COMMIT;
