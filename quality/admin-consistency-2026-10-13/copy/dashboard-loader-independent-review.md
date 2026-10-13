# Dashboard and application-loader review — 2026-10-13

Root requested an independent read-only review of the final loader and dashboard counter sources. This review found one confirmed dashboard scope defect and the SQL identity-priority defects that root was already testing. Root subsequently granted the dashboard page and a new actual-page test for remediation.

## Dashboard correction

The page previously selected tenant metrics and actor settings from `getOperationalCompanyScope(context.userId).companyId`, although `context.companyId` is the company for which the permission guard resolved access. The canonical SQL resolver requires an active scoped role and deterministically orders memberships; the legacy selector does not use those criteria. A synthetic operator authorized for `guard-A` could therefore obtain the dashboard for `legacy-B`, and a canonical null company could borrow a legacy membership instead of failing closed.

`app/admin/page.tsx` now obtains tenant scope through `resolveAdminTenantReadScope(context)`. Summary RPCs, fallback table counters, the shared pending-application counter, technical summaries and actor-profile reads all use the canonical company. The page avoids displaying the other company's name. Platform aggregate selection remains explicitly null while its selected actor profile preserves the prior operational scope.

`__tests__/admin-dashboard-canonical-scope.test.ts` calls and renders the actual async server page with deterministic adapters at auth/database/component boundaries. `dashboard-scope-red-results.json` records three tenant failures and one platform-path pass before the fix. `dashboard-loader-verification-results.json` records 17/17 passes across the four dashboard/scope/list-loader/detail-loader files, including all four new dashboard cases. Dashboard page/test ESLint and `git diff --check` passed. No new full typecheck was started; root owns the final combined verification.

## Loader and shared identity review

- The list reads shared work-item identity and filters it before applying the list limit. Hydration fetches exact source and mirror IDs without status filtering, preventing a linked mirror from disappearing merely because its source status differs from canonical state.
- Both list and canonical detail consume the same `status`, `work_state` and `is_pending` metadata. Missing shared schema and a deleted primary source fail visibly instead of returning an empty list. Hydrated primary/mirror company IDs are checked against the read-model company.
- Legacy polymorphic info/case references are resolved against actual target tables and same-company IDs. Missing, foreign or multiple target matches remain null with visible review warnings. Completed/closed states retain the explicit root policy for optional historical warnings.
- Direct external URLs retain the requested source record and warn when a shared owner cannot be established. They do not guess an owner through a shared key.
- Root's updated SQL computes an external intake's canonical owner once: explicit application ID, otherwise a uniquely owned intake ID, otherwise a uniquely owned key. Missing or ambiguous stronger identity retains the fallback intake. This corrects the earlier OR-condition mismatch without making the loader invent another identity rule.
- Dashboard pending counts use `gridex_pending_website_application_count`, which reads the same canonical view as the list. Tenant and platform summary replacements preserve the other summary fields and tenant row-level security. Unknown states remain pending for review; only known completed/closed states leave that count.

No additional confirmed regression was found in the reviewed loader. The isolated SQL identity regression passed all seven tests, recorded separately in `canonical-model-independent-verification-results.json`. This review does not claim browser or live-provider verification.
