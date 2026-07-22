> **Canonical uppdatering 2026-07-22.1:** Tenantidentitet, quote-livscykel, API-kanal, ETag, diagnostics och publication webhook regleras nu av [`ops-summary-1-api-completion-2026-07-22.md`](./ops-summary-1-api-completion-2026-07-22.md) och den maskinläsbara OpenAPI-filen `docs/openapi/website-integration-v1.json`. Vid konflikt gäller det nyare canonical kontraktet.

# Gridex Customer Portal API

debtRow amount = belopp exkl. moms; vatCode = SE25.

Batch 8.1 live-schema alignment: website applications require `external_customer_id krävs`, provision metering data into `public.metering_points`, and mail settings support `sender_email` / `reply_to_email`.

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

OPS löser kund inom API-nyckelns tenant i denna ordning
(implementerad i `lib/customer-portal/customerResolver.ts`):

1. länkad portal identity/account (när `auth_user_id`/portal user id skickas)
2. `external_customer_id`
3. `customer_number`
4. unik `email`

Om flera kunder matchar samma e-post returneras `409 ambiguous_customer_match` och tenant ska skicka `customer_number` eller `external_customer_id`.

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

## Dokument, fullmakt och juridiska godkännanden

Tenant ska skicka godkända fullmakter, juridiska godkännanden och dokument till OPS så OPS kan starta rätt processer.

```http
POST /api/v1/customer/sync
Authorization: Bearer YOUR_GRIDEX_API_TOKEN
Content-Type: application/json
Idempotency-Key: tenant-sync-12345
```

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

## Publicerade erbjudanden och felsökning

Hämta alltid säljerbjudanden från `GET /api/v1/website/public-contracts`. Ett internt `contract_offers` eller ett tecknat `customer_contracts` är inte automatiskt ett publicerat webberbjudande.

Vid tomt svar kan tenantens backend använda `?diagnostics=1`. Varje rad visar om erbjudandet är synligt och vilka blockerare som finns, till exempel publiceringsstatus, datum, kundtyp, prisbok, prisplansversion eller exakt juridikpaket.

`offer_reference` är den enda avtalsväljaren i POST. Skicka inte `product_code`, `price_plan_id`, `price_plan_version_id` eller internt erbjudande-UUID som alternativ väljare. Motstridiga legacyfält returnerar `422 offer_reference_mismatch`.

## Rate limits och 429

Rate limiting är per API-klient, route och fast 60-sekundersfönster. Ett normalt svar innehåller:

```text
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
```

`429 rate_limited` betyder endast att klientens verkliga kvot har överskridits. Svaret innehåller även `Retry-After`; klienten ska vänta minst så många sekunder och får inte göra en tät retry-loop.

Databas- eller deploymentsfel i rate limiter returneras separat som `503 api_rate_limiter_unavailable`. En ogiltig klientkonfiguration returneras som `503 api_rate_limit_invalid`. Dessa fel ska inte behandlas som verklig trafikbegränsning.

Standardgränsen för nya API-klienter är 120 anrop per minut. Hemsidans server ska cacha läsresultat och undvika att hämta `public-contracts` flera gånger under samma sidrendering.

## Kundansökan med strukturerad fullmakt

`POST /api/v1/website/customer-applications` accepterar ett strukturerat `powerOfAttorney`-objekt och valfri `legalAcceptances`-lista:

```json
{
  "external_customer_id": "WEB-...",
  "customer": { "type": "consumer", "first_name": "Sara", "last_name": "Karlsson", "personal_identity_number": "19900101-1234", "email": "sara@example.se" },
  "site": { "address": "Exempelgatan 1", "postal_code": "11434", "city": "Stockholm", "facility_id": null },
  "contract": { "offer_reference": "offer_opaque_reference", "requested_start_date": "asap" },
  "consents": { "terms": true, "privacy_policy": true, "withdrawal": true, "power_of_attorney": true, "price_terms": true },
  "powerOfAttorney": {
    "accepted": true,
    "scope": ["supplier_switch", "facility_information_lookup"],
    "signerName": "Sara Karlsson",
    "signerIdentityNumber": "19900101-1234",
    "method": "website_acceptance",
    "acceptedAt": "2026-06-26T09:00:00Z",
    "textVersionId": "<legal_text_version_id>",
    "ipAddress": "203.0.113.10",
    "userAgent": "Mozilla/5.0 ..."
  }
}
```

Regler:

- De fem juridikversionerna binds direkt från det valda erbjudandets exakta legal bundle. Frontend-text och tenantens senare "senaste version" litas aldrig på. `powerOfAttorney.textVersionId` måste matcha erbjudandets publicerade POA-version.
- En riktig `powers_of_attorney`-rad skapas med signer/scope/method/evidence/dokument samt händelser i `power_of_attorney_events` (`created`, `accepted`, `snapshot_created`). Det interna JSON-snapshotet skickas aldrig externt; nätägaren får alltid en PDF.
- **Identitet och alias:** kundens identitet sparas alltid i `personal_number`/`org_number`. Accepterade alias för privat identitet: `personal_number`, `personalNumber`, `personal_identity_number`, `personalIdentityNumber`, `identity_number`, `identityNumber`, `personnummer`. För företag: `org_number`, `orgNumber`, `organization_number`, `organizationNumber`, `organisation_number`, `organisationNumber`, `organisationsnummer`, `orgnr`.
- **Strukturerad fullmakt krävs för automatisk nätägarkommunikation.** För att fullmakten ska kunna skickas automatiskt krävs `powerOfAttorney.accepted=true` med `signerName`, `signerIdentityNumber` och `method`. Kundidentitet används inte som fallback för nya website-fullmakter. Ett strukturerat objekt med `accepted=true` men saknade signeringsfält returnerar `422 validation_error`. Endast `consents.power_of_attorney: true` ger en juridisk accept men en **svag** fullmakt som markeras `externally_sendable: false` / `requires_completion: true` och inte skickas externt.
- Saknas `facility_id` renderas **ingen PRODAT Z01** och **ingen `ediel_outbox`** skapas. Finns en externt sändbar fullmakt + nätägarkontakt köas en **manuell e-postbegäran** och svaret innehåller `manualInformationRequest`.
- Svaret returnerar operativ status via `nextAction` – aldrig tekniska Ediel-detaljer. Koder: `missing_customer_identity`, `missing_customer_details`, `power_of_attorney_required`, `poa_not_externally_sendable`, `grid_owner_contact_required`, `manual_mailbox_required`, `facility_identifier_requested`, `ready_for_switch`, `in_progress`.
- **Fullmakt krävs när avtalet kräver det.** När det valda avtalet publicerar en `power_of_attorney`-version (`legal.power_of_attorney_required = true`) måste ett strukturerat `powerOfAttorney` med `accepted=true` skickas. Endast `consents.power_of_attorney: true` ger `422 power_of_attorney_missing`. `powerOfAttorney.accepted=false` ger `422 power_of_attorney_not_accepted`.
- Skicka `Idempotency-Key`; upprepade anrop/klick skapar inga dubbletter. Bolaget härleds från API-nyckeln, aldrig från payload. failed idempotency ger 409 idempotent_failed. Om ett tidigare anrop med samma `Idempotency-Key` lyckades utan fullmakt men det nya anropet innehåller `powerOfAttorney`, returneras `409 idempotent_application_missing_poa` (`error.action = retry_with_new_idempotency_key_or_repair`) — använd ny nyckel eller låt en admin reparera ansökan. Om tidigare försök föll före durable site/contract-provisioning på `site_create` efter schema/migrationsfel kan OPS frigöra den gamla misslyckade idempotency-raden och låta samma retry skapa en ny komplett ansökan.
- **Do not send duplicate legal emails.** Återanvänd samma `Idempotency-Key` vid retry av samma signerade ansökan. Använd inte ny nyckel för samma juridiska submission om ni inte avsiktligt vill skapa en ny ansökan och nya juridiska mail.
- Avtalet slutmarkeras server-side som `signed` först när alla fem exakta accepter finns med samma servergenererade acceptanstid. Klientens `signed_at` eller `acceptedAt` bestämmer inte avtalets juridiska tidpunkt.
- Direkt efter signering köas avtalsbekräftelsen med en fryst PDF samt ångerrättsmail; nätägaruppslagning och leverantörsbyte får inte fördröja detta.
- `can_send_agreement_confirmation` betyder att de fem juridiska accepter­na och avtalet är redo för bekräftelse. Fältet är frikopplat från `can_start_switch`; saknad anläggning, nätägare eller bekräftat startdatum får därför inte sätta det till `false` efter lyckad signering.
- `signature_snapshot_sha256` returneras efter serververifierad signering och är SHA-256 över det frysta signeringssnapshotet. Värdet skapas av OPS och får inte skickas in av klienten.
- I den direkta responsen är `contract.confirmation_sent` och `contract.cooling_off_sent` event-/mallnycklar. Läs `communication.queued/sent/failed` för verklig status. Webhook med samma `*_sent`-namn skickas först efter providerbekräftad sändning.

## Kundtyp (kanoniska värden)

Kundens identitet normaliseras alltid till `private` eller `business`. Följande
alias accepteras inkommande och mappas automatiskt (annars `422 customer_type_invalid`):

- `private` ← `private`, `privat`, `consumer`, `person`, `privatperson`, `individual`
- `business` ← `business`, `company`, `foretag`, `företag`, `corporate`, `organization`, `organisation`, `enterprise`, `b2b`, `juridisk_person`

Avtalstillgänglighet (`public_contract_offers.customer_type`) kan dessutom vara
`both`, men det styr bara vilka erbjudanden som visas — inte kundens identitet.

## Felformat (JSON-kontrakt)

Kundansökan returnerar `422 Unprocessable Entity` för valideringsfel som kunden/tenantens backend kan rätta, till exempel `public_contract_required`, `legal_versions_missing`, `legal_acceptance_missing`, `power_of_attorney_missing` och `power_of_attorney_not_accepted`.


Alla API-fel returneras som JSON – aldrig som en HTML-sida. Standardformat:

```json
{
  "error": {
    "code": "power_of_attorney_missing",
    "message": "Power of attorney is required for this contract.",
    "stage": "power_of_attorney",
    "field": "powerOfAttorney",
    "request_id": "req_123"
  }
}
```

För bakåtkompatibilitet finns samma `code`, `field`, `error_stage`, `hint` och
`request_id` även på toppnivå. Standardkoder för kundansökan:

- `validation_error`
- `unauthorized` / `api_scope_missing`
- `public_contract_required` / `public_contract_not_available`
- `customer_type_invalid`
- `duplicate_facility_id` / `cross_tenant_facility_conflict`
- `power_of_attorney_missing`
- `power_of_attorney_not_accepted`
- `power_of_attorney_version_missing`
- `power_of_attorney_version_not_published`
- `powers_of_attorney_schema_mismatch`
- `idempotent_application_missing_poa`
- `legal_acceptance_missing`
- `website_application_failed` (internt fel)

`error.stage` är ett av: `validation`, `customer_create`, `site_create`,
`contract_create`, `legal_acceptance`, `power_of_attorney`, `facility_lookup`,
`email_dispatch`, `public_contract_lookup`, `idempotency`, `internal_error`.


## Kundnummer, fakturering och Capway/Aptic

`customer_number` är OPS/tenantens stabila kundnummer och får inte blandas ihop med `external_customer_id`. Fakturapartner som Capway/Aptic ska kopplas via separata billing-/providerfält och metadata, till exempel `billing_customer_ref`, debtor-/provider-referenser och fakturaunderlagets egna id:n.

När fakturaunderlag senare skickas till Capway/Aptic gäller regeln `debtRow amount = belopp exkl. moms`. Varje debtRow ska bära rätt momskod, till exempel `SE25` för svensk 25 procent moms. Webbansökan ska därför bara välja publicerat avtal/erbjudande från OPS; egna priser från hemsidan får inte bli juridisk eller faktureringsmässig sanning.

## Interna cron-endpoints och Resend-webhook

Manuell nätägarkommunikation drivs av interna cron-jobb och en leverans-webhook:

```txt
POST /api/internal/customer-operations/cron      Authorization: Bearer <CUSTOMER_OPERATION_CRON_SECRET|CRON_SECRET>
POST /api/internal/manual-email/outbox/process    Authorization: Bearer <MANUAL_EMAIL_OUTBOX_CRON_SECRET|EMAIL_OUTBOX_CRON_SECRET|CRON_SECRET>
POST /api/internal/manual-inbound/cron            Authorization: Bearer <MANUAL_INBOUND_CRON_SECRET|CRON_SECRET>
```

(Alla accepterar även `x-cron-secret`; manuell inbound även `x-manual-inbound-secret`.)

Resend-webhook `POST /api/webhooks/resend` verifieras mot **rå** body + Svix-huvuden + `RESEND_WEBHOOK_SECRET`. Felklasser: `missing_headers` (400), `missing_secret` (500), `resend_webhook_invalid_signature` (401), `event_processing_failed` (500). Webhooken uppdaterar `manual_email_outbox.delivery_status`; negativ leverans sätter begäran till `needs_review`. Manuell `curl` utan Svix-huvuden misslyckas avsiktligt – använd Resend-dashboardens testevent och deploya om Vercel efter ändrad miljövariabel.

## Juridik och fullmakt (legal bundle)

OPS äger all juridik och fullmaktstext. Hämta tenantens juridiska krav via:

- `GET /api/v1/website/public-contracts` – `legal`-objektet per avtal innehåller
  `*_required`, `*_version_id` och `*_url` (publika OPS-länkar) för alla fem
  juridiktyper inklusive `power_of_attorney`.
- `GET /api/v1/website/legal-bundle` – fristående `{ tenant, legal }` (scope
  `website_legal.read` eller `website_contracts.read`).

Hemsidan ska:

- läsa `power_of_attorney_required`, `power_of_attorney_version_id` och
  `power_of_attorney_url` från OPS (gissa aldrig själv),
- länka till `*_url` (OPS-hostade publika juridiksidor `/legal/{slug}/…`),
- skicka tillbaka kundens acceptans som `powerOfAttorney` (camelCase) i
  `POST /api/v1/website/customer-applications`,
- aldrig generera egen fullmakts-/juridiktext.

Svaret på en lyckad ansökan med fullmakt innehåller `power_of_attorney_id`,
`power_of_attorney` (med `text_version_id` + `document_url`), `legal_acceptances`
(id per typ) och `nextAction`. Saknas `power_of_attorney_id` när fullmakt krävs är
svaret inte success.

Se `docs/legal-power-of-attorney-platform.md` för fullständiga flöden, felkoder och
fältbeskrivningar.

## Scopes

- `website_legal.read` – hämta juridiskt paket (legal bundle)
- `customer_portal.read` – hämta Mina sidor-data
- `customer_portal.write` – skicka kompletteringar/sync
- `customer_documents.read` – läsa dokument
- `customer_documents.write` – synka dokument
- `customer_notifications.read/write` – notiser
- `customer_facility_data.write` – anläggningskomplettering
- `customer_power_of_attorney.write` – fullmakt
- `events.read` och `website_events.write` – händelser

## Felkoder

- `401 invalid_api_token`
- `403 api_scope_missing`
- `404 customer_not_found`
- `409 ambiguous_customer_match`
- `422 missing_customer_identifier`
- `500 customer_portal_internal_error`

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

`GET /api/v1/website/public-contracts?diagnostics=1` är tenant-scopad och visar `pricing_readiness.invoice_fee`. Ready-status innehåller belopp, enhet, beräkningstyp, kortsynlighet och källa. Blockerad status använder någon av:

- `invoice_fee_missing`
- `invoice_fee_conflict`
- `invoice_fee_ambiguous`

Befintliga publicerade avtal rättas versionssäkert: en ny pris- och publiceringsversion skapas och den gamla markeras `superseded`. Redan signerade kundavtal behåller sin tidigare exakta version. Entydiga draftavtal kan uppdateras via det kanoniska kommandot. Saknade eller motstridiga värden sätts aldrig automatiskt till `0`, utan hamnar i manuell remediation med auditspår.


## Canonical elområdesresolution och bytesstatus (2026-07-22.1)

Använd `POST /api/v1/website/energy-area/resolve` för elområde, nätområde och nätägare. OPS använder samma resolver som kundansökan, så webbplatsen ska inte återskapa nätområdeslogik eller välja egen källa.

Efter inskickad ansökan används `GET /api/v1/website/switch-status?application_number=APP-...` för aktuell leverantörsbytesstatus. `application_number` är tenant-skopat av API-nyckeln. Klienten får en opak `switch_reference`; interna UUID:n ska inte sparas eller användas som tenantväljare.
