# Spår 6 – simuleringsharness (infrastruktur)

Kampanj 20261029-3f1a8ab1, worker claude-track6. Separat, lokal harness: egen Supabase-stack i containern, egen
mailmotpart (SMTP/IMAP, bara 127.0.0.1), fixture-tenant `T6SIM Supplier AB` (eget Ediel-ID 16760, motpart/DSO 70007).
Ingen extern trafik, inga riktiga mejl, ingen extern DB. Scenariofiler läggs till av respektive scenarioägare under
`scenarios/`; denna leverans innehåller bara infrastruktur och `scenarios/smoke.test.ts`.

**Appversion:** appen körs från körkatalogen (`SIM_RUN_DIR`, default `/root/sim-run/track6`) vid dess HEAD, avsett att vara
main `6454d540b6978a9c25434b8c66bcd7a0e335c99c`, inte kampanjbasen. `up.sh` skriver `git -C $SIM_RUN_DIR rev-parse HEAD` som
`appCommit` i `SIM_HOME/commits.json`, tillsammans med harnessens egen commit (`harnessCommit`, `harnessDirty`) och
`builtCommit` (även i `SIM_HOME/built-commit`). **Harnessen kräver inga ändringar i produktkod.**

## Kontrakt

| Skript | Uppgift |
| --- | --- |
| `up.sh [--mode test\|production]` | Idempotent. Startar dockerd om `docker info` misslyckas, säkrar Supabase CLI 2.101.0, `npm ci` om `node_modules` saknas, clean replay om stacken inte svarar (annars återanvänds den; `SKIP_REPLAY=1` kräver att den lever), kvitton, CA, mailmotpart, fixture-seed, `env/track6.env`, `next build` vid behov (`SKIP_BUILD=1`) och `next start`. Stoppar med `BLOCKED: stacken upptagen` (exit 3) om `supabase_db_*` kör men inte svarar. |
| `down.sh [--stack] [--purge]` | Stoppar app, mailmotpart och containrar märkta `sim.track=track6`. `--stack` stoppar även Supabase (`supabase stop --no-backup`, containrar + volymer) och dockerd om och bara om up.sh startade den (`pids/dockerd.pid`). Verifierar, skriver `SIM_HOME/cleanup-receipt.json`, exit 1 om något är kvar. |
| `run.sh <scenariofil...>` | Kör scenariofiler med vitest och skriver per scenario `SIM_HOME/runs/<run-id>/<scenario>/{report.json,log.txt,vitest.json}`; kräver `SIM_REPORT` (sammanställd rapport skrivs dit); en körning åt gången (flock + PID/starttid i `SIM_HOME/run.lock`, tas bort vid avslut). |

Rapporten (`report.json`) har `steps[]` (`passed|failed|skipped`), vitests sammanfattning, `observations` och sökväg till
evidens med `MANIFEST.sha256`.

## Docker och Supabase

* **docker:** om `docker info` misslyckas startar `up.sh` `dockerd` i bakgrunden (logg `SIM_HOME/logs/dockerd.log`, pid i
  `SIM_HOME/pids/dockerd.pid`, extra flaggor via `T6_DOCKERD_ARGS`) och väntar upp till 90 s. Fanns daemonen redan rörs den inte.
* **Supabase CLI:** `/opt/node22/bin/supabase` används om den finns och är version 2.101.0 (replayskriptet kräver exakt den
  versionen). Annars körs `npm install supabase@2.101.0` till `SIM_HOME/tools` (`T6_SUPABASE_BIN`/`T6_SUPABASE_VERSION` åsidosätter).
* **Replay:** som spår 3: `scripts/gridex-aud-003-clean-replay.sh` körs med en `supabase`-shim (`stop` = no-op) så att stacken
  ligger kvar. Efter en **ny** replay sparas replayskriptets egna verifierade fingeravtryck i `SIM_HOME/fingerprint`, samt
  `replay-commit`, `replay-at` och tom `applied-migrations.tsv`. `db-url` (en rad, lokala standarduppgifter) skrivs till `SIM_HOME`.

* **Image-register:** `up.sh` sätter `SUPABASE_INTERNAL_IMAGE_REGISTRY=${T6_IMAGE_REGISTRY:-ghcr.io}` för replayen, så Supabase CLI hämtar `ghcr.io/supabase/<namn>:<tag>` i stället för `public.ecr.aws` (datagräns) eller docker.io (429). Image-digests sparas i `SIM_HOME/evidence/image-digests.txt`.

* **GreenMail utan docker:** misslyckas `docker run` (t.ex. docker.io 429) eller är `T6_GREENMAIL_MODE=jar`, hämtar `up.sh` `greenmail-standalone-2.1.8.jar` från Maven Central till `SIM_HOME/tools`, verifierar sha1 mot `.jar.sha1` (hashar i `SIM_HOME/evidence/greenmail-jar-hashes.txt`) och kör den med java på 127.0.0.1 (pid i `pids/greenmail.pid`, logg `logs/greenmail-jar.log`). `down.sh` stoppar den.

## Portar och namn

App 3106, SMTP (TLS) 3625, IMAP TLS 3693, IMAP plain (GreenMail) 3643, kontroll 3699 (`T6_*_PORT`). Supabase 54321/54322 är
fasta (en stack per container). Container `t6sim-greenmail`, etikett `sim.track=track6`, maildomän `t6.sim.invalid`.
`SIM_HOME` default `/home/user/sim-home/track6`; allt tillstånd (env 0600, CA, hemligheter, evidens) ligger där.

## Fixture

`lib/seed.mjs` (idempotent): tenant `T6SIM Supplier AB` (Ediel-ID 16760), automationsaktör, aktörsinställningar, rutter och
rutt-profiler 16760 -> 70007 i båda miljöerna, delad `ediel_mailboxes`-rad omdirigerad till lokal IMAP (original sparas i
`SIM_HOME/evidence/seed-original-shared-mailboxes.json`). Unikt per körning: `newRunContext().prefix`.

## Körning

```
bash scripts/simulation/track6/up.sh
bash scripts/simulation/track6/run.sh scenarios/smoke.test.ts
bash scripts/simulation/track6/down.sh --stack
```

Nya prov: steg i `scenarios/*.test.ts`, namngivna med scenario-ID. Webbläsarsteg: Playwright (anges i steget).

## Ursprung

Kopierat från kampanjens spår 3, commit `01d97c27ec73544f6c303936fadf4cb73a5e25dc`, med namnbyte track3/T3/t3 -> track6/T6/t6,
nya portar och Ediel-ID 16760, samt tillägg i `up.sh`/`down.sh`/`lib/common.sh` (dockerd, CLI-installation, appCommit/harnessCommit,
fingerprint, BLOCKED-kontroll). Ediel-scenariofiler och e0x-hjälpkod är inte kopierade.

| Fil | Ursprung |
| --- | --- |
| `up.sh` | `01d97c27:scripts/simulation/track3/up.sh` (ändrad) |
| `down.sh` | `01d97c27:scripts/simulation/track3/down.sh` (ändrad) |
| `run.sh` | `01d97c27:scripts/simulation/track3/run.sh` |
| `vitest.config.ts` | `01d97c27:scripts/simulation/track3/vitest.config.ts` |
| `lib/common.sh` | `01d97c27:scripts/simulation/track3/lib/common.sh` (ändrad) |
| `lib/seed.mjs` | `01d97c27:scripts/simulation/track3/lib/seed.mjs` (Ediel-ID 16760) |
| `lib/seed-cli.mjs` | `01d97c27:scripts/simulation/track3/lib/seed-cli.mjs` |
| `lib/evidence.ts` | `01d97c27:scripts/simulation/track3/lib/evidence.ts` |
| `lib/db.ts` | `01d97c27:scripts/simulation/track3/lib/db.ts` |
| `lib/make-report.mjs` | `01d97c27:scripts/simulation/track3/lib/make-report.mjs` |
| `lib/counterparty.ts` | `01d97c27:scripts/simulation/track3/lib/counterparty.ts` |
| `lib/mime.ts` | `01d97c27:scripts/simulation/track3/lib/mime.ts` |
| `counterparty/mail-counterparty.mjs` | `01d97c27:scripts/simulation/track3/counterparty/mail-counterparty.mjs` |
| `scenarios/smoke.test.ts` | nyskriven för spår 6 |
| `README.md` | efter `01d97c27:scripts/simulation/track3/README.md` |

## DELIVERY01 (kedja)

`scenarios/delivery01.test.ts` + `lib/chain/`: VINTERTID. Leverans från 2026-10-28, faktureringsmånad 2026-10, fyra E66 (dygn 28-31, 24 timvärden vardera). Sommartidsstart ger antingen luck före första värdet eller gate-abort (`billing_gate_qualified_supply_source_required`: PRODAT DTM läses som UTC+1, `market_start_at` = lokal midnatt vintertid). Dygn 31 ligger i framtiden relativt stackens klocka; utfallet loggas. Observationen `<Cn>_chain.gate` visar `market_start_at` och första värdets intervall; `<Cn>_chain.e66.perMessage` ger tid per meddelande.
