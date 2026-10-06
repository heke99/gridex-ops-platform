# Shared next-wave prompt

Replace the agent name and assigned IDs before sending. Allocation is confirmed
on #530; staggered start times do not replace it.

```text
Fortsätt Gridex Ediel Masterplan v2 enligt det uppdaterade arbetskontraktet.
AGENT: [unikt namn/session]
TILLDELADE ID:N: [två bekräftade ID:n och relaterade kontrakt]

Läs först AGENTS.md och hela läsordningen i .agent-memory/README.md.
Läs särskilt masterplan-agent-workflow.md, din egen checkpoint,
masterplan-legacy-pr-register.json och senaste ägarskap på #530.

Prioritera befintliga reservationer och relevant kvarvarande arbete från
tidigare PR:er, även stängda PR:er. Jämför originalkraven och bevarade grenar
med aktuell main. Återanvänd giltigt arbete; gör inte om redan levererade delar.
Återuppta bara bekräftat eget kvarvarande ansvar. Återöppna en gammal PR endast
om gren och omfattning fortfarande passar; annars leverera en liten ny PR som
länkar originalet. HOLD/PAUSED är kvarvarande krav, inte godkända resultat.

Bekräfta ditt par och filansvar på #530 före kodning. Utan tilldelade ID:n:
begär ett ledigt par av samordnaren och invänta bekräftelse.
Arbeta i egen arbetskopia på unik gren, med högst ett aktivt regelpar.

Dokumentera före start och efter varje meningsfull förändring:
vad du har tagit, vad du gjort klart, verifiering och exakt commit,
kvarvarande krav/blockerare och nästa konkreta åtgärd med ansvarig.
Använd egen checkpoint; samordnaren uppdaterar gemensam kampanjstatus.
Inget nytt regelpar får påbörjas utan aktuell dokumentation och reservation.

Slutför hela kontraktet och verifiera verkliga anrop, konsumenter och effekter.
Granska ditt slutliga arbete och uppfyll projektets obligatoriska reviewkrav.
Ändra bara egna coverage-rader när hela ID:t är styrkt.

Merga själv enligt samordnad ordning när aktuell PR-version har godkänd review
och alla obligatoriska kontroller är gröna. Dokumentera faktisk main-commit
och PR efter merge. Först då begär du nästa par.
Vid blockerare: bevara arbetet, dokumentera nästa åtgärd och fortsätt med
oberoende delar inom ditt par, eller gör en uttrycklig RELEASE/överlämning.

Rapportera faktisk status. Lokalt grönt, öppen PR, mergat och externt verifierat
är olika tillstånd. Inga krav, tester eller spärrar får försvagas för grönt.
```
