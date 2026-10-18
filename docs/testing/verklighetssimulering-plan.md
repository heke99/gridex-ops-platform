# Plan: verklighetssimulerande tester för Gridex OPS

Status: förslag 2026-10-18. Bygger på det live-likt kedjetestet (`quality/audits/live-chain-20261015/FINDINGS.md`), en inventering av 244 API-rutter, 21 cron-jobb och alla externa integrationer, samt läsfrågor mot drift.

## 1. Varför en ny testnivå behövs

Vi har 1 180 enhetstester, 109 native-tester, 18 Playwright-specar och k6-skript. Ändå hittade ett enda realistiskt flöde (en nätägare skickar 30 dygnsfiler) fel som stoppade hela kedjan. Det berodde på tre saker som dagens tester inte simulerar:

| Det som saknas | Exempel på fel det missade |
|---|---|
| **Historik och volym.** Kostnaden växer med data som redan finns, inte med antalet samtidiga anrop. | F10 (kvadratisk per bolag), F10b (linjär per bolag), F19 (linjär för hela plattformen): tidsgräns efter 10 filer, respektive vid ~12k meddelanden. |
| **Riktiga felbeteenden.** Avbrott mitt i en körning, låsning mellan tenanter, beroenden som hänger. | F18, F20–F23 (poster som fastnar för alltid), F11 (deadlocks), L1 (10 min låsväntan). |
| **Riktig trafikform.** Formatvarianter, dubbletter, rättelser, sena och omkastade meddelanden, flera anläggningar. | F2–F9 (IMAP, tokenizer, uuid-filter), F17 (inläsningen avbröts efter första värdet). |

k6-skripten gör bara GET mot `/`, `/login` och `public-contracts`. Lastplanen (`docs/load-test-plan.md`) beskriver scenarier, men de för Ediel, inläsning och utkorgar är inte byggda.

**Läget i drift (läsfrågor, 2026-10-18):** 3 bolag, 0 kunder, 0 mätpunkter, 1 Ediel-meddelande. Riktig kunddata finns alltså inte än. Realism måste komma från tre källor:
1. **Riktiga format och regler:** Ediel-guiderna, plus riktiga meddelanden från Ediels testsystem (TGT) och aktörstest (AGT).
2. **Riktig trafikform:** `integration_api_requests` har 11 159 verkliga API-anrop från webbplatsen (fördelning per rutt och takt; inga kroppar med personuppgifter).
3. **Realistiska volymer:** modellerade på en svensk elhandlare i tre storlekar (avsnitt 4).

## 2. Principer

1. **Mät kostnad per affärshändelse som funktion av historik**, inte bara svarstid. Varje operation körs vid N och 10N i historik. Kvoten får vara högst 1,5, annars är kostnaden inte begränsad. Mätetal: `pg_stat_statements`-anrop, antal rader operationen rör (`pg_stat_xact_user_tables`, deterministiskt som i `scripts/ediel-ack-original-scale-native.test.ts`) och antal databasrundor per händelse.
2. **Inget får fastna tyst.** Efter varje scenario körs en stoppdetektor (avsnitt 6). Varje rad i ett icke-slutligt tillstånd som är äldre än sin tröskel räknas som ett fel.
3. **Samma gränser som i drift:** 8 s per sats, 8 s låsväntan, `max_connections` 60, ~300 s per funktion, cron var 5:e minut. Verifierat lika i drift och staging.
4. **Syntetiskt, märkt och raderbart:** `E2E-`-prefix, `example.invalid`, testpersonnummer från Skatteverkets testserie och Ediels test-ID (91100/91109). Städning sker per körnings-ID. Aldrig mot driftens Ediel, och mot driftdatabasen bara läsfrågor med aggregat.
5. **Deterministiskt:** generatorer med seed. Ett fel ska kunna återskapas exakt.
6. **Ett fel = ett test.** Varje fynd får ett regressionstest som blir rött utan rättningen (samma regel som i F-registret).

## 3. Testnivåer och miljöer

| Nivå | Miljö | Vad den ger | Körs |
|---|---|---|---|
| R0 | PGlite och vitest | SQL-funktioner och kodvägar isolerat, egenskapstester | varje PR |
| R1 | Lokal native: Supabase i docker + `next start` + GreenMail (SMTPS/IMAPS) + Storage | Hela kedjor med riktig HTTP, cron, SMTP/IMAP, RLS och tidsgränser. Grunden finns: `scripts/live-metering-billing-chain-native.test.ts` | nattligt och per relevant PR |
| R2 | R1 + felinjektion: Toxiproxy framför SMTP, IMAP och PostgREST, samt mockservrar för HTTP-leverantörer | Långsamma beroenden, hängningar, 429/500, avbrott mitt i körning | nattligt |
| R3 | Staging (hostad, samma gränser som drift) med syntetisk volym | Vercels tidsgräns, anslutningspool, region `arn1`, verklig latens | veckovis och före release |
| R4 | Extern verklighet: Ediel TGT/AGT med riktiga nätägare, elprisetjustnu.se, papapi.se | Riktiga motparter och format | enligt aktivering och ägarens grindar |

## 4. Datagenerator: "virtuell elmarknad"

Ett nytt bibliotek, `scripts/helpers/virtual-market/`, med seed och märkning. Det skapar via appens egna vägar (API eller serveråtgärder) där det går, och annars via SQL som speglar dem, som native-fixturerna gör idag.

**Storlekar**

| Nivå | Tenanter | Kunder | Anläggningar / mätpunkter | Inkommande Ediel per dygn | Historik |
|---|---|---|---|---|---|
| S (lansering) | 5 | 5 000 | 6 000 / 6 500 | ~6 500 | 3 mån |
| M | 10 | 50 000 | 60 000 / 65 000 | ~65 000 | 12 mån |
| L | 20 | 300 000 | 360 000 / 400 000 | ~400 000 | 24 mån |

Historik genereras bakåtdaterad ("åldrad data") i stället för att spola tiden framåt, eftersom databasens `now()` inte går att styra. Fynden F10, F10b och F19 kom just från historik.

**Kunder och anläggningar (fördelning)**
- 85 % av kunderna har 1 anläggning, 12 % har 2–3 och 3 % har 4–50 (företag och bostadsrättsföreningar).
- Profiler: lägenhet, villa med direktel, villa med värmepump, elbil, solcellsproducent (produktion och nettovärden), företag med effekttaxa.
- Prismodeller: spot per elområde SE1–SE4, fast, rörlig med påslag; blandade inom samma kund.
- Tillstånd: aktiv, under byte, flytt in eller ut, uppsagd, migrerad (`source='migration'`, aldrig fakturerbar).

**Mätvärden:** per mätpunkt och dygn 24 timvärden eller 96 kvartsvärden. Det finns också månadsfiler med 2 976 värden. Värdeprofiler följer säsong och veckodag, och inkluderar luckor, skattade värden, nollor och negativ nettoförbrukning.

## 5. Motpartssimulator: "nätägaren"

Detta är den viktigaste nya komponenten. Den är en process som agerar nätägare (och vid behov balansansvarig eller annan leverantör) över riktig SMTP och IMAP mot GreenMail. Den bygger meddelanden med projektets egna byggare (`buildContrl`, `buildAperak`, PRODAT-renderaren, `dailyE66()` i `live-chain-fixture.ts`) och följer guidens regler.

**Beteenden (konfigurerbara sannolikheter och fördröjningar per scenario)**
- **Svar på våra PRODAT:**
  - Z03 → Z04 eller Z02 (avslag med orsak)
  - Z08 → kvittens
  - Z01 → Z05/Z06
  - CONTRL och APERAK (positiva och negativa)
  - svarstid från sekunder till dagar
- **Spontana meddelanden:**
  - daglig E66 per mätpunkt
  - rättelser: samma period, ny version
  - Z14/Z15, ESCO
  - S02/S03/S05
- **Verklighetsstörningar:**
  - dubbletter: samma fil två gånger eller samma referens med nytt innehåll
  - fel ordning: rättelse före original
  - sena och saknade svar
  - fel mottagare
  - främmande tenants referens
- **Formatvarianter:**
  - UNA med egna avgränsare och release-tecken
  - CRLF och LF
  - ISO-8859-1 och UTF-8
  - S/MIME giltigt, utgånget eller fel nyckel
  - stora filer
  - flera mätpunkter i samma interchange
  - DSN- och studsmejl
- **Felaktiga meddelanden:**
  - syntaxfel, ska ge CONTRL med kod 4
  - affärsfel, ska ge APERAK
  - trunkerade filer
  - tomma bilagor

**Kontroller efter varje scenario:** varje inkommande fil ger exakt en korrekt CONTRL, och APERAK där guiden kräver det. Inga dubbla effekter. Rätt tenant. Tiden från mottagning till kvittens ryms inom guidens frist.

## 6. Stoppdetektor (invariantkontroll)

Det här är en SQL-rapport som listar varje kö och vilka tillstånd som inte får bli liggande:

| Tabell | Fastnat om |
|---|---|
| `inbound_email_messages` utan jobb | `received`/`not_checked` > 10 min (F23) |
| `inbound_processing_jobs` | `queued` eller `processing` > 15 min; `attempts_count > max` (F22) |
| `ediel_outbox` | `queued` > 10 min; `sending` > lease; `blocked` med `last_error='active_ediel_send_lock'` när låset är släppt (F20); `delivery_uncertain` > 1 h (larm) |
| `tenant_email_outbox`, `manual_email_outbox` | `queued`/`processing` > 15 min; `blocked_tenant_state` för ett aktivt bolag (B1) |
| `webhook_deliveries` | `queued` efter `next_attempt_at` + 10 min |
| `billing_automation_runs` | `running` > 1 h (F18) |
| `customer_operation_jobs`, `company_provisioning_jobs` | `queued` eller `leased` efter lease |
| Ediel-meddelanden | inkommande `parsed` utan CONTRL > 15 min (F10) |

Rapporten körs efter varje R1–R3-scenario och kan också köras som daglig hälsokontroll i drift (läsfråga).

## 7. Felinjektion (R2)

| Fel | Hur | Förväntat |
|---|---|---|
| SMTP hänger (accepterar TCP, svarar aldrig) | Toxiproxy `timeout` | **H1:** `sendEdielEmail` och Resend saknar timeout. Cronen ska ge upp i tid, posten bli `delivery_uncertain` eller omförsök, och nästa körning fortsätta. |
| SMTP och IMAP långsamma eller nedkopplade | Toxiproxy `latency`, `reset_peer` | omförsök, inga dubbla sändningar |
| PostgREST eller databasen långsam | Toxiproxy på 54321 och 54322 | 8 s-gränsen ger fel som redovisas, inte tysta stopp |
| Funktionen dödas mitt i körningen | `kill -9` på `next start` vid slumpad punkt under cron | allt återupptas vid nästa körning (F21–F23) |
| Två cron-körningar samtidigt | anropa samma cron parallellt | inga dubbla effekter, låsen håller |
| Storage nere | stoppa containern | sändning `failed` med orsak; omförsök efter återställning |
| HTTP-leverantörer: elprisetjustnu, papapi, Lantmäteriet, SVK, Capway, Resend, webhook-mottagare | mockserver med lägena 200 / 429 + `Retry-After` / 500 / långsam / hänger / felaktig JSON | timeout och backoff enligt klienten; kretsbrytare (SVK); dead-letter (webhooks) |
| Tenanten pausas eller stängs av mitt i flödet | `canonical_transition_*` under pågående utkorg | blockeras, och släpps vid återaktivering (F20; B1 kräver beslut) |
| Låskonflikt mellan tenanter | lång skrivtransaktion i tenant A under B:s ACK-flöde | **L1:** mät väntan; ska inte nå 8 s |

## 8. API-tester mot projektets egna API

244 rutter: 54 OpenAPI, 12 website, 21 customer, 19 staff, 75 ediel, 26 internal, 11 cron, 3 webhooks och övriga. OpenAPI-dokumenten finns i `docs/openapi/`, och `lib/api/publicRouteRegistry.ts` beskriver 123 kontrakt.

1. **Kontraktstest från OpenAPI:** varje operation anropas med giltiga exempel och egenskapsgenererade indata (schemathesis eller fast-check). Svaret ska följa schemat, felkoder ska vara dokumenterade och inga 500 får uppstå.
2. **Behörighetsmatris per rutt:** ingen nyckel ger 401; fel scope ger 403; nyckel från tenant B ger aldrig A:s data; fel IP eller Origin; utgången kundassertion; personalassertion som används två gånger.
3. **Rate limit:** gränsen ligger i databasen, `rate_limit_per_minute` (standard 120), med kostnad 1, 3 eller 10 per ruttklass.
   - Över gränsen ska ge 429 med `X-RateLimit-*` och `Retry-After`. Cooldown (`rate_limited_until`) ska hålla.
   - Olika klienter ska inte påverka varandra.
   - Gränsen ska hålla under samtidighet: inga race-läckor.
   - Kända luckor att dokumentera eller besluta om: ingen IP- eller edge-gräns, inga gränser för webhooks, och inga gränser för admin-rutter.
4. **Idempotens:** samma idempotensnyckel parallellt och i sekvens ger samma svar och en enda rad (`customer-applications`, `events`, partnerexport).
5. **Webhooks in** (Resend, billing, manual-inbound): fel signatur, utanför tidsfönstret på 300 s, omspelning, dubbletter, fel ordning, samt 409/503 med `Retry-After`.
6. **Webhooks ut:** mottagaren svarar 500 eller hänger, och backoff 0/300/1800/7200/21600 s ska följas fram till dead-letter. Privata IP-adresser ska blockeras (DNS-pinning).
7. **Trafikomspelning:** fördelning och takt per rutt från `integration_api_requests` (public-contracts 66 %, context 26 %) skalas upp till S, M och L i k6 mot staging, med skrivande anrop på syntetiska tenanter. SLO enligt `quality/performance-budgets.json`.

## 9. Dyra och onödiga anrop

**Metod per scenario**
- `pg_stat_statements` nollställs före och läses efter: anrop, total och medeltid per sats.
- `auto_explain` med nästlade satser (är redan förladdat) visar kostnad inne i SQL-funktioner.
- Appsidan: antal Supabase-förfrågningar per affärshändelse, mätt med en räknande `fetch`-wrapper i testläge.
- Varje mätning ger mätetalen "anrop per händelse" och "rader rörda per händelse". De jämförs mellan N och 10N i historik.

**Redan uppmätt eller bekräftat i kod**

| # | Var | Problem | Mätt eller bevis | Förslag |
|---|---|---|---|---|
| D1 | Mätvärdesinläsning, per värde (`ingestBoundUtiltsMetering` → `normalizeAndStoreMeteringValue` + `updateMeterValueBillingReadiness`) | 8–10 sekventiella databasrundor per värde. Leveransperiod och avtal läses om för varje värde, trots att de är samma för hela filen. | ~4 värden/s i live. Dygnsfil (96 värden) tar ~25 s. **Månadsfil (2 976) tar ~12 min, över ~300 s.** | Läs leveransperiod och avtal en gång per fil och mätpunkt; skriv värden i batch-RPC. Mät före och efter. |
| D2 | `gridex_read_outbound_acks_for_source_v2` | Samma kontroller körs 2 gånger per anrop: `require_contrl_v1`-räkningen, `require_business_binding_v1`, tre guidekontroller och `read_business_original_v1` (dessutom med/utan id). | ~0,4 s fast kostnad per läsning efter F19 | Räkna en gång per transaktion. Kräver ägaren av ACK-auktoriteten. |
| D3 | `wire_namespace.reserve` | sha256 av alla utgående meddelanden vid varje utgående skrivning (P1) | ~9 µs × alla utgående | genererad hashkolumn (beslut) |
| D4 | `public-contracts` | 66 % av trafiken, p50 ~0,9 s och p95 1,5–2 s för data som bara ändras vid publicering | driftloggen | profilera auth, katalog och serialisering; cache med ETag finns (304-profilen) |
| D5 | Inkorgspollern | tak på 25 mejl per brevlåda och körning (`EDIEL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX`), alltså ~7 200 per dygn | **H2:** storlek M (~65k/dygn) skulle bygga en ständigt växande kö om nätägare skickar en fil per mätpunkt | kapacitetstest K1; därefter batchstorlek, parallella brevlådor eller kontinuerlig dränering |
| D6 | Lagring | ~67 kB per E66 (rå payload + bilaga + mejl) | storlek L: ~25 GB per dygn | retention och deduplicering av rådata; mät i K1 |

Varje D-rad blir ett mätbart test med baslinje och mål, och rättas enligt samma regel som F-fynden: först verifiera, sedan test, sedan rättning.

## 10. Scenariokatalog

| Område | Scenarier |
|---|---|
| Kundresa (kedja A) | ansökan via API → kontroll → avtal → online-signering → Z03 → Z04 eller Z02 → leveransstart; flera anläggningar i samma ansökan och i följdansökningar; ånger; konkurrerande byte; flytt in och ut; uppsägning Z08 |
| Mätvärden (kedja B) | dagliga E66 för alla mätpunkter; rättelser; luckor och skattade värden; produktion och netto; månadsfil; mätpunkt utan leverans (F17); 30 dagars flöde för 1 000 mätpunkter |
| Fakturering | månadskörning för S och M; spotpris per kvart och timme; blandade prismodeller per kund; flera anläggningar på en faktura; rättelse efter fakturering (kreditering); export till partner med fel och omförsök (`invoice-export-retry`) |
| Ediel-drift | paus och live (F20); certifikat på väg att löpa ut; rutt saknas och rättas; TGT och AGT separerade från produktion |
| E-post och webhooks | 500 utskick med Resend nere en stund; studs och klagomål via webhook; partnerwebhook nere i 6 h |
| Multi-tenant | 5–20 tenanter parallellt; isolering av data, låsning (L1) och rate limit per klient |
| Cron-schemat | alla 21 cron-jobb körs enligt `vercel.json` under 24 simulerade timmar (accelererat: varje tick körs i ordning) med samtidig trafik. Inga överlappande låsfel och inga fastnade köer. |
| Kapacitet (K) | K1 inkorgens genomströmning (H2); K2 inläsning per månadsfil (D1); K3 månadsfakturering för M inom en körning; K4 anslutningspoolen (60) under last; K5 lagringstillväxt |

## 11. Genomförande i små PR:ar

| Fas | Innehåll | Klart när |
|---|---|---|
| 0 (snabbt, störst värde) | stoppdetektorn (SQL + vitest-hjälpare); mätning av H1 (SMTP och Resend hänger), H2/K1 (inkorgens tak) och D1 (anrop per mätvärde) | tre mätrapporter med siffror, och fynd i F-registret |
| 1 | generatorn för den virtuella marknaden, storlek S med åldrad historik och märkning/städning | S kan skapas och raderas på under 10 min lokalt |
| 2 | motpartssimulatorn över GreenMail med scenariokonfiguration | kedja B och A körs mot simulatorn utan manuella steg |
| 3 | felinjektion: Toxiproxy, mockleverantörer och avbrott mitt i körning | alla rader i avsnitt 7 är testade |
| 4 | API: OpenAPI-kontrakt, behörighetsmatris, rate limit, idempotens och webhooks | alla 123 registrerade kontrakt täckta |
| 5 | staging: storlek M, trafikomspelning i k6 med skrivande anrop, 24 h-cron-simulering | SLO-budgetarna hålls; stoppdetektorn tom |
| 6 | R4: TGT- och AGT-körningar med riktiga motparter, enligt runbooken (`docs/ediel-elbolag-live-runbook.md`) | ägarens grindar är godkända |

Varje fas följer projektets regler: exakt filclaim på #766, ett fel per test som blir rött utan rättningen, samt GEN-capture för schemaändringar.

## 12. Beslut som behövs från ägaren

1. Om `blocked_tenant_state` och beredskapsblockerade utskick ska släppas automatiskt vid återaktivering, och med vilken åldersgräns (B1).
2. Låsning per bolag i stället för globala tabellås i ACK-auktoriteten (L1).
3. Genererad hashkolumn för `wire_namespace` (P1, D3).
4. Om staging får användas för storlek M (kostnad, datamängd) och om k6 ska köras från en separat värd (lastplanen säger det).
5. Hur ofta nätägare i praktiken skickar en fil per mätpunkt eller paketerar flera. Det avgör om H2 är akut. Svaret får vi från TGT och AGT.
