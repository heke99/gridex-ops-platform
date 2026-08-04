# Current state

Last updated: 2026-08-04T13:03:20+02:00

## PHASE-42 source state

- Canonical website readiness is tenant-neutral and checks tenant lifecycle,
  scopes/origins, public contracts, legal bundle, verified email, templates,
  automation user/cron, facility mailbox, portal URL and operation policy.
- Historical `launch_ready` values are invalidated by the forward migration and
  must be recomputed through the canonical service.
- Website applications require equal `auth_user_id` and
  `customer_portal_user_id`; portal identity/account persistence is re-read and
  verified, and identities cannot move between customers.
- Status uses exact contract/site/meter lineage and reads actual contract,
  continuation job, communication/outbox and webhook fan-out/delivery records.
- Workflow RPC is mandatory; missing schema no longer falls back to partial writes.
- Durable workflow events now match default tenant webhook subscriptions:
  `customer_application.status_changed` and `supplier_switch.updated`.
- OpenAPI/docs version is `2026-08-04.1`; the versioned route imports an archived
  immutable release copy.

## Database state

- Live project: `piidsfebjqjmnepdpnas` (`gridex-ops-dev`).
- New migration was compiled in a full live transaction and rolled back; no live
  mutation was persisted.
- Effects for `20260804003000` and `20260804093500` exist live but ledger rows are
  absent. Function bodies match local SHA-256 exactly, ACL/trigger/constraint are
  correct and fee backfill gaps are zero.
- Sync script now verifies those facts itself and refuses unsafe `migration repair`.

## Verification

- Full dependency-free PHASE-42 static suite: pass.
- Migration integrity: 362 files / 266 groups, checksums pass.
- API/OpenAPI/runtime/docs parity: pass at `2026-08-04.1`.
- Canonical multitenant, single-key (110 checks), application review,
  continuation and PHASE-42 regressions: pass.
- Broad contract/market/portfolio/onboarding/idempotency regressions: pass.
- 22 changed TS/TSX files transpile with TypeScript 5.8.3; changed JSON parses;
  `git diff --check` and shell syntax pass.
- Full project `tsc` is not valid without installed Next/React/Supabase/Node types.

## Deployment state

- Database migration: NOT APPLIED.
- Repository changes: IMPLEMENTED AND STATICALLY VERIFIED.
- Running OPS application: NOT DEPLOYED.
- Two-tenant live E2E: NOT RUN.
