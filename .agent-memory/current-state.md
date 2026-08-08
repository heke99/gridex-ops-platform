# Current state

Last updated: 2026-08-08T15:41:00Z

- Branch: `remediation/gridex-ops-full-integrity-performance`
- Draft PR: `#90`
- Current CI HEAD: `3cf290d86b07960eb6058d788a911621e99599a5`
- Active finding: `GRIDEX-REM-002`
- Status: `IMPLEMENTED_NOT_VERIFIED`

At `3cf290...`, verify/provenance/typecheck/targeted regressions/security all PASS. Clean replay proves the complete checksum-pinned `20260613090000_batch_m_ops_master_legal_readiness.sql` now executes, but it fails inside Batch M while creating readiness views because `metering_points.ediel_metering_point_id` is not yet present.

Exact first failure: `20260613090000_batch_m_ops_master_legal_readiness.sql:378`, `column mp.ediel_metering_point_id does not exist`.

Verified source: canonical forward/idempotent `20260708210000_website_application_canonical_dispatch_alignment.sql` adds `metering_points.ediel_metering_point_id`. Batch M reads that canonical identifier earlier than the historical migration that creates it.

Current implementation adds a narrow interleaved prerequisite immediately before Batch M that creates only `metering_points.ediel_metering_point_id`, with `preserveSourceReplay=true` so the complete immutable 20260708210000 source still replays normally later. No live Supabase write and no historical migration edit.

Separately, the final large-file release gate is confirmed red: handwritten production file `lib/website/customerApplications.ts` extends beyond 3,500 lines and must be split to <=2,500 before merge.

Next: verify exact-HEAD replay after the prerequisite; continue only from an actual replay error. When replay/fingerprint pass, close REM-002, complete the required large-file split, perform the single bounded release rescan and merge when all same-HEAD gates are green.
