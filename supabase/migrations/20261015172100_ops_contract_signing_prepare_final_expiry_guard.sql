-- Gridex OPS canonical forward correction; applied migrations remain immutable.
-- Recheck signing-link expiry after request/event INSERT waits, before success.
-- Failed revalidation rolls back contract, previous links, new request and event.
-- Installation changes only the exact retained core body; authority stays unchanged.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $signing_prepare_final_expiry$
DECLARE
  target oid:=to_regprocedure('public.gridex_prepare_signature_before_record_retention_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text)');
  entrypoint oid:=to_regprocedure('public.gridex_prepare_customer_contract_signature_request_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text)');
  before_function pg_catalog.pg_proc%rowtype;
  after_function pg_catalog.pg_proc%rowtype;
  before_entrypoint pg_catalog.pg_proc%rowtype;
  after_entrypoint pg_catalog.pg_proc%rowtype;
  f pg_catalog.pg_proc%rowtype;
  definition text;
  next_body text;
  expected_acl aclitem[];
  expected_config text[];
  anchor constant text:=$return_anchor$  return jsonb_build_object(
    'ok',true,
    'request_id',v_request.id,$return_anchor$;
  addition constant text:=$final_expiry_guard$  -- INSERT foreign keys and request/event triggers can wait after the earlier check.
  -- Reject expiry after those waits; the exception rolls back all preparation.
  if p_expires_at is null or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp()+interval '14 days' then
    raise exception using errcode='22023',message='signature_request_expiry_invalid';
  end if;

$final_expiry_guard$;
BEGIN
  SELECT * INTO STRICT before_function FROM pg_proc WHERE oid=target;
  SELECT * INTO STRICT before_entrypoint FROM pg_proc WHERE oid=entrypoint;
  -- Accept the one current source pair, or this exact forward target on replay.
  IF md5(before_entrypoint.prosrc)<>'9fba28d7a4f594b7b4d06998490c0f27'
     OR encode(sha256(convert_to(before_entrypoint.prosrc,'UTF8')),'hex')<>'b760a13e2388f791046a771fa0d1c79a76a3c1334fb3eff43140abdcdc402577'
     OR octet_length(before_entrypoint.prosrc)<>937
     OR NOT (
       (md5(before_function.prosrc)='cee1222f070383e440a9fd4f71cdf591'
        AND encode(sha256(convert_to(before_function.prosrc,'UTF8')),'hex')='5d4607c3e181b97856cc8e8ddcce13adc27234baf76f3f8a418fe03be58dbbb7'
        AND octet_length(before_function.prosrc)=15588)
       OR (md5(before_function.prosrc)='d3e730a36f1a462dd9e76f0f71dd340e'
        AND encode(sha256(convert_to(before_function.prosrc,'UTF8')),'hex')='96ff30a1422207ad556da8648502fc36d002300a017be7aa793c621cc8d13596'
        AND octet_length(before_function.prosrc)=15974)
     ) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ops_signing_prepare_final_expiry_unknown_source_pair';
  END IF;
  FOR f IN SELECT p.* FROM pg_proc p WHERE p.oid IN(target,entrypoint) LOOP
    expected_acl:=CASE WHEN f.oid=entrypoint THEN ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[] ELSE ARRAY['postgres=X/postgres']::aclitem[] END;
    expected_config:=CASE WHEN f.oid=entrypoint THEN ARRAY['search_path=pg_catalog']::text[] ELSE ARRAY['search_path=public, private, extensions, pg_temp']::text[] END;
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
      OR (SELECT lanname FROM pg_language WHERE oid=f.prolang) IS DISTINCT FROM 'plpgsql'
      OR f.procost IS DISTINCT FROM 100::real OR f.prorows IS DISTINCT FROM 0::real
      OR f.provariadic IS DISTINCT FROM 0::oid OR f.prosupport IS DISTINCT FROM 0::oid
      OR f.protrftypes IS NOT NULL OR f.probin IS NOT NULL OR f.prosqlbody IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ops_signing_prepare_final_expiry_unknown_full_metadata';
    END IF;
  END LOOP;
  IF md5(before_function.prosrc)='cee1222f070383e440a9fd4f71cdf591' THEN
    IF (length(before_function.prosrc)-length(replace(before_function.prosrc,anchor,'')))/length(anchor)<>1 THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ops_signing_prepare_final_expiry_anchor_invalid';
    END IF;
    next_body:=replace(before_function.prosrc,anchor,addition||anchor);
    IF md5(next_body)<>'d3e730a36f1a462dd9e76f0f71dd340e'
       OR encode(sha256(convert_to(next_body,'UTF8')),'hex')<>'96ff30a1422207ad556da8648502fc36d002300a017be7aa793c621cc8d13596'
       OR octet_length(next_body)<>15974 THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ops_signing_prepare_final_expiry_transformed_body_mismatch';
    END IF;
    definition:=pg_get_functiondef(target);
    IF length(definition)-length(replace(definition,before_function.prosrc,''))<>length(before_function.prosrc) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ops_signing_prepare_final_expiry_definition_unknown';
    END IF;
    EXECUTE replace(definition,before_function.prosrc,next_body);
  END IF;
  SELECT * INTO STRICT after_function FROM pg_proc WHERE oid=target;
  SELECT * INTO STRICT after_entrypoint FROM pg_proc WHERE oid=entrypoint;
  IF (to_jsonb(after_function)-'prosrc') IS DISTINCT FROM (to_jsonb(before_function)-'prosrc')
     OR to_jsonb(after_entrypoint) IS DISTINCT FROM to_jsonb(before_entrypoint)
     OR md5(after_function.prosrc)<>'d3e730a36f1a462dd9e76f0f71dd340e'
     OR encode(sha256(convert_to(after_function.prosrc,'UTF8')),'hex')<>'96ff30a1422207ad556da8648502fc36d002300a017be7aa793c621cc8d13596'
     OR octet_length(after_function.prosrc)<>15974 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ops_signing_prepare_final_expiry_full_preservation_required';
  END IF;
END
$signing_prepare_final_expiry$;
COMMIT;
