-- SQL15: restore only the final canonical Storage admission prerequisites.
-- Root-qualified receiving order: canonical guard foundation -> post869 ->
-- final DB05 permission b402 -> this constructor. No foundation replay.
-- Catalog-only, serialized DDL: no Storage/business rows are read or changed.
-- Supabase policy_grants is an existing supported capability, never modified.
-- One statement is atomic even when the migration transport adds no wrapper.
DO $admission$
DECLARE
 helper_specs constant jsonb := $helpers$[
 {
  "name": "ediel_storage_retention_target_v1",
  "signature": "public.ediel_storage_retention_target_v1(text)",
  "ddl": "CREATE FUNCTION public.ediel_storage_retention_target_v1(p_path text) RETURNS SETOF boolean\n    LANGUAGE sql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    AS $$\n SELECT true FROM gridex_ediel_retention.blob_tombstones t WHERE t.retention_class='transport_raw_mime_bytes' AND t.storage_path=p_path AND gridex_ediel_retention.permission_v1(t.company_id,public.ediel_retention_session_actor_v1(),'ediel.retention.purge') IS TRUE AND EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=t.company_id AND m.user_id=public.ediel_retention_session_actor_v1() AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)\n$$;"
 },
 {
  "name": "ediel_contract_retention_storage_target_v1",
  "signature": "public.ediel_contract_retention_storage_target_v1(text)",
  "ddl": "CREATE FUNCTION public.ediel_contract_retention_storage_target_v1(p_path text) RETURNS SETOF boolean\n    LANGUAGE sql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    AS $$\n SELECT true FROM gridex_ediel_retention.record_tombstones t WHERE t.retention_class='contract_signed_pdf_bytes' AND t.storage_path=p_path AND gridex_ediel_retention.permission_v1(t.company_id,public.ediel_retention_session_actor_v1(),'ediel.retention.purge') IS TRUE AND gridex_ediel_retention.record_permission_v1(t.company_id,public.ediel_retention_session_actor_v1(),t.retention_class) IS TRUE\n$$;"
 },
 {
  "name": "ediel_invoice_file_storage_delete_target_v1",
  "signature": "public.ediel_invoice_file_storage_delete_target_v1(text,text)",
  "ddl": "CREATE FUNCTION public.ediel_invoice_file_storage_delete_target_v1(p_bucket text, p_path text) RETURNS boolean\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'pg_catalog'\n    AS $$DECLARE s gridex_ediel_retention.invoice_file_sources%rowtype;actor uuid:=public.ediel_retention_session_actor_v1();n int:=0;BEGIN FOR s IN SELECT * FROM gridex_ediel_retention.invoice_file_sources WHERE storage_bucket=p_bucket AND storage_path=p_path LOOP n:=n+1;IF NOT EXISTS(SELECT FROM gridex_ediel_retention.invoice_file_tombstones WHERE source_id=s.id) OR gridex_ediel_retention.permission_v1(s.company_id,actor,'ediel.retention.purge') IS NOT TRUE OR gridex_ediel_retention.permission_v1(s.company_id,actor,'ediel.retention.invoice_copy_evidence') IS NOT TRUE THEN RETURN false;END IF;END LOOP;RETURN n>0;END$$;"
 }
]$helpers$::jsonb;
 routine_specs constant jsonb := $routines$[
 {
  "signature": "public.ediel_storage_retention_target_v1(text)",
  "owner": "gridex_ediel_retention_owner",
  "language": "sql",
  "volatility": "v",
  "secdef": true,
  "argnames": [
   "p_path"
  ],
  "args": "text",
  "result": "SETOF boolean",
  "retset": true,
  "config": [
   "search_path=pg_catalog"
  ],
  "hash": "9d80cea8248ec1ffc98f26a4a668a79d29b1a8a0ea937bb12bd5091421149d04",
  "acl": [
   [
    "gridex_ediel_retention_owner",
    "authenticated",
    "EXECUTE",
    false
   ],
   [
    "gridex_ediel_retention_owner",
    "gridex_ediel_retention_owner",
    "EXECUTE",
    false
   ]
  ],
  "new_helper": true,
  "acl_null": false
 },
 {
  "signature": "public.ediel_contract_retention_storage_target_v1(text)",
  "owner": "gridex_ediel_retention_owner",
  "language": "sql",
  "volatility": "v",
  "secdef": true,
  "argnames": [
   "p_path"
  ],
  "args": "text",
  "result": "SETOF boolean",
  "retset": true,
  "config": [
   "search_path=pg_catalog"
  ],
  "hash": "7c06de86b54e1c86aebf9e50e2c607731cf84770ef9ce8a71b1d887283971b8e",
  "acl": [
   [
    "gridex_ediel_retention_owner",
    "authenticated",
    "EXECUTE",
    false
   ],
   [
    "gridex_ediel_retention_owner",
    "gridex_ediel_retention_owner",
    "EXECUTE",
    false
   ]
  ],
  "new_helper": true,
  "acl_null": false
 },
 {
  "signature": "public.ediel_invoice_file_storage_delete_target_v1(text,text)",
  "owner": "gridex_ediel_retention_owner",
  "language": "plpgsql",
  "volatility": "v",
  "secdef": true,
  "argnames": [
   "p_bucket",
   "p_path"
  ],
  "args": "text, text",
  "result": "boolean",
  "retset": false,
  "config": [
   "search_path=pg_catalog"
  ],
  "hash": "df85a493255a141377588f42df213d54e6081a924c091baf3bdf63e25f944c03",
  "acl": [
   [
    "gridex_ediel_retention_owner",
    "authenticated",
    "EXECUTE",
    false
   ],
   [
    "gridex_ediel_retention_owner",
    "gridex_ediel_retention_owner",
    "EXECUTE",
    false
   ]
  ],
  "new_helper": true,
  "acl_null": false
 },
 {
  "signature": "gridex_ediel_retention.permission_v1(uuid,uuid,text)",
  "owner": "gridex_ediel_retention_owner",
  "language": "plpgsql",
  "volatility": "v",
  "secdef": true,
  "argnames": [
   "c",
   "actor",
   "wanted"
  ],
  "args": "uuid, uuid, text",
  "result": "boolean",
  "retset": false,
  "config": [
   "search_path=pg_catalog"
  ],
  "hash": "b4027dcae1ce6e709fd37afb329589649197104c801aeb4110454a60045cc0fa",
  "acl": [
   [
    "gridex_ediel_retention_owner",
    "gridex_ediel_retention_owner",
    "EXECUTE",
    false
   ]
  ],
  "new_helper": false,
  "acl_null": false
 },
 {
  "signature": "gridex_ediel_retention.record_permission_v1(uuid,uuid,text)",
  "owner": "gridex_ediel_retention_owner",
  "language": "plpgsql",
  "volatility": "v",
  "secdef": true,
  "argnames": [
   "c",
   "actor",
   "k"
  ],
  "args": "uuid, uuid, text",
  "result": "boolean",
  "retset": false,
  "config": [
   "search_path=pg_catalog"
  ],
  "hash": "90609c2ea24dbd62637fd83a5f654820dc2f235afae774019dc4cc61ac0dbcf3",
  "acl": [
   [
    "gridex_ediel_retention_owner",
    "gridex_ediel_retention_owner",
    "EXECUTE",
    false
   ]
  ],
  "new_helper": false,
  "acl_null": false
 },
 {
  "signature": "public.ediel_retention_lock_auth_actor_v1(uuid)",
  "owner": "postgres",
  "language": "plpgsql",
  "volatility": "v",
  "secdef": true,
  "argnames": [
   "p_actor_user_id"
  ],
  "args": "uuid",
  "result": "boolean",
  "retset": false,
  "config": [
   "search_path=pg_catalog"
  ],
  "hash": "06dc571efe2101ab7991f60817d087451739115392a8bd14fe2cd73454a66d8a",
  "acl": [
   [
    "postgres",
    "gridex_ediel_retention_owner",
    "EXECUTE",
    false
   ],
   [
    "postgres",
    "postgres",
    "EXECUTE",
    false
   ]
  ],
  "new_helper": false,
  "acl_null": false
 },
 {
  "signature": "public.ediel_retention_session_actor_v1()",
  "owner": "postgres",
  "language": "sql",
  "volatility": "s",
  "secdef": true,
  "argnames": null,
  "args": "",
  "result": "uuid",
  "retset": false,
  "config": [
   "search_path=pg_catalog"
  ],
  "hash": "f501d732e4247434820ab322cf3caf4b20f7391cc1e98f4c7e5f6618c507c1e3",
  "acl": [
   [
    "postgres",
    "gridex_ediel_retention_owner",
    "EXECUTE",
    false
   ],
   [
    "postgres",
    "postgres",
    "EXECUTE",
    false
   ]
  ],
  "new_helper": false,
  "acl_null": false
 },
 {
  "signature": "storage.operation()",
  "owner": "supabase_storage_admin",
  "language": "plpgsql",
  "volatility": "s",
  "secdef": false,
  "argnames": null,
  "args": "",
  "result": "text",
  "retset": false,
  "config": null,
  "hash": "b211a4c4b376b7bd1c50cc5fd2876824c7b639717e6e0d6484482411bebc34af",
  "acl": [
   [
    "supabase_storage_admin",
    "PUBLIC",
    "EXECUTE",
    false
   ],
   [
    "supabase_storage_admin",
    "supabase_storage_admin",
    "EXECUTE",
    false
   ]
  ],
  "new_helper": false,
  "acl_null": true
 },
 {
  "signature": "auth.uid()",
  "owner": "supabase_auth_admin",
  "language": "sql",
  "volatility": "s",
  "secdef": false,
  "argnames": null,
  "args": "",
  "result": "uuid",
  "retset": false,
  "config": null,
  "hash": "9ab5ea099e74ec09e83b1505c51a3647791195aed7c742dcc3f257dfc7d2f300",
  "acl": [
   [
    "supabase_auth_admin",
    "PUBLIC",
    "EXECUTE",
    false
   ],
   [
    "supabase_auth_admin",
    "dashboard_user",
    "EXECUTE",
    false
   ],
   [
    "supabase_auth_admin",
    "supabase_auth_admin",
    "EXECUTE",
    false
   ]
  ],
  "new_helper": false,
  "acl_null": false
 },
 {
  "signature": "gridex_ediel_retention.storage_guard_v1()",
  "owner": "gridex_ediel_retention_owner",
  "language": "plpgsql",
  "volatility": "v",
  "secdef": true,
  "argnames": null,
  "args": "",
  "result": "trigger",
  "retset": false,
  "config": [
   "search_path=pg_catalog"
  ],
  "hash": "c29fe1d0b39ad2f642595dc4b476b78b1694732d78492a6adad03a2238a44d2d",
  "acl": [
   [
    "gridex_ediel_retention_owner",
    "gridex_ediel_retention_owner",
    "EXECUTE",
    false
   ]
  ],
  "new_helper": false,
  "acl_null": false
 },
 {
  "signature": "gridex_ediel_retention.contract_storage_guard_v1()",
  "owner": "gridex_ediel_retention_owner",
  "language": "plpgsql",
  "volatility": "v",
  "secdef": true,
  "argnames": null,
  "args": "",
  "result": "trigger",
  "retset": false,
  "config": [
   "search_path=pg_catalog"
  ],
  "hash": "a66d0f57efaed9882bf7ac353e3127f8d166e8afd7769f7b4142cc7a688e29c4",
  "acl": [
   [
    "gridex_ediel_retention_owner",
    "gridex_ediel_retention_owner",
    "EXECUTE",
    false
   ]
  ],
  "new_helper": false,
  "acl_null": false
 },
 {
  "signature": "gridex_ediel_retention.invoice_file_storage_guard_v1()",
  "owner": "gridex_ediel_retention_owner",
  "language": "plpgsql",
  "volatility": "v",
  "secdef": true,
  "argnames": null,
  "args": "",
  "result": "trigger",
  "retset": false,
  "config": [
   "search_path=pg_catalog"
  ],
  "hash": "cfcad8fe52ef1000f5b0b8af6350821a1e6ebb73f35787f44a25acb1e07f1a71",
  "acl": [
   [
    "gridex_ediel_retention_owner",
    "gridex_ediel_retention_owner",
    "EXECUTE",
    false
   ]
  ],
  "new_helper": false,
  "acl_null": false
 }
]$routines$::jsonb;
 policy_specs constant jsonb := $policies$[
 {
  "name": "contract_qualified_retention_storage_delete",
  "command": "d",
  "permissive": true,
  "roles": [
   "authenticated"
  ],
  "using": "((bucket_id = 'customer-contract-documents'::text) AND (EXISTS ( SELECT\n   FROM public.ediel_contract_retention_storage_target_v1(objects.name) ediel_contract_retention_storage_target_v1(ediel_contract_retention_storage_target_v1))))",
  "check": null,
  "ddl": "CREATE POLICY contract_qualified_retention_storage_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='customer-contract-documents' AND EXISTS(SELECT FROM public.ediel_contract_retention_storage_target_v1(name)));"
 },
 {
  "name": "contract_qualified_retention_storage_delete_visibility",
  "command": "r",
  "permissive": true,
  "roles": [
   "authenticated"
  ],
  "using": "((bucket_id = 'customer-contract-documents'::text) AND (storage.operation() = 'storage.object.delete_many'::text) AND (EXISTS ( SELECT\n   FROM public.ediel_contract_retention_storage_target_v1(objects.name) ediel_contract_retention_storage_target_v1(ediel_contract_retention_storage_target_v1))))",
  "check": null,
  "ddl": "CREATE POLICY contract_qualified_retention_storage_delete_visibility ON storage.objects FOR SELECT TO authenticated\n USING (bucket_id='customer-contract-documents' AND storage.operation()='storage.object.delete_many'\n  AND EXISTS(SELECT FROM public.ediel_contract_retention_storage_target_v1(objects.name)));"
 },
 {
  "name": "ediel_qualified_retention_storage_delete",
  "command": "d",
  "permissive": true,
  "roles": [
   "authenticated"
  ],
  "using": "((bucket_id = 'ediel-files'::text) AND (EXISTS ( SELECT\n   FROM public.ediel_storage_retention_target_v1(objects.name) ediel_storage_retention_target_v1(ediel_storage_retention_target_v1))))",
  "check": null,
  "ddl": "CREATE POLICY ediel_qualified_retention_storage_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='ediel-files' AND EXISTS(SELECT FROM public.ediel_storage_retention_target_v1(name)));"
 },
 {
  "name": "ediel_qualified_retention_storage_delete_visibility",
  "command": "r",
  "permissive": true,
  "roles": [
   "authenticated"
  ],
  "using": "((bucket_id = 'ediel-files'::text) AND (storage.operation() = 'storage.object.delete_many'::text) AND (EXISTS ( SELECT\n   FROM public.ediel_storage_retention_target_v1(objects.name) ediel_storage_retention_target_v1(ediel_storage_retention_target_v1))))",
  "check": null,
  "ddl": "CREATE POLICY ediel_qualified_retention_storage_delete_visibility ON storage.objects FOR SELECT TO authenticated\n USING (bucket_id='ediel-files' AND storage.operation()='storage.object.delete_many'\n  AND EXISTS(SELECT FROM public.ediel_storage_retention_target_v1(objects.name)));"
 },
 {
  "name": "invoice_file_qualified_retention_storage_delete",
  "command": "d",
  "permissive": true,
  "roles": [
   "authenticated"
  ],
  "using": "public.ediel_invoice_file_storage_delete_target_v1(bucket_id, name)",
  "check": null,
  "ddl": "CREATE POLICY invoice_file_qualified_retention_storage_delete ON storage.objects FOR DELETE TO authenticated USING(public.ediel_invoice_file_storage_delete_target_v1(bucket_id,name));"
 },
 {
  "name": "invoice_file_qualified_retention_storage_delete_visibility",
  "command": "r",
  "permissive": true,
  "roles": [
   "authenticated"
  ],
  "using": "((storage.operation() = 'storage.object.delete_many'::text) AND public.ediel_invoice_file_storage_delete_target_v1(bucket_id, name))",
  "check": null,
  "ddl": "CREATE POLICY invoice_file_qualified_retention_storage_delete_visibility ON storage.objects FOR SELECT TO authenticated\n USING (storage.operation()='storage.object.delete_many'\n  AND public.ediel_invoice_file_storage_delete_target_v1(bucket_id,name));"
 }
]$policies$::jsonb;
 columns_specs constant jsonb := $columns$[
 {
  "relation": "gridex_ediel_retention.blob_tombstones",
  "name": "actor_user_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.blob_tombstones",
  "name": "byte_length",
  "type": "bigint",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.blob_tombstones",
  "name": "company_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.blob_tombstones",
  "name": "created_at",
  "type": "timestamp with time zone",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.blob_tombstones",
  "name": "decision_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.blob_tombstones",
  "name": "message_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.blob_tombstones",
  "name": "public_content_hash",
  "type": "text",
  "notnull": false,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.blob_tombstones",
  "name": "retention_class",
  "type": "text",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.blob_tombstones",
  "name": "review_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.blob_tombstones",
  "name": "source_hash",
  "type": "text",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.blob_tombstones",
  "name": "storage_path",
  "type": "text",
  "notnull": false,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.blob_tombstones",
  "name": "target_hash",
  "type": "text",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.blob_tombstones",
  "name": "target_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_sources",
  "name": "byte_length",
  "type": "bigint",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_sources",
  "name": "captured_at",
  "type": "timestamp with time zone",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_sources",
  "name": "captured_by",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_sources",
  "name": "company_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_sources",
  "name": "id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_sources",
  "name": "retention_class",
  "type": "text",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_sources",
  "name": "source_hash",
  "type": "text",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_sources",
  "name": "storage_bucket",
  "type": "text",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_sources",
  "name": "storage_object_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_sources",
  "name": "storage_path",
  "type": "text",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_sources",
  "name": "target_hash",
  "type": "text",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_sources",
  "name": "target_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_tombstones",
  "name": "actor_user_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_tombstones",
  "name": "company_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_tombstones",
  "name": "created_at",
  "type": "timestamp with time zone",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_tombstones",
  "name": "decision_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_tombstones",
  "name": "journal_purpose_reference",
  "type": "text",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_tombstones",
  "name": "journal_retain_until",
  "type": "timestamp with time zone",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_tombstones",
  "name": "review_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.invoice_file_tombstones",
  "name": "source_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.record_tombstones",
  "name": "actor_user_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.record_tombstones",
  "name": "byte_length",
  "type": "bigint",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.record_tombstones",
  "name": "company_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.record_tombstones",
  "name": "contract_id",
  "type": "uuid",
  "notnull": false,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.record_tombstones",
  "name": "created_at",
  "type": "timestamp with time zone",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.record_tombstones",
  "name": "customer_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.record_tombstones",
  "name": "decision_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.record_tombstones",
  "name": "journal_purpose_reference",
  "type": "text",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.record_tombstones",
  "name": "journal_retain_until",
  "type": "timestamp with time zone",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.record_tombstones",
  "name": "retention_class",
  "type": "text",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.record_tombstones",
  "name": "review_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.record_tombstones",
  "name": "source_hash",
  "type": "text",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.record_tombstones",
  "name": "storage_path",
  "type": "text",
  "notnull": false,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.record_tombstones",
  "name": "target_hash",
  "type": "text",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "gridex_ediel_retention.record_tombstones",
  "name": "target_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "public.company_memberships",
  "name": "accepted_at",
  "type": "timestamp with time zone",
  "notnull": false,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "public.company_memberships",
  "name": "company_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "public.company_memberships",
  "name": "is_active",
  "type": "boolean",
  "notnull": false,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "public.company_memberships",
  "name": "membership_role",
  "type": "text",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "public.company_memberships",
  "name": "role",
  "type": "text",
  "notnull": false,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "public.company_memberships",
  "name": "role_key",
  "type": "text",
  "notnull": false,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "public.company_memberships",
  "name": "status",
  "type": "text",
  "notnull": true,
  "generated": "",
  "identity": ""
 },
 {
  "relation": "public.company_memberships",
  "name": "user_id",
  "type": "uuid",
  "notnull": true,
  "generated": "",
  "identity": ""
 }
]$columns$::jsonb;
 guard_specs constant jsonb := $guards$[
 {
  "signature": "gridex_ediel_retention.storage_guard_v1()",
  "trigger": "ediel_retention_storage_guard"
 },
 {
  "signature": "gridex_ediel_retention.contract_storage_guard_v1()",
  "trigger": "contract_retention_storage_guard"
 },
 {
  "signature": "gridex_ediel_retention.invoice_file_storage_guard_v1()",
  "trigger": "invoice_file_retention_storage_guard"
 }
]$guards$::jsonb;
 target_names text[] := ARRAY(SELECT value->>'name' FROM jsonb_array_elements(helper_specs));
 policy_names text[] := ARRAY(SELECT value->>'name' FROM jsonb_array_elements(policy_specs));
 objects_oid oid := to_regclass('storage.objects');
 helper_count integer; policy_count integer; phase integer; spec jsonb; actual record;
 before_roles jsonb; before_members jsonb; before_namespaces jsonb; before_defaults jsonb;
 before_functions jsonb; before_policies jsonb; before_triggers jsonb; before_relations jsonb;
 after_value jsonb; actual_acl jsonb; actual_roles jsonb;
 functions_count integer; policies_count integer; policy_grants jsonb;
BEGIN
 PERFORM set_config('search_path','pg_catalog',true);
 IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 OR current_user<>'postgres' OR session_user<>'postgres'
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolinherit AND rolcreaterole AND rolcreatedb AND rolreplication AND rolbypassrls)
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner' AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls)
 OR EXISTS(SELECT FROM pg_auth_members WHERE roleid='gridex_ediel_retention_owner'::regrole AND member<>'postgres'::regrole)
 OR (SELECT jsonb_agg(jsonb_build_array(g.rolname,m.admin_option,m.inherit_option,m.set_option) ORDER BY g.rolname COLLATE "C") FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor WHERE m.roleid='gridex_ediel_retention_owner'::regrole AND m.member='postgres'::regrole)
 IS DISTINCT FROM '[["postgres",false,false,true],["supabase_admin",true,false,false]]'::jsonb
 OR pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') IS DISTINCT FROM false
 OR pg_has_role('postgres','gridex_ediel_retention_owner','SET') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'retention_admission_qualified_installer_required' USING ERRCODE='42501';END IF;
 IF objects_oid IS NULL OR NOT EXISTS(SELECT FROM pg_class WHERE oid=objects_oid AND relkind='r' AND relrowsecurity AND NOT relforcerowsecurity)
 OR (SELECT nspowner FROM pg_namespace WHERE nspname='gridex_ediel_retention') IS DISTINCT FROM 'gridex_ediel_retention_owner'::regrole::oid
 OR (SELECT nspowner FROM pg_namespace WHERE nspname='public') IS DISTINCT FROM 'pg_database_owner'::regrole::oid
 OR has_schema_privilege('postgres','public','CREATE WITH GRANT OPTION') IS NOT TRUE
 OR has_schema_privilege('gridex_ediel_retention_owner','public','CREATE') IS DISTINCT FROM false
 OR has_schema_privilege('gridex_ediel_retention_owner','public','USAGE') IS NOT TRUE
 OR has_schema_privilege('gridex_ediel_retention_owner','storage','USAGE') IS NOT TRUE
 OR has_schema_privilege('postgres','auth','USAGE') IS NOT TRUE
 OR has_schema_privilege('gridex_ediel_retention_owner','auth','USAGE') IS DISTINCT FROM false
 OR has_schema_privilege('authenticated','storage','USAGE') IS NOT TRUE
 OR has_table_privilege('authenticated',objects_oid,'SELECT') IS NOT TRUE
 OR has_table_privilege('authenticated',objects_oid,'DELETE') IS NOT TRUE
 OR has_table_privilege('gridex_ediel_retention_owner','public.company_memberships','SELECT') IS NOT TRUE
 THEN RAISE EXCEPTION 'retention_admission_namespace_table_prerequisite_required' USING ERRCODE='42501';END IF;
 -- Ordinary ownership is legitimate in a clean PostgreSQL replay. Hosted
 -- postgres instead uses its already configured supautils delegation.
 IF NOT pg_has_role(current_user,(SELECT relowner FROM pg_class WHERE oid=objects_oid),'USAGE') THEN
  BEGIN policy_grants:=current_setting('supautils.policy_grants',true)::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'retention_admission_managed_policy_delegation_required' USING ERRCODE='42501';END;
  IF jsonb_typeof(policy_grants->current_user) IS DISTINCT FROM 'array'
  OR (policy_grants->current_user ? 'storage.objects') IS NOT TRUE
  OR NOT EXISTS(SELECT FROM pg_settings WHERE name='supautils.policy_grants' AND context='sighup')
  THEN RAISE EXCEPTION 'retention_admission_managed_policy_delegation_required' USING ERRCODE='42501';END IF;
 END IF;
 FOR spec IN SELECT value FROM jsonb_array_elements(columns_specs) LOOP
  IF NOT EXISTS(SELECT FROM pg_attribute WHERE attrelid=to_regclass(spec->>'relation') AND attname=spec->>'name' AND attnum>0 AND NOT attisdropped
   AND format_type(atttypid,atttypmod)=spec->>'type' AND attnotnull=(spec->>'notnull')::boolean AND attgenerated::text=spec->>'generated' AND attidentity::text=spec->>'identity')
  THEN RAISE EXCEPTION 'retention_admission_column_prerequisite_required: %.%',spec->>'relation',spec->>'name' USING ERRCODE='42501';END IF;
 END LOOP;
 FOR actual IN SELECT DISTINCT value->>'relation' AS name FROM jsonb_array_elements(columns_specs) LOOP
  IF actual.name LIKE 'gridex_ediel_retention.%' AND (
   NOT EXISTS(SELECT FROM pg_class WHERE oid=to_regclass(actual.name) AND relkind='r' AND relowner='gridex_ediel_retention_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
   OR EXISTS(SELECT FROM pg_roles WHERE rolname IN('anon','authenticated','service_role') AND (has_schema_privilege(oid,'gridex_ediel_retention','USAGE') OR has_table_privilege(oid,to_regclass(actual.name),'SELECT,INSERT,UPDATE,DELETE'))))
  THEN RAISE EXCEPTION 'retention_admission_private_relation_prerequisite_required: %',actual.name USING ERRCODE='42501';END IF;
 END LOOP;
 SELECT count(*) INTO helper_count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(target_names);
 SELECT count(*) INTO policy_count FROM pg_policy WHERE polrelid=objects_oid AND polname=ANY(policy_names);
 IF helper_count NOT IN(0,3) OR policy_count NOT IN(0,6) OR helper_count=0 AND policy_count<>0
 THEN RAISE EXCEPTION 'retention_admission_partial_state_refused' USING ERRCODE='42501';END IF;
 FOR spec IN SELECT value FROM jsonb_array_elements(guard_specs) LOOP
  IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid=objects_oid AND tgname=spec->>'trigger' AND tgfoid=to_regprocedure(spec->>'signature')
   AND tgtype=31 AND tgenabled='O' AND NOT tgisinternal AND tgconstraint=0 AND tgconstrrelid=0 AND tgconstrindid=0 AND tgparentid=0 AND NOT tgdeferrable AND NOT tginitdeferred
   AND tgnargs=0 AND octet_length(tgargs)=0 AND tgattr=''::int2vector AND tgqual IS NULL AND tgoldtable IS NULL AND tgnewtable IS NULL)
  OR (SELECT count(*) FROM pg_trigger WHERE tgfoid=to_regprocedure(spec->>'signature'))<>1
  THEN RAISE EXCEPTION 'retention_admission_post869_trigger_required: %',spec->>'signature' USING ERRCODE='42501';END IF;
 END LOOP;
 SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY oid) INTO before_roles FROM pg_roles r;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY oid) INTO before_members FROM pg_auth_members m;
 SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) INTO before_namespaces FROM pg_namespace n;
 SELECT jsonb_agg(to_jsonb(a) ORDER BY oid) INTO before_defaults FROM pg_default_acl a;
 SELECT jsonb_object_agg(p.oid::text,jsonb_build_object('header',to_jsonb(p)-'prosrc','body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'))) INTO before_functions
 FROM pg_proc p;
 SELECT count(*) INTO functions_count FROM jsonb_object_keys(before_functions);
 SELECT jsonb_object_agg(p.oid::text,to_jsonb(p)) INTO before_policies FROM pg_policy p;
 SELECT count(*) INTO policies_count FROM pg_policy;
 SELECT jsonb_agg(to_jsonb(t) ORDER BY oid) INTO before_triggers FROM pg_trigger t;
 SELECT jsonb_agg(jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,
   'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY attnum) FROM pg_attribute a WHERE a.attrelid=c.oid),
   'constraints',(SELECT jsonb_agg(to_jsonb(k) ORDER BY oid) FROM pg_constraint k WHERE k.conrelid=c.oid),
   'defaults',(SELECT jsonb_agg(to_jsonb(a) ORDER BY oid) FROM pg_attrdef a WHERE a.adrelid=c.oid)) ORDER BY c.oid)
 INTO before_relations FROM pg_class c WHERE c.oid=objects_oid OR c.oid IN(SELECT to_regclass(value->>'relation') FROM jsonb_array_elements(columns_specs));
 FOR phase IN 0..1 LOOP
  FOR spec IN SELECT value FROM jsonb_array_elements(routine_specs) LOOP
   IF phase=0 AND helper_count=0 AND (spec->>'new_helper')::boolean THEN CONTINUE;END IF;
   SELECT p.*,n.nspname,l.lanname INTO actual FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(spec->>'signature');
   IF NOT FOUND THEN RAISE EXCEPTION 'retention_admission_exact_routine_required: %',spec->>'signature' USING ERRCODE='42501';END IF;
   SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
    ORDER BY pg_get_userbyid(a.grantor) COLLATE "C",(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) COLLATE "C",a.privilege_type COLLATE "C",a.is_grantable)
   INTO actual_acl FROM aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) a;
   IF pg_get_userbyid(actual.proowner) IS DISTINCT FROM spec->>'owner' OR actual.lanname IS DISTINCT FROM spec->>'language'
   OR actual.prokind<>'f' OR actual.provolatile::text IS DISTINCT FROM spec->>'volatility' OR actual.prosecdef IS DISTINCT FROM (spec->>'secdef')::boolean
   OR actual.proisstrict OR actual.proparallel<>'u' OR actual.proleakproof OR actual.procost<>100 OR actual.prorows<>(CASE WHEN (spec->>'retset')::boolean THEN 1000 ELSE 0 END)
   OR actual.proretset IS DISTINCT FROM (spec->>'retset')::boolean OR pg_get_function_result(actual.oid) IS DISTINCT FROM spec->>'result'
   OR oidvectortypes(actual.proargtypes) IS DISTINCT FROM spec->>'args' OR to_jsonb(actual.proargnames) IS DISTINCT FROM nullif(spec->'argnames','null'::jsonb)
   OR actual.proargmodes IS NOT NULL OR actual.proallargtypes IS NOT NULL OR actual.provariadic<>0 OR actual.pronargdefaults<>0 OR actual.proargdefaults IS NOT NULL
   OR actual.protrftypes IS NOT NULL OR actual.probin IS NOT NULL OR actual.prosqlbody IS NOT NULL OR actual.prosupport<>0::regproc
   OR to_jsonb(actual.proconfig) IS DISTINCT FROM nullif(spec->'config','null'::jsonb)
   OR encode(sha256(convert_to(actual.prosrc,'UTF8')),'hex') IS DISTINCT FROM spec->>'hash' OR actual_acl IS DISTINCT FROM spec->'acl'
   OR (actual.proacl IS NULL) IS DISTINCT FROM (spec->>'acl_null')::boolean
   OR (SELECT count(*) FROM pg_proc WHERE pronamespace=actual.pronamespace AND proname=actual.proname)<>1
   THEN RAISE EXCEPTION 'retention_admission_exact_routine_profile_required: %',spec->>'signature' USING ERRCODE='42501';END IF;
   IF (spec->>'new_helper')::boolean AND (has_function_privilege('authenticated',actual.oid,'EXECUTE') IS NOT TRUE
    OR EXISTS(SELECT FROM pg_roles WHERE rolname IN('anon','service_role','postgres') AND has_function_privilege(oid,actual.oid,'EXECUTE')))
   THEN RAISE EXCEPTION 'retention_admission_canonical_helper_admission_required' USING ERRCODE='42501';END IF;
  END LOOP;
  IF phase=1 OR policy_count=6 THEN
   FOR spec IN SELECT value FROM jsonb_array_elements(policy_specs) LOOP
    SELECT p.*,pg_get_expr(polqual,polrelid,false) AS using_expression,pg_get_expr(polwithcheck,polrelid,false) AS check_expression INTO actual
    FROM pg_policy p WHERE polrelid=objects_oid AND polname=spec->>'name';
    IF NOT FOUND THEN RAISE EXCEPTION 'retention_admission_exact_policy_required' USING ERRCODE='42501';END IF;
    SELECT to_jsonb(ARRAY(SELECT rolname::text FROM pg_roles WHERE oid=ANY(actual.polroles) ORDER BY rolname COLLATE "C")) INTO actual_roles;
    IF actual.polcmd::text IS DISTINCT FROM spec->>'command' OR actual.polpermissive IS DISTINCT FROM (spec->>'permissive')::boolean
    OR actual_roles IS DISTINCT FROM spec->'roles' OR actual.using_expression IS DISTINCT FROM spec->>'using' OR actual.check_expression IS DISTINCT FROM spec->>'check'
    THEN RAISE EXCEPTION 'retention_admission_exact_policy_profile_required: %',spec->>'name' USING ERRCODE='42501';END IF;
   END LOOP;
  END IF;
  IF phase=0 THEN
   IF helper_count=0 THEN
    GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET TRUE GRANTED BY postgres;
    GRANT CREATE ON SCHEMA public TO gridex_ediel_retention_owner;
    FOR spec IN SELECT value FROM jsonb_array_elements(helper_specs) LOOP
     EXECUTE spec->>'ddl';
     EXECUTE format('ALTER FUNCTION %s OWNER TO gridex_ediel_retention_owner',spec->>'signature');
    END LOOP;
    -- Legitimate owner context fixes both privilege and grantor, including
    -- postgres/service-role entries introduced by the creator's default ACL.
    SET LOCAL ROLE gridex_ediel_retention_owner;
    FOR spec IN SELECT value FROM jsonb_array_elements(helper_specs) LOOP
     EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,postgres',spec->>'signature');
     EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',spec->>'signature');
    END LOOP;
    RESET ROLE;
    REVOKE CREATE ON SCHEMA public FROM gridex_ediel_retention_owner;
    GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
   END IF;
   IF policy_count=0 THEN
    FOR spec IN SELECT value FROM jsonb_array_elements(policy_specs) LOOP EXECUTE spec->>'ddl';END LOOP;
   END IF;
  END IF;
 END LOOP;
 IF (SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY oid) FROM pg_roles r) IS DISTINCT FROM before_roles
 OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY oid) FROM pg_auth_members m) IS DISTINCT FROM before_members
 OR (SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_namespace n) IS DISTINCT FROM before_namespaces
 OR (SELECT jsonb_agg(to_jsonb(a) ORDER BY oid) FROM pg_default_acl a) IS DISTINCT FROM before_defaults
 OR (SELECT jsonb_agg(to_jsonb(t) ORDER BY oid) FROM pg_trigger t) IS DISTINCT FROM before_triggers
 THEN RAISE EXCEPTION 'retention_admission_installer_capabilities_must_restore' USING ERRCODE='42501';END IF;
 SELECT jsonb_object_agg(p.oid::text,jsonb_build_object('header',to_jsonb(p)-'prosrc','body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'))) INTO after_value
 FROM pg_proc p WHERE before_functions ? p.oid::text;
 IF after_value IS DISTINCT FROM before_functions OR (SELECT count(*) FROM pg_proc)<>functions_count+(CASE WHEN helper_count=0 THEN 3 ELSE 0 END)
 THEN RAISE EXCEPTION 'retention_admission_existing_functions_must_preserve' USING ERRCODE='42501';END IF;
 SELECT jsonb_object_agg(p.oid::text,to_jsonb(p)) INTO after_value FROM pg_policy p WHERE before_policies ? p.oid::text;
 IF after_value IS DISTINCT FROM before_policies OR (SELECT count(*) FROM pg_policy)<>policies_count+(CASE WHEN policy_count=0 THEN 6 ELSE 0 END)
 THEN RAISE EXCEPTION 'retention_admission_existing_policies_must_preserve' USING ERRCODE='42501';END IF;
 SELECT jsonb_agg(jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,
   'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY attnum) FROM pg_attribute a WHERE a.attrelid=c.oid),
   'constraints',(SELECT jsonb_agg(to_jsonb(k) ORDER BY oid) FROM pg_constraint k WHERE k.conrelid=c.oid),
   'defaults',(SELECT jsonb_agg(to_jsonb(a) ORDER BY oid) FROM pg_attrdef a WHERE a.adrelid=c.oid)) ORDER BY c.oid)
 INTO after_value FROM pg_class c WHERE c.oid=objects_oid OR c.oid IN(SELECT to_regclass(value->>'relation') FROM jsonb_array_elements(columns_specs));
 IF after_value IS DISTINCT FROM before_relations THEN RAISE EXCEPTION 'retention_admission_existing_relations_must_preserve' USING ERRCODE='42501';END IF;
END;
$admission$;
