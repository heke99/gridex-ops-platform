# Verklighetssimuleringen — läge och nästa steg

Uppdaterad 2026-10-29 kl. 10:05 UTC av Claude (session 01Az5xza…), som fortsätter på grenen `claude/wonderful-franklin-o8gx2p` (byggd på `claude/gifted-hamilton-vss1hj` `edeaed7d0`) på ägarens uppdrag. Tidigare session: 01YCH5Va…. Filen är tänkt att läsas först.

Den hör ihop med tre andra dokument:
- [FINDINGS.md](FINDINGS.md): alla fynd. Inget tas bort därifrån.
- [OWNER-DECISIONS.md](OWNER-DECISIONS.md): ägarens beslut (1–43) och öppna frågor.
- #840: anspråk och leveranser per fil.

## ÅTERUPPTA HÄRIFRÅN (läs först om arbetet har stannat)
Senast uppdaterad 2026-10-29 10:05 UTC. Grenen `claude/wonderful-franklin-o8gx2p`, head `0344f8587` (allt nedan är pushat).

**Var jag är:** ägarbeslut 35–43 är genomförda och applicerade i världen. Två saker återstår innan J1 är klar:
1. **J1-B6 (öppen, hög):** den negativa APERAK:en för leveransägarens nya hållskäl (42/210, 42/226, 40/105, 40/107, 40/104) vägras av databasens kvittensguide (`ediel_native_ack_guide_invalid`), eftersom en hållning inte lämnar något beständigt bevis. Se FINDINGS "J1-B6".
   - **Pågår:** J1-agenten (arbetskopia `.claude/worktrees/agent-a0d3c7c5b1a08c97d`) bygger ett hashat hållkvitto i ägarens transaktion och en guideväg som godtar exakt kvittots svar. Migrationer i intervallet `20261028103000–109999`. Ändrar skyddade ACK-kroppar, så `handover-J1.md` utökas och postas i #840.
   - **Om agenten har stannat:** läs dess arbetskopia (`git log`, `git status`). Fortsätt från den, eller gör uppgiften själv enligt FINDINGS J1-B6.
2. **Verifiering av J1 (35–38):**
   - `inbound-prodat-j1-native` ska vara grön utom 40/103 (`it.fails`).
   - `ediel-at-z03l-z03lk-supplier-native`: 23/11 under cronlast. Utan appen (10:10) 24 gröna och 10 röda, fortfarande med deadlockar mellan `platform_market_actors` (tabellås SHARE) och `platform_actor_identifiers`. Det tyder på två nativekörningar som sår fixturer samtidigt (min och J1-agentens).
     - **Gör:** när J1-agenten är klar, kör sviten ensam, först på `22ac29587` (före J1, arbetskopia) och sedan på head, och jämför de röda testen. Kör aldrig två nativesviter samtidigt mot världen.
   - `ediel-source-owner-native` hade många röda i en avbruten körning under last. Samma jämförelse.
   - `ediel-z04l-z04lk-future-start-native` kan inte köras lokalt (GitHub-värd krävs).
   - Därefter `npm run ediel:masterplan-v2:test-coverage -- --check` (måste vara 352/352).

**Världens läge:**
- Databasen och GreenMail kör.
- **Appen är avsiktligt stoppad** under nativetesterna (cronjobben gav deadlockar). Starta den med `SKIP_REPLAY=1 SKIP_BUILD=1` och övriga flaggor, se "Återstart" nedan.
- Alla migrationer `20261028*` är installerade och registrerade i `supabase_migrations.schema_migrations`.

**Återstart efter en containeromstart** (har hänt nio gånger):
1. `rm -f /var/run/docker.pid; nohup dockerd &`
2. `docker rm -f gx-mail`
3. Supabase-containrarna startar själva med dockerd.
4. För hela världen: i `/home/user/gx-wt-run` (detached på grenens head) kör `SKIP_REPLAY=1 [SKIP_BUILD=1] GRIDEX_REALITY_TICK_MS=3000 GRIDEX_REALITY_F6C_MODE=cron GRIDEX_REALITY_F6C_PAGES=2 REALITY_SVK_SOURCE=simulated REALITY_SPOT_SOURCE=synthetic bash scripts/reality/up.sh`.
5. För bara GreenMail: kör `docker run` med `/tmp/gridex-reality/tls` som i `up.sh` rad 40.

**Nästa steg efter J1:**
- Integrera J1-B6.
- Bygg om appen och kör J1 och J2 i världen.
- Kör F i en ny värld (ny replay).
- Ta prestandafyndet G-6b.
- Väntande ägarfrågor: avsnittet "Öppna frågor (2026-10-28 kväll)" i OWNER-DECISIONS.

**Leveranser i denna omgång (alla pushade):**
- `af52dcad9`: beslut 41.
- `b6ab5795e`: beslut 42.
- `5231eaaab`: beslut 39.
- `340fb6a62`: beslut 43.
- `22ac29587`: beslut 40.
- `f649ece0a`: beslut 38.
- `d7ccf01eb`: beslut 35–37.
- `0344f8587`: FINDINGS J1-B6.
- Överlämningar i #840: F48, J2-02 och J1.

## Var jag är nu
- **Ägarbeslut 35–43 (2026-10-28 ca 15:40 UTC):** alla nio frågor besvarade och registrerade i OWNER-DECISIONS (status per beslut i tabellen). Ägarens villkor: ändringar i skyddad kod och godkända tester kräver avgränsad överlämning, bevarade skydd och nya positiva och negativa regressioner.
  - **41 månadspris:** bekräftat dagens beteende, regressioner (`af52dcad9`).
  - **42 A-B5:** engångsbackfill applicerad i världen (`b6ab5795e`): 32 ifyllda, 465 till granskning.
  - **39 J1-14:** APERAK-budget 20 av 30 min, prioritet och eskalering (`5231eaaab`). Ingen låst kod.
  - **43 F48:** E73-route, Application Reference per begärd typ och spärr för E74/S07/E66 (`340fb6a62`, migration `20261028130000`, applicerad). Överlämning för SC-059 i #840.
  - **40 J2-02:** rättelse av fakturerad månad blir eget rättelse- eller kreditdokument (`22ac29587`, migration `20261028120000`, applicerad). Överlämning för två skyddade kroppar i #840.
  - **38 J1-10:** Z04 utan fält 259 godtas när inga mätarställningar rapporteras (`f649ece0a`).
  - **35–37 J1-01/02/03:** nya hållskäl i `normal_switch_scope_effect_v1` med negativ APERAK (42/210, 42/226, 40/105, 40/107, 40/104) och operatörsärende (`d7ccf01eb`, migrationer `20261028100000`–`102000`, applicerade). **40/103 öppen** (ACK-09-hinder, ny fråga i OWNER-DECISIONS).
  - **Verifiering:**
    - Masterplanens täckning 352/352 gröna efter J2-02.
    - J1-nativesviten: 5 röda i första körningen. Hållskälen stämmer, men APERAK saknas. Trolig orsak: världens app (byggd före J1) hann behandla meddelandet först. Appen byggs om på `d7ccf01eb` (`/tmp/gridex-reality/up-rebuild9.log`), och sviterna körs om.
    - `ediel-z04l-z04lk-future-start-native` kan inte köras lokalt; den kräver en GitHub-värd med klockkapabilitet.
  - **Sjunde och åttonde omstarten av containern:** båda återställda med dockerd, gx-mail och `up.sh` med `SKIP_REPLAY=1`.
  - **Därefter:** J1-överlämningen till #840, omkörning av J1-, AT-Z03L/LK- och källägarsviterna och täckningen, sedan J1 och J2 i världen. F körs i en ny värld. Prestandafyndet G-6b (ca 6 s mot 8 s) är öppet.
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
    - J2 10/14: J2-B5 verifierad. Nytt J2-B6 (bundet underlag kunde aldrig prissättas) och J2-B7 (tre kolumner saknades i `billing_export_runs`), båda KRITISKA för fakturering, rättade (migrationer `20261027120000`/`20261027121000`, applicerade) och verifierade i världen: tre fakturautkast med exakta kWh.
    - J4 7/8: T41 verifierad; T44 (harness) rättad.
    - H 10/11: T42 verifierad; T45 (harness) rättad.
    - J1 5/12: T40 verifierad; resten kända öppna (J1-01, -02, -05, -10, -11, -14).
    - G 10/11: G10 blockerad av världens datum (oktobers spotpriser finns inte än); inget fynd.
    - F avbröts 12:57 (3–4 h) för att köras på det nya bygget.
    - Hela enhetstestsviten: 1 415 filer gröna efter två rättningar (RBAC-granskning av I-B2d:s åtgärd och manifestet för J2-B6/B7).
  - **Batch 6 från 13:00 UTC:** ombyggd app på `2aa3f43e5` (A-B6, I-B11, I-B12, J2-B6:s felmeddelande). J4, A, I, J2, K, H, F. Logg `/tmp/claude-0/batch6.log` (bygget `/tmp/claude-0/up6.log`).
    - J4 8/8 (T44 verifierad). A 4/7: A-B6 verifierad, webbvägen når bekräftad leverans; nytt A-B7 (aktivering vägrades, KRITISK) rättat (migration `20261027130000`, applicerad) och verifierat; T46 (harness) rättad. I 8/10: I-B11 och I-B12 verifierade; nytt I-B13 (Z04 före negativ APERAK förlorar, öppen).
    - J2 12/14: J2-B6, J2-B7 och J2-05 verifierade (septemberfakturan skapas). J2-10 = J2-02 (ägarbeslut, se OWNER-DECISIONS); J2-13 känt (F35/F48).
    - K 12/12 (A-B5 och T43 verifierade).
    - H 10/11: T45 verifierad. Nytt H-B6 (brytavgift kunde aldrig faktureras) rättat (migration `20261027160000`, applicerad) och verifierat i världen.
  - **Batch 7 från 17:13 UTC** på ombyggd app (J1-11, J1-05, I-B13). Logg `/tmp/claude-0/batch7.log`.
    - I 10/10 (I-B13 verifierad).
    - J1 5/12: J1-11 verifierad. Nytt J1-05b (ärendet saknade byte och mätpunkt) och T47 (harness) rättade. J1-6 = J1-03 (den gröna J1-6 i 5e var falsk). Övriga röda är kända och kräver ägarbeslut eller överlämning av låst SQL (J1-01, -02, -03, -10, -14).
    - F 11/12: FÖRSTA FAKTURERINGEN I F (F7, F8 och F10 gröna). F9 → T48 (harness, rättad); månadsprisets beräkning är en ägarfråga.
    - J1-nativetestet: T49 (harness) rättad, 10 gröna och 4 förväntade fel.
  - **Batch 8 från 20:45 UTC** på ombyggd app (grenens topp): A, J1, H, F. Verifierar T46, J1-05b, T47, H-B6 (hela H11) och T48. Logg `/tmp/claude-0/batch8.log` (bygget `/tmp/claude-0/up8.log`).
    - A 6/7 (T50 rättad), J1 6/12 (J1-05b verifierad), H 10/11 (nytt H-B6b rättat och verifierat, migration `20261027170000`). F avbröts av omstarten.
  - **Femte omstarten av containern (ca 23:00 UTC):** F i batch 8 försvann. dockerd startades, gx-mail togs bort och `up.sh` kördes med `SKIP_REPLAY=1 SKIP_BUILD=1` (bygget på `f7c3d4fd3` gäller; senare commits är harness och SQL som redan finns i databasen).
  - **Batch 9 från 23:14 UTC:** A, H, F. Logg `/tmp/claude-0/batch9.log`.
  - **Batch 9 (A) föll på T51 (SMTP-lösenord i världen, rättat i `up.sh`). Batch 10 avbröts av den sjätte omstarten (ca 23:55).**
  - **Batch 11 från 00:00 UTC 2026-10-28:** A, H, F. Logg `/tmp/claude-0/batch11.log`.
    - Batch 11: A 7/7 (första helt gröna), H 10/11 (nytt H-B7, rättat, migration `20261028010000`), F 11/12 (T48 verifierad; T52 harness rättad).
    - Batch 12: H 11/11 (första helt gröna; H-B7 verifierad).
  - **Läge efter batch 12:** helt gröna i senaste körning: A, I, K, H, J4. J2 12/14 och G 10/11 (ägarbeslut respektive datum), F 11/12 (T52 rättad, väntar på omkörning), J1 6/12 (kända öppna fynd).
  - **Batch 13–17 (F):** F fastnade på strandade meddelanden; rättat i F-B1 (deadlock-omförsök), F-B1b (valideringsliggaren släpper igenom tillfälliga fel), F-B1c (statement timeout och klientens tidsgräns) och F-B1d (återupptagning även efter `received`). I batch 17 strandade inget, men världen var överbelastad (678 bolag, 4,7 GB): F 8/12, med F6/F8 röda av tidsgränser. Se FINDINGS "F, batch 17".
  - **Läge 2026-10-28 15:05:** helt gröna i senaste körning: A, I, K, H, J4. J2 12/14, G 10/11, J1 6/12 (kända öppna fynd och ägarbeslut). F: rättningarna är klara; en slutlig omkörning bör göras i en ny värld.
  - **Kvar som kräver ägaren:** J1-01, J1-02, J1-03 (låst SQL), J1-10, J1-14, J2-02, F48 (UTILTS-meddelanden), A-B5-backfill, månadsprisets medelpris (T48/F108-3). Se OWNER-DECISIONS.
  - **Parallella agenter (14:05–14:55 UTC), klara, granskade och införda:** J2-05 (migration `20261027150000`, applicerad i världen), J1-11, J1-05 och I-B13 (Z04 före negativ APERAK). J1-02 kräver ägarbeslut (OWNER-DECISIONS). Agenternas arbetskopior är borttagna.
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
