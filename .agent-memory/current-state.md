# Current state

Last updated: 2026-07-30T02:31:00+02:00

- PHASE-32 canonical OPS/Web API release: IMPLEMENTED and LOCALLY VERIFIED; LIVE/DATABASE VERIFICATION BLOCKED.
- Website API, Customer Portal API, runtime, guide, examples and release manifest use `2026-07-30.1`.
- `GET /api/v1/openapi/release-manifest.json` publishes canonical SHA-256 values for both deterministic OpenAPI documents.
- Legal requirements and acceptances are dynamic, offer-bound and document ID/version/hash-bound; public application requests no longer expose the legacy fixed consent object.
- Customer events use one strict canonical request shape and no longer accept the legacy free-form payload.
- Portal sync has a strict body, paired UUID identity, matching required headers and a link/recovery-only response.
- A forward-only migration atomically creates the portal identity and owner account inside the website-application transaction and adds tenant/provider/subject uniqueness.
- Gridex Web synchronized snapshots and generated types locally; live release-manifest verification remains deliberately false until deployment.
- Verification: all TypeScript targets pass; lint has zero errors; 58 files/370 tests pass; API contract/parity/version/examples pass; tenant, idempotency, portal and webhook regressions pass; production build passes.
- New migration SHA-256 is `d56a6dd9ec660c3721aea2ba014fdf1abb3dbf9fe79d0ba193354e1980cee08a` and is registered exactly.
- Migration integrity remains blocked only by pre-existing immutable `20260728170000...` drift (`a743...` actual versus `881e...` expected).
- Release remains NO-GO until trusted historical recovery, authorized database apply, deployed live-manifest parity, full staging flow and two-tenant/concurrency/provider verification pass.
