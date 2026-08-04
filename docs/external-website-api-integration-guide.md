# Gridex OPS – extern websiteintegration

> **Canonical API-version: 2026-08-04.1**
>
> OPS är source of truth för publicerad produkt, elområdesresolution, quote, kundacceptans och det prisunderlag som låses på kundavtalet. Tenantens webb visar OPS data men skapar inte en parallell pris- eller områdessanning.

## 0. Tenantkonfiguration: en enda API-nyckel

Den officiella autentiseringsformen är `Authorization: Bearer <GRIDEX_API_KEY>`.
Runtime accepterar under en begränsad övergångsperiod även headern
`x-api-key: <GRIDEX_API_KEY>`, men den är legacy, ska inte införas i nya
integrationer och har planerat slutdatum **2026-10-31**.

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
Release manifest: https://app.gridex.se/api/v1/openapi/release-manifest.json
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

API-klientens status och tenantens driftstatus är två separata spärrar som
kontrolleras centralt före endpointens affärslogik:

| Tenantstatus | HTTP/kod | Beteende |
|---|---|---|
| `active` | — | API-anrop fortsätter till scope- och rate-limitkontroll. |
| `onboarding` | `403 tenant_not_operationally_ready` | Ingen extern försäljning innan server-side readiness är komplett. |
| `paused` | `423 tenant_paused` | API, nya quotes och kundansökningar stoppas; historik bevaras. Oanvända quotes återkallas. |
| `suspended` | `403 tenant_suspended` | API-åtkomst och ny operativ drift stoppas. |
| `closed` | `410 tenant_closed` | Terminalt stängd för ny drift; nycklar återkallas och historik bevaras. |
| `archived` / `pending_deletion` | `410 tenant_inactive` | Ingen extern API-åtkomst. |

Ett avtal har separata operationer för avpublicering, paus, stängning,
arkivering och säker radering. Ett pausat eller stängt avtal returneras aldrig
som teckningsbart. Pausning och terminal stängning återkallar befintliga,
oanvända quotes omedelbart; konsumerade quotes och juridisk historik muteras
inte. Ett tidigare publicerat avtal kan endast hårdraderas när samtliga kanaler
är avpublicerade och dependency-kontrollen bevisar att ingen affärshistorik
finns. Stängda avtal är terminala och hårdraderas inte.

Externa klienter använder `application_number` och tenantbundna publika
referenser som `customer_reference`, `application_reference`,
`facility_reference`, `metering_point_reference` och `contract_reference`.
Interna databas-UUID:n för kund, ansökan, site, mätpunkt, avtal, workflow,
continuation-jobb, prisplan, publicering, portalidentitet och provider returneras
inte. `resolution_id` är ett separat dokumenterat, opakt quote-underlag och får
aldrig användas som tenantväljare eller generell resursidentifierare. Se
[Public API ID policy](./public-api-id-policy.md).

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

Feeden läses och valideras alltid innan en villkorad respons avgörs. ETag är en SHA-256-fingerprint av den faktiska canonicala representationen: tenantreferens, kanal, kundtyp, schemasversion, sorterad JSON för hela avtalslistan och eventuell blockerrepresentation. En gammal revisions-ETag får därför aldrig ge ett felaktigt `304 Not Modified`. Svaret använder `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache` och `Expires: 0`; tenantens backend får endast använda ETag tillsammans med en egen verifierad, hållbar snapshot.

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

### Hållbar last-known-good-snapshot

Tenantintegrationen ska spara den senaste **fullständigt verifierade** feeden i ett hållbart server-side lager. Minnescache är inte tillräcklig. Timeout, HTTP 5xx, ogiltig JSON, schemasfel, partiell mappningsrisk eller storagefel får aldrig skriva över snapshoten med tom eller förkortad data. Under ett tillfälligt fel visas den tidigare snapshoten med `stale/degraded`, senaste lyckade hämtningstid och aktuellt fel.

En tom färsk feed får ersätta snapshoten endast när `meta.feed_state === "canonical_empty"` och `meta.empty_feed_authorization.authorized === true`. Auktoriseringen ska beskriva en verifierad canonical övergång, exempelvis archive, unpublish, expiry eller tenantstängning. Nätverksfel och serializerfel är aldrig en avpublicering.

Referensimplementationen finns i `lib/integrations/publicContractFeedSnapshot.ts` och kräver ett tenantägt durable store. API-nyckeln får aldrig lagras i snapshoten.

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
    "message": "Adress och påstått nätområde motsäger varandra.",
    "retryable": false,
    "field": "grid_area_code",
    "blockers": []
  },
  "request_id": "0e4366ee-eb3c-426d-8e82-55ec01e94b21",
  "correlation_id": "0e4366ee-eb3c-426d-8e82-55ec01e94b21",
  "contract_schema_version": "2026-08-04.1"
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

HTTP `200` betyder att OPS har skapat en resolution, inte att alla efterföljande
steg är tillåtna. Klienten måste kontrollera
`data.capabilities.pricing_ready` före marknadspris och
`data.capabilities.quote_ready` före offert. Om någon capability är `false`
ska motsvarande `data.blockers.pricing` eller `data.blockers.quote` visas eller
hanteras. Ett `postal_suggested`-resultat får inte skickas vidare till
pris/offert bara för att resolveranropet gav `200`.

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
  "price_option_reference": "price_option_...",
  "invoice_delivery_method": "paper",
  "selected_component_references": ["green_energy_100"],
  "site_count": 1,
  "annual_consumption_kwh": 12000,
  "customer_type": "private",
  "start_date": "2026-09-01"
}
```

`price_area` behöver inte skickas. Skickas det ändå behandlas det som ett påstående. Om det motsäger resolutionen returnerar OPS `409 price_area_mismatch` eller `409 quote_resolution_mismatch`; klientvärdet skriver aldrig över resolutionen.

OPS quoten låser:

- publicerad produkt- och publiceringsversion;
- exakt prisalternativ och stabil områdesprisreferens;
- vald SE-områdesrad;
- faktureringssätt samt obligatoriska, valda och villkorsstyrda komponenter;
- fullständiga lösta bas- och avgiftskomponenter;
- resolver- och geodataversion;
- indikativ marknadsreferens för rörliga avtal;
- beräkningsantaganden och giltighetstid;
- SHA-256-hash över immutable quote-snapshot.

`price_option_reference` hämtas från produktfeedens top-level-fält
`price_options`. Välj objektet där `default=true` när
`selection_required=false`. När `selection_required=true` måste kunden göra
ett uttryckligt val; arrayens ordning är aldrig en urvalsregel. Endast
`customer_optional`-komponenter får skickas i
`selected_component_references`. Servern lägger själv till `mandatory` och
tillämpliga `conditional`-komponenter; `admin_optional` kan aldrig väljas av
webbklienten. Pappersfaktura kan därför exempelvis aktivera 39 kr per faktura,
medan e-post och e-faktura lämnar samma villkorskomponent exkluderad.

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
  "price_option_reference": "fixed-12-months",
  "invoice_delivery_method": "email",
  "selected_component_references": [],
  "site_count": 1,
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
  "customer_portal_user_id": "uuid-från-verifierad-serversession",
  "auth_user_id": "uuid-från-verifierad-serversession",
  "legal_bundle_version": "uuid-från-legal-bundle",
  "legal_acceptances": [
    {
      "requirement_code": "general_consumer_terms",
      "document_reference": "legal_document_...",
      "document_version": "2026-07-30-v1",
      "document_hash": "64-teckens-sha256-från-legal-bundle",
      "accepted": true,
      "accepted_at": "2026-07-30T10:30:00+02:00"
    }
  ],
  "powerOfAttorney": {
    "accepted": true,
    "scope": [
      "supplier_switch",
      "facility_information_lookup"
    ],
    "signerName": "Anna Andersson",
    "signerIdentityNumber": "YYYYMMDDXXXX",
    "method": "website_acceptance",
    "acceptedAt": "2026-07-30T10:30:00+02:00",
    "textVersionId": "uuid-från-publicerat-legal-bundle",
    "ipAddress": "203.0.113.10",
    "userAgent": "Mozilla/5.0"
  }
}
```

`offer_reference`, `quote_reference` och `resolution_id` ligger alltid på requestens top-level. `contract` innehåller endast kompletterande avtalsuppgifter. `quote_reference` och `resolution_id` måste matcha den validerade quoten. Dubbel submit med samma `Idempotency-Key` och samma normaliserade request-hash returnerar samma canonicala affärsresultat och samma publika referenser. Samma nyckel med annan payload ger `409 idempotency_conflict`.

OPS använder samma tenantbundna kundmatchning i alla intakekanaler. Organisationsnummer eller verifierat personnummer väger starkare än e-post. E-post ensam slår inte automatiskt ihop osäker identitet.

Använd de canonicala fälten `customer.personal_number` för privatkund och `customer.org_number` för företagskund. Under en övergångsperiod normaliserar API:t även identitetsalias som `personal_identity_number`, `personalIdentityNumber`, `identity_number`, `personnummer`, `organization_number`, `organisation_number`, `organisationsnummer` och `orgnr`, men nya integrationer ska alltid skicka de canonicala fälten.

En fullmakt får endast gå vidare till extern nätägar- eller marknadskommunikation när svaret anger `externally_sendable: true`. Vid `externally_sendable: false` ska klienten följa `next_action` och komplettera signerare, identitet, metod eller låst juridisk text; ett äldre consentfält är aldrig tillräckligt som extern fullmakt.

`legal_acceptances` ska byggas exakt från endpointens dynamiska
`requirements`. OPS verifierar bundle, requirement code, dokument-ID, version,
SHA-256, `accepted=true` och timestamp. Om paketet ändrats returneras
`legal_bundle_version_mismatch` eller `legal_acceptance_document_mismatch` och
Web ska hämta paketet igen. När fullmakt krävs ska tenant även skicka den
strukturerade `powerOfAttorney`-modellen med signerande namn, identitet, metod,
exakt scope och publicerat `textVersionId`.

Canonical `textVersionId` är modulversionsradens UUID, aldrig `document_reference`:

```ts
const powerOfAttorneyVersion = contract.legal.module_versions.find(
  (version) => version.module_key === "power_of_attorney",
);

const textVersionId =
  contract.legal.power_of_attorney_version_id ?? powerOfAttorneyVersion?.id;
```

När avtalet kräver fullmakt men inget sådant canonicalt modul-ID finns ska teckningen stoppas och feeden behandlas som inkonsekvent.

`auth_user_id` och `customer_portal_user_id` är obligatoriska för kundansökan, ska komma från samma verifierade serversession i tenantens Mina sidor och måste vara samma UUID. OPS accepterar inte en kundansökan som saknar en beständig portalägarkoppling.

Ett accepterat svar betyder att OPS har committat kund, kundnummer, anläggning, avtal, juridik, portalidentitet, workflow och ett beständigt fortsättningsjobb. Det betyder inte att e-post, anläggningsuppslag, leverantörsbyte eller webhookleverans redan är klar. Tenant följer dessa steg genom statusresponsens `automation`, `communication` och `webhook` och ska inte själv skicka nätägarbegäran, skapa Z01/Z03, starta leverantörsbyte eller skicka juridiska avtalsmail.

Exempel på accepterat svar:

```json
{
  "data": {
    "application_number": "APP-20260801-0001",
    "customer_number": "DX-123456",
    "customer_reference": "customer_...",
    "application_reference": "application_...",
    "facility_reference": "facility_...",
    "metering_point_reference": "metering_point_...",
    "contract_reference": "contract_...",
    "status": "accepted",
    "workflow_state": "canonical_data_committed",
    "next_step": "automatic_processing",
    "missing_fields": [],
    "blocking_reasons": [],
    "supplier_switch": {
      "request_reference": null,
      "status": "not_created",
      "can_create_request": true,
      "can_dispatch": false,
      "blockers": [],
      "next_action": "create_supplier_switch_request"
    }
  },
  "request_id": "req_...",
  "correlation_id": "req_...",
  "contract_schema_version": "2026-08-04.1"
}
```

Tenant kan följa samma process utan interna OPS-tillstånd via:

```http
GET /api/v1/website/customer-applications/{application_number}
Scope: website_switch_status.read
```

Externa statusar är `accepted`, `processing`, `needs_customer_information`, `completed`, `rejected` och `failed`. Responsen innehåller dessutom verklig avtalsstatus, korrekt ansökningsbunden switch/försörjningsperiod, continuation-jobbets retryläge, e-postens canonicala `communication_logs`-status och beständig webhook fan-out/delivery-status.

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

## 10. Events och webhooks

Kundevent skickas med samma stängda canonical request på båda write-routes:

```http
POST /api/v1/website/customer-events
POST /api/v1/events
Idempotency-Key: required
```

`Idempotency-Key` är obligatorisk. Retry med samma nyckel och samma payload
returnerar samma resultat; samma nyckel med annan payload ger konflikt. Externa
responses och webhookar innehåller endast `tenant_reference`, publika
resursreferenser, kundnummer och sanitiserad affärsdata. `company_id`,
`customer_id`, `application_id`, `contract_id` och andra interna `*_id`-fält
tas bort innan leverans.

Webhookar levereras via den signerade `webhook_deliveries`-kedjan. Mottagaren
ska verifiera `X-Gridex-Timestamp` och `X-Gridex-Signature`, deduplicera på
`X-Gridex-Delivery-Id` och lagra `X-Gridex-Event-Id`. Ett köat mail eller internt
domain event är inte samma sak som ett levererat publikt webhookevent.

Webhook-URL:n hostas av tenantens mottagarsystem. Den är alltså inte en vanlig
Gridex REST-endpoint och ska inte skyddas med Gridex Bearer-token. Gridex skickar
den HMAC-signerade requesten; mottagaren svarar med valfri lyckad `2xx` efter
verifiering och idempotent lagring. OpenAPI-kontraktet modellerar därför detta
under top-level `webhooks`, inte under Gridex-hostade `paths`.

## 11. Felkoder

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

Publication-eventet `contracts.publication.changed` är ett observations- och invalidationssignal, inte korrekthetskällan. Tenantens backend hämtar alltid en ny fullständig representation och ersätter sin hållbara snapshot först efter lyckad validering. Tidsgränser som `valid_from` och `valid_to` verifieras vid varje request och korrektheten beror inte på att en trigger eller cron råkar köras i exakt rätt sekund.

Publika OpenAPI-kontrakt:

```text
https://app.gridex.se/api/v1/openapi/website-integration-v1.json
https://app.gridex.se/api/v1/openapi/customer-portal-v1.json
https://app.gridex.se/api/v1/openapi/2026-08-04.1/website-integration-v1.json
https://app.gridex.se/api/v1/openapi/2026-08-04.1/customer-portal-v1.json
```

De två `current`-pekarnas svar använder `no-store`; de två versionsbundna artefakterna är immutabla och får `public, max-age=31536000, immutable`.

Filerna kan hämtas i CI för typgenerering men får inte hämtas som ett krav när tenantens applikation startar. Publik utvecklarsida: `https://app.gridex.se/developers/customer-portal-api`.

API-svaret innehåller `contract_schema_version=2026-08-04.1` och headern `X-Gridex-Contract-Version`.

## Canonical marknadsprisflöde i API 2026-08-04.1

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
| 401 | `missing_api_token` | Nej | Skicka `Authorization: Bearer $GRIDEX_API_KEY`. |
| 401 | `invalid_api_token` | Nej | Använd den aktiva Gridex API-nyckeln. |
| 403 | `api_scope_missing` | Nej | Lägg till `website_market_prices.read` på API-klienten. |
| 404 | `resolution_not_found` | Nej | Kör områdesresolution på nytt inom samma tenant. |
| 409 | `resolution_expired` | Nej | Skapa en ny `resolution_id`. |
| 409 | `resolution_pricing_not_ready` | Nej | Kör resolvern igen eller åtgärda blockeraren i `blockers.pricing`. PRODAT-readiness påverkar inte priset. |
| 409 | `price_area_mismatch` | Nej | Ta bort lokalt område och använd resolutionens område. |
| 409 | `market_price_stale` | Ja | Försök igen efter att OPS-importen har uppdaterats. Räkna inte lokalt. |
| 429 | `rate_limited` | Ja | Använd backoff och respektera rate-limit headers. |
| 503 | `current_market_price_unavailable` | Ja | Försök igen; behåll föregående visning endast om produktens UX-policy tillåter det. |
| 500 | `market_price_provider_unavailable` | Ja | Försök igen och använd `request_id` vid support. |

Alla fel returnerar `error.code`, `error.message`, `error.retryable`, `error.field`, `error.blockers` samt top-level `request_id`, `correlation_id` och `contract_schema_version`. Tenant ska aldrig ersätta ett marknadsprisfel med en egen prisberäkning.


## Production och canonical energiriktning

Varje publicerat avtal har obligatoriskt `energy_direction`:

```text
consumption | production
```

`consumption` skapar ett vanligt leverans- och faktureringsflöde. `production` använder publiceringens immutable `production_pricing` med `compensation_model`, `resolution`, avdrag/påslag eller fast ersättning, `settlement_mode`, momsbehandling, faktureringsriktning och produktionsmätroll. `settlement_mode=self_billing` skapar kredit-/självfaktureringsunderlag och får aldrig skapa vanlig konsumtionsleverans eller konsumtionsfaktura. Riktningen binds från publicerad produktversion genom quote, quote validation, kundansökan och kundavtal; klienten får inte skicka en egen alternativ riktning.

Canonical juridikroute är:

```http
GET /api/v1/website/legal-bundle
Canonical scope: website_legal.read. `website_contracts.read` accepteras endast som deprecated V1-kompatibilitet till och med kontraktsversion 2026-10-31.1 och tas bort i nästa majorversion.
```

Tenant härleds från API-nyckeln. Endpointen accepterar inte `company_id`. Sökvägen `/api/v1/website/legal/bundle` har ingen separat runtimeimplementation och ska inte användas.

## Migrering till kontraktsversion 2026-08-04.1

- läs och bevara `energy_direction` i Public Contract, quote och kundansökningssvar;
- hantera `production_pricing` och `self_billing` för produktionsavtal;
- använd den canonicala strukturerade felmodellen med `ok=false`, `code`, `message`, `request_id`, `correlation_id` och `blockers`;
- använd endast `GET /api/v1/website/legal-bundle` för juridikpaketet;
- hämta release-manifestet före specs och verifiera båda SHA-256-värdena;
- skicka dynamiska dokumentbundna `legal_acceptances`;
- generera om externa typer från den nya OpenAPI-versionen.
