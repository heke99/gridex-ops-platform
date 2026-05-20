-- Direct temporary-password account flow hardening.
-- This keeps Supabase responsible for reset/confirm emails, while admin-created
-- company users can log in directly with a temporary password and then change it.

create extension if not exists pgcrypto;

alter table if exists public.user_profiles
  add column if not exists last_auth_email_action text,
  add column if not exists last_auth_email_action_at timestamptz,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists temporary_password_set_at timestamptz,
  add column if not exists temporary_password_expires_at timestamptz,
  add column if not exists password_changed_at timestamptz;

alter table if exists public.user_profiles
  drop constraint if exists user_profiles_last_auth_email_action_check;

update public.user_profiles
set last_auth_email_action = 'direct_user_created'
where last_auth_email_action in (
  'admin_companies_create_company_owner',
  'admin_companies_invite_user',
  'direct_company_access_granted',
  'company_owner_created',
  'company_user_created'
);

update public.user_profiles
set last_auth_email_action = null
where last_auth_email_action is not null
  and last_auth_email_action not in (
    'invite_sent',
    'password_reset_sent',
    'confirmation_sent',
    'email_confirmed',
    'password_updated',
    'auth_callback_completed',
    'auth_callback_failed',
    'email_action_verified',
    'company_invitation_accepted',
    'direct_user_created',
    'direct_user_linked'
  );

alter table if exists public.user_profiles
  add constraint user_profiles_last_auth_email_action_check
  check (
    last_auth_email_action is null or last_auth_email_action in (
      'invite_sent',
      'password_reset_sent',
      'confirmation_sent',
      'email_confirmed',
      'password_updated',
      'auth_callback_completed',
      'auth_callback_failed',
      'email_action_verified',
      'company_invitation_accepted',
      'direct_user_created',
      'direct_user_linked'
    )
  );

-- Broaden auth_email_events constraints if the table exists. Older migrations may
-- use either event_type/source or action/message columns, so both are handled.
do $$
begin
  if to_regclass('public.auth_email_events') is not null then
    alter table public.auth_email_events drop constraint if exists auth_email_events_event_type_check;
    alter table public.auth_email_events drop constraint if exists auth_email_events_action_check;
    alter table public.auth_email_events drop constraint if exists auth_email_events_status_check;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'auth_email_events' and column_name = 'event_type'
  ) then
    update public.auth_email_events
    set event_type = 'direct_user_created'
    where event_type in ('admin_companies_create_company_owner', 'admin_companies_invite_user', 'direct_company_access_granted');

    update public.auth_email_events
    set event_type = 'unknown'
    where event_type is null or btrim(event_type) = '';

    alter table public.auth_email_events
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
        'direct_user_linked',
        'company_invite_sent',
        'company_invitation_sent',
        'reset_password_sent',
        'recovery_sent',
        'signup_confirmation_sent',
        'magic_link_sent',
        'email_change_sent',
        'reauthentication_sent'
      ));
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'auth_email_events' and column_name = 'action'
  ) then
    update public.auth_email_events
    set action = 'direct_user_created'
    where action in ('admin_companies_create_company_owner', 'admin_companies_invite_user', 'direct_company_access_granted');

    update public.auth_email_events
    set action = 'invite_sent'
    where action is null or btrim(action) = '';

    alter table public.auth_email_events
      add constraint auth_email_events_action_check
      check (action in (
        'invite_sent',
        'password_reset_sent',
        'confirmation_sent',
        'email_confirmed',
        'password_updated',
        'auth_callback_completed',
        'auth_callback_failed',
        'email_action_verified',
        'company_invitation_accepted',
        'direct_user_created',
        'direct_user_linked'
      ));
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'auth_email_events' and column_name = 'status'
  ) then
    update public.auth_email_events
    set status = 'sent'
    where status is null or btrim(status) = '';

    update public.auth_email_events
    set status = lower(replace(btrim(status), '-', '_'));

    update public.auth_email_events
    set status = 'failed'
    where status in ('failure', 'fail', 'error_sending', 'send_failed', 'smtp_failed');

    update public.auth_email_events
    set status = 'created'
    where status in ('success', 'succeeded', 'ok', 'done', 'complete', 'completed');

    update public.auth_email_events
    set status = 'sent'
    where status not in ('sent', 'verified', 'accepted', 'failed', 'created', 'queued', 'pending', 'delivered', 'skipped', 'blocked', 'expired', 'revoked', 'opened', 'clicked', 'bounced', 'error', 'unknown');

    alter table public.auth_email_events
      add constraint auth_email_events_status_check
      check (status in ('sent', 'verified', 'accepted', 'failed', 'created', 'queued', 'pending', 'delivered', 'skipped', 'blocked', 'expired', 'revoked', 'opened', 'clicked', 'bounced', 'error', 'unknown'));
  end if;
end $$;

-- Direct account flow should not leave pending invitations. Existing pending rows
-- that already have an invited user and a temporary password are effectively active.
update public.company_invitations
set status = 'accepted',
    accepted_at = coalesce(accepted_at, now()),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('access_source', 'direct_temporary_password', 'login_ready', true)
where status = 'pending'
  and invited_user_id is not null
  and temporary_password_issued_at is not null;
