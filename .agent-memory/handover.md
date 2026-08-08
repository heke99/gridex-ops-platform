# Remediation handover — GRIDEX-REM-002

Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`
Last verified CI HEAD: `5212e454f7c8feca30732cd9d3122bd8eaf62728`

## Verified state

- `verify`: PASS.
- migration integrity/provenance regression: PASS.
- `security:audit-production`: PASS.
- `clean-migration-replay`: FAIL.
- NanoID remains resolved at `3.3.17`.
- `GRIDEX-REM-002` is not VERIFIED.

## Replay progress

CI has confirmed the pricing-component and communication-log reconstruction fixes advance replay.

Current exact failure:

- migration: `20260611150000_launch_readiness_security_routes_stats.sql`
- line: 451
- error: `relation "public.external_contract_intakes" does not exist`

The checksum-pinned pre-ledger source `20260521_batch_2c_end_to_end_operations.sql` creates the canonical base relation; live dev confirms the same base plus later additive columns.

## Current implementation

`supabase/bootstrap/20260521_external_contract_intakes_foundation.sql` restores only the source relation, initial status/idempotency constraints, base company/status index and source RLS policies after RBAC helper foundation. It seeds no data and does not modify live Supabase or historical migration SQL.

## Next deterministic action

1. Push the current work-unit commit.
2. Read PR #90 CI for that exact HEAD.
3. If replay fails, download the new artifact and use its first SQL failure as the next finding.
4. Repeat until clean replay passes.
5. Verify `verify`, provenance, security, replay and schema fingerprint on the same final HEAD.
6. Only then mark `GRIDEX-REM-002` VERIFIED and continue immediately to database/code full consistency.
