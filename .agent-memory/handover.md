# Remediation handover — GRIDEX-REM-002

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`
Last verified CI HEAD: `6304e65110544082559320863c0e717f7cf8256c`

Verified: verify/provenance/security PASS. Clean replay FAIL. REM-002 not VERIFIED.

The corrected DB1/20260520 billing reconciliation is CI-confirmed and replay now reaches `20260612160000`. Current lineage defect: `20260612160000` reads `platform_usage_events`, but its creator is later `20260612193000`.

Current implementation introduces an interleaved exact table prerequisite after 121430/before 121600 and replay metadata `preserveSourceReplay=true`. This is deliberately different from source substitution: the full checksum-pinned 121930 migration remains in normal replay and applies its RLS/index/governance/cleanup changes later. No usage data or live Supabase state changes.

Next: push, inspect exact-HEAD CI, continue from first replay error until replay + schema fingerprint pass; then verify all same-HEAD gates, mark REM-002 VERIFIED, run final campaign rescan, close remaining findings, and merge only when the complete release gate is green.
