# API configuration, OpenAPI and runtime boundaries — v2 supplement

## Scope and non-duplication rule

This report adds the API-configuration detail required by the v2 review prompt. It deliberately does not copy route maps, security findings, database findings, or test matrices already present in:

- `quality/CODEBASE.md`
- `quality/ARCHITECTURE.md`
- `quality/BUGS.md`
- `quality/SECURITY.md`
- `quality/TEST_BASELINE.md`
- `quality/TEST_RESULTS.md`

Those files remain authoritative for the earlier repository-wide review. This file focuses on configuration ownership, environment boundaries, OpenAPI/runtime verification status, and gaps that were not previously recorded in a dedicated report.

- Repository: `heke99/gridex-ops-platform`
- Branch: `audit/gridex-ops-full-integrity-review`
- Supplement start commit: `1028bdde8f944ee69154d761e7cdc00c0afd3756`
- Source basis: branch-local code, `docs/env-production-checklist.md`, `package.json`, OpenAPI manifests/snapshots, CI workflow, and existing audit reports
- Live deployment credentials used: none
- Production mutation performed: none

## Evidence status summary

| Area | Status | Evidence boundary |
|---|---|---|
| Branch-local API and environment source inspection | verified | exact files read from the audit branch |
| Public/server Supabase variable fail behavior | verified | `lib/env/supabasePublic.ts` and `lib/env/supabaseServer.ts` |
| Scheduled route secret fallback behavior | verified | `lib/automation/scheduledAuth.ts` |
| Existing production environment checklist | verified | `docs/env-production-checklist.md`, internally dated 2026-07-03 |
| Canonical `.env.example` | missing | exact branch path returned not found |
| Central machine-readable environment schema | unverified | no single canonical schema was established by this supplement |
| OpenAPI snapshot/manifests in repository | verified present | existing audit and branch tree |
| OpenAPI → live deployment parity | blocked | no safe deployment credentials/runtime probe in this environment |
| Current CI/build/test pass state | blocked | no executable checkout/npm runtime; no pass is inferred from workflow configuration |

## API surface ownership

The detailed route and module inventory remains in `quality/CODEBASE.md` and `quality/ARCHITECTURE.md`. Configuration ownership is summarized here without duplicating every endpoint.

| Surface | Intended audience | Authentication/config boundary | Tenant resolution | Contract source | Live proof |
|---|---|---|---|---|---|
| Website integration API | tenant websites and approved API clients | bearer API client, scopes, origin/IP/rate controls | resolved from authenticated API client; client-supplied tenant is not authoritative | website integration OpenAPI snapshot and generated types | blocked |
| Customer portal API | authenticated customer portal clients | portal auth/session and route-level authorization | membership/customer/resource relationship | customer portal OpenAPI snapshot and generated types | blocked |
| Internal OPS routes/actions | authenticated OPS users and service processes | Supabase session, roles/permissions or internal secret | server-resolved membership/company context | source and internal types | blocked for end-to-end proof |
| Cron and scheduled routes | Vercel scheduler or dedicated automation | `CRON_SECRET` and/or a dedicated route secret | job payload and server-side company/tenant resolution | source and job/state-machine code | blocked for deployed execution |
| Webhook ingress | configured external providers | provider signature or dedicated shared secret | provider target/resource mapping plus server validation | route source/provider contract | blocked for live provider delivery |
| EDIEL and mail transport | internal operations and external market actors | SMTP/IMAP/S-MIME/transport credentials and actor configuration | company/actor/mailbox/job context | source, database configuration and provider rules | blocked for live transport |
| Health/readiness endpoints | internal operations | internal/cron secret where applicable | platform and tenant-specific checks | source | blocked for deployed probe |

## Environment contract model

The repository contains `docs/env-production-checklist.md`, described in that file as a grep-derived inventory from 2026-07-03. It is useful evidence, but it is not automatically synchronized with source and therefore cannot be treated as a current machine-enforced source of truth.

To avoid repeating identical metadata for dozens of related variables, each variable below is assigned a configuration profile. Every listed variable inherits the fields in its profile unless an override is stated.

### Configuration profiles

| Profile | Environments | Secret/public | Client exposure | Required/default | Validation and failure mode | Rotation | Missing-value impact | Drift risk |
|---|---|---|---|---|---|---|---|---|
| `PUB-RUNTIME` | local, test, preview, staging, production | public | allowed | required at runtime; build placeholder exists for the two Supabase variables | trim/non-empty checks; throws outside production-build phase | rotate when project/key/domain changes or is compromised | client/server initialization fails | medium because no central schema |
| `PUB-URL` | local, test, preview, staging, production | public | allowed | requirement and fallback differ by consumer | consumer-specific URL parsing/normalization; not centrally proven | update during domain changes | callback/redirect/origin drift | high without canonical allowlist schema |
| `SERVER-REQUIRED` | local/test where feature runs; preview/staging/production | secret or server-only | forbidden | required for its feature | expected to fail closed or feature-block; exact behavior is consumer-specific | rotate on compromise and by provider policy | feature unavailable or unsafe operation blocked | medium/high |
| `SERVER-FALLBACK` | preview/staging/production | secret | forbidden | dedicated value optional when a documented global fallback exists | accepted secret set is built server-side; no configured secret means authorization false | rotate dedicated/global secrets | scheduled route cannot authenticate | medium |
| `SERVER-OPTIONAL` | environment-specific | secret or server-only | forbidden | optional capability/tuning | default or disabled behavior is consumer-specific | as applicable | optional feature disabled or default used | medium |
| `ENV-SELECTOR` | local, test, preview, staging, production | server-only | forbidden | production must be explicit according to checklist | enum/string validation is distributed | change only with controlled deployment | wrong provider/environment routing | high |
| `TUNING` | local, test, preview, staging, production | server-only | forbidden | optional with code defaults | numeric bounds are consumer-specific | not applicable | performance, locking or retry behavior changes | medium |
| `EMERGENCY` | production only when incident-approved | server-only | forbidden | must normally be unset/false | consumer-specific boolean gate | remove immediately after incident | weakens normal routing restriction | high |

## Variable inventory

### Public and base URL variables

| Variable | Consumer/purpose | Profile | Override/status |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser/server Supabase project URL | PUB-RUNTIME | required outside production-build phase; build placeholder is used during build only |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | RLS-bound public Supabase key | PUB-RUNTIME | required outside production-build phase; must never be treated as a privileged key |
| `NEXT_PUBLIC_SITE_URL` | public site and auth/callback URL candidate | PUB-URL | precedence and requiredness are consumer-specific |
| `NEXT_PUBLIC_APP_URL` | application URL candidate | PUB-URL | precedence and requiredness are consumer-specific |
| `NEXT_PUBLIC_BASE_URL` | base URL candidate | PUB-URL | precedence and requiredness are consumer-specific |

### Supabase privileged access

| Variable | Consumer/purpose | Profile | Override/status |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | server-side administrative Supabase client | SERVER-REQUIRED | required outside production-build phase; placeholder during production build is not runtime proof; client exposure is prohibited |

### Cron and internal route authentication

`authorizeScheduledRequest` verifies a bearer token or `x-cron-secret` with timing-safe comparison. A route can accept a dedicated secret and, unless explicitly disabled, `CRON_SECRET`. If neither is configured, authorization returns false.

| Variable | Consumer/purpose | Profile | Override/status |
|---|---|---|---|
| `CRON_SECRET` | shared Vercel/global scheduled route secret | SERVER-REQUIRED | global fallback for scheduled routes that allow it |
| `EDIEL_CRON_SECRET` | EDIEL scheduled work | SERVER-FALLBACK | dedicated route secret |
| `EDIEL_INBOUND_CRON_SECRET` | EDIEL inbound processing | SERVER-FALLBACK | dedicated route secret |
| `EMAIL_OUTBOX_CRON_SECRET` | email outbox processing | SERVER-FALLBACK | dedicated route secret |
| `MANUAL_EMAIL_OUTBOX_CRON_SECRET` | manual-email outbox processing | SERVER-FALLBACK | dedicated route secret |
| `MANUAL_INBOUND_CRON_SECRET` | manual inbound mail processing | SERVER-FALLBACK | dedicated route secret |
| `CUSTOMER_OPERATION_CRON_SECRET` | customer-operation jobs | SERVER-FALLBACK | dedicated route secret |
| `BILLING_AUTOMATION_CRON_SECRET` | billing automation | SERVER-FALLBACK | dedicated route secret |
| `PRICING_CRON_SECRET` | pricing jobs | SERVER-FALLBACK | dedicated route secret |
| `ANALYTICS_CRON_SECRET` | analytics aggregation | SERVER-FALLBACK | dedicated route secret |
| `EVENTS_CRON_SECRET` | event processing | SERVER-FALLBACK | dedicated route secret |
| `GRID_AREA_IMPORT_CRON_SECRET` | grid-area import | SERVER-FALLBACK | dedicated route secret |
| `OPS_HEALTH_CRON_SECRET` | health/readiness route | SERVER-FALLBACK | dedicated route secret |
| `EDIEL_ACTOR_READINESS_CRON_SECRET` | actor-readiness job | SERVER-FALLBACK | dedicated route secret |
| `GRIDEX_CRON_SECRET` | Gridex-specific scheduled operations | SERVER-FALLBACK | dedicated route secret |
| `EDIEL_PLATFORM_MAINTENANCE_SECRET` | EDIEL maintenance endpoints | SERVER-REQUIRED | separate maintenance boundary; no assumption of `CRON_SECRET` fallback |

### Email delivery and auth mail

| Variable | Consumer/purpose | Profile | Override/status |
|---|---|---|---|
| `RESEND_API_KEY` | Resend send API | SERVER-REQUIRED | sending is documented as fail-closed without it |
| `RESEND_WEBHOOK_SECRET` | Resend/Svix webhook verification | SERVER-REQUIRED | rotate with provider webhook secret |
| `EMAIL_PROVIDER` | provider selector | ENV-SELECTOR | checklist states `resend` default; runtime validation must be checked per consumer |
| `RESEND_FROM_EMAIL` | Resend sender | SERVER-OPTIONAL | participates in sender fallback chain |
| `DEFAULT_FROM_EMAIL` | default sender | SERVER-OPTIONAL | participates in sender fallback chain |
| `PLATFORM_FALLBACK_FROM_EMAIL` | platform fallback sender | SERVER-OPTIONAL | must not silently create wrong-tenant branding |
| `AUTH_EMAIL_FROM` | auth email sender | SERVER-OPTIONAL | sender/domain must match provider configuration |
| `AUTH_SMTP_FROM` | alternate auth SMTP sender | SERVER-OPTIONAL | sender/domain must match provider configuration |

### EDIEL SMTP, IMAP, S/MIME and actor configuration

| Variable | Consumer/purpose | Profile | Override/status |
|---|---|---|---|
| `EDIEL_SMTP_HOST` | outbound SMTP host | SERVER-REQUIRED | required when SMTP transport is active |
| `EDIEL_SMTP_USER` | outbound SMTP user | SERVER-REQUIRED | credential |
| `EDIEL_SMTP_PASS` | outbound SMTP password | SERVER-REQUIRED | credential; alias behavior must remain explicit |
| `EDIEL_SMTP_PASSWORD` | outbound SMTP password alias | SERVER-REQUIRED | credential; precedence is consumer-specific |
| `EDIEL_SMTP_FROM` | outbound EDIEL sender | SERVER-REQUIRED | identity/config value |
| `EDIEL_SMTP_REPLY_TO` | reply-to address | SERVER-OPTIONAL | sender routing value |
| `EDIEL_SHARED_MAILBOX_ADDRESS` | shared mailbox identity | SERVER-REQUIRED | must match operational mailbox |
| `EDIEL_MAIL_DOMAIN` | mail-domain construction | SERVER-REQUIRED | domain configuration |
| `EDIEL_MESSAGE_ID_DOMAIN` | Message-ID domain | SERVER-REQUIRED | domain configuration |
| `EDIEL_SMIME_P12_BASE64` | signing certificate bundle | SERVER-REQUIRED | high-value secret material |
| `EDIEL_SMIME_P12_PASSWORD` | signing bundle password | SERVER-REQUIRED | high-value secret |
| `EDIEL_SMIME_DECRYPT_P12_BASE64` | decryption certificate bundle | SERVER-REQUIRED | high-value secret material |
| `EDIEL_SMIME_DECRYPT_P12_PASSWORD` | decryption bundle password | SERVER-REQUIRED | high-value secret |
| `EDIEL_SMIME_PFX_BASE64` | alternate certificate bundle | SERVER-OPTIONAL | precedence/compatibility is consumer-specific |
| `EDIEL_SMIME_PRIVATE_KEY_PASSWORD` | private-key password | SERVER-REQUIRED | high-value secret |
| `EDIEL_SMIME_CERT_COMPANY_ID` | certificate/company binding | SERVER-REQUIRED | must match tenant/company setup |
| `EDIEL_SMIME_CERT_OWNER_EDIEL_ID` | certificate owner Ediel ID | SERVER-REQUIRED | must match market actor |
| `EDIEL_SMIME_CERT_OWNER_SUBADDRESS` | certificate owner subaddress | SERVER-OPTIONAL | market actor routing |
| `EDIEL_EXPISOFT_LDAP_HOST` | certificate lookup LDAP host | SERVER-REQUIRED | required when lookup path is active |
| `EDIEL_EXPISOFT_LDAP_PORT` | LDAP port | SERVER-OPTIONAL | numeric validation is consumer-specific |
| `EDIEL_EXPISOFT_LDAP_BASE_DN` | LDAP search base | SERVER-REQUIRED | directory scope |
| `EDIEL_EXPISOFT_LDAP_TIMEOUT_MS` | LDAP timeout | TUNING | explicit timeout control |
| `EDIEL_ACTOR_EDIEL_ID` | platform actor identity | SERVER-REQUIRED | must match configured actor |
| `EDIEL_AUTOMATION_ACTOR_USER_ID` | automation actor user | SERVER-REQUIRED | actor attribution requirement |
| `GRIDEX_AUTOMATION_USER_ID` | automation actor for customer/supplier-switch operations | SERVER-REQUIRED | checklist documents fail-fast `missing_automation_user`; must reference an existing authorized `auth.users` row |
| `GRIDEX_EDIEL_ENVIRONMENT` | EDIEL environment selector | ENV-SELECTOR | must be `production` in production |
| `GRIDEX_CUSTOMER_DATA_EDIEL_ENVIRONMENT` | customer-data EDIEL environment | ENV-SELECTOR | must be `production` in production |
| `GRIDEX_MANUAL_OPS_ENVIRONMENT` | manual operations environment | ENV-SELECTOR | must be `production` in production |

### Inbound mail credentials and tuning

| Variable | Consumer/purpose | Profile | Override/status |
|---|---|---|---|
| `MANUAL_OPS_IMAP_PASS` | manual operations mailbox password | SERVER-REQUIRED | credential referenced from DB configuration |
| `MANUAL_OPS_IMAP_PASSWORD` | mailbox password alias | SERVER-REQUIRED | precedence is consumer-specific |
| `EDIEL_INBOUND_MAILBOX_POLL_LIMIT` | mailbox poll batch size | TUNING | optional default |
| `EDIEL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX` | per-mailbox message limit | TUNING | optional default |
| `EDIEL_INBOUND_MAILBOX_CONCURRENCY` | mailbox concurrency | TUNING | optional default |
| `EDIEL_INBOUND_MESSAGE_CONCURRENCY` | message concurrency | TUNING | optional default |
| `EDIEL_INBOUND_STALE_MAILBOX_LOCK_MINUTES` | stale lock recovery | TUNING | lock-safety parameter |
| `EDIEL_INBOUND_MAX_JOB_ATTEMPTS` | retry ceiling | TUNING | retry/idempotency parameter |
| `MANUAL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX` | manual mailbox message limit | TUNING | optional default |
| `MANUAL_INBOUND_STALE_MAILBOX_LOCK_MINUTES` | manual mailbox stale lock recovery | TUNING | lock-safety parameter |

### Webhooks and website integration

| Variable | Consumer/purpose | Profile | Override/status |
|---|---|---|---|
| `GRIDEX_WEBHOOK_SIGNING_SECRET` | outbound Gridex webhook signatures | SERVER-REQUIRED | primary signing secret |
| `WEBHOOK_SIGNING_SECRET_FALLBACK` | webhook signing fallback | SERVER-OPTIONAL | rotation/compatibility path; must not become permanent undocumented authority |
| `MANUAL_INBOUND_WEBHOOK_SECRET` | manual inbound webhook authentication | SERVER-REQUIRED | shared secret |
| `BILLING_WEBHOOK_SECRET_FALLBACK` | billing webhook fallback | SERVER-OPTIONAL | per-company secrets are documented as database-resident |
| `WEBSITE_OFFER_REFERENCE_SECRET` | HMAC for website offer references | SERVER-REQUIRED | checklist states fail-closed in production; no service-role/NEXTAUTH fallback should be relied upon |

### External providers and storage

| Variable | Consumer/purpose | Profile | Override/status |
|---|---|---|---|
| `PAPILITE_API_KEY` | postal-code/geocode provider | SERVER-REQUIRED | provider credential |
| `PAPILITE_GEOCODE_URL` | geocode endpoint | SERVER-REQUIRED | must be allowlisted/validated; no silent production fallback should be assumed |
| `OPENDATALOADER_API_URL` | spot-price provider endpoint | SERVER-REQUIRED | endpoint/version pair must remain consistent |
| `OPENDATALOADER_VERSION` | spot-price provider version | ENV-SELECTOR | compatibility-sensitive |
| `GRID_OWNER_AGREEMENTS_BUCKET` | Supabase Storage bucket | SERVER-REQUIRED | bucket and policy must match deployment |

### Emergency override

| Variable | Consumer/purpose | Profile | Override/status |
|---|---|---|---|
| `MANUAL_EMAIL_ALLOW_EDIEL_SENDER` | emergency sender override | EMERGENCY | must be unset/false during normal production operation |

## Findings and configuration gaps

### API-CONFIG-001 — no canonical `.env.example`

- Status: `open`
- Severity: Low documentation/configuration risk
- Evidence: exact branch read returned not found.
- Impact: operators cannot compare local, preview, staging and production configuration against a checked-in canonical template; onboarding and secret classification rely on prose and distributed code.
- Safe remediation: add a secret-free `.env.example` generated or checked against a machine-readable schema. Never add real values.
- Verification: schema/template parity test plus secret scan.

### API-CONFIG-002 — environment inventory is prose and dated

- Status: `open`
- Severity: Low drift risk
- Evidence: `docs/env-production-checklist.md` identifies its inventory as a grep from 2026-07-03, while the audited branch contains later changes.
- Impact: new variables or changed fail behavior can drift without CI detecting it.
- Safe remediation: centralize environment metadata in code, derive documentation/example files, and add CI parity checks.
- Verification: enumerate every `process.env` consumer and compare it with the schema and generated documentation.

### API-CONFIG-003 — successful production build is not runtime configuration proof

- Status: `verified` behavior; operational risk remains `open`
- Severity: Low evidence risk
- Evidence: Supabase environment helpers substitute non-secret placeholders during Next.js production build and enforce real values outside that phase.
- Impact: a green build proves compilation but not that runtime Supabase URL, anon key or service-role key are correctly installed.
- Safe remediation: retain build-safe behavior if required, but add a post-deploy readiness check that runs in the deployed runtime and validates configuration without exposing secrets.
- Verification: authenticated preview/staging health probe and a failing deployment test with intentionally missing runtime variables.

### API-CONFIG-004 — live OpenAPI/runtime parity not executed

- Status: `blocked`
- Severity: verification blocker, not a verified defect
- Blocker: no safe deployment credential and no approved live tenant/API-client fixture in the connector environment.
- Required evidence: documented route against deployed route, auth/scopes, headers, status codes, response validation, ETag/cache behavior, request/correlation IDs, and tenant isolation.

## OpenAPI source-of-truth status

Repository snapshots, generated TypeScript types, release manifests and compatibility/runtime-parity scripts exist. Their presence is not equivalent to a successful current run.

| Check | Repository support | Current status |
|---|---|---|
| OpenAPI → route existence | compatibility/parity scripts exist | blocked from execution in this supplement |
| OpenAPI → request validation | schemas and route validators exist | source-reviewed; full runtime proof blocked |
| OpenAPI → response validation | snapshots/types and runtime checks exist | source-reviewed; live proof blocked |
| OpenAPI → generated TypeScript types | generation and consistency scripts exist | current successful generation run not independently executed |
| Documented status codes/error schemas | prior audit found and partially fixed one portal-sync classification issue | remaining full matrix not executed |
| Auth schemes/scopes | source-reviewed integration auth exists | deployed credential/scoping proof blocked |
| Backward compatibility | compatibility/release scripts exist | current command result blocked |
| Live runtime parity | supported by scripts and deployment surfaces | blocked |

## Resilience and network behavior status

Timeouts, cancellation, retries, idempotency, deduplication, rate limiting, payload limits and provider-specific webhook behavior are distributed across clients and routes. The existing `quality/SECURITY.md`, `quality/PERFORMANCE.md` and `quality/BUGS.md` remain authoritative for inspected concrete issues. This report does not duplicate those findings.

No repository-wide claim is made that every outbound client has an explicit timeout, every write is idempotent, or every webhook has replay protection. Those claims require the executable and live checks listed in `quality/TEST_RESULTS.md`.

## Credentials and possible external cost

The configuration review itself did not use production secrets. Full verification can require credentials and may incur provider cost for:

- Supabase project/runtime access
- Vercel preview/staging deployment and runtime logs
- GitHub Actions minutes and security products
- Resend/Mailgun email delivery and webhook traffic
- EDIEL SMTP/IMAP/S-MIME and market-actor/provider test environments
- Papilite and OpenDataLoader provider calls
- monitoring/error-reporting services when enabled

## Verdict

API configuration is **documented but not fully machine-enforced or live-verified**. The source demonstrates several fail-closed boundaries, including runtime Supabase requirements and scheduled-secret authorization, but the absence of a canonical environment schema/example and the blocked live OpenAPI/runtime checks prevent readiness from advancing beyond the existing `NOT_READY` verdict.