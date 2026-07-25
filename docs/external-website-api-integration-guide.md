# Gridex OPS – extern websiteintegration

> **Canonical API-version: 2026-07-25.1**
>
> OPS är source of truth för publicerad produkt, elområdesresolution, quote, kundacceptans och det prisunderlag som låses på kundavtalet. Tenantens webb visar OPS data men skapar inte en parallell pris- eller områdessanning.

## 0. Tenantkonfiguration: en enda API-nyckel

Tenantens produktion ska endast konfigurera:

```env
GRIDEX_API_KEY=gridex_live_xxxxxxxxx
```

Följande är fasta delar av API-kontraktet och ska **inte** vara tenantens miljövariabler:

```text
API base URL: https://app.gridex.se/api/v1
quote_reference: top-level i kundansökan
resolution_id: top-level i kundansökan
Website OpenAPI: https://app.gridex.se/api/v1/openapi/website-integration-v1.json
Customer Portal OpenAPI: https://app.gridex.se/api/v1/openapi/customer-portal-v1.json
```

API-nyckeln avgör tenant, bolag och scopes. OpenAPI används för utveckling och typgenerering, aldrig som runtime-spärr. Tenantens webb ska därför inte ha separata miljövariabler för payloadläge, company-ID, tenantreferens, tenant-ID eller OpenAPI-sökväg.

## 1. Autentisering och tenantkontext

Frontend får aldrig anropa OPS direkt med API-nyckel. Tenantens server ska aldrig skicka ett fritt `company_id`; OPS härleder tenant och bolag från nyckeln.

Alla anrop görs server-side med tenantens API-nyckel:

```http
Authorization: Bearer ${GRIDEX_API_KEY}
```

Verifiera nyckelns opaka tenantreferens:

```http
GET /api/v1/integration/context
Scope: integration_context.read
```

Skicka aldrig internt `company_id`, `tenant_id` eller databas-UUID som tenantväljare. Alla resolutioner, quotes, ansökningar och idempotensposter binds till API-nyckelns tenant.

UUID-fält som `customer_id`, `application_id`, `contract_id` och `resolution_id`
är dokumenterade, opaka och tenantbundna publika resurs-ID:n. De ger aldrig
behörighet i sig. Interna prisplans-, publicerings-, portalidentitets- och
provider-ID:n returneras inte. Se [Public API ID policy](./public-api-id-policy.md).

## 2. Canonical ordning

```text
GET public-contracts
→ POST energy-area/resolve
→ POST quote
→ POST quote/validate
→ POST customer-applications
→ status/portal
```

En kundansökan utan canonical `quote_reference` och samma `resolution_id` avvisas. Klienten får inte hoppa direkt från produktfeed till avtal.

## 3. Hämta publicerade avtal

```http
GET /api/v1/website/public-contracts?customer_type=private
Scope: website_contracts.read
```

Canonical kundtyper är `private` och `business`. Aliaset `company` normaliseras till `business` under dokumenterad övergångsperiod.

Feedens ETag är bunden till `tenant + channel + contract_schema_version`. Skicka `If-None-Match`; oförändrad feed ger `304 Not Modified`.

### En fastprisprodukt med flera områdesrader

Ett fastprisavtal publiceras en gång. SE1–SE4 är prisrader under samma produktversion och `offer_reference`:

```json
{
  "offer_reference": "offer_...",
  "contract_type": "fixed",
  "area_pricing": [
    { "price_area": "SE1", "energy_price_ore_per_kwh": 112 },
    { "price_area": "SE2", "energy_price_ore_per_kwh": 115 },
    { "price_area": "SE3", "energy_price_ore_per_kwh": 128 },
    { "price_area": "SE4", "energy_price_ore_per_kwh": 140 }
  ],
  "pricing": {
    "calculation_components": [
      {
        "component_code": "monthly_fee",
        "amount": 49,
        "unit": "sek_month",
        "calculation_inclusion": "included",
        "website_visibility": "visible"
      },
      {
        "component_code": "invoice_fee",
        "amount": 19,
        "unit": "sek_invoice",
        "calculation_inclusion": "included",
        "website_visibility": "summary_only"
      }
    ]
  }
}
```

`calculation_components` innehåller alla publicerade pris- och avgiftsvillkor, även dolda komponenter. Dolda komponenter filtreras inte bort från kalkylunderlaget: en rad med `website_visibility=hidden` ska fortfarande ingå när `calculation_inclusion=included`. `display_components` styr endast presentation. Produktfeeden är inte en ersättning för kundens canonical quote.

## 4. Lös elområdet

```http
POST /api/v1/website/energy-area/resolve
Scope: website_energy_area.resolve
Content-Type: application/json
```

```json
{
  "street": "Storgatan 1",
  "postal_code": "21122",
  "city": "Malmö",
  "grid_area_code": "MALMO-CLAIM",
  "facility_id": "optional",
  "metering_point_id": "optional"
}
```

`grid_area_code` är ett klientpåstående. När adress och kod finns korsvaliderar OPS dem mot canonical geodata. Påstående och adress som inte matchar ger:

```json
{
  "error": {
    "code": "grid_area_address_mismatch",
    "message": "Adress och påstått nätområde motsäger varandra."
  }
}
```

Ett lyckat svar innehåller minst:

```json
{
  "data": {
    "resolution_id": "uuid",
    "price_area": "SE4",
    "grid_area_code": "...",
    "grid_owner_name": "Exempel Nät AB",
    "confidence": 0.98,
    "resolution_status": "grid_area_master_validated",
    "capabilities": {
      "pricing_ready": true,
      "quote_ready": true,
      "facility_lookup_ready": true,
      "switch_request_creatable": true,
      "switch_dispatch_ready": false
    },
    "blockers": {
      "pricing": [],
      "quote": [],
      "facility_lookup": [],
      "switch_creation": [],
      "switch_dispatch": [
        {
          "code": "switch_context_required",
          "message": "Dispatch kräver kundspecifik fullmakt, route och transportkonfiguration.",
          "retryable": false
        }
      ]
    },
    "resolver_version": "energy-resolver-v2",
    "geodata_version": "svk_arcgis:...",
    "resolved_at": "2026-07-24T13:30:00+02:00",
    "expires_at": "2026-07-25T13:30:00+02:00"
  }
}
```

Resolutionen är tenantbunden och tidsbegränsad. Pris- och quote-readiness är oberoende av PRODAT-transport. Gammal geodata, låg confidence eller konflikt blockerar bara de capabilities som faktiskt påverkas.

SVK-geometrin är versionsstyrd. En ny polygonuppsättning blir aktiv först efter fullständig staging, coveragekontroll och atomisk promotion. `geodata_version` identifierar exakt vilken verifierad geodataversion som användes, och polygoner som saknas i en ny version inaktiveras i samma transaktion.

## 5. Skapa quote

```http
POST /api/v1/website/quote
Scope: website_quotes.write
```

```json
{
  "resolution_id": "uuid",
  "offer_reference": "offer_...",
  "annual_consumption_kwh": 12000,
  "customer_type": "private",
  "start_date": "2026-09-01"
}
```

`price_area` behöver inte skickas. Skickas det ändå behandlas det som ett påstående. Om det motsäger resolutionen returnerar OPS `409 price_area_mismatch` eller `409 quote_resolution_mismatch`; klientvärdet skriver aldrig över resolutionen.

OPS quoten låser:

- publicerad produkt- och publiceringsversion;
- vald SE-områdesrad;
- avgifter, rabatter och momsmodell;
- resolver- och geodataversion;
- indikativ marknadsreferens för rörliga avtal;
- beräkningsantaganden och giltighetstid;
- SHA-256-hash över immutable quote-snapshot.

### Indikativ marknadsreferens

För rörligt månads-, tim- och kvartspris kan quoten innehålla:

```json
{
  "market_reference": {
    "provider": "elprisetjustnu",
    "price_area": "SE4",
    "reference_type": "preview",
    "reference_period": "rolling_30_days",
    "period_start": "2026-06-25",
    "period_end": "2026-07-24",
    "as_of": "2026-07-24T13:30:00+02:00",
    "source_currency": "SEK",
    "unit": "sek_per_kwh",
    "includes_vat": false,
    "includes_supplier_fees": false,
    "includes_grid_fees": false,
    "is_indicative": true,
    "is_stale": false,
    "fallback_used": false
  }
}
```

Tenant får visa quoten men får inte bygga om energipris, påslag, avgifter, rabatt, moms eller prisområde. Preview är aldrig slutligt settlementpris.

### Freshness och fallback

Preview väljs i denna ordning:

1. färsk providerdata;
2. färsk OPS-cache;
3. senast verifierad preview inom tenantens tillåtna maxålder;
4. inget pris.

Fallback anges med `fallback_used`, `fallback_reason` och `is_stale`. Quote blockeras när affärens freshnesskrav inte uppfylls. OPS hittar aldrig på ett pris, byter aldrig SE-område och använder inte settlement som om det vore livepris.

## 6. Validera quote

```http
POST /api/v1/website/quote/validate
Scope: website_quotes.validate
```

Skicka samma `quote_reference`, `resolution_id`, `offer_reference`, kundtyp, förbrukning och startdatum som ska tecknas. OPS kontrollerar tenant, expiry, hash, publicerad version och resolution. Manipulation eller mismatch ger stabil maskinläsbar felkod.

## 7. Skicka kundansökan

```http
POST /api/v1/website/customer-applications
Scope: website_applications.write
Idempotency-Key: required
```

```json
{
  "external_customer_id": "CUSTOMER-12345",
  "offer_reference": "offer_...",
  "quote_reference": "quote_...",
  "resolution_id": "uuid",
  "annual_consumption_kwh": 5000,
  "start_date": "2026-09-01",
  "customer": {
    "customer_type": "private",
    "first_name": "Anna",
    "last_name": "Andersson",
    "email": "anna@example.se",
    "personal_number": "YYYYMMDDXXXX"
  },
  "site": {
    "street": "Storgatan 1",
    "postal_code": "21122",
    "city": "Malmö",
    "annual_consumption_kwh": 5000,
    "move_in_date": "2026-09-01"
  },
  "contract": {
    "requested_start_mode": "specific_date",
    "requested_start_date": "2026-09-01"
  },
  "consents": {
    "terms": true,
    "privacy_policy": true,
    "withdrawal": true,
    "power_of_attorney": true,
    "price_terms": true
  },
  "powerOfAttorney": {
    "accepted": true,
    "scope": [
      "supplier_switch",
      "facility_information_lookup"
    ],
    "signerName": "Anna Andersson",
    "signerIdentityNumber": "YYYYMMDDXXXX",
    "method": "website_acceptance",
    "acceptedAt": "2026-07-24T10:30:00+02:00",
    "textVersionId": "uuid-från-publicerat-legal-bundle",
    "ipAddress": "203.0.113.10",
    "userAgent": "Mozilla/5.0"
  }
}
```

`offer_reference`, `quote_reference` och `resolution_id` ligger alltid på requestens top-level. `contract` innehåller endast kompletterande avtalsuppgifter. `quote_reference` och `resolution_id` måste matcha den validerade quoten. Dubbel submit med samma idempotency key och samma request hash returnerar samma canonicala kund-, site-, mätpunkts- och avtals-ID:n.

OPS använder samma tenantbundna kundmatchning i alla intakekanaler. Organisationsnummer eller verifierat personnummer väger starkare än e-post. E-post ensam slår inte automatiskt ihop osäker identitet.

Använd de canonicala fälten `customer.personal_number` för privatkund och `customer.org_number` för företagskund. Under en övergångsperiod normaliserar API:t även identitetsalias som `personal_identity_number`, `personalIdentityNumber`, `identity_number`, `personnummer`, `organization_number`, `organisation_number`, `organisationsnummer` och `orgnr`, men nya integrationer ska alltid skicka de canonicala fälten.

`consents.power_of_attorney=true` registrerar den juridiska acceptansen, men räcker inte ensam för automatisk kommunikation med nätägaren. När fullmakt krävs ska tenant även skicka den strukturerade `powerOfAttorney`-modellen med signerande namn, signerande identitet, metod, exakt scope och publicerat `textVersionId`. OPS blockerar nätägarutskick om fullmakten inte är `externally_sendable`.

Ett accepterat svar betyder att OPS har committat kund, anläggning, avtal, juridik och ett persistent fortsättningsjobb. Därefter äger OPS hela processen. Tenant ska inte själv skicka nätägarbegäran, skapa Z01/Z03, starta leverantörsbyte eller skicka juridiska avtalsmail.

Exempel på accepterat svar:

```json
{
  "data": {
    "application_id": "uuid",
    "customer_id": "uuid",
    "customer_number": "DX-123456",
    "site_id": "uuid",
    "contract_id": "uuid",
    "workflow_id": "uuid",
    "status": "accepted",
    "workflow_state": "canonical_data_committed",
    "next_step": "automatic_processing",
    "missing_fields": [],
    "blocking_reasons": [],
    "supplier_switch": {
      "request_id": null,
      "status": "not_created",
      "can_create_request": true,
      "can_dispatch": false,
      "blockers": [],
      "next_action": "create_supplier_switch_request"
    }
  },
  "request_id": "uuid",
  "correlation_id": "uuid"
}
```

Tenant kan följa samma process utan interna OPS-tillstånd via:

```http
GET /api/v1/website/customer-applications/{application_id}
Scope: website_switch_status.read
```

Externa statusar är `accepted`, `processing`, `needs_customer_information`, `completed`, `rejected` och `failed`.

## 8. Avtal och fakturering

Vid acceptans sparas en immutable pricing snapshot med:

- quote-ID och quote-hash;
- produkt-, publicerings-, prisplans- och juridikversion;
- price area och area pricing row;
- avgifter, rabatter och momsmodell;
- resolver- och geodataversion;
- marknadsreferensens provenance;
- bindningstid, uppsägningstid, juridiska accepter och kanal.

Fakturering läser kundavtalets snapshot, faktisk förbrukning och separat verifierad/explicit låst settlementperiod. Den läser inte dagens publicerade produktpris och använder aldrig preview som slutpris.

## 9. Leverantörsbyte

När anläggningsuppgifter saknas fortsätter samma idempotenta process med `request_site_information`. När canonical mätpunkt, fullmakt, avtal och route-readiness är kompletta fortsätter samma process-ID med `supplier_switch`. `needs_review` skapar inte en ny parallell process vid retry. OPS väljer exakt ett nästa huvudsteg; Z01 och Z03 startas inte som konkurrerande parallella flöden.

## 10. Felkoder

Centrala felkoder:

```text
energy_area_unresolved
energy_area_needs_review
grid_area_address_mismatch
resolution_not_found
resolution_tenant_mismatch
resolution_expired
resolution_pricing_not_ready
resolution_quote_not_ready
resolution_facility_lookup_not_ready
resolution_switch_not_ready
price_area_mismatch
market_price_unavailable
market_price_stale
market_price_incomplete
market_price_provider_unavailable
quote_expired
quote_reference_mismatch
quote_resolution_mismatch
idempotency_conflict
facility_information_required
prodat_route_not_ready
```

Fel innehåller HTTP-status, `error.code`, kundtext, fält, `request_id`/correlation ID och där det är relevant retryability eller detaljer.

## 11. Scopes

```text
integration_context.read
website_contracts.read
website_energy_area.resolve
website_quotes.write
website_quotes.validate
website_legal.read
website_applications.write
website_switch_status.read
```

## 12. Diagnostics, cache och dokumentation

```http
GET /api/v1/website/public-contracts/diagnostics
Scope: website_contracts.diagnostics
```

Publication-event: `contracts.publication.changed`. När revisionen ändras invalidierar tenantens backend sin cache och hämtar feeden igen med ETag.

Publika OpenAPI-kontrakt:

```text
https://app.gridex.se/api/v1/openapi/website-integration-v1.json
https://app.gridex.se/api/v1/openapi/customer-portal-v1.json
```

Filerna kan hämtas i CI för typgenerering men får inte hämtas som ett krav när tenantens applikation startar. Publik utvecklarsida: `https://app.gridex.se/developers/customer-portal-api`.

API-svaret innehåller `contract_schema_version=2026-07-25.1` och headern `X-Gridex-Contract-Version`.

## Canonical marknadsprisflöde i API 2026-07-25.1

Det finns tre separata operationer:

| Operation | Syfte | Aktuellt spotpris | Komplett kundpris |
|---|---|---:|---:|
| `GET /api/v1/website/public-contracts` | Produkt- och urvalsfeed | Nej | Nej |
| `POST /api/v1/website/market-price/current` | Aktuellt marknadsintervall | Ja | Nej |
| `POST /api/v1/website/quote` | Canonical kundkalkyl | Som `market_reference` | Ja |

`resolution_id` från `POST /api/v1/website/energy-area/resolve` är alltid styrande för SE1–SE4. Ett frivilligt `price_area` är endast en assertion och ger `409 price_area_mismatch` om det motsäger resolutionen. Tenant ska aldrig mappa postnummer lokalt eller skicka `company_id`.

`market-price/current` kräver scope `website_market_prices.read` och returnerar det intervall där `time_start <= now < time_end`. Priset är exklusive moms, leverantörsavgifter, energiskatt och elnätsavgifter. Det får inte användas som komplett kundpris eller settlement.

En rörlig quote returnerar ett självbärande `market_reference` med:

- `price_sek_per_kwh` och `price_ore_per_kwh`;
- `price_ex_vat_sek_per_kwh` och `price_ex_vat_ore_per_kwh`;
- `requested_days` och `included_days`;
- `source_as_of`, `generated_at`, `stale_after` och `effective_stale_at`;
- `fallback_used` och `fallback_reason`.

`source_as_of` kommer från underliggande provider-evidens. `generated_at` är endast när beräkningen kördes. En omberäkning med oförändrad `source_checksum` får inte ge artificiellt ny freshness.

Om tenantens policy har `allow_indicative_latest=false` returneras inte en partiell fallback. OPS returnerar i stället `409 market_reference_window_incomplete` med `requested_days` och `included_days` i `details`.

### Felkoder för aktuellt marknadspris

| HTTP | Kod | Retryable | Tenantens åtgärd |
|---:|---|:---:|---|
| 400 | `invalid_request` | Nej | Rätta request enligt OpenAPI. |
| 401 | `invalid_api_key` | Nej | Använd den aktiva Gridex API-nyckeln. |
| 403 | `missing_scope` | Nej | Lägg till `website_market_prices.read` på API-klienten. |
| 404 | `resolution_not_found` | Nej | Kör områdesresolution på nytt inom samma tenant. |
| 409 | `resolution_expired` | Nej | Skapa en ny `resolution_id`. |
| 409 | `resolution_pricing_not_ready` | Nej | Kör resolvern igen eller åtgärda blockeraren i `blockers.pricing`. PRODAT-readiness påverkar inte priset. |
| 409 | `price_area_mismatch` | Nej | Ta bort lokalt område och använd resolutionens område. |
| 409 | `market_price_stale` | Ja | Försök igen efter att OPS-importen har uppdaterats. Räkna inte lokalt. |
| 429 | `rate_limited` | Ja | Använd backoff och respektera rate-limit headers. |
| 503 | `current_market_price_unavailable` | Ja | Försök igen; behåll föregående visning endast om produktens UX-policy tillåter det. |
| 500 | `market_price_provider_unavailable` | Ja | Försök igen och använd `request_id` vid support. |

Alla fel returnerar `error.code`, `error.message`, `error.field`, `error.request_id`, `error.correlation_id`, `error.retryable` och top-level `request_id`. Tenant ska aldrig ersätta ett marknadsprisfel med en egen prisberäkning.
