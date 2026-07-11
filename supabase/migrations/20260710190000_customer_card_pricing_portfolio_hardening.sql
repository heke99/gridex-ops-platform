-- Customer-card simplification and tenant portfolio pricing hardening.

begin;

-- Portfolio prices are versioned per tenant, price area and month. Only one
-- non-superseded row may be active for a combination.
alter table if exists public.portfolio_monthly_prices
  add column if not exists version_number integer not null default 1,
  add column if not exists supersedes_id uuid null references public.portfolio_monthly_prices(id) on delete set null,
  add column if not exists superseded_at timestamptz null,
  add column if not exists confirmed_at timestamptz null,
  add column if not exists updated_by uuid null;

do $$
begin
  if to_regclass('public.portfolio_monthly_prices') is not null then
    alter table public.portfolio_monthly_prices drop constraint if exists portfolio_monthly_prices_status_check;
    alter table public.portfolio_monthly_prices
      add constraint portfolio_monthly_prices_status_check
      check (status in ('draft','confirmed','locked','superseded'));
  end if;
end $$;

drop index if exists public.ux_portfolio_monthly_prices_company_area_month;
create unique index if not exists ux_portfolio_monthly_prices_active_company_area_month
  on public.portfolio_monthly_prices(company_id, price_area, billing_month)
  where superseded_at is null and status <> 'superseded';
create index if not exists idx_portfolio_monthly_prices_lookup
  on public.portfolio_monthly_prices(company_id, price_area, billing_month, version_number desc)
  where superseded_at is null and status in ('confirmed','locked');

create table if not exists public.portfolio_monthly_price_history (
  id uuid primary key default gen_random_uuid(),
  portfolio_price_id uuid not null references public.portfolio_monthly_prices(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  version_number integer not null,
  action text not null,
  old_values jsonb null,
  new_values jsonb null,
  changed_by uuid null,
  changed_at timestamptz not null default now()
);
create index if not exists idx_portfolio_monthly_price_history_price
  on public.portfolio_monthly_price_history(portfolio_price_id, changed_at desc);
create index if not exists idx_portfolio_monthly_price_history_company
  on public.portfolio_monthly_price_history(company_id, changed_at desc);

alter table public.portfolio_monthly_price_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'portfolio_monthly_price_history'
      and policyname = 'portfolio_monthly_price_history_tenant_select'
  ) then
    create policy portfolio_monthly_price_history_tenant_select
      on public.portfolio_monthly_price_history
      for select
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
end $$;

create or replace function public.gridex_capture_portfolio_monthly_price_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_id uuid;
  row_company_id uuid;
  row_version integer;
  row_changed_by uuid;
  row_old jsonb;
  row_new jsonb;
begin
  if tg_op = 'DELETE' then
    row_id := old.id;
    row_company_id := old.company_id;
    row_version := coalesce(old.version_number, 1);
    row_changed_by := coalesce(old.updated_by, old.created_by);
    row_old := to_jsonb(old);
    row_new := null;
  elsif tg_op = 'INSERT' then
    row_id := new.id;
    row_company_id := new.company_id;
    row_version := coalesce(new.version_number, 1);
    row_changed_by := coalesce(new.updated_by, new.created_by);
    row_old := null;
    row_new := to_jsonb(new);
  else
    row_id := new.id;
    row_company_id := new.company_id;
    row_version := coalesce(new.version_number, old.version_number, 1);
    row_changed_by := coalesce(new.updated_by, new.created_by, old.updated_by, old.created_by);
    row_old := to_jsonb(old);
    row_new := to_jsonb(new);
  end if;

  insert into public.portfolio_monthly_price_history(
    portfolio_price_id,
    company_id,
    version_number,
    action,
    old_values,
    new_values,
    changed_by
  ) values (
    row_id,
    row_company_id,
    row_version,
    lower(tg_op),
    row_old,
    row_new,
    row_changed_by
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_portfolio_monthly_price_history on public.portfolio_monthly_prices;
create trigger trg_portfolio_monthly_price_history
after insert or update or delete on public.portfolio_monthly_prices
for each row execute function public.gridex_capture_portfolio_monthly_price_history();

-- Lifecycle decisions distinguish legal withdrawal, operational cancellation
-- and rejection. Existing rows remain valid.
alter table if exists public.customer_lifecycle_decisions
  add column if not exists received_at timestamptz null,
  add column if not exists received_channel text null,
  add column if not exists notes text null;

do $$
begin
  if to_regclass('public.customer_lifecycle_decisions') is not null then
    alter table public.customer_lifecycle_decisions drop constraint if exists customer_lifecycle_decisions_decision_type_check;
    alter table public.customer_lifecycle_decisions
      add constraint customer_lifecycle_decisions_decision_type_check
      check (decision_type in ('withdrawal','cancelled','rejected'));
  end if;
end $$;

commit;
