# Open blockers

Last updated: 2026-08-05T22:20:00Z

## PHASE-45 blockers

1. Merge/deploy the quote integrity and OpenAPI `2026-08-05.2` stability branch.
2. Run clean dependency-backed typecheck, tests, lint and production build where
   `node_modules` can be installed.
3. Verify deployed OpenAPI release bytes with `GRIDEX_API_BASE_URL`.

## PHASE-44 blockers

1. Deploy the updated OPS source including the legal package and quote integrity
   fixes.
2. Execute one private and one business tenant legal-bundle, acceptance, POA and
   supplier-switch E2E and verify tenant isolation plus immutable evidence.
3. Synchronize the tenant website against OpenAPI `2026-08-05.2` so it renders
   the returned grouped `requirements` and quote `offer` payload.

## Inherited blockers

Prior SVK import, webhook, emergency-access, Ediel and broader production E2E
items remain separate and are not closed by PHASE-44.
