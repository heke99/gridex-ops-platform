# E035 A — independent bounded review

**Verdict: APPROVE the reviewed TypeScript canonical-register facet increment. No confirmed blocking finding. This is not approval of E035, PR370 as a whole, persistence, legal-party/tenant acceptance, business acceptance, or source eligibility.**

Baseline: `92d4980e`. Reviewed the uncommitted five implementation files and two added test files. Parent is implementing the forward SQL independently; it was intentionally excluded, and durable persistence remains incomplete/unverified by this review. No source changes, external tools, live operations or deployment performed. The temporary independent probe was removed from the repository and retained beside this report.

## Routing and scope

Read AGENTS, required active memory/domain material and relevant decisions/failures, owner map and implementation note. Activated code-review, find-bugs, differential-review and verification-before-completion; used direct reproduction/refutation of suspected boundary errors. This delegated task checks the narrow specified requirement, not a repository-wide security/database audit. No UI, performance remediation, dependency, deployment or database change was assigned, so those workflows were not run. Parent owns memory updates. Original national PDFs were not re-read; this review assesses the explicitly bounded requirement against the already-existing canonical rule owner.

Fully read the added `prodatRegisterValidationEvidence.ts`, `receivedRegisterValidationBinding.ts`, modified `receivedSourceValidationEvidence.ts`, and both added test files. Read all diffs in `runtimeDecision.ts` and `canonicalPolicyFieldValidator.ts` plus their affected surrounding execution paths. Read the existing register policy/grouping, diagnostic and tokenizer owners, actual inbound call site and ledger adapter. Reviewed existing source evidence tests and ran the existing outcome regression suite. No source or security logic was removed in the inspected diff.

## Requirement evidence

| Requirement | Result and evidence |
|---|---|
| Actual canonical invocation | Implemented. Callback runs immediately after `validateProdatRegisterPolicy`; receives its actual issues/handled fields and the already-computed register-local matrix issues. Runtime captures this callback directly. It does not infer approval from an empty overall error list or serialized report. |
| No duplicate rule engine | Implemented. Existing grouping, matrix scope and typed diagnostic owners are reused. Projection determines evidence scope/disposition, not a competing register policy. |
| Exact physical scope | Implemented in reviewed path. Tuple includes physical message index, decoded object and exact agency. Registers preserve line index/number, register index/position and segment index. Binder compares the complete occurrence collection to original-token grouping and rejects missing/extra/duplicate or misbound occurrences. |
| Partial or later-message coverage | Implemented. Partial field selection and dependent-only runs are unavailable. Only groups actually selected by the existing first-message owner can be accepted; subsequent UNH occurrences stay unavailable even with reused references. Syntax-rejected runtime bypasses the facet entirely. |
| Rejected/unavailable findings | Implemented. Blocking register diagnostics map only through validated occurrence metadata. Unknown/local/malformed metadata yields unavailable instead of accepting unrelated objects. Missing physical identity is unavailable. |
| Source and tenant binding | Existing wrapper compares original insertion context, company, environment, ID, payload/hash and receipt with the actual validated row; this remains intact. Added binding checks original physical occurrences. Real rule-pack provenance is mandatory for any register facet. |
| Full acceptance stays closed | Implemented. Wrapper still emits `sourceDisposition=not_established`, `objectDisposition=not_checked`, `partyDisposition=not_checked`, `coverage=canonical_runtime_only`. No timeline, supersession or E61/E62 selection owner is introduced. |
| ACK/business behavior | No branch/response-plan/outcome edits in this diff. Existing targeted ACK and business-outcome tests pass. |

## Reproduced boundary results

No defect reproduced. Independent runtime probes established:

- Missing/empty own quantity, wrong/missing identity agency, invalid line sequence and incomplete interchange never produce an accepted object facet.
- Actual accepted custom-UNA output binds back to its original physical tokens; swapping the physical object identity makes binding return null.
- Repeated identical message references and object IDs with an invalid later message do not give later content an accepted facet; syntax rejection is also a permitted fail-closed outcome.
- Existing new tests explicitly prove later-message unavailable projection, per-agency isolation, repeated-register rejection, malformed diagnostic refusal, partial coverage refusal, fresh-owner output versus report JSON, strict field shape and closed full-approval flags.

Considered and rejected as a finding: arbitrary callers can manufacture a correctly shaped projection or exchange content with identical physical topology. The binder explicitly validates serialization/scope, not invocation authenticity or canonical rules; the production call site receives the fresh direct runtime object immediately after validating exactly the original bytes. This is a trusted in-process owner boundary, not an externally callable acceptance endpoint. Do not later expose the DTO as caller-provided approval or hydrate it from report JSON. SQL trust/grants/source checks still require independent review.

Considered and rejected as a finding: canonical register acceptance alongside unrelated canonical errors. This is explicitly the narrow facet contract; full source and object approvals remain closed.

## Verification executed

- `node node_modules/vitest/vitest.mjs run __tests__/ediel-prodat-register-validation-evidence.test.ts __tests__/ediel-received-register-validation-binding.test.ts __tests__/ediel-prodat-register-conditions.test.ts __tests__/ediel-prodat-register-inventory.test.ts __tests__/ediel-prodat-register-ack-boundary.test.ts __tests__/ediel-prodat-register-structure-guards.test.ts` — **150/150 passed**, 6 files.
- Temporary `__tests__/e035-independent-review-probe.test.ts` — **8/8 passed**. Retained at `/workspace/scratch/f679df2698c2/e035-independent-review-probe.test.ts`; copy back to the same test path to reproduce, then remove it. No production source edits needed.
- `node node_modules/vitest/vitest.mjs run __tests__/ediel-received-source-validation-evidence.test.ts` — **27/27 passed**, including wrong tenant/environment/ID/payload/context and mutation refusal.
- `node node_modules/vitest/vitest.mjs run __tests__/ediel-durable-source-business-outcomes.test.ts` — **12/12 passed**.
- `git diff --check` — exit 0 at review time.

Security checklist within scope: no SQL/command/template construction, rendering, new endpoint/auth/session/race or cryptographic algorithm introduced. Original tenant/source authorization preconditions were retained and targeted mismatch tests passed. No new sensitive fields/log output; reason tokens use bounded shapes. Shape parser bounds collections; projection reuses the existing parsing/validation boundary. No measured performance claim. No security exploit or cross-tenant acceptance reproduced.

## Remaining gates

Forward SQL shape/ownership/grants/persistence tests, generated-contract consistency, exact-delivery CI and complete PR review belong to parent. This review does not replace them. Full legal-party/accepted-tenant/business owners remain unimplemented; register acceptance cannot authorize a source or timeline. No claim of national-source recertification, full production outcome equivalence, Node-22 CI, complete suite, lint or typecheck was made by this review.
