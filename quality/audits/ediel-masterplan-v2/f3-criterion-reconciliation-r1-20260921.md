# F3 continuation after PR359 — criterion reconciliation R1, corrected R2

Date: 2026-09-21. Runtime baseline: accepted main `71d2adf8b8b5f4305683a1399ddb5c17f0808ee8`.
Status: PARTIAL; documentation correction awaiting exact-head CI and review. No runtime, schema, workflow, frozen-source or existing-test assertion changes.

## Correction and evidence limits

The original R1 at `52261280a5dc32825a9c630c5e05bcc8053be031` received bounded documentation review5753449604 and four successful ordinary PR workflows. Root's pre-merge code check found two factual errors and an overbroad completeness inference. This corrected document supersedes those statements; Git retains the original revision and review.

1. PRODAT field213 is `QTY+31`, not QTY136. `lib/ediel/prodat/prodatRegisterFields.ts` lines36–41, blob6ff18d873af8421d6f250e9695e1e6f0c4293ce2, reads qualifier31. No runtime change is needed for this documentation error.
2. Guide-first final disposition is not proof of guide-first execution. `lib/ediel/utiltsEngine.part-1.ts`, blob26d85216b6781cf8890f9e622b5b00d62296a1e6, runs functional checks before `issues.push(...validateCanonicalUtiltsProfile(facts))` near line1318. Its `resolveUtiltsTransactionDispositions` separately prioritizes application errors over functional errors per transaction. R1's assertion that the runtime already orders guide validation before processability is withdrawn. The earlier `promoteE66SchMissingReadingToFunctionalIssues` also needs source-backed behavioral qualification; its presence is not proof of compliant guide-first behavior or a newly reproduced end-to-end defect.
3. E035 and full UNSM/G06 are two specifically identified gates, not an exhaustive list of everything left in F3 or the masterplan. Per-field composition, final ACK/persistence criteria and the per-original-finding ledger remain incomplete. Existing green helper/payload tests do not certify physical database transactions, full grammar or all end-to-end consumer paths.

## Retained accepted evidence

Retain D110/110 plus dependent-parent occurrences10/10; bounded PR351 incoming506/shared242, PR352 P94/A905 text/readiness and own227, PR353 permission322/324, PR354 prior-flow authority, PR355 remaining incoming cells, PR356 GAS240 and PR357 publication, PR358 E011/UNB0031, and PR359 FTX301/303/format routing. Do not reopen these units without a concrete counterexample. Their acceptance does not certify all F3 criteria. PR359's actual-main receipt is `.agent-memory/pr359-main-acceptance-20260921.json`.

## F3C-02 — PARTIAL register-composition reconciliation

Current owners: `prodatRegisterFields.ts` reads local314/209/258/213 and selected local characteristic fields; `prodatRegisterGroups.ts` checks message/object/agency identity, global314 and258 sequencing, and first/later-register semantic authority. `prodatRegisterRuleScopes` selects local versus first-register-only validation; invalid chains receive no omission/inheritance privilege. `fieldMatrix.ts` invokes the specialized owners before generic path presence. Parser/compat, canonical facts, inbound staging, rulebook, TGT matching and protected pre-I/O paths have existing tests.

Accepted-main execution locators include registers50, conditions52, structure-guards36, consumers30, preflight24, source-selection33, object-projection12 and quantity24. These are historical executed suites at71d, not new criterion approvals. The complete consumer test had been read; a complete source/oracle/caller mapping for every field and composition was not produced by R1. Continue mapping314/209/258/QTY31-213 against retained `f3-register-source-map.md`, inventory/readings audits and exact positive/negative tests. No new register defect is established here, and F3C-02 remains PARTIAL.

## F3C-04 — PARTIAL P/U APERAK and UTILTS-ERR

Retained source-qualified PRODAT units cover typed field identity, p119 applicability, A905 text/readiness, own227, selected permission fields and prior-flow correlation. UTILTS has typed application/functional issues, transaction dispositions, ACK planning and `createUtiltsRuntimeAcks`. Those are existing implementation paths, not a full criterion certificate. Full header/object/transaction code/reference coverage and actual final response/persistence mapping remain to be independently adjudicated. No previously accepted field-error unit is invalidated merely because broader coverage is incomplete.

## F3C-05 — PARTIAL guide-first and persistence evidence

`resolveUtiltsTransactionDispositions` selects guide rejection before functional rejection for the same transaction and keeps independently referenced siblings separate. This result-selection behavior is distinct from validation execution order. As noted above, `validateUtiltsFacts` executes functional checks before its final canonical-profile call. Do not describe it as already enforcing the complete staged-validation contract.

`ediel-utilts-transaction-disposition.test.ts` supplies literal issue arrays to verify classifications. `ediel-utilts-transaction-persistence.test.ts` checks payload/identity construction and includes source-shape assertions. Their presence and green application-suite execution do not prove actual database rollback, ACK-after-storage, older/newer-value handling, or absence of later functional evaluation after a guide error. These remain explicit evidence tasks. Source qualification and a real behavioral witness must precede any runtime correction; do not alter existing expectations to endorse current behavior.

## E035 — unresolved operational structural-information capability

The 25-A-4 flag `validateMeterAndRegisterAgainstStructuralInformation` is defined in `utilts25A4.ts` and asserted in the effective-date test. The inspected runtime/search did not identify an operational E61/E62 dated meter/register comparison consumer. This supports an implementation/evidence gap, not a claim that every structural check everywhere is absent. Tenant object matching alone does not prove received, dated meter/register authority. Qualify the original source, period/applicability and actual data/consumer path before implementation. Local absence must not manufacture a national E61/E62 rejection.

## F3C-06 / G06 — incomplete grammar qualification and inventory

`syntaxValidator.ts` performs limited envelope/BGM/UNT/reference/stored-status checks. `segmentSchema.ts` declares coarse profiles, cardinality/order descriptors and selected length limits. Neither alone constitutes full UNSM grammar. The frozen seven-entry `source_manifest.json` lists P,T,U,UE,AI,OE,AP, with no complete UNSM grammar package. This proves absence from that manifest only, not impossibility of obtaining the grammar, nor absence from every external or repository source.

Next: retrieve and qualify authoritative version-specific UNECE/Ediel grammar and bind the selected source, structural checks, consumers and release-SHA inventory. Preserve frozen originals; add derived source qualification separately. No broad parser rewrite or full-G06 acceptance follows from this documentation PR. PR310-dependent schema/type parity stays deferred, not silently satisfied.

## F3C-07 — per-finding ledger still incomplete

E011 has accepted PR358 evidence. E034 has existing effective-date and decision-reuse paths/tests; they must be mapped to the original finding's exact scope rather than assumed to certify all timing semantics. E035 remains open. E036/E037 remain unverified at full criterion scope despite disposition/payload tests. E001–E010/E012/E013 still require an individual accepted/superseded/unverified/confirmed disposition with the exact source path and receipt. Do not claim the final ledger exists before producing it.

## Continuation and acceptance order

Only active publication item: correct PR360's documentation, obtain new exact-head independent review and unchanged ordinary CI, guarded-merge, then inspect actual-main full73/73 plus OPS and save the receipt. Root may prepare read-only source evidence while those checks run; no concurrent runtime implementation is part of this PR.

After main acceptance, continue source-backed F3 reconciliation in bounded batches. E035 source/data-authority qualification is the next proposed runtime-capability investigation; F3C-05's staged-validation discrepancy and the unfinished field/finding ledger must remain visible rather than disappear behind a two-blocker summary. Full F3/masterplan remain NOT_COMPLETE. PR310 stays OPEN/DRAFT/PAUSED at `e961135199f292b8210884f07de3b616a670161a`, with no write/import/restart/merge. No live database/provider/market/settings or explicit deployment action.

Skill routing: receiving-code-review and current-code differential checking apply to the prior PASS; verification-before-completion and finishing-a-development-branch apply to exact-head publication/merge. Subsequent source qualification activates spec-to-code compliance and targeted debugging/TDD only after a real witness. No UI, performance, schema or broad security-remediation change is in this documentation scope. Public clone was attempted but failed DNS in the local container; GitHub connector refs/blobs/diffs are the available VCS evidence. No local full-suite run is claimed.
