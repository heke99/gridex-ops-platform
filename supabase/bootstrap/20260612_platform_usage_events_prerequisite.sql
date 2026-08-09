-- GRIDEX-AUD-003 chronological prerequisite artifact.
-- Source evidence: supabase/migrations/20260612193000_ops_j_to_n_governance_audit_cleanup_docs_v2.sql
-- Purpose: pre-create only platform_usage_events before the earlier tracked
-- 20260612160000 read-model migration that references it.
-- preserveSourceReplay=true keeps the full 20260612193000 migration in normal replay.
-- No usage events or tenant/customer data are seeded.

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
