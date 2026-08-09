-- GRIDEX-AUD-003 derived bootstrap artifact.
-- Source evidence: supabase/migrations/20260520_batch_3_4_onboarding_pricing_billing_engine.sql
-- Purpose: restore only the source-defined pricing_component_rules relation and base indexes
-- required by the later canonical Capway/invoice foundation on an empty database.
-- No pricing rules or tenant/product data are seeded.
-- The immutable source migration remains checksum-pinned by migration-history-manifest.json.

create table if not exists public.pricing_component_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contract_offer_id uuid null references public.contract_offers(id) on delete cascade,
  component_code text not null,
  component_label text not null,
  component_type text not null,
  calculation_unit text not null default 'ore_per_kwh',
  value_amount numeric null,
  currency text not null default 'SEK',
  applies_to text not null default 'contract',
  valid_from date null,
  valid_to date null,
  priority integer not null default 100,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pricing_component_rules_company_code_offer_uidx
  on public.pricing_component_rules(company_id, component_code, coalesce(contract_offer_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists pricing_component_rules_company_active_idx
  on public.pricing_component_rules(company_id, is_active, priority);

create index if not exists pricing_component_rules_offer_idx
  on public.pricing_component_rules(company_id, contract_offer_id);
