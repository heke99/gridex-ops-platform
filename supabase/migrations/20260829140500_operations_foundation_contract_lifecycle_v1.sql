-- Gridex Operations Foundation + Customer Lifecycle V1
--
-- Extends the existing customer_operation_* primitives. No parallel operations
-- tables or alternative Ediel/readiness rules are introduced.

create or replace function public.gridex_customer_operation_outcome_class(
  p_status text,
  p_attempts integer,
  p_max_attempts integer
)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_status = 'needs_review' then 'REVIEW'
    when p_status in ('blocked', 'cancelled') then 'STOP'
    when p_status = 'delivery_uncertain' then 'RETRY'
    when p_status = 'failed'
      and coalesce(p_attempts, 0) < greatest(coalesce(p_max_attempts, 1), 1)
      then 'RETRY'
    when p_status = 'failed' then 'STOP'
    else 'AUTO'
  end
$$;

revoke all on function public.gridex_customer_operation_outcome_class(text, integer, integer) from public;
revoke all on function public.gridex_customer_operation_outcome_class(text, integer, integer) from anon;
revoke all on function public.gridex_customer_operation_outcome_class(text, integer, integer) from authenticated;
grant execute on function public.gridex_customer_operation_outcome_class(text, integer, integer) to service_role;

create or replace view public.customer_operation_outcomes_v
with (security_invoker = true)
as
select
  j.id,
  j.company_id,
  j.customer_id,
  j.customer_site_id,
  j.metering_point_id,
  j.job_type,
  j.status,
  public.gridex_customer_operation_outcome_class(j.status, j.attempts, j.max_attempts) as outcome_class,
  j.operation_id,
  j.trace_id,
  j.idempotency_key,
  j.attempts,
  j.max_attempts,
  j.run_after,
  j.result,
  j.last_error_code,
  j.last_error_message,
  j.review_reason_code,
  j.review_sla_due_at,
  j.created_at,
  j.updated_at,
  j.completed_at
from public.customer_operation_jobs j;

revoke all on public.customer_operation_outcomes_v from public;
revoke all on public.customer_operation_outcomes_v from anon;
revoke all on public.customer_operation_outcomes_v from authenticated;
grant select on public.customer_operation_outcomes_v to service_role;

comment on view public.customer_operation_outcomes_v is
  'Projection of canonical customer_operation_jobs into AUTO/RETRY/REVIEW/STOP.';

-- A contract signing edge is immutable. Unlike general active-job dedupe it may
-- never create a second lifecycle-start job after a terminal result.
create unique index if not exists customer_operation_jobs_contract_signed_uidx
  on public.customer_operation_jobs(company_id, job_type, idempotency_key)
  where job_type = 'start_supplier_switch'
    and idempotency_key like 'contract-signed:%';

create or replace function public.gridex_enqueue_signed_contract_operation_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_candidate_site_id uuid := coalesce(new.customer_site_id, new.site_id);
  v_site_id uuid;
  v_site_address_hash text;
  v_site_grid_owner_id uuid;
  v_site_grid_area_code text;
  v_site_facility_id text;
  v_site_snapshot jsonb;
  v_operation_id uuid := gen_random_uuid();
  v_trace_id uuid := gen_random_uuid();
  v_job_id uuid;
  v_review_reason text;
begin
  -- Only the edge into a fully signed contract may enqueue lifecycle work.
  if new.status is distinct from 'signed' or new.signed_at is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'signed' and old.signed_at is not null then
    return new;
  end if;

  -- Never trust a relational site ID until it resolves inside exact tenant and
  -- customer scope. The candidate is retained only as diagnostic evidence.
  if v_candidate_site_id is not null then
    select
      s.id,
      coalesce(
        nullif(trim(s.address_hash), ''),
        nullif(
          lower(concat_ws(
            '|',
            nullif(trim(s.street), ''),
            nullif(regexp_replace(coalesce(s.postal_code, ''), '\D', '', 'g'), ''),
            nullif(trim(s.city), '')
          )),
          ''
        ),
        'missing'
      ),
      s.grid_owner_id,
      s.grid_area_code,
      s.facility_id
    into
      v_site_id,
      v_site_address_hash,
      v_site_grid_owner_id,
      v_site_grid_area_code,
      v_site_facility_id
    from public.customer_sites s
    where s.id = v_candidate_site_id
      and s.company_id = new.company_id
      and s.customer_id = new.customer_id;
  end if;

  -- Production agreements have a different lifecycle and must never enter the
  -- consumption Z03 path merely because they were signed.
  if coalesce(new.energy_direction, 'consumption') <> 'consumption' then
    insert into public.customer_operation_events (
      company_id, customer_id, customer_site_id, metering_point_id,
      operation_id, event_code, title, message, status, severity,
      action_required, source, visibility, payload, idempotency_key
    ) values (
      new.company_id, new.customer_id, v_site_id, new.metering_point_id,
      v_operation_id, 'contract.signed.lifecycle_skipped',
      'Signerat avtal kräver ingen consumption supplier-switch',
      'Avtalets energiriktning hanteras av en annan domänprocess och har inte köats för Z03.',
      'completed', 'info', false, 'contract_lifecycle_orchestrator', 'tenant',
      jsonb_build_object(
        'contract_id', new.id,
        'candidate_site_id', v_candidate_site_id,
        'energy_direction', new.energy_direction,
        'operation_id', v_operation_id,
        'trace_id', v_trace_id
      ),
      'contract-signed-skipped:' || new.id::text
    )
    on conflict (company_id, idempotency_key)
      where idempotency_key is not null do nothing;
    return new;
  end if;

  if v_site_id is null then
    v_review_reason := case
      when v_candidate_site_id is null then 'signed_contract_site_missing'
      else 'signed_contract_site_tenant_mismatch'
    end;

    insert into public.customer_operation_jobs (
      company_id, customer_id, customer_site_id, metering_point_id,
      job_type, status, priority, idempotency_key, payload, result,
      attempts, max_attempts, run_after, created_by, operation_id, trace_id,
      review_reason_code, review_environment, review_sla_due_at
    ) values (
      new.company_id, new.customer_id, null, new.metering_point_id,
      'start_supplier_switch', 'needs_review', 25,
      'contract-signed:' || new.id::text,
      jsonb_build_object(
        'contract_id', new.id,
        'candidate_site_id', v_candidate_site_id,
        'trigger', 'contract_signed',
        'signed_at', new.signed_at,
        'requested_start_date', coalesce(new.requested_start_date, new.expected_start_at),
        'operation_id', v_operation_id,
        'trace_id', v_trace_id
      ),
      jsonb_build_object('reason_code', v_review_reason, 'contract_id', new.id),
      0, 5, now(), coalesce(new.updated_by, new.created_by),
      v_operation_id, v_trace_id, v_review_reason, 'production', now() + interval '4 hours'
    )
    on conflict (company_id, job_type, idempotency_key)
      where job_type = 'start_supplier_switch' and idempotency_key like 'contract-signed:%'
    do nothing
    returning id into v_job_id;

    insert into public.customer_operation_tasks (
      company_id, customer_id, site_id, metering_point_id, task_type, status,
      priority, title, description, due_at, metadata, created_by
    )
    select
      new.company_id, new.customer_id, null, new.metering_point_id,
      'contract_lifecycle_readiness', 'open', 'high',
      'Signerat avtal saknar säker anläggningskoppling',
      'Komplettera eller rätta avtalets tenant-säkra anläggningskoppling innan leverantörsbyte kan startas.',
      now() + interval '4 hours',
      jsonb_build_object(
        'contract_id', new.id,
        'candidate_site_id', v_candidate_site_id,
        'reason_code', v_review_reason,
        'operation_id', v_operation_id,
        'customer_operation_job_id', v_job_id
      ),
      coalesce(new.updated_by, new.created_by)
    where not exists (
      select 1 from public.customer_operation_tasks t
      where t.company_id = new.company_id
        and t.customer_id = new.customer_id
        and t.task_type = 'contract_lifecycle_readiness'
        and t.status in ('open', 'in_progress', 'blocked')
        and t.metadata ->> 'contract_id' = new.id::text
    );

    insert into public.customer_operation_events (
      company_id, customer_id, customer_site_id, metering_point_id,
      customer_operation_job_id, operation_id, event_code, title, message,
      status, severity, action_required, action_url, source, visibility,
      payload, idempotency_key
    ) values (
      new.company_id, new.customer_id, null, new.metering_point_id,
      v_job_id, v_operation_id, 'contract.signed.review_required',
      'Signerat avtal kräver granskning',
      'Avtalet kan inte gå vidare automatiskt förrän anläggningskopplingen är tenant-säker.',
      'needs_review', 'warning', true,
      '/admin/customers/' || new.customer_id::text || '?tab=supplier-switch',
      'contract_lifecycle_orchestrator', 'tenant',
      jsonb_build_object(
        'contract_id', new.id,
        'candidate_site_id', v_candidate_site_id,
        'customer_operation_job_id', v_job_id,
        'operation_id', v_operation_id,
        'trace_id', v_trace_id,
        'outcome_class', 'REVIEW'
      ),
      'contract-signed:' || new.id::text
    )
    on conflict (company_id, idempotency_key)
      where idempotency_key is not null do nothing;

    return new;
  end if;

  v_site_snapshot := jsonb_build_object(
    'site_id', v_site_id,
    'address_hash', v_site_address_hash,
    'grid_owner_id', v_site_grid_owner_id,
    'grid_area_code', v_site_grid_area_code,
    'route_profile_id', null,
    'facility_id', v_site_facility_id,
    'captured_at', now(),
    'contract_id', new.id,
    'operation_id', v_operation_id,
    'trace_id', v_trace_id
  );

  insert into public.customer_operation_jobs (
    company_id, customer_id, customer_site_id, metering_point_id,
    job_type, status, priority, idempotency_key, payload, result,
    attempts, max_attempts, run_after, created_by, operation_id, trace_id,
    request_snapshot
  ) values (
    new.company_id, new.customer_id, v_site_id, new.metering_point_id,
    'start_supplier_switch', 'queued', 25,
    'contract-signed:' || new.id::text,
    jsonb_build_object(
      'contract_id', new.id,
      'trigger', 'contract_signed',
      'signed_at', new.signed_at,
      'requested_start_date', coalesce(new.requested_start_date, new.expected_start_at),
      'operation_id', v_operation_id,
      'trace_id', v_trace_id,
      'site_snapshot', v_site_snapshot
    ),
    '{}'::jsonb, 0, 5, now(), coalesce(new.updated_by, new.created_by),
    v_operation_id, v_trace_id, v_site_snapshot
  )
  on conflict (company_id, job_type, idempotency_key)
    where job_type = 'start_supplier_switch' and idempotency_key like 'contract-signed:%'
  do nothing
  returning id into v_job_id;

  insert into public.customer_operation_events (
    company_id, customer_id, customer_site_id, metering_point_id,
    customer_operation_job_id, operation_id, event_code, title, message,
    status, severity, action_required, action_url, source, visibility,
    payload, idempotency_key
  ) values (
    new.company_id, new.customer_id, v_site_id, new.metering_point_id,
    v_job_id, v_operation_id, 'contract.signed',
    'Signerat avtal köat för automatisk onboarding',
    'Systemet fortsätter automatiskt med readiness och leverantörsbyte.',
    'in_progress', 'info', false,
    '/admin/customers/' || new.customer_id::text || '?tab=supplier-switch',
    'contract_lifecycle_orchestrator', 'tenant',
    jsonb_build_object(
      'contract_id', new.id,
      'signed_at', new.signed_at,
      'customer_operation_job_id', v_job_id,
      'operation_id', v_operation_id,
      'trace_id', v_trace_id,
      'outcome_class', 'AUTO'
    ),
    'contract-signed:' || new.id::text
  )
  on conflict (company_id, idempotency_key)
    where idempotency_key is not null do nothing;

  return new;
end;
$$;

revoke all on function public.gridex_enqueue_signed_contract_operation_v1() from public;
revoke all on function public.gridex_enqueue_signed_contract_operation_v1() from anon;
revoke all on function public.gridex_enqueue_signed_contract_operation_v1() from authenticated;

-- Trigger functions execute through PostgreSQL only; clients cannot invoke it.
drop trigger if exists customer_contracts_signed_operation_v1 on public.customer_contracts;
create trigger customer_contracts_signed_operation_v1
after insert or update on public.customer_contracts
for each row
execute function public.gridex_enqueue_signed_contract_operation_v1();

-- Historical signed contracts are deliberately reconciliation-only. Never start
-- external Z03 communication retroactively during a migration.
insert into public.customer_operation_jobs (
  company_id, customer_id, customer_site_id, metering_point_id,
  job_type, status, priority, idempotency_key, payload, result,
  attempts, max_attempts, run_after, created_by, operation_id, trace_id,
  review_reason_code, review_environment, review_sla_due_at
)
select
  c.company_id,
  c.customer_id,
  case when s.id is not null then s.id else null end,
  c.metering_point_id,
  'start_supplier_switch',
  'needs_review',
  50,
  'contract-signed:' || c.id::text,
  jsonb_build_object(
    'contract_id', c.id,
    'candidate_site_id', coalesce(c.customer_site_id, c.site_id),
    'trigger', 'historical_signed_contract_reconciliation',
    'signed_at', c.signed_at,
    'requested_start_date', coalesce(c.requested_start_date, c.expected_start_at)
  ),
  jsonb_build_object(
    'reason_code', 'historical_signed_contract_requires_reconciliation',
    'contract_id', c.id
  ),
  0, 5, now(), coalesce(c.updated_by, c.created_by),
  gen_random_uuid(), gen_random_uuid(),
  'historical_signed_contract_requires_reconciliation',
  'production', now() + interval '1 day'
from public.customer_contracts c
left join public.customer_sites s
  on s.id = coalesce(c.customer_site_id, c.site_id)
 and s.company_id = c.company_id
 and s.customer_id = c.customer_id
where c.status = 'signed'
  and c.signed_at is not null
  and coalesce(c.energy_direction, 'consumption') = 'consumption'
  and not exists (
    select 1 from public.customer_operation_jobs j
    where j.company_id = c.company_id
      and j.job_type = 'start_supplier_switch'
      and j.idempotency_key = 'contract-signed:' || c.id::text
  )
  and not exists (
    select 1 from public.supplier_switch_requests sw
    where sw.company_id = c.company_id
      and sw.customer_id = c.customer_id
      and (
        sw.customer_contract_id = c.id
        or sw.contract_id = c.id
        or (
          coalesce(sw.customer_site_id, sw.site_id) = coalesce(c.customer_site_id, c.site_id)
          and coalesce(c.customer_site_id, c.site_id) is not null
        )
      )
  )
on conflict (company_id, job_type, idempotency_key)
  where job_type = 'start_supplier_switch' and idempotency_key like 'contract-signed:%'
do nothing;

insert into public.customer_operation_events (
  company_id, customer_id, customer_site_id, metering_point_id,
  customer_operation_job_id, operation_id, event_code, title, message,
  status, severity, action_required, action_url, source, visibility,
  payload, idempotency_key
)
select
  j.company_id, j.customer_id, j.customer_site_id, j.metering_point_id,
  j.id, j.operation_id, 'contract.signed.reconciliation_required',
  'Historiskt signerat avtal kräver lifecycle-avstämning',
  'Avtalet signerades innan den automatiska lifecycle-bron fanns. Ingen extern kommunikation startas retroaktivt.',
  'needs_review', 'warning', true,
  '/admin/customers/' || j.customer_id::text || '?tab=supplier-switch',
  'contract_lifecycle_orchestrator', 'tenant',
  jsonb_build_object(
    'contract_id', j.payload ->> 'contract_id',
    'customer_operation_job_id', j.id,
    'operation_id', j.operation_id,
    'trace_id', j.trace_id,
    'outcome_class', 'REVIEW'
  ),
  'contract-signed-reconciliation:' || (j.payload ->> 'contract_id')
from public.customer_operation_jobs j
where j.job_type = 'start_supplier_switch'
  and j.status = 'needs_review'
  and j.review_reason_code = 'historical_signed_contract_requires_reconciliation'
  and j.idempotency_key like 'contract-signed:%'
on conflict (company_id, idempotency_key)
  where idempotency_key is not null do nothing;

insert into public.customer_operation_tasks (
  company_id, customer_id, site_id, metering_point_id, task_type, status,
  priority, title, description, due_at, metadata, created_by
)
select
  j.company_id, j.customer_id, j.customer_site_id, j.metering_point_id,
  'contract_lifecycle_reconciliation', 'open', 'normal',
  'Stäm av historiskt signerat avtal',
  'Verifiera readiness och starta leverantörsbyte via ordinarie OPS-flöde om avtalet fortfarande ska levereras.',
  j.review_sla_due_at,
  jsonb_build_object(
    'contract_id', j.payload ->> 'contract_id',
    'customer_operation_job_id', j.id,
    'operation_id', j.operation_id,
    'reason_code', j.review_reason_code
  ),
  j.created_by
from public.customer_operation_jobs j
where j.job_type = 'start_supplier_switch'
  and j.status = 'needs_review'
  and j.review_reason_code = 'historical_signed_contract_requires_reconciliation'
  and j.idempotency_key like 'contract-signed:%'
  and not exists (
    select 1 from public.customer_operation_tasks t
    where t.company_id = j.company_id
      and t.customer_id = j.customer_id
      and t.task_type = 'contract_lifecycle_reconciliation'
      and t.status in ('open', 'in_progress', 'blocked')
      and t.metadata ->> 'contract_id' = j.payload ->> 'contract_id'
  );

comment on function public.gridex_enqueue_signed_contract_operation_v1() is
  'Atomic signed-contract bridge into existing readiness/supplier-switch/outbound automation; candidate site scope is fail-closed.';
