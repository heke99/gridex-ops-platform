# Gridex OPS – canonical tenant- och API-kontrakt

**Version:** 2026-07-22.1  
**Gäller från:** 2026-07-22  
**OpenAPI:** `docs/openapi/website-integration-v1.json`

Detta dokument är den normativa integrationsinstruktionen för externa tenants. API-nyckeln är alltid den auktoritativa tenantidentiteten. En extern klient får aldrig skicka eller använda internt `company_id` för att välja tenant.

## 1. Tenantidentitet

Verifiera API-nyckeln server-side med:

```http
GET /api/v1/integration/context
Authorization: Bearer <API_KEY>
```

Svaret innehåller en opak, stabil och tenantunik `tenant_reference` med prefix `tenant_`. Den är inte härledd från bolagsnamnet och är inte samma värde som `companies.id`.

Klienten ska:

1. spara förväntad `tenant_reference` i sin servermiljö;
2. jämföra den vid uppstart/deploy och vid nyckelrotation;
3. stoppa integrationen vid mismatch;
4. aldrig skicka `company_id`, `tenant_id` eller liknande tenantväljare till OPS.

## 2. Kundtyp

Canonical värden är:

```text
private | business
```

`company` accepteras tillfälligt som deprecated alias för `business` till och med **2026-10-31**. Aliaset normaliseras före filtrering och quote. Ogiltiga queryvärden ger strukturerat `400 invalid_query_parameter`; de ignoreras aldrig tyst.

## 3. Kanaler

| Kanal | Användning | Extern endpoint | Scope | Teckningsbar |
|---|---|---|---|---|
| `internal` | OPS interna sälj- och adminflöden | Ingen extern feed | – | Enligt intern policy |
| `website` | Tenantens publika hemsida | `GET /api/v1/website/public-contracts` | `website_contracts.read` | Ja, via quote + ansökan |
| `api` | Partner-/B2B-feed | `GET /api/v1/contracts` | `api_contracts.read` | Enligt publicerad kanalregel |

Publicering till `api` påverkar inte website-feeden. Varje kanal har egen `publication_revision` och ETag-ström per tenant.

## 4. Canonical routes

| Funktion | Canonical route |
|---|---|
| Tenantkontext | `GET /api/v1/integration/context` |
| Website-avtal | `GET /api/v1/website/public-contracts` |
| Diagnostics | `GET /api/v1/website/public-contracts/diagnostics` |
| API-avtal | `GET /api/v1/contracts` |
| Quote | `POST /api/v1/website/quote` |
| Quote-validering | `POST /api/v1/website/quote/validate` |
| Elområdesresolution | `POST /api/v1/website/energy-area/resolve` |
| Leverantörsbytesstatus | `GET /api/v1/website/switch-status?application_number=...` |
| Kundansökan | `POST /api/v1/website/customer-applications` |
| Juridik | `GET /api/v1/website/legal-bundle` |
| Portal bundle | `GET|POST /api/v1/customer/portal-bundle` |

`GET /api/v1/website/public-contracts?diagnostics=1` är deprecated och har sunset **2026-10-31**. Använd den separata diagnostics-routen. Deprecated-anrop returnerar `Deprecation` och `Sunset` headers.

### Elområdesresolution och bytesstatus

`POST /api/v1/website/energy-area/resolve` använder samma tenant-skopade resolver som kundansökan och returnerar prisområde, nätområde, nätägare, confidence, source chain och readiness utan providerhemligheter. Den äldre anonyma `/api/public/energy-area` är inte canonical för autentiserade tenantintegrationer.

`GET /api/v1/website/switch-status?application_number=...` löser ansökningsnumret strikt inom API-nyckelns tenant och returnerar en opak `switch_reference`, aktuell status, säkra blockerare och händelsehistorik utan interna UUID:n.

## 5. Quote är OPS source of truth

OPS beräknar pris för:

- fast pris;
- rörligt månadspris;
- timpris;
- kvartspris;
- portfolio;
- mixed/hybrid;
- komponentbaserade och framtida prismodeller.

Tenantens webbplats får inte återskapa prisformeln eller välja egen spotprisleverantör. Quote binder följande:

- tenant och API-klient;
- `offer_reference`;
- contract product version;
- publication version;
- price plan version;
- legal bundle version;
- kundtyp;
- prisområde och elnätsområde;
- postnummer;
- årsförbrukning;
- startdatum;
- marknadsdatakällor och timestamp;
- antaganden;
- snapshot-schema;
- giltighetstid.

Quote-svaret innehåller minst `offer_reference`, `quote_reference`, `pricing_interval`, `estimate_method`, `source_period`, `market_data_timestamp`, `is_binding`, `assumptions`, `market_sources`, `pricing_snapshot_schema_version` och `valid_until`.

### Bindande kontra indikativt

`is_binding=false` betyder att priset är en indikation. Tim- och kvartspris använder en dokumenterad förhandsprofil; slutlig faktura använder verkliga intervallmätvärden och låst marknadsunderlag. Portfolio får aldrig använda en annan månad eller en olåst period som slutligt fakturapris.

### Marknadsdata och fallback

Tenantens marknadsdatapolicy styr providers, prioritet, tillåtna elområden, upplösningar, max dataålder, indikativ fallback, forecast och portfolio. Quote redovisar källor och timestamp men exponerar inga providerhemligheter.

När korrekt marknadsdata saknas returneras stabil felkod, bland annat:

```text
market_price_unavailable
portfolio_price_missing
quote_calculation_failed
```

## 6. Quote-livscykel och validering

Quote är normalt giltig i 15 minuter. Miljövariabeln `WEBSITE_QUOTE_VALIDITY_MINUTES` kan sättas till 5–120 minuter.

Validera före ansökan med:

```http
POST /api/v1/website/quote/validate
```

Möjliga stabila felkoder:

```text
quote_not_found
quote_expired
quote_revoked
quote_already_consumed
quote_mismatch
```

`quote_mismatch` innehåller vilka fält som skiljer sig. En quote kan endast konsumeras av samma kundansökan. Idempotent replay av samma ansökan får läsa samma konsumerade quote; en annan ansökan blockeras.

## 7. Kundansökan och canonical lagring

Kundansökan ska skicka samma:

```json
{
  "offer_reference": "offer_...",
  "quote_reference": "quote_..."
}
```

OPS verifierar quote efter att prisområde, nätområde och startdatum har lösts. Följande sparas canonical i site-, mätpunkts-, avtals- och snapshotsdata där det är relevant:

```text
annual_consumption_kwh
price_area
price_area_code
grid_area
grid_area_code
postal_code
start_date
customer_type
metering_point
quote_reference
legal_acceptances
power_of_attorney
```

Hela quote-snapshotet sparas i den låsta `contract_price_snapshot`. Årsförbrukning får inte endast ligga i ostrukturerad metadata.

`Idempotency-Key` är obligatorisk för kundansökan. Samma nyckel får bara återanvändas med samma normaliserade payload.

## 8. ETag och publication revision

Både website- och API-feed returnerar:

```http
ETag: "..."
```

Skicka sedan:

```http
If-None-Match: "..."
```

Oförändrad feed returnerar `304 Not Modified` utan JSON-body. Revisionen är bunden till `tenant + channel` och höjs av varje mutation som kan ändra externt synlig publicering, bland annat publish, unpublish, pause, republish, archive, delete, pris-, juridik-, fakturaavgifts- och teckningsbarhetsändring.

Klienten ska invalidiera egen cache när ETag ändras eller när `contracts.publication.changed` tas emot.

## 9. Publication webhook

Eventtyp:

```text
contracts.publication.changed
```

Eventet köas direkt i den aktiva `webhook_deliveries`-pipen. Det använder samma signering, retries, leveranshistorik och dead-letterhantering som övriga produktionswebhooks.

Payload innehåller minst:

```json
{
  "event_id": "uuid",
  "event_type": "contracts.publication.changed",
  "tenant_reference": "tenant_...",
  "created_at": "2026-07-22T10:00:00Z",
  "data": {
    "tenant_reference": "tenant_...",
    "channel": "website",
    "publication_revision": 42,
    "reason": "contract_publication_versions:update",
    "timestamp": "2026-07-22T10:00:00Z"
  }
}
```

Mottagaren ska:

1. verifiera HMAC över `timestamp.rawBody`;
2. avvisa replay med för gammal timestamp;
3. deduplicera på `event_id` eller idempotency key;
4. returnera 2xx först när eventet är säkert mottaget;
5. hämta om feeden med ETag/If-None-Match.

## 10. Diagnostics

Canonical endpoint:

```http
GET /api/v1/website/public-contracts/diagnostics
Scope: website_contracts.diagnostics
```

Diagnostics bygger på samma canonical graf och readiness som normal feed. Minsta readinessfält är:

```text
canonical_graph_consistent
forward_publication_link_valid
reverse_legacy_link_valid
company_chain_valid
tenant_assignment_valid
channel_valid
source_offer_consistent
pricing_ready
legal_ready
invoice_fee_ready
publication_active
application_acceptance_ready
```

Diagnostics ändrar aldrig typen på normalfältet `data`.

## 11. Tenantadministration för marknadsdata

Tenantadmin konfigurerar under `/admin/pricing/market-sources`:

- aktiva providers och prioritet;
- elområden;
- stödda upplösningar;
- max dataålder;
- indikativ fallback;
- forecast-policy;
- portfolio-policy;
- anslutningstest;
- senaste lyckade hämtning;
- senaste fel.

En ny tenant ska kunna slutföra detta utan SQL-hack eller kodändring.

## 12. Definition of Done och releasekrav

Följande måste vara grönt före release:

```bash
npm run db:migrations:check
npm run gridex:ops-summary-1-regression
npm run typecheck
npm run test
npm run build
```

Regressionen kontrollerar runtime, scopes, migration, OpenAPI, utvecklarsida, quote-bindning, ETag, diagnostics och webhookpipeline. Full typecheck/test/build kräver installerade dependencies och fungerande paketregistry.
