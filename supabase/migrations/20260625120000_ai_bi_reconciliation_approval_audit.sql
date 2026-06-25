-- Batch 8 hotfix: AI/BI reconciliation approval metadata
-- Safe when ai_list_discrepancies / ai_list_imports do not exist yet.

alter table if exists public.ai_list_discrepancies
  add column if not exists resolution text,
  add column if not exists resolution_note text,
  add column if not exists resolved_by uuid,
  add column if not exists resolved_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'ai_list_discrepancies'
  ) then
    if not exists (
      select 1
      from information_schema.table_constraints
      where table_schema = 'public'
        and table_name = 'ai_list_discrepancies'
        and constraint_name = 'ai_list_discrepancies_resolution_chk'
    ) then
      alter table public.ai_list_discrepancies
        add constraint ai_list_discrepancies_resolution_chk
        check (
          resolution is null
          or resolution in ('accepted', 'rejected', 'accepted_manual_apply')
        );
    end if;

    comment on column public.ai_list_discrepancies.resolution is
      'Admin decision: accepted (auto-safe applied), rejected, or accepted_manual_apply. AI/BI import never auto-overwrites masterdata.';

    comment on column public.ai_list_discrepancies.resolution_note is
      'Admin note explaining the reconciliation decision.';

    comment on column public.ai_list_discrepancies.resolved_by is
      'User who resolved the AI/BI reconciliation discrepancy.';

    comment on column public.ai_list_discrepancies.resolved_at is
      'Timestamp when the AI/BI reconciliation discrepancy was resolved.';
  end if;
end $$;

alter table if exists public.ai_list_imports
  add column if not exists retention_until date,
  add column if not exists gdpr_basis text,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'ai_list_imports'
  ) then
    comment on column public.ai_list_imports.retention_until is
      'Retention boundary for imported AI/BI raw payload (GDPR).';

    comment on column public.ai_list_imports.gdpr_basis is
      'Documented GDPR/legal basis for retaining the imported reconciliation data.';

    comment on column public.ai_list_imports.approved_by is
      'User who approved the AI/BI reconciliation import or safe application.';

    comment on column public.ai_list_imports.approved_at is
      'Timestamp when the AI/BI reconciliation import or safe application was approved.';
  end if;
end $$;