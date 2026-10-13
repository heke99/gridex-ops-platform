# Admin copy and queue remediation — 2026-10-13

Implemented after the user authorized clearing customer flows and preventing the reported failures for future customers. Database cleanup, SQL read-model deployment, dashboard counts and publication belong to the coordinating root; this workstream did not mutate the database or publish code.

## What changed

All five findings in `findings.md` have source fixes:

- Queue eligibility now lives in `lib/operations/actionableStatus.ts`. A producer's explicit `action_required` remains authoritative, including for a new status. Required-review jobs and persisted fullmakt/contact/mailbox blockers stay visible. Known automatic/waiting/terminal states stay outside the manual queue. Unclassified or empty states remain visible for review with Swedish fallback text.
- Information requests, facility requests and operation jobs use the same shared terminal-status exclusion before classification, including nullable states. This avoids losing a new state inside an earlier open-status allowlist. Company filters, related-customer ID guards, permission gates, limits and native Ediel process-decision checks remain in place. No Ediel producer source was edited.
- Work queue, Driftöversikt and billing underlay list/detail use the shared Swedish status formatter. Operator views explicitly request a Swedish fallback for new codes; technical consumers retain the existing optional humanization behavior. Queue task/job type and channel descriptions also have shared operator helpers.
- Website applications display human source descriptions. Tenant operators no longer see raw source-table names, mirror terminology, raw JSON or a free-text internal resolver-code field. The existing resolver value is preserved in the submitted hidden field; source routing IDs and `return_to` fields remain unchanged. External fallback applications remain read-only. Platform diagnostics remain available under an explicit technical disclosure.
- A dedicated typed energy-resolution label map replaces the grid-owner-verification mapper in both application views. The `Record<EnergyResolutionStatus, string>` requires every supported resolution status to have a label when the type evolves. Controlled facility status badges, related customer/contract/request fields and new unknown application statuses now use Swedish operator text.
- Website list KPIs consume the parent's `applicationWorkState` read-model metadata instead of maintaining another status categorization. Waiting has its own count, and the failed count no longer double-counts a failed row with a facility error.
- Website details load customer information requests, customer match-review cases and customer operation tasks from their typed DTO reference and matching company. The portfolio workstream validates these aliases before returning them. Tenant network-owner review retains the saved ID in a hidden input and exposes operator selection through the existing detail flow; platform diagnostics retain the technical ID control.
- Unclassified applications explicitly say they need review even when no legacy warning fields exist. Shared label lookups handle inherited object property names as unknown codes. Remaining owned static terms in Driftöversikt, billing and application actions use Swedish operator wording.
- The dashboard follow-up now uses the same canonical tenant scope as its permission guard for summaries, fallback counters and actor reads. A null canonical tenant company fails closed; platform aggregate behavior remains unchanged. This was separately authorized after the independent review.

The central definitions address the root cause: readers and classifiers share terminal semantics, producers' action flags are not reinterpreted by page-local lists, supported status labels come from shared display functions, and website categorization comes from one read model. Adding a new loaded status therefore holds it for review rather than hiding it or displaying its backend spelling.

## Regression evidence

The tests render the actual async server page components with synthetic adapters only at the database/auth boundary. No production data or live writes are used.

| Evidence | Observed outcome |
| --- | --- |
| `red-results.json` | 26 expected failures / 27 tests before initial fixes; the existing waiting-only exclusion passed. |
| `fallback-chain-red-results.json` | Two expected failures prove the unknown-application fallback and raw detail-chain enums before their fixes. |
| `unknown-read-red-results.json` | Five expected failures prove unknown jobs and unknown/null manual or info requests were dropped before classification. |
| `read-model-kpi-red-results.json` | One expected failure proves website list counts used a divergent local status list before adopting read-model metadata. |
| `typed-reference-red-results.json` | One expected failure proves the detail page used the wrong related table for hosted information requests; the foreign-company exclusion already passed. |
| `operator-id-red-results.json` | One expected failure proves a tenant operator saw the raw network-owner ID control before the guard. |
| `unknown-work-copy-red-results.json` | An additional expected failure proves a new review-required row could claim no blocker before its review message was added. |
| `verification-results.json` | Seven test files, 65 tests passed, zero failures after remediation. |
| `dashboard-scope-red-results.json` | Three expected actual-page tenant-scope failures; the existing platform aggregate behavior passed. |
| `dashboard-loader-verification-results.json` | Four follow-up test files pass 17/17, including all four new dashboard cases and the existing shared-scope/loader regressions. |
| `customer-relation-runtime-verification-results.json` | Three existing relationship regressions pass after replacing the obsolete duplicated-source assertion with actual list/detail hydration, explicit composite customer embed, company guard and selected-ID assertions. |

The final targeted command is:

```bash
/tmp/gridex-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/actionable-status.test.ts __tests__/admin-work-queue-action-visibility.test.ts __tests__/admin-website-application-copy.test.ts __tests__/admin-controltower-billing-copy.test.ts __tests__/website-application-list-navigation.test.ts __tests__/format-status-label.test.ts __tests__/operations-support-controltower-phase-5-6.test.ts --maxWorkers=2 --testTimeout=15000 --reporter=json --outputFile=quality/admin-consistency-2026-10-13/copy/verification-results.json
```

Application and tests TypeScript checks both exited 0 after the typed-reference and prototype-fallback changes. Redundant final repeated TypeScript checks were cancelled (exit 130) at root's request to free CPU for combined checks; they are not claimed as passes. Root subsequently reported both combined application and tests TypeScript checks passed; root owns any further generated-type verification. Scoped ESLint on the nine owned source files, four new test files and the authorized existing controltower test exited 0 with no warnings after the final changes; `git diff --check` exited 0. The follow-up existing customer-relationship runtime test also passes scoped ESLint and diff checks. Root performs the combined final review and verification, including its SQL/read-model changes.

The first full-suite run was terminated after 1,091 file reports and a prolonged output stall; it is incomplete evidence. `full-suite-incomplete-inventory.json` records all 37 problem suites, the unreported pre-existing OPS03 suite, and all 18 new workstream test files for a combined local rerun with the proper subprocess/loopback boundary. A complete full-suite pass is not inferred from that interrupted run.

## Skills and scope

Used the existing debugging evidence, local systematic-debugging, test-driven-development (including writing-good-tests), verification-before-completion and the React best-practices checklist. Read installed Next 16.3.8 page and server/client component documentation before production edits. No new client boundary, effect, caching policy, dependency or routing convention was introduced. Shared status maps remain request-independent; authentication, action handlers and tenant scope remain server-side.

No authenticated browser journey or production build is claimed by this delegate. The source audit and synthetic rendering tests prove the corrected selection/display behavior; root owns actual provider SQL and cleanup evidence.
