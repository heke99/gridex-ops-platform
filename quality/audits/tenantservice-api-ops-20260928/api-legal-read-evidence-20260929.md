# Legal acceptance read — local 2026-09-29.8 evidence

Status: PARTIAL. One existing legal GET contract/client checkpoint on
`codex/tenantservice-api-structure-20260929`, draft #422. Base/START:
`d83942408f33e7c9f2be66c34145e9419f34b64c`. No push, PR write, SQL, native
fixture, OPS/UI, #418, requirements.csv or global memory change.

## Skill routing and implementation boundary

Activated repository TDD (including writing-good-tests), systematic-debugging
and verification-before-completion for reproducing the contract gap and
fresh verification. Followed the implementer prompt and prepared task plan.
Read installed Next route-handler documentation and Supabase skill/filter
guidance; no Supabase implementation or schema change was needed. Supabase
changelog markdown retrieval was unsupported by search; current official
using-filters, or, order and limit references were available. UI/performance,
database optimization/migrations, provider activation and broad audit/codebase
document creation workflows are outside this narrowly delegated checkpoint.
Formal secret scanner unavailable; no scanner qualification is asserted.

The actual `GET /api/v1/customer/legal-acceptances` runtime already correctly
uses `customer_legal.read`, the exact signed action, customer/organization-bound
keyset pagination and an allowlisted DTO. It was not changed. Only the shared
contract version source advances to 29.8 for paired public releases.

`publicPageInput` accepts only positive integers; invalid/fractional/zero/
negative values become null. `portalPageLimit` therefore defaults to **50**,
not the tentative 30 in the original brief, and caps valid large limits at
100. Generator descriptions and tests reflect the verified behavior.

`CustomerLegalAcceptance` is closed and requires exactly nine fields:
acceptance_reference, acceptance_type, document_reference, document_code,
document_version, document_hash, accepted_at, source and created_at. All but
the guaranteed row-derived acceptance reference are nullable strings. Hash
and timestamps intentionally are not given stronger validation than the
existing text projection. The document reference prefers bundle-document ID,
then legacy legal-text ID, and remains null if neither exists.

## RED before implementation

Command:

```sh
node node_modules/vitest/vitest.mjs run __tests__/customer-api-legal-read-parity.test.ts
```

Against unchanged 29.7 generator/artifacts: **3 failed, 1 passed**.
Expected failures: missing query `limit`/`cursor`; undefined concrete `data`
array item/page response; undefined `CustomerLegalAcceptance` schema. The
independent DTO projection already passed. Initial draft test incorrectly
assumed all parameters were inline; `$ref` parameters caused a TypeError.
Fixed only that test's optional-name handling and re-ran to the three intended
assertion failures before any generator edit. Initial `npx` invocation also
emitted the existing npm http-proxy warning; direct Node run was pristine.

Existing route characterization, before generator edits:

```sh
node node_modules/vitest/vitest.mjs run __tests__/customer-api-legal-read-routes.test.ts
```

**11/11 passed.** Real GET, guard, signed RS256 assertion verification,
identifier parser, canonical error/success envelope, payload safety, DTO,
encrypted cursor parser/builder and schema-error classifier run unchanged.
Synthetic boundaries: API-key authorization/request-log service, active
account lookup, cursor-key environment and Supabase query calls. The database
double applies emitted organization/customer filters, descending timestamp/ID
orders, keyset predicate, projection and limit to deliberately unsorted tied
rows plus foreign customer/company rows. This is not native SQL/RLS proof.

Coverage: nine public fields/no internal item data, opaque/hand-derived bundle
and legacy references, three timestamp-tied pages without duplicates, scope
and missing/wrong-action/revoked-link denials before legal list reads, foreign
customer/tenant/resource and tampered cursors as controlled 400 before legal
list reads, default/cap/invalid-limit parser behavior and both schema fallbacks
with truthful null fields. Access-log writes are synthetic and are not legal
list reads.

## GREEN and exact local commands

```sh
npm run api:finalize && npm run api:materialize
node node_modules/vitest/vitest.mjs run __tests__/customer-api-legal-read-parity.test.ts __tests__/customer-api-legal-read-routes.test.ts
```

**15/15 passed.** Generator is minimal: closed item, required page response,
read query descriptions; current artifacts/fixture, paired immutable29.8
JSON/routes, registry, guides and version gates generated/updated through
existing tooling. First generator attempt had a local variable name collision
with a pre-existing `legalOperation`; renamed the new variable to
`legalReadOperation`, then generation passed. No runtime fix was needed.

Related regression command (final re-run after self-review):

```sh
node node_modules/vitest/vitest.mjs run __tests__/customer-api-legal-read-parity.test.ts __tests__/customer-api-legal-read-routes.test.ts __tests__/customer-api-metering-parity.test.ts __tests__/customer-api-metering-routes.test.ts __tests__/customer-api-event-poa-parity.test.ts __tests__/customer-api-event-poa-routes.test.ts __tests__/customer-api-invoice-parity.test.ts __tests__/customer-api-invoice-routes.test.ts __tests__/customer-api-contract-parity.test.ts __tests__/customer-api-document-notification-parity.test.ts __tests__/customer-api-document-notification-routes.test.ts __tests__/customer-api-notification-read-routes.test.ts __tests__/customer-delegation-boundary.test.ts __tests__/customer-delegation-assertion.test.ts
```

**68/68 passed in 14 files**, test output pristine. Broader complete configured
suite/quality and independent read-only reviews remain root-owned before
publication; this targeted checkpoint is not full T/U/P-phase acceptance.

```sh
npm run typecheck && npm run typecheck:tests && npm run typecheck:scripts
npm run api:docs && npm run api:compatibility && npm run api:runtime:parity && npm run api:release:verify
node scripts/tenantservice/customer-api-reference.mjs
npm run quality:large-file-budget
npm run quality:bundle-budget
git diff --check
```

All passed. TypeScript app/test/script projects exit0 (scripts project includes
TS/MTS, not CJS). API docs:83 route files,85 registry routes,110 OpenAPI
operations,58 reachable schemas. Compatibility/runtimeparity and local
releaseverify pass; deployed bytes were not probed. Signed loopback HTTP
fixture/client passes legalPages2, foreignLegalCursor400, wrongLegalAction403,
exact item/public fields and second-page nulls, no internal snapshots. It
uses a temporary in-memory issuer key and synthetic data, not a hosted route.
Existing writes in the pre-existing wider synthetic journey remain unchanged.
Budget: new source files capped at 1800; new tests 58/179 lines, modified portal
finalizer 1338 and reference client 555, no broad refactor. Browser bundle budget:
largest chunk 201055 bytes, three route budgets verified after successful build.

Pristine configured scoped TS/MJS lint:

```sh
node node_modules/eslint/bin/eslint.js __tests__/customer-api-legal-read-parity.test.ts __tests__/customer-api-legal-read-routes.test.ts scripts/tenantservice/customer-api-reference.mjs lib/api/publicRouteRegistry.ts lib/integrations/websiteIntegrationContract.ts app/api/v1/openapi/2026-09-29.8/customer-portal-v1.json/route.ts app/api/v1/openapi/2026-09-29.8/website-integration-v1.json/route.ts
for f in scripts/finalize-openapi-release.portal.cjs scripts/finalize-openapi-release.cjs scripts/professionalize-openapi-contract.cjs scripts/check-api-compatibility.cjs scripts/check-api-documentation-version.cjs scripts/check-public-contract-runtime-openapi.cjs scripts/verify-openapi-release.cjs scripts/tenantservice/customer-api-reference.mjs; do node --check "$f" || exit; done
```

Both exit0 with no output. CJS files are **NOT linted by configured lint**:
eslint.config excludes `scripts/**/*.cjs`. An initial all-path scoped lint
returned0 with seven ignored-file warnings. Diagnostic `--no-ignore` on those
seven CJS files reports10 pre-existing no-require-import errors and3 unused
warnings; identical diagnostics were reproduced from base bytes via
`git show d83942408f33e7c9f2be66c34145e9419f34b64c:"$f" | node node_modules/eslint/bin/eslint.js --no-ignore --stdin --stdin-filename "$f"` for each file. No lint config or baseline code was changed.

## Build

`npm run build` compiled successfully but its TypeScript worker hit the
existing ~2GiB Node heap limit and exited1. Standalone types had passed.
Safe no-code retry command: `NODE_OPTIONS=--max-old-space-size=4096 npm run build`.
**Retry exit0:** Next 16.3.5 webpack compiled in 24.3s; TypeScript finished in
54s; static generation14/14 and trace collection completed. The existing legal
GET and both29.8 immutable route paths are included in the successful build.
No build configuration/dependency change was made. Node runtime24.19.0.

## Determinism and preservation

Repeated `npm run api:finalize && npm run api:materialize` produces identical
final bytes; immutable materializer accepts only byte-identical repeats.
`sha256sum` before/after another full repeat:

| Artifact (current and29.8 immutable match) | Final SHA256 |
| --- | --- |
| customer-portal-v1.json | 6cda7aa7479dc79ceb81211360aa9f662afe0ed3d0114c321f7ee7fa6d8dda5c |
| website-integration-v1.json | 3cdf3f8fb4de8aeefd23078844930adbff833110a87691a2eca3a92c6f29cb7b |
| public-contracts-response-2026-09-29.8.json | ee84b54bf8144b878bc837cb8bfeba64a74ddf5e0465287b2dbad14d89258bd0 |

```sh
git diff --exit-code d83942408f33e7c9f2be66c34145e9419f34b64c -- docs/openapi/releases app/api/v1/openapi docs/fixtures
```

Exit0 before staging new29.8 files: **all previously tracked immutable release,
route and fixture bytes unchanged**, including29.5/29.6/29.7. Previous release
paths remain registered and documented. No manual generated-JSON edits.

## Open boundaries

PARTIAL only: no native DB replay/RLS/concurrency proof, hosted/customer/provider
calls, deployed-byte proof, PR review/CI/merge or external activation. No support,
case, message or attachment route exists in the current external customer
runtime/register and none was added or advertised. Absent v1 `event_version`
remains null; no v2 event RPC/migration introduced. Formal GitGuardian scan
BLOCKED/unavailable (CLI absent/unconfigured); existing api:docs-examples
sensitive-documentation pattern check passed, not a general secret scan. Root
will inspect the candidate diff and qualify its broader repository gates.

## Review fix round 1 — current-release regression pins

Fix base: `bbaafe2eaa2636e73f62211edbe064f78436f9d0`. Root's broader configured
`npm test` on this base reported **6342 passed / 7 failed in 417 files**: five
stale current-release expectations and two unchanged Ediel Node 24 formatter
wrapper cases. This was not a full-suite green result. The initial targeted
package verification above did not include the five current-release tests;
that coverage omission is corrected here.

Classified and changed only current-release assertions:

- `tenant-website-go-live-hardening.test.ts`: current portal guide version.
- `pricing-settlement-semantics.test.ts`: current canonical runtime version.
- `post-128-openapi-tip-residuals.test.ts`: current contract candidate version.
- `website-application-settlement-contract.test.ts`: current Website OpenAPI.
- `website-quote-validate-contract-parity.test.ts`: current Website OpenAPI.

These tests consume current docs/constants, not historical release paths.
Updated their five literals from 29.7 to 29.8. Historical migration anchors,
fixed manifest instant, intentionally historical checks and all historical
release routes/artifacts remain unchanged. No Ediel wrapper, runtime, generator,
global lint, dependency or generated artifact edit.

Exact RED and GREEN command (run before and after the five-literal fix):

```sh
node node_modules/vitest/vitest.mjs run __tests__/tenant-website-go-live-hardening.test.ts __tests__/pricing-settlement-semantics.test.ts __tests__/post-128-openapi-tip-residuals.test.ts __tests__/website-application-settlement-contract.test.ts __tests__/website-quote-validate-contract-parity.test.ts __tests__/customer-api-legal-read-parity.test.ts __tests__/customer-api-legal-read-routes.test.ts
```

RED: **5 failed / 27 passed**, five failed / two passed files; each failure was
the reviewed current 29.8 versus expected 29.7 assertion. GREEN: **32 passed in
7 files**, exit 0, pristine output (1.20s). Legal read tests remain included.

```sh
node node_modules/eslint/bin/eslint.js __tests__/tenant-website-go-live-hardening.test.ts __tests__/pricing-settlement-semantics.test.ts __tests__/post-128-openapi-tip-residuals.test.ts __tests__/website-application-settlement-contract.test.ts __tests__/website-quote-validate-contract-parity.test.ts __tests__/customer-api-legal-read-parity.test.ts __tests__/customer-api-legal-read-routes.test.ts && npm run typecheck:tests
git diff --check
git diff --exit-code bbaafe2eaa2636e73f62211edbe064f78436f9d0 -- scripts lib docs/openapi docs/fixtures app/api/v1/openapi
```

All exit 0. Scoped lint pristine; test types pass (existing npm http-proxy
warning remains). Diff check and generator/runtime/artifact byte preservation
check pass with no output.

Additional root-reported verification, not re-executed by the implementer:
configured full lint exit 0 with 101 pre-existing warnings outside task paths;
quality 45/45, mechanical/performance and RBAC 24 checks passed. Root's focused
environment diagnostic:

```sh
NODE_OPTIONS='--max-old-space-size=4096 --test-reporter=tap' node node_modules/vitest/vitest.mjs run __tests__/ediel-unb-ack-request.test.ts __tests__/ediel-prodat-free-text.test.ts
```

Reported **2/2 passed**, with no source change. Root will rerun the complete
configured suite with the TAP reporter environment on the fix commit and
handle independent review/publication. **No full-suite green is asserted here.**
All original PARTIAL, native proof, scanner and publication limits remain.

## Combined final-review fix wave — isolate sync identity header schemas

Fix base: `242c9e68fbdccf381d336148a099f8ca10ab528a`. Review found the main
finalizer inserts shared `CustomerPortalUserId`/`AuthUserId` parameter objects
into both `/api/v1/customer-portal/sync` and delegated `/api/v1/customer/*`
operations. The portal finalizer then made the delegated header objects
optional with plain-string subject schemas, inadvertently mutating the legacy
sync operation and components too. Actual legacy sync requires both headers,
matching both valid body UUIDs, and returns 422 `portal_identity_mismatch`
before idempotency/customer reads when either header is omitted.

Activated receiving-code-review, systematic-debugging, TDD and fresh
verification. Added independent literal contract assertions in
`customer-portal-sync-header-parity.test.ts` for each required UUID legacy
header and retained optional delegated legal hints/mandatory signed assertion.
Added three actual legacy POST omitted-header cases to the existing revocation
tests, preserving four existing positive/revocation cases. Actual POST/body
schema/header checks are real; existing synthetic auth, service and idempotency
boundaries remain, with observation of no claim/customer read on rejected input.

RED command before generator edits:

```sh
node node_modules/vitest/vitest.mjs run __tests__/customer-portal-sync-header-parity.test.ts __tests__/customer-portal-sync-revocation.test.ts
```

**2 failed / 8 passed**: legacy headers had `required:false` and no UUID
format; delegated contract, three omitted-header runtime negatives and four
existing route cases passed. Minimal correction clones each delegated operation
parameter before mutation in the portal finalizer. This preserves the shared
legacy header objects as required UUIDs without a runtime rewrite.

The same header schema also inherited contradictory “Optional” prose through
the main finalizer's shared generic UUID object used by website application
fields. Root explicitly included this same-header prose correction in the
combined wave. Added `.not.toMatch(/optional/i)` to the independent header
assertions; the same command again yielded **2 failed / 8 passed** against the
cloning-only candidate. Isolated the two header schemas with local UUID copies
and required/body-match descriptions in the main finalizer. The generic UUID
and Website properties were not changed.

Regenerated current and unpublished 29.8 candidate portal JSON through existing
tooling only. Moved prior unpublished portal candidate bytes recoverably into
`/tmp/gridex-legal-read-unpublished-29.8-1YnpSv/` before materialization (original
and intermediate pre-prose copies retained); no published historical file was
moved or rewritten. Existing immutable refusal guard was not weakened.

```sh
npm run api:finalize
npm run api:materialize
npm run api:finalize && npm run api:materialize
sha256sum docs/openapi/customer-portal-v1.json docs/openapi/releases/2026-09-29.8/customer-portal-v1.json docs/openapi/website-integration-v1.json docs/openapi/releases/2026-09-29.8/website-integration-v1.json
node node_modules/vitest/vitest.mjs run __tests__/customer-portal-sync-header-parity.test.ts __tests__/customer-portal-sync-revocation.test.ts __tests__/customer-api-legal-read-parity.test.ts __tests__/customer-api-legal-read-routes.test.ts __tests__/api-canonical-release.test.ts __tests__/customer-delegation-boundary.test.ts __tests__/customer-delegation-assertion.test.ts
node node_modules/eslint/bin/eslint.js __tests__/customer-portal-sync-header-parity.test.ts __tests__/customer-portal-sync-revocation.test.ts && node --check scripts/finalize-openapi-release.portal.cjs && node --check scripts/finalize-openapi-release.cjs && npm run typecheck:tests && npm run typecheck:scripts && npm run typecheck
npm run api:docs && npm run api:compatibility && npm run api:release:verify
set -o pipefail; npm run api:runtime:parity | tail -3
npm run quality:large-file-budget
git diff --check
```

All required commands passed. **55/55 tests in 7 files**, pristine output
(1.67s); app/test/script types, scoped test lint and CJS syntax pass (CJS remains
excluded from configured lint). API contract/parity/docs/compatibility/local
release verification and source budget pass. No new dependencies or lint config.
Repeated generation/materialization is byte-identical. Final candidate SHA256
supersedes earlier portal hashes above:

- Portal current and 29.8: `529e4ae5cc2519dfd4036d15c86a59a580019cba94b6a81cfd0633412542b257`.
- Website current and 29.8 unchanged: `3cdf3f8fb4de8aeefd23078844930adbff833110a87691a2eca3a92c6f29cb7b`.

```sh
git diff --exit-code 242c9e68fbdccf381d336148a099f8ca10ab528a -- docs/openapi/releases app/api/v1/openapi docs/fixtures ':(exclude)docs/openapi/releases/2026-09-29.8/**'
git diff --raw 242c9e68fbdccf381d336148a099f8ca10ab528a -- docs/openapi/customer-portal-v1.json docs/openapi/releases/2026-09-29.8/customer-portal-v1.json
git diff --exit-code 242c9e68fbdccf381d336148a099f8ca10ab528a -- app/api/v1/customer-portal/sync lib supabase docs/openapi/website-integration-v1.json
```

Preservation checks exit 0/no output; all published historical release/route/
fixture bytes and modes unchanged, including 29.5/29.6/29.7. Raw candidate
diff reports mode `100644` to `100644` only. Runtime/lib/SQL/Website unchanged.
No matrix, native fixture, #418, migration or remote mutation.

Optional extra command `node scripts/tenantservice/customer-api-reference.mjs`
was attempted after required gates and is **BLOCKED in this refreshed sandbox**:
`listen EPERM: operation not permitted 127.0.0.1`. Prior implementation-wave
loopback pass remains historical evidence, not a fresh success for this wave.
No bypass or source change. Root will rerun this exact command with appropriate
authorized subprocess/listen permission and the appropriate broader checks on
the fix head before publication. Native/scanner/full-phase limits remain PARTIAL.

## Root final verification — 2026-09-29

Verified source head: `e554af13ec204c23d986735e4a77abc4bbd33d95`.
The single combined final-review correction is independently ADDRESSED;
focused re-review reports no new findings and no parked findings. Publication
remains a draft PARTIAL checkpoint, not masterplan or native acceptance.

| Command/check | Actual result |
| --- | --- |
| `NODE_OPTIONS='--max-old-space-size=4096 --test-reporter=tap' npm test` | 418/418 files, 6355/6355 tests pass, 41.70s |
| `node scripts/tenantservice/customer-api-reference.mjs` | Pass: legalPages=2, foreignLegalCursor=400, wrongLegalAction=403; other existing synthetic journeys also pass |
| `NODE_OPTIONS=--max-old-space-size=4096 npm run build` | Pass: compile 29.7s, TypeScript 7.8s, static pages 14/14 and build traces complete |
| Finalizer, professionalizer and materializer, twice; `git diff --exit-code HEAD -- docs/openapi docs/fixtures app/api/v1/openapi lib scripts` after each | Pass, no diff |
| `git ls-tree -r` at preserved task base `d8394240` and final source head | All 114 prior artifact blobs AND modes unchanged; canonical requirements blob unchanged |
| `git merge-base --is-ancestor 4b4a062290f9b188189cfee997470a3612c18c39 HEAD` | Pass; original unpushed ancestry preserved |
| `git diff --check` and status | Pass, clean before this evidence-only appendix |

The full suite and loopback client used automatically approved subprocess/listen
permission after the restricted environment blocked unchanged subprocess probes
and local listening. A restricted build failed while parsing TypeScript
`--showConfig`; the identical build with approved subprocess access passed.
No source, assertions, dependencies or build configuration were changed to
resolve these environment failures. TAP selects the Node 24 output format
expected by unchanged Node 22 subprocess wrappers; tests were not skipped.

Earlier broader configured lint exited 0 with 101 existing warnings outside
the task; do not describe it as warning-free. Scoped amended-test lint and
syntax are pristine, app/test/script types and API documentation, contract,
runtime parity, compatibility and local release gates pass as recorded above.
Earlier mechanical, quality 45/45, performance and RBAC 24-check results remain
bounded local evidence; final correction did not alter runtime authorization.

Final artifact SHA-256: portal
`529e4ae5cc2519dfd4036d15c86a59a580019cba94b6a81cfd0633412542b257`,
website `3cdf3f8fb4de8aeefd23078844930adbff833110a87691a2eca3a92c6f29cb7b`,
fixture `ee84b54bf8144b878bc837cb8bfeba64a74ddf5e0465287b2dbad14d89258bd0`.
Root inspected the candidate source/fixture diff: identifiers and mock keys are
synthetic, the signing issuer is generated in memory, and no real credential or
customer-data addition was observed. **Formal GitGuardian scanning is unavailable**
(`ggshield` is absent/unconfigured); source inspection and the documentation gate
are not a passed general secret scan.

Latest pre-publication remote checks: #422 `2b0c0ef2d45cb912e7c37cf073a2660edbbf11a0`,
#418 `750510b81bb4ff98e20723ae3f97a0e1bbb6d34f`, both open/draft. PR discussion shows
only the draft-review bot; our sole implementer has finished and does not push.
Remote heads will be checked again immediately before a non-forced fast-forward.
Git CLI transport is unavailable through the configured proxy; publication uses
the GitHub connector and verifies the remote tree equals the locally tested tree,
including executable modes. Actual public head, automatically triggered exact-SHA
CI run/job IDs and outcomes belong in #422's description after publication;
this appendix does not claim that remote CI has already passed.

Still open: masterplan service-role event-v2 migration/native proof (version >1,
both event sources, two customers, tied timestamps and cursor replay), native
legal SQL/RLS/concurrency and deployed issuer/customer integration. Existing v1
event versions remain truthful nullable projections. No absent support/case/
message/attachment endpoint is added; no whole T/U point or P phase is accepted.
