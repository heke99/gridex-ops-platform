-- Customer operation automation: fast UI enqueue, idempotent worker chain and exact Z01/Z02 correlation.
-- Tenant-safe. No destructive operations.

create table if not exists public.customer_operation_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  customer_site_id uuid null references public.customer_sites(id) on delete cascade,
  metering_point_id uuid null references public.metering_points(id) on delete set null,
  job_type text not null,
  status text not null default 'queued',
  priority smallint not null default 100,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz null,
  locked_by text null,
  last_error text null,
  created_by uuid null references auth.users(id) on delete set null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_operation_jobs_status_check check (status in ('queued','running','waiting_response','completed','needs_review','failed','skipped','cancelled')),
  constraint customer_operation_jobs_attempts_check check (attempts >= 0 and max_attempts > 0)
);

create unique index if not exists customer_operation_jobs_active_idempotency_uidx
  on public.customer_operation_jobs(company_id, job_type, idempotency_key)
  where status in ('queued','running','waiting_response');

create index if not exists customer_operation_jobs_claim_idx
  on public.customer_operation_jobs(status, run_after, priority, created_at)
  where status = 'queued';

create index if not exists customer_operation_jobs_customer_idx
  on public.customer_operation_jobs(company_id, customer_id, created_at desc);

alter table public.customer_info_requests add column if not exists grid_owner_data_request_id uuid;
alter table public.customer_info_requests add column if not exists outbound_request_id uuid;
alter table public.customer_info_requests add column if not exists ediel_message_id uuid;
alter table public.customer_info_requests add column if not exists interchange_reference text;
alter table public.customer_info_requests add column if not exists transaction_reference text;
alter table public.customer_info_requests add column if not exists correlation_reference text;
alter table public.customer_info_requests add column if not exists external_reference text;
alter table public.customer_info_requests add column if not exists response_ediel_message_id uuid;

create index if not exists customer_info_requests_grid_owner_data_request_idx
  on public.customer_info_requests(company_id, grid_owner_data_request_id)
  where grid_owner_data_request_id is not null;
create index if not exists customer_info_requests_outbound_message_idx
  on public.customer_info_requests(company_id, ediel_message_id)
  where ediel_message_id is not null;
create index if not exists customer_info_requests_reference_match_idx
  on public.customer_info_requests(company_id, external_reference, transaction_reference, correlation_reference);

create or replace function public.gridex_claim_customer_operation_jobs(
  p_worker_id text,
  p_limit integer default 20
)
returns setof public.customer_operation_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.customer_operation_jobs
    where status = 'queued'
      and run_after <= now()
      and (locked_at is null or locked_at < now() - interval '15 minutes')
    order by priority asc, run_after asc, created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  update public.customer_operation_jobs jobs
  set status = 'running',
      attempts = jobs.attempts + 1,
      locked_at = now(),
      locked_by = nullif(trim(p_worker_id), ''),
      updated_at = now()
  from candidates
  where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

revoke all on function public.gridex_claim_customer_operation_jobs(text, integer) from public;
revoke all on function public.gridex_claim_customer_operation_jobs(text, integer) from anon;
revoke all on function public.gridex_claim_customer_operation_jobs(text, integer) from authenticated;
grant execute on function public.gridex_claim_customer_operation_jobs(text, integer) to service_role;

alter table public.customer_operation_jobs enable row level security;
