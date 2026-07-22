# Gridex Customer Portal API

Publik onlineversion efter deploy: `/developers/customer-portal-api`.

Dokumentationsversion: `2026-07-20.2`.

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

## Kundens tecknade avtal

`GET /api/v1/customer/contracts` och portal bundle läser tenantens `customer_contracts`, inte website-endpointens säljerbjudanden. Varje modernt webbavtal kan innehålla `public_contract_offer_id`, `offer_reference`, `signed_at`, `withdrawal_deadline_at`, `signature_snapshot_sha256` och `legal_versions_snapshot`. Kundresolvern måste länka portalidentiteten till rätt `company_id` och `customer_id`; annars returneras ett tydligt identitetsfel i stället för andra kunders data.

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

### Portföljmetod och sanerad historik

`GET /api/v1/website/portfolio-prices?offer_reference=...&price_area=SE3`
kräver `website_contracts.read`. API-nyckeln bestämmer bolaget och
`offer_reference` bestämmer exakt publicerat portfölj-/mixavtal. Svaret innehåller endast:

- `method`: den publika avtalsmetoden utan interna portfölj- eller versions-ID:n;
- `historical_final_prices`: sanerade finala eller låsta historikrader med månad, elområde, belopp, enhet, momsstatus och status;
- `market_price_responsibility=tenant`;
- `calculator_market_price_supplied_by_ops=false`;
- `final_billing_rule=locked_settlement_only`.

Endpointen returnerar inga prognoser, manuella indikationer, marknadskällor, interna prisplansversions-ID:n, juridikpakets-ID:n, avräkningsrevisioner eller portfölj-ID:n. Historikraderna får inte användas som aktuellt marknadspris i tenantens publika kalkylator. Tenantens backend hämtar själv det marknadspris som används för en indikativ beräkning.

OPS fortsätter internt att använda exakt `delivery_month`, revision, prisplansversion och låst settlement vid faktisk avräkning och fakturering. Den interna modellen exponeras inte som tenantens publika marknadspriskälla.

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

## Fullständigt prisunderlag och tenantens kalkylator (`2026-07-22.2`)

Den aktiva integrationsordningen är:

1. `GET /api/v1/website/public-contracts` används för avtalsurval och som fullständigt maskinläsbart beräkningsunderlag.
2. Tenantens webbplats löser själv kundens prisområde och hämtar själv extern marknadsprisindikation för rörligt månads-, tim- och kvartspris.
3. Tenantens kalkylator kombinerar marknadspriset med OPS-publicerade påslag, avgifter, momsregler och förbrukning.
4. `POST /api/v1/website/customer-applications` tecknar direkt med samma `offer_reference`; OPS verifierar inskickat prisområde och låser publicerings-, pris-, avgifts- och juridikversion.

För fastprisavtal skickar OPS alltid det publicerade fasta priset per kWh. Fastpriset är alltid synligt för kunden och kan inte döljas av presentationsinställningen för ett fastprisavtal. Tenantens kalkylator använder det tillsammans med samtliga tillämpliga fasta och förbrukningsbaserade avgifter för att visa beräknad månads- och årskostnad.

`pricing.calculation_components` och kompatibilitetsfältet `pricing.components` innehåller **alla** tillämpliga pris- och avgiftskomponenter. En komponent med `website_visibility=hidden` eller `website_card_visible=false` får inte filtreras bort: den ska fortfarande skickas till tenantens backend och användas när `calculation_inclusion=included` eller dess villkor uppfylls. `pricing.display_components` är den separata listan över sådant som får visas som egna sälj-/avtalsrader.

För penningvärden gäller:

- `0` är ett giltigt publicerat numeriskt värde och betyder avgiftsfritt;
- blankt, `null` och `undefined` betyder inte automatiskt `0`;
- använd aldrig truthy/falsy-kontroller för pengar;
- kontrollera uttryckligen `value === null || value === undefined`.

OPS externa tenant-API returnerar inte Nord Pool-, spot-, tim- eller kvartsspotpris, interna spot-ID:n, marknadskällor eller fallbackkedjor. De tidigare rutterna `/api/v1/website/quote`, `/api/v1/website/quote/validate`, `/api/v1/website/energy-area/resolve` och `/api/public/energy-area` returnerar `410 Gone` från API `2026-07-22.2`.

`GET /api/v1/website/public-contracts?diagnostics=1` är tenant-scopad och visar readiness för publicering och kanoniska avgifter. Saknade eller motstridiga avgiftsvärden sätts aldrig automatiskt till `0`, utan hanteras versionssäkert med auditspår.

## Publication revision, cache och kanaler

`GET /api/v1/website/public-contracts` läser endast kanalen `website`. `internal` används av OPS och interna säljflöden. `api` är en separat partner-/serverkanal och ska inte automatiskt visas på hemsidan.

Varje publiceringsrelevant ändring höjer en tenant- och kanalbunden `publication_revision`. Feed-svaret returnerar revisionen i `meta` och som `ETag`. Skicka `If-None-Match`; oförändrad revision ger `304 Not Modified`. Externa kunder ska inte förlita sig på Next.js `revalidateTag` för cacheinvalidering.

API-nycklar är server-side secrets. `allowed_origins` är ett kompletterande driftfilter, inte en fullständig säkerhetsgräns för server-till-server-anrop. IP-regler accepterar exakta IPv4/IPv6-adresser och CIDR. Forwarding-headers betros automatiskt endast på Vercel (`VERCEL=1`); andra reverse proxies måste uttryckligen sätta `INTEGRATION_API_TRUST_PROXY_HEADERS=true` efter att de konfigurerats att skriva över klientens inkommande forwarding-headers. Vid avsaknad av en betrodd proxy failar aktiva IP-allowlists stängt.

## V1-deprecation

`offer_reference` är den enda canonical externa avtalsidentiteten. Aliasen `contract_offer_id`, `publication_reference` och toppnivåfältet `contracts` finns kvar i V1 men är deprecated. Nya klienter ska använda `data` och `offer_reference`. Aliasen tas tidigast bort i en framtida major-version efter publicerad sunset-period.

Nya publiceringar får en opak tenantoberoende referens i formatet `offer_<sha256>`. Redan publicerade referenser behålls exakt som de är eftersom de kan vara bundna till ansökningar, kundavtal, juridiska accepter och pris-snapshots. Klienten ska därför behandla värdet som en opak sträng och aldrig validera varumärke, UUID-format eller produktnamn lokalt.


API-svaret innehåller `contract_schema_version=2026-07-22.2` och headern `X-Gridex-Contract-Version`. Versionsvärdet ingår i ETag-underlaget så att klienter inte får `304 Not Modified` mot en äldre DTO när kontraktsrepresentationen ändras.
