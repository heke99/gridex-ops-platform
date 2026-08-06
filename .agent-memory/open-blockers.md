# Open blockers

Last updated: 2026-08-06T08:50:00Z

## PHASE-45 blockers

1. Full dependency-backed typecheck, tests, lint and production build require an
   environment with installed `node_modules`.
2. Deploy updated OPS source and run live quote create → validate smoke.
3. Resolve overlap with sibling health PR #80 before merging both.

## Inherited blockers

1. PHASE-44 private/business legal-bundle → acceptance → signed POA →
   supplier-switch E2E remains pending after deploy.
2. Synchronize tenant website against OpenAPI `2026-08-05.2` grouped legal
   `requirements` rendering.
3. Prior SVK import, webhook, emergency-access, Ediel and broader production E2E
   items remain separate.
