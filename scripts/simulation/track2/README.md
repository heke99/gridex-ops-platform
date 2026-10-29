# Spår 2 – lokal simuleringsharness (tillfälligt utanför repot)

Flyttas till `scripts/simulation/track2/` när filclaim finns. Ingen appändring på basen krävs.

## Användning
```
SIM_HOME=/root/sim/home-track2 RUN_DIR=/root/sim/track2 ./up.sh     # SKIP_REPLAY=1 / SKIP_BUILD=1 återanvänder
./run.sh scenarios/smoke.test.ts                                     # rapport: $SIM_HOME/reports/<namn>-<utc>.json
./down.sh                                                            # stoppar app, motparter, supabase + volymer
```
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
