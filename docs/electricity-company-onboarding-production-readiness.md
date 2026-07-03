# Electricity Company Onboarding — Production Readiness

Audience: platform superadmins onboarding a new electricity supplier (tenant) on the
Gridex Ops Platform. Verified against the codebase 2026-07-03
(production readiness audit, branch `cursor/production-readiness-hardening-0542`).

The onboarding flow is implemented across:

- `app/admin/companies` — company/tenant creation and governance
- `app/admin/platform/legal-templates` — global + tenant legal templates
- `app/admin/company-settings` / `lib/email/companyEmailSettings.ts` — email sender
- `app/admin/platform/api-clients` — website + customer portal API clients
- `app/admin/ediel` + `lib/ediel/routeMaterializer.ts` — Ediel identity and routes
- `app/admin/platform/actor-testing` — AGT/actor testing
- `app/admin/platform/go-live` — readiness dashboard and the live gate

## Step 1 — Create company / tenant

Required fields (validated in `lib/tenant/governance.ts` + companies admin):

- company name, organization number
- tenant slug (unique)
- customer number prefix (unique — enforced; drives `reserveCustomerNumber`)
- support email, billing/primary contact email
- onboarding status (`companies.status`: `onboarding` → `active`)

Guards: `requireCompanyOperationalForWrites` blocks new operational writes for
`paused` / `suspended` / `archived` / `pending_deletion` companies.

## Step 2 — Configure legal templates

Source of truth: `legal_text_versions` (tenant rows) seeded/overridden from platform
master templates (`app/admin/platform/legal-templates`, migration
`20260629193000_platform_legal_template_editor_and_rendering.sql`).

Required published versions per tenant before go-live:

- allmänna villkor (`terms`)
- integritetspolicy (`privacy`)
- ångerrätt (`withdrawal`)
- fullmakt (`power_of_attorney`)

Behavior guarantees (verified):

- The website application flow loads legal text **by version id server-side** —
  client-supplied legal text is never trusted (`lib/website/customerApplications.ts`).
- A POA consent without a published `power_of_attorney` version **fails closed**
  with `power_of_attorney_version_missing` (422), never silently.
- Acceptances snapshot the version id + content metadata into
  `customer_legal_acceptances`.
- Legal readiness per tenant is visible on `app/admin/platform/legal-readiness`.

## Step 3 — Configure email sender

Source of truth: `company_email_settings` (`lib/email/companyEmailSettings.ts`).

- sender name + sender email + reply-to + support email
- Resend domain verification status (`domain_status = 'verified'`)
- fallback policy (`fallback_allowed`), legal-mail gate
  (`block_legal_mail_when_unverified`)

Rules enforced in `getEffectiveSender`:

- verified tenant sender is used for customer email when available
- fallback to the platform sender only when `fallback_allowed` is true
- legal/critical emails are blocked when the domain is unverified and the gate is on
- `sender_mode = 'disabled'` / `is_active = false` blocks all tenant email (kill switch)
- Resend is the only production provider (`lib/email/providers/resendProvider.ts`,
  `EMAIL_PROVIDER=resend`); `RESEND_API_KEY` required at send time

## Step 4 — Configure API clients

Source of truth: `integration_api_clients` (`lib/integrations/apiAuth.ts`).

- website API key with `website_contracts.read`, `website_legal.read`,
  `website_applications.write` (+ `website_events.write` if used)
- customer portal API client with `customer_portal.read` / `customer_portal.write`
- per-client rate limit, optional IP/origin allowlists, expiry
- webhook secret for outbound webhooks (`webhook_subscriptions`)

Guarantees: tenant (`company_id`) is derived from the API key server-side —
never from the request body. Customer resolution is scoped to the client's
company (`lib/customer-portal/customerResolver.ts`). Requests are logged to
`integration_api_requests`; rate limiting returns 429.

Docs to hand to the integrating website team:
`docs/gridex-customer-portal-api.md`, `docs/external-website-api-integration-guide.md`.

## Step 5 — Configure Ediel production identity

Source of truth:

- `ediel_actor_settings` (per environment: `test` / `production`) — sender Ediel ID,
  sender name, subaddresses, application reference, `production_send_lock_enabled`
- `ediel_route_profiles` + `communication_routes` — materialized per message family
  via `lib/ediel/routeMaterializer.ts` (production routes get
  `target_system = 'production_ediel'`, `default_test_flag = 0`)
- Route readiness: `lib/ediel/routeProfileProductionReadiness.ts` (certificates,
  SMTP, encryption, `is_production_ready`)

Rules (all fail closed — verified):

- `resolveSenderSettings` accepts only explicit `test`/`production`; it never
  defaults to test for production flows
- production send is blocked until: company readiness passes
  (`getCompanyProductionReadiness`), route profile readiness passes, the
  production send approval / send lock allows it
  (`lib/ediel/productionSendApproval.ts`, `ediel_send_locks`), and the route
  contract validates (`lib/ediel/outbox/routeContract.ts`)
- Edielportal TGT routes are rejected in production
  (`lib/ediel/core/routeRegistry.ts`)

## Step 6 — Configure AGT / actor test

Source of truth: `actor_test_results`, AGT runtime (`lib/ediel/agtRuntime.ts`,
`lib/ediel/actorTesting.ts`), environment gate (`lib/ediel/testing/environmentGate.ts`).

- AGT runs against **test** actor settings and **test** route profiles only
- AGT pass is a prerequisite input for go-live review, but **does not** enable live
- AGT inbound is short-circuited in the inbound pipeline
  (`lib/ediel/flows/inboundProcessing.ts` routes test/AGT messages to the actor
  testing engine, not to production customer operations)

## Step 7 — Production readiness dry-run

`app/admin/platform/go-live/[companyId]` renders
`getCompanyProductionReadiness` + `getCompanyGoLiveSetupSummary` and exposes
`runProductionDryRun` (`lib/ediel/productionReadiness.ts`). Checks cover: company
profile, legal templates, email sender, API clients, Ediel identity, production
routes/certificates, AGT status, mailbox verification, no unresolved blockers.

## Step 8 — Make tenant live

One canonical action: `activateLiveEdielAction`
(`app/admin/platform/actor-testing/actions.ts`), surfaced on the go-live page.
Verified properties:

- requires platform admin (`requirePlatformAdminActionAccess`)
- refuses when readiness has blocking issues (sets `production_status='blocked'`
  and records the blocker reason)
- refuses when the latest production dry-run is not `allowed`/`warning`
- on success sets `operating_environment='production'`, `production_status='live'`,
  `live_ediel_enabled=true`, `ediel_production_enabled=true`, stores
  `live_approved_by` + `live_approved_at`, records a `company_go_live_reviews` row
  and go-live events (audit trail)
- enabling live does **not** send any message by itself — only future outbound
  passes the production send guards
- `pauseProductionSendingAction` / resume manage `ediel_send_locks`; pausing
  stops outbound sending while inbound reception continues

### Status field map (avoid confusion)

| Field | Meaning |
| --- | --- |
| `companies.status` | tenant governance lifecycle (onboarding/active/paused/…) |
| `companies.production_status` / `ediel_production_status` | go-live state (blocked/paused/live) |
| `companies.live_ediel_enabled` / `ediel_production_enabled` | live flags set/cleared together by the go-live actions |
| `ediel_actor_settings.production_send_lock_enabled` | first-send approval lock per actor settings row |
| `ediel_send_locks` | operational send pause per company/environment |

These are layered guards, not duplicates: **all** must allow before a production
message leaves the platform. Do not bypass any single layer.
