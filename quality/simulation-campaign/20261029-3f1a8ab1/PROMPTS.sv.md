# Startprompter för den gemensamma simuleringen

Kopiera relevant prompt till en behörig Claude- eller Codex-session. En prompt tilldelar inte resurser som saknas och ersätter inte fil-/producentclaims. Operativ status finns bara i quality/simulation-register/register.safe.json och PR930. #840 behåller historiska och formella claim-/handoffreferenser; flytta inte befintliga lås eller roller.

## Claude – samordnare för89 ID i sex spår

Du arbetar med heke99/gridex-ops-platform. Fortsätt den verkliga isolerade simuleringen enligt samordnings-PR https://github.com/heke99/gridex-ops-platform/pull/930.

Börja med AGENTS.md, quality/SIMULATION_STATUS.md, quality/simulation-register/README.sv.md och register.safe.json samt campaign.json och REPORTING.sv.md i denna katalog. Läs PR930:s senaste kommentarer och relevanta historiska claim-/handoffkvitton i #840. Verifiera din egen GitHub-läs-/skrivåtkomst. Dela inga tokens med andra sessioner.

Applikationsbasen är1c0c088cb4ed66d0dd8b3e34c9606019342a1a56. Dokumentationen läses från aktuell PR930-head, som ska registreras med exakt SHA. Utgå från verifierad oföränderlig SHA när arbetarnas grenar/worktrees skapas, inte från ett flytande FETCH_HEAD. Skriv inte över en befintlig arbetsyta. Eventuella senare produktfixar får små PR:er till main; en ändrad applikationsbas kräver dokumenterad omkvalificering.

Claude samordnar följande sex spår. Skapa en arbetare per oberoende spår där kapaciteten räcker och arbetsberoendena tillåter. Sju logiska spår betyder inte sju samtidigt startade tunga stackar.

1. Spår1,13 ID: MAIN03.01–.05; MAIN04.01/.03/.04; SITE01.01–.05.
2. Spår2,18 ID: TERM01.01–.05; TERM02.01–.08; TERM03.01–.05.
3. Spår3,17 ID: EDIEL01.01–.06; EDIEL02.01–.06; EDIEL03.01–.05.
4. Spår4,13 ID: MAIN04.02/.05; BILLNEG01.01–.05; MAIN05.01–.06.
5. Spår6,13 ID: DELIVERY01.01–.05; CUSTODY01.01–.05; MAIN06.01–.03.
6. Spår7,15 ID: UI01.01–.05; QA01.01–.05; QA02.01–.05. Kör slutkvalificeringen sist mot exakt integrerad slutcommit.

Codex samordnar spår5:s16 ID: EVENT01.01–.05, AUTH01.01–.06, API01.01–.05. Ta inte över dem eller befintlig CODEX-EVENTS-producent. Scenariofördelningen är inte en filclaim: verifiera befintliga ägare och reservera exakta ID/filer/producentresurser enligt repositoryprotokollet före skrivning. Aktivt ägd fil kräver uttrycklig avgränsad överlämning eller ägarens adoption. En kommentar i ett ärende räcker inte om atomisk claim krävs. Den befintliga main-leveransägaren behåller sin roll.

Finance-grenen finance/simulation-handoff-20261029-5f5cfa20 är referensunderlag, pinnad tillc400f6959d8c279fb518b7199fe6e77da30409c4. Den har divergerat353/249commits från kampanjbasen. Slå inte in hela grenen och blanda inte baser tyst. Granska relevanta exakta patchar och bevis, samordna med befintlig financeägare och lämna små fix-PR:er mot aktuell main efter regression.

Varje arbetare ska ha egen arbetsgren/worktree och isolerad DB, Auth-fixture, Storage, kö, lokal mailmotpart, portuppsättning och dokumenterad affärsklocka. Verifiera aktuell migrations-/schemaidentitet och tilldelningar före start. Ingen mutation i Roots befintliga databas. Aldrig två nativesviter mot samma DB. Använd syntetiska kunder och lokala motparter. Auth/JWT-klockan och affärstid måste beskrivas separat när tiden simuleras. En historisk eller utgången miljö är inte en aktiv tilldelning.

Kör genom normala UI/API/backendingångar och kontrollera verkliga databasrader, events och fysiska filer. Ange exakt när ett backendsteg ersätter UI eller en lokal motpart ersätter extern trafik. Återspela aldrig ett oklart affärsanrop innan native state och idempotens är avstämda. Bevara förbudet mot omskick av redan committad Site2-intake och okänd CONTRL. Applicera inte globala migreringar och starta inte en andra gemensam GEN/native-producent.

Alla arbetare måste efter varje atomiskt steg skriva egen FINDINGS.md och status.json med scenario-ID, arbetar-/session-ID, modell, appcommit/build/overlays, schemahash, miljö/DB-identitet, verkligt kommando, exit-/HTTP-resultat, native före/efter, artefaktref+SHA, begränsningar, blockerare och nästa steg. Skilj Source-modell, komponenttest, isolerad nativekörning, browserE2E och extern acceptans. Inga påhittade PASS eller sluträknare. Designvärden i äldre beskrivningar måste bindas till kvalificerade fixtures/orakel för denna bas.

Alla fel, misslyckade försök och uppmätta långsamma steg ska dokumenteras. Skilj produktfel från harness-/miljöfel och hypoteser. För prestanda: workload, råa tider, n, warm/cold, resurser och jämförelsebas. Bekräfta rotorsak innan optimeringspåstående. Hemligheter, råa miljöfiler och verkliga personuppgifter publiceras inte.

Arbetarna lämnar egna fynd-/statuspaket och fortsätter med nästa lediga ID inom sin scope. Vid blockerare dokumenterar de exakt vad som saknas och fortsätter annat oberoende arbete. Du samlar Claude-spårens rapporter och lämnar en säker sammanställning till PR930. En utsedd integratör uppdaterar det centrala registret seriellt genom granskade commits; låt inte alla arbetare samtidigt redigera/pusha centralregistret.

Samla och styrk först fynden. Deduplicera och prioritera med integratören. Rätta därefter små avgränsade fel inom verifierad filcustody, med findings-ID, originalfelkvitto, relevant positiv/negativ regression, fixcommit och omtest. Skrivändringar i Codex-ägda eller andra aktiva filer överlämnas enligt protokollet, inte genom parallella patchar.

Spår1/2/3 och fristående behörighetsfall kan gå parallellt. Spår4 behöver kvalificerade godkända snapshots, spår6 behöver originalsäkra underlag och faktisk XML, spår7 behöver slutversionen. Flytta inte ihop arbetarnas databaser: kör senare den normala sammanhängande integrationskedjan i en separat integrationsmiljö. Slutbeviset ska visa samma kund med flera anläggningar och olika avtal genom faktura till korrekt fysisk fil, inklusive idempotens, tenantgränser och kända negativfall. Två oberoende slutgranskningar och repositoryts relevanta kontroller krävs före merge.

Rapportera först din verifierade PR-head, egen session, planerade arbetsgrenar, lediga scope och miljötilldelningar. Markera PENDING/BLOCKED där något saknas. Arbeta sedan vidare självständigt inom styrkt scope och uppdatera findings/status löpande. Påstå inte att alla105fall är utförda bara för att listan eller en Sourceprofil är verifierad.

## Codex – samordnare för spår5

Du arbetar med heke99/gridex-ops-platform och operativ samordning i https://github.com/heke99/gridex-ops-platform/pull/930. Läs AGENTS.md, quality/SIMULATION_STATUS.md, quality/simulation-register/README.sv.md och register.safe.json samt campaign.json och REPORTING.sv.md i quality/simulation-campaign/20261029-3f1a8ab1/. Läs aktuella PR-kommentarer och relevanta historiska #840-claim-/handoffkvitton. #840 är inte en parallell operativ statuslista.

Verifiera egen GitHub-åtkomst och aktuell PR-head som exakt SHA. Applikationsbasen är1c0c088cb4ed66d0dd8b3e34c9606019342a1a56; dokumentations-PR:n ändrar inte appkoden. Använd egen ren gren/worktree från verifierad SHA, aldrig flytande FETCH_HEAD eller en annan agents arbetsyta. Kvalificera senare kod-/migrationsändringar och återanvänd bara gamla bevis med dokumenterad tillämplighet.

Du samordnar16 ID i spår5: EVENT01.01–.05, AUTH01.01–.06, API01.01–.05. Claude samordnar resterande89 i spår1/2/3/4/6/7. Samordningsreservationen ger inte fil-/producentcustody. Kontrollera och reservera exakta lediga resurser enligt repositoryprotokollet före skrivning; en kommentar är inte en atomisk claim. Aktivt ägda filer kräver exakt handoff eller ägarens adoption. Befintlig main-leveransägare behåller sin roll.

CODEX-EVENTS behåller EVENT-producenten och sina original. Begär en offentlig exakt tvåfilsgren/PR för migration20261028140000 och matchande test med base/head/tree, hash och bevis. Koden och miljön är inte tilldelade i denna samordningssession. Rekonstruera inte bytes och påstå inte att paketet är publicerat innan det faktiskt är det. Granska tidigare EVENT-PASS för tillämplighet; kör inte om dem utan ny anledning.

Dela upp självständiga Auth/API-uppgifter i egna arbetare där resurser och claims tillåter; duplicera inte den befintliga EVENT-producenten. Varje arbetare har egen DB/Auth/Storage/kö/lokal mailmotpart/portuppsättning och dokumenterad testklocka. Aldrig två nativesviter mot samma DB och ingen mutation i Roots databas eller Claudes resurser. Kontrollera migrations-/schemahash, giltig genuin Auth och faktisk miljötilldelning. En gammal miljö är inte en aktiv tilldelning. Håll real Auth-klocka och simulerad affärstid tydligt åtskilda; dela inga credentials.

Kör normala ingångar och verifiera native-/event-/filutfall med syntetiska kunder. Märk Source-, komponent-, native-, browser- och extern acceptans separat. Återspela aldrig okänt utfall utan avstämning av native state/idempotens. Applicera inte globala migreringar eller starta en andra gemensam GEN/native-producent.

Alla arbetare skriver FINDINGS.md och status.json per scenario med arbetar-/session-ID, modell, appcommit/build/overlays, schema- och DB-identitet, faktiskt kommando, HTTP/exitkod, native före/efter, logg-/artefaktref+SHA256, begränsningar, blockerare, nästa steg och cleanupkvitto. Spara även misslyckade försök. Mät långsamhet med workload, råa tider, n, warm/cold och resurser; skilj produktfel från harness-/miljöfel och hypoteser. Publicera inga tokens, råa miljöfiler eller personuppgifter.

Samla, styrk, deduplicera och prioritera fynd först. Lämna fynd i aktivt Claude-ägd kod i PR930 med exakta filer och begär adoption/handoff. Rättningar görs under verifierad custody som små PR:er till main, med findings-ID, originalfelbevis, positiva/negativa regressioner, fixcommit och omtest. Arbetare lämnar egna statuspaket; en integratör uppdaterar centrala registret seriellt. Fortsätt sedan med nästa lediga ID; dokumentera blockerare och arbeta vidare med oberoende tillåtna uppgifter.

Rapportera först verifierad PR-head, egen session, resurstilldelning och exakta claims. Påstå inga PASS för ännu ej körda orakel. Den sammanhängande slutkedjan i separat integrationsmiljö och spår7:s slutgrindar verifieras på exakt integrerad slutversion; databaserna slås inte ihop som ersättning. Två oberoende slutgranskningar och relevanta repositorykontroller krävs före merge.
