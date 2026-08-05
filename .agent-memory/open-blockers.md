# Open blockers

Last updated: 2026-08-05T15:14:58+02:00

## PHASE-44 blockers

1. Deploy the updated OPS source.
2. Run clean dependency-backed typecheck, tests, lint and production build in an
   environment where the npm package mirror serves all locked packages.
3. Execute one private and one business tenant legal-bundle, acceptance, POA and
   supplier-switch E2E and verify tenant isolation plus immutable evidence.
4. Synchronize the tenant website against OpenAPI `2026-08-05.1` so it renders
   the returned grouped `requirements` rather than canonical modules.

## Inherited blockers

Prior SVK import, webhook, emergency-access, Ediel and broader production E2E
items remain separate and are not closed by PHASE-44.
