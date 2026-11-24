DO $migration$
DECLARE
  target constant regprocedure := 'public.gridex_claim_customer_operation_jobs(text,integer)'::regprocedure;
  predecessor_hash constant text := 'fa25e445709a94ea05ed5c14bca4f9dde0d447b18a8de1068b79de5b2ff4cd03';
  successor constant text := $body$
declare
  v_limit constant integer := greatest(1,least(coalesce(p_limit,20),100));
begin
  -- Terminalize jobs that have exhausted retries instead of leaving stale running rows forever.
  update public.customer_operation_jobs jobs
  set status='failed',
      last_error=coalesce(jobs.last_error,'customer_operation_retry_exhausted'),
      last_error_code=coalesce(jobs.last_error_code,'retry_exhausted'),
      last_error_message=coalesce(jobs.last_error_message,'Customer operation retry limit exhausted'),
      stale_reason=case when jobs.status='running'
        then coalesce(jobs.stale_reason,'retry_exhausted_after_stale_lock')
        else jobs.stale_reason end,
      completed_at=coalesce(jobs.completed_at,now()),
      locked_at=null,
      locked_by=null,
      lock_token=null,
      heartbeat_at=null,
      updated_at=now()
  from public.companies company
  where company.id=jobs.company_id
    and company.status in ('active','onboarding')
    and coalesce(jobs.lifecycle_blocked_by_tenant,false)=false
    and jobs.attempts>=jobs.max_attempts
    and (
      (jobs.status='queued' and jobs.run_after<=now())
      or
      (jobs.status='running' and (
        jobs.locked_at is null
        or jobs.lock_token is null
        or jobs.locked_at<now()-interval '15 minutes'
      ))
    );

  -- Select a bounded priority prefix before locking. A second batch leaves
  -- room for a concurrent worker without sorting every eligible row.
  return query
  with priority_prefix as materialized (
    select jobs.id
    from public.customer_operation_jobs jobs
    join public.companies company on company.id=jobs.company_id
    where company.status in ('active','onboarding')
      and coalesce(jobs.lifecycle_blocked_by_tenant,false)=false
      and jobs.attempts < jobs.max_attempts
      and (
        (
          jobs.status='queued'
          and jobs.run_after<=now()
          and (jobs.locked_at is null or jobs.lock_token is null or jobs.locked_at<now()-interval '15 minutes')
        )
        or
        (
          jobs.status='running'
          and (jobs.locked_at is null or jobs.lock_token is null or jobs.locked_at<now()-interval '15 minutes')
        )
      )
    order by jobs.priority asc,jobs.run_after asc,jobs.created_at asc
    limit (2 * v_limit)
  ), fast_candidates as materialized (
    select jobs.id
    from public.customer_operation_jobs jobs
    join priority_prefix prefix on prefix.id=jobs.id
    join public.companies company on company.id=jobs.company_id
    where company.status in ('active','onboarding')
      and coalesce(jobs.lifecycle_blocked_by_tenant,false)=false
      and jobs.attempts < jobs.max_attempts
      and (
        (
          jobs.status='queued'
          and jobs.run_after<=now()
          and (jobs.locked_at is null or jobs.lock_token is null or jobs.locked_at<now()-interval '15 minutes')
        )
        or
        (
          jobs.status='running'
          and (jobs.locked_at is null or jobs.lock_token is null or jobs.locked_at<now()-interval '15 minutes')
        )
      )
    order by jobs.priority asc,jobs.run_after asc,jobs.created_at asc
    for update of jobs skip locked
    limit v_limit
  ), remaining as materialized (
    -- Use the existing search only if the full prefix was present and a
    -- concurrent change or lock prevented this worker from filling the batch.
    select jobs.id
    from public.customer_operation_jobs jobs
    join public.companies company on company.id=jobs.company_id
    where company.status in ('active','onboarding')
      and coalesce(jobs.lifecycle_blocked_by_tenant,false)=false
      and jobs.attempts < jobs.max_attempts
      and (
        (
          jobs.status='queued'
          and jobs.run_after<=now()
          and (jobs.locked_at is null or jobs.lock_token is null or jobs.locked_at<now()-interval '15 minutes')
        )
        or
        (
          jobs.status='running'
          and (jobs.locked_at is null or jobs.lock_token is null or jobs.locked_at<now()-interval '15 minutes')
        )
      )
      and not exists (select 1 from fast_candidates picked where picked.id=jobs.id)
    order by jobs.priority asc,jobs.run_after asc,jobs.created_at asc
    for update of jobs skip locked
    limit case
      when (select count(*) from priority_prefix) = 2 * v_limit
      then v_limit - (select count(*) from fast_candidates)
      else 0
    end
  ), candidates as (
    select id from fast_candidates
    union all
    select id from remaining
  )
  update public.customer_operation_jobs jobs
  set status='running',
      attempts=jobs.attempts+1,
      locked_at=now(),
      locked_by=nullif(trim(p_worker_id),''),
      lock_token=gen_random_uuid(),
      heartbeat_at=now(),
      last_error=case when jobs.status='running'
        then coalesce(jobs.last_error,'stale_customer_operation_lock_reclaimed')
        else jobs.last_error end,
      updated_at=now()
  from candidates
  where jobs.id=candidates.id
  returning jobs.*;
end
$body$;
  installed record;
BEGIN
  SELECT p.oid, p.prosrc, pg_get_functiondef(p.oid) AS definition,
    to_jsonb(p)-'prosrc' AS metadata
  INTO STRICT installed
  FROM pg_catalog.pg_proc p
  WHERE p.oid=target;

  IF installed.prosrc=successor THEN
    RETURN;
  END IF;
  IF encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex') IS DISTINCT FROM predecessor_hash
    OR (length(installed.definition)-length(replace(installed.definition,installed.prosrc,'')))
        / length(installed.prosrc) <> 1 THEN
    RAISE EXCEPTION 'customer_operation_claim_sort_predecessor_changed';
  END IF;

  EXECUTE replace(installed.definition,installed.prosrc,successor);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_catalog.pg_proc p WHERE p.oid=installed.oid)
        IS DISTINCT FROM installed.metadata
    OR (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid=installed.oid)
        IS DISTINCT FROM successor THEN
    RAISE EXCEPTION 'customer_operation_claim_sort_postimage_changed';
  END IF;
END
$migration$;
