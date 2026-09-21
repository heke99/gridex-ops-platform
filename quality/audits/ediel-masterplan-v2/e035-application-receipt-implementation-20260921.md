# PR366 — Ediel application receipt admission

2026-09-21. Implementation253d15e4515b0bc54b443e5e71862b22e8373075 passed ordinary CI; this documentation-only child corrects counts and still requires its own exact-head CI/review. Base mainb6bb10328b173267882238804bbbeefd048040c4 is verified PR365 publication over accepted runtime840720c7. No new main acceptance is claimed here.

## Evidence correction and retained test-first history

The previous document at253d miscounted the first test file as42, producing the incorrect total51 and initial5195/5167 figures. Those figures are retracted. Fresh original job106366332421 at8eae99119074e24c6eca212fb9f6f64bacaa801f shows41 new tests:28 behavioral failures and13 passing controls. OPS35609967994 npm test finished2026-09-21T14:18:12.818Z with5194total,5166passed,28failed;324files,323passed,1failed. All5153 pre-existing tests passed. The28 failures are21 incomplete identities,6 invalid discriminants and1 multirow admission through the real public client, not imports/setup. Node22.23.2; scripts/tests types and verify106366332563/replay106366332584 passed. Root receipt5761924346 was explicitly corrected before merge.

Supplemental0b3170f999c725f1b38afefaf4179cfd5bd33c07 adds9 JSON-wire/discriminator controls. The addition is therefore50 cases (41+9), not51. Both files remain unchanged since their publication; no case was deleted or added to manufacture a count. The0b workflow lookup returned no run, and no separate execution is inferred. Retain source plan e035-application-receipt-plan-20260921.md, initial independent5761807242 and source/design resolution5761874417. Root authorized the finite fix only after the actual28 failures.

## Implemented boundary

Only lib/customers/canonicalOnboarding.ts changes production behavior. For ediel_inbound, materialize one JSON command snapshot, send that same snapshot and capture requested nonempty-object site/meter flags before awaiting RPC. Undefined-only objects become{}, whereas null-valued properties survive; caller mutation or a second stateful toJSON cannot change requirements. Existing company/actor and command validation remain before the call. Other channels keep original handling.

Require exactly one result when the existing array compatibility is used, exact true/customer_onboarding_committed or false/ambiguous_customer_match discriminants, and nonblank application_id on success. Require site_id/metering_point_id only for their actual requested nonempty object payloads. Keep existing customer/number/operation checks, response values, ambiguity, idempotent replay correlation and RPC errors. No new UUID grammar, fresh-correlation equality, reads, retries, compensation, SQL, schema, parser, source projection, ACK, workflow or dependency change.

This is a lower client return-contract repair under malformed/version-skewed output. It does not establish that current SQL emits malformed output, a live exploit, rollback of an already committed RPC, or dated expected-structure authority. The single-object caller and multi-object extra guards are retained.

## Current execution and acceptance

Implementation253d ordinary OPS35611258289/job106370656376 actually reports5203/5203tests and325/325files, including receipt41 and wire9. Finished2026-09-21T14:21:38.635Z. All5153 prior tests passed. Types, quality45/45, API/RBAC, build and bundle succeeded; lint has101 warnings and0 errors, not a warning-free claim. Verify106370656649 and replay106370656083 succeeded. PR E2E35611257822 is smoke/coverage, not actual-mainfull73; browser35611257750 and masterplan35611258765 also passed. Static exact253d review5762012089 found no blocking code issue and awaited terminal checks.

This child changes only documentation; production and both test blobs remain unchanged. Required: new exact-head ordinary CI and final independent review, expected-head guarded merge, then actual-mainfull73/73 plus allOPS and independently inspected artifact/commit/rows/JUnit/unit log. Record actual-main acceptance in PR366 and subsequent substantive handover, not another receipt-only PR.

## Remaining work

E035B still requires independent dated structure, environment/actor/object/agency binding, accepted disposition, supersession and completeness; then actual loader/comparator/E61/E62/guide/ACK/persistence behavior. Do not duplicate observed PRODAT snapshots or mistake this receipt for source authority. FullE035/F3/masterplan remain NOT_COMPLETE. D110/110+parents10/10 and accepted361/363/364 retained. PR365 publicationb6 already verified5761859619.

Applied workflow: retained execution plan, bounded source-to-code/root-cause qualification, test-first public-client witnesses, differential independent review and verification-before-completion. No unavailable skill script or local repository suite execution is claimed. PR310 stays paused ate961135199f292b8210884f07de3b616a670161a, untouched. No live DB/provider/market/settings/explicit deployment action. Earlier document snapshots remain in Git at253d.
