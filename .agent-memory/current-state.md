# Current state

Last updated: 2026-08-08T15:26:00Z

- Branch: `remediation/gridex-ops-full-integrity-performance`
- Draft PR: `#90`
- Current CI HEAD: `bc3479574904ae886916aed28209bf68dfc76264`
- Active finding: `GRIDEX-REM-002`
- Status: `IMPLEMENTED_NOT_VERIFIED`

At `bc3479...`, verify/provenance/typecheck/targeted regressions/security all PASS. Clean replay also confirms the complete checksum-pinned `20260611100000_energy_resolver_grid_area_operations.sql` now executes successfully: replay passes the former `platform_grid_owners` failure and advances through the actor-readiness migrations to `20260615203000_platform_go_live_route_resolver_message_center.sql`.

Current first failure: `20260615203000_platform_go_live_route_resolver_message_center.sql:248`, `relation public.legal_text_versions does not exist`.

Root cause: base derived artifact `bootstrap/20260613_powers_of_attorney_customer_site_foundation.sql` is sourced from `20260613090000_batch_m_ops_master_legal_readiness.sql`, so normal substitution skips the complete Batch M migration. Batch M owns `legal_text_versions`, `customer_legal_acceptances` and the related legal/readiness views used by later canonical migrations.

Current work overrides that existing derived artifact with `preserveSourceReplay=true`. Its narrow, idempotent `powers_of_attorney.customer_site_id` prerequisite still executes early, while the complete immutable Batch M source is restored to chronological replay at `20260613090000`. No live Supabase write is introduced.

Next: verify exact-HEAD PR #90 CI and continue only from the next actual clean-replay error. REM-002 stays open until replay + schema fingerprint + all same-HEAD gates are green.
