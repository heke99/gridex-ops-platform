# Gridex Website API och webhooks

Publik dokumentationssida efter deploy:

```text
https://app.gridex.se/developers/customer-portal-api
```

Den här guiden är för externa hemsidor, kundportaler och partners som ska ansluta till Gridex API.

## Grundprincip

```text
Gridex API = master för kund, kundnummer, avtal, avtalsnummer, prisversion, avtalssnapshot, juridiska godkännanden, fullmakter, fakturareferenser, mätvärden, händelser och audit.
Extern hemsida = kanal där kunden ser publicerade avtal, skickar ansökan och använder Mina sidor.
Fakturapartner = extern referens och betal-/fakturaflöde, inte master för kund eller avtal.
```

Supportärenden ligger utanför Gridex API. Varje elbolag hanterar support i sina egna kanaler.

## Autentisering

Alla anrop görs server-side:

```http
Authorization: Bearer YOUR_GRIDEX_API_TOKEN
Origin: https://www.exempel.se
Content-Type: application/json
```

API-nyckeln identifierar rätt bolag. Skicka inte egen `company_id` från hemsidan. Allowed origins skyddar webbläsaranrop; server-till-server-anrop kan sakna Origin-header och måste därför hålla API-nyckeln hemlig.

## Behörigheter

| I vanliga ord | Teknisk behörighet |
| --- | --- |
| Läsa avtal på hemsidan | `website_contracts.read` |
| Skicka kundansökningar | `website_applications.write` |
| Mina sidor – läsa kunddata | `customer_portal.read` |
| Mina sidor – uppdatera kunddata | `customer_portal.write` |
| Läsa händelser | `events.read` |
| Skicka händelser från hemsidan | `website_events.write` |

Kommande mer granulära behörigheter är förberedda men inte fullständigt uppdelade i alla routes ännu: `customer_documents.read`, `customer_notifications.read/write`, `customer_contact.write`, `customer_facility_data.write`, `customer_power_of_attorney.write`.

## Hämta publicerade avtal

```http
GET /api/v1/website/public-contracts?customer_type=private
```

Krav: `website_contracts.read`.

Ett avtal syns bara om det är publicerat, aktiverat för hemsida/API, inte arkiverat, datumgiltigt, har aktiv prisversion/prislista och komplett publicerad juridik.

```json
{
  "data": [
    {
      "id": "offer_...",
      "offer_reference": "offer_...",
      "code": "RORLIGT-ELPRIS",
      "name": "Rörligt elpris",
      "type": "variable_spot",
      "customer_type": "both",
      "pricing": {
        "monthly_fee": { "amount": 68, "currency": "SEK", "unit": "month" },
        "markup": { "amount": 4, "unit": "ore_per_kwh" },
        "invoice_fee": { "amount": 0, "currency": "SEK", "unit": "invoice" },
        "spot_share": null,
        "portfolio_share": null
      },
      "legal": {
        "terms_version": "2026-06",
        "privacy_policy_version": "2026-06",
        "withdrawal_version": "2026-06",
        "power_of_attorney_required": true,
        "price_terms_version": "2026-06"
      },
      "valid_from": "2026-06-01",
      "valid_to": null
    }
  ]
}
```

Hemsidan ska skicka tillbaka `offer_reference` när kunden ansöker. Skicka inte egna priser eller fritextvillkor som juridisk sanning.

## Skicka kundansökan

```http
POST /api/v1/website/customer-applications
```

Krav: `website_applications.write`.

```json
{
  "external_customer_id": "CUSTOMER-12345",
  "source": "exempel.se",
  "customer": {
    "customer_type": "private",
    "first_name": "Anna",
    "last_name": "Andersson",
    "email": "anna@example.se",
    "phone": "+46701234567",
    "personal_number": "YYYYMMDDXXXX"
  },
  "site": {
    "facility_id": "735999888000000112",
    "street": "Storgatan 1",
    "postal_code": "21122",
    "city": "Malmö",
    "price_area_code": "SE4",
    "move_in_date": "2026-07-01"
  },
  "contract": {
    "offer_reference": "offer_...",
    "requested_start_date": "2026-07-01"
  },
  "consents": {
    "terms": true,
    "privacy_policy": true,
    "withdrawal": true,
    "power_of_attorney": true,
    "price_terms": true
  }
}
```

Systemet skapar/matchar kund, skapar kundnummer, länkar portal identity, sparar anläggning/mätpunkt när data finns, skapar avtal och avtalssnapshot, sparar juridiska acceptanser och köar händelser/webhooks.

## Mina sidor

Kundportalen anropar server-side med API-nyckel och minst en stabil kundreferens. Starkast är auth user, därefter extern kundreferens, kundnummer och unik e-post som fallback:

```http
x-gridex-auth-user-id: <supabase-auth-user-id>
x-gridex-external-customer-id: CUSTOMER-12345
x-gridex-customer-number: DX-100025
x-gridex-customer-email: kund@example.se
```

Rekommenderad endpoint för Mina sidor är bundle-anropet:

```text
GET /api/v1/customer/portal-bundle
```

Det returnerar kund, avtal, anläggningar, mätpunkter, fakturor, mätvärden, dokument, juridiska godkännanden, notiser och händelser i ett svar. Separata endpoints finns kvar:

```text
GET /api/v1/customer/me
GET /api/v1/customer/contracts
GET /api/v1/customer/sites
GET /api/v1/customer/invoices
GET /api/v1/customer/invoices/[id]
GET /api/v1/customer/metering-values
GET /api/v1/customer/events
GET /api/v1/customer/documents
GET /api/v1/customer/legal-acceptances
GET /api/v1/customer/notifications
POST /api/v1/customer/notifications/read
POST /api/v1/customer/profile-update
POST /api/v1/customer/move-out
```

Tomma listor returneras som `200 OK` med `[]`. Kund saknas ger 404, saknat scope ger 403 och internt OPS-fel ger 500.

## Webhooks

Webhookar skickas som POST till konfigurerad HTTPS-URL. Mottagaren ska svara 2xx när eventet är mottaget.

Headers:

```http
X-Gridex-Event-Id: event_123
X-Gridex-Event-Type: contract.application_received
X-Gridex-Timestamp: 1718532000
X-Gridex-Signature: sha256=<signature>
X-Gridex-Delivery-Id: delivery_123
```

Signaturen är HMAC SHA-256 över:

```text
timestamp + "." + raw_body
```

Payload:

```json
{
  "id": "event_123",
  "type": "contract.application_received",
  "event_id": "event_123",
  "event_type": "contract.application_received",
  "created_at": "2026-06-16T10:30:00Z",
  "company_id": "uuid",
  "customer_id": "uuid",
  "customer_number": "DX-100025",
  "external_customer_id": "CUSTOMER-12345",
  "aggregate": { "type": "customer_contract", "id": "uuid" },
  "data": {
    "application_id": "uuid",
    "contract_id": "uuid",
    "status": "application_received"
  }
}
```

Aktiva events i första integrationspaketet:

```text
customer.created
customer.updated
customer_number.assigned
contract.application_received
contract.confirmation_sent
contract.cooling_off_sent
invoice.created
invoice.sent
invoice.disputed
metering_values.updated
```

Planerade events ska inte antas finnas förrän de dokumenteras som aktiva.

## Idempotency och fel

Skicka `Idempotency-Key` för write-anrop. En tidigare lyckad request returnerar samma huvudreferenser igen. En tidigare misslyckad request returnerar `409 idempotent_failed` så integrationen inte får falsk success.

Externa API-fel följer stabila koder, till exempel `missing_api_token`, `api_scope_missing`, `public_contract_not_available`, `legal_acceptance_missing` och `idempotent_failed`. Visa kundvänlig text i kund-UI och logga tekniska detaljer server-side.
