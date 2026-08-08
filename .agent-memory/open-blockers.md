# Open blockers

Last updated: 2026-08-08T15:41:00Z

1. `GRIDEX-REM-002` clean replay remains active. On current CI HEAD `3cf290d86b07960eb6058d788a911621e99599a5`, verify/provenance/typecheck/regressions/security PASS; replay fails inside complete Batch M because `metering_points.ediel_metering_point_id` has not yet been created. The current fix interleaves only that source-defined column before Batch M while preserving full 20260708210000 replay.

2. Final large-file release gate is red: handwritten production file `lib/website/customerApplications.ts` is >3,500 lines; campaign DoD requires all in-scope handwritten production files <=2,500 before merge.

PR #90 remains draft/unmerged until replay/fingerprint, the large-file gate, bounded final release rescan and all final same-HEAD required checks are green.
