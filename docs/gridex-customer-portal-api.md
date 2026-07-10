# Gridex Customer Portal API

Publik onlineversion efter deploy: `/developers/customer-portal-api`.

## Grundmodell

Tenantens hemsida/Mina sidor äger inloggningssessionen. OPS är master för kund, kundnummer, avtal, anläggningar, fullmakter, juridiska godkännanden, dokument, status och processflöden.

Flödet ska vara:

```text
Tenant Mina sidor → tenant server route → OPS API → OPS company_id från API-nyckel → kundresolver → OPS masterdata → tenant UI
```

Frontend får aldrig anropa OPS direkt med API-nyckel och får aldrig skicka ett fritt `company_id`.

## Portal bundle payload

Rekommenderad endpoint:

```http
POST /api/v1/customer/portal-bundle
Authorization: Bearer YOUR_GRIDEX_API_TOKEN
Content-Type: application/json
```

Payload ska innehålla så många stabila kundnycklar som möjligt:

```json
{
  "email": "heke99@live.se",
  "customer_number": "DX-100023",
  "external_customer_id": "GRIDEX-WEB-20260616-8191257d-88d3-4929-ab02-1d3ca5ed986f"
}
```

OPS löser kund inom API-nyckelns tenant i denna ordning:

1. länkad portal identity/account (när `x-gridex-customer-portal-user-id` / `x-gridex-auth-user-id` skickas)
2. `external_customer_id`
3. `customer_number`
4. unik `email`

Identifierare kan skickas som JSON-body (POST `portal-bundle` och `sync`) eller som
headers/query (GET-endpoints och övriga POST-subrutter), t.ex.
`x-gridex-external-customer-id`, `x-gridex-customer-number`, `x-gridex-customer-email`.

Om flera kunder matchar samma e-post returneras `409 ambiguous_customer_match` och tenant ska skicka `customer_number` eller `external_customer_id`.

### Query-parametrar (portal-bundle)

- `summary=true` – returnerar endast profil/status/datakvalitet
- `include=contracts,sites,invoices,...` – begränsar vilka sektioner som laddas
- `metering_values_limit`, `documents_limit`, `events_limit` – begränsar radantal per sektion

## Portal bundle response

```json
{
  "data": {
    "profile": {
      "customer_number": "DX-100023",
      "display_name": "Hekmat Hourani",
      "email": "heke99@live.se"
    },
    "customer_status": {
      "code": "needs_facility_data",
      "label": "Ansökan behandlas",
      "message": "Vi behöver komplettera anläggningsuppgifter innan leverantörsbytet kan starta.",
      "can_start_switch": false
    },
    "data_quality": {
      "status": "needs_action",
      "issues": ["missing_metering_point", "missing_grid_owner", "facility_not_verified"]
    }
  }
}
```

Det fullständiga svaret innehåller även `customer`, `contracts`, `sites`,
`metering_points`, `invoices`, `metering_values`, `documents`,
`legal_acceptances`, `powers_of_attorney`, `notifications`, `events`,
`website_applications` och `bundle_status`. Vid delvis fel returneras 200 med
tomma sektioner och `bundle_status.status = "partial"` (aldrig en HTML-sida).

### Sub-endpoints

Samtliga kräver `customer_portal.read` (GET) och identifierare via headers/query:

- `GET /api/v1/customer/me`
- `GET /api/v1/customer/contracts`
- `GET /api/v1/customer/sites`
- `GET /api/v1/customer/invoices`
- `GET /api/v1/customer/invoices/{id}` – faller tillbaka till `invoice_export_items`/`pricing_runs` om ingen `customer_invoices`-rad finns
- `GET /api/v1/customer/metering-values?from=&to=&facility_id=&limit=`
- `GET /api/v1/customer/documents`
- `GET /api/v1/customer/legal-acceptances`
- `GET /api/v1/customer/powers-of-attorney`
- `GET /api/v1/customer/events`, `GET /api/v1/customer/notifications`

Skriv-endpoints (`POST /sync`, `/profile-update`, `/move-out`, `/notifications/read`) kräver `customer_portal.write`.

## Dokument, fullmakt och juridiska godkännanden

Tenant ska skicka godkända fullmakter, juridiska godkännanden och dokument till OPS så OPS kan starta rätt processer.

```http
POST /api/v1/customer/sync
Authorization: Bearer YOUR_GRIDEX_API_TOKEN
Content-Type: application/json
```

> `Idempotency-Key`-headern är valfri och utvärderas för närvarande inte av
> `/sync`. Endpointen är i sig idempotent: OPS härleder stabila nycklar per
> kund/typ/referens (`tenant-sync:{client}:{customer}:{type}:{ref}`) och gör
> upserts, så att skicka samma payload flera gånger skapar inte dubbletter.

```json
{
  "email": "heke99@live.se",
  "customer_number": "DX-100023",
  "external_customer_id": "GRIDEX-WEB-20260616-8191257d-88d3-4929-ab02-1d3ca5ed986f",
  "power_of_attorney": {
    "scope": "supplier_switch",
    "status": "signed",
    "signed_at": "2026-06-16T15:10:12.647Z",
    "legal_text_version": "2026-06-12-v1",
    "reference": "POA-39e9fbc4-2c94-46fb-a1ee-49d18cb0932a",
    "document": {
      "external_document_id": "tenant-doc-123",
      "document_type": "power_of_attorney",
      "title": "Signerad fullmakt",
      "file_url": "https://tenant.se/documents/tenant-doc-123.pdf"
    }
  },
  "legal_acceptances": [
    { "acceptance_type": "terms", "legal_text_version": "2026-06-12-v1", "accepted_at": "2026-06-16T15:10:12.647Z" },
    { "acceptance_type": "privacy_policy", "legal_text_version": "2026-06-12-v1", "accepted_at": "2026-06-16T15:10:12.647Z" },
    { "acceptance_type": "price_snapshot", "legal_text_version": "2026-06-12-v1", "accepted_at": "2026-06-16T15:10:12.647Z" }
  ],
  "documents": [
    {
      "external_document_id": "tenant-contract-123",
      "document_type": "contract_confirmation",
      "title": "Avtalsbekräftelse",
      "file_url": "https://tenant.se/documents/tenant-contract-123.pdf"
    }
  ]
}
```

OPS sparar:

- fullmakt i `powers_of_attorney`
- juridiska godkännanden i `customer_legal_acceptances`
- dokument i `customer_documents`
- processhändelser som domain events/webhooks

Om anläggningsinfo saknas ska OPS visa `needs_facility_data` och blockera switch tills mätpunkt/nätägare är verifierade.

## Website customer applications

```http
POST /api/v1/website/customer-applications
Authorization: Bearer YOUR_GRIDEX_API_TOKEN
Content-Type: application/json
Idempotency-Key: website-order-12345
```

`Idempotency-Key` är obligatorisk för denna endpoint. Den ska vara 8–200 tecken och får innehålla bokstäver, siffror, punkt, understreck, kolon, plus, tilde och bindestreck. Nyckeln reserveras innan kund/site/avtal/fullmakt skapas, vilket stoppar samtidiga dubletter.

### Idempotency-regler

- samma nyckel + exakt samma normaliserade payload: replay av den committed responsen
- samma nyckel + annan payload: `409 idempotency_key_payload_mismatch`
- samma nyckel medan första requesten behandlas: `409 idempotency_in_progress`
- identisk committed ansökan med ny nyckel: `409 duplicate_application`
- samma externa kund + anläggning + erbjudande + startdatum behandlas redan under annan nyckel: `409 application_business_in_progress`
- samma externa kund + anläggning + erbjudande + startdatum har redan en aktiv/committed ansökan: `409 application_business_conflict`
- tidigare misslyckat/partiellt försök: `409 idempotent_failed` om det inte är ett uttryckligen retrybart tekniskt site-provisioneringsfel
- replay innehåller samma `warnings` och sparade `communication`-snapshot som originalet

Använd alltså inte samma nyckel för en rättad eller affärsmässigt ändrad payload. En ny affärshändelse ska ha en ny nyckel och ett annat affärs-ID (annan anläggning, annat erbjudande eller annat startdatum). Komplettering av en redan committed ansökan ska göras på befintlig ansökan; API:t skapar inte en parallell site/contract/POA/switch-kedja.

### Startdatum och fältvalidering

`requested_start_mode` accepterar:

- `earliest_possible`
- `specific_date`

Datumfält ska vara verkliga kalenderdatum i `YYYY-MM-DD`. `powerOfAttorney.acceptedAt` ska vara en ISO 8601-tidsstämpel. Okända eller felplacerade top-level- och nested-fält ger `422 unknown_field` och ignoreras inte tyst.

### Nuvarande leverantör och switchstatus

Nuvarande leverantör kan skickas på `site` (eller motsvarande dokumenterade top-level-alias):

```json
{
  "site": {
    "current_supplier_id": "uuid-or-null",
    "current_supplier_name": "Nuvarande Energi AB",
    "current_supplier_org_number": "5560000000",
    "current_supplier_ediel_id": "12345",
    "current_supplier_unknown": false,
    "current_supplier_contract_status": "active",
    "current_supplier_contract_end_date": "2026-08-31",
    "current_supplier_notice_period": "1 month",
    "current_supplier_termination_fee": 0,
    "current_supplier_response_status": "confirmed"
  }
}
```

Svaret skiljer på:

- `can_create_supplier_switch_request`: tillräckligt underlag för att skapa en durable switchrad
- `can_dispatch_supplier_switch`: switchen får gå vidare till route/preflight/EDIEL
- `supplier_switch_status`: exempelvis `created`, `already_open` eller `pending_review`
- `supplier_switch_blockers`: konkreta affärsblockerare

När exempelvis `current_supplier_missing` kompletteras återanvänds den öppna switchraden, dess hanterade affärsblockering rensas och status sätts tillbaka till `queued`. Om switchraden ännu inte finns kan reconcile skapa den när site, mätpunkt och signerad fullmakt blivit kompletta. Separata juridiska/livscykelblockeringar rensas inte automatiskt. `current_supplier_ediel_id` snapshotas både på `customer_sites` och `supplier_switch_requests`.

## Scopes

Alla customer-portal-rutter upprätthåller idag `customer_portal.read` (läs) och
`customer_portal.write` (skriv). De finare scopes nedan är reserverade/planerade
och kontrolleras ännu inte per rutt — ge `customer_portal.read`/`.write` (eller
`*`) till nyckeln tills vidare.

- `customer_portal.read` – hämta Mina sidor-data
- `customer_portal.write` – skicka kompletteringar/sync, profil, move-out, notisläsning
- `customer_documents.read/write` – (planerat) dokument
- `customer_notifications.read/write` – (planerat) notiser
- `customer_facility_data.write` – (planerat) anläggningskomplettering
- `customer_power_of_attorney.write` – (planerat) fullmakt
- `events.read` och `website_events.write` – händelser

## Felkoder

Fel returneras alltid som JSON `{ "error": "...", "code": "..." }`, aldrig som HTML.

- `401 missing_api_token` / `401 invalid_api_token` / `401 api_token_expired`
- `403 api_scope_missing` / `403 api_ip_not_allowed` / `403 api_origin_not_allowed`
- `403 customer_portal_link_requires_sync` (första länkningen kräver två matchande nycklar eller en tidigare länk)
- `404 customer_not_found` / `404 invoice_not_found`
- `409 ambiguous_customer_match`
- `400 idempotency_key_required` / `400 idempotency_key_invalid`
- `409 idempotency_key_payload_mismatch` / `409 idempotency_in_progress`
- `409 duplicate_application` / `409 application_business_in_progress` / `409 application_business_conflict` / `409 idempotent_failed`
- `422 requested_start_mode_invalid` / `422 date_invalid` / `422 timestamp_invalid` / `422 unknown_field`
- `422 missing_customer_identifier`
- `429 rate_limited`
- `500 customer_portal_internal_error`
- `503 customer_portal_schema_missing`
