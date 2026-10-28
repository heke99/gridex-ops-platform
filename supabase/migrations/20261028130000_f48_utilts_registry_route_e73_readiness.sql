-- FINDINGS F48 / F35 (reality J2-13), owner decision 43: a grid owner's registry UTILTS route
-- (platform_actor_routes, no metadata.message_code) offered a readiness row without a message
-- code, and "Materialisera production-route" always failed with
-- utilts_application_reference_message_unsupported:missing. No E73 could ever be sent.
--
-- Owner decision 43: the supplier's first production UTILTS scope is E73 (missing E66 values;
-- S02 only with role, agreement and data right) plus the prescribed UTILTS-ERR. E74 and S07 are
-- not activated and the supplier never originates E66. UTILTS-ERR answers a received
-- transaction on the original's route and in its context, so it is no business route row.
--
-- The readiness view now offers the registry UTILTS route as its E73 row, the one code
-- lib/ediel/routeMaterializer.ts (registryRouteMessageCodes) materializes for UTILTS. A route
-- with an explicit metadata.message_code keeps exactly that row (the TypeScript materializer
-- refuses every UTILTS code other than E73). Only the CASE of the platform_routes CTE changes:
-- column list, column types, security_invoker, owner, grants and the dependent views stay
-- identical. No data is written; materialization stays an explicit platform-admin action.
--
-- Exact-needle rewrite of the installed definition (20261022121000): the needle must occur
-- exactly once and the marker must be absent; reloptions, owner and ACL are checked after.
begin;

set local lock_timeout = '5s';

do $f48$
declare
  needle constant text := $n$WHEN \(par\.message_family = 'PRODAT'::text\) THEN 'Z01'::text\s+ELSE NULL::text$n$;
  replacement constant text := $r$WHEN (par.message_family = 'PRODAT'::text) THEN 'Z01'::text WHEN (par.message_family = 'UTILTS'::text) THEN 'E73'::text ELSE NULL::text$r$;
  marker constant text := $m$WHEN (par.message_family = 'UTILTS'::text) THEN 'E73'::text$m$;
  v regclass := 'public.gridex_company_route_readiness_v'::regclass;
  before_meta jsonb;
  before_columns jsonb;
  definition text;
  rewritten text;
begin
  select jsonb_build_object('owner', c.relowner, 'acl', c.relacl::text, 'options', c.reloptions) into strict before_meta
  from pg_class c where c.oid = v;
  select jsonb_agg(jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod)) order by a.attnum) into before_columns
  from pg_attribute a where a.attrelid = v and a.attnum > 0 and not a.attisdropped;
  definition := pg_get_viewdef(v);
  if (select count(*) from regexp_matches(definition, needle, 'g')) <> 1
    or position(marker in definition) <> 0
    or before_meta->'options' is distinct from '["security_invoker=true"]'::jsonb then
    raise exception 'f48_utilts_readiness_predecessor_required' using errcode = 'P0U01';
  end if;
  rewritten := regexp_replace(definition, needle, replacement);
  execute format('create or replace view public.gridex_company_route_readiness_v with (security_invoker = true) as %s', rewritten);
  if (select jsonb_build_object('owner', c.relowner, 'acl', c.relacl::text, 'options', c.reloptions) from pg_class c where c.oid = v) is distinct from before_meta
    or (select jsonb_agg(jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod)) order by a.attnum)
          from pg_attribute a where a.attrelid = v and a.attnum > 0 and not a.attisdropped) is distinct from before_columns
    or position(marker in pg_get_viewdef(v)) = 0 then
    raise exception 'f48_utilts_readiness_metadata_changed' using errcode = 'P0U01';
  end if;
end
$f48$;

commit;
