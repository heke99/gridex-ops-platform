-- Source-guarded forward proposal; NOT an applied migration.
-- Preserve 20261013094514_data_quality_lifecycle_consistency.sql unchanged.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $quality_search_path$
DECLARE
  target oid := pg_catalog.to_regprocedure('public.gridex_data_quality_active_status_v1(text)');
  before_function pg_catalog.pg_proc%rowtype;
  after_function pg_catalog.pg_proc%rowtype;
BEGIN
  IF current_user <> 'postgres' OR target IS NULL THEN
    RAISE EXCEPTION 'ops_quality_status_owner_and_source_required';
  END IF;
  SELECT * INTO STRICT before_function FROM pg_catalog.pg_proc WHERE oid=target;
  IF pg_catalog.pg_get_userbyid(before_function.proowner) <> 'postgres'
     OR (SELECT lanname FROM pg_catalog.pg_language WHERE oid=before_function.prolang) <> 'sql'
     OR before_function.prokind <> 'f'
     OR before_function.provolatile <> 'i'
     OR before_function.prosecdef OR before_function.proleakproof OR before_function.proisstrict
     OR before_function.proretset OR before_function.proparallel <> 'u'
     OR before_function.procost <> 100 OR before_function.prorows <> 0
     OR before_function.pronargs <> 1 OR before_function.pronargdefaults <> 0
     OR before_function.prorettype <> 'boolean'::pg_catalog.regtype
     OR before_function.proargtypes <> '25'::pg_catalog.oidvector
     OR before_function.proargnames IS DISTINCT FROM ARRAY['p_status']::text[]
     OR before_function.proargmodes IS NOT NULL OR before_function.proallargtypes IS NOT NULL
     OR before_function.proargdefaults IS NOT NULL OR before_function.provariadic <> 0
     OR before_function.prosupport <> 0 OR before_function.protrftypes IS NOT NULL
     OR before_function.probin IS NOT NULL OR before_function.prosqlbody IS NOT NULL
     OR before_function.proacl::text[] IS DISTINCT FROM
        ARRAY['=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]
     OR pg_catalog.md5(before_function.prosrc) <> '30cf68244904f139fc60b89bf1fbf601'
     OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(before_function.prosrc,'UTF8')),'hex')
        <> '3e06f851eb682b0b6412a6332ef771e4c77591fbc527a97cefab9626f0baea28'
     OR (before_function.proconfig IS NOT NULL AND
         before_function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]) THEN
    RAISE EXCEPTION 'ops_quality_status_definition_or_metadata_unknown';
  END IF;
  IF before_function.proconfig IS NULL THEN
    ALTER FUNCTION public.gridex_data_quality_active_status_v1(text) SET search_path=pg_catalog;
  END IF;
  SELECT * INTO STRICT after_function FROM pg_catalog.pg_proc WHERE oid=target;
  IF after_function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR (pg_catalog.to_jsonb(before_function)-'proconfig') IS DISTINCT FROM
        (pg_catalog.to_jsonb(after_function)-'proconfig') THEN
    RAISE EXCEPTION 'ops_quality_status_unexpected_metadata_change';
  END IF;
END $quality_search_path$;
COMMIT;
