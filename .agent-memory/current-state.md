# Current state

Last updated: 2026-08-08T13:40:00Z

## Active remediation campaign

- Branch: `remediation/gridex-ops-full-integrity-performance`
- Draft PR: `#90`
- Baseline: `5923b5c17fe96c0453048bdc102203efb65f7d7a`
- Last observed pre-fix HEAD: `c627f81024e9c166aab5b9189192f54e160c0190`
- Active finding: `GRIDEX-REM-002` canonical migration lineage / empty-database replay.
- Lifecycle state: `IMPLEMENTED_NOT_VERIFIED`.

This campaign supersedes the older PHASE-45 task as the active work item. Historical
PHASE-45 state remains available in Git history.

## Same-HEAD CI evidence before the current replay fix

At `c627f81024e9c166aab5b9189192f54e160c0190`:

- `verify`: PASS.
- `security:audit-production`: PASS.
- `clean-migration-replay`: FAIL.

The NanoID production advisory is resolved in the lockfile: the transitive path is
Next -> PostCSS -> NanoID, and `nanoid` resolves to `3.3.17` without a direct
`package.json` dependency.

## Current clean-replay failure and remediation

The PR #90 clean-replay artifact reports the first failure at
`20260609100000_batch_1_2_5_3_capway_invoice_foundation.sql:17`:

`ERROR: relation "public.pricing_component_rules" does not exist`

The checksum-pinned pre-ledger source
`20260520_batch_3_4_onboarding_pricing_billing_engine.sql` defines that relation.
Live `gridex-ops-dev` confirms the relation, source-defined base columns/indexes,
and the three columns later added by `20260609100000`.

The current work unit adds a narrow checksum-bound derived bootstrap for only
`pricing_component_rules` and its source-defined base indexes. It does not edit
historical migration SQL and does not mutate the live database.

## Next deterministic action

Push this work unit, read the new PR #90 clean-replay result, and continue from
the next exact SQL failure. Do not mark `GRIDEX-REM-002` VERIFIED until clean
replay and `verify` both pass on the same final HEAD.
