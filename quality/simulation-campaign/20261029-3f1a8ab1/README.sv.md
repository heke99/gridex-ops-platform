# Gemensam simulering för Codex och Claude

Detta är samordningspaketet för en ny källbunden kampanj. Paketet kör inga scenarier och flyttar inte befintliga ägares filer eller processer. Läs först repositoryts AGENTS.md och aktuell samordning i #840.

## Ren PR och gemensam åtkomst

Bascommit: `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`. Båda modellerna arbetar i samma repository och läser denna PR. Kontrollera egen GitHub-åtkomst; Codex åtkomst bevisar inte Claude-sessionens skrivåtkomst. Ingen token ska delas mellan sessionerna.

Den gemensamma draft-PR:en innehåller initialt bara dessa fem samordningsfiler. En integratör uppdaterar PR-grenen med granskade commits, utan force-push eller andra agenters oredovisade ändringar. Varje arbetare använder egen gren/worktree från bascommit och exakt en namngiven testmiljö. PR-grenen är inte varje agents arbetsgren. Befintlig seriell main-leveransägare behåller mergeansvaret.

Den gamla gifted-hamilton-grenen och c9/R35/R40-simuleringen är historiska jämförelsekällor, inte denna bas. Tidigare kvalificerade bevis får återanvändas efter dokumenterad source-applicability. Status NOT_VERIFIED_FOR_CAMPAIGN_BASE betyder inte att inga gamla tester har körts.

## Fyra spår

| Spår | Föreslagen utförare | Grupper | Antal designfall |
|---|---|---|---:|
| Finance | Codex | MAIN03–06, BILLNEG01, QA01–02 | 34 |
| Kund/avtal | Claude arbetare 1 | SITE01, TERM01–03, DELIVERY01 | 28 |
| Ediel/custody | Claude arbetare 2 eller befintlig ägare | EDIEL01–03, CUSTODY01, EVENT01 | 27 |
| Access/API/UI | Claude arbetare 3 | AUTH01, API01, UI01 | 16 |

Detta är en partition av 105 design-ID:n, inte en automatisk tilldelning. EVENT01.01–05 har befintlig CODEX-EVENTS-ägare: bevara den rollen och granska dess källbundna rapport6497847260 före ny körning. Övriga aktiva ägare, filclaims och producentroller måste också stämmas av innan arbete. En vanlig issuekommentar ersätter inte repositoryts atomiska claims där sådana krävs.

Finance äger inte automatiskt alla filer som TERM02 behöver. API01 delar kunddomän med kundspåret. UI01 verifierar andras resultat. CUSTODY01 kräver Finance-avstämning för låsta fakturakällor. QA01–02 är gemensamma integrationsgrindar och körs slutligt på den integrerade versionen.

## Isolerade resurser

Varje spår har egen DB, Auth-fixture, Storage, kö, lokal mailmotpart, portar och affärsklocka. Kvitton anger resursidentiteter, migrationshash och faktiskt tillämpade lokala ändringar. En utsedd aktör per miljö; inga två spår skriver samma databas eller kö. Syntetiska kunder och lokala motparter används. Verklig extern acceptans förblir ett separat beviskrav.

Skydda befintliga körningar. Saknad eller utgången VM/Auth är blockerare, inte skäl att ändra cookies eller återspela ett oklart affärsanrop. Vid okänt utfall: kontrollera native state och idempotens först. Bevara tidigare spärrar mot omskick av committad Site2-intake och okänd CONTRL.

## Alla dokumenterar

Varje arbetare skriver egna FINDINGS.md och status.json enligt REPORTING.sv.md i sin egen packet. Integratören sammanställer centrala scenarier och fellista. Arbetarna skriver inte samtidigt i centrala registerfiler. Nya paket är append-only i betydelsen att originalkvitton och misslyckade försök behålls; rättelser får nya kvitton.

Först samla och styrk fel, långsamma steg och miljö-/harnessproblem. Därefter triagera och rätta avgränsat. En rättning räknas som verifierad först efter relevant regression och dokumenterad omkörning på rätt kodversion. Återstående scenario-ID:n väljs efter varje avslutad uppgift; tidsgränser och verkliga blockerare ger checkpoint, inte tyst stopp eller påhittat PASS.

## Ordning och leverans

1. Verifiera bas, behörigheter, befintlig custody och reproducerbar miljö.
2. Kund/avtal, befintlig Ediel-producent och fristående API/behörighetsfall arbetar parallellt.
3. Sammanställ kvalificerade avtal, anläggnings-, mät- och priskällor genom normala flöden i integrationsmiljön. Slå inte ihop arbetarnas databaser som ersättning för detta.
4. Kör kundkedjan med flera anläggningar till faktura och fysisk fil. Kontrollera negativfall och idempotens.
5. Verifiera UI/API och QA på slutlig kodversion med två oberoende slutgranskningar enligt AGENTS.md och relevanta kontroller.

Denna samordnings-PR kan först hålla dokumentation, testharness och säkra sammanfattningar. Större oberoende produktfixar bör få små separata fix-PR:er med findings-ID, eller granskade avgränsade commits om de ska ingå i samma PR. Integratören beslutar ordning; inga gamla helgrenar importeras för att samla allt i en PR.

Se PROMPTS.sv.md för startprompt och campaign.json/scenarios.safe.json för bas och ID:n. Alla nya körningar och produktfixar är ännu ej utförda av detta paket.

## Historiska designvärden och proveniens

Siffror i scenarioförklaringarna, exempelvis28källor,1809.51SEK,1247filer och äldre testantal, är ärvda designvärden. De är inte kvalificerade orakel för denna nya bas förrän respektive scenario har bundits till aktuella fixtures och krav. Definitionerna kommer från originalartefakten all-systems-scenarios.safe.json, GRIDEX_ALL_SYSTEMS_SCENARIO_CATALOG_V5_DESIGN_ONLY. SHA25696518c184c240dafa5890df8f6b375b0730acd90f0e97d8f39063fb68c329df3 avser originalets råa filbytes, inte denna projektion eller det föränderliga lokala registret. Proveniens och listan publicerades i #840-kommentar6501763644 och granskades i6502149285.
