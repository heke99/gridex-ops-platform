# Z02L / Z02LK supplier component implementation plan

> Execution: root inline, with the existing independent reviewer. The user's
> continuous execution instruction resolves the skill's execution-mode choice.

Goal: make the frozen supplier response contract inspectable at the physical
profile and actual app-consumer boundaries without creating a second core or
native harness. Exact full facit and source hashes are in source-facit-review.md.
Whole-row/native/ACK/source-original qualification is outside this component.

## 1. Parameterized physical profile controls

Create only `__tests__/ediel-at-z02l-z02lk-supplier-profile.test.ts`.
Reuse `fixtures/prodat-register` raw/line/characteristic and the identity head.
Use L/Z22 and LK/Z23 with real tokenize/parser/policy/field matrix. An intact
control must pass before missing-field contrasts can be credited. Check actual
DDQ, BGM Z02, field223, LI, object/grid/customer/IT identity and no supply intent.

```ts
const profiles = [{ subtype: 'L', reason: 'Z22' }, { subtype: 'LK', reason: 'Z23' }]
const policy = resolveCanonicalEdielPolicy({
  family: 'PRODAT', messageCode: 'Z02', subtypeOrReasonCode: 'Z22',
  direction: 'inbound', referenceDate: '2026-10-05',
  associationAssignedCode: 'E2SE6A', applicationReference: '23-DDQ-PRODAT', mode: 'parse',
})
expect(policy.subtype).toBe('L')
```

## 2. Execute actual candidate and atomic-result consumers

Keep applyInboundProdatZ02ToCustomerInfoRequest real. Use existing
createFakeSupabase for finite table IO and declare worker-result/actor/audit
ports. Avoid .or paths: the helper's .or is a no-op and cannot prove that filter.
Use physical LI-reference fallback with exact company/in filters. Contrast unique,
absent, ambiguous and foreign candidates; assert no request preverification or
customer/site/supply/outbound mutation. The modeled complete job response proves
app interpretation only, never actual atomic core execution. Test each missing
atomic field, blocked/review states and thrown enqueue without weakening gates.

```ts
const link = await applyInboundProdatZ02ToCustomerInfoRequest({ actorUserId, message })
expect(link).toEqual({ applied: true, targetId: requestId })
expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ requestId, edielMessageId: message.id }))
```

## 3. Refute unsafe downstream mutation through the real state consumer

After a held linker result, run the real applyInboundBusinessStateMachine at the
same null-request input seam seen in inboundProcessing. A cached request hint
must not select a verified write. After a complete declared core response, a
preexisting source-owned verified snapshot must survive. These are two-consumer
composition probes, not invocation/proof of the whole outer pipeline or native
authority. If RED, preserve ordinary failing assertions and raw output, hand off
the exact refutation to the retained source/coordinator, and keep coverage frozen.

## 4. Independent review, verification and publication

Run the one focused suite with existing vitest.config.ts and Node22.23.0, then
scoped test TypeScript/lint and diff/source preservation checks. Save every first
failure and final raw/JUnit with exact source/test hashes. Review complete literal
facit and no mock-derived native claims. Publish a bounded draft if source RED
needs its owner; do not merge red checks, skip failing assertions or promote
coverage. Reuse unchanged existing P10/core receipts and the canonical owners.

```sh
PATH=/tmp/ediel-sc010-sc071-npm-cache/_npx/b9d87a63db2d0ec3/node_modules/node/bin:$PATH
node node_modules/vitest/vitest.mjs run __tests__/ediel-at-z02l-z02lk-supplier-profile.test.ts --reporter=verbose
git diff --check
```
