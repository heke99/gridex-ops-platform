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
Evidence: `npm run api:docs` passes at `2026-07-25.1`
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
