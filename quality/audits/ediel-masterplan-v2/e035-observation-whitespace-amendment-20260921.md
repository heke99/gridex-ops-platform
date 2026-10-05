# PR361 — bounded pre-trim evidence amendment

Status: IMPLEMENTED_NOT_VERIFIED. Parent4a29ed515d984c4071f2bf0f25d6ffea009f3f7b; resolve the actual published child before acceptance. This supplements, not overwrites, the original source plan and implementation/failure history. Accepted main remains7a13efd6/PR360.

## Observed defect, scope and authorization

Actual implementation35fecee5 normal OPS35579393631/job106268498592 ran5056 tests:5053PASS/3FAIL,319files318PASS/1FAIL. All three unchanged exact-space cases fail at public AST line81: the trailing literal space is absent. The other43 new cases and all5010 old cases pass. Root independently read the completed job and recorded5757833287. The old tokenizer trims each split segment before assigning token.raw; the new helper cannot restore lost text. This is a new projection's fidelity defect, not permission to change every legacy consumer.

Independent amendment review5757796173 approved a finite private-evidence design conditional on that actual RED. Root authorization5757869043 records the satisfied condition and limits the exception to the original no-tokenizer-change scope. Static review5757777365 was conditional on CI and never final acceptance. No old test assertion is waived. New24 compatibility cases were published FIRST at4a29ed51; ordinaryOPS35580203338 began before this correction. Its terminal result must be read separately, not inferred here.

## Two-file correction

edifactTokenizer.ts keeps the same public token property names/order/values, indices, tags, elements, trimmedraw, default segmentComposite, release errors and CR/LF handling. It retains each pre-trim split string only when trimming changed it, in a private WeakMap keyed by that exact token object. segmentUntrimmedRaw returns retained text only when retained.trim() equals current token.raw, otherwise current raw. Clones and hand-made tokens have no inherited evidence; equal trimmed strings do not share entries. Weak keys do not create a tenant/string cache or public serialized field. This evidence is not original MIME bytes or a trusted source decision.

canonicalObservationScope.ts alone uses the guarded text through the existing segmentComposite. The local wrapper is not published, mutated or inserted into AST arrays. Every segments array keeps original token references and legacy raw. RFF/QTY observational raw comes from the same guarded text. Physical IDE/SEQ/UNB/UNZ/UNT ownership and the initialDTM/RFF slot logic are unchanged. No alternate decoder, numeric/date coercion, expected count, inherited meter, E61/E62, guide, ACK, persistence, route or authority behavior.

The original40case suite (blob38dd93d316aa86a1f254cf7381e5c3fbebfd053d) and6boundary suite (blobff3200f5d0ec4675ffbdef436e22bdf6950dcf21) remain byte-identical. New24cases cover all three alphabets: terminal spaces in actual IDE/SEQ/RFF/QTY; whitespace-only versus empty; tokenkeys/symbols/JSON/elements/defaultcodec compatibility; distinct token evidence; no-trim/currentraw fallback; mutation, clone and hand-made isolation; CR/LF normalization boundary. Lexical fixtures do not claim full national message validity.

## Verification and remaining gates

No new GREEN is claimed in this commit. Require unchanged ordinary exact-head tests/typechecks/build/coverage/OPS and independent completed TASK/SPEC,QUALITY,TENANT-BOUNDARY,WHOLE-PR review. Then expected-head guardedmerge and actual resulting mainfull73/73+allOPS with independently inspected artifact and durable receipt. PRsmoke is distinct from fullmain; no local repository-suite execution is claimed.

Relevant workflow: retained execution plan; direct root-cause/false-positive verification; test-first defect and compatibility controls; narrowly authorized shared-codec evidence amendment; differential independent review and verification-before-completion. No repository-wide audit, UI, database, infrastructure or performance-remediation task. PR362 duplicate proposal remains closedunmerged. PR310 remainsOPEN/DRAFT/PAUSED ate961135199f292b8210884f07de3b616a670161a, untouched. D110/110+10/10 and prior accepted units retained. FullE035/F3/masterplan remain NOT_COMPLETE: the next dated structural authority/comparator and execution/persistence/field/response/grammar/finding criteria are separate.
