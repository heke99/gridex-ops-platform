# Same prompt for every agent

Send the text below unchanged. Each agent generates its own session identity,
chooses work and reserves it atomically. No assigned IDs or launch delay are
required. Receiving this prompt dispatches that agent; this documentation
update alone does not launch agents.

```text
Fortsätt Gridex Ediel Masterplan v2 självständigt tills allt tillåtet arbete
är klart eller återstående arbete har dokumenterade blockerare.

Läs aktuell main, AGENTS.md och läsordningen i .agent-memory/README.md.
Läs masterplan-agent-workflow.md, masterplan-reservations.md, din checkpoint,
aktuell coverage, senaste #530, öppna PR:er och masterplan-legacy-pr-register.json.

Skapa ett unikt agent/session-ID själv. Slutför ditt befintliga ansvar först.
Välj sedan själv två lediga, ej godkända regel-ID:n enligt planens prioritet
och beroenden, inklusive berörda kontrakt. När endast acceptansarbete återstår,
välj två kvarvarande kontrakt/scenarier; ett sista ensamt ID är tillåtet.

Prioritera befintliga reservationer och relevant kvarvarande arbete från
tidigare PR:er, även stängda PR:er. Jämför originalkraven och bevarade grenar
med aktuell main. Återanvänd giltigt arbete; gör inte om redan levererade delar.
Återuppta bara eget kvarvarande ansvar. Återöppna en gammal PR endast
om gren och omfattning fortfarande passar; annars leverera en liten ny PR som
länkar originalet. HOLD/PAUSED är kvarvarande krav, inte godkända resultat.

Reservera ID:n och filansvar med atomiska GitHub-lås enligt
masterplan-reservations.md. Om något är upptaget, välj annat ledigt arbete.
Bekräfta alla lås och dokumentera CLAIM, checkpoint och nästa steg på #530
innan kodning. Du behöver ingen tilldelning eller bekräftelse från användaren
eller en samordnare.
Arbeta i egen arbetskopia på unik gren, med högst ett aktivt regelpar.

Dokumentera före start och efter varje meningsfull förändring:
vad du har tagit, vad du gjort klart, verifiering och exakt commit,
kvarvarande krav/blockerare och nästa konkreta åtgärd med ansvarig.
Använd egen checkpoint och #530. Uppdatera gemensam kampanjstatus med
roll-låset enligt reservationsprotokollet.
Inget nytt regelpar får påbörjas utan aktuell dokumentation och reservation.

Slutför hela kontraktet och verifiera verkliga anrop, konsumenter och effekter.
Granska ditt slutliga arbete och uppfyll projektets obligatoriska reviewkrav.
Ändra bara egna coverage-rader när hela ID:t är styrkt.

Merga själv med merge-låset när aktuell PR-version har godkänd review
och alla obligatoriska kontroller är gröna. Dokumentera faktisk main-commit
och PR efter merge. Lämna uppdaterat minne och frigör reservationerna.
Läs därefter aktuell status, välj nästa lediga par själv och fortsätt
utan ny tilldelning eller prompt.
Vid blockerare: bevara arbetet, dokumentera nästa åtgärd och fortsätt med
oberoende delar inom ditt par, eller gör en uttrycklig RELEASE/överlämning
och välj ett annat tillåtet par. Ta aldrig någon annans lås för att agenten
är tyst. När inga lediga tillåtna delar finns, rapportera klart/upptaget/blockerat.

Rapportera faktisk status. Lokalt grönt, öppen PR, mergat och externt verifierat
är olika tillstånd. Inga krav, tester eller spärrar får försvagas för grönt.
```
