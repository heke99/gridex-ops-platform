# Gridex Customer Portal API

Batch 6 kopplar Gridex Ops Platform till Gridex hemsida/Mina sidor.

## Source of truth

Gridex Ops Platform är source of truth för kund, avtal, anläggningar, mätvärden, fakturor och behörighet. Gridex hemsida ska bara vara frontend och ska anropa Ops Platform server-side.

## Superadmin setup

1. Gå till `/admin/platform/api-clients`.
2. Välj tenant/bolag.
3. Skapa API-klient med scopes:
   - `customer_portal.read`
   - `customer_portal.write`
4. Lägg allowed origins, t.ex.
   - `https://gridex.se`
   - `https://www.gridex.se`
5. Kopiera token direkt. Den visas bara en gång.
6. Lägg token som server secret på Gridex hemsidan, exempelvis `GRIDEX_OPS_API_TOKEN`.

## Header

```http
Authorization: Bearer <GRIDEX_OPS_API_TOKEN>
```

`x-api-key` stöds också för enklare server-to-server-test, men rekommenderad header är `Authorization: Bearer`.

## Länkning

```http
POST /api/v1/customer-portal/sync
```

E-post ensam får aldrig ge åtkomst. Stark match kräver minst ett av:

- email + kundnummer
- email + personnummer/orgnummer
- kundnummer + anläggnings-id
- personnummer/orgnummer + anläggnings-id

Möjliga utfall:

- `linked` — kunden får åtkomst
- `pending_review` — admin måste granska
- `lead_created` — ingen säker kundmatchning, ingen åtkomst
- `rejected` — för svag identitet, ingen åtkomst

## Customer endpoints

Alla customer endpoints kräver länkad `external_customer_id` och scope `customer_portal.read` eller `customer_portal.write`.

Skicka external id som query eller header:

```http
x-gridex-external-customer-id: <external_customer_id>
```

eller

```http
GET /api/v1/customer/contracts?external_customer_id=<external_customer_id>
```

Endpoints:

- `GET /api/v1/customer/contracts`
- `GET /api/v1/customer/invoices`
- `GET /api/v1/customer/invoices/[id]`
- `GET /api/v1/customer/sites`
- `GET /api/v1/customer/metering-values`
- `GET /api/v1/customer/documents`
- `POST /api/v1/customer/profile-update`
- `POST /api/v1/customer/move-out`
- `POST /api/v1/customer/support-case`

### Mätvärden

`GET /api/v1/customer/metering-values` läser alltid från `normalized_metering_values`, inte äldre tabeller som `metering_values`, `meter_values` eller `billing_underlay_items`.

Matchningskedjan är:

```text
API-token → integration_api_clients.company_id → external_customer_id → customer_portal_identities.customer_id → normalized_metering_values
```

Frågan måste alltid filtrera på både `company_id` och `customer_id`. Frontend eller hemsida får aldrig skicka `company_id` som tenant-val.

Stödda filter:

```http
GET /api/v1/customer/metering-values?external_customer_id=GRIDEX-WEB-TEST-001
GET /api/v1/customer/metering-values?external_customer_id=GRIDEX-WEB-TEST-001&from=2026-05-01&to=2026-06-01
GET /api/v1/customer/metering-values?external_customer_id=GRIDEX-WEB-TEST-001&facility_id=735999888000000112
```

Responsen returnerar normaliserade fält som `quantity_kwh`, `period_start`, `period_end`, `price_area`, `quality_status`, `source_type` och `status`.

## Public developer documentation

External websites and partner portals should use the public developer page:

```text
https://app.gridex.se/developers/customer-portal-api
```

The repo version of that guide is kept in:

```text
docs/external-website-api-integration-guide.md
```

This page is intentionally written for external frontend/backend developers. It explains server-side token handling, `external_customer_id`, endpoint usage, error codes, examples and go-live checks.

## Security rules

- Hemsidan får aldrig skicka `company_id` som source of truth.
- Ops Platform löser tenant från API-klienten.
- Customer endpoints använder endast länkad `customer_portal_identities`.
- Email ensam ger aldrig faktura-/avtalsåtkomst.
- Token ska aldrig exponeras i browsern.
- Gamla eller exponerade API-nycklar ska återkallas och kan därefter raderas i superadmin-UI:t.

## Audit och cache

Customer Portal API ska aldrig returnera kunddata med publik cache. Alla customer- och customer-portal-svar ska sätta:

```http
Cache-Control: no-store
```

Audit-loggen skrivs till `integration_api_requests`. Tabellen använder kolumnen `route`, inte `path`.

Exempel på kontroll efter live-test:

```sql
select
  created_at,
  company_id,
  api_client_id,
  method,
  route,
  status_code,
  metadata ->> 'result_count' as result_count,
  duration_ms,
  error_code
from integration_api_requests
where created_at > now() - interval '30 minutes'
order by created_at desc
limit 50;
```

För ett lyckat mätvärdesanrop ska `route = '/api/v1/customer/metering-values'`, `status_code = 200`, `result_count = 1` och både `company_id` samt `api_client_id` vara satta.

## Batch 7 website integration foundation

External websites should use the public developer guide:

```text
https://app.gridex.se/developers/customer-portal-api
```

Batch 7 adds the foundation for:

```text
customer_number as Ops-owned customer master reference
POST /api/v1/website/customer-applications
webhook_subscriptions and webhook_deliveries
confirmation/cooling-off communication events
Capway/customer_number/debtor/invoice reference mapping
billing dispute traceability
```

Key principles:

```text
Ops is master.
Websites are channels.
Capway is a billing/payment partner.
customer_number belongs to Ops and is the business reference used for support, invoices, disputes and partner mapping.
```

Customer application endpoint:

```text
POST /api/v1/website/customer-applications
Scope: website_applications.write
```

The endpoint creates or matches customer, reserves `customer_number`, upserts `customer_portal_identities`, optionally creates site/metering point/contract application, triggers customer communication rules and emits domain events for webhook delivery.

Webhook dispatch:

```text
POST /api/internal/webhooks/dispatch
Authorization: Bearer <GRIDEX_CRON_SECRET or CRON_SECRET>
```

Webhook payloads use top-level `event_id`, `event_type`, `created_at`, `company_id`, `customer_id`, `customer_number`, `external_customer_id` and `data`.

## Batch 8 operational hardening

Batch 8 adds admin operations UI and hardening for external website onboarding:

- `/admin/website-applications` for received/failed website customer applications.
- `/admin/webhooks/deliveries` for webhook delivery logs, resend and ignored deliveries.
- `POST /api/v1/website/customer-applications` accepts nested and simplified payloads.
- Invalid payloads return `422 validation_error` with `field`, `hint` and `error_stage`.
- Email and webhook delivery issues must return warnings rather than failing a created customer application.
- Company pages show tenant email readiness, verified-domain/fallback sender mode, DNS status and template readiness.
- Customer cards show `customer_number`, `external_customer_id`, source website, communication logs and Capway/billing references.

Public documentation:

```text
https://app.gridex.se/developers/customer-portal-api
```
