# Open blockers

Last updated: 2026-08-04T19:00:05+02:00

## PHASE-43 blockers

1. Deploy the updated OPS source; the connected database is already migrated.
2. Run the authenticated SVK import to completion and verify active current-source
   geometry rows plus one verified geodata version.
3. Execute a real quote/application/contract/metering/billing E2E with seeded data.
4. Run clean npm install, typecheck, tests, lint and production build in an
   environment with working registry access.

## Inherited blockers

Prior tenant-webhook, two-tenant E2E, emergency-access, Ediel legacy-data and other
production-hardening items remain separate and are not silently closed by PHASE-43.
