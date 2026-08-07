# PHASE-46 handover — residual BL-002 variants (BL-006)

Main received quote/price-area integrity (`#85`) after BL-002 (`#84`). This
branch remediates residual broad authenticated SELECTs on contacts and lookup
caches, plus the related admin import-history silent-empty path.

## What changed on 6fc0

- Migration `20260807154500_gridex_ops_bl_006_contacts_and_lookup_cache_read_isolation.sql`
- Checksum in `scripts/migration-history-manifest.additions.json`
- Static/SQL regressions under `scripts/gridex-ops-bl-006-*`
- `/admin/network-owners` import history uses `supabaseService` after the
  platform-admin gate
- Remediation report `quality/remediation/GRIDEX_OPS_BL_006_CONTACTS_AND_LOOKUP_CACHE_READ_ISOLATION.md`

## Verification completed

- `npm run gridex:ops-bl-006-contacts-lookup-cache-isolation-regression`
- `npm run db:migrations:integrity`

## Resume

1. Merge this PR after review.
2. Apply migration on non-production and run the SQL rollback regression.
3. Smoke `/admin/network-owners` import history and contact export.
4. Schedule O-008 (`actor_readiness_status`) separately; keep consumers on
   service role until then.

## Do not claim yet

- staging SQL two-tenant rollback;
- full npm typecheck/test/lint/build;
- VERIFIED_CLOSED for BL-006;
- O-008 closed.
