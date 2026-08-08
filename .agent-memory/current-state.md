# Current state

Last updated: 2026-08-08T14:57:00Z

- Branch: `remediation/gridex-ops-full-integrity-performance`
- Draft PR: `#90`
- Last verified CI HEAD: `a2189aa684f1bc65149d15e283723b2f75875858`
- Active finding: `GRIDEX-REM-002`
- Status: `IMPLEMENTED_NOT_VERIFIED`

At `a2189a...`, verify/provenance/typecheck/targeted regressions/security all PASS. Clean replay FAILS inside the derived 20260520 auxiliary foundation because DB1 already created billing export tables with an older compatible shape.

Current work changes that derived artifact from create-only assumptions to additive DB1/source convergence. It preserves the DB1 compatibility columns while adding the source-defined `billing_export_run_id`, readiness/payload fields, source defaults/not-null constraints, FK/indexes and RLS. Live dev confirms both historical identities coexist in the final canonical billing-export item table.

Corrected auxiliary SHA-256: `2b35100fb19b805d5aaabd7404c43574fddc3cb3950b7a200f074cd7cd2476fc`.

Next: push the corrected artifact, inspect exact-HEAD PR #90 CI, and continue from the next exact replay failure. REM-002 stays open until replay + schema fingerprint + all same-HEAD gates are green.
