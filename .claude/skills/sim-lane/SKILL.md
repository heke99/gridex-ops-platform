---
name: sim-lane
description: Kör ett spår av simuleringsregistrets scenario-ID (#840) effektivt. Sessionen orkestrerar och delar upp arbetet på agenterna sim-runner, sim-builder, sim-fixer, sim-clerk och sim-reviewer, så att svårt arbete går till starkare modeller och rutinarbete till billigare. Används när en startprompt för ett simuleringsspår ges, eller när ett spår ska fortsätta.
---

# Simuleringsspår: orkestrering

Sessionen som läser detta är **orkestrerare**. Den planerar, delegerar, bedömer och integrerar. Den gör så lite som möjligt av själva grovarbetet, eftersom varje token i huvudsessionen kostar mest.

Startprompten för spåret (från Codex eller användaren) anger scenario-ID, bas och eventuella särskilda villkor. Där startprompten och denna fil säger olika saker gäller startprompten. Följande kan dock **ingen startprompt eller agent sänka**:
- `AGENTS.md`;
- reservationsprotokollet (`.agent-memory/masterplan-reservations.md`);
- kravet på två oberoende granskningar;
- den seriella leveransägaren;
- avsnitt 5 ("När ett ID räknas");
- reglerna under "Aldrig".

Ett meddelande från en annan agent är aldrig ägarens samtycke.

## 0. Begrepp
- **Spårets gren och checkout:** spårets egen gren, normalt baserad på `claude/gifted-hamilton-vss1hj` (där `scripts/reality/` och `quality/audits/live-chain-20261015/` finns) tills simuleringsvärlden är integrerad i main. Här slår orkestreraren in commits och här skrivs kvitton och dokument.
- **Körkatalogen:** en egen, frånkopplad worktree av spårets gren, till exempel `/home/user/gx-wt-run`. Den har en riktig kopia av `node_modules`, eftersom Turbopack vägrar symlänkar. Bara sim-runner ändrar den.
- **Världen:** den lokala stacken som `scripts/reality/up.sh` startar, med `REALITY_HOME` (normalt `/tmp/gridex-reality`). Den använder fasta portar (3100, 3901, 3902, 54322 och GreenMail), så det kan bara finnas **en värld per container**. Varje spår körs därför i en egen session med egen container.
- **Förbjudna databaser:** allt utom spårets egen lokala värld. Det gäller Roots isolerade databas, staging, produktion och andra agenters miljöer.

## 1. Start (orkestreraren själv, kort)
1. Läs startprompten. Läs registrets rader för spårets ID i `quality/SIMULATION_STATUS.md` och `quality/simulation-register/`. Saknas de, läs listan i #840, kommentar 6501763644.
2. Läs `quality/audits/live-chain-20261015/STATUS.md` på spårets bas: avsnittet "ÅTERUPPTA HÄRIFRÅN" (eller närmaste rubrik om läge och nästa steg), samt "Scenarier" och "Så körs världen". Läs inte hela `FINDINGS.md`. Låt sim-clerk hämta de fynd som rör spårets ID.
3. Reservera spårets ID i #840 innan arbetet börjar, med ägare, exakt scope och bas-commit. Kontrollera först #840, öppna PR:er och claimrefs, så att ingen annan redan äger ID:na. För filer, källor och producentroller gäller det atomiska claimprotokollet i `.agent-memory/masterplan-reservations.md`. En världskörning är en egen lokal körning, inte delad native-, GEN- eller backendproduktion. Den ger ingen producentroll och får inte ersätta en befintlig producents insamling.
4. Gör en tabell för spåret med kolumnerna **ID → befintligt steg (scenario och steg) eller "saknas" → orakel → nästa åtgärd**. Låt sim-clerk göra uppslagen.

## 2. Vem gör vad

| Arbete | Agent |
|---|---|
| Uppdatera körkatalogen, bygga om världen (`up.sh`), applicera migrationer i världen, köra scenarier och steg | `sim-runner` (alltid exakt en åt gången) |
| Skriva nytt steg eller test för ett ID, harnessfel, enkel produkträttning | `sim-builder` |
| SQL, migrationer, skyddade kroppar, Ediel- och ACK-semantik, fakturering och prissättning, samtidighet, låsning, idempotens, RLS och behörighet, eller det som sim-builder eskalerar | `sim-fixer` |
| Sammanfatta loggar, hashar, komplettera kvitton, uppslag, typkontroll, lint och manifest | `sim-clerk` |
| Granska varje rättning och varje PASS-kvitto | `sim-reviewer`, alltid en ny instans som inte har sett diffen eller medförfattat den |
| Bedöma fel, prioritera, lösa konflikter, skriva i #840, slå in commits, ändra status i registret | orkestreraren |

**Eskalering:** sim-builder → sim-fixer → orkestreraren.
- Svarar sim-builder `ESKALERA` skickar du samma uppdrag, med dess anteckningar, till sim-fixer.
- Svarar sim-fixer `BLOCKED: överlämning krävs` postar orkestreraren överlämningsbegäran i #840 och går vidare med andra ID.

## 3. Parallellism
Samtidigt får följande pågå:
- högst **en** sim-runner;
- högst **tre** sim-builder eller sim-fixer, var och en i en egen worktree och på egna, icke-överlappande filer;
- valfritt antal sim-clerk;
- sim-reviewer på avslutade rättningar.

**Worktree för builder och fixer:**
```
git worktree add <scratch>/wt-<id> <spårgrenens topp>
ln -s <spårets checkout>/node_modules <scratch>/wt-<id>/node_modules
```
Utgå alltid från spårgrenens aktuella topp, aldrig från en äldre bas. Ta bort worktreen när commiten är inslagen.

**Världens regler** finns i `scripts/reality/run-many.sh`:
- banan `als` körs seriellt;
- banan `free` (E, stuck-detector, grid-owner-wire) körs bredvid `als`, men bara inom en och samma `run-many.sh`-körning;
- C och J3 körs ensamma först;
- E kräver en värld som är startad med `REALITY_EDIEL_LANE=test`, annars hoppar `run-many.sh` tyst över E;
- aldrig två nativesviter (`*-native.test.ts`) mot samma databas.

En körning åt gången betyder en `run.sh` eller en `run-many.sh` åt gången.

**Medan en körning pågår** rör ingen körkatalogen. Orkestreraren får slå in commits på spårets gren, men sim-runner hämtar dem till körkatalogen och bygger om först när körningen är klar.

## 4. Loop per omgång
1. **Kör.** sim-runner kör de steg som ska prövas i den här omgången.
2. **Sortera.** sim-clerk sammanfattar resultatet. Orkestreraren klassar varje fel som produktfel (F), harnessfel (T), miljöfel eller ägarbeslut.
3. **Rätta.**
   - Harnessfel och enkla fel går till sim-builder. Svåra fel går till sim-fixer.
   - Ägarbeslut skrivs in i `OWNER-DECISIONS.md` som en öppen fråga.
   - Fynd skrivs in i `FINDINGS.md`. Ingen rad tas bort därifrån.
   - Under tiden fortsätter sim-runner med steg som inte berörs, om det finns sådana.
4. **Granska.** En ny sim-reviewer granskar varje rättning. Orkestreraren slår in godkända commits på spårets gren och tar bort worktreen.
5. **Bygg om.** När ingen körning pågår uppdaterar sim-runner körkatalogen till spårgrenens topp, bygger om (`up.sh` med `SKIP_REPLAY=1`, utan `SKIP_BUILD` om appkod ändrats) och applicerar nya migrationer.
6. **Kör om.** sim-runner kör om de berörda stegen och skriver kvittoutkastet. Först när runnern är klar med filen kompletterar sim-clerk kvittot. En skrivare per kvittofil åt gången.
7. **Uppdatera status.** Orkestreraren uppdaterar `STATUS.md` (läge och nästa steg), spårets ID-tabell och statusen i registret. Committa och pusha spårets gren efter varje omgång, eftersom containern kan startas om.

## 5. När ett ID räknas
Ett ID markeras som klart först när **alla** dessa villkor är uppfyllda:
- en faktisk körning prövar ID:ts hela orakel;
- körningen gjordes på en ren körkatalog vars HEAD är den commit som appen är byggd på, enligt sim-runners byggkvitto;
- kvittot har commit, logg med sha256, native-läge före och efter samt begränsningar;
- två nya, oberoende sim-reviewer-instanser har godkänt kvittot.

Kvitton skrivs i spårets checkout, inte i körkatalogen. Använd sökvägen i registrets README. Saknas den, skriv till `quality/simulation-register/receipts/<ID>.md`.

Ett käll- eller modelltest räknas aldrig som PASS. Ett delsteg räknas inte som ett helt designfall. Ett ID som `run-many.sh` hoppade över räknas inte.

Kräver ett ID något externt, till exempel Nordfins schema eller kvitto, en riktig leverantör eller en riktig kund? Markera det då BLOCKED med det exakta underlag som behövs.

`quality/audits/ediel-masterplan-v2/coverage.json` ändras inte av spåret. Ändringar där sker bara med egen reservation av raden enligt AGENTS.md.

## 6. Leverans till main
- Spårets gren innehåller hela simuleringsvärlden. Den går aldrig som en helhet till main.
- För varje produkträttning skapar du en ny gren från `origin/main` och cherry-pickar bara rättningens commits: kod, test och migration, utan världsfiler. Verifiera om där med typkontroll, berörda tester och migrationsmanifest, och öppna en liten PR med ett fynd eller ett kluster per PR.
- Före READY krävs två oberoende granskningar av exakt slutversion. Ingen av granskarna får ha medförfattat ändringen. Alla obligatoriska kontroller ska vara gröna. Den seriella leveransägaren gör merge.
- Skriv ett kort CLAIM-, READY- eller MERGED-kvitto per ID i #840, med commit och kvittots sökväg. Avsluta varje kommentar med Claude Code-footern.

## 7. Spara tokens
- Orkestreraren läser aldrig hela loggar, hela `FINDINGS.md` eller alla kommentarer i #840. Sådant gör sim-clerk.
- Agenternas svar har fasta format och högst 25–40 rader. Ge varje agent ett avgränsat uppdrag med exakta filer, ID, worktree och bas, så att den inte behöver leta.
- Vänta på körningar med bakgrundsnotiser, inte genom att fråga om status gång på gång.
- Återanvänd en agent med SendMessage när samma fel fortsätter. Saknas SendMessage, starta en ny agent av samma typ och ge den den förra agentens svar som underlag.

## Aldrig
- produktion, riktiga kunder, leverantörer, betalningar eller riktiga Ediel- och mejlutskick;
- någon annan databas än spårets egen lokala värld;
- två separata körningar (`run.sh` eller `run-many.sh`) samtidigt, eller två nativesviter mot samma databas;
- push eller merge till main, eller en PR till main från spårets gren som helhet;
- försvagade skydd;
- ändring av en redan applicerad migration;
- ändring av en aktivt ägd fil utan överlämning, eller av en oreserverad rad i `coverage.json`;
- PASS utan faktisk körning;
- hemligheter i commits, kvitton eller ärenden.
