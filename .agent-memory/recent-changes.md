# Recent changes

## 2026-08-04 — SVK and billing price-area canonicalization

- Updated SVK geodata import from the obsolete 2024 service/layer to
  `Natomraden_250526` layer 3.
- Added exact `Natomrade`/`Namn`/`Agare`/`Elomrade` parsing, strict validation,
  deterministic paging and structured source diagnostics.
- Closed the obsolete live running import/version as superseded.
- Applied `20260804190000_svk_geodata_and_billing_price_area_canonicalization`.
- Applied `20260804193000_contract_price_snapshot_company_guard_fix` after a live
  rollback test exposed the obsolete `NEW.customer_contract_id` reference.
- Added a database trigger that rejects billing-underlay price-area drift.
- Made contract price snapshot the canonical billing area for underlay headers,
  items and invoice readiness.
- Added snapshot existence/ownership and area-conflict blockers.
- Updated developer/API documentation and added a static regression script.
- Verified a real staged BRL/SE3 feature in a rolled-back live parser test.
- Verified snapshot creation, SE3 underlay canonicalization and SE4 mismatch rejection
  in a complete rolled-back database test.

## 2026-08-05

- Added the three-document customer legal package.
- Added Customer Portal grouped acceptance expansion.
- Hardened tenant-bound POA and authorization scope reuse.
- Published API/OpenAPI release 2026-08-05.1.

- 2026-08-05T15:20:07+02:00: Customer Portal legal sync now prevalidates one acceptance format per request; draft/fallback POAs no longer emit signed events.
