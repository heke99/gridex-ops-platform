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

### Portföljmetod, historik och indikation

`GET /api/v1/website/portfolio-prices?offer_reference=...&price_area=SE3`
kräver `website_contracts.read`. API-nyckeln bestämmer bolaget och
`offer_reference` bestämmer exakt publicerat portfölj-/mixavtal. Svaret skiljer
alltid på:

- `method`: låst avtalsmetod, portfölj, andelar, avgift och avräkningstidpunkt
- `historical_final_prices`: finala eller låsta revisioner för exakt
  prisplansversion, månad och elområde
- `indications`: sparade prognoser/manuella indikationer med
  `estimate_source`, `estimate_month`, `estimate_price_ore_per_kwh`,
  `estimate_generated_at` och `non_binding=true`
- `final_billing_rule=locked_settlement_only`: estimat och historiska
  fallbackvärden får aldrig användas i slutlig fakturering

Ett framtida faktiskt portföljpris är varken publiceringskrav eller avtalskrav.
Saknas en explicit indikation returneras ingen siffra; systemet gissar inte.

OPS-avräkningen använder `delivery_month`, `revision_no`, exakt
`price_plan_version_id` och statusflödet
`draft → calculated → reviewed → final → locked`. Rättelser skapar alltid en
ny revision. Portföljadministration är inte en publik API-scope: de separata
`portfolio_settlement.*`-behörigheterna är default-deny, tenant-/portföljscopade
och kan bara tilldelas av `platform_superadmin`.

```http
POST /api/v1/website/customer-applications
Authorization: Bearer YOUR_GRIDEX_API_TOKEN
Content-Type: application/json
Idempotency-Key: website-order-12345
```

`Idempotency-Key` är obligatorisk för denna endpoint. Den ska vara 8–200 tecken och får innehålla bokstäver, siffror, punkt, understreck, kolon, plus, tilde och bindestreck. Nyckeln reserveras innan kund/site/avtal/fullmakt skapas, vilket stoppar samtidiga dubletter.

### Publiceringsdiagnostik och signeringsrespons

- `GET /api/v1/website/public-contracts/diagnostics?customer_type=private` returnerar tenant-scopade publiceringsblockerare för server-side felsökning och kräver `website_contracts.diagnostics`.
- `offer_reference` är enda avtalsväljaren. Motstridiga legacyfält ger `422 offer_reference_mismatch`.
- Efter lyckad serververifiering returneras `contract_status = signed`, `signed_at`, `withdrawal_deadline_at` och `signature_snapshot_sha256`.
- `signature_snapshot_sha256` är SHA-256 över OPS frysta signeringssnapshot och genereras endast av servern.
- `can_send_agreement_confirmation` visar att hela den databasdrivna, exakt
  erbjudandebundna dokumentuppsättningen har accepterats och att
  avtalsbekräftelsen får köas. Antalet varierar med kundtyp, produkt,
  prismodell, kanal och fullmaktskrav. Fältet är oberoende av
  `can_start_switch`.

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

## Kanoniskt fakturaavgifts- och quote-kontrakt (`2026-07-20.2`)

Den bindande integrationsordningen är:

1. `GET /api/v1/website/public-contracts` används för avtalskort, urval, marknadstext, kundtyp, juridiska länkar och `offer_reference`.
2. `POST /api/v1/website/quote` används för all faktisk prisberäkning från exakt låst prisversion.
3. `POST /api/v1/website/customer-applications` tecknar samma `offer_reference` och exakt publicerings-/prisversion.

`public-contracts` är ett presentations-API. En prisdel kan vara `null` eller saknas i kortets `pricing.components` när `website_card_visible=false`, men den kan fortfarande vara en verklig debiteringskomponent. Dolda komponenter ingår därför fortsatt i quote, checkout, avtalsdokument, låst avtalssnapshot och fakturering. Tenantens frontend får inte återskapa totalsumman från kort-DTO:n.

För penningvärden gäller:

- `0` är ett giltigt publicerat numeriskt värde och betyder avgiftsfritt;
- blankt, `null` och `undefined` betyder inte automatiskt `0`;
- använd aldrig truthy/falsy-kontroller för pengar;
- kontrollera uttryckligen `value === null || value === undefined`.

Quote-requesten kräver `offer_reference`, `price_area`, `annual_consumption_kwh > 0` och `start_date` i formatet `YYYY-MM-DD`. `customer_type` får, när det anges, endast vara `private` eller `business`. Svarets `lines` innehåller de verkliga beräkningskomponenterna, inklusive `invoice_fee` med `unit=sek_invoice` och `calculation_type=per_invoice` även när fakturaavgiften är dold på avtalskortet.

`GET /api/v1/website/public-contracts/diagnostics` är tenant-scopad och visar `pricing_readiness.invoice_fee`. Ready-status innehåller belopp, enhet, beräkningstyp, kortsynlighet och källa. Blockerad status använder någon av:

- `invoice_fee_missing`
- `invoice_fee_conflict`
- `invoice_fee_ambiguous`

Befintliga publicerade avtal rättas versionssäkert: en ny pris- och publiceringsversion skapas och den gamla markeras `superseded`. Redan signerade kundavtal behåller sin tidigare exakta version. Entydiga draftavtal kan uppdateras via det kanoniska kommandot. Saknade eller motstridiga värden sätts aldrig automatiskt till `0`, utan hamnar i manuell remediation med auditspår.



## Publication revision, cache och kanaler

`GET /api/v1/website/public-contracts` läser endast kanalen `website`. `internal` används av OPS och interna säljflöden. `api` är en separat partner-/serverkanal och ska inte automatiskt visas på hemsidan.

Varje publiceringsrelevant ändring höjer en tenant- och kanalbunden `publication_revision`. Feed-svaret returnerar revisionen i `meta` och som `ETag`. Skicka `If-None-Match`; oförändrad revision ger `304 Not Modified`. Externa kunder ska inte förlita sig på Next.js `revalidateTag` för cacheinvalidering.

API-nycklar är server-side secrets. `allowed_origins` är ett kompletterande driftfilter, inte en fullständig säkerhetsgräns för server-till-server-anrop. IP-regler accepterar exakta IPv4/IPv6-adresser och CIDR. Forwarding-headers betros automatiskt endast på Vercel (`VERCEL=1`); andra reverse proxies måste uttryckligen sätta `INTEGRATION_API_TRUST_PROXY_HEADERS=true` efter att de konfigurerats att skriva över klientens inkommande forwarding-headers. Vid avsaknad av en betrodd proxy failar aktiva IP-allowlists stängt.

## V1-deprecation

`offer_reference` är den enda canonical externa avtalsidentiteten. Aliasen `contract_offer_id`, `publication_reference` och toppnivåfältet `contracts` finns kvar i V1 men är deprecated. Nya klienter ska använda `data` och `offer_reference`. Aliasen tas tidigast bort i en framtida major-version efter publicerad sunset-period.

Nya publiceringar får en opak tenantoberoende referens i formatet `offer_<sha256>`. Redan publicerade referenser behålls exakt som de är eftersom de kan vara bundna till ansökningar, kundavtal, juridiska accepter och pris-snapshots. Klienten ska därför behandla värdet som en opak sträng och aldrig validera varumärke, UUID-format eller produktnamn lokalt.
