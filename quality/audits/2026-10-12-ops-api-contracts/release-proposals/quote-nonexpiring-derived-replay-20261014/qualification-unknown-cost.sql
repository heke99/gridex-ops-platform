BEGIN;
ALTER FUNCTION public.gridex_onboard_customer_graph_quote_commit_v2(jsonb) COST 101;
-- OPS replay-only derived artifact; not an applied migration or ledger claim.
-- Immutable source: migrations/20261013093906_ops_api_website_quote_nonexpiring_policy.sql
-- Source SHA256: 7eceae42dccce7a968182d144389329d1c11466bf0c896afff62250950f9f2ce
-- Preserve the canonical already-complete quote policy, or perform exactly the
-- original legacy TTL removal. No quote row, deadline or historical SQL changes.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $ops_quote_nonexpiring_replay$
DECLARE
 target oid:=to_regprocedure('public.gridex_onboard_customer_graph_quote_commit_v2(jsonb)');
 before_function pg_catalog.pg_proc%rowtype;
 after_function pg_catalog.pg_proc%rowtype;
 definition text;
 body_hash text;
 expiry_block constant text:=$anchor$  if v_quote.valid_until <= now() then
    raise exception using
      errcode = '23514',
      message = 'website_quote_expired';
  end if;
$anchor$;
BEGIN
 SELECT * INTO STRICT before_function FROM pg_catalog.pg_proc WHERE oid=target;
 IF pg_catalog.pg_get_userbyid(before_function.proowner)<>'postgres'
 OR before_function.prokind<>'f' OR before_function.prorettype<>'jsonb'::regtype
 OR before_function.proargtypes<>ARRAY['jsonb'::regtype::oid]::oidvector
 OR before_function.pronargs<>1 OR before_function.proallargtypes IS NOT NULL
 OR before_function.proargmodes IS NOT NULL OR before_function.proargnames IS DISTINCT FROM ARRAY['p_command']::text[]
 OR before_function.pronargdefaults<>0 OR before_function.proargdefaults IS NOT NULL
 OR before_function.proretset OR NOT before_function.prosecdef OR before_function.proisstrict OR before_function.proleakproof
 OR before_function.provolatile<>'v' OR before_function.proparallel<>'u'
 OR before_function.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_catalog, pg_temp']::text[]
 OR before_function.proacl IS DISTINCT FROM ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[]
 OR (SELECT lanname FROM pg_catalog.pg_language WHERE oid=before_function.prolang)<>'plpgsql'
 OR before_function.procost<>100 OR before_function.prorows<>0 OR before_function.provariadic<>0 OR before_function.prosupport<>0
 OR before_function.protrftypes IS NOT NULL OR before_function.probin IS NOT NULL OR before_function.prosqlbody IS NOT NULL
 THEN RAISE EXCEPTION 'ops_quote_replay_full_metadata_required'; END IF;
 definition:=pg_catalog.pg_get_functiondef(target);
 body_hash:=pg_catalog.md5(before_function.prosrc);
 IF body_hash='007d078d9d0065395edf2190d4f1d3b6' THEN
  IF pg_catalog.md5(definition)<>'fe9fcd88e137756d6b663b5bcaa7363f'
  OR strpos(before_function.prosrc,expiry_block)<>0
  OR strpos(before_function.prosrc,'website_quote_expired')<>0
  THEN RAISE EXCEPTION 'ops_quote_replay_canonical_nonexpiring_definition_required'; END IF;
  -- Verified no-op: no CREATE OR REPLACE and no business-row operation.
 ELSIF body_hash='4daec568bdaf10d1354ddd39145d0d94' THEN
  IF length(definition)-length(replace(definition,expiry_block,''))<>length(expiry_block)
  THEN RAISE EXCEPTION 'ops_quote_replay_exact_legacy_ttl_anchor_required'; END IF;
  definition:=replace(definition,expiry_block,'');
  IF pg_catalog.md5(definition)<>'fe9fcd88e137756d6b663b5bcaa7363f'
  THEN RAISE EXCEPTION 'ops_quote_replay_exact_canonical_transformation_required'; END IF;
  EXECUTE definition;
 ELSE RAISE EXCEPTION 'ops_quote_replay_unknown_predecessor';
 END IF;
 SELECT * INTO STRICT after_function FROM pg_catalog.pg_proc WHERE oid=target;
 IF (to_jsonb(after_function)-'prosrc') IS DISTINCT FROM (to_jsonb(before_function)-'prosrc')
 OR pg_catalog.md5(after_function.prosrc)<>'007d078d9d0065395edf2190d4f1d3b6'
 OR pg_catalog.md5(pg_catalog.pg_get_functiondef(target))<>'fe9fcd88e137756d6b663b5bcaa7363f'
 THEN RAISE EXCEPTION 'ops_quote_replay_function_identity_or_effect_changed'; END IF;
 IF body_hash='007d078d9d0065395edf2190d4f1d3b6' AND to_jsonb(after_function) IS DISTINCT FROM to_jsonb(before_function)
 THEN RAISE EXCEPTION 'ops_quote_replay_canonical_noop_changed'; END IF;
END $ops_quote_nonexpiring_replay$;


COMMIT;
