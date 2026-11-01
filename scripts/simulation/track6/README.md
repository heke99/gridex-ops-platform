# Spår 6 – Codex simuleringsharness

Kampanj `20261029-3f1a8ab1`. Codex äger den nya körningen. Det bevarade
Claude-originalet är commit `09dc7b422d9bfea3edebd82585a4cae4f4edec1c`;
byte-exakt adoption finns i `5fde1a71556fe8b8e2f22546f5a646d533c2f045`.
Originalens rapporter och observationer förblir historik. Orakelbasen är
`1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`; nya rapporter binder faktisk
app-SHA/träd, bygge, replay, schema, överlägg, miljö och producent.
Ingen likvärdighet med en gammal appversion eller ny scenario-PASS är underförstådd.

## Körkontrakt

| Kommando | Beteende |
| --- | --- |
| `up.sh [--mode test|production]` | Läser en uttrycklig privat samordnartilldelning och ett kvalificerat färskt replay-/byggkvitto. Kontrollerar faktisk källa, bygg-ID, schema, migrationsledger, DB/API/Storage-container-ID och lokala endpointbindningar före fixturer. Startar bara tilldelad GreenMail och egna app-/mailprocesser. Ingen automatisk daemonstart, installation, imagehämtning, replay eller bygge. |
| `run.sh <scenariofil...>` | Kontrollerar samma identiteter, färdighetskvitto och levande app-/mailresurser före arbete. Kör endast spårets scenariofiler, seriellt. Skriver nya privata rapporter utan att ersätta original. |
| `down.sh` | Stoppar bara kvittobundna app-/mailprocessgrupper och exakt GreenMail-container-ID. Verifierar att processgrupperna är tomma. Bevarar backend, volymer och originalbevis. `--stack` och `--purge` nekas före städning; backend- och gallringssteg tillhör samordnaren. |

Node 22, Python 3.11+ (`tomllib`), Docker och PostgreSQL-klienter måste vara
förberedda. Appcheckout och beroenden måste redan finnas. En arbetskatalog ger
ingen DB/Auth/Storage-isolering. Miljötilldelningen intygar en separat faktiskt
reserverad exklusiv värd/producent; JSON-filen förvärvar ingen lease. Samordnaren
verifierar de autentiserade reservationskvittona före tilldelning och behåller dem
under hela körningen. Ingen användarbekräftelse behövs för rutinmässig lokal
provisionering inom det givna mandatet.

## Samordnarens indata

Alla sökvägar är absoluta, kanoniska och fria från symlänkar. `SIM_HOME` har mode
0700, ägs av aktuell uid och ligger utanför både app- och harnesscheckout. Privata
indatafiler har mode 0600. De innehåller verkliga lokala körvärden; exemplen nedan
är formatbeskrivningar och ger ingen tilldelning.

Exportera `SIM_RUN_DIR`, full 40-teckens `T6_APP_COMMIT`, `SIM_HOME`, explicit
`T6_DB_URL`, `T6_RUNTIME_ASSIGNMENT_FILE` och `T6_BACKEND_ASSIGNMENT_FILE`.
DB-URL:en måste ange `postgresql://...@127.0.0.1:<tilldelad-port>/postgres` utan
query, fragment eller kodade databasalias. Lägg inte URL/credentials i publika
rapporter eller terminalutdata.

`T6_RUNTIME_ASSIGNMENT_FILE`:

```json
{
  "schema": "track6-runtime-assignment-v1",
  "workerId": "codex-track6",
  "model": "ACTUAL_CODEX_MODEL",
  "environmentId": "t6-ASSIGNED",
  "appDir": "/absolute/assigned/app",
  "appCommit": "FULL_40_CHARACTER_SOURCE_SHA",
  "simHome": "/absolute/private/assigned-home",
  "projectId": "ASSIGNED_CONFIG_PROJECT_ID",
  "apiContainerId": "FULL_64_HEX_API_GATEWAY_ID",
  "storageContainerId": "FULL_64_HEX_STORAGE_SERVICE_ID",
  "ports": {"app":3106,"api":54321,"db":54322,"smtp":3625,"imapTls":3693,"imapPlain":3643,"control":3699},
  "exclusiveHost": true,
  "backendReservation": "AUTHENTICATED_CURRENT_BACKEND_PRODUCER_RESERVATION",
  "allowedActions": ["up", "run", "down"],
  "expiresAtUtc": "FUTURE_UTC_TIMESTAMP",
  "overlayRefs": [],
  "backendAssignmentSha256": "SHA256_OF_EXACT_BACKEND_ASSIGNMENT_BYTES",
  "preparedReceiptSha256": "SHA256_OF_EXACT_PREPARED_RECEIPT_BYTES",
  "greenmailName": "t6-ASSIGNED-greenmail",
  "greenmailImage": "greenmail/standalone@sha256:VERIFIED_64_HEX_DIGEST"
}
```

Alla sju portar måste vara olika. Projekt och API/DB-portar måste matcha appens
`supabase/config.toml`. DB, API-gateway och Storage har olika fullständiga
container-ID:n och samma kvalificerade projektetikett. DB-porten 5432 respektive
API-gatewayns port 8000 måste vara publicerade enbart på tilldelad 127.0.0.1-port.
Storage nås via samma kontrollerade API-URL. GreenMail-namnet måste vara exakt
`<environmentId>-greenmail`; digestbilden ska redan vara hämtad och verifierad av
samordnaren (`docker run --pull=never` används). En befintlig container ersätts inte.

Den tidigare restore-hjälparens `T6_BACKEND_ASSIGNMENT_FILE` har fortsatt format:

```json
{
  "version": 1, "workerId": "T6", "environmentId": "t6-ASSIGNED",
  "containerId": "FULL_64_HEX_DATABASE_CONTAINER_ID",
  "projectId": "ASSIGNED_CONFIG_PROJECT_ID", "host": "127.0.0.1",
  "port": 54322, "database": "postgres", "systemIdentifier": "OBSERVED_POSTGRES_SYSTEM_IDENTIFIER"
}
```

Kopiera inte identiteten från en godtycklig ensam container. Samordnaren binder
faktisk miljö, exakt aktuellt reservationskvitto och observerad PostgreSQL-identitet.

`SIM_HOME/prepared-runtime.json`:

```json
{
  "schema": "track6-prepared-runtime-v1",
  "producerReservation": "AUTHENTICATED_SOURCE_APPLICABLE_PRODUCER_RECEIPT",
  "appCommit": "FULL_40_CHARACTER_SOURCE_SHA",
  "appTree": "OBSERVED_FULL_GIT_TREE_SHA",
  "replayCommit": "FULL_40_CHARACTER_SOURCE_SHA",
  "nextBuildId": "OBSERVED_NEXT_BUILD_ID",
  "sourceSchemaSha256": "SHA256_OF_SOURCE_SUPABASE_SCHEMA_SQL",
  "schemaFingerprint": "OBSERVED_PARTIAL_FINGERPRINT",
  "ledgerMigrationsSha256": "SHA256_OF_RAW_PSQL_LEDGER_OUTPUT_WITH_FINAL_NEWLINE",
  "overlayRefs": [], "postReplayAppliedMigrations": 0
}
```

Den kvalificerade producenten utför genuin färsk clean replay och appbygge från
angiven ren källa, bevarar råloggarna privat och binder kvittot till autentiserad
producent, käll-SHA/träd och faktiska outputhashar. Använd repoets kvalificerade
replay-/byggarbetsflöde; skapa aldrig ett kvitto därför att en standardport svarar.
Appbyggets `.next/BUILD_ID`, källans `supabase/schema.sql`, faktisk migrationsledger
(`psql -XAtq -F TAB`, `SELECT version, coalesce(name,'') FROM
supabase_migrations.schema_migrations ORDER BY version`) och utfallet från
`scripts/gridex-aud-003-schema-fingerprint.sql` kontrolleras på nytt. Det senare
fingeravtrycket är en partiell identitet för utvalda tabeller, inte en fullständig
schemarevision. Post-replay-migreringar kräver separat kvalificering; denna runner
accepterar bara `postReplayAppliedMigrations: 0` och uttryckliga överlägg.

Förbered också privata `ca/server.key`, `ca/server.pem`, `ca/ca.pem` och
`secrets/smtp-pass` under `SIM_HOME`, alla mode 0600. Certifikatet ska vara signerat
av den lokala CA:n och gälla `localhost`/`127.0.0.1`. Ingen TLS-verifiering stängs av.
Skapa lokala syntetiska lösenord/cronhemligheter och ett privat JSON-objekt i
`SIM_HOME/env/track6.json`. Nycklar och värden är strängar; okända nycklar och NUL
nekas. Hemligheter tolkas som data och exekveras aldrig som shellkod.

Krävda identiteter/endpointvärden i JSON-miljön:

- `T6_MODE`: `test` eller lokalt simulerat `production`; `T6_SIM_HOME`: tilldelad privat sökväg.
- `T6_DB_URL`: samma privata URL som exporterats; `T6_APP_URL` och `T6_APP_PORT`: tilldelad loopback-app.
- `NEXT_PUBLIC_SUPABASE_URL` och eventuell `SUPABASE_URL`: `http://127.0.0.1:<apiPort>`; lokala anon-/service-nycklar i `NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`.
- `T6_SMTP_PORT`, `T6_IMAP_TLS_PORT`, `T6_IMAP_PLAIN_PORT`, `T6_CONTROL_PORT`: tilldelade portvärden.
- `T6_MAILBOX_ADDRESS`/`EDIEL_SMTP_USER`: `ediel@t6.sim.invalid`; `T6_IMAP_USER`/`EDIEL_IMAP_USER`: samma lokala användare.
- `EDIEL_EMAIL_PROVIDER`: `strato`; `EDIEL_SMTP_HOST`/`EDIEL_IMAP_HOST`: `127.0.0.1`; `EDIEL_SMTP_SECURE`: `true`; respektive SMTP/IMAP-port följer tilldelningen.
- `EDIEL_SMTP_PASS` matchar privata `secrets/smtp-pass`; `T6_IMAP_PASS`/`EDIEL_IMAP_PASS` matchar varandra.
- `NODE_EXTRA_CA_CERTS`: `SIM_HOME/ca/ca.pem`; lokala `EDIEL_CRON_SECRET`/`EDIEL_INBOUND_CRON_SECRET` och `GRIDEX_INVOICE_DELIVERY_RESOLVER=shared` för avsedda flöden.

Vid behov används också `EDIEL_SMTP_FROM`, `EDIEL_SHARED_MAILBOX_ADDRESS`,
`EDIEL_MESSAGE_ID_DOMAIN`, `NEXT_TELEMETRY_DISABLED` och efter seed
`EDIEL_AUTOMATION_ACTOR_USER_ID`. Den fulla tillåtelselistan finns i
`lib/seed-cli.mjs`. App, motpart och Vitest får en ren processmiljö med bara dessa
privata värden och uttryckliga harnessidentiteter; inga ärvda providercredentials.

## Start och körning

```sh
node scripts/simulation/track6/lib/seed-cli.mjs --admit up
bash scripts/simulation/track6/up.sh
SIM_REPORT="$SIM_HOME/reports/NEW-RUN.json" bash scripts/simulation/track6/run.sh scenarios/smoke.test.ts
bash scripts/simulation/track6/down.sh
```

`--admit up` är skrivskyddad; den startar ingen stack och skriver inget kvitto.
Förhandskontrollen ersätter inte samordnarens faktiska reservation. `up.sh` kräver
nya output-/processkvitton, seedar först efter förnyad kontroll av det förberedda
bygget och den egna mailmotparten, bevarar miljöoriginalet före aktörsuppdatering
och skriver `runtime-ready.json` först efter egna process-/containerkontroller.
Ofullständig start behålls för avgränsad samordnaråterställning; inga resurser gissas
eller raderas för att få nästa start grön.

Körlås är en privat atomiskt skapad `SIM_HOME/run.lock`-katalog. Ett gammalt lås
rensas endast av samordnaren efter verifierad ägar-/processkontroll. Varje nytt
run-ID har privata per-scenario råloggar, Vitest-JSON och rapporter under `runs/`.
`SIM_REPORT` är en ny kanonisk sökväg under `SIM_HOME`, utanför Git. Publicering är
atomisk utan överskrivning; symlänkar, gamla original, gamla temporärfiler och
blandade run-ID:n nekas. Rapportfel ger felstatus och blir aldrig scenario-PASS.

Vitests `globalSetup` gör dessutom den tidigare skrivskyddade DB-bindningskontrollen
före scenarioinsamling. CUSTODY01.05 väljer verktyg i `beforeAll`, så att fel där
stoppar följande fixture-skrivare även under annan konfiguration. Restore kontrollerar
DB-tilldelningen igen före dump/restore och temporär DB-livscykel; endast nya
`t6_restore_`-databaser tillåts, aldrig källdatabasen eller URL-överstyrningar.

Startkontroller är inte atomiska resursleases. Processstädning kräver rätt PID,
starttid, session/grupp, rätt Node-exekverare och arbetskatalog. Programraden måste
matcha startkommandot eller Nexts exakta versionsbundna `next-server`-processtitel;
en försvunnen ledare
med levande gruppmedlemmar ger BLOCKED. Grupper som lämnat den kvittobundna
processgruppen, faktisk backendgallring, produktion, externa mottagare och slutlig
105-scenariogodkänning ligger utanför denna privata harnessverifiering. Storage-
bytes ingår inte i `pg_dump`; tidigare custody-/delivery-substitutioner kvarstår.
