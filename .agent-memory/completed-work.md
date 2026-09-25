## 2026-09-25 — Switch-event UUID-avgränsning verifierad på PR #372

Publicerad kodhead `f75b69ea9312f2e3c8d76c8e4aab47a25573322f`, träd `2335ba5737f3c49b2ea7befac6eeb8037ba0c450` (lokal källcommit `2be58f04f6d67300d82a41f4ed444fa44a09a67e`, identiskt träd). Föregående `8800d014` hade native 336/337: `unrelated process volume does not exhaust a linked UTILTS subject budget` gav `scoped_process_count_overflow`, `factCount:1013`, väntat `['INSERT']`, observerat `[]`. Verifierad kodorsak: `switch_event_subject_v1` i forward `20260925150000_e035_switch_event_owner_history.sql` använde UUID-regex `8-4-4-12` och behandlade därför giltiga request-/point-ID:n som okänd wildcard. Ny framåtriktad migration `20260925154500_e035_switch_event_uuid_shape.sql` använder `8-4-4-4-12`; native-testet kräver relevant historisk ägare, exkluderad orelaterad ägare och fortsatt wildcard för ogiltigt ID.

OPS `36143179178` på exakt `f75b69ea`: verify `108097720596` SUCCESS, quality/build `108097720997` SUCCESS, clean replay `108097721099` SUCCESS med **337/337 native i fem filer**, case-view 1/1, tenant/paritet och autentiskt schemafingeravtryck `c3ec834faa7c27e3db0f4424a2afcc8205ea4bf17035b8c7d5aba56b4b0bdb37`. Tenant `36143179172`, browser `36143179242`, Ediel `36143179301`, full E2E `36143179256` SUCCESS; crawler `36143179413` SKIPPED. Lokalt passerade migration/integritet och typmanifest, scripts typecheck, scoped lint, filbudget och diff check. Supabase CLI saknades lokalt; den nya forward-filen skapades därför manuellt enligt repots migrationsformat och kvalificerades i ren CI-replay, utan hosted databasåtgärd.

Detta löser den avgränsade UUID-/budgetregressionen. Task 3b/4:s återstående producent-/legacy-, cutoff-, overflow-, behörighets-, historik- och retentionmatris, oberoende full-diff-slutgranskning och sluthead-gates kvarstår; pre-epoch `complete:false`. Originalets intermittenta Storage-`unconfirmed` saknar fortfarande identifierat felsteg och kausal rättning. PR372 är open/draft, ingen merge/produktion; PR310 orörd. Nästa: oberoende granska den publicerade rättningen mot hela diffen och prioritera ett konkret återstående acceptansfall, därefter kvalificera exakt sluthead innan merge.

---

## 2026-09-25 — Verifierad publicering inför paus

GitHub PR372 bekräftades open/draft på `528baa6db4fa15551888a300f22617fc3a09d684`; lokala `01684a3f172c282296da36adf5cd9893f56199c0` har identiskt träd `cb24b7d9eb391bb641a40223de4a0a7c480ac4c6`. Föregående `c71f312a` klarade OPS `36129656763` med native 337/337 och alla tillämpliga flöden. På `528baa6d` var verify, tenant, Ediel, browser och full E2E gröna vid kontrollen; quality/native pågick. E30/S07 inbound-testets native-acceptans är inte färdig. Se `.agent-memory/pr372-pause-20260925.md`.

---

## 2026-09-24 — E035 Task3b bounded verification

Authentic schema from artifact10800669994 published at37a7052 and passed all applicable CI (OPS35988188001). Native cascade/SET NULL test at9186e47 passed312/312 plus ordinary gates (OPS35988546648). Point reassignment and supply period transition/deletion at28694d2 passed312/312 plus ordinary gates (OPS35989469066). Archive-style graph tombstones at7491e16 passed312/312 and ordinary gates (OPS35990306080). This is a verified subset, not Task3b acceptance or Task4.

# E035 Task2b document context reviewed; native261 pending — 2026-09-24

Source-onlyTask2a accepted8fde5f26, acceptanceBASE0a528215 alsoallCIgreen. Currentdocumentimplementation07d3b9c5 +fix1 638926b4 independentlySPEC/QUALITYAPPROVED,0open. Reference-only context: triplepermissions/actualtenantgraph, durableattemptbefore2MiB/10sec streamingreadback, separateobservation/append/witness andincompleteepoch; savedpayload preservesimmutableidentity/xids/visibility. NoPDFcopy/newretention/positiveC/reopening. PublishedsourceSQLunchanged; documentforwardnotyetpublished.

Local64/5,3typechecks(initialapp thenunchanged),lint,integrity612/516PASS. ActualSDK/Node/loopback header/bodytests2PASS/35skipped; no projectDB/Storagequalification implied. Expectedmandatorynative261/5 =retained224+document37. Next: publish exactreviewedcheckpoint fromAPIparent0a528215, runrealnativeSQL/Storage, reconcilegenuinegeneratedartifacts thenindependentreview/acceptance. Task2bnotyetaccepted; Task3processhistory andTask4UTILTS remain. Allreports/fixtures/constraints saved; PR372draft, PR310excluded, fullE035partial, userapprovalpersists.

# E035 source capture Task2a accepted; document Task2b next — 2026-09-24

Accepted source-only head8fde5f2644a87351a5dbe42d8a694d33a606ba8d/treef23f346b065b43c70d662c0ba8006d00c21cfb59. All applicable same-headCI SUCCESS: OPS35942941358 (native107454629303, verify107454629433, quality107454629457), Ediel35942941365, fullE2E35942941357, browser35942941360, tenant35942941361; crawlerSKIPPED. Actualfull6038/374+build, native224/4+case1/browser2/postbrowser1, SQL/concurrency, types, tenant invariants, parityselftest and exactschema PASS. Artifact10785568965 ZIP SHA25695bdfdd9e3bba4569751b787e7d6f4eab058926a4dd02c2d6c671b5a76aaf6ff; types/schema/fingerprint byte-identical. Independent final native/schema SPEC/QUALITY ACCEPTS bounded Task2a. Five-round repair gate closed with0open; no sixthwave. No PR372 merge or wholeTask2/E035 completion.

Next active item: prepared Task2b reference-only document context, sole author document_reference_task2b. Parent supplies START and immutableBASE after publishing this receipt. Brief/report in .superpowers/sdd/2026-09-24-e035-correction-context and tracked audits. No copiedPDF/newretention/positiveC; actual2MiB/10sec bounded readback afterdurableattempt, independentlycheckedsource/point/site/supply/contract/documentgraph and triplepermissions. Native/contracts remain parent-owned.

Task3 partial process/outbound history and Task4 conditional single-MVCC UTILTS holds follow. FullE035partial (Z06E/changedstart/delegation/agency89/multiplephysical/history remain). PR371 prior25-A-3 E61/E62 acceptedmerged2a148d39; PR310excluded. User continuation/publication/CI/gatedmerge approval persists. No hostedwrites/deployment/marketsends.

## 2026-09-24 — Source capture native and contract evidence

Actual6091edc7 OPS35942242226/native107452448227:224/4,case1/browser2/postbrowser1,types,tenant andparityPASS. Onlyexpectedoldschemamismatch; authenticartifact10785596678 copied/independentlyverified, SPEC/QUALITYAPPROVED. FinalsameheadCIpending beforeTask2aacceptance; fullTask2/E035incomplete. Fixround5 exactownedfixturecleanupresolved F3 withoutproduction/invariantchange.

## 2026-09-24 — PR372 source capture repair checkpoint

Task2 fixround4/5 dba55466..05461a63 scoped SPEC/QUALITY APPROVED,0open; registry+scope findings addressed. Native224/artifacts pending, source-only capture not accepted. Parent exacttree publication next.
Local71/4, scripts types/lint and integrity611/515 PASS. Latest genuine native195/206 FAIL; new224 not executed. Source/version inventory verifies5original hashes with bounded historical gaps. User-authorized continuation remains active.

## Verified bounded progress — 2026-09-23

Case repair static SPEC/QUALITY approved, targeted29/7 and full CI5963/370 pass. Registry recovery reviewed and actual ECR startup/canonical replay succeeds in35903332327. Retained124 native pass. Case suite remains FAILED on migration-path fixture integration; case task/full E035 NOT complete.

## Retry qualification complete; Ediel case navigation next — 2026-09-23

Published fe63dd98ad3e736b879a8eef6b4806793c2babef is ALL applicable ordinary CI SUCCESS: OPS35887130604 (native107270182432, verify107270182278, quality107270182217), fullE2E35887130657, browser35887130663, Ediel35887130742 and tenant35887130633. Native124PASS; authentic types/schema reconciled and bounded independent SPEC/QUALITY/native review approved. Successful retry binding task complete. No whole-E035 approval or merge.

Next sole implementer /root/ediel_case_implementation: approved dedicated operational-case view and Control Tower navigation, exact scoped cases/events, read/write permission and actual protected localhost browser qualification. Settled brief/preflight in this plan's SDD workspace. Root records BASE and explicit GO after this checkpoint. Remaining business/time/source tasks and whole-E035 same-head final review follow; main/paused PR310 unchanged. Earlier entries below are historical where conflicting.

## Successful retry binding — round 3 actor fixture, 2026-09-23

Actual327 native114/124 PASS: readiness refresh confirmed ready from actual catalog; remaining10 fail real domain-event actor FK because fixture used customer UUID. Seeded separate local auth.users/active profile actor and replaced19 actor arguments. All124 cases/assertions retained; no production/migration changes. Scripts types/lint/diff PASS; native rerun remains pending. Freeze/pause for root publication and native124, then authentic artifacts/review. Receipt: quality/audits/ediel-masterplan-v2/e035-source-ledger/successful-retry-binding-fixture-actor-20260923.md.

## Successful retry binding — fix round 2/5 frozen, 2026-09-23

Actual e977 native114/118 PASS; four positive real writers blocked by stale August readiness snapshot. Added genuine final-catalog post-replay refresh with before/live/after evidence and fail-closed equality, plus authentic forward20260923154221 checking existing billing month/year/currency/contributor contracts. Published migrations unchanged. Six real-processor insertion/completion-gap regressions added; native124 remains unexecuted locally. Focused52/5, scripts types, ESLint, migration604/508, provenance511, shell syntax/diff PASS. Implementation is not native-qualified. Root publishes own frozen commit, runs native/review and reconciles authentic artifacts; implementer pauses for same-tree synchronization. Report: quality/audits/ediel-masterplan-v2/e035-source-ledger/successful-retry-binding-fix-round2-20260923.md. No hosted writes, generated hand edits, deploy, main or PR310 changes.

## Successful retry binding — fix round 1/5 frozen, 2026-09-23

Coherent candidate includes atomic DB-derived stored-contract sinks with ownership locks, billing ownership RED fixes, actual accepted E30 interval RED fixes, strict null-safe SQL parity, genuine tenantDb ratchet and expanded native/full-processor matrix. Final5939/364coveragePASS, focused52/5PASS, app/tests/scripts typesPASS, lint0errors/1existingwarning, migration603/507+provenance510+ratchet2402PASS. Authentic forward20260923150649 SHAbe5e58728e24c591a0c4d5e38c04ce86b770ed6e717d071b3475f48791a67d1a; old SQL unchanged. Native/review/artifacts pending; parent publishes frozen commit and synchronizes before edits resume. Report: quality/audits/ediel-masterplan-v2/e035-source-ledger/successful-retry-binding-fix-round1-20260923.md. c02 actual82/84 native failures were boolean decoding, corrected without dropping assertions; those historical results do not qualify the new forward. No whole-E035 approval, hosted writes, deploy, main or PR310 changes.

## Successful retry binding — first native checkpoint, 2026-09-23

Explicitly INCOMPLETE. Integrated producer/private source seal/stored V1/two consumers/natural dedup candidate; local5931/363PASS, app/tests/scripts types PASS, lint0errors/1existingwarning, migration602/506 and staticprovenance PASS. Forward CLI20260923135706 SHA2562e961d22370ead922ee02252a4fa95b77ecd33880f37b9d59fbd8e1a2966ca28. No native execution, generated artifact reconciliation, coverage/final review or whole-E035 acceptance yet. Report: quality/audits/ediel-masterplan-v2/e035-source-ledger/successful-retry-binding-implementation-20260923.md. Root publishes frozen candidate; implementer pauses for publication/same-tree sync, then completes missing full-processor native ACK/completion and mutation cases plus final qualification. Qualified cb5e5f75 case baseline retained; main/PR310 and hosted systems untouched.

# Verified scoped work — case types and bounded closure, 2026-09-23

Case-type repair cb5e5f751c6a537bf4e0e78c1ca827cb720ce6f7: independent SPEC/QUALITY approval, native62PASS including persisted Z06/Z10 cases, all applicable ordinary CI SUCCESS. Four schema-invalid categories now preserve distinct typed intent under valid categories. Prior bounded original Z05L/LK closure805f5fbb is likewise independently reviewed/native-qualified and all ordinary CI green. Neither result is whole-E035 approval. Successful-retry binding and the separate case-navigation finding remain open.

## Earlier scoped work

The Z06E owner gate's clean-replay generated schema and manifest were reconciled in PR370 commit0f871c78; local migration/type checks passed and public type bytes matched the native artifact. An unreviewed BGM5 later-dated correction revival was reproduced red then prevented with a pure selection guard; 97 targeted cases, app/test typechecks and the Node22 full suite (5793/350) passed locally. Neither item is final E035 or masterplan approval.

## Earlier records (superseded where conflicting)

# Completed evidence — current E035 continuation

2026-09-22: PR369/main eb2b8693 is accepted by actual-main receipt5768848443. The older entry below is a historical pre-merge snapshot, not current status. Durable-source native preparation35713214457 passes105newSQL,62+84retainedSQL,3retained upgrade and20native probes; repeated genuine schema/types inspected. Root5514/337 tests and migration/ratchet checks pass. Overall preparation is FAILURE from root type/lint checks, now addressed by exact BigInt constructors and a clean delivery tree; final ordinary actual-head CI/review is not completed. Source/object/party approval and E61/E62 remain unimplemented. See native-verification-20260922.md.

## Historical PR369 pre-merge entry — SUPERSEDED by receipt5768848443

AcceptedPR368/maina0e7ebdd remains final accepted runtime;5300/330,73/73,allOPS in receipt5766791083. PR369 source/design5768354034 and complete-outcome oracle5768382713 resolved pre-implementation conditions. Actual c6 ordinaryRED5353total/5307PASS46FAIL;all5300 prior testsPASS. Actual84SQL14PASS70FAIL after62 priorPASS.

Native6400ccc2/run35664024836 now verifies the bounded production candidate:53/53 targetedTS,84/84contextSQL,62/62priorSQL,3/3 actual migration collision/lock probes; repeatedtypes identical and fullschema exactly the intended function delta. Root verified downloaded artifact10668686301 hashes and source bytes. Scratch files excluded from delivery. Final ordinaryCI/review/merge/mainacceptance are NOT listed as completed.

FullE035/F3/masterplan remain incomplete;D110/110+10/10 retained,PR310paused/untouched. Historical state remains in Git atc6e624e2.


# E035 market-structure implementation checkpoint — 2026-09-22

IN PROGRESS / NOT MERGE-READY. Continue PR370 from published64bf9713b412ef629e7c8ecc6bc575e02ff5968f; no restart of Z04 or assessment-history work. Main remains eb2b8693130af8fa7976a93891b95973bc473b50; PR310 remains OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a.

Implemented candidate: explicit authenticated/company-scoped review of the whole original Z04/Z06E/F/G/Z10M; fresh actual canonical/party/point/switch/supply/outbound reads; durable SQL-revalidated owner and separate witness; post-ledger dated supply coverage; explicit BGM5 same-case predecessor assessment/hash; pure before/after meter/register transitions; own immutable snapshot at processing time for E30/E66/S07 comparison; genuine E61/E62 only for proven mismatch; unknown evidence produces internal review, no APERAK/ERR invention or billing quantities. UI original-review action is separate from partial masterdata safe-apply.

Actual verification so far: root5786/349 PASS; actual canonical fixture5/5 PASS; new qualification6/6 PASS (after root run); original diagnostic invariance54/54 PASS on still-applicable rejection and high-resolution energy-only acceptance; application typecheck PASS. The previous monthly accepted-without-structure characterization is intentionally no longer accepted after October activation; new tests assert the hold, no APERAK fallthrough and no quantity persistence. The initially failing17 old characterization cases were not deleted. Lint0errors/104warnings before removing3 newly unused bindings. Tests/scripts typechecks found2 nullable native-test arguments, now corrected; need rerun. New17-case native suite and authentic forward20260922205926 HAVE NOT YET RUN. Native success and final exact-head gates must not be inferred from these unit results.

Next: execute authentic forward and expanded native suite on isolated localhost Supabase2.101.0/PostgreSQL17; fix actual findings, generated-contract checks; publish candidate in existing PR370, run ordinary exact-head CI and independent whole-PR review. Scope review still required for unresolved/closure sources, agency89, multiple physical messages, delegated sender and date-changing Z04 corrections. These remain fail-closed, not claims of universal business-case completion. Full E035/F3/masterplan NOT COMPLETE. No hosted database writes, deployment or real market messages.

2026-09-23:62a7d08 OPS35918298886/native107375437512 native156+SQLretry8+case1+browser2+postbrowser1+tenant/parityPASS. Authentic artifact10776516395 schema/types hashes verified and reconciled; final same-head CI/artifact review pending, no merge yet. R1–R4+C1 static reviewed; E035partial.

## 2026-09-24 E035 continuation
Locally implemented prior25-A-3 source comparison and narrow singleton E30 correction through1f0bffc0; local SPEC/QUALITY approved, full6003tests and types pass. This is local completed engineering only, not native-qualified delivery.

# E035 prior-guide delivery accepted; correction-context task starts — 2026-09-24

PR371 MERGED at main2a148d39d631fc759c99cd1c69350b5e2147dbdb. Final PR head65f5b896cd3801eedde43db99df38afa6d9c78a1 passed all applicable CI: OPS35931020643, Ediel35931020535, browser35931020629, fullE2E35931020592; crawler skipped. Full6003/372, native166/3, case1/browser2/postbrowser1, SQL/concurrency/tenant/parity and build PASS. Independent whole-branch SPEC/QUALITY and final native scope ACCEPT, zero findings. Artifact10780533571 SHA256f25a0560519fd313d3e0e5e068145d74823b4d1bbedad3d3237f129d0623eacc independently verified; generated contracts byte-identical, no migration. Final native addendum retained in audit directory. Earlier publication/native blockers below are SUPERSEDED.

Active branch codex/e035-correction-context-20260924 from accepted main2a148d39. One active item: hold-only correction-context/process-history slice for Z05C/corrected end. Plan docs/superpowers/plans/2026-09-24-e035-correction-context.md. Start pure earliest-boundary projection, then immutable capture, outbound/process history and service-owned saved-cutoff composition. Do not issue positive C/reopening authority. Unknown historical dispatch/retention remains unavailable. Full E035/G01/F3/masterplan PARTIAL; Z06E/changed-start/agency89/multi-message/delegation/history remain subsequent owners. PR310 excluded.

Next exact action: generate Task1 brief and SDD ledger; implement pure blocker with boundary/scope tests and independent review. Follow finite task gates, real native qualification and generated-contract reconciliation for later SQL integration. User approval covers continuation/publication/review/merge after gates; no hosted writes/deployment/market sends.

## 2026-09-24 — Task2b document references ACCEPTED; Task3a next

Task2b accepted runtime7581966b75165b2fd88de05756913cb673cd4a32, tree d77b4ba73e67caf78eab951ffcc5ef3ed05e3e10. All applicable same-head workflows SUCCESS: OPS35949827423 (verify107475755293,quality107475755157,native107475755339), fullE2E35949827409,browser35949827480,Ediel35949827343,tenant35949827368; crawler35949827390 skipped. Native262/5 plus case1/browser2/postbrowser1, retained SQL/concurrency, types, tenant invariants, parity and schema PASS. Prior full6062/376 and final quality/build green. Independent native/schema SPEC/QUALITY approved zero findings. Final artifact10788357629 ZIP SHAb187af683ab68fa6debac16883aca049d0d2fc8733039921b07a7314b93b0a6b verified; all three generated files byte-identical. Reference-only context, authority:none/coverage:incomplete; no PDF copy/new retention/positive C or reopening.

Next single active item: Task3a outbound provider-entry fence and immutable receipts, prepared author outbound_fence_task3a. Publish this acceptance checkpoint, then explicit immutable BASE/START. Narrow approved sendEdielEmail callback after S/MIME archive and before either sendMail included; no Task3b or Task4 edits. Full Task3, full E035 and PR372 delivery remain incomplete. PR372 stays draft, PR310 excluded. User authorization covers continuation/publication/gated merge; no hosted writes/deployment/market messages.

## 2026-09-24 — Task3a ACCEPTED; Task3b next

Accepted runtime d7cbab18b9b102e00cde256bc91c22271455d7c8, tree66c82f59b88969b43326f7f34bd11ad432412cff. All applicable same-head CI SUCCESS: OPS35958136936 (verify107500725279,quality107500725385,native107500725396), fullE2E35958136881, browser35958136874, Ediel35958136896, tenant35958136892; crawler35958136976 skipped. Full6072/377, native301/5 plus case1/browser2/postbrowser1, types, tenant invariants, parity, schema, build/bundle PASS. Independent static/fix/native/schema SPEC/QUALITY approved. Final artifact10791646035 ZIP73ad030582646cb7e851c348f28867c3f32e45a1e3ab65e3a1a659acf9ef8614 verified; all three generated files byte-identical. Types32ae2f06, schemaef41ebad, fingerprint04ba0c99.

One next active item: Task3b twelve-table customer/process facts, prepared brief, fresh sole author after acceptance checkpoint publication. Genuine acceptedBASE schema artifact is available in /workspace/scratch/4b1d39503015/e035-pr372-outbound-final; use it plus real native catalog probes, not source-only assumptions. Parent owns nativeCI/generated artifacts. Task4 single-MVCC composition and later E035 owners remain pending. No fullTask3/E035 or PR372 merge claim. PR310 excluded; user authorization persists.

Authoritative workspace remains /workspace/scratch/4b1d39503015/gridex-ops-platform/.worktrees/e035-task3a-isolated. Original checkout is preservation-only. Deferred final-review items: dense adapter formatting; canonical fingerprint covers public/gridex_received_sources, not gridex_outbound_dispatch (private behavior has native/migration proof). No hosted writes/deployment/market sends.
## 2026-09-25 — Field313 bounded local verification
Complete E66 XX + E19 RED then local 276/276 UTILTS GREEN; actual inbound mocked boundary shows negative APERAK and no meter/billing effect. Two-IDE missing-ID/E19 already correct. App/test types, lint/diff pass; native and own published CI not yet executed for this batch, no masterplan acceptance implied.

## 2026-09-25 — Field502 agency bounded local verification
Complete E66 wrong agency plus E19 RED; annex C agency260; local 273/273 UTILTS GREEN, app/test typecheck, lint/diff PASS. Native and published CI not yet executed for this batch; no masterplan acceptance implied.

## 2026-09-25 — Field502 bounded local verification
Complete E66 phase E99 plus E19 RED; source list E02/E03/E04; local 272/272 UTILTS GREEN, app/test typecheck, lint/diff PASS. Native and published CI not yet executed on this batch; no masterplan acceptance implied.

## 2026-09-24 — Bounded PR372 checkpoint

At published 562015b, a forward process read function resolves UUID-linked process rows against immutable physical point facts. OPS35995196628 passed native313/313 plus case/browser and generated type/schema hashes. The pure UTILTS comparison seam was exercised RED then GREEN58/58 locally; it is not an active Task4 service hold. Task3b historical completeness and Task4 remain open.
## 2026-09-24 — Task4 bounded implementation

PR372 b1c7f993 publishes the one-SELECT combined source/correction/process snapshot, immutable private receipt, service-only RPC, and active UTILTS hold for witnessed C concerns. It reuses the source timeline with exact source hash and same cutoff; wildcard/unwitnessed concerns remain unavailable. Native314/314 passed for the database predecessor. Authentic generated type bytes copied from artifact10807456195. Canonical schema and final CI/review are still gates, so Task4 is not accepted. Task3b remains prospective with incomplete history.

## 2026-09-24 — PR372 bounded hold and schema gate green

Bounded Task4 hold integration and canonical schema reconciliation: PR372 head521bc9ba, OPS36003339938 native314/314, case1/browser2/postbrowser1, tenant invariants/parity, schema check fingerprint5e3db200 and all applicable same-head workflows SUCCESS. This is a checkpoint only; third-set history incomplete, outbound/document missing from combined receipt, full E035 not complete.

## 2026-09-25 — Bounded UTILTS field206 local verification
Annex C/UG-122-16/17 field206 missing/invalid UTC offset corrected in canonical final header guide; actual mocked inbound consumer blocks meter/billing and sends only negative APERAK/FTX206. Local 278/278 UTILTS tests, app/test types, lint and diff passed. Published CI pending; full F3 and E66 209/533 not complete.

## 2026-09-25 — Bounded UTILTS field205 local verification
Annex C UG-122-12/13 message date required/format/calendar/future check feeds typed negative APERAK, with impossible-date guide selection fallback to receipt date. Actual mocked inbound boundary emits no meter/billing/completion. 280/280 UTILTS tests, app/test types, lint and focused25/25 passed. Exact-head CI pending; full F3 incomplete.

## 2026-09-25 — Bounded UTILTS field204 local verification
Annex C UG-122-8 BGM1225 allowed5/9 now yields final guide field204 ERC41/42, negative APERAK over E19. Actual mocked inbound has no meter/billing/completion, and 311/311 relevant tests, app/test types and lint pass. Publication/own CI pending; full F3 incomplete.
