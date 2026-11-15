# Fortsatt gränssnittsgranskning — 2026-11-15

Ägarens fortsatta uppdrag hanteras på samma isolerade gren och PR #1051. Originalarbetsytan är fortsatt ren. Inga producent-, scenario-, demo-, databas- eller driftsättningsåtgärder utförs.

## Rättade fynd

- Leverantörsbytesdetaljen hade interna ärende-/kanal-/routekoder, rå teknisk tidslinje, direktverktyg för Ediel och statusknappar utan matchande synlig behörighet. Bolag får nu en separat serverrenderad affärsvy. Superadmins verktyg finns kvar. Affärsåtgärderna använder befintliga serveråtgärder, fältnamn och respektive behörigheter.
- Saknad anläggning/kontroll kunde presenteras som frånvaro av hinder. Uppgifterna visas nu som okontrollerade och köläggning/slutföring erbjuds inte utan kontroll. Regressionen misslyckas på den tidigare sidkoden och passerar med rättningen.
- Begärt och bekräftat startdatum behöver kunna jämföras. Båda datumen, nuvarande/ny leverantör, anläggning, nätägare och fullmaktsunderlag visas. Accepterade byten med saknad bekräftelse eller startdatum får rätt affärsförklaring från den befintliga aktiveringskontrollen. Accepterade byten får ingen omsändningsknapp; avbrutna och pausade byten visas därefter.
- Arbetskön länkade till förbjudna flikar och den äldre ogiltiga fliken supplier-switch. Länkvisningen använder nu kundkortets befintliga flikpolicy. Bolaget kommer till den tillgängliga översikten; tillåtna flikar och superadminlänkar bevaras. Hjälpfunktionen ligger utanför Next-sidmodulen.
- Uppgiftsbegäran använder kundnära språk och separerar enkel nästa-åtgärd från teknisk processbevisning. Manuell koppling av meddelande-ID är endast för plattformsadmin. Listor är kompakta, höjdbegränsade och tangentbordsåtkomliga med namngivna regioner och synlig fokusmarkering.
- Gemensamma statusetiketter översätter submitted/accepted och tekniska svarsväntelägen till svenska. Lagrade värden och statuslogik är oförändrade.
- PR:ns misslyckade verify-steg identifierades via GitHub som gridex:contract-channel-publication-regression. Lokalt reproducerades exakt en föråldrad knapptextassertion. Enbart texten uppdaterades; hela kontrollen av kanaler, canonical action/service och förbjuden API-publicering behålls. Regressionen passerar nu lokalt. Ingen blind CI-omkörning utfördes.

## Slutverifiering

- 19 riktade Vitest-filer: 164 tester godkända, inklusive första leveransens 107 tester.
- Appens och testernas typkontroller: godkända. Next typegen och separat TypeScript-kontroll av den genererade route-validatorn: godkända.
- Riktad ESLint för uppföljningens TS/TSX: 0 fel, 0 varningar.
- RBAC: 24 kontroller, 0 varningar. Contract channel publication-regression: godkänd.
- Browser: 15 fall, inklusive 390/1280 px, långa listor med 12 poster, tangentbordsskrollning och tidigare disclosures/avtalsgenväg. Ingen horisontell överströmning. Axe WCAG A/AA: 0 överträdelser i testade bolagsvyer.
- Två oberoende slutgranskare: alla fynd rättade, inga kvarvarande åtgärdskrävande fynd. Slutlig layout-/etikettdelta granskades separat.
- git diff --check: godkänd.

Browserproven använder verkliga sid-/komponentkällor med syntetiska mockade serverdata. Det är inte inloggad liveverifiering, riktiga utskick eller full produktionsbuild. CI för nästa publicerade PR-head återstår; ingen main-merge eller driftsättning ingår.
