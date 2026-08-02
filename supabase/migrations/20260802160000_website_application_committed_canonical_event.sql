-- Project durable workflow commits into the canonical audit/domain/outbox ledgers.
-- The AFTER INSERT trigger runs in the same transaction as
-- gridex_commit_customer_application_provisioning, so no application can be
-- committed without its canonical event, and retries keep one stable identity.

begin;

create or replace function public.project_website_application_committed_event()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_event_type constant text:='WEBSITE_APPLICATION_COMMITTED';
  v_topic constant text:='website.application.committed';
  v_idempotency_key text;
  v_domain_event_id uuid;
  v_payload jsonb;
begin
  if new.event_code<>'workflow.committed' then return new; end if;

  v_idempotency_key:=format('website_application_committed:%s',new.customer_application_id);
  v_payload:=jsonb_build_object(
    'customer_application_id',new.customer_application_id,
    'workflow_id',new.workflow_id,
    'operation_id',new.operation_id,
    'state',new.to_state,
    'workflow_event_id',new.id,
    'workflow_event_occurred_at',new.occurred_at,
    'metadata',new.metadata
  );

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,
    idempotency_key,after_state,metadata
  ) values (
    new.company_id,v_event_type,'website_customer_application',new.customer_application_id,
    new.actor_user_id,'Durable customer-application workflow committed.',
    v_idempotency_key,jsonb_build_object('state',new.to_state,'workflow_id',new.workflow_id),v_payload
  ) on conflict(company_id,event_type,idempotency_key) do nothing;

  insert into public.canonical_domain_events(
    company_id,event_type,aggregate_type,aggregate_id,idempotency_key,payload,created_by
  ) values (
    new.company_id,v_event_type,'website_customer_application',new.customer_application_id,
    v_idempotency_key,v_payload,new.actor_user_id
  ) on conflict(company_id,event_type,idempotency_key) do nothing;

  select id into strict v_domain_event_id
  from public.canonical_domain_events
  where company_id=new.company_id and event_type=v_event_type
    and idempotency_key=v_idempotency_key;

  insert into public.canonical_event_outbox(
    company_id,domain_event_id,topic,idempotency_key,payload
  ) values (
    new.company_id,v_domain_event_id,v_topic,v_idempotency_key,v_payload
  ) on conflict(company_id,topic,idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger if exists customer_application_workflow_committed_canonical_v1
  on public.customer_application_workflow_events;
create trigger customer_application_workflow_committed_canonical_v1
after insert on public.customer_application_workflow_events
for each row
when (new.event_code='workflow.committed')
execute function public.project_website_application_committed_event();

revoke all on function public.project_website_application_committed_event()
  from public,anon,authenticated;

commit;
