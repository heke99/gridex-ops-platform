# Fler API- och dokumentationsfynd i Gridex OPS

Fortsatt granskning den 7 oktober 2026 på samma revision som tidigare rapporter. Endast Gridex OPS; inga source-fixar eller produktionsändringar. Nya kravkedjor granskades för Partner-responskontrakt, anläggningsfakturor, kundportalens supporthistorik och återförsök samt Staff-svar och projektattestering. Tidigare F1–F5 räknas inte igen.

**Resultat:** fyra bekräftade P2-fynd, två mindre bekräftade dokumentations-/signalluckor samt ett verifierat beteende där kontraktet inte anger prioritet. Tjugo riktade testfall passerade under Node 22.23.3. Bekräftad betyder kod/kontrakt och lokalt beteendeprov; ingen av dessa affärsoperationer kördes mot produktionsdata.

## F6 – P2: Partner-kontraktet underkänner lyckade kund- och anläggningssvar

**Krav:** GET customer/site publicerar Customer/Site som svarsschema. **Status:** bekräftat motsägande schema.

`lib/partner-api/openApi.ts:306` och `:324` kombinerar respektive input-schema med EntityResponse genom `allOf`. Alla delobjekt är stängda med `additionalProperties: false`. Input-schemat saknar `entity_id`, medan EntityResponse på rad 282 bara tillåter och kräver det fältet. Ett svar med både referens och obligatoriska affärsfält kan därför aldrig uppfylla båda grenarna.

Verkliga DTO:er byggs i `lib/partner-api/simple.ts:476` och `:495`, används av GET-handlers vid 819/831 och innehåller båda fälttyperna. `businessOpenApi.ts:40` ärver dessa schema utan reparation och är det publikt serverade dokumentet. Det finns ingen serializer som gör ett giltigt alternativ på dessa vägar.

**Prov:** två verkliga handleranrop med fullständiga, icke-null syntetiska data ger 200. Ajv validerar de verkliga schema med refs ompekade till definitions och ger `additionalProperties` för `entity_id` respektive affärsfälten. Provet använder den gemensamma JSON Schema-semantiken för `allOf`/stängda objekt; det är inte ett komplett OpenAPI 3.1-valideringsverktyg.

**Effekt:** strikt validering av rätta svar misslyckas; klientgenerering kan ge oanvändbara modeller. Nulls i vissa verkliga DTO-fält är en ytterligare kontraktsfråga men behövs inte för att bevisa detta fynd.

**Åtgärd:** definiera explicita responsobjekt med referens och affärsfält samt korrekta null-typer. Om komposition behålls måste stängningen appliceras korrekt på det sammanfogade objektet. Validera verkliga Customer/Site-svar mot publicerat schema, inklusive företagskund och tomma valfria fält. Ändra inte immutabla tidigare releasebytes.

## F7 – P2: anläggningens faktura kan döljas av andra anläggningars fakturor

**Krav:** Partner GET `/customer/{customer_id}/site/{site_id}/invoice` listar fakturor för efterfrågad anläggning. **Status:** bekräftad ofullständig resursläsning.

`lib/partner-api/simple.ts:865` hämtar anläggningens kontrakts-id:n. Fakturaqueryn vid 883–891 filtrerar däremot bara company/customer, sorterar senaste först och tar högst 200. Först vid 895–899 filtreras dessa mot anläggningens kontrakt; därefter kapas svaret till 100. Varken queryn eller responsen erbjuder continuation/cursor.

**Prov:** samma syntetiska kund har 200 nyare fakturor för en annan anläggning och en äldre faktura för den efterfrågade. Den riktiga handlern returnerar `200 { invoices: [] }`. När de orelaterade raderna tas bort returneras den efterfrågade fakturan. Provets query-port begränsar enligt den faktiska `.limit(200)` och visar att endast company/customer-villkor skickas. Detta testar källans urval, inte verklig databaslast.

**Effekt:** integrationen kan felaktigt dra slutsatsen att anläggningen saknar fakturor. Bolags-/kundisoleringen är kvar; detta är inget cross-tenant-fynd. `from_date/to_date` kan ge en workaround när klienten redan känner till tidsfönstret, men är inte automatisk continuation.

**Åtgärd:** filtrera på anläggningens tillåtna kontrakt i databasen före begränsningen, med båda etablerade kontraktskolumnerna och tenantvillkor korrekt hanterade. Lägg deterministisk pagination och dokumentera den. Testa blandade anläggningar och båda kontraktskolumnerna.

## F8 – P2: kundens nya meddelanden försvinner efter 500 synliga meddelanden

**Krav:** ärendedetalj och messages-endpoint beskriver kundsynliga meddelanden. **Status:** bekräftad tyst kapning utan continuation; dokumentationen anger inte taket.

`lib/customer-service/supportConversation.ts:215` använder `listCustomerSupportMessages`, sorterar oldest-first och tar 500 på rad 222. Både detaljhandlern i `supportApiHandlers.ts:95` och list-handlern på rad 110 använder detta. De returnerar en array utan page/has_more och läser inte cursor/limit. Det finns ingen individuell kundmeddelanderoute som gör resten hämtbart på dessa vägar.

**Prov:** 501 syntetiska kundsynliga meddelanden, ett per dag i ett passerat tidsintervall. Monterad riktig GET messages-route returnerar de äldsta 500 och ingen continuation; sista meddelandet saknas även när cursor/limit skickas. Detaljvägens användning av samma helper verifierades i kod, inte i ett separat nytt detaljprov.

**Effekt:** senare kundmeddelanden och personalsvar kan vara skapade men inte visas i portalens läsningar. Kvoten 150 meddelanden/timme begränsar inte antal över ärendets livstid.

**Åtgärd:** tenant-/kund-/ärendebunden keyset-pagination med stabil sortering på tid och id. Visa senaste relevant konversation och gör historiken adresserbar; dokumentera detaljens eventuella preview. Behåll visibility-filtren och bounded queries.

## F9 – P2: bilagelistan döljer filer efter de äldsta 100

**Krav:** list-endpoint returnerar released, kundsynliga bilagor. **Status:** bekräftad tyst kapning utan continuation; inget dokumenterat livstidstak.

`lib/customer-service/supportAttachments.ts:167` filtrerar rätt bolag, kund, ärende, visibility och scan-status, men tar oldest-first 100 vid rad 172. Kundhandlern i `supportApiHandlers.ts:150` använder denna helper och returnerar bara arrayen. Den existerande Staff-pagineringshelpern på rad 178 används inte av kundvägen.

**Prov:** 101 syntetiska released-filer, ett per dag. Monterad GET attachments-route ger 100, saknar page och utelämnar sista referensen även med cursor/limit. Kvoten 20 filer/dygn motverkar inte ackumulation över tid.

**Effekt:** nya filer blir oupptäckbara genom listningen. En download med redan känd utelämnad referens kan fortfarande fungera; fyndet säger inte att filen är borttagen eller universellt oåtkomlig.

**Åtgärd:** paginera med tenant-/kund-/ärendebunden cursor och tydlig continuation. Behåll released-/visibility-/hashvillkor; ersätt inte taket med obegränsad query.

## F10 – P3: kontraktet anger inte prioritet mellan stängt ärende och replay

**Status:** beteendet är bekräftat; ett entydigt kontraktsbrott är inte fastställt.

`supportApiHandlers.ts:205` nekar en bilageuppladdning på stängt ärende före idempotensuppslagningen på rad 213. Prov: en lyckad 201-upload följs av ärendestängning och identiskt key/bytes; retry ger `409 support_case_closed` och skapar ingen extra fil.

`docs/openapi/customer-portal-v1.json:10556` säger både “Closed cases return 409” och “The same Idempotency-Key with the same bytes replays the result” utan att ange vilket som gäller vid ett redan slutfört anrop. Guiden anger också closed-case 409. Därför är detta en dokumenterad policyoklarhet och ett konkret återförsöksscenario, inte ett bevis för att specifikationen otvetydigt kräver 201. Meddelandeskrivningen använder däremot idempotens före den nya meddelandemutationens closed-case-kontroll.

**Effekt:** efter förlorat success-svar och senare stängning kan integratören inte tolka retry som dokumenterad replay. **Åtgärd:** bestäm och dokumentera företrädet. Om tidigare resultat ska replayas, behåll aktuell autentisering och ägarskapskontroll före cacheläsning men kontrollera closure inom callbacken som skapar en ny fil. Ingen cache ska kunna kringgå aktuella åtkomsträttigheter.

## F11 – P3: Staff-användarskrivningar tappar dokumenterad replay-signal

**Status:** bekräftad saknad signal, inte ett brott mot ett obligatoriskt response-schema.

Gemensam `write` i `lib/staff-api/userHandlers.ts:25` används för invite/change-role/disable/enable. Den släpper `result.replayed` och returnerar bara body/status vid rad 32. Staff OpenAPI beskriver `Idempotency-Replayed` med true/false för dessa svar, exempelvis `staff-v1.json:499`. Headern är inte markerad required, så detta är inte en bevisad mandatory-header-valideringsbugg.

**Prov:** riktig `postStaffUser` och riktig JSON-responsefunktion med syntetisk kontext/idempotensport. Både replayed=false och true ger 201 utan header; versionsheadern finns. Gemensamma helperns andra callers spårades i källan. Kund-/ärendeskrivningar har replay-signal, vilket gör Staff-familjen inkonsekvent.

**Åtgärd:** för vidare replay-flaggan till responseheadern eller beskriv uttryckligen att användarroutes saknar signalen. Testa alla fyra write-vägar. Detta påvisar inte att mutationer dubbleras.

## F12 – P3: Staff OpenAPI saknar projektprecondition och 412

**Status:** bekräftad lucka i maskinkontraktet. Förväntat skydd fungerar.

`lib/staff-api/storageTarget.ts:12` läser valfria `X-Gridex-Expected-Project-Ref` och ger `412 storage_project_mismatch` vid felaktigt värde/mål. `http.ts:63` kör kontrollen före auth, audit, rate-limit och handler; lyckade handlers får `X-Gridex-Project-Ref` vid rad 69. Fem befintliga beteendetester verifierar detta, inklusive GET/POST/PATCH före access och felaktig header.

Ingen av headernamnen, status 412 eller felkoden finns i `docs/openapi/staff-v1.json`; public guide/error-tabell beskriver dem inte heller. Onboardingtexten i `docs/staff-api/independent-onboarding.md:58` beskriver däremot projektattesteringen, så beteendet är inte helt odokumenterat. Det är en ytterligare maskinkontraktslucka, inte samma claim-exempel som tidigare F2.

**Effekt:** genererade klienter saknar stöd för ett befintligt säkerhetsprecondition och dess felutfall. **Åtgärd:** dokumentera valfri header, central service-project-semantik, responseattestering och 412 i en ny kontraktsrelease. Bevara de frysta tidigare dokumenten.

## Verifiering och motargument

Två befintliga oberoende granskare fortsatte under den tillämpade spec-to-code-skillens instruktion. Partner-schemat/fakturafiltret motprövades av portalgranskaren; portalens två listtak och replaytolkningen motprövades av den andra granskaren. Root läste även Staff-header-/precondition-kedjor och dokumentationskällor. Replay-kravet nedgraderades till policyoklarhet efter motprövningen.

**Slutlig körning:**

```text
/tmp/gridex-api-review-node22/node_modules/.bin/node node_modules/vitest/vitest.mjs run __tests__/ops-additional-api-review.test.ts __tests__/ops-portal-additional-review.test.ts __tests__/ops-staff-replay-additional-review.test.ts __tests__/staff-api-storage-target.test.ts
Test Files: 4 passed
Tests: 20 passed
```

De 20 omfattar 3 nya Partner-prov, 3 nya portalprov + 7 befintliga portalregressioner, 2 Staff-replayprov och 5 befintliga storage-prov. Detta är inte 20 separata nya defekter. Autentisering/DB/storage är syntetiska där provfilen anger det. Portalens pagination-port är mockad i befintlig fixture, men de berörda listvägarna anropar inte den; fysisk querylimit och responseavgränsning provas i riktiga helpers/handlers.

Exakta temporära provkällor är sparade i `evidence/additional-partner-contract.probe.ts`, `additional-portal-contract.probe.ts`, `additional-staff-replay.probe.ts`; resultat i `additional-api-docs-tests.log`. Temporära suite-filer togs bort först efter färdig körning. För återkörning lägg dem under `__tests__/` med de angivna namnen.

Ingen full ny applikationssvit, native PostgreSQL-replay, produktionstest eller livekontraktshämtning gjordes i denna komplettering. Befintlig Partner-surface-testfil kontrollerar framför allt strängar i källan; dess gröna resultat bevisar inte att verkliga DTO:er uppfyller schema. Lägg beteendebaserad responsvalidering där dagens kontroll annars missar F6.

## Små föreslagna PR:er

1. **Partner-responsschema:** F6, korrekta stängda responsobjekt och riktig schema-/handler-validering.
2. **Anläggningsfakturor:** F7, databasfilter före limit och dokumenterad pagination.
3. **Portalens supporthistorik:** F8/F9, adresserbara sidor och aktuella meddelanden/bilagor med bibehållen tenant/visibility-säkerhet.
4. **Idempotenskontrakt:** klargör F10, harmonisera återförsök efter closure och för vidare Staff-replayheader F11.
5. **Staff projektattestering:** F12, uppdaterat publicerat maskinkontrakt och konkret guideexempel, med skyddet oförändrat.

Alla fynd är öppna. Användaren bad om fortsatt granskning; inga produktionsfixar eller PR:er skapades.
