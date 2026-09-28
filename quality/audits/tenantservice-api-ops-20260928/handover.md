# Tenantservice/API/OPS — överlämning, checkpoint 2026-09-28

> **Fortsättning efter överlämningen:** Den nya agentinstruktionen finns ordagrant i [continuation-instruction-20260928.md](continuation-instruction-20260928.md). Detta dokuments ursprungliga head/tidslinje beskriver överlämningsögonblicket; aktuell PR-head och följande tillägg går före den äldre punkten.

**Status: ofullständigt arbete, inte verifierad leverans.** PR [#418](https://github.com/heke99/gridex-ops-platform/pull/418) förblir draft. Ingen merge, produktionsmigration, riktig kundkommunikation eller Edieltrafik ingår.

## Exakta versioner och arbetskopia

- Gren: `codex/tenantservice-api-ops-20260928`.
- Remote head vid kontrollen före denna dokumentationscommit: `dfb2221191e4c44b10eab99714d8b18400fa910a`. `git ls-remote`, PR-metadata och lokal HEAD gav samma SHA. Lokal status var ren, diffen tom och antalet opushade commits noll. Ingen pågående git-skrivare eller låsfil observerades för arbetskopian.
- **Senaste verifierade kodversion:** `dfb2221191e4c44b10eab99714d8b18400fa910a`. Denna version innehåller den avgränsade alias- och identifierarkontrollen efter `383cde92`, samt tidigare portal-, publicerings- och pagineringsarbete. Se PR-beskrivningen och [README.md](README.md) för exakt omfattning.
- Efter den verifierade versionen tillför denna checkpoint endast [masteruppdrag.md](masteruppdrag.md), denna överlämning och en hänvisning i README. Inga nya funktioner, tester eller manuella omkörningar gjordes. En dokumentationscommit får en ny SHA och är inte i sig en ny verifierad kodleverans.
- **Publicerad checkpoint-head:** läs PR #418:s `head_sha` eller `git ls-remote origin refs/heads/codex/tenantservice-api-ops-20260928` efter push. En commit kan inte ange sin egen SHA i sin egen fil; det exakta slutvärdet är därför infört i PR-beskrivningen och överlämningens slutrapport, medan denna fil anger den exakt kontrollerade föregående remote head.

## CI på den verifierade kodversionen

Alla resultat nedan avser `dfb2221191e4c44b10eab99714d8b18400fa910a`, inte den senare dokumentationscommiten. Inga manuella jobb startades för denna överlämning.

| Workflow/run | Jobb-ID | Resultat |
| --- | --- | --- |
| OPS hardening `36436708427` | verify `108976394925` | success |
| OPS hardening `36436708427` | quality-release-gates `108976395427` | success |
| OPS hardening `36436708427` | clean-migration-replay `108976395436` | success |
| Tenant integrity `36436708364` | tenant-integrity-regression `108976394509` | success |
| Public browser/quality `36436708426` | browser-public `108976394816` | success |
| Full E2E `36436708455` | coverage `108976394920`, smoke `108976395321`, pr-certificate `108977472829` | success |

Full/staging-jobben och produktionscrawler `36436708481` var villkorligt **skipped**, inte genomförda bevis. Clean replay omfattade native case fixture 1/1, Playwright 4/4, post-browser native 1/1, tenantinvarianter samt matchande genererade typer och schemasnapshot; se [PR #418](https://github.com/heke99/gridex-ops-platform/pull/418) för artifact-ID och fingerprint. Inga P0–P8-faser eller T/U-krav är fullständigt accepterade.

## Kvarvarande verkliga fel och gränser

- **F02:** OPS och extern kund-API skriver kontaktuppgifter i separata, icke atomiska vägar utan en gemensam resursrevision/audit/outbox. Källvägarna är identifierade; fel- och återförsöksbeteende saknar komplett native bevis.
- **F07:** idempotency claim, affärsskrivning och completion sker separat. En krasch mellan commit och completion har ingen bevisad säker återspelning.
- **F06/P1:** en integrationsnyckels scope och konsekventa kundidentifierare ger inte ett självständigt bevis på slutkundens mandat. Betrodd issuer/audience/subject, tenant, kund, resurs och åtgärd måste bindas och verifieras. Se [delegated-customer-proof-boundary.md](delegated-customer-proof-boundary.md).
- **F03/F04/F05 och UI:** egen portal/OPS har avgränsad native/browser-evidens, men extern API, webhook, notifiering, meddelanden, bilagor, övriga UI-ytor, samtidiga inserts/återkallelser, verkliga deployed grants och kontrollerad backfill/rollout återstår. Den statiska UI-inventeringen bevisar inte att varje knapp fungerar.

**Nästa konkreta implementation:** fastställ ett verifierbart issuer-/audience-/subject-kontrakt per integration och en separat kundmandatpolicy per resurs och åtgärd. Inför en fail-closed kontroll i den externa kund-API-vägen och bevisa med två kunder i samma tenant och en annan tenant att fel issuer, audience, subject, återkallad länk, fel kund/resurs och idempotent replay nekas före effekt. Välj inte en tokenutfärdare eller nya rättigheter utan den nödvändiga auktoritativa tillitskällan. Därefter byggs en gemensam atomisk kontaktändringscommand för OPS och API.

## Spårbarhet, lokala filer och återstart

- Hela gällande originaluppdraget, ordagrant i 51 893 byte, finns i [masteruppdrag.md](masteruppdrag.md) (SHA-256 `17ef6ca168379ed95e6b942eafac332fa82f54b38d6e24a79868cbb26245752d`). Det innehåller T01–T55 och U01–U20. Status och evidens per ID finns i [requirements.csv](requirements.csv); denna matris ändrades inte vid överlämningen. [README.md](README.md), [recovery-checkpoint-20260928.md](recovery-checkpoint-20260928.md) och PR #418 beskriver tidigare paket och exakta bevisgränser.
- Före checkpointen fanns inga ocommittade spårade/ospårade källfiler eller opushade commits i denna gren. Ignorerade lokala bygg- och testutdata `.next/`, `e2e-artifacts/`, `node_modules`, `next-env.d.ts` och `tsconfig.*.tsbuildinfo` ligger kvar lokalt av reproducerbarhets-/cache-skäl och ingår inte på GitHub. Andra arbetsgrenars filer ingår inte.
- Endast masteruppdrag och överlämning är nya repofiler; inget riktigt kundmaterial eller råa hemligheter har avsiktligt kopierats. Den tillgängliga miljön saknade `ggshield`, så ingen fullständig specialiserad secret scan kan påstås. Dokumenten har granskats för uppenbara nycklar, tokens, privata nycklar, personnummer och kundposter före commit.
- Nästa agent börjar med att kontrollera aktuell PR-head och automatiska CI-resultat på just den versionen, läser originaluppdraget och matrisen och fortsätter från P1-beroendet ovan. Starta inte om inventeringen och tolka inte denna checkpoint som produktionsgodkännande.

## Fortsättning efter överlämningen, P1-kandidat

- Dokumentationscheckpoints exakta remote head före P1-arbetet var `191976ce1c8989003a2beb5d7ad20ed5faa6801a`. Den bygger på `dfb2221191e4c44b10eab99714d8b18400fa910a` utan kodändring. Automatisk OPS-run `36441559937`: verify `108993099784`, quality-release-gates `108993100479` och clean-migration-replay `108993100096` **success**. Tenant-run `36441559804` jobb `108993059311`, public browser `36441559712` jobb `108993059440`, full E2E `36441559600` coverage `108993058992`, smoke `108993058599` och PR-certificate `108993977054` **success**. Staging/full/crawler villkorligt skipped. Detta verifierar dokumentationshead, inte den nya P1-koden.
- P1-kandidaten tillför serverkonfigurerad RS256/JWKS-verifiering via `jose`, issuer/audience/subject-bindning, tenant/klient/kund/exakt metod+path, högst fem minuters ålder, en separat plattformsmappning av issuer/sub till kund och aktiv portal-kontolänk. Ointygat eller okonfigurerat kundanrop nekas innan kundresolvern; synk via `/api/v1/customer/sync` har ett explicit tenantmaskinscope. Inga riktiga utfärdare, kundbindningar eller privata nycklar har lagts i repot eller aktiverats.
- Lokal evidens för denna kandidat: 37 riktade Vitest-fall i fyra filer, app/test-typecheck, scoped ESLint, `api:runtime:parity` och lokal `api:release:verify` passerade. Därefter publicerades P1-checkpointen som `f1e803bcc9ceda336d10d0f7bcbadc56b5c121d5` med identiskt lokalt/remote-träd. Automatisk OPS-run `36445084993` verify `109005187718`, quality-release-gates `109005187400`, clean-migration-replay `109005187189` **success**; tenant `36445085130`, public browser `36445085305`, full E2E `36445084964` och Ediel `36445085190` passerade sina tillämpliga jobb. Det är syntetisk lokal delegationsverifiering och befintliga CI-grindar, inte en konfigurerad riktig issuer/integration eller P1-acceptans. Den existerande OpenAPI-releasen `2026-08-22.2` beskriver ännu inte den nya headern och får inte påstås matcha draft-runtime. Se [delegated-customer-proof-boundary.md](delegated-customer-proof-boundary.md) och [requirements.csv](requirements.csv).
- Kvarvarande faktiska fel: F02 och F07 i kontakt- och idempotensskrivning är oförändrade. Nästa konkreta implementation är ett atomiskt kontaktkommando för OPS och API, med serververifierad aktör, tenant, revision, kund, primärkontakt, audit, idempotensresultat och outbox i en transaktion. Verklig issuer/enrollment, JWT replay/step-up, native/API/browser och kontraktsrelease är separata P1-beroenden. PR #418 förblir draft utan produktionsändring.

### Efterföljande OPS-gräns, ännu ej exact-head-verifierad

- `CustomerContactsAddressesCard` hade ytterligare två service-role-skrivvägar där formulärets `customer_id` kunde väljas över tenantgräns utan kontroll av aktörens medlemskap. Två reproduktionstester var röda före rättning. Kontakt och adress kräver nu att den autentiserade medarbetaren får arbeta med kundens tenant, filtrerar efter `company_id` vid uppslag/ändring, skriver tenant-id på nya rader och audit, nekar arkiverad kund och okänd kontakt-/adressreferens före primärkontaktrensning. Fem riktade tester, app/test-typecheck och scoped lint passerar lokalt. Detta visar en mockad OPS-servergräns, inte en bred T01/T07-acceptans.
- Den befintliga primärkontaktvägen rensar fortfarande tidigare primärkontakt, skriver kontakt, synkar kund och skriver audit i separata steg; OPS-profilformuläret och extern API har andra separata skrivvägar. En skiss till SQL-transaktion validerades inte i native databas och ingår **inte** som aktiv migration i checkpointen. Nästa P2-implementation måste ge samma kontaktkommando för båda vägarna med revision, idempotens och outbox; uppdatera genererade DB-artefakter och OpenAPI på en faktisk clean replay innan någon godkänd leverans.
