# E035 identity evidence — independent bounded review

**Updated verdict: APPROVE the bounded identity-evidence helper after verified closure of ID-1. Initial review required changes for one medium-severity fail-closed defect, now fixed.** Scope is the uncommitted tenant identity owner/evidence helper/test only. No full source/tenant/legal-party/business approval is implemented or certified, and no integration or persistence is reviewed here.

## Reviewed scope and method

Read all of `lib/ediel/tenant/tenantEdielIdentity.ts`, new `tenantEdielIdentityEvidence.ts`, and new `__tests__/tenant-ediel-identity-evidence.test.ts`; compared owner changes with baseline. Checked all selected columns against actual table definitions in `supabase/schema.sql` and inspected profile constraints. Continued code-review, differential-review and verification-before-completion from the earlier bounded review. No source edits or external/live operations. Parent owns memory and final gates. The earlier register-test fieldRules type narrowing correction is acknowledged as outside this change; this review makes no fresh typecheck claim.

## Confirmed finding ID-1 — profile validation depends on row order

Severity: **Medium; blocking for the new evidence/explicit-asOf contract.**

Affected: `tenantEdielIdentity.ts`, `activeTenantEdielProfile`, terminal `.some(row => evaluation.active(row))`.

Reproduction uses the actual new evidence API with mocked DB response, not a replacement rule implementation. Start with the supplied valid profile. Append a second scope-correct profile with a distinct ID and `valid_from='2026-09-23T00:00:00Z'`, `valid_to='2026-09-21T00:00:00Z'`. At the test asOf instant, resolution succeeds and evidence includes both rows. Reverse only their order: resolution throws `tenant_ediel_evidence_validity_invalid`.

Root cause: `.some` stops after the valid first row, so the explicit/evidence evaluator never checks a later malformed interval. The helper is designed to reject reversed bounds, and identifiers/roles/relations use eager filtering, but profiles bypass that guard. Actual schema only constrains profile environment/market and uniqueness; it has no check excluding reversed bounds. Therefore the reproduction is not dependent on impossible PostgreSQL timestamp text. Unordered equivalent query results produce different validity decisions and allow invalid temporal evidence through.

Impact: new temporal/evidence API can silently retain invalid authorization-input intervals as successful evidence. Current full acceptance remains closed and this API is not yet integrated, limiting immediate business impact.

Targeted fix: eagerly validate all profile row intervals on evidence/explicit evaluation before testing whether any row is active. Preserve legacy default semantics if compatibility requires `.some` there. Add a regression covering both permutations and require both to reject. Do not broaden this into new profile-uniqueness policy: multiple enabled profiles currently mean an existential capability check and that behavior was already present.

## Passing findings and boundaries

- Every added selected column exists in actual schema. Tenant profile/identifier/role/relation bounds are TIMESTAMPTZ with nonnull starts; platform identifier bounds are nullable DATE. Selection does not introduce a nonexistent-field runtime failure.
- Explicit asOf is validated before DB reads and uses microsecond comparison. Half-open start/end and DATE normalization are consistent with the declared implementation contract.
- One evaluation instant is shared across reads, including default calls. Legacy default identity shape, predicates, relation ambiguity, role collection and platform-identifier treatment are retained. Capturing now once intentionally avoids intra-call clock drift.
- New explicit/evidence paths recheck company/environment/type/actor predicates. Transport directory scope follows the selected explicit relation actor. No shared mailbox or route becomes authority.
- Evidence detaches raw observed rows and records inactive rows/empty relations. It explicitly says `historicalKnowledge=not_established`, `sourceDisposition=not_established`, `consistency=independent_reads`. It does not claim row history, transaction snapshot, source approval or verified platform identity.
- Query failures propagate; ambiguous legal IDs/actors and multiple active delegations fail closed. Supplied tests cover malformed validity, future roles, exact microseconds, foreign row scope and unverified dated transport records.

## Verification

- New test suite: **20/20 passed**.
- Independent reproduction file (copy of supplied tests plus ID-1): **21/21 passed**, where the appended test proves success in one order and rejection in the other.
- Probe retained at `/workspace/scratch/f679df2698c2/e035-identity-independent-probe.test.ts`, removed from repo. Copy to `__tests__/e035-identity-independent-probe.test.ts` to reproduce unchanged.

No broader tests, native DB replay, typecheck, lint, integration or exact-head CI performed for this narrow review. Existing query pagination/completeness and independent-read races are not solved by this helper; its explicit limitations must remain until a future acceptance owner obtains a complete trustworthy read set. They are not newly claimed source authority and are not reported as additional regressions here.

## Independent closure verification

ID-1 is **FIXED / VERIFIED** in the active working tree. `activeTenantEdielProfile` now eagerly filters all rows when `evaluation.collect || evaluation.explicit`; plain legacy calls retain `.some`. The permanent regression checks both permutations and both public APIs. Fresh independent command `node node_modules/vitest/vitest.mjs run __tests__/tenant-ediel-identity-evidence.test.ts` passed **22/22**. This closes the only reproduced code blocker in this subreview. It does not qualify this helper as historical knowledge, a source acceptance owner, or full E035 delivery.
