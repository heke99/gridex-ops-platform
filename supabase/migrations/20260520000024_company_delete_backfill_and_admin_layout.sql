-- Batch 6D UI/delete hardening
-- Purpose:
-- 1) Backfill older company rows so status values are compatible with governance UI.
-- 2) Keep invite/membership metadata deletable for test companies.
-- 3) Normalize orphaned metadata so old test companies do not remain visible after deletion.

-- Companies created before governance may have null/legacy statuses.
do $$
begin
  if to_regclass('public.companies') is not null then
    alter table public.companies drop constraint if exists companies_status_check;
    alter table public.companies add constraint companies_status_check
      check (status in ('active', 'onboarding', 'paused', 'suspended', 'archived', 'pending_deletion', 'deleted_test_only'));

    update public.companies
      set status = 'active'
    where status is null
       or status not in ('active', 'onboarding', 'paused', 'suspended', 'archived', 'pending_deletion', 'deleted_test_only');

    alter table public.companies add column if not exists status_reason text null;
    alter table public.companies add column if not exists updated_at timestamptz null default now();
  end if;
end $$;

-- Widen lifecycle statuses for older membership/invite schemas.
do $$
begin
  if to_regclass('public.company_memberships') is not null then
    alter table public.company_memberships drop constraint if exists company_memberships_status_check;
    alter table public.company_memberships add constraint company_memberships_status_check
      check (status in ('active', 'pending', 'invited', 'disabled', 'suspended', 'revoked', 'removed', 'removed_from_company', 'invitation_revoked', 'locked_security', 'deleted_test_only'));

    update public.company_memberships
      set status = 'active'
    where status is null or btrim(status) = '';

    create index if not exists company_memberships_company_delete_idx
      on public.company_memberships(company_id);
  end if;

  if to_regclass('public.company_invitations') is not null then
    alter table public.company_invitations drop constraint if exists company_invitations_status_check;
    alter table public.company_invitations add constraint company_invitations_status_check
      check (status in ('pending', 'accepted', 'revoked', 'expired', 'invitation_revoked', 'deleted_test_only'));

    update public.company_invitations
      set status = 'pending'
    where status is null or btrim(status) = '';

    create index if not exists company_invitations_company_delete_idx
      on public.company_invitations(company_id);
  end if;
end $$;

-- Optional auth_email_events table from auth sync batches.
do $$
begin
  if to_regclass('public.auth_email_events') is not null then
    alter table public.auth_email_events drop constraint if exists auth_email_events_status_check;
    alter table public.auth_email_events add constraint auth_email_events_status_check
      check (status in ('sent', 'queued', 'pending', 'delivered', 'verified', 'accepted', 'failed', 'created', 'skipped', 'blocked', 'expired', 'revoked', 'opened', 'clicked', 'bounced', 'error', 'unknown', 'deleted_test_only'));

    create index if not exists auth_email_events_company_delete_idx
      on public.auth_email_events(company_id);
  end if;
end $$;

-- Keep old orphaned metadata from blocking/appearing in admin counts.
do $$
begin
  if to_regclass('public.company_memberships') is not null and to_regclass('public.companies') is not null then
    delete from public.company_memberships cm
    where cm.company_id is not null
      and not exists (select 1 from public.companies c where c.id = cm.company_id);
  end if;

  if to_regclass('public.company_invitations') is not null and to_regclass('public.companies') is not null then
    delete from public.company_invitations ci
    where ci.company_id is not null
      and not exists (select 1 from public.companies c where c.id = ci.company_id);
  end if;

  if to_regclass('public.tenant_governance_events') is not null and to_regclass('public.companies') is not null then
    update public.tenant_governance_events tge
      set company_id = null,
          metadata = coalesce(tge.metadata, '{}'::jsonb) || jsonb_build_object('company_deleted_or_missing', true)
    where tge.company_id is not null
      and not exists (select 1 from public.companies c where c.id = tge.company_id);
  end if;

  if to_regclass('public.audit_logs') is not null and to_regclass('public.companies') is not null then
    update public.audit_logs al
      set company_id = null
    where al.company_id is not null
      and not exists (select 1 from public.companies c where c.id = al.company_id);
  end if;
end $$;
