-- Prospective forward repair; NOT APPLIED by the pricing reviewer.
-- Restore the canonical non-expiring Website quote policy. A signing link's
-- separate token expiry is unrelated and is not changed by this repair.
-- Predecessor observed read-only on OPS piidsfebjqjmnepdpnas at
-- 2026-10-13 08:04:19 UTC. CREATE OR REPLACE preserves OID and existing ACL.
BEGIN;

DO $repair$
DECLARE
  v_definition text;
  v_body_md5 text;
  v_expiry_block text := $anchor$  if v_quote.valid_until <= now() then
    raise exception using
      errcode = '23514',
      message = 'website_quote_expired';
  end if;
$anchor$;
BEGIN
  SELECT pg_get_functiondef(p.oid), md5(p.prosrc)
    INTO STRICT v_definition, v_body_md5
  FROM pg_proc p
  WHERE p.oid='public.gridex_onboard_customer_graph_quote_commit_v2(jsonb)'::regprocedure;
  IF v_body_md5 IS DISTINCT FROM '4daec568bdaf10d1354ddd39145d0d94' THEN
    RAISE EXCEPTION 'website_quote_expiry_predecessor_changed';
  END IF;
  IF length(v_definition)-length(replace(v_definition,v_expiry_block,''))
     <> length(v_expiry_block) THEN
    RAISE EXCEPTION 'website_quote_expiry_exact_anchor_changed';
  END IF;
  -- Remove only the retired technical TTL rejection. Current status,
  -- tenant/quote/hash/selection/publication locks, consumption and replay
  -- checks remain byte-identical to the freshly inspected native definition.
  EXECUTE replace(v_definition,v_expiry_block,'');
END;
$repair$;

COMMIT;
