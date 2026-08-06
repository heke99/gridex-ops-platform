# Current task

Last updated: 2026-08-06T08:50:00Z
Branch: `cursor/codebase-health-and-stability-ec6b`

## Active phase

PHASE-45 — Complete incomplete OpenAPI `2026-08-05.2` health package and related
quote/grid-area integrity hardening.

## Goal

Close the incomplete main publish of OpenAPI `2026-08-05.2` so quote integrity,
immutable release verification, market-price examples and related case-sensitive
grid/price-area compares cannot fail later.

## Implemented

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
- Recorded findings under `quality/findings-2026-08-06-codebase-health.md`.

## Verification

- Quote null-grid-area, quote integrity, explicit-input, OpenAPI example,
  version, compatibility, public-contract runtime and local release verify:
  PASS.
- Full dependency-backed typecheck/test/lint/build: BLOCKED (`node_modules`
  absent).
- Live quote E2E: PENDING deploy.

## Exact next action

Merge one completed health branch onto main (this branch or sibling PR #80),
deploy OPS, then run live quote create → validate smoke for one tenant.
