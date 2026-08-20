# Production masterplan evidence register

Date: 2026-08-20
Scope: GitHub repository, Vercel production telemetry/deployment metadata, Supabase `gridex-ops-dev`.

## Executive result

The audited P0 correctness path is repaired and the database invariant is live in the development project. The P1/P2 pass removes blocking usage telemetry from external response paths, profiles the public-contract fingerprint, classifies current Supabase advisors, splits every one of the 19 grandfathered source files below 1,800 lines, removes two verified N+1 read patterns, and adds enforceable bundle/SLO/N+1 gates. The byte-identical tested tree is published in draft PR #169. Hosted CI is running, and a same-repository maintainer label gate allows the approved staging browser/k6/ZAP matrix to use repository secrets without exposing them locally. Production Supabase parity remains blocked because no OPS production project is exposed by the connector.

## Skill routing

Activated: repository baseline/quality playbook, refactor, test-driven development, Supabase/Postgres review, GitHub publication, Vercel deployment/verification, full E2E verification, and completion verification. Security, contract, migration, performance and tenant-isolation gates remained active because the diff crosses all of those boundaries. UI redesign, reusable-skill creation, Stripe, image/document generation and unrelated platform skills were skipped because their triggers are absent. Parallel-agent skills were not used because this execution context does not authorize sub-agent delegation.

## Confirmed and remediated

| Area | Confirmed defect | Remediation | Evidence |
|---|---|---|---|
| Billing provider | Cron/runtime invented fallback providers and environments | Require tenant-configured target system and explicit test/production environment | P0 regression and typecheck pass |
| Per-customer readiness | One blocked underlay stopped the monthly run | Track blocked underlays independently and export only ready underlays | Billing tests and P0 regression pass |
| Pricing lock | Runtime accepted `success` as invoice-export eligible | Runtime now requires exact `locked`; DB trigger enforces the same invariant | Supabase trigger verified; anon/authenticated execute denied |
| Spot settlement | Cron imported/verifed prices but did not lock settlement | Cron locks each requested price-area month before downstream pricing | Settlement tests and P0 regression pass |
| Notification IDs | Public write contract accepted internal UUIDs and returned internal identifiers | Contract now accepts tenant-bound opaque `notification_references`; response contains no internal ID | Runtime/OpenAPI parity pass |
| API drift | Current public contract was stale | Immutable OpenAPI release `2026-08-20.1` generated with synchronized docs/routes/manifest | Compatibility and release verification pass |

## P1/P2 performance and maintainability pass

| Area | Result | Evidence |
|---|---|---|
| External API response latency | Best-effort usage events are scheduled with Next.js `after`; request-context fallback remains deterministic | Four website routes use `scheduleUsageEvent`; focused scheduling/fallback regression passes |
| Public-contract fingerprint | Current live function is an O(1) revision lookup, not the historical full-feed hash | Live `EXPLAIN (ANALYZE, BUFFERS)` returned one row in 6.693 ms, 0 disk reads and 0 temp blocks |
| Historical timeout cluster | The 19 errors belong to deployment `c802043b...`; current production deployment `22d2b483...` has observed 200/304 responses and no matching runtime error | Vercel deployment/log comparison plus live function definition |
| Conditional-read load coverage | Added an authenticated k6 profile that performs a full read, captures ETag, requires a 304 on `If-None-Match`, and applies separate full/304 p95/p99 thresholds | Static k6/tooling regression passes; execution awaits staging URL/token |
| Large source files | All 19 legacy monoliths are split behind stable public facades | Zero grandfathered files; every app/lib/script source is at or below 1,800 lines and the ratchet passes |
| N+1 reads | Portal claim contacts/sites/metering points and continuation job lookup performed reads per candidate/workflow | Both paths now batch their reads; AST gate reports zero unapproved awaited database reads inside loops across public API, portal, pricing and website code |
| Browser bundle | No repeatable browser chunk budget existed | Largest fresh production chunk is 222,348 bytes against a 230,000-byte ceiling; three customer/contract route budgets pass |
| Performance SLO | k6 thresholds existed independently in five profiles | One checked budget contract now covers smoke, load, spike, soak, full-feed and ETag 304 thresholds; CI validates it |
| OpenAPI fixture drift | Release generator now writes the version-bound production-like fixture; public-contract metadata consistently requires `organization_reference` and excludes `tenant_reference` | Docs examples, runtime/OpenAPI, release-byte and compatibility gates pass |

## Already satisfied or false-positive assertions

| Assertion | Repository/database evidence |
|---|---|
| Monthly spot average lacked one canonical implementation | Latest development migration already implements duration-weighted monthly averaging |
| Invoice export graph signature was inconsistent | Live `gridex_create_invoice_export_graph_v1(p_run,p_items,p_invoices)` already matches runtime expectations and returns `jsonb` |
| Customer portal lacked invoice, metering, and document APIs | Public routes and OpenAPI operations already exist |
| Resolver fix was absent from production | Current Vercel production deployment is commit `22d2b4834577ad96b31c4373832a0507397c65e3`, the merged resolver fix; no authenticated post-fix smoke credential was available |

## Open production blockers

| Priority | Blocker | Required closure |
|---|---|---|
| P0 | Draft PR #169 is published but hosted CI/staging certification is not yet complete | Require green hosted gates and retain their evidence before merge |
| P0 | No production Supabase project was visible | Identify production project and run parity/dry-run before any production migration |
| P0 | Authenticated resolver and end-to-end customer journey not smoke-tested after the live fix | Provide/use approved tenant test credentials and run non-destructive end-to-end smoke tests |
| P1 | Invoice detail filesystem parameter remains `[id]` although runtime resolves an opaque invoice reference | Rename route segment and tests without changing the public path contract |
| P1 | Auth database pool uses an absolute maximum of 10 connections | Change to percentage allocation before relying on instance resizing; verify in the actual production project |
| P2 | The authenticated k6 matrix is not yet executed | Create the Vercel branch preview, use the configured scoped staging token, and retain smoke/load/spike/ETag/soak artifacts |
| P2 | Production-shaped retry/outbox soak and long-horizon telemetry remain broader program work | Run after hosted preview/CI and production database identity are proven |

## Supabase advisor triage

| Advisor | Count | Classification |
|---|---:|---|
| `unused_index` | 1,099 | INFO only; no exact duplicate public indexes found. No bulk removal without representative observation/query evidence. |
| `auth_db_connections_absolute` | 1 | Capacity configuration; Auth max 10. Snapshot showed 13/60 total DB connections and 1 active. |
| `rls_enabled_no_policy` | 3 | Accepted deny-by-default service tables: `customer_contract_signature_requests`, `dependency_circuit_state`, `platform_runtime_readiness`; no anon/authenticated grants. |
| `authenticated_security_definer_function_executable` | 13 | Accepted caller-bound RBAC/read/self-service allowlist; anon execute is false and search paths are pinned. Effective account anonymization is self-only, owner-blocked and session-revoking. |

The cumulative 1.126 TB temp-I/O counter is dominated by Supabase/PostgREST schema and metadata introspection queries in `pg_stat_statements`, not a Gridex business query. It remains a platform-observation item, but it is not evidence for an application index change.

## Tenant and contract boundary matrix

| Surface | Tenant resolution | Public identifier | Internal identifier exposure |
|---|---|---|---|
| Customer notification read mutation | API auth context + customer identity | `notification_reference` | None in request/response |
| Invoice export | Company-scoped readiness and pricing run lookup | Internal job surface only | Not a public API |
| Public contract feed | API credential organization | `offer_reference` and tenant reference | Runtime/OpenAPI parity gate rejects internal fields |
| Customer invoice detail | API auth context + customer relation | Invoice reference resolved internally | No raw database UUID intended |

## Verification matrix

| Gate | Result |
|---|---|
| App TypeScript | PASS |
| Vitest | PASS — 98 files, 699 tests |
| Next.js production build | PASS |
| OpenAPI compatibility | PASS — `2026-08-20.1` |
| Runtime/OpenAPI parity | PASS |
| Immutable OpenAPI release verification | PASS locally |
| Version-bound public-contract fixture | PASS — `2026-08-20.1` |
| P0 masterplan regression | PASS — 6 controls |
| Migration history/integrity | PASS — 476 files, 380 groups |
| Generated Supabase types | PASS; trigger adds no type surface |
| Production dependency audit | PASS — 0 vulnerabilities |
| Supabase development trigger | PASS — security invoker, trigger installed, no anon/authenticated execute grant |
| Supabase advisor hardening regression | PASS |
| Large-file 1,800-line ratchet | PASS — 0 grandfathered files; all source files comply |
| Public-path N+1 read gate | PASS — 0 unapproved awaited database reads inside loops |
| Browser bundle budget | PASS — largest chunk 222,348 bytes; three route budgets green |
| k6 SLO contract | PASS — smoke/load/spike/soak/full/304 thresholds aligned |
| k6 ETag/304 profile wiring | PASS statically; live staging execution pending |

## Observability evidence

Vercel seven-day telemetry showed one resolver rejection on an older deployment, 19 public-contract database statement timeouts and two usage-event timeout writes on older code, several expected admin validation failures, one refresh-token reuse event, and a transient Supabase DNS error in a manual-email cron. The current production deployment has observed 200/304 public-contract responses without the historical error, the current fingerprint plan is bounded, and usage telemetry is deferred locally. Staging load and post-deploy observation are still required before production certification.

## Go-live decision

`NO-GO` for production promotion at this checkpoint. Local correctness, refactor, performance, security, contract and build gates are green, and draft PR #169 is published. Production promotion still requires green hosted CI/preview, authenticated smoke/load evidence, and positive identification/parity verification of the OPS production Supabase project.
