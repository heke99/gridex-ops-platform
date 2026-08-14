## 2026-08-03 — Runtime schema readiness v4 incident repair

Status: VERIFIED LIVE DATABASE / READY FOR APPLICATION DEPLOY.

- Root-caused and removed the stale exact fingerprint production outage.
- Applied and verified forward migration `20260803212754` on `gridex-ops-dev`.
- Reconciled canonical manifest/ledger mappings and live readiness state.
- Added idempotent post-apply and static regressions.
- Verified API contract/OpenAPI documentation version `2026-08-03.1` and focused
  runtime/tenant/idempotency/portal checks.

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

## 2026-07-29 canonical commercial selection completion

- Added stable 12/24/36-capable price options and per-option SE-area rows.
- Replaced free-text optional fees with structured policy/condition/lifecycle components.
- Unified website and internal selection, quote hash v3, signed snapshots and billing under one v6 model.
- Added atomic service-only offer and internal customer commands, tenant/RLS guards, deterministic backfill and review evidence.
- Fixed exact component freezing and fail-closed billing identity.
- Synchronized API/OpenAPI/docs to `2026-07-30.1`.
- Verified 57 files/365 tests, TypeScript, lint, API docs, focused regression and production build.
- Database apply remains blocked by the immutable historical drift and absent authorized staging connection.

## 2026-07-30 canonical OPS/Web API release

- Added a machine-readable release manifest with deterministic OpenAPI hashes.
- Synchronized runtime, Website OpenAPI, Customer Portal OpenAPI, guide and examples at `2026-07-30.1`.
- Replaced fixed legal consent assumptions with dynamic, exact document evidence.
- Closed the targeted quote, portfolio, customer-event and portal-sync contracts.
- Added strict paired portal identity headers/payloads and a forward-only atomic portal identity/account migration.
- Synchronized Gridex Web snapshots and generated types; live readiness remains fail-closed until deployment.
- Verified 58 files/370 tests, all TypeScript targets, zero-error lint, API docs/parity, targeted tenant/idempotency/portal/webhook regressions and both production builds.
- Production remains NO-GO because immutable migration drift, database apply, live manifest, staging, provider, concurrency and two-tenant evidence are unresolved.

## 2026-07-30 immutable-history and public-contract repair

- Recovered `20260728170000...` from a trusted prior synchronized artifact and restored its registered bytes without changing the manifest checksum.
- Moved the intended inclusive `valid_to` and session-guard repairs into registered forward migration `20260730130000...`.
- Fixed release-manifest SHA-256 calculation to hash the exact serialized bytes served by both OpenAPI routes and made the manifest response non-cacheable.
- Normalized public errors to one nested envelope and removed duplicate integration-context and quote success aliases.
- Replaced raw webhook UUIDs/internal IDs with stable tenant-bound opaque references and recursively sanitized webhook data.
- Regenerated both OpenAPI documents with closed canonical error and publication-webhook schemas.
- Verified 323 migrations/227 groups, 58 files/373 tests, all TypeScript profiles, API/docs/parity, error/tenant gates, zero-error lint and production build.
- Production remains NO-GO pending migration-ledger resolution, clean/upgrade apply, deployment/live hashes, missing Web source and full environment E2E.

## 2026-07-30 Customer Portal/API production completion

- Added one strict customer sync request contract and tenant-safe identity normalization.
- Replaced public portal/application internal IDs with stable tenant-bound references.
- Added paginated portal projections and fail-closed bundle completeness.
- Added external-reference, idempotent and atomic move-out with case/event/outbox/audit state.
- Repaired v3 commercial quote acceptance in the atomic onboarding command.
- Synchronized runtime, OpenAPI and docs at `2026-07-30.2` and added compatibility/release gates.
- Verified 324 migrations/228 groups, 58 files/373 tests, all TypeScript targets, API gates, zero-error lint and production build.
- Database apply, deployment, live hashes, Gridex Web and environment E2E remain blocked and are not claimed.

## 2026-07-30 canonical price-option/API completion

- Bound price options to exact publication versions with customer type,
  default and explicit-selection rules.
- Added deterministic backfill, review evidence, publish-time validation and
  immutable publication copies without rewriting historical migrations.
- Exposed canonical top-level `price_options` and bound quote, validate and
  application assertions to the same immutable selection.
- Harmonized legal document identity and strengthened OpenAPI reachability,
  runtime fixture, example and release-identity checks.
- Restored portal contract signature-hash DTO/OpenAPI parity discovered by the
  final go-live regression.
- Synchronized both OpenAPI documents at `2026-07-30.3`.
- Verified 325 migrations/229 groups, all TypeScript profiles, 58 files/376
  tests, API gates, zero-error lint and production build.
- Database apply, post-apply, deployment, live hashes, Gridex Web and
  environment E2E remain blocked and are not claimed.

## 2026-08-01 Public Contracts runtime/OpenAPI/legal parity

- Replaced recursive public-contract DTO leakage/filtering with explicit strict canonical price-option and legal serializers.
- Made `is_default` canonical and retained `default` only as an identical deprecated compatibility alias.
- Added exact locked legal bundle identity to the legal object and every module, with fail-closed UUID, immutable, bundle and duplicate-module invariants.
- Added forward migration `20260801003000...`, exact-relation legal snapshot generation and dry-run-first idempotent audited backfill.
- Unified Website/API DTOs, repaired API legal output, added request/version headers and structured safe diagnostics.
- Regenerated both OpenAPI artifacts and release hashes at `2026-08-01.1`; added canonical fixture and route/OpenAPI/docs/version/checksum/migration gates.
- Rebuilt `/developers/customer-portal-api` into the complete integration guide.
- Static/API/domain regressions and changed-file TypeScript checks pass. Full dependency-based build, database apply and staging remain unverified. Historical `20260730220000...` checksum drift remains explicit and unblessed.

## 2026-08-01 canonical multi-tenant platform hardening

- Added explicit trusted tenant context to integration API and every implemented canonical onboarding adapter.
- Removed client-selected tenant hints from billing webhooks and public website payload processing.
- Added tenant-neutral service aliases for onboarding, number generation and effective legal projection.
- Removed unsafe number/sender fallbacks and Gridex-prefilled superadmin tenant configuration fields.
- Added fail-closed tenant capabilities, tenant-qualified relational constraints and all-tenant remediation SQL.
- Added architecture, runbook, focused tests and a static multi-tenant regression.
- Static/focused checks pass; full install/build/database/staging/all-repository evidence remains blocked and production is NO-GO.
# PHASE-38 locally verified work — 2026-08-02

- Fixed the three app and two test TypeScript failures without casts or non-null assertions.
- Upgraded Next/PostCSS/Sharp and verified zero high/critical production dependency findings.
- Repaired Ediel evidence v2 syntax, quarantine RLS, tenant-qualified relations, immutable attempts/evidence/attestations, server-derived evidence verification and matching-attempt projection guards.
- Added atomic `WEBSITE_APPLICATION_COMMITTED` audit/domain/outbox projection.
- Verified clean Node 22 install, all TypeScript targets, 417 tests, hardening regressions, migration integrity and full production build.
- Transaction-compiled both changed migrations against the connected development schema and confirmed rollback left no objects.

## 2026-08-04 — PHASE-42 canonical multitenant website application flow

- Unified tenant website readiness and enforced operation policy before intake.
- Completed fail-closed portal ownership, tenant portal URL and resumable application flow.
- Corrected exact status lineage and real job/email/webhook projection.
- Added terminal continuation safety in worker/database and durable webhook fan-out.
- Added canonical `customer_application.status_changed` and `supplier_switch.updated` events.
- Published immutable OpenAPI/docs `2026-08-04.1`.
- Added forward migration, safe ledger classifier, postflight and sync script.
- Verified migration/API/multitenant/onboarding/contract/market regressions and changed-file TypeScript syntax.
- Preserved honest pending state for database apply, deployment, full npm build and two-tenant E2E.

## 2026-08-05T15:14:58+02:00 — PHASE-44 customer legal package

- Grouped customer legal presentation into agreement, POA and withdrawal.
- Preserved exact canonical module acceptance evidence and tenant snapshots.
- Unified website and Customer Portal POA handling with fail-closed scope reuse.
- Published and verified additive API release 2026-08-05.1.

- 2026-08-05T15:20:07+02:00: Added pre-write rejection for duplicate/mixed grouped-vs-legacy legal acceptance payloads and stopped `power_of_attorney.signed` events unless the POA is actually persisted as a complete signed authorization.

## 2026-08-06T08:50:00Z — PHASE-45 OpenAPI / quote health

- Canonicalized top-level quote timestamptz hashing and nullable grid-area compares.
- Made local OpenAPI release verification fail closed for immutable artifacts/registry.
- Completed required quote and current-market-price OpenAPI examples for `2026-08-05.2`.
- Normalized application and metering-point grid/price area compares case-insensitively.
- Synchronized developer-guide contract examples to `2026-08-05.2`.
- Recorded findings in `quality/findings-2026-08-06-codebase-health.md`.

## 2026-08-14 — Post-go-live tip residuals on `580a`

Status: IMPLEMENTED_NOT_VERIFIED_IN_CI

- Ported `#127` UTILTS null-id / circuit / typegen residuals onto `2c5a8c0f`.
- Forward-fixed go-live `receipt_ready` binding via `20260814140000`.
