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
--   (a) Coalesce at most100 redundant pending/retry revalidation rows per call.
--       Processing leases, exhausted jobs and the newest row are retained. The
--       existing newer-future-retry policy remains: pending/retry successors
--       below max_attempts supersede old work even during their backoff.
--       The claim independently excludes the same logical supersession, so a
--       useful newest job never waits for the whole stale backlog to be cleaned.
--   (b) Rank oldest work per company, then use its durable maximum claim turn
--       before FIFO ties. A company served in a previous call cannot keep its
--       next old row ahead of an unserved eligible company. The owner-only
--       sequence allocates strict turns without relying on clock resolution.
--       A single company still fills the batch. Existing tenant decisions,
--       available_at/attempt predicates, job locks, leases and returns remain.
--       Only the added coalescing is bounded here; inherited stale-lease cleanup
--       remains the pre-existing separate housekeeping behavior.
--
-- Exact-needle rewrite of the installed body (20260810193450); refuses (g3_provisioning_claim_rule_source_changed)
-- unless every needle is present exactly once and the marker 'G-3 (20261024110000)' is absent. Owner, ACL, security,
-- volatility and configuration are preserved and checked (g3_provisioning_claim_metadata_changed).
begin;

-- Qualify before adding private scheduler state; repeat/unknown sources refuse
-- without leaving a column, sequence or index behind.
do $qualify$
begin
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc
   where oid='public.canonical_claim_company_provisioning_jobs(text,integer,integer)'::regprocedure)
   is distinct from '7f9020f11dac0ba4bc246ba42546ea81f814f74da0d7db040dccb9d80d640489' then
   raise exception 'g3_provisioning_claim_rule_source_changed' using errcode='P0U01';
 end if;
 if (select proowner from pg_proc where oid='public.canonical_claim_company_provisioning_jobs(text,integer,integer)'::regprocedure)
   is distinct from (select oid from pg_roles where rolname=current_user) then
   raise exception 'g3_provisioning_claim_owner_changed' using errcode='P0U01';
 end if;
 if exists(select 1 from pg_proc p where p.oid='public.canonical_claim_company_provisioning_jobs(text,integer,integer)'::regprocedure
   and (not p.prosecdef or p.proconfig is distinct from array['search_path=public, pg_temp']
     or p.prolang<>(select oid from pg_language where lanname='plpgsql') or p.provolatile<>'v'
     or p.proparallel<>'u' or p.proleakproof or not p.proretset or p.prorettype<>'record'::regtype or p.prokind<>'f'
     or p.proargnames is distinct from array['p_worker_id','p_limit','p_lease_seconds','id','company_id','job_key','idempotency_key','attempt_count','max_attempts','lease_token']
     or p.proallargtypes is distinct from array['text'::regtype,'integer'::regtype,'integer'::regtype,'uuid'::regtype,'uuid'::regtype,'text'::regtype,'text'::regtype,'integer'::regtype,'integer'::regtype,'uuid'::regtype]::oid[])) then
   raise exception 'g3_provisioning_claim_metadata_changed' using errcode='P0U01';
 end if;
end
$qualify$;
alter table public.company_provisioning_jobs add column claim_turn bigint not null default 0;
create sequence public.gridex_provisioning_claim_turn_seq as bigint minvalue 1 no cycle
 owned by public.company_provisioning_jobs.claim_turn;
revoke all on sequence public.gridex_provisioning_claim_turn_seq from public,anon,authenticated,service_role;
do $sequence_acl$
begin
 if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('S',c.relowner))) a
   where c.oid='public.gridex_provisioning_claim_turn_seq'::regclass and a.grantee<>c.relowner) then
   raise exception 'g3_provisioning_claim_turn_acl_changed' using errcode='P0U01';
 end if;
end
$sequence_acl$;
create index company_provisioning_jobs_company_claim_turn_idx
 on public.company_provisioning_jobs(company_id,claim_turn desc);
create index company_provisioning_jobs_revalidate_newer_idx
 on public.company_provisioning_jobs(company_id,created_at desc,id desc)
 include(status,attempt_count,max_attempts,idempotency_key)
 where job_key='ediel_readiness_revalidate';

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
  ), claimed as ($old1$,
$old2$        lease_token = gen_random_uuid(),
        last_error_code = null,$old2$
  ],
  array[
$new1$  -- G-3 (20261024110000): a readiness revalidation always evaluates the company's current snapshot, so an older
  -- unclaimed revalidate job is redundant once a newer one of the same company is completed, processing or claimable.
  -- At most100 rows are closed per call; logical exclusion below does not wait
  -- for all stale rows to be physically closed. Rows and audit evidence remain.
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
    order by stale.created_at,stale.id
    for update of stale skip locked
    limit 100
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

  -- G-3 (20261024110000): one oldest job per company precedes its second;
  -- durable last_turn rotates companies across calls even when p_limit is smaller
  -- than the company count. Clock ties and completed-row history do not reset it.
  return query
  with eligible_companies as materialized (
    select company.id as company_id,
      coalesce((select max(served.claim_turn) from public.company_provisioning_jobs served
        where served.company_id=company.id),0) as last_turn
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
           eligible.last_turn,
           job.available_at,
           job.created_at,
           row_number() over (partition by job.company_id order by job.available_at, job.created_at, job.id) as company_rank
    from public.company_provisioning_jobs job
    join eligible_companies eligible on eligible.company_id = job.company_id
    where job.status in ('pending','retry')
      and job.available_at <= now()
      and job.attempt_count < job.max_attempts
      and not (job.job_key='ediel_readiness_revalidate' and exists(
        select 1 from public.company_provisioning_jobs newer
        where newer.company_id=job.company_id and newer.job_key='ediel_readiness_revalidate'
          and (newer.created_at,newer.id)>(job.created_at,job.id)
          and (newer.status in('completed','processing')
            or (newer.status in('pending','retry') and newer.attempt_count<newer.max_attempts))))
  ), candidates as (
    select job.id
    from public.company_provisioning_jobs job
    join ranked fair on fair.id = job.id
    join public.companies company on company.id = job.company_id
    where job.status in ('pending','retry')
      and job.available_at <= now()
      and job.attempt_count < job.max_attempts
      and company.status in ('onboarding','active')
    order by fair.company_rank, fair.last_turn, fair.available_at, fair.created_at, job.id
    for update of job skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  ), claimed as ($new1$,
$new2$        lease_token = gen_random_uuid(),
        claim_turn = nextval('public.gridex_provisioning_claim_turn_seq'::regclass),
        last_error_code = null,$new2$
  ]
);

commit;
