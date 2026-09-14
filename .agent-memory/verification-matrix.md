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

## 2026-09-13 residual restoration

85149c4: native selected144+513 PASS(34755799372/103719840158); 150 source tests
and full candidate native PASS(34755559678/103719212176). Application build/API
gates PASS103719840231 and permissions/Storage PASS103719840272. Full canonical
clean replay/types FAIL103719840293; fullE2E FAIL34755799382; seven source
dispositions OPEN. Retained-byte follow-up:19 residual unit tests and named-scope
constructors PASS locally; native rerun REQUIRED. Security scan/review OPEN.


## 2026-09-13 — local true-only gate candidate, base22c923bb

| Scope | Result | Boundary |
| --- | --- | --- |
| New true-only gate | PASS | 12 local tests, including actual bash pipeline with transport double; not PostgreSQL |
| Targeted source/cleanup/accounting suites | PASS | 156 enumerated tests in total plus full membership program |
| Published residual native proof | PASS | Existing22c923bb run34762374742/job103737335752; predates local patch |
| Ordinary replay | BLOCKED | exit1 unsupported mode |
| Full effects | BLOCKED | exit1; 2 substituted and5 unclassified |
| Generated types | BLOCKED | exit1 tail20260911114443 |
| Push/merge/deploy/independent review | NOT PERFORMED | Local patch only; no remote write capability |

Evidence:quality/audits/DB_REPLAY_TRUE_ONLY_GATE_CANDIDATE_2026-09-13.md.

## 2026-09-13 — publication session

The earlier access limitation is superseded. GitHub write actions are available.
Eight focused suites rerun PASS(102 tests); long membership rerun timed out and
is not a new pass. Full hosted verification of the publication remains pending.
Historical SQL/type manifests remain unchanged. No production mutation or merge.

## 2026-09-13 —6064 and ordinary-tail increment
-6064 native residual34776030335/job103774181992: PASS, both selected and staged
  foundation144/residual7/timestamp513; index semantic checks and cleanup PASS.
-6064 OPS34776030297: quality-release-gates103774182237 PASS; clean103774182283
  rejects unsupported native target before SQL; verify/types remains blocked.
-New local increment: source contract18, owned-tail13 (RED/GREEN), cleanup20,
  required checks12, timestamp13, focused residual51, repair selection-only PASS.
-New full native/managed/ledger/schema/types: NOT VERIFIED. See current-state.

## 2026-09-13 — actual final-gate boundary

6a65e75 /34779330429: residual103783333423 SUCCESS including originals-absent
continuation; ordinary103783333534 reaches144 foundation/7 residual/513 timestamp
and18/18 true, then fingerprintFAIL and private-source privacyFAIL. Disposal and
exact cleanupPASS. Canonical600/0 input admissionPASS is not schema/ledger/types.
13 new terminal-diagnostic +3 identity +13 tail localtestsPASS; native diagnostic
pending. See current-state.md and DB_FINAL_GATE_DIAGNOSTIC_2026-09-13.md.

## 2026-09-13 —7c6a7aa diagnostic read-back

34780512868:103786555047 selected/staged/cleanupSUCCESS;103786554902 staticPASS,
actual ordinary144/7/513 and18/18PASS, fingerprintFAIL, privacyFAIL, disposalPASS.
Read-only projection/censusVERIFIED; source hashes independently match originals
and manifest. Official managed ledger/typesNOT ACCEPTED. No new runtime fix,
production write or main merge. Evidence:DB_FINAL_GATE_NATIVE_RECEIPT_2026-09-13.md.


## 2026-09-14 — local native entry increment

Local native-entry patch: 28 new + 64 existing tests PASS; all native calls simulated. 601-file integrity PASS; generated-types migration-tail check FAIL. Native execution, full parity, push and merge NOT VERIFIED.


## 2026-09-14 — native ordinal27 and first43 acceptance boundary

| Check | Result | Exact scope |
| --- | --- | --- |
| Native transaction27 proof | VERIFIED | a7622e16;34860588353/104031445849;25P01,P2727,P2728 with rollback/held lock/timeouts |
| Historical CLI ledger | VERIFIED | All43 foundation inputs and no-op repeat;0 timestamp inputs |
| Private inputs and owned cleanup | VERIFIED | Artifact10354879366; helpers and workspace removed |
| Independent source/receipt cross-check | PASS | All43 prepared source/program hashes match native artifact |
| Fresh offline regressions/integrity | PASS |9+30+15+8=62 tests;601 files/505 version groups |
| Ordinary full clean job | FAILURE | Intentional NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED after43 |
| Full schema/types/OPS/E2E/merge | NOT ACCEPTED | No acceptance override; next atomic group44–52 |

Evidence:quality/audits/DB_NATIVE_LOCK27_VERIFIED_2026-09-14.md. This supersedes
the earlier26-input boundary, not the remaining full-release gates.
