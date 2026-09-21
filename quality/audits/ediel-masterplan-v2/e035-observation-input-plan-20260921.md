# E035 code increment A — lossless observation input

Status: PROPOSED; runtime base 7a13efd62e7dbcbd20286195fa6114494051fcda. User authorized the next code step and green, reviewed publication to main. PR310 stays paused at e961135199f292b8210884f07de3b616a670161a; no imports from it, live database calls, market sends, deployments or source/workflow/threshold changes.

## Resume provenance

The supplied Gridex_F3_fortsattning_PR360_E035_20260921.zip was opened and its verify_package.py executed: 17 file hashes, actual-main73 result rows/JUnit/commit binding, and317files/5010tests matched. Its E03521 cases are proposed NOT_EXECUTED oracles, not a green runtime certificate. PR360 is already merged; this work does not repeat it. Current main remains7a13efd6. GitHub writes are now available; local terminal GitHub DNS is unavailable, so ordinary GitHub CI is the repository execution authority.

## Why the input boundary is first

The retained source preparation distinguishes observation occurrences from physical registers, meter MG from meter SE, AES register identity, QTY220 readings from QTY136 energy, and first/later observation ownership. It also shows that E61/E62 predate October: attaching a comparator only to the25-A-4 delta flag is not authorized by that preparation. The dated received structural authority/loader, complete applicability, guide-first execution and persisted disposition still require separate qualification.

Actual lib/ediel/utilts.ts parseInboundUtilts currently tokenizes wire, exposes flat raw segments and first-match summary values but supplies no observation-owned meter/register/date/quantity projection. normalizeUtiltsRuntimePayload in utiltsEngine.part-1 spreads parsed.parsedPayload into normalizedPayload. buildInboundUtiltsMessageInput also copies this parsed payload. Thus a lossless raw input projection can be connected to real existing parser/draft/runtime consumers without inventing received structure, changing national outcomes or adding a fictitious authority producer.

This increment implements the missing INPUT CONTRACT, not the fullE035 comparator. It must NOT be described as fixing E61/E62, certifying guide order, proving database atomicity or closing F3. A helper without the real parser connection is not acceptable.

## Bounded implementation

1. Add lib/ediel/utilts/structuralObservations.ts using existing tokenizeEdifact/segmentComposite service-character semantics. Accept the actual tokenized wire and UNA, not cached JSON or tenant labels. Traverse linearly with physical message/transaction/observation boundaries. Keep original segment indices and decoded component arrays; preserve repeated/empty/malformed components rather than selecting an arbitrary first value. Never concatenate decoded components or strip punctuation.
2. Distinguish actual UNH/UTILTS messages, each IDE+24 transaction and each SEQ observation. End ownership at UNT, UNZ, another UNH/IDE or the next SEQ as applicable. Header/transaction RFF, quantities or dates may not donate observation data. Preserve all physical observations independently, including repeated AES and old/new meter occurrences. Do not infer inheritance, physical register count, date validity, guide acceptance or expected inventory.
3. Attach the explicit unvalidated-wire projection to parseInboundUtilts.parsedPayload.utiltsStructuralObservations. Retain every existing return field/consumer and builder. normalizedPayload/draft copying makes this a real reachable input rather than a detached utility. New data is diagnostic/input only: no E61/E62 emission, authority boolean, storage approval, ACK change or rule-version reselection.
4. Existing tokenizer failures must remain failures. Non-UTILTS text must not become structural authority from stale family/code labels. No generic parsing fallback, catch-and-accept or relaxed validation.

## Test-first and acceptance

Publish focused tests before runtime code. Through actual parseInboundUtilts, buildInboundUtiltsMessageInput and the public runtime, assert literal expected references/quantities/dates/positions and output propagation. Cover standard and two custom UNA alphabets, escaped delimiters/question marks, multiple transactions/messages, foreign-family/tag-looking data, missing/duplicate references, repeated AES across readings and across meters, energy-only observations, scope resets, raw preservation and unchanged dangling-release rejection. Lexical fixtures are not full normative golden messages. Existing tests/expectations remain unchanged.

Observe ordinary CI RED attributable to the absent input contract; preserve the receipt. Implement the minimum reader and parser connection, then require exact-head full ordinary CI, all typechecks, independent TASK/SPEC, QUALITY, TENANT-BOUNDARY and WHOLE-PR review. Only then expected-head guarded merge, actual-mainfull73/73+allOPS and a durable receipt. PRsmoke is never the mainfull certificate. Root must inspect actual results, not infer them from a bot summary.

## Source and skill limitations

Prior preparation read U3p138, U4p58/91/132 and OEp39–40 as primary-document excerpts; it did not rehash full original PDFs. The portal and authoritative UNECE retrieval routes were checked again; external UNECE access currently returned403. This is an access observation, not proof sources do not exist. This increment only preserves wire occurrences using the already accepted codec, and adds no new national rule interpretation. Full original qualification remains necessary before functional comparison.

Relevant workflow: executing-plans; current-source/differential inspection; false-positive qualification of the missing input contract; test-driven-development; requesting/receiving independent review; verification-before-completion. No repository-wide audit, UI, database migration, authorization change, infrastructure change or performance-remediation task is activated. No independent new review or fresh new-head CI success is claimed by this proposal.

Remaining after increment A: qualified dated structural source and loader; E61/E62 comparator for applicable rules of both revisions; real guide-stage execution and persisted per-transaction error/internal/success behavior; the rest of F3C-02/04/05/06/07 and later phases. D110/110+10/10 and bounded accepted PR351–360 work are retained, not reopened. FullF3/masterplan remain NOT_COMPLETE.
