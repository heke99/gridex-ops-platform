# Behavioral Requirements — Gridex OPS external integration remediation

Version: v1.0
Generated: 2026-08-10
Pipeline: focused contract extraction with narrative pass

## Project overview

Gridex OPS is a multi-tenant energy operations platform. Tenant integration developers authenticate with an API key, bootstrap through integration context, access customer and commercial resources, submit controlled writes, and optionally consume signed webhooks. Customer Portal users traverse their own contracts, facilities, invoices, metering, documents, legal evidence and events. Gridex operators provision tenants, monitor readiness and release contract versions without exposing internal database structure.

The external request path resolves authentication and tenant state, applies scope and quota policy, performs a tenant-bound domain query or mutation, maps internal rows to a versioned public DTO, validates the output and emits a canonical envelope. Durable idempotency protects writes; per-subscription signatures and durable deliveries protect asynchronous events. The repository migration ledger must reconstruct the same functions and data constraints as connected environments.

The design philosophy is fail-closed and contract-first. Internal primary keys never authorize or identify public resources. Empty data is a business result, not a fallback for infrastructure failure. Database migrations may evolve storage while V1 DTOs remain stable. Release evidence is environment-specific: passing against connected dev is useful evidence but is never described as production verification.

## Use cases

### UC-01: Traverse a long portal resource history

**Actor:** Tenant API client. **Preconditions:** Valid granular read scope and more than 1,000 eligible rows. **Steps:** request first page; retain opaque cursor; request each next page; stop when has_more is false. **Postconditions:** every eligible row appears once in deterministic order. **Alternatives:** malformed or cross-resource cursor is rejected; schema failure returns 503. **Requirements:** REQ-002, REQ-004, REQ-008, REQ-011.

### UC-02: Open an old invoice

**Actor:** Customer Portal user. **Preconditions:** A canonical invoice reference belonging to the resolved customer. **Steps:** call detail endpoint; server resolves tenant/customer from auth; perform indexed reference lookup; map/validate DTO. **Postconditions:** exact invoice is returned. **Alternatives:** another tenant and an unknown reference both receive neutral 404. **Requirements:** REQ-001, REQ-003, REQ-008.

### UC-03: Retry an external write

**Actor:** Tenant API client. **Preconditions:** Valid write scope and Idempotency-Key. **Steps:** canonicalize body; claim lifecycle; execute mutation and critical audit; store response; retry same request. **Postconditions:** retry replays exact response with no second mutation. **Alternatives:** changed body returns conflict; another tenant may reuse the key independently. **Requirements:** REQ-005, REQ-008, REQ-011.

### UC-04: Bootstrap a tenant integration

**Actor:** Newly provisioned tenant developer. **Preconditions:** One-time token has been exchanged for a server-side API key. **Steps:** call integration context; read public tenant/client references, contract links, auth model, capabilities and readiness; generate/use client; perform smoke read. **Postconditions:** developer needs no Gridex database identifiers. **Alternatives:** incomplete readiness returns structured blockers. **Requirements:** REQ-006, REQ-007, REQ-008, REQ-011.

### UC-05: Resolve a portal customer

**Actor:** Portal backend. **Preconditions:** Authenticated tenant context and supplied identity signals. **Steps:** call canonical resolver; evaluate strong/weak/manual policy; reject ambiguity; return minimal public state. **Postconditions:** identity is tenant-bound and is not authorization by itself. **Alternatives:** ambiguous or weak-only result follows explicit manual path. **Requirements:** REQ-008.

### UC-06: Receive and verify a webhook

**Actor:** Tenant webhook consumer. **Preconditions:** Active subscription with unique secret version. **Steps:** receive registered event payload, timestamp and delivery reference; verify signature; process idempotently. **Postconditions:** retry is safe and tenant-local. **Alternatives:** previous secret verifies only during bounded rotation; other tenant secret and unknown event fail. **Requirements:** REQ-010, REQ-011.

### UC-07: Publish an API contract release

**Actor:** Gridex release engineer. **Preconditions:** Canonical registry and fixtures updated. **Steps:** generate OpenAPI/docs/examples/types; run parity and runtime response gates; materialize immutable release; run CI. **Postconditions:** versioned bytes and manifest agree. **Alternatives:** malformed identifier, schema drift or stale version blocks release. **Requirements:** REQ-001, REQ-006, REQ-011, REQ-012.

### UC-08: Reconstruct an environment

**Actor:** Gridex operator. **Preconditions:** Empty database and repository source. **Steps:** replay migrations; compare official ledger/catalog; run isolation and readiness probes; apply only forward fixes. **Postconditions:** repository can reconstruct verified dev capabilities. **Alternatives:** production remains unverified until its own catalog and deployment SHA are connected. **Requirements:** REQ-008, REQ-011, REQ-012.

## Cross-cutting concerns

Tenant identity, authorization and lookup predicates are repeated at every boundary; a public reference is a locator, never authorization (REQ-001, REQ-003, REQ-007, REQ-008). Errors preserve privacy and operational truth: missing credentials, insufficient authority, missing resources, conflicts, validation, quota and infrastructure failure have distinct stable semantics (REQ-004, REQ-006).

Concurrency is controlled through atomic database functions and durable state rather than process memory (REQ-005, REQ-008, REQ-010). Backward compatibility lives in public DTO/schema versions, a shared compatibility classification and explicit deprecation metadata (REQ-001, REQ-006). Migration and release provenance are append-only and environment-specific (REQ-011, REQ-012).

## Public data boundary

These requirements govern the last trustworthy boundary before external bytes leave Gridex. Review exact properties, nested values and identifiers rather than treating successful serialization as safety.

### REQ-001: Versioned allowlisted public DTOs

- **User story:** As a tenant integrator, I need stable public resources that never reveal Gridex database identifiers so that storage can evolve without privacy or compatibility defects.
- **Requirement:** Every external customer, identity, invoice, contract, facility, metering point/value, document, notification, legal acceptance, power of attorney, quote and event is constructed by an explicit mapper and parsed by a versioned runtime output schema. The final serializer recursively rejects forbidden internal keys, unknown properties and UUID-like values unless the schema explicitly permits that public business field.
- **Pattern:** whitelist
- **References:** master points 1–3, 16–18, 31–32 and 69; contracts 1–5 and 35.
- **Conditions of satisfaction:** no mapper spreads a DB row; response schemas default to additionalProperties=false; route and fixture payloads pass the same validator; mutations containing nested company_id, customer_id, contract_id, site_id, portal_identity_id, workflow_id or raw job IDs fail; stable public references remain deterministic or persisted without revealing PKs.
- **Edge cases:** legitimate business identifiers such as metering_point_id require named schema exceptions; null values do not bypass key checks; arrays and deeply nested objects are traversed; circular objects fail safely before serialization.
- **Verification:** mapper unit tests, recursive forbidden-field property tests, actual route-response OpenAPI validation and generated fixture validation.

### REQ-002: Database keyset pagination for every portal list

- **User story:** As a portal customer, I need all historical records to remain reachable regardless of account size so that financial and legal history is complete.
- **Requirement:** Invoices, contracts, sites/facilities, metering points, metering values, documents, events, notifications, legal acceptances and powers of attorney page in PostgreSQL using a resource-specific deterministic sort value plus unique ID, a tenant/customer predicate and limit+1. The external cursor is opaque, authenticated and bound to tenant, resource, order and contract version.
- **Pattern:** parity
- **References:** master points 4–5 and 58; contracts 6–9.
- **Conditions of satisfaction:** no helper applies a fixed 100/200 cap before paging; duplicate timestamps neither duplicate nor skip rows; page sizes are bounded; has_more and next_cursor come from the extra row; positions 1, 101 and 1001 are reachable for representative resources.
- **Edge cases:** timestamp ties, null domain timestamps with documented fallback, deletion between pages, malformed/tampered/cross-resource cursor, maximum page size and final partial page.
- **Verification:** database-backed 1,001-row traversal tests, cursor codec property tests and static absence gate for pre-pagination hard caps.

### REQ-003: Direct tenant-bound invoice reference lookup

- **User story:** As a customer, I need an invoice link to remain valid even when newer invoices exist so that old financial records can be opened directly.
- **Requirement:** Invoice detail resolves a canonical invoice_reference through one indexed lookup constrained by company_id and customer_id; it does not enumerate or scan a list in application memory.
- **Pattern:** parity
- **References:** master points 6, 54–55; contracts 10–11.
- **Conditions of satisfaction:** invoice_reference is canonical and unique within the tenant/customer key; query plan uses the intended index; valid row 1,001 resolves; cross-tenant and missing references share the neutral 404 envelope.
- **Edge cases:** reference collision during backfill, legacy reference compatibility, inactive customer, same reference text in two tenants and malformed reference.
- **Verification:** direct-query mock assertion, live index/catalog check, >1,000-row integration test and two-tenant lookup test.

## Failure truth and durable writes

Infrastructure failures and retries are normal operating conditions. These requirements prevent a false empty state or a success response that cannot be reproduced.

### REQ-004: Fail-closed schema readiness and canonical errors

- **User story:** As an operator and customer, I need infrastructure failure to be distinguishable from zero business data so that incidents are detected and handled safely.
- **Requirement:** Exhausted schema/RPC fallbacks raise PlatformSchemaNotReadyError and external routes emit the canonical 503 platform_schema_not_ready envelope. All documented errors retain canonical request/correlation/contract fields, retryability, blockers/field details and status semantics.
- **Pattern:** parity
- **References:** master points 7, 51–54 and 73; contracts 12–15.
- **Conditions of satisfaction:** missing relation/column/function never becomes data=[]; a successful zero-row query remains 200; 401/403/404/409/422/429/503 are selected for their documented cause; cross-tenant errors reveal no existence diagnostic.
- **Edge cases:** canonical query fails and legacy succeeds; both fail; rate/auth database unavailable; telemetry fails after a valid response; unknown database error is redacted and fails closed.
- **Verification:** injected Supabase error tests, route envelope schema tests, historical incident regression suite and two-tenant neutral-error assertions.

### REQ-005: Durable tenant-bound idempotency lifecycle

- **User story:** As an API client, I need retries to be safe and deterministic so that network failure cannot duplicate a business mutation.
- **Requirement:** Every registry operation marked idempotent uses one durable lifecycle bound to tenant, API client, operation, relevant resource/customer, idempotency key and canonical request hash. Claim, mutation, required audit/evidence and stored response complete atomically or through a recoverable transaction protocol before success.
- **Pattern:** parity
- **References:** master points 8–9 and 35; contracts 16–20.
- **Conditions of satisfaction:** same body replays exact status/body; changed body returns 409 before mutation; two tenants and two clients can reuse the key independently; a completion failure cannot strand a committed success as processing; noncritical telemetry is outside critical TTFB.
- **Edge cases:** concurrent first requests, worker crash after mutation, stale processing claim, canonical JSON key order, large response and operation/resource mismatch.
- **Verification:** concurrency/property tests, injected transaction failures, two-tenant integration SQL and registry coverage gate over all writes.

## Canonical API, onboarding and runtime

One representation must drive what the platform publishes and enforces. Tenant onboarding then becomes a supported product flow rather than knowledge of internal tables.

### REQ-006: Canonical operation registry and generated contract

- **User story:** As an integration developer, I need documentation, schemas and runtime policy to describe the same API so that generated clients behave correctly.
- **Requirement:** A typed PUBLIC_API_REGISTRY owns method, path, operationId, auth, scopes/mode, rate class/cost, idempotency, request/response schemas, cache and public-ID policy. It generates or mechanically verifies OpenAPI paths, summaries, response descriptions, security extensions, examples, developer documentation, generated clients and immutable release metadata.
- **Pattern:** whitelist
- **References:** master points 10–18, 24, 50, 52–57, 68, 70 and 74; contracts 21–27.
- **Conditions of satisfaction:** route/OpenAPI sets are bijective; operationIds are syntactically valid and unique; compatibility values share one enum; one contract constant controls every version surface; actual route payloads validate; latest/manifest are no-store while immutable version bytes are cacheable and identical to release bytes.
- **Edge cases:** split facade/runtime modules, deprecated scope/field, non-idempotent GET metadata, optional request body, empty 204 response and generated artifact drift.
- **Verification:** deterministic generation, bidirectional route parity, JSON Schema/OpenAPI validation, operationId lint, fixture/runtime contract tests and byte equality gate.

### REQ-007: Opaque bootstrap and integration pack

- **User story:** As a new tenant developer, I need one safe bootstrap response and a complete provisioned pack so that I can integrate without Gridex database knowledge.
- **Requirement:** Provisioning produces an API client, one-time token, opaque persisted or cryptographic tenant/client references, granular scopes, rate profile, optional uniquely-secreted webhook, portal URL and readiness result. integration/context returns those public values, contract/base/OpenAPI URLs, auth model and capabilities without company_id or transformed PKs.
- **Pattern:** whitelist
- **References:** master points 19–23, 55, 66–67; contracts 28–29 and 33–34.
- **Conditions of satisfaction:** client reference cannot be converted back to UUID; legacy portal scopes are aliases with explicit sunset and are never provisioned to new clients; one readiness decision and smoke flow exercise the real client.
- **Edge cases:** webhook omitted, partial provisioning retry, token displayed more than once, inactive tenant, scope alias on an existing client and reference collision.
- **Verification:** provisioning lifecycle tests, bootstrap forbidden-field test, opacity property test, readiness matrix and tenant smoke script.

### REQ-008: Atomic tenant authentication and portal identity

- **User story:** As a tenant and portal user, I need authorization and identity decisions to be consistent, tenant-bound and fast so that no request is accepted on partial or stale state.
- **Requirement:** Database functions atomically authenticate integration requests and resolve portal identity. Authentication verifies token/client/tenant state, expiry/revocation, required scopes, IP policy and weighted rate cost; Origin is only CORS input. Identity applies one documented strong/weak/manual policy, detects ambiguity and never treats an identifier alone as authorization.
- **Pattern:** compensation
- **References:** master points 25–30, 34 and 72–73; contracts 30–32, 37–38.
- **Conditions of satisfaction:** read/write/expensive costs affect the central fail-closed limiter; normal auth uses one RPC; unavailable auth/rate DB rejects; identity uses the server tenant and returns ambiguity rather than first match; code and repository migrations match live signatures.
- **Edge cases:** revoked/expired client, missing Origin, conflicting identity signals, duplicate email/customer number, rate window boundary, RPC schema mismatch and service interruption.
- **Verification:** database function tests, route integration tests, cost accounting property tests, ambiguity fixtures, CORS/auth separation tests and signature parity gate.

### REQ-009: Minimal public read models and early fingerprint

- **User story:** As a tenant, I need public reads to be efficient without weakening authorization or changing the DTO contract so that large feeds remain responsive.
- **Requirement:** Hot external routes use explicit projections or service-only public read models. Public-contract requests read a canonical tenant publication fingerprint before building the full feed and immediately return 304 on a matching If-None-Match.
- **Pattern:** whitelist
- **References:** master points 31–34, 49, 71–72; contracts 35–39.
- **Conditions of satisfaction:** no select-star in scoped external reads; adding a DB column cannot alter public output; independent reads use Promise.all only when no decision dependency exists; query plans and p50/p95/p99 evidence precede index/cache tuning.
- **Edge cases:** missing fingerprint function, changed feed during response build, weak/strong ETag syntax, empty publication, stale authorization state and cache header differences by URL type.
- **Verification:** source gate, Supabase mock call-order test, live EXPLAIN/catalog evidence and latency report by operation component.

## Webhooks, database integrity and release closure

Asynchronous delivery and deployment provenance cross time and environment boundaries. Their state must remain tenant-local, durable and reconstructible.

### REQ-010: Registered tenant-isolated webhooks

- **User story:** As a webhook consumer, I need exact versioned payloads and subscription-specific signatures so that I can verify, retry and evolve safely.
- **Requirement:** WEBHOOK_EVENT_REGISTRY declares event name/version/schema/required fields/description/lifecycle/mapper. Event DTOs are explicit allowlists. New production subscriptions require their own active secret reference/version, with bounded previous-secret verification during rotation; global fallback cannot sign them. Existing durable delivery, idempotency, locks, backoff, stale recovery and dead-letter/paused behavior are preserved.
- **Pattern:** whitelist
- **References:** master points 36–39 and 60; contracts 40–44.
- **Conditions of satisfaction:** unknown event/property fails; signature covers timestamp and exact bytes; tenant A secret never verifies tenant B; same event produces distinct tenant delivery references and retry state; rotation expiry is enforced.
- **Edge cases:** concurrent delivery workers, stale lock, previous secret just before/after sunset, replayed timestamp, paused subscription and dead-letter exhaustion.
- **Verification:** registry enumeration gate, schema tests, two-tenant signing tests, fake-timer retry tests and live subscription catalog checks.

### REQ-011: Reconstructible database and mandatory verification gates

- **User story:** As an operator, I need source and CI to reconstruct and verify the database so that a fresh or recovered environment has the same security and behavior.
- **Requirement:** Official applied migration statements missing from source are restored exactly; historical files remain immutable and fixes are forward migrations. Clean replay and parity checks cover ledger checksums, functions, columns, constraints, indexes, RLS, generated types and runtime expectations. CI runs all contract, response, >1,000 pagination, two-tenant, webhook, historical incident, migration, security, type, lint, test and build gates.
- **Pattern:** parity
- **References:** master points 40–49, 51, 56–63; contracts 45–52.
- **Conditions of satisfaction:** duplicate indexes are removed only with dependency evidence; canonical invoice index remains; violation probes precede constraint validation; zero-policy service tables stay fail closed/documented; geodata/log lifecycle is explicit; leaked-password protection is verified in each relevant environment.
- **Edge cases:** migration ledger ahead of source, duplicate version names, constraint violations, constraint-owned index, unavailable Docker/replay service, intended zero-policy table and dev/production catalog divergence.
- **Verification:** checksum inventory, clean replay, catalog fingerprint SQL, advisors/RLS queries, retention tests, security scans and required workflow status evidence.

### REQ-012: Exact-SHA environment-specific release closure

- **User story:** As a release owner, I need closure evidence tied to the deployed artifact and environment so that the remediation is not declared complete on stale or dev-only results.
- **Requirement:** Release manifest and campaign memory record immutable source provenance. Production completion requires the merged source SHA, mandatory CI SHA and deployed Vercel SHA to match, production database parity to be independently verified, and named API latency percentiles to be measured. Unavailable staging/production remains explicitly blocked, never inferred from dev.
- **Pattern:** compensation
- **References:** master points 43, 63–65 and 71–75; contract 53.
- **Conditions of satisfaction:** memory cannot claim a nonexistent/stale Git SHA; manifest exposes build commit; protected-main CI evidence is queryable; production catalog and auth settings are checked separately; campaign stops only after defined P1/P2 and release gates are green.
- **Edge cases:** archive without Git metadata, unprotected branch, rollback deployment, same source rebuilt under another artifact, partial environment access and performance sample too small.
- **Verification:** provenance script, deployment/CI API comparison, environment-labelled database evidence, performance report and final closure matrix with blockers.

## Master specification traceability

Every numbered point in the supplied remediation specification maps to at least one requirement below. Status is deliberately deferred until review and implementation evidence are complete.

| Point | Requirement | Verification state |
|---:|---|---|
| 1 | REQ-001 | Pending implementation evidence |
| 2 | REQ-001 | Pending implementation evidence |
| 3 | REQ-001 | Pending implementation evidence |
| 4 | REQ-002 | Pending implementation evidence |
| 5 | REQ-002 | Pending implementation evidence |
| 6 | REQ-003 | Pending implementation evidence |
| 7 | REQ-004 | Pending implementation evidence |
| 8 | REQ-005 | Pending implementation evidence |
| 9 | REQ-005 | Pending implementation evidence |
| 10 | REQ-006 | Pending implementation evidence |
| 11 | REQ-006 | Pending implementation evidence |
| 12 | REQ-006 | Pending implementation evidence |
| 13 | REQ-006 | Pending implementation evidence |
| 14 | REQ-006 | Pending implementation evidence |
| 15 | REQ-006 | Pending implementation evidence |
| 16 | REQ-001, REQ-006 | Pending implementation evidence |
| 17 | REQ-001, REQ-006 | Pending implementation evidence |
| 18 | REQ-001, REQ-006 | Pending implementation evidence |
| 19 | REQ-007 | Pending implementation evidence |
| 20 | REQ-007 | Pending implementation evidence |
| 21 | REQ-007 | Pending implementation evidence |
| 22 | REQ-007, REQ-008 | Pending implementation evidence |
| 23 | REQ-007, REQ-006 | Pending implementation evidence |
| 24 | REQ-006 | Pending implementation evidence |
| 25 | REQ-008 | Pending implementation evidence |
| 26 | REQ-008 | Pending implementation evidence |
| 27 | REQ-008 | Pending implementation evidence |
| 28 | REQ-008 | Pending implementation evidence |
| 29 | REQ-008 | Pending implementation evidence |
| 30 | REQ-008 | Pending implementation evidence |
| 31 | REQ-001, REQ-009 | Pending implementation evidence |
| 32 | REQ-009 | Pending implementation evidence |
| 33 | REQ-009 | Pending implementation evidence |
| 34 | REQ-008, REQ-009 | Pending implementation evidence |
| 35 | REQ-005 | Pending implementation evidence |
| 36 | REQ-010 | Pending implementation evidence |
| 37 | REQ-010 | Pending implementation evidence |
| 38 | REQ-010 | Pending implementation evidence |
| 39 | REQ-010 | Pending implementation evidence |
| 40 | REQ-011 | Pending implementation evidence |
| 41 | REQ-003, REQ-011 | Pending implementation evidence |
| 42 | REQ-011 | Pending implementation evidence |
| 43 | REQ-012 | Pending implementation evidence |
| 44 | REQ-011 | Pending implementation evidence |
| 45 | REQ-011 | Pending implementation evidence |
| 46 | REQ-011, REQ-012 | Pending implementation evidence |
| 47 | REQ-011 | Pending implementation evidence |
| 48 | REQ-011 | Pending implementation evidence |
| 49 | REQ-009, REQ-011 | Pending implementation evidence |
| 50 | REQ-006 | Pending implementation evidence |
| 51 | REQ-004, REQ-011 | Pending implementation evidence |
| 52 | REQ-004, REQ-006 | Pending implementation evidence |
| 53 | REQ-004 | Pending implementation evidence |
| 54 | REQ-003, REQ-004, REQ-008 | Pending implementation evidence |
| 55 | REQ-001, REQ-003, REQ-007 | Pending implementation evidence |
| 56 | REQ-006, REQ-011 | Pending implementation evidence |
| 57 | REQ-006, REQ-011 | Pending implementation evidence |
| 58 | REQ-002, REQ-011 | Pending implementation evidence |
| 59 | REQ-005, REQ-008, REQ-011 | Pending implementation evidence |
| 60 | REQ-010, REQ-011 | Pending implementation evidence |
| 61 | REQ-011 | Pending implementation evidence |
| 62 | REQ-008, REQ-011 | Pending implementation evidence |
| 63 | REQ-011, REQ-012 | Pending implementation evidence |
| 64 | REQ-012 | Pending implementation evidence |
| 65 | REQ-012 | Pending implementation evidence |
| 66 | REQ-007 | Pending implementation evidence |
| 67 | REQ-007 | Pending implementation evidence |
| 68 | REQ-006 | Pending implementation evidence |
| 69 | REQ-001 | Pending implementation evidence |
| 70 | REQ-006 | Pending implementation evidence |
| 71 | REQ-009, REQ-012 | Pending implementation evidence |
| 72 | REQ-008, REQ-009 | Pending implementation evidence |
| 73 | REQ-004, REQ-008 | Pending implementation evidence |
| 74 | REQ-006, REQ-007 | Pending implementation evidence |
| 75 | REQ-012 | Pending implementation evidence |
