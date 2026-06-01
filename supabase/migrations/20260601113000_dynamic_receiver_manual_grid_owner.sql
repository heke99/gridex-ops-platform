-- Dynamic Ediel receiver routing + manual grid-owner selection.
-- Additive only. No automatic web/postal lookup and no hardcoded receiver fallback.

begin;

create extension if not exists pgcrypto;

alter table if exists public.grid_owners
  add column if not exists environment text not null default 'production',
  add column if not exists lifecycle_status text not null default 'active',
  add column if not exists default_prodat_subaddress text,
  add column if not exists default_utilts_subaddress text,
  add column if not exists transport_channel text,
  add column if not exists communication_email text,
  add column if not exists source text,
  add column if not exists source_verified_at timestamptz;

do $$
begin
  if to_regclass('public.grid_owners') is not null then
    update public.grid_owners
       set lifecycle_status = case when coalesce(is_active, true) then coalesce(lifecycle_status, 'active') else 'blocked' end,
           environment = coalesce(environment, 'production'),
           communication_email = coalesce(communication_email, email)
     where lifecycle_status is null
        or environment is null
        or communication_email is null;
  end if;
end $$;

do $$
begin
  if to_regclass('public.grid_owners') is not null then
    if not exists (select 1 from pg_constraint where conname = 'grid_owners_environment_check') then
      alter table public.grid_owners
        add constraint grid_owners_environment_check check (environment in ('test','production'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'grid_owners_lifecycle_status_check') then
      alter table public.grid_owners
        add constraint grid_owners_lifecycle_status_check check (lifecycle_status in ('draft','verified','active','deprecated','blocked'));
    end if;
  end if;
end $$;

create index if not exists grid_owners_environment_active_idx
  on public.grid_owners(environment, is_active, lifecycle_status, name);

create index if not exists grid_owners_ediel_id_idx
  on public.grid_owners(environment, ediel_id)
  where ediel_id is not null;

alter table if exists public.customer_sites
  add column if not exists selected_grid_owner_id uuid references public.grid_owners(id) on delete set null,
  add column if not exists data_quality_status text not null default 'incomplete',
  add column if not exists missing_data_status text;

update public.customer_sites
   set selected_grid_owner_id = coalesce(selected_grid_owner_id, grid_owner_id),
       data_quality_status = case
         when coalesce(grid_owner_id, selected_grid_owner_id) is not null and facility_id is not null then 'complete'
         else 'incomplete'
       end,
       missing_data_status = case
         when coalesce(grid_owner_id, selected_grid_owner_id) is null then 'missing_grid_owner'
         when facility_id is null then 'missing_facility_id'
         else null
       end
 where to_regclass('public.customer_sites') is not null;

alter table if exists public.metering_points
  alter column meter_point_id drop not null,
  add column if not exists data_quality_status text not null default 'incomplete',
  add column if not exists verification_status text not null default 'pending';

update public.metering_points
   set data_quality_status = case
         when grid_owner_id is not null and meter_point_id is not null then 'complete'
         else 'incomplete'
       end,
       verification_status = case
         when grid_owner_id is not null and meter_point_id is not null then 'verified'
         else 'pending'
       end
 where to_regclass('public.metering_points') is not null;

alter table if exists public.ediel_route_profiles
  add column if not exists receiver_source text,
  add column if not exists dynamic_receiver_strategy text,
  add column if not exists counterparty_id uuid,
  add column if not exists receiver_email text;

update public.ediel_route_profiles
   set receiver_source = coalesce(receiver_source, case
         when environment = 'production' and receiver_ediel_id is null then 'selected_metering_point_grid_owner'
         when receiver_ediel_id is not null then 'fixed_counterparty'
         else 'selected_metering_point_grid_owner'
       end),
       dynamic_receiver_strategy = coalesce(dynamic_receiver_strategy, case
         when receiver_ediel_id is not null then 'resolve_from_counterparty_id'
         else 'resolve_from_selected_metering_point_grid_owner'
       end)
 where to_regclass('public.ediel_route_profiles') is not null;

do $$
begin
  if to_regclass('public.ediel_route_profiles') is not null then
    if not exists (select 1 from pg_constraint where conname = 'ediel_route_profiles_receiver_source_check') then
      alter table public.ediel_route_profiles
        add constraint ediel_route_profiles_receiver_source_check check (
          receiver_source is null or receiver_source in (
            'fixed_counterparty',
            'selected_metering_point_grid_owner',
            'selected_customer_site_grid_owner',
            'selected_supplier_switch_grid_owner',
            'selected_data_request_grid_owner',
            'original_inbound_sender',
            'original_inbound_receiver',
            'explicit_counterparty_role',
            'manual_superadmin_only'
          )
        );
    end if;
  end if;
end $$;


alter table if exists public.route_decision_logs
  add column if not exists receiver_source text,
  add column if not exists dynamic_receiver_strategy text;

alter table if exists public.ediel_routing_decisions
  add column if not exists dynamic_receiver_strategy text,
  add column if not exists customer_site_id uuid,
  add column if not exists supplier_switch_request_id uuid,
  add column if not exists data_request_id uuid,
  add column if not exists counterparty_id uuid;

alter table if exists public.ediel_messages
  add column if not exists resolved_sender_ediel_id text,
  add column if not exists resolved_receiver_ediel_id text,
  add column if not exists receiver_source text,
  add column if not exists resolved_grid_owner_id uuid references public.grid_owners(id) on delete set null,
  add column if not exists resolved_counterparty_id uuid,
  add column if not exists dynamic_receiver_strategy text;

create table if not exists public.customer_data_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  customer_id uuid,
  customer_site_id uuid,
  metering_point_id uuid,
  task_type text not null,
  status text not null default 'open',
  priority text not null default 'normal',
  assigned_to uuid,
  due_at timestamptz,
  description text,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid,
  updated_by uuid
);

create index if not exists customer_data_tasks_company_status_idx
  on public.customer_data_tasks(company_id, status, priority, created_at desc);

create index if not exists customer_data_tasks_customer_idx
  on public.customer_data_tasks(customer_id, status, created_at desc);

alter table public.customer_data_tasks enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_data_tasks' and policyname = 'customer_data_tasks_service_role_all') then
    create policy customer_data_tasks_service_role_all
      on public.customer_data_tasks
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

-- Backfill open missing-data tasks without duplicating active tasks.
insert into public.customer_data_tasks (
  company_id, customer_id, customer_site_id, task_type, status, priority, description, created_at, updated_at
)
select cs.company_id,
       cs.customer_id,
       cs.id,
       'missing_grid_owner',
       'open',
       'high',
       'Saknar vald nätägare. Välj nätägare innan Ediel kan skickas.',
       now(),
       now()
  from public.customer_sites cs
 where cs.grid_owner_id is null
   and not exists (
     select 1 from public.customer_data_tasks t
      where t.customer_site_id = cs.id
        and t.task_type = 'missing_grid_owner'
        and t.status in ('open','in_progress')
   );

insert into public.customer_data_tasks (
  company_id, customer_id, customer_site_id, task_type, status, priority, description, created_at, updated_at
)
select cs.company_id,
       cs.customer_id,
       cs.id,
       'missing_facility_id',
       'open',
       'high',
       'Saknar anläggnings-ID. Kunden kan sparas men Ediel som kräver anläggning blockeras tills uppgiften är kompletterad.',
       now(),
       now()
  from public.customer_sites cs
 where cs.facility_id is null
   and not exists (
     select 1 from public.customer_data_tasks t
      where t.customer_site_id = cs.id
        and t.task_type = 'missing_facility_id'
        and t.status in ('open','in_progress')
   );

commit;
