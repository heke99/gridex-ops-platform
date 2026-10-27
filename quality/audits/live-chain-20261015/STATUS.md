# Verklighetssimuleringen — läge och nästa steg

Uppdaterad 2026-10-27 kl. 09:50 UTC av Claude (session 01Az5xza…), som fortsätter på grenen `claude/wonderful-franklin-o8gx2p` (byggd på `claude/gifted-hamilton-vss1hj` `edeaed7d0`) på ägarens uppdrag. Tidigare session: 01YCH5Va…. Filen är tänkt att läsas först.

Den hör ihop med tre andra dokument:
- [FINDINGS.md](FINDINGS.md): alla fynd. Inget tas bort därifrån.
- [OWNER-DECISIONS.md](OWNER-DECISIONS.md): ägarens beslut, 25 st, och öppna frågor.
- #840: anspråk och leveranser per fil.

## Var jag är nu
- **Ny session och ny container (2026-10-26 ca 20:50 UTC):** den förra containern finns inte kvar, så batch 5 och de fem agenterna (F113, J2-03/J2-05, J4-D15, A-B4, I-B4v) försvann utan leverans. Inget av agenternas arbete var pushat. Världen är byggd **från noll** (ny replay, ny databas) på `363fcab29`, med `REALITY_SVK_SOURCE=simulated REALITY_SPOT_SOURCE=synthetic`. Docker Hub gav 429; `up.sh` körs nu i en omförsökslinda (`/tmp/claude-0/up-retry.sh`).
  - **I-B4v RÄTTAD** (`363fcab29`) och **J2-03 RÄTTAD** (`063587a69`, migration `20261026180000`, applicerad i världen). Se FINDINGS.
  - **Batch 5 (ny) pågår från 21:21 UTC** på `063587a69`: K, I, A, J1, H, J2, J4, F, G i banan als och stuck-detector, grid-owner-wire i banan free. Logg `/tmp/claude-0/batch5.log`. E körs därefter i en egen värld med testbanan; C och J3 körs ensamma.
  - **Batch 5, resultat hittills:** stuck-detector och grid-owner-wire gröna; K 10/12 (K4/K8 = A-B4, harness, rättad); I 4 gröna, 6 överhoppade (I-B5, produkt, KRITISK, rättad `547321093`). A avbröts 22:50 eftersom den körde den gamla bygget, som har I-B5.
  - **22:51 UTC:** appen byggs om på `547321093` (I-B5, F113 TS, A-B4). Därefter körs resten av batch 5 (A, J1, H, J2, J4, F, G) och sedan K och I om. Logg `/tmp/claude-0/batch5b.log`.
  - **Fjärde omstarten av containern (2026-10-27 ca 00:55–01:10 UTC):** J2 i batch 5b försvann. Världens data fanns kvar (även de manuellt applicerade `20261026170000` och `20261026180000`). dockerd startades, gx-mail togs bort och `up.sh` kördes med `SKIP_REPLAY=1 SKIP_BUILD=1` (bygget på `547321093` gäller, senare commits är bara harness).
  - **Batch 5c från ca 01:15 UTC** på `175912712`: I, A, J1 (verifierar I-B5, A-B4b, J1-B5), J2, J4, H (H-B5/H-B5b), K, F, G. Logg `/tmp/claude-0/batch5c.log`.
  - **Batch 5c:** I gav 4 gröna/6 röda med Z03 hela vägen (I-B5 verifierad). Nya fynd: I-B6 (harness), I-B7 och I-B8 (produkt) och T39, alla rättade i `9253c1918` (migration `20261027100000` applicerad). A avbröts eftersom den körde med de gamla simulatorerna.
  - **Batch 5d från ca 02:20 UTC:** appen byggs om på `9253c1918`. Därefter A, J1, I, J2, J4, H, K, F, G. Logg `/tmp/claude-0/batch5d.log` (bygget `/tmp/claude-0/up4.log`).
  - **Batch 5d, resultat (06:00 UTC):**
    - A 4/7: A-B4 och I-B6 verifierade (Z02 tillämpas); nytt I-B4v2, rättat.
    - J1 5/12: J1-B5 verifierad; resten är kända öppna J1-fynd. Nytt: J1-14 (beslut krävs), och T40 (harness, rättad).
    - I 6/10: I-B7, I-B8 och T39 verifierade; nytt I-B9 och I-B10, rättade.
    - J2 10/3: J2-03 verifierad; nytt J2-B5 (prestanda, kritisk), rättat.
    - J4 7/8: nytt T41 (harness), rättat.
    - H, K, F och G pågår.
  - **Därefter:** bygg om (I-B4v2, I-B9, I-B10, J2-B5) och kör om A, I, J2, J4, K och J1.
  - **Batch 5e från 06:51 UTC** på bygget `75cbac61e` (I-B4v2, I-B9, I-B10, J2-B5, T40–T42): K, A, I, J2, J4, H, J1, G, F. Logg `/tmp/claude-0/batch5e.log`.
    - K 11/12: K4 → A-B5 (produkt, migration `20261027110000`, applicerad) och T43 (harness), rättade.
    - A 4/7: A-B5 verifierad (härledningen går igenom). A3–A5 → A-B6 (RFF+ANJ över 35 tecken), rättad i `eae7ba4b3`, kräver ombyggnad.
    - I 7/10: I-B9 och I-B10 verifierade. Nytt I-B11 (inkommande jobb i godtycklig ordning; variant i utkorgen) och I-B12 ("Oklassificerad" i stället för "Kvittens försenad"), rättade i `a10861743` och `ca388c905`.
    - J2 pågår (startade 08:43), därefter J4, H, J1, G och F.
  - **Efter 5e:** bygg om på grenens topp (A-B6, I-B11, I-B12) och kör om A, I och K.
  - **Kvar av övertagandet i #840:** F113 (`20261026170000`), J2-05 och J4-D15 (`20261026190000`). A-B4 utreds när A har kört i den nya världen.
- **Batch 5 pågår (2026-10-26 från ca 20:45 UTC):** J1, H, J2, J4, F och G på `0636d475b` (med I-B4). Logg `/tmp/claude-0/batch5.log`.
  - Batch 4 gav K 10/12 (K-B4, rättad), I 3 gröna/1 röd (I-B4, rättad) och A 4/7 (A-B4, agent). J1 försvann i den tredje omstarten.
  - Diskutrymmet tog slut för agenterna. Avslutade agenters worktrees togs bort (cirka 6 GB).
- **Agenter:**
  - F113, J2-03/J2-05 och J4-D15 (övertagandet i #840);
  - A-B4: Z02 tillämpas inte på webbansökan;
  - I-B4v: personalvägar skapar byten utan avtal.
- **Därefter:** applicera agenternas migrationer, bygg om och kör om K, I och A, samt E i en egen värld med testbanan.
- **Övertagande i #840 (2026-10-26, kommentar 6423229557, ägarens mandat "du tar över allting"):** ingen hade svarat på överlämningsbegärandena. Claude tar nu över F113, J2-03/J2-05 och J4-D15, avgränsat till de exakta funktionerna, pinnarna och filerna. Ingen överlappning med MailROOT (PR #916–918). En agent per punkt; migrationerna `20261026170000`, `180000` och `190000`.
- **Andra omstarten av containern (2026-10-26, före 15:20 UTC):** F i batch 3b försvann igen. dockerd hade en inaktuell PID-fil, som togs bort. `20261026120000` (D11-G1) och `20261026130000` (J2-13) applicerades, och världen byggdes om på `355bf0e76` med alla rättningar och ägarbeslut 31–34.
- **Batch 4 pågår** (logg `/tmp/claude-0/batch4.log`), i prioritetsordning så att nya rättningar verifieras först, eftersom omstarter har dödat långa körningar: K, I, A, J1, H, J2, J4, F, G. E körs därefter i en egen värld med testbanan (T37).
- **Containern startades om under natten (ca 00:30 UTC 2026-10-26):** Docker, appen och batch 3 försvann medan F körde. F-loggen är tom. Världens data fanns kvar. 10:30 UTC startades dockerd, `20261026100000` (K-W1b) applicerades och världen byggdes om på `8e2b0b5f1`.
- **Batch 3b pågår** (logg `/tmp/claude-0/batch3b.log`): F, G, H, I, J1, J2, J4 och K. A, C, D, E, J3, stuck-detector och grid-owner-wire kördes i batch 3 före omstarten.
- **Agenterna** (beslut 32–34, C-B3, A-B3/E-B3) stoppades två gånger av kontots användningsgräns och har återupptagits.
- **Batch 3 pågår (från 2026-10-25 23:30 UTC): alla 15 scenarier** (`run-many.sh all`, banorna als och free parallellt). Världen på `6461cda9f`, ombyggd med I-B2a och F8-B1, och SVK omimporterad (K-W1 verifierad). Logg `/tmp/claude-0/batch3.log`.
- **Batch 2 avbröts medvetet efter J4** för effektivitetens skull: F och G hade kört den gamla bygget utan F8-B1. Resultat från K, I, J1 och J4 finns i FINDINGS.
- **Batch 2 pågår (2026-10-25 från 20:08 UTC):** världen på `f9a0304e0`, migrationerna `20261025100000`–`20261025130000` applicerade, `REALITY_SVK_SOURCE=simulated REALITY_SPOT_SOURCE=synthetic`, snabbläge. Ordning: K, I, J1, J4, F, G. Logg `/tmp/claude-0/batch2.log`.
- **Efter batch 2, först:** bygg om appen (I-B2a är TS).
- **Därefter:** starta om SVK-simulatorn och kör om SVK-importen (K-W1). Kontrollera att ALS pekar på registrets ägare `07473208`.
- **Efter batch 2:** rätta och dokumentera nya fel, lägg in T31 och kör D11 end-to-end i världen. Kör sedan **batch 3 = alla 15 scenarier** (`run-many.sh all`) på slutkoden som regression. A, C, D, E, H, J2, J3, stuck-detector och grid-owner-wire kördes senast på äldre kod.
- **Ägarbeslut 31–34 (2026-10-25) är under införande, en agent per beslut, i egna worktrees:**
  - 31, K-W1b: klar (`35349ad8a`), migrationen applicerad i världen.
  - 32, I-B2d: klar (`cd537bda3`), ingen SQL. Väntar på I9 i världen.
  - 33, D11-G1: klar (`3e277d534`); väntar på H11 i världen. X-LATE är falskt positivt; T38 (H11 via produktionsvägen) rättas.
  - 34, J2-13: klar (`bdad82fbf`). Migrationen appliceras före nästa J2-körning.
  - Fynden markeras lösta först när berörda scenarier är verifierade i världen.
- **Parallella agenter (egna worktrees, rör inte FINDINGS/STATUS/minne; huvudsessionen för in resultatet):**
  - Agent 1: T31 klar (`a6ebae999`), även i körworktreen, så J1 i batch 2 kör C10.
  - Agent 2: J4-D15 är kartlagd men inte ändrad, eftersom rättningen kräver guidebevis från producenten (se FINDINGS). Överlämningsbegäran postad i #840 (kommentar 6402595329).
  - Agent 3: K-W1 klar (`fc728582d`).
  - Agent 4: I klar: I-B2a och I-B2c rättade; I-B2d kräver ägarbeslut.
  - Agent 5: D11 H10/H11 klar (`cbcb67c77`). Agent 7: D11-G2 klar (`b810130c1`); H körs om efter batch 2. D11-G1 kräver ägarbeslut.
  - Agent 6: F8-B1 är ett eget produktfel och rättat. Klara underlag vägrades alltid, eftersom den lagrade prissnapshoten var berikad.
  - Ingen agent kör världen (en körning i taget); de läser databasen endast.
- **Ägarbeslut 27–30 (2026-10-25) är införda och kopplade till fynden:**
  - GOR-06 rättad (`a9235d75c`).
  - D11 brytavgift del 1 och 2 (`dcf178642`, `d6fed0758`).
  - SEP-01 separata tjänster (`a127fae20`).
  - F113 överlämningspaket (`e64639cac`), fortfarande ÖPPEN.
- **Batch 1** på `9a6fc2a3d`: J3 grön, H 9/9, I och J1 röda (T30, rättad efter start; T31 öppen). J2, J4, K och F lästa (se FINDINGS). F: 7/12, röda följer av T26/T27; F8 bedöms i batch 2.
- **Nya migrationer att applicera i världen före batch 2:** `20261025100000` (GOR-06), `20261025110000` och `20261025120000` (D11), `20261025130000` (SEP-01). Appen byggs om (TS för GOR-06 och D11).
- **Nästa steg:**
  1. Läs J2, J4, K och F i batch 1.
  2. Applicera migrationerna, bygg om, och kör batch 2 med `REALITY_SVK_SOURCE=simulated REALITY_SPOT_SOURCE=synthetic`: I, J1, F och G, samt D11 end-to-end i världen.
- **Underagenter:** veckokvoten för den tidigare sessionen gällde till 2026-10-29; i denna session har två gaffelagenter använts.

## Scenarier
| Scenario | Senaste körning | Resultat | Kvar |
|---|---|---|---|
| A–E | tidigare omgångar | gröna och rättade | — |
| F (faktura) | 32: 6/12 gröna (F2 miljö T26; F6c = G-9 felklassning, rättad; F7 T27) | F116, F117 och T21 rättade efter körning 29; G-6 och G-6b behövs för F8 | Kör om när G-8 är klart |
| G (vintertid) | 3: 9/11 gröna (G9/G10 syntetisk spot, T28) | G-4, G-5, G-6 och G-6b rättade efter körningen | Kör om |
| H (kunden lämnar) | batch 1: **9/9 gröna** | H-9–H-17, T23, T25, T29 och ägarbeslut 26 verifierade | — |
| J3 (robusthet) | batch 1: 6 gröna, 1 överhoppad | — | — |
| I (nätägaren avvisar) | batch 2: 1 grön, 3 röda, 6 överhoppade | I-B2a (produkt) och I-B2c (harness) rättade; I-B2b = K-W1; I-B2d behöver beslut | Kör om |
| J2 | batch 1: 8 gröna, 5 röda | bara kända J2-03/J2-05 (låsta) och J2-13 (beslut) | — |
| J4 | batch 2: **7 gröna, 1 överhoppad** | T26 kringgången, T32 verifierad; J4-D15 öppen (#840) | — |
| K | batch 2: 10/12 gröna | K10/K11 verifierade; K4/K8 = K-W1 rättad (simulatorns ägarnamn); K-W1b behöver beslut | Kör om efter SVK-omimport |
| J1 | batch 2: 1 grön, 2 röda (I-B2c/I-B2a, före rättning) | T30, T31, I-B2a och I-B2c rättade | Kör om |

## Rättat i denna omgång (commit → fynd)
| Commit | Fynd |
|---|---|
| `1553394ff` | H3: slutfakturan efter Z05 |
| `7233c3ed7` | F114: nätområdet slås upp via registret |
| `de499f3cc` | F114, kritisk: godkännande nedgraderar inte kunden |
| `14db39369` | P8: utkorgen töms i omgångar |
| `c2f6aba56` | F115: go-live kräver fakturaleverantör |
| `f732be9f9` | H3b: slutmånaden vid manuell flytt |
| `fa0523d04` | H3c: Ediel-start och manuellt slut |
| `1607639fa` | O2: hållna UTILTS tas upp automatiskt |
| `6645ca3ca` | H3d del 1: fasta avgifter per dag, avgiftsgranskning |
| `dec74e8ef` | H3d del 2: uppsägningstid, uppsägning utan flytt, D8 |
| `bfa264d07` | F116, F117, T21 och B5/B6 |
| `b38ccb00a` | G-1: tidsgräns för inbound-cron |
| `b9429ff11` | G-3: provisioneringsjobben |
| `d547cedcd` | G-2: validering ~30 % snabbare |
| `f3a1f377e` | G-4 och G-5: fullständighet i Ediel-månaden, felmeddelande |
| `392e99ae8` | G-6: läsning av källor 469 s → 28 s |
| `dfcc2778f` | G-6b: lagring av underlag 82 s → 6 s per mätpunktsmånad |
| `960335aa7` | T20: snabbläge i harnessen |
| `df5d74e0c` | H-9: Z05 LK sparas |
| `a8b30baa9` | H-10: Z03C, ånger och Z08 hittar nätägarens route |
| `7331fa0f8` | G-8: de rena kontrollerna i `stored_contract_v1` körs en gång per innehåll och regeluppsättning |
| `ce8f5320b` | H-12: ånger stoppar ett skickat byte (`prepared`); T23: harnessens avtal får erbjudandets bindningstid |
| `668492059` | H-13: nätägarens Z05 LK utan vår stängning behåller periodens debiteringsgrund |

Alla migrationer är applicerade i världen och har sha256 i `scripts/migration-history-manifest.additions.json`. GEN-ägaren behöver fånga om `schema.sql`.

## Öppet, i prioritetsordning
1. **Batch 1** (J1, J2, J4, K, F) pågår; därefter körs I om (T30) och en batch 2 med `REALITY_SVK_SOURCE=simulated REALITY_SPOT_SOURCE=synthetic` (F2, G9/G10, I:s Z01-väg).
2. **Kräver ägarbeslut (inte rättbart utan beslut):**
   - H3d D11: hur en granskad brytavgift debiteras (separat underlag eller faktura).
   - Markör för separat avtalade tjänster (beslut 20).
   - GOR-06: ska dispatchvakten skilja nytt utskick från redan kvitterat?
   - F113: överlämning från kroppsägarna (DB-05/SC-031).
3. **GEN-ägaren** behöver fånga om `schema.sql` (G-6, G-6b, G-8, H-13, H-17).
4. **Fel som fanns före ändringarna:** `ediel-inbound-tenant-resolution`, `gridex-manual-grid-owner-information-request`, `gridex-shared-mailbox-tenant-resolution`, `canonical-production-hardening`, `db:types:check`; SQL-regressionerna `ediel-bilateral-prodat-closure`, `-owned-end` och `ediel-closure-continuity`; `gridex-actor-registry-intake-hardening-regression.cjs` och `gridex-customer-legal-package-regression.cjs`; `manual-mail-*` (`xlsx` saknas i containern).

## Så körs världen
1. Bygg om på HEAD:
   ```
   cd /home/user/gx-wt-run && git checkout -q --detach <HEAD>
   SKIP_REPLAY=1 bash scripts/reality/up.sh
   ```
2. Kör ett scenario fristående. Använd inte ett bakgrundskommando med gräns på 2 h (T22):
   ```
   setsid nohup bash -c 'GRIDEX_REALITY_TICK_MS=3000 bash scripts/reality/run.sh scripts/reality/chain-h-customer-leaves.test.ts > <logg> 2>&1; echo "exit $?" >> <logg>' &
   ```
3. Kör scenario F med:
   ```
   GRIDEX_REALITY_F6C_MODE=cron GRIDEX_REALITY_F6C_PAGES=2
   ```
4. Kontrollera alltid med täckningskontrollen **utan** att ladda `app.env`:
   ```
   npm run -s ediel:masterplan-v2:test-coverage -- --check
   ```
   Den måste ge `tagged failing 0`. I en grund klon fallerar DB-01, så kör `git fetch --unshallow origin` först.
5. Uppsättning i ny container (2026-10-24):
   - `git fetch --unshallow origin`.
   - `public.ecr.aws` ger 403 på bildlagren. Hämta Supabase-bilderna från Docker Hub i stället: wrappern `/usr/local/bin/supabase` exporterar `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` och kör `npx -y supabase@2.101.0`. Docker Hub kan ge 429; försök igen.
   - Edge runtime startar inte (rlimit), men replayen utesluter den.
   - `npm ci` nekas på cdn.sheetjs.com. Installera utan `xlsx` och återställ `package.json`/`package-lock.json`. I `gx-wt-run` behöver `next build` paketet: `npm install --no-save xlsx@0.18.5` (bara lokalt).
   - `gx-wt-run` måste ha en riktig kopia av `node_modules`, inte en symlänk (Turbopack vägrar).
6. Nekade externa värdar (T26): `REALITY_SVK_SOURCE=simulated REALITY_SPOT_SOURCE=synthetic bash scripts/reality/up.sh`. Ger SVK-simulatorn (hosts plus lokal TLS) och syntetiska spotpriser med verklig publiceringsregel.
7. Efter en omstart av containern:
   ```
   rm -f /var/run/docker.pid; nohup dockerd &
   iptables -t nat -A OUTPUT -p tcp -d 127.0.0.1 --dport 54322 -j REDIRECT --to-ports 55322
   docker rm -f gx-mail
   ```
   Kör sedan `up.sh`.
