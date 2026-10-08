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

Välj själv två återstående, genomförbara och lediga regel-ID med tillhörande kontrakt enligt planens prioritet och beroenden. För ett paket som enbart gäller acceptansarbete, välj två återstående acceptans-/scenario-ID även om andra regler är upptagna eller blockerade. Om endast ett genomförbart, behörigt ID finns i urvalet gäller det befintliga undantaget för ett sista ensamt ID; dokumentera urvalet och ta inget blockerat utfyllnads-ID. Klassificera kandidater som READY, OCCUPIED, WAITING_DEPENDENCY, EXTERNAL_DECISION eller DONE. READY i urvalet betyder genomförbar kandidat; ett kvitto READY med PR-länk betyder publicerad granskningsbar leverans. Ingen av dem är lås, scope-överlåtelse eller godkännande. Läs masterplan-work-queue.md som daterat underlag och verifiera det live.

Reservera ID och exakta filer atomiskt enligt reservationsprotokollet. Använd verifierad egen Git Data-åtkomst eller det uttryckligen auktoriserade ombudsförfarandet. För Claude-ombud ska kvittot ange Claude som agent och samordnaren som delegatedBy. Begär ombudskvitto på #673 och verifiera faktiska remote-refs innan kodarbete. Kommentarer och branches ersätter inte lås. Skapa inga probe-resurser, exponera inga tokens och anta inte att webbsessioner har lokal Git-åtkomst. Ingen startfördröjning mellan agenter behövs.

Före arbete och varje meningsfull övergång: dokumentera taget scope, faktiskt klart arbete, exakt commit/verifiering, blockerare med ägare samt nästa konkreta åtgärd i ditt eget checkpoint och på #673. Bevara främmande scope. role-memory överför inte ägandet av delade filer; ge deras befintliga ägare kvitton för sammanställning.

Implementera alla condition/on_pass/on_failure och expected/prohibited-effekter för dina ID. Verifiera den berörda vägen till bestående effekter, inklusive relevanta negativa fall, tenantisolering, behörigheter och idempotens. Gör självgranskning och begär oberoende granskning. Uppdatera endast egna coverage-rader när hela ID:t är bevisat. Återanvänd endast bevis för oförändrad relevant källa/miljö; uppfyll fortfarande alla obligatoriska kontroller för aktuellt PR-head.

Leverera en liten PR. När granskning och obligatorisk CI är gröna: följ merge-role-protokollet, kontrollera aktuellt head/main, merga enligt leveranskontraktet, verifiera faktisk leverans, dokumentera och frigör endast egna refs med rätt kvitto-SHA. Uppdatera sedan underlaget och välj nästa paket själv.

Om ett paket är blockerat: koppla hindret till exakt kvarvarande kriterium och gör oberoende genomförbara delar inom ditt scope. Alternativt dokumentera kvarvarande arbete, verifiera faktisk överlämning och frigör egna refs enligt kvitto-SHA innan du väljer annat; ombud använder RELEASE_REQUEST och verifierat frigöringskvitto. En release-intention räcker inte.

Om inget paket är genomförbart: kontrollera tidigare faktiska RELEASE/handover först. Vid retained ID/fil/helansvar, återanvänd befintlig avgränsad leverans-/överlämningsförfrågan eller dokumentera en med ägare, exakt scope, källa, kvarvarande kriterier och exclusions. En otillgänglig originalchatt kräver uttrycklig auktoriserad handover enligt protokollet; tystnad ger inget övertagande. Ange BLOCKED med konkret återupptagningshändelse och fortsätt endast oberoende behörigt arbete inom rollen. Om inget sådant finns, avsluta med ett aktuellt checkpoint; undvik tomma rutinrapporter och dubbla körningar.

En avslutad chatt arbetar inte i bakgrunden efter ett nytt GitHub-kvitto. Vid återupptagande i samma chatt: läs ditt checkpoint och uppdatera beroenden/main/refs. En ny chatt är en ny identitet tills en verklig scoped handover är dokumenterad och reservationerna verifierade.
```
