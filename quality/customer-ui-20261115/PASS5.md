# Fortsatt granskning: support och kundkortets fakturasammanfattning

Samma isolerade worktree och draft-PR #1051. Inga databas-, serveråtgärds-, protokoll-, scenario-/demo- eller produktionsändringar.

Supportlistan visar begripliga kontaktvägar i stället för interna tenant_support-källor. Plattformen kan fälla ut rå källuppgift. Öppna ärenden ligger först i en avgränsad, namngiven lista med tangentbordsfokus; avslutade ärenden finns kvar i hopfälld historik. Sammanräkningen heter Visade supportärenden eftersom befintlig loader är begränsad till 200 inlästa ärenden. Vid full inläst mängd anges att äldre ärenden kan saknas. Titel, beskrivning, kategori, prioritet, status och ärendelänkar behålls.

Kundnamnsreserven använder den befintliga bolagsägda joinens namn/nummer eller Kunduppgifter saknas. Den tidigare extra ofiltrerade CustomerName-läsningen tas bort. Skapa-/statusformulär använder samma serveråtgärder, behörigheter, bolagsfält och idempotensnyckel. Ingen skrivbehörighet tillkommer för läsare eller plattform.

Detaljhistorikens tio senaste inlägg visas direkt i bibehållen kronologisk ordning. Alla äldre inlägg finns i en hopfälld, tangentbordsåtkomlig lista. Kundsynlighet, interna anteckningar och samtalssammanfattningar behåller sina markeringar. Bilageläsfel beskrivs som läsfel. Filnamn och uppladdningsfält får plats på mobil. Samtliga supportdatum använder svensk lokal och Stockholmstid.

Fakturasammanfattningen är en serverkomponent eftersom den saknar klientinteraktion. Den används endast av kundkortets serverfil och dess tidigare råa array-props passerar därför inte längre denna klientgräns. SectionCard förblir en klientkomponent för sina andra användare, men får här bara färdiga sammanfattningselement. Teknisk blockeringsorsak visas bara i plattformens hopfällda panel; bolaget hänvisas till fakturaunderlaget. Fakturastatusalgoritm och fakturaruntime ändras inte.

Verifiering: 45 tester i 5 filer godkända med Node22 och befintlig loopback-nätverksgräns. De första nio nya renderfallen reproducerade åtta fel på tidigare sidkod; efter rättning passerar samtliga. Två extra sluttester bevarar plattformsdiagnostik och skrivarens svar-/uppladdningskontroller. Befintlig support-access-suite använder riktiga guard-/scope- och accessmodeller med mockade externa gränser. Två oberoende granskare godkänner aktuell slutdiff; båda körde den nya testfilens 11 fall samt diffkontroll.

Browser: 12 syntetiska lägen vid 390/1280 px, ingen horisontell sidöverströmning och 0 axe WCAG-fel. Öppna/stängda ärenden, kronologisk tidigare historik, förvald kund/telefonkanal, tangentbordsscroll och fakturalänk verifieras. Ett duplicerat namn på nästlade regioner hittades i browserkontrollen och rättades före slutkörningen. Se pass5-browser-results.json och browser-pass5.mjs. Ingen autentiserad liveverifiering, ny helkörning/coverage eller produktionsbuild påstås.

Statiska slutkontroller: app- och testtyper, Next typegen och genererad route-validator godkända. Riktad ESLint: 0 fel/0 varningar. RBAC: 24 kontroller utan varning. Service-role-ratchet godkänd, 2348 anrop mot baslinjens 2349. Originalarbetsytans git-status är tom. Normal CI krävs för den nya PR-versionen före eventuell seriell leverans.
