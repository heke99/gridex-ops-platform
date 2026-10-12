# Gridex OPS: resultat och återstående åtgärder

Granskningen omfattar OPS-kod, API-dokumentation och den anslutna OPS-databasens faktiska katalog och SQL-definitioner. Gridex Web och andra tenantprojekt är utanför scope. Lokal verifiering stödjer kodändringarna; den bevisar inte att driftmiljön är grön.

## Rättat i kodförslaget

- Bolag och behörigheter binds till den verifierade användaren/API-klienten; källmeddelanden och dokument läses inom exakt rätt bolag. Läsbara historiska data och tillåtna mutationer har separata livscykelregler.
- Customer-identitetsbindning, assertionens utfärdandetid och publika svar har rättats. Staff-nedladdningar får serverutfärdade spårnings-ID:n.
- Publicerade erbjudanden kontrolleras mot anläggningens energiriktning. Mätvärdesläsning paginerar utan tyst avklippning; fullmaktsåterspelning är bunden till rätt anläggning.
- Händelser, diagnostik, juridiska dokument och prisdata serialiseras enligt dokumenterade publika fält. Avsändarstyrda inkommande referenser kan inte lägga till PostgREST-filtervillkor.
- Leverantörsdiagnostik är läsande. Tvist- och leverantörshändelser jämför aktuell databasversion och fullständig JSONB-kvittens innan uppdatering så samtidiga kvittenser inte skrivs över.

## Dokumentation och äldre kopior

Dokumentationsförslaget är `2026-10-12.1`. Det normala Website/Customer/Staff-svarsformatet är fortsatt `2026-10-09.1`; onboarding är separat `2026-10-05.2`. En dokumentationsuppdatering innebär inget nytt versionskrav i anropet. De 46 tidigare frysta dokumenten är oförändrade.

Stödda äldre svarsprofiler kan väljas i operatörsägd klientkonfiguration. Anroparens versionsheader ändrar inte profilen. Felaktig profilkonfiguration blockerar affärskörning. Kända motsägelser i två historiska strikta scheman dokumenteras öppet; inga frysta filer skrivs om och inga faktauppgifter fabriceras för att passa dem.

## Kvar innan API:erna kan kallas gröna i drift

| Prioritet | Faktiskt fynd | Åtgärd |
| --- | --- | --- |
| P1 | Fem nödvändiga Customer-/dokument-retentionsfunktioner saknas i OPS-databasen. | Ägaren måste stämma av beroenden och leverera en granskad framåtmigration. Behåll spärrarna. |
| P1 | 46 interna kommandofunktioner saknas; 74 giltiga kommandokedjor når dessa beroenden. | Stäm av exakt kod/SQL/installerad databas per funktion och verifiera isolerat innan release. |
| P1 | Installerad aktörsbehörighetsfunktion saknar källkodens uttryckliga deny-kontroller. | Granska och leverera den deny-medvetna SQL-definitionen. Separat Staff-kontroll är redan korrekt. |
| P1 | Native Partner-registrering saknar atomisk jämförelse mellan erbjudandets och anläggningens riktning. | Kodens förkontroll är rättad; den föreslagna SQL-spärren måste också granskas och släppas. |
| Kvalificering | Ingen konfigurerad verklig Staff-/Customer-bindning kunde kvalificeras i denna granskning. | Verifiera autentisering, rätt konto/bolag, behörigheter och efterföljande databasresultat med en godkänd integration. |

[Databasunderlaget](release-proposals/README.md) innehåller exakta saknade namn, källfiler och konkreta SQL-förslag. Dessa är inte applicerade eller registrerade migrationer. 21 senaste definierande migrationsfiler saknar registrering; migrationshistorik ensam bevisar inte vilka funktioner som är installerade. Den bredare statiska beroendelistan är granskningskandidater, inte ytterligare bevisade fel eller en färdig installationsordning.

Ingen verksamhets-RPC, extern leverantörsförfrågan, e-post, native-skrivning, deployment eller kanonisk GEN-körning har utförts. Befintliga Ediel-ägare behåller sina uppdrag och resurser. Se `root-consolidation.json`, familjerapporterna och den slutliga verifieringsmatrisen för granskningens räckvidd och begränsningar.
