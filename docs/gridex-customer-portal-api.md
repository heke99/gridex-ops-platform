# Gridex Customer Portal API

Publik onlineversion efter deploy: `/developers/customer-portal-api`.

Dokumentationsversion: `2026-08-10.1`.

Den här filen är en tenant-neutral integrationsreferens. Den får aldrig innehålla
verkliga kunduppgifter, verkliga kundnummer, verkliga externa kund-ID:n eller
tenant-specifika hemligheter. Exakta request/response-scheman är canonical i
OpenAPI.

## Canonical endpoints

API base URL:

```text
https://app.gridex.se/api/v1
```

OpenAPI:

```text
https://app.gridex.se/api/v1/openapi/website-integration-v1.json
https://app.gridex.se/api/v1/openapi/customer-portal-v1.json
```

OpenAPI används för utveckling, validering och typgenerering. Runtime ska inte
hämta OpenAPI för varje request.

## Tenantkonfiguration

Tenantens hemsida och Mina sidor behöver endast en server-side hemlighet:

```env
GRIDEX_API_KEY=gridex_live_xxxxxxxxx
```

API-nyckeln avgör tenant, internt `company_id` och scopes. Klienten ska därför
aldrig skicka ett fritt `company_id`, tenant-ID eller annan bolagsväljare.

Frontend får aldrig exponera `GRIDEX_API_KEY`. Rekommenderat flöde är:

```text
Browser
  -> tenantens server route
  -> Authorization: Bearer $GRIDEX_API_KEY
  -> OPS API
  -> tenant härleds från credential
  -> tenantfiltrerad canonical data
```

OPS är master för kund, kundnummer, avtal, anläggningar, juridiska accepter,
fullmakter, dokument, status och OPS-ägda processflöden.

## Produktionsaktivering och readiness

En giltig API-nyckel är inte ensam ett bevis på att integrationen är klar för
produktion. OPS använder ett fail-closed go-live-flöde. Normal trafik släpps
först när samtliga canonical launch-bevis är verifierade:

1. API-klienten är aktiv och har rätt scopes/origins.
2. Tenantens publicerade avtal, juridik och obligatoriska driftberoenden är redo.
3. Provisioning smoke har verifierat credential och centrala routes.
4. En installation receipt är `completed`, har `completed_at` och SHA-256-bevis.
5. `launch_ready=true` och `launch_blockers=[]`.
6. Tenantens `api_sales` capability är `enabled=true` och `readiness_status=ready`.

Under en kontrollerad provisionering/revalidation kan API:t därför tillfälligt
returnera någon av följande 403-koder:

- `api_client_not_launch_ready` – API-klientens launch-verifiering är inte klar.
- `integration_receipt_not_verified` – canonical installation receipt är inte klar.
- `integration_capability_not_ready` – tenantens API-capability är inte redo.

Dessa fel ska inte lösas genom en retry-loop eller genom att en extern developer
skickar egna tenantfält. De kräver att Gridex-operatören färdigställer canonical
go-live/revalidation. Manuellt pausade eller revoked credentials återaktiveras
aldrig automatiskt. En credential som endast pausades av en canonical
readiness-migrering får återanvändas först efter ny receipt, smoke och readiness.

## Behörigheter

Varje endpoint kontrollerar scope server-side. Exempel på aktiva scopes:

### Website Integration API

- `integration_context.read`
- `website_contracts.read`
- `website_contracts.diagnostics`
- `website_energy_area.resolve`
- `website_market_prices.read`
- `website_quotes.write`
- `website_quotes.validate`
- `website_legal.read`
- `website_applications.write`
- `website_switch_status.read`
- `website_events.write`

### Customer Portal API

- `customer_profile.read`
- `customer_contracts.read`
- `customer_sites.read`
- `customer_invoices.read`
- `customer_metering.read`
- `customer_documents.read`
- `customer_legal.read`
- `customer_events.read`
- `customer_power_of_attorney.read`
- `customer_notifications.read`
- `customer_sync.write`
- `customer_contact.write`
- `customer_facility_data.write`
- `customer_power_of_attorney.write`
- `customer_notifications.write`

`customer_portal.read` och `customer_portal.write` är legacy-alias som kan
expanderas server-side under övergången. Nya integrationer ska använda de
granulära scopes som respektive OpenAPI-operation kräver.

## Verifiera tenantkontext

```http
GET /api/v1/integration/context
Authorization: Bearer ${GRIDEX_API_KEY}
Accept: application/json
```

Svaret innehåller en opak `tenant_reference`. Den är inte samma sak som internt
`company_id` och ska inte användas för att kringgå API-nyckelns tenantgräns.

## Publicerade avtal

```http
GET /api/v1/website/public-contracts?customer_type=private
Authorization: Bearer ${GRIDEX_API_KEY}
Accept: application/json
```

Detta är urvalsfeeden för tenantens hemsida. Klienten ska använda canonical
`offer_reference` och `price_option_reference` från svaret och aldrig konstruera
egna referenser.

Ett giltigt tomt svar är inte samma sak som ett integrationsfel. HTTP-status och
det canonical error-kuvertet ska alltid kontrolleras innan `data` renderas.

För felsökning kan en behörig serverintegration använda den dokumenterade
diagnostics-operationen med `website_contracts.diagnostics`. Intern diagnostik
ska inte visas direkt för slutkund.

## Elområde, marknadspris och quote

Tenantens backend ska använda OPS canonicala flöde:

1. resolve energy area,
2. verifiera `pricing_ready`/`quote_ready`,
3. hämta marknadsreferens när avtalsmodellen behöver den,
4. skapa OPS-ägd quote,
5. visa quote-resultatet utan att räkna om canonical prisdelar lokalt.

Historisk marknadsdata är inte slutlig settlementdata. Fakturering ska använda
de låsta `price_area` från quote-/avtalssnapshoten och annan canonical
settlementdata, aldrig ett nytt postnummeruppslag i efterhand.

## Kundansökan

```http
POST /api/v1/website/customer-applications
Authorization: Bearer ${GRIDEX_API_KEY}
Content-Type: application/json
Idempotency-Key: website-order-12345
```

Canonical `offer_reference`, `quote_reference` och `resolution_id` skickas
alltid top-level. Förenklat exempel:

```json
{
  "external_customer_id": "tenant-customer-001234",
  "offer_reference": "offer_...",
  "quote_reference": "quote_...",
  "resolution_id": "00000000-0000-4000-8000-000000000001",
  "price_option_reference": "price_option_...",
  "invoice_delivery_method": "email",
  "selected_component_references": [],
  "site_count": 1,
  "annual_consumption_kwh": 5000,
  "start_date": "2026-09-01",
  "customer": {
    "customer_type": "private",
    "first_name": "Anna",
    "last_name": "Andersson",
    "email": "customer@example.com",
    "phone": "+46700000000",
    "personal_number": "YYYYMMDDXXXX"
  },
  "site": {
    "facility_id": null,
    "street": "Exempelgatan 1",
    "postal_code": "21122",
    "city": "Malmö",
    "annual_consumption_kwh": 5000,
    "move_in_date": "2026-09-01",
    "current_supplier_name": "Nuvarande Leverantör AB",
    "current_supplier_org_number": "5560000000",
    "current_supplier_ediel_id": "12345"
  },
  "contract": {
    "requested_start_mode": "specific_date",
    "requested_start_date": "2026-09-01"
  },
  "legal_bundle_version": "<bundle-reference-from-ops>",
  "legal_acceptances": [
    {
      "requirement_code": "agreement",
      "document_reference": "<document-reference-from-ops>",
      "document_version": "<document-version-from-ops>",
      "document_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "accepted": true,
      "accepted_at": "2026-08-14T10:00:00Z"
    }
  ]
}
```

Ett accepterat svar betyder att canonical data har committats. Eftersteg körs
beständigt och asynkront. `next_step` kan därför vara `automatic_processing` och
OPS använder ett durable `customer_application_continuation`-jobb för nästa
steg. Tenantens requestlivstid styr aldrig leverantörsbyte, mail, Ediel eller
webhookleverans.

## Idempotency

`Idempotency-Key` är obligatorisk på dokumenterade write-operationer, bland
annat kundansökan och kundsync.

Viktiga konflikter:

- `idempotency_key_payload_mismatch` – samma nyckel med annan payload.
- `idempotency_in_progress` – första requesten pågår fortfarande.
- `duplicate_application` – samma committed ansökan skickas under ny nyckel.
- `application_business_in_progress` – samma affärshändelse behandlas redan.
- `application_business_conflict` – en aktiv/committed affärshändelse krockar.

Retry ska följa `retryable` i error-kuvertet. Generera inte automatiskt en ny
idempotency-nyckel för att kringgå en affärskonflikt.

## Mina sidor: kundidentifiering

Rekommenderad endpoint:

```http
POST /api/v1/customer/portal-bundle
Authorization: Bearer ${GRIDEX_API_KEY}
Content-Type: application/json
```

Tenant-neutralt exempel:

```json
{
  "email": "customer@example.com",
  "customer_number": "CUST-001234",
  "external_customer_id": "tenant-customer-001234"
}
```

OPS löser kunden inom API-nyckelns tenant. Stabil portal identity/auth-länkning
prioriteras före externa kundreferenser. En ensam e-postadress får inte användas
för att bryta tenant- eller identitetsgränser.

Kundresolvern måste länka portalidentiteten till rätt `company_id` och kund innan
kunddata lämnas ut. Interna UUID:n är inte en auktoriseringsmekanism.

Exempel på sanerat svar:

```json
{
  "data": {
    "profile": {
      "customer_number": "CUST-001234",
      "display_name": "Example Customer",
      "email": "customer@example.com"
    },
    "customer_status": {
      "code": "needs_facility_data",
      "supplier_switch": {
        "can_create_request": false,
        "can_dispatch": false,
        "blockers": [
          "missing_metering_point",
          "missing_grid_owner",
          "facility_not_verified"
        ],
        "next_action": "complete_application"
      }
    }
  }
}
```

Om flera kunder matchar en otillräcklig identifierare ska API:t fail-closed och
kräva starkare kundidentifiering i stället för att välja godtyckligt.

## Mina sidor: sub-endpoints

Exempel:

- `GET /api/v1/customer/me`
- `GET /api/v1/customer/contracts`
- `GET /api/v1/customer/sites`
- `GET /api/v1/customer/invoices`
- `GET /api/v1/customer/invoices/{id}`
- `GET /api/v1/customer/metering-values`
- `GET /api/v1/customer/documents`
- `GET /api/v1/customer/legal-acceptances`
- `GET /api/v1/customer/powers-of-attorney`
- `GET /api/v1/customer/events`
- `GET /api/v1/customer/notifications`

Exakta query/path/header-fält och scopes kommer från Customer Portal OpenAPI.

## Synk av kunddata, dokument och fullmakt

```http
POST /api/v1/customer/sync
Authorization: Bearer ${GRIDEX_API_KEY}
Content-Type: application/json
Idempotency-Key: tenant-sync-001234
```

Tenant-neutralt exempel:

```json
{
  "email": "customer@example.com",
  "customer_number": "CUST-001234",
  "external_customer_id": "tenant-customer-001234",
  "power_of_attorney": {
    "power_of_attorney_reference": "POA-example-reference",
    "document_reference": "legal_customer_document_...",
    "scope": ["supplier_switch", "facility_information_lookup"],
    "accepted": true,
    "accepted_at": "2026-08-14T10:00:00Z",
    "signer_name": "Example Customer",
    "signer_identity_number": "verified-identity-reference",
    "method": "bankid",
    "ip_address": "203.0.113.10",
    "user_agent": "Example client",
    "valid_from": "2026-08-14"
  },
  "legal_acceptances": [
    {
      "document_reference": "legal_customer_document_...",
      "document_code": "agreement",
      "document_version": "legal_customer_version_...",
      "document_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "accepted": true,
      "accepted_at": "2026-08-14T10:00:00Z"
    }
  ],
  "documents": [
    {
      "document_reference": "tenant-contract-001234",
      "document_type": "contract_confirmation",
      "title": "Avtalsbekräftelse",
      "secure_url": "https://tenant.example/documents/tenant-contract-001234.pdf"
    }
  ]
}
```

OPS ska spara exakt canonical evidens för fullmakt och juridiska accepter. En
fristående boolean är inte tillräcklig när en exakt version/hash krävs.

## Webhooks

Webhook är valfritt för statusleverans; polling är canonical fallback. En
production-webhook ska använda HTTPS och tenant-specifik signing secret.
Mottagaren ska verifiera signatur och timestamp innan payload parsas och spara
`event_id` idempotent innan affärslogik körs.

## Felmodell

API-fel returneras som JSON, aldrig HTML:

```json
{
  "error": {
    "code": "api_scope_missing",
    "message": "Begäran saknar nödvändigt scope.",
    "retryable": false,
    "field": null,
    "blockers": []
  },
  "request_id": "req_...",
  "correlation_id": "req_...",
  "contract_schema_version": "2026-08-10.1"
}
```

Centrala auth/readiness-koder:

- `missing_api_token` – 401
- `invalid_api_token` – 401
- `api_token_expired` – 403
- `api_client_inactive` – 403
- `api_client_not_launch_ready` – 403
- `integration_receipt_not_verified` – 403
- `integration_capability_not_ready` – 403
- `api_scope_missing` – 403
- `api_origin_not_allowed` – 403
- `api_ip_not_allowed` – 403
- `tenant_not_operationally_ready` – 403
- `tenant_paused` – 423
- `tenant_closed` – 410
- `rate_limited` – 429
- `platform_schema_not_ready` – 503
- `api_auth_unavailable` – 503

`request_id` och `correlation_id` ska sparas vid support/felsökning. Logga aldrig
API-token, secret hash, personnummer eller annan känslig payload i klientloggar.

## Säkerhetsregler för developers

- `GRIDEX_API_KEY` är server-side only.
- Låt API-nyckeln bestämma tenant; skicka aldrig egen `company_id`.
- Använd canonical referenser från OPS, inte interna databastabell-ID:n.
- Respektera scopes per operation.
- Respektera idempotency på writes.
- Bygg retry utifrån HTTP-status + `retryable`, inte blint på alla fel.
- Behandla readiness-403 som ett operatörs-/go-live-problem, inte som transient nätfel.
- Rendera aldrig intern diagnostics direkt för slutkund.
- Använd exakt publicerad juridiksnapshot från avtalet/quoten.
- Slutlig fakturering ska använda låst canonical settlementdata.

## Operatörens enkla go-live-flöde

Det här är ett OPS-operatörsflöde, inte något en extern developer ska emulera med
SQL eller egna statusuppdateringar.

```text
1. Välj bolag
2. Ange HTTPS-origin(s)
3. Ange tenantens HTTPS-URL till Mina sidor
4. Valfritt: konfigurera webhook + signing-secret reference
5. Kör canonical tenant website provision/revalidation
6. OPS återanvänder säkert befintlig canonical-readiness-paused credential eller skapar en ny
7. Provisioning smoke verifierar credential + centrala routes
8. OPS reconcilar capabilities/readiness
9. Receipt färdigställs med SHA-256-evidens
10. launch_ready blir true först när blockers är tomma
11. Ny token visas endast om en ny credential faktiskt skapades
```

En manuellt pausad, revoked, deleted eller tvetydig credential ska stoppa flödet
och kräva operatörsgranskning. Go-live får aldrig reduceras till
`UPDATE integration_api_clients SET status='active'`.

## Source of truth

Vid skillnad mellan exempeltext och maskinläsbart kontrakt gäller:

1. aktuell publicerad OpenAPI-version,
2. canonical runtime-kontraktet,
3. denna guide som förklarande text.

Dokumentation och runtime ska verifieras tillsammans i CI före release.
