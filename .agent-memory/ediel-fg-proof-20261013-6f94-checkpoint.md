# Ediel F/G: avgränsad sourcekomponent, 6f94

## Aktuellt läge och nästa steg

Ägare: `codex-ediel-fg-proof-20261013-6f94`. Packet: `cf251c2f-a87c-4c82-aaa5-4d711a754b5c`. Egen branch: `codex/ediel-fg-proof-20261013-6f94`; isolerad workspace: `/workspace/ediel-fg-proof-20261013-6f94`.

P2 är rättad och sourceförberedelsen är verifierad på aktuell main95d. Kodsource `d5b70dc7a125a1708215fef1c5293bbe7e9483fd`, tree `5527b906e736c98c27c335834195a22a358b980e`, ordered parent `[53b43f042fe7728996495c19a53dc63a84e82899]`, base `95d8d160491e79b172342654d8dc643346758105`/tree `fa5ab60527a40bd642749365fc275d1d4a69e277`. Skrivaren är pausad. Fyra sourcepostbilder bevarades byteexakt från writerfreeze8bb66f. Eget checkpoint tillkommer som femte fil; full carrierhead/tree binds i slutgranskning och tekniskt #766-kvitto efter dess frysning. Nativefall är förberedda, **inte körda**. F/G-raderna i ledgern är oförändrade NOT_EXECUTED.

Nästa åtgärd: två oberoende slutgranskare bedömer hela frysta slutversionen med exakt head/base/tree/ordered parents, inklusive eget checkpoint och rättning på aktuell main. Root har förnyat alla fyra GET_MATCH och main/preimages före integration; inga mainändringar utanför våra fyra sourcepaths har backats ut. En egen sourcebranch görs åtkomlig för den befintliga seriella ägaren utan PR, dispatch eller aktiverad producent. Genuin native-/backend-/originalkvalificering, PR, adoption och normalmerge sker därefter genom den uttryckliga owner-routingen. Ingen ledgerpromotion följer av source-only PASS.

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

## Faktisk main och ledger

Startmain: `efed3683115c06d1925f8b80c05c801a54db9885`, tree `dc439c2e017a9633471db53919b745f587abb67b`.

Aktuell normalmerge av #780 är autentiserad: main `95d8d160491e79b172342654d8dc643346758105`, tree `fa5ab60527a40bd642749365fc275d1d4a69e277`, ordered parents `[efed3683115c06d1925f8b80c05c801a54db9885, 2e073477c43c6a133a01710772e65cefc43f6162]`. PR CLOSED/merged `2026-10-13T13:22:09Z`; head2e073 och treeMATCH. Den aktuella ledgern lästes ur detta exakta Gitobjekt: SHA256 `4a1560a0b16ae37d68aa30c5f67ef616a516c5306e29edf4269b7b1fa9fea850`, **119 VERIFIED + 201 PASSED = 320/352**. Den är oförändrad. SC035 är fortfarande PARTIAL; Z02L/LK och våra F/G-rader är fortfarande NOT_EXECUTED. Ingen ökning antas från sourceleveransen eller äldre antal.

## Ändring och verifiering hittills

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

## Granskning och konkret P2-rättning

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
