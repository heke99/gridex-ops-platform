# Gridex OPS master-remediation exploration

Scope is the user-supplied 75-point public API, Customer Portal, database, webhook, and release specification. Existing audit evidence and live `gridex-ops-dev` are context, but source, current tests, current OpenAPI, the official live migration ledger, and current database catalog outrank agent memory.

## Open Exploration Findings

1. Portal pagination is bounded before it is paginated. `listPortalContracts()` applies `.limit(100)` in `lib/customer-portal/apiData.ts:195-219`; the route then maps all returned rows and applies an offset cursor in `app/api/v1/customer/contracts/route.ts:22-35`; `pagePublicItems()` slices that already-truncated array in `lib/customer-portal/publicDto.ts:424-453`. Rows 101 and 1001 are therefore unreachable, directly confirming master requirements 4-5.

2. The same loss pattern is repeated across invoices, sites, legal acceptances, powers of attorney, notifications, events, documents, and metering values. Representative limits are in `lib/customer-portal/apiData.ts:226-250`, `lib/customer-portal/apiData.ts:312-335`, `lib/customer-portal/apiData.ts:366-426`, `lib/customer-portal/apiData.ts:526-550`, and `lib/customer-portal/apiData.ts:557-620`; the routes subsequently call the same Node slicer. This is a systemic contract defect, not an isolated endpoint bug.

3. Invoice detail searches a limited list in Node. `app/api/v1/customer/invoices/[id]/route.ts:27-48` calls `listPortalInvoices()` then compares the public projection, while `listPortalInvoices()` only reads 100 rows at `lib/customer-portal/apiData.ts:312-334`. The file already contains an unused direct helper `getPortalInvoice()` at `lib/customer-portal/apiData.ts:337-358`, but it accepts internal ID rather than the public reference. A canonical persisted/indexed public reference or tenant-bound resolver is required.

4. Missing schema is still converted to legitimate empty data. `listWithSchemaFallback()` returns `[]` after all schema variants fail at `lib/customer-portal/apiData.ts:186-193`; contracts explicitly return `[]` at `lib/customer-portal/apiData.ts:205-218`; metering route returns HTTP 200 with `data: []` at `app/api/v1/customer/metering-values/route.ts:43-61`. This bypasses the otherwise fail-closed platform gate in `lib/platform/schemaReadiness.ts:31-119` and violates requirement 7.

5. Public DTO allowlisting exists, but it is not runtime-validated. Mappers in `lib/customer-portal/publicDto.ts:31-339` construct explicit objects and hash many internal IDs through `publicReference()` in `lib/integrations/publicReferences.ts:10-37`. However, `customerPortalJson()` accepts unconstrained generic objects at `lib/customer-portal/externalApi.ts:31-108`; there is no response schema registry lookup, forbidden-field scan, or UUID check before serialization. This leaves requirements 1-3 and 16-17 only partially implemented.

6. `api_client_reference` is a transformed database UUID, not an opaque reference. `loadExternalTenantContext()` emits ``client_${client.id.replaceAll('-', '')}`` at `lib/integrations/tenantContext.ts:224-250`. The public projection correctly excludes internal readiness diagnostics at `lib/integrations/tenantContext.ts:91-173`, but requirement 20 remains open because the internal primary key is reversible by inserting UUID hyphens.

7. Idempotency is durable at claim time but not durable at completion. The claim is bound to company, client, route, key, and canonical request hash in `lib/integrations/writeIdempotency.ts:76-171`; completion is explicitly best effort and can return success after failing to persist the response at `lib/integrations/writeIdempotency.ts:173-225`. That can cause a committed write followed by a retry to remain `processing`, which conflicts with requirements 8-9 and 35.

8. The registry is only a catalogue. `PublicApiRouteContract` carries method, path, scopes, description, idempotency flag, and rate class at `lib/api/publicRouteRegistry.ts:1-10`; it lacks operationId, request/response schemas, scope mode, cache policy, and public-ID policy required by requirement 11. OpenAPI is still independently hand-maintained, evidenced by malformed `getApiV1CustomerInvoicesId}` in `docs/openapi/customer-portal-v1.json:1479`.

9. Baseline verifiers produce false failures after a valid refactor. `lib/website/customerApplications.ts:1-3` is now a facade, while actual commercial assertions live in `lib/website/customerApplicationProcess.ts:89-132`; `scripts/check-openapi-runtime-parity.cjs:233-254` and `__tests__/api-canonical-release.test.ts:50-62` still inspect only the facade. The baseline is therefore 466/467 tests green and OpenAPI/runtime parity fails four assertions even though runtime enforcement exists.

10. Webhook public projection remains blacklist-based. `sanitizeWebhookData()` recursively removes ID-like keys at `lib/integrations/webhooks.ts:92-114`, then `buildPublicWebhookPayload()` accepts the residual arbitrary object at `lib/integrations/webhooks.ts:143-175`. Production subscriptions can fall back to a global secret at `lib/integrations/webhooks.ts:57-62`. Delivery locking/retry/public delivery identifiers exist at `lib/integrations/webhooks.ts:267-269` and `lib/integrations/webhooks.ts:361-448`, so requirements 36-39 need a bounded DTO/secret fix without discarding existing reliability behavior.

11. Public-contract reads still use `select('*')` on exposed canonical views at `lib/website/publicContracts.ts:2325-2355` and `lib/website/publicContracts.ts:2588-2605`. Any new view column is pulled into Node and can affect mapping or memory, contrary to requirement 32. Live migration `20260809183210` advertises an early publication fingerprint, but the zip has no matching migration or runtime consumer.

12. The live database is ahead of the repository. The official Supabase ledger contains ten versions from `20260809180628` through `20260809191135` absent from `supabase/migrations/`; these include external API index foundations, portal event keyset read model, atomic auth/rate cost, portal identity resolver, and public-contract fingerprint. Repository migration integrity can pass while source cannot reconstruct the connected schema, violating requirements 61-62.

13. Rate classes do not reach the limiter. The registry assigns `read|write|expensive` at `lib/api/publicRouteRegistry.ts:1-67`, while `rateLimitDecision()` calls the RPC with a flat client limit and route at `lib/integrations/apiAuth.ts:294-350`. The live database has later route-cost RPC migrations absent from source, so requirement 26 appears implemented live but not in the zip runtime.

14. Authentication still performs several roundtrips in application code. `resolveIntegrationApiAccess()` gates schema, queries API client, queries company, validates scope/IP/origin, then calls the limiter in `lib/integrations/apiAuth.ts:355-460`. The live ledger contains `authenticate_integration_request_v1` and route-cost successors, showing intended consolidation exists in DB but is not used by this runtime.

15. Portal identity fallback behavior is deliberately ambiguity-aware in parts but still distributed. `customerByField()` reads up to two email matches and accepts exactly one at `lib/customer-portal/customerResolver.ts:234-260`; other link/account paths use `limit(1)` or a sequence of fallbacks at `lib/customer-portal/customerResolver.ts:118-170` and `lib/customer-portal/customerResolver.ts:273-348`. The live resolver migration is absent from source/runtime, leaving requirements 29-30 incomplete.

## Quality Risks

1. **P1 — silent historical data loss.** With 1,001 invoices sharing a tenant/customer, `listPortalInvoices()` at `lib/customer-portal/apiData.ts:312-334` truncates to 100 before `pagePublicItems()` at `lib/customer-portal/publicDto.ts:424-453`; the API can return `has_more=false` while 901 valid invoices remain. A customer may miss overdue or credited financial records without an error.

2. **P1 — false healthy empty state during schema drift.** If a deployed portal queries a removed column, `listWithSchemaFallback()` at `lib/customer-portal/apiData.ts:186-193` returns empty after all variants fail. Routes publish 200, making incident detection harder and allowing UI/business logic to interpret infrastructure failure as “customer has no contracts/documents.”

3. **P1 — invoice reference denial.** An older invoice can be listed in a previous session but become permanently unresolvable when newer invoices push it past the first 100; `app/api/v1/customer/invoices/[id]/route.ts:36-47` turns that into a neutral 404. The privacy semantics are correct, but the business result is wrong.

4. **P1 — retry after committed write can wedge.** If the business mutation commits and `completeIntegrationWriteIdempotency()` at `lib/integrations/writeIdempotency.ts:183-225` cannot update the record, the client receives success but the durable record remains processing. A retry cannot replay and may remain blocked indefinitely.

5. **P1 — public primary-key disclosure by encoding.** `lib/integrations/tenantContext.ts:224-250` removes UUID punctuation but preserves every UUID bit. A tenant can recover internal API-client IDs, defeating the explicit public/internal boundary and making cross-system correlation easier.

6. **P2 — contract verification gives misleading red builds.** Split production modules enforce the fields at `lib/website/customerApplicationProcess.ts:89-132`, but checks read `lib/website/customerApplications.ts` only. Future maintainers can either ignore a real red gate or add non-executable comments to appease it; both weaken release trust.

7. **P2 — webhook schema changes silently.** A domain event can gain a non-ID sensitive property; the blacklist at `lib/integrations/webhooks.ts:92-114` will allow it automatically because no event-specific allowlist or output schema prevents drift.

8. **P2 — source/live disaster recovery mismatch.** A clean replay from the zip cannot create the functions and indexes already relied on in dev after `20260809180628`. A new environment may pass repository checks but miss atomic authentication, route cost, and keyset behavior.

## Pattern Applicability Matrix

| Exploration pattern | Decision | Target and reason |
|---|---|---|
| Fallback and Degradation Path Parity | FULL | Portal schema fallbacks and identity fallbacks can change success/error and authorization semantics. |
| Dispatcher Return-Value Correctness | SKIP | No newly suspected multi-event dispatcher is central to this remediation boundary. |
| Cross-Implementation Contract Consistency | FULL | Portal list endpoints and split website application modules implement parallel public contracts. |
| Enumeration and Representation Completeness | FULL | Registry routes, OpenAPI operationIds/scopes, compatibility values, and webhook event types are closed sets. |
| API Surface Consistency | FULL | List/detail, registry/OpenAPI/runtime, and legacy/current routes expose the same logical resources. |
| Spec-Structured Parsing Fidelity | SKIP | No shortcut RFC parser is among the highest-impact confirmed gaps. |
| Composition and Mount-Context Awareness | SKIP | Next route mount/raw-path context is not implicated by current evidence. |

## Pattern Deep Dive — Fallback and Degradation Path Parity

- Canonical versus legacy select fallback: `listWithSchemaFallback()` at `lib/customer-portal/apiData.ts:186-193` treats exhaustion as valid empty data, unlike `assertPlatformSchemaReady()` at `lib/platform/schemaReadiness.ts:82-119`, which produces a typed 503. The fallback omits the primary path’s truthfulness invariant.
- Portal identity paths at `lib/customer-portal/customerResolver.ts:118-170` and `lib/customer-portal/customerResolver.ts:234-260` do not use one atomic policy. Email detects ambiguity with two rows, while some linked-user paths use one-row lookup; the live resolver should become canonical.
- Webhook signing at `lib/integrations/webhooks.ts:57-62` falls back from subscription reference to a global secret. The fallback does not preserve tenant secret isolation.

## Pattern Deep Dive — Cross-Implementation Contract Consistency

- Contracts, invoices, documents, legal acceptances, POAs, events, and notifications all perform “list a tenant/customer resource,” but their DB ordering keys and fallback behavior are separately coded in `lib/customer-portal/apiData.ts:195-620`. They must share keyset semantics: deterministic timestamp plus ID, page-size-plus-one, opaque cursor, tenant predicate.
- Application runtime was split into `customerApplicationProcess.ts` and persistence/onboarding modules, but parity code at `scripts/check-openapi-runtime-parity.cjs:233-254` still models the facade as the implementation. The test and verifier must follow the production call graph.
- Portal bundle treats some required sections as optional wrappers at `app/api/v1/customer/portal-bundle/route.ts:104-175`; required warnings later yield 503, but missing-schema-to-empty inside list helpers never becomes a warning. The underlying list contract must be consistent first.

## Pattern Deep Dive — Enumeration and Representation Completeness

- `PUBLIC_API_ROUTES` is the route closed set at `lib/api/publicRouteRegistry.ts:12-67`; OpenAPI is a second set. `docs/openapi/customer-portal-v1.json:1479` contains an invalid operationId, proving the sets are not generated from one typed representation.
- Rate-limit classes are enumerated in `lib/api/publicRouteRegistry.ts:7-9`, but `lib/integrations/apiAuth.ts:294-350` has no class/cost input. The handled set is effectively only one flat class.
- Compatibility values at `lib/integrations/openApiReleaseManifest.ts:21-67` include three unrelated strings. They are not one enum shared with the formal schema.
- Webhook events have no canonical registry; `lib/integrations/webhooks.ts:143-175` maps arbitrary event data. Defined domain event names and publicly handled event DTOs cannot be mechanically diffed.

## Pattern Deep Dive — API Surface Consistency

- Invoice list uses a derived public reference at `lib/customer-portal/publicDto.ts:164-187`, but detail accepts a path reference and scans a truncated internal list at `app/api/v1/customer/invoices/[id]/route.ts:27-48`. Same resource, inconsistent lookup semantics.
- Public API registry says routes have rate classes and idempotency at `lib/api/publicRouteRegistry.ts:1-67`, but runtime does not consume registry metadata. Same operation, inconsistent declared and enforced policy.
- The application facade exports split functions at `lib/website/customerApplications.ts:1-3`; runtime works, while the verification surface expects implementation text. Same operation, inconsistent code-discovery semantics.

## Candidate Bugs for Phase 2

1. **BUG-001 — pre-DB pagination truncation makes records unreachable.** Stage: open exploration + Cross-Implementation Contract Consistency. Evidence: `lib/customer-portal/apiData.ts:195-620`, `lib/customer-portal/publicDto.ts:424-453`.

2. **BUG-002 — invoice detail scans only the first 100 invoices.** Stage: quality risks + API Surface Consistency. Evidence: `app/api/v1/customer/invoices/[id]/route.ts:27-48`, `lib/customer-portal/apiData.ts:312-358`.

3. **BUG-003 — exhausted schema fallback returns false empty success.** Stage: open exploration + Fallback and Degradation Path Parity. Evidence: `lib/customer-portal/apiData.ts:186-218`, `app/api/v1/customer/metering-values/route.ts:43-61`.

4. **BUG-004 — API client public reference reversibly exposes internal UUID.** Stage: quality risks. Evidence: `lib/integrations/tenantContext.ts:224-250`.

5. **BUG-005 — idempotency completion is not durable.** Stage: quality risks. Evidence: `lib/integrations/writeIdempotency.ts:173-225`.

6. **BUG-006 — malformed OpenAPI operationId is accepted.** Stage: Enumeration and Representation Completeness. Evidence: `docs/openapi/customer-portal-v1.json:1479`, `lib/api/publicRouteRegistry.ts:1-67`.

7. **BUG-007 — runtime parity/test read a facade after module split.** Stage: open exploration + API Surface Consistency. Evidence: `scripts/check-openapi-runtime-parity.cjs:233-254`, `lib/website/customerApplications.ts:1-3`, `lib/website/customerApplicationProcess.ts:89-132`.

8. **BUG-008 — live migration ledger is ahead of repository source.** Stage: open exploration + quality risks. Evidence: live `supabase_migrations.schema_migrations` after `20260809143000`; repository `supabase/migrations/` ends at that version.

9. **BUG-009 — webhook payload is blacklist-projected and may use global production secret.** Stage: Fallback and Degradation Path Parity + Enumeration and Representation Completeness. Evidence: `lib/integrations/webhooks.ts:57-62`, `lib/integrations/webhooks.ts:92-175`.

10. **BUG-010 — flat application limiter ignores registry rate class.** Stage: open exploration + Enumeration and Representation Completeness. Evidence: `lib/api/publicRouteRegistry.ts:1-67`, `lib/integrations/apiAuth.ts:294-350`.

## Derived Requirements

- REQ-001: Every external DTO must be allowlisted, runtime-validated, UUID/forbidden-field checked, and versioned independently of DB rows. References: `lib/customer-portal/publicDto.ts:31-339`, `lib/customer-portal/externalApi.ts:31-108`.
- REQ-002: Every portal list must keyset-page in PostgreSQL by a deterministic timestamp/value plus ID and read `limit + 1`. References: `lib/customer-portal/apiData.ts:195-620`, `lib/customer-portal/publicDto.ts:424-453`.
- REQ-003: Public invoice detail must resolve `(company_id, customer_id, invoice_reference)` directly and neutrally return 404 outside the tenant. References: `app/api/v1/customer/invoices/[id]/route.ts:27-48`, `lib/customer-portal/apiData.ts:337-358`.
- REQ-004: Missing schema must surface canonical `503 platform_schema_not_ready`; empty 200 is reserved for a successful query with zero rows. References: `lib/platform/schemaReadiness.ts:31-119`, `lib/customer-portal/apiData.ts:186-218`.
- REQ-005: All registry-declared writes must use one durable, tenant/client/operation/resource/key/hash-bound idempotency lifecycle. References: `lib/api/publicRouteRegistry.ts:12-67`, `lib/integrations/writeIdempotency.ts:76-260`.
- REQ-006: One canonical operation registry must carry operationId, schemas, scopes/mode, rate cost, idempotency, cache, and public-ID policy and drive OpenAPI/docs/gates. References: `lib/api/publicRouteRegistry.ts:1-67`, `scripts/check-openapi-runtime-parity.cjs:1-266`.
- REQ-007: Integration context must emit persisted or cryptographic opaque tenant/API-client references, never transformed primary keys. References: `lib/integrations/tenantContext.ts:91-250`, `lib/integrations/publicReferences.ts:10-37`.
- REQ-008: Runtime must use atomic live auth/rate/identity functions and repository migration source must exactly reconstruct those live definitions. References: `lib/integrations/apiAuth.ts:355-460`, `lib/customer-portal/customerResolver.ts:118-348`.
- REQ-009: Public-contract reads must use explicit projections and an early tenant publication fingerprint before loading the full feed. References: `lib/website/publicContracts.ts:2325-2355`, `lib/website/publicContracts.ts:2588-2605`.
- REQ-010: Webhooks require an event registry, event DTO allowlists, per-subscription production secrets, versioned rotation, and existing durable retry/lock guarantees. References: `lib/integrations/webhooks.ts:57-175`, `lib/integrations/webhooks.ts:267-520`.
- REQ-011: CI must execute real response/OpenAPI, >1000 keyset traversal, two-tenant, webhook-secret, migration parity/replay, security, type, test, lint, and build gates. References: `.github/workflows/ops-hardening.yml:1-80`, `package.json` scripts.
- REQ-012: Closure must distinguish verified dev, unavailable staging/production, and production evidence tied to one exact source/CI/deployment SHA. References: `.agent-memory/verification-matrix.md`, `lib/integrations/openApiReleaseManifest.ts:21-67`.

## Derived Use Cases

- UC-01: A tenant API client traverses 1,001 invoices with duplicate timestamps and receives each exactly once through opaque cursors.
- UC-02: A customer opens an old invoice by public reference; the server resolves it in one tenant-bound lookup without enumerating a list.
- UC-03: A portal deployment sees a missing required column; it returns canonical 503 and never presents “no data.”
- UC-04: Two tenants reuse the same idempotency key; each lifecycle is isolated and same-body retry replays the exact stored response.
- UC-05: An API key calls integration context and receives only opaque public tenant/client references and version/readiness metadata.
- UC-06: A production webhook for tenant A is signed only with A’s active/previous rotation secret and cannot verify under tenant B.
- UC-07: A release regenerates OpenAPI and developer fixtures from the operation registry and rejects duplicate/malformed operationIds.
- UC-08: A new database is reconstructed from repository migrations and matches live RPC signatures, indexes, constraints, RLS, and generated types.

## Cartesian UC rule confirmation

1. Every multi-reference REQ was checked for shared path-suffix/function roles.
2. REQ-002 has parallel list implementations but heterogeneous query shapes; it remains one umbrella UC and is marked conceptually heterogeneous.
3. REQ-005 covers parallel write routes but their business mutations are heterogeneous; one umbrella lifecycle UC is retained.
4. REQ-008 spans auth and portal identity, which are not parallel implementations; no per-site UC is emitted.
5. No eligible pair passed both function-body similarity gates, so no artificial UC-N.a split was created.

## Notes for Artifact Generation

- Tests use Vitest with `@/` aliases; static CJS regression scripts are also first-class release gates.
- The connected project is dev only. Live DDL can be read and synchronized, but production claims remain blocked.
- Historical migrations are immutable. Missing live versions must be restored byte-for-byte from the official ledger or represented by a checksum-proven equivalent; new fixes use forward migrations only.
- Property tests should target cursor codec, public DTO forbidden-field traversal, canonical JSON hashing, and operationId generation.
- The implementation stage may modify source only after Phase 6 quality artifacts finish, because QPB phases 1-6 preserve source.

## Gate Self-Check

1. PASS — file exceeds 120 substantive lines.
2. PASS — `quality/PROGRESS.md` exists and Phase 1 is checked.
3. PASS — twelve REQ entries cite concrete functions/files.
4. PASS — fifteen numbered open findings cite concrete lines across API, portal, website, webhook, DB, and verification.
5. PASS — findings 1-4, 8-9, and 12-15 trace multiple locations/functions.
6. PASS — eight ranked domain-specific risks identify mechanism and impact.
7. PASS — all seven exploration patterns are listed.
8. PASS — exactly four patterns are FULL.
9. PASS — exactly four deep-dive sections exist with concrete evidence.
10. PASS — all four deep dives trace multiple functions or representations.
11. PASS — ten candidate bugs include stage and file/line evidence.
12. PASS — more than two candidates originate in open exploration/risks and more than one is strengthened by a pattern.
13. PASS — role map contains 221 focused entries, filesystem fallback provenance, and excludes disallowed generated/vendor paths.

