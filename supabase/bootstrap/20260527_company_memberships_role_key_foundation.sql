-- GRIDEX-AUD-003 derived bootstrap artifact.
-- Source evidence: supabase/migrations/20260527_fix_company_user_invite_runtime_columns.sql
-- Purpose: restore the source-defined company_memberships runtime column family,
-- constraints and supporting indexes required by tracked RBAC/performance helpers.
-- Empty replay has no membership rows to backfill.
-- The immutable source migration remains checksum-pinned by migration-history-manifest.json.

alter table if exists public.company_memberships
  add column if not exists role text,
  add column if not exists role_id uuid,
  add column if not exists membership_role text default 'member',
  add column if not exists role_key text,
  add column if not exists status text default 'active',
  add column if not exists is_active boolean default true,
  add column if not exists invited_email text,
  add column if not exists invited_by uuid,
  add column if not exists invited_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists joined_at timestamptz,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by uuid,
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid,
  add column if not exists status_reason text,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if to_regclass('public.company_memberships') is not null then
    alter table public.company_memberships
      alter column membership_role set default 'member',
      alter column status set default 'active',
      alter column is_active set default true;

    alter table public.company_memberships
      drop constraint if exists company_memberships_role_check;
    alter table public.company_memberships
      add constraint company_memberships_role_check
      check (membership_role in ('owner', 'admin', 'company_admin', 'operations', 'support', 'member', 'viewer'));

    alter table public.company_memberships
      drop constraint if exists company_memberships_status_check;
    alter table public.company_memberships
      add constraint company_memberships_status_check
      check (status in ('active', 'invited', 'pending', 'suspended', 'disabled', 'removed', 'removed_from_company', 'invitation_revoked', 'locked_security', 'revoked'));

    create unique index if not exists company_memberships_company_user_uidx
      on public.company_memberships(company_id, user_id)
      where company_id is not null and user_id is not null;

    create index if not exists company_memberships_company_status_idx
      on public.company_memberships(company_id, status);
  end if;
end $$;
