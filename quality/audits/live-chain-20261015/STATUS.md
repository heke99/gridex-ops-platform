# Verklighetssimuleringen — läge och nästa steg

Uppdaterad 2026-10-24 kl. 20:50 UTC av Claude (session 01YCH5Va…), som fortsätter på grenen `claude/gifted-hamilton-vss1hj` på ägarens uppdrag. Filen är tänkt att läsas först.

Den hör ihop med tre andra dokument:
- [FINDINGS.md](FINDINGS.md): alla fynd. Inget tas bort därifrån.
- [OWNER-DECISIONS.md](OWNER-DECISIONS.md): ägarens beslut, 25 st, och öppna frågor.
- #840: anspråk och leveranser per fil.

## Var jag är nu
- **Batch 2 pågår (2026-10-25 från 20:08 UTC):** världen på `f9a0304e0`, migrationerna `20261025100000`–`20261025130000` applicerade, `REALITY_SVK_SOURCE=simulated REALITY_SPOT_SOURCE=synthetic`, snabbläge. Ordning: K, I, J1, J4, F, G. Logg `/tmp/claude-0/batch2.log`.
- **Efter batch 2, först:** bygg om appen (I-B2a är TS).
- **Därefter:** starta om SVK-simulatorn och kör om SVK-importen (K-W1). Kontrollera att ALS pekar på registrets ägare `07473208`.
- **Efter batch 2:** rätta och dokumentera nya fel, lägg in T31 och kör D11 end-to-end i världen. Kör sedan **batch 3 = alla 15 scenarier** (`run-many.sh all`) på slutkoden som regression. A, C, D, E, H, J2, J3, stuck-detector och grid-owner-wire kördes senast på äldre kod.
- **Parallella agenter (egna worktrees, rör inte FINDINGS/STATUS/minne; huvudsessionen för in resultatet):**
  - Agent 1: T31 klar (`a6ebae999`), även i körworktreen, så J1 i batch 2 kör C10.
  - Agent 2: J4-D15 är kartlagd men inte ändrad, eftersom rättningen kräver guidebevis från producenten (se FINDINGS). Överlämningsbegäran postad i #840 (kommentar 6402595329).
  - Agent 3: K-W1 klar (`fc728582d`).
  - Agent 4: I klar: I-B2a och I-B2c rättade; I-B2d kräver ägarbeslut.
  - Agent 5: D11 H10/H11 klar (`cbcb67c77`). Agent 7: D11-G2, fastprisavtal i harnessen, pågår. D11-G1 kräver ägarbeslut.
  - Agent 6: F8 `billing_underlay_supply_contract_price_basis_required`, följdfel eller eget fel, pågår.
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
| J4 | batch 1: 5 gröna, 2 röda | J4-0 T26; J4-4 T32 rättad, J4-D15 öppen | Kör om |
| K | batch 2: 10/12 gröna | K10/K11 verifierade; K4/K8 = K-W1 rättad (simulatorns ägarnamn); K-W1b behöver beslut | Kör om efter SVK-omimport |
| J1 | batch 1: 1 grön, 3 röda | T30 och T31 rättade | Kör om |

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
