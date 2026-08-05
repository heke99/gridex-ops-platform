# Current state

Last updated: 2026-08-05T22:20:00Z

## PHASE-45 quote integrity / OpenAPI sync

- Main push `b9019bd9` introduced UTC quote-hash normalization and started
  OpenAPI `2026-08-05.2`, but left docs/checks/release artifacts on
  `2026-08-05.1`.
- Branch `cursor/codebase-health-and-stability-c492` completes that sync.
- Quote integrity now canonicalizes both `valid_until` and
  `market_data_timestamp` before hashing.
- Current public contract version is `2026-08-05.2`, with required quote `offer`
  and immutable release artifacts/routes.

## Verification

- Quote integrity, contract P0, legal package and OpenAPI local gates pass.
- Full dependency-backed typecheck/test/lint/build remain unexecuted because
  `node_modules` are absent in this environment.
- Deployed release SHA verification and live quote/legal E2E remain pending.

## PHASE-44 legal package state

- Website and Customer Portal API contracts are aligned at `2026-08-05.1`.
- The customer-facing legal surface contains at most `agreement`,
  `power_of_attorney` and `withdrawal`.
- Canonical legal modules remain individually versioned and hashed. A grouped
  acceptance is expanded server-side into exact module acceptance rows.
- Public legal pages use the locked tenant legal-profile snapshot, so an old
  agreement cannot display a tenant's later company details.
- POA intake from website and Customer Portal uses the same supported scopes,
  exact legal document identity and downstream authorization chain.
- Existing authorization scopes reject a different signed scope snapshot instead
  of silently widening or rebinding authority.
- No database migration is required by this delivery; it uses the existing
  canonical bundle, acceptance, POA and authorization tables.

## Verification

- Dedicated legal package and POA regressions pass.
- API version, compatibility, examples, runtime/OpenAPI and local release checks pass.
- Changed TypeScript/TSX syntax transpilation passes.
- Full dependency-backed gates remain unexecuted because the configured package
  mirror returned 404 for `zod-validation-error@4.0.2`.

## Deployment state

- Repository changes: IMPLEMENTED AND STATICALLY VERIFIED.
- Running OPS application: NOT DEPLOYED FROM THIS DELIVERY.
- Live private/business tenant legal and supplier-switch E2E: PENDING.

## Prior phase state

Last updated: 2026-08-04T19:00:05+02:00

## PHASE-43 source state

- Customer Portal API/OpenAPI/developer documentation is aligned at contract
  version `2026-08-04.2`.
- SVK grid-area import now uses the current `Natomraden_250526` FeatureServer,
  layer 3, deterministic paging and the canonical source fields `Natomrade`,
  `Namn`, `Agare` and `Elomrade`.
- Import errors preserve feature/source diagnostics and old-source running imports
  are failed instead of resumed into a mixed geodata version.
- Billing price area is sourced from the immutable contract price snapshot first.
  Contract, underlay, metering-point and site values are consistency evidence only.
- Billing underlays and underlay items use the same locked area. Original meter-row
  area is retained only as source metadata.
- Invoice readiness loads the referenced `contract_price_snapshots` row and blocks
  missing, cross-contract or contradictory snapshot evidence.

## Database state

- Live project: `piidsfebjqjmnepdpnas` (`gridex-ops-dev`).
- Migrations `20260804190000_svk_geodata_and_billing_price_area_canonicalization`
  and `20260804193000_contract_price_snapshot_company_guard_fix` are applied and
  their live migration-ledger versions match the repository.
- The database importer recognizes the current SVK field names and validates
  geometry/price area fail-closed.
- `billing_underlays_price_area_snapshot_guard` prevents a billing underlay from
  contradicting the immutable contract snapshot.
- The broken `contract_price_snapshots` tenant guard no longer references the
  nonexistent `NEW.customer_contract_id`; it validates `NEW.contract_id`.
- The obsolete running SVK import/version was closed as
  `svk_import_source_superseded`.
- A real staged feature (BRL / SE3) passed the new importer inside a rolled-back
  verification transaction.
- Current dev data contains zero customer contracts, price snapshots and billing
  underlays, so no billing rows required backfill.
- Current active official SVK geometry count remains zero until the updated app is
  deployed and the import cron/admin action completes the current-source import.

## Verification

- SVK/billing canonical regression: PASS.
- Migration integrity: PASS (366 files / 270 version groups; checksums verified).
- Changed TypeScript/TSX syntax transpilation: PASS.
- package.json/package-lock dependency declarations: consistent.
- Live SQL migration compile/apply: PASS.
- Live parser rollback test: PASS.
- Live quote-snapshot/underlay rollback test: PASS; null area canonicalized to SE3
  and an attempted SE4 mismatch was rejected.
- Full npm typecheck/test/lint/build: NOT RUN because dependencies are absent and
  the npm registry returned DNS `EAI_AGAIN` in this sandbox.

## Deployment state

- Database migration: APPLIED.
- Repository changes: IMPLEMENTED AND STATICALLY VERIFIED.
- Running OPS application: NOT DEPLOYED FROM THIS DELIVERY.
- Current-source full SVK import: PENDING APPLICATION DEPLOYMENT/CRON.
