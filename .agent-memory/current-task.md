# Current task

Last updated: 2026-08-06T08:40:00Z
Branch: `cursor/codebase-health-and-stability-609b`

## Active phase

PHASE-45 — Codebase health after OpenAPI `2026-08-05.2` publish.

## Goal

Close the gaps left by the incomplete `2026-08-05.2` publish on main:
quote integrity hardening, required quote example `offer`, and fail-closed
local OpenAPI release verification.

## Implemented

- Canonicalize top-level quote timestamptz (`valid_until`,
  `market_data_timestamp`) via `canonicalQuoteTimestamptz`.
- Shared nullable/case-insensitive `canonicalQuoteGridAreaCode` for snapshot,
  resolution and quote-row compares.
- Finalize seeds required quote example `offer` and re-normalizes contract
  versions after late example assignment.
- Rematerialized immutable website OpenAPI `2026-08-05.2` so release bytes
  match current (includes required `offer`).
- `verify-openapi-release` now requires matching immutable JSON/routes and
  publicRouteRegistry entries.
- Strengthened website quote integrity and null grid-area regressions.

## Verification

- `gridex:quote-null-grid-area-regression`: PASS
- `gridex:website-quote-integrity-regression`: PASS
- `api:release:verify`: PASS
- API documentation version, compatibility and public-contract runtime: PASS
- Full dependency-backed typecheck/test/lint/build: NOT RUN (no node_modules)

## Exact next action

Open/merge the health PR, deploy OPS, then run one live website quote create →
validate smoke with PostgREST-returned timestamptz and a null grid area.
