# Verification evidence

Earlier entries are preserved byte-for-byte in [the pre-database-frontier archive](archive/pre-db-frontier-20260912/verification-matrix.md). Current campaign status is only in [current-state.md](current-state.md).

## 2026-09-12 — eacc6d4 database-first batch

| Check | Result | Exact boundary |
| --- | --- | --- |
| Frontier constructor/selection/privacy tests | PASS | 8 foundation +13 timestamp tests locally and native workflow34715245340 |
| Real PostGIS capability and former timestamp45 | PASS | PG170005/PostGIS3.5.2; source unchanged; owned network-disabled target |
| Selected native chain | BLOCKED | All118 foundation and228 timestamp inputs passed; timestamp229 fails42601; job103611207798 |
| Owned-container cleanup | PASS | Same completed job; no managed database used |
| Full effects accounting | BLOCKED, unchanged | 600 inputs;558 selected/23 substituted/14 unclassified/5 excluded; --require-full-effects exit1 |
| App/API/build checks | PASS | OPS34715245359 quality-release-gates103611207992 |
| Full CI/replay/types | NOT ACCEPTED | verify103611207917 and clean replay103611208029 failed; full E2E not accepted |
| Independent review | NOT PERFORMED | No separate reviewer was available in this session |
| Live mutation/merge/deploy | NOT PERFORMED | No production SQL, ledger write, main merge or Vercel deployment |

The broader local accounting/group selftest invocations were interrupted by tool timeouts and are not reported as local passes. The targeted tests above completed. See quality/audits/DB_SELECTED_CHAIN_RECEIPT_2026-09-12.json for exact native-source pins and archive hashes.

## 2026-09-12 — 1d40e33 session reconstruction, superseding the old SQL blocker

| Check | Result | Exact boundary |
| --- | --- | --- |
| New local source/negative tests | PASS | 14 completed locally after cleanup |
| Hosted constructor/source tests | PASS | 35 in run34718792993/job103620685321 |
| Native session boundary proof | PASS | Six groups: original42601, rollback, exact guard/ACL, bad preimage, bounded callers, active replay |
| Entire selected chain | PASS, not canonical acceptance | 118 foundation +508 timestamp stages, all five prerequisite boundaries; same job |
| Owned cleanup | PASS | Same completed job,2026-09-12T21:04:24Z |
| Full source-effect accounting | BLOCKED | Unchanged37 dispositions; --require-full-effects exit1; zero input-contract errors |
| Normal canonical replay/types | NOT ACCEPTED | OPS34718792985 job103620685512 failed; no types generated |
| Independent review/full RLS/release | OPEN | No independent reviewer, production parity, merge or deployment claimed |

The native run on0bdd572 also passed before cleanup. The final shared SQL executor is byte-identical to the starting version; no temporary diagnostic relaxation remains. Exact pins and both run receipts are in DB_SESSION_RECONSTRUCTION_RECEIPT_2026-09-12.json.
