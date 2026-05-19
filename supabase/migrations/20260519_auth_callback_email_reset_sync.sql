-- Batch auth hardening: callback, email confirmation and password reset sync.
-- Safe to run after existing RBAC/governance migrations.

create extension if not exists pgcrypto;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text null,
  full_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles add column if not exists user_status text not null default 'active';
alter table public.user_profiles add column if not exists auth_email_confirmed_at timestamptz null;
alter table public.user_profiles add column if not exists auth_last_sign_in_at timestamptz null;
alter table public.user_profiles add column if not exists auth_last_synced_at timestamptz null;
alter table public.user_profiles add column if not exists last_invite_sent_at timestamptz null;
alter table public.user_profiles add column if not exists last_password_reset_sent_at timestamptz null;
alter table public.user_profiles add column if not exists last_confirmation_email_sent_at timestamptz null;
alter table public.user_profiles add column if not exists last_auth_email_action text null;
alter table public.user_profiles add column if not exists last_auth_email_action_at timestamptz null;
alter table public.user_profiles add column if not exists last_auth_email_action_by uuid null references auth.users(id) on delete set null;
alter table public.user_profiles add column if not exists last_auth_email_message text null;

alter table public.user_profiles drop constraint if exists user_profiles_last_auth_email_action_check;
alter table public.user_profiles
  add constraint user_profiles_last_auth_email_action_check
  check (
    last_auth_email_action is null or last_auth_email_action in (
      'invite_sent',
      'password_reset_sent',
      'confirmation_sent',
      'email_confirmed',
      'password_updated',
      'auth_callback_completed',
      'auth_callback_failed'
    )
  );

create index if not exists user_profiles_auth_email_confirmed_idx
  on public.user_profiles(auth_email_confirmed_at);

create index if not exists user_profiles_last_auth_email_action_idx
  on public.user_profiles(last_auth_email_action, last_auth_email_action_at desc);

create table if not exists public.auth_email_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  email text null,
  action text not null,
  status text not null default 'sent',
  actor_user_id uuid null references auth.users(id) on delete set null,
  message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.auth_email_events drop constraint if exists auth_email_events_action_check;
alter table public.auth_email_events
  add constraint auth_email_events_action_check
  check (action in (
    'invite_sent',
    'password_reset_sent',
    'confirmation_sent',
    'email_confirmed',
    'password_updated',
    'auth_callback_completed',
    'auth_callback_failed'
  ));

alter table public.auth_email_events drop constraint if exists auth_email_events_status_check;
alter table public.auth_email_events
  add constraint auth_email_events_status_check
  check (status in ('sent', 'completed', 'failed'));

create index if not exists auth_email_events_user_created_idx
  on public.auth_email_events(user_id, created_at desc);

create index if not exists auth_email_events_email_created_idx
  on public.auth_email_events(lower(email), created_at desc);

create index if not exists auth_email_events_action_status_idx
  on public.auth_email_events(action, status, created_at desc);

alter table public.auth_email_events enable row level security;

drop policy if exists auth_email_events_service_role_all on public.auth_email_events;
create policy auth_email_events_service_role_all
  on public.auth_email_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Best-effort backfill from auth.users so admin/user pages show confirmed emails immediately.
insert into public.user_profiles (id, email, auth_email_confirmed_at, auth_last_sign_in_at, auth_last_synced_at, updated_at)
select
  u.id,
  u.email,
  coalesce(u.email_confirmed_at, u.confirmed_at),
  u.last_sign_in_at,
  now(),
  now()
from auth.users u
on conflict (id) do update
set
  email = coalesce(public.user_profiles.email, excluded.email),
  auth_email_confirmed_at = coalesce(excluded.auth_email_confirmed_at, public.user_profiles.auth_email_confirmed_at),
  auth_last_sign_in_at = coalesce(excluded.auth_last_sign_in_at, public.user_profiles.auth_last_sign_in_at),
  auth_last_synced_at = now(),
  updated_at = now();
