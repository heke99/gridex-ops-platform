# Spår 3 (Ediel) – simuleringsharness

Kampanj 20261029-3f1a8ab1. Separat, lokal harness för Ediel-kedjan: inkommande mejl (IMAP) -> app -> CONTRL/APERAK i
outbox -> utgående mejl (SMTP) -> "nätägar"-motpart. Ingen extern trafik, inga riktiga mejl, ingen extern DB.
Ursprungsbasen `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56` bevaras som historik. Nya körningar kräver
samordnarens uttryckliga aktuella app-/harnesskällor, bygge och backend; en historisk basmarkör är inget körbevis.

## Kontrakt

| Skript | Uppgift |
| --- | --- |
| `up.sh [--mode test\|production]` | Konsumerar samordnarens kvalificerade replay/bygge och privata JSON-miljö. Startar endast nya tilldelade app-/mailresurser, seedar den lokala fixturen och observerar exakta process-/containeridentiteter. Startar inte backend/daemon, installerar inte och bygger inte. Befintligt tillstånd kräver riktad avstämning. |
| `down.sh` | Kräver uttryckliga `SIM_HOME`, `SIM_RUN_DIR` och en privat `T3_CLEANUP_ASSIGNMENT_FILE`. Stoppar endast exakt tilldelade processer och GreenMail-container. Skriver ett nytt privat kvitto under `SIM_HOME/cleanup-receipts/`. `--stack` och `--purge` nekas före cleanup eftersom backend-/retentionstilldelning saknas. |
| `run.sh <scenariofil...>` | Kräver `SIM_REPORT`, en absolut privat fil utanför Git-arbetsytor och Git-metadata. Ogiltigt mål eller en JSON-miljö med otillåtna nycklar nekas före lås, nätanrop och Vitest. En körning åt gången (flock på `SIM_HOME/run.lock`). Per scenario: `SIM_HOME/runs/<run-id>/<scenario>/{report.json,log.txt,vitest.json}`. |

Rapporten (`report.json`) har `exit`, `startedAt`/`endedAt` (UTC), `steps[]` (`passed|failed|skipped`), `skipped[]`,
vitests sammanfattning (`vitest`), `observations` (utfall som scenariot loggar utan att assertera) och sökväg till
evidenskatalogen med `MANIFEST.sha256`.

`SIM_REPORT` innehåller `{runId, exit, scenarios}` med de faktiska scenariorapporterna, inklusive `scenarioId` per
EDIEL-steg. Varje rapport måste matcha körningens ID, scenario och verkliga exitkod. Första icke-noll-exitkoden från
Vitest bevaras; saknad scenariofil eller misslyckad rapportering ger också icke-noll. Rapportfilen får 0600 även
om den redan finns; befintliga symlänkar eller kataloger godtas inte som rapportmål.
Förkontrollen använder Python 3 och Git för att kontrollera den upplösta målsökvägen.

## Körning

Med samordnarens tilldelning och samtliga explicita variabler redan exporterade:

```sh
bash scripts/simulation/track3/up.sh
SIM_REPORT=/privat/evidens/track3-report.json bash scripts/simulation/track3/run.sh scenarios/smoke.test.ts
T3_CLEANUP_ASSIGNMENT_FILE="$SIM_HOME/cleanup-assignment.json" bash scripts/simulation/track3/down.sh
```

### Avgränsad cleanup

Samordnaren måste först tilldela de verkligt ägda resurserna. En arbetskatalog eller en containeretikett ger ingen
backend- eller processäganderätt. `up.sh` härleder detta cleanup-kvitto först efter kvalificerad start och verkliga process-/containerobservationer.
Ett avbrutet startförsök med enbart pending-ID:n kräver samordnarens riktade återhämtning. Skapa inte en cleanup-tilldelning genom att automatiskt hitta resurser med gemensamma namn.

`T3_CLEANUP_ASSIGNMENT_FILE` är en vanlig fil med 0600, ägd av körande användare, utanför Git. `SIM_HOME` är en
befintlig privat katalog med 0700 utanför Git; samtliga tre sökvägar anges absolut och utan symlänkar. JSON-formatet är:

```json
{
  "schema": "track3-cleanup-assignment-v1",
  "worker": "codex-track3",
  "environmentId": "unik-tilldelad-miljo",
  "simHome": "/privat/track3",
  "runDir": "/egen/app",
  "processes": [],
  "greenmail": null
}
```

Varje tilldelad process har `pid`, `startTimeTicks` (sträng från `/proc/<pid>/stat`), absolut `exe` och `cwd`,
`cmdlineSha256` (SHA256 av de råa NUL-separerade `/proc/<pid>/cmdline`-byten) samt `pidFile` (`app.pid` eller
`counterparty.pid` under `SIM_HOME/pids`). Högst dessa två processer kan bindas. En befintlig pidfil utan matchande
tilldelning blockerar hela cleanupen. Alla mål kontrolleras före första signalen. Linux pidfd krävs för att signalen
ska förbli bunden till rätt process när numeriska PID återanvänds; processgrupper och fristående barnprocesser signaleras inte.

En tilldelad `greenmail` har ett fullständigt 64-teckens container-`id` och exakt dessa `labels`: `sim.track=track3`,
`sim.campaign=20261029-3f1a8ab1`, `sim.worker=codex-track3` och `sim.environment=<environmentId>`. Den verkliga
containerns ID och etiketter kontrolleras före borttagning. Ingen namnbaserad eller gemensam etikettbaserad radering
görs. `up.sh` använder samma tilldelade namn och etiketter och vägrar ersätta en befintlig container. Volymer, Supabase-stack,
mailoriginal, körningar och evidens gallras aldrig av denna cleanup.

Cleanupen tar samma `run.lock` som `run.sh` och kontrollerar att tilldelningen inte ändrats före varje mutation.
`clean: true` i kvittot avser enbart angivna processer och GreenMail-ID; det är inget påstående om hela miljön,
andra processer, portar, volymer eller genomförda scenarier. Ett daemonfel räknas aldrig som bekräftad containerfrånvaro.

## Aktuell startup- och körkvalificering

Följande krävs uttryckligen: `SIM_HOME`, `SIM_RUN_DIR`, `T3_APP_COMMIT`, `T3_DB_URL`,
`T3_RUNTIME_ASSIGNMENT_FILE` och `T3_BACKEND_ASSIGNMENT_FILE`. Inga gamla standardkataloger, portar,
PID-filer, `.env`-skript, friskkontroller eller textmarkörer kan skapa ett replay-/byggbevis.

Samordnaren förbereder först en exklusivt ägd lokal miljö och ett genuint replay/bygge. Privata kataloger har
0700 och JSON-/CA-/nyckelfiler 0600, rätt ägare och kanoniska absoluta sökvägar utan symlänkar. Privata indata
ligger utanför Git-arbetsytor och Git-metadata. Appens `.env*`-filer godtas inte som okända överlagringar.
`env/track3.json` läses som JSON med en uttrycklig nyckellista; dess värden körs aldrig som shellkod.
App, fixture och Vitest får en rensad miljö med bara de tilldelade värdena.

Valfria scenarioinställningar anges också i denna JSON: `T3_E01_N` är en kanonisk heltalssträng 1–28
(standard 28), `T3_E01_OWN_ID`, `T3_E02_OWN_ID` och `T3_E03_OWN_ID` är exakt fem ASCII-siffror som strängar,
och `T3_APP_AUTOMATION_ACTOR_USER_ID` är en UUID-sträng för appens automationsaktör. Omgivningens motsvarande
variabler förs inte vidare utan uttryckliga JSON-värden. Den sista inställningen bevarar appaktören när E02
byter aktör i scenarioprocessen. Köridentiteten redovisar dessa överlagringar och faktisk E01-kohortstorlek;
N under 28 markeras `diagnostic_reduced_cohort` och uppfyller inte hela EDIEL01-oraklet. N=28 är endast
kohortens storlek, inget automatiskt PASS. `NODE_TLS_REJECT_UNAUTHORIZED` godtas aldrig som överlagring.

Startprocessen håller `run.lock` tills den avslutas. App- och mailprocesserna stänger sitt ärvda lås så att
senare `run.sh`/`down.sh` kan ta det. Foreground-scenarioprocessen behåller låset under körning, även om dess
wrapper avbryts, så att cleanup inte överlappar ett ännu aktivt test.

Runtime-tilldelningen har `schema: track3-runtime-assignment-v1`, `workerId: codex-track3`, explicit `model`,
`environmentId` med prefix `t3-` och längd 8–80 tecken, framtida UTC-`expiresAtUtc`, `exclusiveHost: true`, `backendReservation`,
`allowedActions`, `appDir`, full `appCommit`, `simHome`, `harnessCommit`, `harnessTree` och `overlayRefs`.
Den anger sju olika portar i `ports` (`app`, `api`, `db`, `smtp`, `imapTls`, `imapPlain`, `control`), ett eget
`projectId` som skiljer sig från `gridex-ops-platform`, fulla `apiContainerId` och `storageContainerId`,
`greenmailName: <environmentId>-greenmail` och en förladdad `greenmailImage` med full SHA256-digest.
`backendAssignmentSha256` och `preparedReceiptSha256` binder exakta privata underlag.

Backend-tilldelningen har `version: 1`, `workerId: T3`, samma `environmentId`/`projectId`, full `containerId`,
`host: 127.0.0.1`, explicit DB-`port`, `database: postgres` och `systemIdentifier` som sträng.
DB-URL måste vara exakt denna kanoniska loopback-endpoint utan query/fragment. DB/API/Storage-containrarnas
fulla identiteter, projekttillhörighet och loopback-bindningar kontrolleras före fixture-/scenarioeffekter;
DB-identiteten läses med en uttryckligt skrivskyddad fråga. Docker-inspektionen hämtar endast identitetsfält.

Samordnarens `prepared-runtime.json` har `schema: track3-prepared-runtime-v1`, `producerReservation`,
aktuella `appCommit`, `appTree`, `replayCommit`, `nextBuildId`, `sourceSchemaSha256`, `schemaFingerprint`,
`ledgerMigrationsSha256`, `overlayRefs`, `postReplayAppliedMigrations: 0` och `publicBuildEnvSha256`.
Den sista är SHA256 av UTF-8 `JSON.stringify([NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY])`
för de verkliga byggindata. Bygg-ID jämförs med `.next/BUILD_ID`; source/schema, faktisk migrationsledger och
fingerprint jämförs med kvittot. Den befintliga SQL-fingerprinten täcker valda tabeller och redovisas som
**partiell**, inte som en fullständig schema-/runtimeacceptans.

Reservationstexterna och privata filerna förvärvar ingen producent eller backend. Samordnaren verifierar de
verkliga reservationerna och det genuina underlaget innan filerna utfärdas. Ingen faktisk runtime har tilldelats
eller startats genom dessa kontroller. Direktanrop till gamla fixture-/Vitest-hjälpare utanför den kvalificerade
`up.sh`/`run.sh`-kedjan är inte därmed godkända. Verkliga scenarier och deras fulla orakel behöver fortfarande köras.

`up.sh` skriver nya födelsekvitton, verifierar app/mail efter start och skriver `runtime-ready.json` samt den
härledda `cleanup-assignment.json`. Gamla kvitton skrivs inte över; okända resurser hittas eller rensas inte
automatiskt. `run.sh` verifierar tilldelningen igen före varje scenarioprocess, tillåter bara egna scenariofiler,
bevarar faktisk Vitest-exitkod och fogar `run-identity.json` till rapporterna med full app-/harness-/bygg-/schema-/
ledger-/DB-identitet. Den gamla basen är uttryckligen historisk. Ingen källa eller komponentkontroll blir ett
nytt scenario-PASS utan hela scenariobeviset och oberoende granskning.

## Aktuell förberedelse och producentansvar

T3:s utsedda runtimeproducent förbereder backend, canonical replay, bygge och
mailunderlag; T4:s enda GEN-/integrationstjänst sköter delad GEN och mainleverans.
Samordnarchatten fördelar och följer upp. Äldre hänvisningar till att samordnaren
bygger eller provisionerar ersätts av [PREPARATION.md](PREPARATION.md).
`prepare.py` är det explicita kontraktet för check och prepare → scenario → cleanup
på samma kvalificerade värd. Det kräver riktiga granskade producentadaptrar och
privata tilldelningar; inga mallar märks ACTIVE och ingen stack startas av källgranskning.

## Historiskt donorflöde — inte aktuella körinstruktioner

Följande beskrivning bevarar äldre beteende och observationer. Dess standardvärden, gamla `.env`-filer och
replay-/byggmarkörer är inte tillämpliga på den nya kvalificerade startvägen.

Miljövariabler: `SIM_HOME` (default `/home/user/sim-home/track3`), `SIM_RUN_DIR` (default `/root/sim-run/track3`, appens
kod och `node_modules`), `SKIP_BUILD=1`, `FORCE_BUILD=1`, `SKIP_REPLAY=1`, `T3_BUILD_HEAP_MB` (default 6144; `next build`
typkontrollen krävs mer än nodes standardheap), portar: `T3_APP_PORT=3103`, `T3_SMTP_PORT=3125`, `T3_IMAP_TLS_PORT=3993`,
`T3_IMAP_PLAIN_PORT=3143` (GreenMail, bara 127.0.0.1), `T3_CONTROL_PORT=3199`.
Läge test/produktion lagras i `SIM_HOME/mode` och `T3_MODE` i env-filen; ändras via `up.sh --mode ...` (appen startas om
vid ändrad env-fil). Scenarier som anropar cron-rutterna använder `T3_MODE` som `environment`.

## Vad som startas

* **Stack:** den lokala Supabase-stacken (API 54321, DB 54322) återanvänds. Saknas den körs
  `scripts/gridex-aud-003-clean-replay.sh` med en `supabase`-shim (`stop` = no-op). `replay-commit`, `replay-at` och tom
  `applied-migrations.tsv` skrivs om de saknas.
* **Egen CA** (`SIM_HOME/ca/`, privata nycklar bara där): servercert för `127.0.0.1`/`localhost`. Appen litar på den via
  `NODE_EXTRA_CA_CERTS`; `NODE_TLS_REJECT_UNAUTHORIZED` sätts aldrig.
* **Mailmotpart** (`counterparty/mail-counterparty.mjs`, Node, bara 127.0.0.1):
  * SMTP med implicit TLS på `T3_SMTP_PORT`, AUTH PLAIN/LOGIN. Varje mottagen MIME sparas byte-exakt (efter dot-unstuffing)
    som `SIM_HOME/mail/inbox-dso/<n>.eml` + `<n>.eml.sha256` + `<n>.json` (kuvert, TLS-version, läge, utfall).
  * Lägen per körning: `accept`, `tempfail-4xx` (451 eller `code`), `permfail-5xx` (554 eller `code`), `drop-after-data`
    (meddelandet sparas men förbindelsen stängs utan svar), `hang` (sparas, inget svar, hålls öppen `hangMs`). Styrs med
    `curl -XPOST '127.0.0.1:3199/mode?mode=tempfail-4xx&code=451[&stage=rcpt]'`, filen `SIM_HOME/mail/control.json`
    eller `lib/counterparty.ts: setSmtpMode`. `GET /state`, `GET /messages`, `POST /drop-connections`.
  * IMAP med TLS (egen CA) på `T3_IMAP_TLS_PORT`: TLS-terminator framför GreenMail (`greenmail/standalone:2.1.8`,
    docker-container `t3sim-greenmail`, märkt `sim.track=track3`). Användare `ediel`, lösenord i `secrets/imap-pass`.
* **Fixture** (`lib/seed.mjs`, idempotent): tenant `T3SIM Supplier AB` (Ediel-ID 16700), automationsaktör (auth-användare,
  profil, aktivt medlemskap; ID skrivs till `EDIEL_AUTOMATION_ACTOR_USER_ID` före appstart), aktörsinställning, kommunikationsrutter
  och rutt-profiler (`ediel_ack`, `meter_values`) 16700 -> 70007 i båda miljöerna med mål `dso@t3.sim.invalid`, och den delade
  `ediel_mailboxes`-raden per miljö pekas om till lokala IMAP (ursprungsraderna sparas i
  `SIM_HOME/evidence/seed-original-shared-mailboxes.json`). Unikt per körning är `newRunContext().prefix` (referenser).
* **Env-fil** `SIM_HOME/env/track3.env` (0600, utanför repo): Supabase-nycklar ur `supabase status -o env`, SMTP/IMAP mot
  motparten, `NODE_EXTRA_CA_CERTS`, slumpade cron-hemligheter, `EDIEL_MESSAGE_ID_DOMAIN=t3.sim.invalid`,
  `EDIEL_EMAIL_PROVIDER=strato` (`EMAIL_PROVIDER` sätts inte), `EDIEL_APP_DKIM_ENABLED` tom.

## Hjälpkod för scenarier (`lib/`)

`seed.mjs` (admin-klient, psql-hjälpare, fixture, `newRunContext`), `edifact.ts` (UTILTS E66-generator, unika UNB/BGM-refs),
`mime.ts`, `counterparty.ts` (IMAP-inläggning, motpartsstyrning, läsning av mottagna DSO-mejl, TLS-kontroll), `app.ts`
(cron-ingångarna inbound/outbox), `db.ts` (snapshot/diff av ediel-tabeller), `evidence.ts` (evidens + sha256-manifest).
Skriv nya prov som steg i `scenarios/*.test.ts`, namngivna med scenario-ID (`MAIN03.01 ...`). Webbläsarsteg: Playwright
(anges i steget, påverkar executionScope); smoke använder ingen webbläsare.

## Gränser

* Allt lyssnar på 127.0.0.1; harnessen kontaktar inga externa värdar. Hemligheter genereras lokalt och stannar i `SIM_HOME`.
* Nätägare/SVK/spotpris-motparter och leverantörsfilsmottagare ingår inte i detta spår (bara mail).
* `drop-after-data` och `hang` sparar meddelandet trots att klienten inte får svar (modellerar "levererat men okvitterat").
* Produktionsbanan körs lokalt med samma motpart; guards i produktkoden (certifikat, mandat, ...) kan blockera och loggas då som
  observation.
* Harnessen ändrar inte produktkod. Avvikelser i produktbeteende rapporteras som kandidatfynd, inte som harnessfel.

## Observationer från röktestet (kandidatfynd i produktkod, ej rättade av harnessen)

Observerade mot basen `1c0c088c`; fil:rad avser körkatalogen. Harnessen går runt dem där det behövs och loggar det i `report.json`.

1. `lib/inbound-mail/edielMailboxPoller.part-2.ts:425` anropar `client.messageFlagsAdd` inuti `for await (client.fetch(...))`
   (rad 430). ImapFlow 2.2.1 har bakåttryck i fetch-generatorn, så kommandot väntar på ett fetch som väntar på loopen:
   varje poll fastnar ~30 s vid första meddelandet, felet blir "Connection not available", meddelandet markeras aldrig
   Seen och de efterföljande meddelandena svälts. Reproducerat även direkt mot GreenMail utan TLS-terminatorn.
   Harnessen: `markSeenByMessageIds` mellan pollar; in-process-vägen använder `markSeen:false` (som admin-åtgärden).
2. `app/api/internal/inbound-mail/cron/route.ts:65-71` skickar ingen `actorUserId` till `runInboundEdielMailEngine`
   (`EDIEL_AUTOMATION_ACTOR_USER_ID` används bara av outbox-routen). Följd: `inboundStatusUpdater.ts:327`
   `ediel_real_reception_actor_and_parse_required`, inget inkommande meddelande kan slutföras via HTTP-cron.
   Harnessen: `lib/inprocess.ts runInboundEngineAsAutomationActor` (samma motor med aktör).
3. `edielMailboxPoller.part-1.ts:1010` skriver `ediel_mailboxes.last_successful_poll_at`, men kolumnen saknas i den
   replayade databasen (PGRST204) trots att `20260601070000_ediel_production_readiness_hardening.sql:61` lägger till den.
   Varje lyckad poll slutar därför i catch med "Okänt pollingfel." (PostgREST-felet är inget `Error`) och `last_error` sätts.
4. `lib/inbound-mail/edielInboundProcessor.ts:187-193` lägger `raw_edifact_payload` och bilagetexten efter varandra; med en
   UNA-inledd bilaga blir det två sammanhängande interchanges och tokenizern kastar `edifact_dangling_release_character`
   (inline-body utan bilagerad ger ingen dubblering). Harnessens `buildEdifactMime` stöder `placement: 'attachment'|'inline'`
   och `buildUtiltsE66({ una: false })`.
5. Fixture-krav som upptäcktes (nu seedade): verifierad juridisk identitet (`tenant_ediel_profiles`, `tenant_actor_identifiers`,
   `tenant_actor_roles`), `accepted_at` på aktörens medlemskap och `user_permissions` (communication/ediel/metering) annars
   `ediel_tenant_actor_forbidden`. Ett E66 utan känd mätpunkt/kundobjekt hamnar i `manual_review` (`match_status=missing`);
   scenarier som vill nå CONTRL/APERAK måste seeda mätpunkt och kund själva.
