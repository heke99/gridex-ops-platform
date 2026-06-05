# Platform Billing, Usage Statistics and Tenant Pricing

## Purpose

The platform must track what each electricity company/tenant uses so Gridex/Div3rsa can invoice the tenant for platform services.

This is separate from the electricity company's own customer billing.

There are two billing domains:

1. Customer billing underlay
   - electricity company billing its own end customers

2. Platform billing / tenant usage billing
   - Gridex/Div3rsa billing the electricity company for system usage and operations

These must not be mixed.

## Admin-configurable pricing

Platform pricing must not be hardcoded.

Superadmin/platform admin must be able to configure usage prices in UI.

There should be a sidebar section for platform billing/pricing settings.

Suggested Swedish UI names:

- Plattform
- Debitering
- Prisinställningar
- Användningspriser
- Kundbolagsdebitering
- Fakturering mot elbolag
- Plattformdebitering

Recommended sidebar item:

- Plattformdebitering

or

- Prisinställningar

## Default usage prices

The system may seed default prices, but admin must be able to change them.

Default examples:

- API-tillgång för kundwebb: 5 000 SEK
- Fullmaktshantering - Komplett fullmakt: 30,00 SEK
- Fullmaktshantering - Enbart anläggningsuppgifter: 20,00 SEK
- Flyttfullmakt för tecknande av nätavtal: 60,00 SEK
- Leverantörsbyte Z03: 6,00 SEK
- Cancellering leverantörsbyte Z03C: 7,00 SEK
- Uppsägning av elavtal: 5,00 SEK
- Uppsägning av avtalsmäklare: 5,00 SEK
- Export av fakturaunderlag: 2,00 SEK

All prices should support:

- amount
- currency, default SEK
- VAT setting if needed
- active/inactive
- effective from date
- effective to date
- description
- internal code
- unit type
- tenant override if needed

## Usage event principle

The system should track billable usage events.

Each usage event should include:

- company_id / tenant
- usage type
- quantity
- unit price snapshot
- currency
- occurred_at
- source
- related customer if applicable
- related site if applicable
- related metering point if applicable
- related supplier switch if applicable
- related power of attorney if applicable
- related billing export if applicable
- related Ediel message if applicable
- status
- billable yes/no
- excluded reason if not billable
- audit metadata

## Billable usage types

Initial billable usage types may include:

### API / customer portal

- customer_portal_api_access
- label: API-tillgång för kundwebb
- default price: 5 000 SEK
- unit: monthly / tenant / feature

### Powers of attorney / fullmakter

- poa_complete
- label: Fullmaktshantering - Komplett fullmakt
- default price: 30 SEK
- unit: per completed fullmakt

- poa_site_info_only
- label: Fullmaktshantering - Enbart anläggningsuppgifter
- default price: 20 SEK
- unit: per request/fullmakt

- poa_move_grid_agreement
- label: Flyttfullmakt för tecknande av nätavtal
- default price: 60 SEK
- unit: per fullmakt/request

### Supplier switching

- supplier_switch_z03
- label: Leverantörsbyte Z03
- default price: 6 SEK
- unit: per sent/processed switch

- supplier_switch_z03c_cancel
- label: Cancellering leverantörsbyte Z03C
- default price: 7 SEK
- unit: per sent/processed cancellation

### Agreement termination

- agreement_termination
- label: Uppsägning av elavtal
- default price: 5 SEK
- unit: per termination

- broker_agreement_termination
- label: Uppsägning av avtalsmäklare
- default price: 5 SEK
- unit: per termination

### Billing/export

- billing_underlay_export
- label: Export av fakturaunderlag
- default price: 2 SEK
- unit: per exported item or per export row

## Pricing UI

Superadmin must be able to:

- view all usage price items
- edit prices
- activate/deactivate price items
- set effective date
- create tenant-specific override
- see usage statistics
- generate platform billing report
- export usage report
- see audit history for price changes

Regular tenant admins may see their own usage summary if allowed, but should not edit prices.

## Tenant-specific pricing

The system should support:

- global default price
- tenant-specific price override
- campaign/intro pricing
- free period
- manual discount
- non-billable tenant setting if needed
- included monthly volume if needed later

Do not hardcode Div3rsa-specific pricing into usage logic.

## Usage statistics

Superadmin statistics should include:

- usage per tenant
- usage per month
- usage per service type
- total billable amount per tenant
- non-billable events
- failed/excluded usage events
- billing exports count
- fullmakter count
- supplier switch count
- API access active tenants
- trends over time

Tenant statistics may include:

- number of fullmakter
- number of supplier switches
- number of billing exports
- API/customer portal status
- monthly usage summary if business decision allows

## Platform billing report

The platform should be able to create a report per tenant and billing period.

Report should include:

- tenant/company
- billing period
- usage type
- description
- quantity
- unit price
- amount excluding VAT
- VAT if applicable
- total
- related records summary
- generated_at
- generated_by
- status

Statuses:

- draft
- reviewed
- finalized
- exported
- cancelled

Do not silently regenerate finalized reports.

If usage changes after finalization:

- create adjustment line
- require manual review
- audit the change

## Audit

Audit must track:

- usage price created
- usage price changed
- usage price deactivated
- tenant override created/changed
- usage event created
- usage event excluded from billing
- platform billing report generated
- platform billing report finalized
- platform billing report exported
- manual adjustment created

## UI language

Use simple Swedish business terms.

Good tenant/superadmin labels:

- Plattformdebitering
- Användning
- Prisinställningar
- Debiteringshändelser
- Fakturaperiod
- Antal
- Pris/st
- Belopp
- Exportera rapport
- Skapa fakturaunderlag
- Ej debiterbar
- Justering

Avoid technical-first labels in main UI:

- usage_event_type_enum
- platform_billing_item_code
- raw_usage_counter
- internal_metering

Advanced diagnostics may show internal codes.

## Cursor implementation rule

When implementing platform billing and usage pricing:

1. Search for existing billing/export/statistics tables first.
2. Keep customer billing underlay separate from platform tenant billing.
3. Do not hardcode prices in business logic.
4. Use configurable price records.
5. Store price snapshot on usage event/report line.
6. Add audit for price changes and report generation.
7. Add tenant isolation.
8. Prevent duplicate usage events where applicable.
9. Prevent duplicate finalized billing reports for same tenant/period.
10. Keep UI simple and Swedish.
11. Update sidebar with clear section if implementation is requested.
12. Update changelog and context.
