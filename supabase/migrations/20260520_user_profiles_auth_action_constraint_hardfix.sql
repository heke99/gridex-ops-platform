-- Hard-fix for user_profiles.last_auth_email_action constraint.
-- Run this if 20260520_direct_account_temporary_password_flow.sql fails with
-- user_profiles_last_auth_email_action_check.
-- The field is tracking metadata, not business-critical state. Keep it flexible so old
-- admin/action values do not block direct account provisioning.

do $$
begin
  if to_regclass('public.user_profiles') is not null then
    alter table public.user_profiles
      add column if not exists last_auth_email_action text null;

    alter table public.user_profiles
      drop constraint if exists user_profiles_last_auth_email_action_check;

    update public.user_profiles
    set last_auth_email_action = null
    where last_auth_email_action is not null
      and btrim(last_auth_email_action) = '';

    update public.user_profiles
    set last_auth_email_action = lower(
      regexp_replace(
        replace(btrim(last_auth_email_action), '-', '_'),
        '[^a-zA-Z0-9_:.]+',
        '_',
        'g'
      )
    )
    where last_auth_email_action is not null;

    update public.user_profiles
    set last_auth_email_action = left(last_auth_email_action, 120)
    where last_auth_email_action is not null
      and length(last_auth_email_action) > 120;

    alter table public.user_profiles
      add constraint user_profiles_last_auth_email_action_check
      check (
        last_auth_email_action is null or
        (
          length(last_auth_email_action) <= 120 and
          last_auth_email_action ~ '^[a-z0-9_:.]+$'
        )
      );
  end if;
end $$;
