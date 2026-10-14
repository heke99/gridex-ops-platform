# Admin consistency: remediation and live reset

The user authorized a full customer-flow reset after the initial read-only audit below. Root executed fingerprint-guarded transactions that removed **747 approved residual rows** (743 initially, then two distinct classified manual email sources and their derived events). The final live assertion reports **140 empty customer graph tables and 17 zero reviewed scopes**. The later case's original provider identity is not archived, so equality with the first removed message is unproven. A durable exact-source retirement safeguard now blocks recreation after deletion, including concurrent retries. Its private registry contains two source hashes and deletion timestamp, without message content or raw mailbox/provider identity. All three companies have zero pending applications and zero missing-meter counts; the actual monthly rebuild skips empty source data. Company accounts, users, permissions, configuration, market/reference data and independent technical history remain. See [final live receipts](verification/ninth-live-retirement-and-final-zero-receipts.json).

All ten admin forward effects are installed, with the ninth and tenth installed through compatible granular DDL stages after compound calls expired. A tenth forward corrects two structural tenant-index findings by using actual UNIQUE(company_id,open_key) and changing five conflict targets in four current functions. It preserves source7 bodies and metadata. Actual ten-forward CI types/schema/fingerprint have been imported with all hashes verified. Live compatible expansion installed both composite indexes and all four updated writer bodies. The redundant predecessor indexes were removed with authorized idempotent DROP INDEX IF EXISTS calls and the composite indexes now use their canonical names; both are explicitly UNIQUE(company_id,open_key). Live function bodies, owners, privileges and search paths match the native replay. The data-quality migration is expansion-only while the deployed application still uses the legacy conflict target. After the new application is verified and legacy writers are drained, execute only the two legacy unique-constraint drops in [the guarded cutover](cleanup/dqi-after-verified-deployment-cutover.sql). Preserve function bodies supplied by later forwards; do not replay the full earlier migration. Applying the drops before deployment would break the old writer. See [live migration receipt](verification/live-migration-receipt.json) and [successful live receipts](verification/live-completion-receipts.json).

Source changes centralize canonical application identity/state, actionable work status, company context, managed quality rule ownership and valid physical monthly evidence. Portfolio calendar/type/count defects, forecast month selection, Swedish operator labels and future source-deletion lifecycle safeguards are covered by runtime/native SQL regressions. Shared tables remain authoritative; no separate customer copy or second task database was introduced.

The complete real CI unit suite on exact head d37fb138 passed **1,113 test files and 17,979 assertions**, with zero failures or skips. The release-quality gate also passed lint, all three typechecks, mechanical and quality checks, API contracts, RBAC, performance budgets, optimized production build and bundle budget; upgrade migration replay passed. The final d37 tenant invariant failed only those two explicit-company index checks after its native/browser suites passed; parity/final schema checks were not reached. The new tenth forward passed19 current-source lifecycle tests, the two-company native fixture and a real uncapped5001-point PostgreSQL case. The subsequent20abea4a CI passed the unchanged tenant invariant,native/browser suites,upgrade replay and complete release-quality gate. Its sole final comparator failure was the old9-forward baseline; genuine10-forward outputs now replace it. Actual main4e52854e brought five earlier permission/direction/retention forwards. Its full source and provenance are retained. Successful capture38467254556/artifact11850616228 of exact source52a348c8/tree7f2d verifies eight inputs, the immutable tenth tail and raw3 outputs; all generated files are byte-imported. The earlier auto-merged type union happens to equal the authentic output byte-for-byte, but only this actual capture qualifies the current provenance. Fresh composed-head CI, production deployment and the minimal DQI cutover remain required. See [the complete-suite receipt](verification/final-complete-suite-ci-receipt.json). Earlier sandbox timeouts and the8da boundary-fixture failures are preserved historical evidence and are superseded by the current complete green suite. Authentic CI types/schema/fingerprint were imported byte-for-byte from capture38420677087, with head/tree, eight input hashes and output hashes validated. Current required release gates remain separately qualified. Authenticated production UI browsing was unavailable.

Current production is READY on API source `d899ac6b`, associated with open draft PR794. That runtime contains API corrections absent from actual main4e and admin source52. Its current PR head differs only by documentation. A main/admin-only replacement would remove those corrections; the next production delivery must preserve a qualified application union or follow completed API-first delivery. No held API installer or migration stack is imported by this admin packet. See [production ordering evidence](verification/production-api-preservation-dependency.json).

## Preserved initial audit

The following is historical evidence before the user-authorized reset. Its live counts and read-only status do not describe the completed remediation.

# Granskning av admin, datakällor och kvarvarande kunddata

Kontrollerat 13 oktober 2026, cirka 11:25 svensk tid. Kodversion: `51f5fa5e80c42350d697bfed42520672749d4467`. Databas: `piidsfebjqjmnepdpnas`, vilket projektminnet anger som den använda produktionsdatabasen.

Granskningen utfördes av tre avgränsade granskare för gränssnitt/arbetskö, portföljanalys och rensning/tabellrelationer, med samordnad kontroll av live-databasen. Endast granskningsunderlag skapades; applikationskod, migrationshistorik och databasdata ändrades inte.

## Det som förklarar de rapporterade problemen

| Problem | Verifierad orsak | Prioritet |
|---|---|---|
| `/admin/analytics/portfolio` fungerar inte | Funktionen för fullmakter som går ut räknar `(valid_to - current_date)::integer`, men live-kolumnen är en tidsstämpel. PostgreSQL ger fel `42846: cannot cast type interval to integer`. Felet stoppar hela sidan även med tomma kundtabeller. | P1 |
| `/admin` visar ”Mätvärden saknas 6” | Alla sex öppna `missing_metering_values`-poster pekar på mätpunkter som inte längre finns. Räknaren summerar dessa varningar utan att kontrollera att mätpunkterna finns. | P2 |
| En webbansökan finns kvar | `website_customer_applications` innehåller exakt en ofullständig ansökan från 23 augusti. Den har ingen koppling till kund/anläggning/mätpunkt/avtal/intake och ingick därför inte i den tidigare kundrensningens beroendegraf. | P2 |
| Startsida och ansökningslista visar olika antal | Startsidan räknar endast `external_contract_intakes`, som är tom. Ansökningslistan läser även `website_customer_applications`, där den kvarvarande raden finns. | P2 |
| ”Systemord” förekommer | Tabellnamn och interna statuskoder visas i operatörsvyer; vissa hjälpfunktioner saknar svenska översättningar eller används för fel statusdomän. | P3 |

Ansökans testursprung är **inte bevisat**: explicita testflaggor på ansökan/kundpayload/API-klient samt klientnamnets testindikator var samtliga falska. Att kundkopplingen saknas bevisar inte att en ansökan får raderas. Den gamla rensningsfilen avsåg 12 testkunder och åtta syntetiska företag, med slutkontroll av 0 kunder och tre kvarvarande företag; den definierade inte en total tömning av all operativ historik.

## Fler bekräftade fel

| ID | Fynd och effekt | Bevis/status |
|---|---|---|
| DATA-01 | Sammanlagt 18 öppna datakvalitetsärenden hänvisar till borttagna objekt: sex mätvärdesvarningar, två varningar om aktiv mätpunkt utan aktiv kund, fem om saknat kundavtal och fem om långsamt nätägarsvar. Samma räknare används i analys och avvikelsevyer. | Live-kontroll av både objekt-ID och bolags-ID. |
| DATA-02 | Datakvalitetsskannern lägger till fel men avslutar inte ärenden när objekten försvinner eller blir korrekta. Därför hjälper en vanlig ny skanning inte mot kvarlämnade varningar. | `lib/analytics/dataQuality.ts:49-65,132-315`. |
| DATA-03 | Sammanfattningsvarningar dupliceras vid uppdatering och avslutas inte när underlaget blir tomt. Det finns 350 öppna: 156 för saknade mätvärden, 162 för långsamma nätägarsvar, 32 för datakvalitet. Alla saknar objekt-ID; tre identiska grupper använder hela konfliktnyckeln. Vanligt UNIQUE behandlar NULL som olika och därför fungerar inte upsert som deduplicering. | Live-indexdefinition och grupper; `lib/analytics/alerts.ts:13-26,31-112`. Nya rader skapades även 13 oktober. |
| QUEUE-01 | `needs_review`-jobb/händelser samt vissa manuella blockeringar hämtas men filtreras sedan bort ur arbetskön. Ett ärende kan kräva åtgärd i Händelser och ändå saknas i Arbetskö. | Körning av de aktuella filtreringsfunktionerna med syntetiska indata. Live-köerna är tomma; felet gäller när sådana poster uppstår. |
| COPY-01 | Webbansökningslistan visar `website_customer_applications`/`external_contract_intakes` om klientnamn saknas, samt implementeringstext om ”actions”, ”fallback” och ”resolver”. | Normal tenantvy, inte enbart teknisk plattformsvy. |
| COPY-02 | Stödda ansöknings- och matchningsstatusar blir exempelvis ”Facility data invalid” och ”Grid area master validated”. Arbetskön skriver sex stödda åtgärdsstatusar som råa koder. | Aktuella etikettfunktioner körda; producerande kod verifierad. |
| COPY-03 | Samma råa status-/prioritetsvärden finns i Driftöversikt och fakturaunderlag, inklusive detaljsidor. | Verifierade renderingsvägar. |
| PORTFOLIO-01 | Portföljsidan och CSV-exporten ignorerar bolaget som behörighetskontrollen valt och väljer medlemskap igen. Plattformens valda bolag kan ersättas med ett annat eller ge ”Bolag saknas”. | Aktuell scope-funktion körd med syntetiskt bolagsval. Ingen obehörig dataläcka påstås. |
| PORTFOLIO-02 | Kundgruppsberäkningen multiplicerar kundantalet med fyra genom att sammanfoga varje kund med fyra uppföljningsperioder och därefter använda count(*). | Samma live-funktionsdefinition; läsande SQL gav rapporterat 4 för faktisk 1 kund. Nuvarande kundunderlag är tomt. |
| PORTFOLIO-03 | Vald historisk månad används av white-label-översikten men prognosen i detalj/CSV använder dagens datum. Översikt och fördjupning kan därför avse olika prognosmånader. | Aktuella helperfunktioner körda med syntetisk transport; septemberutfall/oktoberprognos. |
| PORTFOLIO-04 | ”Mätvärdesbegäran” inkluderar andra begärantyper i total/felantal, samtidigt som delantalen bara omfattar mätning. | Deployerad SQL och stödda skrivna scope-värden; latent fel, ingen aktuell live-påverkan på tomt underlag påstås. |
| PORTFOLIO-05 | Prognosen använder första dagen i månaden för kundurval. Kunder med leveransstart senare i samma månad kan saknas i hela framtidsprognosen trots att de är aktiva idag. | Deployerade urvalsvillkor jämförda med canonical active-at-date-kontrakt; latent fel. |

Portföljsidans akuta fel ligger i `supabase/migrations/20261003131000_customer_portfolio_phase2.sql:657`, och felet sprids via `lib/analytics/customerPortfolio.ts:215-222` till sidan. En rättning behöver konvertera fullmaktens tidsstämpel till ett uttryckligt kalenderdatum **både** för det returnerade datumet och för dagberäkningen. Att bara rätta intervallets heltalskonvertering lämnar ett typfel i returkolumnen. Behörighetskontrollen ska bevaras och rättningen levereras som en ny migration.

## Databas- och ägandekontroll

- Exakta live-antal: kunder, kundanläggningar, mätpunkter, mätvärden, leveransperioder, kundmånadsdata, jobb och uppgifter = 0. Extern intake = 0; kanonisk webbansökan = 1.
- Kundansöknings-intake, arbetsflöden, arbetsflödeshändelser, provisioningsteg, onboardingansökningar och granskningsrader = 0.
- Nätägarbegäranden, anläggningsbegäranden, leverantörsbyten, normaliserade mätvärden och mätvärdesbatcher/fel = 0.
- Samtliga **1 298 främmande nycklar i public**, över **425 refererande tabeller**, kontrollerades mot faktiskt innehåll i 15 frågebatcher. Inga saknade föräldrar och inga ovaliderade nycklar hittades. Sammansatta nycklar kontrollerades med alla nyckelkolumner.
- Polymorfa `entity_type/entity_id` skyddas inte av dessa nycklar; de 18 avvikelseärendena kontrollerades därför separat.
- Webbansökan ägs fortfarande av ett existerande bolag. De optionala kundkopplingarna är NULL, vilket är ett giltigt förstadium för en ansökan och inget brutet FK.
- `external_contract_intakes.created_*_id` saknar motsvarande kund-/anläggnings-FK i både schema och live-katalog. Tabellen är tom idag, men framtida rensningar måste hantera dessa referenser uttryckligen.
- 72 prognossnapshots har 0 kWh och 0 mätpunkter. De är giltiga automatiskt skapade nollrader. Förekomst av dessa rader är inget kunddataproblem i sig.
- Historiska bolagsmånadsrader finns kvar, bland annat tidigare kundantal i augusti och sex mätvärdesvarningar i flera månader. Tidigare kundantal kan vara avsedd historik; varningsvärdena ärver det felaktiga kvarvarande underlaget. Ingen total radering av historik rekommenderas utan fastställd återställningsdefinition.
- Händelselogg och användningshistorik är egna datakategorier. Avsaknad av kunder innebär inte att dessa automatiskt ska vara tomma.

Detta är en verifierad kontroll av referensrelationer och de aktuella adminflödena, inte en garanti för samtliga affärsregler, tenant-RLS-policyer eller varje möjlig kolumntyp i alla tabeller.

## Prioriterade rättningspaket

1. **Återställ portföljsidan:** ny migration för korrekt datumtyp i fullmaktsfunktionen; kör alla sju sidfunktioner mot samma tidsstämpeltyp som live samt ett test av fulla sidan.
2. **Synkronisera varningar:** avsluta verifierat borttagna källobjekts varningar inom rätt bolag, avsluta/avduplicera scannerägda sammanfattningar och införa NULL-säker unik identitet. En fullständig lyckad skanning ska också avsluta åtgärdade fel; felaktiga/avbrutna skanningar ska bevara befintliga ärenden.
3. **Samla ansökningsdefinitionen:** samma kanoniska datakällor och statusdefinition på startsida/lista/arbetskö; tenant-säker deduplicering av speglade ansökningar. Skapa ett separat, uttryckligt rensningsscope för ansökningar som aldrig blev kunder. Den specifika kvarvarande raden kräver klassificering innan radering.
4. **Rätta arbetskön:** gemensam åtgärdsdefinition som tar med stödda gransknings- och blockeringsstatusar. Testa verkligt renderade rader med ensamt granskningsjobb respektive händelse.
5. **Svenska gränssnittstexter:** använd typade statusetiketter för respektive domän, ta bort tabellnamn från vanlig operatörstext och samla tekniska uppgifter under behörighetsstyrd diagnostik.
6. **Portföljens beräkningsfel:** små separata ändringar för bolagsval, kundgruppens count(distinct kund), gemensam prognosmånad, scope-filtrerade begärantotaler och urval vid faktisk prognosdag.

## Verifiering, avfärdade misstankar och begränsningar

| Kontroll | Resultat |
|---|---|
| Exakta tabellantal och polymorfa källreferenser | Godkända läsande frågor; fynd ovan. |
| 1 298 live-FK-kontroller | 15/15 batcher lyckades; 0 saknade föräldrar. |
| Sju portföljfunktioner | Fullmaktsfunktionen misslyckades med 42846. Övriga sex lyckades för alla tre bolag: summary/forecast/accuracy 12 rader vardera; churn/cohorts/zones 0. |
| Kundgruppens SQL-reproduktion | Faktisk 1, rapporterad 4. |
| Aktuella etikett-/arbetsköfunktioner | Syntetiska reproduktioner bekräftade råkodstext och bortfiltrering. |
| Portföljens kalender- och bolagsreproduktioner | Körda igen av samordnaren; båda lyckades. |
| `node scripts/check-supabase-generated-types.cjs` | Godkänd lokal genererad typsnapshot. Den kontrollen fångar inte tidsstämpel kontra date när båda blir TypeScript string. |
| `node scripts/check-migration-versions.cjs` | Godkänd, 1 152 filer/1 055 versionsgrupper. |
| `git diff --check` | Godkänd; endast granskningsunderlag tillagda. |
| Befintligt Vitest-test | Kunde inte köras: dependencies/node_modules saknas, `vitest: not found`. |
| Autentiserad webbläsarresa, build, full testsvit | Inte körda. Felorsaken för portföljsidan är verifierad direkt i live-databasen. |

Avfärdat: importförhandsvisningens missingFields är redan svenska; Händelser översätter sin nuvarande statusunion och begränsar tekniska detaljer till plattformsbehörighet; tekniska nätägarregister är inte vanliga tenantvyer; nollprognoser vid tomt kundunderlag är förväntade. Det finns inget stöd för att dagens räknarproblem är klientcache, en ny ansökan efter rensningen eller brutna deklarerade FK.

## Granskningsrutiner och underlag

Använda rutiner: cloud-environment-runtime, Supabase och Postgres-guiden för live-frågor, lokal code-review/find-bugs för hela producerande/läsande flöden, variant-analysis för liknande fel, direkt verifiering/fp-check för att avfärda falska träffar samt verification-before-completion. Lokal dispatching-parallel-agents lästes; användaren begärde uttryckligen tre agenter. Relevanta admin-/portföljcheckpointfiler och AGENTS.md lästes. Inventering, fynd, ägandematris, verifieringsmatris, avfärdade kandidater och rättningspaket finns här och i delrapporterna.

Full ny arkitekturdokumentation, Ediel-masterplanens leveranser/claims, implementation/TDD, branch/PR-publicering, infrastruktursättning, beroendebyten, prestandakampanj och komplett säkerhetsgranskning är utanför detta granskningsuppdrag. Ingen sådan leverans eller certifiering påstås. Nästa steg är de avgränsade rättningspaketen ovan; tidigare Edielarbete och gemensamma campaign-memoryfiler har bevarats.

- [Live-bevis](live-evidence.json)
- [Texter och arbetskö](copy/findings.md)
- [Portföljanalys](portfolio/findings.md)
- [Rensning och tabellägande](cleanup/README.md)
- [Läsande kompletterande SQL](cleanup/read-only-followups.sql)

