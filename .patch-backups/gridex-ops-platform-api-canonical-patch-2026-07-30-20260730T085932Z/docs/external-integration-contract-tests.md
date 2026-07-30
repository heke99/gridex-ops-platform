# External Integration Contract Tests

Contract-level documentation + smoke tests for every external surface.
No secrets in this file — env var *names* only.

## 1. Website application API

- Endpoint: `POST /api/v1/website/customer-applications`
- Auth: `Authorization: Bearer <website API key>` (scope `website_applications.write`)
- Headers: `Content-Type: application/json`, `Idempotency-Key: <stable key>`
- Request: customer + site + exact published `offer_reference`, five consents,
  optional structured `powerOfAttorney`. Legacy price/product identifiers are
  not alternative selectors and conflicting values return `offer_reference_mismatch`.
- Response 200: created chain ids, server-signed contract state, withdrawal
  deadline, immutable offer/legal/signature linkage and truthful communication
  status; duplicate key replays the stored response with `idempotent: true`
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
- Returns published offers only; `offer_reference` is HMAC-signed and is the
  only canonical selector (`WEBSITE_OFFER_REFERENCE_SECRET` — required in production)
- `?diagnostics=1` returns tenant-scoped publication blockers for server-side support
- `GET /api/public/energy-area?postal_code=` — removed before API 2026-07-29.1 and remains unavailable; returns `410 Gone`
  rate limit 60/min/IP

## 4. Resend (email provider)

- Env: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`
- Outbound: `Idempotency-Key` forwarded per send; retry-safe. Tenant outbox
  persists exact PDF attachments and respects event delay/recipient rules.
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

## 11. Canonical fastpris, quote och kundkedja (`2026-07-29.1`)

- `GET /api/v1/website/public-contracts`: ett offer per produkt; SE1–SE4 ligger i `area_pricing`.
- `POST /api/v1/website/energy-area/resolve`: kräver `website_energy_area.resolve` och tenantautentisering.
- `POST /api/v1/website/quote`: kräver `website_quotes.write`; fryser vald områdesprisrad.
- `POST /api/v1/website/quote/validate`: kräver `website_quotes.validate`; kontrollerar hela bindningen och konsumtionsstatus.
- `POST /api/v1/website/customer-applications`: kräver `Idempotency-Key`; accepterar `external_customer_id` eller `external_customer_reference`; använder samma canonical kund/kundnummer genom portal, automation och fakturering.
- `GET /api/public/energy-area`: fortsatt borttagen och returnerar `410 Gone`.
- Kontraktstester ska verifiera att olika SE-priser inte ger fyra offers, att vald rad finns i quote och immutable billing snapshot samt att retry inte duplicerar mail, kund, avtal, uppgiftsbegäran eller leverantörsbyte.
- Resolverkontrakt ska verifiera tenantisolering, expiry, gammal geodata, adress/nätområdesmismatch och att klientens `price_area` aldrig skriver över resolutionen.
- Spotkontrakt ska verifiera 96-, 92- och 100-intervallsdygn, lucka, överlapp, dublett, timeout, 429, 5xx och providerdata som ännu inte publicerats.
- Settlementkontrakt ska verifiera att endast `locked` månad får faktureras, att låst historik inte blir stale och att `market_reference.is_indicative=true` aldrig accepteras som settlement.
- Cronkontrakt ska verifiera separat previewimport och settlementverifiering samt att settlementcron aldrig låser automatiskt.
