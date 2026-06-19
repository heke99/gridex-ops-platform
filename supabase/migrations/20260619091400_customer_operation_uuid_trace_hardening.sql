-- Customer operation UUID and trace hardening.
-- Forward-only: adds trace defaults and queue/snapshot indexes without rewriting old migrations.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.customer_operation_jobs') is not null then
    alter table public.customer_operation_jobs
      add column if not exists trace_id uuid;

    alter table public.customer_operation_jobs
      alter column trace_id set default gen_random_uuid();

    update public.customer_operation_jobs
       set trace_id = gen_random_uuid()
     where trace_id is null;

    create index if not exists customer_operation_jobs_company_trace_idx
      on public.customer_operation_jobs(company_id, trace_id)
      where trace_id is not null;
  end if;
end $$;

do $$
begin
  if to_regclass('public.customer_operation_request_snapshots') is not null then
    alter table public.customer_operation_request_snapshots
      add column if not exists trace_id uuid;

    alter table public.customer_operation_request_snapshots
      alter column trace_id set default gen_random_uuid();

    update public.customer_operation_request_snapshots
       set trace_id = gen_random_uuid()
     where trace_id is null;

    create index if not exists customer_operation_request_snapshots_route_idx
      on public.customer_operation_request_snapshots(company_id, route_profile_id, created_at desc)
      where route_profile_id is not null;

    create index if not exists customer_operation_request_snapshots_reference_idx
      on public.customer_operation_request_snapshots(company_id, request_reference, operation_id)
      where request_reference is not null;
  end if;
end $$;
