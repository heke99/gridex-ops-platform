# F3 Task A review correction — E011 / ENV-04

2026-09-20. Controlling amendment to f3-unb0031-source-20260920.md/.json at df1df8d02626b61072c04a2c5c254705de7a169d. No runtime change or acceptance promotion.

## Review disposition

Review 5752031519: SOURCE PASS; DESIGN/ORACLE BLOCKED. The source evidence remains accepted: official T24.A revision6, 1,124,807 bytes, 60 pages, SHA256 5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951, retrieved independently in 5751649097. Original-source retrieval is not represented as a new download in this continuation.

The claimed missing owner path is a false positive. A fresh GitHub fetch of df1df8d:lib/ediel/ack/canonicalAckEngine.ts succeeds with blob e81cb8060a0e25eff3a845cdfa89daa19215230b. The facade imports this owner at lib/ediel/rulebook/canonicalEdielFacade.ts. The reviewer scripts initially requested nonexistent core/canonicalAckEngine.ts and core/canonicalEdielFacade.ts. Keep the real owner and its facade; do not invent or relocate either.

The ACK-draft expectation and environment findings are valid. lib/ediel/ack.ts uses defaultAckStatuses(), writes requiresContrl:false and requiresAperak:false for every family, and omits testFlag in its buildEdifactEnvelope call. The earlier statement that all monitoring paths already use the canonical projection is superseded for this owner.

## Corrected bounded design

1. Reuse canonicalAckEngine through canonicalEdielFacade/deriveEdielAckDefaults. Resolve the outgoing family/code once before building its envelope. No new normative family table, rendered-string inference, caller JSON authority or route/DB flags.
2. Carry an explicit required boolean acknowledgementRequest through buildEdifactEnvelope, serializeEdifact and EdifactEnvelopeCodec.encode. The low-level codec must reject absent/non-boolean input instead of silently assuming false. It serializes literal 1 at UNB element9 for true and omits it for false. It remains a serializer, not a second market-policy resolver. Non-send preview/verification and deprecated compatibility calls must pass an explicit decision; their presence never grants send eligibility.
3. Real PRODAT/UTILTS wrappers pass the same canonical requiresContrl projection used in their returned draft. The separate generic buildProdatMessage path resolves the existing PRODAT requirements and supplies serializeEdifact. requestAck/BGM-AB/NA remains the distinct application acknowledgement selection, not the technical request.
4. In buildAckDraft, replace defaultAckStatuses() with deriveEdielAckDefaults for the OUTGOING ackFamily (not the received source family). Pass acknowledgementRequest from that same object; store requiresContrl/requiresAperak/contrlStatus/aperakStatus/utiltsErrStatus from it and computeOutboundAckDueAt from those exact values. This restores existing canonical APERAK -> CONTRL and UTILTS_ERR -> CONTRL plus APERAK obligations. CONTRL remains no requirements, not_required statuses and null due time. Do not change the underlying application-response matrix.
5. Pass the existing source test_flag into the ACK envelope. Preserve the source row's testFlag/environment rather than constructing a new environment from message outcome. Test input uses numeric1; production uses0 with wire0035 omitted. Consistent source rows are the qualified input. Any new interpretation for inconsistent source rows is outside this task.
6. Keep UNB parties/application reference/timestamps, business segments, escaping and UNT/UNZ counts intact. No mutation of stored source payloads or queued payloads. Incoming missing0031 behavior, positive/negative response rules, guide/certificate/role eligibility and every tenant boundary remain unchanged.

## Complete call inventory at accepted runtime tree b1f7c9ff910488c57242e171f501b033e3e103b5

- Shared wrapper: lib/ediel/messages.ts -> core/edifactEnvelopeCodec.ts.
- Generic serializer: core/edifactSerializer.ts; real caller prodat/buildProdat.ts.
- Shared send/draft callers: prodat/compatAdapter.ts; utilts.ts; ack.ts; intent/renderers/facilityLookupZ01.ts; intent/renderers/customerMasterdataZ01.ts; flows/prodatCustomerMasterdata.ts; lib/customer-cases/engine.ts; testing/agtEngine.ts.
- Non-send direct codec callers: productionReadiness.part-3.ts; verification/rulePackVerification.ts. core/unb.ts is a deprecated compatibility-only delegate with a DUMMY message; it must carry an explicit input, not derive a fictitious market family.
- testing/tgtAutopilot.ts has a DIFFERENT local serializeEdifact(segments) that rejoins an existing source; do not treat it as the generic serializer or rewrite stored source receipts.
- Operational ACK states read requires_contrl/requires_aperak/contrl_status/aperak_status/ack_due_at. core/ackPolicy.ts:getCanonicalAckState must see the corrected returned draft. sla/createAckTimers.ts is INBOUND-only, so do not add new outbound DB writes there.

This inventory was checked against a locally restored exact-main source artifact, not an invented checkout: run35526699928 artifact10610306373. ZIP SHA2564599be6c9548aa53f44fef1d60072d34c9107f8909cd8913e012bf50d2e646f1; inner TAR SHA256a645a7b4cb8cd48849b3e3c08b856ffeb945d1032d49e5b64ac0b9e5de1ea1f1; both independently recomputed. git write-tree exactly b1f7c9ff910488c57242e171f501b033e3e103b5. GitHub compare5e3cb079...df1df8d confirms intervening changes are documentation only. No Git history was invented and no PR310 source was imported. Local Node22.16.0, not CI22.23.2; existing actual-module document tests pass145/145.

## Corrected RED and opposing controls

Use actual buildProdatMessage plus a real PRODAT returned-draft route, buildAperakDraft (P and U sources, both outcomes), buildUtiltsErrDraft, buildContrlDraft and the codec. Source-valid literal synthetic inputs; no live providers, DB or transport. Inspect actual final raw UNB positions independently of application decoding, not just roundtrip assertions.

- Eligible PRODAT, P/U APERAK and UTILTS_ERR: literal0031=1, returned requiresContrl=true, contrlStatus=pending, a valid due time; getCanonicalAckState reports awaiting_contrl before its due time.
- APERAK application acknowledgement remains none. UTILTS_ERR retains canonical APERAK requirement. Z01 retains no positive APERAK expectation while requesting CONTRL.
- CONTRL: absent0031, requiresContrl/requiresAperak false, not_required statuses, due time null and no_ack_required state.
- Test and production source rows: APERAK/CONTRL/ERR returned testFlag matches source; wire0035 is1 only in test, separate from0031. A negative outcome must not change environment.
- BGM/AB and NA cannot suppress technical0031. Generic PRODAT alternate serializer is included.
- Missing/non-boolean codec input throws; unknown family fails through canonical policy. Persisted/caller payload flags do not override the builder's canonical projection.
- Existing supported escaping and counts/references remain. Three incoming service alphabets exercise ACK consumers with canonical outgoing alphabet; do not claim the codec supports arbitrary outgoing UNA beyond its actual existing contract. No unrelated codec redesign.

The focused durable test may use a Node built-in actual-module harness alongside __tests__/ediel-unb-ack-request.test.ts, invoking that harness from the ordinary Vitest suite. This reuses the established dependency-free VM/stripTypeScriptTypes approach in scripts/test-ediel-prodat-document-fields.cjs; only provider/DB mutation boundaries are stubbed and must throw when called. No production owner is mocked. This avoids treating unavailable local npm dependencies as a behavioral result. Preserve command, source tree, failure assertions and output hash; setup/import failures are not RED. Existing assertions are not waived. New required-input fixtures may supply explicit source-qualified decisions; any old expectation change requires separate source-backed adjudication.

## Execution gate

Request independent re-review of the precise correction. SOURCE remains PASS; DESIGN/ORACLE await a new verdict. No new tests or runtime changes are published by this amendment. Following approval, run durable behavioral RED, then minimal fix, focused GREEN, ordinary exact-head CI, independent runtime reviews, guarded merge and actual-main verification. D110/110 and parents10/10 stay accepted; fullF3/masterplan remain NOT_COMPLETE; PR310 stays paused at e9611351.

Skill routing: executing-plans for the existing ordered work; receiving-code-review/fp-check for the path false positive and valid draft findings; systematic-debugging/variant-analysis for shared and alternate serializers; TDD/spec-to-code-compliance/property-based-testing for literal and generated invariant controls; requesting-code-review/verification-before-completion for the gates. UI, database/schema mutation, performance optimization and supply-chain changes are not triggered by this finite protocol task. Runtime tenant review and branch completion remain later gates.
