# Gridex OPS remediation workstream plan

## Program rules

- Every branch starts from the then-current `origin/main`; audit branches are evidence/donors only.
- PR #74 is not merged, rebased, force-pushed or used as a bulk cherry-pick source.
- Each PR contains one finding or one tightly related root-cause class, its regression, report, staging requirement and rollback/forward-fix.
- At most one overlapping database/RLS remediation branch is active at a time.
- The next database migration is not started until the previous migration PR has been reviewed and dependencies are recorded.
- `VERIFIED_CLOSED` requires exact-head CI, positive and negative tests, relevant two-tenant coverage and staging verification.

## Workstream sequence

### 1. GRIDEX-OPS-BL-002 — platform-global read isolation

- Branch: `remediation/gridex-ops-bl-002-global-read-isolation`
- Scope: four global actor-registry/EDIEL operational tables only.
- Implementation: additive migration replacing the broad authenticated `SELECT` policies with explicit `authenticated + gridex_user_is_platform_admin()` and `service_role` policies; revoke anonymous SELECT.
- Consumer boundary: keep the server-rendered `/admin/network-owners` page behind `requirePlatformAdminAccess`; preserve service-role worker reads.
- Regression: self-contained rollback test with ordinary authenticated, active tenant member, company admin, platform admin, service role and two companies.
- Exit: draft PR, migration review, isolated staging apply, regression rerun, admin page and worker smoke checks, exact-head CI.

### 2. GRIDEX-OPS-BL-001 — permission-aware writes

- Branch: `remediation/gridex-ops-bl-001-write-permissions`
- Start condition: WS1 migration PR reviewed and its policy dependencies documented.
- Reproduce the seven baseline policy families on current main/live schema.
- Replace raw `company_memberships` OR paths with the canonical fail-closed write helper or explicit active membership plus the correct permission.
- Test INSERT/UPDATE/DELETE separately for owner, company admin, operations, compliance, read-only, inactive, cross-tenant and service role.
- Split into more than one PR if the seven tables do not share the same helper/invariant or migration risk.

### 3. Leaked-password protection

- Branch: `remediation/gridex-ops-leaked-password-protection`
- Change only non-production first.
- Record the exact Supabase Auth control without exposing keys or user data.
- Test compromised and strong passwords through signup, reset and password change; messages must be actionable but not disclose provider internals.
- Production change requires separate explicit approval and a rollback decision.

### 4. V3 BUG-001 — Customer Portal sync error contract

- Branch: `remediation/gridex-ops-portal-sync-error-contract`
- Reproduce on latest main before using donor commits.
- Reimplement the smallest current-main-compatible classifier that preserves controlled 400/413 responses while keeping unexpected errors generic 500.
- Add the dedicated regression and API contract assertions.

### 5. V3 BUG-006 — immutable OpenAPI `2026-08-05.2`

- Branch: `remediation/gridex-ops-openapi-2026-08-05-2-release`
- Compare canonical current schemas with V3 donor release bytes.
- Materialize immutable blobs and versioned routes only when byte/schema identity is proven.
- Verify current and immutable routes, cache headers, compatibility, release manifest and mutation prevention.
- Never edit a release after it is considered published; issue a later version for forward correction.

### 6A. V3 BUG-007 — lint module bindings

- Branch: `remediation/gridex-ops-lint-module-bindings`
- Reproduce both lint errors on main.
- Rename only the local bindings; do not disable or weaken lint rules.
- Run focused behavior regressions, lint, full tests and build.

### 6B. V3 BUG-008 — contract test fixtures

- Branch: `remediation/gridex-ops-contract-test-fixtures`
- Reproduce stale fixture failures on main.
- Update test evidence/current-version expectations only.
- Preserve strict legal SHA-256 validation and the explicit historical-null scenario.
- Coordinate current-version expectation with WS5 without combining branches.

### 7. Expanded hardening gate

- Branch: `remediation/gridex-ops-expanded-hardening-gate`
- Port only current-main-compatible workflow pieces from V3.
- Required steps: migration integrity, application/script/test typecheck, lint, focused regressions, full suite, API compatibility, immutable release verification, security audit, build, repository-approved SAST, redacted diff secret scan and dependency audit.
- Add controlled negative fixtures that prove each gate turns red when its invariant is intentionally broken.
- Artifacts and logs must not contain secrets, tokens or sensitive payloads.

### 8. RLS policy consolidation

- Branches: one table family per branch, named `remediation/gridex-ops-rls-<family>`.
- Export policy/grant/helper inventory first.
- Detect duplicate permissive policies, OR bypass and per-row helper cost.
- Measure representative plans before/after; use `(select auth.uid())` or stable helper subqueries only where semantically correct and measured.
- Add indexes only when the plan demonstrates a need.
- No mass policy rewrite and no overlap with an active BL-001/BL-002 policy branch.

### 9. Full two-tenant assurance

- Branch: `assurance/gridex-ops-two-tenant-e2e`
- Build positive/negative fixtures for authentication, sessions, membership, RBAC/RLS, website API, Customer Portal, quotes, applications, contracts, legal bundles, POA, billing, documents/storage, exports, jobs, notifications, audit events, actor registry, EDIEL and provider webhooks.
- Assert every record/action against tenant, company, user/system actor, customer, contract, request/correlation ID and audit trail.
- Product defects discovered here receive stable IDs and separate remediation branches unless they share one existing root cause.

### 10. Security and supply chain

Use separate focused branches for:

- CodeQL or repository-approved equivalent and Semgrep;
- current-tree and history secret scans with redaction;
- dependency advisory reachability and Dependabot;
- GitHub Action SHA pinning where appropriate;
- service-role call-site inventory;
- storage policy review;
- webhook signature, replay and idempotency;
- SSRF, path traversal, file upload, unsafe deserialization, SQL injection and PII/log redaction.

A discovered secret is rotated through the appropriate operational process and never copied into a report, issue or commit.

### 11. Performance and large modules

- First deliverables: responsibility map, dependency graph, characterization tests, payload/query/round-trip measurements and stable extraction boundaries.
- Priority areas: `lib/website/customerApplications.ts`, SQL/RLS plans, N+1 and round trips, payload size, memory/build size, server/client boundaries and cron/batch scaling.
- Extract one responsibility at a time with no behavior change; file size alone does not justify refactoring.

### 12. Deployment and observability

- Verify on staging: health/readiness, structured logs, request/correlation IDs, error rate, latency, database saturation, job/webhook failures, retry/dead-letter behavior, alerts, deployment parity and rollback/forward-fix.
- Produce/update incident runbooks and perform a controlled rollback or forward-fix drill.
- Do not infer production readiness from Vercel deployment status alone.

## PR #74 supersession gate

PR #74 may be closed as superseded only after every relevant V3 production fix has a separate main-based PR/owner, the reconciliation report is linked and audit evidence remains accessible. It is never merged as the remediation vehicle.

## Immediate next branch

After Workstream 1 has been reviewed and its migration dependency is documented, the next recommended branch is exactly:

`remediation/gridex-ops-bl-001-write-permissions`
