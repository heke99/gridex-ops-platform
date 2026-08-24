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
      'automation_state', 'waiting_for_dependency'
    );
  end if;

  return new;
end
$$;

revoke all on function public.gridex_customer_application_dependency_wait_guard() from public;
grant execute on function public.gridex_customer_application_dependency_wait_guard() to service_role;

drop trigger if exists trg_customer_application_dependency_wait_guard on public.customer_operation_jobs;
create trigger trg_customer_application_dependency_wait_guard
before update of status, result on public.customer_operation_jobs
for each row
execute function public.gridex_customer_application_dependency_wait_guard();

comment on function public.gridex_customer_application_dependency_wait_guard() is
'Converts customer-application continuation outcomes that are only waiting for canonical grid-owner resolution into retryable dependency waits. Dependency waits do not consume retry budget and never authorize external dispatch.';
