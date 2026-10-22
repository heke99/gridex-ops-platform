-- Install only the missing final canonical pre869 retention Storage guards.
-- This is an additive prerequisite, followed by separately qualified869.
-- Uniform exact PRE/POST states are no-ops; partial/unknown states abort.
-- Existing Storage policies/builtins/owners/ACLs remain unchanged. This does
-- not assert Storage RLS admission, physical deletion or native authority.
-- Ordinary catalog SELECT plus existing serial DDL ownership is required;
-- catalog row locks would require forbidden catalog UPDATE privileges.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $retention_storage_guard_prerequisites$
DECLARE
 expected record;actual record;actual_hash text;function_count integer;trigger_count integer;
 pre_count integer:=0;post_count integer:=0;install_missing boolean;
 roles_before jsonb;memberships_before jsonb;namespaces_before jsonb;protected_before jsonb;protected_after jsonb;
 targets constant jsonb := $targets$[
 {"signature":"gridex_ediel_retention.storage_guard_v1()","name":"storage_guard_v1","pre_hash":"c13d549a2fc9ba39bcc543255493974cef4afd926660ada2e86ec55ea313744b","post_hash":"c29fe1d0b39ad2f642595dc4b476b78b1694732d78492a6adad03a2238a44d2d","trigger_name":"ediel_retention_storage_guard"},
 {"signature":"gridex_ediel_retention.contract_storage_guard_v1()","name":"contract_storage_guard_v1","pre_hash":"9bb603eb46f8c7687868c80205613f5ae4315cca1b6d614bbb597aa3f0ed4275","post_hash":"a66d0f57efaed9882bf7ac353e3127f8d166e8afd7769f7b4142cc7a688e29c4","trigger_name":"contract_retention_storage_guard"},
 {"signature":"gridex_ediel_retention.invoice_file_storage_guard_v1()","name":"invoice_file_storage_guard_v1","pre_hash":"b9900b63b92399a6a210d83767bef73c27ca8aa785152ef5377e2ac4b93e8b9d","post_hash":"cfcad8fe52ef1000f5b0b8af6350821a1e6ebb73f35787f44a25acb1e07f1a71","trigger_name":"invoice_file_retention_storage_guard"}
]$targets$::jsonb;
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolinherit AND rolcreaterole AND rolbypassrls)
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner' AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls)
 OR (SELECT nspowner FROM pg_namespace WHERE nspname='gridex_ediel_retention') IS DISTINCT FROM to_regrole('gridex_ediel_retention_owner')::oid
 OR EXISTS(SELECT FROM pg_auth_members WHERE roleid=to_regrole('gridex_ediel_retention_owner') AND member<>to_regrole('postgres'))
 OR (SELECT jsonb_agg(jsonb_build_array(g.rolname,m.admin_option,m.inherit_option,m.set_option) ORDER BY g.rolname COLLATE "C") FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor WHERE m.roleid=to_regrole('gridex_ediel_retention_owner') AND m.member=to_regrole('postgres'))
 IS DISTINCT FROM '[["postgres",false,false,true],["supabase_admin",true,false,false]]'::jsonb
 OR pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') IS DISTINCT FROM false
 OR pg_has_role('postgres','gridex_ediel_retention_owner','SET') IS DISTINCT FROM true
 OR pg_has_role('postgres','supabase_storage_admin','USAGE') IS DISTINCT FROM false
 OR pg_has_role('postgres','supabase_storage_admin','SET') IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'retention_storage_prerequisite_installer_profile_required' USING ERRCODE='42501';END IF;

 -- Qualify direct relation/column and routine epochs without calling them.
 FOR expected IN SELECT * FROM jsonb_to_recordset($relations$[
 {"relation":"gridex_ediel_retention.blob_decisions","owner_name":"gridex_ediel_retention_owner","rls":true,"force_rls":true},
 {"relation":"gridex_ediel_retention.blob_events","owner_name":"gridex_ediel_retention_owner","rls":true,"force_rls":true},
 {"relation":"gridex_ediel_retention.blob_reviews","owner_name":"gridex_ediel_retention_owner","rls":true,"force_rls":true},
 {"relation":"gridex_ediel_retention.blob_tombstones","owner_name":"gridex_ediel_retention_owner","rls":true,"force_rls":true},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","owner_name":"gridex_ediel_retention_owner","rls":true,"force_rls":true},
 {"relation":"gridex_ediel_retention.invoice_file_events","owner_name":"gridex_ediel_retention_owner","rls":true,"force_rls":true},
 {"relation":"gridex_ediel_retention.invoice_file_reviews","owner_name":"gridex_ediel_retention_owner","rls":true,"force_rls":true},
 {"relation":"gridex_ediel_retention.invoice_file_sources","owner_name":"gridex_ediel_retention_owner","rls":true,"force_rls":true},
 {"relation":"gridex_ediel_retention.invoice_file_tombstones","owner_name":"gridex_ediel_retention_owner","rls":true,"force_rls":true},
 {"relation":"gridex_ediel_retention.record_decisions","owner_name":"gridex_ediel_retention_owner","rls":true,"force_rls":true},
 {"relation":"gridex_ediel_retention.record_events","owner_name":"gridex_ediel_retention_owner","rls":true,"force_rls":true},
 {"relation":"gridex_ediel_retention.record_reviews","owner_name":"gridex_ediel_retention_owner","rls":true,"force_rls":true},
 {"relation":"gridex_ediel_retention.record_tombstones","owner_name":"gridex_ediel_retention_owner","rls":true,"force_rls":true},
 {"relation":"public.ediel_message_payloads","owner_name":"postgres","rls":true,"force_rls":false},
 {"relation":"storage.objects","owner_name":"supabase_storage_admin","rls":true,"force_rls":false},
 {"relation":"public.customer_contract_documents","owner_name":"postgres","rls":true,"force_rls":false}
]$relations$::jsonb) AS x(relation text,owner_name text,rls boolean,force_rls boolean) LOOP
  IF NOT EXISTS(SELECT FROM pg_class c WHERE c.oid=to_regclass(expected.relation) AND c.relkind='r'
   AND c.relowner=to_regrole(expected.owner_name) AND c.relrowsecurity=expected.rls AND c.relforcerowsecurity=expected.force_rls)
  THEN RAISE EXCEPTION 'retention_storage_prerequisite_relation_profile_required: %',expected.relation USING ERRCODE='42501';END IF;
 END LOOP;
 FOR expected IN SELECT * FROM jsonb_to_recordset($columns$[
 {"relation":"gridex_ediel_retention.blob_decisions","column_name":"company_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_decisions","column_name":"created_at","type_name":"timestamp with time zone","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_decisions","column_name":"document_byte_length","type_name":"bigint","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.blob_decisions","column_name":"document_bytes","type_name":"bytea","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.blob_decisions","column_name":"document_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_decisions","column_name":"document_purged_at","type_name":"timestamp with time zone","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.blob_decisions","column_name":"id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_decisions","column_name":"issuer_receipt","type_name":"jsonb","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.blob_decisions","column_name":"message_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_decisions","column_name":"retention_class","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_decisions","column_name":"source_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_decisions","column_name":"submitted_by","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_decisions","column_name":"target_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_decisions","column_name":"target_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_events","column_name":"actor_user_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_events","column_name":"created_at","type_name":"timestamp with time zone","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_events","column_name":"id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_events","column_name":"kind","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_events","column_name":"retention_class","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_events","column_name":"target_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_reviews","column_name":"actor_user_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_reviews","column_name":"created_at","type_name":"timestamp with time zone","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_reviews","column_name":"decision_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_reviews","column_name":"id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_reviews","column_name":"outcome","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_reviews","column_name":"reason","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_tombstones","column_name":"actor_user_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_tombstones","column_name":"byte_length","type_name":"bigint","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_tombstones","column_name":"company_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_tombstones","column_name":"created_at","type_name":"timestamp with time zone","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_tombstones","column_name":"decision_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_tombstones","column_name":"message_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_tombstones","column_name":"public_content_hash","type_name":"text","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.blob_tombstones","column_name":"retention_class","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_tombstones","column_name":"review_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_tombstones","column_name":"source_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_tombstones","column_name":"storage_path","type_name":"text","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.blob_tombstones","column_name":"target_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.blob_tombstones","column_name":"target_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","column_name":"company_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","column_name":"created_at","type_name":"timestamp with time zone","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","column_name":"document_byte_length","type_name":"bigint","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","column_name":"document_bytes","type_name":"bytea","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","column_name":"document_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","column_name":"document_purged_at","type_name":"timestamp with time zone","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","column_name":"id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","column_name":"issuer_receipt","type_name":"jsonb","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","column_name":"retention_class","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","column_name":"scope_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","column_name":"source_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","column_name":"source_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","column_name":"submitted_by","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","column_name":"target_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_decisions","column_name":"target_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_events","column_name":"actor_user_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_events","column_name":"created_at","type_name":"timestamp with time zone","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_events","column_name":"kind","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_events","column_name":"source_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_reviews","column_name":"actor_user_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_reviews","column_name":"created_at","type_name":"timestamp with time zone","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_reviews","column_name":"decision_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_reviews","column_name":"id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_reviews","column_name":"outcome","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_reviews","column_name":"reason","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_sources","column_name":"byte_length","type_name":"bigint","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_sources","column_name":"captured_at","type_name":"timestamp with time zone","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_sources","column_name":"captured_by","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_sources","column_name":"company_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_sources","column_name":"id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_sources","column_name":"retention_class","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_sources","column_name":"source_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_sources","column_name":"storage_bucket","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_sources","column_name":"storage_object_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_sources","column_name":"storage_path","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_sources","column_name":"target_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_sources","column_name":"target_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_tombstones","column_name":"actor_user_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_tombstones","column_name":"company_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_tombstones","column_name":"created_at","type_name":"timestamp with time zone","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_tombstones","column_name":"decision_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_tombstones","column_name":"journal_purpose_reference","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_tombstones","column_name":"journal_retain_until","type_name":"timestamp with time zone","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_tombstones","column_name":"review_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.invoice_file_tombstones","column_name":"source_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_decisions","column_name":"company_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_decisions","column_name":"contract_id","type_name":"uuid","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.record_decisions","column_name":"created_at","type_name":"timestamp with time zone","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_decisions","column_name":"customer_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_decisions","column_name":"document_byte_length","type_name":"bigint","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.record_decisions","column_name":"document_bytes","type_name":"bytea","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.record_decisions","column_name":"document_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_decisions","column_name":"document_purged_at","type_name":"timestamp with time zone","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.record_decisions","column_name":"id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_decisions","column_name":"issuer_receipt","type_name":"jsonb","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.record_decisions","column_name":"retention_class","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_decisions","column_name":"source_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_decisions","column_name":"submitted_by","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_decisions","column_name":"target_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_decisions","column_name":"target_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_events","column_name":"actor_user_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_events","column_name":"created_at","type_name":"timestamp with time zone","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_events","column_name":"id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_events","column_name":"kind","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_events","column_name":"retention_class","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_events","column_name":"target_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_reviews","column_name":"actor_user_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_reviews","column_name":"created_at","type_name":"timestamp with time zone","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_reviews","column_name":"decision_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_reviews","column_name":"id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_reviews","column_name":"outcome","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_reviews","column_name":"reason","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_tombstones","column_name":"actor_user_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_tombstones","column_name":"byte_length","type_name":"bigint","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_tombstones","column_name":"company_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_tombstones","column_name":"contract_id","type_name":"uuid","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.record_tombstones","column_name":"created_at","type_name":"timestamp with time zone","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_tombstones","column_name":"customer_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_tombstones","column_name":"decision_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_tombstones","column_name":"journal_purpose_reference","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_tombstones","column_name":"journal_retain_until","type_name":"timestamp with time zone","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_tombstones","column_name":"retention_class","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_tombstones","column_name":"review_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_tombstones","column_name":"source_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_tombstones","column_name":"storage_path","type_name":"text","not_null":false,"generated":""},
 {"relation":"gridex_ediel_retention.record_tombstones","column_name":"target_hash","type_name":"text","not_null":true,"generated":""},
 {"relation":"gridex_ediel_retention.record_tombstones","column_name":"target_id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"public.ediel_message_payloads","column_name":"encrypted_payload_ref","type_name":"text","not_null":false,"generated":""},
 {"relation":"public.ediel_message_payloads","column_name":"metadata","type_name":"jsonb","not_null":true,"generated":""},
 {"relation":"public.customer_contract_documents","column_name":"storage_path","type_name":"text","not_null":false,"generated":""},
 {"relation":"public.customer_contract_documents","column_name":"storage_bucket","type_name":"text","not_null":false,"generated":""},
 {"relation":"storage.objects","column_name":"bucket_id","type_name":"text","not_null":false,"generated":""},
 {"relation":"storage.objects","column_name":"id","type_name":"uuid","not_null":true,"generated":""},
 {"relation":"storage.objects","column_name":"name","type_name":"text","not_null":false,"generated":""},
 {"relation":"storage.objects","column_name":"owner","type_name":"uuid","not_null":false,"generated":""}
]$columns$::jsonb) AS x(relation text,column_name text,type_name text,not_null boolean,generated text) LOOP
  IF NOT EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid=to_regclass(expected.relation) AND a.attname=expected.column_name AND a.attnum>0 AND NOT a.attisdropped
   AND format_type(a.atttypid,a.atttypmod)=expected.type_name AND a.attnotnull=expected.not_null AND a.attgenerated::text=expected.generated)
  THEN RAISE EXCEPTION 'retention_storage_prerequisite_column_profile_required: %.%',expected.relation,expected.column_name USING ERRCODE='42501';END IF;
 END LOOP;
 FOR expected IN SELECT * FROM jsonb_to_recordset($dependencies$[
 {"signature":"gridex_ediel_retention.actor_v1(uuid, uuid, text)","owner_name":"gridex_ediel_retention_owner","language":"plpgsql","volatility":"v","result":"void","retset":false,"argnames":["c","actor","permission"],"hashes":["88a02a898d5d0b97e5da84cf71c763e81c2d7d409cf2229b45c0998db07ff785"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"gridex_ediel_retention.blob_basis_v1(uuid, text, uuid)","owner_name":"gridex_ediel_retention_owner","language":"plpgsql","volatility":"v","result":"jsonb","retset":false,"argnames":["c","k","target"],"hashes":["55e5c91036ea23f79637292f2d318b6392cae00841c16d00b22c61d220563c1c"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"gridex_ediel_retention.blob_current_v1(gridex_ediel_retention.blob_decisions)","owner_name":"gridex_ediel_retention_owner","language":"plpgsql","volatility":"v","result":"uuid","retset":false,"argnames":["d"],"hashes":["c3e008ce015bac1cf5643ed7708a6b68ff6c912c98421f6a4ac2415286c41e1c"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"gridex_ediel_retention.class_permission_v1(uuid, uuid, text)","owner_name":"gridex_ediel_retention_owner","language":"sql","volatility":"v","result":"boolean","retset":false,"argnames":["c","actor","retention_class"],"hashes":["676e260cb26519700f9796ca77ef4983eebf9bf22d7dfd8252c00b70ca7b260e"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"gridex_ediel_retention.invoice_file_actor_v1(uuid, uuid, text)","owner_name":"gridex_ediel_retention_owner","language":"plpgsql","volatility":"v","result":"void","retset":false,"argnames":["c","actor","op"],"hashes":["d9ea2bfa9ecb070db90b93851763ea92991db48085fbdba9db71867b1b9de7b0"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"gridex_ediel_retention.invoice_file_basis_v1(uuid, text, uuid)","owner_name":"gridex_ediel_retention_owner","language":"plpgsql","volatility":"v","result":"jsonb","retset":false,"argnames":["c","k","target"],"hashes":["9900585a85d5ef0614afad713247f273035887c8cd5a4dec3f8de3f5cd400c88"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"gridex_ediel_retention.invoice_file_receipt_v1(gridex_ediel_retention.invoice_file_decisions)","owner_name":"gridex_ediel_retention_owner","language":"plpgsql","volatility":"v","result":"jsonb","retset":false,"argnames":["d"],"hashes":["fd02a779fc8b39b5e9bf6e3b7511a663216f0b115a3297bffcb15761c57ee98f"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"gridex_ediel_retention.permission_v1(uuid, uuid, text)","owner_name":"gridex_ediel_retention_owner","language":"plpgsql","volatility":"v","result":"boolean","retset":false,"argnames":["c","actor","wanted"],"hashes":["32c79a9f30939ab51637d1fbd3ca524766836ec6df5d2371d20e051d2601a51b","6bedde3f4c01c504eae815ba0895b0872603dd2f6d8adace45669b640db689c7","b4027dcae1ce6e709fd37afb329589649197104c801aeb4110454a60045cc0fa"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"gridex_ediel_retention.record_actor_v1(uuid, uuid, text, text)","owner_name":"gridex_ediel_retention_owner","language":"plpgsql","volatility":"v","result":"void","retset":false,"argnames":["c","actor","k","operation"],"hashes":["5028dca28d069a63f2fedd940a993fa7fdd64fb7c4a31e89c6c22f9ef80c00be"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"gridex_ediel_retention.record_basis_v1(uuid, text, uuid)","owner_name":"gridex_ediel_retention_owner","language":"plpgsql","volatility":"v","result":"jsonb","retset":false,"argnames":["c","k","target"],"hashes":["680b65319f1b24411b2014be87f9b32263dee195bacc36f9d2fa100be0379835"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"gridex_ediel_retention.record_current_review_v1(gridex_ediel_retention.record_decisions)","owner_name":"gridex_ediel_retention_owner","language":"plpgsql","volatility":"v","result":"uuid","retset":false,"argnames":["d"],"hashes":["a71d65848192e63cda8a5252fddc1403c332102d450821316962550c22d0da62"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"gridex_ediel_retention.record_permission_v1(uuid, uuid, text)","owner_name":"gridex_ediel_retention_owner","language":"plpgsql","volatility":"v","result":"boolean","retset":false,"argnames":["c","actor","k"],"hashes":["90609c2ea24dbd62637fd83a5f654820dc2f235afae774019dc4cc61ac0dbcf3"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"public.ediel_retention_lock_auth_actor_v1(uuid)","owner_name":"postgres","language":"plpgsql","volatility":"v","result":"boolean","retset":false,"argnames":["p_actor_user_id"],"hashes":["06dc571efe2101ab7991f60817d087451739115392a8bd14fe2cd73454a66d8a"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"public.ediel_retention_session_actor_v1()","owner_name":"postgres","language":"sql","volatility":"s","result":"uuid","retset":false,"argnames":null,"hashes":["f501d732e4247434820ab322cf3caf4b20f7391cc1e98f4c7e5f6618c507c1e3"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"gridex_ediel_retention.invoice_file_current_v1(gridex_ediel_retention.invoice_file_decisions)","owner_name":"gridex_ediel_retention_owner","language":"plpgsql","volatility":"v","result":"uuid","retset":false,"argnames":["d"],"hashes":["d719359fff25150bdd326b0df579385a4d6f1975e45d88023695d58ddff19c9d","259ef215edf8e783ea994e224ad4c3e5391026229287a2d9459f7201aaefa35f"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"gridex_ediel_retention.invoice_file_shared_scope_v1(text, text)","owner_name":"gridex_ediel_retention_owner","language":"plpgsql","volatility":"v","result":"SETOF gridex_ediel_retention.invoice_file_sources","retset":true,"argnames":["bucket","path"],"hashes":["5d01db80cb304e3b4ffa746342dae6929662418ff9101e83e3adef7453390722"],"secdef":true,"config":["search_path=pg_catalog"]},
 {"signature":"auth.uid()","owner_name":"supabase_auth_admin","language":"sql","volatility":"s","result":"uuid","retset":false,"argnames":null,"hashes":["9ab5ea099e74ec09e83b1505c51a3647791195aed7c742dcc3f257dfc7d2f300"],"secdef":false,"config":null}
]$dependencies$::jsonb) AS x(signature text,owner_name text,language text,volatility text,result text,retset boolean,argnames text[],hashes text[],secdef boolean,config text[]) LOOP
  SELECT p.*,l.lanname,pg_get_function_result(p.oid) AS result INTO actual FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(expected.signature);
  IF NOT FOUND OR actual.proowner IS DISTINCT FROM to_regrole(expected.owner_name)::oid OR actual.lanname<>expected.language
   OR actual.prosecdef IS DISTINCT FROM expected.secdef OR actual.proconfig IS DISTINCT FROM expected.config
   OR actual.provolatile::text<>expected.volatility OR actual.result<>expected.result OR actual.proretset IS DISTINCT FROM expected.retset
   OR actual.proargnames IS DISTINCT FROM expected.argnames OR actual.proargmodes IS NOT NULL OR actual.proallargtypes IS NOT NULL
   OR actual.pronargdefaults<>0 OR actual.proargdefaults IS NOT NULL OR actual.provariadic<>0 OR actual.prosupport<>0 OR actual.protrftypes IS NOT NULL
   OR actual.proisstrict OR actual.proleakproof OR actual.proparallel<>'u' OR actual.prokind<>'f'
   OR actual.probin IS NOT NULL OR actual.prosqlbody IS NOT NULL OR actual.procost<>100 OR actual.prorows<>(CASE WHEN expected.retset THEN 1000 ELSE 0 END)
   OR NOT(encode(sha256(convert_to(actual.prosrc,'UTF8')),'hex')=ANY(expected.hashes))
   OR has_function_privilege(CASE WHEN expected.signature='auth.uid()' THEN 'postgres' ELSE 'gridex_ediel_retention_owner' END,actual.oid,'EXECUTE') IS DISTINCT FROM true
   OR has_schema_privilege(CASE WHEN expected.signature='auth.uid()' THEN 'postgres' ELSE 'gridex_ediel_retention_owner' END,actual.pronamespace,'USAGE') IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'retention_storage_prerequisite_routine_profile_required: %',expected.signature USING ERRCODE='42501';END IF;
 END LOOP;
 IF has_table_privilege('gridex_ediel_retention_owner','public.customer_contract_documents','SELECT') IS DISTINCT FROM true
 OR has_table_privilege('gridex_ediel_retention_owner','public.ediel_message_payloads','SELECT') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'retention_storage_existing_direct_select_required' USING ERRCODE='42501';END IF;
 IF has_schema_privilege('postgres','storage','USAGE') IS DISTINCT FROM true
 OR has_table_privilege('postgres','storage.objects','TRIGGER') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'retention_storage_existing_trigger_capability_required' USING ERRCODE='42501';END IF;

 SELECT count(*) INTO function_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gridex_ediel_retention' AND p.proname IN('storage_guard_v1','contract_storage_guard_v1','invoice_file_storage_guard_v1');
 SELECT count(*) INTO trigger_count FROM pg_trigger WHERE tgrelid='storage.objects'::regclass
 AND tgname IN('ediel_retention_storage_guard','contract_retention_storage_guard','invoice_file_retention_storage_guard');
 install_missing:=function_count=0 AND trigger_count=0;
 IF NOT install_missing AND (function_count<>3 OR trigger_count<>3)
 THEN RAISE EXCEPTION 'retention_storage_partial_or_overloaded_state_stop' USING ERRCODE='42501';END IF;

 SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) INTO roles_before FROM pg_roles r;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) INTO memberships_before FROM pg_auth_members m;
 SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) INTO namespaces_before FROM pg_namespace n;
 SELECT jsonb_build_object(
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE NOT(n.nspname='gridex_ediel_retention' AND p.pronargs=0 AND p.proname IN('storage_guard_v1','contract_storage_guard_v1','invoice_file_storage_guard_v1'))),
 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE NOT(t.tgrelid='storage.objects'::regclass AND t.tgname IN('ediel_retention_storage_guard','contract_retention_storage_guard','invoice_file_retention_storage_guard'))),
 'storage',(SELECT to_jsonb(c) FROM pg_class c WHERE c.oid='storage.objects'::regclass),
 'attributes',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid='storage.objects'::regclass),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p),
 'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_attrdef d),
 'defaultACLs',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_default_acl d)
) INTO protected_before;
 IF install_missing THEN
  -- Existing-role bridge, same finite grantor/options as qualified869.
  GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET TRUE GRANTED BY postgres;
  IF pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'retention_storage_owner_bridge_unavailable' USING ERRCODE='42501';END IF;
  SET LOCAL ROLE gridex_ediel_retention_owner;
  EXECUTE $create_guard_0$CREATE FUNCTION gridex_ediel_retention.storage_guard_v1() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE t gridex_ediel_retention.blob_tombstones%rowtype;d gridex_ediel_retention.blob_decisions%rowtype;basis jsonb;r uuid;actor uuid:=public.ediel_retention_session_actor_v1();BEGIN
 IF TG_OP<>'DELETE' AND new.bucket_id='ediel-files' AND EXISTS(SELECT FROM gridex_ediel_retention.blob_tombstones WHERE retention_class='transport_raw_mime_bytes' AND storage_path=new.name) THEN RAISE EXCEPTION 'ediel_storage_retention_object_tombstoned';END IF;
 IF (CASE WHEN TG_OP='INSERT' THEN new.bucket_id ELSE old.bucket_id END) IS DISTINCT FROM 'ediel-files' THEN IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;
 SELECT * INTO t FROM gridex_ediel_retention.blob_tombstones WHERE retention_class='transport_raw_mime_bytes' AND storage_path=(CASE WHEN TG_OP='INSERT' THEN new.name ELSE old.name END);
 IF NOT FOUND THEN IF TG_OP='UPDATE' AND old.name LIKE 'transport/%' AND EXISTS(SELECT FROM public.ediel_message_payloads p WHERE p.encrypted_payload_ref='storage://ediel-files/'||old.name AND p.metadata->>'archive_verified'='true') THEN RAISE EXCEPTION 'ediel_storage_archived_object_immutable';END IF;IF TG_OP='DELETE' AND old.name LIKE 'transport/%' THEN RAISE EXCEPTION 'ediel_storage_native_class_purge_required';END IF;IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;
 IF TG_OP<>'DELETE' THEN RAISE EXCEPTION 'ediel_storage_retention_object_tombstoned';END IF;
 PERFORM gridex_ediel_retention.actor_v1(t.company_id,actor,'ediel.retention.purge');IF gridex_ediel_retention.class_permission_v1(t.company_id,actor,t.retention_class) IS NOT TRUE THEN RAISE EXCEPTION 'blob_retention_scoped_communication_required';END IF;
 SELECT * INTO STRICT d FROM gridex_ediel_retention.blob_decisions WHERE id=t.decision_id FOR UPDATE;r:=gridex_ediel_retention.blob_current_v1(d);basis:=gridex_ediel_retention.blob_basis_v1(t.company_id,t.retention_class,t.target_id);
 IF r IS NULL OR basis->>'targetHash' IS DISTINCT FROM t.target_hash OR basis->>'storagePath' IS DISTINCT FROM old.name THEN RAISE EXCEPTION 'ediel_storage_current_legal_purge_required';END IF;
 INSERT INTO gridex_ediel_retention.blob_events(retention_class,target_id,kind,actor_user_id) VALUES(t.retention_class,t.target_id,'storage_delete_authorized',actor) ON CONFLICT DO NOTHING;RETURN old;
END$$;$create_guard_0$;
  REVOKE ALL ON FUNCTION gridex_ediel_retention.storage_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
  EXECUTE $create_guard_1$CREATE FUNCTION gridex_ediel_retention.contract_storage_guard_v1() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE t gridex_ediel_retention.record_tombstones%rowtype;d gridex_ediel_retention.record_decisions%rowtype;basis jsonb;r uuid;actor uuid:=public.ediel_retention_session_actor_v1();BEGIN
 IF TG_OP<>'DELETE' AND new.bucket_id='customer-contract-documents' AND EXISTS(SELECT FROM gridex_ediel_retention.record_tombstones WHERE retention_class='contract_signed_pdf_bytes' AND storage_path=new.name) THEN RAISE EXCEPTION 'contract_pdf_retention_tombstoned';END IF;
 IF (CASE WHEN TG_OP='INSERT' THEN new.bucket_id ELSE old.bucket_id END) IS DISTINCT FROM 'customer-contract-documents' THEN IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;
 SELECT * INTO t FROM gridex_ediel_retention.record_tombstones WHERE retention_class='contract_signed_pdf_bytes' AND storage_path=(CASE WHEN TG_OP='INSERT' THEN new.name ELSE old.name END);
 IF NOT FOUND THEN IF TG_OP IN('UPDATE','DELETE') AND EXISTS(SELECT FROM public.customer_contract_documents WHERE storage_bucket='customer-contract-documents' AND storage_path=old.name) THEN RAISE EXCEPTION 'contract_pdf_native_class_purge_required';END IF;IF TG_OP='DELETE' THEN RETURN old;ELSE RETURN new;END IF;END IF;
 IF TG_OP<>'DELETE' THEN RAISE EXCEPTION 'contract_pdf_retention_tombstoned';END IF;
 PERFORM gridex_ediel_retention.record_actor_v1(t.company_id,actor,t.retention_class,'ediel.retention.purge');SELECT * INTO STRICT d FROM gridex_ediel_retention.record_decisions WHERE id=t.decision_id FOR UPDATE;
 r:=gridex_ediel_retention.record_current_review_v1(d);basis:=gridex_ediel_retention.record_basis_v1(t.company_id,t.retention_class,t.target_id);
 IF r IS NULL OR basis->>'targetHash' IS DISTINCT FROM t.target_hash OR basis->>'storagePath' IS DISTINCT FROM old.name THEN RAISE EXCEPTION 'contract_pdf_current_legal_purge_required';END IF;
 INSERT INTO gridex_ediel_retention.record_events(retention_class,target_id,kind,actor_user_id) VALUES(t.retention_class,t.target_id,'storage_delete_authorized',actor) ON CONFLICT DO NOTHING;RETURN old;
END$$;$create_guard_1$;
  REVOKE ALL ON FUNCTION gridex_ediel_retention.contract_storage_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
  EXECUTE $create_guard_2$CREATE FUNCTION gridex_ediel_retention.invoice_file_storage_guard_v1() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$DECLARE s gridex_ediel_retention.invoice_file_sources%rowtype;t gridex_ediel_retention.invoice_file_tombstones%rowtype;d gridex_ediel_retention.invoice_file_decisions%rowtype;actor uuid;bucket text;path text;BEGIN
 bucket:=CASE WHEN TG_OP='INSERT' THEN NEW.bucket_id ELSE OLD.bucket_id END;path:=CASE WHEN TG_OP='INSERT' THEN NEW.name ELSE OLD.name END;
 -- An existing actual PDF reference cannot bypass custody by skipping source
 -- capture; each matching row must be represented before any physical DELETE.
 IF TG_OP='DELETE' AND bucket IN('customer-documents','customer-contract-documents','contract-pdfs','billing-exports') THEN PERFORM 1 FROM gridex_ediel_retention.invoice_file_shared_scope_v1(bucket,path);END IF;
 IF TG_OP='UPDATE' AND (NEW.bucket_id IS DISTINCT FROM OLD.bucket_id OR NEW.name IS DISTINCT FROM OLD.name) AND EXISTS(SELECT FROM gridex_ediel_retention.invoice_file_sources WHERE storage_bucket=NEW.bucket_id AND storage_path=NEW.name) THEN RAISE EXCEPTION 'invoice_file_storage_target_immutable';END IF;
 FOR s IN SELECT * FROM gridex_ediel_retention.invoice_file_sources WHERE storage_bucket=bucket AND storage_path=path ORDER BY id FOR SHARE LOOP
  IF TG_OP<>'DELETE' THEN RAISE EXCEPTION 'invoice_file_storage_original_immutable';END IF;
  actor:=public.ediel_retention_session_actor_v1();PERFORM gridex_ediel_retention.invoice_file_actor_v1(s.company_id,actor,'ediel.retention.purge');
  SELECT * INTO t FROM gridex_ediel_retention.invoice_file_tombstones WHERE source_id=s.id;
  IF t.source_id IS NULL THEN RAISE EXCEPTION 'invoice_file_native_tombstone_required';END IF;
  SELECT * INTO STRICT d FROM gridex_ediel_retention.invoice_file_decisions WHERE id=t.decision_id FOR UPDATE;
  IF gridex_ediel_retention.invoice_file_current_v1(d) IS DISTINCT FROM t.review_id THEN RAISE EXCEPTION 'invoice_file_storage_current_legal_review_required';END IF;
  PERFORM 1 FROM gridex_ediel_retention.invoice_file_shared_scope_v1(bucket,path);
  INSERT INTO gridex_ediel_retention.invoice_file_events(source_id,kind,actor_user_id) VALUES(s.id,'storage_delete_authorized',actor) ON CONFLICT DO NOTHING;
 END LOOP;IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END$$;$create_guard_2$;
  REVOKE ALL ON FUNCTION gridex_ediel_retention.invoice_file_storage_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
  RESET ROLE;
  FOR expected IN SELECT * FROM jsonb_to_recordset(targets) AS x(signature text,trigger_name text) LOOP
   IF has_function_privilege(current_user,to_regprocedure(expected.signature),'EXECUTE') IS DISTINCT FROM true
   THEN RAISE EXCEPTION 'retention_storage_inherited_private_execute_required' USING ERRCODE='42501';END IF;
  END LOOP;
  CREATE TRIGGER ediel_retention_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.storage_guard_v1();
  CREATE TRIGGER contract_retention_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.contract_storage_guard_v1();
  CREATE TRIGGER invoice_file_retention_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.invoice_file_storage_guard_v1();
 END IF;
 -- Validate exact target profiles.
 SELECT count(*) INTO function_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gridex_ediel_retention' AND p.proname IN('storage_guard_v1','contract_storage_guard_v1','invoice_file_storage_guard_v1');
 SELECT count(*) INTO trigger_count FROM pg_trigger WHERE tgrelid='storage.objects'::regclass
 AND tgname IN('ediel_retention_storage_guard','contract_retention_storage_guard','invoice_file_retention_storage_guard');
 IF function_count<>3 OR trigger_count<>3
 THEN RAISE EXCEPTION 'retention_storage_partial_or_overloaded_state_stop' USING ERRCODE='42501';END IF;
 FOR expected IN SELECT * FROM jsonb_to_recordset(targets) AS x(signature text,pre_hash text,post_hash text,trigger_name text) LOOP
  SELECT p.*,l.lanname INTO actual FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(expected.signature);
  IF NOT FOUND OR actual.proowner IS DISTINCT FROM 'gridex_ediel_retention_owner'::regrole::oid
   OR actual.lanname<>'plpgsql' OR NOT actual.prosecdef OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
   OR actual.pronargs<>0 OR actual.proargnames IS NOT NULL OR actual.proargmodes IS NOT NULL OR actual.proallargtypes IS NOT NULL
   OR actual.pronargdefaults<>0 OR actual.proargdefaults IS NOT NULL OR actual.provariadic<>0 OR actual.prosupport<>0 OR actual.protrftypes IS NOT NULL
   OR actual.prorettype<>'trigger'::regtype OR actual.proretset OR actual.proisstrict OR actual.proleakproof
   OR actual.prokind<>'f' OR actual.provolatile<>'v' OR actual.proparallel<>'u' OR actual.procost<>100 OR actual.prorows<>0
   OR actual.probin IS NOT NULL OR actual.prosqlbody IS NOT NULL
   OR (SELECT jsonb_agg(jsonb_build_array(a.grantor::regrole::text,a.grantee::regrole::text,a.privilege_type,a.is_grantable)) FROM aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) a)
    IS DISTINCT FROM '[["gridex_ediel_retention_owner","gridex_ediel_retention_owner","EXECUTE",false]]'::jsonb
  THEN RAISE EXCEPTION 'retention_storage_exact_guard_header_owner_acl_required: %',expected.signature USING ERRCODE='42501';END IF;
  actual_hash:=encode(sha256(convert_to(actual.prosrc,'UTF8')),'hex');
  IF actual_hash=expected.pre_hash THEN pre_count:=pre_count+1;
  ELSIF actual_hash=expected.post_hash THEN post_count:=post_count+1;
  ELSE RAISE EXCEPTION 'retention_storage_unknown_guard_body_stop: %',expected.signature USING ERRCODE='42501';END IF;
  IF NOT EXISTS(SELECT FROM pg_trigger t WHERE t.tgrelid='storage.objects'::regclass AND t.tgname=expected.trigger_name
   AND t.tgfoid=actual.oid AND t.tgtype=31 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgnargs=0
   AND t.tgqual IS NULL AND t.tgconstraint=0 AND t.tgconstrrelid=0 AND t.tgconstrindid=0
   AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgparentid=0 AND t.tgattr=''::int2vector AND t.tgargs=''::bytea
   AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL)
   OR EXISTS(SELECT FROM pg_trigger t WHERE t.tgfoid=actual.oid AND (t.tgrelid<>'storage.objects'::regclass OR t.tgname<>expected.trigger_name))
  THEN RAISE EXCEPTION 'retention_storage_exact_trigger_profile_required: %',expected.trigger_name USING ERRCODE='42501';END IF;
 END LOOP;
 IF (pre_count<>3 AND post_count<>3) OR (install_missing AND pre_count<>3)
 THEN RAISE EXCEPTION 'retention_storage_mixed_pre_post_state_stop' USING ERRCODE='42501';END IF;
 IF install_missing THEN
  -- Restore existing membership exactly.
  GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
 END IF;
 IF current_user<>'postgres' OR session_user<>'postgres'
 OR (SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r) IS DISTINCT FROM roles_before
 OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m) IS DISTINCT FROM memberships_before
 OR (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n) IS DISTINCT FROM namespaces_before
 OR pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'retention_storage_roles_memberships_namespaces_must_restore' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object(
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE NOT(n.nspname='gridex_ediel_retention' AND p.pronargs=0 AND p.proname IN('storage_guard_v1','contract_storage_guard_v1','invoice_file_storage_guard_v1'))),
 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE NOT(t.tgrelid='storage.objects'::regclass AND t.tgname IN('ediel_retention_storage_guard','contract_retention_storage_guard','invoice_file_retention_storage_guard'))),
 'storage',(SELECT to_jsonb(c) FROM pg_class c WHERE c.oid='storage.objects'::regclass),
 'attributes',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid='storage.objects'::regclass),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p),
 'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_attrdef d),
 'defaultACLs',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_default_acl d)
) INTO protected_after;
 IF protected_after IS DISTINCT FROM protected_before THEN RAISE EXCEPTION 'retention_storage_non_target_catalog_must_restore' USING ERRCODE='42501';END IF;
END $retention_storage_guard_prerequisites$;
COMMIT;
