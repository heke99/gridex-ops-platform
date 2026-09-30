# GRIDEX – FORTSÄTT HELA TENANTSERVICEUPPDRAGET FRÅN VERIFIERAD GITHUB-STATUS

Repository:
heke99/gridex-ops-platform

Arbetsgren:
codex/tenantservice-api-ops-20260928

Aktiv draft-PR:
#418

## 1. DITT UPPDRAG OCH DIN STOPPGRÄNS

Du tar över ett pågående genomförandeuppdrag.

Fortsätt genom hela den återstående masterplanen P0–P8:
API, tenant-RBAC, kundändringar, fakturering, support via webb och
telefon, säkerhet, dokumentation och enkel fungerande UI i hela OPS.

Detta är inte ett uppdrag att enbart:
- Kontrollera CI.
- Reparera en migration.
- Slutföra publiceringsfunktionen.
- Skriva ytterligare en generell plan.
- Göra ett enda litet delsteg och sedan fråga om du ska fortsätta.

Ett godkänt delpaket är en avstämningspunkt. Fortsätt därefter
självständigt med nästa genomförbara paket inom detta mandat.

Bevara hela kravmatrisen T01–T55 och U01–U20.
Förändra inte kravens innebörd för att lättare markera dem klara.

Skilj:
- Implementerat.
- Lokalt verifierat.
- Verifierat i isolerad integration/browser.
- Externt eller produktionsmässigt overifierat.

Externa konfigurations- och aktiveringskrav får inte fejkas.
Men en extern blockerare för en viss integration ska inte stoppa
allt oberoende implementationsarbete.

Ingen merge till main, produktionsmigration, riktig kundkommunikation,
nyckelrotation eller aktivering av Edieltrafik utan separat uttryckligt
tillstånd.

PR #310 och andra agenters arbetsgrenar ska lämnas orörda.

## 2. TA ÖVER SÄKERT – INGEN OMSTART

Den tidigare agenten ska ha slutat skriva på grenen.
Kontrollera faktisk status innan du själv börjar ändra filer.

Senast externt kontrollerad checkpoint den 28 september 2026:

- PR #418 är open och draft.
- Remote head:
  dfb2221191e4c44b10eab99714d8b18400fa910a.
- OPS workflow:
  36436708427.
- verify: success.
- quality-release-gates: success.
- clean-migration-replay: success.
- Clean-replay-jobb:
  108976395436.

Tidigare problem med:
- 60-sekunders testgräns.
- Publiceringskonflikter.
- Återpublicering.
- platform_table_classification.
- Tenantavgränsning av publiceringstabellens unika nycklar.
- Genererad schema-/typparitet.

har senare verifierats inom den godkända körningen ovan.

Börja inte om med dessa gamla kandidater.
Höj inte timeout eller regenerera snapshot enbart för att äldre
chattmeddelanden beskriver ett misslyckande.

Hämta aktuell:
- Remote arbetsgren.
- PR-beskrivning.
- Aktuell main.
- Senaste relevanta CI-status.
- Lokal git status och diff.

Vid kontrollen var main:
53bf989b0ad402bb2ce151c186eea31f1ec9cf03.

Det är inte samma sak som PR:ens ursprungliga bas.
Kontrollera integrationsbehov mot faktisk aktuell main utan att
återställa, skriva över eller starta om arbetsgrenen.

Nyare verifierat arbete går före denna historiska checkpoint.
Om en ny överlämningscommit finns, skilj dess ändringar från den
senaste testade kodversionen.

Fortsätt på samma gren och samma PR.
Skapa inte en parallell ersättningsimplementation.

## 3. LÄS RÄTT UNDERLAG EN GÅNG

Läs:
- AGENTS.md.
- Relevanta projektregler och installerade skills.
- Överlämningen från föregående agent.
- PR #418.
- Befintligt masteruppdrag.
- Relevant aktuell kod och tester.

Initiativets arbetskatalog:
quality/audits/tenantservice-api-ops-20260928/

Läs särskilt:
- README.md.
- handover.md, om den finns.
- requirements.csv.
- delegated-customer-proof-boundary.md.
- case-exposure-trace.md.
- threat-model.md.
- manifest.json.
- Relevanta API-/action-/UI-inventeringsfiler.

Viktig gräns:
- Initiativets checkpoint får inte skriva över en annan agents
  aktiva Ediel-checkpoint.
- Använd initiativets egen arbetskatalog för detta arbetes status.

Inventeringen är ett befintligt underlag.
Gör inte om hela inventeringen efter varje kodändring.
Uppdatera de delar som berörs och komplettera verkliga luckor.

Statiska kontrollträffar är inte automatiskt unika knappar eller fel.
Klassificera dem efter faktisk funktion, handler, roll och resurs.

## 4. STYR GENOM HELA UPPDRAGET MED TYDLIGA BEROENDEN

Skapa eller uppdatera en kort genomförandeordning för återstående arbete.

För varje paket:
- Vilket användarbeteende ska bli färdigt?
- Vilka krav omfattas?
- Vilka beroenden är faktiskt nödvändiga?
- Vilka externa uppgifter saknas?
- Vilken kod, databas, API och UI måste ändras tillsammans?
- Vilket verifieringsbevis krävs?

Arbeta med en sammanhängande implementation åt gången.
Efter verifiering: fortsätt med nästa.

Markera inte allt som blockerat för att ett övergripande krav
innehåller en extern produktionskontroll.

Dela vid behov ett brett krav i spårbara underfall:
- OPS.
- Egen kundportal.
- Externt kund-API.
- Databas/RPC.
- Webhook.
- Notifiering.
- Produktion.

Bevara originalkravet och dess fulla omfattning.
Godkänn bara de underfall som faktiskt är verifierade.

Rätta inaktuella statusrader som fortfarande anger gamla misslyckade
körningar när nyare evidens finns. Bevara tidigare historik.

## 5. NÄSTA IMPLEMENTATION: IDENTITET OCH GEMENSAM KONTAKTÄNDRING

Den senaste checkpointen pekar på:
- Verifierad extern kundidentitet och mandat.
- Gemensam atomisk kontaktändring genom OPS och API.

Börja där, inte med ännu en omgång publiceringspolering.

### 5.1 Verifierad aktörskontext

Behåll befintlig tenantbunden behörighetsmotor och skilj:
- Tenantmedarbetare.
- Slutkund.
- Maskinklient.
- Plattformssupport.

Använd verifierad aktör, tenant, kundrelation, resurs, handling,
fältbehörighet och eventuell ny verifiering.

En API-nyckel identifierar integrationen.
Den bevisar inte ensam vilken slutkund som agerar.

Läs befintligt dokument om kunddelegering och fatta ett dokumenterat
tekniskt beslut för kodkontraktet inom befintlig arkitektur.

Implementera en säker konfigurerbar verifieringsgräns:
- Betrodd utfärdare.
- Förväntad målgrupp.
- Signatur och tillåtna algoritmer.
- Giltighet.
- Stabil användaridentitet.
- Bindning till rätt tenant, integration och aktiv kundrelation.
- Hantering av återkallelse.
- Handlingsbundet bevis där risken kräver det.

Återanvänd etablerade bibliotek och befintlig autentisering.
Bygg inte egen kryptografi.

Hämta verklig tillåten integrationskonfiguration där åtkomst finns.
Anta inte att en viss tenant använder en viss identitetsleverantör.

Om verklig utfärdarkonfiguration saknas:
- Implementera kontraktet och negativa tester.
- Använd en tydligt isolerad testutfärdare i integrationstester.
- Neka okonfigurerad verklig användning.
- Markera produktionsanslutningen som externt blockerad.
- Fortsätt med OPS och övriga oberoende funktioner.

En testutfärdare eller klientvald verified-flagga får aldrig
accepteras som verkligt produktionsmandat.

Ingen fallback från misslyckat identitetsbevis till mejl,
kundnummer eller självvalt användar-ID.

### 5.2 Gemensam kontaktändring

Skapa eller återanvänd ett tydligt domänkommando.

Både OPS och API ska använda samma affärslogik, men med respektive
verifierade aktörs rättigheter.

Den lokala transaktionen ska omfatta:
- Auktoritativa kundfält.
- Affärsmässigt nödvändiga kontaktrelationer.
- Resursrevision.
- Nödvändig audit.
- Idempotensresultat.
- Beständig outboxavsikt.

Validera före skrivning.
Kontrollera behörighet och revision vid verkställighet.

Verifiera:
- Endast telefon ändras utan att andra fält rensas.
- Samma ändring genom OPS och API ger samma tillåtna resultat.
- Fel kund eller tenant nekas utan effekt.
- Samtidig ändring ger kontrollerad konflikt.
- Fel mitt i transaktionen ger rollback.
- Krasch efter commit före svar skapar inte dubbletter.
- Återspelning respekterar aktuell åtkomst.
- Kundkort, lista och kontaktvy visar rätt sparade revision.

Ett ofärdigt externt kundmandat får inte stoppa implementation
av ett säkert OPS-flöde. Externa vägen hålls då korrekt spärrad
tills dess nödvändiga verifiering finns.

## 6. PRODUKTFUNKTIONER SOM ALLTID INGÅR

### A. Tenantens egna supportsida

- Kunden skapar och följer egna ärenden via vårt API.
- Tenantens personal hanterar samma ärenden i OPS.
- Kundsynliga meddelanden och bilagor är uttryckligt avgränsade.
- Ingen parallell kund- eller ärendedatabas ska byggas.

### B. Telefonsupport

- Behörig medarbetare söker kunden inom rätt tenant.
- Registrerar telefoninteraktion.
- Kontrollerar kundidentitet och eventuellt ombud enligt riskpolicy.
- Fortsätter befintligt ärende eller skapar nytt vid behov.
- Gör tillåten ändring under sin egen identitet.
- Kunden behöver inte ha ett portalkonto.

Oidentifierad kontakt får inte kundhistorik eller ändringsrätt.
Uppringande nummer, personnummer och kundnummer är inte ensamma bevis.

Ny mejl eller telefon bevisar inte ägandet av gamla kontot.
Be aldrig om kundens lösenord eller autentiseringskoder.

### C. Direkt rättelse i OPS

- Tillåten medarbetare kan ändra utan fabricerat samtal.
- Verklig aktör och ändringsorsak registreras.
- Samma gemensamma domänkommando används.
- Kundkort, support och fakturavy ska inte ha olika skrivregler.

### D. Kanalbyte

Webb → telefon → OPS → Mina sidor ska fungera med samma kund,
ärende och historik.

Medarbetarens telefonsammanfattning får inte framställas som ett
autentiserat meddelande skrivet av kunden.

### E. Datagränser

Skilj:
- Kontaktmejl från inloggningsmejl.
- Kontakttelefon från säkerhetstelefon.
- Kundkontakt från juridisk avtalspart.
- Kundens faktureringsstandard från avtalsundantag.
- Kontaktadress från anläggnings- och leveransdata.

Kontaktändring får inte oavsiktligt:
- Ändra andra tenants data.
- Återställa kundens inloggning.
- Ändra juridisk part.
- Starta flytt eller leverantörsbyte.
- Aktivera Edieltrafik.

Definiera utelämnat, tomt, rensat, ärvt och explicit undantag.

## 7. FAKTURERING SKA VARA KONSEKVENT

Samordna samma effektiva faktureringsresolver för:
- Readiness.
- Förhandsgranskning.
- Fakturaförberedelse.
- Fakturaskapande.
- Export.
- Partnerintegration.

Resolvern ska ange mottagare, distributionsmetod, adress/mejl,
referens, profilrevision och värdets källa.

Skilj standard från uttryckligt undantag.
En standardändring ska inte skriva över redovisningsbyrå eller annan
avtalsspecifik mottagare.

Visa påverkan i UI och API.

Verifiera:
- Två avtal med olika ärvningsregler.
- Kontaktändring och fakturaändring separat.
- Profiländring samtidigt med fakturalåsning.
- Utkast kontra skickat eller låst underlag.
- Sena partnerkvittenser och dubbletter.
- Extern partner som är otillgänglig.

Utfärdade fakturor och signerade dokument ska inte skrivas om.
Omleverans är ett separat kontrollerat leveransbeslut.

Använd beständiga synkjobb och tydlig status.
Nödvändiga affärseffekter får inte vara fire-and-forget.
Lova inte global exactly-once-leverans.

## 8. SUPPORTENS SYNLIGHET OCH MANDAT

Återanvänd publiceringsarbetet som redan har godkänt delbevis.

Utöka till kvarvarande vägar:
- Externt kund-API.
- Kundmeddelanden.
- Notifieringar.
- Webhooks.
- Bilagor.
- Realtime där det används.

Skilj:
- Kundmeddelande.
- Intern anteckning.
- Kundsynlig status.
- Intern arbetsstatus.
- Telefonutkast.
- Verifieringsbevis.

En kundkoppling gör inte all intern ärendedata publik.
Intern text får inte automatiskt förifyllas i kundmeddelanden.

Tillbakadragen publicering ska nekas vid nya läsningar.
Påstå inte att redan levererad information kan göras ogjord.

Tenantens plattformssupport ska vara skild från kundens support
utan att skapa en fabricerad kundpost.

Plattformssupport får inte automatiskt imitera användare.
Eventuellt supportmandat är namngivet, tidsbegränsat, avgränsat,
återkallbart och spårbart.

## 9. UI SKA FÖRENKLAS I HELA OPS

Granska hela den befintliga UI-inventeringen och komplettera luckor.

Omfattningen inkluderar:
- Översikt och navigation.
- Kunder, sökning och kundkort.
- Support och kommunikation.
- Avtal och dokument.
- Anläggningar och mätpunkter.
- Mätvärden och förbrukning.
- Fakturering, import och export.
- Arbetsköer.
- Användare, roller och inbjudningar.
- Tenantinställningar och integrationer.
- Kundportal.
- Plattformens separata administrationsytor.

Principer:
- Få tydliga knappar.
- En primär handling per normal huvudåtgärdsyta.
- Normalt högst två sekundära direkta handlingar där.
- Samla ovanliga handlingar i en tydlig meny.
- Vanliga uppgifter först, avancerade alternativ vid behov.
- Samma komponent och affärslogik för samma uppgift.
- Ingen separat telefonredigering som skriver på annat sätt.
- Inga döda länkar, tomma handlers eller framgångstoastar utan effekt.
- Inga onödiga dubbla kort, formulär eller knappar.
- Behåll nödvändiga verksamhetsfunktioner och säkerhetsbekräftelser.

Kundkortets målbild:
- Fast kundhuvud med tenant, namn, kundnummer och status.
- Översikt.
- Uppgifter.
- Avtal & anläggningar.
- Fakturor.
- Ärenden & historik.

Huvudhandlingar:
- Registrera kontakt.
- Ändra uppgifter.
- Fler åtgärder.

Anpassa till befintligt välfungerande gränssnitt i stället för
en onödig totalskrivning.

UI-förenkling betyder inte att verkliga kundposter ska raderas
eller slås ihop.

### Effektiv kontroll av alla UI-åtgärder

Klassificera inventeringens träffar till verkliga handlingar.
Testa gemensamma komponenter parameteriserat, men verifiera också
varje användningsplats med annorlunda tenant, roll eller resurs.

För varje unik handling:
- Rätt synlighet.
- Rätt handler och mål.
- Serverbehörighet.
- Validering.
- Verklig persistens eller hämtning.
- Korrekta följdeffekter.
- Återläsning efter omladdning.
- Pending, dubbelklick och retry.
- Fel och avbrott.
- Nekad åtkomst utan sidoeffekt.
- Tangentbord och mobil.

Verifiera även sökning, filter, sortering, pagination, deep links,
uppladdning, nedladdning, menyer och dialoger.

Visa Spara/Avbryt tydligt.
Bevara utkast vid fel.
Hantera osparade ändringar och versionskonflikter.

En statisk knappträff eller ett lyckat klick är inte slutbevis.
Kontrollera rätt resultat bakom handlingen.

## 10. SÄKERHET SKA INGÅ I IMPLEMENTATIONEN

Använd hotmodellen och tillämplig OWASP ASVS-matris som testunderlag.
Kontrollera aktuell officiell dokumentation och installerade versioner.

Verifiera:
- Tenant-, kund-, objekt-, handlings- och fältbehörighet.
- MFA, återställning och återkallelse.
- Äldre token efter spärr.
- Rollhöjning och otillåten delegering.
- Direkt Data API och RPC.
- RLS, grants, views, Storage och databasfunktioner.
- Server-only-hemligheter och minsta privilegier.
- XSS, CSRF, injektion och mass assignment.
- Privata bilagor, karantän och skanning.
- SSRF vid URL- och webhookhantering.
- Webhooksignering, tidskontroll och deduplicering.
- Kvoter och rättvis resursfördelning.
- Tenantbunden cache och realtime.
- Audit, minimering, retention och larm.
- Backup/restore och incidentprocedur.
- Relevanta beroende-, hemlighets- och CI-kontroller.

Databasfunktioner får inte lita på klientvald actor_user_id.
En skyddad route räcker inte om en alternativ databasväg är öppen.
CORS, WAF och dolda knappar är inte ersättning för auktorisering.

Tester utförs i tillåten isolerad miljö med syntetiska data.
Ingen riktig kommunikation eller riktiga ekonomiska effekter.

## 11. API-DOKUMENTATION OCH KÖRBAR REFERENS

Samordna:
- Route-register.
- Valideringsscheman.
- OpenAPI.
- Operation-ID.
- Klienttyper.
- Exempel.
- Guider.
- Release-manifest.

Dokumentera:
- Kundidentitet och maskinmandat.
- Scopes och fältpolicy.
- Publika resursreferenser.
- Idempotens.
- Revision och konflikt.
- Väntande verifiering.
- Väntande extern synk.
- Pagination och fel.
- Verklig bakåtkompatibilitet.

En versionslåst OpenAPI-fil är inte bevis på äldre runtimebeteende.

Leverera en körbar isolerad referens för tenantens egen supportsida:
kundinloggning → supportärende → OPS-svar/ändring → återläsning.

Gör inte egna databas-ID:n eller hemligheter till publika kontrakt.

## 12. UNDERSÖK HELA SCHEMAKONTRAKTET FÖRE FULL REPLAY

Undvik en ny full körning för varje uteglömt register eller index.

För varje nytt eller ändrat databasobjekt, kontrollera tillsammans:
- Klassificering och ägare.
- company_id och nullregler.
- Tenantbundna relationer.
- Primärnyckel, unika nycklar och affärsmässig unikhet.
- Index.
- RLS och grants.
- Funktionsrättigheter och search_path.
- Triggers.
- Audit och retention.
- Replay/uppgradering.
- Migrationens registrering och checksummor.
- Genererade typer och schemaartefakter.
- Samtliga relevanta tenantinvarianter, inklusive F-6/F-8/F-10
  enligt den faktiska implementationen.

Ändra inte en nyckels betydelse enbart för att tillfredsställa en kontroll.
Förstå och bevara affärsregeln.

Generera schema och typer med befintliga autentiska verktyg.
Redigera inte genererade resultat eller gamla migrationshashar för hand.

Om en körning behövs för att generera artefakter:
- Ange syftet före körning.
- Registrera kod- och migrationsproveniens.
- Granska den semantiska diffen.
- Verifiera sedan det kompletta slutresultatet med ordinarie kontroller.

Kopiera inte in en gammal snapshot för att dölja ett nytt schemafel.
Ändra inte historiska migrationer.

## 13. EFFEKTIV TEST- OCH CI-STRATEGI

Använd tre nivåer:

A. Under utveckling
- Riktade regressionsfall.
- Berörda typkontroller och lint.
- Validerings- och schemakontraktskontroller.
- Snabba integrationsprov när infrastrukturen finns.

B. När en sammanhängande funktion är färdig
- Verklig isolerad databas.
- API/Server Action.
- Browser.
- Persistens och negativa behörighetsfall.
- Samlad diffgranskning.

C. När kandidatpaketet är genomarbetat
- Ordinarie obligatoriska CI-grindar.
- Ren replay vid schemaförändring.
- Genererad schema-/typparitet.
- Relevanta breda regressioner.

Låt ordinarie automatiska kontroller köras.
Stäng inte av grindar eller använd skip-markeringar för att spara tid.

Samla sammanhängande lokala commits till logiska pushar.
Starta inte extra manuella fullkörningar efter varje kosmetisk ändring.

Inför inte ett större CI-ombyggnadsprojekt om problemet kan lösas
genom bättre paketering och förhandskontroll.

Använd projektets stödda Node-version och låsta beroenden.

När CI kör:
- Gör diffgranskning, testanalys och förbered nästa paket.
- Undvik tät upprepad polling.
- Blanda inte nya oberoende kodändringar i en slutkandidat.
- Bevara exakt vilken version som faktiskt verifieras.

Rerun av en gammal körning verifierar inte senare commits.

Vid failure:
- Läs första faktiska fel och relevant artefakt.
- Skilj installation, migration, RPC, browser, post-browser och parity.
- Reparera rotorsaken med riktat test.
- Ett tillfälligt installationsfel får en motiverad begränsad retry.
- Upprepa inte samma misslyckande utan ny diagnos.

Vid timeout:
- Identifiera rätt tidsgräns och senast avslutade delsteg.
- Mät RPC, nätverk, lås, setup och cleanup.
- Höj inte tidsgränser på gissning.
- Bevara den sammanhängande verifieringen när stora tester delas upp.

Cache får effektivisera verktygsinstallation, inte ersätta kravet
på en faktiskt ren databas i clean-replay-grinden.

## 14. FORTSÄTT GENOM P0–P8 UTAN NYTT FORTSÄTT-MEDDELANDE

Bevara följande omfattning:

P0:
Komplettera nuläge, kravspårning, hotmodell och UI-klassificering.
Starta inte om befintlig inventering.

P1:
Identitet, tenant-RBAC, kundmandat, verifiering och återkallelse.

P2:
Gemensamma atomiska kontaktändringar, revision, audit,
idempotens och outbox genom OPS och API.

P3:
Konsekvent fakturering, ärvning/undantag, historik och partnersynk.

P4:
Tenantens webbsupport, telefonsupport, OPS, meddelanden och bilagor.

P5:
Förenkling och fungerande UI genom hela OPS, inte bara support.

P6:
Korrekt API-dokumentation och körbar referensintegration.

P7:
Samlad säkerhets- och prestandaverifiering.
Kontrollerna ska börja redan i tidigare paket.

P8:
Spårbar backfill, migrerings-/återställningsunderlag och
beredskap för tenantvis införande.
Verklig produktionsaktivering kräver separat beslut.

Paket får kombineras när de delar samma affärsflöde.
De får inte kombineras till en ogenomgången jättediff.

Parallella granskare får användas om verktygen finns och gränserna
är tydliga. De ska inte skapa konkurrerande skrivare på arbetsgrenen.
En ansvarig kodförfattare integrerar och verifierar resultatet.

## 15. KRAVMATRIS OCH SLUTBEVIS

Läs och behåll samtliga T01–T55 och U01–U20 i requirements.csv.

För varje krav:
- Ange faktisk berörd yta.
- Länka kod och test.
- Ange testad SHA och miljö.
- Ange positivt och negativt bevis.
- Ange vad som återstår.

Behåll skillnaden mellan partiellt kodbevis och full acceptans.
Använd inte totalt antal gröna tester som färdigställandegrad.

Slutscenario:
1. Kund öppnar tenantens supportsida.
2. Kund skapar ärende.
3. Ärendet visas hos rätt tenant i OPS.
4. Kund ringer.
5. Behörig medarbetare verifierar relevant identitet/mandat.
6. Medarbetaren ändrar tillåtna uppgifter.
7. Samma ärende och historik används.
8. Kunden ser rätt svar och uppgifter på Mina sidor.
9. Nästa fakturaunderlag använder rätt profilrevision.
10. Historiska dokument är oförändrade.
11. Andra kunder och tenants nekas i varje led.
12. Alla berörda UI-handlingar har verkligt verifierat resultat.

Verifiera med verkliga server-/databasgränser i isolering.
Mockar och statiska kontroller är komplement.

Skippade staging- eller produktionsjobb är inte godkända tester.
Markera miljöbegränsningar utan att stoppa oberoende kodleverans.

## 16. SPARA KONTINUERLIGT OCH RAPPORTERA RESULTAT

Efter varje sammanhängande verifierat paket:
- Commita.
- Pusha till samma gren.
- Uppdatera PR #418.
- Uppdatera befintlig kravmatris och checkpoint.
- Fortsätt direkt till nästa genomförbara paket.

Skapa inte mängder av överlappande statusdokument.
Ha en aktuell sammanfattning och spårbar evidens.

Rapportera verkliga förändringar:
- Vilken kund-/tenantfunktion som nu fungerar.
- Vilket krav som fått nytt bevis.
- Vilket faktiskt fel som återstår.
- Vilket paket du arbetar med härnäst.

Undvik upprepade statusmeddelanden som enbart säger att samma CI
fortfarande kör.

Om en extern blockerare återstår:
- Ange exakt vad som saknas.
- Ange säker standard när uppgiften saknas.
- Ange vad som ändå implementerats och testats.
- Fortsätt med annat oberoende arbete.

Om sessionen avbryts:
- Spara allt relevant på GitHub.
- Bevara lokala ändringar säkert.
- Lämna exakt head, testad version, run-ID och nästa kodsteg.
- Lova inte bakgrundsarbete.
- Påstå inte att hela uppdraget är klart.

Slutleveransen ska omfatta:
- Gren, PR och remote head.
- Genomförda paket.
- Krav och UI-åtgärder med verifieringsbevis.
- Säkerhetsfynd och kvarvarande risker.
- Migrationer, backfill och rollback.
- API-/UI-dokumentation.
- Externt blockerade produktionskontroller.
- Vad som återstår före ett separat merge-/införandebeslut.

Börja nu med att återta den senaste verifierade checkpointen och
implementera nästa sammanhängande P1/P2-flöde.

Avsluta inte uppdraget bara för att det första paketet blir grönt.