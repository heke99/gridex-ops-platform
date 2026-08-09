-- GRIDEX-AUD-003 derived bootstrap: restore the historical Ediel certificate registry.
-- Source: supabase/migrations/20260602090000_ediel_operations_platform_core.sql
-- The source migration is immutable and checksum-pinned in scripts/migration-history-manifest.json.
-- Keep this artifact limited to ediel_certificates and its original RLS enablement; later
-- certificate hardening migrations remain responsible for recipient/transport constraints.

create table if not exists public.ediel_certificates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  certificate_fingerprint text not null,
  certificate_valid_from timestamptz null,
  certificate_valid_to timestamptz null,
  secret_reference text not null,
  encryption_status text not null default 'unknown',
  last_validation_at timestamptz null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ediel_certificates enable row level security;
