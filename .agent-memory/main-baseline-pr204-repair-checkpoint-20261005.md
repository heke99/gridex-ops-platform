# Current-main #204 manual inbound repair — 2026-10-05

READY_FOR_INDEPENDENT_REVIEW at 2026-10-05 16:48 UTC. Isolated base
de6d22bea64cf2b8810969cb87924128176ebab1; branch
codex/main-baseline-pr204-repair-20261005. Root claim #204 comment5998712398;
historical PR/branch unchanged. Root owns publication, review and merge.

Skills: systematic-debugging and test-driven-development for reproducible
current-path defects; fp-check for full caller/trust-boundary verification;
code-review and verification-before-completion. Installed Next route-handler
documentation read before the potential webhook literal-email correction.

Scope: receipt/entity attribution, canonical completion rejection and terminal
request state in manual inbound/parser/correlation/webhook only. No migration,
capture, generated types, coverage, shared checkpoint or hosted operation.
Exact-existing lockfile SHA256 matches reused ignored node_modules; no install.

Test-first preparation: behavioral tests execute actual webhook/correlation/
ingestion/parser/canonical completion RPC adapter/orchestrator. Finite Data API
and external event/delivery/cache ports are declared. Native SQL/RLS and later
intake/supplier-switch qualification are not claimed.

## Confirmed current-path defects and repair

- A copied case number and bare sender/recipient equality made a sender credible
  without a verified contact or a matching outbound reply reference. Recipient
  equality now requires a reply bound to the same company/request. Existing
  company/global verified-contact paths remain usable without reply headers.
- Reply references were skipped after a case-number match. A known reply for a
  different request/company could therefore be silently ignored even with a
  verified sender. Both sources are now checked; conflicting known requests are
  ambiguous and cannot auto-apply. The evidence records reply binding.
- SQL ILIKE interpreted underscore/percent in sender and mailbox email addresses
  as wildcards. Literal email matching now escapes those characters and the
  escape character in the two existing query locations.
- Ignored/unmatched/ambiguous messages persisted tentative tenant/customer/site/
  request foreign keys and operational attribution. Only matched correlation
  supplies those fields and the business fingerprint; tentative hints remain
  available in correlation evidence for platform review.
- A genuine canonical completion result with `ok: false` was reported as
  applied and emitted a success event. The parser now keeps that result in
  review, records the blocker code and `applied: false`, and emits no success.
- Successful canonical completion sets the request to completed. A second
  ingestion update only accepted old pending states, failed after completion,
  and left the inbound projection unfinished. Ingestion now finalizes only
  its inbound projection; the canonical command owns request state.

No low-level completion flags were added. Caller inspection shows the current
canonical completion path already supplies its own required arguments. No old
branch implementation, schema, catalog or auth model was imported.

Four production files changed: webhook route, manualInboundCorrelation,
manualInboundIngestion and manualFacilityResponseParser. The claimed legacy
manual-information regression script did not require a canonical path update
and remains unchanged. The new scoped behavioral test file contains 12 cases.

## Test-first evidence

The initial fixture omitted runtime-readiness view fields, so the first two
preparation runs did not qualify as genuine ingestion RED evidence. After the
fixture matched the actual `platform_runtime_readiness` view shape, unchanged
current source produced 9 failures and 3 passes at 16:38 UTC. The failures
covered the six defects above and the explicit reply-binding audit field.

After the scoped repair, all 12 new behavior cases and 4 retained tenant graph/
billing lifecycle cases passed at 16:41 UTC. Coverage includes positive matched
ownership, real completion result handling, provider-message replay, protected
identity, denied evidence writes, global verified contacts, ignored attribution
and signed webhook mailbox resolution.

The Supabase Data API test double evaluates emitted filters and row writes;
the RPC port returns success/rejection outcomes while the production completion
adapter and orchestrator execute. External notification, domain-event and cache
ports are declared. A null metering-point result deliberately prevents the
later intake/supplier-switch branch; that branch throws if unexpectedly called.
These are TypeScript behavior tests, not native SQL/RLS or complete onboarding
qualification. Reply references and verified contact records follow the existing
sender-credibility model; this change does not establish DKIM sender authenticity.

## Verification

All commands used the existing Node 22 binary at
`/tmp/gridex-sc047-npm-cache/_npx/d18f28baf1132559/node_modules/node/node_modules/node-linux-x64/bin/node`.
The ignored node_modules symlink reuses `/workspace/gridex-sc047-native-20261005`
dependencies. Both lockfiles have SHA256
`93ab57ed8646227fbfd7e45b3df908c3a6411729d0170c3fcca2c02b54f48627`.

- PASS: `vitest run __tests__/main-baseline-pr204-manual-inbound.test.ts
  __tests__/manual-inbound-tenant-graph-and-billing-lifecycle.test.ts` (16 tests).
  `NODE_OPTIONS=--require=./scripts/lib/unit-loopback-network-boundary.cjs` retained
  the existing unit-test network boundary.
- PASS: ESLint on the four changed production files and new test file.
- PASS: `tsc --noEmit --incremental false -p tsconfig.app.json`.
- PASS: `tsc --noEmit --incremental false -p tsconfig.tests.json`.
- PASS: `git diff --check`.
- EXISTING BASELINE FAILURE: the optional
  `scripts/gridex-manual-grid-owner-information-request-regression.cjs` exits 1
  after its first 13 migration assertions with `catalog defines Z01 profile`.
  The current canonical catalog computes its profiles rather than containing
  the old literal source strings. Exact base de6d22b script, migration and
  catalog bytes were executed from an isolated temporary baseline directory
  and reproduced the identical first failure. Their SHA256 values respectively:
  `3055e59d47d42238015d771878ffdcbf63fe79f9bcad4fdc93f9ad7bbddf74e7`,
  `335fa9593acbb32951250e1aa88b7c6914b1faadfd1d48fbfc6931fcbebc4aaf`,
  `550beda76a269d3d9d25e07aece84255015b74602e9673c089a107651b7a7fe8`.
  Later script assertions were not reached. The command is exposed in package
  scripts but is not referenced by current GitHub workflows. No unrelated
  catalog semantics or source-string checks were changed to manufacture green.

No dependency install, source changes outside the claim, migration, capture,
coverage edit, historical branch update, remote comment, push, merge or hosted
write occurred. Parent notified for independent review and owns publication,
required CI and merge. Old #204 should be closed only after the new replacement
is reviewed, qualified and merged.

## Independent-review follow-up — post-commit continuation failures

Initial local commit `439531c88df829ee58ead66b4ffdf3dd6bfbf0db` is preserved.
Root's independent review confirmed an additional terminal-state defect:
exceptions after a successful completion RPC reached the parser's ordinary
failure catch and downgraded a completed request to needs_review/applied:false.
Root extended the exact source claim in #204 comment5999056009 to
`lib/facility/facilityLookupWorkflow.ts` and
`lib/customer-operations/facilityResponseOrchestrator.ts`. No #223 source is
owned or changed; root took that independent lane under comment5999116870.

`receiving-code-review` was applied to verify the finding before implementation.
The installed Next `revalidatePath` API document was read before altering the
canonical adapter's continuation boundary.

The corrected unchanged-source RED run at 16:58 UTC had 4 failures/14 passes:
real website projection and actual metering/intake continuations downgraded the
committed state; actual canonical cache errors lacked a committed-result marker;
the marker-scope control could not obtain such a marker. The first preparation
run's two direct-adapter cases unintentionally reached the supplier-step port;
they were corrected to use the existing triggerNextStep:false contract before
the recorded valid RED run.

The canonical adapter now constructs `FacilityLookupPostCommitError` only after
the actual RPC error, result and request-identity guards have established a
successful completion. It carries the real completion result, company/request
scope and original `cause`. Website/cache/event/next-step exceptions propagate
with that marker. The orchestrator similarly marks failed continuations only
after receiving the canonical successful result. There is no status reread,
fabricated success result or catch that silently discards the failure.

The parser recognizes only the typed marker for its own company/request and
completed result. It records a continuation-review event and returns
needs_review/continuation_failed for ingestion, preserving the request's
completed status and applied:true evidence. Ordinary precommit RPC rejection
or denial retains the existing review path. A genuine marker generated by the
real adapter for another request is rejected both within the same company and
across companies. Same-company/different-request case/reply correlation now
also has its own independent behavioral contrast.

Latest extension verification:
- PASS: 52 tests across the scoped manual-inbound, retained tenant/billing,
  facility-address canonicalization and Ediel facility-identity suites at
  17:02 UTC. The scoped suite now has 19 cases.
- PASS: app and tests TypeScript checks, scoped lint and whitespace.
- PASS: root-delivered independent GO review reproduced all 52 cases and
  qualified RPC identity/scope guards, original cause and terminal preservation.
  Root authorized the additive local commit after unchanged 439531c. Root owns
  the replacement PR, fresh required CI and any eventual merge; none is claimed
  here.

External ports remain explicit. Successful cases with no metering-point result
skip later intake; the new failure case supplies a genuine-shaped metering ID
and reaches the real orchestrator's failing external intake port. This proves
post-commit preservation and review behavior, not successful supplier automation
or native database/RLS qualification. The earlier identical legacy source-string
script baseline failure remains unchanged.
