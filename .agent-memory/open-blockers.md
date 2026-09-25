## 2026-09-25 — PAUSAD säker överlämning (aktuell; äldre avsnitt är historik)

Auktoritativ worktree `pr372-finish`: lokal `01684a3f172c282296da36adf5cd9893f56199c0`, träd `cb24b7d9eb391bb641a40223de4a0a7c480ac4c6`, ren före denna dokumentuppdatering. GitHub PR #372 open/draft på `codex/e035-correction-context-20260924`: publicerad `528baa6db4fa15551888a300f22617fc3a09d684`, samma träd; skilda SHA härrör från GitHub-publiceringen. Ingen produkt-/teständring från denna head är opublicerad. Den äldre separata worktreens smutsiga filer ingår inte. `8a5b2150d444366b13e252a331b56b872ad497ee` är en fast-forward efter `c9f5f64fe570516865b408b2a9fe920a01f27e8a`, med ändrat träd och tillagd kanonisk `source_operation_id` i outbound-fixturen.

Senaste helt avslutade head `c71f312aff239396b2e795b45cd070c7fc995d17`: OPS `36129656763`, native 337/337 och alla tillämpliga flöden gröna, crawler skippad. På `528baa6d`: verify, tenant, Ediel, browser och full E2E gröna; OPS `36132081645` har ännu quality/build `108061424990` och clean migration/native `108061425252` pågående vid kontrollen. Publicerat E30/S07 processor-/dispositions-/CONTRL-/noll-mätvärdestest är **ofärdigt i bevisning: native väntar**. Inga nya körningar har startats i pausen.

Behörighetstestet `the actual support case and operation enqueue writers capture linked case, event and job facts` fick `customer_case_status_actor_not_authorized` (`42501`) via `updateCustomerCaseStatus` → `public.gridex_update_customer_case_status` (`20260923180557_restore_customer_case_events_atomic_status.sql:108`). Saknad kanonisk `cases.write`-registrering i ren replay verifierades och scoped forward/grant passerade native 335/335 på `15366cb`. Storage-testerna `storage 'replace' at 'before_append' preserves old receipt and new reads hold`, `storage 'delete' at 'before_witness' preserves old receipt and new reads hold` och `storage 'replace' at 'before_witness' preserves old receipt and new reads hold` gav `unconfirmed` i stället för `recorded/verified_at_observation` respektive `recorded/unavailable` på `c9f5f64`; delete/before_witness återkom på `a3464eae`. `captureDocumentReference` fångar fel; felsteget är okänt, timing/interception är en hypotes. Publicerad stage-/Storage-/RPC-diagnostik triggade inte när sexfallsmatrisen senare passerade. Ingen kausal Storage-rättning är verifierad.

Oberoende full-diff statisk granskning av `8a5b2150` och senare `c71f312a` fann inget bekräftat nytt kodblockerande fel, men höll tillbaka slutacceptans; `528baa6d` har inte slutgranskats. Task 3b/4 kräver producer/legacy, cutoff, overflow, behörighets-, historik-/retentionbevis, autentiska sluthead-kontrakt och slutlig CI/granskning. `complete:false`; ingen merge, ingen PR #310-ändring eller produktionsåtgärd.

**Nästa diagnostik vid återupptagning:** läs första relevanta felrad och de två nya E30/S07-fallens faktiska resultat i native jobb `108061425252` på `528baa6d`; vid nytt `unconfirmed`, läs exakt stage-/Storage-/RPC-diagnostik före ändring. Full SHA-tabell, genomförda försök, kodvägar och återstående acceptans finns i `.agent-memory/pr372-pause-20260925.md`. Under pausen görs ingen ny batch eller CI-omkörning.

---

## 2026-09-25 — E30/S07 combined receipt native checkpoint

Published `c71f312aff239396b2e795b45cd070c7fc995d17` / tree `f6cc0b09` passed OPS `36129656763`: native 337/337 including previously matched E30 and S07 held by witnessed C, case-view 1/1, tenant/parity and schema fingerprint `c3ec834f`; verify/quality succeeded. Tenant, browser, Ediel and full E2E succeeded; crawler skipped. Storage six-case matrix passed; old `unconfirmed` cause still unknown, new fresh-revalidation diagnostic not triggered. Independent read-only review found no confirmed code defect but correctly limited these tests to active qualification and receipt, not actual inbound side effects. A local unpublished follow-up extends E30/S07 through `processInboundUtiltsMessage`, persisted disposition, ACK and zero meter series; scoped lint, script typecheck and file budget pass, native pending. Task3b/4 historical and retention qualifications remain open with `complete:false`; PR372 draft/unmerged, PR310 excluded.

---

## 2026-09-25 — Exact-head authorization batch accepted as bounded checkpoint

Published `15366cbaca91ecdebf58b2baf65beb2f90a366fe` / tree `27a1c3fb` passed OPS `36128443714`: verify, quality/build, clean replay native 335/335, case-view 1/1, tenant/parity and authentic types/schema fingerprint `c3ec834f`. Tenant `36128443753`, Ediel `36128443721`, browser `36128443728` and full E2E `36128443708` succeeded; crawler skipped. The `cases.write` register and scoped fixture are native qualified. All six Storage mutation cases passed, but the older `unconfirmed` cause remains unobserved. Read-only static review found no confirmed new blocker, explicitly withheld final native/acceptance approval. Local unpublished work adds a fresh-revalidation diagnostic and native E30/S07 C-hold cases; scoped lint, three typechecks, line budget and 38 focused unit tests pass, native pending. `complete:false` stays; PR372 draft/unmerged, PR310 excluded. Next publish this bounded test batch and inspect its native result before expanding Task3b/4 evidence.

---

## 2026-09-25 — Authorization native PASS and authentic contract checkpoint

Published `4c05b146` / tree `f50abf92` passed OPS `36127254985` verify and quality/build. Native job `108046110819` passed 335/335 in five files, including denied/allowed `cases.write` status updates and all six Storage mutation cases; case-view native 1/1 passed. Replay then stopped at stale generated types (`36e98937` actual vs `2b2dda6a` tracked), before remaining post-native gates. Artifact `10860308328` ZIP SHA256 `40f63743c7454f3de7abb9ad2085f0060194a322350f96d42b4e9a3a767ab849` was verified and its actual types/schema/fingerprint copied byte-identically locally. Changes are the seven late case columns, four indexes, owner trigger and previously published private function refinements. **Local copy is uncommitted/unpublished and final replay pending.** Earlier Storage `unconfirmed` remains root-cause unknown despite six passing cases here; retain diagnostic and `complete:false` historical boundary. Next: local contracts/type checks, publish, exact-head replay, independent final review. PR draft/unmerged; PR310 excluded.

---

## 2026-09-25 — Exact-head native after authorization batch

Published `05cb5c40` / tree `141eae89` is still draft. OPS `36126471587`: verify and quality/build SUCCESS (full 6080 tests); native `108043629239` 334/335. The negative status RPC correctly rejected the actor without `cases.write`; the sole failure was a new fixture assertion expecting `open`, whereas the actual support stop had already set `billing_blocked`. Local correction stores initial status and verifies denial leaves it unchanged; script types/lint/budget pass; this correction is **not published or native-run yet**. The canonical registry materialized, but positive status path remains behind that assertion. All six document Storage matrix cases passed this run, so earlier unconfirmed cause was not observed; retain bounded stage diagnostic and do not call it fixed. Next: publish fixture correction and inspect exact-head replay. No merge or PR310 work.

---

## 2026-09-25 — Storage failure isolation prepared

Native job `108035388543` on `a3464eae` failed `storage delete at before_witness` (expected recorded/verified_at_observation, observed unconfirmed); the other five matrix cases passed on that run. Earlier `c9f5f64` failed before_append replace and before_witness delete/replace, all observed unconfirmed. The product wrapper intentionally masks stage errors as unconfirmed. A test-only diagnostic now reports Storage operation error, intercepted RPC error, exact synthetic object path/Storage object IDs and durable attempt/outcome/witness counts when unconfirmed recurs. No retry, timeout, skip, product behavior or guard changed. Local type/lint pass; native diagnostic pending. Next: publish/inspect exact native result, then correct only a demonstrated cause.

---

## 2026-09-25 — PR372 resumed, authorization diagnosis checkpoint

Published `a3464eae` is still draft/unmerged; all workflows completed. OPS `36123867431` native job `108035388543` ran 335 tests: 333 pass, two fail. Diagnostic showed active auth user and membership, but `cases.write` registry=0, grant=0, effective=false. The old eight-digit permission seeds are not in canonical replay; the production status RPC requires the key. Local forward `20260925130000_customer_case_write_permission_registry_completion.sql` adds only the established key, preserves assignments; the native fixture now asserts denial before a scoped direct grant and success after it. Migration integrity, script types, scoped lint and 1800-line budget pass locally. Native behavior remains **unexecuted** on this candidate. The other failing test is Storage delete/before_witness returning `unconfirmed`; underlying failed stage remains unknown. Next: instrument and qualify that distinct stage, then publish a logical batch. The older dirty worktree remains untouched; PR310 excluded; no merge.

---

## 2026-09-25 — PAUSED PR #372 handover (authoritative; older entries below are superseded for current status)

**Scope/state.** User paused implementation. PR #372 `codex/e035-correction-context-20260924` is OPEN/DRAFT and unmerged; main was `2a148d39d631fc759c99cd1c69350b5e2147dbdb` at the last PR check. PR #310 is untouched. No production migration, deployment or market/customer send. No new CI rerun was requested.

**Worktrees and publication.** Authoritative worktree: `/workspace/scratch/d9e6c237b68e/pr372-finish`, local HEAD `adfbdd82747aaa58a38cde657a026e99f2d9ea56`, tree `be35f8bc6983050aa4c521e200de512be2f2c473`, local branch `codex/pr372-finish-20260925`. GitHub PR head at pause: `8a5b2150d444366b13e252a331b56b872ad497ee`, identical tree `be35f8bc6983050aa4c521e200de512be2f2c473`. The local SHA differs because publication used GitHub blob/tree/commit/ref APIs; tree equality was checked. Earlier published `c9f5f64fe570516865b408b2a9fe920a01f27e8a` had tree `dc1bd6291f46a08a982d637da6de0f0e8d2d6271`; `8a5b2150` is its fast-forward child and adds the canonical outbound fixture `source_operation_id`. Local `f43cbb03` has the same tree as remote `c9f5f64`; local `adfbdd82` has the same tree as remote `8a5b2150`. The older worktree `/workspace/scratch/d9e6c237b68e/gridex-ops-platform` remains at `76591ad233d9646cb5cde538c1be1b2d6f5cddd9`, with three modified files and one untracked SQL forward; it was not changed or mixed into this checkpoint.

**At-pause unpublished work.** Only `scripts/ediel-correction-context-native.test.ts` has an uncommitted, unexecuted diagnostic assertion. It queries the `cases.write` registry row, actor direct grant, effective permission, auth-user state and membership immediately before the failing status RPC. This is diagnostic/WIP, not a verified fix; preserve it in the pause checkpoint and identify its later commit separately. No generated types/schema reconciliation has been published.

**Latest completed exact-head CI.** OPS `36118572008` on published `8a5b2150`: verify SUCCESS; quality/build SUCCESS; clean-migration-replay FAILED after 334/335 native tests (5 files), one failed. Native job `108018368002`. Tenant `36118571851`, Ediel `36118571883`, browser `36118571927`, full E2E `36118571882`: SUCCESS; zero-admin crawler `36118571841`: SKIPPED. All these jobs were completed at the pause check; no active external jobs were observed.

**First remaining failure and code path.** Test `scripts/ediel-correction-context-native.test.ts > the actual support case and operation enqueue writers capture linked case, event and job facts` fails with `customer_case_status_actor_not_authorized`. `createTenantSupportCase` in `lib/customer-cases/support.ts` creates the case and the captured `created` plus `operational_stop_applied` events; the test then calls `updateCustomerCaseStatus` in `lib/customer-cases/db.ts`, which invokes `public.gridex_update_customer_case_status`. That SQL function raises the message at `supabase/migrations/20260923180557_restore_customer_case_events_atomic_status.sql:108` when actor membership/profile/company or platform/`cases.write` authorization is false. Verified: the gate rejects the synthetic actor. **Unknown:** which predicate failed, whether registry/direct grant is absent, or whether a production migration repair is needed. The local diagnostic assertion has not run.

**Earlier document/Storage evidence.** OPS `36118081656` on `c9f5f64`: native 330/335. Besides the same permission failure and `canonical_ediel_source_operation_required` on the concurrent Z08 fixture (fixed in `8a5b2150`), these exact tests reported `status: 'unconfirmed'` instead of recorded outcomes: `storage 'replace' at 'before_append' preserves old receipt and new reads hold` (expected `recorded/verified_at_observation`), `storage 'delete' at 'before_witness' preserves old receipt and new reads hold`, and `storage 'replace' at 'before_witness' preserves old receipt and new reads hold` (both expected `recorded/unavailable` in fresh revalidation). Code path: `captureDocumentReference` in `lib/ediel/sources/documentReferenceCapture.ts`, test RPC/Storage interception in `scripts/ediel-document-reference-native.test.ts`. The wrapper catches errors and returns unconfirmed, so the underlying failed stage is **not verified**; intermittent Storage/RPC timing or interception is only a hypothesis. All three passed on the later `8a5b2150` native run; do not claim a causal fix or permanently resolved flake.

**Review/acceptance.** Independent read-only reviewer `/root/pr372_review` reviewed the full 151-file diff at published `8a5b2150`, tree `be35f8bc`, against main `2a148d39`: no confirmed remaining static code blocker; static approval only, explicitly subject to native and authentic generated artifacts. Earlier R1/R2 and switch event ownership forwards appeared addressed. Task 3b/4 are **not accepted**: status writer native path still fails; complete prospective producer/legacy, retention and historical inception coverage remain bounded, with `complete:false` before the epoch; full five-owner saved-cutoff/UTILTS evidence, cutoff/overflow/permission negatives and final same-head gates require qualification. One-SELECT STABLE owners support single-MVCC statically; the concurrent test proves fixed-cutoff pre/post commit visibility and passed on `8a5b2150`, not an adversarial commit inside one acquisition. Authentic schema fingerprint/type generation is pending because replay stops before typegen. No merge.

**Attempts/next diagnostic after user resumes.** Forward repairs for switch-event request owner binding and skipped case columns were published before `c9f5f64`; the moved concurrent test, NAD parties, event count and canonical source operation were corrected. The last local checks for the published fixture were script typecheck, targeted lint and large-file budget; the newly added permission diagnostic was not executed. On explicit resumption, inspect the diagnostic query's actual registry/grant/effective/user/membership result in an isolated native replay, identify the first false predicate, then make the smallest authorized repair and qualify its own head. If Storage failures recur, instrument the failed capture stage and Storage operation result without weakening fail-closed behavior. Reconcile schema/types only from authentic replay artifacts, update acceptance matrix/PR body, require final-head CI and independent review before considering merge. **Do not start these actions during this pause.**

---

## 2026-09-25 — PR372 exact-head blockers

- R1/R3 unrelated process/source/concern/Z06/Z10 and document volume passed actual inbound native326/326 at `a49c48e2`, but independent re-review of final code is pending.
- Relevant overflow hold and canonical signed producer fixture are local only; native replay pending. R2 alias regression passed native on earlier heads, final whole-diff review pending.
- Authentic schema/fingerprint `701c7a5a` copied from a49 artifact but not yet published; final same-head CI and Task3b legacy/retention, Task4 negatives/E30/S07 remain. No merge.

## 2026-09-24 — Current PR372 blockers

Archive-style delete test on 7491e16 passed native312/312 and all applicable CI. TRUNCATE-denial fixture is locally prepared and not natively qualified. Task3b still lacks complete direct/legacy/claim/signed producer proof and historical inception/retention; preserve complete:false and scoped gaps. Task4 must use one MVCC observation or a proven barrier to connect raw concerns, structural source approvals and process history; it is not implemented. Whole-branch independent review and final same-head CI remain. Do not merge PR372.

## 2026-09-24 — Task3b current blockers

Authentic schema reconciliation from native303/303 awaits publication and same-head CI. Process facts are prospective and incomplete: eleven table CRUD/route/cascade cases, independently committed witnesses, bounded reader, source-only swallowed-event gaps and inception retention still require proof. Task4 single-MVCC conditional UTILTS hold and whole-branch review remain. No PR372 merge.

## 2026-09-24 — Task3a ACCEPTED; Task3b next

Accepted runtime d7cbab18b9b102e00cde256bc91c22271455d7c8, tree66c82f59b88969b43326f7f34bd11ad432412cff. All applicable same-head CI SUCCESS: OPS35958136936 (verify107500725279,quality107500725385,native107500725396), fullE2E35958136881, browser35958136874, Ediel35958136896, tenant35958136892; crawler35958136976 skipped. Full6072/377, native301/5 plus case1/browser2/postbrowser1, types, tenant invariants, parity, schema, build/bundle PASS. Independent static/fix/native/schema SPEC/QUALITY approved. Final artifact10791646035 ZIP73ad030582646cb7e851c348f28867c3f32e45a1e3ab65e3a1a659acf9ef8614 verified; all three generated files byte-identical. Types32ae2f06, schemaef41ebad, fingerprint04ba0c99.

One next active item: Task3b twelve-table customer/process facts, prepared brief, fresh sole author after acceptance checkpoint publication. Genuine acceptedBASE schema artifact is available in /workspace/scratch/4b1d39503015/e035-pr372-outbound-final; use it plus real native catalog probes, not source-only assumptions. Parent owns nativeCI/generated artifacts. Task4 single-MVCC composition and later E035 owners remain pending. No fullTask3/E035 or PR372 merge claim. PR310 excluded; user authorization persists.

Authoritative workspace remains /workspace/scratch/4b1d39503015/gridex-ops-platform/.worktrees/e035-task3a-isolated. Original checkout is preservation-only. Deferred final-review items: dense adapter formatting; canonical fingerprint covers public/gridex_received_sources, not gridex_outbound_dispatch (private behavior has native/migration proof). No hosted writes/deployment/market sends.

## 2026-09-24 — Task2b document references ACCEPTED; Task3a next

Task2b accepted runtime7581966b75165b2fd88de05756913cb673cd4a32, tree d77b4ba73e67caf78eab951ffcc5ef3ed05e3e10. All applicable same-head workflows SUCCESS: OPS35949827423 (verify107475755293,quality107475755157,native107475755339), fullE2E35949827409,browser35949827480,Ediel35949827343,tenant35949827368; crawler35949827390 skipped. Native262/5 plus case1/browser2/postbrowser1, retained SQL/concurrency, types, tenant invariants, parity and schema PASS. Prior full6062/376 and final quality/build green. Independent native/schema SPEC/QUALITY approved zero findings. Final artifact10788357629 ZIP SHAb187af683ab68fa6debac16883aca049d0d2fc8733039921b07a7314b93b0a6b verified; all three generated files byte-identical. Reference-only context, authority:none/coverage:incomplete; no PDF copy/new retention/positive C or reopening.

Next single active item: Task3a outbound provider-entry fence and immutable receipts, prepared author outbound_fence_task3a. Publish this acceptance checkpoint, then explicit immutable BASE/START. Narrow approved sendEdielEmail callback after S/MIME archive and before either sendMail included; no Task3b or Task4 edits. Full Task3, full E035 and PR372 delivery remain incomplete. PR372 stays draft, PR310 excluded. User authorization covers continuation/publication/gated merge; no hosted writes/deployment/market messages.

## 2026-09-24 — Task2b schema reconciliation after native262 and tenant/parity PASS

Published2fb06cb1 / OPS35949085146 / native107473500225 passed native262/5, case1/browser2/postbrowser1, authentic types, tenant invariants and every parity-selftest drift class. Verify107473500352 and quality107473500021 SUCCESS. Only committed old schema fingerprint mismatch remains. Artifact10788152004 ZIP SHAed8a05257ac50f00624538e2242c468825617a8d1830690badf6c6ff92f2bccd verified; actual schema.sql and fingerprint copied byte-identically. Schema.sql SHA b7aa3dc018528e93b7238e29bd3c2667ce4f446abacff6e04a02259c79e66ec0; fingerprint e28df3203db729c2db2d2f9ba82ba0d98cdd1247072d6c564616d0770ca2f67d. Types remain byte-identical f2a05bbb.

Next: bounded independent final native/schema review, publish exact generated contracts from API parent2fb06cb1, finalsameheadCI and acceptance before Task3a START. FullE035 partial, PR372 draft, PR310 excluded; no hosted writes/deployment/market messages.

## 2026-09-24 — Task2b native262 PASS; authentic types reconciliation

Runtime9b6ee291 / OPS35948357290 / native107471286079 passed **262/5** (retained224 + document38), case1/browser2/postbrowser1. Quality107471286229 SUCCESS. Only expected generated-types mismatch stopped replay before tenant/parity/schema. Artifact10786849836 ZIP SHA77600354e2a64d93a7eb0cf4dca9b3e5c31e82f01eaddd23e2e49950e2f85b0f verified; actual types SHA f2a05bbb69ec298e78cf21cd6761a62aae82ba9bdde5b2aa38032b5e062d8e5f copied byte-identically and manifest tail/provenance updated. No manual generated code.

Next: publish authentic types, execute remaining tenant/parity/schema, reconcile actual schema then final same-head gates and independent native acceptance. Task3a prepared only; Task2b not yet fully accepted. PR372 draft/full E035 partial.

## 2026-09-24 — Task2b fix3 fixture correction frozen

Local1443d03e01f23e79da7c93db47417b25abf2e6c2 on published9e28bc1d. Confirmed native failure was fixture-only: existing gridex_sync_supply_customer_contract_v1 rehydrates customer_contract_id from populated contract_id. Negative fixture now clears both aliases atomically, asserts persisted null/null, preserves unavailable outcome and zero Storage reads across all5 wrong same-company graph cases. No production SQL/manifest change. Node22 scripts/tests types, lint and diff check PASS; actual native262 rerun pending. Scoped independent re-review active.

Next: accept scoped review, publish exact tree from9e28bc1d, rerun native262, reconcile actual generated contracts, then final qualification. Task3a remains prepared only; full E035 partial/PR372 draft.

## 2026-09-24 — Task2b native261/262; fix round3 active

Published9e28bc1d / OPS35947668822 / native107469127017: **261 PASS,1 FAIL,262 total**. Canonical customers.read materialization and repeat-preservation test pass. Sole failure is same-company wrong supply graph native test line158: expected unavailable but got verified_at_observation. Root cause is under investigation; do not classify fixture versus runtime defect before evidence. Generated types/schema stages not reached. Artifact10787592388 ZIP digest e1b061b7b3e8ccd37f476b61a3650d0a2f3d58dd244ee18261e83c9480193b46. Browser/Ediel/tenant pass; E2E14/15 only stale generated migration tail. Task2b not accepted.

Author document_fix2_recovery resumes fixround3 from9e28bc1d. Preserve unresolved graph/no Storage I/O requirement; published SQL immutable. Next: diagnose bounded root cause, fix, independent scoped review, publish and actual native rerun, then authentic generated contracts. Task3 prepared only. PR372 draft; full E035 partial.

## 2026-09-24 — Task2b fix round2 frozen; scoped review active

Published API parent remains 7a28b9ab086da88d320d7da96c54c503bcdafc75. Local fix8089f34bfced7e72b36958c387cbf748f97bd89c adds canonical customers.read registry materialization only, no assignments or authorization change. Actual legacy INSERT files have eight-digit filenames and are not canonical replay inputs. New CLI forward20260924021718 checksum cc91587d97507a0f3ab810de11df02ed588c49914cf164d5e1fd3a213adb1243; published SQL unchanged. Local integrity613/517, scripts/tests types and scoped lint PASS. Native expected262, not executed on fix. Baseline full6062/376/build PASS; native228/261 with33 seed failures remains latest real result.

Next: scoped independent SPEC/QUALITY review, exact-tree publication, actual262 DB/Storage replay, authentic types/schema reconciliation and final native acceptance before Task3a. Task3a/3b focused briefs and recovery reports saved in tracked audit. Full E035 partial, PR372 draft, PR310 excluded, user authorization persists.

## 2026-09-24 — Task2b first native result; fix round 2 active

Published head `7a28b9ab086da88d320d7da96c54c503bcdafc75`, OPS35945973907. Quality/release/build job107463863631 SUCCESS. Clean replay job107463863699 applies migrations and runs all five native files: **228 passed, 33 failed, 261 total**. All 33 failures stop in document fixture seed line67: actual registry has communication.send and documents.read but lacks customers.read. This is a concrete registry prerequisite failure; document DB/Storage assertions behind that seed are not qualified. Generated types/schema stages were not reached. Verify job107463863393 fails the expected stale generated migration tail. Artifact10786519020 contains replay log only (ZIP SHA256 7db649f5e0269d01ddad11acc8cb20fa873b09392aa36aa539b87a659b084262).

Original Task2b author owns fix round2/5 from published7a28b9ab. Trace the actual migration chain and canonical key before correction; do not weaken authorization or insert a test-only substitute. Published SQL is immutable; any production repair needs a new CLI forward. Parent owns independent review, publication and authentic generated contracts. Task3 remains PREPARED only. Its approved sequential partition is 3a outbound reservation/provider fence and immutable receipts, then 3b finite twelve-table process facts; each requires independent review and real native acceptance before Task4 composition. Full E035 remains PARTIAL; PR372 draft; PR310 excluded.

Next: review the bounded fix, publish from API parent7a28b9ab, execute actual native qualification, reconcile generated artifacts, then accept Task2b only with evidence. No further user approval is needed for the authorized continuation.

# E035 Task2b document context reviewed; native261 pending — 2026-09-24

Source-onlyTask2a accepted8fde5f26, acceptanceBASE0a528215 alsoallCIgreen. Currentdocumentimplementation07d3b9c5 +fix1 638926b4 independentlySPEC/QUALITYAPPROVED,0open. Reference-only context: triplepermissions/actualtenantgraph, durableattemptbefore2MiB/10sec streamingreadback, separateobservation/append/witness andincompleteepoch; savedpayload preservesimmutableidentity/xids/visibility. NoPDFcopy/newretention/positiveC/reopening. PublishedsourceSQLunchanged; documentforwardnotyetpublished.

Local64/5,3typechecks(initialapp thenunchanged),lint,integrity612/516PASS. ActualSDK/Node/loopback header/bodytests2PASS/35skipped; no projectDB/Storagequalification implied. Expectedmandatorynative261/5 =retained224+document37. Next: publish exactreviewedcheckpoint fromAPIparent0a528215, runrealnativeSQL/Storage, reconcilegenuinegeneratedartifacts thenindependentreview/acceptance. Task2bnotyetaccepted; Task3processhistory andTask4UTILTS remain. Allreports/fixtures/constraints saved; PR372draft, PR310excluded, fullE035partial, userapprovalpersists.

# PR372 active; pure correction hold approved — 2026-09-24

PR372 draft https://github.com/heke99/gridex-ops-platform/pull/372 on codex/e035-correction-context-20260924; remotehead ea1d76e4fde787777da882be66948218f1a7ee0e is exacttree of local189eb136. Local history intentionally remains on189eb136 while sole author works; parent must publish next tree using remoteparent ea1d76e4 and sync only after author freeze. Task1 pure boundary/scope/cutoff hold independently SPEC/QUALITY approved; finalfocused67/5, types/lint PASS, full6007/373 before smallmatcher extraction then focusedGREEN. Production capture remains absent until later tasks; no positive C authority.

Active Task2 author /root/correction_context_task2, BASE189eb136d85398b458d72293cc35e551034e5490. Implement immutable sealed-Z05 source concern capture with SQL tenant/actor/original/witness guards and real native fixtures. Parent authorized source-only checkpoint with document-byte capture explicitly unresolved, not whole Task2 completion. Existing document metadata is more immutable than initial preflight assumed (20260716183000); new correction-PDF copy lacks established policy mapping. Read-only reference-reuse design in progress, no invented legal policy/retention or positive cause. Tasks3/4 outbound/processhistory and one-MVCC composition remain pending.

Next: receive Task2 implementation checkpoint, independently review/native qualify and resolve document route before claiming complete capture. CLI2.101.0 available via npx; native DB remains CI-owned. User continuation/publication approval persists; no hosted writes/deployment/market sends. PR371 remains accepted merged2a148d39, full E035 PARTIAL, PR310 excluded.

# E035 prior-guide delivery accepted; correction-context task starts — 2026-09-24

PR371 MERGED at main2a148d39d631fc759c99cd1c69350b5e2147dbdb. Final PR head65f5b896cd3801eedde43db99df38afa6d9c78a1 passed all applicable CI: OPS35931020643, Ediel35931020535, browser35931020629, fullE2E35931020592; crawler skipped. Full6003/372, native166/3, case1/browser2/postbrowser1, SQL/concurrency/tenant/parity and build PASS. Independent whole-branch SPEC/QUALITY and final native scope ACCEPT, zero findings. Artifact10780533571 SHA256f25a0560519fd313d3e0e5e068145d74823b4d1bbedad3d3237f129d0623eacc independently verified; generated contracts byte-identical, no migration. Final native addendum retained in audit directory. Earlier publication/native blockers below are SUPERSEDED.

Active branch codex/e035-correction-context-20260924 from accepted main2a148d39. One active item: hold-only correction-context/process-history slice for Z05C/corrected end. Plan docs/superpowers/plans/2026-09-24-e035-correction-context.md. Start pure earliest-boundary projection, then immutable capture, outbound/process history and service-owned saved-cutoff composition. Do not issue positive C/reopening authority. Unknown historical dispatch/retention remains unavailable. Full E035/G01/F3/masterplan PARTIAL; Z06E/changed-start/agency89/multi-message/delegation/history remain subsequent owners. PR310 excluded.

Next exact action: generate Task1 brief and SDD ledger; implement pure blocker with boundary/scope tests and independent review. Follow finite task gates, real native qualification and generated-contract reconciliation for later SQL integration. User approval covers continuation/publication/review/merge after gates; no hosted writes/deployment/market sends.

# PR371 whole-branch review approved; native infrastructure retry required — 2026-09-24

Published code/test head c89586dc9b6ff29ab8d01ede873a8e4f6ebb0617 (tree8fbaed08c8cdd8e345ff8e5d9ecf0e88d740a5ed) is clean locally and ready for review. Independent final whole-branch SPEC/QUALITY APPROVE, zero material findings; report prior-guide-final-review-20260924.md. No final fix wave requested. Corrected native replay OPS35930370622/job107415232454 failed BEFORE TESTS because Docker host port54322 was occupied. This is infrastructure evidence, not a product result. GitHub disallows a job rerun while another job in that workflow runs. Verify, ordinary browser, E2E and Ediel passed; quality/build was still running at this checkpoint.

Next: publish this documentation receipt, then qualify its exact head using ordinary CI and authentic native artifact inspection. If native startup fails transiently again, inspect the actual error and rerun only failed job once the workflow finishes; do not weaken gates. Corrected166 native tests still need successful execution. Merge only after exact-head checks and final receipt review. Full E035 remains PARTIAL; PR310 excluded. User approval covers publication/PR/CI and continuation; no repeat approval needed for this bounded delivery.

Prepared follow-up: correction-context-next-plan-20260924.md in the same audit directory, read-only plan until PR371 accepted. Hold-only correction capture/process history and earliest plausible boundary; positive C and unresolved historic dispatch/retention authority remain separate.

# Prior-guide native correction reviewed — 2026-09-24

Local fixture correction6298f35f composes a fresh actual review and deliberately fails only its separate witness. Independent scoped review3 approves SPEC/QUALITY; no production code or database guard changed. Node22 scripts types/native lint/qualifier29 PASS. Corrected native execution remains pending. Parent publishes this exact tree with the review and checkpoint, then inspects all ordinary same-head CI; merge is not yet accepted. User publication approval persists.

# PR371 published; first native failure under correction — 2026-09-24

PR371 https://github.com/heke99/gridex-ops-platform/pull/371 is DRAFT on codex/e035-prior-guide-20260924 at f7c06f06255e57e3ef7372396f03d666a9723efd, tree d52775545300e526907373d75a958fdf58664621. Exact local tree verified against authenticated GitHub publication; original local history retained in backup/e035-local-598bc841. User explicitly approved publication and continuation; earlier publication blocker below is SUPERSEDED.

First actual OPS35929036489: verify107410965413 and quality107410965660 SUCCESS; native107410965832 FAILED with165/166 passing. Sole failure scripts/ediel-source-owner-native.test.ts369: reused reviewed owner snapshot rejected with23514 source_object_owner_snapshot_changed. Fix round3/5 assigned to original implementer; preserve database guard and intended unwitnessed-successor hold. Subsequent native case/browser/postbrowser/typegen gates not reached. Ordinary browser35929036495, fullE2E35929036484 and Ediel35929036537 SUCCESS. No native acceptance or merge.

Next exact action: diagnose and fix fixture, independent scoped SPEC/QUALITY re-review, publish corrected exact tree, run ordinary same-head CI and inspect authentic native artifacts before final review/merge. Then execute prepared Z05C correction-context/pending-boundary slice; other E035 business, delegation, agency89, physical-message and historical completeness owners remain open. PR310 excluded; full E035/F3/masterplan PARTIAL. No hosted operations.

# Publication authorized — 2026-09-24

User explicitly approved push of codex/e035-prior-guide-20260924 to heke99/gridex-ops-platform, PR creation and CI toward review/merge. Earlier automatic publication rejection is resolved by this new approval. Terminal git push now reaches missing GitHub credentials; use the authenticated GitHub connector to publish exact verified tree, then compare tree SHA and run ordinary exact-head CI. No native PASS or merge is implied.

# E035 local candidate saved; publication blocked — 2026-09-24

Authoritative product/test candidate: `1f0bffc0591f4dd12a1f403df04ddf1fa445826f`, branch `codex/e035-prior-guide-20260924`, based on merged PR370/main `650bdb211fa5d492df247b2531cb8004a062db53`. Later documentation-only commit may contain this record. New branch is NOT pushed and no new PR exists. Auto-review rejected the push because it required explicit authorization for external publication to `heke99/gridex-ops-platform`. Do not retry via another transport or connector; obtain that explicit approval first.

Implemented locally: source-qualified prior25-A-3 E61/E62 capability and provenance; narrow source-backed singleton E30 eligibility correction; expanded prior policy/source/processor/transition/retry tests. Independent scoped review2 approves local SPEC and QUALITY at1f0bffc0. Full6003/6003 tests in372files passed on supported Node22 at same final production code; subsequent native-only cleanup/assertion changes passed scripts typecheck/native lint. App/tests/scripts types, source integrity and scoped lint passed (one pre-existing warning). Native PostgreSQL tests are written/typechecked but NOT EXECUTED. ACK factory and normalized sink are mocked in added native processor cases; they prove dispatch/reservation/series/contracts, not authentic wire/downstream sink completion.

This is NOT delivery acceptance, green CI, merge, deployment, full E035/G01/F3/masterplan completion. No migration or hosted operation was made. PR310 remains paused and excluded.

Next exact action: with explicit publication approval, push this branch to the named repository, open a draft PR, execute all ordinary exact-head workflows including actual native replay, inspect and fix genuine failures, and review final evidence before merge. Then continue Z05C process-basis/pending corrected-end blocker and named cancellation owner, remaining Z06E/changed-start/agency89/multi-message/delegated-sender/historical-completeness tasks. Do not restart accepted PR370.

Plan: docs/superpowers/plans/2026-09-24-e035-prior-guide.md. Evidence: quality/audits/ediel-masterplan-v2/e035-source-ledger/prior-guide-implementation-20260924.md; prior-guide-review/rereview1/rereview2-20260924.md; remaining-preflight-20260924.md. Recovery archive holds unpublished commits and local verification logs; published main remains canonical base. Older entries below are historical where conflicting.

# E035 resumed after merged PR370 — 2026-09-24

Live GitHub confirms PR370 merged at650bdb211fa5d492df247b2531cb8004a062db53; final headc0649f16982e10cf7845c22a0800fd06e4be480d had all applicable ordinary workflows SUCCESS. Production crawler skipped. This supersedes prior pending-merge text below.

Active branch: codex/e035-prior-guide-20260924. User authorizes remaining E035 and durable checkpoints. Active item: prior25-A-3 E61/E62 capability, then remaining owners in order. Plan: docs/superpowers/plans/2026-09-24-e035-prior-guide.md. Original prior PDF recovered and hash verified fad5cf4f775f86258ab9d5827426d54e57881b6298836110359cf0e41706a798. No new code accepted yet. Full E035/F3/masterplan PARTIAL; PR310 paused/excluded.

Next: implement approved scoped prior-guide amendment with real-source tests, independent review and ordinary exact-head CI. No hosted writes/deployment commands/market sends. Older entries below are historical.

## Final native156 and artifact checkpoint — 2026-09-23

Published62a7d08 OPS35918298886/native107375437512 passes SQLretry8, native156, case1, protected browser2, postbrowser1, tenant invariants/C1 and parity selftest. Actual types repeat97d0e426. Authentic artifact10776516395 verified and schema/fingerprint copied verbatim; manifest advanced to actual tail20260923192915. Previous native fixture failures are resolved; no open code findings in scoped final review. New generated schema must reproduce on final published head before merge. Root owns final artifact review/publication/CI; implementer frozen. E035/F3/masterplan PARTIAL, bounded A4from2026-10-01 comparison only, prior-guide capability next. PR310/main untouched; no hosted operations.

Next: publish reconciled contracts and exact receipts; final reviewer artifact delta + ordinary all-green same-head CI, then user-authorized bounded PR370 merge and prior-guide amendment on fresh main branch. No new routine permission needed. Older records below are historical.

### Latest native result — 304c284

OPS35909983631 quality/build PASS. Native107347079558 applies new migrations, then retained committed-retry SQL fixture fails before the156 suite: its synthetic original lacks NAD/LOC, so the new identity guard correctly rejects it before the intended reservation-conflict check. Sole implementer correcting only this fixture and retaining all eight assertions; no production guard waiver. Schema/type generation not reached. User reiterated continue forward, then requested status; execution remains active.

## Published final correction candidate — 2026-09-23

PR370 head304c284d0a7b0af102eaa27424ff173087aa5f2c, tree e9b7eff22ec96ee53a79f6a5aa4af534a5123f61, identical to frozen implementer6f0d468; local clean same-tree sync completed and backup retained. Sole implementation R1–R4+C1 frozen, independent scoped final review underway. Full5975/370, focused101/4, app/tests/scripts types, lint, migration607/511 and provenance514 PASS locally. New native32 added, expected total156; genuine CI35909983631 pending. No native new-candidate pass yet.

Prior d85815f replay repeats124+case1+browser2+postbrowser1 and identical types97d0e426; then tenant F-6 fails missing case-event classification. C1 forward20260923192915 now registers tenant ownership, preserving real RLS/ACL/invariants; new consumer forward20260923191510 repairs R1/R3. Published historical migrations untouched. Authentic case types copied; new migration manifest tail and schema require actual replay. Root owns artifacts/publication, implementer frozen. No merge yet, E035/F3/masterplan PARTIAL. User already authorizes bounded verified merge then next prior-guide amendment; no renewed routine permission needed. PR310/main untouched, no hosted writes/deployment/market messages.

Next exact action: inspect native156/case/browser/postbrowser/F-6 and actual typegen/schema from OPS35909983631; resolve concrete failures, reconcile authentic contracts; independent final delta review and all ordinary same-head gates before merge.

## Current continuation — final consumer corrections, 2026-09-23

User authorizes best-action continuation, bounded merge of verified work, then remaining E035. Published7750e2da44394b1b154eabfb4e3e8e80af30f4f6 has tree a3bd6fc759d1aa38d5291b62e477406d8b1abb73, identical to local d81dff0. Streamed not-found browser test correction is independently SPEC/QUALITY approved statically; genuine CI pending. Prior7555066 native124+case1 passed; browser1/2 passed, remaining failure was documented Next streamed200 not-found transport. Assertions now require real404 UI/noindex and absent foreign data/actions.

Whole-branch review completed with four material findings: R1 existing metering/normalized content validation; R2 mutable billing flag bypass/lineage loss; R3 unsupported agency89 high-resolution identity bypass; R4 writable observation failure swallowed before positiveACK. Sole active implementer /root/e035_final_consumer_wave handles one coherent final fix wave, BASE d81dff0. No merge until corrections, authentic native/browser/post-browser/types/schema and exact-final-head review/CI pass. Root owns generated artifacts/publication/bookkeeping; no branch reset while implementer active.

Bounded delivery may defer prior25-A-3 comparison only with explicit A4-from-2026-10-01 coverage claim. E035/F3/masterplan remains PARTIAL. Remaining owners continue after accepted merge. PR310/main untouched; no hosted writes/deployments/market messages. Next: qualify published case test while implementing R1–R4; then final scoped review and authentic artifact reconciliation. Older entries below are historical where conflicting.

## Resumed by user instruction — 2026-09-23

User explicitly instructed doing what is best, otherwise merging completed work and continuing. This resolves the reported fix5 breaker for the concrete checksum-bound native migration-path correction and its verification; prior round history remains recorded. Sole implementer case_schema_fix5 handles the bounded approved brief. No weakening of native/browser/type/schema or final review gates. Root also assesses a truthful bounded delivery scope for completed work before further E035 owners; no merge is presently authorized by test evidence. PR370 base d7666c7, main/PR310 unchanged. Older BLOCKED entries below are historical after this instruction.

## Current E035 state — BLOCKED at fix5 cap, 2026-09-23

Published bf6d4b5; OPS35903332327/native107324705734 recovered ECR startup and applied the case restoration migration; retained124 native PASS. New case suite fails at line253 with ENOENT: replay has moved original migrations into HOLD until shell EXIT, while the test reads supabase/migrations. All preceding sequential case assertions reached this point without failure, but populated-legacy, protected browser, post-browser and generated contracts remain unexecuted. Root adjudicates REAL_AND_LOAD_BEARING at existing case fix5/5; the subagent-driven-development breaker requires stop and user report. Proposed bounded repair: explicit checksum-verified original migration path from live HOLD/pre-replay temp copy; retain every assertion and replay lifecycle. No sixth fix dispatched, no E035 acceptance/merge. Source-owner work remains pending. Full unit5963/370 and quality/build passed on same product code before infrastructure-only change. See case-fix5-native-adjudication-20260923.md. Older status below is superseded where conflicting.

## Current continuation — case-event schema blocker, 2026-09-23

Live PR370 head a7cf4215; OPS35896688338 verify/quality SUCCESS, clean replay107302259653 FAILURE after retained124 PASS. First failure: customer_case_events does not exist at native case-view line158, before protected browser. The preceding explicit composite customer embed now passes actual A/B/Support reads. Production case-event readers/writers also require the missing table; historical bootstrap substitution omitted it. Forward restoration and atomic status/event/audit persistence are in fix round5/5 with sole implementer case_schema_fix5. Prior qualified retry/closure work is retained. No full E035 acceptance or merge. Main and paused PR310 unchanged.

Next: review/publish bounded repair, genuine replay + browser + post-browser effects, authentic generated contracts, then remaining source-owned applicability and final same-head review. Source truth supersedes stale checkpoints below.

## Retry qualification complete; Ediel case navigation next — 2026-09-23

Published fe63dd98ad3e736b879a8eef6b4806793c2babef is ALL applicable ordinary CI SUCCESS: OPS35887130604 (native107270182432, verify107270182278, quality107270182217), fullE2E35887130657, browser35887130663, Ediel35887130742 and tenant35887130633. Native124PASS; authentic types/schema reconciled and bounded independent SPEC/QUALITY/native review approved. Successful retry binding task complete. No whole-E035 approval or merge.

Next sole implementer /root/ediel_case_implementation: approved dedicated operational-case view and Control Tower navigation, exact scoped cases/events, read/write permission and actual protected localhost browser qualification. Settled brief/preflight in this plan's SDD workspace. Root records BASE and explicit GO after this checkpoint. Remaining business/time/source tasks and whole-E035 same-head final review follow; main/paused PR310 unchanged. Earlier entries below are historical where conflicting.

## Successful retry binding — round 3 actor fixture, 2026-09-23

Actual327 native114/124 PASS: readiness refresh confirmed ready from actual catalog; remaining10 fail real domain-event actor FK because fixture used customer UUID. Seeded separate local auth.users/active profile actor and replaced19 actor arguments. All124 cases/assertions retained; no production/migration changes. Scripts types/lint/diff PASS; native rerun remains pending. Freeze/pause for root publication and native124, then authentic artifacts/review. Receipt: quality/audits/ediel-masterplan-v2/e035-source-ledger/successful-retry-binding-fixture-actor-20260923.md.

## Successful retry binding — fix round 2/5 frozen, 2026-09-23

Actual e977 native114/118 PASS; four positive real writers blocked by stale August readiness snapshot. Added genuine final-catalog post-replay refresh with before/live/after evidence and fail-closed equality, plus authentic forward20260923154221 checking existing billing month/year/currency/contributor contracts. Published migrations unchanged. Six real-processor insertion/completion-gap regressions added; native124 remains unexecuted locally. Focused52/5, scripts types, ESLint, migration604/508, provenance511, shell syntax/diff PASS. Implementation is not native-qualified. Root publishes own frozen commit, runs native/review and reconciles authentic artifacts; implementer pauses for same-tree synchronization. Report: quality/audits/ediel-masterplan-v2/e035-source-ledger/successful-retry-binding-fix-round2-20260923.md. No hosted writes, generated hand edits, deploy, main or PR310 changes.

## Successful retry binding — fix round 1/5 frozen, 2026-09-23

Coherent candidate includes atomic DB-derived stored-contract sinks with ownership locks, billing ownership RED fixes, actual accepted E30 interval RED fixes, strict null-safe SQL parity, genuine tenantDb ratchet and expanded native/full-processor matrix. Final5939/364coveragePASS, focused52/5PASS, app/tests/scripts typesPASS, lint0errors/1existingwarning, migration603/507+provenance510+ratchet2402PASS. Authentic forward20260923150649 SHAbe5e58728e24c591a0c4d5e38c04ce86b770ed6e717d071b3475f48791a67d1a; old SQL unchanged. Native/review/artifacts pending; parent publishes frozen commit and synchronizes before edits resume. Report: quality/audits/ediel-masterplan-v2/e035-source-ledger/successful-retry-binding-fix-round1-20260923.md. c02 actual82/84 native failures were boolean decoding, corrected without dropping assertions; those historical results do not qualify the new forward. No whole-E035 approval, hosted writes, deploy, main or PR310 changes.

## Resumed with approved syntax exception, 2026-09-23

User explicitly approved the narrow syntax/checksum repair. Read-only hosted Gridex verification found migration20260923135706 absent, binding schema absent and no separate project branches. Fix edf11f92 adds only CASE operand parentheses; all other SQL bytes unchanged. New checksum c6376a62644efe24a733a872410d48d6f74372e68d4c0c56db03fd2a6380df7e. Root publishes for actual native rerun, then sole implementer continues ownership/matrix and tenantDb ratchet repair. Independent checkpoint review resumed. No native/whole-E035 acceptance yet.

## Earlier blocker — approval pause resolved

Native OPS35875416652/job107229927027 on published32d44111 failed before tests/typegen: new migration20260923135706 validator line392 has an unparenthesized CASE operand in its IF. Whole migration transaction rolled back. A later forward cannot repair the earlier unparsable file. Await explicit user direction on the narrow published-immutability exception (original syntax/checksum correction after confirming unapplied status); no such edit made. All implementation paused, new uncommitted native/ownership tests preserved; ownership test RED3/1 exposes further billing attribution drift to fix after resume. Main/PR310/hosted systems untouched. Detailed receipt retry-native-syntax-blocker-20260923.md. Earlier qualification/pending statements below are superseded where conflicting.

## Earlier successful retry checkpoint

Explicitly INCOMPLETE. Integrated producer/private source seal/stored V1/two consumers/natural dedup candidate; local5931/363PASS, app/tests/scripts types PASS, lint0errors/1existingwarning, migration602/506 and staticprovenance PASS. Forward CLI20260923135706 SHA2562e961d22370ead922ee02252a4fa95b77ecd33880f37b9d59fbd8e1a2966ca28. No native execution, generated artifact reconciliation, coverage/final review or whole-E035 acceptance yet. Report: quality/audits/ediel-masterplan-v2/e035-source-ledger/successful-retry-binding-implementation-20260923.md. Root publishes frozen candidate; implementer pauses for publication/same-tree sync, then completes missing full-processor native ACK/completion and mutation cases plus final qualification. Qualified cb5e5f75 case baseline retained; main/PR310 and hosted systems untouched.

# E035 continuation — 2026-09-23, source-backed closure and remaining authority

## Current checkpoint — case types qualified; immutable retry binding active

Published `cb5e5f751c6a537bf4e0e78c1ca827cb720ce6f7` is independently SPEC/QUALITY approved and ALL applicable ordinary CI SUCCESS: OPS35869203217, fullE2E35869203186, browser35869203225, Ediel35869203273, tenant35869203471. Native 62 PASS includes actual persisted Z06/Z10 case assertions. Four unsupported case categories now use schema-valid categories with preserved typed review intent. Production crawler skipped as intended.

Sole active implementer: /root/retry_binding, implementation BASE33fc777076a123b2e6c47b2d3f4ef939833883f4 (review/checkpoint docs above cb5). Read-only preflight complete; explicit GO issued for immutable successful-retry quantity/time/attribution and billing binding across producer, persistence, both consumers and natural dedup. No accepted retry implementation yet. Root owns publication and authentic generated-artifact reconciliation; previous case implementer paused/completed.

Next: qualify retry implementation, then fix confirmed Ediel case-navigation gap, continue remaining applicable business owners/time/source selection, and final same-head whole-E035 review/CI before merge. Rest of masterplan follows; main and PR310 untouched. Earlier pending/failure statements below are historical and superseded by this checkpoint.

## Earlier accepted slice — superseded where conflicting

Published805f5fbb3ee3f7938cba99695c98b0cafbef3b5b is ALL ordinary CI green: OPS35867255996 (native62PASS, verify and quality/build SUCCESS), fullE2E35867255892, browser35867256203, Ediel35867256235 and tenant35867255832. Bounded original Z05L/LK closure is independently accepted for SPEC/QUALITY/native evidence. Authentic schema and types are reconciled; no whole-E035 approval or merge.

Active sole implementer /root/legacy_case_types, BASE805f5fbb: repair four schema-invalid legacy case categories using explicit valid categories and preserved typed intents; no new source authority. Next remains immutable successful-retry quantity/time/attribution binding, prior-guide comparison and queued cancellation/identity/multi-message/changed-start/source-owner work. PR310 and main untouched. The earlier checkpoints below are history, not current pending failures.

## Current checkpoint — 2026-09-23, closure SQL diagnosis

PR370 head `c18355fff4bdb465dc393c485497a8f25ef0e42c` (tree `9bb7a9d854222e07113fce44f2460ab3fedba7a6`) contains reviewed diagnostic instrumentation only above the closure owner. OPS35862101094 is running. The previous diagnostic replay cfe206d produced 57 passing / 4 failing native cases: source-wire, party and seven live row comparisons passed; the closure helper caught a SQL conversion exception. The current replay preserves its original SQLSTATE/context and tests the JSON subtraction precedence hypothesis. No production fix or native owner acceptance yet. Quality gates passed on cfe206d; no schema/type artifacts were generated by its failed replay.

Continue the sole closure implementer fix round2 from the actual diagnostic result, using a new CLI-created forward migration if justified. Published migrations remain immutable. Then qualify closure positives and negatives, reconcile authentic generated artifacts, obtain scoped review and continue the queued adjacent case-type fix, successful-retry content binding, prior-guide comparison, cancellation basis/C, agency89, multiple physical messages and other applicable owners. Final whole-E035 review/CI must share one final head. Main and paused PR310 remain untouched; no hosted writes, deployment or market messages.

Multi-message design is independently SPEC/QUALITY approved after its top-level dispatch barrier amendment. Changed-start and delegated-sender designs are in read-only review. These are engineering preparation, not implemented or accepted source authority. Last fully green published checkpoint is f670fbc3fb33d2612e884e84d70c424be16c3971 (private closure parser only).


Owner replay2b4293b FAILED: retained54 nativePASS/new7FAIL. Sixexposedreallegacycasewriter wrongcolumn+unsupportedcategory; seventh correctly rejectedstalereviewproposal. Fixround1 local3c10f346 repairsactualsite/casepersistence preservingintent andfreshreviewwitness-failure test; SQLguards/migrationsunchanged, full5906/360coverage+types/lintPASS. Scopedfixreview andactualnativeRERUNpending. ClosureNOTDONE. AdjacentunsupportedC/Z06/Z10/unexpecteddirectioncasecategories confirmed andqueuedsequentially, notsilentlyclaimedfixed.

Connected closure owner checkpoint: local78dc3da1c9df71e523923f8418f82bececefb4f9/tree78059a421de3e2acfb5c8ddbb3d629495e97f676 now implements explicit authenticated review producer, sealed-original SQL append, immutable readset/selection, actual UTILTS qualification and review UI. Full5902/359 coverage, app/test types, targetedlint and migration600/504/staticprovenance PASS. Forward114703 SHA6752251826e68de761eec4a7e05b841e2fb755517bf6ba4ad76f19088e7f0fd2. Native24owner+37wire cases NOT YETEXECUTED on this owner; fullindependenttaskreview/artifactreconcile pending. Implementerpaused forpublication/same-tree sync. f670 remains last fullygreen published checkpoint.

Latest checkpoint update: private parser46efcdea passed actual PostgreSQL native37wire+17retained cases and tenant/parity gates in OPS35855300600; run failed final stale-schema comparison. Authentic artifact10747266416 (ZIP SHA2567ff39cb9ce38f62abde3d4a7387d66d7ef18420dd9ec0b8fa31956b1ac43ea7d) supplied verbatim schema/fingerprint; publictypes byte-identical. Root reconcile local77ea6d1f published exacttree as f670fbc3fb33d2612e884e84d70c424be16c3971; ordinaryCI pending. Environment-array marker finding fixed18cases2RED→GREEN and independently SPEC/QUALITYapproved. Full closure producer/SQL append/readset/selection/UI/native lifecycle remains IN_PROGRESS, not qualified. Continue sole implementation; no concurrent second implementer. Do not reset current dirty work to remote; publish exact final committed tree and sync only when implementer paused.

PR370 remains draft/unmerged. Last fully green ordinary candidate0e81b11960ccd980901b8c43356ac8e2edcdf387: OPS35852364010 all3jobs including clean native replay, fullE2E35852363818, browser35852363793, Ediel35852363923, tenant35852363892. Failed-persistence quantity gates and pure E66 extraction are independently task-reviewed; full5823/352 passed before the next closure work. Main eb2b8693 and PR310 OPEN/DRAFT/PAUSED e9611351 remain unchanged.

ACTIVE: Z05L/LK closure private original-wire parser and closed marker checkpoint, explicitly not a completed closure owner. Static parser preflight found no blocking original-binding error; local5875/355 and targeted108/5 pass per implementer, types/lint pass. Genuine native SQL execution, sealed-column append owner, readset/selection/UI and real owner mutation probes remain pending. No incomplete approval branch is enabled. Actual CLI forward20260923113014_ediel_closure_original_wire_binding.sql is now committed in localb6b6c88c. Its SHA256 is18cf2107d2da71a82692a89161e86fadd74c67d02c3e2ea7b20c129a848d361b. Two neverregistered empty earlier timestamp artifacts were removed; no clock spoof, old migration rewrite or fabricated generated contracts.

NEXT: complete closure and independent task/native review; implement confirmed successful-retry content binding (current inbound writer can replace unsealed UTILTS raw under sameID; stored-status alone does not bind amounts/times). Independent revised design requires actual shared consumption contract incl UTC/resolutionFormat/attribution/billing, durable source binding and internal hold for legacy rows lacking proof. Then scoped prior25-A-3 E61/E62 activation using recovered primary source and separate reviewed Z05C cancellation. Other death/bilateral/agency89/multiple-message/delegation/changed-start/pre-ledger owners and final exact-head whole-delivery review remain open.

Frozen P/T/U originals hash-verified. Full priorEnglish25-A-3 and aggregate examples recovered as additional source candidates; selected prior E61/E62 clauses independently support preOctober2026 comparison. This does not qualify allG01/G02 or fabricate historical completeness/bilateral agreements. Swedish+0100 yearround source rule retained; actualruntime+0200 acceptance is not nationalcertification. Audit/design receipts in quality/audits/ediel-masterplan-v2/e035-source-ledger/*20260923.md; nextF3 field composition prep is not acceptance. FullE035/F3/masterplan NOT_COMPLETE. No hostedDB writes, deployment or market messages.

## Historical records (superseded where conflicting)

# Open blockers — 2026-09-23, eac1a604

Authentic eac1a604 replay passed eight retry SQL checks and 17 native structural cases; it failed only on the stale function-body schema snapshot. The artifact has been reconciled locally. Publish, rerun CI and seek reviewer recheck.

1. The reviewed ACK-creation/finalization interruption gap (CodeRabbit5792202498) has a candidate durable plan reservation in eac1a604; native eight-check replay, schema/type artifact, ordinary exact-head CI and reviewer recheck are pending.
2. E035 still needs Z05/Z08 closure, Z06E death/bilateral authority, agency89, multiple physical messages/delegation, changed-start Z04 correction and pre-ledger dated history.
3. F3C-02/04/05/06/07, F0-F7/G01-G07 and paused PR310 parity remain. No E035/masterplan merge or completion.

## Historical records (superseded where conflicting)

# Open blockers — 2026-09-23, current head dce05e48

The dce05e48 disposable replay passed six retry SQL checks and 17 native structural cases, but the job failed on the stale function-only schema snapshot. The authentic artifact has been reconciled locally. Publish the correction and rerun all exact-head gates; final four-part review still pending.

1. Actual empty replay and native six-check committed-retry SQL must pass; schema fingerprint and generated type receipt need reconciliation from that exact replay. The previous 35e35f45 ordinary workflows all passed and its independent review found no confirmed blocking defect, but neither qualifies the new head.
2. E035 applicability/history remains incomplete: Z05/Z08 closure, Z06E death/bilateral, agency89, multi-message/delegation, changed-start Z04 and complete ACK retry behavior. A bounded post-ledger snapshot is not proof of pre-ledger market history.
3. F3C-02/04/05/06/07 and F0-F7/G01-G07 evidence, including paused PR310 schema/rights parity and real legal/transport/TGT owners, remain open. PR370 is draft and unmerged; no full E035/masterplan claim.

## Historical records (superseded where conflicting)

# Open blockers — 2026-09-23

1. The new BGM5 guard needs exact-head ordinary CI/native verification and independent whole-PR review after publication. Parent0f871c78 contract repair local checks passed; its ordinary CI was still running at this read.
2. E035 applicability remains incomplete for Z05/Z08 closure, Z06E death or counterparty bilateral proof, agency89, multi-message/delegated sender, changed-start Z04 correction and acknowledged retry policy. Post-ledger bounded reads do not establish market history before ledger start.
3. F3C-02/04/05/06/07 and later F0–F7 release/counterparty gates remain. PR310 schema/rights parity is paused at e9611351. No E035/F3/masterplan completion or merge claim.

## Earlier records (superseded where conflicting)

# E035 market-structure implementation checkpoint — 2026-09-22

IN PROGRESS / NOT MERGE-READY. Continue PR370 from published64bf9713b412ef629e7c8ecc6bc575e02ff5968f; no restart of Z04 or assessment-history work. Main remains eb2b8693130af8fa7976a93891b95973bc473b50; PR310 remains OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a.

Implemented candidate: explicit authenticated/company-scoped review of the whole original Z04/Z06E/F/G/Z10M; fresh actual canonical/party/point/switch/supply/outbound reads; durable SQL-revalidated owner and separate witness; post-ledger dated supply coverage; explicit BGM5 same-case predecessor assessment/hash; pure before/after meter/register transitions; own immutable snapshot at processing time for E30/E66/S07 comparison; genuine E61/E62 only for proven mismatch; unknown evidence produces internal review, no APERAK/ERR invention or billing quantities. UI original-review action is separate from partial masterdata safe-apply.

Actual verification so far: root5786/349 PASS; actual canonical fixture5/5 PASS; new qualification6/6 PASS (after root run); original diagnostic invariance54/54 PASS on still-applicable rejection and high-resolution energy-only acceptance; application typecheck PASS. The previous monthly accepted-without-structure characterization is intentionally no longer accepted after October activation; new tests assert the hold, no APERAK fallthrough and no quantity persistence. The initially failing17 old characterization cases were not deleted. Lint0errors/104warnings before removing3 newly unused bindings. Tests/scripts typechecks found2 nullable native-test arguments, now corrected; need rerun. New17-case native suite and authentic forward20260922205926 HAVE NOT YET RUN. Native success and final exact-head gates must not be inferred from these unit results.

Next: execute authentic forward and expanded native suite on isolated localhost Supabase2.101.0/PostgreSQL17; fix actual findings, generated-contract checks; publish candidate in existing PR370, run ordinary exact-head CI and independent whole-PR review. Scope review still required for unresolved/closure sources, agency89, multiple physical messages, delegated sender and date-changing Z04 corrections. These remain fail-closed, not claims of universal business-case completion. Full E035/F3/masterplan NOT COMPLETE. No hosted database writes, deployment or real market messages.

## Earlier record (superseded where conflicting)

# E035 witnessed decision timeline — 2026-09-22

PARTIAL / NOT MERGE-READY. Continue existing PR370 / codex/e035-durable-source-ledger-20260922.
The containing Git commit/live PR identifies this candidate. Last fully verified published
baseline de9e459a5843a9cf562436fb46e0376a61a7e53e has ordinary OPS35769648465 all three jobs
SUCCESS, actual8 HTTP/runtime tests and retained71 owner/61 register SQL cases, root5611/344.
Timezone finding4074459282 is independently resolved; that is NOT full E035 review.
Main/accepted PR369 remains eb2b8693130af8fa7976a93891b95973bc473b50, receipt5768848443.

New implementation: read the existing immutable owner snapshot RPC at the exact original
UTILTS receipt cutoff. Validate scope, hashes, complete physical membership, microsecond
instants and entire predecessor chains before disclosing any source. Assessments replace
assessments by predecessor, not clock/UUID/witness-arrival order. A later unwitnessed
assessment blocks fallback to older acceptance; a future correction cannot change earlier
history. This is integrated as durableReceivedSourceInventory.decisionTimeline in the real
UTILTS processor's existing diagnostic envelope, never as an ACK or E61/E62 input.

The new50 pure tests failed50/50 against a no-op, then passed50/50 in an isolated Node22
assertion adapter. This is NOT a Vitest/root/DB qualification claim. Added actual runtime-
owner integration and accepted/rejected business-outcome tests, plus two real Supabase HTTP
history/correction cases. Their genuine project/native execution is still a separate gate.
Existing migrations, generated database contracts, business decisions and assertions remain.
No new migration, hosted database mutation, production deployment or market message.

Remaining: supported Z04 approval does not supply missing Z06/Z10/agency89/multi-message/
delegated-sender owners. Bounded read completeness is NOT dated market-history completeness.
Cross-source market supersession and authoritative E61/E62 selection are NOT implemented.
Full E035/F3/masterplan remains incomplete. D110/110 + parents10/10 retained.
PR310 remains OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a, untouched.
Known existing public.gridex_grid_owner_name_key mutable-search_path advisor remains.

Audit: quality/audits/ediel-masterplan-v2/e035-source-ledger/decision-timeline-20260922.md

Next action: Qualify the current decision-timeline source and actual HTTP/native correction tests; inspect exact-head ordinary CI and independent TASK/SPEC, QUALITY, TENANT-BOUNDARY and WHOLE-PR review. Then complete applicable missing business owners, dated market completeness, cross-source supersession and E61/E62 selection. Do not redo de9e459 or merge a checkpoint.

## Previous runtime-owner checkpoint — SUPERSEDED by source and terminal receipts above

# E035 live-owner runtime continuation — 2026-09-22

PARTIAL / NOT MERGE-READY. Existing PR370 on codex/e035-durable-source-ledger-20260922.
The containing Git commit/live PR identifies this candidate. Baseline d7fb49fde3dae153693acae1cefa33aeef45ad4f
already passed ordinary OPS35758893367 (all three jobs); do not repeat its recovery.
Accepted main/PR369 remains eb2b8693130af8fa7976a93891b95973bc473b50.

Substantive new runtime code: fresh canonical receipt handoff; exact-count bounded tenant
identity reads; selected facility/grid-owner legal-party binding; a callback from the actual
successful Z04 switch-confirmation AND supply-period writes; immutable owner composition
plus a separate committed-availability RPC. The real inbound processor invokes these paths.
All physical objects remain represented. No callback, copied receipts/status JSON, incomplete
reads, unmatched namespaces, or missing owners can create accepted evidence. Diagnostic
failures retain original business and ACK behavior. Supported approval is the source-bound
Z04 legacy switch/supply path, not arbitrary Z06/Z10 review cases or SMTP authentication.

New source is newly implemented here, not a recovery of the previously reported5758/347
continuation (still NOT RECOVERED / NOT REVERIFIED). Existing original source/discovery,
canonical register facets, database owner/snapshot contracts and regression assertions remain.
The authentic new forward20260922175540_ediel_source_owner_timezone.sql was CLI-created in
run35763799597, artifact10710533967. No existing migration was edited.

Test-first evidence: initial business/count-owner tests9FAIL/3PASS, then34PASS including
retained identity cases; composition21FAIL/6PASS then27PASS; actual processor missing-hook
assertions2FAIL/1PASS then3PASS. These unit tests replace only external IO. The separate
native suite uses actual Supabase HTTP, real canonical registry, real business writes and
PostgreSQL RPCs, and must pass with repeated generated contracts before acceptance.
Native qualification, current-head ordinary CI and independent review are tracked in PR370
terminal receipts. Do not infer PASS from this implementation checkpoint or baseline CI.

Full E035/F3/masterplan and temporal comparison remain INCOMPLETE. D110/110+parents10/10 retained.
PR310 OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a, excluded and untouched.
No hosted database, deployment, provider/market change or external message. Known existing
public.gridex_grid_owner_name_key mutable-search_path advisor remains disclosed.

Next action: Inspect current runtime-owner native qualification and exact published-head CI/review; finish any real failures, then implement dated completeness, timeline/supersession and E61/E62 only from fully witnessed owner evidence. Keep existing PR370 draft; no checkpoint merge or repeated database recovery.

## Historical records — superseded where contradicted above

# E035 recovered database continuation — 2026-09-22

PARTIAL / NOT MERGE-READY. Active PR370, codex/e035-durable-source-ledger-20260922.
Resolve the current candidate from the containing Git commit and live PR metadata.
Last verified published baseline: bc6085e192bbab4da50b9db9d47bb27b73178b87,
ordinary OPS run35741940986, all three jobs PASS. Main/accepted PR369 remains
 eb2b8693130af8fa7976a93891b95973bc473b50.

Preserved implementations: immutable received originals/discovery/canonical evidence,
actual per-object register validation and explicit-time tenant identity provenance.
Recovered database work: immutable owner assessments, committed-availability witnesses,
bounded immutable decision snapshots and message-local LIN uniqueness via a forward
migration. This does NOT deliver full runtime source approval or E61/E62 selection.

Native run35747547629 at4a502344: 71 owner SQL checks, 61 register SQL checks,
retained suites and real concurrency/snapshot/role/budget probes PASS. The valid
multi-message LIN case failed before the correction and passed afterward. Repeated
schema/type bytes and artifact checksums were independently checked by the implementing
assistant, not an independent reviewer. New regressions are wired into ordinary replay.

The previously reported 5758-tests/347-files TypeScript continuation was not recovered
in this session. Neither pinned preparation source nor its native artifact contains it.
Do not claim those results were reproduced or that missing runtime code is published.
Application and test source from the 5565-test published baseline stays unchanged.
Full tenant/legal-party/business runtime dispositions, source approval,
timeline/supersession/E61/E62 remain incomplete. Exact-head final CI and independent
whole-PR/requirement/tenant-boundary review are mandatory. Green CI alone is not merge approval.

PR310 stays OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a.
No PR310 source/proof infrastructure, hosted database, deployment or market message.
Native advisors retain the existing public.gridex_grid_owner_name_key mutable
search_path warning; this is not a globally clean advisor result.

Next action: Inspect ordinary CI and independent review for the current PR head; then complete runtime tenant/legal-party/business disposition owners, full source approval and later timeline/supersession/E61/E62. Preserve implemented facets and the qualified database continuation; do not repeat qualification/publication or merge a checkpoint.

See quality/audits/ediel-masterplan-v2/e035-source-ledger/resume-db-qualification-20260922.md

## Historical records — superseded where contradicted above

# Continuation update — 2026-09-22

Authoritative baseline is PR370 head92d4980e5f1e068a3d33826f4ef75d086bfaf714, main eb2b8693130af8fa7976a93891b95973bc473b50. OPS35719151591 all three ordinary jobs passed. Other workflows were inspected separately: public browser, coverage and smoke passed; staging/real-customer and production crawler skips are NOT executions. The two prior CodeRabbit findings were confirmed resolved; no full E035 approval follows from that.

New work in progress: capture actual canonical register-owner results per physical object and register occurrence, bind to original bytes and registry evidence, extend append-only validation SQL with strict optional facets. Full source flags remain closed. Bounded independent TS review and static SQL review found no blocker; native35733978604 passed58SQL and actual concurrent immutable corrections; overall preparation failed later because marker migrations were not restored before file-contract tests. CLI-created forward migration20260922131136 and repeated DB-generated schema/types are verified; manifests updated. Local5565/340tests, app/tests typechecks and lint0errors pass. No final-head verification or merge is claimed.

Owner mapping found reusable legal tenant/role/delegation and facility grid-owner decisions; missing hooks are implementation work, not a user-policy blocker by themselves. Explicit-time identity provenance is implemented and independently reviewed; it remains current-read evidence, not historical knowledge or full source approval. Full tenant/party/business approval integration, immutable full dispositions, timeline/supersession and actual E61/E62 comparison are still outstanding. Continue substantive implementation. See continuation-20260922.md and owner-map-20260922.md in the E035 audit folder. PR310 remains OPEN/DRAFT/PAUSED e9611351, excluded. No live operations.

## Earlier notes (historical, superseded where contradicted above)

# Active gates — E035 durable-source candidate

1. Final ordinary actual-head CI (types, tests, lint, build, API/RBAC, coverage, clean replay and schema/type consistency) is not yet accepted. Preparation35713214457 had a successful native step and5514 passing tests but overall FAILURE; this candidate addresses its BigInt syntax and temporary-copy contamination. No exclusions or thresholds were relaxed.
2. Independent completed TASK/SPEC, QUALITY, TENANT-BOUNDARY and WHOLE-PR review is pending. Self-checks and mutation tests are not independent review.
3. Full immutable source disposition still needs actual per-object canonical register, accepted tenant/legal-party and business acceptance owners. Existing canonical-runtime evidence is only a facet and cannot approve a source. No authoritative timeline, supersession or E61/E62 selection exists.
4. Lawful retention/purge and live rollout approval remain unresolved; append-only history is not a claim of indefinite lawful retention or resistance to a database superuser.

Native PostgreSQL crash fixed narrowly by verified vendor image17.6.1.155 in disposable replay only. Real denied-EXECUTE test, hint roles, RLS and all prior tests remain. PR310OPEN/DRAFT/PAUSED e9611351 is excluded, not completed. FullE035/F3/masterplan incomplete.

## E035 fix5 published checkpoint — 2026-09-23
Published8092ad6 restores legacy case events and makes scoped status/event/audit atomic. Independent static SPEC/QUALITY approved; native acceptance withheld. Targeted29/7 and all three typechecks pass. OPS35901488883 native107318534277 stopped on GHCR rate limit before DB startup; genuine native/browser not executed. Types gate correctly rejects stale migration tail; full E2E14/15 fails only that gate. Tenant, Ediel and general browser workflows pass. Next: retry authentic replay, reconcile authentic generated artifacts, then qualify case flow before remaining E035 owners. No merge or hosted writes.
## 2026-09-24 — Remaining after point-scope repair

Task3b point UUID-to-physical mapping passed native313/313 at OPS35995196628. Historical inception, swallowed event producer and signed/legacy/claim/retention routes remain unqualified; `complete:false` is mandatory. Task4 still needs one MVCC statement for source, correction and process sets; the pure comparator seam alone is not activated. Full review and final same-head gates remain before merge.
## 2026-09-24 — Active PR372 gates

Combined migration native314/314 passed; active integration b1c7f993 needs authentic canonical schema reconciliation from OPS35999644966, exact-head all applicable CI, and independent full requirement/tenant review. Task3b producer, deletions, archive and pre-epoch history coverage remain incomplete and must retain complete:false. Do not merge PR372 yet. PR310 paused and excluded.

## 2026-09-24 — PR372 bounded hold and schema gate green

OPS schema/type mismatch is resolved on 521bc9ba / OPS36003339938; native314/314 and all applicable workflows green. Remaining blockers: Task3b direct/legacy/claim/archive/deletion producer qualification, swallowed event and pre-epoch/retention gaps; Task4 outbound Z08H and document reference in the single-MVCC saved receipt, scoped complete/incomplete inspection and full real-flow/native concurrency review. No full Task4 or E035 acceptance; PR372 remains draft.
## 2026-09-24 — Current PR372 blockers after canonical archive

Archive and swallowed-event paths passed native316 and317 respectively; `94eb110d` claim replay pending. Task3b still requires real signed/legacy and remaining producer-route qualification plus honest pre-epoch/retention gaps (`complete:false`). Task4 combined saved cutoff includes received source/process/correction but omits outbound Z08H and document reference; actual UTILTS hold, scoped complete/incomplete and concurrency acceptance remain. No merge or ready-for-review claim before final same-head review and all applicable CI. PR310 excluded.
## 2026-09-25 — PR372 active acceptance blockers

- Independent review R1: source/concern owner budget is tenant-wide on
  published `16505294`; local forward and >1,000 unrelated-row fixture await
  native replay.
- Independent review R2: current physical point alias alone can omit historical
  linked evidence after a point identity change. No accepted fix or native proof.
- OPS `36105666765` native 322/324: two new test assertions expected no ACK
  (but transport CONTRL is allowed) and explicit `false` from an omitted
  optional property. Locally corrected; exact-head replay pending.
- Signed/remaining legacy Task3b producers, retention limits, Task4 negative
  and concurrency boundaries, whole-diff re-review, authentic final schema
  evidence and final-head CI remain open. No merge.
