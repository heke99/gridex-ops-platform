# Ediel masterplan v2 — governance batch

Base: main after PR #317 (`f55392a46b0be2774f723b967b94c25974f40813`). PR #310 remains paused and is not imported.

This batch adds executable boundary coverage without changing the immutable masterplan package or claiming production certification.

## GOV-01

Existing canonical rule-pack activation is fail-closed through `canonicalRulePackRegistry` and the database evidence resolver. The source-identity harness already rejects missing activation, malformed hashes, mismatched revisions, invalid validity windows and incomplete runtime evidence. The new governance test additionally checks that every source-controlled guide entry carries explicit document identity, revision, validity and authority.

This is still **PARTIAL**, not full AT-GOV-01: the source-controlled `AuthoritativeEdielGuide` type does not itself carry a document SHA-256 and exact page/section locator. Those are represented separately by DB evidence/source traces. Do not mark GOV-01 VERIFIED until one immutable provenance contract binds those pieces without inventing hashes or locators.

## GOV-02

Existing PRODAT source-locator and field-matrix regression work covers the canonical 26-A field matrix and parser/renderer coherence. No new semantic rule is invented in this batch. Keep the acceptance state conservative until the complete AT-GOV-02 positive and conflicting-register fixture set is explicitly mapped.

## GOV-03

Executable test proves family-specific guide selection: UTILTS and PRODAT-origin APERAK do not collapse into one generic guide. Existing ACK regression coverage remains authoritative for wire behavior.

## GOV-04 / GOV-05

Executable tests prove the 2026-09-30/2026-10-01 outbound boundary, current-only outbound selection, the exact 2026-10-01..2026-10-14 inbound grace window, expiry on 2026-10-15, and that shared `E5SE5A` does not identify a guide revision.

This does not claim that every persisted queued payload/resend path has been certified; PR #317 separately tightened queued SMTP destination binding.

## GOV-06

Executable test proves a canonical policy is resolved for one explicit reference date and returned as a frozen snapshot. Existing `ediel-utilts-decision-reuse` and processor-decision-reuse tests remain the stronger evidence that the selected decision is reused rather than recomputed with an implicit current time.

## GOV-07

The test proves a future UTILTS guide is not selected before its effective date. The specific masterplan energy-sharing/S18 capability remains **BLOCKED / NOT VERIFIED** because no source-backed capability implementation was found on main. Do not create or activate future message codes merely to satisfy the checklist.

## GOV-08

**BLOCKED / NOT VERIFIED.** The masterplan requires original-file hash, source, test case, revision, role and expected positive/negative outcome for TGT/reference fixtures. No complete source inventory satisfying that contract was found in the independent main line. Do not rewrite reference fixtures or fabricate source hashes. This remains a later evidence-ingestion task.

## CI requirement

The new governance test is added to the existing Ediel masterplan v2 workflow. Merge only when the exact PR head passes the normal repository CI. No required gate is disabled or downgraded.
