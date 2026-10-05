# E035 prerequisite A: source-bound UTILTS observation structure

Date: 2026-09-21. Base: actual accepted PR360/main 7a13efd62e7dbcbd20286195fa6114494051fcda. Status: SOURCE_AND_TEST_FIRST_REVIEW_CANDIDATE. This is a finite parser prerequisite, not E035 functional acceptance or a general parser rewrite.

## Source findings and provenance

Original documents were located in the user's File Library. Relevant native text and supplied page images were inspected. No fresh PDF-byte download/hash or complete original-PDF audit is claimed here; preserved manifest hashes are historical, not recomputed by this task.

- English UTILTS 25-A-3, 251001_Ediel_UTILTS-APERAK_User_Guide_Version_25-A-3 (1).pdf, file_00000000d904824392f459299b097e19: p59 fields514/527/224; p94 SG8/RFF; p138 functional E61/E62.
- Swedish UTILTS 25-A-4, 260331_Ediel_UTILTS-APERAK_Anvisning_version_25-A-4.pdf, file_0000000022b48210b8d3db9e3c62173f: p6 change log, p13 message/transaction/observation levels, p58 field224, p91 SG8/RFF, p127 guide checks, p132 functional E61/E62. Printed footer25-A-5 versus coverrevision4 remains the existing source conflict, not a new version choice.
- English 25-A-4, file_00000000b890824696fb512f349fe7cc, p88: SEQ++1, observation514 is C286/1050 (element2), not the empty1229 slot.
- Existing original object examples: UTILTS-APERAK_ver_E5SE5A_exempelsamling_objekt_el_250430.pdf, file_000000004ed48246890beda3e13a628f, p33: a changed meter is explicit at observation1633; observation1634 omits MG while retaining AES901. These are examples, not ready-to-send files (UNTxxx/repetition placeholders).
- Official UNECE D02B UTILTS message structure was reachable and read at https://service.unece.org/trade/untdid/d02b/trmd/utilts_c.htm . SG5 starts IDE; SG8 starts SEQ and its initial sequence is SEQ-DTM-RFF-MOA-PCD-SG9-SG10-SG11. Versioned source access is not completed full-G06 qualification.

E61/E62 are already specified in 25-A-3 p138. The existing false25-A-3/true25-A-4 structural policy flag is not authority to postpone all comparisons until October; the25-A-4 change log clarifies received structure. This prerequisite does not change that flag or activate a comparator. Field224 is supplied once per register at the first meter-standing observation; omission later must remain observable, not be misclassified as a missing meter. Register527 and meter224 are observation-scoped. Multiple observations do not by themselves mean multiple registers.

## Current code and bounded gap

Actual canonicalEdifactAst.ts blob82530ce89c7d1528a0b6ecda7e52dadd2c8e5fe8 preserves all tokenized segments and messages but only builds LIN lineGroups; it has no typed UTILTS IDE/SEQ hierarchy. Therefore raw evidence exists, but future E035 consumers cannot use a canonical observation owner today. This is a missing planned representation, NOT a demonstrated live unsafe send.

utiltsEngine.part-1.ts flattens quantities/references into transactions and performs functional checks before final validateCanonicalUtiltsProfile. utiltsDataRequest.part-1.ts matches tenant/object, not independent dated received meter/register structure. No change to those validation/ACK/business paths is included in this prerequisite. Search for structure_versions, metering_point_history, structural_information and meter_registers did not identify a qualified dated structure producer; that limited search is not proof that every repository source is absent.

## Finite implementation contract for independent review

Extend the existing public parseCanonicalEdifactAst result only for actual UTILTS messages with optional utiltsTransactions. A small pure helper consumes that message's existing tokenized segments and UNA; no new raw extractor/decoder, metadata switch or second rule matrix.

1. Preserve physical messageIndex, transactionIndex, observationIndex and original segment indexes. IDE starts a physical transaction even with invalid/missing qualifier; retain its qualifier/components rather than borrowing a prior valid transaction. SEQ before any IDE is not attached to a later transaction. Stop at UNT/UNZ/UNB; never borrow later-message/trailer data.
2. Preserve IDE/7402 and SEQ/C286/1050 as exact decoded values with complete component vectors. Empty values stay null, duplicates stay separate physical occurrences, and no synthetic business reference is invented.
3. Each observation retains original token references, RFF qualifier/value/full C506 vector/raw/index and QTY qualifier/value/full vector/raw/index. Do not flatten surplus components into an identifier or normalize punctuation/case. All RFF occurrences remain visible. Annotate directReferenceSlot only for the initial DTM/RFF window after SEQ, closing it at the first other segment; late RFF remains evidence, not an eligible SG8 reference.
4. Do not inherit, deduplicate, infer expected count, classify meter/register validity, choose E61/E62, change guide selection or ACKs, or publish a trusted structure source. No application/readiness/production status is added.
5. Non-UTILTS result shape and all pre-existing projections/lineGroups remain unchanged. This helper adds an observational AST projection; it is not a full UNSM parser or runtime structure validator.

## Test and acceptance order

New tests call the actual existing public parser, not a missing export, so baseline failures must demonstrate absent hierarchy. Independent test-wire encoding and literal expected values cover three UNA alphabets, multiple IDE/SEQ, omitted/repeated references, escaped separators/question marks, duplicate/empty identities, extra components, late RFF, no-IDE orphans, trailers/later messages and non-UTILTS controls. No existing assertion changes.

Request independent SOURCE/SPEC + bounded DESIGN/oracle review before runtime. Observe actual ordinary test-first RED, then implement the finite helper and public-parser integration. Exact-head ordinary CI and independent TASK/SPEC,QUALITY,TENANT-BOUNDARY,WHOLE-PR review precede guarded merge; fresh actual-main73/73+OPS and receipt follow. No local full-suite execution is claimed merely from CI downloads.

## Remaining work (not an exhaustive phase list)

Prerequisite B: identify and qualify an independent dated received-structure source, tenant/environment/object/agency/period/provenance binding and completeness. Then implement source-qualified comparison with valid first-observation meter inheritance, distinct observed register set, known versus unavailable structure, guide-before-function execution, actual final ACK/persistence effects and no fabricated peer fault on local failure. E035 remains open until that operational chain is verified. Full F3C-02/04/05/06/07 and later plan gates remain incomplete; reachable UNECE sources must be packaged/qualified, not called externally unavailable.

Skills applied: executing-plans, bounded source-to-code tracing, TDD and verification-before-completion; independent review through the actual repository review channel. No claim of unavailable subagent workflow execution. No UI, DB schema/auth, infrastructure, broad security or performance-remediation scope. Accepted D110/110+10/10 and PR351-360 are retained. PR310 remains OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a. No live DB/provider/market/settings/explicit deployment operations.
