# PHASE-42 handover — canonical multitenant website application flow

The source repair is complete and dependency-free verification is green. The new
database migration is not applied and the application is not deployed.

## What changed

- One canonical readiness service now decides whether any tenant may accept
  website applications. Scopes alone cannot set launch readiness.
- Intake verifies operation policy and fails closed on missing database schema.
- Customer portal ownership requires two equal UUID fields and verified durable
  account/identity persistence. Tenant portal URL is canonical and HTTPS-only.
- Status is application-lineage bound and projects real contract, continuation,
  mail and webhook state.
- Failed/partial committed applications resume under the same idempotency key.
- Domain events create durable fan-out jobs. Every workflow transition emits
  `customer_application.status_changed`; switch/supply states also emit
  `supplier_switch.updated`.
- Public contract is version `2026-08-04.1` and the versioned routes read
  archived immutable specs.

## Database safety

`20260804121000_multitenant_website_application_flow_completion.sql` compiled
successfully against live `gridex-ops-dev` inside a rolled-back transaction.
No new changes were persisted.

The live effects of `20260804003000` and `20260804093500` match local function
body hashes exactly and have correct ACL/trigger/constraint/backfill state, while
the ledger rows are absent. The sync script independently repeats this check and
only then runs `migration repair`; partial or mismatched state aborts.

## Resume

```bash
export GRIDEX_SUPABASE_PROJECT_REF=piidsfebjqjmnepdpnas
export DATABASE_URL='postgresql://...'
./scripts/sync-multitenant-website-application-flow.sh
```

Then deploy OPS, provision Gridex and a second tenant, and require a successful
application, customer number, customer mail, portal bundle, polling state and
signed webhook for both tenants.

## Do not claim yet

- migration applied;
- application deployed;
- clean npm install/build;
- real two-tenant end-to-end success.
