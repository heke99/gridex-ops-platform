# Spår 3 (Ediel) – simuleringsharness

Kampanj 20261029-3f1a8ab1. Separat, lokal harness för Ediel-kedjan: inkommande mejl (IMAP) -> app -> CONTRL/APERAK i
outbox -> utgående mejl (SMTP) -> "nätägar"-motpart. Ingen extern trafik, inga riktiga mejl, ingen extern DB.
Harnessen kräver inga ändringar i produktkod (basen: `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`).

## Kontrakt

| Skript | Uppgift |
| --- | --- |
| `up.sh [--mode test\|production]` | Idempotent. Verifierar stacken (annars clean replay), skriver replay-kvitton, genererar CA, startar mailmotpart, seedar fixture, skriver `env/track3.env`, bygger (`next build`) vid behov och startar `next start`. |
| `down.sh [--stack] [--purge]` | Stoppar app, mailmotpart och GreenMail-containern (med `--stack` även Supabase-stacken inkl. volymer), verifierar att inget är kvar och skriver `SIM_HOME/cleanup-receipt.json`. Exit 1 om något finns kvar. |
| `run.sh <scenariofil...>` | Kräver `SIM_REPORT`, en absolut privat fil utanför Git-arbetsytor och Git-metadata. Ogiltigt mål eller en env-fil som ändrar `SIM_REPORT` nekas före lås, nätanrop och Vitest. En körning åt gången (flock på `SIM_HOME/run.lock`). Per scenario: `SIM_HOME/runs/<run-id>/<scenario>/{report.json,log.txt,vitest.json}`. |

Rapporten (`report.json`) har `exit`, `startedAt`/`endedAt` (UTC), `steps[]` (`passed|failed|skipped`), `skipped[]`,
vitests sammanfattning (`vitest`), `observations` (utfall som scenariot loggar utan att assertera) och sökväg till
evidenskatalogen med `MANIFEST.sha256`.

`SIM_REPORT` innehåller `{runId, exit, scenarios}` med de faktiska scenariorapporterna, inklusive `scenarioId` per
EDIEL-steg. Varje rapport måste matcha körningens ID, scenario och verkliga exitkod. Första icke-noll-exitkoden från
Vitest bevaras; saknad scenariofil eller misslyckad rapportering ger också icke-noll. Rapportfilen får 0600 även
om den redan finns; befintliga symlänkar eller kataloger godtas inte som rapportmål.
Förkontrollen använder Python 3 och Git för att kontrollera den upplösta målsökvägen.

## Körning

```
bash scripts/simulation/track3/up.sh                  # första gången: bygge kan ta >10 min (SKIP_BUILD=1 återanvänder)
SIM_REPORT=/privat/evidens/track3-report.json bash scripts/simulation/track3/run.sh scenarios/smoke.test.ts
bash scripts/simulation/track3/down.sh                # --stack stoppar även Supabase
```

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
