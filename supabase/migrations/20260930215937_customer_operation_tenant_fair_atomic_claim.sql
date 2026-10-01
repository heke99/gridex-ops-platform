begin;
create table private.customer_operation_tenant_turns(
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_claimed_at timestamptz not null
);
alter table private.customer_operation_tenant_turns enable row level security;
revoke all on private.customer_operation_tenant_turns from public,anon,authenticated;
grant select,insert,update on private.customer_operation_tenant_turns to service_role;
create index customer_operation_jobs_tenant_due_claim_idx
  on public.customer_operation_jobs(company_id,priority,run_after,created_at,id)
  where status in ('queued','running');

create or replace function public.gridex_claim_customer_operation_jobs(p_worker_id text,p_limit integer default 20)
returns setof public.customer_operation_jobs language plpgsql security invoker
set search_path=pg_catalog,public,private as $$
declare v_now timestamptz:=clock_timestamp(); v_limit integer:=greatest(1,least(coalesce(p_limit,20),100));
begin
  if current_user<>'service_role' then raise exception 'customer_operation_claim_service_required' using errcode='42501'; end if;
  -- Bound cleanup work as well as claims. Terminalization retains all former
  -- eligibility/diagnostic rules and advances over later worker invocations.
  with exhausted as materialized (
    select jobs.id from public.customer_operation_jobs jobs join public.companies company on company.id=jobs.company_id
    where company.status in ('active','onboarding') and coalesce(jobs.lifecycle_blocked_by_tenant,false)=false
      and jobs.attempts>=jobs.max_attempts and (
        (jobs.status='queued' and jobs.run_after<=v_now)
        or (jobs.status='running' and (jobs.locked_at is null or jobs.lock_token is null or jobs.locked_at<v_now-interval '15 minutes')))
    order by jobs.run_after,jobs.created_at,jobs.id limit v_limit for update of jobs skip locked
  )
  update public.customer_operation_jobs jobs set status='failed',
    last_error=coalesce(jobs.last_error,'customer_operation_retry_exhausted'),
    last_error_code=coalesce(jobs.last_error_code,'retry_exhausted'),
    last_error_message=coalesce(jobs.last_error_message,'Customer operation retry limit exhausted'),
    stale_reason=case when jobs.status='running' then coalesce(jobs.stale_reason,'retry_exhausted_after_stale_lock') else jobs.stale_reason end,
    completed_at=coalesce(jobs.completed_at,v_now),locked_at=null,locked_by=null,lock_token=null,heartbeat_at=null,updated_at=v_now
    from exhausted where jobs.id=exhausted.id;

  return query
  with due_tenants as materialized (
    select jobs.company_id,min(jobs.priority) as oldest_priority,min(jobs.run_after) as oldest_due
    from public.customer_operation_jobs jobs join public.companies company on company.id=jobs.company_id
    where company.status in ('active','onboarding') and coalesce(jobs.lifecycle_blocked_by_tenant,false)=false
      and jobs.attempts<jobs.max_attempts and (
        (jobs.status='queued' and jobs.run_after<=v_now
          and (jobs.locked_at is null or jobs.lock_token is null or jobs.locked_at<v_now-interval '15 minutes'))
        or (jobs.status='running' and (jobs.locked_at is null or jobs.lock_token is null or jobs.locked_at<v_now-interval '15 minutes')))
    group by jobs.company_id
  ), tenants as materialized (
    select due.*,turns.last_claimed_at from due_tenants due
    left join private.customer_operation_tenant_turns turns using(company_id)
    order by turns.last_claimed_at nulls first,due.oldest_priority,due.oldest_due,due.company_id limit v_limit
  ), candidates as materialized (
    select jobs.id,tenants.company_id,tenants.last_claimed_at,tenants.oldest_priority,tenants.oldest_due,
      jobs.priority,jobs.run_after,jobs.created_at,
      row_number() over(partition by tenants.company_id order by jobs.priority,jobs.run_after,jobs.created_at,jobs.id) as tenant_rank
    from tenants cross join lateral (
      select jobs.id,jobs.priority,jobs.run_after,jobs.created_at from public.customer_operation_jobs jobs
      where jobs.company_id=tenants.company_id and coalesce(jobs.lifecycle_blocked_by_tenant,false)=false
        and jobs.attempts<jobs.max_attempts and (
          (jobs.status='queued' and jobs.run_after<=v_now
            and (jobs.locked_at is null or jobs.lock_token is null or jobs.locked_at<v_now-interval '15 minutes'))
          or (jobs.status='running' and (jobs.locked_at is null or jobs.lock_token is null or jobs.locked_at<v_now-interval '15 minutes')))
      order by jobs.priority,jobs.run_after,jobs.created_at,jobs.id limit least(v_limit,5) for update of jobs skip locked
    ) jobs
  ), chosen as materialized (
    select * from candidates order by tenant_rank,last_claimed_at nulls first,oldest_priority,oldest_due,company_id,
      priority,run_after,created_at,id limit v_limit
  ), claimed as (
    update public.customer_operation_jobs jobs set status='running',attempts=jobs.attempts+1,locked_at=v_now,
      locked_by=nullif(trim(p_worker_id),''),lock_token=gen_random_uuid(),heartbeat_at=v_now,
      last_error=case when jobs.status='running' then coalesce(jobs.last_error,'stale_customer_operation_lock_reclaimed') else jobs.last_error end,
      updated_at=v_now from chosen where jobs.id=chosen.id returning jobs.*
  ), turns as (
    insert into private.customer_operation_tenant_turns(company_id,last_claimed_at)
    select distinct company_id,v_now from claimed on conflict(company_id) do update
      set last_claimed_at=greatest(customer_operation_tenant_turns.last_claimed_at,excluded.last_claimed_at) returning company_id
  )
  select claimed.* from claimed join chosen using(id) cross join (select count(*) from turns) persisted_turn
    order by chosen.tenant_rank,chosen.last_claimed_at nulls first,chosen.oldest_priority,chosen.oldest_due,
      chosen.company_id,chosen.priority,chosen.run_after,chosen.created_at,chosen.id;
end;
$$;
revoke all on function public.gridex_claim_customer_operation_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.gridex_claim_customer_operation_jobs(text,integer) to service_role;
commit;
