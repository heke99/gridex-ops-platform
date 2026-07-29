# Completed verified work

## PHASE-00 — Permanent project memory

Required files, Cursor rules, checkpoint JSON and secret scan are verified.

## P0/P1 canonical lifecycle hardening

Status: VERIFIED LOCALLY

- Decoupled pricing/quote readiness from facility/PRODAT/switch readiness.
- Added resolver capabilities and stable purpose-specific blockers.
- Closed external request schemas and rejected unknown canonical API fields.
- Added explicit sanitized website-application DTO and public-ID policy.
- Split switch request creation from dispatch; deprecated the old alias.
- Replaced billing placeholders with data-backed profile, payment-term,
  provider/environment, recipient, address, OCR/reference and VAT evidence.
- Removed pricing-run/billing-underlay invoice fallbacks.
- Enforced exact hourly versus quarter-hour spot source selection.
- Added missing authenticated reconciliation cron.
- Added idempotent transactional `activate_customer_supply_v1`.
- Added canonical `supply.started` and `invoice.paid` webhook events and
  documented active/internal/planned event names.
- Synchronized OpenAPI, runtime, developer page and guides at `2026-07-27.1`.
- Added an explicit terminal contract-close operation with dependency cleanup,
  immutable closure metadata, audit, domain event and transactional outbox.
- Added canonical tenant lifecycle transitions with structured activation
  blockers and close preconditions.
- Enforced owning-tenant operational status for every integration API client.
- Removed direct company-status writes outside the canonical transition RPC.
- Added one canonical contract delete preview covering quotes, business usage,
  graph integrity, backfill diagnostics and real FK delete rules.
- Restricted permanent/bulk delete to unused `draft/ready`; published and
  terminal states now use lifecycle actions and separate list views.
- Removed delete-time legacy canonicalization and shared price-version cleanup.
- Added per-offer bulk subtransactions, durable technical references and
  server-side contract pagination.
- Repaired the final tenant lifecycle definition and made tenant closure end
  paused channels.
- Removed direct authenticated execution of the privileged delete preview.
- Separated contract-product, published-offer and customer-contract counts in
  company administration and preserved company selection in navigation.
- Aligned runtime API auth codes and resolver readiness requirements across
  OpenAPI, developer UI and the external integration guide.
- Isolated the internal contract list from readiness/delete graph failures.
- Enforced strict tenants, central role aliases and complete creation results.
- Enforced legal-identity-only customer reuse and same-customer DB invariants.
- Unified supply activation and monthly invoice export around canonical,
  idempotent database commands.
- Created draft invoice mirrors before provider send and updated them
  idempotently from provider events.
- Added lazy tenant-scoped chain tracing and complete portal invoice IDs.

## Verification

- Typecheck: pass.
- Full Vitest: 54 files, 354 tests pass.
- Targeted P0/P1 suite: 11 files, 80 tests pass.
- API contract/OpenAPI/docs checks: pass.
- Migration integrity: 304 files, 209 groups, checksums pass.
- New delete-graph migration: PostgreSQL parser accepts 32 statements.
- Dedicated contract delete-graph regression: pass.
- Dedicated contract/tenant lifecycle regression: pass.
- ESLint: pass with 125 existing warnings and no errors.
- Next.js production build: pass; `.next/BUILD_ID` generated.
- Added the service-only actor-aware contract delete v2 path with a shared dependency graph, preview token, concurrency-safe idempotent commit, explicit archive fallback, shared admin repository/actions and status filters across both admin entry points.

## 2026-07-27 P0 completion pass

- Repaired migration collision/checksum history and live slug/version integrity.
- Bound manual/web intakes and legal bundles to exact public offer identities.
- Made quote consume and canonical onboarding transactional.
- Removed status-derived signature evidence and added the contract state machine.
- Added energy-direction-aware active contract uniqueness.
- Moved invoice export runtime to the canonical graph.
- Added offer copy, fail-closed portal bundle and RBAC/lint corrections.
- Verified 356 tests, all TypeScript targets, lint, RBAC, API/OpenAPI,
  318/222 migration history, 122 P0 controls and 208 go-live controls.

## 2026-07-28 live-schema/code canonical synchronization

- Parsed the active live schema, functions, views, triggers, indexes, grants,
  RLS and remote migration history.
- Covered all 23 active live-lint function failures.
- Added a fail-closed forward migration with 41 exact active-definition
  patches and canonical schema repairs.
- Added missing onboarding/communication relations, invoice/provider fields,
  uniqueness, RLS and grants.
- Repaired canonical contract graph, energy direction, inclusive validity,
  signature retry, channel ending, legal/onboarding crypto and wrapper grants.
- Removed public quote UUID leakage and aligned runtime/OpenAPI at
  `2026-07-28.1`.
- Added preflight, rollback-only post-apply and full code/schema path
  regression.
- Verified 357 tests, TypeScript, lint with 0 errors, API docs, 319/223
  migration history, P0/go-live suites, SQL parse and production build.
- Produced the complete Swedish audit report and Docker-free apply runbook.

## 2026-07-28 canonical contract-channel completion

- Added explicit, idempotent internal/website/API channel grants separated from
  publication, with shared readiness and granular permissions.
- Routed both admin surfaces through one actor- and tenant-bound canonical
  service with post-commit state verification and failure audit.
- Made grants, channel state, validity and availability mandatory in the
  canonical TypeScript/SQL read model; missing database columns now fail
  closed instead of becoming `false`.
- Rebuilt website and API publication projections from the same immutable
  publication graph and added graph/date/hash/single-active-version checks.
- Added a strict external DTO allowlist, API scope `api_contracts.read`,
  documented errors and response/ETag/OpenAPI version `2026-07-28.2`.
- Added forward migration `20260728190000...`, post-apply introspection,
  dedicated behavior tests and a 43-control static regression.
- Verified 56 files/361 tests, all relevant TypeScript targets, API docs,
  212 go-live controls, 518 lifecycle controls, lint and production build.
- Recorded the pre-existing `20260728170000...` checksum drift as a release
  blocker; no database apply or A-H scenario was claimed.
