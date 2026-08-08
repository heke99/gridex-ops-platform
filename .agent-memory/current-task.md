# Current task

Last updated: 2026-08-08T14:57:00Z
Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

## Active finding
`GRIDEX-REM-002` — deterministic canonical empty-database replay.

Status: `IMPLEMENTED_NOT_VERIFIED`

Last verified HEAD `a2189aa684f1bc65149d15e283723b2f75875858`: all verify/provenance/security gates PASS; clean replay FAIL.

Current exact failure occurs inside `bootstrap/20260520_onboarding_billing_auxiliary_foundation.sql`: DB1 already created `billing_export_run_items` with `export_run_id`; create-if-absent does not add the source `billing_export_run_id`, so its source index fails.

Current implementation reconciles the DB1/source billing shapes additively while preserving compatibility columns. Corrected artifact SHA-256: `2b35100fb19b805d5aaabd7404c43574fddc3cb3950b7a200f074cd7cd2476fc`.

Exact next action: push, inspect PR #90 CI on the new HEAD, and use the next clean-replay artifact's first exact SQL error if it fails. On success, confirm final schema fingerprint plus all same-HEAD gates before REM-002 VERIFIED.
