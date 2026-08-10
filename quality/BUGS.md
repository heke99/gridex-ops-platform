# Confirmed Bugs — Gridex OPS remediation

Generated: 2026-08-10

### BUG-001: Portal list queries truncate before pagination

- Primary requirement: REQ-002
- Severity: HIGH
- Source: Code Review
- Citation: lib/customer-portal/apiData.ts:195-620; lib/customer-portal/publicDto.ts:424-453
- Location: lib/customer-portal/apiData.ts:195-620; lib/customer-portal/publicDto.ts:424-453
- Spec basis: ../../upload/Pasted markdown(20260810-093430).md:70; quality/REQUIREMENTS.md (REQ mapping)
- Minimal reproduction: Create 1,001 tenant/customer invoices with shared timestamps and traverse pages of 100.
- Covers: [REQ-002/cell-P004-GLOBAL, REQ-002/cell-P005-GLOBAL, REQ-002/cell-P058-GLOBAL, REQ-011/cell-P058-GLOBAL]
- Consolidation rationale: The listed cells share the same cited root cause and close through one implementation boundary; splitting them would duplicate the fix without independent behavior.
- Actual behavior: Resource helpers apply fixed database limits before the shared offset cursor slices the materialized array.
- Expected behavior: Apply a tenant-bound tuple keyset in PostgreSQL, fetch limit+1 and derive the opaque next cursor.
- Regression test: regression_bug_001_reaches_row_1001 in quality/test_regression.test.ts
- Regression patch: quality/patches/BUG-001-regression-test.patch
- Proposed fix: quality/patches/BUG-001-fix.patch
- Status: CLOSED — green regression verified on 2026-08-10

### BUG-002: Invoice detail scans only the first invoice page

- Primary requirement: REQ-003
- Severity: HIGH
- Source: Code Review
- Citation: app/api/v1/customer/invoices/[id]/route.ts:27-48; lib/customer-portal/apiData.ts:312-358
- Location: app/api/v1/customer/invoices/[id]/route.ts:27-48; lib/customer-portal/apiData.ts:312-358
- Spec basis: ../../upload/Pasted markdown(20260810-093430).md:72; quality/REQUIREMENTS.md (REQ mapping)
- Minimal reproduction: Place a valid invoice behind 1,000 newer rows and request its listed public reference.
- Covers: [REQ-003/cell-P006-GLOBAL, REQ-003/cell-P041-GLOBAL, REQ-011/cell-P041-GLOBAL]
- Consolidation rationale: The listed cells share the same cited root cause and close through one implementation boundary; splitting them would duplicate the fix without independent behavior.
- Actual behavior: The detail route calls listPortalInvoices() and searches its capped result in Node.
- Expected behavior: Resolve company_id + customer_id + canonical invoice_reference through one indexed query.
- Regression test: regression_bug_002_invoice_detail_uses_direct_lookup in quality/test_regression.test.ts
- Regression patch: quality/patches/BUG-002-regression-test.patch
- Proposed fix: quality/patches/BUG-002-fix.patch
- Status: CLOSED — green regression verified on 2026-08-10

### BUG-003: Exhausted schema fallback becomes an empty success

- Primary requirement: REQ-004
- Severity: HIGH
- Source: Code Review
- Citation: lib/customer-portal/apiData.ts:186-218; app/api/v1/customer/metering-values/route.ts:43-61
- Location: lib/customer-portal/apiData.ts:186-218; app/api/v1/customer/metering-values/route.ts:43-61
- Spec basis: ../../upload/Pasted markdown(20260810-093430).md:73; quality/REQUIREMENTS.md (REQ mapping)
- Minimal reproduction: Make every canonical/legacy list query return PostgreSQL missing-column errors.
- Covers: [REQ-004/cell-P007-GLOBAL, REQ-004/cell-P073-GLOBAL]
- Consolidation rationale: The listed cells share the same cited root cause and close through one implementation boundary; splitting them would duplicate the fix without independent behavior.
- Actual behavior: listWithSchemaFallback returns [] when all schema variants fail, allowing HTTP 200 with no data.
- Expected behavior: Raise PlatformSchemaNotReadyError and emit the canonical retryable 503 envelope.
- Regression test: regression_bug_003_schema_failure_is_503 in quality/test_regression.test.ts
- Regression patch: quality/patches/BUG-003-regression-test.patch
- Proposed fix: quality/patches/BUG-003-fix.patch
- Status: CLOSED — green regression verified on 2026-08-10

### BUG-004: API client public reference reversibly exposes its UUID

- Primary requirement: REQ-007
- Severity: HIGH
- Source: Code Review
- Citation: lib/integrations/tenantContext.ts:224-250
- Location: lib/integrations/tenantContext.ts:224-250
- Spec basis: ../../upload/Pasted markdown(20260810-093430).md:86; quality/REQUIREMENTS.md (REQ mapping)
- Minimal reproduction: Call integration/context for a client whose internal ID is a known UUID.
- Covers: [REQ-007/cell-P020-GLOBAL]
- Actual behavior: api_client_reference is client_ plus client.id with hyphens removed.
- Expected behavior: Use a persisted random or tenant-bound cryptographic reference that cannot reconstruct the primary key.
- Regression test: regression_bug_004_api_client_reference_is_opaque in quality/test_regression.test.ts
- Regression patch: quality/patches/BUG-004-regression-test.patch
- Proposed fix: quality/patches/BUG-004-fix.patch
- Status: CLOSED — green regression verified on 2026-08-10

### BUG-005: Idempotency completion is best effort after business success

- Primary requirement: REQ-005
- Severity: HIGH
- Source: Code Review
- Citation: lib/integrations/writeIdempotency.ts:173-225
- Location: lib/integrations/writeIdempotency.ts:173-225
- Spec basis: ../../upload/Pasted markdown(20260810-093430).md:74; quality/REQUIREMENTS.md (REQ mapping)
- Minimal reproduction: Commit a mutation and make the idempotency completion update fail transiently.
- Covers: [REQ-005/cell-P008-GLOBAL, REQ-005/cell-P035-GLOBAL]
- Consolidation rationale: The listed cells share the same cited root cause and close through one implementation boundary; splitting them would duplicate the fix without independent behavior.
- Actual behavior: Completion failures are logged and may leave a committed write in processing after success was returned.
- Expected behavior: Mutation, required audit and replayable completion must share an atomic or recoverable durable protocol before success.
- Regression test: regression_bug_005_completion_failure_blocks_success in quality/test_regression.test.ts
- Regression patch: quality/patches/BUG-005-regression-test.patch
- Proposed fix: quality/patches/BUG-005-fix.patch
- Status: CLOSED — green regression verified on 2026-08-10

### BUG-006: Registry and generated contract are not one canonical representation

- Primary requirement: REQ-006
- Severity: HIGH
- Source: Code Review
- Citation: lib/api/publicRouteRegistry.ts:1-67; docs/openapi/customer-portal-v1.json:1479; lib/integrations/openApiReleaseManifest.ts:35-63
- Location: lib/api/publicRouteRegistry.ts:1-67; docs/openapi/customer-portal-v1.json:1479; lib/integrations/openApiReleaseManifest.ts:35-63
- Spec basis: ../../upload/Pasted markdown(20260810-093430).md:77; quality/REQUIREMENTS.md (REQ mapping)
- Minimal reproduction: Enumerate registry/OpenAPI operations and validate identifier/metadata/version parity.
- Covers: [REQ-001/cell-P016-GLOBAL, REQ-001/cell-P017-GLOBAL, REQ-001/cell-P018-GLOBAL, REQ-006/cell-P010-GLOBAL, REQ-006/cell-P011-GLOBAL, REQ-006/cell-P012-GLOBAL, REQ-006/cell-P013-GLOBAL, REQ-006/cell-P016-GLOBAL, REQ-006/cell-P017-GLOBAL, REQ-006/cell-P018-GLOBAL, REQ-006/cell-P056-GLOBAL, REQ-006/cell-P057-GLOBAL, REQ-006/cell-P068-GLOBAL, REQ-011/cell-P056-GLOBAL, REQ-011/cell-P057-GLOBAL]
- Consolidation rationale: The listed cells share the same cited root cause and close through one implementation boundary; splitting them would duplicate the fix without independent behavior.
- Actual behavior: Registry lacks operationId/schemas/policy metadata, OpenAPI is separately edited, one operationId is malformed and compatibility strings disagree.
- Expected behavior: A typed registry and shared enums generate or mechanically drive every operation/version/schema/fixture gate.
- Regression test: regression_bug_006_registry_openapi_metadata_parity in quality/test_regression.test.ts
- Regression patch: quality/patches/BUG-006-regression-test.patch
- Proposed fix: quality/patches/BUG-006-fix.patch
- Status: CLOSED — green regression verified on 2026-08-10

### BUG-007: Runtime parity gates inspect a facade instead of executable modules

- Primary requirement: REQ-006
- Severity: MEDIUM
- Source: Code Review
- Citation: scripts/check-openapi-runtime-parity.cjs:233-254; __tests__/api-canonical-release.test.ts:50-62; lib/website/customerApplications.ts:1-3
- Location: scripts/check-openapi-runtime-parity.cjs:233-254; __tests__/api-canonical-release.test.ts:50-62; lib/website/customerApplications.ts:1-3
- Spec basis: ../../upload/Pasted markdown(20260810-093430).md:83; quality/REQUIREMENTS.md (REQ mapping)
- Minimal reproduction: Run api:openapi-parity after customer application logic has moved behind the facade.
- Covers: [REQ-006/cell-P057-GLOBAL, REQ-011/cell-P056-GLOBAL]
- Consolidation rationale: The listed cells share the same cited root cause and close through one implementation boundary; splitting them would duplicate the fix without independent behavior.
- Actual behavior: Checks search the re-export facade for commercial assertions now implemented in customerApplicationProcess.ts.
- Expected behavior: Verification follows the real module graph/source set and fails only when runtime enforcement is absent.
- Regression test: regression_bug_007_parity_follows_split_runtime in quality/test_regression.test.ts
- Regression patch: quality/patches/BUG-007-regression-test.patch
- Proposed fix: quality/patches/BUG-007-fix.patch
- Status: CLOSED — green regression verified on 2026-08-10

### BUG-008: Repository migration source is behind the official dev ledger

- Primary requirement: REQ-011
- Severity: HIGH
- Source: Code Review
- Citation: supabase/migrations/ (ends at 20260809143000) versus connected gridex-ops-dev ledger 20260809180628-20260809191135
- Location: supabase/migrations/ (ends at 20260809143000) versus connected gridex-ops-dev ledger 20260809180628-20260809191135
- Spec basis: ../../upload/Pasted markdown(20260810-093430).md:127; quality/REQUIREMENTS.md (REQ mapping)
- Minimal reproduction: Compare connected dev ledger versions with files under supabase/migrations.
- Covers: [REQ-008/cell-P062-GLOBAL, REQ-011/cell-P042-GLOBAL, REQ-011/cell-P061-GLOBAL, REQ-011/cell-P062-GLOBAL]
- Consolidation rationale: The listed cells share the same cited root cause and close through one implementation boundary; splitting them would duplicate the fix without independent behavior.
- Actual behavior: Ten applied statements for indexes, constraints, keysets, auth, identity and fingerprints are absent from the archive.
- Expected behavior: Restore the exact official statements so clean replay and catalog parity reconstruct connected dev.
- Regression test: regression_bug_008_live_migration_tail_is_present in quality/test_regression.test.ts
- Regression patch: quality/patches/BUG-008-regression-test.patch
- Proposed fix: quality/patches/BUG-008-fix.patch
- Status: CLOSED — green regression verified on 2026-08-10

### BUG-009: Webhook projection and signing are not tenant-specific closed contracts

- Primary requirement: REQ-010
- Severity: HIGH
- Source: Code Review
- Citation: lib/integrations/webhooks.ts:57-175; lib/integrations/tenantWebsiteProvisioning.ts:187-235
- Location: lib/integrations/webhooks.ts:57-175; lib/integrations/tenantWebsiteProvisioning.ts:187-235
- Spec basis: ../../upload/Pasted markdown(20260810-093430).md:102; quality/REQUIREMENTS.md (REQ mapping)
- Minimal reproduction: Provision two subscriptions without secret references and add an unregistered payload property.
- Covers: [REQ-010/cell-P036-GLOBAL, REQ-010/cell-P037-GLOBAL, REQ-010/cell-P038-GLOBAL, REQ-010/cell-P060-GLOBAL, REQ-011/cell-P060-GLOBAL]
- Consolidation rationale: The listed cells share the same cited root cause and close through one implementation boundary; splitting them would duplicate the fix without independent behavior.
- Actual behavior: Payloads are blacklist-sanitized and a subscription without a secret reference may use a global fallback.
- Expected behavior: Registered event/version allowlists and per-subscription active/previous secret versions, without weakening durable delivery.
- Regression test: regression_bug_009_webhooks_fail_closed_per_tenant in quality/test_regression.test.ts
- Regression patch: quality/patches/BUG-009-regression-test.patch
- Proposed fix: quality/patches/BUG-009-fix.patch
- Status: CLOSED — green regression verified on 2026-08-10

### BUG-010: Registry rate class and live atomic authentication are ignored by runtime

- Primary requirement: REQ-008
- Severity: HIGH
- Source: Code Review
- Citation: lib/api/publicRouteRegistry.ts:1-67; lib/integrations/apiAuth.ts:294-460
- Location: lib/api/publicRouteRegistry.ts:1-67; lib/integrations/apiAuth.ts:294-460
- Spec basis: ../../upload/Pasted markdown(20260810-093430).md:92; quality/REQUIREMENTS.md (REQ mapping)
- Minimal reproduction: Call read, write and expensive routes while the atomic auth RPC is present live.
- Covers: [REQ-008/cell-P026-GLOBAL, REQ-008/cell-P027-GLOBAL, REQ-008/cell-P059-GLOBAL, REQ-008/cell-P062-GLOBAL, REQ-008/cell-P073-GLOBAL, REQ-011/cell-P059-GLOBAL]
- Consolidation rationale: The listed cells share the same cited root cause and close through one implementation boundary; splitting them would duplicate the fix without independent behavior.
- Actual behavior: The limiter uses a flat client limit and authentication performs separate client/company/rate queries instead of the live authenticate_integration_request_v1 RPC.
- Expected behavior: Pass registry cost into one fail-closed atomic authentication/rate decision and preserve tenant isolation.
- Regression test: regression_bug_010_auth_uses_route_cost_rpc in quality/test_regression.test.ts
- Regression patch: quality/patches/BUG-010-regression-test.patch
- Proposed fix: quality/patches/BUG-010-fix.patch
- Status: CLOSED — green regression verified on 2026-08-10

### BUG-011: Final Customer Portal serializer accepts arbitrary public output

- Primary requirement: REQ-001
- Severity: HIGH
- Source: Code Review
- Citation: lib/customer-portal/externalApi.ts:31-108; lib/customer-portal/publicDto.ts:31-339
- Location: lib/customer-portal/externalApi.ts:31-108; lib/customer-portal/publicDto.ts:31-339
- Spec basis: ../../upload/Pasted markdown(20260810-093430).md:67; quality/REQUIREMENTS.md (REQ mapping)
- Minimal reproduction: Pass a success object containing data.nested.company_id to customerPortalJson.
- Covers: [REQ-001/cell-P001-GLOBAL, REQ-001/cell-P002-GLOBAL, REQ-001/cell-P003-GLOBAL]
- Consolidation rationale: The listed cells share the same cited root cause and close through one implementation boundary; splitting them would duplicate the fix without independent behavior.
- Actual behavior: Most mappers allowlist fields, but customerPortalJson serializes unconstrained success objects with no output schema or recursive forbidden key/value check.
- Expected behavior: Validate the exact operation DTO and reject forbidden names/UUIDs at the final response boundary.
- Regression test: regression_bug_011_serializer_rejects_internal_fields in quality/test_regression.test.ts
- Regression patch: quality/patches/BUG-011-regression-test.patch
- Proposed fix: quality/patches/BUG-011-fix.patch
- Status: CLOSED — green regression verified on 2026-08-10

### BUG-012: Public-contract feed loads select-star before computing cache response

- Primary requirement: REQ-009
- Severity: MEDIUM
- Source: Code Review
- Citation: lib/website/publicContracts.ts:2325-2355,2588-2605; app/api/v1/website/public-contracts/route.ts:128-169
- Location: lib/website/publicContracts.ts:2325-2355,2588-2605; app/api/v1/website/public-contracts/route.ts:128-169
- Spec basis: ../../upload/Pasted markdown(20260810-093430).md:97; quality/REQUIREMENTS.md (REQ mapping)
- Minimal reproduction: Request public contracts with a matching If-None-Match and inspect DB calls.
- Covers: [REQ-001/cell-P031-GLOBAL, REQ-001/cell-P032-GLOBAL, REQ-009/cell-P031-GLOBAL, REQ-009/cell-P032-GLOBAL, REQ-009/cell-P033-GLOBAL]
- Consolidation rationale: The listed cells share the same cited root cause and close through one implementation boundary; splitting them would duplicate the fix without independent behavior.
- Actual behavior: Hot reads pull every view column and the route builds the full feed before comparing the response ETag.
- Expected behavior: Use explicit public projections and query a tenant publication fingerprint first for immediate 304.
- Regression test: regression_bug_012_public_contracts_use_projection_and_early_fingerprint in quality/test_regression.test.ts
- Regression patch: quality/patches/BUG-012-regression-test.patch
- Proposed fix: quality/patches/BUG-012-fix.patch
- Status: CLOSED — green regression verified on 2026-08-10

### BUG-013: Portal identity resolver RPC exists live but runtime still executes divergent fallbacks

- Primary requirement: REQ-008
- Severity: HIGH
- Source: Code Review
- Citation: lib/customer-portal/customerResolver.ts:118-170,234-348; connected migration 20260809182554_resolve_portal_customer_identity_v1
- Location: lib/customer-portal/customerResolver.ts:118-170,234-348; connected migration 20260809182554_resolve_portal_customer_identity_v1
- Spec basis: ../../upload/Pasted markdown(20260810-093430).md:95; quality/REQUIREMENTS.md (REQ mapping)
- Minimal reproduction: Provide duplicate or conflicting portal identity signals for one tenant.
- Covers: [REQ-008/cell-P029-GLOBAL, REQ-008/cell-P030-GLOBAL]
- Consolidation rationale: The listed cells share the same cited root cause and close through one implementation boundary; splitting them would duplicate the fix without independent behavior.
- Actual behavior: Runtime performs several fallback queries with different ambiguity behavior and does not call the canonical live resolver.
- Expected behavior: Use the tenant-bound resolver policy in one roundtrip and return explicit match/ambiguity state.
- Regression test: regression_bug_013_identity_uses_canonical_rpc in quality/test_regression.test.ts
- Regression patch: quality/patches/BUG-013-regression-test.patch
- Proposed fix: quality/patches/BUG-013-fix.patch
- Status: CLOSED — green regression verified on 2026-08-10

### BUG-014: New tenant profile still provisions legacy portal scopes and no automatic smoke flow

- Primary requirement: REQ-007
- Severity: MEDIUM
- Source: Code Review
- Citation: supabase/migrations/20260724170000_single_api_key_tenant_website_integration.sql:34-57; lib/integrations/tenantWebsiteProvisioning.ts:276-466
- Location: supabase/migrations/20260724170000_single_api_key_tenant_website_integration.sql:34-57; lib/integrations/tenantWebsiteProvisioning.ts:276-466
- Spec basis: ../../upload/Pasted markdown(20260810-093430).md:88; quality/REQUIREMENTS.md (REQ mapping)
- Minimal reproduction: Provision a new tenant_website profile and inspect granted scopes and post-provision calls.
- Covers: [REQ-007/cell-P022-GLOBAL, REQ-007/cell-P023-GLOBAL, REQ-007/cell-P067-GLOBAL, REQ-008/cell-P022-GLOBAL]
- Consolidation rationale: The listed cells share the same cited root cause and close through one implementation boundary; splitting them would duplicate the fix without independent behavior.
- Actual behavior: tenant_website default scopes include customer_portal.read/write aliases and provisioning ends at readiness reconciliation without executing the requested context/public-contract/portal smoke flow.
- Expected behavior: Provision granular scopes only, publish an explicit legacy sunset, and run a harmless real-client smoke check.
- Regression test: regression_bug_014_new_tenant_uses_granular_scopes_and_smoke in quality/test_regression.test.ts
- Regression patch: quality/patches/BUG-014-regression-test.patch
- Proposed fix: quality/patches/BUG-014-fix.patch
- Status: CLOSED — green regression verified on 2026-08-10
