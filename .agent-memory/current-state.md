# Current state

Updated: 2026-09-16
Status: IN_PROGRESS

Active task: complete PR310 and merge to main only after required verification.
Active subtask: verify published OID-to-JSON snapshot repair in full permission
clone run35080283797, then complete forward promotion and subsequent gates.

## Published and preserved

- PR310 is `codex/gridex-parity-remediation-20260905`. Base for this repair is
  `bf9b124ada6dd5b1ed96cf3128ff8c22e2902101`; main is `de098106` through PR312.
  All previous commits, Storage substrate/reference repairs, policy candidate,
  original migration bytes and diagnostic privacy controls are retained.
- Run35076315945 reached 144 foundation and514 timestamp inputs, all10 forward
  inputs and five final SQL checks. It then stopped at
  `STORAGE_POLICY_SCOPE_PREIMAGE_REQUIRED`, not the old foundation42804 error.
- PostgreSQL17 read-only constant query reproduced `to_jsonb(ARRAY[0::oid])`
  as `["0"]`, whereas the Python verifier expected `[0]`. The numeric-to-string
  projection mismatch is repaired at the comparison, including its negative
  snapshot. No PostgreSQL policy, grant, source migration or accepted baseline
  is changed by this repair.
- Local red/green: the updated representation test failed before the fix and
  passed afterward. Six policy-scope,17 clone-boundary,8 full-seed and10
  Storage-bootstrap tests pass. These are offline checks, not129 SQL cases.
- Snapshot repair is published as `8297f2e3d161ca859f72712be4e2bce8333da604`.
  The local tree equals GitHub tree `c939db996572c53e5ccd487aa4676adc2a1d74cb`.
- The unchanged auth/membership group selftest now passes after restoring these
  measured inventory/status declarations and checkpoint pointers.
- No production mutation has been performed in this replay-verification batch.
  Supabase access during this subtask was a read-only constant/role-type query.

## Executable inventory status

Working-tree accounting is 611 inputs: 599 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.
The focused group contains 350 inputs: 338 selected, 2 substituted, 5 unclassified, and 5 excluded.

These inventory counts are not complete-source-effect or native-ledger acceptance.
Push reviewed, coherent batches stepwise as requested.

## Remaining gates and exact next action

Inspect the terminal result of full permission clone run35080283797 on8297f2e3.
Require all129 cases,24 function behaviors,
repeat/ACL recovery, parent/source/row/ledger preservation before candidate
promotion. Then complete forward identity/provenance, native replay, explicit
schema review, genuine generated types and required CI. The ordinary owned replay run35076321094 reached its function witness and
failed at can_override_allow/can_override_deny; its candidate is not yet promoted.
The ordinary clean-migration-replay and full schema comparison require separate
terminal evidence. Do not infer success from an unfinished qualification.

PR310 remains open/draft and is not merged. No release acceptance, production
mutation, deployment or external market message is implied by offline tests.
