# Multiple physical PRODAT messages — independent design gate

**SPEC: APPROVE the bounded same-function source interpretation.**

**QUALITY: APPROVE revised design at the scoped MM-1 gate.** The amendment below resolves the sole prior blocking omission. The initial finding is retained for audit history. Approval remains design-level only; no implementation/masterplan/source-manifest changes, tests, or subagents.

Read actual `multi-message-owner-design.md`, 21,265 bytes, supplied SHA256 `0d6a4e4e1dd9af92ffa7037cf36b25f78e4670f19bb22444a95e42df7c986d05`. Missing earlier discovery was caused by the ignored SDD directory, not an established filesystem defect.

## Source/spec

Frozen P p14 prohibits mixing PRODAT functions within one interchange and distinguishes BGM function from subtype. P p47 restarts LIN314 at1 in each PRODAT message, incrementing for every LIN repetition, including successive registers; subline258 belongs to its object. Frozen T §2.1.2 p13 requires delimiter-aware message counts/segment counts and matching references; §4.3.1 p25 defines UNZ0036 as the message count. I directly read those passages and independently verified T PDF hash `5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951`; P hash was independently verified earlier in this review session. These support more than one same-function UNH, not a mixed-Z04/Z06 positive fixture.

The stated 16UNH/16totalLIN/512segments/256KiB limits are explicitly implementation support bounds, not national limits. Holding unsupported cases without fabricating national error codes is correct. Unique nonempty UNH references and direct same-tenant routing are bounded support requirements. No broader source qualification follows.

## MM-1 — close the outer pre-business orchestrator, including actor-testing interception

The design thoroughly identifies `processInboundProdatMessage`, token-view handlers and `createAutomaticPositiveAcks`, but does not expressly specify what replaces the **outer source-level decisions before that handler**. This is load-bearing for the promised independent first-success/second-failure behavior and test-environment safety.

Actual current `lib/ediel/flows/inboundProcessing.ts`:

- `prodatInternalReview` (around282) reads a single parent `validation_report.prodatProcessingDisposition.kind`.
- The outer processing path (around852–865) finishes the whole source session and returns on global syntax/internal-review branches; the latter also invokes the source-level ACK builder. Mapping a conservative v2 aggregate to that field can prevent every otherwise independently qualified sibling from executing. Mapping it to the first child can instead conceal a later hold.
- Before the scoped PRODAT dispatch, around871–884, `syncActorTestingGlobally` is called with `autoRespond:true, autoSend:true`. If it returns true, the whole session is finished and the source returns without `processInboundProdatMessage`. Its helper around199–253 passes one original `EdielMessageRow` to `syncActorTestingForMessage` and treats any nonnull sync result as handled. This is an actual alternate auto-response/early-return path, not merely an optional UI diagnostic.

Required amendment: install an explicit v2 envelope dispatch barrier at the outer orchestration entry, after genuine route/envelope checks and before all source-level internal-review, actor-testing and automatic response shortcuts. Declare which failures block the entire envelope (syntax/routing/membership) and which are message-local. Parent summaries must not control independent child dispatch. For actor-testing, either implement a genuinely physical-scope-aware integration or explicitly hold/exclude multi-message automatic actor-testing until it exists, without marking the whole original handled/accepted or letting legacy autoSend run. Do not run old global hooks once per child against the same parent raw/ID.

Add two actual top-level integration proofs: (1) message1 genuinely commits while message2 has a canonical/internal-review failure and remains represented; (2) the same envelope under the actor-testing candidate conditions cannot create a first-message-only response or short-circuit the physical owner loop. Exercise this through the public inbound orchestration, not only the new view helper/owner-session constructor. This is a bounded routing amendment, not a demand to redesign all test tooling.

## Findings that support the design

- `sourceOwnerWire.ts` calls `singleMessage`, checks `scope.messageIndex===0` and uses `ast.messages[0]`; the proposed checked view entry points address the real restriction. Keeping sealed original bytes and global segment indices avoids fabricated child originals and original-hash ambiguity.
- `receivedSourceOwnerSession.ts` currently retains one `operation`, ignores later callbacks and matches index0. The proposed scope-keyed collector plus one complete finish is necessary; its durable actual-operation association and explicit crash/retry boundary avoid manufacturing roots from arbitrary accepted rows.
- `sourceSwitchCommit.ts` is a transient WeakSet capability with only message/switch/supply fields. Adding physical scope and an actual committed association is the right place to avoid relying on mutable parent customer/point/site links.
- Existing supply activation operates by real switch and can share a parent source reference across distinct points; there is no inherent need to insert rewritten child `ediel_messages`. The design correctly requires scoped correlation and actual business-write ownership instead of just weakening Z04 source joins.
- Current `structuralSourceSelection.ts` uses source-ID maps/parent edges. Composite physical identity is needed in versions, roots, replacements, coverage and closure references together; the design covers all of these and holds dependent same-object collisions.
- The proposed SQL projection independently reconstructs full envelope/physical geometry from sealed raw, rather than trusting caller indices. Complete composition/versioned facets retain malformed/zero-LIN siblings and prevent `objects.every` from vacuous approval.
- Source-wide v2 completion before using any positive inventory is a deliberately conservative support rule. It must remain separate from actual independent operational commits and national response decisions, as the design states.

## Concrete retained verification obligations (not additional blockers)

ACK uniqueness must be physically scoped throughout the kernel/preflight path, not only in a new plan DTO. `responsePlanItemFor` currently selects the first family plan; `createCanonicalAckMessage` in `core/kernel.ts` also enforces duplicate/conflicting outcome behavior. Preserve that conflict guard per physical national response scope when keys are extended: one sibling must neither suppress another nor allow an opposite finalized APERAK for itself. T §2.2 p18 expressly forbids changing a sent negative to positive or a sent positive to negative on the same message. An envelope CONTRL remains one envelope response, not one per UNH.

The planned subsequent UTILTS proof should assert actual selected physical source/root provenance plus final transaction result: matched structure, genuine E61/E62 mismatch, and unavailable/no-response/no-quantity result for incomplete expected evidence. A saved prior cutoff and previously finalized retained quantity must remain unchanged when a later sibling gets its witness. These exercise the design's stated retained-cutoff and response commitments; a two-callback assertion alone does not establish them.

Native forgery tests should keep source/hash, object spelling and LI identical while changing physical range/message reference/index, because differing point IDs alone make wrong-sibling rejection too easy. Include restarted LIN314 and register258 with hand-written expected global and local indices. The existing lexer/parsing budgets must be checked before positive completeness and writes, as specified.

## Verdict boundary

No further blocking source interpretation or immutable-owner design defect was identified. After MM-1 is concretely added, the proposal is suitable for bounded implementation and independent exact-head review. This report does not approve an implementation, certify all multi-message lifecycle variants, or change frozen manifest/masterplan status.


## MM-1 scoped rereview — resolved

Read the actual revised design, 26,931 bytes, SHA256 `a65d21f42bb30f1a95cd6afc24104d6eac35eb40212e7c325f166f4e23fa7dcb`. Rereview scope was MM-1 and any newly introduced breakage only.

**SPEC: APPROVE. QUALITY: APPROVE for bounded implementation.** No new blocking defect identified in the amendment.

The new outer orchestration section places the v2 route after genuine tenant resolution and before the parent canonical invocation and its legacy source-level shortcuts. Malformed/incomplete candidate envelopes cannot fall back to a first-message v1 path. The coordinator owns all child results and final complete composition; parent summaries are explicitly excluded from dispatch control. Message-local failure therefore no longer implies the old whole-source internal-review return, while genuine envelope failure still prevents all writes.

The actor-testing limitation is explicit and safe: side-effect-free classification by the real configuration/candidate owner; neither legacy sync function is invoked to discover eligibility; required or unknown interception in the supported test boundary becomes a complete unavailable composition without automatic sending or false handled/accepted status. A positively ordinary test route can still exercise the actual physical owner. This is an implementation support exclusion, not a new national-validity claim.

The amendment requires both proofs through `processInboundEdielMessage`: independent child1 commit/child2 hold, and the actor-test candidate case with no legacy hook/response/send calls and all scopes retained. It also names kernel duplicate/conflicting-outcome scope, preserves one envelope CONTRL, and adds actual final UTILTS selected-provenance/no-response/no-quantity and saved-quantity obligations. These strengthen the existing design without broadening its lifecycle authority.

MM-1 is closed at design level. Implementation must still prove the described public-entry, real-operation and native contracts before activation; this rereview does not certify them in advance or alter frozen source status.
