# GRIDEX – KOMPLETT UPPDRAG FÖR API, TENANTSERVICE, RBAC, KUNDÄNDRINGAR, SÄKERHET OCH ENKEL UI I HELA OPS

Arbeta i GitHub-repot:
heke99/gridex-ops-platform

Du ska undersöka, förbättra, implementera och verifiera en sammanhängande lösning för tenantens kundservice, kundändringar, API, Mina sidor och arbetsytan i OPS.

Detta är ett genomförandeuppdrag, inte endast en granskning eller en ny plan.

Arbeta systematiskt och självständigt i sammanhängande leveranspaket. Spara verifierade delsteg som commits på en separat arbetsgren och i samma draft-PR. Merga inte små delsteg löpande.

Alla krav nedan ska finnas kvar i en spårbar kravmatris tills de är verifierat genomförda, uttryckligt blockerade eller avgränsade genom ett dokumenterat beslut. Markera inte något som klart utan testbevis.

────────────────────────────────────────
1. ÖVERGRIPANDE MÅL
────────────────────────────────────────

Lösningen ska fungera genom följande ingångar:

- Tenantens egen supportsida via vårt API.
- Kundens Mina sidor via vårt API eller den befintliga kundportalen.
- Tenantens behöriga medarbetare i OPS.
- Telefonkontakt där tenantens medarbetare hjälper kunden i OPS.
- Behöriga integrationer och bakgrundsprocesser.

Samma tillåtna affärsändring ska ge samma korrekta resultat oavsett ingång.

Det innebär:

- Samma auktoritativa kunduppgifter.
- Samma regler för kontaktuppgifter och fakturering.
- Samma verifiering av tenant, kund, resurs och behörighet.
- Samma krav på historik, transaktioner och återförsök.
- Samma korrekta resultat i kundkort, listor, ärenden, fakturavyer och API.
- Ingen separat implementation av samma affärsregel i varje formulär.
- Ingen oavsiktlig ändring av andra kunder, tenants eller historiska dokument.

Samma affärsregler betyder inte samma rättigheter:

- Slutkunden har rättigheter till sina tillåtna kundkonton.
- Tenantens medarbetare har arbetsrelaterade rättigheter inom rätt tenant.
- API-klienten har uttryckliga scopes och ett avgränsat mandat.
- Plattformssupport har separat kontrollerad åtkomst.

Utöver funktionerna ska UI förenklas övergripande i hela OPS:

- Få och tydliga knappar.
- Ingen onödig dubbelinformation.
- Inga dubbla formulär eller parallella sätt att utföra samma ändring.
- Inga trasiga knappar, länkar eller menyer.
- Inga kontroller som ser fungerande ut men saknar verklig effekt.
- Samma komponenter, begrepp och beteenden för samma uppgift.
- Tydlig skillnad mellan tenantens arbetsyta och plattformens tekniska verktyg.

Det räcker inte att förbättra endast supportsidan eller ett kundkort.

────────────────────────────────────────
2. BÖRJA MED FAKTISKT NULÄGE OCH ISOLERA ARBETET
────────────────────────────────────────

- Hämta aktuell remote main och kontrollera faktisk head.
- Kontrollera aktiva PR:er och pågående arbete innan ändringar görs.
- En tidigare dokumenterad checkpoint var:
  d7eaa4b0b880b7280d8f164630a6cdb51baabba8.
- Denna SHA är endast historisk orientering, inte en instruktion att återgå till äldre kod.
- Återanvänd inte den tidigare Ediel-grenen eller PR #416.
- Rör inte pausad PR #310 utan ett nytt uttryckligt uppdrag.

Läs:

- AGENTS.md.
- Relevant projektminne och aktuella checkpoints.
- Relevanta installerade skills.
- Aktuella migrations- och API-register.
- Faktisk implementation och tester.
- Installerad ramverksdokumentation för den version projektet använder.

Prioritera:

1. Faktisk aktuell implementation och verifierad miljö.
2. Nyare verifierad GitHub-checkpoint.
3. Aktuella projektdokument.
4. Äldre chatt- och minnesuppgifter.

Arbetsregler:

- Kontrollera git status och diff.
- Bevara andra pågående ändringar.
- Använd separat arbetsgren och draft-PR för detta initiativ.
- Skriv inte direkt till main.
- Merga inte utan separat uttryckligt beslut.
- Utför inga produktionsmigrationer eller produktionsändringar utan separat tillstånd.
- Skicka inte riktig kundkommunikation.
- Rotera inte riktiga API-nycklar.
- Aktivera inte Edieltrafik eller andra externa affärsflöden.
- Säkerställ att utvecklingsarbete och preview inte av misstag använder produktionens skrivbehörigheter.

Om tidigare masterplan är tillgänglig, läs:
Gridex_Tenantservice_API_OPS_Masterplan_v2_2026-09-28.md

Denna prompt är dock fristående och ska kunna genomföras utan att filen finns.

────────────────────────────────────────
3. SKAPA EN FULLSTÄNDIG INVENTERING
────────────────────────────────────────

Inventera alla relevanta:

- API-routes.
- Server Actions.
- Databasfunktioner och RPC.
- RLS-policyer och grants.
- Triggers.
- Importer och exporter.
- Bakgrundsjobb.
- Webhooks.
- Kund- och faktureringsadaptrar.
- Läsmodeller.
- UI-sidor och komponenter.
- Formulär, knappar, länkar, menyer och andra interaktiva kontroller.

Inventeringen ska omfatta hela OPS-gränssnittet och särskilt:

- Översikter och dashboards.
- Kundlistor och kundsökning.
- Kundkort och samtliga kundkortsvyer.
- Kontaktpersoner och adresser.
- Support och ärenden.
- Kommunikation och notifieringar.
- Avtal och dokument.
- Anläggningar och mätpunkter.
- Förbrukning och mätvärden.
- Fakturering och fakturaunderlag.
- Import och export.
- Arbetsköer och uppgifter.
- Produkter, erbjudanden och prisvyer där de ingår i OPS.
- Användare, roller och inbjudningar.
- Tenantinställningar och integrationer.
- Kundportal och Mina sidor.
- Inloggning och kontoåterställning.
- Plattformens administrativa och tekniska vyer.

För varje läs- och skrivväg, dokumentera:

- Ingång och kodfil.
- Vem som får använda den.
- Hur tenant och kund fastställs.
- Vilka fält den får läsa eller ändra.
- Vilken serverfunktion och databasoperation som används.
- Vilka efterföljande effekter som skapas.
- Hur resultatet visas.
- Befintliga tester och saknade tester.
- Om vägen ska behållas, förbättras, samordnas eller avvecklas.

För varje UI-åtgärd, dokumentera:

- Ett stabilt åtgärds-ID.
- Sida och komponent.
- Knapptext eller annan identifiering.
- Tillåtna roller och relevanta tillstånd.
- Förväntad funktion.
- Serveroperation eller navigeringsmål.
- Förväntad databas- och UI-effekt.
- Testfall och senaste verifierade resultat.

Återkommande komponenter får dela testdefinition, men varje användningskontext med annorlunda behörighet, resurs eller beteende måste omfattas.

Skilj mellan:

- Verifierad funktion.
- Verifierat fel.
- Misstänkt risk.
- Saknad implementation.
- Saknat testbevis.
- Externt blockerad verifiering.

En knapp är inte verifierad bara för att den har en onClick-handler.

────────────────────────────────────────
4. GRANSKA SÄRSKILT TIDIGARE IDENTIFIERADE OMRÅDEN
────────────────────────────────────────

Kontrollera dessa implementationsområden mot aktuell kod:

- app/admin/customers/[id]/profile-actions.ts
- app/admin/customers/[id]/profile-actions.part-1.ts
- app/api/v1/customer/profile-update/route.ts
- lib/api/strictRequest.ts
- lib/customer-portal/customerResolver.ts
- lib/customer-portal/externalApi.ts
- lib/customer-portal/db.ts
- Portalens kompletteringsformulär och actions.
- lib/customer-cases/support.ts
- lib/customer-cases/db.ts
- app/admin/customer-cases/actions.ts
- API-vägar som tar emot kund- och supporthändelser.
- lib/admin/guards.ts
- lib/admin/apiGuards.ts
- lib/admin/accessModel.ts
- lib/rbac/getUserPermissions.ts och dess aktuella konsumenter.
- Tenantguards och den aktuella SQL-baserade behörighetsmotorn.
- lib/billing/billingReadiness.ts
- lib/billing/exportCenter.ts
- Fakturaförberedelse, export och partneradaptrar.
- Kundkortets page.part-* och tillhörande komponenter.
- lib/customer-operations/customerCardTenantView.ts
- lib/api/publicRouteRegistry.ts
- API-kontraktskonstanter, release-manifest, OpenAPI och guider.

Undersök särskilt:

- Om OPS och API fortfarande uppdaterar kunduppgifter på olika sätt.
- Om kund, primärkontakt, audit och outbox skrivs i separata osäkra steg.
- Om kunduppslag eller synk kan skriva över portalroll, kontostatus eller verifieringstid.
- Om faktureringskontroll och export använder olika mottagarregler.
- Om interna ärendefält kan exponeras för kunden.
- Om supportfiltrering sker efter att resultatet redan begränsats.
- Om äldre behörighetshelpers ger felaktig visning eller används i en skyddad väg.
- Om generella profilformulär blandar kontaktändringar med juridisk identitet och livscykelstatus.
- Om UI erbjuder handlingar som användaren inte får genomföra.

Tidigare observationer är startpunkter, inte automatiskt aktuella säkerhetsfynd.

Reproducera misstänkta fel. Kontrollera faktiska aktiva databasdefinitioner i en tillåten miljö. En migrationsfil bevisar inte ensam hur en driftsatt databas fungerar.

────────────────────────────────────────
5. KUNDRESOR SOM SKA FUNGERA
────────────────────────────────────────

5.1 Tenantens egen supportsida

- Kunden autentiseras hos rätt tenant.
- Kunden skapar ett ärende genom vårt API.
- Ärendet visas hos rätt tenant i OPS.
- Tenantens medarbetare svarar i OPS.
- Kunden ser svaret på tenantens webbplats.
- Kunden kan fortsätta dialogen och hantera tillåtna bilagor.
- Kunden ser endast kundsynlig information.

5.2 Kunden ringer

- Medarbetaren söker efter kunden inom sin tillåtna tenant.
- Medarbetaren registrerar en telefoninteraktion.
- Kundens identitet och eventuellt ombud kontrolleras enligt riskpolicy.
- Medarbetaren fortsätter ett befintligt ärende eller skapar ett nytt.
- Medarbetaren kan ändra tillåtna uppgifter i OPS.
- Ändringen registreras under medarbetarens verkliga identitet.
- Kunden ska inte behöva ett portalkonto för att få behörig telefonhjälp.

5.3 Direkt ändring i OPS

- Behörig medarbetare öppnar kunden.
- Medarbetaren väljer Ändra uppgifter.
- Samma domänkommando används som från motsvarande API-flöde.
- Ändringsorsak och aktör registreras.
- Fabricera inte ett telefonsamtal eller en kundinloggning.

5.4 Kunden byter kanal

- Webbärende kan fortsätta via telefon och sedan webb.
- Samma ärende och kundrelation används.
- Ingen dubbel kund skapas.
- Historik och referenser bevaras.
- Telefonsammanfattningen visar att den registrerats av medarbetaren.

5.5 Oidentifierad kontakt

- Tillåt ett begränsat kontaktintag där verksamheten behöver det.
- Lämna inte ut kundhistorik eller kundexistens.
- Tillåt inte kundkoppling eller profiländring genom en obekräftad identifierare.
- Kundnummer, personnummer, uppringande nummer eller inskickad mejl är inte ensamt identitetsbevis.
- Skapa inte en aktiv portalrelation automatiskt.

────────────────────────────────────────
6. GEMENSAM ARKITEKTUR
────────────────────────────────────────

Behåll befintlig stack och återanvänd lämpliga domänmoduler.

Skapa inte:

- Ett parallellt CRM.
- Ett separat kundregister för support.
- Ett nytt fristående faktureringsregister utan konstaterat behov.
- En generell skrivproxy till databasen.
- Mikrotjänster enbart för att omstrukturera befintlig kod.

Använd följande kedja:

Kanaladapter
→ verifierad aktörskontext
→ tenant-/resurs-/handlings-/fältpolicy
→ domänkommando
→ lokal transaktion
→ beständig integrationskö
→ gemensamma läsmodeller.

OPS Server Actions får anropa samma skyddade servermodul direkt. De behöver inte göra HTTP-anrop tillbaka till det egna API:t.

Aktörskontexten ska innehålla relevant:

- Aktörstyp.
- Verifierad användare eller API-klient.
- Tenant.
- Målresurser.
- Kundrelation och mandat.
- Permissions och scopes.
- Autentiseringsnivå och verifieringstid.
- Ändringsorsak.
- Verifieringsreferens.
- Ärende- eller interaktionsreferens.
- Request- och correlation-ID.

Klientvalda actor_user_id, company_id, channel, on_behalf_of eller verified-flaggor är inte behörighetsbevis.

Dela upp ansvar i tydliga operationer, exempelvis:

- Ändra kontaktuppgifter.
- Begära och verifiera inloggningsändring.
- Ändra faktureringsinställningar.
- Registrera telefonkontakt.
- Skapa eller fortsätta supportärende.
- Skicka kundmeddelande.
- Spara intern anteckning.
- Ändra tillåten ärendestatus.

Detta är ansvar, inte en order att skapa en ny tabell eller klass för varje punkt.

────────────────────────────────────────
7. TRANSAKTIONER, SAMTIDIGHET OCH ÅTERFÖRSÖK
────────────────────────────────────────

- Validera hela det atomiska kommandot före ändring.
- Kontrollera behörighet, målresurs, verifieringsbevis och revision vid verkställighet.
- Lita inte bara på kontrollerna när formuläret öppnades.

En lokal transaktion ska omfatta:

- Auktoritativ ändring.
- Nödvändiga relationsuppdateringar.
- Revisionsnummer.
- Nödvändig ändringshistorik.
- Idempotensresultat.
- Beständig avsikt för externa efterföljande effekter.

Externa system ingår inte i samma databastransaktion.

- Använd beständiga operationstillstånd och outbox.
- Använd inte fire-and-forget för nödvändiga affärseffekter.
- Visa lokalt genomförd ändring och väntande extern synk separat.
- Gör inte en lyckad affärsändring till ett misslyckande enbart för att vanlig telemetri fallerar.

Samtidighet:

- Använd resursrevision och optimistisk låsning.
- Välj en konsekvent kompatibel modell för versionskonflikter.
- Två samtidiga ändringar får inte tyst skriva över varandra.
- Ett gammalt formulär får inte rensa nyare uppgifter.

Idempotens:

- Avgränsa nyckeln till tenant, aktör/klient, resurs och operation.
- Använd atomisk claim och databasunikhet.
- SELECT följt av INSERT är inte tillräckligt som samtidighetsskydd.
- Samma nyckel och payload ska ge samma logiska resultat.
- Samma nyckel med annan payload ska ge konflikt.
- Krasch efter commit men före svar får inte skapa dubbletter.
- Återspelade svar ska fortfarande behörighetskontrolleras.

Köer:

- Tål dubbletter och fel ordning.
- Har leasing, begränsade återförsök och avstämning.
- Sena events får inte återställa äldre profiluppgifter.
- En återkallelse ska bedömas för ännu inte verkställda känsliga handlingar.
- Återkallelse får inte leda till att redan genomförda effekter dupliceras.
- Dokumentera vilka följdeffekter som är del av ett redan godkänt affärsbeslut.
- Lova inte global exactly-once-leverans.

────────────────────────────────────────
8. KUNDUPPGIFTER OCH DATAÄGARSKAP
────────────────────────────────────────

Håll isär:

- Inloggningsmejl.
- Kundkontaktmejl.
- Kontakttelefon.
- Telefon för autentisering eller kontoåterställning.
- Fakturamejl.
- Fakturaadress.
- Avtalsspecifika undantag.
- Kontaktperson och juridisk kund.
- Anläggningsdata.
- Avtalspart och identitetsuppgifter.

Regler:

- Kontaktändring får inte automatiskt ändra inloggningen.
- Inloggningsändring sker hos rätt identitetsleverantör.
- Använd stabil identitet med utfärdare och användar-ID.
- Samma mejl i flera tenants får inte orsaka global uppdatering.
- Samma mejl får inte användas för automatisk sammanslagning av kunder.
- Företagskontakt är inte automatiskt fakturamottagare eller avtalspart.
- Granska primärkontaktsynk innan befintligt beteende återanvänds.
- Kontaktändring får inte ändra marknadsdata, flytt eller leveranspunkt.
- Juridiska ändringar ska hanteras separat.
- Statusändringar som avslut, spärr eller återaktivering ska inte gömmas i vanlig kontaktredigering.

Definiera:

- Utelämnat fält.
- Tomt fält.
- Explicit rensning.
- Ärvt värde.
- Explicit undantag.

En ändring av endast telefonnummer får inte rensa mejl, namn eller juridiska uppgifter.

Normalisering ska vara konsekvent mellan API och OPS:

- E-post.
- Internationella telefonnummer.
- Namn och företagsnamn.
- Adresser.
- Språk och tidszoner.

Dokumentera vilken datakälla varje kundvy och integration använder.

────────────────────────────────────────
9. KORREKT FAKTURERING
────────────────────────────────────────

Skapa eller återanvänd en gemensam effektiv faktureringsresolver.

Samma resolver ska användas för:

- Faktureringsberedskap.
- Förhandsgranskning.
- Fakturaförberedelse.
- Fakturaskapande.
- Export.
- Relevanta partnerflöden.

Resultatet ska ange:

- Mottagare.
- Distributionsmetod.
- Mejl eller postadress.
- Referens.
- Profilrevision.
- Källa till värdet.
- Eventuella blockerare.

Ärvning:

- Skilj kundens standard från uttryckliga avtals- eller betalningskontoundantag.
- En standardändring ska inte skriva över egna undantag.
- Visa vilka avtal som påverkas.
- Bevara skillnaden mellan ett kopierat värde och avsiktlig ärvning.
- Använd ingen dold fallback till en obekräftad kontaktadress.

Exempel som måste fungera:

- Kunden har två avtal.
- Ett ärver faktureringsstandarden.
- Det andra går till redovisningsbyrå.
- Kunden ändrar standardmejlet.
- Endast det ärvande avtalet påverkas.
- UI och API visar tydligt detta resultat.

Historik:

- Utfärdade fakturor och signerade dokument ska inte skrivas om.
- Omleverans till ny verifierad adress är ett separat spårbart beslut.
- Rättelser ska följa befintligt kontrollerat fakturaflöde.
- Utkast och ännu inte låsta exporter ska upptäcka ändrad profilrevision.
- Redan skickad export får inte ändras tyst.
- Hantera partnerns egen kundprofil och kvittenser enligt dess faktiska kontrakt.

Partnerfel:

- Spara kö och synkstatus.
- Skydda påverkad fakturadistribution.
- Stoppa inte all support på grund av ett partnerfel.
- Ändra inte befintliga tenantspärrar eller livscykelregler blint.

────────────────────────────────────────
10. RBAC OCH TENANTISOLATION
────────────────────────────────────────

Utveckla den befintliga tenantbundna behörighetsmotorn.

Mappa befintliga roller innan nya införs.

Skilj mellan:

- Tenantadministratör.
- Kundtjänstmedarbetare.
- Kundtjänstansvarig.
- Ekonomi med läsrättighet.
- Ekonomi med särskild skrivbehörighet.
- Operationsroller.
- Integrationsansvarig.
- Slutkundens olika kontoroller.
- Maskinklient.
- Plattformssupport.
- Plattformens administratör.

Behörighetsbeslut ska omfatta:

- Aktiv autentisering.
- Aktiv tenantrelation.
- Faktisk måltenant.
- Kundrelation.
- Resurs.
- Handling.
- Tillåtna fält.
- Nödvändigt verifieringsbevis.

Kontrollera också:

- Direkta användarundantag.
- Allow och deny.
- Äldre rollalias.
- Legacy-fallbacks.
- Inbjudningar.
- Rolländringar.
- Återkallelse.
- Skydd för sista behöriga ägare.

Krav:

- Admin i tenant A och läsare i B får aldrig använda A:s rättigheter i B.
- En tenantadmin får inte skapa plattformsbehörighet.
- Ingen får delegera större rättigheter än mandatet tillåter.
- Tenantinställningar får inte sänka plattformens säkerhetsminimum.
- En ekonomiläsare ska inte få skriva eller exportera enbart på grund av rollnamnet.
- Kundtjänst ska inte automatiskt få ändra juridisk part eller återställa kundens inloggning.

Gör kundresolvern läsande:

- Vanligt uppslag får inte skriva owner-roll.
- Uppslag får inte återaktivera spärrade konton.
- Uppslag får inte skapa nytt verifieringsbevis.
- Explicit länkning är en separat kontrollerad operation.
- Befintliga spärrar och begränsade roller ska bevaras.

Kontrollera behörighet innan skyddad data hämtas eller skickas till browsern.

CSS, dolda knappar och klientkod är inte åtkomstkontroll.

────────────────────────────────────────
11. EXTERN PORTALIDENTITET OCH TELEFONVERIFIERING
────────────────────────────────────────

Extern portal:

- Tenantens API-hemlighet finns endast i backend.
- Ett API-scope bevisar inte slutkundens behörighet.
- Verifiera identitets- eller delegeringsbevis från en betrodd källa.
- Kontrollera signatur, utfärdare, målgrupp, giltighet och tenant-/klientbindning.
- Kontrollera aktiv kundrelation.
- Lita inte på klientvalda roller eller användarredigerbar metadata.
- Dokumentera förtroendegränsen till tenantens backend.

Ett kundpåstående som skapas med samma stulna breda API-nyckel är inte ett oberoende skydd.

För högriskoperationer behövs därför separat handlingsbundet bevis eller ett kontrollerat godkännandeflöde.

Telefon:

- Använd riskbaserad verifiering.
- Normal kundservice ska vara enkel, men känsliga handlingar kräver mer.
- Använd befintlig stark identifiering där den faktiskt finns.
- Anta inte att BankID eller en annan leverantör redan är färdigintegrerad.
- Ha en kontrollerad alternativprocess där stark identifiering saknas.
- Kontrollera ombud och företagsmandat.

Verifieringsbevis ska där relevant:

- Bindas till kund och tenant.
- Bindas till handling och betydelsefulla ändringsuppgifter.
- Ha begränsad giltighet.
- Vara engångsanvändbara.
- Kunna återkallas.
- Kontrolleras på servern vid verkställighet.

Säkerhetsregler:

- Ny mejl eller nytt telefonnummer bevisar inte ägandet av gamla kontot.
- Be aldrig kunden lämna lösenord, inloggnings-MFA-koder eller BankID-säkerhetskod.
- Gör inte manuell högriskåterställning till en kryssruta.
- Den som initierar en högriskbegäran får inte godkänna sin egen begäran när separat godkännande krävs.
- Logga maskinhandlingar som maskinhandlingar, inte som påhittad slutkund.

────────────────────────────────────────
12. SUPPORT OCH KOMMUNIKATION
────────────────────────────────────────

Återanvänd befintliga kundärenden och utveckla deras ansvar.

Skilj uttryckligt mellan:

- Kundärende.
- Telefon- eller annan kontaktinteraktion.
- Kundmeddelande.
- Intern anteckning.
- Kundsynlig status.
- Intern arbetsstatus.
- Privat bilaga.
- Verifieringsbevis.
- Ändringsoperation.

Krav:

- Ett samtal kan kopplas till ett befintligt ärende.
- En enkel telefonkontakt behöver inte skapa ett nytt ärende.
- Ärendet ska ha rätt tenant och kund.
- Resurser som faktura eller anläggning måste tillhöra samma tillåtna resursgraf.
- Kunden får inte välja intern prioritet, handläggare eller godkännandestatus genom oreglerade fält.
- Ärendets tillåtna statusövergångar ska kontrolleras på servern.

Synlighet:

- Kundmeddelanden och interna anteckningar ska ha tydligt skilda kontrakt.
- Generella interna fält som next_action får inte automatiskt bli kundinformation.
- Telefonutkast ska inte automatiskt publiceras eller skickas.
- Publicerad telefonsammanfattning ska visa verklig författare och kanal.
- En kundanknytning gör inte alla äldre ärendefält offentliga.
- Klassificering ska följa med bilagor, notiser, webhooks och realtime.
- Ett publikt ärende kan innehålla interna delar som aldrig lämnar OPS.

Tenant→Gridex:

- Håll plattformssupport skild från kund→tenant-support.
- Skapa inte en fabricerad kundpost för tenantens plattformsärenden.
- Återanvänd gemensamma meddelandefunktioner där det är lämpligt.

Plattformssupport:

- Ärende ger inte automatisk full tenantåtkomst.
- Eventuella supportmandat ska vara namngivna, tidsbegränsade och avgränsade.
- De ska kunna återkallas och vara synliga i historik och UI.
- Läsning är normal utgångspunkt.
- Skrivning kräver särskilt mandat.
- Låt inte vanlig kundtjänst arbeta genom användarimitation.

Inför inte automatisk samtalsinspelning eller ny telefonileverantör som bieffekt av detta uppdrag.

────────────────────────────────────────
13. API OCH DOKUMENTATION
────────────────────────────────────────

Utgå från befintligt publikt API-register, valideringsscheman och felmodell.

Implementera eller samordna API-funktioner för:

- Läsa tillåten kundprofil.
- Ändra tillåtna kontaktuppgifter.
- Läsa och ändra tillåtna faktureringspreferenser.
- Begära och följa verifieringskrävande ändring.
- Skapa, lista och läsa egna supportärenden.
- Skriva och läsa kundsynliga meddelanden.
- Säker bilagehantering.
- Läsa operationstatus.
- Ta emot relevanta kundsynliga händelser.

En möjlig grupp är:
/api/v1/customer/support/cases

Bestäm exakta paths och HTTP-metoder utifrån befintligt register och kompatibilitet. Skapa inte dubbla resurser för samma ansvar.

API-kontrakt ska dokumentera:

- Autentisering och delegerad kundidentitet.
- Scopes och fältbehörigheter.
- Publika resursreferenser.
- Resursrevision.
- Idempotens.
- Felkoder.
- Status för väntande verifiering.
- Status för väntande extern synk.
- Sidindelning och begränsningar.
- Förväntade följdeffekter.

Regler:

- Publik resursreferens är inte behörighetsbevis.
- 202 får endast användas när en beständig operation finns att följa.
- Listning ska filtrera rätt före sidindelning.
- Cursors ska ha stabil ordning och rätt tenant-/resursbindning.
- Kunddata och interna ärendedata ska ha separata uttryckliga svarstyper.

Dokumentation:

- Samordna API-register, OpenAPI, exempel, guider och genererade typer.
- Säkerställ unika operation-ID:n.
- Rätta versionsdrift.
- Publicera och verifiera release-manifest och dokumenthashar där detta används.
- Skilj Website, Kundportal/Support och behöriga integrationsfunktioner i dokumentationsvyer.
- Kopiera inte affärsregler mellan separata guider.
- Dokumentera verklig runtimekompatibilitet.
- Versionslåst OpenAPI betyder inte automatiskt att gammalt serverbeteende finns kvar.
- Inventera befintliga klienter och planera kontrollerad övergång.
- Behåll inte osäkra gamla vägar obegränsat i kompatibilitetens namn.

Leverera en körbar syntetisk referensintegration som visar hela kundresan, inte bara en lista med endpoints.

────────────────────────────────────────
14. UI SKA VARA ENKEL ÖVERGRIPANDE I HELA OPS
────────────────────────────────────────

Detta är ett uttryckligt huvudkrav.

Gå igenom hela OPS-gränssnittet, inte bara de nya funktionerna.

14.1 Gemensam struktur

- Återanvänd ett konsekvent sidhuvud, navigation, formulärmönster och åtgärdsmeny.
- Använd samma namn för samma begrepp.
- Visa tydligt vilken tenant användaren arbetar i.
- Skilj tenantläge från plattformsläge.
- Anpassa navigation efter verkliga arbetsuppgifter och behörigheter.
- Gör inte hela plattformens tekniska meny synlig för tenantens kundtjänst.

Föreslagen tenantnavigation:

- Översikt.
- Kunder.
- Ärenden.
- Fakturering.
- Inställningar.

Avtal, anläggningar och andra arbetsytor ska vara lätt åtkomliga där rollen behöver dem. Förenkling får inte göra nödvändiga funktioner svåra att hitta.

14.2 Kundkort

Föreslagen struktur:

- Översikt.
- Uppgifter.
- Avtal & anläggningar.
- Fakturor.
- Ärenden & historik.

Fast kundhuvud:

- Tenant.
- Kundnamn.
- Kundnummer.
- Kontaktuppgifter.
- Begriplig status.
- Relevant aktuell varning.

Normal huvudåtgärdsyta:

- En primär knapp: Registrera kontakt.
- En sekundär knapp: Ändra uppgifter.
- En samlad meny: Fler åtgärder.

Målet är normalt högst en primär och två sekundära direkta handlingar i sidhuvudet. Det gäller inte nödvändiga Spara/Avbryt eller navigation.

14.3 Redigering

- Visa vanliga uppgifter först.
- Öppna fördjupning endast när den behövs.
- Använd en gemensam redigeringspanel.
- Undvik flera olika formulär för samma kontaktuppgift.
- Kräv inte omsändning av hela juridiska kundprofilen för att ändra telefonnummer.
- Visa påverkan på fakturering och avtal.
- Ha ett tydligt sparande för den logiska ändringen.
- Ingen knapp per databastabell.
- Ingen tyst autosave för känsliga uppgifter.
- Bevara utkast vid valideringsfel.
- Varna vid osparade ändringar.
- Visa versionskonflikt begripligt.

14.4 Supportarbetsyta

- Få tydliga filter, exempelvis Mina, Ohanterade, Väntar och Avslutade.
- Ett tydligt meddelandeflöde.
- Kundkontext tillgänglig utan att användaren öppnar många olika sidor.
- Tydliga lägen: Svara kunden och Intern anteckning.
- Byt inte från internt till kundsynligt läge utan uttrycklig handling.
- Återanvänd Registrera kontakt från kundkort, kundsökning och ärende.
- Publicera inte interna samtalsutkast automatiskt.

14.5 Dubletter och onödiga kontroller

Identifiera och åtgärda:

- Dubbla knappar med samma funktion i samma sammanhang.
- Dubbla kort som visar samma information utan tydlig nytta.
- Dubbla formulär med olika regler för samma data.
- Parallella routes och komponenter för samma uppgift.
- Dubbla filter och statusindikatorer.
- Föråldrade och oanvända komponenter.
- Kvarlämnade experiment, placeholders och utvecklingskontroller.
- Onödiga modaler och bekräftelser för lågriskhandlingar.
- Tekniska knappar som inte hör hemma i tenantens arbetsflöde.

Viktigt:

- Kontextuella ingångar till samma gemensamma funktion är tillåtna.
- En länk från kundkort och en från ärende till samma redigeringspanel är inte i sig en felaktig dublett.
- Ta inte bort nödvändiga funktioner bara för att minska knappantalet.
- Radera inte verkliga kund-, faktura- eller ärendeposter som en del av UI-städning.
- Datadubbletter kräver ett separat kontrollerat beslut och får inte slås ihop på mejlmatchning.

14.6 Tillgänglighet och tydliga tillstånd

Verifiera:

- Tangentbord.
- Synligt fokus.
- Etiketter.
- Skärmläsarbegripliga kontrollnamn.
- Kontrast.
- Mobilvy.
- 200 procent zoom.
- Begripliga felmeddelanden.
- Laddning och tomma resultat.
- Read-only och blockerade handlingar.
- Pending och dubbelklick.
- Avbruten begäran och nätverksfel.

Använd relevant WCAG 2.2 AA som verifieringsmål.

Färg får inte vara den enda informationen om status.

────────────────────────────────────────
15. ALLA KNAPPAR OCH INTERAKTIONER SKA VERIFIERAS
────────────────────────────────────────

Skapa och underhåll ett UI-åtgärdsregister.

Gå igenom:

- Knappar.
- Länkar.
- Menyval.
- Flikar.
- Formulär.
- Sökning.
- Filter.
- Sortering.
- Sidindelning.
- Bulkåtgärder.
- Uppladdning och nedladdning.
- Statusväxlingar.
- Dialogrutor.
- Inbjudningar och behörighetsändringar.
- Export och kontrollerade återförsök.

För varje tillämplig åtgärd, verifiera:

1. Kontrollen visas för rätt roll och tillstånd.
2. Texten beskriver rätt handling.
3. Den anropar rätt handler eller navigeringsmål.
4. Servern kontrollerar behörighet.
5. Rätt tenant, kund och resurs används.
6. Validering sker före ändring.
7. Rätt data faktiskt sparas eller hämtas.
8. Relevanta följdeffekter skapas.
9. Resultatet visas korrekt.
10. Återläsning eller siduppdatering visar samma sparade resultat.
11. Berörda andra vyer uppdateras.
12. Fel och avbrott hanteras utan vilseledande framgång.
13. Dubbelklick och retry inte skapar dubbletter.
14. Nekad åtkomst inte ger sidoeffekter.
15. Kontrollens tangentbords- och mobilbeteende fungerar.

Det är inte godkänt med:

- Tom onClick.
- href="#" som ersättning för riktig navigation.
- Toast om framgång utan faktisk sparning.
- Knapp som gör fel sak.
- Fel kund- eller tenant-ID.
- Gamla routes som leder fel.
- Menyer som inte går att använda med tangentbord.
- Disabled-knappar utan begriplig förklaring där användaren behöver förstå blockeraren.
- Fel som bara syns i konsolen.
- Samma operation som skickas flera gånger vid dubbelklick.
- Visuellt dold funktion som fortfarande är oskyddat anropbar.

En trasig funktion ska antingen:

- Repareras och testas.
- Ersättas av en korrekt gemensam funktion.
- Avvecklas kontrollerat om den verkligen är obehövlig.

Dölj inte ett kvarstående krav och kalla det löst.

Destruktiva, ekonomiska eller externa åtgärder testas i isolering med syntetiska resurser och blockerad riktig leverans, aldrig mot riktiga kunder.

────────────────────────────────────────
16. INTRÅNGSSKYDD OCH SÄKERHETSVERIFIERING
────────────────────────────────────────

Ta fram en hotmodell för hela den berörda kedjan.

Använd OWASP ASVS 5.0.0 nivå 2 som utgångspunkt enligt tidigare plan och verifiera relevanta referenser mot aktuell officiell dokumentation. Dokumentera tillämpade krav och avgränsningar.

Kontrollera minst:

16.1 Autentisering

- MFA för relevanta personalroller.
- Säkra återställningsflöden.
- Sessionslivslängd och återkallelse.
- Äldre JWT efter spärr.
- Ny verifiering vid känsliga handlingar.
- Skydd mot rollhöjning och kundtjänstbaserat kontoövertagande.

16.2 Databas

- RLS.
- Tabell- och kolumngrants.
- Views.
- RPC-exekveringsrättigheter.
- SECURITY DEFINER-funktioner.
- Säkra search_path och ägarroller.
- Tenantbundna relationer och constraints.
- Direkt åtkomst genom databasens API.
- Storage-behörigheter.

En skyddad HTTP-route räcker inte om databasen kan ändras genom en oskyddad alternativ väg.

RPC får inte lita på klientvald aktör.

Service-role ska vara server-only och användas först efter uttrycklig kontroll. Minska privilegier där det går utan att skapa nya kringgående lösningar.

16.3 Webb och API

- CSRF.
- XSS i meddelanden, namn och andra textfält.
- SQL- och filterinjektion.
- Otillåtna fält och mass assignment.
- Objekt- och funktionsbehörigheter.
- Öppna redirects.
- Felaktiga CORS-antaganden.
- Säkerhetsheaders och CSP där relevant.
- Exponerade interna fel och stacktraces.

16.4 Bilagor och externa mål

- Privat lagring.
- Filtyp, storlek och innehållskontroll.
- Karantän och skanning.
- Resursbunden uppladdning.
- Skyddad hämtning.
- Begränsad giltighet för signerade länkar.
- Ingen godkänd status när skanning saknas.
- SSRF-skydd vid URL-hämtning och webhookmål.
- Kontroll även vid DNS, IPv6 och redirects.

16.5 Nycklar och webhooks

- Minsta scopes.
- Nycklars utgång och återkallelse.
- Säker rotation.
- Signering av exakta webhookbytes.
- Tidskontroll och event-ID.
- Deduplikering.
- Avgränsning mellan tenants.
- Ingen exponering av interna anteckningar i händelser.

16.6 Missbruk och tillgänglighet

- Kvoter per tenant, klient, användare och relevant IP.
- Skydd mot massläsning.
- Skydd mot spam och verifieringsförsök.
- Begränsning av fil- och exportkostnader.
- Rättvis köhantering mellan tenants.
- Lämpliga WAF-regler där infrastrukturen stödjer det.

WAF och CORS ersätter inte auktorisering.

16.7 Cache och realtime

- Tenant-/kund-/behörighetsbundna cacheposter.
- Ingen gemensam persondatacache mellan tenants.
- Korrekt invalidation vid ändring.
- Hantering av logout och återkallelse.
- Behörighetskontroll för livekanaler.
- Inga interna meddelanden i kundens realtimeflöde.

16.8 Loggning, drift och leveranskedja

- Logga verklig aktör, mål, beslut och orsak.
- Undvik API-hemligheter, koder och onödiga persondatasnapshotar.
- Skydda audit mot manipulation.
- Dokumentera retention och minimering.
- Inför eller återanvänd larm och incidentrutiner.
- Verifiera backup och återställning i isolering.
- Granska beroenden, hemligheter och relevanta CI-kontroller.
- Kontrollera branch protection och releasekontroller utan att ändra kontoinställningar utan tillstånd.
Använd befintlig testinfrastruktur och relevanta säkerhetsverktyg.

Inga intrångstester mot produktion, riktiga tenants eller externa leverantörer utan uttryckligt tillstånd.

Påstå inte att systemet är omöjligt att angripa. Redovisa vilka kontroller som verifierats och vilka risker som återstår.

────────────────────────────────────────
17. EFFEKTIVISERING
────────────────────────────────────────

Mät före optimering:

- Databasanrop per central operation.
- Svarsstorlek.
- p50 och p95.
- Kundkortets och supportvyns laddning.
- Sökning och sidindelning.
- Kölatens.
- Antal onödiga nätverksanrop.
- Onödiga renderingar och dubbelhämtningar.

Prioritera:

- Läsande kundresolver.
- Återanvändning av verifierad kontext inom samma request.
- Filter före sidindelning.
- Precisa fält i stället för onödiga select("*").
- Rätt index utifrån verkliga frågor.
- Flikvis dataladdning.
- Begränsade och stabila listor.
- Gemensamma beräkningar för fakturering.
- Borttagning av verklig dubbelkod.
- Avgränsad cache med korrekt återkallelse.
- Beständiga jobb för tyngre arbete.

Sätt mätbara budgetar efter baslinjen.

- Ange inte påhittade procentvinster.
- Optimera inte bort behörighetskontroller.
- Lägg inte till nya tjänster eller driftsplattformar utan konstaterat behov.
- Ta bort legacy-fallbacks först efter verifierad migrering.

────────────────────────────────────────
18. MIGRERING OCH KONTROLLERAD ÖVERGÅNG
────────────────────────────────────────

Inventera avvikelser mellan:

- Kundpost.
- Primärkontakt.
- Kontaktpersoner.
- Portalidentitet.
- Faktureringsinställningar.
- Avtalsundantag.
- Partnerns profil.

Krav:

- Använd additiva förändringar där det är lämpligt.
- Dokumentera backfill.
- Gör säkra fall deterministiska.
- Lägg tvetydiga historiska fall i granskningslista.
- Anta inte att lika strängvärden betyder avsiktlig ärvning.
- Ha en auktoritativ skrivväg under övergången.
- Låt inte gamla importer eller actions kringgå nya regler.
- Ändra inte historiska migrationsfiler.
- Generera databas- och API-typer korrekt.
- Verifiera tomdatabasreplay och uppgradering.

Rollback:

- Ska kunna stänga nya funktioner utan att återöppna gamla säkerhetshål.
- Ska bevara korrekta kundändringar och audit.
- UI-rollback är inte automatisk återställning av affärsdata.
- Feature flags får inte vara det enda skyddet för åtkomst.
- Pilotera tenantvis först efter isolerad verifiering och separat införandebeslut.

────────────────────────────────────────
19. OBLIGATORISK ACCEPTANSMATRIS
────────────────────────────────────────

Behåll följande test-ID:n i kravmatrisen.

T01. Tenant A kan inte läsa eller ändra kund, faktura, ärende eller bilaga i B.
T02. Kund A kan inte komma åt annan kund inom samma tenant.
T03. Admin i A och läsare i B förblir läsare i B.
T04. Resolver och normal synk ändrar inte begränsad portalroll.
T05. Spärrat portalkonto återaktiveras inte av uppslag eller retry.
T06. Rätt API-scope med fel slutkund nekas.
T07. Förfalskad aktör, tenant eller verifierad-flagga ger ingen rättighet.
T08. Tenantbyte i annan flik kan inte orsaka sparning till fel tenant.
T09. Direkt databas-/RPC-anrop med låg rättighet kan inte kringgå skydd.
T10. Återkallad session eller relation hanteras även med kvarvarande JWT.
T11. Kontaktändring via API och OPS ger samma tillåtna resultat.
T12. Ändring av endast telefon rensar inte andra fält.
T13. Inloggningsändring använder rätt identitetsleverantör och verifiering.
T14. Faktureringsstandard ändras utan att avtalsundantag skrivs över.
T15. Readiness och export använder samma mottagare och revision.
T16. Profiländring skriver inte om utfärdad faktura.
T17. Omleverans har separat verifierat leveransbeslut.
T18. Samtidig profiländring och fakturalåsning blandar inte revisioner.
T19. Samtidiga profilskrivningar ger inte tyst dataförlust.
T20. Ogiltigt fält i atomiskt kommando ger ingen partiell ändring.
T21. Fel före avslutad lokaltransaktion lämnar inte kund och kontakt osynkade.
T22. Krasch efter commit före HTTP-svar återhämtas utan dubblett.
T23. Samma idempotensnyckel med annan payload nekas.
T24. Samtidigt skapat ärende med samma nyckel ger ett logiskt ärende.
T25. Idempotensreplay kringgår inte återkallad rättighet.
T26. Webbärende visas i rätt tenant och rätt kundportal.
T27. Telefonsamtal kan fortsätta befintligt ärende.
T28. Identifierad kund utan portalkonto kan få behörig telefonhjälp.
T29. Oidentifierad kontakt får inte kunddata eller ändringsrätt.
T30. Ny mejl eller telefon bevisar inte ägande av gamla kontot.
T31. Utgånget, återspelat eller felbundet verifieringsbevis nekas.
T32. Ombud utan faktureringsmandat får inte faktureringsrätt.
T33. Intern anteckning förblir intern i API, UI, webhook och notis.
T34. Telefonsammanfattning visar verklig medarbetare och kanal.
T35. Bilagor kan inte nås genom annan kunds referens.
T36. Oskannad eller skadlig bilaga förblir i karantän.
T37. Webhook-/URL-hantering når inte otillåtna mål genom DNS eller redirect.
T38. Sen eller duplicerad partnerhändelse återställer inte gammal data.
T39. Partnerfel ger korrekt kö/status utan att stoppa all support.
T40. Belastning från en tenant ger inte obegränsad påverkan på andra.
T41. Återkallad API-nyckel stoppar nya otillåtna anrop.
T42. XSS, CSRF och otillåtna fält ger ingen obehörig effekt.
T43. Anonymt intag läcker inte kundexistens eller historik.
T44. Kundkort, lista och fakturavy visar korrekt revision efter sparning.
T45. Mobil, tangentbord, zoom, validering och konflikt är användbara.
T46. Obehörig teknisk deep link nekas på servern.
T47. Utgånget supportmandat stoppar fortsatt skyddad åtkomst.
T48. OpenAPI, guide och klient överensstämmer med runtime.
T49. Tomdatabasreplay och uppgradering bevarar relationer och semantik.
T50. Äldre importer, actions och RPC kan inte kringgå nya regler.
T51. Loggar innehåller inte hemligheter eller onödiga personuppgifter.
T52. Rollhöjning, återställning och nyckelutgivning har rätt skydd.
T53. Supportärenden kan pagineras fram även bland många andra ärenden.
T54. Samma sub eller mejl hos olika identitetsleverantörer blandas inte.
T55. Backup/restore och incidentprocedur verifieras i tillåten isolering.

Lägg dessutom till följande globala UI-krav:

U01. Samtliga OPS-sidor är inventerade och klassificerade.
U02. Varje unik UI-åtgärd har ett spårbart testfall.
U03. Knappar och menyval utför rätt handling på rätt resurs.
U04. Ingen kontroll visar framgång utan verifierat resultat.
U05. Spara, Avbryt och återläsning fungerar konsekvent.
U06. Dubbelklick och återförsök ger inte dubbla affärseffekter.
U07. Sökning, filter, sortering och sidindelning fungerar tillsammans.
U08. Länkar, deep links, bakåt/framåt och omladdning bevarar korrekt kontext.
U09. Roller styr både synliga kontroller och serveråtkomst.
U10. Menyer och dialoger fungerar med tangentbord och fokus.
U11. Valideringsfel bevarar användarens utkast.
U12. Osparade ändringar hanteras vid navigation.
U13. Mobil och zoom ger inga oåtkomliga centrala kontroller.
U14. Samma uppgift återanvänder samma komponent och affärslogik.
U15. Verkliga UI-dubletter är borttagna eller samordnade.
U16. Inga placeholders, döda länkar eller tomma handlers finns i levererad yta.
U17. Uppladdning, nedladdning och export verifierar rätt fil och behörighet.
U18. Laddning, tomt läge, fel, read-only och blockering visas tydligt.
U19. Plattformens tekniska funktioner är korrekt separerade från tenantläge.
U20. Hela berörda UI-flödet är browserverifierat med resultat och skärmbilder.

Samlat slutscenario:

- Kund skapar ärende på tenantens webbplats.
- Kunden ringer.
- Behörig medarbetare verifierar kunden enligt riskpolicy.
- Medarbetaren genomför tillåten ändring i OPS.
- Samma ärende fortsätter.
- Kunden ser rätt svar och uppgifter på Mina sidor.
- Nästa fakturaunderlag använder rätt profilrevision.
- Historiska dokument är oförändrade.
- Annan kund, annan tenant och obehörig roll nekas i hela kedjan.

────────────────────────────────────────
20. LEVERANSPAKET OCH ARBETSSÄTT
────────────────────────────────────────

Genomför i följande ordning:

P0 – Inventering och reproduktion
- Kravmatris.
- Route-/skrivarregister.
- Full UI-karta och åtgärdsregister.
- Datakällor.
- Hotmodell.
- Reproducerade fynd och miljöbegränsningar.

P1 – Identitet och RBAC
- Läsande resolver.
- Explicit länkning.
- Tenant-/kund-/fältpolicy.
- Verifiering och återkallelse.

P2 – Gemensam kontaktändring
- Domänkommando.
- Transaktion.
- Revision.
- Idempotens.
- Outbox.
- Samma fungerande ändring via OPS och API.

P3 – Fakturering
- Gemensam resolver.
- Standard och undantag.
- Profilversioner.
- Readiness/export/partnersynk.
- Begriplig UI-påverkan.

P4 – Sammanhängande support
- Webb.
- Telefon.
- OPS.
- Kundmeddelanden.
- Interna anteckningar.
- Bilagor.
- Kundportal-API.

P5 – Övergripande UI-förenkling
- Hela OPS-inventeringen behandlas.
- Gemensamma komponenter.
- Kundkort och listor.
- Ärenden, avtal, fakturering och inställningar.
- Obehövliga dubletter avvecklas.
- Alla UI-åtgärder får verifierat beteende.

P6 – API-dokumentation och referensklient
- OpenAPI.
- Guide.
- Exempel.
- Genererade typer.
- Webhookkontrakt.
- Versions- och runtimeparitet.

P7 – Samlad säkerhet och effektivisering
- Säkerhetsmatris.
- Relevanta verktyg och negativa tester.
- UI-regression.
- Mätningar.
- Driftlarm och rutiner.

P8 – Migrering och införandeberedskap
- Backfill.
- Konfliktlista.
- Replay och uppgradering.
- Rollback.
- Underlag för tenantvis pilot.

Säkerhet, UI-verifiering och kontraktstester ska göras löpande, inte vänta till P7.

P0–P2 är första sammanhängande leveranspaketet. Det är inte slutmålet för hela uppdraget.

Fortsätt därefter med nästa genomförbara paket utan att starta om redan verifierat arbete.

────────────────────────────────────────
21. VERIFIERING, COMMITS OCH DEFINITION AV KLART
────────────────────────────────────────

Ett paket är klart först när följande hänger ihop på samma commit:

- Kod.
- Databasdefinitioner.
- Behörigheter.
- API-kontrakt.
- UI.
- Faktiska affärseffekter.
- Tester.
- Dokumentation.

Ett grönt bygge är inte tillräckligt.

- Statiska kontroller är komplement.
- Mocktester är komplement.
- Slutbevis ska omfatta riktiga server- och databasgränser i isolerad miljö.
- UI ska verifieras i browsern.
- Kontrollera faktisk persistens, inte bara en toast eller HTTP 200.
- Kontrollera att relevant data visas korrekt efter omladdning och i andra vyer.
- Verifiera nekade vägar och att de inte lämnar sidoeffekter.

För varje sammanhängande del:

1. Beskriv kravet och befintligt beteende.
2. Skapa relevant regressionstest.
3. Implementera minsta korrekta sammanhängande lösning.
4. Granska diff.
5. Kör riktad verifiering och relevanta bredare tester.
6. Dokumentera resultat.
7. Commita och pusha.
8. Uppdatera samma draft-PR och checkpoint.
9. Fortsätt med nästa konkret återstående del.

Undvik:

- Oändliga återkörningar av redan gröna tester utan anledning.
- Att sänka testkrav för att få gröna siffror.
- Nya undantagslistor som döljer fel.
- TODO eller stubbar bakom fungerande knappar.
- Att markera en hel modul färdig när bara happy path fungerar.
- Att använda en äldre PR:s testresultat som bevis för ny kod.
- Att skriva om stora områden utan konstaterat behov.
- Att själv acceptera kvarstående allvarliga säkerhetsrisker.

Om en metod misslyckas upprepade gånger:

- Analysera orsaken.
- Byt angreppssätt.
- Dokumentera blockeraren.
- Fortsätt med andra oberoende verifierbara delar.
- Påstå inte att den blockerade delen är klar.

Om arbetet måste avslutas innan hela uppdraget är genomfört:

- Spara verifierat arbete.
- Lämna tydlig status för opushade eller pågående ändringar.
- Spara exakt nästa steg.
- Lämna inga otydliga halvfunktioner aktiva.
- Lova inte osynligt bakgrundsarbete.

────────────────────────────────────────
22. SLUTREDOVISNING
────────────────────────────────────────

Slutredovisningen ska innehålla:

- Arbetsgren.
- Draft-PR.
- Exakt remote head.
- Vilka paket som är verifierade.
- Vilka krav som återstår.
- Vilka UI-sidor som granskats och förbättrats.
- Vilka UI-dubletter som samordnats eller avvecklats.
- Antal verifierade UI-åtgärder av totalt inventerade.
- Vilka knappar eller flöden som fortfarande är blockerade.
- Testkommandon och resultat.
- Browserbevis och relevanta skärmbilder.
- Säkerhetsfynd och deras status.
- Migrations-, backfill- och rollbackunderlag.
- Externa miljöer eller konsumenter som inte kunde verifieras.
- Nästa konkreta handling.

Redovisa verifieringstäckning, inte påhittade procenttal för färdig kod eller säkerhet.

Inga öppna allvarliga säkerhetsfynd får döljas bakom formuleringen
”allt grönt”.

Påstå inte produktionsgodkännande utan faktisk verifiering och
separat införandebeslut.

Merga inte och aktivera inte produktion utan separat uttryckligt tillstånd.

Det slutliga målet är en enkel, konsekvent och verifierad arbetsyta där
tenantens kundservice fungerar genom webb, telefon, API och OPS,
där rätt uppgifter påverkar rätt delar av systemet, och där varje
synlig handling har en fungerande, säker och spårbar effekt.
