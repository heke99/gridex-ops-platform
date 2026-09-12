# Point 84 bounded external-write audit

Date: 2026-09-12. Source reviewed at `4ae4f1dcfc7632caa92c206286a0437e2b2a970a`. This is a read-only source audit. It does not assert production configuration, deployment limits, database acceptance, or concurrency behavior.

## Inventory completion

An independent `app/api/**/route.ts` export scan matched `quality/audits/PLAN_77_85_SURFACE_INVENTORY_2026-09-12.json` exactly: **57 route files / 58 declared POST or DELETE handlers**, with no missing or extra file and no POST/DELETE/PUT/PATCH reexport. The complete dispatch chain of the partner catch-all and the persistence/authentication callees of the external public and webhook handlers were then inspected. The 21 scheduled/worker route files also expose 20 authenticated mutating GET aliases; they share the corresponding POST execution path and are counted once below. Read-only GET branches were excluded.

Evidence notation: **S** source chain inspected; **D** current OpenAPI compared; **U** native database/deployment behavior unverified.

| Reachable handler group | Files / declared writes | Schema and size | Auth, company, idempotency/replay, rate | Result |
|---|---:|---|---|---|
| Cron and secret workers: all 11 `/api/cron/**`; both `/api/ediel/outbox/**`; internal customer-operations, email outbox, inbound-mail, manual-email, manual-inbound, system health, tenant provisioning, webhook dispatch | 21 / 21; 20 also have mutating GET | Mostly query/no body. Four JSON-taking workers use loose `request.json()` without a cap; three parse before the shared `run()` performs secret auth. | Timing-safe configured-secret checks; platform/queue company selection and worker idempotency are downstream job concerns; no integration-client limiter. | S; body gaps below. Point 85 owns worker semantics. |
| Selected-company admin writes: billing generate/period lock; pricing preview/lock/reprice; spot import/lock | 7 / 7 | Auth precedes loose, unbounded JSON; manual required/type checks. | Canonical admin permission check, then operational company; downstream receives company. No HTTP idempotency or rate limiter. | S; authenticated size/schema hardening open. |
| Admin invoice explicit-company writes: export create/retry/send; invoice dispute/purchase | 5 / 5 | Auth precedes loose, unbounded JSON. | Permission is resolved for selected company, but requested company is checked only for membership/writability. Provider/domain operations use requested company. | **Finding COMPANY-002.** |
| Admin inbound Ediel automation | 1 / 1 | Auth precedes loose, unbounded JSON; only `message_id` required. | `ediel.write` is selected-company scoped, while service-role lookup by global message ID derives and writes the message's company. | **Finding COMPANY-001.** |
| Blocked credit route | 1 / 1 | No body; always 409 after admin auth. | No mutation. | S, false-positive excluded. |
| Platform Z01 repair | 1 / 1 | Platform auth precedes unbounded JSON; required company/action checks. | Deliberate platform authority; explicit company passed downstream. | S. |
| Platform energy import/resolve | 4 / 4 | Platform auth precedes unbounded JSON; manual checks. | Deliberate platform authority. No HTTP idempotency/rate limiter. | S; authenticated size/schema hardening open. |
| Partner `/price` | 1 logical POST in catch-all | Loose unbounded `request.json()`; rejects unknown root/internal selectors, but coerces documented number strings. | Integration auth/rate and credential company are used. `calculateOfferQuote` persists a new quote without an idempotency claim. | **Findings BODY-002 and IDEM-001.** |
| Partner customer/site/contract/POA creates, singular and plural compatibility paths | 8 logical POST aliases in catch-all | Bounded object reader (256,000 bytes; POA 7 MiB); root/nested allowed-key checks on singular facade, tenant-selector rejection; plural core has corresponding manual validation. | Integration scope/rate; credential company; stable public relationship resolution; required idempotency wrapper. | S. |
| Partner webhook subscription create, singular and plural | 2 logical POST aliases in catch-all | Top-level clone parses unbounded before bounded simple/core reader. Target is checked both in preflight and downstream. | Credential scope/company; required downstream idempotency. Preflight and downstream each authenticate and consume the same route rate bucket. | **Findings BODY-002 and RATE-001.** |
| Partner webhook subscription DELETE aliases | 2 logical DELETE aliases in catch-all | No request body. | Integration scope/rate; credential company and subscription reference sent to company/client-bound RPC. | S; repeated DELETE returns not-found rather than a stored replay, but no duplicate effect was demonstrated. |
| Customer profile update, customer sync, legacy customer-portal sync | 3 / 3 | Bounded object reader; strict Zod contracts including nested objects. | Integration/customer identity auth, credential company/client/customer binding, required company/client/customer/operation/payload idempotency; integration auth RPC rate. | S. |
| Customer move-out | 1 / 1 | Bounded object reader and root allowlist; documented field mismatch. | Customer context and facility/date checks; required idempotency; RPC command overwrites company/customer/client from verified context; integration rate. | **Finding SCHEMA-002.** |
| Customer notification read | 1 / 1 | Bounded object reader but no root unknown-field check. | Customer/company-bound lookup/update; max 100 opaque refs; required canonical-payload idempotency; integration rate. | **Finding SCHEMA-001.** |
| Customer portal-bundle POST | 1 / 1 | Bounded object reader; identifier extraction; read-only operation. | Verified portal identity/company and integration rate; no mutation/idempotency requirement. | S, write false-positive excluded. |
| Public customer events (`/events`, `/website/customer-events`) | 2 / 2 | Bounded object reader; strict nested Zod schema. | Integration scope/rate, credential company and resolved customer; required idempotency before event write. | S. |
| Website customer application | 1 / 1 | Bounded 262,144-byte reader; explicit nested-field validation and strict application schema. | Integration scope/rate and tenant binding; required idempotency in processor; canonical quote/customer persistence chain inspected. | S; database concurrency U. |
| Website quote create | 1 / 1 | Bounded 262,144-byte reader, root allowlist; numeric coercion diverges from OpenAPI. | Integration scope/rate and company; required company/client/route/payload idempotency with replay. | **Finding SCHEMA-003.** |
| Website quote validate, energy-area resolve, current market price | 3 / 3 | Bounded 262,144-byte reader and root allowlists; quote validation also coerces numeric strings. | Integration scope/rate and company; computation/read assertions, so no idempotency requirement. | SCHEMA-003 applies to validate; remaining chains S. |
| Billing provider webhook | 1 / 1 | Raw body is fully buffered before a 512,000-byte check in the callee; provider-owned JSON is manually normalized. | HMAC and ±300-second timestamp; body tenant claims ignored; exactly-one provider invoice/connection determines company; event IDs have DB conflict identities. No route limiter. | **Finding BODY-002.** Replay identity S; atomic event outcome remains separately open in billing audit. |
| Manual inbound webhook | 1 / 1 | Content-Length precheck, then full buffering before actual 2,000,000-byte check; provider-alias parser ignores extra fields. | HMAC and ±300-second timestamp; body company ignored; exactly-one verified mailbox company. Mailbox+provider-message ID dedupe and operation-event key; unmatched messages intentionally re-evaluate. No route limiter. | **Finding BODY-002.** |
| Resend webhook | 1 / 1 | Signature headers/secret checked first, then raw body buffered with no application cap. | Resend/Svix signature verification; company comes from persisted provider-message relations; provider event ID stored uniquely. No route limiter. | **Finding BODY-002.** Post-processing replay concurrency U. |

## Material findings

### P84-COMPANY-001 — High — Ediel admin route can write another company's message by global ID

**Path:** `POST /api/internal/ediel/inbound-request-automation` → `requireAdminApiAccess(['ediel.write'])` → body `message_id` → `evaluateInboundEdielRequest` → `loadMessage(messageId)` using `supabaseService` with only `.eq('id', messageId)` → company taken from the loaded message → upsert `ediel_inbound_request_decisions` and, for pending review, `ediel_manual_review_items`.

An ordinary admin's permission is resolved by `canonical_authenticated_tenant_context` for the selected company, but the route never compares `access.guard.companyId` with the loaded message's `company_id`. A caller who knows a message ID for company B can use `ediel.write` from selected company A to evaluate and persist state for B; `forceManualReview` can force the review branch. This is source-confirmed service-role authorization bypass behavior, not a native database/RLS claim.

**False-positive checks:** platform admins are intentionally cross-company, but `requireAdminApiAccess` also admits ordinary admins with the selected-company permission. The downstream helper contains company-scoped child queries, yet its initial message lookup and decision writes deliberately adopt the message's company rather than verifying the actor's company. No route-local ownership guard exists.

**Required remediation/proof:** bind the message lookup to the authenticated selected company for ordinary admins (preserve explicit platform authority), then test A allowed / B denied, unknown ID, missing selected company, paused company, and platform cross-company behavior with actual route/helper bodies.

### P84-COMPANY-002 — High — five invoice admin writes validate membership, not permission scope, for an explicit company

**Paths:**

- `/api/internal/invoice-exports/create`
- `/api/internal/invoice-exports/[id]/retry`
- `/api/internal/invoice-exports/[id]/send`
- `/api/internal/invoices/[id]/dispute`
- `/api/internal/invoices/[id]/purchase`

Each route first calls `requireAdminApiAccess(...)`, which resolves permissions for the cookie-selected company A. A supplied `companyId`/`company_id` then goes through `assertUserCanOperateCompany(userId, B)`. For an ordinary actor that helper checks only active membership and company writability in B; it does not resolve or compare B's permission context. The route then uses service-role calls/provider clients scoped to B. This is the API analogue of the previously confirmed explicit-company permission bug; the published `guards.ts` action fix does not change `apiGuards.ts` or `tenant/scope.ts`.

**False-positive checks:** item/export reads and writes correctly filter by the chosen company, preventing accidental cross-company row IDs, but the chosen company itself is not bound to the permission-bearing context. Platform-admin bypass can remain explicit; the defect is the ordinary A-permission/B-membership case.

**Required remediation/proof:** use a company-scoped API guard that resolves canonical permissions and writability for exactly B, or require `access.guard.companyId === B` for ordinary admins. Cover each route family with A allowed / B denied reverse cases, B membership without permission, inactive/paused B, missing selection, and platform authority.

### P84-BODY-002 — Medium — remaining upper layers fully buffer bodies before effective caps

| Path | Complete buffering chain | Authentication position |
|---|---|---|
| Partner webhook create singular/plural | catch-all `preflightWebhookTarget` → `request.clone().json()` → later bounded simple/core reader | integration auth before clone |
| Partner `/price` | business handler → `request.json()` | integration auth before read |
| Billing webhook | route `request.text()` → callee byte check at 512,000 | signature after read and target resolution |
| Manual inbound webhook | optional Content-Length check → `request.text()` → actual 2,000,000-byte check | signature after read |
| Resend webhook | `request.text()` and no app cap | required signature headers/secret before read; signature after read |
| Ediel generic outbox, tenant email outbox, manual email outbox POST | exported POST awaits loose JSON helper before calling the secret-checking shared `run()` | body read before auth |

The bounded shared reader published at `604b2e17` closes the original versioned-API helper defect; it cannot protect an earlier clone/text/JSON read. No deployment-level maximum or live denial-of-service effect is inferred.

**Required remediation/proof:** move secret checks before body reads; use the shared bounded raw/JSON reader with endpoint-specific caps; for signed webhooks preserve exact raw bytes and verify the signature over those bytes. A single valid partner webhook body must be read once and then passed to preflight/downstream validation without cloning an unbounded stream.

### P84-IDEM-001 — Medium — partner `/price` persists quotes without request idempotency

**Path:** `POST /api/partner/v1/price` → integration auth → `createPrice` → `calculateOfferQuote` → `persistWebsiteQuote` → insert into `website_contract_quotes`. The route neither requires nor claims `Idempotency-Key`; its generated `quote_reference` therefore changes on ordinary retries. The public `/api/v1/website/quote` path to the same quote engine correctly claims company/client/route/payload idempotency before calculation.

**False-positive checks:** the partner OpenAPI currently omits an idempotency header, confirming contract drift rather than a hidden downstream guarantee. The operation returns a durable quote reference and is not a pure calculation despite its `200` description.

**Required remediation/proof:** adopt the public quote claim/complete/fail/replay semantics (or an equivalent company/client/operation/payload identity), document the header and replay response, and test same-key same-body replay, changed-body conflict, in-progress/failure recovery, and tenant/client isolation.

### P84-RATE-001 — Medium — partner webhook creation consumes the same rate bucket twice

**Path:** catch-all preflight calls `requireIntegrationApiAccess(request, ['partner_webhooks.manage'])`; after successful target preflight, the singular simple or plural core create handler calls `requireIntegrationApiAccess` again. `requireIntegrationApiAccess` has no request cache. Each call invokes `authenticate_integration_request_v1`; its credential core calls `integration_api_rate_limit_check`, whose upsert increments the `(api_client_id, route, window)` counter by one. Because the catch-all path is absent from the public route registry, both calls also use the same fallback `expensive` route class.

The result is two quota units for one accepted create and a possible second-call 429 after preflight already consumed one unit. Invalid targets rejected by preflight consume one unit; valid targets enter the second auth.

**False-positive check:** `AsyncLocalStorage` only stores response rate metadata; it does not memoize auth. The singular and plural routes both pass the same original pathname to both calls.

**Required remediation/proof:** authenticate once in dispatch and pass the verified context to preflight and the selected handler, or add safe per-request auth reuse with scope equivalence. Test counter delta 1 for valid singular/plural creates, rejected target, missing scope, and boundary quota.

### P84-SCHEMA-001 — Medium — notification-read ignores unknown fields and removes them from the idempotency hash

`POST /api/v1/customer/notifications/read` reads an object, extracts only `notification_references`, and builds `{ notification_references }` for `executeIdempotentPortalWrite`; it never rejects other root fields. Current `CustomerNotificationReadRequest` declares `additionalProperties: false`. Thus `{notification_references:[...], unexpected:true}` is accepted, and changed ignored fields under the same key are treated as the same canonical request.

Auth/company/customer/reference resolution and the actual update are correctly bound. The defect is strict request-contract enforcement and request identity, not a demonstrated cross-tenant write.

### P84-SCHEMA-002 — Medium compatibility — move-out rejects a documented request field

Current `CustomerMoveOutRequest` documents `authenticated_user_reference`, but the route's explicit allowlist omits it and returns `unknown_field`. The current and immutable 2026-08-22.2 contract surface were checked. The route otherwise rejects unknown root fields and overwrites company/customer/client in the RPC command from verified context.

Resolve by removing the field from a new contract release or validating its relationship to verified identity and adding it to runtime; do not silently accept an unbound identity claim.

### P84-SCHEMA-003 — Medium — quote endpoints coerce values outside their strict OpenAPI types

The website quote create and validate routes convert non-number `annual_consumption_kwh` and `site_count` through `Number(String(value).replace(',', '.'))`. Current OpenAPI requires number/integer. Create additionally passes fractional `site_count` to `calculateOfferQuote`, which truncates it before checking the integer, so `1.9` becomes `1`; numeric strings such as `"3500"` are also accepted. Partner `/price` uses the same numeric-string coercion although `PriceRequest.annual_consumption_kwh` is `type: number`.

Unknown root fields are rejected, and downstream commercial validation handles ranges and duplicate components. The surviving defect is type/coercion behavior and fractional truncation. Validate exact JSON types at the boundary or document an intentional coercing contract; test numeric strings, booleans, nonfinite representations, fractional/unsafe `site_count`, and valid integers.

## Refuted or bounded candidates

- `lib/partner-api/canonical.ts::rewriteJsonRequest` is unbounded, but every current POST branch that invokes it (site and POA compatibility paths) is intercepted first by `handleBusinessPartnerApi`/`handleSimplePartnerApi`. Contract/customer/webhook aliases are also handled earlier. It is a dormant sharp edge, not a currently reachable second prebuffer finding; dispatch-order tests should prevent accidental exposure.
- Partner singular/plural resource creates reject tenant selectors recursively, derive company/client from the credential, resolve referenced customer/site within that company, and use the idempotent write wrapper. No cross-tenant write was found in those chains.
- Billing webhook tenant claims are ignored; exactly one persisted provider invoice plus active provider/environment connection selects the company. Manual inbound requires exactly one verified mailbox-company result. Resend resolves company from prior outbound records. These checks refute body-supplied-company findings; database uniqueness/concurrency remains U.
- Customer portal bundle, website quote validation, market-price current, and energy-area resolve are POST-shaped reads/computations and do not require write replay semantics. Quote creation is durable and is treated separately above.

## Verification boundary

No application, migration, workflow, memory, or production state was changed. No dependency installation or duplicate shared-reader test was attempted. Evidence is current source/OpenAPI/static SQL inspection plus the exact independent route-export comparison. Native two-tenant authorization, idempotency concurrency, webhook signature/body streaming, and rate-counter tests remain required before point 84 production acceptance; the finite 57/58 source inventory itself is complete.
