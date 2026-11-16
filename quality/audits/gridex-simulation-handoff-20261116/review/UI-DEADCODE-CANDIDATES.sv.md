# Kundlista och dödkod: avgränsad granskning

Granskat mot ren Main `bf32b7e01fbd0511972ba8977c61d412a018e416`, utan implementation, tester eller backend. Exakta källhashar och 33-posters kontroll finns i `UI-DEADCODE-CANDIDATES.safe.json`.

Den konkreta leveransluckan är att **1d2bc476 bara är en förfining**. Hela 42703-rättningen kräver även `a9b5f3f35d652d968eb45a54d5096c326909543e`, som inför hjälparen, läsningen och UI-kontraktet. Root har nu sparat denna förälder separat med SHA256 `69520dae6cb053ae6e7e2d5f8e89adf869e169ab0d77be0b70ba4fdeca37a93c`; inget är applicerat. Den ursprungliga femraderspatchen ensam är fortfarande ingen fullständig rättning.

Inga nya belagda produkt- eller tenantfel har hittats i dessa tre kandidater. Den kompletta kundlistekandidaten grupperar avtalsläsningen per faktiskt bolag, använder tenantpredikat och avvisar främmande ägande. Staff-sökningen och dess offentliga DTO bevaras. Ofullständiga avtalsberoende filter stoppar uttryckligen; NULL, blandat, utan avtal och läsfel skiljs åt. Definitionen gäller lagrade avtal, inte effektiv faktureringspolicy.

Dashboardpatchen tar bort en oanropad writer inom den granskade käll-/konfigurationsgränsen. Main-filen har exakt samma före-hash som kandidaten och dess kvarvarande prefix har exakt efter-hashen. Normal RPC-/vyläsning, månadsmetrics, tabeller och behörigheter ändras inte. Global frånvaro av dynamiska eller externa anrop är inte bevisad. Regression, typkontroll, lint och bygge är fortfarande NOT_RUN.

Dödkodspatchen b5c5cd5 är **två daterade dokument, ingen rensning**. Originalräkningen 33=24 lokalt borttagna/9 behållna bevaras; den separata dashboardändringen gör inte automatiskt detta till25/8. De187 onådda grafkandidaterna får ingen dödkodsdom. Samtliga33 deklarationstoken finns fortfarande i de kontrollerade Main-filerna; detta bevisar varken att de är levande eller döda och visar inte runtime-adoption.

De angivna katalogerna för den andra tråden finns inte i den här arbetsytan. Faktisk filöverlappning är därför okänd. Kundlistans pageparts, detaljsidans pagepart och getCustomers är möjliga gemensamma ytor; vänta in den andra trådens exakta slutversion och gör sedan en liten komposition mot aktuell Main. Inga främmande filer har ändrats eller reserverats.

Kvar inför eventuell adoption: relevanta kundliste-/staff-/operations-regressioner, semantisk TypeScript, lint, relevant Next-bygge och genuin native/UI-kvalificering där den behövs; dashboardens befintliga regression; därefter normala oberoende slutgranskningar och CI. De äldre41 komponentkontrollerna är historisk evidens, inte en ny grön Main-komposition. Denna granskning ger inget nytt scenario-PASS och ingen merge-/driftsättningsklarhet.
