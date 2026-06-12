-- Batch OPS-J..N: platform-admin agreement governance, action audit/usage events, and safe test-data cleanup.
-- This migration is intentionally idempotent and additive.

create table if not exists public.platform_usage_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  actor_user_id uuid null,
  api_client_id uuid null,
  customer_id uuid null,
  entity_type text not null,
  entity_id uuid null,
  event_key text not null,
  action_label text null,
  source text not null default 'admin_ui',
  billable_quantity numeric not null default 1,
  billing_unit text not null default 'action',
  is_billable boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.platform_usage_events enable row level security;

create index if not exists platform_usage_events_company_occurred_idx
  on public.platform_usage_events(company_id, occurred_at desc);
create index if not exists platform_usage_events_key_occurred_idx
  on public.platform_usage_events(event_key, occurred_at desc);
create index if not exists platform_usage_events_customer_idx
  on public.platform_usage_events(customer_id) where customer_id is not null;

alter table public.customers
  add column if not exists is_test_data boolean not null default false,
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null,
  add column if not exists archive_reason text null,
  add column if not exists anonymized_at timestamptz null,
  add column if not exists anonymized_by uuid null,
  add column if not exists data_retention_note text null;

alter table public.customer_sites
  add column if not exists is_test_data boolean not null default false,
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null,
  add column if not exists archive_reason text null;

alter table public.metering_points
  add column if not exists is_test_data boolean not null default false,
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null,
  add column if not exists archive_reason text null;

create index if not exists customers_test_data_idx
  on public.customers(company_id, is_test_data) where is_test_data = true;
create index if not exists customers_archived_idx
  on public.customers(company_id, archived_at) where archived_at is not null;
create index if not exists customer_sites_test_data_idx
  on public.customer_sites(company_id, is_test_data) where is_test_data = true;
create index if not exists metering_points_test_data_idx
  on public.metering_points(company_id, is_test_data) where is_test_data = true;

create or replace function public.gridex_customer_cleanup_external_ref(p_customer_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_external_ref text;
begin
  -- Some live schemas store external_customer_id on intake tables instead of customers.
  -- Keep this dynamic so the cleanup view does not break when a column is absent.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'customers'
      and column_name = 'external_customer_id'
  ) then
    execute 'select external_customer_id::text from public.customers where id = $1 limit 1'
      into v_external_ref
      using p_customer_id;
  end if;

  if coalesce(v_external_ref, '') <> '' then
    return v_external_ref;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'external_contract_intakes'
      and column_name = 'external_customer_id'
  ) then
    execute '
      select external_customer_id::text
      from public.external_contract_intakes
      where customer_id = $1
      order by created_at desc nulls last
      limit 1'
      into v_external_ref
      using p_customer_id;
  end if;

  return nullif(v_external_ref, '');
end;
$$;

create or replace view public.gridex_data_cleanup_customer_candidates_v as
select
  c.id as customer_id,
  c.company_id,
  c.customer_number,
  coalesce(nullif(c.full_name, ''), nullif(c.company_name, ''), concat_ws(' ', nullif(c.first_name, ''), nullif(c.last_name, '')), 'Kund utan namn') as customer_name,
  c.email,
  c.source,
  c.status,
  c.is_test_data,
  c.archived_at,
  c.created_at,
  case
    when c.is_test_data then 'markerad_testdata'
    when lower(coalesce(c.source, '')) like '%test%' then 'källa_indikerar_test'
    when lower(coalesce(public.gridex_customer_cleanup_external_ref(c.id), '')) like 'web-test%' then 'extern_id_indikerar_test'
    when lower(coalesce(public.gridex_customer_cleanup_external_ref(c.id), '')) like 'web-incomplete%' then 'ofullständig_webbansökan'
    when lower(coalesce(c.email, '')) like '%example.%' then 'exempeladress'
    when lower(coalesce(c.email, '')) like '%test%' then 'testadress'
    else 'manuell_granskning'
  end as cleanup_reason,
  (select count(*) from public.customer_sites s where s.customer_id = c.id) as site_count,
  (select count(*) from public.customer_contracts cc where cc.customer_id = c.id) as contract_count,
  (select count(*) from public.customer_contracts cc where cc.customer_id = c.id and coalesce(cc.status, '') in ('active','signed','confirmed','switch_requested')) as protected_contract_count,
  (select count(*) from public.supplier_switch_requests ssr where ssr.customer_id = c.id) as switch_count,
  (select count(*) from public.billing_underlays bu where bu.customer_id = c.id) as billing_underlay_count,
  (select count(*) from public.customer_invoices ci where ci.customer_id = c.id) as invoice_count,
  (select count(*) from public.ediel_messages em where em.customer_id = c.id) as ediel_message_count,
  (
    (select count(*) from public.customer_contracts cc where cc.customer_id = c.id and coalesce(cc.status, '') in ('active','signed','confirmed','switch_requested')) = 0
    and (select count(*) from public.supplier_switch_requests ssr where ssr.customer_id = c.id) = 0
    and (select count(*) from public.billing_underlays bu where bu.customer_id = c.id) = 0
    and (select count(*) from public.customer_invoices ci where ci.customer_id = c.id) = 0
    and (select count(*) from public.ediel_messages em where em.customer_id = c.id) = 0
  ) as can_hard_delete
from public.customers c;

comment on table public.platform_usage_events is 'Tenant-scoped usage/action events used for SaaS statistics and future platform billing. Audit_logs remains the legal/revision log.';
comment on view public.gridex_data_cleanup_customer_candidates_v is 'Platform-admin read model for previewing test customers and safe archive/delete decisions.';
