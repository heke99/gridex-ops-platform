# PHASE-44 handover — Customer legal package and POA consistency

The source package is implemented and statically verified. It has not been
deployed or exercised against a live private/business tenant flow.

## What changed

- Customer presentation is grouped into `agreement`, `power_of_attorney` and
  `withdrawal`; missing withdrawal modules naturally produce only two documents.
- Each grouped identity is tenant- and bundle-bound and hashes the exact source
  module IDs, versions and SHA-256 values.
- Website intake accepts the new grouped format and the complete older module
  format, but rejects mixed requests.
- Customer Portal sync resolves grouped references and persists one immutable
  acceptance row per source module, retaining compatibility with old references.
- The POA path accepts only `supplier_switch` plus optional
  `facility_information_lookup`, records the exact signed scope snapshot and
  creates the same authorization document/scope chain used by supplier switch.
- Published document pages render the tenant identity from the bundle snapshot,
  not from mutable current company data.
- API release is `2026-08-05.1`; endpoint paths remain unchanged.

## Verification completed

- `node scripts/gridex-customer-legal-package-regression.cjs`
- `node scripts/gridex-legal-poa-platform-hardening-regression.cjs`
- `node scripts/gridex-website-api-power-of-attorney-regression.cjs`
- API documentation/version/compatibility/example/runtime/release checks
- TypeScript syntax transpilation for all 17 changed TS/TSX files

## Resume

Deploy the changed files. Fetch a legal bundle as a private tenant, submit the
three exact acceptances and a complete signed POA, then verify:

1. exact module acceptance rows exist under the same tenant and bundle;
2. POA is `signed` with the submitted immutable scope snapshot;
3. `powers_of_attorney.document_id` points to the authorization document;
4. authorization scope coverage matches only the signed scopes;
5. supplier switch uses that authorization document;
6. a business offer omits withdrawal when no withdrawal modules are published.

## Do not claim yet

- deployed OPS source;
- clean npm install/full typecheck/test/lint/build;
- live private/business two-tenant E2E completion.
