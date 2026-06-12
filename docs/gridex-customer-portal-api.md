# Gridex Customer Portal API

Batch 6 kopplar Gridex Ops Platform till externa hemsidor och Mina sidor.

## Source of truth

Gridex Ops Platform är source of truth för kund, kundnummer, avtal, avtalsnummer, prisversion, avtalssnapshot, anläggningar, mätvärden, fakturor, juridiskt viktig kommunikation och behörighet. Externa hemsidor ska bara vara frontend och ska anropa Ops Platform server-side.

Support ligger utanför Gridex Ops API. Ops ska inte skapa, routa, logga eller exponera supportärenden åt elbolag. Varje elbolag hanterar support i sina egna kanaler.

## Superadmin setup

1. Gå till `/admin/platform/api-clients`.
2. Välj tenant/bolag.
3. Skapa API-klient med minsta möjliga scopes:
   - `website_contracts.read`
   - `website_applications.write`
   - `website_events.write` vid behov
   - `customer_portal.read` vid behov
   - `customer_portal.write` vid behov
4. Lägg allowed origins, t.ex.
   - `https://gridex.se`
   - `https://www.gridex.se`
5. Kopiera token direkt. Den visas bara en gång.
6. Lägg token som server secret på hemsidan, exempelvis `GRIDEX_OPS_API_TOKEN`.

## Header

```http
Authorization: Bearer <GRIDEX_OPS_API_TOKEN>
```

`x-api-key` stöds också för enklare server-to-server-test, men rekommenderad header är `Authorization: Bearer`.

## Public contracts

```http
GET /api/v1/website/public-contracts
```

Hemsidan ska hämta publicerade avtal från Ops och skicka tillbaka valt `contract_offer_id`, `price_plan_id` och/eller `price_plan_version_id` när kunden ansöker. Hemsidan får inte skicka egna priser eller fritextavtal som juridisk sanning.

## Website customer applications

```http
POST /api/v1/website/customer-applications
```

Endpointen skapar eller matchar kund, reserverar kundnummer, skapar portal identity, anläggning, mätpunkt, kundavtal, avtalsnummer och låst avtalssnapshot. Response ska returnera:

```text
application_id
application_number
customer_id
customer_number
external_customer_id
portal_identity_id
customer_site_id
metering_point_id
contract_id
contract_number
contract_price_snapshot_id
price_plan_id
price_plan_version_id
status
missing_fields
blocking_reasons
next_step
warnings
```

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

Rekommenderad endpoint för inloggad/länkad kund:

```http
GET /api/v1/customer/me
```

`/customer/me` ska användas när kunden är inloggad/länkad och frontend inte ska skicka valfri `customer_id`.

Övriga customer endpoints kan använda länkad `external_customer_id`, men bara från hemsidans server route efter att den egna sessionen kontrollerats. Skicka external id som query eller header:

```http
x-gridex-external-customer-id: <external_customer_id>
```

eller

```http
GET /api/v1/customer/contracts?external_customer_id=<external_customer_id>
```

Endpoints:

- `GET /api/v1/customer/me`
- `GET /api/v1/customer/contracts`
- `GET /api/v1/customer/invoices`
- `GET /api/v1/customer/invoices/[id]`
- `GET /api/v1/customer/sites`
- `GET /api/v1/customer/metering-values`
- `GET /api/v1/customer/documents`
- `POST /api/v1/customer/profile-update`
- `POST /api/v1/customer/move-out`

## Customer events

```http
POST /api/v1/website/customer-events
```

Tillåtna kundevents är exempelvis öppnat avtal, nedladdad faktura, accepterad fullmakt eller visad switchstatus.

Support/case-events är inte tillåtna och ska returnera `422 support_out_of_scope`.

## Mätvärden

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

This page is intentionally written for external frontend/backend developers. It explains server-side token handling, public contracts, `external_customer_id`, endpoint usage, error codes, examples and go-live checks.

## Security rules

- Hemsidan får aldrig skicka `company_id` som source of truth.
- Ops Platform löser tenant från API-klienten.
- Customer endpoints använder endast länkad `customer_portal_identities`.
- Email ensam ger aldrig faktura-/avtalsåtkomst.
- Token ska aldrig exponeras i browsern.
- Frontend får aldrig fritt välja `customer_id` eller `external_customer_id`.
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
contract_number as Ops-owned agreement reference
contract_price_snapshot_id as legal/pricing snapshot reference
GET /api/v1/website/public-contracts
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
customer_number belongs to Ops and is the business reference used for invoices, disputes and partner mapping.
```

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
- `POST /api/v1/website/customer-applications` accepts nested and simplified payloads, but contract/pricing truth must still come from public offers/version IDs.
- Invalid payloads return `422 validation_error` with `field`, `hint` and `error_stage`.
- Email and webhook delivery issues must return warnings rather than failing a created customer application.
- Company pages show tenant email readiness, verified-domain/fallback sender mode, DNS status and template readiness.
- Customer cards show `customer_number`, `contract_number`, `external_customer_id`, source website, communication logs and Capway/billing references.

Public documentation:

```text
https://app.gridex.se/developers/customer-portal-api
```
