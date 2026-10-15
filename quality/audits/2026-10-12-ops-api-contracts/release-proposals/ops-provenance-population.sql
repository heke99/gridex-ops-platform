-- OPS-ONLY metadata population, NEVER part of clean migration replay.
-- Execute explicitly after portable schema migration, against piidsfebjqjmnepdpnas only.
-- All 13 actual ledger byte pairs and bounded native semantics must match; mismatches abort.
-- Historical inputs are not current-effect certification. No business RPC or old migration replay.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL standard_conforming_strings=on;
SET LOCAL search_path=pg_catalog,public;
DO $ops_provenance_preflight$
DECLARE
 v_inputs jsonb := '[{"version":"20260804200732","name":"usage_event_identity_and_integration_write_idempotency","filename":"20260804200732_usage_event_identity_and_integration_write_idempotency.sql","source_sha256":"84051d3fcbebf2f568f6e95af8eb47ae0553165d911d072c4baf9cf44cb85bbe","source_md5":"969622f5b950dc5be368cb2deb11c35b","ledger_md5":"969622f5b950dc5be368cb2deb11c35b","ledger_sha256":"84051d3fcbebf2f568f6e95af8eb47ae0553165d911d072c4baf9cf44cb85bbe"},{"version":"20260804202318","name":"ediel_system_actor_uuid_and_draft_intent_repair","filename":"20260804202318_ediel_system_actor_uuid_and_draft_intent_repair.sql","source_sha256":"997b855ee7777dc538de75e3de948374b9add0e685401ed47880524c904f5ec3","source_md5":"5e26e6b775c5fffa8703c1adda243144","ledger_md5":"5e26e6b775c5fffa8703c1adda243144","ledger_sha256":"997b855ee7777dc538de75e3de948374b9add0e685401ed47880524c904f5ec3"},{"version":"20260804202601","name":"integration_api_request_log_idempotency_index_fix","filename":"20260804202601_integration_api_request_log_idempotency_index_fix.sql","source_sha256":"4667f8bea91f8b7b81aaf73a82e2c126276165c5bba646d2864f9dbeb4454101","source_md5":"06bbc21da87dc64134d386a3f0b448e8","ledger_md5":"06bbc21da87dc64134d386a3f0b448e8","ledger_sha256":"4667f8bea91f8b7b81aaf73a82e2c126276165c5bba646d2864f9dbeb4454101"},{"version":"20260806151106","name":"gridex_aud_001_customer_document_storage_isolation","filename":"20260806151106_gridex_aud_001_customer_document_storage_isolation.sql","source_sha256":"0d51528c3d7dcb8e2bd2c92cb8d83eea9212438232d25bb5422158be43d46d16","source_md5":"466f064637339dbb4edd4ff5dbbb0220","ledger_md5":"466f064637339dbb4edd4ff5dbbb0220","ledger_sha256":"0d51528c3d7dcb8e2bd2c92cb8d83eea9212438232d25bb5422158be43d46d16"},{"version":"20260806152004","name":"gridex_aud_001_storage_helper_private_schema","filename":"20260806152004_gridex_aud_001_storage_helper_private_schema.sql","source_sha256":"ae8274a9a37a1ecf672ae1257ee225619fbc48369aaf929af5f07f63e8241d5f","source_md5":"e7e32544d7123c3d17f9d377b5f2650e","ledger_md5":"e7e32544d7123c3d17f9d377b5f2650e","ledger_sha256":"ae8274a9a37a1ecf672ae1257ee225619fbc48369aaf929af5f07f63e8241d5f"},{"version":"20260808214500","name":"grid_owner_direct_actor_join_performance","filename":"20260808214500_grid_owner_direct_actor_join_performance.sql","source_sha256":"c5b1eb1c23f6423845ac3b93053d997c9244112dd7d2376183b0e550ed9bfd43","source_md5":"59d32f7f5088b93204718dccec0ca7d1","ledger_md5":"59d32f7f5088b93204718dccec0ca7d1","ledger_sha256":"c5b1eb1c23f6423845ac3b93053d997c9244112dd7d2376183b0e550ed9bfd43"},{"version":"20260809110000","name":"ops_health_status_qualification","filename":"20260809110000_ops_health_status_qualification.sql","source_sha256":"a84abad61c7c931e93d2aa1298d54d7cd43c886ab12692ffe9b37d69b37adcc3","source_md5":"9d5aba6a6070bb82590aad0493c9ea4c","ledger_md5":"9d5aba6a6070bb82590aad0493c9ea4c","ledger_sha256":"a84abad61c7c931e93d2aa1298d54d7cd43c886ab12692ffe9b37d69b37adcc3"},{"version":"20260809114500","name":"ediel_certificate_status_consistency","filename":"20260809114500_ediel_certificate_status_consistency.sql","source_sha256":"71ed2e9c51221ae11ab54bbf1b6fe60f6566a0f877d1c4a8cd5b02088fa0ae94","source_md5":"796764651bcfe7ad6648c434cc1f810f","ledger_md5":"796764651bcfe7ad6648c434cc1f810f","ledger_sha256":"71ed2e9c51221ae11ab54bbf1b6fe60f6566a0f877d1c4a8cd5b02088fa0ae94"},{"version":"20260815233059","name":"tenant_website_installation_completion_v1","filename":"20260815233059_tenant_website_installation_completion_v1.sql","source_sha256":"e2e1aaf6bb489d7c7392bb7758e5e6c08d87c9ceb54ed907ffd1a65b3e2ee64f","source_md5":"e31bec460206c009a80362b862fea172","ledger_md5":"e31bec460206c009a80362b862fea172","ledger_sha256":"e2e1aaf6bb489d7c7392bb7758e5e6c08d87c9ceb54ed907ffd1a65b3e2ee64f"},{"version":"20260815233411","name":"tenant_website_installation_completion_trigger_v1","filename":"20260815233411_tenant_website_installation_completion_trigger_v1.sql","source_sha256":"e0c39810561d78c64329f98be229f533778de2c2a9e0678d056a05cfb158e827","source_md5":"ba01a5b3411c2deec81bcf1ec344b02d","ledger_md5":"ba01a5b3411c2deec81bcf1ec344b02d","ledger_sha256":"e0c39810561d78c64329f98be229f533778de2c2a9e0678d056a05cfb158e827"},{"version":"20260816135746","name":"partner_api_v1_contract_registration","filename":"20260816135746_partner_api_v1_transactional_contract_create.sql","source_sha256":"2965ebf859b9d4119bbd5d2dc615b7a639372f3c54ece154fd985b8af8c7e6da","source_md5":"f11666baa19af91fd3ff54c0f5a39257","ledger_md5":"f11666baa19af91fd3ff54c0f5a39257","ledger_sha256":"2965ebf859b9d4119bbd5d2dc615b7a639372f3c54ece154fd985b8af8c7e6da"},{"version":"20260819111204","name":"email_event_contract_and_certificate_refresh_hardening","filename":"20260819111204_email_event_contract_and_certificate_refresh_hardening.sql","source_sha256":"b3a53a26f147125877e6debfb9cb86a593f11460502336a1dced2b15099bd38c","source_md5":"8a1085dcf4836f3ef3ae203f295d1738","ledger_md5":"8a1085dcf4836f3ef3ae203f295d1738","ledger_sha256":"b3a53a26f147125877e6debfb9cb86a593f11460502336a1dced2b15099bd38c"},{"version":"20261012235455","name":"ops_api_atomic_permission_and_direction_guards","filename":"20261012235455_ops_api_atomic_permission_and_direction_guards.sql","source_sha256":"442dea4f8688e01164873831d58ab2df4650fbb6aaf8ab47835a409000e1d37d","source_md5":"426317f377c64b38369a47a4f9549247","ledger_md5":"426317f377c64b38369a47a4f9549247","ledger_sha256":"442dea4f8688e01164873831d58ab2df4650fbb6aaf8ab47835a409000e1d37d"}]'::jsonb;
 v_effect jsonb := '{"functions":[{"acl":["postgres=X/postgres","service_role=X/postgres","authenticated=X/postgres"],"oid":"301331","name":"gridex_actor_has_company_permission","owner":"postgres","config":["search_path=public, pg_temp"],"parallel":"u","arguments":"p_actor_user_id uuid, p_company_id uuid, p_permission text","volatility":"v","security_definer":true,"definition_sha256":"41c778dd976883510caa4b4d52cc6ca71fb10a42a6b246c8a969b6e450874470","signature":"public.gridex_actor_has_company_permission(uuid,uuid,text)"},{"acl":["postgres=X/postgres","service_role=X/postgres"],"oid":"344914","name":"gridex_create_partner_contract_v1","owner":"postgres","config":["search_path=public, extensions, pg_catalog, pg_temp"],"parallel":"u","arguments":"p_company_id uuid, p_api_client_id uuid, p_payload jsonb","volatility":"v","security_definer":true,"definition_sha256":"26a355e738f4b6874b69a624fb96a6e01016b54419d6d3698b42aa6a3683a194","signature":"public.gridex_create_partner_contract_v1(uuid,uuid,jsonb)"},{"acl":["=X/postgres","postgres=X/postgres","service_role=X/postgres"],"oid":"357429","name":"gridex_grid_owner_name_key","owner":"postgres","config":["search_path=public, pg_temp"],"parallel":"s","arguments":"p_name text","volatility":"i","security_definer":false,"definition_sha256":"60b3f6ebf38ba53f12def9088f3ff5b7d584f620be8f5100642e97f936f0c978","signature":"public.gridex_grid_owner_name_key(text)"}],"override_fields":[{"name":"id","type":"uuid","default":"gen_random_uuid()","not_null":true},{"name":"user_id","type":"uuid","default":null,"not_null":true},{"name":"permission_id","type":"uuid","default":null,"not_null":false},{"name":"effect","type":"text","default":"''allow''::text","not_null":true},{"name":"reason","type":"text","default":null,"not_null":false},{"name":"granted_by","type":"uuid","default":null,"not_null":false},{"name":"granted_at","type":"timestamp with time zone","default":"now()","not_null":true},{"name":"expires_at","type":"timestamp with time zone","default":null,"not_null":false},{"name":"permission_key","type":"text","default":null,"not_null":true},{"name":"is_active","type":"boolean","default":"true","not_null":true},{"name":"valid_from","type":"timestamp with time zone","default":null,"not_null":false},{"name":"valid_to","type":"timestamp with time zone","default":null,"not_null":false},{"name":"company_id","type":"uuid","default":null,"not_null":false},{"name":"created_at","type":"timestamp with time zone","default":"now()","not_null":true},{"name":"updated_at","type":"timestamp with time zone","default":"now()","not_null":true},{"name":"created_by","type":"uuid","default":null,"not_null":false},{"name":"updated_by","type":"uuid","default":null,"not_null":false}],"override_constraints":[{"name":"user_permission_overrides_company_id_fkey","validated":true,"definition":"FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT"},{"name":"user_permission_overrides_company_id_user_id_permission_key_key","validated":true,"definition":"UNIQUE (company_id, user_id, permission_key)"},{"name":"user_permission_overrides_effect_check","validated":true,"definition":"CHECK ((effect = ANY (ARRAY[''allow''::text, ''deny''::text])))"},{"name":"user_permission_overrides_global_deny_only","validated":true,"definition":"CHECK (((company_id IS NOT NULL) OR (effect = ''deny''::text)))"},{"name":"user_permission_overrides_permission_id_fkey","validated":true,"definition":"FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE"},{"name":"user_permission_overrides_pkey","validated":true,"definition":"PRIMARY KEY (id)"},{"name":"user_permission_overrides_user_id_permission_id_key","validated":true,"definition":"UNIQUE (user_id, permission_id)"}]}'::jsonb;
 v_expected jsonb;
 v_actual jsonb;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'ops_provenance_migration_owner_required'; END IF;
 IF to_regclass('public.ops_migration_provenance_receipts') IS NULL THEN
  RAISE EXCEPTION 'ops_provenance_registry_migration_required';
 END IF;
 IF EXISTS(SELECT FROM public.ops_migration_provenance_receipts WHERE receipt_id LIKE 'ops-api-000433:%') THEN
  RAISE EXCEPTION 'ops_provenance_receipt_already_registered_requires_new_review';
 END IF;
 FOR v_expected IN SELECT value FROM jsonb_array_elements(v_inputs) LOOP
  IF NOT EXISTS(
   SELECT FROM supabase_migrations.schema_migrations l
   WHERE l.version=v_expected->>'version' AND l.name=v_expected->>'name'
    AND cardinality(l.statements)=1
    AND md5(array_to_string(l.statements,E'\n'))=v_expected->>'ledger_md5'
    AND encode(extensions.digest(convert_to(array_to_string(l.statements,E'\n'),'UTF8'),'sha256'),'hex')=v_expected->>'ledger_sha256'
    AND v_expected->>'source_sha256'=v_expected->>'ledger_sha256'
  ) THEN RAISE EXCEPTION 'ops_provenance_exact_input_drift:%',v_expected->>'version'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations
  WHERE version='20260803145108' AND name='portfolio_lock_transition_immutability_fix'
   AND md5(array_to_string(statements,E'\n'))='7934f6a441d6442111e2e213e1a0f704'
   AND encode(extensions.digest(convert_to(array_to_string(statements,E'\n'),'UTF8'),'sha256'),'hex')='65eb46910d325883436a0a5a117709bc48ab8740d5a402bbabb9ba4999548cf3'
 ) THEN RAISE EXCEPTION 'ops_provenance_original_lock_ledger_drift'; END IF;
 IF NOT EXISTS(SELECT FROM public.canonical_migration_manifest
  WHERE version='20260803145108' AND filename='20260803145108_portfolio_lock_transition_immutability_fix.sql'
   AND checksum='664cf48cc9611c5e80263baf403f94d916fbc0f873ae5c18e719e76a2645e975' AND applied_ledger_version='20260803145108'
   AND applied_ledger_name='portfolio_lock_transition_immutability_fix'
 ) THEN RAISE EXCEPTION 'ops_provenance_historic_manifest_lineage_drift'; END IF;
 IF NOT EXISTS(SELECT FROM pg_class c
  WHERE c.oid='public.gridex_migration_governance_v3'::regclass
   AND pg_get_userbyid(c.relowner)='postgres'
   AND encode(extensions.digest(convert_to(pg_get_viewdef(c.oid,true),'UTF8'),'sha256'),'hex')='1e7b126901e36d658f2db97ca8c67d4852f2d8a9e00348c613fb13d92a0464b6'
   AND has_table_privilege('service_role',c.oid,'SELECT')
   AND NOT has_table_privilege('anon',c.oid,'SELECT')
   AND NOT has_table_privilege('authenticated',c.oid,'SELECT')
 ) THEN RAISE EXCEPTION 'ops_provenance_governance_projection_or_acl_drift'; END IF;

 FOR v_expected IN SELECT value FROM jsonb_array_elements(v_effect->'functions') LOOP
  SELECT jsonb_build_object(
   'owner',pg_get_userbyid(p.proowner),'arguments',pg_get_function_identity_arguments(p.oid),
   'definition_sha256',encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex'),
   'volatility',p.provolatile::text,'security_definer',p.prosecdef,'parallel',p.proparallel::text,
   'config',to_jsonb(p.proconfig),'acl',to_jsonb(p.proacl))
  INTO v_actual FROM pg_proc p WHERE p.oid=to_regprocedure(v_expected->>'signature');
  IF v_actual IS DISTINCT FROM (v_expected-'name'-'signature'-'oid') THEN
   RAISE EXCEPTION 'ops_provenance_native_function_drift:%',v_expected->>'signature';
  END IF;
 END LOOP;
 FOR v_expected IN SELECT value FROM jsonb_array_elements(v_effect->'override_fields') LOOP
  SELECT jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
    'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid))
  INTO v_actual FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid='public.user_permission_overrides'::regclass AND a.attnum>0
    AND NOT a.attisdropped AND a.attname=v_expected->>'name';
  IF v_actual IS DISTINCT FROM v_expected THEN
   RAISE EXCEPTION 'ops_provenance_override_column_drift:%',v_expected->>'name';
  END IF;
 END LOOP;
 FOR v_expected IN SELECT value FROM jsonb_array_elements(v_effect->'override_constraints') LOOP
  SELECT jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated)
  INTO v_actual FROM pg_constraint c
  WHERE c.conrelid='public.user_permission_overrides'::regclass AND c.conname=v_expected->>'name';
  IF v_actual IS DISTINCT FROM v_expected THEN
   RAISE EXCEPTION 'ops_provenance_override_constraint_drift:%',v_expected->>'name';
  END IF;
 END LOOP;
END
$ops_provenance_preflight$;

WITH exact_inputs(version,name,filename,source_sha256,ledger_md5,ledger_sha256) AS(VALUES
 ('20260804200732','usage_event_identity_and_integration_write_idempotency','20260804200732_usage_event_identity_and_integration_write_idempotency.sql','84051d3fcbebf2f568f6e95af8eb47ae0553165d911d072c4baf9cf44cb85bbe','969622f5b950dc5be368cb2deb11c35b','84051d3fcbebf2f568f6e95af8eb47ae0553165d911d072c4baf9cf44cb85bbe'),
 ('20260804202318','ediel_system_actor_uuid_and_draft_intent_repair','20260804202318_ediel_system_actor_uuid_and_draft_intent_repair.sql','997b855ee7777dc538de75e3de948374b9add0e685401ed47880524c904f5ec3','5e26e6b775c5fffa8703c1adda243144','997b855ee7777dc538de75e3de948374b9add0e685401ed47880524c904f5ec3'),
 ('20260804202601','integration_api_request_log_idempotency_index_fix','20260804202601_integration_api_request_log_idempotency_index_fix.sql','4667f8bea91f8b7b81aaf73a82e2c126276165c5bba646d2864f9dbeb4454101','06bbc21da87dc64134d386a3f0b448e8','4667f8bea91f8b7b81aaf73a82e2c126276165c5bba646d2864f9dbeb4454101'),
 ('20260806151106','gridex_aud_001_customer_document_storage_isolation','20260806151106_gridex_aud_001_customer_document_storage_isolation.sql','0d51528c3d7dcb8e2bd2c92cb8d83eea9212438232d25bb5422158be43d46d16','466f064637339dbb4edd4ff5dbbb0220','0d51528c3d7dcb8e2bd2c92cb8d83eea9212438232d25bb5422158be43d46d16'),
 ('20260806152004','gridex_aud_001_storage_helper_private_schema','20260806152004_gridex_aud_001_storage_helper_private_schema.sql','ae8274a9a37a1ecf672ae1257ee225619fbc48369aaf929af5f07f63e8241d5f','e7e32544d7123c3d17f9d377b5f2650e','ae8274a9a37a1ecf672ae1257ee225619fbc48369aaf929af5f07f63e8241d5f'),
 ('20260808214500','grid_owner_direct_actor_join_performance','20260808214500_grid_owner_direct_actor_join_performance.sql','c5b1eb1c23f6423845ac3b93053d997c9244112dd7d2376183b0e550ed9bfd43','59d32f7f5088b93204718dccec0ca7d1','c5b1eb1c23f6423845ac3b93053d997c9244112dd7d2376183b0e550ed9bfd43'),
 ('20260809110000','ops_health_status_qualification','20260809110000_ops_health_status_qualification.sql','a84abad61c7c931e93d2aa1298d54d7cd43c886ab12692ffe9b37d69b37adcc3','9d5aba6a6070bb82590aad0493c9ea4c','a84abad61c7c931e93d2aa1298d54d7cd43c886ab12692ffe9b37d69b37adcc3'),
 ('20260809114500','ediel_certificate_status_consistency','20260809114500_ediel_certificate_status_consistency.sql','71ed2e9c51221ae11ab54bbf1b6fe60f6566a0f877d1c4a8cd5b02088fa0ae94','796764651bcfe7ad6648c434cc1f810f','71ed2e9c51221ae11ab54bbf1b6fe60f6566a0f877d1c4a8cd5b02088fa0ae94'),
 ('20260815233059','tenant_website_installation_completion_v1','20260815233059_tenant_website_installation_completion_v1.sql','e2e1aaf6bb489d7c7392bb7758e5e6c08d87c9ceb54ed907ffd1a65b3e2ee64f','e31bec460206c009a80362b862fea172','e2e1aaf6bb489d7c7392bb7758e5e6c08d87c9ceb54ed907ffd1a65b3e2ee64f'),
 ('20260815233411','tenant_website_installation_completion_trigger_v1','20260815233411_tenant_website_installation_completion_trigger_v1.sql','e0c39810561d78c64329f98be229f533778de2c2a9e0678d056a05cfb158e827','ba01a5b3411c2deec81bcf1ec344b02d','e0c39810561d78c64329f98be229f533778de2c2a9e0678d056a05cfb158e827'),
 ('20260816135746','partner_api_v1_contract_registration','20260816135746_partner_api_v1_transactional_contract_create.sql','2965ebf859b9d4119bbd5d2dc615b7a639372f3c54ece154fd985b8af8c7e6da','f11666baa19af91fd3ff54c0f5a39257','2965ebf859b9d4119bbd5d2dc615b7a639372f3c54ece154fd985b8af8c7e6da'),
 ('20260819111204','email_event_contract_and_certificate_refresh_hardening','20260819111204_email_event_contract_and_certificate_refresh_hardening.sql','b3a53a26f147125877e6debfb9cb86a593f11460502336a1dced2b15099bd38c','8a1085dcf4836f3ef3ae203f295d1738','b3a53a26f147125877e6debfb9cb86a593f11460502336a1dced2b15099bd38c'),
 ('20261012235455','ops_api_atomic_permission_and_direction_guards','20261012235455_ops_api_atomic_permission_and_direction_guards.sql','442dea4f8688e01164873831d58ab2df4650fbb6aaf8ab47835a409000e1d37d','426317f377c64b38369a47a4f9549247','442dea4f8688e01164873831d58ab2df4650fbb6aaf8ab47835a409000e1d37d')
)
INSERT INTO public.ops_migration_provenance_receipts(
 receipt_id,project_ref,applied_ledger_version,applied_ledger_name,canonical_filename,
 source_file_sha256,recorded_input_md5,recorded_input_sha256,receipt_kind,
 source_file_git_commit,source_observation_head,observed_at,effect_scope,effect_verified,effect_evidence
)
SELECT 'ops-api-000433:'||i.version||':exact-input','piidsfebjqjmnepdpnas',i.version,i.name,i.filename,
 i.source_sha256,i.ledger_md5,i.ledger_sha256,'exact_input',
 CASE WHEN i.version='20261012235455' THEN NULL ELSE '995ee01997b729527510ecc43cc6ff144aa5a230' END,
 '995ee01997b729527510ecc43cc6ff144aa5a230','2026-10-13T00:04:33.998998+00:00'::timestamptz,
 CASE WHEN i.version='20261012235455' THEN 'current_native_schema' ELSE 'input_only' END,
 i.version='20261012235455',
 jsonb_build_object(
  'source_proof','Actual local source bytes compared with independently queried recorded SQL SHA256 and MD5; exact byte equality.',
  'native_input_checked_at','2026-10-13T00:04:33.998998+00:00',
  'source_observation','Git observation head does not imply the new uncommitted file was in that commit.',
  'effect_qualification',CASE WHEN i.version='20261012235455'
    THEN 'Current bounded function bodies/OIDs/ACLs and override fields/defaults/constraints. No business RPC or authenticated lifecycle invoked.'
    ELSE 'Historical recorded input only. Current effects, successor definitions, backfills and complete business behavior are not certified.' END,
  'native_snapshot',CASE WHEN i.version='20261012235455' THEN '{"functions":[{"acl":["postgres=X/postgres","service_role=X/postgres","authenticated=X/postgres"],"oid":"301331","name":"gridex_actor_has_company_permission","owner":"postgres","config":["search_path=public, pg_temp"],"parallel":"u","arguments":"p_actor_user_id uuid, p_company_id uuid, p_permission text","volatility":"v","security_definer":true,"definition_sha256":"41c778dd976883510caa4b4d52cc6ca71fb10a42a6b246c8a969b6e450874470","signature":"public.gridex_actor_has_company_permission(uuid,uuid,text)"},{"acl":["postgres=X/postgres","service_role=X/postgres"],"oid":"344914","name":"gridex_create_partner_contract_v1","owner":"postgres","config":["search_path=public, extensions, pg_catalog, pg_temp"],"parallel":"u","arguments":"p_company_id uuid, p_api_client_id uuid, p_payload jsonb","volatility":"v","security_definer":true,"definition_sha256":"26a355e738f4b6874b69a624fb96a6e01016b54419d6d3698b42aa6a3683a194","signature":"public.gridex_create_partner_contract_v1(uuid,uuid,jsonb)"},{"acl":["=X/postgres","postgres=X/postgres","service_role=X/postgres"],"oid":"357429","name":"gridex_grid_owner_name_key","owner":"postgres","config":["search_path=public, pg_temp"],"parallel":"s","arguments":"p_name text","volatility":"i","security_definer":false,"definition_sha256":"60b3f6ebf38ba53f12def9088f3ff5b7d584f620be8f5100642e97f936f0c978","signature":"public.gridex_grid_owner_name_key(text)"}],"override_fields":[{"name":"id","type":"uuid","default":"gen_random_uuid()","not_null":true},{"name":"user_id","type":"uuid","default":null,"not_null":true},{"name":"permission_id","type":"uuid","default":null,"not_null":false},{"name":"effect","type":"text","default":"''allow''::text","not_null":true},{"name":"reason","type":"text","default":null,"not_null":false},{"name":"granted_by","type":"uuid","default":null,"not_null":false},{"name":"granted_at","type":"timestamp with time zone","default":"now()","not_null":true},{"name":"expires_at","type":"timestamp with time zone","default":null,"not_null":false},{"name":"permission_key","type":"text","default":null,"not_null":true},{"name":"is_active","type":"boolean","default":"true","not_null":true},{"name":"valid_from","type":"timestamp with time zone","default":null,"not_null":false},{"name":"valid_to","type":"timestamp with time zone","default":null,"not_null":false},{"name":"company_id","type":"uuid","default":null,"not_null":false},{"name":"created_at","type":"timestamp with time zone","default":"now()","not_null":true},{"name":"updated_at","type":"timestamp with time zone","default":"now()","not_null":true},{"name":"created_by","type":"uuid","default":null,"not_null":false},{"name":"updated_by","type":"uuid","default":null,"not_null":false}],"override_constraints":[{"name":"user_permission_overrides_company_id_fkey","validated":true,"definition":"FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT"},{"name":"user_permission_overrides_company_id_user_id_permission_key_key","validated":true,"definition":"UNIQUE (company_id, user_id, permission_key)"},{"name":"user_permission_overrides_effect_check","validated":true,"definition":"CHECK ((effect = ANY (ARRAY[''allow''::text, ''deny''::text])))"},{"name":"user_permission_overrides_global_deny_only","validated":true,"definition":"CHECK (((company_id IS NOT NULL) OR (effect = ''deny''::text)))"},{"name":"user_permission_overrides_permission_id_fkey","validated":true,"definition":"FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE"},{"name":"user_permission_overrides_pkey","validated":true,"definition":"PRIMARY KEY (id)"},{"name":"user_permission_overrides_user_id_permission_id_key","validated":true,"definition":"UNIQUE (user_id, permission_id)"}]}'::jsonb ELSE '{}'::jsonb END)
FROM exact_inputs i;

-- Keep the historical canonical_manifest checksum exactly as registered.
-- This records the later source rewrite as a separate lineage event, not a
-- claim that the changed current file was the byte input executed in August.
INSERT INTO public.ops_migration_provenance_receipts(
 receipt_id,project_ref,applied_ledger_version,applied_ledger_name,canonical_filename,
 source_file_sha256,recorded_input_md5,recorded_input_sha256,receipt_kind,
 source_file_git_commit,source_observation_head,current_source_sha256,current_source_git_commit,
 observed_at,effect_scope,effect_verified,effect_evidence
) VALUES(
 'ops-api-000433:20260803145108:original-current-lineage','piidsfebjqjmnepdpnas',
 '20260803145108','portfolio_lock_transition_immutability_fix',
 '20260803145108_portfolio_lock_transition_immutability_fix.sql',
 '664cf48cc9611c5e80263baf403f94d916fbc0f873ae5c18e719e76a2645e975','7934f6a441d6442111e2e213e1a0f704','65eb46910d325883436a0a5a117709bc48ab8740d5a402bbabb9ba4999548cf3','historical_source_lineage',
 '1a0bb2682b61a39dde6f4b13058f5e95153e3783','995ee01997b729527510ecc43cc6ff144aa5a230','b712f437c7c7b13c2244df9d561ec76f3d2797ba352fa1bfb062cc9e3d3c5e96','b83f9aebba81c63ca41d3d3289149186abda0ad8',
 '2026-10-13T00:04:33.998998+00:00'::timestamptz,'historical_lineage_only',false,
 jsonb_build_object(
  'original_file_sha256','664cf48cc9611c5e80263baf403f94d916fbc0f873ae5c18e719e76a2645e975','current_file_sha256','b712f437c7c7b13c2244df9d561ec76f3d2797ba352fa1bfb062cc9e3d3c5e96',
  'original_commit','1a0bb2682b61a39dde6f4b13058f5e95153e3783','rewrite_commit','b83f9aebba81c63ca41d3d3289149186abda0ad8',
  'recorded_sql_sha256','65eb46910d325883436a0a5a117709bc48ab8740d5a402bbabb9ba4999548cf3',
  'association_proof','Original Git file SHA256 equals the existing native canonical_manifest historical checksum; recorded SQL retains the original no-patch exception. Current Git rewrite permits an already-canonical lock replay.',
  'qualification','Original file bytes, recorded SQL serialization and rewritten current bytes are distinct evidence. No full effect verification, historic replay or checksum overwrite is claimed.')
);


COMMIT;
