-- PRIVATE compact post-sealed prepare correction; NOT APPLIED.
-- Equivalent business result to frozen 4a154989bb05c794c6677f7eb04d8934eff9a1e207b7e77d58c086848523d87d.
-- Only source-hash-validated existing PUBLIC CEE or renamed CORE CEE supplies the strong core body.
-- Native PUBLIC CEE/CORE 2be or canonical PUBLIC 1496/CORE CEE becomes PUBLIC 9f/CORE CEE.
-- Native PUBLIC search_path becomes pg_catalog; renamed core keeps its exact existing path.
-- No business RPC, rows, Auth/ACL/grant/owner change; execute only after unchanged sealed source.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $signing_retained_concurrency_forward$
DECLARE
 pub oid:=to_regprocedure('public.gridex_prepare_customer_contract_signature_request_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text)');
 core oid:=to_regprocedure('public.gridex_prepare_signature_before_record_retention_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text)');
 helper oid:=to_regprocedure('public.ediel_require_contract_records_available_v1(uuid,uuid)');
 pb pg_catalog.pg_proc%rowtype;pa pg_catalog.pg_proc%rowtype;cb pg_catalog.pg_proc%rowtype;ca pg_catalog.pg_proc%rowtype;
 hb pg_catalog.pg_proc%rowtype;ha pg_catalog.pg_proc%rowtype;f pg_catalog.pg_proc%rowtype;
 retention_owner oid;profile text;definition text;expected_acl aclitem[];expected_config text[];
 authority_before jsonb;authority_after jsonb;cee_body text;
 wrapper_body constant text:=$wrapper_body_source$BEGIN
 PERFORM public.ediel_require_contract_records_available_v1(p_company_id,p_contract_id);
 RETURN public.gridex_prepare_signature_before_record_retention_v1(p_company_id,p_customer_id,p_contract_id,p_token_hash,p_recipient_email,p_expires_at,p_actor_user_id,p_channel);
END$wrapper_body_source$;
 helper_body constant text:=$helper_body_source$BEGIN
 PERFORM id FROM public.customer_contracts WHERE id=p_contract_id AND company_id=p_company_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'customer_contract_record_scope_required';END IF;
 IF EXISTS(SELECT FROM gridex_ediel_retention.record_tombstones WHERE company_id=p_company_id AND contract_id=p_contract_id) THEN RAISE EXCEPTION 'customer_contract_records_retention_tombstoned';END IF;
END$helper_body_source$;
 concurrent_wrapper_body constant text:=$concurrent_wrapper_source$BEGIN
 -- Match the effective core's company-before-contract lock order.
 -- Do not reject missing/invalid inputs here: the retained helper and exact core
 -- keep their existing scope, customer, permission and expiry error precedence.
 PERFORM id FROM public.companies WHERE id=p_company_id FOR SHARE;
 PERFORM id FROM public.customer_contracts
 WHERE id=p_contract_id AND company_id=p_company_id FOR UPDATE;
 -- UPDATE is already held before helper SHARE; overlapping preparations serialize.
 PERFORM public.ediel_require_contract_records_available_v1(p_company_id,p_contract_id);
 -- Exact CEE core checks fresh expiry after these waits and again after every
 -- publication/snapshot/pending-request lock; actor and all inputs pass unchanged.
 RETURN public.gridex_prepare_signature_before_record_retention_v1(
  p_company_id,p_customer_id,p_contract_id,p_token_hash,p_recipient_email,
  p_expires_at,p_actor_user_id,p_channel
 );
END$concurrent_wrapper_source$;
 authority_query constant text:=$authority_metadata$
 SELECT jsonb_build_object(
  'role',(SELECT to_jsonb(r)-'rolpassword' FROM pg_roles r WHERE r.oid=$1),
  'all_roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_roles r),
  'auth_namespaces',(SELECT to_jsonb(n) FROM pg_namespace n WHERE n.nspname='auth'),
  'auth_classes',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace=to_regnamespace('auth')),
  'auth_functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace=to_regnamespace('auth')),
  'auth_columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace=to_regnamespace('auth')),
  'auth_triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace=to_regnamespace('auth')),
  'namespaces',(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_namespace n WHERE n.nspname IN('public','gridex_ediel_retention')),
  'tables',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c WHERE c.oid IN('public.companies'::regclass,'public.customer_contracts'::regclass,'gridex_ediel_retention.record_tombstones'::regclass)),
  'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a WHERE a.attrelid IN('public.companies'::regclass,'public.customer_contracts'::regclass,'gridex_ediel_retention.record_tombstones'::regclass)),
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE p.polrelid IN('public.companies'::regclass,'public.customer_contracts'::regclass,'gridex_ediel_retention.record_tombstones'::regclass)),
  'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m)
 )
 $authority_metadata$;
BEGIN
 SELECT * INTO STRICT pb FROM pg_proc WHERE oid=pub;
 SELECT * INTO STRICT cb FROM pg_proc WHERE oid=core;
 SELECT * INTO STRICT hb FROM pg_proc WHERE oid=helper;
 retention_owner:=(SELECT oid FROM pg_roles WHERE rolname='gridex_ediel_retention_owner');
 IF retention_owner IS NULL OR md5(helper_body)<>'fb147a8c9fa9e10f7f4e1c6ee8a8ecb3'
 OR hb.prosrc IS DISTINCT FROM helper_body OR md5(hb.prosrc)<>'fb147a8c9fa9e10f7f4e1c6ee8a8ecb3'
 OR encode(sha256(convert_to(hb.prosrc,'UTF8')),'hex')<>'b36aeada8feb12c51f24ea3689a1cf81e330ac47b5483081ba7134b3291c307c'
 OR hb.proowner IS DISTINCT FROM retention_owner OR hb.proacl IS DISTINCT FROM ARRAY['gridex_ediel_retention_owner=X/gridex_ediel_retention_owner','service_role=X/gridex_ediel_retention_owner']::aclitem[]
 OR hb.pronamespace IS DISTINCT FROM 'public'::regnamespace OR hb.prokind IS DISTINCT FROM 'f'::"char"
 OR hb.proargtypes IS DISTINCT FROM ARRAY['uuid'::regtype::oid,'uuid'::regtype::oid]::oidvector
 OR hb.proargnames IS DISTINCT FROM ARRAY['p_company_id','p_contract_id']::text[] OR hb.pronargs IS DISTINCT FROM 2::smallint
 OR hb.proallargtypes IS NOT NULL OR hb.proargmodes IS NOT NULL OR hb.pronargdefaults IS DISTINCT FROM 0::smallint OR hb.proargdefaults IS NOT NULL
 OR hb.prorettype IS DISTINCT FROM 'void'::regtype OR hb.proretset OR NOT hb.prosecdef OR hb.proisstrict OR hb.proleakproof
 OR hb.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR hb.provolatile IS DISTINCT FROM 'v'::"char" OR hb.proparallel IS DISTINCT FROM 'u'::"char"
 OR(SELECT lanname FROM pg_language WHERE oid=hb.prolang) IS DISTINCT FROM 'plpgsql'
 OR hb.procost IS DISTINCT FROM 100::real OR hb.prorows IS DISTINCT FROM 0::real OR hb.prosupport IS DISTINCT FROM 0::oid OR hb.provariadic IS DISTINCT FROM 0::oid
 OR hb.protrftypes IS NOT NULL OR hb.probin IS NOT NULL OR hb.prosqlbody IS NOT NULL
 THEN RAISE EXCEPTION 'signing_retained_concurrency_forward_exact_helper_metadata_required'; END IF;
 IF has_function_privilege('postgres',helper,'EXECUTE') IS DISTINCT FROM true
 OR has_table_privilege('postgres','public.companies','SELECT') IS DISTINCT FROM true
 OR has_table_privilege('postgres','public.companies','UPDATE') IS DISTINCT FROM true
 OR has_table_privilege('postgres','public.customer_contracts','SELECT') IS DISTINCT FROM true
 OR has_table_privilege('postgres','public.customer_contracts','UPDATE') IS DISTINCT FROM true
 OR has_schema_privilege('postgres','public','USAGE') IS DISTINCT FROM true
 OR has_schema_privilege('gridex_ediel_retention_owner','public','USAGE') IS DISTINCT FROM true
 OR has_schema_privilege('gridex_ediel_retention_owner','gridex_ediel_retention','USAGE') IS DISTINCT FROM true
 OR has_table_privilege('gridex_ediel_retention_owner','public.customer_contracts','SELECT') IS DISTINCT FROM true
 OR has_table_privilege('gridex_ediel_retention_owner','public.customer_contracts','UPDATE') IS DISTINCT FROM true
 OR has_table_privilege('gridex_ediel_retention_owner','gridex_ediel_retention.record_tombstones','SELECT') IS DISTINCT FROM true
 OR NOT EXISTS(SELECT FROM pg_roles r WHERE r.oid=retention_owner AND NOT r.rolsuper AND NOT r.rolcanlogin AND NOT r.rolinherit AND r.rolbypassrls)
 OR EXISTS(SELECT FROM (VALUES('public.companies','id','uuid'),('public.customer_contracts','id','uuid'),('public.customer_contracts','company_id','uuid'),('gridex_ediel_retention.record_tombstones','company_id','uuid'),('gridex_ediel_retention.record_tombstones','contract_id','uuid')) req(rel,col,typ)
  WHERE NOT EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid=to_regclass(req.rel) AND a.attname=req.col AND NOT a.attisdropped AND format_type(a.atttypid,a.atttypmod)=req.typ))
 THEN RAISE EXCEPTION 'signing_retained_concurrency_forward_helper_effective_authority_required'; END IF;
 -- Source bodies match frozen 4a154989 bytes; no business function is rebuilt from a weaker core.
 IF md5(wrapper_body)<>'1496a94629cf9f43d9fbd5d7d0f3f8e5'
 OR encode(sha256(convert_to(wrapper_body,'UTF8')),'hex')<>'363f59e6f738f8e09c57ebb52f3fad7c57c341a7fa3820ba5d9855a9800f5c5f'
 OR md5(concurrent_wrapper_body)<>'9fba28d7a4f594b7b4d06998490c0f27'
 OR encode(sha256(convert_to(concurrent_wrapper_body,'UTF8')),'hex')<>'b760a13e2388f791046a771fa0d1c79a76a3c1334fb3eff43140abdcdc402577'
 THEN RAISE EXCEPTION 'signing_retained_concurrency_forward_source_literals_unknown'; END IF;
 IF md5(pb.prosrc)='cee1222f070383e440a9fd4f71cdf591'
 AND encode(sha256(convert_to(pb.prosrc,'UTF8')),'hex')='5d4607c3e181b97856cc8e8ddcce13adc27234baf76f3f8a418fe03be58dbbb7'
 AND md5(pg_get_functiondef(pub))='0e6cbec5c3c542330d33e88be75ed060'
 AND md5(cb.prosrc)='2be908317a4861f6f38fcc293df30845'
 AND encode(sha256(convert_to(cb.prosrc,'UTF8')),'hex')='4ce8cbdec1d60d9eec23133f0b39fa48154edcb376f79496132f9badfa2d1f8c'
 THEN profile:='native_pair';cee_body:=pb.prosrc;
 ELSIF pb.prosrc=wrapper_body
 AND md5(cb.prosrc)='cee1222f070383e440a9fd4f71cdf591'
 AND encode(sha256(convert_to(cb.prosrc,'UTF8')),'hex')='5d4607c3e181b97856cc8e8ddcce13adc27234baf76f3f8a418fe03be58dbbb7'
 THEN profile:='canonical_target';cee_body:=cb.prosrc;
 ELSIF pb.prosrc=concurrent_wrapper_body
 AND md5(cb.prosrc)='cee1222f070383e440a9fd4f71cdf591'
 AND encode(sha256(convert_to(cb.prosrc,'UTF8')),'hex')='5d4607c3e181b97856cc8e8ddcce13adc27234baf76f3f8a418fe03be58dbbb7'
 THEN profile:='concurrent_target';cee_body:=cb.prosrc;
 ELSE RAISE EXCEPTION 'signing_retained_concurrency_forward_unknown_or_mixed_pair'; END IF;
 FOR f IN SELECT p.* FROM pg_proc p WHERE p.oid IN(pub,core) LOOP
  expected_acl:=CASE WHEN f.oid=pub THEN ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[] ELSE ARRAY['postgres=X/postgres']::aclitem[] END;
  expected_config:=CASE WHEN f.oid=pub AND profile<>'native_pair' THEN ARRAY['search_path=pg_catalog']::text[] ELSE ARRAY['search_path=public, private, extensions, pg_temp']::text[] END;
  IF pg_get_userbyid(f.proowner) IS DISTINCT FROM 'postgres'
  OR f.pronamespace IS DISTINCT FROM 'public'::regnamespace OR f.prokind IS DISTINCT FROM 'f'::"char"
  OR f.proacl IS DISTINCT FROM expected_acl
  OR f.proargtypes IS DISTINCT FROM ARRAY['uuid'::regtype::oid,'uuid'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'timestamptz'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid]::oidvector
  OR f.pronargs IS DISTINCT FROM 8::smallint OR f.proallargtypes IS NOT NULL OR f.proargmodes IS NOT NULL
  OR f.proargnames IS DISTINCT FROM ARRAY['p_company_id','p_customer_id','p_contract_id','p_token_hash','p_recipient_email','p_expires_at','p_actor_user_id','p_channel']::text[]
  OR f.prorettype IS DISTINCT FROM 'jsonb'::regtype OR f.proretset
  OR f.pronargdefaults IS DISTINCT FROM 1::smallint OR pg_get_expr(f.proargdefaults,0) IS DISTINCT FROM $default_literal$'internal'::text$default_literal$
  OR NOT f.prosecdef OR f.proisstrict OR f.proleakproof
  OR f.provolatile IS DISTINCT FROM 'v'::"char" OR f.proparallel IS DISTINCT FROM 'u'::"char"
  OR f.proconfig IS DISTINCT FROM expected_config
  OR(SELECT lanname FROM pg_language WHERE oid=f.prolang) IS DISTINCT FROM 'plpgsql'
  OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
  OR f.provariadic IS DISTINCT FROM 0::oid OR f.prosupport IS DISTINCT FROM 0::oid
  OR f.protrftypes IS NOT NULL OR f.probin IS NOT NULL OR f.prosqlbody IS NOT NULL
  THEN RAISE EXCEPTION 'signing_prepare_unknown_full_metadata: %',profile; END IF;
 END LOOP;
 EXECUTE authority_query INTO authority_before USING retention_owner;
 IF pb.prosrc IS DISTINCT FROM concurrent_wrapper_body THEN
  definition:=pg_get_functiondef(pub);
  IF length(definition)-length(replace(definition,pb.prosrc,''))<>length(pb.prosrc) THEN RAISE EXCEPTION 'signing_retained_concurrency_forward_public_definition_unknown'; END IF;
  EXECUTE replace(definition,pb.prosrc,concurrent_wrapper_body);
  ALTER FUNCTION public.gridex_prepare_customer_contract_signature_request_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text) SET search_path=pg_catalog;
 END IF;
 IF cb.prosrc IS DISTINCT FROM cee_body THEN
  definition:=pg_get_functiondef(core);
  IF length(definition)-length(replace(definition,cb.prosrc,''))<>length(cb.prosrc) THEN RAISE EXCEPTION 'signing_retained_concurrency_forward_core_definition_unknown'; END IF;
  EXECUTE replace(definition,cb.prosrc,cee_body);
 END IF;
 SELECT * INTO STRICT pa FROM pg_proc WHERE oid=pub;
 SELECT * INTO STRICT ca FROM pg_proc WHERE oid=core;
 SELECT * INTO STRICT ha FROM pg_proc WHERE oid=helper;
 EXECUTE authority_query INTO authority_after USING retention_owner;
 IF(to_jsonb(pa)-'prosrc'-'proconfig') IS DISTINCT FROM(to_jsonb(pb)-'prosrc'-'proconfig')
 OR pa.prosrc IS DISTINCT FROM concurrent_wrapper_body OR md5(pa.prosrc)<>'9fba28d7a4f594b7b4d06998490c0f27'
 OR pa.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR(to_jsonb(ca)-'prosrc') IS DISTINCT FROM(to_jsonb(cb)-'prosrc') OR ca.prosrc IS DISTINCT FROM cee_body OR md5(ca.prosrc)<>'cee1222f070383e440a9fd4f71cdf591'
 OR encode(sha256(convert_to(ca.prosrc,'UTF8')),'hex')<>'5d4607c3e181b97856cc8e8ddcce13adc27234baf76f3f8a418fe03be58dbbb7'
 OR to_jsonb(ha) IS DISTINCT FROM to_jsonb(hb) OR authority_after IS DISTINCT FROM authority_before
 OR has_function_privilege('postgres',helper,'EXECUTE') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'signing_retained_concurrency_forward_full_preservation_required'; END IF;
END $signing_retained_concurrency_forward$;
COMMIT;
