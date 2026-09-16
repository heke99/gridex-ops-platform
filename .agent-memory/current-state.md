# Current state

Updated: 2026-09-16
Status: IN_PROGRESS

Active task: complete PR310 and merge to main only after required verification.
Active subtask: integrate the verified RPC/index/ordinal corrections and the
source-bound forward10 LOCK correction, then complete native/schema/types/CI.
Also review remaining PRs without reintroducing obsolete code or temporary probes.

## Verified and preserved

- PR310 is `codex/gridex-parity-remediation-20260905`. This batch follows
  `43f39822a3e3df4909e32b7a4eecbbf8fee56836`; main is `de098106` through PR312.
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

## Latest continuation evidence

- The clean qualified branch contains767966d3 (exact promoted RPC witness),
  4702d036 (index CASE/deparser fixes) and43f39822 (twelve-forward CLI admission).
  All are descendants of4c7b3a1a, with no migration or reference rewrite.
- Portable run35093927540 on4702d036 reaches144/514/12, the RPC witness, views,
  all24 function cases, five index definitions/twelve cases and18/18 final SQL
  assertions. It then fails the full schema comparison. The independent diff is
  collected; no schema acceptance is inferred from that diagnostic.
- Original OPS native run35086800997 is FAILED, not still running:144 foundation,
  514 timestamp and9 forward inputs; forward10 stops in FAILURE_CONTROLS. All
  owned cleanup is verified. No genuine application-type artifact was produced.
- Isolated native run35097129294 proves top-level LOCK25P01 and corrected DO
  context, post-body/ledger rollback, real CLI ledger, lock/settings lifetime and
  repeat. It is a synthetic transaction test, not whole-source/tenant acceptance.
- The new adapter requires exact original/derived bytes. Ordinary native CI now
  tests its actual compiled wrapper before the full chain. Final-SQL admission
  requires new lock/settings evidence. No old baseline or type manifest is edited.

## Remaining gates and exact next action

Publish/read back the coherent tested descendant onto PR310, never main directly.
Inspect the exact current-head native results; do not reuse run35095406934 on
43f39822 as verification of the later LOCK correction. That run predates this fix.
Keep a complete tested head stable while its expensive native replay runs.

The collected portable schema diff has substantial additive changes as well as
reviewed mappings. Review unsupported objects against authored source intent;
do not bulk-accept observed hashes or replace the independent reference.
Generate genuine types from the complete qualified owned native database and
update the manifest from that artifact, never only its migration-tail string.
Require final current-head CI before removing draft and merging PR310.

PR311 is already merged into PR310. PR312 is already on main. Remaining old PRs
157/209/212/273/288 need equivalence or missing-change review; PR230 is explicitly
a temporary live probe and must not be shipped to main. Do not overwrite evolved
manifests, tests or canonical runtime with old branches merely to close their PRs.

PR310 is not merged. No production database mutation, deployment or external
market message is implied by this batch. These notes do not certify all gates.
