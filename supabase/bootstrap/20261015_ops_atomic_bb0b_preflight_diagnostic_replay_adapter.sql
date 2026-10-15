-- Derived replay: converge only source-proven postgres historical SELECT/inheritance; preserve canonical signing/SC031 around unchanged sealed execution.
-- Derived complete-state exception is limited to exact source-pinned canonical bodies.
BEGIN;
SET LOCAL search_path=pg_catalog;
-- Converge only the source-proven historical postgres SELECT grant before sealed capture.
DO $ops_auth_self_select_convergence$
DECLARE
 auth_namespace oid:=to_regnamespace('auth');
 auth_users oid:=to_regclass('auth.users');
 auth_uid oid:=to_regprocedure('auth.uid()');
 namespace_before jsonb;functions_before jsonb;classes_before jsonb;
 columns_before jsonb;triggers_before jsonb;roles_before jsonb;members_before jsonb;
 actual_acl text[];legacy_select boolean:=false;
 schema_acl constant text[]:=ARRAY['supabase_admin=UC/supabase_admin','anon=U/supabase_admin','authenticated=U/supabase_admin','service_role=U/supabase_admin','supabase_auth_admin=UC/supabase_admin','dashboard_user=UC/supabase_admin','postgres=U/supabase_admin'];
 users_acl constant text[]:=ARRAY['supabase_auth_admin=arwdDxtm/supabase_auth_admin','dashboard_user=arwdDxtm/supabase_auth_admin','postgres=ar*wdDxtm/supabase_auth_admin'];
 uid_acl constant text[]:=ARRAY['=X/supabase_auth_admin','supabase_auth_admin=X/supabase_auth_admin','dashboard_user=X/supabase_auth_admin'];
BEGIN
 IF current_user IS DISTINCT FROM 'postgres' OR session_user IS DISTINCT FROM 'postgres'
  OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
  OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolinherit AND rolbypassrls)
  OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner' AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls)
  OR auth_namespace IS NULL OR auth_users IS NULL OR auth_uid IS NULL
  THEN RAISE EXCEPTION 'ops_auth_self_select_qualified_existing_profile_required';END IF;
 IF(SELECT nspowner FROM pg_namespace WHERE oid=auth_namespace) IS DISTINCT FROM 'supabase_admin'::regrole::oid
  OR(SELECT array_agg(a::text ORDER BY a::text COLLATE "C") FROM pg_namespace n CROSS JOIN LATERAL unnest(n.nspacl) a WHERE n.oid=auth_namespace)
   IS DISTINCT FROM(SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(schema_acl) a)
  OR(SELECT proowner FROM pg_proc WHERE oid=auth_uid) IS DISTINCT FROM 'supabase_auth_admin'::regrole::oid
  OR(SELECT array_agg(a::text ORDER BY a::text COLLATE "C") FROM pg_proc p CROSS JOIN LATERAL unnest(p.proacl) a WHERE p.oid=auth_uid)
   IS DISTINCT FROM(SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(uid_acl) a)
  OR NOT EXISTS(SELECT FROM pg_class WHERE oid=auth_users AND relnamespace=auth_namespace AND relname='users' AND relkind='r' AND relowner='supabase_auth_admin'::regrole::oid)
  OR EXISTS(SELECT FROM pg_attribute WHERE attrelid=auth_users AND attacl IS NOT NULL)
  OR has_schema_privilege('gridex_ediel_retention_owner','auth','USAGE') IS DISTINCT FROM false
  OR has_table_privilege('gridex_ediel_retention_owner','auth.users','UPDATE') IS DISTINCT FROM false
  OR has_table_privilege('postgres','auth.users','SELECT WITH GRANT OPTION') IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'ops_auth_self_select_protected_auth_profile_unknown';END IF;
 SELECT array_agg(a::text ORDER BY a::text COLLATE "C") INTO actual_acl FROM pg_class c CROSS JOIN LATERAL unnest(c.relacl) a WHERE c.oid=auth_users;
 IF actual_acl IS NOT DISTINCT FROM(SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(users_acl) a) THEN
  IF has_table_privilege('gridex_ediel_retention_owner','auth.users','SELECT') IS DISTINCT FROM false THEN RAISE EXCEPTION 'ops_auth_self_select_native_inherited_capability_unknown';END IF;
 ELSIF actual_acl IS NOT DISTINCT FROM(SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(users_acl||ARRAY['gridex_ediel_retention_owner=r/postgres']::text[]) a) THEN
  IF has_table_privilege('gridex_ediel_retention_owner','auth.users','SELECT') IS DISTINCT FROM true THEN RAISE EXCEPTION 'ops_auth_self_select_legacy_capability_unknown';END IF;
  legacy_select:=true;
 ELSE RAISE EXCEPTION 'ops_auth_self_select_unknown_users_acl';END IF;
 SELECT to_jsonb(n) INTO STRICT namespace_before FROM pg_namespace n WHERE oid=auth_namespace;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) INTO functions_before FROM pg_proc p WHERE p.pronamespace=auth_namespace;
 SELECT jsonb_agg(CASE WHEN c.oid=auth_users THEN to_jsonb(c)-'relacl' ELSE to_jsonb(c) END ORDER BY c.oid) INTO classes_before FROM pg_class c WHERE c.relnamespace=auth_namespace;
 SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) INTO columns_before FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace=auth_namespace;
 SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) INTO triggers_before FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace=auth_namespace;
 SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) INTO roles_before FROM pg_roles r;
 SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member,m.grantor),'[]'::jsonb) INTO members_before FROM pg_auth_members m;
 IF legacy_select THEN
  REVOKE SELECT ON TABLE auth.users FROM gridex_ediel_retention_owner GRANTED BY postgres RESTRICT;
 END IF;
 IF(SELECT array_agg(a::text ORDER BY a::text COLLATE "C") FROM pg_class c CROSS JOIN LATERAL unnest(c.relacl) a WHERE c.oid=auth_users)
   IS DISTINCT FROM(SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(users_acl) a)
  OR has_schema_privilege('gridex_ediel_retention_owner','auth','USAGE') IS DISTINCT FROM false
  OR has_table_privilege('gridex_ediel_retention_owner','auth.users','SELECT') IS DISTINCT FROM false
  OR has_table_privilege('gridex_ediel_retention_owner','auth.users','UPDATE') IS DISTINCT FROM false
  OR(SELECT to_jsonb(n) FROM pg_namespace n WHERE oid=auth_namespace) IS DISTINCT FROM namespace_before
  OR(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace=auth_namespace) IS DISTINCT FROM functions_before
  OR(SELECT jsonb_agg(CASE WHEN c.oid=auth_users THEN to_jsonb(c)-'relacl' ELSE to_jsonb(c) END ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace=auth_namespace) IS DISTINCT FROM classes_before
  OR(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace=auth_namespace) IS DISTINCT FROM columns_before
  OR(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace=auth_namespace) IS DISTINCT FROM triggers_before
  OR(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_roles r) IS DISTINCT FROM roles_before
  OR(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member,m.grantor),'[]'::jsonb) FROM pg_auth_members m) IS DISTINCT FROM members_before
  THEN RAISE EXCEPTION 'ops_auth_self_select_exact_native_postprofile_or_protected_metadata_changed';END IF;
END
$ops_auth_self_select_convergence$;
-- Tighten only the exact historical postgres self-edge after inherited source DDL is complete.
DO $ops_retention_own_inherit_convergence$
DECLARE
 retention_role oid:=to_regrole('gridex_ediel_retention_owner');
 postgres_role oid:=to_regrole('postgres');
 own_edge oid;membership_profile jsonb;legacy_inherit boolean:=false;
 roles_before jsonb;members_expected jsonb;namespaces_before jsonb;
 auth_classes_before jsonb;auth_functions_before jsonb;auth_columns_before jsonb;auth_triggers_before jsonb;
BEGIN
 IF current_user IS DISTINCT FROM 'postgres' OR session_user IS DISTINCT FROM 'postgres'
  OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
  OR retention_role IS NULL OR postgres_role IS NULL
  OR NOT EXISTS(SELECT FROM pg_roles WHERE oid=postgres_role AND NOT rolsuper AND rolinherit AND rolbypassrls)
  OR NOT EXISTS(SELECT FROM pg_roles WHERE oid=retention_role AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls)
  OR EXISTS(SELECT FROM pg_auth_members WHERE roleid=retention_role AND member IS DISTINCT FROM postgres_role)
  OR has_schema_privilege('gridex_ediel_retention_owner','auth','USAGE') IS DISTINCT FROM false
  OR has_table_privilege('gridex_ediel_retention_owner','auth.users','SELECT') IS DISTINCT FROM false
  OR has_table_privilege('gridex_ediel_retention_owner','auth.users','UPDATE') IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'ops_retention_own_inherit_qualified_existing_roles_required';END IF;
 SELECT jsonb_agg(jsonb_build_array(g.rolname,m.admin_option,m.inherit_option,m.set_option) ORDER BY g.rolname COLLATE "C") INTO membership_profile
 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor WHERE m.roleid=retention_role AND m.member=postgres_role;
 IF membership_profile IS NOT DISTINCT FROM '[["postgres",false,false,true],["supabase_admin",true,false,false]]'::jsonb THEN
  IF pg_has_role(postgres_role,retention_role,'USAGE') IS DISTINCT FROM false THEN RAISE EXCEPTION 'ops_retention_own_inherit_unknown_native_usage';END IF;
 ELSIF membership_profile IS NOT DISTINCT FROM '[["postgres",false,true,true],["supabase_admin",true,false,false]]'::jsonb THEN
  IF pg_has_role(postgres_role,retention_role,'USAGE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'ops_retention_own_inherit_unknown_legacy_usage';END IF;
  legacy_inherit:=true;
 ELSE RAISE EXCEPTION 'ops_retention_own_inherit_unknown_membership_profile';END IF;
 IF pg_has_role(postgres_role,retention_role,'MEMBER') IS DISTINCT FROM true
  OR pg_has_role(postgres_role,retention_role,'SET') IS DISTINCT FROM true
  OR NOT EXISTS(SELECT FROM pg_auth_members WHERE roleid=retention_role AND member=postgres_role AND grantor='supabase_admin'::regrole AND admin_option AND NOT inherit_option AND NOT set_option)
  THEN RAISE EXCEPTION 'ops_retention_own_inherit_existing_administration_required';END IF;
 SELECT oid INTO STRICT own_edge FROM pg_auth_members WHERE roleid=retention_role AND member=postgres_role AND grantor=postgres_role AND NOT admin_option AND set_option;
 SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) INTO roles_before FROM pg_roles r;
 SELECT jsonb_agg(CASE WHEN m.oid=own_edge THEN jsonb_set(to_jsonb(m),'{inherit_option}','false'::jsonb) ELSE to_jsonb(m) END ORDER BY m.oid) INTO members_expected FROM pg_auth_members m;
 SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) INTO namespaces_before FROM pg_namespace n;
 SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) INTO auth_classes_before FROM pg_class c WHERE c.relnamespace='auth'::regnamespace;
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) INTO auth_functions_before FROM pg_proc p WHERE p.pronamespace='auth'::regnamespace;
 SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) INTO auth_columns_before FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='auth'::regnamespace;
 SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) INTO auth_triggers_before FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='auth'::regnamespace;
 IF legacy_inherit THEN
  GRANT gridex_ediel_retention_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
 END IF;
 IF(SELECT jsonb_agg(jsonb_build_array(g.rolname,m.admin_option,m.inherit_option,m.set_option) ORDER BY g.rolname COLLATE "C") FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor WHERE m.roleid=retention_role AND m.member=postgres_role)
   IS DISTINCT FROM '[["postgres",false,false,true],["supabase_admin",true,false,false]]'::jsonb
  OR pg_has_role(postgres_role,retention_role,'USAGE') IS DISTINCT FROM false
  OR pg_has_role(postgres_role,retention_role,'MEMBER') IS DISTINCT FROM true
  OR pg_has_role(postgres_role,retention_role,'SET') IS DISTINCT FROM true
  OR(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m) IS DISTINCT FROM members_expected
  OR(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_roles r) IS DISTINCT FROM roles_before
  OR(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n) IS DISTINCT FROM namespaces_before
  OR(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace='auth'::regnamespace) IS DISTINCT FROM auth_classes_before
  OR(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace='auth'::regnamespace) IS DISTINCT FROM auth_functions_before
  OR(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='auth'::regnamespace) IS DISTINCT FROM auth_columns_before
  OR(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='auth'::regnamespace) IS DISTINCT FROM auth_triggers_before
  THEN RAISE EXCEPTION 'ops_retention_own_inherit_exact_postprofile_or_protected_state_changed';END IF;
END
$ops_retention_own_inherit_convergence$;
DO $ops_compact_apply$
DECLARE raw bytea; executable bytea;
 signing_public oid; signing_core oid; signing_public_before pg_catalog.pg_proc%rowtype; signing_public_after pg_catalog.pg_proc%rowtype;
 signing_core_before pg_catalog.pg_proc%rowtype; signing_core_during pg_catalog.pg_proc%rowtype; signing_core_after pg_catalog.pg_proc%rowtype;
 signing_current pg_catalog.pg_proc%rowtype; signing_profile text; signing_expected_acl aclitem[]; signing_expected_config text[];
 signing_public_definition text; signing_core_definition text; signing_current_definition text; signing_source52 bytea;
 extra_config constant jsonb:=$extra_signing_config$[{"public":"public.gridex_get_customer_contract_signature_receipt_v1(text)","core":"public.gridex_get_signature_before_record_retention_v1(text)","kind":"receipt","old":"\ndeclare\n  v_request public.customer_contract_signature_requests%rowtype;\n  v_contract public.customer_contracts%rowtype;\n  v_customer public.customers%rowtype;\n  v_company public.companies%rowtype;\n  v_price public.contract_price_snapshots%rowtype;\n  v_legal_versions jsonb;\nbegin\n  select * into v_request from public.customer_contract_signature_requests where token_hash=p_token_hash;\n  if not found then raise exception using errcode='P0002',message='signature_link_not_found'; end if;\n  if v_request.revoked_at is not null then raise exception using errcode='55000',message='signature_link_revoked'; end if;\n  if v_request.used_at is null and v_request.expires_at<=now() then raise exception using errcode='55000',message='signature_link_expired'; end if;\n  select * into v_contract from public.customer_contracts where id=v_request.customer_contract_id and company_id=v_request.company_id;\n  select * into v_customer from public.customers where id=v_request.customer_id and company_id=v_request.company_id;\n  select * into v_company from public.companies where id=v_request.company_id;\n  select * into v_price from public.contract_price_snapshots where id=v_contract.contract_price_snapshot_id and company_id=v_request.company_id;\n  select coalesce(jsonb_agg(jsonb_build_object(\n    'id',d.id,'module_key',d.module_key,'title',d.title,\n    'version',coalesce(d.template_version,left(d.content_sha256,12)),\n    'document_sha256',d.content_sha256,'body',d.rendered_body\n  ) order by d.sort_order,d.id),'[]'::jsonb)\n  into v_legal_versions\n  from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id;\n  return jsonb_build_object(\n    'request_id',v_request.id,'company_id',v_request.company_id,'customer_id',v_request.customer_id,\n    'contract_id',v_contract.id,'contract_number',v_contract.contract_number,'contract_name',v_contract.contract_name,\n    'contract_type',v_contract.contract_type,'status',v_contract.status,'signed_at',v_contract.signed_at,\n    'used_at',v_request.used_at,'expires_at',v_request.expires_at,'channel',v_request.channel,\n    'customer_name',coalesce(v_customer.full_name,v_customer.company_name,concat_ws(' ',v_customer.first_name,v_customer.last_name),v_customer.email),\n    'customer_email',v_customer.email,'customer_number',coalesce(v_contract.customer_number,v_customer.customer_number),\n    'company_name',v_company.name,'offer_reference',v_contract.offer_reference,\n    'starts_at',v_contract.starts_at,'ends_at',v_contract.ends_at,'price_area',coalesce(v_contract.price_area_used,v_price.snapshot_json->>'price_area'),\n    'pricing_snapshot',v_price.snapshot_json,'pricing_snapshot_sha256',v_price.snapshot_hash,\n    'legal_versions',v_legal_versions,'legal_bundle_version_id',v_contract.legal_bundle_version_id,\n    'contract_publication_version_id',v_contract.contract_publication_version_id,'price_plan_version_id',v_contract.price_plan_version_id,\n    'signature_snapshot_sha256',v_contract.signature_snapshot_sha256\n  );\nend\n","canonical":"\ndeclare\n  v_request public.customer_contract_signature_requests%rowtype;\n  v_contract public.customer_contracts%rowtype;\n  v_customer public.customers%rowtype;\n  v_company public.companies%rowtype;\n  v_price public.contract_price_snapshots%rowtype;\n  v_legal_versions jsonb;\nbegin\n  select * into v_request from public.customer_contract_signature_requests where token_hash=p_token_hash;\n  if not found then raise exception using errcode='P0002',message='signature_link_not_found'; end if;\n  if v_request.revoked_at is not null then raise exception using errcode='55000',message='signature_link_revoked'; end if;\n  if v_request.used_at is null and v_request.expires_at<=clock_timestamp() then raise exception using errcode='55000',message='signature_link_expired'; end if;\n  select * into v_contract from public.customer_contracts where id=v_request.customer_contract_id and company_id=v_request.company_id;\n  select * into v_customer from public.customers where id=v_request.customer_id and company_id=v_request.company_id;\n  select * into v_company from public.companies where id=v_request.company_id;\n  select * into v_price from public.contract_price_snapshots where id=v_contract.contract_price_snapshot_id and company_id=v_request.company_id;\n  select coalesce(jsonb_agg(jsonb_build_object(\n    'id',d.id,'module_key',d.module_key,'title',d.title,\n    'version',coalesce(d.template_version,left(d.content_sha256,12)),\n    'document_sha256',d.content_sha256,'body',d.rendered_body\n  ) order by d.sort_order,d.id),'[]'::jsonb)\n  into v_legal_versions\n  from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id;\n  return jsonb_build_object(\n    'request_id',v_request.id,'company_id',v_request.company_id,'customer_id',v_request.customer_id,\n    'contract_id',v_contract.id,'contract_number',v_contract.contract_number,'contract_name',v_contract.contract_name,\n    'contract_type',v_contract.contract_type,'status',v_contract.status,'signed_at',v_contract.signed_at,\n    'used_at',v_request.used_at,'expires_at',v_request.expires_at,'channel',v_request.channel,\n    'customer_name',coalesce(nullif(btrim(v_contract.signature_snapshot#>>'{customer_identity_snapshot,full_name}'),''),\n      nullif(btrim(v_request.metadata->>'customer_full_name'),''),\n      v_customer.full_name,v_customer.company_name,concat_ws(' ',v_customer.first_name,v_customer.last_name),v_customer.email),\n    'customer_email',coalesce(nullif(btrim(v_contract.signature_snapshot->>'recipient_email'),''),v_request.recipient_email,v_customer.email),'customer_number',coalesce(v_contract.customer_number,v_customer.customer_number),\n    'company_name',v_company.name,'offer_reference',v_contract.offer_reference,\n    'starts_at',v_contract.starts_at,'ends_at',v_contract.ends_at,'price_area',coalesce(v_contract.price_area_used,v_price.snapshot_json->>'price_area'),\n    'pricing_snapshot',v_price.snapshot_json,'pricing_snapshot_sha256',v_price.snapshot_hash,\n    'legal_versions',v_legal_versions,'legal_bundle_version_id',v_contract.legal_bundle_version_id,\n    'contract_publication_version_id',v_contract.contract_publication_version_id,'price_plan_version_id',v_contract.price_plan_version_id,\n    'signature_snapshot_sha256',v_contract.signature_snapshot_sha256\n  );\nend\n","native":"\ndeclare\n  v_request public.customer_contract_signature_requests%rowtype;\n  v_contract public.customer_contracts%rowtype;\n  v_customer public.customers%rowtype;\n  v_company public.companies%rowtype;\n  v_price public.contract_price_snapshots%rowtype;\n  v_legal_versions jsonb;\nbegin\n  select * into v_request from public.customer_contract_signature_requests where token_hash=p_token_hash;\n  if not found then raise exception using errcode='P0002',message='signature_link_not_found'; end if;\n  if v_request.revoked_at is not null then raise exception using errcode='55000',message='signature_link_revoked'; end if;\n  if v_request.used_at is null and v_request.expires_at<=clock_timestamp() then raise exception using errcode='55000',message='signature_link_expired'; end if;\n  select * into v_contract from public.customer_contracts where id=v_request.customer_contract_id and company_id=v_request.company_id;\n  select * into v_customer from public.customers where id=v_request.customer_id and company_id=v_request.company_id;\n  select * into v_company from public.companies where id=v_request.company_id;\n  select * into v_price from public.contract_price_snapshots where id=v_contract.contract_price_snapshot_id and company_id=v_request.company_id;\n  select coalesce(jsonb_agg(jsonb_build_object(\n    'id',d.id,'module_key',d.module_key,'title',d.title,\n    'version',coalesce(d.template_version,left(d.content_sha256,12)),\n    'document_sha256',d.content_sha256,'body',d.rendered_body\n  ) order by d.sort_order,d.id),'[]'::jsonb)\n  into v_legal_versions\n  from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id;\n  return jsonb_build_object(\n    'request_id',v_request.id,'company_id',v_request.company_id,'customer_id',v_request.customer_id,\n    'contract_id',v_contract.id,'contract_number',v_contract.contract_number,'contract_name',v_contract.contract_name,\n    'contract_type',v_contract.contract_type,'status',v_contract.status,'signed_at',v_contract.signed_at,\n    'used_at',v_request.used_at,'expires_at',v_request.expires_at,'channel',v_request.channel,\n    'customer_name',coalesce(nullif(btrim(v_contract.signature_snapshot#>>'{customer_identity_snapshot,full_name}'),''),\n      nullif(btrim(v_request.metadata->>'customer_full_name'),''),\n      v_customer.full_name,v_customer.company_name,concat_ws(' ',v_customer.first_name,v_customer.last_name),v_customer.email),\n    'customer_email',coalesce(nullif(btrim(v_contract.signature_snapshot->>'recipient_email'),''),v_request.recipient_email,v_customer.email),'customer_number',coalesce(v_contract.customer_number,v_customer.customer_number),\n    'company_name',v_company.name,'offer_reference',v_contract.offer_reference,\n    'starts_at',v_contract.starts_at,'ends_at',v_contract.ends_at,'price_area',coalesce(v_contract.price_area_used,v_price.snapshot_json->>'price_area'),\n    'pricing_snapshot',v_price.snapshot_json,'pricing_snapshot_sha256',v_price.snapshot_hash,\n    'legal_versions',v_legal_versions,'legal_bundle_version_id',v_contract.legal_bundle_version_id,\n    'contract_publication_version_id',v_contract.contract_publication_version_id,'price_plan_version_id',v_contract.price_plan_version_id,\n    'signature_snapshot_sha256',v_contract.signature_snapshot_sha256\n  );\nend\n","wrapper":"DECLARE r public.customer_contract_signature_requests%rowtype;BEGIN\n SELECT * INTO STRICT r FROM public.customer_contract_signature_requests WHERE token_hash=p_token_hash FOR SHARE;\n PERFORM public.ediel_require_contract_records_available_v1(r.company_id,r.customer_contract_id);\n RETURN public.gridex_get_signature_before_record_retention_v1(p_token_hash);\nEND","old_md5":"d960224f357b26db4c52e01c9a62515d","canonical_md5":"620d2a202a7fe821b0f6f0b4cd90306c","native_md5":"620d2a202a7fe821b0f6f0b4cd90306c","wrapper_md5":"42954602085248931a986f08459a4288"},{"public":"public.gridex_finalize_customer_contract_signature_v1(text,text,text)","core":"public.gridex_finalize_signature_before_record_retention_v1(text,text,text)","kind":"finalize","old":"\ndeclare\n  v_request public.customer_contract_signature_requests%rowtype;\n  v_contract public.customer_contracts%rowtype;\n  v_customer public.customers%rowtype;\n  v_company public.companies%rowtype;\n  v_price public.contract_price_snapshots%rowtype;\n  v_legal_versions jsonb;\n  v_signature jsonb;\n  v_signature_hash text;\n  v_acceptance jsonb;\n  v_acceptance_hash text;\n  v_customer_type text;\n  v_withdrawal_required boolean;\n  v_withdrawal_deadline timestamptz;\n  v_event jsonb;\nbegin\n  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='signature_token_invalid'; end if;\n  select * into v_request from public.customer_contract_signature_requests where token_hash=p_token_hash for update;\n  if not found then raise exception using errcode='P0002',message='signature_link_not_found'; end if;\n  select * into v_contract from public.customer_contracts where id=v_request.customer_contract_id and company_id=v_request.company_id for update;\n  if v_request.used_at is not null then\n    if v_contract.status in ('signed','active','terminated','cancelled','expired') and v_contract.signed_at is not null then\n      return public.gridex_get_customer_contract_signature_receipt_v1(p_token_hash) || jsonb_build_object('already_signed',true);\n    end if;\n    raise exception using errcode='55000',message='signature_link_already_used';\n  end if;\n  if v_request.revoked_at is not null then raise exception using errcode='55000',message='signature_link_revoked'; end if;\n  if v_request.expires_at<=now() then raise exception using errcode='55000',message='signature_link_expired'; end if;\n  select * into v_company from public.companies where id=v_request.company_id for share;\n  if not found or not coalesce(v_company.is_active,false) or coalesce(v_company.lifecycle_status,'')<>'active' or v_company.suspended_at is not null then\n    raise exception using errcode='55000',message='signature_tenant_not_operational';\n  end if;\n  if v_contract.status<>'pending_signature' or v_contract.signed_at is not null then\n    raise exception using errcode='23514',message='contract_not_pending_signature';\n  end if;\n  select * into v_customer from public.customers where id=v_contract.customer_id and company_id=v_contract.company_id;\n  select * into v_price from public.contract_price_snapshots where id=v_contract.contract_price_snapshot_id and company_id=v_contract.company_id and contract_id=v_contract.id;\n  if not found or nullif(v_price.snapshot_hash,'') is null then raise exception using errcode='23514',message='signature_pricing_snapshot_missing'; end if;\n\n  if not exists(\n    select 1 from public.contract_publication_versions cpv\n    join public.contract_publications cp on cp.id=cpv.contract_publication_id\n    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id and ta.company_id=v_contract.company_id\n    join public.contract_product_versions ctv on ctv.id=cpv.contract_product_version_id\n    join public.price_plan_versions ppv on ppv.id=cpv.price_plan_version_id\n    join public.legal_bundle_versions lbv on lbv.id=cpv.legal_bundle_version_id\n    where cpv.id=v_contract.contract_publication_version_id\n      and cpv.contract_product_version_id=v_contract.contract_product_version_id\n      and cpv.price_plan_version_id=v_contract.price_plan_version_id\n      and cpv.legal_bundle_version_id=v_contract.legal_bundle_version_id\n      and cpv.status='published' and cpv.locked_at is not null\n      and ctv.status='approved' and ctv.locked_at is not null\n      and ppv.status in ('published','approved','active') and ppv.locked_at is not null\n      and lbv.status='published' and lbv.locked_at is not null and cardinality(lbv.unresolved_variables)=0\n  ) then raise exception using errcode='23514',message='signature_exact_locked_chain_invalid'; end if;\n\n  select coalesce(jsonb_agg(jsonb_build_object(\n    'legal_bundle_version_document_id',d.id,'module_key',d.module_key,'title',d.title,\n    'legal_document_version',coalesce(d.template_version,left(d.content_sha256,12)),\n    'document_sha256',d.content_sha256,'body_sha256',d.content_sha256\n  ) order by d.sort_order,d.id),'[]'::jsonb)\n  into v_legal_versions from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id;\n  if jsonb_array_length(v_legal_versions)=0 then raise exception using errcode='23514',message='signature_legal_document_set_missing'; end if;\n\n  v_signature:=jsonb_build_object(\n    'schema','gridex_online_contract_signature_v1','company_id',v_contract.company_id,'customer_id',v_contract.customer_id,\n    'contract_id',v_contract.id,'signature_request_id',v_request.id,'channel',v_request.channel,'accepted_at',now(),\n    'recipient_email',v_request.recipient_email,'contract_number',v_contract.contract_number,'offer_reference',v_contract.offer_reference,\n    'contract_publication_version_id',v_contract.contract_publication_version_id,'contract_product_version_id',v_contract.contract_product_version_id,\n    'price_plan_version_id',v_contract.price_plan_version_id,'legal_bundle_version_id',v_contract.legal_bundle_version_id,\n    'contract_price_snapshot_id',v_contract.contract_price_snapshot_id,'pricing_snapshot_sha256',v_price.snapshot_hash,\n    'legal_versions',v_legal_versions,'tenant_communication_snapshot_sha256',v_contract.tenant_communication_snapshot_sha256,\n    'request_evidence',jsonb_build_object('ip_hash',p_signed_ip_hash,'user_agent',left(p_signed_user_agent,1000))\n  );\n  v_signature_hash:=encode(extensions.digest(convert_to(v_signature::text,'UTF8'),'sha256'),'hex');\n  v_acceptance:=jsonb_build_object(\n    'schema','gridex_contract_acceptance_v1','signature_request_id',v_request.id,'contract_id',v_contract.id,\n    'accepted_at',v_signature->>'accepted_at','channel',v_request.channel,'signing_method','secure_link_click',\n    'signature_snapshot_sha256',v_signature_hash,'pricing_snapshot_sha256',v_price.snapshot_hash,'legal_versions',v_legal_versions\n  );\n  v_acceptance_hash:=encode(extensions.digest(convert_to(v_acceptance::text,'UTF8'),'sha256'),'hex');\n\n  insert into public.customer_legal_acceptances(\n    company_id,customer_id,contract_id,acceptance_type,legal_text_version_id,\n    legal_bundle_version_document_id,legal_module_key,legal_document_version,legal_document_sha256,\n    accepted_at,accepted_ip_hash,accepted_user_agent,source,snapshot,metadata\n  )\n  select v_contract.company_id,v_contract.customer_id,v_contract.id,\n    case public.gridex_legacy_legal_type_for_module(d.module_key)\n      when 'privacy_policy' then 'privacy_policy' when 'withdrawal' then 'withdrawal_info'\n      when 'power_of_attorney' then 'power_of_attorney' when 'price_terms' then 'price_snapshot' else 'terms' end,\n    null,d.id,d.module_key,coalesce(d.template_version,left(d.content_sha256,12)),d.content_sha256,\n    (v_signature->>'accepted_at')::timestamptz,p_signed_ip_hash,left(p_signed_user_agent,1000),'customer_portal',\n    jsonb_build_object('signature_request_id',v_request.id,'signature_snapshot_sha256',v_signature_hash),\n    jsonb_build_object('channel',v_request.channel,'pricing_snapshot_sha256',v_price.snapshot_hash)\n  from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id\n  on conflict do nothing;\n\n  insert into public.customer_contract_acceptances(\n    company_id,customer_contract_id,contract_publication_version_id,accepted_at,channel,signing_method,\n    ip_hash,user_agent,customer_identity_snapshot,power_of_attorney_snapshot,acceptance_snapshot,acceptance_sha256\n  ) values(\n    v_contract.company_id,v_contract.id,v_contract.contract_publication_version_id,(v_signature->>'accepted_at')::timestamptz,\n    v_request.channel,'secure_link_click',p_signed_ip_hash,left(p_signed_user_agent,1000),\n    jsonb_strip_nulls(jsonb_build_object('customer_id',v_customer.id,'customer_number',coalesce(v_contract.customer_number,v_customer.customer_number),'email',v_customer.email,'customer_type',v_customer.customer_type)),\n    '{}',v_acceptance,v_acceptance_hash\n  ) on conflict (customer_contract_id,acceptance_sha256) do nothing;\n\n  insert into public.customer_contract_evidence(company_id,customer_contract_id,evidence_type,evidence_snapshot,evidence_sha256,captured_at)\n  values(v_contract.company_id,v_contract.id,'online_acceptance',v_signature,v_signature_hash,(v_signature->>'accepted_at')::timestamptz)\n  on conflict (customer_contract_id,evidence_type,evidence_sha256) do nothing;\n\n  select coalesce(v_customer.customer_type,'private') into v_customer_type;\n  select exists(select 1 from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id and d.module_key in ('withdrawal','withdrawal_right','withdrawal_form','distance_contract_information','pre_contract_information')) into v_withdrawal_required;\n  v_withdrawal_deadline:=case when v_customer_type='private' and v_withdrawal_required then (v_signature->>'accepted_at')::timestamptz+interval '14 days' else null end;\n\n  update public.customer_contracts set\n    status='signed',signed_at=(v_signature->>'accepted_at')::timestamptz,\n    snapshot_hash=v_price.snapshot_hash,\n    is_distance_agreement=true,withdrawal_deadline_at=v_withdrawal_deadline,\n    legal_versions_snapshot=v_legal_versions,signature_snapshot=v_signature,signature_snapshot_sha256=v_signature_hash,\n    signed_ip_hash=p_signed_ip_hash,signed_user_agent=left(p_signed_user_agent,1000),locked_at=(v_signature->>'accepted_at')::timestamptz,\n    lifecycle_stage='agreement_signed',signed_version=coalesce(terms_version,contract_version,'v1'),terms_signed_version=coalesce(terms_version,'v1'),\n    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('signature_status','signed','signature_method','secure_link_click','signature_request_id',v_request.id,'signature_snapshot_sha256',v_signature_hash,'pricing_snapshot_sha256',v_price.snapshot_hash),\n    updated_at=now()\n  where id=v_contract.id and company_id=v_contract.company_id\n  returning * into v_contract;\n\n  update public.customer_contract_signature_requests set used_at=(v_signature->>'accepted_at')::timestamptz where id=v_request.id;\n\n  v_event:=public.gridex_record_customer_contract_event_v1(\n    v_contract.company_id,v_contract.id,v_contract.customer_id,'signed',(v_signature->>'accepted_at')::timestamptz,\n    'Avtal signerat online via s\u00e4ker eng\u00e5ngsl\u00e4nk',\n    jsonb_build_object('signature_request_id',v_request.id,'signature_snapshot_sha256',v_signature_hash,'pricing_snapshot_sha256',v_price.snapshot_hash,'channel',v_request.channel),\n    null,null,\n    encode(extensions.digest(convert_to((v_request.id::text||':signed'),'UTF8'),'sha256'),'hex')\n  );\n\n  return public.gridex_get_customer_contract_signature_receipt_v1(p_token_hash) || jsonb_build_object('already_signed',false,'withdrawal_deadline_at',v_withdrawal_deadline);\nend\n","canonical":"\ndeclare\n  v_request public.customer_contract_signature_requests%rowtype;\n  v_contract public.customer_contracts%rowtype;\n  v_customer public.customers%rowtype;\n  v_company public.companies%rowtype;\n  v_price public.contract_price_snapshots%rowtype;\n  v_legal_versions jsonb;\n  v_signature jsonb;\n  v_signature_hash text;\n  v_accepted_at timestamptz;\n  v_acceptance jsonb;\n  v_acceptance_hash text;\n  v_customer_type text;\n  v_withdrawal_required boolean;\n  v_withdrawal_deadline timestamptz;\n  v_event jsonb;\nbegin\n  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='signature_token_invalid'; end if;\n  select * into v_request from public.customer_contract_signature_requests where token_hash=p_token_hash for update;\n  if not found then raise exception using errcode='P0002',message='signature_link_not_found'; end if;\n  select * into v_contract from public.customer_contracts where id=v_request.customer_contract_id and company_id=v_request.company_id for update;\n  if v_request.used_at is not null then\n    if v_contract.status in ('signed','active','terminated','cancelled','expired') and v_contract.signed_at is not null then\n      return public.gridex_get_customer_contract_signature_receipt_v1(p_token_hash) || jsonb_build_object('already_signed',true);\n    end if;\n    raise exception using errcode='55000',message='signature_link_already_used';\n  end if;\n  if v_request.revoked_at is not null then raise exception using errcode='55000',message='signature_link_revoked'; end if;\n  if v_request.expires_at<=clock_timestamp() then raise exception using errcode='55000',message='signature_link_expired'; end if;\n  select * into v_company from public.companies where id=v_request.company_id for share;\n  if not found or not coalesce(v_company.is_active,false) or coalesce(v_company.lifecycle_status,'')<>'active' or v_company.suspended_at is not null then\n    raise exception using errcode='55000',message='signature_tenant_not_operational';\n  end if;\n  if v_contract.status<>'pending_signature' or v_contract.signed_at is not null then\n    raise exception using errcode='23514',message='contract_not_pending_signature';\n  end if;\n  select * into v_customer from public.customers where id=v_contract.customer_id and company_id=v_contract.company_id;\n  select * into v_price from public.contract_price_snapshots where id=v_contract.contract_price_snapshot_id and company_id=v_contract.company_id and contract_id=v_contract.id;\n  if not found or nullif(v_price.snapshot_hash,'') is null then raise exception using errcode='23514',message='signature_pricing_snapshot_missing'; end if;\n\n  if not exists(\n    select 1 from public.contract_publication_versions cpv\n    join public.contract_publications cp on cp.id=cpv.contract_publication_id\n    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id and ta.company_id=v_contract.company_id\n    join public.contract_product_versions ctv on ctv.id=cpv.contract_product_version_id\n    join public.price_plan_versions ppv on ppv.id=cpv.price_plan_version_id\n    join public.legal_bundle_versions lbv on lbv.id=cpv.legal_bundle_version_id\n    where cpv.id=v_contract.contract_publication_version_id\n      and cpv.contract_product_version_id=v_contract.contract_product_version_id\n      and cpv.price_plan_version_id=v_contract.price_plan_version_id\n      and cpv.legal_bundle_version_id=v_contract.legal_bundle_version_id\n      and cpv.status='published' and cpv.locked_at is not null\n      and ctv.status='approved' and ctv.locked_at is not null\n      and ppv.status in ('published','approved','active') and ppv.locked_at is not null\n      and lbv.status='published' and lbv.locked_at is not null and cardinality(lbv.unresolved_variables)=0\n  ) then raise exception using errcode='23514',message='signature_exact_locked_chain_invalid'; end if;\n\n  select coalesce(jsonb_agg(jsonb_build_object(\n    'legal_bundle_version_document_id',d.id,'module_key',d.module_key,'title',d.title,\n    'legal_document_version',coalesce(d.template_version,left(d.content_sha256,12)),\n    'document_sha256',d.content_sha256,'body_sha256',d.content_sha256\n  ) order by d.sort_order,d.id),'[]'::jsonb)\n  into v_legal_versions from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id;\n  if jsonb_array_length(v_legal_versions)=0 then raise exception using errcode='23514',message='signature_legal_document_set_missing'; end if;\n\n  -- Capture one actual acceptance instant after all blocking locks and validations.\n  -- Reuse it for the signature, acceptance/evidence, signed/used timestamps and event.\n  v_accepted_at:=clock_timestamp();\n  if v_request.expires_at<=v_accepted_at then\n    raise exception using errcode='55000',message='signature_link_expired';\n  end if;\n\n  v_signature:=jsonb_build_object(\n    'schema','gridex_online_contract_signature_v1','company_id',v_contract.company_id,'customer_id',v_contract.customer_id,\n    'contract_id',v_contract.id,'signature_request_id',v_request.id,'channel',v_request.channel,'accepted_at',v_accepted_at,\n    'recipient_email',v_request.recipient_email,'contract_number',v_contract.contract_number,'offer_reference',v_contract.offer_reference,\n    'contract_publication_version_id',v_contract.contract_publication_version_id,'contract_product_version_id',v_contract.contract_product_version_id,\n    'price_plan_version_id',v_contract.price_plan_version_id,'legal_bundle_version_id',v_contract.legal_bundle_version_id,\n    'contract_price_snapshot_id',v_contract.contract_price_snapshot_id,'pricing_snapshot_sha256',v_price.snapshot_hash,\n    'legal_versions',v_legal_versions,'tenant_communication_snapshot_sha256',v_contract.tenant_communication_snapshot_sha256,\n    'customer_identity_snapshot',jsonb_strip_nulls(jsonb_build_object(\n      'customer_id',v_customer.id,'customer_number',coalesce(v_contract.customer_number,v_customer.customer_number),\n      'email',v_customer.email,'customer_type',v_customer.customer_type,\n      'full_name',coalesce(nullif(btrim(v_request.metadata->>'customer_full_name'),''),\n        nullif(btrim(v_customer.full_name),''),nullif(btrim(v_customer.company_name),''),\n        nullif(btrim(concat_ws(' ',v_customer.first_name,v_customer.last_name)),''))\n    )),\n    'request_evidence',jsonb_build_object('ip_hash',p_signed_ip_hash,'user_agent',left(p_signed_user_agent,1000))\n  );\n  v_signature_hash:=encode(extensions.digest(convert_to(v_signature::text,'UTF8'),'sha256'),'hex');\n  v_acceptance:=jsonb_build_object(\n    'schema','gridex_contract_acceptance_v1','signature_request_id',v_request.id,'contract_id',v_contract.id,\n    'accepted_at',v_signature->>'accepted_at','channel',v_request.channel,'signing_method','secure_link_click',\n    'signature_snapshot_sha256',v_signature_hash,'pricing_snapshot_sha256',v_price.snapshot_hash,'legal_versions',v_legal_versions\n  );\n  v_acceptance_hash:=encode(extensions.digest(convert_to(v_acceptance::text,'UTF8'),'sha256'),'hex');\n\n  insert into public.customer_legal_acceptances(\n    company_id,customer_id,contract_id,acceptance_type,legal_text_version_id,\n    legal_bundle_version_document_id,legal_module_key,legal_document_version,legal_document_sha256,\n    accepted_at,accepted_ip_hash,accepted_user_agent,source,snapshot,metadata\n  )\n  select v_contract.company_id,v_contract.customer_id,v_contract.id,\n    case public.gridex_legacy_legal_type_for_module(d.module_key)\n      when 'privacy_policy' then 'privacy_policy' when 'withdrawal' then 'withdrawal_info'\n      when 'power_of_attorney' then 'power_of_attorney' when 'price_terms' then 'price_snapshot' else 'terms' end,\n    null,d.id,d.module_key,coalesce(d.template_version,left(d.content_sha256,12)),d.content_sha256,\n    (v_signature->>'accepted_at')::timestamptz,p_signed_ip_hash,left(p_signed_user_agent,1000),'customer_portal',\n    jsonb_build_object('signature_request_id',v_request.id,'signature_snapshot_sha256',v_signature_hash),\n    jsonb_build_object('channel',v_request.channel,'pricing_snapshot_sha256',v_price.snapshot_hash)\n  from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id\n  on conflict do nothing;\n\n  insert into public.customer_contract_acceptances(\n    company_id,customer_contract_id,contract_publication_version_id,accepted_at,channel,signing_method,\n    ip_hash,user_agent,customer_identity_snapshot,power_of_attorney_snapshot,acceptance_snapshot,acceptance_sha256\n  ) values(\n    v_contract.company_id,v_contract.id,v_contract.contract_publication_version_id,(v_signature->>'accepted_at')::timestamptz,\n    v_request.channel,'secure_link_click',p_signed_ip_hash,left(p_signed_user_agent,1000),\n    v_signature->'customer_identity_snapshot',\n    '{}',v_acceptance,v_acceptance_hash\n  ) on conflict (customer_contract_id,acceptance_sha256) do nothing;\n\n  insert into public.customer_contract_evidence(company_id,customer_contract_id,evidence_type,evidence_snapshot,evidence_sha256,captured_at)\n  values(v_contract.company_id,v_contract.id,'online_acceptance',v_signature,v_signature_hash,(v_signature->>'accepted_at')::timestamptz)\n  on conflict (customer_contract_id,evidence_type,evidence_sha256) do nothing;\n\n  select coalesce(v_customer.customer_type,'private') into v_customer_type;\n  select exists(select 1 from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id and d.module_key in ('withdrawal','withdrawal_right','withdrawal_form','distance_contract_information','pre_contract_information')) into v_withdrawal_required;\n  v_withdrawal_deadline:=case when v_customer_type='private' and v_withdrawal_required then ((((v_signature->>'accepted_at')::timestamptz AT TIME ZONE 'Europe/Stockholm')::date+15)::timestamp AT TIME ZONE 'Europe/Stockholm')-interval '1 microsecond' else null end;\n\n  update public.customer_contracts set\n    status='signed',signed_at=(v_signature->>'accepted_at')::timestamptz,\n    snapshot_hash=v_price.snapshot_hash,\n    is_distance_agreement=true,withdrawal_deadline_at=v_withdrawal_deadline,\n    legal_versions_snapshot=v_legal_versions,signature_snapshot=v_signature,signature_snapshot_sha256=v_signature_hash,\n    signed_ip_hash=p_signed_ip_hash,signed_user_agent=left(p_signed_user_agent,1000),locked_at=(v_signature->>'accepted_at')::timestamptz,\n    lifecycle_stage='agreement_signed',signed_version=coalesce(terms_version,contract_version,'v1'),terms_signed_version=coalesce(terms_version,'v1'),\n    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('signature_status','signed','signature_method','secure_link_click','signature_request_id',v_request.id,'signature_snapshot_sha256',v_signature_hash,'pricing_snapshot_sha256',v_price.snapshot_hash),\n    updated_at=now()\n  where id=v_contract.id and company_id=v_contract.company_id\n  returning * into v_contract;\n\n  update public.customer_contract_signature_requests set used_at=(v_signature->>'accepted_at')::timestamptz where id=v_request.id;\n\n  v_event:=public.gridex_record_customer_contract_event_v1(\n    v_contract.company_id,v_contract.id,v_contract.customer_id,'signed',(v_signature->>'accepted_at')::timestamptz,\n    'Avtal signerat online via s\u00e4ker eng\u00e5ngsl\u00e4nk',\n    jsonb_build_object('signature_request_id',v_request.id,'signature_snapshot_sha256',v_signature_hash,'pricing_snapshot_sha256',v_price.snapshot_hash,'channel',v_request.channel),\n    null,null,\n    encode(extensions.digest(convert_to((v_request.id::text||':signed'),'UTF8'),'sha256'),'hex')\n  );\n\n  return public.gridex_get_customer_contract_signature_receipt_v1(p_token_hash) || jsonb_build_object('already_signed',false,'withdrawal_deadline_at',v_withdrawal_deadline);\nend\n","native":"\ndeclare\n  v_request public.customer_contract_signature_requests%rowtype;\n  v_contract public.customer_contracts%rowtype;\n  v_customer public.customers%rowtype;\n  v_company public.companies%rowtype;\n  v_price public.contract_price_snapshots%rowtype;\n  v_legal_versions jsonb;\n  v_signature jsonb;\n  v_signature_hash text;\n  v_accepted_at timestamptz;\n  v_acceptance jsonb;\n  v_acceptance_hash text;\n  v_customer_type text;\n  v_withdrawal_required boolean;\n  v_withdrawal_deadline timestamptz;\n  v_event jsonb;\nbegin\n  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='signature_token_invalid'; end if;\n  select * into v_request from public.customer_contract_signature_requests where token_hash=p_token_hash for update;\n  if not found then raise exception using errcode='P0002',message='signature_link_not_found'; end if;\n  select * into v_contract from public.customer_contracts where id=v_request.customer_contract_id and company_id=v_request.company_id for update;\n  if v_request.used_at is not null then\n    if v_contract.status in ('signed','active','terminated','cancelled','expired') and v_contract.signed_at is not null then\n      return public.gridex_get_customer_contract_signature_receipt_v1(p_token_hash) || jsonb_build_object('already_signed',true);\n    end if;\n    raise exception using errcode='55000',message='signature_link_already_used';\n  end if;\n  if v_request.revoked_at is not null then raise exception using errcode='55000',message='signature_link_revoked'; end if;\n  if v_request.expires_at<=clock_timestamp() then raise exception using errcode='55000',message='signature_link_expired'; end if;\n  select * into v_company from public.companies where id=v_request.company_id for share;\n  if not found or not coalesce(v_company.is_active,false) or coalesce(v_company.lifecycle_status,'')<>'active' or v_company.suspended_at is not null then\n    raise exception using errcode='55000',message='signature_tenant_not_operational';\n  end if;\n  if v_contract.status<>'pending_signature' or v_contract.signed_at is not null then\n    raise exception using errcode='23514',message='contract_not_pending_signature';\n  end if;\n  select * into v_customer from public.customers where id=v_contract.customer_id and company_id=v_contract.company_id;\n  select * into v_price from public.contract_price_snapshots where id=v_contract.contract_price_snapshot_id and company_id=v_contract.company_id and contract_id=v_contract.id;\n  if not found or nullif(v_price.snapshot_hash,'') is null then raise exception using errcode='23514',message='signature_pricing_snapshot_missing'; end if;\n\n  if not exists(\n    select 1 from public.contract_publication_versions cpv\n    join public.contract_publications cp on cp.id=cpv.contract_publication_id\n    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id and ta.company_id=v_contract.company_id\n    join public.contract_product_versions ctv on ctv.id=cpv.contract_product_version_id\n    join public.price_plan_versions ppv on ppv.id=cpv.price_plan_version_id\n    join public.legal_bundle_versions lbv on lbv.id=cpv.legal_bundle_version_id\n    where cpv.id=v_contract.contract_publication_version_id\n      and cpv.contract_product_version_id=v_contract.contract_product_version_id\n      and cpv.price_plan_version_id=v_contract.price_plan_version_id\n      and cpv.legal_bundle_version_id=v_contract.legal_bundle_version_id\n      and cpv.status='published' and cpv.locked_at is not null\n      and ctv.status='approved' and ctv.locked_at is not null\n      and ppv.status in ('published','approved','active') and ppv.locked_at is not null\n      and lbv.status='published' and lbv.locked_at is not null and cardinality(lbv.unresolved_variables)=0\n  ) then raise exception using errcode='23514',message='signature_exact_locked_chain_invalid'; end if;\n\n  select coalesce(jsonb_agg(jsonb_build_object(\n    'legal_bundle_version_document_id',d.id,'module_key',d.module_key,'title',d.title,\n    'legal_document_version',coalesce(d.template_version,left(d.content_sha256,12)),\n    'document_sha256',d.content_sha256,'body_sha256',d.content_sha256\n  ) order by d.sort_order,d.id),'[]'::jsonb)\n  into v_legal_versions from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id;\n  if jsonb_array_length(v_legal_versions)=0 then raise exception using errcode='23514',message='signature_legal_document_set_missing'; end if;\n\n  -- Capture one actual acceptance instant after all blocking locks and validations.\n  -- Reuse it for the signature, acceptance/evidence, signed/used timestamps and event.\n  v_accepted_at:=clock_timestamp();\n  if v_request.expires_at<=v_accepted_at then\n    raise exception using errcode='55000',message='signature_link_expired';\n  end if;\n\n  v_signature:=jsonb_build_object(\n    'schema','gridex_online_contract_signature_v1','company_id',v_contract.company_id,'customer_id',v_contract.customer_id,\n    'contract_id',v_contract.id,'signature_request_id',v_request.id,'channel',v_request.channel,'accepted_at',v_accepted_at,\n    'recipient_email',v_request.recipient_email,'contract_number',v_contract.contract_number,'offer_reference',v_contract.offer_reference,\n    'contract_publication_version_id',v_contract.contract_publication_version_id,'contract_product_version_id',v_contract.contract_product_version_id,\n    'price_plan_version_id',v_contract.price_plan_version_id,'legal_bundle_version_id',v_contract.legal_bundle_version_id,\n    'contract_price_snapshot_id',v_contract.contract_price_snapshot_id,'pricing_snapshot_sha256',v_price.snapshot_hash,\n    'legal_versions',v_legal_versions,'tenant_communication_snapshot_sha256',v_contract.tenant_communication_snapshot_sha256,\n    'customer_identity_snapshot',jsonb_strip_nulls(jsonb_build_object(\n      'customer_id',v_customer.id,'customer_number',coalesce(v_contract.customer_number,v_customer.customer_number),\n      'email',v_customer.email,'customer_type',v_customer.customer_type,\n      'full_name',coalesce(nullif(btrim(v_request.metadata->>'customer_full_name'),''),\n        nullif(btrim(v_customer.full_name),''),nullif(btrim(v_customer.company_name),''),\n        nullif(btrim(concat_ws(' ',v_customer.first_name,v_customer.last_name)),''))\n    )),\n    'request_evidence',jsonb_build_object('ip_hash',p_signed_ip_hash,'user_agent',left(p_signed_user_agent,1000))\n  );\n  v_signature_hash:=encode(extensions.digest(convert_to(v_signature::text,'UTF8'),'sha256'),'hex');\n  v_acceptance:=jsonb_build_object(\n    'schema','gridex_contract_acceptance_v1','signature_request_id',v_request.id,'contract_id',v_contract.id,\n    'accepted_at',v_signature->>'accepted_at','channel',v_request.channel,'signing_method','secure_link_click',\n    'signature_snapshot_sha256',v_signature_hash,'pricing_snapshot_sha256',v_price.snapshot_hash,'legal_versions',v_legal_versions\n  );\n  v_acceptance_hash:=encode(extensions.digest(convert_to(v_acceptance::text,'UTF8'),'sha256'),'hex');\n\n  insert into public.customer_legal_acceptances(\n    company_id,customer_id,contract_id,acceptance_type,legal_text_version_id,\n    legal_bundle_version_document_id,legal_module_key,legal_document_version,legal_document_sha256,\n    accepted_at,accepted_ip_hash,accepted_user_agent,source,snapshot,metadata\n  )\n  select v_contract.company_id,v_contract.customer_id,v_contract.id,\n    case public.gridex_legacy_legal_type_for_module(d.module_key)\n      when 'privacy_policy' then 'privacy_policy' when 'withdrawal' then 'withdrawal_info'\n      when 'power_of_attorney' then 'power_of_attorney' when 'price_terms' then 'price_snapshot' else 'terms' end,\n    null,d.id,d.module_key,coalesce(d.template_version,left(d.content_sha256,12)),d.content_sha256,\n    (v_signature->>'accepted_at')::timestamptz,p_signed_ip_hash,left(p_signed_user_agent,1000),'customer_portal',\n    jsonb_build_object('signature_request_id',v_request.id,'signature_snapshot_sha256',v_signature_hash),\n    jsonb_build_object('channel',v_request.channel,'pricing_snapshot_sha256',v_price.snapshot_hash)\n  from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id\n  on conflict do nothing;\n\n  insert into public.customer_contract_acceptances(\n    company_id,customer_contract_id,contract_publication_version_id,accepted_at,channel,signing_method,\n    ip_hash,user_agent,customer_identity_snapshot,power_of_attorney_snapshot,acceptance_snapshot,acceptance_sha256\n  ) values(\n    v_contract.company_id,v_contract.id,v_contract.contract_publication_version_id,(v_signature->>'accepted_at')::timestamptz,\n    v_request.channel,'secure_link_click',p_signed_ip_hash,left(p_signed_user_agent,1000),\n    v_signature->'customer_identity_snapshot',\n    '{}',v_acceptance,v_acceptance_hash\n  ) on conflict (customer_contract_id,acceptance_sha256) do nothing;\n\n  insert into public.customer_contract_evidence(company_id,customer_contract_id,evidence_type,evidence_snapshot,evidence_sha256,captured_at)\n  values(v_contract.company_id,v_contract.id,'online_acceptance',v_signature,v_signature_hash,(v_signature->>'accepted_at')::timestamptz)\n  on conflict (customer_contract_id,evidence_type,evidence_sha256) do nothing;\n\n  select coalesce(v_customer.customer_type,'private') into v_customer_type;\n  select exists(select 1 from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id and d.module_key in ('withdrawal','withdrawal_right','withdrawal_form','distance_contract_information','pre_contract_information')) into v_withdrawal_required;\n  v_withdrawal_deadline:=case when v_customer_type='private' and v_withdrawal_required then ((((v_signature->>'accepted_at')::timestamptz AT TIME ZONE 'Europe/Stockholm')::date+15)::timestamp AT TIME ZONE 'Europe/Stockholm')-interval '1 microsecond' else null end;\n\n  update public.customer_contracts set\n    status='signed',signed_at=(v_signature->>'accepted_at')::timestamptz,\n    is_distance_agreement=true,withdrawal_deadline_at=v_withdrawal_deadline,\n    legal_versions_snapshot=v_legal_versions,signature_snapshot=v_signature,signature_snapshot_sha256=v_signature_hash,\n    signed_ip_hash=p_signed_ip_hash,signed_user_agent=left(p_signed_user_agent,1000),locked_at=(v_signature->>'accepted_at')::timestamptz,\n    lifecycle_stage='agreement_signed',signed_version=coalesce(terms_version,contract_version,'v1'),terms_signed_version=coalesce(terms_version,'v1'),\n    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('signature_status','signed','signature_method','secure_link_click','signature_request_id',v_request.id,'signature_snapshot_sha256',v_signature_hash,'pricing_snapshot_sha256',v_price.snapshot_hash),\n    updated_at=now()\n  where id=v_contract.id and company_id=v_contract.company_id\n  returning * into v_contract;\n\n  update public.customer_contract_signature_requests set used_at=(v_signature->>'accepted_at')::timestamptz where id=v_request.id;\n\n  v_event:=public.gridex_record_customer_contract_event_v1(\n    v_contract.company_id,v_contract.id,v_contract.customer_id,'signed',(v_signature->>'accepted_at')::timestamptz,\n    'Avtal signerat online via s\u00e4ker eng\u00e5ngsl\u00e4nk',\n    jsonb_build_object('signature_request_id',v_request.id,'signature_snapshot_sha256',v_signature_hash,'pricing_snapshot_sha256',v_price.snapshot_hash,'channel',v_request.channel),\n    null,null,\n    encode(extensions.digest(convert_to((v_request.id::text||':signed'),'UTF8'),'sha256'),'hex')\n  );\n\n  return public.gridex_get_customer_contract_signature_receipt_v1(p_token_hash) || jsonb_build_object('already_signed',false,'withdrawal_deadline_at',v_withdrawal_deadline);\nend\n","wrapper":"DECLARE r public.customer_contract_signature_requests%rowtype;BEGIN\n SELECT * INTO STRICT r FROM public.customer_contract_signature_requests WHERE token_hash=p_token_hash FOR SHARE;PERFORM public.ediel_require_contract_records_available_v1(r.company_id,r.customer_contract_id);\n RETURN public.gridex_finalize_signature_before_record_retention_v1(p_token_hash,p_signed_ip_hash,p_signed_user_agent);\nEND","old_md5":"3d7aba42bee835b241cbb2fe2c414d3c","canonical_md5":"5fb8cb915ab7eb2d4f0b218d4a9ddbd4","native_md5":"86e49c3db54add3887de13f00bf63b7b","wrapper_md5":"772abfbaeb6fdf4a2130a87d3e50284b"}]$extra_signing_config$::jsonb;
 extra_item jsonb; extra_public oid; extra_core oid; extra_role text; extra_oid oid;
 extra_before pg_catalog.pg_proc%rowtype; extra_public_before pg_catalog.pg_proc%rowtype; extra_core_before pg_catalog.pg_proc%rowtype;
 extra_during pg_catalog.pg_proc%rowtype; extra_saved jsonb:='[]'::jsonb; extra_snapshot jsonb;
 extra_definition text; extra_expected_acl aclitem[]; extra_expected_config text[];
 signing_old constant text:=$signing_old_source$
declare
  v_contract public.customer_contracts%rowtype;
  v_company public.companies%rowtype;
  v_binding jsonb;
  v_snapshot_id uuid;
  v_snapshot jsonb;
  v_base_components jsonb;
  v_price_components jsonb;
  v_pricing_model text;
  v_request public.customer_contract_signature_requests%rowtype;
  v_event jsonb;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.create');

  if p_company_id is null or p_customer_id is null or p_contract_id is null then
    raise exception using errcode='22023',message='signature_request_company_customer_contract_required';
  end if;
  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='signature_request_token_hash_invalid';
  end if;
  if nullif(btrim(coalesce(p_recipient_email,'')),'') is null or position('@' in p_recipient_email)=0 then
    raise exception using errcode='22023',message='signature_request_recipient_email_required';
  end if;
  if p_channel not in ('internal','website','partner_api','customer_portal') then
    raise exception using errcode='22023',message='signature_request_channel_invalid';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now()+interval '14 days' then
    raise exception using errcode='22023',message='signature_request_expiry_invalid';
  end if;

  select * into v_company from public.companies where id=p_company_id for share;
  if not found or not coalesce(v_company.is_active,false) or coalesce(v_company.lifecycle_status,'')<>'active' or v_company.suspended_at is not null then
    raise exception using errcode='55000',message='signature_request_tenant_not_operational';
  end if;

  select * into v_contract
  from public.customer_contracts
  where id=p_contract_id and company_id=p_company_id and customer_id=p_customer_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='signature_request_contract_not_found_for_tenant';
  end if;
  if v_contract.status in ('signed','active','terminated','cancelled','expired') or v_contract.signed_at is not null then
    raise exception using errcode='23514',message='signature_request_contract_already_finalized';
  end if;
  if v_contract.status not in ('draft','pending_signature','signature_failed') then
    raise exception using errcode='23514',message='signature_request_contract_state_invalid';
  end if;

  if v_contract.contract_publication_version_id is null
     or v_contract.contract_product_version_id is null
     or v_contract.price_plan_version_id is null
     or v_contract.legal_bundle_version_id is null then
    if v_contract.contract_offer_id is not null then
      perform public.gridex_ensure_internal_contract_publication(p_company_id,v_contract.contract_offer_id,p_actor_user_id);
      update public.customer_contracts
      set contract_offer_id=v_contract.contract_offer_id,updated_by=p_actor_user_id,updated_at=now()
      where id=v_contract.id and company_id=p_company_id
      returning * into v_contract;
    else
      v_binding:=public.gridex_prepare_manual_contract_binding(
        p_company_id,
        jsonb_strip_nulls(jsonb_build_object(
          'name',v_contract.contract_name,
          'customer_type',(select c.customer_type from public.customers c where c.id=v_contract.customer_id and c.company_id=p_company_id),
          'contract_type',v_contract.contract_type,
          'energy_direction',v_contract.energy_direction,
          'campaign_code',v_contract.campaign_code,
          'campaign_version',v_contract.campaign_version,
          'terms_version',v_contract.terms_version,
          'binding_months',v_contract.binding_months,
          'notice_months',v_contract.notice_months,
          'valid_from',coalesce(v_contract.starts_at::date,current_date),
          'valid_to',v_contract.ends_at::date
        )),
        coalesce(v_contract.price_snapshot,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'contract_type',v_contract.contract_type,
          'energy_direction',v_contract.energy_direction,
          'price_area',v_contract.price_area_used,
          'fixed_price_ore_per_kwh',v_contract.fixed_price_ore_per_kwh,
          'spot_markup_ore_per_kwh',v_contract.spot_markup_ore_per_kwh,
          'variable_fee_ore_per_kwh',v_contract.variable_fee_ore_per_kwh,
          'monthly_fee_sek',v_contract.monthly_fee_sek,
          'invoice_fee_sek',v_contract.invoice_fee_sek,
          'green_fee_mode',v_contract.green_fee_mode,
          'green_fee_value',v_contract.green_fee_value,
          'discount_value',v_contract.discount_value,
          'discount_unit',v_contract.discount_unit,
          'start_fee_sek',v_contract.start_fee_sek,
          'admin_fee_sek',v_contract.admin_fee_sek,
          'break_fee_sek',v_contract.break_fee_sek,
          'vat_rate',v_contract.vat_rate
        )),
        p_actor_user_id
      );
      update public.customer_contracts set
        contract_offer_id=nullif(v_binding->>'contract_offer_id','')::uuid,
        contract_product_id=nullif(v_binding->>'contract_product_id','')::uuid,
        contract_product_version_id=nullif(v_binding->>'contract_product_version_id','')::uuid,
        contract_publication_version_id=nullif(v_binding->>'contract_publication_version_id','')::uuid,
        price_plan_id=nullif(v_binding->>'price_plan_id','')::uuid,
        price_plan_version_id=nullif(v_binding->>'price_plan_version_id','')::uuid,
        price_book_id=nullif(v_binding->>'price_book_id','')::uuid,
        legal_bundle_version_id=nullif(v_binding->>'legal_bundle_version_id','')::uuid,
        offer_reference=v_binding->>'offer_reference',
        commercial_snapshot=coalesce(v_binding->'commercial_snapshot','{}'::jsonb),
        legal_snapshot=coalesce(v_binding->'legal_snapshot','{}'::jsonb),
        updated_by=p_actor_user_id,updated_at=now()
      where id=v_contract.id and company_id=p_company_id
      returning * into v_contract;
    end if;
  end if;

  if v_contract.contract_publication_version_id is null
     or v_contract.contract_product_version_id is null
     or v_contract.price_plan_version_id is null
     or v_contract.legal_bundle_version_id is null then
    raise exception using errcode='23514',message='signature_request_exact_contract_chain_missing';
  end if;

  if v_contract.contract_price_snapshot_id is null then
    select coalesce(cpv.pricing_model,'spot') into v_pricing_model
    from public.contract_product_versions cpv where cpv.id=v_contract.contract_product_version_id;
    v_base_components:=coalesce(
      v_contract.price_snapshot->'base_price_components_snapshot',
      v_contract.commercial_snapshot->'base_price_components_snapshot',
      v_contract.commercial_snapshot->'base_components',
      '[]'::jsonb
    );
    v_price_components:=coalesce(
      v_contract.price_snapshot->'price_components_snapshot',
      v_contract.commercial_snapshot->'price_components_snapshot',
      v_contract.commercial_snapshot->'price_components',
      '[]'::jsonb
    );
    if jsonb_typeof(v_base_components)<>'array' then v_base_components:='[]'::jsonb; end if;
    if jsonb_typeof(v_price_components)<>'array' then v_price_components:='[]'::jsonb; end if;
    v_snapshot:=jsonb_strip_nulls(coalesce(v_contract.price_snapshot,'{}'::jsonb) || jsonb_build_object(
      'snapshot_schema','gridex_contract_pricing_v7_signed_receipt',
      'source','signature_prepare',
      'company_id',v_contract.company_id,
      'contract_id',v_contract.id,
      'contract_number',v_contract.contract_number,
      'customer_number',v_contract.customer_number,
      'contract_type',v_contract.contract_type,
      'energy_direction',v_contract.energy_direction,
      'price_area',v_contract.price_area_used,
      'fixed_price_ore_per_kwh',v_contract.fixed_price_ore_per_kwh,
      'spot_markup_ore_per_kwh',v_contract.spot_markup_ore_per_kwh,
      'variable_fee_ore_per_kwh',v_contract.variable_fee_ore_per_kwh,
      'monthly_fee_sek',v_contract.monthly_fee_sek,
      'invoice_fee_sek',v_contract.invoice_fee_sek,
      'green_fee_mode',v_contract.green_fee_mode,
      'green_fee_value',v_contract.green_fee_value,
      'discount_value',v_contract.discount_value,
      'discount_unit',v_contract.discount_unit,
      'start_fee_sek',v_contract.start_fee_sek,
      'admin_fee_sek',v_contract.admin_fee_sek,
      'break_fee_sek',v_contract.break_fee_sek,
      'vat_rate',v_contract.vat_rate,
      'binding_months',v_contract.binding_months,
      'notice_months',v_contract.notice_months,
      'starts_at',v_contract.starts_at,
      'ends_at',v_contract.ends_at,
      'offer_reference',v_contract.offer_reference,
      'contract_publication_version_id',v_contract.contract_publication_version_id,
      'contract_product_version_id',v_contract.contract_product_version_id,
      'price_plan_version_id',v_contract.price_plan_version_id,
      'legal_bundle_version_id',v_contract.legal_bundle_version_id,
      'base_price_components_snapshot',v_base_components,
      'price_components_snapshot',v_price_components
    ));
    v_snapshot:=private.gridex_normalize_fixed_area_snapshot_v1(v_snapshot);
    insert into public.contract_price_snapshots(
      company_id,contract_id,customer_id,price_plan_version_id,pricing_model,
      base_price_components_snapshot,price_components_snapshot,snapshot_json,
      valid_from,valid_to,source,contract_number,customer_number,snapshot_hash,
      snapshot_quality,snapshot_schema_version
    ) values(
      p_company_id,v_contract.id,v_contract.customer_id,v_contract.price_plan_version_id,
      coalesce(v_pricing_model,'spot'),v_snapshot->'base_price_components_snapshot',
      coalesce(v_snapshot->'price_components_snapshot','[]'::jsonb),v_snapshot,
      coalesce(v_contract.starts_at::date,current_date),v_contract.ends_at::date,
      'signature_prepare',v_contract.contract_number,v_contract.customer_number,
      encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex'),
      'canonical','gridex_contract_pricing_v7_signed_receipt'
    ) returning id into v_snapshot_id;
    update public.customer_contracts
    set contract_price_snapshot_id=v_snapshot_id,price_snapshot=v_snapshot,updated_by=p_actor_user_id,updated_at=now()
    where id=v_contract.id and company_id=p_company_id
    returning * into v_contract;
  end if;

  if not exists(
    select 1
    from public.contract_publication_versions cpv
    join public.contract_publications cp on cp.id=cpv.contract_publication_id
    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id and ta.company_id=p_company_id
    join public.contract_product_versions ctv on ctv.id=cpv.contract_product_version_id
    join public.price_plan_versions ppv on ppv.id=cpv.price_plan_version_id
    join public.legal_bundle_versions lbv on lbv.id=cpv.legal_bundle_version_id
    join public.contract_price_snapshots cps on cps.id=v_contract.contract_price_snapshot_id and cps.contract_id=v_contract.id and cps.company_id=p_company_id
    where cpv.id=v_contract.contract_publication_version_id
      and cpv.contract_product_version_id=v_contract.contract_product_version_id
      and cpv.price_plan_version_id=v_contract.price_plan_version_id
      and cpv.legal_bundle_version_id=v_contract.legal_bundle_version_id
      and cpv.status='published' and cpv.locked_at is not null
      and ctv.status='approved' and ctv.locked_at is not null
      and ppv.status in ('published','approved','active') and ppv.locked_at is not null
      and lbv.status='published' and lbv.locked_at is not null and cardinality(lbv.unresolved_variables)=0
      and nullif(cps.snapshot_hash,'') is not null
  ) then
    raise exception using errcode='23514',message='signature_request_exact_locked_chain_invalid';
  end if;
  if not exists(select 1 from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id) then
    raise exception using errcode='23514',message='signature_request_legal_document_set_missing';
  end if;

  if v_contract.status in ('draft','signature_failed') then
    update public.customer_contracts
    set status='pending_signature',lifecycle_stage='agreement_ready',updated_by=p_actor_user_id,updated_at=now()
    where id=v_contract.id and company_id=p_company_id
    returning * into v_contract;
  end if;

  update public.customer_contract_signature_requests
  set revoked_at=now()
  where company_id=p_company_id and customer_contract_id=p_contract_id
    and used_at is null and revoked_at is null;

  insert into public.customer_contract_signature_requests(
    company_id,customer_id,customer_contract_id,token_hash,recipient_email,
    channel,expires_at,created_by,metadata
  ) values(
    p_company_id,p_customer_id,p_contract_id,p_token_hash,lower(btrim(p_recipient_email)),
    p_channel,p_expires_at,p_actor_user_id,
    jsonb_build_object(
      'contract_number',v_contract.contract_number,
      'offer_reference',v_contract.offer_reference,
      'contract_publication_version_id',v_contract.contract_publication_version_id,
      'price_plan_version_id',v_contract.price_plan_version_id,
      'legal_bundle_version_id',v_contract.legal_bundle_version_id,
      'contract_price_snapshot_id',v_contract.contract_price_snapshot_id
    )
  ) returning * into v_request;

  v_event:=public.gridex_record_customer_contract_event_v1(
    p_company_id,v_contract.id,v_contract.customer_id,'signature_requested',now(),
    'Online-signering begärd',
    jsonb_build_object('signature_request_id',v_request.id,'channel',p_channel,'expires_at',p_expires_at),
    p_actor_user_id,null,
    encode(extensions.digest(convert_to((v_request.id::text||':signature_requested'),'UTF8'),'sha256'),'hex')
  );

  return jsonb_build_object(
    'ok',true,
    'request_id',v_request.id,
    'company_id',p_company_id,
    'customer_id',v_contract.customer_id,
    'contract_id',v_contract.id,
    'contract_number',v_contract.contract_number,
    'contract_name',v_contract.contract_name,
    'status',v_contract.status,
    'recipient_email',v_request.recipient_email,
    'expires_at',v_request.expires_at,
    'channel',v_request.channel,
    'offer_reference',v_contract.offer_reference,
    'contract_publication_version_id',v_contract.contract_publication_version_id,
    'price_plan_version_id',v_contract.price_plan_version_id,
    'legal_bundle_version_id',v_contract.legal_bundle_version_id,
    'contract_price_snapshot_id',v_contract.contract_price_snapshot_id
  );
end
$signing_old_source$;
 signing_wrapper constant text:=$signing_wrapper_source$BEGIN
 PERFORM public.ediel_require_contract_records_available_v1(p_company_id,p_contract_id);
 RETURN public.gridex_prepare_signature_before_record_retention_v1(p_company_id,p_customer_id,p_contract_id,p_token_hash,p_recipient_email,p_expires_at,p_actor_user_id,p_channel);
END$signing_wrapper_source$;
 signing_cee constant text:=$signing_cee_source$
declare
  v_contract public.customer_contracts%rowtype;
  v_company public.companies%rowtype;
  v_binding jsonb;
  v_snapshot_id uuid;
  v_snapshot jsonb;
  v_base_components jsonb;
  v_price_components jsonb;
  v_pricing_model text;
  v_request public.customer_contract_signature_requests%rowtype;
  v_event jsonb;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.create');

  if p_company_id is null or p_customer_id is null or p_contract_id is null then
    raise exception using errcode='22023',message='signature_request_company_customer_contract_required';
  end if;
  if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='signature_request_token_hash_invalid';
  end if;
  if nullif(btrim(coalesce(p_recipient_email,'')),'') is null or position('@' in p_recipient_email)=0 then
    raise exception using errcode='22023',message='signature_request_recipient_email_required';
  end if;
  if p_channel not in ('internal','website','partner_api','customer_portal') then
    raise exception using errcode='22023',message='signature_request_channel_invalid';
  end if;
  if p_expires_at is null or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp()+interval '14 days' then
    raise exception using errcode='22023',message='signature_request_expiry_invalid';
  end if;

  select * into v_company from public.companies where id=p_company_id for share;
  if not found or not coalesce(v_company.is_active,false) or coalesce(v_company.lifecycle_status,'')<>'active' or v_company.suspended_at is not null then
    raise exception using errcode='55000',message='signature_request_tenant_not_operational';
  end if;

  select * into v_contract
  from public.customer_contracts
  where id=p_contract_id and company_id=p_company_id and customer_id=p_customer_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='signature_request_contract_not_found_for_tenant';
  end if;
  if v_contract.status in ('signed','active','terminated','cancelled','expired') or v_contract.signed_at is not null then
    raise exception using errcode='23514',message='signature_request_contract_already_finalized';
  end if;
  if v_contract.status not in ('draft','pending_signature','signature_failed') then
    raise exception using errcode='23514',message='signature_request_contract_state_invalid';
  end if;

  if v_contract.contract_publication_version_id is null
     or v_contract.contract_product_version_id is null
     or v_contract.price_plan_version_id is null
     or v_contract.legal_bundle_version_id is null then
    if v_contract.contract_offer_id is not null then
      perform public.gridex_ensure_internal_contract_publication(p_company_id,v_contract.contract_offer_id,p_actor_user_id);
      update public.customer_contracts
      set contract_offer_id=v_contract.contract_offer_id,updated_by=p_actor_user_id,updated_at=now()
      where id=v_contract.id and company_id=p_company_id
      returning * into v_contract;
    else
      v_binding:=public.gridex_prepare_manual_contract_binding(
        p_company_id,
        jsonb_strip_nulls(jsonb_build_object(
          'name',v_contract.contract_name,
          'customer_type',(select c.customer_type from public.customers c where c.id=v_contract.customer_id and c.company_id=p_company_id),
          'contract_type',v_contract.contract_type,
          'energy_direction',v_contract.energy_direction,
          'campaign_code',v_contract.campaign_code,
          'campaign_version',v_contract.campaign_version,
          'terms_version',v_contract.terms_version,
          'binding_months',v_contract.binding_months,
          'notice_months',v_contract.notice_months,
          'valid_from',coalesce(v_contract.starts_at::date,current_date),
          'valid_to',v_contract.ends_at::date
        )),
        coalesce(v_contract.price_snapshot,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'contract_type',v_contract.contract_type,
          'energy_direction',v_contract.energy_direction,
          'price_area',v_contract.price_area_used,
          'fixed_price_ore_per_kwh',v_contract.fixed_price_ore_per_kwh,
          'spot_markup_ore_per_kwh',v_contract.spot_markup_ore_per_kwh,
          'variable_fee_ore_per_kwh',v_contract.variable_fee_ore_per_kwh,
          'monthly_fee_sek',v_contract.monthly_fee_sek,
          'invoice_fee_sek',v_contract.invoice_fee_sek,
          'green_fee_mode',v_contract.green_fee_mode,
          'green_fee_value',v_contract.green_fee_value,
          'discount_value',v_contract.discount_value,
          'discount_unit',v_contract.discount_unit,
          'start_fee_sek',v_contract.start_fee_sek,
          'admin_fee_sek',v_contract.admin_fee_sek,
          'break_fee_sek',v_contract.break_fee_sek,
          'vat_rate',v_contract.vat_rate
        )),
        p_actor_user_id
      );
      update public.customer_contracts set
        contract_offer_id=nullif(v_binding->>'contract_offer_id','')::uuid,
        contract_product_id=nullif(v_binding->>'contract_product_id','')::uuid,
        contract_product_version_id=nullif(v_binding->>'contract_product_version_id','')::uuid,
        contract_publication_version_id=nullif(v_binding->>'contract_publication_version_id','')::uuid,
        price_plan_id=nullif(v_binding->>'price_plan_id','')::uuid,
        price_plan_version_id=nullif(v_binding->>'price_plan_version_id','')::uuid,
        price_book_id=nullif(v_binding->>'price_book_id','')::uuid,
        legal_bundle_version_id=nullif(v_binding->>'legal_bundle_version_id','')::uuid,
        offer_reference=v_binding->>'offer_reference',
        commercial_snapshot=coalesce(v_binding->'commercial_snapshot','{}'::jsonb),
        legal_snapshot=coalesce(v_binding->'legal_snapshot','{}'::jsonb),
        updated_by=p_actor_user_id,updated_at=now()
      where id=v_contract.id and company_id=p_company_id
      returning * into v_contract;
    end if;
  end if;

  if v_contract.contract_publication_version_id is null
     or v_contract.contract_product_version_id is null
     or v_contract.price_plan_version_id is null
     or v_contract.legal_bundle_version_id is null then
    raise exception using errcode='23514',message='signature_request_exact_contract_chain_missing';
  end if;

  if v_contract.contract_price_snapshot_id is null then
    select coalesce(cpv.pricing_model,'spot') into v_pricing_model
    from public.contract_product_versions cpv where cpv.id=v_contract.contract_product_version_id;
    v_base_components:=coalesce(
      v_contract.price_snapshot->'base_price_components_snapshot',
      v_contract.commercial_snapshot->'base_price_components_snapshot',
      v_contract.commercial_snapshot->'base_components',
      '[]'::jsonb
    );
    v_price_components:=coalesce(
      v_contract.price_snapshot->'price_components_snapshot',
      v_contract.commercial_snapshot->'price_components_snapshot',
      v_contract.commercial_snapshot->'price_components',
      '[]'::jsonb
    );
    if jsonb_typeof(v_base_components)<>'array' then v_base_components:='[]'::jsonb; end if;
    if jsonb_typeof(v_price_components)<>'array' then v_price_components:='[]'::jsonb; end if;
    v_snapshot:=jsonb_strip_nulls(coalesce(v_contract.price_snapshot,'{}'::jsonb) || jsonb_build_object(
      'snapshot_schema','gridex_contract_pricing_v7_signed_receipt',
      'source','signature_prepare',
      'company_id',v_contract.company_id,
      'contract_id',v_contract.id,
      'contract_number',v_contract.contract_number,
      'customer_number',v_contract.customer_number,
      'contract_type',v_contract.contract_type,
      'energy_direction',v_contract.energy_direction,
      'price_area',v_contract.price_area_used,
      'fixed_price_ore_per_kwh',v_contract.fixed_price_ore_per_kwh,
      'spot_markup_ore_per_kwh',v_contract.spot_markup_ore_per_kwh,
      'variable_fee_ore_per_kwh',v_contract.variable_fee_ore_per_kwh,
      'monthly_fee_sek',v_contract.monthly_fee_sek,
      'invoice_fee_sek',v_contract.invoice_fee_sek,
      'green_fee_mode',v_contract.green_fee_mode,
      'green_fee_value',v_contract.green_fee_value,
      'discount_value',v_contract.discount_value,
      'discount_unit',v_contract.discount_unit,
      'start_fee_sek',v_contract.start_fee_sek,
      'admin_fee_sek',v_contract.admin_fee_sek,
      'break_fee_sek',v_contract.break_fee_sek,
      'vat_rate',v_contract.vat_rate,
      'binding_months',v_contract.binding_months,
      'notice_months',v_contract.notice_months,
      'starts_at',v_contract.starts_at,
      'ends_at',v_contract.ends_at,
      'offer_reference',v_contract.offer_reference,
      'contract_publication_version_id',v_contract.contract_publication_version_id,
      'contract_product_version_id',v_contract.contract_product_version_id,
      'price_plan_version_id',v_contract.price_plan_version_id,
      'legal_bundle_version_id',v_contract.legal_bundle_version_id,
      'base_price_components_snapshot',v_base_components,
      'price_components_snapshot',v_price_components
    ));
    v_snapshot:=private.gridex_normalize_fixed_area_snapshot_v1(v_snapshot);
    insert into public.contract_price_snapshots(
      company_id,contract_id,customer_id,price_plan_version_id,pricing_model,
      base_price_components_snapshot,price_components_snapshot,snapshot_json,
      valid_from,valid_to,source,contract_number,customer_number,snapshot_hash,
      snapshot_quality,snapshot_schema_version
    ) values(
      p_company_id,v_contract.id,v_contract.customer_id,v_contract.price_plan_version_id,
      coalesce(v_pricing_model,'spot'),v_snapshot->'base_price_components_snapshot',
      coalesce(v_snapshot->'price_components_snapshot','[]'::jsonb),v_snapshot,
      coalesce(v_contract.starts_at::date,current_date),v_contract.ends_at::date,
      'signature_prepare',v_contract.contract_number,v_contract.customer_number,
      encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex'),
      'canonical','gridex_contract_pricing_v7_signed_receipt'
    ) returning id into v_snapshot_id;
    update public.customer_contracts
    set contract_price_snapshot_id=v_snapshot_id,price_snapshot=v_snapshot,updated_by=p_actor_user_id,updated_at=now()
    where id=v_contract.id and company_id=p_company_id
    returning * into v_contract;
  end if;

  if not exists(
    select 1
    from public.contract_publication_versions cpv
    join public.contract_publications cp on cp.id=cpv.contract_publication_id
    join public.tenant_contract_assignments ta on ta.id=cp.assignment_id and ta.company_id=p_company_id
    join public.contract_product_versions ctv on ctv.id=cpv.contract_product_version_id
    join public.price_plan_versions ppv on ppv.id=cpv.price_plan_version_id
    join public.legal_bundle_versions lbv on lbv.id=cpv.legal_bundle_version_id
    join public.contract_price_snapshots cps on cps.id=v_contract.contract_price_snapshot_id and cps.contract_id=v_contract.id and cps.company_id=p_company_id
    where cpv.id=v_contract.contract_publication_version_id
      and cpv.contract_product_version_id=v_contract.contract_product_version_id
      and cpv.price_plan_version_id=v_contract.price_plan_version_id
      and cpv.legal_bundle_version_id=v_contract.legal_bundle_version_id
      and cpv.status='published' and cpv.locked_at is not null
      and ctv.status='approved' and ctv.locked_at is not null
      and ppv.status in ('published','approved','active') and ppv.locked_at is not null
      and lbv.status='published' and lbv.locked_at is not null and cardinality(lbv.unresolved_variables)=0
      and nullif(cps.snapshot_hash,'') is not null
  ) then
    raise exception using errcode='23514',message='signature_request_exact_locked_chain_invalid';
  end if;
  if not exists(select 1 from public.legal_bundle_version_documents d where d.legal_bundle_version_id=v_contract.legal_bundle_version_id) then
    raise exception using errcode='23514',message='signature_request_legal_document_set_missing';
  end if;

  if v_contract.status in ('draft','signature_failed') then
    update public.customer_contracts
    set status='pending_signature',lifecycle_stage='agreement_ready',updated_by=p_actor_user_id,updated_at=now()
    where id=v_contract.id and company_id=p_company_id
    returning * into v_contract;
  end if;

  -- Wait for current pending request writers before checking wall-clock expiry.
  -- The contract lock serializes preparation; mark-sent locks these rows directly.
  perform id
  from public.customer_contract_signature_requests
  where company_id=p_company_id and customer_contract_id=p_contract_id
    and used_at is null and revoked_at is null
  order by id for update;

  -- Revalidate freshness after the company/contract/publication/snapshot locks.
  -- A failed recheck rolls back all preparation; no prior link is revoked.
  if p_expires_at is null or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp()+interval '14 days' then
    raise exception using errcode='22023',message='signature_request_expiry_invalid';
  end if;

  update public.customer_contract_signature_requests
  set revoked_at=now()
  where company_id=p_company_id and customer_contract_id=p_contract_id
    and used_at is null and revoked_at is null;

  insert into public.customer_contract_signature_requests(
    company_id,customer_id,customer_contract_id,token_hash,recipient_email,
    channel,expires_at,created_by,metadata
  ) values(
    p_company_id,p_customer_id,p_contract_id,p_token_hash,lower(btrim(p_recipient_email)),
    p_channel,p_expires_at,p_actor_user_id,
    jsonb_build_object(
      'customer_full_name',(select coalesce(nullif(btrim(c.full_name),''),nullif(btrim(c.company_name),''),
        nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''))
        from public.customers c where c.id=p_customer_id and c.company_id=p_company_id),
      'contract_number',v_contract.contract_number,
      'offer_reference',v_contract.offer_reference,
      'contract_publication_version_id',v_contract.contract_publication_version_id,
      'price_plan_version_id',v_contract.price_plan_version_id,
      'legal_bundle_version_id',v_contract.legal_bundle_version_id,
      'contract_price_snapshot_id',v_contract.contract_price_snapshot_id
    )
  ) returning * into v_request;

  v_event:=public.gridex_record_customer_contract_event_v1(
    p_company_id,v_contract.id,v_contract.customer_id,'signature_requested',now(),
    'Online-signering begärd',
    jsonb_build_object('signature_request_id',v_request.id,'channel',p_channel,'expires_at',p_expires_at),
    p_actor_user_id,null,
    encode(extensions.digest(convert_to((v_request.id::text||':signature_requested'),'UTF8'),'sha256'),'hex')
  );

  return jsonb_build_object(
    'ok',true,
    'request_id',v_request.id,
    'company_id',p_company_id,
    'customer_id',v_contract.customer_id,
    'contract_id',v_contract.id,
    'contract_number',v_contract.contract_number,
    'contract_name',v_contract.contract_name,
    'status',v_contract.status,
    'recipient_email',v_request.recipient_email,
    'expires_at',v_request.expires_at,
    'channel',v_request.channel,
    'offer_reference',v_contract.offer_reference,
    'contract_publication_version_id',v_contract.contract_publication_version_id,
    'price_plan_version_id',v_contract.price_plan_version_id,
    'legal_bundle_version_id',v_contract.legal_bundle_version_id,
    'contract_price_snapshot_id',v_contract.contract_price_snapshot_id
  );
end
$signing_cee_source$;

 projection_before pg_catalog.pg_proc%rowtype; projection_during pg_catalog.pg_proc%rowtype; projection_after pg_catalog.pg_proc%rowtype;
 projection_target oid; projection_definition text; projection_normalized boolean:=false;
 projection_old constant text:=$projection_old$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(raw);raw_parts jsonb:=gridex_prodat_object_batch.raw_segments_v1(raw);t jsonb;e jsonb;first_index int:=(own#>>'{registers,0,segmentIndex}')::int;next_index int;
 ud jsonb;it jsonb;qty text;start_day text;frequency text;product text;reference text;area text;grid_id uuid;characteristic text;name text;personal text;org text;is_business bool;key text;expected jsonb;field_value jsonb;reg jsonb;wire_reg jsonb;reg_end int;reg_raw jsonb;reg_qty text;BEGIN
 IF tokens IS NULL THEN RAISE EXCEPTION 'prodat_object_batch_physical_projection_required';END IF;
 SELECT min((x->>'index')::int) INTO next_index FROM jsonb_array_elements(tokens)x WHERE x->>'tag' IN('LIN','UNT') AND (x->>'index')::int>first_index;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens)x WHERE (x->>'index')::int>first_index AND (x->>'index')::int<next_index ORDER BY(x->>'index')::int LOOP
  e:=t->'elements';
  IF t->>'tag'='NAD' AND e#>>'{1,0}'='UD' THEN ud:=e;ELSIF t->>'tag'='NAD' AND e#>>'{1,0}'='IT' THEN it:=e;
  ELSIF t->>'tag'='QTY' AND e#>>'{1,0}'='31' THEN qty:=e#>>'{1,1}';
  ELSIF t->>'tag'='DTM' AND e#>>'{1,0}'='92' THEN start_day:=e#>>'{1,1}';
  ELSIF t->>'tag'='RFF' AND e#>>'{1,0}'='Z07' THEN reference:=e#>>'{1,1}';
  ELSIF t->>'tag'='RFF' AND e#>>'{1,0}'='Z05' THEN area:=e#>>'{1,1}';
  ELSIF t->>'tag'='CCI' THEN characteristic:=e#>>'{2,0}';
  ELSIF t->>'tag'='CAV' AND characteristic='Z12' THEN frequency:=e#>>'{1,3}';
  ELSIF t->>'tag'='CAV' AND characteristic='Z14' THEN product:=e#>>'{1,3}';END IF;
 END LOOP;
 FOR reg IN SELECT value FROM jsonb_array_elements(command#>'{application,payload_snapshot,prodatRegisters}') LOOP
  SELECT x INTO wire_reg FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='LIN' AND x#>>'{elements,1,0}'=reg->>'lineSequenceNumber';
  SELECT min((x->>'index')::int) INTO reg_end FROM jsonb_array_elements(tokens)x WHERE x->>'tag' IN('LIN','UNT') AND (x->>'index')::int>(wire_reg->>'index')::int;
  SELECT jsonb_agg(raw_parts->((x->>'index')::int) ORDER BY(x->>'index')::int) INTO reg_raw FROM jsonb_array_elements(tokens)x WHERE (x->>'index')::int>=(wire_reg->>'index')::int AND(x->>'index')::int<reg_end;
  SELECT btrim(x#>>'{elements,1,1}') INTO reg_qty FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='QTY' AND x#>>'{elements,1,0}'='31' AND(x->>'index')::int>(wire_reg->>'index')::int AND(x->>'index')::int<reg_end;
  IF wire_reg IS NULL OR wire_reg#>>'{elements,3,0}' IS DISTINCT FROM own->>'objectId' OR wire_reg#>>'{elements,3,3}' IS DISTINCT FROM own->>'identityAgency'
   OR reg->>'meteringPointId' IS DISTINCT FROM own->>'objectId' OR reg->>'identityAgency' IS DISTINCT FROM own->>'identityAgency'
   OR reg->'rawSegments' IS DISTINCT FROM reg_raw OR reg->>'annualConsumption' IS DISTINCT FROM reg_qty OR reg->>'registerIndex' IS DISTINCT FROM nullif(wire_reg#>>'{elements,4,1}','')
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(own->'registers')r WHERE r->'lineIndex'=reg->'sourceOrder' AND r->>'lineNumber'=reg->>'lineSequenceNumber' AND r->'segmentIndex'=wire_reg->'index') THEN RAISE EXCEPTION 'prodat_object_batch_physical_register_required';END IF;
 END LOOP;
 IF mode='link_existing_only' THEN
  IF command->'customer'<>'{}'::jsonb OR command->'site' IS DISTINCT FROM jsonb_build_object('facility_id',own->>'objectId') OR command->'metering_point' IS DISTINCT FROM jsonb_build_object('meter_point_id',own->>'objectId') OR command->'update_existing' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'prodat_object_batch_link_identity_only_required';END IF;RETURN;
 END IF;
 IF area IS NOT NULL THEN SELECT id INTO grid_id FROM public.grid_owners WHERE company_id=(command->>'company_id')::uuid AND owner_code=area FOR SHARE;
  IF (SELECT count(*) FROM public.grid_owners WHERE company_id=(command->>'company_id')::uuid AND owner_code=area)>1 THEN RAISE EXCEPTION 'prodat_object_batch_grid_namespace_ambiguous';END IF;END IF;
 IF command#>'{site,grid_owner_id}' IS NOT NULL AND command#>'{site,grid_owner_id}' IS DISTINCT FROM coalesce(to_jsonb(grid_id::text),'null'::jsonb) OR command#>'{metering_point,grid_owner_id}' IS NOT NULL AND command#>'{metering_point,grid_owner_id}' IS DISTINCT FROM coalesce(to_jsonb(grid_id::text),'null'::jsonb) THEN RAISE EXCEPTION 'prodat_object_batch_wire_grid_owner_required';END IF;
 SELECT string_agg(btrim(v#>>'{}'),E'\n' ORDER BY ord) INTO name FROM jsonb_array_elements(coalesce(ud->4,'[]')) WITH ORDINALITY n(v,ord) WHERE ord<=2 AND btrim(v#>>'{}')<>'';
 is_business:=ud#>>'{2,1}'='SE1';
 IF ud#>>'{2,0}'~'^[0-9]+([-+][0-9]+)?$' THEN
  IF ud#>>'{2,1}'='SE1' THEN org:=regexp_replace(ud#>>'{2,0}','[^0-9]','','g');ELSIF ud#>>'{2,1}'='SE2' THEN personal:=regexp_replace(ud#>>'{2,0}','[^0-9]','','g');END IF;
 END IF;
 expected:=jsonb_build_object('customer_type',CASE WHEN is_business THEN 'business' ELSE 'private' END,'full_name',coalesce(name,'Ediel inbound-kund'),'company_name',CASE WHEN is_business THEN name END,
  'first_name',CASE WHEN NOT coalesce(is_business,false) THEN split_part(name,' ',1) END,'last_name',CASE WHEN NOT coalesce(is_business,false) THEN nullif(substr(name,strpos(name,' ')+1),name) END,'personal_number',personal,'org_number',org);
 FOR key,field_value IN SELECT * FROM jsonb_each(command->'customer') LOOP
  IF expected ? key AND field_value IS DISTINCT FROM expected->key THEN RAISE EXCEPTION 'prodat_object_batch_wire_customer_required';END IF;
  IF NOT(expected ? key) AND key NOT IN('status','source','metadata','created_by','updated_by') THEN RAISE EXCEPTION 'prodat_object_batch_customer_field_not_source_bound';END IF;
  IF key='status' AND field_value IS DISTINCT FROM '"draft"'::jsonb OR key='source' AND field_value IS DISTINCT FROM '"ediel_inbound"'::jsonb THEN RAISE EXCEPTION 'prodat_object_batch_customer_binding_required';END IF;
  IF key IN('created_by','updated_by') AND field_value IS DISTINCT FROM to_jsonb(actor::text) THEN RAISE EXCEPTION 'prodat_object_batch_actor_required';END IF;
 END LOOP;
 expected:=jsonb_build_object('site_name','Ediel '||(own->>'objectId'),'facility_id',own->>'objectId','site_type',CASE WHEN product='L641Q' THEN 'production' ELSE 'consumption' END,
  'street',CASE WHEN it IS NOT NULL THEN array_to_string(ARRAY(SELECT btrim(v#>>'{}') FROM jsonb_array_elements(it->5) WITH ORDINALITY a(v,ord) WHERE ord<=3 AND btrim(v#>>'{}')<>''),E'\n') END,
  'postal_code',nullif(it#>>'{8,0}',''),'city',nullif(it#>>'{6,0}',''),'country',coalesce(nullif(it#>>'{9,0}',''),'SE'),
  'annual_consumption_kwh',CASE WHEN qty IS NOT NULL THEN replace(qty,',','.')::numeric END,'move_in_date',CASE WHEN start_day IS NOT NULL THEN substr(start_day,1,4)||'-'||substr(start_day,5,2)||'-'||substr(start_day,7,2) END);
 FOR key,field_value IN SELECT * FROM jsonb_each(command->'site') LOOP
  IF expected ? key AND field_value IS DISTINCT FROM expected->key THEN RAISE EXCEPTION 'prodat_object_batch_wire_site_required';END IF;
  IF key='status' AND field_value IS DISTINCT FROM '"draft"'::jsonb OR key IN('created_by','updated_by') AND field_value IS DISTINCT FROM to_jsonb(actor::text) THEN RAISE EXCEPTION 'prodat_object_batch_actor_required';END IF;
  IF NOT(expected ? key) AND key NOT IN('status','grid_owner_id','internal_notes','created_by','updated_by') THEN RAISE EXCEPTION 'prodat_object_batch_site_field_not_source_bound';END IF;
 END LOOP;
 expected:=jsonb_build_object('meter_point_id',own->>'objectId','metering_point_id',own->>'objectId','site_facility_id',own->>'objectId','ediel_reference',reference,
  'measurement_type',CASE WHEN product='L641Q' THEN 'production' ELSE 'consumption' END,'reading_frequency',CASE frequency WHEN 'D' THEN 'daily' WHEN 'M' THEN 'monthly' ELSE 'hourly' END,
  'start_date',CASE WHEN start_day IS NOT NULL THEN substr(start_day,1,4)||'-'||substr(start_day,5,2)||'-'||substr(start_day,7,2) END,'is_settlement_relevant',true);
 FOR key,field_value IN SELECT * FROM jsonb_each(command->'metering_point') LOOP
  IF expected ? key AND field_value IS DISTINCT FROM expected->key THEN RAISE EXCEPTION 'prodat_object_batch_wire_meter_required';END IF;
  IF key='status' AND field_value IS DISTINCT FROM '"draft"'::jsonb OR key IN('created_by','updated_by') AND field_value IS DISTINCT FROM to_jsonb(actor::text) THEN RAISE EXCEPTION 'prodat_object_batch_actor_required';END IF;
  IF NOT(expected ? key) AND key NOT IN('status','grid_owner_id','created_by','updated_by') THEN RAISE EXCEPTION 'prodat_object_batch_meter_field_not_source_bound';END IF;
 END LOOP;
END $projection_old$;
 projection_current constant text:=$projection_current$
DECLARE tokens jsonb:=gridex_received_sources.closure_wire_tokens_v2(raw);raw_parts jsonb:=gridex_prodat_object_batch.raw_segments_v1(raw);t jsonb;e jsonb;first_index int:=(own#>>'{registers,0,segmentIndex}')::int;next_index int;
 ud jsonb;it jsonb;qty text;start_day text;frequency text;product text;reference text;area text;grid_id uuid;characteristic text;name text;personal text;org text;is_business bool;key text;expected jsonb;field_value jsonb;reg jsonb;wire_reg jsonb;reg_end int;reg_raw jsonb;reg_qty text;
 source_company uuid;source_id uuid;source_hash text;source_row public.ediel_messages%rowtype;source_original gridex_received_sources.sources%rowtype;
 application jsonb;ignored gridex_received_sources.prodat_ignored_field_facets%rowtype;fields jsonb;field jsonb;occ jsonb;physical jsonb;owner_object jsonb;owner_register jsonb;
 first_owner_index int;first_owner_end int;first_party_index int;li text;customer_ref text;li_count int;customer_count int;refs jsonb;own_fields text[]:=ARRAY[]::text[];
BEGIN
 IF tokens IS NULL THEN RAISE EXCEPTION 'prodat_object_batch_physical_projection_required';END IF;
 SELECT min((x->>'index')::int) INTO next_index FROM jsonb_array_elements(tokens)x WHERE x->>'tag' IN('LIN','UNT') AND (x->>'index')::int>first_index;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens)x WHERE (x->>'index')::int>first_index AND (x->>'index')::int<next_index ORDER BY(x->>'index')::int LOOP
  e:=t->'elements';
  IF t->>'tag'='NAD' AND e#>>'{1,0}'='UD' THEN ud:=e;ELSIF t->>'tag'='NAD' AND e#>>'{1,0}'='IT' THEN it:=e;
  ELSIF t->>'tag'='QTY' AND e#>>'{1,0}'='31' THEN qty:=e#>>'{1,1}';
  ELSIF t->>'tag'='DTM' AND e#>>'{1,0}'='92' THEN start_day:=e#>>'{1,1}';
  ELSIF t->>'tag'='RFF' AND e#>>'{1,0}'='Z07' THEN reference:=e#>>'{1,1}';
  ELSIF t->>'tag'='RFF' AND e#>>'{1,0}'='Z05' THEN area:=e#>>'{1,1}';
  ELSIF t->>'tag'='CCI' THEN characteristic:=e#>>'{2,0}';
  ELSIF t->>'tag'='CAV' AND characteristic='Z12' THEN frequency:=e#>>'{1,3}';
  ELSIF t->>'tag'='CAV' AND characteristic='Z14' THEN product:=e#>>'{1,3}';END IF;
 END LOOP;
 FOR reg IN SELECT value FROM jsonb_array_elements(command#>'{application,payload_snapshot,prodatRegisters}') LOOP
  SELECT x INTO wire_reg FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='LIN' AND x#>>'{elements,1,0}'=reg->>'lineSequenceNumber';
  SELECT min((x->>'index')::int) INTO reg_end FROM jsonb_array_elements(tokens)x WHERE x->>'tag' IN('LIN','UNT') AND (x->>'index')::int>(wire_reg->>'index')::int;
  SELECT jsonb_agg(raw_parts->((x->>'index')::int) ORDER BY(x->>'index')::int) INTO reg_raw FROM jsonb_array_elements(tokens)x WHERE (x->>'index')::int>=(wire_reg->>'index')::int AND(x->>'index')::int<reg_end;
  SELECT btrim(x#>>'{elements,1,1}') INTO reg_qty FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='QTY' AND x#>>'{elements,1,0}'='31' AND(x->>'index')::int>(wire_reg->>'index')::int AND(x->>'index')::int<reg_end;
  IF wire_reg IS NULL OR wire_reg#>>'{elements,3,0}' IS DISTINCT FROM own->>'objectId' OR wire_reg#>>'{elements,3,3}' IS DISTINCT FROM own->>'identityAgency'
   OR reg->>'meteringPointId' IS DISTINCT FROM own->>'objectId' OR reg->>'identityAgency' IS DISTINCT FROM own->>'identityAgency'
   OR reg->'rawSegments' IS DISTINCT FROM reg_raw OR reg->>'annualConsumption' IS DISTINCT FROM reg_qty OR reg->>'registerIndex' IS DISTINCT FROM nullif(wire_reg#>>'{elements,4,1}','')
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(own->'registers')r WHERE r->'lineIndex'=reg->'sourceOrder' AND r->>'lineNumber'=reg->>'lineSequenceNumber' AND r->'segmentIndex'=wire_reg->'index') THEN RAISE EXCEPTION 'prodat_object_batch_physical_register_required';END IF;
 END LOOP;
 IF mode='link_existing_only' THEN
  IF command->'customer'<>'{}'::jsonb OR command->'site' IS DISTINCT FROM jsonb_build_object('facility_id',own->>'objectId') OR command->'metering_point' IS DISTINCT FROM jsonb_build_object('meter_point_id',own->>'objectId') OR command->'update_existing' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'prodat_object_batch_link_identity_only_required';END IF;RETURN;
 END IF;
 -- Same immutable canonical assessment under the caller's existing graph
 -- lock; raw/register snapshots stay intact. Missing facets are UNKNOWN/HOLD.
 source_company:=(command->>'company_id')::uuid;
 source_id:=(command#>>'{application,payload_snapshot,edielMessageId}')::uuid;
 source_hash:=encode(sha256(convert_to(raw,'UTF8')),'hex');
 SELECT * INTO source_row FROM public.ediel_messages WHERE id=source_id AND company_id=source_company;
 SELECT * INTO source_original FROM gridex_received_sources.sources WHERE source_message_id=source_id AND company_id=source_company AND environment=source_row.environment;
 IF source_row.id IS NULL OR source_original.source_message_id IS NULL OR source_row.direction IS DISTINCT FROM 'inbound'
  OR source_row.message_family IS DISTINCT FROM 'PRODAT' OR source_row.message_standard IS DISTINCT FROM 'edifact'
  OR source_row.raw_payload IS DISTINCT FROM raw OR source_original.raw_payload IS DISTINCT FROM raw
  OR source_original.payload_hash IS DISTINCT FROM source_hash OR source_original.message_code IS DISTINCT FROM source_row.message_code
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH' AND x#>>'{elements,2,0}'='PRODAT')<>1
  THEN RAISE EXCEPTION 'prodat_object_batch_ignored_same_source_required';END IF;
 application:=gridex_received_sources.require_prodat_application_objects_v1(source_company,source_id);
 IF application->>'sourcePayloadHash' IS DISTINCT FROM source_hash
  OR (SELECT count(*) FROM jsonb_array_elements(application->'objects')x WHERE x=own)<>1
  THEN RAISE EXCEPTION 'prodat_object_batch_ignored_same_application_required';END IF;
 SELECT * INTO ignored FROM gridex_received_sources.prodat_ignored_field_facets WHERE canonical_assessment_id=(application->>'assessmentId')::uuid
  AND company_id=source_company AND environment=source_row.environment AND source_message_id=source_id AND source_payload_hash=source_hash;
 IF ignored.canonical_assessment_id IS NULL OR ignored.fields_hash IS DISTINCT FROM encode(sha256(convert_to(ignored.fields_text,'UTF8')),'hex')
  OR octet_length(ignored.fields_text)>262144 THEN RAISE EXCEPTION 'prodat_object_batch_ignored_canonical_facet_required';END IF;
 fields:=ignored.fields_text::jsonb;
 IF jsonb_typeof(fields) IS DISTINCT FROM 'array' OR jsonb_array_length(fields)>8192
  OR (SELECT count(*) FROM jsonb_array_elements(fields)x)<>(SELECT count(DISTINCT x) FROM jsonb_array_elements(fields)x)
  THEN RAISE EXCEPTION 'prodat_object_batch_ignored_field_scope_invalid';END IF;
 FOR field IN SELECT value FROM jsonb_array_elements(fields) LOOP
  occ:=field->'occurrence';
  IF jsonb_typeof(field) IS DISTINCT FROM 'object' OR field-ARRAY['fieldNumber','sourceRule','occurrence']<>'{}'::jsonb
   OR jsonb_typeof(field->'fieldNumber') IS DISTINCT FROM 'string' OR nullif(btrim(field->>'fieldNumber'),'') IS NULL
   OR field->>'sourceRule' IS DISTINCT FROM 'PRODAT26A:P119' OR jsonb_typeof(occ) IS DISTINCT FROM 'object'
   OR NOT(occ ?& ARRAY['scope','messageReference','lineIndex','lineNumber','registerPosition','objectId','identityAgency','lineItemReference','ownReferences'])
   OR occ-ARRAY['scope','messageReference','lineIndex','lineNumber','registerPosition','objectId','identityAgency','lineItemReference','ownReferences']<>'{}'::jsonb
   OR (occ->>'scope' IN('header','object','register')) IS NOT TRUE
   OR occ->>'messageReference' IS DISTINCT FROM own->>'messageReference'
   OR occ->>'messageReference' IS DISTINCT FROM (SELECT x#>>'{elements,1,0}' FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='UNH')
   THEN RAISE EXCEPTION 'prodat_object_batch_ignored_field_scope_invalid';END IF;
  IF occ->>'scope'='header' THEN
   IF occ->'lineIndex' IS DISTINCT FROM 'null'::jsonb OR occ->'lineNumber' IS DISTINCT FROM 'null'::jsonb
    OR occ->'registerPosition' IS DISTINCT FROM 'null'::jsonb OR occ->'objectId' IS DISTINCT FROM 'null'::jsonb
    OR occ->'identityAgency' IS DISTINCT FROM 'null'::jsonb OR occ->'lineItemReference' IS DISTINCT FROM 'null'::jsonb
    OR occ ? 'ownReferences' AND occ->'ownReferences' IS DISTINCT FROM jsonb_build_object('objectId',jsonb_build_object('kind','unavailable'),'lineItemReference',jsonb_build_object('kind','unavailable'),'customerId',jsonb_build_object('kind','unavailable'))
    THEN RAISE EXCEPTION 'prodat_object_batch_ignored_field_physical_scope_invalid';END IF;
   CONTINUE;
  END IF;
  IF jsonb_typeof(occ->'lineIndex') IS DISTINCT FROM 'number' OR (occ->>'lineIndex'~'^[0-9]+$') IS NOT TRUE
   THEN RAISE EXCEPTION 'prodat_object_batch_ignored_field_physical_scope_invalid';END IF;
  SELECT x INTO physical FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='LIN'
   AND (SELECT count(*) FROM jsonb_array_elements(tokens)prior WHERE prior->>'tag'='LIN' AND (prior->>'index')::int<(x->>'index')::int)=(occ->>'lineIndex')::int;
  SELECT o,r INTO owner_object,owner_register FROM jsonb_array_elements(application->'objects')o CROSS JOIN LATERAL jsonb_array_elements(o->'registers')r
   WHERE o->>'objectId'=occ->>'objectId' AND o->>'identityAgency'=occ->>'identityAgency' AND o->>'messageReference'=occ->>'messageReference' AND r->'lineIndex'=occ->'lineIndex';
  IF physical IS NULL OR owner_object IS NULL OR physical#>>'{elements,1,0}' IS DISTINCT FROM occ->>'lineNumber'
   OR physical#>>'{elements,3,0}' IS DISTINCT FROM occ->>'objectId' OR physical#>>'{elements,3,3}' IS DISTINCT FROM occ->>'identityAgency'
   OR owner_register->'segmentIndex' IS DISTINCT FROM physical->'index' OR owner_register->'lineNumber' IS DISTINCT FROM occ->'lineNumber'
   OR owner_register->'registerPosition' IS DISTINCT FROM occ->'registerPosition'
   THEN RAISE EXCEPTION 'prodat_object_batch_ignored_field_physical_scope_invalid';END IF;
  first_owner_index:=(owner_object#>>'{registers,0,segmentIndex}')::int;
  SELECT min((x->>'index')::int) INTO first_owner_end FROM jsonb_array_elements(tokens)x WHERE x->>'tag' IN('LIN','UNT') AND(x->>'index')::int>first_owner_index;
  SELECT min((x->>'index')::int) INTO first_party_index FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='NAD' AND(x->>'index')::int>first_owner_index AND(x->>'index')::int<first_owner_end;
  SELECT count(*),min(nullif(x#>>'{elements,1,1}','')) INTO li_count,li FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='LI'
   AND(x->>'index')::int>first_owner_index AND(x->>'index')::int<coalesce(first_party_index,first_owner_end);
  SELECT count(*),min(nullif(x#>>'{elements,2,0}','')) INTO customer_count,customer_ref FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='UD'
   AND(x->>'index')::int>first_owner_index AND(x->>'index')::int<first_owner_end;
  refs:=jsonb_build_object('objectId',jsonb_build_object('kind','present','value',owner_object->>'objectId'),
   'lineItemReference',CASE WHEN li_count>1 THEN jsonb_build_object('kind','unavailable') WHEN li IS NULL THEN jsonb_build_object('kind','absent') ELSE jsonb_build_object('kind','present','value',li) END,
   'customerId',CASE WHEN customer_count>1 THEN jsonb_build_object('kind','unavailable') WHEN customer_ref IS NULL THEN jsonb_build_object('kind','absent') ELSE jsonb_build_object('kind','present','value',customer_ref) END);
  IF occ->>'lineItemReference' IS DISTINCT FROM (CASE WHEN li_count=1 THEN li END)
   OR occ ? 'ownReferences' AND occ->'ownReferences' IS DISTINCT FROM refs
   THEN RAISE EXCEPTION 'prodat_object_batch_ignored_field_physical_scope_invalid';END IF;
  -- Valid other-object/register entries are nonmatching, never global errors.
  IF owner_object=own AND occ->'lineIndex'=own#>'{registers,0,lineIndex}' AND (physical->>'index')::int=first_index THEN
   own_fields:=array_append(own_fields,field->>'fieldNumber');
  END IF;
 END LOOP;
 -- Consume canonical decisions without another subtype classifier.
 IF 'END_USER_GROUP'=ANY(own_fields) THEN ud:=NULL;
 ELSE
  IF '227'=ANY(own_fields) THEN ud:=jsonb_set(ud,'{2}','[]'::jsonb);END IF;
  IF '228'=ANY(own_fields) THEN ud:=jsonb_set(ud,'{4}','[]'::jsonb);END IF;
 END IF;
 IF 'INSTALLATION_GROUP'=ANY(own_fields) THEN it:=NULL;
 ELSE
  IF '234'=ANY(own_fields) THEN it:=jsonb_set(it,'{5}','[]'::jsonb);END IF;
  IF '235'=ANY(own_fields) THEN it:=jsonb_set(it,'{8}','[]'::jsonb);END IF;
  IF '236'=ANY(own_fields) THEN it:=jsonb_set(it,'{6}','[]'::jsonb);END IF;
  IF '237'=ANY(own_fields) THEN it:=jsonb_set(it,'{9}','[]'::jsonb);END IF;
 END IF;
 IF '319'=ANY(own_fields) THEN reference:=NULL;END IF;
 IF area IS NOT NULL THEN SELECT id INTO grid_id FROM public.grid_owners WHERE company_id=(command->>'company_id')::uuid AND owner_code=area FOR SHARE;
  IF (SELECT count(*) FROM public.grid_owners WHERE company_id=(command->>'company_id')::uuid AND owner_code=area)>1 THEN RAISE EXCEPTION 'prodat_object_batch_grid_namespace_ambiguous';END IF;END IF;
 IF command#>'{site,grid_owner_id}' IS NOT NULL AND command#>'{site,grid_owner_id}' IS DISTINCT FROM coalesce(to_jsonb(grid_id::text),'null'::jsonb) OR command#>'{metering_point,grid_owner_id}' IS NOT NULL AND command#>'{metering_point,grid_owner_id}' IS DISTINCT FROM coalesce(to_jsonb(grid_id::text),'null'::jsonb) THEN RAISE EXCEPTION 'prodat_object_batch_wire_grid_owner_required';END IF;
 SELECT string_agg(btrim(v#>>'{}'),E'\n' ORDER BY ord) INTO name FROM jsonb_array_elements(coalesce(ud->4,'[]')) WITH ORDINALITY n(v,ord) WHERE ord<=2 AND btrim(v#>>'{}')<>'';
 is_business:=ud#>>'{2,1}'='SE1';
 IF ud#>>'{2,0}'~'^[0-9]+([-+][0-9]+)?$' THEN
  IF ud#>>'{2,1}'='SE1' THEN org:=regexp_replace(ud#>>'{2,0}','[^0-9]','','g');ELSIF ud#>>'{2,1}'='SE2' THEN personal:=regexp_replace(ud#>>'{2,0}','[^0-9]','','g');END IF;
 END IF;
 expected:=jsonb_build_object('customer_type',CASE WHEN is_business THEN 'business' ELSE 'private' END,'full_name',coalesce(name,'Ediel inbound-kund'),'company_name',CASE WHEN is_business THEN name END,
  'first_name',CASE WHEN NOT coalesce(is_business,false) THEN split_part(name,' ',1) END,'last_name',CASE WHEN NOT coalesce(is_business,false) THEN nullif(substr(name,strpos(name,' ')+1),name) END,'personal_number',personal,'org_number',org);
 FOR key,field_value IN SELECT * FROM jsonb_each(command->'customer') LOOP
  IF expected ? key AND field_value IS DISTINCT FROM expected->key THEN RAISE EXCEPTION 'prodat_object_batch_wire_customer_required';END IF;
  IF NOT(expected ? key) AND key NOT IN('status','source','metadata','created_by','updated_by') THEN RAISE EXCEPTION 'prodat_object_batch_customer_field_not_source_bound';END IF;
  IF key='status' AND field_value IS DISTINCT FROM '"draft"'::jsonb OR key='source' AND field_value IS DISTINCT FROM '"ediel_inbound"'::jsonb THEN RAISE EXCEPTION 'prodat_object_batch_customer_binding_required';END IF;
  IF key IN('created_by','updated_by') AND field_value IS DISTINCT FROM to_jsonb(actor::text) THEN RAISE EXCEPTION 'prodat_object_batch_actor_required';END IF;
 END LOOP;
 expected:=jsonb_build_object('site_name','Ediel '||(own->>'objectId'),'facility_id',own->>'objectId','site_type',CASE WHEN product='L641Q' THEN 'production' ELSE 'consumption' END,
  'street',CASE WHEN it IS NOT NULL AND NOT('234'=ANY(own_fields)) THEN array_to_string(ARRAY(SELECT btrim(v#>>'{}') FROM jsonb_array_elements(it->5) WITH ORDINALITY a(v,ord) WHERE ord<=3 AND btrim(v#>>'{}')<>''),E'\n') END,
  'postal_code',nullif(it#>>'{8,0}',''),'city',nullif(it#>>'{6,0}',''),'country',coalesce(nullif(it#>>'{9,0}',''),'SE'),
  'annual_consumption_kwh',CASE WHEN qty IS NOT NULL THEN replace(qty,',','.')::numeric END,'move_in_date',CASE WHEN start_day IS NOT NULL THEN substr(start_day,1,4)||'-'||substr(start_day,5,2)||'-'||substr(start_day,7,2) END);
 FOR key,field_value IN SELECT * FROM jsonb_each(command->'site') LOOP
  IF expected ? key AND field_value IS DISTINCT FROM expected->key THEN RAISE EXCEPTION 'prodat_object_batch_wire_site_required';END IF;
  IF key='status' AND field_value IS DISTINCT FROM '"draft"'::jsonb OR key IN('created_by','updated_by') AND field_value IS DISTINCT FROM to_jsonb(actor::text) THEN RAISE EXCEPTION 'prodat_object_batch_actor_required';END IF;
  IF NOT(expected ? key) AND key NOT IN('status','grid_owner_id','internal_notes','created_by','updated_by') THEN RAISE EXCEPTION 'prodat_object_batch_site_field_not_source_bound';END IF;
 END LOOP;
 expected:=jsonb_build_object('meter_point_id',own->>'objectId','metering_point_id',own->>'objectId','site_facility_id',own->>'objectId','ediel_reference',reference,
  'measurement_type',CASE WHEN product='L641Q' THEN 'production' ELSE 'consumption' END,'reading_frequency',CASE frequency WHEN 'D' THEN 'daily' WHEN 'M' THEN 'monthly' ELSE 'hourly' END,
  'start_date',CASE WHEN start_day IS NOT NULL THEN substr(start_day,1,4)||'-'||substr(start_day,5,2)||'-'||substr(start_day,7,2) END,'is_settlement_relevant',true);
 FOR key,field_value IN SELECT * FROM jsonb_each(command->'metering_point') LOOP
  IF expected ? key AND field_value IS DISTINCT FROM expected->key THEN RAISE EXCEPTION 'prodat_object_batch_wire_meter_required';END IF;
  IF key='status' AND field_value IS DISTINCT FROM '"draft"'::jsonb OR key IN('created_by','updated_by') AND field_value IS DISTINCT FROM to_jsonb(actor::text) THEN RAISE EXCEPTION 'prodat_object_batch_actor_required';END IF;
  IF NOT(expected ? key) AND key NOT IN('status','grid_owner_id','created_by','updated_by') THEN RAISE EXCEPTION 'prodat_object_batch_meter_field_not_source_bound';END IF;
 END LOOP;
END $projection_current$;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'ops_compact_transport_postgres_execution_required'; END IF;
 IF to_regclass('ops_api_atomic_transport_bb0bd0ce.payload_parts') IS NULL THEN RAISE EXCEPTION 'ops_compact_transport_staged_source_required'; END IF;
 LOCK TABLE ops_api_atomic_transport_bb0bd0ce.payload_parts IN ACCESS EXCLUSIVE MODE;
 
 IF NOT EXISTS (SELECT FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce' AND nspowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND nspacl=acldefault('n',(SELECT oid FROM pg_roles WHERE rolname='postgres'))) THEN RAISE EXCEPTION 'ops_compact_transport_schema_metadata_unknown'; END IF;
 IF EXISTS(SELECT FROM pg_namespace n CROSS JOIN pg_roles r WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce' AND r.rolname IN ('anon','authenticated','service_role','authenticator') AND (has_schema_privilege(r.rolname::text,n.oid,'USAGE') OR has_schema_privilege(r.rolname::text,n.oid,'CREATE') OR pg_has_role(r.rolname::text,'postgres','MEMBER') OR pg_has_role(r.rolname::text,'postgres','SET') OR pg_has_role(r.rolname::text,'postgres','USAGE'))) THEN RAISE EXCEPTION 'ops_compact_transport_app_privilege_forbidden'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce')<>2 OR NOT EXISTS(SELECT FROM pg_class c WHERE c.oid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND c.relkind='r' AND c.relpersistence='p' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND c.relrowsecurity AND c.relforcerowsecurity AND c.relacl=acldefault('r',c.relowner) AND c.reloptions IS NULL AND c.relam=(SELECT oid FROM pg_am WHERE amname='heap')) THEN RAISE EXCEPTION 'ops_compact_transport_relation_metadata_unknown'; END IF;
 IF EXISTS(SELECT FROM pg_depend d WHERE d.refclassid='pg_namespace'::regclass AND d.refobjid=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce') AND NOT ((d.classid='pg_class'::regclass AND d.objid IN ('ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass,'ops_api_atomic_transport_bb0bd0ce.payload_parts_pkey'::regclass)) OR (d.classid='pg_type'::regclass AND d.objid IN ('ops_api_atomic_transport_bb0bd0ce.payload_parts'::regtype,'ops_api_atomic_transport_bb0bd0ce._payload_parts'::regtype)))) THEN RAISE EXCEPTION 'ops_compact_transport_unexpected_namespace_object'; END IF;
 IF EXISTS(SELECT FROM pg_attribute WHERE attrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND attacl IS NOT NULL) THEN RAISE EXCEPTION 'ops_compact_transport_column_acl_forbidden'; END IF;
 IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce') OR EXISTS(SELECT FROM pg_policy WHERE polrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_trigger WHERE tgrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_rewrite WHERE ev_class='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_inherits WHERE inhrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass OR inhparent='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_attrdef WHERE adrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) THEN RAISE EXCEPTION 'ops_compact_transport_extra_metadata_forbidden'; END IF;
 IF (SELECT jsonb_agg(jsonb_build_object('name',attname,'type',atttypid::regtype::text,'number',attnum,'notnull',attnotnull,'typmod',atttypmod,'identity',attidentity,'generated',attgenerated,'collation',attcollation::regcollation::text,'acl',attacl::text,'options',attoptions,'fdwoptions',attfdwoptions,'storage',attstorage,'compression',attcompression,'local',attislocal,'inheritance',attinhcount) ORDER BY attnum) FROM pg_attribute WHERE attrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND attnum>0) IS DISTINCT FROM '[{"name":"ordinal","type":"integer","number":1,"notnull":true,"typmod":-1,"identity":"","generated":"","collation":"-","acl":null,"options":null,"fdwoptions":null,"storage":"p","compression":"","local":true,"inheritance":0},{"name":"payload","type":"text","number":2,"notnull":true,"typmod":-1,"identity":"","generated":"","collation":"\"default\"","acl":null,"options":null,"fdwoptions":null,"storage":"x","compression":"","local":true,"inheritance":0}]'::jsonb THEN RAISE EXCEPTION 'ops_compact_transport_column_metadata_unknown'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass)<>1 OR NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND conname='payload_parts_pkey' AND contype='p' AND conkey=ARRAY[1]::smallint[] AND NOT condeferrable AND NOT condeferred AND convalidated AND conislocal AND coninhcount=0 AND conparentid=0 AND pg_get_constraintdef(oid)='PRIMARY KEY (ordinal)') THEN RAISE EXCEPTION 'ops_compact_transport_constraint_metadata_unknown'; END IF;
 IF NOT EXISTS(SELECT FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.oid='ops_api_atomic_transport_bb0bd0ce.payload_parts_pkey'::regclass AND c.relkind='i' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND c.relacl IS NULL AND c.reloptions IS NULL AND c.relpersistence='p' AND i.indrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND i.indisunique AND i.indisprimary AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate AND NOT i.indisexclusion AND NOT i.indisclustered AND NOT i.indisreplident AND NOT i.indnullsnotdistinct AND i.indnatts=1 AND i.indnkeyatts=1 AND i.indkey='1'::int2vector AND i.indcollation='0'::oidvector AND i.indoption='0'::int2vector AND i.indclass=(SELECT oid::text::oidvector FROM pg_opclass WHERE opcnamespace='pg_catalog'::regnamespace AND opcname='int4_ops' AND opcmethod=(SELECT oid FROM pg_am WHERE amname='btree')) AND i.indexprs IS NULL AND i.indpred IS NULL AND pg_get_indexdef(c.oid)='CREATE UNIQUE INDEX payload_parts_pkey ON ops_api_atomic_transport_bb0bd0ce.payload_parts USING btree (ordinal)') THEN RAISE EXCEPTION 'ops_compact_transport_index_metadata_unknown'; END IF;
 IF (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce')<>2 OR NOT EXISTS(SELECT FROM pg_type WHERE typnamespace=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce') AND typname='payload_parts' AND typtype='c' AND typrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND typowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND typacl IS NULL) OR NOT EXISTS(SELECT FROM pg_type WHERE typnamespace=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce') AND typname='_payload_parts' AND typtype='b' AND typelem='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regtype AND typowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND typacl IS NULL) THEN RAISE EXCEPTION 'ops_compact_transport_type_metadata_unknown'; END IF;
 IF EXISTS(SELECT FROM pg_depend WHERE deptype='e' AND ((classid='pg_namespace'::regclass AND objid=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce')) OR (classid='pg_class'::regclass AND objid IN ('ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass,'ops_api_atomic_transport_bb0bd0ce.payload_parts_pkey'::regclass)))) THEN RAISE EXCEPTION 'ops_compact_transport_extension_membership_forbidden'; END IF;
 IF EXISTS(SELECT FROM ops_api_atomic_transport_bb0bd0ce.payload_parts p LEFT JOIN (VALUES (1,80547,'aeac6d55ebfafc9c0d5ad30bf4dad37178fd46d9e52f43c846612fac1cc0b073'),(2,80547,'1056f8241fab935b5b36174658b4566d6562e7980f66a4f62399137708480f55'),(3,80547,'8d7736d9c18f0ec7e02c421907daf0f254ee9fe54aa61353e13d6827c8443f73'),(4,80547,'1f375fd1052f325b5a2e23f1c0a87d7a5c4c0c39c84b01ad6afa154865ecafc7'),(5,80547,'7ec7255e4de7f738c33eb48119de9d7d4dcbb2ed542e9136f9165824edc352c1'),(6,80547,'6e3ba08e32dd8605bd8a2378ba6cdfcec4d513eafdf55bd3fc2940b96dfa9749'),(7,80547,'7e941361061f7515bce84fb77b83f10c7dd1814356ac762bf12856d37abb4d2a'),(8,80547,'929b535701f910a90c5a2ead0a1a501bc631a04ecabc2b779c9a7286e25064f7'),(9,80547,'32b289b55a734020b96487e5498b908b8d1978a4878e8ab3470e0e73c6bdce5e'),(10,80547,'d0ca52a50e80383ced15051bcba9ca7e24e69858fa0be512c40cd4fbc6e975c3'),(11,80547,'e7773322ceb01f55240b0372e3ee234bb9cfd7bc8d8c572c867c585ee4bb76e7'),(12,80536,'8e9a209d6d969d1fc0435bcb564c05f54400a9faaf58ee4dcd3373d3013f91fa')) expected(ordinal,byte_count,digest) USING(ordinal) WHERE expected.ordinal IS NULL OR octet_length(convert_to(p.payload,'UTF8'))<>expected.byte_count OR encode(sha256(convert_to(p.payload,'UTF8')),'hex')<>expected.digest) THEN RAISE EXCEPTION 'ops_compact_transport_part_bytes_unknown'; END IF;

 IF (SELECT count(*) FROM ops_api_atomic_transport_bb0bd0ce.payload_parts)<>12 THEN RAISE EXCEPTION 'ops_compact_transport_all_parts_required'; END IF;
 SELECT convert_to(string_agg(payload,'' ORDER BY ordinal),'UTF8') INTO raw FROM ops_api_atomic_transport_bb0bd0ce.payload_parts;
 IF octet_length(raw)<>966553 OR encode(sha256(raw),'hex')<>'bb0bd0cedeabc3ba40872eae8cead8b6a8a9ff298c567baa324a1b4044045b04' THEN RAISE EXCEPTION 'ops_compact_transport_full_source_mismatch'; END IF;
 IF substring(raw from 80 for 6)<>convert_to('BEGIN;','UTF8') OR substring(raw from 966546 for 7)<>convert_to('COMMIT;','UTF8') THEN RAISE EXCEPTION 'ops_compact_transport_outer_transaction_tokens_unknown'; END IF;
 executable:=substring(raw from 1 for 79) || substring(raw from 86 for 966460) || substring(raw from 966553);
 IF octet_length(executable)<>966540 OR encode(sha256(executable),'hex')<>'af1652d62cadee0e0184af0574342c0d5104982705eab5b100c51fdf90afc02b' THEN RAISE EXCEPTION 'ops_compact_transport_executable_mismatch'; END IF;


 LOCK TABLE ops_api_sql_transport_20261013.payload_parts IN ACCESS EXCLUSIVE MODE;
 
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_namespace n WHERE n.nspname='ops_api_sql_transport_20261013' AND n.nspowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres')) THEN RAISE EXCEPTION 'ops_sql_transport_schema_owner_drift'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_namespace n CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a WHERE n.nspname='ops_api_sql_transport_20261013' AND (a.grantee<>n.nspowner OR a.grantor<>n.nspowner OR a.is_grantable)) THEN RAISE EXCEPTION 'ops_sql_transport_schema_acl_drift'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_roles r WHERE r.rolname IN('anon','authenticated','service_role') AND pg_catalog.pg_has_role(r.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres'),'MEMBER')) THEN RAISE EXCEPTION 'ops_sql_transport_app_owner_membership'; END IF;
 IF (SELECT array_agg(c.relname||':'||c.relkind::text ORDER BY c.relname COLLATE "C") FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ops_api_sql_transport_20261013') IS DISTINCT FROM ARRAY['payload_parts:r','payload_parts_pkey:i']::text[] THEN RAISE EXCEPTION 'ops_sql_transport_relation_set_drift'; END IF;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_class c WHERE c.oid='ops_api_sql_transport_20261013.payload_parts'::regclass AND c.relkind='r' AND c.relpersistence='p' AND c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres') AND c.relrowsecurity AND c.relforcerowsecurity AND NOT c.relispartition AND c.reltablespace=0 AND c.reloptions IS NULL AND c.relam=(SELECT oid FROM pg_catalog.pg_am WHERE amname='heap')) THEN RAISE EXCEPTION 'ops_sql_transport_table_shape_drift'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a WHERE c.oid='ops_api_sql_transport_20261013.payload_parts'::regclass AND (a.grantee<>c.relowner OR a.grantor<>c.relowner OR a.is_grantable)) THEN RAISE EXCEPTION 'ops_sql_transport_table_acl_drift'; END IF;
 IF (SELECT jsonb_agg(jsonb_build_array(a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid='ops_api_sql_transport_20261013.payload_parts'::regclass AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '[["part_no","integer",true,"",""],["payload","bytea",true,"",""],["part_sha256","text",true,"",""]]'::jsonb OR EXISTS(SELECT FROM pg_catalog.pg_attribute WHERE attrelid='ops_api_sql_transport_20261013.payload_parts'::regclass AND attnum>0 AND (attisdropped OR atthasdef OR attacl IS NOT NULL)) THEN RAISE EXCEPTION 'ops_sql_transport_column_drift'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_attribute a WHERE a.attrelid='ops_api_sql_transport_20261013.payload_parts'::regclass AND a.attnum>0 AND (a.attndims<>0 OR a.atttypmod<>-1 OR a.attcompression<>'' OR a.atttypid<>CASE a.attname WHEN 'part_no' THEN 'pg_catalog.int4'::regtype WHEN 'payload' THEN 'pg_catalog.bytea'::regtype WHEN 'part_sha256' THEN 'pg_catalog.text'::regtype ELSE 0::oid END OR a.attcollation<>CASE WHEN a.attname='part_sha256' THEN 'pg_catalog."default"'::regcollation ELSE 0::oid END OR a.attstorage<>CASE WHEN a.attname='part_no' THEN 'p'::"char" ELSE 'x'::"char" END)) THEN RAISE EXCEPTION 'ops_sql_transport_column_type_collation_drift'; END IF;
 IF (SELECT jsonb_agg(jsonb_build_array(c.conname,c.contype,pg_catalog.pg_get_constraintdef(c.oid,false),c.convalidated,c.condeferrable,c.condeferred) ORDER BY c.conname COLLATE "C") FROM pg_catalog.pg_constraint c WHERE c.conrelid='ops_api_sql_transport_20261013.payload_parts'::regclass) IS DISTINCT FROM '[["payload_parts_pkey","p","PRIMARY KEY (part_no)",true,false,false]]'::jsonb THEN RAISE EXCEPTION 'ops_sql_transport_constraint_drift'; END IF;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_index i WHERE i.indexrelid='ops_api_sql_transport_20261013.payload_parts_pkey'::regclass AND i.indrelid='ops_api_sql_transport_20261013.payload_parts'::regclass AND i.indisprimary AND i.indisunique AND i.indisvalid AND i.indisready AND i.indexprs IS NULL AND i.indpred IS NULL AND pg_catalog.pg_get_indexdef(i.indexrelid)='CREATE UNIQUE INDEX payload_parts_pkey ON ops_api_sql_transport_20261013.payload_parts USING btree (part_no)') THEN RAISE EXCEPTION 'ops_sql_transport_index_drift'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_trigger WHERE tgrelid='ops_api_sql_transport_20261013.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_catalog.pg_policy WHERE polrelid='ops_api_sql_transport_20261013.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_catalog.pg_rewrite WHERE ev_class='ops_api_sql_transport_20261013.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_catalog.pg_inherits WHERE inhrelid='ops_api_sql_transport_20261013.payload_parts'::regclass OR inhparent='ops_api_sql_transport_20261013.payload_parts'::regclass) THEN RAISE EXCEPTION 'ops_sql_transport_execution_adjunct_drift'; END IF;
 IF (SELECT array_agg(t.typname||':'||t.typtype::text ORDER BY t.typname COLLATE "C") FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='ops_api_sql_transport_20261013') IS DISTINCT FROM ARRAY['_payload_parts:b','payload_parts:c']::text[] THEN RAISE EXCEPTION 'ops_sql_transport_type_set_drift'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='ops_api_sql_transport_20261013' AND t.typowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres')) OR EXISTS(SELECT FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ops_api_sql_transport_20261013' AND c.relowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres')) THEN RAISE EXCEPTION 'ops_sql_transport_internal_owner_drift'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ops_api_sql_transport_20261013') OR EXISTS(SELECT FROM pg_catalog.pg_operator p JOIN pg_catalog.pg_namespace n ON n.oid=p.oprnamespace WHERE n.nspname='ops_api_sql_transport_20261013') OR EXISTS(SELECT FROM pg_catalog.pg_collation p JOIN pg_catalog.pg_namespace n ON n.oid=p.collnamespace WHERE n.nspname='ops_api_sql_transport_20261013') OR EXISTS(SELECT FROM pg_catalog.pg_conversion p JOIN pg_catalog.pg_namespace n ON n.oid=p.connamespace WHERE n.nspname='ops_api_sql_transport_20261013') OR EXISTS(SELECT FROM pg_catalog.pg_statistic_ext p JOIN pg_catalog.pg_namespace n ON n.oid=p.stxnamespace WHERE n.nspname='ops_api_sql_transport_20261013') OR EXISTS(SELECT FROM pg_catalog.pg_ts_config p JOIN pg_catalog.pg_namespace n ON n.oid=p.cfgnamespace WHERE n.nspname='ops_api_sql_transport_20261013') OR EXISTS(SELECT FROM pg_catalog.pg_ts_dict p JOIN pg_catalog.pg_namespace n ON n.oid=p.dictnamespace WHERE n.nspname='ops_api_sql_transport_20261013') OR EXISTS(SELECT FROM pg_catalog.pg_ts_parser p JOIN pg_catalog.pg_namespace n ON n.oid=p.prsnamespace WHERE n.nspname='ops_api_sql_transport_20261013') OR EXISTS(SELECT FROM pg_catalog.pg_ts_template p JOIN pg_catalog.pg_namespace n ON n.oid=p.tmplnamespace WHERE n.nspname='ops_api_sql_transport_20261013') THEN RAISE EXCEPTION 'ops_sql_transport_unknown_namespace_object'; END IF;

 IF (SELECT array_agg(part_no ORDER BY part_no) FROM ops_api_sql_transport_20261013.payload_parts) IS DISTINCT FROM ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51]::integer[] THEN RAISE EXCEPTION 'ops_sql_transport_missing_or_extra_parts'; END IF;
 IF EXISTS(WITH expected(part_no,bytes,sha256) AS(VALUES (1,131072,'975ae1b44340f10fb267fc9f9fa83b56101058af4f39edd76315e12a98ee47e1'),(2,131072,'b5f7727500caac93ba814b972e35f33a89143645885293651fe3c79d6370e1e1'),(3,131072,'76d7020bb5bbc19978b8dcd77dca6918db6e1e6cb5c77a357aa7d2385eb8d00d'),(4,131072,'379f99bc8633ea6bd3a8115594a6cc3fd6917f6ee769f7597bf2ca023412764f'),(5,131072,'367b445e0ac19d843b623e78940562d8ac399502ef92641b08fa7a7f68106b2c'),(6,131072,'d3fe3f36d73e639f4c0c6cd24b9f9b98ae96f5c0850e545b2075d83c797f38e2'),(7,131072,'daa468f5fa1569a26edb3513dd1cf47d019f3763eb3accacae2448ff1dd236b3'),(8,131072,'6d64bca32664a4a605829dd4618b80aea9b21066a251769540b3def1b8139a3a'),(9,131072,'0a2204d709ff773038b93080ff01bd438cebf206311ceae62ec704570892e624'),(10,131072,'ec0a36a06cadfad185335166bbed0a8d84e46220312daa33b00ad7d9859a622a'),(11,131072,'949ac1fea5271c12a63a4845bad0789f94de8b06ea9e93390730d93174e66142'),(12,131072,'96f46c6616d171f61661ec20ea02492e5e46d872f2a8df0f2fc48a62480a94c2'),(13,131072,'db6b0941991a3029285d6ce31a6264808c44bac65b9133f4d1d3bb61bac2ec15'),(14,131072,'4cfc9c9b2bd20df2afbc170f48d183c792624fd3dd106ca78d79f7b7b4ef1b66'),(15,131072,'e0ec1160ac01cb5186ea02cd6f342b8793c929ddf88d80c90b033defd05f115c'),(16,131072,'638757110b1887c5c7ee8b7f5708e221eef56e9747520e9e49d2919b774294f7'),(17,131072,'4a616a8a2ed6642a495cdd564740c43e2e7c4cd465a7b175620719fffdb356ed'),(18,131072,'a092ec77cc8d85508deac6b1441b353ceea7b77506c68af524c2769bad2dc475'),(19,131072,'cd35d674541a0987fc05b46dd30176465e63bea6ff198b0e670d2bd2b750a7a3'),(20,131072,'d2b0257ce4ae0ebeda2bd44f86be37dfb978d08f2d30652acac06ff33321440e'),(21,131072,'b80aeb275935b572b9009b55e11015a2ee8aeeb9f32d927227d1842ea62513ba'),(22,131072,'3dd09640a52db6a3df1c00ebc7f505eea11df2d7ecb47bc8d83d07b643492780'),(23,131072,'5b96eb93808909de88b684957e7dfb7a6765e6f55da1f28b8f7b09f8e0e358de'),(24,131072,'8902effd972edc277276adff32fe7d0ec9520795935348469531321607c8abd4'),(25,131072,'366cea81c8854c6c082799cfef99a87f28a3e7da2a813552eb699cebeb7ccbef'),(26,131072,'105ce2924fbe1ff0c01072b401779e29b3718436e1b3fa9a7a5a6854e0f4ceca'),(27,131072,'32c45b3c3a25352b9c6857d70051bd4b650b51aad8beb0619b87af758aa47955'),(28,131072,'e90ae558f5d7b00d1645e7518bd5443bba9326216300c767ff019ee2e0f25989'),(29,131072,'d432289f907c4997709539f40bf862789e5e7fa077f78ab7eaaa75d790697c60'),(30,131072,'77972b50e696f78cb35ebdbfa1aba84aafa6c94a1583f9ddfa465356eef7e859'),(31,131072,'ae8338aa6f98f25508d70d7eab513dd5967ce555919e08537d0979c60050375d'),(32,131072,'5d18d95b7fcd63c37abc4b1461d0d8db236a8d74291294663d574dec49ce7be8'),(33,131072,'9e0974c088c554260ce74fec70a136ac1dd13ddd76a947d4c7c605e6b0a21597'),(34,131072,'260d3801adbc656f3d6f89bf23240d89ab96c90b628c6ceb003232439a60bd39'),(35,131072,'63897df7625c6df36546d40ad1cd0184dbd32afbb968ce00b7a43de465e18a68'),(36,131072,'657f1cad607408b899977473e55343288afb47c89b2284efdd0ba49be4f0d0b2'),(37,131072,'d39c9cfe12977b9ef865abeea06ae9f98982702c9f562c519699407f0c6bb92b'),(38,131072,'ff5cb1bc019dae8a2c8b5d884fb205c1d5437e2993b368e38dbd38d603c38a2c'),(39,131072,'24acd1e8569241699adf0c4d2cb840d0844366154d6781195b3b5b2d74ef101a'),(40,131072,'3f504bb3aeb6be485653f0a0c1edc7427738c638ac31a4ecae91f80be1199450'),(41,131072,'1f62a9d60e5c47f3c80c6c271be51e6dd347c053bfec1e9e36400aff1680aae5'),(42,131072,'b33d05c36b269b642a78b38c54db8d53e3c0aa62fba9f067a7bd9624266b4153'),(43,131072,'3db4e0c7071cb62f931173a2a752b8f0890b1231f55abb65c95f62f57a206262'),(44,131072,'21b24221b75a4006d9bfc08ed924f3578194b06a010f3f3a76f6932d1873567d'),(45,131072,'d87accd2a00b1e08939e675561d7872905c4d1030ec8a0bc2dbec80681ba2b4e'),(46,131072,'d877792ae126077ec5fde37fbf52a63c8a7011b1c9a170b11daca694ddcc6514'),(47,131072,'b83b96202dad2e89e880121d05daffccfdbfdda3133e697e4b48c824bbd5c1b4'),(48,131072,'121d901dacfe95f9e6f0b88f628655f74ead7551ed6edbe7bb9eaaf7b2c54d03'),(49,131072,'b15c3964ae25614aa31dc515562ed4978f997d490f80c4093a9a360f24101aba'),(50,131072,'383ffd42a0b7eef5e7876538f3adc4fce8804b035af6f80376f44bf05559aa17'),(51,74749,'9e33e3f68244ba53c91980acbe295419819f334bd4dc1fcb599cf1ab4532f1e2')) SELECT FROM expected e LEFT JOIN ops_api_sql_transport_20261013.payload_parts p USING(part_no) WHERE pg_catalog.octet_length(p.payload) IS DISTINCT FROM e.bytes OR p.part_sha256 IS DISTINCT FROM e.sha256 OR pg_catalog.encode(pg_catalog.sha256(p.payload),'hex') IS DISTINCT FROM e.sha256) THEN RAISE EXCEPTION 'ops_sql_transport_part_hash_invalid'; END IF;
 SELECT pg_catalog.string_agg(payload,''::bytea ORDER BY part_no) INTO signing_source52 FROM ops_api_sql_transport_20261013.payload_parts;
 IF pg_catalog.octet_length(signing_source52)<>6628349 OR pg_catalog.encode(pg_catalog.sha256(signing_source52),'hex')<>'bacf8944718c984d117f0400ed19fadd978feed6613ea9196784eff4591ac600' THEN RAISE EXCEPTION 'ops_sql_transport_approved_source_hash_invalid'; END IF;


 signing_public:=to_regprocedure('public.gridex_prepare_customer_contract_signature_request_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text)');
 signing_core:=to_regprocedure('public.gridex_prepare_signature_before_record_retention_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text)');
 SELECT * INTO STRICT signing_public_before FROM pg_catalog.pg_proc WHERE oid=signing_public;
 SELECT * INTO STRICT signing_core_before FROM pg_catalog.pg_proc WHERE oid=signing_core;
 signing_public_definition:=pg_get_functiondef(signing_public);
 signing_core_definition:=pg_get_functiondef(signing_core);
 IF md5(signing_old)<>'2be908317a4861f6f38fcc293df30845'
 OR md5(signing_wrapper)<>'1496a94629cf9f43d9fbd5d7d0f3f8e5'
 OR md5(signing_cee)<>'cee1222f070383e440a9fd4f71cdf591'
 THEN RAISE EXCEPTION 'signing_atomic_literal_unknown'; END IF;
 IF signing_public_before.prosrc=signing_wrapper AND md5(signing_public_before.prosrc)='1496a94629cf9f43d9fbd5d7d0f3f8e5'
 AND signing_core_before.prosrc=signing_cee AND md5(signing_core_before.prosrc)='cee1222f070383e440a9fd4f71cdf591' THEN
  signing_profile:='canonical_wrapper';
 ELSIF signing_public_before.prosrc=signing_cee AND md5(signing_public_before.prosrc)='cee1222f070383e440a9fd4f71cdf591'
 AND md5(signing_public_definition)='0e6cbec5c3c542330d33e88be75ed060'
 AND signing_core_before.prosrc=signing_old AND md5(signing_core_before.prosrc)='2be908317a4861f6f38fcc293df30845' THEN
  signing_profile:='native_public_core';
 ELSE RAISE EXCEPTION 'signing_atomic_unknown_or_mixed_profile'; END IF;
 FOR signing_current IN SELECT p.* FROM pg_catalog.pg_proc p WHERE p.oid IN(signing_public,signing_core) LOOP
  signing_expected_acl:=CASE WHEN signing_current.oid=signing_public THEN ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[] ELSE ARRAY['postgres=X/postgres']::aclitem[] END;
  signing_expected_config:=CASE WHEN signing_current.oid=signing_public AND signing_profile='canonical_wrapper' THEN ARRAY['search_path=pg_catalog']::text[] ELSE ARRAY['search_path=public, private, extensions, pg_temp']::text[] END;
  IF pg_get_userbyid(signing_current.proowner) IS DISTINCT FROM 'postgres'
  OR signing_current.pronamespace IS DISTINCT FROM 'public'::regnamespace OR signing_current.prokind IS DISTINCT FROM 'f'::"char"
  OR signing_current.proacl IS DISTINCT FROM signing_expected_acl
  OR signing_current.proargtypes IS DISTINCT FROM ARRAY['uuid'::regtype::oid,'uuid'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'timestamptz'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid]::oidvector
  OR signing_current.pronargs IS DISTINCT FROM 8::smallint OR signing_current.proallargtypes IS NOT NULL OR signing_current.proargmodes IS NOT NULL
  OR signing_current.proargnames IS DISTINCT FROM ARRAY['p_company_id','p_customer_id','p_contract_id','p_token_hash','p_recipient_email','p_expires_at','p_actor_user_id','p_channel']::text[]
  OR signing_current.prorettype IS DISTINCT FROM 'jsonb'::regtype OR signing_current.proretset
  OR signing_current.pronargdefaults IS DISTINCT FROM 1::smallint OR pg_get_expr(signing_current.proargdefaults,0) IS DISTINCT FROM $signing_default$'internal'::text$signing_default$
  OR NOT signing_current.prosecdef OR signing_current.proisstrict OR signing_current.proleakproof
  OR signing_current.provolatile IS DISTINCT FROM 'v'::"char" OR signing_current.proparallel IS DISTINCT FROM 'u'::"char"
  OR signing_current.proconfig IS DISTINCT FROM signing_expected_config
  OR(SELECT lanname FROM pg_language WHERE oid=signing_current.prolang) IS DISTINCT FROM 'plpgsql'
  OR signing_current.procost IS DISTINCT FROM 100::real OR signing_current.prorows IS DISTINCT FROM 0::real
  OR signing_current.provariadic IS DISTINCT FROM 0::oid OR signing_current.prosupport IS DISTINCT FROM 0::oid
  OR signing_current.protrftypes IS NOT NULL OR signing_current.probin IS NOT NULL OR signing_current.prosqlbody IS NOT NULL
  THEN RAISE EXCEPTION 'signing_atomic_full_metadata_unknown'; END IF;
 END LOOP;
 -- Additional exact receipt/finalize profiles are qualified before any normalization.
 FOR extra_item IN SELECT value FROM jsonb_array_elements(extra_config) LOOP
  extra_public:=to_regprocedure(extra_item->>'public');extra_core:=to_regprocedure(extra_item->>'core');
  SELECT * INTO STRICT extra_public_before FROM pg_catalog.pg_proc WHERE oid=extra_public;
  SELECT * INTO STRICT extra_core_before FROM pg_catalog.pg_proc WHERE oid=extra_core;
  IF md5(extra_item->>'old') IS DISTINCT FROM extra_item->>'old_md5'
   OR md5(extra_item->>'canonical') IS DISTINCT FROM extra_item->>'canonical_md5'
   OR md5(extra_item->>'native') IS DISTINCT FROM extra_item->>'native_md5'
   OR md5(extra_item->>'wrapper') IS DISTINCT FROM extra_item->>'wrapper_md5'
   THEN RAISE EXCEPTION 'all_signing_atomic_literal_unknown';END IF;
  IF signing_profile='canonical_wrapper' THEN
   IF extra_public_before.prosrc IS DISTINCT FROM extra_item->>'wrapper'
    OR md5(extra_public_before.prosrc) IS DISTINCT FROM extra_item->>'wrapper_md5'
    OR extra_core_before.prosrc IS DISTINCT FROM extra_item->>'canonical'
    OR md5(extra_core_before.prosrc) IS DISTINCT FROM extra_item->>'canonical_md5'
    THEN RAISE EXCEPTION 'all_signing_atomic_unknown_canonical_pair:%',extra_item->>'core';END IF;
  ELSE
   IF extra_public_before.prosrc IS DISTINCT FROM extra_item->>'native'
    OR md5(extra_public_before.prosrc) IS DISTINCT FROM extra_item->>'native_md5'
    OR extra_core_before.prosrc IS DISTINCT FROM extra_item->>'old'
    OR md5(extra_core_before.prosrc) IS DISTINCT FROM extra_item->>'old_md5'
    THEN RAISE EXCEPTION 'all_signing_atomic_unknown_native_pair:%',extra_item->>'core';END IF;
  END IF;
  FOREACH extra_role IN ARRAY ARRAY['public','core'] LOOP
   extra_oid:=CASE WHEN extra_role='public' THEN extra_public ELSE extra_core END;
   SELECT * INTO STRICT extra_before FROM pg_catalog.pg_proc WHERE oid=extra_oid;
   extra_expected_acl:=CASE WHEN extra_role='public' THEN ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[] ELSE ARRAY['postgres=X/postgres']::aclitem[] END;
   extra_expected_config:=CASE WHEN extra_role='public' AND signing_profile='canonical_wrapper' THEN ARRAY['search_path=pg_catalog']::text[] ELSE ARRAY['search_path=public, extensions, pg_temp']::text[] END;
   IF pg_get_userbyid(extra_before.proowner) IS DISTINCT FROM 'postgres'
    OR extra_before.pronamespace IS DISTINCT FROM 'public'::regnamespace
    OR extra_before.proname IS DISTINCT FROM split_part(split_part(extra_item->>extra_role,'.',2),'(',1)
    OR extra_before.prokind IS DISTINCT FROM 'f'::"char" OR extra_before.proacl IS DISTINCT FROM extra_expected_acl
    OR extra_before.proargtypes IS DISTINCT FROM (CASE WHEN extra_item->>'kind'='receipt' THEN ARRAY['text'::regtype::oid]::oidvector ELSE ARRAY['text'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid]::oidvector END)
    OR extra_before.pronargs IS DISTINCT FROM (CASE WHEN extra_item->>'kind'='receipt' THEN 1::smallint ELSE 3::smallint END)
    OR extra_before.proallargtypes IS NOT NULL OR extra_before.proargmodes IS NOT NULL
    OR extra_before.proargnames IS DISTINCT FROM (CASE WHEN extra_item->>'kind'='receipt' THEN ARRAY['p_token_hash']::text[] ELSE ARRAY['p_token_hash','p_signed_ip_hash','p_signed_user_agent']::text[] END)
    OR extra_before.prorettype IS DISTINCT FROM 'jsonb'::regtype OR extra_before.proretset IS DISTINCT FROM false
    OR extra_before.pronargdefaults IS DISTINCT FROM (CASE WHEN extra_item->>'kind'='receipt' THEN 0::smallint ELSE 2::smallint END)
    OR pg_get_expr(extra_before.proargdefaults,0) IS DISTINCT FROM (CASE WHEN extra_item->>'kind'='receipt' THEN NULL::text ELSE 'NULL::text, NULL::text'::text END)
    OR extra_before.prosecdef IS DISTINCT FROM true OR extra_before.proisstrict IS DISTINCT FROM false OR extra_before.proleakproof IS DISTINCT FROM false
    OR extra_before.provolatile IS DISTINCT FROM 'v'::"char" OR extra_before.proparallel IS DISTINCT FROM 'u'::"char"
    OR extra_before.proconfig IS DISTINCT FROM extra_expected_config
    OR(SELECT lanname FROM pg_language WHERE oid=extra_before.prolang) IS DISTINCT FROM 'plpgsql'
    OR extra_before.procost IS DISTINCT FROM 100::real OR extra_before.prorows IS DISTINCT FROM 0::real
    OR extra_before.provariadic IS DISTINCT FROM 0::oid OR extra_before.prosupport IS DISTINCT FROM 0::oid
    OR extra_before.protrftypes IS NOT NULL OR extra_before.probin IS NOT NULL OR extra_before.prosqlbody IS NOT NULL
    THEN RAISE EXCEPTION 'all_signing_atomic_full_metadata_unknown:%',extra_item->>extra_role;END IF;
   extra_definition:=pg_get_functiondef(extra_oid);
   IF strpos(extra_definition,extra_before.prosrc)=0 THEN RAISE EXCEPTION 'all_signing_atomic_definition_unknown';END IF;
   extra_saved:=extra_saved||jsonb_build_array(jsonb_build_object('role',extra_role,'oid',extra_oid,'row',to_jsonb(extra_before),'definition',extra_definition,'old',extra_item->>'old','canonical',extra_item->>'canonical'));
  END LOOP;
 END LOOP;
 -- All additional profiles are known. Normalize only canonical renamed cores.
 FOR extra_snapshot IN SELECT value FROM jsonb_array_elements(extra_saved) LOOP
  IF extra_snapshot->>'role'='core' AND signing_profile='canonical_wrapper' THEN
   EXECUTE replace(extra_snapshot->>'definition',extra_snapshot->>'canonical',extra_snapshot->>'old');
  END IF;
  SELECT * INTO STRICT extra_during FROM pg_catalog.pg_proc WHERE oid=(extra_snapshot->>'oid')::oid;
  IF extra_snapshot->>'role'='core' THEN
   IF(to_jsonb(extra_during)-'prosrc') IS DISTINCT FROM((extra_snapshot->'row')-'prosrc')
    OR extra_during.prosrc IS DISTINCT FROM extra_snapshot->>'old' THEN RAISE EXCEPTION 'all_signing_atomic_normalization_changed_core';END IF;
  ELSIF to_jsonb(extra_during) IS DISTINCT FROM extra_snapshot->'row'
   OR pg_get_functiondef(extra_during.oid) IS DISTINCT FROM extra_snapshot->>'definition'
   THEN RAISE EXCEPTION 'all_signing_atomic_normalization_changed_public';END IF;
 END LOOP;
 IF signing_profile='canonical_wrapper' THEN
  IF strpos(signing_core_definition,signing_cee)=0 THEN RAISE EXCEPTION 'signing_atomic_core_definition_unknown'; END IF;
  EXECUTE replace(signing_core_definition,signing_cee,signing_old);
 END IF;
 SELECT * INTO STRICT signing_core_during FROM pg_catalog.pg_proc WHERE oid=signing_core;
 IF(to_jsonb(signing_core_during)-'prosrc') IS DISTINCT FROM(to_jsonb(signing_core_before)-'prosrc')
 OR signing_core_during.prosrc IS DISTINCT FROM signing_old
 OR(SELECT to_jsonb(p) FROM pg_catalog.pg_proc p WHERE p.oid=signing_public) IS DISTINCT FROM to_jsonb(signing_public_before)
 THEN RAISE EXCEPTION 'signing_atomic_normalization_changed_identity'; END IF;

 -- Both exact source literals and full known function ABI/attributes are mandatory.
 projection_target:=to_regprocedure('gridex_prodat_object_batch.require_wire_projection_v1(text,jsonb,jsonb,text,uuid)');
 SELECT * INTO STRICT projection_before FROM pg_catalog.pg_proc WHERE oid=projection_target;
 IF pg_get_userbyid(projection_before.proowner)<>'postgres'
 OR projection_before.pronamespace<>'gridex_prodat_object_batch'::regnamespace
 OR projection_before.proname<>'require_wire_projection_v1' OR projection_before.prokind<>'f'
 OR projection_before.proacl IS DISTINCT FROM ARRAY['postgres=X/postgres']::aclitem[]
 OR projection_before.proargtypes<>ARRAY['text'::regtype::oid,'jsonb'::regtype::oid,'jsonb'::regtype::oid,'text'::regtype::oid,'uuid'::regtype::oid]::oidvector
 OR projection_before.pronargs<>5 OR projection_before.proallargtypes IS NOT NULL OR projection_before.proargmodes IS NOT NULL
 OR projection_before.proargnames IS DISTINCT FROM ARRAY['raw','own','command','mode','actor']::text[]
 OR projection_before.prorettype<>'void'::regtype OR projection_before.proretset
 OR projection_before.pronargdefaults<>0 OR projection_before.proargdefaults IS NOT NULL
 OR projection_before.prosecdef OR projection_before.proisstrict OR projection_before.proleakproof
 OR projection_before.provolatile<>'v' OR projection_before.proparallel<>'u'
 OR projection_before.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR (SELECT lanname FROM pg_catalog.pg_language WHERE oid=projection_before.prolang) IS DISTINCT FROM 'plpgsql'
 OR projection_before.procost<>100 OR projection_before.prorows<>0 OR projection_before.provariadic<>0 OR projection_before.prosupport<>0
 OR projection_before.protrftypes IS NOT NULL OR projection_before.probin IS NOT NULL OR projection_before.prosqlbody IS NOT NULL
 THEN RAISE EXCEPTION 'sc031_atomic_replay_projection_full_metadata_unknown'; END IF;
 IF md5(projection_old)<>'575139caedf161f007a16b64873bb727'
 OR encode(sha256(convert_to(projection_old,'UTF8')),'hex')<>'c384bcefd09417f9d5220f01de98d7139ac7b8f461fbac590edb8779a5ff260a'
 OR md5(projection_current)<>'4682314319fefd9d2d258b0d31b7b554'
 OR encode(sha256(convert_to(projection_current,'UTF8')),'hex')<>'6d5e21a429db0d8d1a0e07a08bf391f0ae643118b20ac19d2059490feaf2f500'
 THEN RAISE EXCEPTION 'sc031_atomic_replay_projection_source_literal_unknown'; END IF;
 IF projection_before.prosrc=projection_current
 AND md5(projection_before.prosrc)='4682314319fefd9d2d258b0d31b7b554' THEN
  projection_definition:=pg_get_functiondef(projection_target);
  IF strpos(projection_definition,projection_current)=0 THEN RAISE EXCEPTION 'sc031_atomic_replay_projection_definition_unknown'; END IF;
  EXECUTE replace(projection_definition,projection_current,projection_old);
  SELECT * INTO STRICT projection_during FROM pg_catalog.pg_proc WHERE oid=projection_target;
  IF (to_jsonb(projection_during)-'prosrc') IS DISTINCT FROM (to_jsonb(projection_before)-'prosrc')
  OR projection_during.prosrc IS DISTINCT FROM projection_old OR md5(projection_during.prosrc)<>'575139caedf161f007a16b64873bb727'
  THEN RAISE EXCEPTION 'sc031_atomic_replay_projection_normalization_changed_identity'; END IF;
  projection_normalized:=true;
 ELSIF projection_before.prosrc IS DISTINCT FROM projection_old
 OR md5(projection_before.prosrc)<>'575139caedf161f007a16b64873bb727' THEN
  RAISE EXCEPTION 'sc031_atomic_replay_projection_body_unknown';
 END IF;
 -- BEGIN ops78 diagnostic-only insertion: no guard or source-body admission changes.
 DECLARE
  diagnostic_spec jsonb;
  diagnostic_function pg_catalog.pg_proc%ROWTYPE;
  diagnostic_oid oid;
  diagnostic_lookup text;
  diagnostic_sqlstate text;
  diagnostic_mismatches jsonb:='[]'::jsonb;
  diagnostic_config jsonb;
  diagnostic_stage constant text:='pre_sealed_execution_after_derived_normalization';
  diagnostic_format constant text:='ops-presealed-metadata-chunks-v3';
  diagnostic_map_sha constant text:='2f789d3e9c7abfa1cb96dcb4029cd8d690392605371a856485696f84011cd23d';
  diagnostic_chunk_bytes constant integer:=4096;
  diagnostic_payload bytea;
  diagnostic_payload_sha text;
  diagnostic_collection text;
  diagnostic_chunk bytea;
  diagnostic_chunk_count integer;
  diagnostic_sequence integer;
  diagnostic_header jsonb;
 BEGIN
  FOR diagnostic_spec IN SELECT value FROM pg_catalog.jsonb_array_elements('[{"signature":"gridex_correction_process.combined_document_body_v3(uuid, text, timestamp with time zone, text[])","expected_md5":["d719de15e4a92eedc40d396e13fdd547"]},{"signature":"gridex_correction_process.combined_outbound_body_v3(uuid, text, timestamp with time zone, text[])","expected_md5":["235e71e8c7b6da6c37ff65fab35b39b9"]},{"signature":"gridex_correction_process.combined_process_body_v3(uuid, timestamp with time zone, uuid[], text[])","expected_md5":["4b27cf961580ea1cf365a7855beaa838"]},{"signature":"gridex_correction_process.open_combined_v1(uuid, text, uuid, timestamp with time zone)","expected_md5":["4fcbdfbbfac188e47e76d4431e1dc132"]},{"signature":"gridex_correction_process.open_readset_v1(uuid, text, uuid, timestamp with time zone, uuid, text, uuid)","expected_md5":["a9d15f2d4828e4abd4bdbcd9a5c9208e"]},{"signature":"gridex_correction_process.point_aliases_v1(uuid, uuid, text, text, timestamp with time zone)","expected_md5":["ecb968dbf774a5d1036822d819eb4330"]},{"signature":"gridex_correction_process.point_customers_v1(uuid, uuid, uuid, timestamp with time zone)","expected_md5":["77111cb893dd701becb34ada419dc5c1"]},{"signature":"gridex_correction_process.subject_wire_point_v1(text, text)","expected_md5":["4ebccdb48a591a352a678f7902079b50"]},{"signature":"gridex_correction_process.switch_event_subject_v1(uuid, jsonb, jsonb, timestamp with time zone, uuid[], text[])","expected_md5":["198e353b04552fa8bf362d737eec45f4"]},{"signature":"gridex_internal.actor_open_blocking_conflict_counts()","expected_md5":["d313bc4be337fdda2ea2efb86fff84ed"]},{"signature":"gridex_outbound_dispatch.immutable_v1()","expected_md5":["2e155f8782b5f7933ec3832a81d4022a"]},{"signature":"gridex_outbound_dispatch.mutate_v1(jsonb)","expected_md5":["a16d6877219da4418ec36e2258543ca9"]},{"signature":"gridex_outbound_dispatch.scope_v1(text)","expected_md5":["db738c41c670cb6d538d195f4af8059e"]},{"signature":"gridex_received_sources.append_discovery(uuid, text, uuid, text, text, text)","expected_md5":["ea240090e566027a73b5c2e0d6bcf4a6"]},{"signature":"gridex_received_sources.append_object_assessment(uuid, text, uuid, text, uuid, text)","expected_md5":["9662f3809d231e2313c2b2befb1ef46a"]},{"signature":"gridex_received_sources.append_validation(uuid, text, uuid, text, text)","expected_md5":["de6d0a69327e00e3c144c71233ad41bf"]},{"signature":"gridex_received_sources.begin_document_reference_v1(uuid, text, uuid, uuid, uuid)","expected_md5":["c7a28976ae9eb6e8304654dfb9d789a2"]},{"signature":"gridex_received_sources.capture_correction_concern_v1(uuid, text, uuid, uuid)","expected_md5":["5cc6ba2ca6aa45cb3be2c9222ca53cd2"]},{"signature":"gridex_received_sources.closure_wire_matches_v1(text, jsonb, jsonb)","expected_md5":["a070749971ee8fb85b5dd659a533d198"]},{"signature":"gridex_received_sources.closure_wire_projection_v1(text, jsonb)","expected_md5":["8db9ae512f6fbc5f3bc3fb9b0a7e75f0"]},{"signature":"gridex_received_sources.closure_wire_tokens_v1(text)","expected_md5":["97d17da719d294b1f6901232c8b125ec"]},{"signature":"gridex_received_sources.combined_concern_body_v3(uuid, text, timestamp with time zone, text[])","expected_md5":["741d36bac9bbd6110d2ba2fd7c83444e"]},{"signature":"gridex_received_sources.correction_receipt_v1(gridex_received_sources.correction_concerns)","expected_md5":["85b556e4e0c7be1ee398b439a7f78eb2"]},{"signature":"gridex_received_sources.correction_wire_exact_v1(text, jsonb)","expected_md5":["a43bb4d820d741b23258a227db17d8be"]},{"signature":"gridex_received_sources.correction_wire_observation_v1(text)","expected_md5":["4a2552596e5b237194347bd6e24311b3"]},{"signature":"gridex_received_sources.document_reference_actor_v1(uuid, uuid)","expected_md5":["a98bf6d11bdf81ed8e8871df550696d7"]},{"signature":"gridex_received_sources.document_reference_facts_v1(uuid, text, uuid, uuid)","expected_md5":["35bce7c0eca555122a9f16456558df4b"]},{"signature":"gridex_received_sources.object_owner_proof_consistent(jsonb, jsonb, timestamp with time zone)","expected_md5":["bf499b92113b3e3370085d23dce02f51"]},{"signature":"gridex_received_sources.observe_document_reference_v1(uuid, text, uuid, uuid, jsonb)","expected_md5":["325dfe9fddeda49eec9850dd97e0b16f"]},{"signature":"gridex_received_sources.open_object_selection_snapshot(uuid, text, timestamp with time zone)","expected_md5":["c3dd93cd27f665a2e4201fdd33000ad1"]},{"signature":"gridex_received_sources.open_snapshot(uuid, text, timestamp with time zone)","expected_md5":["e4a5f3412cfaad0d3a190295b2885860"]},{"signature":"gridex_received_sources.owner_rows_match(text, jsonb, uuid, text, uuid)","expected_md5":["0d8b705483d908671fa8b079c32b96ab"]},{"signature":"gridex_received_sources.read_document_reference_context_v1(uuid, text, uuid, uuid, timestamp with time zone)","expected_md5":["6182808f0912c682ece4d24b6b46b855"]},{"signature":"gridex_received_sources.reject_mutation()","expected_md5":["f7e8de1214441a6e4396617536b37164"]},{"signature":"gridex_received_sources.review_business_proof_consistent(jsonb, jsonb, uuid)","expected_md5":["a95412a2838be5ef47ec644feb50707e"]},{"signature":"gridex_received_sources.review_closure_proof_consistent(jsonb, jsonb, uuid)","expected_md5":["fe70d69e57875acdf96a7fdae0e51a42"]},{"signature":"gridex_received_sources.review_party_proof_consistent(jsonb, jsonb, timestamp with time zone)","expected_md5":["9e81e2fb6e98b3f138c7001cdb347811"]},{"signature":"gridex_received_sources.selection_body_v5(uuid, text, timestamp with time zone, timestamp with time zone, text[])","expected_md5":["2beb48adb3d9fc204ec1e9733b36704d"]},{"signature":"gridex_received_sources.source_wire_point_v1(text)","expected_md5":["a688a0a9ec4f057f75a68cdd146a4409"]},{"signature":"gridex_received_sources.witness_correction_concern_v1(uuid, text, uuid, text)","expected_md5":["aab81bed4baf293c684f091ed647d58a"]},{"signature":"gridex_received_sources.witness_document_reference_v1(uuid, text, uuid, text)","expected_md5":["e7ac39591ee8fac2417b746bb74c619a"]},{"signature":"gridex_received_sources.witness_object_availability(uuid, text, uuid, text)","expected_md5":["fc6ef3820c4d75e335c498e8c250ef22"]},{"signature":"gridex_received_sources.z05_wire_structure_v1(text, jsonb)","expected_md5":["641c58a5c7cb49880d588d07c570a92c"]},{"signature":"gridex_utilts_binding.absolute_v1(jsonb)","expected_md5":["78ab577fbe685d079cd41a2e1bc36b1c"]},{"signature":"gridex_utilts_binding.exact_keys_v1(jsonb, text)","expected_md5":["193506c70c0a4c3d3ac8a413f2c3768a"]},{"signature":"gridex_utilts_binding.source_context_v1(ediel_messages)","expected_md5":["88f74cf45cb51ceedfc277839e7fbcc6"]},{"signature":"gridex_utilts_binding.stored_contract_v1(uuid, uuid, text)","expected_md5":["d148eea6404b094d3e68783a39263d4d"]},{"signature":"gridex_utilts_binding.supported_point_v1(jsonb, text)","expected_md5":["dbb08c84c47d967548f840156d94ead5"]},{"signature":"gridex_utilts_binding.validate_contract_base_v1(jsonb)","expected_md5":["42b8e218328af1884f5fcb34e4479182"]},{"signature":"gridex_utilts_binding.validate_contract_v1(jsonb)","expected_md5":["6ad73f216e8258647ea8781ae436eb0c"]},{"signature":"gridex_utilts_binding.wire_tokens_v1(text)","expected_md5":["ef0637580c08cd5801c95f3d93decd02"]},{"signature":"public.activate_customer_supply_v1(uuid, uuid, uuid, date, uuid, text)","expected_md5":["85561284bde4891c22cfd8f5f640e342"]},{"signature":"public.authenticate_integration_request_v1(text, text, text, text[], text[], text, text, integer, integer)","expected_md5":["4161c5fde5d0160781f0ce91ff219024"]},{"signature":"public.authenticate_integration_request_v1_credential_core(text, text, text, text[], text[], text, text, integer, integer)","expected_md5":["2cbe01ce94208265d19bddf9dd97594d"]},{"signature":"public.canonical_accept_tenant_invitation(jsonb)","expected_md5":["84da220e65ca1a019bdf55b33fa1664c"]},{"signature":"public.canonical_actor_is_authorized(uuid, uuid, text, boolean)","expected_md5":["49707d2c014ed937d157d78be526edab"]},{"signature":"public.canonical_actor_is_platform_admin(uuid)","expected_md5":["1d5d2d377bfcb9cf22ef724054e58583"]},{"signature":"public.canonical_approve_first_live_send(uuid, uuid, uuid, text)","expected_md5":["bedf74f0ea60f334c04c13cefb4159cd"]},{"signature":"public.canonical_approve_first_live_send_v1_unchecked(uuid, uuid, uuid, text)","expected_md5":["a274bf891c808fce8cde28637fe654ed"]},{"signature":"public.canonical_authenticated_tenant_context(uuid)","expected_md5":["a41e40cb3385fbaac24675d2a0d264f6"]},{"signature":"public.canonical_authenticated_tenant_context_v1_scoped(uuid)","expected_md5":["d205c4e8ba1989b27b4df6b1b76af631"]},{"signature":"public.canonical_block_claimed_ediel_outbox_item(uuid, text, text, text, jsonb)","expected_md5":["3e5e395de48a2b7c3626a513af6fa836"]},{"signature":"public.canonical_capture_ediel_configuration_snapshot(uuid, uuid, text)","expected_md5":["a94591a68bf4dc7d7379eebb3fdbcf40"]},{"signature":"public.canonical_capture_ediel_configuration_snapshot_v1_unchecked(uuid, uuid, text)","expected_md5":["fa3c52d78347d7dfc7823886453a837d"]},{"signature":"public.canonical_capture_ediel_test_configuration_snapshot(uuid, uuid, uuid, uuid, text)","expected_md5":["cd351237978161ee32086f9b7832a0eb"]},{"signature":"public.canonical_change_tenant_user_access(jsonb)","expected_md5":["75f689b0f1ea79cd3a1a22027b981cc5"]},{"signature":"public.canonical_change_tenant_user_access_pre_staff_v1(jsonb)","expected_md5":["6a4fe2ab3800daee2421c857c5a18994"]},{"signature":"public.canonical_change_tenant_user_access_v1_unchecked(jsonb)","expected_md5":["755b52fb76a42cea6e5ad69a27b2804c"]},{"signature":"public.canonical_change_tenant_user_access_v2_unmapped(jsonb)","expected_md5":["6567eaca5a27925a145a2ba652a36bd2"]},{"signature":"public.canonical_claim_company_provisioning_jobs(text, integer, integer)","expected_md5":["6ca27a56870253b16b42fbd2a2c69ea9"]},{"signature":"public.canonical_complete_company_provisioning_job(uuid, uuid, boolean, text, text, jsonb)","expected_md5":["bb5d2242ccdfb8a3803c0ce6cf6a7394"]},{"signature":"public.canonical_complete_company_provisioning_job_v1_pre_history_guar(uuid, uuid, boolean, text, text, jsonb)","expected_md5":["c7ea85797fbdbb7ac60425791a68a12d"]},{"signature":"public.canonical_create_tenant_invitation(jsonb)","expected_md5":["504f615c547d70dff0f920c1145827a6"]},{"signature":"public.canonical_create_tenant_invitation_pre_staff_v1(jsonb)","expected_md5":["6d1530629b28f20f0242ab63d2eee144"]},{"signature":"public.canonical_current_ediel_engine_schema_version()","expected_md5":["222d2e7555a99fe005af3f7e82f74353"]},{"signature":"public.canonical_ediel_production_evidence_readiness(uuid)","expected_md5":["4e787f8f9306d045effa3a4282a34e9b"]},{"signature":"public.canonical_json_sha256(jsonb)","expected_md5":["b43c0ca403b2d7f79e45ad4b5affea66"]},{"signature":"public.canonical_manage_platform_user_access(jsonb)","expected_md5":["fe16df3f663abb5e7fec9dad7741c862"]},{"signature":"public.canonical_onboard_customer_graph(jsonb)","expected_md5":["863d75ad1ffd558b2810a31184f20712"]},{"signature":"public.canonical_project_actor_test_result_state(jsonb)","expected_md5":["fbc97418e32f8a2b561785d076371126"]},{"signature":"public.canonical_record_actor_test_evidence(jsonb)","expected_md5":["b35f7f114489464089f138c985514ad9"]},{"signature":"public.canonical_run_architecture_reconciliation(uuid)","expected_md5":["7b8134dda55d2e2b2f8358ae6d23bde4"]},{"signature":"public.canonical_set_architecture_finding(uuid, text, text, text, text, bigint, text, text, text)","expected_md5":["02fb368706e84205785e514eafaa2258"]},{"signature":"public.canonical_tenant_operation_decision(uuid, text)","expected_md5":["faeaffe4fa5de33a4bb006a5b943c1e5"]},{"signature":"public.claim_ediel_outbox_item(uuid, text, uuid)","expected_md5":["9652162f0f7e0971221ac74439ffc875"]},{"signature":"public.claim_ediel_outbox_items(text, uuid, integer, text, interval)","expected_md5":["677e57818ba4555ff03051fc679505cf"]},{"signature":"public.claim_inbound_processing_jobs(text, integer, text, interval)","expected_md5":["63dde69fa26d48381b510aa2837a5627"]},{"signature":"public.ediel_customer_record_tombstones_v1(uuid, uuid)","expected_md5":["7eb808f1f5414538379c60edd4a2d68e"]},{"signature":"public.gridex_accept_external_staff_invitation_v1(jsonb)","expected_md5":["2a7f912ecc0d982365a5abd423afab0b"]},{"signature":"public.gridex_acquire_automation_lock(text, uuid, uuid, integer, jsonb)","expected_md5":["b908da47531788ec596375948c03ef23"]},{"signature":"public.gridex_actor_has_company_permission(uuid, uuid, text)","expected_md5":["02c126207b21142e0de62563a287ea1e"]},{"signature":"public.gridex_actor_readiness_backfill(text)","expected_md5":["26b604661e5227a62ff206ce5b045ff1"]},{"signature":"public.gridex_admin_dashboard_summary(uuid)","expected_md5":["e967a8d66d0b74a3955fea7c37eb0abe"]},{"signature":"public.gridex_analytics_point_month_internal(uuid, date)","expected_md5":["89ab7de7eb551a589fd466a2f65c328f"]},{"signature":"public.gridex_apply_actor_auto_send_readiness(uuid)","expected_md5":["7618a81624dcb343d1eeebe01c3ce5fa"]},{"signature":"public.gridex_apply_billing_export_partner_result(uuid, uuid, uuid[], jsonb, jsonb, uuid)","expected_md5":["b71d22d60e7d13e26dab553e89e7ed7b"]},{"signature":"public.gridex_approve_invoice_test_item_v1(uuid, uuid, jsonb)","expected_md5":["dcccf7dccfdd877d43008968b8c85bdd"]},{"signature":"public.gridex_approve_portal_claim_v1(uuid, uuid, uuid, jsonb, jsonb, jsonb)","expected_md5":["032c60b6f3c7e36538342ba81c40e517"]},{"signature":"public.gridex_archive_contract_product(uuid, uuid, uuid)","expected_md5":["ab99362627a1ba9d5d4b29f8f02e1df3"]},{"signature":"public.gridex_assert_contract_permission(uuid, text)","expected_md5":["8e5ee1ad54029badf695246569a31063"]},{"signature":"public.gridex_assert_no_public_offer_fk_references(uuid[])","expected_md5":["33e89a3a3879196350cfe3ed33f74650"]},{"signature":"public.gridex_assert_staff_command_v1(jsonb, boolean)","expected_md5":["cf053076d797e1ccf1f2421a28c8bd61"]},{"signature":"public.gridex_assert_supplier_switch_ready(uuid, uuid)","expected_md5":["19f066a0012f0626c238adbda00b8a73"]},{"signature":"public.gridex_assert_switch_writer_v1(uuid)","expected_md5":["a3d3c8572b3e9052ec80d8ac709c3046"]},{"signature":"public.gridex_assign_customer_case(uuid, uuid, uuid, uuid, uuid, text)","expected_md5":["8550f06e9fc4df9d5ffffc08970500c3"]},{"signature":"public.gridex_backfill_grid_owner_verification(text)","expected_md5":["784f18f5f74b2c99503ec5e70db3323e"]},{"signature":"public.gridex_begin_document_reference_v1(uuid, text, uuid, uuid, uuid)","expected_md5":["88f57c64c098c765954911b242664eef"]},{"signature":"public.gridex_build_canonical_address(text, text, text, text, text)","expected_md5":["405e6a611a6a570fb11f8fb4d18af7a1"]},{"signature":"public.gridex_can_read_company(uuid)","expected_md5":["c292861783b4fedb69f959a581b84092"]},{"signature":"public.gridex_can_write_company(uuid)","expected_md5":["5fd22f7ce62f5def3847c6a165ad0333"]},{"signature":"public.gridex_canonicalize_publication_invoice_fee_v1(jsonb, numeric)","expected_md5":["c901b4c85d780c9855683bf95a35a214"]},{"signature":"public.gridex_capture_correction_concern_v1(uuid, text, uuid, uuid)","expected_md5":["799cc9703408efaffbfa1ed0ff9995e8"]},{"signature":"public.gridex_claim_customer_operation_jobs(text, integer)","expected_md5":["71085a4da4fbad9156c26f7844d40a40"]},{"signature":"public.gridex_claim_invoice_provider_events(uuid, text[], integer, uuid, integer)","expected_md5":["4c351f2ecd83e93d2757fa7a441093ac"]},{"signature":"public.gridex_claim_spot_price_import_job(text, text, date, uuid, interval, boolean)","expected_md5":["d7883d841b552d895dabac05f35385cc"]},{"signature":"public.gridex_commit_customer_application_provisioning(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb)","expected_md5":["7a23e77af81537118e1f562b1e9b2a55"]},{"signature":"public.gridex_commit_customer_site_address(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, uuid)","expected_md5":["3a7ca3f2f09d8c4516390c5aac7a413c"]},{"signature":"public.gridex_company_go_live_readiness(uuid)","expected_md5":["0c86ba3ddacecb3ff2d485c2e3ab06f8"]},{"signature":"public.gridex_company_legal_profile_defaults(jsonb)","expected_md5":["91fdea47076ad443a5c35f736e448353"]},{"signature":"public.gridex_complete_facility_response(uuid, uuid, uuid, text, uuid, text, text, text, text, uuid, jsonb, text)","expected_md5":["b1908f619424c2ca02d1c6214eb90e6b"]},{"signature":"public.gridex_complete_grid_owner_readiness(text)","expected_md5":["87ce5157860560f00f71be67a0314200"]},{"signature":"public.gridex_confirm_grid_owner_empty_subaddress(uuid, text, uuid, text)","expected_md5":["fa6007a113b49de7bbc4e250eac6e1cf"]},{"signature":"public.gridex_confirm_safe_blank_route_subaddresses(text, uuid, boolean)","expected_md5":["7c683e076561f8a52f26f05588facf61"]},{"signature":"public.gridex_contract_actor_can_operate_company(uuid, uuid)","expected_md5":["b6a89f8070ebef1f23405cbf8a907a7d"]},{"signature":"public.gridex_contract_actor_has_permission(uuid, text)","expected_md5":["7d5bed3a28475e25ec530fd4f87da828"]},{"signature":"public.gridex_contract_business_usage_counts(uuid, uuid)","expected_md5":["77b73067dc3694c3b4280645f9c12c1e"]},{"signature":"public.gridex_contract_channel_permission_allowed(tenant_contract_assignments, text)","expected_md5":["2db79bc9b170c49d4d61ccfbcfd1d0c5"]},{"signature":"public.gridex_contract_delete_blocker_details_v1(text[], jsonb, bigint, jsonb, jsonb)","expected_md5":["8c1c77e3275838b744167567c9eaea5c"]},{"signature":"public.gridex_contract_delete_dependency_graph_v2(uuid, uuid)","expected_md5":["3f864f76842afaba7e5199406b3258c4"]},{"signature":"public.gridex_contract_offer_references_v1(uuid, uuid[], uuid[], uuid[])","expected_md5":["b56896261eeb2816c6841ba8e73e327a"]},{"signature":"public.gridex_contract_readiness_blocker_v2(text, text, text, jsonb, text, uuid, jsonb)","expected_md5":["e6c301a96304cac0381735b2d429ad40"]},{"signature":"public.gridex_correction_combined_snapshot_v1(uuid, text, uuid, timestamp with time zone)","expected_md5":["659668c107aca28a95155c4014de171e"]},{"signature":"public.gridex_create_billing_export_run(jsonb, jsonb)","expected_md5":["f54cbf6ddcb6b4c28c1ff818aa62ebbd"]},{"signature":"public.gridex_create_customer_info_request_v1(uuid, jsonb, uuid)","expected_md5":["e9835f0f8355a1b63a9daa25fbbc1cb0"]},{"signature":"public.gridex_create_customer_site_with_address(uuid, uuid, text, text, text, text, text, text, text, text, text, jsonb)","expected_md5":["2113eb974d49f7679d00b54798e83365"]},{"signature":"public.gridex_create_external_staff_invitation_v1(jsonb)","expected_md5":["3b33d637ae914832862b46bb7b5fceca"]},{"signature":"public.gridex_create_grid_owner_data_request_v1(uuid, jsonb)","expected_md5":["030001d58faa385dd778e42cf491a0d2"]},{"signature":"public.gridex_create_invoice_export_file_v1(uuid, text, text, uuid, jsonb, text)","expected_md5":["533f8c25c8d918a1b6226625dd4cc73c"]},{"signature":"public.gridex_create_invoice_export_graph_v1(jsonb, jsonb, jsonb)","expected_md5":["ad06936cdb61caf8410e4dc14ab33760"]},{"signature":"public.gridex_create_invoice_export_graph_v1_core(jsonb, jsonb, jsonb)","expected_md5":["a738e118e1fdcad19ecf9e880acc7f56"]},{"signature":"public.gridex_create_invoice_review_draft_v1(uuid, jsonb, jsonb, jsonb, jsonb)","expected_md5":["addf32f920250b0199f3fffd741f2793"]},{"signature":"public.gridex_create_or_version_contract_pricing(uuid, text, text, text, text, jsonb, date, date, boolean, uuid)","expected_md5":["ad3959344ade2b6fba6c3ff80a734e35"]},{"signature":"public.gridex_create_partner_contract_v1(uuid, uuid, jsonb)","expected_md5":["50a9a74e64b0fd93849991f9164c6fdb"]},{"signature":"public.gridex_create_partner_webhook_subscription_v1(uuid, uuid, text, text, text[], text, text)","expected_md5":["f9fe118f525669044bf7a8677a3f0b6e"]},{"signature":"public.gridex_create_staff_support_case_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb)","expected_md5":["7f3b379041922abdba519808692f70f8"]},{"signature":"public.gridex_create_supplier_switch_v1(uuid, jsonb, jsonb)","expected_md5":["2695864d2aa461832fa7d361b0bd64bb"]},{"signature":"public.gridex_customer_application_runtime_contract_v1()","expected_md5":["71320887919c326c9fba3d4f5f351be4"]},{"signature":"public.gridex_customer_contact_change_v1(uuid, uuid, text, uuid, uuid, text, text, timestamp with time zone, jsonb, jsonb, text)","expected_md5":["6fb3ed22a0c0657bb59f572986ab6fe9"]},{"signature":"public.gridex_customer_intake_queue(uuid, integer)","expected_md5":["a6e1636bb6852c420e942cc7237396dd"]},{"signature":"public.gridex_customer_list_summary(uuid, integer)","expected_md5":["1fbf3e87b80601ea9205f07ca03112be"]},{"signature":"public.gridex_customer_portfolio_active_counts(uuid[], date)","expected_md5":["20b03368594d0e52c926f0014e332206"]},{"signature":"public.gridex_customer_portfolio_assert_read(uuid)","expected_md5":["84e9e57c9700286a582312e58354aab6"]},{"signature":"public.gridex_customer_portfolio_bidding_zones(uuid, date)","expected_md5":["2142dfa85a6d5bb59dd58772557e1a32"]},{"signature":"public.gridex_customer_portfolio_churn_reasons(uuid, date, date)","expected_md5":["023993a9bec78dec318c5a725058534b"]},{"signature":"public.gridex_customer_portfolio_cohorts(uuid, integer)","expected_md5":["37be309d17d59dafd04508ca6c1702ab"]},{"signature":"public.gridex_customer_portfolio_expiring_poa(uuid, integer)","expected_md5":["878d935ac0e44ef38da309ba5c3b2386"]},{"signature":"public.gridex_customer_portfolio_forecast(uuid, date)","expected_md5":["1cdd2f350e787cc90894743aad650dff"]},{"signature":"public.gridex_customer_portfolio_forecast_accuracy(uuid, date, date)","expected_md5":["c5d5b0c9e5908c80c3f826996d20e60b"]},{"signature":"public.gridex_customer_portfolio_forecast_cached_internal(uuid, date)","expected_md5":["7cff187b383d875d120b11a84ecfca1b"]},{"signature":"public.gridex_customer_portfolio_forecast_internal(uuid, date, integer)","expected_md5":["fee8dac1a1c556cb9888ef2865b32319"]},{"signature":"public.gridex_customer_portfolio_monthly_internal(uuid, date, date)","expected_md5":["e5a9147468162c97615024290faf0e58"]},{"signature":"public.gridex_customer_portfolio_point_forecast_internal(uuid, date, integer)","expected_md5":["0dd528a6c806683461e427be231007f6"]},{"signature":"public.gridex_customer_portfolio_summary(uuid, date, date)","expected_md5":["491d445ea8127c5decd795934cf3adc0"]},{"signature":"public.gridex_customer_status_counts_v1(uuid, text, boolean)","expected_md5":["57d918c2f53b1564b731259bde44a5d5"]},{"signature":"public.gridex_decide_customer_identity_change_v1(uuid, uuid, text, text, uuid, jsonb)","expected_md5":["63f7ccdf09f86e5fe8f917a6560fb00e"]},{"signature":"public.gridex_default_document_prefix(uuid, text)","expected_md5":["97e498018b7f114a6781f5d7fadd49bf"]},{"signature":"public.gridex_delete_partner_webhook_subscription_v1(uuid, uuid, text)","expected_md5":["cbb33a4f08b251e0b5718732a7013117"]},{"signature":"public.gridex_delete_unused_contract(uuid, uuid, uuid)","expected_md5":["a85795a836d37c6e1e693a1f7df369c5"]},{"signature":"public.gridex_delete_unused_contract_v2(uuid, uuid, uuid, text)","expected_md5":["4fd8dfaf1f7071f83a6b1cab59f476cc"]},{"signature":"public.gridex_dependency_circuit_before_request_v1(text, integer)","expected_md5":["6846d84d628409c98efce04b0c400ee2"]},{"signature":"public.gridex_dependency_circuit_record_v1(text, text, text, integer, integer)","expected_md5":["04f6a46218220a0a7fe6b65767051b3a"]},{"signature":"public.gridex_ediel_message_summary(uuid)","expected_md5":["3306c3fc8584297070be92eedc677fd2"]},{"signature":"public.gridex_ensure_internal_contract_publication(uuid, uuid, uuid)","expected_md5":["8de415319f6977a31ab675d8ff310d63"]},{"signature":"public.gridex_escalate_overdue_z01_responses(integer)","expected_md5":["ad581980dde9d4d883c06ab130c4a85e"]},{"signature":"public.gridex_expire_overdue_powers_of_attorney_v1(integer)","expected_md5":["1472eb2741a28f35c00ed923a65ef505"]},{"signature":"public.gridex_fail_website_contract_signature(uuid, uuid, uuid, text, text)","expected_md5":["27c2fec9c7cb6e197ee3b88dfacd54b7"]},{"signature":"public.gridex_finalize_contract_publication_v1(uuid, uuid, boolean)","expected_md5":["a209270073d956ed2730db06353a68cb"]},{"signature":"public.gridex_finalize_customer_contract_signature_v1(text, text, text)","expected_md5":["86e49c3db54add3887de13f00bf63b7b"]},{"signature":"public.gridex_finalize_supplier_switch_activation(uuid, uuid, uuid)","expected_md5":["5f043628ca691c5678f69451e3671eda"]},{"signature":"public.gridex_finalize_supplier_switch_v1(uuid, uuid, uuid, jsonb)","expected_md5":["69691adff6853aaf3120651ca39d6635"]},{"signature":"public.gridex_finalize_website_contract_signature(uuid, uuid, uuid, uuid, text, timestamp with time zone, jsonb, jsonb, jsonb, text, text, text)","expected_md5":["aeb3e4cd457ca99d257720e7f1794521"]},{"signature":"public.gridex_finalize_website_contract_signature(uuid, uuid, uuid, uuid, text, timestamp with time zone, jsonb, jsonb, text, text, text)","expected_md5":["de908da1a91b83e91ce1748c13e17412"]},{"signature":"public.gridex_find_customer_identity_change_by_token_v1(text)","expected_md5":["7d351a863c6ef8bf65e23dafdee45125"]},{"signature":"public.gridex_fk_reference_blockers(regclass, uuid[], text[])","expected_md5":["305b8c913b10c2a516e257f0b3e48c11"]},{"signature":"public.gridex_get_customer_contract_signature_receipt_v1(text)","expected_md5":["620d2a202a7fe821b0f6f0b4cd90306c"]},{"signature":"public.gridex_get_facility_work_queue(uuid, integer)","expected_md5":["b0c4db93296f9777aa86b953a61a73c7"]},{"signature":"public.gridex_get_user_permissions(uuid)","expected_md5":["abc7cf42141a02abdfab33cbd013fee8"]},{"signature":"public.gridex_get_user_permissions_in_company(uuid, uuid)","expected_md5":["cd48d5a1fc77db9fc4cfb62b58e5ad5c"]},{"signature":"public.gridex_get_work_queue(uuid, integer)","expected_md5":["743cfe1a13309022448465bf03b9053c"]},{"signature":"public.gridex_grid_owner_name_key(text)","expected_md5":["5f153f65d46dad9aa6b61d21ad558cae"]},{"signature":"public.gridex_guard_history_truncate_v1()","expected_md5":["dac69d6ea2834051f49ab8faed87b8aa"]},{"signature":"public.gridex_has_permission(uuid, text)","expected_md5":["62ab7072f95952b588f784c9e5956870"]},{"signature":"public.gridex_import_grid_area_geojson_feature(text, jsonb, jsonb, text)","expected_md5":["80ce77dc08716c39931a3cd34a680b4a"]},{"signature":"public.gridex_import_grid_area_master_row(text, text, text, text, text, jsonb)","expected_md5":["37887531c094358945b1f817e58bbe54"]},{"signature":"public.gridex_ingest_metering_value_atomic(jsonb)","expected_md5":["e3a3aec2606be784a8d7821f4c846e57"]},{"signature":"public.gridex_insert_jsonb_row(regclass, jsonb)","expected_md5":["7f4a7d64fdd77af306f3b2bed9e88dde"]},{"signature":"public.gridex_invoice_fee_ready_v1(numeric, jsonb)","expected_md5":["755b49b8a8f29bf2d14e11ff12c66c80"]},{"signature":"public.gridex_is_current_session_allowed()","expected_md5":["6707ca220b4289d0cbfff1ef2cc5af65"]},{"signature":"public.gridex_json_text(jsonb, text[])","expected_md5":["4434c4320d1a443ab0641d0f8f07a878"]},{"signature":"public.gridex_legacy_legal_type_for_module(text)","expected_md5":["a3f91ad452e69020a6dac1fab2257ecd"]},{"signature":"public.gridex_legal_missing_field_details(uuid, text[])","expected_md5":["6a0f83b67a79d0fa24d12265b49691fd"]},{"signature":"public.gridex_list_customer_operation_events(uuid, text, text, text, boolean, timestamp with time zone, timestamp with time zone, timestamp with time zone, uuid, integer)","expected_md5":["87c2e48ce1e9d68672a4227eb9956a3a"]},{"signature":"public.gridex_list_external_api_contracts(uuid, text)","expected_md5":["cafdf0f255906919dbfc1ecbe9bd7042"]},{"signature":"public.gridex_list_readable_whitelabel_platforms()","expected_md5":["4ecf0ca16270b9e6a9653ad543683aaa"]},{"signature":"public.gridex_lock_pricing_run(uuid, uuid, uuid)","expected_md5":["95ccb26a2bee87574c99173b373d43f6"]},{"signature":"public.gridex_lock_spot_price_month(text, text, text, uuid, text)","expected_md5":["220762f31856156f2c71424c21907a25"]},{"signature":"public.gridex_lonlat_to_grid_area(numeric, numeric)","expected_md5":["1ed7b7d1fd176e3e5b173473f7284f26"]},{"signature":"public.gridex_lookup_pending_staff_identity_binding_v1(jsonb)","expected_md5":["2f47108b9e16d908124b993b9293a2cd"]},{"signature":"public.gridex_luhn_valid(text)","expected_md5":["9d2ba2bcab4f2381cdf995de53994f4f"]},{"signature":"public.gridex_mark_customer_contract_signature_request_sent_v1(uuid, uuid)","expected_md5":["5d99ec748bab1306b86645ee71702ded"]},{"signature":"public.gridex_mask_identity_number(text)","expected_md5":["3ddce21002fdf54fc85fb3ccf5c39a0d"]},{"signature":"public.gridex_materialize_legal_bundle_version(uuid, uuid, uuid, uuid)","expected_md5":["45377aab668b39d0939861a0b97e3129"]},{"signature":"public.gridex_materialize_publication_price_options_v1(uuid, uuid)","expected_md5":["b12860f27e8ee0e4e2d3711ba30d686b"]},{"signature":"public.gridex_new_external_tenant_reference()","expected_md5":["73cfe0c5f1047453142d9dd717b81766"]},{"signature":"public.gridex_new_offer_reference(text)","expected_md5":["10d763fac93693590d32594cf29053f9"]},{"signature":"public.gridex_new_public_resource_reference(text)","expected_md5":["8ed2824b745dfceb6286ff37bef66b78"]},{"signature":"public.gridex_next_contract_number(uuid, text)","expected_md5":["51b009cfb48c5d0980d9e1841a4363f0"]},{"signature":"public.gridex_next_document_number(uuid, text, text)","expected_md5":["cf7b0f348995e019d579665f8eb7ff5a"]},{"signature":"public.gridex_normalize_country_code(text, text)","expected_md5":["3f5a1df72f804fb490f192319ec08215"]},{"signature":"public.gridex_normalize_email(text)","expected_md5":["7ce980789069fe150e050260b6f2c869"]},{"signature":"public.gridex_normalize_facility_id(text)","expected_md5":["8ea88d9f79f775ac08538b0fb8e3a22e"]},{"signature":"public.gridex_normalize_metering_point_id(text)","expected_md5":["8ea88d9f79f775ac08538b0fb8e3a22e"]},{"signature":"public.gridex_normalize_org_number(text)","expected_md5":["8db552c8031d6f5a37a7143c1d187123"]},{"signature":"public.gridex_normalize_personal_number(text)","expected_md5":["8db552c8031d6f5a37a7143c1d187123"]},{"signature":"public.gridex_normalize_phone(text)","expected_md5":["1edfa874d9d5688a86e1c1312773a571"]},{"signature":"public.gridex_normalize_platform_role(text)","expected_md5":["cbec24b3445318850d909175a4d2b327"]},{"signature":"public.gridex_normalize_postal_code(text)","expected_md5":["2b7c03c6963396f487d3683b9e117a57"]},{"signature":"public.gridex_normalize_postal_code(text, text)","expected_md5":["587848e31496d477756c60ad67360daa"]},{"signature":"public.gridex_normalize_swedish_organization_number(text)","expected_md5":["ded1275caec90c3ab33c02c31eeba651"]},{"signature":"public.gridex_observe_document_reference_v1(uuid, text, uuid, uuid, jsonb)","expected_md5":["0f9cf62731f6a654ae68613466ea17ec"]},{"signature":"public.gridex_onboard_customer_graph(jsonb)","expected_md5":["216c5d3e6151ade50bbd5e6410c3e910"]},{"signature":"public.gridex_onboard_customer_graph_core(jsonb)","expected_md5":["ef4dc9d7249b196965ab628864c7095c"]},{"signature":"public.gridex_onboard_customer_graph_quote_commit_v2(jsonb)","expected_md5":["007d078d9d0065395edf2190d4f1d3b6"]},{"signature":"public.gridex_open_correction_process_readset_v1(uuid, text, uuid, timestamp with time zone, uuid, text, uuid)","expected_md5":["12d9c1ae3ecd506a1d96b55323477872"]},{"signature":"public.gridex_ops_health_checks()","expected_md5":["04936272e4588eccda3438e16b98eff0"]},{"signature":"public.gridex_ops_health_checks_v2()","expected_md5":["97bfdec96fabf1ddda2ae4675dc61178"]},{"signature":"public.gridex_ops_health_checks_v3()","expected_md5":["0b28f8ece2fad71b4513763356b8abdc"]},{"signature":"public.gridex_ops_health_checks_v4()","expected_md5":["fab88f8c13db8db03385972f72bbb810"]},{"signature":"public.gridex_ops_health_checks_v5()","expected_md5":["6345502ed03a11dd0b86d0caa323b1cf"]},{"signature":"public.gridex_outbound_dispatch_v1(jsonb)","expected_md5":["83ade92de12757c2a02130ef4070cb60"]},{"signature":"public.gridex_persist_pricing_run(uuid, uuid, jsonb, jsonb)","expected_md5":["5a267754feb565b43c86ec9fe2591c19"]},{"signature":"public.gridex_platform_dashboard_summary_v1()","expected_md5":["cbcb04149852b19e07d7576f9a90ff77"]},{"signature":"public.gridex_point_to_grid_area(numeric, numeric)","expected_md5":["52d446fd23285ff23c9550d05efe74a4"]},{"signature":"public.gridex_portal_monthly_consumption_v1(uuid, uuid[], date, date)","expected_md5":["ba2f7f990b1e2eb1c31ee2048a4e6f35"]},{"signature":"public.gridex_prepare_billing_export_retry(uuid, uuid, uuid)","expected_md5":["83014c7e2888df9b5b4758ecae45175d"]},{"signature":"public.gridex_prepare_customer_contract_signature_request_v1(uuid, uuid, uuid, text, text, timestamp with time zone, uuid, text)","expected_md5":["8bd61eb144c72df71c050350a6ed0e57","cee1222f070383e440a9fd4f71cdf591"]},{"signature":"public.gridex_prepare_manual_contract_binding(uuid, jsonb, jsonb, uuid)","expected_md5":["2e350f61d1467bd1d320c21380cc9c46"]},{"signature":"public.gridex_prepare_staff_identity_delivery_v1(jsonb)","expected_md5":["b88cce767ffd3e31469fe42f653392bf"]},{"signature":"public.gridex_preview_delete_unused_contract(uuid, uuid)","expected_md5":["3ec9b9e89bb351915275d58651d0323b"]},{"signature":"public.gridex_preview_delete_unused_contract_v2(uuid, uuid, uuid)","expected_md5":["170ad26cabcf8fb2a4c795b2f80f8eed"]},{"signature":"public.gridex_price_option_unique_objects_v1()","expected_md5":["375058ee7d5f9a02274b8de4f23bf6a9"]},{"signature":"public.gridex_process_ready_supplier_switch_activations(uuid, integer)","expected_md5":["f44421c9c2d1efcaafcb947fd401f3bf"]},{"signature":"public.gridex_promote_energy_geodata_version(uuid)","expected_md5":["5c991837eb3a410be463b7e6e55e2bfd"]},{"signature":"public.gridex_provision_tenant_website_client_v1(uuid, text, text, text, text, text[], text[], integer, uuid, text)","expected_md5":["0e4c797199e87c256f9ba01e1a1f69af"]},{"signature":"public.gridex_publication_legal_snapshot_json_v1(uuid, uuid)","expected_md5":["4f8de14d9e66f4e23c731b8693ba3e17"]},{"signature":"public.gridex_publication_price_options_json_v1(uuid)","expected_md5":["3c5d5016f426a6dcb334d4cb42a79231"]},{"signature":"public.gridex_publish_contract_channel(uuid, uuid, text, uuid)","expected_md5":["e1ce2908fde6bcba9f797115196a4786"]},{"signature":"public.gridex_publish_contract_publication_version(uuid,uuid)","expected_md5":["ba799bdc42f5da7296d10832a7eca507"]},{"signature":"public.gridex_publish_internal_contract_version(uuid, uuid, uuid)","expected_md5":["5ac716481f12ad2d0cf97f61894541bf"]},{"signature":"public.gridex_publish_market_price_preview_v2(text, text, text, date, date, timestamp with time zone, timestamp with time zone, numeric, timestamp with time zone, integer, integer, boolean, text, uuid[], text, text, jsonb)","expected_md5":["e80deda222c00981e8439fa3efd83834"]},{"signature":"public.gridex_queue_billing_export_run(uuid, uuid, uuid)","expected_md5":["d5acc3f4bc98b344a4220ef39f94cc2d"]},{"signature":"public.gridex_read_document_reference_context_v1(uuid, text, uuid, uuid, timestamp with time zone)","expected_md5":["5de4eeb9650431de107d8e52c83e180b"]},{"signature":"public.gridex_read_webhook_signing_secret_v1(uuid, uuid)","expected_md5":["072b26b3eda983fb045e26d5da1004fb"]},{"signature":"public.gridex_rebuild_company_analytics_month(uuid, date)","expected_md5":["896ec2719664370ee3b64e8cdc04c74f"]},{"signature":"public.gridex_rebuild_company_legal_profile(uuid, uuid, boolean)","expected_md5":["cd14870c03de95ee649fa573d70f0e3c"]},{"signature":"public.gridex_rebuild_metering_monthly_consumption(uuid, date, date)","expected_md5":["6e8381910af4e196ce638451d8412af7"]},{"signature":"public.gridex_recalculate_actor_readiness(uuid)","expected_md5":["ea9c46a5db6b47a36e9a7431d4a6e9e5"]},{"signature":"public.gridex_received_source_snapshot_v1(uuid, text, timestamp with time zone)","expected_md5":["3cea5846cf2082dc7f46ff32736bde23"]},{"signature":"public.gridex_reconcile_grid_owner_mappings_v1(boolean)","expected_md5":["e1d0f735f647b442d374ef6d85d0bc5d"]},{"signature":"public.gridex_record_application_provisioning_step(uuid, uuid, uuid, text, text, jsonb)","expected_md5":["dfdc84bcecba8f05f96b5ff9002f875a"]},{"signature":"public.gridex_record_customer_contract_event_v1(uuid, uuid, uuid, text, timestamp with time zone, text, jsonb, uuid, timestamp with time zone, text)","expected_md5":["2d805ae5a23ec35cf5330be3d1d20744"]},{"signature":"public.gridex_record_invoice_purchase_request_v1(uuid, uuid, text, jsonb, uuid)","expected_md5":["f871d3eba9bf983cacb40bef4d2cf509"]},{"signature":"public.gridex_record_legacy_api_key_use_v1(uuid, text)","expected_md5":["b086bf84f02bdb31d5721d61c8e04f5c"]},{"signature":"public.gridex_record_source_discovery_v1(uuid, text, uuid, text, text, text)","expected_md5":["00aaddfb2d17f33c2f4ae74759df68b9"]},{"signature":"public.gridex_record_source_object_decisions_v1(uuid, text, uuid, text, uuid, text)","expected_md5":["37c69c3da57ac3e9002783a0bcc70965"]},{"signature":"public.gridex_record_source_validation_v1(uuid, text, uuid, text, text)","expected_md5":["327a1b5dc95365ea7ffa6c81911010f5"]},{"signature":"public.gridex_record_staff_identity_delivery_v1(jsonb)","expected_md5":["cdf884f554ed350745f81c070f53874c"]},{"signature":"public.gridex_refresh_actor_certificate_statuses(text)","expected_md5":["8adf5c5eb8026c21a9faabbcb88d197e"]},{"signature":"public.gridex_refresh_billing_export_run(uuid, uuid)","expected_md5":["36de9c779ac612fa3b823d717ab04f2b"]},{"signature":"public.gridex_refresh_customer_process_summary(uuid, uuid, text)","expected_md5":["5a0f32879e7dc63d64b6085cd2eca754"]},{"signature":"public.gridex_release_automation_lock(text, uuid)","expected_md5":["6aa200b13031458054908face546e024"]},{"signature":"public.gridex_remove_internal_contract_offer_v2(uuid, uuid, text, uuid, text)","expected_md5":["cb572ab6b53c8125f664e9a0b0ac0b8b"]},{"signature":"public.gridex_render_address(jsonb)","expected_md5":["310cefe9035cd49e84d276cfaa2aa53b"]},{"signature":"public.gridex_render_billing_information(jsonb)","expected_md5":["54d46aad0b0bbd8c21c47adcb579a75b"]},{"signature":"public.gridex_render_dispute_resolution(jsonb)","expected_md5":["c13ddeca4314a6f4b2b9f379418218cf"]},{"signature":"public.gridex_render_legal_document(text, jsonb, jsonb)","expected_md5":["bc4d5cceefc0ebabaa2fd64defaabb7c"]},{"signature":"public.gridex_required_legal_modules(text, text, text, boolean, boolean)","expected_md5":["8b6e1ed01fc1b62acee68440e9a63df0"]},{"signature":"public.gridex_required_legal_modules(text, text, text, boolean, boolean, boolean)","expected_md5":["14649ab2bd2361768ecb02d983b8500a"]},{"signature":"public.gridex_resolve_contract_lifecycle_graph(uuid, uuid)","expected_md5":["f12f237c003635eeed33fb321dad3229"]},{"signature":"public.gridex_resolve_customer_match_review_case(uuid, text, uuid, uuid, text)","expected_md5":["746b74a7daa98e13c712a5123690c4ca"]},{"signature":"public.gridex_resolve_ediel_route_for_process(uuid, text, text, text, text)","expected_md5":["26e4eb3710bdfb8698a38ebee8cd48a8"]},{"signature":"public.gridex_resolve_partner_api_offer_v1(uuid, text, text)","expected_md5":["da63b22dd05b8801b0ceb901a87f8c85"]},{"signature":"public.gridex_resolve_staff_identity_v1(jsonb)","expected_md5":["42d59694af83258122fdc6698fa59387"]},{"signature":"public.gridex_retry_website_contract_signature(uuid, uuid, uuid)","expected_md5":["4578a7a1bed7db8e8e84c16bf4297862"]},{"signature":"public.gridex_review_company_legal_profile(uuid, uuid)","expected_md5":["4f214c1edeee0a040424d76b60e68016"]},{"signature":"public.gridex_run_end_to_end_reconciliation(uuid)","expected_md5":["9a43e2d14570ff1576dd78961214c9ef"]},{"signature":"public.gridex_scan_ediel_canonical_repairs(uuid, boolean, uuid)","expected_md5":["d73b19db4a7f7a8cdffa66a74707809a"]},{"signature":"public.gridex_seed_company_onboarding_tasks(uuid)","expected_md5":["851d66f80a6226a495f1ec595fb9b5ee"]},{"signature":"public.gridex_select_invoice_provider_v1(uuid, text, text, uuid)","expected_md5":["0d826802760f311f60d2cac8683f4366"]},{"signature":"public.gridex_set_billing_period_lock_v1(uuid, text, boolean, text, uuid, text, jsonb)","expected_md5":["c80bc53c9071acd4f72857ace9c8dc9b"]},{"signature":"public.gridex_set_contract_channel_permission(uuid, uuid, text, boolean, uuid, text)","expected_md5":["80186b15ea203d9cff02c0aaf97ba70e"]},{"signature":"public.gridex_set_invoice_dispatch_enabled_v1(uuid, boolean, uuid)","expected_md5":["f686a983c637ac7a834833ee1b340ef7"]},{"signature":"public.gridex_set_metering_billing_gate(uuid, uuid, uuid, jsonb)","expected_md5":["f3b33679b5eac8bff84f2894503d8a52"]},{"signature":"public.gridex_snapshot_customer_portfolio_month(uuid, date)","expected_md5":["b4346da633c2f7b60a61f85e999ec67c"]},{"signature":"public.gridex_source_object_snapshot_v1(uuid, text, timestamp with time zone)","expected_md5":["ac3b367c7bcf31f4fc279e514b06e7c6"]},{"signature":"public.gridex_staff_active_membership_v1(uuid, uuid)","expected_md5":["61fbc416780275f72c9c57fd607413f7"]},{"signature":"public.gridex_staff_actor_permissions_v1(uuid, uuid, boolean)","expected_md5":["d8932cc7bb444fb8976244d8ced4bb0e"]},{"signature":"public.gridex_staff_anchor_invitation_email_v1(uuid, uuid, uuid)","expected_md5":["e772647704b4061516b9136e04b941b6"]},{"signature":"public.gridex_staff_assert_external_actor_v1(uuid, uuid, uuid)","expected_md5":["7060339c56dd1e1638cd2b07ba6a8d22"]},{"signature":"public.gridex_staff_assert_write_actor_v1(uuid, uuid, uuid, text)","expected_md5":["34ad7ffee9f9fb9f02f08eaa2c4549b7"]},{"signature":"public.gridex_staff_customer_id_for_reference_v1(uuid, text)","expected_md5":["571ff00bd8356e5a08b211a252e496fc"]},{"signature":"public.gridex_staff_customer_search_v1(uuid, text, integer, integer, text, text)","expected_md5":["b0b08262c79ba96e01ba0a7bb0d5db9c"]},{"signature":"public.gridex_staff_identity_invitation_v1(jsonb, boolean)","expected_md5":["470ed3a2f22e76f74fefffb2a16de6ae"]},{"signature":"public.gridex_staff_identity_registration_v1(jsonb, boolean)","expected_md5":["3c26785e72bf08d16d7b0bac8f19374a"]},{"signature":"public.gridex_staff_normalize_role_v1(text)","expected_md5":["7def5185614db73dfee8a3a910cdccff"]},{"signature":"public.gridex_staff_permission_overrides_v1(uuid, uuid)","expected_md5":["3ddf8008f28e84c11ccd694f5bd8cc68"]},{"signature":"public.gridex_staff_role_profile_v1(text)","expected_md5":["d87c0b5336465a3211533a8437ca2eee"]},{"signature":"public.gridex_staff_support_event(uuid, uuid, uuid, uuid, uuid, text, text, jsonb)","expected_md5":["6d4340e712d69ad5db8c607209483d17"]},{"signature":"public.gridex_staff_tenant_onboarding_ready_v1(jsonb)","expected_md5":["96db8fac24eb71a3107a55a4890b0237"]},{"signature":"public.gridex_staff_update_customer_case_status(uuid, uuid, uuid, uuid, text, text, text)","expected_md5":["611e4e003b837ea033673beb5aeda8da"]},{"signature":"public.gridex_stage_energy_geodata_features_v2(uuid, jsonb)","expected_md5":["d8cd31764aed90983f003e9a0fa85b5d"]},{"signature":"public.gridex_store_billing_underlay(uuid, jsonb, jsonb, uuid)","expected_md5":["308925b74ad93a3094cd73e02373754b"]},{"signature":"public.gridex_store_billing_underlay_batch(uuid, jsonb, uuid)","expected_md5":["94f3ec85815e96cc2a7caa4ff00455f6"]},{"signature":"public.gridex_submit_customer_move_out_v1(jsonb)","expected_md5":["05679da9bf9ff7a7362489e65cd3b7d4"]},{"signature":"public.gridex_supported_price_areas_v1(uuid)","expected_md5":["33772e07b6b1089c92731bea857d5ec1"]},{"signature":"public.gridex_sync_internal_offer_to_canonical(uuid)","expected_md5":["1c8ebde64d90611cbebaf221dbad9df7"]},{"signature":"public.gridex_tenant_legal_profile_readiness_status(tenant_legal_profiles)","expected_md5":["acce4667c5883bd439cc8c3a7145fdea"]},{"signature":"public.gridex_transition_customer_application_workflow(uuid, uuid, text, text, text, jsonb, uuid, integer, text)","expected_md5":["c0b6368393ff93f844db072abb36b37c"]},{"signature":"public.gridex_transition_supplier_switch_v1(uuid, uuid, jsonb, jsonb)","expected_md5":["974a2bd5fcac4559215613ff80048144"]},{"signature":"public.gridex_unlock_pricing_runs_for_month(uuid, text, uuid, text)","expected_md5":["531fd0d45ff6195ac77261aef9b5c75a"]},{"signature":"public.gridex_unpublish_contract_channel(uuid, uuid, text, uuid)","expected_md5":["b01153770b1e32f6607dddb5eed939c2"]},{"signature":"public.gridex_update_company_and_rebuild_legal_profile(uuid, uuid, jsonb, boolean)","expected_md5":["e98fa02cc5088875a32926cd3e5863f6"]},{"signature":"public.gridex_update_customer_case_status(uuid, uuid, text, uuid, text, text)","expected_md5":["b7c3b174325cdc337b55a696a145603d"]},{"signature":"public.gridex_update_customer_case_status_with_actor_v1(uuid, uuid, text, uuid, text, text, text, uuid)","expected_md5":["add3e506c2f25da0e23543eb637385f5"]},{"signature":"public.gridex_update_jsonb_row(regclass, uuid, uuid, jsonb)","expected_md5":["ec200cdc43a925e679537ae8fa54537f"]},{"signature":"public.gridex_upsert_internal_contract_offer(uuid, uuid, jsonb, jsonb, uuid)","expected_md5":["c6365e364572499b641cd3d9bac3a1fa"]},{"signature":"public.gridex_upsert_internal_contract_offer_v2(uuid,uuid,jsonb,jsonb,uuid)","expected_md5":["d68d5db35eb6bc25b607f7872c2ad3d7"]},{"signature":"public.gridex_user_can_read_whitelabel_platform(uuid)","expected_md5":["b99d9ea505ffcc2976f7582e9e779e2f"]},{"signature":"public.gridex_user_is_platform_admin()","expected_md5":["ee97149d35435bd4454091293a1c86ca"]},{"signature":"public.gridex_validate_contract_channel_readiness(uuid, uuid, text)","expected_md5":["3e6f17075bb37809dc9d59344c2c5131"]},{"signature":"public.gridex_validate_contract_readiness_v2(uuid, uuid, text, text)","expected_md5":["c025d0e25f085c73f2603f5cac1e1974"]},{"signature":"public.gridex_validate_publication_graph_v1(uuid)","expected_md5":["0dd2476e23abddbe5f212117c4426abe"]},{"signature":"public.gridex_validate_staff_identity_binding_v1(jsonb)","expected_md5":["11a534afb11dfe9b97c7e7a6fd8f8130"]},{"signature":"public.gridex_whitelabel_portfolio_overview(uuid, date)","expected_md5":["65f621d7f4238d3dd6671d48fab3e401"]},{"signature":"public.gridex_witness_correction_concern_v1(uuid, text, uuid, text)","expected_md5":["0d550ea8fc6d541f82631a2c9a1d1f4f"]},{"signature":"public.gridex_witness_document_reference_v1(uuid, text, uuid, text)","expected_md5":["d6410c53b344c3a79dee5ab48bd9a5a3"]},{"signature":"public.gridex_witness_source_objects_v1(uuid, text, uuid, text)","expected_md5":["3f0484a9bad97a27d5bf4dd3c2ba3b54"]},{"signature":"public.portal_customer_documents_page_v1(uuid, uuid, timestamp with time zone, integer, uuid, integer)","expected_md5":["b6cc7ab0e7464e175787fba5c36a5f46"]},{"signature":"public.portal_customer_events_page_v1(uuid, uuid, timestamp with time zone, integer, uuid, integer)","expected_md5":["f1edc1532db41fb724d16f032c1e23cc"]},{"signature":"public.public_contract_feed_fingerprint_v1(uuid, text, text)","expected_md5":["432b845ba6daaa136ff5526a06921a2f"]},{"signature":"public.resolve_canonical_ediel_rule_pack(text, text, text, text, text, date)","expected_md5":["3cb5081ad992c66326668df9dd878f85"]},{"signature":"public.resolve_ediel_ack_matrix_rule(text, text, uuid, text, text)","expected_md5":["c1cd7fd55e4373c86fd131f4711dce7b"]},{"signature":"public.resolve_ediel_rule_pack_fields(text, text, text, text, text, text, uuid)","expected_md5":["05e35bbbe31a96f598202fa4f96cab07"]},{"signature":"public.resolve_portal_customer_identity_v1(uuid, text, text, text, text, integer)","expected_md5":["a37cc1a11fdccdb4a1e53cd6638d48b0"]},{"signature":"public.run_tenant_integrity_audit(uuid, text, uuid)","expected_md5":["760fdc96d5cb43f3e7a3d774d591f414"]}]'::jsonb) LOOP
   -- Qualify only the three composite types explicitly public in their source declarations.
   diagnostic_lookup:=CASE diagnostic_spec->>'signature'
    WHEN 'gridex_utilts_binding.source_context_v1(ediel_messages)' THEN 'gridex_utilts_binding.source_context_v1(public.ediel_messages)'
    WHEN 'public.gridex_contract_channel_permission_allowed(tenant_contract_assignments, text)' THEN 'public.gridex_contract_channel_permission_allowed(public.tenant_contract_assignments, text)'
    WHEN 'public.gridex_tenant_legal_profile_readiness_status(tenant_legal_profiles)' THEN 'public.gridex_tenant_legal_profile_readiness_status(public.tenant_legal_profiles)'
    ELSE diagnostic_spec->>'signature' END;
   BEGIN
    diagnostic_oid:=pg_catalog.to_regprocedure(diagnostic_lookup);
   EXCEPTION WHEN undefined_object OR invalid_schema_name OR insufficient_privilege THEN
    GET STACKED DIAGNOSTICS diagnostic_sqlstate=RETURNED_SQLSTATE;
    diagnostic_mismatches:=diagnostic_mismatches||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'signature',diagnostic_spec->>'signature','expectedMD5',diagnostic_spec->'expected_md5',
     'state','unresolvable_signature','sqlstate',diagnostic_sqlstate));
    CONTINUE;
   END;
   IF diagnostic_oid IS NULL THEN
    diagnostic_mismatches:=diagnostic_mismatches||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'signature',diagnostic_spec->>'signature','expectedMD5',diagnostic_spec->'expected_md5','state','absent'));
    CONTINUE;
   END IF;
   SELECT * INTO STRICT diagnostic_function FROM pg_catalog.pg_proc WHERE oid=diagnostic_oid;
   IF diagnostic_spec->'expected_md5' ? pg_catalog.md5(diagnostic_function.prosrc) THEN CONTINUE;END IF;
   SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'key',pg_catalog.split_part(entry,'=',1),
    'value',CASE WHEN pg_catalog.split_part(entry,'=',1)='search_path' THEN pg_catalog.substr(entry,pg_catalog.strpos(entry,'=')+1) ELSE '<redacted>' END)
    ORDER BY ordinal),'[]'::jsonb) INTO diagnostic_config
    FROM pg_catalog.unnest(diagnostic_function.proconfig) WITH ORDINALITY c(entry,ordinal);
   diagnostic_mismatches:=diagnostic_mismatches||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'signature',diagnostic_spec->>'signature','expectedMD5',diagnostic_spec->'expected_md5','state','present',
    'actualMD5',pg_catalog.md5(diagnostic_function.prosrc),
    'actualSHA256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(diagnostic_function.prosrc,'UTF8')),'hex'),
    'actualBodyBytes',pg_catalog.octet_length(pg_catalog.convert_to(diagnostic_function.prosrc,'UTF8')),
    'owner',pg_catalog.pg_get_userbyid(diagnostic_function.proowner),
    'schema',(SELECT nspname FROM pg_catalog.pg_namespace WHERE oid=diagnostic_function.pronamespace),
    'language',(SELECT lanname FROM pg_catalog.pg_language WHERE oid=diagnostic_function.prolang),
    'inputTypes',pg_catalog.oidvectortypes(diagnostic_function.proargtypes),
    'returnType',pg_catalog.format_type(diagnostic_function.prorettype,NULL),
    'allArgumentTypes',(SELECT pg_catalog.jsonb_agg(pg_catalog.format_type(t,NULL) ORDER BY ordinal) FROM pg_catalog.unnest(diagnostic_function.proallargtypes) WITH ORDINALITY a(t,ordinal)),
    'attributes',pg_catalog.to_jsonb(diagnostic_function)-'prosrc'-'proconfig'-'proargdefaults'-'probin'-'prosqlbody',
    'config',diagnostic_config,
    'configSHA256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(diagnostic_function.proconfig)::text,'UTF8')),'hex'),
    'defaultsSHA256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(diagnostic_function.proargdefaults::text,'UTF8')),'hex'),
    'defaultsExpressionSHA256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_expr(diagnostic_function.proargdefaults,0),'UTF8')),'hex'),
    'qualifiedInputTypeIdentities',(SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('schema',n.nspname,'name',t.typname,'kind',t.typtype::text,
       'relation',(SELECT pg_catalog.jsonb_build_object('schema',rn.nspname,'name',c.relname,'kind',c.relkind::text,'reciprocalTypeBinding',c.reltype=t.oid)
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace rn ON rn.oid=c.relnamespace WHERE c.oid=t.typrelid))
      ORDER BY a.ordinal) FROM pg_catalog.unnest(diagnostic_function.proargtypes::oid[]) WITH ORDINALITY a(type_oid,ordinal)
      LEFT JOIN pg_catalog.pg_type t ON t.oid=a.type_oid LEFT JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace),
    'qualifiedReturnTypeIdentity',(SELECT pg_catalog.jsonb_build_object('schema',n.nspname,'name',t.typname,'kind',t.typtype::text,
       'relation',(SELECT pg_catalog.jsonb_build_object('schema',rn.nspname,'name',c.relname,'kind',c.relkind::text,'reciprocalTypeBinding',c.reltype=t.oid)
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace rn ON rn.oid=c.relnamespace WHERE c.oid=t.typrelid))
      FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE t.oid=diagnostic_function.prorettype),
    'qualifiedAllArgumentTypeIdentities',(SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('schema',n.nspname,'name',t.typname,'kind',t.typtype::text,
       'relation',(SELECT pg_catalog.jsonb_build_object('schema',rn.nspname,'name',c.relname,'kind',c.relkind::text,'reciprocalTypeBinding',c.reltype=t.oid)
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace rn ON rn.oid=c.relnamespace WHERE c.oid=t.typrelid))
      ORDER BY a.ordinal) FROM pg_catalog.unnest(diagnostic_function.proallargtypes) WITH ORDINALITY a(type_oid,ordinal)
      LEFT JOIN pg_catalog.pg_type t ON t.oid=a.type_oid LEFT JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace),
    'binarySHA256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(diagnostic_function.probin,'UTF8')),'hex'),
    'sqlBodySHA256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(diagnostic_function.prosqlbody::text,'UTF8')),'hex')));
  END LOOP;
  IF pg_catalog.jsonb_array_length(diagnostic_mismatches)>0 THEN
   -- Exact sanitized JSONB text bytes, not rendered function/default/config data.
   -- Raw 4096-byte chunks become at most 8192 ASCII hex bytes per NOTICE line.
   diagnostic_payload:=pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'stage',diagnostic_stage,'uniqueGuards',355,'sealedGuardOccurrences',357,
    'mismatchCount',pg_catalog.jsonb_array_length(diagnostic_mismatches),
    'mismatches',diagnostic_mismatches)::text,'UTF8');
   diagnostic_payload_sha:=pg_catalog.encode(pg_catalog.sha256(diagnostic_payload),'hex');
   diagnostic_chunk_count:=(pg_catalog.octet_length(diagnostic_payload)+diagnostic_chunk_bytes-1)/diagnostic_chunk_bytes;
   diagnostic_collection:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    diagnostic_format||E'\n'||diagnostic_stage||E'\n'||diagnostic_map_sha||E'\n'||diagnostic_payload_sha,'UTF8')),'hex');
   diagnostic_header:=pg_catalog.jsonb_build_object('format',diagnostic_format,
    'stage',diagnostic_stage,'collectionId',diagnostic_collection,
    'uniqueGuards',355,'sealedGuardOccurrences',357,'guardMapSHA256',diagnostic_map_sha,
    'mismatchCount',pg_catalog.jsonb_array_length(diagnostic_mismatches),
    'payloadBytes',pg_catalog.octet_length(diagnostic_payload),'payloadSHA256',diagnostic_payload_sha,
    'chunkBytes',diagnostic_chunk_bytes,'chunkCount',diagnostic_chunk_count);
   RAISE NOTICE 'ops_native_presealed_baseline_metadata_chunk_v3: %',
    diagnostic_header||pg_catalog.jsonb_build_object('kind','begin','sequence',0);
   FOR diagnostic_sequence IN 1..diagnostic_chunk_count LOOP
    diagnostic_chunk:=pg_catalog.substr(diagnostic_payload,(diagnostic_sequence-1)*diagnostic_chunk_bytes+1,diagnostic_chunk_bytes);
    RAISE NOTICE 'ops_native_presealed_baseline_metadata_chunk_v3: %',
     diagnostic_header||pg_catalog.jsonb_build_object('kind','chunk','sequence',diagnostic_sequence,
      'chunkRawBytes',pg_catalog.octet_length(diagnostic_chunk),
      'chunkSHA256',pg_catalog.encode(pg_catalog.sha256(diagnostic_chunk),'hex'),
      'dataHex',pg_catalog.encode(diagnostic_chunk,'hex'));
   END LOOP;
   RAISE NOTICE 'ops_native_presealed_baseline_metadata_chunk_v3: %',
    diagnostic_header||pg_catalog.jsonb_build_object('kind','end','sequence',diagnostic_chunk_count+1);
  END IF;
 END;
 -- END ops78 diagnostic-only insertion.
 EXECUTE convert_from(executable,'UTF8');
 -- Original sealed installer has returned. Assert its exact normalized rows first.
 FOR extra_snapshot IN SELECT value FROM jsonb_array_elements(extra_saved) LOOP
  SELECT * INTO STRICT extra_during FROM pg_catalog.pg_proc WHERE oid=(extra_snapshot->>'oid')::oid;
  IF extra_snapshot->>'role'='core' THEN
   IF(to_jsonb(extra_during)-'prosrc') IS DISTINCT FROM((extra_snapshot->'row')-'prosrc')
    OR extra_during.prosrc IS DISTINCT FROM extra_snapshot->>'old' THEN RAISE EXCEPTION 'all_signing_atomic_installer_changed_core';END IF;
  ELSIF to_jsonb(extra_during) IS DISTINCT FROM extra_snapshot->'row'
   OR pg_get_functiondef(extra_during.oid) IS DISTINCT FROM extra_snapshot->>'definition'
   THEN RAISE EXCEPTION 'all_signing_atomic_installer_changed_public';END IF;
 END LOOP;
 FOR extra_snapshot IN SELECT value FROM jsonb_array_elements(extra_saved) LOOP
  IF extra_snapshot->>'role'='core' AND signing_profile='canonical_wrapper' THEN EXECUTE extra_snapshot->>'definition';END IF;
 END LOOP;
 FOR extra_snapshot IN SELECT value FROM jsonb_array_elements(extra_saved) LOOP
  SELECT * INTO STRICT extra_during FROM pg_catalog.pg_proc WHERE oid=(extra_snapshot->>'oid')::oid;
  IF to_jsonb(extra_during) IS DISTINCT FROM extra_snapshot->'row'
   OR pg_get_functiondef(extra_during.oid) IS DISTINCT FROM extra_snapshot->>'definition'
   THEN RAISE EXCEPTION 'all_signing_atomic_exact_final_row_not_restored';END IF;
 END LOOP;
 SELECT * INTO STRICT signing_public_after FROM pg_catalog.pg_proc WHERE oid=signing_public;
 SELECT * INTO STRICT signing_core_during FROM pg_catalog.pg_proc WHERE oid=signing_core;
 IF to_jsonb(signing_public_after) IS DISTINCT FROM to_jsonb(signing_public_before)
 OR pg_get_functiondef(signing_public) IS DISTINCT FROM signing_public_definition
 OR(to_jsonb(signing_core_during)-'prosrc') IS DISTINCT FROM(to_jsonb(signing_core_before)-'prosrc')
 OR signing_core_during.prosrc IS DISTINCT FROM signing_old
 THEN RAISE EXCEPTION 'signing_atomic_installer_changed_known_signing_profile'; END IF;
 IF signing_profile='canonical_wrapper' THEN EXECUTE signing_core_definition; END IF;
 SELECT * INTO STRICT signing_public_after FROM pg_catalog.pg_proc WHERE oid=signing_public;
 SELECT * INTO STRICT signing_core_after FROM pg_catalog.pg_proc WHERE oid=signing_core;
 IF to_jsonb(signing_public_after) IS DISTINCT FROM to_jsonb(signing_public_before)
 OR to_jsonb(signing_core_after) IS DISTINCT FROM to_jsonb(signing_core_before)
 OR pg_get_functiondef(signing_public) IS DISTINCT FROM signing_public_definition
 OR pg_get_functiondef(signing_core) IS DISTINCT FROM signing_core_definition
 THEN RAISE EXCEPTION 'signing_atomic_exact_final_signing_rows_not_restored'; END IF;

 -- Restore only after every unchanged sealed component/global assertion completes.
 SELECT * INTO STRICT projection_during FROM pg_catalog.pg_proc WHERE oid=projection_target;
 IF (to_jsonb(projection_during)-'prosrc') IS DISTINCT FROM (to_jsonb(projection_before)-'prosrc')
 OR projection_during.prosrc IS DISTINCT FROM projection_old OR md5(projection_during.prosrc)<>'575139caedf161f007a16b64873bb727'
 THEN RAISE EXCEPTION 'sc031_atomic_replay_projection_installer_changed_identity'; END IF;
 IF projection_normalized THEN
  projection_definition:=pg_get_functiondef(projection_target);
  IF strpos(projection_definition,projection_old)=0 THEN RAISE EXCEPTION 'sc031_atomic_replay_projection_restore_definition_unknown'; END IF;
  EXECUTE replace(projection_definition,projection_old,projection_current);
 END IF;
 SELECT * INTO STRICT projection_after FROM pg_catalog.pg_proc WHERE oid=projection_target;
 IF to_jsonb(projection_after) IS DISTINCT FROM to_jsonb(projection_before)
 THEN RAISE EXCEPTION 'sc031_atomic_replay_projection_original_full_row_not_restored'; END IF;

 -- All eight component effects must complete before removing this private transport.
 
 IF NOT EXISTS (SELECT FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce' AND nspowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND nspacl=acldefault('n',(SELECT oid FROM pg_roles WHERE rolname='postgres'))) THEN RAISE EXCEPTION 'ops_compact_transport_schema_metadata_unknown'; END IF;
 IF EXISTS(SELECT FROM pg_namespace n CROSS JOIN pg_roles r WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce' AND r.rolname IN ('anon','authenticated','service_role','authenticator') AND (has_schema_privilege(r.rolname::text,n.oid,'USAGE') OR has_schema_privilege(r.rolname::text,n.oid,'CREATE') OR pg_has_role(r.rolname::text,'postgres','MEMBER') OR pg_has_role(r.rolname::text,'postgres','SET') OR pg_has_role(r.rolname::text,'postgres','USAGE'))) THEN RAISE EXCEPTION 'ops_compact_transport_app_privilege_forbidden'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce')<>2 OR NOT EXISTS(SELECT FROM pg_class c WHERE c.oid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND c.relkind='r' AND c.relpersistence='p' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND c.relrowsecurity AND c.relforcerowsecurity AND c.relacl=acldefault('r',c.relowner) AND c.reloptions IS NULL AND c.relam=(SELECT oid FROM pg_am WHERE amname='heap')) THEN RAISE EXCEPTION 'ops_compact_transport_relation_metadata_unknown'; END IF;
 IF EXISTS(SELECT FROM pg_depend d WHERE d.refclassid='pg_namespace'::regclass AND d.refobjid=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce') AND NOT ((d.classid='pg_class'::regclass AND d.objid IN ('ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass,'ops_api_atomic_transport_bb0bd0ce.payload_parts_pkey'::regclass)) OR (d.classid='pg_type'::regclass AND d.objid IN ('ops_api_atomic_transport_bb0bd0ce.payload_parts'::regtype,'ops_api_atomic_transport_bb0bd0ce._payload_parts'::regtype)))) THEN RAISE EXCEPTION 'ops_compact_transport_unexpected_namespace_object'; END IF;
 IF EXISTS(SELECT FROM pg_attribute WHERE attrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND attacl IS NOT NULL) THEN RAISE EXCEPTION 'ops_compact_transport_column_acl_forbidden'; END IF;
 IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce') OR EXISTS(SELECT FROM pg_policy WHERE polrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_trigger WHERE tgrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_rewrite WHERE ev_class='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_inherits WHERE inhrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass OR inhparent='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) OR EXISTS(SELECT FROM pg_attrdef WHERE adrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass) THEN RAISE EXCEPTION 'ops_compact_transport_extra_metadata_forbidden'; END IF;
 IF (SELECT jsonb_agg(jsonb_build_object('name',attname,'type',atttypid::regtype::text,'number',attnum,'notnull',attnotnull,'typmod',atttypmod,'identity',attidentity,'generated',attgenerated,'collation',attcollation::regcollation::text,'acl',attacl::text,'options',attoptions,'fdwoptions',attfdwoptions,'storage',attstorage,'compression',attcompression,'local',attislocal,'inheritance',attinhcount) ORDER BY attnum) FROM pg_attribute WHERE attrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND attnum>0) IS DISTINCT FROM '[{"name":"ordinal","type":"integer","number":1,"notnull":true,"typmod":-1,"identity":"","generated":"","collation":"-","acl":null,"options":null,"fdwoptions":null,"storage":"p","compression":"","local":true,"inheritance":0},{"name":"payload","type":"text","number":2,"notnull":true,"typmod":-1,"identity":"","generated":"","collation":"\"default\"","acl":null,"options":null,"fdwoptions":null,"storage":"x","compression":"","local":true,"inheritance":0}]'::jsonb THEN RAISE EXCEPTION 'ops_compact_transport_column_metadata_unknown'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass)<>1 OR NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND conname='payload_parts_pkey' AND contype='p' AND conkey=ARRAY[1]::smallint[] AND NOT condeferrable AND NOT condeferred AND convalidated AND conislocal AND coninhcount=0 AND conparentid=0 AND pg_get_constraintdef(oid)='PRIMARY KEY (ordinal)') THEN RAISE EXCEPTION 'ops_compact_transport_constraint_metadata_unknown'; END IF;
 IF NOT EXISTS(SELECT FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.oid='ops_api_atomic_transport_bb0bd0ce.payload_parts_pkey'::regclass AND c.relkind='i' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND c.relacl IS NULL AND c.reloptions IS NULL AND c.relpersistence='p' AND i.indrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND i.indisunique AND i.indisprimary AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate AND NOT i.indisexclusion AND NOT i.indisclustered AND NOT i.indisreplident AND NOT i.indnullsnotdistinct AND i.indnatts=1 AND i.indnkeyatts=1 AND i.indkey='1'::int2vector AND i.indcollation='0'::oidvector AND i.indoption='0'::int2vector AND i.indclass=(SELECT oid::text::oidvector FROM pg_opclass WHERE opcnamespace='pg_catalog'::regnamespace AND opcname='int4_ops' AND opcmethod=(SELECT oid FROM pg_am WHERE amname='btree')) AND i.indexprs IS NULL AND i.indpred IS NULL AND pg_get_indexdef(c.oid)='CREATE UNIQUE INDEX payload_parts_pkey ON ops_api_atomic_transport_bb0bd0ce.payload_parts USING btree (ordinal)') THEN RAISE EXCEPTION 'ops_compact_transport_index_metadata_unknown'; END IF;
 IF (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='ops_api_atomic_transport_bb0bd0ce')<>2 OR NOT EXISTS(SELECT FROM pg_type WHERE typnamespace=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce') AND typname='payload_parts' AND typtype='c' AND typrelid='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass AND typowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND typacl IS NULL) OR NOT EXISTS(SELECT FROM pg_type WHERE typnamespace=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce') AND typname='_payload_parts' AND typtype='b' AND typelem='ops_api_atomic_transport_bb0bd0ce.payload_parts'::regtype AND typowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND typacl IS NULL) THEN RAISE EXCEPTION 'ops_compact_transport_type_metadata_unknown'; END IF;
 IF EXISTS(SELECT FROM pg_depend WHERE deptype='e' AND ((classid='pg_namespace'::regclass AND objid=(SELECT oid FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce')) OR (classid='pg_class'::regclass AND objid IN ('ops_api_atomic_transport_bb0bd0ce.payload_parts'::regclass,'ops_api_atomic_transport_bb0bd0ce.payload_parts_pkey'::regclass)))) THEN RAISE EXCEPTION 'ops_compact_transport_extension_membership_forbidden'; END IF;
 IF EXISTS(SELECT FROM ops_api_atomic_transport_bb0bd0ce.payload_parts p LEFT JOIN (VALUES (1,80547,'aeac6d55ebfafc9c0d5ad30bf4dad37178fd46d9e52f43c846612fac1cc0b073'),(2,80547,'1056f8241fab935b5b36174658b4566d6562e7980f66a4f62399137708480f55'),(3,80547,'8d7736d9c18f0ec7e02c421907daf0f254ee9fe54aa61353e13d6827c8443f73'),(4,80547,'1f375fd1052f325b5a2e23f1c0a87d7a5c4c0c39c84b01ad6afa154865ecafc7'),(5,80547,'7ec7255e4de7f738c33eb48119de9d7d4dcbb2ed542e9136f9165824edc352c1'),(6,80547,'6e3ba08e32dd8605bd8a2378ba6cdfcec4d513eafdf55bd3fc2940b96dfa9749'),(7,80547,'7e941361061f7515bce84fb77b83f10c7dd1814356ac762bf12856d37abb4d2a'),(8,80547,'929b535701f910a90c5a2ead0a1a501bc631a04ecabc2b779c9a7286e25064f7'),(9,80547,'32b289b55a734020b96487e5498b908b8d1978a4878e8ab3470e0e73c6bdce5e'),(10,80547,'d0ca52a50e80383ced15051bcba9ca7e24e69858fa0be512c40cd4fbc6e975c3'),(11,80547,'e7773322ceb01f55240b0372e3ee234bb9cfd7bc8d8c572c867c585ee4bb76e7'),(12,80536,'8e9a209d6d969d1fc0435bcb564c05f54400a9faaf58ee4dcd3373d3013f91fa')) expected(ordinal,byte_count,digest) USING(ordinal) WHERE expected.ordinal IS NULL OR octet_length(convert_to(p.payload,'UTF8'))<>expected.byte_count OR encode(sha256(convert_to(p.payload,'UTF8')),'hex')<>expected.digest) THEN RAISE EXCEPTION 'ops_compact_transport_part_bytes_unknown'; END IF;

 DROP TABLE ops_api_atomic_transport_bb0bd0ce.payload_parts RESTRICT;
 DROP SCHEMA ops_api_atomic_transport_bb0bd0ce RESTRICT;
 IF EXISTS(SELECT FROM pg_namespace WHERE nspname='ops_api_atomic_transport_bb0bd0ce') THEN RAISE EXCEPTION 'ops_compact_transport_cleanup_postcheck_failed'; END IF;
END $ops_compact_apply$;
COMMIT;
