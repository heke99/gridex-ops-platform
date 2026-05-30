-- Batch 1+2 — platform company actor configuration and shared Ediel mailbox foundation.
-- Idempotent and additive. Mailboxes remain transport channels; company routing must use EDIFACT actor identifiers.

begin;

create extension if not exists pgcrypto;

alter table if exists public.companies
  add column if not exists contact_person jsonb not null default '{}'::jsonb,
  add column if not exists technical_contact jsonb not null default '{}'::jsonb,
  add column if not exists operations_contact jsonb not null default '{}'::jsonb,
  add column if not exists billing_contact jsonb not null default '{}'::jsonb,
  add column if not exists test_readiness_status text,
  add column if not exists production_readiness_status text,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.ediel_actor_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  actor_name text,
  actor_ediel_id text,
  ediel_id text,
  actor_role text not null default 'supplier',
  role text,
  environment text not null default 'test',
  sender_sub_address text,
  sender_subaddress text,
  receiver_sub_address text,
  receiver_subaddress text,
  default_application_reference text,
  application_reference text,
  is_active boolean not null default true,
  valid_from date,
  valid_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

alter table if exists public.ediel_actor_settings
  add column if not exists ediel_id text,
  add column if not exists role text,
  add column if not exists sender_subaddress text,
  add column if not exists receiver_subaddress text,
  add column if not exists receiver_sub_address text,
  add column if not exists application_reference text,
  add column if not exists valid_from date,
  add column if not exists valid_to date,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid;

update public.ediel_actor_settings
set ediel_id = coalesce(ediel_id, actor_ediel_id),
    role = coalesce(role, actor_role),
    sender_subaddress = coalesce(sender_subaddress, sender_sub_address),
    receiver_subaddress = coalesce(receiver_subaddress, receiver_sub_address),
    application_reference = coalesce(application_reference, default_application_reference)
where to_regclass('public.ediel_actor_settings') is not null;

create table if not exists public.ediel_brp_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null default 'test',
  brp_ediel_id text not null,
  brp_name text not null,
  brp_email text,
  brp_phone text,
  contact_person text,
  is_default boolean not null default false,
  valid_from date,
  valid_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.ediel_route_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  environment text not null default 'test',
  route_name text,
  route_type text not null default 'email',
  sender_ediel_id text,
  sender_sub_address text,
  sender_subaddress text,
  receiver_ediel_id text,
  receiver_sub_address text,
  receiver_subaddress text,
  mailbox_id uuid,
  smtp_profile_id uuid,
  default_message_version text,
  ack_mode text not null default 'default',
  is_active boolean not null default true,
  is_enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.ediel_route_profiles
  add column if not exists route_name text,
  add column if not exists route_type text not null default 'email',
  add column if not exists sender_subaddress text,
  add column if not exists receiver_subaddress text,
  add column if not exists mailbox_id uuid,
  add column if not exists smtp_profile_id uuid,
  add column if not exists is_active boolean,
  add column if not exists is_enabled boolean,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

update public.ediel_route_profiles
set sender_subaddress = coalesce(sender_subaddress, sender_sub_address),
    receiver_subaddress = coalesce(receiver_subaddress, receiver_sub_address),
    is_active = coalesce(is_active, is_enabled, true)
where to_regclass('public.ediel_route_profiles') is not null;

create table if not exists public.ediel_mailboxes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  environment text not null default 'test',
  mailbox_name text not null,
  email_address text,
  imap_host text,
  imap_port integer not null default 993,
  username text,
  secret_reference text,
  is_active boolean not null default true,
  poll_interval_minutes integer not null default 5,
  last_polled_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.ediel_mailboxes
  add column if not exists secret_reference text,
  add column if not exists poll_interval_minutes integer not null default 5,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.ediel_counterparties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null default 'test',
  counterparty_name text not null,
  counterparty_ediel_id text not null,
  counterparty_role text not null default 'grid_owner',
  email text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.ediel_message_rules
  add column if not exists prodat_version text,
  add column if not exists utilts_version text,
  add column if not exists aperak_version text,
  add column if not exists contrl_version text,
  add column if not exists accepted_inbound_versions jsonb not null default '[]'::jsonb,
  add column if not exists default_outbound_version text,
  add column if not exists ack_policy jsonb not null default '{}'::jsonb,
  add column if not exists ack_deadline_minutes integer,
  add column if not exists automatic_processing_enabled boolean not null default true;

alter table if exists public.ediel_unresolved_items
  add column if not exists environment text,
  add column if not exists inbound_email_message_id uuid,
  add column if not exists ediel_message_id uuid,
  add column if not exists reason text,
  add column if not exists resolution_status text,
  add column if not exists candidate_company_ids uuid[] not null default '{}'::uuid[],
  add column if not exists parsed_sender_ediel_id text,
  add column if not exists parsed_receiver_ediel_id text,
  add column if not exists parsed_subaddress text,
  add column if not exists message_family text,
  add column if not exists message_code text,
  add column if not exists raw_payload text;

update public.ediel_unresolved_items
set resolution_status = coalesce(resolution_status, status),
    reason = coalesce(reason, issue_type)
where to_regclass('public.ediel_unresolved_items') is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ediel_actor_settings_environment_check'
  ) then
    alter table public.ediel_actor_settings
      add constraint ediel_actor_settings_environment_check check (environment in ('test', 'production'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ediel_brp_settings_environment_check'
  ) then
    alter table public.ediel_brp_settings
      add constraint ediel_brp_settings_environment_check check (environment in ('test', 'production'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ediel_mailboxes_secret_reference_check'
  ) then
    alter table public.ediel_mailboxes
      add constraint ediel_mailboxes_secret_reference_check check (secret_reference is null or secret_reference !~* '^(pass|password|pwd)=|://[^/]*:[^/@]+@');
  end if;
end $$;

create index if not exists idx_ediel_actor_settings_actor_resolution
  on public.ediel_actor_settings(environment, ediel_id, receiver_subaddress, application_reference, company_id)
  where coalesce(is_active, true) = true;

create index if not exists idx_ediel_brp_settings_company_env
  on public.ediel_brp_settings(company_id, environment, is_default, valid_from, valid_to);

create index if not exists idx_ediel_route_profiles_shared_resolution
  on public.ediel_route_profiles(environment, receiver_ediel_id, receiver_subaddress, application_reference, company_id)
  where coalesce(is_active, is_enabled, true) = true;

create index if not exists idx_ediel_mailboxes_shared_due
  on public.ediel_mailboxes(environment, is_active, last_polled_at, locked_at)
  where coalesce(metadata->>'scope', '') = 'platform_shared';

create index if not exists idx_ediel_counterparties_company_actor
  on public.ediel_counterparties(company_id, environment, counterparty_ediel_id, counterparty_role)
  where is_active = true;

do $$
begin
  if not exists (
    select 1
    from public.ediel_actor_settings
    where coalesce(is_active, true) = true
      and ediel_id is not null
    group by environment, ediel_id, actor_role, coalesce(receiver_subaddress, '')
    having count(distinct company_id) > 1
  ) then
    create unique index if not exists ux_ediel_actor_settings_active_actor
      on public.ediel_actor_settings(environment, ediel_id, actor_role, coalesce(receiver_subaddress, ''))
      where coalesce(is_active, true) = true and ediel_id is not null;
  end if;

  if not exists (
    select 1
    from public.ediel_brp_settings
    where is_default = true
    group by company_id, environment
    having count(*) > 1
  ) then
    create unique index if not exists ux_ediel_brp_settings_one_default
      on public.ediel_brp_settings(company_id, environment)
      where is_default = true;
  end if;
end $$;

comment on column public.ediel_mailboxes.secret_reference is 'Reference to env/secret manager value, for example env:GRIDEX_SHARED_EDIEL_IMAP_PASS. Do not store passwords directly.';
comment on column public.ediel_mailboxes.company_id is 'Null means platform shared transport mailbox. Tenant routing must be resolved from EDIFACT actor identifiers.';

commit;
