-- Complete shared Ediel mailbox, optional subaddress routing and transport
-- security metadata for the production operations platform.
-- All changes are additive and idempotent.

create extension if not exists pgcrypto;

alter table if exists public.ediel_route_profiles
  add column if not exists sender_subaddress text,
  add column if not exists receiver_subaddress text,
  add column if not exists receiver_message_subaddress text,
  add column if not exists subaddress_required boolean not null default false,
  add column if not exists business_code text,
  add column if not exists transport_mode text not null default 'smtp_imap',
  add column if not exists smtp_from text,
  add column if not exists smtp_to text,
  add column if not exists signing_mode text not null default 'none',
  add column if not exists tls_required boolean not null default true,
  add column if not exists certificate_id uuid,
  add column if not exists allow_unencrypted_test boolean not null default true,
  add column if not exists allow_unencrypted_production boolean not null default false,
  add column if not exists allow_unencrypted_production_expires_at timestamptz,
  add column if not exists allow_unencrypted_production_granted_by uuid,
  add column if not exists allow_unencrypted_production_reason text,
  add column if not exists security_policy_status text not null default 'not_checked';

update public.ediel_route_profiles
   set sender_subaddress = coalesce(nullif(sender_subaddress, ''), nullif(sender_sub_address, ''))
 where sender_sub_address is not null
   and coalesce(sender_subaddress, '') = '';

update public.ediel_route_profiles
   set receiver_subaddress = coalesce(nullif(receiver_subaddress, ''), nullif(receiver_sub_address, ''))
 where receiver_sub_address is not null
   and coalesce(receiver_subaddress, '') = '';

do $$
begin
  if to_regclass('public.ediel_certificates') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'ediel_route_profiles_certificate_id_fkey'
     ) then
    alter table public.ediel_route_profiles
      add constraint ediel_route_profiles_certificate_id_fkey
      foreign key (certificate_id) references public.ediel_certificates(id) on delete set null;
  end if;
end $$;

alter table if exists public.ediel_actor_settings
  add column if not exists subaddress_required boolean not null default false,
  add column if not exists receiver_message_subaddress text;

alter table if exists public.ediel_mailboxes
  add column if not exists mailbox_type text not null default 'shared',
  add column if not exists transport_mode text not null default 'smtp_imap',
  add column if not exists tls_required boolean not null default true,
  add column if not exists smtp_from text,
  add column if not exists smtp_to text,
  add column if not exists signing_mode text not null default 'none',
  add column if not exists encryption_mode text not null default 'none',
  add column if not exists certificate_id uuid,
  add column if not exists security_status text not null default 'not_checked';

do $$
begin
  if to_regclass('public.ediel_certificates') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'ediel_mailboxes_certificate_id_fkey'
     ) then
    alter table public.ediel_mailboxes
      add constraint ediel_mailboxes_certificate_id_fkey
      foreign key (certificate_id) references public.ediel_certificates(id) on delete set null;
  end if;
end $$;

insert into public.ediel_mailboxes (
  company_id,
  mailbox_name,
  email_address,
  environment,
  is_active,
  poll_interval_minutes,
  mailbox_type,
  transport_mode,
  tls_required,
  metadata,
  created_at,
  updated_at
)
select
  null,
  'Gridex shared Ediel mailbox (' || env.environment || ')',
  'ediel@gridex.se',
  env.environment,
  true,
  5,
  'platform_shared',
  'smtp_imap',
  true,
  jsonb_build_object(
    'scope', 'platform_shared',
    'shared_transport_only', true,
    'tenant_resolution', 'edifact_route_keys',
    'gridex_is_ediel_agent', false
  ),
  now(),
  now()
from (values ('test'), ('production')) as env(environment)
where to_regclass('public.ediel_mailboxes') is not null
  and not exists (
    select 1
    from public.ediel_mailboxes existing
    where existing.company_id is null
      and lower(existing.email_address) = 'ediel@gridex.se'
      and existing.environment = env.environment
  );

alter table if exists public.ediel_certificates
  add column if not exists scope text not null default 'platform_shared',
  add column if not exists environment text not null default 'test',
  add column if not exists certificate_type text not null default 'smime',
  add column if not exists display_name text,
  add column if not exists subject text,
  add column if not exists issuer text,
  add column if not exists serial_number text,
  add column if not exists fingerprint_sha256 text,
  add column if not exists public_certificate_pem text,
  add column if not exists p12_secret_reference text,
  add column if not exists private_key_secret_reference text,
  add column if not exists p12_alias text,
  add column if not exists valid_from timestamptz,
  add column if not exists valid_to timestamptz,
  add column if not exists renewal_window_days integer not null default 60,
  add column if not exists warning_days_before_expiry integer not null default 45,
  add column if not exists critical_days_before_expiry integer not null default 14;

update public.ediel_certificates
   set fingerprint_sha256 = coalesce(nullif(fingerprint_sha256, ''), certificate_fingerprint),
       valid_from = coalesce(valid_from, certificate_valid_from),
       valid_to = coalesce(valid_to, certificate_valid_to),
       p12_secret_reference = coalesce(nullif(p12_secret_reference, ''), secret_reference),
       display_name = coalesce(display_name, certificate_fingerprint)
 where to_regclass('public.ediel_certificates') is not null;

create table if not exists public.ediel_certificate_events (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid null references public.ediel_certificates(id) on delete cascade,
  company_id uuid null,
  event_type text not null,
  message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now()
);

alter table if exists public.ediel_message_payloads
  add column if not exists signing_mode text not null default 'none',
  add column if not exists security_status text not null default 'stored',
  add column if not exists certificate_id uuid,
  add column if not exists certificate_fingerprint_sha256 text,
  add column if not exists encrypted_payload_ref text,
  add column if not exists decrypted_payload_ref text,
  add column if not exists smime_verified_at timestamptz,
  add column if not exists smime_validation_error text;

alter table if exists public.ediel_test_runs
  add column if not exists actor_role text,
  add column if not exists message_family text,
  add column if not exists business_code text,
  add column if not exists encryption_mode text not null default 'none',
  add column if not exists certificate_id uuid,
  add column if not exists certificate_fingerprint_sha256 text,
  add column if not exists route_profile_id uuid,
  add column if not exists expected_flow jsonb not null default '[]'::jsonb,
  add column if not exists actual_flow jsonb not null default '[]'::jsonb,
  add column if not exists raw_edifact text,
  add column if not exists encrypted_payload_ref text,
  add column if not exists production_like boolean not null default false;

do $$
begin
  if to_regclass('public.ediel_certificates') is not null
     and to_regclass('public.ediel_test_runs') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'ediel_test_runs_certificate_id_fkey'
     ) then
    alter table public.ediel_test_runs
      add constraint ediel_test_runs_certificate_id_fkey
      foreign key (certificate_id) references public.ediel_certificates(id) on delete set null;
  end if;

  if to_regclass('public.ediel_route_profiles') is not null
     and to_regclass('public.ediel_test_runs') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'ediel_test_runs_route_profile_id_fkey'
     ) then
    alter table public.ediel_test_runs
      add constraint ediel_test_runs_route_profile_id_fkey
      foreign key (route_profile_id) references public.ediel_route_profiles(id) on delete set null;
  end if;
end $$;

create index if not exists ediel_route_profiles_subaddress_required_idx
  on public.ediel_route_profiles(company_id, environment, subaddress_required)
  where subaddress_required = true;

create index if not exists ediel_route_profiles_message_route_idx
  on public.ediel_route_profiles(company_id, environment, message_family, message_code, application_reference)
  where coalesce(is_active, true) = true and coalesce(is_enabled, true) = true;

create index if not exists ediel_certificates_scope_environment_idx
  on public.ediel_certificates(scope, environment, status);

create index if not exists ediel_test_runs_security_idx
  on public.ediel_test_runs(company_id, environment, encryption_mode, test_case_code);

do $$
declare
  t text;
  select_policy text;
  insert_policy text;
  update_policy text;
begin
  foreach t in array array[
    'ediel_certificate_events',
    'ediel_test_runs'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);

      select_policy := t || '_tenant_select';
      insert_policy := t || '_tenant_insert';
      update_policy := t || '_tenant_update';

      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = t and policyname = select_policy
      ) then
        execute format(
          'create policy %I on public.%I for select using (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_read_company(company_id)))',
          select_policy,
          t
        );
      end if;

      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = t and policyname = insert_policy
      ) then
        execute format(
          'create policy %I on public.%I for insert with check (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_write_company(company_id)))',
          insert_policy,
          t
        );
      end if;

      if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = t and policyname = update_policy
      ) then
        execute format(
          'create policy %I on public.%I for update using (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_read_company(company_id))) with check (public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_write_company(company_id)))',
          update_policy,
          t
        );
      end if;
    end if;
  end loop;
end $$;
