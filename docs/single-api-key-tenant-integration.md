# Gridex tenantintegration med en API-nyckel

Kontraktsversion: `2026-08-04.1`.

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

Headern `x-api-key` stöds endast som en utfasad kompatibilitetsväg för äldre
integrationer och har planerat slutdatum **2026-10-31**. Nya integrationer ska
enbart använda Bearer-formatet ovan.

## Fasta kontraktsregler

- `offer_reference`, `quote_reference` och `resolution_id` ligger top-level i kundansökan.
- `contract` innehåller kompletterande avtalsuppgifter, exempelvis önskat startläge.
- Inget konfigurerbart request- eller referensplaceringsläge stöds eller behövs.
- OpenAPI är ett utvecklingsunderlag, inte ett runtimeberoende.
- Scopes provisioneras på API-nyckeln i OPS och konfigureras inte i tenantens ENV.


## Readiness före första ansökan

Scopes är nödvändiga men inte tillräckliga. `GET /integration/context` rapporterar samma canonical readiness som används av ansöknings-API:t: aktiv tenant och API-klient, publicerat avtal och juridik, verifierad e-post, kundautomation, anläggningsmailbox, tenantens HTTPS-adress till Mina sidor samt tillåtna operation policies. Ett blockerande krav ger `tenant_website_not_ready`; tenant kan alltid polla status och får även webhookstatus när en aktiv webhook är konfigurerad.

Varje kundansökan måste skickas först efter att en autentiserad Mina sidor-session har etablerats och innehålla samma UUID i `auth_user_id` och `customer_portal_user_id`. Anonym ansökan stöds inte.

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
