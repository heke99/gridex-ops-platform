# PR361 — canonical UTILTS observation scope implementation

Status: IMPLEMENTED_NOT_VERIFIED. Candidate parent94cacc02cb8c821e8d806bf1d9e9d50f058d1384; resolve the published child head before CI/review/merge. Accepted main remains7a13efd62e7dbcbd20286195fa6114494051fcda (PR360).

## Source/design gate and real test-first RED

Retain e035-observation-scope-plan-20260921.md unchanged. Independent source/design review5757115464 identified one missing-oracle blocker: UNT controls alone did not cover UNB/UNZ. Published94cacc02 added6 public-parser boundary cases across3 alphabets. Root read the completed ordinaryOPS35574752510/job106253966098 on94:319files,317PASS/2FAIL;5056tests,5016PASS/40FAIL. All40 failures are actual public parseCanonicalEdifactAst calls observing absent utiltsTransactions, not missing imports or fixture errors. The original new suite has34FAIL/6controlsPASS; the additional6boundary cases allFAIL. All5010 pre-existing tests pass. Verify106253966410 and clean-migration-replay106253966383 areSUCCESS. Durable RED receipt5757702741. Review5757707782 confirms the boundary amendment resolves the sole pre-implementation blocker and approves the bounded SOURCE/SPEC and DESIGN/oracle scope. Its confirmation relies on root's read of the reported CI; it is not another independently executed test run.

Root authorizes only that finite implementation under the user's standing next-code/green-merge request. Original PDF page provenance and absence of fresh full-PDF hashing remain exactly as stated in the source plan. No new normative interpretation or full E035 decision is made here.

## Actual code and preservation

Add canonicalObservationScope.ts: one linear traversal of the existing tokenized actual-UTILTS message. Each physical IDE starts its own transaction, even when identity/qualifier is absent or malformed. Each SEQ under that transaction starts its own observation. The decoded SEQ identity is element2/C286, not element1/1229. Identity vectors, physical indices and original tokens are retained; no deduplication or synthetic identities. OrphanSEQ is left in the original AST, not attached to a laterIDE. UNT/UNZ/UNB and a subsequentUNH stop this projection without changing legacy message slicing.

Observation RFF/QTY keep raw token, originalindex, exact decoded vector and scalar slots. The directReferenceSlot flag describes only the initial DTM/RFF window; the first other segment closes it permanently until nextSEQ. LateRFF remains visible with false, not discarded or promoted. Empty scalar maps to null; spaces, case, punctuation, extra components and repeated observations remain observable. No numeric/date coercion, inherited meter, expected inventory or authority tag.

The existing public canonicalEdifactAst.ts adds only one import, an optional documented property and a conditional UTILTS-only projection. Its existing lineGroups, messageSlices, extraction, scalar facts and non-UTILTS shapes are unchanged. No utiltsEngine, parser facade, processor, ACK, stored payload, tenant query, migration, workflow, dependency or existing-test edit. This is an E035 INPUT prerequisite, not an E61/E62 fix, guide-first execution proof or database atomicity certificate.

Both previously published test files are retained byte-for-byte: canonical-observation-scope blob38dd93d316aa86a1f254cf7381e5c3fbebfd053d and observation-interchange-boundaries blobff3200f5d0ec4675ffbdef436e22bdf6950dcf21. New GREEN is not yet claimed; ordinary exact-head CI is the repository execution authority in this environment. Local terminal cannot resolve GitHub; no local repository full-suite run is asserted.

## Delivery and remaining work

Next: read back exact published diff, run unchanged ordinaryCI and obtain independent completed TASK/SPEC,QUALITY,TENANT-BOUNDARY,WHOLE-PR review for the child revision. Fix concrete findings without weakening the original46 cases. Expected-head guarded merge only after terminal required checks and review; actual resulting mainfull73/73+allOPS and durable receipt afterwards. PRsmoke never substitutes for mainfull.

This session initially created proposal-only duplicatePR362 from the older supplied ZIP, then discovered361's newer published source/test work. PR362 was closed unmerged before implementation; its alternative parser-path proposal is not imported. The current361 branch remains the sole authority. Prior memory is preserved at94cacc02.

Skill routing: executing the retained plan; actual-source/differential inspection; test-driven implementation after observed RED and independent oracle review; verification-before-completion; independent requesting/receiving review. No repository-wide audit, UI, database, infrastructure, authorization or performance-remediation change is activated. PR310 remainsOPEN/DRAFT/PAUSED ate961135199f292b8210884f07de3b616a670161a, untouched. D110/110+parents10/10 and accepted351–360 units retained. FullE035, F3C-02/04/05/06/07 and later applicable masterplan work remain incomplete; no new producer/role/guide/live authority or overall percentage.
