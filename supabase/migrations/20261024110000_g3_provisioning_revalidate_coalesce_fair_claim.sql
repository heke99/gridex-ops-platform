-- FINDINGS G-3 (quality/audits/live-chain-20261015/FINDINGS.md): company_provisioning_jobs of kind
-- 'ediel_readiness_revalidate' are enqueued once per immutable configuration snapshot
-- (canonical_capture_ediel_configuration_snapshot_v1_unchecked, ON CONFLICT DO NOTHING per snapshot id) and were never
-- merged, while canonical_claim_company_provisioning_jobs took the 20 oldest jobs across ALL tenants. In the reality world
-- 1814 pending jobs of 292 tenants queued ahead of a new tenant, whose 27 jobs never progressed.
--
-- A revalidate job is redundant once a newer one exists for the same company: the worker
-- (lib/tenant/provisioningWorker.ts processEdielReadinessRevalidation) always evaluates and persists readiness for the
-- company's CURRENT snapshot (getCompanyProductionReadiness), never for the job's idempotency_key, and the job has no
-- other scope than the company. So:
--   (a) Coalesce at claim time: before claiming, every pending/retry revalidate job that has a newer (created_at, id)
--       revalidate job of the same company that is completed, processing, or still claimable (pending/retry below
--       max_attempts) is closed as status 'completed' with last_error_code 'superseded_by_newer_revalidation' and
--       last_error_details {superseded_by_job_id, superseded_by_idempotency_key, superseded_at}. The row is kept (audit
--       trail; the per-snapshot unique key and enqueue idempotency are unchanged), only jobs that were never claimed in
--       their current attempt are touched (processing leases and exhausted jobs awaiting dead-letter are never touched), and the newest job of a company is
--       never superseded.
--   (b) Fair claim: candidates are ranked per company (oldest first) and claimed round-robin by rank (each company's
--       first job before any company's second; work-conserving), so one tenant's backlog cannot starve other tenants. The tenant operation decision is
--       evaluated once per company instead of once per job. Eligibility (status, available_at, attempts, company
--       status, canonical_tenant_operation_decision 'tenant.provisioning.execute'), FOR UPDATE SKIP LOCKED, leases and
--       the limit bound are unchanged.
--
-- Exact-needle rewrite of the installed body (20260810193450); refuses (g3_provisioning_claim_rule_source_changed)
-- unless every needle is present exactly once and the marker 'G-3 (20261024110000)' is absent. Owner, ACL, security,
-- volatility and configuration are preserved and checked (g3_provisioning_claim_metadata_changed).
begin;

create function pg_temp.g3_rewrite(p_target regprocedure, p_old text[], p_new text[]) returns void
language plpgsql as $rewrite$
declare
  f record;
  body text;
  i integer;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = p_target;
  if position('G-3 (20261024110000)' in f.prosrc) <> 0
    or cardinality(p_old) <> cardinality(p_new)
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'g3_provisioning_claim_rule_source_changed:%', p_target using errcode = 'P0U01';
  end if;
  body := f.prosrc;
  for i in 1 .. cardinality(p_old) loop
    if (length(body) - length(replace(body, p_old[i], ''))) / length(p_old[i]) <> 1 then
      raise exception 'g3_provisioning_claim_rule_source_changed:%:%', p_target, i using errcode = 'P0U01';
    end if;
    body := replace(body, p_old[i], p_new[i]);
  end loop;
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'g3_provisioning_claim_metadata_changed:%', p_target using errcode = 'P0U01';
  end if;
end
$rewrite$;

select pg_temp.g3_rewrite(
  'public.canonical_claim_company_provisioning_jobs(text,integer,integer)'::regprocedure,
  array[
$old1$  return query
  with candidates as (
    select job.id
    from public.company_provisioning_jobs job
    join public.companies company on company.id = job.company_id
    where job.status in ('pending','retry')
      and job.available_at <= now()
      and job.attempt_count < job.max_attempts
      and company.status in ('onboarding','active')
      and (select decision.allowed
           from public.canonical_tenant_operation_decision(job.company_id, 'tenant.provisioning.execute') decision
           limit 1)
    order by job.available_at, job.created_at
    for update of job skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  ), claimed as ($old1$
  ],
  array[
$new1$  -- G-3 (20261024110000): a readiness revalidation always evaluates the company's current snapshot, so an older
  -- unclaimed revalidate job is redundant once a newer one of the same company is completed, processing or claimable.
  -- It is closed as superseded (row and audit trail kept); the newest job of a company is never superseded.
  with superseded as (
    select stale.id, newer.id as newer_id, newer.idempotency_key as newer_key
    from public.company_provisioning_jobs stale
    cross join lateral (
      select candidate.id, candidate.idempotency_key
      from public.company_provisioning_jobs candidate
      where candidate.company_id = stale.company_id
        and candidate.job_key = 'ediel_readiness_revalidate'
        and (candidate.created_at, candidate.id) > (stale.created_at, stale.id)
        and (candidate.status in ('completed','processing')
             or (candidate.status in ('pending','retry') and candidate.attempt_count < candidate.max_attempts))
      order by candidate.created_at desc, candidate.id desc
      limit 1
    ) newer
    where stale.job_key = 'ediel_readiness_revalidate'
      and stale.status in ('pending','retry')
      and stale.attempt_count < stale.max_attempts
    for update of stale skip locked
  )
  update public.company_provisioning_jobs stale
  set status = 'completed',
      completed_at = now(),
      last_error_code = 'superseded_by_newer_revalidation',
      last_error_message = null,
      last_error_details = jsonb_build_object(
        'superseded_by_job_id', superseded.newer_id,
        'superseded_by_idempotency_key', superseded.newer_key,
        'superseded_at', now()),
      locked_at = null,
      locked_by = null,
      lease_token = null,
      updated_at = now()
  from superseded
  where stale.id = superseded.id
    and stale.status in ('pending','retry');

  -- G-3 (20261024110000): fair claim. Eligible jobs are ranked per company (oldest first) and claimed round-robin by
  -- rank: every eligible company's oldest job goes before any company's second, so one tenant's backlog cannot starve
  -- the others, and a lone backlog still fills the whole limit.
  return query
  with eligible_companies as (
    select company.id as company_id
    from public.companies company
    where company.status in ('onboarding','active')
      and company.id in (
        select pending.company_id from public.company_provisioning_jobs pending
        where pending.status in ('pending','retry')
          and pending.available_at <= now()
          and pending.attempt_count < pending.max_attempts)
      and (select decision.allowed
           from public.canonical_tenant_operation_decision(company.id, 'tenant.provisioning.execute') decision
           limit 1)
  ), ranked as (
    select job.id,
           job.available_at,
           job.created_at,
           row_number() over (partition by job.company_id order by job.available_at, job.created_at, job.id) as company_rank
    from public.company_provisioning_jobs job
    join eligible_companies eligible on eligible.company_id = job.company_id
    where job.status in ('pending','retry')
      and job.available_at <= now()
      and job.attempt_count < job.max_attempts
  ), candidates as (
    select job.id
    from public.company_provisioning_jobs job
    join ranked fair on fair.id = job.id
    join public.companies company on company.id = job.company_id
    where job.status in ('pending','retry')
      and job.available_at <= now()
      and job.attempt_count < job.max_attempts
      and company.status in ('onboarding','active')
    order by fair.company_rank, fair.available_at, fair.created_at, job.id
    for update of job skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  ), claimed as ($new1$
  ]
);

commit;
