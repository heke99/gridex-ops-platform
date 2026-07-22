# Gridex OPS – implementationsrapport för Sammanfattning 1

**Datum:** 2026-07-22  
**Leverans:** Canonical multi-tenant-API, quote-livscykel, publiceringsrevision, webhook, diagnostics, API-kanal och marknadsdatapolicy.

## Samlad bedömning

Kravbildens tolv områden är implementerade i databas, runtime, TypeScript-kontrakt, OpenAPI, utvecklardokumentation och regressionstester. OPS har nu ett sammanhängande externt tenantkontrakt där API-nyckeln väljer tenant server-side, externa klienter verifierar en opak `tenant_reference`, OPS skapar och lagrar canonical quotes och kundansökan binds till exakt samma quote-snapshot.

Implementationen är färdig i källkoden. Innan produktion ska den nya migrationen appliceras i Supabase och en full build/integrationstest köras i en miljö med fungerande npm-registry och testdatabas.

## Kravstatus

### 1. Verifierbar extern tenantidentitet – klar

- Ny stabil och opak `companies.external_tenant_reference` med format `tenant_<36 hex>`.
- Ny endpoint: `GET /api/v1/integration/context`.
- Nytt scope: `integration_context.read`.
- API-feeds och quote-svar returnerar `meta.tenant_reference`.
- Intern `company_id` används fortfarande server-side men exponeras inte som extern tenantväljare.

### 2. Canonical `customer_type` – klar

- Canonical värden: `private | business`.
- `company` normaliseras till `business` som deprecated alias.
- Felaktiga värden ger strukturerat `400` i stället för att ignoreras.
- Sunset dokumenterad till 2026-10-31.

### 3. OPS är canonical quote-motor – klar

- Quote-routen använder OPS prismotor för fast, månadsrörligt, tim, kvart, portfolio, mixed/hybrid och komponentbaserade modeller.
- Tenantens providerpolicy styr källa, prioritet, elområde, upplösning, färskhet, fallback, forecast och portfolio.
- Quote innehåller `quote_reference`, prisintervall, metod, källperiod, timestamp, bindningsstatus, antaganden, marknadskällor, snapshot-schema och giltighet.
- Stabil felhantering omfattar bland annat `market_price_unavailable` och portfoliofel.

### 4. Quote binds till kundansökan – klar

- Ny tabell `website_contract_quotes` lagrar tenant-, API-klient-, offer-, produkt-, publicerings-, prisplan- och juridikversion.
- Quote binds även till kundtyp, elområde, nätområde, postnummer, årsförbrukning, startdatum, marknadsdata, antaganden och giltighet.
- Ny endpoint: `POST /api/v1/website/quote/validate`.
- Kundansökan verifierar quote mot löst canonical underlag före affärssidoeffekter.
- Konsumtion är atomisk och idempotent; en annan ansökan kan inte återanvända samma quote.

### 5. Canonical lagring av beräkningsunderlag – klar

- `annual_consumption_kwh`, prisområde, nätområde, postnummer, startdatum, kundtyp, mätpunkt, juridiska godkännanden och fullmakt förs genom ansökningsflödet.
- Årsförbrukning lagras i canonical site-/mätpunktsdata där tillämpligt.
- Hela quote-snapshotet sparas i det låsta avtalsprissnapshotet.

### 6. Publication revision, ETag och 304 – klar

- Separat revisionsström per `tenant + channel` för `website` och `api`.
- `ETag`, `If-None-Match` och `304 Not Modified` används av båda externa feeds.
- Revisionsutlösaren hanterar INSERT, UPDATE och DELETE för offers, kanaler, publication och publication versions.
- Permanent radering kan inte lämna cache-revisionen oförändrad.

### 7. Canonical publication-webhook – klar

- `contracts.publication.changed` skrivs direkt till aktiva `webhook_deliveries`.
- Eventet använder befintlig produktionspipeline för signering, retry, historik, idempotens och dead-letter.
- Payload innehåller event-ID, tenantreferens, kanal, revision, timestamp och orsak.
- Extern webhookpayload ersätter intern tenantidentifiering med `tenant_reference`.

### 8. Verklig feed för kanalen `api` – klar

- Ny endpoint: `GET /api/v1/contracts`.
- Nytt scope: `api_contracts.read`.
- Feed visar endast aktiva och giltiga avtal publicerade till `api`-kanalen.
- API-kanalen har egen revisions-/ETag-ström och påverkar inte website-feeden.
- Interna company-/tenant-ID:n tas bort ur snapshotsvaret.

### 9. Canonical diagnostics – klar

- Endpoint: `GET /api/v1/website/public-contracts/diagnostics`.
- Scope: `website_contracts.diagnostics`.
- Diagnostics använder samma canonical graph/readinesskälla som normal feed.
- Samtliga efterfrågade readinessfält exponeras.
- `?diagnostics=1` är deprecated med `Deprecation`- och `Sunset`-headers och ändrar inte typen på `data`.

### 10. Tenantadministration av marknadsdata – klar

- Ny adminvy: `/admin/pricing/market-sources`.
- Tenantadmin kan konfigurera providerstatus, prioritet, elområden, upplösningar, max dataålder, indikativ fallback, forecast och portfolio.
- Anslutningstest samt senaste test, senaste lyckade observation och senaste fel visas.
- Quote-motorn läser och verkställer policyn; inställningen är inte bara administrativ metadata.

### 11. Canonical routes och aliases – klar

Canonical routes är registrerade för:

- tenantkontext;
- website public contracts;
- diagnostics;
- API contracts;
- quote;
- quote validation;
- energy-area resolution;
- customer application;
- switch status;
- portal bundle.

Nya routes:

- `POST /api/v1/website/energy-area/resolve` med scope `website_energy_area.resolve`;
- `GET /api/v1/website/switch-status` med scope `website_switch_status.read`.

Bytesstatus är tenant-skopad och returnerar en opak `switch_reference` utan interna UUID:n.

### 12. OpenAPI, runtime, dokumentation och regression – klar

- Ny maskinläsbar OpenAPI-fil: `docs/openapi/website-integration-v1.json`.
- Utvecklarsidan och integrationsguiden beskriver tenantreferens, customer type, quote, ansökan, ETag, diagnostics, kanaler och webhook.
- TypeScript-kontrakt finns i `lib/integrations/websiteApiContract.ts`.
- Ny regression `scripts/gridex-ops-summary-1-regression.cjs` kontrollerar att migration, runtime, scopes, routes, OpenAPI och dokumentation inte glider isär.

## Verifiering som har körts

Följande kontroller är gröna i leveransen:

```text
npm run gridex:ops-summary-1-regression
npm run db:migrations:check
npm run api:contract
npm run api:error-boundaries
npm run api:performance-tenant-gates
npm run gridex:website-api-webhook-regression
npm run gridex:website-application-idempotency-hardening-regression
npm run gridex:canonical-portfolio-pricing-regression
npm run gridex:public-pricing-visibility-regression
npm run gridex:contract-single-source-regression
```

Resultat:

- 292 migrationsfiler verifierade mot checksum-manifest;
- 30 publika route-filer verifierade mot API-kontrakt;
- 79 routes verifierade för felgränser;
- 118 canonical portfolio-kontroller gröna;
- 90 single-source-kontroller gröna;
- samtliga nya Summary 1-kontroller gröna;
- OpenAPI-JSON är syntaktiskt giltig;
- Node TypeScript strip/syntaxkontroll är grön för berörda `.ts`-filer.

## Begränsning i verifieringsmiljön

En full `npm ci`, TypeScript project build och Next.js production build kunde inte slutföras i den isolerade miljön. Paketinstallationen stoppades av externa infrastrukturfel:

- intern npm-registry svarade med HTTP 503 för flera paket;
- offentlig npm-registry gav DNS-felet `EAI_AGAIN` för `zod-validation-error`.

Ett globalt `tsc --noEmit` kunde därför bara konstatera att projektets typdefinitioner saknades efter den ofullständiga installationen. Det rapporterade inga verifierbara applikationsfel innan kompilatorn stoppade på saknade `@types`-paket. Kör full build efter vanlig `npm ci` i lokal/CI-miljö.

## Äldre röda regressioner i originalprojektet

Följande regressioner var redan röda i den uppladdade originalzippen och är inte introducerade av denna leverans:

- `gridex:batch-7-website-foundation-regression` – saknar äldre kontrollsymbol `reserveCustomerNumber`;
- `gridex:platform-tenant-contracts-api-mail-regression` – tre befintliga kontroller kring portfolio mix, tenant price-plan/version och contract audit events;
- `gridex:website-application-ops-chain-regression` – tre befintliga external-intake-kontroller.

De bör hanteras separat så att hela projektets historiska testsvit blir grön, men de blockerar inte de nya Summary 1-regressionerna.

## Nya filer

```text
__tests__/externalCustomerType.test.ts
app/admin/pricing/market-sources/actions.ts
app/admin/pricing/market-sources/page.tsx
app/api/v1/contracts/route.ts
app/api/v1/integration/context/route.ts
app/api/v1/website/energy-area/resolve/route.ts
app/api/v1/website/quote/validate/route.ts
app/api/v1/website/switch-status/route.ts
docs/openapi/website-integration-v1.json
docs/ops-summary-1-api-completion-2026-07-22.md
lib/customers/externalCustomerType.ts
lib/integrations/tenantContext.ts
lib/integrations/websiteApiContract.ts
lib/pricing/websiteQuotes.ts
lib/website/switchStatus.ts
scripts/gridex-ops-summary-1-regression.cjs
supabase/migrations/20260722133000_external_tenant_quote_api_completion.sql
```

## Ändrade filer

```text
app/admin/pricing/page.tsx
app/api/v1/website/public-contracts/diagnostics/route.ts
app/api/v1/website/public-contracts/route.ts
app/api/v1/website/quote/route.ts
app/developers/customer-portal-api/page.tsx
docs/external-website-api-integration-guide.md
lib/admin/navigation.ts
lib/api/publicRouteRegistry.ts
lib/integrations/apiClientScopes.ts
lib/integrations/webhooks.ts
lib/pricing/marketPriceSources.ts
lib/pricing/offerQuote.ts
lib/pricing/priceSourceResolver.ts
lib/website/customerApplications.ts
lib/website/publicContractApi.ts
lib/website/publicContracts.ts
package.json
scripts/migration-history-manifest.json
```

## Rekommenderad synkning

Anta att zippen packas upp bredvid det lokala projektet:

```bash
cd "/Users/hekmath/Projects/gridex-ops-platform"

rsync -av --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.next/' \
  "/sökväg/till/gridex-ops-platform-main/" ./

npm ci
npm run db:migrations:check
npm run gridex:ops-summary-1-regression
npm run test
npm run build
```

Applicera sedan migrationen genom projektets normala Supabase-flöde. Kör inte SQL-delar manuellt och separat; migrationsfilen och checksum-manifestet hör ihop.

## Produktionskontroll efter deploy

1. Skapa/rotera en testnyckel för en separat tenant och verifiera `/api/v1/integration/context`.
2. Kontrollera att förväntad `tenant_reference` matchar och att internt `company_id` inte finns i externa svar.
3. Publicera ett avtal till `website`, kontrollera revisionsökning, ETag och webhook.
4. Publicera ett separat avtal till `api`, kontrollera att det bara syns i `/api/v1/contracts`.
5. Skapa quote för private, business och deprecated company-alias.
6. Validera quote, skapa ansökan och verifiera att samma snapshot och årsdata sparas canonical.
7. Försök återanvända quote mot ändrad förbrukning/offer/tenant och verifiera `quote_mismatch` eller tenantblockering.
8. Kör diagnostics och bekräfta att feed och diagnostics rapporterar samma publiceringsgraf.
