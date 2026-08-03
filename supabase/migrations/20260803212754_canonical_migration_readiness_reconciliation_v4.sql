-- Reconcile live portfolio migrations with the canonical manifest and replace
-- the legacy count/time-based readiness view with explicit ledger mappings.
-- Runtime API traffic remains governed by gridex_runtime_schema_capabilities_v3.

begin;

insert into public.canonical_migration_manifest (
  version,
  filename,
  checksum,
  applied_environment,
  verified_at,
  verification_source,
  release_identifier,
  schema_fingerprint,
  applied_ledger_version,
  applied_ledger_name,
  verification_kind,
  effect_verified,
  effect_evidence
)
values
  (
    '20260803144819',
    '20260803144819_contract_portfolio_area_billing_consistency.sql',
    '1522b0e39df53460a7e98145462552f0fbe71d0f827e1b8ee87b6e54f215049b',
    'production', now(), 'live_ledger_and_runtime_capability_reconciliation',
    '20260803-contract-portfolio-readiness-reconciliation',
    (select schema_fingerprint from public.gridex_runtime_schema_capabilities_v3),
    '20260803144819', 'contract_portfolio_area_billing_consistency', 'ledger', true,
    jsonb_build_object('ledger_statement_verified', true, 'runtime_capabilities_ready', (select is_ready from public.gridex_runtime_schema_capabilities_v3))
  ),
  (
    '20260803145108',
    '20260803145108_portfolio_lock_transition_immutability_fix.sql',
    '664cf48cc9611c5e80263baf403f94d916fbc0f873ae5c18e719e76a2645e975',
    'production', now(), 'live_ledger_and_runtime_capability_reconciliation',
    '20260803-contract-portfolio-readiness-reconciliation',
    (select schema_fingerprint from public.gridex_runtime_schema_capabilities_v3),
    '20260803145108', 'portfolio_lock_transition_immutability_fix', 'ledger', true,
    jsonb_build_object('ledger_statement_verified', true, 'runtime_capabilities_ready', (select is_ready from public.gridex_runtime_schema_capabilities_v3))
  ),
  (
    '20260803145427',
    '20260803145427_portfolio_superadmin_role_alignment.sql',
    '73b718ff8dc9a4d18ca72f3e2a8e6bf949255e28af3011fa4da98031f6701bae',
    'production', now(), 'live_ledger_and_runtime_capability_reconciliation',
    '20260803-contract-portfolio-readiness-reconciliation',
    (select schema_fingerprint from public.gridex_runtime_schema_capabilities_v3),
    '20260803145427', 'portfolio_superadmin_role_alignment', 'ledger', true,
    jsonb_build_object('ledger_statement_verified', true, 'runtime_capabilities_ready', (select is_ready from public.gridex_runtime_schema_capabilities_v3))
  ),
  (
    '20260803150723',
    '20260803150723_portfolio_mix_share_billing_completion.sql',
    '717fafdfcac85c602611cdba0ea391127ddca59065668f04a8c848250b101444',
    'production', now(), 'live_ledger_and_runtime_capability_reconciliation',
    '20260803-contract-portfolio-readiness-reconciliation',
    (select schema_fingerprint from public.gridex_runtime_schema_capabilities_v3),
    '20260803150723', 'portfolio_mix_share_billing_completion', 'ledger', true,
    jsonb_build_object('ledger_statement_verified', true, 'runtime_capabilities_ready', (select is_ready from public.gridex_runtime_schema_capabilities_v3))
  ),
  (
    '20260803152014',
    '20260803152014_contract_portfolio_tenant_fk_indexes.sql',
    'bc7de917bdf4f309059330105648217be5a82a91289037cf6e713c46cb99d4ae',
    'production', now(), 'live_ledger_and_runtime_capability_reconciliation',
    '20260803-contract-portfolio-readiness-reconciliation',
    (select schema_fingerprint from public.gridex_runtime_schema_capabilities_v3),
    '20260803152014', 'contract_portfolio_tenant_fk_indexes', 'ledger', true,
    jsonb_build_object('ledger_statement_verified', true, 'runtime_capabilities_ready', (select is_ready from public.gridex_runtime_schema_capabilities_v3))
  ),
  (
    '20260803152236',
    '20260803152236_portfolio_superadmin_helper_service_role_only.sql',
    '9a095233c605184a00d59884fc7ad4a91534de75fbae17fa3fbc04e7171c0d01',
    'production', now(), 'live_ledger_and_runtime_capability_reconciliation',
    '20260803-contract-portfolio-readiness-reconciliation',
    (select schema_fingerprint from public.gridex_runtime_schema_capabilities_v3),
    '20260803152236', 'portfolio_superadmin_helper_service_role_only', 'ledger', true,
    jsonb_build_object('ledger_statement_verified', true, 'runtime_capabilities_ready', (select is_ready from public.gridex_runtime_schema_capabilities_v3))
  )
on conflict (version, filename) do update
set checksum = excluded.checksum,
    applied_environment = excluded.applied_environment,
    verified_at = excluded.verified_at,
    verification_source = excluded.verification_source,
    release_identifier = excluded.release_identifier,
    schema_fingerprint = excluded.schema_fingerprint,
    applied_ledger_version = excluded.applied_ledger_version,
    applied_ledger_name = excluded.applied_ledger_name,
    verification_kind = excluded.verification_kind,
    effect_verified = excluded.effect_verified,
    effect_evidence = excluded.effect_evidence;

create or replace view public.canonical_migration_readiness_v
with (security_invoker = true) as
with manifest as (
  select count(*)::bigint as manifest_file_count,
         count(distinct version)::bigint as manifest_version_count,
         count(*) filter (where verified_at is not null)::bigint as verified_file_count,
         count(*) filter (where effect_verified)::bigint as effect_verified_file_count,
         count(*) filter (
           where checksum is null or checksum !~ '^[a-f0-9]{64}$'
         )::bigint as invalid_checksum_count,
         max(verified_at) as last_verified_at
  from public.canonical_migration_manifest
), ledger as (
  select count(*)::bigint as ledger_version_count,
         max(version) as latest_ledger_version
  from supabase_migrations.schema_migrations
), missing as (
  select count(*)::bigint as count
  from public.canonical_migration_manifest manifest_row
  where manifest_row.verification_kind in ('ledger', 'ledger_alias')
    and not exists (
      select 1
      from supabase_migrations.schema_migrations ledger_row
      where ledger_row.version::text = manifest_row.applied_ledger_version
        and ledger_row.name = manifest_row.applied_ledger_name
    )
), unmapped as (
  select count(*)::bigint as count
  from supabase_migrations.schema_migrations ledger_row
  where not exists (
    select 1
    from public.canonical_migration_manifest manifest_row
    where manifest_row.applied_ledger_version = ledger_row.version::text
      and manifest_row.applied_ledger_name = ledger_row.name
  )
), duplicate_mappings as (
  select count(*)::bigint as count
  from (
    select applied_ledger_version
    from public.canonical_migration_manifest
    where applied_ledger_version is not null
    group by applied_ledger_version
    having count(*) > 1
  ) duplicate_rows
)
select
  manifest.manifest_file_count,
  manifest.manifest_version_count,
  manifest.verified_file_count,
  manifest.invalid_checksum_count,
  manifest.last_verified_at,
  ledger.ledger_version_count,
  ledger.latest_ledger_version,
  missing.count as missing_in_ledger,
  (
    manifest.manifest_file_count > 0
    and manifest.verified_file_count = manifest.manifest_file_count
    and manifest.effect_verified_file_count = manifest.manifest_file_count
    and manifest.invalid_checksum_count = 0
    and missing.count = 0
    and unmapped.count = 0
    and duplicate_mappings.count = 0
  ) as is_ready,
  array_remove(array[
    case when manifest.manifest_file_count = 0 then 'CANONICAL_MIGRATION_MANIFEST_EMPTY' end,
    case when manifest.verified_file_count <> manifest.manifest_file_count then 'MIGRATIONS_NOT_FULLY_VERIFIED' end,
    case when manifest.effect_verified_file_count <> manifest.manifest_file_count then 'MIGRATION_EFFECTS_NOT_FULLY_VERIFIED' end,
    case when manifest.invalid_checksum_count > 0 then 'MIGRATION_CHECKSUM_INVALID' end,
    case when missing.count > 0 then 'MIGRATION_LEDGER_MISSING_MAPPING' end,
    case when unmapped.count > 0 then 'MIGRATION_LEDGER_UNMAPPED_VERSION' end,
    case when duplicate_mappings.count > 0 then 'MIGRATION_LEDGER_DUPLICATE_MAPPING' end
  ], null)::text[] as blockers
from manifest
cross join ledger
cross join missing
cross join unmapped
cross join duplicate_mappings;

comment on view public.canonical_migration_readiness_v is
  'Canonical deployment-governance readiness using explicit ledger aliases and schema-effect evidence. It is not the external API runtime gate.';

revoke all on public.canonical_migration_readiness_v from public, anon, authenticated;
grant select on public.canonical_migration_readiness_v to service_role;

update public.platform_schema_state
set current_version = '20260803-runtime-capability-compatible-v4',
    is_ready = runtime.is_ready,
    blocking_issues = to_jsonb(runtime.blocking_issues),
    verified_at = now(),
    updated_at = now()
from public.gridex_runtime_schema_capabilities_v3 runtime
where public.platform_schema_state.id = true;

commit;
