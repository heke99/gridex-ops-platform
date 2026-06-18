-- Tenant-safe operational timeline. Customer portal events remain in customer_events.
-- This migration is additive and intentionally leaves existing customer_events untouched.

create table if not exists public.customer_operation_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  customer_site_id uuid null references public.customer_sites(id) on delete set null,
  metering_point_id uuid null references public.metering_points(id) on delete set null,
  customer_operation_job_id uuid null references public.customer_operation_jobs(id) on delete set null,
  operation_id uuid null,
  event_code text not null,
  title text not null,
  message text not null,
  status text not null default 'in_progress',
  severity text not null default 'info',
  action_required boolean not null default false,
  action_url text null,
  source text not null default 'customer_operations',
  visibility text not null default 'tenant',
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint customer_operation_events_status_check check (status in (
    'queued','in_progress','waiting_response','response_received','completed','needs_review','failed','blocked','skipped','cancelled'
  )),
  constraint customer_operation_events_severity_check check (severity in ('info','warning','error','critical')),
  constraint customer_operation_events_visibility_check check (visibility in ('tenant','platform'))
);

create unique index if not exists customer_operation_events_company_idempotency_uidx
  on public.customer_operation_events(company_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists customer_operation_events_company_time_idx
  on public.customer_operation_events(company_id, occurred_at desc, id desc);
create index if not exists customer_operation_events_company_customer_time_idx
  on public.customer_operation_events(company_id, customer_id, occurred_at desc, id desc);
create index if not exists customer_operation_events_company_site_time_idx
  on public.customer_operation_events(company_id, customer_site_id, occurred_at desc, id desc)
  where customer_site_id is not null;
create index if not exists customer_operation_events_company_status_time_idx
  on public.customer_operation_events(company_id, status, occurred_at desc, id desc);
create index if not exists customer_operation_events_company_action_time_idx
  on public.customer_operation_events(company_id, action_required, occurred_at desc, id desc)
  where action_required;
create index if not exists customer_operation_events_company_operation_time_idx
  on public.customer_operation_events(company_id, operation_id, occurred_at desc, id desc)
  where operation_id is not null;

alter table if exists public.customer_operation_jobs
  add column if not exists operation_id uuid;
update public.customer_operation_jobs
set operation_id = id
where operation_id is null;
alter table if exists public.customer_operation_jobs
  alter column operation_id set default gen_random_uuid();
alter table if exists public.customer_operation_jobs
  alter column operation_id set not null;
create index if not exists customer_operation_jobs_company_operation_idx
  on public.customer_operation_jobs(company_id, operation_id, created_at desc);

-- The same operation ID follows its user-visible request and its technical execution.
alter table if exists public.customer_info_requests add column if not exists operation_id uuid;
alter table if exists public.grid_owner_data_requests add column if not exists operation_id uuid;
alter table if exists public.supplier_switch_requests add column if not exists operation_id uuid;
alter table if exists public.outbound_requests add column if not exists operation_id uuid;
alter table if exists public.ediel_messages add column if not exists operation_id uuid;

do $$
begin
  if to_regclass('public.customer_info_requests') is not null then
    execute 'create index if not exists customer_info_requests_company_operation_idx on public.customer_info_requests(company_id, operation_id, created_at desc) where operation_id is not null';
  end if;
  if to_regclass('public.grid_owner_data_requests') is not null then
    execute 'create index if not exists grid_owner_data_requests_company_operation_idx on public.grid_owner_data_requests(company_id, operation_id, created_at desc) where operation_id is not null';
  end if;
  if to_regclass('public.supplier_switch_requests') is not null then
    execute 'create index if not exists supplier_switch_requests_company_operation_idx on public.supplier_switch_requests(company_id, operation_id, created_at desc) where operation_id is not null';
  end if;
  if to_regclass('public.outbound_requests') is not null then
    execute 'create index if not exists outbound_requests_company_operation_idx on public.outbound_requests(company_id, operation_id, created_at desc) where operation_id is not null';
  end if;
  if to_regclass('public.ediel_messages') is not null then
    execute 'create index if not exists ediel_messages_company_operation_idx on public.ediel_messages(company_id, operation_id, created_at desc) where operation_id is not null';
  end if;
end $$;

alter table public.customer_operation_events enable row level security;

do $$
begin
  if to_regprocedure('public.gridex_user_is_platform_admin()') is not null then
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'customer_operation_events'
        and policyname = 'customer_operation_events_service_role_all'
    ) then
      create policy customer_operation_events_service_role_all
        on public.customer_operation_events for all to service_role
        using (true) with check (true);
    end if;

    if to_regprocedure('public.gridex_can_read_company(uuid)') is not null and not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'customer_operation_events'
        and policyname = 'customer_operation_events_tenant_read'
    ) then
      create policy customer_operation_events_tenant_read
        on public.customer_operation_events for select to authenticated
        using (
          public.gridex_user_is_platform_admin()
          or (visibility = 'tenant' and public.gridex_can_read_company(company_id))
        );
    end if;
  end if;
end $$;

-- Read model for the tenant operations feed. SECURITY INVOKER preserves row-level tenant isolation.
create or replace function public.gridex_list_customer_operation_events(
  p_company_id uuid,
  p_search text default null,
  p_status text default null,
  p_event_group text default null,
  p_action_required boolean default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_cursor timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  company_id uuid,
  customer_id uuid,
  customer_site_id uuid,
  metering_point_id uuid,
  customer_operation_job_id uuid,
  operation_id uuid,
  event_code text,
  title text,
  message text,
  status text,
  severity text,
  action_required boolean,
  action_url text,
  source text,
  occurred_at timestamptz,
  customer_name text,
  customer_number text,
  customer_email text,
  site_name text,
  site_address text,
  facility_id text,
  metering_point_reference text,
  grid_owner_name text,
  job_type text,
  job_status text,
  payload jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    event.id,
    event.company_id,
    event.customer_id,
    event.customer_site_id,
    event.metering_point_id,
    event.customer_operation_job_id,
    event.operation_id,
    event.event_code,
    event.title,
    event.message,
    event.status,
    event.severity,
    event.action_required,
    event.action_url,
    event.source,
    event.occurred_at,
    coalesce(nullif(customer.company_name, ''), nullif(customer.full_name, ''), nullif(trim(concat_ws(' ', customer.first_name, customer.last_name)), ''), customer.email, 'Kund utan namn') as customer_name,
    customer.customer_number,
    customer.email as customer_email,
    site.site_name,
    nullif(trim(concat_ws(', ', nullif(site.street, ''), nullif(trim(concat_ws(' ', site.postal_code, site.city)), ''))), '') as site_address,
    site.facility_id,
    meter.meter_point_id as metering_point_reference,
    grid_owner.name as grid_owner_name,
    job.job_type,
    job.status as job_status,
    event.payload
  from public.customer_operation_events event
  join public.customers customer
    on customer.id = event.customer_id and customer.company_id = event.company_id
  left join public.customer_sites site
    on site.id = event.customer_site_id and site.company_id = event.company_id
  left join public.metering_points meter
    on meter.id = event.metering_point_id and meter.company_id = event.company_id
  left join public.grid_owners grid_owner
    on grid_owner.id = coalesce(meter.grid_owner_id, site.grid_owner_id)
  left join public.customer_operation_jobs job
    on job.id = event.customer_operation_job_id and job.company_id = event.company_id
  where event.company_id = p_company_id
    and (
      nullif(trim(p_search), '') is null
      or lower(concat_ws(' ',
        customer.customer_number,
        customer.company_name,
        customer.full_name,
        customer.first_name,
        customer.last_name,
        customer.email,
        site.site_name,
        site.street,
        site.postal_code,
        site.city,
        site.facility_id,
        meter.meter_point_id,
        grid_owner.name,
        event.operation_id::text,
        event.payload::text
      )) like '%' || lower(trim(p_search)) || '%'
    )
    and (p_status is null or event.status = p_status)
    and (p_event_group is null or split_part(event.event_code, '.', 1) = p_event_group)
    and (p_action_required is null or event.action_required = p_action_required)
    and (p_date_from is null or event.occurred_at >= p_date_from)
    and (p_date_to is null or event.occurred_at < p_date_to)
    and (
      p_cursor is null
      or event.occurred_at < p_cursor
      or (event.occurred_at = p_cursor and p_cursor_id is not null and event.id < p_cursor_id)
    )
  order by event.occurred_at desc, event.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.gridex_list_customer_operation_events(uuid, text, text, text, boolean, timestamptz, timestamptz, timestamptz, uuid, integer) from public;
grant execute on function public.gridex_list_customer_operation_events(uuid, text, text, text, boolean, timestamptz, timestamptz, timestamptz, uuid, integer) to authenticated;
grant execute on function public.gridex_list_customer_operation_events(uuid, text, text, text, boolean, timestamptz, timestamptz, timestamptz, uuid, integer) to service_role;
