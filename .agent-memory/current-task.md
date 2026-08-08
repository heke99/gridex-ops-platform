# Current task

Last updated: 2026-08-08T15:26:00Z
Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

## Active finding
`GRIDEX-REM-002` — deterministic canonical empty-database replay.

Status: `IMPLEMENTED_NOT_VERIFIED`

Current CI HEAD `bc3479574904ae886916aed28209bf68dfc76264`: verify/provenance/typecheck/regressions/security PASS; clean replay advances through the previously missing Energy Resolver platform schema and now reaches `20260615203000`.

Exact failure: `20260615203000_platform_go_live_route_resolver_message_center.sql:248`, `relation public.legal_text_versions does not exist`.

Verified root cause: `bootstrap/20260613_powers_of_attorney_customer_site_foundation.sql` references `20260613090000_batch_m_ops_master_legal_readiness.sql`, causing normal derived-source substitution to skip the full Batch M source that creates `legal_text_versions` and related canonical legal/readiness schema.

Current implementation: override the existing 20260613 artifact metadata with `preserveSourceReplay=true`. The early `customer_site_id` prerequisite remains, while the complete checksum-pinned, idempotent Batch M migration executes at its natural timestamp.

Exact next action: inspect exact-HEAD PR #90 CI and use only the next first SQL error if replay fails. On replay success, confirm final fingerprint and all same-HEAD gates before REM-002 VERIFIED.
