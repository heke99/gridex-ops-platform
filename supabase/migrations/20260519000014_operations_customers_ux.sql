-- Batch 3 + 4: Operations UX + Customers UX
-- Safe/idempotent additions for switch event archiving and customer registry performance.

-- Supplier switch events: soft archive instead of hard delete.
do $$
begin
  if to_regclass('public.supplier_switch_events') is not null then
    alter table public.supplier_switch_events
      add column if not exists archived_at timestamptz;

    alter table public.supplier_switch_events
      add column if not exists archived_by uuid;

    alter table public.supplier_switch_events
      add column if not exists archive_reason text;

    alter table public.supplier_switch_events
      add column if not exists company_id uuid;
  end if;
end $$;

-- Add FK guards only when referenced tables exist and constraints are missing.
do $$
begin
  if to_regclass('public.supplier_switch_events') is not null
     and to_regclass('auth.users') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'supplier_switch_events_archived_by_fkey'
     ) then
    alter table public.supplier_switch_events
      add constraint supplier_switch_events_archived_by_fkey
      foreign key (archived_by) references auth.users(id) on delete set null;
  end if;
end $$;

do $$
begin
  if to_regclass('public.supplier_switch_events') is not null
     and to_regclass('public.companies') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'supplier_switch_events_company_id_fkey'
     ) then
    alter table public.supplier_switch_events
      add constraint supplier_switch_events_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete set null;
  end if;
end $$;

-- Helpful indexes for operations/customer views.
do $$
begin
  if to_regclass('public.supplier_switch_events') is not null then
    execute 'create index if not exists supplier_switch_events_visible_created_idx on public.supplier_switch_events (created_at desc) where archived_at is null';
    execute 'create index if not exists supplier_switch_events_switch_visible_idx on public.supplier_switch_events (switch_request_id, created_at desc) where archived_at is null';
    execute 'create index if not exists supplier_switch_events_company_visible_idx on public.supplier_switch_events (company_id, created_at desc) where archived_at is null';
  end if;

  if to_regclass('public.customer_sites') is not null then
    execute 'create index if not exists customer_sites_customer_status_idx on public.customer_sites (customer_id, status)';
  end if;

  if to_regclass('public.metering_points') is not null then
    execute 'create index if not exists metering_points_site_status_idx on public.metering_points (site_id, status)';
  end if;

  if to_regclass('public.powers_of_attorney') is not null then
    execute 'create index if not exists powers_of_attorney_customer_status_idx on public.powers_of_attorney (customer_id, status)';
  end if;

  if to_regclass('public.supplier_switch_requests') is not null then
    execute 'create index if not exists supplier_switch_requests_customer_status_idx on public.supplier_switch_requests (customer_id, status)';
  end if;

  if to_regclass('public.outbound_requests') is not null then
    execute 'create index if not exists outbound_requests_customer_request_type_idx on public.outbound_requests (customer_id, request_type, status)';
  end if;
end $$;
