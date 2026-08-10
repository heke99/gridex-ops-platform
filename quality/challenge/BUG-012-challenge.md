# Challenge gate — BUG-012

Triggered because the finding concerns security/tenant boundaries, missing promised functionality, or divergent sibling paths. The task prohibits parallel agents; both rounds were performed sequentially after fresh source reads and this limitation is explicit.

## Round 1: common-sense validity

Finding: Public-contract feed loads select-star before computing cache response. Source re-read: lib/website/publicContracts.ts:2325-2355,2588-2605; app/api/v1/website/public-contracts/route.ts:128-169. Requirement: REQ-009.

Assessment: REAL BUG. The supplied master specification expressly requires the expected behavior, and the cited current path has an observable failure rather than a stylistic preference. The guarded regression asserts the user-visible invariant.

## Round 2: strongest maintainer defense

Defense: Selecting a trusted view and computing ETag after load still saves response bandwidth.

Stress test: The defense does not survive the formal boundary. It either causes silent loss, false success, reversible identity, tenant-secret ambiguity, unreconstructible schema, or a release gate that contradicts executable runtime. Existing safer sibling behavior also demonstrates feasibility.

## Verdict

**Verdict:** CONFIRMED. Severity remains MEDIUM. No design-decision comment or documented limitation overrides the master requirement.
