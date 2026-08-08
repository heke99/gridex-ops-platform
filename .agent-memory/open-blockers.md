# Open blockers

Last updated: 2026-08-08T15:08:00Z

`GRIDEX-REM-002` clean replay remains the active blocker.

Last verified HEAD `6304e65110544082559320863c0e717f7cf8256c`: verify/provenance/security PASS; replay reaches `20260612160000` and fails because `platform_usage_events` is created only by later tracked migration `20260612193000`.

The replay engine now has an implemented `preserveSourceReplay` prerequisite mode and a checksum-bound platform-usage table artifact. CI must prove that the artifact runs before 121600 while the full 121930 source still executes later.

PR #90 remains draft/unmerged until REM-002, final rescan, all remaining audit/remediation items and final same-HEAD release gates are green.
