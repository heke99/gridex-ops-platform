# T34 support staff attribution: paired public API release 2026-10-01.1

This is a bounded continuation of original T34, with T48 contract/documentation evidence. It does not accept all T34, T48, T53 or any other original requirement. The root remains the sole publisher; no index, commit, ref, workflow, SQL, Auth or provider changes were made by this package.

The current closed `CustomerSupportMessage` response now has seven required fields, including `author_reference`. Its value is either null or a string matching exactly `^support_staff_[A-Za-z0-9_-]{32}$`. The existing stored staff actor, scoped to the message company, supplies the reference. Customer messages and staff history without an attributable saved actor remain null. The page displays only this canonical opaque reference alongside its existing staff/channel label. It never displays a raw UUID, reader identity, invented person or inferred historical author.

The authoritative DTO and projection are the separately owned, frozen T34 package (`customerRead.ts`, `supportStaffAttribution.ts` and forward `20261001030724_support_message_stored_staff_attribution.sql`). This package does not edit those bytes or assert that the new SQL has executed. Root registers and captures that forward independently.

## Actual RED and targeted changes

Before the release correction, the actual exported message GET, real DTO projector and real JSON envelope failed the closed active OpenAPI response for four staff/customer history controls because `author_reference` was undocumented. The schema shape control and actual async portal Page author rendering also failed: six functional RED cases. The initial fixture's incomplete attachment RPC adapter was corrected before attributing those six failures to production behavior.

After the schema/page correction, the actual exported reference flow accepted a raw staff UUID in a support response instead of rejecting it: one additional functional RED. The reference client now requires the field, enforces the staff-reference shape or null, requires null for customer messages and checks initial read plus continuation readback. All existing resource paths and request signing/transport mechanisms are preserved. A positive/null customer validator control brings the final dedicated suite to eight cases.

Both active documents and their new immutable routes advance together to `2026-10-01.1`. The generator's compatibility baseline is the prior immutable `2026-09-30.3`; every prior property and required field remains. Closed-response clients for that release must update for the new required nullable field. Request shapes, scopes, message revisions and reference algorithms are unchanged. The developer guide and all three integration documents explain this transition. The older generator test now checks exactly all seven properties and seven required fields plus nullable type and strict pattern; its other assertions remain.

## Verification actually executed

| Boundary | Executed result | Qualification |
| --- | --- | --- |
| Dedicated exported GET/DTO/JSON/Page/reference suite | 8/8 PASS | Controlled outer DB and positive context, real exported runtime; no Auth, SQL, network or security exercise |
| Existing generator and five related contract regression files | 25/25 PASS in six files | Actual installed Vitest, existing assertions retained |
| Scoped TypeScript | PASS, Node 22, 1536 MiB | Package page, guide, routes, runtime proof and dependent application types |
| ESLint and syntax | PASS, zero errors in checked TS/MJS; all changed CJS/MJS pass Node syntax | CJS files are ignored by the existing ESLint configuration; this is not a CJS lint acceptance. Initial unused proof variable warning removed |
| API compatibility/documentation/local immutable release | PASS | Prior `.3` message fields preserved and strict-client update stated |
| Runtime/OpenAPI registry parity | PASS | 99 registry routes, 128 documented operations, 58 reachable schemas; static parity is not runtime acceptance of those operations |
| Shared component/public-contract fixture gates | PASS | Existing responsibility boundaries and actual current fixture preserved |
| Local actual Next HTTP | 3/3 PASS | Public APIRequestContext against real local Next on port 3004; no mounted UI browser/Auth/DB/provider |
| Complete finalize → professionalize → materialize replay | PASS, unchanged final bytes | Repeated full pipeline; immutable materializer guard retained |
| Prior immutable files and actual served history | All 52 JSON and 52 route source files unchanged; all 52 served document bodies exact | Captured pre-edit SHA/byte baseline compared independently of active document generation |

The dedicated Vitest command is `node node_modules/vitest/vitest.mjs run --config=scripts/support-staff-api-release-20261001.config.ts`. The related regression command uses the existing pinned empty `server-only` Vitest scratch config with `customer-api-transaction-release-generator`, `post-128-openapi-tip-residuals`, `pricing-settlement-semantics`, `tenant-website-go-live-hardening`, `website-application-settlement-contract` and `website-quote-validate-contract-parity` tests. Vitest's displayed HH:mm is runner-local Europe/Berlin (UTC+02), not UTC.

The actual public HTTP command is `node node_modules/@playwright/test/cli.js test --config=e2e/browser/support-staff-api-release-20261001.config.mjs`. All three cases passed in 33.4 seconds. The first startup attempt executed zero cases because Playwright resolved the relative Next binary from the configuration directory; setting an explicit repository cwd corrected only that fixture problem. No product RED or HTTP success is attributed to that failed startup. The final configuration starts its own local server, uses nonworking public-only DB placeholders, disables trace/media, and makes no privileged requests. Root confirmed no shared Next/build process was active before this run.

Actual HTTP receipts:

- `SUPPORT_STAFF_RELEASE_PUBLIC_HTTP_PASS active_pair=2 exact_bytes=true headers_etag_304=true schema_required_nullable=true`
- `SUPPORT_STAFF_RELEASE_HISTORICAL_HTTP_PASS prior_json=52 prior_route_sources=52 historical_served_bytes=52 unchanged=true`
- `SUPPORT_STAFF_RELEASE_GUIDE_HTTP_PASS version=2026-10-01.1 author_reference=true current_reference_resources=16`

The active and new immutable bodies are exact, with current version headers, correct no-store/immutable cache rules, ETag and bodyless 304 controls. The rendered guide contains the current version, nullable attribution explanation and runnable reference helper. Its sixteen existing reference resources remain in current OpenAPI. This does not assert mounted support UI or authenticated customer journeys.

## Exact artifact preservation and remaining work

The release candidate instant is fixed at the real UTC instant `2026-10-01T03:25:51.302Z`. Final pretty bytes have SHA-256 `941d31324ff806ea979939cb56fb227056159527fb9743ee2722a460400391c3` (website, 515252 bytes) and `b5fc09c7fa78657481b7f5d4f0e4c3ffc5437f866e697b854373a0cc9b88c31f` (customer portal, 513570 bytes). Each canonical file equals its corresponding new immutable artifact. The pre-edit historical baseline is preserved in `scripts/support-staff-api-release-20261001.historical.json`; all 104 listed files remain exact. The final frozen package manifest is `/tmp/gridex-support-staff-api-release-frozen-20261001.json`.

The earlier T53 package remains a dated pagination receipt. Its pre-attribution Page bytes are preserved in `support-case-pagination-before-staff-20261001.page.tsx.txt`, SHA-256 `971ef9aba720055b8f5fdd24be01b7910f1b93c8cc5ff58219b153d3f733702f`. The additive author rendering is a separate current page revision; the frozen old T53 manifest is not rewritten or passed off as current page bytes.

Site peer read the current generator/schema, Page, reference validator, prepared existing customer-support browser assertions and all active attribution documentation, finding no concrete bounded blocker. That review executed no new tests and did not independently qualify historical bytes. Root requested a second independent frozen schema/history/runtime receipt review before publication.

The existing `customer-support-local.spec.mjs` now expects the seventh nullable field and checks staff shape/customer null. Its real Auth/native/HTTP journey is prepared for root CI and was not executed here. Hosted deployment byte verification, actual new projection SQL, positive authenticated staff history/current session ownership and native full-history execution remain pending genuine root evidence. Public HTTP, controlled DTO/Page tests and static gates do not close those requirements or the whole original 75.

Skill routing continues the previously read project spec-to-code, acquisition, systematic debugging/FP refutation, TDD, differential review, installed Next page/route documentation, React guidance and verification-before-completion instructions. Root owns shared memory, whole-project gates and publication; this report is the worker checkpoint. Broad security/credential/provider exercises are outside this precise release task.
