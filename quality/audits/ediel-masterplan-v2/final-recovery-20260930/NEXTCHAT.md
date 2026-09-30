# Fortsättningsprompt — genomför hela Ediel masterplan v2

Arbeta i `heke99/gridex-ops-platform` som integrationsansvarig. Detta är ett implementationsuppdrag: slutför hela **F0–F7** i `docs/ediel/masterplan-v2/MASTERMASTERPLAN_v2.md`, med samtliga **121 regelkort och 231 bokstavliga acceptanskontrakt, totalt 352 olika ID:n**. Fortsätt tills allt genomförbart internt arbete har implementerats, integrerats, verifierats och redovisats, med endast konkret belagda externa blockerare kvar. Begränsa inte uppdraget till CI-recovery, UTILTS, S02 eller en ny plan.

## 1. Återta verkligt läge och bevara parallellt arbete

Läs `AGENTS.md`, relevanta installerade skills, projektets faktiska ramverksdokumentation och `.agent-memory/{README,current-state,current-task,handover,open-blockers,work-plan,decisions,known-failures}.md` samt `checkpoint.json`. Koden, schema, exekverade kvitton och aktuella Git-heads har företräde framför gammalt minne. Minnets tidigare instruktion att publicera syntaxpaketet från `e0bd3641` är historisk och ska inte verkställas igen.

Kontrollera aktuell remote main, draft-PR **#421 och #423**, kommentarer, exakta head/tree, lokal HEAD/gren/status/diff/opushade commits, alla worktrees, aktiva agenter, filägarskap samt faktisk senaste CI. Kontrollera även #418 och #422 utan att ändra deras tenantservice-initiativ. #310 är pausad och ska inte ändras.

Denna checkpoint utgick från isolerad lokal bas `860feb10644a2b0c89452a4aff65359fc2187724`, tree `4631fa302f32d89960a1401e619c7da1e2ed6874`, på `codex/ediel-final-recovery-20260930`. Läs **README.md och verification.json i samma katalog som denna prompt** för det färdiga rättelsepaketets exakta commit, tree, patchhashar och faktiska resultat. Dessa värden är orientering och ger inte rätt att skriva över senare arbete.

Vid skapandet fanns två andra aktiva rötter:

- `/workspace/scratch/5ac1e75530df/gridex-ops-platform`, `codex/ediel-v2-identity-e035-owner-20260928`: ägde #421-publicering och senare source-/runtimepaket.
- `/workspace/scratch/a67b8bbe9d11/gridex-ci`, `codex/ediel-integrated-ci-20260930`: ägde #423, `codex/ediel-ci-integrated-replay-20260930`, och sammansatt CI-kandidat.

Sök dem om de finns, kontrollera aktuellt tillstånd och samordna med ägarna. Läs aldrig en annan rots gamla kopia av en handoff som om den vore ett färskt CI-kvitto. Använd isolerade worktrees och en ensam skrivägare per fil. Flytta ingen aktiv annan ägares PR-ref. Om en agent saknas: säkra hela dess commits och ändringar, fastställ att arbetet inte längre skrivs, och ta över uttryckligt ägarskap i journalen. Undvik vänteloopar på historiska agenter. Ingen force-push, ingen gemensam DB-reset medan andra arbetar.

## 2. Integrera rättelser utan duplicering

Rättelsekoden är fryst som `ed3f5159ba52a81ff7cdf877bf3302205540b0b8`, tree `90db37a96248771520b62e522b2a717e9a4a4334`. Artefaktbranchen publicerar paketet utan att flytta aktiva PR-refar. Om den lokala koden saknas: läs `portable/manifest.json`, hämta dess base64-delar i angiven ordning, kontrollera del-/bundle-hashar och avkoda till Git-bundle. Den kräver endast redan publicerad main-commit `53bf989b0ad402bb2ce151c186eea31f1ec9cf03`. Kör `git bundle verify` och importera till en egen ny gren, jämför head/tree/66 filhashar, sedan granskat cherry-pick mot aktuell isolerad integrationskandidat. Ett oberoende bare-importprov passerade. Skriv inte över en ägares HEAD med bundlens bas.

Recovery `32065e595e7d912456899332142aa2bf1ac61b18`, den kompletta receipt-fixturen och V2/RPC-fixturpaketen finns redan i basen. Återapplicera dem inte. Läs `final-recovery-20260930`-paketets README, manifest och patch. Jämför mot aktuell integrerad kod innan applicering; använd `git apply --check` eller ett motsvarande granskat cherry-pick, och bevara nyare semantik vid konflikt.

Paketet behandlar typade skyddade PRODAT-källor, strukturell predecessor-data, tenantbundna operativa uppslag, fullständiga testfixturer, S02:s egna obligatoriska fält/NULL-status och korrekt ERC42-innehåll, lossless parsergrind, skyddad fresh-ACK-källkvalificering, återläsning av accepterat transportkvitto samt avgränsad embedded ACK-/namespace-verifiering. Det registrerar uttryckligen vad som ännu saknar full native/CI-verifiering. Granska rättelserna och kör de berörda regressionerna innan de samordnas med senare source-, aktörs-, BRP-, reporting-, outbox-, transport-, DSN-, migrations- och UI/API-paket.

Tre bekräftade äldre runtime-luckor ska prioriteras när #421-ägarens senare kod integreras:

1. ACK-dubblettsökning sker i denna bas före skyddad originalkontroll och saknar tenant-/miljöfilter. Bind dubblett/replay till aktuell tenant, miljö, juridisk aktör och skyddad originalkälla; bevisa återkallelse och inga sidoeffekter. Fresh-ACK-rättningen i detta paket kvalificerar inte den gamla replayvägen.
2. Verklig fresh transport saknar `sourceRulePackEvidence` respektive `technicalSyntaxAckEvidence` i binding till aktuell native prepare/enter, både generiskt och i tillämplig sealed Z08-väg. Befintliga SQL-grindar vägrar därför före SMTP. Slutför skyddade runtimeportar hos ensam ägare och kör verkliga native consumers. Kopiera inte caller-JSON eller använd alltid-gröna mockar för att fylla proveniens.

3. Blandad PRODAT partial-orchestration skapar i denna bas BGM34 utan eget outcome för ett obehandlat syskonobjekt. Verklig ACK-validator vägrar `ACK_PRODAT_OBJECT_OUTCOME_MISSING`. Paketets safe-hold-prov och giltiga one-object/two-register-213 ACK/retry ersätter inte den ursprungliga mixed-object-funktionen. Slutför källkvalificerad behandling och outcomes per eget objekt utan uppfunnen syskonsuccess; bevisa faktiska väntade och förbjudna effekter.

Oupplösta UNH-guidefall får strukturerad, oförseglad diagnos och säker hold; paketet påstår ingen nationell ACK eller beständig marknadseffekt för dem. Den uppdaterade Z04-fixturen kräver separat committad, autentiskt validerad syntaxfacet före ACK-transaktionen. Kör dess riktiga psql-handoff i disposable replay; embedded 69/19 funktionsprov ersätter inte detta. Den framåtriktade namespace-migrationen återställer endast CONTRL:s tillåtna tomma application namespace och vägrar saknad fysisk family. Historiska migrationer och P-APERAK-regler är oförändrade.

`quality/audits/ediel-masterplan-v2/codephase-20260930/FINAL_TEST_PHASE.md` fanns som **opublicerad fil hos #421-ägaren**, inte i denna bas. Bevara och integrera dess senaste innehåll genom ägaren före runtime-frysning. Anta inte att alla senare paket redan ingår bara för att de nämns i en kommentar.

## 3. Behåll hela kravunderlaget och dess betydelser

Läs masterplanen, särskilt §§18–20, samt:

- `docs/ediel/masterplan-v2/registers/{rules,acceptance_tests,source_manifest,open_evidence_gates}.json` och länkade CALL-, data-, fält-, timer- och tillståndsregister.
- `docs/ediel/masterplan-v2/package_manifest.json`.
- `quality/audits/ediel-masterplan-v2/codephase-20260930/{README.md,work-matrix.json,assessment-*.json}`.
- `quality/audits/ediel-masterplan-v2/masterplan-v2-reconciliation-20260930.json`.
- `quality/audits/ediel-masterplan-v2/{capability-activation-matrix-20260928.md,issuer-history-owner-gate-20260928.md,external-evidence-requests-20260930.md}`.

De **33 frysta originalen är specifikationsartefakter**, inte 33 PDF:er. Source-manifestet anger sju PDF-identiteter med egna evidensgränser. Ändra inte originalregistrens betydelser, statusar eller hashkontroller. Lägg implementation och acceptansbevis i additiva journaler.

Den daterade d30-reconciliationen hade regler 110 NOT_VERIFIED/11 PARTIAL och kontrakt 219 NOT_EXECUTED/11 PARTIAL/1 PASSED. SC-044 hade helkontraktsacceptans. Detta är ett historiskt kvitto, inte färsk bedömning av dagens kandidat. Den senare codephase-matrisen är också ett daterat inventeringsunderlag; nya paket kan ha löst dess gamla TODO:n. Bedöm varje ID mot verklig sammansatt kod innan ny implementation. Matrisens externa etiketter inkluderar även uppskjutna interna tester och granskningar och är inte automatiskt externa blockerare.

Behåll separat status för källkvalificering, implementation, lokala tester, native, browser, exakt-head CI, helkriterieacceptans och produktionsaktivering. Ett grönt delprov eller kopplat regelkort ersätter inte scenariots fullständiga kriterier och förbjudna effekter.

## 4. Genomför parallellt med tidigt låsta gränssnitt

Använd upp till sex arbetsagenter plus integrationsansvarig om miljön stödjer det. Dela avgränsade uppgifter vidare när en agent blir ledig. Lås exakta ID:n, gränssnitt och ensam filägare innan skrivning.

| Spår | Genomförande |
|---|---|
| A | Databas/RPC: transaktioner, namespace, källa, juridisk aktör/undertyp, idempotens, rollback, outbox, framåtmigrationer, RLS/grants och samtidighet. |
| B | Domän/runtime: kanonisk admission/policy, parser/egna fält, aktör/DDQ/DGI/ESCO/rättigheter, status/process/timers, korrigering/retry och alla skrivvägar. |
| C | UI/API/OPS: befintliga flöden, handlers, rättigheter, begriplig readiness/hold, formulär/utkast/konflikter, tillgänglighet och kontraktsparitet. |
| D | Integration: registryimport, EL/GAS, rutter/subadresser, original EML/Message-ID/DSN, certifikat/TLS/SPF, okänd submission och transportstatus. |
| E | Mätning/struktur/AI/BI/fakturering: egna IDE/guide/versioner, källrevisioner, historik, effekter, rättelser och radering. |
| F | Oberoende facit, native/HTTP/browser/E2E, källjämförelser, säkerhetsregressioner och varje kontrakts förväntade/förbjudna effekter. |

Integrationsansvarig äger gemensamma kernel-/source-/admission-/ACK-gränssnitt, workflowändringar, gemensamma versionskällor, genererade typer/schema/fingerprint, matriser/projektminne och publicering. Delegera inom dem bara genom explicit ensam filöverlåtelse. Granska och integrera verifierade delcommits löpande; kör inte hela slutkedjan efter varje fil.

## 5. Slutför F0–F7 genom faktisk implementation

- **F0:** bind verklig miljö/DB/SMTP och belagd äldre Z01-incident; ingen spekulativ omsändning.
- **F1:** autentiska källor, företräde, tids/versionbundna sammanhängande profiler och kapabilitetsspecifika källgrindar.
- **F2:** juridisk och teknisk aktör, DDQ/DGI, provider/beneficiary, egen tenant/representation, aktuella grants, återkallelse och race-prov.
- **F3:** hela tillämpliga grammatik-, parser-, egna fält-/parent-/registerregler och korrekt avgränsade CONTRL/APERAK/ERR. Bevara NULL/zero, originalfysik och rätt referensnamespace.
- **F4:** registryimport, EL/GAS-separation, routing även tom subadress, autentiska original EML/Message-ID/DSN, certifikat och submission/retry utan falsk leveransstatus.
- **F5:** separata supply-/ESCO-livscykler, alla 42 övergångar, kalender/timers, cancellation/order/concurrency och samordnade assignments.
- **F6:** egen IDE/guide/funktion, exakta mätvärdesrevisioner, strukturbevis, AI/BI, fakturaunderlag, rättelser, historik och radering.
- **F7:** migration/schema/RLS/RPC/typer, tenant-E2E, dependency-bunden readiness och tillämpliga externa releasebevis.

Inventera verkliga consumers: UI, manuella actions, API, workers, cron, batch, imports, service RPC och triggers. Aktuell tenant, resurs, juridisk aktör, undertyp, delegation, grant och proveniens kontrolleras vid verkställighet och replay. Klientvalda ID:n, capability-flaggor och mockade kontexter är inga behörighetsbevis. Ingen alternativ writer får kringgå gemensamma regler. Mutationen, relationerna, revisionen, historiken, audit/idempotensresultatet och beständig integrationsavsikt ska vara atomiska. Externa följdeffekter hanteras separat med varaktig status och säkra återförsök.

## 6. Verifiera samma frysta kandidat

Vid fel: reproducera första orsaken, skilj produktfel från fixtur/facit/proveniens, rätta orsaken med relevant röd→grön regression och kör berörda prov. Sänk inga tester, grants, regler eller säkerhetsgrindar. Återför inte gamla godkännanden till ny kod. Rapportera om ett prov inte körts och fortsätt med oberoende arbete.

Kör riktade tester, app-/test-/scripttypkontroller, lint, fryst-original-/mekaniska-/migrations-/RBAC-kontroller. Integrera därefter samtliga färdiga runtimepaket och frys exakt commit/tree. Kvalificera:

1. Full unit/quality och tillämpliga säkerhetskontroller/build.
2. Verkliga DB/RPC/trigger/worker/cron/batch-consumers: korrekt persistens, tenant/grant/återkallelse, atomisk rollback, dubbelklick, samtidig ändring, retry och timeout efter commit.
3. Tomdatabas- och uppgraderingsreplay i egna databaser. Generera typer/schema/fingerprint **autentiskt från samma replay**, med projektets etablerade pipeline; ersätt inte med handskrivna manifest eller äldre schema.
4. Verkliga interaktiva UI-klick, navigation, formulär, keyboard/fokus, mobil/200 procent zoom, och återläsning efter omladdning med skärmbilder. API-anrop från Playwright är HTTP-bevis, inte interaktiv UI-verifiering.
5. Källoberoende känt facit och fullständiga kontraktskriterier, även uteblivna/förbjudna effekter. Samma parser/renderer-roundtrip räcker inte.
6. Exakt publicerad heads fem workflows: Ediel masterplan v2 regressions, Gridex browser and quality E2E, Gridex full E2E, Tenant integrity regression och OPS hardening inklusive verify, quality och clean replay. Läs faktiska jobbloggar och autentiska artefakter. En gammal grön eller ett diagnostiskt #423-resultat kvalificerar inte en senare #421-kandidat.

Den tidigare #423-kandidaten `604e339922b9fa0eb449dbd1ef720c49a8b5cafa` var röd i OPS, Ediel och Full E2E. Stale typer och faktisk native SQL-fixtur stannade replay. Senare lokala rättelser är inte kvalificerade bara av äldre CI. Embedded PostgreSQL-prov är avgränsade DB-funktionsbevis och ersätter inte Supabase/PostgREST/RLS, autentisk full replay eller browser. Denna checkpoint hade inte Docker/psql/Supabase CLI; använd tillgänglig isolerad CI och samla verkliga artefakter.

Efter code/schema/contract-frysning materialiseras tillämpliga gemensamma releaseartefakter. Behåll historiska immutable artefakter. Granska hela varje ID:s kriterier oberoende innan en additiv acceptansstatus ändras.

## 7. Externa blockerare och gränser

Dokumentera exakt vilka capabilities/ID:n som väntar på verklig issuer/representation, kontinuerliga original-/raderingsarkiv, behörigt retentionbeslut, LOC175-registry/mandat/separat varaktig consumer och ACK/retry-ägare, full E035-historik, tillämpliga ESCO/bilaterala rättigheter, TGT/AGT-beslut eller autentisk provider-/motpartsincident. Skilj saknad extern faktisk uppgift från kvarvarande intern implementation/test eller förvärvbar dokumentation. Hitta repository-/CI-verifierbar grammatik och schema själv enligt §20; begär inte generellt användaruppladdning.

Behåll säker fail-closed hold för berörd förmåga och fortsätt allt oberoende internt arbete. Hitta inte på issuer, rättigheter, scans, certifikat, skickade meddelanden eller godkännanden.

**Merga inte main, kör inga produktionsmigrationer, skicka ingen riktig kundkommunikation, aktivera ingen Edieltrafik och kör inga motparts-/TGT-/AGT-prov utan separat uttryckligt tillstånd. Ingen force-push. #310 ska förbli oförändrad.** Tenantservice #418/#422 med T01–T55/U01–U20 är ett separat bevarat initiativ; ersätt inte dess masteruppdrag med Ediel- eller begränsad API-plan.

## 8. Leverera och håll arbetet igång

Commita verifierade avgränsade paket, publicera samordnat genom ensam integrationsägare till rätt draftstruktur och kontrollera publicerad SHA/tree. Fortsätt självständigt utan ett nytt ”kör” efter varje delsteg. Ge korta men faktiska statusuppdateringar under arbetet och spara checkpoint med exakt nästa åtgärd; lämna inte en tyst vänteloop.

Slutredovisa gren/PR/exakt publicerad SHA/tree, genomförda runtime/UI/API-funktioner, samtliga 352 ID:n med färska bevis och kvarvarande luckor, verifierade UI-actions av totalt inventerade, faktiska unit/native/browser/CI-resultat, säkerhetsfynd, migration/backfill/kompatibilitet/rollback, verkliga externa blockerare samt nästa konkreta genomförandesteg. Markera inte hela masterplanen godkänd för att CI är grönt. Avsluta med tydlig gräns mellan intern leverans, helkontraktsacceptans och produktionsaktivering.

Börja nu med aktuell head-/ägarskapskontroll och rättelsepaketets readback. Integrera kompatibla rättelser, säkra senare workstreams, genomför kvarvarande F0–F7-paket parallellt och avsluta slutgrindarna på samma frysta kandidat.
