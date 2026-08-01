# Gridex API: kundintag, publicerade avtal, kundhändelser och anläggningsflöde

Det här dokumentet beskriver det interna integrationskontraktet bakom hemsida, Mina sidor och kundintag. Den publika utvecklarvänliga versionen finns på `/developers/customer-portal-api` och i `docs/external-website-api-integration-guide.md`.

## Autentisering

Alla website-endpoints använder integrationsklienter med API-nyckel.

```http
Authorization: Bearer <api_key>
Content-Type: application/json
Idempotency-Key: <stable unique key for retry-safe POST requests>
```

API-nyckeln är kopplad till exakt ett bolag. Externa system ska aldrig skicka bolags-id och förvänta sig att API:t litar på det.

Vanligt behörighetspaket för hemsida/Mina sidor:

```txt
website_contracts.read
website_applications.write
website_events.write
customer_portal.read
customer_portal.write
events.read
```

## Publicerade avtal

```http
GET /api/v1/website/public-contracts?customer_type=private
```

`customer_type` normaliseras: `private` (alias `consumer`/`person`/…) eller
`business` (alias `company`/`organisation`/…). Avtal med `customer_type = both`
visas oavsett. Tomt/okänt värde filtrerar inte på kundtyp.

Returnerar bara publicerade och hemsideaktiva avtal för bolaget som API-nyckeln tillhör.

Avtal syns bara när alla krav är uppfyllda:

```txt
publication_status = published
website_enabled = true
ej arkiverat
giltigt datum
aktiv prisversion/prisbok
komplett juridik
rätt kundtyp
API-klienten har website_contracts.read
```

Response ska vara kundvänlig och inte kräva att hemsidan förstår interna tabeller:

```json
{
  "data": [
    {
      "id": "offer_opaque_reference",
      "code": "RORLIGT-ELPRIS",
      "offer_reference": "offer_opaque_reference",
      "contract_offer_id": "offer_opaque_reference",
      "name": "Rörligt elpris",
      "public_name": "Rörligt elpris",
      "contract_type": "variable_spot",
      "type": "variable_spot",
      "billing_model": "spot",
      "customer_type": "both",
      "customer_types": ["private", "business"],
      "pricing": {
        "monthly_fee": null,
        "invoice_fee": null,
        "markup": { "amount": 4, "unit": "ore_per_kwh" },
        "fixed_price": null,
        "visibility": {
          "monthly_fee": false,
          "invoice_fee": false,
          "spot_markup": true
        },
        "components": [
          {
            "component_code": "spot_markup",
            "amount": 4,
            "unit": "ore_per_kwh",
            "website_card_visible": true
          }
        ],
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

`offer_reference` är den enda kanoniska avtalsväljaren vid tecknande. Fältet `contract_offer_id` i lässvaret är ett deprecated kompatibilitetsalias som innehåller samma opaka referens, inte ett internt UUID. `product_code`, `price_plan_id` och `price_plan_version_id` får inte användas för att välja avtal.

### Kundtyp i publik DTO

`customer_type` behålls för bakåtkompatibilitet. API:t skickar dessutom den entydiga arrayen `customer_types`:

```txt
private  -> ["private"]
business -> ["business"]
both     -> ["private", "business"]
```

Tenantens UI ska visa `both` som **Privat och företag**. Ett okänt värde får inte automatiskt behandlas som privatkund.

### Versionslåst beräkning och presentation per avgift

Varje pris- eller avgiftskomponent har separata egenskaper för beräkningspåverkan och presentation:

- `calculation_inclusion` anger `included`, `excluded` eller `conditional`;
- `website_visibility` anger `visible`, `hidden` eller `summary_only`;
- `website_card_visible` finns kvar som kompatibilitetsalias.

Alla tillämpliga komponenter finns i `pricing.calculation_components` och `pricing.components`, även när de är dolda på avtalskortet. Endast `pricing.display_components` är filtrerad för separat rendering. En dold avgift används därför fortsatt i tenantens kalkyl, checkout, avtalsunderlag och OPS interna fakturering. Ändrad presentation på ett publicerat avtal skapar en ny pris- och publiceringsversion; redan tecknade avtal skrivs aldrig om.

## Kundansökan

```http
POST /api/v1/website/customer-applications
```

Kundansökan måste skicka exakt top-level `offer_reference`, `quote_reference` och `resolution_id` från samma canonicala OPS-flöde. `contract` innehåller endast kompletterande start-/avtalsuppgifter. Legacyidentifierare utan `offer_reference` ger `422 offer_reference_required`; motstridiga identifierare ger `422 offer_reference_mismatch`.

Avtalet skapas först som `pending_signature`. När exakt fem offer-bundna juridiska accepter har sparats kör OPS en atomisk serverfunktion som sätter `status = signed`, serverns `signed_at`, permanent `withdrawal_deadline_at`, `public_contract_offer_id`, `offer_reference`, juridiksnapshot och signaturhash. Klientens egna signeringstid används inte som juridisk avtalstid.

Minsta rekommenderade payload:

```json
{
  "external_customer_id": "WEB-20260612-0001",
  "source": "elbolagets-hemsida.se",
  "offer_reference": "offer_opaque_reference",
  "quote_reference": "quote_opaque_reference",
  "resolution_id": "resolution_uuid",
  "annual_consumption_kwh": 5000,
  "start_date": "2026-07-01",
  "customer": {
    "customer_type": "private",
    "first_name": "Sara",
    "last_name": "Karlsson",
    "personal_number": "199001011234",
    "email": "sara@example.se",
    "phone": "+46700000000"
  },
  "site": {
    "street": "Exempelgatan 1",
    "postal_code": "11434",
    "city": "Stockholm",
    "move_in_date": "2026-07-01",
    "facility_id": null,
    "metering_point_id": null
  },
  "contract": {
    "requested_start_mode": "specific_date",
    "requested_start_date": "2026-07-01"
  },
  "consents": {
    "terms": true,
    "privacy_policy": true,
    "withdrawal": true,
    "power_of_attorney": true,
    "price_terms": true
  },
  "legalAcceptances": [
    {
      "type": "terms",
      "textVersionId": "<legal_text_version_id>",
      "acceptedAt": "2026-06-26T09:00:00Z"
    },
    {
      "type": "privacy_policy",
      "textVersionId": "<legal_text_version_id>",
      "acceptedAt": "2026-06-26T09:00:00Z"
    }
  ],
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
  },
  "metadata": {
    "utm_source": "website",
    "landing_page": "/elavtal"
  }
}
```

### Identitet och accepterade alias

Kundens identitet sparas alltid i de kanoniska kolumnerna `personal_number` (privat) och `org_number` (företag/förening). API:t normaliserar alla dokumenterade alias till dessa kolumner – både vid skapande och vid uppdatering av befintlig kund (en identitet som saknades vid första kontakten fylls i utan att skriva över en redan sparad identitet).

```txt
Privat identitet:   personal_number, personalNumber, personal_identity_number,
                    personalIdentityNumber, identity_number, identityNumber, personnummer
Företagsidentitet:  org_number, orgNumber, organization_number, organizationNumber,
                    organisation_number, organisationNumber, organisationsnummer, orgnr
```

Kundidentiteten normaliseras för kundregistret och kan användas vid manuell/migrerad historik, men den används **inte** för att fylla i en ny website-fullmakt. En ny fullmakt blir externt sändbar först när `powerOfAttorney.accepted=true` innehåller `signerName`, `signerIdentityNumber` och `method`.

### Strukturerad fullmakt (`powerOfAttorney`)

API:t accepterar ett **strukturerat** `powerOfAttorney`-objekt – inte bara `power_of_attorney: true`. Reglerna:

- Den juridiska texten laddas alltid från `legal_text_versions` via `textVersionId`. Frontend-text litas **aldrig** på.
- Ett låst snapshot skapas och en riktig rad i `powers_of_attorney` skrivs med `evidence_payload`, `scope`, `source = website_api`. `signer_name`, `signer_identity_number` och `method` skrivs bara från en komplett strukturerad `powerOfAttorney`, aldrig från legacy-consent eller kundfallback.
- För **automatisk** nätägarkommunikation krävs `powerOfAttorney.accepted=true` med `signerName`, `signerIdentityNumber` och `method`. Om ett strukturerat objekt skickas med `accepted=true` men saknar något av dessa fält returnerar API:t `422 validation_error`. Om endast `consents.power_of_attorney: true` skickas skapas juridisk accept/svag fullmakt, men den markeras alltid **inte externt sändbar** (`externally_sendable: false`, `requires_completion: true`).
- Ett oföränderligt **JSON-snapshot** lagras internt i `customer_documents` (`mime_type application/json`) och länkas via `document_id`/`internal_snapshot_document_id`. Detta JSON-snapshot är **enbart internt** – extern e-post till nätägaren bifogar alltid en PDF (renderad eller uppladdad signerad PDF), aldrig JSON.
- Händelser skrivs i `power_of_attorney_events`: `created`, `accepted` och `snapshot_created` (det interna JSON-snapshotet). `pdf_generated` skrivs **endast** när en riktig PDF genereras för extern kommunikation, följt av `attached_to_email`.
- `consents.power_of_attorney: true` accepteras fortsatt för bakåtkompatibilitet (juridisk accept), men legacy consent-only är **aldrig** externt sändbar. Kundidentitetsfallback får bara stödja äldre/manuellt migrerade kompletta POA-rader där signeringsnamn och metod redan finns; den får inte göra en ny website-legacy-consent sändbar.
- **Fullmakt krävs när avtalet kräver det:** när det valda avtalet publicerar en `power_of_attorney`-version (`legal.power_of_attorney_required = true`) måste ett strukturerat `powerOfAttorney` med `accepted=true` skickas, annars `422 power_of_attorney_missing` (`error.stage = power_of_attorney`). `powerOfAttorney.accepted=false` ger `422 power_of_attorney_not_accepted`.
- **Idempotens:** om en tidigare ansökan med samma `Idempotency-Key` lyckades utan fullmakt men det nya anropet innehåller `powerOfAttorney`, returneras `409 idempotent_application_missing_poa` (använd ny nyckel eller reparera via admin).
- **Partiellt fel:** om kund/anläggning/avtal skapats men fullmakten misslyckas uppdateras ansökan in-place till status `partial`/`failed` med `error_stage = power_of_attorney`, `power_of_attorney_id = null` – ingen dubblettrad skapas och ingen falsk success kvarstår.
- Alla API-fel returneras som JSON: `{ "error": { "code", "message", "stage", "field", "request_id" } }` – aldrig som HTML.

### Saknat anläggnings-ID (`facility_id`)

Om `facility_id`/anläggnings-id saknas:

- **Ingen PRODAT Z01 renderas och ingen `ediel_outbox` skapas.** Z01 blockeras före render (svenskt PRODAT-krav). Ingen `render_failed` skapas och inga tekniska EDIFACT-fel (LIN_MISSING / PROFILE_REQUIRED_SEGMENT_MISSING) visas för tenant.
- Om en **externt sändbar** fullmakt, nätägarkontakt och en konfigurerad manuell brevlåda finns skapas en **manuell e-postbegäran** till nätägaren (separat från Ediel) och svaret returnerar ett `manualInformationRequest`-block.
- Om fullmakten bara är legacy/svag skapas ingen `manual_email_outbox`; svaret får `nextAction.code = poa_not_externally_sendable`.
- Saknas fullmakt returneras `nextAction.code = power_of_attorney_required`. Saknas nätägarkontakt returneras `grid_owner_contact_required`. Saknas manuell brevlåda returneras `manual_mailbox_required`.

### Brevlådor och kontaktvägar (separata begrepp)

Tre olika begrepp blandas aldrig ihop:

- **Manuell operationsbrevlåda** (`manual_communication_mailboxes`) = Gridex _avsändar_- och inkorgsbrevlåda för manuell nätägarkommunikation (leverantörsbyte, fullmakt, anläggningsuppgifter). Konfigureras av superadmin under `/admin/manual-mailboxes`. Standard är `leverantorsbyte@gridex.se` men adressen är konfigurerbar. Lösenord lagras aldrig i databasen – endast `env:`-referenser.
- **Nätägarens kontaktvägar** (`grid_owner_contact_channels`) = _mottagaradresser_ per nätägare och kanaltyp.
- **Ediel-brevlådan** (`ediel_mailboxes`, `ediel@gridex.se`) = enbart Ediel/EDIFACT-transport (PRODAT/UTILTS/CONTRL/APERAK + Ediel IMAP/SMTP).

Manuell e-post skickas **aldrig** från `ediel@gridex.se`. Om ingen manuell brevlåda är konfigurerad blockeras sändning med ett svenskt meddelande – det sker ingen tyst fallback till Ediel-brevlådan.

### Asynkron sändning och inkommande svar

- Manuell e-post skickas inte synkront i API-svaret. Orchestratorn köar en rad i `manual_email_outbox` (status `manual_email_queued`); en intern cron-arbetare skickar via konfigurerad avsändare. UI skickar aldrig e-post direkt.
- När en `manual_email_outbox`-rad skickas (`status = sent`) sätts den länkade begäran till `status = waiting_manual_response` och `dispatch_status = waiting_response` med `sent_at`. En skickad rad lämnar **aldrig** begäran kvar med `dispatch_status = not_started` (en backfill reparerar historiska rader).
- Nätägarsvar tas emot antingen via webhook (`/api/webhooks/manual-inbound`) eller via IMAP-cron mot den manuella brevlådan. Svar matchas mot öppen begäran via `GX-FIR`-ärendenummer; tenant härleds alltid från begäran, aldrig från brevlådan. Osäkra/ambiguösa svar auto-appliceras aldrig (status `needs_review`).

### Interna cron-endpoints och autentisering

Alla interna cron-endpoints kräver ett delat hemligt token via `Authorization: Bearer <token>` eller `x-cron-secret: <token>` (manuell inbound accepterar även `x-manual-inbound-secret`).

```txt
POST /api/internal/customer-operations/cron      CUSTOMER_OPERATION_CRON_SECRET | CRON_SECRET
POST /api/internal/manual-email/outbox/process   MANUAL_EMAIL_OUTBOX_CRON_SECRET | EMAIL_OUTBOX_CRON_SECRET | CRON_SECRET
POST /api/internal/manual-inbound/cron           MANUAL_INBOUND_CRON_SECRET | CRON_SECRET (även x-manual-inbound-secret)
```

Bolag (`company_id`) härleds alltid internt – manuell inbound avvisar `company_id`-override med 400.

### Resend-webhook (leveransstatus) och felsökning

Manuell e-post levereransspåras via Resend-webhooken `POST /api/webhooks/resend`.

- Verifieras alltid mot **rå** request-body med Svix-huvuden (`webhook-id`/`webhook-timestamp`/`webhook-signature`) och `RESEND_WEBHOOK_SECRET`.
- Felklasser (diagnostik):
  - `missing_headers` (400) – Svix-huvuden saknas.
  - `missing_secret` (500) – `RESEND_WEBHOOK_SECRET` saknas i miljön.
  - `resend_webhook_invalid_signature` (401) – signaturen matchar inte.
  - `event_processing_failed` (500) – signaturen var giltig men efterbearbetning misslyckades (returnerar **aldrig** 401 efter verifierad signatur).
- Webhooken uppdaterar `manual_email_outbox.delivery_status` (`sent`/`delivered`/`delivery_delayed`/`bounced`/`complained`/`failed`/`suppressed`). Matchning sker på `provider_message_id`. Provider-eventet lagras i `communication_log_events` och får `company_id` från `manual_email_outbox` även när det inte finns någon `communication_log`.
- Negativ leverans (`bounced`/`complained`/`failed`/`suppressed`) sätter den länkade begäran till `needs_review` med tenant-meddelandet: `E-post till nätägaren kunde inte levereras. Kontrollera kontaktväg.`
- Manuell `curl` utan giltiga Svix-huvuden misslyckas **avsiktligt** (401). Använd Resend-dashboardens testevent. `RESEND_WEBHOOK_SECRET` måste vara den exakta signeringshemligheten för exakt den endpoint som används, och Vercel måste deployas om efter att miljövariabeln ändrats.

### Operativt svar (`nextAction` / `manualInformationRequest`)

Svaret innehåller endast **operativ status** – aldrig tekniska Ediel-detaljer:

```json
{
  "applicationId": "...",
  "customerId": "...",
  "siteId": "...",
  "powerOfAttorney": {
    "status": "signed",
    "scope": ["supplier_switch", "facility_information_lookup"],
    "method": "website_acceptance"
  },
  "nextAction": {
    "code": "facility_identifier_requested",
    "message": "Anläggnings-ID saknas. Uppgifter har begärts från nätägaren via e-post."
  },
  "manualInformationRequest": {
    "status": "manual_email_queued",
    "case_reference": "GX-FIR-AB12CD34",
    "channel": "manual_email",
    "request_id": "..."
  }
}
```

Möjliga `nextAction.code`:

- `missing_customer_identity` – kundens person-/organisationsnummer saknas och måste kompletteras innan fullmakt kan skickas externt.
- `missing_customer_details` – kundnamn eller andra obligatoriska kunduppgifter saknas.
- `power_of_attorney_required` – fullmakt skapades inte / saknas.
- `poa_not_externally_sendable` – fullmakt finns men saknar signeringsuppgifter (namn/identitet/metod) och kan inte skickas automatiskt till nätägaren. Komplettera med strukturerad `powerOfAttorney`.
- `grid_owner_contact_required` – nätägarens kontaktväg saknas.
- `manual_mailbox_required` – ingen manuell operationsbrevlåda är konfigurerad (lägg till avsändaradress i superadmin).
- `facility_identifier_requested` – manuell e-postbegäran köad (anläggnings-ID saknas).
- `ready_for_switch` – allt klart, leverantörsbyte kan fortsätta.
- `in_progress` – ansökan behandlas.

### Idempotens

Skicka `Idempotency-Key` på POST. Upprepade anrop (samma nyckel) eller upprepade klick skapar inte dubbletter: den öppna manuella begäran återanvänds och `manual_email_outbox` har en unik `idempotency_key`. Bolaget härleds alltid från API-klienten (autentiserad kontext), aldrig från payload.

Processregler:

1. API:t löser bolag från API-klienten.
2. Valt publicerat avtal valideras mot samma bolag.
3. Kund matchas eller skapas med idempotency och duplicate-skydd.
4. Kundnummer sätts och `customer_number.assigned` skapas när numret faktiskt tilldelas.
5. Anläggning och mätpunkt skapas när data finns.
6. Kundavtal och låst avtalssnapshot skapas.
7. Juridiska godkännanden och strukturerad fullmakt sparas med snapshot, dokument och händelser.
8. Anläggnings-/nätägardata resolveras när information finns.
9. Saknas anläggnings-ID blockeras Z01 och en manuell e-postbegäran köas (om fullmakt + kontakt finns); annars sätts `nextAction` till `power_of_attorney_required`/`grid_owner_contact_required`.
10. Domain events skapas och webhook-leveranser köas.

## Kundevents från hemsida

```http
POST /api/v1/website/customer-events
```

Tillåtna kundevents gäller operativa kundhändelser. Support- och case-events är utanför scope och ska avvisas med `422 support_out_of_scope`.

Exempel:

```json
{
  "event_type": "customer.opened_contract",
  "external_customer_id": "WEB-20260612-0001",
  "occurred_at": "2026-06-12T09:00:00Z",
  "payload": {
    "contract_number": "AVT-DX-100023-001"
  },
  "metadata": {
    "page": "/mina-sidor/avtal"
  }
}
```

## Anläggningsflöde / arbetskö

Anläggningsdata hanteras i kundplattformen. Hemsidan ska inte tvinga kunden att själv välja nätägare manuellt.

Regler:

```txt
Adress/postnummer = förslag eller stark match.
Nätområde/anläggnings-id/mätpunkt/adminbekräftelse = verifierad sanning.
Leverantörsbyte blockeras tills anläggningsdata är tillräckligt verifierad.
```

Adminytor:

```txt
/admin/facility-requests
/admin/work-queue
/admin/customers/[id]#data-requests
/admin/customers/[id]#avtal
/admin/customers/[id]#leverantorsbyte
```

Statusar:

```txt
missing_authorization      Fullmakt saknas; outbound till nätägare blockeras.
needs_facility_data        Anläggnings-id, mätpunkt eller elområde saknas.
needs_grid_owner_review    Nätägare/nätområde är inte verifierat nog.
awaiting_grid_owner        Begäran skickad/köad; inväntar svar eller manuell komplettering.
ready_for_switch           Data räcker för leverantörsbyte.
manual_review              Kan inte automatiseras säkert; admin måste granska.
```

## Kundkortets operativa flöde

1. Öppna kunden från `/admin/work-queue`, `/admin/facility-requests` eller `/admin/external-contract-intakes`.
2. Läs topstatus och anläggningskortet.
3. Om fullmakt saknas: gå till `Fullmakt / avtal`.
4. Om anläggningsdata saknas: gå till `Uppgiftsbegäran`.
5. Om data är komplett: gå till `Leverantörsbyte`.
6. Gör inte normal manuell nätägar-override om systemet kan lösa verifierad aktör.

## Webhook-händelser

Första eventlistan:

```txt
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

`contract.confirmation_sent` och `contract.cooling_off_sent` ska kopplas till faktisk kommunikations-/mailstatus, inte bara till att ansökan skapats.

## Implementation files

```txt
app/api/v1/website/public-contracts/route.ts
app/api/v1/website/customer-applications/route.ts
app/api/v1/website/customer-events/route.ts
app/api/internal/webhooks/dispatch/route.ts
app/admin/facility-requests/page.tsx
components/admin/customers/CustomerFacilityWorkflowCard.tsx
lib/facility/workQueue.ts
lib/integrations/webhooks.ts
```

## Governance, audit och cleanup

- Endast platform admin/superadmin får skapa, redigera eller publicera kommersiell/juridisk sanning.
- Bolagsadmin får arbeta med kunder och processer utifrån redan publicerade avtal och villkor.
- Hemsidan ska alltid först hämta publicerade avtal via `GET /api/v1/website/public-contracts`.
- Hemsidan skickar sedan valt `offer_reference` till `POST /api/v1/website/customer-applications`.
- Hemsidan får inte skicka interna prisplan-id, månadsavgift, påslag eller juridiska villkor som source of truth.
- Kundkortets actions ska logga både audit och usage-events där det påverkar juridik, spårbarhet eller framtida fakturering.
- Riktig kunddata arkiveras i första hand. Hårdradering ska bara användas för säker testdata utan historiska beroenden.

## Canonical portföljprissättning och procentbaser (2026-07-18.2)

Portföljandel, portföljpris och portföljförvaltningsavgift är tre separata begrepp:

- `portfolio_share` anger hur stor andel av kundens kWh som prissätts med portföljpris.
- `pricing.portfolio_monthly_prices` innehåller det publicerade priset per `period_month`, `price_area_code` och exakt `price_plan_version_id`.
- `pricing.portfolio_management_fee` är en separat avgiftskomponent och kan anges i bland annat `ore_per_kwh`, `sek_per_kwh`, `sek_month`, `sek_invoice`, `sek_once` eller `percent`.

Procentvärden representeras alltid som `0..100`. En procentkomponent måste ha `calculation_base`, exempelvis `portfolio_cost`, `spot_cost`, `energy_cost_ex_vat` eller `invoice_subtotal`. Samma bas används av offertkalkyl, checkout, signerad prissnapshot och faktureringsmotor.
Månadens energipris kan vara noll eller negativt när det publicerade marknadsutfallet kräver det. Avgifter, påslag och procentkomponenter får däremot inte vara negativa.
API och checkout får aldrig återanvända en äldre månad som fallback. Publik readiness kräver exakt pris för den senare av avtalsstartens månad och aktuell månad i Europe/Stockholm.

```json
{
  "pricing": {
    "portfolio_management_fee": {
      "amount": 3,
      "unit": "percent",
      "calculation_base": "portfolio_cost"
    },
    "portfolio_monthly_prices": [
      {
        "price_plan_version_id": "00000000-0000-4000-8000-000000000000",
        "period_month": "2027-02-01",
        "price_area_code": "SE4",
        "amount": 81.1,
        "unit": "ore_per_kwh",
        "vat_included": false,
        "status": "published"
      }
    ]
  }
}
```

Ett bindande prisförslag returnerar `422 portfolio_price_missing` när exakt publicerat/bekräftat månadspris saknas för avtalets prisplansversion, månad och elområde. Systemet använder aldrig `0`, annan tenants pris eller en annan prisplansversions pris som tyst fallback.

Fakturering sker per månadsunderlag. En fakturaperiod som omfattar flera månader består därför av separata underlag/prisrader för respektive månad och behåller `portfolio_monthly_price_id`, prisplansversion, elområde, förbrukning, enhetspris, beräkningsbas och moms som revisionsbevis.

`pricing.visibility.portfolio_price` och komponentens `website_card_visible` påverkar endast tenantens publika avtalskort. Dolda avgifter och priser finns fortfarande kvar i bindande prisöversikt, avtalssnapshot och fakturering.

## Canonical fastpris, quote och teckningsflöde (`2026-08-01.1`)

Den aktiva integrationsordningen är:

1. `GET /api/v1/website/public-contracts` hämtar varje publicerad produkt **en gång**. Ett fastprisavtal kan innehålla `area_pricing` med separata rader för SE1–SE4, men raderna tillhör samma `offer_reference`, produktversion och publicering.
2. `POST /api/v1/website/energy-area/resolve` använder OPS tenant-skopade canonical resolver för prisområde, nätområde och nätägare. Den gamla oautentiserade `GET /api/public/energy-area` är fortsatt borttagen.
3. `POST /api/v1/website/quote` skapar en tenantbunden quote som fryser exakt publicerad version, valt SE-område, vald områdesprisrad, förbrukning, startdatum, avgifter, moms och beräkningsantaganden.
4. `POST /api/v1/website/quote/validate` validerar samma bindning före teckning.
5. `POST /api/v1/website/customer-applications` konsumerar `quote_reference`, skapar eller återanvänder en canonical kund och ett kundnummer, skapar en anläggningsbunden avtalsrelation och låser vald SE-prisrad i avtalets pris-/faktureringssnapshot. Kundansökan kräver canonical `quote_reference` och samma `resolution_id`; ingen legacyfallback skapar avtal utan quote.

`resolution_id` är obligatoriskt i quote och teckning. OPS läser området genom `company_id + resolution_id`, kontrollerar expiry, automation-readiness, resolverversion och geodataversion och avvisar motstridigt `price_area` eller `grid_area_code`. För rörliga avtal innehåller quoten en additiv `market_reference` med provider, referensperiod, `as_of`, `is_indicative`, `is_stale` och fallbackmetadata. Preview får aldrig användas som settlement.

För fastpris gäller:

- `area_pricing` är den canonicala prismatrisen för samma produkt, inte fyra avtal;
- `fixed_price_ore_per_kwh` och `pricing.fixed_price` är kompatibilitetsfält och är `null` när SE-områdena har olika priser;
- kunden och kundportalen ser bara det avtal och den områdesprisrad som hör till kundens anläggning;
- en kund med flera verkliga anläggningar kan ha en avtalsrelation per anläggning, men inte en ny kund eller fyra produktkopior per prisområde;
- faktureringen använder den immutable valda prisraden, inte dagens publicerade webbpris.

`pricing.calculation_components` och kompatibilitetsfältet `pricing.components` innehåller alla tillämpliga pris- och avgiftskomponenter. Dolda komponenter får inte filtreras bort från kalkyl, quote, avtalssnapshot eller fakturering. `pricing.display_components` styr endast vilka komponenter som får visas som separata sälj-/avtalsrader.

För penningvärden gäller:

- `0` är ett giltigt publicerat numeriskt värde och betyder avgiftsfritt;
- blankt, `null` och `undefined` betyder inte automatiskt `0`;
- använd aldrig truthy/falsy-kontroller för pengar;
- kontrollera uttryckligen `value === null || value === undefined`.

Aktiva scopes är `website_contracts.read`, `website_energy_area.resolve`, `website_market_prices.read`, `website_quotes.write`, `website_quotes.validate` och `website_applications.write`. API-svaret innehåller `contract_schema_version=2026-08-01.1`; versionsvärdet ingår i ETag-underlaget.
