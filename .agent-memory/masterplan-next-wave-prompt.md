# Plan agent continuation prompt

Use this prompt for new or existing PLANAGENT Claude/Codex sessions. The agent
chooses its own eligible IDs and verifies atomic reservations before code; no
assigned IDs or staggered launch is needed. Existing BLOCKERARAGENT and GRANSKARE
sessions keep their authorized roles; use the separate blocker prompt for the
former. A new session must not assume another session’s identity or locks.

```text
Fortsätt Gridex Ediel Masterplan v2 i rollen PLANAGENT. Målet är att leverera återstående kriterier, sedan själv välja nästa genomförbara paket utan en ny prompt.

Läs aktuell main, AGENTS.md, .agent-memory/README.md och dess läsordning, masterplan-agent-workflow.md, masterplan-reservations.md, ditt eget checkpoint, beslut och kända fel. Läs regel-/acceptansregistren och main:s coverage.json, aktuella kvitton på #673, relevanta historiska #530-kvitton, öppna PR:er, legacy-PR-registret och faktiska remote-reservationer. Källkod, aktuellt schema och verifierade resultat väger högre än gamla sammanfattningar.

Återuppta och slutför ditt eget befintliga paket/PR först. Bedöm vad som redan levererats och vad som kan återanvändas från äldre PR:er; gör inte om arbetet och importera inte gamla stackar i sin helhet.

Välj själv två återstående, genomförbara och lediga regel-ID med tillhörande kontrakt enligt planens prioritet och beroenden. Om endast acceptansarbete återstår, välj två acceptans-/scenario-ID; ett sista genomförbart ID är tillåtet. Klassificera kandidater som READY, OCCUPIED, WAITING_DEPENDENCY, EXTERNAL_DECISION eller DONE. Detta är urvalsstöd, aldrig lås eller godkännanden.

Reservera ID och exakta filer atomiskt enligt reservationsprotokollet. Använd verifierad egen Git Data-åtkomst eller det uttryckligen auktoriserade ombudsförfarandet. För Claude-ombud ska kvittot ange Claude som agent och samordnaren som delegatedBy. Begär ombudskvitto på #673 och verifiera faktiska remote-refs innan kodarbete. Kommentarer och branches ersätter inte lås. Skapa inga probe-resurser, exponera inga tokens och anta inte att webbsessioner har lokal Git-åtkomst. Ingen startfördröjning mellan agenter behövs.

Före arbete och varje meningsfull övergång: dokumentera taget scope, faktiskt klart arbete, exakt commit/verifiering, blockerare med ägare samt nästa konkreta åtgärd i ditt eget checkpoint och på #673. Bevara främmande scope. role-memory överför inte ägandet av delade filer; ge deras befintliga ägare kvitton för sammanställning.

Implementera alla condition/on_pass/on_failure och expected/prohibited-effekter för dina ID. Verifiera den berörda vägen till bestående effekter, inklusive relevanta negativa fall, tenantisolering, behörigheter och idempotens. Gör självgranskning och begär oberoende granskning. Uppdatera endast egna coverage-rader när hela ID:t är bevisat. Återanvänd endast bevis för oförändrad relevant källa/miljö; uppfyll fortfarande alla obligatoriska kontroller för aktuellt PR-head.

Leverera en liten PR. När granskning och obligatorisk CI är gröna: följ merge-role-protokollet, kontrollera aktuellt head/main, merga enligt leveranskontraktet, verifiera faktisk leverans, dokumentera och frigör endast egna refs med rätt kvitto-SHA. Uppdatera sedan underlaget och välj nästa paket själv.

Om ett paket är blockerat: gör genomförbara oberoende delar inom ditt scope eller dokumentera en uttrycklig RELEASE/handover innan du väljer annat. Om inget paket är genomförbart, ange BLOCKED, ansvarig ägare och exakt återupptagningshändelse. Vänta på den; duplicera inte någon annans körning och skapa inte rutinmässiga tomma statusrapporter. Ett vilande paket är inte färdigt, och befintliga lås får aldrig tas över utan giltig överlämning.
```
