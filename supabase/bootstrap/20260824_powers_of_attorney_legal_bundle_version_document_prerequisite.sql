-- GRIDEX-REM-002 verified live-schema prerequisite.
-- Source: Supabase project piidsfebjqjmnepdpnas, captured 2026-08-24.
-- Reconstruct only the live powers_of_attorney legal-bundle document binding
-- required before 20260824140830 reads it. No business rows are seeded.

alter table public.powers_of_attorney
  add column if not exists legal_bundle_version_document_id uuid;

do $$
begin
  if to_regclass('public.legal_bundle_version_documents') is null then
    raise exception 'legal_bundle_version_documents prerequisite is missing before POA legal-bundle replay';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.powers_of_attorney'::regclass
      and conname = 'powers_of_attorney_legal_bundle_version_document_id_fkey'
  ) then
    alter table public.powers_of_attorney
      add constraint powers_of_attorney_legal_bundle_version_document_id_fkey
      foreign key (legal_bundle_version_document_id)
      references public.legal_bundle_version_documents(id)
      on delete restrict;
  end if;
end
$$;

comment on column public.powers_of_attorney.legal_bundle_version_document_id is
  'Exact immutable power_of_attorney document from the locked legal bundle accepted by the customer.';
