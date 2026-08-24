-- Fix PL/pgSQL output-column ambiguity in the customer-application provisioning commit.
--
-- The function returns columns named operation_id and workflow_id. Unqualified
-- references to table columns with the same names are therefore ambiguous in
-- PL/pgSQL (SQLSTATE 42702). Keep the public RPC contract unchanged and qualify
-- every overlapping identifier explicitly.

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
) returns table(operation_id uuid, state text, workflow_id uuid, continuation_job_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  select application.id,
         application.customer_id,
         application.customer_site_id,
         application.metering_point_id,
         application.contract_id
  into v_application
  from public.website_customer_applications application
  where application.id = p_customer_application_id
    and application.company_id = p_company_id
  for update;

  if not found then
    raise exception 'customer_application_not_found' using errcode='P0002';
  end if;

  if v_application.customer_id is not null and v_application.customer_id <> p_customer_id then
    raise exception 'customer_application_customer_mismatch' using errcode='23514';
  end if;

  if p_customer_site_id is not null and not exists (
    select 1
    from public.customer_sites site
    where site.id = p_customer_site_id
      and site.company_id = p_company_id
      and site.customer_id = p_customer_id
  ) then
    raise exception 'customer_site_scope_mismatch' using errcode='23514';
  end if;

  if p_metering_point_id is not null and not exists (
    select 1
    from public.metering_points meter
    where meter.id = p_metering_point_id
      and meter.company_id = p_company_id
      and meter.customer_id = p_customer_id
      and (
        p_customer_site_id is null
        or meter.site_id = p_customer_site_id
        or meter.customer_site_id = p_customer_site_id
      )
  ) then
    raise exception 'metering_point_scope_mismatch' using errcode='23514';
  end if;

  if p_contract_id is not null and not exists (
    select 1
    from public.customer_contracts contract_row
    where contract_row.id = p_contract_id
      and contract_row.company_id = p_company_id
      and contract_row.customer_id = p_customer_id
  ) then
    raise exception 'contract_scope_mismatch' using errcode='23514';
  end if;

  if p_power_of_attorney_id is not null and not exists (
    select 1
    from public.powers_of_attorney poa
    where poa.id = p_power_of_attorney_id
      and poa.company_id = p_company_id
      and poa.customer_id = p_customer_id
      and poa.revoked_at is null
      and (poa.valid_from is null or poa.valid_from <= current_date)
      and (poa.valid_to is null or poa.valid_to >= current_date)
      and poa.status in ('signed','accepted','active','completed')
  ) then
    raise exception 'power_of_attorney_not_active' using errcode='23514';
  end if;

  select workflow_row.id, workflow_row.operation_id
  into v_workflow_id, v_existing_operation_id
  from public.customer_application_workflows workflow_row
  where workflow_row.company_id = p_company_id
    and workflow_row.customer_application_id = p_customer_application_id
  for update;

  if v_workflow_id is null then
    insert into public.customer_application_workflows as workflow_target (
      company_id,customer_application_id,customer_id,customer_site_id,metering_point_id,
      contract_id,operation_id,state,next_action,snapshot,last_transition_at,updated_at
    ) values (
      p_company_id,p_customer_application_id,p_customer_id,p_customer_site_id,p_metering_point_id,
      p_contract_id,p_operation_id,v_final_state,'customer_application_continuation',
      v_snapshot || jsonb_build_object('commit_version','customer_application_continuation_v1'),now(),now()
    )
    returning workflow_target.id, workflow_target.operation_id
    into v_workflow_id, v_existing_operation_id;
  else
    update public.customer_application_workflows as workflow_target
    set customer_id = p_customer_id,
        customer_site_id = p_customer_site_id,
        metering_point_id = p_metering_point_id,
        contract_id = p_contract_id,
        state = v_final_state,
        next_action = 'customer_application_continuation',
        snapshot = coalesce(workflow_target.snapshot,'{}'::jsonb)
          || v_snapshot
          || jsonb_build_object('commit_version','customer_application_continuation_v1'),
        failure_code = null,
        failure_detail_internal = null,
        completed_at = null,
        last_transition_at = now(),
        updated_at = now()
    where workflow_target.id = v_workflow_id;
  end if;

  select job.id
  into v_job_id
  from public.customer_operation_jobs job
  where job.company_id = p_company_id
    and job.workflow_id = v_workflow_id
    and job.job_type = 'customer_application_continuation'
  limit 1
  for update;

  if v_job_id is null then
    insert into public.customer_operation_jobs as job_target (
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
    )
    returning job_target.id into v_job_id;
  else
    update public.customer_operation_jobs as job_target
    set status = case
          when job_target.status in ('failed','blocked','delivery_uncertain') then 'queued'
          else job_target.status
        end,
        run_after = case
          when job_target.status in ('failed','blocked','delivery_uncertain') then now()
          else job_target.run_after
        end,
        locked_at = null,
        locked_by = null,
        lock_token = null,
        last_error = case
          when job_target.status in ('failed','blocked','delivery_uncertain') then null
          else job_target.last_error
        end,
        last_error_code = case
          when job_target.status in ('failed','blocked','delivery_uncertain') then null
          else job_target.last_error_code
        end,
        last_error_message = case
          when job_target.status in ('failed','blocked','delivery_uncertain') then null
          else job_target.last_error_message
        end,
        payload = coalesce(job_target.payload,'{}'::jsonb) || jsonb_build_object(
          'application_id',p_customer_application_id,
          'workflow_id',v_workflow_id,
          'contract_id',p_contract_id,
          'power_of_attorney_id',p_power_of_attorney_id,
          'initial_state',v_final_state,
          'snapshot',v_snapshot
        ),
        updated_at = now()
    where job_target.id = v_job_id;
  end if;

  update public.customer_application_workflows as workflow_target
  set last_job_id = v_job_id,
      updated_at = now()
  where workflow_target.id = v_workflow_id;

  insert into public.customer_application_workflow_events(
    company_id,workflow_id,customer_application_id,operation_id,from_state,to_state,
    event_code,metadata,idempotency_key
  ) values (
    p_company_id,v_workflow_id,p_customer_application_id,v_existing_operation_id,null,v_final_state,
    'workflow.committed',
    jsonb_build_object(
      'continuation_job_id',v_job_id,
      'power_of_attorney_id',p_power_of_attorney_id
    ),
    format('workflow.committed:%s',p_customer_application_id)
  ) on conflict (company_id,idempotency_key) do nothing;

  perform public.gridex_record_application_provisioning_step(
    p_company_id,p_customer_application_id,v_existing_operation_id,
    'workflow_committed','completed',
    jsonb_build_object(
      'workflow_id',v_workflow_id,
      'customer_id',p_customer_id,
      'customer_site_id',p_customer_site_id,
      'metering_point_id',p_metering_point_id,
      'contract_id',p_contract_id,
      'power_of_attorney_id',p_power_of_attorney_id,
      'state',v_final_state,
      'continuation_job_id',v_job_id
    )
  );

  perform public.gridex_record_application_provisioning_step(
    p_company_id,p_customer_application_id,v_existing_operation_id,
    'external_automation_queued','completed',
    jsonb_build_object(
      'workflow_id',v_workflow_id,
      'continuation_job_id',v_job_id,
      'job_type','customer_application_continuation'
    )
  );

  return query
  select v_existing_operation_id, v_final_state, v_workflow_id, v_job_id;
end;
$function$;

revoke all on function public.gridex_commit_customer_application_provisioning(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.gridex_commit_customer_application_provisioning(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)
  to service_role;
