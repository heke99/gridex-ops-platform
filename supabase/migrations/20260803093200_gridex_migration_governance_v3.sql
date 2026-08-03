-- Deployment-governance evidence. Unlike the runtime gate, verification does
-- not expire merely because time passes and historical ledger aliases are explicit.

create or replace view public.gridex_migration_governance_v3
with (security_invoker=true) as
with manifest as (
  select count(*)::bigint manifest_file_count,
         count(distinct version)::bigint manifest_version_count,
         count(*) filter(where verified_at is not null)::bigint verified_file_count,
         count(*) filter(where effect_verified)::bigint effect_verified_file_count,
         count(*) filter(where checksum is null or checksum !~ '^[a-f0-9]{64}$')::bigint invalid_checksum_count,
         count(*) filter(where verification_kind='schema_effect')::bigint schema_effect_file_count,
         max(verified_at) last_verified_at
  from public.canonical_migration_manifest
), ledger as (
  select count(*)::bigint ledger_version_count,max(version) latest_ledger_version
  from supabase_migrations.schema_migrations
), missing as (
  select count(*)::bigint count from public.canonical_migration_manifest m
  where m.verification_kind in ('ledger','ledger_alias') and not exists (
    select 1 from supabase_migrations.schema_migrations l
    where l.version::text=m.applied_ledger_version and l.name=m.applied_ledger_name
  )
), unmapped as (
  select count(*)::bigint count from supabase_migrations.schema_migrations l
  where not exists (
    select 1 from public.canonical_migration_manifest m
    where m.applied_ledger_version=l.version::text and m.applied_ledger_name=l.name
  )
), duplicate_mappings as (
  select count(*)::bigint count from (
    select applied_ledger_version from public.canonical_migration_manifest
    where applied_ledger_version is not null
    group by applied_ledger_version having count(*)>1
  ) d
)
select manifest.manifest_file_count,manifest.manifest_version_count,
       manifest.verified_file_count,manifest.effect_verified_file_count,
       manifest.invalid_checksum_count,manifest.schema_effect_file_count,
       manifest.last_verified_at,ledger.ledger_version_count,ledger.latest_ledger_version,
       missing.count missing_in_ledger,unmapped.count unmapped_ledger_versions,
       duplicate_mappings.count duplicate_ledger_mappings,
       (manifest.manifest_file_count>0
        and manifest.verified_file_count=manifest.manifest_file_count
        and manifest.effect_verified_file_count=manifest.manifest_file_count
        and manifest.invalid_checksum_count=0
        and missing.count=0 and unmapped.count=0 and duplicate_mappings.count=0) is_ready,
       array_remove(array[
         case when manifest.manifest_file_count=0 then 'CANONICAL_MIGRATION_MANIFEST_EMPTY' end,
         case when manifest.verified_file_count<>manifest.manifest_file_count then 'MIGRATIONS_NOT_FULLY_VERIFIED' end,
         case when manifest.effect_verified_file_count<>manifest.manifest_file_count then 'MIGRATION_EFFECTS_NOT_FULLY_VERIFIED' end,
         case when manifest.invalid_checksum_count>0 then 'MIGRATION_CHECKSUM_INVALID' end,
         case when missing.count>0 then 'MIGRATION_LEDGER_MISSING_MAPPING' end,
         case when unmapped.count>0 then 'MIGRATION_LEDGER_UNMAPPED_VERSION' end,
         case when duplicate_mappings.count>0 then 'MIGRATION_LEDGER_DUPLICATE_MAPPING' end
       ],null)::text[] blockers
from manifest cross join ledger cross join missing cross join unmapped cross join duplicate_mappings;

comment on view public.gridex_migration_governance_v3 is
  'Deployment governance with explicit ledger aliases and schema-effect evidence; it never expires on elapsed time.';
revoke all on public.gridex_migration_governance_v3 from public,anon,authenticated;
grant select on public.gridex_migration_governance_v3 to service_role;

