# PHASE-45 handover — health after BL-002

Main received `fix(security): isolate platform-global operational reads (#84)`.
This branch rebases the OpenAPI/quote health package onto that tip and adds
follow-on case-normalization fixes H-011..H-015.

## What changed on fb8e

- Merged `cursor/codebase-health-and-stability-6531` (H-001..H-010).
- Added `canonicalSwedishPriceArea` in `lib/pricing/types.ts`.
- Billing base-component parse/filter, public fixed-offer completeness, and
  portfolio monthly history filters now canonicalize price areas.
- Application explicit site/metering grid writers use `normaliseGridAreaCode`.
- Quote create persists and hashes canonical `grid_area_code`.
- Findings inventory lists residual BL-002 RLS variants as O-005..O-008 without
  shipping another migration in this PR.

## Verification completed

- `npm run gridex:price-area-case-normalization-regression`
- `npm run gridex:quote-null-grid-area-regression`
- `npm run gridex:website-quote-integrity-regression`
- `npm run gridex:aibi-grid-area-case-regression`
- `npm run api:release:verify`
- `npm run api:docs-examples` / `api:docs-version` / `api:compatibility`
- `npm run gridex:explicit-input-preservation-regression`

## Resume

1. Merge this PR (or the single preferred health PR) onto main.
2. Close overlapping sibling health PRs `#75`–`#81` / `#83`.
3. Open a dedicated RLS remediation for `platform_actor_contacts` and the
   address/energy lookup caches (O-005/O-006).
4. Deploy and run live quote validate + legal/POA E2E when environment allows.

## Do not claim yet

- full npm typecheck/test/lint/build;
- VERIFIED_CLOSED for BL-002 residual variants;
- live E2E completion.
