# Gridex tenantintegration med en API-nyckel

Kontraktsversion: `2026-08-02.1`.

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

## Aktuellt spotpris med samma API-nyckel

Ingen ny miljövariabel krävs. När nyckeln har scope `website_market_prices.read` används samma `GRIDEX_API_KEY`:

```http
POST /api/v1/website/market-price/current
Authorization: Bearer $GRIDEX_API_KEY
Content-Type: application/json

{
  "resolution_id": "f8249704-7ce8-4885-93cb-fbb9922ed77d"
}
```

API-nyckeln avgör tenant och `resolution_id` avgör canonical SE1–SE4. Tenant ska inte konfigurera en egen Elpriset Just Nu-URL, eget tenant-ID eller lokal områdesmappning.
