# Automatisk behandling av fullmaktssvar — arbetscheckpunkt

Observation: 2026-10-18, arbetskopia `/workspace/gridex-ops-release-20261018`. Detta är ett lokalt överlämningsunderlag, inte en attest för produktionsdrift eller registergodkännande i Ediel-masterplanen.

## Aktuell fortsättning: snabb och effektiv behandling

2026-10-18 21:45 UTC: tidigare `d6031c6a`/tree `371a92e1` är historisk frysning. SQL-migrationens SHA256 är fortsatt `d92f7ab706eb6bac415929255f218d38aa5e8f287bcad1c57f7438b9c590fc54`. Ett senare bekräftat P1 i pollern återkallar applikationsgodkännandenas slutgiltighet tills den nya exakta källan granskats. Den installerade ImapFlow-klienten blockerar STORE inne i en aktiv FETCH-generator; faktisk protokollregression reproducerade felet och verifierar avslutad UID-hämtning före flaggning. Ingen dataförlust påstods i det ursprungliga felet: affärsbehandlingen hann slutföras före blockeringen.

Root äger cron/config/admin-default och de här uppgiftsdokumenten. Facility-agenten äger avgränsat poller, två nya protokoll-/schemaläggningstester och två berörda retry-fixtures tills positiv handback. Commercial-agentens guard för betrodda tydliga nekanden är återlämnad (35/35 PASS): onödigt AI-anrop tas bort, positiva svar behåller samma kontroller. Atomic-agenten gör endast avgränsad läsgranskning av cursor-/leaseordning. Två slutgranskare är inte medförfattare.

Nya minutscheman för manual inbound och outbox, en minuts default för ny adminbrevlåda samt 300 sekunders plattformsgräns är förberedda. Två aktiva verifierade produktionsbrevlådor ändrades genom en begränsad rutinmässig inställningsuppdatering från fem till en minut; readback bekräftar två rader på en minut. Inga kundfakta, behörigheter, hemligheter eller schemaobjekt ändrades. Det nya schemat börjar gälla först efter appens normala leverans.

Pollerns pågående avgränsning är 150 sekunders mjuk budget, färsk claimkonfiguration, worker-/metadatafenced finish och beständig UIDVALIDITY-/kontonamnsbunden frontier. Nya mejl efter en beständigt sparad bootstrap ska läsas även om operatören hunnit markera dem lästa. Befintlig oläst backlog och sparade UID-återförsök hanteras; äldre redan läst historik backfillas inte automatiskt. Budgeten kan inte avbryta en pågående nätverks-/affärsoperation och är inget garanterat SLA.

Historiskt kallt Vercelbygge `dpl_7eJpWhTYia7yA9xVmVkiYubCk5G9` på `d6031c6a` blev READY. Syntetiskt riktigt produktionsnyckelprov PASS: 2 752 ms, 672 input-/50 outputtokens, uppskattat 0,0000922 USD för den korta texten; ingen kunddata och inga verktyg. Den första stagingkörningen slutade ERROR/BUILD_EXCEEDED_MAXIMUM_TIME. Den lyckade körningen hade både tom byggcache och större maskin, så cache är inte ensam bevisad rotorsak. Lokal isolerad kall kompilering PASS, 190,21 sekunder, noll provider-/backendanrop. Readerprotokollet är oförändrat av den nya negativa snabbvägen; provet är inget Strato-/tenant-/marknads-E2E.

`app.gridex.se` stannade på befintliga releasen `dpl_4259kuRFDYvh52vGwsc9dmHainL7`/main `8ccad787`. Vercel tilldelade trots skip-domain standardaliaset till staging; det återställdes med lyckat alias-set. Ingen slutlig promovering, remote migration, kanoniskt testintag eller riktigt fullmaktsutskick är utfört. Kvalificerad checksum-/schema-/typcarrier är fortfarande ett konkret externt leveransberoende.

Författaren har nu positivt återlämnat samtliga poller-/testfiler och testproducentcustody: 102/102 riktade tester PASS, inklusive verklig ImapFlow över tre pollningar, samt testtypkontroll, lint och diffkontroll PASS. UID-återförsök använder kontonamnrymd/UIDVALIDITY/UID i stället för Message-ID. Terminal lästmarkering görs först efter beständig fencad metadatafinish och är best-effort inom återstående budget. En misslyckad flush lämnar källan oläst.

Aktuell ordinarie main/produktion gick därefter vidare till `61b29f0cadd04b28f467abd68e2b7c528a7e7baa` (PR820, `dpl_B861UzkKbqcpQQJaeZCLhEX7kfgF` READY). Den integrerades konfliktfritt efter filhandback. Arvet omfattar 18 kvalificerade Ediel-/schema-/manifest-/nativebevisfiler och en tidigare daterad migration; ingen av poller-/ingestionruntimefilerna ändrades. Alla dessa upstreamfiler bevaras byteidentiskt mot main och deras native-/GEN-underlag återanvänds med denna uttryckliga källtillämpning, utan ny insamling eller egen regelcredit.

Samlad färsk verifiering på integrerad main `61b29f0c`: 49 valda sviter, 48 PASS/1 avsiktligt opt-in-SKIP; 1 269 tester PASS/1 SKIP på 18,97 sekunder. App-TypeScript, test-TypeScript, riktad lint för nio ändrade TS-filer och diffkontroll PASS. Separat cron-/konfigurationskontroll 38/38 PASS. De 18 upstreamägda filerna är verifierat byteidentiska mot main. Migrationshashen är oförändrad.

Exakt nästa åtgärd: frys ny head/tree/base och inhämta två oberoende affected-source-bindningar. Uppdatera sedan användargodkänd #766-handoff och fortsätt normal leverans med incumbent-carriern. Inget orphan-testmejl och ingen egen GEN-produktion.

## Användarmål och mandat

Användaren kräver: ”detta ske automatiskt, det är varför vi bygger den” och ”kund och tenant får rätt uppgifter, kund börjar vi rätt tid också, kund får rätt anläggningsid”. Det tidigare mandatet omfattar fullmaktsbevis/verifikatsnummer, arkiv och tenant-/superadminåtkomst, ämnesrader och uppföljningar, API-dokumentation samt produktion: ”kör det i drift”.

Den nya implementationen ska läsa ett äkta inkommande svar, fastställa tenant/kund/anläggning/ärende oberoende av AI, tillämpa entydiga fakta automatiskt och föra processen vidare med rätt datum. Nekade fullmakter, motstridiga eller villkorade besked och obetrodda källor ska få en synlig åtgärd utan felaktig kunduppdatering eller marknadsstart.

## Produktionsgräns

Den tidigare fullmakts-/AI-versionen var `8796eb0163577eae87bf4e5403f6a7c6a6f4f8b5`. En färsk kontroll av `app.gridex.se` visade senare main `987b970108061f98eacfbbf3e2761f4892dabd85`, deployment `dpl_3CgvvFjSdJ2uauzzXPnFRzJ9PXBz` READY. Produktionsaliaset hade alltså flyttats av ordinarie main-leverans. Den aktuella kandidaten integrerar därför denna main genom merge `9f19d549676efa7b323528da298e081050f5455a`. Ingen ny automatisk migration eller produktionspromovering görs gällande här.

En ny remote-kontroll före slutlig leverans visade main `8ccad78709193f565500d60a9df13f9134b22d19`, ordinarie merge av PR825. Den integrerades konfliktfritt genom `e74c07b200d30b68b700c3b1fe102fdced814067`. Upstream-deltat innehåller fyra ägda CI-/kvalificerings-/test-/ledgerfiler för H05/H08, inga ändringar i applikationsruntime, POA-/mejlmoduler eller migrationen. Deras kvalificerade underlag och godkännanden bevaras som main-arv; denna uppgift tilldelar ingen egen native-/regelcredit och startar ingen omkörning av deras producent. Den sista applikationsverifieringen återkörs på den integrerade källan. Detta är en observation av Git-main, ingen ny kontroll av vilket bygge produktionsaliaset för närvarande pekar på.

Tidigare produktionsbygge och syntetiskt OpenAI-anrop verifierade leverans och provideranslutning för föregående version. Ett riktigt svar genom Strato, inloggad tenant A/B-verifiering i drift, historisk fullmaktsinventering och verklig marknadsstart har inte attesterats. BankID är fortsatt inte integrerat.

## Implementerade delar i arbetskopian

- `manualSenderVerification.ts` och IMAP-pollern verifierar ursprungliga RFC-bytes kryptografiskt. DKIM-bevis och signerade routningsrubriker hålls åtskilda från en avsändaradress eller påstått `Authentication-Results`.
- Korrelationsmotorn binder befintligt ärende, tenant, kund, anläggning och rätt verifierad nät-/handelskontakt. AI får inga identitets- eller skrivverktyg.
- AI-läsaren/lagringen har strukturerade granskningsflaggor, källcitat och engångsreservation. Återanvändning kräver samma källtext och kontext. `manualMailInterpretation.ts`, `manualCommercialTerms.ts` och `manualFacilityFacts.ts` validerar mening, normaliserar värden och avvisar förbehåll/motsägelser.
- Automatiska facility-svar går genom det källbundna kanoniska kommandot. Adaptern gör inga separata status-, bevis- eller eventuppdateringar som kan skriva över senare stopp. Post-commit- och tillfälliga fel propagaterar så att fortsättningen kan återupptas.
- Framåtmigrationen `20261018183448_manual_mail_automatic_application.sql` innehåller låsta kommandon för kommersiella/anläggningsuppgifter, exakt källa/tenant/kund/fullmakt/dokument/CIR/leverantörskontext och verifierade datumgränser. Den ska verifieras och levereras genom ordinarie migrationsflöde; interna funktioner är inga nya publika API-endpoints.
- Readiness, datumval, oskickade bytesärenden och outbox har kontroller för verifierad kommersiell källa, tidigaste start och bindning till redan förberett/skickat original. Ofullständiga handelsbesked behåller saknade fält och uppföljning.
- Handelsförfrågan och dess verifierade kontakt-/behörighetskontroller finns som separata moduler, integrerade efter anläggningssvar och vid återupptagning av efterföljande steg.
- Adminvisningen skiljer läsunderlag från bekräftat sparade affärsfakta. Automatisk status kräver `applied: true`, samma tenant/kund/ärende/källhash och verifierat avsändarbevis; partiella besked visar saknade uppgifter. Runbook beskriver samma gränser och saknar påståenden om generell PDF-/Excel-/OCR-tolkning.

## Avgränsad verifiering utförd av facility/UI-agenten

Ingen summering nedan är en global acceptans för hela arbetskopian. Root och övriga agenter ansvarar för sina körningar och exakt slutversion.

| Omfattning | Utförd kontroll | Utfall |
| --- | --- | --- |
| Automatisk facility-adapter | `manual-mail-automatic-facility-apply.test.ts` | 9 verkliga RED-fall mot tidigare kod, därefter 9 GREEN. Bevisar inga separata request-writes, oförändrat stopp/slutfört underlag, rätt kommandounderlag och felpropagering. |
| Adapter + normaliserade nätfakta + kommandoval | Samma suite tillsammans med `manual-facility-facts.test.ts` och `manual-mail-facility-command.test.ts` | 70 tester godkända i den avgränsade körningen. |
| Tidigare manuella funktioner | 8 utvalda direkta funktionsregressioner i `main-baseline-pr204-manual-inbound.test.ts` | Godkända innan fixtureuppdateringen. |
| Uppdaterade legacy-fixtures | `inbound-review-manual-inbound-retry.test.ts`, `main-baseline-pr204-manual-inbound.test.ts`, `manual-inbound-retired-source-retry.test.ts` | 60 tester godkända. Betrodd standardsvarskälla har syntetiskt verifierarresultat; obetrodda fall är fortsatt obetrodda. Återförsök använder identiskt original. DB-dubblar utvärderar `.in` och JSON/CAS-filter. |
| Adminvisning | `manual-mail-ai-reading-ui.test.ts` | 14 renderfall: 10 RED mot föregående UI, därefter 14 GREEN. Kompletta/partiella/anläggningsfakta, främmande kontext, ändrad hash, obetrott bevis och svenska granskningsorsaker. |
| Typkontroll och lint | `tsc --noEmit -p tsconfig.tests.json`, riktad ESLint och `git diff --check` efter facility- och fixturepaketen | Godkända vid respektive överlämning. |
| UI-/dokumentpaketets gates | Riktad ESLint för komponent och renderfall, `tsc --noEmit -p tsconfig.tests.json`, `tsc --noEmit -p tsconfig.app.json` och riktad `git diff --check` | Godkända i färska körningar före överlämning. Ingen ny Next.js-klientgräns eller ändrad plattformsadminguard. |

## Återstår före färdig leverans

1. Avsluta den frysta kandidatens produktionsbygge och kvalificerade schema-/typkontroller. Färsk riktad slutkörning: 45 sviter, 1 189 PASS och 1 avsiktligt opt-in-skip för betalt produktionsprov. App-/testtypkontroll, riktad lint och diffkontroll PASS.
2. Bind två oberoende slutgranskningar till exakt head/source/base/tree. Stäng eventuella nya bekräftade fynd.
3. Ta emot checksum-/schema-/typcarrier från befintlig kvalificerad C2/GEN-ägare enligt den konkret verifierade gränsen nedan. Ingen egen parallell producent eller grindförsvagning.
4. Leverera och verifiera framåtmigration och normalt appbygge. Bevara aktuella main-ändringar, Ediel-behörigheter och marknads-/providergränser.
5. Koppla det förberedda syntetiska fullmaktsutskicket till avskilt testärende och rätt mottagande version. Verifiera verkligt Strato-svar, AI-läsning, tenant/kund/anläggning, normaliserade fakta/datum och replay. Redovisa det som fortfarande saknar driftbevis.

## Skill-routing och filcustody

Avgränsad implementation använder lokal TDD och verifiering före färdigpåstående. Supabase-guiden gäller den befintliga DB-porten och tenantgränserna. React-kvalitetsguiden och installerad Next.js-dokumentation gäller adminvisningen; komponenten förblir serverrenderad, utan nya klientpaket, hooks, nätanrop eller HTML-injektion. Den senare uttryckliga prestandauppgiften använder performance-optimization för verifierade poller-/AI-väntetider enligt aktuell fortsättning ovan. Ingen supply-chain-förändring, UI-omdesign eller Ediel-regelproduktion görs i detta delpaket.

Facility-adapter och dess test, därefter de tre legacy-testsamlingarna och syntetiska verifieringshjälparen, har återlämnats till root. Även sista avgränsningen — `ManualMailAiReading.tsx`, `manual-mail-ai-reading-ui.test.ts`, `docs/manual-poa-mail-runbook.md` och denna checkpunkt — återlämnas efter ovanstående gates. Inget deluppdrag gör egen commit, produktionsmutation eller ändring av delat Ediel-minne.


## Integrerad slutkontroll och konkret leveransgräns

Samtliga implementationstreams är återlämnade till root. Den nya kandidaten omfattar även:

- Beständig kommersiell och teknisk fortsättning från exakt tillämpningsbevis, utan nytt AI-anrop; separat leverantörsförfrågan innan vanliga byten, medan kanonisk inflyttning/avslut undantas.
- Monoton källstatus/CAS, karantän vid ändrat innehåll med samma Message-ID, signerade routningssignaler, fullständighetsmarkering för MIME/citat och ingen tyst avkapning av senare villkor.
- Aktuell leverantör/kontakt/roll under transaktionslås, skyddade maskinbevis även mot direkt autentiserad adminredigering, källbundna delsvar och datumgolv utan återanvändning från tidigare leverantör.
- Anläggnings-/mätpunktsroll och uttryckliga kundnummer/person-/organisationsnummer får inte motsäga den kanoniska kunden eller anläggningen, även om tråden matchar.
- Nyare verifierad nekning håller även ett tidigare komplett kommersiellt ärende och oskickat vanligt byte. Skickade original och flytt-/avslutsärenden skrivs inte om.
- Läsbar löptext med årsenergi/leverantör passerar hela normaliseringskedjan. Exakt positivt POA-besked som BankID krävs inte skapar ingen felaktig kommersiell negation.
- Kanonisk kundsammanslagning bevarar PDF-åtkomst via bevisad tenantbunden mergekedja och byteidentisk kopiering; inga godtyckliga kundprefix tillåts.
- Aktiva Website-/Staff-guider är uppdaterade; publika wire-kontrakt och historiska utgåvor är oförändrade.

Färsk slutkontroll av transport-/låsnings- och rättelsekedjan: 299 atomiska PostgreSQL-tester, 42 faktiska SQL/adapter-holdtester, 48 leverantörs-/gransknings-/omsändningstester och 12 tester genom riktiga SMTP-wrappers/generisk inträdesgate, totalt 401/401 PASS. Den bredare avgränsade mejl-/fullmakts-/behörighetskörningen på föregående freeze gav 1 164 PASS och ett avsiktligt opt-in-skip (45 sviter). App-/testtypkontroll, ESLint och diffkontroll PASS. API-dokumentationsparitet, exempel och kompatibilitet, databasens kontraktshärdning, tenant/service-role-ratchet och produktionsberoendeaudit har också körts under integrationen. Slutversionens två oberoende granskningar måste fortfarande bindas till sluthead och redovisas i PR:ens leveransunderlag. Inga nya VERIFIED/PASSED-rader i Ediel-ledgern tilldelas denna ändring.

**Blockerande schemagrindar:** `db:migrations:integrity` saknar legitimt registrerat checksummat för `20261018183448_manual_mail_automatic_application.sql`; `db:types:check` kräver genuin generering för den nya migrationssvansen. Inga gamla checksumrader, genererade typer, manifest eller grindskript har ändrats av denna uppgift. SHA256 för den frysta migrationen: `d92f7ab706eb6bac415929255f218d38aa5e8f287bcad1c57f7438b9c590fc54`.

Färsk autentiserad custodyundersökning visar att berörda resurser är aktivt ägda: producer-gen `f71e796cd9d99f0c6d223a10c4de2eb010750a50` är PR820-only; typer/typmanifest/schema/fingerprint hålls på `e39270f024c722646689d10a393a62f7dbaf97da`; primärt checksummanifest och befintlig C2-service hålls på `ce80cdd3fb4be418ea54daebb596d798889442cd`. Additions-/runtime-manifest är också ägda. Se [aktuell producenthandoff](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6253853225) och [AGENTS](../../../AGENTS.md): ”GEN, native, backend och originalinsamling sker endast hos befintlig kvalificerad producent.”

Legitim nästa åtgärd är exakt source-head/tree + den frysta migrationsfilen till befintlig C2-service för avgränsad checksumregistrering och kvalificerad generering. Därefter importeras deras carrier, obligatoriska grindar och två slutgranskningar slutförs, och ordinarie schema-/app-leverans verifieras. Ingen alternativ manifestfil, typändring för hand, egen dubblerad producent eller sänkt grind används.

Produktionsdatabasens projektidentitet bekräftades utan nyckelvärden: Staff-ruttens befintliga förväntat-projekt-kontroll accepterade `piidsfebjqjmnepdpnas` och fortsatte till normal 401 `missing_api_token`; felaktigt projekt skulle stoppas före auth. Read-only aggregat visade en signerad/aktiv äldre POA utan `document_path` och inget nytt fullmaktsutskick i kön. Detta är en begränsad observation, inte en full historisk inventering eller attest av PDF-innehåll.

Ett lokalt syntetiskt testmejl och en tydligt osignerad TEST-PDF har förberetts utanför Git till användarens angivna adress. Det har inte skickats, inga verkliga kundgodkännanden eller marknadsaktörer har fabricerats och inget Strato-/AI-/marknads-E2E har attesterats. Utskicket behöver kopplas till ett avskilt riktigt testärende när mottagande version är levererad; ett ad hoc-mejl utan ärende är inget bevis på automatisk kund-/tenanttillämpning.

Fixturekompatibilitet för den ändrade supplier-only-grenen i `ediel-z01-current-authorization.test.ts` hanteras som en enda sourcefil utan ID-/ledger-/producentmandat. Färsk exakt filkontroll och boardpreflight föregick officiell atomisk claim, receipt `ad6acd9a2af096ba935a7650310e609f694e5606`, carrier `d32899bd` integrerad genom `e71c0cea`. Agentens isolerade förhandskörning gav 82/82 mot verklig kandidat; ingen marknadsport eller behörighet har ändrats. Egen fil/sessioncustody behålls för ordinarie leverans eller uttrycklig överlämning.

En första bred lokal testsamling avbröts efter upprepade sandlåde-EPERM vid Node-underprocesser. Samma fem avgränsade fel reproducerades på exakt main `987b9701` och i fristående subprocessprov. Stödd utökad exekvering utan käll-/assertionsändring gav sedan 175/175 PASS för de två berörda sviterna. Den fulla samlingen kördes därefter på `800332b3` med samma tillåtna subprocesser och oförändrad loopback-nätgräns: 1 200 sviter och 20 062 tester PASS, en svit/tre tester FAIL, en svit/två tester avsiktligt SKIP. Logg: `/tmp/gridex-mail-full-suite-subprocess-enabled.log`.

De tre felen finns i `gridex-aud-003-clean-replay-cleanup.test.ts`. Oförändrad replaykontroll stoppar på den nya ännu inte checksumregistrerade migrationen innan testsamlingens simulerade CLI får starta. Samma nio tester gav 9/9 på exakt main `987b9701` och 6/9 på kandidaten; observerad stderr är `migration source is not checksum-pinned: 20261018183448_manual_mail_automatic_application.sql`. Detta är kandidatens konkreta GEN-/checksumberoende, inte ett godkänt helhetsresultat eller en ursäkt att sänka replaykontrollen. Ingen riktig backend/native/GEN kördes av dessa simulerade testfall.

Slutgranskningen efter `800332b3` bekräftade konkurrensfel: positiv tillämpning måste låsa oskickade bytesärenden innan originalbindning kan hinna emellan, och ett redan förberett original måste omprövas vid transportjournalens första sändinträde. De korrigerades additivt i samma ännu ej levererade migration med verkliga PostgreSQL- och transportwrapperregressioner. Kontrollen använder meddelandets kanoniska bytesägare, båda datumgränserna samt det oföränderliga originalets startdatum. Privata nativefunktioner, ACL och kvalificerade original skrivs inte om.

Nyare olöst avslag i en annan förfrågan för exakt samma kund/anläggning/aktuella leverantör invaliderar också äldre godkänt underlag. Ordning bygger på källans sparade mottagningstid; saknad/motsägande källa håller granskning medan äkta äldre avslag inte överröstar nyare godkännande. Öppna förfrågans befintliga hold-UPDATE tar samma anläggningslås genom en additiv invoker-trigger. Transportens bevisfråga körs separat efter låset. Ensessionstesterna verifierar verkliga SQL-/låsningskrav men attesterar ingen parallell nativekörning. De två oberoende granskningarna måste förnyas mot sluthead; tidigare granskning på `800332b3` gäller inte senare SQL-ändringar.

Granskningen på `209572c6` fann ytterligare två bekräftade sätt att dölja ett stopp. De har rättats före nästa frysning: transportens undantag för flytt/avslut bygger på exakt sparat original, aldrig en senare redigering av bytesärendets typ/status; ett förberett Z22 behåller sina kommersiella kontroller. Äkta sparat Z23-original och separat nativebundet Z24-avslut bevaras. En kvarvarande `requires_review=true` i en annan relevant förfrågan bedöms efter sin källa även när ärendet markerats completed/cancelled/closed/resolved; dokumenterad rättelse rensar själva flaggan. Tidigare slutgodkännande på `209572c6` är återkallat i väntan på nya exakta granskningar.

Fortsatt granskning på `7430ea9a` reproducerade äldre öppet avslag som skrev över ett nyare och därmed återaktiverade äldre positivt bevis. Alla kommersiella avslag går nu genom samma låsta kommando, med källans verkliga mottagningstid för monoton ordning och beständig granskning. Defensiv invoker-trigger bevarar ett nyare stopp även vid äldre direktuppdatering. Återspelning av samma/äldre redan granskade källa återaktiverar inte stoppet; ett genuint senare avslag gör det. Positiv tillämpning avvisar äldre/lika eller okänd relevant olöst invändning före affärsskrivningar. Permutationer av tre svar, lika tid, saknad källa, granskning och nyare positiva/negativa besked testas med faktisk SQL och adapter.

Sena avslag behåller avslutade förfrågningars status men skriver stoppflagga/anläggning/CIR/event atomiskt. Detta fungerar både med aktuella manuella unikhetsindex och med det historiska öppet-ärende-indexet som kompatibilitetskontroll; historiskt installerat index är inte en observation av faktisk produktionsschema. Rättelse utan aktiv systerförfrågan gör ärendet klart för omsändning; med aktiv syster bevaras den avslutade historiken. En exakt matchad, dokumenterad rättelse rensar CIR-stoppet först vid ordinarie omsändnings CAS. Annan eller nyare CIR-källa ligger kvar. Giltigt nativeägt H/Z25-original använder också sitt eget startdatum utan att undantas från kommersiella kontroller. Nativefunktioner och ACL har inte ändrats.

Den sista granskningen på `d837a05f` fann att registrets gamla statusfilter dolde sena avslag när avslutad historik bevarades. Fullmaktsregistret läser nu den auktoritativa granskningsflaggan med samma tenant-/POA-/kundfilter. Ett faktiskt register→sidrendering→behörig serveraction-test visar granskningsformuläret för avslutat kommersiellt ärende, håller främmande tenant/kund/fullmakt och redan granskade rader utanför samt verifierar rättelsen. Separat register-/arkiv-/åtkomstsvit: 22/22 PASS; den ingick också i de 1 164 riktade testerna på föregående freeze.

Testförberedelsens ytterligare gräns: ingen befintlig endpoint skapar automatiskt hela det nödvändiga provintaget. Separat testmiljö med `GRIDEX_MANUAL_OPS_ENVIRONMENT=test` och explicit `MANUAL_GRID_OWNER_SAFE_RECIPIENT` behöver behörigt testintag och äkta lagrat fullmaktsgodkännande. Facility-testsvaret kan trovärdighetsbindas till sparad safe-adress genom signerad faktisk In-Reply-To/References och avsändaralignerad DKIM; enbart ärendenummer räcker inte för den omdirigerade adressen. Testmarkeringen är ingen marknadsexekveringsspärr. Produktionsflödet blockerar sådan mottagaromdirigering; användarens egen svarsadress får aldrig upphöjas till verifierad kommersiell leverantörskontakt. Inget sådant intag, miljöbyte eller utskick har utförts.


## Sen identitetskontroll och full körning

Hela samlingen på exakt `40974bfe0c3fe37c13172464b61bcaf9c764c4c0` gav 20 167 PASS, tre FAIL och två avsiktliga SKIP, totalt 20 172 tester/1 203 sviter (366,76 sekunder). Samma tre oförändrade cleanup-replaytester stoppar före simulerad CLI på den ännu oregistrerade migrationen. Logg: `/tmp/gridex-mail-final-full-suite.log`. Resultatet är inget undantag från checksum-/GEN-grindarna.

En efterföljande avgränsad P2-kontroll bekräftade ett identitetsfel för metadata-only-hold: riktiga holdkommandot sparar `metadata.counterparty_reply` och tomt `parsed_payload`; provenienstriggerns identitetsskydd valdes tidigare bara från parsed-maskinnycklar. En behörig tenantadmin kunde flytta den hållna förfrågan till en annan giltig anläggning för samma kund medan inkommande källa låg kvar på ursprungsanläggningen. Reproduktionen använde faktiska canonical RLS/helper/trigger/FK och visade att ursprungsanläggningens `terms_verified` blev sant; separat omedelbart SMTP-bypass är inte visat eftersom holdkommandot även skriver andra stopp. Två sourcegodkännanden på `40974bfe` är superseded i väntan på rättning, regression och nya exakta slutbindningar.

Användaren godkände publiceringen av den konkreta producentöverlämningen. Den är publicerad och exakt återläst i [#766](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6254717292), därefter uttryckligen pausad för denna avgränsade source-rättning innan ny inputhash skickas. Ingen kvalificerad carrier eller mottagningsadmission har erhållits. Vercel bygger en opromoverad staging med produktionsmiljö på `40974bfe`; kompilerings-/syntetiskt AI-resultat redovisas separat när det är terminalt. Databasleverans, domänpromovering och riktigt fullmaktsmejl är fortfarande inte utförda.


Den bekräftade P2-rättningen är nu implementerad och fryst: när före-/efterbilden innehåller `metadata.counterparty_reply` skyddar invoker-triggern hela interna källobjektet, dess received-mirror och förfrågans exakta identitets-/routefält oberoende av parsed-nycklar. Även null/tomt objekt, injektion, borttagning och DELETE skyddas. Befintliga parsed-maskinbevis är fortsatt skyddade; vanliga anteckningar och explicit servergranskning fungerar. TDD gav 21 genuina RED före rättningen; 25 nya regressioner och befintliga tester ger 299 atomiska + 42 hold + 12 SMTP = 353/353 PASS. Test-TypeScript, ESLint och diffkontroll PASS. Två oberoende slutgranskningar återbinds efter commit; tidigare `40974bfe`-godkännanden gäller inte den nya migrationen.

Stagingbygget på `40974bfe` omfattar oförändrad applikationskälla; den senare rättningen ändrar enbart ännu ej levererad SQL och dess regressioner, förutom dokumentation. Ett eventuellt grönt stagingresultat visar kompilering och syntetisk providerkontakt för just denna oförändrade applikationskälla. Det är inte en attest av den nya migrationshashen eller tillåtelse att promota bygget. Fullkörningens 20 167 PASS/tre checksumfel gäller uttryckligen `40974bfe`; den nya SQL:en har separat beteendeverifiering.
