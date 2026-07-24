# Arkiverad API-sammanfattning från 2026-07-22

Det tidigare innehållet i denna fil beskrev en parallell arkitektur där tenantens webb själv löste elområde och hämtade indikativt marknadspris. Den modellen är ersatt och får inte användas som implementations- eller integrationsunderlag.

Aktuellt canonicalt kontrakt är **API 2026-07-24.2**:

- `docs/canonical-market-resolution-quote-billing-flow-2026-07-24.md`
- `docs/external-website-api-integration-guide.md`
- `docs/gridex-customer-portal-api.md`
- `docs/openapi/website-integration-v1.json`
- `docs/openapi/customer-portal-v1.json`

Gällande principer:

1. OPS äger tenantbunden elområdesresolution.
2. OPS äger och validerar canonical quote.
3. Tenant visar OPS preview men bygger inte om priset.
4. Preview är indikativt och får aldrig användas som settlement.
5. Fakturering använder verifierad och explicit låst settlementdata tillsammans med kundavtalets immutable pricing snapshot.
6. Klientinskickat `price_area` eller `grid_area_code` är ett påstående och kan inte skriva över OPS-resolutionen.

Historiken finns kvar i versionshanteringen men ska inte publiceras i utvecklarportalen.
