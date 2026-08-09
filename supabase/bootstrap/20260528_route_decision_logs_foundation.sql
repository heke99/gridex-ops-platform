-- GRIDEX-AUD-003 derived bootstrap artifact.
-- Source evidence: supabase/migrations/20260528_batch_7a_route_inbound_mail_platform_ui.sql
-- Purpose: restore only the source-defined route_decision_logs relation and
-- indexes required before canonical Ediel actor identity creates routing
-- decision foreign keys. The immutable source migration remains checksum-pinned.

create table if not exists public.route_decision_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  grid_owner_id uuid,
  business_process text,
  requested_action text,
  message_family text,
  message_code text,
  environment text not null default 'test',
  decision_status text not null default 'manual_review',
  route_scope text,
  communication_route_id uuid,
  ediel_route_profile_id uuid,
  grid_owner_access_agreement_id uuid,
  application_reference text,
  message_version text,
  sender_ediel_id text,
  sender_sub_address text,
  receiver_ediel_id text,
  receiver_sub_address text,
  ack_policy jsonb not null default '{}'::jsonb,
  blocking_reasons jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  required_admin_actions jsonb not null default '[]'::jsonb,
  decision_trace jsonb not null default '[]'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_route_decision_logs_company_created
  on public.route_decision_logs(company_id, created_at desc);

create index if not exists idx_route_decision_logs_route_scope
  on public.route_decision_logs(company_id, route_scope, decision_status, created_at desc);
