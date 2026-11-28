-- A source-qualified Z15V can shorten an existing reporting period. Use the
-- same effective instant for data scope, the deadline and the site's status.
-- Z15C still restores the prior ending's exact source facts. A prior
-- termination that has already become effective stays ended during restore.
DO $migration$
DECLARE
  signature CONSTANT text := 'gridex_received_sources.apply_permission_group_v1(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb,boolean)';
  predecessor_sha256 CONSTANT text := '2ee949a292d40627dc2bac5be4268dffee6124098de5cd378de39d344b784a03';
  qualified_sha256 CONSTANT text := 'd798889a8159e970f2dd35e6b832b92a0610257d3cdb7d3d9ea8e5a2a9441832';
  before_end CONSTANT text := $before$permission_end_at=end_time,status=CASE WHEN end_time>now() THEN status ELSE 'ended' END$before$;
  effective_end CONSTANT text := $after$permission_end_at=CASE WHEN mode='S17' THEN least(end_at,end_time) ELSE end_time END,
     status=CASE WHEN (CASE WHEN mode='S17' THEN least(end_at,end_time) ELSE end_time END)>now() THEN status ELSE 'ended' END$after$;
  before_restore CONSTANT text := $before$UPDATE public.metering_permission_sites ps SET status=old->>'status',end_date=$before$;
  effective_restore CONSTANT text := $after$UPDATE public.metering_permission_sites ps SET
     status=CASE WHEN mode='S17' AND old->>'status' IN ('approved','active')
      AND (old->>'permission_end_at')::timestamptz<=now() THEN 'ended' ELSE old->>'status' END,end_date=$after$;
  function_id pg_catalog.regprocedure := pg_catalog.to_regprocedure(signature);
  original pg_catalog.pg_proc%ROWTYPE;
  qualified pg_catalog.pg_proc%ROWTYPE;
  definition text;
  body text;
BEGIN
  IF function_id IS NULL THEN
    RAISE EXCEPTION 'permission_z15_effective_end_predecessor_required' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid = function_id;
  IF original.prokind IS DISTINCT FROM 'f'
    OR original.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
    OR original.prorettype IS DISTINCT FROM 'pg_catalog.jsonb'::pg_catalog.regtype
    OR original.prosecdef IS DISTINCT FROM true
    OR original.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']
    OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(original.prosrc,'UTF8')),'hex') IS DISTINCT FROM predecessor_sha256
    OR length(original.prosrc)-length(replace(original.prosrc,before_end,'')) <> length(before_end)
    OR length(original.prosrc)-length(replace(original.prosrc,before_restore,'')) <> length(before_restore)
  THEN
    RAISE EXCEPTION 'permission_z15_effective_end_predecessor_required' USING ERRCODE = '55000';
  END IF;
  body := replace(replace(original.prosrc,before_end,effective_end),before_restore,effective_restore);
  definition := pg_catalog.pg_get_functiondef(function_id);
  IF length(definition)-length(replace(definition,original.prosrc,'')) <> length(original.prosrc)
    OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(body,'UTF8')),'hex') IS DISTINCT FROM qualified_sha256
  THEN
    RAISE EXCEPTION 'permission_z15_effective_end_definition_changed' USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(definition,original.prosrc,body);
  SELECT * INTO STRICT qualified FROM pg_catalog.pg_proc WHERE oid = function_id;
  IF qualified.prosrc IS DISTINCT FROM body
    OR (to_jsonb(qualified)-'prosrc') IS DISTINCT FROM (to_jsonb(original)-'prosrc')
  THEN
    RAISE EXCEPTION 'permission_z15_effective_end_authority_changed' USING ERRCODE = '55000';
  END IF;
END
$migration$;
