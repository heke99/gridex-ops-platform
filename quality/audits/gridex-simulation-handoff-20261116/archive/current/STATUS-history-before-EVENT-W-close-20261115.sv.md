# Gridex OPS – aktuell körstatus

38 helt godkända scenarier, 1 dokumenterad lucka och 66 ofullständiga av 105. Komponentkontroller räknas separat.

Aktuell brytpunkt: 2026-11-15 cirka 20:00 UTC. E/W körde riktig inloggning och observerade att publiceringsformuläret blev redo: React-action saknades initialt och fanns efter 1,783 sekunder. Därefter nådde exakt ett publiceringsanrop Main. HTTP 200 var ingen kvittens på publicering: oberoende databasläsning visar fortsatt utkast och ingen publicering. Serverns felspår visar `contract_version_not_publishable` med `tenant_go_live_not_ready`: produktionskrav för routing, BRP och avsändaridentitet blockerar testbolaget. Ingen intake, TERM eller retry kördes. Egen session och resurser är korrekt avslutade och oberoende verifierade: Auth-utloggning204, sex native sessions-/tokenkontroller noll, browser och registrerad processgrupp stängda. En egen driftfelrad från publiceringsnekandet bevaras. Efter affärssteget ändrade utloggningen endast fyra Auth-scope; övriga518 och råmetadata/sju sekvenser är oförändrade.

Rätt väg är normal formuläråtgärd med faktisk readiness, följd av native-kvittens och först därefter kundintake och osignerad avtalsändring via ordinarie RPC. Vi utreder en uttrycklig LOCAL_TEST_ONLY-behörighet som bevarar produktionskraven. Produktionsstatus, BRP-identitet eller signatur ska inte fabriceras.

Tidigare denna omgång sparades och granskades testbolagets juridiska profil genom två riktiga formuläranrop. Katalogförsök C och D gav andra avgränsade harnessproblem; deras exakta synlighets-/headerorsaker är fortfarande inte belagda. E-resultatet bevisar endast den aktuella körningens orsak.

Parallella spår: normal EDIEL-inläsning med egen TEST-brevlåda; produktutfärdad tvåanläggningsfabrik med ordinarie beräkningskärnor; importens ursprungliga PostgreSQL57014 via ett mindre genuint API-test; samt oberoende granskning och dokumentation. En producent serialiserar delad backend och Auth. Källkod, orakel och granskning körs parallellt.

Tvåanläggningskandidaten har fått två konkreta granskningsfynd: fel tabell för slutlig ACK-projektion och saknad slutlig JWT-expirykontroll. Rättningar pågår före native-körning. EDIEL-oraklet har förstärkts mot ändrade befintliga meddelanden och felaktig mailbox-scope. Tre oanvända harnessfunktioner är borttagna i en separat kandidat; de läggs inte till de tidigare 33 kvalificerade produktidentiteterna.

MainW är verkligt startad med egen TMP-cache och verifierad beroendealias. Avslutade stora härledda pgmeta-arkiv har förvarats med återställningskedja och frigjort cirka 898 MB TMP. Detta är resursresultat, inte scenario-PASS.

Fullständigt aktivt fyndregister: FINDINGS.safe.json. Per-ID-status: /workspace/gridex-per-id-execution-ledger-20261115/per-id-execution.v2.safe.json. Tidigare status bevaras i STATUS-history-before-E-W-20261115.sv.md och CHECKPOINT.md. Saknade originalmeddelanden och officiellt Nordfin-XSD ersätts inte med påhittat facit.

Kvarvarande66 är nu fördelade i separata beroendegrupper i /workspace/gridex-next-batch-dependencies-20261115/NEXT-BATCH-DEPENDENCIES.safe.json. Katalogblockeraren påverkar nio SITE-/TERM-fall och stoppar inte EVENT eller EDIEL-inläsning.

Senaste paketförberedelse: EVENT W har verkliga fil-/TLS-förkontroller och tre godkända transportkontroller utan nätanrop. En ny genuin 1800-sekunders operatörssession blev faktiskt READY 20:57:14 UTC (helper3644312), med hålltid till21:27:14. Ny full baslinje och backup fångas före Main-stopp, cacheåtervinning och den sena privata körplanen; inget affärsanrop har ännu kvitterats. API-diagnostik V3 är källgranskad, men ännu inte körd mot backend. Katalogkandidaten hålls tillbaka för ett belagt glapp i automatisk händelselineage; rättning pågår före införande.
