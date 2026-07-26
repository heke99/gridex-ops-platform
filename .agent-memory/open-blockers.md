# Open blockers

## BLK-001 — Repository provenance

Status: BLOCKED

The source ZIP excludes `.git`; branch, commit and prior dirty state cannot be
established. Patch contents are diffed against the uploaded archive.

## BLK-002 — Database apply verification

Status: BLOCKED_BY_ENVIRONMENT

`supabase`, Docker and an authorized database are unavailable. Migration
history, lifecycle/delete regressions and static checks pass, but the pending
migrations have not been executed against PostgreSQL. The earlier deletion
graph migration was parser-checked; the newest dynamic function-repair
migration requires real PostgreSQL application.

## BLK-003 — Live deployment parity

Status: DEPLOYMENT_REQUIRED

The live developer page inspected on 2026-07-25 reports an older deployed
contract. Local runtime/OpenAPI/docs are aligned at `2026-07-25.1`; production
parity can only be verified after deployment.
