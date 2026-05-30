-- Direct account provisioning with temporary password.
-- This keeps company/user provisioning independent from outbound invite email.
-- Idempotent and safe to run after earlier Batch 6D auth/governance migrations.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.user_profiles') is not null then
    alter table public.user_profiles add column if not exists must_change_password boolean not null default false;
    alter table public.user_profiles add column if not exists temporary_password_set_at timestamptz null;
    alter table public.user_profiles add column if not exists password_changed_at timestamptz null;
    alter table public.user_profiles add column if not exists active_company_id uuid null references public.companies(id) on delete set null;

    alter table public.user_profiles drop constraint if exists user_profiles_user_status_check;
    alter table public.user_profiles
      add constraint user_profiles_user_status_check
      check (user_status in ('active', 'disabled', 'removed_from_company', 'invitation_revoked', 'locked_security'));

    -- Older auth-sync migrations added a narrow check here. Direct account provisioning no longer writes
    -- email-action values, but older rows may contain admin/system values from previous builds.
    -- Normalize existing values before adding a permissive check so profile sync cannot be blocked.
    alter table public.user_profiles add column if not exists last_auth_email_action text null;
    alter table public.user_profiles drop constraint if exists user_profiles_last_auth_email_action_check;

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

do $$
begin
  if to_regclass('public.company_memberships') is not null then
    alter table public.company_memberships drop constraint if exists company_memberships_role_check;
    alter table public.company_memberships
      add constraint company_memberships_role_check
      check (membership_role in ('owner', 'admin', 'company_admin', 'operations', 'support', 'member', 'viewer'));

    alter table public.company_memberships drop constraint if exists company_memberships_status_check;
    alter table public.company_memberships
      add constraint company_memberships_status_check
      check (status in ('active', 'invited', 'pending', 'suspended', 'disabled', 'removed', 'removed_from_company', 'invitation_revoked', 'locked_security', 'revoked'));

    alter table public.company_memberships add column if not exists disabled_at timestamptz null;
    alter table public.company_memberships add column if not exists disabled_by uuid null references auth.users(id) on delete set null;
    alter table public.company_memberships add column if not exists removed_at timestamptz null;
    alter table public.company_memberships add column if not exists removed_by uuid null references auth.users(id) on delete set null;
    alter table public.company_memberships add column if not exists status_reason text null;
  end if;
end $$;

do $$
begin
  if to_regclass('public.company_invitations') is not null then
    alter table public.company_invitations drop constraint if exists company_invitations_membership_role_check;
    alter table public.company_invitations
      add constraint company_invitations_membership_role_check
      check (membership_role in ('owner', 'admin', 'company_admin', 'operations', 'support', 'member', 'viewer'));

    alter table public.company_invitations drop constraint if exists company_invitations_status_check;
    alter table public.company_invitations
      add constraint company_invitations_status_check
      check (status in ('pending', 'accepted', 'revoked', 'expired', 'invitation_revoked'));

    alter table public.company_invitations add column if not exists accepted_at timestamptz null;
    alter table public.company_invitations add column if not exists invited_user_id uuid null references auth.users(id) on delete set null;
    alter table public.company_invitations add column if not exists role_key text null;
    alter table public.company_invitations add column if not exists metadata jsonb not null default '{}'::jsonb;
  end if;
end $$;
