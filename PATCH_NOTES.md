# Gridex OPS canonical price-option/API completion

Datum: 2026-07-30
Kontraktsversion: `2026-07-30.3`
Releasebeslut: **NO-GO tills miljögrindarna i VERIFICATION.md är gröna**

## Levererat

- Publication-bound canonical price options med `customer_type`, exakt ett
  defaultalternativ och en gemensam `selection_required`-policy.
- Deterministisk backfill till entydiga publiceringar; osäkra rader lämnas
  orörda och registreras i `contract_pricing_migration_reviews`.
- Atomisk publish-time-materialisering och validering av alternativ,
  SE-områdespriser, tenant, produkt/prisplan, kundtyp och giltighet.
- Top-level `PublicContract.price_options` med stabila option-, områdes-,
  komponent- och dokumentreferenser.
- Samma immutable kommersiella assertioner genom quote, quote validate och
  customer application: alternativ, fakturametod, komponenter och site count.
- Explicit slutdefinition av `gridex_onboard_customer_graph(jsonb)` utan
  textreplacement som slutlig entry point.
- Harmoniserad legal runtime/OpenAPI-identitet med både dokument-UUID och
  stabil `document_reference`.
- Slutna publika scheman samt förstärkta reachability-, runtime-fixture-,
  dokumentationsexempel-, kompatibilitets- och releasekontroller.
- Portalavtalets `signature_snapshot_sha256` återställt i DTO och OpenAPI efter
  att slutgrinden upptäckte den äldre kontraktsdriften.

## Releaseartefakter

- Website OpenAPI SHA-256:
  `fdabd8196ae94482cd22928bf624b69ffe6a246e47b0781d698ec1701c80d6b2`
- Customer Portal OpenAPI SHA-256:
  `93d4cb523515948dae2f168b8cab629e1ef1d8238ddb8322b8ca75aa8a46d1f9`

## Ny migration

1. `supabase/migrations/20260730220000_canonical_price_option_publication_api_completion.sql`
   - SHA-256:
     `0ab350f0da6648a497a80aeaedc1688eb5ae88e6279d6ab486526c070ff8c505`
2. Efter applicering, kör den read-only kontrollen
   `scripts/gridex-canonical-price-options-post-apply.sql`.

Historiska migrationer har inte ändrats.

## Viktig avgränsning

Underlaget innehöll endast Gridex OPS. Gridex Web har inte ändrats eller
verifierats. PostgreSQL-migreringen har inte applicerats i en auktoriserad
databas och release `2026-07-30.3` har inte driftsatts från arbetsmiljön.
