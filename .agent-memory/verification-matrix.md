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

## 2026-09-14 — provider42501 superseded; native52 boundary

| Scope | Result | Evidence |
| --- | --- | --- |
| Native1–52 / one44–52 CLI unit / no-op | VERIFIED |603e68a5;34873361878;10359689961 |
|42501/P5244/57014/P5252/P5253 rollback | VERIFIED | Same native receipt |
|52 source /43 prefix program /4 support hashes | MATCH | Fresh independent recomputation |
|62 local tests /601 files /505 version groups | PASS | Simulated local calls; not native SQL |
| Later foundation/tail/schema/types/mandatory CI | NOT ACCEPTED | Later-envelope stop remains |
| Main merge / hosted database mutation | NOT PERFORMED | Documentation-only publication |

Evidence:quality/audits/DB_NATIVE52_VERIFIED_2026-09-14.md.

## Native53–56 implementation — 2026-09-14

One source-bound R2/E2/S2/W atomic CLI unit implemented;128 local simulated
unit/regression tests plus601-file integrity and complete accounting PASS.
Native53–56 NOT VERIFIED; prior1–52 remains accepted. No hosted write,
original-source rewrite, type/fingerprint refresh or main merge.
Evidence: quality/audits/DB_NATIVE53_56_2026-09-14.md.

## 2026-09-15 — local merge preparation on91575a3b, NOT published

Rechecked existing native1–77 evidence against77 source/43 program/19 support
hashes and fresh artifact digests. Added local optional redacted auth command
evidence and always-upload wiring; this is NOT an auth SQL fix.234 local unit
controls, the original auth-group self-test (exit0), AST/workflow checks and
601-file migration integrity pass. No new native SQL, push, deployment or merge.
The current GitHub connector has no write actions. Full native78+/schema/auth/
types/required CI remain blocked. Evidence:quality/audits/PR310_MERGE_BLOCKERS_2026-09-15.md.

## 2026-09-15 — PR310 preserved; DB2 target transfer candidate

Full PR ancestry backed up at backup/pr310-20260915-d8ace45c. Prior auth
evidence patch applied without rebuilding it. Native latest run reaches144
inputs but residual144 rejects R071/55000; no full-chain acceptance. Native
DB2 target-only transfer implemented with an original-error negative control.
27 foundation +16 auth evidence local tests PASS;601 migration checksums PASS.
CI result pending; no main merge or hosted write. Current receipt:
quality/audits/DB_NATIVE144_TARGET_2026-09-15.md.

## 2026-09-15 — exact auth journal ACL continuation

Starting PR310 head a59e0ce6; full history and43efaf89 preservation ancestry
verified. GitHub connector tree/ref write works; terminal push has no credentials.
Actual OPS104346776007 and diagnostic104346776492 identify the journal ACL
assertion P0001. Exact32-entry ACL correction retains owner/options/comments;
eight rollback-only SQL controls added to ordinary/diagnostic auth CI. Local
3 regression guards,16 preserved auth-evidence tests and601-file integrity pass.
Independent source review found no severity findings; actual PostgreSQL SQL
acceptance pending publication/Actions. No production or reference changes.
See quality/audits/PR310_AUTH_JOURNAL_ACL_2026-09-15.md; current-state.md is active.

Pre-publication head changed to8130ecf3, which already published the exact ACL
correction. Full branch fast-forwarded; duplicated local implementation not
committed. This batch reuses upstream implementation unchanged and wires the
existing native ACL selftest plus8 stronger whole-assertion mutation controls.
The3 adapted guards, upstream selection check and membership constructor pass.


## 2026-09-15 — native primary padding

Actual diagnostic34958678292/artifact10392753658 identifies exact426-byte
primary55000/R071/reason plus322 ASCII spaces (matching SHA256). RED/GREEN
parser reproduction and34 foundation tests PASS; actual group7 re-execution
PENDING. Preserve concurrently published8130ecf3/d05408c2 auth work. No
production, schema-reference, SQL/ledger/control weakening or main change.
See quality/audits/PR310_NATIVE_PRIMARY_PADDING_2026-09-15.md.
