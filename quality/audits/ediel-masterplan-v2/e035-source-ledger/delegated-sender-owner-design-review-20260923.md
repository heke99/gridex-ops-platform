# Delegated counterparty sender design — independent SPEC / QUALITY review

2026-09-23. Reviewed `delegated-sender-owner-design.md` (design baseline `6d2811af9b578aee042727b75747b265f286bda1`) against local code at `c18355fff4bdb465dc393c485497a8f25ef0e42c`. Read-only review; no production/test changes and no tests executed. This report is a design judgment, not implementation or instance-authorization acceptance.

## Verdict

**Buildable owner/ledger plumbing, with one temporal-lifecycle clarification required; positive producer remains unqualified.** The design correctly refuses to equate uploaded XML, a verification flag, a hash, a reviewer decision, or receiver configuration with a legal sender mandate. It explicitly records the missing authentic capture and provider contract. The supplied original guides support the legal-agent model, but do **not** supply enough evidence to implement and certify the proposed positive official-directory producer. Keep that enabling gate closed until the documented input is supplied and qualified.

This is more than a missing example of one customer's authorization: the acquisition contract, official record semantics, historical validity/withdrawal semantics, and independent actor/EDI eligibility evidence are still inputs. A redacted authentic record alone is insufficient without those semantics and a trustworthy acquisition path. Conversely, this review makes no claim that such evidence does not exist externally.

## SPEC findings

### S1 — Positive producer source qualification is an explicit outstanding dependency

The design's section 1 correctly names this dependency and its final acceptance sequence puts qualification before positive implementation. Preserve that order. T §5.2.2 distinguishes a legal agent in UNB from the represented party in NAD and explicitly excludes SMTP-only providers. T §7.4 describes maintained portal information and logins; it does not define an authenticated export/API, response signature, historical interval, withdrawal contract, or actor-agreement-status field. P p45 establishes valid legal NAD FR identity and `160/SVK`, not a portable delegation credential.

Required receipt for enabling the producer: official origin/acquisition contract; representative authentic response with exact record semantics and locator/version; proof that the record means legal representation for the relevant direction/family/market; validity/withdrawal semantics; qualified principal and agent identities/EDI eligibility; and an independently qualified link to the selected grid owner. Synthetic capture fixtures can prove mechanics only. No guide-derived default dates or guessed endpoint may fill these inputs.

**Status:** the design handles the absence honestly; not a hidden implementation defect. Plumbing may be specified and built fail-closed, but this design cannot yet certify a real producer or a real delegated instance.

### S2 — Receipt-time policy and preserved scope are supported as explicit local policy

The design calls receipt-time evaluation conservative internal policy rather than attributing it to T. That distinction is sound. Source-effective supply time remains separate. No historical authority is inferred from current presence or capture time. PRODAT-only enablement and unavailable subaddresses retain bounded scope; the text does not invent UTILTS per-series agents. NAD FR remains the legal grid owner, and UNB keeps the full original components.

## QUALITY finding

### Q1 — Specify how a retrospective authority correction reaches future source selection

Section 2 says a later withdrawal/correction receives an append-only assessment and a selection blocker “as appropriate.” This is the right intended result, but the work allocation and visibility boundary are not yet concrete. Clarify which owner finds affected source assessments and appends successor unavailable decisions, or which durable snapshot blocker prevents reuse until reassessment, and how capture publication is ordered with that action.

Actual basis: `receivedSourceDecisionTimeline.ts` selects the last predecessor-linked source assessment visible at cutoff; `structuralSourceReadset.ts:46–74` projects its persisted object disposition; `qualifyReceivedStructure.ts:38–57` consumes that readset. These paths do not inspect an independent authority ledger. Therefore merely appending an authority withdrawal/version would not change an already accepted source's disposition at a new consumer cutoff. Adding live directory lookup to old snapshot replay would instead violate the intended immutable proof model.

Required lifecycle case: accept source A with authority V1; subsequently commit genuinely retrospective correction V2 establishing that V1 did not cover A's receipt instant; a **new** consumer snapshot must hold A (or use an explicit qualified successor), while an already captured older snapshot and immutable nonheld retry reservation retain their recorded result. Also test the distinct harmless case where authority expires only after A's receipt. Define complete tenant/environment-scoped dependency discovery, unavailable behavior if that discovery/reassessment is incomplete, and the concurrent capture/consumer ordering. A generic test of revocation against a newly created assessment does not cover this existing-dependent-assessment case.

**Severity/status:** medium design clarification before positive implementation; not a claim of a current direct-sender production regression. The present design already promises a blocker, so this finding asks for its concrete owner and atomic visibility contract, not a broader authorization redesign.

## Confirmed integration boundaries

| Boundary checked | Assessment |
|---|---|
| `tenant/tenantEdielIdentity.ts` | Canonical receiving identity uses tenant identifiers/roles, dated `ediel_transport_agent` relations and separate platform transport identifiers. These are receiver evidence, not counterparty sender authority. Preserve the independent reads and exact-count requirements. |
| `actor-registry/parseActorRegistryXml.ts:103–113`; `importActorRegistry.ts:474–486,537–575` | Parser copies the route party identity and derives verification from populated fields; importer supplies identifier verification and hashes user-uploaded XML. No authenticated legal mandate or dated principal-agent evidence is established. Separate capture owner is necessary. |
| `sourceOwnerWire.ts`; `structuralSourceWire.ts`; `closureSourceWire.ts` | Current direct equality is a deliberate fail-closed parser boundary. Removing equality is safe only with mandatory sender-owner replacement in every path; retain original physical identity, qualifiers and unsupported-component handling. |
| `receivedSourceOwnerSession.ts`; `reviewReceivedStructuralSource.ts`; `reviewReceivedClosureSource.ts` | Actual committed Z04 handoff and reviewed coverage paths independently bind receiver and NAD legal sender to the selected facility/grid owner. Delegation must be added to these owners, without replacing their business or receiver proof. The proposed design does so. |
| `20260922144906_ediel_source_object_decisions.sql`; `20260922205926_ediel_reviewed_structural_source.sql`; `20260923113014_ediel_closure_original_wire_binding.sql` | Existing SQL exact owner-row readsets, direct party proof and original-wire equality require coordinated forward changes. Private dedicated capture ingress plus independent SQL selection avoids caller-authored JSON authority. Complete candidate sets and committed visibility are essential. |
| Durable timeline / structural readset / actual UTILTS consumer | Existing snapshot proof must remain immutable. Design's real-process E30/E66/S07 persistence, ACK and quantity tests are necessary, alongside version-aware accepted-party validation in the timeline; serializer success alone cannot qualify the path. Q1 covers correction propagation to future snapshots. |

The design adequately binds company/environment, immutable source UUID/hash, canonical assessment, full physical message/object/register identity, legal principal and original UNB agent, selected capture/version/locator, and independently qualified actor/facility binding. It deliberately does not accept hash-as-authentication. No additional source-backed violation was found in the proposed direct/delegated branching or preservation of receiver delegation.

## Evidence read

Original local excerpts: `/workspace/scratch/db7cad0629c3/sources/technical.txt` lines 1341–1482 (T §5.2.1–3) and 1989–2018 (T §7.3–4); `/workspace/scratch/db7cad0629c3/sources/prodat.txt` lines 1864–1904 (P NAD sender p45). Corresponding original PDF identities/hashes are recorded in the design; this review read the local excerpts and did not independently rehash PDFs or search for new provider documentation. Code/schema paths are listed above. No test execution is claimed.

## Scoped amendment rereview — Q1 closed at design level

2026-09-23, local HEAD `46b9b29d864ed2f0f2db0f3895111734a0cf7c84`. Reviewed the revised acquisition steps and new §3a only, with dependent snapshot/closure consumers and import writers. No production changes or tests.

**Updated verdict: design-qualified fail-closed owner/ledger plumbing; positive producer still unqualified.** Q1 is resolved in the design. This replaces the initial verdict's temporal-lifecycle clarification requirement; S1's authentic acquisition/record-semantics dependency remains open and explicitly acknowledged.

| Earlier item | Amendment and verdict |
|---|---|
| Q1: publication owner and dependent-assessment propagation | `publish_sender_authority_revision` publishes the qualified revision and immutable correction event in one transaction. Mandatory SQL-derived dependencies commit with each accepted delegated object. The snapshot owner joins these with all candidate assessments in one MVCC statement and records the blocker in the immutable readset. This supplies a concrete owner and visibility contract. **Closed for design.** |
| Q1: future selection versus immutable historical proof | New snapshots apply correction events visible at acquisition even with an older requested business cutoff; existing snapshot replay retains its bytes/hash. Clearing requires a qualified successor assessment resolving the event. Nonheld retry reservations remain immutable, and held retry uses fresh qualified selection. The distinct business cutoff and current safety observation are explicit rather than silently backdating evidence. **Addressed.** |
| Q1: closure and fallback | Affected closure retains a scoped window blocker; it cannot disappear and revive supply. Source identity cannot fall back to an older assessment/predecessor. Missing dependency, unknown scope or budget overflow makes the new readset incomplete/unavailable. **Addressed.** |
| Q1: concurrency and shared principal | Atomic event publication prevents partial correction visibility; late V1-based assessment remains discoverable through its mandatory dependency. Shared-principal events are joined separately for each authorized tenant/environment rather than relying on a publication-time tenant enumeration. Native interleaving, cross-tenant, truncation and old-cutoff tests are specified. **Addressed.** |
| S1: actual authority acquisition | The new steps first recover referenced original files and bounded import lineage, then follow actual origin/schema references. They expressly avoid invoking preview/import writers or treating stored flags as official provenance. A final acquisition receipt separates bytes, authentic origin and semantics. **Good next action; does not qualify the positive producer yet.** |

Actual code checks support the amendment's integration points. `open_object_selection_snapshot` currently obtains bounded candidates, assessments and witnesses in one statement, stores its exact text/hash and PostgreSQL visibility snapshot, and exposes overflow as incomplete. Adding a versioned correction/dependency readset at that boundary is compatible with that architecture. `receivedSourceDecisionTimeline.ts` has closed version/key checks; implementation must update its decoder together with the SQL readset and preserve historical version decoding as already required by the design. `structuralSourceReadset.ts` and `closureSelection.ts` carry unavailable closure impact into scoped blockers, supporting the specified non-revival policy. The new native tests must prove actual statement visibility rather than use wall-clock/provider timestamps as commit evidence.

The acquisition amendment's concrete writer descriptions match `app/admin/network-owners/actions.ts` and `app/admin/ediel/actors/actions.ts`: both accept uploaded files, and actor import preview creates a run. `parseActorRegistryXml.ts` preserves only fragment length/parser metadata in the staged raw projection, so reconstructing authentic original bytes from that projection is not a valid route. No hosted records, session, archive inventory, or official provider export were accessed by this rereview; their availability and semantics remain to be established by the planned acquisition task.

No new source-backed SPEC or QUALITY blocker found in the amendment. This is approval of the bounded design contract, not permission to replace the outstanding authentic producer input with mocks, not acceptance of an implementation, and not closure of delegated-sender E035.
