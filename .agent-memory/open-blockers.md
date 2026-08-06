# Open blockers

Last updated: 2026-08-06T12:57:00Z

## PHASE-45 blockers

1. Prefer one health-package merge onto main (`fb8e` / superseding `6531`);
   close overlapping sibling PRs `#75`–`#81` / `#83`.
2. Run clean dependency-backed typecheck, tests, lint and production build where
   `node_modules` can be installed.
3. Deploy OPS and execute live website quote create → validate for one tenant,
   including PostgREST timestamptz round-trip and mixed-case price/grid areas.
4. Private/business legal-bundle → POA → supplier-switch E2E remains pending
   from PHASE-44.
5. Schedule dedicated RLS remediation for `platform_actor_contacts` and
   address/energy lookup caches (findings O-005/O-006); do not combine with
   this app health PR.

## Inherited blockers

Prior SVK import, webhook, emergency-access, Ediel and broader production E2E
items remain separate and are not closed by PHASE-45.
