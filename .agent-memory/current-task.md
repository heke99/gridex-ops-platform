# Current task

Last updated: 2026-08-08T13:40:00Z
Branch: `remediation/gridex-ops-full-integrity-performance`
PR: `#90`

## Active finding

`GRIDEX-REM-002` — canonical migration lineage and deterministic empty-database replay.

Status: `IMPLEMENTED_NOT_VERIFIED`

## Evidence

On HEAD `c627f81024e9c166aab5b9189192f54e160c0190`, `verify` is green,
including the production dependency audit, while `clean-migration-replay` fails.

The CI evidence artifact identifies the first failure as:

- migration: `20260609100000_batch_1_2_5_3_capway_invoice_foundation.sql`
- line: 17
- error: `relation "public.pricing_component_rules" does not exist`
- prerequisite: pre-ledger `pricing_component_rules` foundation

Live `gridex-ops-dev` and the immutable source
`20260520_batch_3_4_onboarding_pricing_billing_engine.sql` agree on the base
relation and indexes.

## Implemented in this work unit

- add `supabase/bootstrap/20260520_pricing_component_rules_foundation.sql`;
- register its checksum and source in the derived-bootstrap additions;
- insert it into the explicit canonical foundation order;
- document the exact CI failure and reconciliation.

## Exact next action

After push, inspect PR #90 CI for the new HEAD. If clean replay fails, read the
new artifact/log and remediate the next exact failure. If clean replay passes,
verify `verify`, security audit, provenance gate and replay on that same HEAD
before changing `GRIDEX-REM-002` to VERIFIED.
