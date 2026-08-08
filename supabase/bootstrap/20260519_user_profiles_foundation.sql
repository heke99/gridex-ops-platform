-- AUD-003 deterministic bootstrap.
-- Source: supabase/migrations/20260519_auth_callback_email_reset_sync.sql
-- Restores only the historical user_profiles relation required by canonical
-- security convergence. No auth users, profiles or email events are seeded.

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
