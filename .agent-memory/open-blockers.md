# Open blockers

Last updated: 2026-08-06T08:58:00Z

## PHASE-45 blockers

1. Prefer one health-package merge onto main (`6531`); close overlapping sibling
   PRs `#75`–`#81`.
2. Run clean dependency-backed typecheck, tests, lint and production build where
   `node_modules` can be installed.
3. Deploy OPS and execute live website quote create → validate for one tenant,
   including PostgREST timestamptz round-trip.
4. Private/business legal-bundle → POA → supplier-switch E2E remains pending
   from PHASE-44.

## Inherited blockers

Prior SVK import, webhook, emergency-access, Ediel and broader production E2E
items remain separate and are not closed by PHASE-45.
