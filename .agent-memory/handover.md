# Remediation handover — GRIDEX-REM-002

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`
Current CI HEAD: `3cf290d86b07960eb6058d788a911621e99599a5`

Verified on current HEAD: verify/provenance/typecheck/targeted regressions/security PASS. Clean replay FAIL. REM-002 not VERIFIED.

The Batch M source-preservation correction is working: complete checksum-pinned `20260613090000_batch_m_ops_master_legal_readiness.sql` now executes. Its current first failure is line 378 because `metering_points.ediel_metering_point_id` is absent when Batch M builds readiness views.

Canonical source `20260708210000_website_application_canonical_dispatch_alignment.sql` later adds that exact column using `add column if not exists`. Current implementation adds only that column as an interleaved prerequisite after 20260612203000 and before Batch M, while `preserveSourceReplay=true` keeps the complete July source for normal later replay. No live Supabase mutation or historical source edit occurs.

Independent final DoD blocker: handwritten `lib/website/customerApplications.ts` is confirmed >3,500 lines and must end <=2,500 through behavior-preserving module extraction.

Next: inspect exact-HEAD CI; continue only from a real replay error until replay + fingerprint pass. Then close REM-002, complete large-file split, run the single bounded release rescan, update final reports/memory and merge PR #90 when all same-HEAD gates are green.
