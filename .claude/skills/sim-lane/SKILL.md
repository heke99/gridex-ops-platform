---
name: sim-lane
description: Kör ett spår av simuleringsregistrets scenario-ID (#840) effektivt. Sessionen orkestrerar och delar upp arbetet på agenterna sim-runner, sim-builder, sim-fixer, sim-clerk och sim-reviewer, så att svårt arbete går till starkare modeller och rutinarbete till billigare. Används när en startprompt för ett simuleringsspår ges, eller när ett spår ska fortsätta.
---

# Simuleringsspår: orkestrering

Sessionen som läser detta är **orkestrerare**. Den planerar, delegerar, bedömer och integrerar. Den gör så lite som möjligt av själva grovarbetet, eftersom varje token i huvudsessionen kostar mest. Startprompten för spåret (från Codex eller användaren) anger scenario-ID, bas och eventuella särskilda villkor. Där startprompten och denna fil säger olika saker gäller startprompten, utom för avsnitt 5 ("När ett ID räknas") och reglerna under "Aldrig". De kan ingen startprompt sänka.

## 1. Start (orkestreraren själv, kort)
1. Läs startprompten. Läs registrets rader för spårets ID: `quality/SIMULATION_STATUS.md` och `quality/simulation-register/`. Saknas de på grenen läser du listan i #840, kommentar 6501763644.
2. Simuleringsvärlden (`scripts/reality/`, `scripts/helpers/reality/`) och dess dokument (`quality/audits/live-chain-20261015/`) ligger på grenen `claude/gifted-hamilton-vss1hj` tills de är integrerade i main. Utgå från den grenen, eller från den bas startprompten anger, om main saknar `scripts/reality/`. Läs `STATUS.md` där: avsnitten "ÅTERUPPTA HÄRIFRÅN", eller den närmaste rubriken om läge och nästa steg, samt "Scenarier" och "Så körs världen". Läs inte hela `FINDINGS.md`. Låt sim-clerk hämta de fynd som rör spårets ID.
3. Reservera spårets ID i #840 (ägare, exakt scope, bas-commit) innan arbetet börjar. Kontrollera först att ingen annan redan äger dem. För filer, källor och producentroller gäller dessutom det atomiska claimprotokollet i `.agent-memory/masterplan-reservations.md`.
4. Gör en tabell för spåret med kolumnerna **ID → befintligt steg (scenario och steg) eller "saknas" → orakel → nästa åtgärd**. Låt sim-clerk göra uppslagen.

## 2. Vem gör vad

| Arbete | Agent |
|---|---|
| Köra ett scenario, steg eller omkörning i världen, eller applicera nya migrationer där | `sim-runner` (alltid exakt en åt gången) |
| Skriva nytt steg eller test för ett ID, harnessfel, enkel produkträttning | `sim-builder` |
| SQL, migrationer, skyddade kroppar, Ediel- och ACK-semantik, fakturering och prissättning, samtidighet, låsning, idempotens, RLS och behörighet, eller det som sim-builder eskalerar | `sim-fixer` |
| Sammanfatta loggar, hashar, kvitton, registerrader, uppslag, typkontroll, lint och manifest | `sim-clerk` |
| Granska varje rättning och varje PASS-kvitto innan det räknas | `sim-reviewer`: en ny instans som inte har sett diffen tidigare. Före READY eller merge krävs två oberoende granskningar. |
| Bedöma fel, prioritera, lösa konflikter, skriva i #840, slå ihop worktrees | orkestreraren |

**Eskalering:** sim-builder → sim-fixer → orkestreraren.
- Svarar sim-builder `ESKALERA` skickar du samma uppdrag, med dess anteckningar, till sim-fixer.
- Svarar sim-fixer `BLOCKED: överlämning krävs` postar orkestreraren överlämningsbegäran i #840 och går vidare med andra ID.

## 3. Parallellism
Följande får pågå samtidigt:
- högst **en** sim-runner per värld;
- högst **tre** sim-builder eller sim-fixer, var och en i en egen worktree (`git worktree add <scratch>/wt-<id> <bas>`) och på egna, icke-överlappande filer;
- valfritt antal sim-clerk;
- sim-reviewer på avslutade rättningar.

Låt agenterna arbeta i bakgrunden och skicka oberoende uppdrag i samma omgång. Under tiden en körning pågår arbetar fixarna med fel från föregående körning, och builders skriver prov för ID som saknar steg.

Världens regler finns i `scripts/reality/run-many.sh`:
- banan `als` körs seriellt;
- banan `free` (E, stuck-detector, grid-owner-wire) får köras bredvid, men bara inom en och samma `run-many.sh`-körning, aldrig som en andra separat körning;
- C och J3 körs ensamma;
- E kräver en värld som är startad med `REALITY_EDIEL_LANE=test`;
- aldrig två nativesviter (`*-native.test.ts`) mot samma databas.

"En körning åt gången" betyder en `run.sh` eller en `run-many.sh` åt gången per värld.

## 4. Loop per omgång
1. **Kör.** sim-runner kör de steg som ska prövas i den här omgången.
2. **Sortera.** sim-clerk sammanfattar resultatet. Orkestreraren klassar varje fel som produktfel (F), harnessfel (T), miljöfel eller ägarbeslut.
3. **Rätta.**
   - Harnessfel och enkla fel går till sim-builder. Svåra fel går till sim-fixer.
   - Ägarbeslut skrivs in i `OWNER-DECISIONS.md` som en öppen fråga.
   - Fynd skrivs in i `FINDINGS.md`. Ingen rad tas bort därifrån.
4. **Granska.** sim-reviewer granskar varje rättning. Orkestreraren slår in godkända worktree-commits på spårets gren och tar bort worktreen.
5. **Bygg om.** Bygg om världen om TypeScript ändrats. Låt sim-runner applicera nya migrationer i världen.
6. **Kör om.** Kör om de berörda stegen. sim-runner skriver kvittoutkastet. Därefter, och först när runnern är klar med filen, kompletterar sim-clerk kvittot. En skrivare per kvittofil åt gången.
7. **Uppdatera status.** Uppdatera `STATUS.md` (läge och nästa steg) och spårets ID-tabell. Committa och pusha spårets gren efter varje omgång, eftersom containern kan startas om.

## 5. När ett ID räknas
Ett ID markeras som klart först när **alla** dessa villkor är uppfyllda:
- en faktisk körning på angiven commit prövar ID:ts hela orakel;
- kvittot har commit, logg med sha256, native-läge före och efter samt begränsningar;
- sim-reviewer har godkänt kvittot.

Kvitton skrivs i spårets checkout, inte i världens körkatalog. Använd den sökväg registrets README anger. Finns registret inte på grenen, skriv till `quality/simulation-register/receipts/<ID>.md`.

Ett käll- eller modelltest räknas aldrig som PASS. Ett delsteg räknas inte som ett helt designfall.

Kräver ett ID något externt, till exempel Nordfins schema eller kvitto, en riktig leverantör eller en riktig kund? Markera det då BLOCKED med det exakta underlag som behövs. Påstå aldrig PASS i det fallet.

## 6. Leverans
- Rättningar går som små PR:er till main, ett fynd eller ett kluster per PR, med test och kvitto. Före READY eller merge krävs två oberoende granskningar och gröna obligatoriska kontroller på exakt slutversion. Den seriella leveransägaren gör merge.
- Skriv ett kort CLAIM-, READY- eller MERGED-kvitto per ID i #840, med commit och kvittots sökväg. Avsluta varje kommentar med Claude Code-footern.

## 7. Spara tokens
- Orkestreraren läser aldrig hela loggar, hela `FINDINGS.md` eller alla kommentarer i #840. Sådant gör sim-clerk.
- Agenternas svar har fasta format och högst 25–40 rader. Ge varje agent ett avgränsat uppdrag med exakta filer, ID, worktree och bas, så att den inte behöver leta.
- Vänta på körningar med villkorsloopar eller bakgrundsnotiser, inte genom att fråga om status gång på gång.
- Återanvänd agenter med SendMessage när samma fel fortsätter, i stället för att starta nya som måste läsa in allt igen. Saknas SendMessage i sessionen, starta en ny agent av samma typ och ge den den förra agentens svar som underlag.

## Aldrig
- produktion, riktiga kunder, leverantörer, betalningar eller riktiga Ediel- och mejlutskick;
- Roots isolerade databas;
- två separata körningar (`run.sh` eller `run-many.sh`) mot samma värld samtidigt, eller två nativesviter mot samma databas;
- push eller merge till main;
- försvagade skydd;
- ändring av en redan applicerad migration;
- ändring av en aktivt ägd fil utan överlämning;
- PASS utan faktisk körning;
- hemligheter i commits, kvitton eller ärenden.
