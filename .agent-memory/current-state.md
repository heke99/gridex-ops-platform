# Current state

Last updated: 2026-08-08T14:07:00Z

## Active remediation campaign

- Branch: `remediation/gridex-ops-full-integrity-performance`
- Draft PR: `#90`
- Baseline: `5923b5c17fe96c0453048bdc102203efb65f7d7a`
- Last verified CI HEAD: `5212e454f7c8feca30732cd9d3122bd8eaf62728`
- Active finding: `GRIDEX-REM-002` canonical migration lineage / empty-database replay.
- Lifecycle state: `IMPLEMENTED_NOT_VERIFIED`.

## Same-HEAD CI evidence

At `5212e454f7c8feca30732cd9d3122bd8eaf62728`:

- `verify`: PASS.
- migration integrity/provenance regression: PASS.
- typecheck/targeted regressions: PASS.
- `security:audit-production`: PASS.
- `clean-migration-replay`: FAIL.

## Replay progress

The pricing-component and communication-log reconstruction fixes are confirmed by CI to move replay forward.

Current first failure:

- migration: `20260611150000_launch_readiness_security_routes_stats.sql`
- line: 451
- error: `relation "public.external_contract_intakes" does not exist`
- missing prerequisite: pre-ledger external contract intake foundation from `20260521_batch_2c_end_to_end_operations.sql`

Live `gridex-ops-dev` confirms the source-defined base intake model followed by later additive columns.

The current work unit adds a checksum-bound derived foundation for only `external_contract_intakes`, its base index and source RLS policies after the RBAC helper foundation. It seeds no rows, edits no historical migration, and performs no live DB write.

## Next deterministic action

Commit/push this foundation, read PR #90 CI on the exact new HEAD, and continue from the next exact replay failure. Do not mark `GRIDEX-REM-002` VERIFIED until clean replay and `verify` are green on the same final HEAD and the schema fingerprint passes.
