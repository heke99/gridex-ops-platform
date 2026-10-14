# Canonical admin company scope — bounded remediation

The permission guard selected company A, while a later operational membership lookup selected B. The affected pages/loaders consequently read B using permissions resolved for A. This was reproduced at actual page and route entrypoints, with synthetic database/auth adapters. The four automation actions also wrote B after checking A; their downstream operational-lifecycle checks did not bind the actor permissions to A.

## Central rule

`resolveAdminSelectedCompanyReadScope` preserves the guard's selected company for tenant and platform callers. `resolveAdminTenantReadScope` uses the same tenant authority while preserving platform aggregate reads. An explicit canonical null never falls back to another membership. Older contexts without the canonical field retain the existing fallback. Tenant selected reads fail closed with `TenantCompanyRequiredError`; the shell renders its existing friendly empty state. Callers with a verified empty/HTTP-refusal branch use `{ allowMissing: true }` and handle null before any data read. Platform null retains each existing selected/global behavior.

The shell and live-access gate use the same authority. A second legacy selection cannot change the visible company name, live status or read scope. Platform company-option metadata remains a separate membership lookup. Information-request membership/lifecycle evidence controls write affordances only; its selected company does not supply the read filter.

## Qualified read paths

| Source | Canonical resolver reference |
| --- | --- |
| `app/admin/billing/underlays/page.tsx` | line 12 |
| `app/admin/billing/underlays/[id]/page.tsx` | line 13 |
| `app/admin/billing/page.tsx` | line 78 |
| `app/admin/billing/invoices/[id]/page.tsx` | line 49 |
| `app/admin/billing/quality/page.tsx` | line 50 |
| `app/admin/billing/ai-parser/page.tsx` | line 38 |
| `app/admin/billing/import/page.tsx` | line 15 |
| `app/admin/billing/integrations/page.tsx` | line 44 |
| `app/admin/company-settings/page.tsx` | line 50 |
| `app/admin/contracts/page.tsx` | line 746 |
| `app/admin/customer-info-requests/page.tsx` | line 164 |
| `app/admin/customer-login/page.tsx` | line 12 |
| `app/admin/customers/imports/page.tsx` | line 138 |
| `app/admin/metering/page.tsx` | line 33 |
| `app/admin/operations/automation/page.tsx` | line 35 |
| `app/admin/operations/perioder/page.tsx` | line 28 |
| `app/admin/pricing/market-sources/page.tsx` | line 29 |
| `app/admin/audit/page.tsx` | line 52 |
| `app/admin/system-health/page.tsx` | line 98 |
| `app/admin/billing/invoice-files/[id]/route.ts` | line 19 |
| `app/admin/billing/export-center/[id]/download/route.ts` | line 19 |

## Evidence

- `remaining-pages-scope-bounded-red-results.json`: 61 failures / 64 before the substitutions, with no import/mock/type/timeout failures. The original earlier red run is preserved separately and includes fixture limitations.
- `remaining-pages-scope-verification-results.json`: 82/82 passed, zero skipped: 64 actual-page/download cases across all 19 pages and two routes, 16 shared scope/live-access/layout regressions, two existing billing/controltower copy regressions.
- `automation-actions-scope-red-results.json`: 14 failures / 18 before the helper change; the four permission-refusal cases already passed.
- `automation-actions-scope-verification-results.json`: 18/18 passed. All four action entrypoints retain actor identity and guard permissions, use company A despite legacy B, reject canonical null before a domain write, and do not depend on a second membership selection. Platform selected A/null behavior remains.
- Scoped ESLint passed without errors or warnings for the retained helper/layout/live-access, five read paths, automation action and four affected test files.
- `scope-variant-verification.json` records the current source hashes, exact canonical reference lines and test totals. The peer-owned final action slices have their own evidence and a final combined check.

## Qualified exclusions

A legacy scope call alone was not counted as a defect. Platform-only technical pages are outside tenant scope. Process-watch reads explicitly compare the guard company. Billing import and controltower writes re-authorize the target company through `requireCompanyScopedActionAccess`; customer-login writes retain an explicit expected-company fence and company-scoped action access. These protected paths were not changed under this variant remediation.

This evidence does not replace a production browser/CI verification or claim the unrelated full unit suite passed. The earlier full-suite environment/time-budget limits remain documented in `full-suite-verification.md`. No database or remote publication was performed by this workstream.

## Final bounded action handoff

Root authorized exactly four additional confirmed modules after the direct support-create authorization proof. Both peers have frozen their sources. Independent review confirms that these changes retain existing permissions, expected-company form fences, actor identity, row/company ownership checks and lifecycle requirements:

- `app/admin/customer-cases/actions.ts`: the selected scope receives the permission guard context for support creation, status changes and the shared conversation scope. A permitted company-A operator cannot borrow company B from the membership selector; support customer/case graph validation remains.
- `app/admin/outbound/unresolved/actions.ts`: the shared scope helper binds tenant row checks and bulk selectors to the guard company. Platform outbound retains global null scope; foreign-row refusal remains.
- `app/admin/cis/actions.ts`: only the private bulk helper changes. Its three callers retain company membership/lifecycle validation for a selected company and preserve the platform global-null mode. Individual CIS paths remain outside this bounded change.
- `app/admin/operations/control-actions.ts`: the sweep and `bulkQueueReadyBillingExportsAction` retain their permission context before selecting the company. Both still require a selected company and an operational-write lifecycle check.
- `app/admin/billing/integrations/actions.ts`: the pre-existing selected-company helper now consumes the guard context; all five provider write/test/retry paths preserve authentication, permissions and provider business-readiness rules.

Together with `app/admin/operations/automation/actions.ts`, this is the final six-module action set. No next audit or additional source paths were opened. Peer runtime proofs were 16/16 billing integration, 14/14 support/outbound and 27/27 CIS/control, each with recorded expected pre-fix failures. The final combined current-source artifact is recorded below when complete.

## Final combined current-source check

`final-canonical-scope-verification-results.json`: **198/198 passed, 0 failed, 0 skipped** across 11 actual page/helper/action regression files, including the root/peer analytics, original named operational pages and dashboard. All 30 bounded source hashes remained unchanged during the run. Independent review of both final peer action slices found no blocker: permission guards, actor checks, selected/global platform modes, expected-company form fences, row ownership and lifecycle refusals remain. Scoped lint and whitespace checks passed in each owner slice. Root owns final repository types, build, CI, publication and live verification.
