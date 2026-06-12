# Gridex External Website API Integration Guide

Publik dokumentationssida efter deploy:

```text
https://app.gridex.se/developers/customer-portal-api
```

Den här guiden är för externa hemsidor, kundportaler, white-label-portaler och partners som ska koppla mot Gridex Ops API.

## Grundprincip

```text
Ops = master för kund, kundnummer, avtal, anläggning, mätpunkt, faktura, kommunikation och audit.
Extern hemsida = kanal där kunden tecknar, loggar in eller ser sin data.
Capway = faktura-/betalpartner, inte master för kunden.
```

Bygg inte så här:

```text
Extern hemsida skapar lite kunddata
Capway skapar kundnummer
Ops försöker matcha i efterhand
```

Bygg så här:

```text
Extern hemsida skickar ansökan/order till Ops
Ops skapar/matchar kund
Ops skapar customer_number
Ops skapar avtal/process
Ops skickar bekräftelse/ångerrätt/status
Ops skickar webhooks tillbaka till hemsidan
Capway får fakturaunderlag med Gridex kundnummer och externa referenser
```

## Identiteter

Gridex använder tre separata identiteter:

```text
customer_id             Intern teknisk UUID i Gridex/Ops.
customer_number         Gridex affärsreferens, t.ex. GDX-100001. Master för support/faktura/bestridan.
external_customer_id    Hemsidans/partnerns kund-ID.
```

Externa fakturapartner-ID:n lagras separat:

```text
Capway debtor/customer id
Capway invoice id
annan partnerreferens
```

Capway får alltså gärna ge egna ID:n, men de ersätter inte Gridex `customer_number`.

## Autentisering

Alla anrop görs server-side från hemsidan:

```http
Authorization: Bearer YOUR_GRIDEX_API_TOKEN
```

API-token ska ligga i servermiljön, exempelvis:

```env
GRIDEX_OPS_API_BASE_URL=https://app.gridex.se
GRIDEX_OPS_API_TOKEN=...
```

Använd aldrig:

```env
NEXT_PUBLIC_GRIDEX_OPS_API_TOKEN=...
```

Frontend får aldrig skicka `company_id`. Tenant löses alltid från API-token via `integration_api_clients.company_id`.

## Skapa kund och elavtalsansökan

```http
POST /api/v1/website/customer-applications
```

Scope:

```text
website_applications.write
```

Exempel:

```bash
curl -X POST "https://app.gridex.se/api/v1/website/customer-applications" \
  -H "Authorization: Bearer YOUR_GRIDEX_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: website-order-12345" \
  -d '{
    "external_customer_id": "CUSTOMER-12345",
    "source": "example.se",
    "customer": {
      "customer_type": "private",
      "first_name": "Anna",
      "last_name": "Andersson",
      "email": "anna@example.se",
      "phone": "+46701234567"
    },
    "site": {
      "facility_id": "735999888000000112",
      "street": "Testgatan 1",
      "postal_code": "11122",
      "city": "Stockholm",
      "price_area_code": "SE3",
      "move_in_date": "2026-07-01"
    },
    "contract": {
      "contract_name": "Rörligt elpris",
      "contract_type": "variable_monthly",
      "starts_at": "2026-07-01",
      "monthly_fee_sek": 49,
      "spot_markup_ore_per_kwh": 8,
      "green_fee_mode": "ore_per_kwh",
      "green_fee_value": 2
    },
    "consents": {
      "terms_accepted_at": "2026-06-09T14:00:00Z",
      "withdrawal_information_accepted": true
    }
  }'
```

Response:

```json
{
  "data": {
    "customer_id": "93749529-aae5-43dc-8099-9729ecb8ca17",
    "customer_number": "GDX-100001",
    "external_customer_id": "CUSTOMER-12345",
    "portal_identity_id": "...",
    "customer_site_id": "...",
    "metering_point_id": "...",
    "contract_id": "...",
    "status": "application_received"
  }
}
```

## Läsa kunddata

Alla kundendpoints kräver `external_customer_id`.

```http
GET /api/v1/customer/sites?external_customer_id=CUSTOMER-12345
GET /api/v1/customer/contracts?external_customer_id=CUSTOMER-12345
GET /api/v1/customer/invoices?external_customer_id=CUSTOMER-12345
GET /api/v1/customer/metering-values?external_customer_id=CUSTOMER-12345
```

Scope:

```text
customer_portal.read
```

## Webhooks

Externa hemsidor kan ha en HTTPS endpoint som tar emot events från Ops:

```text
https://example.se/api/gridex/webhook
```

Exempel på events:

```text
customer.created
customer.updated
customer_number.assigned
contract.application_received
contract.confirmation_sent
contract.cooling_off_sent
contract.activated
supplier_switch.started
supplier_switch.completed
invoice.created
invoice.sent
invoice.paid
invoice.disputed
metering_values.updated
case.created
case.updated
```

Headers:

```http
x-gridex-webhook-timestamp: 1781013600
x-gridex-webhook-signature: sha256=<hmac>
```

Payload:

```json
{
  "event_id": "evt_123",
  "event_type": "invoice.sent",
  "created_at": "2026-06-09T14:00:00Z",
  "company_id": "b3ad1bf6-fa45-41a6-8054-2e0862e82aca",
  "customer_id": "93749529-aae5-43dc-8099-9729ecb8ca17",
  "customer_number": "GDX-100001",
  "external_customer_id": "CUSTOMER-12345",
  "data": {
    "invoice_id": "inv_123",
    "amount_ex_vat": 919.19,
    "vat_amount": 229.80,
    "amount_inc_vat": 1148.99,
    "status": "sent"
  }
}
```

Mottagaren måste verifiera HMAC-signaturen och behandla `event_id` idempotent.

## Bekräftelsemail och ångerrätt

Default-modellen är:

```text
Ops skickar och loggar juridiskt viktiga mail.
Tenant/elbolag använder egen avsändare och egna mallar.
Extern hemsida får webhook-event och visar status.
```

Ops ska kunna logga:

```text
vilket avtal kunden accepterade
vilken prisinformation som gällde
när bekräftelse skickades
när ångerrättsinformation skickades
vilken mallversion som användes
om mailet levererades/studsade
vilken kund och vilket kundnummer det gäller
```

## Capway och faktura

Capway-regel:

```text
debtRow amount = belopp exkl. moms
vatCode = SE25 vid svensk 25% moms
```

Gridex ska alltid skicka med/spåra:

```text
customer_number
customer_id
Capway debtor id
Capway invoice id
fakturarader exkl. moms
vatCode
```

Vid bestridan ska Ops kunna visa:

```text
kundnummer
kundens avtal
signering/godkännande
anläggnings-ID
mätvärden/förbrukning
prisrad/fakturarad
Capway debtor id
Capway invoice id
kommunikationslogg
eventlogg
audit log
```

## Go-live checklista

```text
API-client skapad i Gridex Ops
Token ligger server-side
Allowed origins korrekt
Scopes korrekt
Webhook URL konfigurerad om events ska tas emot
Webhook-signatur verifieras
external_customer_id är stabilt och unikt
customer-applications endpoint testad
customer_number returneras
sites/contracts/invoices/metering-values testade
audit loggar korrekt
gamla API-nycklar återkallade/raderade
```


## Legacy summary keywords for internal regression

```text
External website frontend -> own server route -> Gridex Ops API
Cache-Control: no-store
Old API keys can be revoked and deleted
```

## Batch 8 hardening for onboarding API

`POST /api/v1/website/customer-applications` accepts both nested payloads and simplified website form payloads. If the body is invalid, Gridex returns `422 validation_error` with `field`, `hint` and `error_stage` instead of a generic 500.

Simplified payload example:

```json
{
  "external_customer_id": "CUSTOMER-12345",
  "source": "example.se",
  "name": "Anna Andersson",
  "email": "anna@example.se",
  "phone": "+46701234567",
  "address": {
    "street": "Testgatan 1",
    "postal_code": "11122",
    "city": "Stockholm",
    "country": "SE"
  },
  "site": {
    "facility_id": "735999888000000112",
    "price_area": "SE3",
    "move_in_date": "2026-07-01"
  },
  "contract": {
    "contract_name": "Rörligt elpris",
    "contract_type": "variable_monthly",
    "starts_at": "2026-07-01"
  }
}
```

Email/webhook delivery problems must not fail the whole customer application. If customer and contract are created but a notification cannot be sent immediately, the API returns success with `warnings`, and the issue appears in admin under website applications, communication logs and webhook deliveries.

Idempotency responses must return the same main references again: `application_id`, `customer_id`, `customer_number`, `external_customer_id` and `status`.

## Mail and legal communication responsibility

Ops sends legally important customer communication by default, including contract confirmation and cooling-off/ångerrätt information. Websites receive events and can show status, but should not send duplicate legal confirmation emails unless that is explicitly agreed with Gridex/the tenant.

Important events:

```text
contract.confirmation_sent
contract.cooling_off_sent
invoice.disputed
```

Tenant sender domains must be verified before they are used as the real From-domain. If the domain is not verified, the tenant can use fallback sender mode if allowed; the communication log records `sender_mode`, `sender_email`, `reply_to_email`, template version and delivery status.


## Batch 8.1 live-schema alignment

`POST /api/v1/website/customer-applications` writes to the live schema, not historical draft tables. Important rules:

```text
external_customer_id krävs
customer_number skapas av Ops
site/facility_id används för customer_sites
mätpunkt skapas i public.metering_points
Idempotency-Key ska skickas av hemsidans backend
failed idempotency ger 409 idempotent_failed, inte falsk success
mail/webhook-problem returneras som warnings när core onboarding lyckas
```

Mätpunkter skapas med live-obligatoriska värden:

```text
site_id
customer_site_id
metering_point_id / meter_point_id / ediel_metering_point_id
reading_frequency = monthly om inget skickas
measurement_type = consumption om inget skickas
is_settlement_relevant = true
data_quality_status = incomplete
verification_status = pending
onboarding_status = application_received
```

Error examples:

```json
{
  "error": "external_customer_id krävs.",
  "code": "validation_error",
  "field": "external_customer_id",
  "error_stage": "validation"
}
```

```json
{
  "error": "Tidigare idempotent request misslyckades.",
  "code": "idempotent_failed",
  "error_stage": "idempotency",
  "hint": "Använd ny Idempotency-Key efter att felet är åtgärdat, eller kör retry via admin."
}
```

## OPS facility/customer-card workflow

For the full tenant website contract, customer application payloads, customer events and the facility work queue used by OPS-E/OPS-F, see:

```txt
docs/ops-api-customer-intake-facility.md
```

Important rule for external websites: the website may submit address, postal code, chosen contract and customer consent, but it must not let a tenant or customer manually choose arbitrary grid owners. OPS resolves tenant from the API client and resolves/requests facility data in the backend.

## Current OPS contract model

External websites must not own contract/pricing truth. The correct flow is:

1. The website backend calls `GET /api/v1/website/public-contracts` using a tenant-bound API client.
2. The website shows only the returned published offers.
3. The website sends the selected `contract_offer_id`, `price_plan_id` and/or `price_plan_version_id` to `POST /api/v1/website/customer-applications`.
4. OPS creates the customer number, agreement number and locked contract snapshot.
5. OPS sends and logs legally important confirmation/cooling-off communication unless explicitly configured otherwise.

Tenant admins do not create their own public offers. Platform admin publishes the offers a tenant may sell.
