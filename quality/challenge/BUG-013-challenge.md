# Challenge gate — BUG-013

Triggered because the finding concerns security/tenant boundaries, missing promised functionality, or divergent sibling paths. The task prohibits parallel agents; both rounds were performed sequentially after fresh source reads and this limitation is explicit.

## Round 1: common-sense validity

Finding: Portal identity resolver RPC exists live but runtime still executes divergent fallbacks. Source re-read: lib/customer-portal/customerResolver.ts:118-170,234-348; connected migration 20260809182554_resolve_portal_customer_identity_v1. Requirement: REQ-008.

Assessment: REAL BUG. The supplied master specification expressly requires the expected behavior, and the cited current path has an observable failure rather than a stylistic preference. The guarded regression asserts the user-visible invariant.

## Round 2: strongest maintainer defense

Defense: Fallback queries preserve compatibility across schema versions and already check email ambiguity.

Stress test: The defense does not survive the formal boundary. It either causes silent loss, false success, reversible identity, tenant-secret ambiguity, unreconstructible schema, or a release gate that contradicts executable runtime. Existing safer sibling behavior also demonstrates feasibility.

## Verdict

**Verdict:** CONFIRMED. Severity remains HIGH. No design-decision comment or documented limitation overrides the master requirement.
