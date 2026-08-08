# Current task

Last updated: 2026-08-08T15:41:00Z
Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

## Active finding
`GRIDEX-REM-002` — deterministic canonical empty-database replay.

Status: `IMPLEMENTED_NOT_VERIFIED`

Current CI HEAD `3cf290d86b07960eb6058d788a911621e99599a5`: verify/provenance/typecheck/regressions/security PASS. Complete Batch M now begins chronological replay.

Exact failure: `20260613090000_batch_m_ops_master_legal_readiness.sql:378`, `column mp.ediel_metering_point_id does not exist`.

Verified root cause: Batch M readiness SQL reads `metering_points.ediel_metering_point_id`, while canonical forward/idempotent `20260708210000_website_application_canonical_dispatch_alignment.sql` adds that column only later.

Current implementation: interleave a nine-line schema-only prerequisite immediately before Batch M; create only the source-defined `ediel_metering_point_id` column and use `preserveSourceReplay=true` so the complete 20260708210000 source remains in its chronological position.

Known independent merge blocker: `lib/website/customerApplications.ts` is >2500 handwritten production lines and requires behavior-preserving extraction before final merge.

Exact next action: inspect PR #90 CI on the new HEAD and use only the next first SQL error if replay fails. On replay success, confirm fingerprint, then complete the large-file gate and final bounded release verification.
