# Gridex OPS API Remediation and Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Kontrollera aktuell kod och ägarskap före varje paket; planen ger inte bevis för att en ändring redan är genomförd.

**Goal:** Åtgärda verifierade OPS-fel, kvalificera övriga fynd, uppdatera API-dokumentationen tillsammans med implementationen och låta stödda tenantintegrationer fungera utan exakt matchning mot senaste dokumentationsrevision.

**Architecture:** Behåll stabila V1-kontrakt och tenantbundna säkerhetsgränser. Separera dokumentationsrelease från klientens stödda kontraktsprofil; använd kompatibilitetsregler och vid behov serverstyrd äldre responsprojektion. Rätta fullmakt, idempotens, leverans, mätdata och pris i små självständigt verifierbara paket med forward-migrationer.

**Tech Stack:** Befintlig Next.js/TypeScript, Supabase/PostgreSQL, Vitest, native SQL-regressioner och versionsstyrd OpenAPI.

## Global Constraints

- Omfattning: Gridex OPS, OPS-hostade Website-/Customer-/Staff-/Partner-API:er och OPS inbyggda portal. Gridex Web ingår inte i detta implementationstillstånd.
- Plan skapad **9 oktober 2026, Europe/Stockholm**. Fyndens liveobservationer är från **7 oktober** och måste återkontrolleras före deploy. Lokal granskad HEAD: `1aef94be4758260e134bdc195a69312901bf8cb2`.
- Kanoniskt underlag: [ALL-FINDINGS.md](../../../quality/audits/2026-10-07-ops-api-review/ALL-FINDINGS.md), F1–F45. Kandidater/advisors behandlas genom kvalificering och får inte automatiskt implementeras som konstaterade buggar.
- Nuvarande dokumentationsrevision i källan: `2026-10-04.1`. Befintlig minimum-markör: `2026-10-02.3`. Detta är baslinje för kvalificering, inte bevis för att alla historiska klienter redan fungerar.
- Ingen exakt match mot senaste dokumentationsnummer som villkor för normal API-åtkomst inom stödd kontraktsfamilj.
- Bevara auth, scopes, tenant/customer/actor-ägarskap, revokering, RLS, filhashar, signerade snapshots och bindning till exakt accepterad juridik/prissättning. API-bakåtkompatibilitet får inte försvaga dessa kontroller.
- Ändra inte redan publicerade migrationsfiler eller frysta OpenAPI-releaser. Skapa forward-migrationer genom befintlig CLI; uppdatera canonical schema/generated types efter riktig replay.
- Ingen produktionskund, produktionsfullmakt eller produktionsanvändare används för destruktiva regressioner. Full native/gateway/mailprov görs i disponibel eller isolerad testmiljö.
- Varje paket: röd reproduktion → minsta riktade fix → gröna negativa/positiva kontroller → API/docs i samma PR → oberoende review → leveransbevis och fyndstatus.
- Bevara delade Ediel-checkpoints och främmande ändringar. Använd denna gransknings egen checkpoint för planen. Ingen Ediel-regel/coverage får ändras utan separat korrekt ägarskap.
- För implementation av Next.js-kod läses installerad versionsdokumentation i `node_modules/next/dist/docs/` först.

## Vad tenants ska kunna lita på

Den avsedda policyn är:

> Du integrerar mot en stödd API-kontraktsfamilj, exempelvis V1. Du behöver inte uppdatera din integration för att matcha varje ny revision av API-dokumentationen. Bakåtkompatibla uppdateringar ska fortsätta fungera. Nya funktioner kan kräva nya capabilities eller scopes. Brytande ändringar får en separat kontraktsversion och en dokumenterad migreringsperiod.

| Begrepp | Regel |
|---|---|
| API-kontraktsfamilj | Stabil beteende-/formatgräns, exempelvis Website V1 respektive Partner V1. De olika API-familjerna har egen supportmatris. |
| Dokumentationsrevision | Datum/releasenummer för spårbarhet och exakt publicerad spec. Ingen allmän körningsspärr vid olika datum. |
| Stödd klientprofil | Kvalificerat tidigare V1-format som OPS kan läsa och vid behov returnera. En tenant kan behålla sin profil vid dokumentationsuppdatering. |
| Capabilities/scopes | Ny funktion används först när klienten stöder den och credentialen har rätt scope. Att sakna ny funktion ska inte stoppa äldre fungerande flöden. |
| Juridik-/prisversion | Exakt kundaccepterat dokument, hash, produkt/option/quote. Dessa måste fortfarande stämma; de är inte dokumentationsrevisioner. |
| Intern DB-/apprelease | Deployment måste kvalificera beroenden och migrationer. Tenantens klientprofil behöver inte följa interna DB-releaser. |

### Kompatibilitetsregler att införa

1. Inom V1: behåll gamla endpoints, obligatoriska requestfält, fälttyper, enheter, idempotens- och affärssemantik för stödda profiler. Nya obligatoriska fält, borttagna fält och nya enumvärden som bryter gamla klienter kräver opt-in/profil eller ny major.
2. Nya responsefält är endast kompatibla om äldre klienter faktiskt tolererar dem. Klienter med `additionalProperties:false` ska få serverprojektion till kvalificerad profil; ingen generell claim att alla tillägg alltid är kompatibla.
3. Nya requestfält behöver klientopt-in; servern ska fortsatt neka okända/otillåtna säkerhetsfält. Lossa inte requestvalidering generellt.
4. API-nyckel och V1-endpoint räcker för standardflödet. Inget obligatoriskt nytt versionsheaderkrav. För legacyklient med hård versionskontroll kan OPS binda profil en gång per credential/API-familj efter kvalificering.
5. Befintliga `contract_schema_version`-/versionsheaders bevaras. För låst legacyprofil ska värdet motsvara den representation som faktiskt returneras. Aktuell dokumentationsrevision visas separat i release-manifest eller en ny frivillig header, inte genom oförankrade extra bodyfält i gamla slutna scheman.
6. Om klient väljer frivillig explicit profil accepteras endast stödda profiler i rätt major. Profilval får aldrig påverka company/customer/actor eller privilegier. Operatörsbunden profil är serverägd metadata, inte användarredigerbar JWT-metadata.
7. Deklarera supportmatris och capabilities separat för Website, Customer, Staff, Staff onboarding och Partner. Ett Staff-tillägg får inte göra en fungerande Website-integration inkompatibel.
8. Håll nuvarande minimum-markör som befintlig baslinje tills verkliga klientprov visar stödomfattningen; jämför inte datum lexikografiskt som ensam kompatibilitetskontroll. En docs-only release får inte automatiskt höja minimum.
9. Äldre klientprofiler återtestas vid varje release. Nya tillägg får inte ge falsk `schema_mismatch`, `412` eller tomt flöde för en stödd klient.
10. Brytande produktförändring introduceras parallellt i ny major. Föreslagen supportpolicy: minst **180 dagars annonserat migreringsfönster** före avveckling, med tenantinventering och migreringsguide. Detta är en planerad ny policy, inte redan införd garanti. Akuta säkerhetsfixar kan kräva omedelbar begränsning med tydlig kommunikation.
11. Befintliga sunsetdatum i frysta releaser ändras inte retroaktivt. Inventera särskilt alias med sunset `2026-10-31`; ta inte bort dem automatiskt utan kvalificerad support-/migreringsplan. Publicera ett nytt beslut/manifest om stödet förlängs.
12. Tenantfel, fel dokumenthash, återkallad behörighet och verkligt saknade nödvändiga fält ska fortsatt nekas. Ingen "accept all versions"-genväg.

### Föreslagna nya gränssnitt

Skapa `lib/integrations/apiContractCompatibility.ts` med följande ansvar: avgör supportprofil/capabilities utan att autentisera eller ersätta riktig payloadvalidering.

```ts
export type ApiSurface = 'website' | 'customer' | 'staff' | 'staff_onboarding' | 'partner'
export type ApiContractProfile = {
  surface: ApiSurface
  major: 'v1'
  revision: string
  status: 'supported' | 'deprecated'
  capabilities: readonly string[]
}
export type CompatibilityResult =
  | { ok: true; profile: ApiContractProfile }
  | { ok: false; code: 'unsupported_contract_profile' | 'required_capability_missing' }
export function assessApiContractCompatibility(input: {
  surface: ApiSurface
  major: string
  clientProfile: string | null
  requiredCapabilities: readonly string[]
  registry: readonly ApiContractProfile[]
}): CompatibilityResult
```

`registry` är versionsstyrd och kvalificerad. `clientProfile:null` väljer API-familjens stödda standardprofil, inte ett nytt hårt senaste-datumkrav. Payload måste därefter valideras mot profilens affärsschema. Historisk releaseklassificering eller datum ensamt räcker inte för att lägga en profil i registry.

Skapa `lib/integrations/apiContractProjection.ts`: explicit allowlist per stödd profil, inte generell rekursiv borttagning av `_id` eller säkerhetsfält. Projection sker efter canonical affärs-/tenantvalidering. Svaret märks med faktisk vald profil; ETag och `Vary`/cacheidentitet skiljer profiler åt. Server får inte ge samma representation-ETag för olika profiler.

## Filkarta och dokumentationsleverans

| Ansvar | Befintliga filer / planerade nya filer |
|---|---|
| Kompatibilitetsbeslut | `lib/integrations/websiteIntegrationContract.ts`, `openApiReleaseManifest.ts`, `websiteApiContract.ts`; nya `apiContractCompatibility.ts`, `apiContractProjection.ts` |
| Feed/snapshot/cache | `lib/integrations/publicContractFeedSnapshot.ts`, `lib/website/publicContractApi.ts`, `app/api/v1/website/public-contracts/route.ts` |
| Fullmakt/affärscommit | `lib/partner-api/simple.ts`, `core.ts`, `lib/api/strictRequest.ts`, `lib/website/customerApplicationOnboarding.ts`, `customerApplicationLegal.ts`, `lib/customers/canonicalOnboarding.ts`; relevanta native RPC:er |
| Bekräftelse | `lib/customer-contracts/onlineSigning.ts`, `app/sign/contract/[token]/{actions.ts,page.tsx}`, befintlig mailoutbox/worker och native signeringsfinalisering |
| Pris/geografi/mätning | `lib/partner-api/business.ts`, `lib/website/publicContractResolver.ts`, `lib/pricing/offerQuote.ts`, `lib/energy/resolver.ts`, `lib/customer-portal/db.ts`, `apiData.ts` |
| Staff/spårbarhet | `lib/staff-api/{context.ts,http.ts,userHandlers.ts,caseHandlers.ts,customerHandlers.ts}`, `lib/integrations/apiAuth.ts` |
| Specs | Aktuella `docs/openapi/{website-integration-v1.json,customer-portal-v1.json,staff-v1.json,staff-onboarding-v1.json}`; Partner runtime-spec i `lib/partner-api/{openApi.ts,businessOpenApi.ts}`; frysta releaser lämnas orörda |
| Guider | `docs/gridex-staff-api.md`, `docs/gridex-customer-portal-api.md`, `docs/single-api-key-tenant-integration.md`, `docs/staff-api/independent-onboarding.md`, `app/developers/staff-api/page.tsx`; skapa `docs/api-compatibility-policy.md` och `docs/api-migration-guide.md` |
| Preflight/täckning | Ny `scripts/check-ops-api-deployment-contract.cjs`; befintliga API/docs/compatibility-gates och `scripts/check-n-plus-one-query-budget.cjs` |

Varje kodpaket innehåller egna schema-/guiderevideringar och verkliga exempel på fel/success. Det sista dokumentationspaketet sammanfogar policyn och publiceringen; det ersätter inte löpande docs i varje PR.

## Leveransordning och paketen

Förbered stödmatris och inventering först. Implementera P1-fullmakt/commit och P2-idempotens/bekräftelse utan att invänta prestandaarbete. Inför kompatibilitetsgränser före publicering av ändrade DTO:er. Kandidater får separat verifieringsbeslut. Varje paket nedan är en liten PR eller delas ytterligare om migrations-/nativebevis kräver det.

### Paket 0 — aktualisera bevis och skapa regressioner

**Fynd:** samtliga F1–F45. **Filer:** fyndregistret/checkpoint, testfixturer; ännu ingen produktionskod.

- [ ] Läs aktuell HEAD, diff och befintliga PR-/migrationsägare; markera redan åtgärdade fynd med nya bevis i stället för att implementera dem igen.
- [ ] Gör läsande preflight för F29/F42 och live-grants F5; katalogdatum från7oktober används inte som aktuell deploystatus.
- [ ] Flytta respektive relevant `.probe.ts` från auditens evidence till en namngiven permanent regression under `__tests__/`; ersätt endast fixtureportar som behövs för riktig testmiljö.
- [ ] Kör en ofixad regression per paket och spara faktisk röd utgång. Inga nya tester skrivs enbart för att spegla planens föreslagna kod.
- [ ] Dokumentera baslinje och avgränsning; native/gateway/mail som ännu inte körts markeras kvarstående.

Exakt startkommando för det första runtimepaketet efter införda regressioner: `node node_modules/vitest/vitest.mjs run __tests__/partner-poa-commit-ownership.test.ts __tests__/portal-idempotency-ack-loss.test.ts`. Övriga paket anger sina exakta permanenta testfilnamn. Kör med projektets stödda Node-version; tidigare audit körde22.23.3.

### Paket 1 — skydda fullmaktsfil och beständig idempotens

**Fynd:** F18, F19, F37. **Modify:** `lib/api/strictRequest.ts`, `lib/partner-api/simple.ts`, `core.ts`. **Create tests:** `__tests__/partner-poa-commit-ownership.test.ts`, `__tests__/portal-idempotency-ack-loss.test.ts`. **Utgångspunkt:** `partner-completion-cleanup.probe.ts`, `idempotency-ack-loss.probe.ts`, replayfallet i `further-metering-storage.probe.ts`.

- [ ] Inför oförändrade reproduktioner av after-commit-completionfel, lost ACK och completed replay; kör båda nya testfilerna rött.
- [ ] Separera owned temporary upload från committad/okänd fil. Kontrollera idempotensnyckel/hash och claim innan upload. Radera endast bevisat oanvänd temporär fil; osäker commit kräver reconciliation.
- [ ] Begränsa fail-ledger-uppdatering till fortfarande processing. Vid completion-ACK-fel återläs resultat och replaya completed; kör inte mutation igen med samma nyckel.
- [ ] Kör samma nyckel/fel/success/concurrency och annan tenant/hash. Native/Storage-fixture verifierar att ett redan sparat document_path alltid går att läsa.
- [ ] Uppdatera Partner/idempotensguiden med retry efter osäker kvittens och stabilt success-resultat. Commit och review när både runtime- och nativeprov är gröna.

Kärninvarianter för assertionerna:

```ts
// Fortsättning på auditens idempotency-ack-loss.probe.ts efter completion-ACK-fallet.
m.loseCompletionAck = false
const replay = await run()
expect(m.row).toMatchObject({ status: 'completed' })
expect(replay.statusCode).toBe(201)
expect(replay.replayed).toBe(true)
expect(m.mutations).toBe(1)
```

`m` och `run` definieras i det arkiverade idempotency-ack-loss-provet som införs ovan. Separata assertions i fullmaktsprovet kontrollerar att remove aldrig träffar committad sökväg och att completed replay gör0upload/remove.

### Paket 2 — exakt accepterad fullmaktsjuridik och återställningsparitet

**Fynd:** F28, F42. **Modify:** `customerApplicationOnboarding.ts`, `customerApplicationLegal.ts`, native `gridex_onboard_customer_graph*`. **Migration:** skapa forward-migration för guard och canonical normalization. **Tests:** `__tests__/website-poa-exact-accepted-document.test.ts`; native fullgraf-fixture byggs från auditens `remaining-poa-native-phase.sql` men kör hela riktiga grafen.

- [ ] Testa två publicerade/låsta POA-dokument i samma bolag och olika bundles; default och explicit korrekt ID lyckas, alternativt ID avvisas före affärscommit.
- [ ] Använd accepted legal requirement primary_document_id som auktoritet. Låt TS avvisa mismatch och native verifiera samma equality oberoende av klienten. Normalisera stödda legacyreferenser till canonical dokument-ID före jämförelsen; ett äldre fältnamn får inte innebära annan juridik.
- [ ] Versionsstyr live-normaliseringens avsedda funktion/trigger; behåll FK/tenant/module/lock/scopes-kontroller.
- [ ] Kör riktig clean och historical-upgrade i disponibel PostgreSQL, inklusive native full onboarding, rätt original signer/hash/text och rollback av avvisad mismatch.
- [ ] Uppdatera Website-guide och OpenAPI:s POA-semantik; klargör skillnaden mellan dokumentationsrevision och signerad dokumentversion. Ingen docs-versiontolerans för juridiska ID:n.

Native avgörande jämförelse:

```sql
-- Inom auktoritativ onboardingtransaktion efter upplösning av accepted-document.
if v_supplied_poa_document_id is distinct from v_accepted_poa_document_id then
  raise exception 'power_of_attorney_offer_version_mismatch' using errcode = '23514';
end if;
```

Variablerna införs i native-funktionen genom tenantbunden lookup av det låsta avtalsunderlaget; inte via klientens påstådda bundle.

### Paket 3 — beständig avtalsbekräftelse och läsbar PDF

**Fynd:** F27, F26. Levereras som två små PR:er. **Modify:** `onlineSigning.ts`, secure-link action/page, native signeringsfinalisering och befintlig mailworker; Partner PDF-upload. **Tests:** `__tests__/signed-contract-receipt-continuation.test.ts`, `__tests__/partner-poa-pdf-structure.test.ts`. **Utgångspunkt:** `confirmation-signature.probe.ts`, `partner-poa-pdf-format.probe.ts`.

- [ ] Bevisa signering success + archivefailure → beständig pending delivery, inget falskt delivered/sent; `%PDF-` utan struktur ska avvisas.
- [ ] Spara en tenant-/avtalsbunden delivery continuation atomiskt med signeringen. Worker gör immutable PDF/archive och köar bekräftelsen med stabil idempotensnyckel. Återförsök ska inte signera avtalet igen.
- [ ] Visa signed respektive confirmation pending/queued/failed korrekt på secure-link-resultatet. Återanvänd Website-flödets statussemantik där den stämmer.
- [ ] Validera PDF genom faktisk parser/läsbar struktur och storleksbudget före signed/uploadframgång; använd befintlig lämpad dependency eller granskad pinning. Ingen ny påstådd validering av juridisk signaturäkthet.
- [ ] Verifiera worker retry, dubbla callbacks, tenant isolation, permanent mailfailure och riktig leverans i testmottagare. Uppdatera signerings-/Partner-guide och schema i respektive PR.

```ts
// Assertions mot finalizer/handler-resultat och fångade outboxportar i införda fixtures.
expect(signingResult.receipt.signed_at).toBeTruthy()
expect(persistedContinuation).toMatchObject({ state: 'pending' })
expect(invalidPdfResponse.status).toBe(422)
```

Testvariablerna är finalizerns verkliga resultat, läst continuationrad och Partner-handlerns Response från de två införda testfixturerna. De arkiverade proven visar hur de verkliga funktionerna anropas; inga nya publika test-APIs införs.

### Paket 4 — kontraktskompatibilitet utan exakt docs-match

**Krav:** användarens nya kompatibilitetskrav; F16/F17:s cachegränser berörs. **Create:** `apiContractCompatibility.ts`, `apiContractProjection.ts`, `__tests__/api-contract-compatibility-policy.test.ts`, `__tests__/api-legacy-client-profiles.test.ts`. **Modify:** `websiteIntegrationContract.ts`, `openApiReleaseManifest.ts`, `websiteApiContract.ts`, `publicContractFeedSnapshot.ts`, berörda responsegränser och aktuella schema-/release-gates.

- [ ] Inventera verkliga klientprofiler/SDK-validerare med respektive tenants samtyckta testfixtures och kvalificera supportmatrisen. Testa minst befintlig minimumprofil och aktuell release inom varje API-familj; gamla frysta dokument ensamt är inte klientbeteendeprov.
- [ ] Implementera det definierade `assessApiContractCompatibility` och explicit DTO-projektion. Valfri per-credentialprofil kan lagras serverägt i metadata per API-familj; verifiera schema innan persistens.
- [ ] Gör dokumentationsrevision till informationsfält i manifest/header. Behåll gammal responsprofil och dess version för legacyklienter; standardklient använder stabil major/capabilities och affärsvalidering.
- [ ] Ersätt helperns rena `contractSchemaVersion !== expectedSchemaVersion` med kompatibilitetsbeslut plus schema/tenantvalidering. Behåll gamla helperargument som deprecated adapter under migration; ett gammalt stött klientnummer får inte bli krav på exakt server-docsnummer.
- [ ] Validera samma tenant/profil/payload även när `304` returneras. Annan tenant, fel profil eller saknad verifierad snapshot kräver ny ovillkorad hämtning eller säkert fel; ingen gammal snapshot får märkas frisk utan kontroll.
- [ ] Kör klientmatris med strikt fryst OpenAPI-validator, flexibel V1-klient och OPS-referencehelper. Lägg okända optionalfält, missing-required, type change, ny enum, serverdoc uppdaterad, `200`/`304`, annan tenant och unsupported major i varje familjs prov.
- [ ] Publicera `docs/api-compatibility-policy.md` med avsedd policy och verkligt kvalificerat stöd; ingen registrerad profil påstås fungera innan testet är grönt. Docs-only release ska inte påverka provisioning readiness.

Exekverbart unitkontrakt för det nya gränssnittet:

```ts
import { expect, it } from 'vitest'
import { assessApiContractCompatibility } from '@/lib/integrations/apiContractCompatibility'
const registry = [{ surface: 'website', major: 'v1', revision: '2026-10-02.3',
  status: 'supported', capabilities: ['contracts.read'] }] as const
it('accepts supported client profile without matching latest documentation date', () => {
  expect(assessApiContractCompatibility({ surface: 'website', major: 'v1',
    clientProfile: '2026-10-02.3', requiredCapabilities: ['contracts.read'], registry }).ok).toBe(true)
})
it('rejects another major and unsupported capability', () => {
  expect(assessApiContractCompatibility({ surface: 'website', major: 'v2',
    clientProfile: null, requiredCapabilities: [], registry }).ok).toBe(false)
  expect(assessApiContractCompatibility({ surface: 'website', major: 'v1',
    clientProfile: null, requiredCapabilities: ['future.required'], registry }).ok).toBe(false)
})
```

Registry i testet är syntetisk, inte en automatiskt publicerad supportgaranti. Separata handler/klientprov måste bevisa verkliga format. Generella opt-in major-/profilfält som inte ryms i gamla bodyscheman ska läggas i header eller separat manifest.

### Paket 5 — Staff-identitet, revokering och deployment

**Fynd:** F1/F2, F29/F30. **Modify:** `lib/staff-api/context.ts`, `identityAuthority.ts`, native session-/membershiphelpers och release-preflight. **Tests:** befintlig `__tests__/staff-api-context.test.ts`, `__tests__/staff-tenant-auth.test.ts`; nya `__tests__/staff-historical-binding-required.test.ts`, `__tests__/api-deployment-dependencies.test.ts`. **Native/gateway:** disponibel testanvändare med gammalt fortfarande giltigt JWT.

- [ ] Återskapa F1 med raderad registreringsmetadata och historiskt extern identitet; legacy central positiv kontroll ska fortsatt fungera.
- [ ] Identifiera historiskt externt ankare i auktoritativ resolver; kräv aktuell giltig bindning trots borttagen metadata. Native write/replay-guard och läsningar använder samma livscykelbeslut.
- [ ] Bekräfta beslutad revokeringspolicy: Auth-only-ban/softdelete ska neka efterföljande skyddad åtkomst även med gammalt JWT. Uppdatera gemensam sessionhelper utan att utöka tenantsynlighet; kontrollera Auth-existens, deleted_at och framtida banned_until utöver profil/medlemskap.
- [ ] Kvalificera gammalt JWT genom hosted gateway/Data API och OPS-proxy. Profil disable, medlemskap revoke och harddelete/CASCADE är negativa kontroller; aktiv egen tenant och äkta legacy är positiva. Omedelbar logout-revoke kvalificeras separat via session_id/auth.sessions.
- [ ] Skapa `scripts/check-ops-api-deployment-contract.cjs` med exakt manifest över nödvändiga tabeller, RPC-signaturer, ACL och readiness per aktiverad funktion. Missing dependency blockerar aktivering för berört flöde, inte orelaterade API-familjer.
- [ ] Deploya kvalificerade forward-migrationer före appfunktionens aktivering; skriv fungerande interna/externa exempel i Staff-guide/onboarding och OpenAPI. F29:s gamla katalogresultat återverifieras före åtgärd.

Fixturekontrakt: raderat externt ankare/registration ger403; ban med gammalt JWT ger ingen tenantkund; aktiv egen tenant ger1; annan tenant ger0; missing Staff-RPC ger blocking preflight, medan redan stödd Website-funktion inte felklassas som Staff-ready.

### Paket 6 — spårbarhet och Staff-svar

**Fynd:** F3/F11/F12. **Modify:** `lib/staff-api/http.ts`, `userHandlers.ts`, `lib/integrations/apiAuth.ts`, aktuellt Staff-schema och guide. **Tests:** `__tests__/staff-request-id-correlation.test.ts`, `__tests__/staff-user-replay-header.test.ts`; återanvänd auditens `request-id.probe.ts`, `additional-staff-replay.probe.ts` och befintliga storage-target-prov.

- [ ] Röd regression: inkommande/saknat request-id måste ge samma server-id i body/header/logg; success och fel täcks.
- [ ] Generera/validera id en gång i wrappern och för vidare till logg/svar. Separera eventuellt klientkorrelations-id; logga inte assertion/token/body.
- [ ] För vidare `result.replayed` för samtliga user-writes. Dokumentera frivillig expected-project-header, response-project-header och412 i ny kompatibel Staff-release.
- [ ] Kör invite/change-role/disable/enable replay samt storage mismatch före mutation. Behåll current auth/ownership före cache/resultatreplay. Commit med uppdaterad dokumentation.

### Paket 7 — schema som beskriver verkliga svar

**Fynd:** F6/F25 och kompatibilitetskravet. **Modify:** Partner `openApi.ts`/`businessOpenApi.ts`, docs-generation och responsvalidatorer. **Tests:** `__tests__/partner-response-schema-validation.test.ts` med verkliga customer/site/location-handlerfixtures från `additional-partner-contract.probe.ts` och `location-output.probe.ts`.

- [ ] Visa rött för korrekta200DTO:er, partial city/name:null, unresolved/ambiguous och EntityResponse+kund/site.
- [ ] Ersätt oförenliga stängda allOf-kombinationer med korrekt slutet responsobjekt/unevaluatedProperties där vald validator stöder det. Använd OpenAPI3.1-nulltyper, inte enbart nullable:true.
- [ ] Validera hela200/201/fel DTO med en faktisk OpenAPI3.1/JSON Schema2020-12-validator; Ajv6-delprov räcker inte som slutgate.
- [ ] Kontrollera minst en gammal genererad klient. Schemafel kan ofta rättas utan ändrad runtime-body, men kompatibilitet måste klassas utifrån klientbeteende, inte etiketten schema-only.
- [ ] Materialisera ny docsrelease och låt frysta filer vara orörda. F6/F25 får status FIXED först efter riktiga respons- och klientprov.

### Paket 8 — anläggningsfakturor och aktuell supporthistorik

**Fynd:** F7/F8/F9/F10. **Modify:** `lib/partner-api/simple.ts`, relevanta `lib/customer-service/supportApiHandlers.ts`/supportlisthelpers och aktuella schemas. **Tests:** `__tests__/partner-site-invoice-pagination.test.ts`, `__tests__/support-history-continuation.test.ts`, `__tests__/support-attachment-replay-after-close.test.ts`.

- [ ] Inför regressioner från additional Partner/Portal-prover: fler än200andra anläggningsfakturor,501meddelanden,101bilagor och stängt ärende efter lyckad upload.
- [ ] Flytta site-/contractfilter före DB-limit och skapa tenant-/resursbunden keyset-pagination; behåll visibility/ägarskap.
- [ ] Behåll historisk V1 första-sida-semantik för stödd profil; inför valfri cursor eller separat paginerad route om nytt responsefält bryter äldre slutna klienter.
- [ ] Fastställ F10-policy: tidigare avslutad skrivning replayas efter closure **efter aktuell auth/ownership**; closure stoppar nya skrivningar i execute-callback. Dokumentera precedence och prova originalresultat utan ny fil.
- [ ] Kör gränsvärden, cursor-tampering, andra tenants och dåliga resursreferenser; uppdatera scopes, request/svarsexempel och continuationregler i docs.

### Paket 9 — aktuella mätvärden och fullständiga månadssummor

**Fynd:** F13/F14/F15. **Modify:** Partner `simple.ts`/`core.ts`, `lib/customer-portal/db.ts`/`apiData.ts`, portalens förbruknings-/dashboardanvändning och native månadsläsning. **Tests:** `__tests__/partner-current-metering-dto.test.ts`, `__tests__/portal-complete-month-consumption.test.ts`; basera på `further-metering-storage.probe.ts` och `further-portal-summary.probe.ts`.

- [ ] Kör correction/replaced/current, Wh/MWh/kWh och net-riktningar rött mot verklig handler.
- [ ] Läs current revision före pagination; quantity_kwh returneras alltid med motsvarande kWh. Definiera net-riktning uttryckligen, ingen blind konvertering/dubbelkonvertering.
- [ ] Lägg fullmånadssumma i tenant/customer-bunden native aggregation med Stockholm-periodgränser, definierade riktningar och täckning. Behåll begränsad detaljlista separat.
- [ ] Bevisa744timvärden à1kWh ger744 även med250/500detaljrader; rätta/voida rad utan dubbelräkning. Kör sommartid, kvartsvärden, saknade intervall och annan tenant.
- [ ] För profil vars enum inte rymmer net-riktning: erbjud korrekt opt-inmodell eller tydligt filtrerad historisk semantik; dölj inte betydelsen genom felaktig label. Uppdatera mätdata- och täckningsdokumentation.

### Paket 10 — profil-/adressuppdateringar utan informationsförlust

**Fynd:** F20/F21/F22. **Modify:** faktisk profile-update-handler och `addressIntake`/native address commit; använd källkedjorna i `STATE-FAILURE-FINDINGS.md`. **Test:** `__tests__/customer-profile-address-transaction.test.ts`, utgångspunkt `profile-address-state.probe.ts`.

- [ ] Kör de tre röda stateproven: care_of-only, samma-adress-proveniens och email före saknad anläggning404.
- [ ] Separera identitets/hashfält från care_of/informationsfält. Bevara auktoritativ källrank vid samma adress och upprepa conflictbeslut under native låsning.
- [ ] Validera hela resurskedjan före första mutation; samla förändringen i native transaction när kombinerat success ska vara atomiskt. Om operationen verkligen måste vara delvis, definiera explicit delresultat som kompatibel opt-in.
- [ ] Bevisa ingen emailändring vid prevalidatable404, care_of sparas och verified geografi inte tappar proveniens. Kör concurrent newer grid-owner update mot portalpatch.
- [ ] Uppdatera profil-/adressschema med patch/replacement-semantik, care_of och konflikter i samma PR.

### Paket 11 — prisoffert och ärlig lokalisering

**Fynd:** F23/F24. **Modify:** `business.ts`, `offerQuote.ts`, `publicContractResolver.ts`, `energy/resolver.ts` där publicering/assurance avgörs. **Tests:** `__tests__/partner-api-channel-quote.test.ts`, `__tests__/partner-location-assurance.test.ts`; återanvänd `current-pricing.probe.ts` och `location-output.probe.ts`.

- [ ] API-only-erbjudande väljs och ska ge riktig offert; Website-only ska inte bli synligt i API utan avsedd policy. Bevara tenant-/juridik-/pricing-readiness.
- [ ] För `channel` uttryckligen genom offertresolver och välj kanoniska vyer för rätt kanal; undvik global borttagning av publiceringsguard.
- [ ] Derivera resolved/verified från faktisk assurance/färskhet; äldre identifiers får presenteras som preliminära. Separera geografisk owner-identitet från operativ Ediel-routing.
- [ ] Bevisa stale/ambiguous inte blir pris eller send-ready. Rerun current-price för negativa priser, SEK/öre, moms-/avgiftsflaggor, kvart/DST och verified source.
- [ ] Publicera prisskillnaden spot/total kundoffert och assurance-status. För gamla profiler införs förklarande metadata via tillåten kanal/projektion, inte godtyckligt extra bodyfält.

### Paket 12 — versions-/profilsäker cache och standard-ETag

**Fynd:** F16/F17; beroende Paket4. **Modify:** `app/api/v1/website/public-contracts/route.ts`, `lib/website/publicContractApi.ts`, `publicContractFeedSnapshot.ts`. **Tests:** `__tests__/public-contract-profile-etag.test.ts`; fortsätt befintliga feed-/route-prover.

- [ ] Röd test: ändrad representation/schema/profil trots samma DB-publication ska inte replaya fel gammal body via304.
- [ ] Låt fingerprint-ETag omfatta tenant, kundtyp, kanal, selected representation/profile och representationsrevision. Dokumentationsändring utan bodyändring behöver inte invalidiera data-ETag.
- [ ] Implementera RFC9110 weak comparison, lista och wildcard för GET efter auth. Auth/RLS/profil får inte cachas över gränser.
- [ ] Kontrollera snapshot även på304; count/tenant/required-fields/legal completeness ska inte hoppa över validering.
- [ ] Kör strong/weak/wildcard, schema/profilrelease, gammal cache, annan tenant och last-known-good vid trasigt svar. Dokumentera cache och versionsheaders.

### Paket 13 — en autentisering och tydlig webhook-livscykel

**Fynd:** F4/F45. **Modify:** Partner dispatcher och `lib/integrations/webhooks.ts`, credential-revoke/subscription-action vid vald policy. **Tests:** `__tests__/partner-single-auth-budget.test.ts`, `__tests__/webhook-revocation-policy.test.ts`.

- [ ] Bevisa F4 med verklig dispatcher/handler och dubbelt budgetuttag; ersätt dubbel auth med en request-scoped verifierad context utan cross-request-cache.
- [ ] Rekommenderad F45-policy: vanlig nyckelrotation får behålla uttryckligen godkänd webhook, men säkerhetsrevokering/tenant-offboarding ska kunna stoppa kopplade prenumerationer atomiskt. Definiera revoke-reason och separation före ändring.
- [ ] Bevara null-client/manuellt godkända prenumerationer genom uttryckligt ägarskap. Kontrollera subscription/tenant och vald credentialpolicy före transport, även för redan köad delivery.
- [ ] Använd `variants-auth-webhook-proof.test.ts` som negativt/positivt underlag. Revokering, rotation, expiry, paused subscription och tenant lifecycle får olika dokumenterade förväntningar.
- [ ] Uppdatera incident-runbook och webhookguide med separata eller gemensamma kill-actions; ingen tyst ändring av en oavgjord produktpolicy.

### Paket 14 — restore-grants och schema-/säkerhetsinventering

**Fynd:** F5/F29/F42/F44. **Modify:** canonical schema och nya forward migrations; preflight frånPaket5. **Native:** riktig PostgreSQL clean/historical upgrade, inte bara PGlite.

- [ ] Verifiera att två äldre archive/number-RPC:er saknar authenticated/anon EXECUTE efter både clean och upgrade; service_role-flödet ska fungera.
- [ ] Synkronisera snapshot till avsedda grants; gissa inte att aktuell live-ACL behöver ändras när den redan är spärrad.
- [ ] Inventera exposed security-definer-kroppar efter mutation/tenantpåverkan; private/service-only tabeller utan policy är inte automatiskt fel. Dokumentera faktisk actor-/companyguard.
- [ ] Kör negative other-tenant/anon/authenticated/write cases och native deployment dependency check. Bevara migrationshistorik och generera verkliga types/snapshot.
- [ ] Publicera intern deployment/restoreguide och säkra klientfel när beroende saknas; ingen tenant ska behöva ny dokumentationsrevision för en intern grantsfix.

### Paket 15 — mätstyrd databas- och API-effektivisering

**Fynd:** F31–F38/F43. **Filer:** identifierade index/policy-forward migrations, `portal-bundle`/`apiData.ts`, PartnerPOA, `priceSourceResolver.ts`; inga ogrundade bulkändringar.

- [ ] Prioritera de två bekräftade duplicate-indexparen, kvalificera alla beroenden och unikhetssemantik innan ett index per par tas bort. Nuvarande storlek16kB/index innebär inget löfte om stor hastighetsvinst.
- [ ] För FK/RLS/unused/pool: välj faktisk långsam eller högfrekvent workload från säkra aggregat, bygg representativ syntetisk last och spara baseline latency/buffers/writecost/EXPLAIN ANALYZE.
- [ ] Inför högst en verifierad index-/policyförändring per benchmark. Behåll endast positiv förbättring utan RLS/grants/skrivregression. Fynd utan verifierad vinst får status qualified/no-change, inte fabricated fixed.
- [ ] För portalpaket: använd befintligt include, lazy-load utelämnade sektioner och kvalificera eventuell native retention-aware bundle. Mät full användaruppgift, inte bara antalet RPC:er.
- [ ] För fixed-only: för vidare required source types och undvik onödiga läsningar först efter att mixed/portfolio/settlement/freshness är verifierade.
- [ ] F37 genomförs redan medPaket1: completed replay ska ge0upload/remove. Räkna inte samma fix två gånger.
- [ ] Uppdatera performancebudget och intern benchmarkguide med jämförbara före/eftervillkor. Radera inte564unused-index kandidater blint och cachea aldrig tenantbehörigheter globalt.

### Paket 16 — parsing, täckning och aktuella dokumentationsingångar

**Fynd:** F39/F40/F41. **Modify:** Staff-queryparsers, `check-n-plus-one-query-budget.cjs`, README, API-minnets aktuella index efter rätt memoryägarskap. **Tests:** permanent `__tests__/staff-query-parsing-policy.test.ts`; utgångspunkt `remaining-query-parsers.probe.ts`; scannertest utifrån `variants-performance-scope.probe.py`.

- [ ] Definiera strikt decimal och explicit duplicatepolicy. Kontrollera gamla kunder först; skärpt parsing som tidigare godkändes kan vara breaking och måste opt-in eller profilskyddas.
- [ ] Utöka relevant Staff/Partner-helper-scope och bevisa den identiska förbjudna select-loopen nu upptäcks där. Bevara dokumenterade bounded-budget-undantag.
- [ ] Lägg säker auth/query/serializer-stegräkning och p95/p99; scannerens green ska inte marknadsföras som full indirekt RPC-/helperanalys.
- [ ] Byt dokumentationsingång från historisk hotfix till aktuell kontraktsinventering, kompatibilitet, onboarding och exempel; behåll historiska patchinstruktioner som daterat arkiv.
- [ ] Publicera vald querypolicy, standardlimit och cursorregler i schema och guide. Kör rätt parsingprofil och negativtest av otillåtna tenantselector-fält.

### Paket 17 — publicerad API-dokumentation och stödmatris

**Omfattning:** samtliga kodpakets docs, särskilt F2/F6/F10/F11/F12/F25/F39 och nya kompatibilitetskravet. **Modify:** aktuella schema-/guidekällor, release-manifest och generatorer. **Create:** `docs/api-compatibility-policy.md`, `docs/api-migration-guide.md`, `__tests__/api-supported-client-release-matrix.test.ts`.

- [ ] Sammanför de redan korrigerade operationerna i en ny kvalificerad docsrelease: auth/scopes, request/svar, pagination, request-id, idempotens, project412, null/enums, POA, pris-/geografisemantik och mailstatus.
- [ ] Ge varje API-familj en explicit matris: stödd major/profil, capabilities, deprecated features, giltig migreringsperiod och fulla exempel. Dokumentrevision får inte beskrivas som en klientspärr.
- [ ] Uppdatera guidekoden till schema-/verklig handlerparitet. Visa både äldre stödd profil och aktuellt rekommenderat flöde där formen skiljer sig.
- [ ] Publicera den avsedda policyn ordagrant i utvecklaringången: "Du behöver inte matcha den senaste dokumentationsrevisionen exakt för att använda en stödd API-version."
- [ ] För brytande ändringar ge före/efter-exempel, ny major/opt-in, feature/statuskod, datum och migreringsprov. Skicka inga externa tenantmeddelanden i detta plansteg; publicering/avisering sker i ordinarie releaseflöde.
- [ ] Kör befintliga `npm run api:docs`, `npm run api:compatibility`, `npm run api:release:verify`, `npm run api:error-registry` och nya klientmatrisen. Intern exakt parity mellan samma byggnads runtime/spec är fortsatt ett legitimt gatekrav; det får inte förväxlas med krav på alla tenants senaste datum.
- [ ] Materialisera fryst **ny** release med befintliga releaseverktyg, bekräfta hashes och served bytes. Skriv inte om `docs/openapi/releases/*` för redan publicerade revisioner.

Docs-/releasegates ska fortsätta upptäcka inkonsekvens inom den egna byggnaden samtidigt som klientmatrisen bevisar kompatibilitet mellan byggnader. Att bara ändra en text till backward-compatible är inte godkännande.

### Paket 18 — kvalificerad release, uppföljning och avveckling

**Filer:** release-runbook, denna plans checklistor, fyndregistret och task-checkpoint. **Miljö:** isolerad full projekt-DB, test-Storage/mail och därefter kontrollerad release.

- [ ] Kör varje riktad regression, typecheck och relevanta DB/schema/ACL/tenantgates på exakt reviewed HEAD. För migrationer: riktig clean + historical upgrade, genererade types och schema parity.
- [ ] Kör en realistisk två-tenant-kedja: credentials/login → publicering → lokalisering → current spot/quote → accepterad juridik/POA → avtal → arkiverad handling → confirmation queue/testmottagare → replay → revokering. Andra tenants resurser är alltid negativa kontroller.
- [ ] Kör samma kärnflöden med äldre kvalificerade klientprofiler mot den nya servern utan ändrade klient-docsversioner. Testa både200 och304/cache, strict SDK och referencehelper.
- [ ] Utför deployment-preflight före migration/funktionsaktivering. Expand DB före app, aktivera därefter kompatibla beteenden per tenant/feature. DDL/aktivering följer befintligt auktoriserat releaseflöde; denna plan utför inte deploy.
- [ ] Följ säkra aggregerade felkoder, p95/p99, archived-document readback, completed→failed-avvikelser och confirmation continuation-age. Definiera larm utan kundpayload/token.
- [ ] Rollback app/feature till verifierad kompatibel version. Behåll redan signerade/committade dokument, data och forward-schema; avveckla inte nya DB-kolumner/grants mitt i återställning utan särskild kvalificering.
- [ ] Markera varje fynd FIXED/QUALIFIED_NO_CHANGE/REFUTED/REMAINING med commit, native/klient/docs-bevis och eventuell deploymentrevision. En grön mock räcker inte som full hosted/mailacceptans.
- [ ] Före framtida avveckling: inventera fortfarande aktiva profiler, annonserad supportperiod och migrationsbevis. Ingen automatisk månatlig höjning av minimum-version.

## Fynd → paket och klart-kriterium

| Fynd | Paket | Klart när |
|---|---|---|
| F1, F2, F29, F30 | 5 | Extern/legacy/revokering + aktuell deployment/gateway kvalificerad; rätt guideexempel. |
| F3, F11, F12 | 6 | Samma id i svar/logg, replayheader och projektheader/412 i riktig spec/handler. |
| F4, F45 | 13 | En auth-budget och beslutad/verifierad webhook-revoke/rotation-policy. |
| F5, F44 | 14 | Clean/upgrade ACL och riskklassad inventory med negativa tenantprov. |
| F6, F25 | 7 | Verkliga DTO:er klarar2020-12/schema och stödda klienter. |
| F7, F8, F9, F10 | 8 | Sitefilter före limit; continuation; explicit auth-safe closure/replay. |
| F13, F14, F15 | 9 | Current revision, rätt mängd/enhet/riktning och fullmånad/täckning. |
| F16, F17 | 12 | Rätt ETag/304 för representation/profil/tenant, weak/wildcard. |
| F18, F19, F37 | 1 | Committad fil bevaras, ledger beständig, replay utan filsideeffekt. |
| F20, F21, F22 | 10 | care_of/proveniens bevaras; prevalidation/transaction; native concurrency. |
| F23, F24 | 11 | Kanalrätt offert; stale/ambiguous/provisional ger rätt semantik/spärr. |
| F26, F27 | 3 | PDF läsbar; signering med beständig delivery och riktig testmail. |
| F28, F42 | 2 | Exakt accepted-document, canonical normalization och full native restore/onboarding. |
| F31, F32, F33, F34, F35, F36, F38, F43 | 15 | Uppmätt förbättring + oförändrad säkerhet, eller dokumenterat no-change-beslut. |
| F39, F40, F41 | 16 | Aktuell dokumentingång, vald kompatibel parsingpolicy och testad helper-scope. |
| Nytt kompatibilitetskrav | 4, 17, 18 | Gammal stödd klient fungerar mot ny release utan exakt docsnummermatchning. |

F29/F42 kontrolleras också iPaket14:s restoregate. F37 åtgärdas en gång iPaket1 och mäts iPaket15. Dokumentation iPaket17 publicerar tidigare pakets verifierade docs, inte uppskjutna schemakorrigeringar.

## Obligatorisk kompatibilitets-/säkerhetsmatris

| Scenario | Förväntat |
|---|---|
| Docsrelease ändras, V1-affärskontrakt oförändrat | Stödd äldre klient fortsätter utan konfigurationsändring. |
| Ny optional funktion som klient inte använder | Äldre flöde fungerar; capability saknas bara för den nya operationen. |
| Strict äldre klient med slutet schema/versionsconst | Kvalificerad serverprofil returnerar historiskt kompatibel representation/version. |
| Saknad eller okänd frivillig klientprofil | Avsaknad väljer stödd standard; explicit okänd profil ger dokumenterat fel, ingen godtycklig fallback. |
| Unsupported major eller verkligt brutet payloadkontrakt | Tydligt dokumenterat unsupported/schemafel; sista verifierade snapshot skrivs inte över. |
| Annan tenant eller manipulerad profilselector | Ingen resurs-/behörighetsförändring eller cacheläcka. |
| `304` med gammal snapshot för annan tenant/profil | Nekas eller hämtas om utan conditional; markeras inte healthy. |
| Fel exakt juridiskt dokument/hash | Nekas även när API-profilen är kompatibel. |
| Återkallad access med gammalt JWT/queued webhook | Beslutad policy verkställs före protected read/write/transport; positiva rotationfall separat. |
| Delvis fel efter affärscommit | Ingen filförlust eller ledger-downgrade; beständig recovery/leverans. |
| Internt schema/RPC saknas | Berört flöde blockeras av preflight; docsnummermatchning får inte dölja dependencyfel. |

## Kommandon vid implementation

Kör med stödd Node-version och aktuellt package-lock. Testfiler i planen införs först i respektive paket; kör inte påhittade passerade resultat.

```bash
npm run typecheck
npm run typecheck:tests
npm run api:docs
npm run api:compatibility
npm run api:release:verify
npm run api:error-registry
npm run api:performance-tenant-gates
npm run quality:n-plus-one
npm run quality:slo-contract
npm run db:migrations:check
```

För berörda native-/säkerhetsändringar kör också repositoryts relevanta OPS-hardening/integration och fulla regressioner enligt AGENTS, inklusive kvalificerad native runner i disponibel miljö. `npm run build` och full relevant appsuite körs på sammanfogad releasekandidat, inte som bevis för enbart denna plantext.

## Första konkreta arbetsordning

1. Paket0 + kompatibilitetspolicy/klientinventering frånPaket4.
2. Paket1 och2: F18/F19/F28/F42, med rollback-/restorebevis.
3. Paket3 och5: bekräftelse/PDF samt identitet/deployment/revokering.
4. SlutförPaket4 innan profilkänsliga svar/schemaändringar publiceras.
5. Paket6–14 i små granskningsbara PR:er; varje paket innehåller sina docs.
6. Paket15–16 efter uppmätta/klassade behov; inget bulkfix av advisors.
7. Paket17–18: served docs/klientmatris, releasepreflight och kontrollerad leverans.

**Status vid planleverans:** plan och täckningsmatris granskade; inga ovanstående runtimefixar, migrationsändringar, API-docsreleaser eller deploys genomförda i detta plansteg.
