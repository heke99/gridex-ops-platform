# Full E2E Execution Protocol

This protocol is intentionally generic. Project-specific business journeys, identities, URLs, commands, safety constraints, and expected outcomes live in `/PROJECT_E2E.yaml`.

## 1. Establish execution identity

Capture before any mutation:

- repository and branch
- commit SHA
- dirty/clean state when a worktree is available
- target environment and deployment
- database/project identity
- package manager, framework and runtime
- CI workflow state
- configured external providers
- test-data prefix / cleanup policy

Never print secret values.

## 2. Discover the actual system

Inspect the implementation rather than relying on prior chat context:

- `package.json` scripts and lockfile
- UI routes and server/API entrypoints
- auth/session/RBAC helpers
- tenant/company ownership model
- database schema, forward migrations and generated types
- service-role / SECURITY DEFINER paths
- queues, cron jobs, events, outbox and webhook delivery
- email/SMS/document/signing providers
- external market/payment/partner APIs
- OpenAPI or other published contracts
- existing unit, integration, regression and E2E suites
- Vercel/deployment configuration and runtime logs
- recent branch diff

Map each P0 journey as:

`entry -> client trigger -> server/API -> domain service -> persistence -> async/external effect -> read-back -> user-visible completion`

## 3. Quality baseline

Prefer repository-native scripts. Run configured release gates in order. Typical categories:

1. clean install / lockfile integrity
2. migration integrity and clean replay where supported
3. generated database type drift
4. lint
5. application/script/test typechecks
6. unit/integration tests
7. contract/OpenAPI checks
8. tenant/security regressions
9. production build
10. CI/check status
11. Preview/Production deployment health
12. database security/performance advisors

A failed independent static gate should not prevent gathering evidence from other safe independent gates, but it prevents GREEN.

## 4. Scenario execution

For every scenario:

### Preconditions
Create or identify isolated test fixtures. Confirm role, company/tenant, environment and required external sandbox/test identities.

### Browser boundary
For browser scenarios:
- load the actual page
- wait for stable content
- detect framework error overlays
- inspect console errors and failed requests
- perform real navigation/form actions
- verify loading, validation and error states
- run critical public/customer journeys at desktop and mobile viewport when configured
- capture screenshots/checkpoints without sensitive information

Critical UI journeys must not be replaced by direct API-only tests.

### API/server boundary
Assert:
- method and route
- authentication and authorization
- input validation
- tenant/company scope
- expected status and response schema
- idempotency/replay handling
- correct failure semantics
- correlation/request identifier where available

### Database boundary
After every P0 write, verify:
- correct tenant/company/customer ownership
- expected status/state transition
- expected foreign keys and uniqueness
- no duplicate or orphan rows
- audit/event rows
- expected derived records
- forbidden cross-tenant reads/writes fail from the real role context

### Async/external boundary
Where applicable verify:
- event/outbox row created
- queue/job reaches intended terminal state
- webhook delivery exists and is attempted
- provider accepts email/SMS/document request
- delivery status is distinguished from provider acceptance
- external market/partner request is created only after prerequisites pass
- retry/failure path is observable and safe

### Read-back boundary
Verify the intended state is retrievable through the same customer/admin/partner surface the product promises and is rendered correctly.

## 5. Required negative coverage

For applicable P0 paths exercise:

- missing required input
- malformed input
- duplicate submit / double click
- request replay / idempotency
- expired/invalid session
- wrong role
- cross-tenant/company object access
- paused/suspended/archived company
- missing prerequisite data
- provider 4xx/5xx or controlled failure fixture
- retry/recovery
- refresh/re-entry during multi-step flow
- partial failure after a primary write

Safe failure is a pass only if state remains consistent, retry/recovery is correct, and feedback is actionable.

## 6. Failure discipline

When a scenario fails:

1. identify the first broken boundary
2. preserve browser/request/log/database evidence
3. do not continue past that boundary in the same scenario
4. continue independent scenarios
5. correlate browser, runtime logs, DB, events/queues and provider state
6. identify root cause
7. if remediation is authorized, use repository TDD/debugging rules, add regression coverage and implement the smallest production-quality fix
8. rerun the failed scenario and neighboring affected scenarios
9. rerun full P0 if shared auth, tenancy, database helpers, routing or core domain code changed

Never hide unresolved failures.

## 7. Security and tenancy

Treat these as release blockers until disproven:

- cross-tenant/company read or write
- role escalation
- UI-only authorization with direct API bypass
- service-role leakage
- missing RLS/grants protection
- wrong-company events, communications, invoices, contracts or market messages
- sensitive fields exposed to an unauthorized actor
- production/test identity crossover

## 8. Performance sanity

For critical journeys inspect available evidence for:

- repeated unnecessary client requests
- full reloads where not required
- obvious N+1 database access
- large/unbounded payloads
- slow query/advisor findings
- missing critical indexes
- runtime latency outliers

This is a release sanity check, not a substitute for dedicated load testing.

## 9. Cleanup

Every mutating scenario must have a cleanup result. Prefer tagged test records and project-provided cleanup utilities. Never delete real production data or broad-match by customer-like fields.

## 10. Final report

Produce:

- release verdict: GREEN / YELLOW / RED
- execution identity
- quality-gate matrix
- scenario matrix with P0/P1/P2 and PASS/FAIL/BLOCKED/NOT_RUN
- detailed evidence for every P0 scenario
- security/tenant-isolation result
- database/migration/type result
- external-integration result
- deployment result
- defects, root causes, fixes and regression evidence
- cleanup result
- explicit remaining blockers

A required scenario that was not actually run must remain `NOT_RUN` or `BLOCKED`; never infer PASS.
