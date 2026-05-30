-- Company invitation + temporary password + auth sync hardening.
-- Hardened/idempotent migration for existing Gridex installations.
-- This version normalizes old auth_email_events.status values before adding CHECK constraints.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- User lifecycle sync used by temporary-password login and admin/company settings.
-- -----------------------------------------------------------------------------
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text null,
  full_name text null,
  phone text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.user_profiles
  add column if not exists email text,
  add column if not exists full_name text,
  add column if not exists phone text,
  add column if not exists user_status text default 'active',
  add column if not exists auth_email_confirmed_at timestamptz,
  add column if not exists last_invite_sent_at timestamptz,
  add column if not exists last_password_reset_sent_at timestamptz,
  add column if not exists last_confirmation_email_sent_at timestamptz,
  add column if not exists last_auth_email_action text,
  add column if not exists last_auth_email_action_at timestamptz,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists temporary_password_set_at timestamptz,
  add column if not exists temporary_password_expires_at timestamptz,
  add column if not exists password_changed_at timestamptz,
  add column if not exists updated_at timestamptz default now();

alter table if exists public.user_profiles
  drop constraint if exists user_profiles_user_status_check;

update public.user_profiles
set user_status = 'active'
where user_status is null or btrim(user_status) = '';

update public.user_profiles
set user_status = 'disabled'
where lower(btrim(user_status)) in ('inactive', 'blocked', 'banned', 'suspended');

update public.user_profiles
set user_status = 'active'
where user_status not in ('active', 'disabled', 'removed_from_company', 'invitation_revoked', 'locked_security');

alter table if exists public.user_profiles
  add constraint user_profiles_user_status_check
  check (user_status in ('active', 'disabled', 'removed_from_company', 'invitation_revoked', 'locked_security'));

create index if not exists user_profiles_must_change_password_idx
  on public.user_profiles(must_change_password, temporary_password_expires_at);

-- -----------------------------------------------------------------------------
-- Company membership/invitation lifecycle. Patch older tables before constraints.
-- -----------------------------------------------------------------------------
create table if not exists public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  user_id uuid null,
  membership_role text not null default 'member',
  status text not null default 'active',
  invited_email text null,
  invited_by uuid null,
  invited_at timestamptz null,
  accepted_at timestamptz null,
  disabled_at timestamptz null,
  disabled_by uuid null,
  removed_at timestamptz null,
  removed_by uuid null,
  status_reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.company_memberships
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists company_id uuid,
  add column if not exists user_id uuid,
  add column if not exists membership_role text default 'member',
  add column if not exists status text default 'active',
  add column if not exists invited_email text,
  add column if not exists invited_by uuid,
  add column if not exists invited_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by uuid,
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid,
  add column if not exists status_reason text,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.company_memberships
  drop constraint if exists company_memberships_status_check;

update public.company_memberships
set status = 'active'
where status is null or btrim(status) = '';

update public.company_memberships
set status = 'removed'
where lower(btrim(status)) in ('deleted', 'delete', 'removed_from_tenant');

update public.company_memberships
set status = 'disabled'
where lower(btrim(status)) in ('inactive', 'blocked', 'banned');

update public.company_memberships
set status = 'active'
where status not in ('active', 'pending', 'invited', 'suspended', 'revoked', 'removed', 'disabled', 'removed_from_company', 'invitation_revoked', 'locked_security');

alter table if exists public.company_memberships
  add constraint company_memberships_status_check
  check (status in ('active', 'pending', 'invited', 'suspended', 'revoked', 'removed', 'disabled', 'removed_from_company', 'invitation_revoked', 'locked_security'));

alter table if exists public.company_memberships
  drop constraint if exists company_memberships_role_check;

update public.company_memberships
set membership_role = 'member'
where membership_role is null or btrim(membership_role) = '';

update public.company_memberships
set membership_role = 'company_admin'
where lower(btrim(membership_role)) in ('company-owner', 'company_owner', 'bolagsansvarig', 'responsible');

update public.company_memberships
set membership_role = 'member'
where membership_role not in ('owner', 'admin', 'company_admin', 'operations', 'support', 'member', 'viewer');

alter table if exists public.company_memberships
  add constraint company_memberships_role_check
  check (membership_role in ('owner', 'admin', 'company_admin', 'operations', 'support', 'member', 'viewer'));

create unique index if not exists company_memberships_company_user_uidx
  on public.company_memberships(company_id, user_id)
  where company_id is not null and user_id is not null;

create index if not exists company_memberships_company_status_idx
  on public.company_memberships(company_id, status);

create table if not exists public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  email text not null,
  full_name text null,
  membership_role text not null default 'member',
  role_key text null,
  status text not null default 'pending',
  invited_by uuid null,
  invited_user_id uuid null,
  accepted_at timestamptz null,
  revoked_at timestamptz null,
  expires_at timestamptz null,
  accept_token_hash text null,
  temporary_password_issued_at timestamptz null,
  temporary_password_expires_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.company_invitations
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists company_id uuid,
  add column if not exists email text,
  add column if not exists full_name text,
  add column if not exists membership_role text default 'member',
  add column if not exists role_key text,
  add column if not exists status text default 'pending',
  add column if not exists invited_by uuid,
  add column if not exists invited_user_id uuid,
  add column if not exists accepted_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists accept_token_hash text,
  add column if not exists temporary_password_issued_at timestamptz,
  add column if not exists temporary_password_expires_at timestamptz,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table if exists public.company_invitations
  drop constraint if exists company_invitations_status_check;

update public.company_invitations
set status = 'pending'
where status is null or btrim(status) = '';

update public.company_invitations
set status = 'revoked'
where lower(btrim(status)) in ('deleted', 'cancelled', 'canceled', 'disabled');

update public.company_invitations
set status = 'pending'
where status not in ('pending', 'accepted', 'revoked', 'expired', 'invitation_revoked');

alter table if exists public.company_invitations
  add constraint company_invitations_status_check
  check (status in ('pending', 'accepted', 'revoked', 'expired', 'invitation_revoked'));

alter table if exists public.company_invitations
  drop constraint if exists company_invitations_membership_role_check;

update public.company_invitations
set membership_role = 'member'
where membership_role is null or btrim(membership_role) = '';

update public.company_invitations
set membership_role = 'company_admin'
where lower(btrim(membership_role)) in ('company-owner', 'company_owner', 'bolagsansvarig', 'responsible');

update public.company_invitations
set membership_role = 'member'
where membership_role not in ('owner', 'admin', 'company_admin', 'operations', 'support', 'member', 'viewer');

alter table if exists public.company_invitations
  add constraint company_invitations_membership_role_check
  check (membership_role in ('owner', 'admin', 'company_admin', 'operations', 'support', 'member', 'viewer'));

create unique index if not exists company_invitations_accept_token_hash_uidx
  on public.company_invitations(accept_token_hash)
  where accept_token_hash is not null;

create index if not exists company_invitations_company_status_idx
  on public.company_invitations(company_id, status, created_at desc);

create index if not exists company_invitations_email_status_idx
  on public.company_invitations(lower(email), status, created_at desc);

-- -----------------------------------------------------------------------------
-- Auth event audit. Keep constraints aligned with app enum values.
-- -----------------------------------------------------------------------------
create table if not exists public.auth_email_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null,
  company_id uuid null,
  actor_user_id uuid null,
  email text null,
  event_type text not null default 'unknown',
  status text not null default 'sent',
  source text not null default 'app',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table if exists public.auth_email_events
  add column if not exists user_id uuid,
  add column if not exists company_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists email text,
  add column if not exists event_type text default 'unknown',
  add column if not exists status text default 'sent',
  add column if not exists source text default 'app',
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now();

alter table if exists public.auth_email_events
  drop constraint if exists auth_email_events_event_type_check;

alter table if exists public.auth_email_events
  drop constraint if exists auth_email_events_status_check;

-- Normalize historical values before constraints are added. This is what prevents 23514.
update public.auth_email_events
set event_type = 'unknown'
where event_type is null or btrim(event_type) = '';

update public.auth_email_events
set event_type = lower(replace(btrim(event_type), '-', '_'));

update public.auth_email_events
set event_type = 'invite_sent'
where event_type in ('invite', 'invited', 'user_invited', 'invitation_sent');

update public.auth_email_events
set event_type = 'password_reset_sent'
where event_type in ('password_reset', 'reset_password', 'recovery', 'recovery_email');

update public.auth_email_events
set event_type = 'confirmation_sent'
where event_type in ('confirm', 'confirmed', 'confirmation', 'email_confirmation');

update public.auth_email_events
set event_type = 'unknown'
where event_type not in (
  'unknown',
  'invite_sent',
  'password_reset_sent',
  'confirmation_sent',
  'email_action_verified',
  'password_updated',
  'company_invitation_accepted',
  'direct_user_created',
  'company_invite_sent',
  'company_invitation_sent',
  'reset_password_sent',
  'recovery_sent',
  'signup_confirmation_sent',
  'magic_link_sent',
  'email_change_sent',
  'reauthentication_sent'
);

alter table if exists public.auth_email_events
  add constraint auth_email_events_event_type_check
  check (event_type in (
    'unknown',
    'invite_sent',
    'password_reset_sent',
    'confirmation_sent',
    'email_action_verified',
    'password_updated',
    'company_invitation_accepted',
    'direct_user_created',
    'company_invite_sent',
    'company_invitation_sent',
    'reset_password_sent',
    'recovery_sent',
    'signup_confirmation_sent',
    'magic_link_sent',
    'email_change_sent',
    'reauthentication_sent'
  ));

update public.auth_email_events
set status = 'sent'
where status is null or btrim(status) = '';

update public.auth_email_events
set status = lower(replace(btrim(status), '-', '_'));

update public.auth_email_events
set status = 'sent'
where status in ('success', 'succeeded', 'ok', 'done', 'complete', 'completed');

update public.auth_email_events
set status = 'failed'
where status in ('failure', 'fail', 'smtp_failed', 'send_failed');

update public.auth_email_events
set status = 'accepted'
where status in ('used', 'consumed');

update public.auth_email_events
set status = 'revoked'
where status in ('cancelled', 'canceled', 'deleted');

update public.auth_email_events
set status = 'unknown'
where status not in (
  'sent',
  'queued',
  'pending',
  'delivered',
  'verified',
  'accepted',
  'failed',
  'created',
  'skipped',
  'blocked',
  'expired',
  'revoked',
  'opened',
  'clicked',
  'bounced',
  'error',
  'unknown'
);

-- Final safety net: never allow remaining invalid/null rows before adding the constraint.
update public.auth_email_events
set status = coalesce(nullif(btrim(status), ''), 'unknown');

alter table if exists public.auth_email_events
  add constraint auth_email_events_status_check
  check (status in (
    'sent',
    'queued',
    'pending',
    'delivered',
    'verified',
    'accepted',
    'failed',
    'created',
    'skipped',
    'blocked',
    'expired',
    'revoked',
    'opened',
    'clicked',
    'bounced',
    'error',
    'unknown'
  ));

create index if not exists auth_email_events_company_created_idx
  on public.auth_email_events(company_id, created_at desc);

create index if not exists auth_email_events_email_created_idx
  on public.auth_email_events(lower(email), created_at desc);

-- -----------------------------------------------------------------------------
-- Role lifecycle columns for old projects.
-- -----------------------------------------------------------------------------
alter table if exists public.user_roles
  add column if not exists status text default 'active',
  add column if not exists is_active boolean default true;
