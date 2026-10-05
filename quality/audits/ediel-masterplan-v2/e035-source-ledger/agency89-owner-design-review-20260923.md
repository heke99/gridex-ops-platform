# Agency 89 owner design — independent SPEC + QUALITY review

2026-09-23. Read-only review, observed HEAD `89670121655b35095b1229ee45c65238c4058612`; closure implementation may proceed independently. No production/test/schema/frozen-plan edits and no external writes. Reviewed design `.superpowers/sdd/market-structure-plan-20260922/agency89-owner-design.md` and the bounded actual code/schema/source paths below. Verdict: **REVISE before implementation authorization**. The proposed ownership model is sound in direction, but the end-to-end construction and persistence boundary need concrete amendments.

Skill routing: bounded code-review/find-bugs/spec-to-code comparison and direct false-positive checks; existing debugging/source-to-sink discipline. No full repository audit, broad test execution, database writes or new subagents. No runtime/native test results are claimed for this design review.

## Source qualification

Read actual `/workspace/scratch/db7cad0629c3/sources/prodat.txt`, PDF-page-separated P47, P114, P116 and P120, plus the field209 requiredness table. P47 explicitly supports agency89 for distributor-assigned field209 IDs (max25 characters), and distinguishes agency9. P114 treats separate meters as separate physical IDs; P116 preserves the same ID across a meter's registers. P120 requires identity and agency to agree. Thus typed agency+exact identifier and preservation of physical/register membership are appropriate. Issuer qualification is a justified engineering requirement for distributor allocation; these pages alone do not prove a historical local-UUID correspondence.

No finding against preserving exact decoded text, preventing normalized aliases from granting historical89 authority, refusing manual approval as a substitute for a Z04 supply root, or keeping unsupported branches held.

## Findings requiring design amendments

### Q1 — HIGH: nullable aliases are storage-feasible, but the proposed graph cannot reach the real Z03/Z04 root through existing consumers

Evidence:

- `supabase/schema.sql:9727`/`:10243`: site facility ID and point identifier columns are nullable; uniqueness is partial. This supports the design's *storage* claim. I did not find a general NOT NULL constraint forcing the plain identifiers, so that hypothetical issue is not a finding.
- `lib/customers/meteringIdentity.ts:getMeteringPointIdentity` returns only `meter_point_id` or a verified `ediel_reference`; a UUID deliberately does not qualify.
- `lib/operations/readiness.ts:120` creates critical `meter_point_id_missing` for a point with only a new private binding. `checkSupplierSwitchReadiness` consumes that result, and `supplierSwitchOrchestration.ts:270` also requires legacy facility/point identity.
- `lib/ediel/prodat/compatAdapter.ts:354` rejects absent legacy point identity. `flows/prodatSwitch.ts:241-265` constructs the outbound Z03 intent from plain `ediel_reference`/`meter_point_id` and site ID. `compatAdapter.ts:483` supplies `meterPointId`, but no new typed89 binding/agency at this boundary; the existing renderer defaults missing agency through `prodatObjectIdentityAgency`.
- SQL readiness views also explicitly require plain IDs (`schema.sql:55356-55359`, and process-readiness projections around26781-26882).

Impact: even a valid new private binding cannot produce the required actual outbound Z03 and consequent Z04 supply commitment. Filling a plain alias merely to make readiness pass would defeat the namespace isolation, and defaulting agency to9 would contradict the original.

Required amendment: explicitly include namespace-aware verified identity resolution in the real switch readiness/preflight, intent and Z03 rendering path, with the binding UUID and exact issuer+agency+identifier carried and revalidated. Keep every existing legal/contract/tenant/route gate. Identify which SQL readiness consumers govern the selected path and add the typed alternative there, not just in source-owner readers. Require a native/actual-flow test starting with *all* legacy identifier aliases null, producing correct89 outbound Z03 bytes, then consuming the correlated Z04 and observing an actual switch/supply root. A manually prebuilt switch/supply row is insufficient proof of this new graph branch.

### Q2 — HIGH: current atomic Z02 core is not an unchanged reusable producer on the actual schema

Evidence: `customer_sites.normalized_facility_id` is `GENERATED ALWAYS AS (...) STORED` in `schema.sql:9734`. `gridex_apply_exact_z02_core` assigns a non-DEFAULT expression to this generated column at `schema.sql:11358`. The same function writes returned IDs into every plain point alias (`:11415` onward). `gridex_complete_facility_response` likewise requires at least one supplied/retained external identifier and materializes plain aliases. The design acknowledges normalization hazards, but lists atomic core reuse without naming this concrete generated-column incompatibility.

Impact: the current core cannot be invoked unchanged to construct the nullable89 graph; its ordinary update statement is incompatible with the generated-column definition, and successful legacy materialization would still populate unnamespaced aliases. This is a static schema/function incompatibility, not a claimed executed production incident.

Required amendment: specify the new typed89 transactional apply entry/branch and the actual graph writes it performs. It must avoid assigning generated columns and must not call the legacy alias-populating update before/after private binding capture. Preserve and independently revalidate the existing request/job/customer/site/party/payload/snapshot gates. Require a real disposable-schema execution (not mocked `z02_atomic_core_applied`) proving successful nullable graph creation, rollback on capture failure, and idempotent repeated correlation. Track the legacy generated-column defect explicitly if its correction is outside the bounded89 branch; do not rely on that function as already-qualified working evidence.

### Q3 — HIGH: resolving the correct point UUID is insufficient for safe quantity attribution; durable series identity/correction grouping also needs the namespace

Evidence:

- `UtiltsPersistenceMatch` and `UtiltsTransactionPersistenceItem` in `lib/ediel/utilts/transactionPersistence.ts` contain external text and point UUID but no agency, issuer or binding owner.
- `20260923113000_ediel_utilts_ack_plan_reservation.sql:118-140` derives `v_series_identity`/dedupe key from tenant, kind, message code, external text, grid area, period, resolution, product and transaction reference. It does **not** include point UUID, agency or assigning issuer. The previous-series selection uses the same unnamespaced external grouping, and different dedupe keys can mark a previous series non-current.
- The conflict path returns an existing series ID for `(company_id,dedupe_key)`; same tenant identity is checked by the series trigger, not equivalence of the new89 binding or point.
- `structuralComparison.ts` has a real high-resolution-energy `not_applicable` fast path before its LOC agency checks. A successful/irrelevant structural comparison therefore cannot own namespaced persistence attribution.

Impact: after adding two valid namespaced point bindings, messages with the same external spelling/period/grid area can still share dedupe identity or supersede each other's series. Different transaction references avoid identical dedupe hashes but do not avoid unnamespaced predecessor grouping. This is a proven property of current key construction; agency89 activation has not occurred, so this is an activation blocker rather than a claim of observed new89 data corruption.

Required amendment: name the concrete changes to matching/runtime attribution, persistence payload, SQL durable series identity, prior-series/correction selection, and replay validation. The SQL must independently validate the binding against the original UTILTS identity/issuer and point in scope; caller-supplied namespace JSON alone is insufficient. Preserve the frozen non-held response/ERR crash reservation. Define compatibility/versioning for retained legacy series so existing rows cannot silently become89 authority. Native probes must use distinct points with the same ID text, same period/grid area and (a) equal transaction IDs across distinct messages and (b) different transaction IDs; neither may dedupe to nor supersede the other's series. Include agency9 versus89 and two89 issuers, plus the high-resolution energy path.

### S1 — MEDIUM: remove or source-qualify the proposed unknown-identity Z01 bootstrap

The design's capture step3 allows a “genuine facility lookup without known identity” to create an89 binding from a Z02. P47 makes LIN/C212 mandatory except Z13; the field209 table marks Z01 required, and P120 requires Z01/Z03 identities to exist at the recipient. The inspected canonical Z02 payload gate also requires original LIN and LI. The design does not identify an applicable source-backed Z01 variant permitting omission of the namespaced object ID. A general facility-lookup API accepting unknown identity is not that source proof.

Required amendment: either restrict initial89 capture to a genuine originating Z01 whose exact89 tuple was already supplied to the request (local point graph may still be absent), or cite and implement the actual permitted alternative process with its original-wire correlation contract. Do not generate a placeholder identity or infer a requested identity retrospectively from the response. Treat this as an unsupported design branch pending source evidence, not a newly asserted production defect.

## Authority, time and concurrency requirements retained / clarified

The design correctly requires independently projected sealed inbound Z02 and outbound request originals, exact LI/variant/parties, mandatory tenant receiver qualification, process-bound target selection, active environment-qualified issuer and original graph checks in one atomic transaction. Existing permissive denormalized sender comparisons and JSON job flags cannot be reused as authority. `sourceOwnerReads.ts` currently proves only plain ID equality and must receive an explicit new evidence contract; `sourceOwnerWire.ts` currently rejects non9. Existing v1 predicates must not be weakened in place.

The append-only key must use deterministic byte-sensitive text comparison with issuer+agency and tenant/environment. Native conflict tests must serialize both identity→point overlap and point→identity overlap; locking only a key for one direction is insufficient. Revision selection must retain predecessor chains and separate committed availability, matching `sourceOwnerPersistence.ts`'s witness pattern. Bindings must expose both effective correspondence dates and when proof became available. Define the exact consumer cutoff: the current `qualifyReceivedStructure.ts` uses fresh processing-time snapshots on retry; do not silently replace that with a receipt-only snapshot. Historical effective coverage still cannot be invented by a new current alias. The design's “after UTILTS receipt” restriction needs explicit placement in that two-time model.

No independent blocker found against the stated SQL original-binding, source-hash, tenant graph, immutable revision, rollback and no-backfill requirements **as requirements**. They remain implementation/native proof obligations; this review does not qualify any proposed new SQL function or approve arbitrary marker hashes.

## Verification / limits

Read source pages, current table/function/index/trigger definitions, actual Z02 gates/core, source-owner reads/wire/persistence, structural review reads, matching, switch readiness/identity/intent/renderer, UTILTS comparison and transaction persistence SQL. Bounded static verification only; no test/DB execution was needed to show the cited call-path/key/column contradictions. No whole-E035/masterplan acceptance. Amend Q1-Q3 and resolve/restrict S1, then obtain scoped design re-review before implementation activation.

## Revision 2 scoped re-review — 2026-09-23

Reviewed actual revision2 of `agency89-owner-design.md` against current HEAD `2b4293b42732b0231dc00d5e43ceefe260cb4254`. Rechecked the dependent identity/readiness/renderer paths, Z02 core generated-column write, persistence dedupe and predecessor SQL, non-billing `matches:[]` path, fresh structural snapshot path and original field209 source table. This addendum supersedes the first-round REVISE verdict for the design; it does not assert implementation qualification.

**Verdict: design qualified for the proposed sequential implementation. No unresolved blocker from Q1–Q3/S1 remains at design level.** Activation stays prohibited until the documented actual-flow/native/independent gates pass. No production/test/schema edits or executions performed in this re-review.

| First-round finding | Revision2 resolution | Re-review result |
|---|---|---|
| Q1 nullable graph cannot reach real Z03/Z04 root | R2.1 explicitly threads a server-qualified binding through identity/readiness/preflight, orchestration, scoped SQL readiness, intent, adapter and explicit89 renderer context; requires the all-null-alias actual Z01/Z02→Z03→Z04/supply construction test | Resolved in design. Existing string-only readiness remains actual code and must not be bypassed by a synthetic alias or UUID. |
| Q2 legacy atomic Z02 core is not reusable unchanged | Dedicated private `apply_correlated_z02_identity89_v1`; explicitly forbids invoking either legacy apply/completion function, forbids generated-column assignment, retains aliases null, and atomically revalidates original/correlation/graph/binding and job outcome | Resolved in design. Legacy generated-column incompatibility is still separately recorded, not falsely reported repaired. |
| Q3 namespaced match alone does not isolate persisted series | R2.2 covers actual matching, both processors including non-billing, typed payload, independently source-validated SQL attribution, stable versioned series key, lock/dedupe/predecessor selection, conflict replay fingerprint, and explicit legacy_v1 separation | Resolved in design. Both equal and different transaction-reference collision probes are required, as are high-resolution energy and9-versus89 cases. |
| S1 unknown-ID Z01 bootstrap unsupported | Capture step3 and R2.1 require the requested exact89 ID/issuer/agency before outbound Z01; absent local point is allowed, unknown external identity is not | Resolved by narrowing to the source-supported branch. Request input is explicitly not historical point-correspondence evidence. |

### Stable key versus proof revision

R2.2's typed key `[version, company, environment, agency, exactIdentifier, assigningGridOwnerId, assigningEdielId, meteringPointId]` contains no binding-event UUID or assessment UUID. Therefore a new proof event for the same correspondence does not, by design, create a new logical series. Point reassignment, issuer/agency change and environment change do alter correspondence and cannot inherit a predecessor. Using a structured canonical tuple also closes the delimiter-aliasing issue of raw concatenation.

The design separately pins the binding-event provenance and the actual customer/site/point attribution in the successful consumption contract. That separation is essential: a new currently preferred proof must not rewrite a completed transaction's original attribution, and a changed proof UUID must not be used to manufacture a new series identity to evade replay checks. R2.3 explicitly preserves fresh processing-time knowledge for a held retry while retaining immutable prior snapshots and successful consumption. That resolves the first-round two-time ambiguity.

Implementation proof must distinguish these cases, rather than asserting only that two hashes differ:

1. Same correspondence, later binding proof event, new eligible source/correction: same logical qualified key; normal correction/idempotency rules decide series treatment.
2. Already-successful source retry after a later proof event: retain/revalidate the stored successful attribution/proof under its recorded cutoff; do not silently replace it with the freshest binding. Return the existing success only when its immutable consumption contract still matches. An unavailable proof is a hold/error, not a new key.
3. Changed point/issuer/agency/environment: different qualified key; no dedupe or predecessor edge to the former correspondence, and no redirection of the already-successful source.

These are direct proof obligations of the revised design, not new unresolved findings.

### Concrete implementation checkpoints retained

The current `profileRenderer.ts:199` still chooses `portalPartyText(...,'facilityId')` before `context.meterPointId.trim()`. Revision2's exact source-bound renderer requirement must be implemented here too: stale portal data and trimming cannot override/change the verified89 identity. Test a conflicting portal facility ID and a decoded identifier that would change under existing normalization; either render the exact qualified identity or fail internally. Passing only explicit agency89 while retaining an overriding unqualified ID would not satisfy R2.1.

The current SQL still groups series without point/namespace, and the non-billing processor still passes `matches:[]`. Their existence is not a remaining design omission now that R2.2 names both changes and forbids partial activation. Reuse the existing immutable response reservation when extending them; a new proof revision must not reopen a frozen ERR/positive response.

Source hashes must continue to be computed/read from actual sealed originals and binding rows inside the transaction; table/metadata/status JSON or matching submitted marker hashes is insufficient. Serialize both binding overlap directions and use the same qualified key for lock, dedupe, conflict-return and predecessor checks. These requirements are expressly retained in revision2 and need native proof before activation.

No whole-E035/masterplan approval, national completeness, runtime functionality or migration qualification follows from this design verdict. The current closure delivery and its separate final-head review remain outside this re-review.
