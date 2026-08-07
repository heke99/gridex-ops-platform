# Open blockers

Last updated: 2026-08-07T15:45:00Z

## PHASE-46 blockers

1. Apply `20260807154500_gridex_ops_bl_006_contacts_and_lookup_cache_read_isolation`
   on non-production and run the SQL two-tenant rollback regression.
2. Exact-head CI and `/admin/network-owners` import-history smoke after merge.
3. Run clean dependency-backed typecheck, tests, lint and production build where
   `node_modules` can be installed.
4. O-008 remains open: `actor_readiness_status` authenticated SELECT can
   under-count for non-admin JWT; current app uses service role — remediate
   separately without bundling into BL-006.

## Inherited blockers

Live quote/legal E2E, SVK import, webhook, emergency-access, Ediel and broader
production E2E items remain separate and are not closed by PHASE-46.
