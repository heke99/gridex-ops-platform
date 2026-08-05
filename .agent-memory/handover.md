# PHASE-45 handover — Quote integrity and OpenAPI 2026-08-05.2 sync

The incomplete main push `b9019bd9` started UTC quote-hash normalization and an
OpenAPI version bump to `2026-08-05.2`, but left docs/checks/release artifacts on
`2026-08-05.1` and a false-green source-string regression.

## What changed

- `canonicalQuoteValidUntil` / `canonicalQuoteTimestamp` normalize PostgreSQL
  `+00:00` and JS `Z` before hashing.
- `market_data_timestamp` uses the same canonicalization because it is also a
  top-level `timestamptz` integrity field.
- OpenAPI/docs/runtime contract version is completed at `2026-08-05.2`.
- `WebsiteQuoteData.offer` is required, example-backed and present in immutable
  release artifacts/routes.
- Contract P0 integrity assertions now expect v3 commercial quote hashing and
  the legal-bundle `anyOf` scope model.

## Verification completed

- `gridex-website-quote-integrity-regression.mjs`
- `gridex-contract-p0-integrity-regression.cjs`
- API docs version/compatibility/examples/runtime/local release checks
- Customer legal package regression

## Resume

Push/open PR from `cursor/codebase-health-and-stability-c492`. After merge and
deploy, verify one live quote create/validate round-trip still hashes under both
PostgREST timestamp representations, then continue PHASE-44 live legal/POA E2E.

## Do not claim yet

- deployed OPS source;
- clean npm install/full typecheck/test/lint/build;
- deployed OpenAPI SHA verification against production base URL;
- live private/business two-tenant legal/POA/supplier-switch E2E.
