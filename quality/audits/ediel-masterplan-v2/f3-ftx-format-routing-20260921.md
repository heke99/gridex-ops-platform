# PR359: bounded FTX format-routing correction

Status: IMPLEMENTED_NOT_VERIFIED. Candidate parent is b9dcfd12da7dcdfa90b20b8a2f994ce57f1d4423 on codex/ediel-f3-phase-closure-20260920. Resolve the actual published head before reviewing or merging; this document is not a final CI certificate.

## Retained authority and scope

Continue the published FTX301/303 implementation at 9e286f86392ac807686e23dfc03ef377e2c11345, not a new source review. Retain source review5752810321, design/oracle5752868541 and clarification5752898014. Independent review5753117905 passed TASK/SPEC, QUALITY and TENANT-BOUNDARY at9e286f86, but WHOLE-PR explicitly awaited terminal CI. The later observed failures invalidate any inference of whole-PR acceptance.

The only production change in this correction is the dispatch expression in prodatFreeTextSendIssues. The first-PRODAT selector, headerAAI/own-first-registerACB scope, raw preservation, incoming disposition, policy matrix, tokenizer and existing send boundaries are unchanged. No migration, schema, RLS, role, workflow, threshold, frozen-source, live/provider or deployment change is part of this correction.

## Observed RED and root cause

Ordinary OPS run35541596324, quality-release-gates job106160145134, at head9e286f86392ac807686e23dfc03ef377e2c11345 executed npm test:4986 passed,2 failed,4988 total. The two unchanged failures are:

- ediel-prodat-death-status-boundaries.test.ts: preserves XML/list routing with literal question marks and UNH-semicolon data.
- ediel-prodat-meter-change-format-routing.test.ts: does not classify list header/tag-like data as actual EDIFACT, UNH;A;B followed by1;2;3?.

Both fail through prodatFreeTextSendIssues into tokenizeEdifact with edifact_dangling_release_character. The old expression accepted any non-alphanumeric character after UNB/UNH/BGM/LIN/FTX. A semicolon list column therefore entered the EDIFACT release codec before the ordinary list route. This is a dispatch bug, not a migration-chain defect. Existing verify and migration replay are not weakened or substituted.

The replacement requires the actual default '+' element separator for header/fragment tags without UNA. The existing UNA branch remains available for custom service alphabets, including malformed input that must still fail in the tokenizer. No metadata-based exemption and no catch-and-return fallback is added. No leading-prefix search or unrelated shared-codec redesign is introduced.

## Regression coverage

Test-first commit b9dcfd12da7dcdfa90b20b8a2f994ce57f1d4423 adds22 tests in ediel-prodat-free-text-format-routing.test.ts, without changing either original regression suite or any old expectation:

- Seven list inputs, including UNB/UNH/BGM/LIN/FTX semicolon headers and release-looking literal data; direct FTX boundary plus actual raw preflight send/parse equality.
- One XML literal-data control.
- Six actual PRODAT conformance cases across three existing service alphabets and both false XML/list metadata values; pure boundary, raw preflight and real SMTP entry point.
- Six malformed-EDIFACT cases retaining the dangling-release exception before external effects across the same alphabets/metadata.
- Two default-EDIFACT-without-UNA cases retaining the real SMTP FTX hold despite false metadata.

Only external database/provider boundaries are mocked. Negative SMTP controls assert zero effects and unchanged raw payload. Existing18 SMTP cases, both native harnesses, first-message correction and all other regressions remain intact.

An isolated Node dispatch-expression experiment observed5 old false positives and18 passing candidate classifications. This is supporting local evidence only, NOT a repository test-suite result. The ordinary test-first run35542420917 was started for b9dcfd12; its terminal result must be read rather than inferred. No local full-suite execution is claimed.

## Skill routing and verification order

Active: systematic-debugging (trace to actual dispatch), test-driven-development (existing ordinary behavioral RED, preserved tests and additional test-first commit), bounded differential review, and verification-before-completion. Requesting/receiving independent code review applies to the actual final revision. Browser/UI, Supabase schema/auth, infrastructure and broad source-requalification skills are not applicable to this one-function format boundary; no work is delegated to those domains.

Next: publish/read back the exact candidate; run unchanged ordinary CI including npm test, both native harnesses,18 existing SMTP cases plus22 new tests, all typechecks, full E2E/coverage and OPS. Obtain independent TASK/SPEC, QUALITY, TENANT-BOUNDARY and WHOLE-PR adjudication on that exact final head, addressing real findings without rewriting old expectations. Only then expected-head guarded merge; verify the actual resulting main commit with73/73 and all OPS jobs and save an acceptance receipt. A synthetic PR merge ref is not that receipt.

Prior memory is retained in Git at b9dcfd12 and the earlier audit files remain unchanged. PR358/E011/main352fd8ee are already accepted. D110/110+parents10/10 are unchanged; fullF3/masterplan remain NOT_COMPLETE. PR310 remains OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a, with no write/import/restart/merge.
