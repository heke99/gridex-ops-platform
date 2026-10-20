-- OPS-ONLY append-only exact input receipts. Not a clean migration file.
-- Existing history/manifests and all business records remain unchanged.
-- Input-only evidence is deliberately not full effects or readiness certification.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public;
LOCK TABLE public.ops_migration_provenance_receipts IN SHARE ROW EXCLUSIVE MODE;
DO $reviewed_input_receipts$
DECLARE expected jsonb; expected_evidence jsonb; existing public.ops_migration_provenance_receipts%ROWTYPE;
 inputs jsonb:='[{"version":"20261013074827","name":"ops_api_global_deny_and_grid_owner_guards","filename":"20261013074827_ops_api_global_deny_and_grid_owner_guards.sql","sha256":"d9e9b2b2c2a292b7ed571c82a32d19c0830b21439be34009f5ed99d245d8ce57","md5":"a65557b21a4a55c71537ca2367410578","receipt":"quality/audits/2026-10-12-ops-api-contracts/global-deny-grid-owner-native-apply-receipt.json"},{"version":"20261013084535","name":"ops_api_staff_deny_and_migration_provenance","filename":"20261013084535_ops_api_staff_deny_and_migration_provenance.sql","sha256":"b61bc1aaeec78fdc06579e9ed02878d3f5dde54c3de93c96e37ea272dcc48fce","md5":"74088b458d625435ec3ea652d0bf72de","receipt":"quality/audits/2026-10-12-ops-api-contracts/staff-governance-native-apply-receipt.json"},{"version":"20261013093430","name":"ops_api_signing_expiry_and_immutable_identity","filename":"20261013093430_ops_api_signing_expiry_and_immutable_identity.sql","sha256":"f346076b7684fc43d4d413b13524c46e4fbb0aa1484921d6a0717a03afdcd4bb","md5":"ea6aeb814397927253350f67e62eba32","receipt":"quality/audits/2026-10-12-ops-api-contracts/signing-expiry-native-apply-receipt.json"},{"version":"20261013093621","name":"ops_api_signing_stockholm_withdrawal_deadline","filename":"20261013093621_ops_api_signing_stockholm_withdrawal_deadline.sql","sha256":"917cd9af78a6d9974649a121aaf74ef95781b1c5ad4a182f9612b0511f45671d","md5":"2bc4da18b8c8bfebf4f4acfdf37b4160","receipt":"quality/audits/2026-10-12-ops-api-contracts/signing-withdrawal-native-apply-receipt.json"},{"version":"20261013093906","name":"ops_api_website_quote_nonexpiring_policy","filename":"20261013093906_ops_api_website_quote_nonexpiring_policy.sql","sha256":"7eceae42dccce7a968182d144389329d1c11466bf0c896afff62250950f9f2ce","md5":"83e3ae82d64ffd7eb56d3bf67612a66c","receipt":"quality/audits/2026-10-12-ops-api-contracts/website-quote-native-apply-receipt.json"},{"version":"20261013093922","name":"ops_api_atomic_interval_pricing_snapshot","filename":"20261013093922_ops_api_atomic_interval_pricing_snapshot.sql","sha256":"c96cfbf2d734da41900782b265c7137c4a4fda82ccce3958588aec365b9db2a5","md5":"a96554f43de8586ddbec2b120acd20ac","receipt":"quality/audits/2026-10-12-ops-api-contracts/pricing-snapshot-native-apply-receipt.json"},{"version":"20261013095628","name":"ops_api_current_context_permission_denies","filename":"20261013095628_ops_api_current_context_permission_denies.sql","sha256":"c0b42937d124b8a50e77e2d773a4a9ce03062a24eff3abb6d93eb49b0affc418","md5":"e5faa53793ebd0059a27906a2962454e","receipt":"quality/audits/2026-10-12-ops-api-contracts/auth-context-native-apply-receipt.json"},{"version":"20261013104143","name":"ops_api_seven_permission_catalog_keys","filename":"20261013104143_ops_api_seven_permission_catalog_keys.sql","sha256":"2ce4e07ee2dee8ffb352e0e387092e7eb8a9bc6802723d408b40b9e0671e4519","md5":"2b21d1da3aa6bcfbb86571f01aaacb82","receipt":"quality/audits/2026-10-12-ops-api-contracts/seven-catalog-native-apply-receipt.json"},{"version":"20261013105521","name":"ops_api_current_auth_token_expiry","filename":"20261013105521_ops_api_current_auth_token_expiry.sql","sha256":"9e3dc9544031b8d42acdaa850c9ba1963d8b6b6ff0c7d35c76f1be49368ba7bf","md5":"17428f943864c6a5426861ec58019355","receipt":"quality/audits/2026-10-12-ops-api-contracts/auth-expiry-native-apply-receipt.json"},{"version":"20261013112412","name":"ops_api_consumption_vat25_authoring","filename":"20261013112412_ops_api_consumption_vat25_authoring.sql","sha256":"0d1eff69cd2cd0a2f347c08417e9ff1b4094a623b1eedc22d02e079cff3ab656","md5":"6c855149b533abcfba3a87479b1b0840","receipt":"quality/audits/2026-10-12-ops-api-contracts/vat25-native-apply-receipt.json"},{"version":"20261013112427","name":"ops_api_consumption_vat25_publication","filename":"20261013112427_ops_api_consumption_vat25_publication.sql","sha256":"ab6c5f1211903acaa646160cf76094f6aa18ffae299f9721ae25808a8d365210","md5":"bb44991d05ac2f5f973e98a41beb12c6","receipt":"quality/audits/2026-10-12-ops-api-contracts/vat25-native-apply-receipt.json"}]'::jsonb;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'ops_forward_input_receipts_owner_required'; END IF;
 FOR expected IN SELECT value FROM jsonb_array_elements(inputs) LOOP
  IF NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations l
   WHERE l.version=expected->>'version' AND l.name=expected->>'name'
    AND cardinality(l.statements)=1
    AND md5(array_to_string(l.statements,E'\n'))=expected->>'md5'
    AND encode(extensions.digest(convert_to(array_to_string(l.statements,E'\n'),'UTF8'),'sha256'),'hex')=expected->>'sha256') THEN
   RAISE EXCEPTION 'ops_forward_recorded_input_drift:%',expected->>'version';
  END IF;
  expected_evidence:=jsonb_build_object('source_proof','Committed source bytes exactly match independently read actual recorded SQL SHA256 and MD5.',
      'bounded_native_receipt',expected->>'receipt',
      'qualification','Exact recorded inputs only. Per-forward bounded native postflight is in source receipts; full history/effects/configured lifecycle remain unqualified.');
  SELECT * INTO existing FROM public.ops_migration_provenance_receipts
   WHERE receipt_id='ops-api-112724:'||(expected->>'version')||':exact-input';
  IF FOUND THEN
   IF existing.project_ref<>'piidsfebjqjmnepdpnas'
     OR existing.applied_ledger_version IS DISTINCT FROM expected->>'version'
     OR existing.applied_ledger_name IS DISTINCT FROM expected->>'name'
     OR existing.canonical_filename IS DISTINCT FROM expected->>'filename'
     OR existing.source_file_sha256 IS DISTINCT FROM expected->>'sha256'
     OR existing.recorded_input_md5 IS DISTINCT FROM expected->>'md5'
     OR existing.recorded_input_sha256 IS DISTINCT FROM expected->>'sha256'
     OR existing.receipt_kind<>'exact_input' OR existing.effect_scope<>'input_only'
     OR existing.effect_verified OR existing.source_file_git_commit IS DISTINCT FROM '3413729586091aeb01906aae1d463c266a01887e'
     OR existing.source_observation_head IS DISTINCT FROM '3413729586091aeb01906aae1d463c266a01887e'
     OR existing.observed_at IS DISTINCT FROM '2026-10-13 11:27:24.061727+00'::timestamptz
     OR existing.current_source_sha256 IS NOT NULL OR existing.current_source_git_commit IS NOT NULL
     OR existing.effect_evidence IS DISTINCT FROM expected_evidence THEN
    RAISE EXCEPTION 'ops_forward_input_receipt_replay_drift:%',expected->>'version';
   END IF;
  ELSE
   INSERT INTO public.ops_migration_provenance_receipts(
    receipt_id,project_ref,applied_ledger_version,applied_ledger_name,canonical_filename,
    source_file_sha256,recorded_input_md5,recorded_input_sha256,receipt_kind,
    source_file_git_commit,source_observation_head,observed_at,effect_scope,effect_verified,effect_evidence)
   VALUES('ops-api-112724:'||(expected->>'version')||':exact-input','piidsfebjqjmnepdpnas',
    expected->>'version',expected->>'name',expected->>'filename',expected->>'sha256',
    expected->>'md5',expected->>'sha256','exact_input','3413729586091aeb01906aae1d463c266a01887e','3413729586091aeb01906aae1d463c266a01887e',
    '2026-10-13 11:27:24.061727+00'::timestamptz,'input_only',false,
    expected_evidence);
  END IF;
 END LOOP;
END;
$reviewed_input_receipts$;
COMMIT;
