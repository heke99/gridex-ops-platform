-- Batch 4D: merge, fullmakts-scope, ånger/avvisning och verifieringshårdning.
-- Defensiv migration: lägger bara till saknade kolumner/tabeller och påverkar inte Ediel-facit.

do $$
begin
  if to_regclass('public.customers') is not null then
    alter table public.customers add column if not exists merged_into_customer_id uuid null;
    alter table public.customers add column if not exists merged_at timestamptz null;
    alter table public.customers add column if not exists merged_by uuid null;
    alter table public.customers add column if not exists merge_status text null;
    alter table public.customers add column if not exists lifecycle_closed_at timestamptz null;
    alter table public.customers add column if not exists lifecycle_status_reason text null;
    create index if not exists customers_company_merge_status_idx on public.customers(company_id, merge_status) where merge_status is not null;
    create index if not exists customers_company_merged_into_idx on public.customers(company_id, merged_into_customer_id) where merged_into_customer_id is not null;
  end if;
end $$;

create table if not exists public.customer_merge_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  primary_customer_id uuid not null,
  merged_customer_id uuid not null,
  reason text null,
  moved_counts jsonb not null default '{}'::jsonb,
  source_snapshot jsonb null,
  created_by uuid null,
  created_at timestamptz not null default now()
);

create index if not exists customer_merge_events_company_primary_idx
  on public.customer_merge_events(company_id, primary_customer_id, created_at desc);
create index if not exists customer_merge_events_company_merged_idx
  on public.customer_merge_events(company_id, merged_customer_id, created_at desc);

create table if not exists public.customer_lifecycle_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  customer_id uuid not null,
  decision_type text not null check (decision_type in ('withdrawal','rejected')),
  scope_type text not null default 'customer' check (scope_type in ('customer','contract','site','metering_point')),
  scope_id uuid null,
  reason text not null,
  billing_blocked boolean not null default true,
  created_by uuid null,
  created_at timestamptz not null default now()
);

create index if not exists customer_lifecycle_decisions_company_customer_idx
  on public.customer_lifecycle_decisions(company_id, customer_id, created_at desc);
create index if not exists customer_lifecycle_decisions_company_scope_idx
  on public.customer_lifecycle_decisions(company_id, scope_type, scope_id) where scope_id is not null;

do $$
begin
  if to_regclass('public.power_of_attorney_scopes') is null then
    create table public.power_of_attorney_scopes (
      id uuid primary key default gen_random_uuid(),
      company_id uuid null,
      customer_id uuid not null,
      power_of_attorney_id uuid not null,
      scope_type text not null default 'site',
      site_id uuid null,
      metering_point_id uuid null,
      customer_contract_id uuid null,
      status text not null default 'active',
      valid_from date null,
      valid_to date null,
      created_by uuid null,
      updated_by uuid null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  else
    alter table public.power_of_attorney_scopes add column if not exists company_id uuid null;
    alter table public.power_of_attorney_scopes add column if not exists customer_id uuid null;
    alter table public.power_of_attorney_scopes add column if not exists power_of_attorney_id uuid null;
    alter table public.power_of_attorney_scopes add column if not exists scope_type text not null default 'site';
    alter table public.power_of_attorney_scopes add column if not exists site_id uuid null;
    alter table public.power_of_attorney_scopes add column if not exists metering_point_id uuid null;
    alter table public.power_of_attorney_scopes add column if not exists customer_contract_id uuid null;
    alter table public.power_of_attorney_scopes add column if not exists status text not null default 'active';
    alter table public.power_of_attorney_scopes add column if not exists valid_from date null;
    alter table public.power_of_attorney_scopes add column if not exists valid_to date null;
    alter table public.power_of_attorney_scopes add column if not exists created_by uuid null;
    alter table public.power_of_attorney_scopes add column if not exists updated_by uuid null;
    alter table public.power_of_attorney_scopes add column if not exists created_at timestamptz not null default now();
    alter table public.power_of_attorney_scopes add column if not exists updated_at timestamptz not null default now();
  end if;

  create index if not exists power_of_attorney_scopes_company_customer_idx
    on public.power_of_attorney_scopes(company_id, customer_id);
  create index if not exists power_of_attorney_scopes_company_poa_idx
    on public.power_of_attorney_scopes(company_id, power_of_attorney_id);
  create index if not exists power_of_attorney_scopes_company_site_idx
    on public.power_of_attorney_scopes(company_id, site_id) where site_id is not null;
  create index if not exists power_of_attorney_scopes_company_metering_idx
    on public.power_of_attorney_scopes(company_id, metering_point_id) where metering_point_id is not null;
end $$;

alter table public.customer_merge_events enable row level security;
alter table public.customer_lifecycle_decisions enable row level security;
alter table public.power_of_attorney_scopes enable row level security;

do $$
begin
  if to_regclass('public.company_memberships') is not null then
    drop policy if exists customer_merge_events_company_members on public.customer_merge_events;
    create policy customer_merge_events_company_members on public.customer_merge_events
      for all using (
        exists (
          select 1 from public.company_memberships cm
          where cm.company_id = customer_merge_events.company_id
            and cm.user_id = auth.uid()
        )
      ) with check (
        exists (
          select 1 from public.company_memberships cm
          where cm.company_id = customer_merge_events.company_id
            and cm.user_id = auth.uid()
        )
      );

    drop policy if exists customer_lifecycle_decisions_company_members on public.customer_lifecycle_decisions;
    create policy customer_lifecycle_decisions_company_members on public.customer_lifecycle_decisions
      for all using (
        exists (
          select 1 from public.company_memberships cm
          where cm.company_id = customer_lifecycle_decisions.company_id
            and cm.user_id = auth.uid()
        )
      ) with check (
        exists (
          select 1 from public.company_memberships cm
          where cm.company_id = customer_lifecycle_decisions.company_id
            and cm.user_id = auth.uid()
        )
      );

    drop policy if exists power_of_attorney_scopes_company_members on public.power_of_attorney_scopes;
    create policy power_of_attorney_scopes_company_members on public.power_of_attorney_scopes
      for all using (
        exists (
          select 1 from public.company_memberships cm
          where cm.company_id = power_of_attorney_scopes.company_id
            and cm.user_id = auth.uid()
        )
      ) with check (
        exists (
          select 1 from public.company_memberships cm
          where cm.company_id = power_of_attorney_scopes.company_id
            and cm.user_id = auth.uid()
        )
      );
  end if;
end $$;
