# Remediation handover — GRIDEX-REM-002

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`
Last verified CI HEAD: `c627f81024e9c166aab5b9189192f54e160c0190`

## Verified state

- `verify`: PASS.
- `security:audit-production`: PASS.
- `clean-migration-replay`: FAIL.
- NanoID is transitive through PostCSS and now resolves to `3.3.17`.
- `GRIDEX-REM-002` is not VERIFIED.

## Exact current replay failure

CI artifact `gridex-rem-002-clean-replay`:

- migration: `20260609100000_batch_1_2_5_3_capway_invoice_foundation.sql`
- line: 17
- error: `relation "public.pricing_component_rules" does not exist`
- root cause: replay foundation extracted `metering_permissions` from the
  checksum-pinned `20260520_batch_3_4_onboarding_pricing_billing_engine.sql`
  source but omitted the source-defined `pricing_component_rules` prerequisite.

Live `gridex-ops-dev` confirms the canonical relation and indexes.

## Current implementation

A narrow derived bootstrap now restores only `pricing_component_rules` and its
source-defined base indexes before timestamped history. No rows are seeded, no
historical migration is edited, and no live database migration is applied.

## Next deterministic action

1. Confirm the pushed branch HEAD.
2. Read PR #90 CI for that exact HEAD.
3. If replay fails, download/read the new clean-replay artifact and use its
   first SQL failure as the next finding.
4. Repeat until clean replay passes.
5. Verify `verify`, security and replay on the same final HEAD.
6. Only then update `GRIDEX-REM-002` to VERIFIED and continue immediately to
   database/code full consistency.
