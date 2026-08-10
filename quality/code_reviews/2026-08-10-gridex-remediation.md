# Gridex OPS external remediation — three-pass code review

Date: 2026-08-10
Scope: files in quality/exploration_role_map.json, with connected-dev migration ledger evidence where explicitly identified.

## Pass 1: Structural Review

### lib/customer-portal/apiData.ts

- **Lines 186–193 — BUG-003 (HIGH):** All schema variants can fail and the helper returns an empty array. Actual: infrastructure/schema failure becomes valid zero-row data. Expected: typed schema-not-ready failure.
- **Lines 195–620 — BUG-001 (HIGH):** Parallel resource helpers cap queries before pagination. Actual: rows beyond the cap cannot enter pagePublicItems. Expected: database tuple keyset with limit+1.
- **Lines 312–358 / invoice route lines 27–48 — BUG-002 (HIGH):** Detail enumerates the capped invoice list and searches in Node. Expected: direct tenant/customer/reference lookup.

### lib/customer-portal/externalApi.ts and publicDto.ts

- **externalApi lines 31–108 — BUG-011 (HIGH):** Final success serialization accepts arbitrary records. Actual: nested internal keys/UUIDs are emitted if a route bypasses or extends a mapper. Expected: operation output schema plus recursive forbidden-field gate.

### lib/integrations/tenantContext.ts

- **Lines 224–250 — BUG-004 (HIGH):** API client public reference preserves every UUID bit after removing punctuation. Expected: persisted random or tenant-bound cryptographic opaque value.

### lib/integrations/writeIdempotency.ts

- **Lines 173–225 — BUG-005 (HIGH):** Completion is explicitly best effort after the mutation. A transient write failure can strand replay state after success. Expected: atomic/recoverable durable completion before success.

### lib/api/publicRouteRegistry.ts and public contract artifacts

- **Registry lines 1–67 and portal OpenAPI line 1479 — BUG-006 (HIGH):** Operation metadata is split, the registry omits schemas/policies/operationId and one identifier contains a closing brace. Compatibility classifications in openApiReleaseManifest lines 35–63 also disagree.
- **check-openapi-runtime-parity.cjs lines 233–254 and api-canonical-release.test.ts lines 50–62 — BUG-007 (MEDIUM):** Verification reads the customerApplications facade after the implementation split, producing a false release failure.

### Supabase migration boundary

- **supabase/migrations tail — BUG-008 (HIGH):** Repository source ends before ten statements in the official connected-dev ledger. A clean replay cannot reconstruct atomic auth, route cost, portal identity, keyset and feed fingerprint behavior.

### lib/integrations/webhooks.ts

- **Lines 57–175 — BUG-009 (HIGH):** A recursive blacklist is the event contract and a global signing fallback may serve a subscription. New properties are public by default and tenant secret isolation is not mandatory.

### lib/integrations/apiAuth.ts and customerResolver.ts

- **apiAuth lines 294–460 — BUG-010 (HIGH):** The registry rate class does not affect the flat limiter and runtime does not call the applied atomic authentication RPC.
- **customerResolver lines 118–170 and 234–348 — BUG-013 (HIGH):** Fallbacks use different ambiguity behavior and ignore the live canonical identity RPC.

### lib/website/publicContracts.ts and route

- **publicContracts lines 2325–2355 and 2588–2605 — BUG-012 (MEDIUM):** Hot external reads select-star. The route loads/builds the feed before response ETag comparison instead of checking the live fingerprint first.

### tenant provisioning

- **migration 20260724170000 lines 34–57 and tenantWebsiteProvisioning lines 276–466 — BUG-014 (MEDIUM):** The new tenant profile still provisions legacy portal scopes and does not execute an automatic real-client smoke flow after readiness reconciliation.

## Pass 2: Requirement Verification

### REQ-001: Versioned allowlisted public DTOs
**Status:** PARTIALLY SATISFIED. **Evidence:** publicDto.ts lines 31–339 explicitly maps most resources, but externalApi.ts lines 31–108 accepts arbitrary success objects. **Analysis:** allowlisting exists locally; final output validation and strict schema coverage do not. **Findings:** BUG-011, BUG-006, BUG-012.

### REQ-002: Database keyset pagination
**Status:** VIOLATED. **Evidence:** apiData.ts lines 195–620 applies fixed limits; publicDto.ts lines 424–453 uses offset slicing. **Finding:** BUG-001.

### REQ-003: Direct invoice lookup
**Status:** VIOLATED. **Evidence:** invoice detail route lines 27–48 calls listPortalInvoices then find. **Finding:** BUG-002.

### REQ-004: Fail-closed schema readiness
**Status:** PARTIALLY SATISFIED. **Evidence:** schemaReadiness.ts is fail closed and error envelopes exist, but apiData.ts lines 186–193 returns []. **Finding:** BUG-003.

### REQ-005: Durable idempotency
**Status:** PARTIALLY SATISFIED. **Evidence:** writeIdempotency.ts lines 76–171 correctly binds and claims; lines 173–225 make completion best effort. **Finding:** BUG-005.

### REQ-006: Canonical operation registry
**Status:** VIOLATED. **Evidence:** publicRouteRegistry.ts type has seven fields only; OpenAPI contains malformed/missing operationIds and manifest has three compatibility strings. **Findings:** BUG-006, BUG-007.

### REQ-007: Opaque bootstrap and integration pack
**Status:** PARTIALLY SATISFIED. **Evidence:** provisioning and readiness modules create a substantial integration pack; tenantContext.ts derives client reference from UUID; tenant_website profile includes legacy scopes and no smoke flow. **Findings:** BUG-004, BUG-014.

### REQ-008: Atomic auth and portal identity
**Status:** VIOLATED in repository runtime. **Evidence:** apiAuth.ts and customerResolver.ts perform distributed queries while official dev ledger has atomic functions not represented/wired. **Findings:** BUG-010, BUG-013, BUG-008.

### REQ-009: Minimal public reads and early fingerprint
**Status:** VIOLATED. **Evidence:** publicContracts.ts uses select-star and route builds feed before ETag decision. **Finding:** BUG-012. Production performance evidence is not assessable.

### REQ-010: Registered tenant-isolated webhooks
**Status:** PARTIALLY SATISFIED. **Evidence:** durable deliveries, locks and retries exist; event DTO registry and required per-subscription secrets do not. **Finding:** BUG-009.

### REQ-011: Reconstructible DB and gates
**Status:** VIOLATED. **Evidence:** migration integrity passes only the incomplete repo; connected dev contains ten missing official versions. Runtime response/pagination/isolation gates are incomplete. **Findings:** BUG-008 plus BUG-001/006/009/010. GitHub and Auth settings are not assessable.

### REQ-012: Exact-SHA production closure
**Status:** NOT ASSESSABLE / BLOCKED. **Evidence:** only gridex-ops-dev is connected and the archive has no .git metadata or Vercel/GitHub evidence. The correct result is an explicit external blocker, not a code-compliance claim.

## Pass 3: Cross-Requirement Consistency

### Shared concept: public reference
**Requirements:** REQ-001, REQ-003, REQ-007, REQ-008. **Consistency:** INCONSISTENT. publicReference() hashes tenant/kind/ID, but tenantContext.ts exposes the raw client UUID bits and invoice detail treats a projected list reference as a lookup key without a direct resolver. **Impact:** public identity leaks and old references become false 404s. **Findings:** BUG-002, BUG-004, BUG-011.

### Shared concept: fail closed
**Requirements:** REQ-004, REQ-008, REQ-012. **Consistency:** INCONSISTENT. Schema readiness and tenant context generally reject unverifiable state, but list fallback converts the same condition to empty success; auth runtime also bypasses the atomic live function. **Impact:** incident state may look healthy. **Findings:** BUG-003, BUG-010.

### Shared concept: contract version and operation identity
**Requirements:** REQ-001, REQ-006, REQ-012. **Consistency:** INCONSISTENT. Version constants mostly align, but compatibility classifications and operation metadata do not share one representation and parity tests inspect the wrong runtime source. **Findings:** BUG-006, BUG-007.

### Shared concept: durable critical state
**Requirements:** REQ-005, REQ-010, REQ-011. **Consistency:** INCONSISTENT. Webhook delivery persistence treats uncertain state conservatively, while write idempotency completion is best effort; repository cannot replay the newest durability functions. **Findings:** BUG-005, BUG-008, BUG-009.

### Shared concept: safe performance
**Requirements:** REQ-006, REQ-009. **Consistency:** INCONSISTENT. Immutable caching exists, but public-contract reads fetch all columns/feed before cache validation and rate classes are catalogue-only. **Findings:** BUG-010, BUG-012.

## Regression confirmation baseline

Command: npx vitest run --config quality/vitest.config.ts quality/test_regression.test.ts --reporter=dot

Result: PASS as a guarded red baseline — 14 tests, all 14 reported expected failure. Each test asserts desired behavior and targets the cited file/function. Un-guarded red and proposed-patch green phases are reserved for Phase 5.

## Compensation grid closure

Mechanical result: 12 pattern requirements, 100 cells, 67 absent cells; 55 are covered by BUG Covers fields and 12 have complete platform-gated downgrade records. Missing cells: 0. Invalid downgrade records: 0.

## Combined Summary

| Source | Finding | Severity | Status |
|---|---|---|---|
| Pass 1 / REQ-002 | BUG-001 pre-DB truncation | HIGH | BUG |
| Pass 1 / REQ-003 | BUG-002 limited invoice detail | HIGH | BUG |
| Pass 1 / REQ-004 | BUG-003 false empty fallback | HIGH | BUG |
| Pass 1 / REQ-007 | BUG-004 reversible API-client reference | HIGH | BUG |
| Pass 1 / REQ-005 | BUG-005 non-durable completion | HIGH | BUG |
| Pass 1 / REQ-006 | BUG-006 split/malformed contract representation | HIGH | BUG |
| Pass 1 / REQ-006 | BUG-007 facade-only verifier | MEDIUM | BUG |
| Pass 1 / REQ-011 | BUG-008 missing migration tail | HIGH | BUG |
| Pass 1 / REQ-010 | BUG-009 open webhook projection/secret fallback | HIGH | BUG |
| Pass 1 / REQ-008 | BUG-010 flat/non-atomic auth runtime | HIGH | BUG |
| Pass 1 / REQ-001 | BUG-011 unconstrained final serializer | HIGH | BUG |
| Pass 1 / REQ-009 | BUG-012 select-star/late fingerprint | MEDIUM | BUG |
| Pass 1 / REQ-008 | BUG-013 divergent identity fallback | HIGH | BUG |
| Pass 1 / REQ-007 | BUG-014 legacy scope/smoke provisioning gap | MEDIUM | BUG |

Confirmed: 14. Regression patches: 14. Proposed fix patches: 14. Exemptions: 0.

**Overall assessment:** BLOCK until P1 external boundary, migration parity and tenant-isolation defects are fixed and the required gates run. Production closure remains separately blocked by missing production/GitHub/Vercel evidence.
