# Gridex Customer Portal API

Det här dokumentet beskriver hur en hemsida, kundportal eller partnerintegration ansluter till Gridex API för att visa publicerade elavtal, skicka kundansökningar och hämta kunddata för Mina sidor.

Den publika utvecklarsidan är huvudkällan för externa utvecklare:

```text
https://app.gridex.se/developers/customer-portal-api
```

Repo-versionen av samma publika guide finns i:

```text
docs/external-website-api-integration-guide.md
```

## Grundregel

Gridex API är källan för kund, kundnummer, avtal, prisversion, avtalssnapshot, juridiska godkännanden, anläggningar, mätvärden, fakturor, dokument, händelser och webhook-leveranser. Hemsidan ska vara kundens frontend och ska inte skapa egna priser, villkor eller kundstatusar som sanning.

Supportärenden ligger utanför detta API. Varje elbolag hanterar support i sina egna kanaler.

## Superadmin setup

1. Gå till `/admin/platform/api-clients`.
2. Välj bolag.
3. Skapa API-klient för hemsida/Mina sidor.
4. Använd standardpaketet eller välj behörigheter manuellt.
5. Lägg till tillåtna domäner, t.ex. `https://www.exempelenergi.se`.
6. Kopiera API-nyckeln direkt. Den visas bara en gång.
7. Lägg API-nyckeln som server secret på hemsidan, t.ex. `GRIDEX_API_KEY`.

## Autentisering

```http
Authorization: Bearer <api_key>
Content-Type: application/json
```

`x-api-key` stöds för server-till-server-anrop, men rekommenderad header är `Authorization: Bearer`.

Allowed origins skyddar webbläsaranrop. Server-till-server-anrop kan sakna `Origin`, därför måste API-nyckeln alltid hållas hemlig och användas från backend/server route, inte från publik frontend.

## Behörigheter

Aktiva behörigheter idag:

| Vanligt namn | Teknisk behörighet |
| --- | --- |
| Läsa avtal på hemsidan | `website_contracts.read` |
| Skicka kundansökningar | `website_applications.write` |
| Mina sidor – läsa kunddata | `customer_portal.read` |
| Mina sidor – uppdatera kunddata | `customer_portal.write` |
| Läsa händelser | `events.read` |
| Skicka händelser från hemsidan | `website_events.write` |
| Läsa kunddokument | `customer_documents.read` |
| Läsa kundnotiser | `customer_notifications.read` |
| Uppdatera kundnotiser | `customer_notifications.write` |

Standardpaketet för hemsida/Mina sidor bör innehålla dessa behörigheter: `website_contracts.read`, `website_applications.write`, `customer_portal.read`, `customer_portal.write`, `website_events.write`, `events.read`, `customer_documents.read`, `customer_notifications.read` och `customer_notifications.write`. Mer granulära framtida behörigheter kan införas senare för kontaktuppgifter, anläggningsdata och fullmakt.

## Publicerade avtal

```http
GET /api/v1/website/public-contracts
```

Returnerar bara avtal som är publicerade, aktiva för hemsida/API, inte arkiverade, datumgiltiga, kopplade till aktiv prisversion/prisbok, har komplett juridik och tillhör bolaget som API-nyckeln är kopplad till.

Exempel:

```json
{
  "data": [
    {
      "id": "public_offer_id",
      "code": "RORLIGT-ELPRIS",
      "offer_reference": "opaque_offer_reference",
      "name": "Rörligt elpris",
      "type": "variable_spot",
      "customer_type": "both",
      "pricing": {
        "monthly_fee": { "amount": 68, "currency": "SEK", "unit": "month" },
        "invoice_fee": { "amount": 0, "currency": "SEK" },
        "markup": { "amount": 4, "unit": "ore_per_kwh" },
        "fixed_price": null,
        "portfolio_share": null,
        "spot_share": null
      },
      "legal": {
        "terms_version": "2026-06",
        "privacy_policy_version": "2026-06",
        "withdrawal_version": "2026-06",
        "price_terms_version": "2026-06",
        "power_of_attorney_required": true
      },
      "valid_from": "2026-06-01",
      "valid_to": null
    }
  ]
}
```

Hemsidan ska skicka tillbaka `offer_reference` när kunden ansöker. Hemsidan får inte skicka egna månadsavgifter, påslag eller villkor som sanning.

## Kundansökan

```http
POST /api/v1/website/customer-applications
```

Rekommenderad payload:

```json
{
  "external_customer_id": "WEB-20260616-0001",
  "source": "www.exempelenergi.se",
  "customer": {
    "type": "consumer",
    "first_name": "Sara",
    "last_name": "Karlsson",
    "personal_identity_number": "19900101-1234",
    "email": "sara@example.se",
    "phone": "+46700000000"
  },
  "site": {
    "address": "Exempelgatan 1",
    "postal_code": "11434",
    "city": "Stockholm",
    "move_in_date": "2026-07-01",
    "facility_id": null,
    "metering_point_id": null,
    "price_area": "SE3"
  },
  "contract": {
    "offer_reference": "opaque_offer_reference",
    "requested_start_date": "asap"
  },
  "consents": {
    "terms": true,
    "privacy_policy": true,
    "withdrawal": true,
    "power_of_attorney": true,
    "price_terms": true
  },
  "metadata": {
    "utm_source": "website",
    "landing_page": "/elavtal"
  }
}
```

Systemet matchar eller skapar kund, sätter kundnummer, skapar ansökan, skapar avtalssnapshot, sparar juridiska godkännanden, sparar fullmakt om den krävs och skapar händelser för vidare webhook-leverans.

## Mina sidor-koppling: Customer Portal External Auth Linking

Kunddata får aldrig hämtas med valfri kund-id från frontend. Använd hemsidans backend/session och identifiera kund via säker kundkoppling.

När tenantens hemsida har egen Supabase Auth ska webben skicka sin Supabase `session.user.id` till OPS. OPS ska inte försöka hitta kunden i sitt eget `auth.users` när auth ligger i webbens Supabase-projekt.

```http
x-gridex-customer-portal-user-id: <gridex-web-supabase-session-user-id>
x-gridex-auth-user-id: <gridex-web-supabase-session-user-id>
x-gridex-external-customer-id: CUSTOMER-12345
x-gridex-customer-number: DX-100025
x-gridex-customer-email: kund@example.se
```

`customer_portal_user_id`/`auth_user_id` är starkast, därefter `external_customer_id`, `customer_number` och unik `email` som fallback. API-nyckeln avgör tenant/bolag. Skicka aldrig `company_id` eller fritt `customer_id` från frontend.

OPS länkar första lyckade anropet så här:

```text
Gridex-webb Supabase session.user.id
→ customer_portal_accounts.user_id med role = owner
→ customer_portal_identities.auth_user_id
→ customer_portal_identities.customer_portal_user_id
→ kundens portal-bundle
```

`customer_portal_accounts.role` ska vara `owner`, `billing` eller `viewer`. Använd inte `customer`.


Rekommenderad endpoint för Mina sidor är ett samlat bundle-anrop:

```http
GET /api/v1/customer/portal-bundle
```

Det returnerar:

```json
{
  "data": {
    "customer": {},
    "contracts": [],
    "sites": [],
    "metering_points": [],
    "invoices": [],
    "metering_values": [],
    "documents": [],
    "legal_acceptances": [],
    "notifications": [],
    "events": []
  }
}
```

Separata endpoints finns kvar:

```http
GET  /api/v1/customer/me
GET  /api/v1/customer/contracts
GET  /api/v1/customer/sites
GET  /api/v1/customer/invoices
GET  /api/v1/customer/invoices/[id]
GET  /api/v1/customer/metering-values
GET  /api/v1/customer/events
GET  /api/v1/customer/documents
GET  /api/v1/customer/legal-acceptances
GET  /api/v1/customer/notifications
POST /api/v1/customer/notifications/read
POST /api/v1/customer/profile-update
POST /api/v1/customer/move-out
```

Kunddata ska alltid returneras med:

```http
Cache-Control: no-store
```

Tom data är ett normalt svar. Saknade fakturor, dokument, mätvärden, juridiska godkännanden eller notiser ska returnera `200 OK` med tom lista, inte 500. Kund saknas ger 404, saknat scope ger 403 och saknad API-token ger 401.

## Kundevents från hemsidan

```http
POST /api/v1/website/customer-events
POST /api/v1/events
```

Båda accepterar samma payload. Används för operativa kundhändelser, t.ex. att kunden öppnat ett avtal eller laddat ner ett dokument. Support- och case-events är inte tillåtna. Exempel på tillåtna kundevents: `customer.logged_in`, `customer.viewed_dashboard`, `customer.viewed_contract`, `customer.viewed_site`, `customer.viewed_invoice`, `customer.opened_document`, `customer.downloaded_document`, `customer.updated_profile`, `customer.requested_contact_update`, `customer.viewed_legal_terms` och `customer.viewed_power_of_attorney`.

## Webhooks

Webhook-events levereras per bolag till konfigurerade webhook-URL:er. Payloaden har formatet:

```json
{
  "id": "event_123",
  "type": "contract.application_received",
  "created_at": "2026-06-16T10:30:00Z",
  "company_id": "uuid",
  "data": {
    "customer_number": "DX-100025",
    "application_id": "uuid",
    "contract_id": "uuid",
    "status": "received"
  }
}
```

Standardheaders:

```http
X-Gridex-Event-Id: event_123
X-Gridex-Event-Type: contract.application_received
X-Gridex-Timestamp: 1718532000
X-Gridex-Signature: sha256=<signature>
X-Gridex-Delivery-Id: delivery_123
```

Signaturen beräknas med HMAC SHA-256 över:

```text
timestamp + "." + raw_body
```

Mottagaren ska returnera `2xx` när eventet tagits emot. Icke-`2xx` eller timeout gör att leveransen försöks igen enligt systemets retry-regler.

## Aktiva events

Första events som stöds i integrationskontraktet:

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
customer.opened_document
customer.downloaded_document
```

Mailrelaterade contract-events ska skapas när kommunikationen faktiskt är skickad eller registrerad som skickad.

## Felrespons

Externa API-fel ska följa stabilt format:

```json
{
  "error": {
    "code": "missing_scope",
    "message": "API-nyckeln saknar behörighet för den här åtgärden.",
    "request_id": "req_123"
  }
}
```

Rå SQL, interna stack traces och interna systemord ska inte visas för partner eller slutkund.

## Säkerhetsregler

- API-nyckeln identifierar bolaget.
- Hemsidan får aldrig skicka bolags-id som sanning.
- Alla frågor filtreras på rätt bolag.
- Kundportal-data får bara visas för rätt kund.
- Token får inte exponeras i browsern.
- Gamla eller exponerade API-nycklar ska återkallas och kan därefter raderas av superadmin.
- Signeringshemligheter ska inte visas i klartext efter skapande.
