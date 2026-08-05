# Current task

Last updated: 2026-08-05T22:20:00Z
Branch: `cursor/codebase-health-and-stability-c492`

## Active phase

PHASE-45 — Quote integrity timestamp canonicalization and OpenAPI 2026-08-05.2 sync.

## Goal

Close the incomplete main push that started quote-hash UTC normalization and an
OpenAPI `2026-08-05.2` bump without materializing release artifacts or aligning
runtime/docs/checks.

## Implemented

- Canonicalize both `valid_until` and `market_data_timestamp` timestamptz forms
  (`Z` vs `+00:00`) before immutable quote hashing.
- Complete OpenAPI release `2026-08-05.2`, including `WebsiteQuoteData.offer`,
  immutable release JSON/routes, docs, fixtures and version checkers.
- Strengthen the quote-integrity regression so it fails closed unless current
  OpenAPI/docs/release artifacts match `2026-08-05.2`.
- Refresh stale contract P0 integrity assertions for v3 quote hashing and the
  legal-bundle `anyOf` scope model.

## Verification

- `node --experimental-strip-types scripts/gridex-website-quote-integrity-regression.mjs`: PASS
- `node scripts/gridex-contract-p0-integrity-regression.cjs`: PASS (127 controls)
- `node scripts/check-api-documentation-version.cjs`: PASS
- `node scripts/check-api-compatibility.cjs`: PASS
- `node scripts/check-api-documentation-examples.cjs`: PASS
- `node scripts/check-public-contract-runtime-openapi.cjs`: PASS
- `node scripts/verify-openapi-release.cjs`: PASS (local artifacts)
- `node scripts/gridex-customer-legal-package-regression.cjs`: PASS
- Full dependency-backed typecheck/test/lint/build: NOT RUN (no node_modules)

## Exact next action

Commit/push the stability branch, open the PR, then keep PHASE-44 deployment and
live private/business legal/POA/supplier-switch E2E as the remaining product gate.
