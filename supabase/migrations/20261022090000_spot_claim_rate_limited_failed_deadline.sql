-- PERF005 (issue #840 comment 6303205222, adopted on top of PR #870).
-- A spot import job that fails terminally on provider_rate_limited keeps the
-- provider's explicit Retry-After deadline in next_attempt_at (adapter change in
-- lib/pricing/spot/spotImportJobs.ts). The claim function must honour that
-- deadline for failed+provider_rate_limited exactly like retry_wait, for both
-- p_force=false and p_force=true. Only the single not-before predicate changes;
-- status/attempt policy is unchanged and an 'infinity' deadline never expires.
--
-- Guarded forward installer: it replaces only a known original (or already
-- adopted) body, verifies the complete pg_proc header and fails closed on any
-- unknown state, and proves OID/owner/ACL/header are preserved afterwards.
-- Ordinary catalog SELECT only; assumes DDL delivery is serialized by the migration runner.
DO $gridex_spot_claim_install$
DECLARE
  v_before pg_catalog.pg_proc%rowtype;
  v_after pg_catalog.pg_proc%rowtype;
  v_oid oid;
  v_known_header constant jsonb := '{"probin":null,"procost":100,"prokind":"f","proname":"gridex_claim_spot_price_import_job","prorows":1000,"pronargs":6,"proconfig":["search_path=public, pg_temp"],"proretset":true,"prosecdef":true,"prorettype":"2249","prosqlbody":null,"prosupport":"-","proargmodes":["i","i","i","i","i","i","t","t","t","t","t"],"proargnames":["p_provider","p_price_area","p_calendar_date","p_company_id","p_stale_after","p_force","id","claimed","status","attempt_count","correlation_id"],"proargtypes":["25","25","1082","2950","1186","16"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":["25","25","1082","2950","1186","16","2950","16","25","23","2950"],"pronargdefaults":3}'::jsonb;
  v_new_body constant text := $gridex_spot_claim_body$
declare
  v_job public.spot_price_import_jobs%rowtype;
begin
  if upper(coalesce(p_price_area,'')) not in ('SE1','SE2','SE3','SE4') then
    raise exception 'invalid_price_area' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(p_provider)) || ':' || upper(trim(p_price_area)) || ':' || p_calendar_date::text,0));

  select * into v_job
  from public.spot_price_import_jobs j
  where j.provider=lower(trim(p_provider))
    and j.price_area=upper(trim(p_price_area))
    and j.calendar_date=p_calendar_date
  for update;

  if not found then
    insert into public.spot_price_import_jobs(
      company_id,provider,price_area,calendar_date,status,attempt_count,started_at,completed_at,
      last_error_code,last_error_message,next_attempt_at,updated_at
    ) values (
      p_company_id,lower(trim(p_provider)),upper(trim(p_price_area)),p_calendar_date,'running',1,now(),null,
      null,null,null,now()
    ) returning * into v_job;
    return query select v_job.id,true,v_job.status,v_job.attempt_count,v_job.correlation_id;
    return;
  end if;

  if v_job.status='completed' and not coalesce(p_force,false) then
    return query select v_job.id,false,v_job.status,v_job.attempt_count,v_job.correlation_id;
    return;
  end if;

  if v_job.status='running' and v_job.started_at > now()-p_stale_after then
    return query select v_job.id,false,v_job.status,v_job.attempt_count,v_job.correlation_id;
    return;
  end if;

  if (v_job.status='retry_wait' or (v_job.status='failed' and v_job.last_error_code='provider_rate_limited'))
      and v_job.next_attempt_at is not null and v_job.next_attempt_at > now() then
    return query select v_job.id,false,v_job.status,v_job.attempt_count,v_job.correlation_id;
    return;
  end if;

  update public.spot_price_import_jobs j
  set company_id=coalesce(p_company_id,j.company_id),
      status='running',
      attempt_count=j.attempt_count+1,
      started_at=now(),
      completed_at=null,
      next_attempt_at=null,
      last_error_code=null,
      last_error_message=null,
      correlation_id=gen_random_uuid(),
      updated_at=now()
  where j.id=v_job.id
  returning * into v_job;

  return query select v_job.id,true,v_job.status,v_job.attempt_count,v_job.correlation_id;
end;
$gridex_spot_claim_body$;
  v_definition_header constant text := 'CREATE OR REPLACE FUNCTION public.gridex_claim_spot_price_import_job(p_provider text, p_price_area text, p_calendar_date date, p_company_id uuid DEFAULT NULL::uuid, p_stale_after interval DEFAULT ''00:15:00''::interval, p_force boolean DEFAULT false) RETURNS TABLE(id uuid, claimed boolean, status text, attempt_count integer, correlation_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''public'', ''pg_temp''
    AS ';
BEGIN
  v_oid := to_regprocedure('public.gridex_claim_spot_price_import_job(text,text,date,uuid,interval,boolean)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'spot_claim_install_missing_function';
  END IF;
  SELECT p.* INTO STRICT v_before FROM pg_catalog.pg_proc p WHERE p.oid=v_oid;
  IF encode(sha256(convert_to(v_before.prosrc,'UTF8')),'hex') NOT IN ('1f97134c4edc7e480965e26120495bb49fd4d7f7dfd6643e014c77774bb72ab6','f630ff2ff8e419eda3e314e789993b786c912150b87872c74dc9a17502787e26') THEN
    RAISE EXCEPTION 'spot_claim_install_unknown_body';
  END IF;
  IF (to_jsonb(v_before) - ARRAY['oid','proowner','proacl','prolang','pronamespace','proargdefaults','prosrc']) IS DISTINCT FROM v_known_header
      OR (SELECT l.lanname FROM pg_catalog.pg_language l WHERE l.oid=v_before.prolang) IS DISTINCT FROM 'plpgsql'
      OR v_before.pronamespace IS DISTINCT FROM 'public'::regnamespace::oid
      OR pg_get_function_arguments(v_oid) IS DISTINCT FROM 'p_provider text, p_price_area text, p_calendar_date date, p_company_id uuid DEFAULT NULL::uuid, p_stale_after interval DEFAULT ''00:15:00''::interval, p_force boolean DEFAULT false'
      OR pg_get_function_result(v_oid) IS DISTINCT FROM 'TABLE(id uuid, claimed boolean, status text, attempt_count integer, correlation_id uuid)' THEN
    RAISE EXCEPTION 'spot_claim_install_unknown_header';
  END IF;
  IF encode(sha256(convert_to(v_new_body,'UTF8')),'hex') IS DISTINCT FROM 'f630ff2ff8e419eda3e314e789993b786c912150b87872c74dc9a17502787e26' THEN
    RAISE EXCEPTION 'spot_claim_install_unknown_new_body';
  END IF;
  EXECUTE v_definition_header || quote_literal(v_new_body) || ';';
  SELECT p.* INTO STRICT v_after FROM pg_catalog.pg_proc p WHERE p.oid=v_oid;
  IF v_after.prosrc IS DISTINCT FROM v_new_body
      OR (to_jsonb(v_after) - 'prosrc') IS DISTINCT FROM (to_jsonb(v_before) - 'prosrc') THEN
    RAISE EXCEPTION 'spot_claim_install_metadata_changed';
  END IF;
END;
$gridex_spot_claim_install$;
