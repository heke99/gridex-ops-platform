-- Reject a non-positive finite reporting interval on a fresh Z14 approval.
-- Keep the adopted Z15 effective-close behavior and prior permission history.
DO $migration$
DECLARE
  signature CONSTANT text := 'gridex_received_sources.apply_permission_group_v1(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb,boolean)';
  predecessor_sha256 CONSTANT text := 'd798889a8159e970f2dd35e6b832b92a0610257d3cdb7d3d9ea8e5a2a9441832';
  qualified_sha256 CONSTANT text := 'f51d566f50337fd3375430eac77b0560687e399f2c4e588c99af2c7e30d7c506';
  before_period CONSTANT text := '(end_day IS NOT NULL AND end_day<start_day)';
  positive_period CONSTANT text := $period$(end_day IS NOT NULL AND gridex_received_sources.permission_time_v1(a->>'reportEnd')
     <= gridex_received_sources.permission_time_v1(a->>'reportStart'))$period$;
  function_id pg_catalog.regprocedure := pg_catalog.to_regprocedure(signature);
  original pg_catalog.pg_proc%ROWTYPE;
  qualified pg_catalog.pg_proc%ROWTYPE;
  definition text;
  body text;
  actual_sha256 text;
BEGIN
  IF function_id IS NULL THEN
    RAISE EXCEPTION 'permission_z14_interval_predecessor_required' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid = function_id;
  IF original.prokind IS DISTINCT FROM 'f'
    OR original.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
    OR original.prorettype IS DISTINCT FROM 'pg_catalog.jsonb'::pg_catalog.regtype
    OR original.prosecdef IS DISTINCT FROM true
    OR original.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']
  THEN
    RAISE EXCEPTION 'permission_z14_interval_predecessor_required' USING ERRCODE = '55000';
  END IF;

  actual_sha256 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(original.prosrc,'UTF8')),'hex');
  IF actual_sha256 = qualified_sha256 THEN RETURN; END IF;
  IF actual_sha256 IS DISTINCT FROM predecessor_sha256
    OR length(original.prosrc)-length(replace(original.prosrc,before_period,'')) <> length(before_period)
  THEN
    RAISE EXCEPTION 'permission_z14_interval_predecessor_required' USING ERRCODE = '55000';
  END IF;

  body := replace(original.prosrc,before_period,positive_period);
  definition := pg_catalog.pg_get_functiondef(function_id);
  IF length(definition)-length(replace(definition,original.prosrc,'')) <> length(original.prosrc)
    OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(body,'UTF8')),'hex') IS DISTINCT FROM qualified_sha256
  THEN
    RAISE EXCEPTION 'permission_z14_interval_definition_changed' USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(definition,original.prosrc,body);
  SELECT * INTO STRICT qualified FROM pg_catalog.pg_proc WHERE oid = function_id;
  IF qualified.prosrc IS DISTINCT FROM body
    OR (to_jsonb(qualified)-'prosrc') IS DISTINCT FROM (to_jsonb(original)-'prosrc')
  THEN
    RAISE EXCEPTION 'permission_z14_interval_authority_changed' USING ERRCODE = '55000';
  END IF;
END
$migration$;
