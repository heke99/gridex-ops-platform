# Ediel masterplan v2 implementation plan

Goal: align Gridex OPS with the supplied Ediel specification while preserving PR310 and its unfinished database release gates.

Architecture: keep canonicalEdielPolicy as protocol authority; repair existing enforcement paths. The immutable specification under docs/ediel/masterplan-v2 is evidence, not a new runtime rule authority. Read quality/audits/ediel-masterplan-v2/coverage.json for explicit unverified scope.

Baseline: b9f732d28ceaf090e3b984e71d13a9cbd27f6408, isolated branch codex/ediel-masterplan-v2-alignment-20260915. PR310 remains the dependency for database reconstruction.

## Constraints
- Preserve all PR310 ancestry and historical migration hashes.
- No original message resends or production activation from this audit.
- No source/protocol acceptance from document-integrity checks.
- No guessed contracts, legal actors, wire identifiers or missing normative rules.
- Complete targeted negative and positive controls before publication.

## Current repair batch
- [x] Verify every original package file against its manifest; retain all 121 rules and 231 acceptance contracts in a separate evidence ledger.
- [x] Read live Supabase metadata and existing permission models without modifying data.
- [x] Run baseline application tests on Node22: 212 files, 2080 tests passed.
- [x] Repair Z14N parent applicability in the existing validator and dependent-condition engine; preserve positive Z14 requirements and inbound-ignore/outbound-reject semantics. Verify with ediel-masterplan-protocol-regression and existing PRODAT suites.
- [x] Repair UTILTS_ERR acknowledgement body, envelope and final runtime validation using the correct source-family alias and ERR DOC code.
- [x] Retain selected UTILTS policy through dispatcher, matching and nonbilling/actual processors; align direct runtime date selection using the same shared source. Verify differing DTM137/receipt dates and mismatched retained contexts.
- [x] Classify DSNs before EDIFACT extraction in MIME/parser/processor/diagnostic paths, including attached reports and previously parsed rows. Keep report transport correlation unverified until a real attempt is identified.
- [x] Distinguish SMTP outcomes where acceptance may have happened from definite pre-submission failures. Preserve existing retry/claim protections.
- [x] Independent review, targeted suites, full Vitest, application/test typecheck, immutable source check and whitespace check.
- [x] Publish stacked draft PR311 targeting PR310 branch. No main merge while inherited native replay/schema/types/E2E gates are open. Separate static rule-regression failure also remains open (reproduced unchanged at baseline).

## Remaining phases and concrete evidence gates
| Phase | Existing code/data to extend | Required completion evidence | Current boundary |
| --- | --- | --- | --- |
| F0 | transport journal, message archive, deployment binding | actual release↔DB identity, historical message/queue trace | GitHub head and connected dev ledger observed; runtime and incident unverified |
| F1 | rulebook, field matrices, source registry | G01/G02/G03/G07 original sources and tests; reconcile 327/325/date locators | original supplied package preserved; missing source gates remain |
| F2 | tenant_ediel_profiles, metering_permissions/sites, energy_service_permissions, executionContext | explicit service assignments and scoped grants; SC001–024 plus two-tenant/race tests | existing owner model present; cross-tenant service model not accepted |
| F3 | parser, canonicalPolicyFieldValidator, ACK engine | per-object/register profiles, independent golden/rejection cases | first Z14N and ERR fixes; flat-register path remains |
| F4 | registry adapters, sendOutboxItem, SMTP, inbound mailbox | route/security import parity, actual fetchable MIME, DSN attempt correlation | first DSN isolation repair; no transport-certification claim |
| F5 | prodatLifecycle, permission state machines, deadlinePolicy | all 42 transitions and 31 timers with source anchors and races | not accepted by this batch |
| F6 | UTILTS disposition/persistence, AI/BI, billing | accepted data versions, grant scope, corrections, no cross-domain mutation | policy reuse repaired; complete lifecycle unverified |
| F7 | PR310 replay/schema/types and release readiness | final-head native full replay, independent schema parity, real types, CI/E2E and actor tests | blocked on inherited PR310 gates and remaining Ediel requirements |

Source gaps restrict only affected capabilities. Incoming safe receipt/required acknowledgements must not be disabled by a global production lock.
