-- Gridex customer operations runtime hotfix
-- Fixes runtime gaps between customer_operation_jobs, outbound_requests,
-- ediel_messages and ediel_outbox.

begin;

-- 1) customer_operation_jobs must never be persisted with run_after = null.
create or replace function public.gridex_customer_operation_jobs_run_after_guard()
returns trigger
language plpgsql
as $$
begin
  if new.run_after is null then
    new.run_after := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_customer_operation_jobs_run_after_guard
on public.customer_operation_jobs;

create trigger trg_customer_operation_jobs_run_after_guard
before insert or update on public.customer_operation_jobs
for each row
execute function public.gridex_customer_operation_jobs_run_after_guard();

update public.customer_operation_jobs
set run_after = now(), updated_at = now()
where run_after is null;

alter table public.customer_operation_jobs
alter column run_after set default now();

-- 2) First-class linkage fields for facility lookup dispatch repair/monitoring.
alter table public.outbound_requests
  add column if not exists grid_owner_information_request_id uuid null,
  add column if not exists customer_site_id uuid null;

create index if not exists outbound_requests_grid_owner_information_request_idx
  on public.outbound_requests(company_id, grid_owner_information_request_id)
  where grid_owner_information_request_id is not null;

create index if not exists outbound_requests_customer_site_idx
  on public.outbound_requests(company_id, customer_site_id)
  where customer_site_id is not null;

-- Backfill first-class links from payload/source for existing facility lookup outbounds.
update public.outbound_requests o
set
  grid_owner_information_request_id = coalesce(
    o.grid_owner_information_request_id,
    nullif(o.payload->>'grid_owner_information_request_id', '')::uuid,
    case when o.source_type = 'manual' and o.automation_origin = 'facility_lookup_edifact_dispatch' then o.source_id else null end
  ),
  customer_site_id = coalesce(o.customer_site_id, o.site_id),
  updated_at = now()
where o.automation_origin = 'facility_lookup_edifact_dispatch'
  and (o.grid_owner_information_request_id is null or o.customer_site_id is null);

-- 3) ediel_outbox status/lock compatibility for the transport worker.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'ediel_outbox'
  ) then
    alter table public.ediel_outbox add column if not exists locked_at timestamptz null;
    alter table public.ediel_outbox add column if not exists locked_by text null;
    alter table public.ediel_outbox add column if not exists send_attempt_count integer not null default 0;
    alter table public.ediel_outbox add column if not exists current_send_attempt_id uuid null;

    alter table public.ediel_outbox drop constraint if exists ediel_outbox_status_check;
    alter table public.ediel_outbox
      add constraint ediel_outbox_status_check
      check (status in ('draft','prepared','queued','sending','sent','failed','superseded','blocked','delivery_uncertain'));

    create index if not exists ediel_outbox_runtime_claim_idx
      on public.ediel_outbox(environment, status, priority, created_at)
      where status in ('prepared','queued','sending');
  end if;
end $$;

commit;
