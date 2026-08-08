# Remediation handover — GRIDEX-REM-002

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`
Last verified CI HEAD: `a2189aa684f1bc65149d15e283723b2f75875858`

Verified: verify/provenance/security PASS. Clean replay FAIL. REM-002 not VERIFIED.

Current failure is inside the 20260520 auxiliary bootstrap, not a tracked migration: DB1 already creates billing export tables with the older `export_run_id`/`payload` shape, so source `CREATE TABLE IF NOT EXISTS` semantics do not add `billing_export_run_id`/`readiness_status`/`payload_snapshot` before source indexes.

Current implementation changes the derived bootstrap to additive reconciliation: preserve DB1 columns, add source-defined columns/FK/defaults/not-null/indexes/RLS on the empty replay. Live dev confirms the final table legitimately contains both billing export run identifiers.

Next: push corrected artifact, inspect exact-HEAD CI, continue from first replay error until replay + schema fingerprint pass; then verify all same-HEAD gates, mark REM-002 VERIFIED, run final campaign rescan, resolve remaining findings, and merge only when the complete release gate is green.
