# Final whole-branch review — PR #584

Source-review verdict: **APPROVED — no material fixes requested.**

Merge-readiness verdict: **not established by this review**. Exact-head runtime, test typecheck/lint and required CI remain the controller's gates. This approval covers the bounded component-test/evidence change; it does not approve either whole supplier profile, native authority, received ACK processing or later Z06/P-15 effects.

## Reviewed identity and method

- Read-only worktree: `/workspace/gridex-ediel-at-z09f-z09g-supplier-20261005`.
- Base: `01b11f55af710c3e6aad1f5a433631a88c702047`.
- Head: `2870cdebf6aa7a5cd44e89838f172d11936a8803`.
- Tree: `2e46e08aebc9765b1aed5a797a78dd80449c0ab4`.
- Read the complete 39-line implementation plan and entire immutable 1,236-line review package. Verified programmatically that its diff body equals `git diff BASE HEAD` exactly.
- Git name-status confirms exactly eight added files: one 500-line suite, one task-owned checkpoint and six task-owned audit files. No existing production, test, helper, schema, native/configuration, coverage or shared-memory file changes.
- Independent whole-branch review; did not use the prior task-review verdict as evidence of correctness and did not rerun its checklist.
- Applied the explicitly assigned subagent-driven-development final review and requesting-code-review reviewer template, plus verification-before-completion. Read AGENTS, project-memory entry/current context and relevant decision/failure references. Using-superpowers explicitly excludes dispatched subagents. This bounded test/evidence review does not activate a repository-wide audit, implementation/TDD, UI, performance, deployment, database optimization or scanner workflow. No additional agents or native harness were created.

## Strengths and architectural assessment

1. **The newly tested coupling is real.** `__tests__/ediel-at-z09f-z09g-supplier-profile.test.ts:14` declares the finite IO ports and `:32` imports the actual preparation and gateway. There is no gateway/renderer/source-adapter/intent-engine mock. The success test at `:266` therefore exercises preparation → source qualification → intent creation → gateway source reread/reservation → renderer/codec → captured finalization → actual intent lifecycle calls. This materially improves on the old flow suite's mocked gateway without introducing a second production implementation.

2. **The query double fits the existing consumers.** The adapter at test `:126` implements the actual select/eq/limit/returns/maybeSingle, upsert/select/single and await-update chains used by `lib/ediel/flows/prodatMeteringMethodChange.ts:29`, `lib/ediel/intent/meteringMethodChangeGateway.ts:15` and `lib/ediel/intent/intentEngine.ts:320`. Its explicit recursive type avoids implicit recursive inference; its thenable resolves the update/list query result correctly. Unknown tables, mutations, RPCs and tenant calls fail and are recorded. It intentionally does not model SQL uniqueness, concurrency, RLS or native source authority. Those limits are stated rather than hidden.

3. **The wire oracle is discriminating.** Test `:266` checks the actual encoded payload: literal F E64/Z04 and G E32/Z03, 23-DDQ-PRODAT, BGM Z09, distinct communication versus legal sender, own LIN/LI, and both fixed-UTC+1 winter and civil-summer minute expectations. The UNB indices agree with `lib/ediel/core/edifactEnvelopeCodec.ts:65`; the 14-character uppercase interchange expectation agrees with `lib/ediel/core/referenceRegistry.ts:92`. Literal values are not computed using the same formatter/tuple helper under test. Physical and draft ACK requirements remain separate from any claim that ACKs arrived.

4. **Negative and lifecycle assertions reach the intended real gates.** Test `:348` distinguishes absent source from later withdrawal, permits only the expected preliminary rows and forbids finalization/queued lifecycle. Test `:361` reruns full preparation and checks unchanged effects, rows and correct reserved identifiers. Test `:380` changes each saved-message intent/request/event binding independently. Tests `:392`, `:422`, `:429` and `:440` reach actual route, source, saved-intent and renderer gates. Tests `:456`, `:466` and `:473` exercise missing object, missing instant and non-supplier validation without replacing those consumers.

5. **The effect ordering agrees with production.** Success assertions at test `:330` require two scope reads, two agreed-source reads, two reservations and the exact upsert → request → finalize → rendered lifecycle → queue → queued lifecycle sequence. These match the inspected flow/gateway/source implementation. Replay adds reads but no new writes/finalization/queue. Replacing or bypassing the gateway would lose observable reservations/lifecycle effects even if a fake outgoing payload looked correct.

6. **Scope is coherent with the complete literals.** Both frozen acceptance objects at `docs/ediel/masterplan-v2/registers/acceptance_tests.json:3112` and `:3144` were read, including given/when/expected/prohibited. Their baseline copies match the original JSON objects exactly. The suite covers the intended outgoing component boundary and leaves agreement authority, delivered CONTRL/APERAK, independently versioned Z06, and P-15's effective/receipt times and dated meter/register/product/no-double-counting effects open. G Z03 is a requested DSO decision and is not represented as its later confirmed method. DTM157 remains a qualifier for field216, not a renamed national field.

## Issues

### Critical

None confirmed.

### Important

None confirmed in this branch's source or evidence changes.

### Minor

No material-to-readiness minor fix requested. The prepublication checkpoint and verification pending list retain their historical stage; current controller/CI results must be recorded with their own exact identity rather than treating those immutable records as current execution claims.

## Evidence boundaries and checked candidates

- **Unrelated snapshot is not durable history proof.** Test `:92` supplies distinctive current/customer/history/foreign data and `:342` preserves it, but that snapshot is not fed to a real SQL owner. The useful mutation protection is the surrounding fail-closed IO oracle plus physical forbidden-party/date checks at `:289`. The suite and `implementer-report.md:25` expressly limit this to finite non-effects. No independent durable history or source-authenticity credit is granted.
- **Direction test is refusal propagation.** Test `:487` injects a native reservation error. It does not prove a new JavaScript direction guard or execute SQL. Inspection of `supabase/schema.sql:45849` confirms the retained fresh-reservation direction condition. The documented sealed-binding/native-owner argument is consistent with this separation; no new production correction is justified by this test. Native enforcement remains unexecuted here.
- **Renderer success does not exercise real finalizer/transport.** The finalizer and queue ports at test `:227` and `:241` capture actual drafts and effects but supply synthetic persistence/queued status. Their existence is explicit at test `:9` and in `implementer-report.md:19`. No SQL owner witness, SMTP/provider delivery, queue durability or actual ACK handling is inferred.
- **Surrounding source compatibility.** The inspected production signatures and runtime chains match the fixture. The recorded 1fca inbound-direction changes in `baseline.json:11` do not alter the outbound `validateProdatRegisterPolicy` call used here; they are preserved as separately qualified source changes. The controller's later OPS05/SC071 descriptions are not a fresh current-main execution receipt, and this report does not promote them into one. Any target-main merge/CI qualification remains with the controller.
- **No obvious static TypeScript/API incompatibility found.** The route type cast is an explicit partial IO fixture; mocks are hoisted; value imports execute the real modules; `toHaveBeenCalledExactlyOnceWith` is consistent with the declared Vitest 4.1.9 dependency. The explicit fixture query type and indexable rows avoid obvious inference/indexing failures. This is source inspection, not a substitute for TypeScript or ESLint execution.
- **Historical CI remains historical.** `historical-ci-excerpts.json:3` pins 01b11f55. Its source/flow/native counts do not execute the new suite. `profile-clause-review.md:17` explicitly rejects whole-profile inference and duplicate log counting. Original GitHub logs and cross-PR publication receipts were not refetched in this read-only source review; their provenance claims remain controller-owned. No inconsistency in the added records was found.

## Verification performed for this review

Fresh read-only checks:

- `git rev-parse HEAD` and `HEAD^{tree}` returned the exact requested head/tree above.
- Immutable package diff versus actual base..head diff: byte-for-byte equality.
- Name-status inspection: eight additions only; `git status --porcelain` clean.
- Python SHA-256 and Git-blob verification for all **48 baseline inputs**: zero mismatches.
- Python SHA-256 verification of the **five artifact hashes** in verification.json: zero mismatches.
- Baseline copies of both complete literal acceptance objects versus original register JSON: exact equality.
- Suite length: 500 lines. Manual parameter expansion: 18 F/G cases plus 19 common cases = **37 declared cases**.
- Confirmed `node_modules` is absent. No dependency installation, harness, runtime test, TypeScript, ESLint, native test, external post or Git mutation was performed.

The author's prior Node strip/module syntax result is syntax-only. The reported Vitest exit127 is a failed start with zero cases executed, not a failing behavior assertion or a passing suite. I did not repeat that unavailable-runtime attempt. The unresolved concrete risk is first execution of the 37 cases and test compilation/lint, especially the query thenable/hoisted mocks and strict physical segment assertions; the existing exact-head CI must execute `npm test -- __tests__/ediel-at-z09f-z09g-supplier-profile.test.ts` (or include it in the full configured unit run), `npm run typecheck:tests` and `npm run lint`. The inspected existing OPS workflow includes lint, test typecheck and the full unit run, and Vitest includes this path.

## Final assessment

**Source-review ready: yes.** No code/evidence correction is required by this independent review. The branch is a bounded addition of meaningful coupled component assertions with honest unverified/native/later-process limits.

**Ready to merge now: not established.** Require the controller's applicable exact-2870cdeb checks and ordinary publication/merge gates. Do not mark AT-Z09F-SUPPLIER or AT-Z09G-SUPPLIER whole-profile PASSED or change coverage based on this source-review approval or finite component fixtures.
