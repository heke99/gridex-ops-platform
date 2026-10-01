# API event-v2 — bounded 2026-09-30.1 candidate

## Starting versions and ownership

Same draft #422, branch `codex/tenantservice-api-structure-20260929`.
Published API starting head `a826b5886e7b946ea10164d8f736eac07e8c6ac1`;
original local API `9ed10d8cb1d43effa819fb33111adf5461e71c9f` has the same
tree and six later local commits. Original checkout and its dependencies are
untouched. A separate clone preserves that local checkpoint and merges the
exact new #418 `7afb3dcac62376edc5cab24c83ebcce80cb06e9a`, retaining the API
work. Local integration merge: `ac9ff989e07f318491963bf74cad26d91aa13603`.

Ownership was coordinated before edits in
[#422 comment5908285076](https://github.com/heke99/gridex-ops-platform/pull/422#issuecomment-5908285076).
Recheck both remote heads and competing writer comments before non-force
publication. The exact final published candidate SHA and its fresh CI results
are recorded in #422, since a commit cannot contain its own SHA. No production,
main merge, real issuer enrollment or full T/U/phase acceptance is included.

## Actual #418 prerequisite evidence

[Updated handoff5909289161](https://github.com/heke99/gridex-ops-platform/pull/422#issuecomment-5909289161)
records the full RPC signature and fresh CI on `7afb3dcac62376edc5cab24c83ebcce80cb06e9a`.
OPS run36699209245: verify109834394893, quality109834394435 and
clean109834394622 all success. Production audit reports zero at every severity;
quality runs 6,299 tests and build. All 11 event-native markers pass, including
stored domain versions 7/3/2/4, both sources, two customers in A and one in B,
microsecond ties/shared UUIDs, 116 events/58 pages/59 identical SQL replays,
v1 parity/limits, actual service-role reads and anon/authenticated42501,
unchanged sources and authentic type/schema parity.

Clean artifact11089364299 was downloaded and compared byte-for-byte:
ZIP SHA256 `77c83873b9b58c803ee5be8274dd29f3333b79f1d95cae27992ff89667946e01`;
replay log `be83ca7f44619691e701228262f1aebc47147028c8b1f727b678a28b22b587ea`;
type hash `301fcaf283405cf7c9ef71f74363c276bb91269354f678a7c8baffe895bd7664`;
schema fingerprint `dbeb4ba40bffcaf6c0e49b83ffa32417a9429baec3357ee37e8b388887564f86`.
CI checkout `4c8e5c39ebbe929a5a6254df3567083e173498f0` adds unrelated
Ediel/main work; the event/dependency package files are identical to head.
These are SQL/native proofs, distinct from the new HTTP proof below.

## Reproduced API defects and minimal source change

The new read-model test first fails twice because the real `listPortalEventsPage`
calls v1 rather than v2. Change only the RPC name. Company/customer arguments,
microsecond/rank/UUID cursor tuple, limit + 1, errors and page builder stay
unchanged. Missing v2 remains a controlled schema-readiness error; no v1
fallback invents or loses versions. Auth/scope/delegation/identity resolution
and the actual GET route are unchanged.

The same test then directly reproduces a second defect: two source rows sharing
an ID produce the same opaque event reference. This can collapse distinct feed
items in a client's reference-based processing. The DTO now derives known
feed references from source + ID, still scoped by organization. Legacy values
without a recognized source retain their former reference derivation. The
public five-field allowlist, timestamps and truthful positive-version/null
projection are unchanged. This is a confirmed source-level collision, not a
claim of observed production loss. The new contract/guide calls out the draft
reference change and asks clients to refresh their event list.

## New actual HTTP/native proof — pending first candidate CI

`customer-event-v2-native.config.ts` requires CI=true, the temporary local
Supabase status file, local API127.0.0.1:54321 and a fixture path under
RUNNER_TEMP. `customer-event-v2-native.test.ts` creates only synthetic local
companies, three customers, GoTrue users/accounts, API clients/receipts and
temporarily trusted RSA assertions. It seeds both real event tables and reads
v2 under actual service_role. Eight A1 rows have hand-derived versions
1/1/1/7/3/2/4/4; A2 and B1 each have two rows including version9 and11.
Shared source UUIDs and microsecond timestamps test all three ordering keys.

`customer-event-v2-local.spec.mjs` sends actual HTTP through the local Next server
to the unchanged events route, resolved identity, service-role Data API and
v2 RPC. It requires all five public fields, source-derived distinct references,
actual stored versions, four two-row pages and replay of each input cursor,
same-time/source/ID ordering, separate A2/B1 results, foreign/malformed cursor
400, missing key401, missing/wrong action/customer/client proof403 and missing
event scope403. HTTP invalid/zero limit preserves default50; valid1 and large
limit preserve min1/cap100. Source snapshots and actual access-log reads are
checked natively after HTTP. New request traces are off to keep synthetic keys
out of evidence; existing browser traces/assertions/retries remain unchanged.

The workflow adds seed -> HTTP -> native post-read to the same disposable replay
before the existing independent case browser. It removes temporary credentials
after success; the replay's EXIT trap destroys the entire local stack on failure.
No credentials/fixture are included in the uploaded artifact. Markers are
`EVENT_V2_HTTP_SEED_NATIVE_PASS`, `EVENT_V2_HTTP_NATIVE_PASS` and
`EVENT_V2_HTTP_POST_NATIVE_PASS`. Their actual results remain pending CI here;
test discovery alone is not HTTP/native evidence.

## New immutable contract pair and preserved later API contracts

Paired version `2026-09-30.1`, generated/finalized/materialized through existing
tools. Both new immutable JSON artifacts/routes are registered. Current version
source, documentation, version gates and runtime-version assertions advance
together. Metering, legal acceptance, invoice, document/notification and power
of attorney implementations are preserved. Historical JSON/routes are not
rewritten: **92 files are byte-identical to a826b588**.

| Artifact | SHA256 |
| --- | --- |
| customer-portal-v1.json | `e667516da52aa2f01e0c1e7f7d50f466540ff2a7579c7644d3a3ce6d6842e67d` |
| website-integration-v1.json | `a1e78bb1098dbd7736f4d80c3d292cfcc4c5c1928d457ab612960d55318b16cc` |

The finalizer/materializer was repeated and reproduced the exact same new bytes;
the immutable writer refused no artifact and local release verification passed.
The version stays a draft release candidate. Local release verification does
not imply deployed production bytes or a real issuer/customer feed. The sample
client has synthetic version1 and7 responses and remains a service-double demo.

## Executed local validation

| Check | Result |
| --- | --- |
| New actual reader/DTO tests before source correction | RED: v1 RPC name; then duplicate cross-source reference |
| Reader + existing event route/contract files | PASS: 16/16, including 10 new reader/cursor/lookahead/fail-closed tests |
| Full suite under project Node22.23.3 | PASS: 6,370/6,370 in 422 files |
| App/test/script typechecks | PASS |
| Scoped ESLint, TS and new HTTP spec; CJS/HTTP `node --check` | PASS, no new warnings |
| api:docs, api:compatibility, api:release:verify | PASS for2026-09-30.1 |
| Synthetic signed localhost journey | PASS, including event versions1/7; service doubles, not native DB |
| Playwright discovery | PASS: one new actual HTTP/native case |
| Historical immutable bytes | PASS:92files unchanged |

The initial full local run under Node24 had six sandbox-blocked subprocess
checks. A permitted rerun demonstrated two old wrappers expected Node22's TAP
summary, while actual underlying child cases passed under Node24's spec reporter.
Use the declared Node22 runtime: the complete suite then passes without changing
those tests, assertions, timeouts or any gate. An explicit Client fixture type
and separate page/replay increments resolved new TS/lint diagnostics.

Independent review caught a native-fixture blocker before publication: the
initial synthetic `fixture.*` event names violated the active customer-events
check `^customer\.[a-z0-9_]+$`. The seed now uses constraint-valid
`customer.fixture_*` names consistently in both tables. This is a direct schema
finding and corrected seed, not a claim that its native execution already passed.

Current checkpoint: local source/release verified; independent review and
non-force publication pending. Next: recheck heads/ownership, publish the exact
tree with a826b588 and7afb3dca as preserved parents; await fresh exact-head CI and
record actual native HTTP, release and regression results in #422. If CI fails,
fix its evidenced cause and use a new commit, not a manual rerun of old evidence.

Skill routing: existing isolated-worktree workflow; systematic debugging,
TDD/direct false-positive verification, Supabase service-role/filter guidance,
installed Next route docs, scoped contract parity, independent read-only review
and verification-before-completion. No UI/performance/schema refactor, hook
installation, repository-wide audit or unrelated phase workflow is triggered.
The 75-ID requirement matrix is inherited without additional status changes.

## Independent release review and metadata correction — 2026-09-30

Read-only review of exact source candidate
`56e7a5429273061043b3a652b2f496a3e419f74f` against API parent `a826b588`
found one low-severity release-metadata defect: the new `2026-09-30.1`
manifest retained the previous candidate's `2026-09-29T16:57:54.000Z`
instant, and its targeted assertion retained that same stale value. In the
separate publication checkout, both are corrected to the actual preparation
instant `2026-09-30T12:23:11.000Z`. This changes manifest metadata only;
runtime versions, references and contract shapes remain unchanged.

The existing finalizer, presentation normalizer and immutable materializer were
rerun successfully for the unreleased `2026-09-30.1` pair. Final current and
immutable JSON bytes initially reproduced the pre-503 candidate hashes:
customer portal `535b8f5ea0abb0dfb6d783751f802dfac3ad606dc7790a6d11ec72536f7e5795`
and website `a1e78bb1098dbd7736f4d80c3d292cfcc4c5c1928d457ab612960d55318b16cc`.
The intermediate finalizer hashes precede presentation normalization and are
not release-byte hashes.

Independent tree comparison verifies **92 historical immutable JSON/routes**
and **four historical API report/manifest artifacts** retain their exact blobs
and Git modes against `a826b588`. All 45 prior customer-portal operation IDs
and 65 prior website operation IDs remain unchanged; the new specifications
contain 46 and 67 unique operations respectively, with no missing IDs.
Apart from release-version metadata and the new immutable endpoints, schema
changes are confined to the two documented event-reference/version descriptions.
The later legal, metering, invoice, document/notification and authority contract
shapes and implementations are preserved. The feed reference change is
explicitly documented as requiring a refreshed list for earlier draft clients;
the existing release classification remains `breaking-client-update-required`.

Fresh checks under Node **22.23.3** after the correction all passed:

- `check-api-compatibility.cjs`, `verify-openapi-release.cjs` and
  `check-api-documentation-version.cjs`;
- all seven `api:docs` component gates (85 route files, 87 registry routes,
  113 OpenAPI operations and 58 reachable schemas);
- `post-128-openapi-tip-residuals.test.ts` **2/2** and
  `openapi-release-metadata.test.ts` **4/4**, including served-byte manifest
  hash assertions;
- the synthetic delegated customer reference-client journey, including
  event versions 1/7 and its retained legal/metering/document/notification flows;
- `git diff --check`.

No remaining confirmed contract/release finding was identified in this bounded
review. Actual HTTP/native proof, new exact-head CI, publication and deployed
release-byte verification remain separate required evidence owned by the parent
task; these local checks do not supply those results. The original source
candidate was unchanged, and this review did not commit or push.

## Missing-read-model HTTP 503 contract correction — 2026-09-30

The source reviewer reproduced a missing-v2 error that the actual events route
previously handled as a generic 500; the parent task separately corrected the
public error mapping to safe, retryable HTTP 503. Independent contract review
then found that the events operation documented no 503 response. A new targeted
current/immutable-spec assertion reproduced that omission as **RED 1/5**.

The portal finalizer now documents events 503 through the existing canonical
`ErrorEnvelope` and standard response headers. Its description and guide name
`platform_schema_not_ready`, `retryable: true`, delayed retry and the absence of
database diagnostics or a v1 fallback. Only the unpublished `2026-09-30.1`
portal artifact was removed and recreated through the immutable materializer;
all older artifacts remain unchanged. Website release bytes remain unchanged.
The final checksums are the artifact-table values above: portal
`e667516da52aa2f01e0c1e7f7d50f466540ff2a7579c7644d3a3ce6d6842e67d` and website
`a1e78bb1098dbd7736f4d80c3d292cfcc4c5c1928d457ab612960d55318b16cc`.

Fresh Node22.23.3 validation after regeneration:

- all seven `api:docs` component gates, compatibility, local release verification
  and public error-registry parity **PASS**;
- current/immutable event-contract, actual-route error, manifest/hash and
  fixed-timestamp tests **15/15 PASS** across four files, including the new
  503 assertion **GREEN 5/5**;
- independent filesystem comparison **96/96** historical artifacts preserve
  exact bytes and Git modes, all prior operation IDs remain unchanged, and each
  current/immutable pair is byte-identical;
- targeted TypeScript-test ESLint and generator syntax validation **PASS**.

This final unpublished pair supersedes the pre-503 portal checksum recorded in
the earlier review. Publication, actual HTTP/native success and deployed-byte
verification remain parent-owned. No commit or push was made by this reviewer.

## Parallel final review and publication checkpoint — 2026-09-30

The isolated publication checkout retains the prepared `56e7a542` candidate,
original local API history and exact #418 prerequisite. Three independent
reviews ran concurrently. Source review traced the complete guard/resolver,
service-role v2 reader, customer-bound cursor and allowlisted DTO. It reproduced
an inherited missing-read-model HTTP500 and corrected the shared handler to a
safe retryable 503; the actual GET regression preserves generic500, cursor400
and authorization denial before the RPC. Native-fixture review confirmed the
schema-valid synthetic seed and workflow sequence, then reproduced Playwright
transport error header leakage with dummy credentials. The new request helper
discards the original error/cause; an actual loopback socket-reset regression
proves published error strings contain no header sentinels. All nine new HTTP
request sites use that helper. Reviewers cross-reviewed both narrow fixes.
Release review corrected the stale manifest instant and added current/immutable
503 contract parity. No review weakened a guard, assertion, limit, timeout or
historical release.

Fresh final local verification after these source/contract fixes:
full Vitest **6,376/6,376 in424files**; focused event/route/transport **15/15**;
app/test/script typechecks, targeted lint, RBAC and local release/compatibility
checks PASS. A local Next production build passed during final review; the
published candidate still requires its own ordinary CI build and actual
HTTP/native replay. Formal GitGuardian scan is unavailable (ggshield missing),
so no scanner success is claimed. This is a bounded code review and regression
qualification, not full tenantservice/phase/production acceptance.

The pre-publication tree is frozen after reviewer ownership handoff. Publication
will use a non-force fast-forward, preserving remote API `a826b588` and OPS
`7afb3dca` as parents; the original `9ed10d8c` and `56e7a542` checkouts/commits
remain untouched. Final published SHA, actual HTTP/native markers and fresh
CI receipts are recorded in #422. Native HTTP results remain pending at this
checkpoint; previous SQL receipts are not substitutes. No production/main
merge, real issuer enrollment or full T/U/phase acceptance is included.
