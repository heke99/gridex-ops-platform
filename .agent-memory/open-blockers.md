# Open blockers

Last updated: 2026-08-08T14:48:00Z

`GRIDEX-REM-002` clean replay remains the active blocker.

Last verified HEAD `02e0dca29584fd6854e117f03043382b9a709f77`: verify/provenance/security PASS; replay FAIL at `20260612123000...:593` because `public.customer_info_requests` is absent.

The root cause is broader than one table: the checksum-pinned pre-ledger 20260520 onboarding/billing source is substituted, while prior derived artifacts covered only part of its schema. The comprehensive schema-only auxiliary reconstruction is implemented and awaits CI.

PR #90 remains draft/unmerged until REM-002, final rescan, all remaining audit/remediation items and final same-HEAD release gates are green.
