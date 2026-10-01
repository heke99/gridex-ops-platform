# U09: source-compatible webhook list projections

Date: 2026-10-01. Root authorized only the two webhook loader exports, their row availability annotation and private narrow error classifier in `lib/admin/websiteIntegrationOps.ts`; the existing webhook page API-binding caption; one unique functional suite; and this report. Other loader exports, authentication/permissions, SQL, generated types, native/browser fixtures, retries/idempotency/provider actions and financial/Auth graphs are unchanged.

## Actual source and functional failure

The current generated schema contains `integration_api_clients`. An earlier absence hypothesis for that table is superseded. Its `webhook_subscriptions` definition (`supabase/database.types.ts:74029`) contains the real base subscription columns and company relationship, but lacks `api_client_id`, `last_success_at`, `last_failure_at` and the requested API-client relationship. The subscription loader requested all three columns and the relationship; the delivery loader requested the absent nested subscription `api_client_id`. Its broad `missingSchema` handling converted these failures, missing tables and unrelated schema/cache failures into `[]`.

The unique suite executes the **actual exported loaders** and the **actual page/React SSR consumer** behind a controlled query adapter. Initial source produced **20 RED / 9 controls PASS across 29 cases** at runner-local `05:57:55` Europe/Berlin UTC+02 (`03:57:55Z`). Failures showed false empty lists for existing scoped base rows, missing-table/unrelated-schema failures incorrectly reported as empty, and the actual page displaying false empty states. Future available full projection, confirmed empty results, permission/unavailable errors and query-shape controls passed. This is local functional/source-render proof, not an authentic PostgREST, database, Auth, HTTP, mounted browser, provider or security/privilege exercise.

## Narrow compatible projection and honest unknown state

Both loaders retain their existing full projection first. This preserves a future fully available API binding/timestamp shape. The subscription loader retries **at most once** with its existing generated base fields only when a known technical failure identifies exactly one of those optional subscription columns or exactly the subscription/API-client relationship. Delivery retries only the absent nested subscription `api_client_id`. The private classifier requires both a known code and the precise expected table/column or relationship message: `42703`, `PGRST204`, or subscription-only `PGRST200`. Unknown table/column/relationship shapes fail instead of weakening the query.

The base query preserves the same company/status predicates, created-at descending order, default limit and 1–200 clamp. Both query attempts have identical scope and ordering. The real base company join and delivery subscription name/endpoint join remain. No DDL, artificial API-client relationship or fabricated original rows is created. The fallback result's optional binding/timestamp values are nullable with `api_client_binding_available=false`; their nulls mean unconfirmed projection metadata, not confirmed absence. The full result sets that annotation true and preserves its original metadata values. Nested delivery fallback leaves the unselected API-client field absent and preserves its destination/name metadata.

The actual webhook page now renders `API-koppling ej bekräftad` for that explicit false availability receipt. A confirmed full projection with no API client retains `API-client saknas`; a full projection with a real client name displays the name. No other page copy, navigation, forms, capability preflight or action semantics changed. The prior page's exact SHA `38a36063b3e62ad5f428ab033f4390d3b8a40d895c717ed0e194109f59fb823b` was reproduced by reversing this sole caption expression, retained at `/tmp/gridex-webhook-schema-compatible-prior-page-20261001.tsx`. Historical U09 production/prepared receipts remain dated and unchanged; this separate manifest records the latest page source evolution.

Missing table (`42P01`), denied query (`42501`), unrelated column/table, unrelated relationship/cache failure, unavailable database and failure of the single base retry now propagate their existing error. They cannot become a successful empty list. A successful confirmed empty query remains `[]`. This patch does not change the other exported loaders' existing missing-schema policy or add an error-message disclosure path.

## Exact consumers and separate remaining work

`WebhookSubscriptionAdminRow` and `WebhookDeliveryAdminRow` are consumed only within their defining module. Direct production consumers of these two exports are the webhook page (`listWebhookDeliveries` / `listWebhookSubscriptions`) and company detail page (`app/admin/companies/[id]/page.tsx:1345`, subscription list only). Company detail passes the subscription statuses to `computeTenantReadiness`; it does not read the optional binding/timestamps, so these unknown nulls do not become a new API-binding or timestamp business claim there. The webhook page caption is the only current consumer displaying API-binding presence from this loader. No company-detail source was edited.

Source-only related field gaps remain separate: partner subscription list at `lib/partner-api/core.ts:1021`, platform API-client page query at `app/admin/platform/api-clients/page.tsx:216`, and provider-success/failure metadata updates at `lib/integrations/webhooks.ts:346,360` also reference optional subscription fields. They are not repaired or runtime-qualified by this loader packet. Original transport, provider effects and durable webhook action/audit receipts are unchanged and unqualified here.

The prepared U09 fixture still requires the exact real production-loader seeded IDs and fails if the schema/query does not produce them. Its earlier missing-optional-schema prerequisite is addressed at the source projection boundary only. No native/browser execution has occurred; real PostgREST behavior, exact loader prerequisite success, Next mounted controls and provider qualification remain explicit internal execution work. The frozen prepared fixture's own-ID/financial/Auth/foreign preservation checks remain unchanged, and no successful seed or native/database acceptance is claimed.

## Actual current receipts

Final unique suite **29/29 PASS**; combined actual current suite **82/82 PASS across three files** (29 loader cases + 29 selected-company boundary + 24 U09), at runner-local `05:59:28` Europe/Berlin UTC+02 (`03:59:28Z`). Cases assert exact scoped row IDs, no foreign result, first/full projection preservation, one known-shape retry, identical company/status/order/limit, recognized optional shape alternatives, unrelated errors before retry, a base failure after exactly one retry, confirmed empty, full API metadata, and actual page caption/disabled SSR controls. The page's guards/actions are controlled for this caption test; the separate selected-company/U09 suites execute the actual guard/action chain. These evidence boundaries are not interchangeable with mounted browser or native SQL.

Scoped TypeScript: exit 0, temporary root-extending config includes `next-env.d.ts` and the unique suite's transitive actual exports, plugins/incremental disabled. Scoped ESLint: exit 0, no diagnostics. Scoped whitespace: exit 0. No whole-app build or exact published-head CI claim. Native/browser/Auth/provider calls for this packet: **0**.

```sh
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/webhook-schema-compatible-loader-20261001.test.ts __tests__/company-scoped-current-selection-20261001.test.ts __tests__/webhook-readonly-controls-20261001.test.ts
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/eslint/bin/eslint.js lib/admin/websiteIntegrationOps.ts app/admin/webhooks/deliveries/page.tsx __tests__/webhook-schema-compatible-loader-20261001.test.ts
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/typescript/bin/tsc --project /tmp/gridex-webhook-schema-compatible-loader-20261001.tsconfig.json
```

## Frozen source/test manifest

| Path | SHA-256 |
| --- | --- |
| `lib/admin/websiteIntegrationOps.ts` | `21c4c5f2f2be311a7ba265955a25b7c9c5578c90e872fdca3df86ab2491d221f` |
| `app/admin/webhooks/deliveries/page.tsx` | `8d1f680acc50668e357002e12f38b5d62a341c306f8e982f40883262f4555f38` |
| `__tests__/webhook-schema-compatible-loader-20261001.test.ts` | `bfcb90874132b4a82fe87240d60feda8d8e075704496eb03c036fbce59f6e96e` |

This report is the fourth path, hashed separately in the exact manifest. Independent review is pending separately, not recorded as PASS. Whole-OPS/runtime action denominator and all original requirements remain with the explicit master registry; this bounded correction does not close them by source counts or local test references.
