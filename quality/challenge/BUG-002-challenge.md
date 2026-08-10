# Challenge gate — BUG-002

Triggered because the finding concerns security/tenant boundaries, missing promised functionality, or divergent sibling paths. The task prohibits parallel agents; both rounds were performed sequentially after fresh source reads and this limitation is explicit.

## Round 1: common-sense validity

Finding: Invoice detail scans only the first invoice page. Source re-read: app/api/v1/customer/invoices/[id]/route.ts:27-48; lib/customer-portal/apiData.ts:312-358. Requirement: REQ-003.

Assessment: REAL BUG. The supplied master specification expressly requires the expected behavior, and the cited current path has an observable failure rather than a stylistic preference. The guarded regression asserts the user-visible invariant.

## Round 2: strongest maintainer defense

Defense: Scanning a list reuses one projection and preserves neutral not-found semantics.

Stress test: The defense does not survive the formal boundary. It either causes silent loss, false success, reversible identity, tenant-secret ambiguity, unreconstructible schema, or a release gate that contradicts executable runtime. Existing safer sibling behavior also demonstrates feasibility.

## Verdict

**Verdict:** CONFIRMED. Severity remains HIGH. No design-decision comment or documented limitation overrides the master requirement.
