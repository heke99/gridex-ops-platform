# Nätägarmejl in och ut: komplett felbild och produktionsmässig måldesign

Datum: 2026-09-03
Föregående dokument: `INBOUND_GRID_OWNER_MAIL_AUDIT_2026-09-03.md` (defektregister)
Detta dokument: konsoliderad felbild inklusive sync-/deployverifiering, plus hur
kedjan ska byggas för att vara produktionsduglig.

**Ingen produktionskod eller databas har ändrats.**

---

## 0. Sammanfattning

Nätägarkommunikationen skickar korrekt. Den läser inte tillbaka.

Fullmakt går ut, når nätägaren, och nätägaren svarar. Svaret hämtas via IMAP,
lagras, och korreleras till **rätt ärende och rätt tenant**. Sedan avbryts
bearbetningen på en databastabell som inte finns, felet loggas som
`[object Object]`, meddelandet markeras läst, och ärendet står kvar i
`waiting_manual_response`. Det har pågått sedan 2026-07-07 — 495 loggade
felhändelser över två månader, utan ett enda läsbart felmeddelande.

Tre fynd i denna omgång höjer allvarsgraden jämfört med föregående dokument:

1. **Vercel-produktion är kopplad till Supabase-projektet `gridex-ops-dev`.**
   Det som kallats "dev-data" är produktionsdata. De två nätägarsvaren från
   E.ON och Landskrona Energi är riktiga kundärenden.
2. **Schemat divergerar i tre riktningar samtidigt** — repo, genererade typer
   och faktisk databas är tre olika sanningar. Mätt: 1 tabell finns i typerna
   men inte i databasen (`inbound_operation_events` — exakt den runtime kraschar
   på), 43 tabeller finns i databasen men inte i typerna.
3. **93 av 569 migrationsfiler följer inte namnkonventionen** och är därmed
   osynliga både för Supabase CLI och för projektets egen typkontroll-grind.
   Det är den mekaniska rotorsaken till punkt 2.

Deployen i sig är frisk: senaste produktionsdeploy `dpl_GDhTAH9TN9X4WFkDbhxBFYa9BHuE`
= commit `20beb13` = `origin/main` HEAD, status READY, alla cron-jobb kör var
femte minut. Problemet är inte att koden inte är utrullad. Problemet är att
databasen den rullas ut mot inte är den databas repot beskriver.

---

## 1. Verifierad synk- och deploystatus

### 1.1 Kod → deploy: **i synk**

| Kontroll | Utfall |
|---|---|
| `origin/main` HEAD | `20beb13` |
| Senaste produktionsdeploy | `dpl_GDhTAH9TN9X4WFkDbhxBFYa9BHuE`, READY |
| Deployens commit | `20beb13d75e655fca23a26c92cb30a09fdb008d6` |
| Cron-frekvens (uppmätt 90 min) | 18 körningar per 5-minuterscron — korrekt |
| `/api/webhooks/resend` trafik | Ja, aktiv |

### 1.2 Runtime → databas: **produktion pekar på "dev"-projektet**

Ett 522-fel från produktionsdeployen namnger origin-värden explicit:
`piidsfebjqjmnepdpnas.supabase.co` — vilket är Supabase-projektet
**`gridex-ops-dev`**.

Konsekvenser som måste accepteras eller åtgärdas:

- Det finns ingen separat produktionsdatabas. `open-blockers.md` punkt 1
  ("inget produktionsprojekt synligt") beskriver inte en saknad miljö utan att
  produktionen kör i det projekt som är namngivet som utveckling.
- Varje resonemang av typen "det är bara dev-data" är falskt. De två
  nätägarsvaren, de 8 skickade fullmaktsmejlen och de 2 väntande ärendena är
  produktion.
- Det finns ingen miljö att testa migrationer i före produktion.

### 1.3 Repo → databas → typer: **tre-vägs divergens, mätt**

| Riktning | Antal | Innebörd |
|---|---|---|
| Finns i genererade typer, saknas i databasen | **1** | `inbound_operation_events` |
| Finns i databasen, saknas i genererade typer | **43** | bl.a. `sites`, `access_logs`, `onboarding_sessions`, `white_label_platforms`, `tenant_governance_events`, `masterdata_audit_log` |
| Tabeller i databasen | 501 | |
| Tabeller i `supabase/database.types.ts` | 459 | |

Typfilen är alltså varken databasen eller repot. Den är genererad från en
tredje, replay-baserad databas (jfr commit `b06f828` "Sync clean replay Supabase
types"). Två av de 43 saknade tabellerna — `white_label_platforms` och
`tenant_governance_events` — har committade skapande migrationer i repot, vilket
betyder att inte ens replayen kör alla migrationer i repot.

Nettoeffekten: `npm run typecheck` godkänner kod som skriver till en tabell som
inte finns, och skulle underkänna kod som läser 43 tabeller som faktiskt finns.
Typsystemet kan aldrig fånga defekter av F-1:s klass.

### 1.4 Mekanisk rotorsak

`supabase/migrations` innehåller 569 filer. **93 av dem följer inte formatet
`<14 siffror>_namn.sql`**, däribland nio som börjar med `01_`, `02_`, `03_` och
därmed sorterar före allt annat.

`scripts/check-supabase-generated-types.cjs` filtrerar med
`/^\d{14}_.+\.sql$/` och ser alltså aldrig de 93. Den kontrollerar dessutom bara
tre saker: att typfilens SHA256 matchar ett manifest, att den senaste
migrationens filnamn matchar manifestet, och att filen exporterar `Database`.
**Ingen kontroll jämför typerna eller migrationerna mot en verklig databas.**

Ledgern och repot har dessutom olika versionsnummer för samma migration:

| Repo-fil | Ledgerpost |
|---|---|
| `20260902093000_explicit_tenant_scope_and_inbound_quarantine.sql` | `20260902084311` (samma namn) |
| `20260902096000_attribute_quarantined_inbound_by_receiver_ediel_id.sql` | `20260902092313` (samma namn) |
| `20260824190000_gridex_inbound_operations_foundation.sql` | **saknas** |

Commit `49a9795` dokumenterar redan att detta hänt förut. Det är alltså ett
återkommande, känt problem utan en grind som stoppar det.

---

## 2. Komplett felregister

30 fynd. Klassificering: **BEKRÄFTAD** = verifierad mot kod, levande databas
eller produktionslogg. **TROLIG** = härledd ur kod och biblioteksbeteende, ej
reproducerad.

### A. Schema, deploy och synk

| # | Allvar | Fynd | Bevis |
|---|---|---|---|
| **F-1** | Kritisk | `inbound_operation_events` finns inte i databasen; `upsertInboundOperationEvent` kastar utan schematolerans och avbryter varje inkommande nätägarsvar efter korrelation | `information_schema` 0 rader; migration `20260824190000` saknas i ledgern; `manualInboundIngestion.ts:187-208` |
| **F-24** | Kritisk | Produktionsruntime kör mot Supabase-projektet `gridex-ops-dev`; ingen separat produktionsdatabas finns | 522-fel från produktionsdeploy namnger `piidsfebjqjmnepdpnas.supabase.co` |
| **F-25** | Hög | Tre-vägs schemadivergens: 1 tabell i typerna saknas i DB, 43 tabeller i DB saknas i typerna | Mätt diff, avsnitt 1.3 |
| **F-26** | Hög | 93 av 569 migrationsfiler följer inte namnkonventionen och är osynliga för CLI och grind | `ls supabase/migrations` |
| **F-27** | Hög | Typkontroll-grinden verifierar hash och filnamn, aldrig mot en databas | `scripts/check-supabase-generated-types.cjs:17-30` |
| **F-21** | Hög | Repots migrationsversioner ≠ ledgerns versioner för samma migrationer | Tabellen i 1.4 |
| **F-8** | Hög | Live unikhetsindex är company-scopat; det index koden förutsätter finns bara i den oapplicerade migrationen | `pg_indexes`; `20260712100000:779`; `20260824190000:30` |

### B. Transport — det som hämtas och bevaras

| # | Allvar | Fynd | Bevis |
|---|---|---|---|
| **F-23** | Kritisk | Fel serialiseras som `[object Object]`; PostgREST-fel är inte `Error`-instanser, så två månaders felmeddelanden är förlorade | Produktionslogg: 495 händelser, `'ingest <id>: [object Object]'`; `manualMailboxPoller.ts:257` |
| **F-2** | Hög | Teckenkodning förstörs: quoted-printable avkodas byte-för-byte till latin1, `charset` läses aldrig, base64 antas alltid vara UTF-8 | `manualMailboxPoller.ts:52-62`; samma defekt i `edielMailboxPoller.part-1.ts:692,698-706`; lagrat: `"Tack fÃ¶r ditt mejl"` |
| **F-3** | Hög | Binära bilagor kastas; råmejlet sparas aldrig | `manualMailboxPoller.ts:110-113`; Landskrona-svaret: `body_len=0`, 1 bilaga, 95 tecken text |
| **F-4** | Hög | Endast olästa mejl hämtas; ingen `since`-fallback som Ediel-pollern har | `manualMailboxPoller.ts:226` vs `edielMailboxPoller.part-2.ts:408-425` |
| **F-29** | Medel | `read ETIMEDOUT` mot IMAP fäller hela brevlådepollen utan återförsök | Produktionslogg 2026-09-01T09:39:06 |
| **F-28** | Medel | 300 s funktionstimeout drabbar bl.a. manual-inbound-cron | Produktionslogg: 375 timeouthändelser över 12 routes |
| **F-11** | Medel (TROLIG) | `messageFlagsAdd` anropas inuti en pågående `fetch`-iteration i båda pollarna | `manualMailboxPoller.ts:253`; `edielMailboxPoller.part-2.ts:396` |
| **F-9** | Medel | Två aktiva produktionsbrevlådor med identisk adress pollar samma INBOX; låset är per rad | `manual_communication_mailboxes` |
| **F-19** | Låg | Testbrevlådan pekar på `imap.strato.de` (produktion: `.com`) och är overifierad → pollas aldrig | Samma tabell; `manualMailboxPoller.ts:130-140` |

### C. Tolkning — det som förstås

| # | Allvar | Fynd | Bevis |
|---|---|---|---|
| **F-5** | Hög | Intent tas från vår egen ärendetyp med säkerhet 1.0; innehållet klassificeras aldrig när ett ärende matchat | `manualInboundCorrelation.ts:106-108`; E.ON:s "fel kanal"-svar lagrat som `facility_information_response` |
| **F-13** | Medel | Extraktionen kräver "etikett: värde" på samma rad; ingen fallback för fritt 18-siffrigt ID, ingen tabellparsning | `manualFacilityResponseParser.ts:54-95` |
| **F-15** | Medel | Endast facility-intents har adapter; supplier switch, fullmakt och AI-lista fastnar i `needs_review` utan task | `manualInboundIngestion.ts:41-48,357-363` |
| **F-14** | Medel | Utgående mall ber inte om maskinläsbart svarsformat | `manualGridOwnerTemplates.ts:40-71` |

### D. Process — det som händer efteråt

| # | Allvar | Fynd | Bevis |
|---|---|---|---|
| **F-6** | Hög | `ignored` är en tyst papperskorg: ingen task, ingen notis, syns bara för plattformsadmin | `manualInboundCorrelation.ts:345-361,528`; `app/admin/manual-requests/page.tsx:85` |
| **F-7** | Hög | Ingen SLA-bevakning av `waiting_manual_response`; mallarna `reminder`/`escalation` anropas aldrig | `inboundOverdueMonitor.ts:88-180`; `renderManualEmailTemplate` har exakt en anropare |
| **F-30** | Hög | Konkret utfall av F-7: äldsta väntande ärendet är **10 dagar** gammalt utan en enda påminnelse | `min(sent_at)` på `waiting_manual_response` |
| **F-10** | Medel | Ingen jobbkö; allt sker inline i fetch-loopen, och `unmatched` omvärderas aldrig trots kodkommentaren | `manualInboundIngestion.ts:262-264` |
| **F-12** | Medel | Rader skrivs utan tenant och blir permanent osynliga om korrelationen kastar | `manualInboundIngestion.ts:151-153,297`; 20 rader i `platform_inbound_quarantine` |
| **F-22** | Hög | Noll testtäckning för poller, MIME-parsning och ingest | `parseMimeSource` refereras bara i sin egen fil |

### E. Övrigt

| # | Allvar | Fynd |
|---|---|---|
| **F-20** | Låg/Medel | Ingen brevlåda är tenantbunden; bevissteget `tenant_mailbox` (styrka 90) kan aldrig ge utslag |
| **F-17** | Låg | Webhooken returnerar interna UUID:n till e-postleverantören (`route.ts:153`) |
| **F-18** | Låg | Idempotensuppslagningen mot `manual_email_outbox` saknar `company_id`-filter (`requestMissingFacilityInformationCore.ts:1075`) |

### F-16 — korrigerad

Föregående dokument flaggade att RFC-Message-ID-bryggan kunde vara död utan
Resend-webhook. **Den fungerar.** Verifierat: 35 `communication_log_events` med
`provider='resend'`, samtliga med `event_payload.data.message_id`, och de två
senaste utskicken (2026-08-24, 2026-08-25) har en fungerande koppling
outbox → RFC-Message-ID. De sex utskicken från juli saknar brygga eftersom
webhooken togs i drift omkring 22 augusti.

Kvarstår som notering: bryggan bygger på `email.delivered`, inte `email.sent`
(inga `email.sent`-events finns lagrade). Fungerar, men bör täckas av readiness
snarare än antas.

### Angränsande produktionsfel utanför mejlvägen

Hittade i samma logg, redovisas eftersom de påverkar samma cron-plan:

- `canonical_energy_flow_events_scope_check` — 528 händelser: spotprisimportens
  auditevents skrivs med scope `tenant` men `company_id NULL`.
- `customer_operation_tasks_status_check` — 25 händelser: `customer-operations-cron`
  försöker skriva status `completed` som constraintet inte tillåter.
- `PGRST201` tvetydiga embeds — admin-sidor och tre cron-jobb kraschar på
  dubbla relationer mellan `website_customer_applications`/`metering_points` och
  `customers`/`customer_sites`. Följdeffekt av de kompositnycklar som lades till
  2026-09-02.

---

## 3. Så ska det byggas

### 3.1 Princip: transport, tolkning och process ska vara tre lager

Dagens kod gör allt i ett svep inuti IMAP-loopen. Ett fel var som helst i kedjan
förlorar meddelandet. Måldesignen skiljer strikt på tre ansvar:

```
   IMAP / webhook                jobbkö                  affärsadapters
        │                          │                            │
        ▼                          ▼                            ▼
  1. HÄMTA + BEVARA  ──────▶  2. TOLKA  ──────────▶  3. AGERA
     råmejl, bilagor,          charset, korrelation,    uppdatera ärende,
     aldrig kasta något        intent, extraktion       skapa task, svara
```

**Lager 1 får aldrig misslyckas på grund av lager 2 eller 3.** Ett mejl som
hämtats ska vara bevarat och återspelbart även om all tolkning går fel. Det är
den enda regeln som hade förhindrat både F-1 och F-3.

### 3.2 Lager 1 — hämta och bevara

- **Råmejlet sparas alltid.** Ny kolumn `raw_email` eller Storage-referens på
  `manual_inbound_messages`, som Ediel-sidan redan har.
- **Alla bilagor till Storage**, `inbound-mail/<company|quarantine>/<inbound_id>/`,
  med `sha256`, `size_bytes`, `content_type`. Ingen bilaga kastas.
- **UID-baserad hämtning** i stället för `\Seen` som processtillstånd: spåra
  `uid_validity` och `last_seen_uid` per brevlåda och hämta `UID > last_seen_uid`.
  Behåll tvåpassmönstret (`unseen` + `since`) som övergång, med UID-dedupe.
- **Flaggning efter iterationen**, aldrig inuti `fetch` (F-11).
- **En brevlåderad per faktisk inkorg**, med
  `unique (environment, lower(imap_username), coalesce(imap_folder,'INBOX')) where is_active`.
  `mailbox_type` styr val av avsändare, inte hämtning (F-9).
- **Lås på `(host, username, folder)`**, inte på radens `id`.
- **Timeout och retry** runt IMAP: anslutningstimeout, läsningstimeout, och
  `maxDuration` satt lägre än Vercels 300 s så jobbet avslutar kontrollerat
  (F-28, F-29).

Efter lager 1 finns ett persisterat meddelande och ett jobb i kön. Inget annat.

### 3.3 Lager 2 — tolka

- **Gemensam MIME-avkodare** i `lib/inbound-mail/mime.ts`, använd av båda
  pollarna: bytes → `Buffer`, läs `charset` från delens `Content-Type`, avkoda
  med `TextDecoder` (`utf-8`, `iso-8859-1`, `windows-1252`), hantera MIME
  encoded-words i headers. Överväg `mailparser` i stället för egen parser.
- **Autosvarsdetektion före allt annat**: `Auto-Submitted`, `X-Autoreply`,
  `Precedence: bulk`, `List-Id`. Ett autosvar får aldrig räknas som svar.
- **Intent klassificeras alltid på innehållet.** Ärendetypen är en prior som
  höjer eller sänker säkerheten, aldrig ett facit. Nya intents: `wrong_channel`,
  `auto_reply`, `information_missing`, `request_rejected`.
- **Extraktion med fallback**: etikett+värde, värde på nästa rad,
  HTML-tabellceller, och fritt 18-siffrigt ID med GS1-checksiffra när exakt en
  unik kandidat finns. PDF-textextraktion och XLSX/CSV-parsning.
- **Korrelationsstegen behålls oförändrad.** Den fungerar bevisligen och är den
  starkaste delen av dagens design.

### 3.4 Lager 3 — agera

- **Adapterregister per intent.** "Ingen adapter finns" är ett hanterat utfall
  som alltid skapar en task — aldrig tystnad.
- **Varje utfall syns för tenanten.** `matched`, `ambiguous`, `unmatched`,
  `ignored` och `needs_review` skapar alla en `customer_operation_task` i rätt
  tenant och visas i tenantens arbetskö, inte bara på plattformsadmins
  diagnostiksida.
- **`ignored` delas i två**: "obetrodd avsändare" (granska; ett klick godkänner
  och lägger samtidigt till adressen som verifierad kontakt) och "skräp".
- **SLA-cron** över `waiting_manual_response`: task + `reminder` efter N dagar,
  `escalation` efter M, idempotent per `(request_id, steg)`. Gränsvärden per
  nätägare.
- **Strukturerat svarsblock** i utgående mall, versionerat, med mätning av
  svars- och parsningsgrad per mallversion.

### 3.5 Observerbarhet — icke förhandlingsbart

F-23 är det enskilt viktigaste att bygga rätt: felet fanns i loggen 495 gånger
utan att gå att diagnosticera.

- **En felnormaliserare** som hanterar `Error`, PostgREST-fel (`code`,
  `message`, `details`, `hint`) och okända objekt, använd överallt där fel
  loggas eller sparas.
- **Strukturerad logg** med `inbound_id`, `mailbox_id`, `company_id`,
  `resolution_status`, `processing_state`, felkod. Aldrig `String(error)` på ett
  okänt objekt.
- **Larm på tillstånd, inte bara på undantag**: antal `quarantined`, antal
  `unmatched` senaste dygnet, antal ärenden äldre än SLA, ålder på senaste
  lyckade polling per brevlåda.
- **Readiness som täcker det runtime faktiskt behöver.** `inbound_operation_events`
  och Resend-webhookens närvaro in i `platform_runtime_readiness`, så en saknad
  förutsättning blir en synlig 503 i stället för tyst dataförlust.

### 3.6 Schema och deploy — så här slutar divergensen

Detta är den del som måste göras först, annars är allt annat byggt på sand.

1. **Namnkonvention framtvingad.** Alla migrationer `<14 siffror>_namn.sql`.
   De 93 avvikande filerna arkiveras till `supabase/migrations/_legacy/` och
   ersätts av en baslinjemigration som beskriver det tillstånd de faktiskt
   producerade. Ingen historik skrivs om — baslinjen är framåtriktad.
2. **Ledgergrind i CI.** Jämför filversioner mot
   `supabase_migrations.schema_migrations` och underkänn både "fil utan
   ledgerpost" och "ledgerpost utan fil". Kör på varje PR.
3. **Driftgrind i CI.** Jämför faktisk databas mot en replay av repot: tabeller,
   kolumner, index, constraints, RLS-policys. Dagens tre-vägs divergens hade
   fångats vid första körningen. Utöka
   `scripts/check-supabase-generated-types.cjs` — eller ersätt den — så den
   verifierar mot ett riktigt schema, inte mot en hash.
4. **Typer genereras från den databas runtime använder**, inte från en
   replay-databas. `db:types:gen` använder redan `--linked`; det som saknas är
   att det som är länkat ska vara samma databas som produktionen kör mot.
5. **En separat produktionsdatabas.** Så länge produktion kör mot
   `gridex-ops-dev` finns ingen miljö att verifiera en migration i innan den
   träffar kunddata. Antingen skapas ett produktionsprojekt och `gridex-ops-dev`
   blir verkligt dev, eller så döps projektet om och en ny dev-miljö skapas.
   Namngivningen får inte fortsätta dölja vad som är vad.
6. **`inbound_operation_events` skapas via en ny, framåtriktad migration** med
   nytt versionsnummer, så ledgern blir sann. Skrivningen görs samtidigt
   schematolerant — ett orkestreringsindex får aldrig blockera en affärsprocess.

---

## 4. Leveransplan

Ordningen är styrd av två regler: det som pågår och förstör data stoppas först,
och inget bygger på ett schema som inte är sant.

| PR | Innehåll | Fynd | Klart när |
|---|---|---|---|
| **1** | Felnormaliserare + strukturerad logg i inbound-vägen | F-23 | Ett framtvingat ingest-fel producerar läsbar felkod och kontext i loggen |
| **2** | Migration för `inbound_operation_events`, schematolerant skrivning, tabellen in i readiness, omkörning av de 2 fastnade svaren | F-1 | De två väntande ärendena har gått till `manual_response_received` eller `needs_review` med motivering |
| **3** | Bevara allt: råmejl + bilagor till Storage, UID-baserad hämtning, flaggning efter iteration, timeouts | F-3, F-4, F-11, F-28, F-29 | Ett mejl med PDF-bilaga är fullständigt återspelbart efter ingest |
| **4** | Gemensam charset-korrekt MIME-avkodare + extraktion med fallback + fixture-tester | F-2, F-13, F-22 | E.ON- och Landskrona-mejlen parsas korrekt i test |
| **5** | Innehållsbaserad intent, autosvarsdetektion, adapterregister, tasks för alla utfall | F-5, F-6, F-15 | Ett "fel kanal"-svar klassas som `wrong_channel` och skapar en task i rätt tenant |
| **6** | SLA-cron med påminnelse och eskalering, strukturerat svarsblock i mallen | F-7, F-14, F-30 | Ett ärende äldre än gränsen får påminnelse och task automatiskt |
| **7** | Schemadisciplin: namnkonvention, ledgergrind, driftgrind, typgenerering mot rätt databas | F-21, F-25, F-26, F-27 | CI underkänner en avsiktligt införd drift |
| **8** | Jobbkö, karantän i stället för otenantade rader, strikt unikhetsindex, brevlådekonfiguration | F-8, F-9, F-10, F-12, F-19 | Ett ingest-fel återupptas automatiskt vid nästa körning |
| **9** | Småfixar: webhooksvar, tenant-scopad outbox-uppslagning, tenantbindningsbeslut | F-17, F-18, F-20 | — |

**Utanför denna plan men bör prioriteras separat:** produktionsdatabasens
identitet (F-24) är ett infrastrukturbeslut, inte en PR. Och de angränsande
produktionsfelen i avsnitt 2 (spotpris-scope, task-status-constraint, PGRST201)
är egna ärenden.

---

## 5. Definition of done

Kedjan är produktionsduglig när samtliga punkter är sanna och verifierade:

1. Ett nätägarsvar som hämtas är bevarat i sin helhet — råmejl och bilagor —
   oavsett om tolkningen lyckas.
2. Ett fel i tolkning eller tillämpning lämnar meddelandet i ett tillstånd som
   automatiskt återupptas, aldrig i ett tyst sluttillstånd.
3. Varje fel som loggas har en läsbar felkod och tillräcklig kontext för att
   diagnosticeras utan databasåtkomst.
4. Varje inkommande meddelande får ett synligt utfall i rätt tenants arbetskö —
   även `ignored`, `ambiguous` och `unmatched`.
5. Inget ärende kan stå i `waiting_manual_response` längre än SLA utan att en
   påminnelse skickats och en task skapats.
6. Svensk text från alla vanliga teckenkodningar parsas korrekt, verifierat med
   fixture-tester byggda på verkliga nätägarsvar.
7. CI underkänner en PR som inför drift mellan repo, databas och typer.
8. Readiness rapporterar 503 om en tabell eller integration runtime behöver
   saknas — i stället för att felet uppstår i en cron ingen läser.
9. Produktion och utveckling kör mot skilda databaser, med namn som säger vilket
   som är vilket.

---

## 6. Öppna beslut

Dessa kan inte avgöras från kod och behöver ditt svar innan PR 5–7:

1. **Produktionsdatabasen (F-24).** Skapa ett nytt produktionsprojekt och migrera
   dit, eller döpa om `gridex-ops-dev` till produktion och skapa en ny dev-miljö?
   Det första ger en ren separation men kräver datamigrering; det andra är
   snabbare men lämnar produktionen utan testmiljö tills den nya är byggd.
2. **De 43 tabellerna utan committade migrationer.** Baslinjas de in i repot som
   de ser ut, eller ska några av dem avvecklas först? Flera ser ut som legacy
   (`gridex_wrong_project_cleanup_backup`, `sites`, `onboarding_*`).
3. **Brevlådemodellen (F-20).** Plattformsgemensam brevlåda, eller tenant-egna
   med egna IMAP-uppgifter vid vitmärkning?
4. **SLA-gränser (F-7).** Vilka dagar för påminnelse respektive eskalering, och
   ska de sättas per nätägare?
5. **"Fel kanal"-svar (F-5).** Ska systemet föreslå uppdatering av
   `grid_owner_contact_channels` automatiskt, eller alltid kräva mänskligt
   godkännande?
6. **Obetrodd avsändare (F-6).** Får ett svar med giltigt anläggnings-ID från en
   okänd adress hos rätt nätägare tillämpas efter mänskligt godkännande, eller
   aldrig?
