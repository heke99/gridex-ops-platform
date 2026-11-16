# Körplan: avsluta ursprungliga scenarier i paket

Aktuell verifierad status: 43 FULL ORIGINAL PASS, 1 dokumenterad GAP och 61 ofullständiga av ursprungliga 105. Senaste oföränderliga per-ID-underlag är ledger v5 (d29f2f05). EVENT, API och AUTH är färdiga. Scenariostatus ändras bara efter faktisk körning och granskning mot originalfacit.

## Nästa paket och fortsättning

1. Kör EDIEL02.05 samt EDIEL03.01–.03 i samma isolerade miljö: fel mottagare, SMTP451, SMTP550 och avbruten anslutning efter DATA. Gemensam riktig inloggning, ny normal mottagaridentitet, fyra verkliga MIME/IMAP-inleveranser och normal köhantering. Tre normala CONTRL går genom riktig Storage och separata TLS-mottagare. Ett verkligt policyfel är ett dokumenterat utfall; det ska inte hindra nästa oberoende felprov.
2. Därefter EDIEL03.04–.05 tillsammans: avbruten egen claim-process och stödd återtagning, samt ACK-timer före/efter deadline genom befintlig kontrollerad klockparameter. Källpaket och originalfacit förbereds parallellt med första paketet.
3. Gruppera övriga ofullständiga fall efter gemensamt exekverbart beroende. Prioritera normala körklara flöden. Utred positiv import separat med befintlig profilerare och en minimal riktig Next-värd, utan att blockera oberoende scenarier.
4. Efter varje paket: säkra faktisk avslutning, granska originalkriterier, uppdatera per-ID, fel, död kod och rättningsväg. Fortsätt nästa paket inom samma uppdrag. Status som blockerad kräver precist saknat underlag eller uppmätt körhinder; källkodskontroll blir aldrig en simulerad PASS.

## Undvik att tidsfönster löper ut under förberedelse

Hela statiska paketet ska vara fryst före förnyelse av miljöns servernycklar. Förnya därefter via samma kvalificerade normala underhållsväg, bind aktuella metadata och starta direkt. Oförändrade källgranskningar återanvänds uttryckligen; endast faktiska ändringar granskas igen. En enda backendproducent behåller hela kedjan, inklusive förnyelse, så att överlämningar inte förbrukar tidsfönstret. Befintliga skydd för återstående giltighet får inte kringgås.

2026-11-16: AC-fönstret passerade startgränsen 07:19:29 UTC före körstart. Ingen fyrfallsinloggning eller affärskörning gjordes. Producenten fortsätter med nästa kvalificerade förnyelse, utan ny generell källgranskning av oförändrade komponenter.

## Arbetsfördelning

- execute_eight_parts: ensam producent för backend/körning; normal körväg, isolerad DB/REST/TLS, ett förberett kommando-paket.
- review_plan_domain: minsta fungerande normala headless modul-/API-koppling och dess verkliga native förutsättningar. Ingen ny generell plattform.
- ediel_test_identity: originalfacit, signatur/count/replay/felstatus-orakler och oberoende resultatgranskning.
- qa_remaining_checks: oberoende käll-/körmålskontroll och faktisk avslutningsgranskning; ingen konkurrerande backend.
- remaining_coverage_inventory: per-ID-bokföring och nästa delade beroendebatch.
- review_plan_execution: avgränsad oberoende kodgranskning när författarens slutversion finns.
- Root: prioritering, faktiska nödvändiga körscopes och beslut om fullständigt styrkt scenariostatus.

## Regler som hindrar nya sidoprojekt

Alla statiska kod-/filsystems-/TLS-/port-/resurs-/leaseförutsättningar ska vara klara före inloggning. Dynamiska riktiga affärs-ID:n binds först när native operation faktiskt returnerat dem. Återanvänd oförändrade verifieringar med uttrycklig tillämplighet. Ingen tredje generell Root-grind. Rätta bara fel som stoppar den valda batchen; övrig kodstädning och generiska verktyg hålls.

Ingen gammal private805-budget får kringgås. En verklig headless körväg får en separat motiverad och granskad ändamålsbudget. Behåll riktig GetUser-aktör, bolagsgränser, normala funktionsguarder, SQL8s, verklig TLS/signatur och korrekta lease-/utloggningskrav.

Original105 och nya funktionella fixtures redovisas separat. Saknade28meddelanden/1809,51/XSD ersätts inte med uppfunnet facit. Komponent-PASS är inte helt scenario-PASS. Varje original får till slut verifierat PASS, styrkt produktfel/GAP eller en exakt kvarstående blockering; externa saknade underlag markeras uttryckligen och upprepas inte som oändliga väntelägen.


## Aktuell miljöförutsättning efter verkligt konstruktionsprov

2026-11-16: De oberoende EVENT-fallen är redan färdigverifierade. Köordningen fortsätter med fyrpaketet EDIEL02.05/03.01–.03, därefter03.04–.05 och accepterad BASE/dubblett02.01. Originalhistorik och officiell extern specifikation som saknas får inte ersättas med uppfunna originalresultat.

Den tidigare resursgränsen1152MiB WS är INTE längre kvalificerad: samma CREATE registrerades sent efter30s-timeout, och exakt borttagning av den aldrig startade containern gav observerat2244390912 byte rått återvunnet utrymme. Exakt tid till färdig konstruktion är okänd. Tidsgränsen90s har därför inte verifierats heller. Ingen ny tung molnkörning görs under den gamla budgeten.

Användaren har valt att undersöka Mac med Codex-appen. Först körs det granskade läsande lokala preflight-paketet. Därefter beslutas Linux-körmiljö, arkitektur och lagring; först sedan export/överföring och nya lokala baslinjer. Inga databaser eller hemligheter ingår i preflight-ZIP. Befintliga CIDs, PID-kontroller, Linuxbinärer och absoluta sökvägar får inte behandlas som direkt portabla.

Granskningsarbetet återanvänds vid överföring där kod och förutsättningar är oförändrade. Lokal miljölikvärdighet måste däremot visas. Nästa verkliga framsteg är verifierad körkapacitet och därefter verkliga scenarioresultat, inte fler kopior av källgranskningar.
