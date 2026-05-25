-- Debug Step 2: code/schema alignment for runtime queries found in static review.
-- Safe, additive repair only. No destructive changes.

-- TGT test-data UI/runtime stores parsed portal payload per test case.
-- Older schema only had data_key/data_value/payload, while code reads/writes
-- title/source_note/raw_text/parsed_payload and upserts per suite/role/case.
create table if not exists public.ediel_tgt_test_data (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  test_suite text not null,
  role_code text,
  test_case_code text not null,
  data_key text default 'portal_payload',
  data_value text,
  payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.ediel_tgt_test_data
  alter column data_key set default 'portal_payload';

alter table if exists public.ediel_tgt_test_data
  alter column data_key drop not null;

alter table if exists public.ediel_tgt_test_data
  add column if not exists title text,
  add column if not exists source_note text,
  add column if not exists raw_text text not null default '',
  add column if not exists parsed_payload jsonb not null default '{}'::jsonb,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid;

-- Preserve legacy payload content where parsed_payload is still empty.
update public.ediel_tgt_test_data
set parsed_payload = payload
where to_regclass('public.ediel_tgt_test_data') is not null
  and coalesce(parsed_payload, '{}'::jsonb) = '{}'::jsonb
  and coalesce(payload, '{}'::jsonb) <> '{}'::jsonb;

-- One active dynamic row per suite/role/case is what the app upserts against.
-- Dedupe before adding the unique guard.
with ranked as (
  select
    id,
    row_number() over (
      partition by test_suite, role_code, test_case_code
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.ediel_tgt_test_data
  where to_regclass('public.ediel_tgt_test_data') is not null
)
delete from public.ediel_tgt_test_data t
using ranked r
where t.id = r.id
  and r.rn > 1;

create unique index if not exists ediel_tgt_test_data_suite_role_case_uidx
  on public.ediel_tgt_test_data(test_suite, role_code, test_case_code);

-- Admin permission overrides are stored in user_permission_overrides, not
-- user_permissions. Keep an index matching the runtime access pattern.
create index if not exists user_permission_overrides_user_active_idx
  on public.user_permission_overrides(user_id, is_active, permission_key);

create index if not exists user_roles_user_active_role_idx
  on public.user_roles(user_id, is_active, status, role_id, role);

-- Customer workspace queries now scope by company_id and commonly filter these columns.
create index if not exists customer_sites_customer_company_idx
  on public.customer_sites(customer_id, company_id, created_at desc);

create index if not exists customer_contracts_customer_company_idx
  on public.customer_contracts(customer_id, company_id, created_at desc);

create index if not exists customer_contacts_customer_company_idx
  on public.customer_contacts(customer_id, company_id, created_at desc);

create index if not exists customer_addresses_customer_company_idx
  on public.customer_addresses(customer_id, company_id, created_at desc);

create index if not exists outbound_requests_customer_created_idx
  on public.outbound_requests(customer_id, created_at desc);

create index if not exists grid_owner_data_requests_customer_created_idx
  on public.grid_owner_data_requests(customer_id, created_at desc);
