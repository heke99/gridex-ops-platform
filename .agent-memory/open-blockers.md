# Open blockers

## BLK-001 — Repository provenance

Status: BLOCKED

The source ZIP excludes `.git`; branch, commit and prior dirty state cannot be
established. Patch contents are diffed against the uploaded archive.

## BLK-002 — Database apply verification

Status: BLOCKED_BY_ENVIRONMENT

`supabase`, Docker and an authorized database are unavailable. Migration
history, lifecycle/delete regressions and static checks pass, but the pending
migrations have not been executed against PostgreSQL. The newest migration
repairs final function definitions dynamically and creates transactional
invoice graph reservations; both require real PostgreSQL application.

## BLK-003 — Live deployment parity

Status: DEPLOYMENT_REQUIRED

The live developer page inspected on 2026-07-25 reports an older deployed
contract. Local runtime/OpenAPI/docs are aligned at `2026-07-25.1`; production
parity can only be verified after deployment.

## BLK-004 — Provider runtime verification

Status: BLOCKED_BY_ENVIRONMENT

Capway/Aptic credentials and a provider sandbox are unavailable. Signature
verification, idempotent event claiming and canonical invoice matching are
implemented, but a signed provider round trip cannot be executed locally.

## BLK-005 — Legacy readiness fixtures

Status: TEST_FIXTURE_UPDATE_REQUIRED

Five existing unit fixtures construct supply periods without company,
customer, contract and metering-point identities. Exact readiness correctly
blocks them. Production code was not relaxed and the tests were not edited.
