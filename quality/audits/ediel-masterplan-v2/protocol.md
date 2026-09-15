# PRODAT and ACK evidence — 2026-09-15

Scope: current PR310-derived checkout, not the old main commit referenced by the uploaded masterplan. Read AGENTS.md, active memory/checkpoint, integrations domain memory, decisions/known-failures, implementation and relevant tests. No production traffic, commits, or shared memory edits. Source edits were explicitly assigned after the evidence phase by the coordinating agent.

Skill routing: spec-to-code-compliance for this bounded delegated requirements check; direct fp-check-equivalent execution to challenge claims; systematic-debugging and test-driven-development for the two approved repairs; verification-before-completion for fresh results. using-superpowers explicitly excludes delegated subagents. Repository-wide quality orchestration remains with the coordinator. UI, performance, database/RLS, supply chain and deployment work are outside this protocol-only slice; no corresponding completion claims.

## P1 — CONFIRMED, bounded repair verified: Z14N parent groups

Severity: high (correct negative business responses can be rejected as malformed).

Masterplan §2.2/§7.3 says Z14N omits positive-response parent groups and their mandatory children; inbound extras are ignored, outbound extras must not be built. Before repair, `validateRulebookMessage` → `canonicalValidation` (`lib/ediel/rulebook/validator.ts:335-339,301`) passed the full flat matrix to `validateCanonicalPolicyFields`, which ran base mandatory checks before D conditions. `prodat26AFieldMatrix.ts:84-87` contains mandatory country / installation children independently of the Z14 parent conditions. Executing validation with every D condition explicitly `not_required` still emitted blocking missing fields 316, 233 and 234; therefore missing dependency facts were not the root cause. With normal facts the parent D cells additionally returned undetermined.

Repair: `prodatParentApplicability.ts:1-16` names the bounded Z14N UD/IT parent scope. `canonicalPolicyFieldValidator.ts:26-32` excludes this scope from incoming field checks and marks it forbidden outbound. `prodatDependentConditionEngine.ts:220-227` resolves those inapplicable parent D cells before asking for business facts. Positive Z14 remains subject to its existing mandatory children.

Reproduction/regression: first four cases in `__tests__/ediel-masterplan-protocol-regression.test.ts`. Omitted Z14N parents, unknown parent facts, positive-Z14 missing children, and inbound-ignore/outbound-reject behavior have independent expectations. This repair does not prove that every downstream business projection discards extra inbound fields, nor that all other Z14N D cells and non-parent locators are correct.

## P2 — CONFIRMED, repair verified: UTILTS_ERR selected P-APERAK

Severity: high (wrong ACK wire family for an accepted error message).

Masterplan §7.6 identifies UTILTS ERR as UTILTS on wire, with the U-family acknowledgement profile. `buildAckDraftForSource` → `buildAperakDraft` → `buildAckDraft` → `buildAperakSegments` → `renderAperakEdiel` previously used exact equality to `UTILTS` in two separate selectors. Before repair, a stored `message_family=UTILTS_ERR`, BGM ERR source generated `APERAK:D:96A:UN:E2SE6A`, `BGM+++34`, and PRODAT NAD FR/DO. The canonical ACK matrix already permits APERAK on UTILTS_ERR; this was not an unreachable case.

Repair: `aperakEngine.ts:5-8,171` provides one family predicate for UTILTS and the storage alias; `ack.ts:983-985,1020-1022` uses it for both UNH and stored version, while the renderer uses it for the body. Regression tests call the actual draft builder and assert D04A/E5SE5A, BGM312 and DOC ERR/original reference. PRODAT D96A/BGM34 and the prohibition on ERR reply loops remain verified.

## P3 — CONFIRMED discrepancy, OPEN source reconciliation: field locators

Masterplan §7.2 explicitly locates field327 at DTM164 and field325 at RFF Z09. Current immutable matrix still has DTM273 (`prodat26AFieldMatrix.ts:47`) and RFF ZPI (`:78`). The actual parser already reads Z09 (`prodat/parser.ts:172-175`), so matrix and parser disagree within this branch as well. Parser report dates read 90/91 (`:179-182`) while the matrix uses 163/164. Path: canonical policy returns these matrix rules → field validator checks presence using the stale segment path; supplied correct wire fields can be treated as missing.

Targeted next tests: independent Z18 sample with DTM164 and RFF Z09 must satisfy 327/325; reject missing values; compare parser dates against reconciled source locator records. No locator edits made: uploaded appendix/source-table reconciliation is needed before broad mechanical replacements. Merely counting 77 matrix rows or 120 D entries is not source semantic verification (masterplan counts 110 numerical D cells plus parent context).

## P4 — CONFIRMED structural gap, OPEN complete register validation

Masterplan §7.3/§7.4 forbids evaluating a flat segment list and requires global LIN sequence314, object-local register sequence258 and register2+ overlays. `validator.ts:301` sends one whole-message `parsed.rawSegments` array to the field validator. `fieldMatrix.ts:389-392` selects the first LIN/NAD UD/IT/IV. No register index or parent instance enters `validateCanonicalPolicyFields` or `ProdatDependentConditionFacts`; only a boolean `multipleMeterRegisters` exists. Thus this canonical field path cannot distinguish absent data in a second object from data supplied in the first, or apply the per-register inheritance profile. This statement is limited to the canonical field path, not a claim that no parser groups lines anywhere: `prodat/parser.ts:147-193` does preserve line items and raw line segments.

Targeted next test: a source-backed two-object Z04 with an obligatory second-object field missing must fail specifically on that second object; a two-register object with correctly omitted inherited fields must pass. Run independent golden variants for global LIN gaps and per-object register restart. Do not infer legal register2 requirements from the old flat matrix.

## Verification

- Before edits: `npx vitest run __tests__/ediel-masterplan-protocol-regression.test.ts` — 4 failed, 2 passed. Failures directly showed parent missing/undetermined checks and D96A instead of D04A.
- After edits: `npx vitest run __tests__/ediel-masterplan-protocol-regression.test.ts __tests__/prodat-dependent-condition-engine.test.ts __tests__/ediel-canonical-ack.test.ts __tests__/utilts-aperak-contrl-central-engine.test.ts __tests__/prodat-26a-semantic-hardening.test.ts` — 5 files, 44 tests passed.
- `git diff --check` — passed.
- No production E2E, protocol certification, DB replay or full masterplan acceptance claimed. Test changes assert wire outcomes and omitted-parent behavior; they do not replace source golden files or full object disposition tests.

## Independent review follow-up

Reviewer found two real missed consumers: `rulebook/validator.ts` accepted E5SE5A only for source family UTILTS, and canonical classification stores BGM ERR as message-code UTILTS_ERR, which leaked into the new DOC segment. Both were reproduced before further changes. Permanent tests now run classification → actual draft construction → outbound runtime validator for positive and negative responses, with the canonical source-family metadata used by the kernel. The runtime version gate now shares `usesUtiltsAperakProfile`; DOC maps the storage code alias back to wire ERR. No validation or reference checks were bypassed.

The reviewer also identified that validation-only suppression did not stop the profile builder from constructing UD/IT. `prodat/builders/profileRenderer.ts:262-279` now consults the same parent applicability helper before constructing either group. A test populates customer/site data and confirms that Z14N construction omits both NAD groups, while Z14V retains both. This is a real profile-builder test with canonical subtype resolution, not a hand-built policy. The broader Z14N business-projection and other D/locator limitations above remain open.

Fresh follow-up verification:

- Dedicated permanent suite after adding follow-up tests, before repairs: 3 failed, 6 passed (two runtime version failures and one parent construction failure). Reviewer's independent probe separately demonstrated DOC alias leakage.
- `npx vitest run __tests__/ediel-masterplan-protocol-regression.test.ts __tests__/prodat-dependent-condition-engine.test.ts __tests__/ediel-canonical-ack.test.ts __tests__/utilts-aperak-contrl-central-engine.test.ts __tests__/prodat-26a-semantic-hardening.test.ts __tests__/ediel-prodat-runtime-version-alias-regression.test.ts` — 6 files, 50 tests passed.
- `npx tsc --noEmit -p tsconfig.ediel-consolidation.json` — passed.
- `git diff --check` — passed. Dedicated partial test fixtures now use explicit `unknown` casts, correcting the reported TS2352 errors.
