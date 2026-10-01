# T03/T08/U09: bind company action rights to the current selection

Date: 2026-10-01. This separately authorized four-file continuation changes only `requireCompanyScopedActionAccess`, adds a unique functional suite, and evolves one existing U09 drift-message expectation. The webhook action exports, U09 page/button, prepared native/browser fixture, other guards, permission policy, SQL and provider behavior are unchanged.

## Actual functional defect and narrow correction

The real guard resolved permissions from the canonical current selected-company receipt, then accepted an active writable owner membership in a different target company. A membership did not itself supply the required target-company grant. With selected A holding `integrations.write`, selected B's controlled canonical receipt holding only `integrations.read`, and active owner memberships in A and B, the actual shared guard accepted target B. All three actual webhook exports consequently dispatched target-B memory effects: test event/enqueue/audit, resend row update/audit, or ignore row update/audit.

The initial unique suite was **5 RED / 24 controls PASS (29 cases)** at runner-local `05:30:08` Europe/Berlin UTC+02, corresponding to `03:30:08Z`. Assertions check the memory effect boundary before the expected denial message. This is functional application-callchain evidence with controlled outer adapters, **not** real Auth, native SQL, forged HTTP, privilege or provider execution, nor a claim about a reachable database exploit.

The helper now rejects `base.companyId !== companyId` with the existing `Error('Forbidden')` immediately after the genuine canonical platform bypass and before the target-company membership read. Current selected-company permissions therefore authorize only that company's ordinary actions. Operating another company requires selecting it and obtaining its current canonical permission receipt. The existing positive permission evaluation, target membership roles/status, lifecycle denial, canonical verification failure and installed Next control flow stay in their existing helpers. True canonical global platform authority retains its cross-company path. No role names or hidden caller fields establish global authority.

The unique suite exercises the real current-context guard, real company-action guard and all three actual webhook action exports. Only Auth/RPC/membership/storage/event/queue/cache/transport boundaries are memory adapters. The storage adapter executes matching `.eq` predicates at its awaited boundary and mutates actual in-memory delivery rows; denial asserts exact A/B row preservation, no audit rows and no event/enqueue/transport/cache dispatch. Positive controls preserve current A, explicitly switched writable B and canonical global platform action behavior including the installed Next redirect. Denial controls cover current B without write, same-company viewer, paused companies, current logout, canonical platform-name with false flag, verification failure and installed redirect/not-found. Canonical SQL grant resolution itself is not exercised here.

## Exact direct caller impact

A current source trace found **22 direct call expressions across 14 application source files**; the guard declaration is excluded. This corrects an earlier informal 17-file estimate. Local helper fan-out and branch-specific uses are explicit below. The table is source impact analysis, not runtime qualification of every caller.

| Exact source and call lines | Resource / caller chain | Effect of the selection binding |
| --- | --- | --- |
| `app/admin/billing/import/actions.ts:57` | `importBillingUnderlayFileAction`, operational scope company; read/export or write/export requirement | Existing explicit ordinary guard/scope equality already precedes this call; legitimate selected-company import is unchanged. |
| `app/admin/company-settings/actions.ts:82` | `assertCanManageCompany` -> settings at 93 and responsible-company access at 252; submitted company; tenants.invite/users.write | Ordinary save must target the current canonical company. True global company management remains available. |
| `app/admin/customers/actions.part-3.ts:650,739,818` | create/link/reject imported row -> stored import-row company; customers.write | Another-company imported row cannot borrow selected-company rights. Initial row reads and subsequent existing business guards are otherwise unchanged. |
| `app/admin/customers/duplicates/actions.ts:250` | merge -> stored primary-customer company; customers.write; source-company checks follow | Selected-company ordinary merge is preserved; membership in a different primary's company no longer transfers the selected receipt. |
| `app/admin/ediel/actions.part-2.ts:839,913` | create TGT draft -> submitted company; save register facts -> scoped stored run company; ediel_testing.write/communication.write | Actual selected target is required; run/draft/evidence and operational checks remain unchanged. |
| `app/admin/ediel/actions.part-5.ts:16` | `caseAccess` -> approve/reject inbound case at 37/56; stored case company; communication.write + masterdata.write | Shared selected permission receipt must bind to the stored case company before existing business effects. |
| `app/admin/ediel/correction-actions.ts:14` | correction capture -> validated submitted company; communication.send | Company selection binds the existing capture preflight. Capture policy/environment/original context is unchanged. |
| `app/admin/ediel/document-reference-actions.ts:12` | document-reference capture -> validated submitted company; communication.send + documents.read + customers.read | Company selection binds the existing capture preflight. Document semantics and original evidence are unchanged. |
| `app/admin/ediel/reporting-permission-action.ts:12` | reporting-permission save -> scoped stored run company; ediel_testing.write/communication.write | Run/current-company binding is strengthened; existing scoped run/revision checks remain. |
| `app/admin/ediel/structure-actions.ts:21,40` | received structure / closure review -> validated submitted company; communication.write/ediel_testing.write | Other-company membership cannot reuse current-company review grants; review/closure semantics remain. |
| `app/admin/ediel/system-tests/actions.part-4.ts:60,167,212` | outbound message reporting branch -> stored message company; create/send run branches -> stored run company; ediel_testing.write/communication.write | Only these existing guarded branches change scope acceptance; no unguarded branch is claimed covered or repaired. |
| `app/admin/webhooks/actions.ts:21,64,110` | actual test event / resend / ignore -> submitted company; integrations.write; row predicates retained | Actual memory callchain proof qualifies selected-A/target-B denial and the same-company/global positive controls. Native/provider/durable receipt behavior remains separate. |
| `app/admin/webhooks/deliveries/page.tsx:22` | read-only `readWriteCapability` preflight per rendered company; integrations.write | Mismatched ordinary target now reaches the existing safe Forbidden read-only note before its redundant post-guard receipt comparison. All three controls remain disabled. |
| `app/admin/website-applications/actions.ts:190` | `authorizeForCompany` -> stored application company; local caller lines 686,839,946,1018,1108,1140; save-review helper fans to update/check exports | Existing genuine platform fast path remains; ordinary application operations require the actual selected company's current rights. Initial application reads and existing business paths are unchanged. |

Some existing action tests mock this shared helper. Those test references do not establish this helper's behavior, all caller effects, complete tenant isolation or native current-identity qualification. No NULL-scope or source-count hypothesis is promoted to an exploit or masterplan acceptance.

## Current receipts and historical U09 supersession

Final current command: **53/53 PASS in two files**, comprising **29 unique current-selection cases + all 24 U09 cases**, at runner-local `05:50:39` Europe/Berlin UTC+02 (`03:50:39Z`). Before the single U09 expectation evolved, the same current tree produced **52 PASS / 1 failed copy assertion**: all three controls were disabled with no effects, but the safe `Läsläge` note replaced the former `bolagskontext har ändrats` note because the new shared guard denied earlier. No production UI copy was changed.

The historical frozen U09 test SHA remains `523d87b4a0749b0587038cd756cbde0c22fdb3b9b09ddd45b3e98a50a46e2fa1` (12,555 bytes; historical manifest blob `84cf76652317cbca38f785699de96a69c9420df3`). Current test differs only by the one drift-message expectation and its two explanatory comment lines; the prior exact bytes were reconstructed by reversing that change and verified against that SHA, retained at `/tmp/gridex-webhook-readonly-controls-prior-selected-company-test-20261001.ts`. The current actual test SHA is recorded below. The frozen old nine-file source/preparation receipt remains dated and is not overwritten or falsely rerun. This new four-file manifest records its exact source evolution.

Prior guard SHA `ac7cb38d188e18672e294ac662c3e4401e4167d9cf9e61846c960a954ffc10ca` is retained at `/tmp/gridex-company-scoped-current-selection-prior-guard-20261001.ts`. Current guard differs only by the six-line equality/comment block. The unchanged actual webhook actions SHA is `79fafb12b741984ae4d3de0e8bca8741bc0b28ada7ab28c25e7a0465dfbac9a9`.

Scoped ESLint: exit 0, no diagnostics. Focused TypeScript: exit 0 with a temporary root-extending config including `next-env.d.ts` and the two actual suites, plugins/incremental disabled. Scoped whitespace check: exit 0. No broad app build, native database, browser, hosted request or provider qualification is claimed. Native/browser execution for this packet: **0**. Existing raw webhook unmatched-row/audit-receipt truthfulness and schema/loader prerequisite are separate open work. All original requirements and whole-OPS semantic/runtime acceptance stay with the explicit master registry; these 53 cases do not certify the whole masterplan.

Commands from repository root using cached Node 22:

```sh
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/company-scoped-current-selection-20261001.test.ts __tests__/webhook-readonly-controls-20261001.test.ts
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/eslint/bin/eslint.js lib/admin/guards.ts __tests__/company-scoped-current-selection-20261001.test.ts __tests__/webhook-readonly-controls-20261001.test.ts
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/typescript/bin/tsc --project /tmp/gridex-company-scoped-current-selection-20261001.tsconfig.json
```

## Frozen source/test manifest

| Path | SHA-256 |
| --- | --- |
| `lib/admin/guards.ts` | `36aeb902dcebfbc272941fec759996367d954b719f28084e33dac10229647051` |
| `__tests__/company-scoped-current-selection-20261001.test.ts` | `d4305ebbcf054dcadbc1fa955b7b3eed9714be8f7d9a78e6eb85dbf155af5eb3` |
| `__tests__/webhook-readonly-controls-20261001.test.ts` | `0b5a465a033977f6392b33e4ab22098eec5af0a4cf5a9d7bbf29dda4814a33e2` |

This report is the fourth path; its hash is sent in the separate exact manifest. Independent review is requested separately; a pending review is not recorded as PASS. No existing frozen native/browser bytes were changed.
