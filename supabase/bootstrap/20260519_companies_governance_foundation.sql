-- Derived clean-replay prerequisite from checksum-pinned Batch 6D tenant governance.
-- Restores only the source-defined companies lifecycle/governance block required by
-- later canonical company/legal-profile and tenant lifecycle flows. No rows are seeded.
do $$
begin
  if to_regclass('public.companies') is not null then
    alter table public.companies drop constraint if exists companies_status_check;
    alter table public.companies
      add constraint companies_status_check
      check (status in ('active', 'onboarding', 'paused', 'suspended', 'archived', 'pending_deletion', 'deleted_test_only'));

    alter table public.companies
      add column if not exists status_reason text null,
      add column if not exists paused_at timestamptz null,
      add column if not exists paused_by uuid null references auth.users(id) on delete set null,
      add column if not exists suspended_at timestamptz null,
      add column if not exists suspended_by uuid null references auth.users(id) on delete set null,
      add column if not exists archived_at timestamptz null,
      add column if not exists archived_by uuid null references auth.users(id) on delete set null,
      add column if not exists deletion_requested_at timestamptz null,
      add column if not exists deletion_requested_by uuid null references auth.users(id) on delete set null,
      add column if not exists reactivated_at timestamptz null,
      add column if not exists reactivated_by uuid null references auth.users(id) on delete set null;

    create index if not exists companies_governance_status_idx
      on public.companies(status, updated_at desc);
  end if;
end $$;
