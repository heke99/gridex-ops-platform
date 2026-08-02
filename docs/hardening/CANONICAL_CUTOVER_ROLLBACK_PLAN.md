# Canonical hardening cutover and rollback plan

## Cutover phases

### 1. Schema

Apply the six additive migrations to an isolated staging clone. Do not enable live sends during migration.

### 2. Preflight and quarantine

Run the canonical preflight. Resolve ambiguous rows manually. Re-run until no blocking rows remain.

### 3. Backfill

Backfill only exact tenant relations and compatibility projections. Record before/after counts per tenant.

### 4. Shadow mode

For at least one full operational cycle:

- calculate old and new tenant operation decisions;
- compare existing readiness with snapshot-bound readiness;
- compare mutable actor-test results with immutable current attempts;
- record mismatches without changing production behavior.

### 5. Write cutover

Move writes in this order:

1. test evidence and manual attestations;
2. actor profile/configuration changes;
3. Ediel production transitions;
4. tenant lifecycle;
5. provisioning and tenant access.

Block direct writes only after all known callers are migrated and regression-tested.

### 6. Read cutover

Move decisions to canonical state/snapshot/current-attempt projections. Keep legacy fields synchronized for old readers.

### 7. Legacy retirement

Retire legacy decisions only after production evidence shows no callers and no shadow mismatches. Removal requires a later migration, not these migrations.

## Operational rollback

These migrations are additive. Rollback should normally be an application rollback, not a destructive schema rollback.

1. Pause affected tenant Ediel production through the canonical pause transition.
2. Disable affected worker deployment or route traffic to the prior application version.
3. Keep new tables, audit, events and quarantine rows intact.
4. Restore reads to compatibility projections while continuing dual/shadow writes only where already proven safe.
5. Do not delete immutable attempts, snapshots, audit or domain events.
6. Correct data with a new forward-only repair migration.

## Emergency stop

For a suspected isolation or production/test breach:

- mark the tenant production state `blocked` through the canonical RPC;
- lock Ediel production send;
- stop email/webhook/customer-operation workers for the tenant;
- preserve all queue rows and evidence;
- create an incident audit event and export relevant immutable evidence.

## GO gate

GO is prohibited until all items marked `NOT VERIFIED` in the verification protocol are proven on staging and the full build/test pipeline is green.
