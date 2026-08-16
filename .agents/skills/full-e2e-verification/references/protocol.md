# Full E2E Execution Protocol

This protocol is project-agnostic. Project-specific journeys, target/tenant discovery, identities, URLs, commands, capability rules, safety constraints, and expected outcomes live in `/PROJECT_E2E.yaml`.

## 1. Resolve execution scope first

Before any mutation, decide whether the run is:

- a strict single target/tenant/account; or
- all configured/eligible targets.

An explicit user target always wins over the project default.

For strict single-target mode:

- resolve exactly one canonical target;
- zero or multiple matches are `BLOCKED`;
- never broaden to every target;
- never run another target's business journey;
- never mutate another target;
- run shared/global release gates once;
- run the selected target from first applicable entrypoint through terminal business outcome;
- after a fix, rerun only the selected target's affected P0 set unless the user broadens scope.

For all-target mode:

- discover targets from the canonical source;
- classify capabilities/readiness per target;
- complete one target before moving to the next;
- never assume identical capabilities.

## 2. Establish execution identity

Capture before mutation:

- repository, branch and commit SHA;
- dirty/clean state when a worktree is available;
- target environment/deployment;
- database/project identity;
- selected target(s), canonical IDs/slugs, and scope mode;
- package manager/framework/runtime;
- CI state;
- configured external providers;
- test-data prefix and cleanup policy.

Never print secret values.

## 3. Discover the actual system

Inspect implementation rather than relying on prior chat context:

- `package.json` scripts and lockfile;
- UI routes and API/server entrypoints;
- auth/session/RBAC;
- tenant/account ownership model;
- DB schema, migrations and generated types;
- SECURITY DEFINER/service-role paths;
- queues, jobs, cron, events/outbox/webhooks;
- email/SMS/document/signing providers;
- external APIs;
- OpenAPI/published contracts;
- existing unit/integration/regression/E2E suites;
- deployment configuration/runtime logs;
- recent branch diff.

Map each P0 journey:

`entry -> browser/client trigger -> auth -> API/server -> domain service -> persistence -> async/external effect -> read-back -> user-visible completion`

## 4. Capability classification

Before running a target scenario, classify it:

- `enabled/expected`: execute it;
- `disabled by design`: `NOT_APPLICABLE`;
- `expected but missing prerequisite/configuration`: `BLOCKED`;
- `enabled but runtime behavior is wrong`: `FAIL`.

Configuration alone never proves `PASS`.

A scenario must not be skipped merely because a readiness view says "ready"; the actual business flow still has to execute.

## 5. Quality baseline

Prefer repository-native commands. Typical gates:

1. clean install / lockfile integrity;
2. migration integrity / clean replay;
3. generated database type drift;
4. lint;
5. app/script/test typechecks;
6. unit/integration tests;
7. API/OpenAPI contract checks;
8. tenant/security regressions;
9. production build;
10. CI/check status;
11. Preview/Production deployment health;
12. DB security/performance advisors.

Run shared gates once per execution scope unless a fix invalidates them.

A failed required gate prevents GREEN but should not prevent gathering safe independent evidence.

## 6. Scenario execution

### Preconditions

Create or identify isolated fixtures. Confirm target/tenant, actor/role, environment, capabilities, and required external sandbox/test identities.

Every mutating fixture must be uniquely tagged with run ID + target identity.

### Browser boundary

Use the repo-local browser skill when present.

For browser-required scenarios:

- open the real page;
- wait for stable load;
- check runtime/framework error overlays;
- inspect console failures and failed requests;
- execute the real user flow;
- re-snapshot after navigation/DOM replacement;
- verify validation/loading/error states;
- capture sanitized checkpoints;
- verify terminal UI/read-back.

Critical UI journeys cannot be replaced by API-only tests.

### API/server boundary

Assert:

- route/method;
- authentication/authorization;
- input validation;
- target/tenant scope;
- response status/schema;
- idempotency/replay;
- failure semantics;
- request/correlation ID where available.

### Database boundary

After P0 writes verify:

- exact target/company/account owner;
- expected state transition;
- foreign keys/uniqueness;
- no duplicate/orphan rows;
- audit/event rows;
- expected derived records.

In strict single-target mode, do not mutate another tenant to prove isolation.

### Async/external boundary

Where applicable verify:

- event/outbox record;
- job/queue terminal state;
- webhook attempt/retry;
- provider acceptance of email/SMS/document;
- delivery separately from acceptance;
- external market/partner request only after readiness prerequisites;
- safe failure/retry behavior.

### Read-back boundary

Verify the promised customer/admin/partner/API surface returns the same canonical state and renders it correctly.

## 7. Negative coverage

Exercise configured cases such as:

- missing/malformed input;
- duplicate submit/double click;
- request replay;
- expired/invalid session;
- unauthorized role;
- missing prerequisite;
- paused/suspended/archived state;
- provider controlled 4xx/5xx;
- retry/recovery;
- refresh/re-entry;
- partial failure after primary write.

In all-target mode, run configured cross-tenant isolation tests.

In strict single-target mode, do not touch another tenant unless the user explicitly adds cross-tenant comparison to scope. Prefer anonymous, unauthorized, expired, or non-member actors against the selected tenant.

## 8. Failure → fix → rerun discipline

When a scenario fails:

1. identify the first broken boundary;
2. preserve browser/request/log/DB/queue/provider evidence;
3. stop only that scenario after the broken boundary;
4. continue independent in-scope scenarios;
5. correlate all evidence;
6. identify root cause;
7. if remediation is authorized, use repository TDD/debugging rules;
8. add or strengthen regression coverage;
9. implement the smallest production-quality root-cause fix;
10. rerun the failed scenario from its first entrypoint;
11. rerun neighboring affected checks;
12. rerun in-scope P0 when shared auth, tenancy, DB helpers, routing, serialization, or core domain code changed.

Never bypass security/readiness or hardcode a target just to make E2E pass.

## 9. Security and tenancy

Treat as release blockers until disproven:

- role escalation;
- object/tenant authorization bypass;
- UI-only authorization with direct API bypass;
- service-role leakage;
- unsafe SECURITY DEFINER exposure;
- missing RLS/grants;
- wrong-target events, communications, invoices, contracts or market messages;
- sensitive-field exposure;
- production/test identity crossover.

## 10. Performance sanity

Inspect critical journeys for:

- repeated unnecessary client requests;
- unnecessary full reloads;
- obvious N+1 DB access;
- large/unbounded payloads;
- slow query/advisor findings;
- missing indexes;
- runtime latency outliers.

## 11. Cleanup

Every mutating scenario needs a cleanup result. Use only tagged fixtures and safe project cleanup mechanisms. Never broad-match or delete real customer data.

## 12. Final report

Produce:

- GREEN / YELLOW / RED verdict;
- scope mode and exact selected target(s);
- execution identity;
- quality-gate matrix;
- target capability matrix;
- scenario matrix with `PASS/FAIL/BLOCKED/NOT_APPLICABLE/NOT_RUN`;
- detailed P0 evidence;
- security/tenancy result;
- database/migration/type result;
- external-integration result;
- deployment result;
- defects, root causes, fixes and regression evidence;
- cleanup result;
- explicit remaining blockers.

A required scenario that was not actually run can never be inferred as PASS.
