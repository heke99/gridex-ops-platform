# Current state — database reconstruction, 2026-09-14

Status: PARTIAL. Main/release acceptance remains blocked.

## Verified current facts

- PR #310 source `dbb090ce19939c7735b012749155617d86a9e9fd` has native
  privacy VERIFIED and disposal VERIFIED (run34783208278/job103793862831).
  The older five source-writer provenance gaps are superseded, not open.
- The same source passed native Ediel FK qualification (run34783208530).
  Its exact CLI-generated forward file is now integrated into migration
  selection: 601 source files, 144 foundation stages and 514 timestamp stages.
  Integrated native FK qualification and all nine publication self-test scripts
  passed in run34787275348. Published code:4f45b185579dddadb702189cc4d0454eb17b58fd.
  Full-chain and managed Supabase acceptance are still required.
- Read-only connected Supabase catalog inspection confirmed all seven disputed
  company fields and their white-label FK exist live. Preserve them. The live
  Ediel key is the historical all-columns SET NULL predecessor, with zero
  orphan/cross-company customer references at inspection.
- The actual live Supabase ledger had279 rows, latest20260904222450. The older
  48-row August fixture is not current live ledger evidence.

## Active work and next action

Verify the registered customer-only Ediel detach migration on the full source
chain. Reconcile full schema semantics (including grants, RLS and indexes)
against an independently verified reference. Repair the supported managed
Supabase execution/ledger path. Only then regenerate schema/type artifacts,
pass all required checks and merge the exact verified head. No artificial
fingerprint match, weakened privacy gate or fabricated applied ledger.

Evidence: `quality/audits/DB_EDIEL_FORWARD_2026-09-14.md`.
The previous source/API baseline and paused partner/API patch remain intact.
No production database mutation or application deployment in this patch.
