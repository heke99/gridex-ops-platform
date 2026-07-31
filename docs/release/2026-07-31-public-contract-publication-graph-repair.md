# GRIDEX public contracts – reparation av publiceringsgraf och backfill

Datum: 2026-07-31
Projekt: `gridex-ops-platform`
Migration: `20260731152000_public_contract_publication_graph_repair.sql`
SHA-256: `0fd851712e3a3c5918e2ae0c034348f7bbd3b6133dcce3d7d0a2472efc7af0b6`

## Slutbedömning

**Kodleveransen är färdig. Produktionsutrullning är NO-GO tills två externa verifieringshinder är lösta:**

1. Den historiska migrationen `20260730220000_canonical_price_option_publication_api_completion.sql` måste återställas byte-för-byte från den betrodda release-/CI-artefakten.
2. Den nya migrationen och endpointflödet måste köras mot en isolerad stagingdatabas med Node 22, installerade låsta npm-beroenden och en komplett testtenant.

Den historiska migrationsfilen har inte ändrats i patchen. Manifestets historiska checksumma har inte skrivits om för att dölja avvikelsen.

## Rotorsaksanalys

### 1. Historisk migrationsintegritet är bruten

Aktuell fil har SHA-256:

```text
978de5e9b29da9428cd138cea3e57fb1c3ea65e8f903b28b1fb6493dff4e3cd5
```

Manifestet förväntar:

```text
0ab350f0da6648a497a80aeaedc1688eb5ae88e6279d6ab486526c070ff8c505
```

Ingen fil med den betrodda checksumman finns i den uppladdade kodbasen eller dess backupkataloger. Det går därför inte att bevisa vilka bytes som faktiskt distribuerades genom att bara analysera zippen.

### 2. Barnrader skapades före föräldraraden

Triggern `contract_publication_price_options_ready` kördes som `BEFORE INSERT` på `contract_publication_versions` och försökte skapa `contract_price_options` som refererade den nya versionens ID innan föräldraraden fanns. Det förklarar foreign key-felet i publiceringsflödet.

### 3. Publicering exponerades innan grafen var komplett

Publicerings-RPC:t skapade versionen direkt som `published` och låst innan prisalternativ, områdespriser, juridiksnapshot och slutlig hash var färdigställda. Status och data kunde därmed avvika eller lämna en ofullständig publiceringsgraf.

### 4. Mallprisalternativ konsumerades

Den tidigare logiken kunde binda muterbara mallrader direkt till en publiceringsversion. En website-publicering kunde då ta bort underlaget för en senare API-publicering eller nästa version.

### 5. Fastprisregeln var felaktigt nationell

Databaslogiken krävde SE1–SE4 för alla fastprisavtal. Den tog inte hänsyn till `contract_product_versions.price_areas`. Dessutom hade områdestabellen en äldre `amount > 0`-constraint trots att ett explicit nollpris ska räknas som närvarande.

### 6. Exponering och diagnostik använde samma filtrerade startpunkt

Den gamla diagnostiken byggde på en redan strikt view. Avtal som saknade kanal, publicering, version, prisgraf eller juridik försvann därför och såg ut som ett giltigt tomt resultat.

### 7. API-kanalen saknade canonical top-level `price_options`

Den generella API-feeden returnerade inte samma canonical struktur som website-feeden. `/api/v1/contracts` var dessutom den enda synliga API-vägen trots att den canonical vägen ska vara `/api/v1/public-contracts`.

### 8. Tenant- och databasfel kollapsade till generiskt 500

Saknad `external_tenant_reference`, gammalt schema, trasig publiceringsgraf och tillfälliga databasfel kunde inte särskiljas maskinellt.

### 9. Revision och ETag täckte inte hela grafen

Ändringar i publiceringsbundna prisalternativ och områdespriser höjde inte säkert kanalrevisionen. Ett reparerat avtal kunde därför fortsätta få ett gammalt ETag eller felaktigt 304-svar.

### 10. Snapshoten behövde inte identifiera exakt erbjudande

En publiceringsversion kunde se korrekt ut genom att dela produktversion med ett annat erbjudande. Reparationen kräver nu att `publication_snapshot.source_contract_offer_id` motsvarar exakt internt erbjudande.

## Implementerad databasmodell

Den nya forward-only migrationen:

- lägger defensivt till saknade canonical-kolumner för delvis migrerade databaser;
- behåller invalid legacydata synlig för diagnostik i stället för att dölja den;
- skapar constraints som `NOT VALID` när gammal data behöver granskas, men validerar dem automatiskt när datan redan är ren;
- blockerar nya dubletter med både unika index och write-time-triggers;
- ändrar områdesprisets canonical beloppsregel till `amount >= 0`;
- tar bort den felaktiga `BEFORE INSERT`-triggern;
- skapar publiceringsroten och versionen som `draft`;
- infogar föräldraraden före alla snapshotbarn;
- kopierar mallprisalternativ till separata snapshots per publiceringsversion;
- behåller mallraderna;
- kopierar områdespriser byte-för-byte utan att hitta på belopp;
- verifierar defaultval, `selection_required`, kundtyp, avtalstyp och stabila referenser;
- verifierar områden och enheter med samma regel i validering och exponeringsvy;
- bygger juridiksnapshot och canonical `price_options`;
- beräknar SHA-256;
- låser och publicerar först när hela grafen är godkänd;
- rullar tillbaka hela RPC-transaktionen vid ett blockerande fel;
- höjer kanalrevision för prisalternativ och områdespriser;
- skapar auditposter med före-/eftervärden;
- håller `website` och `api` som separata publiceringskanaler.

### Atomisk ordning

```text
validera erbjudande
→ välj/skapa tenant assignment
→ aktivera exakt kanal
→ skapa/välj publication root som draft
→ skapa publication version som draft
→ materialisera prisalternativ
→ materialisera områdespriser
→ validera hela grafen
→ skapa juridiksnapshot
→ skapa canonical price_options-snapshot
→ beräkna hash
→ lås versionen
→ ändra version och root till published
→ uppdatera website compatibility row endast för website
→ audit + revision + cacheinvalidering
→ commit
```

Ingen mellanstatus blir synlig utanför transaktionen.

## Fastpris och elområden

Canonical källa är `contract_product_versions.price_areas`.

- `['SE3']` kräver endast SE3.
- `['SE2','SE3']` kräver endast SE2 och SE3.
- Tom lista på fastpris behandlas som nationell och kräver SE1–SE4.
- Dubbletter eller andra områdeskoder blockerar exponering.
- Varje annonserat område måste ha ett aktivt, icke-negativt belopp i `ore_per_kwh` eller `sek_per_kwh`.
- Ett explicit belopp `0` räknas som ett verkligt pris.
- Ett negativt belopp eller felaktig enhet räknas som saknat/ogiltigt.
- Ett avtal exponeras aldrig för ett område där canonical pris saknas.

## Exponering och diagnostik

### Strikt exponeringsvy

`canonical_visible_public_contracts_v` returnerar endast website-avtal vars hela canonical graf är giltig.

### Bred diagnostikvy

`canonical_public_contract_diagnostics_v` börjar från `contract_offers`, korsar de avsedda kanalerna `website` och `api` och använder `LEFT JOIN` genom hela grafen. Den kan därför visa ett erbjudande även om följande saknas:

- tenant assignment;
- kanalrad;
- publicering;
- publiceringsversion;
- exakt source-offer-bindning;
- prisalternativ;
- default-/selection-policy;
- områdespriser;
- juridikpaket;
- fakturaavgiftskonfiguration;
- låsning eller giltig hash;
- extern tenantreferens;
- aktivt datumintervall.

Canonical kanalstatus är en av:

```text
missing
draft
preparing
published
inactive
expired
blocked
error
```

Adminvyn visar separata statusar och blockeringskoder för **Hemsida** och **API** från samma diagnostikvy som endpointflödet använder.

## Endpoint- och scopemodell

| Endpoint | Kanal | Scope | Funktion |
|---|---|---|---|
| `GET /api/v1/website/public-contracts` | `website` | `website_contracts.read` | Strikt website-feed |
| `GET /api/v1/website/public-contracts/diagnostics` | `website` | `website_contracts.diagnostics` | Bred website-diagnostik |
| `GET /api/v1/public-contracts` | `api` | `api_contracts.read` | Canonical API-/partnerfeed |
| `GET /api/v1/public-contracts/diagnostics` | `api` | `api_contracts.diagnostics` | Bred API-diagnostik |
| `GET /api/v1/contracts` | `api` | `api_contracts.read` | Deprecated kompatibilitetsalias |
| `GET /api/v1/integration/context` | ingen feed | `integration_context.read` | Verifierad tenantkontext |

Tenant bestäms endast från den autentiserade API-klientens `company_id`. Följande verifieras fail-closed:

- API-klienten finns;
- klienten är aktiv och inte utgången;
- klientens bolag finns och har tillåten driftstatus;
- rätt scope finns;
- IP och origin är tillåtna;
- rate limiter är operationell;
- `external_tenant_reference` är satt;
- ingen global, första-tenant- eller cross-tenant-fallback används.

## Canonical API-format

Varje exponerat avtal har top-level:

```json
{
  "offer_reference": "offer_...",
  "channel": "website",
  "customer_type": "private",
  "price_options": [
    {
      "price_option_reference": "fixed_12_se3",
      "option_code": "fixed_12",
      "price_type": "fixed",
      "customer_type": "private",
      "resolution": "monthly",
      "is_default": true,
      "selection_required": false,
      "currency": "SEK",
      "unit": "ore_per_kwh",
      "fixed_price": 112,
      "markup": null,
      "monthly_fee": 49,
      "area_prices": [
        {
          "area_price_reference": "fixed_12_se3",
          "price_area": "SE3",
          "energy_price_ore_per_kwh": 112,
          "unit": "ore_per_kwh"
        }
      ]
    }
  ]
}
```

Interna option-, area-, publication-, product-, price-plan- och tenant-UUID:n tas bort vid den externa DTO-gränsen.

## Backfill

### Dry-run

```bash
export DATABASE_URL='<staging-database-url>'
export GRIDEX_CONTRACT_TEST_COMPANY_ID='<company-uuid>'
export GRIDEX_CONTRACT_TEST_OFFER_ID=''
export GRIDEX_CONTRACT_TEST_PUBLICATION_VERSION_ID=''
export GRIDEX_CONTRACT_TEST_CHANNEL='website'
npm run gridex:public-contract-backfill:preview
```

SQL-funktionen kan också anropas direkt:

```sql
select *
from public.gridex_preview_public_contract_backfill_v1(
  p_company_id := '<company-uuid>'::uuid,
  p_offer_id := null,
  p_publication_version_id := null,
  p_channel := 'website'
);
```

Dry-run muterar ingenting och returnerar:

```text
company_id
external_tenant_reference
offer_id
offer_reference
publication_id
publication_version_id
channel
current_status
detected_problem
proposed_action
safe_to_apply
manual_review_reason
```

### Apply

```bash
export GRIDEX_CONTRACT_TEST_ACTOR_ID='<service-actor-uuid>'
npm run gridex:public-contract-backfill:apply
```

Apply kräver en explicit actor. Endast `safe_to_apply=true` repareras. Varje kandidat körs i en egen PL/pgSQL-subtransaktion. Ett deterministiskt FK-, unique-, constraint-, lock- eller valideringsfel rullar tillbaka just kandidaten, skapar en idempotent granskningspost och fortsätter med nästa kandidat.

### Säker källordning

1. Befintliga relationella snapshotrader för samma publiceringsversion.
2. Oförändrade mallrader för exakt produkt- och prisplansversion.
3. En tidigare publiceringssnapshot endast om alla möjliga tidigare grafer är identiska.
4. Legacyrelationer endast när stabil referens och samtliga kommersiella jämförelsefält matchar exakt.

Legacyfält utan stabilt option-/områdesreferensunderlag repareras inte genom syntetiska identifierare. De rapporteras för manuell granskning.

### Låsta kommersiella priser

Backfillen avaktiverar inte låstriggers. Den får:

- skapa nya oföränderliga snapshotkopior;
- återställa en saknad mallkopia från ett redan publicerat snapshot;
- komplettera relationell metadata när pris- och termprojektionen är identisk;
- bygga om härledda `price_options` och hash från samma barnrader.

Den får inte:

- ändra belopp;
- ändra bindning, uppsägning eller förnyelse;
- byta produkt-/prisplansversion;
- gissa mellan motstridiga priser;
- permanent stänga av constraints eller triggers.

## Felhantering

Runtime skiljer mellan:

- `TENANT_NOT_FOUND`;
- `EXTERNAL_TENANT_REFERENCE_MISSING`;
- `TENANT_NOT_OPERATIONALLY_READY`;
- `PUBLICATION_GRAPH_INCOMPLETE`;
- `PUBLIC_CONTRACT_SCHEMA_OUTDATED`;
- `PUBLIC_CONTRACTS_TEMPORARILY_UNAVAILABLE`.

Scopefel fortsätter att returneras av det gemensamma auth-lagret som HTTP 403 med `api_scope_missing`.

Loggningen innehåller request/correlation-ID, company-ID, API-client-ID, endpoint, kanal, maskinell felkod och databaskod. API-nyckeln loggas inte.

## ETag och cache

Kanalrevisionen höjs när följande ändras:

- publiceringsrot;
- publiceringsversion;
- channel assignment;
- website compatibility row;
- publiceringsbundet prisalternativ;
- publiceringsbundet områdespris.

ETag bygger vidare på kanalrevisionens token och ändras därför efter publicering eller backfill. Endpointen kan inte returnera ett gammalt 304 efter en lyckad grafreparation.

## Förväntade responsformer

Följande är kod- och OpenAPI-verifierade exempel. De är inte hämtade från en live/stagingmiljö i denna leveransmiljö.

### Synligt avtal

```json
{
  "data": [{ "offer_reference": "offer_...", "channel": "website", "price_options": [{}] }],
  "contracts": [{ "offer_reference": "offer_...", "channel": "website", "price_options": [{}] }],
  "meta": { "count": 1, "channel": "website" }
}
```

### Dolt avtal med blockerare

```json
{
  "data": [],
  "diagnostics": {
    "publication": {
      "total": 1,
      "visible": 0,
      "hidden": 1,
      "offers": [
        {
          "offer_reference": "offer_...",
          "channel_state": "blocked",
          "visible": false,
          "blockers": ["PUBLICATION_PRICE_OPTIONS_MISSING"]
        }
      ]
    }
  },
  "meta": { "count": 1, "channel": "website" }
}
```

### Tenant utan scope

```json
{
  "error": {
    "code": "api_scope_missing",
    "message": "API-klienten saknar scope.",
    "request_id": "..."
  }
}
```

HTTP-status: `403`.

### Tenant utan extern tenantreferens

```json
{
  "error": {
    "code": "EXTERNAL_TENANT_REFERENCE_MISSING",
    "message": "Tenantens externa referens saknas.",
    "request_id": "..."
  }
}
```

HTTP-status: `409`.

### Giltigt tomt resultat

```json
{
  "data": [],
  "contracts": [],
  "meta": { "count": 0, "channel": "api" }
}
```

Detta används inte för att maskera schema- eller databasfel.

## Automatiserade tester

Ny testfil:

```text
__tests__/public-contract-publication-graph-repair.test.ts
```

Den verifierar statiskt och på DTO-nivå bland annat:

- förälder före barn;
- draft före published;
- borttagen felaktig BEFORE-trigger;
- website/api-separation;
- top-level `price_options`;
- inga interna ID:n i API-DTO;
- supported price areas;
- nollpris och tillåtna area units;
- selection-policy i både validator och exponeringsvy;
- bred LEFT JOIN-diagnostik;
- exakta source-offer-bindningar;
- låst prissättning;
- idempotent preview/apply;
- ETag-/revisionstriggers;
- adminstatus från canonical diagnostik;
- explicit tenant- och schemafelklassificering.

Databastestet `scripts/gridex-public-contract-publication-graph-db-test.sql` kör i en transaktion och avslutas med rollback. Det publicerar samma isolerade testoffer separat till `website` och `api` och kontrollerar:

- två olika publiceringsversioner;
- separata snapshotrader;
- kompletta och låsta grafer;
- bevarade mallrader;
- korrekta fastprisområden;
- synlig diagnostik för båda kanalerna;
- idempotent återpublicering;
- dry-run utan mutation;
- höjd revision för båda kanalerna.

## Verifieringsresultat i leveransmiljön

### Godkänt

- Historiska `20260730220000...sql` är byte-för-byte oförändrad jämfört med uppladdad zip.
- Ny migrationschecksumma registrerad och matchar aktuella bytes.
- OpenAPI JSON kan parsas.
- `package.json` och migrationsmanifest kan parsas.
- TypeScript parser/transpilering: **14 ändrade TS/TSX-filer**.
- SQL lexical balance: **1 migration + 4 operativa SQL-skript**.
- Statiska assertions för ordning, triggers, lås, areas, selection-policy, diagnostik, backfill, revision och top-level `price_options`.
- Runtime DTO-test: canonical top-level `price_options` och borttagning av interna ID:n.
- Public API contract check: **37 route-filer**.
- OpenAPI/runtime parity: **39 registry routes, 41 OpenAPI-operationer, 58 nåbara schemas**.
- Inget trailing whitespace i patchens textfiler efter slutrapportens normalisering.

### Inte möjligt att slutföra i denna miljö

`npm ci` kunde inte installera låsfilens beroenden:

- konfigurerad intern npm-mirror returnerade 404;
- direkt retry mot publika npm-registret misslyckades med DNS-felet `EAI_AGAIN registry.npmjs.org`.

Följden blev:

- `npm run lint`: kunde inte starta `eslint`;
- `npm run typecheck`: saknade installerade typer för bland annat Node, React, Chai och projektpaket;
- `npm run build`: kunde inte starta `next`;
- `npm test`: kunde inte starta `vitest`.

Databasmigration, DB-test och autentiserade HTTP-tester kunde inte köras eftersom miljön saknar PostgreSQL/Supabase-anslutning, `psql`, databasuppgifter och isolerad testtenant.

### Migrationsintegritet

Aktuellt resultat:

```text
Migration integrity check failed (1 issue):
- Migration checksum changed: 20260730220000_canonical_price_option_publication_api_completion.sql
```

Den nya migrationen är korrekt registrerad. Det enda kvarvarande manifestfelet är den pre-existerande historiska avvikelsen.

## Manuella granskningsfall

Backfillen lämnar kandidaten orörd och skapar granskningsunderlag när:

- publicerings-/kanalavsikt inte kan bevisas;
- publiceringsversion saknas;
- source offer inte är entydigt;
- prisalternativ eller stabila referenser är dubblerade;
- flera tidigare prisgrafer skiljer sig;
- ingen mall eller exakt tidigare snapshot finns;
- legacypris saknar stabilt option-/områdesunderlag;
- juridikpaketet saknas, är olåst eller har unresolved variables;
- invoice fee-konfigurationen inte är canonical;
- ett deklarerat område saknar exakt pris;
- ett områdespris är negativt eller har fel enhet;
- en reparation skulle ändra kommersiella belopp eller villkor.

Granskningsposter skapas idempotent även när `price_plan_version_id` är null.

## Ändrade filer

- `app/admin/contracts/page.tsx`
- `app/api/v1/contracts/route.ts`
- `app/api/v1/integration/context/route.ts`
- `app/api/v1/website/public-contracts/diagnostics/route.ts`
- `app/api/v1/website/public-contracts/route.ts`
- `app/developers/customer-portal-api/page.tsx`
- `docs/openapi/website-integration-v1.json`
- `lib/api/publicRouteRegistry.ts`
- `lib/integrations/apiClientScopes.ts`
- `lib/integrations/tenantContext.ts`
- `lib/website/publicContracts.ts`
- `package.json`
- `scripts/migration-history-manifest.json`

## Nya filer

- `__tests__/public-contract-publication-graph-repair.test.ts`
- `app/api/v1/public-contracts/diagnostics/route.ts`
- `app/api/v1/public-contracts/route.ts`
- `docs/release/2026-07-31-public-contract-publication-graph-repair.md`
- `lib/integrations/publicApiErrors.ts`
- `scripts/gridex-public-contract-backfill-apply.sql`
- `scripts/gridex-public-contract-backfill-preview.sql`
- `scripts/gridex-public-contract-publication-graph-db-test.sql`
- `scripts/gridex-public-contract-publication-graph-post-apply.sql`
- `supabase/migrations/20260731152000_public_contract_publication_graph_repair.sql`

Totalt: **13 ändrade filer och 10 nya filer**.

## Kontrollerad stagingkörning

### 1. Återställ historisk migration

Hämta den exakta `20260730220000...sql` som motsvarar manifestets betrodda checksumma från Git, CI eller tidigare releaseartefakt. Kör sedan:

```bash
npm run db:migrations:check
```

Resultatet måste vara exit code 0 innan databasen ändras.

### 2. Lokal verifiering med Node 22

```bash
npm ci
npm run lint
npm run typecheck
npm run typecheck:tests
npm test
npm run api:docs
npm run build
npm run db:migrations:check
```

### 3. Preview före migration

Ta backup/PITR och schemaexport. Applicera därefter migrationen i staging:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260731152000_public_contract_publication_graph_repair.sql
```

### 4. Tenant-scoped dry-run

```bash
export GRIDEX_CONTRACT_TEST_COMPANY_ID='<company-uuid>'
export GRIDEX_CONTRACT_TEST_CHANNEL='website'
npm run gridex:public-contract-backfill:preview
```

### 5. Tenant-scoped apply

```bash
export GRIDEX_CONTRACT_TEST_ACTOR_ID='<service-actor-uuid>'
npm run gridex:public-contract-backfill:apply
```

### 6. Post-apply och DB-test

```bash
npm run gridex:public-contract-publication-graph:post-apply

export GRIDEX_CONTRACT_TEST_OFFER_ID='<isolated-test-offer-uuid>'
npm run gridex:public-contract-publication-graph-db-test
```

### 7. HTTP-verifiering

Testa med avsedda API-klienter:

```text
GET /api/v1/integration/context
GET /api/v1/website/public-contracts
GET /api/v1/website/public-contracts/diagnostics
GET /api/v1/public-contracts
GET /api/v1/public-contracts/diagnostics
GET /api/v1/contracts
```

Verifiera 200, 304, scope-403, saknad tenantreferens-409, dolt avtal med blockers och avtal efter backfill.

## Rollback och återställning

Migrationen är forward-only och körs i en databastransaktion. Om den misslyckas före commit rullar PostgreSQL tillbaka hela migrationen.

Före produktion:

1. frys manuella avtals- och publiceringsändringar;
2. verifiera PITR/backup;
3. spara schema-only dump;
4. exportera dry-run-rapporten;
5. verifiera den historiska migrationschecksumman;
6. kör staging och DB-test;
7. applicera i produktion först efter grön efterkontroll.

Om återställning krävs efter commit:

- pausa berörda website/API-kanaler som operativ containment;
- bevara audit- och granskningsposter;
- återställ från den verifierade pre-apply recovery point;
- radera inte publiceringshistorik manuellt;
- stäng inte permanent av immutability-, RLS- eller säkerhetstriggers.

## Synkning

Patchzippen innehåller endast ändrade och tillagda filer och har inga `node_modules`, `.next` eller oförändrade projektfiler.

```bash
PATCH_ZIP="$HOME/Downloads/gridex-public-contract-publication-graph-repair-20260731.zip"
SYNC_DIR="$(mktemp -d)"
unzip -q "$PATCH_ZIP" -d "$SYNC_DIR"
rsync -avh --progress \
  "$SYNC_DIR/" \
  "/Users/hekmath/Projects/gridex-ops-platform/"
cd "/Users/hekmath/Projects/gridex-ops-platform"
git status --short
git diff --check
```
