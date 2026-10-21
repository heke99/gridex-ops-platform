-- Align only the exact observed production body to its canonical predecessor
-- by restoring three omitted comment lines. No SQL/code token or data changes.
-- Existing b4aa production needs this alignment BEFORE unmodified 20261020164020.
-- Clean chronological replay already has canonical/post-20261020164020 source;
-- both known bodies are validated no-ops, never downgraded or re-created.
-- One atomic statement preserves every pg_proc attribute, owner, ACL and OID.
-- Serial DDL delivery is required; no arbitrary concurrent-DDL protection or
-- native/provider installation qualification is claimed by this source patch.
DO $account_comment_alignment$
DECLARE
 target_function oid;
 before_function pg_catalog.pg_proc%rowtype;
 before_metadata jsonb;
 after_metadata jsonb;
 before_source_hash text;
 after_source_hash text;
 aligned_body text;
 anchor constant text:=E'  if to_regclass(''auth.sessions'') is not null then\n';
 comment_lines constant text:=E'  -- Revoke existing authenticated sessions without deleting the auth identity.\n  -- The identity itself remains so the product can retain its established\n  -- account-closure semantics while authorization state is removed atomically.\n';
BEGIN
 target_function:=pg_catalog.to_regprocedure('public.anonymize_user_account(uuid)');
 IF target_function IS NULL THEN
  RAISE EXCEPTION 'account_closure_comment_alignment_existing_signature_required' USING ERRCODE='42883';
 END IF;
 SELECT p.* INTO STRICT before_function FROM pg_catalog.pg_proc p WHERE p.oid=target_function;
 before_metadata:=pg_catalog.to_jsonb(before_function)-'prosrc';
 IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='anonymize_user_account')<>1
 OR before_function.proowner IS DISTINCT FROM pg_catalog.to_regrole('postgres')::oid
 OR before_function.pronargs<>1
 OR before_function.proargtypes[0]<>'pg_catalog.uuid'::pg_catalog.regtype::oid
 OR before_function.proargnames IS DISTINCT FROM ARRAY['target_user_id']::text[]
 OR before_function.proallargtypes IS NOT NULL OR before_function.proargmodes IS NOT NULL
 OR before_function.proargdefaults IS NOT NULL OR before_function.pronargdefaults<>0
 OR before_function.provariadic<>0
 OR before_function.prorettype<>'pg_catalog.void'::pg_catalog.regtype::oid
 OR before_function.proretset OR before_function.prokind<>'f'
 OR before_function.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
 OR NOT before_function.prosecdef OR before_function.proisstrict OR before_function.proleakproof
 OR before_function.provolatile<>'v' OR before_function.proparallel<>'u'
 OR before_function.procost<>100 OR before_function.prorows<>0 OR before_function.prosupport<>0
 OR before_function.probin IS NOT NULL OR before_function.prosqlbody IS NOT NULL
 OR before_function.proconfig IS DISTINCT FROM ARRAY['search_path=public, auth, pg_catalog, pg_temp']::text[]
 OR pg_catalog.has_function_privilege('anon',target_function,'EXECUTE')
 OR NOT pg_catalog.has_function_privilege('authenticated',target_function,'EXECUTE')
 OR NOT pg_catalog.has_function_privilege('service_role',target_function,'EXECUTE')
 OR (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
       CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
       pg_catalog.pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
       ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END COLLATE "C")
     FROM pg_catalog.aclexplode(COALESCE(before_function.proacl,
       pg_catalog.acldefault('f',before_function.proowner))) a)
    IS DISTINCT FROM '[["authenticated","postgres","EXECUTE",false],["postgres","postgres","EXECUTE",false],["service_role","postgres","EXECUTE",false]]'::jsonb
 THEN RAISE EXCEPTION 'account_closure_comment_alignment_exact_header_owner_acl_required' USING ERRCODE='55000';END IF;
 before_source_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(before_function.prosrc,'UTF8')),'hex');
 -- Validate the complete header/ACL even on a known no-op. No CREATE OR REPLACE
 -- occurs on either known successor, preserving the actual catalog tuple too.
 IF before_source_hash IN('40ec063475b6a977585e58382358238b2ecf50c470c190d43a3c948f8cce4d97',
                         '410d33fda02e355323850769d063d7de3190c4aca7c82b33d64a4dc4be3e28e2') THEN RETURN;END IF;
 IF before_source_hash<>'b4aa9802e9fd9152174fcd7de5948bb30bf21eab6a319b9559d73b5ca83c9e73'
 OR pg_catalog.length(before_function.prosrc)-pg_catalog.length(pg_catalog.replace(before_function.prosrc,anchor,''))<>pg_catalog.length(anchor)
 THEN RAISE EXCEPTION 'account_closure_comment_alignment_exact_observed_source_required' USING ERRCODE='55000';END IF;
 aligned_body:=pg_catalog.replace(before_function.prosrc,anchor,comment_lines||anchor);
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(aligned_body,'UTF8')),'hex')
    <>'40ec063475b6a977585e58382358238b2ecf50c470c190d43a3c948f8cce4d97'
 THEN RAISE EXCEPTION 'account_closure_comment_alignment_exact_three_lines_required' USING ERRCODE='55000';END IF;
 EXECUTE pg_catalog.format('CREATE OR REPLACE FUNCTION public.anonymize_user_account(target_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,auth,pg_catalog,pg_temp AS %L',aligned_body);
 SELECT pg_catalog.to_jsonb(p)-'prosrc',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')
 INTO after_metadata,after_source_hash FROM pg_catalog.pg_proc p WHERE p.oid=target_function;
 IF after_metadata IS DISTINCT FROM before_metadata
 OR after_source_hash IS DISTINCT FROM '40ec063475b6a977585e58382358238b2ecf50c470c190d43a3c948f8cce4d97'
 THEN RAISE EXCEPTION 'account_closure_comment_alignment_full_metadata_and_source_must_preserve' USING ERRCODE='55000';END IF;
END $account_comment_alignment$;
