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
GET /api/v1/website/public-contracts?customer_type=consumer
```

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
      "id": "public_offer_id",
      "code": "RORLIGT-ELPRIS",
      "offer_reference": "offer_opaque_reference",
      "contract_offer_id": "offer_opaque_reference",
      "name": "Rörligt elpris",
      "public_name": "Rörligt elpris",
      "contract_type": "variable_spot",
      "type": "variable_spot",
      "billing_model": "spot",
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

Teknisk diagnostik får bara visas i särskilt diagnostic-läge, inte i normal partnerrespons.

## Kundansökan

```http
POST /api/v1/website/customer-applications
```

Minsta rekommenderade payload:

```json
{
  "external_customer_id": "WEB-20260612-0001",
  "source": "elbolagets-hemsida.se",
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
    "offer_reference": "offer_opaque_reference",
    "requested_start_date": "asap"
  },
  "consents": {
    "terms": true,
    "privacy_policy": true,
    "withdrawal": true,
    "power_of_attorney": true,
    "price_terms": true
  },
  "legalAcceptances": [
    { "type": "terms", "textVersionId": "<legal_text_version_id>", "acceptedAt": "2026-06-26T09:00:00Z" },
    { "type": "privacy_policy", "textVersionId": "<legal_text_version_id>", "acceptedAt": "2026-06-26T09:00:00Z" }
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

### Strukturerad fullmakt (`powerOfAttorney`)

API:t accepterar ett **strukturerat** `powerOfAttorney`-objekt – inte bara `power_of_attorney: true`. Reglerna:

- Den juridiska texten laddas alltid från `legal_text_versions` via `textVersionId`. Frontend-text litas **aldrig** på.
- Ett låst snapshot skapas och en riktig rad i `powers_of_attorney` skrivs med `signer_name`, `signer_identity_number`, `method`, `evidence_payload`, `scope`, `source = website_api`.
- Ett oföränderligt fullmaktsdokument genereras och länkas via `document_id`.
- Händelser skrivs i `power_of_attorney_events` (`created`, `accepted`, `pdf_generated`).
- `consents.power_of_attorney: true` accepteras fortsatt för bakåtkompatibilitet, men ett strukturerat objekt rekommenderas.

### Saknat anläggnings-ID (`facility_id`)

Om `facility_id`/anläggnings-id saknas:

- **Ingen PRODAT Z01 renderas och ingen `ediel_outbox` skapas.** Z01 blockeras före render (svenskt PRODAT-krav). Ingen `render_failed` skapas och inga tekniska EDIFACT-fel (LIN_MISSING / PROFILE_REQUIRED_SEGMENT_MISSING) visas för tenant.
- Om giltig fullmakt, nätägarkontakt och en konfigurerad manuell brevlåda finns skapas en **manuell e-postbegäran** till nätägaren (separat från Ediel) och svaret returnerar ett `manualInformationRequest`-block.
- Saknas fullmakt returneras `nextAction.code = power_of_attorney_required`. Saknas nätägarkontakt returneras `grid_owner_contact_required`. Saknas manuell brevlåda returneras `manual_mailbox_required`.

### Brevlådor och kontaktvägar (separata begrepp)

Tre olika begrepp blandas aldrig ihop:

- **Manuell operationsbrevlåda** (`manual_communication_mailboxes`) = Gridex *avsändar*- och inkorgsbrevlåda för manuell nätägarkommunikation (leverantörsbyte, fullmakt, anläggningsuppgifter). Konfigureras av superadmin under `/admin/manual-mailboxes`. Standard är `leverantorsbyte@gridex.se` men adressen är konfigurerbar. Lösenord lagras aldrig i databasen – endast `env:`-referenser.
- **Nätägarens kontaktvägar** (`grid_owner_contact_channels`) = *mottagaradresser* per nätägare och kanaltyp.
- **Ediel-brevlådan** (`ediel_mailboxes`, `ediel@gridex.se`) = enbart Ediel/EDIFACT-transport (PRODAT/UTILTS/CONTRL/APERAK + Ediel IMAP/SMTP).

Manuell e-post skickas **aldrig** från `ediel@gridex.se`. Om ingen manuell brevlåda är konfigurerad blockeras sändning med ett svenskt meddelande – det sker ingen tyst fallback till Ediel-brevlådan.

### Asynkron sändning och inkommande svar

- Manuell e-post skickas inte synkront i API-svaret. Orchestratorn köar en rad i `manual_email_outbox` (status `manual_email_queued`); en intern cron-arbetare (`/api/internal/manual-email/outbox/process`, skyddad med `CRON_SECRET`) skickar via konfigurerad avsändare. UI skickar aldrig e-post direkt.
- Nätägarsvar tas emot antingen via webhook (`/api/webhooks/manual-inbound`) eller via IMAP-cron mot den manuella brevlådan (`/api/internal/manual-inbound/cron`, skyddad med `MANUAL_INBOUND_CRON_SECRET`/`CRON_SECRET`). Svar matchas mot öppen begäran via `GX-FIR`-ärendenummer; tenant härleds alltid från begäran, aldrig från brevlådan. Osäkra/ambiguösa svar auto-appliceras aldrig (status `needs_review`).

### Operativt svar (`nextAction` / `manualInformationRequest`)

Svaret innehåller endast **operativ status** – aldrig tekniska Ediel-detaljer:

```json
{
  "applicationId": "...",
  "customerId": "...",
  "siteId": "...",
  "powerOfAttorney": { "status": "signed", "scope": ["supplier_switch", "facility_information_lookup"], "method": "website_acceptance" },
  "nextAction": { "code": "facility_identifier_requested", "message": "Anläggnings-ID saknas. Uppgifter har begärts från nätägaren via e-post." },
  "manualInformationRequest": { "status": "manual_email_queued", "case_reference": "GX-FIR-AB12CD34", "channel": "manual_email", "request_id": "..." }
}
```

Möjliga `nextAction.code`:

- `power_of_attorney_required` – fullmakt skapades inte / saknas.
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
/admin/customers/[id]?tab=data-requests
/admin/customers/[id]?tab=authorization-documents
/admin/customers/[id]?tab=switch-operations
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
