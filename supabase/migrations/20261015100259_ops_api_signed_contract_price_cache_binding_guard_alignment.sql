-- PRIVATE forward template. No timestamp/custody/native application is implied.
-- Fix only a changed signed-contract cache hash: it must equal its tenant/contract-bound ledger hash.
-- Original native and existing-qualified-component body/authority profiles are identical.
-- Unknown source/authority profiles fail closed; original pending-to-signed and retention lanes remain intact.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $signed_cache_binding_forward$
DECLARE
 v_oid oid;
 v_owner oid;
 v_namespace oid;
 v_before jsonb;
 v_after jsonb;
 v_definition text;
 v_after_definition text;
 v_source text;
 v_target text;
 v_authority_before jsonb;
 v_authority_after jsonb;
 v_original boolean;
 v_anchor constant text := $original_anchor$    end loop;

    if new.document_sha256 is distinct from old.document_sha256 then
$original_anchor$;
 v_replacement constant text := $replacement_anchor$    end loop;

    if new.snapshot_hash is distinct from old.snapshot_hash then
      if nullif(btrim(new.snapshot_hash),'') is null
         or not exists (
           select 1 from public.contract_price_snapshots p
           where p.id=old.contract_price_snapshot_id
             and p.company_id=old.company_id
             and p.contract_id=old.id
             and p.snapshot_hash=new.snapshot_hash
             and nullif(btrim(p.snapshot_hash),'') is not null
         ) then
        raise exception using errcode='55000',message='signed_customer_contract_price_hash_binding_invalid';
      end if;
    end if;

    if new.document_sha256 is distinct from old.document_sha256 then
$replacement_anchor$;
 v_expected_metadata constant jsonb := $metadata${"proacl":["gridex_ediel_retention_owner=X/gridex_ediel_retention_owner"],"probin":null,"procost":100,"prokind":"f","proname":"record_c40a67d5fa7766230451_guard_v1","prorows":0,"pronargs":0,"proconfig":["search_path=\"public, pg_catalog, pg_temp\""],"proretset":false,"prosecdef":false,"prorettype":"2279","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$metadata$::jsonb;
BEGIN
 IF current_user <> 'postgres' OR session_user <> 'postgres'
    OR current_setting('server_version_num')::integer / 10000 <> 17
    OR (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname='postgres') IS DISTINCT FROM false
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='signed_price_cache_forward_executor_profile_unknown'; END IF;
 SELECT oid INTO STRICT v_owner FROM pg_catalog.pg_roles WHERE rolname='gridex_ediel_retention_owner'
  AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolcreatedb
  AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls;
 SELECT oid INTO STRICT v_namespace FROM pg_catalog.pg_namespace
  WHERE nspname='gridex_ediel_retention' AND nspowner=v_owner
    AND nspacl::text[] = ARRAY['gridex_ediel_retention_owner=UC/gridex_ediel_retention_owner','postgres=U/gridex_ediel_retention_owner'];
 IF NOT pg_catalog.pg_has_role('postgres',v_owner,'SET')
    OR pg_catalog.pg_has_role('postgres',v_owner,'USAGE')
    OR NOT pg_catalog.has_schema_privilege(v_owner,v_namespace,'CREATE')
    OR NOT pg_catalog.has_schema_privilege(v_owner,v_namespace,'USAGE')
    OR pg_catalog.has_schema_privilege('postgres',v_namespace,'CREATE')
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='signed_price_cache_forward_owner_authority_unknown'; END IF;
 SELECT p.oid,to_jsonb(p),p.prosrc INTO STRICT v_oid,v_before,v_source
 FROM pg_catalog.pg_proc p
 WHERE p.pronamespace=v_namespace AND p.proname='record_c40a67d5fa7766230451_guard_v1'
   AND p.pronargs=0;
 IF v_before->>'proowner' <> v_owner::text
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_language l WHERE l.oid=(v_before->>'prolang')::oid AND l.lanname='plpgsql')
    OR v_before - ARRAY['oid','prosrc','proowner','prolang','pronamespace'] IS DISTINCT FROM v_expected_metadata
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='signed_price_cache_forward_function_profile_unknown'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
     JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
     JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='customer_contracts'
       AND t.tgname='customer_contracts_lock_signed' AND t.tgfoid=v_oid
       AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=27
       AND t.tgnargs=0 AND t.tgqual IS NULL AND octet_length(t.tgargs)=0)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='signed_price_cache_forward_trigger_profile_unknown'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT a.attisdropped
       AND ((c.relname='contract_price_snapshots' AND a.attname='snapshot_hash' AND a.atttypid='pg_catalog.text'::regtype AND a.attnotnull)
         OR (c.relname='customer_contracts' AND a.attname='snapshot_hash' AND a.atttypid='pg_catalog.text'::regtype AND NOT a.attnotnull))) <> 2
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='signed_price_cache_forward_columns_unknown'; END IF;
 v_original := octet_length(v_source)=3119 AND md5(v_source)='bc65fb5dce14ba0d003b050cda3389ec'
   AND encode(sha256(convert_to(v_source,'UTF8')),'hex')='6f77e381c01f5f3abd65428241bf0c86599ef85614d185c60ac80d2c4d85f63a';
 IF NOT v_original AND NOT (octet_length(v_source)=3723 AND md5(v_source)='d413658b065c282e3e64aea5f53fff6f'
   AND encode(sha256(convert_to(v_source,'UTF8')),'hex')='91fe59f41ba140cfd47ba766fb4fc0992e3985513ede3d90d0fc25bf15af276e')
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='signed_price_cache_forward_body_unknown'; END IF;
 v_definition:=pg_catalog.pg_get_functiondef(v_oid);
 SELECT jsonb_build_object(
 'roles',(SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_catalog.pg_roles r),
 'memberships',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.roleid,r.member,r.grantor) FROM pg_catalog.pg_auth_members r),
 'namespaces',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_catalog.pg_namespace r),
 'other_procedures',(SELECT md5(string_agg(to_jsonb(r)::text,E'\n' ORDER BY r.oid)) FROM pg_catalog.pg_proc r WHERE r.oid<>v_oid),
 'triggers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_catalog.pg_trigger r),
 'constraints',(SELECT md5(string_agg(to_jsonb(r)::text,E'\n' ORDER BY r.oid)) FROM pg_catalog.pg_constraint r),
 'relations',(SELECT md5(string_agg(to_jsonb(r)::text,E'\n' ORDER BY r.oid)) FROM pg_catalog.pg_class r),
 'attributes',(SELECT md5(string_agg(to_jsonb(r)::text,E'\n' ORDER BY r.attrelid,r.attnum)) FROM pg_catalog.pg_attribute r)
) INTO v_authority_before;
 IF v_original THEN
   IF (length(v_source)-length(replace(v_source,v_anchor,'')))/length(v_anchor)<>1
      OR (length(v_definition)-length(replace(v_definition,v_source,'')))/length(v_source)<>1
   THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='signed_price_cache_forward_anchor_not_unique'; END IF;
   v_target:=replace(v_source,v_anchor,v_replacement);
   IF octet_length(v_target)<>3723 OR encode(sha256(convert_to(v_target,'UTF8')),'hex')<>'91fe59f41ba140cfd47ba766fb4fc0992e3985513ede3d90d0fc25bf15af276e'
   THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='signed_price_cache_forward_postimage_mismatch'; END IF;
   EXECUTE 'SET LOCAL ROLE gridex_ediel_retention_owner';
   EXECUTE replace(v_definition,v_source,v_target);
   EXECUTE 'SET LOCAL ROLE postgres';
 ELSE v_target:=v_source;
 END IF;
 SELECT to_jsonb(p) INTO STRICT v_after FROM pg_catalog.pg_proc p WHERE p.oid=v_oid;
 v_after_definition:=pg_catalog.pg_get_functiondef(v_oid);
 SELECT jsonb_build_object(
 'roles',(SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_catalog.pg_roles r),
 'memberships',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.roleid,r.member,r.grantor) FROM pg_catalog.pg_auth_members r),
 'namespaces',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_catalog.pg_namespace r),
 'other_procedures',(SELECT md5(string_agg(to_jsonb(r)::text,E'\n' ORDER BY r.oid)) FROM pg_catalog.pg_proc r WHERE r.oid<>v_oid),
 'triggers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_catalog.pg_trigger r),
 'constraints',(SELECT md5(string_agg(to_jsonb(r)::text,E'\n' ORDER BY r.oid)) FROM pg_catalog.pg_constraint r),
 'relations',(SELECT md5(string_agg(to_jsonb(r)::text,E'\n' ORDER BY r.oid)) FROM pg_catalog.pg_class r),
 'attributes',(SELECT md5(string_agg(to_jsonb(r)::text,E'\n' ORDER BY r.attrelid,r.attnum)) FROM pg_catalog.pg_attribute r)
) INTO v_authority_after;
 IF current_user<>'postgres' OR session_user<>'postgres'
    OR v_after-'prosrc' IS DISTINCT FROM v_before-'prosrc'
    OR v_after->>'prosrc' IS DISTINCT FROM v_target
    OR v_after_definition IS DISTINCT FROM replace(v_definition,v_source,v_target)
    OR v_authority_after IS DISTINCT FROM v_authority_before
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='signed_price_cache_forward_postconditions_failed'; END IF;
 RAISE NOTICE 'signed_price_cache_forward:%',CASE WHEN v_original THEN 'installed' ELSE 'already_exact' END;
END;
$signed_cache_binding_forward$;
COMMIT;
