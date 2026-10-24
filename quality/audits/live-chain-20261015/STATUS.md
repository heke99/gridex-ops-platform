# Verklighetssimuleringen — läge och nästa steg

Uppdaterad 2026-10-24 av Claude (gren `claude/gifted-hamilton-vss1hj`). Filen är tänkt att läsas först.

Den hör ihop med tre andra dokument:
- [FINDINGS.md](FINDINGS.md): alla fynd. Inget tas bort därifrån.
- [OWNER-DECISIONS.md](OWNER-DECISIONS.md): ägarens beslut, 25 st, och öppna frågor.
- #840: anspråk och leveranser per fil.

## Var jag är nu
- **Scenario H, körning 1** gav 4 av 9 gröna. H-9 (Z05 LK sparades aldrig) är rättat i `df5d74e0c`, men H är inte omkört.
- **Nästa steg:**
  1. Utred H-10: ångerrätt och annullering (Z03C) hittar ingen `communication_route` för `supplier_switch`.
  2. Bygg om världen på HEAD och kör H igen.
- **Underagenter:** veckokvoten är slut till 2026-10-29 04:00 UTC. Arbetet sker utan agenter tills dess.

## Scenarier
| Scenario | Senaste körning | Resultat | Kvar |
|---|---|---|---|
| A–E | tidigare omgångar | gröna och rättade | — |
| F (faktura) | 29: 8/12 gröna; 30: avbruten efter 2 h (T22) | F116, F117 och T21 rättade efter körning 29; G-6 och G-6b behövs för F8 | Kör om när G-8 är klart |
| G (vintertid) | 2: 8/11 gröna | G-4, G-5, G-6 och G-6b rättade efter körningen | Kör om |
| H (kunden lämnar) | 1: 4/9 gröna | H-9 rättad, H-10 öppen | Kör om |
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

Alla migrationer är applicerade i världen och har sha256 i `scripts/migration-history-manifest.additions.json`. GEN-ägaren behöver fånga om `schema.sql`.

## Öppet, i prioritetsordning
1. **G-8 (hög, prestanda):** en mätvärdesfil tar 2–3 min att lagra, eftersom `stored_contract_v1` körs per värde i consume och gate. Förslag: batcha per fil som i G-6. Agentarbetet avbröts på grund av kvoten.
2. **H-10 (hög):** route för annullering och ångerrätt, se ovan.
3. **H-11 (medel):** 17 Z05 med orsak Z23 bär L-profilen.
4. **G-7, världen:** gamla provisioneringsjobb i världen. Töm dem före scenariot.
5. **H3d, öppna punkter:** UI för uppsägningsdagar, debitering av brytavgift (D11), markör för separata tjänster, avtalskortets slutdatum.
6. **F113:** objektbatchen är skyddad och väntar på överlämning från kroppsägarna.
7. **Fel som fanns före ändringarna:** `ediel-inbound-tenant-resolution`, `gridex-manual-grid-owner-information-request`, `gridex-shared-mailbox-tenant-resolution`, `canonical-production-hardening`, `db:types:check`.

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
   Den måste ge `tagged failing 0`.
5. Efter en omstart av containern:
   ```
   rm -f /var/run/docker.pid; nohup dockerd &
   iptables -t nat -A OUTPUT -p tcp -d 127.0.0.1 --dport 54322 -j REDIRECT --to-ports 55322
   docker rm -f gx-mail
   ```
   Kör sedan `up.sh`.
