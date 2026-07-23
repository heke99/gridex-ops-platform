> **Ersatt av API 2026-07-23.1.** Detta dokument beskriver den historiska implementationen vid lanseringen den 18 juli 2026. Nuvarande externa tenantkontrakt finns i `docs/external-website-api-integration-guide.md`. Dolda avgifter skickas numera alltid i `calculation_components`, medan `display_components` endast styr presentationen. Tenantautentiserad canonical quote och elområdesresolver återinfördes i 2026-07-23.1; endast den publika legacyresolvern är borttagen.

# Public pricing visibility and customer-type normalization

Date: 2026-07-18
API contract version: `2026-07-20.2`

## Purpose

Each immutable price component now has a separate website-card visibility decision. The decision changes presentation only. A hidden component remains part of pricing, quote calculation, checkout disclosure, the locked contract snapshot, contract documents and invoicing.

## Canonical model

The source of truth is the immutable `price_plan_versions.snapshot_json` document:

- `schema_version = 3`
- `website_visibility.<component_key>` stores the version-level policy.
- Every `price_components[]` item stores `website_card_visible`.
- Every component also stores `metadata.visibility` for website card, quote breakdown, checkout, contract document and invoice.

`price_components.website_card_visible` materializes the same decision for operational queries. Migration `20260718001000_public_pricing_component_website_visibility.sql` adds the column and keeps it synchronized with component metadata.

## Admin behavior

The platform-admin contract form contains a **Visa på hemsidans avtalskort** control beside each supported price or fee. Unchecked ancillary fees are not exposed on the public contract card. Fixed price and spot markup remain checked by default because they normally identify the product price.

Optional fee lines support a fourth pipe-delimited value:

```text
Etablering | 395 | sek_contract | nej
Pappersfaktura | 39 | sek_invoice | ja
```

Changing the visibility of a published price requires a new immutable price/publication version. Previously signed customer contracts retain their original snapshots.

## Public API behavior

`GET /api/v1/website/public-contracts`:

- exposes only website-visible named pricing fields;
- exposes only website-visible entries in `pricing.components`;
- sanitizes the compatibility fields and public pricing snapshot;
- returns `pricing.visibility` so consumers can apply the same policy;
- returns both the backward-compatible singular `customer_type` and canonical `customer_types`.

Customer-type expansion is:

```text
private  -> ["private"]
business -> ["business"]
both     -> ["private", "business"]
```

## Tenant website behavior

The tenant website must prefer `customer_types` over the singular compatibility field and must never treat an unknown value as a private customer. The included Gridex Web patch renders `both` as **Privatkund och Företag**.

The tenant card needs no fee-specific hardcoding: hidden public fields are `null` and hidden components are absent from the API response.

## Verification

Run:

```bash
npm run db:migrations:check
npm run gridex:public-pricing-visibility-regression
npm run api:contract
npm test
npm run build
```

After applying the migration and republishing a test offer, verify that hidden fees remain in the locked price snapshot but are absent from the public DTO and tenant contract card.

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

