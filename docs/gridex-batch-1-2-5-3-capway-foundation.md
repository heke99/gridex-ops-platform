# Gridex Batch 1, 2, 5 och 3 — Capway/Aptic och faktureringsfoundation

## Batch 1 — Pricing unit + UI + regression

- Admin väljer explicit enhet: öre/kWh, kr/kWh, kr/månad, kr/faktura, procent eller engångsbelopp.
- `unit` är source of truth. `calculation_type` och `component_type` används bara som legacy fallback.
- `ore_per_kwh` räknas som `amount / 100`.
- `sek_per_kwh`, `sek_month`, `sek_invoice` och `sek_once` används direkt som SEK-baserade värden.
- Fakturarader sparar metadata för vald enhet, normaliserad enhet och visningsenhet.

## Batch 2 — Billing readiness + invoice readiness + period lock

- Fakturaperiod får inte ändras när den är låst för invoice export.
- `evaluateBillingMonthInvoiceReadiness` kontrollerar faktureringsunderlag, readiness, prisberäkning, avtal och prissnapshot.
- `lockBillingPeriodForInvoiceExport` låser fakturamånad efter lyckad export.
- `generateBillingUnderlaysForMonth` blockerar ny generering på låst fakturaperiod.

## Batch 5 — Capway/Aptic adapter foundation

- Provider-neutral datamodell: `billing_provider_connections`, `invoice_export_runs`, `invoice_export_items`, `invoice_provider_events`, `invoice_purchase_events`, `invoice_documents`, `invoice_dead_letters`.
- Capway/Aptic-klient med OAuth2 client credentials/GetToken, token-cache och API-anrop.
- Faktura skapas med `PUT /v1/Invoices`.
- Stöd för finansieringslägen:
  - `invoice_service`
  - `factoring_without_recourse`
  - `factoring_with_recourse`
  - `manual`
- Stöd för purchase efter fakturaskapande via `/v1/Invoices/{invoiceGuid}/Purchase`.
- Status-sync foundation för invoice, financial details, purchase och recourse.
- Webhook-mottagare matchar invoiceGuid till exportpost när provider skickar event.

## Batch 3 — Kund/aktör/onboarding ren UI

- Kundintag visar steg: Kund → Anläggning → Avtal → Automatik.
- Kundflödet förtydligar att tenant-admin ska välja verifierade aktörer.
- Nätägare/elleverantörer har migration för `verified_for_customer_flow`, `technical_owner_only` och `actor_registry_status`.
- Network owner/supplier admin-sidor tydliggör att Ediel-id, subadress, certifikat och transport bara ska hanteras av platform/teknisk admin.

## Miljövariabler för Capway/Aptic test

```text
CAPWAY_APTIC_TEST_TOKEN_URL
CAPWAY_APTIC_TEST_BASE_URL
CAPWAY_APTIC_TEST_CLIENT_ID
CAPWAY_APTIC_TEST_CLIENT_SECRET
```

Production motsvarigheter:

```text
CAPWAY_APTIC_PROD_TOKEN_URL
CAPWAY_APTIC_PROD_BASE_URL
CAPWAY_APTIC_PROD_CLIENT_ID
CAPWAY_APTIC_PROD_CLIENT_SECRET
```

## Capway debtRow momsregel

Capway/Aptic ska få radbelopp exklusive moms i varje `debtRow`. Varje rad måste också ha aktuell `vatCode`. Svensk 25 procent moms skickas som `SE25`.

Exempel för svensk 25 procent moms:

```json
{
  "description": "Fast månadsavgift",
  "itemNetAmount": 49,
  "rowPrincipalAmount": 49,
  "includingVAT": false,
  "vatAmount": 12.25,
  "vatCode": "SE25"
}
```

Skicka inte belopp inklusive moms i `debtRows`. Export ska blockeras om `vatCode` saknas, om `includingVAT` inte är `false`, eller om radbeloppet verkar vara inklusive moms. Moms ska styras från pricing line VAT rate: 25 procent → `SE25`, 12 procent → `SE12`, 6 procent → `SE6`, 0 procent → `SE0`.

## Viktiga blockerare innan skarp produktion

- Provider-koder från Capway: `service`, `paymentCode`, `printCode`, `formCode`, `paymentProductCode`, `preferredChannel`, `vatCode`, `debtGroup`, `accountChartCode`.
- Bekräftat token body-format och eventuell scope/audience.
- Godkänd testpayload för privatkund, företagskund, fakturaköp utan regress, fakturaköp med regress, kreditfaktura och dispute.
- Beslut om Capway webhooks eller polling.
