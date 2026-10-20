-- PRIVATE distinct forward after f712. NOT EXECUTED; no backfill or business RPC.
-- Historical f712 replay is not qualified after this later body alignment.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $cache_alignment$
DECLARE
 target oid;
 before_row pg_catalog.pg_proc%rowtype;
 after_row pg_catalog.pg_proc%rowtype;
 before_definition text;
 after_definition text;
 patched_body text;
 before_md5 constant text:='57ace4d5fe54d3e77dd0a0766c05262d';
 before_sha constant text:='d85b88ff2eb270af6821a6ecd206f9a38b6ad1dbb7c42978066180d1e06e326c';
 after_md5 constant text:='2e907d2864128e54edcd9b092688a897';
 after_sha constant text:='781d8eaf41dc87ebdc45d07e3c4235c2b0fa2fdb990e63cb65f4773b726a2e42';
 anchor constant text:=$old_anchor$  update public.customer_contracts set
    status='signed',signed_at=(v_signature->>'accepted_at')::timestamptz,
    is_distance_agreement=true,withdrawal_deadline_at=v_withdrawal_deadline,$old_anchor$;
 replacement constant text:=$new_anchor$  update public.customer_contracts set
    status='signed',signed_at=(v_signature->>'accepted_at')::timestamptz,
    snapshot_hash=v_price.snapshot_hash,
    is_distance_agreement=true,withdrawal_deadline_at=v_withdrawal_deadline,$new_anchor$;
 replay boolean:=false;
BEGIN
 IF current_user IS DISTINCT FROM 'postgres' OR session_user IS DISTINCT FROM 'postgres'
  OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
  OR(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'signing_price_cache_pg17_nosuper_postgres_required';END IF;
 target:=to_regprocedure('public.gridex_finalize_customer_contract_signature_v1(text,text,text)');
 SELECT * INTO STRICT before_row FROM pg_proc WHERE oid=target;
 IF pg_get_userbyid(before_row.proowner) IS DISTINCT FROM 'postgres'
  OR before_row.pronamespace IS DISTINCT FROM 'public'::regnamespace
  OR before_row.proname IS DISTINCT FROM 'gridex_finalize_customer_contract_signature_v1'
  OR(SELECT lanname FROM pg_language WHERE oid=before_row.prolang) IS DISTINCT FROM 'plpgsql'
  OR before_row.prokind IS DISTINCT FROM 'f'::"char"
  OR before_row.proargtypes IS DISTINCT FROM ARRAY['text'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid]::oidvector
  OR before_row.pronargs IS DISTINCT FROM 3::smallint
  OR before_row.proargnames IS DISTINCT FROM ARRAY['p_token_hash','p_signed_ip_hash','p_signed_user_agent']::text[]
  OR before_row.proallargtypes IS NOT NULL OR before_row.proargmodes IS NOT NULL
  OR before_row.pronargdefaults IS DISTINCT FROM 2::smallint
  OR pg_get_expr(before_row.proargdefaults,0) IS DISTINCT FROM 'NULL::text, NULL::text'
  OR before_row.provariadic IS DISTINCT FROM 0::oid
  OR before_row.prorettype IS DISTINCT FROM 'jsonb'::regtype OR before_row.proretset IS DISTINCT FROM false
  OR before_row.prosecdef IS DISTINCT FROM true OR before_row.proisstrict IS DISTINCT FROM false
  OR before_row.proleakproof IS DISTINCT FROM false
  OR before_row.provolatile IS DISTINCT FROM 'v'::"char" OR before_row.proparallel IS DISTINCT FROM 'u'::"char"
  OR before_row.procost IS DISTINCT FROM 100::real OR before_row.prorows IS DISTINCT FROM 0::real
  OR before_row.prosupport IS DISTINCT FROM 0::oid OR before_row.protrftypes IS NOT NULL
  OR before_row.probin IS NOT NULL OR before_row.prosqlbody IS NOT NULL
  OR before_row.proacl IS DISTINCT FROM ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[]
  OR before_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
  THEN RAISE EXCEPTION 'signing_price_cache_unknown_full_metadata';END IF;
 before_definition:=pg_get_functiondef(target);
 IF md5(before_row.prosrc)=after_md5 AND encode(sha256(convert_to(before_row.prosrc,'UTF8')),'hex')=after_sha THEN
  replay:=true;
 ELSIF md5(before_row.prosrc)=before_md5 AND encode(sha256(convert_to(before_row.prosrc,'UTF8')),'hex')=before_sha THEN
  IF length(before_row.prosrc)-length(replace(before_row.prosrc,anchor,'')) IS DISTINCT FROM length(anchor)
   THEN RAISE EXCEPTION 'signing_price_cache_exact_single_update_anchor_required';END IF;
  patched_body:=replace(before_row.prosrc,anchor,replacement);
  IF md5(patched_body) IS DISTINCT FROM after_md5
   OR encode(sha256(convert_to(patched_body,'UTF8')),'hex') IS DISTINCT FROM after_sha
   THEN RAISE EXCEPTION 'signing_price_cache_canonical_postbody_required';END IF;
  IF length(before_definition)-length(replace(before_definition,before_row.prosrc,'')) IS DISTINCT FROM length(before_row.prosrc)
   THEN RAISE EXCEPTION 'signing_price_cache_exact_single_definition_body_required';END IF;
  after_definition:=replace(before_definition,before_row.prosrc,patched_body);
  EXECUTE after_definition;
 ELSE RAISE EXCEPTION 'signing_price_cache_unknown_or_out_of_sequence_body';END IF;
 SELECT * INTO STRICT after_row FROM pg_proc WHERE oid=target;
 IF(to_jsonb(after_row)-'prosrc') IS DISTINCT FROM(to_jsonb(before_row)-'prosrc')
  OR md5(after_row.prosrc) IS DISTINCT FROM after_md5
  OR encode(sha256(convert_to(after_row.prosrc,'UTF8')),'hex') IS DISTINCT FROM after_sha
  OR pg_get_functiondef(target) IS DISTINCT FROM (CASE WHEN replay THEN before_definition ELSE after_definition END)
  THEN RAISE EXCEPTION 'signing_price_cache_full_postimage_or_metadata_changed';END IF;
 IF replay AND to_jsonb(after_row) IS DISTINCT FROM to_jsonb(before_row)
  THEN RAISE EXCEPTION 'signing_price_cache_replay_changed_full_row';END IF;
END
$cache_alignment$;
COMMIT;
