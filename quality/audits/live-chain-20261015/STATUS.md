# Verklighetssimuleringen — läge och nästa steg

Uppdaterad 2026-10-24 kl. 20:50 UTC av Claude (session 01YCH5Va…), som fortsätter på grenen `claude/gifted-hamilton-vss1hj` på ägarens uppdrag. Filen är tänkt att läsas först.

Den hör ihop med tre andra dokument:
- [FINDINGS.md](FINDINGS.md): alla fynd. Inget tas bort därifrån.
- [OWNER-DECISIONS.md](OWNER-DECISIONS.md): ägarens beslut, 25 st, och öppna frågor.
- #840: anspråk och leveranser per fil.

## Var jag är nu
- **Världen går att bygga igen** (2026-10-24 ca 19:40 UTC), se "Uppsättning i ny container" nedan.
- **H körning 2** (världen på `7331fa0f8`): 4 av 9 gröna. H-9 och H-10 (för C) är verifierade i världen. Nya fynd: H-12, H-13 och T23, alla rättade. H-11 är utrett och går inte att reproducera.
- **G-8 rättad** i `7331fa0f8` (SQL). Tiden per fil är ännu inte mätt i världen.
- **H körning 3** pågår på `668492059`, med G-8 och H-13 applicerade i världen. Den ska verifiera H-12, H-13 och T23.
- **Nästa steg:**
  1. Läs H körning 3 (`/tmp/gridex-reality/report-h3.json`, logg `/tmp/claude-0/h3.log`). Rätta det som återstår.
  2. Kör om F (mät G-8 per fil) och G.
  3. Därefter I, J1–J4 och K.
- **Underagenter:** veckokvoten är slut till 2026-10-29 04:00 UTC. Arbetet sker utan agenter tills dess.

## Scenarier
| Scenario | Senaste körning | Resultat | Kvar |
|---|---|---|---|
| A–E | tidigare omgångar | gröna och rättade | — |
| F (faktura) | 29: 8/12 gröna; 30: avbruten efter 2 h (T22) | F116, F117 och T21 rättade efter körning 29; G-6 och G-6b behövs för F8 | Kör om när G-8 är klart |
| G (vintertid) | 2: 8/11 gröna | G-4, G-5, G-6 och G-6b rättade efter körningen | Kör om |
| H (kunden lämnar) | 6: 7/9 gröna | H-9, H-10, H-12–H-14, H-16, H-17, T23 verifierade; T25 rättad | H6 väntar på ägarbeslut; kör om för T25 |
| I, J1–J4, K | ej körda i denna omgång | — | Kör efter H |

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
1. **H körning 3:** verifiera H-12, H-13 och T23 samt H4–H8.
2. **G-8:** mätt till cirka 18 s per fil (från 2–3 min). F6c tar ändå över 2 h för 120 filer; utred cronens takt om det behövs.
3. **G-7, världen:** gamla provisioneringsjobb i världen. Töm dem före scenariot.
4. **H3d, öppna punkter:** UI för uppsägningsdagar, debitering av brytavgift (D11), markör för separata tjänster, avtalskortets slutdatum.
5. **F113:** objektbatchen är skyddad och väntar på överlämning från kroppsägarna.
6. **GEN-ägaren** behöver fånga om `schema.sql` (G-6, G-6b, G-8, H-13 m.fl.).
7. **Fel som fanns före ändringarna:** `ediel-inbound-tenant-resolution`, `gridex-manual-grid-owner-information-request`, `gridex-shared-mailbox-tenant-resolution`, `canonical-production-hardening`, `db:types:check`, och SQL-regressionerna `ediel-bilateral-prodat-closure`, `-owned-end` och `ediel-closure-continuity`. I denna container faller också `manual-mail-*` (4 tester) eftersom `xlsx` saknas.

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
6. Efter en omstart av containern:
   ```
   rm -f /var/run/docker.pid; nohup dockerd &
   iptables -t nat -A OUTPUT -p tcp -d 127.0.0.1 --dport 54322 -j REDIRECT --to-ports 55322
   docker rm -f gx-mail
   ```
   Kör sedan `up.sh`.
