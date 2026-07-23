# Gridex OPS – fullständig granskning av spotpris-API och områdesresolver

**Datum:** 2026-07-24  
**Granskat projekt:** `gridex-ops-platform-main(62)`  
**Omfattning:** Elpriset just nu → import → validering → aggregering → quote → public API → kundansökan samt adress → geokodning → nätområdespolygon → prisområde → quote → kund/anläggning.

## Samlad bedömning

Projektet har en stark grund: tenantautentiserade API-rutter, canonical publicering, immutable quote, prisområdestabeller, komplett polygonbaserad resolver, driftkontroller och flera regressionssviter. Men flödet är **inte produktionssäkert ännu**.

De största problemen är inte att den externa tjänsten Elpriset just nu saknas. Klienten finns och URL-formatet är korrekt. Problemen är i stället:

1. OPS har två motsägande prisarkitekturer: dokumentationen säger att tenant hämtar marknadspriset, medan OPS quote hämtar spotunderlag från OPS-databasen.
2. Ett historiskt komplett månadspris blir ogiltigt efter standardmässigt 180 minuter, trots att importören aldrig låser raden.
3. Quote är inte kryptografiskt eller relationellt bunden till resolverns `resolution_id`; klienten får själv skicka `price_area`.
4. En inskickad giltig `grid_area_code` accepteras före adresskontroll och kan därför vinna trots att adressen ligger i ett annat nätområde.
5. Elpriset just nu används som om tjänsten vore ett fullständigt framtids- och månadsprognos-API. Den lämpar sig i första hand för publicerade dygnsvärden, inte en ännu ofullständig framtida leveransmånad.
6. Spotimporten saknar robust timeout, retry, fullständighetsvalidering, transaktionell kedja och jobblåsning.
7. SVK-geometrikronen återupptar pågående import men startar inte automatiskt en ny periodisk uppdatering.
8. API-dokumentationen och admin-UI beskriver en annan marknadsprisarkitektur än den kod quote-motorn faktiskt använder.

**Produktionsbeslut:** Lösningen bör inte släppas som canonicalt publikt prisflöde förrän P0-punkterna i denna rapport är åtgärdade.

---

# 1. Nuvarande faktiska flöde

## 1.1 Spotpris

```text
Elpriset just nu
  ↓ fetchElprisetJustNuDay()
spot_price_intervals
  ↓ dagssammanställning
spot_price_daily_summaries
  ↓ aggregateMonthlySpotPrices()
spot_price_monthly_summaries
  ↓ company_market_price_sources + selectMarketPriceRow()
calculateOfferQuote()
  ↓
website_contract_quotes
  ↓
POST /api/v1/website/quote
```

## 1.2 Områdesresolver

```text
POST /api/v1/website/energy-area/resolve
  ↓
resolveEnergyContext()
  ├─ explicit grid_area_code
  ├─ adresscache
  ├─ Papilite geokodning
  ├─ SVK polygonmatchning
  ├─ platform_grid_areas
  ├─ grid owner-mappning/readiness
  └─ postnummerförslag som fallback
  ↓
customer_site_resolution
  ↓
API-svar med resolution_id, price_area och automation_allowed
```

## 1.3 Quote och ansökan

Nuvarande quote-request skickar själv:

```json
{
  "offer_reference": "...",
  "price_area": "SE3",
  "annual_consumption_kwh": 12000,
  "start_date": "2026-09-01",
  "grid_area_code": "...",
  "postal_code": "..."
}
```

`resolution_id` från resolver-endpointen kan inte skickas i quote-kontraktet. Quote sparar därför klientens prisområde och nätområde, inte den verifierade resolverposten.

---

# 2. Det som redan är korrekt

## API och säkerhet

- Resolver- och quote-rutterna är tenantautentiserade och scope-skyddade.
- Request-body har storleksgräns på de centrala publika rutterna.
- API-svar använder `Cache-Control: no-store` för quote och resolution.
- Request- och usage-loggning finns.
- Public-contracts har tenant- och kanalbunden kontraktsmodell.
- Fastpris kan publiceras som ett avtal med flera SE-prisrader.

## Spotprisgrund

- Elpriset just nu-klienten bygger rätt endpointformat.
- Intervalltabellen har unik nyckel på källa, prisområde och tidsintervall.
- Databasen kräver `time_end > time_start`.
- Månadsaggregatorn använder tidsviktning och kan hantera DST-månader.
- Aggregatorn kontrollerar sammanhängande täckning innan månaden markeras komplett.
- Prisområdena begränsas till SE1–SE4.

## Resolvergrund

- Papilite-anropet har timeout och blockerar redirects.
- SVK ArcGIS-importen har strikt origin/path-allowlist och timeout.
- Resolvern kan använda adress → koordinat → polygon → nätområde → prisområde.
- Postnummerfallback markeras som förslag och ger inte automatiskt ett verifierat nätägarunderlag.
- `automation_allowed` skiljs från ett vanligt resolverresultat.
- Grid owner-readiness kan blockera automatisk marknadsprocess.
- Kundansökan kör ny kontroll av energiområdet och kan upptäcka quote-mismatch.

---

# 3. P0 – Produktionsblockerande fel

## P0.1 Två konkurrerande marknadsprissanningar

### Fel

Public API-dokumentationen och admin-UI säger att externa tenants själva hämtar marknadspris. Samtidigt hämtar `calculateOfferQuote()` marknadspris från OPS tabeller.

Det kan ge:

- ett pris i tenantens kalkylator;
- ett annat pris i OPS quote;
- ett tredje slutligt pris i faktureringen;
- svårförklarliga quote-mismatchar;
- ansvarsförskjutning när marknadsdata saknas eller är inaktuell.

### Ska byggas

OPS ska vara canonical ägare även för den **indikativa quote-referensen**. Tenantens webb ska endast:

1. hämta publicerat avtal;
2. hämta verifierat område från OPS;
3. begära quote från OPS;
4. visa quote exakt som returnerad;
5. validera och skicka samma quote-reference vid teckning.

Tenanten får använda extern data för fristående informationsgrafik, men den får inte användas som den signerbara offertens canonicala prisunderlag.

---

## P0.2 Indikativt pris och slutligt avräkningspris blandas ihop

### Fel

Quote-motorn försöker hitta en månadsrad för kundens startmånad. En framtida eller pågående månad är normalt inte komplett. Elpriset just nu är inte ett generellt framtidsmånadsprognos-API.

Det innebär att rörligt månads-, tim- och kvartspris kan ge `market_price_unavailable` trots att produkten i sig är teckningsbar.

### Ska byggas

Inför två separata begrepp:

### A. `market_preview_reference`

Används enbart för kundens prisindikation:

- senaste kompletta dygn;
- month-to-date;
- rullande 7/30 dagar;
- eller tydligt konfigurerad prognoskälla.

Måste innehålla:

```json
{
  "source": "elprisetjustnu",
  "price_area": "SE3",
  "reference_period": "rolling_30_days",
  "as_of": "2026-07-24T13:30:00+02:00",
  "price_sek_per_kwh": 0.62,
  "is_indicative": true,
  "includes_vat": false,
  "includes_fees": false
}
```

### B. `settlement_price_evidence`

Används av faktureringen först när leveransperioden har fullständig mät- och marknadsdatatäckning:

- exakt intervallkälla;
- full täckning;
- låst period;
- immutable efter fakturering.

Quote får aldrig beskriva ett indikativt värde som slutlig framtida spotkostnad.

---

## P0.3 Felaktig freshness-policy gör kompletta månadspriser oanvändbara

### Fel

`selectMarketPriceRow()` underkänner alla icke-låsta rader som är äldre än tenantens `max_age_minutes`, normalt 180 minuter.

Importören skapar status `complete`, men låser inte månadsraden. Scheduler ser sedan raden som komplett och importerar den inte igen. Efter tre timmar kan samma rad därför inte väljas av quote-motorn.

### Konsekvens

- importen är grön;
- databasen innehåller komplett månad;
- scheduler säger `already_available`;
- quote säger ändå att marknadspris saknas.

### Ska byggas

Freshness ska bero på datatyp:

- **live/preview:** kontrollera `provider_fetched_at` och en kort max-age;
- **komplett historisk period:** ingen löpande max-age, eftersom perioden inte förändras;
- **slutlig avräkning:** kräver `locked` och `locked_at`;
- **prognos:** kontrollera både `generated_at` och prognoshorisont.

Lägg inte samma 180-minutersregel på historisk settlementdata.

---

## P0.4 Quote är inte bunden till resolverresultatet

### Fel

Resolvern returnerar `resolution_id`, men `WebsiteQuoteRequest` saknar fältet. Quote-route accepterar ett fritt `price_area` från klienten och sparar det direkt.

Kunden kan därför få en quote för SE3 trots att adressen senare verifieras som SE4. Kundansökan kan stoppa detta, men kunden har då redan sett och accepterat fel pris.

### Ska byggas

Utöka befintlig quote-request additivt:

```json
{
  "resolution_id": "uuid",
  "offer_reference": "offer_...",
  "annual_consumption_kwh": 12000,
  "start_date": "2026-09-01",
  "customer_type": "private"
}
```

På serversidan ska quote:

1. läsa `customer_site_resolution` med `company_id + resolution_id`;
2. kontrollera att resolutionen inte är för gammal eller ersatt;
3. kräva tillåten status;
4. hämta `price_area` och `grid_area_code` från posten;
5. ignorera eller avvisa motstridiga klientfält;
6. spara `energy_resolution_id` på `website_contract_quotes`;
7. returnera en sanerad resolver-snapshot i quote-svaret.

För bakåtkompatibilitet kan gamla klienter tillfälligt få skicka `price_area`, men quoten ska markeras `resolution_binding=legacy_unverified` och inte få konsumeras efter sunset-datum.

---

## P0.5 En inskickad grid-area claim kan vinna över adressen

### Fel

`resolveEnergyContext()` kontrollerar `gridAreaCode` innan full adress. Om koden finns i masterdata returneras den direkt utan adresskorsning.

En tenant kan alltså skicka en existerande men felaktig nätområdeskod och få ett mastervaliderat resultat trots att adressen ligger i ett annat område.

### Ska byggas

- Behandla alla tenantinskickade nätområdesvärden som **claims**, inte fakta.
- Om full adress finns ska adress/polygon alltid kontrolleras.
- Om claim och polygon matchar: `grid_area_master_validated`.
- Om de inte matchar: `needs_review`, `automation_allowed=false`, felkod `grid_area_address_mismatch`.
- Direkt acceptans får endast ske när koden kommer från en tidigare tenantbunden, verifierad `resolution_id` eller ett verifierat anläggningssvar.

---

## P0.6 Dagsimport markeras komplett bara för att en rad finns

### Fel

Importören sätter `spot_price_daily_summaries.status='complete'` om `day.length > 0`.

En providerrespons med en enda rad kan därför markeras komplett. Det finns ingen kontroll av:

- förväntad tidslängd för dygnet;
- luckor eller överlapp;
- dubletter;
- fel datum;
- fel prisområde;
- full 23/24/25-timmarstäckning;
- 92/96/100 kvartsvärden under DST-dygn.

### Ska byggas

Skapa en gemensam `validateSpotDayCoverage()` som:

1. sorterar intervallen;
2. kräver `end > start`;
3. kräver att alla rader ligger i det efterfrågade svenska kalenderdygnet;
4. kontrollerar sammanhängande täckning;
5. kontrollerar inga överlapp;
6. beräknar förväntad dygnslängd i `Europe/Stockholm`;
7. markerar `complete` först när hela dygnet täcks;
8. annars sparar `incomplete` med konkret felkod.

---

## P0.7 Databasfel vid dagssammanställning ignoreras

### Fel

Resultatet från `spot_price_daily_summaries.upsert()` kontrolleras inte. Importen kan fortsätta och rapporteras slutförd trots att dagssammanfattningen aldrig sparades.

### Ska byggas

Kontrollera alltid `error` på samtliga Supabase-operationer. Ett fel ska:

- markera aktuell area/dag som misslyckad;
- sparas i import-run;
- hindra att området rapporteras som komplett;
- kunna retryas idempotent.

---

## P0.8 Ingen importlåsning eller atomisk jobbmodell

### Fel

Två cron/manual/quote-triggerade importer kan starta för samma källa, månad och prisområde samtidigt.

Unik intervalldeduplikering begränsar dubletter, men skyddar inte mot:

- dubbla externa anrop;
- konkurrerande summaries;
- inkonsekventa run-statusar;
- race mellan partial och complete;
- onödig providerbelastning.

### Ska byggas

Inför en DB-baserad jobbnyckel:

```text
source + price_area + period_type + period_key
```

Använd antingen:

- PostgreSQL advisory lock; eller
- partial unique index för aktiva importjobb; samt
- atomisk RPC för claim/start/finish.

All retry ska återanvända samma logiska jobbidentitet.

---

# 4. P1 – Allvarliga drift- och datakvalitetsfel

## P1.1 Klienten saknar timeout och retry

`fetchElprisetJustNuDay()` använder vanlig `fetch` utan AbortController/timeout, retry, jitter eller Retry-After-hantering.

### Bygg

- 8–12 sekunders timeout;
- högst 3 retryförsök för 408, 429 och 5xx;
- exponential backoff med jitter;
- respektera `Retry-After`;
- ingen retry på 400/404 för framtida ännu ej publicerat datum;
- strukturerad providerfelkod.

---

## P1.2 Providerpayload valideras för svagt

Klienten kontrollerar endast numeriskt SEK-pris och att start/slut finns.

### Bygg

Validera med schema:

- ISO-8601 timestamps;
- ändlig numerisk prisdata;
- positiv intervallängd;
- tillåten upplösning;
- samma efterfrågade prisområde och datum;
- stigande intervall;
- inga dubletter;
- content-type JSON;
- max payloadstorlek.

`detectResolution()` får inte klassificera ett noll- eller negativt intervall som kvart.

---

## P1.3 En hel månad hämtas sekventiellt per område

Nuvarande import gör cirka 120 externa anrop sekventiellt för en 30-dagarsmånad och fyra områden. Det riskerar serverless-timeout och gör retry långsam.

### Bygg

- Ett jobb per källa + område + dag.
- Begränsad concurrency, exempelvis 4–8.
- Persistens per validerat dygn, inte först efter hela området.
- Separat månadsfinalisering efter att alla dygn är kompletta.
- Återuppta endast saknade dygn.

---

## P1.4 Cronen importerar fel typ av period för publikt quote-flöde

Cronen kör dagligen 03:15 men standardperioden är föregående månad. Den ger därför inte automatiskt dagens/morgondagens data till en publik prisindikation.

### Bygg två pipelines

1. **Live/daily ingest**
   - dagens värden regelbundet;
   - morgondagens värden efter publiceringstid och med retry;
   - alla SE1–SE4;
   - driver preview snapshots.

2. **Historical settlement catch-up**
   - föregående månad;
   - fyll saknade dygn;
   - aggregat;
   - verifiering;
   - låsning efter slutkontroll.

---

## P1.5 Föregående månad beräknas i UTC

Scheduler använder UTC i stället för svensk tidszon. Vid månadsskifte kan systemet under de första timmarna välja fel månad relativt svensk affärsdag.

### Bygg

Använd projektets befintliga Stockholm-hjälpare konsekvent för:

- fakturamånad;
- dygnsgränser;
- DST;
- startdatum;
- cronens föregående period.

---

## P1.6 Komplett summary uppdateras aldrig igen men är inte låst

Scheduler hoppar över en `complete` rad. Importören lämnar den `complete`. Freshness kan sedan göra den oanvändbar.

### Bygg

Statusmodell:

```text
incomplete → complete → verified → locked
```

- `complete`: full tidsmässig täckning;
- `verified`: kvalitetskontroller och källa godkända;
- `locked`: immutable settlementunderlag.

Previewdata ska ha separat status och tabell/read model.

---

## P1.7 “Testa anslutning” testar inte leverantören

Adminåtgärden läser bara senaste lokala `spot_price_intervals`. Den kan visa “Anslutning verifierad” även om leverantören varit nere länge.

### Bygg

Testet ska kontrollera två saker separat:

- **Provider health:** direkt, timeoutskyddat anrop mot ett känt publicerat dygn;
- **Data freshness:** senaste kompletta lokala dygn per SE-område.

UI ska visa båda tiderna och konkreta fel.

---

## P1.8 Konfigurerad base URL används inte

`spot_price_sources.base_url` finns i databasen, men klienten använder en hårdkodad konstant.

### Bygg

Välj en av två konsekventa modeller:

- håll URL i kod och ta bort missvisande redigerbar DB-konfiguration; eller
- läs DB-konfiguration men validera mot strikt allowlist.

För en säker produkt rekommenderas kodstyrd provideradapter + icke-redigerbar canonical endpoint, med metadata i DB.

---

## P1.9 Källhälsa uppdateras inte efter import

Importen uppdaterar inte `spot_price_sources` eller en dedikerad provider-health-tabell med senaste lyckade anrop, senaste fel och latency.

### Bygg

Spara minst:

- `last_attempt_at`;
- `last_success_at`;
- `last_error_code`;
- `last_error_at`;
- `last_http_status`;
- `latency_ms`;
- senaste kompletta dag per område.

---

## P1.10 Interna databas-ID:n riskerar att exponeras i quote

Quote innehåller marknadskällmetadata som kan bära interna summary- och settlement-ID:n. Publika tenants behöver inte dessa implementationdetaljer.

### Bygg

Returnera endast ett sanerat publikt objekt:

```json
{
  "market_reference": {
    "source": "elprisetjustnu",
    "price_area": "SE3",
    "reference_period": "2026-07-23",
    "as_of": "...",
    "price_sek_per_kwh": 0.62,
    "is_indicative": true
  }
}
```

Behåll interna FK/UUID i OPS-databasen och auditloggen.

---

# 5. P1 – Resolver- och geodatafel

## P1.11 Hela resolverresultatets cache används inte

`platform_energy_lookup_cache` finns i databasen men används inte i resolverflödet. Endast adresskoordinater cacheas.

### Bygg

Cachea slutresultatet med:

- normaliserad adresshash;
- geodataversion/import-run;
- grid-area master-version;
- resultatstatus;
- giltighetstid;
- verifieringsnivå.

Invalidation ska ske när geometri eller masterdata uppdateras.

---

## P1.12 Varje publikt resolveranrop skapar auditpost utan dedupe

Prequote-uppslag kan skapa många `customer_site_resolution`-rader för samma adress, även innan ansökan finns.

### Bygg

Dela upp:

- ephemeral lookup/cache;
- canonical resolution evidence som knyts till quote/application.

Alternativt använd unik lookup-hash + TTL och skapa canonical evidence först när quote skapas.

---

## P1.13 SVK-kronen startar inte automatiskt en ny import

Cronen återupptar en `running` import, men om ingen aktiv import finns startas inte en ny schemalagd refresh. Geometrin kan därför bli gammal på obestämd tid efter första manuella importen.

### Bygg

- Daglig/veckovis kontroll av senast slutförda import.
- Starta ny import om geodataversionen är äldre än policy.
- Återuppta pågående import paginerat.
- Blockera parallella imports.
- Publicera `geodata_version`, `imported_at`, coverage och stale-status.

---

## P1.14 Importstatistik kan räkna fel

`records_upserted` sätts till `offset + upserted`. Om tidigare sidor hade fel motsvarar offset inte faktiskt antal lyckade upserts.

### Bygg

Lagra ackumulerade värden från den befintliga run-raden och addera:

- page_seen;
- page_upserted;
- page_failed.

---

## P1.15 Resolverns API-statusar är för lätta att misstolka

Endast `failed` ger 422. `postal_suggested`, `address_resolved` och `needs_review` kan ge HTTP 200.

Det är tekniskt rimligt för en resolutionstjänst, men tenant kan felaktigt tro att `200` betyder att området är verifierat.

### Bygg

Dokumentera och testa en strikt statusmatris:

| Status | HTTP | Får visa indikativt pris | Får skapa bindande quote | Automation |
|---|---:|---:|---:|---:|
| `postal_suggested` | 200 | Ja, tydligt preliminärt | Nej | Nej |
| `address_resolved` | 200 | Ja, preliminärt | Nej | Nej |
| `grid_area_resolved` | 200 | Ja | Enligt policy | Nej |
| `grid_area_master_validated` | 200 | Ja | Ja | Beror på grid owner-readiness |
| `facility_verified` | 200 | Ja | Ja | Ja om övrig readiness är grön |
| `needs_review` | 409 eller 200 med explicit blocker | Nej/valfritt | Nej | Nej |
| `failed` | 422 | Nej | Nej | Nej |

Quote-route ska själv upprätthålla matrisen; tenantens UI får inte vara enda skyddet.

---

## P1.16 Papilite-kontraktet är löst typat

Resolvern stöder flera möjliga payloadformer, men det saknas riktiga provider-fixtures och kontrakttester för de former som production faktiskt returnerar.

### Bygg

- Spara sanerade fixtures från riktiga providerresponser.
- Testa WGS84 och EPSG:3006 separat.
- Testa tom träff, flera träffar, låg confidence och malformed response.
- Sätt provider-version i resolverdiagnostiken.

---

# 6. P2 – Dokumentation, observability och underhåll

## P2.1 API-dokumentationen motsäger koden

Dokumentationen säger både:

- tenant hämtar extern marknadsprisindikation; och
- tenant ska skapa canonical OPS quote.

Samtidigt använder quote OPS interna marknadsunderlag.

### Bygg

Dokumentera en enda modell:

- OPS äger signerbar quote;
- OPS resolver äger price area;
- preview marknadspris är indikativt och källmärkt;
- settlement är internt och slutligt;
- tenant visar, men räknar inte om canonical quote.

---

## P2.2 Public-contracts-fälten beskriver fel ansvar

`market_price_responsibility='tenant'` och `market_price_supplied_by_ops=false` matchar inte quote-motorns nuvarande beteende.

### Bygg

Ändra additivt till exempelvis:

```json
{
  "market_pricing": {
    "public_contract_contains_market_price": false,
    "canonical_quote_supplied_by_ops": true,
    "preview_reference_kind": "indicative",
    "settlement_supplied_by_ops": true
  }
}
```

Behåll gamla fält under deprecationperiod men gör dem inte motsägande.

---

## P2.3 Saknade mätetal

### Bygg dashboard/alerts för

- senaste provider-success per område;
- senaste kompletta dygn;
- antal luckor/överlapp;
- importer lag;
- preview age;
- ofullständiga månader;
- stale geometri;
- polygon no-match rate;
- Papilite latency/fel;
- andel `postal_suggested`/`needs_review`;
- quote-resolver mismatch;
- `market_price_unavailable` per offer/tenant.

---

## P2.4 Raw provider- och adresspayload kräver retentionpolicy

Spotrådata och geokodningspayload sparas. Adresspayload kan innehålla personkopplad adressinformation.

### Bygg

- minimera rådata;
- maska onödiga fält;
- definiera retention;
- begränsa läsning till service role/plattformsroller;
- logga åtkomst vid känsliga resolverdata.

---

# 7. Närliggande röda regressioner i projektet

Följande befintliga regressionssviter är röda och måste hållas separata från själva spot/resolver-arbetet, men de påverkar hela teckningskedjans tillförlitlighet:

## `gridex-website-application-ops-chain-regression`

Tre fel:

1. external intake använder inte `ensureCustomerForIntake` utan riskerar blind kundinsert;
2. dedupe saknas/är otillräcklig på normaliserad e-post, personnummer och organisationsnummer;
3. failed/needs_review-idempotensrader replayas inte korrekt.

## `gridex-website-application-canonical-dispatch-regression`

Två fel:

1. befintliga idempotenta `metering_points` patchas inte med canonicala områdesfält;
2. ny insert skriver inte hela canonicala grid/price/owner/consumption-kontexten.

## `gridex-website-application-idempotency-hardening-regression`

Två dokumentationsfel:

1. current supplier-fälten saknas i en av dokumentationsytorna;
2. dispatch readiness förklaras inte konsekvent.

Dessa fel ska inte döljas genom att ändra testerna. Implementation och dokumentation ska rättas.

---

# 8. Canonical målarkitektur

```text
1. GET /public-contracts
   └─ Ett avtal per produktversion, area_pricing för fastpris

2. POST /energy-area/resolve
   └─ OPS skapar tenantbunden resolution evidence

3. POST /quote { resolution_id, offer_reference, consumption, start_date }
   ├─ OPS laddar verifierat område
   ├─ OPS väljer fast SE-pris eller indikativ market_preview_reference
   ├─ OPS inkluderar alla avgifter och momsregler
   └─ OPS fryser quote immutable

4. POST /quote/validate
   └─ OPS validerar samma quote, resolution, version och giltighet

5. POST /customer-applications
   ├─ samma resolution_id
   ├─ samma quote_reference
   ├─ canonical kundmatchning/kundnummer
   ├─ anläggning/mätpunkt
   ├─ immutable pricing snapshot
   ├─ mail
   └─ uppgiftsbegäran/leverantörsbyte

6. Billing
   ├─ exakt mätdata
   ├─ exakt intervalldata
   ├─ verifierad komplett settlementperiod
   └─ locked settlement evidence
```

---

# 9. Rekommenderad datamodell – minsta nödvändiga ändringar

## Ändra `website_contract_quotes`

Additivt:

```sql
energy_resolution_id uuid references public.customer_site_resolution(id),
resolution_status text,
resolution_snapshot jsonb not null default '{}'::jsonb,
market_reference_kind text,
market_reference_snapshot jsonb not null default '{}'::jsonb
```

Lägg index på `company_id, energy_resolution_id`.

## Förstärk spotdata

Lägg till eller separat health/read model:

```text
provider_fetched_at
provider_published_at
coverage_start
coverage_end
coverage_seconds
expected_coverage_seconds
validation_status
validation_errors
verified_at
```

## Separera preview

Rekommenderad tabell/read model:

```text
spot_price_preview_snapshots
- source
- price_area
- reference_kind
- reference_start
- reference_end
- average_sek_per_kwh
- as_of
- freshness_expires_at
- coverage_status
- metadata
```

Månadssummaries ska förbli settlementunderlag, inte återanvändas som live-preview utan tydlig policy.

## Importjobb

```text
spot_price_import_jobs
- source
- price_area
- period_type
- period_key
- status
- attempt_count
- next_attempt_at
- locked_by
- locked_at
- last_error
```

Unik aktiv jobbnyckel ska förhindra parallella dubbletter.

---

# 10. Prioriterad byggordning

## P0 – Gör flödet korrekt

1. Bestäm OPS som source of truth för canonical quote.
2. Separera indikativ preview från settlement.
3. Bind quote till `resolution_id`.
4. Korsvalidera grid-area claim mot adress.
5. Rätta freshness-logiken för historiska summaries.
6. Validera full dygnstäckning före `complete`.
7. Kontrollera alla databasfel.
8. Lägg DB-lås/idempotent jobbmodell på import.

## P1 – Gör driften robust

9. Timeout/retry/schema på providerklienten.
10. Dagbaserad importer med begränsad concurrency.
11. Separata cronflöden för live-preview och historical settlement.
12. Stockholmstidszon i all periodlogik.
13. Provider health + lokal data freshness.
14. Automatiskt ny SVK-refresh.
15. Cache och dedupe av resolverresultat.
16. Sanera publika quote-fält.

## P2 – Gör systemet förvaltningsbart

17. Uppdatera API-dokumentationen.
18. Deprecera motsägande market responsibility-fält.
19. Lägg metrics, alerts och admin-diagnostik.
20. Lägg retentionpolicy för rådata.
21. Rätta de tre närliggande röda regressionssviterna.

---

# 11. Acceptanskriterier före produktion

## Elpriset just nu

- Provider timeout och retry testas.
- Felaktig/partial JSON markeras aldrig complete.
- Normalt kvartdygn, vår-DST och höst-DST täcks korrekt.
- Inga luckor eller överlapp finns för complete/locked data.
- En historisk komplett period förfaller inte efter 180 minuter.
- Preview visar `is_indicative=true` och korrekt `as_of`.
- Fakturering använder aldrig previewvärdet som slutligt settlement.

## Resolver

- Quote kräver giltig tenantbunden `resolution_id`.
- Fel tenant kan inte läsa/använda resolutionen.
- Adress och inskickad grid-area mismatch blockeras.
- Postal suggestion kan inte skapa bindande quote.
- Geodata-health måste vara grön för automatisk polygonresolution.
- Grid owner-readiness avgör automatisk leverantörsbytesdispatch.

## API

- Ett fastprisavtal returneras en gång med `area_pricing`.
- Quote väljer exakt kundens verifierade SE-rad.
- Rörlig quote innehåller sanerad indikativ referens, inte interna UUID:n.
- Quote/validate/application använder samma offer, resolution och snapshot.
- API-dokumentationen beskriver exakt samma ansvar som runtime.

---

# 12. Genomförda statiska kontroller

Gröna i granskningsmiljön:

- energy resolver grid owner regression: 23 kontroller;
- energy resolver contract regression;
- pricing spot auto-import regression;
- public API contract: 30 routes;
- cron idempotency/locking regression;
- canonical fixed-area regression: 31 kontroller;
- contract single-source regression: 90 kontroller;
- API error boundaries: 79 routes;
- API performance/tenant gates;
- website supplier-switch automation regression.

Röda:

- website application OPS chain: 3 fel;
- website application canonical dispatch: 2 fel;
- website application idempotency hardening docs: 2 fel.

Full `npm ci`, Vitest, TypeScript typecheck och Next production build kunde inte slutföras i granskningsmiljön eftersom npm-registret svarade med HTTP 503 under pakethämtning. Det är därför inte korrekt att påstå att full build är verifierad här. Medföljande verifieringsskript kör hela kedjan i användarens lokala miljö.

---

# Slutsats

Den rätta målbilden är inte att låta webben, OPS quote och faktureringen räkna marknadspris var för sig. **OPS ska äga resolver, canonical quote och settlement, men tydligt skilja mellan indikativ prisreferens och slutligt fakturaunderlag.**

Den viktigaste tekniska förändringen är:

> Resolvern ska skapa en tenantbunden `resolution_id`, quote ska ladda området från den posten, och spotmotorn ska lämna en sanerad indikativ preview – medan fakturering endast använder komplett, verifierad och låst settlementdata.
