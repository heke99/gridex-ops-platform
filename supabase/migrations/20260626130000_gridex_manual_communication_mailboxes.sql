-- Gridex manual communication mailboxes (separate from the Ediel transport mailbox).
--
-- Strictly additive, idempotent, RLS-safe. No DROP of business tables, no
-- destructive DELETE, no data rewrites.
--
-- PURPOSE / CONCEPT SEPARATION (do not mix):
--   * manual_communication_mailboxes = Gridex SENDER/REPLY + inbound IMAP mailbox
--     used for MANUAL (non-Ediel) grid-owner communication: supplier switch,
--     power of attorney, facility information requests, AI-list, escalation.
--   * grid_owner_contact_channels    = RECIPIENT addresses per grid owner.
--   * ediel_mailboxes                = Ediel/EDIFACT transport ONLY (ediel@gridex.se).
--
-- ediel@gridex.se MUST stay dedicated to Ediel/EDIFACT (PRODAT/UTILTS/CONTRL/
-- APERAK + Ediel IMAP/SMTP). Manual e-mail MUST NOT be sent from it.
--
-- This table mirrors the ediel_mailboxes safety patterns: env-only secret
-- references (no plaintext passwords), platform-only RLS (credentials are never
-- tenant-readable), and poll/lock columns for the inbound IMAP worker.

-- ---------------------------------------------------------------------------
-- 1) Table
-- ---------------------------------------------------------------------------
create table if not exists public.manual_communication_mailboxes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  mailbox_name text not null,
  mailbox_type text not null default 'general_manual_operations' check (mailbox_type in (
    'manual_supplier_switch','power_of_attorney','facility_information_request',
    'ai_list','escalation','general_manual_operations'
  )),
  environment text not null default 'test' check (environment in ('test','production')),
  from_email text,
  reply_to_email text,
  smtp_host text,
  smtp_port integer default 465,
  smtp_username text,
  smtp_secret_reference text,
  smtp_secure boolean not null default true,
  imap_host text,
  imap_port integer default 993,
  imap_username text,
  imap_secret_reference text,
  imap_folder text default 'INBOX',
  imap_secure boolean not null default true,
  is_active boolean not null default true,
  is_verified boolean not null default false,
  poll_interval_minutes integer not null default 5,
  last_polled_at timestamptz,
  last_successful_poll_at timestamptz,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Never store plaintext passwords; only env: references (same rule as Ediel).
  constraint manual_communication_mailboxes_no_plaintext_smtp_secret_check check (
    smtp_secret_reference is null
    or smtp_secret_reference !~* '^(pass|password|pwd)=|://[^/]*:[^/@]+@'
  ),
  constraint manual_communication_mailboxes_no_plaintext_imap_secret_check check (
    imap_secret_reference is null
    or imap_secret_reference !~* '^(pass|password|pwd)=|://[^/]*:[^/@]+@'
  )
);

comment on table public.manual_communication_mailboxes is
  'Configurable Gridex SENDER/REPLY + inbound IMAP mailbox for MANUAL (non-Ediel) grid-owner communication. Separate from ediel_mailboxes (Ediel/EDIFACT only) and from grid_owner_contact_channels (grid owner recipients).';
comment on column public.manual_communication_mailboxes.company_id is
  'Null = platform default mailbox. Non-null = tenant override sender (only used when tenant-specific sender is supported).';
comment on column public.manual_communication_mailboxes.smtp_secret_reference is
  'Reference to env/secret value, e.g. env:MANUAL_OPS_SMTP_PASS. Never store passwords directly.';
comment on column public.manual_communication_mailboxes.imap_secret_reference is
  'Reference to env/secret value, e.g. env:MANUAL_OPS_IMAP_PASS. Never store passwords directly.';

-- ---------------------------------------------------------------------------
-- 2) Indexes (platform default per type+env when company_id null; tenant override otherwise)
-- ---------------------------------------------------------------------------
create index if not exists manual_communication_mailboxes_active_idx
  on public.manual_communication_mailboxes (environment, mailbox_type, is_active);
create index if not exists manual_communication_mailboxes_company_idx
  on public.manual_communication_mailboxes (company_id, environment, mailbox_type, is_active);
create unique index if not exists manual_communication_mailboxes_default_uidx
  on public.manual_communication_mailboxes (environment, mailbox_type)
  where company_id is null;
create unique index if not exists manual_communication_mailboxes_override_uidx
  on public.manual_communication_mailboxes (company_id, environment, mailbox_type)
  where company_id is not null;

-- ---------------------------------------------------------------------------
-- 3) RLS — platform-only (credentials must never be tenant-readable)
-- ---------------------------------------------------------------------------
alter table public.manual_communication_mailboxes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'manual_communication_mailboxes' and policyname = 'manual_communication_mailboxes_platform_read') then
    create policy manual_communication_mailboxes_platform_read on public.manual_communication_mailboxes for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'manual_communication_mailboxes' and policyname = 'manual_communication_mailboxes_platform_write') then
    create policy manual_communication_mailboxes_platform_write on public.manual_communication_mailboxes for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Seed default platform manual mailbox (editable in superadmin UI).
--    Preferred default address is leverantorsbyte@gridex.se, but it is NOT
--    hardcoded as the only option: superadmin can edit/add mailboxes in UI.
--    Idempotent: only seeds when no platform default exists for the env+type.
-- ---------------------------------------------------------------------------
insert into public.manual_communication_mailboxes (
  company_id, mailbox_name, mailbox_type, environment,
  from_email, reply_to_email,
  imap_host, imap_port, imap_username, imap_secret_reference, imap_folder, imap_secure,
  smtp_host, smtp_port, smtp_username, smtp_secret_reference, smtp_secure,
  is_active, is_verified, metadata
)
select
  null,
  'Gridex manuell operationsbrevlåda (' || env.environment || ')',
  'general_manual_operations',
  env.environment,
  'leverantorsbyte@gridex.se',
  'leverantorsbyte@gridex.se',
  'imap.strato.de', 993, 'leverantorsbyte@gridex.se', 'env:MANUAL_OPS_IMAP_PASS', 'INBOX', true,
  'smtp.strato.de', 465, 'leverantorsbyte@gridex.se', 'env:MANUAL_OPS_SMTP_PASS', true,
  true, false, jsonb_build_object('scope', 'platform_default', 'managedFrom', 'admin/manual-mailboxes', 'seeded', true)
from (values ('test'), ('production')) as env(environment)
where not exists (
  select 1 from public.manual_communication_mailboxes m
  where m.company_id is null
    and m.environment = env.environment
    and m.mailbox_type = 'general_manual_operations'
);

-- ---------------------------------------------------------------------------
-- 5) Widen grid_owner_information_requests with the distinct manual-mailbox
--    blocked state (preserve every existing allowed value).
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.grid_owner_information_requests') is not null then
    alter table public.grid_owner_information_requests drop constraint if exists grid_owner_information_requests_status_check;
    alter table public.grid_owner_information_requests
      add constraint grid_owner_information_requests_status_check check (status in (
        'draft','ready_to_send','sent','waiting_response','received','completed','failed','needs_review',
        'facility_data_invalid','customer_information_mismatch','grid_owner_rejected_request','negative_aperak_received',
        'z02_rejected','needs_customer_correction','needs_grid_owner_followup','timeout','retry_blocked',
        'blocked_missing_poa','blocked_missing_grid_owner_contact','blocked_missing_manual_mailbox','ready_to_send_manual_email',
        'manual_email_queued','manual_email_sent','waiting_manual_response','manual_response_received',
        'manual_response_parsed','cancelled'
      ));

    -- Keep the open-request uniqueness covering the new blocked state so repeated
    -- clicks reuse the open request (idempotency).
    drop index if exists public.grid_owner_information_requests_open_uidx;
    create unique index if not exists grid_owner_information_requests_open_uidx
      on public.grid_owner_information_requests (company_id, customer_site_id, request_type)
      where status in (
        'draft','ready_to_send','sent','waiting_response','needs_review',
        'blocked_missing_poa','blocked_missing_grid_owner_contact','blocked_missing_manual_mailbox','ready_to_send_manual_email',
        'manual_email_queued','manual_email_sent','waiting_manual_response','manual_response_received'
      );
  end if;
end $$;
