-- Idempotent post-apply registration and verification for
-- 20260803212754_canonical_migration_readiness_reconciliation_v4.sql.
--
-- Run only after the matching migration is present in
-- supabase_migrations.schema_migrations. This script does not replay DDL.

begin;

do $preflight$
begin
  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version::text = '20260803212754'
      and name = 'canonical_migration_readiness_reconciliation_v4'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'RUNTIME_READINESS_V4_LEDGER_ROW_MISSING';
  end if;

  if not exists (
    select 1
    from public.gridex_runtime_schema_capabilities_v3
    where is_ready
      and coalesce(cardinality(blocking_issues), 0) = 0
      and schema_fingerprint ~ '^[a-f0-9]{64}$'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'RUNTIME_CAPABILITIES_NOT_READY';
  end if;
end
$preflight$;

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
values (
  '20260803212754',
  '20260803212754_canonical_migration_readiness_reconciliation_v4.sql',
  '08b8722e962ee019c9d190dcb3c4f3efe4cd956cdf88a0d432a0989f70635117',
  'production',
  now(),
  'post_apply_runtime_readiness_v4',
  '20260803212754-runtime-readiness-reconciliation-v4',
  (select schema_fingerprint from public.gridex_runtime_schema_capabilities_v3),
  '20260803212754',
  'canonical_migration_readiness_reconciliation_v4',
  'ledger',
  true,
  jsonb_build_object(
    'canonical_readiness_view_reconciled', true,
    'portfolio_ledger_mappings_added', 6,
    'runtime_capabilities_ready', true
  )
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

update public.platform_schema_state
set current_version = '20260803-runtime-capability-compatible-v4',
    is_ready = runtime.is_ready,
    blocking_issues = to_jsonb(runtime.blocking_issues),
    verified_at = now(),
    updated_at = now()
from public.gridex_runtime_schema_capabilities_v3 runtime
where public.platform_schema_state.id = true;

do $postflight$
declare
  v_runtime_ready boolean;
  v_governance_ready boolean;
  v_canonical_ready boolean;
  v_compatibility_ready boolean;
  v_required_mapping_count bigint;
begin
  select is_ready and coalesce(cardinality(blocking_issues), 0) = 0
  into v_runtime_ready
  from public.gridex_runtime_schema_capabilities_v3;

  select is_ready
    and missing_in_ledger = 0
    and unmapped_ledger_versions = 0
    and duplicate_ledger_mappings = 0
    and coalesce(cardinality(blockers), 0) = 0
  into v_governance_ready
  from public.gridex_migration_governance_v3;

  select is_ready
    and missing_in_ledger = 0
    and coalesce(cardinality(blockers), 0) = 0
  into v_canonical_ready
  from public.canonical_migration_readiness_v;

  select is_ready and blocking_issues = '[]'::jsonb
  into v_compatibility_ready
  from public.platform_schema_state
  where id = true;

  select count(*)
  into v_required_mapping_count
  from public.canonical_migration_manifest
  where (applied_ledger_version, applied_ledger_name) in (
    ('20260803144819', 'contract_portfolio_area_billing_consistency'),
    ('20260803145108', 'portfolio_lock_transition_immutability_fix'),
    ('20260803145427', 'portfolio_superadmin_role_alignment'),
    ('20260803150723', 'portfolio_mix_share_billing_completion'),
    ('20260803152014', 'contract_portfolio_tenant_fk_indexes'),
    ('20260803152236', 'portfolio_superadmin_helper_service_role_only'),
    ('20260803212754', 'canonical_migration_readiness_reconciliation_v4')
  )
    and verification_kind in ('ledger', 'ledger_alias')
    and effect_verified;

  if not coalesce(v_runtime_ready, false) then
    raise exception using errcode = 'P0001', message = 'RUNTIME_CAPABILITIES_POSTFLIGHT_FAILED';
  end if;
  if not coalesce(v_governance_ready, false) then
    raise exception using errcode = 'P0001', message = 'MIGRATION_GOVERNANCE_POSTFLIGHT_FAILED';
  end if;
  if not coalesce(v_canonical_ready, false) then
    raise exception using errcode = 'P0001', message = 'CANONICAL_READINESS_POSTFLIGHT_FAILED';
  end if;
  if not coalesce(v_compatibility_ready, false) then
    raise exception using errcode = 'P0001', message = 'PLATFORM_SCHEMA_STATE_POSTFLIGHT_FAILED';
  end if;
  if v_required_mapping_count <> 7 then
    raise exception using
      errcode = 'P0001',
      message = format('REQUIRED_LEDGER_MAPPING_COUNT_INVALID:%s', v_required_mapping_count);
  end if;
end
$postflight$;

commit;

select
  is_ready,
  schema_fingerprint,
  blocking_issues,
  evaluated_at
from public.gridex_runtime_schema_capabilities_v3;

select
  manifest_file_count,
  ledger_version_count,
  missing_in_ledger,
  unmapped_ledger_versions,
  duplicate_ledger_mappings,
  is_ready,
  blockers
from public.gridex_migration_governance_v3;

select
  manifest_file_count,
  ledger_version_count,
  missing_in_ledger,
  is_ready,
  blockers
from public.canonical_migration_readiness_v;

select
  current_version,
  is_ready,
  blocking_issues,
  verified_at
from public.platform_schema_state
where id = true;
