# Actual local served API release evidence — 2026-09-30

Status: **RELEASE_2026_09_30_3_LOCAL_HTTP_4_OF_4_VERIFIED; T48_FULL_ACCEPTANCE_OPEN**.
The root integrator owns release generation, active/version metadata, guide
registry corrections, workflows, publication and exact-head hosted evidence.
This worker made no commit, push, deployment or hosted write, and did not rewrite
any historical OpenAPI JSON or versioned route.

## Independent review before implementation

Read-only review of the current OPS integration found no concrete blocker in
the added native ordering or company-settings fixture wiring. Webhook fairness
precedes the JavaScript producers that enqueue delivery rows; the site worker
proof schedules only its own fixture at minimum priority; clean schema/types
are captured immediately after replay; disposable fixture credentials/status
files stay outside uploaded artifact paths. Full native execution remains a
separate requirement and was not inferred from source review.

The requirements worker's lifecycle prerequisite repair provisions four nullable
legacy customer fields before the revision trigger can access them. Existing
fields and closure values remain intact, and legal/lifecycle counters remain
separate. Independently executed the actual-SQL PostgreSQL-core PGlite
regression under Node22: **4/4 PASS**. This does not qualify the full Supabase
clean or upgrade replay, and no legal/profile migration was edited here.

## T48 findings and repair

**API-RELEASE-01 — Blocking: immutable HTTP mutated release artifacts.**
`openApiDocumentResponse` applied `normalizeOpenApiDocument` while serializing
every active and historical document. It rewrote `x-gridex-release-version`
and the portal-sync response description. A genuine Playwright request against
the actual local Next server confirmed **48 of 50** paired immutable route
bodies differed from their frozen artifact bytes. All 50 routes returned 200.
Only the two earliest Website documents already happened to match the policy.
The active release `2026-09-30.2` manifest matched the mutated HTTP body rather
than the frozen files consumed by a reproducible client build:

| Contract | Frozen file SHA256 before/after repair | HTTP and manifest SHA256 before repair |
|---|---|---|
| Website | `ba55cb3f1dcd1ffa9bec17dd6cd272606e3a95ecb6288ab11be5462135370c19` | `920a4dca5bd2f0b73483685e491148e02d324a19eeb0dc1f74221213ecefc5cd` |
| Customer Portal | `ba3f7d901a9bc794f26ce2012e37e56e4dfa4831d8e8835e6be33491aeead976` | `45b54b6adf4c93f88abfb877f629b731cca680ee22724dcd355357df60fc064a` |

Root explicitly assigned the bounded runtime repair after this actual RED.
`serializeOpenApiDocument` now pretty-prints its original document with the
existing final newline. The normalization helper is retained for explicit
document generation; runtime serving no longer applies its metadata changes.
ETag, 304 matching, request IDs, CORS, content type, caching and public access
remain in the existing response implementation.

After repair, genuine HTTP verified **50/50 immutable routes exactly match
their original bytes**, including the two previously matching ones. Active
canonical and immutable responses and manifest hashes match the raw active
release artifacts. Conditional requests return empty 304 bodies. Every frozen
artifact hash is identical between the RED and GREEN executions. Exact path,
artifact hash and actual response hash for every route are retained in
`api-release-local-http-evidence.json`.

**API-RELEASE-02 — Guide path parity reproduced, then verified repaired.**
Actual server-rendered guide tables were compared with the actual served
OpenAPI operations. Of 24 Customer Portal and 18 Website operations, two
public path templates use framework bracket notation in the guide:

| Actual guide | Actual OpenAPI |
|---|---|
| `/api/v1/customer/invoices/[id]` | `/api/v1/customer/invoices/{id}` |
| `/api/v1/website/customer-applications/[application_number]` | `/api/v1/website/customer-applications/{application_number}` |

The proof kept this mismatch visible and did not normalize bracket paths
away. Root corrected presentation in the registry and materialized a new paired
release `2026-09-30.3`. The final actual HTTP run verifies exact parity between
the server-rendered guide and served OpenAPI: all 24 Customer Portal and 18
Website operations match, including both corrected path templates. All 16 full resource shapes extracted
from the runnable reference client are present in the actual served Portal
OpenAPI, including invoice detail, case messages and case attachments. The
guide's invoice template failed the corresponding client-resource check before
the root correction; all 16 now pass against both the served guide and OpenAPI.
The synthetic server implementation is excluded from that client inventory.

The existing `runConfiguredCustomerRead` client additionally made a real local
Next request with a deliberately malformed synthetic credential. The actual
pre-database runtime returned **401 malformed_authorization**, a request ID and
the active release envelope; the signed action was exact `GET
/api/v1/customer/me`. No fake server or handler/module mock was used. This
qualifies one negative runtime/client boundary, not an authenticated customer
journey, positive DTO parity, all runtime errors or downstream operation effects.

## Final paired release receipt

Genuine requests to the actual local Next server on the final candidate
`2026-09-30.3` passed **4/4 tests in 40.9s**. The manifest, both current documents
and both latest immutable documents agree on version and exact frozen bytes.
All **52/52** materialized versioned routes return their artifact bytes, with
zero hash mismatches. The 50 pre-existing artifact hashes remain identical to
the initial RED receipt; no historical JSON was rewritten. Both new files set
`info.version`, `x-contract-schema-version` and `x-gridex-release-version` to
`2026-09-30.3`; exact HTTP/file equality preserves those generated values.

| New paired artifact | Exact file, canonical HTTP, immutable HTTP and manifest SHA256 |
|---|---|
| Website | `75ec5b3b8af477fdfa2e4825e9d1c3faf716609d5b811c17865a39dc46d34812` |
| Customer Portal | `80a0d27f8d999acd8ccc581a0737677b7ad4b3d4ba2b3e3f9b5903cd00fec547` |

The safe JSON receipt retains initial RED, intermediate serializer GREEN,
final release HTTP evidence, every route's artifact/response hash, all guide
operations and reference-client resource shapes. It also records eight source
SHA256 values captured before this final run and verified unchanged afterward,
including serializer, version policy, manifest, route registry, guide, proof
and both new release artifacts. This qualifies the recorded local source
candidate; a report-checkpoint Git HEAD is not an exact-head hosted receipt.

## Owned changes and executed checks

Owned runtime: `lib/integrations/openApiResponse.ts` (serializer and comments).
Owned regression: `__tests__/openapi-immutable-serialization-20260930.test.ts`
and clarification of labels in `__tests__/openapi-release-metadata.test.ts`.
Owned actual HTTP proof: `e2e/browser/api-release-local.spec.mjs`.
The proof follows the active artifact's version and discovers every paired
historical release directory/route, so root's next paired release is also
required on the next run. It rejects external browser targets and makes no
external requests to the production URLs declared in the manifest.

All executed commands used Node22.23.3. Actual local Next was 16.3.8.

| Executed verification | Result |
|---|---|
| New actual response-boundary unit regression before repair | RED: 3 failed, 1 passed; 48 artifact mismatches reproduced |
| New regression after repair | GREEN: 4/4 |
| New regression plus existing release metadata and canonical release suites | 20/20 in 3 files |
| Full four-case actual HTTP proof before repair | 3 failed, 1 passed, 44.0s |
| Full four-case actual HTTP proof after serializer repair | 3 passed, 1 failed, 47.4s; remaining guide mismatch only |
| Full four-case actual HTTP proof after root guide correction and new paired `2026-09-30.3` | 4/4, 40.9s; 52 exact immutable routes, exact active/manifest bytes, actual guide/client parity |
| Node22 test TypeScript | PASS |
| Scoped ESLint on serializer and the three proof/test files | PASS, 0 errors |
| Final whitespace diff check | PASS |

The existing Playwright configuration's default local Turbopack startup was
blocked in this scratch checkout because shared `node_modules` is a symlink
outside its filesystem root. A temporary config outside the repository retained
the existing local Playwright settings and used the documented `next dev
--webpack` option. Server and requests ran in the same execution sandbox.
Synthetic public/service environment values were sufficient because these
public-document and malformed-credential requests do not touch a database.
Next's automatically generated AGENTS managed-block change was restored;
there is no AGENTS delta. No repository configuration was changed for this
local workaround. These are actual HTTP results, never interactive UI evidence
or a Docker/Supabase native proof.

## Remaining original requirement boundary

T48 and P6 are not accepted wholesale. The guide correction, new paired active
release and historical-byte preservation have now been verified by the local
four-case HTTP proof. Root wired this proof into the existing OPS browser stack;
an authentic exact-head hosted run remains outstanding. The old
`2026-09-30.2` frozen metadata remains
historical evidence; the runtime serializer must not repair it while serving.
This local success is not a claim that historical business behavior is still
supported. The unchanged version response header describes current runtime
compatibility and is distinct from the version in a historical document body.
Authenticated whole-journey runtime/OpenAPI/example parity, all public error
branches, generated types, webhook contracts, controlled client transition and
production/provider evidence remain the integrated acceptance matrix's work.
