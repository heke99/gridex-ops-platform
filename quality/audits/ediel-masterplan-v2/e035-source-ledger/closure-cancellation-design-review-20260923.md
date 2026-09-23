# Oberoende read-only granskning av avgränsad Z05C-design

Granskat: `/workspace/scratch/db7cad0629c3/closure-cancellation-design.md`, ovanpå tidigare granskad closure-design inklusive obligatorisk avsnitt 3A. Ingen implementation, databasändring eller bredare E035-bedömning har gjorts.

**Source/spec: GODKÄND för den angivna avgränsningen.**

**Design quality: GODKÄND på designnivå; inga konkreta blockerande brister identifierade.** Detta är inte godkännande av en ännu oimplementerad SQL-parser, cancellation-owner eller native bevisning.

## Källstöd

Jag läste om originaltexten i den tidigare hashverifierade P-versionen (`83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`):

- P13–14 skiljer undertyp C/Z24 från meddelandefunktion och rekommenderar behandling av original före annullering. Designen använder därför inte BGM5 som cancellation-identitet och tappar inte bort ett tidigt ankommet C.
- P42 anger unikt dokument-id, BGM9 original och BGM5 ersättning. Funktionen är valfri. Kravet på annat dokument-id än målets är välgrundat; att hålla BGM5/C är en ärligt avgränsad stödnivå.
- P50 anger obligatoriskt DTM93/fält211 i Z05 och format203.
- P123 kräver LI för Z0xC/Z1xC lika med motsvarande meddelande som annulleras. Det gör inte LI globalt unikt. Designens explicita mål, gemensamma objekt/parter/supply, måltyp L/LK och krav på entydighet undviker den feltolkningen.
- `lib/ediel/rulebook/prodatSubtypeRegistry.ts` medger C/Z24 i Z05. Det är en kontroll av befintlig implementation, inte ersättning för originalkällan.

Exakt lika stoppminut mellan C och mål behandlas uttryckligen som en säker supportbegränsning, inte som ett påstått krav härlett ur P123. Det är korrekt. Jag fann inget nytt krav på föregående Z08 eller någon ogrundad tolkning av finalmätvärden i förslaget.

## Avgörande designgränser

SQL-bindningen löser samma typ av risk som tidigare avsnitt3A: båda originalen läses av databasen från förseglade källrader och parsas oberoende. Mål-ID/hash/assessment/factsHash är referenser till lagrad evidens, medan ursprunglig DTM93, LI, funktion, undertyp, dokument, objekt och parter rekonstrueras ur respektive original. En konsekvent ändrad minut+UTC inom samma kalenderdag eller ett lånat LI från annat LIN får därmed inte passera enbart genom DATE/hash-likhet. Designen kräver just dessa negativa appendprov.

Målet måste ha sin senaste accepterade, bevittnade assessment i den sparade reviewsnapshoten. En senare målrevision utan vittne får inte ge fallback. Snapshot cutoff, witness-tid och assessedAt är uttryckligen ordnade; native samtidighetsprov ingår. För själva C måste den befintliga timeline-regeln också användas: en senare C-assessment känd vid cutoff utan tidsenligt vittne gör den tidigare godkända C-versionen otillgänglig. Detta följer av den återanvända revisionsmodellen och får inte ersättas med sökning efter valfri tidigare accepterad cancellation-marker.

Jag kontrollerade även `continueSupplyPeriodFromZ05C`: designens beskrivning av limit3, aktiv-rad-no-op, payload-datumfallback och faktisk mutation stämmer. Den nya gränsen kräver samma historiskt kvalificerade supply, nu aktiv utan slutdatum och med just C-originalet som source. Den kan därför inte enbart omtolka en orelaterad aktiv rad eller ett framgångsliknande returvärde till cancellation-auktoritet. Exakta och fullständiga konfliktsökningar behövs enligt designen; legacy-funktionens tre rader är inte bevisuniversum.

Projektionen tar bort endast den namngivna closure-kanten och behåller oföränderlig ursprunglig coverage. Andra closure-kanter, oklara correction-kedjor och andra C för samma mål förblir verksamma eller blockerande. Ingen ny start eller inventory skapas. Den normala Z04/Z06/Z10-kedjan byggs fortfarande från den kompletta källmängden; en saknad eller okvalificerad strukturändring efter det tidigare stoppet blir hold. Detta förhindrar att cancellation oavsiktligt återställer gamla mätare/register.

Äldre sparade cutoffs förblir stängda, mellan receipt och witness hålls den berörda tiden, och en senare godkänd cancellation kan ändra en ny bedömning av historisk tid utan att skriva om tidigare slutligt ACK/kvantitet. Det är konsekvent med den angivna bitemporala modellen.

## Liten precisering inför implementation

Formuleringen att återställd tidigare coverage kan ha en ”earlier known bound” bör läsas strikt som **den exakt lagrade tidigare coverage-gränsen**, aldrig som en ny beräknad tidigare gräns. Den godkända closure-designen tillåter för denna minimala slice endast tidigare `validTo:null` eller samma exakta stopp som closure. Om det senare förekommer måste cancellation lämna den redan lagrade gränsen kvar. Detta är en redaktionell precisering, inte en blockerande invändning: huvudregeln ”remove_named_closure_only” och den oförändrade coverage-referensen anger redan rätt beteende.

De angivna native proven är relevanta för de avgörande riskerna. Godkännandet förutsätter att implementationen faktiskt följer dessa gränser och verifierar dem; det godkänner inte att ett komplett JSON-mockresultat ersätter verkliga original, ägarrader, append och separata vittnen.
