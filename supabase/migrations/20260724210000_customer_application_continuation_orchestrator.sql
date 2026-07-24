-- Canonical customer-application continuation orchestrator.
--
-- The website API commits customer/application/legal references and a durable
-- continuation job in ONE PostgreSQL transaction. All mail, grid-owner, Ediel,
-- supplier-switch and webhook work may then be retried independently of the
-- request lifetime.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Rich, durable workflow state and transition audit.
-- ---------------------------------------------------------------------------
alter table if exists public.customer_application_workflows
  add column if not exists next_action text null,
  add column if not exists last_transition_at timestamptz not null default now(),
  add column if not exists workflow_version integer not null default 1,
  add column if not exists last_job_id uuid null;

alter table if exists public.customer_application_workflows
  drop constraint if exists customer_application_workflows_state_check;

alter table if exists public.customer_application_workflows
  add constraint customer_application_workflows_state_check check (state in (
    -- Legacy states retained for already-deployed data.
    'received','provisioning','provisioned','pending_customer_data','ready_for_switch','pending_review','failed','cancelled',
    -- Canonical continuation states.
    'application_received','validation_failed','canonical_data_committed',
    'initial_notifications_pending','initial_notifications_queued',
    'facility_information_check','facility_information_required',
    'facility_request_pending','facility_request_sent','waiting_for_facility_response',
    'facility_response_received','facility_response_needs_review','facility_information_completed',
    'switch_readiness_check','waiting_for_customer_data_response','switch_blocked','switch_request_pending',
    'switch_request_queued','switch_dispatched','waiting_for_switch_response',
    'switch_confirmed','switch_rejected','supply_activation_pending',
    'supply_active','completed','manual_review'
  ));

create table if not exists public.customer_application_workflow_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  workflow_id uuid not null references public.customer_application_workflows(id) on delete cascade,
  customer_application_id uuid not null references public.website_customer_applications(id) on delete cascade,
  operation_id uuid not null,
  from_state text null,
  to_state text not null,
  event_code text not null,
  reason_code text null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists customer_application_workflow_events_idempotency_uidx
  on public.customer_application_workflow_events(company_id, idempotency_key);
create index if not exists customer_application_workflow_events_workflow_idx
  on public.customer_application_workflow_events(company_id, workflow_id, occurred_at desc);

alter table public.customer_application_workflow_events enable row level security;

do $$
begin
  if to_regprocedure('public.gridex_can_read_company(uuid)') is not null
     and not exists (
       select 1 from pg_policies
       where schemaname='public' and tablename='customer_application_workflow_events'
         and policyname='customer_application_workflow_events_tenant_read'
     ) then
    create policy customer_application_workflow_events_tenant_read
      on public.customer_application_workflow_events
      for select to authenticated
      using (public.gridex_can_read_company(company_id));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='customer_application_workflow_events'
      and policyname='customer_application_workflow_events_service_role_all'
  ) then
    create policy customer_application_workflow_events_service_role_all
      on public.customer_application_workflow_events
      for all to service_role using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Reuse the canonical customer-operation queue for continuation jobs.
-- ---------------------------------------------------------------------------
alter table if exists public.customer_operation_jobs
  add column if not exists workflow_id uuid null references public.customer_application_workflows(id) on delete cascade,
  add column if not exists payload_version integer not null default 1,
  add column if not exists last_error_code text null,
  add column if not exists last_error_message text null;

create index if not exists customer_operation_jobs_workflow_idx
  on public.customer_operation_jobs(company_id, workflow_id, created_at desc)
  where workflow_id is not null;

-- One durable continuation job per workflow. Replay/reconciliation requeues the
-- same row instead of creating a competing workflow.
create unique index if not exists customer_operation_jobs_application_continuation_uidx
  on public.customer_operation_jobs(company_id, workflow_id, job_type)
  where workflow_id is not null and job_type = 'customer_application_continuation';

create unique index if not exists customer_operation_jobs_lifecycle_notification_uidx
  on public.customer_operation_jobs(company_id, job_type, idempotency_key)
  where job_type = 'dispatch_lifecycle_notification';

-- FK is added after customer_operation_jobs has the new column.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.customer_application_workflows'::regclass
      and conname='customer_application_workflows_last_job_fk'
  ) then
    alter table public.customer_application_workflows
      add constraint customer_application_workflows_last_job_fk
      foreign key (last_job_id) references public.customer_operation_jobs(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Explicit state transition RPC with state history and optimistic version.
-- ---------------------------------------------------------------------------
create or replace function public.gridex_transition_customer_application_workflow(
  p_company_id uuid,
  p_customer_application_id uuid,
  p_to_state text,
  p_event_code text,
  p_reason_code text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns table(workflow_id uuid, operation_id uuid, state text, workflow_version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.customer_application_workflows%rowtype;
  v_key text;
begin
  select * into v_row
  from public.customer_application_workflows
  where company_id=p_company_id and customer_application_id=p_customer_application_id
  for update;

  if not found then
    raise exception 'customer_application_workflow_not_found' using errcode='P0002';
  end if;
  if p_expected_version is not null and v_row.workflow_version <> p_expected_version then
    raise exception 'customer_application_workflow_version_conflict' using errcode='40001';
  end if;
  if p_to_state is null or btrim(p_to_state) = '' then
    raise exception 'customer_application_workflow_state_required' using errcode='22023';
  end if;

  -- Terminal states cannot silently move backwards. A deliberate admin replay
  -- must first requeue the continuation job and use event_code workflow.reopened.
  if v_row.state in ('completed','cancelled')
     and p_to_state <> v_row.state
     and coalesce(p_event_code,'') <> 'workflow.reopened' then
    raise exception 'customer_application_workflow_terminal' using errcode='23514';
  end if;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''),
    format('workflow:%s:%s:%s:%s', v_row.id, v_row.workflow_version + 1, p_to_state, coalesce(p_event_code,'transition')));

  -- A repeated worker run must return the already-applied transition without
  -- incrementing workflow_version or mutating state a second time.
  if exists (
    select 1 from public.customer_application_workflow_events
    where company_id=p_company_id and idempotency_key=v_key
  ) then
    return query
    select w.id,w.operation_id,w.state,w.workflow_version
    from public.customer_application_workflows w where w.id=v_row.id;
    return;
  end if;

  insert into public.customer_application_workflow_events(
    company_id,workflow_id,customer_application_id,operation_id,from_state,to_state,
    event_code,reason_code,actor_user_id,metadata,idempotency_key
  ) values (
    p_company_id,v_row.id,p_customer_application_id,v_row.operation_id,v_row.state,p_to_state,
    coalesce(nullif(btrim(p_event_code),''),'workflow.transitioned'),nullif(btrim(p_reason_code),''),
    p_actor_user_id,coalesce(p_metadata,'{}'::jsonb),v_key
  ) on conflict (company_id,idempotency_key) do nothing;

  update public.customer_application_workflows
  set state=p_to_state,
      next_action=coalesce(p_metadata->>'next_action',next_action),
      snapshot=coalesce(snapshot,'{}'::jsonb) || coalesce(p_metadata,'{}'::jsonb),
      failure_code=case when p_to_state='failed' then coalesce(nullif(btrim(p_reason_code),''),failure_code) else null end,
      completed_at=case when p_to_state in ('completed','cancelled') then now() else null end,
      last_transition_at=now(),
      workflow_version=workflow_version+1,
      updated_at=now()
  where id=v_row.id;

  return query
  select w.id,w.operation_id,w.state,w.workflow_version
  from public.customer_application_workflows w where w.id=v_row.id;
end;
$$;

revoke all on function public.gridex_transition_customer_application_workflow(uuid,uuid,text,text,text,jsonb,uuid,integer,text)
  from public,anon,authenticated;
grant execute on function public.gridex_transition_customer_application_workflow(uuid,uuid,text,text,text,jsonb,uuid,integer,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Atomic provisioning commit + durable continuation job.
-- ---------------------------------------------------------------------------
create or replace function public.gridex_commit_customer_application_provisioning(
  p_company_id uuid,
  p_customer_application_id uuid,
  p_customer_id uuid,
  p_customer_site_id uuid,
  p_metering_point_id uuid,
  p_contract_id uuid,
  p_power_of_attorney_id uuid,
  p_operation_id uuid,
  p_state text,
  p_snapshot jsonb default '{}'::jsonb
)
returns table(operation_id uuid, state text, workflow_id uuid, continuation_job_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application record;
  v_workflow_id uuid;
  v_existing_operation_id uuid;
  v_job_id uuid;
  v_final_state text := coalesce(nullif(btrim(p_state), ''), 'pending_review');
  v_snapshot jsonb := coalesce(p_snapshot, '{}'::jsonb);
begin
  if v_final_state not in ('pending_customer_data','ready_for_switch','pending_review') then
    raise exception 'invalid_workflow_state' using errcode = '22023';
  end if;

  select id, customer_id, customer_site_id, metering_point_id, contract_id
  into v_application
  from public.website_customer_applications
  where id=p_customer_application_id and company_id=p_company_id
  for update;
  if not found then
    raise exception 'customer_application_not_found' using errcode='P0002';
  end if;
  if v_application.customer_id is not null and v_application.customer_id <> p_customer_id then
    raise exception 'customer_application_customer_mismatch' using errcode='23514';
  end if;

  if p_customer_site_id is not null and not exists (
    select 1 from public.customer_sites
    where id=p_customer_site_id and company_id=p_company_id and customer_id=p_customer_id
  ) then raise exception 'customer_site_scope_mismatch' using errcode='23514'; end if;

  if p_metering_point_id is not null and not exists (
    select 1 from public.metering_points
    where id=p_metering_point_id and company_id=p_company_id and customer_id=p_customer_id
      and (p_customer_site_id is null or site_id=p_customer_site_id or customer_site_id=p_customer_site_id)
  ) then raise exception 'metering_point_scope_mismatch' using errcode='23514'; end if;

  if p_contract_id is not null and not exists (
    select 1 from public.customer_contracts
    where id=p_contract_id and company_id=p_company_id and customer_id=p_customer_id
  ) then raise exception 'contract_scope_mismatch' using errcode='23514'; end if;

  if p_power_of_attorney_id is not null and not exists (
    select 1 from public.powers_of_attorney
    where id=p_power_of_attorney_id and company_id=p_company_id and customer_id=p_customer_id
      and revoked_at is null
      and (valid_from is null or valid_from<=current_date)
      and (valid_to is null or valid_to>=current_date)
      and status in ('signed','accepted','active','completed')
  ) then raise exception 'power_of_attorney_not_active' using errcode='23514'; end if;

  select id,operation_id into v_workflow_id,v_existing_operation_id
  from public.customer_application_workflows
  where company_id=p_company_id and customer_application_id=p_customer_application_id
  for update;

  if v_workflow_id is null then
    insert into public.customer_application_workflows(
      company_id,customer_application_id,customer_id,customer_site_id,metering_point_id,
      contract_id,operation_id,state,next_action,snapshot,last_transition_at,updated_at
    ) values (
      p_company_id,p_customer_application_id,p_customer_id,p_customer_site_id,p_metering_point_id,
      p_contract_id,p_operation_id,v_final_state,'customer_application_continuation',
      v_snapshot || jsonb_build_object('commit_version','customer_application_continuation_v1'),now(),now()
    ) returning id,operation_id into v_workflow_id,v_existing_operation_id;
  else
    update public.customer_application_workflows
    set customer_id=p_customer_id,
        customer_site_id=p_customer_site_id,
        metering_point_id=p_metering_point_id,
        contract_id=p_contract_id,
        state=v_final_state,
        next_action='customer_application_continuation',
        snapshot=coalesce(snapshot,'{}'::jsonb) || v_snapshot || jsonb_build_object('commit_version','customer_application_continuation_v1'),
        failure_code=null,
        failure_detail_internal=null,
        completed_at=null,
        last_transition_at=now(),
        updated_at=now()
    where id=v_workflow_id;
  end if;

  select id into v_job_id
  from public.customer_operation_jobs
  where company_id=p_company_id and workflow_id=v_workflow_id
    and job_type='customer_application_continuation'
  limit 1
  for update;

  if v_job_id is null then
    insert into public.customer_operation_jobs(
      company_id,customer_id,customer_site_id,metering_point_id,workflow_id,
      job_type,status,priority,idempotency_key,payload,payload_version,
      operation_id,request_snapshot,run_after,created_by,updated_at
    ) values (
      p_company_id,p_customer_id,p_customer_site_id,p_metering_point_id,v_workflow_id,
      'customer_application_continuation','queued',10,
      format('customer_application_continuation:%s',p_customer_application_id),
      jsonb_build_object(
        'application_id',p_customer_application_id,
        'workflow_id',v_workflow_id,
        'contract_id',p_contract_id,
        'power_of_attorney_id',p_power_of_attorney_id,
        'initial_state',v_final_state,
        'snapshot',v_snapshot
      ),1,v_existing_operation_id,v_snapshot,now(),null,now()
    ) returning id into v_job_id;
  else
    -- A retry of the same API request preserves completed work. Failed/stalled
    -- continuation rows are safely requeued with their same idempotency identity.
    update public.customer_operation_jobs
    set status=case when status in ('failed','blocked','delivery_uncertain') then 'queued' else status end,
        run_after=case when status in ('failed','blocked','delivery_uncertain') then now() else run_after end,
        locked_at=null,
        locked_by=null,
        lock_token=null,
        last_error=case when status in ('failed','blocked','delivery_uncertain') then null else last_error end,
        last_error_code=case when status in ('failed','blocked','delivery_uncertain') then null else last_error_code end,
        last_error_message=case when status in ('failed','blocked','delivery_uncertain') then null else last_error_message end,
        payload=coalesce(payload,'{}'::jsonb) || jsonb_build_object(
          'application_id',p_customer_application_id,
          'workflow_id',v_workflow_id,
          'contract_id',p_contract_id,
          'power_of_attorney_id',p_power_of_attorney_id,
          'initial_state',v_final_state,
          'snapshot',v_snapshot
        ),
        updated_at=now()
    where id=v_job_id;
  end if;

  update public.customer_application_workflows
  set last_job_id=v_job_id,updated_at=now()
  where id=v_workflow_id;

  insert into public.customer_application_workflow_events(
    company_id,workflow_id,customer_application_id,operation_id,from_state,to_state,
    event_code,metadata,idempotency_key
  ) values (
    p_company_id,v_workflow_id,p_customer_application_id,v_existing_operation_id,null,v_final_state,
    'workflow.committed',jsonb_build_object('continuation_job_id',v_job_id,'power_of_attorney_id',p_power_of_attorney_id),
    format('workflow.committed:%s',p_customer_application_id)
  ) on conflict (company_id,idempotency_key) do nothing;

  perform public.gridex_record_application_provisioning_step(
    p_company_id,p_customer_application_id,v_existing_operation_id,
    'workflow_committed','completed',
    jsonb_build_object('workflow_id',v_workflow_id,'customer_id',p_customer_id,
      'customer_site_id',p_customer_site_id,'metering_point_id',p_metering_point_id,
      'contract_id',p_contract_id,'power_of_attorney_id',p_power_of_attorney_id,
      'state',v_final_state,'continuation_job_id',v_job_id)
  );
  perform public.gridex_record_application_provisioning_step(
    p_company_id,p_customer_application_id,v_existing_operation_id,
    'external_automation_queued','completed',
    jsonb_build_object('workflow_id',v_workflow_id,'continuation_job_id',v_job_id,
      'job_type','customer_application_continuation')
  );

  return query select v_existing_operation_id,v_final_state,v_workflow_id,v_job_id;
end;
$$;

revoke all on function public.gridex_commit_customer_application_provisioning(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.gridex_commit_customer_application_provisioning(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Backfill: create one safe continuation job for unfinished workflows.
-- No external action is performed by this migration; workers remain idempotent.
-- ---------------------------------------------------------------------------
insert into public.customer_operation_jobs(
  company_id,customer_id,customer_site_id,metering_point_id,workflow_id,
  job_type,status,priority,idempotency_key,payload,payload_version,
  operation_id,request_snapshot,run_after,created_by,updated_at
)
select
  w.company_id,w.customer_id,w.customer_site_id,w.metering_point_id,w.id,
  'customer_application_continuation','queued',20,
  format('customer_application_continuation:%s',w.customer_application_id),
  jsonb_build_object(
    'application_id',w.customer_application_id,
    'workflow_id',w.id,
    'contract_id',w.contract_id,
    'initial_state',w.state,
    'snapshot',coalesce(w.snapshot,'{}'::jsonb),
    'backfill',true
  ),1,w.operation_id,coalesce(w.snapshot,'{}'::jsonb),now(),null,now()
from public.customer_application_workflows w
where w.state not in ('completed','cancelled','failed')
  and not exists (
    select 1 from public.customer_operation_jobs j
    where j.company_id=w.company_id and j.workflow_id=w.id
      and j.job_type='customer_application_continuation'
  )
on conflict do nothing;

update public.customer_application_workflows w
set last_job_id=j.id,
    next_action=coalesce(w.next_action,'customer_application_continuation'),
    updated_at=now()
from public.customer_operation_jobs j
where j.company_id=w.company_id and j.workflow_id=w.id
  and j.job_type='customer_application_continuation'
  and w.last_job_id is distinct from j.id;

comment on table public.customer_application_workflow_events is
  'Immutable state-transition audit for the canonical website customer-application workflow.';
comment on column public.customer_operation_jobs.workflow_id is
  'Canonical workflow correlation. A customer_application_continuation job is created atomically with provisioning commit.';
