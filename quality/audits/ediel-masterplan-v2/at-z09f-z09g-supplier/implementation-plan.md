# AT-Z09F / AT-Z09G supplier acceptance implementation plan

## Global Constraints

- Own only NEW __tests__/ediel-at-z09f-z09g-supplier-profile.test.ts, .agent-memory/masterplan-at-z09f-z09g-supplier-checkpoint.md and quality/audits/ediel-masterplan-v2/at-z09f-z09g-supplier/**. Existing production, suites, helpers, schema, native configuration, fixtures, coverage and shared memory are read-only.
- Preserve Claude P05/P15/TEN/ENV/source and native/integration ownership. No replacement validation engine, renderer, consumer, permission source, transport or native harness.
- Keep prepareAndQueueMeteringMethodChangeZ09, renderAndQueueMeteringMethodChange, buildMeteringMethodChangeDraft and real PRODAT renderer/codec/source route assertions under test. Declare finite native/source, persistence, route, intent storage/version and queue IO explicitly. Do not mock the gateway or renderer under test or claim native effects from fixture responses.
- Z09F: supplier outbound 23-DDQ-PRODAT, BGM Z09, reason E64, field217 Z04, exact validity DTM157; no NAD+UD/customer change. Z09G: same direction/profile, reason E32, field217 Z03, exact DTM157, no NAD+UD/customer change.
- Requested method is distinct from later independently received/versioned Z06. No direct invented business response; CONTRL/APERAK defaults are actual outgoing draft requirements, not delivered ACK evidence.
- Tests must demonstrate new coupled behavior beyond existing flow test that mocks the gateway and existing isolated renderer/source test. One parameterized suite for both IDs, no duplicate fixture or generic helper.
- No installed node_modules/native runtime. Use appropriate available syntax/reference checks; root will obtain exact-head existing authorized CI. Missing local Vitest is a verification limit, not a passing result. No dependency install, external messages or Git mutation/publication by implementer. Root coordinates exact GitData publication and independent review.
- Keep whole profile acceptance and coverage promotion unclaimed until all literal clauses and actual effects, including native/versioned Z06 and physical ACK/source proof, are independently established.

## Task 1: Add coupled Z09F/Z09G supplier component acceptance assertions

Read AGENTS and the existing relevant tests/source once. Implement only NEW __tests__/ediel-at-z09f-z09g-supplier-profile.test.ts with a bounded in-file fixture and declared IO ports; root owns checkpoint/evidence and Git metadata. Worktree source01b11f55 is qualified unchanged against actual main1c151dd for these production/schema/spec/test inputs.

Requirements:
1. Real preparation→real gateway→real renderer success for both profiles. Assert physical UNB application reference, BGM Z09, reason E64/E32, method Z04/Z03, exact fixedUTC+1 DTM157 with non-midnight/summer control, own legal sender, own LI/source operation/intent/request/route binding and actual draft CONTRL/APERAK requirements. Do not merely assert argument metadata.
2. Assert no physical NAD+UD/IT or supplier-switch start/end fields, no requested-customer replacement or supply mutation calls at declared persistence boundary. Preserve a relevant before/after unrelated fixture snapshot so the finite non-effects oracle has discriminating scope; do not claim SQL persistence.
3. Source missing before preparation: no intent/request/finalized draft/queue. Source withdrawn at gateway reread/reservation: preliminary intent/request may exist, but no finalized draft/queue/queued lifecycle. Validate source/route binding with actual canonical route assertion, including non-supplier, wrong legal recipient, foreign company/direction where real gate actually accepts input.
4. Replay from reserved existing source-bound message: no second finalization or queue effect; retain correct own intent/request/event identifiers, fail wrong binding. Use source/tenant IO fixture only, do not implement native authority.
5. Preserve desired method only: synthetic confirmed/current method snapshot remains unchanged by the outgoing request; later Z06 versioning/actual ACK/source effects stay a documented retained-owner requirement. Do not invent an inbound consumer or weaken literal expectations to manufacture PASSED.
6. Assertions should fail meaningfully if real gateway is replaced/bypassed, if F/G tuples switch, if reservation/source hold is ignored, or if replay queues again. No mirror implementation tests or assertion-free cases.
7. Self-review against both complete frozen literals at acceptance_tests.json3112/3144 and relevant canonical/P15 source rules. Report exactly what was executed and what remains unverified.

Existing inputs:
__tests__/ediel-metering-method-change-flow.test.ts
__tests__/ediel-metering-method-change-source.test.ts
lib/ediel/flows/prodatMeteringMethodChange.ts
lib/ediel/intent/meteringMethodChangeGateway.ts
lib/ediel/intent/renderers/meteringMethodChange.ts
lib/ediel/production/meteringMethodChangeSource.ts
lib/ediel/production/brpFieldSource.ts
lib/ediel/intent/intentEngine.ts

Global constraints for this task: only the new parameterized suite; keep real flow/gateway/renderer/route assertions; mocks represent finite IO, no native approval; source/TEN/ENV/native owners remain retained; no old file/Git/dependency edits. If a required assertion cannot be reached without foreign source changes, report the exact limitation to root rather than copying the consumer or weakening it.

The full report goes to the assigned SDD task-1-report.md; return DONE_WITH_CONCERNS if source is complete but runtime CI or whole-profile proofs remain pending. Root handles GitData commit and review package after your reported source is ready.
