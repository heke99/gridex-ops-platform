# Challenge gate — BUG-014

Triggered because the finding concerns security/tenant boundaries, missing promised functionality, or divergent sibling paths. The task prohibits parallel agents; both rounds were performed sequentially after fresh source reads and this limitation is explicit.

## Round 1: common-sense validity

Finding: New tenant profile still provisions legacy portal scopes and no automatic smoke flow. Source re-read: supabase/migrations/20260724170000_single_api_key_tenant_website_integration.sql:34-57; lib/integrations/tenantWebsiteProvisioning.ts:276-466. Requirement: REQ-007.

Assessment: REAL BUG. The supplied master specification expressly requires the expected behavior, and the cited current path has an observable failure rather than a stylistic preference. The guarded regression asserts the user-visible invariant.

## Round 2: strongest maintainer defense

Defense: Legacy aliases keep existing portal clients simple; provisioning readiness need not execute requests.

Stress test: The defense does not survive the formal boundary. It either causes silent loss, false success, reversible identity, tenant-secret ambiguity, unreconstructible schema, or a release gate that contradicts executable runtime. Existing safer sibling behavior also demonstrates feasibility.

## Verdict

**Verdict:** CONFIRMED. Severity remains MEDIUM. No design-decision comment or documented limitation overrides the master requirement.
