# Analytics attachment: confirmed empty data versus unavailable source

Continuation scope: U17/U20, actual `/admin/analytics/export` GET and actual `getReportRows`/`safeRows` source. This is an additive four-file correction after the earlier frozen 34-case integration/download packet. Its source and test receipts do not replace that historical packet or imply a native/browser run.

## Reproduced defect and resulting behavior

The real GET previously called the workspace report helper with its optional-schema fallback. A PostgREST missing-relation/schema-cache error became `[]`, producing HTTP 200 and an attachment containing `status\nInga rader`. An ordinary database permission/error result instead escaped the GET without a controlled response. The new actual-route/actual-helper suite reproduced both failures before the fix: **2 RED, 1 legitimate-empty positive control PASS**.

`getReportRows` now accepts an optional `requireAvailable` policy and forwards it in every dataset branch. The attachment GET requests that policy, so a database error cannot become a successful empty file. Report reading, CSV construction and response construction share a safe catch returning HTTP 500, `Kunde inte skapa rapportfil.`, `cache-control: no-store`, and no attachment header. Next framework control flow is rethrown. Existing fresh Auth/guard actor matching, nonplatform selected-company matching, whitelist, month normalization, successful CSV bytes and headers remain in the actual GET path.

Ordinary analytics workspace callers retain their existing missing-schema fallback because they do not request the strict attachment policy. An actually confirmed empty query still produces the existing successful empty CSV attachment.

## Executed bounded evidence

| Check | Actual result | Boundary |
|---|---:|---|
| New actual GET + actual report helper | 13/13 PASS | Controlled outer Auth/guard/scope and Supabase query response; actual report selection, tenant predicate, policy and CSV/response/control flow execute. |
| New plus previous actual scoped analytics/billing GET + real builder suite | 28/28 PASS in two files | Includes changed actor/company denials and preserved global access; it does not certify every successful report dataset's bytes. |
| All eight whitelisted report branches on unavailable source | 8/8 PASS within the new 13 | Each returns safe 500 after one query with the selected company predicate. |
| Genuine empty report, ordinary workspace fallback, real Next control flow | PASS within the new 13 | Empty data and unavailable data are distinguished; workspace fallback and redirect rethrow are retained. |
| Scoped ESLint: both source files, new test, new semantic script | 0 errors, exit 0 | No broad typecheck run concurrently with root's app gate. |
| Native/PostgREST and actual browser downloads | **NOT_EXECUTED (0)** | This packet adds no new native runtime acceptance. Existing prepared OPS fixture/browser packet remains distinct. |

Commands used with the required Node 22 PATH prefix:

```sh
npx vitest run __tests__/analytics-export-durable-outcome-20261001.test.ts __tests__/ops-download-route-outcome-20260930.test.ts
npx eslint app/admin/analytics/export/route.ts lib/analytics/db.ts __tests__/analytics-export-durable-outcome-20261001.test.ts scripts/tenantservice/ops-ui-semantic-denominator-20260930.mjs
```

## Four-file manifest and remaining work

- `app/admin/analytics/export/route.ts`
- `lib/analytics/db.ts` (only the optional policy in `safeRows` and its forwarding in `getReportRows`)
- `__tests__/analytics-export-durable-outcome-20261001.test.ts`
- `quality/audits/tenantservice-api-ops-20260928/continuation-20260930/analytics-export-durable-outcome-20261001.md`

Remaining qualification: actual local stack query/error outcomes, eight successful dataset content contracts and representative real attachment navigation/download bytes under current roles and A/B tenants. The whole OPS denominator remains open; neither the page count nor this bounded suite makes U17/U20 globally PASS.
