-- Add explicit migration reconciliation metadata and a separate runtime state.

alter table public.canonical_migration_manifest
  add column if not exists applied_ledger_version text,
  add column if not exists applied_ledger_name text,
  add column if not exists verification_kind text not null default 'ledger',
  add column if not exists effect_verified boolean not null default false,
  add column if not exists effect_evidence jsonb not null default '{}'::jsonb;

create unique index if not exists canonical_migration_manifest_ledger_version_uidx
  on public.canonical_migration_manifest(applied_ledger_version)
  where applied_ledger_version is not null;

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.canonical_migration_manifest'::regclass
      and conname='canonical_migration_manifest_verification_kind_check'
  ) then
    alter table public.canonical_migration_manifest
      add constraint canonical_migration_manifest_verification_kind_check
      check (verification_kind in ('ledger','ledger_alias','schema_effect'));
  end if;
end
$constraint$;
