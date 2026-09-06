# Continuous work plan

Every work item requires targeted behavior tests plus relevant typecheck,
contract and build verification. Evidence must be recorded before `VERIFIED`.

## WP-000: Permanent project memory
Status: VERIFIED
Phase: PHASE-00
Priority: P0
Depends on: none
Affected domains: agent workflow
Acceptance criteria: required memory/rules exist; old current-task superseded; secret scan clean
Required verification: structure check and secret scan
Evidence: required structure and checkpoint JSON validated; secret scan clean
Files changed: `.agent-memory/**`, `.cursor/rules/**`, `AGENTS.md`, legacy current task
Migrations: none
Last updated: 2026-07-25
Exact next subtask: none

## WP-001: Repository and architecture inventory
Status: VERIFIED_FOR_RELEASE_SCOPE
Phase: PHASE-01
Priority: P0
Depends on: WP-000
Affected domains: all
Acceptance criteria: implementation/schema/API/test/runtime conflicts mapped
Required verification: source and executable inventory
Evidence: all enumerated P0/P1 runtime, schema, route and test paths inspected
Files changed: memory
Migrations: none
Last updated: 2026-07-25
Exact next subtask: continue remaining lifecycle phases after database gate

## WP-002: API and documentation parity
Status: VERIFIED
Phase: PHASE-02
Priority: P0
Depends on: WP-001
Affected domains: website API, customer portal API, docs
Acceptance criteria: runtime/OpenAPI/docs/scopes/errors/examples match
Required verification: API parity, contract and docs checks
Evidence: `npm run api:docs` passes at `2026-07-27.1`
Files changed: website/customer OpenAPI, developer page and integration guides
Migrations: none
Last updated: 2026-07-25
Exact next subtask: compare deployed contract after release

## WP-003: Tenant integration and API key
Status: PARTIAL
Phase: PHASE-03
Priority: P0
Depends on: WP-001
Affected domains: integration auth
Acceptance criteria: one API key resolves tenant/client/scopes/capabilities
Required verification: single-key and two-tenant regressions
Evidence: integration API access guard exists
Files changed: pending
Migrations: pending
Last updated: 2026-07-25
Exact next subtask: verify context and mandatory website scopes

## WP-004: Granular energy resolution
Status: VERIFIED
Phase: PHASE-04
Priority: P0
Depends on: WP-001
Affected domains: resolver, market price, quote, switch
Acceptance criteria: separate pricing/quote/facility/switch capabilities and blockers
Required verification: resolver/market tests, typecheck and API contract
Evidence: purpose-specific capability tests and API contract pass
Files changed: resolution binding, market/quote routes, OpenAPI/docs/tests
Migrations: none expected
Last updated: 2026-07-25
Exact next subtask: none

## WP-005: Elprisetjustnu and current market price
Status: VERIFIED
Phase: PHASE-05
Priority: P0
Depends on: WP-004
Affected domains: provider policy, ingestion, public API
Acceptance criteria: correct SE area/interval/freshness/provenance without PRODAT
Required verification: monthly/hourly/quarterly source and API tests
Evidence: selected/available resolution, exact source interval and fallback evidence tests pass
Files changed: current market price, source selection, docs/tests
Migrations: only if a proven schema gap exists
Last updated: 2026-07-25
Exact next subtask: provider-backed production smoke after deploy

## WP-006: Canonical quote and product pricing
Status: VERIFIED_FOR_P0_P1_SCOPE
Phase: PHASE-06
Priority: P0
Depends on: WP-004, WP-005
Affected domains: pricing, offers, quotes
Acceptance criteria: exact immutable offer/area/version/fees/VAT quote and pre-submit validation
Required verification: pricing/quote matrices
Evidence: quote request/validation closed schemas, unknown-field handling and tests pass
Files changed: quote loaders/routes/OpenAPI/tests
Migrations: pending
Last updated: 2026-07-25
Exact next subtask: staging provider/offer matrix

## WP-007: Customer identification and application
Status: VERIFIED_FOR_PUBLIC_DTO_SCOPE
Phase: PHASE-07
Priority: P0
Depends on: WP-006
Affected domains: intake, idempotency, duplicates
Acceptance criteria: one tenant-safe customer/application transaction and safe public DTO
Required verification: replay/concurrency/duplicate/two-tenant tests
Evidence: explicit response sanitizer and internal-ID regression pass
Files changed: public application DTO, route, OpenAPI and ID policy
Migrations: existing RPC requires runtime verification
Last updated: 2026-07-25
Exact next subtask: database concurrency/two-tenant E2E

## WP-008: Customer number and portal identity
Status: PARTIAL
Phase: PHASE-08
Priority: P0
Depends on: WP-007
Affected domains: customer identity, portal
Acceptance criteria: number assigned once and propagated everywhere
Required verification: generator, replay and propagation tests
Evidence: number migrations/tests exist
Files changed: pending
Migrations: pending
Last updated: 2026-07-25
Exact next subtask: verify events/invoices/portal propagation

## WP-009: Contract, legal, signature and POA
Status: PARTIAL
Phase: PHASE-09
Priority: P0
Depends on: WP-007
Affected domains: legal, documents, authorization
Acceptance criteria: immutable legal/signature/POA evidence and frozen PDF
Required verification: legal/POA/PDF tests
Evidence: structured POA and signature paths exist
Files changed: pending
Migrations: pending
Last updated: 2026-07-25
Exact next subtask: verify scopes, hashes and legal-bundle parity

## WP-010: Mail, documents, events and communication
Status: PARTIAL
Phase: PHASE-10
Priority: P0
Depends on: WP-007, WP-009
Affected domains: outbox, mail, webhooks, timeline
Acceptance criteria: post-commit idempotent effects and truthful delivery states
Required verification: communication source-of-truth and retry tests
Evidence: continuation/outbox flow exists
Files changed: pending
Migrations: pending
Last updated: 2026-07-25
Exact next subtask: verify provider mapping and event envelope

## WP-011: Facility and metering-point information
Status: PARTIAL
Phase: PHASE-11
Priority: P0
Depends on: WP-009
Affected domains: site, facility, metering
Acceptance criteria: durable request/response workflow resumes same journey
Required verification: facility and tenant tests
Evidence: facility workflows/regressions exist
Files changed: pending
Migrations: pending
Last updated: 2026-07-25
Exact next subtask: separate facility and pricing readiness

## WP-012: Supplier switch and EDIEL/PRODAT
Status: VERIFIED_FOR_PUBLIC_STATE_SCOPE
Phase: PHASE-12
Priority: P0
Depends on: WP-011
Affected domains: switch, EDIEL, routes
Acceptance criteria: creation/dispatch separate and ACK transitions idempotent
Required verification: switch matrix and EDIEL chain tests
Evidence: creation/dispatch separation tests and truthful docs pass
Files changed: portal status, public application DTO, docs/tests
Migrations: pending
Last updated: 2026-07-25
Exact next subtask: provider-backed dispatch matrix

## WP-013: Contract and supply activation
Status: IMPLEMENTED_STATIC_VERIFIED
Phase: PHASE-13
Priority: P0
Depends on: WP-012
Affected domains: switch, contract, supply, billing eligibility
Acceptance criteria: versioned idempotent atomic activation RPC and outbox
Required verification: DB atomicity and exactly-once events
Evidence: state machine calls one versioned RPC; static atomicity regression passes
Files changed: inbound state machine and activation regression
Migrations: `20260725120000_billing_readiness_and_supply_activation_v1.sql`
Last updated: 2026-07-25
Exact next subtask: apply and transaction-test migration in staging

## WP-014: Meter values
Status: PARTIAL
Phase: PHASE-14
Priority: P1
Depends on: WP-013
Affected domains: metering
Acceptance criteria: quality/version/source/timezone/DST-safe values
Required verification: hourly/quarterly/DST/correction tests
Evidence: metering tests exist
Files changed: pending
Migrations: pending
Last updated: 2026-07-25
Exact next subtask: map ingestion and correction versioning

## WP-015: Settlement
Status: PARTIAL
Phase: PHASE-15
Priority: P0
Depends on: WP-014
Affected domains: pricing, settlement
Acceptance criteria: locked settlement uses correct contract resolution
Required verification: resolution/DST/gap tests
Evidence: hourly contracts reject quarter-hour spot and quarterly contracts require it
Files changed: interval pricing/source selection/tests
Migrations: pending
Last updated: 2026-07-25
Exact next subtask: run DST/gap/provider-backed settlement matrix

## WP-016: Billing underlay
Status: IMPLEMENTED_STATIC_VERIFIED
Phase: PHASE-16
Priority: P0
Depends on: WP-015
Affected domains: end-customer billing
Acceptance criteria: real config, locked idempotent underlay and corrections
Required verification: readiness and duplicate tests
Evidence: data-backed readiness tests pass; immutable snapshot migration is static-verified
Files changed: billing readiness/invoice readiness/tests
Migrations: `20260725120000_billing_readiness_and_supply_activation_v1.sql`
Last updated: 2026-07-25
Exact next subtask: apply migration and exercise real tenant profiles

## WP-017: Invoice export and API
Status: VERIFIED_FOR_PUBLIC_RESOURCE_SCOPE
Phase: PHASE-17
Priority: P0
Depends on: WP-016
Affected domains: invoices, provider export, portal API
Acceptance criteria: exactly-once export and list/detail DTO parity
Required verification: export key, timeout and list/detail tests
Evidence: list/detail load only `customer_invoices`; regression passes
Files changed: portal invoice loaders/routes/tests/docs
Migrations: pending
Last updated: 2026-07-25
Exact next subtask: provider export exactly-once E2E

## WP-018: Payment and reconciliation
Status: PARTIAL
Phase: PHASE-18
Priority: P0
Depends on: WP-017
Affected domains: payments, webhooks
Acceptance criteria: replay-safe provider events and canonical reconciliation
Required verification: full/partial/over/credit/reversal tests
Evidence: canonical `invoice.paid` emitted from provider state; remaining payment matrix pending
Files changed: provider event processor and event docs
Migrations: pending
Last updated: 2026-07-25
Exact next subtask: full/partial/over/credit/reversal provider tests

## WP-019: Customer portal and timeline
Status: PARTIAL
Phase: PHASE-19
Priority: P1
Depends on: WP-010, WP-018
Affected domains: portal projections
Acceptance criteria: canonical read projection and event-derived timeline
Required verification: tenant and projection consistency tests
Evidence: customer portal modules exist
Files changed: pending
Migrations: pending
Last updated: 2026-07-25
Exact next subtask: inspect timeline source after invoice correction

## WP-020: Move, termination and final invoice
Status: NOT_STARTED
Phase: PHASE-20
Priority: P1
Depends on: WP-018
Affected domains: lifecycle termination
Acceptance criteria: durable end flow through final invoice/refund
Required verification: move/termination/final-invoice E2E
Evidence: not inventoried
Files changed: pending
Migrations: pending
Last updated: 2026-07-25
Exact next subtask: inventory termination flows

## WP-021: Security, tenancy and RLS
Status: PARTIAL
Phase: PHASE-21
Priority: P0
Depends on: all domain items
Affected domains: all
Acceptance criteria: tenant-safe relations/RLS/service-role and external DTOs
Required verification: security audit and two-tenant matrix
Evidence: guards exist; full coverage unverified
Files changed: pending
Migrations: pending
Last updated: 2026-07-25
Exact next subtask: build lifecycle tenant coverage matrix

## WP-022: Migrations and data integrity
Status: BLOCKED_BY_ENVIRONMENT
Phase: PHASE-22
Priority: P0
Depends on: schema-changing items
Affected domains: database
Acceptance criteria: intact forward history and pre/postflight/backfill/recovery
Required verification: migration checker and real database apply
Evidence: 299 files/204 groups/checksums pass; no Supabase runtime available
Files changed: migration manifest and forward migration
Migrations: one new forward migration
Last updated: 2026-07-25
Exact next subtask: staging apply/rollback/replay/isolation verification

## WP-023: Behavior tests and E2E
Status: PARTIAL
Phase: PHASE-23
Priority: P0
Depends on: WP-004 through WP-022
Affected domains: all
Acceptance criteria: required matrices and tenant-to-paid-invoice E2E pass
Required verification: full suite and database E2E
Evidence: 53 files/346 tests green; database E2E remains blocked
Files changed: nine P0/P1 regression files
Migrations: none
Last updated: 2026-07-25
Exact next subtask: database transaction and provider E2E

## WP-024: Documentation and release verification
Status: VERIFIED_LOCALLY_PENDING_DEPLOY
Phase: PHASE-24
Priority: P0
Depends on: all items
Affected domains: docs, release
Acceptance criteria: full runtime/OpenAPI/docs parity and definition of done
Required verification: typecheck, lint, tests, API checks, build, E2E and secret scan
Evidence: typecheck/tests/API/migrations/lint/build green
Files changed: changelog, public guides, developer page, OpenAPI and memory
Migrations: none
Last updated: 2026-07-25
Exact next subtask: deploy and compare live contracts

## WP-025: Contract and tenant lifecycle completion
Status: IMPLEMENTED_STATIC_VERIFIED
Phase: PHASE-25
Priority: P0
Depends on: WP-021
Affected domains: contract close, tenant lifecycle, integration API
Acceptance criteria: terminal close, readiness-gated tenant activation and fail-closed API
Required verification: database transaction/replay/isolation
Evidence: typecheck, full tests, dedicated regression and build pass
Files changed: lifecycle migration, governance, admin actions/UI, API docs
Migrations: `20260726010000_contract_tenant_lifecycle_completion.sql`
Last updated: 2026-07-26
Exact next subtask: apply and transaction-test in staging

## WP-026: Canonical contract deletion graph
Status: IMPLEMENTED_STATIC_VERIFIED
Phase: PHASE-26
Priority: P0
Depends on: WP-025
Affected domains: contract preview/delete/bulk, admin UI, error evidence
Acceptance criteria: one dependency model; draft-only delete; isolated bulk; terminal pagination
Required verification: PostgreSQL apply plus quote/backfill/FK/two-tenant scenarios
Evidence: SQL parser, checksum, typecheck, 354 tests, targeted regressions and build pass
Files changed: append-only migration, contract actions/UI/db/types/errors, tests/docs
Migrations: `20260726140000_contract_deletion_graph_completion.sql`
Last updated: 2026-07-26
Exact next subtask: apply migration and run post-apply plus transactional staging matrix

## WP-027: Contract/admin/API alignment
Status: IMPLEMENTED_STATIC_VERIFIED
Phase: PHASE-27
Priority: P0
Depends on: WP-026
Affected domains: tenant lifecycle, delete security, company admin, external API docs
Acceptance criteria: qualified final lifecycle; service-only preview; tenant-preserving navigation; distinct contract counts; runtime error parity
Required verification: PostgreSQL apply/privilege test plus authenticated API smoke
Evidence: typecheck, 354 tests, API docs, 303 migrations, targeted regressions, lint and build pass
Files changed: forward migration, DB test, admin actions/UI/governance, OpenAPI/guides/tests/memory
Migrations: `20260726230000_contract_admin_api_alignment.sql`
Last updated: 2026-07-26
Exact next subtask: apply migration and verify tenant-close/preview privileges in staging

## WP-028: Complete contract-flow integrity
Status: IMPLEMENTED_STATIC_VERIFIED
Phase: PHASE-28
Priority: P0
Depends on: WP-027
Affected domains: contract admin, tenant scope, customer identity, supply, billing, invoice export, portal, API documentation
Acceptance criteria: stable list; strict tenant and role handling; safe legal matching; confirmed-only activation; exact underlay identities; one canonical export item and deterministic invoice mirror
Required verification: typecheck, lint, production build, API/OpenAPI parity, migration integrity, focused regressions, PostgreSQL apply and provider round trip
Evidence: typecheck/lint/build/API/migration checks pass; focused regressions preserve five intentional readiness failures from identity-incomplete legacy fixtures
Files changed: runtime/UI, one append-only migration, OpenAPI, deployment guide and delivery report
Migrations: `20260727010000_contract_flow_integrity_completion.sql`
Last updated: 2026-07-27
Exact next subtask: apply the pending migrations in staging and transaction-test the two-tenant and provider flow

## WP-029: Synchronize exported live schema with runtime
Status: READY_FOR_CONTROLLED_APPLY
Phase: PHASE-29
Priority: P0
Depends on: WP-028
Affected domains: migrations, active PostgreSQL functions, canonical contract graph, onboarding, legal, signature, invoice/provider, EDIEL, metering, RBAC, OpenAPI
Acceptance criteria: every exported live lint failure covered; every exact patch matches; runtime table/column/RPC paths exist in live plus repair; one fail-closed forward migration; preflight and postflight; full build/tests
Required verification: authorized production preflight/apply/post-apply, live lint, post-schema export, two-tenant and provider smoke tests
Evidence: 41/41 exact patches, 23/23 lint errors, 4,759 writes, 3,679 field accesses, 120 RPC calls, 357 tests, typecheck, API docs, 319/223 migration integrity, SQL parse and production build
Files changed: 57 source/test/doc/migration files plus report/runbook and memory
Migrations: `20260728170000_live_schema_code_canonical_sync.sql`
Last updated: 2026-07-28
Exact next subtask: execute `GRIDEX_LIVE_REPAIR_RUNBOOK_2026-07-28.md` with an authorized operator, then create a canonical baseline from the verified post-apply export

## WP-030: Canonical contract-channel permission and publication
Status: BLOCKED_PENDING_DATABASE_PROOF
Phase: PHASE-30
Priority: P0
Depends on: WP-029
Affected domains: contract grants, channel publication, admin UI, external DTO, API/OpenAPI, migration integrity
Acceptance criteria: strict grants/status/availability; one service; fail-closed RPC; shared DTO; immutable history; final schema and scenarios A-H green
Required verification: green migration integrity, PostgreSQL apply/introspection, concurrency, two-tenant, website/API endpoint scenarios A-H
Evidence: 43 dedicated controls, 212 go-live controls, 518 lifecycle controls, 361 tests, TypeScript, API docs, lint and build pass locally
Files changed: canonical SQL/view/functions, server service/actions/UI, public DTO/routes, OpenAPI/docs, tests/scripts/memory
Migrations: `20260728190000_contract_channel_permission_publication_completion.sql`
Last updated: 2026-07-28
Exact next subtask: restore immutable `20260728170000...`, require green migration check, apply `20260728190000...` in staging and run post-apply plus scenarios A-H

## WP-031: Canonical commercial option/component selection
Status: IMPLEMENTED_STATIC_VERIFIED_DATABASE_BLOCKED
Phase: PHASE-31
Priority: P0
Depends on: WP-030
Affected domains: admin contracts, internal customer contracts, public API, quote, immutable snapshots, billing, migrations
Acceptance criteria: one type-driven option/component model; server-owned selection; exact quote/contract/billing parity; stable references; forward-only tenant-safe schema
Required verification: clean/upgraded PostgreSQL apply, post-apply, two-tenant/concurrency, internal and website quote-to-invoice scenarios
Evidence: TypeScript/lint pass; 365 tests; API docs `2026-07-30.1`; focused regression; production build
Files changed: admin editors/actions, commercial resolver/calculator, quote/onboarding/internal customer/billing, OpenAPI/docs/tests/scripts/memory
Migrations: `20260729200000_contract_commercial_selection_completion.sql`
Last updated: 2026-07-29
Exact next subtask: restore immutable `20260728170000...`, apply through `20260729200000...` in staging and run both post-apply suites plus option/component/invoice parity scenarios

## WP-034: Customer Portal/API production completion
Status: IMPLEMENTED_STATIC_VERIFIED_DATABASE_BLOCKED
Phase: PHASE-34
Priority: P0
Depends on: WP-031
Affected domains: customer sync, portal DTOs, move-out, quote onboarding, OpenAPI release
Acceptance criteria: one strict sync contract; no internal public IDs; paginated fail-closed portal; atomic external-reference move-out; exact runtime/OpenAPI/release parity
Required verification: clean/upgraded PostgreSQL apply, two-tenant isolation, move-out replay/concurrency, deployment and exact live hashes
Evidence: all TypeScript targets, 58 files/373 tests, API docs/parity/compatibility/release, 324/228 migration integrity, zero-error lint and production build pass
Files changed: customer API routes/services/DTOs, website intake/publication DTOs, OpenAPI/docs/tests/scripts/memory
Migrations: `20260730153000_customer_portal_api_production_completion.sql`
Last updated: 2026-07-30
Exact next subtask: resolve duplicate migration provenance, apply through `20260730153000` on clean and upgraded Node 22 staging, deploy and run the full environment matrix

## WP-035: Canonical price-option and website API completion
Status: IMPLEMENTED_STATIC_VERIFIED_DATABASE_BLOCKED
Phase: PHASE-35
Priority: P0
Depends on: WP-034
Affected domains: contract publication, price options, quote, application, legal, OpenAPI release
Acceptance criteria: publication-bound canonical options; exact default/selection policy; top-level public price options; immutable commercial assertion chain; strict runtime/OpenAPI/docs parity
Required verification: clean/upgraded PostgreSQL apply, post-apply, two-tenant isolation, quote/application replay and concurrency, deployment and exact live hashes
Evidence: all TypeScript targets, 58 files/376 tests, API docs/parity/compatibility/release, 325/229 migration integrity, zero-error lint and production build pass
Files changed: contract admin/runtime/DTOs, quote/application/legal flow, OpenAPI/docs/tests/scripts/memory
Migrations: `20260730220000_canonical_price_option_publication_api_completion.sql`
Last updated: 2026-07-30
Exact next subtask: resolve duplicate migration provenance, apply through `20260730220000` on clean and upgraded Node 22 staging, run the post-apply, deploy and run the full environment matrix

## WP-036: Public Contracts runtime/OpenAPI/legal parity
Status: IMPLEMENTED_NOT_ENVIRONMENT_VERIFIED
Phase: PHASE-36
Priority: P0
Depends on: WP-035
Affected domains: database, publication snapshots, Public Contracts, legal, price options, OpenAPI, release manifest, developer documentation
Acceptance criteria: one strict Website/API model; canonical `is_default`; identical deprecated alias; exact legal bundle identity; route response validates against served OpenAPI; version/checksum/docs parity
Required verification: full Node 22 dependency gates, clean/upgrade PostgreSQL apply, dry-run/apply/idempotency backfill, deployed served-byte and two-tenant staging proof
Evidence: static API/docs/release/migration checks, focused domain regressions, changed-file syntax and isolated core strict typecheck pass at `2026-08-01.1`
Files changed: canonical serializers, Website/API routes/sources, OpenAPI finalizer/artifacts, release manifest, docs page, fixtures, tests and migration
Migrations: `20260801003000_public_contract_runtime_openapi_legal_parity.sql`
Last updated: 2026-08-01
Exact next subtask: restore trusted `20260730220000...` bytes, run full dependency gates, then apply and staging-verify PHASE-36

## WP-037: Canonical multi-tenant platform hardening
Status: IMPLEMENTED_STATIC_VERIFIED_ENVIRONMENT_BLOCKED
Phase: PHASE-37
Priority: P0
Depends on: WP-036
Affected domains: tenant context, integration API, customer intake, provider webhooks, legal/number configuration, database constraints, RLS readiness, backfill, documentation
Acceptance criteria: server-derived tenant context; no fallback tenant; shared onboarding; tenant-qualified DB relations; fail-closed capabilities; all-tenant remediation; full multi-repository and three-tenant proof
Required verification: clean/full Node gates, migration integrity, clean/upgrade PostgreSQL apply, RLS/RBAC, backfill, constraints, idempotency/concurrency/workers/E2E, all external repositories
Evidence: canonical static regression and focused legacy regressions pass; changed TS syntax and isolated context strict typecheck pass; migration checksum registered
Files changed: tenant context/capabilities, API auth/routes, onboarding adapters, webhook/mail/number/legal runtime, migration, remediation scripts, tests and docs
Migrations: `20260801143000_canonical_multitenant_platform_hardening.sql`
Last updated: 2026-08-01
Exact next subtask: reconcile migration history, restore dependency installation, apply in staging, run all-tenant database/E2E evidence and synchronize external repositories

## WP-038: Canonical production hardening and Ediel evidence v2
Status: LOCALLY_VERIFIED_DATABASE_BLOCKED
Phase: PHASE-38
Priority: P0
Depends on: WP-037
Affected domains: migration ledger, Ediel evidence, RLS, tenant relations, manual attestation, website workflow events, dependency security, build
Acceptance criteria: server-derived immutable evidence; exact tenant/run/snapshot correlation; no GUC-only pass; atomic website commit event; clean Node 22 gates; controlled staging apply and two-tenant proof
Required verification: exact A–C schema/ledger comparison, isolated D–F upgrade, quarantine review, constraint validation, JWT/service-role RLS, evidence-chain and concurrency tests, deployment/cross-repository parity
Evidence: migrations transaction-compile with confirmed rollback; clean Node 22 install; all TypeScript targets; 62/62 files and 417/417 tests; 336 migration files/240 groups; hardening regressions; 0 high/critical audit; full Next.js build
Files changed: evidence/event migrations, Ediel actions/engine, tests/regressions, dependency locks, migration manifest and memory
Migrations: `20260802013000_ediel_test_evidence_v2.sql`, `20260802160000_website_application_committed_canonical_event.sql`
Last updated: 2026-08-02
Exact next subtask: reconcile exact A–C definitions with the remote ledger before controlled staging apply of D–F and the website event migration

## WP-039: Canonical security convergence and guarded synchronization
Status: LOCALLY_VERIFIED_DATABASE_BLOCKED
Phase: PHASE-39
Priority: P0
Depends on: WP-038
Affected domains: canonical RPC boundaries, actor authorization, invitations, idempotency, Ediel profiles/readiness, RLS/grants, staging synchronization
Acceptance criteria: one actor-authenticated canonical write boundary; payload-bound idempotency; verified access invitation; no temporary credentials; fail-closed roles/tenants; least privilege; guarded forward-only staging apply
Required verification: exact A-C catalog parity, deterministic preflight cleanup, isolated staging apply, real JWT/service-role denial, idempotency collision, concurrency, worker pause and external transport E2E
Evidence: PostgreSQL parser; all TypeScript targets; 62 files/417 tests; 337 migration files/241 groups; canonical, tenant and RBAC regressions; zero-vulnerability audit; full Node 22 build
Files changed: company/auth/Ediel admin runtime, canonical production approval/testing helpers, RBAC and hardening regressions, registered migration, reports/runbooks, guarded sync script and memory
Migrations: `20260802170000_canonical_security_convergence.sql`
Last updated: 2026-08-02
Exact next subtask: finish exact A-C catalog diff and deterministically resolve all preflight blockers before guarded ledger repair and isolated-staging apply

## WP-040: V2 emergency access lockdown and release triage
Status: LOCALLY_VERIFIED_AWAITING_EXPLICIT_APPLY_APPROVAL
Phase: PHASE-40
Priority: P0
Depends on: WP-039
Affected domains: default privileges, readiness views, SECURITY DEFINER execution, internal system tables, global platform roles, Supabase advisors, release evidence
Acceptance criteria: emergency access migration applied without runtime regression; postflight and advisors prove least privilege; global platform roles are tenant-null only; no remote claim without real JWT/service-role evidence
Required verification: exact migration checksum, static regression, migration integrity, controlled Supabase apply, catalog postflight, advisors, real-role/JWT runtime smoke tests and rollback/forward-fix decision
Evidence: remote read-only catalog/advisor/data inventory; local emergency-access regression; 339 migration files/243 version groups; 24-check RBAC audit; GitHub repository/head orientation
Files changed: registered emergency-lockdown migration, static regression, package script, read-only postflight, hardening reports and agent memory
Migrations: `20260802190000_canonical_emergency_access_lockdown.sql`
Last updated: 2026-08-02
Exact next subtask: obtain explicit blast-radius approval, then apply only `20260802190000` and execute immediate postflight/advisor/JWT verification


## WP-041: Runtime schema readiness v4 and API availability
Status: DATABASE_VERIFIED_READY_FOR_APP_DEPLOY
Phase: PHASE-41
Priority: P0
Depends on: WP-036, WP-040
Affected domains: external API availability, runtime capability gate, migration governance, canonical manifest, portfolio migration provenance, OpenAPI deployment
Acceptance criteria: compatible additive schema changes do not create 503; missing required capabilities fail closed; all ledger mappings/effects are explicit; live readiness sources agree; authenticated public endpoints return 200 after deploy
Required verification: live Supabase runtime/governance/canonical/state queries; idempotent post-apply; Node 22 typechecks/tests/build; deployed authenticated context/public-contract smoke; Web OpenAPI sync
Evidence: v4 migration applied as 20260803212754; all four live readiness sources true; migration/API/OpenAPI/runtime parity and tenant/idempotency/portal regressions pass
Files changed: runtime readiness service/test, portfolio migration versions/references, v4 migration/post-apply, migration manifest, release report and project memory
Migrations: `20260803212754_canonical_migration_readiness_reconciliation_v4.sql`
Last updated: 2026-08-03
Exact next subtask: deploy the OPS application code and run authenticated HTTP smoke tests, then synchronize Gridex Web OpenAPI 2026-08-03.1

## WP-044: Three-document legal package and POA consistency
Status: IMPLEMENTED_STATIC_VERIFIED_DEPLOYMENT_PENDING
Phase: PHASE-44
Priority: P0
Depends on: WP-034, WP-036, WP-037
Affected domains: legal bundles, website intake, Customer Portal sync, POA, supplier switch, OpenAPI
Acceptance criteria: at most three customer documents; exact module evidence; immutable tenant identity; no POA scope widening; unchanged endpoint structure; legacy module compatibility
Required verification: clean Node gates, deployed private/business two-tenant acceptance and supplier-switch E2E
Evidence: dedicated regressions, API/OpenAPI release gates and changed-file syntax pass at 2026-08-05.1
Files changed: legal package/rendering, public contracts, website intake, Customer Portal sync, POA chain, OpenAPI/docs/tests/memory
Migrations: none
Last updated: 2026-08-05
Exact next subtask: deploy and prove one private plus one business tenant legal/POA/supplier-switch flow

## WP-045: Complete OpenAPI 2026-08-05.2 health package
Status: IMPLEMENTED_STATIC_VERIFIED_DEPLOYMENT_PENDING
Phase: PHASE-45
Priority: P0
Depends on: WP-044
Affected domains: website quotes, OpenAPI release verify, market-price examples, application/metering-point energy context
Acceptance criteria: quote timestamptz hash stable across PostgREST/JS; nullable grid-area compares fail-closed; immutable release verify fail-closed; required OpenAPI examples complete; case-insensitive area compares in application/metering-point paths
Required verification: quote/OpenAPI regressions, documentation example/version/compatibility/runtime gates; live quote create/validate after deploy
Evidence: local quote/OpenAPI/application regressions and release verify pass on branch cursor/codebase-health-and-stability-ec6b
Files changed: quoteIntegrity/websiteQuotes, meteringPointContext, customerApplications, OpenAPI current+release, finalize/verify/docs/regressions, quality findings, agent memory
Migrations: none
Last updated: 2026-08-06
Exact next subtask: merge one health branch, deploy OPS, run live quote create/validate smoke


## Active checkpoint 2026-09-05 — supersedes earlier status claims

IN_PROGRESS; no masterplan phase is complete. Publication is authorized and
PR #310 is open as draft. Head 2568c28f has passing verify/quality jobs and a
failing canonical replay completeness gate (OPS run 33971545934). This is a real
repository remediation task, not an external permission blocker.

Forward migration 20260905141608 restores seven tenant relationship triggers
while preserving the newer snapshot function. Isolated PGlite 0.3.14 tests pass
18 reference cases under authenticated/service_role, twice; live read-only
catalog assertion also passes. These tests do not establish full RLS isolation
or canonical replay provenance. Integrity and production-readiness pass for
586 files; generated-types check correctly fails the new migration tail. Do not
update the types manifest without actual authoritative generation.

Two exact reviewed read-only diagnostic inputs receive an explicit classification.
The plan still has 56 unclassified files and 32 unresolved substitutions.
Next: finish reviewed effect reconstruction and parity semantic checks, then
obtain authoritative replay/type/schema artifacts and compare both ways with
production. No production mutation has occurred in the 2026-09-05 campaign.


## Active checkpoint 2026-09-06 — supersedes previous progress

IN_PROGRESS. No phase closed. PR #310 published head 0a0f4068 has passing quality
gates and isolated reconstruction/parity SQL tests; verify fails generated-types
tail, and clean replay fails completeness (OPS 33988318141). These are required
internal remediation gates, not external permission blockers.

Next reviewed batch restores eleven invitation columns and corresponding role/FK/
unique-index effects through forward migration 20260906081839. Isolated tests
pass 18 assertions and two invalid-data rollback scenarios; the historical
regression table is frozen separately so canonical artifact refresh cannot erase
the failing baseline. Full RLS/RPC/provider E2E is not established.

Portal/API-origin source 20260609150000 is now preserved after its early bootstrap
at its original timestamp. Whole-source selection failed before the fix; actual
SQL now runs twice in an isolated fixture, preserving existing explicit origins
and valid identities, restoring match_strength=manual (read-only live default),
and verifying indexes. Other historical substitutions remain blocking.

Integrity/readiness pass for 587 files. Types still fail the new migration tail;
no manual hash or schema baseline edits. Complete historical effect review, then
run authoritative full replay, generate types/schema and verify ledger/live parity.
No production mutation performed in this batch.

## Published verification checkpoint — 2026-09-06

Code revision 8344cbb84eb6691bf7507bcc9c6580565bc6a114 is published on draft
PR #310. OPS run 34035865807 finished: quality-release-gates PASS; all isolated
reconstruction/parity SQL fixtures PASS; verify FAIL at the new generated-types
migration tail; clean replay FAIL at completeness. Later verify steps skipped
after the type gate are not certified. No phase closed and no production writes.

Next: complete the bounded Ediel environment source review, then test its complete
SQL with actual prerequisite ordering and successor hardening on PostgreSQL 17
before changing either source-suppression declaration. Full historical accounting,
authoritative schema/types generation and ledger/live comparison remain required.

Ediel next step: isolated PostgreSQL 17 CI fixture implemented; SQL composition
and diff checks pass, execution pending. Both source suppressions remain unchanged.
Inspect ediel-source-effects job before changing selection. No phase closed.

## Ediel source restoration — 2026-09-06

PostgreSQL 17 job 101502920151 in OPS run 34039266103 passed on published
revision d6967d21c4f7985c0f2a452ddaf8ae0cef8b3c60. Complete original source and
successor ran twice, including pgcrypto; synthetic backfill/history, uniqueness,
FK/column/RLS and non-owner policy assertions passed. This is isolated source
evidence, not canonical provenance or production parity.

Both bootstrap declarations now preserve source 20260602143000 at its original
timestamp. Selection regression failed SUBSTITUTED before the fix, passed after,
and rejects either declaration reverting independently. Accounting selftest now
passes 29 tests. Inventory integrity/readiness pass (587 files). Accounting now
498 FULL_FILE_SELECTED, 30 unresolved SUBSTITUTED, 4 exclusions, 55 UNCLASSIFIED;
full-effects gate correctly remains exit 1. Original SQL/checksums are unchanged.

Next: inspect CI for the restoration revision, then review the remaining source
substitutions and unclassified SQL. Authoritative canonical replay, schema/types
regeneration and bidirectional ledger/live parity remain open. No phase closed.

## Customer-flow source batch — 2026-09-06

Ediel restoration revision 69d51ee2c80a9a6221e871cc47027af66a02d125 has passing
PostgreSQL17 source-effects job 101503578599 (OPS run 34039506238). Its global
verify/types and replay/completeness gates remain red; quality is still running.
The next customer-flow source batch restores full pre-ledger selection after
its actual table prerequisites. Complete SQL runs twice in PGlite, preserving
existing values; source selection was red before and green after. Static
provenance, integrity and 29 accounting tests pass. Hosted SQL verification is
pending publication. Accounting: 499 full selected, 29 partial, 55 unknown,
4 exclusions. No phase closed or production mutation. Continue remaining source
reviews, then authoritative canonical regeneration and live/ledger parity.

## Actor-testing source batch — 2026-09-06

Customer-flow revision a201d3f2c60f9b9ad845f47f7137e4d8b0e7f9b1 has passing
hosted complete-source SQL/selection in verify job 101504319679 (OPS 34039783462).
Ediel PG17 job 101504319838 also passes. Verify subsequently fails generated
types tail; replay fails completeness. Neither is an external permission blocker.

The previously unclassified actor-testing source is now selected after its four
table prerequisites. Actual complete SQL runs twice in PGlite, validates five
index definitions and preserves evidence/messages. Selection red UNCLASSIFIED
before, green after; 29 accounting tests, static provenance and integrity pass.
Hosted actor-source test pending publication. Counts now 500 full, 29 partial,
54 unknown, 4 exclusions. Continue remaining historical source reviews; complete
canonical generation and ledger/live parity before closing any phase.

## Verified code-head checkpoint — 2026-09-06

Published code head 29dc94974825b329b9b822c2219b077d8679bb33, draft PR #310.
OPS run 34039976860: Ediel PostgreSQL 17 job 101504839380 PASS. Verify job
101504839441 passes all isolated SQL fixtures, including complete customer-flow
and actor-testing sources, then FAILS generated-types tail 20260906081839.
Clean replay job 101504839286 FAILS; complete input accounting remains unresolved.
Quality job 101504839408 is still running and is not certified. PR body records
these exact code-head results. No phase closed, production writes or manual
canonical/type hash changes. Next: inspect quality result and continue remaining
29 partial/54 unclassified sources; full authoritative replay/ledger/live parity
is still required. These are internal remediation items, not permission blockers.

## Billing completion source — 2026-09-06

Previous code-head 29dc9497 quality-release-gates is now PASS (OPS 34039976860).
Full source 20260520_batch_3_4_final_completion.sql now selected after the real
billing_export_run_id prerequisite. Isolated complete SQL passes twice with four
exact index definitions and unchanged rows in five tables. Wrong prerequisite
order is demonstrably rejected. Selection was UNCLASSIFIED before, full after.
29 accounting tests, static provenance, integrity pass. Hosted test pending.
Counts: 501 full selected, 29 partial, 53 unknown, 4 exclusions. No phase closed.
Next: verify published CI, then review status-check broad constraint removal and
profile-normalization trigger effects; do not blindly restore these sources.
Authoritative replay/schema/types/ledger/live parity remain required.

## Request-status continuation — 2026-09-06

Published billing code head a4063e3896ccefc487a2c39825c74462c444c9a2 passes full
billing SQL/selection in job 101545606099, OPS run 34055141338; verify subsequently
fails generated-types tail. Ediel PG17 passes; complete replay remains red.

Request status source 20260521_final_customer_info_request_status_check.sql is
now selected immediately after its first table definition. That reviewed boundary
has only the intended status CHECK; no earlier selected foundation references
the table. Full source passes twice with 19 exact states, unchanged rows/PK/FKs,
and atomic rejection of invalid existing data. Selection red before, green after.
29 accounting tests and static provenance pass; hosted status test pending.
Counts: 502 full selected, 29 partial, 52 unknown, 4 exclusions. Continue profile
normalization trigger/dependency review and remaining history, then authoritative
canonical replay/schema/types and ledger/live parity. No phase or merge approval.
