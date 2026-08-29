-- Gridex Operations contract lifecycle tenant-scope hardening V1
--
-- Forward-only companion to 20260829140500. It makes the signed-contract bridge
-- keep a candidate site identifier as diagnostic evidence only until the site has
-- been resolved inside the exact company + customer scope.

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
  v_event_status text := 'in_progress';
  v_event_severity text := 'info';
  v_action_required boolean := false;
  v_event_code text := 'contract.signed';
  v_event_title text := 'Signerat avtal köat för automatisk onboarding';
  v_event_message text := 'Systemet fortsätter automatiskt med readiness och leverantörsbyte.';
  v_review_reason text;
begin
  if new.status is distinct from 'signed' or new.signed_at is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'signed' and old.signed_at is not null then
    return new;
  end if;

  -- Resolve the site only inside the tenant/customer boundary. A foreign or stale
  -- candidate identifier never becomes relational scope on an operations row.
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

  if coalesce(new.energy_direction, 'consumption') <> 'consumption' then
    insert into public.customer_operation_events (
      company_id,
      customer_id,
      customer_site_id,
      metering_point_id,
      operation_id,
      event_code,
      title,
      message,
      status,
      severity,
      action_required,
      source,
      visibility,
      payload,
      idempotency_key
    ) values (
      new.company_id,
      new.customer_id,
      v_site_id,
      new.metering_point_id,
      v_operation_id,
      'contract.signed.lifecycle_skipped',
      'Signerat avtal kräver ingen consumption supplier-switch',
      'Avtalets energiriktning hanteras av en annan domänprocess och har inte köats för Z03.',
      'completed',
      'info',
      false,
      'contract_lifecycle_orchestrator',
      'tenant',
      jsonb_build_object(
        'contract_id', new.id,
        'candidate_site_id', v_candidate_site_id,
        'energy_direction', new.energy_direction,
        'operation_id', v_operation_id,
        'trace_id', v_trace_id
      ),
      'contract-signed-skipped:' || new.id::text
    )
    on conflict (company_id, idempotency_key) where idempotency_key is not null do nothing;

    return new;
  end if;

  if v_site_id is null then
    v_review_reason := case
      when v_candidate_site_id is null then 'signed_contract_site_missing'
      else 'signed_contract_site_tenant_mismatch'
    end;

    insert into public.customer_operation_jobs (
      company_id,
      customer_id,
      customer_site_id,
      metering_point_id,
      job_type,
      status,
      priority,
      idempotency_key,
      payload,
      result,
      attempts,
      max_attempts,
      run_after,
      created_by,
      operation_id,
      trace_id,
      review_reason_code,
      review_environment,
      review_sla_due_at
    ) values (
      new.company_id,
      new.customer_id,
      null,
      new.metering_point_id,
      'start_supplier_switch',
      'needs_review',
      25,
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
      jsonb_build_object(
        'reason', v_review_reason,
        'reason_code', v_review_reason,
        'contract_id', new.id,
        'candidate_site_id', v_candidate_site_id
      ),
      0,
      5,
      now(),
      coalesce(new.updated_by, new.created_by),
      v_operation_id,
      v_trace_id,
      v_review_reason,
      'production',
      now() + interval '4 hours'
    )
    on conflict (company_id, job_type, idempotency_key)
      where job_type = 'start_supplier_switch' and idempotency_key like 'contract-signed:%'
    do nothing
    returning id into v_job_id;

    insert into public.customer_operation_tasks (
      company_id,
      customer_id,
      site_id,
      metering_point_id,
      task_type,
      status,
      priority,
      title,
      description,
      due_at,
      metadata,
      created_by
    )
    select
      new.company_id,
      new.customer_id,
      null,
      new.metering_point_id,
      'contract_lifecycle_readiness',
      'open',
      'high',
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
      select 1
      from public.customer_operation_tasks t
      where t.company_id = new.company_id
        and t.customer_id = new.customer_id
        and t.task_type = 'contract_lifecycle_readiness'
        and t.status in ('open', 'in_progress', 'blocked')
        and t.metadata ->> 'contract_id' = new.id::text
    );

    v_event_status := 'needs_review';
    v_event_severity := 'warning';
    v_action_required := true;
    v_event_code := 'contract.signed.review_required';
    v_event_title := 'Signerat avtal kräver granskning';
    v_event_message := 'Avtalet kan inte gå vidare automatiskt förrän anläggningskopplingen är tenant-säker.';
  else
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
      company_id,
      customer_id,
      customer_site_id,
      metering_point_id,
      job_type,
      status,
      priority,
      idempotency_key,
      payload,
      result,
      attempts,
      max_attempts,
      run_after,
      created_by,
      operation_id,
      trace_id,
      request_snapshot
    ) values (
      new.company_id,
      new.customer_id,
      v_site_id,
      new.metering_point_id,
      'start_supplier_switch',
      'queued',
      25,
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
      '{}'::jsonb,
      0,
      5,
      now(),
      coalesce(new.updated_by, new.created_by),
      v_operation_id,
      v_trace_id,
      v_site_snapshot
    )
    on conflict (company_id, job_type, idempotency_key)
      where job_type = 'start_supplier_switch' and idempotency_key like 'contract-signed:%'
    do nothing
    returning id into v_job_id;
  end if;

  insert into public.customer_operation_events (
    company_id,
    customer_id,
    customer_site_id,
    metering_point_id,
    customer_operation_job_id,
    operation_id,
    event_code,
    title,
    message,
    status,
    severity,
    action_required,
    action_url,
    source,
    visibility,
    payload,
    idempotency_key
  ) values (
    new.company_id,
    new.customer_id,
    v_site_id,
    new.metering_point_id,
    v_job_id,
    v_operation_id,
    v_event_code,
    v_event_title,
    v_event_message,
    v_event_status,
    v_event_severity,
    v_action_required,
    '/admin/customers/' || new.customer_id::text || '?tab=supplier-switch',
    'contract_lifecycle_orchestrator',
    'tenant',
    jsonb_build_object(
      'contract_id', new.id,
      'candidate_site_id', v_candidate_site_id,
      'signed_at', new.signed_at,
      'customer_operation_job_id', v_job_id,
      'operation_id', v_operation_id,
      'trace_id', v_trace_id,
      'outcome_class', case when v_action_required then 'REVIEW' else 'AUTO' end
    ),
    'contract-signed:' || new.id::text
  )
  on conflict (company_id, idempotency_key) where idempotency_key is not null do nothing;

  return new;
end;
$$;

revoke all on function public.gridex_enqueue_signed_contract_operation_v1() from public;
revoke all on function public.gridex_enqueue_signed_contract_operation_v1() from anon;
revoke all on function public.gridex_enqueue_signed_contract_operation_v1() from authenticated;

-- Repair only relational scope on historical reconciliation records if a stale
-- contract points at a site outside the exact company/customer boundary. The
-- candidate remains present in contract/payload evidence for manual review.
update public.customer_operation_jobs j
set customer_site_id = null,
    updated_at = now()
where j.job_type = 'start_supplier_switch'
  and j.review_reason_code = 'historical_signed_contract_requires_reconciliation'
  and j.customer_site_id is not null
  and not exists (
    select 1
    from public.customer_sites s
    where s.id = j.customer_site_id
      and s.company_id = j.company_id
      and s.customer_id = j.customer_id
  );

update public.customer_operation_events e
set customer_site_id = null,
    updated_at = now()
where e.source = 'contract_lifecycle_orchestrator'
  and e.event_code = 'contract.signed.reconciliation_required'
  and e.customer_site_id is not null
  and not exists (
    select 1
    from public.customer_sites s
    where s.id = e.customer_site_id
      and s.company_id = e.company_id
      and s.customer_id = e.customer_id
  );

update public.customer_operation_tasks t
set site_id = null,
    updated_at = now()
where t.task_type = 'contract_lifecycle_reconciliation'
  and t.site_id is not null
  and not exists (
    select 1
    from public.customer_sites s
    where s.id = t.site_id
      and s.company_id = t.company_id
      and s.customer_id = t.customer_id
  );

comment on function public.gridex_enqueue_signed_contract_operation_v1() is
  'Atomic signed-contract lifecycle bridge. Candidate site IDs are not trusted until resolved inside exact tenant/customer scope.';
