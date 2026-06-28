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

1. `external_customer_id`
2. `customer_number`
3. länkad portal identity/account
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

- Den juridiska texten laddas från `legal_text_versions` via `textVersionId` – frontend-text litas aldrig på.
- En riktig `powers_of_attorney`-rad skapas med signer/scope/method/evidence/dokument samt händelser i `power_of_attorney_events` (`created`, `accepted`, `snapshot_created`). Det interna JSON-snapshotet skickas aldrig externt; nätägaren får alltid en PDF.
- **Identitet och alias:** kundens identitet sparas alltid i `personal_number`/`org_number`. Accepterade alias för privat identitet: `personal_number`, `personalNumber`, `personal_identity_number`, `personalIdentityNumber`, `identity_number`, `identityNumber`, `personnummer`. För företag: `org_number`, `orgNumber`, `organization_number`, `organizationNumber`, `organisation_number`, `organisationNumber`, `organisationsnummer`, `orgnr`.
- **Strukturerad fullmakt krävs för automatisk nätägarkommunikation.** För att fullmakten ska kunna skickas automatiskt krävs `powerOfAttorney.accepted=true` med `signerName`, `signerIdentityNumber` och `method`. Kundidentitet används inte som fallback för nya website-fullmakter. Ett strukturerat objekt med `accepted=true` men saknade signeringsfält returnerar `422 validation_error`. Endast `consents.power_of_attorney: true` ger en juridisk accept men en **svag** fullmakt som markeras `externally_sendable: false` / `requires_completion: true` och inte skickas externt.
- Saknas `facility_id` renderas **ingen PRODAT Z01** och **ingen `ediel_outbox`** skapas. Finns en externt sändbar fullmakt + nätägarkontakt köas en **manuell e-postbegäran** och svaret innehåller `manualInformationRequest`.
- Svaret returnerar operativ status via `nextAction` – aldrig tekniska Ediel-detaljer. Koder: `missing_customer_identity`, `missing_customer_details`, `power_of_attorney_required`, `poa_not_externally_sendable`, `grid_owner_contact_required`, `manual_mailbox_required`, `facility_identifier_requested`, `ready_for_switch`, `in_progress`.
- Skicka `Idempotency-Key`; upprepade anrop/klick skapar inga dubbletter. Bolaget härleds från API-nyckeln, aldrig från payload.

## Interna cron-endpoints och Resend-webhook

Manuell nätägarkommunikation drivs av interna cron-jobb och en leverans-webhook:

```txt
POST /api/internal/customer-operations/cron      Authorization: Bearer <CUSTOMER_OPERATION_CRON_SECRET|CRON_SECRET>
POST /api/internal/manual-email/outbox/process    Authorization: Bearer <MANUAL_EMAIL_OUTBOX_CRON_SECRET|EMAIL_OUTBOX_CRON_SECRET|CRON_SECRET>
POST /api/internal/manual-inbound/cron            Authorization: Bearer <MANUAL_INBOUND_CRON_SECRET|CRON_SECRET>
```

(Alla accepterar även `x-cron-secret`; manuell inbound även `x-manual-inbound-secret`.)

Resend-webhook `POST /api/webhooks/resend` verifieras mot **rå** body + Svix-huvuden + `RESEND_WEBHOOK_SECRET`. Felklasser: `missing_headers` (400), `missing_secret` (500), `resend_webhook_invalid_signature` (401), `event_processing_failed` (500). Webhooken uppdaterar `manual_email_outbox.delivery_status`; negativ leverans sätter begäran till `needs_review`. Manuell `curl` utan Svix-huvuden misslyckas avsiktligt – använd Resend-dashboardens testevent och deploya om Vercel efter ändrad miljövariabel.

## Scopes

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
