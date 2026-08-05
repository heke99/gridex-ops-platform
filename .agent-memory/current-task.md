# Current task

Last updated: 2026-08-05T15:14:58+02:00
Branch: archive working tree

## Active phase

PHASE-44 — Three-document customer legal package and immutable POA chain.

## Goal

Expose at most three tenant-bound customer documents (`agreement`,
`power_of_attorney`, `withdrawal`) without changing the existing website or
Customer Portal endpoint structure. Preserve every canonical module as immutable
evidence and ensure a signed POA received from either API path drives the same
supplier-switch authorization chain with no scope widening.

## Implemented

- Grouped all canonical legal modules into three customer-facing documents.
- Retained exact module IDs, hashes and versions as the evidence source of truth.
- Added immutable tenant legal-profile snapshot rendering for historical links.
- Kept website application endpoints and legacy module acceptances compatible.
- Expanded grouped Customer Portal sync acceptances back to every source module.
- Bound POA reuse to the same tenant, legal module and exact signed scope snapshot.
- Made incomplete/legacy POA persistence fail closed for external dispatch.
- Published additive API/OpenAPI release `2026-08-05.1`.

## Verification

- Customer legal package regression: PASS.
- Website POA regression: PASS.
- Legal/POA platform regression: PASS.
- OpenAPI compatibility, examples, runtime parity and release checks: PASS.
- TypeScript syntax transpilation for 17 changed TS/TSX files: PASS.
- Full dependency-backed typecheck/test/lint/build: BLOCKED by package mirror 404.

## Exact next action

Sync and deploy the changed files, then run a real tenant legal-bundle -> three
acceptances -> signed POA -> authorization document/scope -> supplier-switch smoke
flow for one private and one business tenant.
