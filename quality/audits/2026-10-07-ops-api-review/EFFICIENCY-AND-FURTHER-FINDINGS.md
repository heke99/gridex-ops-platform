# Gridex OPS – fler fynd och effektivisering av API

Fortsatt granskning 7 oktober 2026, samma källrevision som tidigare rapporter. Fokus: mätdata, portalens sammanställningar, conditional GET, quote-resolver och idempotent fullmaktsuppladdning. Gridex Web ingår inte. Inga produktionsändringar eller optimeringar infördes.

**Nya resultat:** fyra P2-fynd och ett P3-fynd. Därutöver finns tre optimeringskandidater med lokalt verifierade anropsantal. Slutlig verifiering: **29 tester i 7 filer PASS under Node 22.23.3**. Produktionslatens, verkliga queryplaner och procentuell hastighetsvinst är inte uppmätta.

## F13 – P2: Partner-mätdata innehåller ersatta revisioner

`lib/partner-api/simple.ts:998` läser `normalized_metering_values` med bolag, anläggning, tidsperiod och resolution, men utan `revision_status = current`. Vid korrigering behåller native ingest tidigare raden som `replaced` och skapar en aktuell rad: `20260901165500_link_ediel_sources_during_atomic_metering_ingest_recovery.sql:77`, aktuellt snapshot `schema.sql:70548`. Tabellen är en bastabell; ingen vy eller service-role SELECT-policy filtrerar bort historiken. Äldre compatibility-reader i `core.ts:984` har samma mönster.

**Prov:** verklig simple-handler med syntetiska DB-portar och två rader för samma period: replaced=10, current=12. Svaret innehåller båda värdena. Queryvillkoren saknar revision_status. Det är ett API-läsfel, inte ett bevis om felaktig fakturering.

**Effekt:** integrationen kan dubbelräkna eller välja inaktuell förbrukning. Responsen innehåller inte revisioner som skulle låta klienten skilja raderna åt. **Åtgärd:** definiera aktuell revision som default, filtrera före pagination och behåll historik endast genom en separat uttrycklig kontraktsväg. Testa correction/void/replaced och samma period på flera mätpunkter; bevara bolags-/anläggningsfilter.

## F14 – P2: mätvärdets enhet och riktning stämmer inte med kontraktet

`simple.ts:1010` sätter `value = quantity_kwh`, men skickar databasens `unit` och uppercase direction. Partner OpenAPI på `openApi.ts:410` lovar `unit: kWh` och `type: CONSUMPTION | PRODUCTION`. Native domänen accepterar också Wh/MWh och net_consumption/net_production: `20260712100000_gridex_end_to_end_integrity_hardening.sql:209` och aktuell ingest lagrar dessa fält oförändrade. `normalizeMeteringValues.ts:205` för vidare quantityKwh som value_kwh separat från unit.

**Prov:** verklig handler skickar `{value: 1, unit: Wh}` för en syntetisk rad med quantity_kwh=1 och `NET_CONSUMPTION` för tillåten net-direction. Båda avviker från det publicerade schemat. Den inkonsekventa kWh/enhetsmappningen är verifierad; faktisk förekomst/fel storleksordning i produktionsdata har inte undersökts.

**Effekt:** strikta klienter underkänner svaret; en klient som litar på unit kan tolka storleken fel. **Åtgärd:** bind mängd och enhet till samma kanoniska semantik. Om quantity_kwh redan är normaliserad ska den inte konverteras en gång till efter source-unit. Behåll nät-/bruttoriktningens betydelse genom uttrycklig versionerad modell, inte en blind namnändring som tappar semantik. Testa alla tillåtna units/directions och legacy-reader separat.

## F15 – P2: månadssummor i OPS kundportal räknas från ett ofullständigt urval

Detta gäller OPS inbyggda portal, inte Gridex Web. `lib/customer-portal/db.ts:308` läser senaste rader från metering_values med limit; dashboard använder 250 vid rad 415 och `app/portal/forbrukning/page.tsx:8` använder 500. `summarizeConsumptionByMonth` vid db.ts:331 summerar bara dessa rader. Resultatet visas på månadskort utan en tydlig markering att summan avser ett urval. Detaljlistan säger däremot uttryckligen senaste värden.

**Prov:** actual reader och aggregator med en komplett augusti: 744 timvärden à 1 kWh. Dashboardurvalet summeras till **250 kWh**, förbrukningssidans till **500 kWh**, medan samtliga mottagna värden summeras till **744 kWh**. DB-porten är syntetisk; UI:s användning av dessa helpers kontrollerades i källan.

**Effekt:** kunden kan få en missvisande månadssumma och tro att nätägaren inte levererat data. **Åtgärd:** separat, bolags-/kundbunden databasaggregation över hela månaden med definierade aktuella revisioner/riktningar och konsekvent kalendersemantik. Behåll begränsad detaljlista separat. Returnera täckning/status där månaden verkligen är ofullständig; stora obegränsade råläsningar behövs inte.

## F16 – P2: schemarelease kan få gamla svar att återanvändas via 304

SQL-fingerprint i `20260818121500_master_production_remediation_p0.sql:131`, samma definition i snapshot `schema.sql:93860`, beror på bolag, kanal, kundtyp, Stockholmsdatum och publikationsrevision/token. `app/api/v1/website/public-contracts/route.ts:102` bygger normalfeedens ETag enbart från detta. Body inkluderar schema-version på rad 269; versionen ingår i representationhashen men den används bara för diagnostics vid rad 287.

**Prov:** verklig GET-route returnerar först 200. Med ändrad applikationsschemaversion och oförändrad DB-fingerprint ger föregående If-None-Match sedan 304. Autentisering och fingerprint är syntetiska beroenden; handler/ETag-beslut är riktiga. Ingen allmän deployrutin som garanterat höjer alla publikationsrevisioner vid varje schemaändring hittades i inspekterade scripts/workflows.

**Förutsättningar/effekt:** release ändrar schema/representation, klienten revaliderar en tidigare sparad body och DB-revision samt Stockholmsdatum är oförändrade. Klienten kan då återanvända äldre payload tills någon annan fingerprint-faktor ändras. Detta är ett villkorat releaseproblem, inte bevis för en pågående incident.

**Åtgärd:** låt ETag inkludera kontrakts-/DTO-representationsversion redan på den billiga fingerprint-vägen. Behåll early-304 och tenant/customer/channel/date-avgränsningen. Testa gammalt ETag efter schemaändring samt oförändrat kontrakt med giltig 304.

## F17 – P3: giltiga weak/wildcard-validatorer missar billig 304

`lib/website/publicContractApi.ts:136` jämför bara exakt sträng mot kommaseparerade If-None-Match-värden. GET ska använda weak comparison för denna header; weak-tag med samma opaque värde och `*` vid befintlig representation matchas inte.

**Prov:** matcher returnerar false för båda. Verkligt routetest: stark matching-tag ger 304 med **1 fingerprint-RPC och 0 revision-/tenant-/offer-loaderanrop**; weak-ekvivalent ger 200 med **1 fingerprint-RPC och 3 loaderanrop**. Loaders kan själva göra fler DB-frågor; detta är anropsantal på dessa portar, inte total databas-/nätverkskostnad.

**Åtgärd:** korrekt parser och GET-jämförelse enligt [RFC 9110 If-None-Match](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2), inklusive listor, wildcard och weak-prefix. Gör aldrig 304 före autentisering eller för fel tenant/kundtyp. Ingen produktionslatensvinst är beräknad.

## Effektivisering med konkret underlag

| Kandidat | Uppmätt i lokal kodkedja | Förslag och verifieringsmål |
|---|---|---|
| **E1: färre portalpaketanrop** | Full section-plan: 11 identiska retention-RPC:er + 13 data reads = **24 operationer**. Kärnsektioner + invoices: 7 RPC + 7 reads = **14**. Auth/identity/request-audit tillkommer. | Använd befintligt `include=invoices` när skärmen bara behöver detta och kärnan; hämta övriga sektioner när de behövs. `summary=true` minskar gränserna för vissa tunga sektioner men eliminerar inte hela sektioner. Mät bytes och p95 för den faktiska skärmen innan rollout. |
| **E1b: gemensam säker bundle-läsning** | `apiData.ts:85` gör retentionkontroll före suppress av sektionens auditinsert; guard `customerRecordClasses.ts:65` gör alltid RPC. Den tidigare optimeringen av loggskrivningar tar alltså inte bort dessa 11 kontrollanrop. | Utvärdera en typed, tenant-/kundbunden native bundle-read som verkställer retention inom samma auktoritativa läsning. Ta inte bort säkerhetskontroller eller memoize dem mellan request/tenant. Definiera samtidighets-/revokeringssemantik först; mät queryplan och roundtrips. |
| **E2: undvik storage-skrivning vid fullmaktsreplay** | Verklig Partner createPowerOfAttorney laddar upp filen före idempotenslookup. Ett syntetiskt completed replay av 131 087 byte gör **1 upload + 1 remove**, utan ny POA-mutation. | Validera idempotensnyckel tidigt, beräkna hash och slå upp/claim före storage-side effects. Upload bör ske inom endast den nya mutationens execute. Behåll aktuell auth, ägarskap, input-/hashkontroll och robust cleanup. Mål: 0 upload/remove vid completed replay; då minskar även kostnad och storageberoende för retries. |
| **E3: resolver läser fler priskällor än vissa offerter använder** | Actual resolveBasePriceSourceValues med fast pris, tom marknadspolicy och versionssnapshot utan portfolio gör **2 frågor**: company_market_price_sources + price_plan_versions. | För vidare faktiskt erforderliga source types från pricing config och läs bara de källor som behövs. Fixed-only, mixed, portfolio, preview och settlement behöver egna positiva/negativa kontroller. Marknadsfreshness och settlement ska bevaras där de gäller; ingen generell borttagning/cross-tenant-cache. |

E1:s 24→14 är en lokalt provad skillnad mellan **section-planer**, inte en utförd produktionsoptimering eller en procentvinst i responstid. De flesta bundle-sektioner kör redan parallellt; ytterligare Promise.all överallt är inte en belagd lösning. E2 är inte en påvisad dubblettmutation. E3 är en uppmätt smal resolverkedja, inte hela quotens totalantal frågor; den kräver verifiering av vilka metadata varje offer använder före en fix.

### Mätplan för nästa steg

1. Registrera per viktig route p50/p95/p99, total tid, auth-/DB-/extern-/serializer-tid, response-bytes samt DB/RPC/storage-anropsantal. Samla jämförbara kalla/varma prover i en verifierad testmiljö; sätt inte kund-id/email/token som metric labels.
2. Prioritera portal-bundle, public-contracts 200/304, fixed-only quote och POA first-write/replay. Befintlig `lib/performance/timing.ts` ger strukturerad timing och public-contracts har stage-timings; komplettera där frågan är konkret.
3. För månadssummor och aktuella mätvärden: verifiera correctness först och mät därefter selektiva queryplaner/bytes. Samla månadssumma i databasen, håll detaljrader paginerade och jämför samma verkliga workload.
4. Behåll endast en optimering som förbättrar uppmätt mål och passerar tenant-, retention-, idempotens-, pricing- och kontraktsregressioner. Tidigare verifierade dubblettindex och webhook-dubbelautentisering är redan öppna förslag i tidigare rapporter; de räknas inte som nya fynd här.

## Motprövning och begränsningar

- Partner revisions-/unitfynd motprövades oberoende mot senaste native ingest, bastabell, triggers/policies och schema. Ingen DB-vy filtrerar historiken på vägen.
- Portalens monthly-fynd granskades mot de riktiga helperanropen och UI-etiketterna. Det är totalsummeringen som är problemet; bounded senaste-rader-lista är i sig korrekt.
- ETag-kedjan autentiserar före 304 och separerar tenant/customer/channel/date. Cacheheaders är private/no-store. Ingen offentlig cacheläcka påvisades; klientstyrd manuell revalidation är fortfarande möjlig.
- `publicContractFeedSnapshot` kan i ett syntetiskt 304-prov återanvända ett snapshot som inte matchar nya expected-värden, men inspekterad kod visade **inga produktionscallers**. Den observationen räknas inte som ett nåbart tenantintrång eller ett nytt prioriterat appfynd.
- Misstanken att 5 MB-fullmakter stoppas av standardgränsen 256 KB avfärdades: båda berörda POST-handlers skickar uttryckligen 7 MB till JSON-parsern.
- Ingen full production-profilering, EXPLAIN ANALYZE, native replay, live-affärsoperation eller optimeringspatch kördes i denna komplettering.

## Reproducerbar verifiering

```text
/tmp/gridex-api-review-node22/node_modules/.bin/node node_modules/vitest/vitest.mjs run __tests__/ops-api-efficiency-review.test.ts __tests__/ops-portal-efficiency-review.test.ts __tests__/ops-feed-efficiency-review.test.ts __tests__/ops-feed-route-efficiency-review.test.ts __tests__/public-contract-last-known-good.test.ts __tests__/customer-portal-bundle-audit.test.ts __tests__/website-resolution-cache.test.ts
7 filer / 29 tester PASS
```

Exakta nya prov sparas i `evidence/further-metering-storage.probe.ts`, `further-portal-summary.probe.ts`, `further-feed-resolver.probe.ts` och `further-feed-route.probe.ts`. Lägg dem under __tests__ med motsvarande kommandonamn för återkörning. Resultatet finns i `evidence/further-api-efficiency-tests.log`. De fyra provfilerna omfattar 14 fall; resterande 15 är befintliga regressioner. Temporära tester togs bort först efter färdig körning.

## Föreslagen prioritet

1. Korrekt aktuellt mätdata och mängd/enhet: F13/F14.
2. Korrekt native månadssumma med separat bounded detaljläsning: F15.
3. Versionssäker conditional GET och standardsenlig matcher: F16/F17.
4. Mät/utvärdera befintligt smalare portalpaket, därefter säker bundle-RPC och replay utan storage-skrivningar: E1/E2.
5. Priskällor efter faktiskt behov: E3, först när all mixed/portfolio/settlement-semantik har verifierats.

Alla fynd och förslag är öppna; ingen leverans eller produktionsändring ingår i denna granskning.
