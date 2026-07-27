# Gridex OPS contract P0 completion

Date: 2026-07-27  
Source archive SHA-256:
`985474d7b9c47bdd70e59783c165ceb0c9ef5dc950eb1734afc715f26444a1dc`

## Implemented corrections

- Registered the historical `20260727150000` collision explicitly and restored
  checksum-complete forward-only migration history.
- Enforced tenant-scoped live slug uniqueness while allowing archived slug
  reuse.
- Repaired immutable contract-product versions by creating successor versions
  rather than rewriting locked snapshots.
- Bound `/teckna-avtal` to `offer_reference`, active/live tenants and the exact
  published product/publication/pricing/legal chain. The manual-review form no
  longer creates a fabricated pending-signature contract.
- Made the website legal bundle offer-specific, exact-versioned and fail-closed.
- Made mandatory customer portal bundle sections fail closed with HTTP 503 and
  explicit unavailable sections.
- Added canonical “Skapa liknande avtal” database command, admin action and UI.
- Moved invoice export runtime to
  `gridex_create_invoice_export_graph_v1`, with canonical items/invoices,
  payload-safe idempotency, exact returned run identity, compatibility
  projection, event and outbox.
- Added quote integrity v2. The hash covers tenant, offer/version identities,
  customer pricing inputs, snapshot and `valid_until`; validity is immutable.
- Wrapped website canonical onboarding so quote lock/revalidation, customer
  graph commit, quote consumption, audit, event and outbox share one database
  transaction.
- Removed status-derived `server_verified` signature evidence.
- Replaced separate customer-contract event/status writes with an atomic,
  tenant-scoped command.
- Added an explicit customer-contract transition matrix. Signed status requires
  canonical signature evidence; active status requires the canonical supply
  activation graph; terminal states require time and reason.
- Expanded signed-contract immutability to commercial, legal, identity,
  version, site/meter, date and hash fields.
- Replaced the skippable active-contract index with a blocking invariant keyed
  by tenant, physical supply identity and energy direction. Consumption and
  production may coexist.
- Corrected invalid runtime statuses: readiness review remains a readiness
  field and customer withdrawal is `cancelled` with a reason code.
- Corrected the five billing-readiness failures: pre-scoped supply periods may
  omit redundant identities, but every identity supplied must match exactly.
- Removed the React state-in-effect lint error without disabling the rule.
- Updated the RBAC audit for current files and reviewed all currently detected
  admin service-client paths.

## Changed surface

Compared byte-for-byte with the uploaded archive:

- 6 new forward migrations (`162000`–`167000`);
- 1 new 122-control P0 regression script;
- contract/admin/customer/quote/billing/legal/portal runtime changes;
- OpenAPI legal-bundle contract updates;
- focused fixture/type corrections;
- migration manifest and RBAC audit corrections.

Generated dependency/build artifacts are excluded from the deliverable.

## Verification protocol

Passed:

- `npm run typecheck`
- `npm run typecheck:contract-go-live`
- `npm run typecheck:tests`
- `npm run test` — 55 files, 356 tests
- `npm run test:canonical-onboarding` — 4 files, 52 tests
- `npm run test:contract-go-live` — 9 files, 40 tests
- `npm run lint` — no errors (124 pre-existing unused-code warnings)
- `npm run security:rbac` — 24 checks, 0 warnings
- public API/OpenAPI runtime, version, example and boundary checks
- migration history — 318 files, 222 version groups, checksums verified
- contract P0 integrity — 122 controls
- contract go-live — 208 controls

## Environment-gated verification

The archive contains no `.git`, so branch/commit provenance is unavailable.
No Supabase CLI, PostgreSQL client, database URL or authorized staging database
was available. The six forward migrations therefore require a real staging
apply plus PostgreSQL concurrency/two-tenant tests before deployment approval.
Provider sandbox and production deployment verification are likewise pending.

These are external verification gates; they are not reported as successful
local tests.
