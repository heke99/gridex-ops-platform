-- Canonical multitenant website application flow completion.
-- One code path and one database contract for every tenant.

begin;

alter table if exists public.companies
  add column if not exists customer_portal_url text;

alter table if exists public.companies
  drop constraint if exists companies_customer_portal_url_https_check;
alter table if exists public.companies
  add constraint companies_customer_portal_url_https_check
  check (
    customer_portal_url is null
    or (
      customer_portal_url ~ '^https://[^[:space:]]+$'
      and customer_portal_url !~ '[@#]'
    )
  ) not valid;
alter table if exists public.companies
  validate constraint companies_customer_portal_url_https_check;

alter table if exists public.website_customer_applications
  add column if not exists portal_identity_required boolean not null default false;

create or replace function public.gridex_validate_website_application_portal_identity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id text;
  v_portal_user_id text;
begin
  if coalesce(new.portal_identity_required, false) is not true then
    return new;
  end if;

  v_auth_user_id := nullif(trim(coalesce(new.payload ->> 'auth_user_id', new.payload ->> 'web_auth_user_id', '')), '');
  v_portal_user_id := nullif(trim(coalesce(new.payload ->> 'customer_portal_user_id', new.payload ->> 'web_auth_user_id', '')), '');

  if v_auth_user_id is null or v_portal_user_id is null then
    raise exception using
      errcode = '23514',
      message = 'portal_auth_identity_required',
      detail = 'Website applications require auth_user_id and customer_portal_user_id.';
  end if;
  if v_auth_user_id <> v_portal_user_id
     or v_auth_user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using
      errcode = '23514',
      message = 'portal_auth_identity_mismatch',
      detail = 'Portal identifiers must be the same valid UUID.';
  end if;
  return new;
end;
$$;

revoke all on function public.gridex_validate_website_application_portal_identity() from public, anon, authenticated;
grant execute on function public.gridex_validate_website_application_portal_identity() to service_role;

drop trigger if exists gridex_validate_website_application_portal_identity on public.website_customer_applications;
create trigger gridex_validate_website_application_portal_identity
before insert or update of payload, portal_identity_required
on public.website_customer_applications
for each row execute function public.gridex_validate_website_application_portal_identity();

-- Receipt state must distinguish a provisioned credential from a fully ready tenant.
do $$
begin
  if to_regclass('public.tenant_website_installation_receipts') is not null then
    alter table public.tenant_website_installation_receipts
      drop constraint if exists tenant_website_installation_receipts_state_check;
    alter table public.tenant_website_installation_receipts
      add constraint tenant_website_installation_receipts_state_check
      check (state in (
        'requested','company_ready','client_ready','credential_created',
        'preflight_passed','feed_verified','completed','blocked','failed'
      ));
  end if;
end $$;

-- Stored launch flags from the previous scopes-only model are unsafe. Existing
-- tenant website clients and receipts must be re-verified by the canonical
-- readiness service after this migration and application deployment.
update public.integration_api_clients
set launch_ready = false,
    launch_blockers = jsonb_build_array(jsonb_build_object(
      'code', 'canonical_readiness_revalidation_required',
      'migration', '20260804121000'
    )),
    updated_at = now()
where profile_key = 'tenant_website'
  and status = 'active';

do $$
begin
  if to_regclass('public.tenant_website_installation_receipts') is not null then
    update public.tenant_website_installation_receipts receipt
    set state = 'blocked',
        completed_at = null,
        failure_code = 'CANONICAL_READINESS_REVALIDATION_REQUIRED',
        failure_message = 'Re-run tenant website readiness after migration 20260804121000.',
        readiness_blockers = jsonb_build_array(jsonb_build_object(
          'code', 'canonical_readiness_revalidation_required',
          'migration', '20260804121000'
        )),
        updated_at = now()
    from public.integration_api_clients client
    where client.id = receipt.api_client_id
      and client.profile_key = 'tenant_website'
      and client.status = 'active'
      and receipt.state = 'completed';
  end if;
end $$;

-- Status lookup must always use application lineage, never "latest for customer".
create index if not exists supplier_switch_requests_application_contract_idx
  on public.supplier_switch_requests(company_id, customer_id, customer_contract_id, created_at desc)
  where customer_contract_id is not null;
create index if not exists supplier_switch_requests_application_site_idx
  on public.supplier_switch_requests(company_id, customer_id, customer_site_id, created_at desc)
  where customer_site_id is not null;
create index if not exists supplier_switch_requests_application_meter_idx
  on public.supplier_switch_requests(company_id, customer_id, metering_point_id, created_at desc)
  where metering_point_id is not null;
create index if not exists customer_supply_periods_application_contract_idx
  on public.customer_supply_periods(company_id, customer_id, customer_contract_id, start_date desc)
  where customer_contract_id is not null;
create index if not exists customer_supply_periods_application_meter_idx
  on public.customer_supply_periods(company_id, customer_id, metering_point_id, start_date desc)
  where metering_point_id is not null;
create index if not exists customer_operation_jobs_workflow_continuation_idx
  on public.customer_operation_jobs(company_id, workflow_id, created_at desc)
  where job_type = 'customer_application_continuation';
create index if not exists communication_logs_application_metadata_idx
  on public.communication_logs(company_id, ((metadata ->> 'application_id')), created_at desc)
  where metadata ? 'application_id';
create index if not exists event_outbox_webhook_fanout_due_idx
  on public.event_outbox(destination_type, destination_key, status, available_at, created_at)
  where destination_type = 'webhook' and destination_key = 'webhook_fanout_v1';

-- Database safety net: terminal continuation jobs must never leave a public
-- application looking accepted/processing. The application worker performs the
-- same projection; this trigger protects manual SQL and future workers too.
create or replace function public.gridex_project_terminal_application_continuation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_application_id uuid;
  v_state text;
  v_public_status text;
  v_next_step text;
  v_reason text;
begin
  if new.job_type <> 'customer_application_continuation'
     or new.status not in ('failed','delivery_uncertain')
     or new.status is not distinct from old.status then
    return new;
  end if;

  begin
    v_application_id := nullif(new.payload ->> 'application_id', '')::uuid;
  exception when others then
    v_application_id := null;
  end;
  if v_application_id is null then return new; end if;

  v_state := 'failed';
  v_public_status := 'failed';
  v_next_step := 'resume_customer_application_continuation';
  v_reason := coalesce(new.last_error_code, new.last_error_message, new.last_error, 'customer_application_continuation_failed');

  update public.customer_application_workflows
  set state = v_state,
      next_action = v_next_step,
      failure_code = v_reason,
      snapshot = coalesce(snapshot, '{}'::jsonb) || jsonb_build_object(
        'terminal_job_id', new.id,
        'terminal_job_status', new.status,
        'terminal_error', v_reason
      ),
      last_job_id = new.id,
      last_transition_at = now(),
      updated_at = now()
  where company_id = new.company_id
    and customer_application_id = v_application_id;

  update public.website_customer_applications
  set status = 'failed',
      next_step = v_next_step,
      response_payload = coalesce(response_payload, '{}'::jsonb) || jsonb_build_object(
        'status', v_public_status,
        'workflow_state', v_state,
        'next_step', v_next_step,
        'blocking_reason', v_reason,
        'automation', jsonb_build_object(
          'status', new.status,
          'error_code', new.last_error_code,
          'error_message', coalesce(new.last_error_message, new.last_error)
        )
      ),
      updated_at = now()
  where id = v_application_id
    and company_id = new.company_id;

  return new;
end;
$$;

revoke all on function public.gridex_project_terminal_application_continuation() from public, anon, authenticated;
grant execute on function public.gridex_project_terminal_application_continuation() to service_role;

drop trigger if exists gridex_project_terminal_application_continuation on public.customer_operation_jobs;
create trigger gridex_project_terminal_application_continuation
after update of status on public.customer_operation_jobs
for each row execute function public.gridex_project_terminal_application_continuation();

-- Existing public roles may not mutate these internal workflow primitives.
revoke all on public.event_outbox from anon, authenticated;
revoke all on public.customer_operation_jobs from anon;
grant all on public.event_outbox to service_role;

do $$
begin
  if to_regclass('public.website_customer_applications') is not null then
    alter table public.website_customer_applications enable row level security;
  end if;
  if to_regclass('public.event_outbox') is not null then
    alter table public.event_outbox enable row level security;
  end if;
end $$;

commit;
