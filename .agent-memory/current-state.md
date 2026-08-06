# Current state

Last updated: 2026-08-06T07:55:00Z

## HEALTH / OpenAPI 2026-08-05.2 completion

- Website and Customer Portal contract version remains `2026-08-05.2`.
- Immutable release artifacts and routes for `2026-08-05.2` now exist and match
  current OpenAPI bytes.
- Website quote integrity hashes canonicalize top-level `valid_until` and
  `market_data_timestamp`.
- Nullable resolution/quote `grid_area_code` comparisons are canonical and
  case-insensitive.
- Local OpenAPI/docs/compatibility/quote regressions pass for this delivery.

## Verification

- Quote null-grid-area and integrity/OpenAPI sync regressions: PASS.
- `api:release:verify`, documentation version/examples, compatibility and
  public-contract runtime checks: PASS.
- Full dependency-backed gates: NOT RUN in this sandbox.
- Live quote create→validate with null grid area: PENDING deploy.

## Prior phase state

Last updated: 2026-08-05T15:14:58+02:00

## PHASE-44 legal package state

- Website and Customer Portal API contracts are aligned at `2026-08-05.1`.
- The customer-facing legal surface contains at most `agreement`,
  `power_of_attorney` and `withdrawal`.
- Canonical legal modules remain individually versioned and hashed. A grouped
  acceptance is expanded server-side into exact module acceptance rows.
- Public legal pages use the locked tenant legal-profile snapshot, so an old
  agreement cannot display a tenant's later company details.
- POA intake from website and Customer Portal uses the same supported scopes,
  exact legal document identity and downstream authorization chain.
- Existing authorization scopes reject a different signed scope snapshot instead
  of silently widening or rebinding authority.
- No database migration is required by this delivery; it uses the existing
  canonical bundle, acceptance, POA and authorization tables.

## Verification

- Dedicated legal package and POA regressions pass.
- API version, compatibility, examples, runtime/OpenAPI and local release checks pass.
- Changed TypeScript/TSX syntax transpilation passes.
- Full dependency-backed gates remain unexecuted because the configured package
  mirror returned 404 for `zod-validation-error@4.0.2`.

## Deployment state

- Repository changes: IMPLEMENTED AND STATICALLY VERIFIED.
- Running OPS application: NOT DEPLOYED FROM THIS DELIVERY.
- Live private/business tenant legal and supplier-switch E2E: PENDING.
