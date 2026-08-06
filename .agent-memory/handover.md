# PHASE-45 handover — OpenAPI and quote health package

Branch `cursor/codebase-health-and-stability-ec6b` completes the incomplete
`2026-08-05.2` main publish and related case-sensitive area compares.

## What changed

- Quote integrity hashes canonicalize top-level timestamptz fields.
- Quote and application/metering-point grid/price area compares are
  case-insensitive via shared normalizers.
- Local OpenAPI release verification fails closed on missing/divergent
  immutable artifacts and registry routes.
- Current market-price and quote examples include required schema fields.
- Developer guide examples use contract version `2026-08-05.2`.
- Findings recorded in `quality/findings-2026-08-06-codebase-health.md`.

## Verification completed

- `node --experimental-strip-types scripts/gridex-quote-null-grid-area-regression.mjs`
- `node --experimental-strip-types scripts/gridex-website-quote-integrity-regression.mjs`
- `node scripts/verify-openapi-release.cjs`
- `node scripts/check-api-documentation-examples.cjs`
- `node scripts/check-api-documentation-version.cjs`
- `node scripts/check-api-compatibility.cjs`
- `node scripts/check-public-contract-runtime-openapi.cjs`
- `node scripts/gridex-explicit-input-preservation-regression.cjs`

## Resume

1. Merge this branch (or close as duplicate of sibling PR #80 after comparing
   diffs — this branch includes additional H-005..H-008 fixes).
2. Deploy OPS.
3. Create and validate one website quote for a real tenant.
4. Confirm hash validation survives PostgREST timestamptz round-trip.

## Do not claim yet

- deployed OPS source;
- clean npm install/full typecheck/test/lint/build;
- live quote or legal/supplier-switch E2E completion.
