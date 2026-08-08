# Current state

Last updated: 2026-08-08T15:20:00Z

- Branch: `remediation/gridex-ops-full-integrity-performance`
- Draft PR: `#90`
- Last verified CI HEAD: `4cbea122dce56f08da67bd4b4df0798c8ad5349a`
- Active finding: `GRIDEX-REM-002`
- Status: `IMPLEMENTED_NOT_VERIFIED`

At `4cbea1...`, verify/provenance/typecheck/targeted regressions/security all PASS. Clean replay also proves `preserveSourceReplay` works: early `platform_usage_events` prerequisite runs before 121600 and the complete 121930 source still runs later.

Replay now reaches `20260613100000_actor_auto_readiness_certificates.sql:85` and fails because `public.platform_grid_owners` is absent.

Root cause: checksum-pinned `20260611100000_energy_resolver_grid_area_operations.sql` owns the complete platform grid-owner/grid-area/geodata/cache/import/resolver family but was excluded because two narrow foundation artifacts use it as their source.

Current work sets `preserveSourceReplay=true` for both 20260611 derived prerequisites. They still execute early, while the full immutable Energy Resolver migration is restored to its normal chronological replay position. No duplicate source SQL or live DB write is introduced.

Next: push, inspect exact-HEAD PR #90 CI, and continue from the next exact replay failure. REM-002 stays open until replay + schema fingerprint + all same-HEAD gates are green.
