-- Post-replay operation, not migration-ledger repair. Recompute the persisted
-- August snapshot using the final actual catalog before exercising real writers.
-- The caller supplies the tail of its checksum-verified executed SQL plan.
SELECT 'readiness_before' AS evidence, to_jsonb(r) AS value
FROM public.platform_runtime_readiness r;
SELECT 'readiness_live_catalog' AS evidence, to_jsonb(r) AS value
FROM public.gridex_runtime_schema_capabilities_v3 r;
SELECT 'readiness_after' AS evidence, to_jsonb(r) AS value
FROM public.gridex_refresh_platform_runtime_readiness_v1(
  '20260803093300-gridex-runtime-readiness-v3',
  'owned-clean-replay', :'replay_migration_version'
) r;
DO $$
BEGIN
 IF NOT EXISTS (
  SELECT FROM public.platform_runtime_readiness p
  CROSS JOIN public.gridex_runtime_schema_capabilities_v3 c
  WHERE p.id AND p.is_ready AND c.is_ready
   AND p.blocking_issues='[]'::jsonb AND coalesce(cardinality(c.blocking_issues),0)=0
   AND p.schema_version='20260803093300-gridex-runtime-readiness-v3'
   AND p.schema_fingerprint=c.schema_fingerprint
   AND p.capabilities=c.capabilities
 ) THEN
  RAISE EXCEPTION 'replayed_runtime_catalog_not_ready_or_snapshot_mismatch';
 END IF;
END $$;
