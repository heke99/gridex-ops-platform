# Fortsatt sökning: inställningar och mätvärden

Samma isolerade gren och PR #1051. Originalarbetsytan för scenario-/demoarbetet är orörd. Inga konfigurationsändringar, verkliga anslutningstester, utskick eller produktionsfrågor har utförts.

## Rättningar

- Kundinloggningens bolagsvy visar anslutning, senaste kontroll och om verifierad inloggning krävs. Tekniska leverantörsadresser, audience och nyckelverktyg skickas inte till en klientkomponent för vanliga bolagsanvändare. Superadmin har kvar konfigurationen i en hopfälld panel. Läsfel visas som okänd status, inte som avstängd funktion.
- Fakturainställningarna visar leverantör, anslutning, utskick, historik och misslyckade poster utan miljövariabelnamn, interna körnings-ID:n eller systemhändelser. Leverantörsval, test-/ordinarie fakturor, Nordfins kundnummer och utskick använder samma serveråtgärder/fältnamn och deras befintliga skrivbehörigheter. Läsare får inga skrivformulär. Fel vid läsning av inställning/katalog visas uttryckligen och spärrar skrivkontrollerna.
- Mätvärden visar kundnamn, fysisk anläggningsidentitet, mätpunktsnummer, energi, period, rättelser och ursprungligt ärende. Tekniska importer och interna UUID-fält finns bara i superadmins tidigare vy.
- Sökningen i bolagsvyn matchar de synliga kund-, anläggnings-, mätpunkts- och datumuppgifterna inom samma begränsade mängd senaste inlästa poster. Äldre interna sökreferenser fungerar fortfarande.
- Etikettläsningarna är avgränsade till den valda bolagskontexten via tenantSelect. Anläggningens kund och mätpunktens anläggning måste stämma innan uppgifterna visas. Saknat bolag stoppar läsningen. Inga scheman, RLS-regler, autentiseringskontroller eller serveråtgärder ändras.

## Underlag och begränsningar

Den samlade riktade kontrollen: 303 godkända tester i 27 filer. Den omfattar tidigare UI-tester, befintliga scope-/fakturaåtgärdskontroller, nya tester för roller, läsfel, anläggningsägande och affärssökning samt de korrigerade CI-fallen. Se pass3-final-targeted.log för slutresultat.

App- och testtypkontroller, Next typegen/route-validator, riktad lint (0 fel/0 varningar), RBAC24, publiceringsregression och service-role-ratchet är godkända. Browser: 23 fall vid 390/1280 px, inga horisontella sidöverströmningar och 0 axe WCAG-fel i testade bolagsvyer. Två oberoende slutgranskare har inga kvarvarande fynd. Payload-/formulärregressionen för fakturavyn misslyckas med tidigare sidkod och passerar efter rättningen.

Browser och datafrågetester använder syntetiska, mockade underlag. Det är inte autentiserad liveverifiering eller full produktionsbuild. Supabase-färdigheten tillämpades för datagränserna; aktuell .in()-dokumentation och changelog kontrollerades. Inga Supabase-skrivverktyg eller produktionsprojektfrågor användes.

Föregående PR-head har misslyckade CI-enhetstest-/coveragejobb. Jobbmetadata identifierade teststegen; GitHubs logg-/artefaktvärd nekade nedladdning. Motsvarande full lokal enhetstestkörning startades med Node 22.23.5 och samma loopback-nätverksgräns för att fastställa orsaken. Helkörningen avslutades med 25 147 godkända tester, 3 fel och 4 förkonfigurerade hoppade tester. Felen var två äldre förväntningar på teknisk protokolltext i bolagsvyn samt en exakt källkodsassertion om mätvärdessökningen.

De två berörda testfilerna uppdaterades. Parallella laddningar och bolagskontext kontrolleras fortfarande exakt. Processfallen verifierar aktuella affärsutfall, samma kvalificerade RPC-indata/antal, nekad läsning och frånvaro av upprepad förberedelse med den verkliga nya knapptexten. Det ursprungliga protokollunderlaget verifieras dessutom i ett tillagt plattformsfall. Två oberoende granskare har godkänt teständringarna.

Efter helkörningen ändrades endast dessa tester; produktionskoden var oförändrad. De berörda fallen passerade därefter i en riktad körning. Hela monolitiska sviten och coverage har inte körts om efter denna testuppdatering; slutlig CI för den nya PR-versionen återstår.
