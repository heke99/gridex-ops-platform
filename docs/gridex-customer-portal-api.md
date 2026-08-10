# Gridex Customer Portal API

Publik onlineversion efter deploy: `/developers/customer-portal-api`.

Dokumentationsversion: `2026-08-10.1`.

## Tenantkonfiguration

Tenantens hemsida eller Mina sidor behöver endast en server-side hemlighet:

```env
GRIDEX_API_KEY=gridex_live_xxxxxxxxx
```

API base URL är alltid `https://app.gridex.se/api/v1`. API-nyckeln avgör tenant, `company_id` och scopes. Tenantens miljö ska inte innehålla separat tenant-ID, company-ID, quote-reference-läge eller OpenAPI-sökväg.

Canonical `quote_reference`, `resolution_id` och `offer_reference` skickas alltid top-level i `POST /api/v1/website/customer-applications`. OpenAPI publiceras på:

```text
https://app.gridex.se/api/v1/openapi/website-integration-v1.json
https://app.gridex.se/api/v1/openapi/customer-portal-v1.json
```

OpenAPI används för utveckling/typgenerering och är inte ett runtimeberoende.

## Grundmodell

Tenantens hemsida/Mina sidor äger inloggningssessionen. OPS är master för kund, kundnummer, avtal, anläggningar, fullmakter, juridiska godkännanden, dokument, status och processflöden.

Flödet ska vara:

```text
Tenant Mina sidor → tenant server route → OPS API → OPS company_id från API-nyckel → kundresolver → OPS masterdata → tenant UI
```

Frontend får aldrig anropa OPS direkt med API-nyckel och får aldrig skicka ett fritt `company_id`.

Publika UUID:n är opaka och tenantbundna; de är aldrig en
auktoriseringsmekanism. Interna prisplans-, publicerings-, portalidentitets- och
provider-ID:n får inte förekomma i externa DTO:er. Se
[Public API ID policy](./public-api-id-policy.md).

## Portal bundle payload

Rekommenderad endpoint:

```http
POST /api/v1/customer/portal-bundle
Authorization: Bearer ${GRIDEX_API_KEY}
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
      "supplier_switch": {
        "can_create_request": false,
        "can_dispatch": false,
        "blockers": ["missing_metering_point", "missing_grid_owner", "facility_not_verified"],
        "next_action": "complete_application"
      },
      "can_start_switch": false
    },
    "data_quality": {
      "status": "needs_action",
      "issues": ["missing_metering_point", "missing_grid_owner", "facility_not_verified"]
    }
  }
}
```

`supplier_switch.can_create_request` och `supplier_switch.can_dispatch` är
separata beslut. `can_start_switch` är en utfasad kompatibilitetsalias för
`supplier_switch.can_dispatch`.

Det fullständiga svaret innehåller även `customer`, `contracts`, `sites`,
`metering_points`, `invoices`, `metering_values`, `documents`,
`legal_acceptances`, `powers_of_attorney`, `notifications`, `events`,
`website_applications` och `bundle_status`. Vid delvis fel returneras 200 med
tomma sektioner och `bundle_status.status = "partial"` (aldrig en HTML-sida).

### Sub-endpoints

Varje endpoint kontrollerar sitt granulära scope. Identifierare skickas enligt
respektive OpenAPI-operation via headers, path eller query:

- `GET /api/v1/customer/me` – `customer_profile.read`
- `GET /api/v1/customer/contracts` – `customer_contracts.read`
- `GET /api/v1/customer/sites` – `customer_sites.read`
- `GET /api/v1/customer/invoices` – `customer_invoices.read`
- `GET /api/v1/customer/invoices/{id}` – `customer_invoices.read`; returnerar endast en publicerbar rad från `customer_invoices`
- `GET /api/v1/customer/metering-values?from=&to=&facility_id=&limit=` – `customer_metering.read`
- `GET /api/v1/customer/documents` – `customer_documents.read`
- `GET /api/v1/customer/legal-acceptances` – `customer_legal.read`
- `GET /api/v1/customer/powers-of-attorney` – `customer_power_of_attorney.read`
- `GET /api/v1/customer/events` – `customer_events.read`
- `GET /api/v1/customer/notifications` – `customer_notifications.read`

`GET /api/v1/customer/portal-bundle` behåller `customer_portal.read` som ett
legacy-umbrella-scope. Det expanderas server-side till de granulara läsrättigheter
som bundlen behöver, men ska inte användas som generell ersättning på nya
sub-endpointintegrationer.

Skriv-endpoints kräver granulära scopes: `customer_sync.write`, `customer_contact.write`, `customer_facility_data.write`, `customer_power_of_attorney.write` och `customer_notifications.write`. Legacy-scope `customer_portal.write` expanderas server-side under övergångsperioden. `profile-update` kräver det scope som motsvarar operationen och båda scopes när både profil och anläggningsdata skickas i samma request.

## Kundens tecknade avtal

`GET /api/v1/customer/contracts` och portal bundle läser tenantens `customer_contracts`, inte website-endpointens säljerbjudanden. Externa DTO:er använder dokumenterade, opaka och tenantbundna resurs-ID:n; interna publicerings-, prisplans-, provider- och snapshot-ID:n exponeras inte. Kundresolvern måste länka portalidentiteten till rätt tenant och kund; annars returneras ett tydligt identitetsfel i stället för andra kunders data.

## Dokument, fullmakt och juridiska godkännanden

Tenant ska skicka godkända fullmakter, juridiska godkännanden och dokument till OPS så OPS kan starta rätt processer.

```http
POST /api/v1/customer/sync
Authorization: Bearer ${GRIDEX_API_KEY}
Content-Type: application/json
```

> `Idempotency-Key` är obligatorisk på `/sync`, `/profile-update`,
> `/move-out`, `/notifications/read`, `POST /api/v1/events` och
> `POST /api/v1/website/customer-events`. Nyckeln binds till tenant,
> API-klient, kund, operation och payload-hash. Samma nyckel med samma payload
> ger replay av lagrat resultat; samma nyckel med annan payload ger `409`.

```json
{
  "email": "heke99@live.se",
  "customer_number": "DX-100023",
  "external_customer_id": "GRIDEX-WEB-20260616-8191257d-88d3-4929-ab02-1d3ca5ed986f",
  "power_of_attorney": {
    "power_of_attorney_reference": "POA-39e9fbc4-2c94-46fb-a1ee-49d18cb0932a",
    "document_reference": "legal_customer_document_...",
    "scope": ["supplier_switch", "facility_information_lookup"],
    "accepted": true,
    "accepted_at": "2026-06-16T15:10:12.647Z",
    "signer_name": "Kundens namn",
    "signer_identity_number": "verifierad-identitetsreferens",
    "method": "bankid",
    "ip_address": "203.0.113.10",
    "user_agent": "Mozilla/5.0",
    "valid_from": "2026-06-16"
  },
  "legal_acceptances": [
    {
      "document_reference": "legal_customer_document_...",
      "document_code": "agreement",
      "document_version": "legal_customer_version_...",
      "document_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "accepted": true,
      "accepted_at": "2026-06-16T15:10:12.647Z"
    }
  ],
  "documents": [
    {
      "document_reference": "tenant-contract-123",
      "document_type": "contract_confirmation",
      "title": "Avtalsbekräftelse",
      "secure_url": "https://tenant.se/documents/tenant-contract-123.pdf"
    }
  ]
}
```

Fullmaktens `document_reference` får vara antingen den nya samlade
`power_of_attorney`-referensen från OPS eller den äldre exakta modulreferensen
från samma tenantbundna legal bundle. `scope` måste alltid innehålla
`supplier_switch`; `facility_information_lookup` är det enda valbara tillägget.
OPS sparar exakt scope oföränderligt och skapar samma authorization chain som
webbansökan använder. `signer_name`, `signer_identity_number` och `method` krävs
för att fullmakten ska bli signerad och kunna användas för nätägarbegäran eller
leverantörsbyte. En äldre payload utan dessa fält tas emot som ett ofullständigt
utkast och blockerar extern dispatch.

`legal_acceptances` använder samma samlade kunddokument som webbansökan:
`agreement`, `power_of_attorney` och, när det är tillämpligt, `withdrawal`.
OPS expanderar varje samlad acceptans till en oföränderlig bevisrad per exakt
underliggande juridikmodul. Äldre modulreferenser stöds fortsatt, men de får inte
blandas med samlade dokumentreferenser i samma synkflöde.

OPS sparar:

- fullmakt i `powers_of_attorney`
- juridiska godkännanden i `customer_legal_acceptances`
- dokument i `customer_documents`
- processhändelser som domain events/webhooks

## Eventstatus

Publikt aktiva webhookevents omfattar bland annat `supply.started`,
`invoice.created`, `invoice.sent`, `invoice.paid` och `invoice.disputed`.

Interna livscykelhändelser omfattar `supplier_switch.requested`,
`supplier_switch.accepted`, `supplier_switch.rejected`,
`supply_period.activated` samt `invoice.provider.partially_paid`,
`invoice.provider.overdue` och `invoice.provider.credited`. De interna namnen är
inte ett publikt webhooklöfte.

Följande publika namn är planerade och ska inte prenumereras på ännu:
`contract.activated`, `supplier_switch.started`,
`supplier_switch.completed`, `invoice.partially_paid`, `invoice.overdue` och
`invoice.credited`.

Om anläggningsinfo saknas ska OPS visa `needs_facility_data` och blockera switch tills mätpunkt/nätägare är verifierade.

## Website customer applications

### Portföljmetod och sanerad historik

`GET /api/v1/website/portfolio-prices?offer_reference=...&price_area=SE3`
kräver `website_contracts.read`. API-nyckeln bestämmer bolaget och
`offer_reference` bestämmer exakt publicerat portfölj-/mixavtal. Svaret innehåller endast:

- `method`: den publika avtalsmetoden utan interna portfölj- eller versions-ID:n;
- `historical_final_prices`: sanerade finala eller låsta historikrader med månad, elområde, belopp, enhet, momsstatus och status;
- `market_price_responsibility=ops_quote`;
- `calculator_market_price_supplied_by_ops=true`;
- `final_billing_rule=locked_settlement_only`.

Historiska portföljrader får inte användas som aktuell marknadsreferens i tenantens kalkylator. För kundspecifik preview skapar tenantens backend i stället en OPS-quote. Quotens additiva `market_reference` anger provider, prisområde, referensperiod, `as_of`, freshness, fallback och att värdet är indikativt.

OPS använder separat verifierad och explicit låst settlement vid faktisk avräkning och fakturering. Preview och settlement är skilda datatyper; `market_reference` får aldrig användas som slutligt fakturapris.

## Scopes

Runtime kontrollerar granulära scopes per operation. Följ OpenAPI-operationens
`security`/scopekrav när en API-klient provisioneras:

- `customer_profile.read` – kundprofil
- `customer_contracts.read` – kundens tecknade avtal
- `customer_sites.read` – anläggningar och mätpunkter
- `customer_invoices.read` – fakturor
- `customer_metering.read` – mätvärden
- `customer_documents.read` – dokument
- `customer_legal.read` – juridiska accepter
- `customer_events.read` – kundens portalhändelser
- `customer_power_of_attorney.read` – fullmakter
- `customer_notifications.read` / `customer_notifications.write` – notiser
- `customer_sync.write` – kundsync och portalinitialisering
- `customer_contact.write` – kontaktuppgifter i `profile-update`
- `customer_facility_data.write` – anläggningsuppgifter och `move-out`
- `customer_power_of_attorney.write` – fullmaktssync
- `events.read` / `website_events.write` – globala respektive website-events

`customer_portal.read` och `customer_portal.write` är legacy-alias som expanderas
server-side under övergångsperioden. Nya klienter ska få de granulara scopes de
faktiskt behöver. `profile-update` kräver `customer_contact.write`,
`customer_facility_data.write` eller båda beroende på vilka payloadsektioner som
skickas.

## Felkoder

Fel returneras alltid i det kanoniska JSON-kuvertet, aldrig som HTML:

```json
{
  "error": {
    "code": "api_scope_missing",
    "message": "Required API scope is missing.",
    "retryable": false,
    "field": null,
    "blockers": []
  },
  "request_id": "req_...",
  "correlation_id": null,
  "contract_schema_version": "2026-08-10.1"
}
```

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

## Canonical fastpris, quote och teckningsflöde (`2026-08-10.1`)

Den aktiva integrationsordningen är:

1. `GET /api/v1/website/public-contracts` hämtar varje publicerad produkt **en gång**. Ett fastprisavtal kan innehålla `area_pricing` med separata rader för SE1–SE4, men raderna tillhör samma `offer_reference`, produktversion och publicering.
2. `POST /api/v1/website/energy-area/resolve` använder OPS tenant-skopade canonical resolver. Prisområdet SE1–SE4 avgörs separat genom `price_area_assurance`, medan nätområde, nätägare, anläggningsuppslag och EDIFACT har egna readiness-krav. Den gamla oautentiserade `GET /api/public/energy-area` är fortsatt borttagen.
3. `POST /api/v1/website/quote` skapar en tenantbunden quote som fryser exakt publicerad version, valt SE-område, vald områdesprisrad, förbrukning, startdatum, avgifter, moms och beräkningsantaganden.
4. `POST /api/v1/website/quote/validate` validerar samma bindning före teckning.
5. `POST /api/v1/website/customer-applications` konsumerar `quote_reference`, skapar eller återanvänder en canonical kund och ett kundnummer, skapar en anläggningsbunden avtalsrelation och låser vald SE-prisrad i avtalets pris-/faktureringssnapshot. Kundansökan kräver top-level `offer_reference`, `quote_reference` och samma top-level `resolution_id`; `contract` innehåller endast kompletterande start-/avtalsuppgifter och ingen legacyfallback skapar avtal utan quote.

Kundansökan kan även skicka aktuell leverantörsidentitet, inklusive `current_supplier_ediel_id`, när den är känd. Svaret skiljer på skapande och dispatch i `supplier_switch`: `can_create_request` kan vara `true` samtidigt som `can_dispatch` är `false` tills mätpunkt, fullmakt, nuvarande leverantör, route och transportkrav är verifierade.

`resolution_id` är obligatoriskt i quote och teckning. OPS läser området genom den autentiserade tenanten och `resolution_id`, kontrollerar expiry, `price_area_assurance` och den ändamålsspecifika capabilityn samt avvisar motstridigt område. Ett högkonfidens-konsensus från postnummer och ort kan öppna pricing/quote när alla kandidater ligger i samma SE-område, men öppnar aldrig anläggningsuppslag eller EDIFACT. Pricing/quote blockeras aldrig enbart av saknad PRODAT-route eller transportkonfiguration. För rörliga avtal innehåller quoten en additiv `market_reference` med provider, referensperiod, `as_of`, `is_indicative`, `is_stale` och fallbackmetadata. Preview får aldrig användas som settlement.

För fastpris gäller:

- `area_pricing` är den canonicala prismatrisen för samma produkt, inte fyra avtal;
- `fixed_price_ore_per_kwh` och `pricing.fixed_price` är kompatibilitetsfält och är `null` när SE-områdena har olika priser;
- kunden och kundportalen ser bara det avtal och den områdesprisrad som hör till kundens anläggning;
- en kund med flera verkliga anläggningar kan ha en avtalsrelation per anläggning, men inte en ny kund eller fyra produktkopior per prisområde;
- faktureringen använder den immutable valda prisraden och det låsta `price_area` från quote-/avtalssnapshoten, inte dagens publicerade webbpris eller ett senare ändrat område på anläggning/mätpunkt;
- om operativ områdesdata motsäger avtalssnapshoten blockeras fakturaunderlaget i stället för att prisområdet skrivs över.

`pricing.calculation_components` och kompatibilitetsfältet `pricing.components` innehåller alla tillämpliga pris- och avgiftskomponenter. Dolda komponenter får inte filtreras bort från kalkyl, quote, avtalssnapshot eller fakturering. `pricing.display_components` styr endast vilka komponenter som får visas som separata sälj-/avtalsrader.

För penningvärden gäller:

- `0` är ett giltigt publicerat numeriskt värde och betyder avgiftsfritt;
- blankt, `null` och `undefined` betyder inte automatiskt `0`;
- använd aldrig truthy/falsy-kontroller för pengar;
- kontrollera uttryckligen `value === null || value === undefined`.

Aktiva scopes är `website_contracts.read`, `website_energy_area.resolve`, `website_market_prices.read`, `website_quotes.write`, `website_quotes.validate` och `website_applications.write`. API-svaret innehåller `contract_schema_version=2026-08-10.1`; versionsvärdet ingår i ETag-underlaget.

## Publication revision, cache och kanaler

`GET /api/v1/website/public-contracts` läser endast kanalen `website`. `internal` används av OPS och interna säljflöden. `api` är en separat partner-/serverkanal och ska inte automatiskt visas på hemsidan.

Varje publiceringsrelevant ändring höjer en tenant- och kanalbunden `publication_revision`. Feed-svaret returnerar revisionen i `meta` och som `ETag`. Skicka `If-None-Match`; oförändrad revision ger `304 Not Modified`. Externa kunder ska inte förlita sig på Next.js `revalidateTag` för cacheinvalidering.

API-nycklar är server-side secrets. `allowed_origins` är ett kompletterande driftfilter, inte en fullständig säkerhetsgräns för server-till-server-anrop. IP-regler accepterar exakta IPv4/IPv6-adresser och CIDR. Forwarding-headers betros automatiskt endast på Vercel (`VERCEL=1`); andra reverse proxies måste uttryckligen sätta `INTEGRATION_API_TRUST_PROXY_HEADERS=true` efter att de konfigurerats att skriva över klientens inkommande forwarding-headers. Vid avsaknad av en betrodd proxy failar aktiva IP-allowlists stängt.

## V1-deprecation

`offer_reference` är den enda canonical externa avtalsidentiteten. Aliasen `contract_offer_id`, `publication_reference` och toppnivåfältet `contracts` finns kvar i V1 men är deprecated. Nya klienter ska använda `data` och `offer_reference`. Aliasen tas tidigast bort i en framtida major-version efter publicerad sunset-period.

Nya publiceringar får en opak tenantoberoende referens i formatet `offer_<sha256>`. Redan publicerade referenser behålls exakt som de är eftersom de kan vara bundna till ansökningar, kundavtal, juridiska accepter och pris-snapshots. Klienten ska därför behandla värdet som en opak sträng och aldrig validera varumärke, UUID-format eller produktnamn lokalt.


API-svaret innehåller `contract_schema_version=2026-08-10.1` och headern `X-Gridex-Contract-Version`. Versionsvärdet ingår i ETag-underlaget så att klienter inte får `304 Not Modified` mot en äldre DTO när kontraktsrepresentationen ändras.

## Avgränsning mot Website Integration API 2026-08-10.1

Den här guiden beskriver kundportal och Mina sidor. Website checkout, publicerade erbjudanden, elområdesresolution, aktuellt marknadspris och quote dokumenteras canonicalt i `website-integration-v1.json`.

Följande route tillhör Website Integration API och ska inte typgenereras från kundportalens OpenAPI-specifikation:

```text
POST /api/v1/website/market-price/current
```

Tenantens vanliga API-nyckel kan ha både kundportal- och website-scopes, men kontrakten är separata. `company_id` skickas aldrig som tenantväljare.

- `website_market_prices.read` ingår i de canonicala profilerna `website_signup` och `tenant_website`; befintliga aktiva website-nycklar backfillas additivt. Ingen ny ENV-variabel eller API-nyckel krävs.


## Automatisk fortsättning efter kundansökan

Efter en accepterad website-kundansökan returnerar API:t `next_step: automatic_processing`. Samma databastransaktion skapar ett persistent `customer_application_continuation`-jobb. OPS-workern, inte website-requesten, avgör därefter nästa steg för juridiska utskick, komplettering, nätägaruppgifter, Z01/Z03, leverantörsbyte, aktivering och webhooks.

## Extern kontraktsändring 2026-08-03.1

Website Integration API modellerar nu `energy_direction` explicit som `consumption` eller `production`. Produktionsavtal returnerar en immutable `production_pricing` och kan använda `settlement_mode=self_billing`; de får inte behandlas som konsumtionsleverans eller vanlig kundfaktura. Canonical juridikroute är `GET /api/v1/website/legal-bundle`; tenant hämtas från API-nyckelns integrationskontext och inget externt `company_id` används. Felmodellen innehåller top-level `ok=false`, `code`, `message`, `request_id`, `correlation_id` och strukturerade `blockers`.
