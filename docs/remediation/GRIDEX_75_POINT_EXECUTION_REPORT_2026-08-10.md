# Gridex OPS — execution report for the 75-point remediation

Date: 2026-08-10  
Source: supplied `gridex-ops-platform-main` archive  
Connected database: `gridex-ops-dev` (`piidsfebjqjmnepdpnas`, `eu-north-1`)  
Decision: **code and connected-dev scope complete; release NO-GO pending external gates**

## Executive result

The existing implementation was changed in place. No replacement or parallel platform was created. The confirmed API, portal, authentication, idempotency, OpenAPI, webhook, migration and tenant-onboarding defects were fixed and protected by executable tests. The connected dev database was migrated through `20260810110829_retention_category_classification.sql`, then its schema was used to regenerate and hash-pin `supabase/database.types.ts`.

The campaign is not honestly releasable from this workspace. The supplied archive has no `.git`, only dev Supabase is connected, clean replay could not run without Docker/Supabase CLI, hosted GitHub checks and Vercel deployment evidence are unavailable, and Supabase Auth leaked-password protection is a hosted setting. Those are release blockers, not reasons to invent a passing result.

No geodata cleanup was executed. The new function was invoked in dry-run mode only.

## Point-by-point disposition

Legend: `COMPLETE` means implemented and verified in source/tests and, where applicable, connected dev. `PARTIAL` means the implementation exists but an environment proof is still missing. `BLOCKED` requires an unavailable external system or authority.

| # | Status | Executed result |
|---:|---|---|
| 1 | COMPLETE | `/customer/me` and portal sync use explicit public DTOs and no longer spread internal rows/identity IDs. |
| 2 | COMPLETE | DB models are mapped through explicit public DTO mappers with runtime output validation. |
| 3 | COMPLETE | Recursive final-response gate rejects forbidden internal field names and UUID-like internal values; compatibility exceptions are exact and sunset-bound. |
| 4 | COMPLETE | Portal list pagination moved to PostgreSQL keyset reads with `limit + 1` and opaque encrypted cursors. |
| 5 | COMPLETE | Contracts, sites, invoices, metering, documents, events, notifications, legal acceptances and powers of attorney use the canonical paging boundary or verified direct read model. |
| 6 | COMPLETE | Invoice detail uses one tenant/customer-bound `invoice_reference` lookup backed by a unique index. |
| 7 | COMPLETE | Exhausted schema fallbacks raise `platform_schema_not_ready`/503 instead of returning empty success. |
| 8 | COMPLETE | External writes with idempotency metadata use the shared durable wrapper, including portal sync. |
| 9 | COMPLETE | Claims bind tenant, API client, operation, resource/customer, key and canonical request hash; cross-tenant same-key behavior is tested. |
| 10 | COMPLETE | Compatibility classification is shared by runtime, OpenAPI, manifest, docs and tests. |
| 11 | COMPLETE | `PUBLIC_API_ROUTES` is the canonical operation metadata registry. |
| 12 | COMPLETE | OpenAPI operation paths/IDs/scopes/idempotency/rate metadata are generated and synchronized from canonical metadata. |
| 13 | COMPLETE | Operation IDs are syntactically validated and unique within each public document. |
| 14 | COMPLETE | Summaries/descriptions, including portal sync, derive from operation metadata and parity tests. |
| 15 | COMPLETE | Contract release fields are synchronized at `2026-08-10.1`; immutable historical releases, including `2026-08-05.2`, remain intact. |
| 16 | COMPLETE | External response schemas use explicit DTO schemas and closed objects instead of broad placeholders. |
| 17 | COMPLETE | Fixture/runtime responses are validated against the published schemas and final public-field safety gate. |
| 18 | COMPLETE | Developer examples are fixture-backed and included in documentation parity gates. |
| 19 | COMPLETE | `/integration/context` returns the canonical opaque tenant/client bootstrap, versions, URLs, auth model and readiness/capabilities. |
| 20 | COMPLETE | API client references are persisted/random or cryptographically opaque; UUID formatting is not used as the abstraction. |
| 21 | COMPLETE | Tenant provisioning emits an Integration Pack with one-time credential, references, scopes, limits, URLs, readiness and optional webhook material. |
| 22 | COMPLETE | New `tenant_website` clients receive granular scopes only; both live dev clients were normalized. |
| 23 | COMPLETE | Legacy portal scopes remain compatibility aliases with explicit classification/sunset and are not newly provisioned. |
| 24 | COMPLETE | OpenAPI models bearer authentication separately from Gridex `x-required-scopes`; it does not claim OAuth2. |
| 25 | COMPLETE | The database-backed tenant/API-client limiter remains atomic and fail-closed. |
| 26 | COMPLETE | Route classes have weighted costs (`read=1`, `write=3`, `expensive=10`) consumed by the auth RPC. |
| 27 | COMPLETE | `authenticate_integration_request_v1` atomically verifies token, client/tenant state, scope, policy and quota. |
| 28 | COMPLETE | Origin/CORS remains a browser policy; server authentication is token + tenant + scopes + quota. |
| 29 | COMPLETE | Portal identity runtime calls `resolve_portal_customer_identity_v1`. |
| 30 | COMPLETE | Strong/weak/manual match outcomes and ambiguity are explicit and tenant-bound; identity signals do not authorize alone. |
| 31 | COMPLETE | Portal routes use explicit public projections/read models rather than raw public-table rows. |
| 32 | COMPLETE | Hot public-contract reads no longer use `select('*')`. |
| 33 | COMPLETE | The publication fingerprint RPC is read before building the public-contract feed, enabling an early 304. |
| 34 | COMPLETE | Independent reads are grouped where safe; domain decisions use canonical RPC/read-model boundaries. |
| 35 | COMPLETE | Business/audit/idempotency truth remains transaction-critical while noncritical telemetry stays outside success truth. |
| 36 | COMPLETE | `WEBHOOK_EVENT_REGISTRY` defines event version, schema, fields and mapper metadata. |
| 37 | COMPLETE | Webhooks use explicit event DTO projections; recursive blacklist sanitization was removed. |
| 38 | COMPLETE | New production subscriptions require their own secret reference/version; the global signing fallback was removed. |
| 39 | COMPLETE | Durable deliveries retain retry/backoff, locks, dead-letter/paused state, public references and signature timestamps. |
| 40 | COMPLETE | Thirteen exact redundant non-unique indexes were dependency-checked and removed in a forward migration. |
| 41 | COMPLETE | The canonical invoice keyset index is retained and the duplicate hot index removed. |
| 42 | COMPLETE | The official dev constraint-validation migration tail was restored and applied; no historical migration was edited. |
| 43 | BLOCKED | Production constraint/schema parity cannot be checked because no production Supabase project is connected. |
| 44 | COMPLETE | Existing fail-closed RLS/security-definer architecture was preserved; no permissive security rewrite was introduced. |
| 45 | COMPLETE | Zero-policy tables were verified as service-only. `platform_schema_state` anon/auth DML grants were revoked; permissive policies were not added to silence the advisor. |
| 46 | BLOCKED | Leaked-password protection must be enabled and verified in the hosted Supabase Auth dashboard. |
| 47 | PARTIAL | Service-role-only geodata lifecycle cleanup with retention and dry-run was added. Dry-run found 220 old versions and 61,380 feature candidates (~1.50 GiB raw row bytes); deletion was intentionally not run. |
| 48 | COMPLETE | Fourteen retention categories now separate legal/security audit, telemetry, API, Ediel, cron, notifications, readiness and geodata classes. |
| 49 | PARTIAL | Canonical portal indexes exist and an index plan was observed in dev; representative `EXPLAIN (ANALYZE, BUFFERS)`, write amplification and production load evidence remain unavailable. |
| 50 | COMPLETE | Immutable release OpenAPI caching remains aggressive; latest/manifest behavior remains dynamic as specified. |
| 51 | COMPLETE | Historical operational regressions remain in the test/gate suite and CI workflow. |
| 52 | COMPLETE | Canonical error envelope with request/correlation/contract metadata is enforced and OpenAPI-checked. |
| 53 | COMPLETE | Auth, scope, neutral not-found, conflict, validation, quota and unavailable states map to distinct canonical status codes. |
| 54 | COMPLETE | External lookup/error behavior is tenant-bound and neutral about resources in another tenant. |
| 55 | COMPLETE | Public references are stable/opaque but every lookup repeats the server-resolved tenant predicate. |
| 56 | COMPLETE | CI now includes fixture/integration response and public-output safety checks, not only source-string parity. |
| 57 | COMPLETE | Mechanical/API gates check route bijection, operation IDs, scopes, idempotency, rate class, schemas, forbidden IDs, immutable bytes and manifest. |
| 58 | COMPLETE | Pagination regressions cover deep traversal/tie ordering and the keyset/`limit+1` implementation boundary. |
| 59 | COMPLETE | Multi-tenant isolation tests cover overlapping external values, idempotency keys, scopes and tenant-bound lookup behavior. |
| 60 | COMPLETE | Webhook tests enforce per-tenant secret, delivery and retry isolation. |
| 61 | PARTIAL | A deterministic checksum-pinned clean-replay CI job exists and its shell is statically valid; it was not executed locally because Docker/Supabase CLI are unavailable. |
| 62 | COMPLETE | Repo/runtime/OpenAPI expectations and connected-dev columns, indexes, grants, RPCs and migrations are synchronized; live types are hash-pinned. |
| 63 | PARTIAL | Mandatory workflow now runs lint, types, tests, quality/mechanical/API/RBAC/generated-file/migration/security/build/replay gates. No current hosted GitHub run is available as evidence. |
| 64 | BLOCKED | Exact merged Git = CI = Vercel production SHA cannot be proven from a zip without `.git` or GitHub/Vercel access. |
| 65 | PARTIAL | Stale memory was replaced with truthful archive/dev state, and CI now rejects a completed campaign whose declared SHA differs from checked-out HEAD. A verified SHA cannot be recorded in this archive. |
| 66 | COMPLETE | Canonical readiness combines active client/tenant, scopes, public references, portal setup, contract compatibility and webhook state. |
| 67 | COMPLETE | Provisioning runs context/public-contract/portal/read smoke flow with the real client and stores a receipt. |
| 68 | COMPLETE | Strict OpenAPI and generated TypeScript/database artifacts provide the supported client-generation path. |
| 69 | COMPLETE | Public DTO schemas/mappers version the contract independently of internal schema migrations. |
| 70 | COMPLETE | Deprecated fields/scopes/releases carry replacement/sunset metadata and are parity-tested. |
| 71 | BLOCKED | Production p50/p95/p99 and DB/compute/external timing require a deployed release and traffic/observability access. |
| 72 | COMPLETE | Optimizations preserve fresh authorization/tenant/quota decisions and cache only safe immutable/revision data. |
| 73 | COMPLETE | Auth DB, limiter, schema and tenant-state uncertainty remain fail-closed. |
| 74 | COMPLETE | `docs/integration/NEW_TENANT_CANONICAL_INTEGRATION.md` documents the key → context → generated client → idempotency → 429/503 → webhook flow with no internal IDs. |
| 75 | BLOCKED | Final campaign closure requires points 43, 46, 61, 63, 64 and 71 to pass in their real environments. |

## Connected-dev database evidence

- Latest applied source/live migration: `20260810110829_retention_category_classification.sql`.
- Migration inventory: 393 SQL files, 297 timestamp groups; new source files are checksum-pinned.
- Tenant website clients: 2 active, 2 granularized, 0 remaining legacy scope aliases on client/profile configuration.
- Invoice reference integrity: zero null, invalid or duplicate rows; unique index valid and trigger enabled (the table currently has zero rows).
- Index hygiene: 13 exact redundant non-unique index names removed; zero removed names remain.
- `platform_schema_state`: anon/auth DML privileges revoked.
- Geodata cleanup execution: dry-run only; 0 deleted features; all 280 current verified-staging features remained untouched.
- Retention: 14 distinct policy categories including 10-year legal audit, 3-year security audit and 14-day geodata staging.
- Hot portal indexes verified: contracts, sites, invoices, invoice reference, notifications, legal acceptances, powers of attorney, documents, auth documents and domain events.
- Generated types SHA-256: `8bba8b45cebbc2eb33567704f2129ad2237adc5dc05984ec03705903cf16970f`.
- Immutable Website OpenAPI `2026-08-10.1` SHA-256: `0dbe7cd7fb3f14f97fa8785c8809b9d6549ab6e05435757b77b4f010a233519b`.
- Immutable Customer Portal OpenAPI `2026-08-10.1` SHA-256: `5543676bd67f4b55183e2618bb4f9af541936293395b8c650947992b523fb675`.

## Security advisor decisions

The connected dev advisor returned 59 informational RLS-with-no-policy findings, 11 authenticated SECURITY DEFINER warnings and one leaked-password warning. The zero-policy tables were checked as intentionally service-only and were not given permissive policies. The security-definer functions were reviewed as RLS/auth/self-authorized boundaries rather than blindly revoked. The hosted password setting remains an explicit blocker.

- [RLS enabled with no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Authenticated SECURITY DEFINER executable](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Password strength and leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

## Verification receipt

Executed in this workspace:

- Quality suite: 45/45 passing.
- Application suite: 70 files, 467/467 passing.
- TypeScript application check: passing.
- Lint: passing with 141 pre-existing warnings and zero errors.
- Migration integrity/generated-types gate: passing.
- API documentation/parity/release gates: passing.
- RBAC audit: 24 checks passing.
- Production dependency audit: zero vulnerabilities.
- Next.js production build: passing under the repository's supported Node 22 CI configuration (local runtime was Node 24).
- Mechanical master verifier: 75 points, 12 mapped requirements, 65 operation IDs, zero errors; compensation union exact.

Not executed or not available:

- clean empty-database replay against a local Docker Supabase stack;
- hosted GitHub Actions receipt;
- staging/production Supabase parity;
- hosted Auth configuration change;
- Vercel exact-SHA deployment/smoke and production latency percentiles.

## Required release sequence

1. Check out the real repository SHA and update `source_state.verified_git_sha` only on that commit.
2. Run all required GitHub jobs, including clean migration replay, without bypassing failures.
3. Compare staging and production migrations/schema/grants/RPC signatures to the verified repo contract.
4. Enable and verify leaked-password protection where password authentication is enabled.
5. Deploy the exact checked/merged SHA and prove Git SHA = CI SHA = Vercel SHA.
6. Run tenant smoke/isolation/webhook tests and capture p50/p95/p99 with DB, compute and dependency timings.
7. Mark status `COMPLETE` only after every blocker above has attached evidence.
