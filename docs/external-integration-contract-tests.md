# External Integration Contract Tests

Contract-level documentation + smoke tests for every external surface.
No secrets in this file — env var *names* only.

## 1. Website application API

- Endpoint: `POST /api/v1/website/customer-applications`
- Auth: `Authorization: Bearer <website API key>` (scope `website_applications.write`)
- Headers: `Content-Type: application/json`, `Idempotency-Key: <stable key>`
- Request: customer + site + contract (must reference a published offer via
  `offer_reference` / `price_plan_version_id` / `product_code`), consents,
  optional structured `powerOfAttorney`
- Response 200: created chain ids + `response_payload`; duplicate key replays
  the stored response with `idempotent: true`
- Errors: structured `{ error: { code, stage, field, request_id } }`; 422
  validation, 409 `idempotent_failed`, 429 rate-limited
- Idempotency: unique `(company_id, idempotency_key)`; retry-safe
- Tenant scoping: company derived from API key only
- Smoke test: submit + duplicate submit on staging (see staging checklist)
- Automated: `npm run gridex:website-application-ops-chain-regression`,
  `gridex:website-api-power-of-attorney-regression`

## 2. Customer portal API

- Endpoints: `POST/GET /api/v1/customer/portal-bundle`, `GET /me|contracts|
  sites|invoices|invoices/{id}|metering-values|documents|legal-acceptances|
  powers-of-attorney|events|notifications`, `POST /sync|profile-update|
  move-out|notifications/read`
- Auth: Bearer/`x-api-key` → `integration_api_clients`; scopes
  `customer_portal.read` / `.write`
- Identifiers: headers (`x-gridex-external-customer-id`,
  `x-gridex-customer-number`, `x-gridex-customer-email`,
  `x-gridex-auth-user-id`) or JSON body on POST
- Resolution order: portal user link → external_customer_id → customer_number
  → unique email (409 `ambiguous_customer_match` on email collision)
- Idempotency: `/sync` derives stable upsert keys; `Idempotency-Key` header not
  evaluated (documented)
- Rate limit: per-client `rate_limit_per_minute` → 429
- Docs: `docs/gridex-customer-portal-api.md`
- Automated: `npm run gridex:customer-portal-multi-site-api-regression`

## 3. Public contracts / pricing

- `GET /api/v1/website/public-contracts` (scope `website_contracts.read`),
  `GET /api/v1/website/legal-bundle`
- Returns published offers only; `offer_reference` is HMAC-signed
  (`WEBSITE_OFFER_REFERENCE_SECRET` — required in production)
- `GET /api/public/energy-area?postal_code=` — unauthenticated, in-memory
  rate limit 60/min/IP

## 4. Resend (email provider)

- Env: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`
- Outbound: `Idempotency-Key` forwarded per send; retry-safe
- Inbound webhook: Svix signature verified; updates communication logs and
  outbox delivery statuses
- Timeout/retry: provider errors surface as safe errors; outbox backoff ≤5
- Smoke: send go-live test email; fire a Resend test webhook event

## 5. SMTP/IMAP (Ediel transport + manual mailbox)

- Env: `EDIEL_SMTP_*`, mailbox rows with `env:` secret references
  (`MANUAL_OPS_IMAP_PASS`, …)
- Outbound Ediel: S/MIME per route profile; send blocked by guard chain when
  certificates/route/approval missing
- Inbound: pollers with locks/dedupe (see `docs/inbound-mail-polling-runbook.md`)
- Smoke: staging poll cron + test message roundtrip

## 6. Ediel / Expisoft / LDAP

- Env: `EDIEL_EXPISOFT_LDAP_HOST/PORT/BASE_DN/TIMEOUT_MS`
- Certificate lookup for counterparties; failures create controlled blockers
  (`certificate` readiness), never silent sends
- Smoke: route readiness page shows certificate status per production profile
- Automated: `npm run gridex:route-profile-certificate-auto-match-regression`,
  `gridex:production-route-readiness-regression`

## 7. Outbound webhooks (to tenant systems)

- `webhook_subscriptions` + `webhook_deliveries`; HMAC signature
  (`GRIDEX_WEBHOOK_SIGNING_SECRET` fallback, per-subscription secrets in DB)
- Retries: max 8 attempts, backoff; unique `idempotency_key` per delivery
- Consumer contract: verify signature; respond 2xx within timeout
- Automated: `npm run gridex:website-api-webhook-regression`

## 8. Inbound webhooks

- `/api/webhooks/manual-inbound` — shared secret header
  (`MANUAL_INBOUND_WEBHOOK_SECRET`); same ingestion contract as IMAP path
- Billing provider webhooks — per-company secrets; unknown statuses →
  `needs_review` + work-queue task

## 9. Spot prices / geodata

- `OPENDATALOADER_API_URL` (daily 03:15), `PAPILITE_GEOCODE_URL`
- Upsert semantics per (area, date); failures leave previous data intact
- Smoke: `/api/cron/pricing/spot-prices` with secret on staging

## 10. Cron endpoints (internal contract)

- All accept GET/POST with `Authorization: Bearer <CRON_SECRET>` or
  `x-cron-secret`; 401/503 without
- Contract: bounded batches, safe re-entry (locks), JSON result summary
- Smoke: call each with and without secret (staging checklist)
