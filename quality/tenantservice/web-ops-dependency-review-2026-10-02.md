# Gridex Web OPS dependencies: current review and CI repair

Scope: independent Web tenant/support integration dependencies only. No Ediel
masterplan claim, production mutation, branch publication, merge or deployment.
Read the OPS operating contract, current memory and the tenantservice side-track
checkpoint. Applied differential-review, systematic-debugging, test-driven-development,
direct false-positive verification and verification-before-completion. UI,
dependency upgrades, SQL tuning, hook installation and reusable-skill changes
are outside this bounded review.

## Actual repository and release state

GitHub and a fresh fetch agree on main `61fc46fe8dbf0df5fb940ef85ff8d14063159783`
(PR459 memory and PR460 metering-regression follow-up). Public live manifest
`build_commit` is the same SHA. Direct cache-busting public requests return API
release/minimum tenant integration `2026-10-02.3`. Search-engine cached versions
were stale and are not release evidence.

| PR / candidate | Observed state and evidence |
| --- | --- |
| #454 identity | Open draft, mergeable, head `0351df42a908ff6b939c7f9f3e624b42ff571bee`; OPS 37048728454, browser 37048728489 and full E2E 37048728432 succeed. Production crawler skipped. |
| #456 old schema release | Open draft, conflicting, head `f73b57277a6f916c978f0826a216e77ff0bc1d8f`. Its competing `.3` must not replace the independently published PR457 `.3` bytes. |
| #458 merge lifecycle | Open draft, mergeable, head `356211e42114e51a3d2b069758eb81fe3e13931b`. Tenant, browser and full E2E succeed; OPS 37055739561 fails only in clean replay at the inspected point. Local fix starts from this exact remote head. |
| Replacement schema `.4` | Local `900bdcda` keeps PR457 `.3` and corrects the closed support/manifest schemas. Publication and exact-head CI remain required. |

## Confirmed CI fixture defect and correction

OPS clean-replay job `110999881821` first passes the new lifecycle SQL and all
three concurrent INSERT/UPDATE/contact races. Its final cleanup then deletes
the synthetic company. Automatic company onboarding has published legal text
versions, so that cascade correctly raises `Published legal text versions
cannot be deleted`. The race logic and immutable legal guard are not the fault.

The concurrency fixture now removes its mutable identities, merge/audit events,
customers and actor, while retaining the synthetic tenant and its immutable
onboarding documents until the disposable replay database is torn down. The
success log runs only after cleanup. No trigger or published evidence is changed.

Native reproduction uses real PostgreSQL 16, the existing canonical affected
customer/portal graph and exact canonical legal-template tables, seeding
functions, company insert trigger and immutable legal-text trigger. Synthetic
published terms activate the same failing cascade. This is a bounded native
reproduction, not a full Supabase replay.

| Verification | Fresh outcome |
| --- | --- |
| Unmodified remote fixture with canonical automatic published legal text | RED: exact CI error after all race assertions pass. |
| Corrected fixture on Node 22.23.3 / PostgreSQL 16 | PASS: INSERT/contact wait and recheck; UPDATE conflicts without deadlock; cleanup completes. |
| Post-cleanup query | Zero customer fixture rows; published synthetic legal versions retained unchanged. |
| Changed MJS `node --check` and `git diff --check` | PASS. |
| Existing composed `fc93791a` identity/merge/schema candidate, Node 22.23.3 | 66/66 tests in eight support, attachment, identity, unique-sync and merge suites pass. This evidence belongs to that tree, not the new published PR head. |

## Closed-schema correction remains necessary

Fresh latest-main and direct live `.3` support schemas reject the actual detail
`messages` field. Latest-main website response schema rejects the actual live
release manifest on nine documented-property/enum violations, including
generated metadata, minimum version, immutable URLs and compatibility values.
The replacement `.4` corrects these failures while retaining closed objects and
all prior immutable `.2`/`.3` archives. Its current detail validator accepts
the same synthetic response; composed response/schema tests pass.

## Next actions and boundaries

1. Review and publish this fixture-only repair as a fast-forward to #458; keep
   its lifecycle SQL, schema snapshot and security invariants unchanged.
2. Require the new exact-head OPS replay, generated-type provenance, tenant
   invariants and final schema comparison. Last failed artifact 11248208239
   contains the replay log/snapshot but stopped before type generation; it is
   not full replay acceptance.
3. Reconcile #454 with current main and #458 without dropping either immutable
   identity or merge lifecycle guards. A final composed candidate needs its own
   CI evidence.
4. Publish `.4` separately and supersede conflicting #456. Verify exact-head CI
   and, only after deployment, live manifest, OpenAPI bytes/digests and Web's
   matching generated contract.
5. Apply any eventual OPS migration in its correct production ledger order as
   part of the coordinated release; this review performs no production DDL.

## Second exact-head replay result and owner-fixture precision

Published cleanup head `71f36b2b9261243b0debedb9f12188b6cb0414d9`, exact local
tree `e3a97a1137c6646a24ab705b8349921f887b9daa`, passes tenant/browser/full E2E
and both OPS verify/quality jobs. OPS replay `37059428456` now passes cleanup
and all 382 native source-owner tests, then fails the case-view fixture at line
239 because it expected a foreign-key error for every invalid owner tuple.

The new merged-customer BEFORE trigger correctly rejects the two mismatched
customer/tenant pairs with `23514 customer_portal_customer_not_found_for_tenant`
before FK evaluation. A coherent customer/tenant pair from B targeting case A
still reaches `customer_case_events_case_owner_fk` and returns `23503`.
Actual-PG16 native reproduction is RED under the old uniform expectation and
GREEN under these three precise expectations; no invalid event remains.

The case-view fixture now asserts the exact guard code/message for those first
two pairs, retains the third composite-owner FK assertion and retains the
existing complete unchanged status/event snapshots. Production trigger/RPC
bodies, grants, FKs and schema snapshots remain unchanged. Root authorized this
specific fixture update after reviewing its native evidence. Artifact
11249644668 still stops before type generation and is not final replay acceptance.

PR456 is closed unmerged at 2026-10-02T20:21:08Z, preserving its original head.
Replacement draft PR461 is mergeable at `01e91fe10393567a1d65cf45e9986efef5d7d874`
with parent `61fc46fe` and exact tree `ae72906dfc16fe49ae4684110ec20206dffe4210`.
Neither production nor the frozen `.4` candidate was changed by this repair.

## Complete replay and final dependency composition

PR458 head `f65f3fbc3b05e72b9bbf8358b7c2b0a04ccdc044` passed every applicable workflow: OPS37060952835 (verify/quality/build/clean-migration-replay), tenant37060952746, browser37060952794 and full-E2E37060952783. The production crawler was intentionally skipped. The native job111017192071 passes lifecycle SQL and all three races,382 native owner tests, the precise case-owner assertions, browser/recheck, type generation, tenant invariants, all injected-drift selftests and final canonical schema comparison.

Its actual GitHub checkout is synthetic merge `8841add6171be0872044feb54fc4536d1a2fb713`, tree `8bc61df8cd6e33b85dce6b817b08a319db3040be`, combining main61fc46fe and that PR head. Relative to the PR head tree27dd50b8 it adds only two upstream memory files and the metering-regression follow-up; SQL and generated artifact inputs match. This distinction is retained in structured type provenance.

Authentic artifact11250727412 ZIP SHA-256 `d39f650b1387c8245bb20d0c7c50cfd9a5588940a690a406a3501887e82ff2a2` was downloaded and verified. Generated types SHA-256 `58bcc698c17fb45495f6e99cc07c03126dbeb88addc0044709b58a2267871180`, schema dump `de058b4793049cb206093d798267abae7662d49617695dd39ba239caca1bec8c` and fingerprint file `af351e72552bb0df1ee9172983e985ba9906144bbc1fb85ea58533ac6e98377b` were imported byte-for-byte and match the committed files. Canonical fingerprint remains `e170398075931d95622055a92b0eb58d127793fefa1386abc01f77bffd4b45c8`. No generated file was hand edited; the manifest records the complete actual capture. Earlier partial-replay status is SUPERSEDED.

Root merged identity PR454 as766fdd42 and closed obsolete PR456 unmerged with its original head preserved. PR462 then advanced main to `b9764ffce249eb8775af3f4c0b7d2a8d59e5877e`; its tenant/company fail-closed behavior is preserved. Replacement schema PR461 head `5977e4574dcb6521d9e80815db10a00199dc72f5` passed every applicable exact-head workflow and85 affected current-main composition tests/types/API gates, then root merged it as `472d703e7580fdaa49374f4d7aa202da74751057`.

The final lifecycle candidate composes this actual identity/schema/admin main. Only additive sync helpers/imports and the append-only tenantservice checkpoint required resolution. Both canonical merged-alias behavior and unique/saturated-match refusal are retained; .2/.3/.4 archives and the lifecycle SQL body are unchanged. Fresh Node22.23.3:151 tests across19 affected/adjacent suites, all three TypeScript checks, scoped lint, all API documentation/compatibility/immutable release/runtime-parity checks, migration checks, tenant ratchet, generated-type provenance and diff checks pass. New published-head CI remains required before root can merge this final composition.

This work performs no production DDL, rollout flag change or deployment. Earlier repository/status tables in this report are historical observations.
