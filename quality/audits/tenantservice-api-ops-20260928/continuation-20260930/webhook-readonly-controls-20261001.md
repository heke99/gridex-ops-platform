# U09: current webhook mutation controls

Date: 2026-10-01. This bounded packet changes the existing `/admin/webhooks/deliveries` page, adds one shared client submit button, and executes the actual exported page and its three existing server actions. The action module is read-only in this packet. This is not whole-U09 or whole-OPS acceptance.

## Actual failure and correction

The original exported page, installed React server renderer, installed Next navigation and real admin guards reproduced **4 RED / 12 controls PASS** at approximately 02:33 UTC (Vitest runner printed 04:33 in Europe/Berlin, UTC+02). All three mutation buttons were enabled for each of: a current actor with only `integrations.read`; a paused ordinary company with a write grant; a readable viewer membership with a write grant; and a company role named `platform_admin` whose canonical global flag was false. These were rendered output assertions, not source-text assertions. The existing actions already denied current insufficient authority before effects.

The page now calls the same `requireCompanyScopedActionAccess(companyId, { anyOf: ['integrations.write'] })` used by all three actions. That preflight reads current Auth, the canonical tenant context and membership/lifecycle state; its traced implementation does not perform mutation, audit, enqueue or provider dispatch. The page preflights once for each distinct company present in the rendered deliveries and first twelve rendered subscriptions. The returned actor, selected company and canonical global flag must match the page guard receipt; ordinary write authority must also match the resource company. Membership-role policy remains in the existing guard.

Only the existing explicit permission/lifecycle denial outcomes become a safe read-only note. The existing explicit canonical verification failure becomes a distinct unconfirmed-authority note. Installed Next control-flow errors are rethrown first. Unexpected database/membership errors propagate rather than becoming a successful writable state or an ordinary read-only result. No raw error is rendered by the new capability state.

All mutation buttons use the real `useFormStatus()` from their own existing action form. A button is disabled when current write capability is absent or that form is pending, with its existing action label and a pending label. Each raw action still independently authorizes the current request. Existing form bindings/hidden resource IDs, selected-company read filters, status links, provider transport, retries, idempotency, audits and action redirects are preserved.

## Executed evidence and limits

Final local unique suite: **24/24 PASS**. It executes actual page/guard/action exports, the installed React server renderer and installed Next redirect/not-found signals. Controlled outer boundaries are current Auth/SQL context, membership rows, page loaders and storage/event/queue/provider adapters. It does not replace the guards with permissive mocks.

| Executed family | Exact bounded outcome |
| --- | --- |
| Four original failing actor/company states | Three mutation controls disabled; no storage, event, queue, audit, provider or cache effect |
| Actual writable owner and authoritative global-admin controls | Three controls remain available; permission preflight has no effects |
| Distinct rendered-company reuse | One write preflight for the single distinct company; actual uncached direct-call harness observes page guard plus preflight |
| Changed selected company, Auth actor or canonical global flag | Controls disabled; stale page authority is not reused |
| Canonical SQL verification unavailable | Safe explicit unconfirmed-authority note; no raw diagnostic or false ordinary read-only explanation |
| Unexpected membership/database failure | Original failure propagates before effects |
| Installed Next redirect and not-found | Genuine framework signals propagate unchanged |
| Three existing raw actions × current grant loss, paused company, absent current session | All nine current denials happen before storage/event/provider/audit/cache effects |
| Existing authorized test-event action | Actual enqueue/audit/cache/redirect behavior retained behind controlled event/storage adapters; no external call |

This direct SSR invocation does not mount React in a browser. `useFormStatus` is real but its pending DOM transition, duplicate-click prevention and actual Next action transport have **0 executed browser cases here**. Genuine GoTrue/Next fixtures and independent native postchecks are a separate prepared packet. Database persistence, actual lifecycle RPCs, real provider delivery, whole U09 and the unique whole-OPS semantic action denominator remain unqualified by this receipt. No reachable NULL-scope cross-tenant exploit is claimed.

The existing raw action update/audit behavior is unchanged. This packet does not establish a durable matched-row receipt for resend/ignore, truthful outcome under a missing row or audit failure, or every possible cross-target action request. Those require their own authorized effect-path proof. Test event/resend will not be invoked by the prepared browser packet; only the isolated ignore path is suitable without external dispatch.

## Gates and reproducibility

```sh
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/webhook-readonly-controls-20261001.test.ts
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/eslint/bin/eslint.js app/admin/webhooks/deliveries/page.tsx app/admin/webhooks/deliveries/WebhookActionButton.tsx __tests__/webhook-readonly-controls-20261001.test.ts
```

Scoped ESLint exit 0. Focused TypeScript exit 0 with a temporary config extending `tsconfig.tests.json`, `incremental:false`, and only these three source/test entrypoints plus actual transitive imports. An initial regex dotAll flag exceeded the repository's TypeScript target; the owned output-parser regex was corrected to an equivalent character class and the actual focused gate passed. This is not a whole-app/build or published-head CI result.

| Owned source/test path | SHA-256 |
| --- | --- |
| `app/admin/webhooks/deliveries/page.tsx` | `38a36063b3e62ad5f428ab033f4390d3b8a40d895c717ed0e194109f59fb823b` |
| `app/admin/webhooks/deliveries/WebhookActionButton.tsx` | `f390da181faf5de5ddedabdf2c6f5d201998afa3455e990d79ac2f415c13ab43` |
| `__tests__/webhook-readonly-controls-20261001.test.ts` | `523d87b4a0749b0587038cd756cbde0c22fdb3b9b09ddd45b3e98a50a46e2fa1` |

Read-only `app/admin/webhooks/actions.ts` remains SHA-256 `79fafb12b741984ae4d3de0e8bca8741bc0b28ada7ab28c25e7a0465dfbac9a9`, with no owned diff. The four-file manifest including this report is supplied separately to root after independent review. Frozen prior page inventories and their hashes are not regenerated or promoted to this later source tree.

Independent `ci_evidence` read-only source review and actual Node22 rerun at 02:52:32 UTC (runner printed 04:52:32, UTC+02): **24/24 PASS**, source hashes match, no concrete blocker found in the bounded actor/company/global binding, actual guard reuse, failure/control-flow behavior or rendered resource bindings. The reviewer explicitly retains 0 mounted browser/native cases and the unchanged raw-action matched-row/audit limits. No reviewer edits.

Metadata-only correction authorized by root: the earlier report SHA-256 `2d2d97ad9d69be9ffb6fa516e09a35282608cd51081b9f4c2289b0aa3ff2989e` incorrectly labeled runner-local test clocks as UTC. This revision states their UTC+02 basis and corresponding true UTC times. The three production/test source hashes and read-only action bytes remain unchanged; no new execution is inferred from this report correction. Prior report and manifest bytes are retained separately as superseded metadata.
