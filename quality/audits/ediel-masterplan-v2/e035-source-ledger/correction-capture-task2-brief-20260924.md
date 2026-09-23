## Task 2: Immutable concern capture and authentic input boundary

**Files:** New forward `supabase/migrations/<CLI-timestamp>_ediel_correction_concern_capture.sql`; create `lib/ediel/sources/correctionContextCapture.ts`; tests `__tests__/ediel-correction-context-capture.test.ts` and native `scripts/ediel-correction-context-native.test.ts` (included in `scripts/ediel-source-owner-native.config.ts`).

**Interfaces:** Service capture accepts actual retrieved bytes or existing sealed `gridex_received_sources.sources` ID/hash and observed linkage; returns `{captureId,companyId,environment,contentHash,capturedAt,availableAt}` only after committed availability. Do not accept caller-provided content hash, reviewer UUID or effective truth. A candidate provenance row can record `unavailable`/`rejected` and predecessor, but no accepted basis or C entitlement is exposed.

- [ ] Write failing native cases for byte/hash substitution, cross-tenant target, wrong environment, duplicate content with different provenance, unauthorized client DML/RPC, update/delete/truncate, and witness-in-same-transaction. Include actual `downloadAndVerifyCustomerContractDocument` readback for a synthetic signed-document source and a negative mismatched byte case; its signing receipt alone must not create a correction finding.
- [ ] Create private tenant/environment tables for bounded bytes (2 MiB maximum), DB SHA-256, exact source reference, issuer/channel observations, customer/point/site/supply candidates, server capture/commit, append-only revision/predecessor and separate committed availability witness. Force RLS, revoke client/service direct DML as in `gridex_received_sources`, and expose only service-wrapped narrow RPCs. Authenticate the server capture caller and enforce tenant scope; no arbitrary reviewer ID as authority. A missing origin/channel remains explicitly unknown, not silently authenticated.
- [ ] Call capture from a server-owned action/service path that retrieves bytes itself; a form can submit only a source/document ID and claimed scope. Do not add a positive review UI. Tests assert a captured-but-unreviewed concern is visible at a new cutoff and an earlier snapshot remains byte-identical.
- [ ] Run focused Vitest, native capture/RLS fixture and migration integrity. Commit this capture as an independently testable evidence-only unit.


## Global Constraints

- Start from accepted merged PR371/main `2a148d39d631fc759c99cd1c69350b5e2147dbdb`; final head65f5b896 and OPS35931020643 passed all gates. Preserve merged PR370 closure/retry behavior.
- This is C-PB-1/C-PB-3 hold-only. No positive provenance/basis or C marker, no closure-edge removal, no reopened supply authority, no new market response or quantity.
- Direct agency-9, one physical PRODAT message, post-ledger root is the positive baseline. Unsupported namespace/history stays unavailable.
- Preserve exact source/cutoff and retry immutability. An absent historical record or missing retention coverage is not a negative finding that no rescission occurred.
- Use a new CLI-created forward migration. Do not edit published migrations or generated contracts by hand. No hosted writes, market sends or deployment in this task.
- Source authority is the approved `quality/audits/ediel-masterplan-v2/e035-source-ledger/cancellation-process-basis-design.md` and its amended review. This plan deliberately defers C-PB-2 positive prospective classification.


## Concrete preflight and sequencing
Read quality/audits/ediel-masterplan-v2/e035-source-ledger/correction-context-capture-preflight-20260924.md and this workspace platform-preflight.md. Sealed original Z05/C source-ID capture is the smallest supported route. The document-context portion of the Task2 requirement must be either implemented with actual retained bytes plus tenant/contract linkage and existing appropriate retention classification, or explicitly reported as an unresolved implementation concern before commit; do not silently relabel it completed. No invented legal retention policy or authenticated correction origin. Existing signed-document verification proves bytes only. Do not add positive semantic approval. Parent resolves scope/design questions before dispatch proceeds.

CLI available: npx --yes supabase@2.101.0; version and migration new --help already inspected. Use it to create forward file. Native testing is through ordinary isolated CI, not hosted DB. Do not fabricate generated types; report pending typegen contracts and parent will copy actual artifacts. User authorizes ongoing bounded branch publication/PR/CI after review; parent owns these actions, memory and any generated-contract reconciliation.

## Parent checkpoint resolution
Concrete initial discovery: no reviewed existing retention mapping/archive coverage for new copied correction-context PDFs. Proceed sealed-source-only Task2 checkpoint, explicitly leaving document byte capture UNRESOLVED (not Task2 complete). Report DONE_WITH_CONCERNS, not blanket completion. Document input stays unavailable; no invented policy/positive authority. Existing contract-document metadata locks source identity/hash after storage and forbids DELETE (20260716183000); parent will later assess original archive reference alternative without new byte copy. This nuance does not prove retention completeness.

## Source-date clarification
Bare C DTM93 is an observed original date, not proof of the old target boundary. Without an independently linked authentic L/LK target, oldStop must be unknown (retain any parsed source date as a separate observation). A bare-C proposedStop may be not_asserted, but oldStop unknown still holds the whole matching interval under Task1. Task4 may enrich from genuine target evidence without rewriting capture. Include a regression proving C's own date cannot narrow an unproved earlier boundary.
