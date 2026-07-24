# Gridex tenantintegration med en API-nyckel

Kontraktsversion: `2026-07-24.1`.

## Produktion

Tenantens enda obligatoriska miljövariabel är:

```env
GRIDEX_API_KEY=gridex_live_xxxxxxxxx
```

API-klienten använder fast base URL:

```text
https://app.gridex.se/api/v1
```

Nyckeln används endast server-side som `Authorization: Bearer <GRIDEX_API_KEY>`. OPS härleder tenant, bolag och scopes från nyckeln. Tenantens webb skickar aldrig `company_id` eller `tenant_id`.

## Fasta kontraktsregler

- `offer_reference`, `quote_reference` och `resolution_id` ligger top-level i kundansökan.
- `contract` innehåller kompletterande avtalsuppgifter, exempelvis önskat startläge.
- Inget konfigurerbart request- eller referensplaceringsläge stöds eller behövs.
- OpenAPI är ett utvecklingsunderlag, inte ett runtimeberoende.
- Scopes provisioneras på API-nyckeln i OPS och konfigureras inte i tenantens ENV.

## Publika kontrakt

```text
https://app.gridex.se/api/v1/openapi/website-integration-v1.json
https://app.gridex.se/api/v1/openapi/customer-portal-v1.json
```

## Canonical checkout

```text
GET  /website/public-contracts
POST /website/energy-area/resolve
POST /website/quote
POST /website/quote/validate
POST /website/customer-applications
```

Ett integrationssammanhang kan verifieras med `GET /integration/context`. Svaret beskriver nyckelns tenantkontext, kontraktsversion och om nyckeln har alla scopes för checkout.
