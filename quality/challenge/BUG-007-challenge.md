# Challenge gate — BUG-007

Triggered because the finding concerns security/tenant boundaries, missing promised functionality, or divergent sibling paths. The task prohibits parallel agents; both rounds were performed sequentially after fresh source reads and this limitation is explicit.

## Round 1: common-sense validity

Finding: Runtime parity gates inspect a facade instead of executable modules. Source re-read: scripts/check-openapi-runtime-parity.cjs:233-254; __tests__/api-canonical-release.test.ts:50-62; lib/website/customerApplications.ts:1-3. Requirement: REQ-006.

Assessment: REAL BUG. The supplied master specification expressly requires the expected behavior, and the cited current path has an observable failure rather than a stylistic preference. The guarded regression asserts the user-visible invariant.

## Round 2: strongest maintainer defense

Defense: Source-string checks are deliberately shallow and a red check can be updated later.

Stress test: The defense does not survive the formal boundary. It either causes silent loss, false success, reversible identity, tenant-secret ambiguity, unreconstructible schema, or a release gate that contradicts executable runtime. Existing safer sibling behavior also demonstrates feasibility.

## Verdict

**Verdict:** CONFIRMED. Severity remains MEDIUM. No design-decision comment or documented limitation overrides the master requirement.
