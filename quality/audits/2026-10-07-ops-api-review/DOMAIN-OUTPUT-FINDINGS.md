# Fullmakt, priser, lokalisering och avtalsbekräftelse

2026-10-07. Gridex OPS endast. Lokal revision `1aef94be4758260e134bdc195a69312901bf8cb2`. Läsgranskning; inga ändringar av produktionskod, kunddata, databas eller mejlutskick. Detta kompletterar F1–F22 och är ingen fullständig friskförklaring av systemet. Driftsatt revision kan skilja från lokal kod.

## Nya bekräftade fynd

| ID | Prioritet | Trigger och faktisk konsekvens | Rotorsak och riktad åtgärd |
|---|---|---|---|
| F23 | P2 | Partner `POST /price` väljer ett giltigt API-only default-erbjudande men svarar sedan 404 `offer_not_found`. | `business.ts:270` väljer kanal `api`; `offerQuote.ts:351` använder `publicContractResolver.ts:97` med kanal `website`. Den kanoniska synlighetsvyn kräver också website-publicering. För kanal genom beräkning/resolver och välj motsvarande publiceringsvyer; behåll samma tenant-, juridik- och prisberedskapskontroller. |
| F24 | P2 | Komplett adress/polygonträff med för gammal SVK-geodata ger `/location` 200 `status: resolved`, `grid_area.verified: true` trots att resolvern lagrar elområdesassurance `unresolved` och stänger automation. | `resolver.ts:710` nedgraderar assurance men behåller identifierare; `business.ts:175` härleder resolved/verified från identifierarnas närvaro. Visa assurance/färskhet och klassificera äldre identifierare som preliminära. Varningen finns i svaret och `/price/current` stoppar samma underlag med 422. Ingen pris- eller Ediel-spärr kringgås. |
| F25 | P2 | Normala framgångsrika lokaliseringar med `city: null` eller `grid_area.name: null` bryter det publicerade svarsschemat. | `businessOpenApi.ts:36` och :126 använder `nullable: true` tillsammans med typ string/object medan `openApi.ts:25` anger OpenAPI 3.1. Null behöver typunion/anyOf och tillåtelse i eventuellt enum. Standardsbaserade klienter/validatorer kan avvisa normala 200-svar. |
| F26 | P2 | Partner-fullmakten accepterar exakt fem byte `%PDF-`, laddar upp dem som PDF och svarar 201 med lagrad status `signed`. Filen saknar PDF-objekt/sidor och går inte att använda som fullmaktsdokument. | `simple.ts:382` kontrollerar endast magiskt prefix; :642 lagrar signed. `openApi.ts:337` beskriver en signerad PDF. Verifiera strukturell PDF-läsbarhet före lagring och framgångssvar. Detta bevisar inte brist i verifiering av signaturens juridiska äkthet. |
| F27 | P2 | Signering via OPS säker länk lyckas, men ett tillfälligt arkiveringsfel före mejlkön lämnar avtalsbekräftelsen oköad; kunden får ändå besked att den skickas. | `onlineSigning.ts:663` slutför signering före leverans; :541 arkiverar före :603 mejlkö. Catch :678 loggar och returnerar fel; `app/sign/contract/[token]/actions.ts:22` ignorerar det och sidan :164 lovar mejl. Skapa en beständig, tenantbunden leveransfortsättning vid signering och visa faktisk mejlstatus. Behåll signeringen lyckad även om mejl väntar. |

F23–F26 har motgranskats av huvudagenten genom hela relevanta anropskedjan/schema och positiva spärrkontroller. F27 har också motgranskats oberoende av fullmaktsgranskaren: generiskt signed-jobb startar leverantörsbyte, och avtalshändelsen går till webhook; de ersätter inte saknad mejlkö. Verkliga handlers/helpers kördes mot syntetiska DB/auth/Storage-portar. Detta bevisar kodbeteende, inte produktionsförekomst eller verklig leverans.

## Prisunderlag som verifierats live

Läsning av delade marknadsprisrader i OPS projekt `piidsfebjqjmnepdpnas`, inga kundrader. Vid **2026-10-07 10:44:21 UTC / 12:44:21 svensk tid** fanns följande aktuella intervall 12:30–12:45 svensk tid från `elprisetjustnu`, resolution `quarter_hour`, dygnsevidens `verified`, hämtad omkring 12:15:32–34:

| Elområde | SEK/kWh exklusive moms/avgifter | Öre/kWh exklusive moms/avgifter |
|---|---:|---:|
| SE1 | 0,09113 | 9,113 |
| SE2 | 0,11712 | 11,712 |
| SE3 | 0,87509 | 87,509 |
| SE4 | 1,67401 | 167,401 |

Detta är en tidsstämplad databasobservation, inte ett fortlöpande nupris eller bevis att varje tenants autentiserade API väljer dessa rader. Direkt läsning av leverantörens publika dygns-API svarade HTTP 403 i granskningsmiljön; ingen byte-för-byte jämförelse kunde göras. Inget importjobb startades. Bevis: `evidence/current-market-price-live.json`.

## Positiva kontroller

- Provider-normalisering bevarar SEK/kWh och negativa priser. DST-dygnets två lokala 02:00 med olika offset blir olika UTC-intervall.
- Exakt kvartgräns väljer nästa intervall; dygnsevidens hämtas för Stockholmsdatum. Website- och Partner-current-handler ger samma 0,50 SEK/kWh = 50 öre/kWh med uttryckliga false-flaggor för moms, leverantörs- och nätavgifter. Detta är marknadspris; total kundoffert är separat.
- Felaktigt påstått elområde stoppas med 409, för gammal providerevidens med 409 och saknad verifierad dygnsevidens med 503.
- Färsk komplett adress fungerar. Postal-only nätägare/nätområde markeras preliminära. Motstridiga postnummer-elområden ger 409 i stället för gissning. Geografisk nätägaridentitet är separat från operativ Ediel-behörighet.
- Website-API:ets checkout-resultat skiljer signerat avtal/thank-you-ready från confirmation pending/queued/sent/delivered/failed. Dess leveranskedja kräver bunden arkiverad PDF och persistenta juridiska acceptanser; F27 gäller en separat säker-länk-väg.

## Kvarvarande kandidat och avfärdat spår

**U23 – exakt fullmaktsversion:** normal Website-onboarding för vidare caller `textVersionId` som skiljer från det accepterade erbjudandets dokument, medan acceptance-snapshot innehåller erbjudandets version. OpenAPI :11942 kräver exakt accepterat bundles `primary_document_id`. Helperns jämförelse i `customerApplicationLegal.ts:870` används av reparationsvägen, inte normal onboarding. Tre beteendeprov visar avvikelsen fram till verklig native-RPC-wrapper; ingen riktig SQL-transaktion kördes. Behöver native verifiering av ett annat giltigt, publicerat, låst POA-dokument inom samma tenant innan komplett end-to-end-fynd kan bekräftas.

Live kataloggranskning avfärdar den separata hypotesen att normal canonical-ID alltid bryter legacy-FK: en driftsatt normalization-trigger flyttar ID till rätt canonical-kolumn och kontrollerar tenant, dokumenttyp och låsning. Denna funktion hittades inte i lokalt supabase-träd. Materialisering kräver publicerat dokument med fullständigt innehåll. Dessa lästa funktioner kontrollerar inte uttryckligen samma erbjudandebundle; andra native-gränser är ännu inte beteendeprovade. Bevis: `evidence/poa-live-normalization-catalog.json`. Okända/feltenant/feltyp/olåsta dokument är alltså inte ett bekräftat framgångsfall.

## Verifiering och begränsningar

Node 22.23.3/Vitest. Riktad befintlig verifiering: **108 tester / 14 filer PASS**, `evidence/domain-existing-tests.log`. Huvudagentens oberoende omkörning av de fem arkiverade beteendeproverna: **24 tester / 5 filer PASS**, `evidence/domain-directed-tests.log`. Därtill bekräftelsegranskarens tre befintliga public-checkout-tester PASS; dessa ingick inte i huvudagentens 108. Tillfälliga körbara audit-testfiler tas bort först efter avslutad grön körning; exakta källor finns i evidence.

Riktade prover: `current-pricing.probe.ts` (8), `location-output.probe.ts` (6), `partner-poa-pdf-format.probe.ts` (4), `website-poa-legal-binding.probe.ts` (3), `confirmation-signature.probe.ts` (3). PDF-provet innehåller tre ärvda kontroller av F18 plus den nya formatkontrollen; äldre fynd räknas inte som nya. Null-proven testar gemensam JSON Schema-typsemantik med Ajv6, ingen fullständig OpenAPI3.1/2020-12-validering påstås.

Inte verifierat: autentiserade produktionsanrop för avtal/pris/fullmakt, verklig mejlleverans och kundens mottagning, hela geografiska datatäckningen, native POA-mismatchtransaktion, alla tenants prispolicyer, hela app/build/scanners eller driftens framtida tillgänglighet. Befintliga F18/F19 kan fortfarande påverka fullmaktsfiler/retry vid fel; godkända normalfall betyder inte att dessa är åtgärdade.

Föreslagen ordning för separata små ändringar: befintlig F18/F19 först, sedan F27 beständig bekräftelse, F26 PDF-validering, F23 kanalkorrekt offert och F24/F25 lokaliseringens kontrakt. Ingen remediation genomförd eller deployad.
