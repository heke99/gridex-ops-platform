# Automatisk behandling av fullmaktssvar — arbetscheckpunkt

Observation: 2026-10-18, arbetskopia `/workspace/gridex-ops-release-20261018`. Detta är ett lokalt överlämningsunderlag, inte en attest för produktionsdrift eller registergodkännande i Ediel-masterplanen.

## Användarmål och mandat

Användaren kräver: ”detta ske automatiskt, det är varför vi bygger den” och ”kund och tenant får rätt uppgifter, kund börjar vi rätt tid också, kund får rätt anläggningsid”. Det tidigare mandatet omfattar fullmaktsbevis/verifikatsnummer, arkiv och tenant-/superadminåtkomst, ämnesrader och uppföljningar, API-dokumentation samt produktion: ”kör det i drift”.

Den nya implementationen ska läsa ett äkta inkommande svar, fastställa tenant/kund/anläggning/ärende oberoende av AI, tillämpa entydiga fakta automatiskt och föra processen vidare med rätt datum. Nekade fullmakter, motstridiga eller villkorade besked och obetrodda källor ska få en synlig åtgärd utan felaktig kunduppdatering eller marknadsstart.

## Produktionsgräns

Den tidigare fullmakts-/AI-versionen var `8796eb0163577eae87bf4e5403f6a7c6a6f4f8b5`. En färsk kontroll av `app.gridex.se` visade senare main `987b970108061f98eacfbbf3e2761f4892dabd85`, deployment `dpl_3CgvvFjSdJ2uauzzXPnFRzJ9PXBz` READY. Produktionsaliaset hade alltså flyttats av ordinarie main-leverans. Den aktuella kandidaten integrerar därför denna main genom merge `9f19d549676efa7b323528da298e081050f5455a`. Ingen ny automatisk migration eller produktionspromovering görs gällande här.

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

1. Avsluta den frysta kandidatens samlade tester, app-/testtypkontroll, lint, API-/databaskontrakt och produktionsbygge. Riktad slutkörning: 44 sviter, 985 PASS och 1 avsiktligt opt-in-skip för betalt produktionsprov.
2. Bind två oberoende slutgranskningar till exakt head/source/base/tree. Stäng eventuella nya bekräftade fynd.
3. Ta emot checksum-/schema-/typcarrier från befintlig kvalificerad C2/GEN-ägare enligt den konkret verifierade gränsen nedan. Ingen egen parallell producent eller grindförsvagning.
4. Leverera och verifiera framåtmigration och normalt appbygge. Bevara aktuella main-ändringar, Ediel-behörigheter och marknads-/providergränser.
5. Koppla det förberedda syntetiska fullmaktsutskicket till avskilt testärende och rätt mottagande version. Verifiera verkligt Strato-svar, AI-läsning, tenant/kund/anläggning, normaliserade fakta/datum och replay. Redovisa det som fortfarande saknar driftbevis.

## Skill-routing och filcustody

Avgränsad implementation använder lokal TDD och verifiering före färdigpåstående. Supabase-guiden gäller den befintliga DB-porten och tenantgränserna. React-kvalitetsguiden och installerad Next.js-dokumentation gäller adminvisningen; komponenten förblir serverrenderad, utan nya klientpaket, hooks, nätanrop eller HTML-injektion. Ingen allmän prestandaoptimering, supply-chain-förändring, UI-omdesign eller Ediel-regelproduktion görs i detta delpaket.

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

Färsk slutkontroll av transport-/låsningskorrigeringen: 256 atomiska PostgreSQL-tester, 34 faktiska SQL/adapter-holdtester och 12 tester genom riktiga SMTP-wrappers/generisk inträdesgate, totalt 302/302 PASS. Testtypkontroll, ESLint och diffkontroll PASS. API-dokumentationsparitet, exempel och kompatibilitet, databasens kontraktshärdning, tenant/service-role-ratchet, produktionsberoendeaudit, riktad ESLint och app-/testtypkontroll har körts under integrationen. Slutversionens två oberoende granskningar måste fortfarande bindas till sluthead och redovisas i PR:ens leveransunderlag. Inga nya VERIFIED/PASSED-rader i Ediel-ledgern tilldelas denna ändring.

**Blockerande schemagrindar:** `db:migrations:integrity` saknar legitimt registrerat checksummat för `20261018183448_manual_mail_automatic_application.sql`; `db:types:check` kräver genuin generering för den nya migrationssvansen. Inga gamla checksumrader, genererade typer, manifest eller grindskript har ändrats av denna uppgift. SHA256 för den frysta migrationen: `0fdc2b6e3954266ec2c82b9a5d63de2f91f9388e8a7b3e66b528b89f8459e409`.

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

Testförberedelsens ytterligare gräns: ingen befintlig endpoint skapar automatiskt hela det nödvändiga provintaget. Separat testmiljö med `GRIDEX_MANUAL_OPS_ENVIRONMENT=test` och explicit `MANUAL_GRID_OWNER_SAFE_RECIPIENT` behöver behörigt testintag och äkta lagrat fullmaktsgodkännande. Testmarkeringen är ingen marknadsexekveringsspärr. Produktionsflödet blockerar sådan mottagaromdirigering; användarens egen svarsadress får aldrig upphöjas till verifierad leverantörskontakt. Inget sådant intag, miljöbyte eller utskick har utförts.
