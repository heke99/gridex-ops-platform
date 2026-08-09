-- AUD-003 deterministic bootstrap.
-- Source: supabase/migrations/20260612193000_platform_tenant_contracts_api_mail.sql
-- Restores only the integration API client lifecycle columns required by later
-- runtime capability and duplicate-primary checks. No clients are seeded.

alter table if exists public.integration_api_clients
  add column if not exists permission_groups text[] not null default '{}'::text[],
  add column if not exists purpose_label text,
  add column if not exists deleted_at timestamptz;
