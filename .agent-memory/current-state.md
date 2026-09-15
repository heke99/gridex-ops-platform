# Current work — PR310/311 green, merge main, then next Ediel v2 phase

Status: IN PROGRESS. Main has not been merged and the next Ediel phase has not started. User explicitly authorizes fixing and merging the entire PR310 history. PR311 was merged into PR310's feature branch, not main. Main remains eb9a25bc989c6de808903f41c2314d5465e9c07b; PR310 draft/open head remains01ee1d55e515dea336531a3f8820bdf9eafebaf0 until continuation is promoted.

## Current published continuation

Branch codex/ediel-masterplan-v2-alignment-20260915, head fe909783888bf8389d4f6a62c6b5a1aef3bc157b, tree39a4372c9a658e9a446d925b7d4a79e70d10f198. This contains genuine qualified replacement tenth migration20260915183840_drop_inert_inbound_client_policies.sql, SHA5cd56392d5647196fe4f64e7d5a76fe5fa0a3a9a454efcfd34a6d8f754ac86a7. The failed, UNAPPLIED tenth181448 was atomically withdrawn; its original candidate remains archived outside migrations. Original601 migration hashes, historical514 timestamp hashes and first9 forward bytes are unchanged. Selected totals611/rawtimestamp524/fullledger599.

Actual full native01 run34999483575/job104484522245 completed144 foundations+514 timestamps+6 forwards, ledger591; first4 finalSQLPASS, final tenant invariant fails only F14_INERT_POLICY24. Cleanup/private disposal verified. This run is completed, not pending.

Initial isolated policy cleanup passed but full848/554 replay failed at source10/SQLSTATE55000 because six source-authored PUBLIC platform policies were omitted from the isolated fixture. Actual revised qualification35008661212/job104514750830 reproduces oldcandidate55000, passes revisedcandidate exact24 removal with6PUBLIC retained,29negative shapes,22postcondition controls, client denial/service DML/repeat/state preservation and cleanup. Genuine CLI2.101.0 created183840 filename. Local supersession115testsPASS. See merge-inert-policy-public-preservation.md and merge-tenth-forward.md.

Actual intake qualification35009115834 at131dac SUCCESS after fixing fresh standalone owner admission. Two source-first JSONB columns and supported string-array round trips qualified; no PostgREST or arbitrary JSON compatibility claim. Parent integration and exact schema mapping are still in progress.

Actual fe909 portable35009249815/job104516757959 PASS:144foundations+514timestamps+10forwards and ALL5finalSQL with rows/catalog/source preservation and cleanup. This is PORTABLE_FINAL_SQL_PASSED_NOT_CERTIFIED, not native ledger or release acceptance. Retained-history35009250077, auth-action35009249721 and access-capability35009249824 PASS. Schema35009249751/job104516758408 fails only changed-view witness ordinal2: actual=expected7007d704402744b49c4384e7746a69ce815094d90c88e88ed2fc2d2741aa7840, witness771656d1904ef42082dddd849a72dd30908a206a2740d9e8b24da7415c1ab766; other4changedview witnesses now pass. No final comparison/type candidate reached. Do not infer full acceptance from isolated runs. Discover push runs with actions/runs?event=push&head_sha=<SHA>, not closedPR311 metadata.

## Work in progress and remaining gates

Published historical SELECT-star view reconstruction and five-index witnesses await successful full chain. Two changed-function behavior witnesses may expose a real override-resolution defect; do not repair before actual evidence. Policy actor2496 cases,267 identities,59 removed policies and31 added views passed earlier bounded portable runs.

Unpublished release-gate work replaces the ordinary entry's unconditional failure with fresh native receipts, exact source decisions and genuine committed types checks. Dead localhost54322 commands are replaced only by equivalent checks inside the owned native lifecycle. Independent review found the old normalized pg_dump gate also necessary; a new owned dump comparison retains exact mismatch as a separate blocker. Public projection decisions cannot substitute for structures outside that projection. No baseline replacement or inventory-only schema approval.

Independent agents own: finish_index_witness (source/final/dump verifier + native/schema integration); register_forward_ten (intake parent integration); fix_view_witness (finite positive column/index source mappings). Root owns ordinary entry/workflow, publication and memory. Preserve unrelated worktree files; scripts/__pycache__ is untracked intermediate only.

Next action: repair the remaining ordinal2 historical-view witness; then resolve actual function/index results. Review and publish remaining native gate integration. Require complete positive source decisions, dump acceptance, actual CLI application type candidate matching committed types/manifest, final-head CI/E2E/review; promote continuation into310 then merge entire310 to main. Only afterward begin Ediel field327/325 locator/object/register/provider-grant/archive/routing work under masterplan v2.

No live Supabase writes, external Ediel sends or production deployment. Prior read-only dev ledger279/latest20260904222450. Original masterplan33-file manifest and121rules/231contracts retained. Earlier2134tests/218files, typecheck and bounded Ediel fixes are recorded in completed-work/verification-matrix/session-log; they are not full-masterplan acceptance.
