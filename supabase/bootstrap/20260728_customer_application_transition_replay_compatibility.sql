-- AUD-003 replay compatibility artifact.
-- Source: supabase/migrations/20260724210000_customer_application_continuation_orchestrator.sql
--
-- Re-establishes the canonical alias-qualified transition RPC immediately before
-- the 20260728170000 live-schema synchronization. This is replay-only provenance:
-- the timestamped source migration is still executed in full and no production
-- migration history is rewritten or skipped.

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

  if v_row.state in ('completed','cancelled')
     and p_to_state <> v_row.state
     and coalesce(p_event_code,'') <> 'workflow.reopened' then
    raise exception 'customer_application_workflow_terminal' using errcode='23514';
  end if;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''),
    format('workflow:%s:%s:%s:%s', v_row.id, v_row.workflow_version + 1, p_to_state, coalesce(p_event_code,'transition')));

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

  update public.customer_application_workflows workflow
  set state=p_to_state,
      next_action=coalesce(p_metadata->>'next_action',workflow.next_action),
      snapshot=coalesce(workflow.snapshot,'{}'::jsonb) || coalesce(p_metadata,'{}'::jsonb),
      failure_code=case when p_to_state='failed' then coalesce(nullif(btrim(p_reason_code),''),workflow.failure_code) else null end,
      completed_at=case when p_to_state in ('completed','cancelled') then now() else null end,
      last_transition_at=now(),
      workflow_version=workflow.workflow_version+1,
      updated_at=now()
  where workflow.id=v_row.id;

  return query
  select w.id,w.operation_id,w.state,w.workflow_version
  from public.customer_application_workflows w where w.id=v_row.id;
end;
$$;

revoke all on function public.gridex_transition_customer_application_workflow(uuid,uuid,text,text,text,jsonb,uuid,integer,text)
  from public,anon,authenticated;
grant execute on function public.gridex_transition_customer_application_workflow(uuid,uuid,text,text,text,jsonb,uuid,integer,text)
  to service_role;
