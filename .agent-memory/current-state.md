# Current state

Updated: 2026-09-15

Active task: finish PR310 and merge to main only after the required verification. This supersedes the earlier instruction to defer database work.

## Published and preserved

- PR310: codex/gridex-parity-remediation-20260905. The 20 continuation commits through8c943b61 are preserved by fast-forward. PR312 independent Ediel work is already on main de098106. This reconciliation merges that main into PR310, not PR310 into main.
- F05-F12 full permission fixture now checks exact company membership/role rosters under the retained August26 policy, plus zero foreign and global rows. All original write/column-ACL/SQLSTATE denials and rollback checks remain. No RLS grants or production permissions were broadened.
- Offline tests:8 full-seed +10 clone-boundary +10 original native-fixture PASS. Full database qualification run35025303437 on a27d4329 was started; inspect its actual result before promotion.
- Both pre-reconciliation current-state documents are retained verbatim under .agent-memory/archive/. Appended historical evidence from both branches is preserved.

## Remaining gates

The permission candidate has not been promoted. Require complete129-case clone qualification and24 behavior cases; then a genuine new forward identity, source/provenance updates, full native replay, explicit schema review, genuine generated types and all required CI. A portable replay pass is not native/schema/type release acceptance. Do not mark these gates green from an offline fixture pass.

PR310 is not merged to main. No live database mutation, production deployment or market message is authorized by this integration receipt or was performed by its script.
