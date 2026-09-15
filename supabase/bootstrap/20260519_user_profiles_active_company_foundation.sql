-- GRIDEX-AUD-003 derived bootstrap artifact.
-- Source evidence: supabase/migrations/20260519_saas_ui_tenant_admin.sql
-- Restore only the source-defined active company reference required for the
-- complete Batch 6E profile/membership attribution branches. No rows are seeded
-- or rewritten; the immutable source remains independently effect-accounted.

do $$
begin
  if to_regclass('public.user_profiles') is not null then
    alter table public.user_profiles
      add column if not exists active_company_id uuid null
      references public.companies(id) on delete set null;
    create index if not exists user_profiles_active_company_idx
      on public.user_profiles(active_company_id);
  end if;
end $$;
