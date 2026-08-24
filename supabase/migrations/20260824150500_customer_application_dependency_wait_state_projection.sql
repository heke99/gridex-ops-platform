create or replace function public.gridex_customer_application_dependency_wait_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_next_action text;
  v_first_blocker text;
  v_retry_at timestamptz;
  v_application_id uuid;
begin
  if new.job_type <> 'customer_application_continuation' then
    return new;
  end if;

  if new.status not in ('completed','needs_review') then
    return new;
  end if;

  v_next_action := nullif(new.result->>'next_action','');
  select nullif(item->>'code','')
    into v_first_blocker
  from jsonb_array_elements(coalesce(new.result->'blockers','[]'::jsonb)) item
  limit 1;

  if v_next_action = 'resolve_grid_owner'
     or v_first_blocker in ('grid_owner_missing','grid_owner_verification_required') then
    v_retry_at := now() + interval '1 hour';
    begin
      v_application_id := nullif(new.payload->>'application_id','')::uuid;
    exception when invalid_text_representation then
      v_application_id := null;
    end;

    new.status := 'queued';
    new.run_after := v_retry_at;
    new.completed_at := null;
    new.stale_reason := null;
    new.last_error := null;
    new.last_error_code := null;
    new.last_error_message := null;
    new.attempts := greatest(coalesce(new.attempts,0) - 1, 0);
    new.result := coalesce(new.result,'{}'::jsonb) || jsonb_build_object(
      'dependency_wait', true,
      'dependency_code', 'grid_owner_resolution',
      'retry_at', v_retry_at,
      'automation_state', 'waiting_for_dependency',
      'next_action', 'resolve_grid_owner',
      'workflow_state', 'facility_request_pending'
    );

    if new.customer_site_id is not null then
      update public.customer_sites
      set onboarding_status = 'needs_grid_owner_resolution',
          next_action = 'resolve_grid_owner',
          facility_data_status = 'pending_resolution',
          updated_at = now()
      where id = new.customer_site_id
        and company_id = new.company_id
        and customer_id = new.customer_id;
    end if;

    if v_application_id is not null then
      update public.customer_application_workflows
      set state = 'facility_request_pending',
          snapshot = coalesce(snapshot,'{}'::jsonb) || jsonb_build_object(
            'next_action','resolve_grid_owner',
            'automation_wait',true,
            'dependency_code','grid_owner_resolution',
            'retry_at',v_retry_at,
            'continuation_job_id',new.id
          ),
          updated_at = now()
      where company_id = new.company_id
        and customer_application_id = v_application_id;

      update public.website_customer_applications
      set status = 'needs_address_resolution',
          next_step = 'resolve_grid_owner',
          response_payload = coalesce(response_payload,'{}'::jsonb) || jsonb_build_object(
            'status','processing',
            'workflow_state','facility_request_pending',
            'next_step','resolve_grid_owner',
            'automation',jsonb_build_object(
              'status','waiting_for_dependency',
              'dependency_code','grid_owner_resolution',
              'retry_at',v_retry_at,
              'job_id',new.id
            )
          ),
          updated_at = now()
      where id = v_application_id
        and company_id = new.company_id;
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.gridex_customer_application_dependency_wait_guard() from public;
grant execute on function public.gridex_customer_application_dependency_wait_guard() to service_role;

comment on function public.gridex_customer_application_dependency_wait_guard() is
'Converts grid-owner-resolution-only continuation outcomes into retryable dependency waits, preserves retry budget, and projects the waiting state back to customer site, workflow, and website application.';
