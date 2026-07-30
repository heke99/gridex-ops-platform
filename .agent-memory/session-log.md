# Session log

## 2026-07-25

- Read the master requirements and required repository context.
- Installed permanent project memory and Cursor operating rules.
- Compared local API/docs with the live developer page.
- Implemented all enumerated P0 and P1 repository fixes.
- Added forward-only billing/supply activation migration and manifest checksum.
- Added resolver, public DTO, invoice, interval, cron, activation, quote-schema
  and switch-state regressions.
- Fixed anonymous auth logging so tenantless 401 requests do not wait on the
  integration database.
- Verified typecheck, 346 tests, API docs/parity, migration history, lint and
  production build.
- Confirmed database apply verification is blocked by the absent Supabase
  runtime; recorded the exact staging continuation.

## 2026-07-26

- Traced contract deletion, tenant governance and integration API access across
  database, server actions, UI, tests and documentation.
- Added terminal contract closure and canonical tenant lifecycle RPCs in one
  append-only migration with a registered checksum.
- Added structured tenant activation blockers, close preconditions and
  tenant-status enforcement for API clients.
- Removed competing direct company-status mutation paths.
- Synchronized the admin UI, API docs, OpenAPI files and delivery guide.
- Verified typecheck, 354 tests, API docs/parity, migration history, dedicated
  lifecycle regression, lint and production build.
- Recorded that database application and transactional staging tests remain
  blocked by the absent Supabase/PostgreSQL environment.
- Reproduced the final-function overwrite behind SQLSTATE `42702` and mapped
  the missing backfill, quote, portfolio and FK delete dependencies.
- Added the forward-only canonical contract deletion graph completion.
- Restricted delete/bulk semantics, removed legacy canonicalization-on-delete,
  qualified all final `valid_to` updates and made close null-safe.
- Added terminal list filters, server-side pagination, exact blocker display,
  bulk item summaries and durable bulk error references.
- Verified 302 migrations/207 groups, PostgreSQL parsing, typecheck, 354 tests,
  targeted lifecycle regressions, lint with 0 errors and production build.
- Repaired the final tenant lifecycle `valid_to` definition with a new
  append-only migration and ended paused channels on tenant closure.
- Revoked direct authenticated delete-preview execution and aligned the DB
  lifecycle test with draft/ready-only permanent deletion.
- Added company-scoped contract navigation, three distinct contract counts and
  cross-surface revalidation.
- Aligned API auth error codes and resolver capability gating across runtime
  documentation, OpenAPI and the external integration guide.
- Verified 303 migrations/208 groups, typecheck, 354 tests, API docs, targeted
  regressions, lint with 0 errors and production build.

## 2026-07-27

- Isolated the contract list from readiness/delete graph failures and added
  explicit error/empty states plus strict tenant selection.
- Centralized platform role normalization in TypeScript and PostgreSQL.
- Enforced legal-identity-only matching and verified portal customer IDs.
- Routed every supply start through confirmed-only canonical activation.
- Retained missing-meter-value periods as blocked underlays and made readiness
  compare exact tenant/customer/contract/meter/period identities.
- Replaced monthly legacy export with canonical invoice export items and an
  atomic run/item/invoice-mirror reservation.
- Added full portal invoice traceability, lazy admin chain tracing, OpenAPI and
  deploy/rollback documentation.
- Verified typecheck, lint, API docs, migration checksums, 40 contract tests
  and 18 fixed-area tests. Focused identity/supply/billing tests pass 49/54;
  five old fixtures omit required exact identities.

## 2026-07-28

- Ingested delivery 93 and the Docker-free live database audit export.
- Compared active PostgreSQL definitions and schema objects against every
  relevant runtime table, field and RPC path.
- Confirmed the noncanonical remote/local migration history and avoided
  replaying old migrations.
- Implemented the single fail-closed forward repair migration, preflight,
  post-apply and live-schema/code regression.
- Repaired contract graph, crypto resolution, onboarding, legal, signature,
  publication, invoices, provider events, EDIEL, metering, RBAC and API paths.
- Verified all 41 exact function patches and all 23 live-lint errors.
- Verified TypeScript, 357 tests, lint with 0 errors, API docs,
  319 migrations/223 groups, P0/go-live suites, SQL parsing and production
  build.
- Produced the complete report and Docker-free production runbook.
- Recorded that production is still NO-GO until authorized apply, postflight,
  live lint and smoke tests pass.
- Implemented canonical channel permission, readiness, publication and
  availability for internal, website and API.
- Unified both admin surfaces, separated grants from publish, hardened the
  external DTO and aligned API/OpenAPI/ETag at `2026-07-28.2`.
- Added the forward channel-completion migration, final-schema inspection and
  dedicated regression coverage.
- Verified 361 tests, all TypeScript targets, API docs, go-live/lifecycle
  regressions, lint and production build.
- Confirmed the historical `20260728170000...` checksum drift cannot be
  repaired from the supplied artifacts; production remains NO-GO pending the
  trusted original plus database scenarios A-H.

## 2026-07-29

- Read the complete commercial contract/price/quote/snapshot/billing assignment and traced the actual admin, SQL, API, onboarding and billing paths.
- Searched supplied and prior available archives for the trusted historical migration; all available copies contain the same drifting bytes.
- Implemented the v6 option/component model, type-driven admin editor and strict server validation.
- Added server-owned selection to website quote and internal customer creation.
- Fixed the reduced website contract snapshot and added database quote binding.
- Added billing fail-closed identity and lifecycle charging semantics.
- Added forward migration, backfill/review, RLS, trace fields, post-apply and regressions; synchronized API/docs at `2026-07-30.1`.
- Verified 365 tests, TypeScript, changed-file lint, API docs, focused regression and a clean production build.
- Preserved the historical checksum blocker and made no database-apply claim.

## 2026-07-30

- Traced the OPS-to-Web contract, legal, application, portal, event, OpenAPI sync and readiness paths.
- Added the canonical release manifest and deterministic finalizer for version `2026-07-30.1`.
- Implemented dynamic document-bound legal acceptance, strict canonical customer events and strict portal sync identity.
- Added the forward-only atomic portal identity/account migration and registered its exact checksum.
- Synchronized Web snapshots/generated types and fail-closed live/readiness evidence.
- Verified all TypeScript targets, zero-error lint, 58 files/370 tests, API docs/parity, tenant/idempotency/portal/webhook regressions and both production builds.
- Confirmed Web migration integrity passes, OPS migration integrity has exactly the known historical drift, and the live release-manifest endpoint returns HTTP 404.
- Preserved an honest NO-GO pending trusted historical recovery, authorized database apply, deployment, live sync, full staging, provider/concurrency and two-tenant proof.
- Searched prior synchronized artifacts and recovered the exact trusted
  `20260728170000...` bytes matching manifest SHA-256 `881e1bc...`.
- Added registered forward migration `20260730130000...` for the delta that had
  incorrectly been placed in immutable history.
- Found and fixed the release-manifest serialization mismatch: manifest hashes
  now use the exact pretty-printed bytes served by the OpenAPI routes.
- Centralized canonical error normalization, removed duplicate `meta`/`quote`
  response aliases, and projected webhooks with tenant-bound opaque references
  and no raw database IDs.
- Regenerated OpenAPI and verified migration integrity, 373 tests, every
  TypeScript profile, API/docs/parity, error/tenant gates, lint and production
  build.
- Confirmed live HTTP/version availability but not hash parity. Kept production
  NO-GO for duplicate migration provenance, database replay, missing Web source
  and full environment E2E.
