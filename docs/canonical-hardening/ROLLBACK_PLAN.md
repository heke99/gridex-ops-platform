# Rollback plan

The migrations are forward-only. Do not rewrite registered files and do not use destructive Git or database resets.

## Before apply

- retain schema-only dump, ledger export and row-count evidence;
- confirm restore/PITR availability;
- pause external workers;
- verify stable provider idempotency keys.

## If staging apply fails

- stop workers and preserve failing transaction/log output;
- restore the isolated branch from its pre-apply checkpoint or recreate it;
- correct with a new forward migration;
- do not manually edit `schema_migrations` except the separately approved A–C reconciliation.

## If production cutover fails

- pause tenant production state through the canonical command;
- keep queued items as `blocked_tenant_state`/`delivery_uncertain`;
- roll application traffic back to the prior build only if its schema contract remains compatible;
- use PITR only for a declared incident and never to hide externally delivered effects.
