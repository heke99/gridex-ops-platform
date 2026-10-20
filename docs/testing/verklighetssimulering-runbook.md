# Verklighetssimulering – runbook för agenter (Claude, Codex m.fl.)

Hur Gridex OPS körs "som i drift" lokalt: riktig app, riktig databas, riktiga cron-jobb, riktiga
admin-sidor och motparter som egna processer över riktiga protokoll. Planen och nivåerna R0–R4
beskrivs i [verklighetssimulering-plan.md](verklighetssimulering-plan.md). Fynden förs i
[FINDINGS.md](../../quality/audits/live-chain-20261015/FINDINGS.md).

## 1. Vad "riktig simulering" betyder här

- **Riktigt:**
  - appen: `next build` och `next start`, inte dev-läge
  - databasen: ren replay av hela migrationshistoriken
  - cron-jobben: anropas med samma kadens som i `vercel.json`
  - admin-sidorna: körs av en riktig inloggad operatör i Playwright
  - det publika API:t: webbplatsens anrop med en API-nyckel
- **Simulerat:** bara det som ligger utanför plattformen. Det är motparter och tredjeparter, som alla är egna processer över riktiga protokoll:
  - **Nätägaren** tar emot och skickar EDIFACT via e-post (SMTPS/IMAPS).
  - **Webbplatsen och kunderna** använder HTTP mot det publika API:t.
  - **Spotpriser, Resend, papapi och Lantmäteriet** är HTTP-tjänster.
  - **Ediels certifikatkatalog (Expisoft)** nås över LDAP.
- **Ingen genväg:** testet skriver aldrig direkt i databasen för att få ett flöde att gå vidare. Det finns två undantag, och båda märks i koden med fyndnummer:
  - **Paritetssteg:** objekt som finns i drift men saknas i replayen (F24, F28).
  - **Stand-in för steg som saknar stöd i appen:** F36 och F37. Se avsnitt 7.
- **Data:**
  - **Riktiga referensdata:** Ediels registret (`__tests__/fixtures/ediel-actor-registry/companies.xml`), SVK:s nätområden, spotpriser och postnummerkoordinater.
  - **Sanering:** alla e-postadresser skrivs om till `example.invalid`.
  - **Personer:** syntetiska, med giltiga personnummer (Luhn).

## 2. Regler som alltid gäller

- **Bara lokalt.**
  - `sql()` och `up.sh` vägrar köra mot något annat än `127.0.0.1:54321`.
  - Mot drift och staging är bara läsfrågor på metadata och aggregat tillåtna.
  - Vercel-miljövariabler får bara läsas som namn, aldrig dekrypteras.
- **Inga riktiga adresser och inga riktiga hemligheter** i kod, loggar eller FINDINGS.
- **Reservera innan du skriver.**
  - Gör en CLAIM med exakta filer på det aktiva koordinationsissuet (nu #840), enligt AGENTS.md och `.agent-memory/masterplan-reservations.md`.
  - En skrivare per fil.
  - Rätta inte i en annan ägares scope. Dokumentera i stället.
- **GEN-filerna** (`supabase/schema.sql`, `database.types.ts`, manifesten) hanteras bara av GEN-ägaren.
- **Spärrar:** försvaga aldrig tenant-, RLS-, behörighets- eller produktionsspärrar för att få ett scenario grönt. En spärr som stoppar flödet är ett fynd.
- **Pusha** bara till den egna grenen. Ingen PR om användaren inte ber om det.

## 3. Förutsättningar

- **Verktyg:** Docker, Supabase CLI, Node 22 med `npm ci` gjort, `psql`, `openssl`, `fuser` och Playwright Chromium. I molnmiljön ligger Chromium i `/opt/pw-browsers/chromium`.
- **Disk:** cirka 10 GB fritt, för replay och build.
- **Portar som måste vara lediga:**

  | Port | Används av |
  |---|---|
  | 54321–54324 | Supabase |
  | 3025, 3143, 3465, 3993, 8080 | GreenMail |
  | 3100 | appen |
  | 3901 | extern värld |
  | 3389, 3902 | certifikatkatalogen |
  | slumpad | nätägarsimulatorn |

## 4. Starta världen

```bash
bash scripts/reality/up.sh            # allt från noll (replay tar flera minuter)
SKIP_REPLAY=1 bash scripts/reality/up.sh   # återanvänd körande databas
SKIP_REPLAY=1 SKIP_BUILD=1 bash scripts/reality/up.sh   # bara omstart av app och simulatorer
bash scripts/reality/down.sh          # stoppa allt
```

`up.sh` gör följande i tur och ordning:

1. Skapar en lokal CA och startar GreenMail med TLS (SMTPS 3465, IMAPS 3993). Om en HTTPS-proxy-CA finns slås den ihop med den lokala CA:n (`combined-ca.pem`), så att utgående HTTPS fortsätter att fungera i sandlådan.
2. Kör ren replay (`scripts/gridex-aud-003-clean-replay.sh`) och låter stacken leva vidare. Replayskriptet stoppar annars stacken i sin EXIT-trap.
3. Skriver `$REALITY_HOME/app.env`, som standard i `/tmp/gridex-reality`. Nycklarna kommer från `supabase status`, hemligheterna slumpas per värld, och alla tredjeparts-URL:er pekar på simulatorerna.
4. Skapar automationsanvändaren via Auth-API:t. En rå `INSERT` i `auth.users` syns inte för GoTrue.
5. Kör `next build` och `next start` på 127.0.0.1:3100.
6. Startar simulatorerna i egna sessioner, så att en testkörning aldrig kan döda dem.

## 5. Köra scenarier

```bash
bash scripts/reality/run.sh                                                  # alla scenarier
bash scripts/reality/run.sh scripts/reality/chain-a-website-switch.test.ts         # ett scenario
bash scripts/reality/run.sh scripts/reality/chain-a-website-switch.test.ts -t A1   # ett steg
```

- **Rapport:** `$REALITY_HOME/report.json`. Den skrivs löpande under långa steg, till exempel cron-loopen i A3, så du kan följa förloppet medan det körs.
- **Rensa inte databasen mellan körningar.**
  - Varje körning skapar ett nytt bolag och nya e-postadresser (`RUN`-suffix).
  - Gamla bolag ligger kvar och ger realistisk volym, men de påverkar också kostnadsmätningar (fynd S1).
- **Loggar** ligger i `$REALITY_HOME/logs/`: `next-start.log` för serverfel och `world.log` och `ldap.log` för simulatorerna. Kongs logg (`docker logs supabase_kong_gridex-ops-platform`) visar varje databasanrop. Den används för att räkna anrop, hitta N+1 och se 4xx/5xx.
- **Stuck-detektorn** (`scripts/helpers/reality/stuckDetector.ts`) körs som sista steg i varje scenario.
  - Den listar allt som ligger fast i köer, outboxar och jobb för scenariots bolag.
  - Den skiljer `stuck` (systemfel) från `needs_operator` (väntar avsiktligt på en människa).

## 6. Simulatorer och deras kontroll-API

- **Extern värld** (`scripts/reality/simulators/externalWorld.ts`, port 3901)
  - **Spotpriser** (`/api/v1/prices/...`): riktiga priser, cachade i `.reality-cache/spot`, eller en syntetisk kurva med `REALITY_SPOT_SOURCE=synthetic`.
  - **Resend:** `/emails`, `/emails/batch` och `/domains`. Skickade mejl syns i `GET /__sim/state`.
  - **papapi:** `/papapi/lite/?query=`. Postnummerkoordinater registreras med `POST /__sim/geocode {postal_code, latitude, longitude}`.
  - **Lantmäteriet** (Basic auth krävs): `/lantmateriet/...`. Exakta adresser i SWEREF99 TM registreras med `POST /__sim/address {street, number, postalCode, city, x, y}`.
  - **Fel:** `POST /__sim/fault {service: spot|resend|papapi|lantmateriet, mode: ok|rate_limited|server_error|slow|hang|invalid_json, ms?, count?}`.
- **Ediels certifikatkatalog** (`scripts/reality/simulators/certificateDirectory.ts`, LDAP 3389, kontroll 3902)
  - **Aktör:** `POST /__sim/actor {edielId, name, email, reissue?}` utfärdar ett S/MIME-certifikat från den lokala test-CA:n och publicerar det i katalogen. Samma aktör behåller sitt certifikat tills `reissue: true` skickas.
  - **Tillitsmaterial:** `GET /__sim/trust/<EdielId>` ger CA, aktuell CRL och fingeravtryck för tillitsversionen (F37).
  - **Fel:** `POST /__sim/fault {mode: ok|hang|drop|empty, count?}`.
- **Nätägaren** (`scripts/reality/simulators/gridOwner.ts`, startas av testet via `startGridOwner()`)
  - Pollar sin IMAPS-brevlåda och svarar på varje Z03 med CONTRL, sedan APERAK (positiv eller negativ) och sist Z04, med valbara fördröjningar.
  - **Kontroll:** `/__sim/state`, `/__sim/profile {contrlDelayMs, aperakDelayMs, z04DelayMs, rejectShare, duplicateShare}` och `/__sim/send-e66`.
- **Webbplatskund** (`scripts/reality/simulators/websiteCustomer.ts`): `applyAsWebsiteCustomer()` gör samma API-sekvens som en riktig webbplats:
  1. `public-contracts`
  2. `energy-area/resolve`
  3. `quote` med Idempotency-Key
  4. `legal-bundle`
  5. `customer-applications`

## 7. Operatörssteg och märkta stand-ins (scenario A1, i denna ordning)

Operatören kör stegen i det riktiga admin-gränssnittet (`scripts/helpers/reality/operatorConsole.ts`):

1. `importActorRegistry`: `/admin/ediel/actors`, ladda upp det sanerade registret och skriv IMPORTERA.
2. `verifyActorForCustomerFlow`: sök på nätägarens namn och tryck "Verifiera för kundflöde". Sökningen matchar inte Ediel-ID (F31).
3. `searchGridOwnerCertificate`: `/admin/network-owners?edit=<id>`, "Sök certifikat nu för vald nätägare". Uppslaget går via LDAP-simulatorn.
4. `confirmSafeBlankSubaddresses`: `/admin/ediel/auto-readiness`, "Bekräfta säkra routes".
5. `checkGridOwners`: `/admin/network-owners`, "Kontrollera nätägare". Kopplar SVK-nätområdet till OPS-nätägaren.
6. **Stand-in F36:** `simulateEdielCertifiedGoLive`. Ediel-certifiering och godkännande av första produktionssändningen saknar stöd i appen.
7. **Stand-in F37:** `publishReceiverCertificateTrust`. Tillitsversionen kan bara publiceras av den externa ägarrollen.
8. `createProductionRoutesFromWizard`: `/admin/platform/go-live/<id>/route-wizard`.
9. `materializeTenantRoutes`: `/admin/ediel/route-readiness`, "Materialisera production-route".
10. `approveTenantRouteProfiles`: anropar samma funktion som server-åtgärden. Ingen sida renderar knappen (F37).
11. `goLiveOnWebsite`: publicera avtalet och skapa webbplatsintegrationen med API-nyckel.

Regler för klick och stand-ins:

- **Server-åtgärder:** vänta alltid på åtgärdens eget svar med `submitServerAction`. En `networkidle`-väntan på en sida som redan är tyst släpper direkt, och då stängs sidan innan POST-anropet ens har gått iväg.
- **När en stand-in är tillåten:** bara när det verkligen saknas en stödd väg och det finns ett dokumenterat fynd. Stand-in:en sätter exakt det tillstånd som det saknade steget hade lämnat. Den märks i koden med fyndnumret och tas bort när appen får en riktig väg.

## 8. Skriva ett nytt scenario

- **Fil och tagg:** filen ligger i `scripts/reality/<namn>.test.ts`. Tagga den med de masterplan-ID den rör, om några.
- **Ordning:** återanvänd `configureTenant`, `operatorSession` och simulatorerna. Låt sedan cron-loopen (`runOperationalCronSlot`) driva världen i stället för att anropa interna funktioner.
- **Assertions:** kontrollera affärsutfall, till exempel status på leveransperioder, vad nätägaren tog emot och vilka kundmejl som skickades. Implementationsdetaljer räcker inte.
- **Avslut:** kör alltid stuck-detektorn för scenariots bolag.
- **Rapport:** skriv allt observerat till rapporten, även när ett steg fallerar.
- **Långa steg:** sätt egen timeout per steg. Konfigurationens standard är 900 s, och A3 har 40 minuter.

## 9. När något fallerar: fyndprotokoll

1. **Reproducera** med `run.sh … -t <steg>`. Läs `next-start.log`, Kongs logg och `audit_logs`, där många admin-åtgärder lämnar `technicalMessage`.
2. **Hitta rotorsaken i koden.** Tyst kod (`catch → null`) döljer ofta det riktiga felet. Kör ett probe-test i `scripts/reality/zz-probe.test.ts`, med samma konfiguration, och ta bort det efteråt.
3. **Verifiera fyndet** (fp-check). Är det ett verkligt fel, en avsiktlig spärr eller en artefakt i testet? Kontrollera migrationstexter, `.agent-memory/decisions.md` och, för volymer, drift med läsfrågor.
4. **Dokumentera** i FINDINGS: id, status, var (fil:rad), varför det är fel, följd, bevis och rättning eller förslag.
5. **Rätta** bara om scope är ledigt:
   1. CLAIM på #840.
   2. Ett test som anropar koden och fallerar utan rättningen. Kontrollera det med `git stash` på rättningen.
   3. Minimal rättning.
   4. Riktade tester och eventuella masterplan-märkta tester. Kör `eslint` och `tsc --noEmit`.
   5. Commit och push.
6. **Verifiera rättningen i världen:** `SKIP_REPLAY=1 bash scripts/reality/up.sh` bygger om appen. Kör sedan om scenariot.
7. **Ägarbeslut:** om rättningen kräver ett produktbeslut, sammanfatta det på #840 och ändra inget.

## 10. Kända fallgropar

| Symtom | Orsak | Åtgärd |
|---|---|---|
| Admin-sidan visar "Adminvyn kunde inte laddas" | Serverfel. Se `next-start.log`. Tidigare orsaker: N+1 som tömde Kong (F29) och URL för lång (F34). | Läs loggen. Räkna anrop i Kong. |
| Klicket gör ingenting | Sidan stängdes innan server-åtgärden skickades. | `submitServerAction` |
| Ett formulärfält läses långsamt (30 s) | En Playwright-locator väntar på ett fält som inte finns. | `form.evaluate(...)` |
| Vitest anropar en mock utan argument | `beforeEach(() => mock.mockReset())` returnerar mocken, som körs som cleanup. | Använd klamrar: `beforeEach(() => { … })` |
| `pkill -f` dödar det egna skalet | Mönstret matchar kommandoraden. | `fuser -k <port>/tcp` |
| Appen litar inte på e-postservern | GreenMail kör med en annan CA. | `up.sh` startar om containern på världens CA. |
| Automationsanvändaren är "inte redo" | Rå `INSERT` i `auth.users`. | Auth-admin-API:t, som i `up.sh` |
| Replayen stoppar stacken | Replayskriptets EXIT-trap | `up.sh` steg 2 |
| `owned_native_status_required` | `GRIDEX_NATIVE_STATUS` saknas. | Kör via `run.sh`. |

## 11. Status och nästa steg

- **Klart:**
  - Scenario A går igenom A1 och A2 med riktiga operatörssteg, webbplats-API och kundkonton.
  - Rättat med test: F19, F20, F23, F25, F26 (texten), F27 (slug), F29, F34, F38, F39 och F40.
- **Blockerat, väntar på ägarbeslut:**
  - **F41:** de två route-modellerna utesluter varandra. Ingen Z01 kan skapas för ett nytt bolag. Se avsnitt 12.
  - **F36 och F37:** produktionsgrindar utan stödd väg. Stand-ins finns i simuleringen.
- **Nästa scenarier (oberoende av F41), i prioritetsordning:**
  1. **API:** rate limit per API-klient, idempotens (samma nyckel ger samma svar, en ny nyckel ger en ny ansökan) och försök att läsa ett annat bolags data med egen nyckel, som ska ge 404 eller 403.
  2. **Fel hos tredjepart:** spot, papapi och Lantmäteriet med `hang`, `server_error` och `rate_limited`. Assertera tidsgränser, felkoder till webbplatsen och att inget fastnar.
  3. **E-post:** SMTP som hänger (H1) och inkorgens kapacitet (H2: 25 per brevlåda och körning, cirka 7 200 per dygn).
  4. **Avbruten cron** mitt i en körning: leasar släpps och inget dubbelbehandlas.
  5. **Två bolag samtidigt** mot samma nätägare: ingen data i fel bolag.
  6. **Efter F41:**
     - A3–A5: Z01/Z03 mot nätägarsimulatorn, CONTRL, APERAK och Z04, leveransperioder och inflyttning samma dag.
     - Kedja B: mätvärden, debitering och faktura.

## 12. F41: rekommenderad modell (ägarbeslut)

**Rekommendation:** routes per nätägare, materialiserade från Ediels register, är den enda modellen. Mottagaren väljs dynamiskt genom att kundens nätägare pekar ut sin materialiserade route.

**Varför:**

- **Dokumentationen beskriver redan den modellen** för produktion.
  - `docs/agt-production-separation.md` och `docs/electricity-company-onboarding-production-readiness.md` säger: routes materialiseras från plattformens aktörsregister per bolag och meddelandefamilj, och beredskapen kontrolleras per route.
  - `docs/masterdata-production-checklist.md` kräver materialiserade och produktionsklara profiler.
- **De godkända reglerna kräver uppgifter per mottagare.**
  - IMP-02: bevara familj, subadress och transport från registret.
  - IMP-05: säkerhetsidentitet och registrerad adress verifieras tillsammans.
  - TR-06: certifikatet kontrolleras mot den verkliga tekniska och juridiska routen.
  - SC-058 och SC-059 gäller SMTP-isolering per marknad och registrerad subadress.
  - En mall utan mottagare kan inte uppfylla dessa i förväg.
- **Allt Ediel kräver hör till en viss mottagare.** Det gäller adress, subadress, applikationsreferens (registret anger till exempel `23-DDQ-PRODAT`, men guiden hårdkodar `PRODAT`), S/MIME-certifikat och tillitsversionen med CA och spärrlista (F37). Den dynamiska upplösaren ger bara nätägarens ID.
- **Fel syns i förväg.** Med routes per nätägare ser operatören varje motpart som klar eller blockerad på route-beredskapen innan en kund väntar. Med mallen syns felen först när ett meddelande skickas i produktion.

**Ändringar, som små PR:er:**

1. `lib/ediel/customerInfoEnvironmentResolver.ts`: miljövalet bygger på avsändarinställningen plus att bolaget har en operativ, materialiserad route till kundens verifierade nätägare. En materialiserad nätägarprofil ska alltså räknas som kandidat.
2. `app/admin/platform/go-live/[companyId]/route-wizard/actions.ts`: guiden slutar ersätta profiler den inte själv har skapat. Knappen bör i stället materialisera routes för alla verifierade nätägare. Den funktionen finns redan som `bulkMaterializeOperationalRoutesAction`, och det minskar också operatörsstegen i F32.
3. `platform_go_live_readiness_v` (`has_prodat_route`, `has_utilts_route`): kravet för att publicera avtal ska uppfyllas av avsändaruppsättningen plus materialiserade routes, inte av en mallprofil. Det är en migration, så GEN-ägaren behöver ta fram schema och typer.
4. **Sändlåset** ska läsas från avsändarinställningen när meddelandet skickas, inte från en ögonblicksbild som sparades vid materialiseringen (noterat vid F38).
