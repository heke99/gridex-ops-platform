# Gridex External Website API Integration Guide

Publik dokumentationssida efter deploy:

```text
https://app.gridex.se/developers/customer-portal-api
```

Den här guiden är för externa hemsidor, kundportaler, white-label-portaler och partners som ska koppla mot Gridex Ops API.

## Grundprincip

```text
Ops = master för kund, kundnummer, avtal, avtalsnummer, prisversion, avtalssnapshot, anläggning, mätpunkt, faktura, juridisk kommunikation och audit.
Extern hemsida = kanal där kunden ser publicerade avtal, tecknar/ansöker, loggar in eller ser sin data.
Capway = faktura-/betalpartner, inte master för kunden.
```

Bygg inte så här:

```text
Extern hemsida skapar egna juridiska avtal/priser/kundnummer
Capway skapar kundnummer
Ops försöker matcha i efterhand
```

Bygg så här:

```text
Extern hemsida hämtar publicerade avtal från Ops
Extern hemsida skickar valt contract_offer_id/price_plan_version_id till Ops
Ops skapar/matchar kund
Ops skapar customer_number
Ops skapar contract_number
Ops skapar låst avtalssnapshot
Ops skickar och loggar juridiskt viktiga mail
Ops skickar webhooks tillbaka till hemsidan
Capway får fakturaunderlag med Gridex kundnummer och externa referenser
```

Support ligger utanför Gridex Ops API. Elbolaget hanterar support i sina egna kanaler. Ops ska inte skapa, routa, logga eller exponera supportärenden.

## Identiteter

Gridex använder separata identiteter:

```text
customer_id              Intern teknisk UUID i Gridex/Ops.
customer_number          Gridex affärsreferens, t.ex. GDX-100001. Master för kundportal, faktura, Capway och bestridan.
contract_id              Intern teknisk UUID för avtalet.
contract_number          Kundvänligt avtalsnummer, t.ex. AVT-100001-01.
application_id           Intern teknisk UUID för ansökan.
application_number       Kund-/adminvänligt ansökningsnummer.
external_customer_id     Hemsidans/partnerns kund-ID.
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

## Hämta publicerade avtal

```http
GET /api/v1/website/public-contracts?customer_type=private
```

Scope:

```text
website_contracts.read
```

Exempel:

```bash
curl -X GET "https://app.gridex.se/api/v1/website/public-contracts?customer_type=private" \
  -H "Authorization: Bearer YOUR_GRIDEX_API_TOKEN" \
  -H "Accept: application/json"
```

Response:

```json
{
  "data": [
    {
      "id": "offer_...",
      "contract_offer_id": "offer_...",
      "price_plan_id": "plan_...",
      "price_plan_version_id": "version_...",
      "product_code": "gridex_variable",
      "name": "Rörligt elpris",
      "public_name": "Rörligt elpris",
      "description": "Elpris som följer spotpriset med publicerat påslag.",
      "contract_type": "variable_spot",
      "type": "variable_spot",
      "billing_model": "spot",
      "customer_type": "both",
      "monthly_fee_sek": 59,
      "invoice_fee_sek": 19,
      "markup_ore_per_kwh": 4,
      "spot_markup_ore_per_kwh": 4,
      "terms_version": "2026-06",
      "withdrawal_version": "2026-06",
      "valid_from": "2026-06-01",
      "valid_to": null,
      "is_public": true,
      "is_active": true
    }
  ],
  "tenant": {
    "company_id": "...",
    "api_client_id": "..."
  }
}
```

Viktig regel:

```text
Hemsidan får visa publicerade erbjudanden, men den får inte skicka egna månadsavgifter, påslag eller fritextavtal som juridisk sanning.
Om ett avtal saknas i public-contracts ska det inte kunna tecknas publikt.
```

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
      "contract_offer_id": "offer_...",
      "price_plan_id": "plan_...",
      "price_plan_version_id": "version_...",
      "requested_start_date": "asap"
    },
    "consents": {
      "terms_accepted_at": "2026-06-09T14:00:00Z",
      "withdrawal_information_accepted": true,
      "power_of_attorney_accepted": true
    }
  }'
```

Response:

```json
{
  "data": {
    "customer_id": "93749529-aae5-43dc-941c-641ec3ecb16b",
    "customer_number": "GDX-100001",
    "application_id": "...",
    "application_number": "APP-20260612-0001",
    "external_customer_id": "CUSTOMER-12345",
    "portal_identity_id": "...",
    "customer_site_id": "...",
    "metering_point_id": "...",
    "contract_id": "...",
    "contract_number": "AVT-100001-01",
    "contract_price_snapshot_id": "...",
    "price_plan_id": "plan_...",
    "price_plan_version_id": "version_...",
    "status": "application_received",
    "missing_fields": ["facility_verified", "metering_point_id"],
    "blocking_reasons": [],
    "next_step": "facility_data_requested",
    "warnings": []
  }
}
```

## Idempotency

`Idempotency-Key` ska skickas av hemsidans backend. Samma lyckade request ska returnera samma huvudreferenser igen:

```text
application_id
application_number
customer_id
customer_number
external_customer_id
contract_id
contract_number
contract_price_snapshot_id
status
missing_fields
next_step
```

Tidigare misslyckad idempotent request ger `409 idempotent_failed`, inte falsk success.

## Läsa kunddata

Rekommenderad profil-endpoint:

```http
GET /api/v1/customer/me
```

`/customer/me` används när kunden är inloggad/länkad och hämtar kundprofilen utan att frontend skickar valfri `customer_id`.

Övriga kundendpoints kan använda `external_customer_id`, men bara från hemsidans server route efter att den egna sessionen har kontrollerats:

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

Viktigt:

```text
Frontend får aldrig fritt välja customer_id eller external_customer_id.
Hemsidans server route måste först kontrollera den inloggade kundens egen session.
Alla kundsvar ska returneras med Cache-Control: no-store.
```

## Kundevents från hemsidan

```http
POST /api/v1/website/customer-events
```

Scope:

```text
website_events.write
```

Tillåtna exempel:

```text
customer.login
customer.logout
customer.opened_contract
customer.downloaded_contract
customer.opened_invoice
customer.downloaded_invoice
customer.accepted_power_of_attorney
customer.completed_facility_data
customer.viewed_switch_status
```

Support- och case-events är inte tillåtna. Skicka inte `customer.support`, `customer.support_*`, `customer.case` eller `customer.case_*` till Ops.

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
vilket contract_number som skapades
vilket contract_price_snapshot_id som skapades
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
contract_number
customer_id
Capway debtor id
Capway invoice id
fakturarader exkl. moms
vatCode
```

Vid bestridan ska Ops kunna visa:

```text
kundnummer
avtalsnummer
kundens avtal
signering/godkännande
avtalssnapshot
anläggnings-ID
mätvärden/förbrukning
prisrad/fakturarad
Capway debtor id
Capway invoice id
kommunikationslogg
eventlogg
audit log
```

## Felkoder

```text
400       Query/body saknas eller requesten är felaktig.
401       API-token saknas eller är ogiltig.
403       Token är spärrad, saknar scope, domän/IP är inte tillåten eller kunden är inte länkad.
409       Samma Idempotency-Key har tidigare misslyckats.
422       Payloaden är validerbar JSON men saknar obligatoriska fält.
429       API-klientens rate limit är uppnådd.
500/503   Tillfälligt server- eller databasfel.
```

`422` ska returnera `field`, `hint` och `error_stage` när det är möjligt.

## Go-live checklista

```text
API-client skapad i Gridex Ops.
Token ligger endast server-side.
Token ligger aldrig i NEXT_PUBLIC_ eller browserkod.
Allowed origins är korrekta.
Scopes är korrekta.
GET /api/v1/website/public-contracts returnerar publicerade avtal.
Hemsidan skickar contract_offer_id/price_plan_version_id, inte egna priser som master.
POST /api/v1/website/customer-applications är testad.
Kundansökan returnerar customer_number.
Kundansökan returnerar contract_number.
Kundansökan returnerar application_number.
Kundansökan returnerar contract_price_snapshot_id.
Kundansökan returnerar missing_fields och next_step.
/customer/me är testad för inloggad/länkad kund.
Sites/contracts/invoices/metering-values är testade.
Webhook URL är HTTPS om events ska tas emot.
Webhook-signatur verifieras.
Webhook-events hanteras idempotent.
Audit loggar company_id, api_client_id, route, status_code och result_count.
Support/case-flöden är inte en del av Ops API.
Gamla API-nycklar är återkallade/raderade.
```

## Legacy summary keywords for internal regression

```text
External website frontend -> own server route -> Gridex Ops API
Cache-Control: no-store
Old API keys can be revoked and deleted
```

## Current OPS contract model

External websites must not own contract/pricing truth. The correct flow is:

1. The website backend calls `GET /api/v1/website/public-contracts` using a tenant-bound API client.
2. The website shows only the returned published offers.
3. The website sends the selected `contract_offer_id`, `price_plan_id` and/or `price_plan_version_id` to `POST /api/v1/website/customer-applications`.
4. OPS creates the customer number, agreement number and locked contract snapshot.
5. OPS sends and logs legally important confirmation/cooling-off communication unless explicitly configured otherwise.

Tenant admins do not create their own public offers. Platform admin publishes the offers a tenant may sell.

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

Juridiska kundmail loggas med live-kolumner:

```text
communication_logs.event_key
communication_logs.template_key
communication_logs.recipient_email
communication_logs.sender_email
communication_logs.reply_to_email
communication_logs.error_message
communication_log_events
domain_events
webhook_deliveries
```
