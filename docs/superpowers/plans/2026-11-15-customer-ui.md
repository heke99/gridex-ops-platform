# Förenklat elbolagsgränssnitt

**Goal:** Kundnära språk, kompakta kort och färre synliga åtgärder genom bolagsgränssnittet. Tekniska uppgifter förbehålls superadmin.
**Architecture:** Befintliga serverbehörigheter och affärsåtgärder behålls. Tekniska JSX-paneler spärras på servern; extra information använder inbyggda details/summary.
**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind.

## Avgränsning och filägande

Egen worktree `/workspace/gridex-customer-ui-20261115`, gren `codex/customer-ui-20261115`, bas f23c1dc0c. Ingen delad backend, databas, producent, simulering, systemdemo eller gemensamt agentminne ändras. Andra chattars status lästes; deras arbete avser demo/finansiella scenarier och native körningar. Ingen driftsättning eller main-merge ingår.

## Arbete

- [x] Inventera alla adminsidors och komponenters synliga strängar. Spara sökträffar som granskningskandidater; en kodträff bevisar inte att innehållet visas för bolagsanvändare.
- [x] Komprimera ansökningskort, samla extra åtgärder och teknisk information. Visa affärsuppgifter i stället för interna UUID.
- [x] Begränsa råa request/response och Edielverktyg på nätägarbegäran till superadmin.
- [x] Förenkla kundintag, navigation och kundkort; tydlig väg till befintlig avtalsregistrering och signering.
- [x] Granska övriga sidor/flikar och rätta kundsynliga tekniska begrepp, utan ändrade API-fält eller datavärden.
- [x] Verifiera serverrendering för bolagsanvändare/superadmin, tenantgränser, navigation och typkontroll. Kör riktad lint och två oberoende slutgranskningar.

## Skill routing

using-superpowers: arbetsrouting; using-git-worktrees: isolering; writing-plans/executing-plans: genomförande; web-design-guidelines: tillgängliga disclosures och kompakta kort; browser-e2e: vid tillgänglig browser; requesting-code-review: två oberoende slutgranskare; verification-before-completion: färska resultat. React-checklistan tillämpas efter TSX-ändringarna. Ingen databas/schema/prestanda/AI-funktion byggs; motsvarande skillkampanjer behövs inte.

## Fortsatt granskning efter ägarens begäran

- [x] Rätta arbetsköns länkar till data-requests som är spärrad för bolagsanvändare; behåll superadminlänkar och använd översiktens befintliga nästa steg för bolag.
- [x] Förenkla leverantörsbytesdetaljen på servern. Behåll status/datum/nätägare/åtgärder men visa endast verkligt tillåtna affärsåtgärder. Saknad kontroll får inte visas som godkänd.
- [x] Förenkla uppgiftsbegärans rubriker/status och begränsa tekniska process-/meddelandeverktyg till plattformsadmin; bevara serverfält och behörigheter.
- [x] Granska motsvarande layout och länk-/rollbeteenden med riktade tester, browser och två oberoende slutgranskare. Följ upp faktiskt CI-fel utan blind omkörning.

Filcustody: samma isolerade gren. Nya huvudfiler operations/switches/[id]/page.tsx, customer-info-requests/page.tsx, work-queue/page.tsx och nya presentations-/testfiler. Inga delade producenter, databasscheman, API- eller Ediel-runtimefiler ändras.

## Fortsatt sökning: inloggning, fakturainställningar och mätvärden

- [x] Separera kundinloggningens affärsstatus från teknisk leverantörs-/nyckelkonfiguration på servern. Läsfel får inte visas som avstängd funktion.
- [x] Ge fakturainställningar en kompakt bolagsvy med befintliga, behörighetsmatchade leverantörsval/utskicksinställningar. Miljövariabler, tekniska testdetaljer och systemhändelser endast superadmin. Visa okänd status vid läsfel.
- [x] Ge mätvärden en bolagsvy med kundnamn, period, energi, rättelser och ärendelänkar; tekniska ID:n och manuella integrationsverktyg endast superadmin.
- [x] Verifiera roller, läsfel, formulärfält och mobil-/tangentbordslayout. Två oberoende slutgranskningar och uppdatering av samma PR; inga verkliga konfigurationsändringar eller utskick.

Filcustody: tre ovanstående sidfiler, nya serverkomponenter/tester och eget quality/checkpoint-underlag. Serveråtgärder och databasstruktur behålls. Avgränsad felhantering uppdateras vid verifierad tyst fallback; mätvärdesvyn kompletteras med bolagsfiltrerade etikettläsningar för kund, anläggning och mätpunkt.

## Fortsatt granskning 4: meddelanden och händelser

Verifierade fynd: meddelandedetaljen visar protokoll-ID/referenser för bolag och lovar att kvittens innebär färdigt ärende; händelselänken heter kundkort men kan gå till tekniska sidor. Mobilradens fasta etikettbredd granskas samtidigt. Filcustody i egen worktree: app/admin/messages/[id]/page.tsx, app/admin/messages/page.tsx, app/admin/events/page.tsx samt eget test-/qualityunderlag. Inga protokollregler, serveråtgärder eller producentresurser ändras. Befintliga färdigheter för plan, UI, Supabase, React och verifiering fortsätter gälla. Två oberoende slutgranskningar före leverans.

Resultat: 46 tester/4 filer, 8 syntetiska browserlägen utan overflow/axe-fel, app-/test-/route-typer, lint0/0, RBAC24 och ratchet godkända. Två oberoende granskare godkänner. Se quality/customer-ui-20261115/PASS4.md. Leverans i samma draft-PR; ingen main-merge/driftsättning.

## Fortsatt granskning 5: support och fakturasammanfattning

Verifierade fynd: supportlistan visar interna kanalnamn och en sammanhängande lista upp till 200 rader. Kundnamnsreserv gör separat ofiltrerat uppslag trots befintlig bolagsägd join. Detaljhistorik växer utan avgränsning och bilageläsfel beskrivs som oaktiverad funktion. Fakturasammanfattningen är onödigt en klientgräns för råa arrays. Filcustody: app/admin/customer-cases/page.tsx, app/admin/customer-cases/[caseId]/page.tsx, components/admin/customers/CustomerBillingMeteringCard.tsx samt egna tester/quality/checkpoint. Serveråtgärder, kundcase-/faktura-runtime, skrivbehörigheter och producentresurser ändras inte. Fortsatt samma färdigheter för UI, React/servergränser, plan/verifiering; ingen databasändring. Två oberoende slutgranskningar krävs.

Resultat: 45 tester/5 filer, 12 syntetiska browserlägen utan overflow/axe-fel, app-/test-/route-typer, lint0/0, RBAC24 och ratchet godkända. Två oberoende granskare godkänner. Se quality/customer-ui-20261115/PASS5.md. Leverans i samma draft-PR utan main-merge/driftsättning.

## Fortsatt granskning 6: fullmakt och kommunikation

Verifierade fynd: legal-readiness länkar till ogiltiga documents och bolagsdold data-requests; interna acceptans-/dokument-/eventkoder visas som reservtext. Kommunikation visar mallnycklar, okända statuskoder och rå leverantörsfeltext samt 25 rader utan tydlig historikavgränsning. Filcustody: components/admin/customers/CustomerLegalReadinessCard.tsx, app/admin/customers/[id]/page.part-3.tsx och page.part-4.tsx samt eget test-/quality-/checkpointunderlag. Behörigheter hämtas från serverkontext och matchas mot befintlig resend-actions krav utan ändring av serveråtgärden. Fullmaktsbedömningens actor/site/company-scope och juridiska spärrar bevaras. Ingen backendregel, databas, utskick eller scenario-/demoproducent ändras. Befintliga UI-/React-/verifieringsfärdigheter fortsätter; två oberoende slutgranskningar före leverans.

Resultat: 77 tester/4 filer, 12 syntetiska browserlägen utan overflow/axe-fel, app-/test-/route-typer, RBAC24 och ratchet godkända. Lint0 fel och 10 oförändrade parentfilvarningar verifierade mot baseline. Två oberoende granskare godkänner. Se quality/customer-ui-20261115/PASS6.md. Samma draft-PR utan main-merge/driftsättning.

## Fortsatt granskning 7: anläggningar och dubbletter

Verifierat: bolagets anläggningsflik visar bara primär anläggning/mätpunkt; övriga anläggningar och flyttdatum ligger i plattformens redigeringsvy och blir osynliga för bolaget. Dubblettregistret visar Merge-arbetsyta och ett stort sammanslagningsformulär även för läsare trots serverns customers.write-krav. Filcustody: ny serverkomponent för kundens anläggningslista, app/admin/customers/[id]/page.part-4.tsx, app/admin/customers/duplicates/page.tsx samt egna tester/quality/checkpoint. Befintliga loaders, tenant-/kundrelationer, serveråtgärder och skrivkrav behålls. Alla inlästa egna anläggningar/mätpunkter visas med affärsnamn, flyttdatum och avgränsad layout; ingen runtime-/producentändring. Två oberoende slutgranskningar före leverans.

Resultat: 86 tester/6 filer, 10 syntetiska browserlägen utan overflow/axe-fel, app-/test-/route-typer, RBAC24 och ratchet godkända. Lint0 fel och 10 bevisat oförändrade parentfilvarningar. Två oberoende granskare godkänner. Se quality/customer-ui-20261115/PASS7.md. Samma draft-PR utan main-merge/driftsättning.

## Fortsatt granskning 8: kundprofil, kontakter och adresser

Verifierat: profil-/kontakt-/adressformulär visas utan motsvarande masterdata.write-kontroll i presentationen trots oförändrade actionguards. Kontakt-/adressroller och selectetiketter visas på engelska, långa listor är oavgränsade och anläggningsadressens text innehåller Z01. Filcustody: ny serversammanfattning/projektion av kundprofil, CustomerContactsAddressesCard.tsx (endast presentationsdelen), CustomerProfileCard.tsx (endast hjälpspråk/mobilklasser), customer page.part-4.tsx och egna tester/quality/checkpoint. Inbäddade kontakt-/adressactions och profilactions hålls oförändrade. Serverförmedlad skrivflagga matchar masterdata.write eller plattformsundantaget. Klientens profilprops väljs uttryckligen; läsare får servervy. Kontakt-/adress-/anläggningsrader kontrolleras mot aktuell kund/bolag och listorna begränsas visuellt utan att poster kastas bort. Två oberoende slutgranskningar före leverans.

Verifierat granskningsfynd: customerTabHref innehåller redan hash; redigeringslänken får en separat testad URL-helper och en liten klientlänk som återöppnar panelen även när Next behåller samma profil monterad. Läslänken behåller vanlig profillänk. Utökad filcustody: CustomerProfileEditLink.tsx och lib/admin/customerProfileLinks.ts samt egen browserfixture. Övriga AdminDisclosurePanel-användare och dess implementation ändras inte.

Resultat: 38 tester/4 filer, 13 syntetiska browserkontroller (tolv nya lägen utan overflow/axe-fel plus befintligt avtalsflöde), app-/test-/route-typer, RBAC24 och ratchet godkända. Actions byteidentiska. Lint0 fel, 10 bevisat oförändrade parentfilvarningar. Två oberoende granskare godkänner. Se quality/customer-ui-20261115/PASS8.md. Samma draft-PR utan main-merge/driftsättning.

## Fortsatt granskning 9: importhistorik

Filcustody: imports/page.tsx och eget minne/plan. Normaliserad payload och parsersiffra serverbegränsas till plattformsadmin. Osäker tolkning ersätter tekniskt parser-confidence-språk. Scope/actions behålls. App-typer, lint och 64 befintliga scope-tester godkända; två oberoende granskare godkänner. Ingen ny browser/livekontroll. Antecknings-/livscykelflikens kvarvarande kandidater dokumenterade i eget minne.

## Fortsatt granskning 10: anteckningar och livscykelformulär

Filcustody: customer page.part-2/4, befintligt source-test och eget minne/plan. Skrivformulär matchas mot masterdata.write/plattform; interna användar-ID endast platform details. Avgränsad anteckningslista med tangentbordsfokus. Actions/datumvärden orörda. 69 tester/3 filer, app-typer och lint utan fel; tio äldre parentvarningar kvar. Två oberoende granskare godkänner. Ingen browser/liveverifiering eller driftsättning.
