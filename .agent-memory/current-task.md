# Current task

Last updated: 2026-08-04T13:03:20+02:00
Branch: master
Last verified commit: 97c37c4 (working tree modified)

## Active phase

PHASE-42 — Canonical multitenant website application, customer portal and tenant status delivery.

## Goal

One identical, fail-closed code and database path for every tenant:
API-key tenant resolution, canonical customer graph and customer number, durable
portal ownership, tenant mail, facility/switch continuation, exact status
projection, polling/webhook delivery, idempotent resume and reproducible database
migrations.

## Implemented

- Replaced scopes-only launch readiness with one canonical tenant readiness service.
- Enforced tenant operation policy before website intake.
- Made portal identity and tenant-owned portal URL mandatory and fail-closed.
- Corrected exact application lineage for switch, supply and contract status.
- Projected job, mail, webhook fan-out and delivery truth in the public status API.
- Added terminal continuation projection in worker and database trigger.
- Added resumable failed/partial application handling without duplicate customer graph.
- Added durable webhook fan-out with stale-lock recovery and dead letter behavior.
- Every workflow transition now emits `customer_application.status_changed`; switch/supply states also emit `supplier_switch.updated`.
- Versioned and archived OpenAPI `2026-08-04.1` and aligned developer documentation.
- Added migration `20260804121000_multitenant_website_application_flow_completion.sql`, safe ledger pre-verification, postflight SQL and sync script.

## Exact next action

Apply database changes before deploying application code:

1. Export `DATABASE_URL` and `GRIDEX_SUPABASE_PROJECT_REF`.
2. Run `scripts/sync-multitenant-website-application-flow.sh`.
3. Deploy OPS code.
4. Re-provision Gridex and a second tenant through canonical readiness.
5. Execute one real application per tenant and verify customer number, mail,
   portal bundle, polling and signed webhook.

## Remaining blockers

- The new migration has been rollback-compiled against live Supabase but has not been applied.
- No application code has been deployed from this working tree.
- No active tenant webhook existed during the live read-only audit.
- A real two-tenant E2E requires tenant API credentials, portal users and webhook endpoints.
- Clean `npm ci`/Next build is blocked in this sandbox by package mirror 404 for `zod-validation-error@4.0.2`.

## Release decision

SOURCE READY / DATABASE APPLY AND ENVIRONMENT E2E PENDING. Do not accept production
website applications with the new code until the migration and postflight pass.
