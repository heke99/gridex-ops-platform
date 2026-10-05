# Minimal cancellation process-basis authority — proposal for review

Design only, 2026-09-23. This supersedes the queued C design's assumption that a qualified target plus legacy reopening is sufficient for positive C authority. It does not block the separate bounded midnight L/LK closure implementation. No code or masterplan changed. Independent source/spec and owner-quality review is required before implementation use.

## Decision and source scope

Build an explicit, independently persisted **reviewed erroneous-termination process basis**, then require the C owner to reference it. The engineer can implement and prove this owner using qualified synthetic fixtures; each production approval still needs genuine retained process evidence.

Handbok26A printed pp46/93 supports correction of an erroneous termination or wrong end. P46 excludes resuming a valid hävning after payment without a new agreement/process. P70 requires a new LI for resent Z05L/LK. These support the narrow distinction below, not universal cancellation permission. Source/hash and detailed clause review remain in `handbook-lifecycle-design-addendum.md`.

## Existing objects: reuse as inputs, not cause authority

Inspected repository paths:

- `customer_cases`, `customer_case_events` and `ediel_message_events` have useful customer/source/process links but generic status/payload/metadata. Their success strings do not establish why an end was erroneous.
- `domain_events` has version/idempotency/actor/time fields but generic payload. A generic event does not become an independently qualified cause merely by referencing C.
- `customer_documents` stores mutable location/raw metadata without a source-owned immutable content hash contract.
- `lib/customer-contracts/documents.ts` offers non-overwriting storage paths and download/hash verification for signed-contract PDFs. Metadata may be updated; the archive function can take a supplied hash. Reuse verified byte retrieval patterns, not `verified_at` or a supplied digest as proof of cancellation grounds.
- `lib/customer-contracts/onlineSigning.ts` has real signing receipt/snapshot bindings. Those can establish an actual contract fact where applicable, but signing a contract is not proof that an earlier termination was erroneous. A new contract after valid hävning belongs to a new supply process.

No inspected owner already issues typed authentic wrong-end cause authority. New engineering is needed, not a request for another generic permission or a declaration that the task is impossible.

## Small independent evidence subsystem

Use private tenant/environment-scoped append-only tables with bounded payloads and no direct client DML. Suggested names are illustrative:

1. `closure_process_artifacts`: sealed bytes (small text/document limit, e.g. 2 MiB), DB-computed SHA256, media type, original source/document/message ID, complete tenant/customer/point/counterparty linkage, origin-system identity and immutable origin receipt/row snapshot. For EDIFACT, reference the existing sealed source; for a document, the server retrieves actual bytes and records the snapshot. A URL, caller-provided digest, OCR text alone or generic event payload cannot replace retained bytes.
2. `closure_process_provenance_assessments`: append-only authenticated provenance review of a specific artifact hash, named issuer, issuer's relevant grid-owner/customer role, origin chain, authentication evidence references, reviewer, decision/reasons, predecessor and server assessment time. Separate committed availability witness.
3. `closure_process_basis_assessments`: append-only typed cause interpretation referencing specific qualified artifacts/provenance assessments, exact target/C originals and immutable supply root. Separate committed availability witness.

Both assessment streams have the existing no-fallback latest-revision model, tenant filters, closed JSON shape, content/facts hashes, correction predecessor, explicit rejection/unavailable outcomes and witnessed availability. A negative/new unwitnessed revision invalidates use at later applicable cutoffs. Do not bolt an unversioned `basis_approved` boolean onto the C business marker.

### Supported provenance, explicitly bounded

Minimum production route is an actual retained **counterparty correction confirmation** from the grid owner responsible for the target original, corroborated by the relevant retained customer/contract/process evidence. It must identify the point, prior end/process and what was wrong. It can be a qualified document or an authenticated retained process record; it cannot be merely the C wire, which does not encode the legal/process reason.

The provenance owner must inspect the full original and verify its origin through retained evidence from an established authenticated channel, verifiable signature/issuer chain, or documented verification with a known counterparty contact. Persist which method was actually used and references to the channel/signature/contact-verification records. An arbitrary From address, uploaded filename, caller-supplied legal actor ID, self-authored review note, or unverified contact supplied in that same document does not suffice. If a proposed method has no independently retained verification records, that method is unavailable until its producer is implemented; do not fake a passing record.

A human provenance assessment is a narrowly authorized review decision about particular immutable artifacts and origin evidence. SQL cannot prove natural-language truth or a PDF's business meaning; it can enforce that the named, authenticated owner reviewed the exact captured evidence using a supported method. Do not describe this as automated cryptographic verification when the chosen method is documentary/contact review. If crypto verification is selected, the actual verifier and trusted issuer binding must produce its receipt.

Require a separately permissioned `closure_process_evidence.review` (or equivalently narrow existing reviewed authority if demonstrably appropriate), checked from the current actor's authenticated server context, not a caller-chosen reviewer UUID. Existing communication-write permission by itself must not silently acquire this new interpretive capability. Role assignment follows ordinary tenant authorization, without a new per-instance external approval ceremony.

## Closed basis contract

`owner: reviewed-closure-process-basis-v1`, `version:1`, with:

- tenant/environment/customer/point/site/switch/supply plus committed-root and reviewed-baseline exact references;
- `targetClosure:{sourceId,payloadHash,assessmentId,factsHash}` and `cancellationOriginal:{sourceId,payloadHash}`;
- `basisKind: erroneous_termination | erroneous_end_date`;
- `processClass: supplier_switch | move_out` in the first slice; unknown, valid-rescission/resumption, invalid-rescission disputes and other processes remain explicit unavailable outcomes;
- `targetWasErroneous` expressed as a typed finding (`no_termination_should_have_occurred` or `wrong_end_boundary`) with artifact/provenance references and precise content locators supporting each finding; no free-floating boolean;
- `rescissionContext: linked | positively_excluded | unresolved`, with positive documentary/process references and a list of authentic linked Z08H evidence if present. `positively_excluded` means the records positively identify the target as the supported switch/move-out correction, not that a partial search found no Z08H. A conflicting actual Z08H/rescission signal must be resolved or held; first slice accepts no linked valid rescission;
- `correctedEnd`: null for erroneous termination; exact supported market midnight plus UTC for erroneous end date, bound to the correction evidence. This is a constraint on pending restoration, not a replacement closure owner;
- basis scope, source/provenance snapshot IDs/hashes/cutoff, review statement, reviewer and DB assessment time;
- process timing evidence where applicable, including a source-owned actual dispatch receipt for the wholly erroneous supplier-switch deadline branch. Neither DTM137 nor an asserted sentAt replaces dispatch evidence. If unavailable, this branch holds; LK correction need not invent a supplier-switch deadline.

Content locators are exact retained text spans or document page/region references, checked for artifact membership. They help the reviewer substantiate the finding; no regular expression on arbitrary prose is treated as legal authority. Context history must satisfy the mandatory owner universe below. Incomplete absence never proves non-hävning; positive evidence and resolved conflicts are required. A positive document cannot override a missing required reader or unresolved contradictory process record.

### Mandatory process-history universe (C-PB-1)

A saved process snapshot is additional to the existing inbound source snapshot. It must enumerate all three required owner sets:

1. Retained **outbound Z08H originals**, their source-owned actual dispatch receipts and their process state/revisions. The existing inbound-only ledger cannot supply this set. Implement bounded immutable outbound capture/backfill qualification and its reader where missing; a mutable outbound message/status query alone is not the required owner.
2. Relevant inbound original Z05L/LK, C and possible replacement sources/assessments from the actual immutable received-source ledger.
3. Linked customer/contract/process histories used to establish the asserted correction and counterparty provenance, including original termination/rescission records, not merely the documents selected by the reviewer. Generic mutable row state must be captured and qualified with explicit historical coverage limits; it cannot retrospectively prove events that were never retained.

Every required read has tenant/environment, stable customer/point/counterparty scope, authenticated capture/observed-commit times, exact source counts and bounded inclusion rules. Return complete=true only if the entire relevant set was read within limits and required retention covers the process history from the original supply/process initiation through the review cutoff. Save owner coverage start/end and explicit missing-history spans; count success over an inadequately retained period is not historical completeness. Each contributing assessment has its own revision/factsHash/availability; the saved snapshot records all witnesses and cutoff. A required reader failure, truncation, missing retained interval or unavailable required producer yields a scoped unresolved result even with a convincing positive document.

Match Z08H against target by object/agency, tenant/environment, initiator-aware legal counterparties, LI and stop; account for reversed outbound versus inbound FR/DO. LI alone is not globally unique. Include malformed or partially linked potentially matching records as unresolved candidates: missing date, customer linkage or party component cannot silently exclude a same-point rescission signal. Use known scope plus wildcard missing components; genuinely proven unrelated histories remain irrelevant. Unknown/unbounded scope within a required universe can make that scoped read incomplete. Do not claim finite retained database completeness establishes universal real-world completeness; the decision combines explicitly covered internal history with positively authenticated external correction evidence.

Required new oracles: positive correction document plus an actual conflicting outbound Z08H holds; the same document plus a failed/truncated reader, missing outbound capture or pre-retention gap also holds. A positively unrelated outbound Z08H does not globally block another point.

### Prospective-only corrected-end support (C-PB-2)

The first slice **excludes retroactive corrected-end changes**. It does not implement the handbook exception requiring customer-agreement necessity and supplier contact. A later extension needs typed, retained, authenticated evidence of those conditions; a generic counterparty correction document is not automatically proof of the contact event.

Classify this support boundary against the actual correction process events: require authenticated source-owned dispatch timing for C, and, when the replacement arrives, for the new Z05. Convert each to the existing Swedish fixed-standard-time calendar/instant. The corrected midnight must be strictly later than both applicable dispatch instants. This strict future-boundary condition is a conservative support subset, not an invented national rejection rule. An earlier/equal corrected end or unknown required dispatch timing is unavailable for positive basis/replacement resolution. Before replacement dispatch exists, the basis can establish its prospective constraint against C dispatch, but it remains conditional and cannot clear the pending bound until the replacement passes its own check. Never classify with reviewer time, DTM137 creation time, or an invented sender timestamp.

Keep the wholly erroneous supplier-switch day-before-original-end deadline as a separate branch and predicate. Test prospective midnight success, retroactive/equal boundary hold, and missing dispatch-evidence hold without issuing a national ERR. Retroactive excluded contexts must still enter the knowledge-time blocker projection below; unsupported does not mean invisible.

Initially reject basis approval if no qualified independently originating correction confirmation, no supporting process facts, wrong target linkage, contradictory effective boundary, unresolved rescission, missing required timing evidence, or solely payment/new-contract/active-status evidence. This is a support rule, not an invented national error code.

## SQL authority and lifecycle order

A dedicated append RPC obtains caller identity from authenticated context, validates tenant permission/company state and records the reviewer itself. The server captures originals before review; SQL hashes its stored artifact bytes and validates exact references to immutable sources/qualified provenance. A caller cannot author both alleged external evidence and its positive provenance in one C append request.

The basis append checks target source/raw L/LK projection, current accepted target assessment with witness, C source/raw Z24 projection, common object/parties/LI/old stop, exact root/coverage identity, snapshot membership and time ordering. It checks current provenance revisions/witnesses and the required typed evidence roles. Validate relevant parties and live graph under the existing single owner-validation MVCC statement; serialize basis corrections and acquire consistent target/basis locks as needed to close append-versus-revision races. Historical reads use assessment/witness cutoff, not current mutable case status.

The C append must reference the **already committed and separately witnessed** basis ID/factsHash and verify its latest applicable accepted version. It retains all existing independent raw-source, target, party, supply and snapshot checks. Basis approval alone neither changes operational dates nor cancels an edge. Successful legacy reopening alone neither issues a basis nor substitutes for one.

Order for the corrected-end branch: capture/review evidence → witness basis → real legacy C reopening → reviewed/witnessed C → independently qualify the new original closure when its own lifecycle state permits. Do not require the new closure already committed before C review: that would overwrite the very active/source=C state the existing C owner requires. Until the new original/owner exists, retain a pending-correction blocker constrained by the positively evidenced corrected boundary. Before that boundary, restoration may be used only if the full remaining coverage/inventory is already proved; at/after it, hold. If no trustworthy new boundary is established, do not approve this basis kind or infer unbounded coverage.

### Pending boundary at every knowledge cutoff (C-PB-3)

This overrides the inherited cancellation design's old-stop-only lower bound whenever correction context is known. The process snapshot/readset must include relevant captured artifacts and process records **even when provenance or basis is unreviewed, rejected or unwitnessed**. Artifact capture has a retained commit-availability receipt and original scope/link observations; positive semantic authority is a separate witness. Known but incompletely witnessed capture/history prevents completeness rather than making a potentially applicable source disappear. A rejected interpretation is not proof that its underlying correction concern has no effect.

- Before any relevant correction record is visible by the saved knowledge cutoff, retain that saved original view. No subsequently captured evidence backdates itself into an older selection merely because its document describes an earlier event.
- Once a relevant raw C, correction artifact/process record, unavailable/rejected basis, or witnessed basis is visible, compute the earliest proved or plausible affected boundary from all matching evidence: include both old target stop and any earlier proposed corrected stop. If scope is known but no safe lower bound is provable, hold the whole matching supply/object interval. Missing components are wildcards, not mismatches. Untrusted proposed dates can create holds, never positive coverage authority.
- Before a current timely C witness, this rule is **only a blocker**: the old closure remains in force and no cancelled-edge restoration occurs. In particular, between an earlier newly evidenced stop and the old stop, return unavailable even if the basis is not yet approved.
- After the accepted C witness, remove only its named target edge, retaining the corrected-boundary blocker, earlier independent bounds and all structural changes until the separately qualified new original resolves that specific pending process. For a positively qualified basis with exact new boundary, preserve the conservative hold at that boundary; do not turn it into national mismatch or a synthetic accepted closure.
- Later rejected/unwitnessed process/basis revisions cannot fall back to an earlier accepted permissive view. Only an explicit separately qualified resolution can clear a previously applicable concern. Its evidence and effect must participate in the saved cutoff; this slice otherwise keeps the hold.

Native sequence: original end day30, authentic prospective correction to day20, context captured day10, basis witness day11, C witness day12, new-original witness day13. Prove a day25 query is held from day10 onward even before either approval; an earlier saved day9 knowledge view is unchanged. At day20 exactly, current/closing point and interval sides retain conservative blocker equality until the proper new closure is qualified; then ordinary accepted-closure boundary rules apply. Also exercise rejected/raw/unwitnessed context, absent proposed date, proposed date later than original, and earlier independent closure. Persisted historical decisions/finalized retries remain immutable.

When the new original appears it must carry its distinct LI and own exact original identity; qualify it independently and then remove only the pending-correction hold it actually resolves. Keep any earlier independent coverage bound and other closures. This prevents cancellation from reviving an unrelated ending or historic meter state. All older saved selections/finalized retry outcomes remain unchanged.

## Native proof with honest fixtures

Build explicit synthetic test-owned parties, authenticated reviewer roles, sealed original documents/process records, actual provenance assessments, basis commits/witnesses, genuine Z04 root/reviewed coverage, closure and legacy reopening. Synthetic fixtures exercise the owner; they are never represented as actual customer evidence.

Required positives: a documented erroneous LK termination with positive original process identity, and a documented changed-end correction whose new distinct-LI closure later resolves the pending bound. If testing the wholly erroneous supplier-switch branch, produce a real synthetic dispatch receipt satisfying its deadline.

Required negatives: C-only or active-row-only proof; free-text reviewer reason without artifacts; forged author/role/hash/document bytes; wrong tenant/target/customer; revised artifact/provenance/basis without timely witness; incomplete-history no-Z08 inference; actual linked valid Z08H plus payment/new contract; contradictory target explanation; fabricated dispatch time; same-day old/new minute forgery; incorrect new LI; earlier independent closure; unqualified post-close Z06/Z10; current basis revision absent from saved snapshot; concurrent invalidating revision.

Test that missing per-instance evidence gives a scoped hold, no national mismatch invented, and no positive C/ACK/quantity authority. Then prove before/between/after witness cutoffs and exact new-boundary sides. The proposal replaces a known permissive C assumption with an implementable evidence owner; it does not require inventing an external agreement or pause unrelated closure work.

## Independent review amendments recorded

C-PB-1: mandatory inbound/outbound/process readers, exact-count retention coverage and failed-reader holds now explicit. C-PB-2: first slice prospectively bounded using actual dispatch events; retroactive/unknown timing held. C-PB-3: raw/unapproved correction context participates in saved knowledge readsets and blocks from the earliest plausible boundary before C witness. No implementation approval is implied by this revision.
