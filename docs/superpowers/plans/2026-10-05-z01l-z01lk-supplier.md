# Z01L/Z01LK Supplier Coupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task. Steps use checkbox syntax for tracking. The user already authorizes continued execution and agent collaboration during CI.

**Goal:** Add one behavior suite that couples the existing supplier Z01L/LK producer to source-bound physical messages and outbox effects, while preserving honest whole-contract limits.

**Architecture:** Existing preparation, intent validation/gateway, customer and registry source decoders, process resolver/mapper, rendering/field validation, WeakMap draft binding, canonical finalization, persistence and queue adapters remain real. A finite in-file database/RPC/routing adapter supplies synthetic IO and records permitted lifecycle effects, rejecting unexpected reads/writes. Root owns checkpoint, publication and evidence; one fresh agent owns the test, with independent task and whole-branch review.

**Tech Stack:** TypeScript, Vitest, existing Ediel modules and tokenizer, existing Supabase client interfaces. No dependency, schema, native harness or production changes.

## Global Constraints

- Claim #5305994688282. Base is authentic main fff486f822001d35970f163507b10e17c3692f58/tree82fec813af9a2184259e419a0adbaf4563c2ffe8, branch codex/ediel-at-z01l-z01lk-supplier-20261005, isolated worktree /workspace/gridex-ediel-at-z01l-z01lk-supplier-20261005.
- Own only NEW __tests__/ediel-at-z01l-z01lk-supplier-profile.test.ts, .agent-memory/masterplan-at-z01l-z01lk-supplier-checkpoint.md, quality/audits/ediel-masterplan-v2/at-z01l-z01lk-supplier/**, and this plan. Implementer writes only the new test and its assigned ignored SDD report; root writes other owned records. Existing tests/helpers/production/source/renderer/gateway/native/schema/coverage/shared memory are read-only.
- Preserve Z01 source/namespace/TEN/P/ENV owners and Claude/#503 native/capture/ACK/watch ownership, plus #583/#585/#570/#586/#587 reservations. No second validator, source authority, native fixture, worker, consumer or harness.
- Supplier outbound application 23-DDQ-PRODAT, suffix-free BGM Z01. L is reason Z22 / expected Z02L / supplier_switch_existing_site; LK is Z23 / expected Z02LK / move_in. Physical subtype is CCI++Z13 followed by CAV, with own line LI, legal parties and source object. Field260 is RFF+Z05, field261 RFF+ANJ; annual field213 QTY31 is unused for Z01/Z02.
- Intended start is a calendar DAY. Own selected switch day2027-07-15 takes precedence over signed-contract day2027-07-16, site day2027-07-17 and request timestamp2026-10-05T12:00:00Z. Physical own-line DTM+92:202707150000:203 and header DTM+ZZZ:1:805 use fixed UTC+1, independently implying2027-07-14T23:00:00.000Z. This is neither a received confirmation nor activation authorization.
- Retain actual getCustomerExportContext, customerMasterdataSource native DTO brand, BOTH registry DTO RPC decoders, site resolver/mapper, rulepack/field checks, WeakMap source binding, shared.finalizeOutboundDraft and canonical finalizer. The same returned draft object must reach finalization. Declare routing/current canonical context and table/RPC IO; those responses establish consumer behavior, not native authority or issuer validity.
- Complete frozen literals and71 actual-base pins are in quality/audits/ediel-masterplan-v2/at-z01l-z01lk-supplier/baseline.json. Both Given/When/Expected/Prohibited and full TEN-05/P-01/ENV-06 cards apply. Whole IDs remain NOT_EXECUTED/evidence empty unless every effect is independently proven; root changes no coverage. Actual inbound Z02/ACK/watch/native authority/all R-D/register contrasts and later Z03/Z04 activation remain retained-owner whole-proof gaps.
- No local node_modules/native stack. Existing F/G local Vitest startup exit127 is historical; missing tools are not PASS. Use available Node24 TypeScript syntax checks, do not install dependencies or invoke native/transport. Root publishes exact-head existing authorized CI; future new tests require their own execution. Reuse old receipts only within their qualified scope.
- One writer, no implementer Git/branch/publication/external messages or delegation. If real source/finalization cannot reach a required assertion, report its exact boundary; do not replace it with a canned result, fabricate authority or weaken assertions.

---

### Task 1: Add the coupled ordinary L/LK information-request suite

**Files:**
- Create/Test: __tests__/ediel-at-z01l-z01lk-supplier-profile.test.ts.
- Read: quality/audits/ediel-masterplan-v2/at-z01l-z01lk-supplier/{baseline.json,l-finite-boundary.md,lk-discriminating-oracle.md,ownership-scout.md}.
- Read existing production and prior tests listed in those reports; reuse existing valid original/replay tests rather than copying them.

**Interfaces:**
- Consumes actual prepareAndQueueProdatZ01FromDataRequest and its existing gateway/customer renderer/source decoders/process resolver/mapper; actual tokenizer, shared source-bound finalizer and persistence/outbox adapters.
- Supplies only finite declared Supabase table/RPC and routing/current-context IO, with predicate/order/limit fidelity and strict unexpected-port rejection. Keep actual canonical version resolution and actual selected rulepack normalization. A synthetic ordinary owner-witness response has independent fixed scoped evidence and input assertions; indiscriminately echoing caller evidence is insufficient.
- Produces a captured real stored EDIFACT message and same-ID outbox result, plus a discriminating read/write trace and unchanged own/sibling business-row snapshots. The blueprint enumerates exact reached tables/RPCs; extend finite data only for a genuinely reached existing port, preserving the scoped gate.

Exact acceptance Expected L: "23-DDQ-PRODAT; BGM=Z01; fält223=Z22; CONTRL; Z02 eller negativ APERAK. AB kan begäras men positiv APERAK är ingen startspärr.; Skapa uppgiftsärende och bevakning; ingen leveransaktivering."

Exact acceptance Expected LK: "23-DDQ-PRODAT; BGM=Z01; fält223=Z23; CONTRL; Z02 eller negativ APERAK. AB kan begäras men positiv APERAK är ingen startspärr.; Skapa uppgiftsärende och bevakning; ingen leveransaktivering."

Exact shared Prohibited: "Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas." These finite component cases do not close all prohibitions; document the unmatched whole effects.

- [ ] **Step 1: Define one parameterized producer fixture and fresh success contrasts.**

```ts
const profiles = [
  { variant: 'L', reason: 'Z22', process: 'supplier_switch_existing_site', expected: 'L' },
  { variant: 'LK', reason: 'Z23', process: 'move_in', expected: 'LK' },
] as const
```

Keep distinct company/customer/site/point/contract/switch/request/operation/intent and UNB/UNH/BGM/LI namespaces for each profile and a newer unrelated sibling. Actual selectors must exclude the sibling. L has own switch request_type switch and coherent process facts; LK has own move_in metadata/request_type, not only move_in_date. Include real-shaped signed-contract/readiness/POA/address/grid/legal-party data, qualified UD source data different from mutable fallback, and complete selected IT to execute its applicable fields. Use synthetic .invalid contact addresses and valid-shaped UUIDs, no real customer or secret data. Fresh ordinary original lookup is absent; reuse a own preliminary outbound if the real helper allows it. Tokenize the actual inserted raw bytes and bind every own line assertion to its own LIN group.

```ts
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
// In the actual success assertion, raw is captured from the real message insert.
const segments = tokenizeEdifact(raw).segments.map(segment => segment.raw)
expect(segments).toContain('DTM+92:202707150000:203')
expect(segments).toContain('DTM+ZZZ:1:805')
expect(segments.some(segment => segment.startsWith('QTY+31:'))).toBe(false)
```

Also assert physical23-DDQ-PRODAT, BGMZ01, own UNB/UNH/document/LI and object, matching CCI/CAVZ22 orZ23, qualified legal FR/DO distinct from transport parties, grid/auth/customer/address fields and actual ACK draft defaults. Capture the actual same message ID through finalizer, request/intent link and outbox; queued processVariant/expectedZ02Variant must match physical tuple. A stale L label/LI/annual sentinel in caller/sibling data must not select L or borrow its bytes for a qualified own LK.

- [ ] **Step 2: Add precise reached refusal contrasts for both profiles with permitted diagnostics.**

```ts
// Change only the selected own point source, keeping other scoped sources valid.
point.ediel_reference = '73512345678901234' //17 digits; positive is735123456789012345
// Other independent rows change only one reached source/input each:
nativeCustomerResult = { status: 'held', missing: ['end_user_address'] }
request.request_payload.actorRole = 'energy_service_company'
```

The actual renderer's strict18-digit facility gate must reject the first after real source/process reads. The actual customer-source decoder must propagate held:end_user_address for the second. Actual intent validation must refuse prodat_actor_role_not_allowed for the third. Reset fixture for each row; no conflation. Capture actual error/status plus zero finalized message/reference/message-event/outbox/queue effects. Permit preliminary outbound/request/intent diagnostic lifecycle. For own LK customer with the sibling L site belonging to a different customer, actual preparation reaches its earlier prerequisite guard: evidence.blocker_code request_site_customer_mismatch and site_customer_matches false. The preparation wraps this in its generic facility blocker/public code, so assert the actual nested cause and no physical effects. Do not bypass that guard or duplicate a direct pure-resolver test merely to reach the historical later customer_site_not_found_or_wrong_scope suggestion. Qualified positive LK still exercises the actual resolver/mapper. Any genuine native/setup hold is reported with its own boundary.

- [ ] **Step 3: Assert discriminating finite non-effects and binding integrity.**

```ts
expect(afterBusinessRows).toEqual(beforeBusinessRows)
expect(unexpectedPorts).toEqual([])
```

Those snapshots must include actual fixture customers/sites/current supplier, own/sibling metering annual values, contracts/readiness/POA/switch state and supply-period/activation sentinels. Deny observed business-table writes, Z03/Z04 production and activation dispatch; enumerate every allowed read/write operation instead of using an empty callback spy. Preserve sibling source rows and original namespaces byte-for-byte. Do not claim native triggers cannot mutate state, own incoming Z02 correlation, timer/watch persistence or received ACK from this finite trace. operationId is not a real resolver row selector, collected readiness blockers are not all renderer gates, and intended-day payload text is not authoritative switch source; do not invent refusals for them.

- [ ] **Step 4: Verify the new source using available tools and self-review.**

Run targeted command only if dependencies exist: npm test -- --run __tests__/ediel-at-z01l-z01lk-supplier-profile.test.ts. If unavailable, record NOT_RUN/no executable tests; use Node24 stripTypeScriptTypes plus vm.SourceTextModule with --experimental-vm-modules for syntax. Report exact command/output and no runtime claim. Root runs git diff --check and exact input/scope validation, publishes canonical GitData source, then obtains the new-head CI result. No duplicate all-unit/native rerun by reviewers. Add a short header tagging the two unapproved component candidates and declaring finite boundaries/remaining whole effects, consistent with the coverage script's non-mutating candidate semantics.

- [ ] **Step 5: Report the one task for independent review.**

Write the assigned task-1-report.md with completed source, exact test/tool outcomes, case count, declared IO and remaining whole-proof/source blockers. Return only status, source paths, one-line verification and concerns. Use DONE_WITH_CONCERNS while runtime/full contract remains unverified; use BLOCKED if a required real coupling cannot be implemented within owned test scope. No Git commit: root stages only claimed paths, archives source/report hashes, generates the full diff package, and publishes. Fresh task review and one whole-branch review follow; fixes resume this original author. CI and current-main guards precede ordinary integration. Whole coverage stays unchanged.
