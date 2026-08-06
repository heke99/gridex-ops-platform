# Open blockers

Last updated: 2026-08-06T08:40:00Z

## PHASE-45 blockers

1. Merge and deploy the health branch
   `cursor/codebase-health-and-stability-609b`.
2. Run clean dependency-backed typecheck, tests, lint and production build where
   npm packages are available.
3. Execute one live website quote create → validate smoke covering PostgREST
   timestamptz serialization and null grid area.

## Inherited blockers

- PHASE-44 private/business legal-bundle / POA / supplier-switch E2E still
  pending after deploy.
- Synchronize tenant websites against OpenAPI `2026-08-05.2`.
- Prior SVK import, webhook, emergency-access, Ediel and broader production E2E
  items remain separate.
