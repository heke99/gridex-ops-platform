# PHASE-43 handover — SVK geodata and billing price-area convergence

The database correction is live and the source package is statically verified. The
running OPS deployment has not yet been updated, so the new official SVK import has
not populated active geometry rows.

## What changed

- Current official SVK service: `Natomraden_250526`, layer 3.
- Canonical fields: `Natomrade`, `Namn`, `Agare`, `Elomrade`.
- Import paging is deterministic and a running import cannot switch source/layer.
- Promotion reports the exact failed feature and underlying PostgreSQL diagnostic.
- Billing uses `contract_price_snapshots.snapshot_json.price_area` first.
- Underlay header and items share the same locked area; source meter area is audit-only.
- Invoice readiness blocks missing/wrong snapshot links and area contradictions.
- PostgreSQL rejects underlay writes that contradict the locked contract snapshot.
- The contract-price-snapshot company guard now validates `contract_id` and rejects
  missing/cross-tenant parent contracts.
- API/docs stay on `2026-08-04.2` and describe the same behavior.

## Live Supabase

- Applied ledger versions: `20260804190000` and `20260804193000`.
- Obsolete running import/version closed as superseded.
- Real staged feature BRL / SE3 passed importer verification in a rollback transaction.
- A rollback contract/snapshot/underlay test proved SE3 canonicalization and SE4 rejection.
- No contract/billing rows existed, so no backfill was necessary.
- Active current-source geometry remains zero pending application deployment/import.

## Resume

Deploy OPS, then invoke the authenticated route:

`GET /api/internal/platform/grid-areas/import/cron`

Repeat according to the returned pagination state until the import reports no more
pages, then verify the version is `verified` and active grid-area geometry exists.

## Do not claim yet

- updated OPS code deployed;
- full current-source geometry import completed;
- dependency-backed typecheck/test/lint/build completed;
- real quote-to-invoice environment E2E completed.
