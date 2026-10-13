# Ediel F/G: avgränsad sourcekomponent, 6f94

## Aktuellt läge och nästa steg

Ägare: `codex-ediel-fg-proof-20261013-6f94`. Packet: `cf251c2f-a87c-4c82-aaa5-4d711a754b5c`. Egen branch: `codex/ediel-fg-proof-20261013-6f94`; isolerad workspace: `/workspace/ediel-fg-proof-20261013-6f94`.

Aktiv uppgift är den nya namngivna staged-customer-orakelrättningen från [6149259115](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6149259115), med exakt två tester under befintlig custody. Föregående P2-rättning och publicerade `0dbc3101138e6ebe041bc280d9f7b68e4876e0ce`/tree `989dd2927f4acd9f783cb6644a0b971078153ec7` är avslutade och [sourceöverlämnade6147700001](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6147700001); deras kod-/proof-/revieworiginal bevaras i versionshistoriken och nedan. Ingen tidigare paus/fixprompt är aktiv dispatch. Native12 har inte körts och F/G förblir NOT_EXECUTED.

Nuvarande integrerade source är `467d12a99eb5ffa2e7e7ddccf46f8e78a28fbd8c`, tree `ac21a93c50ddb575497ec3ce209ebc22a29d7ff2`, ordnade parents `[0dbc3101138e6ebe041bc280d9f7b68e4876e0ce, d798eb36f35cd4f437d44c8d234b4dbb81adc7a6]`. Root normalmergade bara den verkligt levererade mainens fyra proof/checkpoint/archive/ledgerdeltan efter avslutad Z09FG- och Z04C-sourceöverlämning. Alla fyra F/G-codepreimages är oförändrade från public0dbc, inga produkt-/SQL-/helper-/frozen-/configbytes eller originalassertions har ändrats i detta steg. Arkivet har inte öppnats eller omkvalificerats av oss.

Faktisk main/base är `d798eb36f35cd4f437d44c8d234b4dbb81adc7a6`/tree `e3b6c11677a2b871a128504f1616def7d22dba1e`, ordnade parents `[95d8d160491e79b172342654d8dc643346758105, fba453cc7cc9de8a26ec75d29248e1733316fcd1]`. Verifierad faktisk #800 normalmerge ger **119 VERIFIED + 204 PASSED = 323/352**, ledger SHA256 `7266ee57be5ac633ec0e8ca3f169aaf7d048da45ca0abfc6004284eae75c822e`. Äldre 320/95d och originalresultat här är daterade käll-/granskningsvärden, ingen aktuell baseline. Våra sourcepaket ger +0.

Alla fyra refs är färskt GET_MATCH till ursprunglig receipt3f4b; ingen mottagartransfer har skett. [Exakt två-fils writerresume6149882155](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6149882155) namnger `/root/z06fg_requirements`, som måste självständigt kontrollera fullreceipt/source/tree/parents/branch/preimages före första write. Root PAUSAR två testpaths och skriver endast detta eget checkpoint. Helper- och konfigurationsfil är read-only i denna revision. Mottagaradoption/native/GEN/CI/mainmerge ligger kvar hos befintlig seriell ägare och producent.

Skrivaren har fryst de två testerna vid 054abdeee5dff896b71af5b763be34a1a95b4488/tree d9f5c403888f8882702ea49f2aa21dd56bf1f47d, med 34 tillagda rader och 66 passerande finita kontroller. Native12 är fortfarande NOT_RUN. Två nya fristående fullständiga slutgranskningar godkänner H1 2cb27b3c/tree55163270 med SOURCE_APPROVE_WITH_UPSTREAM_LIMIT. Root införlivar originalrapporterna genom en dokumentändring; nästa steg är båda granskarnas exakta rebind av denna dokumentversion, source-only publicering och superseding sourcekvitto. C1/a93c:s decoder/saved-case-korrigering6144860660/inboundCases051ec är ett upptaget beroende, ingen filöverlämning till oss. Aktuell parser kan fortfarande ge den staged-projection som våra skärpta orakel ska fånga; ingen nativegreen/wholeSC031/ledgercredit fabriceras.

## Custody och mandat

Användarens ursprungliga mandat tillåter verifierat ledigt arbete enligt aktuellt reservationsprotokoll; senaste styrning är att fortsätta till färdig leverans. Vårt nya fyrfilspaket använder detta mandat och bevisad ledighet. Den tidigare obesvarade handoffförfrågan [6145424935](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6145424935) ger inget tillstånd.

Receipt `3f4b1b494ec70bd0217cd935352946416a4d51eb`: `masterplan-reservation-v1`, epoch `gridex-five-agent-20261012`, metadata-slot `helper`, ids `[]`, ingen slotref. Receipttree och enda parent exakt dåvarande main efed verifierades. Fyra sorterade CREATE_IF_ABSENT följdes av full GET_MATCH före första write. Root, oberoende custodypeer och skrivaren kontrollerade refs självständigt. CLAIM: [6145809806](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6145809806).

| Exakt ägd fil | Filresurs under refs/tags/agent-claims/masterplan/ |
| --- | --- |
| scripts/helpers/ediel-z06f-reading-followup-native-fixture.ts | file-bdde621e24ef4dc2ec3afb9144527377564ce42be3ed85f6e1ede25d75e6289e |
| scripts/ediel-at-z06f-supplier-acceptance-native.test.ts | file-9ddf44eaf2cef0c5308bb951ffcdd7efe0afe33014612fd20defe59a5069d014 |
| scripts/ediel-at-z06g-supplier-acceptance-native.test.ts | file-e3d709417c302ee6c7bd155cd9952cfa3b81198eb32f779675e9245eb21774a4 |
| scripts/ediel-source-owner-native.config.ts | file-d6edc55d7e0b865f9a9b7ebf5e6691e4dd8393db84830e6eca21d3d42a519bef |

De fyra filerna saknade scopeöverlapp i alla då aktuella 45 relevanta receiptbodies och fem kompletta PR-diffar. C3:s aktuella receipt2255742/takeover6132236078 omfattar 12 H-filer och två H-ID, uttryckligen inte F/G/BRP. Pre-reset503 och efter-reset read-onlyplan6124838710 gav ingen aktiv filcustody. Avsaknad av en ID-ref var inte underlaget för ledighet. Oberoende rapport: `/tmp/ediel-6f94-fg-custody-current.md`, SHA256 `c839d371d4decd202e3cd9407d8648645b7d7aabc2c047afff395c121b58e319`. Receipt/refkvitton bevaras i `/tmp/ediel-fg-6f94-*`.

Root skriver endast detta eget unika checkpoint. Ingen ledger-/rule-/contractrow, SQL/runtime/GEN, producent, shared memory-role eller serialmerge-roll har tagits. Kodskrivaren får exakt source/fourfiles/output/pause-handoff och måste förnya custody/preimages före rättningar. Medförfattare räknas inte som oberoende slutgranskare.

## Historiska main- och ledgerläsningar före orakelrevisionen

Startmain: `efed3683115c06d1925f8b80c05c801a54db9885`, tree `dc439c2e017a9633471db53919b745f587abb67b`.

Aktuell normalmerge av #780 är autentiserad: main `95d8d160491e79b172342654d8dc643346758105`, tree `fa5ab60527a40bd642749365fc275d1d4a69e277`, ordered parents `[efed3683115c06d1925f8b80c05c801a54db9885, 2e073477c43c6a133a01710772e65cefc43f6162]`. PR CLOSED/merged `2026-10-13T13:22:09Z`; head2e073 och treeMATCH. Den aktuella ledgern lästes ur detta exakta Gitobjekt: SHA256 `4a1560a0b16ae37d68aa30c5f67ef616a516c5306e29edf4269b7b1fa9fea850`, **119 VERIFIED + 201 PASSED = 320/352**. Den är oförändrad. SC035 är fortfarande PARTIAL; Z02L/LK och våra F/G-rader är fortfarande NOT_EXECUTED. Ingen ökning antas från sourceleveransen eller äldre antal.

## Tidigare fryst sourceförberedelse och verifiering

Den fyrfiliga komponenten tillför nya fysiska originalvarianter före admission, opt-in uppskjuten första applicering, första verkliga F/G-struktureffekt, förbjuden fysisk NAD+UD med ignorerade sourcefacets och oförändrad kundidentitet, F:s egen E66-observation efter faktisk persistence och G:s frånvaro av påhittad avläsning. R/D, LI, parties, främmande punkt, outbound INSERT och originalmutation har negativa kontroller. Config registrerar två F/G-filer utan att försvaga loopback-statusgrind, gamla includes, setup eller timeout. Totalt tolv nativefall förberedda; NATIVE_NOT_RUN.

Befintlig hjälpardefault applicerar fortfarande omedelbart. Alla två gamla hela test-ASTs och fem gamla assertionhelpers per fil bevaras; root och peers verifierade alla 56 F + 55 G expect-uttryck. Den tidigare field306-rättningen återimplementeras inte. Första nya casehelper gör riktig structuralreview efter actual intake/owner.finish och före approval, så tidigare accepterad bedömning inte används efter en färsk canonical assessment.

| Kontroll | Resultat och faktisk gräns |
| --- | --- |
| Vitest4.1.9, Node22.23.3: nationell installation + F/G-wire | 69 PASS på efed/ad740, två filer; finalrepris log `/tmp/ediel-fg-6f94-final-components.log`. Inte nativeacceptans. |
| Fixtureportkontroll | Meningsfull RED på efed före ny capture/deferred seam, fyra modeled GREEN på ad740. Databas/ägarsession/persistence är deklarerade modellportar. |
| Fysisk tokenisering/syntax/canonicalpolicy | Fem finite PASS: F/G faktisk UD med sju ignorerade fält; F508/214 och G306 diagnostik. Persistence modellerad. |
| TypeScript app/tests/scripts, scoped fyrafil-ESLint, diffcheck | PASS på ad740. Ny base/type/runtime-delta kräver berörda nya kontroller före sluthead. |
| Frozen register / migrationintegritet | PASS: 33 filer,121 regler,231 kontrakt;1152 migrationsfiler,1055 versionsgrupper/checksums. Inga frozen-/migrationwrites. |
| Genuin native/DB/backends/GEN/originalinsamling | INTE UTFÖRT av detta paket. Inga CI-reruns eller producerstarter. |

Tidigare fryst qualification: `/tmp/ediel-fg-6f94-static-qualification.json`, binder ad740/a377/efed och fyra filhashar. Sourceplan `/tmp/ediel-6f94-fg-proof-plan.md`; finite kontrollkällor `/tmp/ediel-fg-6f94-seam-control.cjs` och `/tmp/ediel-fg-6f94-physical-control.cjs` bevaras lokalt. Dessa är inte genuine whole-ID-underlag.

Låsta471 beroenden installerades med explicit `/tmp`-cache och npmci ignore-scripts; lock/source bevarades. Defaultcache gav först ENOENT. Node22.23.3 används för kontroller, inte miljöns Node24. Stödd nätverksbehörighet med bibehållen proxy gav autentiserad gh/gitåtkomst. En felaktig gitfetch med obefintligt C1-branchnamn rättades till endast faktisk main. Ingen credentialsutskrift eller proxykringgång.

## Avslutad tidigare P2-rättning och granskningshistorik

Följande beskriver den avslutade tidigare rättningen, inte ett aktivt nytt uppdrag.

Oberoende noncoauthor A på ad740: WITH_FIXES, en P2, ingen P1. Rapport `/tmp/ediel-fg-6f94-final-review-a.md`, SHA256 `238bd28ffaf64a086a18847d9e5dcef684308df30fecfe3127222eb40d52c00a`. B:s första SOURCE_APPROVE på samma version är historisk och därefter återtagen för aktiv credit efter egen bekräftelse av samma P2. Rapport `/tmp/ediel-fg-6f94-final-review-b.md`, SHA256 `8baf48b0e6208dd498fdb34c5976ce3f80d29caff306a799af57dbb67ce7f2fd`. Ingen reviewer skrev kod/test/fixture/proof eller körde native.

Orsak: nytt `sourceDisposition:not_established` accepterade även `status:unconfirmed` för snapshot/recorder/timeoutfel. Broad apply-regex tillät orelaterad saknad rule/context-basis. Partyprobes använde captureChange utan intakta change-kontrollens förutsättningar; nolleffekt ensam isolerade inte avsedd fysisk avvisning. Ingen produktbugg styrktes.

Samma skrivare rättar nu exakt dessa negativa orakel: R/D/LI/främmande punkt ska ha faktisk ready context och skyddad regelbasis, recorded source-/canonicalbundna avvisade/held objects med exakt egen cause, samt rätt appliceringsavvisning. Partyprobes ska styrka den verkliga immutable held context-receipten/source/hash/clock och varför egna receiverkandidater saknas, inte generic unconfirmed. Samma captureChange-väg får en intakt positiv kontrast. Ingen skyddad authority seedas. Finite RED/GREEN ska avvisa unconfirmed och orelaterat missingbasisfel. Tidigare rättningsmeddelanden låg köade hos avslutad agent; root startade uttryckligen fixturnen med followup_task, inte genom gammal dispatch.

Efter korrigerad source och rootcheckpoint-frysning behövs två nya oberoende slutgranskningar på den faktiska kompletta headen, inte återanvändning av ad740-approval.

Skrivaren har nu exekverat nya assertion/preparation-helper-ASTs med deklarerade modellportar: 40 PASS. Gamla ad740-oraklen gav fyra avsedda RED. Unconfirmed, missing rule basis, orelaterad context, fel/stale source/canonical/witness/cause samt recorder/capture/basis/reviewfel före approval avvisas; intakt same-capture-förberedelse accepteras. Fysisk kontroll omfattar också verklig saknad226-diagnostik för F/G (sju PASS före sista främmandepunktskontrollen). Främmande punkt har accepted canonical/application med tomma own reasonCodes; det är riktiga structuralreviewerns punktägarkontroll som ska ge unavailable och exact no_qualified_object. Ingen accepted-or-held-headerfallback får ersätta denna orsak. Slutlig source/lint/typefreeze pågår; dessa resultat är finite, inte databas-/nativeproof.

## Source-applicability och samordning

Befintlig serialägare [6146356644](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6146356644) har tagit emot förberett F/G/BRP-scope och routar kvalificerad adoption efter C1/GEN. Ingen native-/PR-/producentöverlämning till oss är utförd. Hans 113 kvalificerade Z02-fall och GEN-outputpeers ger inte automatiskt F/G-acceptans. SOURCE_PREPARED receipt [6146257961](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6146257961) gäller historisk ad740, inte korrigerad slutversion.

Ny read-only applicabilitypeer jämför komponentens importclosure mot PUBLICC1 `2e073477c43c6a133a01710772e65cefc43f6162`/aktuella main95d och PUBLICGEN `8e55b5c2d07be78bf666f1eb51b7a551052b6409`/tree `e43700f0f70c5129b48e267060995f1cfe25458a`. Alla fyra destinationpreimages matchar efed. Sex befintliga C1-runtime/type-closurepaths ändras: inboundProcessing, database.types, customer-operations automation.part2/part3, startSupplierSwitch och actionPreflight. Den nytillkomna importerade supplierSwitchWorkerAuthority tillkommer i destinationens closure. Ny terminal-ACKguard är Z02-only, men code/typequalification ska binda aktuella postimages. GEN har separat runtime-SQL för actor/tenantbehörighet och ediel_messages-triggers; faktisk input/checksum/replay/appliedhistory måste kvalificeras.

C1:s verkliga rawmailpath använder BEGIN/SET LOCAL ROLE service_role före raw/parsebirth och prospektiv daterad TES→SE3/gridmapping. F/G:s ärvda requested-changefixtur använder annan nativeSql/first-receptionväg. Detta är ingen styrkt produktdefekt; C1:s underlag är inte automatiskt applicerbart på F/G:s inputepoch. Slutrapport `/tmp/ediel-fg-6f94-current-source-applicability.md`, SHA256 `b2198e5c9a4e5bfc2deb854f2ebf202bffe680fc7983cbdc9f3fd04cf1538a36`, binder exakta base/source/destinations och fulla pin-/SQL-/inputdeltan samt återupptagningssteg. Public PR795 metadata har flyttat till894b; inga894bsourcebytes/outputs hämtas inom denna snäva audit. Rapporten ger ingen final source- eller nativeapproval; ad740-applicability måste uppdateras efter P2-fixens head.

Kontroll av nästa BRP-komponent visar redan aktiv exakt ägare: [6146015882](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6146015882), receipt `0bcc6ebf659dfc2ec45f74b26eca9000f2db1f5f`, fil `scripts/ediel-z09b-brp-change-native.test.ts`, sole brp_history_writer, mål två effectiveperioder + samma företags syskonrelation + båda physical ACKs. [6146567351](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6146567351) binder f3d96a2a och två SOURCEpeers, native NOT_EXECUTED. Den påhittade z09b-supplier-acceptance-filen finns inte; aktuell BRP-row är PARTIAL. Ingen konkurrerande BRPwrite väljs. Read-only direktGET:175claims/47receipts, inga läsfel; rapport `/tmp/ediel-6f94-next-brp-component-custody.md`, SHA256 `765d3e818576fef213e6c5716b01f238323a3c51502e43408feae5e953fb22f5`.

Aktuell #799 är draftOPEN admin-remediation, head `77b9ab751bb24893d306f8acb2d049811e36bbb0`, baseefed,191paths. Noll fyrafil- eller synlig Ediel/helper-runtimeöverlapp; enda konservativa 712path-F/G-closureöverlapp är generated database.types. Inga fristående API/Adminfel tas här. Senaste kompletta fem öppna PR-pathsets lästes; inga BRP-testfixtureconfigpaths var lediga på grund av PRfrånvaro eftersom0bccreceipt redan äger dem.

Ett separat scoutunderlag för fortsatt arbete efter F/G-handoff har däremot funnit en verkligt ny sourcekomponent: `scripts/ediel-at-z09fg-supplier-composition-native.test.ts` och högst egen `scripts/ediel-at-z09fg-supplier-composition-native.config.ts`. Read-only rapport `/tmp/ediel-6f94-next-z09fg-component-custody.md`, SHA256 `0c43d95cdcf0cac40e8684ea0ac0c4796ecc6ac824d8716a15e3f8cf3a59ef76`: aktuell main95d/fa5, båda ledger-ID NOT_EXECUTED,181claims/50fullreceipts/0GETfel, senaste uttryckliga handoffs och fem kompletta aktuella PR-pathsets gav ingen active/prepared helaZ09FG-kompositionswriter/directoryscope; exakta två nya filrefsGET404. Detta är en kandidat, inte ett claim eller nativeuppdrag. Vår befintliga F/G-helper/sharedconfig3f4, runtimeDecisionC3 och inboundProcessingC1 förblir ägda; endast uttrycklig konsumtion av fryst F/G-source kan vara nästa komponentberoende. Före eventuell nästa write krävs färdig F/G-handoff, ny aktuell scopekontroll och verifierade egna sorted CREATE_IF_ABSENT/GET_MATCH. Ingen tystnad eller saknad ID-/producerref ger bredare auktoritet.

Initial sourcebranch-triggeraudit parsat40workflow-YAMLs: sju pushevents, sex endast main och en browsertempbranch; inga workflow_run/repository_dispatch. Vår egen branch matchar ingen producent/deployAction. Main95d ändrar två workflows; färska slutbranchens triggeraudit behövs före publicering. Detta styrker source-onlycarrier, inte PR/dispatch/native/producer/mainmergeauktoritet.

Separate obesvarade privata publiceringsgodkännanden bevaras. Nekad3193-delete återförsöks inte och kringgås inte; befintlig producerref hålls av ägaren. Pensionerade agenter/pausade automationer (#310) återstartas inte. Verkliga utskick/gallringar/produktion kräver verkligt behörigt underlag. Full privata chattar, secrets eller produktionskunddata skrivs inte i detta minne.

Lästa skillgrupper: cloud runtime, using-superpowers/worktrees/parallel delegation, spec-to-code/code-review/differential/fp-check, systematic-debugging/TDD/verification/requesting-code-review och Supabase/Postgres för databasgränser. Aktuella Supabase17.11-notes lästes; ingen vendor/schema/CLI-uppgradering införs. UI/performance/globala audit/friståendeAPI-Admin ligger utanför denna komponent.

## Rättad source på aktuell main — sista utförda kontroller

Writerfreeze8bb66f/source5217f7cd hade parentad740/baseefed. Efter writerpaus verifierade root alla4livefilrefs mot3f4, main95d och fyra originalpreimageblobs. Rebase onto95d gav ovan codehead d5b70d utan konflikt och fyra byteexakta slutpostbilder. Main95d:s nya inbound/worker/types/workflow/migrationpaths behölls. Detta är samma scoped packet, inte ett nytt slot- eller producentclaim.

Alla relevanta kontroller kördes därefter på faktisk integrerad codehead d5b70d, Node22.23.3: scriptsTSC/fourfilelint,69Vitest,42faktiska helper-AST-kontroller med modellportar,9fysiska syntax/canonical-field/applicationkontroller,4fixtureportkontroller och db:migrations:check inklusive contract/generated-types. Samtliga PASS. OldASTs och F56/G55expect bevarade. Färsk triggeraudit parse41YAML/7push/0chain/0match på egen branch; den nyaZ02workflow och ändradeESCOworkflow innebär inga ownbranchpushstarter. Inga protected accepted facts, runtime-/SQL-/GENändringar, backendkörningar eller ledgerwrites.

Aktuell statisk codequalification (doc-only carrier kan rebindas till samma fyra sourcehashar; ingen nativecredit):

```json
{
  "codeSource": "d5b70dc7a125a1708215fef1c5293bbe7e9483fd",
  "codeTree": "5527b906e736c98c27c335834195a22a358b980e",
  "orderedParents": [
    "53b43f042fe7728996495c19a53dc63a84e82899"
  ],
  "base": "95d8d160491e79b172342654d8dc643346758105",
  "baseTree": "fa5ab60527a40bd642749365fc275d1d4a69e277",
  "receipt": "3f4b1b494ec70bd0217cd935352946416a4d51eb",
  "fourSourceSha256": {
    "scripts/helpers/ediel-z06f-reading-followup-native-fixture.ts": "bb9d77bb25a0d98cecba59ba0b2faa60d306e6b1a4ac3ea35022cf3170119961",
    "scripts/ediel-at-z06f-supplier-acceptance-native.test.ts": "f7b037b6e2d24f4fd4131c5eba11c9098ac5541ef57e71cc5558d5ccdf7eecd8",
    "scripts/ediel-at-z06g-supplier-acceptance-native.test.ts": "baa6bb3e2fa811c49aebbebcf2ae0ac17f5210dc310f57d897af63c51d6222a9",
    "scripts/ediel-source-owner-native.config.ts": "7350c100a0587a8dc3ea964bac2aef1df3bfcc38c8825c768f4cb84739327087"
  },
  "verification": {
    "node": "22.23.3",
    "scriptsTypecheck": "PASS",
    "exactFourFileEslint": "PASS",
    "componentVitest": "69 PASS",
    "actualNewOracleASTModeledPorts": "42 PASS",
    "actualPhysicalPolicyApplicationProjection": "9 PASS",
    "modeledFixturePorts": "4 PASS",
    "retainedCompleteOldTestAndHelperASTs": "PASS",
    "migrationContractGeneratedTypeIntegrity": "PASS on current95d prefix; no database/replay proof",
    "sourceBranchWorkflowAudit": "41 YAML/7 push/0 chain/0 ownbranchmatch"
  },
  "logSha256": {
    "/tmp/ediel-fg-6f94-main95d-scripts-typecheck.log": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "/tmp/ediel-fg-6f94-main95d-lint.log": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "/tmp/ediel-fg-6f94-main95d-components.log": "1ffb2707f032f2eaeba0e601a8b8c7af9fe7b6076c9f50bbcd7cd06f8cafb4a1",
    "/tmp/ediel-fg-6f94-main95d-refusal-oracles.log": "d16b4004900c8796745ece49fbc3241f228e7d35d709cff49a801f23d9386441",
    "/tmp/ediel-fg-6f94-main95d-physical.log": "8ff33629cdd8334df96a2f0c0439e1bb063a22a1f84143ba799aeac96522fb8f",
    "/tmp/ediel-fg-6f94-main95d-seams.log": "4eed7049c140a78f141ce8d00c0ea0bd63592ef3434f9441e317ffcd502c1b80",
    "/tmp/ediel-fg-6f94-main95d-migration-integrity.log": "971c9eeb5dfa0fdbe88e868157744ac3b6ff9f1d79298432e847b3ba99c0e647"
  },
  "nativeExecution": "NOT_RUN",
  "wholeIdCredit": false,
  "mandatoryCurrentNativeCi": "NOT_STARTED_BY_THIS_PACKET; existing qualified producer and serial owner required",
  "reviewStatus": "TWO_OTHER_FINAL_REVIEWERS_PENDING_ON_CODE_PLUS_THIS_CHECKPOINT_CARRIER"
}
```

Nödvändiga lokala kontrollkällor och originalresultat bevaras. P2-qualification `/tmp/ediel-fg-6f94-p2-qualification.json` binder tidigare writerfreeze och full control-artifacthashar; rootqualification ovan binder ny main/source och resultathashar. Sourceapplicabilityrapportb2198 är audit av tidigare4postbilder/deps; efter P2 är helper/config och hela destinationdependencydelta oförändrade, de två nya testoraklen kräver färsk slutreview och deras faktiska controllers har nu exekverats på95d. Ingen tidigare source- eller nativeapproval återetiketteras.

## Frysta ordagranna krav för komponenten

Detta är sourceförberedelse och lokal komponentverifiering. Nedan frysta whole-kontraktskrav är inte styrkta av ej utförda nativefall. Frozenstatus är historisk; godkändstatus räknas enbart från aktuell ledger. Inga nya rule-/contractapprovals tas här.

```json
[
  {
    "id": "AT-Z06F-SUPPLIER",
    "name": "Meddelandefall Z06F",
    "given": "SUPPLIER; Z06E utanför fastställd standardlivshändelse kräver bilateral grund. Z06F/G får inte skriva kundidentitet från förbjuden NAD+UD.",
    "when": "Nätägarens kund-/anläggningsuppdatering.",
    "expected": "23-DDQ-PRODAT; BGM=Z06; fält223=E64; CONTRL och APERAK enligt guide; ytterligare UTILTS för F enligt ändring och Handbok.; Versionera struktur och avläsningsutlösande ändring; kontrollera berörda mätvärdesförväntningar.",
    "prohibited": "Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.",
    "rule_ids": [
      "TEN-05",
      "P-01",
      "ENV-06"
    ],
    "layer": "Planerat meddelande-/rollprov",
    "execution_status": "Inte körd mot systemet",
    "evidence": ""
  },
  {
    "id": "AT-Z06G-SUPPLIER",
    "name": "Meddelandefall Z06G",
    "given": "SUPPLIER; Z06E utanför fastställd standardlivshändelse kräver bilateral grund. Z06F/G får inte skriva kundidentitet från förbjuden NAD+UD.",
    "when": "Nätägarens kund-/anläggningsuppdatering.",
    "expected": "23-DDQ-PRODAT; BGM=Z06; fält223=E32; CONTRL och APERAK enligt guide; ytterligare UTILTS för F enligt ändring och Handbok.; Versionera ändrad struktur utan att påhittad avläsning krävs.",
    "prohibited": "Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.",
    "rule_ids": [
      "TEN-05",
      "P-01",
      "ENV-06"
    ],
    "layer": "Planerat meddelande-/rollprov",
    "execution_status": "Inte körd mot systemet",
    "evidence": ""
  }
]
```

Regelberoenden, oförändrade ordagranna frysta objekt:

```json
[
  {
    "id": "TEN-05",
    "area": "Separata verksamhetsroller",
    "kind": "Ediel/Handbok",
    "applies_to": "Aktör både DDQ och DGI",
    "trigger": "Varje affärshändelse",
    "condition": "Roll bestäms av affärsprocess, inte globalt standardfält.",
    "on_pass": "23-DDQ-PRODAT för leverantörsprocess;23-DGI-PRODAT för tillståndsprocess.",
    "on_failure": "Z14 får inte aktivera leverans; Z04 ger inte generellt ESCO-tillstånd.",
    "callsite_owner": "policy context / prodat application reference",
    "source": "T §5.2.3; P §2.1; SYS",
    "activation_gate": "Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.",
    "implementation_status": "Ej verifierad",
    "test_id": "AT-TEN-05"
  },
  {
    "id": "ENV-06",
    "area": "Meddelandeprofil",
    "kind": "Ediel/Handbok",
    "applies_to": "PRODAT",
    "trigger": "BGM/CCI byggs",
    "condition": "BGM bär Z-funktion utan suffix; CCI Z13/CAV bär treteckenskod för undertyp.",
    "on_pass": "Z03 + Z22 betyder Z03L, inte BGM+Z03L.",
    "on_failure": "Avvisa fel kombination på rätt kontrollnivå.",
    "callsite_owner": "profileRenderer / subtypeRegistry",
    "source": "P §2.1,2.6",
    "activation_gate": "Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.",
    "implementation_status": "Ej verifierad",
    "test_id": "AT-ENV-06"
  },
  {
    "id": "P-01",
    "area": "PRODAT-fält",
    "kind": "Ediel/Handbok",
    "applies_to": "Alla P",
    "trigger": "Fältkontroll",
    "condition": "74 numeriska fält +3 parentgrupper;110bas-D-celler och registeroverlay hanteras uttryckligt.",
    "on_pass": "Fältresultat bär riktigt fältnummer, grupp/komponent, objekt/ärende och källregel.",
    "on_failure": "Inget fältnummer från regex över DTM/RFF-text.",
    "callsite_owner": "fieldMatrix / canonicalPolicyFieldValidator",
    "source": "P §2.2,2.6,3.3",
    "activation_gate": "Implementering och beteendeprov krävs; inte produktionsgodkänt av detta dokument.",
    "implementation_status": "Ej verifierad",
    "test_id": "AT-P-01"
  }
]
```

## Oberoende slutgranskningar och bevarade original

A och B granskade var för sig exakt carrier `048aeddf15e805f43dc9bf6b7297466d20a23497`, tree `8a9340b8e2300292cc137409afb56572d20acbef`, ordered parent `[d5b70dc7a125a1708215fef1c5293bbe7e9483fd]`, base `95d8d160491e79b172342654d8dc643346758105`/tree `fa5ab60527a40bd642749365fc275d1d4a69e277`. Båda SOURCE_APPROVE utan återstående P1/P2. De medförfattade ingen code/test/fixture/proof/GEN; ingen reviewer körde våra kontroller eller native. Denna doc-only komplettering bevarar originalrapporter och kontrollkällor; båda ska uttryckligen kvalificera oförändrade sourcehashar samt detta nya checkpoint på slutcarrier. Tekniskt #766-kvitto binder den därefter faktiska fulla slutheaden/tree/ordered parents.

| Reviewer | Originalrapport SHA256 | Resultat |
| --- | --- | --- |
| /root/fg_final_review_a | d156b9be3e9468d6b8bfc17cb60ab80251d03899444fce96f67331bab3808bb0 | SOURCE_APPROVE; P2 rättad; native12 NOT_RUN |
| /root/fg_final_review_b | 343e8c15870d7fd0a0ebb621d015667f8b88a91e4777188f7f9b95941e54d432 | SOURCE_APPROVE; P2 rättad; native12 NOT_RUN |

<details>
<summary>Oändrad originalrapport A för carrier048aeddf; SHA256 d156b9be3e9468d6b8bfc17cb60ab80251d03899444fce96f67331bab3808bb0</summary>

# Independent final five-file SOURCE review A — 048aeddf

**Verdict: SOURCE_APPROVE / SOURCE_ONLY_PASS for the complete five-file carrier below. No remaining P1/P2 source finding.** The prior negative-oracle P2 is resolved. This verdict establishes neither native execution, whole-ID acceptance nor merge readiness.

Reviewer `/root/fg_final_review_a` is an independent noncoauthor. I authored or changed none of the implementation, tests, fixtures, modeled qualification controls, native proofs or GEN outputs. I did not consult or coordinate with final reviewer B. Only this review file was written. The original ad740 report remains immutable; independently rechecked SHA256 `238bd28ffaf64a086a18847d9e5dcef684308df30fecfe3127222eb40d52c00a`.

## Exact full-source binding

| Binding | Verified value |
| --- | --- |
| Checkout | `/workspace/ediel-fg-proof-20261013-6f94` |
| Complete source carrier | `048aeddf15e805f43dc9bf6b7297466d20a23497` |
| Complete carrier tree | `8a9340b8e2300292cc137409afb56572d20acbef` |
| Ordered parents | `[d5b70dc7a125a1708215fef1c5293bbe7e9483fd]` |
| Actual-main base supplied by root, locally verified exact object | `95d8d160491e79b172342654d8dc643346758105` |
| Base tree | `fa5ab60527a40bd642749365fc275d1d4a69e277` |
| Four-file code parent/tree | `d5b70dc7a125a1708215fef1c5293bbe7e9483fd` / `5527b906e736c98c27c335834195a22a358b980e` |
| Five-file `git diff --no-ext-diff BASE HEAD -- PATHS` SHA256 | `4b8abd91ae271c055fba436dbca04b21e8f80d8198b8d76f9b986549af4fc555` |

| Entire reviewed file | Source-head SHA256 | Git blob |
| --- | --- | --- |
| `scripts/helpers/ediel-z06f-reading-followup-native-fixture.ts` | `bb9d77bb25a0d98cecba59ba0b2faa60d306e6b1a4ac3ea35022cf3170119961` | `d738cb863d753bf1f95d13269fa17bdb3b2c22b8` |
| `scripts/ediel-at-z06f-supplier-acceptance-native.test.ts` | `f7b037b6e2d24f4fd4131c5eba11c9098ac5541ef57e71cc5558d5ccdf7eecd8` | `11dd2286143406ff536d37f41c8a7b27bceee030` |
| `scripts/ediel-at-z06g-supplier-acceptance-native.test.ts` | `baa6bb3e2fa811c49aebbebcf2ae0ac17f5210dc310f57d897af63c51d6222a9` | `d28e22d623dc90f65bf817461f7fab91f63929f5` |
| `scripts/ediel-source-owner-native.config.ts` | `7350c100a0587a8dc3ea964bac2aef1df3bfcc38c8825c768f4cb84739327087` | `24df87ffb55ec37e22764beca99e2b4126af39fc` |
| `.agent-memory/ediel-fg-proof-20261013-6f94-checkpoint.md` | `3c583e2f1d5cf134cbf10e6c6ffefae7d7ffa485fc7a21235f751fc1e71ab4aa` | `b7fc4d8e50ae2326b3fbdc22900f7fe415f23cbb` |

All four source files match the code parent byte for byte. Diff against exact current base contains only these four source paths and the unique checkpoint; current-main foreign paths are preserved. Working tree is tracked-clean. Custody remains the supplied helper receipt `3f4b1b494ec70bd0217cd935352946416a4d51eb`, IDs EMPTY, sole source writer `/root/z06fg_requirements`, followed by root's explicit integration/checkpoint handoff. No custody or producer role was acquired in this review.

## Requirements, skills and review coverage

Read the complete five-file source/diff, active operating/memory/workflow rules and relevant frozen requirements. AGENTS and active routing memory are unchanged from the earlier reviewed base; their instructions remain applicable. Reused code-review, differential-review, find-bugs, reviewer-template, direct false-positive verification, verification-before-completion and Supabase/Postgres guidance. This is bounded source review; UI/performance, dependency upgrades, schema remediation, broad scanners and implementation/producer workflows have no trigger here.

Frozen AT-Z06F-SUPPLIER / AT-Z06G-SUPPLIER require supplier/DDQ, BGM Z06, E64/E32, guide ACKs, versioned structure, F reading follow-up versus G no invented reading, ignored physical UD/customer identity preservation, and refusals for roles/direction/R-D/correlation/mutation. Supporting TEN-05/P-01/ENV-06 and incoming-ignore P-02/SC-031 remain authoritative. Independently compared the checkpoint's entire acceptance/rule JSON blocks to the frozen registers: exact matches.

Unchanged register hashes: rules `48e5a0608107b01719152cf2a50bfe5fce083381cd66a6c64eb5f5d999cb8fd8`; acceptance `e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10`. Coverage `4a1560a0b16ae37d68aa30c5f67ef616a516c5306e29edf4269b7b1fa9fea850` is unchanged versus base and ad740; independently counted 119 VERIFIED + 201 PASSED = 320. Both F/G rows remain NOT_EXECUTED.

Read current caller/sink paths for admission/stamping, canonical/ignored/application facet binding, original structural review and source-owner persistence, inbound/case approval, safe apply, protected structural effect/final ACK/outbox and reading persistence/observation. Reviewed installed source definitions for context capture/require, rule receipts, object availability witnesses and structural/reading SQL11232/42609/44958/51410/110500. The new SQL projections match the actual column names, unique source/witness relations and immutable ledger shapes.

Retained original authority is P26.A incoming-ignore and frozen F/E64/G/E32 source guidance. Current wire uses existing field306 Z12, with canonical Z11/Z12 allowed values; this packet does not recreate the older correction. Original PDF bytes were not fetched, rehashed or inspected; retained recorded P PDF provenance remains `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`, with that availability limitation preserved.

## Strengths and P2 resolution

1. **Recorded negatives now exclude generic incidents.** F289–325 / G288–324 require `status:recorded`, exact zero-accepted/rejected-or-held counts, ready original context, real protected rule basis, latest canonical/application/object assessment identity and hashes, actual availability witness, physical UNH/LIN/LI and own cause. Missing fields508/214/306/226 must be typed national own failures with accepted header/rejected own application. The apply assertion now requires exactly `structural_apply_no_qualified_object`; unrelated missing-basis/context errors fail.
2. **Foreign-point causality is explicit.** F496–508 / G477–489 require an actual foreign point, no matching own tenant point, intact accepted canonical/application member with empty own reason codes, then a recorded unavailable own object with `structural_review_owner_unavailable`. Generic recorder/snapshot/witness fallback cannot satisfy this oracle. The actual reviewer reaches `findStructuralReviewPoint` before later party/supply review; its absent own point is a sufficient concrete hold.
3. **Party refusal is checked at its legitimate earlier boundary.** F327–332, 475–484 / G326–331, 456–465 require the INSERT-captured immutable held context, exact source/company/environment/direction/hash/receipt clock, exact `ediel_inbound_legal_context_required`, empty context and zero dated own legal-receiver candidates. That matches SQL context derivation's legal-tenant candidate check. No generic `unconfirmed` review result, missing-rule failure or fabricated composition replaces this actual cause.
4. **The positive contrast now uses the same capture path.** F334–342,491 / G333–341,472 consume `captureChange`, require ready context, perform real canonical recording, capture/require genuine named basis and require recorded accepted review. Recorder/capture/require/review failure stops before approval. Intake subsequently runs and `pendingFirstApplication` refreshes the actual structural review AFTER its new canonical session and before first effect.
5. **Existing behavior and meaningful guards remain.** Independently checked exact bytes of both old complete tests and all five old assertion helpers in each file: unchanged. Because the entire executable blocks are byte-identical, their previously checked AST identity is preserved; all 56 F / 55 G `expect` calls remain. Current-base originals also match efed originals. Fixture default immediate apply, unchanged reading path, optional admission/raw/defer seam and UNT recount preserve the earlier reviewed implementation.
6. **Prepared first-effect assertions remain substantive.** Tests require empty own effects before approval, one real source/object/hash/date/assessment-bound structural receipt and batch after approval, unchanged original/market snapshots, own physical guide ACK/outbox correlation and immutable replay. Physical UD is retained in the original and bound to ignored parent/children/own source occurrence. F requires its own pending expectation and actual accepted E66 persistence observation before read reconciliation; G requires no expectation/observation and explicit not-required status. SMTP remains a declared synthetic external port, not transport trust evidence.
7. **Configuration and checkpoint are accurate for this scope.** Only the two includes are added; mandatory loopback/key gate, all prior includes/setup, 120s timeouts and serial files are retained. Checkpoint distinguishes historical ad740 review, corrected writer/current-main code qualification, pending final carrier reviews, source/environment applicability and existing owner routing. It does not promote coverage, assert native execution or borrow C1/GEN counts as F/G evidence.

## Current-main applicability and qualification limits

Read supplied source-applicability report SHA256 `b2198e5c9a4e5bfc2deb854f2ebf202bffe680fc7983cbdc9f3fd04cf1538a36`. Its ad740 binding is used only for expressly unchanged dependencies/preimages, not amended-source approval or native results. Independently inspected efed→95d inbound delta: new retained-positive replay returns false for every code other than Z02 and does not bypass F/G. Current worker/type/import changes remain preserved. The inherited requested-change/normal-switch fixture directly prepares/sends Z03 and establishes Z04 through its own source/business owner; merely importing worker modules is not worker execution proof.

Public GEN8e55 versus later #795 metadata894b and actual applied SQL/generated/output epochs remain separately qualified by their existing owner. No 894b source or output was fetched or inferred. Raw-mail service-session/custody branch, dated grid reference input, source clocks, catalog/permission epoch and initialized SQL/replay applicability remain genuine producer requirements; they are not demonstrated by byte-identical helpers or source review.

Read current-code qualification JSON, SHA256 `ff3c0ae4b09efec754ad48afdaf8e20ecc77a6a4487696dd23933e1ba103016c`, and P2 qualification JSON, SHA256 `9120ed01d0bb2ce29dc20919a4b0be22417c44503ca466601666dd6f430a9d89`. Four hashes match this carrier/code parent. Root/writer report current-main 42 modeled assertion/preparer controls, 9 physical policy/application controls, 4 modeled fixture-port controls, 69 component Vitest cases, scripts TypeScript/lint and migration/contract/generated-type integrity PASS. I did not execute or rerun those controls and did not collect their logs/artifacts. These reported finite/component checks are expressly modeled or source checks; none is native DB acceptance or mandatory current CI.

Read-only Git/JSON/hash/source comparisons in this review verified identities, preserved bytes and frozen literals. No test body, qualification control, application source, nativeSql/psql, backend, Docker, GEN, original/log/artifact or CI action was executed. No provider/remote ref/PR/publication/merge action occurred; checkout/index/HEAD are unchanged.

## Issues and assessment

**Critical/P1: none. Important/P2: none remaining. Minor: no style-only gate.** The historical P2 is source-resolved by distinct recorded/context/cause oracles and the corrected capture-path positive contrast. No new production security defect is established in this test/fixture/config/checkpoint-only diff.

**Complete five-file SOURCE_APPROVE** applies only to `048aeddf15e805f43dc9bf6b7297466d20a23497` / `8a9340b8e2300292cc137409afb56572d20acbef` against the exact95d base above. Source/drift changes require affected re-review; this is not blanket approval of later C1, GEN, #795 or other work.

**Native12: NOT_RUN. Whole-ID/CI/merge credit: none.** Genuine native/backend/original and installed SQL/environment qualification, mandatory current native/CI output and normal delivery remain with the existing qualified sole producer and serial delivery owner. No duplicate producer, authority seeding, blind CI rerun or generic LIVE/market-activation gate is introduced by this source verdict.

**Ready to merge? Not assessed.** The source component and checkpoint are suitable for the authorized source handoff; actual runtime/full-effect and current delivery gates remain separate. Review complete; pause pending a genuinely changed source or a new bounded reviewer request.

</details>

<details>
<summary>Oändrad originalrapport B för carrier048aeddf; SHA256 343e8c15870d7fd0a0ebb621d015667f8b88a91e4777188f7f9b95941e54d432</summary>

# Independent final whole-version source review B

**SOURCE_APPROVE** for the exact five-file carrier below. No source must-fix remains confirmed. The previous refusal-oracle P2 is resolved in this source version. This is a new independent assessment of the complete current version; the earlier ad740 approval remains historical and supplies no approval credit here.

Reviewer `/root/fg_final_review_b` is a noncoauthor of source, tests, fixtures, proof and GEN output. I did not coordinate findings with reviewer A. I wrote only this `/tmp` review report and executed no tests, proof controls, native/backend/GEN/CI operations, remote fetches, originals/log/artifact collection, repository/ref mutation, PR or publication operation.

## Exact identity

| Identity | Value |
| --- | --- |
| Workspace | `/workspace/ediel-fg-proof-20261013-6f94` |
| Final carrier source | `048aeddf15e805f43dc9bf6b7297466d20a23497` |
| Final carrier tree | `8a9340b8e2300292cc137409afb56572d20acbef` |
| Ordered parent | `[d5b70dc7a125a1708215fef1c5293bbe7e9483fd]` |
| Current actual-main base | `95d8d160491e79b172342654d8dc643346758105` |
| Base tree | `fa5ab60527a40bd642749365fc275d1d4a69e277` |
| Code parent tree | `5527b906e736c98c27c335834195a22a358b980e` |
| Code parent ordered parent | `[53b43f042fe7728996495c19a53dc63a84e82899]` |
| First rebased code commit parent | `[95d8d160491e79b172342654d8dc643346758105]` |

I verified these committed-object identities locally. Actual base95d has ordered parents `[efed3683115c06d1925f8b80c05c801a54db9885,2e073477c43c6a133a01710772e65cefc43f6162]`. The exact base-to-carrier diff contains only the four source paths and the own checkpoint: 879 insertions, 27 deletions. The tracked worktree was clean, and the read source bytes matched the exact commit.

| Entire reviewed file | SHA256 |
| --- | --- |
| `scripts/helpers/ediel-z06f-reading-followup-native-fixture.ts` | `bb9d77bb25a0d98cecba59ba0b2faa60d306e6b1a4ac3ea35022cf3170119961` |
| `scripts/ediel-at-z06f-supplier-acceptance-native.test.ts` | `f7b037b6e2d24f4fd4131c5eba11c9098ac5541ef57e71cc5558d5ccdf7eecd8` |
| `scripts/ediel-at-z06g-supplier-acceptance-native.test.ts` | `baa6bb3e2fa811c49aebbebcf2ae0ac17f5210dc310f57d897af63c51d6222a9` |
| `scripts/ediel-source-owner-native.config.ts` | `7350c100a0587a8dc3ea964bac2aef1df3bfcc38c8825c768f4cb84739327087` |
| `.agent-memory/ediel-fg-proof-20261013-6f94-checkpoint.md` | `3c583e2f1d5cf134cbf10e6c6ffefae7d7ffa485fc7a21235f751fc1e71ab4aa` |

Custody remains the parent's separately authenticated receipt `3f4b1b494ec70bd0217cd935352946416a4d51eb`, helper metadata/idsEMPTY/exact four source file resources. The own unique checkpoint is the fifth carrier file. Root supplied refreshed four-resource GET_MATCH and current-main preimage matching before rebase. This source review does not independently authenticate remote refs, assign any new writer/producer, or grant publication/merge authority.

## Requirements and current dependency applicability

Re-read the actual frozen F/G contract objects from this exact commit, plus TEN-05/P-01/ENV-06. The requirements still specify supplier DDQ/Z06/E64 or E32, guide CONTRL/APERAK, actual structure versioning, F reading follow-up, G without invented readings, forbidden physical UD not changing customer identity, and refusal of wrong roles/direction, missing applicable R/D fields, bad correlation and mutation.

- `acceptance_tests.json`: SHA256 `e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10`.
- `rules.json`: SHA256 `48e5a0608107b01719152cf2a50bfe5fce083381cd66a6c64eb5f5d999cb8fd8`.
- `coverage.json`: SHA256 `4a1560a0b16ae37d68aa30c5f67ef616a516c5306e29edf4269b7b1fa9fea850`; F/G remain **NOT_EXECUTED**, empty evidence. No ledger or frozen object was changed.

Current-start/workflow/reservations were re-read. AGENTS and the previously read active memory entry/state/task/checkpoint/handover/blocker/plan/decision/failure files were independently verified byte-unchanged. The applicable narrow code-review/differential/find-bugs/contract-review/verification and Supabase/Postgres routing is preserved. Repository-wide audit/scanning, UI, performance, hook, implementation and runtime workflows are outside the assigned source-review scope.

The current main delta was inspected explicitly. `inboundProcessing.ts` adds `hasRetainedPositiveZ02Protocol`, whose first guard returns false unless the source is inbound EDIFACT PRODAT **Z02**; the new early-return call therefore does not select F/G. Other inherited code changes preserve Z02 job results and introduce a separately authorized supplier-switch worker path while retaining the normal public start path. Those changes are inherited from actual main, not overwritten by the packet. The generated types and SQL/migration prefix changes require current producer/environment qualification; old GEN/native results cannot be relabeled as this packet's runtime proof.

I independently compared the previously read relevant canonical validation/ledger, source-owner/review/persistence/wire, case/safe-apply, final-response/ACK/atomic gateway/outbox, UTILTS persistence, field/UD ownership, native fixture/wire dependencies and structural/follow-up/immutability migrations against the new exact source. Those reviewed dependency bytes are unchanged. Reusing those exact source readings preserves their applicability; it is not reuse of the earlier approval. Newly used source-rule basis, application-object read, structural point read and context/rule/witness SQL definitions were read directly for the new refusal oracles.

## Whole-version behavior assessment

**Original admission and first application.** Helper lines 27–79 preserve the existing immediate-apply default and add pre-admission raw transformation/direction and opt-in deferred apply. Recount validates the single UNH/UNT pair and reference; physical edits, UNT correction and interchange stamping happen before fresh source insertion. `captureChange` supplies input only. Actual canonical validation, immutable validation recording, named source-rule capture, one-use owner finish and explicit review remain real. No accepted private source/effect/status, permission key, grant, issuer mandate or original-capture receipt is added to make the tests pass.

F lines 227–230 and G lines 226–229 perform explicit review **after** actual intake/owner finish and before case approval. This avoids relying on an earlier reviewed owner after the processor has recorded a fresh canonical assessment/unestablished F/G owner. Real approval calls the tenant/actor guard and safe-apply RPC, which checks original inbound direction, current exact canonical/application/object assessment, requested physical LIN, reviewed business/party proof and locked original point/site/supply.

**First structural effect and UD.** F lines 392–429 and G lines 391–428 assert no source-specific object/batch/reading effect or positive APERAK before approval, then actual one-object and one-batch persistence. The tests bind source/company/environment/actor/hash, own object/agency/LIN/register, point/site, E64/E32 business case, independently derived effective instant and original received instant. The SQL's `first_line_index`, `object_scope`, `sourceRegisters.register.segmentIndex`, physical token arrays, assessment UUIDs and batch `result` match these oracles.

The physical forbidden UD branches verify original bytes are retained, actual ignored facets and independent hashes exist, all seven P119 own field occurrences bind the actual object/register/message/LI/customer token, and customer/site/point/supply/contract/series/graph/non-ACK outbound market rows remain unchanged. Structure is versioned in the protected dated source ledger; neither a parsed UD token nor mutable row metadata can supply the asserted private original/facet evidence.

**F versus G readings.** Source-owned SQL triggers derive F expectations only from real immutable applied structure. F asserts the own register101/meter/METHOD/hash and pending no-deadline/no-auto-request contract. Its intact first-case branch calls the retained real E66 canonical, qualification, consumption preparation and persistence chain. It reads the private accepted observation immediately after persistence, before reconciliation, tying actual transaction/source hash and original register quantities. Subsequent read status and persistence replay are checked. The actual persist SQL invokes the accepted-history observer after storage; the read's separate reconciliation cannot by itself satisfy this test. G asserts empty expectations/observations and actual `not_required_by_this_change`; G invokes no reading producer.

**ACK/outbox.** Approval uses real committed effects to read the protected final response, derive the opaque renderer qualification, originate/replay real canonical atomic ACKs and create/reuse actual outbox rows. The native final-response SQL requires committed immutable own receipts, matching hash/time/assessments, original guide and own id/LI before ERC100. Tests independently check physical syntax, reversed original parties, CONTRL interchange correlation, APERAK BGM/object/agency/LIN/LI/positive ERC, and precisely one source-bound outbox row per ACK. Replay checks preserve effects, original ACK identities/outboxes/events and SMTP count. Nodemailer is the declared mocked external boundary; no actual counterparty delivery is claimed.

## Previous P2: independently resolved

The prior version's generic `not_established` plus broad refusal regex could accept unconfirmed recorder/snapshot/witness failures or unrelated missing prerequisites. I previously confirmed that gap; this new verdict depends on the following actual repairs.

| Probe | Current source checks and why the prior false acceptance is blocked |
| --- | --- |
| F R508/D214 and F/G missing LI226; G R306 | F 463–474 / G 444–455 require an actual missing-field diagnostic and rejected own application, real processing, successful `requireEdielSourceRulePackEvidence`, non-null protected application read, then `expectRecordedOwnRefusal`. The latter requires **recorded** review/object counts, real ready context/rule receipt, exact source/hash/canonical/assessment/witness identities and hashes, original physical scope, cause in both own assessment and application. Apply must fail exactly `structural_apply_no_qualified_object`. Unconfirmed/stale/missing-basis/wrong-cause outcomes cannot satisfy those assertions. |
| Reversed roles / legal receiver mismatch | F 475–484 / G 456–465 check actual transformed physical parties and `expectPhysicalContextRefusal`: genuine source-INSERT receipt, own source/company/environment/direction/hash/clock, **held**, exact `ediel_inbound_legal_context_required`, empty context, and zero own receiver candidates at that original observed instant. Apply must fail exactly the context guard. No unconfirmed structural review or missing-rule fallback is used. SQL derive lines 63–69 selects physical DO and requires one matching own tenant candidate; the asserted zero-own-receiver fact proves the concrete failed precondition. |
| Foreign physical point | F 498–508 / G 479–489 require the real protected rule basis, **recorded** unavailable own source assessment/witness, ready own supplier context, accepted canonical/application with empty own reason codes, zero own tenant point and existence of the actual foreign point. Apply must fail exactly `structural_apply_no_qualified_object`. `findStructuralReviewPoint` is tenant-scoped and requires exactly one own point; an unrelated missing recorder/basis/context cannot satisfy the complete tuple. |
| Intact contrast | F 491 / G 472 now use the **same captureChange path** and actual `prepareCapturedControl`: ready source context, actual accepted canonical invocation, actual recorded validation, actual captured and required named basis, actual recorded accepted review, then actual intake and fresh post-intake review before first case approval. No protected acceptance row is seeded. |

The refusal SQL queries target actual `gridex_ediel_inbound_context.receipts`, `gridex_ediel_source_rules.receipts`, validation/object assessment and `object_availability_witnesses` columns. Rule capture is permitted for a committed immutable canonical assessment with the correct named rule-pack evidence; it does not require the own application to be accepted. Thus a rejected own R/D/LI object can legitimately possess ready context and actual source-rule basis without seeding acceptance. Availability is a separately committed witnessed composition, not a status marker supplied by the test.

The source-only direction probe remains specifically the unqualified outbound INSERT guard (`canonical_ediel_route_required`), without invented valid route/source-operation authority. The mutation probe attempts an actual changed METER token on a sealed deferred original and requires the real immutability error plus stable own/foreign evidence. The retained tenant/actor/graph/LIN/revoked-permission controls remain intact.

## Preservation and checkpoint

Independent static exact-base comparisons confirmed the complete retained already-applied test bodies and all five existing assertion helpers are byte-for-byte unchanged in both files. Helper default/reused E66 behavior remains intact. Config changes consist only of the two F/G includes; strict loopback URL/key gating, all old includes, permission setup, both 120-second timeouts and serial file execution are preserved.

The entire 230-line own checkpoint was reviewed. It accurately separates historical ad740 results/retracted active approval, corrected current code/base/parents, source-only finite verification, and pending native/current mandatory CI/producer routing. The literal F/G and dependency rule objects match the frozen register. It does not promote a ledger row, turn scout metadata into a new claim, assign another producer, revive retired agents/#310, or treat unanswered publication approval as consent. Supplied authenticated custody and external qualification claims remain attributed to their owners rather than independently authenticated by this reviewer.

## Limits and final gate

The parent reports current95d/code d5 validation: 69 component Vitest cases, 42 actual assertion/preparer controls with modeled ports, nine finite physical/policy/application controls, four modeled fixture seams, scripts typecheck, lint and migration/generated-type integrity PASS. I did not execute or collect those proof artifacts, and this review does not attest their native/runtime outcome. The checkpoint explicitly preserves their finite scope.

**Twelve genuine native cases remain NOT_RUN. Both F/G ledger rows remain NOT_EXECUTED. Mandatory current CI, actual producer/environment/GEN/schema/input-epoch qualification, counterparty/transport authority and ordinary authenticated serial delivery remain pending separate gates. No whole-ID, main, CI, genuine SQL/runtime, provider or market credit is granted by SOURCE_APPROVE.** Any code, test, fixture, checkpoint, dependency or source/base change requires affected qualification and exact-version review binding. This reviewer now pauses after the final report.

</details>

De följande originalkontrollerna är enbart finite orakel/fixtur/policyverifiering med deklarerade modellportar. De skapar ingen genuine native/DB/GEN-/provider-/marknadsauktoritet och får inte markera ett whole-ID som godkänt. Paths i källorna är lokala reproduktionspaths, inte outputadresser. Bevarade källhashar matchar writerqualification8bb66f; dessa oförändrade källor exekverades därefter på rebased95d-kodsource d5b70d, med42+9+4 PASS enligt logghasharna ovan. Historiska RED-källan avser ad740 och återkörs inte som ett nytt godkännande.

<details>
<summary>Finite originalkontroll ediel-fg-6f94-refusal-oracle-control.cjs; SHA256 8f4ef9e2342c497d1ec850fc734c0a520a84695d0a38494b0eece5fe511ec084</summary>

```javascript
// Historical ad740 actual-oracle AST RED controls. Declared modeled receipts/inputs only; native NOT_RUN.
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm'),root='/workspace/ediel-fg-proof-20261013-6f94',ts=require(root+'/node_modules/typescript')
const pass=(actual,expected)=>{if(expected&&typeof expected==='object'){for(const[k,v]of Object.entries(expected))pass(actual?.[k],v)}else assert.deepEqual(actual,expected)}
function expect(actual){return{toBe:expected=>assert.equal(actual,expected),toEqual:expected=>assert.deepEqual(actual,expected),toMatchObject:expected=>pass(actual,expected),toHaveLength:expected=>assert.equal(actual.length,expected),toContain:expected=>assert.ok(actual.includes(expected)),toMatch:expected=>assert.match(actual,expected),toBeGreaterThanOrEqual:expected=>assert.ok(actual>=expected),not:{toBeNull:()=>assert.notEqual(actual,null)}}}
let failures=0
for(const kind of ['f','g']){
 const source=fs.readFileSync(`/tmp/ediel-fg-6f94-${kind}-ad740.ts`,'utf8'),ast=ts.createSourceFile('oracle.ts',source,ts.ScriptTarget.Latest,true)
 const found=[];function visit(n){if(ts.isExpressionStatement(n)&&n.getText(ast).trim().startsWith('expect(review.sourceDisposition'))found.push(n);ts.forEachChild(n,visit)}visit(ast)
 const code=ts.transpileModule(found[0].getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,oldOracle=new Function('review','probe','expect',code)
 const matches=source.match(/\.rejects\.toThrow\((\/\^\(structural_apply_[^\n]+?\/)\)/)
 const allowed=vm.runInThisContext(matches[1])
 for(const[name,test]of[
  ['unconfirmed review must fail',()=>assert.throws(()=>oldOracle({status:'unconfirmed',sourceDisposition:'not_established'},{name:'modeled faulty recorder'},expect))],
  ['missing rule/context prerequisite must not prove physical malformed source',()=>{assert.equal(allowed.test('ediel_source_rule_pack_basis_required'),false);assert.equal(allowed.test('ediel_inbound_legal_context_required'),false)}],
 ])try{test();console.log('PASS MODELED '+kind+' '+name)}catch{failures++;console.log('FAIL EXPECTED RED '+kind+' '+name+' (ad740 oracle accepts it)')}
}
console.log('TOTAL HISTORICAL ad740 EXPECTED_RED '+failures+' (must equal4); native NOT_RUN');assert.equal(failures,4);process.exitCode=1

```

</details>

<details>
<summary>Finite originalkontroll ediel-fg-6f94-refusal-oracle-fixed-control.cjs; SHA256 ef1ad38686bba98a6830f2f036337ec7d650903acc04b54bd987372fc66587d1</summary>

```javascript
// Explicit MODELED receipt/input ports. Runs the actual assertion helpers only;
// this is neither native recording nor a F/G acceptance result.
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),root='/workspace/ediel-fg-proof-20261013-6f94',ts=require(root+'/node_modules/typescript'),{load}=require('/tmp/ediel-fg-6f94-model-ports.cjs')
const token=load(root+'/lib/ediel/core/edifactTokenizer.ts'),fixture=load(root+'/scripts/helpers/ediel-z06f-reading-followup-native-fixture.ts').createZ06fReadingNativeFixture
const partial=(actual,expected)=>{if(expected&&typeof expected==='object'){for(const[k,v]of Object.entries(expected))partial(actual?.[k],v)}else assert.deepEqual(actual,expected)}
function expect(actual){return{toBe:expected=>assert.equal(actual,expected),toBeNull:()=>assert.equal(actual,null),toEqual:expected=>assert.deepEqual(actual,expected),toMatchObject:expected=>partial(actual,expected),toHaveLength:expected=>assert.equal(actual.length,expected),toContain:expected=>assert.ok(actual.includes(expected)),toMatch:expected=>assert.match(actual,expected),toBeGreaterThanOrEqual:expected=>assert.ok(actual>=expected),not:{toBeNull:()=>assert.notEqual(actual,null)}}}
function oracle(kind,ports={}){const file=root+`/scripts/ediel-at-z06${kind}-supplier-acceptance-native.test.ts`,source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true),printer=ts.createPrinter(),names=['expectSourceContext','expectReadyRefusalBasis','expectRecordedOwnRefusal','expectPhysicalContextRefusal','prepareCapturedControl'];const code=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name.text)).map(n=>printer.printNode(ts.EmitHint.Unspecified,n,source)).join('\n')+'\nreturn {expectRecordedOwnRefusal,expectPhysicalContextRefusal,prepareCapturedControl}';const portNames=['refusalEvidence','resolveCanonicalRuntimeDecisionWithRegistry','recordReceivedSourceValidation','captureFreshEdielSourceRulePackEvidence','requireEdielSourceRulePackEvidence','reviewReceivedStructuralSource','approveSafeMasterdataChanges'];return new Function('expect','createHash','tokenizeEdifact','segmentComposite',...portNames,ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(expect,createHash,token.tokenizeEdifact,token.segmentComposite,...portNames.map(name=>ports[name]))}
const hash=value=>createHash('sha256').update(value).digest('hex'),clone=value=>structuredClone(value)
async function main(){let count=0;for(const kind of ['f','g']){const f=await fixture(()=>{}),message=await f.captureChange(kind.toUpperCase()),wire=token.tokenizeEdifact(message.raw_payload),lin=wire.segments.find(x=>x.tag==='LIN'),messageReference=token.segmentComposite(wire.segments.find(x=>x.tag==='UNH'),1,wire.una)[0],payload=hash(message.raw_payload),source={source_message_id:message.id,company_id:f.f.companyId,environment:'test'},cause='FIELD_MATRIX_REQUIRED_FIELD_MISSING',scope={messageReference,objectId:f.f.external,identityAgency:'9',registers:[{segmentIndex:lin.index}]},canonicalText=JSON.stringify({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'}),canonicalHash=hash(canonicalText),factsText=JSON.stringify({owner:'received-source-object-decisions-v1',canonicalFactsHash:canonicalHash,objects:[{object:scope,disposition:'rejected',reasons:[cause],business:null,party:null}]}),factsHash=hash(factsText),at='2026-10-13T12:00:00Z',canon='00000000-0000-4000-8000-000000000101',assessment='00000000-0000-4000-8000-000000000102',witness='00000000-0000-4000-8000-000000000103';const review={status:'recorded',sourceDisposition:'not_established',objectCounts:{accepted:0,rejected:1,held:0},assessmentId:assessment,factsHash,witnessId:witness,availableAt:at},application={assessmentId:canon,sourcePayloadHash:payload,headerDecision:'accepted',objects:[{...scope,applicationDecision:'rejected',reasonCodes:[cause]}]},stored={context:{...source,direction:'inbound',payload_sha256:payload,source_received_at:at,observed_at:at,status:'ready',reason:null,context:{legalEdielId:f.f.sender,transportEdielId:f.f.sender,actorRole:'electricity_supplier',family:'PRODAT',code:'Z06',applicationReference:'23-DDQ-PRODAT'}},rules:{...source,direction:'inbound',payload_sha256:payload,captured_at:at,canonical_assessment_id:canon},ruleCanonical:{...source,id:canon,source_payload_hash:payload},canonical:{...source,id:canon,source_payload_hash:payload,facts_text:canonicalText,facts_hash:canonicalHash},assessment:{...source,id:assessment,source_payload_hash:payload,canonical_assessment_id:canon,facts_text:factsText,facts_hash:factsHash},witness:{...source,id:witness,assessment_id:assessment,facts_hash:factsHash,observed_at:at},ownReceiverCount:1,ownPointCount:1},o=oracle(kind),run=(r=review,s=stored,a=application)=>o.expectRecordedOwnRefusal(f,message,r,s,a,'rejected',cause,'508');run();count++;console.log('PASS MODELED '+kind+' valid recorded own refusal')
for(const[name,mutate]of[
 ['unconfirmed recorder status rejected',v=>{v.review={status:'unconfirmed',sourceDisposition:'not_established'}}],
 ['missing rule basis rejected',v=>{v.stored.rules=null}],
 ['unrelated context prerequisite rejected',v=>{v.stored.context.status='held';v.stored.context.reason='ediel_original_identity_capture_failed'}],
 ['borrowed source hash rejected',v=>{v.stored.assessment.source_payload_hash='0'.repeat(64)}],
 ['stale canonical assessment rejected',v=>{v.stored.canonical.id='STALE'}],
 ['unbound witness rejected',v=>{v.stored.witness.assessment_id='FOREIGN'}],
 ['canonical syntax refusal cannot satisfy own field oracle',v=>{const text=JSON.stringify({syntaxDecision:'rejected'});v.stored.canonical.facts_text=text;v.stored.canonical.facts_hash=hash(text)}],
 ['different own cause rejected',v=>{v.application.objects[0].reasonCodes=['UNRELATED']}],
 ]){const v={review:clone(review),stored:clone(stored),application:clone(application)};mutate(v);assert.throws(()=>run(v.review,v.stored,v.application),name);count++;console.log('PASS MODELED '+kind+' '+name)}
const held=clone(stored);held.context.status='held';held.context.reason='ediel_inbound_legal_context_required';held.context.context={};held.ownReceiverCount=0;o.expectPhysicalContextRefusal(f,message,held);count++;console.log('PASS MODELED '+kind+' exact source-bound context refusal')
for(const[name,mutate]of[
 ['context wrong cause rejected',v=>{v.context.reason='ediel_original_identity_capture_failed'}],
 ['context missing receiver cause rejected',v=>{v.ownReceiverCount=1}],
 ['missing fresh context rejected',v=>{v.context=null}],
 ]){const v=clone(held);mutate(v);assert.throws(()=>o.expectPhysicalContextRefusal(f,message,v),name);count++;console.log('PASS MODELED '+kind+' '+name)}
assert.doesNotMatch('ediel_source_rule_pack_basis_required',/^structural_apply_no_qualified_object$/);assert.doesNotMatch('ediel_inbound_legal_context_required',/^structural_apply_no_qualified_object$/);assert.doesNotMatch('ediel_source_rule_pack_basis_required',/^ediel_inbound_legal_context_required$/);count++;console.log('PASS MODELED '+kind+' unrelated missing rule/context errors cannot satisfy recorded refusal')
// Execute the actual same-path intact preparer through explicitly modeled
// canonical, recorder and SQL/RPC receipt ports. No protected receipt is written.
for(const failure of [null,'record','capture','require','review']){
 const events=[],decision={syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'},ports={
  refusalEvidence:(owner,original)=>{assert.equal(owner,f);assert.equal(original,message);events.push('context');return clone(stored)},
  resolveCanonicalRuntimeDecisionWithRegistry:async(original,actor)=>{assert.equal(original,message);assert.deepEqual(actor,{actorUserId:f.operator.id});events.push('canonical');return decision},
  recordReceivedSourceValidation:async input=>{assert.deepEqual(input,{original:message,validated:message,resolvedCompanyId:f.f.companyId,decision});events.push('record');return {status:failure==='record'?'unconfirmed':'recorded'}},
  captureFreshEdielSourceRulePackEvidence:async(company,id)=>{assert.equal(company,f.f.companyId);assert.equal(id,message.id);events.push('capture');return {status:failure==='capture'?'unconfirmed':'captured'}},
  requireEdielSourceRulePackEvidence:async(company,id)=>{assert.equal(company,f.f.companyId);assert.equal(id,message.id);events.push('require');if(failure==='require')throw Error('ediel_source_rule_pack_basis_required')},
  reviewReceivedStructuralSource:async input=>{assert.deepEqual(input,{companyId:f.f.companyId,environment:'test',sourceMessageId:message.id,reviewerUserId:f.operator.id,confirmedOriginal:true,replacesSourceMessageId:null});events.push('review');return {status:failure==='review'?'unconfirmed':'recorded',sourceDisposition:'accepted'}},
  approveSafeMasterdataChanges:async input=>{assert.deepEqual(input,{edielMessageId:message.id,actorUserId:f.operator.id});events.push('apply');return {applied:true}},
 },prepared=oracle(kind,ports)
 if(failure){await assert.rejects(()=>prepared.prepareCapturedControl(f,message));assert.ok(!events.includes('apply'));if(failure!=='review')assert.ok(!events.includes('review'));console.log('PASS MODELED '+kind+' actual intact preparer refuses '+failure+' failure before approval')}
 else{const change=await prepared.prepareCapturedControl(f,message);assert.equal(change.message,message);assert.deepEqual(events,['context','canonical','record','capture','require','review']);assert.deepEqual(await change.apply(),{applied:true});assert.deepEqual(events,['context','canonical','record','capture','require','review','apply']);console.log('PASS MODELED '+kind+' actual intact preparer records/requires/reviews before explicit apply')}
 count++
}
// The actual foreign-own-point assertion accepts a recorded, cause-bound hold.
const foreignMessage={...message,raw_payload:message.raw_payload.replaceAll(f.f.external,f.f.external+'-FOREIGN')},foreignStored=clone(stored),foreignApplication=clone(application),foreignReview=clone(review),foreignHash=hash(foreignMessage.raw_payload),foreignScope={...scope,objectId:f.f.external+'-FOREIGN'}
foreignStored.context.payload_sha256=foreignHash;foreignStored.rules.payload_sha256=foreignHash;foreignStored.ruleCanonical.source_payload_hash=foreignHash;foreignStored.canonical.source_payload_hash=foreignHash;foreignStored.assessment.source_payload_hash=foreignHash;foreignStored.ownPointCount=0
const foreignFacts=JSON.stringify({owner:'received-source-object-decisions-v1',canonicalFactsHash:canonicalHash,objects:[{object:foreignScope,disposition:'unavailable',reasons:['structural_review_owner_unavailable'],business:null,party:null}]});foreignStored.assessment.facts_text=foreignFacts;foreignStored.assessment.facts_hash=hash(foreignFacts);foreignStored.witness.facts_hash=hash(foreignFacts);foreignReview.factsHash=hash(foreignFacts);foreignReview.objectCounts={accepted:0,rejected:0,held:1};foreignApplication.sourcePayloadHash=foreignHash;foreignApplication.objects=[{...foreignScope,applicationDecision:'accepted',reasonCodes:[]}]
o.expectRecordedOwnRefusal(f,foreignMessage,foreignReview,foreignStored,foreignApplication,'unavailable','structural_review_owner_unavailable');count++;console.log('PASS MODELED '+kind+' actual recorded unavailable own-point hold')
const unrelatedForeignApplication=clone(foreignApplication);unrelatedForeignApplication.headerDecision='held';assert.throws(()=>o.expectRecordedOwnRefusal(f,foreignMessage,foreignReview,foreignStored,unrelatedForeignApplication,'unavailable','structural_review_owner_unavailable'));count++;console.log('PASS MODELED '+kind+' unrelated held canonical header cannot prove foreign-point cause')}


console.log('TOTAL MODELED '+count+' PASS; native NOT_RUN')}
main().catch(e=>{console.error(e.message);process.exitCode=1})

```

</details>

<details>
<summary>Finite originalkontroll ediel-fg-6f94-physical-control.cjs; SHA256 689093678010a252882a270fc4b0bf204c37fa6922367beb3a71e9d241d1a909</summary>

```javascript
// Finite PHYSICAL/POLICY component checks only; fixture persistence ports modeled.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process')
const root='/workspace/ediel-fg-proof-20261013-6f94',ts=require(root+'/node_modules/typescript')
const model=fs.readFileSync('/tmp/ediel-fg-6f94-seam-control.cjs','utf8').replace(/main\(\)\.catch[\s\S]*$/,'module.exports={load,mocks};')
fs.writeFileSync('/tmp/ediel-fg-6f94-model-ports.cjs',model)
const{load}=require('/tmp/ediel-fg-6f94-model-ports.cjs'),fixture=load(root+'/scripts/helpers/ediel-z06f-reading-followup-native-fixture.ts').createZ06fReadingNativeFixture
const token=load(root+'/lib/ediel/core/edifactTokenizer.ts'),policyApi=load(root+'/lib/ediel/rulebook/canonicalEdielPolicy.ts'),validator=load(root+'/lib/ediel/rulebook/canonicalPolicyFieldValidator.ts'),syntax=load(root+'/lib/ediel/core/edifactValidation.ts')
const expected=x=>({toHaveLength:n=>assert.equal(x.length,n),toBe:y=>assert.equal(x,y),toBeGreaterThan:y=>assert.ok(x>y)})
function helpers(kind){const file=root+`/scripts/ediel-at-z06${kind.toLowerCase()}-supplier-acceptance-native.test.ts`,source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true),printer=ts.createPrinter(),picked=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&['extraUd','removeSourceSegments','removeCharacteristic'].includes(node.name.text)),code=picked.map(node=>printer.printNode(ts.EmitHint.Unspecified,node,source)).join('\n')+'\nreturn {extraUd,removeSourceSegments,removeCharacteristic}';return new Function('tokenizeEdifact','segmentComposite','segmentSourceSpan','expect',ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(token.tokenizeEdifact,token.segmentComposite,token.segmentSourceSpan,expected)}
function validate(raw,kind){const wire=token.tokenizeEdifact(raw),policy=policyApi.resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z06',subtypeOrReasonCode:kind,direction:'inbound',applicationReference:'23-DDQ-PRODAT',referenceDate:'2026-10-13',mode:'catalog_evidence',prodatDependentFacts:{market:'electricity',meterReadingsSentInUtilts:true}}),ignored=[];let application;const issues=validator.validateCanonicalPolicyFields({onApplicationObjects:x=>application=x,policy,rawPayload:raw,rawSegments:wire.segments.map(x=>x.raw),una:wire.una,onIgnoredField:x=>ignored.push(x)});return{issues,ignored,application}}
async function main(){for(const kind of ['F','G']){const f=await fixture(()=>{}),h=helpers(kind),ud=await f.captureChange(kind,undefined,{rawTransform:h.extraUd});assert.equal(syntax.validateEdifactEnvelope(ud.raw_payload).syntaxOk,true);const result=validate(ud.raw_payload,kind),wanted=['END_USER_GROUP','227','228','229','231','232','316'];assert.deepEqual(result.ignored.filter(x=>wanted.includes(x.fieldNumber)).map(x=>x.fieldNumber).sort(),[...wanted].sort());for(const item of result.ignored.filter(x=>wanted.includes(x.fieldNumber)))assert.equal(item.occurrence.ownReferences.customerId.value,`FORBIDDEN-UD-${kind}`);assert.ok(!result.issues.some(x=>x.prodatDiagnostic?.kind==='field'&&wanted.includes(x.prodatDiagnostic.fieldNumber)));console.log('PASS FINITE physical'+kind+'UD original/UNT and actual7ignored-field decisions')
const foreign=await fixture(()=>{}),borrowed=await f.captureChange(kind,undefined,{rawTransform:raw=>raw.replaceAll(f.f.external,foreign.f.external)}),borrowedResult=validate(borrowed.raw_payload,kind);assert.equal(syntax.validateEdifactEnvelope(borrowed.raw_payload).syntaxOk,true);assert.equal(borrowedResult.application.headerDecision,'accepted');assert.equal(borrowedResult.application.objects.length,1);assert.equal(borrowedResult.application.objects[0].applicationDecision,'accepted');assert.deepEqual(borrowedResult.application.objects[0].reasonCodes,[]);assert.equal(borrowedResult.application.objects[0].objectId,foreign.f.external);console.log('PASS FINITE physical'+kind+'foreign-point accepted intact canonical application; business owner separate')
const fields=kind==='F'?[['508',raw=>h.removeSourceSegments(raw,x=>x.tag==='DTM'&&token.segmentComposite(x,1,token.tokenizeEdifact(raw).una)[0]==='354')],['214',raw=>h.removeCharacteristic(raw,'Z02')]]:[['306',raw=>h.removeCharacteristic(raw,'Z07')]];fields.push(['226',raw=>h.removeSourceSegments(raw,x=>x.tag==='RFF'&&token.segmentComposite(x,1,token.tokenizeEdifact(raw).una)[0]==='LI')]);for(const[field,transform]of fields){const row=await f.captureChange(kind,undefined,{rawTransform:transform});assert.equal(syntax.validateEdifactEnvelope(row.raw_payload).syntaxOk,true);const result=validate(row.raw_payload,kind),found=result.issues;assert.ok(found.some(x=>x.prodatDiagnostic?.kind==='field'&&x.prodatDiagnostic.fieldNumber===field&&x.prodatDiagnostic.errorKind==='missing'),JSON.stringify(found));assert.equal(result.application.headerDecision,'accepted',JSON.stringify(result));assert.equal(result.application.objects.length,1);assert.equal(result.application.objects[0].applicationDecision,'rejected',JSON.stringify(result));const cause=found.find(x=>x.prodatDiagnostic?.kind==='field'&&x.prodatDiagnostic.fieldNumber===field&&x.prodatDiagnostic.errorKind==='missing').code;assert.ok(result.application.objects[0].reasonCodes.includes(cause));console.log('PASS FINITE physical'+kind+'missing'+field+' syntax-valid/accepted-header/rejected-own/cause diagnostic')}}
for(const kind of ['f','g']){const file=`scripts/ediel-at-z06${kind}-supplier-acceptance-native.test.ts`,old=fs.readFileSync('/tmp/ediel-fg-6f94-'+kind+'-preimage.ts','utf8'),current=fs.readFileSync(root+'/'+file,'utf8'),printer=ts.createPrinter({removeComments:true}),statements=text=>{const src=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);return src.statements.filter(x=>ts.isExpressionStatement(x)&&ts.isCallExpression(x.expression)&&x.expression.expression.getText(src)==='it').map(x=>printer.printNode(ts.EmitHint.Unspecified,x,src))};assert.deepEqual(statements(current).slice(0,2),statements(old));const functions=text=>{const src=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);return new Map(src.statements.filter(ts.isFunctionDeclaration).map(x=>[x.name.text,printer.printNode(ts.EmitHint.Unspecified,x,src)]))};const currentFunctions=functions(current);for(const[name,body]of functions(old))assert.equal(currentFunctions.get(name),body);console.log('PASS RETAINED '+file+' both original complete tests and all5 original assertion-helper ASTs unchanged')}}
main().catch(e=>{console.error(e);process.exitCode=1})

```

</details>

<details>
<summary>Finite originalkontroll ediel-fg-6f94-seam-control.cjs; SHA256 f54ed1f173c5265262743b1444c6e2079e9694320f0392ce829fa94bbfa71b89</summary>

```javascript
// Explicitly MODELED fixture ports. No database, native source or F/G acceptance proof.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const root='/workspace/ediel-fg-proof-20261013-6f94',ts=require(root+'/node_modules/typescript'),cache=new Map()
const events=[], f={companyId:'00000000-0000-4000-8000-000000000001',customerId:'00000000-0000-4000-8000-000000000002',pointId:'00000000-0000-4000-8000-000000000003',siteId:'00000000-0000-4000-8000-000000000004',gridId:'00000000-0000-4000-8000-000000000005',source:'00000000-0000-4000-8000-000000000006',actorUserId:'00000000-0000-4000-8000-000000000007',external:'735123456789012345',receiver:'12345',sender:'54321',brpEdielId:'11111',caseReference:'CASE-1',gridAreaCode:'NET-1',requestedStartDate:'2026-11-01'}
let message
function partial(actual,expected){for(const[k,v]of Object.entries(expected))v&&typeof v==='object'?partial(actual[k],v):assert.deepEqual(actual[k],v)}
function expect(actual){return{toBe:expected=>assert.equal(actual,expected),toBeTruthy:()=>assert.ok(actual),toBeNull:()=>assert.equal(actual,null),toEqual:expected=>assert.deepEqual(actual,expected),toMatchObject:expected=>partial(actual,expected),not:{toBeNull:()=>assert.notEqual(actual,null)}}}
const mocks={
 'vitest':{expect},
 '@/lib/supabase/service':{supabaseService:{from:()=>({select:()=>({eq:()=>({single:async()=>({error:null,data:message})})})})}},
 './ediel-normal-switch-native-fixture':{futureNativeSupplyDate:()=>f.requestedStartDate,literal:v=>v===null?'NULL':"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'",nativeSql:q=>{if(q.includes('INSERT INTO public.ediel_messages')){events.push('capture');if(q.includes("'test','outbound','edifact'"))throw Error('canonical_ediel_route_required');return}if(q.includes('EXISTS'))return false;throw Error('unexpected modeled SQL')}},
 './ediel-requested-change-native-fixture':{createRequestedChangeSupplyFixture:async()=>f},
 './ediel-bilateral-customer-native-fixture':{createBilateralSourceOperator:async()=>({id:f.actorUserId})},
 '../../__tests__/helpers/utiltsNativeSourceFixture':{utiltsNativeSourceFixture:(raw,id)=>{message={id,raw_payload:raw,message_received_at:'2026-10-13T12:00:00Z',company_id:f.companyId};return{id,raw,parsed:{applicationReference:'23-DDQ-PRODAT',senderEdielId:f.receiver,receiverEdielId:f.sender,interchangeReference:'MODEL'}}}},
 './utiltsConsumptionParties':{registerUtiltsIssuer(){throw Error('unexpected reading')},seedUtiltsIssuerHistoryGround(){throw Error('unexpected reading')}},
 '@/lib/ediel/sources/reviewReceivedStructuralSource':{reviewReceivedStructuralSource:async p=>{events.push(p.sourceMessageId===f.source?'baseline-review':'change-review');return{status:'recorded',sourceDisposition:'accepted'}}},
 '@/lib/ediel/safeApplyReview':{approveSafeMasterdataChanges:async()=>{events.push('apply');return{status:'applied',appliedCount:1}}},
 '@/lib/ediel/core/runtimeDecision':{resolveCanonicalRuntimeDecisionWithRegistry:async()=>{events.push('canonical');return{syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted',issues:[]}}},
 '@/lib/ediel/core/sourceRulePackEvidence':{captureFreshEdielSourceRulePackEvidence:async()=>events.push('rule-pack')},
 '@/lib/ediel/core/receivedSourceValidationLedger':{recordReceivedSourceValidation:async()=>{events.push('record');return{status:'recorded'}}},
 '@/lib/ediel/sources/receivedSourceOwnerSession':{createReceivedSourceOwnerSession:()=>({finish:async()=>events.push('finish')})},
 '@/lib/ediel/flows/utiltsCanonicalValidation':{},'@/lib/ediel/utiltsEngine':{},'@/lib/ediel/utilts/qualifyReceivedStructure':{},'@/lib/ediel/flows/utiltsDataRequest.part-1':{},'@/lib/ediel/utilts/consumptionPreparation':{},'@/lib/ediel/utilts/transactionPersistence':{},
}
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const source=fs.readFileSync(file,'utf8'),out=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;const requireAt=name=>{if(Object.hasOwn(mocks,name))return mocks[name];if(name.startsWith('.')||name.startsWith('@/')){const base=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(file),name);if(base.endsWith('.json')&&fs.existsSync(base))return JSON.parse(fs.readFileSync(base,'utf8'));for(const suffix of ['.ts','.tsx','/index.ts'])if(fs.existsSync(base+suffix))return load(base+suffix);throw Error('unmodeled local '+name)}return require(name)};vm.runInThisContext('(function(require,module,exports){'+out+'\n})',{filename:file})(requireAt,module,module.exports);return module.exports}
async function main(){const fixture=load(root+'/scripts/helpers/ediel-z06f-reading-followup-native-fixture.ts').createZ06fReadingNativeFixture;let failed=0;for(const[name,test]of[
 ['legacy default applies after actual modeled validation/review order',async()=>{const x=await fixture(()=>{});events.length=0;await x.change('F');assert.deepEqual(events,['capture','canonical','record','rule-pack','finish','change-review','apply'])}],
 ['deferred first apply retains validation/review but creates no modeled primary effect',async()=>{const x=await fixture(()=>{});events.length=0;const c=await x.change('F','DEFER',{deferFirstApply:true});assert.deepEqual(events,['capture','canonical','record','rule-pack','finish','change-review']);await c.apply();assert.equal(events.at(-1),'apply')}],
 ['captured changed original has physical UD and correct UNT without modeled approval',async()=>{const x=await fixture(()=>{});events.length=0;assert.equal(typeof x.captureChange,'function');const m=await x.captureChange('G','RAW',{rawTransform:raw=>raw.replace('NAD+IT',"NAD+UD+FORBIDDEN::89++Different+Street+Town++12345+SE'NAD+IT")});assert.deepEqual(events,['capture']);assert.ok(m.raw_payload.includes('FORBIDDEN'));const{tokenizeEdifact}=load(root+'/lib/ediel/core/edifactTokenizer.ts');const wire=tokenizeEdifact(m.raw_payload),unh=wire.segments.findIndex(x=>x.tag==='UNH'),unt=wire.segments.findIndex(x=>x.tag==='UNT');assert.equal(+wire.segments[unt].raw.split('+')[1],unt-unh+1)}],
 ['rejected modeled outbound insertion never invokes modeled protected approval',async()=>{const x=await fixture(()=>{});events.length=0;assert.equal(typeof x.captureChange,'function');await assert.rejects(x.captureChange('F','DIRECTION',{direction:'outbound'}),/canonical_ediel_route_required/);assert.deepEqual(events,['capture'])}],
 ]){try{await test();process.stdout.write('PASS MODELED '+name+'\n')}catch(e){failed++;process.stdout.write('FAIL MODELED '+name+': '+e.message+'\n')}}process.exitCode=failed?1:0}
main().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1})

```

</details>


## Ny retained-owner-orakelrevision för staged NAD+UD

[6149259115](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6149259115) härleder från public0dbc och faktiskd798 att ignorerad F/G-NAD+UD når createOrUpdateInboundProdatCase, medan named parsed_customer inte kontrolleras efter staging/approval/replay. Nuvarande parser c08e/sha39c7e81a läser råUD till namedcustomer fields. Vårt tidigare source bevisar oförändrade faktiska customer/site/supplyrader och bevarat original/ignoredfacets; det bevisar inte att stagedbusinessprojection saknar oanvända värden. Fyndet är inte en exekverad nativebugg eller ett påstående att kundrader muterats.

Exakt korrigering i två egna tester ska jämföra namngivna savedcase.parsed_customer-businessfält till clean/null/noUD-baseline efter verklig staging samt approval/replay. Bevara raw/ignoredfacets/sourcehash/caseidentity och legitima installation/register/structurefält; helcasejämförelse över ID-/tidsvarianter krävs inte. Giltig applicableUD-kontroll ska behållas utan att uppfinna att UD är tillämpligt i F/G. Den nya actualC10 sourcekomponenten kan återanvändas selektivt för tillämplig kundprojektion på faktiskd798, med samma uttryckliga modellportgräns, tillsammans med befintliga C1/P02-kontroller.

Ingen ändring till helperbb9d77/config7350c1 eller runtime/decoder/SQL/privatepostimage/ledger/frozen/GEN/backend/producer/original/CI. CurrentC1/a93c-fix6144860660 måste levereras av sin befintliga ägare och kvalificeras i den verkliga adopterade sourceunionen innan skärpta nativeorakel kan bli wholebevis. Vi frågar inte om samma gamla obesvarade handoff och tar inte C1:s source. I denna sourcefas dokumenteras exakt vad actualparser/finitekontroller visar, inklusive avvisade dirtyprojections och gränser; inga felutfall blir PASS genom generisk fallback.

Föregående Z09FG76a är publicerat/sourcehandoff6148968370; dess immutable beroende0dbc är historiskt pin och behöver uppdaterad selektiv applicability vid adoption av nya två F/G-postbilder. Z04C429c sourcehandoff6149776855 är färdig med 10 finita PASS och två slutpeers. Dessa paket/heldrefs ändras inte här. Daterad futurearrival-order-availability/feasibility är inte en aktiv writer/producerclaim och prioriteras efter konkreta retained-owner-rättningar.


## Fryst SC031-orakelrevision och exakta lokala resultat

Codehead `054abdeee5dff896b71af5b763be34a1a95b4488`, tree `d9f5c403888f8882702ea49f2aa21dd56bf1f47d`, ordnad enda parent `[467d12a99eb5ffa2e7e7ddccf46f8e78a28fbd8c]`. Sourcepreimage467d/ac21 har ordnade parents `[0dbc3101138e6ebe041bc280d9f7b68e4876e0ce,d798eb36f35cd4f437d44c8d234b4dbb81adc7a6]`, actualbase d798/e3b6/323. Root har verifierat identiteter och båda filhashar mot source/workspace. Skrivaren är pausad; eget rootcheckpoint rördes inte av helper.

| Reviderad egen fil | SHA256 | Gitblob |
| --- | --- | --- |
| scripts/ediel-at-z06f-supplier-acceptance-native.test.ts | 64fd6cfe7b6dad4ab4e6f7c8bcadad54882cbcecd34c11e0f9b4a8844d5a7d81 | 68b94eb06f469b0d85b9a21cfc44d9390ad11135 |
| scripts/ediel-at-z06g-supplier-acceptance-native.test.ts | 34d394d5a681757d0aa9e3a59d77206f04129dd385b7f83b9f91d3b0f9a58ce0 | d0fe3d47a9832302d41c5a07b9247ed7b515943e |

Exakt 17 tillagda rader per fil: en namngiven kundfältsassertion med case/company/source/Z06/phase-statusbindning och anrop på faktiskt lagrat case vid staging, approval och replay i båda giltiga positiva varianter. Kundvektorn har 15 faktiska DTO-nycklar: 14 null och tom identitetslabel `Ej angivet`, oberoende bekräftad på ren noUD source. Ingen helcase-equality över ID/tider krävs. Alla gamla direkta nativecase-/helper-AST och alla gamla expect-statements är bevarade i exakt ordning; samtliga 12 nativefall och tidigare precisa P2-avvisningar/expectedFreading/Gnone/råoriginal/ignoredfacet/struktur/installations-/registerassertions ligger kvar. Helperbb9d77 och config7350c1 är oförändrade.

Första exakta nya oraclekontrollen: **66 PASS**, stdout SHA `f59248db` enligt fullhash i originalrapporten, stderr tomt. Första exakt-source scriptsTSC/ESLint/stageddiff PASS. Kontrollen exekverar actual new helperAST, actual pure parserAST/dependencies samt tokenizer/envelope/canonicalfieldvalidator/fixturerecount, men använder deklarerade konstruerade rawinputs och modellerade persisterade caserows. Verklig casepersistens, native/backend/SQL/GEN/whole-ID körs inte. Inga gröna prov kördes igen för dokumentation.

Varje namngivet fält förgiftas separat med ett värde som inte är FORBIDDEN-sentineln och måste avvisas. Missingcase/projection/key och wrongcase/source/company/status avvisas; alla tre faser med rena caserows accepteras och nuvarande actualparserdirtyprojection avvisas. F/G-raworiginal är fullt räknade och syntaxgiltiga och har sju faktiskt ignorerade nationella fieldfacets. Legitim named installation/registerprojection och råevidence bevaras; hela nestedraw/evidenceobjekt krävs inte lika över UD-inputvarianter.

**Concrete upstream limitation kvarstår:** actual d798-parserblob `c08e51d67c98b8b7be0fc726f2509059cf4aaec0`/SHA `39c7e81aeabb3c88b55258248d41672f7390009b72a792421ae021c037203e5f` främjar åtta ignoredUD-namedfält: customerId/fullName/firstName/lastName/address/postalCode/city/country. Detta är observerat med faktisk pure parser på finit rawsource och source-visible fram till saved-casepayload; det är ingen ny nativeexekvering eller kundtabellsmutation. Nya oraklen kräver därför rätt C1/a93c-owned decoder/saved-case-korrigering051ec/6144860660 och kvalificerad verklig sourceunion innan native12 kan räknas. Vi kopierar/hämtar inte privat correction, skriver inte decoder eller mildrar assertionerna för grönt.

ApplicableUD-positive bevaras genom selektiv source-qualified återanvändning av actualC10/e627/public429c originalet: riktig C/Z24 caseparser/writer behöll personalNumber199001011234 med uttrycklig modellportgräns. Sju parser/db/SDK/lockberoenden är byteexakt samma i actuald798 och denna revision. Original10/10 kördes inte igen; det blir inte native/wholeproof eller permission att använda UD i F/G. Source-only66 och tidigare component/nativeförberedelser ger **+0 ledger**, F/G och SC031 förblir ogodkända.

Två observation-scaffoldfel (exportwrapper och för bred nestedregister-jämförelse) bevaras historiskt. De är inte produkt-RED; den rättade smala observationen och räknade physicalinputen isolerar verklig namedprojektion/evidencegräns. Nödvändiga originals, sourcepreimages och controllers bevaras ordagrant nedan.

### Original qualification JSON

SHA256 `adea061a2708cb7f74a3349d51988334849dbdeb51f6dbb77f038638521670a9`.

<details><summary>Fryst named-customer-oracle qualification</summary>

```json
{
  "scope": "Retained FG3f4 exact TWO-test named staged customer oracle addition; no decoder/product/helper/config/SQL changes",
  "qualifiedAt": "2026-10-13T16:25:10.426677+00:00",
  "receipt": "3f4b1b494ec70bd0217cd935352946416a4d51eb",
  "packet": "cf251c2f-a87c-4c82-aaa5-4d711a754b5c",
  "resumedHandoff": "https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6149882155",
  "finding": "https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6149259115",
  "commit": "054abdeee5dff896b71af5b763be34a1a95b4488",
  "tree": "d9f5c403888f8882702ea49f2aa21dd56bf1f47d",
  "orderedParents": [
    "467d12a99eb5ffa2e7e7ddccf46f8e78a28fbd8c"
  ],
  "sourcePreimage": "467d12a99eb5ffa2e7e7ddccf46f8e78a28fbd8c",
  "sourcePreimageTree": "ac21a93c50ddb575497ec3ce209ebc22a29d7ff2",
  "sourcePreimageOrderedParents": [
    "0dbc3101138e6ebe041bc280d9f7b68e4876e0ce",
    "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6"
  ],
  "actualBase": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
  "actualBaseTree": "e3b6c11677a2b871a128504f1616def7d22dba1e",
  "ledgerAtBase": "119VERIFIED+204PASSED=323/352; this change+0",
  "files": {
    "scripts/ediel-at-z06f-supplier-acceptance-native.test.ts": {
      "sha256": "64fd6cfe7b6dad4ab4e6f7c8bcadad54882cbcecd34c11e0f9b4a8844d5a7d81",
      "blob": "68b94eb06f469b0d85b9a21cfc44d9390ad11135",
      "preimageSHA256": "f7b037b6e2d24f4fd4131c5eba11c9098ac5541ef57e71cc5558d5ccdf7eecd8"
    },
    "scripts/ediel-at-z06g-supplier-acceptance-native.test.ts": {
      "sha256": "34d394d5a681757d0aa9e3a59d77206f04129dd385b7f83b9f91d3b0f9a58ce0",
      "blob": "d0fe3d47a9832302d41c5a07b9247ed7b515943e",
      "preimageSHA256": "baa6bb3e2fa811c49aebbebcf2ae0ac17f5210dc310f57d897af63c51d6222a9"
    }
  },
  "diff": "34 additive lines total: new exact15-field helper and3 actual persisted-case phase calls per F/G file; no old line removed",
  "custody": "Before first source write independently matched full original publicreceipt JSON/tree/orderedparent/delegatedWriter, all4 retained live exact refs, local source/tree/orderedparents/branch, all4 preimage SHA256, and literal public resumed TWO-test handoff. Root checkpoint is sole root writer and excluded from commit.",
  "namedBusinessFields": [
    "customerId",
    "customerIdQualifier",
    "customerIdLabel",
    "customerType",
    "personalNumber",
    "orgNumber",
    "birthDate",
    "fullName",
    "companyName",
    "firstName",
    "lastName",
    "address",
    "postalCode",
    "city",
    "country"
  ],
  "cleanNoUdBaseline": {
    "customerId": null,
    "customerIdQualifier": null,
    "customerIdLabel": "Ej angivet",
    "customerType": null,
    "personalNumber": null,
    "orgNumber": null,
    "birthDate": null,
    "fullName": null,
    "companyName": null,
    "firstName": null,
    "lastName": null,
    "address": null,
    "postalCode": null,
    "city": null,
    "country": null
  },
  "phaseCalls": [
    "staging pending_review after actual intake+owner review",
    "approval persisted applied case",
    "replay persisted applied case"
  ],
  "caseBinding": [
    "case id",
    "company id",
    "source message id",
    "Z06 code",
    "precise phase status"
  ],
  "preserved": "All existing direct native case ASTs, every old helper function AST, and every prior expect expression statement retained in exact order per file; P2 recorded/source-bound own refusal and precise context oracles unchanged; all12 native cases remain; physical raw/hash/ignored facets, actual customer/site/supply immutability, installation/register/structure and F-only expectation/G-none assertions retained",
  "qualification": {
    "node": "22.23.3",
    "scriptsTSC": "PASS first exact-source invocation",
    "twoFileEslint": "PASS first exact-source invocation",
    "newFiniteOracleControls": "66PASS/0FAIL first exact-source invocation, stderrEMPTY; no green rerun",
    "stagedDiffCheck": "PASS",
    "nativeExecution": "NOT_RUN",
    "databaseOrSQLExecution": "NOT_RUN",
    "GENExecution": "NOT_RUN"
  },
  "actualFiniteCode": "Actual new assertion helper ASTs, actual current parseInboundProdatBusinessData AST/pure dependencies, actual tokenizer/envelope/canonical field validator and actual fixture recount helper; explicit finite constructed raw inputs and modeled persisted case rows only. No native fixture producer/backend or actual case persistence executes.",
  "finiteControls": [
    "clean noUD15-field actual-parser baseline",
    "properly counted syntax-valid dirty extraUD original retains actual7 ignored national field facets/raw evidence",
    "each staging/approval/replay exact clean row passes and current actual dirty named parser projection is rejected",
    "each15 namedfield independently poisoned with NON_SENTINEL value is rejected, not just FORBIDDEN substring exclusion",
    "missing case/projection/key and wrong case/source/company/status fail",
    "legitimate named installation/register values unchanged; received nested raw/evidence may retain UD and is not compared as entire object",
    "AST/allassertion retention and exact3 phase registration on both withUd variants"
  ],
  "actualParserObservation": {
    "parserSHA256": "39c7e81aeabb3c88b55258248d41672f7390009b72a792421ae021c037203e5f",
    "scope": "Actual pure parser/case projection observation; finite constructed raw input only; native NOT_RUN",
    "expected": {
      "customerId": null,
      "customerIdQualifier": null,
      "customerIdLabel": "Ej angivet",
      "customerType": null,
      "personalNumber": null,
      "orgNumber": null,
      "birthDate": null,
      "fullName": null,
      "companyName": null,
      "firstName": null,
      "lastName": null,
      "address": null,
      "postalCode": null,
      "city": null,
      "country": null
    },
    "variants": {
      "F": {
        "clean": {
          "customerId": null,
          "customerIdQualifier": null,
          "customerIdLabel": "Ej angivet",
          "customerType": null,
          "personalNumber": null,
          "orgNumber": null,
          "birthDate": null,
          "fullName": null,
          "companyName": null,
          "firstName": null,
          "lastName": null,
          "address": null,
          "postalCode": null,
          "city": null,
          "country": null
        },
        "dirty": {
          "customerId": "FORBIDDEN-UD-F",
          "customerIdQualifier": null,
          "customerIdLabel": "Ej angivet",
          "customerType": null,
          "personalNumber": null,
          "orgNumber": null,
          "birthDate": null,
          "fullName": "Forbidden Identity",
          "companyName": null,
          "firstName": "Forbidden",
          "lastName": "Identity",
          "address": "Forbidden Street",
          "postalCode": "12345",
          "city": "Town",
          "country": "SE"
        },
        "dirtyKeys": [
          "customerId",
          "fullName",
          "firstName",
          "lastName",
          "address",
          "postalCode",
          "city",
          "country"
        ],
        "retainedPhysicalRawHash": "15da4733d4403c943e4e58a096cba844bc3ace81d8fb2fb5d4fb40ebd9a06d70",
        "legitimateInstallationRegisterProjectionUnchanged": true
      },
      "G": {
        "clean": {
          "customerId": null,
          "customerIdQualifier": null,
          "customerIdLabel": "Ej angivet",
          "customerType": null,
          "personalNumber": null,
          "orgNumber": null,
          "birthDate": null,
          "fullName": null,
          "companyName": null,
          "firstName": null,
          "lastName": null,
          "address": null,
          "postalCode": null,
          "city": null,
          "country": null
        },
        "dirty": {
          "customerId": "FORBIDDEN-UD-G",
          "customerIdQualifier": null,
          "customerIdLabel": "Ej angivet",
          "customerType": null,
          "personalNumber": null,
          "orgNumber": null,
          "birthDate": null,
          "fullName": "Forbidden Identity",
          "companyName": null,
          "firstName": "Forbidden",
          "lastName": "Identity",
          "address": "Forbidden Street",
          "postalCode": "12345",
          "city": "Town",
          "country": "SE"
        },
        "dirtyKeys": [
          "customerId",
          "fullName",
          "firstName",
          "lastName",
          "address",
          "postalCode",
          "city",
          "country"
        ],
        "retainedPhysicalRawHash": "58dd0f04ede04e14196a5b70843859f1cd5449dabe47fcca1c88eebb09737012",
        "legitimateInstallationRegisterProjectionUnchanged": true
      }
    }
  },
  "upstreamLimit": {
    "path": "lib/ediel/inboundCases.ts",
    "blob": "c08e51d67c98b8b7be0fc726f2509059cf4aaec0",
    "sha256": "39c7e81aeabb3c88b55258248d41672f7390009b72a792421ae021c037203e5f",
    "status": "UNFIXED_UNADOPTED_STAGED_BUSINESS_PROJECTION",
    "owner": "Existing C1/a93c051ec decoder/saved-case correction6144860660 remains occupied; no private correction fetched/copied/written",
    "dirtyNamedFields": [
      "customerId",
      "fullName",
      "firstName",
      "lastName",
      "address",
      "postalCode",
      "city",
      "country"
    ],
    "interpretation": "Current source still promotes8 ignoredUD fields into named parsed_customer business projection. The new native oracles deliberately require clean projection and depend on the rightful owner correction plus actual coherent source/producer qualification. This is not customer-row mutation proof or newly executed native failure."
  },
  "applicableUdPositiveReuse": {
    "publicCarrier": "429c04eefec1652c47fe7fe84647e1da46c94c42",
    "publicTree": "3e3d2cbfa8ff0f8c238c1ae3c2ed97e63dce582d",
    "source": "e627eb13d09bbdaa8e7850be9113f371e18184f6",
    "sourceTree": "855ca9157f3ba9a5e9ab80219d6b88ed2b6d4ae0",
    "handoff": "https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6149776855",
    "result": "Existing source-qualified10/10 finite C/Z24 real case parser/writer preserves applicable UD personalNumber199001011234. Original reused selectively, no rerun; not native/durable/whole proof or permission to apply UD in F/G.",
    "originalStdoutSHA256": "255f4a00b1e1e272a8b702e4c7d96eae82d981a8419518f0d32baba12c48f936",
    "sourceTestSHA256": "1f0f529be7fbe2f8acc84a9a4b30d22dce411c1a466843f0feeb4db06d457cb2",
    "unchangedApplicableDependencyPins": {
      "lib/ediel/inboundCases.ts": "39c7e81aeabb3c88b55258248d41672f7390009b72a792421ae021c037203e5f",
      "lib/ediel/db.ts": "572c45939c691fa8e9610b783273fbc84340175beea0bbb683a57114e9082ece",
      "lib/ediel/core/prodatOwnSourceRegisterReadingDeclarations.ts": "bd861f45da5473fcac478bb1d604b40ede08f82bee34b96a1bbf12a80407e504",
      "__tests__/helpers/prodatOwnSourceReadingFixture.ts": "ff0353dc388465fb901ed9b9bb475ed9d5bafc4ecbbd392ee241a4963ea1f327",
      "__tests__/helpers/prodatOwnSourceReadingAdapter.ts": "fc4d5d8cd7f6a7398e6d498a092280dca1d9a1b4e4bdc3fd33ad8dce333c18ed",
      "__tests__/helpers/sourceOwnerFixtures.ts": "5074fabfff69b734dd30480e957acd02e88107e8506fbf7111da0c2a4708c7c8",
      "package-lock.json": "8bf0aca13c2f57d92db355bda81f38e526b3bd50a33db7859d272daad8d9f5c5"
    }
  },
  "retainedOriginalOutputs": {
    "first-observation": {
      "command": [
        "/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node",
        "/tmp/ediel-fg-6f94-sc031-observe.cjs"
      ],
      "sourceHead": "467d12a99eb5ffa2e7e7ddccf46f8e78a28fbd8c",
      "codeHashes": {
        "scripts/ediel-at-z06f-supplier-acceptance-native.test.ts": "f7b037b6e2d24f4fd4131c5eba11c9098ac5541ef57e71cc5558d5ccdf7eecd8",
        "scripts/ediel-at-z06g-supplier-acceptance-native.test.ts": "baa6bb3e2fa811c49aebbebcf2ae0ac17f5210dc310f57d897af63c51d6222a9"
      },
      "startedAt": "2026-10-13T16:16:03.612232+00:00",
      "exitCode": 1,
      "stdout": {
        "path": "/tmp/ediel-fg-6f94-sc031-first-observation.stdout.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      },
      "stderr": {
        "path": "/tmp/ediel-fg-6f94-sc031-first-observation.stderr.log",
        "sha256": "b871fc40c4cae548456c6b2a1f945b977a5a9992e9f79398f36de1b80cdf827f",
        "bytes": 713
      }
    },
    "observation": {
      "command": [
        "/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node",
        "/tmp/ediel-fg-6f94-sc031-observe.cjs"
      ],
      "sourceHead": "467d12a99eb5ffa2e7e7ddccf46f8e78a28fbd8c",
      "codeHashes": {
        "scripts/ediel-at-z06f-supplier-acceptance-native.test.ts": "f7b037b6e2d24f4fd4131c5eba11c9098ac5541ef57e71cc5558d5ccdf7eecd8",
        "scripts/ediel-at-z06g-supplier-acceptance-native.test.ts": "baa6bb3e2fa811c49aebbebcf2ae0ac17f5210dc310f57d897af63c51d6222a9"
      },
      "startedAt": "2026-10-13T16:16:16.706818+00:00",
      "exitCode": 1,
      "stdout": {
        "path": "/tmp/ediel-fg-6f94-sc031-observation.stdout.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      },
      "stderr": {
        "path": "/tmp/ediel-fg-6f94-sc031-observation.stderr.log",
        "sha256": "e6ba8fdf45b386999754f9d316153bb0b62a3c1dad9413595cb9bdb7c65ec042",
        "bytes": 9651
      }
    },
    "narrow-observation": {
      "command": [
        "/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node",
        "/tmp/ediel-fg-6f94-sc031-observe.cjs"
      ],
      "sourceHead": "467d12a99eb5ffa2e7e7ddccf46f8e78a28fbd8c",
      "codeHashes": {
        "scripts/ediel-at-z06f-supplier-acceptance-native.test.ts": "f7b037b6e2d24f4fd4131c5eba11c9098ac5541ef57e71cc5558d5ccdf7eecd8",
        "scripts/ediel-at-z06g-supplier-acceptance-native.test.ts": "baa6bb3e2fa811c49aebbebcf2ae0ac17f5210dc310f57d897af63c51d6222a9"
      },
      "startedAt": "2026-10-13T16:16:49.413329+00:00",
      "exitCode": 0,
      "stdout": {
        "path": "/tmp/ediel-fg-6f94-sc031-narrow-observation.stdout.log",
        "sha256": "ff721e7747d989ad0eaeed908b60e40bbfec253367d0ddb3b009d2a0272432a2",
        "bytes": 2570
      },
      "stderr": {
        "path": "/tmp/ediel-fg-6f94-sc031-narrow-observation.stderr.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      }
    },
    "first-oracle": {
      "command": [
        "/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node",
        "/tmp/ediel-fg-6f94-sc031-oracle-control.cjs"
      ],
      "sourceHead": "467d12a99eb5ffa2e7e7ddccf46f8e78a28fbd8c",
      "codeHashes": {
        "scripts/ediel-at-z06f-supplier-acceptance-native.test.ts": "64fd6cfe7b6dad4ab4e6f7c8bcadad54882cbcecd34c11e0f9b4a8844d5a7d81",
        "scripts/ediel-at-z06g-supplier-acceptance-native.test.ts": "34d394d5a681757d0aa9e3a59d77206f04129dd385b7f83b9f91d3b0f9a58ce0"
      },
      "startedAt": "2026-10-13T16:20:16.629390+00:00",
      "exitCode": 0,
      "stdout": {
        "path": "/tmp/ediel-fg-6f94-sc031-first-oracle.stdout.log",
        "sha256": "f59248db272f50fcc826e572be94cf451bcf7b2089ed228ccdb0b7e6ba24a55e",
        "bytes": 4748
      },
      "stderr": {
        "path": "/tmp/ediel-fg-6f94-sc031-first-oracle.stderr.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      }
    },
    "first-type": {
      "command": [
        "/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node",
        "node_modules/typescript/bin/tsc",
        "--noEmit",
        "-p",
        "tsconfig.scripts.json"
      ],
      "sourceHead": "467d12a99eb5ffa2e7e7ddccf46f8e78a28fbd8c",
      "codeHashes": {
        "scripts/ediel-at-z06f-supplier-acceptance-native.test.ts": "64fd6cfe7b6dad4ab4e6f7c8bcadad54882cbcecd34c11e0f9b4a8844d5a7d81",
        "scripts/ediel-at-z06g-supplier-acceptance-native.test.ts": "34d394d5a681757d0aa9e3a59d77206f04129dd385b7f83b9f91d3b0f9a58ce0"
      },
      "startedAt": "2026-10-13T16:20:52.829565+00:00",
      "exitCode": 0,
      "stdout": {
        "path": "/tmp/ediel-fg-6f94-sc031-first-type.stdout.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      },
      "stderr": {
        "path": "/tmp/ediel-fg-6f94-sc031-first-type.stderr.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      }
    },
    "first-lint": {
      "command": [
        "/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node",
        "node_modules/eslint/bin/eslint.js",
        "scripts/ediel-at-z06f-supplier-acceptance-native.test.ts",
        "scripts/ediel-at-z06g-supplier-acceptance-native.test.ts"
      ],
      "sourceHead": "467d12a99eb5ffa2e7e7ddccf46f8e78a28fbd8c",
      "codeHashes": {
        "scripts/ediel-at-z06f-supplier-acceptance-native.test.ts": "64fd6cfe7b6dad4ab4e6f7c8bcadad54882cbcecd34c11e0f9b4a8844d5a7d81",
        "scripts/ediel-at-z06g-supplier-acceptance-native.test.ts": "34d394d5a681757d0aa9e3a59d77206f04129dd385b7f83b9f91d3b0f9a58ce0"
      },
      "startedAt": "2026-10-13T16:20:52.711950+00:00",
      "exitCode": 0,
      "stdout": {
        "path": "/tmp/ediel-fg-6f94-sc031-first-lint.stdout.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      },
      "stderr": {
        "path": "/tmp/ediel-fg-6f94-sc031-first-lint.stderr.log",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "bytes": 0
      }
    }
  },
  "controllerAndPreimageArtifacts": {
    "/tmp/ediel-fg-6f94-sc031-first-diffcheck.stderr.log": {
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "bytes": 0
    },
    "/tmp/ediel-fg-6f94-sc031-first-diffcheck.stdout.log": {
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "bytes": 0
    },
    "/tmp/ediel-fg-6f94-sc031-oracle-control.cjs": {
      "sha256": "ef3bd2c1347b6f0ea0fb5e361027b5cd3f7d298325eb32214788cd5c73fa7c56",
      "bytes": 7897
    },
    "/tmp/ediel-fg-6f94-sc031-parser-ports.cjs": {
      "sha256": "2d6d575762ef657cb450f43b5b3e54ad0a9f5b3875233fecdf5a08bf50b61929",
      "bytes": 2853
    },
    "/tmp/ediel-fg-6f94-sc031-g-preimage.ts": {
      "sha256": "baa6bb3e2fa811c49aebbebcf2ae0ac17f5210dc310f57d897af63c51d6222a9",
      "bytes": 46049
    },
    "/tmp/ediel-fg-6f94-sc031-f-preimage.ts": {
      "sha256": "f7b037b6e2d24f4fd4131c5eba11c9098ac5541ef57e71cc5558d5ccdf7eecd8",
      "bytes": 48353
    },
    "/tmp/ediel-fg-6f94-sc031-broad-observation-controller.cjs": {
      "sha256": "1b4af6aa0fb7cb967c48c51ffe5876850208c67aaa2fc8c1233923a179168760",
      "bytes": 4324
    },
    "/tmp/ediel-fg-6f94-sc031-first-observation-controller.cjs": {
      "sha256": "63a94e197dcc56814b09a19ac37fc7390b00ede1166467c5c8c116335d1e4bf8",
      "bytes": 4299
    },
    "/tmp/ediel-fg-6f94-sc031-run.py": {
      "sha256": "0a118b723c99db6b257173fe23a914e9ef60b0f1190b54cdc96ca61f92972d4d",
      "bytes": 1165
    },
    "/tmp/ediel-fg-6f94-sc031-observe.cjs": {
      "sha256": "1b16015f404588f76cd198d18d36bd9c3c50438f131ca508d5507fdf2dca7c44",
      "bytes": 4972
    }
  },
  "historicalObservationScaffoldFailures": {
    "first-observation": "Temporary AST export-wrapper syntax error, before parser observation; saved original/controller",
    "observation": "A broad temporary meteringPoint equality incorrectly included received raw/nested UD evidence. Narrowed only temporary observation to legitimate named installation/register values; no source or product change/RED claim. Saved original/controller.",
    "narrow-observation": "Confirms15-field clean baseline/current8 dirty business fields and evidence/legitimate installation projections. Raw parser observation itself did not qualify syntax; the final66 control adds actual fixture recount and asserts syntax on counted originals."
  },
  "unchangedRetainedOwnedPaths": {
    "scripts/helpers/ediel-z06f-reading-followup-native-fixture.ts": "bb9d77bb25a0d98cecba59ba0b2faa60d306e6b1a4ac3ea35022cf3170119961",
    "scripts/ediel-source-owner-native.config.ts": "7350c100a0587a8dc3ea964bac2aef1df3bfcc38c8825c768f4cb84739327087"
  },
  "checkpoint": "Root-owned .agent-memory/ediel-fg-proof-20261013-6f94-checkpoint.md remains unstaged/modified by root, untouched by sole test writer.",
  "publicationNativeProducerClaimOrLedgerAction": false,
  "historicalPriorApprovals": "0dbc and previous F/G/P2/source reviews preserved under their old exact attribution; they do not approve this changed source.",
  "state": "SOURCE_FROZEN_PAUSED_FOR_ROOT_CARRIER_AND_TWO_OTHER_FINAL_PEERS",
  "nextOwnerStep": "Root freezes its unique checkpoint/carrier, obtains two fresh OTHER noncoauthor source/evidence reviews on exact final head/tree/base/orderedparents/hashes/limits, and issues superseding paused source handoff. Existing decoder owner correction/current union + sole native/GEN/serial qualification remain downstream; no forced native green or approval increase."
}
```

</details>

### Sparade original och controllers

Alla block är bytebevarade UTF8 från vårt synthetic finite scope. Root har kontrollerat SHA256; inga verkliga kunddata, credentialvärden, backendoriginal eller privata correction-chattar ingår. Sourcepreimages är de redan publicerade0dbc-postbilderna, inte ny aktiv dispatch.

<details><summary>ediel-fg-6f94-sc031-first-observation.stdout.log (first-observation stdout), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-fg-6f94-sc031-first-observation.stderr.log (first-observation stderr), 713 bytes — SHA256 b871fc40c4cae548456c6b2a1f945b977a5a9992e9f79398f36de1b80cdf827f</summary>

```text
<anonymous_script>:37
export function parseInboundProdatBusinessData(message, object) {
^^^^^^

SyntaxError: Unexpected token 'export'
    at new Function (<anonymous>)
    at Object.<anonymous> (/tmp/ediel-fg-6f94-sc031-observe.cjs:9:13)
    at Module._compile (node:internal/modules/cjs/loader:1781:14)
    at Object..js (node:internal/modules/cjs/loader:1913:10)
    at Module.load (node:internal/modules/cjs/loader:1505:32)
    at Function._load (node:internal/modules/cjs/loader:1309:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:254:19)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)
    at node:internal/main/run_main_module:36:49

Node.js v22.23.3
```

</details>

<details><summary>ediel-fg-6f94-sc031-observation.stdout.log (observation stdout), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-fg-6f94-sc031-observation.stderr.log (observation stderr), 9651 bytes — SHA256 e6ba8fdf45b386999754f9d316153bb0b62a3c1dad9413595cb9bdb7c65ec042</summary>

```text
node:assert:150
  throw new AssertionError(obj);
  ^

AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected
... Skipped lines

  {
    firstMeterReadingDate: null,
    identityAgency: '9',
    measurementType: 'consumption',
    meterConstant: 1,
...
        contractStartDate: '202611010000',
+       customerId: 'FORBIDDEN-UD-F',
+       endUserAddress: 'Forbidden Street',
-       customerId: null,
-       endUserAddress: null,
        endUserAddressLines: [
+         'Forbidden Street'
-         ''
        ],
+       endUserCity: 'Town',
+       endUserCountry: 'SE',
+       endUserId: 'FORBIDDEN-UD-F',
-       endUserCity: null,
-       endUserCountry: null,
-       endUserId: null,
        endUserIdQualifier: null,
+       endUserName: 'Forbidden Identity',
-       endUserName: null,
        endUserNameLines: [
+         'Forbidden Identity'
-         ''
        ],
+       endUserPostcode: '12345',
-       endUserPostcode: null,
        energyProductId: '8716867000030',
        firstMeterReadingDate: null,
        firstRegisterSourceOrder: 0,
        gridAreaId: 'NET-1',
        hasAnnualConsumption: true,
...
          'RFF+LI:CASE-1',
+         'NAD+UD+FORBIDDEN-UD-F::89++Forbidden Identity+Forbidden Street+Town++12345+SE',
          'NAD+IT+735123456789012345::9+++Street+Town++12345+SE',
          'NAD+Z02+11111:160:SVK'
        ],
        reasonForTransaction: 'E64',
        registerCount: 1,

    at Object.<anonymous> (/tmp/ediel-fg-6f94-sc031-observe.cjs:20:49)
    at Module._compile (node:internal/modules/cjs/loader:1781:14)
    at Object..js (node:internal/modules/cjs/loader:1913:10)
    at Module.load (node:internal/modules/cjs/loader:1505:32)
    at Function._load (node:internal/modules/cjs/loader:1309:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:254:19)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)
    at node:internal/main/run_main_module:36:49 {
  generatedMessage: true,
  code: 'ERR_ASSERTION',
  actual: {
    meterPointId: '735123456789012345',
    identityAgency: '9',
    registers: [
      {
        sourceOrder: 0,
        lineSequenceNumber: '1',
        registerIndex: null,
        registerCount: 1,
        firstRegisterSourceOrder: 0,
        validRegisterChain: true,
        identityAgency: '9',
        annualConsumption: '1000',
        meterConstant: '1',
        meterDigitCount: '6',
        meterTimeFrame: '101',
        meteringPointId: '735123456789012345',
        lineItemReference: 'CASE-1',
        gridAreaId: 'NET-1',
        agreementReference: null,
        customerId: 'FORBIDDEN-UD-F',
        endUserId: 'FORBIDDEN-UD-F',
        endUserIdQualifier: null,
        endUserName: 'Forbidden Identity',
        endUserNameLines: [ 'Forbidden Identity' ],
        endUserAddressLines: [ 'Forbidden Street' ],
        invoiceeId: null,
        invoiceeName: null,
        invoiceeAddress: null,
        invoiceePostcode: null,
        invoiceeCity: null,
        invoiceeCountry: null,
        endUserAddress: 'Forbidden Street',
        endUserPostcode: '12345',
        endUserCity: 'Town',
        endUserCountry: 'SE',
        installationId: '735123456789012345',
        installationAddress: 'Street',
        installationPostcode: '12345',
        installationCity: 'Town',
        installationCountry: 'SE',
        balanceResponsibleId: '11111',
        reportingFrequency: 'D',
        energyProductId: '8716867000030',
        installationDirection: null,
        permissionStatus: null,
        permissionPurpose: null,
        permissionEndReason: null,
        permissionId: null,
        permissionTimestamp: null,
        permissionEndTimestamp: null,
        validityStartDate: '202611130000',
        firstMeterReadingDate: null,
        birthDate: null,
        observationLength: '15',
        observationLengthFormat: '806',
        contractStartDate: '202611010000',
        contractEndDate: null,
        reportStartDate: null,
        reportEndDate: null,
        historicalReportStartDate: null,
        historicalReportEndDate: null,
        isHistoricalMeteringRequest: false,
        reasonForTransaction: 'E64',
        measuringMethod: 'Z04',
        timeSeriesProduct: 'L639Q',
        meterNumber: 'METER-1',
        oldMeterNumber: null,
        supplierContractNumber: null,
        relatedMeteringPointId: null,
        calorificValueArea: null,
        serialId: null,
        hasAnnualConsumption: true,
        hasConstant: true,
        hasDigitCount: true,
        hasMeterNumber: true,
        rawSegments: [
          'LIN+1++735123456789012345:::9',
          'DTM+92:202611010000:203',
          'DTM+157:202611130000:203',
          'DTM+354:15:806',
          'QTY+31:1000:KWH',
          'CCI++Z13',
          'CAV+E64',
          'CCI++Z04',
          'CAV+Z04',
          'CCI++Z07',
          'CAV+Z12',
          'CCI++Z12',
          'CAV+:::D',
          'CCI++Z15',
          'CAV+Z32',
          'CCI++Z14',
          'CAV+:::L639Q:8716867000030',
          'CCI++Z16',
          'CAV+:::101',
          'CCI++Z02',
          'CAV+:::1',
          'CCI++Z05',
          'CAV+:::6',
          'RFF+MG:METER-1',
          'RFF+Z05:NET-1',
          'RFF+LI:CASE-1',
          'NAD+UD+FORBIDDEN-UD-F::89++Forbidden Identity+Forbidden Street+Town++12345+SE',
          'NAD+IT+735123456789012345::9+++Street+Town++12345+SE',
          'NAD+Z02+11111:160:SVK'
        ]
      }
    ],
    observationLength: '15',
    observationLengthFormat: '806',
    firstMeterReadingDate: null,
    referenceToMeteringPoint: null,
    meteringMethod: 'Z04',
    meteringMethodLabel: 'Z04 – 15 minuter',
    meterNumber: 'METER-1',
    meterConstant: 1,
    meterDigits: 6,
    meterInterval: '101',
    resolution: null,
    readingFrequency: 'D',
    measurementType: 'consumption'
  },
  expected: {
    meterPointId: '735123456789012345',
    identityAgency: '9',
    registers: [
      {
        sourceOrder: 0,
        lineSequenceNumber: '1',
        registerIndex: null,
        registerCount: 1,
        firstRegisterSourceOrder: 0,
        validRegisterChain: true,
        identityAgency: '9',
        annualConsumption: '1000',
        meterConstant: '1',
        meterDigitCount: '6',
        meterTimeFrame: '101',
        meteringPointId: '735123456789012345',
        lineItemReference: 'CASE-1',
        gridAreaId: 'NET-1',
        agreementReference: null,
        customerId: null,
        endUserId: null,
        endUserIdQualifier: null,
        endUserName: null,
        endUserNameLines: [ '' ],
        endUserAddressLines: [ '' ],
        invoiceeId: null,
        invoiceeName: null,
        invoiceeAddress: null,
        invoiceePostcode: null,
        invoiceeCity: null,
        invoiceeCountry: null,
        endUserAddress: null,
        endUserPostcode: null,
        endUserCity: null,
        endUserCountry: null,
        installationId: '735123456789012345',
        installationAddress: 'Street',
        installationPostcode: '12345',
        installationCity: 'Town',
        installationCountry: 'SE',
        balanceResponsibleId: '11111',
        reportingFrequency: 'D',
        energyProductId: '8716867000030',
        installationDirection: null,
        permissionStatus: null,
        permissionPurpose: null,
        permissionEndReason: null,
        permissionId: null,
        permissionTimestamp: null,
        permissionEndTimestamp: null,
        validityStartDate: '202611130000',
        firstMeterReadingDate: null,
        birthDate: null,
        observationLength: '15',
        observationLengthFormat: '806',
        contractStartDate: '202611010000',
        contractEndDate: null,
        reportStartDate: null,
        reportEndDate: null,
        historicalReportStartDate: null,
        historicalReportEndDate: null,
        isHistoricalMeteringRequest: false,
        reasonForTransaction: 'E64',
        measuringMethod: 'Z04',
        timeSeriesProduct: 'L639Q',
        meterNumber: 'METER-1',
        oldMeterNumber: null,
        supplierContractNumber: null,
        relatedMeteringPointId: null,
        calorificValueArea: null,
        serialId: null,
        hasAnnualConsumption: true,
        hasConstant: true,
        hasDigitCount: true,
        hasMeterNumber: true,
        rawSegments: [
          'LIN+1++735123456789012345:::9',
          'DTM+92:202611010000:203',
          'DTM+157:202611130000:203',
          'DTM+354:15:806',
          'QTY+31:1000:KWH',
          'CCI++Z13',
          'CAV+E64',
          'CCI++Z04',
          'CAV+Z04',
          'CCI++Z07',
          'CAV+Z12',
          'CCI++Z12',
          'CAV+:::D',
          'CCI++Z15',
          'CAV+Z32',
          'CCI++Z14',
          'CAV+:::L639Q:8716867000030',
          'CCI++Z16',
          'CAV+:::101',
          'CCI++Z02',
          'CAV+:::1',
          'CCI++Z05',
          'CAV+:::6',
          'RFF+MG:METER-1',
          'RFF+Z05:NET-1',
          'RFF+LI:CASE-1',
          'NAD+IT+735123456789012345::9+++Street+Town++12345+SE',
          'NAD+Z02+11111:160:SVK'
        ]
      }
    ],
    observationLength: '15',
    observationLengthFormat: '806',
    firstMeterReadingDate: null,
    referenceToMeteringPoint: null,
    meteringMethod: 'Z04',
    meteringMethodLabel: 'Z04 – 15 minuter',
    meterNumber: 'METER-1',
    meterConstant: 1,
    meterDigits: 6,
    meterInterval: '101',
    resolution: null,
    readingFrequency: 'D',
    measurementType: 'consumption'
  },
  operator: 'deepStrictEqual',
  diff: 'simple'
}

Node.js v22.23.3
```

</details>

<details><summary>ediel-fg-6f94-sc031-narrow-observation.stdout.log (narrow-observation stdout), 2570 bytes — SHA256 ff721e7747d989ad0eaeed908b60e40bbfec253367d0ddb3b009d2a0272432a2</summary>

```text
PASS actual F noUD baseline all15 namedfields; current c08e parser retains dirtyUD namedbusiness; installation/register/contract unchanged
PASS actual G noUD baseline all15 namedfields; current c08e parser retains dirtyUD namedbusiness; installation/register/contract unchanged
{"parserSHA256":"39c7e81aeabb3c88b55258248d41672f7390009b72a792421ae021c037203e5f","scope":"Actual pure parser/case projection observation; finite constructed raw input only; native NOT_RUN","expected":{"customerId":null,"customerIdQualifier":null,"customerIdLabel":"Ej angivet","customerType":null,"personalNumber":null,"orgNumber":null,"birthDate":null,"fullName":null,"companyName":null,"firstName":null,"lastName":null,"address":null,"postalCode":null,"city":null,"country":null},"variants":{"F":{"clean":{"customerId":null,"customerIdQualifier":null,"customerIdLabel":"Ej angivet","customerType":null,"personalNumber":null,"orgNumber":null,"birthDate":null,"fullName":null,"companyName":null,"firstName":null,"lastName":null,"address":null,"postalCode":null,"city":null,"country":null},"dirty":{"customerId":"FORBIDDEN-UD-F","customerIdQualifier":null,"customerIdLabel":"Ej angivet","customerType":null,"personalNumber":null,"orgNumber":null,"birthDate":null,"fullName":"Forbidden Identity","companyName":null,"firstName":"Forbidden","lastName":"Identity","address":"Forbidden Street","postalCode":"12345","city":"Town","country":"SE"},"dirtyKeys":["customerId","fullName","firstName","lastName","address","postalCode","city","country"],"retainedPhysicalRawHash":"15da4733d4403c943e4e58a096cba844bc3ace81d8fb2fb5d4fb40ebd9a06d70","legitimateInstallationRegisterProjectionUnchanged":true},"G":{"clean":{"customerId":null,"customerIdQualifier":null,"customerIdLabel":"Ej angivet","customerType":null,"personalNumber":null,"orgNumber":null,"birthDate":null,"fullName":null,"companyName":null,"firstName":null,"lastName":null,"address":null,"postalCode":null,"city":null,"country":null},"dirty":{"customerId":"FORBIDDEN-UD-G","customerIdQualifier":null,"customerIdLabel":"Ej angivet","customerType":null,"personalNumber":null,"orgNumber":null,"birthDate":null,"fullName":"Forbidden Identity","companyName":null,"firstName":"Forbidden","lastName":"Identity","address":"Forbidden Street","postalCode":"12345","city":"Town","country":"SE"},"dirtyKeys":["customerId","fullName","firstName","lastName","address","postalCode","city","country"],"retainedPhysicalRawHash":"58dd0f04ede04e14196a5b70843859f1cd5449dabe47fcca1c88eebb09737012","legitimateInstallationRegisterProjectionUnchanged":true}}}
```

</details>

<details><summary>ediel-fg-6f94-sc031-narrow-observation.stderr.log (narrow-observation stderr), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-fg-6f94-sc031-first-oracle.stdout.log (first-oracle stdout), 4748 bytes — SHA256 f59248db272f50fcc826e572be94cf451bcf7b2089ed228ccdb0b7e6ba24a55e</summary>

```text
PASS FINITE F clean noUD baseline + counted valid extraUD original
PASS FINITE F staging actual oracle accepts exact clean named customer vector
PASS FINITE F staging actual oracle rejects current c08e dirty named customer projection
PASS FINITE F approval actual oracle accepts exact clean named customer vector
PASS FINITE F approval actual oracle rejects current c08e dirty named customer projection
PASS FINITE F replay actual oracle accepts exact clean named customer vector
PASS FINITE F replay actual oracle rejects current c08e dirty named customer projection
PASS FINITE F rejects independently dirty named business field customerId
PASS FINITE F rejects independently dirty named business field customerIdQualifier
PASS FINITE F rejects independently dirty named business field customerIdLabel
PASS FINITE F rejects independently dirty named business field customerType
PASS FINITE F rejects independently dirty named business field personalNumber
PASS FINITE F rejects independently dirty named business field orgNumber
PASS FINITE F rejects independently dirty named business field birthDate
PASS FINITE F rejects independently dirty named business field fullName
PASS FINITE F rejects independently dirty named business field companyName
PASS FINITE F rejects independently dirty named business field firstName
PASS FINITE F rejects independently dirty named business field lastName
PASS FINITE F rejects independently dirty named business field address
PASS FINITE F rejects independently dirty named business field postalCode
PASS FINITE F rejects independently dirty named business field city
PASS FINITE F rejects independently dirty named business field country
PASS FINITE F rejects foreign tenant
PASS FINITE F rejects other source
PASS FINITE F rejects other case
PASS FINITE F rejects wrong status
PASS FINITE F rejects missing customer projection
PASS FINITE F rejects missing named field
PASS FINITE F rejects missing actual case rather than generic noUD fallback
PASS FINITE F preserves own physical ignored facets/raw and legitimate installation/register fields
PASS FINITE F all existing direct native cases and helper ASTs retained
PASS FINITE F every existing assertion retained in exact AST order
PASS FINITE F exact staging/approval/replay helper calls registered on both positive variants
PASS FINITE G clean noUD baseline + counted valid extraUD original
PASS FINITE G staging actual oracle accepts exact clean named customer vector
PASS FINITE G staging actual oracle rejects current c08e dirty named customer projection
PASS FINITE G approval actual oracle accepts exact clean named customer vector
PASS FINITE G approval actual oracle rejects current c08e dirty named customer projection
PASS FINITE G replay actual oracle accepts exact clean named customer vector
PASS FINITE G replay actual oracle rejects current c08e dirty named customer projection
PASS FINITE G rejects independently dirty named business field customerId
PASS FINITE G rejects independently dirty named business field customerIdQualifier
PASS FINITE G rejects independently dirty named business field customerIdLabel
PASS FINITE G rejects independently dirty named business field customerType
PASS FINITE G rejects independently dirty named business field personalNumber
PASS FINITE G rejects independently dirty named business field orgNumber
PASS FINITE G rejects independently dirty named business field birthDate
PASS FINITE G rejects independently dirty named business field fullName
PASS FINITE G rejects independently dirty named business field companyName
PASS FINITE G rejects independently dirty named business field firstName
PASS FINITE G rejects independently dirty named business field lastName
PASS FINITE G rejects independently dirty named business field address
PASS FINITE G rejects independently dirty named business field postalCode
PASS FINITE G rejects independently dirty named business field city
PASS FINITE G rejects independently dirty named business field country
PASS FINITE G rejects foreign tenant
PASS FINITE G rejects other source
PASS FINITE G rejects other case
PASS FINITE G rejects wrong status
PASS FINITE G rejects missing customer projection
PASS FINITE G rejects missing named field
PASS FINITE G rejects missing actual case rather than generic noUD fallback
PASS FINITE G preserves own physical ignored facets/raw and legitimate installation/register fields
PASS FINITE G all existing direct native cases and helper ASTs retained
PASS FINITE G every existing assertion retained in exact AST order
PASS FINITE G exact staging/approval/replay helper calls registered on both positive variants
TOTAL FINITE 66 PASS, 0 FAIL; current parser dirty projections rejected, upstream UNFIXED; native NOT_RUN
```

</details>

<details><summary>ediel-fg-6f94-sc031-first-oracle.stderr.log (first-oracle stderr), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-fg-6f94-sc031-first-type.stdout.log (first-type stdout), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-fg-6f94-sc031-first-type.stderr.log (first-type stderr), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-fg-6f94-sc031-first-lint.stdout.log (first-lint stdout), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-fg-6f94-sc031-first-lint.stderr.log (first-lint stderr), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-fg-6f94-sc031-first-diffcheck.stderr.log (controller/preimage/diff original), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-fg-6f94-sc031-first-diffcheck.stdout.log (controller/preimage/diff original), 0 bytes — SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</summary>

```text
```

</details>

<details><summary>ediel-fg-6f94-sc031-oracle-control.cjs (controller/preimage/diff original), 7897 bytes — SHA256 ef3bd2c1347b6f0ea0fb5e361027b5cd3f7d298325eb32214788cd5c73fa7c56</summary>

```javascript
// Actual new assertion AST + actual pure parser/tokenizer/policy dependencies.
// Explicit modeled case rows only; no case/native/database writes or credits.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto'),root='/workspace/ediel-fg-proof-20261013-6f94',ts=require(root+'/node_modules/typescript'),{load}=require('/tmp/ediel-fg-6f94-model-ports.cjs')
const {parse,keys,expected,scope,wireApi,token,changed,project,pick}=require('/tmp/ediel-fg-6f94-sc031-parser-ports.cjs')
const partial=(a,e)=>{if(e&&typeof e==='object')for(const[k,v]of Object.entries(e))partial(a?.[k],v);else assert.deepEqual(a,e)}
const expect=a=>({toBe:e=>assert.equal(a,e),toEqual:e=>assert.deepEqual(a,e),toMatchObject:e=>partial(a,e),not:{toBeNull:()=>assert.notEqual(a,null)}})
function oracle(kind){const code=pick(root+`/scripts/ediel-at-z06${kind.toLowerCase()}-supplier-acceptance-native.test.ts`,['expectCleanStagedCustomer']);assert.ok(code);return new Function('expect',ts.transpileModule(code+'\nreturn expectCleanStagedCustomer',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(expect)}
const recountCode=pick(root+'/scripts/helpers/ediel-z06f-reading-followup-native-fixture.ts',['recountChangedMessage'])
const recount=new Function('tokenizeEdifact','segmentSourceSpan','segmentComposite',ts.transpileModule(recountCode+'\nreturn recountChangedMessage',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(token.tokenizeEdifact,token.segmentSourceSpan,token.segmentComposite)
const syntax=load(root+'/lib/ediel/core/edifactValidation.ts'),policyApi=load(root+'/lib/ediel/rulebook/canonicalEdielPolicy.ts'),validator=load(root+'/lib/ediel/rulebook/canonicalPolicyFieldValidator.ts')
let count=0,failed=0;function control(name,fn){try{fn();count++;console.log('PASS FINITE '+name)}catch(e){failed++;console.log('FAIL FINITE '+name+': '+e.message)}}
for(const kind of ['F','G']){
 const cleanRaw=wireApi.z06fNativeStructureWire(scope,kind,'DECLARED-'+kind),raw=recount(changed(kind,cleanRaw)),id='00000000-0000-4000-8000-000000000006',company='00000000-0000-4000-8000-000000000001',caseId='00000000-0000-4000-8000-000000000080'
 const message={id,company_id:company,direction:'inbound',message_family:'PRODAT',message_code:'Z06',raw_payload:raw,parsed_payload:{customerId:'POISON-CACHED',customerName:'POISON CACHED'}},clean=parse({...message,raw_payload:cleanRaw}),dirty=parse(message),f={f:{companyId:company}},change={message},check=oracle(kind)
 const row=(status,customer=clean.customer)=>({id:caseId,company_id:company,ediel_message_id:id,message_code:'Z06',status,parsed_customer:customer})
 control(kind+' clean noUD baseline + counted valid extraUD original',()=>{assert.deepEqual(project(clean.customer),expected);assert.equal(syntax.validateEdifactEnvelope(cleanRaw).syntaxOk,true);assert.equal(syntax.validateEdifactEnvelope(raw).syntaxOk,true);assert.ok(raw.includes('FORBIDDEN-UD-'+kind))})
 for(const[phase,status]of [['staging','pending_review'],['approval','applied'],['replay','applied']]){
  control(kind+' '+phase+' actual oracle accepts exact clean named customer vector',()=>check(f,change,row(status),caseId,status))
  control(kind+' '+phase+' actual oracle rejects current c08e dirty named customer projection',()=>assert.throws(()=>check(f,change,row(status,dirty.customer),caseId,status)))
 }
 for(const key of keys)control(kind+' rejects independently dirty named business field '+key,()=>assert.throws(()=>check(f,change,row('pending_review',{...clean.customer,[key]:'NON_SENTINEL_CUSTOMER_VALUE'}),caseId,'pending_review')))
 for(const[name,mutate]of [['foreign tenant',r=>r.company_id='FOREIGN'],['other source',r=>r.ediel_message_id='OTHER'],['other case',r=>r.id='OTHER'],['wrong status',r=>r.status='failed'],['missing customer projection',r=>delete r.parsed_customer],['missing named field',r=>delete r.parsed_customer.birthDate]])control(kind+' rejects '+name,()=>{const r=structuredClone(row('pending_review'));mutate(r);assert.throws(()=>check(f,change,r,caseId,'pending_review'))})
 control(kind+' rejects missing actual case rather than generic noUD fallback',()=>assert.throws(()=>check(f,change,null,caseId,'pending_review')))
 control(kind+' preserves own physical ignored facets/raw and legitimate installation/register fields',()=>{
  const wire=token.tokenizeEdifact(raw),ignored=[],policy=policyApi.resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z06',subtypeOrReasonCode:kind,direction:'inbound',applicationReference:'23-DDQ-PRODAT',referenceDate:'2026-10-13',mode:'catalog_evidence',prodatDependentFacts:{market:'electricity',meterReadingsSentInUtilts:true}})
  validator.validateCanonicalPolicyFields({policy,rawPayload:raw,rawSegments:wire.segments.map(s=>s.raw),una:wire.una,onIgnoredField:v=>ignored.push(v)})
  const wanted=['END_USER_GROUP','227','228','229','231','232','316'];assert.deepEqual(ignored.filter(v=>wanted.includes(v.fieldNumber)).map(v=>v.fieldNumber).sort(),wanted.sort())
  for(const v of ignored.filter(v=>wanted.includes(v.fieldNumber)))assert.equal(v.occurrence.ownReferences.customerId.value,'FORBIDDEN-UD-'+kind)
  assert.deepEqual(clean.site,dirty.site);assert.deepEqual(clean.contract,dirty.contract)
  const meterKeys=['meterPointId','identityAgency','meterNumber','meterConstant','meterDigits','meterInterval','readingFrequency','measurementType'];for(const k of meterKeys)assert.deepEqual(clean.meteringPoint[k],dirty.meteringPoint[k])
  assert.ok(dirty.meteringPoint.registers[0].rawSegments.some(v=>v.startsWith('NAD+UD+FORBIDDEN-UD-'+kind)))
 })
 const file=`scripts/ediel-at-z06${kind.toLowerCase()}-supplier-acceptance-native.test.ts`,pre=fs.readFileSync(`/tmp/ediel-fg-6f94-sc031-${kind.toLowerCase()}-preimage.ts`,'utf8'),current=fs.readFileSync(root+'/'+file,'utf8'),printer=ts.createPrinter({removeComments:true})
 const statements=text=>{const src=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);return{src,body:src.statements.filter(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(src)==='it').map(n=>printer.printNode(ts.EmitHint.Unspecified,n,src))}}
 control(kind+' all existing direct native cases and helper ASTs retained',()=>{const old=statements(pre),now=statements(current);assert.deepEqual(old.body,now.body);for(const fn of old.src.statements.filter(ts.isFunctionDeclaration)){const n=now.src.statements.find(x=>ts.isFunctionDeclaration(x)&&x.name.text===fn.name.text);assert.equal(printer.printNode(ts.EmitHint.Unspecified,n,now.src),printer.printNode(ts.EmitHint.Unspecified,fn,old.src))}})
 control(kind+' every existing assertion retained in exact AST order',()=>{
  const calls=text=>{const src=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true),out=[];function visit(n){if(ts.isExpressionStatement(n)&&n.getText(src).trim().startsWith('expect('))out.push(printer.printNode(ts.EmitHint.Unspecified,n,src));ts.forEachChild(n,visit)}visit(src);return out}
  const before=calls(pre),after=calls(current);let i=0;for(const item of after)if(item===before[i])i++;assert.equal(i,before.length)
 })
 const src=ts.createSourceFile(file,current,ts.ScriptTarget.Latest,true),sites=[];function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(src)==='expectCleanStagedCustomer')sites.push(n.getText(src));ts.forEachChild(n,visit)}visit(src)
 control(kind+' exact staging/approval/replay helper calls registered on both positive variants',()=>{assert.equal(sites.length,3);assert.match(sites[0],/before.case,current.inboundCase.id,'pending_review'/);assert.match(sites[1],/after.case,approved.id,'applied'/);assert.match(sites[2],/evidence\(f,change.message.id\).case,replay.id,'applied'/)})
}
console.log('TOTAL FINITE '+count+' PASS, '+failed+' FAIL; current parser dirty projections rejected, upstream UNFIXED; native NOT_RUN');process.exitCode=failed?1:0
```

</details>

<details><summary>ediel-fg-6f94-sc031-parser-ports.cjs (controller/preimage/diff original), 2853 bytes — SHA256 2d6d575762ef657cb450f43b5b3e54ad0a9f5b3875233fecdf5a08bf50b61929</summary>

```javascript
// Actual unchanged parser AST through real pure parser dependencies only.
// Constructed physical inputs; no DB/case write/native authority is executed.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const root='/workspace/ediel-fg-proof-20261013-6f94',ts=require(root+'/node_modules/typescript'),{load}=require('/tmp/ediel-fg-6f94-model-ports.cjs')
function pick(file,names){const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true),printer=ts.createPrinter();return source.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name.text)).map(n=>printer.printNode(ts.EmitHint.Unspecified,n,source)).join('\n')}
const modules=['lib/ediel/prodat/parser.ts','lib/ediel/prodat/prodatRegisterFields.ts','lib/ediel/prodat/prodatDateFields.ts','lib/ediel/prodat/render/dates.ts','lib/ediel/prodat/prodatPartyFields.ts','lib/ediel/prodat/prodatReferenceFields.ts','lib/ediel/prodat/prodatCharacteristicFields.ts','lib/ediel/core/edifactSegments.ts','lib/ediel/core/una.ts','lib/ediel/codeLabels.ts']
const ports=Object.assign({},...modules.map(m=>load(root+'/'+m))),names=Object.keys(ports),helpers=['trimOrNull','normalizeUpper','normalizeDigits','edifactDateToIsoDate','numberOrNull','valueFromParsed','parseInboundProdatBusinessData']
const code=pick(root+'/lib/ediel/inboundCases.ts',helpers).replace(/^export /gm,'')+'\nreturn parseInboundProdatBusinessData'
const parse=new Function(...names,ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...names.map(n=>ports[n]))
const token=load(root+'/lib/ediel/core/edifactTokenizer.ts'),wireApi=load(root+'/scripts/helpers/ediel-z06f-reading-followup-native-wire.ts')
const scope={external:'735123456789012345',sender:'54321',receiver:'12345',brpEdielId:'11111',caseReference:'CASE-1',gridAreaCode:'NET-1',requestedStartDate:'2026-11-01'}
const keys=['customerId','customerIdQualifier','customerIdLabel','customerType','personalNumber','orgNumber','birthDate','fullName','companyName','firstName','lastName','address','postalCode','city','country'],expected=Object.fromEntries(keys.map(k=>[k,k==='customerIdLabel'?'Ej angivet':null]))
function changed(kind,raw){const snippet=pick(root+`/scripts/ediel-at-z06${kind.toLowerCase()}-supplier-acceptance-native.test.ts`,['extraUd']);const fn=new Function('tokenizeEdifact','segmentComposite','segmentSourceSpan','expect',ts.transpileModule(snippet+'\nreturn extraUd',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(token.tokenizeEdifact,token.segmentComposite,token.segmentSourceSpan,a=>({toHaveLength:n=>assert.equal(a.length,n)}));return fn(raw)}
function project(customer){return Object.fromEntries(keys.map(k=>[k,customer[k]]))}
module.exports={parse,keys,expected,scope,wireApi,token,changed,project,pick};
```

</details>

<details><summary>ediel-fg-6f94-sc031-g-preimage.ts (controller/preimage/diff original), 46049 bytes — SHA256 baa6bb3e2fa811c49aebbebcf2ae0ac17f5210dc310f57d897af63c51d6222a9</summary>

```typescript
// Acceptance evidence for AT-Z06G-SUPPLIER (human reference only).
// Native execution remains NOT_RUN for these additive first-effect controls.
// Retained already-applied cases and their assertions remain unchanged below.
// Optional existing-fixture input/deferred-apply seams add real first-case,
// physical ignored UD and source-refusal proofs without seeding acceptance.
// Existing qualified producer alone executes the native suite. No coverage approval.
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {createZ06fReadingNativeFixture} from './helpers/ediel-z06f-reading-followup-native-fixture'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {approveEdielInboundCase,createOrUpdateInboundProdatCase,getEdielInboundCaseForMessage} from '@/lib/ediel/inboundCases'
import {getEdielMessageById} from '@/lib/ediel/db'
import {readReceivedProdatFinalResponsePlan} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,segmentSourceSpan,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {supabaseService} from '@/lib/supabase/service'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {reviewReceivedStructuralSource} from '@/lib/ediel/sources/reviewReceivedStructuralSource'
import {approveSafeMasterdataChanges} from '@/lib/ediel/safeApplyReview'
import {readReceivedProdatApplicationObjects} from '@/lib/ediel/core/receivedProdatApplicationObjects'
import {captureFreshEdielSourceRulePackEvidence,requireEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import type {SourceOwnerReceipt} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import type {EdielMessageRow} from '@/lib/ediel/types'

// Declared external port required by the existing signed-original producer.
// This SMTP result proves neither delivery to a real counterparty nor transport
// approval. Source, SQL, actor, case, ACK and outbox implementations are real.
const external=vi.hoisted(()=>({send:vi.fn()}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:external.send})}}))
beforeEach(()=>{
 vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS','synthetic@example.invalid')
 vi.stubEnv('EDIEL_APP_DKIM_ENABLED','false')
 vi.stubEnv('EMAIL_PROVIDER','resend');vi.stubEnv('EDIEL_EMAIL_PROVIDER','strato')
 vi.stubEnv('EDIEL_SMTP_FROM','synthetic@example.invalid')
 vi.stubEnv('EDIEL_SMTP_USER','synthetic@example.invalid')
 vi.stubEnv('EDIEL_SMTP_PASS','synthetic-only')
 external.send.mockReset()
})
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
const fixture=()=>createZ06fReadingNativeFixture(email=>external.send.mockResolvedValue({
 accepted:[email],rejected:[],messageId:'synthetic-FG-acceptance-original',
 response:'250 explicitly synthetic accepted',
}))
type Fixture=Awaited<ReturnType<typeof fixture>>
type Change=Awaited<ReturnType<Fixture['change']>>
type Evidence={
 source:Record<string,unknown>
 market:Record<string,unknown>
 original:Record<string,unknown>
 receipts:Record<string,unknown>
 expectations:Record<string,unknown>[]
 observations:Record<string,unknown>[]
 acks:EdielMessageRow[]
 outbox:Record<string,unknown>[]
 events:Record<string,unknown>[]
 case:Record<string,unknown>|null
}

// Public disposable routing INPUT only, following the established raw-scope
// native suite. No protected readiness, authority, grant, permission registry,
// issuer mandate or original-capture fact is inserted by these acceptance files.
function configureAckRoute(f:Fixture){
 const routeId=randomUUID(),profileId=randomUUID(),smtp=edielSmtpConfig()
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
 VALUES(${literal(routeId)},${literal(f.f.companyId)},'Synthetic G acceptance ACK route','ediel_ack',${literal(f.f.gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,payload_format,transport_security_mode,smtp_to,receiver_email,mailbox,smtp_host,smtp_port)
 VALUES(${literal(profileId)},${literal(f.f.companyId)},${literal(routeId)},'Synthetic G acceptance ACK profile','test','edifact',${literal(f.f.sender)},${literal(f.f.receiver)},'23-DDQ-PRODAT',true,true,'edifact','unencrypted','recipient@example.invalid','recipient@example.invalid',${literal(smtp.from)},${literal(smtp.host)},${literal(smtp.port)});`)
 return {routeId,profileId}
}
function evidence(f:Fixture,sourceId:string):Evidence{
 const company=literal(f.f.companyId),source=literal(sourceId)
 return sql<Evidence>(`SELECT jsonb_build_object(
 'source',(SELECT jsonb_build_object('id',id,'company',company_id,'environment',environment,'direction',direction,'family',message_family,'code',message_code,'raw',raw_payload,'receivedAt',message_received_at,'sha256',encode(sha256(convert_to(raw_payload,'UTF8')),'hex')) FROM public.ediel_messages WHERE id=${source} AND company_id=${company}),
 'original',(SELECT to_jsonb(s) FROM gridex_received_sources.sources s WHERE source_message_id=${source} AND company_id=${company}),
 'market',jsonb_build_object(
  'customers',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customers r WHERE company_id=${company}),
  'sites',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customer_sites r WHERE company_id=${company}),
  'points',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.metering_points r WHERE company_id=${company}),
  'supply',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customer_supply_periods r WHERE company_id=${company}),
  'customerContracts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customer_contracts r WHERE company_id=${company}),
  'series',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.meter_reading_series r WHERE company_id=${company}),
  'graphs',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customer_onboarding_operations r WHERE company_id=${company}),
  'marketOutbound',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_messages r WHERE company_id=${company} AND direction='outbound' AND message_family NOT IN('CONTRL','APERAK','UTILTS_ERR'))),
 'receipts',jsonb_build_object(
  'objects',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id,r.first_line_index),'[]') FROM gridex_received_sources.structural_object_apply_receipts r WHERE company_id=${company}),
  'batches',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id,r.requested_scope_key),'[]') FROM gridex_received_sources.structural_apply_batches r WHERE company_id=${company})),
 'expectations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_received_reading_expectations.expectations r WHERE company_id=${company}),
 'observations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.expectation_id,r.transaction_id),'[]') FROM gridex_received_reading_expectations.observations r WHERE company_id=${company}),
 'acks',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_messages r WHERE company_id=${company} AND related_message_id=${source} AND direction='outbound'),
 'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_outbox r WHERE company_id=${company} AND source_message_id=${source}),
 'events',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_message_events r WHERE company_id=${company} AND ediel_message_id=${source}),
 'case',(SELECT to_jsonb(r) FROM public.ediel_inbound_cases r WHERE company_id=${company} AND ediel_message_id=${source}))`)
}
function physical(change:Change){
 const wire=tokenizeEdifact(change.message.raw_payload!),lin=wire.segments.filter(segment=>segment.tag==='LIN')
 expect(lin).toHaveLength(1)
 const li=wire.segments.filter(segment=>segment.tag==='RFF'&&segmentComposite(segment,1,wire.una)[0]==='LI')
 const bgm=wire.segments.find(segment=>segment.tag==='BGM')!
 expect(li).toHaveLength(1)
 return {lineIndex:lin[0].index,li:segmentComposite(li[0],1,wire.una)[1],document:segmentComposite(bgm,2,wire.una)[0]}
}
async function pending(f:Fixture,change:Change){
 await processInboundEdielMessage({actorUserId:f.operator.id,edielMessageId:change.message.id})
 const actual=await getEdielMessageById(change.message.id)
 expect(actual).not.toBeNull()
 expect(actual!.raw_payload).toBe(change.message.raw_payload)
 const created=await createOrUpdateInboundProdatCase({actorUserId:f.operator.id,message:actual!})
 const saved=await getEdielInboundCaseForMessage(f.f.companyId,change.message.id)
 expect(saved).not.toBeNull();expect(created?.id).toBe(saved!.id)
 expect(saved).toMatchObject({company_id:f.f.companyId,ediel_message_id:change.message.id,status:'pending_review',message_code:'Z06'})
 return {actual:actual!,inboundCase:saved!,scope:physical(change)}
}
function expectOwnAcks(f:Fixture,change:Change,route:{routeId:string;profileId:string},stored:Evidence){
 const own=physical(change),sourceEnvelope=EdifactEnvelopeCodec.decode(change.message.raw_payload!)
 expect(stored.acks.map(ack=>ack.message_family).sort()).toEqual(['APERAK','CONTRL'])
 for(const ack of stored.acks){
  expect(ack).toMatchObject({company_id:f.f.companyId,environment:'test',direction:'outbound',related_message_id:change.message.id,ack_outcome:'positive'})
  expect(validateEdifactEnvelope(ack.raw_payload!).syntaxOk).toBe(true)
  const envelope=EdifactEnvelopeCodec.decode(ack.raw_payload!)
  expect(envelope.sender).toBe(sourceEnvelope.receiver);expect(envelope.receiver).toBe(sourceEnvelope.sender)
  const correlation=readPhysicalAckSourceCorrelation(ack,change.message)
  expect(correlation.classification.outcome).toBe('positive')
  if(ack.message_family==='CONTRL'){
   expect(correlation.scope).toBe('interchange')
   expect(correlation.acknowledgedReferences).toEqual([sourceEnvelope.interchangeReference!.slice(0,14)])
  }else{
   expect(ack.communication_route_id).toBe(route.routeId)
   expect(ack.route_profile_id).toBe(route.profileId)
   expect(correlation.lookupReferences).toContainEqual({type:'BGM_REF',value:own.document})
   expect(correlation.prodatObjectOutcomes).toEqual([{objectId:f.f.external,identityAgency:'9',firstLineIndex:own.lineIndex,lineItemReference:own.li,outcome:'positive'}])
   const wire=tokenizeEdifact(ack.raw_payload!)
   expect(wire.segments.filter(segment=>segment.tag==='ERC').map(segment=>segmentComposite(segment,1,wire.una)[0])).toEqual(['100'])
  }
 }
 expect(stored.outbox).toHaveLength(2)
 for(const ack of stored.acks){
  const entries=stored.outbox.filter(row=>row.ediel_message_id===ack.id)
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({company_id:f.f.companyId,source_message_id:change.message.id,environment:'test',message_family:ack.message_family,ack_outcome:'positive'})
 }
}

// Proposed native controls deliberately fail if actual canonical auth, technical
// endpoint, source-bound route or ACK prerequisites are absent. They do not skip,
// catch-and-pass, seed missing permission keys or substitute mocked effects.
// Current field306 fixture uses national Z12; canonical list is Z11/Z12.
// These unexecuted controls require actual guide-valid source admission.
it('already-applied G source reaches real inbound case, own physical ACK/outbox and immutable retained replay',async()=>{
 const f=await fixture(),change=await f.change('G'),route=configureAckRoute(f)
 const initial=evidence(f,change.message.id),current=await pending(f,change)
 const before=evidence(f,change.message.id)
 expect(before.acks.map(ack=>ack.message_family)).toEqual(['CONTRL'])
 expect(before.market).toEqual(initial.market);expect(before.source).toEqual(initial.source);expect(before.original).toEqual(initial.original)
 const approved=await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(approved).toMatchObject({company_id:f.f.companyId,status:'applied',ediel_message_id:change.message.id})
 const after=evidence(f,change.message.id)
 expectOwnAcks(f,change,route,after)
 expect(after.source).toEqual(initial.source)
 expect(after.source.sha256).toBe(createHash('sha256').update(change.message.raw_payload!).digest('hex'))
 expect(after.original).toEqual(initial.original);expect(after.market).toEqual(initial.market)
 expect(after.receipts).toEqual(initial.receipts)
 expect(after.expectations).toEqual(initial.expectations);expect(after.observations).toEqual([])
 expect(after.expectations).toEqual([])
 const readingView=await f.read(change.message.id)
 expect(readingView.error).toBeNull()
 expect(readingView.data).toMatchObject({expectations:[]})
 const final=await readReceivedProdatFinalResponsePlan({companyId:f.f.companyId,sourceMessageId:change.message.id,rawPayload:change.message.raw_payload!})
 expect(final).not.toBeNull();expect(final!.totalObjectCount).toBe(1)
 expect(final!.plans).toMatchObject([{outcome:'positive',objectLineIndices:[current.scope.lineIndex],acknowledgedReferences:[current.scope.li],effectKind:'structural'}])
 const ackIds=after.acks.filter(ack=>ack.message_family==='APERAK').map(ack=>ack.id)
 expect(approved.review_decision).toMatchObject({structuralApplication:{version:1,sourceMessageId:change.message.id,objectLineIndices:[current.scope.lineIndex],appliedCount:1,appliedObjectCount:1,totalObjectCount:1,ackIds}})
 const replay=await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:approved.id,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(replay.status).toBe('applied')
 const stable=evidence(f,change.message.id)
 // Re-review timestamps may advance; immutable market/response originals do not.
 expect({...stable,case:null}).toEqual({...after,case:null})
 expect(replay.review_decision).toEqual(approved.review_decision)
 expect(stable.acks.map(ack=>ack.id)).toEqual(after.acks.map(ack=>ack.id))
 expect(external.send).toHaveBeenCalledTimes(1)
})

it('G case refuses foreign tenant/actor/graph selections and invalid own LIN scopes without new effects',async()=>{
 const f=await fixture(),foreign=await fixture(),change=await f.change('G')
 configureAckRoute(f)
 const current=await pending(f,change),before=evidence(f,change.message.id),foreignBefore=evidence(foreign,foreign.f.source)
 const base={companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id}
 const invalid=[
  {override:{companyId:foreign.f.companyId},reason:'TENANT_CONTEXT_MISMATCH'},
  {override:{actorUserId:foreign.operator.id},reason:'ediel_tenant_actor_forbidden'},
  {override:{mode:'create_new_customer' as const},reason:'structural_apply_original_scope_required'},
  {override:{selectedCustomerId:foreign.f.customerId},reason:'structural_apply_original_scope_required'},
  {override:{selectedSiteId:foreign.f.siteId},reason:'structural_apply_original_scope_required'},
  {override:{selectedMeteringPointId:foreign.f.pointId},reason:'structural_apply_original_scope_required'},
  {override:{structuralObjectLineIndices:[]},reason:'structural_apply_requested_scope_invalid'},
  {override:{structuralObjectLineIndices:[current.scope.lineIndex,current.scope.lineIndex]},reason:'structural_apply_requested_scope_invalid'},
  {override:{structuralObjectLineIndices:[-1]},reason:'structural_apply_requested_scope_invalid'},
  {override:{structuralObjectLineIndices:[1.5]},reason:'structural_apply_requested_scope_invalid'},
  {override:{structuralObjectLineIndices:[current.scope.lineIndex+10000]},reason:'structural_apply_requested_scope_invalid'},
 ]
 for(const attempt of invalid){
  await expect(approveEdielInboundCase({...base,...attempt.override})).rejects.toThrow(attempt.reason)
  expect(evidence(f,change.message.id)).toEqual(before)
  expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
 }
 // Positive contrast consumes the same unaltered original after all refusals.
 const approved=await approveEdielInboundCase({...base,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(approved.status).toBe('applied')
 expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
 sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active,valid_from)
 VALUES(${literal(f.operator.id)},${literal(f.f.companyId)},'communication.write','deny',true,clock_timestamp()-interval '1 second');`)
 const deniedBefore=evidence(f,change.message.id)
 await expect(approveEdielInboundCase({...base,structuralObjectLineIndices:[current.scope.lineIndex]})).rejects.toThrow('ediel_tenant_permission_forbidden')
 expect(evidence(f,change.message.id)).toEqual(deniedBefore)
 expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
})

// First-effect evidence is additive to the retained already-applied controls.
// Intake finishes its own canonical session. The manual first-effect review
// follows that actual intake, rather than borrowing an earlier review revision.
async function pendingFirstApplication(f:Fixture,change:Change){
 const current=await pending(f,change)
 expect(await reviewReceivedStructuralSource({companyId:f.f.companyId,environment:'test',sourceMessageId:change.message.id,reviewerUserId:f.operator.id,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 return current
}
// Every protected source/assessment/apply/ACK implementation remains real.
function sourceEffects(f:Fixture,sourceId:string){
 const company=literal(f.f.companyId),source=literal(sourceId)
 return sql<{
  objects:{source_message_id:string;first_line_index:number;company_id:string;environment:string;payload_hash:string;canonical_assessment_id:string;object_assessment_id:string;actor_user_id:string;source_received_at:string;object_scope:{objectId:string;identityAgency:string;registers:{segmentIndex:number;registerPosition:number}[]};effect:{effectiveAt:string;sourceReceivedAt:string;sourceRegisters:{register:{segmentIndex:number};tokens:{tag:string;elements:string[][]}[]}[]}}[]
  batches:Record<string,unknown>[]
  expectations:Record<string,unknown>[]
  observations:Record<string,unknown>[]
  ignored:{source_payload_hash:string;fields_hash:string;fields_text:string}|null
 }>(`SELECT jsonb_build_object(
 'objects',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.first_line_index),'[]') FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'batches',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.requested_scope_key),'[]') FROM gridex_received_sources.structural_apply_batches r WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'expectations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_received_reading_expectations.expectations r WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'observations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.expectation_id,o.transaction_id),'[]') FROM gridex_received_reading_expectations.observations o JOIN gridex_received_reading_expectations.expectations e ON e.id=o.expectation_id WHERE e.company_id=${company} AND e.source_message_id=${source}),
 'ignored',(SELECT to_jsonb(i) FROM gridex_received_sources.prodat_ignored_field_facets i JOIN gridex_received_sources.validation_assessments v ON v.id=i.canonical_assessment_id WHERE i.company_id=${company} AND i.source_message_id=${source} AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)))`)
}

type RefusalEvidence={
 context:{source_message_id:string;company_id:string;environment:string;direction:string;payload_sha256:string;source_received_at:string;observed_at:string;status:string;reason:string|null;context:Record<string,unknown>}|null
 rules:{source_message_id:string;company_id:string;environment:string;direction:string;payload_sha256:string;captured_at:string;canonical_assessment_id:string}|null
 ruleCanonical:{id:string;source_message_id:string;company_id:string;environment:string;source_payload_hash:string}|null
 canonical:{id:string;source_message_id:string;company_id:string;environment:string;source_payload_hash:string;facts_text:string;facts_hash:string}|null
 assessment:{id:string;source_message_id:string;company_id:string;environment:string;source_payload_hash:string;canonical_assessment_id:string;facts_text:string;facts_hash:string}|null
 witness:{id:string;assessment_id:string;company_id:string;environment:string;source_message_id:string;facts_hash:string;observed_at:string}|null
 ownReceiverCount:number;ownPointCount:number
}
function refusalEvidence(f:Fixture,message:EdielMessageRow):RefusalEvidence{
 const wire=tokenizeEdifact(message.raw_payload!),receiver=wire.segments.find(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='DO')!,point=wire.segments.find(segment=>segment.tag==='LIN')!
 const company=literal(f.f.companyId),source=literal(message.id),legal=literal(segmentComposite(receiver,2,wire.una)[0]),external=literal(segmentComposite(point,3,wire.una)[0])
 return sql<RefusalEvidence>(`SELECT jsonb_build_object(
 'context',(SELECT to_jsonb(r) FROM gridex_ediel_inbound_context.receipts r WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'rules',(SELECT to_jsonb(r) FROM gridex_ediel_source_rules.receipts r WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'ruleCanonical',(SELECT to_jsonb(v) FROM gridex_received_sources.validation_assessments v JOIN gridex_ediel_source_rules.receipts r ON r.canonical_assessment_id=v.id WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'canonical',(SELECT to_jsonb(v) FROM gridex_received_sources.validation_assessments v WHERE v.company_id=${company} AND v.source_message_id=${source} AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)),
 'assessment',(SELECT to_jsonb(a) FROM gridex_received_sources.object_assessments a WHERE a.company_id=${company} AND a.source_message_id=${source} AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=a.id)),
 'witness',(SELECT to_jsonb(w) FROM gridex_received_sources.object_availability_witnesses w JOIN gridex_received_sources.object_assessments a ON a.id=w.assessment_id WHERE a.company_id=${company} AND a.source_message_id=${source} AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=a.id)),
 'ownReceiverCount',(SELECT count(DISTINCT i.company_id) FROM public.tenant_actor_identifiers i JOIN gridex_ediel_inbound_context.receipts r ON r.source_message_id=${source} WHERE i.company_id=${company} AND i.environment='test' AND i.identifier_type='EdielId' AND i.identifier_value=${legal} AND i.valid_from<=r.observed_at AND(i.valid_to IS NULL OR r.observed_at<i.valid_to)),
 'ownPointCount',(SELECT count(*) FROM public.metering_points p WHERE p.company_id=${company} AND p.meter_point_id=${external}))`)
}
function expectSourceContext(f:Fixture,message:EdielMessageRow,stored:RefusalEvidence,status:'ready'|'held'){
 expect(stored.context).not.toBeNull()
 expect(stored.context).toMatchObject({source_message_id:message.id,company_id:f.f.companyId,environment:'test',direction:'inbound',payload_sha256:createHash('sha256').update(message.raw_payload!).digest('hex'),status})
 expect(Date.parse(stored.context!.source_received_at)).toBe(Date.parse(message.message_received_at!))
 expect(Date.parse(stored.context!.observed_at)).toBeGreaterThanOrEqual(Date.parse(message.message_received_at!))
 if(status==='ready'){
  expect(stored.context!.reason).toBeNull();expect(stored.ownReceiverCount).toBe(1)
  expect(stored.context!.context).toMatchObject({legalEdielId:f.f.sender,transportEdielId:f.f.sender,actorRole:'electricity_supplier',family:'PRODAT',code:'Z06',applicationReference:'23-DDQ-PRODAT'})
 }
}
function expectReadyRefusalBasis(f:Fixture,message:EdielMessageRow,stored:RefusalEvidence){
 expectSourceContext(f,message,stored,'ready')
 expect(stored.rules).not.toBeNull();expect(stored.ruleCanonical).not.toBeNull()
 const source={source_message_id:message.id,company_id:f.f.companyId,environment:'test'},hash=createHash('sha256').update(message.raw_payload!).digest('hex')
 expect(stored.rules).toMatchObject({...source,direction:'inbound',payload_sha256:hash})
 expect(Date.parse(stored.rules!.captured_at)).toBeGreaterThanOrEqual(Date.parse(message.message_received_at!))
 expect(stored.ruleCanonical).toMatchObject({...source,id:stored.rules!.canonical_assessment_id,source_payload_hash:hash})
}
function expectRecordedOwnRefusal(f:Fixture,message:EdielMessageRow,review:SourceOwnerReceipt,stored:RefusalEvidence,
 application:NonNullable<Awaited<ReturnType<typeof readReceivedProdatApplicationObjects>>>,disposition:'rejected'|'unavailable',cause:string,missingField?:string){
 // A recorder/snapshot/witness incident cannot be counted as an own refusal.
 expect(review).toMatchObject({status:'recorded',sourceDisposition:'not_established',objectCounts:{accepted:0,rejected:disposition==='rejected'?1:0,held:disposition==='unavailable'?1:0}})
 if(review.status!=='recorded')throw Error('recorded_source_refusal_required')
 expectReadyRefusalBasis(f,message,stored)
 expect(stored.assessment).not.toBeNull();expect(stored.canonical).not.toBeNull();expect(stored.witness).not.toBeNull()
 const hash=createHash('sha256').update(message.raw_payload!).digest('hex'),source={source_message_id:message.id,company_id:f.f.companyId,environment:'test'}
 expect(stored.assessment).toMatchObject({...source,id:review.assessmentId,source_payload_hash:hash,canonical_assessment_id:application.assessmentId,facts_hash:review.factsHash})
 expect(stored.canonical).toMatchObject({...source,id:application.assessmentId,source_payload_hash:hash})
 expect(stored.assessment!.canonical_assessment_id).toBe(stored.canonical!.id)
 expect(stored.assessment!.facts_hash).toBe(createHash('sha256').update(stored.assessment!.facts_text).digest('hex'))
 expect(stored.canonical!.facts_hash).toBe(createHash('sha256').update(stored.canonical!.facts_text).digest('hex'))
 expect(JSON.parse(stored.canonical!.facts_text)).toMatchObject({syntaxDecision:'accepted'})
 expect(stored.witness).toMatchObject({...source,id:review.witnessId,assessment_id:review.assessmentId,facts_hash:review.factsHash})
 expect(Date.parse(stored.witness!.observed_at)).toBe(Date.parse(review.availableAt))
 const wire=tokenizeEdifact(message.raw_payload!),lin=wire.segments.find(segment=>segment.tag==='LIN')!,point=segmentComposite(lin,3,wire.una)[0],refs=wire.segments.filter(segment=>segment.tag==='RFF'&&segmentComposite(segment,1,wire.una)[0]==='LI'),messageReference=segmentComposite(wire.segments.find(segment=>segment.tag==='UNH')!,1,wire.una)[0]
 expect(refs).toHaveLength(missingField==='226'?0:1)
 if(refs.length)expect(segmentComposite(refs[0],1,wire.una)[1]).toBe(f.f.caseReference)
 expect(application.sourcePayloadHash).toBe(hash);expect(application.objects).toHaveLength(1)
 expect(application.objects[0]).toMatchObject({messageReference,objectId:point,identityAgency:'9',registers:[{segmentIndex:lin.index}]})
 const facts=JSON.parse(stored.assessment!.facts_text) as {owner:string;canonicalFactsHash:string;objects:{object:Record<string,unknown>;disposition:string;reasons:string[];business:unknown;party:unknown}[]}
 expect(facts).toMatchObject({owner:'received-source-object-decisions-v1',canonicalFactsHash:stored.canonical!.facts_hash})
 expect(facts.objects).toHaveLength(1)
 expect(facts.objects[0]).toMatchObject({disposition,business:null,party:null,object:{messageReference,objectId:point,identityAgency:'9',registers:[{segmentIndex:lin.index}]}})
 expect(facts.objects[0].reasons).toContain(cause)
 if(disposition==='rejected'){
  expect(application.headerDecision).toBe('accepted');expect(application.objects[0].applicationDecision).toBe('rejected')
  expect(application.objects[0].reasonCodes).toContain(cause)
  expect(point).toBe(f.f.external)
 }else{
  // The recorded hold is causally bound to an actual absent own tenant point,
  // never just a failed source recorder, missing basis or unrelated context.
  expect(stored.ownPointCount).toBe(0);expect(application.headerDecision).toBe('accepted')
  expect(application.objects[0]).toMatchObject({applicationDecision:'accepted',reasonCodes:[]})
  expect(JSON.parse(stored.canonical!.facts_text)).toMatchObject({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'})
 }
}
function expectPhysicalContextRefusal(f:Fixture,message:EdielMessageRow,stored:RefusalEvidence){
 expectSourceContext(f,message,stored,'held')
 expect(stored.context!.reason).toBe('ediel_inbound_legal_context_required')
 expect(stored.context!.context).toEqual({});expect(stored.ownReceiverCount).toBe(0)
 // The source INSERT captured this precise refusal. No unconfirmed review
 // result or missing-rule error substitutes for the actual held context.
}
async function prepareCapturedControl(f:Fixture,message:EdielMessageRow){
 expectSourceContext(f,message,refusalEvidence(f,message),'ready')
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:f.operator.id})
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
 expect(await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.f.companyId,decision})).toMatchObject({status:'recorded'})
 expect(await captureFreshEdielSourceRulePackEvidence(f.f.companyId,message.id)).toMatchObject({status:'captured'})
 await requireEdielSourceRulePackEvidence(f.f.companyId,message.id)
 expect(await reviewReceivedStructuralSource({companyId:f.f.companyId,environment:'test',sourceMessageId:message.id,reviewerUserId:f.operator.id,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 return {message,apply:()=>approveSafeMasterdataChanges({edielMessageId:message.id,actorUserId:f.operator.id})}
}

function expectNoFirstEffects(f:Fixture,message:EdielMessageRow){
 const effects=sourceEffects(f,message.id)
 expect(effects.objects).toEqual([]);expect(effects.batches).toEqual([])
 expect(effects.expectations).toEqual([]);expect(effects.observations).toEqual([])
 expect(evidence(f,message.id).acks.filter(ack=>ack.message_family==='APERAK'&&ack.ack_outcome==='positive')).toEqual([])
}
function removeSourceSegments(raw:string,select:(segment:ReturnType<typeof tokenizeEdifact>['segments'][number])=>boolean){
 const {segments}=tokenizeEdifact(raw),selected=segments.filter(select)
 expect(selected.length).toBeGreaterThan(0)
 let changed=raw
 for(const segment of [...selected].reverse()){
  const span=segmentSourceSpan(segment)!
  // Span omits the terminator: remove the complete selected physical segment.
  changed=changed.slice(0,span.startOffset)+changed.slice(span.endOffset+1)
 }
 return changed
}
function removeCharacteristic(raw:string,descriptor:string){
 const wire=tokenizeEdifact(raw),heads=wire.segments.filter(segment=>segment.tag==='CCI'&&segmentComposite(segment,2,wire.una)[0]===descriptor)
 expect(heads).toHaveLength(1)
 const head=heads[0],tail=wire.segments.find(segment=>segment.index===head.index+1)
 expect(tail?.tag).toBe('CAV')
 return removeSourceSegments(raw,segment=>segment.index===head.index||segment.index===tail!.index)
}
function extraUd(raw:string){
 const wire=tokenizeEdifact(raw),installation=wire.segments.filter(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='IT')
 expect(installation).toHaveLength(1)
 const span=segmentSourceSpan(installation[0])!
 return raw.slice(0,span.startOffset)+"NAD+UD+FORBIDDEN-UD-G::89++Forbidden Identity+Forbidden Street+Town++12345+SE'\n"+raw.slice(span.startOffset)
}
function expectIgnoredUd(f:Fixture,change:Change){
 const wire=tokenizeEdifact(change.message.raw_payload!),groups=prodatRegisterGroups(wire.segments,wire.una,'Z06').groups
 expect(groups).toHaveLength(1)
 const own=groups[0],ud=own.segments.filter(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='UD')
 expect(ud).toHaveLength(1);expect(segmentComposite(ud[0],2,wire.una)).toEqual(['FORBIDDEN-UD-G','','89'])
 const stored=sourceEffects(f,change.message.id).ignored
 expect(stored).not.toBeNull()
 expect(stored!.source_payload_hash).toBe(createHash('sha256').update(change.message.raw_payload!).digest('hex'))
 expect(stored!.fields_hash).toBe(createHash('sha256').update(stored!.fields_text).digest('hex'))
 const fields=JSON.parse(stored!.fields_text) as {fieldNumber:string;sourceRule:string;occurrence:Record<string,unknown>}[]
 for(const fieldNumber of ['END_USER_GROUP','227','228','229','231','232','316']){
  const field=fields.filter(item=>item.fieldNumber===fieldNumber)
  expect(field).toHaveLength(1)
  expect(field[0]).toMatchObject({sourceRule:'PRODAT26A:P119',occurrence:{objectId:f.f.external,identityAgency:'9',lineIndex:own.lineIndex,registerPosition:1,lineItemReference:f.f.caseReference,
   messageReference:segmentComposite(wire.segments.find(segment=>segment.tag==='UNH')!,1,wire.una)[0],ownReferences:{customerId:{kind:'present',value:'FORBIDDEN-UD-G'}}}})
 }
}
it.each([false,true])('G first case approval versions only its original structure; physical extra UD=%s never changes customer identity',async withUd=>{
 const f=await fixture(),change=await f.change('G',undefined,{deferFirstApply:true,...(withUd?{rawTransform:extraUd}:{})}),route=configureAckRoute(f)
 const initial=evidence(f,change.message.id)
 expectNoFirstEffects(f,change.message)
 if(withUd){expect(change.message.raw_payload).toContain('FORBIDDEN-UD-G');expect(initial.original.raw_payload).toBe(change.message.raw_payload!);expectIgnoredUd(f,change)}
 const current=await pendingFirstApplication(f,change),before=evidence(f,change.message.id)
 expectNoFirstEffects(f,change.message)
 expect(before.market).toEqual(initial.market);expect(before.source).toEqual(initial.source);expect(before.original).toEqual(initial.original)
 expect(before.acks.map(ack=>ack.message_family)).toEqual(['CONTRL'])
 const approved=await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(approved.status).toBe('applied')
 const after=evidence(f,change.message.id),effects=sourceEffects(f,change.message.id),hash=createHash('sha256').update(change.message.raw_payload!).digest('hex')
 expectOwnAcks(f,change,route,after)
 expect(after.market).toEqual(initial.market);expect(after.source).toEqual(initial.source);expect(after.original).toEqual(initial.original)
 expect(effects.objects).toHaveLength(1);expect(effects.batches).toHaveLength(1)
 const own=effects.objects[0]
 expect(own).toMatchObject({source_message_id:change.message.id,first_line_index:current.scope.lineIndex,company_id:f.f.companyId,environment:'test',payload_hash:hash,actor_user_id:f.operator.id,
  object_scope:{objectId:f.f.external,identityAgency:'9',registers:[{segmentIndex:current.scope.lineIndex,registerPosition:1}]},
  effect:{meteringPointId:f.f.pointId,siteId:f.f.siteId,wire:{messageCode:'Z06',businessCase:'change_without_reading',caseReference:f.f.caseReference,registers:[{position:1,registerId:'101'}]}}})
 expect(own.canonical_assessment_id).toMatch(/^[0-9a-f-]{36}$/);expect(own.object_assessment_id).toMatch(/^[0-9a-f-]{36}$/)
 const effective=new Date(`${f.f.requestedStartDate}T00:00:00Z`);effective.setUTCDate(effective.getUTCDate()+12);effective.setUTCMinutes(effective.getUTCMinutes()-60)
 expect(Date.parse(own.effect.effectiveAt)).toBe(effective.getTime())
 expect(Date.parse(own.source_received_at)).toBe(Date.parse(change.message.message_received_at!))
 expect(Date.parse(own.effect.sourceReceivedAt)).toBe(Date.parse(change.message.message_received_at!))
 expect(own.effect.sourceRegisters).toHaveLength(1)
 expect(own.effect.sourceRegisters[0].register.segmentIndex).toBe(current.scope.lineIndex)
 expect(own.effect.sourceRegisters[0].tokens).toContainEqual(expect.objectContaining({tag:'LIN',elements:expect.arrayContaining([['1'],[f.f.external,'','','9']])}))
 expect(effects.batches[0]).toMatchObject({source_message_id:change.message.id,payload_hash:hash,canonical_assessment_id:own.canonical_assessment_id,object_assessment_id:own.object_assessment_id,result:{sourceMessageId:change.message.id,applied:true,appliedCount:1}})
 expect(effects.expectations).toEqual([]);expect(effects.observations).toEqual([])
 expect(own).toMatchObject({effect:{readingFollowUp:{status:'not_required_by_this_change',criterion:'AT-Z06G-SUPPLIER',deadline:null,fulfilled:false}}})
 expect((await f.read(change.message.id)).data).toMatchObject({expectations:[]})
 if(withUd)expectIgnoredUd(f,change)
 const final=await readReceivedProdatFinalResponsePlan({companyId:f.f.companyId,sourceMessageId:change.message.id,rawPayload:change.message.raw_payload!})
 expect(final).not.toBeNull();expect(final!.plans).toMatchObject([{outcome:'positive',effectKind:'structural',objectLineIndices:[current.scope.lineIndex],acknowledgedReferences:[current.scope.li]}])
 const replay=await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:approved.id,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(replay.status).toBe('applied');expect(sourceEffects(f,change.message.id)).toEqual(effects)
 expect({...evidence(f,change.message.id),case:null}).toEqual({...after,case:null})
 expect(external.send).toHaveBeenCalledTimes(1)
})

it('G physical missing fields/correlation and wrong legal parties cannot establish a first structural effect',async()=>{
 const f=await fixture();configureAckRoute(f)
 const probes:{name:string;field?:string;process?:false;transform:(raw:string)=>string}[]=[
  {name:'missing required own306',field:'306',transform:raw=>removeCharacteristic(raw,'Z07')},
  {name:'missing own LI',field:'226',transform:raw=>removeSourceSegments(raw,segment=>segment.tag==='RFF'&&segmentComposite(segment,1,tokenizeEdifact(raw).una)[0]==='LI')},
  {name:'reversed source roles',process:false,transform:raw=>raw.replaceAll(`${f.f.receiver}:14`,`${f.f.sender}:14`).replaceAll(`+${f.f.sender}:14+${f.f.sender}:14+`,`+${f.f.sender}:14+${f.f.receiver}:14+`)
   .replace(`NAD+FR+${f.f.receiver}:160:SVK`,`NAD+FR+${f.f.sender}:160:SVK`).replace(`NAD+DO+${f.f.sender}:160:SVK`,`NAD+DO+${f.f.receiver}:160:SVK`)},
  {name:'legal receiver mismatches transport',process:false,transform:raw=>raw.replace(`NAD+DO+${f.f.sender}:160:SVK`,`NAD+DO+${f.f.receiver}:160:SVK`)},
 ]
 for(const probe of probes){
  const message=await f.captureChange('G',undefined,{rawTransform:probe.transform}),initial=evidence(f,message.id)
  expect(validateEdifactEnvelope(message.raw_payload!).syntaxOk).toBe(true)
  expectNoFirstEffects(f,message)
  if(probe.process!==false){
   const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:f.operator.id})
   const defects=decision.issues.filter(issue=>issue.prodatDiagnostic?.kind==='field'&&issue.prodatDiagnostic.fieldNumber===probe.field&&issue.prodatDiagnostic.errorKind==='missing')
   expect(defects.length).toBeGreaterThan(0)
   expect(decision.prodatApplicationValidation?.objects).toMatchObject([{applicationDecision:'rejected'}])
   await processInboundEdielMessage({actorUserId:f.operator.id,edielMessageId:message.id})
   await requireEdielSourceRulePackEvidence(f.f.companyId,message.id)
   const review=await reviewReceivedStructuralSource({companyId:f.f.companyId,environment:'test',sourceMessageId:message.id,reviewerUserId:f.operator.id,confirmedOriginal:true,replacesSourceMessageId:null})
   const application=await readReceivedProdatApplicationObjects({companyId:f.f.companyId,sourceMessageId:message.id,rawPayload:message.raw_payload!})
   expect(application).not.toBeNull()
   expectRecordedOwnRefusal(f,message,review,refusalEvidence(f,message),application!,'rejected',defects[0].code,probe.field)
   await expect(approveSafeMasterdataChanges({edielMessageId:message.id,actorUserId:f.operator.id})).rejects.toThrow(/^structural_apply_no_qualified_object$/)
  }else{
   // These wrong legal receivers are held at genuine source-context capture,
   // before a canonical composition can legitimately be recorded.
   const wire=tokenizeEdifact(message.raw_payload!),envelope=EdifactEnvelopeCodec.decode(message.raw_payload!)
   const legalReceiver=wire.segments.find(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='DO')!
   expect(segmentComposite(legalReceiver,2,wire.una)[0]).toBe(f.f.receiver)
   expect(envelope.receiver).toBe(probe.name==='reversed source roles'?f.f.receiver:f.f.sender)
   expect(envelope.sender).toBe(probe.name==='reversed source roles'?f.f.sender:f.f.receiver)
   expectPhysicalContextRefusal(f,message,refusalEvidence(f,message))
   await expect(approveSafeMasterdataChanges({edielMessageId:message.id,actorUserId:f.operator.id})).rejects.toThrow(/^ediel_inbound_legal_context_required$/)
  }
  expectNoFirstEffects(f,message)
  const after=evidence(f,message.id)
  expect(after.market).toEqual(initial.market);expect(after.source).toEqual(initial.source);expect(after.original).toEqual(initial.original)
 }
 // Same real owner and prerequisites accept an intact control after refusals.
 const control=await prepareCapturedControl(f,await f.captureChange('G')),current=await pendingFirstApplication(f,control)
 expectNoFirstEffects(f,control.message)
 expect(await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id,structuralObjectLineIndices:[current.scope.lineIndex]})).toMatchObject({status:'applied'})
})

it('G cannot borrow a foreign physical point, admit outbound source input or mutate a sealed deferred original',async()=>{
 const f=await fixture(),foreign=await fixture();configureAckRoute(f)
 const message=await f.captureChange('G',undefined,{rawTransform:raw=>raw.replaceAll(f.f.external,foreign.f.external)}),initial=evidence(f,message.id),foreignBefore=evidence(foreign,foreign.f.source)
 await processInboundEdielMessage({actorUserId:f.operator.id,edielMessageId:message.id})
 await requireEdielSourceRulePackEvidence(f.f.companyId,message.id)
 const review=await reviewReceivedStructuralSource({companyId:f.f.companyId,environment:'test',sourceMessageId:message.id,reviewerUserId:f.operator.id,confirmedOriginal:true,replacesSourceMessageId:null})
 const application=await readReceivedProdatApplicationObjects({companyId:f.f.companyId,sourceMessageId:message.id,rawPayload:message.raw_payload!})
 expect(application).not.toBeNull()
 const stored=refusalEvidence(f,message)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.metering_points WHERE company_id=${literal(foreign.f.companyId)} AND id=${literal(foreign.f.pointId)} AND meter_point_id=${literal(foreign.f.external)}`)).toBe(1)
 expectRecordedOwnRefusal(f,message,review,stored,application!,'unavailable','structural_review_owner_unavailable')
 // The intact canonical own member reaches SQL11232's empty qualified partition.
 await expect(approveSafeMasterdataChanges({edielMessageId:message.id,actorUserId:f.operator.id})).rejects.toThrow(/^structural_apply_no_qualified_object$/)
 expectNoFirstEffects(f,message)
 expect(evidence(f,message.id).market).toEqual(initial.market);expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
 // Real INSERT constraints reject this unqualified outbound input. No route,
 // source-operation or acceptance authority is invented to bypass the guard.
 const sourceCount=sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.f.companyId)}`),directionBefore=evidence(f,message.id)
 await expect(f.captureChange('G',undefined,{direction:'outbound'})).rejects.toThrow('canonical_ediel_route_required')
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.f.companyId)}`)).toBe(sourceCount)
 expect(evidence(f,message.id)).toEqual(directionBefore);expectNoFirstEffects(f,message)
 const change=await f.change('G',undefined,{deferFirstApply:true}),sealed=evidence(f,change.message.id),effects=sourceEffects(f,change.message.id)
 const mutation=await supabaseService.from('ediel_messages').update({raw_payload:change.message.raw_payload!.replace('METER-1','ALTERED-METER')}).eq('id',change.message.id).eq('company_id',f.f.companyId)
 expect(mutation.error?.message).toContain('immutable_ediel_payload_cannot_change')
 expect(evidence(f,change.message.id)).toEqual(sealed);expect(sourceEffects(f,change.message.id)).toEqual(effects)
 const current=await pendingFirstApplication(f,change)
 expect(await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id,structuralObjectLineIndices:[current.scope.lineIndex]})).toMatchObject({status:'applied'})
 expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
})
```

</details>

<details><summary>ediel-fg-6f94-sc031-f-preimage.ts (controller/preimage/diff original), 48353 bytes — SHA256 f7b037b6e2d24f4fd4131c5eba11c9098ac5541ef57e71cc5558d5ccdf7eecd8</summary>

```typescript
// Acceptance evidence for AT-Z06F-SUPPLIER (human reference only).
// Native execution remains NOT_RUN for these additive first-effect controls.
// Retained already-applied cases and their assertions remain unchanged below.
// Optional existing-fixture input/deferred-apply seams add real first-case,
// physical ignored UD and source-refusal proofs without seeding acceptance.
// Existing qualified producer alone executes the native suite. No coverage approval.
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {createZ06fReadingNativeFixture} from './helpers/ediel-z06f-reading-followup-native-fixture'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {approveEdielInboundCase,createOrUpdateInboundProdatCase,getEdielInboundCaseForMessage} from '@/lib/ediel/inboundCases'
import {getEdielMessageById} from '@/lib/ediel/db'
import {readReceivedProdatFinalResponsePlan} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {readPhysicalAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,segmentSourceSpan,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {supabaseService} from '@/lib/supabase/service'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {reviewReceivedStructuralSource} from '@/lib/ediel/sources/reviewReceivedStructuralSource'
import {approveSafeMasterdataChanges} from '@/lib/ediel/safeApplyReview'
import {readReceivedProdatApplicationObjects} from '@/lib/ediel/core/receivedProdatApplicationObjects'
import {captureFreshEdielSourceRulePackEvidence,requireEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import type {SourceOwnerReceipt} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import type {EdielMessageRow} from '@/lib/ediel/types'

// Declared external port required by the existing signed-original producer.
// This SMTP result proves neither delivery to a real counterparty nor transport
// approval. Source, SQL, actor, case, ACK and outbox implementations are real.
const external=vi.hoisted(()=>({send:vi.fn()}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:external.send})}}))
beforeEach(()=>{
 vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS','synthetic@example.invalid')
 vi.stubEnv('EDIEL_APP_DKIM_ENABLED','false')
 vi.stubEnv('EMAIL_PROVIDER','resend');vi.stubEnv('EDIEL_EMAIL_PROVIDER','strato')
 vi.stubEnv('EDIEL_SMTP_FROM','synthetic@example.invalid')
 vi.stubEnv('EDIEL_SMTP_USER','synthetic@example.invalid')
 vi.stubEnv('EDIEL_SMTP_PASS','synthetic-only')
 external.send.mockReset()
})
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
const fixture=()=>createZ06fReadingNativeFixture(email=>external.send.mockResolvedValue({
 accepted:[email],rejected:[],messageId:'synthetic-FG-acceptance-original',
 response:'250 explicitly synthetic accepted',
}))
type Fixture=Awaited<ReturnType<typeof fixture>>
type Change=Awaited<ReturnType<Fixture['change']>>
type Evidence={
 source:Record<string,unknown>
 market:Record<string,unknown>
 original:Record<string,unknown>
 receipts:Record<string,unknown>
 expectations:Record<string,unknown>[]
 observations:Record<string,unknown>[]
 acks:EdielMessageRow[]
 outbox:Record<string,unknown>[]
 events:Record<string,unknown>[]
 case:Record<string,unknown>|null
}

// Public disposable routing INPUT only, following the established raw-scope
// native suite. No protected readiness, authority, grant, permission registry,
// issuer mandate or original-capture fact is inserted by these acceptance files.
function configureAckRoute(f:Fixture){
 const routeId=randomUUID(),profileId=randomUUID(),smtp=edielSmtpConfig()
 sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
 VALUES(${literal(routeId)},${literal(f.f.companyId)},'Synthetic F acceptance ACK route','ediel_ack',${literal(f.f.gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,payload_format,transport_security_mode,smtp_to,receiver_email,mailbox,smtp_host,smtp_port)
 VALUES(${literal(profileId)},${literal(f.f.companyId)},${literal(routeId)},'Synthetic F acceptance ACK profile','test','edifact',${literal(f.f.sender)},${literal(f.f.receiver)},'23-DDQ-PRODAT',true,true,'edifact','unencrypted','recipient@example.invalid','recipient@example.invalid',${literal(smtp.from)},${literal(smtp.host)},${literal(smtp.port)});`)
 return {routeId,profileId}
}
function evidence(f:Fixture,sourceId:string):Evidence{
 const company=literal(f.f.companyId),source=literal(sourceId)
 return sql<Evidence>(`SELECT jsonb_build_object(
 'source',(SELECT jsonb_build_object('id',id,'company',company_id,'environment',environment,'direction',direction,'family',message_family,'code',message_code,'raw',raw_payload,'receivedAt',message_received_at,'sha256',encode(sha256(convert_to(raw_payload,'UTF8')),'hex')) FROM public.ediel_messages WHERE id=${source} AND company_id=${company}),
 'original',(SELECT to_jsonb(s) FROM gridex_received_sources.sources s WHERE source_message_id=${source} AND company_id=${company}),
 'market',jsonb_build_object(
  'customers',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customers r WHERE company_id=${company}),
  'sites',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customer_sites r WHERE company_id=${company}),
  'points',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.metering_points r WHERE company_id=${company}),
  'supply',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customer_supply_periods r WHERE company_id=${company}),
  'customerContracts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customer_contracts r WHERE company_id=${company}),
  'series',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.meter_reading_series r WHERE company_id=${company}),
  'graphs',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.customer_onboarding_operations r WHERE company_id=${company}),
  'marketOutbound',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_messages r WHERE company_id=${company} AND direction='outbound' AND message_family NOT IN('CONTRL','APERAK','UTILTS_ERR'))),
 'receipts',jsonb_build_object(
  'objects',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id,r.first_line_index),'[]') FROM gridex_received_sources.structural_object_apply_receipts r WHERE company_id=${company}),
  'batches',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id,r.requested_scope_key),'[]') FROM gridex_received_sources.structural_apply_batches r WHERE company_id=${company})),
 'expectations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_received_reading_expectations.expectations r WHERE company_id=${company}),
 'observations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.expectation_id,r.transaction_id),'[]') FROM gridex_received_reading_expectations.observations r WHERE company_id=${company}),
 'acks',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_messages r WHERE company_id=${company} AND related_message_id=${source} AND direction='outbound'),
 'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_outbox r WHERE company_id=${company} AND source_message_id=${source}),
 'events',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.ediel_message_events r WHERE company_id=${company} AND ediel_message_id=${source}),
 'case',(SELECT to_jsonb(r) FROM public.ediel_inbound_cases r WHERE company_id=${company} AND ediel_message_id=${source}))`)
}
function physical(change:Change){
 const wire=tokenizeEdifact(change.message.raw_payload!),lin=wire.segments.filter(segment=>segment.tag==='LIN')
 expect(lin).toHaveLength(1)
 const li=wire.segments.filter(segment=>segment.tag==='RFF'&&segmentComposite(segment,1,wire.una)[0]==='LI')
 const bgm=wire.segments.find(segment=>segment.tag==='BGM')!
 expect(li).toHaveLength(1)
 return {lineIndex:lin[0].index,li:segmentComposite(li[0],1,wire.una)[1],document:segmentComposite(bgm,2,wire.una)[0]}
}
async function pending(f:Fixture,change:Change){
 await processInboundEdielMessage({actorUserId:f.operator.id,edielMessageId:change.message.id})
 const actual=await getEdielMessageById(change.message.id)
 expect(actual).not.toBeNull()
 expect(actual!.raw_payload).toBe(change.message.raw_payload)
 const created=await createOrUpdateInboundProdatCase({actorUserId:f.operator.id,message:actual!})
 const saved=await getEdielInboundCaseForMessage(f.f.companyId,change.message.id)
 expect(saved).not.toBeNull();expect(created?.id).toBe(saved!.id)
 expect(saved).toMatchObject({company_id:f.f.companyId,ediel_message_id:change.message.id,status:'pending_review',message_code:'Z06'})
 return {actual:actual!,inboundCase:saved!,scope:physical(change)}
}
function expectOwnAcks(f:Fixture,change:Change,route:{routeId:string;profileId:string},stored:Evidence){
 const own=physical(change),sourceEnvelope=EdifactEnvelopeCodec.decode(change.message.raw_payload!)
 expect(stored.acks.map(ack=>ack.message_family).sort()).toEqual(['APERAK','CONTRL'])
 for(const ack of stored.acks){
  expect(ack).toMatchObject({company_id:f.f.companyId,environment:'test',direction:'outbound',related_message_id:change.message.id,ack_outcome:'positive'})
  expect(validateEdifactEnvelope(ack.raw_payload!).syntaxOk).toBe(true)
  const envelope=EdifactEnvelopeCodec.decode(ack.raw_payload!)
  expect(envelope.sender).toBe(sourceEnvelope.receiver);expect(envelope.receiver).toBe(sourceEnvelope.sender)
  const correlation=readPhysicalAckSourceCorrelation(ack,change.message)
  expect(correlation.classification.outcome).toBe('positive')
  if(ack.message_family==='CONTRL'){
   expect(correlation.scope).toBe('interchange')
   expect(correlation.acknowledgedReferences).toEqual([sourceEnvelope.interchangeReference!.slice(0,14)])
  }else{
   expect(ack.communication_route_id).toBe(route.routeId)
   expect(ack.route_profile_id).toBe(route.profileId)
   expect(correlation.lookupReferences).toContainEqual({type:'BGM_REF',value:own.document})
   expect(correlation.prodatObjectOutcomes).toEqual([{objectId:f.f.external,identityAgency:'9',firstLineIndex:own.lineIndex,lineItemReference:own.li,outcome:'positive'}])
   const wire=tokenizeEdifact(ack.raw_payload!)
   expect(wire.segments.filter(segment=>segment.tag==='ERC').map(segment=>segmentComposite(segment,1,wire.una)[0])).toEqual(['100'])
  }
 }
 expect(stored.outbox).toHaveLength(2)
 for(const ack of stored.acks){
  const entries=stored.outbox.filter(row=>row.ediel_message_id===ack.id)
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({company_id:f.f.companyId,source_message_id:change.message.id,environment:'test',message_family:ack.message_family,ack_outcome:'positive'})
 }
}

// Proposed native controls deliberately fail if actual canonical auth, technical
// endpoint, source-bound route or ACK prerequisites are absent. They do not skip,
// catch-and-pass, seed missing permission keys or substitute mocked effects.
// Current field306 fixture uses national Z12; canonical list is Z11/Z12.
// These unexecuted controls require actual guide-valid source admission.
it('already-applied F source reaches real inbound case, own physical ACK/outbox and immutable retained replay',async()=>{
 const f=await fixture(),change=await f.change('F'),route=configureAckRoute(f)
 const initial=evidence(f,change.message.id),current=await pending(f,change)
 const before=evidence(f,change.message.id)
 expect(before.acks.map(ack=>ack.message_family)).toEqual(['CONTRL'])
 expect(before.market).toEqual(initial.market);expect(before.source).toEqual(initial.source);expect(before.original).toEqual(initial.original)
 const approved=await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(approved).toMatchObject({company_id:f.f.companyId,status:'applied',ediel_message_id:change.message.id})
 const after=evidence(f,change.message.id)
 expectOwnAcks(f,change,route,after)
 expect(after.source).toEqual(initial.source)
 expect(after.source.sha256).toBe(createHash('sha256').update(change.message.raw_payload!).digest('hex'))
 expect(after.original).toEqual(initial.original);expect(after.market).toEqual(initial.market)
 expect(after.receipts).toEqual(initial.receipts)
 expect(after.expectations).toEqual(initial.expectations);expect(after.observations).toEqual([])
 expect(after.expectations).toHaveLength(1)
 expect(after.expectations[0]).toMatchObject({source_message_id:change.message.id,contract:{mode:'meter_reading',expectedRegisterIds:['101'],measurementMethod:'Z04',deadline:null,automaticRequestAllowed:false}})
 const readingView=await f.read(change.message.id)
 expect(readingView.error).toBeNull()
 expect(readingView.data).toMatchObject({criterion:'AT-Z06F-SUPPLIER',expectations:[{status:'pending',automaticRequestAllowed:false,deadline:null}]})
 const final=await readReceivedProdatFinalResponsePlan({companyId:f.f.companyId,sourceMessageId:change.message.id,rawPayload:change.message.raw_payload!})
 expect(final).not.toBeNull();expect(final!.totalObjectCount).toBe(1)
 expect(final!.plans).toMatchObject([{outcome:'positive',objectLineIndices:[current.scope.lineIndex],acknowledgedReferences:[current.scope.li],effectKind:'structural'}])
 const ackIds=after.acks.filter(ack=>ack.message_family==='APERAK').map(ack=>ack.id)
 expect(approved.review_decision).toMatchObject({structuralApplication:{version:1,sourceMessageId:change.message.id,objectLineIndices:[current.scope.lineIndex],appliedCount:1,appliedObjectCount:1,totalObjectCount:1,ackIds}})
 const replay=await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:approved.id,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(replay.status).toBe('applied')
 const stable=evidence(f,change.message.id)
 // Re-review timestamps may advance; immutable market/response originals do not.
 expect({...stable,case:null}).toEqual({...after,case:null})
 expect(replay.review_decision).toEqual(approved.review_decision)
 expect(stable.acks.map(ack=>ack.id)).toEqual(after.acks.map(ack=>ack.id))
 expect(external.send).toHaveBeenCalledTimes(1)
})

it('F case refuses foreign tenant/actor/graph selections and invalid own LIN scopes without new effects',async()=>{
 const f=await fixture(),foreign=await fixture(),change=await f.change('F')
 configureAckRoute(f)
 const current=await pending(f,change),before=evidence(f,change.message.id),foreignBefore=evidence(foreign,foreign.f.source)
 const base={companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id}
 const invalid=[
  {override:{companyId:foreign.f.companyId},reason:'TENANT_CONTEXT_MISMATCH'},
  {override:{actorUserId:foreign.operator.id},reason:'ediel_tenant_actor_forbidden'},
  {override:{mode:'create_new_customer' as const},reason:'structural_apply_original_scope_required'},
  {override:{selectedCustomerId:foreign.f.customerId},reason:'structural_apply_original_scope_required'},
  {override:{selectedSiteId:foreign.f.siteId},reason:'structural_apply_original_scope_required'},
  {override:{selectedMeteringPointId:foreign.f.pointId},reason:'structural_apply_original_scope_required'},
  {override:{structuralObjectLineIndices:[]},reason:'structural_apply_requested_scope_invalid'},
  {override:{structuralObjectLineIndices:[current.scope.lineIndex,current.scope.lineIndex]},reason:'structural_apply_requested_scope_invalid'},
  {override:{structuralObjectLineIndices:[-1]},reason:'structural_apply_requested_scope_invalid'},
  {override:{structuralObjectLineIndices:[1.5]},reason:'structural_apply_requested_scope_invalid'},
  {override:{structuralObjectLineIndices:[current.scope.lineIndex+10000]},reason:'structural_apply_requested_scope_invalid'},
 ]
 for(const attempt of invalid){
  await expect(approveEdielInboundCase({...base,...attempt.override})).rejects.toThrow(attempt.reason)
  expect(evidence(f,change.message.id)).toEqual(before)
  expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
 }
 // Positive contrast consumes the same unaltered original after all refusals.
 const approved=await approveEdielInboundCase({...base,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(approved.status).toBe('applied')
 expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
 sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active,valid_from)
 VALUES(${literal(f.operator.id)},${literal(f.f.companyId)},'communication.write','deny',true,clock_timestamp()-interval '1 second');`)
 const deniedBefore=evidence(f,change.message.id)
 await expect(approveEdielInboundCase({...base,structuralObjectLineIndices:[current.scope.lineIndex]})).rejects.toThrow('ediel_tenant_permission_forbidden')
 expect(evidence(f,change.message.id)).toEqual(deniedBefore)
 expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
})

// First-effect evidence is additive to the retained already-applied controls.
// Intake finishes its own canonical session. The manual first-effect review
// follows that actual intake, rather than borrowing an earlier review revision.
async function pendingFirstApplication(f:Fixture,change:Change){
 const current=await pending(f,change)
 expect(await reviewReceivedStructuralSource({companyId:f.f.companyId,environment:'test',sourceMessageId:change.message.id,reviewerUserId:f.operator.id,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 return current
}
// Every protected source/assessment/apply/ACK implementation remains real.
function sourceEffects(f:Fixture,sourceId:string){
 const company=literal(f.f.companyId),source=literal(sourceId)
 return sql<{
  objects:{source_message_id:string;first_line_index:number;company_id:string;environment:string;payload_hash:string;canonical_assessment_id:string;object_assessment_id:string;actor_user_id:string;source_received_at:string;object_scope:{objectId:string;identityAgency:string;registers:{segmentIndex:number;registerPosition:number}[]};effect:{effectiveAt:string;sourceReceivedAt:string;sourceRegisters:{register:{segmentIndex:number};tokens:{tag:string;elements:string[][]}[]}[]}}[]
  batches:Record<string,unknown>[]
  expectations:Record<string,unknown>[]
  observations:Record<string,unknown>[]
  ignored:{source_payload_hash:string;fields_hash:string;fields_text:string}|null
 }>(`SELECT jsonb_build_object(
 'objects',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.first_line_index),'[]') FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'batches',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.requested_scope_key),'[]') FROM gridex_received_sources.structural_apply_batches r WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'expectations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM gridex_received_reading_expectations.expectations r WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'observations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.expectation_id,o.transaction_id),'[]') FROM gridex_received_reading_expectations.observations o JOIN gridex_received_reading_expectations.expectations e ON e.id=o.expectation_id WHERE e.company_id=${company} AND e.source_message_id=${source}),
 'ignored',(SELECT to_jsonb(i) FROM gridex_received_sources.prodat_ignored_field_facets i JOIN gridex_received_sources.validation_assessments v ON v.id=i.canonical_assessment_id WHERE i.company_id=${company} AND i.source_message_id=${source} AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)))`)
}

type RefusalEvidence={
 context:{source_message_id:string;company_id:string;environment:string;direction:string;payload_sha256:string;source_received_at:string;observed_at:string;status:string;reason:string|null;context:Record<string,unknown>}|null
 rules:{source_message_id:string;company_id:string;environment:string;direction:string;payload_sha256:string;captured_at:string;canonical_assessment_id:string}|null
 ruleCanonical:{id:string;source_message_id:string;company_id:string;environment:string;source_payload_hash:string}|null
 canonical:{id:string;source_message_id:string;company_id:string;environment:string;source_payload_hash:string;facts_text:string;facts_hash:string}|null
 assessment:{id:string;source_message_id:string;company_id:string;environment:string;source_payload_hash:string;canonical_assessment_id:string;facts_text:string;facts_hash:string}|null
 witness:{id:string;assessment_id:string;company_id:string;environment:string;source_message_id:string;facts_hash:string;observed_at:string}|null
 ownReceiverCount:number;ownPointCount:number
}
function refusalEvidence(f:Fixture,message:EdielMessageRow):RefusalEvidence{
 const wire=tokenizeEdifact(message.raw_payload!),receiver=wire.segments.find(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='DO')!,point=wire.segments.find(segment=>segment.tag==='LIN')!
 const company=literal(f.f.companyId),source=literal(message.id),legal=literal(segmentComposite(receiver,2,wire.una)[0]),external=literal(segmentComposite(point,3,wire.una)[0])
 return sql<RefusalEvidence>(`SELECT jsonb_build_object(
 'context',(SELECT to_jsonb(r) FROM gridex_ediel_inbound_context.receipts r WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'rules',(SELECT to_jsonb(r) FROM gridex_ediel_source_rules.receipts r WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'ruleCanonical',(SELECT to_jsonb(v) FROM gridex_received_sources.validation_assessments v JOIN gridex_ediel_source_rules.receipts r ON r.canonical_assessment_id=v.id WHERE r.company_id=${company} AND r.source_message_id=${source}),
 'canonical',(SELECT to_jsonb(v) FROM gridex_received_sources.validation_assessments v WHERE v.company_id=${company} AND v.source_message_id=${source} AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)),
 'assessment',(SELECT to_jsonb(a) FROM gridex_received_sources.object_assessments a WHERE a.company_id=${company} AND a.source_message_id=${source} AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=a.id)),
 'witness',(SELECT to_jsonb(w) FROM gridex_received_sources.object_availability_witnesses w JOIN gridex_received_sources.object_assessments a ON a.id=w.assessment_id WHERE a.company_id=${company} AND a.source_message_id=${source} AND NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=a.id)),
 'ownReceiverCount',(SELECT count(DISTINCT i.company_id) FROM public.tenant_actor_identifiers i JOIN gridex_ediel_inbound_context.receipts r ON r.source_message_id=${source} WHERE i.company_id=${company} AND i.environment='test' AND i.identifier_type='EdielId' AND i.identifier_value=${legal} AND i.valid_from<=r.observed_at AND(i.valid_to IS NULL OR r.observed_at<i.valid_to)),
 'ownPointCount',(SELECT count(*) FROM public.metering_points p WHERE p.company_id=${company} AND p.meter_point_id=${external}))`)
}
function expectSourceContext(f:Fixture,message:EdielMessageRow,stored:RefusalEvidence,status:'ready'|'held'){
 expect(stored.context).not.toBeNull()
 expect(stored.context).toMatchObject({source_message_id:message.id,company_id:f.f.companyId,environment:'test',direction:'inbound',payload_sha256:createHash('sha256').update(message.raw_payload!).digest('hex'),status})
 expect(Date.parse(stored.context!.source_received_at)).toBe(Date.parse(message.message_received_at!))
 expect(Date.parse(stored.context!.observed_at)).toBeGreaterThanOrEqual(Date.parse(message.message_received_at!))
 if(status==='ready'){
  expect(stored.context!.reason).toBeNull();expect(stored.ownReceiverCount).toBe(1)
  expect(stored.context!.context).toMatchObject({legalEdielId:f.f.sender,transportEdielId:f.f.sender,actorRole:'electricity_supplier',family:'PRODAT',code:'Z06',applicationReference:'23-DDQ-PRODAT'})
 }
}
function expectReadyRefusalBasis(f:Fixture,message:EdielMessageRow,stored:RefusalEvidence){
 expectSourceContext(f,message,stored,'ready')
 expect(stored.rules).not.toBeNull();expect(stored.ruleCanonical).not.toBeNull()
 const source={source_message_id:message.id,company_id:f.f.companyId,environment:'test'},hash=createHash('sha256').update(message.raw_payload!).digest('hex')
 expect(stored.rules).toMatchObject({...source,direction:'inbound',payload_sha256:hash})
 expect(Date.parse(stored.rules!.captured_at)).toBeGreaterThanOrEqual(Date.parse(message.message_received_at!))
 expect(stored.ruleCanonical).toMatchObject({...source,id:stored.rules!.canonical_assessment_id,source_payload_hash:hash})
}
function expectRecordedOwnRefusal(f:Fixture,message:EdielMessageRow,review:SourceOwnerReceipt,stored:RefusalEvidence,
 application:NonNullable<Awaited<ReturnType<typeof readReceivedProdatApplicationObjects>>>,disposition:'rejected'|'unavailable',cause:string,missingField?:string){
 // A recorder/snapshot/witness incident cannot be counted as an own refusal.
 expect(review).toMatchObject({status:'recorded',sourceDisposition:'not_established',objectCounts:{accepted:0,rejected:disposition==='rejected'?1:0,held:disposition==='unavailable'?1:0}})
 if(review.status!=='recorded')throw Error('recorded_source_refusal_required')
 expectReadyRefusalBasis(f,message,stored)
 expect(stored.assessment).not.toBeNull();expect(stored.canonical).not.toBeNull();expect(stored.witness).not.toBeNull()
 const hash=createHash('sha256').update(message.raw_payload!).digest('hex'),source={source_message_id:message.id,company_id:f.f.companyId,environment:'test'}
 expect(stored.assessment).toMatchObject({...source,id:review.assessmentId,source_payload_hash:hash,canonical_assessment_id:application.assessmentId,facts_hash:review.factsHash})
 expect(stored.canonical).toMatchObject({...source,id:application.assessmentId,source_payload_hash:hash})
 expect(stored.assessment!.canonical_assessment_id).toBe(stored.canonical!.id)
 expect(stored.assessment!.facts_hash).toBe(createHash('sha256').update(stored.assessment!.facts_text).digest('hex'))
 expect(stored.canonical!.facts_hash).toBe(createHash('sha256').update(stored.canonical!.facts_text).digest('hex'))
 expect(JSON.parse(stored.canonical!.facts_text)).toMatchObject({syntaxDecision:'accepted'})
 expect(stored.witness).toMatchObject({...source,id:review.witnessId,assessment_id:review.assessmentId,facts_hash:review.factsHash})
 expect(Date.parse(stored.witness!.observed_at)).toBe(Date.parse(review.availableAt))
 const wire=tokenizeEdifact(message.raw_payload!),lin=wire.segments.find(segment=>segment.tag==='LIN')!,point=segmentComposite(lin,3,wire.una)[0],refs=wire.segments.filter(segment=>segment.tag==='RFF'&&segmentComposite(segment,1,wire.una)[0]==='LI'),messageReference=segmentComposite(wire.segments.find(segment=>segment.tag==='UNH')!,1,wire.una)[0]
 expect(refs).toHaveLength(missingField==='226'?0:1)
 if(refs.length)expect(segmentComposite(refs[0],1,wire.una)[1]).toBe(f.f.caseReference)
 expect(application.sourcePayloadHash).toBe(hash);expect(application.objects).toHaveLength(1)
 expect(application.objects[0]).toMatchObject({messageReference,objectId:point,identityAgency:'9',registers:[{segmentIndex:lin.index}]})
 const facts=JSON.parse(stored.assessment!.facts_text) as {owner:string;canonicalFactsHash:string;objects:{object:Record<string,unknown>;disposition:string;reasons:string[];business:unknown;party:unknown}[]}
 expect(facts).toMatchObject({owner:'received-source-object-decisions-v1',canonicalFactsHash:stored.canonical!.facts_hash})
 expect(facts.objects).toHaveLength(1)
 expect(facts.objects[0]).toMatchObject({disposition,business:null,party:null,object:{messageReference,objectId:point,identityAgency:'9',registers:[{segmentIndex:lin.index}]}})
 expect(facts.objects[0].reasons).toContain(cause)
 if(disposition==='rejected'){
  expect(application.headerDecision).toBe('accepted');expect(application.objects[0].applicationDecision).toBe('rejected')
  expect(application.objects[0].reasonCodes).toContain(cause)
  expect(point).toBe(f.f.external)
 }else{
  // The recorded hold is causally bound to an actual absent own tenant point,
  // never just a failed source recorder, missing basis or unrelated context.
  expect(stored.ownPointCount).toBe(0);expect(application.headerDecision).toBe('accepted')
  expect(application.objects[0]).toMatchObject({applicationDecision:'accepted',reasonCodes:[]})
  expect(JSON.parse(stored.canonical!.facts_text)).toMatchObject({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'})
 }
}
function expectPhysicalContextRefusal(f:Fixture,message:EdielMessageRow,stored:RefusalEvidence){
 expectSourceContext(f,message,stored,'held')
 expect(stored.context!.reason).toBe('ediel_inbound_legal_context_required')
 expect(stored.context!.context).toEqual({});expect(stored.ownReceiverCount).toBe(0)
 // The source INSERT captured this precise refusal. No unconfirmed review
 // result or missing-rule error substitutes for the actual held context.
}
async function prepareCapturedControl(f:Fixture,message:EdielMessageRow){
 expectSourceContext(f,message,refusalEvidence(f,message),'ready')
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:f.operator.id})
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
 expect(await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.f.companyId,decision})).toMatchObject({status:'recorded'})
 expect(await captureFreshEdielSourceRulePackEvidence(f.f.companyId,message.id)).toMatchObject({status:'captured'})
 await requireEdielSourceRulePackEvidence(f.f.companyId,message.id)
 expect(await reviewReceivedStructuralSource({companyId:f.f.companyId,environment:'test',sourceMessageId:message.id,reviewerUserId:f.operator.id,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 return {message,apply:()=>approveSafeMasterdataChanges({edielMessageId:message.id,actorUserId:f.operator.id})}
}

function expectNoFirstEffects(f:Fixture,message:EdielMessageRow){
 const effects=sourceEffects(f,message.id)
 expect(effects.objects).toEqual([]);expect(effects.batches).toEqual([])
 expect(effects.expectations).toEqual([]);expect(effects.observations).toEqual([])
 expect(evidence(f,message.id).acks.filter(ack=>ack.message_family==='APERAK'&&ack.ack_outcome==='positive')).toEqual([])
}
function removeSourceSegments(raw:string,select:(segment:ReturnType<typeof tokenizeEdifact>['segments'][number])=>boolean){
 const {segments}=tokenizeEdifact(raw),selected=segments.filter(select)
 expect(selected.length).toBeGreaterThan(0)
 let changed=raw
 for(const segment of [...selected].reverse()){
  const span=segmentSourceSpan(segment)!
  // Span omits the terminator: remove the complete selected physical segment.
  changed=changed.slice(0,span.startOffset)+changed.slice(span.endOffset+1)
 }
 return changed
}
function removeCharacteristic(raw:string,descriptor:string){
 const wire=tokenizeEdifact(raw),heads=wire.segments.filter(segment=>segment.tag==='CCI'&&segmentComposite(segment,2,wire.una)[0]===descriptor)
 expect(heads).toHaveLength(1)
 const head=heads[0],tail=wire.segments.find(segment=>segment.index===head.index+1)
 expect(tail?.tag).toBe('CAV')
 return removeSourceSegments(raw,segment=>segment.index===head.index||segment.index===tail!.index)
}
function extraUd(raw:string){
 const wire=tokenizeEdifact(raw),installation=wire.segments.filter(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='IT')
 expect(installation).toHaveLength(1)
 const span=segmentSourceSpan(installation[0])!
 return raw.slice(0,span.startOffset)+"NAD+UD+FORBIDDEN-UD-F::89++Forbidden Identity+Forbidden Street+Town++12345+SE'\n"+raw.slice(span.startOffset)
}
function expectIgnoredUd(f:Fixture,change:Change){
 const wire=tokenizeEdifact(change.message.raw_payload!),groups=prodatRegisterGroups(wire.segments,wire.una,'Z06').groups
 expect(groups).toHaveLength(1)
 const own=groups[0],ud=own.segments.filter(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='UD')
 expect(ud).toHaveLength(1);expect(segmentComposite(ud[0],2,wire.una)).toEqual(['FORBIDDEN-UD-F','','89'])
 const stored=sourceEffects(f,change.message.id).ignored
 expect(stored).not.toBeNull()
 expect(stored!.source_payload_hash).toBe(createHash('sha256').update(change.message.raw_payload!).digest('hex'))
 expect(stored!.fields_hash).toBe(createHash('sha256').update(stored!.fields_text).digest('hex'))
 const fields=JSON.parse(stored!.fields_text) as {fieldNumber:string;sourceRule:string;occurrence:Record<string,unknown>}[]
 for(const fieldNumber of ['END_USER_GROUP','227','228','229','231','232','316']){
  const field=fields.filter(item=>item.fieldNumber===fieldNumber)
  expect(field).toHaveLength(1)
  expect(field[0]).toMatchObject({sourceRule:'PRODAT26A:P119',occurrence:{objectId:f.f.external,identityAgency:'9',lineIndex:own.lineIndex,registerPosition:1,lineItemReference:f.f.caseReference,
   messageReference:segmentComposite(wire.segments.find(segment=>segment.tag==='UNH')!,1,wire.una)[0],ownReferences:{customerId:{kind:'present',value:'FORBIDDEN-UD-F'}}}})
 }
}
it.each([false,true])('F first case approval versions only its original structure; physical extra UD=%s never changes customer identity',async withUd=>{
 const f=await fixture(),change=await f.change('F',undefined,{deferFirstApply:true,...(withUd?{rawTransform:extraUd}:{})}),route=configureAckRoute(f)
 const initial=evidence(f,change.message.id)
 expectNoFirstEffects(f,change.message)
 if(withUd){expect(change.message.raw_payload).toContain('FORBIDDEN-UD-F');expect(initial.original.raw_payload).toBe(change.message.raw_payload!);expectIgnoredUd(f,change)}
 const current=await pendingFirstApplication(f,change),before=evidence(f,change.message.id)
 expectNoFirstEffects(f,change.message)
 expect(before.market).toEqual(initial.market);expect(before.source).toEqual(initial.source);expect(before.original).toEqual(initial.original)
 expect(before.acks.map(ack=>ack.message_family)).toEqual(['CONTRL'])
 const approved=await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(approved.status).toBe('applied')
 const after=evidence(f,change.message.id),effects=sourceEffects(f,change.message.id),hash=createHash('sha256').update(change.message.raw_payload!).digest('hex')
 expectOwnAcks(f,change,route,after)
 expect(after.market).toEqual(initial.market);expect(after.source).toEqual(initial.source);expect(after.original).toEqual(initial.original)
 expect(effects.objects).toHaveLength(1);expect(effects.batches).toHaveLength(1)
 const own=effects.objects[0]
 expect(own).toMatchObject({source_message_id:change.message.id,first_line_index:current.scope.lineIndex,company_id:f.f.companyId,environment:'test',payload_hash:hash,actor_user_id:f.operator.id,
  object_scope:{objectId:f.f.external,identityAgency:'9',registers:[{segmentIndex:current.scope.lineIndex,registerPosition:1}]},
  effect:{meteringPointId:f.f.pointId,siteId:f.f.siteId,wire:{messageCode:'Z06',businessCase:'change_with_reading',caseReference:f.f.caseReference,registers:[{position:1,registerId:'101'}]}}})
 expect(own.canonical_assessment_id).toMatch(/^[0-9a-f-]{36}$/);expect(own.object_assessment_id).toMatch(/^[0-9a-f-]{36}$/)
 const effective=new Date(`${f.f.requestedStartDate}T00:00:00Z`);effective.setUTCDate(effective.getUTCDate()+12);effective.setUTCMinutes(effective.getUTCMinutes()-60)
 expect(Date.parse(own.effect.effectiveAt)).toBe(effective.getTime())
 expect(Date.parse(own.source_received_at)).toBe(Date.parse(change.message.message_received_at!))
 expect(Date.parse(own.effect.sourceReceivedAt)).toBe(Date.parse(change.message.message_received_at!))
 expect(own.effect.sourceRegisters).toHaveLength(1)
 expect(own.effect.sourceRegisters[0].register.segmentIndex).toBe(current.scope.lineIndex)
 expect(own.effect.sourceRegisters[0].tokens).toContainEqual(expect.objectContaining({tag:'LIN',elements:expect.arrayContaining([['1'],[f.f.external,'','','9']])}))
 expect(effects.batches[0]).toMatchObject({source_message_id:change.message.id,payload_hash:hash,canonical_assessment_id:own.canonical_assessment_id,object_assessment_id:own.object_assessment_id,result:{sourceMessageId:change.message.id,applied:true,appliedCount:1}})
 expect(effects.expectations).toHaveLength(1);expect(effects.observations).toEqual([])
 expect(effects.expectations[0]).toMatchObject({source_message_id:change.message.id,first_line_index:current.scope.lineIndex,contract:{sourceMessageId:change.message.id,sourcePayloadHash:hash,mode:'meter_reading',expectedRegisterIds:['101'],measurementMethod:'Z04',wire:{meterNumber:'METER-1'},deadline:null,automaticRequestAllowed:false}})
 expect((await f.read(change.message.id)).data).toMatchObject({expectations:[{status:'pending'}]})
 if(withUd)expectIgnoredUd(f,change)
 const final=await readReceivedProdatFinalResponsePlan({companyId:f.f.companyId,sourceMessageId:change.message.id,rawPayload:change.message.raw_payload!})
 expect(final).not.toBeNull();expect(final!.plans).toMatchObject([{outcome:'positive',effectKind:'structural',objectLineIndices:[current.scope.lineIndex],acknowledgedReferences:[current.scope.li]}])
 const replay=await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:approved.id,structuralObjectLineIndices:[current.scope.lineIndex]})
 expect(replay.status).toBe('applied');expect(sourceEffects(f,change.message.id)).toEqual(effects)
 expect({...evidence(f,change.message.id),case:null}).toEqual({...after,case:null})
 expect(external.send).toHaveBeenCalledTimes(1)
 if(!withUd){
  // Compose this first case effect with the retained real E66 consumer. The
  // observation must exist after persistence, before any read reconciliation.
  const reading=await f.reading(),outboundBefore=f.snapshots().outbound
  expect(reading.qualified.runtime.transactionDispositions).toMatchObject([{disposition:'accepted',responseType:'positive_aperak'}])
  expect(await reading.persist()).toMatchObject([{disposition:'accepted',persistenceStatus:'persisted'}])
  const observed=sourceEffects(f,change.message.id)
  expect(observed.objects).toEqual(effects.objects);expect(observed.batches).toEqual(effects.batches)
  expect(observed.expectations).toEqual(effects.expectations);expect(observed.observations).toHaveLength(1)
  expect(observed.observations[0]).toMatchObject({utilts_source_message_id:reading.message.id,transaction_id:reading.qualified.runtime.facts.transactions[0].transactionId,
   source_payload_hash:createHash('sha256').update(reading.message.raw_payload!).digest('hex'),receipt:{utiltsSourceId:reading.message.id,observation:'actual_accepted_persisted_member',
    reading:[{registerId:'101',meterNumber:'METER-1',sourceQuantity:['220','10000']},{registerId:'101',meterNumber:'METER-1',sourceQuantity:['220','11000']}]}})
  const view=await f.read(change.message.id)
  expect(view.error).toBeNull();expect(view.data).toMatchObject({expectations:[{status:'reading_observed',deadline:null,automaticRequestAllowed:false}]})
  expect(f.snapshots().outbound).toBe(outboundBefore)
  await reading.persist();expect(sourceEffects(f,change.message.id)).toEqual(observed)
 }
})

it('F physical missing fields/correlation and wrong legal parties cannot establish a first structural effect',async()=>{
 const f=await fixture();configureAckRoute(f)
 const probes:{name:string;field?:string;process?:false;transform:(raw:string)=>string}[]=[
  {name:'missing required own508',field:'508',transform:raw=>removeSourceSegments(raw,segment=>segment.tag==='DTM'&&segmentComposite(segment,1,tokenizeEdifact(raw).una)[0]==='354')},
  {name:'missing applicable own214',field:'214',transform:raw=>removeCharacteristic(raw,'Z02')},
  {name:'missing own LI',field:'226',transform:raw=>removeSourceSegments(raw,segment=>segment.tag==='RFF'&&segmentComposite(segment,1,tokenizeEdifact(raw).una)[0]==='LI')},
  {name:'reversed source roles',process:false,transform:raw=>raw.replaceAll(`${f.f.receiver}:14`,`${f.f.sender}:14`).replaceAll(`+${f.f.sender}:14+${f.f.sender}:14+`,`+${f.f.sender}:14+${f.f.receiver}:14+`)
   .replace(`NAD+FR+${f.f.receiver}:160:SVK`,`NAD+FR+${f.f.sender}:160:SVK`).replace(`NAD+DO+${f.f.sender}:160:SVK`,`NAD+DO+${f.f.receiver}:160:SVK`)},
  {name:'legal receiver mismatches transport',process:false,transform:raw=>raw.replace(`NAD+DO+${f.f.sender}:160:SVK`,`NAD+DO+${f.f.receiver}:160:SVK`)},
 ]
 for(const probe of probes){
  const message=await f.captureChange('F',undefined,{rawTransform:probe.transform}),initial=evidence(f,message.id)
  expect(validateEdifactEnvelope(message.raw_payload!).syntaxOk).toBe(true)
  expectNoFirstEffects(f,message)
  if(probe.process!==false){
   const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{actorUserId:f.operator.id})
   const defects=decision.issues.filter(issue=>issue.prodatDiagnostic?.kind==='field'&&issue.prodatDiagnostic.fieldNumber===probe.field&&issue.prodatDiagnostic.errorKind==='missing')
   expect(defects.length).toBeGreaterThan(0)
   expect(decision.prodatApplicationValidation?.objects).toMatchObject([{applicationDecision:'rejected'}])
   await processInboundEdielMessage({actorUserId:f.operator.id,edielMessageId:message.id})
   await requireEdielSourceRulePackEvidence(f.f.companyId,message.id)
   const review=await reviewReceivedStructuralSource({companyId:f.f.companyId,environment:'test',sourceMessageId:message.id,reviewerUserId:f.operator.id,confirmedOriginal:true,replacesSourceMessageId:null})
   const application=await readReceivedProdatApplicationObjects({companyId:f.f.companyId,sourceMessageId:message.id,rawPayload:message.raw_payload!})
   expect(application).not.toBeNull()
   expectRecordedOwnRefusal(f,message,review,refusalEvidence(f,message),application!,'rejected',defects[0].code,probe.field)
   await expect(approveSafeMasterdataChanges({edielMessageId:message.id,actorUserId:f.operator.id})).rejects.toThrow(/^structural_apply_no_qualified_object$/)
  }else{
   // These wrong legal receivers are held at genuine source-context capture,
   // before a canonical composition can legitimately be recorded.
   const wire=tokenizeEdifact(message.raw_payload!),envelope=EdifactEnvelopeCodec.decode(message.raw_payload!)
   const legalReceiver=wire.segments.find(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='DO')!
   expect(segmentComposite(legalReceiver,2,wire.una)[0]).toBe(f.f.receiver)
   expect(envelope.receiver).toBe(probe.name==='reversed source roles'?f.f.receiver:f.f.sender)
   expect(envelope.sender).toBe(probe.name==='reversed source roles'?f.f.sender:f.f.receiver)
   expectPhysicalContextRefusal(f,message,refusalEvidence(f,message))
   await expect(approveSafeMasterdataChanges({edielMessageId:message.id,actorUserId:f.operator.id})).rejects.toThrow(/^ediel_inbound_legal_context_required$/)
  }
  expectNoFirstEffects(f,message)
  const after=evidence(f,message.id)
  expect(after.market).toEqual(initial.market);expect(after.source).toEqual(initial.source);expect(after.original).toEqual(initial.original)
 }
 // Same real owner and prerequisites accept an intact control after refusals.
 const control=await prepareCapturedControl(f,await f.captureChange('F')),current=await pendingFirstApplication(f,control)
 expectNoFirstEffects(f,control.message)
 expect(await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id,structuralObjectLineIndices:[current.scope.lineIndex]})).toMatchObject({status:'applied'})
})

it('F cannot borrow a foreign physical point, admit outbound source input or mutate a sealed deferred original',async()=>{
 const f=await fixture(),foreign=await fixture();configureAckRoute(f)
 const message=await f.captureChange('F',undefined,{rawTransform:raw=>raw.replaceAll(f.f.external,foreign.f.external)}),initial=evidence(f,message.id),foreignBefore=evidence(foreign,foreign.f.source)
 await processInboundEdielMessage({actorUserId:f.operator.id,edielMessageId:message.id})
 await requireEdielSourceRulePackEvidence(f.f.companyId,message.id)
 const review=await reviewReceivedStructuralSource({companyId:f.f.companyId,environment:'test',sourceMessageId:message.id,reviewerUserId:f.operator.id,confirmedOriginal:true,replacesSourceMessageId:null})
 const application=await readReceivedProdatApplicationObjects({companyId:f.f.companyId,sourceMessageId:message.id,rawPayload:message.raw_payload!})
 expect(application).not.toBeNull()
 const stored=refusalEvidence(f,message)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.metering_points WHERE company_id=${literal(foreign.f.companyId)} AND id=${literal(foreign.f.pointId)} AND meter_point_id=${literal(foreign.f.external)}`)).toBe(1)
 expectRecordedOwnRefusal(f,message,review,stored,application!,'unavailable','structural_review_owner_unavailable')
 // The intact canonical own member reaches SQL11232's empty qualified partition.
 await expect(approveSafeMasterdataChanges({edielMessageId:message.id,actorUserId:f.operator.id})).rejects.toThrow(/^structural_apply_no_qualified_object$/)
 expectNoFirstEffects(f,message)
 expect(evidence(f,message.id).market).toEqual(initial.market);expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
 // Real INSERT constraints reject this unqualified outbound input. No route,
 // source-operation or acceptance authority is invented to bypass the guard.
 const sourceCount=sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.f.companyId)}`),directionBefore=evidence(f,message.id)
 await expect(f.captureChange('F',undefined,{direction:'outbound'})).rejects.toThrow('canonical_ediel_route_required')
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.f.companyId)}`)).toBe(sourceCount)
 expect(evidence(f,message.id)).toEqual(directionBefore);expectNoFirstEffects(f,message)
 const change=await f.change('F',undefined,{deferFirstApply:true}),sealed=evidence(f,change.message.id),effects=sourceEffects(f,change.message.id)
 const mutation=await supabaseService.from('ediel_messages').update({raw_payload:change.message.raw_payload!.replace('METER-1','ALTERED-METER')}).eq('id',change.message.id).eq('company_id',f.f.companyId)
 expect(mutation.error?.message).toContain('immutable_ediel_payload_cannot_change')
 expect(evidence(f,change.message.id)).toEqual(sealed);expect(sourceEffects(f,change.message.id)).toEqual(effects)
 const current=await pendingFirstApplication(f,change)
 expect(await approveEdielInboundCase({companyId:f.f.companyId,actorUserId:f.operator.id,caseId:current.inboundCase.id,structuralObjectLineIndices:[current.scope.lineIndex]})).toMatchObject({status:'applied'})
 expect(evidence(foreign,foreign.f.source)).toEqual(foreignBefore)
})
```

</details>

<details><summary>ediel-fg-6f94-sc031-broad-observation-controller.cjs (controller/preimage/diff original), 4324 bytes — SHA256 1b4af6aa0fb7cb967c48c51ffe5876850208c67aaa2fc8c1233923a179168760</summary>

```javascript
// Actual unchanged parser AST through real pure parser dependencies only.
// Constructed physical inputs; no DB/case write/native authority is executed.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const root='/workspace/ediel-fg-proof-20261013-6f94',ts=require(root+'/node_modules/typescript'),{load}=require('/tmp/ediel-fg-6f94-model-ports.cjs')
function pick(file,names){const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true),printer=ts.createPrinter();return source.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name.text)).map(n=>printer.printNode(ts.EmitHint.Unspecified,n,source)).join('\n')}
const modules=['lib/ediel/prodat/parser.ts','lib/ediel/prodat/prodatRegisterFields.ts','lib/ediel/prodat/prodatDateFields.ts','lib/ediel/prodat/render/dates.ts','lib/ediel/prodat/prodatPartyFields.ts','lib/ediel/prodat/prodatReferenceFields.ts','lib/ediel/prodat/prodatCharacteristicFields.ts','lib/ediel/core/edifactSegments.ts','lib/ediel/core/una.ts','lib/ediel/codeLabels.ts']
const ports=Object.assign({},...modules.map(m=>load(root+'/'+m))),names=Object.keys(ports),helpers=['trimOrNull','normalizeUpper','normalizeDigits','edifactDateToIsoDate','numberOrNull','valueFromParsed','parseInboundProdatBusinessData']
const code=pick(root+'/lib/ediel/inboundCases.ts',helpers).replace(/^export /gm,'')+'\nreturn parseInboundProdatBusinessData'
const parse=new Function(...names,ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...names.map(n=>ports[n]))
const token=load(root+'/lib/ediel/core/edifactTokenizer.ts'),wireApi=load(root+'/scripts/helpers/ediel-z06f-reading-followup-native-wire.ts')
const scope={external:'735123456789012345',sender:'54321',receiver:'12345',brpEdielId:'11111',caseReference:'CASE-1',gridAreaCode:'NET-1',requestedStartDate:'2026-11-01'}
const keys=['customerId','customerIdQualifier','customerIdLabel','customerType','personalNumber','orgNumber','birthDate','fullName','companyName','firstName','lastName','address','postalCode','city','country'],expected=Object.fromEntries(keys.map(k=>[k,k==='customerIdLabel'?'Ej angivet':null]))
function changed(kind,raw){const snippet=pick(root+`/scripts/ediel-at-z06${kind.toLowerCase()}-supplier-acceptance-native.test.ts`,['extraUd']);const fn=new Function('tokenizeEdifact','segmentComposite','segmentSourceSpan','expect',ts.transpileModule(snippet+'\nreturn extraUd',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(token.tokenizeEdifact,token.segmentComposite,token.segmentSourceSpan,a=>({toHaveLength:n=>assert.equal(a.length,n)}));return fn(raw)}
function project(customer){return Object.fromEntries(keys.map(k=>[k,customer[k]]))}
const observations={parserSHA256:crypto.createHash('sha256').update(fs.readFileSync(root+'/lib/ediel/inboundCases.ts')).digest('hex'),scope:'Actual pure parser/case projection observation; finite constructed raw input only; native NOT_RUN',expected,variants:{}}
for(const kind of ['F','G']){
 const raw=wireApi.z06fNativeStructureWire(scope,kind,'DECLARED-'+kind),message={id:'00000000-0000-4000-8000-000000000006',company_id:'00000000-0000-4000-8000-000000000001',direction:'inbound',message_family:'PRODAT',message_code:'Z06',raw_payload:raw,parsed_payload:{customerName:'POISON CACHED',customerId:'CACHED'}}
 const clean=parse(message),dirtyRaw=changed(kind,raw),dirty=parse({...message,raw_payload:dirtyRaw})
 assert.deepEqual(project(clean.customer),expected);assert.notDeepEqual(project(dirty.customer),expected)
 assert.deepEqual(dirty.site,clean.site);assert.deepEqual(dirty.meteringPoint,clean.meteringPoint);assert.deepEqual(dirty.contract,clean.contract)
 observations.variants[kind]={clean:project(clean.customer),dirty:project(dirty.customer),dirtyKeys:keys.filter(k=>dirty.customer[k]!==expected[k]),retainedPhysicalRawHash:crypto.createHash('sha256').update(dirtyRaw).digest('hex'),legitimateInstallationRegisterProjectionUnchanged:true}
 console.log('PASS actual '+kind+' noUD baseline all15 namedfields; current c08e parser retains dirtyUD namedbusiness; installation/register/contract unchanged')
}
console.log(JSON.stringify(observations))
module.exports={parse,keys,expected,scope,wireApi,token,changed,project,pick,observations}
```

</details>

<details><summary>ediel-fg-6f94-sc031-first-observation-controller.cjs (controller/preimage/diff original), 4299 bytes — SHA256 63a94e197dcc56814b09a19ac37fc7390b00ede1166467c5c8c116335d1e4bf8</summary>

```javascript
// Actual unchanged parser AST through real pure parser dependencies only.
// Constructed physical inputs; no DB/case write/native authority is executed.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const root='/workspace/ediel-fg-proof-20261013-6f94',ts=require(root+'/node_modules/typescript'),{load}=require('/tmp/ediel-fg-6f94-model-ports.cjs')
function pick(file,names){const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true),printer=ts.createPrinter();return source.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name.text)).map(n=>printer.printNode(ts.EmitHint.Unspecified,n,source)).join('\n')}
const modules=['lib/ediel/prodat/parser.ts','lib/ediel/prodat/prodatRegisterFields.ts','lib/ediel/prodat/prodatDateFields.ts','lib/ediel/prodat/render/dates.ts','lib/ediel/prodat/prodatPartyFields.ts','lib/ediel/prodat/prodatReferenceFields.ts','lib/ediel/prodat/prodatCharacteristicFields.ts','lib/ediel/core/edifactSegments.ts','lib/ediel/core/una.ts','lib/ediel/codeLabels.ts']
const ports=Object.assign({},...modules.map(m=>load(root+'/'+m))),names=Object.keys(ports),helpers=['trimOrNull','normalizeUpper','normalizeDigits','edifactDateToIsoDate','numberOrNull','valueFromParsed','parseInboundProdatBusinessData']
const code=pick(root+'/lib/ediel/inboundCases.ts',helpers)+'\nreturn parseInboundProdatBusinessData'
const parse=new Function(...names,ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...names.map(n=>ports[n]))
const token=load(root+'/lib/ediel/core/edifactTokenizer.ts'),wireApi=load(root+'/scripts/helpers/ediel-z06f-reading-followup-native-wire.ts')
const scope={external:'735123456789012345',sender:'54321',receiver:'12345',brpEdielId:'11111',caseReference:'CASE-1',gridAreaCode:'NET-1',requestedStartDate:'2026-11-01'}
const keys=['customerId','customerIdQualifier','customerIdLabel','customerType','personalNumber','orgNumber','birthDate','fullName','companyName','firstName','lastName','address','postalCode','city','country'],expected=Object.fromEntries(keys.map(k=>[k,k==='customerIdLabel'?'Ej angivet':null]))
function changed(kind,raw){const snippet=pick(root+`/scripts/ediel-at-z06${kind.toLowerCase()}-supplier-acceptance-native.test.ts`,['extraUd']);const fn=new Function('tokenizeEdifact','segmentComposite','segmentSourceSpan','expect',ts.transpileModule(snippet+'\nreturn extraUd',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(token.tokenizeEdifact,token.segmentComposite,token.segmentSourceSpan,a=>({toHaveLength:n=>assert.equal(a.length,n)}));return fn(raw)}
function project(customer){return Object.fromEntries(keys.map(k=>[k,customer[k]]))}
const observations={parserSHA256:crypto.createHash('sha256').update(fs.readFileSync(root+'/lib/ediel/inboundCases.ts')).digest('hex'),scope:'Actual pure parser/case projection observation; finite constructed raw input only; native NOT_RUN',expected,variants:{}}
for(const kind of ['F','G']){
 const raw=wireApi.z06fNativeStructureWire(scope,kind,'DECLARED-'+kind),message={id:'00000000-0000-4000-8000-000000000006',company_id:'00000000-0000-4000-8000-000000000001',direction:'inbound',message_family:'PRODAT',message_code:'Z06',raw_payload:raw,parsed_payload:{customerName:'POISON CACHED',customerId:'CACHED'}}
 const clean=parse(message),dirtyRaw=changed(kind,raw),dirty=parse({...message,raw_payload:dirtyRaw})
 assert.deepEqual(project(clean.customer),expected);assert.notDeepEqual(project(dirty.customer),expected)
 assert.deepEqual(dirty.site,clean.site);assert.deepEqual(dirty.meteringPoint,clean.meteringPoint);assert.deepEqual(dirty.contract,clean.contract)
 observations.variants[kind]={clean:project(clean.customer),dirty:project(dirty.customer),dirtyKeys:keys.filter(k=>dirty.customer[k]!==expected[k]),retainedPhysicalRawHash:crypto.createHash('sha256').update(dirtyRaw).digest('hex'),legitimateInstallationRegisterProjectionUnchanged:true}
 console.log('PASS actual '+kind+' noUD baseline all15 namedfields; current c08e parser retains dirtyUD namedbusiness; installation/register/contract unchanged')
}
console.log(JSON.stringify(observations))
module.exports={parse,keys,expected,scope,wireApi,token,changed,project,pick,observations}
```

</details>

<details><summary>ediel-fg-6f94-sc031-run.py (controller/preimage/diff original), 1165 bytes — SHA256 0a118b723c99db6b257173fe23a914e9ef60b0f1190b54cdc96ca61f92972d4d</summary>

```python
import subprocess,json,hashlib,sys,datetime
from pathlib import Path
root=Path('/workspace/ediel-fg-proof-20261013-6f94');node='/tmp/ediel-fg-6f94-npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node';label=sys.argv[1];cmd=[node,*sys.argv[2:]]
files=['scripts/ediel-at-z06f-supplier-acceptance-native.test.ts','scripts/ediel-at-z06g-supplier-acceptance-native.test.ts']
meta={'command':cmd,'sourceHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'codeHashes':{f:hashlib.sha256((root/f).read_bytes()).hexdigest()for f in files},'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
r=subprocess.run(cmd,cwd=root,capture_output=True);meta['exitCode']=r.returncode
for kind,data in [('stdout',r.stdout),('stderr',r.stderr)]:
 p=Path('/tmp/ediel-fg-6f94-sc031-'+label+'.'+kind+'.log');assert not p.exists();p.write_bytes(data);meta[kind]={'path':str(p),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
Path('/tmp/ediel-fg-6f94-sc031-'+label+'.json').write_text(json.dumps(meta,indent=2)+'\n');print(json.dumps(meta,indent=2));print(r.stdout.decode());print(r.stderr.decode());sys.exit(r.returncode)
```

</details>

<details><summary>ediel-fg-6f94-sc031-observe.cjs (controller/preimage/diff original), 4972 bytes — SHA256 1b16015f404588f76cd198d18d36bd9c3c50438f131ca508d5507fdf2dca7c44</summary>

```javascript
// Actual unchanged parser AST through real pure parser dependencies only.
// Constructed physical inputs; no DB/case write/native authority is executed.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const root='/workspace/ediel-fg-proof-20261013-6f94',ts=require(root+'/node_modules/typescript'),{load}=require('/tmp/ediel-fg-6f94-model-ports.cjs')
function pick(file,names){const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true),printer=ts.createPrinter();return source.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name.text)).map(n=>printer.printNode(ts.EmitHint.Unspecified,n,source)).join('\n')}
const modules=['lib/ediel/prodat/parser.ts','lib/ediel/prodat/prodatRegisterFields.ts','lib/ediel/prodat/prodatDateFields.ts','lib/ediel/prodat/render/dates.ts','lib/ediel/prodat/prodatPartyFields.ts','lib/ediel/prodat/prodatReferenceFields.ts','lib/ediel/prodat/prodatCharacteristicFields.ts','lib/ediel/core/edifactSegments.ts','lib/ediel/core/una.ts','lib/ediel/codeLabels.ts']
const ports=Object.assign({},...modules.map(m=>load(root+'/'+m))),names=Object.keys(ports),helpers=['trimOrNull','normalizeUpper','normalizeDigits','edifactDateToIsoDate','numberOrNull','valueFromParsed','parseInboundProdatBusinessData']
const code=pick(root+'/lib/ediel/inboundCases.ts',helpers).replace(/^export /gm,'')+'\nreturn parseInboundProdatBusinessData'
const parse=new Function(...names,ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...names.map(n=>ports[n]))
const token=load(root+'/lib/ediel/core/edifactTokenizer.ts'),wireApi=load(root+'/scripts/helpers/ediel-z06f-reading-followup-native-wire.ts')
const scope={external:'735123456789012345',sender:'54321',receiver:'12345',brpEdielId:'11111',caseReference:'CASE-1',gridAreaCode:'NET-1',requestedStartDate:'2026-11-01'}
const keys=['customerId','customerIdQualifier','customerIdLabel','customerType','personalNumber','orgNumber','birthDate','fullName','companyName','firstName','lastName','address','postalCode','city','country'],expected=Object.fromEntries(keys.map(k=>[k,k==='customerIdLabel'?'Ej angivet':null]))
function changed(kind,raw){const snippet=pick(root+`/scripts/ediel-at-z06${kind.toLowerCase()}-supplier-acceptance-native.test.ts`,['extraUd']);const fn=new Function('tokenizeEdifact','segmentComposite','segmentSourceSpan','expect',ts.transpileModule(snippet+'\nreturn extraUd',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(token.tokenizeEdifact,token.segmentComposite,token.segmentSourceSpan,a=>({toHaveLength:n=>assert.equal(a.length,n)}));return fn(raw)}
function project(customer){return Object.fromEntries(keys.map(k=>[k,customer[k]]))}
const observations={parserSHA256:crypto.createHash('sha256').update(fs.readFileSync(root+'/lib/ediel/inboundCases.ts')).digest('hex'),scope:'Actual pure parser/case projection observation; finite constructed raw input only; native NOT_RUN',expected,variants:{}}
for(const kind of ['F','G']){
 const raw=wireApi.z06fNativeStructureWire(scope,kind,'DECLARED-'+kind),message={id:'00000000-0000-4000-8000-000000000006',company_id:'00000000-0000-4000-8000-000000000001',direction:'inbound',message_family:'PRODAT',message_code:'Z06',raw_payload:raw,parsed_payload:{customerName:'POISON CACHED',customerId:'CACHED'}}
 const clean=parse(message),dirtyRaw=changed(kind,raw),dirty=parse({...message,raw_payload:dirtyRaw})
 assert.deepEqual(project(clean.customer),expected);assert.notDeepEqual(project(dirty.customer),expected)
 assert.deepEqual(dirty.site,clean.site);const {registers:cleanRegisters,...cleanMeter}=clean.meteringPoint,{registers:dirtyRegisters,...dirtyMeter}=dirty.meteringPoint;assert.deepEqual(dirtyMeter,cleanMeter);const registerFields=['meteringPointId','identityAgency','lineItemReference','meterNumber','meterConstant','meterDigitCount','meterTimeFrame','installationId','installationAddress','installationPostcode','installationCity','installationCountry','validRegisterChain'];const registerProjection=rows=>rows.map(row=>Object.fromEntries(registerFields.map(k=>[k,row[k]])));assert.deepEqual(registerProjection(dirtyRegisters),registerProjection(cleanRegisters));assert.ok(dirtyRegisters[0].rawSegments.some(s=>s.startsWith('NAD+UD+FORBIDDEN')));assert.deepEqual(dirty.contract,clean.contract)
 observations.variants[kind]={clean:project(clean.customer),dirty:project(dirty.customer),dirtyKeys:keys.filter(k=>dirty.customer[k]!==expected[k]),retainedPhysicalRawHash:crypto.createHash('sha256').update(dirtyRaw).digest('hex'),legitimateInstallationRegisterProjectionUnchanged:true}
 console.log('PASS actual '+kind+' noUD baseline all15 namedfields; current c08e parser retains dirtyUD namedbusiness; installation/register/contract unchanged')
}
console.log(JSON.stringify(observations))
module.exports={parse,keys,expected,scope,wireApi,token,changed,project,pick,observations}
```

</details>


## Nya oberoende fullständiga slutgranskningar och dokumentfrysning

H1 `2cb27b3c939a1f0046e73f1b5d36cd7a314d7349`, tree `55163270e8b74fc1f5fa3498270dc9b0c8e12b23`, enda parent `054abdeee5dff896b71af5b763be34a1a95b4488`, source467d/ac21, actualbase d798/e3b6. Två fristående noncoauthors har vardera granskat alla fem filer, frozen krav, aktuella verkliga decoder/case/approval-vägar, alla22 nya sparade original, tidigare P2-assertions och selektiv C10 UD-positive återanvändning. Båda: **SOURCE_APPROVE_WITH_UPSTREAM_LIMIT**, ingen ny owned-component P1/P2. C1:s upptagna decoder/saved-case-fix är fortfarande UNFIXED/UNADOPTED. Native12 NOT_RUN och whole/currentCI/GEN/backend/ledger/mainmerge +0. Rapporterna nedan bevaras ordagrant; kod/hashar ändras inte i dokumentversionen. Sourcewriters fortsatt PAUSED.

### Nytt original final A

Original `/tmp/ediel-fg-6f94-sc031-final-review-a-2cb27b3c.md`, 15159 bytes, SHA256 `dc19ef3d9049c16e0467272be51504191326cdc424a3ba78c1a836f439d979e8`.

```text
# Independent full final F/G source/oracle review A

**Verdict: SOURCE_APPROVE_WITH_UPSTREAM_LIMIT** for the complete five-file carrier below. No new confirmed P1/P2 must-fix in the owned fixture/test/config/checkpoint component. The disclosed current decoder defect remains UNFIXED/UNADOPTED and prevents treating this source preparation as passing native/whole-SC031/F/G evidence or merge readiness.

## Exact immutable binding and independence

- Final carrier H1: `2cb27b3c939a1f0046e73f1b5d36cd7a314d7349`; tree `55163270e8b74fc1f5fa3498270dc9b0c8e12b23`; ordered parents [`054abdeee5dff896b71af5b763be34a1a95b4488`].
- Frozen code: `054abdeee5dff896b71af5b763be34a1a95b4488`; tree `d9f5c403888f8882702ea49f2aa21dd56bf1f47d`; ordered parents [`467d12a99eb5ffa2e7e7ddccf46f8e78a28fbd8c`].
- Integrated source preimage: `467d12a99eb5ffa2e7e7ddccf46f8e78a28fbd8c`; tree `ac21a93c50ddb575497ec3ce209ebc22a29d7ff2`; ordered parents [`0dbc3101138e6ebe041bc280d9f7b68e4876e0ce`, `d798eb36f35cd4f437d44c8d234b4dbb81adc7a6`].
- Historical public F/G source: `0dbc3101138e6ebe041bc280d9f7b68e4876e0ce`, tree `989dd2927f4acd9f783cb6644a0b971078153ec7`.
- Actual base: `d798eb36f35cd4f437d44c8d234b4dbb81adc7a6`; tree `e3b6c11677a2b871a128504f1616def7d22dba1e`; ordered parents [`95d8d160491e79b172342654d8dc643346758105`, `fba453cc7cc9de8a26ec75d29248e1733316fcd1`].
- Workspace: `/workspace/ediel-fg-proof-20261013-6f94`, clean at exact H1 when inspected.
- Retained receipt: `3f4b1b494ec70bd0217cd935352946416a4d51eb`; packet `cf251c2f-a87c-4c82-aaa5-4d711a754b5c`; resumed two-test handoff `6149882155`; concrete oracle finding `6149259115`. Helper metadata/IDs remain empty and no producer scope is added. Source writer `/root/z06fg_requirements` and root are paused.

| Whole owned path | Final SHA256 |
| --- | --- |
| `scripts/helpers/ediel-z06f-reading-followup-native-fixture.ts` | `bb9d77bb25a0d98cecba59ba0b2faa60d306e6b1a4ac3ea35022cf3170119961` |
| `scripts/ediel-at-z06f-supplier-acceptance-native.test.ts` | `64fd6cfe7b6dad4ab4e6f7c8bcadad54882cbcecd34c11e0f9b4a8844d5a7d81` |
| `scripts/ediel-at-z06g-supplier-acceptance-native.test.ts` | `34d394d5a681757d0aa9e3a59d77206f04129dd385b7f83b9f91d3b0f9a58ce0` |
| `scripts/ediel-source-owner-native.config.ts` | `7350c100a0587a8dc3ea964bac2aef1df3bfcc38c8825c768f4cb84739327087` |
| `.agent-memory/ediel-fg-proof-20261013-6f94-checkpoint.md` | `b79f8a63702a9ccf93f76d600d187c15acd5de1d03fbc54ddac714933d0bbd0f` |

Checkpoint size is 255,768 bytes. F/G blobs are respectively `68b94eb06f469b0d85b9a21cfc44d9390ad11135` and `d0fe3d47a9832302d41c5a07b9247ed7b515943e`. Code adds exactly 17 lines per test, with no removal; the carrier adds only root's checkpoint change to frozen code. Base→carrier contains exactly the five owned paths.

I am an independent noncoauthor: no implementation, test, fixture, controller, checkpoint, proof, or GEN authorship or execution. I did not consult the other final reviewer. This is a fresh assessment of the full current component, not automatic reuse of an old approval. Read-only source/diff/hash/metadata checks were performed; no tests or controls were executed. Only this original `/tmp` report was written. Code-review/differential-review, frozen spec-to-code, direct false-positive verification, source/Supabase/Postgres boundary guidance, and verification-before-completion informed this bounded review. Broad audits, remediation, UI/performance, producer workflows, private fetches, and delivery actions are outside this scope.

## Requirements and complete source frame

I reviewed the entire helper/config and F/G source, their common code and all actual differences, the new diff and active checkpoint/evidence frame, and the current real consumer path. Frozen AT-Z06F/G require DDQ Z06/E64 or E32, guide ACKs, dated own structure, F follow-up versus G no invented readings, no customer identity from forbidden NAD+UD, and concrete role/direction/R-D/correlation/mutation refusals. Frozen P-02 requires preserving raw payload while ignoring unused national information for business projection; SC-031 requires valid extras neither cause a negative APERAK by themselves nor affect business data, without relaxing the outgoing builder. These literal requirements and TEN-05/P-01/ENV-06 remain unchanged.

The fixture still admits new physical originals, records real canonical validation, captures the source-rule basis, completes the actual owner session, and obtains explicit structural review before application. `captureChange` supplies an original without invented acceptance; deferred change preserves all qualification steps but withholds first application. Changed inputs are constructed before admission and UNT is recounted. Defaults remain intact. The first-case tests perform intake, then a fresh real structural review, before first approval. The shared config retains its mandatory loopback/status/key gates, all previous includes/setup, 120-second limits, and serial file execution; this revision changes no gate or include.

I traced current `parseInboundProdatBusinessData`, `createOrUpdateInboundProdatCase`, `approveEdielInboundCase`, the coordinator's structural case path, `reviewReceivedStructuralSource`, and `approveSafeMasterdataChanges`. The native evidence SQL queries bind company/source and read actual original, case, structural receipt/batch, ignored facet, ACK/outbox, and follow-up tables. The existing structural-object SQL defines the queried scope/hash/assessment/actor/timing/effect shapes, and the source-owned follow-up SQL distinguishes F expectations from G no-reading status. These SQL/source observations are not evidence of execution or installed backend state.

Existing whole-frame assertions remain meaningful source controls: own physical ACK correlation/parties/ERC100 and outbox binding; actual first object/batch receipts; original/raw/hash and customer/site/supply graph preservation; installation/register/date semantics; F's actual E66 consumer path and observation immediately after persistence before read reconciliation; G's empty expectations/observations and `not_required_by_this_change`; original replay; and foreign tenant/actor/graph/LIN, physical R-D/LI, wrong parties/foreign point/direction/mutation refusals. Nodemailer remains the explicitly synthetic external transport port.

The earlier P2 correction is preserved: negatives require ready or precise source-held context, actual frozen rule basis, own canonical/object/witness hashes and scope, recorded disposition and concrete cause, and exact apply errors. Generic unconfirmed/missing-prerequisite outcomes cannot satisfy them. Positive captured controls use the same real capture/qualification path. I independently removed only the new customer helper and three new phase calls from each final source as a read-only text comparison: both files then match their integrated preimages byte for byte, and those preimages match public0dbc. This establishes preservation of all old source ASTs/assertions/order, not just selected regex counts. Four direct cases plus the two `it.each([false,true])` variants per file remain: native 12 prepared cases, not 12 executed results.

## New oracle strengths and causal reach

At F396–404/G395–403, `expectCleanStagedCustomer` requires a real saved case and binds its own case ID/company/source/Z06/precise phase status. It checks a non-array object projection and independently reads every one of the 15 named customer DTO keys. The baseline is 14 null values and actual no-UD label `Ej angivet`. A missing key reads as undefined and fails equality; poisoned values fail regardless of the FORBIDDEN sentinel string. No missing-case/projection fallback, substring-only exclusion, or whole-case equality across UUID/timestamp variants is used.

The actual call sites are F413/420/444 and G412/419/443: persisted pending-review case after staging; persisted applied case after actual approval; and persisted applied case after replay. Each lies in the body common to both no-UD and extra-UD positive variants. The approval/replay expected IDs come from the real returned rows, and each reread remains independently tied to its own source and company. Existing evidence still checks raw/ignored facets, original identity/hash, and legitimate structure; the oracle does not demand stripping received raw or nested evidence of UD.

The preserved finite controller reads the actual new assertion ASTs and current pure parser AST/dependencies. It separately establishes the actual no-UD baseline and counted syntax-valid extra-UD original, supplies explicit modeled case rows to each phase, rejects the actual dirty parser projection, poisons all 15 keys individually with a non-sentinel value, and rejects missing case/projection/key and wrong case/source/company/status. The real tokenizer/envelope and canonical field validator identify the seven national ignored facets. Physical evidence and legitimate named installation/register/site/contract projections are preserved. Those controls qualify the assertion's discrimination and source registration; modeled clean rows do not establish real case persistence or a corrected native path.

## Known upstream limitation — remains open

Current `lib/ediel/inboundCases.ts` is blob `c08e51d67c98b8b7be0fc726f2509059cf4aaec0`, SHA256 `39c7e81aeabb3c88b55258248d41672f7390009b72a792421ae021c037203e5f`. Its parser reads raw UD at line167 and maps its ID/name/address values into first-class customer fields at lines192–216. The case writer stores `parsed.customer` as `parsed_customer` at line422. Structural approval at lines801–808 updates decision/status/reviewer metadata and does not clean that existing customer projection.

Thus the saved actual-parser observations of eight dirty fields are causally supported by current source: `customerId`, `fullName`, `firstName`, `lastName`, `address`, `postalCode`, `city`, `country`. The counted final finite control rejects this projection with the new native helper. This is neither an executed native failure nor proof of mutation to actual customer rows. The extra-UD native path is expected to fail its staging oracle if it reaches that current writer, and its later phase checks do not thereby become executed proof.

The existing C1/a93c decoder/saved-case correction owner (`051ec`/handoff `6144860660`) remains occupied. That owner's corrected adopted source and affected producer qualification are required before claiming native/whole effects. No private correction was fetched or copied, no decoder/product/SQL source was written, and no assertion was weakened to force green. This known upstream issue is a condition on runtime/whole acceptance, not a new request for this test writer to take that owner's files.

## Qualification originals, applicability, and limits

Qualification JSON `/tmp/ediel-fg-6f94-sc031-oracle-qualification.json` has SHA256 `adea061a2708cb7f74a3349d51988334849dbdeb51f6dbb77f038638521670a9` and is embedded byte-exactly. I verified all six saved execution-metadata records, all 22 indexed output/controller/preimage artifacts' recorded sizes/hashes, and their exact embedded original bytes, including empty streams. The final control reports **66 PASS/0 FAIL**, stdout SHA256 `f59248db272f50fcc826e572be94cf451bcf7b2089ed228ccdb0b7e6ba24a55e`, stderr empty/e3b0. First scripts TypeScript and exact two-file lint records show exit0 against the final two source hashes; staged diff-check outputs are empty. Their metadata records precommit HEAD467d plus exact changed file hashes; those hashes match frozen code054ab and this carrier. I did not rerun any green check.

The finite parser loader uses real pure parser dependencies and no case writer/database execution. Its shared loader, SHA256 `b8dfa24628319ed7c51a6770c7e4ce657dd518894bd9c0c551d993f669a6cb63`, matches the read-only derivation specified in the preserved old physical controller from exact seam source SHA256 `f54ed1f173c5265262743b1444c6e2079e9694320f0392ce829fa94bbfa71b89`. This closes the loader-source applicability without executing it. The two observation-scaffold failures are accurately retained: invalid export wrapping before observation, then an overly broad nested/evidence equality. Neither is product RED/fix proof; the final counted control narrows the actual named-business oracle while retaining raw/nested evidence.

Applicable UD remains separately covered by selective existing C/Z24 finite original reuse: public Z04C429c/tree3e3d, codee627/tree855ca, test SHA256 `1f0f529be7fbe2f8acc84a9a4b30d22dce411c1a466843f0feeb4db06d457cb2`, first10 stdout SHA256 `255f4a00b1e1e272a8b702e4c7d96eae82d981a8419518f0d32baba12c48f936`. I verified these source/output pins and all seven declared parser/db/reading-SDK/owner-fixture/package-lock dependency hashes match current base/carrier and codee627. The actual C case consumer preserves applicable personalNumber199001011234 under declared modeled ports. This is selective positive applicability, not permission to use UD in F/G, a native proof, or a rerun.

Runtime/SQL/helper/test dependencies outside these owned additions are byte-identical to public0dbc; the integrated preimage adds exactly the four actual-main proof/checkpoint/archive/ledger paths. The archive was not opened and its originals were not collected. Earlier approvals and 42/9/4/69 checks remain historically attributed; they do not automatically approve this changed source or supply native/current-CI proof.

The frozen rules, acceptance register, and ledger match actual base byte for byte: SHA256 `48e5a0608107b01719152cf2a50bfe5fce083381cd66a6c64eb5f5d999cb8fd8`, `e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10`, and `7266ee57be5ac633ec0e8ca3f169aaf7d048da45ca0abfc6004284eae75c822e`. Base ledger remains119 VERIFIED+204 PASSED=323/352; SC-031 remains PARTIAL and both F/G rows NOT_EXECUTED. This component grants +0.

## Assessment and next ownership

Accept the exact carrier for superseding bounded source handoff with **SOURCE_APPROVE_WITH_UPSTREAM_LIMIT**. The checkpoint correctly distinguishes active two-test work, historical originals/approvals, the actual-base merge, first finite results, and the unfixed parser boundary. No new producer, protected acceptance seeding, product fix, activation gate, existing assertion weakening, global unlock, or custody transfer is introduced.

**Native12: NOT_RUN. Whole SC031/F/G, mandatory current CI, GEN/backend/environment/input-epoch qualification, genuine logs/originals, adoption, and normal main merge: not established.** The current decoder owner must deliver the applicable correction; the existing sole qualified producer and serial delivery owner retain actual union/admission/installed SQL/source authority, native/genuine evidence, current CI, and normal delivery. This reviewer performed no test/control/native/SQL/backend/GEN/log-collector/CI/ref/PR/publish/merge action and accessed no private ROOTf8 or decoder correction. Any changed adopted source or input environment requires affected qualification and exact-version binding. I pause after this original report.
```

### Nytt original final B

Original `/tmp/ediel-fg-6f94-sc031-final-review-b-2cb27b3c.md`, 16561 bytes, SHA256 `da78c4815b3b7171e59d740f8c2914a0148ba846d8cbc32661620bd086451354`.

```text
# Independent final full F/G source/oracle review B

**SOURCE_APPROVE_WITH_UPSTREAM_LIMIT** for the complete five-file carrier H1 `2cb27b3c939a1f0046e73f1b5d36cd7a314d7349` / tree `55163270e8b74fc1f5fa3498270dc9b0c8e12b23`. No new must-fix was confirmed in the prepared oracle/component. The actual current decoder remains **UNFIXED/UNADOPTED** and promotes ignored UD values into named staged customer business fields. This is source-scope approval with that concrete upstream limit, not approval of current product behavior or native acceptance.

**Native12 NOT_RUN. Whole SC-031/F/G, genuine SQL/backend/GEN/current CI, ledger/main/merge credit: none, +0.** The new with-UD native staging assertion is expected to fail on the current parser; no native run was performed or made green.

Reviewer `/root/fg_final_review_b` is a noncoauthor of this revision's code/tests/fixtures/executable proof. I did not consult another current final reviewer or coordinate findings. Only this original `/tmp` report was written. No test/rerun/native/SQL/backend/GEN/current CI/log collector, private ROOTf8/C1 decoder/unpublished correction/original/artifact fetch, source/ref write, PR or publication occurred.

## Exact full-version binding

| Identity | Verified value |
| --- | --- |
| Workspace | `/workspace/ediel-fg-proof-20261013-6f94` |
| Full H1 carrier | `2cb27b3c939a1f0046e73f1b5d36cd7a314d7349` |
| Full H1 tree | `55163270e8b74fc1f5fa3498270dc9b0c8e12b23` |
| H1 ordered parent | `[054abdeee5dff896b71af5b763be34a1a95b4488]` |
| Revised code source/tree | `054abdeee5dff896b71af5b763be34a1a95b4488` / `d9f5c403888f8882702ea49f2aa21dd56bf1f47d` |
| Code ordered parent | `[467d12a99eb5ffa2e7e7ddccf46f8e78a28fbd8c]` |
| Integrated preimage/tree | `467d12a99eb5ffa2e7e7ddccf46f8e78a28fbd8c` / `ac21a93c50ddb575497ec3ce209ebc22a29d7ff2` |
| Preimage ordered parents | `[0dbc3101138e6ebe041bc280d9f7b68e4876e0ce, d798eb36f35cd4f437d44c8d234b4dbb81adc7a6]` |
| Historical public F/G/tree | `0dbc3101138e6ebe041bc280d9f7b68e4876e0ce` / `989dd2927f4acd9f783cb6644a0b971078153ec7` |
| Current actual-main base/tree | `d798eb36f35cd4f437d44c8d234b4dbb81adc7a6` / `e3b6c11677a2b871a128504f1616def7d22dba1e` |
| Actual-base ordered parents | `[95d8d160491e79b172342654d8dc643346758105, fba453cc7cc9de8a26ec75d29248e1733316fcd1]` |

| Entire reviewed owned file | SHA256 |
| --- | --- |
| `scripts/helpers/ediel-z06f-reading-followup-native-fixture.ts` | `bb9d77bb25a0d98cecba59ba0b2faa60d306e6b1a4ac3ea35022cf3170119961` |
| `scripts/ediel-at-z06f-supplier-acceptance-native.test.ts` | `64fd6cfe7b6dad4ab4e6f7c8bcadad54882cbcecd34c11e0f9b4a8844d5a7d81` |
| `scripts/ediel-at-z06g-supplier-acceptance-native.test.ts` | `34d394d5a681757d0aa9e3a59d77206f04129dd385b7f83b9f91d3b0f9a58ce0` |
| `scripts/ediel-source-owner-native.config.ts` | `7350c100a0587a8dc3ea964bac2aef1df3bfcc38c8825c768f4cb84739327087` |
| `.agent-memory/ediel-fg-proof-20261013-6f94-checkpoint.md` | `b79f8a63702a9ccf93f76d600d187c15acd5de1d03fbc54ddac714933d0bbd0f` |

HEAD is exact H1 and tracked worktree is clean. The checkpoint is255768 bytes. Code diff from467d contains exactly17 added lines per test and no old code line removed. F/G blobs are `68b94eb06f469b0d85b9a21cfc44d9390ad11135` / `d0fe3d47a9832302d41c5a07b9247ed7b515943e`. The whole current base delta is precisely the five owned paths. Integrated main changes are only the four delivered proof/checkpoint/archive/ledger paths; no archive was opened or new original captured by this reviewer.

Custody is retained receipt `3f4b1b494ec70bd0217cd935352946416a4d51eb`, IDs EMPTY, four exact resources, with bounded two-test RESUME6149882155 to sole writer `/root/z06fg_requirements`. Helper/config remain read-only; root owns its unique checkpoint. Remote full-receipt/ref authentication is attributed to the existing owner/writer. No occupied decoder/runtime/SQL/helper/producer scope is acquired.

## Frozen requirements and independent whole-version assessment

Read literal frozen AT-Z06F/G-SUPPLIER, SC-031 and P-02. F/G forbid customer identity writes from extra NAD+UD, require supplier DDQ/Z06 E64/E32, own guide responses and structural versioning; F additionally owns its applicable reading expectation while G requires no invented reading. SC-031/P-02 require syntax-tolerated unused national fields to affect no business projection, preserve raw payload and not create a negative APERAK solely for the extras, while outgoing omission remains required. Both copied F/G contracts match the register exactly.

Frozen acceptance SHA256 `e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10`; rules SHA256 `48e5a0608107b01719152cf2a50bfe5fce083381cd66a6c64eb5f5d999cb8fd8`. Current d798 ledger SHA256 `7266ee57be5ac633ec0e8ca3f169aaf7d048da45ca0abfc6004284eae75c822e` is323/352; F/G remain NOT_EXECUTED and SC-031 PARTIAL. This revision changes no row or approval count.

Applied the narrow source/code/differential/spec/false-positive/verification review approach with Supabase/Postgres boundaries, under unchanged AGENTS/current-start/workflow/reservations and existing paused producer/serial ownership. Broad audit/scanners, UI/performance, implementation, executable qualification and delivery are not triggered. Earlier0dbc approvals are historical and apply only to unchanged byte components; this is a fresh assessment of the complete current carrier with its new oracle and disclosed upstream failure.

Independently confirmed helper/config remain byte-identical to0dbc; the recorded F/G preimages match integrated467d exactly. Reached current inboundProcessing, inboundCases, safeApplyReview, structural reviewer, runtimeDecision, final response reader and F/G wire source all match currentbase and their historical source bytes. Their original actual call-chain assessment remains applicable by explicit byte/source identity, not by old approval status. Re-read the relevant current staging/approval/source paths and new assertion boundaries.

## Retained real native frame

The helper still creates prospective transformed physical inputs before admission, recounts only UNT and preserves default already-applied reuse. Deferred mode records real canonical validation, captures rule evidence, finishes its actual source owner and reviews without first apply. The processor then stages through the real intake/case path; `pendingFirstApplication` performs a fresh explicit review after intake before case approval. No protected accepted source/context/effect is seeded by this revision. Declared disposable public source/legal/SMTP inputs and the retained E66 issuer/history premise retain their earlier producer qualification limits.

Existing native evidence reads actual own company/source-bound originals, public business graph, structural object/batch receipts, ignored facets, expectations/observations, case, physical ACKs and outbox. First-effect controls require zero object/batch/reading effects before approval, exact source/hash/actor/LIN/date/register-bound first structural receipts after approval, preserved raw/original/customer/site/supply graph and retained replay. Effective source time remains the real admission clock; market validity uses the existing fixed UTC+1 conversion. Scalar public method/status cannot substitute for the private structural receipts.

F retains its own pending reading expectation and E66 observation only after actual accepted persistence, before reconciliation, with replay and no automatic request. G retains empty expectations/observations and explicit not_required_by_this_change. Own CONTRL/APERAK physical reverse parties/references/object outcome, positive final plan and exact outbox relationships remain asserted. Route inputs are disposable; SMTP is explicitly synthetic, not provider/counterparty trust.

Earlier precise P2 refusal controls remain intact: successful recorded current canonical/application/object/witness/context/rule tuples bind R/D/LI missing causes or accepted-application foreign-point unavailability, instead of generic not_established/recorder failure. Wrong parties require the actual held context, reason, original hash/clock and zero own receiver. Exact apply errors remain anchored; intact captureChange controls prepare the same real basis after refusal probes. Foreign actor/graph/scope, outbound insertion and sealed original mutation controls retain their actual owner guards and no-effect assertions. All12 native cases and all old expect statements remain present in unchanged order; no catch/skip or authority substitute was added.

Shared config remains exact7350c1: mandatory GRIDEX_NATIVE_STATUS, strict127.0.0.1:54321/key checks, all existing includes, real server-only alias, permission catalogue setup,120s limits and serial files are preserved. No global workflow or product gate changes.

## New named customer oracle and causal reach

F396–405 / G395–404 define the new helper; F415/420/444 and G414/419/443 call it on actual persisted case evidence after staging, approval and replay in both false/true UD variants. The helper requires a case, exact case ID/company/source/Z06/phase status, a non-null non-array customer object and the exact15 named DTO fields. Fourteen values are null; the actual clean no-UD qualifier label is `Ej angivet`. It compares named values, not a FORBIDDEN substring or whole cases across different IDs/timestamps. Missing named keys become undefined and fail equality; wrong case/scope/status cannot supply a clean unrelated row.

These fields cover identity/qualifier/type/national IDs/birth/name/address/postcode/city/country. The clean baseline is independently supported by the actual unchanged pure parser on this no-UD wire; cached customer hints are not source authority. Installation/register/structure/customer graph/raw/ignored-facet assertions remain separate and unchanged. Raw and nested register evidence may retain the extra UD; the helper does not improperly demand full nested evidence equality or strip source bytes.

All three calls consume the database case returned by `evidence` rather than a constructed expected customer object. Staging occurs before approval, so a dirty projection cannot be excused by later successful structural application. Approval/replay reads preserve the same own case/source/status binding. These are registered native assertions; no actual native phase was executed in the finite qualification.

## Concrete upstream limit, independently confirmed

Actual current `lib/ediel/inboundCases.ts` blob `c08e51d67c98b8b7be0fc726f2509059cf4aaec0`, SHA256 `39c7e81aeabb3c88b55258248d41672f7390009b72a792421ae021c037203e5f`, remains unchanged. At167 it reads physical UD;192–216 project it into the15-field customer DTO without the F/G ignored-field mask;406/422 pass that DTO directly into `parsed_customer` for case storage. The structural guard accepts the own application and avoids graph matching, but does not clear this staged business projection. Current structural approval preserves the saved case projection; whole customer-row immutability does not refute the staging gap.

The declared extra-UD input thus supplies eight dirty named values: customerId, fullName, firstName, lastName, address, postalCode, city, country. The recorded actual pure-parser observation and66 control rejection agree with this source-visible path. This is not a newly executed native failure or proof of actual customer-row mutation. The new with-UD native cases should fail at the first staging oracle until the rightful C1/a93c051ec decoder/saved-case owner supplies and independently qualifies its correction. No private correction was fetched, copied, written or silently adopted.

This upstream issue is a concrete required downstream correction, not a new defect in the test oracle. Source approval does not authorize forcing native green, weakening expected values, inventing acceptance facts, or replacing the owner's correction with another decoder writer. The coherent adopted source and current native producer qualification remain necessary for any later whole F/G/SC-031 assessment.

## Finite evidence integrity and limits

Independently extracted and hashed embedded qualification JSON: `adea061a2708cb7f74a3349d51988334849dbdeb51f6dbb77f038638521670a9`. Its code/tree/parents/base/final two hashes bind the reviewed source. All22 new raw/controller/preimage/diff artifacts match declared byte lengths and SHA256 values; both preserved preimages exactly match467d. First-oracle/type/lint metadata bind the current two test hashes and exit0. First66 stdout SHA256 `f59248db272f50fcc826e572be94cf451bcf7b2089ed228ccdb0b7e6ba24a55e`; stderr empty SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. These are author-produced source-bound results, not reviewer runs.

Read the source-visible controllers and retained seam loader. The new controller extracts actual new assertion helper AST, actual parser/helper AST with real pure parser/party/date/reference/label dependencies, tokenizer/envelope/field validator and actual recount helper. It declares constructed raw inputs and modeled persisted case rows; no createOrUpdateInboundProdatCase persistence, native fixture producer, PostgreSQL authority, structural apply, physical ACK or phase execution occurs. The retained loader's external source/SQL/runtime mocks do not become native evidence. The66 count is33 controls per F/G: baseline/count/syntax, clean and actual-dirty rows in three phases,15 independently poisoned fields, missing/wrong scope/projection/key controls, raw/ignored/installation preservation and old assertion/phase-registration checks.

The poison values are NON_SENTINEL_CUSTOMER_VALUE, so every named field is tested beyond simple marker exclusion. Current actual dirty parser projections are rejected in each modeled phase and exact clean rows accepted. The initial narrow observation alone did not qualify counted syntax; the final66 controller adds actual recount and syntax checks on clean/dirty physical inputs and actual seven ignored national facets. It does not claim the full canonical native source was admitted or persisted.

Two observation scaffold failures remain preserved: temporary export-wrapper syntax and an overbroad nested meter/evidence comparison. The correction narrowed only temporary observation to legitimate named values and retained raw evidence; it is not a product RED/fix claim. No successful unchanged test was rerun for documentation. First scripts typecheck/exact two-file lint/diff success is preserved without broad native/SQL/GEN/current CI claims.

Applicable UD is selectively supported by the public Z04C C/Z24 source component at429c/e627: its existing first10 finite result asserts actual case parser/writer personalNumber199001011234 against modeled lower storage, not native authority. All seven declared parser/db/reading-SDK/fixture/lock pins independently match public429c, actuald798 and this carrier; test/output pins are the unchanged previously reviewed originals. It was not rerun, imported into these native tests or used as permission to apply UD in F/G. After any decoder correction, its affected applicable-UD behavior needs source-qualified reassessment on the adopted union.

## Checkpoint and final disposition

The complete current checkpoint updates active source/base/resume context, preserves dated old P2/source/review/finite originals and attributes historical0dbc approvals correctly. Current323 ledger and unresolved c08e dependency are explicit. It labels current parser UNFIXED_UNADOPTED_STAGED_BUSINESS_PROJECTION, finite constructed rows/pure AST separately from actual native case persistence, native12 NOT_RUN and +0 whole/CI/GEN/main credit. It preserves raw/ignored-facet and applicable-positive boundaries and holds existing occupied decoder/producer/serial ownership. No copied old report substitutes for this new verdict.

**SOURCE_APPROVE_WITH_UPSTREAM_LIMIT** applies to exact whole H1 `2cb27b3c939a1f0046e73f1b5d36cd7a314d7349` / tree `55163270e8b74fc1f5fa3498270dc9b0c8e12b23`. No new oracle/source must-fix confirmed. The actual decoder projection is still unfixed; only its rightful owner correction plus coherent adopted-source/native/genuine-output/current mandatory CI qualification can remove this limit. Native12 NOT_RUN; whole SC-031/F/G/GEN/ledger/main/merge credit none. Any source/checkpoint/base/relevant dependency change requires affected qualification and exact review binding. Reviewer B pauses after this original report.
```

### Aktuell source-only push-triggeraudit

Actual H1; alla41 workflow-YAML parsade och hashbundna. Sju push-events matchar inte egen branch; inga workflow_run/repository_dispatch-kedjor. Inga dispatch/native/GEN/producent/PR-/mainåtgärder startas av sourcepush. Färsk fjärrmain d798, publicFG0dbc och alla fyra refs3f4 GET_MATCH före dokumentwrite. Endast eget checkpoint ändras. Audit SHA256 `d961379a36b9e7170692752d8484e278cbb66577ef88c1bddacd58b53d04ccca`.

```json
{
  "schema": "ediel_source_only_push_trigger_audit_v1",
  "sourceH1": "2cb27b3c939a1f0046e73f1b5d36cd7a314d7349",
  "base": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
  "branch": "codex/ediel-fg-proof-20261013-6f94",
  "workflowCount": 41,
  "push": [
    {
      "file": ".github/workflows/browser-deps-lock-sync-temporary.yml",
      "branches": [
        "agent/release-certification-hardening-20260817"
      ],
      "branchesIgnore": [],
      "matchesOwnBranch": false
    },
    {
      "file": ".github/workflows/browser-quality-e2e.yml",
      "branches": [
        "main"
      ],
      "branchesIgnore": [],
      "matchesOwnBranch": false
    },
    {
      "file": ".github/workflows/ediel-masterplan-v2.yml",
      "branches": [
        "main"
      ],
      "branchesIgnore": [],
      "matchesOwnBranch": false
    },
    {
      "file": ".github/workflows/full-e2e.yml",
      "branches": [
        "main"
      ],
      "branchesIgnore": [],
      "matchesOwnBranch": false
    },
    {
      "file": ".github/workflows/ops-hardening.yml",
      "branches": [
        "main"
      ],
      "branchesIgnore": [],
      "matchesOwnBranch": false
    },
    {
      "file": ".github/workflows/tenant-integrity-regression.yml",
      "branches": [
        "main"
      ],
      "branchesIgnore": [],
      "matchesOwnBranch": false
    },
    {
      "file": ".github/workflows/vercel-production-deploy.yml",
      "branches": [
        "main"
      ],
      "branchesIgnore": [],
      "matchesOwnBranch": false
    }
  ],
  "indirectChainTriggers": [],
  "workflowPins": [
    {
      "file": ".github/workflows/browser-deps-lock-sync-temporary.yml",
      "sha256": "6c6c7fe045496292486af35b515c8d615e343fdf13f6906d4b993d4df633d2ae"
    },
    {
      "file": ".github/workflows/browser-quality-e2e.yml",
      "sha256": "1b22d834938a7929224d71a8791daffd5a8b877baf83af193763a938cf033787"
    },
    {
      "file": ".github/workflows/canonical-quote-db-release-gate.yml",
      "sha256": "60e7cbdabf0178a5ece58dee6ae3f41f0cbc1636a29f84153bb421c93f585c0c"
    },
    {
      "file": ".github/workflows/ediel-cancellation-public-acceptance-native.yml",
      "sha256": "18f63c741ff4dd17d8b248bbb2c7c66c2a5d6b1924d2f550a3d7ec2f3a9c2151"
    },
    {
      "file": ".github/workflows/ediel-cancellation-public-birth-native.yml",
      "sha256": "20485c74970eeae7516e37c21ef9526b4834cf616396b52c01316540a642f601"
    },
    {
      "file": ".github/workflows/ediel-db01-current-native.yml",
      "sha256": "d28e9e9d296c8a9c7cf5fa92a293cd5fadc352357213d0c7f379776921b59efb"
    },
    {
      "file": ".github/workflows/ediel-db04-current-consumers-native.yml",
      "sha256": "f189bbc8ae70cf8fcd4a6a690996c1a3d6213933f7511679d7216cae5ac51615"
    },
    {
      "file": ".github/workflows/ediel-db05-native.yml",
      "sha256": "0d3d859bb41f2d7810fedfe17b8b603e48acc61286a23c54af2d4458c7465704"
    },
    {
      "file": ".github/workflows/ediel-esco-z14vh-z15v-native.yml",
      "sha256": "7f38047f3bfe4ee59b82e39c52fe2fd4ddaaad0db7d6bb49f4c206dbbb6d4f9b"
    },
    {
      "file": ".github/workflows/ediel-masterplan-v2.yml",
      "sha256": "570fee485c20cab4fd33b5ff048589cf20a807dde68585e29969450b3b023f36"
    },
    {
      "file": ".github/workflows/ediel-p08-native.yml",
      "sha256": "1accd8fce133bf0cadda4fe8f61e3f2d8d3d7643a9773c1802a531c4280f2e7f"
    },
    {
      "file": ".github/workflows/ediel-prodat-response-hold-native.yml",
      "sha256": "8caa813a36578d61eb66e832ae44d3a76ee1dc2aec3637f02cccd9bb80e7f0bc"
    },
    {
      "file": ".github/workflows/ediel-recovery-native.yml",
      "sha256": "5cc097dccc90f4649250e40b45dff7c297f10bdad5dc57ce3c795916c069de52"
    },
    {
      "file": ".github/workflows/ediel-sc003-sc005-native.yml",
      "sha256": "a5ab28cb335dc108a8b8065b0aba170661b43b35ac1b72b971f0f2f12b98a4ac"
    },
    {
      "file": ".github/workflows/ediel-sc014-z14v-native.yml",
      "sha256": "8734e192537021d3830bffcbb394f6b0c43b7e64341bcabbca3d6da38f256724"
    },
    {
      "file": ".github/workflows/ediel-sc053-native.yml",
      "sha256": "d5c25abcee97c45da479a641e66d0930e77a08f4fc1ed1483447d281cf6c7a9b"
    },
    {
      "file": ".github/workflows/ediel-sc054-native.yml",
      "sha256": "bb7ea54eb195739a5cfd2acce91cdb346e44280276c139d04152043419ed96da"
    },
    {
      "file": ".github/workflows/ediel-sc064-native.yml",
      "sha256": "7bb0d19009baeac92573887661f2514fc683331f86ff5b0df2a737efef091b0d"
    },
    {
      "file": ".github/workflows/ediel-sc071-native.yml",
      "sha256": "0e7e7269c54b8f89473e92e4015bf77c1ae855cee7fe0c7501b8ccdc5b97a977"
    },
    {
      "file": ".github/workflows/ediel-tr09-current-native.yml",
      "sha256": "e156aa10bb7ea27e773500ae8b76553471b967a5b96a4841cbd987bac036b350"
    },
    {
      "file": ".github/workflows/ediel-z02-supplier-native.yml",
      "sha256": "45df7047094a2ec7d2207a9ade6f21487999d3635851c8d15bfd9484ac3c10b8"
    },
    {
      "file": ".github/workflows/ediel-z03h-z04h-supplier-native.yml",
      "sha256": "002aa1172a537ac8f6f70fd32967154487a09dec3d042190dd1faee26da932be"
    },
    {
      "file": ".github/workflows/ediel-z04a-assigned-supply-native.yml",
      "sha256": "a685bff1acb6cf3523b7bddfb3e1992cbf68f6dab1b3ee3a88b336961f5cea79"
    },
    {
      "file": ".github/workflows/ediel-z05-public-birth-native.yml",
      "sha256": "091db1d78dd0210853a5cafff7128891556d7663d51cf0b2be9c7d485e55c13e"
    },
    {
      "file": ".github/workflows/ediel-z05-supplier-native.yml",
      "sha256": "27aef63ea8526b41099e196dc23e22ec05690010d00280f20353a5c4d433db0b"
    },
    {
      "file": ".github/workflows/ediel-z06e-z09e-native.yml",
      "sha256": "500937dd634c8f3288466847cf438fad532f167a6e74eab4d71f99b358cb4c3a"
    },
    {
      "file": ".github/workflows/ediel-z08lk-native.yml",
      "sha256": "649b853685415bc25659a177c426dafc7ac3cd84dc5afc9bb375d44b882d02e2"
    },
    {
      "file": ".github/workflows/ediel-z10m-supplier-native.yml",
      "sha256": "7e9d089ff0d1a4ed90cad7c0c40d72b71ccc2e1407ba82ab53ad102457832458"
    },
    {
      "file": ".github/workflows/ediel-z14n-native.yml",
      "sha256": "e460efeb65d18053b225a3714022568c16a9e05923357434ceffbdb760e4cdd8"
    },
    {
      "file": ".github/workflows/ediel-z15c-z18v-native.yml",
      "sha256": "e6b5a842d8fa5b57f927b8de8571a0ce6ff74a76ba788380d5a1d7dde01a11e0"
    },
    {
      "file": ".github/workflows/full-e2e.yml",
      "sha256": "4b596a8e9b72835a89a6fff9bb77fdcad7eabb52bd1de5b03fa208344fa4bd31"
    },
    {
      "file": ".github/workflows/one-off-offer-binding-native.yml",
      "sha256": "4a9405ed2079a558e49dc64aa1500bc0cd44448edd0e1075f70f4d922736f020"
    },
    {
      "file": ".github/workflows/one-shot-operation-id-fix.yml",
      "sha256": "45ddcf525c6657e99f2c39d727d8be3ecdc16a5841fb5bf303be4729a4c20167"
    },
    {
      "file": ".github/workflows/ops-hardening.yml",
      "sha256": "f1c03e2be5a38d2b41d96c2cfcb53259c6a2dd9af99f5a17311c693c91237d9d"
    },
    {
      "file": ".github/workflows/production-certification-e2e.yml",
      "sha256": "e98e59fe75e1ddc988d048132769eef368b7f6bdde1dd5ce95b7da33ac8ff4f7"
    },
    {
      "file": ".github/workflows/repair-generated-supabase-types.yml",
      "sha256": "7dacb59f5e7889eec16c1222ffd24476816bec0e33585fbb0cd6750168b45ce4"
    },
    {
      "file": ".github/workflows/staff-api-schema-capture.yml",
      "sha256": "5675989bfc158868e2c2a8508c74c5a05043052934dd1f7f79da8df06e272adf"
    },
    {
      "file": ".github/workflows/tenant-integrity-regression.yml",
      "sha256": "46d45b2364ad8b7bf2d80e7399b40a5835565bd34003c274d06f4e6dd6ebb890"
    },
    {
      "file": ".github/workflows/tenant-isolation-invariants.yml",
      "sha256": "e49b8a1444602f95cd8410aa891a7af54c4f817349e7c7cb201dbd500bb58367"
    },
    {
      "file": ".github/workflows/vercel-production-deploy.yml",
      "sha256": "2ab42b283d76821709ec50f546daf75c80a64030e651cf34767603172ff7c9d3"
    },
    {
      "file": ".github/workflows/zero-admin-production-crawler.yml",
      "sha256": "b9bd2f5bb02a972c02f842bdaa507c28fd20c425f8c39b3e2753de18f395d74d"
    }
  ],
  "noDispatchOrNativeInvoked": true
}
```
