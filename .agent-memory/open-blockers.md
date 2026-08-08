# Open blockers

Last updated: 2026-08-08T14:57:00Z

`GRIDEX-REM-002` clean replay remains the active blocker.

Last verified HEAD `a2189aa684f1bc65149d15e283723b2f75875858`: verify/provenance/security PASS; replay FAIL inside `20260520_onboarding_billing_auxiliary_foundation.sql` because DB1's older billing-export table shape was not additively reconciled before the source index.

The corrected checksum-bound auxiliary artifact now adds the source billing columns/FK/defaults/indexes/RLS while preserving DB1 compatibility columns and seeds no rows. It awaits CI.

PR #90 remains draft/unmerged until REM-002, final rescan, all remaining audit/remediation items and final same-HEAD release gates are green.
