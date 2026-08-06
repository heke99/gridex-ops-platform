# Current task

Last updated: 2026-08-06T12:57:00Z
Branch: `cursor/codebase-health-and-stability-fb8e`

## Active phase

PHASE-45 — Codebase health after GRIDEX-OPS-BL-002 merge.

## Goal

Keep OpenAPI/quote integrity health package current on main tip after BL-002,
then close remaining case-normalization integrity gaps that can mis-bill or
drop public fixed/portfolio prices.

## Implemented

- Merged PHASE-45 package from `cursor/codebase-health-and-stability-6531` onto
  main+BL-002.
- Added `canonicalSwedishPriceArea` and wired billing base-component parse/filter,
  public fixed-offer completeness, and portfolio history filters.
- Aligned application site/metering grid writers with `normaliseGridAreaCode`.
- Persisted and hashed canonical quote `grid_area_code`.
- Recorded residual BL-002 RLS variants as open remediation items (no second
  overlapping migration in this PR).

## Verification

- `gridex:price-area-case-normalization-regression`: PASS
- Quote/AI-BI/OpenAPI local regressions from PHASE-45: PASS
- Full dependency-backed typecheck/test/lint/build: BLOCKED (`node_modules` absent)

## Exact next action

Open/update PR for this branch, then prefer one health merge onto main and
schedule dedicated RLS remediation for O-005/O-006.
