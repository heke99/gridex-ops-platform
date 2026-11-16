# Gridex: samlad simuleringsstatus

Kanonisk status för de 105 ursprungliga scenarierna är **38 fullständiga PASS, 1 dokumenterat gap och 66 ofullständiga**. K13 gav tre faktiska native ACK men nådde varken ATTEST eller import. Inget nytt fullständigt PASS eller produktfel har etablerats av K13. Rapporten är en lokal dokumentationsartefakt; produktadoption och normal leverans till Main återstår separat.

[105SCENARIOS.json](105SCENARIOS.json) bevarar samtliga ursprungliga orakel, per-ID-statusar och kvarvarande kriterier byteidentiskt. Basledgerns bryttid är 15 november 2026 kl. 02:53:22 UTC. [FINDINGS.json](FINDINGS.json) innehåller en ny immutable kopia av Roots aktuella **14 registerposter**, senare komponentbevis och en ändlig kö för de 66 ofullständiga fallen. Registerposterna är inte ett livstidsantal upptäckta fel, och komponentresultat ändrar inte scenariotalen automatiskt.

## K13: tre lyckade steg, sedan missat körfönster

ISSUE, RECEIVE och PREPARE fick faktiska ACK och förseglade kontrollpunkter. Root granskade det nya avtalsdokumentet före den planerade ATTEST. Dokumentgranskningen sparades kl. 16:59:18.851 UTC och den oberoende ATTEST-granskningen kl. 16:59:46.864. Det ursprungliga sista inträdet med 900 sekunder kvar var kl. **17:01:24**. Ingen ATTEST-GO, dispatch eller ATTEST-kontrollpunkt skapades före denna gräns. Producenten rapporterade återupptagen kontext kl. 17:02:27 och stoppade därefter enligt den bevarade tidsgränsen.

Detta var en faktisk brist i orkestreringen mellan godkännande och dispatch. Det saknades inget nytt käll- eller granskningsgodkännande vid det avgörande tillfället. K13 gjorde **ingen ATTEST, ingen import och ingen BEFORE- eller AFTER-penninginsamling**. Därför finns inget nytt K13-underlag om importerade mätvärden, prissättning, fakturabelopp eller SQL 57014. K12:s tidigare INSERT-timeout är fortfarande ett separat olöst produktfynd.

Tillgängliga tider visar varför framstegen blev begränsade: från genuine READY till runtime READY gick 19 minuter 42,575 sekunder och till första RPC 25 minuter 35,603 sekunder. De tre separata kontrollpunkternas status-till-försegling tog tillsammans 49,704 sekunder. De avser olika tidsmått; överlappande förberedelse- och latensblock får inte summeras. Uppgiften om kontextåterupptagning kommer från producentens sparade kopia av faktiskt verktygsutdata, inte från ett oberoende bevarat verktygstranskript. Upprepade uppstarter och investering i harness gav inte motsvarande fler fullständiga scenariobevis.

Den avgränsade rättningen är fortfarande **under förberedelse**: ett förstartat, hashbundet godkännande→GO→enskild-dispatch-flöde som bevarar oberoende granskning, exklusivt tillstånd och stopp vid okänt utfall. Rapporten ger ingen ny Auth- eller affärsbehörighet. Ett nytt försök får inte påbörjas genom att bara förlänga fönstret, försvaga kontrollerna eller återanvända en okänd åtgärd.

## Stängning och begränsningar i profileringen

K13 stängdes med vanlig egen API: GET 200, logout 204 och native noll i samtliga sex Auth-räknare. Browsern stängdes, helperns processgrupp var tom och egna REST-, klon- och runtime-resurser var borta. Slutkvittot `22c021…` och Ediels oberoende slutgranskning `1b3382…` är båda fysiska och hashbundna i registret. Detta är API-utloggning; normal UI-utloggning påstås inte.

Main-jämförelsen gäller exakt de **522 fångade relationsscopen**: endast fyra Auth-scopes ändrades, övriga 518 fångade scopes och fångad icke-radmetadata var exakta. De 14 privata tabellernas separata läsning hör till det tidigare K12-beviset; K13 gjorde ingen ny sådan ekonomisk insamling. Andra privata schemas rader omfattas inte av jämförelsen. Den tidigare scope-erratan bevaras; frånvaro av snapshotnyckel bevisar inte att en tabell är tom.

Parentprocessen avslutades med **0**, men den egna direkta PostgREST-containerns observerade exitkod var **255**, med OOM=false. Det är olika fakta. Parentens nollkod bekräftar dess kontroll- och cleanupassertioner; den kvalificerar inte normal REST-exit. Profileringens `profilingNormalRESTExitBoundary` är **false**. Noll kvarvarande egna REST-backends och stabila slutarrayer bevisar inte normal statistikflush. Stoppretur, stderr och fullständig post-stop-inspektion sparades inte före borttagningen, så orsaken till 255 är **okänd**. En separat källrättning för stop/wait/inspektionsbevis förbereds. Ingen normalflush eller importspecifik kostnadsfördelning räknas som kvalificerad.

## Vad som är rättat respektive fortfarande öppet

POST-lookupen och det verkliga mottagningsklockslaget för nya kuvert har passerat sina avgränsade native-/normalflödeskontroller. Kundlistans isolerade rättning har 41 godkända komponentfall; native-/UI-kvalificering och aktiv adoption återstår. Den separata headerlängdsrättningen har nu klarat 75 nativefall, där 41 referensfall ingår, samt guarded installation/replay på egen liten databas. Det är inte 75+41 skilda fall. Rättningen är fortfarande separat från K12/K13:s optimerade framer och inte införd på Main genom rapporten.

K12 genomförde fyra RPC inklusive ATTEST men den enda normala filimporten fick avvisat/okänt resultat: `ediel_messages` INSERT avbröts med SQL 57014 trots aktiv optimerad framer i katalogen med 3444 funktioner. Inget okänt importutfall återförsöktes. Stacken lokaliserade avbrottet till `wire_tokens_v1` → `gridex_ack_authority.wire_v1` → `gridex_utilts_issuer.capture_insert_v1`; den bevisar inte ensam kostnadsorsak eller anropsmultiplikation.

Isolerade prov på samma 171462 råbyte gav 10774 token på 0,321662 sekunder SQL-tid inklusive materialiserad digest, 0,468412 sekunder hos anroparen. Den verkliga ACK-callern gav ett objekt på 0,421720 respektive 0,573267 sekunder. Båda var snabba ensamma under ursprungliga tidsgränser. Det separata statistikmekanismprovet visade att en färdig callee kan behålla sin räknare efter en yttre 57014 och normal backend-exit; avbrutna funktioner underräknas. Dessa komponentprov bevisar varken full INSERT-orsak, idle-flush i en levande REST-pool eller K13-importkostnad.

2688 är deklarerade månadsintervall, inte en importerad kWh-kvantitet. Fångad CPS anger 0,95 kr/kWh, månadsavgift 40 kr och avtalsmoms 25 %, men faktisk importerad kvantitet och nytt fakturabelopp saknas. Det ger inget penningfacit eller ekonomiskt PASS.

## Ändlig nästa kö utan påhittad beredskap

De 66 ofullständiga fallen har delats i **6 villkorliga graph-readbacks, 51 separata fixture-/åtgärds-/scope-/slutgranskningsgrindar och 9 heterogena externa eller historiska underlag**. Exakt per-ID-kö och källa `d89beaae…` finns i registret. Talen anger nästa meningsfulla arbete, inte antal körklara eller godkända fall. De sex readbackspåren var villkorade av en verkligt lyckad K13-import; K13 skapade ingen sådan returgraph. De 51 kräver egna legitima förutsättningar och kan inte köras enbart med importens befintliga behörighet.

De nio återstående underlagen har olika betydelse: användaren saknar det historiska originalet med 28 meddelanden/1809,51 kr och officiell XSD; fem QA-falls historiska medlemskap är endast avgränsat NOT_LOCATED; genuint mottagarkvitto och oberoende avrundningsnorm kräver egna bevis. Ny syntetisk funktionstestdata ersätter inte dessa original. Originalbelopp, läscount och övriga orakel bevaras ordagrant.

EVENT R/R2/S gav inga affärssteg eller TLS-mottagningsbevis. Den senare statiska filsystemkontrollen med 148 PASS är ett avgränsat konfigurationsresultat, ingen EVENT01.01/.03-leverans. Originaloraklet kräver stödd affärshändelse genom native outbox/webhook till lokal mottagare med event-, payload-, signatur-, leverans- och exakt mottagencount; replay måste visas separat.

## Dödkod och bevarad historik

Primärartefakten redovisar 33 källidentiteter: 24 borttagna och 9 kvarhållna, då fördelade på 4 levande, 4 legacy och 1 osäker. Den senare dashboard-writerns separata borttagningsartefakt och fyra lokala cleanup-operationer i `7d37ea…` är inte komponerad runtimeadoption och adderas inte till 24/9. De 187 root-unreached kandidaterna är inte 187 bevisat döda funktioner.

33 scenarier har en etablerad nedre gräns för native-/browserförsök vid basledgerns bryttid; 23 överlappar de 38 fullständiga PASS. Dessa tal får inte summeras. Exakt historiskt totalantal försök är inte fastställt. Noll etablerade fullständiga FAIL i basledgern betyder inte noll upptäckta produkt- eller harnessfel.

Föregående lokala artefakt `21d975b2…`, Root-bryttiderna `cc0b46…` och `3e76ba…`, scope-erratan och äldre Git-bevis behålls. `105SCENARIOS.json` har oförändrad SHA-256 `9c4077c4ecc420906521e1ad69902497c36b5e34b02996ca793aedeb3ab2cab4`. Stora historiska JSON-/Fc-bevis kan vara förlustfritt arkiverade; en framtida fysisk omläsning kräver respektive kvalificerad SHA-kontrollerad återställning. Det är en annan situation än saknade normativa original.

Rapporten återanvänder kvalificerade bevis och verifierar dokument, hashkedjor och Git-innehåll. Inga scenarier, nya Auth-sessioner, backendprov eller heltäckande projektkontroller körs för denna dokumentationsleverans.
