# TR-06 certificate ownership and exact validity

Owner: Codex chat `01a1084e-26ac-72b5-84ee-ed57bf62d040`.
Branch: `codex/ediel-tr06-certificate-20261004`; initial base `cbefde67712a7ad4e018abf688d1d2e242a61faf`.
Preparation follow-up: `codex/ediel-recipient-preparation-20261004`, based on #506 head `bfd5bc8e`.
Readiness follow-up: `codex/ediel-recipient-readiness-20261004`, based on #510 head `d865f7ad`.
Main integration `33aeb7f7` retains the existing TR-01/02 source, tests and coverage rows;
the only conflict was the crypto test header, resolved by preserving both ID tags and lifecycle imports.
Coordination: https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5983511741
Status: VERIFIED (TR-06/AT-TR-06/SC-060 approved; #506 e7cdcd8d, #510 a40b5732 and #511 643ea134 merged after their own nine exact-head gates).

## Scope and ownership

TR-06, AT-TR-06 and SC-060 only. Existing TEN/P/U, ENV/GOV and TR-01..05 owners retain their files.
GOV-07 was already approved on main: reservation released without changes or repeated work.
Shared campaign checkpoints are owned by the existing integrator; this packet never overwrites them.

## Confirmed defect and repair

The actual resolver accepted another tenant's certificate row and unowned
`tenant_owned`/`route_specific` rows in both explicit-ID and automatic selection.
The protected authority still pinned the correct public receiver fingerprint;
the reproduced impact was foreign row/raw attribution, not an unauthorized
cryptographic recipient. The query could also let foreign duplicates consume
candidate limits or create ambiguity. Admin certificate import explicitly
supports `company_id=NULL, scope=platform_shared`; that behavior is preserved.

Early company UUID/environment validation now precedes reads. All three public
certificate reads select the own company or explicitly shared platform rows.
The shared runtime scope guard and required-set matching also enforce ownership.
Route-profile rereads require the own company. No SQL/schema/transport files changed.

## Executed evidence

- Node 22.23.3 baseline: 42/42 certificate tests PASS.
- Unmodified resolver with new behavioural tests: 6 FAIL / 77 PASS; independent reviewer reproduced the same failures.
- Corrected scope/crypto/validity plus retained CMS and previous-CRL exception suites: 151/151 PASS in 6 files, including required-set protection against foreign duplicates from a mis-scoped read.
- Real signed synthetic CA/recipient leaves, CRLs and signing-only X509 certificate;
  actual OpenSSL PKIX/purpose/revocation checks. Only database reads are substituted.
- Covers exact row and PEM validity instants, lifecycle/security status, receiver,
  subaddress, family/code/environment/tenant, direct ID versus candidates,
  immutable records, source authority expiry/scope/fingerprint, missing chain,
  absent/revoked/stale signed CRL, foreign duplicate, own/foreign route profiles,
  preserved platform sharing and invalid tenant input.
- App/tests/scripts typechecks, owned lint, tagged-approval check (352 IDs, no tagged failures),
  spec integrity (33 originals/121 rules/231 contracts), service-role ratchet and diff whitespace checks PASS.
- Independent full-criterion review APPROVE; independent 139/139 targeted tests PASS.
- Integrated full suite: 9950/9953 PASS without concurrent typechecking; the same
  three UTILTS projection tests hit their 5-second timeouts on unmodified main
  `33aeb7f7` (9864/9867 PASS) and in an isolated network-enabled run. They pass
  3/3 when placeholder Supabase I/O is rejected immediately by the sandbox.
  The fixture omits the issuer/periodic-reason read ports invoked by the real
  runtime. The initial CPU hypothesis is disproved. ENV-01/#504 owns the fixture
  repair; this packet neither duplicates it nor weakens timeouts/assertions.
  Final run with the existing CI preload `unit-loopback-network-boundary.cjs`
  passes 9953/9953 on #506's code tree; real loopback tests remain enabled.
  All nine applicable gates passed on bfd5bc8e before #506 merge.

Synthetic source registration proves guarded code behavior and cryptography;
it does not prove a live issuer registration, database RLS or market activation.

## Separate observed caller gap

Existing `testing/testRunTransportMetadata.ts` and system-test certificate setup
omitted `companyId` despite the resolver already requiring it; metadata also
omitted its computed business code. The separate preparation packet adds exactly
five context lines at the four actual calls. Actual SMTP send already supplies
`message.company_id`. Route readiness additionally selects weakly matched rows
before/after the resolver. Its separate verified repair now calls only the
authoritative resolver with tenant/route/subaddress/family/code/environment;
blocked trust withdraws cached approval. No unscoped certificate reload remains.

Preparation evidence: four positive paths RED on unchanged callers; companyId
alone gives 3 PASS/1 metadata RED (`message_code_mismatch`); businessCode completes
the fourth positive. New 14-case suite uses real signed CA/leaf/clean+revoked CRLs,
resolver, AGT gate and run persistence; only Supabase/Expisoft ports are substituted.
Explicit/local/directory success and revoked/foreign rejection are covered.
Actual passive AGT L2/Z04 stores the own company and true leaf fingerprint;
foreign/code/authority/revocation failures precede locks, snapshots and run writes.
Implementer 142/142 PASS; parent review 165/165 in seven security suites PASS;
owned lint and application/test typechecks PASS. No new rule promotion or SQL changes.

Readiness evidence: unchanged engine 14 FAIL/2 positive PASS; repaired guard
passes those 16 cases. Two further forged stored-fingerprint probes reproduce
RED; verified PEM fingerprint overlay repairs them without changing the source
certificate row. Readiness18 + retained preparation14 =32/32 PASS; parent review
199/199 in nine security suites PASS, both updated architecture scripts32/32,
owned TypeScript lint and app/tests typechecks PASS. Shared synthetic fixture
generation removes duplication without committing keys. Integrated full suite
with the existing CI network preload passes 9985/9985 on the published code.
New-main composition e7cdcd8d+#510+#511: independent 123/123 interacting behavior
probes and 32 architecture assertions PASS. Actual merged trees814fa01e/599119e7
match that reviewed composition exactly; nine gates pass on each source head.
ACK-01 support was re-reviewed on latest published #491 d88fa98d (5/5 plus real
APERAK consumer1/1 PASS); e07 receipt remains historical. No duplicate ACK packet.
SC-041 is independently approved in #513 and awaits its own gates and merge window.

## Next action

Current pair is SC014 + SC012, with separate sole technical owners. All eight published owned heads now have nine required checks SUCCESS; integrator actually merged SC055/f9576530, SC021/eacb6c7c and SC022/f86a0c5d. Five older packets stay open/green for retained source-aware integration. Do not merge these three again or write duplicate common handovers. SC012 ownership is handed over by public5988027337; tr06 implements one-DB positive Z14→Z04 with actual callers/current SQL in its new-only f957 worktree. Ack prepares the minimal SC014 private-born technical-only admission/replay repair plan, reusing completed48-trigger/native/later-legal reviews. Root retains implementation/integration/review and this own documentation. SC014 desired eighth case is genuine RED on local39248700; no row/tag/product repair is approved. Detailed public export remains blocked by automatic review with no answer to the pending629-specific question; accepted public CI-only receipt is5988096915. See the latest section of masterplan-parallel-coordination.md for exact hashes, limits and next actions.

Skill routing: using-superpowers/executing-plans/using-git-worktrees for isolated
continuation; spec-to-code-compliance + independent read-only reviewer for the
literal card; test-driven-development/systematic-debugging/fp-check for the
reproduced tenant defect; Supabase for the protected read boundary;
verification-before-completion/requesting-code-review for approval. No schema
change, UI/performance work, new dependency, hook or skill authoring is in scope.


Current continuation2026-10-05: SC021/SC022 complete technical code-contract review, readyPR552/554 on main9dc, all nine final-head gates/merge pending; unique506/510/511 merge receipts unchanged. Exact proof/limits/current0796 sole-owner consumer correction and published-head ownership reconciliation are in masterplan-parallel-coordination.md. SC025/026 are already primary-PASSED and never claimed/implemented here; next pair remains unclaimed SC055/056 read-only preflight pending fresh root ownership check. Preserve all frozen source owners, actual main staff changes, shared capture/coverage window and no duplicated native/full run.

Latest continuation01:41: explicit new pair SC055 evidence/SC014 intake qualification is CLAIMED #5305986591063, coordinated #4915986601894 and clarified by source owner #4915986603379. Six obsolete queued runs are verified cancelled; current candidates preserved. Actual frozen539/546 native failures are qualified with authentic ZIP/JUnit receipts in own coordination memory. Root prepares the smallest honest #539 email-SAN native-fixture repair locally; product source remains unchanged and publication waits for the already-authorized post491 main adoption. The preceding unclaimed-candidate sentence is historical, superseded by this claim. No further merge/handover is claimed.

Current merged-main continuation: #558 head912eaf6f/treef64479f6; #552 head5f7a2d83/tree68f62e8c; #554 head57873898/treeafb3aa41. Shared main507e/#491/#500 are actual merges, while open#501/#556 remain separately owned. SC014 six-case freeze2cb00642 and actual507e composition51d8030b are retained; seventh actual-persistence positive is active only in its original two files. No extra handover or another rule approval is claimed.


Latest public-state continuation2026-10-05 03:41: all eight published freezes and current CI source-of-truth are recorded in the coordination file. Accepted public CI message #4915987702576. Detailed new source-review notes remain local; no whole SC014 or full-masterplan completion is claimed. Agents preserve their exact no-edit scopes and document each next action. Old adoption/seventh-case-pending paragraphs above are superseded.

Latest continuation05:15UTC: pairSC012/SC014 and four disjoint responsibilities are recorded in masterplan-parallel-coordination.md. SC012 root independent1/1PASS; only isolated tag/row pending fulltagcheck. SC014 first forward8/8PASS; real contradictory-JWT publicRPC RED is assigned to sole product owner, root owns component permanency tests, native agent solely builds detached cleanbaseline60563. CommonClaude890 has no schema guard delta; actualP08/mailbox/filter overlap remains preserved. Latest public-scope async question is still unanswered; no rejected payload republished and no extra merge/handover.


Latest continuation05:58UTC: SC012 locally approved/clean407c25a6, literal/coupledSQL/taggedcoverage/integrity PASS. SC014 frozen12-file locald3d25b34 has11/11 component plus retained46/46 and repaired32/32; actualcleanbaseline PASS and manuallyappliednative19/23 with4 qualified diagnoses pending, wholeSC014 NOT_VERIFIED. Root/shared owners and specific source boundaries remain in masterplan-parallel-coordination.md; native owner alone changes its new three files/own isolatedruntime. Currentactualmain61e84d8d/#555 is not silently adopted into the older frozen packets. Next second-lane ownership discovery is read-only for SC042, not a claim. Specific public export approval remains unanswered; no rejected exports, extra merge, second capture or duplicated handover.


Latest06:06UTC allocation: active pairSC014/SC042. Root confirmed no active042claim at06:02:42 and created clean61e84d8d isolatedSC042worktree; ack owns only new scenario test/checkpoint and scopedexecution. Claude retains ACK02/03 product. NativeSC014actualsecond23/24 is being precisely reconciled for its one actual negative-held ACKcapture log, not a broad business/schema exclusion; tr06 independently reviews exact finaltestdelta. Product a2d/fourTS and unitff81 remain unchanged. No public claim/export or duplicate run/integration/handover.


Latest06:21UTC: actualSC014native24/24/0skips PASS on7388/2ac, rootcomplete scriptstypes PASS and peerfixtureAPPROVE; accurate immutableNEGATIVEoriginal/ACK diagnostics have no legal/businessauthority and are byte-preserved. Runtime-onlycleanup preserves reviewablecandidateproofcopies after an automatic proofcopydelete rejection; no bypass. SC042 correct4/4 matrix +ownedtypeguard qualification/freeze/reviewpending. WholeSC014commonregistration/latest-main/generated/capture/upgrade and all publicexports remain separate pending conditions. All exact receipts/owner boundaries in masterplan-parallel-coordination.md; no extra shared handover.


Latest06:35UTC: local cleanSC012407c25a6 andSC0420bbca227 wholeliteral scenarioapprovals retained; SC042fulltaggedcoverage193approved/205green/0failing/integrity PASS withinactualmain61isolatedbranch. LocalcleanSC0147d423010 native24/24+source/semanticapproval saved, fullSC014commonintegration/authenticCI stillrequired/no tag/row. All3agents exactparts frozen, ownedruntimecleaned/proofcopiespreserved, no overlapping next-rulework/publicexports/secondcapture/duplicatehandover. Concrete integrator/publicationartifacts and exactreceipts/ownerboundaries in masterplan-parallel-coordination.md; public internal-detail scope waits actualexplicituseranswer.
