-- Qualify per-invoice local file receipts and their one exact audit-consumer binding.
-- Uses only pre-existing SET capabilities; no grants, owner transfers, table writes,
-- trigger changes or financial snapshot/persist/finance_guard changes.
BEGIN;
DO $finance_file_reference_and_consumer_pin$
DECLARE
 file_oid oid := 'public.gridex_create_invoice_export_file_v1(uuid,text,text,uuid,jsonb,text)'::regprocedure;
 contract_oid oid := 'gridex_ediel_retention.audit19_source_contract_v1(text)'::regprocedure;
 initial_role text := current_user;
 file_body text; contract_body text; file_next text; contract_next text;
 file_before jsonb; contract_before jsonb; roles_before jsonb; members_before jsonb; schemas_before jsonb;
 file_hash text; contract_hash text; definition text; owner_name text; target oid;
 wanted_body text; original_body text; original_metadata jsonb; actual_metadata jsonb;
 old_map jsonb; next_map jsonb;
 file_old constant text := '26ea8f9fd128c2253d9e3e7a71b7fbd729a1798fe42819f96b0033a37b44b48b';
 file_new constant text := 'fea8868580739ba44f0595fe720e6d7727d107472e6e81497f19cbbf591978f8';
 contract_old constant text := '3125b10daf69038fe4d4c5bd25ba26b34a9fdaeae4c5cbc5d5a0693e1fe0bf3b';
 contract_new constant text := 'c29d375c9a5b0c25aa5655f3444457f1b33e47d93b7be895268b4c7322b10783';
 old_expression constant text := $old$partner_invoice_reference = 'file:' || v_file_id::text$old$;
 new_expression constant text := $new$partner_invoice_reference = 'file:' || v_file_id::text || ':item:' || ((r->>'invoice_export_item_id')::uuid)::text$new$;
 old_pin constant text := $pin$"public.gridex_create_invoice_export_file_v1":"26ea8f9fd128c2253d9e3e7a71b7fbd729a1798fe42819f96b0033a37b44b48b"$pin$;
 new_pin constant text := $pin$"public.gridex_create_invoice_export_file_v1":"fea8868580739ba44f0595fe720e6d7727d107472e6e81497f19cbbf591978f8"$pin$;
BEGIN
 IF current_user<>session_user OR current_user IN('anon','authenticated','service_role')
 THEN RAISE EXCEPTION 'finance_file_migration_existing_owner_session_required' USING ERRCODE='42501'; END IF;
 SELECT p.prosrc,to_jsonb(p)-'prosrc' INTO STRICT file_body,file_before FROM pg_proc p WHERE p.oid=file_oid;
 SELECT p.prosrc,to_jsonb(p)-'prosrc' INTO STRICT contract_body,contract_before FROM pg_proc p WHERE p.oid=contract_oid;
 IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=file_oid AND p.prosecdef AND p.prorettype='uuid'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog'])
 OR NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=contract_oid AND NOT p.prosecdef AND p.prorettype='jsonb'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog'])
 OR EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid IN(file_oid,contract_oid) AND a.grantee=0 AND a.privilege_type='EXECUTE')
 OR has_function_privilege('anon',file_oid,'EXECUTE') OR has_function_privilege('authenticated',file_oid,'EXECUTE')
 OR NOT has_function_privilege('service_role',file_oid,'EXECUTE')
 OR has_function_privilege('anon',contract_oid,'EXECUTE') OR has_function_privilege('authenticated',contract_oid,'EXECUTE') OR has_function_privilege('service_role',contract_oid,'EXECUTE')
 THEN RAISE EXCEPTION 'finance_file_migration_exact_port_security_profile_required' USING ERRCODE='42501'; END IF;
 file_hash:=encode(sha256(convert_to(file_body,'UTF8')),'hex');
 contract_hash:=encode(sha256(convert_to(contract_body,'UTF8')),'hex');
 IF file_hash=file_new AND contract_hash=contract_new THEN RETURN; END IF;
 IF file_hash IS DISTINCT FROM file_old OR contract_hash IS DISTINCT FROM contract_old
 THEN RAISE EXCEPTION 'finance_file_migration_exact_paired_preimages_required' USING ERRCODE='42501'; END IF;
 IF (length(file_body)-length(replace(file_body,old_expression,'')))/length(old_expression)<>1
 OR (length(contract_body)-length(replace(contract_body,old_pin,'')))/length(old_pin)<>1
 THEN RAISE EXCEPTION 'finance_file_migration_unique_anchors_required'; END IF;
 file_next:=replace(file_body,old_expression,new_expression);
 contract_next:=replace(contract_body,old_pin,new_pin);
 IF encode(sha256(convert_to(file_next,'UTF8')),'hex') IS DISTINCT FROM file_new
 OR encode(sha256(convert_to(contract_next,'UTF8')),'hex') IS DISTINCT FROM contract_new
 THEN RAISE EXCEPTION 'finance_file_migration_exact_paired_postimages_required'; END IF;
 old_map:=split_part(contract_body,'$contracts$',2)::jsonb;
 next_map:=split_part(contract_next,'$contracts$',2)::jsonb;
 IF (SELECT count(*) FROM jsonb_object_keys(old_map))<>91 OR (SELECT count(*) FROM jsonb_object_keys(next_map))<>91
 OR old_map-'public.gridex_create_invoice_export_file_v1' IS DISTINCT FROM next_map-'public.gridex_create_invoice_export_file_v1'
 OR split_part(contract_body,'$signatures$',2) IS DISTINCT FROM split_part(contract_next,'$signatures$',2)
 THEN RAISE EXCEPTION 'finance_file_migration_other_consumers_and_signatures_must_match'; END IF;
 SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) INTO roles_before FROM pg_roles r;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) INTO members_before FROM pg_auth_members m;
 SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) INTO schemas_before FROM pg_namespace n WHERE n.nspname IN('public','gridex_ediel_retention');
 FOREACH target IN ARRAY ARRAY[file_oid,contract_oid] LOOP
  original_body:=CASE target WHEN file_oid THEN file_body ELSE contract_body END;
  wanted_body:=CASE target WHEN file_oid THEN file_next ELSE contract_next END;
  original_metadata:=CASE target WHEN file_oid THEN file_before ELSE contract_before END;
  SELECT pg_get_userbyid(proowner) INTO STRICT owner_name FROM pg_proc WHERE oid=target;
  IF NOT pg_has_role(session_user,owner_name,'SET')
  THEN RAISE EXCEPTION 'finance_file_migration_existing_owner_set_capability_required' USING ERRCODE='42501'; END IF;
  definition:=pg_get_functiondef(target);
  IF (length(definition)-length(replace(definition,original_body,'')))/length(original_body)<>1
  THEN RAISE EXCEPTION 'finance_file_migration_exact_definition_anchor_required'; END IF;
  EXECUTE format('SET LOCAL ROLE %I',owner_name);
  EXECUTE replace(definition,original_body,wanted_body);
  EXECUTE format('SET LOCAL ROLE %I',initial_role);
  SELECT to_jsonb(p)-'prosrc' INTO STRICT actual_metadata FROM pg_proc p WHERE oid=target;
  IF actual_metadata IS DISTINCT FROM original_metadata
  THEN RAISE EXCEPTION 'finance_file_migration_function_metadata_must_match'; END IF;
 END LOOP;
 IF current_user IS DISTINCT FROM initial_role
 OR (SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r) IS DISTINCT FROM roles_before
 OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m) IS DISTINCT FROM members_before
 OR (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','gridex_ediel_retention')) IS DISTINCT FROM schemas_before
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=file_oid) IS DISTINCT FROM file_new
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=contract_oid) IS DISTINCT FROM contract_new
 THEN RAISE EXCEPTION 'finance_file_migration_final_catalog_or_body_mismatch'; END IF;
END $finance_file_reference_and_consumer_pin$;
COMMIT;
