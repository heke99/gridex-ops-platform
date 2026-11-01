# Spår 2 – lokal simuleringsharness

Donorn från Claude är bevarad i den separata adoptionscommiten. Ny körning kräver
samordnarens uttryckliga miljötilldelning; gamla hem, standardportar och tidigare
PASS-markörer ger ingen ny körbehörighet.

## Användning

Samordnaren tilldelar först en privat JSON-fil med formatet nedan, ägd av aktuell
OS-användare och utan grupp-/övrig åtkomst (`chmod 600`). Filen och `SIM_HOME`
ska ligga utanför Git. `RUN_DIR` ska vara en ren checkout på exakt `sourceCommit`.
Ett befintligt `SIM_HOME` måste vara en riktig katalog ägd av aktuell användare
med läge 0700; symlänkar i katalogens logg-/PID-/rapportutdata avvisas. Fel vid
katalogskapande eller rättighetskontroll stoppar även shell utan `errexit`.
Alla nio portar ska vara olika och samordnaren måste separat verifiera att projekt,
portar, DB/Auth/Storage, processer och lokala motparter är exklusivt tilldelade.
Formatet är ett lokalt tilldelningsunderlag, ingen automatisk backendattest.

```json
{
  "schema": "gridex-simulation-runtime-assignment-v1",
  "worker": "T2",
  "state": "ACTIVE",
  "environmentId": "t2-coordinator-assigned-epoch",
  "expiresAt": "<framtida tid med tidszon>",
  "allowedOperations": ["up", "run", "down"],
  "runDir": "<absolut kanonisk sökväg till ren app-checkout>",
  "sourceCommit": "<observerad fullständig 40-teckens Git-SHA>",
  "simHome": "<absolut kanonisk privat sökväg utanför Git>",
  "projectId": "sim-t2-<unik tilldelning>",
  "ports": {
    "SIM_API_PORT": 55101, "SIM_DB_PORT": 55102,
    "SIM_SHADOW_PORT": 55103, "SIM_POOLER_PORT": 55104,
    "SIM_STUDIO_PORT": 55105, "SIM_MAIL_HTTP_PORT": 55106,
    "SIM_SMTP_PORT": 55107, "SIM_APP_PORT": 55108,
    "SIM_COUNTERPART_PORT": 55109
  }
}
```

Portarna ovan illustrerar formatet och är ingen faktisk tilldelning. När verklig
körning är kvalificerad används samma explicit exporterade tilldelning för varje
kommando:

```bash
export SIM_RUNTIME_ASSIGNMENT_FILE=/privat/t2-assignment.json
export SIM_HOME=/privat/t2-runtime RUN_DIR=/checkout/app
./up.sh
./run.sh scenarios/smoke.test.ts
./down.sh --processes-only
```

`common.sh` verifierar tilldelningen före katalogskapande och innan något av
kommandona når Docker, processhantering eller fixturer. `ports.env` läses endast
som data och måste exakt matcha tilldelningen; kod, dubbla nycklar och gamla
portvärden avvisas. En utgången/återkallad tilldelning eller ändrad appkälla kräver
samordnarens nya kontroll, även före `down.sh`.

Detta spärrar **otilldelad start**, men kvalificerar inte verklig körning:
replaypatchar, faktisk installerad migration/DB-identitet, bygg-/schema-/loggbevis,
process-ID:n och up/down-rensning måste fortfarande granskas mot den tilldelade
miljön. `SKIP_REPLAY`/`SKIP_BUILD` och enbart textmarkörer är inte sådant bevis.
Ingen verklig körning eller ny scenario-PASS är utförd med denna ändring.

## Processer och avgränsad cleanup

`up.sh` kräver dessutom en separat `startupAttempt` i samma privata tilldelning:

```json
{
  "startupAttempt": {
    "exclusiveHost": true,
    "backendReservation": {"ref": "refs/tags/agent-claims/masterplan/<egen-backend>", "receipt": "<fullständig kvitto-SHA>"},
    "producerReservation": {"ref": "refs/tags/agent-claims/masterplan/<egen-producent>", "receipt": "<fullständig kvitto-SHA>"}
  }
}
```

Samordnaren verifierar de verkliga reservationerna och den exklusiva miljön före
ett sådant försök. Lokal formatkontroll förvärvar inga resurser och verifierar
inte dessa GitHub-refar. Ett försök är inte replay-, bygg- eller scenario-PASS.
Ingen sådan tilldelning har skapats här. Installation/schema, replaypatchar,
endpointbindning och direkt Vitest-anrop kräver fortfarande egen kvalificering.

Starten vägrar återanvända `SKIP_REPLAY`/`SKIP_BUILD` eller ett befintligt
replay-root/app.env/processkvitto. En otillgänglig daemon startas aldrig
automatiskt. Befintliga projektcontainrar (även stoppade), volymer eller nätverk
blockerar starten; de stoppas eller raderas inte. Både start och cleanup tar
`run.lock` och lämnar kvar en okänd låsning för samordnarens avstämning.

Direkt efter start skriver skriptet ett nytt privat födelsekvitto med roll,
miljö, tilldelningens hash, faktisk PID, starttid från `/proc`, körbar fil,
arbetskatalog och kommandoradens hash. Efter beredskapskontrollen skrivs en
separat observation bunden till samma PID/starttid/körbara fil/arbetskatalog
och födelsekvittots hash. Därmed redovisas även Nexts ändrade processnamn.
Gamla PID-/kvittofiler skrivs inte över. Ett avbrutet startförsök där
kommandoraden ändrats men en senare observation saknas behöver samordnarens
riktade avstämning; det gamla kvittot ger ingen rätt att gissa en ny identitet.

`down.sh --processes-only` kontrollerar båda processernas hela kvitton före
första signalen. Linux pidfd binder SIGTERM/SIGKILL till den verifierade
processen även om numeriska PID återanvänds. Ingen sökning/radering efter
namn, port eller gemensam etikett görs. Innan signaleringen reserveras en ny
0600-journal under `SIM_HOME/process-cleanup-receipts/`, med originalkvitton
och därefter observerade stopp. Endast en journal som slutar med `DONE`
bekräftar avslutad processcleanup.

Barnprocesser och processgrupper ingår inte i denna cleanup. Databas, containrar,
volymer, nätverk, mailoriginal, app.env, tidigare rapporter och bevis bevaras.
`down.sh` utan `--processes-only` vägrar köra tills en separat kvalificerad
backend-/retentionstilldelning finns. Processkvittot påstår aldrig att hela
miljön är städad eller att en scenariokörning är godkänd.

## Bevarat donorflöde — kräver separat körkvalificering

Beskrivningen nedan dokumenterar det övertagna flödet. Standardvärden och
återanvändning som nämns där ger ingen tilldelning; den nya spärren ovan gäller.

Typkontroll: `RUN_DIR/node_modules/.bin/tsc -p tsconfig.json` (run.sh länkar `node_modules` -> RUN_DIR/node_modules om repo saknas runt harnessen).

## Flöde i up.sh
1. Startar `dockerd` om `docker info` misslyckas (logg `$SIM_HOME/dockerd.log`). `down.sh` stoppar inte dockerd (imagecache).
2. Skriver `$SIM_HOME/ports.env` (överstyrbart via `SIM_*_PORT`, `SIM_PROJECT_ID`; defaults API 54321, DB 54322, shadow 54320, pooler 54329, studio 54323 (ej startad), mail-HTTP 54324, SMTP 54325, app 3102, motparter 3190). Portar och project_id skrivs i en KOPIA av config.toml.
3. Kopierar `scripts/` + `supabase/` från RUN_DIR till `$SIM_HOME/replay-root` och kör `scripts/gridex-aud-003-clean-replay.sh` därifrån (skriptet muterar migrations/, seed.sql, .temp/, e2e-artifacts/ – RUN_DIR rörs inte). Registry: `SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io` (sätts i up.sh; strängen finns i supabase-go 2.101.0); `supabase start -x studio,imgproxy,edge-runtime,logflare,vector` (görs av replayskriptet).
4. `supabase status -o env` -> `$SIM_HOME/app.env` (chmod 600; hemligheter loggas aldrig). Skriver replay-commit, replay-at, tom applied-migrations.tsv, built-commit.
5. Startar lokala motparter (`lib/counterparts.mjs`), `next build` i RUN_DIR (webpack, env från app.env), `next start -H 127.0.0.1 -p $SIM_APP_PORT`.

## Avvikelser från repot (endast i kopian under `$SIM_HOME/replay-root`; diff i `$SIM_HOME/logs/replay-script-patch.diff`)
Supabase CLI är exakt 2.101.0 (up.sh kontrollerar; shimmen kräver `/usr/local/bin/supabase-go` bredvid sig). Repots `config.toml` accepteras oförändrad (verifierat med `supabase status`). Kvarvarande patchar:
1. Replayskriptets EXIT-trap `supabase stop --no-backup` neutraliseras. Orsak: originalet river stacken vid exit; scenarierna behöver den uppe.
2. `mailpit` tas ur `-x`-listan i skriptets `supabase start`, och `inbucket.smtp_port` aktiveras i config-kopian. Orsak: lokal mail (SMTP 54325, HTTP 54324) för appens SMTP; ingen DB-påverkan.
3. Portar: `SIM_*_PORT` skrivs i config-kopian, och `54322` i skriptet byts bara om `SIM_DB_PORT` ändras. Med standardvärden (och `SIM_PROJECT_ID=gridex-ops-platform`) blir portdiffen tom. Orsak: valfri port-isolering.
Replayskriptet muteras annars av sig självt (migrations/, seed.sql, .temp/, e2e-artifacts/); därför körs det i kopian så RUN_DIR är orört.

## Externa integrationer (neutraliserade)
| Variabel | Standard i appen | Här |
|---|---|---|
| `PAPILITE_GEOCODE_URL` | extern Papilite | `http://127.0.0.1:$SIM_COUNTERPART_PORT/papilite` (svarar `[]`), `PAPILITE_API_KEY` osatt |
| `LANTMATERIET_BELAGENHETSADRESS_BASE_URL` | extern | lokal motpart; USERNAME/PASSWORD osatta |
| `EDIEL_SMTP_HOST/PORT/SECURE` | smtp.strato.de:465 | `127.0.0.1:$SIM_SMTP_PORT`, secure=false (stackens mailpit) |
| `RESEND_API_KEY`, `OPENAI_API_KEY`, `OPENDATALOADER_API_URL` | externa tjänster | osatta (avstängda) |
| `NEXT_PUBLIC_SUPABASE_URL` m.fl. | – | lokala stackens API |
Cron-/webhookhemligheter genereras slumpmässigt per `up.sh`.
Spotpriser, nätägare och SVK: ingen extern hämtning; scenarier skriver syntetiska rader direkt i stackens DB (backendersättning). Motparten loggar alla anrop i `$SIM_HOME/counterparts/requests.jsonl`; mottagna leverantörsfiler (`POST/PUT /supplier-files/*`) sparas under `counterparts/received/`.

## Klocka
- Auth/JWT = real tid, aldrig manipulerad (ingen faketime på server som validerar JWT).
- Affärstid = explicita fixturdatum/`billing_month`; där appen använder `now()`/`new Date()` ankras fixturen relativt real dag (t.ex. frist ±1 dag). Signeringsdatum är eget deklarerat fixturfält.

## Rapport (run.sh)
JSON: `scenario, scenarioFile, startedAt, finishedAt, exitCode, appCommit, replayCommit, builtCommit, replayAt, vitest{...}, summary{passed,failed,skipped,total}, steps[{name,status,durationMs,failureMessages}]`. Hook-/suitefel läggs som ett failed-steg `(suite)`. Lås `$SIM_HOME/run.lock` (pid) hindrar parallella körningar.

## Kända begränsningar
- Ingen IMAP-motpart (mailpit har SMTP + HTTP-API + POP3, ej IMAP); behövs för inbound-Ediel/manuell inkorg i senare uppdrag.
- Stackens JWT-hemlighet/nycklar är CLI:ns lokala standard (endast 127.0.0.1).
- vitest/vite kan skriva cache under RUN_DIR/node_modules via symlinken.
