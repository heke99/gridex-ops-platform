# Current task

Last updated: 2026-08-06T08:58:00Z
Branch: `cursor/codebase-health-and-stability-6531`

## Active phase

PHASE-45 — Complete incomplete OpenAPI `2026-08-05.2` health package and related
quote/grid-area integrity hardening.

## Goal

Close the incomplete main publish of OpenAPI `2026-08-05.2` so quote integrity,
immutable release verification, market-price examples and related case-sensitive
grid/price-area compares cannot fail later. Carry the package onto the current
automation tip after the skill-contract sync and close remaining case-compare
variants.

## Implemented

- Merged verified `ec6b` health package onto `6531` (above main `ffe4d0b0`).
- Canonicalized top-level quote timestamptz hashing (`valid_until`,
  `market_data_timestamp`).
- Shared nullable/case-insensitive quote `grid_area_code` normalization.
- Fail-closed local OpenAPI release verification for immutable artifacts and
  registry routes.
- Seeded required quote example `offer` and rematerialized matching release
  bytes.
- Normalized application and metering-point grid/price area compares.
- Completed current-market-price example required fields and developer-guide
  contract version sync.
- Persisted uppercase website quote `price_area` and case-insensitive validate
  / snapshot compares (H-009).
- Normalized AI/BI import grid-area discrepancy compares (H-010).
- Recorded findings under `quality/findings-2026-08-06-codebase-health.md`.

## Verification

- Quote null-grid-area, quote integrity, AI/BI grid-area case, explicit-input,
  OpenAPI example, version, compatibility, public-contract runtime and local
  release verify: PASS.
- Full dependency-backed typecheck/test/lint/build: BLOCKED (`node_modules`
  absent).
- Live quote E2E: PENDING deploy.

## Exact next action

Open/refresh the PR for `cursor/codebase-health-and-stability-6531`, prefer it
over overlapping sibling health PRs, then deploy and run live quote create →
validate E2E.
