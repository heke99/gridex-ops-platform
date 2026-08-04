# Current task

Last updated: 2026-08-04T19:00:05+02:00
Branch: archive working tree

## Active phase

PHASE-43 — Current SVK geodata and immutable billing price-area convergence.

## Goal

Use one canonical price-area truth from website quote through customer application,
contract snapshot, underlay, underlay items, invoice readiness and database guards,
while importing grid-area geometry from the current official SVK ArcGIS contract.

## Implemented

- Updated SVK FeatureServer/layer and exact source-field mapping.
- Added deterministic paging, source-version isolation and structured import errors.
- Replaced live DB importer/promoter functions with strict current-field validation.
- Added a DB trigger that locks billing underlay price area to the contract snapshot.
- Repaired the existing contract-price-snapshot tenant guard so snapshot creation no
  longer fails on a nonexistent trigger-record field.
- Changed underlay generation and invoice readiness to prefer the immutable snapshot.
- Added snapshot existence/ownership and price-area mismatch blockers.
- Updated Customer Portal API documentation at `2026-08-04.2`.
- Added release notes and a dependency-free regression gate.
- Applied and verified the migration in connected Supabase.

## Exact next action

1. Deploy the delivered OPS source.
2. Invoke the authenticated SVK import cron/admin action until `hasMore=false`.
3. Verify one `verified` current-source geodata version and active geometry rows.
4. Run clean Node 22 install plus full typecheck/test/lint/build in CI/local network.
5. Run a real quote -> application -> contract -> metering -> billing underlay E2E.

## Remaining blockers

- Updated application code is not deployed.
- Active current-source SVK geometry rows are still zero until the deployed import runs.
- No live contracts/underlays exist in the connected dev project for a real billing E2E.
- Full dependency-backed build gates could not run in this sandbox due npm DNS failure.

## Release decision

DATABASE READY / SOURCE READY / DEPLOYMENT AND ENVIRONMENT E2E PENDING.
