# Open blockers

Last updated: 2026-08-04T13:03:20+02:00

## PHASE-42 blockers

1. Apply `20260804121000` and pass the postflight verification.
2. Deploy the modified OPS code after the database migration.
3. Canonically provision Gridex and at least one second tenant; old scopes-only
   `launch_ready` flags are deliberately invalidated.
4. Configure and prove at least one signed tenant webhook; no active webhook was
   present during the live audit.
5. Run a real two-tenant application matrix with distinct API keys, portal users,
   offers and customer data, and prove no cross-tenant visibility.
6. Run clean `npm ci`, full typecheck/test/lint/build in an environment whose npm
   registry can serve `zod-validation-error@4.0.2` and all declared packages.

## Inherited blockers

Older emergency-access, Ediel legacy-data and unrelated production hardening
items remain separate. PHASE-42 does not silently close them.
