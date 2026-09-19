# Issue332 continuation — 2026-09-19

Base: fda3420e471862b58b55f9beec948ca9efc38f3b, accepted PR336. PR310 remains paused and excluded. Issue332 is a release blocker, not a PR. PR335 is overlapping unmerged work and requires independent reconciliation.

Skill routing: using-superpowers; systematic-debugging; test-driven-development; writing-plans/executing-plans; verification-before-completion; requesting-code-review. Focused release-regression remediation, not a new full repository audit. No UI, infrastructure, schema or performance change planned; corresponding skill groups inactive. Existing quality gates retained.

## Plan
- [x] Read current main, PR310/335/336 and issues332/333; reproduce all three failures.
- [ ] Replace obsolete Z18 source-template assertions with actual TGT/profile renderer behavioral tests, retaining expected 693/164/Z09/UD/no-IT and optional creation behavior. Run via the original certification entry point.
- [ ] Replace obsolete installation template assertion with real missing/present identity, agency and escaping tests. Run via original no-placeholder entry point.
- [ ] Independently inspect existing runtime migration registration and history; test correct inclusion, mismatch/missing failure and overlap conflict. No adoption of observed hashes or migration edits.
- [ ] Execute targeted and required verification, review concrete diff, publish candidate, ordinary exact-head CI and guarded merge only if accepted.
- [ ] Reconcile PR335 inbound correction before further D cells. Continue F3 dependency units then F4–F7 subject to evidence gates; do not certify paused database work or live scope.

## Reproduction
On unmodified main both Ediel source regressions exit1: six Z18 textual assertions and installation NAD exact-text assertion. Production readiness exits1: historical integrity585files/489groups passes, inventory rejects14checksums. Its two generated artifacts were changed by reproduction and will not be adopted as implementation evidence.

## Root cause and proof
Runtime manifest predates this work (latest7bc0f697); existing22entries include all14missing entries. Independent review traces additive inventory contract to ce6d6d16, runtime introduction59cf46e8, integrity consumption327761b8 and replaye0fb9425. No hashes adopted. New isolated inventory suite reproduced4fail/7pass before fix, then11pass. Rendering12cases pass existing code and replace stale checks at original entrypoints. Both entrypoints and readiness now pass. Full application3116/3116; test types corrected after two fixture typing failures and passed. Full certificate in progress. Scoped independent static/source review plus23 executed tests found no blocking defect. Added distinct production contract dates per minor recommendation.
