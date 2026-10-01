# T51/P7: secondary billing diagnostics

Date: 2026-10-01. Root authorized exactly `lib/integrations/billing/invoiceExportCore.ts`, `lib/billing/exportCenter.ts`, one new actual-caller suite and this unique report. The two source diffs contain imports and four diagnostic projections only. Provider transport, locks/CAS, captured request, GUID, purchase, outcome/taxonomy, financial graph and historical data code remain byte-identical outside those lines.

## Actual failure and correction

The unique exported-boundary suite reproduced **6 RED / 4 controls PASS**: all six final RED cases failed specifically on raw diagnostic canaries. An initial test-adapter rejection bug was corrected before that receipt; its timeout/unhandled rejection is not counted as a production finding.

Synthetic email, phone, full name, street, opaque provider key and Supabase-secret values appeared in complete database error objects passed to logs. Four diagnostic sites now reuse the frozen `technicalErrorDiagnostic` helper: retained technical SQLSTATE (`23505` in these cases), controlled constant classification and existing technical item/run context. No free message/details/hint or nested provider/customer object is logged by these sites.

| Actual exported flow and sink | Executed outcome/proof |
| --- | --- |
| `sendInvoiceExportRun` → attempt-audit insert error → `recordExportAttempt` log | Actual sender remains `sent`; complete request/key captured before mocked transport and its accepted synthetic GUID retained afterward; failed audit insert does not become a false send failure |
| `sendInvoiceExportRun` → defensive terminal item → failed correction-task insert | Actual defensive `resend_blocked`, unchanged item/history and zero provider calls; exact outer-adapter limitation below |
| `processDueInvoiceExportRetries` → failed current run lookup | Zero processed/sent/failed, no provider call, item/financial evidence unchanged |
| `createBillingExportRun` → confirmed blocked graph receipt → returned task-insert error | Actual caller returns the blocked run, no canonical invoice candidates/provider call; safe warning |
| Same graph caller → thrown task-insert error | Actual catch runs and retains the blocked graph receipt; safe warning |
| Same graph caller → successful task insert then failed item-link update | Exactly one synthetic task retained, its item/run identity matches the prepared blocked row, link remains absent; no second task/create or financial effect |

The graph RPC is a controlled outer adapter returning the actual prepared run ID/legacy graph; the runtime caller checks this receipt and maps the real data. The adapter records the synthetic graph/task state for late-fault assertions. This is not native graph persistence. Every relevant case compares existing pricing, lines, locked profile/underlay, customer/company and an unrelated foreign issued invoice's original GUID/document-hash/raw-payload fixture against its initial bytes. It does not qualify physical document bytes or a whole native issued graph.

Four controls remain green: the existing missing attempt-table tolerance emits no log and preserves success; sender schema denial occurs before DB/transport; graph current-company governance denial occurs before readiness/read/RPC; genuine installed Next redirect objects from both early guards propagate unchanged with no logging/effect. No catch/guard/control-flow structure was changed by this packet. These are actual caller checks with controlled guard outcomes, not native authorization SQL or a claim about every possible internal framework throw.

## Exact terminal-task reachability boundary

Every current public canonical sender/retry selection filters `pending`, `failed` or `failed_retryable`. A naturally selected terminal row cannot satisfy that predicate. The terminal-task case deliberately supplies an invalid terminal row from the DB adapter to exercise the real sender's defense branch, and labels this explicitly in the test. It proves the defensive result/log projection under a faulty outer result; it does not invent a native race or qualify ordinary native reachability of that branch. Source references to the canonical send/retry exports in current `app`/`lib` were limited to their declarations in the bounded search; their actual exported functions are executed here, while a current production route/cron binding is not inferred. The legacy export-center caller is independently exercised through its exported graph function.

## Local gates and frozen manifest

Final relevant execution: **81/81 across five actual suites**, including all **10/10 new cases**, 19 request/retry cases, one 409 purchase-conflict case, 14 classifiers and 37 prior logging canaries. The initial related invocation accidentally named a nonexistent purchase test and therefore ran only four files/80 cases; the exact existing file was then independently run 1/1 and the final corrected five-file command ran 81/81. No nonexistent filter is counted as an executed suite.

```sh
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/invoice-secondary-log-canary-20261001.test.ts __tests__/invoice-provider-request-retry.test.ts __tests__/invoice-purchase-conflict-outcome.test.ts __tests__/export-classification.test.ts __tests__/customer-error-log-canary-20261001.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/eslint/bin/eslint.js lib/integrations/billing/invoiceExportCore.ts lib/billing/exportCenter.ts __tests__/invoice-secondary-log-canary-20261001.test.ts
```

Scoped lint exit 0; focused TypeScript exit 0 (temporary config extends current `tsconfig.json`, plugins/incremental disabled, unique test plus actual transitive source included); `git diff --check` exit 0. This is not a whole-app type/build or exact published-head CI receipt. No native/browser/provider case ran. The synthetic transport adapter is the sole network boundary and makes no external call.

| Owned path | SHA-256 |
| --- | --- |
| `lib/integrations/billing/invoiceExportCore.ts` | `08976173c7adba23d27ac6132f97cb85259ccc87a25a2a9411a9810b2f2bb379` |
| `lib/billing/exportCenter.ts` | `cc56618fa8c218973f378fd647f3386c9c49a13449ec9ea90e9c9228270c0e99` |
| `__tests__/invoice-secondary-log-canary-20261001.test.ts` | `d13008fbda91207871909e2b93f67d4c6e0ffe366b23079634ab547ddf06c06f` |
| This fourth unique report | Hash supplied separately to root |

These source/test bytes are frozen for independent review. Previous T51 ten-file and website seven-file source/test manifests are unchanged.

## Source-only P2/P7 telemetry follow-up, still internal OPEN

No `apiAuth` edit is authorized or made. The actual `logIntegrationApiRequest` writer in `lib/integrations/apiAuth.ts` takes top-level `request_id` directly from inbound `x-request-id` (line 460 at review), while metadata is passed through from the caller. The current `integration_api_requests.request_id` column is text. No local projection binds this top-level value to a route-generated trace or validates it as a technical identifier. Portfolio's corrected body/header/log and `metadata.trace_id` are consistent, but its persisted top-level `request_id` may remain null or caller-supplied and different. Legal-bundle supplies its server trace in `metadata.request_id`; switch-status's unknown-error telemetry does not supply that metadata trace. This is a precise local correlation/projection gap, not an unavailable provider boundary or a qualification that arbitrary request headers/metadata are safe.

The writer's anonymous 401 early return has no tenant target; its actual existing `after()`/awaited fallback and raw header/metadata persistence remain unchanged. The current packet does not qualify durable native telemetry, change historical requests, redefine legitimate security IP/user-agent retention, or normalize every metadata caller. Remaining automation/supplier-switch/generic-metadata diagnostic inventory from prior reports stays explicitly open until its own actual boundary proof and correction.
