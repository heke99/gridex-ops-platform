# Remediation handover — GRIDEX-REM-002

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`
Current CI HEAD: `bc3479574904ae886916aed28209bf68dfc76264`

Verified on current HEAD: verify/provenance/typecheck/targeted regressions/security PASS. Clean replay FAIL. REM-002 not VERIFIED.

The `preserveSourceReplay` correction for the Energy Resolver source is CI-proven: full `20260611100000_energy_resolver_grid_area_operations.sql` now replays, the former `platform_grid_owners` blocker is gone, and replay advances to `20260615203000_platform_go_live_route_resolver_message_center.sql:248`.

Current failure is `relation public.legal_text_versions does not exist`. The table is defined in checksum-pinned `20260613090000_batch_m_ops_master_legal_readiness.sql`, but that complete source is skipped because the early derived `bootstrap/20260613_powers_of_attorney_customer_site_foundation.sql` references it.

Current implementation overrides that existing derived artifact with `preserveSourceReplay=true`. This keeps the early idempotent `powers_of_attorney.customer_site_id` prerequisite while restoring complete Batch M to chronological replay. No live Supabase mutation occurs.

Next: inspect exact-HEAD CI, continue only from a real replay error until replay + schema fingerprint pass; then verify all same-HEAD release gates, mark REM-002 VERIFIED, run the single bounded release rescan, update final memory/reports and merge PR #90 when green.
