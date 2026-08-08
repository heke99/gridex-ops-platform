# Remediation handover — GRIDEX-REM-002

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`
Last verified CI HEAD: `4cbea122dce56f08da67bd4b4df0798c8ad5349a`

Verified: verify/provenance/security PASS. Clean replay FAIL. REM-002 not VERIFIED.

The replay engine's `preserveSourceReplay` mode is CI-proven. Current failure is `20260613100000...:85`, where `platform_grid_owners` is absent because the complete `20260611100000_energy_resolver_grid_area_operations.sql` source was being skipped after two narrow prerequisites referenced it.

Current implementation marks both 20260611-derived prerequisites `preserveSourceReplay=true`. This keeps their early prerequisite effects but restores the complete immutable Energy Resolver migration to chronological replay, including platform grid-owner/grid-area/geodata/cache/import/resolver schema and source policies/functions. No live Supabase mutation occurs.

Next: push, inspect exact-HEAD CI, continue from first replay error until replay + schema fingerprint pass; then verify all same-HEAD gates, mark REM-002 VERIFIED, run final campaign rescan, close all remaining findings, and merge only when the complete release gate is green.
