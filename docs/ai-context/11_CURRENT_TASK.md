# SUPERSEDED — historical current-task record

Canonical progress and the active task now live in
`.agent-memory/current-task.md` and `.agent-memory/checkpoint.json`. The content
below is retained as historical context and must not be used as the active
checkpoint.

# Historical task — Canonical customer flow hardening (2026-07-19)

Latest batch (see 10_CHANGELOG.md 2026-07-19) hardened the canonical customer
flow end to end:

1. Customer numbers are assigned by ONE canonical generator on every intake
   channel (DB insert trigger + permanence guard + backfill,
   migration `20260719120000`). Admin intake, /teckna-avtal and Ediel inbound
   no longer create numberless customers.
2. `gridex_store_billing_underlay` upsert repaired after the energy-direction
   index change (migration `20260719121000`) — underlay generation works again.
3. Central billing readiness (`lib/billing/billingReadiness.ts`,
   `evaluateBillingReadinessCore`) with account-level gating wired into the
   month invoice readiness (recipient/distribution/VAT are now hard blockers).
4. Supplier switch verifies the canonical authorization-scope chain
   (`verifyAuthorizationScopeCoverage`, blocker `authorization_scope_missing`)
   with idempotent healing from a signed POA.
5. Canonical POA lifecycle status derivation on the customer card snapshot.
6. Regression suite repaired from 50 failing scripts to 2. The remaining two
   (`ediel-certification`, `ediel-completion`) flag a REAL pending
   consolidation: the ACK decision engine must move its AGT UE1/UE2 hardcode
   onto the certification registry and stop importing lib/ediel/testing.
   That refactor touches approved Ediel test flows — run it as its own task
   under the override protocol.

Run after applying migrations: `npm run db:migrations:check`, `typecheck`,
`typecheck:tests`, `typecheck:scripts`, `lint`, `test`, `build` and the
regression suite.

# Previous task — OPS-E + OPS-F

Current batch focuses on the daily operator layer for multi-tenant electricity retailers:

1. Customer card must be simple: status, missing data, next action, fullmakt, facility data, switch, communication and audit.
2. Facility workflow must collect missing facility ID, metering point, grid owner, price area and authorization blockers in a dedicated queue.
3. Supplier switch must not start when facility data is missing or unverified.
4. Tenant admins should work from `/admin/facility-requests`, `/admin/work-queue` and the customer card tabs, not from raw technical tables.
5. External website API documentation and AI-context documentation must stay aligned with the implementation.

Batch files added/changed:

```txt
app/admin/facility-requests/page.tsx
app/admin/customers/[id]/page.tsx
components/admin/customers/CustomerFacilityWorkflowCard.tsx
lib/admin/navigation.ts
lib/facility/workQueue.ts
docs/ops-api-customer-intake-facility.md
docs/ai-context/25_OPS_WEBSITE_INTAKE_FACILITY_CUSTOMER_CARD.md
docs/ai-context/10_CHANGELOG.md
docs/ai-context/11_CURRENT_TASK.md
supabase/migrations/20260612183000_ops_e_f_facility_work_queue_customer_cards.sql
```

## Current status — Continuation hardening (intake/POA, customer-type, manual comms, portal, perf, docs)

This batch is a continuation build (not a rebuild). It hardened the website
customer-application intake (POA-required enforcement, dedicated
`power_of_attorney` error stage/codes, idempotent-missing-POA, in-place
partial/failed marking, `repairWebsiteCustomerApplication` + admin action,
standard nested JSON error contract with `request_id`), canonicalized customer
type via a shared `lib/customers/normalizeCustomerType.ts` + DB CHECK, ensured
missing-facility intake uses the manual e-mail pipeline only (no parallel
Ediel/Z01) with outbox-failure→request reconciliation, fixed the customer-portal
invoice detail fallback, bounded two unbounded loaders, added loading skeletons,
and rewrote/updated README + API docs.

New migrations to apply: `20260629140000_website_application_partial_repaired_status.sql`,
`20260629150000_customers_customer_type_canonicalization.sql`.

Run after applying: build, typecheck, lint, `db:migrations:check`, `security:rbac`,
and the website/legal/manual/customer-card regressions.

## Current status — OPS-J..N

Remaining governance batch has been implemented at code level: platform admin owns pricing/agreement changes, customer-card lifecycle/testdata actions are audit/usage logged, platform cleanup page previews testdata candidates, and API docs are updated away from website-owned contract terms. Run SQL migration `20260612193000_ops_j_to_n_governance_audit_cleanup_docs.sql`, then build/regressions.
