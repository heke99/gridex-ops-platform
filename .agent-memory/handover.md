# PHASE-45 handover — OpenAPI and quote health package

Branch `cursor/codebase-health-and-stability-6531` completes the incomplete
`2026-08-05.2` main publish, related case-sensitive area compares, and the
follow-on price-area / AI-BI variants found after the skill-contract sync.

## What changed

- Quote integrity hashes canonicalize top-level timestamptz fields.
- Quote and application/metering-point grid/price area compares are
  case-insensitive via shared normalizers.
- Website quote create persists uppercase `price_area`; validate and snapshot
  compares are case-insensitive without rewriting historical hash payloads.
- AI/BI import discrepancy compares normalize grid-area case/whitespace.
- Local OpenAPI release verification fails closed on missing/divergent
  immutable artifacts and registry routes.
- Current market-price and quote examples include required schema fields.
- Developer guide examples use contract version `2026-08-05.2`.
- Findings recorded in `quality/findings-2026-08-06-codebase-health.md`.

## Verification completed

- `npm run gridex:quote-null-grid-area-regression`
- `npm run gridex:website-quote-integrity-regression`
- `npm run gridex:aibi-grid-area-case-regression`
- `node scripts/verify-openapi-release.cjs`
- `node scripts/check-api-documentation-examples.cjs`
- `node scripts/check-api-documentation-version.cjs`
- `node scripts/check-api-compatibility.cjs`
- `node scripts/check-public-contract-runtime-openapi.cjs`
- `node scripts/gridex-explicit-input-preservation-regression.cjs`

## Resume

1. Prefer merging this branch onto main; close overlapping sibling health PRs.
2. Deploy OPS.
3. Create and validate one website quote for a real tenant.
4. Confirm hash validation survives PostgREST timestamptz round-trip.

## Do not claim yet

- deployed OPS source;
- clean npm install/full typecheck/test/lint/build;
- live quote or legal/supplier-switch E2E completion.
