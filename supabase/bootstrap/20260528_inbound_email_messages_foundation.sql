-- GRIDEX-AUD-003 derived bootstrap artifact.
-- Source evidence: supabase/migrations/20260528_batch_7a_route_inbound_mail_platform_ui.sql
-- Purpose: create only inbound_email_messages before batch 3.sql on an empty
-- database. Batch 1+2 already provides ediel_mailboxes.
-- The immutable source migration remains checksum-pinned.

create table if not exists public.inbound_email_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  mailbox_id uuid references public.ediel_mailboxes(id) on delete set null,
  internet_message_id text,
  from_address text,
  to_address text,
  subject text,
  received_at timestamptz,
  raw_email_path text,
  raw_email text,
  raw_edifact_payload text,
  body_text text,
  body_html text,
  has_attachments boolean not null default false,
  processing_status text not null default 'received',
  dedupe_key text,
  match_status text not null default 'not_checked',
  match_payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_inbound_email_messages_mailbox_message
  on public.inbound_email_messages(mailbox_id, internet_message_id)
  where mailbox_id is not null and internet_message_id is not null;

create index if not exists idx_inbound_email_messages_company_status
  on public.inbound_email_messages(company_id, processing_status, created_at desc);
