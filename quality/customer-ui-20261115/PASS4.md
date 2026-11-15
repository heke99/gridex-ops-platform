# Fortsatt granskning: meddelanden och händelser

Separat worktree och draft-PR #1051. Originalarbetsytans scenario-/demoarbete, producenter, serveråtgärder och protokollregler ändras inte.

- Meddelandedetaljen visar affärsnamn, kundnamn, nätägare och svensk tidslinje. Avsändar-ID, referenser, råa felorsaker och payload är begränsade till plattformens vy. Tekniska detaljuppgifter ligger i befintlig hopfälld panel. Kunduppslag är bolagsfiltrerat, främmande meddelandebolag nekas och saknad kund ger ingen osäker kundkortslänk.
- Mottagningsbekräftelse betyder inte avslutat affärsärende. Inkommande mottagande påstår inte att behandlingen är klar. Okända statusar får begriplig reservtext.
- Meddelandelistan använder affärsord även i filter och sammanräkningar. UTILTS motsvarar Mätvärden. Sökning matchar kundnamn, kundnummer och nätägare i samma senaste inlästa 100 meddelanden, 50 utskick och 50 uppgiftsbegäranden; äldre referenssökning kvarstår. Alla distinkta etikett-ID:n i detta begränsade underlag läses, även pending-kunder efter de första 100. Kundetiketter är bolagsfiltrerade.
- Händelser får kontrollerad affärstext i bolagsvyn i stället för producenternas PRODAT/Ediel/route-texter. Specifika adress-/nätägar-/anläggningsorsaker visas där koden styrker dem; andra detaljer nås på kundkortet. Plattformen behåller originaltexterna och diagnostiken. Köade och planerade utskick visas inte som väntande affärssvar; validerat tidigaste utskick visas när det finns.
- Länken Öppna kundkort leder till kundkortets översikt för bolagsanvändare. Plattformens originallänkar har etiketten Öppna ärende. Mobilens informations-/datumrader staplas. Filterknappens kontrast förbättrades efter ett faktiskt axe-fynd.

Verifiering: 46 tester i 4 filer godkända med Node22 och befintlig loopback-nätverksgräns. Nya renderfall kontrollerar roller, bolagsgränser, okända statusar, sökning, >100 kundetiketter, producenttexter och planerade utskicksdatum. Två oberoende slutgranskare godkänner aktuell källkod; båda körde 38 tester i de två direkt berörda filerna och diffkontroll.

Browser: 8 syntetiska lägen vid 390/1280 px, ingen horisontell sidöverströmning, 0 axe WCAG-fel i bolagsvyerna. Plattformens payload är dold tills panelen öppnas. Detta är mockad komponent-/sidverifiering, inte autentiserad liveverifiering. Se pass4-browser-results.json och browser-pass4.mjs. Ingen full enhetstest-/coverage-helkörning eller produktionsbuild upprepas för denna batch. Normal PR-CI avgör leverans; ingen main-merge eller driftsättning utförs.

Slutliga statiska kontroller: app- och testtypkontroll, Next typegen och genererad route-validator godkända. Riktad ESLint: 0 fel/0 varningar. RBAC: 24 kontroller, 0 varningar. Service-role-ratchet: 2348 anrop mot tillåten baslinje 2349. Originalarbetsytans git-status är tom.
