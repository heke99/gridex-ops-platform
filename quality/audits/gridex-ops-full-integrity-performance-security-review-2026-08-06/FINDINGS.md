# Findings

Status vocabulary follows the audit request. Production remains unverified unless explicitly stated.

## GRIDEX-AUD-001 — Customer-document storage is not company scoped

- Severity: `HIGH`; Confidence: `CONFIRMED`; Status: `CONFIRMED_OPEN`
- Root cause: `storage.objects` policies for bucket `customer-documents` call global `gridex_has_permission(auth.uid(), ...)` but never bind the company UUID in `name` to active company membership or customer ownership.
- Exact evidence: current `pg_policies`; `gridex_has_permission(uuid,text)` -> `gridex_get_user_permissions(uuid)`; all 9 current objects have nested paths containing a `companies.id`, none is compared by policy.
- Roles/tenants: any authenticated principal with `masterdata.read` or `switching.read`; every tenant with customer documents.
- Path: obtain permission in company A -> list/read/insert/update a company-B path.
- Impact: customer/legal document disclosure, overwrite or poisoning; privacy, contract evidence and incident exposure.
- Reproduction/negative test: company-A user selects/inserts/updates/deletes a known company-B object; current policy should demonstrate access. Passing test must deny all four operations.
- Positive test: same authorized role may perform only allowed operations in company A/customer scope.
- Remediation: parse/validate path schema; call company-aware active membership and permission helper; bind customer/application/contract where applicable; separate read/write/delete permissions.
- Forward-fix/rollback: additive policy replacement with explicit service-role path; rollback must not restore global policy. Dependency: agreed path schema and consumer inventory.
- Verification: SQL role matrix, storage client E2E, signed URL/list tests, two tenants, inactive membership, suspended company, platform admin and service worker.

## GRIDEX-AUD-002 — Quote hashes change for equivalent timestamps

- Severity: `HIGH`; Confidence: `CONFIRMED`; Status: `CONFIRMED_OPEN`
- Root cause: `lib/pricing/quoteIntegrity.ts` canonicalizes only `valid_until`; `lib/pricing/websiteQuotes.ts` includes raw `market_data_timestamp` in the hash payload.
- Affected: website quote create/validate/application, all tenant websites using market timestamp.
- Path: persist timestamp as JS `Z` -> PostgreSQL/PostgREST returns `+00:00` -> recomputed JSON bytes/hash differ -> quote rejected as changed.
- Impact: legitimate customer cannot sign; misleading generic failure; support/revenue impact.
- Reproduction: fixed quote payload with same instant in both forms must currently produce mismatch. Negative test must reject genuinely different instant; positive must accept equivalent zones.
- Remediation: one canonical payload function for every timestamp, nullable code, decimal and ordered collection included in hashes; version behavior deliberately.
- Forward-fix: preserve existing hash-version compatibility or migrate/dual-validate explicitly; never silently rewrite accepted quote evidence.
- Verification: unit fixtures plus live create -> DB read -> validate -> application in non-production, OpenAPI/error contract and logs.

## GRIDEX-AUD-003 — Migration provenance is not one replayable chain

- Severity: `HIGH`; Confidence: `CONFIRMED`; Status: `CONFIRMED_OPEN`
- Root cause/evidence: repo has hundreds of migrations; official dev ledger has 46 rows beginning `20260531045730`; canonical manifest has 94 checksum rows but ends `20260612221000`; duplicate timestamp prefixes exist.
- Affected: every schema/RLS/API-dependent release and disaster recovery; production status unknown.
- Failure path: deployment decides pending/applied state from incomplete identity -> skips, duplicates or cannot reproduce schema; recovery branch differs from live.
- Impact: data loss/outage/security-policy drift and unverifiable rollback.
- Test: clean isolated replay and schema/policy/function/type fingerprint comparison. Negative test detects missing/renamed/duplicate/checksum-divergent migration.
- Remediation: immutable full inventory and baseline mapping; normalized statement/file hashes; extend manifest; explicit environment ledger comparison.
- Forward-fix only; do not rename/rewrite applied historical migrations. Verification requires fresh Supabase branch, full RLS/API regressions and production pre/post checks.

## GRIDEX-AUD-004 — `main` is unprotected

- Severity: `MEDIUM`; Confidence: `CONFIRMED`; Status: `CONFIRMED_OPEN`
- Evidence: GitHub repository metadata reports default branch `main`, `protected:false`.
- Affected: all deployments, contributors/tokens with push permission.
- Path/impact: direct or force push can bypass review and required checks, deploying broken/security-sensitive changes.
- Tests: repository rule query must show PR-only changes, required status contexts, review and force/deletion restrictions.
- Remediation: ruleset/branch protection; least-privilege tokens; environment approvals.
- Rollback: rules can be relaxed only through documented emergency procedure; verify a test PR cannot merge with failing/missing checks.

## GRIDEX-AUD-005 — Email OTP remains valid for 24 hours

- Severity: `MEDIUM`; Confidence: `CONFIRMED`; Status: `CONFIRMED_OPEN`
- Evidence: Security Advisor reports `86400` seconds; five duplicate rows normalized to one issue.
- Affected: email OTP/signup/reset/invitation users.
- Path/impact: intercepted token has extended replay window.
- Tests: expired token denied, fresh token single-use, no account enumeration; all auth flows.
- Remediation: <=3,600 seconds after non-production UX/provider testing; production setting change with rollback to prior value if delivery latency proves incompatible.

## GRIDEX-AUD-006 — EDIEL directory cache write violates fingerprint constraint

- Severity: `MEDIUM`; Confidence: `CONFIRMED`; Status: `CONFIRMED_OPEN`
- Evidence: PostgreSQL log: null `sha256_fingerprint` violates NOT NULL on `ediel_certificate_directory_cache`.
- Affected: certificate refresh/directory consumers, platform operations and tenants relying on routing readiness.
- Path/impact: missing derivation/provider data -> failed cache write -> stale/incomplete certificate state.
- Tests: missing/invalid certificate input must fail safely without partial promotion; valid input persists deterministic fingerprint; retry idempotent.
- Remediation: validate/derive fingerprint before transaction; structured job error/attempt; atomic upsert and conflict semantics.
- Forward-fix preferred; do not weaken NOT NULL without domain proof. Verify worker, DB state and redacted logs.

## GRIDEX-AUD-007 — CI omits material release gates

- Severity: `MEDIUM`; Confidence: `CONFIRMED`; Status: `CONFIRMED_OPEN`
- Evidence: only `ops-hardening.yml`; exact-head run passed configured checks but workflow omits lint, build, full tests, script/test typechecks, complete OpenAPI/type checks, SAST, secret/history scan, bundle and browser E2E.
- Affected: all code/API/database releases.
- Path/impact: green CI can coexist with compile, contract, security, bundle or runtime failures.
- Tests: introduce controlled failing fixture per gate and prove PR blocked.
- Remediation: layered required workflows; exact-head and protected branch; non-production DB/E2E jobs.
- Rollback: revert individual flaky gate only with tracked exception, owner and expiry.

## GRIDEX-AUD-008 — Grid-owner view/RPC are measured slow paths

- Severity: `MEDIUM`; Confidence: `CONFIRMED`; Status: `CONFIRMED_OPEN`
- Evidence: `gridex_verified_grid_owners_v` signatures average ~0.5-2.2 s; completion RPC ~7.39 s over 55 calls.
- Affected: energy-area/grid-owner admin, imports/completion and dependent APIs.
- Path/impact: slow request/cron, timeout/backlog and poor UX.
- Tests: exact SQL with representative parameters and `EXPLAIN (ANALYZE, BUFFERS)`; concurrency/lock test.
- Remediation: only measured query/view/materialization/index/batching change while preserving authorization/freshness.
- Rollback: revert if improvement is within variance or correctness/freshness regresses.

## GRIDEX-AUD-009 — Logs contain personal data and full statements

- Severity: `MEDIUM`; Confidence: `CONFIRMED`; Status: `CONFIRMED_OPEN`
- Evidence: Auth logs include user IDs, names, email and IP; PostgreSQL logs contain full migration/regression statements.
- Affected: users, operators, incident/log consumers.
- Path/impact: broader privacy breach scope and excessive retention/access risk.
- Tests: capture representative auth/API/DB errors and assert tokens, keys, contacts, person numbers, documents and payloads are absent.
- Remediation: minimization/redaction, field allowlist, retention, access audit and secure incident export.
- Forward-fix; preserve safe IDs/error codes. Verification includes provider and Vercel/Supabase log sinks.

## GRIDEX-AUD-010 — Auth/session calls appear amplified

- Severity: `MEDIUM`; Confidence: `LIKELY`; Status: `LIKELY_OPEN`
- Evidence: bursts of many `/user` requests within seconds from cloud/server addresses.
- Affected: authenticated UI, Supabase Auth load and logs.
- Likely path/impact: repeated session resolution per component/request -> latency, cost and rate-limit pressure.
- Reproduction: instrument one navigation/render with call-site trace and count. Positive target must be defined without caching stale authorization.
- Remediation: deduplicate request-scoped resolution or consolidate server context; never cross-user/tenant cache.
- Verification: auth calls/navigation, role freshness, logout/revocation and concurrent tabs.

## GRIDEX-AUD-011 — Production and separate staging parity are blocked

- Severity: `MEDIUM`; Confidence: `POSSIBLE`; Status: `BLOCKED`
- Evidence: only `gridex-ops-dev` is connected; Vercel configuration/runtime unavailable.
- Affected: every production claim.
- Risk: production may differ in migrations, RLS, Auth, keys, OpenAPI or deployment SHA.
- Required verification: read-only production inventory/advisors/ledger/schema fingerprint, deployed commit/API version, post-deploy role/quote/portal tests.
- Remediation is evidence collection, not assumed code change. No production mutation is authorized by this audit.

## GRIDEX-AUD-012 — Agent memory is stale

- Severity: `LOW`; Confidence: `CONFIRMED`; Status: `CONFIRMED_OPEN`
- Evidence: `.agent-memory` still describes contract `2026-08-05.1`, older branch/worktree and blockers while current main has `2026-08-05.2` and merged PR #84.
- Affected: operators/agents and future change decisions.
- Impact: work can be based on obsolete API or deployment state.
- Test/remediation: CI freshness validator against main SHA, contract manifest and open PR state; update only from verified release evidence.
- Rollback: revert inaccurate memory update; never treat memory as source of truth.

## GRIDEX-AUD-013 — Website application orchestration is an oversized change surface

- Severity: `LOW`; Confidence: `LIKELY`; Status: `LIKELY_OPEN`
- Evidence: prior exact audit measured `lib/website/customerApplications.ts` above 8,400 lines with validation, identity, pricing, legal, persistence and side effects; current path remains central.
- Affected: website signup and many domains.
- Risk: regression/coupling and hard profiling; line count alone is not latency proof.
- Test/remediation: current exact line/dependency scan, characterization tests, then incremental responsibility extraction with no behavior change.
- Rollback: revert each extraction independently; compare quote/application/idempotency/two-tenant behavior.

## GRIDEX-AUD-014 — Advisor output contains stale object findings

- Severity: `INFORMATIONAL`; Confidence: `CONFIRMED`; Status: `FALSE_POSITIVE`
- Evidence: advisor referenced `notifications`, `suppliers`, `application_staging`, `contacts`; current catalog returns no such relations.
- Impact: automated remediation could create/drop wrong indexes or distract from live issues.
- Remediation/test: require `to_regclass`, current policies/indexes and consumer query before action; close stale rows as false positive, not as fixed performance.

## GRIDEX-AUD-015 — Selected global reference reads are intentional but require classification

- Severity: `INFORMATIONAL`; Confidence: `CONFIRMED`; Status: `CONFIRMED_OPEN`
- Evidence: authenticated `USING(true)` remains on selected EDIEL rule/reference and RBAC metadata tables.
- Affected: authenticated users globally.
- Risk: acceptable only if columns are non-sensitive reference data and writes are restricted.
- Test/remediation: column/data classification, anonymous/authenticated read matrix, no tenant operational rows, write denial; replace with narrower API if sensitive fields exist.

## Inherited remediation status

`GRIDEX-OPS-BL-002` is present on current `main` and dev as `CODE_REMEDIATED`: four platform-global operational read policies now require platform admin or service role. It remains not `VERIFIED_CLOSED` until production apply and post-deploy application/role tests are proven.