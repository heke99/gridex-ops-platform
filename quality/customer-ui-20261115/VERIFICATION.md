# Kundnära gränssnitt — 2026-11-15

## Resultat och omfattning

Kundkortets väg till nytt avtal öppnar befintlig registrering/signering. Både contracts.read och contracts.write krävs för genvägen. Även upprepat klick med samma URL-fragment öppnar formuläret.

Ansökningssidan visar kundnummer, anläggningsuppgifter, avtalsnamn och nätägarnamn i stället för interna referenser. Kort har mindre mellanrum och listor är hopfällda med antal; råa payloads och workflowuppgifter finns i en separat hopfälld superadminpanel. Kundintagets förklaringsruta ”Intake-logik” har ersatts med en kort instruktion för vald flytt/leverantörsbyte.

Nätägarbegäran och stoppade utskick har egna serverrenderade bolagsvyer. Tekniska meddelanden, routningsverktyg och råa request/response följer inte med i deras HTML. Datum, status, kund-/ärendelänkar och dokumentåtkomst behålls. Nätägarbegärans anteckningar och felorsak visas även med läsbehörighet. Statusformuläret kräver samma skrivbehörigheter som befintlig serveråtgärd och skickar samtliga tidigare fält.

Språk har förenklats i navigation, kundkortets underflikar, avtal, fullmaktsdokument, fakturering, mätvärden, nätägare, support, uppgiftsbegäranden, kontrollvyer och utskick. Inga API-fältnamn, databasscheman, serveråtgärder eller affärsvärden har bytt namn.

## Sidinventering

Statisk genomgång omfattar 218 TSX-filer i app/admin och 108 i components/admin. `page-inventory.json` listar 176 sid-/delsidfiler. `copy-inventory.json` är den ursprungliga kandidatlistan för tekniska begrepp, inklusive kodvärden och superadminverktyg som inte ska tolkas som bevis för kundsynlig exponering. Gemensam navigation och kundkortets tillåtna flikar kontrolleras också i tester.

Detta är ingen attest att alla 176 sidor körts med inloggning. Autentiserade liveflöden, produktion, riktiga avtal/utskick och full produktionsbuild har inte körts. Superadmins tekniska facktermer finns kvar där de behövs. Inga scenario-/demoproducenter eller delade tjänster har använts.

## Verifiering

- 12 Vitest-filer, 107 tester: godkända. Omfattar bolag/superadmin, direktlänk till främmande bolag, endast läsbehörighet, navigation, avtals-/signeringsförutsättningar och registreringsåterhämtning.
- Regression för payload-exponering: bevisat misslyckande på oförändrad basversion, därefter godkänd med rättningen.
- Appens och testernas typkontroller: godkända. Testtypkontrollens första försök överskred Nodes standardheap; samma kontroll gick igenom med projektets vanliga 6144 MB heap.
- Riktad ESLint: 0 fel, 12 befintliga varningar. Ingen ny varning i kundintagets ändrade tillståndshantering.
- RBAC: 24 kontroller godkända, 0 varningar.
- Customer application continuation-regression: godkänd.
- Chromium: 9 tillstånd/scenarier godkända. Fyra faktiska serverrenderade sidoroller vid 390/1280 px; extra åtgärder, teknisk disclosure och upprepad öppning av verklig React-komponent för nytt avtal. Ingen horisontell sidöverströmning. WCAG A/AA via axe: 0 överträdelser i de fyra testade bolagsvyerna/tillstånden.
- Två oberoende skrivskyddade slutgranskningar: tidigare fynd rättade; inga kvarvarande åtgärdskrävande fynd i slutgranskad kod.
- git diff --check: godkänd.

Browserunderlaget använder verkliga komponenter och syntetiska, mockade serverdata. Det är ingen verifiering av autentisering, riktiga utskick eller verkliga integrationer. Node i miljön är 24.19.0; projektets deklarerade version är Node 22.

## Reproducera browserprov

Kör från reporoten:

```sh
node quality/customer-ui-20261115/prepare-browser.mjs
GRIDEX_UI_FIXTURE_DIR=/tmp/gridex-ui-browser-20261115 npx vitest run __tests__/admin-website-application-copy.test.ts __tests__/grid-owner-request-business-visibility.test.ts
node quality/customer-ui-20261115/browser-server.mjs
```

I en separat terminal, med fixture-servern på dess eget port 4187:

```sh
node quality/customer-ui-20261115/browser-check.mjs
```

## Isolering och leverans

Egen gren codex/customer-ui-20261115 i /workspace/gridex-customer-ui-20261115. Originalarbetsytan är orörd. Ursprunglig bas f23c1dc0c; aktuell main ce8045558 har 44 ändrade sökvägar utan överlapp med denna ändring. Ingen main-merge eller driftsättning har utförts.

Komposition med main ce8045558: alla 67 egna filer var byteidentiska efter rebase. Därefter kördes 107 tester och appens typkontroll på nytt och godkändes. Browser- och granskningsunderlaget återanvänds för samma oförändrade UI-källor. Separat draft-PR: https://github.com/heke99/gridex-ops-platform/pull/1051. CI och seriell leverans återstår; ingen main-merge eller driftsättning utförd.
