# Current state

Updated: 2026-09-16
Status: IN_PROGRESS

Active task: complete PR310 and merge to main only after required verification.
Active subtask: register the two fully qualified permission/Storage forwards,
then verify the expanded ordinary native replay, schema, genuine types and CI.

## Verified and preserved

- PR310 is `codex/gridex-parity-remediation-20260905`. This batch follows
  `1ad24a17f8c83500f0638bb66f8ed292a02937c9`; main is `de098106` through PR312.
  Prior commits, original migration bytes and independent references are preserved.
- The OID JSON comparison repair `8297f2e3` is verified by full clone run35080283797,
  job104742368525, which finished SUCCESS on2026-09-16 at09:53:22Z.
- Actual SQL proof: all129 permission decisions,24 changed-function behaviors,
  exact8 function definitions/metadata, ACLs, repeat, ACL poison/recovery and
  complete per-case catalog/row/ledger rollback passed. The two-policy narrowing
  also reproduced the unchanged S21 denial before repair and negative poisoning,
  then recovered with no other catalog/row/ledger changes. Parent/source and
  owned cleanup preservation passed. This is not full native release acceptance.
- Official Supabase CLI2.101.0 generated both new identities only after that proof:
  `20260916095318_restrict_grid_owner_storage_policy_roles.sql` and
  `20260916095319_canonical_permission_overrides_and_storage_write_guards.sql`.
  The registered migration bytes exactly equal the qualified candidates.
- Origin proof artifact10440317323 ZIP SHA256
  `dd0cdfbf83b93d0a68ee13d4cc2d37fd7254d099207814e8b72ab26c74912300`.
  CLI artifact10439749327 ZIP SHA256
  `6fc1fb52215782286d9e5f504412ca3663fad1d40cc0af1a8b53e2e665761831`.
  Sanitized, pinned proof and CLI receipts are retained in
  `quality/audits/ediel-masterplan-v2/`; current CI must still execute anew.
- Twelve exact registered forwards are kept separate from the unchanged144
  foundation and514 historical timestamp inputs. No historical migration is
  marked applied without actual CLI execution and a verified native ledger.
- The post-promotion full-clone route requires all129 cases again, all24 positive
  function cases, repeat of both forwards, exact Storage negative/recovery and
  full ACL poison/recovery with every original rollback requirement intact.
- The previously broken status contract was restored in1ad24a17 without weakening
  its test. The following measured counts reflect the two newly registered inputs.
- No production mutation has been performed in this replay-verification batch.
  Supabase access during the OID subtask was a read-only constant/role-type query.

## Executable inventory status

Working-tree accounting is 613 inputs: 601 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.
The focused group contains 352 inputs: 340 selected, 2 substituted, 5 unclassified, and 5 excluded.

These inventory counts are not complete-source-effect or native-ledger acceptance.
Push reviewed, coherent batches stepwise as requested.

## Remaining gates and exact next action

Publish this coherent promotion batch, read back its tree, and inspect the new
ordinary replay and full-clone runs. The earlier ordinary run35076321094 failed
can_override_allow/can_override_deny before promotion; do not reuse that result
as evidence for the new head. Full native/schema/type results are still required.

Keep the tested head stable while clean-migration-replay runs: superseding PR
pushes cancel the prior OPS run. Earlier native run35076321331 was CANCELLED,
not accepted; its partial timestamp218 progress is not a complete replay.

Review all schema differences against independently retained source decisions.
Generate genuine types only from the complete qualified owned database and update
the manifest from that artifact, never simply change its migration-tail string.
Require the final current-head CI checks before removing draft and merging PR310.

PR310 remains open/draft and is not merged. No release acceptance, production
mutation, deployment or external market message is implied by this batch.
