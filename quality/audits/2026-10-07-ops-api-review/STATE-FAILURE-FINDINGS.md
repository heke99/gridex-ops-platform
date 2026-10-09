# Gridex OPS – ytterligare fynd i fel- och skrivflöden

Fortsatt granskning 7 oktober 2026 på tidigare rapporters källrevision. Fokus: state efter partiella fel, idempotenskvittens, fullmaktsfilers ägarskap och profil-/adressuppdateringar. F1–F17 räknas inte igen. Endast OPS och lokala syntetiska prov; inga source-fixar, live-affärsoperationer eller produktionsändringar.

**Resultat: fem nya fynd, varav F18 har högst prioritet på grund av risk för förlust av redan lagrad handling.** Slutlig verifiering: **8 tester i 3 filer PASS under Node 22.23.3**. Native SQL granskades i källan; genuine PostgreSQL/Storage-replay genomfördes inte.

## F18 – P1: fel i idempotenscompletion kan radera redan sparad fullmaktsfil

`lib/api/strictRequest.ts:265` kör affärsmutationen först och skriver sedan idempotenssvaret separat. Completionfel vid rad 267 propageras tillbaka till handlern. Partner simple-handlers fångar alla fel och kör cleanup av uppladdningen: fristående fullmakt `lib/partner-api/simple.ts:670`, kombinerat avtal `:788`. De skiljer inte mellan en tillfällig oägd uppladdning och en fil som redan länkas av en sparad fullmakt.

Fullmaktsinsättningen har redan sparat document_path/hash och status signed. Native avtals-RPC:n sparar samma koppling inom sin egen transaktion före return: `20260816135746_partner_api_v1_transactional_contract_create.sql:328`. Senare HTTP-side cleanup kan inte rulla tillbaka den transaktionen. Legacy POA-flödet i `core.ts:624` har samma catch-mönster; där gjordes ingen separat ny behavior-probe.

**Prov:** riktiga simple-handlers och riktig executeIdempotentPortalWrite, med syntetiska auth-/DB-/storage-portar. Båda skrivvägarna får successful business commit och därefter syntetiskt completionfel. Resultatet är 500, den sparade affärsraden ligger kvar, dess uppladdade PDF har tagits bort. Positiv kontroll med successful completion behåller filen. Tre prov PASS.

**Förutsättning:** affärsskrivningen har lyckats, men den separata lagringen av idempotensresultatet misslyckas. Detta sker inte vid varje normalt anrop. **Effekt:** fullmakten/avtalet kan länka en fil som saknas, med förlorad handling trots en redan sparad resurs. Prioriteten P1 avser denna destruktiva efter-commit-felhantering; inget sådant produktionsfall har reproducerats.

**Motprövning:** cleanup vid en vanlig replay tar legitimt bort en oanvänd ny uppladdning. Fyndet gäller den fil som just blivit ägd av den sparade affärsraden. Granskade contract/Ediel-retentionguards gäller andra buckets och invoiceguards registrerade fakturakällor; ingen sådan guard visades skydda färsk Partner-fullmakt. Hosted Storage-delete och native constraints kördes inte i provet.

**Åtgärd:** spåra filens persistenta ägarskap/commitfas. Radera inte handlingar efter lyckad eller oklar affärscommit; reconcila idempotenscompletion och eventuella verkliga orphan-filer säkert. Behåll cleanup för bevisat oägda uppladdningar. Prova business-failure före commit, successful business + completionfel, förlorad RPC-kvittens, replay och cleanupfel. Att bara svälja completionfel reparerar inte durable replay.

## F19 – P2: förlorad completionkvittens skriver över completed med failed

`completePortalWriteIdempotency` skyddar UPDATE med `status=processing` vid `strictRequest.ts:202`. `failPortalWriteIdempotency` vid rad 210 saknar statusvillkor. Outer catch i execute-wrappern omfattar även completionfelet, inte bara affärsmutationen.

**Prov:** riktig wrapper och en syntetisk stateful DB-port. Completion sparas som completed med 201-body, men porten simulerar att DB-kvittensen försvinner. Catch uppdaterar samma rad till failed utan statusfilter. Nästa samma-key/payload-request för en verkligt använd icke-retrybar operation nekas `409 idempotency_previous_attempt_failed`, trots att 201-body finns sparad. Mutationsräknaren är fortfarande 1. Positiv kontroll med normal kvittens replayar resultatet och gör ingen andra mutation. Två prov PASS.

**Effekt:** ett nätverksfel efter sparad completion förstör återförsökssignalen och kan leda klienten till manuell kontroll eller ny nyckel. Dubblettmutation med ny nyckel testades inte och påstås inte vara bekräftad. F19 skiljer sig från F18: ledgern skadas även utan en filcleanup-väg.

**Motprövning:** table-status tillåter både completed och failed; inspekterad snapshot hade inget trigger-/transitionguard som nekar denna övergång. Endast move-out och supportcase-skapande finns i helperns särskilda retrylist, inte exempelvis Partner-kundskapande. Båda nya helperproven kördes också av en oberoende granskare.

**Åtgärd:** failure-update ska inte kunna skriva över completed. Separera affärsfel från osäker completionkvittens och reconcila bestående resultat vid ack-fel. Ett statusvillkor skyddar ledgern men räcker inte ensamt för business-commit före en aldrig sparad completion; det scenariot kräver en robust tillståndsmodell/transaktionsgräns.

## F20 – P2: care_of-ändring ignoreras trots accepterad uppdatering

OpenAPI beskriver care_of som facility-address-fält vid `docs/openapi/customer-portal-v1.json:13604`; profile-update vidarebefordrar det. `lib/customer-sites/addressIntake.ts:67` räknar fysisk adresshash utan care_of. Om hash är oförändrad går helpern via rad 206 och sparar bara mottagning, källa, referens och tid, inte care_of.

**Prov:** verklig POST profile-update och verklig address-helper med syntetiska portar. Komplett samma fysiska adress skickas med nytt care_of. Svaret är 200, status accepted, facility_updated=true och address_result.status=unchanged. Det gamla care_of ligger kvar; native RPC anropas aldrig. Ett prov PASS.

**Effekt:** API-klienten får en accepterad uppdatering men mottagarinformationen uppdateras inte. **Åtgärd:** separera fysisk adressidentitet/deduphash från ändringsdetektion för alla redigerbara fält. Ändrat care_of kan behöva sparas/auditeras utan att fysisk adress eller härledd routing invalideras. Bevara stark källproveniens och verifiering där sådana fält faktiskt är oförändrade; lägg inte bara care_of i den fysiska dedupnyckeln utan att pröva affärssemantiken.

## F21 – P2: samma adress kan sänka proveniens och kringgå senare konfliktskydd

Sammahashgrenen i `addressIntake.ts:206` ersätter address_source med inkommande källa, även om den lagrade adressen är verifierad från en högre källa. Den behåller address_verified_at/verifieringsmetod. Skyddet vid rad 219 jämför sedan inkommande sourceRank mot den **nya lagrade** källan. Rang är 70 för grid_owner_response och 20 för customer_portal.

**Prov:** verifierad nätägaradress. Direkt annan kundportaladress ger conflict och ingen native commit. Samma gamla adress från kundportalen ger unchanged men lagrar source=customer_portal med verifieringen kvar. Efterföljande annan adress jämför nu 20 mot 20, ger updated och anropar native commit. Verklig helper användes; query/state och native RPC-port är syntetiska. Ett prov PASS.

**Native motprövning:** aktuell `gridex_commit_customer_site_address` i `schema.sql:55949` / `20260902221500_facility_initial_address_and_unknown_supplier_semantics.sql:83` låser rätt bolags-/kund-/anläggningsrad och validerar hash, men gör ingen ytterligare källrangsprövning. Den invaliderar fortfarande härledd routing och verifiering efter ändringen. Ingen motsvarande source-rank-trigger hittades i inspekterat schema/migrationer.

**Effekt:** det avsedda konfliktskyddet för verifierad adress kan kringgås genom två anrop på kundens egen anläggning. Ingen tenantöverskridning eller extern sändningsbypass är visad. **Åtgärd:** bevara kanonisk källauktoritet vid sammahash-refresh; spara senaste observerande kanal separat om det behövs. Auktoritativ konfliktsprövning bör också göras atomiskt i native commit mot dåvarande låsta rad. Bevara nuvarande routinginvalidering och testets negativa direktändringskontroll.

## F22 – P2: kombinerad profiluppdatering kan ändra e-post före 404

`app/api/v1/customer/profile-update/route.ts:185` kör och sparar profiländringen före facility-reference-uppslagningen. Om den skickade anläggningsreferensen sedan saknas, returnerar routen 404 utan completion eller delresultat.

**Prov:** verklig route, med kontakttransaktionens port simulerad som successful durable write. Request innehåller giltig ny e-post och saknad facility-reference. E-post ändras i den syntetiska affärsstaten; routen returnerar 404 och skapar ingen completion. Ett prov PASS. Detta är inte en genuine native rollback-/transaction-probe.

**Effekt:** klienten får ett avvisat anrop trots att en del redan utförts. Kontakttransaktionen är atomisk för egna fält, inte för hela multi-resource-anropet. Ingen uttrycklig garanti om global atomicitet hittades i kontraktet; fyndet är den konkreta delskrivningen på ett redan valideringsbart saknat resurs-id och avsaknaden av delresultatsignal.

**Åtgärd:** verifiera alla referenser/åtkomsträttigheter före första mutation. Bestäm sedan atomisk hantering eller dokumenterade delresultat för övriga senare fel. Att flytta facility-lookup före kontaktändringen löser detta 404-fall men är inte en garanti mot samtliga framtida samtidighets-/DB-fel.

## Verifiering, motprövning och arbetsordning

Oberoende granskare reproducerade F18 och F20–F22; root läste deras kompletta helper-/caller-/native-kedjor och körde proven igen. F19 reproducerades av root och kördes/motprövades separat av den andra granskaren. Breda misstankar om unmapped move-out-fel avfärdades: dess kända SQL-fel var redan explicit mappade. City-only partial-address-beteende räknas inte som ytterligare bekräftat kontraktsfel eftersom replacement-/patch-intent inte är entydig.

```text
/tmp/gridex-api-review-node22/node_modules/.bin/node node_modules/vitest/vitest.mjs run __tests__/ops-idempotency-ack-review.test.ts __tests__/ops-partner-completion-review.test.ts __tests__/ops-profile-state-review.test.ts
3 filer / 8 tester PASS
```

Exakta källor: `evidence/idempotency-ack-loss.probe.ts`, `partner-completion-cleanup.probe.ts`, `profile-address-state.probe.ts`. Återkör genom att lägga dessa under __tests__ med kommandots namn. Resultat: `evidence/state-failure-review-tests.log`. Temporära repo-tester togs bort efter färdig körning. Auth-/DB-/storage-/kontakttransaktionsportar är syntetiska enligt respektive fil; inga riktiga handlingar användes eller raderades.

Prioritera F18:s filägarskap och F19:s durable state-hantering först, helst som separata avgränsade ändringar med gemensamma fault-prov. F20/F21 kräver en gemensam genomgång av adressidentitet kontra informationsfält och källauktoritet, med native kontroll för samtidighet. F22 kan först få referensvalidering före mutation och därefter en uttrycklig multi-resource-felpolicy.

Full native PostgreSQL/Storage-kvalificering, full applikationssvit/build och produktionstest återstår inför relevanta fixar. Alla fem fynd är öppna; denna granskning genomförde inga remediation-PR:er eller deployment.
