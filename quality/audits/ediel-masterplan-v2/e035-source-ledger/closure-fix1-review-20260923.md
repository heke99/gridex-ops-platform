# Closure fix round 1 review

**SPEC: APPROVED for this scoped correction. QUALITY: no blocking code finding; corrected native execution remains a required gate.**

Reviewed exact `2b4293b..3c10f346a38a03d987175e351c5b8117e65d6979` (four changed paths; supplied tree `b2b8a7e3461abcd1543fbdc56378e09b1c620406`). The previous code review did not establish SQL acceptance. Root reports the actual `2b4293b` replay passed 54 retained cases (17 owner, 37 wire), but all seven new owner cases failed: six hit genuine legacy case-writer schema errors, and the seventh correctly rejected a stale reviewed-baseline proposal. This fix review does not recast that failed replay as a pass.

## Schema and consumer semantics

The writer now uses the actual `customer_cases.site_id` column and retains `metering_point_id`. The actual table has no `customer_site_id`; its CHECK permits `other` but not `final_metering_and_billing`. Mapping this specific closure call to `other` is therefore schema-correct without relaxing the constraint or silently coercing every unknown category.

The closure's final-work meaning is retained in both `reason_category='final_metering_and_billing'` and typed `metadata.review_intent`, with the original title, description, next action, source message/payload metadata, tenant/customer and open status intact. Supply and case insertion errors still propagate. The fix neither swallows the partially completed lifecycle operation nor fabricates its success.

Actual consumer trace was checked:

- `lib/customer-cases/db.ts:listCustomerCases` reads all categories unless explicitly filtered, scopes company/customer when supplied, and searches reason as well as title/description. The new category does not disappear from this generic reader.
- `lib/customer-portal/db.ts:listPortalCases` reads the real site/point fields plus type, title, description, reason and next action under company/customer filters. The final-work instructions remain visible to this consumer even though metadata is not selected there.
- `lib/customer-cases/support.ts:listTenantSupportCases` deliberately filters to support-specific metadata/source. This operational Ediel case remains outside that queue; the fix does not claim a new final-billing support workflow.
- `lib/operations/switchLifecycleBlocks.ts:switchLifecycleBlockFromCase` delegates to an explicit lifecycle category mapping; `other` does not create a withdrawal/rejection/cancellation block. This preserves the final-work review as a follow-up case rather than inventing a switch transition.

The adjacent existing invalid case types documented by the implementer remain a separate confirmed follow-up. No assertion that all legacy case-producing paths are repaired follows from this closure-specific mapping.

## Native fixture correction

The former seventh test tried to append old review facts whose baseline-current reference had become stale. The corrected test retains that exact proposal and now requires `23514 source_object_owner_snapshot_changed` with the assessment count unchanged. It then invokes the real fresh structural-review producer and alters only the separate witness request's facts hash, letting the actual database reject that witness. Assertions require a third, accepted, newly appended assessment pointing to the latest baseline, a null witness, and an unavailable subsequent closure with no older-baseline fallback.

This changes the test setup to produce the intended state without weakening SQL, canonical validation, party proof or the closure expectation. The new L/LK native assertions also inspect the actual persisted case row, including its tenant/customer/site/point, supported category, explicit intent, title and next action. They do not replace the original owner acceptance assertions with mocked success.

No SQL migration, append predicate, original-binding control or midnight control changed. The prior reported local RED2/4→GREEN4/4, 41/3 targeted and 5906/360 full coverage runs are implementer evidence; no broad optional tests were repeated by this reviewer. The fresh-review unwitnessed setup and the real legacy-case path still need the next native replay to prove actual runtime success.

No production edits were made. Only this requested report was written.
